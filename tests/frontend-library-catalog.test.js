import test from 'node:test';
import assert from 'node:assert/strict';
import {catalogServer} from './library-catalog-fixtures.js';
import {managementServer} from './library-management-fixtures.js';
import {nativeStorageApp, nativeResponse, deferred} from './native-storage-app-fixtures.js';
import {getAppI18n} from '../web/app-locale.js';
import {LIBRARY_OPERATION_STORAGE_KEY} from '../web/library-operation-store.js';
const ready = async app => { await app.until(() => !app.$('start-listen').disabled); await app.click('home-single-player'); };
const settled = app => app.until(() => app.$('management-catalog').dataset.phase === 'ready');
async function open(app, initial = false) { await app.click('library-management-button'); await app.until(() => !app.$('management-catalog-button').hidden); await app.click('management-catalog-button'); await app.until(() => app.$('management-catalog').dataset.phase === (initial ? 'uninitialized' : 'ready')); }
function select(app, row, checked = true) { const node = app.document.querySelector(`[data-catalog-edition="${row.edition_id}"]`); assert.ok(node); assert.equal(node.disabled, false); node.checked = checked; app.emit(node, 'change'); }
const review = async app => { await app.click('management-catalog-preview'); await app.until(() => !app.$('management-catalog-review').hidden); };
const commit = async app => { await app.click('management-catalog-confirm'); await app.until(() => app.$('management-catalog-operation-status').textContent.includes('Native journal confirms')); await settled(app); };

test('unsupported native catalog controls stay hidden while read-only source groups remain available', async () => {
  const server = await managementServer(), app = await nativeStorageApp(server);
  try { await ready(app); await app.click('library-management-button'); await app.until(() => app.$('library-management-dialog').dataset.phase === 'ready'); assert.equal(app.$('management-catalog-button').hidden, true); assert.equal(server.requests.some(row => row.path.startsWith('/api/library/catalog/')), false); assert.equal(app.$('management-rows').children.length, 3); }
  finally { await app.close(); }
});

test('first-use initialization has localized review, cancel and error without implicit changes', async () => {
  const server = await catalogServer({initialized: false}), app = await nativeStorageApp(server);
  try {
    await ready(app); await open(app, true); assert.equal(server.status().state, 'uninitialized');
    await app.click('management-catalog-initialize-preview'); await app.until(() => !app.$('management-catalog-review').hidden); assert.match(app.$('management-catalog-review-content').textContent, /3 verified song editions/); assert.match(app.$('management-catalog-review-content').textContent, /frees 0 bytes/);
    await app.click('management-catalog-cancel'); assert.equal(server.status().state, 'uninitialized'); assert.equal(server.catalogRequests.some(row => row.path.endsWith('/initialize')), false);
    getAppI18n(app.document).setLocale('zh-CN'); server.setCatalogRoute(request => request.path.endsWith('/initialize/preview') ? nativeResponse({code: 'catalog_recovery_required', error: 'Authored journal diagnostic <script>literal</script>'}, 409) : undefined);
    await app.click('management-catalog-initialize-preview'); await app.until(() => !app.$('management-catalog-error').hidden); assert.match(app.$('management-catalog-error').firstElementChild.textContent, /本机管理日志需要恢复/); assert.equal(app.$('management-catalog-error').querySelector('script'), null);
    server.setCatalogRoute(null); await app.click('management-catalog-initialize-preview'); await app.until(() => !app.$('management-catalog-review').hidden); assert.match(app.$('management-catalog-confirm').textContent, /启用可恢复管理/); await app.click('management-catalog-confirm'); await settled(app); assert.match(app.$('management-catalog-operation-status').textContent, /已确认此操作保存成功/); assert.equal(server.status().state, 'ready'); assert.deepEqual(getAppI18n(app.document).getReports(), []);
  } finally { await app.close(); }
});

