// Rehearse the exact shared acceptance sequence with Node DOM + real Rust stdin.
// Synthetic DOM input and geometry are explicit: this does not establish a browser/window pass.
import assert from 'node:assert/strict';
import {mkdtemp, readFile, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {nativeStorageApp} from '../tests/native-storage-app-fixtures.js';
import {startVsqNativeDriver} from '../tests/vsq-native-driver-fixtures.js';
import {catalogAcceptanceRendererHelpers} from '../tests/catalog-acceptance-renderer-helpers.js';
import {originalCatalogAcceptanceFixtures, catalogSha256 as digest} from './prepare-library-catalog-acceptance.mjs';
import {LIBRARY_OPERATION_STORAGE_KEY} from '../web/library-operation-store.js';
import {validateCatalogApiEvidence, validateCatalogHostApiTrace, validateCatalogJournal, validateCatalogSelectedExport, catalogLibraryInventory, catalogSourceBinding} from './verify-library-catalog-acceptance.mjs';

const binary = process.env.WMH_NATIVE_IMPORT_DRIVER;
assert.ok(binary, 'Build the exact-source original native_import_driver first');
const root = await mkdtemp(join(tmpdir(), 'wmc-original-user-pack-shared-flow-')), directory = join(root, 'Scores'), values = new Map();
const fixture = originalCatalogAcceptanceFixtures(), helpers = await catalogAcceptanceRendererHelpers();
const report = {kind: 'shared-user-pack-acceptance-flow-node-dom-real-stdio', source_binding: await catalogSourceBinding(), driver_sha256: digest(await readFile(binary)), browser: false, native_window: false, synthetic_input: true, synthetic_geometry: true, ok: false, phases: []};
let driver, app, transport, hostRows, phase, sequence;
const server = {requests: [], fetcher: (...args) => transport.fetcher(...args)};
async function launch(name) {
  phase = name; sequence = 0; hostRows = []; driver = startVsqNativeDriver({binary, directory});
  transport = helpers.createCatalogAcceptanceTransport({origin: 'https://wmh.localhost', digest, getActionSequence: () => sequence, fetcher: async (path, options = {}) => {
    const body = options.body instanceof Blob ? Buffer.from(await options.body.arrayBuffer()) : options.body;
    const response = await driver.fetcher(path, {...options, body}), bytes = await response.bytes(), raw = body === undefined ? Buffer.alloc(0) : Buffer.from(body);
    hostRows.push({sequence: hostRows.length + 1, path, method: options.method || 'GET', request_bytes: raw.length, request_sha256: digest(raw), status: response.status, response_bytes: bytes.length, response_sha256: digest(bytes), response_file: `api/${name}-${hostRows.length + 1}.bin`});
    const value = new Response(bytes, {status: response.status, headers: {'Content-Type': response.contentType}}); Object.defineProperty(value, 'url', {value: `https://wmh.localhost${path}`}); return value;
  }});
  app = await nativeStorageApp(server, {storageValues: values}); await app.until(() => !app.$('start-listen').disabled); await app.click('home-single-player');
  // linkedom intentionally cannot prove actual focus or layout; the browser/window gate must.
  app.window.HTMLElement.prototype.focus = function() { Object.defineProperty(app.document, 'activeElement', {configurable: true, value: this}); };
  app.window.HTMLElement.prototype.scrollIntoView = function() {};
  app.$('management-catalog-review-title').getBoundingClientRect = () => ({top: 16, bottom: 44, width: 400, height: 28});
}
async function close() { transport?.stop(); await app?.close(); app = null; await driver?.close(); driver = null; }
const cat = id => app.$(`management-catalog-${id}`), operation = () => Object.values(JSON.parse(values.get(LIBRARY_OPERATION_STORAGE_KEY) || '{"libraries":{}}').libraries)[0];
async function probe(path, body) { const response = await transport.probe(path, body), value = await response.json(); assert.equal(response.status, 200, JSON.stringify(value)); return value; }
const query = (view, collection_id = null) => probe('/api/library/catalog/query', {view, collection_id, refresh: true, limit: 100});
async function open(expected = 'ready') { await app.click('library-management-button'); await app.until(() => !app.$('management-catalog-button').hidden); await app.click('management-catalog-button'); await app.until(() => app.$('management-catalog').dataset.phase === expected); }
async function input(kind, node) {
  assert.ok(node && !node.disabled); ++sequence;
  node.focus(); node.click();
  if (kind === 'key-r') { node.value += 'r'; app.emit(node, 'input'); }
  else if (kind === 'select-last') { node.value = [...node.options].at(-1).value; app.emit(node, 'change'); }
  else assert.equal(kind, 'click');
  if (node.type === 'checkbox') { node.checked = !node.checked; app.emit(node, 'change'); }
  if (node.type === 'submit') app.emit(node.closest('form'), 'submit');
  if (node.tagName === 'SUMMARY' && node.parentNode.tagName === 'DETAILS') node.parentNode.open = !node.parentNode.open;
  await app.tick(); return sequence;
}
const output = async node => { const before = app.downloads.length; await input('click', node); await app.until(() => app.downloads.length === before + 1); return `${phase}-${app.downloads.length}.zip`; };
async function run(prior, selected) {
  const result = await helpers.runCatalogUserPackAcceptance({document: app.document, native: input, until: app.until, query, operation, apiLast: path => transport.rows.filter(row => row.path === path && row.status === 200).at(-1)?.response, download: output, screenshot: async (_name, node) => input('click', node), selected, prior, viewport: {width: 1280, height: 720}});
  const recorded = JSON.parse(JSON.stringify(transport.rows));
  validateCatalogApiEvidence(recorded); validateCatalogHostApiTrace(hostRows, recorded);
  for (const row of transport.rows.filter(row => row.path === '/api/library/pack/export')) assert.ok(row.response_binary_bytes > 0 && row.response === null && row.response_text === null);
  report.phases.push({name: phase, process_id: driver.pid, action_count: sequence, api_count: transport.rows.length, result: JSON.parse(JSON.stringify(result))});
  return result.organization;
}
try {
  await launch('organization');
  for (const item of fixture.inputs) { const reply = await server.fetcher('/api/library/import/commit', {method: 'POST', headers: {'Content-Type': 'application/octet-stream', 'x-wmh-filename': encodeURIComponent(item.filename)}, body: item.bytes}); assert.equal(reply.status, 200); }
  await open('uninitialized'); await input('click', cat('initialize-preview')); await app.until(() => !cat('review').hidden); await input('click', cat('confirm')); await app.until(() => app.$('management-catalog').dataset.phase === 'ready');
  const initialize = structuredClone(operation()), initialRows = (await query('active')).rows, selected = initialRows.filter(row => fixture.spec.selected_score_ids.includes(row.score_id));
  async function transition(kind) {
    for (const song of selected) await input('click', cat('rows').querySelector(`[data-catalog-edition="${song.edition_id}"]`));
    await input('click', cat('preview')); await app.until(() => !cat('review').hidden); await input('click', cat('confirm'));
    await app.until(() => operation()?.kind === kind && operation().phase === 'committed' && app.$('management-catalog').dataset.phase === 'ready'); return structuredClone(operation());
  }
  const trash = await transition('trash_songs'); await input('click', cat('trash')); await app.until(() => app.$('management-catalog').dataset.phase === 'ready');
  const restore = await transition('restore_songs'); await input('click', cat('active')); await app.until(() => app.$('management-catalog').dataset.phase === 'ready');
  const first = await run(null, selected); assert.equal(first.create.kind, 'create_pack'); assert.equal(first.rename.kind, 'rename_pack'); assert.equal(first.add.kind, 'add_memberships');
  const journalOperations = JSON.parse(JSON.stringify({initialize, trash, restore, create: first.create, rename: first.rename, add: first.add, initialRows, allApi: transport.rows}));
  const exportOperations = {...journalOperations, selectedIds: selected.map(row => row.edition_id), imports: journalOperations.allApi.filter(row => row.path === '/api/library/import/commit')};
  assert.equal(app.downloads.length, 2); report.selected_exports = {};
  for (const [index, kind] of ['legacy', 'clean'].entries()) {
    const bytes = Buffer.from(await app.downloads[index].arrayBuffer());
    report.selected_exports[kind] = validateCatalogSelectedExport(bytes, {api_trace: journalOperations.allApi}, kind, exportOperations, fixture);
  }
  report.journal = await validateCatalogJournal(directory, await catalogLibraryInventory(directory), journalOperations); assert.equal(report.journal.length, 6);
  const firstPid = driver.pid; await close(); await launch('restart'); assert.notEqual(driver.pid, firstPid); await open();
  const restarted = await run(first, selected); assert.deepEqual(restarted.filtered.rows.map(row => row.edition_id).sort(), selected.map(row => row.edition_id).sort());
  assert.equal(transport.rows.filter(row => row.path === '/api/library/catalog/commit').length, 0);
  report.ok = true;
} catch (error) { report.error = error.stack || String(error); process.exitCode = 1; }
finally { await close(); await rm(root, {recursive: true, force: true}); if (process.env.WMH_USER_PACK_FLOW_REPORT) await writeFile(process.env.WMH_USER_PACK_FLOW_REPORT, JSON.stringify(report, null, 2)); console.log(JSON.stringify({...report, phases: report.phases.map(({name, process_id, action_count, api_count}) => ({name, process_id, action_count, api_count}))}, null, 2)); }
