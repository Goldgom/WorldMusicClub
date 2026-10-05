/** The management endpoint exposes verified metadata only, never song payloads. */
const hash = /^[0-9a-f]{64}$/;
const songKey = /^song-[0-9a-f]{64}$/;
const packId = /^import-[0-9a-f]{64}$/;
const archiveKey = /^pack-[0-9a-f]{64}$/;
const kinds = ['exact_content', 'same_id', 'same_title'];
const views = ['packs', 'songs', 'duplicates', 'issues'];
const fail = () => { throw Object.assign(new Error('The native library management response is invalid.'), {code: 'library_management_invalid_response'}); };
const count = value => Number.isSafeInteger(value) && value >= 0;
const text = value => typeof value === 'string' && value.length <= 8192;
const unique = values => new Set(values).size === values.length;
export function managementRequest(input = {}) {
  const allowed = ['view', 'search', 'pack_id', 'unfiled', 'duplicate_kind', 'limit', 'cursor', 'refresh'];
  const value = {view: 'packs', search: '', pack_id: null, unfiled: false, duplicate_kind: null, limit: 40, cursor: null, refresh: false, ...input};
  if (Object.keys(input).some(key => !allowed.includes(key)) || !views.includes(value.view) || typeof value.search !== 'string' || new TextEncoder().encode(value.search).length > 256 || (value.pack_id !== null && !packId.test(value.pack_id)) || typeof value.unfiled !== 'boolean' || (value.duplicate_kind !== null && !kinds.includes(value.duplicate_kind)) || !Number.isInteger(value.limit) || value.limit < 1 || value.limit > 100 || (value.cursor !== null && (typeof value.cursor !== 'string' || !value.cursor || value.cursor.length > 2048)) || typeof value.refresh !== 'boolean' || (value.refresh && value.cursor !== null) || (value.pack_id !== null && value.unfiled) || (value.unfiled && value.view !== 'songs') || (value.pack_id !== null && !['songs', 'issues'].includes(value.view)) || (value.duplicate_kind !== null && value.view !== 'duplicates')) {
    throw Object.assign(new Error('Choose a valid metadata view and a search of at most 256 UTF-8 bytes.'), {code: 'library_management_invalid_query'});
  }
  return value;
}
function checkSong(row) {
  if (!row || !['legacy', 'clean'].includes(row.storage_kind) || !songKey.test(row.key) || row.edition_id !== `${row.storage_kind}:${row.key}` || !hash.test(row.content_sha256) || !text(row.score_id) || !text(row.title) || !text(row.composer) || !text(row.profile) || !Array.isArray(row.pack_ids) || row.pack_ids.length > 1024 || row.pack_ids.some(id => !packId.test(id)) || !unique(row.pack_ids) || row.pack_count !== row.pack_ids.length || !count(row.receipt_reference_count) || !count(row.source_reference_count) || row.source_reference_count > row.receipt_reference_count) fail();
  if (!Array.isArray(row.packs) || row.packs.length !== row.pack_ids.length || row.packs.some(pack => !pack || !row.pack_ids.includes(pack.pack_id) || !text(pack.name)) || !unique(row.packs.map(pack => pack.pack_id))) fail();
  return row.edition_id;
}
export function checkedManagementResponse(value, request) {
  if (value?.format !== 'worldmusichub-library-management' || value.version !== 1 || value.read_only !== true || value.native_only !== true || value.view !== request.view || !hash.test(value.snapshot_id) || value.freshness?.kind !== 'advisory_snapshot' || value.freshness.change_detection !== 'explicit_refresh' || value.freshness.song_integrity !== 'verified_at_snapshot' || !count(value.freshness.verified_at_unix_ms) || !Number.isFinite(new Date(value.freshness.verified_at_unix_ms).getTime()) || typeof value.freshness.cached !== 'boolean' || !value.summary || ['packs', 'songs', 'memberships', 'shared_songs', 'unfiled_songs', 'duplicate_groups', 'issues'].some(key => !count(value.summary[key])) || !count(value.total) || !Array.isArray(value.rows) || value.rows.length > request.limit || value.rows.length > value.total || (value.next_cursor !== null && (typeof value.next_cursor !== 'string' || !value.next_cursor || value.next_cursor.length > 2048))) fail();
  const ids = value.rows.map(row => {
    if (request.view === 'songs') return checkSong(row);
    if (request.view === 'packs') {
      if (!row || !packId.test(row.pack_id) || !archiveKey.test(row.archive_key) || row.pack_id.slice(7) !== row.archive_key.slice(5) || !text(row.name) || row.provenance !== 'validated_receipts' || ['song_count', 'shared_song_count', 'retained_only_count', 'receipt_count', 'issue_count', 'source_bytes'].some(key => !count(row[key]))) fail();
      return row.pack_id;
    }
    if (request.view === 'duplicates') {
      if (!row || !kinds.includes(row.kind) || !['shared_edition', 'repeated_source_item', 'multiple_editions', 'distinct_editions'].includes(row.evidence_type) || (request.duplicate_kind && row.kind !== request.duplicate_kind) || !new RegExp(`^${row.kind}:[0-9a-f]{64}$`).test(row.group_id) || !text(row.match) || !count(row.edition_count) || row.edition_count < 1 || !count(row.pack_count) || !count(row.reference_count) || !Array.isArray(row.editions) || row.editions.length !== row.edition_count || row.editions.length > 1024 || !unique(row.editions.map(checkSong))) fail();
      return row.group_id;
    }
    if (!row || !/^issue-[0-9a-f]{64}$/.test(row.issue_id) || !text(row.code) || !text(row.message) || (row.archive_key !== null && !archiveKey.test(row.archive_key)) || (row.song_key !== null && !songKey.test(row.song_key))) fail();
    return row.issue_id;
  });
  if (!unique(ids)) fail();
  return value;
}
