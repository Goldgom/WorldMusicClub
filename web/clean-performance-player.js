/* Additive clean JSON reference rendition. No MIDI parser, notation or grading. */
import { ReferenceAudioReceiver, REFERENCE_PERCUSSION, PROGRAM_FAMILIES } from './midi-reference-synth.js';
import { REFERENCE_RECEIVER_POLICY } from './midi-reference-player.js';
const handles = new WeakSet();
const PROFILE = 'wmh-performance-midi1-v1';
const integer = (n, lo, hi) => Number.isSafeInteger(n) && n >= lo && n <= hi;
const freeze = value => {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) { Object.values(value).forEach(freeze); Object.freeze(value); }
  return value;
};
export class CleanPerformanceError extends Error {
  constructor(code, message, detail = {}) { super(message); this.name = 'CleanPerformanceError'; this.code = code; this.detail = detail; }
}
const fail = (code, message, detail) => { throw new CleanPerformanceError(code, message, detail); };
const rational = value => {
  if (typeof value?.numerator !== 'string' || !/^(0|[1-9][0-9]{0,19})$/.test(value.numerator) ||
      !integer(value.denominator, 1, 1000000) || BigInt(value.numerator) > 18446744073709551615n) fail('invalid_clock', 'Expected bounded exact rational microseconds.');
  return [BigInt(value.numerator), BigInt(value.denominator)];
};
const compare = (a, b) => {
  const [an, ad] = rational(a), [bn, bd] = rational(b);
  return an * bd < bn * ad ? -1 : an * bd > bn * ad ? 1 : 0;
};
export function performanceSeconds(value) {
  const [n, d] = rational(value), denominator = d * 1000000n;
  return Number(n / denominator) + Number(n % denominator) / Number(denominator);
}
const metadataKinds = new Set(['tempo', 'meter', 'key_signature', 'text', 'sequence_number', 'track_end']);
const unsupportedReceiverKinds = new Set(['bank_select', 'volume', 'pan', 'expression', 'reverb_send', 'chorus_send', 'key_pressure', 'channel_pressure']);
function prepare(runtime, scoreHash) {
  if (runtime?.profile !== PROFILE || runtime.score_sha256 !== scoreHash || !/^[a-f0-9]{64}$/.test(runtime.source_sha256 || '') ||
      !Array.isArray(runtime.tracks) || !integer(runtime.tracks.length, 1, 128) || !Array.isArray(runtime.parts) ||
      !Array.isArray(runtime.events) || !integer(runtime.events.length, 1, 250000)) fail('invalid_compiler_response', 'Expected the authoritative hash-bound complete-performance runtime.');
  const coverage = runtime.coverage;
  if (coverage?.performance?.status !== 'complete' || coverage.performance.source_tracks !== runtime.tracks.length ||
      coverage.performance.source_events !== runtime.events.length || coverage.performance.represented_events !== runtime.events.length ||
      coverage.notation?.status !== 'unavailable' || coverage.notation.represented_attacks !== 0 ||
      coverage.targets?.status !== 'unavailable' || coverage.targets.represented_attacks !== 0) fail('invalid_coverage', 'This prototype supports complete performance data and no claimed notation or practice targets.');
  const channels = Array.from({ length: runtime.tracks.length }, () => new Set()), parts = new Map();
  runtime.tracks.forEach((track, index) => {
    if (track.source_index !== index || track.id !== `track-${index + 1}` || !integer(track.source_event_count, 1, 250000)) fail('invalid_track', 'Invalid source-track identity.');
  });
  for (const part of runtime.parts) {
    const track = runtime.tracks.findIndex(t => t.id === part.track_id);
    if (track < 0 || !integer(part.channel, 0, 15) || part.id !== `midi-t${track + 1}-c${part.channel + 1}` ||
        parts.has(part.id) || part.sound_identity !== 'unspecified_midi_route') fail('invalid_part', 'Invalid route identity.');
    channels[track].add(part.channel); parts.set(part.id, part);
  }
  const blockers = [], addBlocker = (code, message, event) => {
    if (!blockers.some(b => b.code === code)) blockers.push({ code, message, eventId: event.event_id });
  };
  // These voices are only the explicitly selected reference receiver's FIFO
  // gates. Neither pairing nor gate lengths are added to canonical commands.
  const voices = [], acknowledgements = [], queues = new Map(), programs = Array(16).fill(0), programUse = new Map();
  const counts = Array(runtime.tracks.length).fill(0), ended = new Set();
  let prior = null, attacks = 0, releases = 0;
  for (const event of runtime.events) {
    const origin = event.origin, c = event.command;
    if (!origin || !integer(origin.track, 0, runtime.tracks.length - 1) || origin.event !== counts[origin.track]++ ||
        ended.has(origin.track) || event.event_id !== `midi:${runtime.source_sha256}:t${origin.track}:e${origin.event}` || !c) fail('invalid_event', 'Original event coordinates must be contiguous and unique.');
    rational(event.exact_microseconds);
    if (prior && (compare(prior.exact_microseconds, event.exact_microseconds) > 0 ||
        (compare(prior.exact_microseconds, event.exact_microseconds) === 0 &&
        (prior.origin.track > origin.track || (prior.origin.track === origin.track && prior.origin.event >= origin.event))))) fail('invalid_event_order', 'Exact runtime order changed.');
    prior = event;
    const ack = { eventId: event.event_id, event, disposition: 'metadata' }; acknowledgements.push(ack);
    if (c.channel !== undefined && (!integer(c.channel, 0, 15) || !channels[origin.track].has(c.channel))) fail('invalid_channel', 'Channel command is missing its source route.');
    if (c.kind === 'key_attack' || c.kind === 'key_release') {
      const part = parts.get(c.part_id);
      if (!part || part.track_id !== runtime.tracks[origin.track].id || part.channel !== c.channel ||
          !integer(c.key, 0, 127) || !integer(c.velocity, c.kind === 'key_attack' ? 1 : 0, 127)) fail('invalid_key', 'Invalid independent key semantics.');
      const key = `${c.channel}:${c.key}`;
      if (!queues.has(key)) queues.set(key, { items: [], released: 0 });
      const queue = queues.get(key);
      if (c.kind === 'key_attack') {
        attacks++;
        if (c.channel === 9 && !REFERENCE_PERCUSSION[c.key]) addBlocker('percussion_key_unmapped', `No declared reference percussion sound for key ${c.key}.`, event);
        const program = programs[c.channel];
        programUse.set(`${c.channel}:${program}`, { channel: c.channel, program, reference: c.channel === 9 ? 'WMH Reference Percussion v1 (kit unknown)' : PROGRAM_FAMILIES[program >> 3].name });
        const voice = { eventId: event.event_id, partId: c.part_id, trackIndex: origin.track, channel: c.channel, key: c.key,
          velocity: c.velocity, program, start: event.exact_microseconds, end: null, releaseEventId: null, releaseVelocity: null, endReason: null };
        voices.push(voice); queue.items.push(voice);
        ack.disposition = queue.items.length - queue.released > 1 ? 'layered_onset' : 'onset'; ack.voiceId = voice.eventId;
      } else {
        releases++;
        const voice = queue.items[queue.released];
        if (voice) {
          queue.released++; voice.end = event.exact_microseconds; voice.releaseEventId = event.event_id;
          voice.releaseVelocity = c.velocity; voice.endReason = 'key_release'; ack.voiceId = voice.eventId;
        }
        ack.disposition = voice ? 'release_fifo' : 'unmatched_release';
      }
    } else if (c.kind === 'instrument_program') {
      if (!integer(c.channel, 0, 15) || !integer(c.program, 0, 127)) fail('invalid_program', 'Invalid source program number.');
      programs[c.channel] = c.program;
      programUse.set(`${c.channel}:${c.program}`, { channel: c.channel, program: c.program, reference: c.channel === 9 ? 'WMH Reference Percussion v1 (kit unknown)' : PROGRAM_FAMILIES[c.program >> 3].name });
      ack.disposition = 'program';
    } else if (unsupportedReceiverKinds.has(c.kind)) {
      ack.disposition = 'blocked'; addBlocker(`unsupported_${c.kind}`, `This reference receiver cannot apply ${c.kind}; complete data remains preserved.`, event);
    } else if (!metadataKinds.has(c.kind)) fail('unknown_semantics', 'Unknown runtime command cannot be ignored.');
    if (c.kind === 'track_end') ended.add(origin.track);
  }
  if (ended.size !== runtime.tracks.length || counts.some((count, index) => count !== runtime.tracks[index].source_event_count) ||
      attacks !== coverage.performance.key_attacks || releases !== coverage.performance.key_releases ||
      compare(runtime.duration_microseconds, prior.exact_microseconds) !== 0) fail('incomplete_runtime', 'Runtime does not cover every source event and track end.');
  for (const voice of voices) if (!voice.end) { voice.end = runtime.duration_microseconds; voice.endReason = 'source_end_cleanup'; }
  const durationSeconds = performanceSeconds(runtime.duration_microseconds);
  if (durationSeconds > 86400) fail('duration_limit', 'Reference playback is bounded to 24 hours.');
  const tracks = runtime.tracks.map((track, index) => ({ ...track, channels: [...channels[index]],
    independent: !channels.some((other, i) => i !== index && [...channels[index]].some(c => other.has(c))) }));
  return freeze({ scoreSha256: scoreHash, sourceSha256: runtime.source_sha256, policy: REFERENCE_RECEIVER_POLICY,
    playable: blockers.length === 0, blockers, trackCount: tracks.length, eventCount: runtime.events.length,
    tracks, voices, acknowledgements, programs: [...programUse.values()], durationSeconds, runtime });
}
/** compile is a trusted Rust/native adapter: clean bytes in, validated runtime out.
 * The native clean-package load compiles exact saved bytes. Derived runtime
 * JSON is never accepted as an authoritative saved song.
 */
