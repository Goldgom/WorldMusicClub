import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {catalogQuery, catalogPreviewRequest, checkedCatalogQuery, checkedCatalogPreview, checkedCatalogSync, checkedCatalogResult, checkedRecoveryRecord} from '../web/library-catalog-contract.js';
import {openScoreStorage} from '../web/native-score-storage.js';

const hash = character => character.repeat(64), packId = character => `collection-${character.repeat(32)}`;
const libraryId = `library-${hash('a')}`, target = packId('b'), other = packId('c');
const songIds = [`legacy:song-${hash('1')}`, `clean:song-${hash('1')}`, `legacy:song-${hash('2')}`];
const operationId = `operation-${'d'.repeat(32)}`;
const envelope = () => ({format: 'worldmusichub-catalog', version: 1, native_only: true, library_id: libraryId});
const custom = () => ({collection_id: target, kind: 'custom', import_pack_id: null, name: 'Practice set'});
const imported = () => ({collection_id: other, kind: 'imported', import_pack_id: `import-${hash('e')}`, name: 'Original source'});
const invalid = callback => assert.throws(callback, {code: 'catalog_invalid_response'});
const mutate = (value, change) => { const next = structuredClone(value); change(next); return next; };
const requestFor = (action, overrides = {}) => ({action, edition_ids: action === 'add_memberships' ? [...songIds] : [], collection_id: action === 'create_pack' ? null : target, name: action === 'add_memberships' ? null : 'Practice set', trash_operation_id: null, expected_generation: 7, catalog_digest: hash('f'), library_id: libraryId, ...overrides});
function previewFor(request, {unchanged = 0} = {}) {
  const type = request.action, action = type === 'add_memberships' ? {type, pack_id: target, song_ids: [...request.edition_ids]} : {type, pack_id: target, name: request.name};
  const effects = {created_packs: [], renamed_packs: [], added_memberships: [], removed_memberships: [], trashed_songs: [], trashed_packs: [], restored_songs: [], restored_packs: [], noops: [], blocked_memberships: [], affected_packs: [], newly_unfiled_songs: [], retained_payload_bytes: 4096, retained_source_bytes: 2048, reclaimed_bytes: 0};
  if (type === 'create_pack') effects.created_packs.push(target);
  else if (type === 'rename_pack') {
    if (unchanged) effects.noops.push({target: {kind: 'entity', id: {kind: 'pack', id: target}}, reason: 'unchanged_name'});
    else effects.renamed_packs.push(target);
  } else {
    effects.added_memberships = request.edition_ids.slice(unchanged).map(song => ({pack: target, song}));
    effects.noops = request.edition_ids.slice(0, unchanged).map(song => ({target: {kind: 'membership', id: {pack: target, song}}, reason: 'already_present'}));
  }
  if (effects.created_packs.length || effects.renamed_packs.length || effects.added_memberships.length) effects.affected_packs.push(target);
  const preview = {request: {schema_version: 1, operation_id: operationId, expected_generation: request.expected_generation, at_unix_ms: 1700000000000, action}, request_digest: hash('4'), base_digest: request.catalog_digest, next_generation: request.expected_generation + 1, effects, plan_digest: hash('5')};
  return {...envelope(), preview, summary: {selected_count: request.edition_ids.length, changed_song_count: 0, created_pack_count: effects.created_packs.length, renamed_pack_count: effects.renamed_packs.length, added_membership_count: effects.added_memberships.length, unchanged_membership_count: type === 'add_memberships' ? unchanged : 0, removed_membership_count: 0, restored_membership_count: effects.added_memberships.length, shared_song_count: 0, target_pack: {...custom(), name: request.name || custom().name}, affected_packs: effects.affected_packs.map(() => ({...custom(), name: request.name || custom().name, selected_song_count: request.edition_ids.length})), reclaimed_bytes: 0}};
}
const recordFor = (request, value) => ({library_id: libraryId, operation_id: operationId, kind: request.action, phase: 'uncertain', preview: value.preview, summary: value.summary, selected: request.edition_ids.map(edition_id => ({edition_id, title: 'Original exercise'}))});
const resultFor = value => ({...envelope(), operation_id: operationId, outcome: 'committed', generation: value.preview.next_generation, catalog_digest: hash('6'), receipt: {preview: structuredClone(value.preview)}, replayed: false, kind: 'transition', seed_digest: null});
function queryResult(request, rows) {
  return {...envelope(), view: request.view, collection_id: request.collection_id, generation: 7, catalog_digest: hash('f'), snapshot_id: hash('8'), freshness: {kind: 'advisory_snapshot', change_detection: 'explicit_refresh', verified_at_unix_ms: 1700000000000, cached: true}, counts: {managed_songs: 3, active_songs: 3, trashed_songs: 0, packs: 2, memberships: 4}, total: rows.length, rows, next_cursor: null};
}
const songRow = (packs, trash = null) => ({edition_id: songIds[0], key: songIds[0].slice(7), storage_kind: 'legacy', title: 'Exercise', composer: '', score_id: 'original-exercise', profile: '', catalog_managed: true, physical_available: true, trashed_by: trash, packs, pack_count: packs.length});

