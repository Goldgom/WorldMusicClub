// Pure stdio preflight for ORIGINAL fixtures. No browser, GUI, listener or Cargo.
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {mkdir, mkdtemp, readFile, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {startVsqNativeDriver} from '../tests/vsq-native-driver-fixtures.js';
import {assertCleanExportInventory} from '../tests/clean-song-package-fixtures.js';
import {managementRequest, checkedManagementResponse} from '../web/library-management-contract.js';
import {PACK_MANAGEMENT_LIMITS as LIMIT, originalPackManagementFixtures, fixtureManifest, writeOriginalFixtures, moveOriginalReceiptsAside, originalLibraryInventory, assertOriginalManagementInventory, assertSelectedLegacyExport, inspectOriginalManagementZip, sha256} from './pack-management-acceptance-fixtures.mjs';

const root = fileURLToPath(new URL('../', import.meta.url)), sourceSha = process.env.WMH_SOURCE_SHA;
assert.match(sourceSha || '', /^[a-f0-9]{40}$/, 'Declare the exact product source SHA used to build the immutable native driver');
assert.ok(process.env.WMH_NATIVE_IMPORT_DRIVER, 'An already-built immutable native_import_driver is required');
const git = (...args) => execFileSync('git', args, {cwd: root, encoding: 'utf8'}).trim();
assert.equal(git('rev-parse', `${sourceSha}^{commit}`), sourceSha);
assert.equal(git('diff', sourceSha, '--', 'Cargo.toml', 'Cargo.lock', 'crates', 'web'), '', 'Product source differs from the declared driver source; rebuild before running');
const harnessSha = git('rev-parse', 'HEAD'), output = resolve(process.env.WMH_ARTIFACT_DIR || join(tmpdir(), 'wmc-pack-management-native'));
await mkdir(output, {recursive: true});
const owned = await mkdtemp(join(output, 'original-run-')), library = join(owned, 'Scores'), binary = resolve(process.env.WMH_NATIVE_IMPORT_DRIVER), fixture = originalPackManagementFixtures();
await writeFile(join(owned, 'ORIGINAL-ACCEPTANCE-ROOT'), 'pack-management-original-only-v1\n', {flag: 'wx'});
await mkdir(join(owned, 'api')); await mkdir(join(owned, 'downloads')); await writeOriginalFixtures(join(owned, 'fixtures'), fixture);
const report = {version: 1, kind: 'original-pack-management-real-native-stdio-preflight', source_sha: sourceSha, harness_sha: harnessSha, harness_dirty: Boolean(git('status', '--porcelain', '--untracked-files=normal')), source_tree: git('rev-parse', `${sourceSha}^{tree}`), driver_sha256: sha256(await readFile(binary)), fixture: fixtureManifest(fixture), source_hashes: {}, api: [], cases: [], process_ids: [], ok: false, claims: {native_filesystem: true, browser: false, native_window: false, screenshots: false, user_library: false, private_music: false}};
for (const filename of ['scripts/check-pack-management-native.mjs', 'scripts/pack-management-acceptance-fixtures.mjs', 'tests/vsq-native-driver-fixtures.js']) report.source_hashes[filename] = sha256(await readFile(join(root, filename)));
let driver, timeout, cancelled = false;
const receipts = [];
async function request(path, {body, filename, method = 'POST'} = {}) {
  assert.equal(cancelled, false); assert.ok(report.api.length < LIMIT.api);
  const bytes = body === undefined ? Buffer.alloc(0) : Buffer.isBuffer(body) ? body : Buffer.from(JSON.stringify(body));
  const row = {sequence: report.api.length + 1, path, method, request_bytes: bytes.length, request_sha256: sha256(bytes), ...(filename ? {filename} : {request: body})}; report.api.push(row);
  const headers = filename ? {'content-type': 'application/octet-stream', 'x-wmh-filename': encodeURIComponent(filename)} : {'content-type': 'application/json'};
  const response = await driver.fetcher(path, {method, headers, body: bytes}), result = await response.bytes();
  row.status = response.status; row.bytes = result.length; row.sha256 = sha256(result); row.file = `api/${String(row.sequence).padStart(3, '0')}${response.contentType.includes('json') ? '.json' : '.bin'}`;
  await writeFile(join(owned, row.file), result, {flag: 'wx'}); assert.equal(response.status, 200, `${path}: ${result.toString().slice(0, 2000)}`);
  return response.contentType.includes('json') ? JSON.parse(result) : result;
}
async function query(input) {
  const body = managementRequest(input), response = await request('/api/library/manage/query', {body}); return checkedManagementResponse(response, body);
}
const launch = () => { driver = startVsqNativeDriver({binary, directory: library, cwd: root, requestTimeoutMs: 15000, closeTimeoutMs: 3000}); report.process_ids.push(driver.pid); };
const passed = (name, details = {}) => report.cases.push({name, ...details, ok: true});
async function run() {
  launch(); const health = await request('/api/health', {method: 'GET'}); assert.equal(health.network, 'native-protocol-no-listener'); assert.equal(health.library_management_query_version, 1);
  for (const input of [...fixture.initial, ...fixture.retries]) {
    const preview = await request('/api/library/import/preview', {filename: input.filename, body: input.bytes}); assert.equal(preview.mode, 'preview'); assert.equal(preview.source.sha256, input.sha256);
    const receipt = await request('/api/library/import/commit', {filename: input.filename, body: input.bytes}); receipts.push(receipt);
    assert.equal(receipt.mode, 'commit'); assert.equal(receipt.source.sha256, input.sha256); assert.equal(receipt.source.bytes, input.bytes.length); assert.equal(receipt.source.retained, true); assert.equal(receipt.summary.error, 0); assert.equal(receipt.summary.conflict, 0);
  }
  assert.deepEqual(receipts[1].items.map(item => item.path), [`${fixture.backup.filename}#entries/0`, `${fixture.backup.filename}#entries/1`]);
  assert.equal(receipts[6].summary.duplicate, 1); assert.equal(receipts[7].summary.duplicate, 2);
  for (const input of fixture.initial) assert.deepEqual(await request('/api/library/import/export', {body: {archive_key: input.archive_key}}), input.bytes);
  passed('actual-original-imports-unicode-backup-paths-renamed-retries-and-exact-source-exports');
  report.receipt_fixture = await moveOriginalReceiptsAside(owned, fixture.unresolved.archive_key);
  const before = await originalLibraryInventory(library); await writeFile(join(owned, 'library-before.json'), JSON.stringify(before, null, 2));
  const packs = await query({view: 'packs', refresh: true}), first = await query({view: 'songs'}), second = await query({view: 'songs', cursor: first.next_cursor});
  assert.equal(first.rows.length, 40); assert.equal(second.rows.length, 5); assert.equal(first.snapshot_id, second.snapshot_id); assert.equal(second.next_cursor, null); assert.equal(second.freshness.cached, true);
  const songs = {...first, rows: [...first.rows, ...second.rows], next_cursor: null}, duplicates = await query({view: 'duplicates'}), issues = await query({view: 'issues', limit: 100});
  report.inventory = assertOriginalManagementInventory(fixture, {packs, songs, duplicates, issues}, receipts[4]);
  assert.deepEqual((await query({view: 'songs', unfiled: true})).rows.map(row => row.score_id), [fixture.unresolved.scores[0].id]);
  assert.deepEqual((await query({view: 'songs', search: fixture.backupOnly.title})).rows.map(row => row.score_id), [fixture.backupOnly.id]);
  for (const duplicate_kind of ['same_id', 'same_title']) assert.equal((await query({view: 'duplicates', duplicate_kind})).total, 0);
  for (const input of [fixture.sourceOnly, fixture.unresolved]) {
    assert.equal((await query({view: 'songs', pack_id: input.pack_id})).total, 0);
    const filteredIssues = await query({view: 'issues', pack_id: input.pack_id}); assert.ok(filteredIssues.total > 0); assert.ok(filteredIssues.rows.every(row => row.archive_key === input.archive_key));
  }
  passed('four-real-query-views-bounded-paging-search-and-linked-issues');
  for (const kind of ['legacy', 'clean']) {
    const song = songs.rows.find(row => row.storage_kind === kind), exported = await request('/api/library/pack/export', {body: {keys: [song.key]}});
    const inventory = inspectOriginalManagementZip(exported);
    if (kind === 'legacy') assertSelectedLegacyExport(inventory, song, receipts);
    else assertCleanExportInventory(inventory, fixture.cleanFixture, song.key);
    const file = `downloads/selected-${kind}.zip`; await writeFile(join(owned, file), exported, {flag: 'wx'});
    const recheck = await request('/api/library/import/preview', {filename: `selected-${kind}.zip`, body: exported});
    assert.equal(recheck.items.length, 1); assert.equal(recheck.summary.duplicate, 1); assert.equal(recheck.items[0].entry.key, song.key);
    passed(`explicit-${kind}-selection-export-byte-fidelity`, {file, key: song.key, sha256: sha256(exported), inventory});
  }
  const after = await originalLibraryInventory(library); assert.deepEqual(after, before); await writeFile(join(owned, 'library-after.json'), JSON.stringify(after, null, 2)); passed('query-and-export-leave-every-original-library-byte-unchanged', {files: after.length});
  await driver.close(); driver = null; launch();
  const restarted = {};
  for (const view of ['packs', 'songs', 'duplicates', 'issues']) restarted[view] = await query({view, limit: 100, refresh: view === 'packs'});
  assertOriginalManagementInventory(fixture, restarted, receipts[4]); assert.notEqual(report.process_ids[0], report.process_ids[1]); passed('fresh-native-process-preserves-identities-and-provenance');
  assert.equal(cancelled, false); report.ok = true;
}
try {
  await Promise.race([run(), new Promise((_, reject) => { timeout = setTimeout(() => { cancelled = true; reject(Error(`Native pack-management preflight exceeded ${LIMIT.runtimeMs}ms`)); }, LIMIT.runtimeMs); })]);
} catch (error) { report.error = String(error.stack || error); report.ok = false; process.exitCode = 1; }
finally {
  clearTimeout(timeout); cancelled = true;
  try { await driver?.close(); } catch (error) { report.cleanup_error = String(error); report.ok = false; process.exitCode = 1; }
  await writeFile(join(owned, 'report.json'), JSON.stringify(report, null, 2) + '\n');
  await writeFile(join(output, 'latest-run.json'), JSON.stringify({directory: owned, report: join(owned, 'report.json'), source_sha: sourceSha, harness_sha: harnessSha, ok: report.ok}, null, 2) + '\n');
  console.log(JSON.stringify({ok: report.ok, report: join(owned, 'report.json'), source_sha: sourceSha, harness_sha: harnessSha, browser: false}));
}
if (!report.ok) throw Error(report.error || report.cleanup_error);
