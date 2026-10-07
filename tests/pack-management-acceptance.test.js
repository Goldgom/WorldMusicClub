import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {mkdtemp, mkdir, readFile, readdir, rm, symlink, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {storedZip} from './native-import-driver-fixtures.js';
import {songRow, packRow, managementServer} from './library-management-fixtures.js';
import {nativeStorageApp, nativeResponse, deferred} from './native-storage-app-fixtures.js';
import {checkedManagementResponse, managementRequest} from '../web/library-management-contract.js';
import {readPlaybackClock} from './browser-playback-clock.js';
import {PACK_MANAGEMENT_LIMITS, originalPackManagementFixtures, fixtureManifest, writeOriginalFixtures, requireHostedPackManagement, moveOriginalReceiptsAside, originalLibraryInventory, assertOriginalManagementInventory, inspectOriginalManagementZip, practiceBaselineReady, assertSettledPracticeExport, assertPracticePointerCapture, sha256} from '../scripts/pack-management-acceptance-fixtures.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const ownedRoot = async t => {
  const directory = await mkdtemp(join(tmpdir(), 'wmc-original-management-contract-'));
  t.after(() => rm(directory, {recursive: true, force: true})); return directory;
};

test('ORIGINAL management inputs are deterministic, bounded and cross a real 40-row page boundary', () => {
  const first = originalPackManagementFixtures(), second = originalPackManagementFixtures();
  assert.deepEqual(fixtureManifest(first), fixtureManifest(second));
  assert.equal(first.initial.length, 6); assert.equal(first.expectedSongs.length, 45);
  assert.equal(new Set(first.expectedSongs.map(score => `${score.kind}:${score.id}`)).size, 45);
  assert.equal(first.primary.scores.length, 41); assert.ok(first.initial.reduce((sum, row) => sum + row.bytes.length, 0) < PACK_MANAGEMENT_LIMITS.inputBytes);
  for (const [index, input] of first.initial.entries()) {
    assert.deepEqual(input.bytes, second.initial[index].bytes); assert.equal(input.sha256, sha256(input.bytes));
    for (const score of input.scores) { assert.equal(score.provenance.kind, 'original_exercise'); assert.equal(score.provenance.license, 'CC0-1.0'); assert.match(score.source.content, /ORIGINAL test-only/); }
  }
  assert.equal(first.primary.sha256, '8f0408ded59bdfd077d1366a3a4b29d38046bd8b68a7c6c114e2b71d08c25455');
});

test('Unicode ZIP members and backup virtual candidates retain independent physical source bytes', () => {
  const fixture = originalPackManagementFixtures(), inventory = inspectOriginalManagementZip(fixture.primary.bytes);
  assert.equal(Object.keys(inventory).length, 41);
  assert.ok(Object.keys(inventory).every(name => /^原创\/深层 目录\/练习 \d+\/乐谱\.wmhscore\.json$/.test(name)));
  for (const [index, score] of fixture.primary.scores.entries()) assert.equal(inventory[`原创/深层 目录/练习 ${index + 1}/乐谱.wmhscore.json`].sha256, sha256(JSON.stringify(score, null, 2) + '\n'));
  const backup = JSON.parse(fixture.backup.bytes); assert.equal(backup.format, 'worldmusichub-library-backup'); assert.equal(backup.version, 1);
  assert.deepEqual(backup.entries.map(row => row.score.id), [fixture.shared.id, fixture.backupOnly.id]);
  assert.equal(fixture.sourceOnly.scores.length, 0); const retained = inspectOriginalManagementZip(fixture.sourceOnly.bytes); assert.equal(Object.keys(retained).length, 2); assert.ok(retained['原创源文件/song/source/original.mid']);
  assert.equal(fixture.cleanFixture.metadata.media.length, 0); assert.equal(fixture.cleanFixture.score.notation.source, null);
});

