import test from 'node:test';
import assert from 'node:assert/strict';
import {openScoreStorage} from '../web/native-score-storage.js';
import {LibraryCatalogModel} from '../web/library-catalog-model.js';
import {LibraryOperationStore} from '../web/library-operation-store.js';
import {checkedCatalogQuery, checkedCatalogPreview, catalogQuery} from '../web/library-catalog-contract.js';
import {catalogServer, memoryStorage, libraryId} from './library-catalog-fixtures.js';
import {deferred, nativeResponse} from './native-storage-app-fixtures.js';
const origin = 'https://wmh.localhost';
async function harness(options = {}) {
  const server = await catalogServer(options), adapter = await openScoreStorage({origin, fetcher: server.fetcher}), local = memoryStorage(), store = new LibraryOperationStore({storage: local}); let refreshes = 0;
  const create = () => new LibraryCatalogModel({getStorage: async () => adapter, operationStore: store, onCommitted: async () => { refreshes++; }});
  const model = create(); await model.open(); return {server, adapter, model, create, local, store, refreshes: () => refreshes};
}

test('initialization is capability-gated, explicitly reviewed and cancellation makes no native mutation', async () => {
  const {server, model} = await harness({initialized: false}); assert.equal(model.snapshot().phase, 'uninitialized');
  await model.previewInitialize(); assert.ok(model.snapshot().preview); model.cancelPreview();
  assert.equal(server.status().state, 'uninitialized'); assert.equal(server.catalogRequests.some(row => row.path.endsWith('/initialize')), false);
  await model.previewInitialize(); await model.commit(); assert.equal(server.status().state, 'ready'); assert.equal(model.snapshot().operation.phase, 'committed');
  const call = server.catalogRequests.find(row => row.path.endsWith('/initialize')); assert.equal(call.options.signal, undefined); assert.equal(call.body.library_id, libraryId);
  model.destroy();
});

test('mixed storage-qualified editions preview exact shared-pack impact; future rows never enter selection', async () => {
  const {server, model} = await harness(); const chosen = server.rows.slice(0, 2);
  chosen.forEach(row => model.toggle(row, true)); server.addNew('appeared after selection');
  await model.previewSelection(); const review = model.snapshot().preview;
  assert.deepEqual(review.preview.request.action.song_ids, chosen.map(row => row.edition_id)); assert.equal(review.summary.shared_song_count, 1); assert.equal(review.summary.affected_packs.length, 2); assert.equal(review.summary.removed_membership_count, 3); assert.equal(review.preview.effects.reclaimed_bytes, 0);
  model.toggle(chosen[0], false); assert.equal(model.snapshot().preview, null);
  await model.previewSelection(); await model.commit(); assert.equal(chosen[0].trashed_by, null); assert.ok(chosen[1].trashed_by); assert.equal(server.rows.at(-1).trashed_by, null); model.destroy();
});

test('durable pointer precedes submission, close never aborts admitted write, reopened status restores ownership', async () => {
  const {server, model, create, store} = await harness(), gate = deferred(), admitted = deferred(); let record;
  model.toggle(server.rows[0], true); await model.previewSelection();
  server.setCatalogRoute(async request => { if (request.path.endsWith('/commit')) { record = store.get(libraryId); admitted.resolve(); await gate.promise; assert.equal(request.options.signal, undefined); return request.proceed(); } });
  const pending = model.commit(); await admitted.promise; model.close(); model.destroy();
  assert.equal(record?.phase, 'submitted'); gate.resolve(); await pending;
  const restarted = create(); await restarted.open(); assert.equal(restarted.snapshot().operation.operation_id, record.operation_id); assert.equal(restarted.snapshot().operation.phase, 'committed'); assert.equal(server.history.size, 1); restarted.destroy();
});

