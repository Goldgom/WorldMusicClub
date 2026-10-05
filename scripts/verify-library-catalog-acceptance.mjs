// Evidence verification only. Node protocol tests never establish browser or Windows acceptance.
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {lstat, readFile, readdir, writeFile} from 'node:fs/promises';
import {join, resolve} from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {validateRendererOrigin, NATIVE_PROTOCOL_ORIGIN} from './hosted-worklet-assets.mjs';
import {validateManagementHostedOrigin, validateManagementNativeBridge, validateManagementWorkletLoads} from './management-hosted-runtime.mjs';
import {validateCleanScreenshot} from './verify-native-clean-song-evidence.mjs';
import {CATALOG_ACCEPTANCE_PHASES, originalCatalogAcceptanceFixtures, catalogSha256 as sha256} from './prepare-library-catalog-acceptance.mjs';
import {checkedCatalogStatus, checkedCatalogQuery, checkedInitializePreview, checkedCatalogPreview, checkedRecoveryRecord, checkedCatalogResult, sameCatalogValue} from '../web/library-catalog-contract.js';
import {validatePerformanceRecord} from '../web/performance-library.js';
import {checkedManagementResponse, managementRequest} from '../web/library-management-contract.js';
import {assertSettledPracticeExport} from './pack-management-acceptance-fixtures.mjs';
import {validateCatalogOrganization, validateCatalogSelectedExport} from './verify-library-catalog-organization.mjs';
export {validateCatalogSelectedExport} from './verify-library-catalog-organization.mjs';
import {CATALOG_REQUESTED_VIEWPORT, CATALOG_MINIMUM_VIEWPORT, CATALOG_NATIVE_VIEWPORT_CONTRACT, CATALOG_HOSTED_VIEWPORT_CONTRACT, validateCatalogNativeGeometry, validateCatalogNativeCaptureStable, validateCatalogNativeClick, validateCatalogPhaseSequence} from './catalog-native-geometry.mjs';
export {validateCatalogPhaseSequence} from './catalog-native-geometry.mjs';

export const CATALOG_EVIDENCE_LIMITS = Object.freeze({report: 1024 * 1024, file: 16 * 1024 * 1024, files: 512, total: 32 * 1024 * 1024, actions: 64, api: 180});
export const CATALOG_SOURCE_FILES = Object.freeze([
  'scripts/prepare-library-catalog-acceptance.mjs', 'scripts/verify-library-catalog-acceptance.mjs', 'scripts/verify-library-catalog-organization.mjs', 'scripts/catalog-native-geometry.mjs',
  'crates/desktop-shell/library-catalog-acceptance.js',
  'web/performance-view.js',
  'web/piano-stage-view.js',
  'web/piano-layout-budget.js','web/piano-viewport-budget.js',
  'web/app.js', 'web/native-score-storage.js', 'web/library-selected-export.js', 'web/bulk-import.js', 'web/library-management-view.js', 'web/locales/library-management-en.js', 'web/locales/library-management-zh-CN.js', 'web/locales/library-management-schema.js', 'web/library-catalog-contract.js', 'web/library-catalog-model.js', 'web/library-catalog-view.js', 'web/library-operation-store.js', 'web/library-management.css',
  'crates/desktop-shell/src/lib.rs', 'crates/desktop-shell/src/acceptance.rs', 'crates/desktop-shell/src/catalog_product.rs', 'crates/desktop-shell/src/catalog_journal.rs', 'crates/desktop-shell/src/catalog.rs',
  'crates/desktop-shell/src/windows.rs', 'crates/desktop-shell/acceptance-wait.js', 'crates/desktop-shell/reference-acceptance.js',
  'scripts/windows-desktop-acceptance.ps1', 'scripts/windows-desktop-profile.ps1', 'scripts/windows-desktop-catalog-snapshot.ps1', 'scripts/windows-desktop-geometry.ps1', 'scripts/windows-desktop-native.cs', 'scripts/windows-desktop-evidence.ps1',
  'scripts/hosted-worklet-assets.mjs', 'scripts/management-hosted-runtime.mjs',
  'scripts/hosted-library-catalog-check.mjs', 'scripts/song-authoring-hosted-chooser.mjs',
]);
export const CATALOG_REQUIRED_CHECKS = Object.freeze({
  'catalog-seed': ['explicit-initialize-cancel-confirm', 'wrong-operation-response-cannot-confirm-owner', 'active-take-and-free-recordings-preserved', 'durable-multi-song-trash-retains-admitted-media'],
  'catalog-restart': ['new-process-reconciles-persisted-original-operation', 'exact-reimport-keeps-trash-owner', 'proved-absent-restore-retries-exact-operation', 'late-native-query-cannot-own-reopened-view', 'custom-pack-create-rename-add-and-selected-export', 'imported-source-groups-remain-readonly'],
  'catalog-final': ['second-process-restart-restores-native-and-renderer-persistence', 'custom-pack-organization-survives-second-restart'],
});
export const CATALOG_SCREENSHOTS = Object.freeze({
  'catalog-seed': ['shared-duplicate-evidence', 'exact-trash-review', 'uncertain-native-commit', 'preserved-recordings'],
  'catalog-restart': ['recovered-original-operation', 'exact-restore-review', 'restored-current-owner', 'user-pack-empty-review', 'user-pack-add-review', 'user-pack-filtered'],
  'catalog-final': ['persisted-restored-catalog', 'shared-duplicate-evidence', 'persisted-user-pack'],
});
const hash = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const uint = value => Number.isSafeInteger(value) && value >= 0;
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const ordinary = path => typeof path === 'string' && path.length > 0 && path.length < 1024 && !/[\\:\0\r\n]/.test(path) && path.split('/').every(part => part && part !== '.' && part !== '..');
const parse = bytes => JSON.parse(Buffer.isBuffer(bytes) ? bytes.toString('utf8').replace(/^\uFEFF/, '') : bytes);

export async function readCatalogEvidenceFile(directory, path, limit = CATALOG_EVIDENCE_LIMITS.file) {
  assert.ok(ordinary(path), `Unsafe catalog evidence path: ${path}`);
  let location = directory;
  assert.ok((await lstat(location)).isDirectory() && !(await lstat(location)).isSymbolicLink(), 'Evidence root must be an ordinary directory');
  for (const [index, part] of path.split('/').entries()) {
    location = join(location, part); const stat = await lstat(location);
    assert.equal(stat.isSymbolicLink(), false, 'Linked catalog evidence is forbidden');
    assert.ok(index === path.split('/').length - 1 ? stat.isFile() && stat.size <= limit : stat.isDirectory(), `Invalid bounded catalog evidence: ${path}`);
  }
  const bytes = await readFile(location); assert.ok(bytes.length <= limit); return bytes;
}

export async function catalogSourceBinding(root = fileURLToPath(new URL('../', import.meta.url))) {
  const git = (...args) => execFileSync('git', args, {cwd: root, encoding: 'utf8'}).trim();
  const source_hashes = {};
  for (const file of CATALOG_SOURCE_FILES) source_hashes[file] = sha256(await readFile(join(root, file)));
  return {source_sha: git('rev-parse', 'HEAD'), source_tree: git('rev-parse', 'HEAD^{tree}'), source_hashes};
}

export function validateCatalogSourceBinding(value, expected) {
  assert.ok(object(value) && object(expected), 'Exact independent catalog source binding is required');
  for (const key of ['source_sha', 'source_tree']) { assert.match(value[key], /^[a-f0-9]{40}$/); assert.equal(value[key], expected[key], `Catalog ${key} does not match exact verifier source`); }
  assert.ok(object(value.source_hashes) && object(expected.source_hashes), 'Catalog module hashes are required');
  for (const file of CATALOG_SOURCE_FILES) {
    assert.ok(hash(expected.source_hashes[file]) && hash(value.source_hashes[file]), `Catalog module hash missing: ${file}`);
    assert.equal(value.source_hashes[file], expected.source_hashes[file], `Catalog module changed: ${file}`);
  }
  for (const [file, digest] of Object.entries(value.source_hashes)) { assert.ok(ordinary(file) && hash(digest)); if (expected.source_hashes[file]) assert.equal(digest, expected.source_hashes[file]); }
}

export function validateCatalogScreenshot(bytes, observation, native = undefined) {
  let dimensions = CATALOG_REQUESTED_VIEWPORT;
  if (native !== undefined) {
    assert.ok(object(native), 'Independent native screenshot geometry is required');
    assert.ok(object(observation), 'Native screenshot metadata is required');
    assert.equal(observation.phase, native.phase, 'Native screenshot belongs to another phase');
    assert.ok(typeof observation.file === 'string' && /^native-(?:action-)?catalog-(?:seed|restart|final)(?:-[1-9][0-9]*)?\.png$/.test(observation.file), 'Native screenshot filename is invalid');
    const {width, height} = validateCatalogNativeGeometry(native.geometry, {...native, stage: observation.file.slice(0, -4)});
    dimensions = {width, height};
    assert.equal(observation.geometry_file, `geometry-${observation.file.slice(0, -4)}.json`, 'Native screenshot lacks its own independent geometry measurement');
    assert.deepEqual({width: observation.width, height: observation.height}, dimensions, 'Native screenshot metadata differs from independent client pixels');
  }
  assert.deepEqual(validateCleanScreenshot(bytes), dimensions, native === undefined ? 'Catalog screenshot must have exact 1280×720 pixels' : 'Native screenshot pixels differ from independent Win32 client pixels');
  assert.ok(object(observation) && observation.bytes === bytes.length && observation.sha256 === sha256(bytes), 'Catalog screenshot hash/size differs');
  assert.equal(observation.locale, 'zh-CN', 'Catalog screenshot must bind its Chinese layout observation');
  return {bytes: bytes.length, sha256: sha256(bytes), ...dimensions};
}

