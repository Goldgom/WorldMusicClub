// Strict extension of the ORIGINAL catalog evidence protocol; unit fixtures are not acceptance.
import assert from 'node:assert/strict';
import {checkedCatalogQuery, checkedRecoveryRecord, checkedCatalogResult, sameCatalogValue} from '../web/library-catalog-contract.js';
import {catalogSha256 as sha256} from './prepare-library-catalog-acceptance.mjs';
import {inspectOriginalManagementZip, assertSelectedLegacyExport} from './pack-management-acceptance-fixtures.mjs';
import {assertCleanExportInventory} from '../tests/clean-song-package-fixtures.js';

const orderedRows = rows => rows.map(row => ({...row, packs: [...row.packs].sort((a, b) => a.collection_id.localeCompare(b.collection_id))})).sort((a, b) => a.edition_id.localeCompare(b.edition_id));
const organizationKinds = ['create_pack', 'rename_pack', 'add_memberships'];
const actionAt = (report, sequence, control, kind = 'click') => {
  assert.ok(Number.isSafeInteger(sequence) && sequence > 0, 'Organization evidence needs an actual action sequence');
  const action = report.actions[sequence - 1];
  assert.equal(action?.sequence, sequence); assert.equal(action.kind, kind); assert.equal(action.control, control);
  if (kind === 'select-last') assert.ok([1, 2].includes(action.trusted_clicks)); else assert.equal(action.trusted_clicks, 1);
  assert.equal(action.untrusted_clicks, 0); assert.equal(action.completed, true);
  return action;
};
function nativeQuery(report, value, request, generation, libraryId) {
  checkedCatalogQuery(value, request, libraryId);
  assert.equal(value.generation, generation); assert.equal(value.next_cursor, null); assert.equal(value.total, value.rows.length);
  const matches = report.api_trace.filter(row => row.path === '/api/library/catalog/query' && row.status === 200 && row.dispatched && row.delivery === 'forwarded' && row.request.view === request.view && (row.request.collection_id ?? null) === (request.collection_id ?? null) && sameCatalogValue(row.response, value));
  assert.ok(matches.length > 0, 'Organization checkpoint lacks exact native query bytes');
  return matches;
}

