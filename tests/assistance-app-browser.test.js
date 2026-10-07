/** Early bounded acceptance, before the broad full-app suite.
 * Build the actual embedded app: cargo build -p practice-server --locked
 * Hosted invocation: node --test tests/assistance-app-browser.test.js
 * Canonical cases use real Rust responses; delayed routes only forward them.
 * Basic/VSQ case replays checked Rust fixtures into real Chromium worklets.
 * It does not substitute for desktop NativeLibrary/app package acceptance.
 */
import test, {before, after, beforeEach, afterEach} from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {existsSync} from 'node:fs';
import {mkdir, readFile, writeFile} from 'node:fs/promises';
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
import {assistanceBrowserFixtures, originalCrossScopeAssistanceScore, replayNativeAssistanceAudio} from './assistance-browser-fixtures.js';
import {ASSISTANCE_STORAGE_PREFIX} from '../web/practice-assistance.js';
import {ASSISTANCE_PREVIEW_CASES, assistanceCanonicalPresetFixture, validateAssistancePresetPreview, validateAssistanceModLayout} from '../scripts/ui-preview-assistance.mjs';
import {assistancePresetSettings} from '../web/practice-assistance-receipt.js';

const fixtures = assistanceBrowserFixtures(), canonical = fixtures.canonical;
const root = fileURLToPath(new URL('../', import.meta.url));
const binary = resolve(root, process.env.WMH_SERVER_BINARY || join('target', 'debug', `practice-server${process.platform === 'win32' ? '.exe' : ''}`));
const artifacts = resolve(process.env.WMH_ARTIFACT_DIR || tmpdir());
const options = {timeout: 45_000};
let server, serverError, serverLog = '', origin, browser, context, page, requests, pageErrors, caseName, observed;
const deferred = () => { let resolve; const promise = new Promise(yes => { resolve = yes; }); return {promise, resolve}; };
const assistanceRequests = () => requests.filter(row => row.path.startsWith('/api/practice-assistance/'));
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
  caseName = t.name.replace(/[^a-z0-9]+/gi, '-').slice(0, 100); requests = []; pageErrors = []; observed = {};
  context = await browser.newContext({viewport: {width: 1440, height: 1000}, acceptDownloads: true});
  context.setDefaultTimeout(10_000); context.setDefaultNavigationTimeout(15_000);
  page = await context.newPage();
  page.on('pageerror', error => pageErrors.push(error.message));
  page.on('request', request => {
    const url = new URL(request.url());
    if (url.origin === origin && url.pathname.startsWith('/api/')) {
      let body = request.postData(); try { body = JSON.parse(body); } catch { /* Retain malformed input for failure evidence. */ }
      requests.push({path: url.pathname, method: request.method(), body});
    }
  });
  await installPlaybackClockReader(page);
  await page.addInitScript({content: canonicalPreviewAudioBootstrap});
  await page.addInitScript(() => {
    globalThis.__assistanceGestures = [];
    for (const type of ['input', 'change', 'keydown']) document.addEventListener(type, event => {
      if (event.target.id?.startsWith('song-mod-assistance-') && globalThis.__assistanceGestures.length < 256)
        globalThis.__assistanceGestures.push({type, id: event.target.id, value: event.target.value, key: event.key || null, trusted: event.isTrusted});
    }, true);
  });
  await page.goto(origin, {waitUntil: 'domcontentloaded'});
  await waitForPlaybackClock(page); await selectLegacyEnglish(page);
  await page.locator('#home-single-player').click();
  await page.locator('#settings-button').click();
  await page.locator('#key-count').selectOption('88');
  await page.locator('#settings-dialog [data-close-panel]').click();
  await installCanonicalPreviewAudio(page);
});

afterEach(async () => {
  try { if (page && !page.isClosed()) await checkpoint('final'); }
  finally { await context?.close(); }
  assert.deepEqual(pageErrors, [], 'Real browser must have no uncaught application errors');
});

// Evidence is retained before case assertions and on failures. No private source
// is loaded: all request bodies belong to the original exercises in this file.
async function checkpoint(label, details = {}) {
  Object.assign(observed, details);
  const ui = await page.evaluate(() => ({screen: document.body.dataset.screen,
    preview: {title: document.querySelector('#preview-title')?.textContent, gate: document.querySelector('#preview-gate')?.textContent,
      startDisabled: document.querySelector('#start-performance')?.disabled, summary: document.querySelector('#song-mod-preview-summary')?.textContent},
    stage: {title: document.querySelector('#score-title')?.textContent, clock: JSON.parse(document.querySelector('#progress')?.getAttribute('data-playback-clock') || 'null'),
      summary: document.querySelector('#song-mod-stage-summary')?.textContent, gate: document.querySelector('#practice-gate-reason')?.textContent,
      humanIds: JSON.parse(document.querySelector('#falling-notes')?.dataset.humanNoteIds || '[]'), machineIds: JSON.parse(document.querySelector('#falling-notes')?.dataset.machineNoteIds || '[]')},
    dialog: {open: document.querySelector('#song-mod-dialog')?.open, phase: document.querySelector('#song-mod-assistance-status')?.dataset.phase,
      status: document.querySelector('#song-mod-assistance-status')?.textContent, error: document.querySelector('#song-mod-error')?.textContent},
    notice: document.querySelector('#notice-message')?.textContent,
    native: globalThis.__assistanceNativeResult || null,
  }));
  let audio; try { audio = await readCanonicalPreviewAudio(page); } catch (error) { audio = {error: error.message}; }
  const base = join(artifacts, `worldmusichub-live-assistance-${caseName}-${label}`);
  const scope = ASSISTANCE_PREVIEW_CASES.find(row => row.caseId === caseName)?.scope;
  await writeFile(`${base}.json`, JSON.stringify({version: 1, case: caseName, label, scope, ui, audio, ...observed, requests, pageErrors, serverLog}, null, 2));
  await page.screenshot({path: `${base}.png`, fullPage: !label.startsWith('preset-layout-')});
  return {ui, audio};
}

