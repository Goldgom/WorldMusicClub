import {InputEvidence, INPUT_EVIDENCE_LIMIT} from './input-evidence.js';
import {validateKeyboardConfiguration} from './keyboard-input.js';

/** Score-independent, receipt-ordered observations. This is not an assessment. */
export const FREE_RECORD_FORMAT = 'worldmusichub-free-performance';
export const FREE_INPUT_KINDS = Object.freeze(['midi', 'typing_keyboard', 'pointer', 'accessible_keyboard', 'on_screen_pointer', 'on_screen_keyboard']);
export const FREE_RECORD_SCOPE = 'observed input between explicit free-practice start and stop; paused observations are retained as unassigned';
export const FREE_CLOSURE_POLICY = 'Stop seals an immutable snapshot; later callbacks are rejected, not silently appended.';
export const FREE_RECORD_LIMITS = Object.freeze({events:INPUT_EVIDENCE_LIMIT, segments:1000, configurations:1000, configurationBytes:512*1024, observationBytes:15*1024*1024});
const KINDS = new Set(FREE_INPUT_KINDS);
const clone = value => structuredClone(value);
const freeze = value => { if (value && typeof value === 'object' && !Object.isFrozen(value)) { for (const child of Object.values(value)) freeze(child); Object.freeze(value); } return value; };
const failure = code => Object.assign(new Error(code), {code});
const finite = value => Number.isFinite(value) && value >= 0 && value <= Number.MAX_SAFE_INTEGER;
const validTime = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;
/** Complete archive validation adds strict JSON shape to the shared physical-key validator. */
export function validateFreeKeyboardConfiguration(value) {
  const bad = () => { throw failure('free.invalid_configuration'); };
  const object = (input, keys) => {
    if (!input || typeof input !== 'object' || ![null,Object.prototype].includes(Object.getPrototypeOf(input))) bad();
    const names = Reflect.ownKeys(input);
    if (names.length !== keys.length || names.some(key => !keys.includes(key))) bad();
    for (const key of names) { const descriptor = Object.getOwnPropertyDescriptor(input,key); if (!descriptor.enumerable || !Object.hasOwn(descriptor,'value')) bad(); }
  };
  object(value,['configuration_id','base_midi','transpose_semitones','duplicate_pitch_policy','mapping']);
  if (!Number.isSafeInteger(value.configuration_id) || value.configuration_id < 1 || !Number.isInteger(value.base_midi) || value.base_midi < 0 || value.base_midi > 127 || !Number.isInteger(value.transpose_semitones) || value.transpose_semitones < -127 || value.transpose_semitones > 127 || !['reject','explicit_aliases'].includes(value.duplicate_pitch_policy)) bad();
  const mapping = value.mapping;
  if (!Array.isArray(mapping) || Object.getPrototypeOf(mapping) !== Array.prototype || mapping.length < 1 || mapping.length > 128 || Reflect.ownKeys(mapping).length !== mapping.length + 1) bad();
  for (let i = 0; i < mapping.length; i++) {
    const descriptor = Object.getOwnPropertyDescriptor(mapping,String(i));
    if (!descriptor?.enumerable || !Object.hasOwn(descriptor,'value')) bad();
    object(descriptor.value,['code','offset','label','row']);
    if (typeof descriptor.value.label !== 'string' || typeof descriptor.value.row !== 'string') bad();
  }
  try { validateKeyboardConfiguration({mapping,baseMidi:value.base_midi,transpose:value.transpose_semitones,allowDuplicatePitches:value.duplicate_pitch_policy === 'explicit_aliases'}); }
  catch { bad(); }
  return true;
}
const keyboardConfigurationText = value => JSON.stringify([value.configuration_id,value.base_midi,value.transpose_semitones,value.duplicate_pitch_policy,value.mapping.map(binding => [binding.code,binding.offset,binding.label,binding.row])]);
const SETTINGS = Object.freeze({
  keyboard_configuration: validateFreeKeyboardConfiguration,
  sound: value => typeof value === 'boolean',
  instrument: value => ['piano', 'guitar'].includes(value),
  keyboard_base_midi: value => Number.isInteger(value) && value >= 0 && value <= 127,
  keyboard_octave_shift: value => Number.isInteger(value) && value >= -10 && value <= 10,
  keyboard_semitone_transpose: value => Number.isInteger(value) && value >= -127 && value <= 127,
});