test('renamed standalone and backup retries change labels but not source identity or payload', () => {
  const fixture = originalPackManagementFixtures();
  for (const retry of fixture.retries) {
    const original = fixture.initial.find(row => row.role === retry.role);
    assert.notEqual(retry.filename, original.filename); assert.deepEqual(retry.bytes, original.bytes);
    assert.equal(retry.pack_id, original.pack_id); assert.equal(retry.archive_key, original.archive_key);
  }
});

test('in-memory export inspection rejects oversized input and over-limit ZIP inventories', () => {
  assert.throws(() => inspectOriginalManagementZip(Buffer.alloc(PACK_MANAGEMENT_LIMITS.libraryBytes + 1)));
  const tooMany = storedZip(Array.from({length: 65}, (_, index) => [`original-${index}.txt`, 'ORIGINAL']));
  assert.throws(() => inspectOriginalManagementZip(tooMany));
});

test('hosted gate rejects local, dirty, wrong-source and missing-driver runs before execution', () => {
  const head = 'a'.repeat(40), env = {GITHUB_ACTIONS: 'true', WMH_HOSTED_BROWSER: '1', WMH_SOURCE_SHA: head, WMH_NATIVE_IMPORT_DRIVER: '/test-owned/native_import_driver'};
  assert.doesNotThrow(() => requireHostedPackManagement(env, head, ''));
  for (const patch of [{GITHUB_ACTIONS: undefined}, {WMH_HOSTED_BROWSER: undefined}, {WMH_SOURCE_SHA: 'b'.repeat(40)}, {WMH_NATIVE_IMPORT_DRIVER: undefined}]) assert.throws(() => requireHostedPackManagement({...env, ...patch}, head, ''));
  assert.throws(() => requireHostedPackManagement(env, head, ' M web/app.js'), /source must be clean/);
  assert.throws(() => requireHostedPackManagement(env, 'not-a-commit', ''), /match/);
  const result = spawnSync(process.execPath, ['scripts/hosted-pack-management-check.mjs'], {cwd: root, env: {...process.env, GITHUB_ACTIONS: '', WMH_HOSTED_BROWSER: ''}, encoding: 'utf8', timeout: 10000});
  assert.equal(result.status, 1); assert.match(result.stderr, /requires an authorized hosted Actions runner/);
});

// Exercise the actual runner teardown with pure boundaries. Loading the hosted
// entrypoint itself would try its guarded native/browser setup, which these
// tests must never execute locally.
async function hostedSessionCleanup(resources) {
  const source = await readFile(new URL('../scripts/hosted-pack-management-check.mjs', import.meta.url), 'utf8');
  const start = source.indexOf('async function closeWithin('), end = source.indexOf('\nconst action =', start);
  assert.ok(start >= 0 && end > start, 'Hosted session cleanup declarations must be present');
  return new Function('assert', 'resources', `
    let {context, page, driver, nativeBridge, processHost} = resources;
    let sessionClosePromise;
    ${source.slice(start, end)}
    return closeSession;
  `)(assert, resources);
}

test('hosted session retains failed worklet details and drains before closing native exactly once', async () => {
  const events = [], drain = deferred(), host = {cleanup: {}};
  const worklet = {version: 1, modules: [{url: 'http://127.0.0.1:43123/live-tone-audio-processor.js', status: 'failed', error: {name: 'AbortError', message: 'Original module load failure'}}]};
  const close = await hostedSessionCleanup({
    processHost: host,
    page: {evaluate: async () => { events.push('diagnostics'); return worklet; }},
    context: {close: async () => { events.push('context'); }},
    nativeBridge: {stopAdmission: () => events.push('stop-admission'), drain: async () => { events.push('drain'); await drain.promise; }},
    driver: {close: async () => { events.push('driver'); }}
  });
  const first = close(); await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(events, ['stop-admission', 'diagnostics', 'context', 'drain']);
  assert.deepEqual(host.worklet_loads, worklet);
  const concurrent = close();
  assert.deepEqual(events, ['stop-admission', 'diagnostics', 'context', 'drain'], 'Concurrent final cleanup must await the existing teardown');
  drain.resolve(); await Promise.all([first, concurrent]); await close();
  assert.deepEqual(events, ['stop-admission', 'diagnostics', 'context', 'drain', 'driver']);
  assert.deepEqual(host.cleanup, {context: {status: 'closed'}, 'native-requests': {status: 'closed'}, driver: {status: 'closed'}});
});

