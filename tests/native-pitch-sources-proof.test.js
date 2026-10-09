// These synthetic records test verifier acceptance/rejection contracts only.
// They are never native/browser execution, physical input, or audio evidence.
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, readFile, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {nativePitchSourcesFixture, prepareNativePitchSourcesFixture, pitchSourcesVectors as retainedPitchSourcesVectors, PITCH_SOURCES_NATIVE_PHASES, PITCH_SOURCES_HUMAN_PARTS} from '../scripts/native-pitch-sources-fixtures.mjs';
import {nativePitchSourceProjection as retainedPitchSourceProjection, validateNativePitchConsumed, validateNativePitchSourceLoad as retainedPitchSourceLoad,
  validateNativePitchSourceProjection as retainedPitchProjection, validateNativePitchSourceAudio,
  validateNativePitchSourceTargets as retainedPitchTargets, validateNativePitchSourceAssessment, validateNativePitchSourceChoice,
  validateNativeBasicPitchNotation as retainedPitchNotation, validateNativePitchSourceCase as retainedPitchCase,
  validateNativePitchSourceTake as retainedPitchTake} from '../scripts/native-pitch-sources-proof.mjs';
import {expectedBasicKeySchedules} from '../scripts/basic-key-rendition-proof.mjs';
import {syntheticAudioThreadRun, syntheticAudioThreadStatus} from './audio-thread-proof-fixtures.js';
import {syntheticVsqAudioThreadRun} from './vsq-audio-thread-proof-fixtures.js';
import {withMockBasicEligibility, mockBasicPracticeAdmission} from './basic-human-admission-fixtures.js';

