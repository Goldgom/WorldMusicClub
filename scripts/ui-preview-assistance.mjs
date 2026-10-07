import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {lstatSync, readFileSync} from 'node:fs';
import {join} from 'node:path';
import {inflateSync} from 'node:zlib';
import {assistancePresetSettings} from '../web/practice-assistance-receipt.js';
import {assistanceText} from '../web/practice-assistance-locales.js';

export const ASSISTANCE_PREVIEW_CASES = Object.freeze([
  'real Rust Mod keeps Original unchanged and applies same-part human scoring with machine audio',
  'real Rust delayed Check and Cancel cannot overwrite a newer numeric assignment',
  'saved assistance recipe waits for a fresh Rust rebuild after browser reload',
  'cross-scope exact unison explicitly blocks empty human scoring and retains complete notation',
  'Rust Basic and VSQ fixture replay retains real worklet gates and explicit empty-scope ownership',
  'explicit Off survives a checked Original response-limit fault and preserves the pinned take',
].map((name, index) => {
  const caseId = name.replace(/[^a-z0-9]+/gi, '-').slice(0, 100);
  const base = `worldmusichub-live-assistance-${caseId}-final`;
  return Object.freeze({name, caseId, report: `${base}.json`, screenshot: `${base}.png`,
    scope: index === 5 ? 'Actual Rust application with endpoint fault injection on a tiny original exercise; not large/private-song GUI acceptance'
      : index === 4 ? 'Rust fixture replay in Chromium AudioWorklets; not desktop native acceptance'
      : 'Actual Rust application in Chromium; not desktop package acceptance'});
}));

export const ASSISTANCE_PRESET_LAYOUT_CHECKPOINTS = Object.freeze([1280, 390].map(width => {
  const row = ASSISTANCE_PREVIEW_CASES[0], label = 'preset-layout-' + width, base = row.report.replace('-final.json', '-' + label);
  return Object.freeze({caseId: row.caseId, label, scope: row.scope, report: base + '.json', screenshot: base + '.png', width, height: width === 1280 ? 720 : 844});
}));

export function assistanceCanonicalPresetFixture() {
  return JSON.parse(readFileSync(new URL('../tests/fixtures/assistance-presets-canonical.json', import.meta.url), 'utf8'));
}