test('hosted session cleanup preserves every failure while still releasing later resources', async () => {
  const events = [], host = {cleanup: {}};
  const fail = name => async () => { events.push(name); throw Error(`Original ${name} failure`); };
  const close = await hostedSessionCleanup({
    processHost: host,
    page: {evaluate: fail('diagnostics')},
    context: {close: fail('context')},
    nativeBridge: {stopAdmission: () => events.push('stop-admission'), drain: fail('drain')},
    driver: {close: fail('driver')}
  });
  const checkFailure = error => {
    assert.ok(error instanceof AggregateError); assert.equal(error.errors.length, 4);
    for (const name of ['diagnostics', 'context', 'drain', 'driver']) assert.match(error.message, new RegExp(`Original ${name} failure`));
    return true;
  };
  await assert.rejects(close(), checkFailure); await assert.rejects(close(), checkFailure);
  assert.deepEqual(events, ['stop-admission', 'diagnostics', 'context', 'drain', 'driver']);
  assert.match(host.diagnostics_error, /Original diagnostics failure/);
  for (const [key, failure] of [['context', 'context'], ['native-requests', 'drain'], ['driver', 'driver']]) {
    assert.equal(host.cleanup[key].status, 'failed'); assert.match(host.cleanup[key].error, new RegExp(`Original ${failure} failure`));
  }
});

test('fixture writing is exact and refuses to overwrite prior artifact paths', async t => {
  const directory = await ownedRoot(t), fixture = originalPackManagementFixtures(); await writeOriginalFixtures(directory, fixture);
  assert.equal((await readdir(directory)).length, 9);
  assert.deepEqual(JSON.parse(await readFile(join(directory, 'manifest.json'))), fixtureManifest(fixture));
  for (const input of [...fixture.initial, ...fixture.retries]) assert.deepEqual(await readFile(join(directory, input.filename)), input.bytes);
  await assert.rejects(writeOriginalFixtures(directory, fixture), {code: 'EEXIST'});
});

test('unresolved fixture moves only marked ORIGINAL receipt copies and preserves both source bytes', async t => {
  const directory = await ownedRoot(t), fixture = originalPackManagementFixtures(), original = fixture.unresolved;
  await assert.rejects(moveOriginalReceiptsAside(directory, original.archive_key), {code: 'ENOENT'});
  await writeFile(join(directory, 'ORIGINAL-ACCEPTANCE-ROOT'), 'pack-management-original-only-v1\n');
  for (const area of ['imports', 'import-backups']) {
    const target = join(directory, 'Scores', area, original.archive_key); await mkdir(target, {recursive: true});
    await writeFile(join(target, 'source.bin'), original.bytes); await writeFile(join(target, 'report-original.json'), JSON.stringify({test_only: true, original: original.sha256}));
  }
  const moved = await moveOriginalReceiptsAside(directory, original.archive_key); assert.equal(moved.length, 2);
  for (const row of moved) { assert.equal(sha256(await readFile(join(directory, row.to))), row.sha256); await assert.rejects(readFile(join(directory, row.from)), {code: 'ENOENT'}); }
  for (const area of ['imports', 'import-backups']) assert.deepEqual(await readFile(join(directory, 'Scores', area, original.archive_key, 'source.bin')), original.bytes);
  await assert.rejects(moveOriginalReceiptsAside(directory, '../outside'), /match/);
});

