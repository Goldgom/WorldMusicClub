/* Original, bounded reference rendition. No MIDI parsing, notation or grading. */
import { ReferenceAudioReceiver, REFERENCE_PERCUSSION, PROGRAM_FAMILIES } from './midi-reference-synth.js';

const preparedSources = new WeakMap();
const MAX_BYTES = 5 * 1024 * 1024;
const MAX_EVENTS = 250000;
const MAX_SECONDS = 86400;
const UINT64_MAX = 18446744073709551615n;
const freeze = value => {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value;
};
export class MidiReferenceError extends Error {
  constructor(code, message, detail = {}) { super(message); this.name = 'MidiReferenceError'; this.code = code; this.detail = detail; }
}
const fail = (code, message, detail) => { throw new MidiReferenceError(code, message, detail); };
const integer = (n, low, high) => Number.isSafeInteger(n) && n >= low && n <= high;
const eventId = event => `midi:${event.id.source_sha256}:t${event.id.track_index}:e${event.id.event_index}`;
const rational = value => {
  if (!value || !/^(0|[1-9][0-9]{0,19})$/.test(value.numerator) ||
      typeof value.numerator !== 'string' || !integer(value.denominator, 1, 32767)) {
    fail('invalid_exact_clock', 'Expected decimal-string microseconds and a positive PPQ denominator.');
  }
  const numerator = BigInt(value.numerator);
  if (numerator > UINT64_MAX) fail('invalid_exact_clock', 'Microsecond numerator exceeds the Rust contract.');
  return [numerator, BigInt(value.denominator)];
};
const compareTime = (left, right) => {
  const [a, b] = rational(left), [c, d] = rational(right);
  return a * d < c * b ? -1 : a * d > c * b ? 1 : 0;
};
/** Only the final audio-clock boundary uses binary64; source rationals stay intact. */
export function exactMicrosecondsToSeconds(value) {
  const [numerator, denominator] = rational(value);
  const divisor = denominator * 1000000n;
  return Number(numerator / divisor) + Number(numerator % divisor) / Number(divisor);
}

export const REFERENCE_RECEIVER_POLICY = freeze({
  id: 'wmh-original-reference-fifo-v1',
  rendition: 'Original oscillator/noise reference rendition; not the original instruments or kit, and no General MIDI fidelity claim.',
  sameKey: 'Each positive NoteOn creates a separate voice. NoteOff or zero-velocity NoteOn releases the oldest still-held onset on that channel/key (FIFO). Unmatched releases are acknowledged without a voice.',
  programs: 'Zero-based source programs stay unchanged. Programs select one of 16 declared reference families for new melodic voices only. Missing programs use explicit reference program 0. Release velocities are retained but do not alter this reference envelope.',
  percussion: 'Channel index 9 uses the named WMH Reference Percussion v1 map. Programs, including 118, are retained and disclosed but do not identify an original kit. Explicit selection of this reference rendition is required.',
  end: 'Unreleased voices are cut at the global source end. EOT in an individual track does not clear shared channel state. No guessed notation durations are created.',
  timing: 'Source rational microseconds are retained. Conversion to AudioContext binary64 seconds occurs at scheduling. Audio envelopes fit within each receiver gate; no acoustic fidelity or sample-exact physical output is claimed.',
  resume: 'Pause immediately cancels every scheduled and active sound. Resume restarts still-held voices with a fresh reference envelope and their remaining receiver gate, preserving original event identities and source events. Percussion envelopes also restart.',
  mute: 'Whole-track mute is supported only where the track shares no channel with another track. Mute changes require stopped playback. Muted source events remain acknowledged.',
  seek: 'Arbitrary seek is unsupported; stop resets to tick zero.',
  late: 'A missed scheduling deadline stops the whole rendition with a diagnostic; no automatic skipping or catch-up.',
  limits: { sourceBytes: MAX_BYTES, events: MAX_EVENTS, durationSeconds: MAX_SECONDS, maxVoices: 128 },
});

