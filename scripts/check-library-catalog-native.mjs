// Production app DOM + production storage adapter + real native Rust stdin.
// Only original fixtures in a fresh owned root; no browser, GUI, or listener.
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {mkdtemp, mkdir, readFile, readdir, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {dirname, join} from 'node:path';
import {nativeStorageApp} from '../tests/native-storage-app-fixtures.js';
import {authoredLegacyPack, storedZip} from '../tests/native-import-driver-fixtures.js';
import {startVsqNativeDriver} from '../tests/vsq-native-driver-fixtures.js';
import {authoredCleanPackage, digest} from '../tests/clean-song-package-fixtures.js';
import {authoredImportScore} from '../tests/bulk-import-fixtures.js';
import {openScoreStorage} from '../web/native-score-storage.js';
import {getAppI18n} from '../web/app-locale.js';
import {LIBRARY_OPERATION_STORAGE_KEY} from '../web/library-operation-store.js';

const binary = process.env.WMH_NATIVE_IMPORT_DRIVER;
if (!binary) throw Error('Build the exact-source native_import_driver and set WMH_NATIVE_IMPORT_DRIVER.');
const root = await mkdtemp(join(tmpdir(), 'wmc-original-catalog-dom-'));
const directory = join(root, 'library'), sentinel = Buffer.from('Original catalog DOM outside sentinel');
await writeFile(join(root, 'outside-sentinel'), sentinel);
const legacy = authoredLegacyPack(), clean = authoredCleanPackage({long: false});
const shared = storedZip([['same-original.json', JSON.stringify(legacy.scores[0])], ['original-note.txt', 'Original shared-pack note']]);
const report = {
  version: 1, kind: 'node-dom-production-adapter-real-rust-stdio-catalog', ok: false,
  source_commit: execFileSync('git', ['rev-parse', 'HEAD'], {encoding: 'utf8'}).trim(),
  source_tree: execFileSync('git', ['rev-parse', 'HEAD^{tree}'], {encoding: 'utf8'}).trim(),
  browser: false, native_window: false, physical_audio: false, network_listener: false,
  driver_sha256: digest(await readFile(binary)), fixture_sha256: {legacy: digest(legacy.bytes), shared: digest(shared), clean: digest(clean.bytes)},
  cases: [], native_catalog_calls: [],
};
const storageValues = new Map();
let driver, app, mediaStorage, loseAfterCommit = false, loseBeforeCommit = false;
const passed = (name, details = {}) => report.cases.push({name, ...details, ok: true});

// Preserve the actual native response bytes while presenting Fetch's interface.
// Faults are injected only at transport boundaries, never by fabricating replies.
const transport = {
  requests: [],
  async fetcher(path, options = {}) {
    options.signal?.throwIfAborted();
    const body = options.body instanceof Blob ? Buffer.from(await options.body.arrayBuffer()) : options.body;
    const request = {path, method: options.method || 'GET', body: typeof body === 'string' ? JSON.parse(body) : null};
    transport.requests.push(request);
    if (path === '/api/library/catalog/commit' && loseBeforeCommit) {
      loseBeforeCommit = false;
      request.injected_loss = 'before_native_dispatch';
      throw Error('Authored transport loss before native dispatch');
    }
    const response = await driver.fetcher(path, {...options, body});
    const bytes = await response.bytes();
    if (path.startsWith('/api/library/catalog/')) report.native_catalog_calls.push({...request, status: response.status, response: JSON.parse(bytes)});
    if (path === '/api/library/catalog/commit' && loseAfterCommit) {
      loseAfterCommit = false;
      assert.equal(response.status, 200);
      request.injected_loss = 'after_native_commit';
      throw Error('Authored transport loss after durable native commit');
    }
    return {...response, url: `https://wmh.localhost${path}`, redirected: false,
      headers: new Headers({'Content-Type': response.contentType}),
      arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
      blob: async () => new Blob([bytes], {type: response.contentType})};
  },
};
const request = (path, body) => transport.fetcher(path, body === undefined ? {} : {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(body)});
async function json(path, body) { const response = await request(path, body); assert.ok(response.ok, await response.text()); return response.json(); }
async function upload(name, bytes) {
  const response = await transport.fetcher('/api/library/import/commit', {method: 'POST', headers: {'Content-Type': 'application/octet-stream', 'x-wmh-filename': encodeURIComponent(name)}, body: bytes});
  assert.ok(response.ok, await response.text()); return response.json();
}
const catalog = suffix => app.$(`management-catalog-${suffix}`);
const click = suffix => app.click(`management-catalog-${suffix}`);
const settled = () => app.until(() => app.$('management-catalog').dataset.phase === 'ready', 'Catalog ready');
async function launch() {
  driver = startVsqNativeDriver({binary, directory});
  app = await nativeStorageApp(transport, {storageValues});
  await app.until(() => !app.$('start-listen').disabled); await app.click('home-single-player');
}
async function close() { mediaStorage?.close(); mediaStorage = null; await app?.close(); app = null; await driver?.close(); driver = null; }
async function open(phase = 'ready') {
  await app.click('library-management-button'); await app.until(() => !app.$('management-catalog-button').hidden);
  await app.click('management-catalog-button'); await app.until(() => app.$('management-catalog').dataset.phase === phase, `Catalog ${phase}`);
}
function select(ids) {
  for (const id of ids) { const box = app.document.querySelector(`[data-catalog-edition="${id}"]`); assert.ok(box, id); assert.equal(box.disabled, false); box.checked = true; app.emit(box, 'change'); }
}
async function review(kind = 'preview') { await click(kind); await app.until(() => !catalog('review').hidden, `Catalog review ${kind}`); }
async function confirm() {
  await click('confirm'); await app.until(() => catalog('operation-status').textContent.includes('Native journal confirms'), 'Native committed operation');
  await settled();
}
const query = view => json('/api/library/catalog/query', {view, limit: 100, refresh: true});
const savedOperation = () => Object.values(JSON.parse(storageValues.get(LIBRARY_OPERATION_STORAGE_KEY)).libraries)[0];
async function retainedFiles() {
  const result = {};
  async function walk(relative = '') {
    for (const entry of await readdir(join(directory, relative), {withFileTypes: true})) {
      const path = relative ? `${relative}/${entry.name}` : entry.name;
      assert.equal(entry.isSymbolicLink(), false);
      if (!relative && (entry.name.includes('catalog') || entry.name === '.library.lock')) continue;
      if (entry.isDirectory()) await walk(path);
      else result[path] = digest(await readFile(join(directory, path)));
    }
  }
  await walk(); return result;
}
async function unchanged(before) { const after = await retainedFiles(); for (const [path, hash] of Object.entries(before)) assert.equal(after[path], hash, `Retained original ${path}`); }

try {
  await launch();
  assert.equal((await upload(legacy.filename, legacy.bytes)).summary.saved, 2);
  assert.equal((await upload('Original shared pack.zip', shared)).summary.duplicate, 1);
  const cleanImport = await upload(clean.filename, clean.bytes);
  assert.equal(cleanImport.summary.saved, 1);
  const cleanKey = cleanImport.items.find(item => item.entry).entry.key;
  const before = await retainedFiles();
  assert.ok(Object.keys(before).some(path => path.startsWith('imports/')));
  assert.ok(Object.keys(before).some(path => path.startsWith('import-backups/')));
  assert.ok(Object.keys(before).some(path => path.includes('/media/')));
  await open('uninitialized');
  await review('initialize-preview'); assert.match(catalog('review-content').textContent, /3 verified song editions/);
  await click('cancel'); assert.equal((await json('/api/library/catalog/status')).state, 'uninitialized');
  assert.equal(report.native_catalog_calls.some(row => row.path.endsWith('/initialize')), false);
  await review('initialize-preview'); await confirm();
  const initialized = await query('active');
  assert.deepEqual(initialized.counts, {managed_songs: 3, active_songs: 3, trashed_songs: 0, packs: 3, memberships: 4});
  assert.equal(catalog('rows').children.length, 3);
  passed('explicit-initialization-cancel-then-confirm-through-native-dom');

  const selected = initialized.rows.filter(row => row.score_id === legacy.scores[0].id || row.storage_kind === 'clean');
  assert.equal(selected.length, 2);
  mediaStorage = await openScoreStorage({origin: 'https://wmh.localhost', fetcher: transport.fetcher});
  const admitted = await mediaStorage.load(`native:${cleanKey}`), asset = admitted.cleanSong.media[0];
  const mediaBefore = Buffer.from(await (await mediaStorage.loadAsset(`native:${cleanKey}`, asset.handle)).arrayBuffer());
  const priorPreview = app.$('song-lobby').dataset.previewId, priorAudio = app.audio();
  select(selected.map(row => row.edition_id)); await review();
  assert.match(catalog('review-content').textContent, /2 selected · 2 editions change · 3 memberships removed/);
  assert.match(catalog('review-content').textContent, /1 shared editions/);
  for (const row of selected) assert.ok(catalog('review-content').textContent.includes(row.edition_id));
  for (const pack of selected.flatMap(row => row.packs)) assert.ok(catalog('review-content').textContent.includes(pack.collection_id));
  loseAfterCommit = true; await click('confirm');
  await app.until(() => catalog('operation-status').textContent.includes('Outcome unconfirmed'));
  const uncertain = savedOperation(); assert.equal(uncertain.phase, 'uncertain');
  assert.deepEqual(uncertain.preview.request.action.song_ids, selected.map(row => row.edition_id));
  assert.equal(catalog('preview').disabled, true);
  assert.equal(app.$('song-lobby').dataset.previewId, priorPreview); assert.deepEqual(app.audio(), priorAudio);
  assert.equal((await query('trash')).total, 2);
  assert.equal((await json('/api/library/list')).entries.length, 1);
  const blocked = await request('/api/library/load', {key: cleanKey}); assert.equal((await blocked.json()).code, 'catalog_in_trash');
  assert.deepEqual(Buffer.from(await (await mediaStorage.loadAsset(`native:${cleanKey}`, asset.handle)).arrayBuffer()), mediaBefore);
  await unchanged(before);
  passed('exact-mixed-shared-selection-durable-trash-lost-response-and-admitted-media', {operation_id: uncertain.operation_id, retained_files: Object.keys(before).length});

  assert.equal((await upload(legacy.filename, legacy.bytes)).summary.duplicate, 2);
  assert.equal((await upload(clean.filename, clean.bytes)).summary.duplicate, 1);
  assert.equal((await query('trash')).total, 2); assert.equal((await query('active')).total, 1);
  passed('exact-reimport-deduplication-keeps-original-trash-ownership');
  await close(); await launch(); await open();
  assert.match(catalog('operation-status').textContent, /Native journal confirms/);
  assert.equal(savedOperation().operation_id, uncertain.operation_id); assert.equal(savedOperation().phase, 'committed');
  assert.equal(transport.requests.filter(row => row.path === '/api/library/catalog/commit').length, 1, 'Recovery never submits another mutation');
  assert.equal(catalog('rows').children.length, 1);
  passed('fresh-native-process-and-renderer-reconcile-original-operation-id');

  await click('trash'); await settled(); select(selected.map(row => row.edition_id)); await review(); await confirm();
  assert.equal(catalog('rows').children.length, 0);
  await click('active'); await settled(); assert.equal(catalog('rows').children.length, 3);
  assert.equal((await query('active')).counts.memberships, 4);
  assert.ok(app.savedButton(cleanKey));
  await unchanged(before);
  passed('exact-restore-restores-memberships-and-app-inventory');

  const fresh = authoredImportScore('original-catalog-dom-new', 'Original later import');
  assert.equal((await upload('Original later import.json', Buffer.from(JSON.stringify(fresh)))).summary.saved, 1);
  await click('refresh'); await settled();
  const pending = (await query('active')).rows.find(row => row.score_id === fresh.id);
  assert.equal(pending.catalog_managed, false);
  assert.equal(app.document.querySelector(`[data-catalog-edition="${pending.edition_id}"]`).disabled, true);
  await review('sync-preview');
  loseBeforeCommit = true; await click('confirm'); await app.until(() => catalog('operation-status').textContent.includes('Outcome unconfirmed'));
  const unsubmitted = savedOperation();
  await click('check'); await app.until(() => !catalog('retry').hidden);
  assert.equal(savedOperation().phase, 'not_committed');
  assert.equal((await query('active')).rows.find(row => row.edition_id === pending.edition_id).catalog_managed, false);
  await click('retry'); await app.until(() => catalog('operation-status').textContent.includes('Native journal confirms')); await settled();
  assert.equal(savedOperation().operation_id, unsubmitted.operation_id);
  const attempts = transport.requests.filter(row => row.path === '/api/library/catalog/commit' && row.body.preview.request.operation_id === unsubmitted.operation_id);
  assert.equal(attempts.length, 2); assert.deepEqual(attempts[0].body, attempts[1].body);
  assert.equal(app.document.querySelector(`[data-catalog-edition="${pending.edition_id}"]`).disabled, false);
  assert.equal((await query('active')).counts.managed_songs, 4);
  passed('explicit-sync-proved-absent-operation-retries-the-exact-same-preview', {operation_id: unsubmitted.operation_id});
  getAppI18n(app.document).setLocale('zh-CN'); assert.match(catalog('operation-status').textContent, /已确认此操作保存成功/); assert.deepEqual(getAppI18n(app.document).getReports(), []);
  await unchanged(before);
  const after = await retainedFiles();
  await close(); await launch(); await open();
  assert.equal(catalog('rows').children.length, 4); assert.equal((await query('trash')).total, 0);
  await unchanged(after); assert.deepEqual(await readFile(join(root, 'outside-sentinel')), sentinel);
  passed('second-restart-retains-all-originals-backups-history-media-and-final-state', {retained_files: Object.keys(after).length});
  for (const file of ['scripts/check-library-catalog-native.mjs', 'web/app.js', 'web/native-score-storage.js', 'web/library-catalog-contract.js', 'web/library-catalog-model.js', 'web/library-catalog-view.js', 'web/library-operation-store.js', 'crates/desktop-shell/src/lib.rs', 'crates/desktop-shell/src/catalog_product.rs', 'crates/desktop-shell/src/catalog_journal.rs', 'crates/desktop-shell/src/catalog.rs']) {
    report.source_hashes ??= {}; report.source_hashes[file] = digest(await readFile(new URL(`../${file}`, import.meta.url)));
  }
  report.ok = true;
} catch (error) { report.error = error.stack || String(error); process.exitCode = 1; }
finally {
  try { await close(); } finally {
    assert.deepEqual(await readFile(join(root, 'outside-sentinel')), sentinel);
    await rm(root, {recursive: true, force: true});
    if (process.env.WMH_CATALOG_REPORT) { await mkdir(dirname(process.env.WMH_CATALOG_REPORT), {recursive: true}); await writeFile(process.env.WMH_CATALOG_REPORT, JSON.stringify(report, null, 2) + '\n'); }
    console.log(JSON.stringify({...report, native_catalog_calls: report.native_catalog_calls.length}, null, 2));
  }
}