test('lost response remains uncertain until same-ID lookup; failed lookup is never proof of absence', async () => {
  const {server, model, create} = await harness(); model.toggle(server.rows[0], true); await model.previewSelection();
  server.setCatalogRoute(request => { if (request.path.endsWith('/commit')) { request.proceed(); throw Error('Authored lost response'); } if (request.path.endsWith('/operation')) throw Error('Authored unreachable status'); });
  await model.commit(); const id = model.snapshot().operation.operation_id; assert.equal(model.snapshot().operation.phase, 'uncertain'); await model.checkOperation(); assert.equal(model.snapshot().operation.phase, 'uncertain');
  model.toggle(server.rows[1], true); await model.previewSelection(); assert.equal(model.snapshot().preview, null); model.destroy(); server.setCatalogRoute(null);
  const reopened = create(); await reopened.open(); assert.equal(reopened.snapshot().operation.phase, 'committed'); assert.equal(reopened.snapshot().operation.operation_id, id); assert.equal(server.catalogRequests.filter(row => row.path.endsWith('/commit')).length, 1); reopened.destroy();
});

test('unconfirmed admission errors never enable a new ID; proven not_committed permits only same-preview retry', async () => {
  const {server, model} = await harness(); model.toggle(server.rows[0], true); await model.previewSelection(); const frozen = structuredClone(model.snapshot().preview.preview);
  server.setCatalogRoute(request => request.path.endsWith('/commit') ? nativeResponse({code: 'library_busy', error: 'Authored queue occupied'}, 503) : undefined);
  await model.commit(); assert.equal(model.snapshot().operation.phase, 'uncertain'); await model.retry(); assert.equal(server.catalogRequests.filter(row => row.path.endsWith('/commit')).length, 1);
  await model.checkOperation(); assert.equal(model.snapshot().operation.phase, 'not_committed'); server.setCatalogRoute(null); await model.retry();
  assert.deepEqual(server.catalogRequests.filter(row => row.path.endsWith('/commit')).map(row => row.body.preview), [frozen, frozen]); assert.equal(model.snapshot().operation.phase, 'committed'); model.destroy();
});

test('stale preview and stale commit never silently refresh or replay an earlier selection', async () => {
  const {server, model} = await harness(); model.toggle(server.rows[0], true); server.bumpGeneration(); await model.previewSelection(); assert.equal(model.snapshot().error.code, 'catalog_stale'); assert.equal(model.snapshot().preview, null);
  await model.refresh(); assert.equal(model.snapshot().selected.length, 0); model.toggle(server.rows[1], true); await model.previewSelection(); server.bumpGeneration(); await model.commit(); assert.equal(model.snapshot().operation.phase, 'not_committed');
  await model.retry(); assert.equal(model.snapshot().operationError.code, 'catalog_stale'); await model.checkOperation(); model.acknowledgeUncommitted(); await model.refresh(); assert.equal(model.snapshot().selected.length, 0); assert.equal(model.pending(), false); model.destroy();
});

test('selected restore after mocked restart preserves other tombstones and does not reactivate new imports', async () => {
  const {server, model, create} = await harness(); model.toggle(server.rows[0], true); model.toggle(server.rows[1], true); await model.previewSelection(); await model.commit(); const trashId = model.snapshot().operation.operation_id; model.destroy();
  const restarted = create(); await restarted.open(); await restarted.setView({view: 'trash'}); restarted.toggle(server.rows[0], true); await restarted.previewSelection(); const preview = restarted.snapshot().preview;
  assert.equal(preview.preview.request.action.trash_operation_id, trashId); assert.deepEqual(preview.preview.effects.restored_songs, [server.rows[0].edition_id]); await restarted.commit(); assert.equal(server.rows[0].trashed_by, null); assert.equal(server.rows[1].trashed_by, trashId);
  const newly = server.addNew('new original import'); await restarted.setView({view: 'active'}); restarted.toggle(newly, true); assert.equal(restarted.snapshot().selected.length, 0); await restarted.previewSync(); await restarted.commit(); assert.equal(newly.catalog_managed, true); assert.equal(server.rows[1].trashed_by, trashId); restarted.destroy();
});

