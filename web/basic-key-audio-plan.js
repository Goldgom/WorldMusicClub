import {humanPracticePartIds} from './practice-selection.js';
import {BASIC_KEY_RENDITION, BASIC_KEY_MAX_VOICES, basicKeyRenditionNotes, basicKeyExactMilliseconds} from './basic-key-rendition.js';
import {CanonicalFingerprint} from './canonical-audio-fingerprint.js';

// Wire bounds are independent of the number of active voices. The complete
// plan is copied once into the worklet; no AudioNode is allocated per note.
export const BASIC_KEY_AUDIO_PROTOCOL = 'wmh-basic-key-audio-v1';
export const VSQ_AUDIO_POLICY = 'wmh-vsq-base-note-reference-v1';
export const VSQ_AUDIO_IDENTITY = 'vsq-authored-note';
export const VSQ_TRIANGLE_SIZE = 1024;
export const BASIC_KEY_TIMBRE_PROFILE = 'wmh-basic-synthetic-colors-v1';
export const BASIC_KEY_SYNTHETIC_INSTRUMENTS = Object.freeze(['sine', 'triangle', 'reed']);
export const BASIC_KEY_AUDIO_LIMITS = Object.freeze({maxNotes: 65536, maxBytes: 16 * 1024 * 1024, maxVoices: BASIC_KEY_MAX_VOICES, maxGeneration: 0x7fffffff, maxIdLength: 160, maxFrame: 2 ** 48, maxAuditRows: 256});
export class BasicKeyAudioError extends Error {
  constructor(code, message, details = {}) { super(message); this.name = 'BasicKeyAudioError'; this.code = code; this.details = details; }
}
export const audioFail = (code, message, details) => { throw new BasicKeyAudioError(code, message, details); };
const integer = (n, min, max) => Number.isSafeInteger(n) && n >= min && n <= max;
const asciiId = value => typeof value === 'string' && value.length > 0 && value.length <= BASIC_KEY_AUDIO_LIMITS.maxIdLength && /^[\x21-\x7e]+$/.test(value);
const vsqPlan = input => input?.policyId === VSQ_AUDIO_POLICY && input.identityKind === VSQ_AUDIO_IDENTITY;
const admittedPolicy = input => vsqPlan(input) || input?.policyId === BASIC_KEY_RENDITION && input.identityKind === undefined;
const vsqCoordinate = id => /^vsq:([a-f0-9]{64}):t([1-9][0-9]*):ID#([0-9]{4}|[0-9]{8})$/.exec(id);
/** Resolve only explicit synthetic choices. A missing entry keeps the source
 * recipe, including percussion and the existing VSQ instrumental recipes. */
