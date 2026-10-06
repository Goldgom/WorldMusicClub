import {userPackServer, customPackId} from './library-user-pack-fixtures.js';
import {libraryId, operationId} from './library-catalog-fixtures.js';
import {digest} from './library-management-fixtures.js';
import {nativeResponse} from './native-storage-app-fixtures.js';
const actions = ['remove_memberships', 'move_memberships', 'undo_memberships'];
const edgeKey = edge => `${edge.pack}:${edge.song}`;
/** Original deterministic protocol fixture, aligned with the native membership contract.
 * This fixture is development evidence; it does not prove native persistence. */
export async function membershipPackServer(options = {}) {
  const server = await userPackServer(options), revisions = new Map(), committedVersions = new Map();
  let route = null, sequence = 0;
  const envelope = () => ({format: 'worldmusichub-catalog', version: 1, native_only: true, library_id: libraryId});
  const changedSongs = preview => [...new Set([...preview.effects.added_memberships, ...preview.effects.removed_memberships].map(edge => edge.song))].sort();
  const originalFor = preview => preview.request.action.type === 'undo_memberships' ? server.history.get(preview.request.action.membership_operation_id) : preview;
  const packsFor = preview => {
    const action = originalFor(preview).request.action;
    return {source: server.packs.get(action.pack_id || action.from_pack), destination: action.to_pack ? server.packs.get(action.to_pack) : null};
  };
  const undone = id => [...server.history.values()].some(preview => preview.request.action.type === 'undo_memberships' && preview.request.action.membership_operation_id === id);
  function canUndo(preview) {
    const id = preview.request.operation_id, saved = committedVersions.get(id), {source, destination} = packsFor(preview);
    return Boolean(saved && !undone(id) && source?.kind === 'custom' && (!destination || destination.kind === 'custom') && [...saved].every(([key, version]) => revisions.get(key) === version) && changedSongs(preview).every(id => server.rows.some(row => row.edition_id === id && row.physical_available && !row.trashed_by)));
  }
  function undoCandidate() {
    const original = [...server.history.values()].reverse().find(preview => ['remove_memberships', 'move_memberships'].includes(preview.request.action.type) && changedSongs(preview).length && !undone(preview.request.operation_id));
    if (!original) return null;
    const {source, destination} = packsFor(original);
    return {operation_id: original.request.operation_id, action: original.request.action.type, selected_count: changedSongs(original).length, source_pack: structuredClone(source), destination_pack: structuredClone(destination), can_undo: canUndo(original)};
  }
  const status = () => ({...server.status(), supported_operations: [...server.status().supported_operations, ...actions], membership_undo: undoCandidate()});
  function preview(body) {
    const original = body.action === 'undo_memberships' ? server.history.get(body.membership_operation_id) : null;
    if (body.action === 'undo_memberships' && (!original || !['remove_memberships', 'move_memberships'].includes(original.request.action.type) || !canUndo(original))) return nativeResponse({code: 'catalog_conflict', error: 'Original membership edit cannot be undone exactly'}, 409);
    const source = original ? packsFor(original).source : server.packs.get(body.collection_id), destination = original ? packsFor(original).destination : body.action === 'move_memberships' ? server.packs.get(body.destination_collection_id) : null;
    const ids = original ? changedSongs(original) : body.edition_ids, selected = ids.map(id => server.rows.find(row => row.edition_id === id));
    if (source?.kind !== 'custom' || (body.action === 'move_memberships' && destination?.kind !== 'custom') || selected.some(row => !row || !row.catalog_managed || !row.physical_available || row.trashed_by)) return nativeResponse({code: 'catalog_invalid_request', error: 'Authored invalid membership scope'}, 400);
    if (body.action === 'move_memberships' && selected.some(row => !row.packs.some(pack => pack.collection_id === source.collection_id))) return nativeResponse({code: 'catalog_conflict', error: 'Authored missing source membership'}, 409);
    const action = original ? {type: body.action, membership_operation_id: body.membership_operation_id} : body.action === 'remove_memberships' ? {type: body.action, pack_id: source.collection_id, song_ids: ids} : {type: body.action, from_pack: source.collection_id, to_pack: destination.collection_id, song_ids: ids};
    const effects = {created_packs: [], renamed_packs: [], added_memberships: [], removed_memberships: [], trashed_songs: [], trashed_packs: [], restored_songs: [], restored_packs: [], noops: [], blocked_memberships: [], affected_packs: [], newly_unfiled_songs: [], retained_payload_bytes: 8000, retained_source_bytes: 5000, reclaimed_bytes: 0};
    if (original) {
      effects.added_memberships = structuredClone(original.effects.removed_memberships);
      effects.removed_memberships = structuredClone(original.effects.added_memberships);
    } else for (const row of selected) {
      const edge = {pack: source.collection_id, song: row.edition_id}, present = row.packs.some(pack => pack.collection_id === source.collection_id);
      if (body.action === 'remove_memberships') {
        if (present) { effects.removed_memberships.push(edge); if (row.pack_count === 1) effects.newly_unfiled_songs.push(row.edition_id); }
        else effects.noops.push({target: {kind: 'membership', id: edge}, reason: 'already_absent'});
      } else if (source.collection_id === destination.collection_id) effects.noops.push({target: {kind: 'membership', id: edge}, reason: 'same_pack'});
      else {
        effects.removed_memberships.push(edge);
        const addition = {pack: destination.collection_id, song: row.edition_id};
        if (row.packs.some(pack => pack.collection_id === destination.collection_id)) effects.noops.push({target: {kind: 'membership', id: addition}, reason: 'already_present'});
        else effects.added_memberships.push(addition);
      }
    }
    if (!original && effects.removed_memberships.length) effects.removed_membership_snapshots = effects.removed_memberships.map((id, position) => ({id: {...id}, position, added_at_unix_ms: 1690000000000, revision: 0}));
    effects.affected_packs = [...new Set([...effects.added_memberships, ...effects.removed_memberships].map(edge => edge.pack))].sort();
    const request = {schema_version: 1, operation_id: operationId(`original membership operation ${++sequence}`), expected_generation: body.expected_generation, at_unix_ms: 1700000000000, action};
    return nativeResponse({...envelope(), preview: {request, request_digest: digest(JSON.stringify(request)), base_digest: body.catalog_digest, next_generation: body.expected_generation + 1, effects, plan_digest: digest(JSON.stringify(effects))}, summary: {selected_count: ids.length, changed_song_count: 0, created_pack_count: 0, renamed_pack_count: 0, added_membership_count: effects.added_memberships.length, unchanged_membership_count: effects.noops.filter(row => row.reason === 'already_present').length, noop_membership_count: effects.noops.length, removed_membership_count: effects.removed_memberships.length, restored_membership_count: effects.added_memberships.length, shared_song_count: selected.filter(row => row.pack_count > 1).length, source_pack: structuredClone(source), destination_pack: structuredClone(destination), target_pack: structuredClone(body.action === 'move_memberships' ? destination : source), ...(original ? {membership_operation_id: body.membership_operation_id, selected_edition_ids: ids} : {undo_operation_id: effects.added_memberships.length || effects.removed_memberships.length ? request.operation_id : null}), affected_packs: effects.affected_packs.map(id => ({...server.packs.get(id), selected_song_count: selected.filter(row => row.packs.some(pack => pack.collection_id === id)).length})), reclaimed_bytes: 0}});
  }
  async function proceed(request) {
    const {path, body} = request;
    if (path.endsWith('/status')) return nativeResponse(status());
    if (path.endsWith('/preview') && actions.includes(body.action)) {
      if (body.expected_generation !== status().generation || body.catalog_digest !== status().catalog_digest) return nativeResponse({code: 'catalog_stale', error: 'Authored stale membership preview'}, 409);
      return preview(body);
    }
    if (path.endsWith('/commit') && actions.includes(body.preview.request.action.type)) {
      const p = body.preview, id = p.request.operation_id, old = server.history.get(id);
      if (!old) {
        if (p.request.expected_generation !== status().generation) return nativeResponse({code: 'catalog_stale', error: 'Authored stale membership commit', outcome: 'not_committed', operation_id: id}, 409);
        for (const edge of p.effects.removed_memberships) { const row = server.rows.find(row => row.edition_id === edge.song); row.packs = row.packs.filter(pack => pack.collection_id !== edge.pack); row.pack_count = row.packs.length; }
        for (const edge of p.effects.added_memberships) { const row = server.rows.find(row => row.edition_id === edge.song); row.packs.push({...server.packs.get(edge.pack)}); row.pack_count = row.packs.length; }
        for (const edge of [...p.effects.added_memberships, ...p.effects.removed_memberships]) revisions.set(edgeKey(edge), status().generation + 1);
        const keys = [...p.effects.added_memberships, ...p.effects.removed_memberships, ...p.effects.noops.filter(row => row.target.kind === 'membership').map(row => row.target.id)].map(edgeKey);
        committedVersions.set(id, new Map(keys.map(key => [key, revisions.get(key)])));
        server.history.set(id, structuredClone(p)); server.bumpGeneration();
      }
      return nativeResponse({...envelope(), outcome: 'committed', operation_id: id, generation: status().generation, catalog_digest: status().catalog_digest, receipt: {preview: old || p}, replayed: Boolean(old)});
    }
    const result = await request.proceed();
    if (path.endsWith('/commit') && result.ok) for (const edge of [...body.preview.effects.added_memberships, ...body.preview.effects.removed_memberships]) revisions.set(edgeKey(edge), status().generation);
    return result;
  }
  server.setUserPackRoute(request => { const next = () => proceed(request); return route ? route({...request, proceed: next}) : next(); });
  return {...server, status, setMembershipRoute(value) { route = value; }};
}

export function seedMemberships(server) {
  for (const row of server.rows.slice(0, 2)) { row.packs.push({...server.packs.get(customPackId(0))}); row.pack_count = row.packs.length; }
  server.rows[0].packs.push({...server.packs.get(customPackId(1))}); server.rows[0].pack_count++;
}
