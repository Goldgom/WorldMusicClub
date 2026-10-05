// Synthetic protocol/artifact tests only: no browser, native process or Windows acceptance is claimed.
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, mkdir, readFile, readdir, rm, symlink, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {deflateSync} from 'node:zlib';
import {execFileSync} from 'node:child_process';
import {authoredLegacyPack, STREAMING_ZIP_SCRIPT} from './native-import-driver-fixtures.js';
import {authoredCleanPackage} from './clean-song-package-fixtures.js';
import {catalogServer} from './library-catalog-fixtures.js';
import {inspectOriginalManagementZip} from '../scripts/pack-management-acceptance-fixtures.mjs';
import {CATALOG_ACCEPTANCE_PHASES, originalCatalogAcceptanceFixtures, prepareLibraryCatalogFixtures, catalogSha256 as sha256} from '../scripts/prepare-library-catalog-acceptance.mjs';
import {CATALOG_SOURCE_FILES, CATALOG_REQUIRED_CHECKS, CATALOG_SCREENSHOTS, readCatalogEvidenceFile, validateCatalogSourceBinding, validateCatalogScreenshot, validateCatalogApiEvidence, validateCatalogHostApiTrace, validateCatalogRetainedSnapshots, catalogLibraryInventory, validateCatalogProtocolPhases, validateCatalogJournal} from '../scripts/verify-library-catalog-acceptance.mjs';

const owned = async t => { const directory = await mkdtemp(join(tmpdir(), 'wmc-catalog-evidence-unit-')); t.after(() => rm(directory, {recursive: true, force: true})); return directory; };
const digestRow = (path, text) => ({path, bytes: Buffer.byteLength(text), sha256: sha256(text)});
const sourceBinding = () => ({source_sha: 'a'.repeat(40), source_tree: 'b'.repeat(40), source_hashes: Object.fromEntries(CATALOG_SOURCE_FILES.map(file => [file, sha256(`protocol-only ${file}`)]))});

test('catalog acceptance inputs are exactly three deterministic ORIGINAL archives with real shared identity and media', () => {
  const first = originalCatalogAcceptanceFixtures(), second = originalCatalogAcceptanceFixtures();
  assert.deepEqual(first.manifest, second.manifest); assert.equal(first.inputs.length, 3);
  assert.deepEqual(first.legacy.bytes, authoredLegacyPack().bytes); assert.deepEqual(first.clean.bytes, authoredCleanPackage({long: false, media: true}).bytes);
  assert.deepEqual(first.inputs.map(row => row.sha256), ['416538f8641f744bf5c7f1eb1ed969a6545f74f7e0fbbfcfecebe5324eb88916', 'bf354836336df5d4dbaef4cf2de66ca0faf04160098f1a8cf18de3e1f0d6be89', '559e958aeacc43c5a124a1c92eb3106f75b5e5d666a6885a086aca8b7fd35256']);
  const shared = inspectOriginalManagementZip(first.shared.bytes);
  assert.deepEqual(Object.keys(shared).sort(), ['original-note.txt', 'same-original.json']); assert.equal(shared['same-original.json'].sha256, sha256(JSON.stringify(authoredLegacyPack().scores[0])));
  assert.equal(first.spec.clean_media.length, 3); assert.equal(first.spec.expected.initial.memberships, 4); assert.equal(first.spec.expected.trashed.memberships, 1); assert.equal(first.spec.expected.restored.memberships, 4);
  assert.equal(first.manifest.private_music, false); assert.equal(first.manifest.rights.license, 'CC0-1.0');
});

test('catalog fixture preparation requires a fresh directory and preserves exact input hashes', async t => {
  const root = await owned(t), directory = join(root, 'fresh'); const manifest = await prepareLibraryCatalogFixtures(directory);
  assert.equal((await readdir(directory)).length, 4); assert.deepEqual(JSON.parse(await readFile(join(directory, 'catalog-fixtures.json'))), manifest);
  for (const row of manifest.inputs) { const bytes = await readFile(join(directory, row.filename)); assert.equal(bytes.length, row.bytes); assert.equal(sha256(bytes), row.sha256); }
  await assert.rejects(prepareLibraryCatalogFixtures(directory), /fresh empty/);
});