export function validateCatalogOrganization(reports, {initial, restore, selectedIds, fixture, allApi, requireMemberships = false}) {
  const [seed, restart, final] = reports, org = restart.organization;
  assert.ok(org && final.organization, 'Required custom-pack organization evidence is missing');
  assert.equal(seed.organization, undefined, 'Organization must start only after the original restart restore gate');
  const {create, rename, add} = org, records = [create, rename, add], libraryId = initial.library_id;
  const imported = [...new Map(initial.rows.flatMap(row => row.packs.map(pack => [pack.collection_id, pack]))).values()];
  const importedIds = imported.map(pack => pack.collection_id).sort();
  const target = create?.preview?.request?.action?.pack_id;
  assert.ok(!importedIds.includes(target), 'Custom pack cannot reuse an imported source group');
  assert.deepEqual(restart.profile.organization_before_open, null);
  const marker = {restore, create, rename, add};
  assert.deepEqual(final.profile.organization_before_open, marker, 'Exact organization records did not survive localStorage restart');
  assert.deepEqual(final.operations.restore, restore, 'Final native restore probe must retain the original restore record');
  if (requireMemberships) { assert.equal(final.profile.recovery_before_open, null); assert.equal(final.profile.recovery_after_open, null); } else { assert.deepEqual(final.profile.recovery_before_open, add); assert.deepEqual(final.profile.recovery_after_open, add); }
  const finalLookup = final.api_trace.find(row => row.path === '/api/library/catalog/operation' && row.source === (requireMemberships ? 'probe' : 'app') && row.delivery === 'forwarded' && row.request.operation_id === add?.operation_id && row.response?.outcome === 'committed');
  assert.ok(finalLookup, 'Final restart must reconcile the original add-memberships operation');
  checkedCatalogResult(finalLookup.response, add, {lookup: true}); assert.equal(finalLookup.response.generation, requireMemberships ? 6 : 5);
  nativeQuery(restart, restart.catalog.restored, {view: 'active', limit: 100}, 2, libraryId);
  assert.deepEqual(restart.catalog.restored.counts, fixture.spec.expected.restored);
  assert.deepEqual(orderedRows(restart.catalog.restored.rows), orderedRows(initial.rows), 'Original restored checkpoint changed before custom-pack organization');
  const extraPreviews = allApi.filter(row => row.path === '/api/library/catalog/preview' && organizationKinds.includes(row.request?.action) && (!requireMemberships || row.phase === 'catalog-restart'));
  assert.equal(extraPreviews.length, 3, 'Exactly one native review of each organization operation is required');
  let previousDigest = restart.catalog.restored.catalog_digest, previousCommitSequence = 0;
  for (const [index, record] of records.entries()) {
    checkedRecoveryRecord(record, libraryId); assert.equal(record.phase, 'committed'); assert.equal(record.kind, organizationKinds[index]);
    const preview = record.preview, action = preview.request.action;
    assert.equal(preview.request.expected_generation, index + 2); assert.equal(preview.next_generation, index + 3); assert.equal(preview.base_digest, previousDigest);
    assert.equal(action.pack_id, target);
    assert.deepEqual(action, index === 2 ? {type: 'add_memberships', pack_id: target, song_ids: record.selected.map(row => row.edition_id)} : {type: organizationKinds[index], pack_id: target, name: index ? 'rr' : 'r'});
    assert.deepEqual(record.selected.map(row => row.edition_id).sort(), index === 2 ? selectedIds : []);
    if (index === 2) for (const row of record.selected) assert.equal(row.title, initial.rows.find(item => item.edition_id === row.edition_id).title);
    assert.deepEqual(preview.effects.noops, []);
    if (index === 2) assert.deepEqual([...preview.effects.added_memberships].sort((a, b) => a.song.localeCompare(b.song)), selectedIds.map(song => ({pack: target, song})));
    const calls = allApi.filter(row => row.path === '/api/library/catalog/commit' && row.request.preview.request.operation_id === record.operation_id);
    assert.equal(calls.length, 1, 'Organization must commit once with its exact reviewed identity');
    const commit = calls[0], review = extraPreviews[index];
    for (const row of [review, commit]) { assert.equal(row.phase, 'catalog-restart'); assert.equal(row.source, 'app'); assert.equal(row.method, 'POST'); assert.equal(row.delivery, 'forwarded'); assert.equal(row.dispatched, true); assert.equal(row.status, 200); }
    assert.equal(review.request.action, record.kind); assert.deepEqual(review.response.preview, preview); assert.deepEqual(review.response.summary, record.summary);
    assert.deepEqual(commit.request, {library_id: libraryId, preview});
    checkedCatalogResult(commit.response, record); assert.equal(commit.response.generation, index + 3); assert.equal(commit.response.replayed, false);
    actionAt(restart, review.action_sequence, `management-catalog-${['create', 'rename', 'add'][index]}-preview`);
    actionAt(restart, commit.action_sequence, 'management-catalog-confirm');
    assert.ok(review.sequence > previousCommitSequence && commit.sequence > review.sequence && review.action_sequence < commit.action_sequence, 'Organization reviews and commits must be strictly ordered');
    if (!index) assert.ok(review.action_sequence > restart.screenshots['restored-current-owner'], 'Organization bypassed the original restored-current-owner screenshot');
    if (index === 2) assert.ok(restart.screenshots['user-pack-add-review'] >= review.action_sequence && restart.screenshots['user-pack-add-review'] < commit.action_sequence, 'Add review screenshot must precede its explicit commit');
    previousCommitSequence = commit.sequence; previousDigest = commit.response.catalog_digest;
  }
  assert.equal(new Set([seed.operations.initialize, seed.operations.trash, restore, ...records].map(record => record.operation_id)).size, 6, 'Every durable operation needs a distinct native identity');
  for (const [control, kind] of [['management-catalog-create-name', 'key-r'], ['management-catalog-rename-name', 'key-r'], ['management-catalog-add-target', 'select-last']]) {
    const actions = restart.actions.filter(action => action.control === control && action.kind === kind); assert.equal(actions.length, 1); actionAt(restart, actions[0].sequence, control, kind);
    if (kind === 'select-last') { assert.equal(actions[0].selection.after, target, 'Native destination must change exactly once to the reviewed custom pack'); assert.deepEqual(actions[0].selection.option_values, ['', target]); }
  }
  assert.equal(org.review_focus?.length, 3, 'Each organization review needs actual viewport focus evidence');
  for (const [index, focus] of org.review_focus.entries()) {
    assert.equal(focus.kind, organizationKinds[index]); assert.equal(focus.action_sequence, extraPreviews[index].action_sequence); assert.equal(focus.active_element, 'management-catalog-review-title');
    assert.deepEqual(focus.viewport, {width: restart.layout.width, height: restart.layout.height});
    for (const key of ['top', 'bottom', 'width', 'height']) assert.ok(Number.isFinite(focus[key]));
    assert.ok(focus.top >= 0 && focus.bottom <= focus.viewport.height && focus.bottom > focus.top && focus.width > 0 && focus.width <= focus.viewport.width && focus.height > 0 && focus.height <= focus.viewport.height);
  }
  assert.deepEqual(final.organization.review_focus, []);
  const renameAction = restart.actions.filter(action => action.control === 'management-catalog-rename-pack');
  assert.equal(renameAction.length, 1); actionAt(restart, renameAction[0].sequence, 'management-catalog-rename-pack'); assert.equal(renameAction[0].collection_id, target);
  const custom = {collection_id: target, kind: 'custom', import_pack_id: null, name: 'rr'};
  const expectedRows = initial.rows.map(row => selectedIds.includes(row.edition_id) ? {...row, packs: [...row.packs, custom], pack_count: row.pack_count + 1} : row);
  const expectedPacks = (rows, name) => [...imported, {...custom, name}].map(pack => {
    const songs = rows.filter(row => row.packs.some(item => item.collection_id === pack.collection_id));
    return {...pack, kind: pack.kind || 'imported', active_song_count: songs.length, available_song_count: songs.filter(row => row.physical_available).length, shared_song_count: songs.filter(row => row.pack_count > 1).length};
  }).sort((a, b) => a.collection_id.localeCompare(b.collection_id));
  const emptyQueries = nativeQuery(restart, org.empty, {view: 'packs', limit: 100}, 3, libraryId);
  assert.deepEqual(org.empty.counts, {...fixture.spec.expected.restored, packs: 4});
  assert.deepEqual([...org.empty.rows].sort((a, b) => a.collection_id.localeCompare(b.collection_id)), expectedPacks(initial.rows, 'r'));
  assert.ok(emptyQueries.some(row => row.sequence < extraPreviews[1].sequence), 'Empty custom pack must be observed before rename');
  assert.ok(restart.screenshots['user-pack-empty-review'] < extraPreviews[1].action_sequence);
  for (const report of [restart, final]) {
    const value = report.organization, generation = requireMemberships && report === final ? 7 : 5, digest = requireMemberships && report === final ? final.memberships?.recovered?.catalog_digest : previousDigest;
    assert.deepEqual(Object.keys(value).sort(), ['create', 'rename', 'add', 'empty', 'packs', 'filtered', 'readonly', 'visible_editions', 'filter_action', 'review_focus'].sort());
    for (const key of ['create', 'rename', 'add']) assert.deepEqual(value[key], org[key], 'Final organization operation identity changed');
    if (report === final) assert.equal(value.empty, null);
    nativeQuery(report, value.packs, {view: 'packs', limit: 100}, generation, libraryId);
    const queries = nativeQuery(report, value.filtered, {view: 'active', collection_id: target, limit: 100}, generation, libraryId);
    for (const checkpoint of [value.packs, value.filtered, report.catalog.active, report.catalog.trash]) { assert.equal(checkpoint.catalog_digest, digest); assert.equal(checkpoint.generation, generation); assert.deepEqual(checkpoint.counts, {...fixture.spec.expected.restored, packs: 4, memberships: 6}); }
    assert.deepEqual([...value.packs.rows].sort((a, b) => a.collection_id.localeCompare(b.collection_id)), expectedPacks(expectedRows, 'rr'));
    assert.deepEqual(orderedRows(report.catalog.active.rows), orderedRows(expectedRows), 'Custom organization altered unrelated original song/source memberships');
    assert.deepEqual(orderedRows(value.filtered.rows), orderedRows(expectedRows.filter(row => selectedIds.includes(row.edition_id))));
    assert.deepEqual(value.visible_editions, value.filtered.rows.map(row => row.edition_id).sort(), 'Actual filtered DOM differs from native target collection');
    assert.deepEqual(value.readonly, {imported_collection_ids: importedIds, rename_target_ids: [target], add_target_ids: [target], imported_rename_controls: []}, 'Imported source groups acquired a mutation control');
    const open = actionAt(report, value.filter_action, 'management-catalog-open-pack'); assert.equal(open.collection_id, target);
    assert.ok(report.api_trace.some(row => row.path === '/api/library/catalog/query' && row.source === 'app' && row.action_sequence === value.filter_action && row.request.view === 'active' && row.request.collection_id === target && row.response?.catalog_digest === digest && sameCatalogValue(orderedRows(row.response.rows), orderedRows(value.filtered.rows))), 'Pack filter lacks its actual trusted app query');
    assert.ok(report.screenshots[report === restart ? 'user-pack-filtered' : 'persisted-user-pack'] >= value.filter_action);
    if (report === restart) assert.ok(value.filter_action > restart.screenshots['user-pack-add-review']);
  }
  const exports = allApi.filter(row => row.path === '/api/library/pack/export');
  assert.equal(exports.length, 2, 'Exactly two selected original edition ZIP exports are required');
  for (const kind of ['legacy', 'clean']) {
    const song = initial.rows.find(row => selectedIds.includes(row.edition_id) && row.storage_kind === kind);
    const matches = exports.filter(row => sameCatalogValue(row.request, {keys: [song.key]})); assert.equal(matches.length, 1);
    const row = matches[0]; assert.equal(row.phase, 'catalog-restart'); assert.equal(row.source, 'app'); assert.equal(row.status, 200); assert.equal(row.delivery, 'forwarded');
    actionAt(restart, row.action_sequence, `management-catalog-export-${kind}`); assert.ok(row.action_sequence > org.filter_action);
  }
  return {create, rename, add, customPackId: target};
}