test('pack queries and filtered song queries use typed collection identities and bounded counts', () => {
  assert.equal(catalogQuery().collection_id, null);
  const request = catalogQuery({view: 'packs'}), rows = [custom(), imported()].map(row => ({...row, active_song_count: 3, available_song_count: 2, shared_song_count: 1}));
  const value = queryResult(request, rows);
  assert.equal(checkedCatalogQuery(value, request, libraryId), value);
  for (const change of [v => { delete v.collection_id; }, v => { v.rows[0].kind = 'imported'; }, v => { v.rows[0].import_pack_id = imported().import_pack_id; }, v => { delete v.rows[1].kind; }, v => { v.rows[1].import_pack_id = null; }, v => { v.rows[0].available_song_count = 4; }, v => { v.rows[0].shared_song_count = -1; }, v => { v.rows[0].active_song_count = '3'; }, v => { v.rows.push(v.rows[0]); v.total++; }, v => { v.rows[0].unreviewed = true; }]) invalid(() => checkedCatalogQuery(mutate(value, change), request, libraryId));
  for (const input of [{view: 'packs', collection_id: target}, {collection_id: imported().import_pack_id}, {collection_id: ''}, {view: 'packs', cursor: 'next', refresh: true}, {view: 'packs', include_trash: true}]) assert.throws(() => catalogQuery(input), {code: 'catalog_invalid_request'});
  for (const view of ['active', 'trash']) {
    const filtered = catalogQuery({view, collection_id: target}), response = queryResult(filtered, [songRow([custom(), imported()], view === 'trash' ? operationId : null)]);
    assert.equal(checkedCatalogQuery(response, filtered, libraryId), response);
    invalid(() => checkedCatalogQuery(mutate(response, v => { v.collection_id = other; }), filtered, libraryId));
    invalid(() => checkedCatalogQuery(mutate(response, v => { v.rows[0].packs.shift(); v.rows[0].pack_count--; }), filtered, libraryId));
  }
});

test('historical imported references remain valid without invented IDs or custom identity coercion', () => {
  const request = catalogQuery(), oldPack = imported(); delete oldPack.kind;
  const response = queryResult(request, [songRow([oldPack])]); delete response.collection_id;
  assert.equal(checkedCatalogQuery(response, request, libraryId), response);
  for (const change of [v => { v.rows[0].packs[0].import_pack_id = null; }, v => { v.rows[0].packs[0].import_pack_id = target; }, v => { v.rows[0].packs[0].kind = 'custom'; }, v => { v.rows[0].packs[0].kind = 'unknown'; }]) invalid(() => checkedCatalogQuery(mutate(response, change), request, libraryId));
});