// These validators consume measured UI and actual checked responses. Preset
// names never imply nested ownership or monotonically increasing target counts.
export function validateAssistancePresetPreview(view, {id, settings, checked = null}) {
  const {algorithm_id, ...limits} = settings;
  assert.equal(algorithm_id, 'wmc-keyboard-assistance-v1'); assert.equal(view.preset, id); assert.deepEqual(view.settings, limits);
  if (checked) {
    assert.deepEqual(checked.plan.settings, settings); assert.equal(view.state, 'checked'); assert.equal(view.unitsHidden, false);
    const coverage = checked.coverage;
    assert.equal(view.status, assistanceText('en', 'counts', {human: coverage.human_target_count, machine: coverage.machine_occurrence_count}) + (checked.scored_mode_allowed ? '' : ' · ' + assistanceText('en', 'noScore')));
    assert.equal(view.units, assistanceText('en', 'units', {human: coverage.human_source_unit_count, machine: coverage.machine_source_unit_count, total: coverage.source_unit_count}));
  } else {
    assert.equal(view.state, 'unchecked'); assert.equal(view.status, assistanceText('en', 'unchecked'));
    assert.equal(view.unitsHidden, true); assert.equal(view.units, '', 'An edited draft must remove obsolete checked source counts');
  }
  return view;
}
export function validateAssistanceModLayout(layout) {
  const {width, height} = layout.viewport;
  assert.ok(width === 1280 && height === 720 || width === 390 && height === 844);
  assert.ok(layout.documentWidth <= width + 1); assert.ok(layout.content.width > 0 && layout.content.scrollWidth <= layout.content.width + 1, 'Mod must not overflow horizontally');
  assert.equal(layout.keyboard.focused, 'song-mod-assistance-preset'); assert.equal(layout.keyboard.event.id, 'song-mod-assistance-preset');
  assert.equal(layout.keyboard.event.type, 'keydown'); assert.equal(layout.keyboard.event.key, 'Home'); assert.equal(layout.keyboard.event.trusted, true);
  assert.equal(layout.label, 'Keyboard configuration'); assert.ok(layout.description.includes('Check') && layout.description.includes('Apply'));
  assert.deepEqual(layout.options.map(option => option.value), ['single', 'balanced', 'dense', 'custom']);
  for (const option of layout.options) {
    assert.equal(option.disabled, option.value === 'custom');
    assert.equal(option.text, option.value === 'custom' ? assistanceText('en', 'custom') : assistanceText('en', 'presetOption', {name: assistanceText('en', 'preset_' + option.value), ...assistancePresetSettings(option.value)}));
  }
  const ids = ['song-mod-assistance-preset', ...Object.keys(assistancePresetSettings('single')).filter(key => key !== 'algorithm_id').map(key => 'song-mod-assistance-' + key), 'song-mod-assistance-check', 'song-mod-apply', 'song-mod-cancel'];
  assert.deepEqual(layout.controls.map(control => control.id), ids);
  for (const control of layout.controls) {
    const r = control.rect; assert.ok(r.width > 0 && r.height > 0 && r.x >= -1 && r.y >= -1 && r.x + r.width <= width + 1 && r.y + r.height <= height + 1, control.id + ' remains reachable inside the viewport');
    assert.equal(control.hit, true, control.id + ' receives its own pointer hit after scrolling');
  }
  return layout;
}
export function validateAssistancePresetEvidence(value) {
  const fixture = assistanceCanonicalPresetFixture();
  const canonical = JSON.parse(readFileSync(new URL('../tests/fixtures/assistance-canonical.json', import.meta.url), 'utf8'));
  assert.deepEqual(value.importedCompilation, canonical.compilation); assert.deepEqual(value.checked, canonical.automatic);
  assert.deepEqual(value.presetChecks.map(row => row.id), ['single', 'balanced', 'dense']);
  for (const row of value.presetChecks) {
    const settings = assistancePresetSettings(row.id); assert.equal(row.gesture.trusted, true); assert.equal(row.gesture.type, 'change'); assert.equal(row.gesture.id, 'song-mod-assistance-preset'); assert.equal(row.gesture.value, row.id);
    validateAssistancePresetPreview(row.unchecked, {id: row.id, settings});
    assert.deepEqual(row.request.settings, settings); assert.deepEqual(row.request.score, value.importedCompilation.score);
    assert.deepEqual(row.request.selection, fixture.selection); assert.deepEqual(row.response, fixture.presets[row.id].response, 'Named preview must match the retained Rust API oracle');
    validateAssistancePresetPreview(row.view, {id: row.id, settings, checked: row.response.checked});
  }
  assert.deepEqual(value.presetLayouts.map(row => row.viewport), [{width: 1280, height: 720}, {width: 390, height: 844}]); value.presetLayouts.forEach(validateAssistanceModLayout);
  validateAssistancePresetPreview(value.namedReopened, {id: 'single', settings: assistancePresetSettings('single'), checked: value.presetChecks[0].response.checked});
  validateAssistancePresetPreview(value.customUnchecked, {id: 'custom', settings: value.checked.checked.plan.settings});
  validateAssistancePresetPreview(value.customChecked, {id: 'custom', settings: value.checked.checked.plan.settings, checked: value.checked.checked});
  assert.equal(value.customReopened.preset, 'custom'); assert.deepEqual(value.customReopened.settings, value.customChecked.settings);
  assert.equal(value.canceledPreset.id, 'dense'); assert.equal(value.canceledPreset.gesture.trusted, true); assert.equal(value.canceledClock.running, false);
  return value;
}

