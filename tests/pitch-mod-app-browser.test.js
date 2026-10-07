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
import {PITCH_MOD_CASES, PITCH_MOD_REPORTS, pitchModOriginal, pitchConfig, assertC4Projection, assertPitchModReport} from './pitch-mod-browser-proof.js';

const fixture = {score: pitchModOriginal()};
const root = fileURLToPath(new URL('../', import.meta.url));
const binary = resolve(root, process.env.WMH_SERVER_BINARY || join('target', 'debug', `practice-server${process.platform === 'win32' ? '.exe' : ''}`));
const artifacts = resolve(process.env.WMH_ARTIFACT_DIR || tmpdir());
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const git = (...args) => execFileSync('git', args, {cwd: root, encoding: 'utf8'}).trim();
let server, serverError, serverLog = '', origin, browser, context, page, requests, pageErrors, report;
const deferred = () => { let resolve; const promise = new Promise(yes => { resolve = yes; }); return {promise, resolve}; };
const emergencyStop = () => { if (server?.exitCode === null && server?.signalCode === null) server.kill('SIGKILL'); };
before(async () => {
  assert.equal(process.env.GITHUB_ACTIONS, 'true', 'Real-browser acceptance runs only in its hosted workflow');
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
    globalThis.__pitchModGestures = [];
    for (const type of ['change', 'keydown', 'pointerdown']) document.addEventListener(type, event => {
      const piano = event.target.closest?.('#keyboard .piano-key[data-midi]');
      if ((event.target.id?.startsWith('song-mod-') || piano || event.code === 'KeyS') && globalThis.__pitchModGestures.length < 512)
        globalThis.__pitchModGestures.push({type, id: event.target.id, value: event.target.value ?? null, key: event.key ?? null, code: event.code ?? null, midi: piano ? Number(piano.dataset.midi) : null, trusted: event.isTrusted});
    }, true);
  });
  await page.goto(origin, {waitUntil: 'domcontentloaded'}); await waitForPlaybackClock(page); await selectLegacyEnglish(page);
  await enterLobby(); await installCanonicalPreviewAudio(page);
});
afterEach(async () => {
  try {
    report.pageErrors = pageErrors; report.requests = requests;
    await writeFile(join(artifacts, PITCH_MOD_REPORTS[PITCH_MOD_CASES.indexOf(report.case)]), JSON.stringify(report, null, 2));
    if (!report.ok && page && !page.isClosed()) {
      await page.screenshot({path: join(artifacts, 'worldmusichub-pitch-mod-failure-' + PITCH_MOD_CASES.indexOf(report.case) + '.png')});
      await writeFile(join(artifacts, 'worldmusichub-pitch-mod-failure-' + PITCH_MOD_CASES.indexOf(report.case) + '.json'), JSON.stringify({ui: await view(), audio: await readCanonicalPreviewAudio(page), requests, pageErrors, serverLog}, null, 2));
    }
  } finally { await context?.close(); }
  assert.deepEqual(pageErrors, []);
});
async function enterLobby() {
  await page.locator('#home-single-player').click(); await page.locator('#settings-button').click();
  await page.locator('#key-count').selectOption('88'); await page.locator('#count-in').uncheck();
  if (!await page.locator('#settings-dialog .practice-options').evaluate(node => node.open)) await page.locator('#settings-dialog .practice-options > summary').click();
  await page.locator('#metronome-enabled').uncheck();
  await page.locator('#keyboard-preset').selectOption('legacy'); await page.locator('#keyboard-base-midi').fill('60'); await page.locator('#keyboard-input-offset').fill('0'); await page.locator('#keyboard-settings-apply').click(); await page.locator('#settings-dialog [data-close-panel]').click();
}
async function view() {
  return page.evaluate(() => ({value: document.querySelector('#song-mod-pitch-shift').value,
    status: document.querySelector('#song-mod-pitch-status').dataset.pitchModStatus,
    text: document.querySelector('#song-mod-pitch-status').textContent,
    summary: document.querySelector('#song-mod-pitch-summary').textContent,
    applyDisabled: document.querySelector('#song-mod-apply').disabled}));
}
async function clock() { return page.evaluate(() => { const {positionMs, running} = globalThis.__wmhReadPlaybackClock(); return {positionMs, running}; }); }
async function recipes() { return page.evaluate(() => Object.keys(localStorage).filter(key => /worldmusichub\.(?:pitch-mod|song-mod|practice-assistance|practice-progression)\./.test(key)).sort().map(key => ({key, raw: localStorage.getItem(key)}))); }
async function stoppedState() { return {recipes: await recipes(), audioStarted: (await readCanonicalPreviewAudio(page)).status.started, clock: await clock(), previewId: await page.locator('#song-lobby').getAttribute('data-preview-id')}; }
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
async function setShift(semitones) { await page.locator('#song-mod-pitch-shift').fill(String(semitones)); }
async function check(semitones = 2) {
  await setShift(semitones);
  const response = page.waitForResponse('**/api/pitch-mod/project');
  await page.locator('#song-mod-pitch-check').click();
  const row = await exchange(await response); assert.equal(row.httpStatus, 200);
  await page.waitForFunction(() => document.querySelector('#song-mod-pitch-status').dataset.pitchModStatus === 'checked');
  row.ui = await view(); return row;
}
async function apply() { await page.locator('#song-mod-apply').click(); await page.locator('#song-mod-dialog').waitFor({state: 'hidden'}); }
async function start() { await page.locator('#start-performance').click(); await page.waitForFunction(() => document.body.dataset.screen === 'stage' && document.querySelector('#canonical-audio-policy')?.dataset.rendererState === 'playing'); await waitForPlaybackClockAdvance(page); }
async function pause() { await page.locator('#play-button').click(); await page.waitForFunction(() => !globalThis.__wmhReadPlaybackClock().running); }
async function waitPosition(at) { await page.waitForFunction(at => globalThis.__wmhReadPlaybackClock().positionMs >= at, at, {polling: 'raf'}); }
async function summary(origin = 'preview') { return page.locator('#song-mod-' + origin + '-summary').evaluate(node => ({text: node.textContent, semitones: node.dataset.pitchModSemitones, digest: node.dataset.pitchModDigest})); }
async function configureParts() {
  await page.locator('#song-mod-all-machine').click();
  await page.locator('[data-mod-performer="human"]').selectOption('human');
  await page.locator('#song-mod-layout').selectOption('complete');
  await page.locator('#song-mod-show-others').check();
}
async function roleFrames() {
  await page.evaluate(() => {
    const canvas = document.getElementById('falling-notes'), rows = []; let previous = null;
    const read = () => {
      const clock = globalThis.__wmhReadPlaybackClock();
      const row = {position: clock.positionMs, humans: JSON.parse(canvas.dataset.humanNoteIds || '[]'), machines: JSON.parse(canvas.dataset.machineNoteIds || '[]')};
      const key = JSON.stringify([row.humans, row.machines]); if (key === previous || rows.length >= 32) return;
      previous = key; rows.push(row);
    };
    const observer = new MutationObserver(read); observer.observe(canvas, {attributes: true, attributeFilter: ['data-human-note-ids', 'data-machine-note-ids']});
    globalThis.__pitchModRoles = rows; globalThis.__stopPitchModRoles = () => { read(); observer.disconnect(); return rows; };
  });
}
async function showJianpu() {
  if (await page.locator('#notation-toggle').getAttribute('aria-expanded') !== 'true') await page.locator('#notation-toggle').click();
  await page.locator('#jianpu-button').click(); await page.locator('#jianpu-reference').selectOption('fixed'); await page.locator('#notation-part').selectOption('');
  while (!await page.locator('#notation-prev').isDisabled()) await page.locator('#notation-prev').click(); await frames();
  const rows = [];
  for (let index = 0; index < 8; index++) {
    rows.push(...await page.locator('#notation .score-note').evaluateAll(nodes => nodes.map(node => ({id: node.dataset.noteId, number: node.querySelector('.jianpu-note')?.textContent}))));
    if (await page.locator('#notation-next').isDisabled()) break;
    await page.locator('#notation-next').click(); await frames();
  }
  while (!await page.locator('#notation-prev').isDisabled()) await page.locator('#notation-prev').click(); await frames();
  return rows;
}