// Formal client captures remain an exact one-to-one set. Dialog diagnostics
// retain their own hashes and pixels, without claiming app geometry or coverage.
export function validateCatalogNativePhaseCaptures(screenshots, diagnostics, phase, actions) {
  const expectedImages = [...actions.map(action => `native-action-${phase}-${action.sequence}.png`), `native-${phase}.png`].sort();
  assert.deepEqual(screenshots.filter(image => image.phase === phase).map(image => image.file).sort(), expectedImages, 'Native captures must cover every action and phase exactly once');
  for (const image of diagnostics.filter(image => image.phase === phase)) {
    assert.equal(image.kind, 'diagnostic-only'); assert.equal(image.accepted, false);
    assert.ok(['picker-before-open', 'picker-failure', 'popup-failure'].includes(image.capture), 'Unknown catalog diagnostic capture');
    assert.ok(uint(image.action) && image.action > 0 && image.action <= actions.length && actions[image.action - 1].sequence === image.action && actions[image.action - 1].kind === 'picker', 'Catalog dialog diagnostic must bind its actual picker action');
    assert.equal(image.file, `owned-${image.capture}-${phase}-${image.action}.png`, 'Catalog dialog diagnostic filename differs');
    assert.equal(Object.hasOwn(image, 'geometry_file'), false, 'Catalog dialog diagnostic cannot borrow app geometry');
  }
}

