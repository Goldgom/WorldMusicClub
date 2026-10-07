/** Hosted Chromium acceptance only. Never run this suite on a restricted local executor.
 * Original sources, unchanged Rust responses, actual controls/AudioWorklets only.
 * This does not establish physical audio, MIDI or native Windows acceptance.
 */
import test, {before, after, beforeEach, afterEach} from 'node:test';
import assert from 'node:assert/strict';
import {spawn, execFileSync} from 'node:child_process';
import {existsSync, readFileSync} from 'node:fs';
import {mkdir, readFile, writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {createServer} from 'node:net';
import {tmpdir} from 'node:os';
import {join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {isDeepStrictEqual} from 'node:util';
import {setTimeout as delay} from 'node:timers/promises';
import {chromium} from 'playwright';
import {chromiumLaunchOptions} from './browser-launch-options.js';
import {selectLegacyEnglish} from './browser-input-fixtures.js';
import {openSongMod} from '../scripts/hosted-song-mod-controls.mjs';
import {installPlaybackClockReader, waitForPlaybackClock, waitForPlaybackClockAdvance} from './browser-playback-clock.js';
import {canonicalPreviewAudioBootstrap, installCanonicalPreviewAudio, readCanonicalPreviewAudio} from './browser-canonical-preview-audio.js';
import {PROGRESSION_STORAGE_PREFIX} from '../web/practice-progression.js';
import {ASSISTANCE_STORAGE_PREFIX} from '../web/practice-assistance.js';
import {PROGRESSION_CASES, PROGRESSION_REPORTS, LAYERS, LAYOUT_CONTROLS, progressionFixture, originalProgressionVariant, assertProgressionReport, assertProgressionSummary, assertProgressionDraft, assertProgressionLayout} from './progression-browser-proof.js';

const fixture = progressionFixture();
const root = fileURLToPath(new URL('../', import.meta.url));
const binary = resolve(root, process.env.WMH_SERVER_BINARY || join('target', 'debug', `practice-server${process.platform === 'win32' ? '.exe' : ''}`));
const artifacts = resolve(process.env.WMH_ARTIFACT_DIR || tmpdir());
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const git = (...args) => execFileSync('git', args, {cwd: root, encoding: 'utf8'}).trim();
let server, serverError, serverLog = '', origin, browser, context, page, requests, pageErrors, report;
const deferred = () => { let resolve; const promise = new Promise(yes => { resolve = yes; }); return {promise, resolve}; };
const assistanceRequests = () => requests.filter(row => /\/api\/practice-(?:assistance|progression)\//.test(row.path));
const emergencyStop = () => { if (server?.exitCode === null && server?.signalCode === null) server.kill('SIGKILL'); };
before(async () => {
  assert.ok(existsSync(binary), `Build the real embedded app first: cargo build -p practice-server --locked\nMissing ${binary}`);
  await mkdir(artifacts, {recursive: true});
  const reservation = createServer();
  await new Promise((yes, no) => { reservation.once('error', no); reservation.listen(0, '127.0.0.1', yes); });
  const port = reservation.address().port;
  await new Promise((yes, no) => reservation.close(error => error ? no(error) : yes()));
  origin = `http://127.0.0.1:${port}`;
  server = spawn(binary, ['--no-open', '--port', String(port)], {cwd: root, stdio: ['ignore', 'pipe', 'pipe']});
  server.on('error', error => { serverError = error; });
  for (const stream of [server.stdout, server.stderr]) { stream.setEncoding('utf8'); stream.on('data', chunk => { serverLog = (serverLog + chunk).slice(-16_384); }); }
  process.once('exit', emergencyStop);
  const deadline = Date.now() + 15_000;
  for (;;) {
    if (serverError) throw serverError;
    assert.equal(server.exitCode, null, `Rust server exited during startup: ${serverLog}`);
    try {
      const response = await fetch(`${origin}/api/health`, {signal: AbortSignal.timeout(1000)});
      const health = await response.json(); assert.equal(response.status, 200); assert.equal(health.engine, 'rust'); assert.equal(health.network, 'loopback-only'); break;
    } catch (error) { if (Date.now() >= deadline) throw Error(`Rust health failed: ${error.message}\n${serverLog}`); await delay(100); }
  }
  browser = await chromium.launch(chromiumLaunchOptions({timeout: 30_000}));
}, {timeout: 60_000});

after(async () => {
  try { await browser?.close(); }
  finally {
    if (server?.exitCode === null && server?.signalCode === null) {
      const stopped = new Promise(yes => server.once('exit', yes)); server.kill('SIGTERM');
      await Promise.race([stopped, delay(2500, undefined, {ref: false})]); emergencyStop();
      await Promise.race([stopped, delay(2500, undefined, {ref: false})]);
    }
    process.removeListener('exit', emergencyStop);
  }
}, {timeout: 10_000});

beforeEach(async t => {
  requests = []; pageErrors = [];
  report = {version: 1, case: t.name, ok: false, source: {sha: git('rev-parse', 'HEAD'), tree: git('rev-parse', 'HEAD^{tree}'), server_sha256: hash(readFileSync(binary))},
    original_fixtures_only: true, physical_audio_verified: false, physical_midi_verified: false, windows_native_verified: false, accepted_package: false, screenshots: []};
  assert.equal(report.source.sha, process.env.WMH_SOURCE_SHA, 'Hosted acceptance needs its exact checked-out source SHA');
  context = await browser.newContext({viewport: {width: 1280, height: 720}, acceptDownloads: true, reducedMotion: 'no-preference'});
  context.setDefaultTimeout(10_000); context.setDefaultNavigationTimeout(15_000); page = await context.newPage();
  page.on('pageerror', error => pageErrors.push(error.message));
  page.on('request', request => {
    const url = new URL(request.url());
    if (url.origin === origin && url.pathname.startsWith('/api/')) {
      let body = request.postData(); try { body = JSON.parse(body); } catch { /* Keep malformed request evidence. */ }
      requests.push({path: url.pathname, method: request.method(), body});
    }
  });
  await installPlaybackClockReader(page); await page.addInitScript({content: canonicalPreviewAudioBootstrap});
  await page.addInitScript(() => {
    globalThis.__progressionGestures = [];
    for (const type of ['change', 'keydown', 'pointerdown']) document.addEventListener(type, event => {
      const piano = event.target.closest?.('#keyboard .piano-key[data-midi]');
      if ((event.target.id?.startsWith('song-mod-') || piano) && globalThis.__progressionGestures.length < 512)
        globalThis.__progressionGestures.push({type, id: event.target.id, value: event.target.value ?? null, key: event.key ?? null, midi: piano ? Number(piano.dataset.midi) : null, trusted: event.isTrusted});
    }, true);
  });
  await page.goto(origin, {waitUntil: 'domcontentloaded'}); await waitForPlaybackClock(page); await selectLegacyEnglish(page);
  await enterLobby(); await installCanonicalPreviewAudio(page);
});
afterEach(async () => {
  try {
    report.pageErrors = pageErrors; report.requests = requests;
    await writeFile(join(artifacts, PROGRESSION_REPORTS[PROGRESSION_CASES.indexOf(report.case)]), JSON.stringify(report, null, 2));
    if (!report.ok && page && !page.isClosed()) {
      await page.screenshot({path: join(artifacts, 'worldmusichub-progression-failure-' + PROGRESSION_CASES.indexOf(report.case) + '.png')});
      await writeFile(join(artifacts, 'worldmusichub-progression-failure-' + PROGRESSION_CASES.indexOf(report.case) + '.json'), JSON.stringify({ui: await view(), audio: await readCanonicalPreviewAudio(page), requests, pageErrors, serverLog}, null, 2));
    }
  } finally { await context?.close(); }
  assert.deepEqual(pageErrors, []);
});
async function enterLobby() {
  await page.locator('#home-single-player').click(); await page.locator('#settings-button').click();
  await page.locator('#key-count').selectOption('88'); await page.locator('#count-in').uncheck();
  if (!await page.locator('#settings-dialog .practice-options').evaluate(node => node.open)) await page.locator('#settings-dialog .practice-options > summary').click();
  await page.locator('#metronome-enabled').uncheck(); await page.locator('#settings-dialog [data-close-panel]').click();
}
async function view() {
  return page.evaluate(() => {
    const node = id => document.getElementById('song-mod-' + id);
    return {mode: node('assistance-mode').value, layer: node('progression-layer').value,
      phase: node('assistance-status').dataset.phase, state: node('assistance-preview').dataset.state,
      status: node('assistance-status').textContent, summary: node('progression-summary').textContent,
      units: node('assistance-units').textContent, unitsHidden: node('assistance-units').hidden,
      rows: [...node('progression-summary').querySelectorAll('li[data-layer]')].map(row => ({layer: row.dataset.layer, selected: row.dataset.selected, current: row.getAttribute('aria-current'), text: row.textContent}))};
  });
}
async function clock() { return page.evaluate(() => { const {positionMs, running} = globalThis.__wmhReadPlaybackClock(); return {positionMs, running}; }); }
async function recipes() { return page.evaluate(prefixes => Object.keys(localStorage).filter(key => prefixes.some(prefix => key.startsWith(prefix))).sort().map(key => ({key, raw: localStorage.getItem(key), recipe: JSON.parse(localStorage.getItem(key))})), [PROGRESSION_STORAGE_PREFIX, ASSISTANCE_STORAGE_PREFIX]); }
async function stoppedState() { return {recipes: await recipes(), audioStarted: (await readCanonicalPreviewAudio(page)).status.started, clock: await clock()}; }
async function frames() { await page.evaluate(() => new Promise(yes => requestAnimationFrame(() => requestAnimationFrame(yes)))); }
async function screenshot(name) {
  const bytes = await page.screenshot({path: join(artifacts, name), fullPage: false});
  report.screenshots.push({name, ...page.viewportSize(), bytes: bytes.length, sha256: hash(bytes)});
}
async function exchange(response, request = response.request()) { return {path: new URL(response.url()).pathname, httpStatus: response.status(), request: request.postDataJSON(), response: await response.json()}; }
async function exportJson(button, panel) {
  await page.locator(`#${panel}-button`).click();
  const [download] = await Promise.all([page.waitForEvent('download'), page.locator(`#${button}`).click()]);
  assert.equal(await download.failure(), null); const value = JSON.parse(await readFile(await download.path(), 'utf8'));
  await page.locator(`#${panel}-dialog [data-close-panel]`).click(); return value;
}
async function importScore(score = fixture.score) {
  await page.locator('#import-tools-button').click();
  const compiled = page.waitForResponse(response => new URL(response.url()).pathname === '/api/compile' && response.request().method() === 'POST' && isDeepStrictEqual(response.request().postDataJSON(), score));
  await page.locator('#score-file').setInputFiles({name: score.id + '.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(score))});
  const response = await compiled; assert.equal(response.status(), 200); const compilation = await response.json(); assert.deepEqual(compilation.score, score);
  await page.waitForFunction(title => document.querySelector('#preview-title')?.textContent === title && !document.querySelector('#configure-song-mod')?.disabled && document.querySelector('.score-storage-status')?.dataset.persistence === 'saved' && document.querySelector('#song-lobby')?.dataset.previewId.startsWith('browser:'), score.title);
  await page.locator('#import-tools-dialog [data-close-panel]').click();
  assert.deepEqual(await exportJson('export-button', 'score-tools'), score);
  return compilation;
}
async function layer(id) {
  const control = page.locator('#song-mod-progression-layer');
  await control.press('End'); await control.press('Home');
  for (let n = 0; n < LAYERS.indexOf(id); n++) await control.press('ArrowDown');
  assert.equal(await control.inputValue(), id);
  const gesture = await page.evaluate(() => globalThis.__progressionGestures.filter(row => row.id === 'song-mod-progression-layer' && row.type === 'change').at(-1));
  assert.equal(gesture.trusted, true); assert.equal(gesture.value, id); return gesture;
}
async function openProgression(where = 'preview') {
  await openSongMod(page, {origin: where}); await page.locator('#song-mod-assistance-mode').selectOption('progression');
}
async function check(id) {
  const gesture = await layer(id), response = page.waitForResponse('**/api/practice-progression/generate');
  assertProgressionDraft(await view()); await page.locator('#song-mod-assistance-check').click();
  const row = await exchange(await response); assert.equal(row.httpStatus, 200);
  await page.waitForFunction(() => document.querySelector('#song-mod-assistance-status').dataset.phase === 'prepared');
  row.ui = await view(); row.gesture = gesture; assertProgressionSummary(row.ui, row.response.checked, id); return row;
}
// Observe finalized DOM frames without changing the clock, app state or paint.
// The canvas exposes a 4-second window, never a full-source ownership ledger.
async function observeRoleFrames() {
  await page.evaluate(title => {
    const canvas = document.getElementById('falling-notes'), progress = document.getElementById('progress');
    const rows = []; let previous = null;
    const sample = () => {
      if (document.body.dataset.screen !== 'stage' || document.getElementById('score-title').textContent !== title) return;
      const clock = globalThis.__wmhReadPlaybackClock(); if (!['playing', 'ended'].includes(clock.phase)) return;
      const human = JSON.parse(canvas.dataset.humanNoteIds || '[]'), machine = JSON.parse(canvas.dataset.machineNoteIds || '[]');
      const signature = JSON.stringify([clock.phase, human, machine]); if (signature === previous) return;
      if (rows.length >= 32) throw Error('Original progression role observation budget exceeded');
      previous = signature; rows.push({clock, human, machine, reducedMotion: matchMedia('(prefers-reduced-motion: reduce)').matches});
    };
    const observer = new MutationObserver(sample);
    observer.observe(canvas, {attributes: true, attributeFilter: ['data-human-note-ids', 'data-machine-note-ids']});
    observer.observe(progress, {attributes: true, attributeFilter: ['data-playback-clock']});
    globalThis.__progressionRoleFrames = rows;
    globalThis.__stopProgressionRoleFrames = () => { sample(); observer.disconnect(); return structuredClone(rows); };
  }, fixture.score.title);
}
async function apply() { await page.locator('#song-mod-apply').click(); await page.locator('#song-mod-dialog').waitFor({state: 'hidden'}); }
async function start() { await page.locator('#start-performance').click(); await page.waitForFunction(() => document.body.dataset.screen === 'stage' && document.querySelector('#canonical-audio-policy')?.dataset.rendererState === 'playing'); await waitForPlaybackClockAdvance(page); }
async function pause() { await page.locator('#play-button').click(); await page.waitForFunction(() => !globalThis.__wmhReadPlaybackClock().running); }
async function layout() {
  const rows = [];
  for (const viewport of [{width: 1280, height: 720}, {width: 390, height: 844}]) {
    await page.setViewportSize(viewport); await page.locator('#song-mod-progression-layer').press('Home'); await frames();
    const keyboard = await page.evaluate(() => ({focused: document.activeElement.id, event: globalThis.__progressionGestures.filter(row => row.id === 'song-mod-progression-layer' && row.type === 'keydown').at(-1)}));
    const controls = [];
    for (const id of LAYOUT_CONTROLS) {
      await page.locator('#' + id).scrollIntoViewIfNeeded(); await frames();
      controls.push(await page.locator('#' + id).evaluate(node => { const r = node.getBoundingClientRect(), hit = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2); return {id: node.id, rect: {x: r.x, y: r.y, width: r.width, height: r.height}, hit: hit === node || node.contains(hit)}; }));
    }
    const row = await page.evaluate(() => {
      const content = document.querySelector('#song-mod-dialog .shell-dialog-content'), select = document.getElementById('song-mod-progression-layer');
      return {viewport: {width: innerWidth, height: innerHeight}, documentWidth: document.documentElement.scrollWidth, content: {width: content.clientWidth, scrollWidth: content.scrollWidth},
        modeOptions: [...document.getElementById('song-mod-assistance-mode').options].map(row => row.value), layerOptions: [...select.options].map(row => row.value), label: document.getElementById(select.getAttribute('aria-labelledby')).textContent, description: document.getElementById(select.getAttribute('aria-describedby')).textContent};
    });
    Object.assign(row, {keyboard, controls}); assertProgressionLayout(row); rows.push(row);
    await page.locator('#song-mod-progression-layer').scrollIntoViewIfNeeded(); await screenshot('worldmusichub-progression-layout-' + viewport.width + '.png');
  }
  await page.setViewportSize({width: 1280, height: 720}); return rows;
}

test(PROGRESSION_CASES[0], {timeout: 120_000}, async () => {
  report.compilation = await importScore(); const libraryKey = await page.locator('#song-lobby').getAttribute('data-preview-id');
  await openSongMod(page); report.initial = {mode: (await view()).mode, requests: assistanceRequests(), recipes: await recipes(), clock: await clock()};
  await page.locator('#song-mod-all-human').click(); await page.locator('#song-mod-layout').selectOption('complete'); await page.locator('#song-mod-show-others').check();
  await page.locator('#song-mod-assistance-mode').selectOption('progression');
  report.checks = []; for (const id of LAYERS) report.checks.push(await check(id));
  report.afterChecks = await stoppedState(); report.layouts = await layout();
  await page.locator('#song-mod-cancel').click(); report.afterCancel = await stoppedState();

  const entered = deferred(), release = deferred(), forwarded = deferred(); let first = true;
  await page.route('**/api/practice-progression/generate', async route => {
    if (!first) return route.continue(); first = false;
    const actual = await route.fetch(); report.pending.actual = await exchange(actual, route.request()); entered.resolve(); await release.promise;
    try { await route.fulfill({response: actual}); report.pending.release = 'fulfilled'; }
    catch (error) { if (!/abort|closed|canceled|disposed/i.test(error.message)) throw error; report.pending.release = 'aborted'; }
    finally { forwarded.resolve(); }
  });
  try {
    await openProgression(); await layer('balanced'); report.pending = {draft: await view()};
    await page.locator('#song-mod-assistance-check').click(); await entered.promise; report.pending.held = await view();
    await page.locator('#song-mod-cancel').click(); release.resolve(); await forwarded.promise; await frames();
    await openProgression(); await layer('balanced'); report.pending.afterCancel = await view(); report.pending.recipes = await recipes(); report.pending.audioStarted = (await readCanonicalPreviewAudio(page)).status.started;
    await page.locator('#song-mod-cancel').click();
  } finally { release.resolve(); await page.unroute('**/api/practice-progression/generate'); }

  await openProgression(); await page.locator('#song-mod-all-human').click(); await page.locator('#song-mod-layout').selectOption('complete'); await page.locator('#song-mod-show-others').check();
  await check('single'); await apply(); report.applied = await stoppedState();
  await observeRoleFrames();
  const validated = page.waitForResponse('**/api/practice-progression/validate'); await start(); report.stageValidation = await exchange(await validated);
  assert.deepEqual(report.stageValidation.response, fixture.layers.single.response);
  await page.waitForFunction(() => globalThis.__wmhReadPlaybackClock().positionMs >= 1800);
  report.beforeInputCount = await page.locator('#hud-captured').innerText();
  await page.locator('#keyboard .piano-key[data-midi="60"]').click();
  await page.waitForFunction(() => document.querySelector('#hud-captured').textContent === '1'); report.afterInputCount = await page.locator('#hud-captured').innerText();
  report.input = await page.evaluate(() => globalThis.__progressionGestures.filter(row => row.type === 'pointerdown' && row.midi === 60).at(-1));
  // Natural completion requests assessment itself. Bind that actual response
  // before the end, rather than clicking Assess on an already assessed pass.
  const assessed = page.waitForResponse(response => new URL(response.url()).pathname === '/api/assess'
    && response.request().postDataJSON().inputs.length === 1
    && isDeepStrictEqual(response.request().postDataJSON().timeline, fixture.layers.single.response.checked.assistance.human_targets.timeline));
  await page.waitForFunction(() => !globalThis.__wmhReadPlaybackClock().running && globalThis.__wmhPreviewAudio.snapshot().some(run => run.rawTerminals.some(row => row.record.type === 'ended')));
  report.roleFrames = await page.evaluate(() => globalThis.__stopProgressionRoleFrames());
  report.assessment = await exchange(await assessed); await page.locator('#results-button').click();
  await page.locator('#feedback-results').waitFor({state: 'visible'}); await page.locator('#results-dialog [data-close-panel]').click();
  report.take = await exportJson('export-takes', 'results'); report.exportedSource = await exportJson('export-button', 'score-tools'); report.audio = await readCanonicalPreviewAudio(page);
  await screenshot('worldmusichub-progression-scored.png');

  const beforeStageCheck = await stoppedState();
  await openProgression('stage'); await layer('dense'); report.activeDraft = {before: beforeStageCheck, draft: await view(), applyDisabled: await page.locator('#song-mod-apply').isDisabled()};
  await check('dense'); report.activeDraft.afterCheckStopped = await stoppedState(); await page.locator('#song-mod-cancel').click(); report.activeDraft.afterCheck = await exportJson('export-takes', 'results');
  await openProgression('stage'); await layer('dense'); await page.locator('#song-mod-assistance-reset').check(); await layer('balanced');
  report.activeDraft.resetAfterEdit = await page.locator('#song-mod-assistance-reset').isChecked(); await page.locator('#song-mod-cancel').click(); report.activeDraft.afterCancel = await exportJson('export-takes', 'results');

  let generationInjected = 0;
  await page.route('**/api/practice-progression/generate', async route => {
    if (generationInjected || !isDeepStrictEqual(route.request().postDataJSON().score, fixture.score)) return route.continue();
    generationInjected++;
    await route.fulfill({status: 422, contentType: 'application/json', body: JSON.stringify({code: 'progression_response_limit', error: 'Complete progression response exceeds 16 MiB; no hierarchy or ownership entries were truncated'})});
  });
  try {
    await openProgression('stage'); await layer('dense');
    const failed = page.waitForResponse('**/api/practice-progression/generate'); await page.locator('#song-mod-assistance-check').click();
    report.generationFault = {exchange: await exchange(await failed), scope: 'Fault-injected response-budget refusal on a tiny original source'};
    await page.waitForFunction(() => document.querySelector('#song-mod-assistance-status').dataset.phase === 'error');
    report.generationFault.ui = await view(); report.generationFault.recipes = await recipes(); await page.locator('#song-mod-cancel').click();
    report.generationFault.take = await exportJson('export-takes', 'results');
    await openProgression('stage'); report.generationFault.retry = await check('dense'); await page.locator('#song-mod-cancel').click();
    report.generationFault.afterRetry = await exportJson('export-takes', 'results'); report.generationFault.injected = generationInjected;
  } finally { await page.unroute('**/api/practice-progression/generate'); }

  report.off = {beforeFaultRecipes: await recipes()}; let injected = 0;
  await page.route('**/api/practice-assistance/original', async route => {
    if (!isDeepStrictEqual(route.request().postDataJSON().score, fixture.score)) return route.continue(); injected++;
    await route.fulfill({status: 422, contentType: 'application/json', body: JSON.stringify({code: 'assistance_response_limit', error: 'Complete assistance response exceeds 16 MiB; no IDs or ownership entries were truncated', source_note_ids: []})});
  });
  try {
    await openSongMod(page, {origin: 'stage'}); await page.locator('#song-mod-assistance-mode').selectOption('original');
    const failed = page.waitForResponse('**/api/practice-assistance/original'); await page.locator('#song-mod-assistance-check').click(); report.off.fault = await exchange(await failed);
    await page.waitForFunction(() => document.querySelector('#song-mod-assistance-status').dataset.phase === 'error'); report.off.fault.ui = await view();
    report.off.afterFaultRecipes = await recipes(); await page.locator('#song-mod-cancel').click(); report.off.afterFaultTake = await exportJson('export-takes', 'results');
    await openSongMod(page, {origin: 'stage'}); await page.locator('#song-mod-assistance-off').click(); report.off.resetRequired = await page.locator('#song-mod-apply').isDisabled();
    await page.locator('#song-mod-assistance-reset').check();
    const targets = page.waitForResponse(response => new URL(response.url()).pathname === '/api/practice-targets' && isDeepStrictEqual(response.request().postDataJSON().timeline, fixture.compilation.timeline));
    await apply(); report.off.admission = await exchange(await targets); report.off.recipes = await recipes(); report.off.clock = await clock(); report.off.exportDisabled = await page.locator('#export-takes').isDisabled();
    const reloadStart = requests.length;
    await page.reload({waitUntil: 'domcontentloaded'}); await waitForPlaybackClock(page); await enterLobby(); await installCanonicalPreviewAudio(page);
    await page.locator(`[data-library-key=${JSON.stringify(libraryKey)}]`).click();
    await page.waitForFunction(() => !document.querySelector('#start-performance').disabled && /assistance is off/.test(document.querySelector('#song-mod-preview-summary').textContent));
    report.off.restoredRecipes = await recipes(); report.off.reloadAssistanceRequests = requests.slice(reloadStart).filter(row => /\/api\/practice-(?:assistance|progression)\//.test(row.path));
    await start(); await pause(); report.off.freshTake = await exportJson('export-takes', 'results'); report.off.audio = await readCanonicalPreviewAudio(page); report.off.injected = injected;
    assert.deepEqual(await exportJson('export-button', 'score-tools'), fixture.score); await screenshot('worldmusichub-progression-off.png');
  } finally { await page.unroute('**/api/practice-assistance/original'); }
  report.pageErrors = pageErrors; assertProgressionReport({...report, ok: true}, 0); report.ok = true;
});

test(PROGRESSION_CASES[1], {timeout: 60_000}, async () => {
  report.variants = [];
  for (const kind of ['equal', 'empty']) {
    const compilation = await importScore(originalProgressionVariant(kind)); await openProgression(); await page.locator('#song-mod-all-human').click();
    const checked = await check('single'); await page.locator('#song-mod-progression-summary').scrollIntoViewIfNeeded(); await screenshot('worldmusichub-progression-' + kind + '.png');
    await page.locator('#song-mod-cancel').click(); report.variants.push({kind, compilation, exchange: checked, exportedSource: await exportJson('export-button', 'score-tools'), recipes: await recipes(), audioStarted: (await readCanonicalPreviewAudio(page)).status.started});
  }
  report.pageErrors = pageErrors; assertProgressionReport({...report, ok: true}, 1); report.ok = true;
});