test('original streaming ZIP bytes are independent of the host ZipInfo platform default', () => {
  const original = authoredLegacyPack();
  const input = JSON.stringify(original.entries.map(([name, value]) => [name, Buffer.from(value).toString('base64')]));
  const python = process.platform === 'win32' ? 'python' : 'python3';
  const run = (host, script = STREAMING_ZIP_SCRIPT) => {
    const preamble = `import zipfile\noriginal_init=zipfile.ZipInfo.__init__\ndef simulated_init(self,*args,**kwargs):\n original_init(self,*args,**kwargs)\n self.create_system=${host}\nzipfile.ZipInfo.__init__=simulated_init\n`;
    return execFileSync(python, ['-c', preamble + script], {input, maxBuffer: 1024 * 1024, timeout: 5000});
  };
  for (const host of [0, 3]) assert.deepEqual(run(host), original.bytes);
  // A real regression control: implicit Windows metadata reproduces the exact
  // first-run failure while every authored member stays byte-identical.
  const implicitWindows = run(0, STREAMING_ZIP_SCRIPT.replace('info.create_system=3;', ''));
  assert.equal(sha256(implicitWindows), '09f2c31c8f45022dcb37d614f9da977ce4f7d9234d0ed5aa45ceb48d7b971d98');
  assert.notDeepEqual(implicitWindows, original.bytes);
  assert.deepEqual(inspectOriginalManagementZip(implicitWindows), inspectOriginalManagementZip(original.bytes));
});

test('source binding rejects old, unbound and independently changed evidence', () => {
  const expected = sourceBinding(); assert.doesNotThrow(() => validateCatalogSourceBinding(expected, expected));
  for (const edit of [v => delete v.source_hashes, v => v.source_sha = 'c'.repeat(40), v => v.source_tree = 'c'.repeat(40), v => delete v.source_hashes[CATALOG_SOURCE_FILES[0]], v => v.source_hashes[CATALOG_SOURCE_FILES[1]] = sha256('changed module')]) {
    const value = structuredClone(expected); edit(value); assert.throws(() => validateCatalogSourceBinding(value, expected));
  }
  assert.throws(() => validateCatalogSourceBinding({ok: true, browser: false}, expected));
});

function apiRow(request = {view: 'active'}, response = {test_only: true}) {
  const request_text = JSON.stringify(request), response_text = JSON.stringify(response);
  return {sequence: 1, dispatch_order: 1, source: 'probe', path: '/api/library/list', method: 'POST', request, request_text, request_sha256: sha256(request_text), dispatched: true, status: 200, response, response_text, response_sha256: sha256(response_text), delivery: 'forwarded'};
}
test('API evidence binds actual raw request/response bodies and never invents a response for an undispatched write', () => {
  const row = apiRow(); assert.equal(validateCatalogApiEvidence([row]).length, 1);
  for (const edit of [r => r.sequence++, r => r.response.test_only = false, r => r.response_text += ' ', r => r.request.view = 'trash', r => r.request_sha256 = sha256('changed'), r => r.dispatched = false, r => r.delivery = 'mock']) {
    const changed = structuredClone(row); edit(changed); assert.throws(() => validateCatalogApiEvidence([changed]));
  }
  const lost = {...row, path: '/api/library/catalog/commit', delivery: 'lost-before-native', dispatched: false, status: null, response: null, response_text: null, response_sha256: null};
  delete lost.dispatch_order;
  assert.doesNotThrow(() => validateCatalogApiEvidence([lost])); assert.throws(() => validateCatalogApiEvidence([{...lost, response: {outcome: 'committed'}}]));
  const binary = {...row, request: null, request_text: null, request_base64: Buffer.from('original').toString('base64'), request_sha256: sha256('original')};
  assert.doesNotThrow(() => validateCatalogApiEvidence([binary])); assert.throws(() => validateCatalogApiEvidence([{...binary, request_base64: binary.request_base64 + '!'}]));
});

