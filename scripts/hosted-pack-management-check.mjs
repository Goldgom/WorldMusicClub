import {waitForSongMod,startSongModPerformance} from './hosted-song-mod-controls.mjs';
// Separate, opt-in hosted acceptance. Never run locally to bypass a browser denial.
// Real Chromium + production loopback assets + socket-free exact-source native stdio.
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {mkdir, mkdtemp, readFile, writeFile} from 'node:fs/promises';
import {join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {startVsqNativeDriver} from '../tests/vsq-native-driver-fixtures.js';
import {observeRealAudio} from '../tests/browser-input-fixtures.js';
import {installPlaybackClockReader, readPlaybackClock, waitForPlaybackClockAdvance} from '../tests/browser-playback-clock.js';
import {assertCleanExportInventory} from '../tests/clean-song-package-fixtures.js';
import {validateCleanScreenshot} from './verify-native-clean-song-evidence.mjs';
import {managementRequest, checkedManagementResponse} from '../web/library-management-contract.js';
import {startHostedAssetServer, createHostedNativeBridge, NATIVE_PROTOCOL_ORIGIN} from './hosted-worklet-assets.mjs';
import {managementHostedRoute, observeManagementWorkletLoads, validateManagementHostedOrigin, validateManagementWorkletLoads, validateManagementNativeBridge} from './management-hosted-runtime.mjs';
import {PACK_MANAGEMENT_LIMITS as LIMIT, originalPackManagementFixtures, fixtureManifest, writeOriginalFixtures, requireHostedPackManagement, moveOriginalReceiptsAside, originalLibraryInventory, assertOriginalManagementInventory, assertSelectedLegacyExport, inspectOriginalManagementZip, practiceBaselineReady, assertSettledPracticeExport, assertPracticePointerCapture, sha256} from './pack-management-acceptance-fixtures.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const git = (...args) => execFileSync('git', args, {cwd: root, encoding: 'utf8'}).trim();
const sourceSha = git('rev-parse', 'HEAD');
requireHostedPackManagement(process.env, sourceSha, git('status', '--porcelain', '--untracked-files=normal'));
assert.ok(process.env.WMH_SERVER_BINARY, 'An already-built exact-source practice-server is required');
const output = resolve(process.env.WMH_ARTIFACT_DIR || join(root, 'test-results/pack-management'));
await mkdir(output, {recursive: true});
const owned = await mkdtemp(join(output, 'original-run-')), library = join(owned, 'Scores'), binary = resolve(process.env.WMH_NATIVE_IMPORT_DRIVER), serverBinary = resolve(process.env.WMH_SERVER_BINARY);
await writeFile(join(owned, 'ORIGINAL-ACCEPTANCE-ROOT'), 'pack-management-original-only-v1\n', {flag: 'wx'});
for (const folder of ['fixtures', 'api', 'downloads']) await mkdir(join(owned, folder));
const fixture = originalPackManagementFixtures(); await writeOriginalFixtures(join(owned, 'fixtures'), fixture);
const report = {version: 1, kind: 'original-pack-management-hosted-real-native-stdio', source_sha: sourceSha, source_tree: git('rev-parse', 'HEAD^{tree}'), driver_sha256: sha256(await readFile(binary)), viewport: {width: 1280, height: 720}, locale: 'zh-CN', fixture: fixtureManifest(fixture), source_hashes: {}, api: [], actions: [], screenshots: [], downloads: [], page_errors: [], cases: [], process_ids: [], ok: false, claims: {browser: true, native_filesystem: true, native_window: false, physical_audio: false, user_library: false, private_music: false, destructive_management: false}};
report.hosted_origin = null; report.native_protocol_origin = NATIVE_PROTOCOL_ORIGIN;
report.host = {origin: null, hosted_origin: null, native_protocol_origin: NATIVE_PROTOCOL_ORIGIN, asset_server: {}, processes: []};
for (const filename of ['scripts/hosted-pack-management-check.mjs', 'scripts/pack-management-acceptance-fixtures.mjs', 'scripts/hosted-worklet-assets.mjs', 'scripts/management-hosted-runtime.mjs', 'web/app.js', 'web/practice-recorder.js', 'web/playback-clock-view.js', 'tests/browser-playback-clock.js','web/song-mod.js','web/song-mod-view.js','web/part-instrument-policy.js','web/skin-format.js','web/skin-runtime.js','web/skin-settings.js','web/skin-storage.js','web/skin-settings.css','scripts/hosted-song-mod-controls.mjs', 'web/library-management-contract.js', 'web/library-management-model.js', 'web/library-management-view.js', 'web/library-management.css', 'tests/vsq-native-driver-fixtures.js']) report.source_hashes[filename] = sha256(await readFile(join(root, filename)));
let driver, browser, context, page, assetServer, origin, nativeBridge, processHost, sessionClosePromise, phase = 'import', cancelled = false, timeout;
const committed = new Map();
const recordCase = (name, details = {}) => report.cases.push({name, ...details, ok: true});
async function closeWithin(resource, name) {
  let timer;
  try { return await Promise.race([resource.close(), new Promise((_, reject) => { timer = setTimeout(() => reject(Error(`${name} cleanup exceeded 5000ms`)), 5000); })]); }
  finally { clearTimeout(timer); }
}
async function closeSession() {
  if (sessionClosePromise) return sessionClosePromise;
  const ownedContext = context, ownedPage = page, ownedDriver = driver, ownedBridge = nativeBridge, host = processHost;
  ownedBridge?.stopAdmission();
  context = page = driver = nativeBridge = processHost = null;
  sessionClosePromise = (async () => {
    const errors = [];
    if (host) {
      try {
        assert.ok(ownedPage, 'No owned page was created for worklet diagnostics');
        host.worklet_loads = await closeWithin({close: () => ownedPage.evaluate(() => globalThis.__wmhManagementWorkletLoads ?? null)}, 'worklet diagnostics');
      } catch (error) { host.diagnostics_error = String(error.stack || error); errors.push(error); }
    }
    // Keep admitted native operations alive until the owned page is closed, then
    // drain their bridge before closing the real socket-free native process.
    for (const [name, resource] of [['context', ownedContext], ['native-requests', ownedBridge && {close: () => ownedBridge.drain()}], ['driver', ownedDriver]]) if (resource) {
      const cleanup = {status: 'closing'}; if (host) host.cleanup[name] = cleanup;
      try { await closeWithin(resource, name); cleanup.status = 'closed'; }
      catch (error) { cleanup.status = 'failed'; cleanup.error = String(error.stack || error); errors.push(error); }
    }
    if (errors.length) throw new AggregateError(errors, errors.map(error => String(error)).join('; '));
  })();
  return sessionClosePromise;
}
const action = async (name, run) => {
  assert.equal(cancelled, false, 'Hosted run expired'); assert.ok(report.actions.length < LIMIT.actions, 'UI action bound');
  const row = {sequence: report.actions.length + 1, name}; report.actions.push(row); await run(); row.completed = true;
};
async function native(path, options = {}, source = 'browser', ownedDriver = driver) {
  assert.equal(cancelled, false); assert.ok(report.api.length < LIMIT.api, 'Native request bound');
  const body = options.body ? Buffer.from(options.body) : Buffer.alloc(0);
  const row = {sequence: report.api.length + 1, process_id: ownedDriver.pid, phase, source, path, method: options.method || 'GET', request_bytes: body.length, request_sha256: sha256(body)};
  report.api.push(row);
  if (path === '/api/library/manage/query' || path === '/api/library/pack/export' || path === '/api/library/import/export') row.request = JSON.parse(body);
  let response, bytes;
  try { response = await ownedDriver.fetcher(path, options); bytes = await response.bytes(); }
  catch (error) { row.error = String(error.stack || error); throw error; }
  Object.assign(row, {status: response.status, bytes: bytes.length, sha256: sha256(bytes)});
  if (path.startsWith('/api/library/import/') || path === '/api/library/manage/query' || path === '/api/library/pack/export' || path === '/api/health' || path === '/api/assess') {
    row.file = `api/${String(row.sequence).padStart(3, '0')}${response.contentType.includes('json') ? '.json' : '.bin'}`;
    await writeFile(join(owned, row.file), bytes, {flag: 'wx'});
  }
  if (response.contentType.includes('json')) {
    const result = JSON.parse(bytes);
    if (path === '/api/library/manage/query' && response.ok) checkedManagementResponse(result, managementRequest(row.request));
    if (path === '/api/library/import/commit' && response.ok) {
      const filename = decodeURIComponent(options.headers?.['x-wmh-filename'] || '');
      committed.set(filename, result); row.filename = filename;
    }
  }
  return {...response, bytes: async () => bytes, row};
}
async function query(body) {
  const response = await native('/api/library/manage/query', {method: 'POST', headers: {'content-type': 'application/json'}, body: JSON.stringify(managementRequest(body))}, 'independent-contract-check');
  assert.equal(response.status, 200); return JSON.parse(await response.bytes());
}
async function uiQuery(label, click) {
  let response;
  await action(label, async () => {
    const pending = page.waitForResponse(value => new URL(value.url()).pathname === '/api/library/manage/query');
    await click(); response = await pending;
    assert.equal(response.status(), 200);
    await page.waitForFunction(() => document.querySelector('#library-management-dialog')?.dataset.phase === 'ready');
  });
  return response.json();
}
const view = name => uiQuery(`Browse ${name}`, () => page.locator(`[data-management-view="${name}"]`).click());
async function screenshot(name) {
  assert.ok(report.screenshots.length < 16);
  const filename = `${name}-1280x720-zh.png`; await page.screenshot({path: join(owned, filename), fullPage: false});
  const bytes = await readFile(join(owned, filename)); validateCleanScreenshot(bytes);
  assert.equal(bytes.readUInt32BE(16), 1280); assert.equal(bytes.readUInt32BE(20), 720);
  report.screenshots.push({file: filename, bytes: bytes.length, sha256: sha256(bytes), phase});
}
async function download(selector, filename) {
  const pending = page.waitForEvent('download'); await page.locator(selector).click(); const result = await pending;
  const file = `downloads/${filename}`; await result.saveAs(join(owned, file));
  const bytes = await readFile(join(owned, file)); assert.ok(bytes.length > 0 && bytes.length < LIMIT.libraryBytes);
  report.downloads.push({file, suggested_filename: result.suggestedFilename(), bytes: bytes.length, sha256: sha256(bytes)}); return bytes;
}
async function captureScoreAndTake(suffix) {
  await page.locator('#score-tools-button').click(); const score = await download('#export-button', `active-score-${suffix}.json`); await page.locator('[data-close-panel="score-tools"]').click();
  await page.locator('#results-button').click();
  if (suffix === 'before') await action('Finish real practice assessment before freezing the preservation baseline', async () => {
    await page.locator('#assess-button:not([disabled])').waitFor({state: 'visible'});
    const response = page.waitForResponse(value => new URL(value.url()).pathname === '/api/assess');
    await page.locator('#assess-button').click(); assert.equal((await response).status(), 200);
    await page.waitForFunction(practiceBaselineReady, undefined, {timeout: 15000});
    report.practice_baseline = {dom: await page.locator('#result-summary').evaluate(node => ({phase: node.dataset.phase, pass_id: node.dataset.passId, revision: node.dataset.revision, assessed_revision: node.dataset.assessedRevision})), assessment_api: report.api.filter(row => row.path === '/api/assess').map(row => ({sequence: row.sequence, status: row.status, sha256: row.sha256, file: row.file}))};
  });
  const take = await download('#export-takes', `practice-take-${suffix}.json`);
  const value = JSON.parse(take), settled = assertSettledPracticeExport(value), pointer = assertPracticePointerCapture(value);
  if (suffix === 'before') Object.assign(report.practice_baseline, {passes: settled, pointer});
  await page.locator('[data-close-panel="results"]').click();
  return {score, take};
}
async function browserState() {
  return page.evaluate(() => ({score: document.querySelector('#score-title').textContent, preview: document.querySelector('#song-lobby').dataset.previewId, mode: document.querySelector('#session-mode').value, progress: document.querySelector('#progress').value, transport: document.querySelector('#transport-status').textContent, audio: {...window.audioObservation}}));
}
async function launch() {
  assert.equal(cancelled, false, 'Hosted run expired'); sessionClosePromise = null;
  driver = startVsqNativeDriver({binary, directory: library, cwd: root, requestTimeoutMs: 15000, closeTimeoutMs: 3000}); report.process_ids.push(driver.pid);
  const ownedDriver = driver; let ownedPage;
  const bridge = createHostedNativeBridge({origin, getOwnedPage: () => ownedPage}); nativeBridge = bridge;
  processHost = {phase, process_id: driver.pid, native_bridge: bridge.evidence, worklet_loads: null, cleanup: {}}; report.host.processes.push(processHost);
  context = await browser.newContext({viewport: report.viewport, locale: report.locale, acceptDownloads: true, serviceWorkers: 'block'});
  await context.addInitScript(`localStorage.setItem('worldmusichub.locale.v1','zh-CN');(${observeManagementWorkletLoads.toString()})();(${observeRealAudio.toString()})();`);
  await context.route(url => managementHostedRoute(url, origin), async route => {
    const request = route.request(), url = new URL(request.url());
    try {
      assert.equal(url.origin, origin, `Unexpected external request: ${url.origin}`);
      if (url.pathname.startsWith('/api/')) {
        await bridge.run(request, async (headers, bridgeRow) => {
          const response = await native(url.pathname + url.search, {method: request.method(), headers, body: request.postDataBuffer() || undefined}, 'browser', ownedDriver);
          Object.assign(bridgeRow, {native_sequence: response.row.sequence, native_request_sha256: response.row.request_sha256, native_request_bytes: response.row.request_bytes, native_status: response.row.status, native_response_sha256: response.row.sha256});
          try { await route.fulfill({status: response.status, contentType: response.contentType, body: await response.bytes()}); }
          catch (error) { if (!bridge.closing) throw error; response.row.delivery = 'context-closed-during-cleanup'; }
        }); return;
      }
      throw Error(`Unexpected hosted management control request: ${url.pathname}`);
    } catch (error) { report.page_errors.push(String(error.stack || error)); try { await route.abort(); } catch {} }
  });
  page = await context.newPage(); ownedPage = page; page.setDefaultTimeout(15000); page.setDefaultNavigationTimeout(15000);
  page.on('pageerror', error => report.page_errors.push(String(error.stack || error)));
  await page.goto(origin); assert.equal(await page.locator('html').getAttribute('lang'), 'zh-CN');
  await installPlaybackClockReader(page);
  await page.locator('#home-single-player').click(); await waitForSongMod(page);
}
async function importFiles(inputs, label) {
  await action(label, async () => {
    await page.locator('#import-tools-button').click(); const picker = page.waitForEvent('filechooser'); await page.locator('#import-button').click();
    await (await picker).setFiles(inputs.map(value => ({name: value.filename, mimeType: value.filename.endsWith('.zip') ? 'application/zip' : 'application/json', buffer: value.bytes})));
    await page.waitForFunction(count => document.querySelector('#bulk-import-dialog')?.dataset.phase === 'review' && document.querySelectorAll('#bulk-import-groups [data-phase="ready"]').length === count, inputs.length);
    await page.locator('#bulk-import-save').click();
    await page.waitForFunction(count => document.querySelector('#bulk-import-dialog')?.dataset.phase === 'review' && document.querySelectorAll('#bulk-import-groups [data-phase="complete"]').length === count, inputs.length);
    for (const value of inputs) {
      const receipt = committed.get(value.filename); assert.ok(receipt, `Missing real commit response for ${value.filename}`);
      assert.equal(receipt.source.sha256, value.sha256); assert.equal(receipt.source.bytes, value.bytes.length); assert.equal(receipt.source.retained, true);
      assert.equal(receipt.summary.error, 0); assert.equal(receipt.summary.conflict, 0);
    }
    await page.locator('#bulk-import-done').click();
    if (await page.locator('#import-tools-dialog').isVisible()) await page.locator('[data-close-panel="import-tools"]').click();
  });
}
async function run() {
  try { assetServer = await startHostedAssetServer({root, sourceSha, binary: serverBinary, evidence: report.host.asset_server}); }
  finally { origin = report.host.asset_server.origin ?? null; report.host.origin = report.host.hosted_origin = report.hosted_origin = origin; }
  const {chromium} = await import('playwright'); browser = await chromium.launch({headless: true, timeout: 20000}); await launch();
  await importFiles(fixture.initial, 'Import six ORIGINAL files through the real multiple file picker');
  await importFiles(fixture.retries, 'Retry the exact standalone and backup bytes under new Unicode filenames');
  assert.equal(await page.locator('#catalog [data-library-key]').count(), LIMIT.songs);
  const primaryReceipt = committed.get(fixture.primary.filename), backupReceipt = committed.get(fixture.backup.filename);
  assert.equal(primaryReceipt.items.filter(row => row.status === 'saved').length, 41);
  assert.ok(primaryReceipt.items.every(row => row.path.includes('原创/深层 目录/')));
  assert.deepEqual(backupReceipt.items.map(row => row.path), [`${fixture.backup.filename}#entries/0`, `${fixture.backup.filename}#entries/1`]);
  for (const value of fixture.retries) assert.equal(committed.get(value.filename).summary.duplicate, value.scores.length);
  recordCase('real-picker-unicode-paths-backup-virtual-entries-and-renamed-retries');
  // The only filesystem mutation outside normal imports moves our own new receipt copies.
  report.receipt_fixture = await moveOriginalReceiptsAside(owned, fixture.unresolved.archive_key);
  const sharedEntry = primaryReceipt.items.find(item => item.entry?.score_id === fixture.shared.id).entry;
  await action('Create a paused ORIGINAL practice take', async () => {
    await page.locator(`#catalog [data-library-key="native:${sharedEntry.key}"]`).click();
    await waitForSongMod(page);
    await startSongModPerformance(page,{performers:'none'}); await page.waitForFunction(() => document.body.dataset.screen === 'stage' && /暂停/.test(document.querySelector('#play-button').textContent));
    await page.locator('#settings-button').click(); await page.locator('#count-in').uncheck(); await page.locator('[data-close-panel="settings"]').click(); await page.locator('#back-to-library').click();
    await startSongModPerformance(page,{performers:'all'}); await page.waitForFunction(() => document.body.dataset.screen === 'stage' && /暂停/.test(document.querySelector('#play-button').textContent));
    // Pause is published before the renderer's future source anchor. An early
    // live key is correctly unscored; this fixture needs a real in-take input.
    report.practice_input = {clock_before_wait: await page.locator('#progress').evaluate(readPlaybackClock)};
    await waitForPlaybackClockAdvance(page);
    report.practice_input.clock_before_pointer = await page.locator('#progress').evaluate(readPlaybackClock);
    assert.equal(await page.locator('#hud-captured').textContent(), '0');
    await page.locator('#keyboard [data-midi="60"]').click();
    await page.waitForFunction(() => document.querySelector('#hud-captured').textContent === '1');
    report.practice_input.captured_before_pause = await page.locator('#hud-captured').textContent();
    await page.locator('#back-to-library').click();
  });
  const before = await captureScoreAndTake('before');
  let savedRecording, draftRecording;
  await action('Keep one saved and one unsaved free recording', async () => {
    await page.locator('#lobby-home').click(); await page.locator('#start-free-practice').click(); await page.locator('#free-start').click();
    await page.locator('#free-practice-title').focus(); await page.keyboard.press('r'); await page.locator('#free-stop').click();
    if (!await page.locator('#free-recordings').evaluate(node => node.open)) await page.locator('#free-recordings-toggle').click();
    await page.locator('#free-save').click(); await page.waitForFunction(() => document.querySelector('#free-save').disabled && !document.querySelector('#free-export-record').disabled && document.querySelector('#free-practice-screen').getAttribute('aria-busy') === 'false');
    savedRecording = await download('#free-export-record', 'free-saved-before.json');
    assert.deepEqual(JSON.parse(savedRecording).observations.events.filter(event => event.kind === 'note_on' && event.input_kind === 'typing_keyboard' && event.routing === 'recording_segment').map(event => event.midi), [60], 'Saved free recording must contain the actual R-key onset');
    await page.locator('#free-start').click(); await page.locator('#free-practice-title').focus(); await page.keyboard.press('z'); await page.locator('#free-stop').click();
    draftRecording = await download('#free-export-draft', 'free-draft-before.json'); assert.notDeepEqual(savedRecording, draftRecording);
    assert.deepEqual(JSON.parse(draftRecording).observations.events.filter(event => event.kind === 'note_on' && event.input_kind === 'typing_keyboard' && event.routing === 'recording_segment').map(event => event.midi), [36], 'Unsaved free draft must contain the actual Z-key onset');
    await page.locator('#free-exit').click();
  });
  const stateBefore = await browserState(); report.state_before = stateBefore;
  const inventoryBefore = await originalLibraryInventory(library); await writeFile(join(owned, 'library-before.json'), JSON.stringify(inventoryBefore, null, 2));
  phase = 'manage';
  const packs = await uiQuery('Open read-only management', () => page.locator('#library-management-button').click());
  assert.equal(await page.locator('#management-title').textContent(), '本机曲库管理'); assert.equal(packs.total, LIMIT.packs);
  const rect = await page.locator('#library-management-dialog').boundingBox(); assert.ok(rect.x >= 0 && rect.y >= 0 && rect.x + rect.width <= 1280 && rect.y + rect.height <= 721);
  assert.equal(await page.locator('#library-management-dialog [data-delete], #library-management-dialog [data-trash], #library-management-dialog [data-rename]').count(), 0);
  const unresolvedRow = page.locator(`[data-management-pack-row="${fixture.unresolved.pack_id}"]`);
  assert.equal(await unresolvedRow.getAttribute('data-management-provenance'), 'unresolved'); assert.match(await unresolvedRow.textContent(), /乐曲归属尚未确认/);
  await screenshot('management-packs');
  const primarySongs = await uiQuery('Inspect verified original pack membership', () => page.locator(`[data-management-pack-row="${fixture.primary.pack_id}"] [data-management-pack]`).click());
  assert.equal(primarySongs.total, 41); assert.ok(primarySongs.rows.every(row => row.pack_ids.includes(fixture.primary.pack_id)));
  assert.match(await page.locator('#management-rows').textContent(), /<仅文本>/); assert.equal(await page.locator('#management-rows').evaluate(node => node.querySelector('仅文本')), null);
  const allFirst = await view('songs'); assert.equal(allFirst.rows.length, LIMIT.page); assert.equal(await page.locator('[data-management-song]').count(), LIMIT.page);
  const boxes = page.locator('[data-management-edition]'); await boxes.first().check();
  assert.equal(await page.locator('#management-select-page').evaluate(node => node.indeterminate), true);
  const allSecond = await uiQuery('Read second bounded page', () => page.locator('#management-next').click());
  assert.equal(allSecond.rows.length, 5); assert.equal(allSecond.snapshot_id, allFirst.snapshot_id); assert.equal(allSecond.freshness.cached, true);
  assert.match(await page.locator('#management-selected').textContent(), /1/); assert.equal(await page.locator('#management-clear-hidden').isDisabled(), false);
  await screenshot('management-page-two-hidden-selection');
  await page.locator('#management-clear-hidden').click(); assert.equal(await page.locator('#management-clear').isDisabled(), true);
  await uiQuery('Return to the first page', () => page.locator('#management-previous').click());
  const queryCount = report.api.filter(row => row.path === '/api/library/manage/query').length;
  await page.locator('#management-search').fill(fixture.backupOnly.title);
  assert.equal(report.api.filter(row => row.path === '/api/library/manage/query').length, queryCount, 'Typing must not submit a query');
  const searched = await uiQuery('Submit explicit Unicode search', () => page.locator('#management-search-form [type="submit"]').click());
  assert.deepEqual(searched.rows.map(row => row.score_id), [fixture.backupOnly.id]); assert.equal(searched.freshness.cached, true);
  await screenshot('management-explicit-search');
  const unfiled = await view('unfiled'); assert.deepEqual(unfiled.rows.map(row => row.score_id), [fixture.unresolved.scores[0].id]); assert.equal(unfiled.rows[0].pack_count, 0);
  await screenshot('management-unfiled');
  const duplicateRows = await view('duplicates'); assert.equal(duplicateRows.rows.length, 1);
  await page.locator('[data-management-group] > summary').click(); assert.match(await page.locator('#management-rows').textContent(), /已复用同一份/);
  assert.equal(await page.locator('#management-rows input[type="checkbox"]').count(), 0); await screenshot('management-duplicates');
  for (const category of ['same_id', 'same_title']) {
    const result = await uiQuery(`Inspect ${category} evidence without merging`, () => page.locator('#management-category').selectOption(category)); assert.equal(result.total, 0);
  }
  await view('packs');
  const sourceIssues = await uiQuery('Read original retained-source diagnostics', () => page.locator(`[data-management-pack-row="${fixture.sourceOnly.pack_id}"]`).getByRole('button', {name: '来源与导入问题', exact: true}).click());
  assert.ok(sourceIssues.rows.length > 0); assert.equal(await page.locator('#management-selection').isVisible(), false);
  for (const detail of await page.locator('[data-management-issue] details > summary').all()) await detail.click();
  await screenshot('management-source-only-issues');
  await view('packs');
  const unresolvedIssues = await uiQuery('Read unresolved source diagnostics', () => page.locator(`[data-management-pack-row="${fixture.unresolved.pack_id}"]`).getByRole('button', {name: '来源与导入问题', exact: true}).click());
  assert.ok(unresolvedIssues.rows.some(row => row.archive_key === fixture.unresolved.archive_key));
  const issues = await view('issues');
  const songs = {...allFirst, rows: [...allFirst.rows, ...allSecond.rows], next_cursor: null};
  report.inventory = assertOriginalManagementInventory(fixture, {packs, songs, duplicates: duplicateRows, issues}, committed.get(fixture.sourceOnly.filename));
  recordCase('honest-six-pack-membership-all-unfiled-duplicate-and-issue-views');
  recordCase('bounded-pagination-explicit-search-hidden-selection');
  // Revisit All, select exactly one edition per storage kind, then export each named format.
  const all = await view('songs'), cleanSong = songs.rows.find(row => row.storage_kind === 'clean'), legacySong = all.rows.find(row => row.storage_kind === 'legacy');
  await page.locator(`[data-management-edition="${legacySong.edition_id}"]`).check();
  if (!all.rows.some(row => row.edition_id === cleanSong.edition_id)) await uiQuery('Reach selected complete song page', () => page.locator('#management-next').click());
  await page.locator(`[data-management-edition="${cleanSong.edition_id}"]`).check();
  const legacyExport = await download('#management-export-legacy', 'selected-legacy.zip');
  const legacyCall = report.api.filter(row => row.path === '/api/library/pack/export').at(-1); assert.deepEqual(legacyCall.request.keys, [legacySong.key]);
  const completeExport = await download('#management-export-clean', 'selected-clean.zip');
  const cleanCall = report.api.filter(row => row.path === '/api/library/pack/export').at(-1); assert.deepEqual(cleanCall.request.keys, [cleanSong.key]);
  assertCleanExportInventory(inspectOriginalManagementZip(completeExport), fixture.cleanFixture, cleanSong.key);
  assertSelectedLegacyExport(inspectOriginalManagementZip(legacyExport), legacySong, [...committed.values()]);
  await screenshot('management-explicit-selected-exports'); recordCase('explicit-legacy-and-complete-selected-exports', {legacy_key: legacySong.key, clean_key: cleanSong.key});
  await action('Close with Escape and restore opener focus', () => page.keyboard.press('Escape'));
  assert.equal(await page.locator('#library-management-dialog').isVisible(), false); assert.equal(await page.evaluate(() => document.activeElement?.id), 'library-management-button');
  await uiQuery('Reopen without carrying selection', () => page.locator('#library-management-button').click()); assert.equal(await page.locator('#management-clear').isDisabled(), true);
  await uiQuery('Explicitly refresh the verified snapshot', () => page.locator('#management-refresh').click());
  await action('Close management by its button', () => page.locator('#management-close').click()); recordCase('escape-close-reopen-refresh-and-focus');
  assert.deepEqual(await browserState(), stateBefore);
  const managedCalls = report.api.filter(row => row.phase === 'manage'); assert.ok(managedCalls.every(row => ['/api/library/manage/query', '/api/library/pack/export'].includes(row.path)), 'Browsing/export must not activate, import, save or delete anything');
  const inventoryAfter = await originalLibraryInventory(library); assert.deepEqual(inventoryAfter, inventoryBefore); await writeFile(join(owned, 'library-after.json'), JSON.stringify(inventoryAfter, null, 2));
  phase = 'state-verification';
  const after = await captureScoreAndTake('after'); assert.deepEqual(after.score, before.score); assert.deepEqual(after.take, before.take);
  await page.locator('#lobby-home').click(); await page.locator('#start-free-practice').click(); assert.deepEqual(await download('#free-export-draft', 'free-draft-after.json'), draftRecording); assert.deepEqual(await download('#free-export-record', 'free-saved-after.json'), savedRecording);
  const databases = await page.evaluate(async () => (await indexedDB.databases()).map(row => row.name)); assert.equal(databases.includes('worldmusichub.scores.v1'), false);
  await screenshot('management-preserved-free-recordings'); recordCase('byte-equivalent-active-score-practice-take-saved-and-unsaved-free-recordings', {library_files_unchanged: inventoryAfter.length, browser_score_fallback: false});
  await closeSession();
  phase = 'restart'; await launch();
  assert.equal(await page.locator('#catalog [data-library-key]').count(), LIMIT.songs);
  const restarted = await uiQuery('Fresh native process and browser profile reopens persisted metadata', () => page.locator('#library-management-button').click());
  const restartedSongs = await query({view: 'songs', limit: 100}), restartedDuplicates = await query({view: 'duplicates', limit: 100}), restartedIssues = await query({view: 'issues', limit: 100});
  assertOriginalManagementInventory(fixture, {packs: restarted, songs: restartedSongs, duplicates: restartedDuplicates, issues: restartedIssues}, committed.get(fixture.sourceOnly.filename));
  assert.notEqual(report.process_ids[0], report.process_ids[1]); await screenshot('management-fresh-process-restart'); recordCase('fresh-process-and-profile-persisted-provenance');
  assert.deepEqual(report.page_errors, []); assert.equal(cancelled, false); report.ok = true;
}
try {
  await Promise.race([run(), new Promise((_, reject) => { timeout = setTimeout(() => { cancelled = true; reject(Error(`Pack-management hosted run exceeded ${LIMIT.runtimeMs}ms`)); }, LIMIT.runtimeMs); })]);
} catch (error) {
  report.ok = false; report.error = String(error.stack || error); process.exitCode = 1;
  if (page && !cancelled) try { await screenshot('management-failure'); } catch {}
} finally {
  clearTimeout(timeout); cancelled = true;
  try { await closeSession(); } catch (error) { report.ok = false; process.exitCode = 1; (report.cleanup_errors ||= []).push(`session: ${String(error)}`); }
  for (const [name, resource] of [['browser', browser], ['asset-server', assetServer]]) if (resource) try { await closeWithin(resource, name); } catch (error) { report.ok = false; process.exitCode = 1; (report.cleanup_errors ||= []).push(`${name}: ${String(error)}`); }
  if (report.ok) try {
    validateManagementHostedOrigin(report.host, report, sourceSha);
    assert.equal(report.host.processes.length, 2);
    assert.deepEqual(report.host.processes.map(row => row.process_id), report.process_ids);
    for (const host of report.host.processes) {
      for (const name of ['context', 'native-requests', 'driver']) assert.equal(host.cleanup[name]?.status, 'closed');
      assert.equal(host.diagnostics_error, undefined);
      validateManagementWorkletLoads(host.worklet_loads, origin, {required: host.phase === 'import'});
      validateManagementNativeBridge(host.native_bridge, origin, report.api.filter(row => row.process_id === host.process_id && row.source === 'browser'));
    }
    assert.deepEqual(report.page_errors, []);
  } catch (error) { report.ok = false; process.exitCode = 1; report.error = String(error.stack || error); }
  await writeFile(join(owned, 'report.json'), JSON.stringify(report, null, 2) + '\n');
  await writeFile(join(output, 'latest-run.json'), JSON.stringify({directory: owned, report: join(owned, 'report.json'), source_sha: sourceSha, ok: report.ok}, null, 2) + '\n');
}
if (!report.ok) throw Error(report.error || JSON.stringify(report.cleanup_errors));