async function importScore(score = canonical.compilation.score) {
  await page.locator('#import-tools-button').click();
  const compiled = page.waitForResponse(response => new URL(response.url()).pathname === '/api/compile'
    && response.request().method() === 'POST' && isDeepStrictEqual(response.request().postDataJSON(), score));
  await page.locator('#score-file').setInputFiles({name: `${score.id}.json`, mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(score))});
  const response = await compiled; assert.equal(response.status(), 200);
  const compilation = await response.json(); assert.deepEqual(compilation.score, score);
  await page.waitForFunction(title => document.querySelector('#preview-title')?.textContent === title
    && !document.querySelector('#configure-song-mod')?.disabled
    && document.querySelector('[data-score-storage]')?.getAttribute('aria-busy') === 'false'
    && document.querySelector('.score-storage-status')?.dataset.persistence === 'saved'
    && document.querySelector('#song-lobby')?.dataset.previewId.startsWith('browser:'), score.title);
  await page.locator('#import-tools-dialog [data-close-panel]').click();
  // Bind the admitted preview's public identity to its actual persisted source,
  // then independently export the active source. A matching title, old score or
  // unrelated bootstrap /api/compile response cannot satisfy this boundary.
  const selected = await page.evaluate(async () => {
    const identity = document.querySelector('#song-lobby').dataset.previewId;
    const {openScoreLibrary} = await import('/local-library.js'), library = await openScoreLibrary();
    try { return {identity, score: (await library.get(identity.slice('browser:'.length)))?.score}; }
    finally { library.close(); }
  });
  await checkpoint('source-admitted', {importedCompilation: compilation, selectedSource: selected});
  assert.deepEqual(selected.score, score, `The selected browser-copy identity ${selected.identity} belongs to the intended complete source`);
  assert.deepEqual(await exportJson('export-button', 'score-tools'), score, 'Active source export matches this exact successful Rust compile');
  return compilation;
}