test('independent host dispatch trace detects missing/invented calls and preserves real asynchronous dispatch order', () => {
  const first = apiRow({id: 'first'}), second = {...apiRow({id: 'second'}), sequence: 2}; first.dispatch_order = 2; second.dispatch_order = 1;
  const host = [second, first].map((row, index) => ({sequence: index + 1, path: row.path, method: row.method, status: row.status, request_bytes: Buffer.byteLength(row.request_text), request_sha256: row.request_sha256, response_bytes: Buffer.byteLength(row.response_text), response_sha256: row.response_sha256, response_file: `api/test-${index + 1}.json`}));
  assert.equal(validateCatalogHostApiTrace(host, [first, second]), 2);
  for (const changed of [host.slice(1), [...host, {...host[0], sequence: 3}], host.map((row, index) => index ? row : {...row, request_sha256: sha256('other dispatched request')}), host.map((row, index) => index ? row : {...row, response_sha256: sha256('synthetic native reply')})]) assert.throws(() => validateCatalogHostApiTrace(changed, [first, second]));
});

test('retained snapshots allow only new mirrored duplicate receipts and exact catalog journal paths', () => {
  const before = [digestRow('songs/song-original/history/rev-1.json', 'history'), digestRow('clean-songs/song-original/package/media/pv.webm', 'media'), digestRow('imports/pack-original/source.bin', 'original')];
  const receipt = `imports/pack-${sha256('original')}/report-2.json`, backup = receipt.replace('imports/', 'import-backups/');
  const after = [...before, digestRow(receipt, 'receipt'), digestRow(backup, 'receipt'), digestRow('catalog/format.json', 'format')];
  assert.equal(validateCatalogRetainedSnapshots(before, after, {allowNewReceipts: true}).retained_files, 3);
  assert.throws(() => validateCatalogRetainedSnapshots(before, after));
  for (const changed of [after.slice(1), [...after, digestRow('songs/new/score.json', 'new')], after.map(row => row.path === backup ? {...row, sha256: sha256('wrong backup')} : row), after.map(row => row.path === before[0].path ? {...row, sha256: sha256('lost history')} : row), [...after, digestRow('catalog/not-a-generation.json', 'other')]]) assert.throws(() => validateCatalogRetainedSnapshots(before, changed, {allowNewReceipts: true}));
});

test('bounded evidence reads and inventories reject path aliases and symlinks, excluding only root library lock', async t => {
  const root = await owned(t); await mkdir(join(root, 'songs')); await writeFile(join(root, 'songs', 'score.json'), 'original'); await writeFile(join(root, '.library.lock'), '');
  assert.deepEqual(await catalogLibraryInventory(root), [digestRow('songs/score.json', 'original')]);
  for (const path of ['../outside', '/absolute', 'songs/../.library.lock', 'songs\\score.json']) await assert.rejects(readCatalogEvidenceFile(root, path));
  await assert.rejects(readCatalogEvidenceFile(root, 'songs/score.json', 2));
  await symlink(join(root, 'songs'), join(root, 'linked')); await assert.rejects(catalogLibraryInventory(root), /Linked/); await assert.rejects(readCatalogEvidenceFile(root, 'linked/score.json'), /Linked/);
});

function syntheticPngFormatFixture(width = 1280, height = 720) {
  const crc = bytes => { let n = 0xffffffff; for (const b of bytes) { n ^= b; for (let bit = 0; bit < 8; bit++) n = n >>> 1 ^ ((n & 1) ? 0xedb88320 : 0); } return (n ^ 0xffffffff) >>> 0; };
  const chunk = (name, bytes) => { const header = Buffer.alloc(8), tail = Buffer.alloc(4); header.writeUInt32BE(bytes.length); header.write(name, 4); tail.writeUInt32BE(crc(Buffer.concat([Buffer.from(name), bytes]))); return Buffer.concat([header, bytes, tail]); };
  const header = Buffer.alloc(13); header.writeUInt32BE(width); header.writeUInt32BE(height, 4); header[8] = 8; header[9] = 2;
  const pixels = Buffer.alloc((width * 3 + 1) * height); for (let y = 0; y < height; y++) for (let x = 0; x < width * 3; x++) pixels[y * (width * 3 + 1) + x + 1] = (x * y + x + y) % 256;
  return Buffer.concat([Buffer.from('89504e470d0a1a0a', 'hex'), chunk('IHDR', header), chunk('IDAT', deflateSync(pixels)), chunk('IEND', Buffer.alloc(0))]);
}
test('synthetic in-memory PNG format fixtures exercise dimensions, CRC, pixels and external hash without screenshot claims', () => {
  const bytes = syntheticPngFormatFixture(), row = {bytes: bytes.length, sha256: sha256(bytes), locale: 'zh-CN'};
  assert.equal(validateCatalogScreenshot(bytes, row).width, 1280);
  for (const value of [Buffer.from('not a PNG'), bytes.subarray(0, -4), syntheticPngFormatFixture(1024, 768)]) assert.throws(() => validateCatalogScreenshot(value, {...row, bytes: value.length, sha256: sha256(value)}));
  const corrupted = Buffer.from(bytes); corrupted[100] ^= 1; assert.throws(() => validateCatalogScreenshot(corrupted, {...row, sha256: sha256(corrupted)}));
  assert.throws(() => validateCatalogScreenshot(bytes, {...row, sha256: sha256('wrong')})); assert.throws(() => validateCatalogScreenshot(bytes, {...row, locale: 'en'}));
});

