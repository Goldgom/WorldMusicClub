import {catalogServer, libraryId, operationId} from './library-catalog-fixtures.js';
import {digest} from './library-management-fixtures.js';
import {nativeResponse} from './native-storage-app-fixtures.js';
export const customPackId = index => `collection-${digest(`authored custom pack ${index}`).slice(0, 32)}`;
/** Original protocol state fixture; no browser, listener or real library. */
export async function userPackServer({manyPacks = 0, ...options} = {}) {
  const server = await catalogServer(options), packs = new Map(); let route = null, sequence = 0;
  for (const row of server.rows) for (const pack of row.packs) { pack.kind = 'imported'; packs.set(pack.collection_id, {...pack}); }
  for (let index = 0; index < Math.max(2, manyPacks); index++) packs.set(customPackId(index), {collection_id: customPackId(index), kind: 'custom', import_pack_id: null, name: `Original custom pack ${index}`});
  const envelope = () => ({format: 'worldmusichub-catalog', version: 1, native_only: true, library_id: libraryId});
  const status = () => ({...server.status(), supported_operations: [...server.status().supported_operations, 'create_pack', 'rename_pack', 'add_memberships']});
  const allPacks = () => [...packs.values()].map(pack => {
    const active = server.rows.filter(row => !row.trashed_by && row.packs.some(ref => ref.collection_id === pack.collection_id));
    return {...pack, active_song_count: active.length, available_song_count: active.filter(row => row.physical_available).length, shared_song_count: active.filter(row => row.pack_count > 1).length};
  });
  function preview(body) {
    const selected = body.edition_ids.map(id => server.rows.find(row => row.edition_id === id)), target = body.action === 'create_pack' ? {collection_id: customPackId(`created ${++sequence}`), kind: 'custom', import_pack_id: null, name: body.name} : packs.get(body.collection_id);
    if (!target || target.kind !== 'custom' || selected.some(row => !row || !row.physical_available || !row.catalog_managed || row.trashed_by)) return nativeResponse({code: 'catalog_invalid_request', error: 'Authored invalid target or edition'}, 400);
    const action = {type: body.action, pack_id: target.collection_id, ...(body.action === 'add_memberships' ? {song_ids: body.edition_ids} : {name: body.name})};
    const e = {created_packs: [], renamed_packs: [], added_memberships: [], removed_memberships: [], trashed_songs: [], trashed_packs: [], restored_songs: [], restored_packs: [], noops: [], blocked_memberships: [], affected_packs: [], newly_unfiled_songs: [], retained_payload_bytes: 8000, retained_source_bytes: 5000, reclaimed_bytes: 0};
    if (body.action === 'create_pack') e.created_packs.push(target.collection_id);
    if (body.action === 'rename_pack') {
      if (body.name === target.name) e.noops.push({reason: 'unchanged_name', target: {kind: 'entity', id: {kind: 'pack', id: target.collection_id}}});
      else e.renamed_packs.push(target.collection_id);
    }
    if (body.action === 'add_memberships') for (const row of selected) {
      const edge = {pack: target.collection_id, song: row.edition_id};
      if (row.packs.some(ref => ref.collection_id === target.collection_id)) e.noops.push({reason: 'already_present', target: {kind: 'membership', id: edge}});
      else e.added_memberships.push(edge);
    }
    if (e.created_packs.length || e.renamed_packs.length || e.added_memberships.length) e.affected_packs.push(target.collection_id);
    const request = {schema_version: 1, operation_id: operationId(`original pack operation ${++sequence}`), expected_generation: body.expected_generation, at_unix_ms: 1700000000000, action};
    return nativeResponse({...envelope(), preview: {request, request_digest: digest(JSON.stringify(request)), base_digest: body.catalog_digest, next_generation: body.expected_generation + 1, effects: e, plan_digest: digest(JSON.stringify(e))}, summary: {target_pack: {...target, ...(body.name ? {name: body.name} : {})}, selected_count: selected.length, changed_song_count: 0, removed_membership_count: 0, restored_membership_count: e.added_memberships.length, shared_song_count: selected.filter(row => row.pack_count > 1).length, created_pack_count: e.created_packs.length, renamed_pack_count: e.renamed_packs.length, added_membership_count: e.added_memberships.length, unchanged_membership_count: e.noops.filter(row => row.reason === 'already_present').length, affected_packs: e.affected_packs.length ? [{...target, ...(body.name ? {name: body.name} : {}), selected_song_count: selected.length}] : [], reclaimed_bytes: 0}});
  }
  async function proceed(request) {
    const {body, path} = request;
    if (path.endsWith('/status')) return nativeResponse(status());
    if (path.endsWith('/query')) {
      const base = {...envelope(), generation: status().generation, catalog_digest: status().catalog_digest, counts: {...status().counts, packs: packs.size}, freshness: {kind: 'advisory_snapshot', verified_at_unix_ms: 1700000000000, cached: !body.refresh, change_detection: 'explicit_refresh'}}, snapshot_id = digest(JSON.stringify([status().generation, server.rows, allPacks()]));
      let found = body.view === 'packs' ? allPacks() : server.rows.filter(row => body.view === 'trash' ? row.trashed_by : !row.trashed_by);
      if (body.collection_id) found = found.filter(row => row.packs.some(pack => pack.collection_id === body.collection_id));
      if (body.search) found = found.filter(row => (body.view === 'packs' ? row.name : JSON.stringify(row)).toLowerCase().includes(body.search.toLowerCase()));
      const offset = body.cursor ? Number(body.cursor.split(':').at(-1)) : 0;
      return nativeResponse({...base, view: body.view, collection_id: body.collection_id || null, snapshot_id, total: found.length, rows: structuredClone(found.slice(offset, offset + body.limit)), next_cursor: offset + body.limit < found.length ? `${snapshot_id}:${offset + body.limit}` : null});
    }
    if (path.endsWith('/preview') && ['create_pack', 'rename_pack', 'add_memberships'].includes(body.action)) {
      if (body.expected_generation !== status().generation || body.catalog_digest !== status().catalog_digest) return nativeResponse({code: 'catalog_stale', error: 'Authored stale generation'}, 409);
      return preview(body);
    }
    if (path.endsWith('/commit') && ['create_pack', 'rename_pack', 'add_memberships'].includes(body.preview.request.action.type)) {
      const p = body.preview, action = p.request.action;
      if (!server.history.has(p.request.operation_id)) {
        if (p.request.expected_generation !== status().generation) return nativeResponse({code: 'catalog_stale', error: 'Authored stale commit', outcome: 'not_committed', operation_id: p.request.operation_id}, 409);
        if (action.type === 'create_pack') packs.set(action.pack_id, {collection_id: action.pack_id, kind: 'custom', import_pack_id: null, name: action.name});
        if (action.type === 'rename_pack') { packs.get(action.pack_id).name = action.name; for (const row of server.rows) for (const pack of row.packs) if (pack.collection_id === action.pack_id) pack.name = action.name; }
        for (const edge of p.effects.added_memberships) { const row = server.rows.find(row => row.edition_id === edge.song); row.packs.push({...packs.get(edge.pack)}); row.pack_count = row.packs.length; }
        server.history.set(p.request.operation_id, structuredClone(p)); server.bumpGeneration();
      }
      return nativeResponse({...envelope(), outcome: 'committed', operation_id: p.request.operation_id, generation: status().generation, catalog_digest: status().catalog_digest, receipt: {preview: server.history.get(p.request.operation_id)}, replayed: false});
    }
    return request.proceed();
  }
  server.setCatalogRoute(request => { const next = () => proceed(request); return route ? route({...request, proceed: next}) : next(); });
  return {...server, packs, status, setUserPackRoute(value) { route = value; }, allPacks};
}