const copy = value => structuredClone(value);
// Explicit consumer-test boundary only. Retained native loaders and Rust
// goldens are not modified; these synthetic receipts are never run evidence.
const pitchSourcesVectors = () => withMockBasicEligibility(retainedPitchSourcesVectors());
const nativePitchSourceProjection = (kind, semitones) => retainedPitchSourceProjection(kind, semitones, {vectors: pitchSourcesVectors()});
const validateNativePitchSourceLoad = (value, kind) => retainedPitchSourceLoad(value, kind, {vectors: pitchSourcesVectors()});
const validateNativePitchSourceProjection = (value, kind, semitones, options) => retainedPitchProjection(value, kind, semitones, {...options, vectors: pitchSourcesVectors()});
const validateNativePitchSourceTargets = (value, kind, semitones, options) => retainedPitchTargets(value, kind, semitones, {...options, vectors: pitchSourcesVectors()});
const validateNativeBasicPitchNotation = (value, semitones) => retainedPitchNotation(value, semitones, {vectors: pitchSourcesVectors()});
const validateNativePitchSourceCase = value => retainedPitchCase(value, {vectors: pitchSourcesVectors()});
const targetResponse = row => row.path === '/api/library/practice-admission' ? row.response.checked.human_targets : row.response;
function syntheticConsumed(path, request, response, sequence = 1) {
  return {path, request: copy(request), response: copy(response), status: 200, observation: 'consumed',
    started: {actionSequence: sequence}, settled: {actionSequence: sequence}, canceled: false, signalAborted: false, signalAbortedAtStart: false};
}
function syntheticProjection(kind, semitones) {
  const response = nativePitchSourceProjection(kind, semitones);
  return syntheticConsumed('/api/library/pitch-mod/project', {source: response.source, configuration: response.configuration}, response);
}
function syntheticTargets(kind, semitones, targetPart = PITCH_SOURCES_HUMAN_PARTS[kind]) {
  const projected = nativePitchSourceProjection(kind, semitones), vector = pitchSourcesVectors()[kind];
  const sourceTimeline = copy(projected.compilation.timeline);
  if (targetPart !== null) sourceTimeline.notes = sourceTimeline.notes.filter(note => note.part_id === targetPart);
  const response = targetPart === null ? copy(vector.assistance.checked.human_targets) : {
    timeline: copy(sourceTimeline), groups: sourceTimeline.notes.map(note => ({target_id: note.id, source_occurrence_ids: [note.id], source_note_ids: note.source_note_ids, part_ids: [note.part_id]})),
    source_note_count: sourceTimeline.notes.length, target_count: sourceTimeline.notes.length, playable: true,
  };
  if (targetPart === null) for (const note of response.timeline.notes) note.midi = sourceTimeline.notes.find(source => source.id === note.id).midi;
  const diagnosticCodes = kind === 'basic' ? ['piano_overlapping_key_gates'] : targetPart === null ? ['piano_unison_targets'] : [];
  response.diagnostics = diagnosticCodes.map(code => ({code, severity: 'warning', note_id: null, message: 'Synthetic validator record'}));
  if (kind === 'basic') {
    const request = {source: projected.source, pitch_mod: projected.configuration, selection: {selected_part_ids: [...new Set(sourceTimeline.notes.map(note => note.part_id))].sort(), profile: {kind: 'piano', key_count: 88, lowest_midi: 21}}};
    const admitted = mockBasicPracticeAdmission(request, vector.original.opened, {projection: projected});
    admitted.checked.human_targets.diagnostics = copy(response.diagnostics);
    return syntheticConsumed('/api/library/practice-admission', request, admitted);
  }
  return syntheticConsumed('/api/practice-targets', {timeline: sourceTimeline, profile: {kind: 'piano', key_count: 88, lowest_midi: 21}}, response);
}
function syntheticAssessment(targets) {
  const notes = targets.timeline.notes, counts = new Map();
  for (const note of notes) counts.set(note.midi, (counts.get(note.midi) || 0) + 1);
  return syntheticConsumed('/api/assess', {timeline: targets.timeline, inputs: [], tolerance_ms: 180}, {
    hits: [], extras: [], misses: notes.map(note => note.id), accuracy_percent: 0, mean_abs_error_ms: null,
    grade_counts: {perfect: 0, good: 0, early: 0, late: 0, missed: notes.length, extra: 0},
    onset_completion: {total: new Set(notes.map(note => note.start_ms)).size, complete: 0, longest_complete_sequence: 0},
    pitch_breakdown: [...counts].sort((a, b) => a[0] - b[0]).map(([midi, expected]) => ({midi, expected, matched: 0, missed: expected, extra: 0, mean_abs_error_ms: null, timing_bias_ms: null})),
    summary: {expected_notes: notes.length, matched_notes: 0, coverage_percent: 0, timing_bias_ms: null, timing_stddev_ms: null, early_hits: 0, late_hits: 0, advice: []},
  });
}
function syntheticAudio(kind, semitones, targetPart = null) {
  const projected = nativePitchSourceProjection(kind, semitones);
  const run = kind === 'basic' ? syntheticAudioThreadRun(expectedBasicKeySchedules(projected.runtime).filter(note => note.part !== targetPart), {
    sourceSha256: projected.runtime.source_sha256, durationMs: projected.runtime.rendition.duration_ms,
    sourceNotes: projected.runtime.compilation.timeline.notes.length,
  }) : syntheticVsqAudioThreadRun(projected, targetPart === null ? {} : {mode: 'practice', targetPart});
  return {runs: [run], status: syntheticAudioThreadStatus()};
}
function syntheticChoice(beforeRequests = 0, sequence = 4) {
  const vector = pitchSourcesVectors().vsq;
  return {before: {runtimeRequests: beforeRequests, activeReceivers: 0, pendingReceivers: 0, startDisabled: true, modDisabled: true}, actionSequence: sequence, after: {runtimeRequests: beforeRequests + 1},
    runtime: syntheticConsumed('/api/library/runtime', {key: vector.zero.source.key, profile: vector.zero.source.profile, choice: 'base_notes_instrumental'}, vector.original.choice_response, sequence)};
}
function syntheticCase(kind, semitones) {
  const source = pitchSourcesVectors()[kind].original.opened, projected = nativePitchSourceProjection(kind, semitones), targetPart = PITCH_SOURCES_HUMAN_PARTS[kind];
  const targets = syntheticTargets(kind, semitones), ended = {completed: true, phase: 'ended', positionMs: projected.compilation.timeline.duration_ms, durationMs: projected.compilation.timeline.duration_ms, captured: '0'};
  const projection = syntheticProjection(kind, semitones), {request, response, status} = projection;
  return {kind, semitones, sourceBefore: copy(source), sourceAfter: copy(source),
    ...(semitones ? {projection} : {readOnlyZeroProjection: {request, response, status}}),
    applied: {semitones: String(semitones), digest: projected.identity?.digest || ''},
    ...(kind === 'vsq' ? {vsqChoice: syntheticChoice(), humanChoice: syntheticChoice(1, 8)} : {}),
    machine: {audio: syntheticAudio(kind, semitones), ended: copy(ended), assessmentRequests: []},
    human: {targetPart, targets, assessment: syntheticAssessment(targetResponse(targets)), audio: syntheticAudio(kind, semitones, targetPart), ended: copy(ended)}};
}
function syntheticBasicPages(semitones) {
  return Object.values(pitchSourcesVectors().basic.notation).map(entry => syntheticConsumed('/api/library/basic-keys/notation',
    {...entry.request, ...(semitones ? {pitch_mod: {format: 'wmc-pitch-mod', version: 1, semitones}} : {})}, entry[semitones ? 'plus2' : 'zero']));
}
function rejectMutations(value, validate, mutations) {
  validate(copy(value));
  for (const [label, mutate] of mutations) {
    const changed = copy(value); mutate(changed);
    assert.throws(() => validate(changed), undefined, label);
  }
}