async function editAutomatic(settings = canonical.automatic.checked.plan.settings) {
  await page.locator('#song-mod-assistance-mode').selectOption('automatic');
  for (const [field, value] of Object.entries(settings)) if (field !== 'algorithm_id') await page.locator(`#song-mod-assistance-${field}`).fill(String(value));
}
async function checkAutomatic() {
  const response = page.waitForResponse('**/api/practice-assistance/generate');
  await page.locator('#song-mod-assistance-check').click();
  const replied = await response; assert.equal(replied.status(), 200);
  const body = await replied.json(); observed.lastCheckedRequest = replied.request().postDataJSON();
  await page.waitForFunction(() => document.querySelector('#song-mod-assistance-status')?.dataset.phase === 'prepared');
  return body;
}
async function presetView() {
  return page.evaluate(() => {
    const node = id => document.getElementById('song-mod-assistance-' + id);
    return {preset: node('preset').value, settings: Object.fromEntries([...node('limits').querySelectorAll('input')].map(input => [input.id.slice('song-mod-assistance-'.length), Number(input.value)])),
      state: node('preview').dataset.state, status: node('status').textContent, units: node('units').textContent, unitsHidden: node('units').hidden};
  });
}
async function selectPreset(id) {
  const select = page.getByRole('combobox', {name: 'Keyboard configuration', exact: true});
  // Genuine keyboard events select the native option; Custom is derived by edits.
  if (await select.inputValue() === 'single') await select.press('ArrowDown');
  await select.press('Home');
  for (let n = 0; n < ['single', 'balanced', 'dense'].indexOf(id); n++) await select.press('ArrowDown');
  assert.equal(await select.inputValue(), id);
  const gesture = await page.evaluate(() => globalThis.__assistanceGestures.filter(event => event.id === 'song-mod-assistance-preset' && event.type === 'change').at(-1));
  assert.equal(gesture?.trusted, true); assert.equal(gesture?.value, id);
  const view = await presetView();
  validateAssistancePresetPreview(view, {id, settings: assistancePresetSettings(id)});
  return {id, gesture, unchecked: view};
}
async function checkedPreset(row) {
  const response = await checkAutomatic(), request = structuredClone(observed.lastCheckedRequest), view = await presetView();
  assert.deepEqual(response, assistanceCanonicalPresetFixture().presets[row.id].response, 'A preset result is the actual retained Rust output');
  assert.deepEqual(request.settings, assistancePresetSettings(row.id));
  assert.deepEqual(request.score, canonical.compilation.score);
  validateAssistancePresetPreview(view, {id: row.id, settings: request.settings, checked: response.checked});
  return {...row, request, response, view};
}
async function measureModLayout() {
  const measurements = [];
  for (const viewport of [{width: 1280, height: 720}, {width: 390, height: 844}]) {
    await page.setViewportSize(viewport); await frames();
    const select = page.getByRole('combobox', {name: 'Keyboard configuration', exact: true});
    await select.press('Home'); assert.equal(await select.inputValue(), 'single');
    const keyboard = await page.evaluate(() => ({focused: document.activeElement?.id, event: globalThis.__assistanceGestures.filter(event => event.id === 'song-mod-assistance-preset' && event.type === 'keydown').at(-1)}));
    const controls = [];
    for (const id of ['song-mod-assistance-preset', ...Object.keys(assistancePresetSettings('single')).filter(key => key !== 'algorithm_id').map(key => 'song-mod-assistance-' + key), 'song-mod-assistance-check', 'song-mod-apply', 'song-mod-cancel']) {
      await page.locator('#' + id).scrollIntoViewIfNeeded(); await frames();
      controls.push(await page.locator('#' + id).evaluate(node => {
        const rect = node.getBoundingClientRect(), hit = document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2);
        return {id: node.id, rect: {x: rect.x, y: rect.y, width: rect.width, height: rect.height}, hit: hit === node || node.contains(hit)};
      }));
    }
    const layout = await page.evaluate(() => {
      const dialog = document.getElementById('song-mod-dialog'), content = dialog.querySelector('.shell-dialog-content'), select = document.getElementById('song-mod-assistance-preset');
      return {viewport: {width: innerWidth, height: innerHeight}, documentWidth: document.documentElement.scrollWidth,
        content: {width: content.clientWidth, scrollWidth: content.scrollWidth}, label: document.getElementById(select.getAttribute('aria-labelledby'))?.textContent,
        description: document.getElementById(select.getAttribute('aria-describedby'))?.textContent,
        options: [...select.options].map(option => ({value: option.value, text: option.textContent, disabled: option.disabled}))};
    });
    layout.controls = controls; layout.keyboard = keyboard; measurements.push(layout); validateAssistanceModLayout(layout);
    await page.locator('#song-mod-assistance-preset').scrollIntoViewIfNeeded();
    await checkpoint('preset-layout-' + viewport.width, {presetLayouts: measurements});
  }
  await page.setViewportSize({width: 1440, height: 1000}); await frames(); return measurements;
}
async function applyMod() { await page.locator('#song-mod-apply').click(); await page.locator('#song-mod-dialog').waitFor({state: 'hidden'}); }
async function automaticPreview() {
  await openSongMod(page); await page.locator('#song-mod-all-human').click();
  await page.locator('#song-mod-layout').selectOption('complete'); await page.locator('#song-mod-show-others').check(); await editAutomatic();
  const response = await checkAutomatic(); await applyMod(); return response;
}
async function exportJson(button, panel) {
  await page.locator(`#${panel}-button`).click();
  const [download] = await Promise.all([page.waitForEvent('download'), page.locator(`#${button}`).click()]);
  assert.equal(await download.failure(), null);
  const value = JSON.parse(await readFile(await download.path(), 'utf8'));
  await page.locator(`#${panel}-dialog [data-close-panel]`).click(); return value;
}
async function recipes() {
  return page.evaluate(prefix => Object.keys(localStorage).filter(key => key.startsWith(prefix)).map(key => ({key, raw: localStorage.getItem(key), recipe: JSON.parse(localStorage.getItem(key))})), ASSISTANCE_STORAGE_PREFIX);
}
async function frames() { await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))); }
async function startPerformance() {
  await page.locator('#start-performance').click();
  await page.waitForFunction(() => document.body.dataset.screen === 'stage' && document.querySelector('#canonical-audio-policy')?.dataset.rendererState === 'playing');
}
async function showNumberedRoles() {
  if (await page.locator('#notation-toggle').getAttribute('aria-expanded') !== 'true') await page.locator('#notation-toggle').click();
  const tools = page.locator('#notation-tools');
  if (await tools.count() && await tools.isVisible() && !await tools.evaluate(node => node.open)) await tools.locator('summary').first().click();
  await page.locator('#jianpu-button').click();
  await page.locator('#notation [data-practice-role="machine"]').first().waitFor();
  return page.locator('#notation [data-note-id]').evaluateAll(nodes => nodes.map(node => ({
    id: node.dataset.noteId, role: node.dataset.practiceRole, active: node.classList.contains('active'),
    color: getComputedStyle(node).color, cue: node.querySelector('[data-practice-machine-cue]')?.getAttribute('stroke-dasharray') || null,
  })));
}

