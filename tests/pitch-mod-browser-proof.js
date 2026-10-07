import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

export const PITCH_MOD_CASES = Object.freeze([
  'real whole-song C4 plus two uses D4 for notation targets machine audio and literal input',
  'real pitch Mod Check Cancel late reply reset zero and range refusal preserve source',
]);
export const PITCH_MOD_REPORTS = Object.freeze(['worldmusichub-pitch-mod-c4.json', 'worldmusichub-pitch-mod-lifecycle.json']);
export const pitchModOriginal = () => JSON.parse(readFileSync(new URL('./fixtures/pitch-mod-original-c4.json', import.meta.url), 'utf8'));
export const pitchConfig = semitones => ({format: 'wmc-pitch-mod', version: 1, semitones});
export const PITCH_STORAGE_PREFIX = 'worldmusichub.pitch-mod.';

// Original-source and fixed numeric counterexamples are the independent oracle.
// Derived DTOs are captured from the consumed real Rust response, never authored
// in JavaScript or imported from a fabricated successful browser report.
export function assertC4Projection(response, original = pitchModOriginal(), shift = 2) {
  assert.deepEqual(response.configuration, pitchConfig(shift));
  const {compilation, source_pitches: pitches} = response;
  assert.ok(compilation?.timeline && compilation.score);
  assert.equal(compilation.score.id, original.id);
  assert.deepEqual(compilation.score.measures, original.measures);
  assert.deepEqual(compilation.score.tempo, original.tempo);
  const expected = original.parts.flatMap(part => part.notes.map(note => ({part, note})));
  assert.equal(pitches.length, expected.length);
  for (const {part, note} of expected) {
    const pitch = pitches.find(row => row.source_id === note.id && row.part_id === part.id);
    assert.ok(pitch, 'Every stable original source ID requires an authoritative Rust pitch');
    assert.equal(pitch.original_midi, 60); assert.equal(pitch.effective_midi, shift === 0 ? 60 : 62); assert.equal(pitch.percussion, false);
    const effective = compilation.score.parts.find(row => row.id === part.id).notes.find(row => row.id === note.id);
    assert.deepEqual(effective, {...note, pitch: {...note.pitch, step: shift === 0 ? 'C' : 'D'}});
    const event = compilation.timeline.notes.find(row => row.id === note.id);
    assert.ok(event); assert.equal(event.midi, shift === 0 ? 60 : 62); assert.equal(event.part_id, part.id);
    assert.equal(event.start_ms, note.at.numerator / note.at.denominator * 500);
    assert.equal(event.duration_ms, 1000); assert.equal(event.velocity, note.velocity);
  }
  assert.equal(compilation.timeline.notes.length, expected.length);
  assert.equal(compilation.timeline.duration_ms, 8000);
  if (shift) { assert.equal(response.identity.semitones, 2); assert.match(response.identity.digest, /^[a-f0-9]{64}$/); }
  else assert.equal(response.identity, null);
  return response;
}

export function assertPitchMachineAudio(audio, response) {
  const runs = audio.runs.filter(row => row.started);
  assert.equal(runs.length, 1, 'Exactly one scored source run');
  const run = runs[0], expected = response.compilation.timeline.notes.filter(note => note.part_id === 'machine');
  assert.equal(run.node.actualAudioWorkletNode, true); assert.equal(run.node.contextMatches, true);
  assert.equal(run.plan.sourceFingerprint, response.audio_profile.source_fingerprint);
  assert.equal(run.plan.compiledFingerprint, response.audio_profile.compiled_fingerprint);
  const rate = run.plan.sampleRate;
  assert.deepEqual(run.plan.notes.map(note => note.slice(1)), expected.map(note => [Math.floor(note.start_ms * rate / 1000), Math.ceil((note.start_ms + note.duration_ms) * rate / 1000), 62, note.velocity]));
  assert.equal(run.plan.durationFrames, 8 * rate);
  assert.ok(run.messages.some(row => row.type === 'started' && row.isTrusted && row.portMatches));
  assert.equal(run.pcm.method, 'passive-output-analyser');
  assert.equal(run.pcm.graphToDestination.at(-1).type, 'AudioDestinationNode');
  assert.ok(run.pcm.blocks.some(row => row.audioTime >= run.started.anchorTime && row.peak > 1e-6 && row.rms > 1e-8), 'Actual post-anchor nonzero output PCM');
  const terminal = run.rawTerminals.find(row => row.record.type === 'ended');
  assert.ok(terminal?.isTrusted && terminal.portMatches);
  assert.equal(terminal.record.started, 4); assert.equal(terminal.record.ended, 4);
  assert.deepEqual(terminal.record.ledger.actualStarts, run.plan.notes.map(note => run.started.anchorFrame + note[1]));
  assert.deepEqual(terminal.record.ledger.actualEnds, run.plan.notes.map(note => run.started.anchorFrame + note[2]));
  return run;
}

