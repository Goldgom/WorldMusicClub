import test from 'node:test';
import assert from 'node:assert/strict';
import {openScoreStorage} from '../web/native-score-storage.js';
import {LibraryCatalogModel} from '../web/library-catalog-model.js';
import {LibraryOperationStore} from '../web/library-operation-store.js';
import {membershipPackServer, seedMemberships} from './library-pack-membership-fixtures.js';
import {customPackId} from './library-user-pack-fixtures.js';
import {memoryStorage, libraryId} from './library-catalog-fixtures.js';
import {deferred, nativeResponse} from './native-storage-app-fixtures.js';
const source = customPackId(0), destination = customPackId(1);
async function harness() {
  const server = await membershipPackServer(); seedMemberships(server);
  const adapter = await openScoreStorage({origin: 'https://wmh.localhost', fetcher: server.fetcher}), store = new LibraryOperationStore({storage: memoryStorage()});
  const create = (operationStore = store) => new LibraryCatalogModel({getStorage: async () => adapter, operationStore});
  const model = create(); await model.open(); await model.setView({collection_id: source}); assert.equal(model.snapshot().phase, 'ready');
  return {server, adapter, store, create, model};
}
const choose = (model, server) => { for (const row of server.rows.slice(0, 2)) model.toggle(row, true); };
test('membership removal leaves exact editions active, preserves other references, and reports newly unfiled songs', async () => {
  const {server, model} = await harness();
  server.rows[1].packs = [server.packs.get(source)]; server.rows[1].pack_count = 1; await model.refresh();
  const before = structuredClone(server.rows); choose(model, server); await model.previewMemberships('remove_memberships');
  const review = model.snapshot().preview; assert.equal(review.kind, 'remove_memberships'); assert.equal(review.summary.removed_membership_count, 2); assert.equal(review.summary.shared_song_count, 1); assert.deepEqual(review.preview.effects.newly_unfiled_songs, [server.rows[1].edition_id]);
  model.cancelPreview(); assert.deepEqual(server.rows, before); assert.equal(server.history.size, 0);
  await model.previewMemberships('remove_memberships'); assert.equal(await model.commit(), true); assert.equal(model.snapshot().response.rows.length, 0);
  for (const [index, row] of server.rows.entries()) assert.deepEqual(row, index < 2 ? {...before[index], packs: before[index].packs.filter(pack => pack.collection_id !== source), pack_count: before[index].pack_count - 1} : before[index]);
  assert.equal(model.canUndoMemberships(), true); model.destroy();
});
test('move and durable Undo preserve preexisting destination memberships and restart without renderer recovery data', async () => {
  const {server, model, create} = await harness(), before = structuredClone(server.rows); choose(model, server);
  await model.previewMemberships('move_memberships', {destinationCollectionId: destination}); const review = model.snapshot().preview;
  assert.equal(review.summary.removed_membership_count, 2); assert.equal(review.summary.added_membership_count, 1); assert.equal(review.summary.unchanged_membership_count, 1);
  await model.commit(); const id = model.snapshot().operation.operation_id; model.destroy();
  const reopened = create(new LibraryOperationStore({storage: memoryStorage()})); await reopened.open();
  assert.equal(reopened.snapshot().operation, null); assert.equal(reopened.snapshot().status.membership_undo.operation_id, id); assert.equal(reopened.canUndoMemberships(), true);
  await reopened.previewUndoMemberships(); assert.equal(reopened.snapshot().preview.preview.request.action.membership_operation_id, id); assert.deepEqual(reopened.snapshot().preview.selected.map(row => row.edition_id), before.slice(0, 2).map(row => row.edition_id).sort());
  assert.equal(reopened.snapshot().preview.preview.effects.removed_memberships.length, 1); await reopened.commit();
  for (const [index, row] of server.rows.entries()) assert.deepEqual({...row, packs: [...row.packs].sort((a, b) => a.collection_id.localeCompare(b.collection_id))}, {...before[index], packs: [...before[index].packs].sort((a, b) => a.collection_id.localeCompare(b.collection_id))});
  assert.equal(reopened.canUndoMemberships(), false); assert.equal(server.history.size, 2); reopened.destroy();
});
test('current complete song stays selectable for removal and move while global song Trash remains guarded', async () => {
  const {server, model, adapter} = await harness(), current = {libraryKey: `native:${server.rows[1].key}`}; adapter.ownsCleanSong = value => value === current; model.getProtectedSong = () => current;
  model.toggle(server.rows[1], true); await model.previewSelection(); assert.equal(model.snapshot().error.code, 'catalog_current_song');
  await model.previewMemberships('move_memberships', {destinationCollectionId: destination}); assert.equal(model.snapshot().preview.kind, 'move_memberships'); assert.equal(await model.commit(), true); assert.equal(model.getProtectedSong(), current); assert.equal(server.rows[1].trashed_by, null); model.destroy();
});
test('source scope and destination validation reject imported, same-pack and cross-view selections before preview', async () => {
  const {server, model} = await harness(); choose(model, server); const before = server.catalogRequests.length;
  for (const target of [source, server.rows[0].packs.find(pack => pack.kind === 'imported').collection_id, 'unknown']) { await model.previewMemberships('move_memberships', {destinationCollectionId: target}); assert.equal(model.snapshot().preview, null); }
  assert.equal(server.catalogRequests.length, before);
  for (const collection_id of [null, server.rows[0].packs.find(pack => pack.kind === 'imported').collection_id]) { await model.setView({collection_id}); model.toggle(server.rows[0], true); await model.previewMemberships('remove_memberships'); assert.equal(model.snapshot().preview, null); }
  await model.setView({view: 'trash', collection_id: null}); await model.previewMemberships('remove_memberships'); assert.equal(model.snapshot().preview, null); assert.equal(server.history.size, 0); model.destroy();
});
test('canceled and stale membership previews never write, and lost move and Undo replies keep original IDs', async () => {
  const {server, model, create} = await harness(), gate = deferred(), admitted = deferred(); choose(model, server);
  server.setMembershipRoute(async request => { if (request.path.endsWith('/preview')) { admitted.resolve(); await gate.promise; } return request.proceed(); });
  const pending = model.previewMemberships('remove_memberships'); await admitted.promise; model.cancelPreview(); gate.resolve(); await pending; assert.equal(model.snapshot().preview, null); assert.equal(server.history.size, 0);
  server.setMembershipRoute(null); server.bumpGeneration(); await model.previewMemberships('remove_memberships'); assert.equal(model.snapshot().stale, true); await model.refresh(); choose(model, server);
  await model.previewMemberships('move_memberships', {destinationCollectionId: destination}); const move = model.snapshot().preview.preview.request.operation_id;
  server.setMembershipRoute(async request => { const result = await request.proceed(); if (request.path.endsWith('/commit')) throw Error('Lost durable membership reply'); return result; }); await model.commit(); assert.equal(model.snapshot().operation.phase, 'uncertain'); model.destroy(); server.setMembershipRoute(null);
  const resumed = create(); await resumed.open(); assert.equal(resumed.snapshot().operation.operation_id, move); assert.equal(resumed.snapshot().operation.phase, 'committed');
  await resumed.previewUndoMemberships(); const undo = resumed.snapshot().preview.preview.request.operation_id;
  server.setMembershipRoute(async request => { const result = await request.proceed(); if (request.path.endsWith('/commit')) throw Error('Lost durable Undo reply'); return result; }); await resumed.commit(); resumed.destroy(); server.setMembershipRoute(null);
  const finished = create(); await finished.open(); assert.equal(finished.snapshot().operation.operation_id, undo); assert.equal(finished.snapshot().operation.phase, 'committed'); assert.equal(finished.canUndoMemberships(), false); assert.equal(server.catalogRequests.filter(row => row.path.endsWith('/commit')).length, 2); assert.equal(server.history.size, 2); finished.destroy();
});
test('proven-absent membership retry reuses one frozen operation and Undo rejects intervening affected-edge changes', async () => {
  const {server, model, store} = await harness(); choose(model, server); await model.previewMemberships('remove_memberships'); const id = model.snapshot().preview.preview.request.operation_id;
  server.setMembershipRoute(request => request.path.endsWith('/commit') ? Promise.reject(Error('Disconnected before dispatch')) : request.proceed()); await model.commit(); assert.equal(model.snapshot().operation.phase, 'uncertain'); await model.retry(); assert.equal(server.catalogRequests.filter(row => row.path.endsWith('/commit')).length, 1);
  server.setMembershipRoute(null); await model.checkOperation(); assert.equal(model.snapshot().operation.phase, 'not_committed'); await model.retry(); assert.equal(model.snapshot().operation.operation_id, id); assert.equal(model.snapshot().operation.phase, 'committed'); assert.equal(store.get(libraryId).operation_id, id);
  await model.setView({collection_id: null}); model.toggle(server.rows[0], true); await model.previewOrganization('add_memberships', {collectionId: source}); await model.commit(); assert.equal(model.snapshot().status.membership_undo.operation_id, id); assert.equal(model.canUndoMemberships(), false); await model.previewUndoMemberships(); assert.equal(model.snapshot().preview, null); assert.equal(server.history.size, 2); model.destroy();
});
test('Undo controls fail closed when status metadata changes between verified catalog reads', async () => {
  const {server, model} = await harness(); choose(model, server); await model.previewMemberships('remove_memberships'); await model.commit();
  server.setMembershipRoute(async request => { const result = await request.proceed(); if (request.path.endsWith('/status')) { const value = await result.json(); value.generation++; return nativeResponse(value); } return result; });
  assert.equal(await model.refresh(), false); assert.equal(model.snapshot().stale, true); assert.equal(model.snapshot().response, null); await model.previewUndoMemberships(); assert.equal(model.snapshot().preview, null); assert.equal(server.history.size, 1); model.destroy();
});

