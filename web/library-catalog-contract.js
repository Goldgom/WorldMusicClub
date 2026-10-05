/** Catalog v1 is deliberately separate from the read-only import-group query. */
const hash = /^[0-9a-f]{64}$/, library = /^library-[0-9a-f]{64}$/, operation = /^operation-[0-9a-f]{32}$/, collection = /^collection-[0-9a-f]{32}$/, imported = /^import-[0-9a-f]{64}$/, edition = /^(legacy|clean):song-[0-9a-f]{64}$/;
const uint = value => Number.isSafeInteger(value) && value >= 0;
const text = value => typeof value === 'string' && new TextEncoder().encode(value).length <= 8192;
const unique = values => new Set(values).size === values.length;
const ids = (value, pattern, max = 1024) => Array.isArray(value) && value.length <= max && value.every(id => typeof id === 'string' && pattern.test(id)) && unique(value);
const fail = () => { throw Object.assign(new Error('The native catalog response is invalid or does not match the reviewed operation.'), {code: 'catalog_invalid_response'}); };
const require = value => { if (!value) fail(); };
const keys = (value, allowed) => value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).every(key => allowed.includes(key));
export function sameCatalogValue(a, b) {
  const ordered = value => Array.isArray(value) ? value.map(ordered) : value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().map(key => [key, ordered(value[key])])) : value;
  return JSON.stringify(ordered(a)) === JSON.stringify(ordered(b));
}
export function checkedCatalogEnvelope(value, libraryId) {
  require(value?.format === 'worldmusichub-catalog' && value.version === 1 && value.native_only === true && library.test(value.library_id) && (!libraryId || value.library_id === libraryId));
  return value;
}
function counts(value) { require(value && ['managed_songs', 'active_songs', 'trashed_songs', 'packs', 'memberships'].every(key => uint(value[key]))); }
export function checkedCatalogStatus(value) {
  checkedCatalogEnvelope(value); require(['uninitialized', 'ready'].includes(value.state));
  require(Array.isArray(value.supported_operations) && ['initialize', 'trash_songs', 'restore_songs'].every(action => value.supported_operations.includes(action)));
  if (value.state === 'ready') { require(uint(value.generation) && hash.test(value.catalog_digest)); counts(value.counts); }
  else require(value.generation === null && value.catalog_digest === null && value.counts === null);
  return value;
}
export function catalogQuery(input = {}) {
  const value = {view: 'active', search: '', limit: 40, cursor: null, refresh: false, ...input};
  if (Object.keys(input).some(key => !['view', 'search', 'limit', 'cursor', 'refresh'].includes(key)) || !['active', 'trash'].includes(value.view) || typeof value.search !== 'string' || new TextEncoder().encode(value.search).length > 256 || !Number.isInteger(value.limit) || value.limit < 1 || value.limit > 100 || (value.cursor !== null && (typeof value.cursor !== 'string' || !value.cursor || value.cursor.length > 2048)) || typeof value.refresh !== 'boolean' || (value.refresh && value.cursor !== null)) throw Object.assign(new Error('Choose a valid catalog view and search.'), {code: 'catalog_invalid_request'});
  return value;
}
function pack(value) { require(value && collection.test(value.collection_id) && imported.test(value.import_pack_id) && text(value.name)); }
export function checkedCatalogQuery(value, request, libraryId) {
  checkedCatalogEnvelope(value, libraryId); require(value.view === request.view && uint(value.generation) && hash.test(value.catalog_digest) && hash.test(value.snapshot_id)); counts(value.counts);
  require(value.freshness?.kind === 'advisory_snapshot' && value.freshness.change_detection === 'explicit_refresh' && uint(value.freshness.verified_at_unix_ms) && Number.isFinite(new Date(value.freshness.verified_at_unix_ms).getTime()) && typeof value.freshness.cached === 'boolean');
  require(uint(value.total) && Array.isArray(value.rows) && value.rows.length <= request.limit && value.rows.length <= value.total && (value.next_cursor === null || typeof value.next_cursor === 'string' && value.next_cursor.length > 0 && value.next_cursor.length <= 2048));
  for (const row of value.rows) {
    require(row && edition.test(row.edition_id) && row.edition_id === `${row.storage_kind}:${row.key}` && ['title', 'composer', 'score_id', 'profile'].every(key => text(row[key])) && typeof row.catalog_managed === 'boolean' && typeof row.physical_available === 'boolean' && (row.trashed_by === null || operation.test(row.trashed_by)) && Array.isArray(row.packs) && row.packs.length <= 256 && row.pack_count === row.packs.length);
    row.packs.forEach(pack); require(unique(row.packs.map(item => item.collection_id)));
    require(request.view === 'trash' ? row.catalog_managed && operation.test(row.trashed_by) : row.trashed_by === null);
  }
  require(unique(value.rows.map(row => row.edition_id))); return value;
}
export function checkedInitializePreview(value, libraryId) {
  checkedCatalogEnvelope(value, libraryId); const p = value.preview;
  require(p?.kind === 'initialize' && p.library_id === value.library_id && operation.test(p.operation_id) && hash.test(p.inventory_digest) && hash.test(p.seed_digest) && uint(p.retained_payload_bytes) && uint(p.retained_source_bytes)); counts(p.counts);
  require(Array.isArray(p.collections) && p.collections.length <= 256 && p.collections.every(row => /^pack-[0-9a-f]{64}$/.test(row.source_id) && collection.test(row.collection_id)) && unique(p.collections.map(row => row.collection_id)) && unique(p.collections.map(row => row.source_id)));
  return value;
}
export function catalogPreviewRequest(value) {
  require(keys(value, ['action', 'edition_ids', 'trash_operation_id', 'expected_generation', 'catalog_digest', 'library_id']) && ['trash_songs', 'restore_songs'].includes(value.action) && ids(value.edition_ids, edition) && value.edition_ids.length > 0 && uint(value.expected_generation) && hash.test(value.catalog_digest) && library.test(value.library_id) && (value.action === 'trash_songs' ? value.trash_operation_id === null : operation.test(value.trash_operation_id)));
  return structuredClone(value);
}
function core(value) {
  const r = value?.request, action = r?.action, e = value?.effects;
  require(keys(value, ['request', 'request_digest', 'base_digest', 'next_generation', 'effects', 'plan_digest']) && keys(r, ['schema_version', 'operation_id', 'expected_generation', 'at_unix_ms', 'action']) && r?.schema_version === 1 && operation.test(r.operation_id) && uint(r.expected_generation) && uint(r.at_unix_ms) && uint(value.next_generation) && value.next_generation === r.expected_generation + 1 && ['request_digest', 'base_digest', 'plan_digest'].every(key => hash.test(value[key])));
  if (action?.type === 'trash_songs') require(keys(action, ['type', 'song_ids']) && ids(action.song_ids, edition) && action.song_ids.length > 0);
  else if (action?.type === 'adopt_inventory') require(keys(action, ['type', 'inventory']) && action.inventory && typeof action.inventory === 'object' && new TextEncoder().encode(JSON.stringify(action.inventory)).length <= 256 * 1024);
  else { require(keys(action, ['type', 'trash_operation_id', 'entities', 'memberships']) && action?.type === 'restore' && operation.test(action.trash_operation_id) && Array.isArray(action.entities) && action.entities.length > 0 && action.entities.length <= 1024 && action.entities.every(row => row.kind === 'song' && edition.test(row.id)) && unique(action.entities.map(row => row.id)) && Array.isArray(action.memberships) && action.memberships.length === 0); }
  require(keys(e, ['created_packs', 'renamed_packs', 'added_memberships', 'removed_memberships', 'trashed_songs', 'trashed_packs', 'restored_songs', 'restored_packs', 'noops', 'blocked_memberships', 'affected_packs', 'newly_unfiled_songs', 'retained_payload_bytes', 'retained_source_bytes', 'reclaimed_bytes', 'adopted_songs', 'adopted_packs', 'adopted_sources']) && ['created_packs', 'renamed_packs', 'trashed_packs', 'restored_packs'].every(key => Array.isArray(e[key]) && e[key].length === 0));
  for (const key of ['trashed_songs', 'restored_songs', 'newly_unfiled_songs']) require(ids(e[key], edition));
  require(ids(e.affected_packs, collection, 256));
  for (const key of ['added_memberships', 'removed_memberships']) require(Array.isArray(e[key]) && e[key].length <= 1024 && e[key].every(row => collection.test(row.pack) && edition.test(row.song)) && unique(e[key].map(row => `${row.pack}:${row.song}`)));
  for (const key of ['noops', 'blocked_memberships']) require(Array.isArray(e[key]) && e[key].length <= 1024);
  const entity = value => value && (value.kind === 'song' ? edition.test(value.id) : value.kind === 'pack' && collection.test(value.id));
  const membership = value => value && collection.test(value.pack) && edition.test(value.song);
  require(e.blocked_memberships.every(row => membership(row.membership) && Array.isArray(row.dependencies) && row.dependencies.length > 0 && row.dependencies.every(entity)));
  require(e.noops.every(row => ['already_present', 'already_absent', 'same_pack', 'unchanged_name', 'already_restored'].includes(row.reason) && (row.target?.kind === 'entity' ? entity(row.target.id) : row.target?.kind === 'membership' && membership(row.target.id))));
  require(uint(e.retained_payload_bytes) && uint(e.retained_source_bytes) && e.reclaimed_bytes === 0);
  for (const [key, pattern] of [['adopted_songs', edition], ['adopted_packs', collection], ['adopted_sources', /^pack-[0-9a-f]{64}$/]]) if (e[key] !== undefined) require(ids(e[key], pattern));
  const selected = action.type === 'trash_songs' ? action.song_ids : action.type === 'adopt_inventory' ? e.adopted_songs || [] : action.entities.map(row => row.id);
  require([...e.trashed_songs, ...e.restored_songs, ...e.added_memberships.map(row => row.song), ...e.removed_memberships.map(row => row.song)].every(id => selected.includes(id)));
  require(action.type === 'trash_songs' ? !e.restored_songs.length && !e.added_memberships.length : !e.trashed_songs.length && !e.removed_memberships.length);
  return value;
}
export function checkedCatalogPreview(value, request) {
  checkedCatalogEnvelope(value, request.library_id); const p = core(value.preview), action = p.request.action, s = value.summary;
  require(p.request.expected_generation === request.expected_generation && p.base_digest === request.catalog_digest);
  require(request.action === 'trash_songs' ? action.type === 'trash_songs' && sameCatalogValue(action.song_ids, request.edition_ids) : action.type === 'restore' && action.trash_operation_id === request.trash_operation_id && sameCatalogValue(action.entities.map(row => row.id), request.edition_ids));
  require(s && ['selected_count', 'changed_song_count', 'removed_membership_count', 'restored_membership_count', 'shared_song_count'].every(key => uint(s[key])) && s.selected_count === request.edition_ids.length && s.changed_song_count === p.effects.trashed_songs.length + p.effects.restored_songs.length && s.removed_membership_count === p.effects.removed_memberships.length && s.restored_membership_count === p.effects.added_memberships.length && s.shared_song_count <= s.selected_count && s.reclaimed_bytes === 0 && Array.isArray(s.affected_packs));
  s.affected_packs.forEach(row => { pack(row); require(uint(row.selected_song_count)); });
  for (const key of ['remaining_song_count', 'remaining_source_count']) if (s[key] !== undefined) require(uint(s[key]));
  require(sameCatalogValue(s.affected_packs.map(row => row.collection_id).sort(), [...p.effects.affected_packs].sort())); return value;
}
export function checkedCatalogSync(value, request) {
  checkedCatalogEnvelope(value, request.library_id); const p = core(value.preview), s = value.summary, adopted = p.effects.adopted_songs || [];
  require(p.request.action.type === 'adopt_inventory' && p.request.expected_generation === request.expected_generation && p.base_digest === request.catalog_digest && s && ['selected_count', 'changed_song_count', 'removed_membership_count', 'restored_membership_count', 'shared_song_count'].every(key => uint(s[key])) && s.selected_count === adopted.length && s.changed_song_count === adopted.length && s.removed_membership_count === p.effects.removed_memberships.length && s.restored_membership_count === p.effects.added_memberships.length && s.shared_song_count <= s.selected_count && s.reclaimed_bytes === 0 && Array.isArray(s.affected_packs));
  s.affected_packs.forEach(row => { pack(row); require(uint(row.selected_song_count)); });
  for (const key of ['remaining_song_count', 'remaining_source_count']) if (s[key] !== undefined) require(uint(s[key]));
  require(sameCatalogValue(s.affected_packs.map(row => row.collection_id).sort(), [...p.effects.affected_packs].sort())); return value;
}
export function checkedCatalogResult(value, record, {lookup = false} = {}) {
  checkedCatalogEnvelope(value, record.library_id);
  require(value.operation_id === record.operation_id && (lookup ? ['committed', 'not_committed'].includes(value.outcome) : value.outcome === 'committed'));
  require((uint(value.generation) && hash.test(value.catalog_digest)) || (lookup && value.outcome === 'not_committed' && record.kind === 'initialize' && value.generation === null && value.catalog_digest === null));
  if (value.outcome === 'committed') {
    if (record.kind === 'initialize') {
      if (lookup) require(value.kind === 'initialize' && value.seed_digest === record.preview.seed_digest);
      else { require(value.state === 'ready' && typeof value.replayed === 'boolean'); counts(value.counts); }
    } else require(value.receipt && sameCatalogValue(core(value.receipt.preview), record.preview));
  }
  return value;
}
export function checkedRecoveryRecord(record, libraryId) {
  require(record?.library_id === libraryId && library.test(libraryId) && operation.test(record.operation_id) && ['initialize', 'trash_songs', 'restore_songs', 'sync_imports'].includes(record.kind) && ['submitted', 'uncertain', 'not_committed', 'committed'].includes(record.phase));
  if (record.kind === 'initialize') { checkedInitializePreview({format: 'worldmusichub-catalog', version: 1, native_only: true, library_id: libraryId, preview: record.preview}, libraryId); require(record.preview.operation_id === record.operation_id); }
  else { core(record.preview); require(record.preview.request.operation_id === record.operation_id); }
  require(Array.isArray(record.selected) && record.selected.length <= 1024 && record.selected.every(row => edition.test(row.edition_id) && text(row.title)) && unique(record.selected.map(row => row.edition_id)) && (record.dismissed === undefined || typeof record.dismissed === 'boolean'));
  const wrapped = {format: 'worldmusichub-catalog', version: 1, native_only: true, library_id: libraryId, preview: record.preview, summary: record.summary};
  if (record.kind === 'initialize') require(record.selected.length === 0);
  else if (record.kind === 'sync_imports') { checkedCatalogSync(wrapped, {library_id: libraryId, expected_generation: record.preview.request.expected_generation, catalog_digest: record.preview.base_digest}); require(sameCatalogValue(record.selected.map(row => row.edition_id), record.preview.effects.adopted_songs || [])); }
  else checkedCatalogPreview(wrapped, {library_id: libraryId, expected_generation: record.preview.request.expected_generation, catalog_digest: record.preview.base_digest, action: record.kind, edition_ids: record.selected.map(row => row.edition_id), trash_operation_id: record.kind === 'restore_songs' ? record.preview.request.action.trash_operation_id : null});
  return record;
}
