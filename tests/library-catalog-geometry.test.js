// Synthetic geometry/PNG protocol tests only. No browser, GUI, or acceptance claims.
import test from 'node:test';
import assert from 'node:assert/strict';
import {deflateSync} from 'node:zlib';
import {CATALOG_ACCEPTANCE_PHASES, catalogSha256 as sha256} from '../scripts/prepare-library-catalog-acceptance.mjs';
import {CATALOG_SOURCE_FILES, validateCatalogScreenshot, validateCatalogPhaseSequence, validateCatalogNativePhaseCaptures, validateCatalogDiagnosticScreenshot} from '../scripts/verify-library-catalog-acceptance.mjs';
import {validateCatalogNativeRenderer, validateCatalogNativeGeometry, validateCatalogNativeCaptureStable, validateCatalogNativeClick} from '../scripts/catalog-native-geometry.mjs';

function fixture({phase = 'catalog-seed', processId = 101, width = 1024, height = 689, dpr = 1, pixelsWidth = Math.round(width * dpr), pixelsHeight = Math.round(height * dpr), origin = [0, 31]} = {}) {
  const renderer = {width, height, device_pixel_ratio: dpr, document_client: {width, height}, visual_viewport: {width: pixelsWidth / dpr, height: pixelsHeight / dpr, scale: 1, offset_left: 0, offset_top: 0}};
  const geometry = {version: 1, kind: 'native-window-geometry', phase, stage: `native-${phase}`, process_id: processId, owner_process_id: processId, hwnd: processId * 10, root_hwnd: processId * 10, foreground_hwnd: processId * 10, client_rect: [0, 0, pixelsWidth, pixelsHeight], client_origin: origin, window_rect: [origin[0] - 8, origin[1] - 31, origin[0] + pixelsWidth + 8, origin[1] + pixelsHeight + 8], monitor_rect: [0, 0, Math.max(1024, pixelsWidth), Math.max(768, pixelsHeight + 31)], work_area: [0, 0, Math.max(1024, pixelsWidth), pixelsHeight + 31], window_dpi: 96 * dpr, monitor_scale_percent: 100 * dpr, monitor_scale_hresult: 0, window_awareness: 1, caller_awareness: 1, renderer: structuredClone(renderer), reported_viewport: [width, height]};
  return {geometry, options: {phase, processId, renderer, layout: {width, height, locale: 'zh-CN'}}};
}
function captureFixture() {
  const value = fixture(); value.options.capture = true; value.options.reportedViewport = [1024, 689];
  value.geometry.stage = 'native-action-catalog-seed-4'; value.geometry.renderer = null;
  return value;
}
function clickFixture() {
  const value = captureFixture(), action = {x: 307.3, y: 245.7, width: 1024, height: 689};
  const requested = [307, 276], point = {client: value.geometry.client_rect.slice(), origin: value.geometry.client_origin.slice(), viewport: [1024, 689], requested, actual: requested.slice(), work_area: value.geometry.work_area.slice(), app_hwnd: 1010, foreground: 1010, hit_hwnd: 1020, hit_root: 1010};
  return {...value, action, point};
}
function syntheticPng(width, height) {
  const crc = bytes => { let value = 0xffffffff; for (const byte of bytes) { value ^= byte; for (let bit = 0; bit < 8; bit++) value = value >>> 1 ^ ((value & 1) ? 0xedb88320 : 0); } return (value ^ 0xffffffff) >>> 0; };
  const chunk = (name, bytes) => { const header = Buffer.alloc(8), tail = Buffer.alloc(4); header.writeUInt32BE(bytes.length); header.write(name, 4); tail.writeUInt32BE(crc(Buffer.concat([Buffer.from(name), bytes]))); return Buffer.concat([header, bytes, tail]); };
  const header = Buffer.alloc(13); header.writeUInt32BE(width); header.writeUInt32BE(height, 4); header[8] = 8; header[9] = 2;
  const pixels = Buffer.alloc((width * 3 + 1) * height); for (let y = 0; y < height; y++) for (let x = 0; x < width * 3; x++) pixels[y * (width * 3 + 1) + x + 1] = (x * y + x + y) % 256;
  return Buffer.concat([Buffer.from('89504e470d0a1a0a', 'hex'), chunk('IHDR', header), chunk('IDAT', deflateSync(pixels)), chunk('IEND', Buffer.alloc(0))]);
}
const imageRow = (bytes, width, height, file = 'native-catalog-seed.png') => ({file, geometry_file: `geometry-${file.slice(0, -4)}.json`, phase: 'catalog-seed', width, height, bytes: bytes.length, sha256: sha256(bytes), locale: 'zh-CN'});
const rejectsEdits = (original, edits, check) => { for (const [label, edit] of edits) { const value = structuredClone(original); edit(value); assert.throws(() => check(value), undefined, label); } };