export function basicKeyInstrumentOverrides(parts, overrides = {}) {
  if (!overrides || typeof overrides !== 'object' || Array.isArray(overrides) || ![Object.prototype, null].includes(Object.getPrototypeOf(overrides))) audioFail('invalid_instrument_override', 'Instrument overrides must map source part IDs to supported synthetic colors.');
  const known = new Set(parts), selections = new Map();
  for (const partId of Reflect.ownKeys(overrides)) {
    const descriptor = Object.getOwnPropertyDescriptor(overrides, partId), instrument = descriptor?.value;
    if (typeof partId !== 'string' || !known.has(partId) || !descriptor.enumerable || !Object.hasOwn(descriptor, 'value') || !BASIC_KEY_SYNTHETIC_INSTRUMENTS.includes(instrument)) audioFail('invalid_instrument_override', 'An instrument override names an unknown part or unsupported synthetic color.');
    selections.set(partId, BASIC_KEY_SYNTHETIC_INSTRUMENTS.indexOf(instrument) + 1);
  }
  return selections;
}
export function basicKeyTimbrePlan(notes, selections) {
  const timbres = notes.map(note => selections.get(note[0]) || 0);
  return timbres.some(Boolean) ? {timbreProfile: BASIC_KEY_TIMBRE_PROFILE, timbres} : {};
}
// Only explicit overrides extend the transfer. Bind their indexed selections
// to the source coordinates and exact prepared gates, not mutable part labels.
export function basicKeyTimbreHasher(plan) {
  return new CanonicalFingerprint(BASIC_KEY_TIMBRE_PROFILE).value([plan.protocol, plan.policyId, plan.identityKind ?? null, plan.sourceSha256, plan.sampleRate, plan.durationFrames, plan.sourceNotes, plan.count]);
}
export function hashBasicKeyTimbreRow(hash, plan, index) {
  if (plan.identityKind === VSQ_AUDIO_IDENTITY) { hash.number(plan.sourceTracks[index]); hash.number(plan.authoredIds[index]); hash.number(plan.authoredIdDigits[index]); }
  else { hash.number(plan.tracks[index]); hash.number(plan.events[index]); }
  hash.gate(index, plan.starts[index], plan.ends[index], plan.keys[index], plan.velocities[index]);
  hash.number(plan.roles[index]); hash.number(plan.timbres[index]);
}
export function audioTransferIdentity(plan, index) {
  if (plan.identityKind === VSQ_AUDIO_IDENTITY) {
    const id = `ID#${String(plan.authoredIds[index]).padStart(plan.authoredIdDigits[index], '0')}`, track = plan.sourceTracks[index];
    return {noteId: `vsq-t${track}-${id}`, eventId: `vsq:${plan.sourceSha256}:t${track}:${id}`};
  }
  return {noteId: `midi-t${plan.tracks[index] + 1}-e${plan.events[index] + 1}`, eventId: `midi:${plan.sourceSha256}:t${plan.tracks[index]}:e${plan.events[index]}`};
}
export function compareAudioTransferIdentity(plan, a, b) {
  return plan.identityKind === VSQ_AUDIO_IDENTITY
    ? plan.sourceTracks[a] - plan.sourceTracks[b] || plan.authoredIdDigits[a] - plan.authoredIdDigits[b] || plan.authoredIds[a] - plan.authoredIds[b]
    : plan.tracks[a] - plan.tracks[b] || plan.events[a] - plan.events[b];
}
export function basicKeySampleRate(sampleRate) {
  if (!integer(sampleRate, 8000, 384000)) audioFail('unsupported_audio_sample_rate', 'The basic audio receiver requires an integer sample rate between 8000 and 384000 Hz.');
  return sampleRate;
}

/** Exact rational microseconds enter the sample lattice only at this boundary.
 * Floor attacks and ceil ends: every positive gate contains at least one sample,
 * and each boundary differs from its Rust rational time by less than one sample.
 */
export function basicKeyGateFrames(start, end, sampleRate) {
  basicKeySampleRate(sampleRate);
  const ratio = value => {
    if (!value || typeof value.numerator !== 'string' || !/^(0|[1-9][0-9]{0,19})$/.test(value.numerator) || !integer(value.denominator, 1, 65535)) audioFail('invalid_audio_plan', 'A native gate has invalid rational timing.');
    return [BigInt(value.numerator) * BigInt(sampleRate), BigInt(value.denominator) * 1000000n];
  };
  const [sn, sd] = ratio(start), [en, ed] = ratio(end);
  if (en * sd <= sn * ed) audioFail('invalid_audio_plan', 'A native gate must have a positive exact duration.');
  const a = sn / sd, b = (en + ed - 1n) / ed;
  if (b > BigInt(BASIC_KEY_AUDIO_LIMITS.maxFrame)) audioFail('invalid_audio_plan', 'The native gate exceeds the exact audio frame range.');
  return [Number(a), Number(b)];
}

