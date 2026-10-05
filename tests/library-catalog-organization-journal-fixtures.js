// Deterministic, synthetic organization states extending the recorded ORIGINAL
// generation-0..2 journal. This exercises the evidence verifier, not acceptance.
import {mkdir, readFile, writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {catalogSha256 as sha256} from '../scripts/prepare-library-catalog-acceptance.mjs';

export async function organizationJournalFixture(directory, mutate = () => {}) {
  const original = JSON.parse(await readFile(new URL('./fixtures/library-catalog/original-native-journal.json', import.meta.url))), records = [], states = [];
  for (let generation = 0; generation < 3; generation++) {
    const prefix = `/commits/${String(generation).padStart(20, '0')}-`, files = original.files.filter(row => row.path.includes(prefix));
    const receipt = JSON.parse(files.find(row => row.path.endsWith('/receipt.json')).utf8);
    states.push(JSON.parse(files.find(row => row.path.endsWith('/state.json')).utf8));
    records.push({operation_id: receipt.operation_id || receipt.receipt.preview.request.operation_id, ...(receipt.receipt || {})});
  }
  const target = `collection-${sha256('original synthetic journal custom pack').slice(0, 32)}`, selected = [...records[1].preview.request.action.song_ids];
  for (let generation = 3; generation < 6; generation++) {
    const before = states.at(-1), state = structuredClone(before), kind = ['create_pack', 'rename_pack', 'add_memberships'][generation - 3];
    const action = {type: kind, pack_id: target, ...(generation === 5 ? {song_ids: selected} : {name: generation === 3 ? 'r' : 'rr'})};
    const request = {schema_version: 1, operation_id: `operation-${sha256(`original synthetic ${kind}`).slice(0, 32)}`, expected_generation: generation - 1, at_unix_ms: 1791143965000 + generation, action};
    const effects = Object.fromEntries(Object.entries(records[2].preview.effects).map(([key, value]) => [key, Array.isArray(value) ? [] : value]));
    effects.affected_packs = [target];
    effects[generation === 3 ? 'created_packs' : generation === 4 ? 'renamed_packs' : 'added_memberships'] = generation === 5 ? selected.map(song => ({pack: target, song})) : [target];
    const preview = {request, request_digest: sha256(JSON.stringify(request)), base_digest: sha256(JSON.stringify(before)), next_generation: generation, effects, plan_digest: sha256(JSON.stringify(effects))};
    const record = {operation_id: request.operation_id, preview}; records.push(record);
    state.generation = generation; state.receipts.push({preview: structuredClone(preview)});
    if (generation === 3) state.inventory.packs.push({id: target, name: 'r', kind: 'custom', source_archive_keys: [], origin_import_operation_id: null, revision: 3, trashed_by: null});
    else { const pack = state.inventory.packs.find(row => row.id === target); pack.revision = generation; if (generation === 4) pack.name = 'rr'; }
    if (generation === 5) for (const [position, song] of selected.entries()) state.inventory.memberships.push({id: {pack: target, song}, position, added_at_unix_ms: request.at_unix_ms, revision: 5});
    state.inventory.packs.sort((a, b) => a.id.localeCompare(b.id)); state.inventory.memberships.sort((a, b) => a.id.pack.localeCompare(b.id.pack) || a.id.song.localeCompare(b.id.song));
    states.push(state);
  }
  mutate({records, states, target, selected});
  const operations = Object.fromEntries(['initialize', 'trash', 'restore', 'create', 'rename', 'add'].map((key, i) => [key, records[i]])); operations.allApi = [];
  const rows = []; let previous = null, genesis;
  const write = async (path, bytes) => { await mkdir(join(directory, path.slice(0, path.lastIndexOf('/'))), {recursive: true}); await writeFile(join(directory, path), bytes); rows.push({path, bytes: Buffer.byteLength(bytes), sha256: sha256(bytes)}); };
  for (const [generation, state] of states.entries()) {
    const record = records[generation], stateBytes = JSON.stringify(state), receiptBytes = JSON.stringify(generation ? {kind: 'transition', receipt: {preview: record.preview}} : {kind: 'bootstrap', operation_id: record.operation_id, state_sha256: sha256(stateBytes)});
    const manifest = JSON.stringify({version: 1, generation, operation_id: record.operation_id, previous_manifest_sha256: previous, state: {bytes: Buffer.byteLength(stateBytes), sha256: sha256(stateBytes)}, receipt: {bytes: Buffer.byteLength(receiptBytes), sha256: sha256(receiptBytes)}});
    for (const area of ['catalog', 'catalog-backups']) for (const [name, bytes] of [['state', stateBytes], ['receipt', receiptBytes], ['manifest', manifest]]) await write(`${area}/commits/${String(generation).padStart(20, '0')}-${record.operation_id}/${name}.json`, bytes);
    previous = sha256(manifest); if (!generation) genesis = previous;
    operations.allApi.push({response: {operation_id: record.operation_id, outcome: 'committed', generation, catalog_digest: sha256(stateBytes)}});
  }
  for (const area of ['catalog', 'catalog-backups']) await write(`${area}/format.json`, JSON.stringify({version: 1, genesis_manifest_sha256: genesis}));
  return {rows, operations, target};
}