test('native geometry accepts the actual 1024×689 visible client with unscaled pixels and invisible borders', () => {
  const {geometry, options} = fixture();
  assert.deepEqual(validateCatalogNativeGeometry(geometry, options), {width: 1024, height: 689, css_width: 1024, css_height: 689, device_pixel_ratio: 1});
  assert.ok(geometry.window_rect[0] < geometry.work_area[0]);
  assert.ok(geometry.window_rect[3] > geometry.work_area[3]);
  for (const awareness of [0, 1, 2]) assert.doesNotThrow(() => validateCatalogNativeGeometry({...geometry, caller_awareness: awareness, window_awareness: awareness}, options));
});

test('independent native geometry rejects missing or swapped phase/process/window ownership', () => {
  const value = fixture();
  rejectsEdits(value, [
    ['missing geometry', v => v.geometry = undefined], ['missing renderer', v => delete v.options.renderer],
    ['wrong phase', v => v.geometry.phase = 'catalog-final'], ['wrong PID', v => v.geometry.process_id++],
    ['wrong owner PID', v => v.geometry.owner_process_id++], ['missing independent PID', v => delete v.options.processId],
    ['foreign root', v => v.geometry.root_hwnd++], ['foreign foreground', v => v.geometry.foreground_hwnd++],
    ['null HWND', v => v.geometry.hwnd = 0], ['unsafe HWND', v => v.geometry.hwnd = Number.MAX_SAFE_INTEGER + 1],
    ['forged renderer binding', v => v.geometry.renderer.width++], ['wrong layout locale', v => v.options.layout.locale = 'en'],
    ['wrong geometry format', v => v.geometry.kind = 'diagnostic-only'], ['unsupported geometry version', v => v.geometry.version++],
  ], v => validateCatalogNativeGeometry(v.geometry, v.options));
});

test('native viewport bounds cannot be relaxed by arbitrary dimensions, nonfinite DPR, or zoom', () => {
  const {options} = fixture();
  rejectsEdits(options.renderer, [
    ['too narrow', r => r.width = 899], ['too short', r => r.height = 639],
    ['too wide', r => r.width = 1281], ['too tall', r => r.height = 721], ['fractional layout', r => r.width = 1024.5],
    ['zero DPR', r => r.device_pixel_ratio = 0], ['negative DPR', r => r.device_pixel_ratio = -1],
    ['infinite DPR', r => r.device_pixel_ratio = Infinity], ['NaN DPR', r => r.device_pixel_ratio = NaN],
    ['missing DPR', r => delete r.device_pixel_ratio], ['missing document client', r => delete r.document_client],
    ['document client larger than inner width', r => r.document_client.width++], ['document client larger than inner height', r => r.document_client.height++],
    ['fractional document client', r => r.document_client.width = 1000.5], ['nonfinite document client', r => r.document_client.height = Infinity],
    ['narrow visible document client', r => r.document_client.width = 899], ['short visible document client', r => r.document_client.height = 639],
    ['mismatched document client', r => r.document_client.width--], ['missing visual viewport observation', r => delete r.visual_viewport],
    ['pinch zoom', r => r.visual_viewport.scale = 1.1], ['infinite zoom', r => r.visual_viewport.scale = Infinity],
    ['offset view', r => r.visual_viewport.offset_left = 1], ['vertical offset', r => r.visual_viewport.offset_top = 1],
    ['clipped visual width', r => r.visual_viewport.width -= 1], ['clipped visual height', r => r.visual_viewport.height -= 1],
  ], validateCatalogNativeRenderer);
  assert.doesNotThrow(() => validateCatalogNativeRenderer({...options.renderer, visual_viewport: null}));
  for (const [width, height] of [[900, 640], [1280, 720]]) {
    const value = fixture({width, height}); assert.doesNotThrow(() => validateCatalogNativeGeometry(value.geometry, value.options));
  }
});