test('organization request validation keeps exact selection, bounded names, and old request bodies', () => {
  for (const type of ['create_pack', 'rename_pack', 'add_memberships']) {
    const request = requestFor(type), checked = catalogPreviewRequest(request);
    assert.deepEqual(checked, request); assert.notEqual(checked, request);
    for (const change of [v => { v.expected_generation = -1; }, v => { delete v.catalog_digest; }, v => { delete v.library_id; }, v => { v.trash_operation_id = operationId; }, v => { v.unreviewed = true; }]) invalid(() => catalogPreviewRequest(mutate(request, change)));
  }
  for (const name of ['', ' ', ' untrimmed', 'untrimmed ', '\nname', 'x\u0000y', '界'.repeat(86)]) invalid(() => catalogPreviewRequest(requestFor('create_pack', {name})));
  for (const name of ['x'.repeat(256), '界'.repeat(85), '<img onerror=alert(1)>']) assert.equal(catalogPreviewRequest(requestFor('create_pack', {name})).name, name);
  for (const request of [requestFor('create_pack', {collection_id: target}), requestFor('rename_pack', {collection_id: null}), requestFor('rename_pack', {edition_ids: [songIds[0]]}), requestFor('add_memberships', {edition_ids: []}), requestFor('add_memberships', {edition_ids: [songIds[0], songIds[0]]}), requestFor('add_memberships', {edition_ids: [`song-${hash('1')}`]}), requestFor('add_memberships', {name: 'Hidden rename'})]) invalid(() => catalogPreviewRequest(request));
  const historical = {action: 'trash_songs', edition_ids: [songIds[0]], trash_operation_id: null, expected_generation: 7, catalog_digest: hash('f'), library_id: libraryId};
  assert.deepEqual(catalogPreviewRequest(historical), historical);
  invalid(() => catalogPreviewRequest({...historical, name: 'Hidden rename'}));
  invalid(() => catalogPreviewRequest({...historical, collection_id: target}));
});

test('create and rename previews crosscheck desired name, exact effects, and changed or unchanged outcomes', () => {
  for (const type of ['create_pack', 'rename_pack']) {
    const request = requestFor(type), value = previewFor(request);
    assert.equal(checkedCatalogPreview(value, request), value);
    for (const change of [v => { v.preview.request.action.name = 'Different name'; }, v => { v.preview.request.action.cascade = true; }, v => { v.preview.effects.created_packs.push(other); }, v => { v.preview.effects.renamed_packs.push(other); }, v => { v.preview.effects.affected_packs.push(other); }, v => { v.preview.effects.trashed_songs.push(songIds[0]); }, v => { v.preview.effects.added_memberships.push({pack: target, song: songIds[0]}); }, v => { v.preview.effects.adopted_packs = [other]; }, v => { v.preview.effects.newly_unfiled_songs = [songIds[0]]; }, v => { v.summary.affected_packs[0].name = 'Old name'; }, v => { v.summary.affected_packs[0] = {...imported(), collection_id: target, selected_song_count: 0}; }, v => { delete v.summary.created_pack_count; }, v => { v.summary.changed_song_count = 1; }, v => { v.summary.selected_count = 1; }, v => { v.summary.unchanged_membership_count = 1; }, v => { v.summary.unreviewed_effect = 1; }, v => { v.preview.next_generation++; }]) invalid(() => checkedCatalogPreview(mutate(value, change), request));
  }
  const request = requestFor('rename_pack'), value = previewFor(request, {unchanged: 1});
  assert.equal(checkedCatalogPreview(value, request), value);
  for (const change of [v => { v.preview.request.action.pack_id = other; }, v => { v.preview.effects.noops = []; }, v => { v.preview.effects.noops[0].target.id.id = other; }, v => { v.preview.effects.noops[0].reason = 'already_present'; }, v => { v.preview.effects.affected_packs = [target]; }, v => { v.summary.renamed_pack_count = 1; }]) invalid(() => checkedCatalogPreview(mutate(value, change), request));
});

