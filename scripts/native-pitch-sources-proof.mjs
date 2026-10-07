// Pure validators for retained native evidence. Unit-generated records exercise
// rejection only; successful helpers alone never establish a native run.
import assert from 'node:assert/strict';
import {pitchSourcesVectors, PITCH_SOURCES_KINDS, PITCH_SOURCES_HUMAN_PARTS} from './native-pitch-sources-fixtures.mjs';
import {validateBasicKeySchedules} from './basic-key-rendition-proof.mjs';
import {validateAudioThreadStatus} from './audio-thread-rendition-proof.mjs';
import {validateVsqAudioThreadRuns} from './vsq-audio-thread-proof.mjs';

const positive = value => Number.isSafeInteger(value) && value > 0;
const configuration = semitones => ({format: 'wmc-pitch-mod', version: 1, semitones});
function vectorFor(kind) {
  assert.ok(PITCH_SOURCES_KINDS.includes(kind), 'Only original Basic and VSQ fixtures are admitted');
  return pitchSourcesVectors()[kind];
}
export function nativePitchSourceProjection(kind, semitones) {
  assert.ok(semitones === 0 || semitones === 2, 'Acceptance requires original or +2 pitch');
  return vectorFor(kind)[semitones === 2 ? 'plus2' : 'zero'];
}

/** Observe the application's own consumed JSON, not a cloned response body. */
export function validateNativePitchConsumed(row, path) {
  assert.equal(row?.path, path);
  assert.equal(row.status, 200);
  assert.equal(row.observation, 'consumed');
  assert.ok(row.request && row.response);
  assert.ok(positive(row.started?.actionSequence), 'Consumed response needs its native action sequence');
  assert.ok(Number.isSafeInteger(row.settled?.actionSequence) && row.settled.actionSequence >= row.started.actionSequence);
  assert.notEqual(row.canceled, true);
  assert.notEqual(row.signalAbortedAtStart, true);
  // A controller may be retired after successful body consumption. That later
  // abort is not a canceled request or evidence that the adopted body failed.
  return row.response;
}

/** Library-entry timestamps and the enclosing imported archive are run-local;
 * the complete clean-package and canonical notation bytes are invariant. */
export function validateNativePitchSourceLoad(load, kind) {
  const original = vectorFor(kind).original.opened;
  assert.deepEqual(load.clean_package, original.clean_package, `${kind} original package bytes/runtime changed`);
  assert.equal(load.score_json, original.score_json, `${kind} original notation bytes changed`);
  for (const field of ['key', 'content_sha256', 'score_id', 'score_sha256', 'score_bytes', 'library_format_version']) {
    assert.deepEqual(load.entry[field], original.entry[field], `${kind} saved source ${field} changed`);
  }
  assert.ok(Number.isSafeInteger(load.entry.saved_at_unix_ms) && load.entry.saved_at_unix_ms > 0);
  return load;
}

export function validateNativePitchSourceProjection(row, kind, semitones, {consumed = true} = {}) {
  const expected = nativePitchSourceProjection(kind, semitones);
  if (consumed) validateNativePitchConsumed(row, '/api/library/pitch-mod/project');
  else {
    assert.equal(row.status, 200);
    assert.notEqual(row.observation, 'consumed', 'A read-only zero probe cannot claim product consumption');
    if (row.path !== undefined) assert.equal(row.path, '/api/library/pitch-mod/project');
  }
  assert.deepEqual(row.request, {source: expected.source, configuration: configuration(semitones)});
  assert.deepEqual(row.response, expected, `${kind} projection differs from the actual Rust handler vector`);
  const original = nativePitchSourceProjection(kind, 0), projected = row.response;
  assert.equal(projected.compilation.timeline.duration_ms, original.compilation.timeline.duration_ms);
  assert.equal(projected.compilation.timeline.notes.length, original.compilation.timeline.notes.length);
  for (const [index, note] of projected.compilation.timeline.notes.entries()) {
    const before = original.compilation.timeline.notes[index];
    const source = projected.source_pitches.find(item => item.source_id === note.id);
    assert.ok(source);
    assert.deepEqual({...note, midi: before.midi}, before, 'Pitch changed original IDs, timing, velocity or gate');
    assert.equal(note.midi, before.midi + (source.percussion ? 0 : semitones));
    assert.equal(source.original_midi, before.midi);
    assert.equal(source.effective_midi, note.midi);
  }
  if (kind === 'basic') {
    assert.deepEqual(projected.runtime.rendition, original.runtime.rendition, 'FIFO attack/release pairing and exact gates changed');
    assert.deepEqual(projected.runtime.source_rendition, original.runtime.source_rendition);
    assert.equal(projected.runtime.rendition.duration_ms, 750);
  } else {
    assert.equal(projected.runtime.practice_origin_tick, 1920);
    assert.equal(projected.navigation.clock_start_ms, -2000);
    assert.equal(projected.runtime.notes.length, 2);
    assert.ok(projected.runtime.notes.every(note => note.start_ms === 0 && note.start_microseconds.numerator === '0'));
    for (const [index, note] of projected.runtime.notes.entries()) {
      assert.deepEqual({...note, key: original.runtime.notes[index].key}, original.runtime.notes[index], 'VSQ authored identity, exact rationals, singer descriptors or origin changed');
    }
  }
  assert.equal(projected.identity?.semitones ?? 0, semitones);
  if (semitones === 0) assert.equal(projected.identity, null);
  return projected;
}

