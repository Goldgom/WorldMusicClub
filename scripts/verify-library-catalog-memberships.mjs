// Strict ORIGINAL-fixture evidence extension. Synthetic Node fixtures never establish acceptance.
import assert from 'node:assert/strict';
import {catalogQuery, checkedCatalogStatus, checkedCatalogQuery, checkedCatalogPreview, checkedRecoveryRecord, checkedCatalogResult, sameCatalogValue} from '../web/library-catalog-contract.js';
import en from '../web/locales/library-management-en.js';
import zh from '../web/locales/library-management-zh-CN.js';

const recordNames = ['remove_before_restart', 'undo_after_restart', 'create_destination', 'add_existing_destination', 'move', 'undo_move', 'remove_conflict', 'readd_conflict'];
const kinds = ['remove_memberships', 'undo_memberships', 'create_pack', 'add_memberships', 'move_memberships', 'undo_memberships', 'remove_memberships', 'add_memberships'];
const controls = ['remove', 'undo', 'create', 'add', 'move', 'undo', 'remove', 'add'];
const compare = (a, b) => a < b ? -1 : a > b ? 1 : 0;
const edgeOrder = (a, b) => compare(a.pack, b.pack) || compare(a.song, b.song);
const edges = (pack, songs) => songs.map(song => ({pack, song})).sort(edgeOrder);
const orderedRows = rows => rows.map(row => ({...row, packs: [...row.packs].sort((a, b) => compare(a.collection_id, b.collection_id))})).sort((a, b) => compare(a.edition_id, b.edition_id));
const exactKeys = (value, keys, message) => assert.deepEqual(Object.keys(value || {}).sort(), [...keys].sort(), message);
const custom = (collection_id, name) => ({collection_id, kind: 'custom', import_pack_id: null, name});
function actionAt(report, sequence, control, kind = 'click') {
  assert.ok(Number.isSafeInteger(sequence) && sequence > 0, 'Membership evidence needs a trusted action sequence');
  const action = report.actions[sequence - 1];
  assert.equal(action?.sequence, sequence); assert.equal(action.kind, kind); assert.equal(action.control, control);
  if (['select-second', 'select-last'].includes(kind)) assert.ok([1, 2].includes(action.trusted_clicks)); else assert.equal(action.trusted_clicks, 1);
  assert.equal(action.untrusted_clicks, 0); assert.equal(action.completed, true);
  return action;
}
function nativeCall(row, phase, delivery = 'forwarded', app = true) {
  assert.ok(row, 'Membership checkpoint lacks actual native API evidence');
  if (phase) assert.equal(row.phase, phase);
  if (app) assert.equal(row.source, 'app');
  assert.equal(row.method, row.path === '/api/library/catalog/status' ? 'GET' : 'POST'); assert.equal(row.status, 200); assert.equal(row.dispatched, true); assert.equal(row.delivery, delivery);
}
function nativeQuery(report, value, generation, digest, expectedRows, counts, libraryId) {
  checkedCatalogQuery(value, {view: 'active', limit: 100}, libraryId);
  assert.equal(value.generation, generation); assert.equal(value.catalog_digest, digest); assert.equal(value.collection_id ?? null, null);
  assert.equal(value.next_cursor, null); assert.equal(value.total, expectedRows.length);
  assert.deepEqual(value.counts, counts); assert.deepEqual(orderedRows(value.rows), orderedRows(expectedRows), 'Membership edit changed unrelated songs or imported memberships');
  const matches = report.api_trace.filter(row => row.path === '/api/library/catalog/query' && row.request?.view === 'active' && (row.request.collection_id ?? null) === null && sameCatalogValue(row.response, value));
  assert.ok(matches.length > 0, 'Membership checkpoint lacks exact native query bytes');
  matches.forEach(row => nativeCall(row, null, 'forwarded', false));
  return matches;
}
function reviewFocus(report, records, reviews) {
  assert.equal(report.memberships.review_focus?.length, records.length, 'Every membership operation needs its actual review focus');
  for (const [index, focus] of report.memberships.review_focus.entries()) {
    exactKeys(focus, ['kind', 'action_sequence', 'active_element', 'top', 'bottom', 'width', 'height', 'viewport']);
    assert.equal(focus.kind, records[index].kind); assert.equal(focus.action_sequence, reviews[index].action_sequence);
    assert.equal(focus.active_element, 'management-catalog-review-title');
    assert.deepEqual(focus.viewport, {width: report.layout.width, height: report.layout.height});
    for (const key of ['top', 'bottom', 'width', 'height']) assert.ok(Number.isFinite(focus[key]));
    assert.ok(focus.top >= 0 && focus.bottom <= focus.viewport.height && focus.bottom > focus.top && focus.width > 0 && focus.width <= focus.viewport.width && focus.height > 0 && focus.height <= focus.viewport.height);
    assert.ok(Math.abs(focus.bottom - focus.top - focus.height) < 0.01, 'Review rectangle has inconsistent height');
  }
}
function selection(report, control, target, options, labels, start, end) {
  const candidates = report.actions.filter(row => row.sequence > start && row.sequence < end && row.control === control && ['select-second', 'select-last'].includes(row.kind));
  assert.equal(candidates.length, 1, 'Membership destination needs one explicit native selection');
  const action = candidates[0]; actionAt(report, action.sequence, control, action.kind);
  const index = options.indexOf(target), picked = action.selection;
  assert.ok(index > 0); assert.equal(index, action.kind === 'select-second' ? 1 : options.length - 1);
  assert.equal(picked?.target_id, control); assert.equal(picked.target_tag, 'SELECT');
  assert.deepEqual(picked.option_values, options); assert.equal(picked.after, target); assert.equal(picked.selected_index, index);
  assert.ok(options.includes(picked.before)); assert.notEqual(picked.before, picked.after);
  assert.equal(picked.selected_text, labels.get(target)); assert.equal(picked.trusted_changes, 1); assert.equal(picked.untrusted_changes, 0);
}

