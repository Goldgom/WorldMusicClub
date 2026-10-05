import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {openScoreStorage} from '../web/native-score-storage.js';
import {catalogQuery} from '../web/library-catalog-contract.js';
import {managementRequest} from '../web/library-management-contract.js';
import {managementServer} from './library-management-fixtures.js';
import {nativeStorageApp, nativeResponse} from './native-storage-app-fixtures.js';
import {getAppI18n} from '../web/app-locale.js';
const origin = 'https://wmh.localhost';
const health = {name: 'WorldMusicHub', engine: 'rust', network: 'native-protocol-no-listener', score_format_version: 1, library_management_query_version: 1, library_catalog_version: 1};
const raw = await readFile(new URL('./fixtures/library-catalog/native-responses.json', import.meta.url));
const samples = JSON.parse(raw), calls = samples.native_calls;
const evidence = JSON.parse(await readFile(new URL('./fixtures/library-catalog/native-response-source-hashes.json', import.meta.url), 'utf8'));
const kind = preview => preview.kind === 'initialize' ? 'initialize' : ({trash_songs: 'trash_songs', restore: 'restore_songs', adopt_inventory: 'sync_imports'})[preview.request.action.type];
const record = preview => ({library_id: samples.active.library_id, operation_id: preview.operation_id || preview.request.operation_id, kind: kind(preview), preview});
const previews = new Map(calls.filter(call => call.response.preview).map(call => { const r = record(call.response.preview); return [r.operation_id, r]; }));

test('all 24 original native wire responses pass the production adapter unchanged', async () => {
  assert.equal(raw.byteLength, evidence.sample_bytes); assert.equal(createHash('sha256').update(raw).digest('hex'), evidence.sample_sha256); assert.equal(calls.length, evidence.native_calls);
  for (const call of calls) {
    let sent;
    const adapter = await openScoreStorage({origin, fetcher: async (path, options) => { if (path === '/api/health') return nativeResponse(health); sent = {path, options, body: options.body === undefined ? null : JSON.parse(options.body)}; return nativeResponse(call.response, call.status); }});
    let result;
    if (call.path.endsWith('/status')) result = await adapter.catalogStatus();
    else if (call.path.endsWith('/initialize/preview')) result = await adapter.previewCatalogInitialize({libraryId: call.response.library_id});
    else if (call.path.endsWith('/initialize') || call.path.endsWith('/commit')) result = await adapter.commitCatalog(record(call.request.preview));
    else if (call.path.endsWith('/sync/preview')) result = await adapter.previewCatalogSync(call.request);
    else if (call.path.endsWith('/catalog/preview')) result = await adapter.previewCatalog(call.request);
    else if (call.path.endsWith('/operation')) result = await adapter.catalogOperation(previews.get(call.request.operation_id));
    else if (call.path.endsWith('/manage/query')) result = await adapter.queryManagement(call.request);
    else result = await adapter.queryCatalog({...call.request, libraryId: call.response.library_id});
    assert.deepEqual(result, call.response, call.path);
    assert.equal(sent.path, call.path); assert.equal(sent.options.method, call.method); assert.equal(sent.options.credentials, 'same-origin'); assert.equal(sent.options.redirect, 'error');
    const expected = call.path.endsWith('/catalog/query') ? catalogQuery(call.request) : call.path.endsWith('/manage/query') ? managementRequest(call.request) : call.request;
    assert.deepEqual(sent.body, expected, 'Only documented read-query defaults may be expanded; mutating request objects stay exactly equal');
    if (['/api/library/catalog/initialize', '/api/library/catalog/commit'].includes(call.path)) assert.equal(sent.options.signal, undefined);
    adapter.close();
  }
});

