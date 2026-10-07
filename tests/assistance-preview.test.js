import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdtempSync, readFileSync, rmSync, symlinkSync, unlinkSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {deflateSync} from 'node:zlib';
import {ASSISTANCE_PREVIEW_CASES, ASSISTANCE_PRESET_LAYOUT_CHECKPOINTS, assistanceCanonicalPresetFixture, validateAssistancePresetEvidence, validateAssistanceModLayout, verifyUiPreviewAssistance} from '../scripts/ui-preview-assistance.mjs';
import {assistancePresetSettings} from '../web/practice-assistance-receipt.js';
import {assistanceText} from '../web/practice-assistance-locales.js';

// Synthetic verifier inputs only: no audio, screenshot capture or browser pass
// is fabricated, claimed or published by these pure contract tests.
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const passing = ASSISTANCE_PREVIEW_CASES.map((row, index) => `ok ${index + 1} - ${row.name}`).join('\n');
function contractPng(width = 2, height = 2) {
  const chunk = (type, data) => {
    const bytes = Buffer.alloc(data.length + 12); bytes.writeUInt32BE(data.length); bytes.write(type, 4); data.copy(bytes, 8);
    let crc = 0xffffffff; for (const value of bytes.subarray(4, -4)) { crc ^= value; for (let bit = 0; bit < 8; bit++) crc = crc >>> 1 ^ ((crc & 1) ? 0xedb88320 : 0); }
    bytes.writeUInt32BE((crc ^ 0xffffffff) >>> 0, bytes.length - 4); return bytes;
  };
  const header = Buffer.alloc(13); header.writeUInt32BE(width); header.writeUInt32BE(height, 4); header[8] = 8; header[9] = 2;
  return Buffer.concat([Buffer.from('89504e470d0a1a0a', 'hex'), chunk('IHDR', header), chunk('IDAT', deflateSync(Buffer.alloc((width * 3 + 1) * height))), chunk('IEND', Buffer.alloc(0))]);
}
function presetUi(id, settings, checked = null) {
  const {algorithm_id, ...limits} = settings, coverage = checked?.coverage;
  return {preset: id, settings: limits, state: checked ? 'checked' : 'unchecked', unitsHidden: !checked,
    status: checked ? assistanceText('en', 'counts', {human: coverage.human_target_count, machine: coverage.machine_occurrence_count}) + (checked.scored_mode_allowed ? '' : ' · ' + assistanceText('en', 'noScore')) : assistanceText('en', 'unchecked'),
    units: checked ? assistanceText('en', 'units', {human: coverage.human_source_unit_count, machine: coverage.machine_source_unit_count, total: coverage.source_unit_count}) : ''};
}
function presetEvidence() {
  const canonical = JSON.parse(readFileSync(new URL('./fixtures/assistance-canonical.json', import.meta.url))), oracle = assistanceCanonicalPresetFixture();
  const presetChecks = ['single', 'balanced', 'dense'].map(id => {
    const settings = assistancePresetSettings(id), response = oracle.presets[id].response;
    return {id, gesture: {type: 'change', id: 'song-mod-assistance-preset', value: id, trusted: true}, unchecked: presetUi(id, settings), request: {score: canonical.compilation.score, selection: oracle.selection, settings}, response, view: presetUi(id, settings, response.checked)};
  });
  // Only finite synthetic geometry exercises the verifier; it never proves layout.
  const presetLayouts = [{width: 1280, height: 720}, {width: 390, height: 844}].map(viewport => ({viewport, keyboard: {focused: 'song-mod-assistance-preset', event: {id: 'song-mod-assistance-preset', type: 'keydown', key: 'Home', trusted: true}}, documentWidth: viewport.width, content: {width: viewport.width - 32, scrollWidth: viewport.width - 32}, label: 'Keyboard configuration', description: assistanceText('en', 'model'),
    options: ['single', 'balanced', 'dense', 'custom'].map(value => ({value, disabled: value === 'custom', text: value === 'custom' ? assistanceText('en', 'custom') : assistanceText('en', 'presetOption', {name: assistanceText('en', 'preset_' + value), ...assistancePresetSettings(value)})})),
    controls: ['song-mod-assistance-preset', ...Object.keys(assistancePresetSettings('single')).filter(key => key !== 'algorithm_id').map(key => 'song-mod-assistance-' + key), 'song-mod-assistance-check', 'song-mod-apply', 'song-mod-cancel'].map(id => ({id, rect: {x: 16, y: 16, width: viewport.width - 64, height: 32}, hit: true}))}));
  const settings = canonical.automatic.checked.plan.settings, customChecked = presetUi('custom', settings, canonical.automatic.checked);
  return {importedCompilation: canonical.compilation, checked: canonical.automatic, presetChecks, presetLayouts, namedReopened: presetChecks[0].view, customUnchecked: presetUi('custom', settings), customChecked, customReopened: customChecked, canceledPreset: presetChecks[2], canceledClock: {running: false}};
}
function fixture(t) {
  const directory = mkdtempSync(join(tmpdir(), 'wmh-assistance-verifier-')); t.after(() => rmSync(directory, {recursive: true, force: true}));
  const write = (name, bytes) => writeFileSync(join(directory, name), bytes);
  write('assistance.tap', passing);
  for (const row of ASSISTANCE_PREVIEW_CASES) {
    write(row.report, JSON.stringify({version: 1, case: row.caseId, label: 'final', scope: row.scope, pageErrors: [], ...(row === ASSISTANCE_PREVIEW_CASES[0] ? presetEvidence() : {})}));
    write(row.screenshot, contractPng());
  }
  for (const row of ASSISTANCE_PRESET_LAYOUT_CHECKPOINTS) {
    const presetLayouts = presetEvidence().presetLayouts.filter(layout => layout.viewport.width === row.width);
    write(row.report, JSON.stringify({version: 1, case: row.caseId, label: row.label, scope: row.scope, pageErrors: [], presetLayouts}));
    write(row.screenshot, contractPng(row.width, row.height));
  }
  return {directory, write, verify: () => verifyUiPreviewAssistance(directory)};
}

