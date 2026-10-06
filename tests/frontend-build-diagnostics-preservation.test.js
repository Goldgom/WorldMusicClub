// Production app/shell and DSP core under original in-memory DOM/audio/native
// fixtures. This verifies integration behavior, not a browser or Windows run.
import test from 'node:test';
import assert from 'node:assert/strict';
import {canonicalPracticeApp} from './canonical-practice-fixtures.js';
import {setupBuildDiagnosticsView} from '../web/build-diagnostics-view.js';
import {getAppI18n} from '../web/app-locale.js';
import {readPlaybackClock} from '../web/playback-clock-view.js';
import {validateBuildDiagnosticsCopiedText} from '../scripts/build-diagnostics-evidence.mjs';

const PATH = '/api/diagnostics/build';
const originalResponse = () => ({
  schema_version: 1,
  compiled: {package_version: '0.2.0', source_sha: 'a'.repeat(40), source_tree: 'b'.repeat(40), source_commit_count: 7, source_status: 'clean', source_error: null, target: 'x86_64-pc-windows-msvc'},
  native: {
    transport: 'native-protocol-no-listener', process_id: 42, os: 'windows', arch: 'x86_64',
    executable_path: 'C:\\Original fixtures\\worldmusichub-desktop.exe', executable_sha256: 'c'.repeat(64), executable_bytes: 123,
    executable_hash_status: 'ok', executable_error: null, executable_checked_at_unix_ms: 1700000000000,
    executable_hash_scope: 'current_executable_path_file', executable_cache: 'once_per_process',
  },
});
const response = (value, status = 200) => new Response(JSON.stringify(value), {status, headers: {'content-type': 'application/json'}});
const key = {code: 'KeyR', key: 'r'};

async function activeOriginalPractice() {
  const fixture = await canonicalPracticeApp(), {app, score} = fixture;
  app.$('count-in').checked = false;
  await app.click('start-complete-practice');
  for (const box of app.$('complete-practice-parts').querySelectorAll('input')) box.checked = box.value === score.parts[0].id;
  await app.click('complete-practice-apply');await app.until(() => app.$('canonical-audio-policy').dataset.rendererState === 'playing');
  const zero = app.sourceStartWall();fixture.time(zero + 60);await app.tick();app.frame();
  app.emit(app.$('stage-title'), 'keydown', key);await app.tick();
  assert.equal(readPlaybackClock(app.document).running, true);
  return {...fixture, zero};
}
function attach(app, server, copied) {
  // When used before the bootstrap change lands, compose the exact production
  // view in the already-created production Settings shell. After integration,
  // the app has already installed it and uses the same fixture clipboard.
  globalThis.navigator.clipboard = {writeText: async text => { copied.push(text); }};
  if (app.$('build-diagnostics')) return null;
  return setupBuildDiagnosticsView({document: app.document, i18n: getAppI18n(app.document), fetcher: server.fetcher, origin: 'https://wmh.localhost'});
}
async function settledTake(app) {
  await app.until(() => !app.$('export-takes').disabled);
  return app.exported('export-takes');
}