test('byte inventory detects changes and rejects linked fixture content', async t => {
  const directory = await ownedRoot(t); await writeFile(join(directory, 'original.txt'), 'ORIGINAL');
  const before = await originalLibraryInventory(directory); assert.equal(before[0].sha256, sha256('ORIGINAL'));
  assert.deepEqual(await originalLibraryInventory(directory), before);
  await writeFile(join(directory, 'original.txt'), 'ORIGINAL changed'); assert.notDeepEqual(await originalLibraryInventory(directory), before);
  await symlink(join(directory, 'original.txt'), join(directory, 'linked.txt'));
  await assert.rejects(originalLibraryInventory(directory), /No linked files/);
});

// Protocol-only oracle tests. These are not native output, browser evidence or screenshots.
function protocolProjection(fixture) {
  const packs = fixture.initial.map(input => ({...packRow(input.filename), pack_id: input.pack_id, archive_key: input.archive_key, source_bytes: input.bytes.length, song_count: input.role === 'unresolved' ? 0 : input.role === 'clean' ? 1 : input.scores.length, receipt_count: input.role === 'unresolved' ? 0 : ['standalone', 'backup'].includes(input.role) ? 2 : 1, retained_only_count: input.role === 'source-only' ? 1 : 0, provenance: input.role === 'unresolved' ? 'unresolved' : 'validated_receipts'}));
  const pack = role => packs.find(row => row.pack_id === fixture.initial.find(input => input.role === role).pack_id);
  const songs = fixture.expectedSongs.map(score => {
    let memberships = [pack('primary')], receipts = 1;
    if (score.id === fixture.shared.id) { memberships.push(pack('backup')); receipts = 3; }
    else if (score.id === fixture.backupOnly.id) { memberships = [pack('backup')]; receipts = 2; }
    else if (score.id === fixture.standalone.scores[0].id) { memberships = [pack('standalone')]; receipts = 2; }
    else if (score.id === fixture.unresolved.scores[0].id) { memberships = []; receipts = 0; }
    else if (score.kind === 'clean') memberships = [pack('clean')];
    return {...songRow(score.id, {title: score.title, packs: memberships, storage_kind: score.kind}), receipt_reference_count: receipts};
  });
  const shared = songs.find(row => row.score_id === fixture.shared.id), sourceItem = {status: 'retained_nonplayable', code: 'pack_source_only', path: '原创源文件/song/metadata.json', message: 'ORIGINAL source-only diagnostic'};
  const duplicates = [{group_id: `exact_content:${sha256('protocol-only shared')}`, kind: 'exact_content', match: shared.content_sha256, evidence_type: 'shared_edition', edition_count: 1, pack_count: 2, reference_count: 2, editions: [shared]}];
  const issues = [{issue_id: `issue-${sha256('protocol retained')}`, code: sourceItem.code, message: `Source item ${sourceItem.path}: ${sourceItem.message}`, archive_key: fixture.sourceOnly.archive_key, song_key: null}, {issue_id: `issue-${sha256('protocol unresolved')}`, code: 'pack_report_pending', message: 'Retained original has no validated complete import receipt', archive_key: fixture.unresolved.archive_key, song_key: null}];
  const summary = {packs: 6, songs: 45, memberships: 45, shared_songs: 1, unfiled_songs: 1, duplicate_groups: 1, issues: 2};
  const responses = Object.fromEntries(Object.entries({packs, songs, duplicates, issues}).map(([view, rows]) => [view, {format: 'worldmusichub-library-management', version: 1, view, read_only: true, native_only: true, snapshot_id: sha256('protocol-only'), freshness: {kind: 'advisory_snapshot', verified_at_unix_ms: 1700000000000, cached: true, change_detection: 'explicit_refresh', song_integrity: 'verified_at_snapshot'}, summary, total: rows.length, rows, next_cursor: null}]));
  return {responses, sourceReport: {items: [sourceItem]}};
}

