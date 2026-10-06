// Independent diagnostic contracts only. Original model fixtures never prove
// an actual Windows run; the process owner must capture the host facts below.
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {lstat, readFile, realpath} from 'node:fs/promises';
import {win32} from 'node:path';

const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const safe = value => Number.isSafeInteger(value) && value >= 0;
const hash = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const oid = value => typeof value === 'string' && /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(value);
const noControls = value => !/[\u0000-\u001f\u007f-\u009f\u2028\u2029\u202a-\u202e\u2066-\u2069]/u.test(value);
const exactKeys = (value, expected, label) => {
  assert.ok(object(value), `${label} must be an object`);
  assert.deepEqual(Object.keys(value).sort(), [...expected].sort(), `${label} keyset changed`);
};
export const BUILD_DIAGNOSTICS_MAX_EXECUTABLE_BYTES = 256 * 1024 * 1024;
export const BUILD_DIAGNOSTICS_ACCEPTED_TRANSPORT = 'native-protocol-no-listener';

/** Migration guard: an expanded budget cannot silently drop old evidence. */
export function validateBuildDiagnosticsInventoryExtension(baseline, actual, {additions, maxFiles} = {}) {
  assert.ok(Array.isArray(baseline) && Array.isArray(actual) && Array.isArray(additions));
  assert.ok(safe(maxFiles) && maxFiles > 0 && maxFiles <= 160, 'Explicit finite source capacity required');
  for (const names of [baseline, actual, additions]) {
    assert.equal(new Set(names).size, names.length, 'Duplicate bound source module');
    for (const name of names) assert.ok(typeof name === 'string' && name.length < 1024 && /^[A-Za-z0-9_.-]+(?:\/[A-Za-z0-9_.-]+)*$/.test(name) && name.split('/').every(part => part !== '.' && part !== '..'), 'Unsafe source module path');
  }
  assert.ok(actual.length <= maxFiles, 'Source inventory exceeds its explicit capacity');
  assert.deepEqual([...actual].sort(), [...new Set([...baseline, ...additions])].sort(), 'Source inventory must retain every old binding and exactly the declared additions');
  return actual;
}

