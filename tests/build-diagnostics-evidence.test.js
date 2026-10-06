import assert from 'node:assert/strict';
import test from 'node:test';
import {execFileSync} from 'node:child_process';
import {mkdtemp, mkdir, writeFile, rm, symlink} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {
  frozenBuildDiagnosticsSource, buildDiagnosticsExecutableBinding,
  canonicalWindowsExecutablePath, validateBuildDiagnosticsIdentity,
  validateBuildDiagnosticsCopiedText, validateBuildDiagnosticsInventoryExtension,
} from '../scripts/build-diagnostics-evidence.mjs';

// Entirely original protocol fixtures. This is neither a Windows executable
// nor recorded native acceptance evidence, and cannot claim an actual run.
function fixture() {
  const bytes = Buffer.from('Original diagnostic contract bytes, never executed.\n');
  const executable = {sha256: createHash('sha256').update(bytes).digest('hex'), bytes: bytes.length};
  const source = {source_sha: 'a'.repeat(40), source_tree: 'b'.repeat(40), source_commit_count: 7, source_status: 'clean', source_error: null};
  const host = {
    process_id: 42, target: 'x86_64-pc-windows-msvc', arch: 'x86_64', executable_tcp_listeners: 0,
    launched_executable_path: 'C:\\Original Fixtures\\worldmusichub-desktop.exe',
    process_image_path: 'C:\\Original Fixtures\\worldmusichub-desktop.exe',
    executable_before: {...executable}, executable_after: {...executable},
    capture_started_unix_ms: 1700000000000, capture_finished_unix_ms: 1700000001000,
  };
  const response = {
    schema_version: 1,
    compiled: {package_version: '0.2.0', ...source, target: host.target},
    native: {
      transport: 'native-protocol-no-listener', process_id: 42, os: 'windows', arch: 'x86_64',
      executable_path: host.process_image_path, executable_sha256: executable.sha256, executable_bytes: executable.bytes,
      executable_hash_status: 'ok', executable_error: null, executable_checked_at_unix_ms: 1700000000500,
      executable_hash_scope: 'current_executable_path_file', executable_cache: 'once_per_process',
    },
  };
  return {bytes, executable, source, host, response};
}
function copyFixture(response, includePath = false) {
  const value = item => item === null ? 'unknown' : String(item);
  return [
    'WorldMusicClub build diagnostics v1', 'diagnostics.status: ready',
    'compiled.component: Rust backend (not browser assets)',
    ...Object.entries(response.compiled).map(([key, item]) => `compiled.${key}: ${value(item)}`),
    ...Object.entries(response.native).filter(([key]) => key !== 'executable_path').map(([key, item]) => `native.${key}: ${value(item)}`),
    'native.hash_note: Cached file at executable path; not the loaded memory image',
    ...['source_sha', 'source_tree', 'source_commit_count', 'source_status'].map(key => `browser_assets.${key}: unknown`),
    ...(includePath ? [`native.executable_path: ${response.native.executable_path}`] : []),
  ].join('\n');
}

test('diagnostics require independently frozen Git, process image and retained executable bytes', () => {
  const value = fixture();assert.equal(validateBuildDiagnosticsIdentity(value.response, value), value.response);
  for (const key of ['source', 'host', 'executable']) {
    const missing = structuredClone(value);delete missing[key];assert.throws(() => validateBuildDiagnosticsIdentity(missing.response, missing));
  }
  const wrongInputs = [
    row => { row.source.source_sha = 'c'.repeat(40); }, row => { row.source.source_tree = 'c'.repeat(40); },
    row => { row.source.source_commit_count++; }, row => { row.host.process_id++; },
    row => { row.host.process_image_path = 'C:\\Unrelated\\worldmusichub-desktop.exe'; },
    row => { row.host.launched_executable_path = 'C:\\Unrelated\\worldmusichub-desktop.exe'; },
    row => { row.host.executable_before.bytes++; }, row => { row.host.executable_after.sha256 = '0'.repeat(64); },
    row => { row.executable.bytes++; }, row => { row.host.executable_tcp_listeners = 1; },
    row => { row.host.target = 'aarch64-pc-windows-msvc'; }, row => { row.host.arch = 'aarch64'; },
  ];
  for (const change of wrongInputs) {const row = fixture();change(row);assert.throws(() => validateBuildDiagnosticsIdentity(row.response, row));}
});