test('source package contains only the exact original authored metadata and score bytes', () => {
  const fixture = nativePitchSourcesFixture(), again = nativePitchSourcesFixture();
  assert.deepEqual(fixture.bytes, again.bytes);
  assert.deepEqual(PITCH_SOURCES_NATIVE_PHASES, ['pitch-sources-seed', 'pitch-sources-restart', 'pitch-sources-zero', 'pitch-sources-zero-restart']);
  assert.equal(fixture.manifest.bytes, 22127);
  assert.equal(fixture.manifest.sha256, '7a0e1a476140d65db8a8e28a57d9612896f95107f7ad87637aaf4f25ddc40bca');
  // Read stored local ZIP members in memory; no extraction or child process.
  const members = new Map(); let offset = 0;
  while (fixture.bytes.readUInt32LE(offset) === 0x04034b50) {
    assert.equal(fixture.bytes.readUInt16LE(offset + 8), 0);
    const size = fixture.bytes.readUInt32LE(offset + 18), nameBytes = fixture.bytes.readUInt16LE(offset + 26), extra = fixture.bytes.readUInt16LE(offset + 28);
    const name = fixture.bytes.subarray(offset + 30, offset + 30 + nameBytes).toString(), start = offset + 30 + nameBytes + extra;
    assert.equal(members.has(name), false); members.set(name, fixture.bytes.subarray(start, start + size)); offset = start + size;
  }
  assert.deepEqual(members, fixture.files);
  assert.equal(members.size, 5);
  for (const source of Object.values(fixture.sources)) {
    assert.equal(members.get(`${source.folder}/score.json`).toString(), source.opened.clean_package.score_json);
    assert.equal(members.get(`${source.folder}/metadata.json`).toString(), source.opened.clean_package.metadata_json);
    assert.equal(source.manifest.rights.license, 'CC0-1.0');
    assert.equal(source.manifest.raw_source_bundled, false);
    assert.equal(JSON.parse(members.get(`${source.folder}/score.json`)).configuration, undefined);
  }
  assert.match(fixture.sources.vsq.metadata.rights.attribution, /synthetic evidence claims/);
  assert.equal(fixture.sources.vsq.opened.clean_package.runtime, null);
});