/** Generate protocol values through the isolated in-memory contract fixture, never a host/browser report. */
async function protocol() {
  const fixture = originalCatalogAcceptanceFixtures(), binding = sourceBinding(), runId = 'protocol-only-catalog-contract';
  const server = await catalogServer({initialized: false});
  const packs = fixture.inputs.map(input => ({collection_id: `collection-${input.sha256.slice(0, 32)}`, import_pack_id: input.pack_id, name: input.filename}));
  for (const [index, row] of server.rows.entries()) {
    row.score_id = index === 0 ? fixture.spec.legacy_ids[0] : index === 1 ? fixture.spec.clean_id : fixture.spec.legacy_ids[1];
    row.packs = index === 0 ? packs.slice(0, 2) : [packs[index === 1 ? 2 : 0]]; row.pack_count = row.packs.length;
  }
  const reports = CATALOG_ACCEPTANCE_PHASES.map(phase => ({version: 1, scenario: 'library-catalog', phase, ok: true, run_id: runId, origin: 'https://wmh.localhost', layout: {width: 1280, height: 720, locale: 'zh-CN'}, source_binding: binding, errors: [], opened_score_databases: [], claims: {synthetic_clock: false, mock_success: false, private_music: false}, checks: [...CATALOG_REQUIRED_CHECKS[phase]], actions: [{sequence: 1, kind: 'click', control: 'protocol-only', trusted_clicks: 1, untrusted_clicks: 0, trusted_key_downs: 0, trusted_key_ups: 0, completed: true}], screenshots: Object.fromEntries(CATALOG_SCREENSHOTS[phase].map(name => [name, 1])), profile: {marker_before: phase === 'catalog-seed' ? null : runId, recovery_before_open: null}, api_trace: [], catalog: {}, operations: {}}));
  let current = reports[0];
  const call = async (path, request, extra = {}) => {
    const request_text = request ? JSON.stringify(request) : '', row = {sequence: current.api_trace.length + 1, source: 'probe', path, method: request ? 'POST' : 'GET', request: request || null, request_text, request_sha256: sha256(request_text), dispatched: true, delivery: 'forwarded', ...extra}; current.api_trace.push(row);
    if (row.delivery === 'lost-before-native') { Object.assign(row, {dispatched: false, status: null, response: null, response_text: null, response_sha256: null}); return; }
    const result = await server.fetcher(path, request ? {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(row.wire_request || request)} : {}), response_text = JSON.stringify(await result.json()); Object.assign(row, {status: result.status, response_text, response_sha256: sha256(response_text), response: JSON.parse(response_text)}); return structuredClone(row.response);
  };
  const query = view => call('/api/library/catalog/query', {view, limit: 100, refresh: true});
  const imported = (input, repeat = false) => {
    const response = {source: {sha256: input.sha256, bytes: input.bytes.length}, summary: {[repeat || input.role === 'shared' ? 'duplicate' : 'saved']: input.role === 'legacy' ? 2 : 1}};
    current.api_trace.push({...apiRow(null, response), sequence: current.api_trace.length + 1, path: '/api/library/import/commit', request: null, request_text: null, request_base64: input.bytes.toString('base64'), request_sha256: input.sha256});
  };
  fixture.inputs.forEach(input => imported(input));
  await call('/api/library/catalog/initialize/preview', {}); const initialPreview = await call('/api/library/catalog/initialize/preview', {});
  const initialize = {kind: 'initialize', library_id: initialPreview.library_id, operation_id: initialPreview.preview.operation_id, preview: initialPreview.preview, selected: [], phase: 'committed'};
  await call('/api/library/catalog/initialize', {library_id: initialize.library_id, preview: initialize.preview}); reports[0].operations.initialize = initialize;
  const initial = await query('active'); reports[0].catalog.initialized = initial; const selected = initial.rows.filter(row => fixture.spec.selected_score_ids.includes(row.score_id));
  const previewRequest = {action: 'trash_songs', edition_ids: selected.map(row => row.edition_id), trash_operation_id: null, expected_generation: initial.generation, catalog_digest: initial.catalog_digest, library_id: initial.library_id};
  const trashPreview = await call('/api/library/catalog/preview', previewRequest), trash = {kind: 'trash_songs', library_id: initial.library_id, operation_id: trashPreview.preview.request.operation_id, preview: trashPreview.preview, summary: trashPreview.summary, selected: selected.map(({edition_id, title}) => ({edition_id, title})), phase: 'uncertain'};
  await call('/api/library/catalog/commit', {library_id: initial.library_id, preview: trash.preview}, {delivery: 'lost-after-native'});
  const request = {library_id: initial.library_id, operation_id: trash.operation_id}, wire_request = {...request, operation_id: initialize.operation_id}, wire_request_text = JSON.stringify(wire_request);
  await call('/api/library/catalog/operation', request, {delivery: 'wrong-operation-read', wire_request, wire_request_text, wire_request_sha256: sha256(wire_request_text)});
  reports[0].operations.trash = trash; reports[0].catalog.active = await query('active'); reports[0].catalog.trash = await query('trash');
  current = reports[1]; current.profile.recovery_before_open = structuredClone(trash); await call('/api/library/catalog/operation', request); current.profile.recovery_after_open = {...trash, phase: 'committed'};
  imported(fixture.legacy, true); imported(fixture.clean, true); current.catalog.trashed = await query('trash');
  const restorePreview = await call('/api/library/catalog/preview', {...previewRequest, action: 'restore_songs', expected_generation: current.catalog.trashed.generation, catalog_digest: current.catalog.trashed.catalog_digest, trash_operation_id: trash.operation_id});
  const restore = {...trash, kind: 'restore_songs', operation_id: restorePreview.preview.request.operation_id, preview: restorePreview.preview, summary: restorePreview.summary, phase: 'committed'}, restoreRequest = {library_id: initial.library_id, preview: restore.preview};
  await call('/api/library/catalog/commit', restoreRequest, {delivery: 'lost-before-native'}); await call('/api/library/catalog/operation', {library_id: initial.library_id, operation_id: restore.operation_id}); await call('/api/library/catalog/commit', restoreRequest);
  current.actions = ['management-catalog-trash', 'management-close', 'library-management-button', 'management-catalog-active'].map((control, index) => ({...current.actions[0], sequence: index + 1, control}));
  await call('/api/library/catalog/query', {view: 'trash', limit: 100}, {delivery: 'deferred-read', delivery_complete: true, dispatch_event: 1, response_event: 2, release_event: 5, action_sequence: 1}); const held_sequence = current.api_trace.at(-1).sequence;
  const latest = await call('/api/library/catalog/query', {view: 'active', limit: 100}, {dispatch_event: 3, response_event: 4, action_sequence: 4});
  const stable = {view: 'active', edition_ids: latest.rows.map(row => row.edition_id), operation_id: restore.operation_id};
  current.stale_ownership = {held_sequence, latest_active_sequence: current.api_trace.at(-1).sequence, close_action: 2, reopen_action: 3, before: stable, after: structuredClone(stable)};
  current.operations.restore = restore; current.catalog.active = await query('active'); current.catalog.trash = await query('trash');
  current = reports[2]; current.profile.recovery_before_open = structuredClone(restore); current.profile.recovery_after_open = structuredClone(restore); await call('/api/library/catalog/operation', {library_id: initial.library_id, operation_id: restore.operation_id}); current.catalog.active = await query('active'); current.catalog.trash = await query('trash');
  for (const report of reports) { let order = 0; for (const row of report.api_trace) if (row.dispatched) row.dispatch_order = ++order; }
  return {reports, options: {sourceBinding: binding, runId, fixture}};
}