// Retained Chromium bytes only. Bounded decompression rejects header-only,
// truncated and oversized PNGs; this verifier does not manufacture pixels.
function pngSize(bytes) {
  assert.ok(bytes.length >= 45 && bytes.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex')), 'Assistance screenshot must be PNG');
  assert.equal(bytes.readUInt32BE(8), 13); assert.equal(bytes.toString('ascii', 12, 16), 'IHDR');
  const width = bytes.readUInt32BE(16), height = bytes.readUInt32BE(20), channels = bytes[25] === 2 ? 3 : bytes[25] === 6 ? 4 : 0;
  assert.ok(width > 0 && height > 0 && width <= 4096 && height <= 4096 && width * height <= 8 * 1024 * 1024, 'Assistance screenshot exceeds the finite pixel budget');
  assert.equal(bytes[24], 8); assert.ok(channels); for (const offset of [26, 27, 28]) assert.equal(bytes[offset], 0);
  const chunks = []; let offset = 8, ended = false;
  while (offset < bytes.length) {
    assert.ok(offset + 12 <= bytes.length); const length = bytes.readUInt32BE(offset), type = bytes.toString('ascii', offset + 4, offset + 8);
    assert.ok(length <= bytes.length - offset - 12);
    if (type === 'IDAT') chunks.push(bytes.subarray(offset + 8, offset + 8 + length));
    offset += length + 12;
    if (type === 'IEND') { assert.equal(length, 0); ended = true; break; }
  }
  assert.ok(ended && chunks.length); assert.equal(offset, bytes.length);
  const stride = width * channels + 1, raw = inflateSync(Buffer.concat(chunks), {maxOutputLength: stride * height});
  assert.equal(raw.length, stride * height); for (let y = 0; y < height; y++) assert.ok(raw[y * stride] <= 4);
  return {width, height};
}

export function verifyUiPreviewAssistance(directory) {
  const root = lstatSync(directory); assert.ok(root.isDirectory() && !root.isSymbolicLink(), 'Expected ordinary assistance evidence directory');
  const read = (name, limit) => {
    const path = join(directory, name), stat = lstatSync(path);
    assert.ok(stat.isFile() && !stat.isSymbolicLink() && stat.size > 0 && stat.size <= limit, `${name}: expected bounded ordinary evidence file`);
    const bytes = readFileSync(path); assert.equal(bytes.length, stat.size); return bytes;
  };
  const decode = bytes => new TextDecoder('utf-8', {fatal: true}).decode(bytes);
  // Read the separate mandatory suite, never substitute the broad UI TAP.
  const tapBytes = read('assistance.tap', 1024 * 1024), tap = decode(tapBytes);
  const rows = tap.split(/\r?\n/).filter(line => /^(?:not )?ok \d+ - /.test(line));
  assert.equal(rows.length, ASSISTANCE_PREVIEW_CASES.length, 'Expected exactly six assistance TAP cases');
  assert.ok(!/^Bail out!/im.test(tap), 'Assistance TAP bailed out');
  for (const {name} of ASSISTANCE_PREVIEW_CASES) {
    const matching = rows.filter(line => line.replace(/^(?:not )?ok \d+ - /, '').split(/\s+#/)[0] === name);
    assert.ok(matching.length === 1 && /^ok \d+ - /.test(matching[0]) && !/\s+#\s*(?:SKIP|TODO)\b/i.test(matching[0]), `Missing executed passing assistance case: ${name}`);
  }
  const record = (name, bytes) => ({name, bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex')});
  const files = [record('assistance.tap', tapBytes)];
  for (const row of [...ASSISTANCE_PREVIEW_CASES, ...ASSISTANCE_PRESET_LAYOUT_CHECKPOINTS]) {
    const json = read(row.report, 4 * 1024 * 1024), value = JSON.parse(decode(json));
    assert.equal(value.version, 1, `${row.report}: checkpoint version`);
    assert.equal(value.case, row.caseId, `${row.report}: checkpoint case`);
    assert.equal(value.label, row.label || 'final', `${row.report}: checkpoint label differs`);
    assert.equal(value.scope, row.scope, `${row.report}: browser/native scope must be explicit`);
    assert.deepEqual(value.pageErrors, [], `${row.report}: application page errors`);
    if (row === ASSISTANCE_PREVIEW_CASES[0]) validateAssistancePresetEvidence(value);
    if (row.label) { validateAssistanceModLayout(value.presetLayouts.at(-1)); assert.deepEqual(value.presetLayouts.at(-1).viewport, {width: row.width, height: row.height}); }
    const png = read(row.screenshot, 8 * 1024 * 1024), size = pngSize(png);
    if (row.label) assert.deepEqual(size, {width: row.width, height: row.height}, 'Measured Mod screenshot must keep its exact viewport');
    files.push(record(row.report, json), {...record(row.screenshot, png), ...size});
  }
  return files;
}