test('legacy health, unknown, dirty, shallow, stale cache and partial identities cannot pass same-source acceptance', () => {
  const changes = [
    row => { row.response = {ok: true, version: '0.2.0'}; },
    row => { row.response.compiled.source_status = 'dirty'; },
    row => { row.response.compiled.source_status = 'unavailable';row.response.compiled.source_sha = null; },
    row => { row.response.compiled.source_commit_count = null;row.response.compiled.source_error = 'shallow_history'; },
    row => { row.response.compiled.source_sha = row.response.compiled.source_sha.toUpperCase(); },
    row => { row.response.compiled.source_tree = 'd'.repeat(40); },
    row => { row.response.compiled.source_commit_count = '7'; },
    row => { row.response.compiled.source_commit_count = 7.5; },
    row => { row.response.native.transport = 'loopback-only'; },
    row => { row.response.native.os = 'linux'; },
    row => { row.response.native.executable_hash_status = 'changed'; },
    row => { row.response.native.executable_hash_status = 'unavailable';row.response.native.executable_sha256 = null; },
    row => { row.response.native.executable_hash_scope = 'loaded_memory_image'; },
    row => { row.response.native.executable_cache = 'sidecar'; },
    row => { row.response.native.executable_checked_at_unix_ms = row.host.capture_started_unix_ms - 1; },
    row => { row.response.native.executable_checked_at_unix_ms = row.host.capture_finished_unix_ms + 1; },
    row => { row.response.native.executable_error = 'executable_changed'; },
    row => { row.response.sidecar = {source_sha: row.source.source_sha}; },
    row => { row.response.native.executable_sha256 = 'f'.repeat(64); },
  ];
  for (const change of changes) {const row = fixture();change(row);assert.throws(() => validateBuildDiagnosticsIdentity(row.response, row));}
});

test('Windows process path comparison allows OS prefix/case spelling but rejects relative and injected paths', () => {
  const path = 'C:\\Original Fixtures\\worldmusichub-desktop.exe';
  assert.equal(canonicalWindowsExecutablePath(`\\\\?\\${path}`), canonicalWindowsExecutablePath(path.toUpperCase()));
  assert.equal(canonicalWindowsExecutablePath('\\\\?\\UNC\\host\\share\\app.exe'), canonicalWindowsExecutablePath('\\\\host\\share\\app.exe'));
  for (const bad of ['app.exe', 'C:app.exe', '\\app.exe', 'C:\\a\\..\\b.exe', 'C:\\a\n.exe', 'C:\\a\u202e.exe']) assert.throws(() => canonicalWindowsExecutablePath(bad));
});

test('source capacity expansion retains all 125 baseline bindings and rejects omitted, extra, duplicate and over-bound modules', () => {
  const baseline = Array.from({length: 125}, (_, index) => `original/module-${index}.js`);
  const additions = ['crates/practice-server/build_source.rs', 'crates/practice-server/src/build_identity.rs', 'web/build-diagnostics.js', 'web/build-diagnostics-view.js', 'web/build-diagnostics.css'];
  const actual = [...baseline, ...additions];
  assert.throws(() => validateBuildDiagnosticsInventoryExtension(baseline, actual, {additions, maxFiles: 128}), /capacity/);
  assert.equal(validateBuildDiagnosticsInventoryExtension(baseline, actual, {additions, maxFiles: 160}), actual);
  assert.throws(() => validateBuildDiagnosticsInventoryExtension(baseline, actual.slice(1), {additions, maxFiles: 160}), /every old binding/);
  assert.throws(() => validateBuildDiagnosticsInventoryExtension(baseline, [...actual, 'unexpected.js'], {additions, maxFiles: 160}), /declared additions/);
  assert.throws(() => validateBuildDiagnosticsInventoryExtension(baseline, [...actual, actual[0]], {additions, maxFiles: 160}), /Duplicate/);
  const extra = Array.from({length: 31}, (_, index) => `original/extra-${index}.js`);
  assert.throws(() => validateBuildDiagnosticsInventoryExtension(baseline, [...actual, ...extra], {additions: [...additions, ...extra], maxFiles: 160}), /capacity/);
  assert.throws(() => validateBuildDiagnosticsInventoryExtension(baseline, actual, {additions, maxFiles: 1024}), /finite source capacity/);
});