/** Replays captured native JSON exactly. It does not replace the native restart test. */
async function nativeWireServer() {
  const server = await managementServer(), nativeRequests = []; let stage = 'uninitialized', loseTrashResponse = true;
  function reply(index, request, {exact = true} = {}) {
    const captured = calls[index]; assert.equal(request.path, captured.path); assert.equal(request.options.method, captured.method);
    if (exact) assert.deepEqual(request.body, captured.request, request.path);
    else if (request.path.endsWith('/query')) { assert.equal(request.body.view, captured.request.view); assert.equal(request.body.limit, 40); assert.equal(request.body.cursor, null); assert.equal(request.body.search, ''); }
    return nativeResponse(captured.response, captured.status);
  }
  server.setExtraRoute(request => {
    if (request.path === '/api/health') return nativeResponse(health);
    if (!request.path.startsWith('/api/library/catalog/')) return;
    nativeRequests.push(request);
    if (request.path.endsWith('/status')) return reply(stage === 'uninitialized' ? 0 : stage === 'initialized' ? 4 : stage === 'trashed' ? 12 : 19, request);
    if (request.path.endsWith('/initialize/preview')) return reply(1, request);
    if (request.path.endsWith('/initialize')) { stage = 'initialized'; return reply(2, request); }
    if (request.path.endsWith('/operation')) return reply(11, request);
    if (request.path.endsWith('/query')) return reply(request.body.view === 'trash' ? stage === 'trashed' ? 7 : 17 : ({initialized: 3, trashed: 8, restored: 14, pending: 18, synced: 22})[stage], request, {exact: false});
    if (request.path.endsWith('/sync/preview')) return reply(20, request);
    if (request.path.endsWith('/preview')) return reply(request.body.action === 'trash_songs' ? 5 : 13, request);
    if (request.path.endsWith('/commit')) {
      const type = request.body.preview.request.action.type;
      if (type === 'trash_songs') { stage = 'trashed'; const result = reply(6, request); if (loseTrashResponse) { loseTrashResponse = false; throw Error('Authored transport loss after actual native committed response'); } return result; }
      if (type === 'restore') { stage = 'restored'; return reply(16, request); }
      stage = 'synced'; return reply(21, request);
    }
    throw Error(`Unrecorded native route ${request.path}`);
  });
  return {...server, nativeRequests, stageNewImport() { assert.equal(stage, 'restored'); stage = 'pending'; }};
}
const ready = async app => { await app.until(() => !app.$('start-listen').disabled); await app.click('home-single-player'); };
const settled = app => app.until(() => app.$('management-catalog').dataset.phase === 'ready');
const click = (app, id) => app.click(`management-catalog-${id}`);
function selectIds(app, ids) { for (const id of ids) { const box = app.document.querySelector(`[data-catalog-edition="${id}"]`); assert.ok(box, id); assert.equal(box.disabled, false); box.checked = true; app.emit(box, 'change'); } }
async function open(app, phase = 'ready') { await app.click('library-management-button'); await app.until(() => !app.$('management-catalog-button').hidden); await app.click('management-catalog-button'); await app.until(() => app.$('management-catalog').dataset.phase === phase); }

test('actual native initialization, mixed Trash, restart receipt, restore and sync traverse the production app DOM', async () => {
  const server = await nativeWireServer(), storageValues = new Map(); let app = await nativeStorageApp(server, {storageValues}), closed = false;
  try {
    await ready(app); await open(app, 'uninitialized'); await click(app, 'initialize-preview'); await app.until(() => !app.$('management-catalog-review').hidden); await click(app, 'confirm'); await settled(app);
    assert.equal(app.$('management-catalog-rows').children.length, samples.active.rows.length);
    selectIds(app, calls[5].request.edition_ids); await click(app, 'preview'); await app.until(() => !app.$('management-catalog-review').hidden);
    for (const pack of samples.trash_preview.summary.affected_packs) assert.ok(app.$('management-catalog-review-content').textContent.includes(pack.name));
    await click(app, 'confirm'); await app.until(() => app.$('management-catalog-operation-status').textContent.includes('Outcome unconfirmed')); assert.equal(app.$('management-catalog-preview').disabled, true);
    await app.close(); closed = true; app = await nativeStorageApp(server, {storageValues}); closed = false; await ready(app); await open(app);
    assert.match(app.$('management-catalog-operation-status').textContent, /Native journal confirms/); assert.ok(app.$('management-catalog-operation-id').textContent.includes(samples.trash_operation.operation_id));
    assert.equal(app.$('management-catalog-rows').children.length, 1); await click(app, 'trash'); await settled(app);
    selectIds(app, calls[13].request.edition_ids); await click(app, 'preview'); await app.until(() => !app.$('management-catalog-review').hidden); await click(app, 'confirm'); await settled(app);
    assert.equal(samples.restore_commit.replayed, true, 'Receipt was emitted by a real native replay after subprocess restoration'); assert.equal(app.$('management-catalog-rows').children.length, 0);
    await click(app, 'active'); await settled(app); assert.equal(app.$('management-catalog-rows').children.length, calls[14].response.rows.length);
    server.stageNewImport(); await click(app, 'refresh'); await settled(app); const newRow = samples.pending_sync.rows.find(row => !row.catalog_managed);
    assert.equal(app.document.querySelector(`[data-catalog-edition="${newRow.edition_id}"]`).disabled, true); await click(app, 'sync-preview'); await app.until(() => !app.$('management-catalog-review').hidden); await click(app, 'confirm'); await settled(app);
    assert.equal(app.document.querySelector(`[data-catalog-edition="${newRow.edition_id}"]`).disabled, false); assert.equal(app.$('management-catalog-rows').children.length, samples.synced_active.rows.length);
    getAppI18n(app.document).setLocale('zh-CN'); assert.match(app.$('management-catalog-operation-status').textContent, /已确认此操作保存成功/); assert.deepEqual(getAppI18n(app.document).getReports(), []);
    const writes = server.nativeRequests.filter(request => request.path.endsWith('/commit')); assert.equal(writes.length, 3, 'Lost response was reconciled by ID, never resubmitted with a new ID');
  } finally { if (!closed) await app.close(); }
});