test('adding memberships accounts for every exact edition once across changes and already-present noops', () => {
  const request = requestFor('add_memberships');
  for (const unchanged of [0, 1, songIds.length]) {
    const value = previewFor(request, {unchanged});
    assert.equal(checkedCatalogPreview(value, request), value);
  }
  const value = previewFor(request, {unchanged: 1});
  for (const change of [v => { v.preview.request.action.song_ids.reverse(); }, v => { v.preview.request.action.pack_id = other; }, v => { v.preview.effects.added_memberships.pop(); }, v => { v.preview.effects.added_memberships[0].pack = other; }, v => { v.preview.effects.added_memberships.push({pack: target, song: songIds[0]}); }, v => { v.preview.effects.noops.push(v.preview.effects.noops[0]); }, v => { v.preview.effects.noops[0].target.id.pack = other; }, v => { v.preview.effects.noops[0].target.id.song = songIds[1]; }, v => { v.preview.effects.noops[0].reason = 'already_absent'; }, v => { v.preview.effects.noops[0].target.id.hidden = true; }, v => { v.preview.effects.blocked_memberships.push({membership: {pack: target, song: songIds[0]}, dependencies: [{kind: 'pack', id: target}]}); }, v => { v.summary.affected_packs[0].selected_song_count = 2; }, v => { v.summary.affected_packs[0].kind = undefined; }, v => { v.summary.added_membership_count++; }, v => { v.summary.unchanged_membership_count++; }, v => { v.summary.changed_song_count++; }, v => { v.summary.restored_membership_count = 0; }, v => { v.summary.shared_song_count = 4; }]) invalid(() => checkedCatalogPreview(mutate(value, change), request));
});

test('every organization preview identifies its custom target even when nothing changes', () => {
  for (const type of ['create_pack', 'rename_pack', 'add_memberships']) {
    const request = requestFor(type), value = previewFor(request, {unchanged: type === 'create_pack' ? 0 : type === 'rename_pack' ? 1 : songIds.length});
    assert.equal(checkedCatalogPreview(value, request), value);
    for (const change of [v => { delete v.summary.target_pack; }, v => { v.summary.target_pack.collection_id = other; }, v => { v.summary.target_pack.kind = 'imported'; v.summary.target_pack.import_pack_id = imported().import_pack_id; }, v => { delete v.summary.target_pack.kind; }, v => { v.summary.target_pack.import_pack_id = imported().import_pack_id; }, v => { v.summary.target_pack.selected_song_count = 0; }]) invalid(() => checkedCatalogPreview(mutate(value, change), request));
    if (type !== 'add_memberships') invalid(() => checkedCatalogPreview(mutate(value, v => { v.summary.target_pack.name = 'Wrong review name'; }), request));
  }
  const request = requestFor('add_memberships'), value = previewFor(request);
  invalid(() => checkedCatalogPreview(mutate(value, v => { v.summary.affected_packs[0].name = 'Mismatched target name'; }), request));
});

test('organization recovery and receipts retain original kind, operation, target, name, and selection', () => {
  for (const type of ['create_pack', 'rename_pack', 'add_memberships']) {
    const request = requestFor(type), value = previewFor(request), record = recordFor(request, value), result = resultFor(value);
    assert.equal(checkedRecoveryRecord(record, libraryId), record);
    assert.equal(checkedCatalogResult(result, record), result);
    assert.equal(checkedCatalogResult(result, record, {lookup: true}), result);
    assert.equal(checkedCatalogResult({...result, outcome: 'not_committed', receipt: null}, record, {lookup: true}).outcome, 'not_committed');
    for (const change of [v => { v.kind = 'trash_songs'; }, v => { v.operation_id = `operation-${'0'.repeat(32)}`; }, v => { v.library_id = `library-${hash('0')}`; }, v => { v.selected = [{edition_id: songIds[2], title: 'Unexpected'}]; }, v => { v.summary.created_pack_count++; }]) invalid(() => checkedRecoveryRecord(mutate(record, change), libraryId));
    for (const change of [v => { v.receipt.preview.request.action.pack_id = other; }, v => { v.receipt.preview.plan_digest = hash('9'); }, v => { v.generation = value.preview.next_generation - 1; }, v => { v.operation_id = `operation-${'0'.repeat(32)}`; }]) invalid(() => checkedCatalogResult(mutate(result, change), record));
    invalid(() => checkedCatalogResult(result, {...record, kind: 'trash_songs'}));
  }
  for (const type of ['rename_pack', 'add_memberships']) {
    const request = requestFor(type), value = previewFor(request, {unchanged: type === 'rename_pack' ? 1 : songIds.length});
    assert.ok(checkedRecoveryRecord(recordFor(request, value), libraryId));
  }
});

