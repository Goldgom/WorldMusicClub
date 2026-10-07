import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync, writeFileSync, mkdtempSync, rmSync, unlinkSync, symlinkSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {deflateSync} from 'node:zlib';
import {PROGRESSION_CASES, PROGRESSION_REPORTS, LAYERS, LAYOUT_CONTROLS, progressionFixture, originalProgressionVariant, assertProgressionReport, assertProgressionSummary, assertProgressionDraft, assertProgressionLayout, assertProgressionRoleFrames} from './progression-browser-proof.js';
import {progressionText as text} from '../web/practice-progression-locales.js';
import {verifyProgressionPreview} from '../scripts/verify-progression-preview.mjs';

const clone = structuredClone, fixture = progressionFixture(), digest = bytes => createHash('sha256').update(bytes).digest('hex');
const source = {sha: 'a'.repeat(40), tree: 'b'.repeat(40), server_sha256: 'c'.repeat(64)};
const read = path => readFileSync(new URL('../' + path, import.meta.url), 'utf8');
// Artificial reports below exercise the evidence oracle and hostile mutations.
// They are never presented as observed browser, Rust, audio or screenshot evidence.
function ui(checked, layer = 'single') {
  return {mode: 'progression', layer, state: 'checked', phase: 'prepared', units: 'checked source units', unitsHidden: false,
    status: `${checked.assistance.coverage.human_target_count} human targets`,
    rows: checked.layers.map(row => ({layer: row.layer, selected: String(layer === row.layer), current: layer === row.layer ? 'step' : null,
      text: text('en', 'row', {name: text('en', row.layer), human: row.human_target_count, units: row.human_source_unit_count}) + (row.equals_previous_layer ? ' · ' + text('en', 'equal') : '') + (!row.human_target_count ? ' · ' + text('en', 'empty') : '')}))};
}
const draft = checking => ({mode: 'progression', rows: [], summary: text('en', 'unchecked'), state: checking ? 'checking' : 'unchecked', units: '', unitsHidden: true});
function exchange(layer) { const response = clone(fixture.layers[layer].response); return {path: '/api/practice-progression/generate', httpStatus: 200, request: {score: clone(fixture.score), selection: clone(fixture.selection), layer}, response, ui: ui(response.checked, layer), gesture: {id: 'song-mod-progression-layer', type: 'change', value: layer, trusted: true}}; }
function layout(width, height) {
  return {viewport: {width, height}, documentWidth: width, content: {width: width - 20, scrollWidth: width - 20}, modeOptions: ['original', 'automatic', 'progression'], layerOptions: clone(LAYERS), label: 'Assistance stage', description: 'Actual stages may be equal or empty', keyboard: {focused: 'song-mod-progression-layer', event: {key: 'Home', trusted: true}}, controls: LAYOUT_CONTROLS.map(id => ({id, rect: {x: 10, y: 10, width: 100, height: 30}, hit: true}))};
}
const shot = (name, width = 1280, height = 720) => ({name, width, height, bytes: 100, sha256: 'd'.repeat(64)});
function syntheticReports() {
  const checked = clone(fixture.layers.single.response.checked), zero = {positionMs: 0, running: false};
  const stopped = {recipes: [], audioStarted: 0, clock: clone(zero)};
  const assessment = {hits: [], misses: checked.assistance.human_targets.timeline.notes.map(note => ({id: note.id})), extras: [{midi: 60}]};
  const inputs = [{midi: 60, at_ms: 1800}];
  const take = {practice_progression: checked.plan, practice_assistance: {plan: checked.assistance.plan}, target_plan: checked.assistance.human_targets,
    passes: [{interpretation: {practice_progression: checked.plan}, timeline: checked.assistance.human_targets.timeline, inputs, assessment, pending: false, revision: 1, assessed_revision: 1}]};
  const recipes = [{key: 'fixture', raw: 'fixture', recipe: {mode: 'progression', plan: checked.plan}}], offRecipes = [{key: 'fixture', raw: 'off', recipe: {mode: 'off', plan: null}}];
  const rate = 48000, run = {node: {actualAudioWorkletNode: true, contextMatches: true}, started: {anchorTime: 1, anchorFrame: 48000},
    plan: {sourceFingerprint: fixture.audio_profile.source_fingerprint, compiledFingerprint: fixture.audio_profile.compiled_fingerprint, sampleRate: rate, durationFrames: 384000,
      notes: fixture.compilation.timeline.notes.flatMap((note, i) => checked.assistance.machine_occurrence_ids.includes(note.id) ? [[i, Math.floor(note.start_ms * rate / 1000), Math.ceil((note.start_ms + note.duration_ms) * rate / 1000), note.midi, note.velocity]] : [])},
    messages: [{type: 'started', isTrusted: true, portMatches: true}], pcm: {graphToDestination: [{type: 'AudioDestinationNode'}], blocks: [{audioTime: 2, peak: .1, rms: .05}]}, rawTerminals: [{isTrusted: true, portMatches: true, record: {started: 9, ended: 9, ledger: {actualStarts: fixture.compilation.timeline.notes.filter(note => checked.assistance.machine_occurrence_ids.includes(note.id)).map(note => 48000 + Math.floor(note.start_ms * rate / 1000)), actualEnds: fixture.compilation.timeline.notes.filter(note => checked.assistance.machine_occurrence_ids.includes(note.id)).map(note => 48000 + Math.ceil((note.start_ms + note.duration_ms) * rate / 1000))}}}]};
  const common = {version: 1, ok: true, source: clone(source), original_fixtures_only: true, physical_audio_verified: false, physical_midi_verified: false, windows_native_verified: false, accepted_package: false, pageErrors: []};
  const first = {...clone(common), case: PROGRESSION_CASES[0], compilation: clone(fixture.compilation), exportedSource: clone(fixture.score), initial: {mode: 'original', requests: [], recipes: [], clock: zero},
    checks: LAYERS.map(exchange), afterChecks: clone(stopped), afterCancel: clone(stopped), pending: {draft: draft(false), held: draft(true), afterCancel: draft(false), recipes: [], audioStarted: 0, actual: exchange('balanced'), release: 'fulfilled'},
    layouts: [layout(1280, 720), layout(390, 844)], applied: {recipes: clone(recipes), audioStarted: 0, clock: clone(zero)}, take: clone(take),
    stageValidation: {path: '/api/practice-progression/validate', httpStatus: 200, request: {score: clone(fixture.score), plan: clone(checked.plan)}, response: clone(fixture.layers.single.response)},
    input: {type: 'pointerdown', trusted: true, midi: 60}, beforeInputCount: '0', afterInputCount: '1',
    assessment: {httpStatus: 200, request: {timeline: clone(checked.assistance.human_targets.timeline), inputs: clone(inputs)}, response: clone(assessment)},
    roleFrames: [10, 125, 500, 1125, 1500, 8000].map(position => ({clock: {phase: position === 8000 ? 'ended' : 'playing', running: position !== 8000, transportPositionMs: position, positionMs: position, durationMs: 8000}, reducedMotion: false,
      human: checked.assistance.human_targets.timeline.notes.filter(note => note.start_ms + note.duration_ms > position && note.start_ms <= position + 4000).map(note => note.id),
      machine: fixture.compilation.timeline.notes.filter(note => checked.assistance.machine_occurrence_ids.includes(note.id) && note.start_ms + note.duration_ms > position && note.start_ms <= position + 4000).map(note => note.id)})), audio: {runs: [run]},
    activeDraft: {before: {recipes: clone(recipes), audioStarted: 1, clock: {positionMs: 8000, running: false}}, afterCheckStopped: {recipes: clone(recipes), audioStarted: 1, clock: {positionMs: 8000, running: false}}, draft: draft(false), afterCheck: clone(take), afterCancel: clone(take), applyDisabled: true, resetAfterEdit: false},
    generationFault: {exchange: {path: '/api/practice-progression/generate', httpStatus: 422, request: {score: clone(fixture.score), selection: clone(fixture.selection), layer: 'dense'}, response: {code: 'progression_response_limit'}}, scope: 'Fault-injected refusal', ui: {mode: 'progression', phase: 'error', rows: [], status: 'Response exceeds 16 MiB'}, recipes: clone(recipes), take: clone(take), afterRetry: clone(take), injected: 1, retry: exchange('dense')},
    off: {beforeFaultRecipes: clone(recipes), afterFaultRecipes: clone(recipes), afterFaultTake: clone(take), fault: {path: '/api/practice-assistance/original', httpStatus: 422, response: {code: 'assistance_response_limit'}, ui: {status: 'Response exceeds 16 MiB'}}, resetRequired: true, injected: 1,
      admission: {httpStatus: 200, request: {timeline: clone(fixture.compilation.timeline)}, response: clone(fixture.original.checked.human_targets)}, clock: clone(zero), exportDisabled: true, recipes: clone(offRecipes), restoredRecipes: clone(offRecipes), reloadAssistanceRequests: [],
      freshTake: {practice_progression: null, practice_assistance: null, practice_assistance_disabled: true, target_plan: clone(fixture.original.checked.human_targets)}, audio: {runs: [{started: {}, node: {actualAudioWorkletNode: true}, plan: {notes: [], sourceFingerprint: run.plan.sourceFingerprint, compiledFingerprint: run.plan.compiledFingerprint}}]}},
    screenshots: [shot('worldmusichub-progression-layout-1280.png'), shot('worldmusichub-progression-layout-390.png', 390, 844), shot('worldmusichub-progression-scored.png'), shot('worldmusichub-progression-off.png')]};
  const second = {...clone(common), case: PROGRESSION_CASES[1], variants: ['equal', 'empty'].map(kind => {
    const score = originalProgressionVariant(kind), checked = clone(fixture.layers.single.response.checked), count = kind === 'equal' ? 1 : 0;
    checked.layers.forEach((row, i) => { row.human_target_count = row.human_source_unit_count = count; row.equals_previous_layer = i > 0; });
    checked.assistance.coverage.human_target_count = count; checked.assistance.scored_mode_allowed = kind === 'equal';
    return {kind, compilation: {score}, exportedSource: clone(score), exchange: {httpStatus: 200, request: {score, selection: clone(fixture.selection), layer: 'single'}, response: {checked}, ui: ui(checked)}, recipes: [], audioStarted: 0};
  }), screenshots: [shot('worldmusichub-progression-equal.png'), shot('worldmusichub-progression-empty.png')]};
  return [first, second];
}
function syntheticPng(width, height) {
  const chunk = (type, data) => { const bytes = Buffer.alloc(data.length + 12); bytes.writeUInt32BE(data.length); bytes.write(type, 4); data.copy(bytes, 8); return bytes; };
  const header = Buffer.alloc(13); header.writeUInt32BE(width); header.writeUInt32BE(height, 4); header[8] = 8; header[9] = 2;
  return Buffer.concat([Buffer.from('89504e470d0a1a0a', 'hex'), chunk('IHDR', header), chunk('IDAT', deflateSync(Buffer.alloc((width * 3 + 1) * height))), chunk('IEND', Buffer.alloc(0))]);
}
function diskFixture(t) {
  const directory = mkdtempSync(join(tmpdir(), 'wmh-progression-oracle-')); t.after(() => rmSync(directory, {recursive: true, force: true}));
  const reports = syntheticReports(); for (const report of reports) for (const shot of report.screenshots) { const png = syntheticPng(shot.width, shot.height); writeFileSync(join(directory, shot.name), png); shot.bytes = png.length; shot.sha256 = digest(png); }
  const save = () => reports.forEach((report, i) => writeFileSync(join(directory, PROGRESSION_REPORTS[i]), JSON.stringify(report))); save();
  const tap = PROGRESSION_CASES.map((name, i) => `ok ${i + 1} - ${name}`).join('\n') + '\n'; writeFileSync(join(directory, 'tests.tap'), tap);
  return {directory, reports, save, tap, expected: {sha: source.sha, tree: source.tree, serverSha256: source.server_sha256}};
}

