import {BASIC_KEY_RENDITION, BASIC_KEY_MAX_VOICES, basicKeyRenditionNotes} from './basic-key-rendition.js';

// Wire bounds are independent of the number of active voices. The complete
// plan is copied once into the worklet; no AudioNode is allocated per note.
export const BASIC_KEY_AUDIO_PROTOCOL = 'wmh-basic-key-audio-v1';
export const BASIC_KEY_AUDIO_LIMITS = Object.freeze({maxNotes: 65536, maxBytes: 16 * 1024 * 1024, maxVoices: BASIC_KEY_MAX_VOICES, maxGeneration: 0x7fffffff, maxIdLength: 160, maxFrame: 2 ** 48, maxAuditRows: 256});
export class BasicKeyAudioError extends Error {
  constructor(code, message, details = {}) { super(message); this.name = 'BasicKeyAudioError'; this.code = code; this.details = details; }
}
export const audioFail = (code, message, details) => { throw new BasicKeyAudioError(code, message, details); };
const integer = (n, min, max) => Number.isSafeInteger(n) && n >= min && n <= max;
const asciiId = value => typeof value === 'string' && value.length > 0 && value.length <= BASIC_KEY_AUDIO_LIMITS.maxIdLength && /^[\x21-\x7e]+$/.test(value);
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
export function buildBasicKeyAudioPlan(song, {sampleRate, mode = 'listen', targetPart = null, mutedParts = [], soloParts = []} = {}) {
  basicKeySampleRate(sampleRate);
  const rendition = song?.runtime?.rendition, timeline = song?.compilation?.timeline?.notes;
  if (rendition?.policy_id !== BASIC_KEY_RENDITION || rendition.source_sha256 !== song?.score?.source?.sha256 || !Array.isArray(timeline) || !Array.isArray(rendition.notes)) audioFail('invalid_audio_plan', 'An admitted native basic-key rendition is required.');
  if (rendition.policy?.allocation_lookahead_ms !== 100 || rendition.policy?.voice_limit !== 128 || rendition.policy?.receiver_gate_tail_ms !== 0) audioFail('reference_policy_required', 'The basic audio receiver requires the declared 100 ms, 128-voice, zero-tail policy.');
  if (!['listen', 'practice'].includes(mode)) audioFail('invalid_audio_plan', 'Unknown basic-key playback mode.');
  if (mode === 'practice' && !song.runtime.parts?.some(part => part.id === targetPart)) audioFail('clean_target_required', 'Choose one human part.');
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
    if (muted.has(target.part_id) || (solo.size && !solo.has(target.part_id)) || (mode === 'practice' && target.part_id === targetPart)) continue;
    const [start, end] = basicKeyGateFrames(note.start, note.end, sampleRate);
    if (!['melodic_key', 'percussion_selector'].includes(note.role)) audioFail('invalid_audio_plan', 'The native gate has an unknown sound role.');
    notes.push([target.id, `midi:${rendition.source_sha256}:t${note.attack.track}:e${note.attack.event}`, start, end, target.midi, target.velocity, note.role === 'percussion_selector' ? 1 : 0]);
  }
  // Native ordering is retained among equal sample boundaries.
  notes.sort((a, b) => a[2] - b[2]);
  let durationFrames = Math.ceil(rendition.duration_ms * sampleRate / 1000);
  for (const note of notes) durationFrames = Math.max(durationFrames, note[3]);
  return validateBasicKeyAudioPlan({protocol: BASIC_KEY_AUDIO_PROTOCOL, sourceSha256: rendition.source_sha256, policyId: rendition.policy_id, sampleRate, durationFrames, sourceNotes: timeline.length, notes});
}

/** Validate and defensively copy; callers cannot mutate a prepared plan. */
export function validateBasicKeyAudioPlan(input) {
  const limits = BASIC_KEY_AUDIO_LIMITS;
  if (!input || input.protocol !== BASIC_KEY_AUDIO_PROTOCOL || input.policyId !== BASIC_KEY_RENDITION || !/^[a-f0-9]{64}$/.test(input.sourceSha256) || !Array.isArray(input.notes) || input.notes.length > limits.maxNotes || !integer(input.sourceNotes, input.notes.length, limits.maxNotes) || !integer(input.durationFrames, 0, limits.maxFrame)) audioFail('invalid_audio_plan', 'The complete basic audio plan is invalid or exceeds its note bound.');
  const sampleRate = basicKeySampleRate(input.sampleRate), seen = new Set(), events = new Set(), edges = [], notes = [];
  let prior = -1;
  for (const row of input.notes) {
    if (!Array.isArray(row) || row.length !== 7 || !asciiId(row[0]) || !asciiId(row[1]) || !row[1].startsWith(`midi:${input.sourceSha256}:t`) || !/^midi:[a-f0-9]{64}:t[0-9]+:e[0-9]+$/.test(row[1]) || seen.has(row[0]) || events.has(row[1]) || !integer(row[2], 0, input.durationFrames) || !integer(row[3], row[2] + 1, input.durationFrames) || row[2] < prior || !integer(row[4], 0, 127) || !integer(row[5], 1, 127) || !integer(row[6], 0, 1)) audioFail('invalid_audio_plan', 'A source-bound audio gate is invalid, duplicated or out of order.');
    if (row[6] === 0 && 440 * 2 ** ((row[4] - 69) / 12) > sampleRate * 0.45) audioFail('unsupported_audio_sample_rate', 'The audio device cannot represent every retained key without clamping.', {eventId: row[1]});
    const coordinates = /:t([0-9]+):e([0-9]+)$/.exec(row[1]), track = Number(coordinates[1]), event = Number(coordinates[2]);
    if (!integer(track, 0, Number.MAX_SAFE_INTEGER - 1) || !integer(event, 0, Number.MAX_SAFE_INTEGER - 1) || row[0] !== `midi-t${track + 1}-e${event + 1}`) audioFail('invalid_audio_plan', 'The audio note ID does not match its stable source coordinate.');
    seen.add(row[0]); events.add(row[1]); prior = row[2];
    notes.push(Object.freeze([...row])); edges.push([row[2], 1], [row[3], -1]);
  }
  edges.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  let active = 0, maximum = 0;
  for (const [, delta] of edges) { active += delta; maximum = Math.max(maximum, active); }
  if (maximum > limits.maxVoices) audioFail('voice_budget_exceeded', 'The sample-frame gates exceed 128 simultaneous voices; no voice is stolen.', {voices: maximum, maxVoices: limits.maxVoices});
  const plan = {protocol: input.protocol, sourceSha256: input.sourceSha256, policyId: input.policyId, sampleRate, durationFrames: input.durationFrames, sourceNotes: input.sourceNotes, notes: Object.freeze(notes)};
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
