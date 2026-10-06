import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {lstat, open, readFile, writeFile} from 'node:fs/promises';
import {join, resolve} from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {CANONICAL_PRACTICE_SOURCE_FILES} from './canonical-practice-source-evidence.mjs';
import {frozenBuildDiagnosticsSource, buildDiagnosticsExecutableBinding, validateBuildDiagnosticsIdentity, validateBuildDiagnosticsCopiedText} from './build-diagnostics-evidence.mjs';
import {verifyNativeProfileEvidence} from './native-profile-evidence.mjs';
import {validateCleanScreenshot} from './verify-native-clean-song-evidence.mjs';

const rootDefault = fileURLToPath(new URL('../', import.meta.url));
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const parse = bytes => JSON.parse(new TextDecoder('utf-8', {fatal: true}).decode(bytes).replace(/^\uFEFF/, ''));
const positive = value => Number.isSafeInteger(value) && value > 0;
function integerTuple(value, length, label) {
  assert.ok(Array.isArray(value) && value.length === length && value.every(number => Number.isSafeInteger(number) && number >= -2147483648 && number <= 2147483647), `${label} requires ${length} signed Win32 integer coordinates`);
  return value;
}
export const BUILD_DIAGNOSTICS_SOURCE_FILES = Object.freeze([...new Set([...CANONICAL_PRACTICE_SOURCE_FILES,
  'crates/desktop-shell/build-diagnostics-acceptance.js', 'scripts/build-diagnostics-evidence.mjs',
  'scripts/verify-native-build-diagnostics.mjs', 'scripts/windows-build-diagnostics.ps1', 'scripts/native-profile-evidence.mjs',
  'tests/build-diagnostics-evidence.test.js', 'tests/native-build-diagnostics-registration.test.js',
  'tests/native-build-diagnostics-evidence.test.js', 'tests/frontend-build-diagnostics-preservation.test.js',
  'tests/canonical-practice-fixtures.js', 'tests/native-storage-app-fixtures.js',
])].sort());
export async function nativeBuildDiagnosticsSourceBinding(root = rootDefault) {
  const source = await frozenBuildDiagnosticsSource(root), source_hashes = {};
  assert.ok(BUILD_DIAGNOSTICS_SOURCE_FILES.length <= 160 && new Set(BUILD_DIAGNOSTICS_SOURCE_FILES).size === BUILD_DIAGNOSTICS_SOURCE_FILES.length);
  for (const path of BUILD_DIAGNOSTICS_SOURCE_FILES) {
    let file = root;for (const part of path.split('/')) { file = join(file, part);assert.equal((await lstat(file)).isSymbolicLink(), false); }
    const stat = await lstat(file);assert.ok(stat.isFile() && stat.size > 0 && stat.size <= 4 * 1024 * 1024);
    const bytes = await readFile(file), committed = execFileSync('git', ['-C', root, 'show', `${source.source_sha}:${path}`], {env: Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_'))), maxBuffer: 4 * 1024 * 1024, timeout: 30000});
    assert.deepEqual(bytes, committed, `Diagnostic source differs from frozen commit: ${path}`);source_hashes[path] = digest(bytes);
  }
  return {...source, source_hashes};
}

export function validateNativeBuildDiagnosticsRenderer(report, {source, executable, host, actions, results}) {
  assert.equal(report.version, 1);assert.equal(report.scenario, 'build-diagnostics');assert.equal(report.phase, 'build-diagnostics');
  assert.equal(report.ok, true, report.error);assert.equal(report.error, undefined);assert.equal(report.origin, 'https://wmh.localhost');
  assert.deepEqual(report.errors, []);assert.equal(report.physicalAudio, false);assert.equal(report.observersRestored, true);assert.equal(report.evidenceSettled, true);
  assert.equal(report.initial.state, 'idle');assert.equal(report.initial.checkbox, false);assert.equal(report.initial.clock.running, false);
  assert.equal(report.final.checkbox, false);assert.equal(report.final.open, false);assert.equal(report.final.clock.running, false);
  assert.equal(report.final.clock.positionMs, report.initial.clock.positionMs);
  assert.deepEqual(report.roles, {open: 1, read: 2, include: 5, close: 8, reopen: 9, refresh: 10, finalClose: 13});
  const ids = ['settings-button', 'build-diagnostics-read', 'build-diagnostics-copy', 'build-diagnostics-select', 'build-diagnostics-include-path', 'build-diagnostics-copy', 'build-diagnostics-select', null, 'settings-button', 'build-diagnostics-read', 'build-diagnostics-copy', 'build-diagnostics-select', null];
  assert.equal(report.actions, 13);assert.equal(host.actions, 13);
  assert.equal(report.controls.length, 13);assert.equal(actions.length, 13);assert.equal(results.length, 13);
  let windowId;
  for (const [index, id] of ids.entries()) {
    const sequence = index + 1, control = report.controls[index], action = actions[index], result = results[index];
    assert.equal(control.sequence, sequence);assert.equal(control.id, id);assert.equal(control.closePanel, id === null ? 'settings' : null);
    assert.deepEqual(Object.keys(action).sort(), ['version', 'sequence', 'kind', 'x', 'y', 'width', 'height'].sort());
    assert.equal(action.version, 1);assert.equal(action.sequence, sequence);assert.equal(action.kind, 'click');
    for (const key of ['x', 'y', 'width', 'height']) assert.ok(Number.isFinite(action[key]) && action[key] > 0 && action[key] < 20000);
    assert.ok(action.x < action.width && action.y < action.height);
    assert.ok(Array.isArray(control.samples) && control.samples.length >= 2 && control.samples.length <= 5);
    for (const sample of control.samples) for (const key of ['width', 'height']) assert.ok(Number.isFinite(sample[key]) && sample[key] > 0 && sample[key] < 20000, 'Observed sample viewport must be positive and finite');
    const [before, after] = control.samples.slice(-2);assert.deepEqual(before.target, after.target);assert.equal(before.width, after.width);assert.equal(before.height, after.height);assert.equal(before.hitOwned, true);assert.equal(after.hitOwned, true);
    assert.equal(after.width, action.width, 'Stable sample width differs from requested viewport');assert.equal(after.height, action.height, 'Stable sample height differs from requested viewport');
    const {target, ...request} = control.request;assert.deepEqual(request, action);assert.deepEqual(target, after.target);
    for (const key of ['x', 'y', 'width', 'height']) assert.ok(Number.isFinite(target[key]));assert.ok(target.width > 0 && target.height > 0);
    assert.equal(action.x, target.x + target.width / 2);assert.equal(action.y, target.y + target.height / 2);
    assert.deepEqual(control.clicks, [{sequence, id, owned: true, trusted: true}], 'Actual trusted click must identify the requested diagnostic control');
    assert.equal(result.ok, true, result.error);const native = result.client_click;
    assert.ok(positive(native.app_hwnd) && positive(native.hit_hwnd) && positive(native.hit_root));
    windowId ??= native.app_hwnd;assert.equal(native.app_hwnd, windowId);assert.equal(native.foreground, windowId);assert.equal(native.hit_root, windowId);
    integerTuple(native.actual, 2, 'Actual pointer');integerTuple(native.requested, 2, 'Requested pointer');assert.deepEqual(native.actual, native.requested);
    integerTuple(native.viewport, 2, 'Native viewport');assert.deepEqual(native.viewport, [action.width, action.height]);
    const [left, top, right, bottom] = integerTuple(native.client, 4, 'Native client bounds'), [originX, originY] = integerTuple(native.origin, 2, 'Native client origin');
    assert.ok(right > left && bottom > top && right - left <= 2147483647 && bottom - top <= 2147483647, 'Native client dimensions must be positive Win32 integers');
    // NativeAcceptance.ClientClickPoint floors within the half-open client,
    // then adds the actual screen origin, including negative monitor origins.
    assert.deepEqual(native.requested, [originX + Math.floor(action.x * (right - left) / action.width), originY + Math.floor(action.y * (bottom - top) / action.height)], 'Native pointer must match the host CSS-to-client-to-screen floor mapping');
    const [workLeft, workTop, workRight, workBottom] = integerTuple(native.work_area, 4, 'Native work area');
    assert.ok(workRight > workLeft && workBottom > workTop && native.actual[0] >= workLeft && native.actual[0] < workRight && native.actual[1] >= workTop && native.actual[1] < workBottom, 'Actual pointer must be inside the monitor work area');
  }
  assert.equal(report.requests.length, 2);
  for (const [index, request] of report.requests.entries()) {
    assert.equal(request.sequence, index ? 10 : 2);assert.equal(request.path, '/api/diagnostics/build');assert.equal(request.method, 'GET');assert.equal(request.body, null);assert.equal(request.status, 200);
    validateBuildDiagnosticsIdentity(request.data, {source, executable, host});
  }
  const first = report.requests[0].data;assert.deepEqual(report.requests[1].data, first, 'Unchanged process must retain the original cached snapshot on Refresh');
  for (const [field, value] of Object.entries({sourceSha: first.compiled.source_sha, sourceTree: first.compiled.source_tree, sourceCount: first.compiled.source_commit_count, path: first.native.executable_path, hash: first.native.executable_sha256, size: first.native.executable_bytes, processId: first.native.process_id, transport: first.native.transport, os: first.native.os, arch: first.native.arch, target: first.compiled.target})) {
    assert.equal(report.visible[`build-diagnostics-value-${field}`], String(value), `Visible diagnostic ${field} differs from actual API`);
  }
  assert.equal(report.summaries.length, 3);assert.equal(typeof report.clipboardObserved, 'boolean');
  for (const [index, summary] of report.summaries.entries()) {
    assert.equal(summary.label, ['default', 'with-path', 'reopened'][index]);assert.equal(summary.includePath, index === 1);assert.equal(summary.checkbox, index === 1);
    assert.equal(summary.copyAction, [3, 6, 11][index]);assert.equal(summary.selectAction, [4, 7, 12][index]);
    validateBuildDiagnosticsCopiedText(summary.text, first, {includePath: summary.includePath});
    assert.equal(summary.selection.active, 'build-diagnostics-text');assert.equal(summary.selection.start, 0);assert.equal(summary.selection.end, summary.text.length);
    assert.ok(['forward', 'backward', 'none'].includes(summary.selection.direction));
    assert.ok(['Diagnostic text copied.', 'Clipboard access is unavailable. Select the diagnostic text and copy it manually.'].includes(summary.copyStatus));
  }
  assert.ok(Array.isArray(report.writes) && report.writes.length <= 3);
  if (report.clipboardObserved) assert.deepEqual(report.writes.map(row => row.sequence), [3, 6, 11], 'Read/open/refresh/checkbox must never write the clipboard');
  else assert.deepEqual(report.writes, []);
  for (const [index, write] of report.writes.entries()) {
    assert.equal(write.text, report.summaries[index].text);assert.ok(['fulfilled', 'rejected'].includes(write.outcome));
    if (report.summaries[index].copyStatus === 'Diagnostic text copied.') assert.equal(write.outcome, 'fulfilled', 'Never claim clipboard success from a failed/unfinished platform write');
  }
  return report;
}

export async function readNativeBuildDiagnosticsEvidence(directory, name, limit = 1024 * 1024) {
  assert.ok(Number.isSafeInteger(limit) && limit > 0 && limit <= 16 * 1024 * 1024, 'Finite diagnostic evidence read bound required');
  assert.ok(typeof name === 'string' && !/[\\:\0\r\n]/.test(name) && name.split('/').every(part => part && part !== '.' && part !== '..' && !part.toLowerCase().startsWith('webview-')));
  const root = await lstat(directory);assert.ok(root.isDirectory() && !root.isSymbolicLink(), 'Diagnostic evidence root must be an ordinary directory');
  let file = directory;for (const part of name.split('/')) {file = join(file, part);assert.equal((await lstat(file)).isSymbolicLink(), false, 'Linked diagnostic evidence is forbidden');}
  const stat = await lstat(file);assert.ok(stat.isFile() && stat.size > 0 && stat.size <= limit, `Unbounded diagnostic evidence: ${name}`);
  const handle = await open(file, 'r');
  try {
    const opened = await handle.stat();assert.ok(opened.isFile() && opened.dev === stat.dev && opened.ino === stat.ino && opened.size === stat.size, 'Diagnostic evidence changed before opening');
    const bytes = Buffer.alloc(stat.size + 1);let offset = 0;
    while (offset < bytes.length) {const result = await handle.read(bytes, offset, bytes.length - offset, offset);if (result.bytesRead === 0) break;offset += result.bytesRead;}
    assert.equal(offset, stat.size, 'Diagnostic evidence changed size during bounded read');return bytes.subarray(0, offset);
  } finally {await handle.close();}
}
export async function checkStoredNativeBuildDiagnosticsProof(directory, expected) {
  const stored = parse(await readNativeBuildDiagnosticsEvidence(directory, 'build-diagnostics-proof.json'));
  assert.deepEqual(stored, expected, 'Stored build diagnostics proof changed');return stored;
}
export async function verifyNativeBuildDiagnostics(directory, {sourceRoot = rootDefault, sourceBinding, executable = process.env.WMH_BUILD_DIAGNOSTICS_EXECUTABLE} = {}) {
  const source = sourceBinding ?? await nativeBuildDiagnosticsSourceBinding(sourceRoot), files = new Map();let total = 0;
  const root = await lstat(directory);assert.ok(root.isDirectory() && !root.isSymbolicLink());
  async function read(name, limit = 1024 * 1024) {
    const bytes = await readNativeBuildDiagnosticsEvidence(directory, name, limit), row = {path: name, bytes: bytes.length, sha256: digest(bytes)};
    if (files.has(name)) assert.deepEqual(row, files.get(name));else { files.set(name, row);total += bytes.length;assert.ok(files.size <= 128 && total <= 64 * 1024 * 1024); }return bytes;
  }
  const json = async (name, limit) => parse(await read(name, limit));
  const native = await json('native-build-diagnostics.json');assert.equal(native.version, 1);assert.equal(native.ok, true, native.error);assert.equal(native.error, undefined);assert.equal(native.scenario, 'build-diagnostics');assert.equal(native.profile_reused, false);
  for (const key of ['source_sha', 'source_tree', 'source_commit_count', 'source_hashes']) assert.deepEqual(native[key], source[key], `Native diagnostic ${key} differs from frozen source`);
  assert.deepEqual(Object.keys(source.source_hashes).sort(), BUILD_DIAGNOSTICS_SOURCE_FILES);for (const hash of Object.values(source.source_hashes)) assert.match(hash, /^[a-f0-9]{64}$/);
  assert.ok(executable, 'Independent retained diagnostic executable required');const artifact = await buildDiagnosticsExecutableBinding(executable);
  assert.equal(native.executable_sha256, artifact.sha256);assert.equal(native.executable_bytes, artifact.bytes);
  await verifyNativeProfileEvidence(native, ['build-diagnostics'], json);
  assert.equal(native.phases.length, 1);const phase = native.phases[0];assert.equal(phase.phase, 'build-diagnostics');
  for (const key of ['renderer_ok', 'normal_close', 'launched_new_process', 'profile_fresh', 'profile_absent_before_launch']) assert.equal(phase[key], true);
  assert.equal(phase.profile_reused, false);assert.equal(phase.renderer_origin, 'https://wmh.localhost');assert.equal(phase.executable_tcp_listeners, 0);
  assert.ok(Number.isFinite(phase.elapsed_seconds) && phase.elapsed_seconds > 0 && phase.elapsed_seconds <= 240);
  const host = {...native.diagnostic_host, actions: phase.actions};assert.equal(host.process_id, phase.process_id);
  const report = await json('renderer-build-diagnostics.json'), actions = [], results = [];
  assert.equal(report.actions, 13);
  for (let number = 1; number <= report.actions; number++) {actions.push(await json(`action-build-diagnostics-${number}.json`));results.push(await json(`result-build-diagnostics-${number}.json`));}
  validateNativeBuildDiagnosticsRenderer(report, {source, executable: artifact, host, actions, results});
  const before = await json('snapshot-build-diagnostics-before.json'), after = await json('snapshot-build-diagnostics-after.json');
  assert.equal(before.version, 1);assert.ok(Array.isArray(before.files) && before.files.length <= 512);assert.deepEqual(after, before, 'Diagnostic operations changed the host-owned library inventory');
  const trace = await json('trace-build-diagnostics.json');assert.equal(trace.version, 1);assert.equal(trace.phase, 'build-diagnostics');assert.ok(Array.isArray(trace.events) && trace.events.length > 0 && trace.events.length <= 4096);
  assert.ok(!trace.events.some(row => row.event?.stage === 'renderer-report-rejected' || row.event?.path === '/__desktop_smoke/report' && row.event?.stage === 'reply-submitted' && row.event?.status >= 400));
  const api = trace.events.filter(row => row.event?.path === '/api/diagnostics/build' && row.event?.stage === 'received');assert.equal(api.length, 2, 'Host trace must independently observe both actual diagnostic reads');
  for (const number of [2, 4, 7, 12]) {
    const size = validateCleanScreenshot(await read(`native-action-build-diagnostics-${number}.png`, 16 * 1024 * 1024));assert.ok(size.width >= 900 && size.height >= 640);
  }
  return {version: 1, scenario: 'build-diagnostics', ok: true, ...source, executable_sha256: artifact.sha256, executable_bytes: artifact.bytes,
    claims: {native_window: true, actual_process_source_and_file_binding: true, selectable_text: true, observed_clipboard_copies: report.clipboardObserved ? report.writes.filter(row => row.outcome === 'fulfilled').length : null, default_path_omitted: true, library_bytes_unchanged: true, idle_transport_unchanged: true, active_practice_audio: false, physical_audio: false, full_acceptance: false}, files: [...files.values()].sort((a, b) => a.path.localeCompare(b.path))};
}
async function main() {
  const args = process.argv.slice(2);
  if (args[0] === '--source-binding') {assert.ok(args.length <= 2);console.log(JSON.stringify(await nativeBuildDiagnosticsSourceBinding(args[1] ? resolve(args[1]) : rootDefault)));return;}
  const check = args.includes('--check'), names = args.filter(value => value !== '--check');assert.ok(args.filter(value => value === '--check').length <= 1 && names.length === 1 && !names[0].startsWith('--'));
  const directory = resolve(names[0]), proof = await verifyNativeBuildDiagnostics(directory), path = join(directory, 'build-diagnostics-proof.json');
  if (check) await checkStoredNativeBuildDiagnosticsProof(directory, proof);else await writeFile(path, `${JSON.stringify(proof, null, 2)}\n`);
  console.log('Verified exact native diagnostic identity, explicit private summary and unchanged owned library');
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) main().catch(error => {console.error(error.stack || error);process.exitCode = 1;});