test('recovery persistence failure prevents native writes; malformed and wrong-library responses fail closed', async () => {
  const {server, model} = await harness(); model.toggle(server.rows[0], true); await model.previewSelection(); model.operationStore = new LibraryOperationStore({storage: {getItem: () => null, setItem() { throw Error('Full'); }}}); await model.commit(); assert.equal(model.snapshot().error.code, 'library_operation_storage'); assert.equal(server.history.size, 0);
  const response = model.snapshot().response;
  for (const mutate of [v => { v.library_id = `library-${'0'.repeat(64)}`; }, v => { v.rows[0].edition_id = v.rows[0].key; }, v => { v.rows[0].pack_count = 99; }, v => { v.rows.push(v.rows[0]); }]) { const copy = structuredClone(response); mutate(copy); assert.throws(() => checkedCatalogQuery(copy, catalogQuery(), libraryId), {code: 'catalog_invalid_response'}); }
  const p = model.snapshot().preview, request = server.catalogRequests.find(row => row.path.endsWith('/preview')).body;
  for (const mutate of [v => { v.preview.request.action.unreviewed_action = 'trash_pack'; }, v => { v.preview.request.action.song_ids.reverse(); v.preview.request.action.song_ids.push(server.rows[1].edition_id); }, v => { v.summary.changed_song_count++; }, v => { v.preview.effects.reclaimed_bytes = 1; }, v => { v.summary.affected_packs = []; }]) { const copy = {format: 'worldmusichub-catalog', version: 1, native_only: true, library_id: libraryId, preview: structuredClone(p.preview), summary: structuredClone(p.summary)}; mutate(copy); assert.throws(() => checkedCatalogPreview(copy, request), {code: 'catalog_invalid_response'}); }
  model.destroy();
});

test('invalidation and cancel discard late preview reads; no operation identity is persisted or submitted', async () => {
  for (const action of ['cancel', 'invalidate', 'close']) {
    const {server, model, store} = await harness(), gate = deferred(), admitted = deferred(); model.toggle(server.rows[0], true);
    server.setCatalogRoute(async request => { if (request.path.endsWith('/preview')) { admitted.resolve(); await gate.promise; return request.proceed(); } });
    const pending = model.previewSelection(); await admitted.promise;
    if (action === 'cancel') model.cancelPreview(); else if (action === 'invalidate') model.invalidate(); else model.close();
    gate.resolve(); await pending; assert.equal(model.snapshot().preview, null); assert.equal(store.get(libraryId), null); assert.equal(server.history.size, 0); model.destroy();
  }
});

test('wrong-operation write rejection remains uncertain instead of claiming no changes', async () => {
  const {server, model} = await harness(); model.toggle(server.rows[0], true); await model.previewSelection();
  server.setCatalogRoute(request => request.path.endsWith('/commit') ? nativeResponse({code: 'catalog_stale', error: 'Authored mismatched rejection', outcome: 'not_committed', operation_id: `operation-${'0'.repeat(32)}`}, 409) : undefined);
  await model.commit(); assert.equal(model.snapshot().operation.phase, 'uncertain'); model.destroy();
});

test('an already admitted media read retains adapter ownership across the catalog commit and metadata refresh', async () => {
  const {cleanDescriptor, fixtureKey, mediaFixture} = await import('./clean-song-fixtures.js');
  const {server, adapter, model} = await harness(), asset = mediaFixture(), descriptor = cleanDescriptor(({metadata}) => { metadata.media = [asset.descriptor]; }), key = fixtureKey.slice(7), score = descriptor.runtime.compilation.score, gate = deferred(), admitted = deferred();
  server.records.set(key, {entry: {key, revision: 1, title: score.title, composer: '', score_id: score.id, label: score.title, score_bytes: JSON.stringify(score).length, saved_at_unix_ms: 1700000000000, clean_package: {version: 2, content_sha256: descriptor.content_sha256, media: descriptor.media}}, score_json: JSON.stringify(score), clean_package: descriptor});
  Object.assign(server.rows[1], {key, edition_id: `clean:${key}`}); await model.refresh(); const loaded = await adapter.load(fixtureKey);
  server.setAuxRoute(async ({path}) => { if (path === '/api/library/asset') { admitted.resolve(); await gate.promise; return {ok: true, url: origin + '/api/library/asset', headers: {get: () => asset.descriptor.mime}, arrayBuffer: async () => Uint8Array.from(asset.data).buffer}; } });
  const read = adapter.loadAsset(fixtureKey, loaded.cleanSong.media[0].handle); await admitted.promise; model.toggle(server.rows[1], true); await model.previewSelection(); await model.commit(); assert.ok(server.rows[1].trashed_by); gate.resolve(); assert.equal((await read).size, asset.data.length); model.destroy();
});