export function validateCatalogMemberships(reports, {initial, selectedIds, allApi, fixture}) {
  assert.equal(reports.length, 3);
  const [seed, restart, final] = reports, first = restart.memberships, last = final.memberships, libraryId = initial.library_id;
  assert.equal(seed.memberships, undefined, 'Membership edits must follow the original organization gate');
  assert.ok(first && last, 'Required membership evidence is missing');
  exactKeys(first, ['source_pack_id', 'selected_ids', 'records', 'before', 'after_remove', 'cache', 'review_focus']);
  exactKeys(last, ['source_pack_id', 'selected_ids', 'records', 'discovery', 'recovered', 'uncertain', 'after_move', 'after_undo', 'conflict', 'after_conflict', 'review_focus']);
  exactKeys(first.records, [recordNames[0]]); exactKeys(last.records, recordNames.slice(1));
  assert.deepEqual(allApi, reports.flatMap(report => report.api_trace.map(row => ({...row, phase: report.phase}))), 'Caller-supplied API proof differs from the phase traces');
  assert.deepEqual(selectedIds, [...new Set(selectedIds)].sort()); assert.equal(selectedIds.length, 2);
  for (const value of [first, last]) assert.deepEqual(value.selected_ids, selectedIds);
  const sourcePackId = restart.organization?.create?.preview?.request?.action?.pack_id;
  assert.equal(first.source_pack_id, sourcePackId); assert.equal(last.source_pack_id, sourcePackId);
  assert.ok(sourcePackId, 'Original custom pack identity is required');
  const membershipRecords = recordNames.map((name, index) => (index ? last : first).records[name]);
  const [remove, undoRemove, create, add, move, undoMove, conflictRemove, readd] = membershipRecords;
  const destinationPackId = create.preview.request.action.pack_id, source = custom(sourcePackId, 'rr'), destination = custom(destinationPackId, 'r');
  const importedIds = [...new Set(initial.rows.flatMap(row => row.packs.map(pack => pack.collection_id)))];
  assert.ok(destinationPackId !== sourcePackId && !importedIds.includes(destinationPackId));
  assert.ok(!importedIds.includes(sourcePackId));
  const legacy = initial.rows.find(row => selectedIds.includes(row.edition_id) && row.storage_kind === 'legacy')?.edition_id;
  const clean = initial.rows.find(row => selectedIds.includes(row.edition_id) && row.storage_kind === 'clean')?.edition_id;
  assert.ok(legacy && clean, 'Membership evidence must use the original mixed-format selection');
  const records = [seed.operations.initialize, seed.operations.trash, restart.operations.restore, restart.organization.create, restart.organization.rename, restart.organization.add, ...membershipRecords];
  assert.equal(new Set(records.map(record => record.operation_id)).size, 14, 'Membership operations cannot reuse or replace a durable identity');
  const previews = allApi.filter(row => row.path === '/api/library/catalog/preview' && row.request?.expected_generation >= 5);
  const commits = allApi.filter(row => row.path === '/api/library/catalog/commit' && row.request?.preview?.request?.expected_generation >= 5);
  assert.equal(previews.length, 8, 'Each new changed operation needs exactly one native preview');
  assert.equal(commits.length, 8, 'Each new changed operation must commit exactly once');
  const originalAdd = restart.organization.add, addResult = allApi.find(row => row.path === '/api/library/catalog/commit' && row.request?.preview?.request?.operation_id === originalAdd.operation_id);
  assert.ok(addResult); checkedCatalogResult(addResult.response, originalAdd); assert.equal(addResult.response.generation, 5);
  let digest = addResult.response.catalog_digest;
  const rowsAt = (sourceSongs, destinationSongs = []) => initial.rows.map(row => {
    const packs = [...row.packs, ...(sourceSongs.includes(row.edition_id) ? [source] : []), ...(destinationSongs.includes(row.edition_id) ? [destination] : [])];
    return {...row, packs, pack_count: packs.length};
  });
  const rowStates = [rowsAt(selectedIds), rowsAt([]), rowsAt(selectedIds), rowsAt(selectedIds), rowsAt(selectedIds, [legacy]), rowsAt([], selectedIds), rowsAt(selectedIds, [legacy]), rowsAt([clean], [legacy]), rowsAt(selectedIds, [legacy])];
  const countAt = index => ({...fixture.spec.expected.restored, packs: fixture.spec.expected.restored.packs + (index >= 3 ? 2 : 1), memberships: rowStates[index].reduce((total, row) => total + row.pack_count, 0)});
  const beforeQueries = nativeQuery(restart, first.before, 5, digest, rowStates[0], countAt(0), libraryId);
  const expectedSelections = [selectedIds, selectedIds, [], [legacy], selectedIds, selectedIds, [legacy], [legacy]];
  const expectedActions = [
    {type: kinds[0], pack_id: sourcePackId, song_ids: remove.selected.map(row => row.edition_id)},
    {type: kinds[1], membership_operation_id: remove.operation_id},
    {type: kinds[2], pack_id: destinationPackId, name: 'r'},
    {type: kinds[3], pack_id: destinationPackId, song_ids: [legacy]},
    {type: kinds[4], from_pack: sourcePackId, to_pack: destinationPackId, song_ids: move.selected.map(row => row.edition_id)},
    {type: kinds[5], membership_operation_id: move.operation_id},
    {type: kinds[6], pack_id: sourcePackId, song_ids: [legacy]},
    {type: kinds[7], pack_id: sourcePackId, song_ids: [legacy]},
  ];
  const added = [[], edges(sourcePackId, selectedIds), [], edges(destinationPackId, [legacy]), edges(destinationPackId, [clean]), edges(sourcePackId, selectedIds), [], edges(sourcePackId, [legacy])];
  const removed = [edges(sourcePackId, selectedIds), [], [], [], edges(sourcePackId, selectedIds), edges(destinationPackId, [clean]), edges(sourcePackId, [legacy]), []];
  const originalSnapshots = originalAdd.preview.request.action.song_ids.map((song, position) => ({id: {pack: sourcePackId, song}, position, added_at_unix_ms: originalAdd.preview.request.at_unix_ms, revision: 5})).sort((a, b) => edgeOrder(a.id, b.id));
  for (const [index, record] of membershipRecords.entries()) {
    const generation = index + 6, report = index ? final : restart, review = previews[index], commit = commits[index];
    checkedRecoveryRecord(record, libraryId); assert.equal(record.phase, 'committed'); assert.equal(record.kind, kinds[index]);
    assert.deepEqual(record.preview.request.action, expectedActions[index]);
    assert.deepEqual(record.selected.map(row => row.edition_id).sort(), expectedSelections[index]);
    if (record.kind === 'undo_memberships') {
      // Undo labels use the renderer's current verified page. A moved-out source
      // is empty, so its exact storage-qualified IDs are the required fallback.
      const visible = report.api_trace.findLast(row => row.path === '/api/library/catalog/query' && row.source === 'app' && row.request?.view === 'active' && row.sequence < review.sequence);
      nativeCall(visible, null); checkedCatalogQuery(visible.response, catalogQuery(visible.request), libraryId);
      assert.equal(visible.response.generation, record.preview.request.expected_generation); assert.equal(visible.response.catalog_digest, record.preview.base_digest);
      assert.equal(visible.request.collection_id ?? null, index === 5 ? sourcePackId : null, 'Undo title lookup must use the actual source-filter or restarted catalog page');
      assert.ok(visible.action_sequence < review.action_sequence, 'Undo review must follow its verified catalog page');
      for (const row of record.selected) {
        const metadata = visible.response.rows.find(item => item.edition_id === row.edition_id);
        if (metadata) assert.equal(metadata.title, initial.rows.find(item => item.edition_id === row.edition_id).title, 'Visible native song metadata changed');
        assert.equal(row.title, metadata?.title || row.edition_id, 'Undo display label differs from its verified page or exact edition fallback');
      }
    } else for (const row of record.selected) assert.equal(row.title, initial.rows.find(item => item.edition_id === row.edition_id).title);
    assert.equal(record.preview.request.expected_generation, generation - 1); assert.equal(record.preview.next_generation, generation); assert.equal(record.preview.base_digest, digest);
    assert.deepEqual(record.preview.effects.added_memberships, added[index]); assert.deepEqual(record.preview.effects.removed_memberships, removed[index]);
    assert.deepEqual(record.preview.effects.noops, index === 4 ? [{target: {kind: 'membership', id: {pack: destinationPackId, song: legacy}}, reason: 'already_present'}] : []);
    assert.deepEqual(record.preview.effects.newly_unfiled_songs, []);
    const snapshots = index === 0 ? originalSnapshots : index === 4 ? originalSnapshots.map(edge => ({...edge, revision: 7})) : index === 6 ? originalSnapshots.filter(edge => edge.id.song === legacy).map(edge => ({...edge, revision: 11})) : undefined;
    assert.deepEqual(record.preview.effects.removed_membership_snapshots, snapshots, 'Membership receipt lost exact original positions, timestamps or revisions');
    if ([0, 1, 4, 5, 6].includes(index)) {
      assert.deepEqual(record.summary.source_pack, source); assert.deepEqual(record.summary.destination_pack, [4, 5].includes(index) ? destination : null);
    }
    assert.deepEqual(record.summary.target_pack, [2, 3, 4].includes(index) ? destination : source);
    assert.equal(record.summary.shared_song_count, rowStates[index].filter(row => expectedSelections[index].includes(row.edition_id) && row.pack_count > 1).length);
    const references = new Map([[sourcePackId, source], [destinationPackId, destination]]);
    assert.deepEqual(record.summary.affected_packs, record.preview.effects.affected_packs.map(id => ({...references.get(id), selected_song_count: ['add_memberships', 'move_memberships'].includes(record.kind) && id === (record.kind === 'move_memberships' ? destinationPackId : record.preview.request.action.pack_id) ? record.selected.length : rowStates[index].filter(row => expectedSelections[index].includes(row.edition_id) && row.packs.some(pack => pack.collection_id === id)).length})));
    nativeCall(review, report.phase); nativeCall(commit, report.phase, index === 4 ? 'lost-after-native' : 'forwarded');
    checkedCatalogPreview(review.response, review.request);
    assert.deepEqual(review.response.preview, record.preview); assert.deepEqual(review.response.summary, record.summary);
    assert.equal(review.request.action, record.kind); assert.deepEqual(commit.request, {library_id: libraryId, preview: record.preview});
    checkedCatalogResult(commit.response, record); assert.equal(commit.response.generation, generation); assert.equal(commit.response.replayed, false);
    actionAt(report, review.action_sequence, `management-catalog-${controls[index]}-preview`); actionAt(report, commit.action_sequence, 'management-catalog-confirm');
    assert.ok(review.sequence < commit.sequence && review.action_sequence < commit.action_sequence, 'Membership commit bypassed its native review');
    if (index > 1) assert.ok(review.sequence > commits[index - 1].sequence && review.action_sequence > commits[index - 1].action_sequence, 'Membership review order changed');
    digest = commit.response.catalog_digest;
  }
  reviewFocus(restart, [remove], previews.slice(0, 1)); reviewFocus(final, membershipRecords.slice(1), previews.slice(1));
  assert.ok(beforeQueries.some(row => row.sequence < previews[0].sequence));
  const beforeActionSequences = beforeQueries.filter(row => row.sequence < previews[0].sequence && Number.isSafeInteger(row.action_sequence)).map(row => row.action_sequence);
  assert.ok(beforeActionSequences.length, 'Membership starting checkpoint needs its actual input position');
  for (const index of [0, 3, 4, 6, 7]) {
    const report = index ? final : restart, begin = index ? commits[index - 1].action_sequence : Math.max(...beforeActionSequences);
    const clicks = report.actions.filter(row => row.sequence > begin && row.sequence < previews[index].action_sequence && /^(legacy|clean):song-/.test(row.control));
    assert.deepEqual(clicks.map(row => row.control).sort(), expectedSelections[index], 'Membership review lacks its exact trusted edition selection');
    for (const click of clicks) actionAt(report, click.sequence, click.control);
  }
  const nameKeys = final.actions.filter(row => row.sequence > commits[1].action_sequence && row.sequence < previews[2].action_sequence && row.control === 'management-catalog-create-name');
  assert.equal(nameKeys.length, 1, 'Destination name must come from one real keyboard action');
  for (const key of nameKeys) { actionAt(final, key.sequence, key.control, 'key-r'); assert.equal(key.trusted_key_downs, 1); assert.equal(key.trusted_key_ups, 1); }
  const checkpoint = (report, value, index) => {
    const result = nativeQuery(report, value, index + 5, commits[index - 1].response.catalog_digest, rowStates[index], countAt(index), libraryId);
    assert.ok(result.some(row => row.sequence > commits[index - 1].sequence && (index === 1 || index === 8 || row.sequence < previews[index].sequence)), 'Membership checkpoint is missing, stale or reordered');
    return result;
  };
  checkpoint(restart, first.after_remove, 1); checkpoint(final, last.recovered, 2);
  const moveQueries = checkpoint(final, last.after_move, 5);
  checkpoint(final, last.after_undo, 6); checkpoint(final, last.after_conflict, 8);
  assert.deepEqual(first.cache, {before: remove, after: null});
  assert.equal(final.profile.recovery_before_open, null); assert.equal(final.profile.recovery_after_open, null);
  exactKeys(last.discovery, ['status', 'local_record', 'visible', 'disabled', 'operation_text']);
  assert.equal(last.discovery.local_record, null); assert.equal(last.discovery.visible, true); assert.equal(last.discovery.disabled, false);
  const locale = final.layout.locale === 'zh-CN' ? zh : en;
  assert.equal(last.discovery.operation_text, locale['management.catalog.reviewUndo'].replace('{id}', remove.operation_id));
  const status = (value, record, generation, canUndo) => {
    checkedCatalogStatus(value); assert.equal(value.library_id, libraryId); assert.equal(value.state, 'ready');
    assert.equal(value.generation, generation); assert.equal(value.catalog_digest, commits[generation - 6].response.catalog_digest);
    assert.deepEqual(value.counts, countAt(generation - 5));
    assert.deepEqual(value.membership_undo, {operation_id: record.operation_id, action: record.kind, selected_count: record.selected.length, source_pack: source, destination_pack: null, can_undo: canUndo});
    const matches = final.api_trace.filter(row => row.path === '/api/library/catalog/status' && sameCatalogValue(row.response, value));
    assert.ok(matches.length > 0, 'Undo discovery must come from the current native journal status');
    matches.forEach(row => nativeCall(row)); return matches;
  };
  const discovery = status(last.discovery.status, remove, 6, true);
  assert.ok(discovery.some(row => row.sequence < previews[1].sequence));
  assert.ok(!final.api_trace.some(row => row.path === '/api/library/catalog/operation' && row.request?.operation_id === remove.operation_id && row.sequence < previews[1].sequence), 'Restart discovery must work with the local recovery key erased');
  assert.deepEqual(last.uncertain, {before: {...move, phase: 'uncertain'}, after: move});
  const lookups = allApi.filter(row => row.path === '/api/library/catalog/operation' && row.request?.operation_id === move.operation_id);
  assert.equal(lookups.length, 1, 'Lost move response requires one same-ID native lookup');
  const lookup = lookups[0]; nativeCall(lookup, final.phase);
  assert.deepEqual(lookup.request, {library_id: libraryId, operation_id: move.operation_id}); checkedCatalogResult(lookup.response, move, {lookup: true});
  assert.equal(lookup.response.outcome, 'committed'); assert.equal(lookup.response.generation, 10); assert.equal(lookup.response.catalog_digest, commits[4].response.catalog_digest);
  actionAt(final, lookup.action_sequence, 'management-catalog-check');
  assert.ok(lookup.sequence > commits[4].sequence && lookup.sequence < previews[5].sequence && lookup.action_sequence > commits[4].action_sequence && lookup.action_sequence < previews[5].action_sequence);
  assert.ok(moveQueries.some(row => row.sequence > lookup.sequence), 'Move checkpoint must follow same-ID native reconciliation');
  assert.ok(!final.actions.some(row => row.control === 'management-catalog-retry'), 'The uncertain move must never be retried or replaced');
  exactKeys(last.conflict, ['status', 'visible', 'disabled', 'reason']);
  assert.equal(last.conflict.visible, true); assert.equal(last.conflict.disabled, true); assert.equal(last.conflict.reason, locale['management.catalog.undoBlocked']);
  const conflictStatuses = status(last.conflict.status, conflictRemove, 13, false);
  assert.ok(conflictStatuses.some(row => row.sequence > commits[7].sequence));
  const shotBetween = (report, name, begin, end = report.actions.length + 1) => {
    const sequence = report.screenshots[name]; assert.ok(Number.isSafeInteger(sequence) && sequence >= begin && sequence < end, `Missing or reordered ${name} screenshot`);
  };
  shotBetween(restart, 'membership-remove-review', previews[0].action_sequence, commits[0].action_sequence);
  shotBetween(final, 'membership-restart-undo', Math.min(...discovery.map(row => row.action_sequence)), previews[1].action_sequence);
  shotBetween(final, 'membership-move-review', previews[4].action_sequence, commits[4].action_sequence);
  shotBetween(final, 'membership-conflict', commits[7].action_sequence);
  const options = ['', ...[sourcePackId, destinationPackId].sort()], labels = new Map([[sourcePackId, `rr · ${sourcePackId}`], [destinationPackId, `r · ${destinationPackId}`]]);
  selection(final, 'management-catalog-add-target', destinationPackId, options, labels, commits[2].action_sequence, previews[3].action_sequence);
  selection(final, 'management-catalog-move-target', destinationPackId, ['', destinationPackId], labels, commits[3].action_sequence, previews[4].action_sequence);
  selection(final, 'management-catalog-add-target', sourcePackId, options, labels, commits[6].action_sequence, previews[7].action_sequence);
  return {membershipRecords, destinationPackId};
}

