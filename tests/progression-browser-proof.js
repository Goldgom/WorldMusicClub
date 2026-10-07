import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {progressionText} from '../web/practice-progression-locales.js';

export const PROGRESSION_CASES = Object.freeze([
  'real progression controls retain Rust hierarchy, human scoring, machine audio and durable Off',
  'real progression summaries display measured equal and empty stages',
]);
export const PROGRESSION_REPORTS = Object.freeze(['worldmusichub-progression-controls.json', 'worldmusichub-progression-equal-empty.json']);
export const progressionFixture = () => JSON.parse(readFileSync(new URL('./fixtures/progression-canonical.json', import.meta.url), 'utf8'));
export const LAYERS = Object.freeze(['single', 'balanced', 'dense']);
export const LAYOUT_CONTROLS = Object.freeze(['song-mod-assistance-mode', 'song-mod-progression-layer', 'song-mod-assistance-check', 'song-mod-assistance-off', 'song-mod-apply', 'song-mod-cancel']);
export function originalProgressionVariant(kind) {
  assert.ok(['equal', 'empty'].includes(kind));
  const score = structuredClone(progressionFixture().score);
  score.id += '-' + kind; score.title = 'Original progression ' + kind + ' stage exercise';
  score.parts[0].notes = score.parts[0].notes.slice(0, 1);
  if (kind === 'empty') score.parts[0].notes[0].pitch.octave = 0;
  return score;
}
export function assertProgressionSummary(ui, checked, layer) {
  assert.equal(ui.mode, 'progression'); assert.equal(ui.layer, layer);
  assert.equal(ui.state, 'checked'); assert.equal(ui.phase, 'prepared');
  assert.deepEqual(ui.rows, checked.layers.map(row => ({layer: row.layer, selected: String(row.layer === layer), current: row.layer === layer ? 'step' : null,
    text: progressionText('en', 'row', {name: progressionText('en', row.layer), human: row.human_target_count, units: row.human_source_unit_count})
      + (row.equals_previous_layer ? ' · ' + progressionText('en', 'equal') : '') + (!row.human_target_count ? ' · ' + progressionText('en', 'empty') : '')})));
  assert.ok(ui.status.includes(`${checked.assistance.coverage.human_target_count} human targets`));
}
export function assertProgressionDraft(ui, {checking = false} = {}) {
  assert.equal(ui.mode, 'progression'); assert.deepEqual(ui.rows, []);
  assert.equal(ui.summary, progressionText('en', 'unchecked'));
  assert.equal(ui.state, checking ? 'checking' : 'unchecked');
  assert.equal(ui.units, ''); assert.equal(ui.unitsHidden, true);
}
export function assertProgressionLayout(layout) {
  const {width, height} = layout.viewport;
  assert.ok(width === 1280 && height === 720 || width === 390 && height === 844);
  assert.ok(layout.documentWidth <= width + 1);
  assert.ok(layout.content.width > 0 && layout.content.scrollWidth <= layout.content.width + 1);
  assert.deepEqual(layout.modeOptions, ['original', 'automatic', 'progression']);
  assert.deepEqual(layout.layerOptions, LAYERS); assert.equal(layout.label, 'Assistance stage');
  assert.ok(layout.description.includes('may be equal or empty'));
  assert.equal(layout.keyboard.focused, 'song-mod-progression-layer');
  assert.equal(layout.keyboard.event.key, 'Home'); assert.equal(layout.keyboard.event.trusted, true);
  assert.deepEqual(layout.controls.map(row => row.id), LAYOUT_CONTROLS);
  for (const {id, rect: r, hit} of layout.controls) {
    assert.ok(r.width > 0 && r.height > 0 && r.x >= -1 && r.y >= -1 && r.x + r.width <= width + 1 && r.y + r.height <= height + 1, id);
    assert.equal(hit, true, id + ' has an unobscured pointer target');
  }
}
export function assertProgressionRoleFrames(frames, fixture = progressionFixture()) {
  assert.ok(Array.isArray(frames) && frames.length >= 3 && frames.length <= 32);
  const checked = fixture.layers.single.response.checked.assistance;
  const fullHumans = checked.human_targets.timeline.notes, machineIds = new Set(checked.machine_occurrence_ids);
  const fullMachines = fixture.compilation.timeline.notes.filter(note => machineIds.has(note.id));
  const humanUnion = new Set(), machineUnion = new Set(); let previous = -Infinity;
  assert.equal(frames[0].clock.phase, 'playing'); assert.equal(frames.at(-1).clock.phase, 'ended');
  for (const row of frames) {
    const position = row.clock.transportPositionMs;
    assert.equal(row.reducedMotion, false);
    assert.ok(Number.isFinite(position) && position >= 0 && position >= previous && position <= fixture.compilation.timeline.duration_ms);
    assert.equal(row.clock.positionMs, position); assert.equal(row.clock.durationMs, fixture.compilation.timeline.duration_ms);
    assert.equal(row.clock.running, row.clock.phase === 'playing'); previous = position;
    // Exact public window contract: released notes are excluded at the left
    // endpoint; attacks at the lookahead endpoint are still included.
    const expected = notes => notes.filter(note => note.start_ms + note.duration_ms > position && note.start_ms <= position + 4000).map(note => note.id);
    assert.deepEqual(new Set(row.human), new Set(expected(fullHumans)), 'Human role frame must match its actual clock window');
    assert.deepEqual(new Set(row.machine), new Set(expected(fullMachines)), 'Machine role frame must match its actual clock window');
    assert.equal(row.human.length, new Set(row.human).size); assert.equal(row.machine.length, new Set(row.machine).size);
    row.human.forEach(id => humanUnion.add(id)); row.machine.forEach(id => machineUnion.add(id));
  }
  assert.deepEqual(humanUnion, new Set(fullHumans.map(note => note.id)), 'Observed windows cover all three human targets');
  assert.deepEqual(machineUnion, machineIds, 'Observed windows cover all nine machine occurrences');
  assert.equal(frames.at(-1).clock.transportPositionMs, fixture.compilation.timeline.duration_ms);
  assert.deepEqual(frames.at(-1).human, []); assert.deepEqual(frames.at(-1).machine, []);
  return frames;
}
function checkedExchange(row, fixture, layer) {
  assert.equal(row.path, '/api/practice-progression/generate'); assert.equal(row.httpStatus, 200);
  assert.deepEqual(row.request, {score: fixture.score, selection: fixture.selection, layer});
  assert.deepEqual(row.response, fixture.layers[layer].response, 'Unchanged real Rust handler fixture required');
  assertProgressionSummary(row.ui, row.response.checked, layer);
  assert.equal(row.gesture.id, 'song-mod-progression-layer'); assert.equal(row.gesture.type, 'change');
  assert.equal(row.gesture.value, layer); assert.equal(row.gesture.trusted, true);
}
export function assertProgressionReport(report, index) {
  assert.equal(report.version, 1); assert.equal(report.case, PROGRESSION_CASES[index]); assert.equal(report.ok, true);
  for (const key of ['sha', 'tree']) assert.match(report.source[key], /^[a-f0-9]{40}$/);
  assert.match(report.source.server_sha256, /^[a-f0-9]{64}$/);
  assert.equal(report.original_fixtures_only, true);
  for (const key of ['physical_audio_verified', 'physical_midi_verified', 'windows_native_verified', 'accepted_package']) assert.equal(report[key], false);
  assert.deepEqual(report.pageErrors, []);
  const fixture = progressionFixture();
  if (index === 0) {
    assert.deepEqual(report.compilation, fixture.compilation); assert.deepEqual(report.exportedSource, fixture.score);
    assert.equal(report.initial.mode, 'original'); assert.deepEqual(report.initial.requests, []); assert.deepEqual(report.initial.recipes, []);
    assert.deepEqual(report.checks.map(row => row.request.layer), LAYERS);
    for (const [i, row] of report.checks.entries()) checkedExchange(row, fixture, LAYERS[i]);
    assert.deepEqual(report.checks.map(row => row.response.checked.assistance.human_targets.target_count), [3, 6, 12]);
    assert.deepEqual(report.afterChecks.recipes, []); assert.equal(report.afterChecks.audioStarted, 0);
    assert.equal(report.afterChecks.clock.positionMs, report.initial.clock.positionMs); assert.equal(report.afterChecks.clock.running, false);
    assert.deepEqual(report.afterCancel, report.afterChecks);
    assertProgressionDraft(report.pending.draft); assertProgressionDraft(report.pending.held, {checking: true});
    assertProgressionDraft(report.pending.afterCancel); assert.deepEqual(report.pending.recipes, []); assert.equal(report.pending.audioStarted, 0);
    assert.equal(report.pending.actual.httpStatus, 200); assert.deepEqual(report.pending.actual.response, fixture.layers.balanced.response);
    assert.ok(['fulfilled', 'aborted'].includes(report.pending.release));
    assert.deepEqual(report.layouts.map(row => row.viewport), [{width: 1280, height: 720}, {width: 390, height: 844}]); report.layouts.forEach(assertProgressionLayout);
    assert.equal(report.applied.audioStarted, 0); assert.equal(report.applied.clock.running, false);
    assert.equal(report.applied.recipes.length, 1); assert.equal(report.applied.recipes[0].recipe.mode, 'progression');
    const checked = fixture.layers.single.response.checked, take = report.take;
    assert.deepEqual(report.applied.recipes[0].recipe.plan, checked.plan);
    assert.equal(report.stageValidation.path, '/api/practice-progression/validate'); assert.equal(report.stageValidation.httpStatus, 200);
    assert.deepEqual(report.stageValidation.request, {score: fixture.score, plan: checked.plan}); assert.deepEqual(report.stageValidation.response, fixture.layers.single.response);
    assert.deepEqual(take.practice_progression, checked.plan); assert.deepEqual(take.practice_assistance.plan, checked.assistance.plan);
    assert.deepEqual(take.target_plan.timeline, checked.assistance.human_targets.timeline);
    assert.equal(take.passes.length, 1); const pass = take.passes[0];
    assert.deepEqual(pass.interpretation.practice_progression, checked.plan); assert.deepEqual(pass.timeline, checked.assistance.human_targets.timeline);
    assert.equal(pass.inputs.length, 1); assert.equal(pass.inputs[0].midi, 60);
    assert.equal(report.input.type, 'pointerdown'); assert.equal(report.input.trusted, true); assert.equal(report.input.midi, 60);
    assert.equal(report.beforeInputCount, '0'); assert.equal(report.afterInputCount, '1');
    assert.equal(report.assessment.httpStatus, 200); assert.deepEqual(report.assessment.request.timeline, checked.assistance.human_targets.timeline);
    assert.deepEqual(report.assessment.request.inputs, pass.inputs); assert.deepEqual(pass.assessment, report.assessment.response);
    assert.equal(pass.pending, false); assert.equal(pass.revision, pass.assessed_revision);
    assert.equal(pass.assessment.hits.length + pass.assessment.misses.length, 3);
    assertProgressionRoleFrames(report.roleFrames, fixture);
    const run = report.audio.runs.find(row => row.started); assert.ok(run);
    assert.equal(run.node.actualAudioWorkletNode, true); assert.equal(run.node.contextMatches, true);
    assert.equal(run.plan.sourceFingerprint, fixture.audio_profile.source_fingerprint); assert.equal(run.plan.compiledFingerprint, fixture.audio_profile.compiled_fingerprint);
    assert.equal(run.plan.durationFrames, Math.ceil(fixture.compilation.timeline.duration_ms * run.plan.sampleRate / 1000));
    assert.deepEqual(run.plan.notes, fixture.compilation.timeline.notes.flatMap((note, i) => checked.assistance.machine_occurrence_ids.includes(note.id) ? [[i, Math.floor(note.start_ms * run.plan.sampleRate / 1000), Math.ceil((note.start_ms + note.duration_ms) * run.plan.sampleRate / 1000), note.midi, note.velocity]] : []));
    assert.equal(run.plan.notes.length, 9);
    assert.ok(run.messages.some(row => row.type === 'started' && row.isTrusted && row.portMatches));
    assert.equal(run.pcm.graphToDestination.at(-1).type, 'AudioDestinationNode');
    assert.ok(run.pcm.blocks.some(row => row.audioTime >= run.started.anchorTime && row.peak > 1e-6 && row.rms > 1e-8));
    const terminal = run.rawTerminals.find(row => row.record.started === 9 && row.record.ended === 9);
    assert.ok(terminal, 'All nine machine gates have actual native completions'); assert.equal(terminal.isTrusted, true); assert.equal(terminal.portMatches, true);
    assert.ok(Number.isSafeInteger(run.started.anchorFrame));
    assert.deepEqual(terminal.record.ledger.actualStarts, run.plan.notes.map(note => run.started.anchorFrame + note[1]), 'Every machine attack keeps its original exact sample frame');
    assert.deepEqual(terminal.record.ledger.actualEnds, run.plan.notes.map(note => run.started.anchorFrame + note[2]), 'Every machine release keeps its original exact sample frame');
    const refused = report.generationFault;
    assert.equal(refused.exchange.path, '/api/practice-progression/generate'); assert.equal(refused.exchange.httpStatus, 422);
    assert.deepEqual(refused.exchange.request, {score: fixture.score, selection: fixture.selection, layer: 'dense'});
    assert.equal(refused.exchange.response.code, 'progression_response_limit'); assert.match(refused.scope, /Fault-injected/);
    assert.equal(refused.ui.mode, 'progression'); assert.equal(refused.ui.phase, 'error'); assert.deepEqual(refused.ui.rows, []); assert.match(refused.ui.status, /16 MiB/);
    assert.deepEqual(refused.recipes, report.applied.recipes); assert.deepEqual(refused.take, take); assert.deepEqual(refused.afterRetry, take); assert.equal(refused.injected, 1);
    checkedExchange(refused.retry, fixture, 'dense');
    assert.deepEqual(report.activeDraft.afterCheckStopped, report.activeDraft.before, 'Check preserves saved bytes, completed clock and started receiver count');
    assert.ok(report.activeDraft.before.clock.positionMs > 0);
    assert.deepEqual(report.activeDraft.afterCheck, take); assert.deepEqual(report.activeDraft.afterCancel, take);
    assert.equal(report.activeDraft.applyDisabled, true); assert.equal(report.activeDraft.resetAfterEdit, false);
    assertProgressionDraft(report.activeDraft.draft);
    const off = report.off;
    assert.equal(off.fault.path, '/api/practice-assistance/original'); assert.equal(off.fault.httpStatus, 422);
    assert.equal(off.fault.response.code, 'assistance_response_limit'); assert.match(off.fault.ui.status, /16 MiB/);
    assert.deepEqual(off.beforeFaultRecipes, report.applied.recipes); assert.deepEqual(off.afterFaultRecipes, off.beforeFaultRecipes); assert.deepEqual(off.afterFaultTake, take);
    assert.equal(off.resetRequired, true); assert.equal(off.injected, 1);
    assert.equal(off.admission.httpStatus, 200); assert.deepEqual(off.admission.request.timeline, fixture.compilation.timeline);
    assert.deepEqual(off.admission.response.timeline, fixture.original.checked.human_targets.timeline);
    assert.equal(off.clock.positionMs, 0); assert.equal(off.clock.running, false); assert.equal(off.exportDisabled, true);
    assert.equal(off.recipes.length, 1); assert.equal(off.recipes[0].recipe.mode, 'off'); assert.equal(off.recipes[0].recipe.plan, null);
    assert.deepEqual(off.restoredRecipes, off.recipes); assert.equal(off.reloadAssistanceRequests.length, 0);
    assert.equal(off.freshTake.practice_progression, null); assert.equal(off.freshTake.practice_assistance, null); assert.equal(off.freshTake.practice_assistance_disabled, true);
    assert.deepEqual(off.freshTake.target_plan.timeline, fixture.original.checked.human_targets.timeline);
    const ordinary = off.audio.runs.find(row => row.started); assert.ok(ordinary); assert.equal(ordinary.node.actualAudioWorkletNode, true); assert.deepEqual(ordinary.plan.notes, []);
    assert.equal(ordinary.plan.sourceFingerprint, run.plan.sourceFingerprint); assert.equal(ordinary.plan.compiledFingerprint, run.plan.compiledFingerprint); assert.equal(ordinary.plan.assistanceFingerprint, undefined);
    assert.deepEqual(report.screenshots.map(row => [row.name, row.width, row.height]), [['worldmusichub-progression-layout-1280.png', 1280, 720], ['worldmusichub-progression-layout-390.png', 390, 844], ['worldmusichub-progression-scored.png', 1280, 720], ['worldmusichub-progression-off.png', 1280, 720]]);
  } else {
    assert.deepEqual(report.variants.map(row => row.kind), ['equal', 'empty']);
    for (const row of report.variants) {
      assert.deepEqual(row.compilation.score, originalProgressionVariant(row.kind)); assert.deepEqual(row.exportedSource, row.compilation.score);
      assert.deepEqual(row.exchange.request, {score: row.compilation.score, selection: fixture.selection, layer: 'single'});
      assert.equal(row.exchange.httpStatus, 200); const checked = row.exchange.response.checked;
      assertProgressionSummary(row.exchange.ui, checked, 'single');
      assert.deepEqual(checked.layers.map(layer => layer.human_target_count), row.kind === 'equal' ? [1, 1, 1] : [0, 0, 0]);
      assert.deepEqual(checked.layers.map(layer => layer.equals_previous_layer), [false, true, true]);
      assert.equal(checked.assistance.scored_mode_allowed, row.kind === 'equal');
      assert.deepEqual(row.recipes, []); assert.equal(row.audioStarted, 0);
    }
    assert.deepEqual(report.screenshots.map(row => row.name), ['worldmusichub-progression-equal.png', 'worldmusichub-progression-empty.png']);
  }
  for (const shot of report.screenshots) { assert.match(shot.sha256, /^[a-f0-9]{64}$/); assert.ok(shot.bytes > 0); }
  return report;
}