test('native Undo survives unrelated receipt replacement and restores selection hidden across pack pages', async () => {
  const {server, model, create} = await harness(); await model.setView({limit: 1}); model.toggle(server.rows[0], true); await model.next(); model.toggle(server.rows[1], true);
  await model.previewMemberships('remove_memberships'); assert.equal(model.snapshot().preview.selected.length, 2); await model.commit(); const membershipId = model.snapshot().operation.operation_id;
  await model.previewOrganization('rename_pack', {collectionId: destination, name: 'Unrelated renamed destination'}); await model.commit(); assert.equal(model.snapshot().operation.kind, 'rename_pack'); assert.equal(model.snapshot().status.membership_undo.operation_id, membershipId); assert.equal(model.canUndoMemberships(), true); model.destroy();
  const reopened = create(); await reopened.open(); assert.equal(reopened.snapshot().operation.kind, 'rename_pack'); assert.equal(reopened.canUndoMemberships(), true); await reopened.previewUndoMemberships(); await reopened.commit(); assert.ok(server.rows.slice(0, 2).every(row => row.packs.some(pack => pack.collection_id === source))); assert.equal(server.packs.get(destination).name, 'Unrelated renamed destination'); reopened.destroy();
});

test('an Undo preview with different native descriptor names is never confirmable', async () => {
  const {server, model} = await harness(); choose(model, server); await model.previewMemberships('remove_memberships'); await model.commit();
  server.setMembershipRoute(async request => { const result = await request.proceed(); if (request.path.endsWith('/preview')) { const value = await result.json(); value.summary.source_pack.name = value.summary.target_pack.name = 'Different source label'; for (const pack of value.summary.affected_packs) pack.name = 'Different source label'; return nativeResponse(value); } return result; });
  await model.previewUndoMemberships(); assert.equal(model.snapshot().preview, null); assert.equal(model.snapshot().error.code, 'catalog_invalid_response'); assert.equal(server.history.size, 1); model.destroy();
});