function validateTimeline(timeline, hash) {
  if (!timeline || timeline.source_sha256 !== hash) fail('source_hash_mismatch', 'Live Rust response does not match the complete retained source.');
  if (![0, 1].includes(timeline.format) || !integer(timeline.track_count, 1, 128) ||
      (timeline.format === 0 && timeline.track_count !== 1) || !integer(timeline.ppq, 1, 32767) ||
      !integer(timeline.end_tick, 0, 1000000000) || !Array.isArray(timeline.events) ||
      !timeline.events.length || timeline.events.length > MAX_EVENTS || !Array.isArray(timeline.diagnostics)) {
    fail('invalid_rust_response', 'The live Rust response does not match the bounded raw event contract.');
  }
  const counts = Array(timeline.track_count).fill(0), ended = new Set();
  let prior = null;
  for (const event of timeline.events) {
    const id = event?.id;
    if (!id || id.source_sha256 !== hash || !integer(id.track_index, 0, timeline.track_count - 1) ||
        id.event_index !== counts[id.track_index]++ || ended.has(id.track_index) ||
        !integer(event.tick, 0, timeline.end_tick) || !event.kind || typeof event.kind.kind !== 'string') {
      fail('invalid_event_identity', 'Every event must have contiguous original source coordinates and a bounded tick.');
    }
    if (prior && (event.tick < prior.tick || (event.tick === prior.tick &&
        (id.track_index < prior.id.track_index || (id.track_index === prior.id.track_index && id.event_index < prior.id.event_index))))) {
      fail('event_order_changed', 'Rust tick/track/event order must remain unchanged.');
    }
    if (timeline.relative_clock_available) {
      rational(event.relative_microseconds);
      if (event.relative_microseconds.denominator > timeline.ppq || (prior &&
          (compareTime(prior.relative_microseconds, event.relative_microseconds) > 0 ||
          (prior.tick === event.tick && compareTime(prior.relative_microseconds, event.relative_microseconds) !== 0)))) {
        fail('invalid_exact_clock', 'The retained event clock must be ordered and equal at equal ticks.');
      }
    }
    if (event.kind.kind === 'meta' && event.kind.meta_type === 47) {
      if (!Array.isArray(event.kind.data) || event.kind.data.length) fail('invalid_rust_response', 'EOT must have an empty payload.');
      ended.add(id.track_index);
    }
    prior = event;
  }
  if (ended.size !== timeline.track_count || prior.tick !== timeline.end_tick) fail('incomplete_timeline', 'Every declared track needs its final EOT and the global end tick.');
}

