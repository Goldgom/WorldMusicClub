import test from 'node:test';
import assert from 'node:assert/strict';
import {openScoreStorage} from '../web/native-score-storage.js';
import {LibraryCatalogModel} from '../web/library-catalog-model.js';
import {LibraryOperationStore} from '../web/library-operation-store.js';
import {userPackServer, customPackId} from './library-user-pack-fixtures.js';
import {memoryStorage, libraryId} from './library-catalog-fixtures.js';
import {deferred, nativeResponse} from './native-storage-app-fixtures.js';
async function harness(options) {
  const server = await userPackServer(options), adapter = await openScoreStorage({origin: 'https://wmh.localhost', fetcher: server.fetcher}), store = new LibraryOperationStore({storage: memoryStorage()});
  const create = () => new LibraryCatalogModel({getStorage: async () => adapter, operationStore: store}); const model = create(); await model.open(); assert.equal(model.snapshot().phase, 'ready'); return {server, adapter, model, store, create};
}
test('custom packs create empty, rename exact target, browse and search without fabricating provenance', async () => {
  const {server, model} = await harness(); const before = server.rows.length;
  await model.previewOrganization('create_pack', {name: '  我的练习 <b>literal</b>  '}); const review = model.snapshot().preview; assert.equal(review.kind, 'create_pack'); assert.equal(review.preview.request.action.name, '我的练习 <b>literal</b>'); assert.equal(review.summary.changed_song_count, 0);
  model.cancelPreview(); assert.equal(server.packs.size, 4); await model.previewOrganization('create_pack', {name: 'Empty original'}); await model.commit();
  const target = model.snapshot().operation.preview.request.action.pack_id; assert.equal(server.packs.get(target).import_pack_id, null);
  await model.setView({view: 'packs', search: 'Empty original'}); assert.equal(model.snapshot().response.rows.length, 1); assert.equal(model.snapshot().response.rows[0].active_song_count, 0);
  await model.previewOrganization('rename_pack', {collectionId: target, name: 'Renamed original'}); assert.equal(model.snapshot().preview.summary.affected_packs[0].name, 'Renamed original'); await model.commit();
  await model.setView({view: 'active', collection_id: target, search: ''}); assert.deepEqual(model.snapshot().response.rows, []); assert.equal(server.rows.length, before); assert.equal(server.history.size, 2);
  await model.previewOrganization('rename_pack', {collectionId: [...server.packs.values()].find(pack => pack.kind === 'imported').collection_id, name: 'Forbidden'}); assert.equal(model.snapshot().preview, null); assert.equal(model.snapshot().error.code, 'catalog_invalid_request'); model.destroy();
});
test('safe exact additions share editions, keep current Basic selectable, report duplicate noops and block unavailable rows', async () => {
  const {server, model, adapter} = await harness(), original = structuredClone(server.rows), target = customPackId(0), current = {libraryKey: `native:${server.rows[1].key}`};
  adapter.ownsCleanSong = song => song === current; model.getProtectedSong = () => current;
  model.toggle(server.rows[0], true); model.toggle(server.rows[1], true); assert.equal(model.snapshot().selected.length, 2); await model.previewSelection(); assert.equal(model.snapshot().error.code, 'catalog_current_song');
  await model.previewOrganization('add_memberships', {collectionId: target}); assert.equal(model.snapshot().preview.summary.added_membership_count, 2); assert.deepEqual(model.snapshot().preview.preview.request.action.song_ids, original.slice(0, 2).map(row => row.edition_id)); await model.commit();
  for (let index = 0; index < 2; index++) { assert.equal(server.rows[index].packs.length, original[index].packs.length + 1); assert.deepEqual(server.rows[index].packs.slice(0, -1), original[index].packs); }
  model.toggle(server.rows[0], true); await model.previewOrganization('add_memberships', {collectionId: target}); assert.equal(model.snapshot().preview.summary.added_membership_count, 0); assert.equal(model.snapshot().preview.summary.unchanged_membership_count, 1); assert.deepEqual(model.snapshot().preview.summary.affected_packs, []); await model.commit();
  server.rows[1].physical_available = false; await model.refresh(); model.toggle(server.rows[1], true); assert.equal(model.snapshot().selected.length, 0); await model.setView({view: 'packs'}); const pack = model.snapshot().response.rows.find(row => row.collection_id === target); assert.equal(pack.active_song_count, 2); assert.equal(pack.available_song_count, 1); assert.equal(pack.shared_song_count, 2); model.destroy();
});
test('combined pack and song reads fail closed on partial read, changed snapshot and repeated cursor', async () => {
  for (const mode of ['failure', 'mismatch', 'cursor']) {
    const {server, model} = await harness({manyPacks: 104}); assert.equal(model.snapshot().packs.length, 106); model.toggle(server.rows[0], true);
    server.setUserPackRoute(async request => { if (request.path.endsWith('/query') && request.body.view === 'packs') { if (mode === 'failure') throw Error('Original partial pack read failure'); const value = await request.proceed().then(reply => reply.json()); if (mode === 'mismatch') value.snapshot_id = 'a'.repeat(64); else if (request.body.cursor) value.next_cursor = request.body.cursor; return nativeResponse(value); } return request.proceed(); });
    assert.equal(await model.refresh(), false); const state = model.snapshot(); assert.equal(state.phase, 'error'); assert.equal(state.stale, true); assert.equal(state.response, null); assert.equal(state.packs, null); assert.deepEqual(state.selected, []);
    await model.previewOrganization('create_pack', {name: 'Blocked'}); assert.equal(model.snapshot().preview, null); assert.equal(server.history.size, 0); model.destroy();
  }
});
test('organization cancellation and stale previews never submit, while lost commit replies reconcile original IDs after reopen', async () => {
  const {server, model, create, store} = await harness(), admitted = deferred(), gate = deferred();
  server.setUserPackRoute(async request => { if (request.path.endsWith('/preview')) { admitted.resolve(); await gate.promise; } return request.proceed(); });
  const pending = model.previewOrganization('create_pack', {name: 'Cancelled'}); await admitted.promise; model.cancelPreview(); gate.resolve(); await pending; assert.equal(model.snapshot().preview, null); assert.equal(store.get(libraryId), null);
  server.setUserPackRoute(null); server.bumpGeneration(); await model.previewOrganization('create_pack', {name: 'Stale'}); assert.equal(model.snapshot().stale, true); assert.equal(model.snapshot().preview, null); await model.refresh();
  await model.previewOrganization('rename_pack', {collectionId: customPackId(0), name: 'Durable renamed pack'}); const id = model.snapshot().preview.preview.request.operation_id;
  server.setUserPackRoute(async request => { const result = await request.proceed(); if (request.path.endsWith('/commit')) throw Error('Original lost durable reply'); return result; }); await model.commit(); assert.equal(model.snapshot().operation.phase, 'uncertain'); model.destroy(); server.setUserPackRoute(null);
  const reopened = create(); await reopened.open(); assert.equal(reopened.snapshot().operation.phase, 'committed'); assert.equal(reopened.snapshot().operation.operation_id, id); assert.equal(server.packs.get(customPackId(0)).name, 'Durable renamed pack'); assert.equal(server.history.size, 1); assert.equal(server.catalogRequests.filter(row => row.path.endsWith('/commit')).length, 1); reopened.destroy();
});

test('invalid pack names fail before native preview and preserve the exact song selection', async () => {
  const {server, model} = await harness(); model.toggle(server.rows[0], true);
  const calls = server.catalogRequests.length;
  for (const name of ['', '   ', '界'.repeat(86), 'original\nname']) { await model.previewOrganization('create_pack', {name}); assert.equal(model.snapshot().preview, null); assert.equal(model.snapshot().error.code, 'catalog_pack_name'); }
  assert.equal(server.catalogRequests.length, calls); assert.deepEqual(model.snapshot().selected.map(row => row.edition_id), [server.rows[0].edition_id]); model.destroy();
});