test('assistance preview requires all six exact non-skipped passes from its separate TAP file', t => {
  const f = fixture(t);
  for (const row of ASSISTANCE_PREVIEW_CASES) for (const replacement of [row.name + ' extra', row.name + ' # SKIP filtered', row.name + ' # TODO pending', 'different case']) {
    f.write('assistance.tap', passing.replace(row.name, replacement)); assert.throws(f.verify, /passing assistance case/);
  }
  for (const text of [passing.replace(/^ok /, 'not ok '), passing + '\nok 7 - ' + ASSISTANCE_PREVIEW_CASES[0].name,
    passing.split('\n').slice(1).join('\n'), passing + '\nBail out! interrupted']) {
    f.write('assistance.tap', text); assert.throws(f.verify);
  }
  unlinkSync(join(f.directory, 'assistance.tap')); f.write('tests.tap', passing); assert.throws(f.verify, /ENOENT/);
});

test('assistance preview hashes the separate TAP and every deterministic final JSON and PNG pair', t => {
  const f = fixture(t), files = f.verify(); assert.equal(files.length, 17);
  assert.deepEqual(files.map(row => row.name), ['assistance.tap', ...[...ASSISTANCE_PREVIEW_CASES, ...ASSISTANCE_PRESET_LAYOUT_CHECKPOINTS].flatMap(row => [row.report, row.screenshot])]);
  for (const file of files) { const bytes = readFileSync(join(f.directory, file.name)); assert.equal(file.bytes, bytes.length); assert.equal(file.sha256, sha(bytes)); }
  assert.ok(files.filter(file => file.name.endsWith('-final.png')).every(file => file.width === 2 && file.height === 2));
  for (const row of ASSISTANCE_PRESET_LAYOUT_CHECKPOINTS) { const png = files.find(file => file.name === row.screenshot); assert.equal(png.width, row.width); assert.equal(png.height, row.height); }
  assert.match(ASSISTANCE_PREVIEW_CASES[4].scope, /fixture replay.*not desktop native acceptance/);
  assert.match(ASSISTANCE_PREVIEW_CASES[5].scope, /endpoint fault injection.*not large\/private-song GUI acceptance/);
});

test('assistance preview rejects wrong checkpoint identity, version, phase, scope and application errors', t => {
  const f = fixture(t);
  for (const row of ASSISTANCE_PREVIEW_CASES) {
    const source = readFileSync(join(f.directory, row.report));
    for (const mutate of [value => { value.version = 2; }, value => { value.case = 'another-source'; }, value => { value.label = 'checked'; },
      value => { delete value.pageErrors; }, value => { value.pageErrors = ['uncaught failure']; }, value => { value.scope = 'native acceptance'; }]) {
      const value = JSON.parse(source); mutate(value); f.write(row.report, JSON.stringify(value)); assert.throws(f.verify);
    }
    f.write(row.report, source);
  }
});