const encoder = new TextEncoder();
/** One entry plus a conservative comma byte; the journal starts with two brackets. */
export const freeConfigurationStorageBytes = entry => encoder.encode(JSON.stringify(entry)).byteLength + 1;
/** Conservative per-event envelope accounting, including a newly introduced source mapping. */
export function freeObservationStorageBytes(event, sourceIsNew) {
  const projected = {...event, segment_id:1000, routing:'outside_recording_segment'};
  return encoder.encode(JSON.stringify(projected)).byteLength + 1 + (sourceIsNew
    ? encoder.encode(JSON.stringify({id:event.source_id,generation:event.source_generation,input_kind:event.input_kind})).byteLength + 1 : 0);
}
class FreeInputEvidence extends InputEvidence {
  constructor(options, origin) { super(options); this.origin = origin; this.retainedBytes = 0; this.omissionReason = null; }
  append(input) {
    if (!this.enabled || !Number.isFinite(input.eventWall) || !Number.isFinite(input.receivedWall ?? input.eventWall)) return null;
    if (this.events.length >= this.limit) { this.omissionReason ||= 'event_limit'; return super.append(input); }
    const {kind,source = null,generationToken = null,inputKind = null,channel = null,midi = null,velocity = null,encoding = null,reason = null,eventWall,receivedWall = eventWall,timestampBasis = 'application_clock',rawTimestamp = null,boundaryWall = null} = input;
    const generation = generationToken === null ? null : this.generations.get(generationToken) ?? `generation-${this.generations.size + 1}`;
    const identity = source === null ? null : this.sources.get(`${generation ?? 'local'}:${source}`);
    const sourceId = source === null ? null : identity?.id ?? `source-${this.sources.size + 1}`;
    const resolvedKind = inputKind ?? identity?.inputKind ?? null;
    if (identity && resolvedKind !== identity.inputKind) throw failure('free.invalid_observation');
    const projected = {event_id:this.events.length + 1,kind,source_id:sourceId,source_generation:generation,
      input_kind:resolvedKind,channel:channel ?? identity?.channel ?? null,midi,velocity,encoding,reason,
      event_wall_ms:eventWall,received_wall_ms:receivedWall,timestamp_basis:timestampBasis,
      raw_timestamp_ms:Number.isFinite(rawTimestamp) ? rawTimestamp : null,boundary_wall_ms:boundaryWall,onset_capture:null,
      event_ms:eventWall-this.origin(),received_ms:receivedWall-this.origin(),
      velocity_provenance:resolvedKind === 'midi' ? 'midi_message' : velocity === null ? null : 'ui_default'};
    const cost = freeObservationStorageBytes(projected,sourceId !== null && !identity);
    if (this.omissionReason === 'byte_limit' || this.retainedBytes + cost > FREE_RECORD_LIMITS.observationBytes) {
      this.omissionReason ||= 'byte_limit'; this.omitted++;
      if (this.firstOmitted === null) { this.firstOmitted = receivedWall; this.onLimit(); }
      return null;
    }
    const result = super.append(input);
    if (result) this.retainedBytes += cost;
    return result;
  }
  exportData() {
    return {...super.exportData(),byte_limit:FREE_RECORD_LIMITS.observationBytes,
      estimated_retained_bytes:this.retainedBytes,omission_reason:this.omissionReason};
  }
}