test('real Rust Mod keeps Original unchanged and applies same-part human scoring with machine audio', options, async () => {
  const compilation = await importScore();
  await openSongMod(page); await page.locator('#song-mod-all-human').click();
  assert.equal(await page.locator('#song-mod-assistance-mode').inputValue(), 'original');
  await applyMod();
  await checkpoint('original');
  assert.equal(assistanceRequests().length, 0, 'Ordinary Original Mod must not acquire an assistance dependency');
  assert.deepEqual(await recipes(), []);

  await openSongMod(page); await page.locator('#song-mod-assistance-mode').selectOption('automatic');
  const presetChecks = [await checkedPreset(await selectPreset('single'))];
  const presetLayouts = await measureModLayout();
  assert.deepEqual(await recipes(), [], 'Checking named presets does not save a recipe');
  await applyMod(); const namedSaved = await recipes();
  assert.deepEqual(namedSaved[0].recipe.settings, assistancePresetSettings('single'));
  await openSongMod(page); const namedReopened = await presetView();
  validateAssistancePresetPreview(namedReopened, {id: 'single', settings: assistancePresetSettings('single'), checked: presetChecks[0].response.checked});
  for (const id of ['balanced', 'dense']) presetChecks.push(await checkedPreset(await selectPreset(id)));
  await page.locator('#song-mod-cancel').click();
  assert.deepEqual(await recipes(), namedSaved, 'Cancel preserves the exact applied numeric recipe bytes');
  await openSongMod(page); assert.equal((await presetView()).preset, 'single');
  await page.locator('#song-mod-layout').selectOption('complete');
  await page.locator('#song-mod-show-others').check(); await editAutomatic();
  const customUnchecked = await presetView();
  validateAssistancePresetPreview(customUnchecked, {id: 'custom', settings: canonical.automatic.checked.plan.settings});
  const response = await checkAutomatic();
  const customChecked = await presetView();
  validateAssistancePresetPreview(customChecked, {id: 'custom', settings: response.checked.plan.settings, checked: response.checked});
  await checkpoint('preset-gestures', {presetChecks, presetLayouts, namedReopened, customUnchecked, customChecked});
  await checkpoint('checked', {checked: response});
  assert.deepEqual(response, canonical.automatic, 'The displayed result is the actual Rust API fixture contract');
  assert.match(await page.locator('#song-mod-assistance-legend').innerText(), /● Human.*◆ Machine/s);
  assert.equal(await page.locator('[data-mod-instrument="piano"]').isEnabled(), true);
  await page.locator('[data-mod-instrument="piano"]').selectOption('reed');
  assert.equal(await page.locator('[data-mod-live-instrument]').count(), 0, 'Normal Mod has no live-tone column');
  await applyMod();
  const stopped = await checkpoint('applied');
  assert.equal(stopped.ui.stage.clock.running, false, 'Check and Apply must not autoplay');
  assert.equal(stopped.audio.status.started, 0);
  const saved = await recipes(); assert.equal(saved.length, 1);
  assert.equal(saved[0].recipe.expected_selection_digest, response.checked.plan.selection_digest);
  assert.equal(Object.hasOwn(saved[0].recipe, 'human_source_ids'), false, 'Store only a rebuilding recipe, never cached ownership authority');

  await startPerformance(); await waitForPlaybackClockAdvance(page);
  await page.waitForFunction(() => globalThis.__wmhPreviewAudio.snapshot().some(run => run.pcm.blocks.some(block => block.peak > 1e-6 && block.rms > 1e-8)));
  await page.locator('#play-button').click();
  await page.waitForFunction(() => !globalThis.__wmhReadPlaybackClock().running);
  await page.locator('#results-button').click();
  const assessed = page.waitForResponse('**/api/assess'); await page.locator('#assess-button').click();
  const assessmentResponse = await assessed; assert.equal(assessmentResponse.status(), 200);
  const assessmentRequest = assessmentResponse.request().postDataJSON();
  const assessment = await assessmentResponse.json();
  await page.locator('#feedback-results').waitFor({state: 'visible'});
  await page.locator('#results-dialog [data-close-panel]').click();
  const take = await exportJson('export-takes', 'results');
  const source = await exportJson('export-button', 'score-tools');
  const roles = await showNumberedRoles();
  const played = await checkpoint('scored', {take, assessmentRequest, assessment, exportedSource: source, roles});
  assert.deepEqual(source, compilation.score, 'Assistance never writes a source-note subset');
  assert.deepEqual(assessmentRequest.timeline.notes, response.checked.human_targets.timeline.notes);
  assert.deepEqual(take.target_plan.timeline.notes, response.checked.human_targets.timeline.notes);
  assert.deepEqual(take.passes[0].timeline.notes, response.checked.human_targets.timeline.notes);
  assert.deepEqual(take.passes[0].assessment, assessment, 'The exported take includes the completed real assessment, not a pending snapshot');
  assert.equal(take.passes[0].interpretation.practice_assistance.plan.selection_digest, response.checked.plan.selection_digest);
  assert.deepEqual(take.passes[0].inputs, [], 'Machine worklet gates do not masquerade as human input');
  assert.deepEqual(new Set(played.ui.stage.humanIds), new Set(response.checked.human_targets.timeline.notes.map(note => note.id)));
  assert.deepEqual(new Set(played.ui.stage.machineIds), new Set(response.checked.machine_occurrence_ids));
  for (const ownership of response.checked.source_ownership) {
    const role = roles.find(note => note.id === ownership.source_id);
    assert.ok(role, `The retained source note ${ownership.source_id} stays visible in numbered notation`);
    assert.equal(role.role, ownership.owner);
    if (ownership.owner === 'machine') { assert.equal(role.cue, '3 3'); assert.equal(role.active, false); }
    else assert.equal(role.cue, null);
  }
  const run = played.audio.runs.find(run => run.started);
  assert.equal(run.node.actualAudioWorkletNode, true); assert.equal(run.plan.notes.length, 1);
  assert.deepEqual(run.plan.instruments, [2], 'Same-part machine help keeps its selected reed sound');
  const machine = compilation.timeline.notes.find(note => response.checked.machine_occurrence_ids.includes(note.id));
  assert.deepEqual(run.plan.notes[0], [compilation.timeline.notes.indexOf(machine), Math.floor(machine.start_ms * run.plan.sampleRate / 1000), Math.ceil((machine.start_ms + machine.duration_ms) * run.plan.sampleRate / 1000), machine.midi, machine.velocity]);
  assert.ok(run.messages.some(message => message.type === 'started' && message.isTrusted && message.portMatches));
  assert.equal(run.plan.durationFrames, Math.ceil(compilation.timeline.duration_ms * run.plan.sampleRate / 1000));
  assert.ok(assistanceRequests().filter(row => row.path.endsWith('/generate')).length >= 2, 'Start rebuilds against the admitted stage source');

  await openSongMod(page, {origin: 'stage'});
  const customReopened = await presetView();
  assert.equal(customReopened.preset, 'custom'); assert.deepEqual(customReopened.settings, customChecked.settings);
  const canceledPreset = await selectPreset('dense');
  assert.equal(await page.locator('#song-mod-apply').isDisabled(), true, 'A preset change still needs explicit stage reset');
  await page.locator('#song-mod-cancel').click();
  assert.deepEqual(await exportJson('export-takes', 'results'), take, 'Preset Cancel preserves the complete scored take and input evidence');
  const canceledClock = await page.evaluate(() => globalThis.__wmhReadPlaybackClock()); assert.equal(canceledClock.running, false);
  await openSongMod(page, {origin: 'stage'}); assert.equal((await presetView()).preset, 'custom');
  await checkpoint('preset-cancel-take', {customReopened, canceledPreset, canceledClock});
  await page.locator('#song-mod-assistance-mode').selectOption('original');
  await checkpoint('reset-required');
  assert.equal(await page.locator('#song-mod-apply').isDisabled(), true);
  await page.locator('#song-mod-cancel').click();
  assert.deepEqual((await exportJson('export-takes', 'results')).passes, take.passes, 'Cancel preserves the previous take');
  await openSongMod(page, {origin: 'stage'}); await page.locator('#song-mod-assistance-mode').selectOption('original');
  await page.locator('#song-mod-assistance-reset').check(); await applyMod();
  await page.waitForFunction(() => !document.querySelector('#play-button').disabled && globalThis.__wmhPreviewAudio.quiet());
  const reset = await checkpoint('explicit-reset');
  assert.equal(reset.ui.stage.clock.positionMs, 0); assert.equal(reset.ui.stage.clock.running, false);
  assert.equal(await page.locator('#export-takes').isDisabled(), true, 'Confirmed ownership change clears in-memory takes');
  await page.locator('#play-button').click();
  await page.waitForFunction(() => globalThis.__wmhPreviewAudio.snapshot().filter(run => run.started).length === 2);
  const restarted = await checkpoint('explicit-restart');
  assert.equal(restarted.audio.runs.filter(run => run.started).at(-1).plan.notes.length, 0, 'Original gives every selected source occurrence back to the human');
  await page.locator('#reset-button').click();
});

