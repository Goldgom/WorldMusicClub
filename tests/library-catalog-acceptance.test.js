// Synthetic protocol/artifact tests only: no browser, native process or Windows acceptance is claimed.
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, mkdir, readFile, readdir, rm, symlink, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {deflateSync} from 'node:zlib';
import {execFileSync} from 'node:child_process';
import {authoredLegacyPack, storedZip, STREAMING_ZIP_SCRIPT} from './native-import-driver-fixtures.js';
import {authoredCleanPackage} from './clean-song-package-fixtures.js';
import {catalogServer} from './library-catalog-fixtures.js';
import {userPackServer} from './library-user-pack-fixtures.js';
import {organizationJournalFixture} from './library-catalog-organization-journal-fixtures.js';
import {inspectOriginalManagementZip} from '../scripts/pack-management-acceptance-fixtures.mjs';
import {CATALOG_ACCEPTANCE_PHASES, originalCatalogAcceptanceFixtures, prepareLibraryCatalogFixtures, catalogSha256 as sha256} from '../scripts/prepare-library-catalog-acceptance.mjs';
import {CATALOG_SOURCE_FILES, CATALOG_REQUIRED_CHECKS, CATALOG_SCREENSHOTS, readCatalogEvidenceFile, validateCatalogSourceBinding, validateCatalogScreenshot, validateCatalogApiEvidence, validateCatalogHostApiTrace, validateCatalogRetainedSnapshots, catalogLibraryInventory, validateCatalogProtocolPhases, validateCatalogJournal, validateCatalogPickerProtocol, validateCatalogSelectedExport} from '../scripts/verify-library-catalog-acceptance.mjs';

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
  for (const file of ['web/performance-view.js', 'web/piano-stage-view.js', 'web/piano-layout-budget.js']) {
    assert.equal(CATALOG_SOURCE_FILES.filter(name => name === file).length, 1, 'Every production piano budget module must be bound exactly once');
    const missing = structuredClone(expected); delete missing.source_hashes[file]; assert.throws(() => validateCatalogSourceBinding(missing, expected));
    const changed = structuredClone(expected); changed.source_hashes[file] = sha256('changed piano budget module'); assert.throws(() => validateCatalogSourceBinding(changed, expected));
  }
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
async function protocol({organization = false} = {}) {
  const fixture = originalCatalogAcceptanceFixtures(), binding = sourceBinding(), runId = 'protocol-only-catalog-contract';
  const server = await (organization ? userPackServer : catalogServer)({initialized: false});
  const packs = fixture.inputs.map(input => ({collection_id: `collection-${input.sha256.slice(0, 32)}`, import_pack_id: input.pack_id, name: input.filename, ...(organization ? {kind: 'imported'} : {})}));
  for (const [index, row] of server.rows.entries()) {
    row.score_id = index === 0 ? fixture.spec.legacy_ids[0] : index === 1 ? fixture.spec.clean_id : fixture.spec.legacy_ids[1];
    row.packs = index === 0 ? packs.slice(0, 2) : [packs[index === 1 ? 2 : 0]]; row.pack_count = row.packs.length;
  }
  if (organization) { server.packs.clear(); for (const pack of packs) server.packs.set(pack.collection_id, pack); }
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
  let organizationRecords;
  const action = (control, kind = 'click', extras = {}) => { const template = current.actions[0], sequence = current.actions.length + 1; current.actions.push({...template, sequence, control, kind, trusted_key_downs: kind === 'key-r' ? 1 : 0, trusted_key_ups: kind === 'key-r' ? 1 : 0, ...extras}); return sequence; };
  const packsQuery = () => call('/api/library/catalog/query', {view: 'packs', limit: 100, refresh: true});
  const filterPack = async target => { const sequence = action('management-catalog-open-pack', 'click', {collection_id: target}); const filtered = await call('/api/library/catalog/query', {view: 'active', collection_id: target, limit: 100, refresh: true}, {source: 'app', action_sequence: sequence}); return {filtered, filter_action: sequence, visible_editions: filtered.rows.map(row => row.edition_id).sort()}; };
  if (organization) {
    current.catalog.restored = structuredClone(current.catalog.active); current.screenshots['restored-current-owner'] = 4; current.profile.organization_before_open = null;
    const organize = async (kind, target, name) => {
      const selectedRows = kind === 'add_memberships' ? selected : [], before = await query('active');
      const action_sequence = action(`management-catalog-${{create_pack: 'create', rename_pack: 'rename', add_memberships: 'add'}[kind]}-preview`);
      const preview = await call('/api/library/catalog/preview', {action: kind, edition_ids: selectedRows.map(row => row.edition_id), collection_id: target, name, trash_operation_id: null, library_id: initial.library_id, expected_generation: before.generation, catalog_digest: before.catalog_digest}, {source: 'app', action_sequence});
      const record = {kind, library_id: initial.library_id, operation_id: preview.preview.request.operation_id, preview: preview.preview, summary: preview.summary, selected: selectedRows.map(({edition_id, title}) => ({edition_id, title})), phase: 'committed'};
      if (kind === 'add_memberships') current.screenshots['user-pack-add-review'] = action_sequence;
      await call('/api/library/catalog/commit', {library_id: initial.library_id, preview: record.preview}, {source: 'app', action_sequence: action('management-catalog-confirm')});
      return record;
    };
    action('management-catalog-create-name', 'key-r'); const create = await organize('create_pack', null, 'r');
    current.screenshots['user-pack-empty-review'] = action('management-catalog-packs'); const empty = await packsQuery(), target = create.preview.request.action.pack_id;
    action('management-catalog-rename-pack', 'click', {collection_id: target}); action('management-catalog-rename-name', 'key-r'); const rename = await organize('rename_pack', target, 'rr');
    action('management-catalog-add-target', 'select-last', {trusted_clicks: 2, selection: {target_id: 'management-catalog-add-target', target_tag: 'SELECT', before: '', after: target, option_values: ['', target], selected_index: 1, selected_text: `rr · ${target}`, trusted_changes: 1, untrusted_changes: 0, events: [{type: 'click', trusted: true, target_id: 'management-catalog-add-target', value: ''}, {type: 'input', trusted: true, target_id: 'management-catalog-add-target', value: target}, {type: 'change', trusted: true, target_id: 'management-catalog-add-target', value: target}, {type: 'click', trusted: true, target_id: 'management-catalog-add-target', value: target}]}}); const add = await organize('add_memberships', target, null);
    const readonly = {imported_collection_ids: packs.map(pack => pack.collection_id).sort(), rename_target_ids: [target], add_target_ids: [target], imported_rename_controls: []};
    const review_focus = ['create_pack', 'rename_pack', 'add_memberships'].map(kind => ({kind, action_sequence: current.api_trace.find(row => row.path === '/api/library/catalog/preview' && row.request.action === kind).action_sequence, active_element: 'management-catalog-review-title', top: 200, bottom: 240, width: 400, height: 40, viewport: {width: 1280, height: 720}}));
    current.organization = {create, rename, add, empty, packs: await packsQuery(), readonly, review_focus, ...await filterPack(target)};
    current.screenshots['user-pack-filtered'] = current.organization.filter_action;
    for (const kind of ['legacy', 'clean']) {
      const request = {keys: [selected.find(row => row.storage_kind === kind).key]}, request_text = JSON.stringify(request), bytes = fixture[kind].bytes;
      current.api_trace.push({sequence: current.api_trace.length + 1, source: 'app', path: '/api/library/pack/export', method: 'POST', request, request_text, request_sha256: sha256(request_text), dispatched: true, delivery: 'forwarded', status: 200, response: null, response_text: null, response_binary_bytes: bytes.length, response_sha256: sha256(bytes), action_sequence: action(`management-catalog-export-${kind}`)});
    }
    current.catalog.active = await query('active'); current.catalog.trash = await query('trash'); organizationRecords = {restore, create, rename, add};
  }
  current = reports[2]; const finalRecord = organization ? organizationRecords.add : restore;
  current.profile.recovery_before_open = structuredClone(finalRecord); current.profile.recovery_after_open = structuredClone(finalRecord);
  await call('/api/library/catalog/operation', {library_id: initial.library_id, operation_id: restore.operation_id});
  if (organization) {
    current.operations.restore = structuredClone(restore); current.profile.organization_before_open = structuredClone(organizationRecords);
    await call('/api/library/catalog/operation', {library_id: initial.library_id, operation_id: finalRecord.operation_id}, {source: 'app'});
    current.organization = {...structuredClone(reports[1].organization), empty: null, review_focus: [], packs: await packsQuery(), ...await filterPack(organizationRecords.create.preview.request.action.pack_id)};
    current.screenshots['persisted-user-pack'] = current.organization.filter_action;
  }
  current.catalog.active = await query('active'); current.catalog.trash = await query('trash');
  for (const report of reports) { let order = 0; for (const row of report.api_trace) if (row.dispatched) row.dispatch_order = ++order; }
  return {reports, options: {sourceBinding: binding, runId, fixture, requireOrganization: organization}};
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


test('catalog chooser binds ordered actions to each exact preview and commit archive', () => {
  const fixture = originalCatalogAcceptanceFixtures();
  function phaseFixture(phase) {
    const inputs = phase === 'catalog-seed' ? fixture.inputs : phase === 'catalog-restart' ? [fixture.legacy, fixture.clean] : [];
    const sentActions = [], report = {actions: [], api_trace: []};
    for (const input of inputs) {
      const sequence = sentActions.length + 1;
      sentActions.push({sequence, kind: 'picker', file: input.filename}, {sequence: sequence + 1, kind: 'click'});
      report.actions.push({sequence, kind: 'picker', control: 'import-button'}, {sequence: sequence + 1, kind: 'click', control: 'bulk-import-save'});
      for (const [offset, mode] of ['preview', 'commit'].entries()) report.api_trace.push({action_sequence: sequence + offset, path: `/api/library/import/${mode}`, source: 'app', method: 'POST', dispatched: true, delivery: 'forwarded', status: 200, request_base64: input.bytes.toString('base64'), request_sha256: input.sha256, response: {source: {archive_key: input.archive_key, bytes: input.bytes.length, filename: input.filename, retained: mode === 'commit', sha256: input.sha256}}});
    }
    return {sentActions, report};
  }
  for (const phase of CATALOG_ACCEPTANCE_PHASES) {
    const value = phaseFixture(phase);
    assert.doesNotThrow(() => validateCatalogPickerProtocol(phase, value.sentActions, value.report, fixture));
  }
  const original = phaseFixture('catalog-seed');
  const failures = [
    ['419 sorted object protocol', v => { const names = [fixture.clean.filename, fixture.legacy.filename, fixture.shared.filename]; v.sentActions.filter(row => row.kind === 'picker').forEach((row, index) => row.file = names[index]); }],
    ['picker filename alias', v => v.sentActions[0].file = '../' + v.sentActions[0].file],
    ['save target', v => v.report.actions[1].control = 'import-button'],
    ['wrong action', v => v.report.api_trace[0].action_sequence = 3],
    ['swapped preview and commit', v => v.report.api_trace.reverse()],
    ['orphan import', v => v.report.api_trace.push(v.report.api_trace[0])],
    ['missing commit', v => v.report.api_trace.pop()],
    ['wrong chosen bytes', v => v.report.api_trace[0].request_base64 = fixture.clean.bytes.toString('base64')],
    ['wrong source hash', v => v.report.api_trace[1].request_sha256 = fixture.clean.sha256],
    ['wrong receipt filename', v => v.report.api_trace[1].response.source.filename = fixture.clean.filename],
    ['unretained commit', v => v.report.api_trace[1].response.source.retained = false],
    ['not dispatched', v => v.report.api_trace[1].dispatched = false],
    ['wrong owner', v => v.report.api_trace[1].source = 'probe'],
  ];
  for (const [label, edit] of failures) { const value = structuredClone(original); edit(value); assert.throws(() => validateCatalogPickerProtocol('catalog-seed', value.sentActions, value.report, fixture), undefined, label); }
});

function refreshProtocolBodies(reports) {
  for (const report of reports) for (const row of report.api_trace) {
    if (row.request !== null) { row.request_text = JSON.stringify(row.request); row.request_sha256 = sha256(row.request_text); }
    if (row.response !== null) { row.response_text = JSON.stringify(row.response); row.response_sha256 = sha256(row.response_text); }
  }
}

test('required user-pack protocol binds the original restore, three reviewed operations, source groups, filtered DOM and selected exports', async () => {
  const {reports, options} = await protocol({organization: true});
  const result = validateCatalogProtocolPhases(reports, options);
  assert.equal(result.create.kind, 'create_pack'); assert.equal(result.rename.kind, 'rename_pack'); assert.equal(result.add.kind, 'add_memberships');
  assert.equal(result.allApi.filter(row => row.path === '/api/library/catalog/commit').length, 6);
  const original = await protocol(); assert.throws(() => validateCatalogProtocolPhases(original.reports, {...original.options, requireOrganization: true}));
  const cases = [
    ['omitted organization', v => delete v[1].organization],
    ['missing required check', v => v[1].checks.pop()],
    ['forged create name', v => v[1].organization.create.preview.request.action.name = 'forged'],
    ['forged renamed name', v => v[1].organization.rename.preview.request.action.name = 'r'],
    ['changed target identity', v => v[1].organization.rename.preview.request.action.pack_id = v[0].catalog.initialized.rows[0].packs[0].collection_id],
    ['extra committed action', v => { const row = structuredClone(v[1].api_trace.find(row => row.request?.preview?.request.operation_id === v[1].organization.add.operation_id)); row.sequence = v[1].api_trace.length + 1; row.dispatch_order = v[1].api_trace.filter(row => row.dispatched).length + 1; v[1].api_trace.push(row); }],
    ['imported group renamed', v => v[1].organization.packs.rows.find(row => row.kind === 'imported').name = 'changed source'],
    ['added imported rename control', v => v[1].organization.readonly.imported_rename_controls.push(v[1].organization.readonly.imported_collection_ids[0])],
    ['source group as add destination', v => v[1].organization.readonly.add_target_ids.push(v[1].organization.readonly.imported_collection_ids[0])],
    ['extra membership', v => v[1].catalog.active.rows.find(row => !result.selectedIds.includes(row.edition_id)).packs.push(v[1].catalog.active.rows.find(row => result.selectedIds.includes(row.edition_id)).packs.at(-1))],
    ['selected filtered DOM omitted', v => v[1].organization.visible_editions.pop()],
    ['wrong filter click', v => v[1].organization.filter_action--],
    ['missing original restore checkpoint', v => delete v[1].catalog.restored],
    ['old restore changed', v => v[1].catalog.restored.generation = 5],
    ['final marker substituted', v => v[2].profile.organization_before_open.add = v[2].profile.organization_before_open.rename],
    ['final recovery still points at restore', v => v[2].profile.recovery_before_open = v[1].operations.restore],
    ['final organization write', v => { const row = structuredClone(v[1].api_trace.find(row => row.request?.preview?.request.operation_id === v[1].organization.add.operation_id)); row.sequence = v[2].api_trace.length + 1; row.dispatch_order = v[2].api_trace.filter(row => row.dispatched).length + 1; v[2].api_trace.push(row); }],
    ['untrusted name input', v => v[1].actions.find(row => row.control === 'management-catalog-create-name').trusted_key_downs = 0],
    ['old count-only select lacks change evidence', v => delete v[1].actions.find(row => row.kind === 'select-last').selection],
    ['select repeated change', v => v[1].actions.find(row => row.kind === 'select-last').selection.trusted_changes = 2],
    ['select synthetic change', v => v[1].actions.find(row => row.kind === 'select-last').selection.untrusted_changes = 1],
    ['select wrong target element', v => v[1].actions.find(row => row.kind === 'select-last').selection.target_id = 'management-catalog-filter'],
    ['select missing option identity', v => v[1].actions.find(row => row.kind === 'select-last').selection.option_values = ['']],
    ['select wrong selected index', v => v[1].actions.find(row => row.kind === 'select-last').selection.selected_index = 0],
    ['select wrong label', v => v[1].actions.find(row => row.kind === 'select-last').selection.selected_text = 'wrong pack'],
    ['select source option injected', v => v[1].actions.find(row => row.kind === 'select-last').selection.option_values.push(v[0].catalog.initialized.rows[0].packs[0].collection_id)],
    ['select nonempty initial value', v => v[1].actions.find(row => row.kind === 'select-last').selection.before = v[1].organization.create.preview.request.action.pack_id],
    ['select raw synthetic event', v => v[1].actions.find(row => row.kind === 'select-last').selection.events[1].trusted = false],
    ['select raw wrong change value', v => v[1].actions.find(row => row.kind === 'select-last').selection.events[2].value = ''],
    ['select raw wrong event target', v => v[1].actions.find(row => row.kind === 'select-last').selection.events[0].target_id = 'different-control'],
    ['select three trusted clicks', v => v[1].actions.find(row => row.kind === 'select-last').trusted_clicks = 3],
    ['ordinary button double click remains rejected', v => v[1].actions.find(row => row.control === 'management-catalog-add-preview').trusted_clicks = 2],

    ['review outside viewport', v => v[1].organization.review_focus[0].bottom = 721],
    ['review never focused', v => v[1].organization.review_focus[1].active_element = 'management-title'],
    ['selected ZIP extra key', v => v[1].api_trace.find(row => row.path === '/api/library/pack/export').request.keys.push(v[0].catalog.initialized.rows[2].key)],
    ['selected ZIP probe substituted', v => v[1].api_trace.find(row => row.path === '/api/library/pack/export').source = 'probe'],
    ['selected ZIP action substituted', v => v[1].api_trace.find(row => row.path === '/api/library/pack/export').action_sequence--],
  ];
  for (const [label, edit] of cases) { const changed = structuredClone(reports); edit(changed); refreshProtocolBodies(changed); assert.throws(() => validateCatalogProtocolPhases(changed, options), label); }
});

test('selected ZIP transport evidence is exclusive, bounded and independently matches host bytes and digest', () => {
  const bytes = Buffer.from('ORIGINAL protocol-only ZIP transport body'), request = {keys: [`song-${'a'.repeat(64)}`]}, request_text = JSON.stringify(request);
  const row = {...apiRow(request), source: 'app', path: '/api/library/pack/export', request_text, request_sha256: sha256(request_text), response: null, response_text: null, response_binary_bytes: bytes.length, response_sha256: sha256(bytes)};
  assert.doesNotThrow(() => validateCatalogApiEvidence([row]));
  const host = [{sequence: 1, method: 'POST', path: row.path, request_bytes: Buffer.byteLength(request_text), request_sha256: row.request_sha256, response_bytes: bytes.length, response_sha256: sha256(bytes), response_file: 'api/selected.zip', status: 200}];
  assert.equal(validateCatalogHostApiTrace(host, [row]), 1);
  for (const edit of [r => r.source = 'probe', r => r.method = 'GET', r => r.delivery = 'deferred-read', r => r.path = '/api/library/list', r => r.status = 500, r => r.response_binary_bytes = 0, r => r.response_binary_bytes = 16777217, r => r.response_binary_bytes = 1.5, r => r.response_sha256 = null, r => r.response = {ok: true}, r => r.response_text = '{}']) { const changed = structuredClone(row); edit(changed); assert.throws(() => validateCatalogApiEvidence([changed])); }
  assert.throws(() => validateCatalogHostApiTrace([{...host[0], response_bytes: bytes.length + 1}], [row]));
  assert.throws(() => validateCatalogHostApiTrace([{...host[0], response_sha256: sha256('altered ZIP')}], [row]));
  const error = {...apiRow(request, {error: 'ORIGINAL rejected export'}), path: row.path, status: 400}; assert.doesNotThrow(() => validateCatalogApiEvidence([error]));
  assert.throws(() => validateCatalogApiEvidence([{...error, response_binary_bytes: 10}]));
});

test('downloaded selected ORIGINAL legacy and complete-song ZIPs must match native bytes and exact declared inventories', () => {
  const fixture = originalCatalogAcceptanceFixtures(), legacyKey = `song-${sha256('selected legacy protocol fixture')}`, cleanKey = `song-${sha256('selected complete protocol fixture')}`;
  const initialRows = [{key: legacyKey, edition_id: `legacy:${legacyKey}`, storage_kind: 'legacy'}, {key: cleanKey, edition_id: `clean:${cleanKey}`, storage_kind: 'clean'}];
  const score = Buffer.from(JSON.stringify(authoredLegacyPack().scores[0]));
  const operations = {initialRows, selectedIds: initialRows.map(row => row.edition_id), imports: [{response: {items: [{entry: {key: legacyKey, score_sha256: sha256(score), score_bytes: score.length}}]}}]};
  const legacyEntries = [['manifest.json', '{}'], [`songs/${legacyKey}/metadata.json`, '{}'], [`songs/${legacyKey}/score.json`, score]];
  const cleanEntries = [['manifest.json', '{}'], ...[...fixture.cleanFixture.files].map(([path, bytes]) => [`songs/${cleanKey}/${path}`, bytes])];
  for (const [kind, key, entries] of [['legacy', legacyKey, legacyEntries], ['clean', cleanKey, cleanEntries]]) {
    const bytes = storedZip(entries), row = {...apiRow({keys: [key]}), source: 'app', path: '/api/library/pack/export', response: null, response_text: null, response_binary_bytes: bytes.length, response_sha256: sha256(bytes)}, report = {api_trace: [row]};
    assert.ok(validateCatalogSelectedExport(bytes, report, kind, operations, fixture));
    const corrupted = Buffer.from(bytes); corrupted[40] ^= 1; assert.throws(() => validateCatalogSelectedExport(corrupted, report, kind, operations, fixture), /actual native export response/);
    for (const changed of [entries.slice(0, -1), [...entries, ['unrequested-source.bin', 'extra original source']], entries.map(([name, data], index) => [name, index === entries.length - 1 ? Buffer.from('altered ORIGINAL payload') : data])]) {
      const invalid = storedZip(changed), alteredReport = {api_trace: [{...row, response_binary_bytes: invalid.length, response_sha256: sha256(invalid)}]};
      assert.throws(() => validateCatalogSelectedExport(invalid, alteredReport, kind, operations, fixture));
    }
  }
});

test('six-generation protocol journal preserves every original source/song/tombstone and exact custom metadata and membership position/time/revision', async t => {
  const root = await owned(t), valid = await organizationJournalFixture(join(root, 'valid'));
  assert.equal((await validateCatalogJournal(join(root, 'valid'), valid.rows, valid.operations)).length, 6);
  const cases = [
    ['imported group name', ({states}) => states[3].inventory.packs.find(row => row.kind === 'imported').name = 'renamed source'],
    ['imported group revision', ({states}) => states[3].inventory.packs.find(row => row.kind === 'imported').revision = 3],
    ['source reference', ({states}) => states[3].inventory.sources[0].retained_bytes++],
    ['origin receipt', ({states}) => states[4].inventory.origins[0].item_path = 'changed-source'],
    ['song revision', ({states}) => states[5].inventory.songs[0].revision = 5],
    ['tombstone owner', ({states}) => states[4].trash[0].entities[0].restored_by = null],
    ['retained receipt history', ({states}) => states[5].receipts[0].preview.request.at_unix_ms++],
    ['custom source key', ({states, target}) => states[3].inventory.packs.find(row => row.id === target).source_archive_keys = [states[3].inventory.sources[0].id]],
    ['custom import identity', ({states, target, records}) => states[3].inventory.packs.find(row => row.id === target).origin_import_operation_id = records[0].operation_id],
    ['custom creation revision', ({states, target}) => states[3].inventory.packs.find(row => row.id === target).revision = 0],
    ['custom renamed name', ({states, target}) => states[4].inventory.packs.find(row => row.id === target).name = 'r'],
    ['custom add revision', ({states, target}) => states[5].inventory.packs.find(row => row.id === target).revision = 4],
    ['membership position', ({states, target}) => states[5].inventory.memberships.find(row => row.id.pack === target).position = 5],
    ['membership timestamp', ({states, target}) => states[5].inventory.memberships.find(row => row.id.pack === target).added_at_unix_ms++],
    ['membership revision', ({states, target}) => states[5].inventory.memberships.find(row => row.id.pack === target).revision = 2],
    ['original edge position', ({states, target}) => states[5].inventory.memberships.find(row => row.id.pack !== target).position++],
    ['unknown new state field', ({states}) => states[3].organization_extra = true],
  ];
  for (const [index, [label, mutate]] of cases.entries()) { const directory = join(root, `tampered-${index}`), changed = await organizationJournalFixture(directory, mutate); await assert.rejects(validateCatalogJournal(directory, changed.rows, changed.operations), /Organization journal changed/, label); }
  const noDigest = structuredClone(valid.operations); noDigest.allApi.pop(); await assert.rejects(validateCatalogJournal(join(root, 'valid'), valid.rows, noDigest), /exact native committed digest/);
  const extra = [...valid.rows, digestRow('catalog/commits/00000000000000000006-operation-' + 'f'.repeat(32) + '/state.json', '{}')]; await assert.rejects(validateCatalogJournal(join(root, 'valid'), extra, valid.operations), /Unexpected or missing journal/);
  const missing = valid.rows.filter(row => !row.path.startsWith('catalog-backups/commits/00000000000000000005-')); await assert.rejects(validateCatalogJournal(join(root, 'valid'), missing, valid.operations));
});