/** Accept an already admitted Rust rendition, never reinterpret source events. */
export function buildBasicKeyAudioPlan(song, {sampleRate, mode = 'listen', targetPart = null, practiceSelection, mutedParts = [], soloParts = [], instrumentOverrides = {}} = {}) {
  basicKeySampleRate(sampleRate);
  const rendition = song?.runtime?.rendition, timeline = song?.compilation?.timeline?.notes;
  if (rendition?.policy_id !== BASIC_KEY_RENDITION || rendition.source_sha256 !== song?.score?.source?.sha256 || !Array.isArray(timeline) || !Array.isArray(rendition.notes)) audioFail('invalid_audio_plan', 'An admitted native basic-key rendition is required.');
  if (rendition.policy?.allocation_lookahead_ms !== 100 || rendition.policy?.voice_limit !== 128 || rendition.policy?.receiver_gate_tail_ms !== 0) audioFail('reference_policy_required', 'The basic audio receiver requires the declared 100 ms, 128-voice, zero-tail policy.');
  if (!['listen', 'practice'].includes(mode)) audioFail('invalid_audio_plan', 'Unknown basic-key playback mode.');
  const humanParts = humanPracticePartIds(song.runtime.parts,{mode,practiceSelection,targetPart});
  const overrides = basicKeyInstrumentOverrides(song.runtime.parts.map(part => part.id), instrumentOverrides), timbres = new Map();
  if (timeline.length !== rendition.notes.length || timeline.length > BASIC_KEY_AUDIO_LIMITS.maxNotes) audioFail('audio_plan_limit', 'The complete source exceeds the bounded audio plan note count.', {maxNotes: BASIC_KEY_AUDIO_LIMITS.maxNotes});
  const muted = new Set(mutedParts), solo = new Set(soloParts), evidence = new Map();
  for (const note of basicKeyRenditionNotes(rendition)) {
    if (evidence.has(note.note_id)) audioFail('invalid_audio_plan', 'A native source ID was repeated.');
    evidence.set(note.note_id, note);
  }
  const notes = [], seen = new Set();
  for (const target of timeline) {
    const note = evidence.get(target.id);
    if (!note || seen.has(target.id)) audioFail('invalid_audio_plan', 'The audio timeline does not join every native gate exactly once.');
    seen.add(target.id);
    const [start, end] = basicKeyGateFrames(note.start, note.end, sampleRate);
    if (!['melodic_key', 'percussion_selector'].includes(note.role)) audioFail('invalid_audio_plan', 'The native gate has an unknown sound role.');
    if (!integer(target.midi,0,127) || !integer(target.velocity,1,127) || target.source_note_id !== target.id || target.source_note_ids?.length !== 1 || target.source_note_ids[0] !== target.id || target.id !== `midi-t${note.attack.track + 1}-e${note.attack.event + 1}` || !song.runtime.parts.some(part => part.id === target.part_id) || !Number.isFinite(target.start_ms) || !Number.isFinite(target.duration_ms) || Math.abs(target.start_ms-basicKeyExactMilliseconds(note.start)) > .001 || Math.abs(target.duration_ms-(basicKeyExactMilliseconds(note.end)-basicKeyExactMilliseconds(note.start))) > .001) audioFail('invalid_audio_plan', 'A native basic-key identity or gate does not match its target projection.');
    if (muted.has(target.part_id) || (solo.size && !solo.has(target.part_id)) || humanParts.has(target.part_id)) continue;
    notes.push([target.id, `midi:${rendition.source_sha256}:t${note.attack.track}:e${note.attack.event}`, start, end, target.midi, target.velocity, note.role === 'percussion_selector' ? 1 : 0]);
    if (overrides.has(target.part_id)) timbres.set(target.id, overrides.get(target.part_id));
  }
  // Native ordering is retained among equal sample boundaries.
  notes.sort((a, b) => a[2] - b[2]);
  let durationFrames = Math.ceil(rendition.duration_ms * sampleRate / 1000);
  for (const note of notes) durationFrames = Math.max(durationFrames, note[3]);
  return validateBasicKeyAudioPlan({protocol: BASIC_KEY_AUDIO_PROTOCOL, sourceSha256: rendition.source_sha256, policyId: rendition.policy_id, sampleRate, durationFrames, sourceNotes: timeline.length, notes, ...basicKeyTimbrePlan(notes, timbres)});
}