/** Recompute the Rust transition from the previous durable state, never from caller claims. */
export function validateMembershipJournalState(state, previousState, record, generation, records) {
  assert.ok(Number.isSafeInteger(generation) && generation >= 6 && generation <= 13);
  assert.equal(previousState.generation, generation - 1); assert.deepEqual(records[generation], record);
  checkedRecoveryRecord(record, record.library_id); assert.equal(record.phase, 'committed'); assert.equal(record.kind, kinds[generation - 6]);
  const preview = record.preview, request = preview.request, action = request.action;
  assert.equal(request.expected_generation, generation - 1); assert.equal(preview.next_generation, generation);
  assert.deepEqual(previousState.receipts, records.slice(1, generation).map(item => ({preview: item.preview})), 'Previous membership history was pruned or rewritten');
  const expected = structuredClone(previousState), effects = {created_packs: [], renamed_packs: [], added_memberships: [], removed_memberships: [], trashed_songs: [], trashed_packs: [], restored_songs: [], restored_packs: [], noops: [], blocked_memberships: [], affected_packs: [], newly_unfiled_songs: [], retained_payload_bytes: previousState.inventory.songs.reduce((sum, song) => sum + song.retained_bytes, 0), retained_source_bytes: previousState.inventory.sources.reduce((sum, source) => sum + source.retained_bytes, 0), reclaimed_bytes: 0};
  const key = id => `${id.pack}:${id.song}`;
  const existing = id => expected.inventory.memberships.find(edge => key(edge.id) === key(id));
  const activePack = id => { const pack = expected.inventory.packs.find(row => row.id === id); assert.equal(pack?.kind, 'custom'); assert.equal(pack.trashed_by, null); return pack; };
  const activeSong = id => { const song = expected.inventory.songs.find(row => row.id === id); assert.ok(song); assert.equal(song.trashed_by, null); };
  const noop = (id, reason) => effects.noops.push({target: {kind: 'membership', id: structuredClone(id)}, reason});
  const remove = id => { if (existing(id)) { expected.inventory.memberships = expected.inventory.memberships.filter(edge => key(edge.id) !== key(id)); effects.removed_memberships.push(structuredClone(id)); } else noop(id, 'already_absent'); };
  const add = id => {
    if (existing(id)) return noop(id, 'already_present');
    const positions = expected.inventory.memberships.filter(edge => edge.id.pack === id.pack).map(edge => edge.position), position = positions.length ? Math.max(...positions) + 1 : 0;
    assert.ok(position <= 0xffffffff); expected.inventory.memberships.push({id: structuredClone(id), position, added_at_unix_ms: request.at_unix_ms, revision: generation}); effects.added_memberships.push(structuredClone(id));
  };
  if (action.type === 'create_pack') {
    assert.ok(!expected.inventory.packs.some(pack => pack.id === action.pack_id));
    expected.inventory.packs.push({id: action.pack_id, name: action.name, kind: 'custom', source_archive_keys: [], origin_import_operation_id: null, revision: generation, trashed_by: null}); effects.created_packs.push(action.pack_id);
  } else if (['add_memberships', 'remove_memberships'].includes(action.type)) {
    activePack(action.pack_id); action.song_ids.forEach(activeSong);
    for (const song of action.song_ids) (action.type === 'add_memberships' ? add : remove)({pack: action.pack_id, song});
  } else if (action.type === 'move_memberships') {
    activePack(action.from_pack); activePack(action.to_pack); action.song_ids.forEach(activeSong);
    for (const song of action.song_ids) assert.ok(existing({pack: action.from_pack, song}));
    for (const song of action.song_ids) {
      if (action.from_pack === action.to_pack) noop({pack: action.from_pack, song}, 'same_pack');
      else { add({pack: action.to_pack, song}); remove({pack: action.from_pack, song}); }
    }
  } else {
    assert.equal(action.type, 'undo_memberships');
    const original = previousState.receipts.find(receipt => receipt.preview.request.operation_id === action.membership_operation_id)?.preview;
    assert.ok(original && ['remove_memberships', 'move_memberships'].includes(original.request.action.type) && original.effects.removed_membership_snapshots?.length);
    const touched = [...original.effects.added_memberships, ...original.effects.removed_memberships], touchedKeys = new Set(touched.map(key));
    for (const {preview: later} of previousState.receipts.slice(original.next_generation)) {
      assert.ok(!(later.request.action.type === 'undo_memberships' && later.request.action.membership_operation_id === action.membership_operation_id), 'Membership edit was already undone');
      assert.ok(![...later.effects.added_memberships, ...later.effects.removed_memberships].some(id => touchedKeys.has(key(id))), 'Undo crossed a later membership edit');
      assert.ok(![...later.effects.trashed_songs, ...later.effects.restored_songs].some(song => touched.some(id => id.song === song)));
      assert.ok(![...later.effects.trashed_packs, ...later.effects.restored_packs].some(pack => touched.some(id => id.pack === pack)));
    }
    for (const id of touched) { activePack(id.pack); activeSong(id.song); }
    for (const edge of original.effects.removed_membership_snapshots) assert.equal(existing(edge.id), undefined);
    for (const id of original.effects.added_memberships) { assert.equal(existing(id)?.revision, original.next_generation); remove(id); }
    for (const edge of original.effects.removed_membership_snapshots) { expected.inventory.memberships.push({...structuredClone(edge), revision: generation}); effects.added_memberships.push(structuredClone(edge.id)); }
  }
  if (['remove_memberships', 'move_memberships'].includes(action.type) && effects.removed_memberships.length) effects.removed_membership_snapshots = previousState.inventory.memberships.filter(edge => effects.removed_memberships.some(id => key(id) === key(edge.id))).map(edge => structuredClone(edge)).sort((a, b) => edgeOrder(a.id, b.id));
  effects.affected_packs = [...new Set([...effects.created_packs, ...effects.added_memberships.map(id => id.pack), ...effects.removed_memberships.map(id => id.pack)])].sort();
  effects.newly_unfiled_songs = expected.inventory.songs.filter(song => song.trashed_by === null && !expected.inventory.memberships.some(edge => edge.id.song === song.id) && previousState.inventory.memberships.some(edge => edge.id.song === song.id)).map(song => song.id).sort();
  effects.added_memberships.sort(edgeOrder); effects.removed_memberships.sort(edgeOrder);
  effects.noops.sort((a, b) => edgeOrder(a.target.id, b.target.id) || compare(a.reason, b.reason));
  assert.deepEqual(preview.effects, effects, 'Native membership effects do not describe the exact previous-state transition');
  for (const pack of expected.inventory.packs) if (effects.affected_packs.includes(pack.id)) pack.revision = generation;
  expected.inventory.packs.sort((a, b) => compare(a.id, b.id)); expected.inventory.memberships.sort((a, b) => edgeOrder(a.id, b.id));
  expected.generation = generation; expected.receipts.push({preview: structuredClone(preview)});
  assert.deepEqual(state, expected, 'Membership journal changed source provenance, song/Trash state, unrelated references, or exact pack/edge metadata');
  return expected;
}