/** Read a full, clean checkout directly. Never read a release sidecar. */
export async function frozenBuildDiagnosticsSource(root) {
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_')));
  const git = (...args) => execFileSync('git', ['--no-optional-locks', '-C', root, ...args], {
    encoding: 'utf8', env, maxBuffer: 1024 * 1024, timeout: 30000, stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
  assert.equal(await realpath(git('rev-parse', '--show-toplevel')), await realpath(root), 'Expected the actual checkout root');
  assert.equal(git('rev-parse', '--is-shallow-repository'), 'false', 'Full Git history is required for an exact source count');
  assert.equal(git('status', '--porcelain=v1', '--untracked-files=normal'), '', 'Frozen diagnostic source must be clean');
  const source_sha = git('rev-parse', '--verify', 'HEAD');
  const source_tree = git('rev-parse', '--verify', `${source_sha}^{tree}`);
  const countText = git('rev-list', '--count', source_sha);
  assert.ok(oid(source_sha) && oid(source_tree));
  assert.match(countText, /^[1-9][0-9]*$/);
  const source_commit_count = Number(countText);
  assert.ok(safe(source_commit_count));
  assert.equal(git('rev-parse', '--verify', 'HEAD'), source_sha, 'Source changed during capture');
  return {source_sha, source_tree, source_commit_count, source_status: 'clean', source_error: null};
}

/** Hash the independently selected artifact, without executing it. */
export async function buildDiagnosticsExecutableBinding(path) {
  const before = await lstat(path, {bigint: true});
  assert.ok(before.isFile() && !before.isSymbolicLink(), 'An ordinary executable file is required');
  assert.ok(before.size > 0n && before.size <= BigInt(BUILD_DIAGNOSTICS_MAX_EXECUTABLE_BYTES), 'Executable exceeds diagnostic bound');
  const bytes = await readFile(path), after = await lstat(path, {bigint: true});
  for (const key of ['dev', 'ino', 'size', 'mtimeNs', 'ctimeNs']) assert.equal(after[key], before[key], 'Executable changed while independently hashing');
  assert.equal(BigInt(bytes.length), before.size);
  return {sha256: createHash('sha256').update(bytes).digest('hex'), bytes: bytes.length};
}

export function canonicalWindowsExecutablePath(value) {
  assert.ok(typeof value === 'string' && value.length > 0 && value.length <= 4096 && noControls(value), 'Invalid Windows executable path');
  let path = value.replaceAll('/', '\\');
  if (/^\\\\\?\\UNC\\/i.test(path)) path = `\\\\${path.slice(8)}`;
  else if (/^\\\\\?\\[a-z]:\\/i.test(path)) path = path.slice(4);
  assert.ok(/^[a-z]:\\/i.test(path) || /^\\\\[^\\]+\\[^\\]+\\/.test(path), 'Executable path must be absolute');
  assert.ok(!path.split('\\').includes('..'), 'Executable path cannot contain parent traversal');
  return win32.normalize(path).toLowerCase();
}

/** Both independent inputs are mandatory; response fields never supply them. */
export function validateBuildDiagnosticsIdentity(response, {source, executable, host} = {}) {
  exactKeys(response, ['schema_version', 'compiled', 'native'], 'Diagnostic response');
  assert.equal(response.schema_version, 1);
  assert.ok(object(source) && object(executable) && object(host), 'Independent source, executable, and host capture are required');
  for (const key of ['source_sha', 'source_tree']) assert.ok(oid(source[key]), `Missing frozen ${key}`);
  assert.ok(safe(source.source_commit_count) && source.source_commit_count > 0);
  assert.equal(source.source_status, 'clean');assert.equal(source.source_error, null);
  const compiled = response.compiled, native = response.native;
  exactKeys(compiled, ['package_version', 'source_sha', 'source_tree', 'source_commit_count', 'source_status', 'source_error', 'target'], 'Compiled identity');
  for (const key of ['source_sha', 'source_tree', 'source_commit_count', 'source_status', 'source_error']) assert.equal(compiled[key], source[key], `Compiled ${key} differs from frozen Git`);
  assert.ok(typeof compiled.package_version === 'string' && compiled.package_version.length > 0 && compiled.package_version.length <= 64 && noControls(compiled.package_version));
  assert.match(host.target, /^[a-zA-Z0-9_.-]{1,96}$/);assert.match(host.target, /-windows-/);
  assert.equal(compiled.target, host.target, 'Compiled target differs from Windows build target');
  exactKeys(native, ['transport', 'process_id', 'os', 'arch', 'executable_path', 'executable_sha256', 'executable_bytes', 'executable_hash_status', 'executable_error', 'executable_checked_at_unix_ms', 'executable_hash_scope', 'executable_cache'], 'Native identity');
  assert.equal(native.transport, BUILD_DIAGNOSTICS_ACCEPTED_TRANSPORT);
  assert.equal(native.os, 'windows');assert.match(host.arch, /^[a-z0-9_]{1,32}$/);assert.equal(native.arch, host.arch);
  assert.ok(safe(host.process_id) && host.process_id > 0);assert.equal(native.process_id, host.process_id, 'Diagnostic PID differs from owned process');
  assert.equal(host.executable_tcp_listeners, 0);
  const expectedPath = canonicalWindowsExecutablePath(host.launched_executable_path);
  assert.equal(canonicalWindowsExecutablePath(host.process_image_path), expectedPath, 'Windows process image differs from launched executable');
  assert.equal(canonicalWindowsExecutablePath(native.executable_path), expectedPath, 'Diagnostic path differs from owned process image');
  assert.ok(hash(executable.sha256) && safe(executable.bytes) && executable.bytes > 0 && executable.bytes <= BUILD_DIAGNOSTICS_MAX_EXECUTABLE_BYTES);
  for (const capture of [host.executable_before, host.executable_after]) {
    exactKeys(capture, ['sha256', 'bytes'], 'Host executable capture');
    assert.deepEqual(capture, executable, 'Host executable changed or differs from independently retained artifact');
  }
  assert.equal(native.executable_hash_status, 'ok');assert.equal(native.executable_error, null);
  assert.equal(native.executable_hash_scope, 'current_executable_path_file');assert.equal(native.executable_cache, 'once_per_process');
  assert.equal(native.executable_sha256, executable.sha256, 'Diagnostic digest differs from independently retained artifact');
  assert.equal(native.executable_bytes, executable.bytes, 'Diagnostic byte size differs from independently retained artifact');
  for (const key of ['capture_started_unix_ms', 'capture_finished_unix_ms']) assert.ok(safe(host[key]));
  assert.ok(safe(native.executable_checked_at_unix_ms) && native.executable_checked_at_unix_ms >= host.capture_started_unix_ms && native.executable_checked_at_unix_ms <= host.capture_finished_unix_ms, 'Executable snapshot is outside the observed process capture');
  assert.ok(host.capture_finished_unix_ms - host.capture_started_unix_ms <= 240000, 'Native diagnostic capture exceeded four minutes');
  return response;
}

/** Independently inspect actual copied text; never trust a renderer privacy flag. */
export function validateBuildDiagnosticsCopiedText(text, response, {includePath = false} = {}) {
  assert.ok(typeof text === 'string' && Buffer.byteLength(text) <= 32768 && !text.includes('\r'));
  const lines = text.split('\n');assert.equal(lines.shift(), 'WorldMusicClub build diagnostics v1');
  const rows = new Map();
  for (const line of lines) {
    const split = line.indexOf(': ');assert.ok(split > 0, 'Invalid diagnostic copy line');
    const key = line.slice(0, split), value = line.slice(split + 2);
    assert.equal(rows.has(key), false, 'Duplicate diagnostic copy key');rows.set(key, value);
  }
  const expected = {
    'diagnostics.status': 'ready', 'compiled.component': 'Rust backend (not browser assets)',
    'native.hash_note': 'Cached file at executable path; not the loaded memory image',
    ...Object.fromEntries(['source_sha', 'source_tree', 'source_commit_count', 'source_status'].map(key => [`browser_assets.${key}`, 'unknown'])),
  };
  for (const [key, value] of Object.entries(response.compiled)) expected[`compiled.${key}`] = value === null ? 'unknown' : String(value);
  for (const [key, value] of Object.entries(response.native)) if (key !== 'executable_path') expected[`native.${key}`] = value === null ? 'unknown' : String(value);
  if (includePath === true) expected['native.executable_path'] = response.native.executable_path;
  assert.deepEqual(Object.fromEntries(rows), expected, 'Copied diagnostics differ from the observed response or allowed privacy fields');
  if (includePath !== true) {
    assert.equal(text.includes(response.native.executable_path), false, 'Default copy exposed the executable path');
    assert.equal(rows.has('native.executable_path'), false, 'Default copy includes a path field');
  }
  return text;
}
