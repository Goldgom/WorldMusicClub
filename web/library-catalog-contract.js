/** Catalog v1 is deliberately separate from the read-only import-group query. */
const hash = /^[0-9a-f]{64}$/, library = /^library-[0-9a-f]{64}$/, operation = /^operation-[0-9a-f]{32}$/, collection = /^collection-[0-9a-f]{32}$/, imported = /^import-[0-9a-f]{64}$/, edition = /^(legacy|clean):song-[0-9a-f]{64}$/;
const uint = value => Number.isSafeInteger(value) && value >= 0;
const text = value => typeof value === 'string' && new TextEncoder().encode(value).length <= 8192;
const packName = value => typeof value === 'string' && value.length > 0 && value === value.trim() && new TextEncoder().encode(value).length <= 256 && !/[\u0000-\u001f\u007f-\u009f]/u.test(value);
const membershipChange = type => ['remove_memberships', 'move_memberships', 'undo_memberships'].includes(type);
const organization = type => ['create_pack', 'rename_pack', 'add_memberships'].includes(type);
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
  if (value.membership_undo !== undefined && value.membership_undo !== null) {
    const undo = value.membership_undo;
    require(keys(undo, ['operation_id', 'action', 'selected_count', 'source_pack', 'destination_pack', 'can_undo']) && operation.test(undo.operation_id) && ['remove_memberships', 'move_memberships'].includes(undo.action) && uint(undo.selected_count) && undo.selected_count > 0 && undo.selected_count <= 1024 && typeof undo.can_undo === 'boolean');
    pack(undo.source_pack, {legacy: false}); require(undo.source_pack.kind === 'custom');
    if (undo.action === 'move_memberships') { pack(undo.destination_pack, {legacy: false}); require(undo.destination_pack.kind === 'custom' && undo.source_pack.collection_id !== undo.destination_pack.collection_id); }
    else require(undo.destination_pack === null);
  }
  if (value.supported_operations.includes('undo_memberships')) require(Object.hasOwn(value, 'membership_undo'));
  return value;
}
export function catalogQuery(input = {}) {
  const value = {view: 'active', collection_id: null, search: '', limit: 40, cursor: null, refresh: false, ...input};
  if (!keys(input, ['view', 'collection_id', 'search', 'limit', 'cursor', 'refresh']) || !['active', 'trash', 'packs'].includes(value.view) || (value.collection_id !== null && (typeof value.collection_id !== 'string' || !collection.test(value.collection_id))) || (value.view === 'packs' && value.collection_id !== null) || typeof value.search !== 'string' || new TextEncoder().encode(value.search).length > 256 || !Number.isInteger(value.limit) || value.limit < 1 || value.limit > 100 || (value.cursor !== null && (typeof value.cursor !== 'string' || !value.cursor || value.cursor.length > 2048)) || typeof value.refresh !== 'boolean' || (value.refresh && value.cursor !== null)) throw Object.assign(new Error('Choose a valid catalog view and search.'), {code: 'catalog_invalid_request'});
  return value;
}
function pack(value, {legacy = true, extra = []} = {}) {
  require(keys(value, ['collection_id', 'kind', 'import_pack_id', 'name', ...extra]) && typeof value.collection_id === 'string' && collection.test(value.collection_id) && text(value.name));
  if (value.kind === 'custom') require(value.import_pack_id === null && packName(value.name));
  else require((value.kind === 'imported' || legacy && value.kind === undefined) && typeof value.import_pack_id === 'string' && imported.test(value.import_pack_id));
}
export function checkedCatalogQuery(value, request, libraryId) {
  checkedCatalogEnvelope(value, libraryId); require(value.view === request.view && (value.collection_id ?? null) === (request.collection_id ?? null) && (request.view !== 'packs' || value.collection_id === null) && uint(value.generation) && hash.test(value.catalog_digest) && hash.test(value.snapshot_id)); counts(value.counts);
  require(value.freshness?.kind === 'advisory_snapshot' && value.freshness.change_detection === 'explicit_refresh' && uint(value.freshness.verified_at_unix_ms) && Number.isFinite(new Date(value.freshness.verified_at_unix_ms).getTime()) && typeof value.freshness.cached === 'boolean');
  require(uint(value.total) && Array.isArray(value.rows) && value.rows.length <= request.limit && value.rows.length <= value.total && (value.next_cursor === null || typeof value.next_cursor === 'string' && value.next_cursor.length > 0 && value.next_cursor.length <= 2048));
  for (const row of value.rows) {
    if (request.view === 'packs') {
      pack(row, {legacy: false, extra: ['active_song_count', 'available_song_count', 'shared_song_count']});
      require(['active_song_count', 'available_song_count', 'shared_song_count'].every(key => uint(row[key])) && row.available_song_count <= row.active_song_count && row.shared_song_count <= row.active_song_count);
      continue;
    }
    require(row && edition.test(row.edition_id) && row.edition_id === `${row.storage_kind}:${row.key}` && ['title', 'composer', 'score_id', 'profile'].every(key => text(row[key])) && typeof row.catalog_managed === 'boolean' && typeof row.physical_available === 'boolean' && (row.trashed_by === null || operation.test(row.trashed_by)) && Array.isArray(row.packs) && row.packs.length <= 256 && row.pack_count === row.packs.length);
    row.packs.forEach(item => pack(item)); require(unique(row.packs.map(item => item.collection_id)) && (!request.collection_id || row.packs.some(item => item.collection_id === request.collection_id)));
    require(request.view === 'trash' ? row.catalog_managed && operation.test(row.trashed_by) : row.trashed_by === null);
  }
  require(unique(value.rows.map(row => request.view === 'packs' ? row.collection_id : row.edition_id))); return value;
}
export function checkedInitializePreview(value, libraryId) {
  checkedCatalogEnvelope(value, libraryId); const p = value.preview;
  require(p?.kind === 'initialize' && p.library_id === value.library_id && operation.test(p.operation_id) && hash.test(p.inventory_digest) && hash.test(p.seed_digest) && uint(p.retained_payload_bytes) && uint(p.retained_source_bytes)); counts(p.counts);
  require(Array.isArray(p.collections) && p.collections.length <= 256 && p.collections.every(row => /^pack-[0-9a-f]{64}$/.test(row.source_id) && collection.test(row.collection_id)) && unique(p.collections.map(row => row.collection_id)) && unique(p.collections.map(row => row.source_id)));
  return value;
}
export function catalogPreviewRequest(value) {
  require(keys(value, ['action', 'edition_ids', 'trash_operation_id', 'collection_id', 'destination_collection_id', 'membership_operation_id', 'name', 'expected_generation', 'catalog_digest', 'library_id']) && ['trash_songs', 'restore_songs', 'create_pack', 'rename_pack', 'add_memberships', 'remove_memberships', 'move_memberships', 'undo_memberships'].includes(value.action) && ids(value.edition_ids, edition) && uint(value.expected_generation) && hash.test(value.catalog_digest) && library.test(value.library_id));
  const target = value.collection_id ?? null, destination = value.destination_collection_id ?? null, undo = value.membership_operation_id ?? null, name = value.name ?? null, trash = value.trash_operation_id ?? null;
  if (value.action !== 'move_memberships') require(destination === null);
  if (value.action !== 'undo_memberships') require(undo === null);
  if (value.action === 'create_pack' || value.action === 'rename_pack') require(value.edition_ids.length === 0 && packName(name) && trash === null && (value.action === 'create_pack' ? target === null : typeof target === 'string' && collection.test(target)));
  else if (['add_memberships', 'remove_memberships', 'move_memberships'].includes(value.action)) require(value.edition_ids.length > 0 && typeof target === 'string' && collection.test(target) && name === null && trash === null && (value.action !== 'move_memberships' || typeof destination === 'string' && collection.test(destination)));
  else if (value.action === 'undo_memberships') require(value.edition_ids.length === 0 && target === null && name === null && trash === null && typeof undo === 'string' && operation.test(undo));
  else require(value.edition_ids.length > 0 && target === null && name === null && (value.action === 'trash_songs' ? trash === null : operation.test(trash)));
  // Keep historical request bodies byte-for-byte compatible; omitted new fields mean null.
  return structuredClone(value);
}
function core(value) {
  const r = value?.request, action = r?.action, e = value?.effects;
  require(keys(value, ['request', 'request_digest', 'base_digest', 'next_generation', 'effects', 'plan_digest']) && keys(r, ['schema_version', 'operation_id', 'expected_generation', 'at_unix_ms', 'action']) && r?.schema_version === 1 && operation.test(r.operation_id) && uint(r.expected_generation) && uint(r.at_unix_ms) && uint(value.next_generation) && value.next_generation === r.expected_generation + 1 && ['request_digest', 'base_digest', 'plan_digest'].every(key => hash.test(value[key])));
  if (action?.type === 'trash_songs') require(keys(action, ['type', 'song_ids']) && ids(action.song_ids, edition) && action.song_ids.length > 0);
  else if (action?.type === 'create_pack' || action?.type === 'rename_pack') require(keys(action, ['type', 'pack_id', 'name']) && typeof action.pack_id === 'string' && collection.test(action.pack_id) && packName(action.name));
  else if (action?.type === 'add_memberships' || action?.type === 'remove_memberships') require(keys(action, ['type', 'pack_id', 'song_ids']) && typeof action.pack_id === 'string' && collection.test(action.pack_id) && ids(action.song_ids, edition) && action.song_ids.length > 0);
  else if (action?.type === 'move_memberships') require(keys(action, ['type', 'from_pack', 'to_pack', 'song_ids']) && collection.test(action.from_pack) && collection.test(action.to_pack) && ids(action.song_ids, edition) && action.song_ids.length > 0);
  else if (action?.type === 'undo_memberships') require(keys(action, ['type', 'membership_operation_id']) && operation.test(action.membership_operation_id) && action.membership_operation_id !== r.operation_id);
  else if (action?.type === 'adopt_inventory') require(keys(action, ['type', 'inventory']) && action.inventory && typeof action.inventory === 'object' && new TextEncoder().encode(JSON.stringify(action.inventory)).length <= 256 * 1024);
  else { require(keys(action, ['type', 'trash_operation_id', 'entities', 'memberships']) && action?.type === 'restore' && operation.test(action.trash_operation_id) && Array.isArray(action.entities) && action.entities.length > 0 && action.entities.length <= 1024 && action.entities.every(row => keys(row, ['kind', 'id']) && row.kind === 'song' && edition.test(row.id)) && unique(action.entities.map(row => row.id)) && Array.isArray(action.memberships) && action.memberships.length === 0); }
  require(keys(e, ['created_packs', 'renamed_packs', 'added_memberships', 'removed_memberships', 'trashed_songs', 'trashed_packs', 'restored_songs', 'restored_packs', 'noops', 'blocked_memberships', 'affected_packs', 'newly_unfiled_songs', 'retained_payload_bytes', 'retained_source_bytes', 'reclaimed_bytes', 'adopted_songs', 'adopted_packs', 'adopted_sources', 'removed_membership_snapshots']) && ['trashed_packs', 'restored_packs'].every(key => Array.isArray(e[key]) && e[key].length === 0));
  for (const key of ['created_packs', 'renamed_packs']) require(ids(e[key], collection, 256));
  for (const key of ['trashed_songs', 'restored_songs', 'newly_unfiled_songs']) require(ids(e[key], edition));
  require(ids(e.affected_packs, collection, 256));
  for (const key of ['added_memberships', 'removed_memberships']) require(Array.isArray(e[key]) && e[key].length <= 1024 && e[key].every(row => keys(row, ['pack', 'song']) && collection.test(row.pack) && edition.test(row.song)) && unique(e[key].map(row => `${row.pack}:${row.song}`)));
  if (e.removed_membership_snapshots !== undefined) {
    require(['remove_memberships', 'move_memberships'].includes(action.type) && Array.isArray(e.removed_membership_snapshots) && e.removed_membership_snapshots.length <= 1024);
    require(e.removed_membership_snapshots.every(row => keys(row, ['id', 'position', 'added_at_unix_ms', 'revision']) && keys(row.id, ['pack', 'song']) && collection.test(row.id.pack) && edition.test(row.id.song) && uint(row.position) && row.position <= 0xffffffff && uint(row.added_at_unix_ms) && uint(row.revision) && row.revision <= r.expected_generation));
    require(sameCatalogValue(e.removed_membership_snapshots.map(row => `${row.id.pack}:${row.id.song}`).sort(), e.removed_memberships.map(row => `${row.pack}:${row.song}`).sort()));
  }
  if (['remove_memberships', 'move_memberships'].includes(action.type) && e.removed_memberships.length) require(e.removed_membership_snapshots?.length === e.removed_memberships.length);
  for (const key of ['noops', 'blocked_memberships']) require(Array.isArray(e[key]) && e[key].length <= 1024);
  const entity = value => keys(value, ['kind', 'id']) && (value.kind === 'song' ? edition.test(value.id) : value.kind === 'pack' && collection.test(value.id));
  const membership = value => keys(value, ['pack', 'song']) && collection.test(value.pack) && edition.test(value.song);
  require(e.blocked_memberships.every(row => keys(row, ['membership', 'dependencies']) && membership(row.membership) && Array.isArray(row.dependencies) && row.dependencies.length > 0 && row.dependencies.every(entity)));
  require(e.noops.every(row => keys(row, ['target', 'reason']) && keys(row.target, ['kind', 'id']) && ['already_present', 'already_absent', 'same_pack', 'unchanged_name', 'already_restored'].includes(row.reason) && (row.target.kind === 'entity' ? entity(row.target.id) : row.target.kind === 'membership' && membership(row.target.id))));
  require(uint(e.retained_payload_bytes) && uint(e.retained_source_bytes) && e.reclaimed_bytes === 0);
  for (const [key, pattern] of [['adopted_songs', edition], ['adopted_packs', collection], ['adopted_sources', /^pack-[0-9a-f]{64}$/]]) if (e[key] !== undefined) require(ids(e[key], pattern));
  const selected = ['trash_songs', 'add_memberships', 'remove_memberships', 'move_memberships'].includes(action.type) ? action.song_ids : action.type === 'undo_memberships' ? [...new Set([...e.added_memberships, ...e.removed_memberships].map(row => row.song))] : action.type === 'adopt_inventory' ? e.adopted_songs || [] : action.type === 'restore' ? action.entities.map(row => row.id) : [];
  require([...e.trashed_songs, ...e.restored_songs, ...e.added_memberships.map(row => row.song), ...e.removed_memberships.map(row => row.song)].every(id => selected.includes(id)));
  if (!membershipChange(action.type)) require(action.type === 'trash_songs' ? !e.restored_songs.length && !e.added_memberships.length : !e.trashed_songs.length && !e.removed_memberships.length);
  if (organization(action.type)) {
    require(['trashed_songs', 'restored_songs', 'removed_memberships', 'blocked_memberships', 'newly_unfiled_songs', 'adopted_songs', 'adopted_packs', 'adopted_sources'].every(key => !(e[key] || []).length));
    if (action.type === 'create_pack') require(sameCatalogValue(e.created_packs, [action.pack_id]) && !e.renamed_packs.length && !e.added_memberships.length && !e.noops.length && sameCatalogValue(e.affected_packs, [action.pack_id]));
    else if (action.type === 'rename_pack') {
      require(!e.created_packs.length && !e.added_memberships.length);
      if (e.renamed_packs.length) require(sameCatalogValue(e.renamed_packs, [action.pack_id]) && !e.noops.length && sameCatalogValue(e.affected_packs, [action.pack_id]));
      else require(!e.affected_packs.length && sameCatalogValue(e.noops, [{target: {kind: 'entity', id: {kind: 'pack', id: action.pack_id}}, reason: 'unchanged_name'}]));
    } else {
      require(!e.created_packs.length && !e.renamed_packs.length && e.added_memberships.every(row => row.pack === action.pack_id));
      require(e.noops.every(row => row.reason === 'already_present' && row.target.kind === 'membership' && row.target.id.pack === action.pack_id));
      const accounted = [...e.added_memberships.map(row => row.song), ...e.noops.map(row => row.target.id.song)];
      require(unique(accounted) && sameCatalogValue(accounted.sort(), [...selected].sort()) && sameCatalogValue(e.affected_packs, e.added_memberships.length ? [action.pack_id] : []));
    }
  } else require(!e.created_packs.length && !e.renamed_packs.length);
  if (membershipChange(action.type)) checkedMembershipEffects(action, e, selected);
  return value;
}
function checkedMembershipEffects(action, e, selected) {
  require(['created_packs', 'renamed_packs', 'trashed_songs', 'restored_songs', 'blocked_memberships', 'adopted_songs', 'adopted_packs', 'adopted_sources'].every(key => !(e[key] || []).length));
  const accounted = values => unique(values) && sameCatalogValue([...values].sort(), [...selected].sort());
  const expectedPacks = [...new Set([...e.added_memberships, ...e.removed_memberships].map(row => row.pack))].sort();
  require(sameCatalogValue([...e.affected_packs].sort(), expectedPacks));
  if (action.type === 'remove_memberships') {
    require(!e.added_memberships.length && e.removed_memberships.every(row => row.pack === action.pack_id));
    require(e.noops.every(row => row.reason === 'already_absent' && row.target.kind === 'membership' && row.target.id.pack === action.pack_id));
    require(accounted([...e.removed_memberships.map(row => row.song), ...e.noops.map(row => row.target.id.song)]));
    require(e.newly_unfiled_songs.every(id => e.removed_memberships.some(row => row.song === id)));
  } else if (action.type === 'move_memberships') {
    require(!e.newly_unfiled_songs.length);
    if (action.from_pack === action.to_pack) {
      require(!e.added_memberships.length && !e.removed_memberships.length && e.noops.every(row => row.reason === 'same_pack' && row.target.kind === 'membership' && row.target.id.pack === action.from_pack));
      require(accounted(e.noops.map(row => row.target.id.song)));
    } else {
      require(e.removed_memberships.every(row => row.pack === action.from_pack) && accounted(e.removed_memberships.map(row => row.song)) && e.added_memberships.every(row => row.pack === action.to_pack));
      require(e.noops.every(row => row.reason === 'already_present' && row.target.kind === 'membership' && row.target.id.pack === action.to_pack));
      require(accounted([...e.added_memberships.map(row => row.song), ...e.noops.map(row => row.target.id.song)]));
    }
  } else require(selected.length > 0 && !e.noops.length && !e.newly_unfiled_songs.length);
}
function summary(s, p, selectedCount) {
  const e = p.effects, action = p.request.action, organizing = organization(action.type);
  require(keys(s, ['selected_count', 'changed_song_count', 'created_pack_count', 'renamed_pack_count', 'added_membership_count', 'unchanged_membership_count', 'removed_membership_count', 'restored_membership_count', 'shared_song_count', 'affected_packs', 'target_pack', 'reclaimed_bytes', 'remaining_song_count', 'remaining_source_count', 'source_pack', 'destination_pack', 'undo_operation_id', 'membership_operation_id', 'selected_edition_ids', 'noop_membership_count']) && ['selected_count', 'changed_song_count', 'removed_membership_count', 'restored_membership_count', 'shared_song_count'].every(key => uint(s[key])) && s.selected_count === selectedCount && s.changed_song_count === e.trashed_songs.length + e.restored_songs.length + (e.adopted_songs || []).length && s.removed_membership_count === e.removed_memberships.length && s.restored_membership_count === e.added_memberships.length && s.shared_song_count <= selectedCount && s.reclaimed_bytes === 0 && Array.isArray(s.affected_packs));
  if (organizing) {
    pack(s.target_pack, {legacy: false});
    require(s.target_pack.kind === 'custom' && s.target_pack.collection_id === action.pack_id && (action.type === 'add_memberships' || s.target_pack.name === action.name));
  } else if (membershipChange(action.type)) checkedMembershipSummary(s, p);
  else require(s.target_pack === undefined);
  const expected = {created_pack_count: e.created_packs.length, renamed_pack_count: e.renamed_packs.length, added_membership_count: e.added_memberships.length, unchanged_membership_count: e.noops.filter(row => row.reason === 'already_present').length};
  for (const [key, count] of Object.entries(expected)) if (organizing || membershipChange(action.type) || s[key] !== undefined) require(s[key] === count);
  s.affected_packs.forEach(row => {
    pack(row, {legacy: !organizing, extra: ['selected_song_count']}); require(uint(row.selected_song_count) && row.selected_song_count <= selectedCount);
    if (organizing) {
      require(row.kind === 'custom' && row.collection_id === action.pack_id);
      require(row.name === s.target_pack.name);
      if (action.type === 'add_memberships') require(row.selected_song_count === selectedCount);
      else require(row.name === action.name && row.selected_song_count === 0);
    }
  });
  for (const key of ['remaining_song_count', 'remaining_source_count']) if (s[key] !== undefined) require(uint(s[key]));
  require(sameCatalogValue(s.affected_packs.map(row => row.collection_id).sort(), [...e.affected_packs].sort()));
}
function checkedMembershipSummary(s, p) {
  const action = p.request.action, e = p.effects;
  pack(s.source_pack, {legacy: false}); pack(s.target_pack, {legacy: false});
  require(s.source_pack.kind === 'custom' && s.target_pack.kind === 'custom');
  if (s.destination_pack !== null) { pack(s.destination_pack, {legacy: false}); require(s.destination_pack.kind === 'custom'); }
  require(s.noop_membership_count === e.noops.length);
  if (action.type === 'remove_memberships') require(s.source_pack.collection_id === action.pack_id && sameCatalogValue(s.target_pack, s.source_pack) && s.destination_pack === null);
  else if (action.type === 'move_memberships') require(s.source_pack.collection_id === action.from_pack && s.destination_pack?.collection_id === action.to_pack && sameCatalogValue(s.target_pack, s.destination_pack));
  else {
    require(s.membership_operation_id === action.membership_operation_id && sameCatalogValue(s.target_pack, s.source_pack) && ids(s.selected_edition_ids, edition));
    const changed = [...new Set([...e.added_memberships, ...e.removed_memberships].map(row => row.song))].sort();
    require(sameCatalogValue([...s.selected_edition_ids].sort(), changed));
    require(e.added_memberships.every(row => row.pack === s.source_pack.collection_id) && sameCatalogValue(e.added_memberships.map(row => row.song).sort(), changed) && e.removed_memberships.every(row => row.pack === s.destination_pack?.collection_id) && (!s.destination_pack || s.destination_pack.collection_id !== s.source_pack.collection_id));
  }
  if (action.type !== 'undo_memberships') require(s.undo_operation_id === (e.added_memberships.length || e.removed_memberships.length ? p.request.operation_id : null));
  else require(s.undo_operation_id === undefined || s.undo_operation_id === null);
  const references = [s.source_pack, s.destination_pack].filter(Boolean);
  require(s.affected_packs.every(row => references.some(ref => sameCatalogValue(ref, Object.fromEntries(Object.entries(row).filter(([key]) => key !== 'selected_song_count'))))));
}
export function checkedCatalogPreview(value, request) {
  catalogPreviewRequest(request);
  checkedCatalogEnvelope(value, request.library_id); const p = core(value.preview), action = p.request.action;
  require(p.request.expected_generation === request.expected_generation && p.base_digest === request.catalog_digest);
  if (request.action === 'create_pack' || request.action === 'rename_pack') require(action.type === request.action && action.name === request.name && (request.action === 'create_pack' || action.pack_id === request.collection_id));
  else if (request.action === 'add_memberships' || request.action === 'remove_memberships') require(action.type === request.action && action.pack_id === request.collection_id && sameCatalogValue(action.song_ids, request.edition_ids));
  else if (request.action === 'move_memberships') require(action.type === request.action && action.from_pack === request.collection_id && action.to_pack === request.destination_collection_id && sameCatalogValue(action.song_ids, request.edition_ids));
  else if (request.action === 'undo_memberships') require(action.type === request.action && action.membership_operation_id === request.membership_operation_id);
  else require(request.action === 'trash_songs' ? action.type === 'trash_songs' && sameCatalogValue(action.song_ids, request.edition_ids) : action.type === 'restore' && action.trash_operation_id === request.trash_operation_id && sameCatalogValue(action.entities.map(row => row.id), request.edition_ids));
  summary(value.summary, p, request.action === 'undo_memberships' ? value.summary?.selected_edition_ids?.length : request.edition_ids.length); return value;
}
export function checkedCatalogSync(value, request) {
  checkedCatalogEnvelope(value, request.library_id); const p = core(value.preview), adopted = p.effects.adopted_songs || [];
  require(p.request.action.type === 'adopt_inventory' && p.request.expected_generation === request.expected_generation && p.base_digest === request.catalog_digest);
  summary(value.summary, p, adopted.length); return value;
}
export function checkedCatalogResult(value, record, {lookup = false} = {}) {
  checkedCatalogEnvelope(value, record.library_id);
  require(value.operation_id === record.operation_id && (lookup ? ['committed', 'not_committed'].includes(value.outcome) : value.outcome === 'committed'));
  require((uint(value.generation) && hash.test(value.catalog_digest)) || (lookup && value.outcome === 'not_committed' && record.kind === 'initialize' && value.generation === null && value.catalog_digest === null));
  if (value.outcome === 'committed') {
    if (record.kind === 'initialize') {
      if (lookup) require(value.kind === 'initialize' && value.seed_digest === record.preview.seed_digest);
      else { require(value.state === 'ready' && typeof value.replayed === 'boolean'); counts(value.counts); }
    } else {
      require(value.receipt && sameCatalogValue(core(value.receipt.preview), record.preview));
      const p = value.receipt.preview, kind = {restore: 'restore_songs', adopt_inventory: 'sync_imports'}[p.request.action.type] || p.request.action.type;
      require(kind === record.kind && p.request.operation_id === record.operation_id && value.generation >= p.next_generation);
    }
  }
  return value;
}
export function checkedRecoveryRecord(record, libraryId) {
  require(record?.library_id === libraryId && library.test(libraryId) && operation.test(record.operation_id) && ['initialize', 'trash_songs', 'restore_songs', 'sync_imports', 'create_pack', 'rename_pack', 'add_memberships', 'remove_memberships', 'move_memberships', 'undo_memberships'].includes(record.kind) && ['submitted', 'uncertain', 'not_committed', 'committed'].includes(record.phase));
  if (record.kind === 'initialize') { checkedInitializePreview({format: 'worldmusichub-catalog', version: 1, native_only: true, library_id: libraryId, preview: record.preview}, libraryId); require(record.preview.operation_id === record.operation_id); }
  else { core(record.preview); require(record.preview.request.operation_id === record.operation_id); }
  require(Array.isArray(record.selected) && record.selected.length <= 1024 && record.selected.every(row => row && edition.test(row.edition_id) && text(row.title)) && unique(record.selected.map(row => row.edition_id)) && (record.dismissed === undefined || typeof record.dismissed === 'boolean'));
  const wrapped = {format: 'worldmusichub-catalog', version: 1, native_only: true, library_id: libraryId, preview: record.preview, summary: record.summary};
  if (record.kind === 'initialize') require(record.selected.length === 0);
  else if (record.kind === 'sync_imports') { checkedCatalogSync(wrapped, {library_id: libraryId, expected_generation: record.preview.request.expected_generation, catalog_digest: record.preview.base_digest}); require(sameCatalogValue(record.selected.map(row => row.edition_id), record.preview.effects.adopted_songs || [])); }
  else {
    const action = record.preview.request.action;
    checkedCatalogPreview(wrapped, {library_id: libraryId, expected_generation: record.preview.request.expected_generation, catalog_digest: record.preview.base_digest, action: record.kind, edition_ids: record.kind === 'undo_memberships' ? [] : record.selected.map(row => row.edition_id), trash_operation_id: record.kind === 'restore_songs' ? action.trash_operation_id : null, collection_id: record.kind === 'move_memberships' ? action.from_pack : ['rename_pack', 'add_memberships', 'remove_memberships'].includes(record.kind) ? action.pack_id : null, destination_collection_id: record.kind === 'move_memberships' ? action.to_pack : null, membership_operation_id: record.kind === 'undo_memberships' ? action.membership_operation_id : null, name: ['create_pack', 'rename_pack'].includes(record.kind) ? action.name : null});
  }
  if (record.kind === 'undo_memberships') require(sameCatalogValue(record.selected.map(row => row.edition_id), record.summary.selected_edition_ids));
  return record;
}