test('assistance preview rejects absent, unreadable JSON, oversized and non-PNG final evidence', t => {
  const f = fixture(t), row = ASSISTANCE_PREVIEW_CASES[0];
  for (const [name, invalid] of [['assistance.tap', [Buffer.alloc(1024 * 1024 + 1), Buffer.from([0xff])]],
    [row.report, [Buffer.alloc(4 * 1024 * 1024 + 1), Buffer.from('{broken'), Buffer.from([0xff])]],
    [row.screenshot, [Buffer.alloc(8 * 1024 * 1024 + 1), Buffer.from('not PNG'), contractPng().subarray(0, 33), Buffer.concat([contractPng(), Buffer.from('trailing')])]]]) {
    const original = readFileSync(join(f.directory, name)); unlinkSync(join(f.directory, name)); assert.throws(f.verify);
    for (const bytes of invalid) { f.write(name, bytes); assert.throws(f.verify); }
    f.write(name, original);
  }
  const oversized = contractPng(); oversized.writeUInt32BE(0xffffffff, 16); f.write(row.screenshot, oversized); assert.throws(f.verify, /pixel budget/);
});

test('assistance preview refuses symlinked evidence files and directories', {skip: process.platform === 'win32'}, t => {
  const f = fixture(t), row = ASSISTANCE_PREVIEW_CASES[0];
  for (const name of ['assistance.tap', row.report, row.screenshot]) {
    const path = join(f.directory, name), original = readFileSync(path), target = join(f.directory, `original-${name}`);
    writeFileSync(target, original); unlinkSync(path); symlinkSync(target, path); assert.throws(f.verify, /ordinary evidence file/);
    unlinkSync(path); writeFileSync(path, original);
  }
  const link = `${f.directory}-link`; symlinkSync(f.directory, link); t.after(() => unlinkSync(link));
  assert.throws(() => verifyUiPreviewAssistance(link), /ordinary assistance evidence directory/);
});

test('assistance browser producer and mandatory preview verifier share all six final identities', () => {
  const browser = readFileSync(new URL('./assistance-app-browser.test.js', import.meta.url), 'utf8');
  for (const row of ASSISTANCE_PREVIEW_CASES) assert.ok(browser.includes(`test('${row.name}'`), row.name);
  assert.ok(browser.includes("await checkpoint('final')")); assert.ok(browser.includes('case: caseName, label, scope'));
  const verifier = readFileSync(new URL('../scripts/verify-ui-preview.mjs', import.meta.url), 'utf8');
  assert.ok(verifier.includes('files.push(...verifyUiPreviewAssistance(directory))'));
  assert.ok(verifier.includes('names.push(...ASSISTANCE_PREVIEW_CASES.map(row=>row.name))'));
});


test('named preview evidence retains actual Rust outputs without assuming nested ownership', () => {
  const value = presetEvidence(); validateAssistancePresetEvidence(value);
  for (const mutate of [v => v.presetChecks.pop(), v => v.presetChecks[0].gesture.trusted = false,
    v => v.presetChecks[1].request.settings.min_onset_interval_ms++, v => v.presetChecks[2].response.checked.machine_occurrence_ids = [],
    v => v.presetChecks[0].view.status = '99 human targets · 0 machine occurrences', v => v.presetChecks[1].unchecked.units = 'stale counts',
    v => v.customUnchecked.state = 'checked', v => v.customChecked.unitsHidden = true, v => v.namedReopened.preset = 'custom',
    v => v.customReopened.settings.min_onset_interval_ms++, v => v.canceledClock.running = true]) {
    const mutated = structuredClone(presetEvidence()); mutate(mutated); assert.throws(() => validateAssistancePresetEvidence(mutated));
  }
});
test('Mod layout oracle rejects clipped controls, overflow, missing labels and shortened native options', () => {
  for (const layout of presetEvidence().presetLayouts) {
    validateAssistanceModLayout(layout);
    for (const mutate of [v => v.documentWidth += 2, v => v.content.scrollWidth += 2, v => v.label = '', v => v.description = '', v => v.keyboard.event.trusted = false, v => v.keyboard.focused = 'other',
      v => v.options[0].text = 'Single', v => v.options[3].disabled = false, v => v.controls.pop(),
      v => v.controls[0].hit = false, v => v.controls[1].rect.x = -2, v => v.controls[2].rect.y = v.viewport.height]) {
      const mutated = structuredClone(layout); mutate(mutated);
      assert.throws(() => validateAssistanceModLayout(mutated));
    }
  }
});

test('measured Mod checkpoints require both exact viewport screenshots and matching retained geometry', t => {
  const f = fixture(t);
  for (const row of ASSISTANCE_PRESET_LAYOUT_CHECKPOINTS) {
    const json = readFileSync(join(f.directory, row.report)), png = readFileSync(join(f.directory, row.screenshot));
    f.write(row.screenshot, contractPng()); assert.throws(f.verify, /exact viewport/); f.write(row.screenshot, png);
    const value = JSON.parse(json); value.presetLayouts[0].controls[0].hit = false; f.write(row.report, JSON.stringify(value)); assert.throws(f.verify, /pointer hit/); f.write(row.report, json);
    unlinkSync(join(f.directory, row.report)); assert.throws(f.verify, /ENOENT/); f.write(row.report, json);
  }
});