test('acceptance oracle requires source-qualified memberships and original diagnostics', () => {
  const fixture = originalPackManagementFixtures(), {responses, sourceReport} = protocolProjection(fixture);
  assert.deepEqual(assertOriginalManagementInventory(fixture, responses, sourceReport), {songs: 45, packs: 6, shared: 1, unfiled: 1, exact_content_groups: 1});
  for (const mutate of [
    value => { value.songs.rows.find(row => row.score_id === fixture.standalone.scores[0].id).source_reference_count = 2; },
    value => { value.packs.rows.find(row => row.pack_id === fixture.unresolved.pack_id).provenance = 'validated_receipts'; },
    value => { value.issues.rows[0].message = 'Generic diagnostic that loses the importer details'; },
    value => { value.duplicates.rows[0].reference_count = 3; },
    value => { value.songs.rows.pop(); },
    value => { value.packs.rows[0].name = 'Unrelated renamed source'; }
  ]) { const changed = structuredClone(responses); mutate(changed); assert.throws(() => assertOriginalManagementInventory(fixture, changed, sourceReport)); }
});

test('current Rust-emitted recovery samples remain accepted without claiming this script ran native code', async () => {
  const responses = JSON.parse(await readFile(new URL('./fixtures/library-management/native-recovery-responses.json', import.meta.url)));
  for (const response of Object.values(responses)) assert.deepEqual(checkedManagementResponse(response, managementRequest({view: response.view, limit: 100})), response);
  const packs = responses.packs.rows; assert.ok(packs.some(row => row.provenance === 'unresolved'));
  assert.ok(packs.some(row => row.retained_only_count > 0));
});