export function validateCatalogDiagnosticScreenshot(bytes, image) {
  assert.ok(object(image) && image.kind === 'diagnostic-only' && image.accepted === false);
  assert.ok(bytes.length >= 33 && bytes.length <= CATALOG_EVIDENCE_LIMITS.file && bytes.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex')) && bytes.readUInt32BE(8) === 13 && bytes.toString('ascii', 12, 16) === 'IHDR', 'Catalog diagnostic must retain its original bounded PNG');
  const width = bytes.readUInt32BE(16), height = bytes.readUInt32BE(20);
  assert.ok(width > 0 && height > 0 && width <= 8192 && height <= 8192 && width * height <= 16777216, 'Catalog diagnostic pixels exceed their finite capture bound');
  assert.deepEqual({width: image.width, height: image.height}, {width, height}, 'Catalog diagnostic dimensions differ from raw PNG');
  assert.equal(image.bytes, bytes.length); assert.equal(image.sha256, sha256(bytes), 'Catalog diagnostic hash differs');
}

export function validateCatalogPickerProtocol(phase, sentActions, report, fixture = originalCatalogAcceptanceFixtures()) {
  assert.ok(CATALOG_ACCEPTANCE_PHASES.includes(phase));
  const expectedPickers = phase === 'catalog-seed' ? fixture.inputs.map(input => input.filename) : phase === 'catalog-restart' ? [fixture.legacy.filename, fixture.clean.filename] : [];
  const pickerActions = sentActions.filter(action => action.kind === 'picker');
  assert.deepEqual(pickerActions.map(action => action.file), expectedPickers, 'Catalog picker order must follow the explicit import protocol');
  const imports = report.api_trace.filter(row => row.path.startsWith('/api/library/import/'));
  assert.equal(imports.length, pickerActions.length * 2, 'Each picker requires exactly one preview and one commit');
  for (const [index, action] of pickerActions.entries()) {
    const input = fixture.inputs.find(row => row.filename === action.file), save = report.actions[action.sequence];
    assert.equal(save?.sequence, action.sequence + 1); assert.equal(save?.kind, 'click'); assert.equal(save?.control, 'bulk-import-save', 'Picker must be followed by its explicit Save action');
    for (const [offset, mode] of ['preview', 'commit'].entries()) {
      const row = imports[index * 2 + offset];
      assert.equal(row.path, `/api/library/import/${mode}`); assert.equal(row.action_sequence, action.sequence + offset, 'Import API belongs to a different picker or Save action');
      assert.equal(row.source, 'app'); assert.equal(row.method, 'POST'); assert.equal(row.dispatched, true); assert.equal(row.delivery, 'forwarded'); assert.equal(row.status, 200);
      assert.equal(row.request_base64, input.bytes.toString('base64'), 'Picker import request bytes differ from the chosen ORIGINAL fixture');
      assert.equal(row.request_sha256, input.sha256);
      assert.deepEqual(row.response.source, {archive_key: input.archive_key, bytes: input.bytes.length, filename: input.filename, retained: mode === 'commit', sha256: input.sha256}, 'Picker response source differs from the chosen ORIGINAL fixture');
    }
  }
  return {pickerActions, expectedPickers};
}

export function validateCatalogApiEvidence(rows) {
  assert.ok(Array.isArray(rows) && rows.length > 0 && rows.length <= CATALOG_EVIDENCE_LIMITS.api, 'Bounded actual catalog API trace required');
  const outcomes = [];
  for (const [index, row] of rows.entries()) {
    assert.equal(row.sequence, index + 1, 'Catalog API sequence is not exact');
    assert.ok(['app', 'probe'].includes(row.source)); assert.ok(typeof row.path === 'string' && /^\/api\/[a-z0-9/?=&_.-]+$/i.test(row.path));
    assert.ok(['GET', 'POST'].includes(row.method));
    assert.ok(['forwarded', 'lost-before-native', 'lost-after-native', 'wrong-operation-read', 'deferred-read'].includes(row.delivery));
    const binary = typeof row.request_base64 === 'string';
    assert.ok(row.request_base64 === undefined || row.request_base64 === null || binary, 'Malformed binary request evidence');
    const requestBytes = binary ? Buffer.from(row.request_base64, 'base64') : Buffer.from(row.request_text ?? '');
    if (binary) assert.equal(requestBytes.toString('base64'), row.request_base64, 'API request base64 is not canonical');
    assert.equal(row.request_sha256, sha256(requestBytes), 'Catalog request raw bytes do not match hash');
    if (row.request !== null && row.request !== undefined) assert.deepEqual(parse(requestBytes), row.request, 'Catalog request object differs from raw bytes');
    if (row.delivery === 'lost-before-native') {
      assert.equal(row.path, '/api/library/catalog/commit'); assert.equal(row.dispatched, false);
      assert.equal(row.dispatch_order, undefined, 'Undispatched write cannot have native dispatch order');
      for (const key of ['status', 'response', 'response_text', 'response_sha256']) assert.equal(row[key], null, 'Undispatched request must not invent a native response');
      assert.equal(row.response_binary_bytes, undefined, 'Undispatched request cannot invent binary response bytes');
      outcomes.push({...row}); continue;
    }
    assert.equal(row.dispatched, true, 'Native response needs a dispatched request');
    assert.ok(uint(row.status) && row.status >= 100 && row.status <= 599);
    if (row.path === '/api/library/pack/export' && row.status === 200) {
      assert.equal(row.source, 'app'); assert.equal(row.method, 'POST'); assert.equal(row.delivery, 'forwarded');
      assert.equal(row.response, null); assert.equal(row.response_text, null);
      assert.ok(uint(row.response_binary_bytes) && row.response_binary_bytes > 0 && row.response_binary_bytes <= CATALOG_EVIDENCE_LIMITS.file, 'Selected pack response bytes exceed the finite evidence bound');
      assert.ok(hash(row.response_sha256), 'Selected pack response needs its actual binary digest');
      assert.equal(row.wire_request, undefined); outcomes.push({...row}); continue;
    }
    assert.equal(row.response_binary_bytes, undefined, 'Binary response evidence is exclusive to successful selected pack exports');
    assert.equal(typeof row.response_text, 'string'); assert.equal(row.response_sha256, sha256(row.response_text), 'Catalog native response hash differs');
    assert.deepEqual(parse(row.response_text), row.response, 'Catalog native response differs from exact body');
    if (row.delivery === 'wrong-operation-read') {
      assert.equal(row.path, '/api/library/catalog/operation');
      assert.equal(row.wire_request_sha256, sha256(row.wire_request_text));
      assert.deepEqual(parse(row.wire_request_text), row.wire_request);
      assert.notEqual(row.wire_request.operation_id, row.request.operation_id);
      assert.equal(row.response.operation_id, row.wire_request.operation_id, 'Wrong-operation fault must expose actual unmodified native bytes');
    } else assert.equal(row.wire_request, undefined, 'Unexpected substituted native request');
    if (row.delivery === 'lost-after-native') { assert.equal(row.path, '/api/library/catalog/commit'); assert.equal(row.status, 200); assert.equal(row.response.outcome, 'committed'); }
    if (row.status === 200) {
      if (row.path === '/api/library/catalog/status') checkedCatalogStatus(row.response);
      if (row.path === '/api/library/catalog/query') checkedCatalogQuery(row.response, row.request);
      if (row.path === '/api/library/catalog/initialize/preview') checkedInitializePreview(row.response);
      if (row.path === '/api/library/catalog/preview') checkedCatalogPreview(row.response, row.request);
    }
    outcomes.push({...row});
  }
  assert.deepEqual(rows.filter(row => row.dispatched).map(row => row.dispatch_order).sort((a, b) => a - b), Array.from({length: rows.filter(row => row.dispatched).length}, (_, index) => index + 1), 'Actual native dispatch order must be unique and complete');
  return outcomes;
}

export function validateCatalogTransportSettlement(value, rows) {
  assert.ok(object(value), 'Bounded renderer transport settlement is required');
  assert.equal(value.version, 1); assert.equal(value.status, 'complete');
  assert.equal(value.admitted, rows.length); assert.equal(value.dispatched, rows.filter(row => row.dispatched).length); assert.equal(value.pending, 0);
  assert.deepEqual(value.errors, [], 'Renderer fetch/body/hash failures cannot be replaced by host replies');
  assert.deepEqual(value.late_admissions, [], 'Late application reads cannot escape the closed trace');
  for (const row of rows) assert.equal(row.observation_error, undefined, 'A failed response observation cannot claim successful evidence');
}

export function validateCatalogHostApiTrace(hostRows, rendererRows) {
  assert.ok(Array.isArray(hostRows) && hostRows.length > 0 && hostRows.length <= 256, 'Independent bounded native dispatch trace required');
  for (const [index, row] of hostRows.entries()) {
    assert.equal(row.sequence, index + 1); assert.ok(hash(row.request_sha256) && hash(row.response_sha256));
    assert.ok(uint(row.request_bytes) && uint(row.response_bytes)); assert.ok(ordinary(row.response_file));
    assert.ok(uint(row.status) && row.status >= 100 && row.status <= 599);
  }
  const tracked = path => path.startsWith('/api/library/catalog/') || path.startsWith('/api/library/import/') || ['/api/library/list', '/api/library/manage/query', '/api/library/pack/export', '/api/assess'].includes(path);
  const actual = hostRows.filter(row => tracked(row.path)), observed = rendererRows.filter(row => row.dispatched).sort((a, b) => a.dispatch_order - b.dispatch_order);
  assert.equal(actual.length, observed.length, 'Renderer evidence omitted or invented an independently dispatched native request');
  for (const [index, row] of observed.entries()) {
    const host = actual[index];
    assert.equal(host.path, row.path); assert.equal(host.method, row.method); assert.equal(host.status, row.status, `Native status differs at renderer sequence ${row.sequence}, dispatch ${row.dispatch_order}, ${row.method} ${row.path}`);
    assert.equal(host.request_sha256, row.delivery === 'wrong-operation-read' ? row.wire_request_sha256 : row.request_sha256, 'Actual native request differs from renderer transport record');
    assert.equal(host.response_sha256, row.response_sha256); assert.equal(host.response_bytes, row.path === '/api/library/pack/export' && row.status === 200 ? row.response_binary_bytes : Buffer.byteLength(row.response_text));
  }
  return observed.length;
}

const journalPath = path => /^(catalog|catalog-backups)\/(format\.json|commits\/\d{20}-operation-[a-f0-9]{32}\/(state|receipt|manifest)\.json)$/.test(path);
const receiptPath = path => /^(imports|import-backups)\/pack-[a-f0-9]{64}\/report-[^/]+\.json$/.test(path);
export function validateCatalogInventory(rows) {
  assert.ok(Array.isArray(rows) && rows.length > 0 && rows.length <= CATALOG_EVIDENCE_LIMITS.files, 'Catalog file inventory missing or unbounded');
  let total = 0; const result = new Map();
  for (const row of rows) {
    assert.ok(object(row) && ordinary(row.path) && uint(row.bytes) && hash(row.sha256), 'Invalid retained file evidence');
    assert.ok(!result.has(row.path), 'Duplicate retained file evidence'); total += row.bytes; result.set(row.path, row);
  }
  assert.ok(total <= CATALOG_EVIDENCE_LIMITS.total); return result;
}

export function validateCatalogRetainedSnapshots(before, after, {allowNewReceipts = false} = {}) {
  const old = validateCatalogInventory(before), current = validateCatalogInventory(after);
  for (const [path, row] of old) assert.deepEqual(current.get(path), row, `Retained original, backup, history, media or prior journal bytes changed: ${path}`);
  const added = after.filter(row => !old.has(row.path));
  for (const row of added) assert.ok(journalPath(row.path) || allowNewReceipts && receiptPath(row.path), `Unexpected file addition outside catalog journal/duplicate import receipt: ${row.path}`);
  for (const row of added.filter(row => receiptPath(row.path))) {
    const other = row.path.startsWith('imports/') ? row.path.replace(/^imports\//, 'import-backups/') : row.path.replace(/^import-backups\//, 'imports/');
    assert.deepEqual(current.get(other), {...row, path: other}, 'New duplicate receipt must have its exact backup');
  }
  return {retained_files: before.length, new_receipt_files: added.filter(row => receiptPath(row.path)).length, new_journal_files: added.filter(row => journalPath(row.path)).length};
}

export async function catalogLibraryInventory(directory) {
  const rows = []; let total = 0, nodes = 0;
  async function walk(folder, prefix = '') {
    assert.ok(prefix.split('/').length <= 8, 'Catalog library depth exceeded');
    for (const entry of (await readdir(folder, {withFileTypes: true})).sort((a, b) => a.name.localeCompare(b.name))) {
      assert.ok(++nodes <= 2048, 'Catalog library traversal bound exceeded');
      const path = prefix ? `${prefix}/${entry.name}` : entry.name;
      assert.ok(ordinary(path) && !entry.isSymbolicLink(), 'Linked or unsafe catalog library path');
      if (path === '.library.lock') { assert.ok(entry.isFile(), 'Library lock must be an ordinary file'); continue; }
      if (entry.isDirectory()) await walk(join(folder, entry.name), path);
      else {
        assert.ok(entry.isFile() && rows.length < CATALOG_EVIDENCE_LIMITS.files);
        const bytes = await readCatalogEvidenceFile(directory, path); total += bytes.length; assert.ok(total <= CATALOG_EVIDENCE_LIMITS.total);
        rows.push({path, bytes: bytes.length, sha256: sha256(bytes)});
      }
    }
  }
  await walk(directory); return rows.sort((a, b) => a.path.localeCompare(b.path));
}

export function validateCatalogProtocolPhases(reports, {sourceBinding, runId, fixture = originalCatalogAcceptanceFixtures(), nativeGeometries, nativeProcesses, requireOrganization = false, expectedOrigin = NATIVE_PROTOCOL_ORIGIN} = {}) {
  validateCatalogPhaseSequence(reports, {nativeGeometries, nativeProcesses});
  assert.ok(typeof runId === 'string' && runId.length >= 16 && runId.length <= 128, 'Catalog run identity required');
  const allApi = [];
  for (const report of reports) {
    assert.equal(report.version, 1); assert.equal(report.scenario, 'library-catalog'); assert.equal(report.ok, true);
    assert.equal(report.run_id, runId); assert.equal(report.origin, validateRendererOrigin(expectedOrigin));
    assert.deepEqual(report.errors, []); validateCatalogTransportSettlement(report.transport_settlement, report.api_trace); validateCatalogSourceBinding(report.source_binding, sourceBinding);
    assert.deepEqual(report.opened_score_databases, [], 'Native acceptance opened browser score fallback storage');
    assert.deepEqual(report.claims, {synthetic_clock: false, mock_success: false, private_music: false});
    assert.deepEqual([...report.checks].sort(), [...CATALOG_REQUIRED_CHECKS[report.phase]].sort());
    assert.deepEqual(Object.keys(report.screenshots).sort(), [...CATALOG_SCREENSHOTS[report.phase]].sort());
    const api = validateCatalogApiEvidence(report.api_trace); allApi.push(...api.map(row => ({...row, phase: report.phase})));
    assert.ok(Array.isArray(report.actions) && report.actions.length > 0 && report.actions.length <= CATALOG_EVIDENCE_LIMITS.actions);
    for (const [index, action] of report.actions.entries()) {
      assert.equal(action.sequence, index + 1); assert.ok(['click', 'picker', 'key-r', 'select-last', 'catalog-snapshot-before'].includes(action.kind));
      assert.ok(typeof action.control === 'string');
      for (const field of ['trusted_clicks', 'trusted_key_downs', 'trusted_key_ups']) assert.ok(uint(action[field]));
      assert.equal(action.untrusted_clicks, 0, 'Catalog control used synthetic event evidence'); assert.equal(action.completed, true);
      if (action.kind === 'select-last') {
        assert.equal(action.control, 'management-catalog-add-target'); assert.ok([1, 2].includes(action.trusted_clicks));
        assert.deepEqual(Object.keys(action.selection || {}).sort(), ['target_id', 'target_tag', 'before', 'after', 'option_values', 'selected_index', 'selected_text', 'trusted_changes', 'untrusted_changes', 'events'].sort());
        assert.equal(action.selection.target_id, action.control); assert.equal(action.selection.target_tag, 'SELECT');
        assert.equal(action.selection.before, ''); assert.match(action.selection.after, /^collection-[a-f0-9]{32}$/);
        assert.deepEqual(action.selection.option_values, ['', action.selection.after]); assert.equal(action.selection.selected_index, 1); assert.equal(action.selection.selected_text, `rr · ${action.selection.after}`);
        assert.equal(action.selection.trusted_changes, 1); assert.equal(action.selection.untrusted_changes, 0);
        const events = action.selection.events; assert.ok(Array.isArray(events) && events.length >= 2 && events.length <= 4);
        const types = events.map(event => event.type); assert.equal(types.filter(type => type === 'change').length, 1); assert.ok(types.filter(type => type === 'input').length <= 1);
        assert.ok(!types.includes('input') || types.indexOf('input') < types.indexOf('change'));
        assert.equal(events.filter(event => event.type === 'click').length, action.trusted_clicks);
        for (const event of events) { assert.ok(['click', 'input', 'change'].includes(event.type)); assert.ok((event.type === 'click' ? ['', action.selection.after] : [action.selection.after]).includes(event.value)); assert.deepEqual(event, {type: event.type, trusted: true, target_id: action.control, value: event.value}); }
      } else if (action.kind !== 'catalog-snapshot-before') { assert.equal(action.trusted_clicks, 1, 'Catalog control lacks exactly one actual trusted click'); assert.equal(action.selection, undefined); }
      if (action.kind === 'key-r') { assert.equal(action.trusted_key_downs, 1); assert.equal(action.trusted_key_ups, 1); }
      if (action.kind === 'catalog-snapshot-before') { assert.equal(report.phase, 'catalog-seed'); assert.equal(action.trusted_clicks, 0); }
    }
    for (const view of ['active', 'trash']) {
      const value = report.catalog[view]; checkedCatalogQuery(value, {view, limit: 100});
      assert.equal(value.next_cursor, null); assert.equal(value.total, value.rows.length);
      assert.deepEqual(value.counts, report.phase === 'catalog-seed' ? fixture.spec.expected.trashed : requireOrganization ? {...fixture.spec.expected.restored, packs: 4, memberships: 6} : fixture.spec.expected.restored);
      assert.ok(api.some(row => row.path === '/api/library/catalog/query' && row.request.view === view && JSON.stringify(row.response) === JSON.stringify(value)), `Catalog ${view} checkpoint lacks actual API bytes`);
    }
  }
  const [seed, restart, final] = reports;
  assert.equal(seed.profile.marker_before, null); assert.equal(seed.profile.recovery_before_open, null);
  for (const report of [restart, final]) assert.equal(report.profile.marker_before, runId, 'The actual shared browser profile marker did not survive process restart');
  const initial = seed.catalog.initialized;
  checkedCatalogQuery(initial, {view: 'active', limit: 100}); assert.deepEqual(initial.counts, fixture.spec.expected.initial);
  assert.deepEqual(initial.rows.map(row => row.score_id).sort(), [...fixture.spec.legacy_ids, fixture.spec.clean_id].sort());
  assert.ok(initial.rows.every(row => row.catalog_managed && row.physical_available));
  const selected = initial.rows.filter(row => fixture.spec.selected_score_ids.includes(row.score_id));
  assert.equal(selected.length, 2); assert.equal(selected.find(row => row.storage_kind === 'legacy').pack_count, 2); assert.equal(selected.find(row => row.storage_kind === 'clean').pack_count, 1);
  const packIds = [...new Set(initial.rows.flatMap(row => row.packs.map(pack => pack.import_pack_id)))].sort();
  assert.deepEqual(packIds, fixture.inputs.map(row => row.pack_id).sort(), 'Catalog pack memberships differ from the exact three imported archives');
  for (const row of initial.rows) {
    const expected = row.storage_kind === 'clean' ? [fixture.clean.pack_id] : row.score_id === fixture.spec.legacy_ids[0] ? [fixture.legacy.pack_id, fixture.shared.pack_id] : [fixture.legacy.pack_id];
    assert.deepEqual(row.packs.map(pack => pack.import_pack_id).sort(), expected.sort());
    for (const pack of row.packs) assert.equal(pack.name, fixture.inputs.find(input => input.pack_id === pack.import_pack_id).filename);
  }
  const selectedIds = selected.map(row => row.edition_id).sort();
  const initialize = seed.operations.initialize, trash = seed.operations.trash, restore = restart.operations.restore;
  for (const record of [initialize, trash, restore]) checkedRecoveryRecord(record, initial.library_id);
  assert.equal(initialize.kind, 'initialize'); assert.equal(initialize.phase, 'committed');
  assert.equal(trash.kind, 'trash_songs'); assert.equal(trash.phase, 'uncertain');
  assert.equal(restore.kind, 'restore_songs'); assert.equal(restore.phase, 'committed');
  assert.deepEqual(trash.selected.map(row => row.edition_id).sort(), selectedIds);
  assert.deepEqual(restore.selected.map(row => row.edition_id).sort(), selectedIds);
  assert.equal(trash.summary.removed_membership_count, 3); assert.equal(trash.summary.shared_song_count, 1);
  assert.equal(restore.summary.restored_membership_count, 3); assert.equal(restore.preview.request.action.trash_operation_id, trash.operation_id);
  assert.deepEqual(restart.profile.recovery_before_open, trash, 'Pending operation pointer must survive unchanged before recovery');
  assert.deepEqual(restart.profile.recovery_after_open, {...trash, phase: 'committed'}, 'Fresh process must reconcile the original operation');
  if (!requireOrganization) { assert.deepEqual(final.profile.recovery_before_open, restore); assert.deepEqual(final.profile.recovery_after_open, restore); }
  const initCalls = allApi.filter(row => row.path === '/api/library/catalog/initialize' && row.dispatched);
  assert.equal(initCalls.length, 1, 'Initialization cancellation must never submit an extra write');
  checkedCatalogResult(initCalls[0].response, initialize);
  assert.ok(seed.api_trace.filter(row => row.path === '/api/library/catalog/initialize/preview').length >= 2, 'Initialization cancel then review must be observed');
  const commits = allApi.filter(row => row.path === '/api/library/catalog/commit');
  assert.equal(commits.length, requireOrganization ? 6 : 3, 'Only original trash/restore attempts and the three required organization commits are permitted');
  const trashCalls = commits.filter(row => row.request.preview.request.operation_id === trash.operation_id);
  assert.equal(trashCalls.length, 1); assert.equal(trashCalls[0].phase, 'catalog-seed'); assert.equal(trashCalls[0].delivery, 'lost-after-native');
  checkedCatalogResult(trashCalls[0].response, trash);
  const restoreCalls = commits.filter(row => row.request.preview.request.operation_id === restore.operation_id);
  assert.equal(restoreCalls.length, 2); assert.equal(restoreCalls[0].delivery, 'lost-before-native'); assert.equal(restoreCalls[1].delivery, 'forwarded');
  assert.deepEqual(restoreCalls[0].request, restoreCalls[1].request); assert.equal(restoreCalls[0].request_sha256, restoreCalls[1].request_sha256);
  checkedCatalogResult(restoreCalls[1].response, restore);
  const wrong = allApi.filter(row => row.delivery === 'wrong-operation-read'); assert.equal(wrong.length, 1);
  assert.equal(wrong[0].request.operation_id, trash.operation_id); assert.equal(wrong[0].wire_request.operation_id, initialize.operation_id);
  const found = (phase, record, outcome) => allApi.find(row => row.phase === phase && row.path === '/api/library/catalog/operation' && row.delivery === 'forwarded' && row.request.operation_id === record.operation_id && row.response.outcome === outcome);
  const recovered = found('catalog-restart', trash, 'committed'); assert.ok(recovered, 'Restart must ask native journal for the original trash operation'); checkedCatalogResult(recovered.response, trash, {lookup: true});
  const absent = found('catalog-restart', restore, 'not_committed'); assert.ok(absent, 'Restore must be proven absent before same-ID retry'); checkedCatalogResult(absent.response, restore, {lookup: true});
  const finalFound = found('catalog-final', restore, 'committed'); assert.ok(finalFound, 'Final restart must reconcile original restore operation'); checkedCatalogResult(finalFound.response, restore, {lookup: true});
  assert.equal(allApi.filter(row => row.path.startsWith('/api/library/catalog/') && row.path.endsWith('/commit') && row.phase === 'catalog-final').length, 0);
  for (const report of [restart, final]) {
    assert.deepEqual(report.catalog.active.rows.map(row => row.edition_id).sort(), initial.rows.map(row => row.edition_id).sort());
    if (!requireOrganization) assert.deepEqual(report.catalog.active.rows.map(row => [row.edition_id, row.packs]).sort(), initial.rows.map(row => [row.edition_id, row.packs]).sort());
    assert.equal(report.catalog.trash.total, 0);
  }
  assert.deepEqual(seed.catalog.trash.rows.map(row => row.edition_id).sort(), selectedIds);
  assert.deepEqual(seed.catalog.active.rows.map(row => row.score_id), [fixture.spec.retained_score_id]);
  const imports = allApi.filter(row => row.path === '/api/library/import/commit');
  assert.equal(imports.length, 5, 'Only three original imports plus two exact reimports are permitted');
  for (const input of fixture.inputs) {
    const matches = imports.filter(row => row.request_sha256 === input.sha256);
    assert.equal(matches.length, input.role === 'shared' ? 1 : 2);
    for (const row of matches) { assert.equal(row.status, 200); assert.equal(row.response.source.sha256, input.sha256); assert.equal(row.response.source.bytes, input.bytes.length); }
    const first = matches[0]; assert.equal(first.phase, 'catalog-seed');
    assert.equal(first.response.summary[input.role === 'shared' ? 'duplicate' : 'saved'], input.role === 'legacy' ? 2 : 1);
    if (input.role !== 'shared') { assert.equal(matches[1].phase, 'catalog-restart'); assert.equal(matches[1].response.summary.duplicate, input.role === 'legacy' ? 2 : 1); }
  }
  const repeatTrash = restart.catalog.trashed; checkedCatalogQuery(repeatTrash, {view: 'trash', limit: 100});
  assert.deepEqual(repeatTrash.counts, fixture.spec.expected.trashed); assert.deepEqual(repeatTrash.rows.map(row => row.edition_id).sort(), selectedIds);
  assert.ok(repeatTrash.rows.every(row => row.trashed_by === trash.operation_id), 'Reimport must preserve exact original trash ownership');
  const deferred = allApi.filter(row => row.delivery === 'deferred-read'); assert.equal(deferred.length, 1, 'Exactly one actual old native query must complete after reopening');
  const held = deferred[0], stale = restart.stale_ownership; assert.ok(object(stale));
  assert.equal(held.phase, 'catalog-restart'); assert.equal(held.path, '/api/library/catalog/query'); assert.equal(held.request.view, 'trash'); assert.equal(held.delivery_complete, true);
  assert.equal(stale.held_sequence, held.sequence);
  const newer = restart.api_trace.find(row => row.sequence === stale.latest_active_sequence);
  assert.ok(newer && newer.path === '/api/library/catalog/query' && newer.request.view === 'active' && newer.dispatched && newer.delivery === 'forwarded');
  for (const event of [held.dispatch_event, held.response_event, newer.dispatch_event, newer.response_event, held.release_event]) assert.ok(uint(event) && event > 0, 'Native stale-query causality needs actual monotonic events');
  assert.ok(held.dispatch_event < held.response_event && held.response_event < newer.dispatch_event && newer.dispatch_event < newer.response_event && newer.response_event < held.release_event, 'Old native reply was not held across the actual newer response');
  assert.ok(uint(stale.close_action) && uint(stale.reopen_action) && stale.close_action < stale.reopen_action && stale.reopen_action < newer.action_sequence);
  assert.equal(restart.actions[stale.close_action - 1]?.control, 'management-close'); assert.equal(restart.actions[stale.reopen_action - 1]?.control, 'library-management-button');
  assert.equal(restart.actions[newer.action_sequence - 1]?.control, 'management-catalog-active');
  assert.deepEqual(stale.before, stale.after, 'Late native query changed current visible view/operation ownership');
  assert.equal(stale.before.view, 'active'); assert.equal(stale.before.operation_id, restore.operation_id);
  assert.deepEqual([...stale.before.edition_ids].sort(), initial.rows.map(row => row.edition_id).sort());
  const organization = requireOrganization ? validateCatalogOrganization(reports, {initial, restore, selectedIds, fixture, allApi}) : {};
  return {initialize, trash, restore, ...organization, selectedIds, initialRows: initial.rows, library_id: initial.library_id, api_count: allApi.length, imports, allApi};
}

export async function validateCatalogJournal(directory, rows, operations) {
  const inventory = validateCatalogInventory(rows), expectedFiles = new Set(), generations = [];
  let previous = null, genesis, previousState, previousStateDigest;
  const records = [operations.initialize, operations.trash, operations.restore];
  if (operations.create || operations.rename || operations.add) { assert.ok(operations.create && operations.rename && operations.add, 'All three organization journal records are required'); records.push(operations.create, operations.rename, operations.add); }
  for (const [generation, record] of records.entries()) {
    const folder = `commits/${String(generation).padStart(20, '0')}-${record.operation_id}`;
    const bytes = {};
    for (const name of ['state', 'receipt', 'manifest']) {
      const path = `catalog/${folder}/${name}.json`, backup = `catalog-backups/${folder}/${name}.json`;
      expectedFiles.add(path); expectedFiles.add(backup);
      bytes[name] = await readCatalogEvidenceFile(directory, path);
      assert.deepEqual(inventory.get(path), {path, bytes: bytes[name].length, sha256: sha256(bytes[name])});
      assert.deepEqual(await readCatalogEvidenceFile(directory, backup), bytes[name], 'Catalog durable generation backup differs');
      assert.deepEqual(inventory.get(backup), {...inventory.get(path), path: backup});
    }
    const manifest = parse(bytes.manifest), state = parse(bytes.state), receipt = parse(bytes.receipt);
    assert.deepEqual(manifest, {version: 1, generation, operation_id: record.operation_id, previous_manifest_sha256: previous, state: {bytes: bytes.state.length, sha256: sha256(bytes.state)}, receipt: {bytes: bytes.receipt.length, sha256: sha256(bytes.receipt)}});
    assert.equal(state.schema_version, 1); assert.equal(state.generation, generation);
    const response = operations.allApi?.find(row => row.response?.operation_id === record.operation_id && row.response?.outcome === 'committed' && row.response?.generation === generation);
    if (generation >= 3) assert.ok(response, 'Organization generation lacks its exact native committed digest');
    if (response) assert.equal(response.response.catalog_digest, sha256(bytes.state), 'Native API catalog digest differs from exact durable journal state');
    assert.equal(state.inventory.songs.length, 3); assert.equal(state.inventory.packs.length, generation >= 3 ? 4 : 3); assert.equal(state.inventory.sources.length, 3);
    assert.equal(state.inventory.memberships.length, generation === 1 ? 1 : generation === 5 ? 6 : 4);
    assert.equal(state.inventory.songs.filter(row => row.trashed_by !== null).length, generation === 1 ? 2 : 0);
    if (generation === 0) {
      assert.deepEqual(receipt, {kind: 'bootstrap', operation_id: record.operation_id, state_sha256: sha256(bytes.state)}); genesis = state;
      assert.deepEqual(state.trash, []); assert.deepEqual(state.receipts, []);
      if (operations.initialRows) {
        assert.deepEqual(state.inventory.songs.map(row => row.id).sort(), operations.initialRows.map(row => row.edition_id).sort());
        assert.deepEqual(state.inventory.memberships.map(row => `${row.id.pack}:${row.id.song}`).sort(), operations.initialRows.flatMap(row => row.packs.map(pack => `${pack.collection_id}:${row.edition_id}`)).sort());
      }
    }
    else if (generation <= 2) {
      assert.deepEqual(receipt, {kind: 'transition', receipt: {preview: record.preview}});
      assert.deepEqual(state.receipts.at(-1), {preview: record.preview});
      assert.equal(state.receipts.length, generation);
      assert.equal(state.trash.length, 1); assert.equal(state.trash[0].operation_id, operations.trash.operation_id);
      assert.equal(state.trash[0].entities.length, 2); assert.equal(state.trash[0].memberships.length, 3);
      for (const item of [...state.trash[0].entities, ...state.trash[0].memberships]) assert.equal(item.restored_by, generation === 1 ? null : operations.restore.operation_id);
      for (const key of ['sources', 'origins']) assert.deepEqual(state.inventory[key], genesis.inventory[key], 'Catalog transition changed unrelated source provenance');
      const affectedPacks = new Set(operations.trash.preview.effects.affected_packs);
      assert.deepEqual(state.inventory.packs, genesis.inventory.packs.map(pack => affectedPacks.has(pack.id) ? {...pack, revision: generation} : pack), 'Catalog transition changed pack identity or membership revision');
      const selected = new Set(operations.trash.preview.request.action.song_ids);
      assert.deepEqual(state.inventory.songs, genesis.inventory.songs.map(song => selected.has(song.id) ? {...song, revision: generation, trashed_by: generation === 1 ? operations.trash.operation_id : null} : song), 'Catalog journal changed an unselected song or lost exact trash ownership');
      assert.deepEqual(state.inventory.memberships, genesis.inventory.memberships.filter(edge => generation !== 1 || !selected.has(edge.id.song)).map(edge => generation === 2 && selected.has(edge.id.song) ? {...edge, revision: 2} : edge), 'Catalog journal failed exact membership removal/restoration');
      assert.deepEqual(state.trash[0].entities.map(item => item.before.Song), genesis.inventory.songs.filter(song => selected.has(song.id)));
      assert.deepEqual(state.trash[0].memberships.map(item => item.membership), genesis.inventory.memberships.filter(edge => selected.has(edge.id.song)));
    }
    else {
      const action = record.preview.request.action, target = operations.create.preview.request.action.pack_id;
      assert.equal(action.type, ['create_pack', 'rename_pack', 'add_memberships'][generation - 3]);
      assert.equal(action.pack_id, target); assert.equal(record.preview.request.expected_generation, generation - 1); assert.equal(record.preview.next_generation, generation);
      assert.equal(record.preview.base_digest, previousStateDigest, 'Organization preview lost its exact previous durable state');
      assert.deepEqual(receipt, {kind: 'transition', receipt: {preview: record.preview}});
      const expected = structuredClone(previousState); expected.generation = generation; expected.receipts.push({preview: record.preview});
      if (generation === 3) {
        assert.equal(action.name, 'r'); assert.ok(!expected.inventory.packs.some(pack => pack.id === target));
        expected.inventory.packs.push({id: target, name: 'r', kind: 'custom', source_archive_keys: [], origin_import_operation_id: null, revision: 3, trashed_by: null});
        expected.inventory.packs.sort((a, b) => a.id.localeCompare(b.id));
      } else {
        const pack = expected.inventory.packs.find(row => row.id === target); assert.equal(pack.kind, 'custom'); pack.revision = generation;
        if (generation === 4) { assert.equal(action.name, 'rr'); pack.name = 'rr'; }
        else {
          assert.deepEqual([...action.song_ids].sort(), [...operations.trash.preview.request.action.song_ids].sort(), 'Added memberships differ from original selected editions');
          for (const [position, song] of action.song_ids.entries()) expected.inventory.memberships.push({id: {pack: target, song}, position, added_at_unix_ms: record.preview.request.at_unix_ms, revision: 5});
          expected.inventory.memberships.sort((a, b) => a.id.pack.localeCompare(b.id.pack) || a.id.song.localeCompare(b.id.song));
        }
      }
      assert.deepEqual(state, expected, 'Organization journal changed an unrelated song, source, tombstone, receipt, imported group or exact custom pack metadata/edge');
    }
    previousState = state; previousStateDigest = sha256(bytes.state);
    generations.push({generation, operation_id: record.operation_id, manifest_sha256: sha256(bytes.manifest)}); previous = sha256(bytes.manifest);
  }
  for (const area of ['catalog', 'catalog-backups']) {
    const path = `${area}/format.json`; expectedFiles.add(path);
    const bytes = await readCatalogEvidenceFile(directory, path);
    assert.deepEqual(parse(bytes), {version: 1, genesis_manifest_sha256: generations[0].manifest_sha256});
    assert.deepEqual(inventory.get(path), {path, bytes: bytes.length, sha256: sha256(bytes)});
  }
  assert.deepEqual(rows.filter(row => row.path.startsWith('catalog/') || row.path.startsWith('catalog-backups/')).map(row => row.path).sort(), [...expectedFiles].sort(), 'Unexpected or missing journal evidence');
  assert.ok(rows.every(row => !row.path.startsWith('.catalog-staging/')), 'Final catalog has unfinished journal staging files');
  return generations;
}

export async function validateCatalogOriginalPayload(directory, rows, fixture, initialImports) {
  const inventory = validateCatalogInventory(rows), allowed = new Set();
  assert.equal(initialImports.length, 3);
  for (const input of fixture.inputs) for (const area of ['imports', 'import-backups']) {
    const path = `${area}/${input.archive_key}/source.bin`;
    assert.deepEqual(inventory.get(path), {path, bytes: input.bytes.length, sha256: input.sha256}, 'Exact ORIGINAL source or backup is missing');
    assert.deepEqual(await readCatalogEvidenceFile(directory, path), input.bytes);
    const source = initialImports.find(row => row.response.source.sha256 === input.sha256)?.response; assert.ok(source);
    assert.deepEqual(parse(await readCatalogEvidenceFile(directory, `${area}/${input.archive_key}/source.json`)), source.source);
    assert.deepEqual(parse(await readCatalogEvidenceFile(directory, `${area}/${input.archive_key}/inventory.json`)), source.inventory);
    for (const name of ['source.bin', 'source.json', 'inventory.json']) allowed.add(`${area}/${input.archive_key}/${name}`);
    const receipts = rows.filter(row => row.path.startsWith(`${area}/${input.archive_key}/`) && receiptPath(row.path));
    assert.equal(receipts.length, 1, 'Original baseline must have exactly one original receipt per archive and backup');
    allowed.add(receipts[0].path); assert.deepEqual(parse(await readCatalogEvidenceFile(directory, receipts[0].path)), source);
  }
  for (const area of ['songs', 'backups', 'clean-songs', 'clean-backups']) assert.ok(rows.some(row => row.path.startsWith(`${area}/`)), `Original retained ${area} evidence absent`);
  const cleanIdentity = sha256(JSON.stringify(fixture.cleanFixture.metadata)), cleanKey = `song-${cleanIdentity}`;
  for (const area of ['clean-songs', 'clean-backups']) for (const row of fixture.spec.clean_files) {
    const path = `${area}/${cleanKey}/package/${row.path}`;
    assert.deepEqual(inventory.get(path), {...row, path}, 'Exact original clean package/media bytes changed');
    allowed.add(path);
  }
  const entries = initialImports.flatMap(row => row.response.items).filter(item => item.status === 'saved').map(item => item.entry);
  assert.equal(entries.length, 3);
  for (const entry of entries) {
    assert.ok([...fixture.spec.legacy_ids, fixture.spec.clean_id].includes(entry.score_id));
    const clean = entry.library_format_version === 2, areas = clean ? ['clean-songs', 'clean-backups'] : ['songs', 'backups'];
    for (const area of areas) {
      const metadata = `${area}/${entry.key}/${clean ? 'entry' : 'metadata'}.json`; allowed.add(metadata);
      assert.deepEqual(parse(await readCatalogEvidenceFile(directory, metadata)), entry, 'Retained song metadata differs from real import receipt');
      if (!clean) {
        const score = `${area}/${entry.key}/score.json`, retained = `${area}/${entry.key}/source.payload`; allowed.add(score); allowed.add(retained);
        assert.deepEqual(inventory.get(score), {path: score, bytes: entry.score_bytes, sha256: entry.score_sha256});
        assert.deepEqual(inventory.get(retained), {path: retained, bytes: entry.retained_source.bytes, sha256: entry.retained_source.sha256});
      }
    }
  }
  assert.deepEqual([...inventory.keys()].sort(), [...allowed].sort(), 'Original baseline contains an unrequested or missing physical payload');
  for (const row of rows) {
    const mirror = row.path.replace(/^(songs|clean-songs|imports)\//, area => ({'songs/': 'backups/', 'clean-songs/': 'clean-backups/', 'imports/': 'import-backups/'})[area]);
    if (mirror !== row.path) assert.deepEqual(inventory.get(mirror), {...row, path: mirror}, 'Original baseline backup differs');
  }
  return {cleanKey};
}

/** Verify one hosted/native run against this checkout and the independently supplied binary. */
export async function verifyLibraryCatalogAcceptance(directory, options = {}) {
  const sourceRoot = options.sourceRoot || fileURLToPath(new URL('../', import.meta.url));
  const sourceBinding = await catalogSourceBinding(sourceRoot);
  for (const file of CATALOG_SOURCE_FILES) {
    const frozen = execFileSync('git', ['show', `${sourceBinding.source_sha}:${file}`], {cwd: sourceRoot, maxBuffer: 8 * 1024 * 1024});
    assert.equal(sourceBinding.source_hashes[file], sha256(frozen), `Catalog source bytes are not in the reported commit: ${file}`);
  }
  if (options.sourceSha) assert.equal(sourceBinding.source_sha, options.sourceSha, 'Verifier checkout differs from authorized source SHA');
  if (options.sourceTree) assert.equal(sourceBinding.source_tree, options.sourceTree, 'Verifier checkout differs from authorized source tree');
  const allNames = await readdir(directory), native = allNames.includes('native-library-catalog.json');
  const files = [];
  const read = async (path, limit = CATALOG_EVIDENCE_LIMITS.file) => { const bytes = await readCatalogEvidenceFile(directory, path, limit); files.push({path, bytes: bytes.length, sha256: sha256(bytes)}); return bytes; };
  const json = async (path, limit = CATALOG_EVIDENCE_LIMITS.report) => parse(await read(path, limit));
  const host = await json(native ? 'native-library-catalog.json' : 'report.json');
  assert.equal(host.version, 1); assert.equal(host.ok, true); assert.equal(host.scenario, 'library-catalog');
  if (!native) assert.equal(host.kind, 'original-library-catalog-hosted-real-native-stdio', 'Only real hosted-browser native-stdio evidence is accepted');
  validateCatalogSourceBinding(host, sourceBinding);
  for (const [path, digest] of Object.entries(host.source_hashes)) assert.equal(sha256(await readFile(join(sourceRoot, path))), digest, `Reported source module changed: ${path}`);
  const binary = native ? options.executable : options.driver;
  assert.ok(binary, 'An independent exact-source executable/driver is required to bind catalog evidence');
  const binaryBytes = await readFile(binary), binaryKind = native ? 'executable' : 'driver';
  assert.equal(host[`${binaryKind}_sha256`], sha256(binaryBytes)); assert.equal(host[`${binaryKind}_bytes`], binaryBytes.length);
  assert.deepEqual(host.phases?.map(row => row.phase), CATALOG_ACCEPTANCE_PHASES);
  assert.equal(new Set(host.phases.map(row => row.process_id)).size, 3, 'Catalog phases must launch fresh native processes');
  assert.equal(host.profile_reused, true, 'Catalog recovery requires an actual shared persisted browser profile');
  const configBytes = await read('catalog-config.json'), config = parse(configBytes);
  assert.equal(host.config_sha256, sha256(configBytes)); assert.equal(config.version, 1); assert.equal(config.run_id, host.run_id);
  validateCatalogSourceBinding(config.source_binding, sourceBinding);
  assert.deepEqual(config.viewport_contract, native ? CATALOG_NATIVE_VIEWPORT_CONTRACT : CATALOG_HOSTED_VIEWPORT_CONTRACT, 'Catalog configuration must bind the exact viewport contract');
  const expectedOrigin = native ? NATIVE_PROTOCOL_ORIGIN : validateManagementHostedOrigin(host, config, sourceBinding.source_sha);
  if (native) { assert.equal(config.hosted_origin, undefined); assert.equal(host.asset_server, undefined); }
  else {
    assert.ok(options.server, 'Independent exact-source practice-server bytes are required');
    const bytes = await readFile(options.server); assert.equal(sha256(bytes), host.asset_server.server_sha256); assert.equal(bytes.length, host.asset_server.server_bytes);
    for (const asset of host.asset_server.assets) {
      assert.match(asset.path, /^web\/[a-z0-9-]+\.js$/);
      const source = execFileSync('git', ['show', `${sourceBinding.source_sha}:${asset.path}`], {cwd: sourceRoot, maxBuffer: 1024 * 1024});
      assert.equal(asset.sha256, sha256(source), `Hosted Worklet asset changed: ${asset.path}`); assert.equal(asset.bytes, source.length);
      assert.equal(sha256(await readFile(join(sourceRoot, asset.path))), asset.sha256);
    }
  }
  if (native) {
    assert.deepEqual(host.requested_viewport, CATALOG_REQUESTED_VIEWPORT);
    assert.deepEqual(host.minimum_viewport, CATALOG_MINIMUM_VIEWPORT);
    if (host.viewport !== undefined) assert.deepEqual(host.viewport, CATALOG_REQUESTED_VIEWPORT);
    assert.ok(Array.isArray(host.screenshots) && host.screenshots.length > 0 && host.screenshots.length <= CATALOG_ACCEPTANCE_PHASES.length * (CATALOG_EVIDENCE_LIMITS.actions + 1), 'Bounded native screenshot manifest is required');
    assert.equal(new Set(host.screenshots.map(image => image.file)).size, host.screenshots.length, 'Duplicate native screenshot manifest entries');
    assert.ok(host.screenshots.every(image => CATALOG_ACCEPTANCE_PHASES.includes(image.phase)), 'Native screenshot has an unknown phase');
    assert.ok(Array.isArray(host.diagnostic_screenshots) && host.diagnostic_screenshots.length <= CATALOG_ACCEPTANCE_PHASES.length * CATALOG_EVIDENCE_LIMITS.actions * 3, 'Bounded separate native diagnostic manifest is required');
    assert.equal(new Set([...host.screenshots, ...host.diagnostic_screenshots].map(image => image.file)).size, host.screenshots.length + host.diagnostic_screenshots.length, 'Duplicate or overlapping native capture manifest entries');
    assert.ok(host.diagnostic_screenshots.every(image => CATALOG_ACCEPTANCE_PHASES.includes(image.phase)), 'Native diagnostic has an unknown phase');
  } else assert.deepEqual(host.viewport, CATALOG_REQUESTED_VIEWPORT, 'Hosted catalog viewport must remain exactly 1280×720');
  const fixture = originalCatalogAcceptanceFixtures(); assert.deepEqual(config.fixture, fixture.manifest);
  assert.deepEqual(await json('fixtures/catalog-fixtures.json'), fixture.manifest);
  for (const input of fixture.inputs) assert.deepEqual(await read(`fixtures/${input.filename}`), input.bytes);
  const reports = [], profileDirectories = new Set(), nativeGeometries = [];
  for (const [index, phase] of CATALOG_ACCEPTANCE_PHASES.entries()) {
    const row = host.phases[index], report = await json(`renderer-${phase}.json`); reports.push(report);
    validateCatalogTransportSettlement(report.transport_settlement, report.api_trace);
    assert.ok(uint(row.process_id) && row.process_id > 0); assert.equal(row.launched_new_process, true); assert.equal(row.renderer_ok, true); assert.equal(row.normal_close, true);
    assert.equal(row.renderer_origin, expectedOrigin); assert.equal(row.executable_tcp_listeners, 0);
    assert.equal(row.actions, report.actions.length); assert.ok(row.actions > 0 && row.actions <= CATALOG_EVIDENCE_LIMITS.actions);
    assert.equal(row.profile_fresh, index === 0); assert.equal(row.profile_reused, index !== 0); assert.equal(row.profile_absent_before_launch, index === 0);
    profileDirectories.add(row.profile_directory);
    const profile = await json(`profile-${phase}.json`, 16384);
    assert.deepEqual(profile, {version: 1, phase, process_id: row.process_id, profile_directory: row.profile_directory, library_directory: host.directory, fresh_required: index === 0, created_new: index === 0});
    const wanted = Array.from({length: row.actions}, (_, i) => [`action-${phase}-${i + 1}.json`, `result-${phase}-${i + 1}.json`]).flat().sort();
    assert.deepEqual(allNames.filter(name => name.startsWith(`action-${phase}-`) || name.startsWith(`result-${phase}-`)).sort(), wanted, 'Host action/result files must exactly match actual sequential count');
    let phaseGeometry;
    if (native) {
      assert.equal(row.geometry_file, `geometry-native-${phase}.json`, 'Native phase geometry filename differs');
      phaseGeometry = await json(row.geometry_file, 16384);
      validateCatalogNativeGeometry(phaseGeometry, {phase, processId: row.process_id, renderer: report.geometry, layout: report.layout, stage: `native-${phase}`});
      nativeGeometries.push(phaseGeometry);
      validateCatalogNativePhaseCaptures(host.screenshots, host.diagnostic_screenshots, phase, report.actions);
      for (const image of host.diagnostic_screenshots.filter(image => image.phase === phase)) validateCatalogDiagnosticScreenshot(await read(image.file), image);
    }
    const nativeScreenshot = async (image, geometry, extra = {}) => validateCatalogScreenshot(await read(image.file), image, {geometry, phase, processId: row.process_id, renderer: report.geometry, layout: report.layout, ...extra});
    const sentActions = [];
    for (const action of report.actions) {
      const sent = await json(`action-${phase}-${action.sequence}.json`, 65536), result = await json(`result-${phase}-${action.sequence}.json`, 262144);
      sentActions.push(sent);
      assert.equal(sent.version, 1); assert.equal(sent.sequence, action.sequence); assert.equal(sent.kind, action.kind); assert.equal(result.ok, true);
      let captureGeometry;
      if (native) {
        const image = host.screenshots.find(item => item.file === `native-action-${phase}-${action.sequence}.png`);
        assert.equal(image.phase, phase); assert.equal(image.action, action.sequence);
        assert.equal(image.geometry_file, `geometry-native-action-${phase}-${action.sequence}.json`, 'Native action screenshot geometry filename differs');
        captureGeometry = await json(image.geometry_file, 16384);
        await nativeScreenshot(image, captureGeometry, {capture: true, reportedViewport: [sent.width, sent.height]});
        validateCatalogNativeCaptureStable(captureGeometry, phaseGeometry);
      }
      if (action.kind === 'catalog-snapshot-before') continue;
      assert.ok([sent.x, sent.y, sent.width, sent.height].every(Number.isFinite)); assert.equal(sent.width, native ? report.layout.width : 1280); assert.equal(sent.height, native ? report.layout.height : 720);
      assert.ok(sent.x >= 0 && sent.x < sent.width && sent.y >= 0 && sent.y < sent.height);
      if (native) {
        const point = result.client_click; validateCatalogNativeClick(point, sent, captureGeometry);
        if (action.kind === 'picker') {
          const owned = result.owned_dialog, completed = result.picker_completion;
          assert.ok(owned?.class === '#32770' && owned.process_id === row.process_id && owned.app_process_id === row.process_id && owned.root_owner_hwnd === owned.app_hwnd && owned.app_hwnd === point.app_hwnd);
          assert.ok(completed?.dialog_dismissed && completed.app_enabled && completed.owned_popup_visible === false, 'Native original picker did not complete');
        }
      } else { assert.equal(result.browser_action, true); assert.equal(result.process_id, row.process_id); }
    }
    const {pickerActions, expectedPickers} = validateCatalogPickerProtocol(phase, sentActions, report, fixture);
    assert.equal(sentActions.filter(action => action.kind === 'catalog-snapshot-before').length, index === 0 ? 1 : 0);
    if (!native) {
      assert.deepEqual(row.page_errors, []);
      const independent = await json(`host-api-${phase}.json`); assert.equal(independent.version, 1); assert.equal(independent.phase, phase); assert.equal(independent.process_id, row.process_id);
      assert.deepEqual(independent.rows, row.api_trace); validateCatalogHostApiTrace(independent.rows, report.api_trace);
      validateManagementNativeBridge(row.native_bridge, expectedOrigin, independent.rows); validateManagementWorkletLoads(row.worklet_loads, expectedOrigin, {required: index === 0});
      for (const response of independent.rows) { const bytes = await read(response.response_file); assert.equal(bytes.length, response.response_bytes); assert.equal(sha256(bytes), response.response_sha256, 'Independent exact native response bytes changed'); }
      const chooser = row.chooser; assert.equal(chooser.version, 1);
      for (const field of ['late_events', 'extra_events', 'unowned_events', 'omitted_events']) assert.equal(chooser[field], 0);
      assert.equal(chooser.timeline[0]?.stage, 'listener-installed'); assert.ok(chooser.timeline.findIndex(event => event.stage === 'navigation-start') > 0);
      assert.deepEqual(chooser.events.map(event => event.sequence), pickerActions.map(action => action.sequence));
      for (const [pickerIndex, event] of chooser.events.entries()) {
        assert.equal(event.owned, true); assert.equal(event.samePage, true); assert.equal(event.multiple, true); assert.equal(event.state, 'files-set'); assert.equal(event.selected_count, 1);
        assert.deepEqual(event.selected_filenames, [expectedPickers[pickerIndex]]);
        assert.deepEqual(event.input, {id: 'score-file', tag: 'INPUT', type: 'file', disabled: false, multiple: true, connected: true});
      }
    } else {
      const trace = await json(`trace-${phase}.json`); assert.equal(trace.version, 1); assert.equal(trace.phase, phase); assert.ok(Array.isArray(trace.events) && trace.events.length > 0 && trace.events.length <= 128);
      let elapsed = -1;
      for (const item of trace.events) { assert.ok(uint(item.elapsed_ms) && item.elapsed_ms >= elapsed); elapsed = item.elapsed_ms; assert.ok(object(item.event)); }
      assert.ok(trace.events.some(item => item.event.source === 'host' && item.event.path === '/__desktop_smoke/report' && item.event.stage === 'received'), 'Native owner never received the renderer report');
      assert.ok(trace.events.some(item => item.event.source === 'host' && item.event.path === '/__desktop_smoke/report' && item.event.stage === 'reply-submitted' && item.event.status === 200), 'Native owner never accepted the actual renderer report');
    }
    assert.ok(object(report.screenshots) && Object.keys(report.screenshots).length > 0);
    for (const [name, sequence] of Object.entries(report.screenshots)) {
      assert.ok(uint(sequence) && sequence > 0 && sequence <= row.actions && report.actions[sequence - 1].kind === 'click', `Screenshot ${name} lacks host click checkpoint`);
      const image = host.screenshots.find(item => item.phase === phase && item.action === sequence && item.file === `${native ? 'native' : 'browser'}-action-${phase}-${sequence}.png`); assert.ok(image, 'Catalog screenshot hash manifest missing');
      if (!native) validateCatalogScreenshot(await read(image.file), image);
    }
    const finalImage = host.screenshots.find(item => item.phase === phase && item.action === undefined && item.file === `${native ? 'native' : 'browser'}-${phase}.png`); assert.ok(finalImage, 'Catalog phase final screenshot absent');
    if (native) {
      assert.equal(finalImage.geometry_file, row.geometry_file, 'Final native capture must bind its phase geometry');
      await nativeScreenshot(finalImage, phaseGeometry);
    } else validateCatalogScreenshot(await read(finalImage.file), finalImage);
  }
  assert.equal(profileDirectories.size, 1, 'Recovery phases used different browser profile directories');
  assert.ok(typeof host.directory === 'string' && host.directory.replaceAll('\\', '/').endsWith('/Scores'));
  assert.equal([...profileDirectories][0].replaceAll('\\', '/'), `${host.directory.replaceAll('\\', '/').slice(0, -7)}/webview-catalog-profile`);
  const operations = validateCatalogProtocolPhases(reports, {sourceBinding, runId: host.run_id, fixture, requireOrganization: true, expectedOrigin, ...(native ? {nativeGeometries, nativeProcesses: host.phases.map(row => row.process_id)} : {})});
  const [seed, restart, final] = reports;
  assert.equal(seed.api_trace.filter(row => row.path === '/api/library/list' && row.status === 200)[0]?.response.entries.length, 0, 'Seed must prove a genuinely empty native library');
  for (const report of reports) {
    assert.equal(report.actions.filter(row => row.kind === 'key-r').length, report === seed ? 3 : report === restart ? 2 : 0, 'Actual practice/recording and organization name key actions differ');
    for (const row of report.api_trace.filter(row => row.path === '/api/library/list' && row.status === 200)) assert.equal(row.response.directory, host.directory, 'Native query did not use the host-owned ORIGINAL Scores root');
  }
  for (const report of [seed, final]) for (const view of ['packs', 'duplicates']) {
    const value = report.catalog[view]; checkedManagementResponse(value, managementRequest({view, limit: 100}));
    assert.ok(report.api_trace.some(row => row.path === '/api/library/manage/query' && row.request.view === view && sameCatalogValue(row.response, value)), 'Read-only membership evidence lacks actual native response bytes');
    if (view === 'packs') {
      assert.equal(value.total, 3); assert.equal(value.summary.memberships, 4); assert.equal(value.summary.shared_songs, 1);
      assert.deepEqual(value.rows.map(row => row.pack_id).sort(), fixture.inputs.map(row => row.pack_id).sort());
      for (const pack of value.rows) {
        const input = fixture.inputs.find(row => row.pack_id === pack.pack_id);
        assert.equal(pack.name, input.filename); assert.equal(pack.source_bytes, input.bytes.length);
        assert.equal(pack.song_count, input.role === 'legacy' ? 2 : 1); assert.equal(pack.retained_only_count, input.role === 'legacy' ? 1 : 0);
      }
    } else {
      assert.equal(value.total, 1); assert.equal(value.rows.length, 1);
      const group = value.rows[0]; assert.equal(group.kind, 'exact_content'); assert.equal(group.evidence_type, 'shared_edition'); assert.equal(group.edition_count, 1); assert.equal(group.reference_count, 2); assert.equal(group.editions[0].score_id, fixture.spec.legacy_ids[0]);
    }
  }
  const seedRoles = ['beforeScore', 'beforeTake', 'afterScore', 'afterTake', 'beforeSavedFree', 'beforeDraftFree', 'afterSavedFree', 'afterDraftFree'];
  assert.deepEqual(Object.keys(seed.files).sort(), seedRoles.sort());
  assert.deepEqual(Object.keys(restart.files).sort(), ['restartedSavedFree', 'selectedLegacyPack', 'selectedCleanPack'].sort());
  assert.deepEqual(Object.keys(final.files), ['restartedSavedFree']);
  for (const report of reports) {
    assert.equal(new Set(Object.values(report.files)).size, Object.keys(report.files).length, 'Preservation checkpoints must use distinct actual downloads');
    assert.equal(report.downloads.length, Object.keys(report.files).length, 'Unexpected or omitted preservation download');
  }
  const downloadBytes = async (report, role) => {
    const name = report.files[role]; assert.ok(typeof name === 'string' && ordinary(name) && !name.includes('/'));
    const extension = ['selectedLegacyPack', 'selectedCleanPack'].includes(role) ? 'zip' : 'json';
    assert.match(name, new RegExp(`^${report.phase}-(?:[1-9]|1[0-6])\\.${extension}$`), 'Preservation file belongs to another phase');
    assert.equal(report.downloads.filter(row => row.file === name && row.complete === true && row.success === true).length, 1, 'Preservation download lacks actual completed host download');
    return read(`downloads/${name}`);
  };
  const downloads = {};
  for (const role of seedRoles) downloads[role] = await downloadBytes(seed, role);
  for (const suffix of ['Score', 'Take', 'SavedFree', 'DraftFree']) assert.deepEqual(downloads[`before${suffix}`], downloads[`after${suffix}`], `Catalog management changed the active ${suffix} export`);
  assert.deepEqual(seed.state.before, seed.state.after, 'Catalog management changed active playback/preview observations');
  assert.ok(object(seed.state.before) && typeof seed.state.before.preview === 'string' && seed.state.before.preview.startsWith('native:song-'));
  const take = parse(downloads.beforeTake); assertSettledPracticeExport(take);
  assert.ok(take.passes.some(row => row.inputs.length === 1));
  assert.equal(take.score_id, fixture.spec.legacy_ids[0]);
  assert.equal(parse(downloads.beforeScore).id, fixture.spec.legacy_ids[0]);
  const selectedLegacy = operations.initialRows.find(row => row.score_id === fixture.spec.legacy_ids[0]); assert.equal(seed.state.before.preview, `native:${selectedLegacy.key}`);
  assert.equal(take.input_evidence?.events.filter(row => row.kind === 'note_on' && row.input_kind === 'typing_keyboard').length, 1, 'Practice baseline needs actual typed input evidence');
  const saved = parse(downloads.beforeSavedFree), draft = parse(downloads.beforeDraftFree);
  for (const record of [saved, draft]) {
    validatePerformanceRecord(record);
    assert.equal(record.observations.events.filter(row => row.kind === 'note_on' && row.input_kind === 'typing_keyboard').length, 1, 'Free recording baseline needs an actual typed onset');
  }
  assert.notEqual(saved.id, draft.id, 'Saved and unsaved free recordings need distinct original identities');
  for (const report of [restart, final]) assert.deepEqual(await downloadBytes(report, 'restartedSavedFree'), downloads.beforeSavedFree, 'Real browser profile restart changed saved free recording bytes');
  for (const [kind, role] of [['legacy', 'selectedLegacyPack'], ['clean', 'selectedCleanPack']]) validateCatalogSelectedExport(await downloadBytes(restart, role), restart, kind, operations, fixture);
  const media = seed.media, expectedMedia = fixture.spec.clean_media[0];
  assert.equal(media.bytes, expectedMedia.bytes); assert.equal(media.before_sha256, expectedMedia.sha256); assert.equal(media.after_sha256, expectedMedia.sha256);
  assert.equal(media.new_load_error, 'catalog_in_trash'); assert.match(media.handle, /^asset-[a-f0-9]{64}$/);
  assert.equal(media.key, operations.initialRows.find(row => row.storage_kind === 'clean').key);
  const snapshots = {};
  for (const phase of ['catalog-before', ...CATALOG_ACCEPTANCE_PHASES]) {
    const snapshot = await json(`snapshot-${phase}.json`); assert.equal(snapshot.version, 1); validateCatalogInventory(snapshot.files); snapshots[phase] = snapshot.files;
  }
  assert.ok(snapshots['catalog-before'].every(row => !journalPath(row.path)), 'Original baseline must precede catalog bootstrap');
  const preservation = [validateCatalogRetainedSnapshots(snapshots['catalog-before'], snapshots['catalog-seed']), validateCatalogRetainedSnapshots(snapshots['catalog-seed'], snapshots['catalog-restart'], {allowNewReceipts: true}), validateCatalogRetainedSnapshots(snapshots['catalog-restart'], snapshots['catalog-final'])];
  assert.ok(preservation[1].new_receipt_files >= 4, 'Two exact reimports need original duplicate receipts and backups');
  const actual = await catalogLibraryInventory(join(directory, 'Scores'));
  assert.deepEqual(actual, [...snapshots['catalog-final']].sort((a, b) => a.path.localeCompare(b.path)), 'Final on-disk bytes differ from host snapshot');
  const retained = await validateCatalogOriginalPayload(join(directory, 'Scores'), snapshots['catalog-before'], fixture, operations.imports.filter(row => row.phase === 'catalog-seed'));
  const journal = await validateCatalogJournal(join(directory, 'Scores'), actual, operations);
  const receipts = actual.filter(row => row.path.startsWith('imports/') && receiptPath(row.path));
  assert.equal(receipts.length, 5, 'Three original imports and two exact reimports require exactly five durable receipts');
  const unmatchedImports = [...operations.imports];
  for (const receipt of receipts) {
    const value = parse(await read(`Scores/${receipt.path}`));
    const index = unmatchedImports.findIndex(row => sameCatalogValue(row.response, value));
    assert.ok(index >= 0, 'Durable import receipt does not match an actual native import response');
    unmatchedImports.splice(index, 1);
    assert.equal(value.source.archive_key, receipt.path.split('/')[1]);
    const mirror = receipt.path.replace(/^imports\//, 'import-backups/');
    assert.deepEqual(actual.find(row => row.path === mirror), {...receipt, path: mirror}, 'Durable import receipt backup differs');
  }
  assert.equal(unmatchedImports.length, 0, 'Native import result has no durable receipt');
  assert.equal(preservation[1].new_receipt_files, 4, 'Exactly two duplicate receipts and two backup copies may be added');
  return {version: 1, ok: true, scenario: 'library-catalog', source_sha: sourceBinding.source_sha, source_tree: sourceBinding.source_tree, [`${binaryKind}_sha256`]: sha256(binaryBytes), ...(!native ? {hosted_origin: expectedOrigin, asset_server_sha256: host.asset_server.server_sha256} : {}), run_id: host.run_id, phases: [...CATALOG_ACCEPTANCE_PHASES], api_count: operations.api_count, operations: journal, preservation, clean_key: retained.cleanKey, claims: {browser: true, native_filesystem: true, native_window: native, physical_audio: false, user_library: false, private_music: false, full_acceptance: false}, files};
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const check = process.argv[2] === '--check', directory = resolve(process.argv[check ? 3 : 2]);
  const proof = await verifyLibraryCatalogAcceptance(directory, {sourceSha: process.env.WMH_SOURCE_SHA, sourceTree: process.env.WMH_SOURCE_TREE, executable: process.env.WMH_LIBRARY_CATALOG_EXECUTABLE, driver: process.env.WMH_NATIVE_IMPORT_DRIVER, server: process.env.WMH_SERVER_BINARY});
  if (check) assert.deepEqual(parse(await readFile(join(directory, 'library-catalog-proof.json'))), proof);
  else await writeFile(join(directory, 'library-catalog-proof.json'), JSON.stringify(proof, null, 2) + '\n');
  console.log(JSON.stringify({ok: proof.ok, source_sha: proof.source_sha, files: proof.files.length, claims: proof.claims}));
}