test('preparation writes a fresh bounded archive and refuses to replace existing fixtures', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'wmc-pitch-sources-unit-'));
  try {
    const manifest = await prepareNativePitchSourcesFixture(directory);
    assert.deepEqual(JSON.parse(await readFile(join(directory, 'pitch-sources-fixtures.json'))), manifest);
    assert.deepEqual(await readFile(join(directory, manifest.filename)), nativePitchSourcesFixture().bytes);
    await assert.rejects(prepareNativePitchSourcesFixture(directory), {code: 'EEXIST'});
  } finally { await rm(directory, {recursive: true, force: true}); }
});

test('consumed evidence rejects copies, aborted generations and missing action binding', () => {
  const value = syntheticProjection('basic', 2);
  rejectMutations(value, row => validateNativePitchConsumed(row, row.path), [
    ['cloned response', row => {row.observation = 'cloned';}],
    ['canceled response', row => {row.canceled = true;}],
    ['already-aborted request', row => {row.signalAbortedAtStart = true;}],
    ['zero action', row => {row.started.actionSequence = 0;}],
    ['settled before request', row => {row.settled.actionSequence = 0;}],
    ['non-200', row => {row.status = 422;}],
  ]);
  value.signalAborted = true;
  validateNativePitchConsumed(value, value.path);
});

for (const kind of ['basic', 'vsq']) for (const semitones of [2, 0]) {
  test(`${kind} ${semitones}: exact actual-handler projection rejects timing, source and pitch substitutions`, () => {
    const row = syntheticProjection(kind, semitones);
    rejectMutations(row, value => validateNativePitchSourceProjection(value, kind, semitones), [
      ['wrong source', value => {value.request.source.content_sha256 = '0'.repeat(64);}],
      ['wrong shift', value => {value.request.configuration.semitones = semitones ? 0 : 2;}],
      ['changed note identity', value => {value.response.compilation.timeline.notes[0].id += '-changed';}],
      ['changed gate', value => {value.response.compilation.timeline.notes[0].duration_ms += 1;}],
      ['doubled transposition', value => {value.response.compilation.timeline.notes[0].midi += 2;}],
      ['stale receipt', value => {value.response.receipt.runtime_digest = '0'.repeat(64);}],
    ]);
    const opened = pitchSourcesVectors()[kind].original.opened;
    rejectMutations(opened, value => validateNativePitchSourceLoad(value, kind), [
      ['rewritten metadata', value => {value.clean_package.metadata_json += ' ';}],
      ['rewritten source', value => {value.clean_package.score_json += ' ';}],
      ['changed exported notation', value => {value.score_json += ' ';}],
      ['other song', value => {value.entry.key += '-other';}],
    ]);
  });

  test(`${kind} ${semitones}: complete receiver run rejects shifted starts, incomplete ledgers and silent PCM`, () => {
    for (const targetPart of [null, PITCH_SOURCES_HUMAN_PARTS[kind]]) {
      const audio = syntheticAudio(kind, semitones, targetPart);
      rejectMutations(audio, value => validateNativePitchSourceAudio(value, kind, semitones, {targetPart}), [
        ['missing receiver', value => {value.runs = [];}],
        ['late initial receiver', value => {value.runs[0].positionFrame = 1;}],
        ['wrong processor pitch', value => {value.runs[0].plan.notes[0][4]++;}],
        ['wrong exact end', value => {value.runs[0].plan.notes[0][3]++;}],
        ['forged callback', value => {value.runs[0].terminals[0].record.ledger.actualStarts[0]++;}],
        ['untrusted port', value => {value.runs[0].rawTerminals[0].isTrusted = false;}],
        ['silent output', value => {for (const block of value.runs[0].pcm.blocks) block.peak = block.rms = 0;}],
        ['pending audio', value => {value.status.pendingReceivers = 1;}],
      ]);
    }
  });

  test(`${kind} ${semitones}: human selection and no-input assessment retain the effective pitch and exact IDs`, () => {
    const targets = syntheticTargets(kind, semitones);
    rejectMutations(targets, value => validateNativePitchSourceTargets(value, kind, semitones), [
      ['stale source pitch', value => {if (kind === 'basic') value.request.pitch_mod.semitones++; else value.request.timeline.notes[0].midi++;}],
      ['source gate changed', value => {targetResponse(value).timeline.notes[0].duration_ms++;}],
      ['missing source mapping', value => {targetResponse(value).groups[0].source_note_ids = [];}],
      ['invented target', value => {targetResponse(value).target_count++;}],
    ]);
    const assessment = syntheticAssessment(targetResponse(targets));
    rejectMutations(assessment, value => validateNativePitchSourceAssessment(value, targetResponse(targets)), [
      ['invented input', value => {value.request.inputs.push({midi: 62, at_ms: 0, velocity: 90});}],
      ['invented hit', value => {value.response.hits.push({midi: 62});}],
      ['lost miss', value => {value.response.misses.pop();}],
      ['wrong feedback pitch', value => {value.response.pitch_breakdown[0].midi++;}],
      ['inflated accuracy', value => {value.response.accuracy_percent = 100;}],
    ]);
    const item = syntheticCase(kind, semitones), result = validateNativePitchSourceCase(item);
    assert.equal(result.physicalInput, false);
    assert.equal(result.physicalAudio, false);
    assert.throws(() => validateNativePitchSourceCase({...item, applied: {...item.applied, digest: '0'.repeat(64)}}));
    const quantized = copy(item);
    quantized.machine.ended.positionMs += 500 / quantized.machine.audio.runs[0].plan.sampleRate;
    validateNativePitchSourceCase(quantized);
    quantized.machine.ended.positionMs += 2000 / quantized.machine.audio.runs[0].plan.sampleRate;
    assert.throws(() => validateNativePitchSourceCase(quantized));
    if (!semitones) {
      assert.throws(() => validateNativePitchSourceCase({...item, projection: syntheticProjection(kind, 0)}));
      assert.throws(() => validateNativePitchSourceCase({...item, readOnlyZeroProjection: syntheticProjection(kind, 0)}));
    }
  });
}