test('real Rust delayed Check and Cancel cannot overwrite a newer numeric assignment', options, async () => {
  await importScore(); const entered = deferred(), release = deferred(), forwarded = deferred(); let first = true;
  await page.route('**/api/practice-assistance/generate', async route => {
    if (!first) return route.continue(); first = false;
    const response = await route.fetch(); entered.resolve(); await release.promise;
    try { await route.fulfill({response}); } catch (error) { if (!/abort|closed|canceled|disposed/i.test(error.message)) throw error; }
    finally { forwarded.resolve(); }
  });
  try {
    await openSongMod(page); await editAutomatic(); await page.locator('#song-mod-assistance-check').click(); await entered.promise;
    await page.locator('#song-mod-cancel').click(); await checkpoint('cancel-pending');
    assert.deepEqual(await recipes(), []); assert.equal((await readCanonicalPreviewAudio(page)).status.started, 0);
    await openSongMod(page); await editAutomatic({...canonical.automatic.checked.plan.settings, min_onset_interval_ms: 0});
    const newer = await checkAutomatic(); release.resolve(); await forwarded.promise; await frames();
    await checkpoint('newer-checked', {newer});
    assert.equal(newer.checked.coverage.human_target_count, 2);
    assert.match(await page.locator('#song-mod-assistance-status').innerText(), /2 human targets · 0 machine occurrences/);
    await applyMod(); const saved = await recipes(); await checkpoint('newer-applied', {saved});
    assert.equal(saved.length, 1); assert.equal(saved[0].recipe.settings.min_onset_interval_ms, 0);
    assert.equal(saved[0].recipe.expected_selection_digest, newer.checked.plan.selection_digest);
    assert.equal((await readCanonicalPreviewAudio(page)).status.started, 0);
  } finally { release.resolve(); await page.unroute('**/api/practice-assistance/generate'); }
});