/** Validate and defensively copy; callers cannot mutate a prepared plan. */
export function validateBasicKeyAudioPlan(input) {
  const limits = BASIC_KEY_AUDIO_LIMITS;
  if (!input || input.protocol !== BASIC_KEY_AUDIO_PROTOCOL || !admittedPolicy(input) || !/^[a-f0-9]{64}$/.test(input.sourceSha256) || !Array.isArray(input.notes) || input.notes.length > limits.maxNotes || !integer(input.sourceNotes, input.notes.length, limits.maxNotes) || !integer(input.durationFrames, 0, limits.maxFrame)) audioFail('invalid_audio_plan', 'The complete basic audio plan is invalid or exceeds its note bound.');
  const vsq = vsqPlan(input);
  const selected = input.timbreProfile !== undefined || input.timbres !== undefined;
  if (selected && (input.timbreProfile !== BASIC_KEY_TIMBRE_PROFILE || !Array.isArray(input.timbres) || input.timbres.length !== input.notes.length || [...input.timbres].some(value => !integer(value, 0, BASIC_KEY_SYNTHETIC_INSTRUMENTS.length)))) audioFail('invalid_audio_plan', 'The source-bound synthetic color selection is invalid.');
  const sampleRate = basicKeySampleRate(input.sampleRate), seen = new Set(), events = new Set(), edges = [], notes = [];
  let prior = -1;
  for (const row of input.notes) {
    if (!Array.isArray(row) || row.length !== 7 || !asciiId(row[0]) || !asciiId(row[1]) || seen.has(row[0]) || events.has(row[1]) || !integer(row[2], 0, input.durationFrames) || !integer(row[3], row[2] + 1, input.durationFrames) || row[2] < prior || !integer(row[4], 0, 127) || !integer(row[5], 1, 127) || !integer(row[6], vsq ? 2 : 0, vsq ? 3 : 1)) audioFail('invalid_audio_plan', 'A source-bound audio gate is invalid, duplicated or out of order.');
    const timbre = selected ? input.timbres[notes.length] : 0;
    if ((timbre || row[6] !== 1) && 440 * 2 ** ((row[4] - 69) / 12) * (vsq && !timbre ? row[6] : 1) > sampleRate * 0.45) audioFail('unsupported_audio_sample_rate', 'The audio device cannot represent every retained key and declared harmonic without clamping.', {eventId: row[1]});
    if (vsq) {
      const coordinate = vsqCoordinate(row[1]);
      if (!coordinate || coordinate[1] !== input.sourceSha256 || !integer(Number(coordinate[2]), 1, 65535) || row[0] !== `vsq-t${coordinate[2]}-ID#${coordinate[3]}` || row[5] !== 90) audioFail('invalid_audio_plan', 'The VSQ audio identity or fixed reference velocity does not match its authored source.');
    } else {
      const coordinates = /^midi:([a-f0-9]{64}):t([0-9]+):e([0-9]+)$/.exec(row[1]), track = Number(coordinates?.[2]), event = Number(coordinates?.[3]);
      if (coordinates?.[1] !== input.sourceSha256 || !integer(track, 0, Number.MAX_SAFE_INTEGER - 1) || !integer(event, 0, Number.MAX_SAFE_INTEGER - 1) || row[0] !== `midi-t${track + 1}-e${event + 1}`) audioFail('invalid_audio_plan', 'The audio note ID does not match its stable source coordinate.');
    }
    seen.add(row[0]); events.add(row[1]); prior = row[2];
    notes.push(Object.freeze([...row])); edges.push([row[2], 1], [row[3], -1]);
  }
  edges.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  let active = 0, maximum = 0;
  for (const [, delta] of edges) { active += delta; maximum = Math.max(maximum, active); }
  if (maximum > limits.maxVoices) audioFail('voice_budget_exceeded', 'The sample-frame gates exceed 128 simultaneous voices; no voice is stolen.', {voices: maximum, maxVoices: limits.maxVoices});
  const plan = {protocol: input.protocol, sourceSha256: input.sourceSha256, policyId: input.policyId, ...(vsq ? {identityKind: VSQ_AUDIO_IDENTITY} : {}), sampleRate, durationFrames: input.durationFrames, sourceNotes: input.sourceNotes, notes: Object.freeze(notes), ...(selected ? {timbreProfile: BASIC_KEY_TIMBRE_PROFILE, timbres: Object.freeze([...input.timbres])} : {})};
  // All wire fields are ASCII. JSON escaping can only increase length here;
  // this is an exact UTF-8 wire-byte bound, not a claimed JS heap-byte bound.
  if (JSON.stringify(plan).length > limits.maxBytes) audioFail('audio_plan_limit', 'The complete audio plan exceeds 16 MiB of wire data.', {maxBytes: limits.maxBytes});
  return Object.freeze(plan);
}
export function encodeBasicKeyAudioPlan(plan) { return JSON.stringify(validateBasicKeyAudioPlan(plan)); }
export function decodeBasicKeyAudioPlan(wire) {
  if (typeof wire !== 'string' || wire.length > BASIC_KEY_AUDIO_LIMITS.maxBytes || /[^\x00-\x7f]/.test(wire)) audioFail('audio_plan_limit', 'The worklet audio plan must fit its 16 MiB ASCII wire bound.');
  let input;
  try { input = JSON.parse(wire); } catch { audioFail('invalid_audio_plan', 'The audio plan wire data is not JSON.'); }
  return validateBasicKeyAudioPlan(input);
}