test('exact mixed selection previews every affected pack and refreshes lists without activating another song', async () => {
  const server = await catalogServer(), app = await nativeStorageApp(server);
  try {
    await ready(app); const before = app.$('song-lobby').dataset.previewId, audio = app.audio(); await open(app);
    select(app, server.rows[0]); select(app, server.rows[1]); await review(app);
    assert.match(app.$('management-catalog-review-content').textContent, /2 selected · 2 editions change · 3 memberships removed/); assert.match(app.$('management-catalog-review-content').textContent, /1 shared editions/);
    for (const row of server.rows.slice(0, 2)) assert.ok(app.$('management-catalog-review-content').textContent.includes(row.edition_id));
    for (const pack of server.rows[0].packs) { assert.ok(app.$('management-catalog-review-content').textContent.includes(pack.name)); assert.ok(app.$('management-catalog-review-content').textContent.includes(pack.collection_id)); }
    server.addNew('not captured later row'); await commit(app);
    const sent = server.catalogRequests.find(row => row.path.endsWith('/commit')); assert.deepEqual(sent.body.preview.request.action.song_ids, server.rows.slice(0, 2).map(row => row.edition_id));
    assert.equal(app.savedButton(server.rows[0].key), null); assert.equal(app.$('song-lobby').dataset.previewId, before); assert.deepEqual(app.audio(), audio);
    assert.match(app.$('management-catalog-rows').textContent, /awaiting management sync/); assert.equal(app.$('management-catalog-rows').querySelector('img'), null);
    await app.click('management-catalog-trash'); await settled(app); select(app, server.rows[0]); await review(app); await commit(app); assert.ok(app.savedButton(server.rows[0].key)); assert.ok(server.rows[1].trashed_by); assert.equal(app.$('song-lobby').dataset.previewId, before);
    assert.deepEqual(getAppI18n(app.document).getReports(), []);
  } finally { await app.close(); }
});

test('native write survives close/reopen and a lost response recovers same-ID status across app restart', async () => {
  const server = await catalogServer(), gate = deferred(), values = new Map(); let app = await nativeStorageApp(server, {storageValues: values}), closed = false;
  try {
    await ready(app); await open(app); select(app, server.rows[0]); await review(app);
    server.setCatalogRoute(async request => { if (request.path.endsWith('/commit')) { assert.equal(request.options.signal, undefined); await gate.promise; request.proceed(); throw Error('Authored response lost after durable write'); } });
    await app.click('management-catalog-confirm'); await app.until(() => server.catalogRequests.some(row => row.path.endsWith('/commit'))); const id = JSON.parse(values.get(LIBRARY_OPERATION_STORAGE_KEY)).libraries[server.status().library_id].operation_id;
    await app.click('management-close'); await app.click('library-management-button'); assert.match(app.$('management-catalog-status').textContent, /Closing this window does not cancel/); gate.resolve(); await app.until(() => app.$('management-catalog-operation-status').textContent.includes('Outcome unconfirmed'));
    assert.equal(app.$('management-catalog-preview').disabled, true); await app.close(); closed = true; server.setCatalogRoute(null);
    app = await nativeStorageApp(server, {storageValues: values}); closed = false; await ready(app); await open(app); assert.match(app.$('management-catalog-operation-status').textContent, /Native journal confirms/); assert.ok(app.$('management-catalog-operation-id').textContent.includes(id)); assert.equal(server.catalogRequests.filter(row => row.path.endsWith('/commit')).length, 1); assert.equal(server.history.size, 1);
  } finally { gate.resolve(); if (!closed) await app.close(); }
});

