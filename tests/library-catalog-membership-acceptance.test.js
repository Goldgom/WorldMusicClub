import test from 'node:test';
import assert from 'node:assert/strict';
import {validateCatalogMemberships, validateMembershipJournalState} from '../scripts/verify-library-catalog-memberships.mjs';
import {syntheticMembershipProtocol} from './library-catalog-membership-acceptance-fixtures.js';
const clone = value => structuredClone(value);
const allApi = reports => reports.flatMap(report => report.api_trace.map(row => ({...row, phase: report.phase})));
const edgeKey = edge => `${edge.pack}:${edge.song}`;
const validate = value => validateCatalogMemberships(value.reports, {...value, allApi: allApi(value.reports)});

test('synthetic membership protocol binds eight changes, native restart Undo and same-ID uncertain move recovery', async () => {
  const value = await syntheticMembershipProtocol(), result = validate(value);
  assert.equal(result.membershipRecords.length, 8); assert.equal(result.destinationPackId, value.records[8].preview.request.action.pack_id);
  assert.deepEqual(result.membershipRecords, value.records.slice(6));
  for (let generation = 6; generation <= 13; generation++) assert.deepEqual(validateMembershipJournalState(value.states[generation], value.states[generation - 1], value.records[generation], generation, value.records), value.states[generation]);
});

test('Undo review labels bind the actual verified page and exact IDs when the moved-out source is empty', async () => {
  const value = await syntheticMembershipProtocol(), final = value.reports[2], undo = final.memberships.records.undo_move, restarted = final.memberships.records.undo_after_restart;
  assert.ok(undo.selected.every(row => row.title === row.edition_id));
  assert.ok(restarted.selected.every(row => row.title === value.initial.rows.find(item => item.edition_id === row.edition_id).title));
  assert.doesNotThrow(() => validate(value));
  const page = input => input.reports[2].api_trace.findLast(row => row.path === '/api/library/catalog/query' && row.source === 'app' && row.response.generation === 10 && row.request.collection_id === input.reports[2].memberships.source_pack_id);
  for (const [label, mutate] of [
    ['arbitrary fallback', v => { v.reports[2].memberships.records.undo_move.selected[0].title = 'Unverified label'; }],
    ['initial title cannot replace an absent page label', v => { const row = v.reports[2].memberships.records.undo_move.selected[0]; row.title = v.initial.rows.find(item => item.edition_id === row.edition_id).title; }],
    ['ID cannot replace a present native title', v => { const row = v.reports[2].memberships.records.undo_after_restart.selected[0]; row.title = row.edition_id; }],
    ['stale visible page', v => { page(v).response.generation--; }],
    ['changed page digest', v => { page(v).response.catalog_digest = '0'.repeat(64); }],
    ['foreign query substituted', v => { page(v).source = 'probe'; }],
    ['wrong source filter', v => { page(v).request.collection_id = null; }],
    ['failed visible query', v => { page(v).status = 409; }],
  ]) { const edited = clone(value); mutate(edited); assert.throws(() => validate(edited), undefined, label); }
});