test('saved assistance recipe waits for a fresh Rust rebuild after browser reload', options, async () => {
  await importScore(); const response = await automaticPreview();
  await page.locator('#catalog [data-library-key^="browser:"]').first().waitFor();
  const libraryKey = await page.locator('#catalog [data-library-key^="browser:"]').first().getAttribute('data-library-key');
  const saved = await recipes(), entered = deferred(), release = deferred(); let first = true;
  await page.route('**/api/practice-assistance/generate', async route => {
    if (!first || route.request().postDataJSON().score?.id !== canonical.compilation.score.id) return route.continue();
    first = false; const response = await route.fetch(); entered.resolve(); await release.promise; await route.fulfill({response});
  });
  try {
    await page.reload({waitUntil: 'domcontentloaded'}); await waitForPlaybackClock(page); await installCanonicalPreviewAudio(page);
    await page.locator('#home-single-player').click();
    // Instrument range is a session setting; reconstruct the same explicit
    // profile before restoring its saved source-bound assignment.
    await page.locator('#settings-button').click(); await page.locator('#key-count').selectOption('88');
    await page.locator('#settings-dialog [data-close-panel]').click();
    await page.locator(`[data-library-key=${JSON.stringify(libraryKey)}]`).click(); await entered.promise;
    const waiting = await checkpoint('restore-waits', {saved});
    assert.equal(waiting.ui.preview.startDisabled, true); assert.equal(waiting.audio.status.started, 0);
    assert.deepEqual(await recipes(), saved, 'The stored recipe is never replaced by a pending response');
    release.resolve(); await page.waitForFunction(() => !document.querySelector('#start-performance').disabled);
    await openSongMod(page); const restored = await checkpoint('restored');
    assert.equal(await page.locator('#song-mod-assistance-mode').inputValue(), 'automatic');
    assert.match(restored.ui.dialog.status, /1 human targets · 1 machine occurrences/);
    assert.equal((await recipes())[0].recipe.expected_selection_digest, response.checked.plan.selection_digest);
    await page.locator('#song-mod-cancel').click();
    assert.ok(assistanceRequests().filter(row => row.path.endsWith('/generate')).length >= 2);
  } finally { release.resolve(); await page.unroute('**/api/practice-assistance/generate'); }
});

test('cross-scope exact unison explicitly blocks empty human scoring and retains complete notation', options, async () => {
  const score = originalCrossScopeAssistanceScore(canonical); await importScore(score);
  await openSongMod(page); await page.locator('#song-mod-all-machine').click();
  await page.locator('[data-mod-performer="piano"]').selectOption('human'); await editAutomatic();
  const checked = await checkAutomatic(); await checkpoint('cross-scope-checked', {checked});
  assert.equal(checked.checked.scored_mode_allowed, false); assert.equal(checked.checked.human_targets.target_count, 0);
  assert.ok(checked.checked.exclusion_reasons.some(reason => reason.code === 'cross_scope_physical_group'));
  assert.match(await page.locator('#song-mod-assistance-status').innerText(), /no playable human targets/i);
  await applyMod(); const blocked = await checkpoint('cross-scope-blocked');
  assert.equal(blocked.ui.preview.startDisabled, true);
  assert.match(blocked.ui.preview.gate, /No human targets|no playable human/i);
  assert.deepEqual(await exportJson('export-button', 'score-tools'), score);
});