const TRANSFER_FIELDS = Object.freeze({starts: Float64Array, ends: Float64Array, keys: Uint8Array, velocities: Uint8Array, roles: Uint8Array, idOrder: Uint32Array, playOrder: Uint32Array, seen: Uint8Array, steps: Float64Array, actualStarts: Float64Array, actualEnds: Float64Array});
const transferFields = input => ({...TRANSFER_FIELDS, ...(vsqPlan(input) ? {sourceTracks: Uint16Array, authoredIds: Uint32Array, authoredIdDigits: Uint8Array, triangles: Float32Array} : {tracks: Float64Array, events: Float64Array}), ...(input.timbreProfile === BASIC_KEY_TIMBRE_PROFILE ? {timbres: Uint8Array} : {})});
const transferLength = (name, count) => name === 'triangles' ? 128 * VSQ_TRIANGLE_SIZE : count;

// The two existing VSQ recipes use the same triangle fundamental. Build its
// band-limited periodic table on the host, before transport admission. This is
// a procedural triangle, not a bit-for-bit Web Audio OscillatorNode claim.
function fillVsqTriangles(table, sampleRate) {
  for (let key = 0; key < 128; key++) {
    const hz = 440 * 2 ** ((key - 69) / 12);
    const last = Math.min(VSQ_TRIANGLE_SIZE / 2 - 1, Math.ceil(sampleRate / (2 * hz)) - 1);
    for (let harmonic = 1; harmonic <= last; harmonic += 2) {
      const amplitude = 8 / (Math.PI ** 2) * (harmonic % 4 === 1 ? 1 : -1) / harmonic ** 2;
      for (let index = 0; index < VSQ_TRIANGLE_SIZE; index++) table[key * VSQ_TRIANGLE_SIZE + index] += amplitude * Math.sin(2 * Math.PI * harmonic * index / VSQ_TRIANGLE_SIZE);
    }
  }
}

/** Allocate and sort only on the host. Transfer ownership of every buffer so
 * the render thread attaches fixed-size views without copying or allocating
 * a note-sized array. Scratch buffers are reinitialized incrementally there.
 */