test('native DPI evidence allows only CSS integer rounding with uniform physical scale', () => {
  const value = fixture({width: 1001, height: 681, dpr: 1.25});
  assert.doesNotThrow(() => validateCatalogNativeGeometry(value.geometry, value.options));
  rejectsEdits(value, [
    ['physical width mismatch', v => v.geometry.client_rect[2]--], ['physical height mismatch', v => v.geometry.client_rect[3]--],
    ['anisotropic pixels', v => v.geometry.client_rect[2] -= 10], ['window DPI mismatch', v => v.geometry.window_dpi = 96],
    ['monitor scaling mismatch', v => v.geometry.monitor_scale_percent = 100], ['failed monitor measurement', v => v.geometry.monitor_scale_hresult = -2147024891],
    ['missing monitor success', v => delete v.geometry.monitor_scale_hresult], ['missing monitor scale', v => delete v.geometry.monitor_scale_percent],
    ['fractional window DPI', v => v.geometry.window_dpi = 120.5], ['invalid window awareness', v => v.geometry.window_awareness = -1],
    ['invalid caller awareness', v => v.geometry.caller_awareness = 3], ['invented visual pixels', v => { v.options.renderer.visual_viewport.width = 1002; v.geometry.renderer = structuredClone(v.options.renderer); }],
  ], v => validateCatalogNativeGeometry(v.geometry, v.options));
  // A missing VisualViewport API still permits only the half-CSS-pixel rounding bound.
  const noVisual = fixture({width: 1001, height: 681, dpr: 1.25}); noVisual.options.renderer.visual_viewport = noVisual.geometry.renderer.visual_viewport = null;
  assert.doesNotThrow(() => validateCatalogNativeGeometry(noVisual.geometry, noVisual.options));
  noVisual.geometry.client_rect[2]--;
  assert.throws(() => validateCatalogNativeGeometry(noVisual.geometry, noVisual.options), /physical width/);
});

test('recorded root scrollbars preserve full physical client pixels and visible document bounds', () => {
  const value = fixture({width: 1000, height: 680, dpr: 1.25});
  const renderer = value.options.renderer;
  renderer.document_client = {width: 985, height: 665};
  renderer.visual_viewport = {width: 985.2, height: 665.2, scale: 1, offset_left: 0, offset_top: 0};
  value.geometry.renderer = structuredClone(renderer);
  assert.deepEqual(validateCatalogNativeGeometry(value.geometry, value.options), {width: 1250, height: 850, css_width: 1000, css_height: 680, device_pixel_ratio: 1.25});
  const bytes = syntheticPng(1250, 850);
  assert.doesNotThrow(() => validateCatalogScreenshot(bytes, imageRow(bytes, 1250, 850), {...value.options, geometry: value.geometry}));
  for (const axis of ['width', 'height']) {
    const changed = structuredClone(value); changed.options.renderer.document_client[axis]--; changed.geometry.renderer = structuredClone(changed.options.renderer);
    assert.throws(() => validateCatalogNativeGeometry(changed.geometry, changed.options), /recorded document client/);
  }
  const missing = structuredClone(value); delete missing.options.renderer.document_client; missing.geometry.renderer = structuredClone(missing.options.renderer);
  assert.throws(() => validateCatalogNativeGeometry(missing.geometry, missing.options), /document client observation/);
});