test(PITCH_MOD_CASES[0], {timeout: 90_000}, async () => {
  report.compilation = await importScore();
  await openSongMod(page); await configureParts();
  report.beforeCheck = await stoppedState(); report.check = await check(); assertC4Projection(report.check.response);
  report.afterCheck = await stoppedState(); await screenshot('worldmusichub-pitch-mod-checked.png');
  await apply(); report.applied = {...await stoppedState(), summary: await summary()};
  await roleFrames(); await start();
  await waitPosition(700); await screenshot('worldmusichub-pitch-mod-d4-live.png');
  await waitPosition(1950); await page.locator('#keyboard .piano-key[data-midi="62"]').click();
  report.mappingBefore = await page.locator('#keyboard-map [data-code=KeyS]').evaluate(node => ({code: node.dataset.code, midi: Number(node.dataset.noteMidi), enabled: node.dataset.enabled})); assert.deepEqual(report.mappingBefore, {code: 'KeyS', midi: 62, enabled: 'true'});
  await waitPosition(3900); await page.locator('#stage-title').focus(); await waitPosition(3970); await page.keyboard.press('KeyS');
  await page.locator('#keyboard-semitone-up').click(); await page.locator('#keyboard-semitone-up').click();
  report.mappingAfter = await page.locator('#keyboard-map [data-code=KeyS]').evaluate(node => ({code: node.dataset.code, midi: Number(node.dataset.noteMidi), enabled: node.dataset.enabled})); assert.deepEqual(report.mappingAfter, {code: 'KeyS', midi: 64, enabled: 'true'});
  await page.locator('#stage-title').focus(); await waitPosition(5970); await page.keyboard.press('KeyS');
  await page.waitForFunction(() => !globalThis.__wmhReadPlaybackClock().running && document.querySelector('.performance-status')?.dataset.phase === 'assessed');
  report.roles = await page.evaluate(() => globalThis.__stopPitchModRoles());
  report.take = await exportJson('export-takes', 'results'); report.exportedSource = await exportJson('export-button', 'score-tools');
  report.audio = await readCanonicalPreviewAudio(page);
  report.gestures = await page.evaluate(() => globalThis.__pitchModGestures);
  if (await page.locator('#notation-toggle').getAttribute('aria-expanded') !== 'true') await page.locator('#notation-toggle').click();
  await page.locator('#engraved-button').click();
  await page.waitForFunction(() => document.querySelectorAll('#engraved-staff svg').length > 0 && document.querySelectorAll('#engraved-staff [data-source-note-id]').length > 0);
  report.engraving = {request: requests.findLast(row => row.path === '/api/export/musicxml'),
    sourceIds: await page.locator('#engraved-staff [data-source-note-id]').evaluateAll(nodes => [...new Set(nodes.map(node => node.dataset.sourceNoteId))].sort()),
    svgCount: await page.locator('#engraved-staff svg').count()};
  await screenshot('worldmusichub-pitch-mod-d4-staff.png');
  report.jianpu = await showJianpu(); await screenshot('worldmusichub-pitch-mod-d4-stage.png');
  report.pageErrors = pageErrors; assertPitchModReport({...report, ok: true}, 0); report.ok = true;
});