test('catalog selection is exact across pages and locale-independent; refresh/filter clears hidden selections', async () => {
  const {server, model} = await harness({many: 50}); model.toggle(server.rows[0], true); model.toggle(server.rows[1], true); await model.next(); model.toggle(model.snapshot().response.rows[0], true);
  const ids = model.snapshot().selected.map(row => row.edition_id); assert.equal(ids.length, 3); await model.previewSelection(); assert.deepEqual(model.snapshot().preview.preview.request.action.song_ids, ids);
  await model.setView({search: 'authored'}); assert.equal(model.snapshot().selected.length, 0); assert.equal(model.snapshot().preview, null); model.selectPage(true); await model.refresh(); assert.equal(model.snapshot().selected.length, 0); model.destroy();
});

test('Trash selection cannot silently combine distinct original removal operations', async () => {
  const {server, model} = await harness(); model.toggle(server.rows[0], true); await model.previewSelection(); await model.commit(); model.toggle(server.rows[1], true); await model.previewSelection(); await model.commit(); await model.setView({view: 'trash'});
  assert.notEqual(server.rows[0].trashed_by, server.rows[1].trashed_by); model.toggle(server.rows[0], true); model.toggle(server.rows[1], true); assert.deepEqual(model.snapshot().selected.map(row => row.edition_id), [server.rows[0].edition_id]); model.destroy();
});

test('lost initialization response reconciles its original bootstrap ID and seed after restart', async () => {
  const {server, model, create} = await harness({initialized: false}); await model.previewInitialize(); const p = model.snapshot().preview.preview;
  server.setCatalogRoute(request => { if (request.path.endsWith('/initialize')) { request.proceed(); throw Error('Authored bootstrap response lost'); } }); await model.commit(); assert.equal(model.snapshot().operation.phase, 'uncertain'); model.destroy(); server.setCatalogRoute(null);
  const reopened = create(); await reopened.open(); assert.equal(reopened.snapshot().operation.phase, 'committed'); assert.equal(reopened.snapshot().result.kind, 'initialize'); assert.equal(reopened.snapshot().result.seed_digest, p.seed_digest); assert.equal(reopened.snapshot().operation.operation_id, p.operation_id); assert.equal(server.catalogRequests.filter(row => row.path.endsWith('/initialize')).length, 1); reopened.destroy();
});

test('a mismatched success receipt is uncertain until the exact saved receipt is verified', async () => {
  const {server, model} = await harness(); model.toggle(server.rows[0], true); await model.previewSelection();
  server.setCatalogRoute(async request => { if (request.path.endsWith('/commit')) { const response = await request.proceed().json(); response.receipt.preview.request.action.song_ids.push(server.rows[1].edition_id); return nativeResponse(response); } }); await model.commit(); assert.equal(model.snapshot().operation.phase, 'uncertain'); server.setCatalogRoute(null); await model.checkOperation(); assert.equal(model.snapshot().operation.phase, 'committed'); model.destroy();
});

test('a late old result cannot replace a newer persisted operation recovery pointer', async () => {
  const {server, model, create, store} = await harness(), gate = deferred(), committed = deferred(); model.toggle(server.rows[0], true); await model.previewSelection();
  server.setCatalogRoute(async request => { if (request.path.endsWith('/commit')) { const result = request.proceed(); committed.resolve(); await gate.promise; return result; } });
  const old = model.commit(); await committed.promise; model.destroy(); server.setCatalogRoute(null);
  const reopened = create(); await reopened.open(); reopened.toggle(server.rows[1], true); await reopened.previewSelection();
  server.setCatalogRoute(request => request.path.endsWith('/commit') ? Promise.reject(Error('Authored second response unavailable')) : undefined); await reopened.commit(); const next = store.get(libraryId); assert.equal(next.phase, 'uncertain');
  gate.resolve(); await old; assert.equal(store.get(libraryId).operation_id, next.operation_id); assert.equal(store.get(libraryId).phase, 'uncertain'); reopened.destroy();
});