export function createBasicKeyAudioTransfer(input) {
  const plan = validateBasicKeyAudioPlan(input), count = plan.notes.length, arrays = {}, buffers = {};
  const vsq = vsqPlan(plan);
  for (const [name, Type] of Object.entries(transferFields(plan))) { arrays[name] = new Type(transferLength(name, count)); buffers[name] = arrays[name].buffer; }
  if (vsq) fillVsqTriangles(arrays.triangles, plan.sampleRate);
  for (let index = 0; index < count; index++) {
    const note = plan.notes[index];
    if (vsq) { const coordinate = vsqCoordinate(note[1]); arrays.sourceTracks[index] = Number(coordinate[2]); arrays.authoredIds[index] = Number(coordinate[3]); arrays.authoredIdDigits[index] = coordinate[3].length; }
    else { const coordinates = /:t([0-9]+):e([0-9]+)$/.exec(note[1]); arrays.tracks[index] = Number(coordinates[1]); arrays.events[index] = Number(coordinates[2]); }
    arrays.starts[index] = note[2]; arrays.ends[index] = note[3]; arrays.keys[index] = note[4]; arrays.velocities[index] = note[5]; arrays.roles[index] = note[6];
    if (arrays.timbres) arrays.timbres[index] = plan.timbres[index];
  }
  const identities = {...arrays, identityKind: plan.identityKind};
  const order = Array.from({length: count}, (_, index) => index).sort((a, b) => compareAudioTransferIdentity(identities, a, b));
  arrays.idOrder.set(order);
  const wire = {protocol: plan.protocol, policyId: plan.policyId, ...(vsq ? {identityKind: VSQ_AUDIO_IDENTITY} : {}), sourceSha256: plan.sourceSha256, sampleRate: plan.sampleRate, durationFrames: plan.durationFrames, sourceNotes: plan.sourceNotes, count, ...(plan.timbreProfile ? {timbreProfile: plan.timbreProfile} : {}), buffers};
  if (plan.timbreProfile) { const bound = {...wire, ...arrays}, hash = basicKeyTimbreHasher(bound); for (let index = 0; index < count; index++) hashBasicKeyTimbreRow(hash, bound, index); wire.timbreFingerprint = hash.hex(); }
  return {wire, transfer: Object.values(buffers)};
}

/** Constant-size envelope check only. No JSON parsing, sorting, buffer
 * allocation, or iteration over notes on the audio-thread message handler.
 */
export function openBasicKeyAudioTransfer(wire, sampleRate) {
  if (!wire || wire.protocol !== BASIC_KEY_AUDIO_PROTOCOL || !admittedPolicy(wire) || !/^[a-f0-9]{64}$/.test(wire.sourceSha256) || wire.sampleRate !== sampleRate || !integer(wire.count, 0, BASIC_KEY_AUDIO_LIMITS.maxNotes) || !integer(wire.sourceNotes, wire.count, BASIC_KEY_AUDIO_LIMITS.maxNotes) || !integer(wire.durationFrames, 0, BASIC_KEY_AUDIO_LIMITS.maxFrame) || !wire.buffers) audioFail('invalid_audio_plan', 'The transferable audio plan envelope is invalid.');
  if (wire.timbreProfile !== undefined && wire.timbreProfile !== BASIC_KEY_TIMBRE_PROFILE || (wire.timbreProfile === BASIC_KEY_TIMBRE_PROFILE) !== Object.hasOwn(wire.buffers, 'timbres') || (wire.timbreProfile ? !/^[a-f0-9]{64}$/.test(wire.timbreFingerprint) : wire.timbreFingerprint !== undefined)) audioFail('invalid_audio_plan', 'The transferable synthetic color profile or fingerprint is invalid.');
  const arrays = {}; let bytes = 0;
  const unique = new Set();
  for (const [name, Type] of Object.entries(transferFields(wire))) {
    const buffer = wire.buffers[name];
    if (!(buffer instanceof ArrayBuffer) || buffer.byteLength !== transferLength(name, wire.count) * Type.BYTES_PER_ELEMENT || unique.has(buffer)) audioFail('invalid_audio_plan', 'The transferable audio plan has an invalid or aliased buffer.');
    unique.add(buffer); bytes += buffer.byteLength; arrays[name] = new Type(buffer);
  }
  if (bytes > BASIC_KEY_AUDIO_LIMITS.maxBytes) audioFail('audio_plan_limit', 'The transferable audio plan exceeds its byte bound.');
  return {protocol: wire.protocol, policyId: wire.policyId, identityKind: wire.identityKind, sourceSha256: wire.sourceSha256, sampleRate, durationFrames: wire.durationFrames, sourceNotes: wire.sourceNotes, count: wire.count, ...(wire.timbreProfile ? {timbreProfile: wire.timbreProfile, timbreFingerprint: wire.timbreFingerprint} : {}), ...arrays};
}