function interpret(timeline) {
  const blockers = [], addBlocker = (code, message, event) => {
    if (!blockers.some(item => item.code === code)) blockers.push({ code, message, ...(event ? { eventId: eventId(event) } : {}) });
  };
  const channels = Array.from({ length: timeline.track_count }, () => new Set());
  const programs = Array(16).fill(0), held = new Map(), voices = [], acknowledgements = [];
  const programUse = new Map();
  let lastChannelTick = new Map();
  if (!timeline.relative_clock_available) addBlocker('clock_unavailable', 'The Rust parser did not produce an unambiguous exact relative clock.');
  for (const diagnostic of timeline.diagnostics) {
    if (['cross_track_channel_order', 'cross_track_tempo_order', 'routing_uninterpreted', 'smpte_offset_uninterpreted'].includes(diagnostic.code)) {
      addBlocker(diagnostic.code, diagnostic.message);
    }
  }
  for (const event of timeline.events) {
    const sourceId = eventId(event), kind = event.kind;
    const ack = { eventId: sourceId, event, disposition: 'metadata' };
    acknowledgements.push(ack);
    if (kind.kind === 'channel') {
      const { channel, message } = kind;
      if (!integer(channel, 0, 15) || !message) fail('invalid_rust_response', 'Invalid MIDI channel message.');
      channels[event.id.track_index].add(channel);
      const last = lastChannelTick.get(channel);
      if (last && last.tick === event.tick && last.id.track_index !== event.id.track_index) {
        addBlocker('cross_track_channel_order', 'Same-channel messages at equal ticks in different tracks have ambiguous hardware order.', event);
      }
      lastChannelTick.set(channel, event);
      if (message.kind === 'program_change') {
        if (!integer(message.program, 0, 127)) fail('invalid_rust_response', 'Invalid program number.');
        programs[channel] = message.program;
        programUse.set(`${channel}:${message.program}`, { channel, program: message.program, reference: channel === 9 ? 'WMH Reference Percussion v1 (kit unknown)' : PROGRAM_FAMILIES[message.program >> 3].name });
        ack.disposition = 'program';
      } else if (message.kind === 'note_on' || message.kind === 'note_off') {
        if (!integer(message.key, 0, 127) || !integer(message.velocity, 0, 127)) fail('invalid_rust_response', 'Invalid note values.');
        const key = `${channel}:${message.key}`;
        let queue = held.get(key);
        if (!queue) { queue = { items: [], released: 0 }; held.set(key, queue); }
        if (message.kind === 'note_on' && message.velocity > 0) {
          const program = programs[channel];
          programUse.set(`${channel}:${program}`, { channel, program, reference: channel === 9 ? 'WMH Reference Percussion v1 (kit unknown)' : PROGRAM_FAMILIES[program >> 3].name });
          if (channel === 9 && !REFERENCE_PERCUSSION[message.key]) addBlocker('percussion_key_unmapped', `No declared reference percussion sound for key ${message.key}.`, event);
          const voice = { eventId: sourceId, trackIndex: event.id.track_index, channel, key: message.key, velocity: message.velocity, program,
            start: event.relative_microseconds, end: null, releaseEventId: null, releaseVelocity: null, endReason: null };
          voices.push(voice); queue.items.push(voice);
          ack.disposition = queue.items.length - queue.released > 1 ? 'layered_onset' : 'onset'; ack.voiceId = sourceId;
        } else {
          const voice = queue.items[queue.released];
          if (voice) queue.released++;
          ack.disposition = voice ? 'release_fifo' : 'unmatched_release';
          if (voice) {
            voice.end = event.relative_microseconds; voice.releaseEventId = sourceId;
            voice.releaseVelocity = message.velocity; voice.endReason = message.kind;
            ack.voiceId = voice.eventId;
          }
        }
      } else {
        ack.disposition = 'blocked'; addBlocker('unsupported_channel_message', `Reference receiver does not interpret ${message.kind}.`, event);
      }
    } else if (kind.kind === 'meta') {
      if (![3, 47].includes(kind.meta_type)) {
        ack.disposition = 'blocked'; addBlocker([32, 33].includes(kind.meta_type) ? 'routing_uninterpreted' : 'unsupported_metadata', `Reference receiver does not interpret meta type ${kind.meta_type}.`, event);
      }
    } else if (!['tempo', 'time_signature'].includes(kind.kind)) {
      ack.disposition = 'blocked'; addBlocker('unsupported_event', `Reference receiver does not interpret ${kind.kind}.`, event);
    }
  }
  const end = timeline.events.at(-1).relative_microseconds;
  for (const voice of voices) if (!voice.end) { voice.end = end; voice.endReason = 'source_end_cleanup'; }
  const durationSeconds = timeline.relative_clock_available ? exactMicrosecondsToSeconds(end) : null;
  if (durationSeconds > MAX_SECONDS) addBlocker('duration_limit', `Reference playback is bounded to ${MAX_SECONDS} seconds.`);
  const tracks = channels.map((ownChannels, trackIndex) => ({ trackIndex, channels: [...ownChannels], independent: !channels.some((other, index) => index !== trackIndex && [...ownChannels].some(channel => other.has(channel))) }));
  return { blockers, voices, acknowledgements, tracks, programs: [...programUse.values()], durationSeconds };
}

/**
 * POSTs a private copy of COMPLETE original bytes to the trusted Rust adapter.
 * request is a trusted application dependency (fetch-compatible), never a user
 * supplied event-JSON adapter. No event-JSON constructor/import is exposed.
 */
