import {managementServer, digest, songRow} from './library-management-fixtures.js';
import {nativeResponse, authoredScore} from './native-storage-app-fixtures.js';
const collection = id => `collection-${digest(id).slice(0, 32)}`;
export const operationId = id => `operation-${digest(id).slice(0, 32)}`;
export const libraryId = `library-${digest('original catalog test root')}`;
export const memoryStorage = () => { const values = new Map(); return {getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value)}; };
/** Original in-memory inventory, journal and native protocol; no user library or server. */
export async function catalogServer({initialized = true, many = 0, syncBatchSize = 1024} = {}) {
  const server = await managementServer({many}), catalogRequests = [], history = new Map();
  let generation = 0, operationSequence = 0, route = null, genesis = null, auxiliary = null;
  const rows = server.fixture.songs.map(row => ({edition_id: row.edition_id, key: row.key, storage_kind: row.storage_kind, title: row.title, composer: row.composer, score_id: row.score_id, profile: row.profile, catalog_managed: true, physical_available: true, trashed_by: null, packs: row.packs.map(pack => ({collection_id: collection(pack.pack_id), import_pack_id: pack.pack_id, name: pack.name})), pack_count: row.pack_count}));
  const first = [...server.records.values()][0].entry; Object.assign(rows[0], {key: first.key, edition_id: `legacy:${first.key}`, title: first.title, score_id: first.score_id});
  const clean = server.seed(authoredScore({id: 'catalog-clean-original', title: 'Original complete edition'})); Object.assign(rows[1], {key: clean.key, edition_id: `clean:${clean.key}`, title: clean.title, score_id: clean.score_id});
  const envelope = () => ({format: 'worldmusichub-catalog', version: 1, native_only: true, library_id: libraryId});
  const catalogDigest = () => digest(`authored generation ${generation}`);
  const counts = () => ({managed_songs: rows.filter(row => row.catalog_managed).length, active_songs: rows.filter(row => !row.trashed_by).length, trashed_songs: rows.filter(row => row.trashed_by).length, packs: 3, memberships: rows.filter(row => !row.trashed_by).reduce((sum, row) => sum + row.pack_count, 0)});
  const status = () => ({...envelope(), state: initialized ? 'ready' : 'uninitialized', generation: initialized ? generation : null, catalog_digest: initialized ? catalogDigest() : null, counts: initialized ? counts() : null, supported_operations: ['initialize', 'trash_songs', 'restore_songs', 'sync_inventory']});
  const nextOperation = () => operationId(`native-generated-${++operationSequence}`);
  const query = body => {
    let found = rows.filter(row => body.view === 'trash' ? row.trashed_by : !row.trashed_by);
    if (body.search) found = found.filter(row => JSON.stringify(row).toLowerCase().includes(body.search.toLowerCase()));
    const offset = body.cursor ? Number(body.cursor.split(':').at(-1)) : 0, snapshot_id = digest(JSON.stringify([generation, rows]));
    if (body.cursor && !body.cursor.startsWith(snapshot_id)) return nativeResponse({code: 'catalog_stale', error: 'Authored stale cursor'}, 409);
    return nativeResponse({...envelope(), view: body.view, generation, catalog_digest: catalogDigest(), snapshot_id, freshness: {kind: 'advisory_snapshot', verified_at_unix_ms: 1700000000000, cached: !body.refresh, change_detection: 'explicit_refresh'}, counts: counts(), total: found.length, next_cursor: offset + body.limit < found.length ? `${snapshot_id}:${offset + body.limit}` : null, rows: structuredClone(found.slice(offset, offset + body.limit))});
  };
  const makePreview = body => {
    const selected = body.action === 'sync_imports' ? rows.filter(row => !row.catalog_managed).slice(0, syncBatchSize) : body.edition_ids.map(id => rows.find(row => row.edition_id === id));
    const action = body.action === 'trash_songs' ? {type: 'trash_songs', song_ids: body.edition_ids} : body.action === 'sync_imports' ? {type: 'adopt_inventory', inventory: {songs: selected.map(row => ({id: row.edition_id})), packs: [], sources: [], memberships: [], origins: []}} : {type: 'restore', trash_operation_id: body.trash_operation_id, entities: body.edition_ids.map(id => ({kind: 'song', id})), memberships: []};
    const edges = selected.flatMap(row => row.packs.map(pack => ({pack: pack.collection_id, song: row.edition_id}))), affected = [...new Map(selected.flatMap(row => row.packs.map(pack => [pack.collection_id, pack]))).values()];
    const effects = {created_packs: [], renamed_packs: [], added_memberships: body.action === 'restore_songs' ? edges : [], removed_memberships: body.action === 'trash_songs' ? edges : [], trashed_songs: body.action === 'trash_songs' ? body.edition_ids : [], trashed_packs: [], restored_songs: body.action === 'restore_songs' ? body.edition_ids : [], restored_packs: [], noops: [], blocked_memberships: [], affected_packs: affected.map(pack => pack.collection_id), newly_unfiled_songs: [], retained_payload_bytes: 8000, retained_source_bytes: 5000, reclaimed_bytes: 0, ...(body.action === 'sync_imports' ? {adopted_songs: selected.map(row => row.edition_id)} : {})};
    const request = {schema_version: 1, operation_id: nextOperation(), expected_generation: body.expected_generation, at_unix_ms: 1700000000000, action};
    return {...envelope(), preview: {request, request_digest: digest(JSON.stringify(request)), base_digest: body.catalog_digest, next_generation: body.expected_generation + 1, effects, plan_digest: digest(JSON.stringify(effects))}, summary: {...(body.action === 'sync_imports' ? {remaining_song_count: rows.filter(row => !row.catalog_managed).length - selected.length, remaining_source_count: 0} : {}), selected_count: selected.length, changed_song_count: selected.length, removed_membership_count: effects.removed_memberships.length, restored_membership_count: effects.added_memberships.length, shared_song_count: selected.filter(row => row.pack_count > 1).length, affected_packs: affected.map(pack => ({...pack, selected_song_count: selected.filter(row => row.packs.some(member => member.collection_id === pack.collection_id)).length})), reclaimed_bytes: 0}};
  };
  function defaultCatalog(path, body) {
    if (path === '/api/library/catalog/status') return nativeResponse(status());
    if (body.library_id && body.library_id !== libraryId) return nativeResponse({code: 'catalog_conflict', error: 'Wrong library identity', outcome: 'not_committed', operation_id: body.preview?.request?.operation_id || body.preview?.operation_id}, 409);
    if (path === '/api/library/catalog/initialize/preview') return nativeResponse({...envelope(), preview: {kind: 'initialize', operation_id: nextOperation(), inventory_digest: digest('authored inventory'), seed_digest: digest('authored seed'), collections: server.fixture.packs.map(row => ({source_id: row.archive_key, collection_id: collection(row.pack_id)})), counts: counts(), library_id: libraryId, retained_payload_bytes: 8000, retained_source_bytes: 5000}});
    if (path === '/api/library/catalog/initialize') {
      initialized = true; genesis = body.preview;
      return nativeResponse({...envelope(), outcome: 'committed', operation_id: body.preview.operation_id, state: 'ready', generation, catalog_digest: catalogDigest(), counts: counts(), replayed: false});
    }
    if (path === '/api/library/catalog/operation') {
      const receipt = history.get(body.operation_id), bootstrap = genesis?.operation_id === body.operation_id;
      return nativeResponse({...envelope(), outcome: receipt || bootstrap ? 'committed' : 'not_committed', operation_id: body.operation_id, generation: initialized ? generation : null, catalog_digest: initialized ? catalogDigest() : null, receipt: receipt ? {preview: receipt} : null, kind: receipt ? 'transition' : bootstrap ? 'initialize' : null, seed_digest: bootstrap ? genesis.seed_digest : null});
    }
    if (!initialized) return nativeResponse({code: 'catalog_not_initialized', error: 'Review initialization first'}, 409);
    if (path === '/api/library/catalog/query') return query(body);
    if (path === '/api/library/catalog/preview' || path === '/api/library/catalog/sync/preview') {
      if (body.expected_generation !== generation || body.catalog_digest !== catalogDigest()) return nativeResponse({code: 'catalog_stale', error: 'Authored generation changed'}, 409);
      return nativeResponse(makePreview(path.includes('/sync/') ? {...body, action: 'sync_imports'} : body));
    }
    if (path === '/api/library/catalog/commit') {
      const preview = body.preview, {request} = preview, old = history.get(request.operation_id);
      if (!old && (request.expected_generation !== generation || preview.base_digest !== catalogDigest())) return nativeResponse({code: 'catalog_stale', error: 'Authored conflict before decision', outcome: 'not_committed', operation_id: request.operation_id}, 409);
      if (!old) {
        for (const id of preview.effects.trashed_songs) rows.find(row => row.edition_id === id).trashed_by = request.operation_id;
        for (const id of preview.effects.restored_songs) rows.find(row => row.edition_id === id).trashed_by = null;
        for (const id of preview.effects.adopted_songs || []) rows.find(row => row.edition_id === id).catalog_managed = true;
        generation++; history.set(request.operation_id, structuredClone(preview));
      }
      return nativeResponse({...envelope(), outcome: 'committed', operation_id: request.operation_id, generation, catalog_digest: catalogDigest(), receipt: {preview: old || preview}, replayed: Boolean(old)});
    }
    throw Error(`Unknown original fixture route ${path}`);
  }
  server.setExtraRoute(async request => {
    const supplied = await auxiliary?.(request); if (supplied !== undefined) return supplied;
    if (request.path === '/api/health') return nativeResponse({name: 'WorldMusicHub', engine: 'rust', network: 'native-protocol-no-listener', score_format_version: 1, library_management_query_version: 1, library_catalog_version: 1});
    if (request.path === '/api/library/list') { const response = await request.defaultReply().json(); response.entries = response.entries.filter(entry => !rows.some(row => row.key === entry.key && row.trashed_by)); return nativeResponse(response); }
    if (request.path.startsWith('/api/library/catalog/')) {
      catalogRequests.push(request); const proceed = () => defaultCatalog(request.path, request.body || {});
      return await route?.({...request, proceed}) ?? proceed();
    }
  });
  return {...server, rows, history, catalogRequests, status, setAuxRoute: value => { auxiliary = value; }, setCatalogRoute: value => { route = value; }, bumpGeneration: () => { generation++; }, addNew(id) { const row = songRow(id); rows.push({...row, catalog_managed: false, physical_available: true, trashed_by: null, packs: []}); return rows.at(-1); }};
}