test('paused score, settled takes, saved and unsaved free recordings survive Trash and restore', async () => {
  const server = await catalogServer(), app = await nativeStorageApp(server);
  try {
    await ready(app); app.savedButton(server.rows[0].key).click(); await app.until(() => app.$('song-lobby').dataset.previewId === `native:${server.rows[0].key}` && !app.$('start-practice').disabled);
    app.$('count-in').checked = false; await app.click('start-practice'); await app.until(() => app.document.body.dataset.screen === 'stage' && !app.$('play-button').disabled);
    const key = app.$('keyboard').querySelector('[data-midi="60"]'); app.emit(key, 'pointerdown', {pointerId: 8, button: 0}); app.emit(key, 'pointerup', {pointerId: 8}); await app.click('back-to-library');
    await app.until(() => !app.$('assess-button').disabled); const beforeScore = await app.exported('export-button'), beforeTakes = await app.exported('export-takes'), identity = app.$('song-lobby').dataset.previewId;
    await app.click('start-free-practice'); await app.click('free-sound'); await app.click('free-start'); app.emit(app.$('free-practice-title'), 'keydown', {code: 'KeyR', key: 'r'}); app.emit(app.$('free-practice-title'), 'keyup', {code: 'KeyR', key: 'r'}); await app.click('free-stop'); await app.click('free-save'); await app.until(() => app.$('free-save-status').textContent.includes('Saved') && app.$('free-practice-screen').getAttribute('aria-busy') === 'false');
    const saved = await app.exported('free-export-record'); await app.click('free-start'); app.emit(app.$('free-practice-title'), 'keydown', {code: 'KeyZ', key: 'z'}); app.emit(app.$('free-practice-title'), 'keyup', {code: 'KeyZ', key: 'z'}); await app.click('free-stop'); const draft = await app.exported('free-export-draft'); await app.click('free-exit');
    const audio = app.audio(); await open(app); select(app, server.rows[0]); await review(app); await commit(app); await app.click('management-catalog-trash'); await settled(app); select(app, server.rows[0]); await review(app); await commit(app); await app.click('management-close');
    assert.deepEqual(await app.exported('export-button'), beforeScore); assert.deepEqual(await app.exported('export-takes'), beforeTakes); assert.equal(app.$('song-lobby').dataset.previewId, identity); assert.deepEqual(app.audio(), audio);
    await app.click('start-free-practice'); assert.deepEqual(await app.exported('free-export-draft'), draft); assert.deepEqual(await app.exported('free-export-record'), saved); assert.equal(app.openedDatabases.includes('worldmusichub.scores.v1'), false);
  } finally { await app.close(); }
});

test('explicit sync makes a newly imported edition selectable without restoring a prior tombstone', async () => {
  const server = await catalogServer(), app = await nativeStorageApp(server);
  try {
    await ready(app); await open(app); select(app, server.rows[0]); await review(app); await commit(app); const trashId = server.rows[0].trashed_by, added = server.addNew('authored newly imported'); await app.click('management-catalog-refresh'); await settled(app);
    assert.equal(app.document.querySelector(`[data-catalog-edition="${added.edition_id}"]`).disabled, true); await app.click('management-catalog-sync-preview'); await app.until(() => !app.$('management-catalog-review').hidden); assert.ok(app.$('management-catalog-review-content').textContent.includes(added.edition_id)); await commit(app);
    assert.equal(app.document.querySelector(`[data-catalog-edition="${added.edition_id}"]`).disabled, false); assert.equal(server.rows[0].trashed_by, trashId); getAppI18n(app.document).setLocale('zh-CN'); select(app, added); await review(app); assert.match(app.$('management-catalog-review-content').textContent, /释放 0 字节/); assert.match(app.$('management-catalog-confirm').textContent, /移入回收站/); assert.deepEqual(getAppI18n(app.document).getReports(), []);
  } finally { await app.close(); }
});

test('a legitimate asynchronous assessment completes for its original practice pass after song removal', async () => {
  const server = await catalogServer(), gate = deferred(); let assessing = false;
  server.setAuxRoute(async ({path}) => { if (path === '/api/assess') { assessing = true; await gate.promise; return nativeResponse({hits: [], misses: [], extras: [], accuracy_percent: 0, mean_abs_error_ms: null}); } });
  let now = 10000; const app = await nativeStorageApp(server, {now: () => now});
  try {
    await ready(app); app.$('count-in').checked = false; await app.click('start-practice'); await app.until(() => app.document.body.dataset.screen === 'stage' && !app.$('play-button').disabled); await app.click('play-button'); await app.click('assess-button'); now += 1000; app.frame(); await app.until(() => assessing); await app.click('back-to-library');
    const before = await app.exported('export-takes'); assert.equal(app.$('assess-button').disabled, true); await open(app); select(app, server.rows[0]); await review(app); await commit(app); await app.click('management-close'); assert.deepEqual(await app.exported('export-takes'), before);
    gate.resolve(); await app.until(() => !app.$('feedback-results').hidden && !app.$('assess-button').disabled); const after = await app.exported('export-takes');
    assert.equal(after.passes.length, before.passes.length); assert.deepEqual(after.passes.map(pass => pass.inputs), before.passes.map(pass => pass.inputs)); assert.equal(server.requests.filter(row => row.path === '/api/assess').length, 1);
  } finally { gate.resolve(); await app.close(); }
});