test('Rust Basic and VSQ fixture replay retains real worklet gates and explicit empty-scope ownership', options, async () => {
  const result = await page.evaluate(replayNativeAssistanceAudio, {basic: fixtures.basic, vsq: fixtures.vsq, vsqOpened: fixtures.vsqOpened});
  await checkpoint('native-fixture-audio', {nativeFixtureReplay: result});
  assert.equal(result.status.overflow, false); assert.deepEqual(result.status.errors, []); assert.equal(result.status.activeReceivers, 0);
  assert.equal(result.audio.length, 2);
  for (const run of result.audio) {
    assert.equal(run.node.actualAudioWorkletNode, true);
    assert.ok(run.messages.some(message => message.type === 'started' && message.isTrusted && message.portMatches));
    assert.ok(run.pcm.blocks.some(block => block.audioTime >= run.started.anchorTime && block.peak > 1e-6 && block.rms > 1e-8), 'The checked machine remainder produces real output PCM');
    assert.equal(run.pcm.graphToDestination?.at(-1)?.type, 'AudioDestinationNode');
  }
  for (const row of result.cases) {
    assert.equal(row.sourceUnchanged, true); assert.deepEqual(row.errors, []);
    assert.equal(row.ended.trusted, true); assert.equal(row.ended.portMatches, true);
    assert.equal(row.plan.durationFrames, row.full.durationFrames);
    assert.deepEqual(row.plan.notes, row.full.notes.filter(note => row.checked.machine_occurrence_ids.includes(note[0])));
    assert.equal(row.ended.started, row.plan.notes.length); assert.equal(row.ended.ended, row.plan.notes.length);
    for (const [index, note] of row.plan.notes.entries()) {
      assert.equal(row.ended.ledger.actualStarts[index], row.started.anchorFrame + note[2]);
      assert.equal(row.ended.ledger.actualEnds[index], row.started.anchorFrame + note[3]);
    }
    assert.equal(row.original.notes.length, 0);
  }
  const basic = result.cases.find(row => row.kind === 'basic'), vsq = result.cases.find(row => row.kind === 'vsq');
  const second = basic.plan.notes.find(note => note[0] === 'midi-t1-e4');
  assert.deepEqual(second.slice(2, 4), [Math.floor(result.sampleRate * .125), Math.ceil(result.sampleRate * .5)], 'Second overlapping C4 retains its own FIFO release');
  assert.deepEqual(new Set(basic.automatic.notes.map(note => note[0])), new Set(fixtures.basic.automatic.checked.machine_occurrence_ids));
  assert.equal(vsq.checked.scored_mode_allowed, false); assert.equal(vsq.automatic.notes.length, 0);
  assert.deepEqual(vsq.empty.notes, vsq.full.notes); assert.ok(vsq.plan.notes.every(note => note[2] === 0));
});