export async function loadCleanPerformance({ scoreBytes, expectedScoreSha256, compile, crypto = globalThis.crypto } = {}) {
  if (!(scoreBytes instanceof Uint8Array) && !(scoreBytes instanceof ArrayBuffer)) fail('score_bytes_required', 'Complete clean score JSON bytes are required.');
  const bytes = scoreBytes instanceof Uint8Array ? new Uint8Array(scoreBytes) : new Uint8Array(scoreBytes.slice(0));
  if (!bytes.length || bytes.length > 16 * 1024 * 1024) fail('score_limit', 'Clean score JSON exceeds the 16 MiB bound.');
  if (!/^[a-f0-9]{64}$/.test(expectedScoreSha256 || '') || !crypto?.subtle || typeof compile !== 'function') fail('trusted_compiler_required', 'Expected score hash and trusted Rust adapter are required.');
  const hash = [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(n => n.toString(16).padStart(2, '0')).join('');
  if (hash !== expectedScoreSha256) fail('score_hash_mismatch', 'Clean score bytes do not match the package hash.');
  const result = prepare(structuredClone(await compile(bytes)), hash); handles.add(result); return result;
}
export function createCleanPerformancePlayer(prepared, {
  contextFactory, timers = { setTimeout: (fn, delay) => globalThis.setTimeout(fn, delay), clearTimeout: id => globalThis.clearTimeout(id) },
  onEvent = () => {}, onState = () => {}, maxVoices = 128,
  lookaheadSeconds = 0.15, pollMilliseconds = 20, startLeadSeconds = 0.05,
} = {}) {
  if (!handles.has(prepared)) fail('trusted_compiler_required', 'Use the opaque result of loadCleanPerformance.');
  if (!prepared.playable) fail('playback_blocked', 'The receiver cannot implement required semantics.', { blockers: prepared.blockers });
  if (typeof contextFactory !== 'function' || !integer(maxVoices, 1, 128) || !Number.isFinite(lookaheadSeconds) || lookaheadSeconds <= 0 || lookaheadSeconds > 1 ||
      !Number.isFinite(pollMilliseconds) || pollMilliseconds < 1 || pollMilliseconds / 1000 >= lookaheadSeconds ||
      !Number.isFinite(startLeadSeconds) || startLeadSeconds <= 0 || startLeadSeconds > lookaheadSeconds) fail('invalid_scheduler_options', 'Invalid context factory or bounded scheduler options.');
  const events = prepared.acknowledgements.map(ack => ({ ack, seconds: performanceSeconds(ack.event.exact_microseconds) }));
  const voices = prepared.voices.map(v => ({ ...v, startSeconds: performanceSeconds(v.start), endSeconds: performanceSeconds(v.end) }));
  const voiceById = new Map(voices.map(v => [v.eventId, v]));
  let state = 'stopped', generation = 0, position = 0, anchor = 0, cursor = 0, timer = null, context = null, receiver = null, error = null;
  const muted = new Set();
  const snapshot = () => Object.freeze({ state, generation, currentAudioTimeSeconds: context?.currentTime ?? null,
    audioAnchorSeconds: state === 'playing' ? anchor : null,
    positionSeconds: state === 'playing' ? Math.max(position, Math.min(prepared.durationSeconds, context.currentTime - anchor)) : position,
    error, mutedTracks: Object.freeze([...muted]) });
  const notify = () => onState(snapshot());
  const cancel = () => { generation++; if (timer !== null) timers.clearTimeout(timer); timer = null; receiver?.silence(); };
  const abort = reason => {
    position = snapshot().positionSeconds; cancel(); error = reason instanceof CleanPerformanceError ? reason : new CleanPerformanceError('audio_failure', String(reason?.message || reason));
    state = 'error'; notify();
  };
  const sound = (voice, start, resumed = false) => {
    if (muted.has(voice.trackIndex) || voice.endSeconds <= voice.startSeconds) return;
    receiver.schedule(voice, start, anchor + voice.endSeconds, { resumed });
  };
  const pump = token => {
    if (token !== generation || state !== 'playing') return;
    timer = null;
    try {
      if (context.state !== 'running') fail('audio_context_interrupted', 'Audio context stopped running.');
      const horizon = context.currentTime + lookaheadSeconds; receiver.prune(context.currentTime);
      while (cursor < events.length && anchor + events[cursor].seconds <= horizon) {
        const { ack, seconds } = events[cursor], at = anchor + seconds;
        if (at < context.currentTime) fail('late_scheduler', 'An event missed its deadline; playback stopped without skipping.', { eventId: ack.eventId });
        if (ack.voiceId && ['onset', 'layered_onset'].includes(ack.disposition)) sound(voiceById.get(ack.voiceId), at);
        cursor++;
        onEvent(Object.freeze({ eventId: ack.eventId, sourceTrackIndex: ack.event.origin.track,
          exactMicroseconds: ack.event.exact_microseconds, disposition: ack.disposition,
          muted: muted.has(ack.event.origin.track), scheduledAudioTime: at, generation: token }));
        if (token !== generation || state !== 'playing') return;
      }
      if (context.currentTime >= anchor + prepared.durationSeconds && cursor === events.length) {
        position = prepared.durationSeconds; cancel(); state = 'ended'; notify(); return;
      }
      timer = timers.setTimeout(() => pump(token), pollMilliseconds);
    } catch (reason) { if (token === generation) abort(reason); }
  };
  return Object.freeze({ policy: prepared.policy, snapshot,
    async play({ userGesture = false, acceptedPolicyId } = {}) {
      if (state === 'playing' || state === 'starting') return snapshot();
      if (!userGesture) fail('user_gesture_required', 'Start or resume from a user gesture.');
      if (acceptedPolicyId !== prepared.policy.id) fail('reference_policy_required', 'Explicitly select the declared procedural reference rendition.');
      if (state === 'error') fail('stop_required', 'Stop to reset after a playback error.');
      if (state === 'ended') position = 0;
      const token = ++generation; state = 'starting'; error = null;
      try {
        const result = contextFactory(), audio = result && typeof result.then === 'function' ? await result : result;
        if (token !== generation) return snapshot();
        if (!audio?.context || !audio.output || audio.output.context !== audio.context) fail('invalid_audio_output', 'Output must belong to its AudioContext.');
        context = audio.context; if (context.state !== 'running') await context.resume();
        if (token !== generation) return snapshot();
        if (context.state !== 'running') fail('audio_context_interrupted', 'Audio context could not start.');
        receiver = new ReferenceAudioReceiver(context, audio.output, { maxVoices, ErrorType: CleanPerformanceError });
        anchor = context.currentTime + startLeadSeconds - position;
        cursor = events.findIndex(e => e.seconds >= position); if (cursor < 0) cursor = events.length;
        for (const voice of voices) if (voice.startSeconds < position && voice.endSeconds > position) sound(voice, anchor + position, true);
        state = 'playing'; notify(); if (token === generation && state === 'playing') pump(token);
      } catch (reason) { if (token === generation) abort(reason); }
      return snapshot();
    },
    pause() { if (!['playing', 'starting'].includes(state)) return snapshot(); position = snapshot().positionSeconds; cancel(); state = 'paused'; notify(); return snapshot(); },
    stop() { cancel(); position = 0; cursor = 0; error = null; state = 'stopped'; notify(); return snapshot(); },
    setTrackMuted(trackIndex, isMuted) {
      if (state !== 'stopped') fail('stop_required', 'Stop before changing track mute.');
      if (!integer(trackIndex, 0, prepared.trackCount - 1) || typeof isMuted !== 'boolean') fail('invalid_track', 'Expected a declared track and boolean.');
      if (!prepared.tracks[trackIndex].independent) fail('shared_channel_mute_unsupported', 'This track shares a route with another track.');
      if (isMuted) muted.add(trackIndex); else muted.delete(trackIndex); notify(); return snapshot();
    },
    seek() { fail('seek_unsupported', 'Arbitrary seek is unsupported; stop resets to zero.'); },
  });
}