export function assertPitchModReport(report, index) {
  assert.equal(report.version, 1); assert.equal(report.case, PITCH_MOD_CASES[index]); assert.equal(report.ok, true);
  for (const key of ['sha', 'tree']) assert.match(report.source[key], /^[a-f0-9]{40}$/);
  assert.match(report.source.server_sha256, /^[a-f0-9]{64}$/);
  assert.equal(report.original_fixtures_only, true);
  for (const key of ['physical_audio_verified', 'physical_midi_verified', 'windows_native_verified', 'accepted_package']) assert.equal(report[key], false);
  assert.deepEqual(report.pageErrors, []);
  const original = pitchModOriginal();
  assert.deepEqual(report.exportedSource, original);
  assert.equal(report.check.httpStatus, 200); assert.deepEqual(report.check.request, {score: original, configuration: pitchConfig(2)});
  assert.equal(report.check.path, '/api/pitch-mod/project'); assertC4Projection(report.check.response);
  assert.deepEqual(report.afterCheck, report.beforeCheck, 'Check does not change playback, source or stored state');
  if (index === 0) {
    assert.equal(report.applied.summary.semitones, '2'); assert.equal(report.applied.summary.digest, report.check.response.identity.digest);
    assert.equal(report.applied.clock.running, false); assert.equal(report.applied.audioStarted, 0);
    const take = report.take, pass = take.passes[0]; assert.equal(take.passes.length, 1);
    assert.deepEqual(take.pitch_mod, report.check.response.identity);
    assert.deepEqual(pass.interpretation.pitch_mod, report.check.response.identity);
    assert.deepEqual(pass.timeline.notes.map(note => [note.id, note.midi]), [['human-c4-1', 62], ['human-c4-2', 62], ['human-c4-3', 62]]);
    assert.deepEqual(pass.inputs.map(input => input.midi), [62, 62, 64], 'Input transpose is independent: pointer D4, physical D4, separately shifted physical E4');
    assert.deepEqual(pass.assessment.hits.map(hit => hit.note_id), ['human-c4-1', 'human-c4-2']);
    assert.deepEqual(pass.assessment.misses, ['human-c4-3']); assert.equal(pass.assessment.extras.length, 1);
    assert.equal(pass.pending, false); assert.equal(pass.revision, pass.assessed_revision);
    assert.ok(report.gestures.some(row => row.type === 'pointerdown' && row.midi === 62 && row.trusted));
    assert.equal(report.gestures.filter(row => row.type === 'keydown' && row.code === 'KeyS' && row.trusted).length, 2);
    assert.deepEqual(report.mappingBefore, {code: 'KeyS', midi: 62, enabled: 'true'}); assert.deepEqual(report.mappingAfter, {code: 'KeyS', midi: 64, enabled: 'true'});
    assertPitchMachineAudio(report.audio, report.check.response);
    const sourceIds = original.parts.flatMap(part => part.notes.map(note => note.id)).sort();
    assert.ok(report.engraving.svgCount > 0);
    assert.deepEqual(report.engraving.request.body, report.check.response.compilation.score);
    assert.deepEqual(report.engraving.sourceIds, sourceIds);
    assert.deepEqual(report.jianpu.map(row => [row.id, row.number]).sort(), sourceIds.map(id => [id, '2']));
    assert.ok(report.roles.some(row => row.humans.includes('human-c4-1') && row.machines.includes('machine-c4-2')));
    assert.ok(report.screenshots.some(row => row.name === 'worldmusichub-pitch-mod-d4-stage.png'));
  } else {
    assert.deepEqual(report.afterCancel, report.beforeCheck);
    assert.equal(report.late.httpStatus, 200); assertC4Projection(report.late.response);
    assert.deepEqual(report.afterLateCancel, report.beforeCheck);
    assert.equal(report.reset.applyDisabled, true); assert.equal(report.reset.checkedApplyDisabled, true);
    assert.deepEqual(report.reset.takeAfterCancel, report.reset.takeBefore);
    assert.equal(report.saveFailure.scope, 'Fault-injected sidecar quota failure');
    assert.equal(report.saveFailure.dialogOpen, true); assert.ok(report.saveFailure.error.length > 0);
    assert.equal(report.saveFailure.check.httpStatus, 200);
    assert.deepEqual(report.saveFailure.check.request, {score: original, configuration: pitchConfig(1)});
    assert.deepEqual(report.saveFailure.after, report.saveFailure.before);
    assert.deepEqual(report.saveFailure.take, report.reset.takeBefore, 'Failed sidecar save cannot replace or reset the existing take');
    assert.equal(report.zero.clock.positionMs, 0); assert.equal(report.zero.clock.running, false); assert.equal(report.zero.exportDisabled, true);
    assert.deepEqual(report.zero.take.target_plan.timeline.notes.map(note => note.midi), [60, 60, 60]);
    assert.equal(report.zero.take.pitch_mod, undefined);
    assert.ok(report.zero.take.passes.every(pass => pass.interpretation?.pitch_mod === undefined));
    assert.equal(report.range.httpStatus, 422); assert.equal(report.range.response.code, 'pitch_mod_midi_range');
    assert.notEqual(report.range.original.id, original.id);
    assert.deepEqual(report.range.request, {score: report.range.original, configuration: pitchConfig(2)});
    assert.equal(report.range.applyDisabled, true); assert.equal(report.range.audioStarted, 0);
  }
  assert.ok(report.screenshots.length > 0 && report.screenshots.length <= 8);
  for (const shot of report.screenshots) { assert.match(shot.sha256, /^[a-f0-9]{64}$/); assert.ok(shot.bytes > 0 && shot.bytes <= 8 * 1024 * 1024); }
  return report;
}