test('synthetic membership evidence rejects missing, stale, edited, repeated and untrusted proof', async () => {
  const value = await syntheticMembershipProtocol();
  const mutations = [
    ['missing membership phase', v => { delete v.reports[1].memberships; }],
    ['missing operation', v => { delete v.reports[2].memberships.records.undo_move; }],
    ['wrong selected edition', v => { v.reports[1].memberships.selected_ids[0] = v.initial.rows[2].edition_id; }],
    ['edited source ref', v => { v.reports[2].memberships.source_pack_id = v.reports[2].memberships.records.create_destination.preview.request.action.pack_id; }],
    ['missing cache erasure', v => { v.reports[1].memberships.cache.after = v.reports[1].memberships.cache.before; }],
    ['cache supplied discovery', v => { v.reports[2].memberships.discovery.local_record = v.reports[1].memberships.records.remove_before_restart; }],
    ['missing native discovery', v => { v.reports[2].api_trace = v.reports[2].api_trace.filter(row => row.path !== '/api/library/catalog/status' || row.response.generation !== 6); }],
    ['stale native discovery', v => { v.reports[2].memberships.discovery.status.generation = 5; }],
    ['wrong discovered operation', v => { v.reports[2].memberships.discovery.status.membership_undo.operation_id = v.records[5].operation_id; }],
    ['hidden discovered Undo', v => { v.reports[2].memberships.discovery.visible = false; }],
    ['edited operation text', v => { v.reports[2].memberships.discovery.operation_text = 'synthetic success'; }],
    ['wrong inverse reference', v => { v.reports[2].memberships.records.undo_after_restart.preview.request.action.membership_operation_id = v.records[5].operation_id; }],
    ['extra preview', v => { v.reports[2].api_trace.push(clone(v.reports[2].api_trace.find(row => row.path.endsWith('/preview')))); }],
    ['extra uncertain commit', v => { v.reports[2].api_trace.push(clone(v.reports[2].api_trace.find(row => row.delivery === 'lost-after-native'))); }],
    ['lost response replaced by success', v => { v.reports[2].api_trace.find(row => row.delivery === 'lost-after-native').delivery = 'forwarded'; }],
    ['wrong same-ID lookup', v => { v.reports[2].api_trace.find(row => row.path.endsWith('/operation') && row.request.operation_id === v.records[10].operation_id).request.operation_id = v.records[6].operation_id; }],
    ['missing uncertain phase', v => { v.reports[2].memberships.uncertain.before.phase = 'committed'; }],
    ['replaced recovery identity', v => { v.reports[2].memberships.uncertain.after.operation_id = v.records[9].operation_id; }],
    ['retry action', v => { v.reports[2].actions.push({control: 'management-catalog-retry'}); }],
    ['untrusted remove click', v => { v.reports[1].actions.find(row => row.control === 'management-catalog-remove-preview').trusted_clicks = 0; }],
    ['missing exact edition click', v => { v.reports[2].actions.find(row => row.control === v.selectedIds[0]).control = 'different-edition'; }],
    ['extra destination typing action', v => { const action = v.reports[2].actions.find(row => row.control === 'management-catalog-create-name'); v.reports[2].actions.push(clone(action)); }],
    ['old destination name cannot be relabeled', v => { v.reports[2].memberships.records.create_destination.preview.request.action.name = 'rrr'; }],
    ['synthetic destination name', v => { v.reports[2].actions.find(row => row.control === 'management-catalog-create-name').trusted_key_downs = 0; }],
    ['untrusted move selection', v => { v.reports[2].actions.find(row => row.control === 'management-catalog-move-target').selection.untrusted_changes = 1; }],
    ['wrong destination options', v => { v.reports[2].actions.find(row => row.control === 'management-catalog-move-target').selection.option_values.push(v.reports[2].memberships.source_pack_id); }],
    ['fabricated destination label', v => { v.reports[2].actions.find(row => row.control === 'management-catalog-add-target').selection.selected_text = 'wrong pack'; }],
    ['review outside viewport', v => { v.reports[2].memberships.review_focus[0].bottom = 800; }],
    ['missing later review focus', v => { v.reports[2].memberships.review_focus.pop(); }],
    ['wrong focus target', v => { v.reports[1].memberships.review_focus[0].active_element = 'management-title'; }],
    ['missing move screenshot', v => { delete v.reports[2].screenshots['membership-move-review']; }],
    ['premature conflict screenshot', v => { v.reports[2].screenshots['membership-conflict'] = 1; }],
    ['missing native conflict', v => { v.reports[2].api_trace = v.reports[2].api_trace.filter(row => row.path !== '/api/library/catalog/status' || row.response.generation !== 13); }],
    ['incorrectly enabled conflict', v => { v.reports[2].memberships.conflict.disabled = false; }],
    ['wrong conflict reason', v => { v.reports[2].memberships.conflict.reason = 'Undo available'; }],
    ['unrelated song change', v => { v.reports[2].memberships.after_move.rows[2].title = 'Changed unselected song'; }],
    ['duplicate destination lost', v => { const row = v.reports[2].memberships.after_undo.rows.find(row => row.edition_id.startsWith('legacy:') && v.selectedIds.includes(row.edition_id)); row.packs.pop(); row.pack_count--; }],
    ['stale after-move query', v => { v.reports[2].memberships.after_move.generation = 9; }],
    ['invented remove snapshot', v => { v.reports[1].memberships.records.remove_before_restart.preview.effects.removed_membership_snapshots[0].position++; }],
  ];
  for (const [name, mutate] of mutations) { const edited = clone(value); mutate(edited); assert.throws(() => validate(edited), undefined, name); }
  const supplied = allApi(value.reports); supplied.pop(); assert.throws(() => validateCatalogMemberships(value.reports, {...value, allApi: supplied}), /Caller-supplied/);
});