test('native client must be fully inside its independently measured work area, monitor and window', () => {
  const value = fixture();
  rejectsEdits(value, [
    ['left offscreen', v => v.geometry.client_origin[0]--], ['bottom offscreen', v => v.geometry.client_origin[1]++],
    ['client outside window', v => v.geometry.window_rect[0] = 1], ['work area outside monitor', v => v.geometry.work_area[2]++],
    ['work area clips client', v => v.geometry.work_area[3]--], ['monitor clips client', v => { v.geometry.monitor_rect[3] = 700; v.geometry.work_area[3] = 700; }],
    ['nonzero client origin', v => v.geometry.client_rect[0] = 1], ['fractional physical origin', v => v.geometry.client_origin[0] = 0.5],
    ['bad rectangle length', v => v.geometry.client_rect.push(1)], ['inverted rectangle', v => v.geometry.window_rect[2] = -10],
    ['nonfinite monitor', v => v.geometry.monitor_rect[2] = Infinity],
  ], v => validateCatalogNativeGeometry(v.geometry, v.options));
  const negative = fixture();
  for (const field of ['window_rect', 'monitor_rect', 'work_area']) { negative.geometry[field][0] -= 1024; negative.geometry[field][2] -= 1024; }
  negative.geometry.client_origin[0] -= 1024;
  assert.doesNotThrow(() => validateCatalogNativeGeometry(negative.geometry, negative.options));
});

test('per-action measurement binds actual viewport and stable phase client geometry', () => {
  const capture = captureFixture(), phase = fixture();
  assert.doesNotThrow(() => validateCatalogNativeGeometry(capture.geometry, capture.options));
  assert.doesNotThrow(() => validateCatalogNativeCaptureStable(capture.geometry, phase.geometry));
  rejectsEdits(capture, [
    ['missing action viewport', v => delete v.geometry.reported_viewport], ['wrong action viewport', v => v.geometry.reported_viewport[0]--],
    ['invented action renderer', v => v.geometry.renderer = v.options.renderer], ['swapped stage', v => { v.geometry.stage = 'native-action-catalog-seed-3'; v.options.stage = 'native-action-catalog-seed-4'; }],
  ], v => validateCatalogNativeGeometry(v.geometry, v.options));
  for (const field of ['client_origin', 'client_rect', 'work_area', 'window_rect', 'monitor_rect']) {
    const changed = structuredClone(capture.geometry); changed[field][0]++;
    assert.throws(() => validateCatalogNativeCaptureStable(changed, phase.geometry), undefined, field);
  }
});

test('native trusted click recomputes physical coordinates and rejects spoofed geometry/ownership', () => {
  const value = clickFixture(); assert.doesNotThrow(() => validateCatalogNativeClick(value.point, value.action, value.geometry));
  rejectsEdits(value, [
    ['forged client rect', v => v.point.client[2]++], ['forged client origin', v => v.point.origin[1]++],
    ['forged work area', v => v.point.work_area[3]++], ['forged viewport', v => v.point.viewport[0]++],
    ['mutually forged viewport', v => { v.point.viewport[0]++; v.action.width++; }],
    ['wrong app window', v => v.point.app_hwnd++], ['wrong foreground', v => v.point.foreground++],
    ['foreign hit root', v => v.point.hit_root++], ['null hit', v => v.point.hit_hwnd = 0],
    ['clipped pointer', v => v.point.actual[0]--], ['mutually forged pointer', v => { v.point.actual[0]--; v.point.requested[0]--; }],
    ['target outside CSS viewport', v => v.action.x = v.action.width], ['NaN target', v => v.action.x = NaN],
  ], v => validateCatalogNativeClick(v.point, v.action, v.geometry));
  const scaled = fixture({width: 1000, height: 680, dpr: 1.25});
  const action = {x: 307.3, y: 245.7, width: 1000, height: 680}, point = {...value.point, client: scaled.geometry.client_rect, origin: scaled.geometry.client_origin, viewport: [1000, 680], work_area: scaled.geometry.work_area, requested: [384, 338], actual: [384, 338]};
  assert.doesNotThrow(() => validateCatalogNativeClick(point, action, scaled.geometry));
});