export function validateCatalogSelectedExport(bytes, report, kind, operations, fixture) {
  assert.ok(Buffer.isBuffer(bytes) && ['legacy', 'clean'].includes(kind));
  const song = operations.initialRows.find(row => operations.selectedIds.includes(row.edition_id) && row.storage_kind === kind);
  assert.ok(song, 'Selected export must preserve one original selected edition');
  const rows = report.api_trace.filter(row => row.path === '/api/library/pack/export' && sameCatalogValue(row.request, {keys: [song.key]})); assert.equal(rows.length, 1);
  const row = rows[0]; assert.equal(row.source, 'app'); assert.equal(row.method, 'POST'); assert.equal(row.status, 200); assert.equal(row.dispatched, true); assert.equal(row.delivery, 'forwarded');
  assert.equal(row.response, null); assert.equal(row.response_text, null); assert.equal(bytes.length, row.response_binary_bytes); assert.equal(sha256(bytes), row.response_sha256, 'Downloaded selected ZIP differs from actual native export response');
  const inventory = inspectOriginalManagementZip(bytes);
  if (kind === 'legacy') assertSelectedLegacyExport(inventory, song, operations.imports.map(item => item.response));
  else assertCleanExportInventory(inventory, fixture.cleanFixture, song.key);
  return inventory;
}
