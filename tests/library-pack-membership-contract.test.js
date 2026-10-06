import test from 'node:test';
import assert from 'node:assert/strict';
import {catalogPreviewRequest, checkedCatalogStatus, checkedCatalogPreview, checkedCatalogResult, checkedRecoveryRecord} from '../web/library-catalog-contract.js';
import {openScoreStorage} from '../web/native-score-storage.js';
import {membershipPackServer, seedMemberships} from './library-pack-membership-fixtures.js';
import {customPackId} from './library-user-pack-fixtures.js';
const source = customPackId(0), destination = customPackId(1);
const invalid = callback => assert.throws(callback, {code: 'catalog_invalid_response'});
const changed = (value, mutate) => { const copy = structuredClone(value); mutate(copy); return copy; };
async function fixture() {
  const server = await membershipPackServer(); seedMemberships(server);
  const adapter = await openScoreStorage({origin: 'https://wmh.localhost', fetcher: server.fetcher});
  const request = action => { const status = server.status(); return {action, edition_ids: action === 'undo_memberships' ? [] : server.rows.slice(0, 2).map(row => row.edition_id), ...(action === 'undo_memberships' ? {membership_operation_id: status.membership_undo.operation_id} : {collection_id: source}), ...(action === 'move_memberships' ? {destination_collection_id: destination} : {}), library_id: status.library_id, expected_generation: status.generation, catalog_digest: status.catalog_digest}; };
  return {server, adapter, request};
}
const record = (request, value) => ({kind: request.action, library_id: request.library_id, operation_id: value.preview.request.operation_id, phase: 'submitted', preview: value.preview, summary: value.summary, selected: (request.action === 'undo_memberships' ? value.summary.selected_edition_ids : request.edition_ids).map(edition_id => ({edition_id, title: 'Original authored edition'}))});

test('membership wire requests admit one exact scope, preserve old omissions and reject ambiguous inverse inputs', async () => {
  const {adapter, request} = await fixture();
  try {
    for (const action of ['remove_memberships', 'move_memberships']) {
      const body = request(action); assert.deepEqual(catalogPreviewRequest(body), body);
      for (const change of [v => { v.edition_ids = []; }, v => { v.collection_id = null; }, v => { v.name = 'Unreviewed rename'; }, v => { v.membership_operation_id = `operation-${'a'.repeat(32)}`; }, v => { v.edition_ids.push(v.edition_ids[0]); }]) invalid(() => catalogPreviewRequest(changed(body, change)));
    }
    invalid(() => catalogPreviewRequest({...request('remove_memberships'), destination_collection_id: destination}));
    invalid(() => catalogPreviewRequest(changed(request('move_memberships'), value => { delete value.destination_collection_id; })));
    const removal = request('remove_memberships'), value = await adapter.previewCatalog(removal); await adapter.commitCatalog(record(removal, value));
    const undo = request('undo_memberships'); assert.deepEqual(catalogPreviewRequest(undo), undo);
    for (const change of [v => { v.edition_ids = removal.edition_ids; }, v => { v.collection_id = source; }, v => { v.destination_collection_id = destination; }, v => { v.membership_operation_id = ''; }, v => { v.trash_operation_id = v.membership_operation_id; }]) invalid(() => catalogPreviewRequest(changed(undo, change)));
  } finally { adapter.close(); }
});

test('remove and move preview validators account for every selected edge and preserve bounded inverse evidence', async () => {
  const {adapter, request} = await fixture();
  try {
    for (const action of ['remove_memberships', 'move_memberships']) {
      const body = request(action), value = await adapter.previewCatalog(body);
      assert.equal(checkedCatalogPreview(value, body), value); assert.ok(value.preview.effects.removed_membership_snapshots.length);
      for (const change of [
        v => { v.preview.effects.removed_memberships[0].pack = destination; },
        v => { v.preview.effects.removed_memberships.pop(); },
        v => { v.preview.effects.trashed_songs = [body.edition_ids[0]]; },
        v => { v.preview.effects.reclaimed_bytes = 1; },
        v => { v.summary.source_pack.kind = 'imported'; },
        v => { v.summary.selected_count++; },
        v => { v.summary.shared_song_count = 3; },
        v => { v.summary.noop_membership_count++; },
        v => { v.summary.undo_operation_id = `operation-${'1'.repeat(32)}`; },
        v => { delete v.preview.effects.removed_membership_snapshots; },
        v => { v.preview.effects.removed_membership_snapshots[0].id.pack = destination; },
        v => { v.preview.effects.removed_membership_snapshots[0].position = -1; },
        v => { v.preview.effects.removed_membership_snapshots[0].position = 0x100000000; },
        v => { v.preview.effects.removed_membership_snapshots[0].revision = body.expected_generation + 1; },
        v => { v.preview.effects.removed_membership_snapshots[0].unreviewed = true; },
      ]) invalid(() => checkedCatalogPreview(changed(value, change), body));
      if (action === 'move_memberships') for (const change of [v => { v.preview.effects.noops = []; }, v => { v.preview.effects.added_memberships[0].pack = source; }, v => { v.summary.destination_pack.collection_id = source; }, v => { v.summary.target_pack = v.summary.source_pack; }]) invalid(() => checkedCatalogPreview(changed(value, change), body));
      else invalid(() => checkedCatalogPreview(changed(value, v => { v.summary.destination_pack = v.summary.source_pack; }), body));
    }
  } finally { adapter.close(); }
});