test('journal transition oracle preserves every unrelated byte-valued field and exact Undo metadata', async () => {
  const value = await syntheticMembershipProtocol(), destination = value.records[8].preview.request.action.pack_id, source = value.records[3].preview.request.action.pack_id;
  const existingDestination = value.states[9].inventory.memberships.find(edge => edge.id.pack === destination);
  assert.deepEqual(value.states[10].inventory.memberships.find(edge => edgeKey(edge.id) === edgeKey(existingDestination.id)), existingDestination);
  assert.deepEqual(value.states[11].inventory.memberships.find(edge => edgeKey(edge.id) === edgeKey(existingDestination.id)), existingDestination);
  const originalSource = value.states[5].inventory.memberships.filter(edge => edge.id.pack === source);
  for (const generation of [7, 11]) assert.deepEqual(value.states[generation].inventory.memberships.filter(edge => edge.id.pack === source), originalSource.map(edge => ({...edge, revision: generation})));
  const mutations = [
    ['source provenance', 6, state => { state.inventory.sources[0].retained_bytes++; }],
    ['origin provenance', 7, state => { state.inventory.origins[0].original = 'rewritten'; }],
    ['global song state', 10, state => { state.inventory.songs[0].trashed_by = value.records[10].operation_id; }],
    ['song revision', 10, state => { state.inventory.songs[0].revision = 10; }],
    ['Trash ownership', 11, state => { state.trash[0].restored_by = value.records[11].operation_id; }],
    ['captured source position', 7, state => { state.inventory.memberships.find(edge => edge.id.pack === source).position++; }],
    ['captured source timestamp', 11, state => { state.inventory.memberships.find(edge => edge.id.pack === source).added_at_unix_ms++; }],
    ['existing destination timestamp', 10, state => { state.inventory.memberships.find(edge => edgeKey(edge.id) === edgeKey(existingDestination.id)).added_at_unix_ms++; }],
    ['existing destination revision', 11, state => { state.inventory.memberships.find(edge => edgeKey(edge.id) === edgeKey(existingDestination.id)).revision = 11; }],
    ['destination next free position', 10, state => { state.inventory.memberships.find(edge => edge.id.pack === destination && edge.id.song.startsWith('clean:')).position = 0; }],
    ['source readd next free position', 13, state => { state.inventory.memberships.find(edge => edge.id.pack === source && edge.id.song.startsWith('legacy:')).position = 50; }],
    ['affected pack revision', 12, state => { state.inventory.packs.find(pack => pack.id === source).revision = 11; }],
    ['unaffected imported name', 8, state => { state.inventory.packs.find(pack => pack.kind === 'imported').name = 'Changed'; }],
    ['custom destination source links', 8, state => { state.inventory.packs.find(pack => pack.id === destination).source_archive_keys.push('unrequested'); }],
    ['rewritten receipt', 13, state => { state.receipts[0].preview.request.at_unix_ms++; }],
    ['pruned history', 13, state => { state.receipts.shift(); }],
  ];
  for (const [name, generation, mutate] of mutations) { const state = clone(value.states[generation]); mutate(state); assert.throws(() => validateMembershipJournalState(state, value.states[generation - 1], value.records[generation], generation, value.records), undefined, name); }
  const forged = clone(value); forged.records[6].preview.effects.removed_membership_snapshots[0].position++; forged.states[6].receipts.at(-1).preview = clone(forged.records[6].preview);
  assert.throws(() => validateMembershipJournalState(forged.states[6], forged.states[5], forged.records[6], 6, forged.records), /exact previous-state/);
  const prior = clone(value.states[10]); prior.inventory.memberships.find(edge => edgeKey(edge.id) === edgeKey(existingDestination.id)).revision = 999;
  assert.throws(() => validateMembershipJournalState(value.states[11], prior, value.records[11], 11, value.records));
  // The source graph is absent again after the move, but the saved removal was
  // already undone at g7. Matching graph shape cannot erase that durable history.
  const repeated = clone(value.records[7]), repeatedRecords = clone(value.records);
  repeated.operation_id = value.records[11].operation_id; repeated.preview.request.operation_id = repeated.operation_id;
  repeated.preview.request.expected_generation = 10; repeated.preview.next_generation = 11; repeatedRecords[11] = repeated;
  assert.throws(() => validateMembershipJournalState(value.states[11], value.states[10], repeated, 11, repeatedRecords), /already undone/);
});