test('explicit Off survives a checked Original response-limit fault and preserves the pinned take', options, async () => {
  const compilation = await importScore(), libraryKey = await page.locator('#song-lobby').getAttribute('data-preview-id');
  const automatic = await automaticPreview(); assert.deepEqual(automatic, canonical.automatic);
  await startPerformance(); await waitForPlaybackClockAdvance(page); await page.locator('#play-button').click();
  await page.waitForFunction(() => !globalThis.__wmhReadPlaybackClock().running);
  // Performance controls move count-in into the real settings dialog.
  await page.locator('#settings-button').click();
  await page.locator('#count-in').uncheck();
  await page.locator('#settings-dialog [data-close-panel]').click();
  const before = await exportJson('export-takes', 'results'), automaticRecipe = await recipes();
  const faultInjection = {path: '/api/practice-assistance/original', status: 422, code: 'assistance_response_limit',
    score_id: compilation.score.id, scope: 'Endpoint fault injection on a tiny original exercise; not a large or private song GUI run'};
  let injected = 0;
  await page.route('**/api/practice-assistance/original', async route => {
    if (!isDeepStrictEqual(route.request().postDataJSON().score, compilation.score)) return route.continue();
    injected++;
    await route.fulfill({status: 422, contentType: 'application/json', body: JSON.stringify({code: faultInjection.code,
      error: 'Complete assistance response exceeds 16 MiB; no IDs or ownership entries were truncated', source_note_ids: []})});
  });
  try {
    await openSongMod(page, {origin: 'stage'}); await page.locator('#song-mod-assistance-mode').selectOption('original');
    const failed = page.waitForResponse('**/api/practice-assistance/original'); await page.locator('#song-mod-assistance-check').click();
    const failedResponse = await failed; assert.equal(failedResponse.status(), 422); assert.equal((await failedResponse.json()).code, faultInjection.code);
    await page.waitForFunction(() => document.querySelector('#song-mod-assistance-status').dataset.phase === 'error');
    await checkpoint('checked-original-fault', {faultInjection});
    assert.match(await page.locator('#song-mod-assistance-status').innerText(), /16 MiB/);
    assert.deepEqual(await recipes(), automaticRecipe, 'A failed checked Original request cannot silently switch assistance off');
    await page.locator('#song-mod-cancel').click();
    const failedTake = await exportJson('export-takes', 'results');
    assert.deepEqual(failedTake.practice_assistance, before.practice_assistance); assert.deepEqual(failedTake.passes, before.passes);

    await openSongMod(page, {origin: 'stage'}); await page.locator('#song-mod-assistance-off').click();
    assert.equal(await page.locator('#song-mod-apply').isDisabled(), true, 'Stage Off must require explicit take-reset acknowledgement');
    await page.locator('#song-mod-assistance-reset').check();
    const fullTargets = page.waitForResponse(response => new URL(response.url()).pathname === '/api/practice-targets'
      && isDeepStrictEqual(response.request().postDataJSON().timeline, compilation.timeline));
    await applyMod(); const targetResponse = await fullTargets; assert.equal(targetResponse.status(), 200);
    const fullPlan = await targetResponse.json(); await checkpoint('stage-off-reset', {fullPlan});
    assert.deepEqual(fullPlan.timeline.notes, canonical.original.checked.human_targets.timeline.notes);
    assert.equal(await page.locator('#export-takes').isDisabled(), true);
    assert.equal((await page.locator('#progress').evaluate(node => JSON.parse(node.getAttribute('data-playback-clock')))).positionMs, 0);
    const off = await recipes(); assert.equal(off.length, 1);
    assert.deepEqual(Object.keys(off[0].recipe).sort(), ['format', 'preference_key', 'source', 'version']);
    assert.equal(off[0].recipe.format, 'wmc-practice-assistance-off'); assert.equal(injected, 1, 'Explicit Off must bypass the failed checked endpoint');

    // Re-establish a real Automatic take, then change only the lobby candidate.
    // Resume must retain that take until the user explicitly starts a new one.
    await page.locator('#back-to-library').click(); await automaticPreview(); await startPerformance(); await waitForPlaybackClockAdvance(page);
    await page.locator('#back-to-library').click(); const pinned = await exportJson('export-takes', 'results');
    await openSongMod(page); await page.locator('#song-mod-assistance-off').click(); await applyMod();
    const savedOff = await recipes();
    await page.locator('#resume-session').click(); await page.waitForFunction(() => !document.querySelector('#play-button').disabled);
    const resumed = await exportJson('export-takes', 'results');
    const pinnedProof = await checkpoint('preview-off-pinned', {pinned, resumed, savedOff});
    assert.deepEqual(resumed.passes, pinned.passes); assert.deepEqual(resumed.target_plan, pinned.target_plan);
    assert.deepEqual(resumed.practice_assistance, pinned.practice_assistance);
    assert.equal(resumed.practice_assistance.plan.mode, 'automatic'); assert.equal(pinnedProof.ui.stage.clock.running, false);
    const assistedRun = pinnedProof.audio.runs.filter(run => run.started).at(-1); assert.equal(assistedRun.plan.notes.length, 1);

    await page.locator('#back-to-library').click(); await startPerformance(); await waitForPlaybackClockAdvance(page);
    await page.locator('#keyboard .piano-key[data-midi="60"]').click();
    await page.waitForFunction(() => document.querySelector('#hud-captured').textContent === '1');
    await page.locator('#results-button').click();
    const assessed = page.waitForResponse(response => new URL(response.url()).pathname === '/api/assess'
      && isDeepStrictEqual(response.request().postDataJSON().timeline.notes, fullPlan.timeline.notes));
    await page.locator('#assess-button').click(); const assessedResponse = await assessed; assert.equal(assessedResponse.status(), 200);
    const assessment = await assessedResponse.json(); await page.locator('#feedback-results').waitFor({state: 'visible'});
    await page.locator('#results-dialog [data-close-panel]').click();
    const fresh = await exportJson('export-takes', 'results'), source = await exportJson('export-button', 'score-tools');
    const freshProof = await checkpoint('new-off-take', {fresh, assessment, exportedSource: source});
    assert.equal(fresh.practice_assistance, null); assert.equal(fresh.practice_assistance_disabled, true);
    assert.equal(fresh.passes.length, 1); assert.deepEqual(fresh.target_plan.timeline.notes, fullPlan.timeline.notes);
    assert.deepEqual(fresh.passes[0].timeline.notes, fullPlan.timeline.notes); assert.deepEqual(fresh.passes[0].assessment, assessment);
    assert.equal(fresh.passes[0].interpretation.practice_assistance, null); assert.equal(fresh.passes[0].interpretation.practice_assistance_disabled, true);
    assert.equal(fresh.passes[0].inputs.length, 1); assert.equal(fresh.passes[0].inputs[0].midi, 60);
    assert.deepEqual(source, compilation.score);
    const unassistedRun = freshProof.audio.runs.filter(run => run.started).at(-1);
    assert.equal(unassistedRun.node.actualAudioWorkletNode, true); assert.equal(unassistedRun.plan.notes.length, 0);
    for (const field of ['sourceFingerprint', 'compiledFingerprint', 'sourceOccurrences', 'durationFrames']) assert.equal(unassistedRun.plan[field], assistedRun.plan[field], field);
    assert.equal(unassistedRun.plan.assistanceFingerprint, undefined);

    const reloadStart = requests.length;
    await page.reload({waitUntil: 'domcontentloaded'}); await waitForPlaybackClock(page); await installCanonicalPreviewAudio(page);
    await page.locator('#home-single-player').click(); await page.locator('#settings-button').click(); await page.locator('#key-count').selectOption('88');
    await page.locator('#settings-dialog [data-close-panel]').click();
    await page.locator(`[data-library-key=${JSON.stringify(libraryKey)}]`).click();
    await page.waitForFunction(() => !document.querySelector('#start-performance').disabled && /assistance is off/.test(document.querySelector('#song-mod-preview-summary').textContent));
    const restoredOff = await recipes(); await checkpoint('off-reloaded', {restoredOff});
    assert.deepEqual(restoredOff, savedOff); assert.equal(restoredOff[0].recipe.format, 'wmc-practice-assistance-off');
    assert.equal(requests.slice(reloadStart).some(row => row.path.startsWith('/api/practice-assistance/')), false, 'Reload must use ordinary full-part admission without rebuilding Automatic');
    assert.equal(injected, 1);
  } finally { await page.unroute('**/api/practice-assistance/original'); }
});