test('progression evidence binds exact retained Rust replies, distinct opt-in and complete human/machine complements', () => {
  syntheticReports().forEach(assertProgressionReport);
  assert.deepEqual(LAYERS.map(layer => fixture.layers[layer].response.checked.assistance.human_targets.target_count), [3, 6, 12]);
  for (const kind of ['equal', 'empty']) assert.equal(originalProgressionVariant(kind).provenance.kind, 'original_exercise');
});
test('progression oracle rejects stale summaries, reset-free edits, fabricated audio or input, dropped proofs and revived assistance', () => {
  const mutations = [r => r.checks[1].response.checked.plan.layer = 'single', r => r.checks[2].gesture.trusted = false,
    r => r.initial.mode = 'progression', r => r.afterChecks.recipes.push({}), r => r.afterChecks.audioStarted = 1,
    r => r.afterCancel.clock.positionMs = 100, r => r.pending.held.rows = r.checks[0].ui.rows, r => r.pending.afterCancel.state = 'checked', r => r.pending.actual.response.checked.plan.hierarchy_digest = '0'.repeat(64),
    r => r.applied.recipes[0].recipe.plan.layer = 'dense', r => r.stageValidation.request.plan.hierarchy_digest = '0'.repeat(64), r => r.take.practice_progression = null,
    r => r.take.passes[0].interpretation.practice_progression = null, r => r.take.passes[0].inputs.push({midi: 64}), r => r.input.trusted = false, r => r.beforeInputCount = '9',
    r => r.take.passes[0].pending = true, r => r.take.passes[0].assessment = null, r => r.assessment.request.timeline.notes.push(fixture.compilation.timeline.notes[1]),
    r => r.roleFrames[0].machine.pop(), r => r.audio.runs[0].plan.notes.pop(), r => r.audio.runs[0].node.actualAudioWorkletNode = false, r => r.audio.runs[0].rawTerminals[0].record.ended = 8,
    r => r.audio.runs[0].pcm.blocks[0].rms = 0, r => r.audio.runs[0].messages[0].isTrusted = false, r => r.audio.runs[0].plan.sourceFingerprint = '0'.repeat(64),
    r => r.activeDraft.afterCheckStopped.clock.positionMs = 0, r => r.activeDraft.applyDisabled = false, r => r.activeDraft.resetAfterEdit = true, r => r.activeDraft.afterCheck.passes = [],
    r => r.audio.runs[0].rawTerminals[0].record.ledger.actualEnds[0]++, r => r.generationFault.ui.mode = 'original', r => r.generationFault.recipes = [], r => r.generationFault.afterRetry.passes = [],
    r => r.off.injected = 2, r => r.off.afterFaultRecipes = [], r => r.off.resetRequired = false, r => r.off.admission.response.timeline.notes.pop(),
    r => r.off.recipes[0].recipe.plan = {}, r => r.off.reloadAssistanceRequests.push({path: '/api/practice-progression/validate'}), r => r.off.freshTake.practice_progression = r.take.practice_progression,
    r => r.off.audio.runs[0].plan.notes.push([0, 0, 100, 60, 90]), r => r.exportedSource.parts[0].notes.pop(), r => r.windows_native_verified = true, r => r.physical_audio_verified = true,
  ];
  for (const [i, mutate] of mutations.entries()) { const report = syntheticReports()[0]; mutate(report); assert.throws(() => assertProgressionReport(report, 0), 'Reject adversary ' + i); }
});
test('equal and empty stages must display actual counts and explicit scoring limits', () => {
  for (const mutate of [r => r.variants[0].exchange.ui.rows[1].text = 'An optimal arrangement', r => r.variants[1].exchange.response.checked.assistance.scored_mode_allowed = true, r => r.variants[1].exchange.ui.rows[0].text = '0 human targets', r => r.variants[0].exchange.response.checked.layers[2].human_target_count = 2]) {
    const report = syntheticReports()[1]; mutate(report); assert.throws(() => assertProgressionReport(report, 1));
  }
});
test('both exact viewports require accessible labels, native keyboard events and visible unclipped pointer targets', () => {
  for (const dimensions of [[1280, 720], [390, 844]]) {
    assertProgressionLayout(layout(...dimensions));
    for (const mutate of [r => r.controls[2].hit = false, r => r.controls[4].rect.x = r.viewport.width, r => r.documentWidth++, r => r.content.scrollWidth += 2, r => r.keyboard.event.trusted = false, r => r.modeOptions.pop()]) {
      const value = layout(...dimensions); mutate(value); if (value.documentWidth === value.viewport.width + 1) value.documentWidth++; assert.throws(() => assertProgressionLayout(value));
    }
  }
  assert.throws(() => assertProgressionDraft({...draft(false), units: 'obsolete 12'}));
  assert.throws(() => assertProgressionSummary({...ui(fixture.layers.single.response.checked), phase: 'preparing'}, fixture.layers.single.response.checked, 'single'));
});
test('independent verifier rejects wrong exact source, skipped missing duplicate TAP and altered bounded pixels', t => {
  const f = diskFixture(t); assert.equal(verifyProgressionPreview(f.directory, f.expected).files.length, 9);
  for (const content of ['', f.tap + f.tap, f.tap.replace(/^ok /, 'not ok '), f.tap.replace(PROGRESSION_CASES[0], PROGRESSION_CASES[0] + ' # SKIP'), f.tap.replace(PROGRESSION_CASES[1], PROGRESSION_CASES[1] + ' # TODO'), 'Bail out!\n' + f.tap]) { writeFileSync(join(f.directory, 'tests.tap'), content); assert.throws(() => verifyProgressionPreview(f.directory, f.expected)); }
  writeFileSync(join(f.directory, 'tests.tap'), f.tap);
  for (const key of ['sha', 'tree', 'serverSha256']) assert.throws(() => verifyProgressionPreview(f.directory, {...f.expected, [key]: '0'.repeat(key === 'serverSha256' ? 64 : 40)}));
  const path = join(f.directory, f.reports[0].screenshots[0].name), valid = readFileSync(path);
  for (const bytes of [Buffer.from('not PNG'), valid.subarray(0, 33), Buffer.concat([valid, Buffer.from('tail')]), Buffer.alloc(8 * 1024 * 1024 + 1)]) { writeFileSync(path, bytes); assert.throws(() => verifyProgressionPreview(f.directory, f.expected)); }
  writeFileSync(path, valid); unlinkSync(path); assert.throws(() => verifyProgressionPreview(f.directory, f.expected));
  if (process.platform !== 'win32') { const target = join(f.directory, 'linked.png'); writeFileSync(target, valid); symlinkSync(target, path); assert.throws(() => verifyProgressionPreview(f.directory, f.expected), /bounded ordinary/); }
});
test('focused workflow binds real Rust handler fixtures, pinned tools and actual browser controls without local substitutes', () => {
  const workflow = read('.github/workflows/progression-preview.yml'), browser = read('tests/progression-app-browser.test.js');
  for (const token of ['ref: ${{ github.sha }}', "node-version: '22.23.3'", "toolchain: '1.99.0'", 'cargo test -p practice-server --test practice_progression_api --locked', 'cargo build -p practice-server --locked', 'node --test --test-reporter=tap tests/progression-app-browser.test.js', 'verify-progression-preview.mjs', 'if: always()']) assert.ok(workflow.includes(token), token);
  const expectedPins = [...read('.github/workflows/guitar-phrase-preview.yml').matchAll(/uses: ([^\n]+)/g)].map(row => row[1]);
  assert.deepEqual([...workflow.matchAll(/uses: ([^\n]+)/g)].map(row => row[1]), expectedPins);
  for (const token of ['await route.fetch()', 'route.fulfill({response: actual})', "control.press('Home')", 'setInputFiles', 'canonicalPreviewAudioBootstrap', 'installPlaybackClockReader', "fault", 'readCanonicalPreviewAudio']) assert.ok(browser.includes(token), token);
  for (const forbidden of ['dispatchEvent(', 'force: true', 'installLoopClockFixture', 'page.setContent(', 'WMH_UPDATE_PROGRESSION_FIXTURES=1']) assert.equal(browser.includes(forbidden), false, forbidden);
  assert.equal(workflow.includes('releases:'), false); assert.equal(workflow.includes('branches: [main]'), false);
});

test('role observations bind every actual lookahead window and reject a whole-score list at natural end', () => {
  const frames = syntheticReports()[0].roleFrames; assertProgressionRoleFrames(frames);
  // At 125ms the first human note has released exactly; at 1500ms every note
  // has released although the full source continues to its 8000ms endpoint.
  assert.equal(frames[1].human.includes('step-00'), false);
  assert.deepEqual(frames[4].human, []); assert.deepEqual(frames[4].machine, []);
  for (const mutate of [rows => rows.at(-1).human = clone(rows[0].human), rows => rows.at(-1).machine = clone(rows[0].machine), rows => rows[1].human.push('step-00'), rows => rows[2].clock.transportPositionMs = 100, rows => rows[0].reducedMotion = true, rows => rows.shift(), rows => rows.pop()]) {
    const changed = clone(frames); mutate(changed); assert.throws(() => assertProgressionRoleFrames(changed));
  }
});