export function validateNativePitchSourceAudio(audio, kind, semitones, {targetPart = null} = {}) {
  const projected = nativePitchSourceProjection(kind, semitones);
  if (targetPart !== null) assert.equal(targetPart, PITCH_SOURCES_HUMAN_PARTS[kind]);
  assert.equal(audio.runs.length, 1, 'Each uninterrupted original source run needs one actual receiver');
  assert.equal(audio.runs[0].positionFrame, 0, 'Onset-zero originals require a zero-position receiver start');
  assert.equal(audio.runs[0].terminals[0].record.type, 'ended');
  const checked = kind === 'basic'
    ? validateBasicKeySchedules(audio.runs, projected.runtime, {targetPart})
    : validateVsqAudioThreadRuns(audio.runs, projected, targetPart === null ? {} : {mode: 'practice', targetPart});
  validateAudioThreadStatus(audio.status, {quiet: true});
  assert.ok(audio.status.ownedNodes.some(node => node.receiverId === audio.runs[0].receiverId));
  return checked;
}

/** Validate the consumed Rust target result against retained source attacks.
 * This does not create or retain a substitute target response. Whole-source
 * grouping additionally joins the actual-handler assistance target vector. */
export function validateNativePitchSourceTargets(row, kind, semitones, {targetPart = PITCH_SOURCES_HUMAN_PARTS[kind]} = {}) {
  const response = validateNativePitchConsumed(row, '/api/practice-targets');
  const vector = vectorFor(kind), projected = nativePitchSourceProjection(kind, semitones);
  assert.ok(targetPart === null || targetPart === PITCH_SOURCES_HUMAN_PARTS[kind]);
  const source = projected.compilation.timeline;
  const selected = source.notes.filter(note => targetPart === null || note.part_id === targetPart);
  assert.deepEqual(Object.keys(row.request).sort(), ['profile', 'timeline']);
  assert.equal(row.request.timeline.duration_ms, source.duration_ms);
  assert.deepEqual(row.request.timeline.notes, selected, 'Practice request did not use the effective native source attacks');
  assert.equal(row.request.profile.kind, 'piano');
  assert.equal(row.request.profile.key_count, 88);
  assert.ok(row.request.profile.lowest_midi === null || row.request.profile.lowest_midi === 21 || row.request.profile.lowest_midi === undefined);
  assert.equal(response.playable, true);
  assert.equal(response.source_note_count, selected.length);
  assert.equal(response.timeline.duration_ms, source.duration_ms);
  assert.equal(response.groups.length, response.target_count);
  assert.equal(response.timeline.notes.length, response.target_count);
  if (targetPart !== null) {
    // Each selected part in these fixed originals has distinct onset times.
    // No cross-part physical grouping is needed or inferred for this case.
    assert.equal(new Set(selected.map(note => note.start_ms)).size, selected.length);
    assert.equal(response.target_count, selected.length);
    assert.deepEqual(response.timeline.notes, selected, 'Selected targets changed source ID, pitch, velocity or timing');
    for (const [index, group] of response.groups.entries()) {
      const note = selected[index];
      assert.equal(group.target_id, note.id);
      assert.deepEqual(group.source_occurrence_ids, [note.id]);
      assert.deepEqual(group.source_note_ids, note.source_note_ids);
      assert.deepEqual(group.part_ids, [note.part_id]);
    }
  } else {
    const retained = vector.assistance.checked.human_targets;
    assert.equal(response.target_count, retained.target_count);
    assert.deepEqual(response.groups, retained.groups, 'All source occurrences must retain the Rust-generated physical grouping');
    for (const [index, note] of response.timeline.notes.entries()) {
      const stored = retained.timeline.notes[index];
      assert.deepEqual({...note, midi: stored.midi}, stored);
      assert.equal(note.midi, selected.find(source => source.id === note.id).midi);
    }
  }
  const diagnosticCodes = kind === 'basic' ? ['piano_overlapping_key_gates'] : targetPart === null ? ['piano_unison_targets'] : [];
  assert.deepEqual(response.diagnostics.map(row => row.code), diagnosticCodes);
  assert.ok(response.diagnostics.every(row => row.severity === 'warning'));
  return response;
}