test('three-phase protocol oracle independently checks exact ownership, lost responses, retry bytes and memberships', async () => {
  const {reports, options} = await protocol(); const proof = validateCatalogProtocolPhases(reports, options);
  assert.equal(proof.selectedIds.length, 2); assert.equal(proof.imports.length, 5);
  for (const edit of [
    v => v.reverse(), v => v[1].profile.marker_before = null, v => v[1].profile.recovery_before_open.phase = 'committed',
    v => v[0].actions[0].trusted_clicks = 0, v => v[0].actions[0].untrusted_clicks = 1, v => delete v[0].source_binding,
    v => v[0].catalog.active.counts.memberships = 4, v => v[1].catalog.trashed.rows[0].trashed_by = v[1].operations.restore.operation_id,
    v => v[1].api_trace.find(row => row.delivery === 'lost-before-native').request.preview.request.operation_id = 'operation-' + 'f'.repeat(32),
    v => v[0].api_trace.find(row => row.delivery === 'wrong-operation-read').response.operation_id = v[0].operations.trash.operation_id,
    v => v[2].profile.recovery_after_open.operation_id = v[0].operations.trash.operation_id,
    v => delete v[1].stale_ownership, v => v[1].api_trace.find(row => row.delivery === 'deferred-read').release_event = 1,
    v => v[1].stale_ownership.after.edition_ids.pop(), v => v[1].stale_ownership.reopen_action = v[1].stale_ownership.close_action,
  ]) { const changed = structuredClone(reports); edit(changed); assert.throws(() => validateCatalogProtocolPhases(changed, options)); }
});