test('actual copied text contains every identity field, unknown browser source and explicit-only path', () => {
  const {response} = fixture(), normal = copyFixture(response), withPath = copyFixture(response, true);
  validateBuildDiagnosticsCopiedText(normal, response);validateBuildDiagnosticsCopiedText(withPath, response, {includePath: true});
  assert.throws(() => validateBuildDiagnosticsCopiedText(withPath, response));
  assert.throws(() => validateBuildDiagnosticsCopiedText(withPath, response, {includePath: 'true'}));
  assert.throws(() => validateBuildDiagnosticsCopiedText(normal, response, {includePath: true}));
  for (const corrupted of [
    normal.replace('browser_assets.source_sha: unknown', `browser_assets.source_sha: ${response.compiled.source_sha}`),
    normal.replace(`compiled.source_commit_count: 7`, 'compiled.source_commit_count: 545'),
    `${normal}\nprivate_path: ${response.native.executable_path}`,
    `${normal}\ndiagnostics.status: ready`, normal.replace('compiled.source_tree:', 'unrecognized:'),
    normal.replace('diagnostics.status: ready', 'diagnostics.status: unsupported'),
  ]) assert.throws(() => validateBuildDiagnosticsCopiedText(corrupted, response));
});

test('independent Git capture ignores mutable BUILD-INFO and rejects dirty or shallow checkout', async t => {
  const root = await mkdtemp(join(tmpdir(), 'wmc-build-git-contract-'));t.after(() => rm(root, {recursive: true, force: true}));
  const git = (...args) => execFileSync('git', ['-C', root, ...args], {encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe']}).trim();
  git('-c', 'init.templateDir=', 'init', '-q');git('config', 'user.name', 'Original diagnostic contract');git('config', 'user.email', 'fixture@example.invalid');
  git('config', 'commit.gpgSign', 'false');git('config', 'core.hooksPath', '.git/no-hooks');
  await writeFile(join(root, 'BUILD-INFO.json'), '{"source_sha":"misleading","count":545}\n');
  git('add', '.');git('commit', '-qm', 'Original diagnostic fixture');
  let result = await frozenBuildDiagnosticsSource(root);assert.equal(result.source_commit_count, 1);assert.equal(result.source_sha, git('rev-parse', 'HEAD'));
  git('commit', '--allow-empty', '-qm', 'Original empty commit');const next = await frozenBuildDiagnosticsSource(root);
  assert.notEqual(result.source_sha, next.source_sha);assert.equal(result.source_tree, next.source_tree);assert.equal(next.source_commit_count, 2);
  await writeFile(join(root, 'untracked.txt'), 'Original untracked fixture\n');await assert.rejects(frozenBuildDiagnosticsSource(root), /clean/);
  await rm(join(root, 'untracked.txt'));await writeFile(join(root, '.git', 'shallow'), `${git('rev-parse', 'HEAD')}\n`);
  await assert.rejects(frozenBuildDiagnosticsSource(root), /Full Git history/);
});

test('retained artifact binding reads bytes without executing and rejects file symlinks', async t => {
  const root = await mkdtemp(join(tmpdir(), 'wmc-build-file-contract-'));t.after(() => rm(root, {recursive: true, force: true}));
  const row = fixture(), path = join(root, 'original.fixture');await writeFile(path, row.bytes);
  assert.deepEqual(await buildDiagnosticsExecutableBinding(path), row.executable);
  await writeFile(path, Buffer.concat([row.bytes, Buffer.from('Different original bytes\n')]));
  assert.notDeepEqual(await buildDiagnosticsExecutableBinding(path), row.executable);
  const directory = join(root, 'directory');await mkdir(directory);await assert.rejects(buildDiagnosticsExecutableBinding(directory), /ordinary executable/);
  const empty = join(root, 'empty.fixture');await writeFile(empty, '');await assert.rejects(buildDiagnosticsExecutableBinding(empty), /bound/);
  if (process.platform !== 'win32') {const alias = join(root, 'linked.fixture');await symlink(path, alias);await assert.rejects(buildDiagnosticsExecutableBinding(alias), /ordinary executable/);}
});