export function validateNativePitchSourceAssessment(row, targets) {
  const response = validateNativePitchConsumed(row, '/api/assess');
  assert.deepEqual(row.request, {timeline: targets.timeline, inputs: [], tolerance_ms: 180});
  const notes = targets.timeline.notes;
  assert.ok(notes.length > 0);
  assert.deepEqual(response.hits, [], 'This lane makes no physical input or hit claim');
  assert.deepEqual(response.extras, []);
  assert.deepEqual(response.misses, notes.map(note => note.id));
  assert.equal(response.accuracy_percent, 0);
  assert.equal(response.mean_abs_error_ms, null);
  assert.deepEqual(response.grade_counts, {perfect: 0, good: 0, early: 0, late: 0, missed: notes.length, extra: 0});
  assert.deepEqual(response.onset_completion, {total: new Set(notes.map(note => note.start_ms)).size, complete: 0, longest_complete_sequence: 0});
  const counts = new Map();
  for (const note of notes) counts.set(note.midi, (counts.get(note.midi) || 0) + 1);
  assert.deepEqual(response.pitch_breakdown, [...counts].sort((a, b) => a[0] - b[0]).map(([midi, expected]) => ({midi, expected, matched: 0, missed: expected, extra: 0, mean_abs_error_ms: null, timing_bias_ms: null})));
  assert.equal(response.summary.expected_notes, notes.length);
  assert.equal(response.summary.matched_notes, 0);
  assert.equal(response.summary.coverage_percent, 0);
  assert.equal(response.summary.timing_bias_ms, null);
  assert.equal(response.summary.timing_stddev_ms, null);
  assert.equal(response.summary.early_hits, 0);
  assert.equal(response.summary.late_hits, 0);
  return response;
}

export function validateNativePitchSourceChoice(choice) {
  const vector = vectorFor('vsq'), row = choice.runtime;
  assert.ok(Number.isSafeInteger(choice.before.runtimeRequests) && choice.before.runtimeRequests >= 0);
  assert.equal(choice.before.startDisabled, true);
  assert.equal(choice.before.modDisabled, true);
  assert.equal(choice.before.activeReceivers, 0);
  assert.equal(choice.before.pendingReceivers, 0);
  assert.ok(positive(choice.actionSequence));
  assert.equal(choice.after.runtimeRequests, choice.before.runtimeRequests + 1, 'Each opening requires one fresh explicit VSQ runtime request');
  validateNativePitchConsumed(row, '/api/library/runtime');
  assert.equal(row.started.actionSequence, choice.actionSequence);
  assert.deepEqual(row.request, {key: vector.zero.source.key, profile: vector.zero.source.profile, choice: 'base_notes_instrumental'});
  assert.deepEqual(row.response, vector.original.choice_response, 'VSQ choice must consume the original runtime before applying its pitch view');
  assert.equal(row.response.runtime.practice_origin_tick, 1920);
  assert.equal(row.response.navigation.clock_start_ms, -2000);
  assert.ok(row.response.runtime.notes.every(note => note.start_ms === 0));
  return row.response;
}

/** These originals fit a single whole-source page. Only requested source
 * position varies; pitches, FIFO gates, source IDs and percussion stay exact. */