test('captured historical native previews and recovery pointers still pass without changing their wire values', async () => {
  const samples = JSON.parse(await readFile(new URL('./fixtures/library-catalog/native-responses.json', import.meta.url), 'utf8'));
  let verified = 0;
  for (const call of samples.native_calls) {
    if (call.path.endsWith('/catalog/query')) {
      assert.equal(checkedCatalogQuery(call.response, catalogQuery(call.request), call.response.library_id), call.response); verified++;
    } else if (call.path.endsWith('/catalog/preview') || call.path.endsWith('/catalog/sync/preview')) {
      const syncing = call.path.endsWith('/sync/preview'), value = call.response, action = value.preview.request.action;
      assert.equal((syncing ? checkedCatalogSync : checkedCatalogPreview)(value, call.request), value);
      const kind = syncing ? 'sync_imports' : action.type === 'restore' ? 'restore_songs' : action.type;
      const ids = syncing ? value.preview.effects.adopted_songs || [] : call.request.edition_ids;
      const record = {library_id: value.library_id, operation_id: value.preview.request.operation_id, kind, phase: 'uncertain', preview: value.preview, summary: value.summary, selected: ids.map(edition_id => ({edition_id, title: 'Historical native edition'}))};
      assert.equal(checkedRecoveryRecord(record, record.library_id), record); verified++;
    }
  }
  assert.ok(verified >= 10, 'Historical captured query, trash, restore and sync values were actually checked');
});

test('production native adapter sends exact organization previews and reconciles lost responses by original identity', async () => {
  const health = {name: 'WorldMusicHub', engine: 'rust', network: 'native-protocol-no-listener', score_format_version: 1, library_catalog_version: 1};
  for (const type of ['create_pack', 'rename_pack', 'add_memberships']) {
    const request = requestFor(type), value = previewFor(request), record = recordFor(request, value), calls = [];
    const adapter = await openScoreStorage({origin: 'https://wmh.localhost', fetcher: async (path, options) => {
      const reply = data => ({ok: true, status: 200, json: async () => structuredClone(data)});
      if (path === '/api/health') return reply(health);
      calls.push({path, body: JSON.parse(options.body), options});
      if (path.endsWith('/preview')) return reply(value);
      if (path.endsWith('/commit')) throw Error('Original authored response loss after commit');
      if (path.endsWith('/operation')) return reply(resultFor(value));
      throw Error(`Unexpected route ${path}`);
    }});
    try {
      assert.deepEqual(await adapter.previewCatalog(request), value);
      await assert.rejects(adapter.commitCatalog(record), {outcome: 'uncertain'});
      assert.deepEqual(await adapter.catalogOperation(record), resultFor(value));
      assert.deepEqual(calls.map(call => call.path), ['/api/library/catalog/preview', '/api/library/catalog/commit', '/api/library/catalog/operation']);
      assert.deepEqual(calls[0].body, request);
      assert.deepEqual(calls[1].body, {preview: value.preview, library_id: libraryId});
      assert.equal(calls[1].options.signal, undefined);
      assert.deepEqual(calls[2].body, {operation_id: operationId, library_id: libraryId});
      assert.ok(calls.every(call => call.options.credentials === 'same-origin' && call.options.redirect === 'error'));
    } finally { adapter.close(); }
  }
});

