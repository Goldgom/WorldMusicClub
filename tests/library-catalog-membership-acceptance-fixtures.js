// Authored synthetic protocol data. Never browser, native persistence, or Windows acceptance.
import assert from 'node:assert/strict';
import {membershipPackServer} from './library-pack-membership-fixtures.js';
import {nativeResponse} from './native-storage-app-fixtures.js';
import {digest} from './library-management-fixtures.js';
import {libraryId} from './library-catalog-fixtures.js';
import zh from '../web/locales/library-management-zh-CN.js';

const clone = value => structuredClone(value);
const orderEdges = (a, b) => a.id.pack.localeCompare(b.id.pack) || a.id.song.localeCompare(b.id.song);
const edgeKey = edge => `${edge.pack}:${edge.song}`;

/** Authored in-memory protocol values only: no browser, host, native journal or acceptance claim. */
export async function syntheticMembershipProtocol({server: suppliedServer, reports: suppliedReports, initial: suppliedInitial, records: suppliedRecords} = {}) {
  const server = suppliedServer || await membershipPackServer({initialized: false});
  const packs = suppliedInitial ? [...new Map(suppliedInitial.rows.flatMap(row => row.packs.map(pack => [pack.collection_id, pack]))).values()] : server.fixture.packs.map(pack => ({collection_id: `collection-${digest(pack.pack_id).slice(0, 32)}`, kind: 'imported', import_pack_id: pack.pack_id, name: pack.name}));
  if (!suppliedServer) {
    server.packs.clear(); for (const pack of packs) server.packs.set(pack.collection_id, pack);
    server.rows.forEach((row, index) => { row.packs = clone(index === 0 ? packs.slice(0, 2) : [packs[index === 1 ? 2 : 0]]); row.pack_count = row.packs.length; });
  }
  const reports = suppliedReports || ['catalog-seed', 'catalog-restart', 'catalog-final'].map(phase => ({phase, actions: [], api_trace: [], screenshots: {}, profile: {recovery_before_open: null, recovery_after_open: null}, layout: {width: 1280, height: 720, locale: 'zh-CN'}, operations: {}, catalog: {}}));
  let current = reports[suppliedServer ? 1 : 0], state = null;
  const states = [], records = suppliedRecords ? [...suppliedRecords] : [];
  // The existing product-contract server deliberately has compact metadata. Give this
  // separate acceptance-format fixture Rust's exact captured edges and summary counts.
  server.setMembershipRoute(async request => {
    const response = await request.proceed(), value = await response.json();
    if (request.path.endsWith('/status') && value.counts) value.counts.packs = server.packs.size;
    if (request.path.endsWith('/preview') && response.ok && state) {
      const p = value.preview;
      if (['remove_memberships', 'move_memberships'].includes(p.request.action.type)) p.effects.removed_membership_snapshots = clone(state.inventory.memberships.filter(edge => p.effects.removed_memberships.some(id => edgeKey(id) === edgeKey(edge.id))));
      if (p.request.action.type === 'move_memberships') value.summary.affected_packs.find(pack => pack.collection_id === p.request.action.to_pack).selected_song_count = request.body.edition_ids.length;
    }
    return nativeResponse(value, response.status);
  });
  const action = (control, kind = 'click', extra = {}) => {
    const sequence = current.actions.length + 1;
    current.actions.push({sequence, control, kind, trusted_clicks: 1, untrusted_clicks: 0, trusted_key_downs: kind === 'key-r' ? 1 : 0, trusted_key_ups: kind === 'key-r' ? 1 : 0, completed: true, ...extra}); return sequence;
  };
  const call = async (path, request, extra = {}) => {
    const request_text = request ? JSON.stringify(request) : '', response = await server.fetcher(path, request ? {method: 'POST', headers: {'Content-Type': 'application/json'}, body: request_text} : {}), value = await response.json();
    assert.equal(response.status, 200, `Synthetic fixture failed ${path}: ${JSON.stringify(value)}`);
    const response_text = JSON.stringify(value);
    current.api_trace.push({sequence: current.api_trace.length + 1, source: 'app', method: request ? 'POST' : 'GET', path, request: request || null, request_text, request_sha256: digest(request_text), response: clone(value), response_text, response_sha256: digest(response_text), dispatched: true, delivery: 'forwarded', status: response.status, action_sequence: current.actions.length, ...extra});
    return clone(value);
  };
  const query = () => call('/api/library/catalog/query', {view: 'active', limit: 100, refresh: true}, {source: 'probe'});
  const captureState = record => {
    const p = record.preview, a = p.request.action, g = p.next_generation, next = clone(state);
    next.generation = g; next.receipts.push({preview: clone(p)});
    if (a.type === 'create_pack') next.inventory.packs.push({id: a.pack_id, name: a.name, kind: 'custom', source_archive_keys: [], origin_import_operation_id: null, revision: g, trashed_by: null});
    next.inventory.memberships = next.inventory.memberships.filter(edge => !p.effects.removed_memberships.some(id => edgeKey(id) === edgeKey(edge.id)));
    for (const id of p.effects.added_memberships) {
      const original = a.type === 'undo_memberships' ? records.find(record => record.operation_id === a.membership_operation_id).preview.effects.removed_membership_snapshots.find(edge => edgeKey(edge.id) === edgeKey(id)) : null;
      const positions = next.inventory.memberships.filter(edge => edge.id.pack === id.pack).map(edge => edge.position);
      next.inventory.memberships.push(original ? {...clone(original), revision: g} : {id: clone(id), position: positions.length ? Math.max(...positions) + 1 : 0, added_at_unix_ms: p.request.at_unix_ms, revision: g});
    }
    next.inventory.memberships.sort(orderEdges); next.inventory.packs.sort((a, b) => a.id.localeCompare(b.id));
    for (const pack of next.inventory.packs) if (p.effects.affected_packs.includes(pack.id)) pack.revision = g;
    state = next; states[g] = clone(state);
  };
  const perform = async (kind, ids = [], fields = {}, {name, lost = false, shot} = {}) => {
    const before = await query(), control = {trash_songs: '', restore_songs: '', create_pack: 'create-', rename_pack: 'rename-', add_memberships: 'add-', remove_memberships: 'remove-', move_memberships: 'move-', undo_memberships: 'undo-'}[kind];
    if (name) for (const id of ids) action(id);
    if (name === 'create_destination') action('management-catalog-create-name', 'key-r', {trusted_key_downs: 1, trusted_key_ups: 1});
    const visible = kind === 'undo_memberships' ? await call('/api/library/catalog/query', {view: 'active', ...(name === 'undo_move' ? {collection_id: source} : {}), limit: 40, refresh: true}) : null;
    const sequence = action(`management-catalog-${control}preview`), preview = await call('/api/library/catalog/preview', {action: kind, edition_ids: ids, expected_generation: before.generation, catalog_digest: before.catalog_digest, library_id: libraryId, ...fields});
    const selectedIds = kind === 'undo_memberships' ? preview.summary.selected_edition_ids : ids;
    const record = {kind, library_id: libraryId, operation_id: preview.preview.request.operation_id, phase: 'committed', preview: preview.preview, summary: preview.summary, selected: selectedIds.map(id => ({edition_id: id, title: visible ? visible.rows.find(row => row.edition_id === id)?.title || id : server.rows.find(row => row.edition_id === id).title}))};
    if (shot) current.screenshots[shot] = sequence;
    if (name) current.memberships.review_focus.push({kind, action_sequence: sequence, active_element: 'management-catalog-review-title', top: 120, bottom: 160, width: 500, height: 40, viewport: {width: 1280, height: 720}});
    action('management-catalog-confirm'); await call('/api/library/catalog/commit', {library_id: libraryId, preview: record.preview}, {delivery: lost ? 'lost-after-native' : 'forwarded'});
    if (name) current.memberships.records[name] = record;
    if (state) captureState(record);
    records.push(record); return record;
  };
  let initialize, initial, selectedIds, legacy, create, source, rename, add;
  if (!suppliedServer) {
    action('open-synthetic-catalog');
    const init = await call('/api/library/catalog/initialize/preview', {});
    initialize = {kind: 'initialize', library_id: libraryId, operation_id: init.preview.operation_id, phase: 'committed', preview: init.preview, selected: []};
    await call('/api/library/catalog/initialize', {library_id: libraryId, preview: init.preview}); records.push(initialize); current.operations.initialize = initialize;
    initial = await query(); selectedIds = initial.rows.slice(0, 2).map(row => row.edition_id).sort(); legacy = selectedIds.find(id => id.startsWith('legacy:'));
    current.operations.trash = await perform('trash_songs', selectedIds);
    current = reports[1]; action('reopen-synthetic-catalog');
    current.operations.restore = await perform('restore_songs', selectedIds, {trash_operation_id: records[1].operation_id});
    create = await perform('create_pack', [], {name: 'r'}); source = create.preview.request.action.pack_id;
    rename = await perform('rename_pack', [], {collection_id: source, name: 'rr'}); add = await perform('add_memberships', selectedIds, {collection_id: source});
    current.organization = {create, rename, add};
  } else {
    initial = suppliedInitial; [initialize, , , create, rename, add] = records; source = create.preview.request.action.pack_id; selectedIds = add.selected.map(row => row.edition_id).sort(); legacy = selectedIds.find(id => id.startsWith('legacy:'));
  }
  state = {schema_version: 1, generation: 5, inventory: {
    songs: initial.rows.map((row, index) => ({id: row.edition_id, title: row.title, retained_bytes: [3000, 3000, 2000][index], revision: index < 2 ? 2 : 0, trashed_by: null})).sort((a, b) => a.id.localeCompare(b.id)),
    packs: [...packs.map(pack => ({id: pack.collection_id, name: pack.name, kind: 'imported', source_archive_keys: [`pack-${digest(pack.name)}`], origin_import_operation_id: null, revision: 2, trashed_by: null})), {id: source, name: 'rr', kind: 'custom', source_archive_keys: [], origin_import_operation_id: null, revision: 5, trashed_by: null}].sort((a, b) => a.id.localeCompare(b.id)),
    memberships: [...initial.rows.flatMap((row, index) => row.packs.map((pack, position) => ({id: {pack: pack.collection_id, song: row.edition_id}, position: 17 + position * 24 + index, added_at_unix_ms: 1600000000000 + index, revision: index < 2 ? 2 : 0}))), ...add.preview.request.action.song_ids.map((song, position) => ({id: {pack: source, song}, position, added_at_unix_ms: add.preview.request.at_unix_ms, revision: 5}))].sort(orderEdges),
    sources: packs.map((pack, index) => ({id: `pack-${digest(pack.name)}`, retained_bytes: [2000, 2000, 1000][index]})), origins: [{operation_id: initialize.operation_id, original: 'Authored original provenance'}],
  }, trash: [{operation_id: records[1].operation_id, restored_by: records[2].operation_id, original_memberships: 'Retained authored Trash capture'}], receipts: records.slice(1).map(record => ({preview: clone(record.preview)}))};
  states[5] = clone(state);
  current.memberships = {source_pack_id: source, selected_ids: selectedIds, records: {}, review_focus: [], before: await query()};
  const remove = await perform('remove_memberships', selectedIds, {collection_id: source}, {name: 'remove_before_restart', shot: 'membership-remove-review'});
  current.memberships.after_remove = await query(); current.memberships.cache = {before: remove, after: null};
  current = reports[2]; action('reopen-synthetic-catalog');
  current.profile.recovery_before_open = null; current.profile.recovery_after_open = null;
  current.operations.restore = clone(records[2]); current.profile.organization_before_open = {restore: clone(records[2]), create: clone(create), rename: clone(rename), add: clone(add)};
  await call('/api/library/catalog/operation', {library_id: libraryId, operation_id: records[2].operation_id}, {source: 'probe'});
  await call('/api/library/catalog/operation', {library_id: libraryId, operation_id: add.operation_id}, {source: 'probe'});
  current.memberships = {source_pack_id: source, selected_ids: selectedIds, records: {}, review_focus: []};
  const status = await call('/api/library/catalog/status');
  current.memberships.discovery = {status, local_record: null, visible: true, disabled: false, operation_text: zh['management.catalog.reviewUndo'].replace('{id}', remove.operation_id)};
  current.screenshots['membership-restart-undo'] = current.actions.length;
  await perform('undo_memberships', [], {membership_operation_id: remove.operation_id}, {name: 'undo_after_restart'});
  current.memberships.recovered = await query();
  const packRows = await call('/api/library/catalog/query', {view: 'packs', limit: 100, refresh: true}, {source: 'probe'});
  const filter_action = action('management-catalog-open-pack', 'click', {collection_id: source});
  const filtered = await call('/api/library/catalog/query', {view: 'active', collection_id: source, limit: 100, refresh: true});
  current.organization = {...clone(reports[1].organization), empty: null, review_focus: [], packs: packRows, filtered, filter_action, visible_editions: filtered.rows.map(row => row.edition_id).sort()};
  current.screenshots['persisted-user-pack'] = filter_action; current.catalog.active = await query();
  current.catalog.trash = await call('/api/library/catalog/query', {view: 'trash', limit: 100, refresh: true}, {source: 'probe'});
  const destinationRecord = await perform('create_pack', [], {name: 'r'}, {name: 'create_destination'}), destination = destinationRecord.preview.request.action.pack_id;
  const select = (control, target, options, before = '') => {
    const selected_index = options.indexOf(target), selected_text = `${target === source ? 'rr' : 'r'} · ${target}`;
    action(control, selected_index === options.length - 1 ? 'select-last' : 'select-second', {selection: {target_id: control, target_tag: 'SELECT', before, after: target, option_values: options, selected_index, selected_text, trusted_changes: 1, untrusted_changes: 0, events: [{type: 'click', trusted: true, target_id: control, value: before}, {type: 'input', trusted: true, target_id: control, value: target}, {type: 'change', trusted: true, target_id: control, value: target}]}});
  };
  const options = ['', ...[source, destination].sort()]; select('management-catalog-add-target', destination, options);
  await perform('add_memberships', [legacy], {collection_id: destination}, {name: 'add_existing_destination'});
  select('management-catalog-move-target', destination, ['', destination]);
  const move = await perform('move_memberships', selectedIds, {collection_id: source, destination_collection_id: destination}, {name: 'move', lost: true, shot: 'membership-move-review'});
  action('management-catalog-check'); await call('/api/library/catalog/operation', {library_id: libraryId, operation_id: move.operation_id});
  current.memberships.uncertain = {before: {...move, phase: 'uncertain'}, after: move}; current.memberships.after_move = await query();
  await perform('undo_memberships', [], {membership_operation_id: move.operation_id}, {name: 'undo_move'}); current.memberships.after_undo = await query();
  await perform('remove_memberships', [legacy], {collection_id: source}, {name: 'remove_conflict'});
  select('management-catalog-add-target', source, options, destination);
  await perform('add_memberships', [legacy], {collection_id: source}, {name: 'readd_conflict'});
  current.memberships.conflict = {status: await call('/api/library/catalog/status'), visible: true, disabled: true, reason: zh['management.catalog.undoBlocked']};
  current.memberships.after_conflict = await query(); current.screenshots['membership-conflict'] = current.actions.length;
  const fixture = {spec: {expected: {restored: initial.counts}}};
  return {reports, initial, selectedIds, fixture, states, records};
}