test(PITCH_MOD_CASES[1], {timeout: 90_000}, async () => {
  await importScore(); await openSongMod(page); await configureParts();
  report.beforeCheck = await stoppedState(); report.check = await check(); report.afterCheck = await stoppedState();
  await page.locator('#song-mod-cancel').click(); report.afterCancel = await stoppedState();
  const entered = deferred(), release = deferred(), forwarded = deferred(); let first = true;
  await page.route('**/api/pitch-mod/project', async route => {
    if (!first) return route.continue(); first = false;
    const actual = await route.fetch(); report.late = await exchange(actual, route.request()); entered.resolve(); await release.promise;
    try { await route.fulfill({response: actual}); }
    catch (error) { if (!/abort|closed|canceled|disposed/i.test(error.message)) throw error; }
    finally { forwarded.resolve(); }
  });
  try {
    await openSongMod(page); await setShift(2); await page.locator('#song-mod-pitch-check').click(); await entered.promise;
    await page.locator('#song-mod-cancel').click(); release.resolve(); await forwarded.promise; await frames();
    report.afterLateCancel = await stoppedState();
  } finally { release.resolve(); await page.unroute('**/api/pitch-mod/project'); }
  await openSongMod(page); await configureParts(); await check(); await apply(); await start(); await waitPosition(500); await pause();
  report.reset = {takeBefore: await exportJson('export-takes', 'results')};
  await openSongMod(page, {origin: 'stage'}); await setShift(0); report.reset.applyDisabled = await page.locator('#song-mod-apply').isDisabled();
  await page.locator('#song-mod-pitch-zero').click(); await page.locator('#song-mod-pitch-check').click(); await page.waitForFunction(() => document.querySelector('#song-mod-pitch-status').dataset.pitchModStatus === 'checked'); report.reset.checkedApplyDisabled = await page.locator('#song-mod-apply').isDisabled();
  await page.locator('#song-mod-cancel').click(); report.reset.takeAfterCancel = await exportJson('export-takes', 'results');
  // Fault injection is limited to saving this new Mod namespace. The effective
  // projection is still the real Rust response, and old persisted bytes/takes
  // must remain unchanged when that single reversible write fails.
  report.saveFailure = {scope: 'Fault-injected sidecar quota failure', before: await stoppedState()};
  await page.evaluate(() => {
    const original = Storage.prototype.setItem;
    globalThis.__restorePitchModStorage = () => { Storage.prototype.setItem = original; };
    Storage.prototype.setItem = function(key, value) {
      if (String(key).startsWith('worldmusichub.pitch-mod.v1.')) throw new DOMException('Original acceptance quota failure', 'QuotaExceededError');
      return Reflect.apply(original, this, [key, value]);
    };
  });
  try {
    await openSongMod(page, {origin: 'stage'}); report.saveFailure.check = await check(1);
    await page.locator('#song-mod-pitch-reset').check(); await page.locator('#song-mod-apply').click();
    await page.waitForFunction(() => document.querySelector('#song-mod-error').textContent.length > 0);
    report.saveFailure.error = await page.locator('#song-mod-error').innerText();
    report.saveFailure.dialogOpen = await page.locator('#song-mod-dialog').evaluate(node => node.open);
    report.saveFailure.after = await stoppedState(); await screenshot('worldmusichub-pitch-mod-save-refused.png');
    await page.locator('#song-mod-cancel').click(); report.saveFailure.take = await exportJson('export-takes', 'results');
  } finally { await page.evaluate(() => globalThis.__restorePitchModStorage()); }
  await openSongMod(page, {origin: 'stage'}); await page.locator('#song-mod-pitch-zero').click(); await page.locator('#song-mod-pitch-check').click(); await page.waitForFunction(() => document.querySelector('#song-mod-pitch-status').dataset.pitchModStatus === 'checked'); await page.locator('#song-mod-pitch-reset').check(); await apply();
  report.zero = {clock: await clock(), exportDisabled: await page.locator('#export-takes').isDisabled()};
  await page.locator('#play-button').click(); await waitForPlaybackClockAdvance(page); await pause();
  report.zero.take = await exportJson('export-takes', 'results'); report.exportedSource = await exportJson('export-button', 'score-tools');
  await screenshot('worldmusichub-pitch-mod-zero.png');
  await page.locator('#back-to-library').click();
  // A complete original with a top MIDI note must fail the whole operation.
  const edge = structuredClone(fixture.score); edge.id += '-range'; edge.title += ' MIDI range'; edge.parts[1].notes[3].pitch = {step: 'G', alter: 0, octave: 9};
  await importScore(edge); const startsBeforeRange = (await readCanonicalPreviewAudio(page)).status.started; await openSongMod(page); await setShift(2);
  const rejected = page.waitForResponse('**/api/pitch-mod/project'); await page.locator('#song-mod-pitch-check').click(); report.range = await exchange(await rejected);
  await page.waitForFunction(() => document.querySelector('#song-mod-pitch-status').dataset.pitchModStatus === 'rejected');
  report.range.applyDisabled = await page.locator('#song-mod-apply').isDisabled();
  report.range.original = edge;
  report.range.audioStarted = (await readCanonicalPreviewAudio(page)).status.started - startsBeforeRange;
  await screenshot('worldmusichub-pitch-mod-range-rejected.png');
  report.pageErrors = pageErrors; assertPitchModReport({...report, ok: true}, 1); report.ok = true;
});
