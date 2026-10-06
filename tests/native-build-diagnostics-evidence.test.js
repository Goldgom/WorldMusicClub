// Original model fixtures only: these bytes never claim to be an actual run.
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, writeFile, mkdir, rm, readFile, symlink} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createHash} from 'node:crypto';
import {deflateSync} from 'node:zlib';
import {BUILD_DIAGNOSTICS_SOURCE_FILES, validateNativeBuildDiagnosticsRenderer, verifyNativeBuildDiagnostics, checkStoredNativeBuildDiagnosticsProof, readNativeBuildDiagnosticsEvidence} from '../scripts/verify-native-build-diagnostics.mjs';
const sha = value => createHash('sha256').update(value).digest('hex');
function fixture({clipboard = 'fulfilled'} = {}) {
  const executableBytes = Buffer.from('Original diagnostic protocol bytes, not an executable.');
  const executable = {sha256: sha(executableBytes), bytes: executableBytes.length};
  const source = {source_sha: 'a'.repeat(40), source_tree: 'b'.repeat(40), source_commit_count: 7, source_status: 'clean', source_error: null, source_hashes: Object.fromEntries(BUILD_DIAGNOSTICS_SOURCE_FILES.map(path => [path, sha(path)]))};
  const host = {actions: 13, process_id: 42, target: 'x86_64-pc-windows-msvc', arch: 'x86_64', executable_tcp_listeners: 0, launched_executable_path: 'C:\\Original\\app.exe', process_image_path: 'C:\\Original\\app.exe', executable_before: {...executable}, executable_after: {...executable}, capture_started_unix_ms: 1000, capture_finished_unix_ms: 2000};
  const response = {schema_version: 1, compiled: {package_version: '0.2.0', source_sha: source.source_sha, source_tree: source.source_tree, source_commit_count: 7, source_status: 'clean', source_error: null, target: host.target}, native: {transport: 'native-protocol-no-listener', process_id: 42, os: 'windows', arch: 'x86_64', executable_path: host.process_image_path, executable_sha256: executable.sha256, executable_bytes: executable.bytes, executable_hash_status: 'ok', executable_error: null, executable_checked_at_unix_ms: 1500, executable_hash_scope: 'current_executable_path_file', executable_cache: 'once_per_process'}};
  const text = includePath => ['WorldMusicClub build diagnostics v1', 'diagnostics.status: ready', 'compiled.component: Rust backend (not browser assets)', ...Object.entries(response.compiled).map(([key, value]) => `compiled.${key}: ${value ?? 'unknown'}`), ...Object.entries(response.native).filter(([key]) => key !== 'executable_path').map(([key, value]) => `native.${key}: ${value ?? 'unknown'}`), 'native.hash_note: Cached file at executable path; not the loaded memory image', ...['source_sha', 'source_tree', 'source_commit_count', 'source_status'].map(key => `browser_assets.${key}: unknown`), ...(includePath ? [`native.executable_path: ${host.process_image_path}`] : [])].join('\n');
  const ids = ['settings-button', 'build-diagnostics-read', 'build-diagnostics-copy', 'build-diagnostics-select', 'build-diagnostics-include-path', 'build-diagnostics-copy', 'build-diagnostics-select', null, 'settings-button', 'build-diagnostics-read', 'build-diagnostics-copy', 'build-diagnostics-select', null];
  const actions = ids.map((_, index) => ({version: 1, sequence: index + 1, kind: 'click', x: 120, y: 115, width: 1280, height: 900}));
  const results = actions.map(action => ({ok: true, client_click: {app_hwnd: 10, foreground: 10, hit_hwnd: 11, hit_root: 10, actual: [120,146], requested: [120,146], client: [0,0,1280,900], origin: [0,31], work_area: [0,0,1920,1080], viewport: [action.width,action.height]}}));
  const target = {x: 100, y: 100, width: 40, height: 30};
  const controls = actions.map((action, index) => ({sequence: action.sequence, id: ids[index], closePanel: ids[index] === null ? 'settings' : null, samples: [0, 1].map(frame => ({frame, target: {...target}, width: 1280, height: 900, hitOwned: true})), request: {...action, target: {...target}}, clicks: [{sequence: action.sequence, id: ids[index], owned: true, trusted: true}]}));
  const report = {version: 1, scenario: 'build-diagnostics', phase: 'build-diagnostics', origin: 'https://wmh.localhost', ok: true, errors: [], actions: 13, controls, physicalAudio: false, observersRestored: true, evidenceSettled: true, initial: {state: 'idle', checkbox: false, clock: {running: false, positionMs: 0, phase: 'ready'}}, final: {checkbox: false, open: false, clock: {running: false, positionMs: 0, phase: 'ready'}}, roles: {open: 1, read: 2, include: 5, close: 8, reopen: 9, refresh: 10, finalClose: 13}, requests: [2, 10].map(sequence => ({sequence, path: '/api/diagnostics/build', method: 'GET', body: null, status: 200, data: structuredClone(response)})), visible: Object.fromEntries(Object.entries({sourceSha: source.source_sha, sourceTree: source.source_tree, sourceCount: 7, path: host.process_image_path, hash: executable.sha256, size: executable.bytes, processId: 42, transport: response.native.transport, os: 'windows', arch: host.arch, target: host.target}).map(([key, value]) => [`build-diagnostics-value-${key}`, String(value)])), clipboardObserved: clipboard !== 'absent', writes: clipboard === 'absent' ? [] : [3, 6, 11].map((sequence, index) => ({sequence, text: text(index === 1), outcome: clipboard})), summaries: ['default', 'with-path', 'reopened'].map((label, index) => ({label, includePath: index === 1, checkbox: index === 1, copyAction: [3, 6, 11][index], selectAction: [4, 7, 12][index], copyStatus: clipboard === 'fulfilled' ? 'Diagnostic text copied.' : 'Clipboard access is unavailable. Select the diagnostic text and copy it manually.', text: text(index === 1), selection: {active: 'build-diagnostics-text', start: 0, end: text(index === 1).length, direction: 'forward'}}))};
  return {report, source, host, executable, executableBytes, actions, results};
}
test('native diagnostics accept observed platform copy and honest unavailable-copy selected-text fallback', () => {
  for (const clipboard of ['fulfilled', 'rejected', 'absent']) {const value = fixture({clipboard});validateNativeBuildDiagnosticsRenderer(value.report, value);}
});
test('native diagnostics reject untrusted controls, automatic sharing, path leakage, fabricated copy and cache/source drift', () => {
  const changes = [
    v => v.report.evidenceSettled = false,
    v => {v.report.writes[0].outcome = 'pending';v.report.summaries[0].copyStatus = 'Clipboard access is unavailable. Select the diagnostic text and copy it manually.';},
    v => v.report.controls[1].clicks[0].trusted = false,
    v => v.report.controls[2].clicks.push({...v.report.controls[2].clicks[0]}),
    v => v.report.controls[2].id = 'unexpected', v => v.results[1].client_click.hit_root = 999,
    v => v.report.requests[0].sequence = 1, v => v.report.requests[0].method = 'POST',
    v => v.report.requests[0].body = {path: 'C:\\Elsewhere'},
    v => v.report.requests[1].data.native.executable_checked_at_unix_ms++,
    v => v.report.requests[1].data.compiled.source_commit_count++,
    v => v.report.visible['build-diagnostics-value-sourceSha'] = 'c'.repeat(40),
    v => v.report.writes[0].sequence = 2,
    v => v.report.writes[0].outcome = 'rejected',
    v => v.report.summaries[0].text += '\nnative.executable_path: C:\\Original\\app.exe',
    v => v.report.summaries[2].checkbox = true,
    v => v.report.summaries[0].selection.end--,
    v => v.report.final.clock.running = true,
    v => v.report.final.clock.positionMs = 10,
    v => v.report.errors.push('Unexpected API during diagnostic interval: /api/library/save'),
  ];
  for (const [index, change] of changes.entries()) {const value = fixture();change(value);assert.throws(() => validateNativeBuildDiagnosticsRenderer(value.report, value), `Mutation ${index}`);}
});
test('native pointer proof rejects absent or aliased tuples, foreign click IDs and missing stable viewport samples', () => {
  const changes = [
    v => {delete v.results[0].client_click.actual;delete v.results[0].client_click.requested;},
    v => {v.results[0].client_click.actual = 'same';v.results[0].client_click.requested = 'same';},
    v => {v.results[0].client_click.actual = [NaN,146];v.results[0].client_click.requested = [NaN,146];},
    v => {v.results[0].client_click.actual = [120.5,146];v.results[0].client_click.requested = [120.5,146];},
    v => {v.results[0].client_click.actual = [121,146];v.results[0].client_click.requested = [121,146];},
    v => {v.results[0].client_click.actual = [120];v.results[0].client_click.requested = [120];},
    v => delete v.results[0].client_click.client,
    v => delete v.results[0].client_click.origin,
    v => delete v.results[0].client_click.viewport,
    v => {v.results[0].client_click.origin = [2147483648,31];},
    v => {v.results[0].client_click.client = [0,0,0,900];},
    v => {v.results[0].client_click.viewport = ['1280','900'];},
    v => {v.results[0].client_click.work_area = [0,0,120,1080];},
    v => {v.report.controls[0].clicks[0].id = 'unrelated-control';},
    v => {for (const sample of v.report.controls[0].samples) {delete sample.width;delete sample.height;}},
    v => {for (const sample of v.report.controls[0].samples) sample.width = '1280';},
    v => {for (const sample of v.report.controls[0].samples) sample.height = 899;},
    v => {v.report.controls[0].samples[0].width = 0;},
  ];
  for (const [index, change] of changes.entries()) {const value = fixture();change(value);assert.throws(() => validateNativeBuildDiagnosticsRenderer(value.report, value), `Pointer mutation ${index}`);}
});
test('native pointer proof preserves fractional CSS targets, actual client scaling and negative screen origins with the host floor rule', () => {
  const value = fixture(), target = {x: 484.5, y: 329.375, width: 40, height: 30};
  Object.assign(value.actions[0], {x: 504.5, y: 344.375});
  Object.assign(value.report.controls[0].request, {...value.actions[0], target});
  for (const sample of value.report.controls[0].samples) sample.target = {...target};
  Object.assign(value.results[0].client_click, {client: [0,0,1024,689], origin: [-1024,31], work_area: [-1024,0,0,720], actual: [-621,294], requested: [-621,294]});
  validateNativeBuildDiagnosticsRenderer(value.report, value);
  value.results[0].client_click.actual = [-620,295];value.results[0].client_click.requested = [-620,295];
  assert.throws(() => validateNativeBuildDiagnosticsRenderer(value.report, value), /floor mapping/);
});
test('stored proof recheck requires bounded ordinary bytes and rejects links even when their JSON is identical', async t => {
  const root = await mkdtemp(join(tmpdir(), 'wmc-diagnostic-proof-contract-'));t.after(() => rm(root, {recursive: true, force: true}));
  const expected = {original: 'protocol fixture only'}, name = 'build-diagnostics-proof.json', path = join(root, name);
  await writeFile(path, JSON.stringify(expected));assert.deepEqual(await checkStoredNativeBuildDiagnosticsProof(root, expected), expected);
  await writeFile(path, JSON.stringify({...expected, padding: 'x'.repeat(1024 * 1024)}));await assert.rejects(checkStoredNativeBuildDiagnosticsProof(root, expected), /Unbounded diagnostic evidence/);
  await writeFile(path, '');await assert.rejects(checkStoredNativeBuildDiagnosticsProof(root, expected), /Unbounded diagnostic evidence/);
  await rm(path);await mkdir(path);await assert.rejects(checkStoredNativeBuildDiagnosticsProof(root, expected), /Unbounded diagnostic evidence/);await rm(path, {recursive: true});
  if (process.platform !== 'win32') {const original = join(root, 'original.json');await writeFile(original, JSON.stringify(expected));await symlink(original, path);await assert.rejects(checkStoredNativeBuildDiagnosticsProof(root, expected), /Linked diagnostic evidence/);await rm(path);}
  await writeFile(path, JSON.stringify(expected));await assert.rejects(readNativeBuildDiagnosticsEvidence(root, name, 8), /Unbounded diagnostic evidence/);
  await assert.rejects(readNativeBuildDiagnosticsEvidence(root, '../original.json'), /assert|false|true/i);
});
function originalPixels() {
  const crc = bytes => {let value = 0xffffffff;for (const byte of bytes) {value ^= byte;for (let bit = 0; bit < 8; bit++) value = value >>> 1 ^ ((value & 1) ? 0xedb88320 : 0);}return (value ^ 0xffffffff) >>> 0;};
  const chunk = (name, bytes) => {const type = Buffer.from(name), size = Buffer.alloc(4), tail = Buffer.alloc(4);size.writeUInt32BE(bytes.length);tail.writeUInt32BE(crc(Buffer.concat([type, bytes])));return Buffer.concat([size, type, bytes, tail]);};
  const width = 900, height = 640, header = Buffer.alloc(13);header.writeUInt32BE(width);header.writeUInt32BE(height, 4);header[8] = 8;header[9] = 2;
  const stride = width * 3 + 1, pixels = Buffer.alloc(stride * height);
  for (let y = 0; y < height; y++) for (let x = 1; x < stride; x++) pixels[y * stride + x] = (x * 37 + y * 53 + (x * y % 97)) % 256;
  return Buffer.concat([Buffer.from('89504e470d0a1a0a', 'hex'), chunk('IHDR', header), chunk('IDAT', deflateSync(pixels)), chunk('IEND', Buffer.alloc(0))]);
}
test('retained protocol evidence binds exact EXE/profile/host source, snapshots, actual reads and screenshots without native claims from tests', async t => {
  const value = fixture({clipboard: 'absent'}), root = await mkdtemp(join(tmpdir(), 'wmc-native-diagnostics-contract-'));t.after(() => rm(root, {recursive: true, force: true}));
  const directory = join(root, 'evidence');await mkdir(directory);const write = (name, data) => writeFile(join(directory, name), JSON.stringify(data));
  const executable = join(root, 'original.fixture');await writeFile(executable, value.executableBytes);
  const library = `${root.replaceAll('\\', '/')}/Scores`, profile = `${root.replaceAll('\\', '/')}/webview-profiles/build-diagnostics`;
  const phase = {phase: 'build-diagnostics', process_id: 42, actions: 13, renderer_ok: true, normal_close: true, launched_new_process: true, profile_fresh: true, profile_reused: false, profile_absent_before_launch: true, profile_directory: profile, renderer_origin: 'https://wmh.localhost', executable_tcp_listeners: 0, elapsed_seconds: 10};
  const native = {version: 1, ok: true, scenario: 'build-diagnostics', profile_reused: false, ...value.source, executable_sha256: value.executable.sha256, executable_bytes: value.executable.bytes, directory: library, diagnostic_host: value.host, phases: [phase]};
  await write('native-build-diagnostics.json', native);await write('renderer-build-diagnostics.json', value.report);
  await write('profile-build-diagnostics.json', {version: 1, phase: 'build-diagnostics', process_id: 42, profile_directory: profile, library_directory: library, fresh_required: true, created_new: true});
  for (const [index, action] of value.actions.entries()) {await write(`action-build-diagnostics-${index+1}.json`, action);await write(`result-build-diagnostics-${index+1}.json`, value.results[index]);}
  const snapshot = {version: 1, files: []};for (const name of ['before', 'after']) await write(`snapshot-build-diagnostics-${name}.json`, snapshot);
  const trace = {version: 1, phase: 'build-diagnostics', events: [1,2].map(() => ({event: {stage: 'received', path: '/api/diagnostics/build'}}))};await write('trace-build-diagnostics.json', trace);
  const png = originalPixels();for (const number of [2,4,7,12]) await writeFile(join(directory, `native-action-build-diagnostics-${number}.png`), png);
  const options = {sourceBinding: value.source, executable};const result = await verifyNativeBuildDiagnostics(directory, options);
  assert.equal(result.claims.observed_clipboard_copies, null);assert.equal(result.claims.active_practice_audio, false);assert.equal(result.claims.full_acceptance, false);
  assert.ok(result.files.length >= 35);
  const profilePath = join(directory, 'profile-build-diagnostics.json'), profileBytes = await readFile(profilePath);
  await write('profile-build-diagnostics.json', {...JSON.parse(profileBytes), original_padding: 'x'.repeat(16 * 1024)});
  await assert.rejects(verifyNativeBuildDiagnostics(directory, options), /Unbounded diagnostic evidence: profile-build-diagnostics.json/);
  await writeFile(profilePath, profileBytes);
  await write('snapshot-build-diagnostics-after.json', {version: 1, files: [{path: 'songs/changed.json', bytes: 3, sha256: sha('new')}]});await assert.rejects(verifyNativeBuildDiagnostics(directory, options), /library inventory/);await write('snapshot-build-diagnostics-after.json', snapshot);
  trace.events.pop();await write('trace-build-diagnostics.json', trace);await assert.rejects(verifyNativeBuildDiagnostics(directory, options), /both actual diagnostic reads/);trace.events.push(trace.events[0]);await write('trace-build-diagnostics.json', trace);
  const changed = structuredClone(native);changed.diagnostic_host.process_id++;await write('native-build-diagnostics.json', changed);await assert.rejects(verifyNativeBuildDiagnostics(directory, options));await write('native-build-diagnostics.json', native);
  await writeFile(executable, 'Changed original fixture');await assert.rejects(verifyNativeBuildDiagnostics(directory, options));
  assert.ok((await readFile(join(directory, 'native-action-build-diagnostics-4.png'))).equals(png));
});