export class FreePracticeRecorder {
  constructor({id, createdAt, evidenceLimit = INPUT_EVIDENCE_LIMIT, onLimit = () => {}} = {}) {
    if (typeof id !== 'string' || !/^[A-Za-z0-9_-]{1,80}$/.test(id) || !validTime(createdAt)) throw failure('free.invalid_identity');
    this.id = id; this.createdAt = createdAt; this.state = 'idle'; this.origin = null;
    this.lastBoundary = null; this.lastReceipt = null; this.stoppedWall = null; this.segments = []; this.configuration = [];
    this.configurationBytes = 2; this.keyboardConfiguration = null; this.keyboardConfigurationBlocked = false;
    this.evidence = new FreeInputEvidence({limit:evidenceLimit, onLimit}, () => this.origin); this.sealed = null;
  }
  boundaryTime(wallTime) {
    if (!finite(wallTime) || (this.lastBoundary !== null && wallTime < this.lastBoundary) || (this.lastReceipt !== null && wallTime < this.lastReceipt)) throw failure('free.invalid_clock');
    return wallTime;
  }
  start(wallTime) {
    if (this.state !== 'idle') throw failure('free.already_started');
    this.origin = this.boundaryTime(wallTime); this.lastBoundary = wallTime; this.lastReceipt = wallTime;
    this.evidence.start(); this.state = 'recording';
    this.segments.push({id:1, start_wall_ms:wallTime, end_wall_ms:null});
    this.evidence.append({kind:'boundary', reason:'free_start', eventWall:wallTime});
  }
  pause(wallTime, reason = 'pause') {
    if (this.state !== 'recording') return false;
    this.boundaryTime(wallTime); this.cleanup(wallTime, reason);
    this.segments.at(-1).end_wall_ms = wallTime; this.lastBoundary = wallTime; this.state = 'paused';
    return true;
  }
  resume(wallTime) {
    if (this.state !== 'paused') return false;
    if (this.keyboardConfigurationBlocked) throw failure('free.keyboard_configuration_required');
    if (this.segments.length >= FREE_RECORD_LIMITS.segments) throw failure('free.segment_limit');
    this.boundaryTime(wallTime); this.cleanup(wallTime, 'free_resume'); this.lastBoundary = wallTime;
    this.segments.push({id:this.segments.length + 1, start_wall_ms:wallTime, end_wall_ms:null});
    this.state = 'recording';
    return true;
  }
  cleanup(wallTime, reason = 'input_cleanup', selector = {}) {
    if (!['recording', 'paused'].includes(this.state)) return false;
    this.boundaryTime(wallTime);
    if (typeof reason !== 'string' || !/^[a-z][a-z0-9_]{0,63}$/.test(reason)) throw failure('free.invalid_reason');
    // InputEvidence cancellation owns source/generation groups, not MIDI channel
    // filters. Reject an unsupported selector instead of clearing unrelated notes.
    if (!selector || typeof selector !== 'object' || Array.isArray(selector) || Object.keys(selector).some(key => !['source','prefix','generationToken','notAfterEventWall'].includes(key))) throw failure('free.invalid_cleanup_scope');
    const {source = null, prefix = null, generationToken = null, notAfterEventWall = null} = selector;
    if (notAfterEventWall !== null && (!finite(notAfterEventWall) || notAfterEventWall > wallTime)) throw failure('free.invalid_cleanup_scope');
    if ([source,prefix].some(value => value !== null && (typeof value !== 'string' || !value.length || value.length > 512))) throw failure('free.invalid_cleanup_scope');
    this.evidence.cancel({source, prefix, generationToken, notAfterEventWall, reason,
      eventWall:wallTime, receivedWall:wallTime, boundaryWall:wallTime});
    this.lastBoundary = wallTime; this.lastReceipt = wallTime;
    return true;
  }
  configure(key, value, wallTime) {
    if (!['recording', 'paused'].includes(this.state)) throw failure('free.not_active');
    try { this.boundaryTime(wallTime); }
    catch (error) {
      // A bad clock cannot justify an invented pause boundary. Still prevent
      // PC admission until the controller supplies a valid archive/clock.
      if (key === 'keyboard_configuration') this.keyboardConfigurationBlocked = true;
      throw error;
    }
    let entry, cost;
    try {
      if (!Object.hasOwn(SETTINGS, key) || !SETTINGS[key](value)) throw failure('free.invalid_configuration');
      if (key === 'keyboard_configuration' && this.keyboardConfiguration) {
        if (keyboardConfigurationText(value) === keyboardConfigurationText(this.keyboardConfiguration)) { this.keyboardConfigurationBlocked = false; return false; }
        if (value.configuration_id <= this.keyboardConfiguration.configuration_id) throw failure('free.invalid_configuration');
      }
      if (this.configuration.length >= FREE_RECORD_LIMITS.configurations) throw failure('free.configuration_limit');
      entry = freeze({sequence:this.configuration.length + 1, wall_ms:wallTime, key, value:clone(value)});
      cost = freeConfigurationStorageBytes(entry);
      if (this.configurationBytes + cost > FREE_RECORD_LIMITS.configurationBytes) throw failure('free.configuration_byte_limit');
    } catch (error) {
      if (key === 'keyboard_configuration') {
        // The input adapter may already have applied its new map. Until its full
        // archive is accepted, no new PC input can be truthfully associated.
        this.keyboardConfigurationBlocked = true;
        if (this.state === 'recording') this.pause(wallTime,'keyboard_configuration_rejected');
      }
      throw error;
    }
    this.cleanup(wallTime, 'configuration_change');
    this.configuration.push(entry); this.configurationBytes += cost;
    if (key === 'keyboard_configuration') { this.keyboardConfiguration = entry.value; this.keyboardConfigurationBlocked = false; }
    this.lastBoundary = wallTime;
    return true;
  }
  observe(kind, observation) {
    if (!['recording', 'paused'].includes(this.state)) return {accepted:false, reason:'free.not_active'};
    if (!['note_on', 'note_off'].includes(kind)) throw failure('free.invalid_observation');
    if (this.keyboardConfigurationBlocked && observation?.inputKind === 'typing_keyboard') return {accepted:false, reason:'free.keyboard_configuration_required'};
    const {source, generationToken = null, inputKind, channel = null, midi = null, velocity = null,
      encoding = null, eventWall, receivedWall = eventWall, timestampBasis = 'application_clock', rawTimestamp = null} = observation || {};
    if (typeof source !== 'string' || source.length > 512 || !source.length || !KINDS.has(inputKind)
      || (channel !== null && (!Number.isInteger(channel) || channel < 0 || channel > 15))
      || (midi !== null && (!Number.isInteger(midi) || midi < 0 || midi > 127))
      || (kind === 'note_on' && midi === null)
      || (velocity !== null && (!Number.isInteger(velocity) || velocity < 0 || velocity > 127))
      || !finite(eventWall) || !finite(receivedWall) || eventWall > receivedWall || receivedWall < this.lastReceipt
      || (rawTimestamp !== null && (!Number.isFinite(rawTimestamp) || Math.abs(rawTimestamp) > Number.MAX_SAFE_INTEGER))
      || (encoding !== null && (typeof encoding !== 'string' || encoding.length > 64))
      || !['application_clock','event_monotonic','event_epoch','event_clamped','receipt_fallback'].includes(timestampBasis)) throw failure('free.invalid_observation');
    const generation = generationToken === null ? null : this.evidence.generations.get(generationToken);
    const known = this.evidence.sources.get(`${generation ?? 'local'}:${source}`);
    if ((generationToken === null || generation !== undefined) && known && known.inputKind !== inputKind) throw failure('free.invalid_observation');
    const event = {source, generationToken, inputKind, channel, midi, velocity, encoding,
      eventWall, receivedWall, timestampBasis, rawTimestamp};
    this.lastReceipt = receivedWall;
    const retained = kind === 'note_on' ? this.evidence.append({...event, kind}) : this.evidence.release(event);
    return retained ? {accepted:true, eventId:retained.event_id} : {accepted:false, reason:this.evidence.omitted ? 'free.observation_limit' : 'free.unowned_release'};
  }
  stop(wallTime, stoppedAt) {
    if (this.sealed) return clone(this.sealed);
    if (!['recording', 'paused'].includes(this.state) || !validTime(stoppedAt) || Date.parse(stoppedAt) < Date.parse(this.createdAt)) throw failure('free.invalid_stop');
    this.boundaryTime(wallTime); this.cleanup(wallTime, 'free_stop');
    if (this.state === 'recording') this.segments.at(-1).end_wall_ms = wallTime;
    this.lastBoundary = wallTime; this.stoppedWall = wallTime; this.state = 'stopped'; this.evidence.enabled = false;
    this.sealed = freeze(this.snapshot(stoppedAt));
    return clone(this.sealed);
  }
  snapshot(stoppedAt = null) {
    if (this.sealed) return clone(this.sealed);
    const observations = this.evidence.exportData();
    const sources = new Map();
    const events = observations.events.map(event => {
      if (event.source_id !== null && !sources.has(event.source_id)) sources.set(event.source_id, {id:event.source_id,generation:event.source_generation,input_kind:event.input_kind});
      const segment = this.segments.find(segment => event.event_wall_ms >= segment.start_wall_ms && (segment.end_wall_ms === null || event.event_wall_ms < segment.end_wall_ms));
      return {...event, event_ms:this.origin === null ? null : event.event_wall_ms - this.origin,
        received_ms:this.origin === null ? null : event.received_wall_ms - this.origin,
        segment_id:segment?.id ?? null,
        routing:segment ? 'recording_segment' : event.event_wall_ms < this.origin ? 'before_start' : 'outside_recording_segment',
        velocity_provenance:event.input_kind === 'midi' ? 'midi_message' : event.velocity === null ? null : 'ui_default'};
    });
    return clone({format:FREE_RECORD_FORMAT, version:1, id:this.id, revision:1, mode:'free', created_at:this.createdAt,
      stopped_at:stoppedAt, state:this.state, score_context:null,
      clock:{domain_id:`free:${this.id}`, unit:'ms', origin_monotonic_ms:this.origin, stopped_monotonic_ms:this.stoppedWall, basis:'page_monotonic', gap_policy:'preserved'},
      segments:this.segments, configuration:this.configuration,
      observations:{...observations, scope:FREE_RECORD_SCOPE, sources:[...sources.values()], events},
      capabilities:{assessment:false, audio_capture:false, release_pairing:false, duration_inference:false, physical_fingering:false},
      closure:{late_delivery_grace_ms:0, policy:FREE_CLOSURE_POLICY}});
  }
}
