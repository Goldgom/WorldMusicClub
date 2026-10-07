import {assistanceAudioMask, emptyAssistedListen} from './practice-assistance-audio.js';
import {humanPracticePartIds} from './practice-selection.js';
import {isVsqSong} from './clean-song-package.js';
import {BASIC_KEY_AUDIO_PROTOCOL, BASIC_KEY_AUDIO_LIMITS, VSQ_AUDIO_POLICY, VSQ_AUDIO_IDENTITY, audioFail, basicKeyGateFrames, basicKeySampleRate, basicKeyInstrumentOverrides, basicKeyTimbrePlan, validateBasicKeyAudioPlan} from './basic-key-audio-plan.js';

const zero = Object.freeze({numerator: '0', denominator: 1});
// Mirrors Rust's quotient/remainder conversion to verify its millisecond
// projection. Sample boundaries use the native rational directly.
const nativeMs = time => {
  const numerator = BigInt(time.numerator), divisor = BigInt(time.denominator) * 1000n;
  return Number(numerator / divisor) + Number(numerator % divisor) / Number(divisor);
};

/** Explicit instrumental choice admits native gates, never notation compilation,
 * vocal Dynamics, singer programs or guessed MIDI coordinates. */
export function buildVsqAudioPlan(song, {sampleRate, mode = 'listen', targetPart = null, practiceSelection, mutedParts = [], soloParts = [], instrument = 'piano', instrumentOverrides = {}, assistance, assistanceContext} = {}) {
  basicKeySampleRate(sampleRate);
  const runtime = song?.runtime, timeline = song?.compilation?.timeline;
  if (!isVsqSong(song) || runtime?.profile !== 'wmh-vsq-base-note-practice-v1' || runtime.choice !== 'base_notes_instrumental' || runtime.source_sha256 !== song.score.source.sha256 || !Array.isArray(runtime.notes) || !Array.isArray(timeline?.notes)) audioFail('vsq_choice_required', 'Choose base-note instrumental practice first.');
  if (!['listen', 'practice'].includes(mode)) audioFail('invalid_audio_plan', 'Unknown VSQ playback mode.');
  if (!['piano', 'guitar'].includes(instrument)) audioFail('vsq_reference_instrument', 'Choose a supported reference instrument.');
  const humanParts = emptyAssistedListen(assistance, mode, practiceSelection) ? new Set() : humanPracticePartIds(runtime.parts.map(part => part.part_id),{mode:assistance == null ? mode : 'practice',practiceSelection,targetPart});
  const overrides = basicKeyInstrumentOverrides(runtime.parts.map(part => part.part_id), instrumentOverrides), timbres = new Map();
  if (runtime.parts.length > 128) audioFail('part_budget_exceeded', 'Too many reference parts.');
  if (runtime.notes.length > BASIC_KEY_AUDIO_LIMITS.maxNotes) audioFail('audio_plan_limit', 'The complete VSQ source exceeds the bounded audio plan note count.', {maxNotes: BASIC_KEY_AUDIO_LIMITS.maxNotes});
  if (runtime.notes.length !== timeline.notes.length || song.reference_velocity !== 90) audioFail('invalid_audio_plan', 'The native VSQ timeline or fixed reference velocity is invalid.');
  const mask = assistanceAudioMask(assistance, assistanceContext, {sourceToken: song, runtimeToken: runtime, sourceProfile: song.profile, runtimePolicy: runtime.profile, choice: runtime.choice, savedPackageSha256: song.identity, partIds: [...humanParts], notes: timeline.notes});
  const durationFrames = basicKeyGateFrames(zero, runtime.end_microseconds, sampleRate)[1];
  if (nativeMs(runtime.end_microseconds) !== runtime.end_ms || timeline.duration_ms !== runtime.end_ms) audioFail('invalid_audio_plan', 'The native VSQ source end does not match its exact rational time.');
  const projected = new Map(timeline.notes.map(note => [note.id, note])), seen = new Set(), muted = new Set(mutedParts), solo = new Set(soloParts), notes = [];
  for (const note of runtime.notes) {
    const target = projected.get(note.note_id), [start, end] = basicKeyGateFrames(note.start_microseconds, note.end_microseconds, sampleRate);
    if (seen.has(note.note_id) || !target || !Number.isInteger(note.source_track_index) || note.source_track_index < 1 || note.source_track_index > 65535 || !/^ID#(?:[0-9]{4}|[0-9]{8})$/.test(note.authored_note_id) || note.note_id !== `vsq-t${note.source_track_index}-${note.authored_note_id}` || note.part_id !== `vsq-track-${note.source_track_index}` || nativeMs(note.start_microseconds) !== note.start_ms || nativeMs(note.end_microseconds) !== note.end_ms || target.start_ms !== note.start_ms || target.duration_ms !== note.end_ms - note.start_ms || target.midi !== note.key || target.part_id !== note.part_id || target.velocity !== 90 || end > durationFrames) audioFail('invalid_audio_plan', 'A native VSQ identity or rational gate does not match its target projection.');
    seen.add(note.note_id);
    if (muted.has(note.part_id) || solo.size && !solo.has(note.part_id) || (mask ? !mask.isMachine(note.note_id) : humanParts.has(note.part_id))) continue;
    notes.push([note.note_id, `vsq:${runtime.source_sha256}:t${note.source_track_index}:${note.authored_note_id}`, start, end, note.key, song.reference_velocity, instrument === 'piano' ? 2 : 3]);
    if (overrides.has(note.part_id)) timbres.set(note.note_id, overrides.get(note.part_id));
  }
  // Stable ordering at equal frames retains native authored EventList order.
  notes.sort((a, b) => a[2] - b[2]);
  return validateBasicKeyAudioPlan({protocol: BASIC_KEY_AUDIO_PROTOCOL, identityKind: VSQ_AUDIO_IDENTITY, policyId: VSQ_AUDIO_POLICY, sourceSha256: runtime.source_sha256, sampleRate, durationFrames, sourceNotes: runtime.notes.length, notes, ...basicKeyTimbrePlan(notes, timbres), ...(mask ? {assistanceFingerprint: mask.fingerprint} : {})});
}