test('actual ORIGINAL prior-runtime journal replay verifies both copies, generations, effects and API state digests', async t => {
  const directory = await owned(t), fixture = JSON.parse(await readFile(new URL('./fixtures/library-catalog/original-native-journal.json', import.meta.url)));
  assert.equal(fixture.provenance.browser, false); assert.equal(fixture.provenance.native_window, false);
  assert.equal(fixture.provenance.source_sha, '0d696cfc732b1d333893b838c1d861ede1e82535');
  const operations = {allApi: []}, rows = [];
  for (const source of fixture.files) {
    for (const path of [source.path, source.path.replace(/^catalog\//, 'catalog-backups/')]) {
      await mkdir(join(directory, path.slice(0, path.lastIndexOf('/'))), {recursive: true}); await writeFile(join(directory, path), source.utf8); rows.push(digestRow(path, source.utf8));
    }
    if (source.path.endsWith('/receipt.json')) {
      const receipt = JSON.parse(source.utf8), generation = Number(source.path.split('/')[2].slice(0, 20));
      operations[['initialize', 'trash', 'restore'][generation]] = {operation_id: receipt.operation_id || receipt.receipt.preview.request.operation_id, ...(receipt.receipt || {})};
    }
  }
  for (const [generation, key] of ['initialize', 'trash', 'restore'].entries()) {
    const state = fixture.files.find(row => row.path.includes(`/${String(generation).padStart(20, '0')}-`) && row.path.endsWith('/state.json'));
    operations.allApi.push({response: {operation_id: operations[key].operation_id, generation, outcome: 'committed', catalog_digest: sha256(state.utf8)}});
  }
  const result = await validateCatalogJournal(directory, rows, operations); assert.equal(result.length, 3);
  const target = fixture.files.find(row => row.path.endsWith('/state.json')).path.replace(/^catalog\//, 'catalog-backups/'), previous = await readFile(join(directory, target));
  await writeFile(join(directory, target), Buffer.concat([previous, Buffer.from(' ')])); await assert.rejects(validateCatalogJournal(directory, rows, operations), /backup differs/); await writeFile(join(directory, target), previous);
  const wrong = structuredClone(operations); wrong.allApi[1].response.catalog_digest = sha256('foreign state'); await assert.rejects(validateCatalogJournal(directory, rows, wrong), /catalog digest differs/);
  const missing = rows.filter(row => row.path !== target); await assert.rejects(validateCatalogJournal(directory, missing, operations));
  const extra = [...rows, digestRow('.catalog-staging/stage-unfinished/manifest.json', 'pending')]; await assert.rejects(validateCatalogJournal(directory, extra, operations), /unfinished journal staging/);
});