test('Basic FIFO releases, synthetic 20ms onset, and percussion key remain independently addressable', () => {
  const projection = nativePitchSourceProjection('basic', 2);
  assert.deepEqual(projection.compilation.timeline.notes.map(note => [note.id, note.midi, note.start_ms, note.duration_ms]), [
    ['midi-t1-e3', 62, 0, 250], ['midi-t1-e4', 62, 125, 375], ['midi-t1-e7', 66, 500, 20], ['midi-t1-e9', 35, 500, 125],
  ]);
  const audio = syntheticAudio('basic', 2);
  rejectMutations(audio, value => validateNativePitchSourceAudio(value, 'basic', 2), [
    ['transposed percussion', value => {value.runs[0].plan.notes[3][4] = 37;}],
    ['pitched percussion', value => {value.runs[0].plan.notes[3][6] = 0;}],
    ['swapped FIFO release', value => {const n = value.runs[0].plan.notes; [n[0][3], n[1][3]] = [n[1][3], n[0][3]];}],
    ['collapsed repeat attack', value => {value.runs[0].plan.notes.splice(1, 1);}],
  ]);
});

test('VSQ choice requires an actual consumed original runtime after explicit choice and preserves zero origin', () => {
  rejectMutations(syntheticChoice(), validateNativePitchSourceChoice, [
    ['automatic choice', value => {value.before.runtimeRequests = 1;}],
    ['automatic audio', value => {value.before.activeReceivers = 1;}],
    ['missing native choice', value => {value.actionSequence = 0;}],
    ['choice raced generation', value => {value.runtime.started.actionSequence = 3;}],
    ['projected choice runtime', value => {value.runtime.response.runtime = nativePitchSourceProjection('vsq', 2).runtime;}],
    ['raw-origin shift', value => {value.runtime.response.runtime.notes[0].start_ms = 2000;}],
    ['changed rational', value => {value.runtime.response.runtime.notes[0].end_microseconds.numerator = '227000188';}],
  ]);
});