test('all three native phases require stable CSS/client/DPR and independent fresh process identities', () => {
  const phases = CATALOG_ACCEPTANCE_PHASES.map((phase, index) => fixture({phase, processId: 101 + index}));
  const reports = phases.map(({geometry, options}) => ({phase: geometry.phase, layout: options.layout, geometry: options.renderer}));
  const options = {nativeGeometries: phases.map(value => value.geometry), nativeProcesses: phases.map(value => value.options.processId)};
  assert.equal(validateCatalogPhaseSequence(reports, options).length, 3);
  rejectsEdits({reports, options}, [
    ['missing geometry', v => v.options.nativeGeometries.pop()], ['swapped geometries', v => v.options.nativeGeometries.reverse()],
    ['missing phase', v => v.reports.pop()], ['reordered reports', v => v.reports.reverse()],
    ['missing expected process IDs', v => delete v.options.nativeProcesses], ['reused process', v => v.options.nativeProcesses[1] = v.options.nativeProcesses[0]],
    ['coherently changed dimensions', v => { const next = fixture({phase: 'catalog-restart', processId: 102, width: 1000, height: 680}); v.options.nativeGeometries[1] = next.geometry; v.reports[1].geometry = next.options.renderer; v.reports[1].layout = next.options.layout; }],
    ['coherently changed DPR', v => { const next = fixture({phase: 'catalog-restart', processId: 102, dpr: 1.25}); v.options.nativeGeometries[1] = next.geometry; v.reports[1].geometry = next.options.renderer; }],
    ['substitute action for final geometry', v => v.options.nativeGeometries[1].stage = 'native-action-catalog-restart-1'],
  ], v => validateCatalogPhaseSequence(v.reports, v.options));
});

test('hosted phase defaults stay exactly 1280×720 and cannot opt into arbitrary native sizes', () => {
  const reports = CATALOG_ACCEPTANCE_PHASES.map(phase => ({phase, layout: {width: 1280, height: 720, locale: 'zh-CN'}}));
  assert.equal(validateCatalogPhaseSequence(reports), null);
  const reduced = structuredClone(reports); reduced[0].layout.width = 1024; reduced[0].layout.height = 689;
  assert.throws(() => validateCatalogPhaseSequence(reduced), /Hosted catalog layout/);
  assert.throws(() => validateCatalogPhaseSequence(reduced, {nativeGeometries: []}), /three independent/);
});

test('native PNGs exactly match independent client pixels and cannot reuse another capture geometry', () => {
  const value = fixture(), bytes = syntheticPng(1024, 689), row = imageRow(bytes, 1024, 689), options = {...value.options, geometry: value.geometry};
  assert.deepEqual(validateCatalogScreenshot(bytes, row, options), {bytes: bytes.length, sha256: sha256(bytes), width: 1024, height: 689});
  rejectsEdits({row, options}, [
    ['missing independent geometry', v => delete v.options.geometry], ['forged PNG width metadata', v => v.row.width++],
    ['missing PNG dimensions', v => delete v.row.height], ['missing geometry file', v => delete v.row.geometry_file],
    ['swapped geometry file', v => v.row.geometry_file = 'geometry-native-catalog-restart.json'], ['swapped PNG phase', v => v.row.phase = 'catalog-restart'],
    ['wrong hash', v => v.row.sha256 = sha256('different pixels')], ['wrong locale', v => v.row.locale = 'en'],
    ['wrong geometry capture stage', v => v.options.geometry.stage = 'native-action-catalog-seed-1'],
  ], v => validateCatalogScreenshot(bytes, v.row, v.options));
  const differentPixels = syntheticPng(1023, 689);
  assert.throws(() => validateCatalogScreenshot(differentPixels, imageRow(differentPixels, 1024, 689), options), /Win32 client pixels/);
  const capture = captureFixture(), captured = imageRow(bytes, 1024, 689, 'native-action-catalog-seed-4.png');
  assert.doesNotThrow(() => validateCatalogScreenshot(bytes, captured, {...capture.options, geometry: capture.geometry}));
});

