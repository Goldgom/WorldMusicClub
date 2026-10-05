// Production DOM + native adapter + original Rust stdin fixtures. No listener or GUI.
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {mkdtemp, readFile, readdir, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {nativeStorageApp} from '../tests/native-storage-app-fixtures.js';
import {startVsqNativeDriver} from '../tests/vsq-native-driver-fixtures.js';
import {authoredLegacyPack} from '../tests/native-import-driver-fixtures.js';
import {authoredCleanPackage, digest} from '../tests/clean-song-package-fixtures.js';
import {getAppI18n} from '../web/app-locale.js';
import {LIBRARY_OPERATION_STORAGE_KEY} from '../web/library-operation-store.js';

const binary = process.env.WMH_NATIVE_IMPORT_DRIVER;
assert.ok(binary, 'Build this source native_import_driver and set WMH_NATIVE_IMPORT_DRIVER');
const root = await mkdtemp(join(tmpdir(), 'wmc-original-user-pack-dom-')), directory = join(root, 'library');
const sentinel = Buffer.from('Original user-pack outside sentinel'), values = new Map();
await writeFile(join(root, 'outside-sentinel'), sentinel);
const report = {version: 1, kind: 'original-user-packs-production-dom-native-stdio', ok: false,
  source_commit: execFileSync('git', ['rev-parse', 'HEAD'], {encoding: 'utf8'}).trim(),
  source_tree: execFileSync('git', ['rev-parse', 'HEAD^{tree}'], {encoding: 'utf8'}).trim(),
  driver_build_source: process.env.WMH_CATALOG_DRIVER_BUILD_SHA || null,
  driver_sha256: digest(await readFile(binary)), browser: false, native_window: false, network_listener: false,
  cases: [], calls: [], source_hashes: {}};
let driver, app, loseReply = false, failPackRead = false;
const transport = {requests: [], async fetcher(path, options = {}) {
  options.signal?.throwIfAborted();
  if (failPackRead && path === '/api/library/catalog/query' && JSON.parse(options.body).view === 'packs') {
    failPackRead = false; throw Error('Original injected partial pack-list read failure');
  }
  const body = options.body instanceof Blob ? Buffer.from(await options.body.arrayBuffer()) : options.body;
  const row = {path, method: options.method || 'GET', body: typeof body === 'string' ? JSON.parse(body) : null};
  transport.requests.push(row);
  const response = await driver.fetcher(path, {...options, body}), bytes = await response.bytes();
  Object.assign(row, {status: response.status, sha256: digest(bytes)});
  if (path.startsWith('/api/library/catalog/')) report.calls.push({...row, response: JSON.parse(bytes)});
  if (loseReply && path === '/api/library/catalog/commit') { loseReply = false; assert.equal(response.status, 200); throw Error('Original injected loss after native commit'); }
  const result = new Response(bytes, {status: response.status, headers: {'Content-Type': response.contentType}});
  Object.defineProperty(result, 'url', {value: `https://wmh.localhost${path}`}); return result;
}};
async function json(path, body) {
  const response = await transport.fetcher(path, body === undefined ? {} : {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(body)});
  const value = await response.json(); assert.equal(response.status, 200, JSON.stringify(value)); return value;
}
async function upload(name, body) {
  const response = await transport.fetcher('/api/library/import/commit', {method: 'POST', headers: {'Content-Type': 'application/octet-stream', 'x-wmh-filename': encodeURIComponent(name)}, body});
  assert.equal(response.status, 200); return response.json();
}
const cat = id => app.$(`management-catalog-${id}`), click = id => app.click(`management-catalog-${id}`);
const settled = () => app.until(() => app.$('management-catalog').dataset.phase === 'ready');
async function launch() {
  driver = startVsqNativeDriver({binary, directory});
  app = await nativeStorageApp(transport, {storageValues: values});
  await app.until(() => !app.$('start-listen').disabled); await app.click('home-single-player');
}
async function close() { await app?.close(); app = null; await driver?.close(); driver = null; }
async function open(phase = 'ready') {
  await app.click('library-management-button'); await app.until(() => !app.$('management-catalog-button').hidden);
  await app.click('management-catalog-button'); await app.until(() => app.$('management-catalog').dataset.phase === phase);
}
async function confirm() {
  await click('confirm'); await app.until(() => !cat('operation').hidden && cat('review').hidden && app.$('management-catalog').dataset.phase === 'ready');
  assert.equal(saved().phase, 'committed');
}
const query = (view, collection_id = null) => json('/api/library/catalog/query', {view, collection_id, limit: 100, refresh: true});
const saved = () => Object.values(JSON.parse(values.get(LIBRARY_OPERATION_STORAGE_KEY)).libraries)[0];
const passed = name => report.cases.push({name, ok: true});
function set(id, value, event = 'change') { cat(id).value = value; app.emit(cat(id), event); }
async function previewForm(kind, name) { set(`${kind}-name`, name, 'input'); app.emit(cat(`${kind}-form`), 'submit'); await app.until(() => !cat('review').hidden); }
function select(rows) {
  for (const row of rows) { const input = app.document.querySelector(`[data-catalog-edition="${row.edition_id}"]`); assert.ok(input); assert.equal(input.disabled, false); input.checked = true; app.emit(input, 'change'); }
}
async function retained() {
  const result = {};
  async function walk(relative = '') {
    for (const entry of await readdir(join(directory, relative), {withFileTypes: true})) {
      if (!relative && (entry.name.includes('catalog') || entry.name === '.library.lock')) continue;
      assert.equal(entry.isSymbolicLink(), false); const name = relative ? `${relative}/${entry.name}` : entry.name;
      if (entry.isDirectory()) await walk(name); else result[name] = digest(await readFile(join(directory, name)));
    }
  }
  await walk(); return result;
}
try {
  await launch();
  const legacy = authoredLegacyPack(), clean = authoredCleanPackage({long: false});
  assert.equal((await upload(legacy.filename, legacy.bytes)).summary.saved, 2);
  assert.equal((await upload(clean.filename, clean.bytes)).summary.saved, 1);
  const beforeFiles = await retained();
  await open('uninitialized'); await click('initialize-preview'); await app.until(() => !cat('review').hidden); await confirm();
  const original = await query('active'), selected = [original.rows.find(row => row.storage_kind === 'legacy'), original.rows.find(row => row.storage_kind === 'clean')];
  await app.click('management-close'); app.savedButton(selected[0].key).click();
  await app.until(() => app.$('song-lobby').dataset.previewId === `native:${selected[0].key}` && !app.$('start-practice').disabled);
  app.$('count-in').checked = false; await app.click('start-practice'); await app.until(() => /Pause/.test(app.$('play-button').textContent)); await app.click('play-button');
  const beforeTakes = await app.exported('export-takes'), beforeScore = await app.exported('export-button');
  await app.click('back-to-library'); await open(); getAppI18n(app.document).setLocale('zh-CN');
  await previewForm('create', '已取消的原创曲包'); await click('cancel');
  assert.equal((await query('packs')).rows.some(pack => pack.name === '已取消的原创曲包'), false);
  await previewForm('create', '原创练习曲包'); await confirm();
  const pack = (await query('packs')).rows.find(pack => pack.name === '原创练习曲包');
  assert.equal(pack.kind, 'custom'); assert.equal(pack.import_pack_id, null); assert.equal(pack.active_song_count, 0);
  await click('packs'); await settled(); assert.ok(app.document.querySelector(`[data-catalog-pack="${pack.collection_id}"]`));
  app.document.querySelector(`[data-catalog-open-pack="${pack.collection_id}"]`).click(); await settled();
  assert.equal(cat('rows').children.length, 0); assert.equal(cat('empty').hidden, false);
  passed('cancelled-create-and-visible-empty-custom-pack-through-real-native-query');
  set('rename-target', pack.collection_id); await previewForm('rename', '重命名后的原创曲包'); await confirm();
  assert.equal((await query('packs')).rows.find(row => row.collection_id === pack.collection_id).name, '重命名后的原创曲包');
  await click('active'); await settled(); select(selected); set('add-target', pack.collection_id); await click('add-preview'); await app.until(() => !cat('review').hidden);
  assert.ok(cat('review-content').textContent.includes('重命名后的原创曲包'));
  for (const row of selected) assert.ok(cat('review-content').textContent.includes(row.edition_id));
  loseReply = true; await click('confirm'); await app.until(() => saved().phase === 'uncertain');
  const pending = saved(); assert.equal(cat('create-preview').disabled, true); assert.equal((await query('active', pack.collection_id)).total, 2);
  assert.deepEqual(await app.exported('export-takes'), beforeTakes);
  assert.deepEqual(await app.exported('export-button'), beforeScore);
  passed('create-rename-and-add-preserve-admitted-score-and-takes');
  const processBefore = driver.pid; await close(); await launch(); assert.notEqual(driver.pid, processBefore); await open();
  assert.equal(saved().phase, 'committed'); assert.equal(saved().operation_id, pending.operation_id);
  assert.equal(report.calls.filter(row => row.path.endsWith('/commit') && row.body.preview.request?.operation_id === pending.operation_id).length, 1);
  passed('mixed-exact-add-lost-reply-and-fresh-process-operation-id-reconciliation');
  getAppI18n(app.document).setLocale('en'); set('filter', pack.collection_id); await settled();
  assert.equal(cat('rows').children.length, 2); select(selected); set('add-target', pack.collection_id); await click('add-preview'); await app.until(() => !cat('review').hidden);
  assert.match(cat('review-content').textContent, /0 memberships added/); assert.ok(cat('review-content').textContent.includes('重命名后的原创曲包')); await confirm();
  const counts = (await query('packs')).rows.find(row => row.collection_id === pack.collection_id);
  assert.deepEqual([counts.active_song_count, counts.available_song_count, counts.shared_song_count], [2, 2, 2]);
  select(selected);
  for (const kind of ['legacy', 'clean']) {
    const before = app.downloads.length; await click(`export-${kind}`); await app.until(() => app.downloads.length === before + 1);
    const blob = app.downloads.at(-1); assert.ok(blob.size > 0);
    const request = transport.requests.filter(row => row.path === '/api/library/pack/export').at(-1);
    assert.deepEqual(request.body.keys, selected.filter(row => row.storage_kind === kind).map(row => row.key));
    report[`${kind}_export_sha256`] = digest(Buffer.from(await blob.arrayBuffer()));
  }
  passed('duplicate-add-is-a-named-noop-and-filtered-mixed-selection-exports-exact-editions');
  failPackRead = true; await click('refresh'); await app.until(() => app.$('management-catalog').dataset.phase === 'error');
  assert.equal(cat('create-preview').disabled, true); assert.equal(cat('rows').children.length, 0); assert.equal(cat('review').hidden, true);
  await click('refresh'); await settled(); assert.equal(cat('rows').children.length, 2);
  passed('partial-pack-list-failure-clears-actionable-rows-until-complete-refresh');
  await app.click('management-close');
  assert.deepEqual(await retained(), beforeFiles);
  assert.deepEqual(getAppI18n(app.document).getReports(), []);
  passed('original-payload-source-backup-and-media-remain-unchanged');
  for (const path of ['web/library-catalog-model.js', 'web/library-catalog-view.js', 'web/library-catalog-contract.js', 'web/library-selected-export.js', 'web/native-score-storage.js', 'crates/desktop-shell/src/catalog_product.rs', 'scripts/check-user-pack-catalog-native.mjs']) report.source_hashes[path] = digest(await readFile(new URL(`../${path}`, import.meta.url)));
  report.ok = true;
} catch (error) { report.error = error.stack || String(error); process.exitCode = 1; }
finally {
  try { await close(); } finally {
    assert.deepEqual(await readFile(join(root, 'outside-sentinel')), sentinel); await rm(root, {recursive: true, force: true});
    if (process.env.WMH_USER_PACK_REPORT) await writeFile(process.env.WMH_USER_PACK_REPORT, JSON.stringify(report, null, 2) + '\n');
    console.log(JSON.stringify({...report, calls: report.calls.length}, null, 2));
  }
}