test('all-parts VSQ unison retains both authored source identities at +2 and zero', () => {
  for (const semitones of [2, 0]) {
    const row = syntheticTargets('vsq', semitones, null);
    const result = validateNativePitchSourceTargets(row, 'vsq', semitones, {targetPart: null});
    assert.equal(result.source_note_count, 2); assert.equal(result.target_count, 1);
    assert.deepEqual(result.groups[0].source_note_ids, ['vsq-t1-ID#0001', 'vsq-t2-ID#0001']);
    assert.equal(result.timeline.notes[0].midi, semitones + 63);
    row.response.groups[0].source_note_ids.pop();
    assert.throws(() => validateNativePitchSourceTargets(row, 'vsq', semitones, {targetPart: null}));
  }
});

test('actual Basic pages must retain whole-source written pitches, onsets and percussion selectors', () => {
  for (const semitones of [2, 0]) {
    const rows = syntheticBasicPages(semitones);
    rejectMutations(rows, value => validateNativeBasicPitchNotation(value, semitones), [
      ['omitted percussion page', value => {value.pop();}],
      ['changed note spelling', value => {value[0].response.page.score.parts[0].notes[0].pitch.step = 'B';}],
      ['changed pitch rail', value => {value[0].response.page.onsets[0].key++;}],
      ['changed FIFO gate', value => {value[0].response.page.interpreted_notes[0].end_ms++;}],
      ['changed percussion selector', value => {value[1].response.page.interpreted_notes[0].key++;}],
      ['invented original meter', value => {value[0].response.page.meter_origin = 'original';}],
    ]);
    for (const row of rows) {row.request.settings.position_ms = 400; row.response.page.resolved_position_ms = 400;}
    validateNativeBasicPitchNotation(rows, semitones);
  }
});


test('Basic meter-required disclosures are retained while final whole-source pages remain mandatory', () => {
  for (const semitones of [2, 0]) {
    const final = syntheticBasicPages(semitones);
    const pending = copy(final[0]);
    pending.request.settings.display_meter = null;
    pending.response.page.status = 'display_meter_required';
    pending.response.page.score = null;
    pending.response.page.musicxml = null;
    validateNativeBasicPitchNotation([pending, ...final], semitones);
    assert.throws(() => validateNativeBasicPitchNotation([pending, final[1]], semitones));
    pending.response.page.score = {};
    assert.throws(() => validateNativeBasicPitchNotation([pending, ...final], semitones));
  }
});

test('reopened VSQ choices permit earlier completed runtime requests but need a new disabled-to-choice transition', () => {
  validateNativePitchSourceChoice(syntheticChoice(3, 24));
  const prior = syntheticChoice(3, 24);
  prior.before.startDisabled = false;
  assert.throws(() => validateNativePitchSourceChoice(prior));
});