test('default PNG contract is still exact hosted size and hashes geometry verifier/producer sources', () => {
  const hosted = syntheticPng(1280, 720), native = syntheticPng(1024, 689);
  assert.equal(validateCatalogScreenshot(hosted, {bytes: hosted.length, sha256: sha256(hosted), locale: 'zh-CN'}).width, 1280);
  assert.throws(() => validateCatalogScreenshot(native, imageRow(native, 1024, 689)), /exact 1280/);
  assert.throws(() => validateCatalogScreenshot(native, imageRow(native, 1024, 689), {width: 1024, height: 689}));
  for (const file of ['scripts/catalog-native-geometry.mjs', 'scripts/windows-desktop-geometry.ps1']) assert.ok(CATALOG_SOURCE_FILES.includes(file));
});


test('real-run 48/24/10 formal coverage rejects all five extra picker diagnostics without dropping any capture', () => {
  const counts = [48, 24, 10], pickerSequences = [[1, 3, 5], [4, 6], []];
  const reports = CATALOG_ACCEPTANCE_PHASES.map((phase, index) => ({phase, actions: Array.from({length: counts[index]}, (_, i) => ({sequence: i + 1, kind: pickerSequences[index].includes(i + 1) ? 'picker' : 'click'}))}));
  const screenshots = reports.flatMap(({phase, actions}) => [...actions.map(action => ({phase, action: action.sequence, file: `native-action-${phase}-${action.sequence}.png`})), {phase, file: `native-${phase}.png`}]);
  const diagnostics = reports.flatMap(({phase, actions}) => actions.filter(action => action.kind === 'picker').map(({sequence}) => ({phase, action: sequence, file: `owned-picker-before-open-${phase}-${sequence}.png`, capture: 'picker-before-open', kind: 'diagnostic-only', accepted: false})));
  assert.equal(screenshots.length, 85); assert.equal(diagnostics.length, 5);
  for (const {phase, actions} of reports) {
    const validate = (images = screenshots, extra = diagnostics) => validateCatalogNativePhaseCaptures(images, extra, phase, actions);
    assert.doesNotThrow(() => validate());
    assert.throws(() => validate(screenshots.filter(image => image.file !== `native-${phase}.png`)), /exactly once/);
    assert.throws(() => validate([...screenshots, screenshots.find(image => image.phase === phase)]), /exactly once/);
    if (actions.some(action => action.kind === 'picker')) {
      assert.throws(() => validate([...screenshots, ...diagnostics], []), /exactly once/, 'original producer misclassification remains rejected');
      const image = diagnostics.find(image => image.phase === phase);
      for (const change of [{geometry_file: null}, {geometry_file: `geometry-native-action-${phase}-2.json`}, {accepted: true}, {action: 2}, {file: image.file.toUpperCase()}, {capture: 'app-client'}]) assert.throws(() => validate(screenshots, [{...image, ...change}]));
    }
  }
});

test('625×480 picker diagnostics bind original PNG bytes without claiming app-client geometry', () => {
  const bytes = syntheticPng(625, 480), image = {kind: 'diagnostic-only', accepted: false, width: 625, height: 480, bytes: bytes.length, sha256: sha256(bytes)};
  assert.doesNotThrow(() => validateCatalogDiagnosticScreenshot(bytes, image));
  for (const change of [{width: 1024}, {height: 689}, {sha256: '0'.repeat(64)}, {bytes: bytes.length + 1}, {kind: 'acceptance'}, {accepted: true}]) assert.throws(() => validateCatalogDiagnosticScreenshot(bytes, {...image, ...change}));
  assert.throws(() => validateCatalogDiagnosticScreenshot(Buffer.from('original fixture is not a PNG'), image));
  const changed = Buffer.from(bytes); changed[32] ^= 1;
  assert.throws(() => validateCatalogDiagnosticScreenshot(changed, image), /hash differs/);
});
