import {createHash} from 'node:crypto';
import {nativeScoreServer, nativeResponse, authoredScore} from './native-storage-app-fixtures.js';
export const digest = value => createHash('sha256').update(value).digest('hex');
export const packIdentity = name => `import-${digest(name)}`;
export const packRow = (name, songs = 1) => ({pack_id: packIdentity(name), archive_key: `pack-${digest(name)}`, name, song_count: songs, shared_song_count: 0, retained_only_count: 0, receipt_count: 1, issue_count: 0, source_bytes: 500, provenance: 'validated_receipts'});
export function songRow(id, {title = id, packs = [], storage_kind = 'legacy', score_id = id} = {}) {
  const key = `song-${digest(id)}`;
  return {edition_id: `${storage_kind}:${key}`, key, storage_kind, content_sha256: digest(id), score_id, title, composer: 'Original test composer', profile: 'canonical', pack_ids: packs.map(pack => pack.pack_id), packs: packs.map(({pack_id, name}) => ({pack_id, name})), pack_count: packs.length, receipt_reference_count: packs.length, source_reference_count: packs.length};
}
export function managementFixture({many = 0} = {}) {
  const a = packRow('甲 <原始> 曲包.zip', 2), b = packRow('Second pack.zip', 1), retained = packRow('Only original.zip', 0);
  a.shared_song_count = b.shared_song_count = 1; retained.retained_only_count = retained.issue_count = 1;
  const shared = songRow('shared', {title: '标题 <img src=x onerror=alert(1)>', packs: [a, b], score_id: 'same-source-id'}), alternate = songRow('alternate', {packs: [a], title: 'Other edition', score_id: 'same-source-id', storage_kind: 'clean'}), unfiled = songRow('unfiled', {title: shared.title});
  const songs = [shared, alternate, unfiled, ...Array.from({length: many}, (_, index) => songRow(`authored-${index}`))];
  const duplicate = (kind, editions, evidence_type = 'distinct_editions') => ({group_id: `${kind}:${digest(kind)}`, kind, match: kind === 'same_id' ? 'same-source-id' : shared.title, edition_count: editions.length, pack_count: 2, reference_count: 2, evidence_type, editions});
  const duplicates = [duplicate('exact_content', [shared], 'shared_edition'), duplicate('same_id', [shared, alternate]), duplicate('same_title', [shared, unfiled])];
  const issues = [{issue_id: `issue-${digest('retained original')}`, code: 'pack_retained_nonplayable', message: 'Original test-only unsupported source is retained', archive_key: retained.archive_key, song_key: null}];
  const summary = {packs: 3, songs: songs.length, memberships: 3, shared_songs: 1, unfiled_songs: songs.length - 2, duplicate_groups: 3, issues: 1};
  let revision = 1;
  const snapshot = () => digest(`authored-metadata-${revision}`);
  function query(input) {
    if (input.refresh) revision++;
    let rows = {packs: [a, b, retained], songs, duplicates, issues}[input.view];
    if (input.pack_id) rows = rows.filter(row => input.view === 'songs' ? row.pack_ids.includes(input.pack_id) : input.view === 'issues' ? row.archive_key === `pack-${input.pack_id.slice(7)}` : row.pack_id === input.pack_id);
    if (input.unfiled) rows = rows.filter(row => row.pack_count === 0);
    if (input.duplicate_kind) rows = rows.filter(row => row.kind === input.duplicate_kind);
    if (input.search) rows = rows.filter(row => JSON.stringify(row).toLowerCase().includes(input.search.toLowerCase()));
    const offset = input.cursor ? Number(input.cursor.split(':')[1]) : 0, limit = input.limit || 40;
    return {format: 'worldmusichub-library-management', version: 1, view: input.view, read_only: true, native_only: true, snapshot_id: snapshot(), freshness: {kind: 'advisory_snapshot', verified_at_unix_ms: 1700000000000, cached: !input.refresh, change_detection: 'explicit_refresh', song_integrity: 'verified_at_snapshot'}, summary, total: rows.length, next_cursor: offset + limit < rows.length ? `${snapshot()}:${offset + limit}` : null, rows: structuredClone(rows.slice(offset, offset + limit))};
  }
  return {query, songs, duplicates, issues, packs: [a, b, retained], summary};
}
export async function managementServer(options = {}) {
  const server = await nativeScoreServer({scores: [authoredScore({id: 'fixture-storage', title: 'Existing saved fixture'})]}), fixture = managementFixture(options), queryRequests = [];
  let custom = null, extra = null;
  server.setRoute(async request => {
    const supplied = await extra?.(request); if (supplied !== undefined) return supplied;
    if (request.path === '/api/health') return nativeResponse({name: 'WorldMusicHub', engine: 'rust', network: 'native-protocol-no-listener', score_format_version: 1, library_management_query_version: 1});
    if (request.path === '/api/library/manage/query') { queryRequests.push(request); return await custom?.(request, fixture) || nativeResponse(fixture.query(request.body)); }
    if (request.path === '/api/library/pack/export') return {...nativeResponse({}), blob: async () => new Blob(['Original fixture export'])};
  });
  return {...server, fixture, queryRequests, setManagementRoute: handler => { custom = handler; }, setExtraRoute: handler => { extra = handler; }};
}