test('practice baseline rejects a pre-anchor pointer, then waits for captured input and settled assessment before preservation', async () => {
  const server = await managementServer(), gate = deferred(); let now = 10000, assessing = false;
  server.setExtraRoute(async ({path}) => {
    if (path === '/api/assess') { assessing = true; await gate.promise; return nativeResponse({hits: [], misses: [], extras: [], accuracy_percent: 0, mean_abs_error_ms: null}); }
  });
  const app = await nativeStorageApp(server, {now: () => now});
  try {
    await app.until(() => !app.$('start-listen').disabled); await app.click('home-single-player');
    assert.equal(app.$('count-in').closest('dialog')?.id, 'settings-dialog', 'Performance layout moves this control into Settings');
    app.$('count-in').checked = false;
    await app.click('start-practice'); await app.until(() => app.document.body.dataset.screen === 'stage' && /Pause/.test(app.$('play-button').textContent));
    // The old hosted fixture clicked at this exact UI state. Real app/recorder
    // code must retain that early event without manufacturing a scored input.
    assert.ok(app.sourceStartWall() > now); app.frame();
    assert.equal(readPlaybackClock(app.document).running, false);
    assert.equal(readPlaybackClock(app.document).phase, 'preparing');
    assert.equal(readPlaybackClock(app.document).positionMs, 0);
    const key = app.$('keyboard').querySelector('[data-midi="60"]');
    app.emit(key, 'pointerdown', {pointerId: 8, button: 0}); app.emit(key, 'pointerup', {pointerId: 8});
    app.frame(); assert.equal(app.$('hud-captured').textContent, '0');
    const early = await app.exported('export-takes');
    assert.deepEqual(early.passes[0].inputs, []); assert.deepEqual(early.passes[0].captures, []);
    const earlyOnset = early.input_evidence.events.find(event => event.kind === 'note_on');
    assert.equal(earlyOnset.input_kind, 'on_screen_pointer'); assert.equal(earlyOnset.event_wall_ms, now);
    assert.equal(earlyOnset.onset_capture, null); assert.throws(() => assertPracticePointerCapture(early), /Exactly one practice input/);
    // Advancing only a render quantum past the source anchor cannot make a
    // still-earlier wall timestamp a valid input or settled practice baseline.
    now=app.sourceStartWall()-1.2;app.renderAudioTo((now-10000)/1000);
    for(const harness of app.audioHarnesses)harness.renderBlock(128);
    app.frame();assert.equal(readPlaybackClock(app.document).phase,'preparing');
    assert.equal(readPlaybackClock(app.document).running,false);assert.equal(practiceBaselineReady(app.document),false);
    assert.deepEqual((await app.exported('export-takes')).passes[0].inputs,[]);
    now=app.sourceStartWall()+10;app.renderAudioTo((now-10000)/1000);app.frame();
    assert.equal(readPlaybackClock(app.document).running,true);
    assert.equal(readPlaybackClock(app.document).phase,'playing');
    assert.ok(readPlaybackClock(app.document).positionMs > 0);
    app.emit(key, 'pointerdown', {pointerId: 9, button: 0}); app.emit(key, 'pointerup', {pointerId: 9});
    app.frame(); assert.equal(app.$('hud-captured').textContent, '1');
    await app.click('back-to-library'); await app.click('results-button');
    assert.equal(practiceBaselineReady(app.document), false); await app.click('assess-button');
    now += 179; app.frame(); assert.equal(assessing, false); assert.equal(practiceBaselineReady(app.document), false, 'Input grace is not a stable baseline');
    // Cross the real grace deadline and the app's 100ms idle-render cadence in this controlled Node clock.
    now += 101; app.frame(); await app.until(() => assessing, 'Explicit assessment did not enter the native route');
    assert.equal(practiceBaselineReady(app.document), false, 'An in-flight native response is not a stable baseline');
    const pending = await app.exported('export-takes'); assert.throws(() => assertSettledPracticeExport(pending), /pending/);
    gate.resolve(); await app.until(() => !app.$('feedback-results').hidden && !app.$('assess-button').disabled, 'Completed assessment did not reach the Results surface');
    assert.equal(practiceBaselineReady(app.document), true, JSON.stringify({phase: app.$('result-summary').dataset.phase, pass: app.$('result-summary').dataset.passId, revision: app.$('result-summary').dataset.revision, assessed: app.$('result-summary').dataset.assessedRevision, retryHidden: app.$('retry-assessments').hidden}));
    const before = await app.exported('export-takes'), settled = assertSettledPracticeExport(before);
    assert.deepEqual(settled, [{id: 1, revision: 1, assessed_revision: 1, pending: false, inputs: 1}]);
    assert.deepEqual(assertPracticePointerCapture(before).input, {midi: 60, at_ms: 10, velocity: 90});
    assert.deepEqual(before.input_evidence.events.find(event => event.kind === 'note_on'), earlyOnset, 'Waiting never rewrites the rejected early observation');
    for (const mutate of [
      take => { take.passes[0].inputs.push({...take.passes[0].inputs[0]}); },
      take => { take.passes[0].captures[0].event_wall_ms--; },
      take => { take.input_evidence.events.find(event => event.onset_capture).input_kind = 'typing_keyboard'; },
      take => { take.input_evidence.events.find(event => event.onset_capture).onset_capture.event_id++; },
      take => { take.input_evidence.truncated = true; },
    ]) { const changed = structuredClone(before); mutate(changed); assert.throws(() => assertPracticePointerCapture(changed)); }
    for (const mutate of [pass => { pass.pending = true; }, pass => { pass.manual_deadline_wall_ms = now + 180; }, pass => { pass.assessed_revision--; }, pass => { pass.error = 'Original failed assessment'; }, pass => { pass.assessment = null; }, pass => { pass.clock_segments.at(-1).wallEnd = null; }]) {
      const changed = structuredClone(before); mutate(changed.passes[0]); assert.throws(() => assertSettledPracticeExport(changed));
    }
    app.document.querySelector('[data-close-panel="results"]').click();
    await app.click('library-management-button'); await app.until(() => app.$('library-management-dialog').dataset.phase === 'ready'); await app.click('management-close');
    assert.deepEqual(await app.exported('export-takes'), before); assert.equal(server.requests.filter(row => row.path === '/api/assess').length, 1);
  } finally { gate.resolve(); await app.close(); }
});