export async function loadMidiReference({ originalBytes, expectedSourceSha256, request = globalThis.fetch, crypto = globalThis.crypto } = {}) {
  if (!(originalBytes instanceof Uint8Array) && !(originalBytes instanceof ArrayBuffer)) fail('original_bytes_required', 'Retained complete MIDI bytes are required; event JSON is not authoritative.');
  const bytes = originalBytes instanceof Uint8Array ? new Uint8Array(originalBytes) : new Uint8Array(originalBytes.slice(0));
  if (!bytes.length || bytes.length > MAX_BYTES) fail('source_limit', 'Original MIDI must be nonempty and within 5 MiB.');
  if (!/^[a-f0-9]{64}$/.test(expectedSourceSha256 || '')) fail('expected_hash_required', 'An expected complete-source SHA-256 is required.');
  if (!crypto?.subtle || typeof request !== 'function') fail('live_rust_required', 'SHA-256 and a live trusted Rust request adapter are required.');
  const actual = [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(n => n.toString(16).padStart(2, '0')).join('');
  if (actual !== expectedSourceSha256) fail('source_hash_mismatch', 'Retained original bytes do not match the expected SHA-256.');
  const response = await request('/api/midi/events', { method: 'POST', headers: { 'Content-Type': 'application/octet-stream' }, body: bytes });
  if (!response?.ok) fail('rust_request_failed', `Live Rust MIDI inspection failed (${response?.status ?? 'no response'}).`);
  const timeline = structuredClone(await response.json());
  validateTimeline(timeline, actual);
  const interpretation = interpret(timeline);
  const prepared = freeze({ sourceSha256: actual, eventCount: timeline.events.length, trackCount: timeline.track_count,
    policy: REFERENCE_RECEIVER_POLICY, playable: !interpretation.blockers.length, ...interpretation, timeline });
  preparedSources.set(prepared, prepared);
  return prepared;
}

/** No context is created before play({userGesture:true, acceptedPolicyId}). */
export function createMidiReferencePlayer(prepared, {
  contextFactory,
  timers = { setTimeout: (callback, delay) => globalThis.setTimeout(callback, delay), clearTimeout: id => globalThis.clearTimeout(id) },
  onEvent = () => {}, onState = () => {}, maxVoices = 128,
  lookaheadSeconds = 0.15, pollMilliseconds = 20, startLeadSeconds = 0.05,
} = {}) {
  if (!preparedSources.has(prepared)) fail('live_rust_required', 'Use the opaque result of loadMidiReference, not saved or edited event JSON.');
  if (!prepared.playable) fail('playback_blocked', 'Reference rendition has unresolved source semantics.', { blockers: prepared.blockers });
  if (typeof contextFactory !== 'function') fail('context_factory_required', 'Supply a user-gesture context/output factory.');
  if (!integer(maxVoices, 1, 128) || !Number.isFinite(lookaheadSeconds) || lookaheadSeconds <= 0 || lookaheadSeconds > 1 ||
      !Number.isFinite(pollMilliseconds) || pollMilliseconds < 1 || pollMilliseconds / 1000 >= lookaheadSeconds ||
      !Number.isFinite(startLeadSeconds) || startLeadSeconds <= 0 || startLeadSeconds > lookaheadSeconds) fail('invalid_scheduler_options', 'Invalid bounded scheduler options.');
  const events = prepared.acknowledgements.map(ack => ({ ack, seconds: exactMicrosecondsToSeconds(ack.event.relative_microseconds) }));
  const voices = prepared.voices.map(voice => ({ ...voice, startSeconds: exactMicrosecondsToSeconds(voice.start), endSeconds: exactMicrosecondsToSeconds(voice.end) }));
  const voiceById = new Map(voices.map(voice => [voice.eventId, voice]));
  let state = 'stopped', generation = 0, position = 0, anchor = 0, cursor = 0, timer = null, context = null, receiver = null, error = null;
  const muted = new Set();
  const snapshot = () => Object.freeze({ state, generation, currentAudioTimeSeconds: context?.currentTime ?? null, audioAnchorSeconds: state === 'playing' ? anchor : null, waitingForLead: state === 'playing' && context.currentTime < anchor + position, positionSeconds: state === 'playing' ? Math.max(position, Math.min(prepared.durationSeconds, context.currentTime - anchor)) : position, error, mutedTracks: Object.freeze([...muted]) });
  const notify = () => onState(snapshot());
  const cancel = () => {
    generation++;
    if (timer !== null) timers.clearTimeout(timer);
    timer = null;
    receiver?.silence();
  };
  const abort = reason => {
    position = snapshot().positionSeconds;
    cancel(); error = reason instanceof MidiReferenceError ? reason : new MidiReferenceError('audio_failure', String(reason?.message || reason));
    state = 'error'; notify();
  };
  const sound = (voice, start, resumed = false) => {
    if (muted.has(voice.trackIndex)) return;
    if (voice.endSeconds <= voice.startSeconds) return; // acknowledged zero-length receiver gate
    receiver.schedule(voice, start, anchor + voice.endSeconds, { resumed });
  };
  const pump = token => {
    if (token !== generation || state !== 'playing') return;
    timer = null;
    try {
      if (context.state !== 'running') fail('audio_context_interrupted', 'Audio context stopped running. Restart from a user gesture.');
      const now = context.currentTime, horizon = now + lookaheadSeconds;
      receiver.prune(now);
      while (cursor < events.length && anchor + events[cursor].seconds <= horizon) {
        const { ack, seconds } = events[cursor], at = anchor + seconds;
        const observedNow = context.currentTime;
        if (at < observedNow) fail('late_scheduler', 'An event missed its audio scheduling deadline; playback stopped without catch-up.', { eventId: ack.eventId, lateSeconds: observedNow - at });
        if (ack.disposition === 'onset' || ack.disposition === 'layered_onset') sound(voiceById.get(ack.voiceId), at);
        cursor++;
        onEvent(Object.freeze({ eventId: ack.eventId, sourceTick: ack.event.tick, sourceTrackIndex: ack.event.id.track_index, sourceRelativeMicroseconds: ack.event.relative_microseconds, disposition: ack.disposition, muted: muted.has(ack.event.id.track_index), scheduledAudioTime: at, generation: token }));
        if (token !== generation || state !== 'playing') return;
      }
      if (context.currentTime >= anchor + prepared.durationSeconds && cursor === events.length) {
        position = prepared.durationSeconds; cancel(); state = 'ended'; notify(); return;
      }
      timer = timers.setTimeout(() => pump(token), pollMilliseconds);
    } catch (reason) { if (token === generation) abort(reason); }
  };
  return Object.freeze({
    policy: prepared.policy,
    snapshot,
    async play({ userGesture = false, acceptedPolicyId } = {}) {
      if (state === 'playing' || state === 'starting') return snapshot();
      if (!userGesture) fail('user_gesture_required', 'Start or resume only from a caller-provided user gesture.');
      if (acceptedPolicyId !== prepared.policy.id) fail('reference_policy_required', 'Disclose and select the named reference rendition before playback.');
      if (state === 'error') fail('stop_required', 'Stop to reset after a playback error.');
      if (state === 'ended') position = 0;
      const token = ++generation;
      state = 'starting'; error = null;
      try {
        // Call synchronously in the gesture stack; a factory may itself resume.
        const result = contextFactory();
        const audio = result && typeof result.then === 'function' ? await result : result;
        if (token !== generation) return snapshot();
        if (!audio?.context || !audio.output || audio.output.context !== audio.context) fail('invalid_audio_output', 'Expected a context and an output node belonging to that context.');
        context = audio.context;
        if (context.state !== 'running') await context.resume();
        if (token !== generation) return snapshot();
        if (context.state !== 'running') fail('audio_context_interrupted', 'Audio context could not start.');
        receiver = new ReferenceAudioReceiver(context, audio.output, { maxVoices, ErrorType: MidiReferenceError });
        anchor = context.currentTime + startLeadSeconds - position;
        cursor = events.findIndex(event => event.seconds >= position);
        if (cursor < 0) cursor = events.length;
        for (const voice of voices) if (voice.startSeconds < position && voice.endSeconds > position) sound(voice, anchor + position, true);
        state = 'playing'; notify();
        if (token === generation && state === 'playing') pump(token);
      } catch (reason) { if (token === generation) abort(reason); }
      return snapshot();
    },
    pause() {
      if (!['playing', 'starting'].includes(state)) return snapshot();
      position = snapshot().positionSeconds; cancel(); state = 'paused'; notify(); return snapshot();
    },
    stop() {
      cancel(); position = 0; cursor = 0; error = null; state = 'stopped'; notify(); return snapshot();
    },
    setTrackMuted(trackIndex, isMuted) {
      if (state !== 'stopped') fail('stop_required', 'Stop before changing the track mute selection.');
      const track = prepared.tracks[trackIndex];
      if (!integer(trackIndex, 0, prepared.trackCount - 1) || typeof isMuted !== 'boolean') fail('invalid_track', 'Use a declared track index and boolean mute value.');
      if (!track.independent) fail('shared_channel_mute_unsupported', 'This track shares channel state with another track and cannot be muted independently.', { trackIndex, channels: track.channels });
      if (isMuted) muted.add(trackIndex); else muted.delete(trackIndex);
      notify(); return snapshot();
    },
    seek() { fail('seek_unsupported', 'Arbitrary seek is unsupported. Stop resets to tick zero.'); },
  });
}
