// Separate, opt-in hosted acceptance. Never run locally to bypass a browser denial.
// Real Chromium + exact-source native stdio; no network listener or mocked API.
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {mkdir, mkdtemp, readFile, writeFile} from 'node:fs/promises';
import {extname, join, resolve, sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import {startVsqNativeDriver} from '../tests/vsq-native-driver-fixtures.js';
import {observeRealAudio} from '../tests/browser-input-fixtures.js';
import {assertCleanExportInventory} from '../tests/clean-song-package-fixtures.js';
import {validateCleanScreenshot} from './verify-native-clean-song-evidence.mjs';
import {managementRequest, checkedManagementResponse} from '../web/library-management-contract.js';
import {PACK_MANAGEMENT_LIMITS as LIMIT, originalPackManagementFixtures, fixtureManifest, writeOriginalFixtures, requireHostedPackManagement, moveOriginalReceiptsAside, originalLibraryInventory, assertOriginalManagementInventory, assertSelectedLegacyExport, inspectOriginalManagementZip, sha256} from './pack-management-acceptance-fixtures.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const git = (...args) => execFileSync('git', args, {cwd: root, encoding: 'utf8'}).trim();
const sourceSha = git('rev-parse', 'HEAD');
requireHostedPackManagement(process.env, sourceSha, git('status', '--porcelain', '--untracked-files=normal'));
const output = resolve(process.env.WMH_ARTIFACT_DIR || join(root, 'test-results/pack-management'));
await mkdir(output, {recursive: true});
const owned = await mkdtemp(join(output, 'original-run-')), library = join(owned, 'Scores'), binary = resolve(process.env.WMH_NATIVE_IMPORT_DRIVER), origin = 'https://wmh.localhost';
await writeFile(join(owned, 'ORIGINAL-ACCEPTANCE-ROOT'), 'pack-management-original-only-v1\n', {flag: 'wx'});
for (const folder of ['fixtures', 'api', 'downloads']) await mkdir(join(owned, folder));
const fixture = originalPackManagementFixtures(); await writeOriginalFixtures(join(owned, 'fixtures'), fixture);
const report = {version: 1, kind: 'original-pack-management-hosted-real-native-stdio', source_sha: sourceSha, source_tree: git('rev-parse', 'HEAD^{tree}'), driver_sha256: sha256(await readFile(binary)), viewport: {width: 1280, height: 720}, locale: 'zh-CN', fixture: fixtureManifest(fixture), source_hashes: {}, api: [], actions: [], screenshots: [], downloads: [], page_errors: [], cases: [], process_ids: [], ok: false, claims: {browser: true, native_filesystem: true, native_window: false, physical_audio: false, user_library: false, private_music: false, destructive_management: false}};
for (const filename of ['scripts/hosted-pack-management-check.mjs', 'scripts/pack-management-acceptance-fixtures.mjs', 'web/app.js', 'web/library-management-contract.js', 'web/library-management-model.js', 'web/library-management-view.js', 'web/library-management.css', 'tests/vsq-native-driver-fixtures.js']) report.source_hashes[filename] = sha256(await readFile(join(root, filename)));
let driver, browser, context, page, phase = 'import', cancelled = false, timeout;
const committed = new Map();
const recordCase = (name, details = {}) => report.cases.push({name, ...details, ok: true});
async function closeWithin(resource, name) {
  let timer;
  try { await Promise.race([resource.close(), new Promise((_, reject) => { timer = setTimeout(() => reject(Error(`${name} cleanup exceeded 5000ms`)), 5000); })]); }
  finally { clearTimeout(timer); }
}
const action = async (name, run) => {
  assert.equal(cancelled, false, 'Hosted run expired'); assert.ok(report.actions.length < LIMIT.actions, 'UI action bound');
  const row = {sequence: report.actions.length + 1, name}; report.actions.push(row); await run(); row.completed = true;
};
async function native(path, options = {}, source = 'browser') {
  assert.equal(cancelled, false); assert.ok(report.api.length < LIMIT.api, 'Native request bound');
  const body = options.body ? Buffer.from(options.body) : Buffer.alloc(0);
  const row = {sequence: report.api.length + 1, phase, source, path, method: options.method || 'GET', request_bytes: body.length, request_sha256: sha256(body)};
  report.api.push(row);
  if (path === '/api/library/manage/query' || path === '/api/library/pack/export' || path === '/api/library/import/export') row.request = JSON.parse(body);
  const response = await driver.fetcher(path, options), bytes = await response.bytes();
  Object.assign(row, {status: response.status, bytes: bytes.length, sha256: sha256(bytes)});
  if (path.startsWith('/api/library/import/') || path === '/api/library/manage/query' || path === '/api/library/pack/export' || path === '/api/health') {
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
  return {...response, bytes: async () => bytes};
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
  await page.locator('#results-button').click(); const take = await download('#export-takes', `practice-take-${suffix}.json`); await page.locator('[data-close-panel="results"]').click();
  return {score, take};
}
async function browserState() {
  return page.evaluate(() => ({score: document.querySelector('#score-title').textContent, preview: document.querySelector('#song-lobby').dataset.previewId, mode: document.querySelector('#session-mode').value, progress: document.querySelector('#progress').value, transport: document.querySelector('#transport-status').textContent, audio: {...window.audioObservation}}));
}
async function launch() {
  driver = startVsqNativeDriver({binary, directory: library, cwd: root, requestTimeoutMs: 15000, closeTimeoutMs: 3000}); report.process_ids.push(driver.pid);
  context = await browser.newContext({viewport: report.viewport, locale: report.locale, acceptDownloads: true, serviceWorkers: 'block'});
  await context.addInitScript(`localStorage.setItem('worldmusichub.locale.v1','zh-CN');(${observeRealAudio.toString()})();`);
  await context.route('**/*', async route => {
    const request = route.request(), url = new URL(request.url());
    if (url.origin !== origin) { report.page_errors.push(`Unexpected external request: ${url.origin}`); await route.abort(); return; }
    try {
      if (url.pathname.startsWith('/api/')) {
        const response = await native(url.pathname + url.search, {method: request.method(), headers: request.headers(), body: request.postDataBuffer() || undefined});
        await route.fulfill({status: response.status, contentType: response.contentType, body: await response.bytes()}); return;
      }
      const file = resolve(root, 'web', '.' + decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname));
      assert.ok(file.startsWith(join(root, 'web') + sep));
      const contentType = ({'.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2'})[extname(file)] || 'application/octet-stream';
      try { await route.fulfill({status: 200, contentType, body: await readFile(file)}); }
      catch (error) { if (error.code !== 'ENOENT') throw error; await route.fulfill({status: 404, body: 'Not found'}); }
    } catch (error) { report.page_errors.push(String(error.stack || error)); await route.abort(); }
  });
  page = await context.newPage(); page.setDefaultTimeout(15000); page.setDefaultNavigationTimeout(15000);
  page.on('pageerror', error => report.page_errors.push(String(error.stack || error)));
  await page.goto(origin); assert.equal(await page.locator('html').getAttribute('lang'), 'zh-CN');
  await page.locator('#home-single-player').click(); await page.waitForFunction(() => !document.querySelector('#start-listen').disabled);
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
    await page.waitForFunction(() => !document.querySelector('#start-listen').disabled);
    await page.locator('#start-listen').click(); await page.waitForFunction(() => document.body.dataset.screen === 'stage' && /暂停/.test(document.querySelector('#play-button').textContent));
    await page.locator('#settings-button').click(); await page.locator('#count-in').uncheck(); await page.locator('[data-close-panel="settings"]').click(); await page.locator('#back-to-library').click();
    await page.locator('#start-practice').click(); await page.waitForFunction(() => document.body.dataset.screen === 'stage' && /暂停/.test(document.querySelector('#play-button').textContent));
    await page.locator('#keyboard [data-midi="60"]').click(); await page.locator('#back-to-library').click();
  });
  const before = await captureScoreAndTake('before'); assert.ok(JSON.parse(before.take).passes.some(pass => pass.inputs.length > 0), 'Actual pointer practice input required');
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
  await closeWithin(context, 'context'); context = null; await driver.close(); driver = null;
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
  for (const [name, resource] of [['context', context], ['browser', browser], ['driver', driver]]) if (resource) try { await closeWithin(resource, name); } catch (error) { report.ok = false; process.exitCode = 1; (report.cleanup_errors ||= []).push(`${name}: ${String(error)}`); }
  await writeFile(join(owned, 'report.json'), JSON.stringify(report, null, 2) + '\n');
  await writeFile(join(output, 'latest-run.json'), JSON.stringify({directory: owned, report: join(owned, 'report.json'), source_sha: sourceSha, ok: report.ok}, null, 2) + '\n');
}
if (!report.ok) throw Error(report.error || JSON.stringify(report.cleanup_errors));