test('Settings diagnostic Read/Copy pauses active original practice, preserves the whole take/library and never resumes audio', async () => {
  const fixture = await activeOriginalPractice(), {app, server, zero} = fixture, copied = [], payload = originalResponse();
  const view = attach(app, server, copied);fixture.setRoute(({path}) => path === PATH ? response(payload) : undefined);
  try {
    assert.equal(app.requests.filter(row => row.path === PATH).length, 0);assert.equal(copied.length, 0);
    const library = structuredClone([...server.records]);
    await app.click('settings-button');app.emit(app.$('stage-title'), 'keyup', key);
    await app.until(() => !readPlaybackClock(app.document).running && !app.$('play-button').disabled);
    assert.equal(app.$('settings-dialog').open, true);
    assert.equal(app.document.querySelector('#keyboard .pressed,#keyboard-map .held'), null);
    const before = await settledTake(app), source = await app.exported('export-button');
    assert.ok(before.passes.some(pass => pass.inputs.length > 0), 'The preserved original take must not be empty');
    const paused = readPlaybackClock(app.document), graph = structuredClone(app.audioGraphEvents), requestStart = app.requests.length;
    assert.equal(copied.length, 0);
    await app.click('build-diagnostics-read');await app.until(() => app.$('build-diagnostics').dataset.state === 'ready');
    assert.equal(copied.length, 0);assert.equal(app.$('build-diagnostics-value-sourceCount').textContent, '7');
    await app.click('build-diagnostics-copy');await app.until(() => copied.length === 1);
    validateBuildDiagnosticsCopiedText(copied[0], payload);
    app.$('build-diagnostics-include-path').checked = true;app.emit(app.$('build-diagnostics-include-path'), 'change');
    assert.equal(copied.length, 1);await app.click('build-diagnostics-copy');await app.until(() => copied.length === 2);
    validateBuildDiagnosticsCopiedText(copied[1], payload, {includePath: true});
    app.emit(app.$('build-diagnostics-text'), 'keydown', key);app.emit(app.$('build-diagnostics-text'), 'keyup', key);
    app.$('settings-dialog').close();assert.equal(app.$('build-diagnostics-include-path').checked, false);
    fixture.time(zero + 500);await app.tick();app.frame();
    assert.equal(readPlaybackClock(app.document).running, false);assert.equal(readPlaybackClock(app.document).positionMs, paused.positionMs);
    await app.click('settings-button');assert.equal(app.$('build-diagnostics-include-path').checked, false);
    await app.click('build-diagnostics-copy');await app.until(() => copied.length === 3);
    validateBuildDiagnosticsCopiedText(copied[2], payload);
    app.$('settings-dialog').close();fixture.time(zero + 900);await app.tick();app.frame();
    assert.equal(readPlaybackClock(app.document).running, false);assert.equal(readPlaybackClock(app.document).positionMs, paused.positionMs);
    assert.deepEqual(app.audioGraphEvents, graph, 'Diagnostic actions cannot create/reconnect/resume audio nodes');
    assert.deepEqual(await settledTake(app), before);assert.deepEqual(await app.exported('export-button'), source);
    assert.deepEqual([...server.records], library);
    assert.deepEqual(app.requests.slice(requestStart).map(row => [row.path, row.options.method, row.body]), [[PATH, 'GET', null]], 'Only the explicit read may access a backend route');
    assert.equal(copied.length, 3);
  } finally {view?.destroy();await app.close();}
});

for (const legacy of ['404', 'health-0.2.0']) test(`legacy ${legacy} diagnostics stay unknown without changing an existing paused take`, async () => {
  const fixture = await activeOriginalPractice(), {app, server, zero} = fixture, copied = [];
  const view = attach(app, server, copied);
  fixture.setRoute(({path}) => path === PATH ? response(legacy === '404' ? {error: 'Not found'} : {ok: true, version: '0.2.0'}, legacy === '404' ? 404 : 200) : undefined);
  try {
    await app.click('settings-button');app.emit(app.$('stage-title'), 'keyup', key);await app.until(() => !app.$('play-button').disabled);
    const before = await settledTake(app), library = structuredClone([...server.records]), requests = app.requests.length;
    await app.click('build-diagnostics-read');await app.until(() => app.$('build-diagnostics').dataset.state === 'unsupported');
    for (const field of ['sourceSha', 'sourceTree', 'sourceCount', 'path', 'hash']) assert.equal(app.$(`build-diagnostics-value-${field}`).textContent, 'Unknown');
    assert.equal(copied.length, 0);await app.click('build-diagnostics-copy');await app.until(() => copied.length === 1);
    assert.match(copied[0], /compiled.source_sha: unknown/);assert.match(copied[0], /native.executable_sha256: unknown/);assert.doesNotMatch(copied[0], /native.executable_path:|source_commit_count: 545/);
    app.$('settings-dialog').close();fixture.time(zero + 500);await app.tick();app.frame();
    assert.equal(readPlaybackClock(app.document).running, false);assert.deepEqual(await settledTake(app), before);assert.deepEqual([...server.records], library);
    assert.deepEqual(app.requests.slice(requests).map(row => row.path), [PATH], 'Legacy diagnostics must not fall back to health or other endpoints');
  } finally {view?.destroy();await app.close();}
});