export function validateNativeBasicPitchNotation(rows, semitones) {
  assert.ok(semitones === 0 || semitones === 2);
  assert.ok(Array.isArray(rows) && rows.length >= 2 && rows.length <= 32);
  const vector = vectorFor('basic'), seen = new Set();
  for (const row of rows) {
    validateNativePitchConsumed(row, '/api/library/basic-keys/notation');
    const entry = Object.values(vector.notation).find(value => value.request.settings.part_id === row.request.settings.part_id);
    assert.ok(entry, 'Unknown original notation part');
    assert.deepEqual(row.request.source, entry.request.source);
    const settings = row.request.settings;
    assert.equal(settings.rendition_policy_id, entry.request.settings.rendition_policy_id);
    assert.equal(settings.first_measure ?? 0, 0);
    assert.ok(settings.measure_count === undefined || Number.isInteger(settings.measure_count) && settings.measure_count >= 1 && settings.measure_count <= 32);
    if (semitones) assert.deepEqual(row.request.pitch_mod, configuration(semitones));
    else if (row.request.pitch_mod !== undefined) assert.deepEqual(row.request.pitch_mod, configuration(0));
    const expected = structuredClone(entry[semitones === 2 ? 'plus2' : 'zero']);
    if (settings.display_meter === null) {
      const {page, ...envelope} = row.response, {page: ignored, ...wantedEnvelope} = expected;
      assert.deepEqual(envelope, wantedEnvelope);
      assert.equal(page.status, 'display_meter_required');
      assert.equal(page.score, null);
      assert.equal(page.musicxml, null);
      for (const key of ['part_id', 'profile', 'source_sha256', 'rendition_policy_id', 'view_version']) assert.deepEqual(page[key], expected.page[key]);
      assert.equal(page.coverage.source_attacks, expected.page.coverage.source_attacks);
      assert.equal(page.coverage.part_attacks, expected.page.coverage.part_attacks);
      continue;
    }
    assert.deepEqual(settings.display_meter, {numerator: 4, denominator: 4});
    if (settings.position_ms !== undefined) {
      assert.ok(Number.isFinite(settings.position_ms) && settings.position_ms >= 0);
      expected.page.resolved_position_ms = Math.min(settings.position_ms, expected.page.rendition_duration_ms);
    }
    assert.deepEqual(row.response, expected, 'Actual full-source notation differs from Rust handler pitch, FIFO or percussion projection');
    seen.add(settings.part_id);
  }
  assert.deepEqual([...seen].sort(), Object.values(vector.notation).map(value => value.request.settings.part_id).sort());
  return [...seen];
}

function validateEnd(ended, projected, sampleRate) {
  assert.equal(ended.completed, true);
  assert.equal(ended.phase, 'ended');
  assert.ok(Number.isFinite(ended.positionMs) && Math.abs(ended.positionMs - projected.compilation.timeline.duration_ms) <= 1000 / sampleRate + 1e-9, 'Displayed end exceeds one actual device sample');
  assert.equal(ended.durationMs, projected.compilation.timeline.duration_ms);
  assert.equal(ended.captured, '0');
}

/** Parent verifier additionally binds native actions, source revision, process
 * restarts, source-library snapshots, saved preferences and artifact bytes. */
export function validateNativePitchSourceCase(item) {
  const {kind, semitones} = item, projected = nativePitchSourceProjection(kind, semitones);
  validateNativePitchSourceLoad(item.sourceBefore, kind);
  validateNativePitchSourceLoad(item.sourceAfter, kind);
  assert.deepEqual(item.sourceAfter, item.sourceBefore, 'Whole-song Mod must preserve complete saved source');
  if (semitones) validateNativePitchSourceProjection(item.projection, kind, semitones);
  else {
    assert.ok(item.projection === undefined || item.projection === null, 'Zero must restore the ordinary original source path');
    validateNativePitchSourceProjection(item.readOnlyZeroProjection, kind, 0, {consumed: false});
  }
  assert.equal(item.applied.semitones, String(semitones));
  assert.equal(item.applied.digest, projected.identity?.digest || '');
  if (kind === 'vsq') {
    validateNativePitchSourceChoice(item.vsqChoice);
    validateNativePitchSourceChoice(item.humanChoice);
    assert.ok(item.humanChoice.actionSequence > item.vsqChoice.actionSequence);
    assert.equal(item.humanChoice.before.runtimeRequests, item.vsqChoice.after.runtimeRequests);
  }
  validateNativePitchSourceAudio(item.machine.audio, kind, semitones);
  validateEnd(item.machine.ended, projected, item.machine.audio.runs[0].plan.sampleRate);
  assert.deepEqual(item.machine.assessmentRequests, []);
  assert.equal(item.human.targetPart, PITCH_SOURCES_HUMAN_PARTS[kind]);
  const targets = validateNativePitchSourceTargets(item.human.targets, kind, semitones, {targetPart: item.human.targetPart});
  validateNativePitchSourceAssessment(item.human.assessment, targets);
  validateNativePitchSourceAudio(item.human.audio, kind, semitones, {targetPart: item.human.targetPart});
  validateEnd(item.human.ended, projected, item.human.audio.runs[0].plan.sampleRate);
  return {kind, semitones, sourceNotes: projected.compilation.timeline.notes.length, humanTargets: targets.target_count,
    machineAudio: true, humanNoInputAssessment: true, physicalInput: false, physicalAudio: false};
}