test('unfiltered native queries preserve old-host fields through a complete reviewed Trash flow', async () => {
  const {native_calls: samples} = JSON.parse(await readFile(new URL('./fixtures/library-catalog/native-responses.json', import.meta.url), 'utf8'));
  const ready = samples.find(call => call.path.endsWith('/status') && call.response.state === 'ready');
  const active = samples.find(call => call.path.endsWith('/catalog/query') && call.request.view === 'active');
  const trash = samples.find(call => call.path.endsWith('/catalog/query') && call.request.view === 'trash');
  const review = samples.find(call => call.path.endsWith('/catalog/preview') && call.request.action === 'trash_songs');
  const commit = samples.find(call => call.path.endsWith('/commit') && call.request.preview.request.action.type === 'trash_songs');
  const calls = [], reply = (data, status = 200) => ({ok: status < 400, status, json: async () => structuredClone(data)});
  const adapter = await openScoreStorage({origin: 'https://wmh.localhost', fetcher: async (path, options) => {
    if (path === '/api/health') return reply({name: 'WorldMusicHub', engine: 'rust', network: 'native-protocol-no-listener', score_format_version: 1, library_catalog_version: 1});
    const body = options.body === undefined ? null : JSON.parse(options.body); calls.push({path, body});
    if (path.endsWith('/status')) return reply(ready.response);
    if (path.endsWith('/query')) {
      if (Object.keys(body).some(key => !['view', 'search', 'limit', 'cursor', 'refresh'].includes(key))) return reply({code: 'catalog_invalid_request', error: 'Old v1 host denies unknown query fields'}, 400);
      return reply(body.view === 'trash' ? trash.response : active.response);
    }
    if (path.endsWith('/preview')) { assert.deepEqual(body, review.request); return reply(review.response); }
    if (path.endsWith('/commit')) { assert.deepEqual(body, commit.request); return reply(commit.response); }
    throw Error(`Unexpected old-host route ${path}`);
  }});
  try {
    const status = await adapter.catalogStatus();
    assert.equal(status.supported_operations.includes('create_pack'), false);
    assert.deepEqual(await adapter.queryCatalog({collection_id: null, libraryId: status.library_id}), active.response);
    const value = await adapter.previewCatalog(review.request), record = {library_id: status.library_id, operation_id: value.preview.request.operation_id, kind: 'trash_songs', preview: value.preview};
    assert.deepEqual(await adapter.commitCatalog(record), commit.response);
    assert.deepEqual(await adapter.queryCatalog({view: 'trash', collection_id: null, libraryId: status.library_id}), trash.response);
    assert.equal(calls.filter(call => call.path.endsWith('/commit')).length, 1);
    assert.ok(calls.filter(call => call.path.endsWith('/query')).every(call => !Object.hasOwn(call.body, 'collection_id')));
  } finally { adapter.close(); }
});

test('native query adapter sends explicit collection filters and verifies the returned filter', async () => {
  const request = catalogQuery({collection_id: target}), value = queryResult(request, [songRow([custom()])]), sent = [];
  let wrongFilter = false;
  const adapter = await openScoreStorage({origin: 'https://wmh.localhost', fetcher: async (path, options) => {
    const reply = data => ({ok: true, status: 200, json: async () => structuredClone(data)});
    if (path === '/api/health') return reply({name: 'WorldMusicHub', engine: 'rust', network: 'native-protocol-no-listener', score_format_version: 1, library_catalog_version: 1});
    sent.push(JSON.parse(options.body));
    return reply(wrongFilter ? {...value, collection_id: null} : value);
  }});
  try {
    assert.deepEqual(await adapter.queryCatalog({...request, libraryId}), value);
    assert.deepEqual(sent[0], request);
    wrongFilter = true;
    await assert.rejects(adapter.queryCatalog({...request, libraryId}), {code: 'catalog_invalid_response'});
    assert.equal(sent[1].collection_id, target);
  } finally { adapter.close(); }
});