test('Undo wire, recovery pointers and lookup bind the original edit, new operation and exact inverse effects', async () => {
  const {adapter, request, server} = await fixture();
  try {
    const body = request('move_memberships'), moved = await adapter.previewCatalog(body), saved = record(body, moved); await adapter.commitCatalog(saved);
    const undoBody = request('undo_memberships'), value = await adapter.previewCatalog(undoBody), pointer = record(undoBody, value);
    assert.equal(checkedRecoveryRecord(pointer, body.library_id), pointer); assert.equal(value.preview.effects.added_memberships.length, 2); assert.equal(value.preview.effects.removed_memberships.length, 1);
    for (const change of [v => { v.preview.request.action.membership_operation_id = pointer.operation_id; }, v => { v.summary.membership_operation_id = pointer.operation_id; }, v => { v.summary.selected_edition_ids.reverse(); v.summary.selected_edition_ids.pop(); }, v => { v.preview.effects.added_memberships.pop(); }, v => { v.preview.effects.removed_memberships[0].pack = source; }, v => { v.summary.target_pack = v.summary.destination_pack; }, v => { v.preview.effects.removed_membership_snapshots = []; }]) invalid(() => checkedCatalogPreview(changed(value, change), undoBody));
    invalid(() => checkedRecoveryRecord(changed(pointer, v => { v.selected.pop(); }), body.library_id));
    const result = await adapter.commitCatalog(pointer); assert.equal(checkedCatalogResult(result, pointer), result); assert.equal(checkedCatalogResult(await adapter.catalogOperation(pointer), pointer, {lookup: true}).operation_id, pointer.operation_id);
    invalid(() => checkedCatalogResult(changed(result, v => { v.receipt.preview.effects.added_memberships.pop(); }), pointer));
    assert.equal(server.history.size, 2); assert.equal(server.status().membership_undo, null);
  } finally { adapter.close(); }
});

test('native Undo discovery validates typed references and refuses missing or fabricated candidates', async () => {
  const {adapter, request, server} = await fixture();
  try {
    assert.equal(checkedCatalogStatus(server.status()).membership_undo, null);
    invalid(() => checkedCatalogStatus(changed(server.status(), v => { delete v.membership_undo; })));
    const body = request('remove_memberships'), preview = await adapter.previewCatalog(body); await adapter.commitCatalog(record(body, preview)); const status = server.status();
    assert.equal(checkedCatalogStatus(status), status);
    for (const change of [v => { v.membership_undo.operation_id = 'unknown'; }, v => { v.membership_undo.selected_count = 0; }, v => { v.membership_undo.can_undo = 'yes'; }, v => { v.membership_undo.source_pack.kind = 'imported'; }, v => { v.membership_undo.destination_pack = v.membership_undo.source_pack; }, v => { v.membership_undo.unreviewed = true; }]) invalid(() => checkedCatalogStatus(changed(status, change)));
  } finally { adapter.close(); }
});

test('unchanged removal and same-pack move account for every noop without advertising an Undo', async () => {
  const {adapter, request, server} = await fixture();
  try {
    const missing = {...request('remove_memberships'), collection_id: destination, edition_ids: [server.rows[1].edition_id]}, removal = await adapter.previewCatalog(missing);
    assert.equal(removal.preview.effects.removed_memberships.length, 0); assert.equal(removal.summary.noop_membership_count, 1); assert.equal(removal.summary.undo_operation_id, null);
    const same = {...request('move_memberships'), destination_collection_id: source}, move = await adapter.previewCatalog(same);
    assert.equal(move.preview.effects.removed_memberships.length, 0); assert.equal(move.summary.noop_membership_count, 2); assert.equal(move.summary.undo_operation_id, null);
  } finally { adapter.close(); }
});