test('Basic Human admission rejects generic targets, caller authority, stale eligibility and lost full-source clocks', () => {
  for (const semitones of [0, 2]) {
    const row = syntheticTargets('basic', semitones);
    rejectMutations(row, value => validateNativePitchSourceTargets(value, 'basic', semitones), [
      ['legacy generic route', value => {value.path = '/api/practice-targets';}],
      ['caller timeline authority', value => {value.request.timeline = nativePitchSourceProjection('basic', semitones).compilation.timeline;}],
      ['partial descriptor', value => {delete value.request.source.runtime_policy;}],
      ['foreign saved source', value => {value.request.source.content_sha256 = 'a'.repeat(64);}],
      ['other profile', value => {value.request.selection.profile.key_count = 61;}],
      ['different selected part', value => {value.request.selection.selected_part_ids = ['midi-t1-c10-r0'];}],
      ['unchecked supplied plan', value => {value.request.plan = copy(value.response.checked.plan);}],
      ['missing eligibility', value => {delete value.response.checked.receipt.source_eligibility; delete value.response.checked.plan.receipt.source_eligibility;}],
      ['stale original eligibility', value => {for (const receipt of [value.response.checked.receipt, value.response.checked.plan.receipt]) receipt.source_eligibility.fingerprint = 'a'.repeat(64);}],
      ['lost source occurrence', value => {value.response.checked.source_ownership.pop();}],
      ['lost machine complement', value => {value.response.checked.machine_occurrence_ids = [];}],
      ['target clock trimmed to Human tail', value => {targetResponse(value).timeline.duration_ms = 520;}],
      ['source and target counts conflated', value => {value.response.checked.coverage.source_unit_count = targetResponse(value).target_count;}],
      ['original pitch leaked into shifted target', value => {targetResponse(value).timeline.notes[0].midi++;}],
      ['wrong pitch identity', value => {value.response.pitch_mod = null;}],
    ]);
    const legacy = pitchSourcesVectors();
    delete legacy.basic.original.opened.clean_package.runtime.source_eligibility;
    assert.throws(() => retainedPitchTargets(row, 'basic', semitones, {vectors: legacy}), /Original native source eligibility receipt/);
  }
});

test('source takes bind mandatory Basic admission while preserving optional-assistance-off and VSQ targets', () => {
  for (const kind of ['basic', 'vsq']) for (const semitones of [0, 2]) {
    const item = syntheticCase(kind, semitones), projected = nativePitchSourceProjection(kind, semitones), targets = targetResponse(item.human.targets);
    const interpretation = {source_revision: {songId: pitchSourcesVectors()[kind].original.score.notation.id, sourceRevision: {kind: 'clean-package-sha256', value: projected.source.content_sha256}}};
    if (kind === 'basic') interpretation.basic_practice_admission = {receipt: copy(item.human.targets.response.checked.receipt), selection_digest: item.human.targets.response.checked.plan.selection_digest};
    if (semitones) interpretation.pitch_mod = copy(projected.identity);
    const take = {passes: [{inputs: [], captures: [], timeline: copy(targets.timeline), assessment: copy(item.human.assessment.response), pending: false, revision: 1, assessed_revision: 1, interpretation}],
      target_plan: copy(targets), practice_assistance: null, practice_progression: null, practice_selection: {kind: 'parts', part_ids: [item.human.targetPart]}, song_mod: {config: {parts: [{partId: item.human.targetPart, performer: 'human'}]}}, ...(semitones ? {pitch_mod: copy(projected.identity)} : {})};
    rejectMutations(take, value => retainedPitchTake(value, item, {vectors: pitchSourcesVectors()}), [
      ['different target denominator', value => {value.target_plan.source_note_count++;}],
      ['trimmed complete clock', value => {value.passes[0].timeline.duration_ms--;}],
      ['different take source', value => {value.passes[0].interpretation.source_revision.sourceRevision.value = 'a'.repeat(64);}],
      ['mandatory admission confused with optional assistance', value => {value.practice_assistance = item.human.targets.response;}],
      [kind === 'basic' ? 'lost mandatory admission' : 'invented Basic authority', value => {if (kind === 'basic') delete value.passes[0].interpretation.basic_practice_admission; else value.passes[0].interpretation.basic_practice_admission = {};}],
    ]);
    if (kind === 'basic') {
      take.passes[0].interpretation.basic_practice_admission.receipt.source_eligibility.fingerprint = 'a'.repeat(64);
      assert.throws(() => retainedPitchTake(take, item, {vectors: pitchSourcesVectors()}));
    }
  }
});
