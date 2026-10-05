import {browserSongModControls} from './browser-song-mod-controls.js';
import {configureSongMod, openSongMod} from '../scripts/hosted-song-mod-controls.mjs';
import {readPlaybackClock, installPlaybackClockReader, waitForPlaybackClock, waitForPlaybackClockAdvance} from './browser-playback-clock.js';
import {registerGameLobbyBrowserRegressions} from './game-lobby-browser-regression.js';
import {assertLocaleRoundTrip,registerLocaleBrowserRegressions} from './locale-browser-regression.js';
import {registerBeginnerBrowserRegressions} from './beginner-browser-regression.js';
import {registerStaffRegisterBrowserRegressions} from './staff-register-browser-regression.js';
import {registerAboveKeyboardBrowserRegressions} from './above-keyboard-browser-regression.js';
import {registerReferenceListeningBrowserRegressions} from './reference-listening-browser-regression.js';
import {registerSharedPianoStageBrowserRegressions} from './shared-piano-stage-browser-regression.js';
import {registerFreePianoBrowserRegressions} from './free-piano-browser-regression.js';
import {selectLegacyEnglish, wideKeyboardBindings, keyboardBrowserScore, observeRealAudio, guitarPhraseBrowserScore, boundedPreviewBrowserRecord, orderedInitialTempoBrowserMidi, standardMidiDisclosure} from './browser-input-fixtures.js';
/**
 * Full-stack checks against the actual Rust executable and its embedded UI.
 * Build first: cargo build -p practice-server --locked
 * Run: node --test tests/full-app-browser.test.js
 * Optional: WMH_SERVER_BINARY selects another already-built executable;
 * WMH_ARTIFACT_DIR selects the screenshot directory (default: OS temp directory).
 * API response bodies, audio APIs and score-compilation results come from the real app.
 * The activation-boundary case only delays forwarding requests to the Rust server.
 */
import test, {before, after, beforeEach, afterEach} from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {createHash} from 'node:crypto';
import {existsSync} from 'node:fs';
import {mkdir, readFile, writeFile} from 'node:fs/promises';
import {createServer} from 'node:net';
import {tmpdir,freemem,totalmem} from 'node:os';
import {join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {setTimeout as delay} from 'node:timers/promises';
import {chromium} from 'playwright';
import {isDeepStrictEqual} from 'node:util';
import {fixture} from './frontend-fixtures.js';
import {densePianoforte} from './numbered-layout-fixtures.js';
import {originalGuitarChordTransitions} from './guitar-live-fixtures.js';
import {connectionDiagnostics} from './browser-connection-diagnostics.js';
import {validatePerformanceRecord} from '../web/performance-library.js';
import {assertAddedLibraryCopies} from './library-copy-assertions.js';

const root = fileURLToPath(new URL('../', import.meta.url));
const binary = resolve(root, process.env.WMH_SERVER_BINARY || join('target', 'debug', `practice-server${process.platform === 'win32' ? '.exe' : ''}`));
const artifactDirectory = resolve(process.env.WMH_ARTIFACT_DIR || tmpdir());
const fixtures = new URL('./fixtures/', import.meta.url);
const testOptions = {timeout: 45_000};
let server, browser, context, page, origin, initialCompilation;
let serverOutput = '', serverError, pageErrors = [], apiFailures = [], requests = [];
let browserConsole = [], failedResources = [], resourceFailures = [], currentTestName='bootstrap';
const bootstrapTimeout = 25_000;
let attemptedContexts=0;
const getRequestsForLocale=()=>requests.map(request=>({...request}));

// Route legacy coverage through the same visible panels that a player uses.
// Inspection only discovers the owning surface; every state change is a real click.
const shellPanels = ['settings', 'score-tools', 'import-tools', 'results'];
async function closeShellPanels(except = null) {
  if(await page.locator('#notation-tools').count()&&await page.locator('#notation-tools').isVisible()&&await page.locator('#notation-tools').evaluate(node=>node.open))await page.locator('#notation-tools>summary').click();
  for (const name of shellPanels) {
    const dialog = page.locator(`#${name}-dialog`);
    if (name !== except && await dialog.isVisible()) await dialog.locator('[data-close-panel]').click();
  }
}
async function revealControl(locator) {
  await locator.first().waitFor({state: 'attached'});
  const owner = await locator.first().evaluate(element => ({
    dialog: element.closest('dialog')?.id,
    lobby: Boolean(element.closest('#song-lobby')),
    home: Boolean(element.closest('#game-home')),
    notation: Boolean(element.closest('#notation-dock')),
    stage: Boolean(element.closest('#workspace')),
    notationOptions: Boolean(element.closest('.dock-help') && !element.matches('.dock-help>summary')),
  }));
  const panel = shellPanels.find(name => `${name}-dialog` === owner.dialog);
  if (owner.dialog && !panel) return; // Existing review dialogs keep their own explicit lifecycle.
  await closeShellPanels(panel);
  if (panel && !await page.locator(`#${panel}-dialog`).isVisible()) await page.locator(`#${panel}-button`).click();
  if (owner.home && !await page.locator('#game-home').isVisible()) {
    if (await page.locator('#workspace').isVisible()) await page.locator('#back-to-library').click();
    if (await page.locator('#free-practice-screen').isVisible()) await page.locator('#free-exit').click();
    await page.locator('#lobby-home').click();
  }
  if (owner.lobby && !await page.locator('#song-lobby').isVisible()) {
    if (await page.locator('#game-home').isVisible()) await page.locator('#home-single-player').click();
    else await page.locator('#back-to-library').click();
  }
  if (owner.stage && await page.locator('#game-home').isVisible()) await page.locator('#home-single-player').click();
  if (owner.stage && await page.locator('#song-lobby').isVisible()) await page.locator('#resume-session').click();
  if (owner.notation && await page.locator('#notation-toggle').getAttribute('aria-expanded')!=='true') {
    if (await page.locator('#song-lobby').isVisible()) await page.locator('#resume-session').click();
    await page.locator('#notation-toggle').click();
  }
  if (owner.notation && await page.locator('#notation-tools').count() && await page.locator('#notation-tools').isVisible() && !await page.locator('#notation-tools').evaluate(node=>node.open)) await page.locator('#notation-tools>summary').click();
  if (owner.notationOptions && !await page.locator('.dock-help').evaluate(node=>node.open)) await page.locator('.dock-help>summary').click();
}
function ui(selector) {
  const wrap = locator => new Proxy(locator, {get(target, property) {
    if (['locator', 'filter', 'nth', 'first', 'last', 'getByRole', 'getByLabel'].includes(property)) return (...args) => wrap(target[property](...args));
    if (['click', 'fill', 'selectOption', 'check', 'uncheck', 'setInputFiles', 'focus', 'press'].includes(property)) return async (...args) => {
      await revealControl(target);
      return target[property](...args);
    };
    if (property === 'waitFor') return async (options = {}) => {
      if (!options.state || options.state === 'visible') await revealControl(target);
      return target.waitFor(options);
    };
    const value = target[property];
    return typeof value === 'function' ? value.bind(target) : value;
  }});
  return wrap(page.locator(selector));
}
const {configureStageMod,setSessionMode,selectPracticePart,startPreview}=browserSongModControls({getPage:()=>page,closeShellPanels});
async function reloadStage(options) {
  const response = await page.reload(options);await waitForPlaybackClock(page);
  await selectLegacyEnglish(page);
  await startPreview();
  return response;
}

async function availablePort() {
  const reservation = createServer();
  await new Promise((resolve, reject) => {
    reservation.once('error', reject);
    reservation.listen(0, '127.0.0.1', resolve);
  });
  const port = reservation.address().port;
  await new Promise((resolve, reject) => reservation.close(error => error ? reject(error) : resolve()));
  return port;
}

function serverRunning() {
  return server && server.exitCode === null && server.signalCode === null && !serverError;
}

function emergencyStop() {
  if (serverRunning()) server.kill('SIGKILL');
}

function interrupt() {
  emergencyStop();
  process.exit(130);
}

async function stopServer() {
  if (!serverRunning()) return;
  const exited = new Promise(resolve => server.once('exit', resolve));
  server.kill('SIGTERM');
  await Promise.race([exited, delay(2500, undefined, {ref: false})]);
  if (serverRunning()) {
    server.kill('SIGKILL');
    await Promise.race([exited, delay(2500, undefined, {ref: false})]);
  }
  assert.ok(!serverRunning(), 'Rust server did not terminate after SIGKILL');
}

async function waitForServer() {
  const deadline = Date.now() + 15_000;
  let lastError;
  while (Date.now() < deadline) {
    if (serverError) throw serverError;
    if (!serverRunning()) throw new Error(`Rust server exited during startup.\n${serverOutput}`);
    try {
      const response = await fetch(`${origin}/api/health`, {signal: AbortSignal.timeout(1000)});
      assert.equal(response.status, 200);
      const health = await response.json();
      assert.equal(health.engine, 'rust');
      assert.equal(health.network, 'loopback-only');
      return;
    } catch (error) {
      lastError = error;
      await delay(100);
    }
  }
  throw new Error(`Rust server never became healthy: ${lastError?.message}\n${serverOutput}`);
}

async function rustApi(path, data) {
  const response = await fetch(`${origin}${path}`, {
    method: data === undefined ? 'GET' : 'POST',
    headers: data === undefined ? {} : {'Content-Type': 'application/json'},
    body: data === undefined ? undefined : JSON.stringify(data),
    signal: AbortSignal.timeout(10_000),
  });
  const body = await response.text();
  assert.equal(response.status, 200, `${path}: ${body}`);
  assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
  return JSON.parse(body);
}

function nextResponse(path, timeout = 10_000) {
  return page.waitForResponse(response => new URL(response.url()).pathname === path, {timeout});
}

function nextTargetResponse(profile, timeline) {
  return page.waitForResponse(response => new URL(response.url()).pathname === '/api/practice-targets'
    && response.request().method() === 'POST'
    && isDeepStrictEqual(response.request().postDataJSON(), {timeline, profile}), {timeout:10_000});
}

async function responseJson(response) {
  const body = await response.text();
  assert.equal(response.status(), 200, `${response.url()}: ${body}`);
  return JSON.parse(body);
}

async function readyForTitle(title) {
  // Imports and saved-copy activation already own the canonical score. Resume them
  // without starting whichever unrelated candidate was last browsed in the lobby.
  await page.waitForFunction(expected => {
    return document.querySelector('#score-title').textContent === expected
      && !document.querySelector('#play-button').disabled;
  }, title);
  await closeShellPanels();
  if (await page.locator('#song-lobby').isVisible()) await page.locator('#resume-session').click();
  assert.equal(await page.locator('#stage-title').textContent(), title);
}

async function activateCatalogTitle(title) {
  await page.waitForFunction(expected => document.querySelector('#preview-title').textContent === expected
    && !document.querySelector('#configure-song-mod').disabled, title);
  await startPreview();
  await readyForTitle(title);
}

async function humanModPartIds() {
  await closeShellPanels();if(await page.locator('#song-lobby').isVisible())await page.locator('#resume-session').click();
  const draft=await openSongMod(page,{origin:'stage'});await page.locator('#song-mod-cancel').click();
  return draft.parts.filter(part=>part.performer==='human').map(part=>part.partId);
}

async function hideNotation() {
  await closeShellPanels();
  if (await page.locator('#notation-toggle').getAttribute('aria-expanded')==='true') await page.locator('#notation-toggle').click();
}

async function exportScore() {
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    ui('#export-button').click(),
  ]);
  assert.equal(await download.failure(), null);
  const path = await download.path();
  assert.ok(path, 'The browser must produce a real JSON download');
  const bytes = await readFile(path);
  assert.ok(bytes.length <= 8 * 1024 * 1024, 'Canonical downloads must fit the advertised JSON reimport limit');
  const score = JSON.parse(bytes.toString('utf8'));
  assert.equal(download.suggestedFilename(), `${score.id.replace(/[^\w.-]/g, '_')}.json`);
  return score;
}

function assertHeaderNormalization(compilation, expectedCount = 1) {
  const retained = (compilation.score.source.import_diagnostics || []).filter(item => item.code === 'musicxml_header_normalized');
  assert.equal(retained.length, expectedCount, 'The raw source retains one observation per normalized standard header');
  for (const observation of retained) {
    assert.equal(observation.severity, 'warning');
    assert.equal(observation.note_id, null);
    assert.ok(!observation.message.startsWith('Retained import observation: '));
  }
  assert.deepEqual(
    compilation.diagnostics.filter(item => item.code === 'musicxml_header_normalized'),
    retained.map(item => ({...item, message: `Retained import observation: ${item.message}`})),
    'Compilation exposes the retained header warning exactly once, with exactly one prefix',
  );
}

function writtenMusic(score) {
  const {title, composer, tempo, meters, keys, measures, repeats} = score;
  return {title, composer, tempo, meters, keys, measures, repeats, parts: score.parts.map(({id, notes, ...part}) => ({
    ...part, notes: notes.map(({id, ...note}) => note),
  }))};
}

function soundingMusic(compilation) {
  const partIndexes = new Map(compilation.score.parts.map((part, index) => [part.id, index]));
  return compilation.timeline.notes.map(note => [partIndexes.get(note.part_id), note.staff, note.midi,
    Number(note.start_ms.toFixed(6)), Number(note.duration_ms.toFixed(6)), note.velocity])
    .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
}

// Inspect the real origin-local database read-only; all saves/restores still use
// the app's import controls and archive dialog, never a test-injected write.
async function browserLibrarySnapshot() {
  await page.waitForFunction(() => document.querySelector('[data-score-storage]').getAttribute('aria-busy') === 'false');
  return page.evaluate(async () => {
    const {openScoreLibrary} = await import('/local-library.js'), library = await openScoreLibrary();
    try { return await Promise.all((await library.list()).sort((a, b) => a.key.localeCompare(b.key)).map(row => library.get(row.key))); }
    finally { library.close(); }
  });
}

async function waitForBrowserImportCopies(count) {
  await page.waitForFunction(expected => document.querySelector('[data-score-storage]').getAttribute('aria-busy') === 'false'
    && document.querySelector('.score-storage-status').dataset.persistence === 'saved'
    && document.querySelectorAll('#catalog [data-library-key^="browser:"]').length === expected, count);
  const copies = await browserLibrarySnapshot();
  assert.equal(copies.length, count, 'Each accepted file import persists exactly one browser copy');
  assert.deepEqual(await page.locator('#catalog [data-library-key]').evaluateAll(rows => rows.map(row => row.dataset.libraryKey).sort()),
    copies.map(row => `browser:${row.key}`).sort(), 'The lobby and archive use the same saved-copy identities');
  return copies;
}

async function downloadLibraryBackup() {
  const [download] = await Promise.all([page.waitForEvent('download'), ui('#library-export-backup').click()]);
  assert.equal(await download.failure(), null);
  const bytes = await readFile(await download.path()), backup = JSON.parse(bytes);
  assert.equal(backup.format, 'worldmusichub-library-backup');
  assert.equal(backup.version, 1);
  return {bytes, entries: backup.entries};
}

async function libraryRoundtrip(compilation, label, filename, importedCopies) {
  await ui('#library-button').click();
  await page.waitForFunction(() => document.querySelector('#library-status').textContent.startsWith('Ready.'));
  assert.deepEqual(await browserLibrarySnapshot(), importedCopies);
  assert.deepEqual(await ui('#library-list>li').evaluateAll(rows => rows.map(row => row.dataset.libraryKey).sort()), importedCopies.map(row => row.key));
  await ui('#library-label').fill(label);
  await ui('#library-save-copy').click();
  await page.waitForFunction(() => document.querySelector('#library-status').textContent.startsWith('Saved'));
  const savedCopies = await browserLibrarySnapshot();
  const [saved] = assertAddedLibraryCopies(importedCopies, savedCopies, [{label, score: compilation.score}]);
  const {bytes: backup, entries} = await downloadLibraryBackup();
  assert.deepEqual(entries, savedCopies.map(({label, score}) => ({label, score})), 'Backup includes both imported snapshots and the explicit labeled copy');
  const validations = [], collect = response => { if (new URL(response.url()).pathname === '/api/compile') validations.push(response); };
  page.on('response', collect);
  try {
    await ui('#library-backup-file').setInputFiles({name: filename, mimeType: 'application/json', buffer: backup});
    await page.waitForFunction(count => document.querySelector('#library-status').textContent.startsWith(`Restored ${count} new copies`), entries.length);
  } finally { page.off('response', collect); }
  assert.equal(validations.length, entries.length, 'Every backup entry receives its own Rust validation before atomic restoration');
  for (const response of validations) assert.deepEqual(await responseJson(response), compilation, 'Each restored source retains its complete score and diagnostics');
  const restoredCopies = await browserLibrarySnapshot(), added = assertAddedLibraryCopies(savedCopies, restoredCopies, entries);
  assert.deepEqual(await ui('#library-list>li').evaluateAll(rows => rows.map(row => row.dataset.libraryKey).sort()), restoredCopies.map(row => row.key));
  const restoredKey = added.find(row => row.label === label).key;
  assert.notEqual(restoredKey, saved.key);
  const [restoredResponse] = await Promise.all([
    nextResponse('/api/compile'),
    ui(`[data-library-key="${restoredKey}"] [data-library-open]`).click(),
  ]);
  const restored = await responseJson(restoredResponse);
  assert.deepEqual(restored, compilation, 'Opening a restored copy preserves each retained warning without duplication');
  await ui('#score-library').waitFor({state: 'hidden'});
  await readyForTitle(compilation.score.title);
  assert.deepEqual(await exportScore(), compilation.score);
  assert.deepEqual(await browserLibrarySnapshot(), restoredCopies, 'Opening and exporting a saved copy must not persist another import');
  return restored;
}

async function assertStoppedAtZero() {
  assert.match(await ui('#play-button').textContent(), /Play/);
  assert.equal(await ui('#transport-status').textContent(), 'Ready when you are');
  assert.equal((await ui('#progress').evaluate(readPlaybackClock)).positionMs, 0);
  // Observe actual animation frames: loading/confirming a score must not autoplay.
  await page.waitForTimeout(250);
  assert.equal((await ui('#progress').evaluate(readPlaybackClock)).positionMs, 0);
  assert.equal(await ui('#keyboard .piano-key.pressed').count(), 0);
}

async function captureFailureState(stage,error=null) {
  if(!page||page.isClosed())return;
  const name=`worldmusichub-live-${stage}-${currentTestName.replace(/[^a-zA-Z0-9]+/g,'-').slice(0,85)}`;
  const observed=await page.evaluate(()=>({scoreTitle:document.querySelector('#score-title')?.textContent,notice:document.querySelector('#notice')?.textContent,engravingStatus:document.querySelector('#engraving-status')?.textContent,engravingFallback:document.querySelector('#engraving-fallback')?.textContent,fallbackHidden:document.querySelector('#engraving-fallback')?.hidden,engravedSelected:document.querySelector('#engraved-button')?.getAttribute('aria-pressed'),svgCount:document.querySelectorAll('#engraved-staff svg').length,followStatus:document.querySelector('#engraving-follow-status')?.textContent,practiceGate:document.querySelector('#practice-gate-reason')?.textContent,transport:document.querySelector('#transport-status')?.textContent})).catch(error=>({observationError:error.message}));
  const diagnostics={test:currentTestName,failure:error?{name:error.name,code:error.code,causeName:error.cause?.name,frames:String(error.stack||'').split('\n').filter(line=>/^\s*at /.test(line)).slice(0,6)}:null,observed,pageErrors,apiFailures,browserConsole,failedResources,resourceFailures,apiRequests:requests.map(request=>({path:request.path,method:request.method})),serverOutput:serverOutput.slice(-4000)};
  await writeFile(join(artifactDirectory,`${name}.json`),JSON.stringify(diagnostics,null,2));
  await page.screenshot({path:join(artifactDirectory,`${name}.png`),fullPage:true,timeout:3000}).catch(()=>{});
}
async function waitForEngraving(timeout=25_000) {
  // A visible lane renders independently of its control disclosure. Readiness
  // checks during held input must not focus a protected notation control.
  if(!await page.locator('#notation-lane-overlay').isVisible())await revealControl(page.locator('#engraved-button'));
  // Require the completed preview message in either shipped locale. Chinese
  // screenshots must not wait for the English-only text after a language switch.
  await page.waitForFunction(()=>Boolean(document.querySelector('#engraved-staff svg')&&/^(?:Generated staff preview · Measures \d+–\d+ · display only\.|生成的五线谱预览 · 第 \d+–\d+ 小节 · 仅供显示。)$/.test(document.querySelector('#engraving-status').textContent))||!document.querySelector('#engraving-fallback').hidden,null,{timeout});
  if(await ui('#engraving-fallback').isVisible()){
    const reason=await ui('#engraving-fallback').textContent();await captureFailureState('engraving-failure');assert.fail(`Expected real engraved SVG; the app reported: ${reason}`);
  }
  await ui('#engraved-staff svg').first().waitFor({state:'visible',timeout});
  assert.match(await ui('#engraving-status').textContent(),/^(?:Generated staff preview · Measures \d+–\d+ · display only\.|生成的五线谱预览 · 第 \d+–\d+ 小节 · 仅供显示。)$/);
  if(await page.locator('#notation-tools').count()&&await page.locator('#notation-tools').isVisible()&&await page.locator('#notation-tools').evaluate(node=>node.open))await page.locator('#notation-tools>summary').click();
}

async function screenshot(name) {
  const reviewing=await page.locator('dialog[open]').evaluateAll((dialogs,panels)=>dialogs.some(dialog=>!panels.includes(dialog.id)),shellPanels.map(name=>`${name}-dialog`));
  // A native review modal owns the top layer. Capture that state without clicking behind it.
  if(!reviewing){
    await closeShellPanels();
    if(await ui('#engraved-button').getAttribute('aria-pressed')==='true')await waitForEngraving();
  }
  await page.evaluate(async () => {
    await document.fonts.ready;
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  });
  await page.screenshot({path: join(artifactDirectory, `worldmusichub-live-${name}.png`), fullPage: true, animations: 'disabled'});
}

before(async () => {
  assert.ok(existsSync(binary), `Build the real server first: cargo build -p practice-server --locked\nMissing: ${binary}`);
  await mkdir(artifactDirectory, {recursive: true});
  const port = await availablePort();
  origin = `http://127.0.0.1:${port}`;
  server = spawn(binary, ['--no-open', '--port', String(port)], {cwd: root, stdio: ['ignore', 'pipe', 'pipe']});
  server.on('error', error => { serverError = error; });
  for (const stream of [server.stdout, server.stderr]) {
    stream.setEncoding('utf8');
    stream.on('data', chunk => { serverOutput = (serverOutput + chunk).slice(-32_768); });
  }
  process.once('exit', emergencyStop);
  process.once('SIGINT', interrupt);
  process.once('SIGTERM', interrupt);
  await waitForServer();
  const executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE
    || ['/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/google-chrome'].find(existsSync);
  browser = await chromium.launch({
    ...(executablePath ? {executablePath} : {}),
    headless: true,
    timeout: 30_000,
    args: ['--no-sandbox', '--disable-dev-shm-usage'],
  });
}, {timeout: 60_000});

after(async () => {
  try {
    const connections=await connectionDiagnostics(origin);
    await writeFile(join(artifactDirectory,'worldmusichub-live-connection-summary.json'),JSON.stringify({attemptedContexts,connections},null,2));
    await browser?.close();
  } finally {
    try {
      await stopServer();
    } finally {
      process.removeListener('exit', emergencyStop);
      process.removeListener('SIGINT', interrupt);
      process.removeListener('SIGTERM', interrupt);
    }
  }
}, {timeout: 15_000});

beforeEach(async t => {
  currentTestName=t.name||'unknown-test';attemptedContexts++;
  pageErrors = []; apiFailures = []; requests = []; browserConsole = []; failedResources = []; resourceFailures = [];
  context = await browser.newContext({viewport: {width: 1440, height: 1100}, colorScheme: 'light', acceptDownloads: true});
  context.setDefaultTimeout(10_000);
  context.setDefaultNavigationTimeout(15_000);
  page = await context.newPage();
  await installPlaybackClockReader(page);
  page.on('pageerror', error => pageErrors.push(error.message));
  page.on('console', message => { if (['error','warning'].includes(message.type()) && browserConsole.length < 30) browserConsole.push({type:message.type(),text:message.text().slice(0,1000)}); });
  page.on('requestfailed', request => { const url=new URL(request.url()); if(url.origin===origin && failedResources.length<30)failedResources.push({path:url.pathname,error:request.failure()?.errorText}); });
  page.on('request', request => {
    const url = new URL(request.url());
    if (url.origin === origin && url.pathname.startsWith('/api/')) {
      requests.push({path: url.pathname, method: request.method(), body: request.postData()});
    }
  });
  page.on('response', response => {
    const url = new URL(response.url());
    if(url.origin===origin && response.status()>=400 && resourceFailures.length<30)resourceFailures.push({path:url.pathname,status:response.status()});
    if (url.origin === origin && url.pathname.startsWith('/api/') && response.status() >= 400) {
      apiFailures.push(`${response.status()} ${url.pathname}`);
    }
  });
  // Wait for the app's observable ready contract, not unrelated network-idle heuristics.
  // Promise.all immediately handles both waiters if navigation or compilation fails.
  try {
    const [compilation] = await Promise.all([
      nextResponse('/api/compile', bootstrapTimeout),
      page.goto(origin, {waitUntil: 'domcontentloaded'}),
    ]);
    await waitForPlaybackClock(page);
    initialCompilation = await responseJson(compilation);
    await page.locator('#game-home').waitFor({state:'visible'});
    assert.equal(await page.locator('#workspace').isVisible(),false,'Startup menu does not activate a practice session');
    await page.locator('#home-single-player').click();
    await page.locator('#song-lobby').waitFor({state:'visible'});
    assert.equal(await page.locator('#game-home').isVisible(),false,'Single-player enters the actual library');
    await selectLegacyEnglish(page,{fresh:true});
    await startPreview();
    await readyForTitle(initialCompilation.score.title);
    await page.waitForFunction(()=>document.querySelector('#practice-scope').textContent.includes('physical attacks'));
    await waitForEngraving();
    assert.equal(await ui('#engraved-button').getAttribute('aria-pressed'),'true','Supported original scores use the offline engraved view by default');
  } catch (error) {
    const observed = await page.evaluate(() => ({url:location.href,readyState:document.readyState,title:document.title,notice:document.querySelector('#notice')?.textContent,scoreTitle:document.querySelector('#score-title')?.textContent,playDisabled:document.querySelector('#play-button')?.disabled})).catch(failure=>({observationError:failure.message}));
    const connections=await connectionDiagnostics(origin);
    const diagnostics={failure:error.message,connections,observed,pageErrors,apiFailures,browserConsole,failedResources,resourceFailures,runtime:{platform:process.platform,node:process.version,browser:browser.version(),attemptedContexts,processMemory:process.memoryUsage(),systemFreeBytes:freemem(),systemTotalBytes:totalmem(),activeResources:process.getActiveResourcesInfo()},apiRequests:requests.map(request=>({path:request.path,method:request.method})),serverRunning:serverRunning(),serverOutput:serverOutput.slice(-4000)};
    await writeFile(join(artifactDirectory,'worldmusichub-live-bootstrap-diagnostics.json'),JSON.stringify(diagnostics,null,2));
    await page.screenshot({path:join(artifactDirectory,'worldmusichub-live-bootstrap-failure.png'),fullPage:true,timeout:3000}).catch(()=>{});
    throw new Error(`Live app bootstrap failed without retry. Diagnostics: ${JSON.stringify(diagnostics)}`,{cause:error});
  }
}, {timeout: 40_000});

afterEach(async t => {
  try {
    assert.deepEqual(pageErrors, [], 'No uncaught browser errors');
    assert.deepEqual(apiFailures, [], 'All browser API calls must reach successful Rust responses');
  } finally {
    if(t.passed===false||t.error||t.signal.aborted||pageErrors.length||apiFailures.length)await captureFailureState('failure',t.error);
    await context?.close();
  }
}, {timeout: 10_000});

test('actual Rust catalog, compiler and assessment preserve original exercises and exact timing', testOptions, async () => {
  const catalog = await rustApi('/api/catalog');
  const index=await rustApi('/api/catalog/index');assert.equal(index.version,1);assert.equal(index.items.length,catalog.length);assert.ok(Buffer.byteLength(JSON.stringify(index))<20*1024);assert.ok(index.items.every(item=>!Object.hasOwn(item,'source')&&!Object.hasOwn(item,'parts')));
  assert.ok(requests.some(request=>request.path==='/api/catalog/index'));assert.equal(requests.some(request=>request.path==='/api/catalog'),false,'The browser must not transfer the legacy complete archive list at startup');assert.deepEqual(requests.filter(request=>request.path.startsWith('/api/catalog/score/')).map(request=>request.path),[`/api/catalog/score/${initialCompilation.score.id}`]);
  const originals=catalog.filter(score=>score.provenance.kind==='original_exercise');
  assert.deepEqual(originals.map(score => score.id), ['first-steps', 'steady-hands', 'little-syncopation']);
  assert.equal(await ui('.catalog-item').count(), catalog.length);
  assert.equal(await ui('#catalog-count').textContent(), String(catalog.length));
  const compilations = [];
  for (const score of originals) {
    assert.equal(score.provenance.kind, 'original_exercise');
    assert.equal(score.provenance.license, 'CC0-1.0');
    const compiled = await rustApi('/api/compile', score);
    assert.deepEqual(compiled.score, score, 'Rust compilation retains the complete canonical score');
    assert.ok(compiled.timeline.notes.every(note => Number.isFinite(note.start_ms) && note.duration_ms > 0));
    compilations.push(compiled);
  }
  assert.deepEqual(compilations.map(compiled => compiled.timeline.notes.length), [15, 12, 8]);
  const {timeline} = compilations[0];
  assert.deepEqual(timeline.notes.map(note => note.midi), [60, 62, 64, 65, 67, 69, 71, 72, 71, 69, 67, 65, 64, 62, 60]);
  assert.equal(timeline.notes[0].start_ms, 0);
  assert.ok(Math.abs(timeline.notes[1].start_ms - 60_000 / 90) < 0.001);
  assert.ok(Math.abs(timeline.duration_ms - 16 * 60_000 / 90) < 0.001, 'The final rest remains in playback duration');
  assert.deepEqual(initialCompilation.timeline, timeline);
  const perfect = await rustApi('/api/assess', {
    timeline,
    inputs: timeline.notes.map(note => ({midi: note.midi, at_ms: note.start_ms, velocity: 90})),
    tolerance_ms: 180,
  });
  assert.equal(perfect.accuracy_percent, 100);
  assert.equal(perfect.hits.length, 15);
  assert.ok(perfect.hits.every(hit => hit.grade === 'perfect' && hit.delta_ms === 0));
  assert.deepEqual(perfect.misses, []);
  assert.deepEqual(perfect.extras, []);
  const empty = await rustApi('/api/assess', {timeline, inputs: [], tolerance_ms: 180});
  assert.equal(empty.accuracy_percent, 0);
  assert.equal(empty.misses.length, 15);
  await assertStoppedAtZero();
});

test('embedded browser UI selects all exercises and plays, pauses, resumes and resets from the keyboard', testOptions, async () => {
  const catalog = await rustApi('/api/catalog');
  for (let index = 0; index < catalog.length; index++) {
    const [response] = await Promise.all([nextResponse('/api/compile'), ui('.catalog-item').nth(index).click()]);
    assert.equal((await responseJson(response)).score.id, catalog[index].id);
    await activateCatalogTitle(catalog[index].title);
  }
  const [response] = await Promise.all([nextResponse('/api/compile'), ui('.catalog-item').first().click()]);
  await responseJson(response);
  await activateCatalogTitle(catalog[0].title);
  await ui('#staff-button').click();
  assert.equal(await ui('#notation').isVisible(),true,'Count the explicitly selected pitch-guide page, not its hidden responsive layout');
  async function allNotationPages(){
    const pageCount=Number((await ui('#notation-page').textContent()).match(/\/\s*(\d+)/)[1]);assert.ok(pageCount>=1&&pageCount<=4,'The original16-beat exercise uses bounded4/8/16-beat pages');
    while(await ui('#notation-prev').isEnabled())await ui('#notation-prev').click();
    const rows=[];
    for(let index=0;index<pageCount;index++){
      assert.match(await ui('#notation-page').textContent(),new RegExp(`^Page ${index+1} / ${pageCount}$`));
      rows.push(...await ui('#notation .score-note').evaluateAll(notes=>notes.map(note=>({id:note.dataset.noteId,pitched:Boolean(note.querySelector('.note-head')),rest:Boolean(note.querySelector('.rest')),numbered:Boolean(note.querySelector('.jianpu-note'))}))));
      if(index+1<pageCount)await ui('#notation-next').click();
    }
    assert.equal(await ui('#notation-next').isDisabled(),true);return rows;
  }
  const expectedIds=catalog[0].parts[0].notes.map(note=>note.id).sort(),staffRows=await allNotationPages();
  assert.deepEqual(staffRows.map(row=>row.id).sort(),expectedIds,'Every written source event appears exactly once across responsive pitch-guide pages');
  assert.equal(staffRows.filter(row=>row.pitched).length,15);assert.equal(staffRows.filter(row=>row.rest).length,1);
  await ui('#jianpu-button').click();
  const numberedRows=await allNotationPages();assert.deepEqual(numberedRows.map(row=>row.id).sort(),expectedIds);assert.equal(numberedRows.filter(row=>row.numbered).length,16);
  await ui('#staff-button').click();
  for (const count of [49, 76, 88, 61]) {
    await ui('#key-count').selectOption(String(count));
    assert.equal(await ui('#keyboard .piano-key').count(), count);
  }
  await ui('#stage-title').click();
  await page.keyboard.down('r');
  assert.equal(await ui('#keyboard .piano-key.pressed').count(), 1);
  assert.equal(await ui('#keyboard .piano-key[data-midi="60"]').getAttribute('aria-pressed'), 'true');
  await page.keyboard.up('r');
  assert.equal(await ui('#keyboard .piano-key.pressed').count(), 0);
  await ui('#count-in').uncheck();
  await ui('#stage-title').click();
  await page.keyboard.press('Space');
  await page.waitForFunction(() => globalThis.__wmhReadPlaybackClock().positionMs > 0);
  assert.match(await ui('#play-button').textContent(), /Pause/);
  await page.keyboard.press('Space');
  assert.match(await ui('#transport-status').textContent(), /Paused/);
  const pausedAt = (await ui('#progress').evaluate(readPlaybackClock)).positionMs;
  await page.waitForTimeout(150);
  assert.equal((await ui('#progress').evaluate(readPlaybackClock)).positionMs, pausedAt);
  await page.keyboard.press('Space');
  await page.waitForFunction(position => globalThis.__wmhReadPlaybackClock().positionMs > position, pausedAt);
  await ui('#reset-button').click();
  await assertStoppedAtZero();
  await ui('#instrument').selectOption('guitar');
  assert.equal(await ui('#guitar-stage').isVisible(), true);
  assert.equal(await ui('.fret-button').count(), 78);
  await ui('[data-string="5"][data-fret="0"]').click();
  await ui('#instrument').selectOption('piano');
  assert.equal(await ui('#piano-stage').isVisible(), true);
});

test('live Rust-backed desktop light/dark and mobile layouts produce real screenshots', testOptions, async () => {
  await ui('#theme-mode').selectOption('light');
  assert.equal(await ui('html').getAttribute('data-theme'), 'light');
  await screenshot('light');
  await ui('#theme-mode').selectOption('dark');
  assert.equal(await ui('html').getAttribute('data-theme'), 'dark');
  const [response] = await Promise.all([nextResponse('/api/compile'), reloadStage({waitUntil: 'domcontentloaded'})]);
  await responseJson(response);
  await readyForTitle(initialCompilation.score.title);
  assert.equal(await ui('#theme-mode').inputValue(), 'dark');
  await screenshot('dark');
  await ui('#theme-mode').selectOption('light');
  await page.setViewportSize({width: 390, height: 844});
  await hideNotation();
  const geometry = await page.evaluate(() => ({
    document: document.documentElement.scrollWidth,
    viewport: innerWidth,
    piano: document.querySelector('#piano-scroll').scrollWidth,
    pianoViewport: document.querySelector('#piano-scroll').clientWidth,
  }));
  assert.ok(geometry.document <= geometry.viewport + 1, JSON.stringify(geometry));
  assert.ok(geometry.piano > geometry.pianoViewport, 'The full keyboard scrolls inside its mobile container');
  assert.equal(await ui('#import-tools-button').isVisible(), true);
  await screenshot('mobile');
});

test('real Rust ordered initial MIDI tempos retain source bytes, effective timing and fully localized known warnings', testOptions, async () => {
  const bytes = orderedInitialTempoBrowserMidi(), code = 'midi_initial_tempo_projection';
  await ui('#interface-language').selectOption('zh-CN');
  const [importResponse, compileResponse] = await Promise.all([
    nextResponse('/api/import/midi'), nextResponse('/api/compile'),
    ui('#score-file').setInputFiles({name:'original-ordered-tempos.mid',mimeType:'audio/midi',buffer:bytes}),
  ]);
  const imported = await responseJson(importResponse), compiled = await responseJson(compileResponse);
  assert.equal(imported.score.source.format, 'midi-base64');
  assert.deepEqual(Buffer.from(imported.score.source.content, 'base64'), bytes, 'Every original FF51 declaration survives the real Rust import');
  assert.deepEqual(compiled.score, imported.score);
  assert.deepEqual(compiled.score.tempo, [{at:{numerator:0,denominator:1},bpm:100}]);
  assert.equal(compiled.score.parts.flatMap(part => part.notes).length, 3);
  const timing = compiled.timeline.notes.map(({midi,start_ms,duration_ms}) => ({midi,start_ms,duration_ms}));
  assert.deepEqual(timing, [
    {midi:60,start_ms:0,duration_ms:600},
    {midi:64,start_ms:600,duration_ms:600},
    {midi:67,start_ms:1200,duration_ms:600},
  ]);
  assert.equal(compiled.timeline.duration_ms, 1800);
  const projection = imported.diagnostics.filter(item => item.code === code);
  assert.equal(projection.length, 1);
  assert.equal(projection[0].severity, 'warning');
  const retainedProjection = imported.score.source.import_diagnostics.filter(item => item.code === code);
  assert.equal(retainedProjection.length, 1);
  assert.equal(retainedProjection[0].message.startsWith('Retained import observation: '), false);
  assert.deepEqual(projection, retainedProjection.map(item => ({...item, message:`Retained import observation: ${item.message}`})));
  assert.deepEqual(compiled.diagnostics.filter(item => item.code === code), projection);
  const knownCodes = Object.keys(standardMidiDisclosure.en.warnings);
  assert.deepEqual(imported.diagnostics.map(item => item.code), knownCodes);
  assert.deepEqual(imported.diagnostics, imported.score.source.import_diagnostics.map(item => ({...item,message:`Retained import observation: ${item.message}`})));
  assert.deepEqual(compiled.diagnostics, imported.diagnostics);
  assert.equal(imported.score.provenance.attribution, standardMidiDisclosure.en.attribution);
  await readyForTitle('Original ordered tempo study');
  await waitForBrowserImportCopies(1);
  const notices = [];
  for (const locale of ['zh-CN','en']) {
    const expected=standardMidiDisclosure[locale],messages=Object.values(expected.warnings),expectedImport=messages.join(' ');
    await ui('#interface-language').selectOption(locale);
    await closeShellPanels();
    assert.equal(await page.locator('html').getAttribute('lang'), locale);
    await page.waitForFunction(text => document.querySelector('#notice-message').textContent===text, expectedImport);
    assert.equal(await page.locator('#notice').isVisible(), true);
    const importNotice = await page.locator('#notice-message').textContent();
    assert.equal(importNotice, expectedImport, 'Every known import warning must use the selected language');
    await ui('#score-details-button').click();
    const detail = page.locator('#diagnostic-list>li');
    await detail.first().waitFor({state:'visible'});
    const details=await detail.allTextContents();
    assert.deepEqual(details, Object.entries(expected.warnings).map(([id,message])=>`${id}: ${message}`));
    const attribution=await page.locator('#provenance').textContent();
    assert.ok(attribution.includes(expected.attribution));
    assert.equal(attribution.includes(standardMidiDisclosure[locale==='en'?'zh-CN':'en'].attribution),false);
    await page.screenshot({path:join(artifactDirectory,`worldmusichub-live-initial-tempo-${locale}.png`),fullPage:true,animations:'disabled'});
    await ui('#back-to-library').click();
    await page.waitForFunction(() => document.querySelector('#preview-title').textContent === 'Original ordered tempo study' && !document.querySelector('#start-performance').disabled);
    if (!await page.locator('#preview-notices').evaluate(element => element.open)) await page.locator('#preview-notices>summary').click();
    const preview = page.locator('#preview-notice-list>li');
    await preview.first().waitFor({state:'visible'});
    const previewMessages=await preview.allTextContents();
    assert.deepEqual(previewMessages, messages);
    notices.push({locale,import:importNotice,details,preview:previewMessages,attribution});
    await page.locator('#resume-session').click();
  }
  assert.equal(await page.locator('#tempo').inputValue(), '100');
  assert.deepEqual(await exportScore(), imported.score, 'Language and screen changes preserve the original source and retained diagnostics');
  await writeFile(join(artifactDirectory,'worldmusichub-live-initial-tempo.json'),JSON.stringify({source_sha256:createHash('sha256').update(bytes).digest('hex'),source_bytes:bytes.length,source_retained:true,canonical_bpm:100,timing,duration_ms:compiled.timeline.duration_ms,projection,notices},null,2));
});

test('.xml browser import reaches the Rust parser and exports its exact source, chord spelling and ties', testOptions, async () => {
  const xml = await readFile(new URL('original-duet.musicxml', fixtures), 'utf8');
  const [importResponse, compileResponse] = await Promise.all([
    nextResponse('/api/import/musicxml'),
    nextResponse('/api/compile'),
    ui('#score-file').setInputFiles({name: 'original-duet.xml', mimeType: 'application/xml', buffer: Buffer.from(xml)}),
  ]);
  const imported = await responseJson(importResponse);
  const compiled = await responseJson(compileResponse);
  assert.equal(importResponse.request().postData(), xml);
  assert.equal(imported.score.source.format, 'musicxml');
  assert.equal(imported.score.source.content, xml);
  assert.deepEqual(compiled.score, imported.score);
  assert.equal(compiled.score.provenance.kind, 'user_import');
  assert.equal(compiled.score.provenance.license, null);
  assert.equal(compiled.score.parts.length, 2);
  assert.equal(compiled.score.tempo.length, 3);
  const chord = compiled.timeline.notes.filter(note => [61, 63].includes(note.midi));
  assert.equal(chord.length, 2);
  for (const note of chord) {
    assert.equal(note.start_ms, 500);
    assert.equal(note.duration_ms, 1500);
  }
  assert.equal(compiled.timeline.notes.filter(note => note.midi === 62).length, 1, 'The Rust timeline merges the tie');
  await readyForTitle('Small Exact Duet');
  assert.deepEqual(await ui('#notation-part option').evaluateAll(options=>options.map(option=>({value:option.value,label:option.textContent}))), [{value:'',label:'All parts'},...imported.score.parts.map(part=>({value:part.id,label:part.name}))], 'Display choices include every exact source part plus a separate all-parts option');
  await assertStoppedAtZero();
  const exported = await exportScore();
  assert.deepEqual(exported, imported.score);
  assert.equal(exported.source.content, xml);
});

for (const version of ['3.1', '4.0']) {
  test(`standard MusicXML ${version} browser upload preserves header bytes, warnings and music through source, JSON and backup roundtrips`, {timeout: 60_000}, async () => {
    const fixtureXml = await readFile(new URL('original-duet-standard-header.musicxml', fixtures), 'utf8');
    const xml = version === '4.0' ? fixtureXml : fixtureXml
      .replace("'-//Recordare//DTD MusicXML 4.0 Partwise//EN'", '"-//Recordare//DTD MusicXML 3.1 Partwise//EN"')
      .replace("'http://www.musicxml.org/dtds/partwise.dtd'", '"http://www.musicxml.org/dtds/partwise.dtd"')
      .replace('<score-partwise version="4.0">', '<score-partwise version="3.1">');
    const bytes = Buffer.from(xml);
    assert.deepEqual(bytes.subarray(0, 3), Buffer.from([0xef, 0xbb, 0xbf]));
    assert.ok(xml.includes('\r\n'));
    const external = [];
    page.on('request', request => { if (new URL(request.url()).origin !== origin) external.push(request.url()); });
    const [importResponse, compileResponse] = await Promise.all([
      nextResponse('/api/import/musicxml'), nextResponse('/api/compile'),
      ui('#score-file').setInputFiles({name: `standard-${version}.${version === '3.1' ? 'xml' : 'musicxml'}`, mimeType: 'application/xml', buffer: bytes}),
    ]);
    const imported = await responseJson(importResponse), compiled = await responseJson(compileResponse);
    assert.deepEqual(importResponse.request().postDataBuffer(), bytes, 'The browser sends the original UTF-8 bytes, including BOM and CRLF');
    assert.equal(imported.score.source.format, 'musicxml');
    assert.deepEqual(Buffer.from(imported.score.source.content), bytes);
    assert.deepEqual(compiled, imported, 'The activation compile retains the complete imported score and its exact diagnostics');
    assertHeaderNormalization(imported);
    assertHeaderNormalization(compiled);
    await readyForTitle(imported.score.title);
    const firstImportCopies = await waitForBrowserImportCopies(1);
    assertAddedLibraryCopies([], firstImportCopies, [{label: null, score: compiled.score}]);
    assert.equal(await ui('#diagnostic-list>li').filter({hasText: 'musicxml_header_normalized:'}).count(), 1);
    await assertStoppedAtZero();

    await ui('#source-files-button').click();
    assert.equal(await ui('#source-archive-files>li').count(), 1);
    await page.getByRole('button', {name: 'Inspect retained file retained-source.txt', exact: true}).click();
    await ui('#source-archive-download:not([disabled])').waitFor();
    assert.equal(await ui('#source-computed-hash').textContent(), createHash('sha256').update(bytes).digest('hex'));
    const [sourceDownload] = await Promise.all([page.waitForEvent('download'), ui('#source-archive-download').click()]);
    assert.equal(await sourceDownload.failure(), null);
    assert.equal(sourceDownload.suggestedFilename(), 'retained-source.txt');
    assert.deepEqual(await readFile(await sourceDownload.path()), bytes);
    await ui('#source-archive-close').click();
    const canonical = await exportScore();
    assert.deepEqual(canonical, imported.score);
    const [reloadedResponse] = await Promise.all([
      nextResponse('/api/compile'),
      ui('#score-file').setInputFiles({name: 'standard-header-score.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(canonical))}),
    ]);
    const reloaded = await responseJson(reloadedResponse);
    assert.deepEqual(reloaded, compiled);
    assertHeaderNormalization(reloaded);
    await readyForTitle(imported.score.title);
    const importedCopies = await waitForBrowserImportCopies(2);
    assertAddedLibraryCopies(firstImportCopies, importedCopies, [{label: null, score: compiled.score}]);
    const restored = await libraryRoundtrip(compiled, `MusicXML ${version} with its original header`, 'standard-header-backup.json', importedCopies);
    assertHeaderNormalization(restored);
    assert.deepEqual(Buffer.from(restored.score.source.content), bytes);
    assert.equal(await ui('#diagnostic-list>li').filter({hasText: 'musicxml_header_normalized:'}).count(), 1);

    // Ordinary equivalent encodings must keep distinct identities derived from raw input.
    const sourceVariants = [xml.replace(/<!DOCTYPE[\s\S]*?>\r\n/, ''), xml.slice(1).replaceAll('\r\n', '\n')];
    const ids = new Set([compiled.score.id]);
    for (const [index, source] of sourceVariants.entries()) {
      const response = await fetch(`${origin}/api/import/musicxml`, {method: 'POST', headers: {'Content-Type': 'application/xml'}, body: Buffer.from(source)});
      assert.equal(response.status, 200);
      const equivalent = await response.json();
      assert.equal(equivalent.score.source.content, source);
      assert.deepEqual(writtenMusic(equivalent.score), writtenMusic(compiled.score));
      assert.deepEqual(soundingMusic(equivalent), soundingMusic(compiled));
      assertHeaderNormalization(equivalent, index === 0 ? 0 : 1);
      ids.add(equivalent.score.id);
    }
    assert.equal(ids.size, 3, 'Removing the header or changing BOM/newlines does not collapse raw-source IDs');

    const generated = await rustApi('/api/export/musicxml', compiled.score);
    assert.doesNotMatch(generated.xml, /<!DOCTYPE|<!ENTITY/);
    assert.match(generated.xml, /<score-partwise version="4\.0">/);
    assert.deepEqual(await exportScore(), compiled.score, 'Generated export leaves the complete retained source unchanged');
    const [generatedImportResponse, generatedCompileResponse] = await Promise.all([
      nextResponse('/api/import/musicxml'), nextResponse('/api/compile'),
      ui('#score-file').setInputFiles({name: 'generated-roundtrip.musicxml', mimeType: 'application/xml', buffer: Buffer.from(generated.xml)}),
    ]);
    const generatedImport = await responseJson(generatedImportResponse), generatedCompile = await responseJson(generatedCompileResponse);
    assert.deepEqual(generatedCompile, generatedImport);
    assert.equal(generatedImport.score.source.content, generated.xml);
    assertHeaderNormalization(generatedImport, 0);
    assert.deepEqual(soundingMusic(generatedImport), soundingMusic(compiled));
    assert.ok(Math.abs(generatedImport.timeline.duration_ms - compiled.timeline.duration_ms) < 1e-7);
    for (const map of ['tempo', 'meters', 'keys', 'repeats']) assert.deepEqual(generatedImport.score[map], compiled.score[map]);
    // This fixture has no cross-bar events to split. Exporter gaps use <forward>,
    // so its explicit notes/rests compare exactly after restoring voice labels.
    const notes = (score, restoreVoices = false) => score.parts.map((part, partIndex) => {
      const originalPart = compiled.score.parts[partIndex];
      if (restoreVoices) assert.equal(part.id, generated.part_id_map[originalPart.id]);
      return part.notes.map(note => {
        const mappedVoice = restoreVoices ? generated.voice_id_map.find(entry =>
          entry.part_id === originalPart.id && entry.staff === note.staff && entry.xml_voice === note.voice) : null;
        if (restoreVoices) assert.ok(mappedVoice, 'Every generated voice resolves to its canonical staff/voice');
        return JSON.stringify([note.at, note.duration, note.pitch, note.staff,
          restoreVoices ? mappedVoice.voice : note.voice, note.tie_start, note.tie_stop, note.velocity]);
      }).sort();
    });
    assert.deepEqual(notes(generatedImport.score, true), notes(compiled.score), 'Supported spelling, rational rhythms, rests, voices and ties survive generated MusicXML');
    await readyForTitle(generatedImport.score.title);
    await page.waitForFunction(() => ![...document.querySelectorAll('#diagnostic-list>li')].some(row => row.textContent.includes('musicxml_header_normalized:')));
    assert.deepEqual(external, [], 'The standard public identifier never becomes a browser resource request');
  });
}

test('PNG review uses real Rust candidates and requires every duration plus renewed explicit confirmation', testOptions, async () => {
  const png = await readFile(new URL('omr-original-scale.png', fixtures));
  await ui('#count-in').uncheck();
  await ui('#play-button').click();
  await page.waitForFunction(() => globalThis.__wmhReadPlaybackClock().positionMs > 0);
  const compileCount = requests.filter(request => request.path === '/api/compile').length;
  await ui('#score-image-file').setInputFiles({name: 'original-scale.png', mimeType: 'image/png', buffer: png});
  await ui('#image-review-dialog').waitFor();
  assert.match(await ui('#transport-status').textContent(), /Paused/);
  const stoppedAt = (await ui('#progress').evaluate(readPlaybackClock)).positionMs;
  const [response] = await Promise.all([nextResponse('/api/import/image'), ui('#analyze-image').click()]);
  const review = await responseJson(response);
  assert.equal(response.request().headers()['content-type'], 'image/png');
  // Browser Blob uploads need not expose a CDP postDataBuffer. Verify actual Rust decoding
  // here, and byte-exact original retention through the exported score below.
  assert.equal(review.format, 'png');
  assert.equal(review.width, 640);
  assert.equal(review.height, 160);
  assert.equal(review.status, 'review_required');
  assert.equal(review.requires_review, true);
  assert.equal(review.candidates.length, 8);
  assert.ok(review.candidates.every(candidate => candidate.duration === 'unknown'));
  await page.waitForFunction(() => document.querySelectorAll('.review-note-row').length === 8);
  assert.equal((await ui('#progress').evaluate(readPlaybackClock)).positionMs, stoppedAt);
  assert.equal(await ui('#review-create').isDisabled(), true);
  await ui('#review-confirm').check();
  assert.equal(await ui('#review-create').isDisabled(), true, 'Confirmation alone cannot invent missing rhythms');
  for (let index = 0; index < review.candidates.length; index++) {
    const pitch = review.candidates[index].tentative_pitch;
    assert.equal(await page.getByLabel(`Pitch for note ${index + 1}`, {exact: true}).inputValue(), `${pitch.step}${pitch.octave}`);
    await page.getByLabel(`Duration for note ${index + 1}`, {exact: true}).selectOption('1');
  }
  assert.equal(await ui('#review-confirm').isChecked(), false, 'Editing durations invalidates old confirmation');
  assert.equal(await ui('#review-create').isDisabled(), true);
  await ui('#review-confirm').check();
  assert.equal(await ui('#review-create').isEnabled(), true);
  await page.getByLabel('Pitch for note 1', {exact: true}).fill('F##4');
  assert.equal(await ui('#review-confirm').isChecked(), false, 'Editing pitch also requires renewed confirmation');
  assert.equal(await ui('#review-create').isDisabled(), true);
  await ui('#review-title').fill('My checked scale');
  assert.equal(requests.filter(request => request.path === '/api/compile').length, compileCount, 'Recognition never silently creates a playable score');
  await screenshot('image-review');
  await ui('#review-confirm').check();
  const [compiledResponse] = await Promise.all([nextResponse('/api/compile'), ui('#review-create').click()]);
  const compiled = await responseJson(compiledResponse);
  await ui('#image-review-dialog').waitFor({state: 'hidden'});
  await readyForTitle('My checked scale');
  assert.equal(compiled.score.provenance.kind, 'user_reviewed_image');
  assert.equal(compiled.timeline.notes.length, 8);
  assert.equal(compiled.timeline.notes[0].midi, 67);
  assert.deepEqual(compiled.score.parts[0].notes[0].pitch, {step: 'F', alter: 2, octave: 4});
  assert.deepEqual(compiled.score.parts[0].notes[0].duration, {numerator: 1, denominator: 1});
  await assertStoppedAtZero();
  const exported = await exportScore();
  assert.deepEqual(exported, compiled.score);
  assert.equal(exported.source.format, 'image-review');
  assert.equal(exported.source.filename, 'original-scale.png');
  const preserved = JSON.parse(exported.source.content);
  assert.deepEqual(preserved.recognition_review, review);
  assert.deepEqual(Buffer.from(preserved.original_image_data_url.split(',')[1], 'base64'), png);
  assert.equal(preserved.manual_notes[0].pitch, 'F##4');
  assert.ok(preserved.manual_notes.every(note => note.duration === '1'));
  assert.deepEqual(preserved.crop, {x: 0, y: 0, width: 640, height: 160});
});

test('browser practice records real keyboard timing and displays the Rust assessment response', testOptions, async () => {
  await setSessionMode('practice');
  await ui('#count-in').uncheck();
  await ui('#stage-title').click();
  await page.keyboard.press('r');
  const [emptyResponse] = await Promise.all([nextResponse('/api/assess'), ui('#assess-button').click()]);
  const empty = await responseJson(emptyResponse);
  assert.deepEqual(emptyResponse.request().postDataJSON().inputs, [], 'Notes before playback must not enter the take');
  assert.equal(empty.misses.length, 15);
  await ui('#feedback-results').waitFor();
  assert.equal(await ui('#accuracy').textContent(), '0%');
  await ui('#play-button:not([disabled])').waitFor();
  await ui('#stage-title').click();
  await page.keyboard.press('Space');
  await page.waitForFunction(() => document.querySelector('#play-button').textContent.includes('Pause'));
  await waitForPlaybackClockAdvance(page);
  await page.keyboard.press('r');
  const [response] = await Promise.all([nextResponse('/api/assess'), ui('#assess-button').click()]);
  const assessment = await responseJson(response);
  const submitted = response.request().postDataJSON();
  assert.deepEqual(submitted.timeline, initialCompilation.timeline);
  assert.equal(submitted.tolerance_ms, 180);
  assert.equal(submitted.inputs.length, 1);
  assert.equal(submitted.inputs[0].midi, 60);
  assert.ok(Number.isFinite(submitted.inputs[0].at_ms) && submitted.inputs[0].at_ms >= 0);
  assert.equal(assessment.hits.length + assessment.misses.length, 15);
  assert.equal(assessment.hits.length + assessment.extras.length, 1);
  // Browser scheduling is not a deterministic latency test. Match UI to Rust's result.
  await page.waitForFunction(expected => {
    return !document.querySelector('#feedback-results').hidden
      && document.querySelector('#accuracy').textContent === expected.accuracy
      && document.querySelector('#hits').textContent === expected.hits
      && document.querySelector('#misses').textContent === expected.misses;
  }, {
    accuracy: `${Math.round(assessment.accuracy_percent)}%`,
    hits: String(assessment.hits.length),
    misses: `${assessment.misses.length} / ${assessment.extras.length}`,
  });
  assert.equal(await ui('#hits').textContent(), String(assessment.hits.length));
  assert.equal(await ui('#misses').textContent(), `${assessment.misses.length} / ${assessment.extras.length}`);
  await page.waitForFunction(()=>document.querySelector('#result-summary').dataset.phase==='assessed');
  for(const[key,value]of Object.entries(assessment.grade_counts))assert.equal(await ui(`#result-grade-${key}`).textContent(),String(value));
  assert.equal(await ui('#result-onsets-complete').textContent(),`${assessment.onset_completion.complete} / ${assessment.onset_completion.total}`);
  assert.equal(await ui('#result-onsets-sequence').textContent(),String(assessment.onset_completion.longest_complete_sequence));
  assert.match(await ui('#result-summary-status').textContent(),/Previous check/);
  assert.match(await ui('#transport-status').textContent(), /Paused/);
  assert.equal(await ui('#keyboard .piano-key.pressed').count(), 0);
});

test('real Rust Results retain partial chords, late grades and extras, then revise the selected take for delayed input',testOptions,async()=>{
  await hideNotation();
  const score=structuredClone(fixture);score.id='results-chord';score.title='Results chord coverage';
  const template=score.parts[0].notes[0];score.parts[0].notes=[
    {...structuredClone(template),id:'chord-c'},
    {...structuredClone(template),id:'chord-e',pitch:{step:'E',alter:0,octave:4}},
    {...structuredClone(template),id:'next-g',at:{numerator:1,denominator:1},duration:{numerator:3,denominator:1},pitch:{step:'G',alter:0,octave:4}},
  ];
  const[compiledResponse]=await Promise.all([nextResponse('/api/compile'),ui('#score-file').setInputFiles({name:'results-chord.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(score))})]);
  const compiled=await responseJson(compiledResponse);await readyForTitle(score.title);await setSessionMode('practice');await ui('#count-in').uncheck();await ui('#play-button:not([disabled])').waitFor();await ui('#play-button').click();
  await page.waitForFunction(()=>globalThis.__wmhReadPlaybackClock().positionMs>800);
  const exportTake=async()=>{const[download]=await Promise.all([page.waitForEvent('download'),ui('#export-takes').click()]);assert.equal(await download.failure(),null);return JSON.parse(await readFile(await download.path(),'utf8'))};
  const before=await exportTake(),startedWall=before.passes[0].clock_segments[0].wallStart;
  assert.equal(before.passes.length,1);assert.equal(before.passes[0].timeline.notes.length,3);await closeShellPanels();
  // Deliberately delayed browser key events use the recorder's exported clock.
  // This controls input timestamps, not Rust responses, audio APIs or app state.
  const deliver=attacks=>page.evaluate(({startedWall,attacks})=>{for(const[midi,offset]of attacks){const button=document.querySelector(`.piano-key[data-midi="${midi}"]`);for(const type of ['keydown','keyup']){const event=new KeyboardEvent(type,{key:'Enter',code:'Enter',bubbles:true,cancelable:true});Object.defineProperty(event,'timeStamp',{value:startedWall+offset});button.dispatchEvent(event)}}},{startedWall,attacks});
  await deliver([[60,120],[67,620],[72,740]]);await ui('#assess-button').click();await ui('#feedback-results').waitFor();
  await page.waitForFunction(()=>{const summary=document.querySelector('#result-summary');return summary.dataset.phase==='assessed'&&summary.dataset.revision==='3'&&summary.dataset.assessedRevision==='3'});
  const partialExport=await exportTake(),partial=partialExport.passes[0];assert.deepEqual(partial.inputs.map(input=>input.midi),[60,67,72]);for(const[index,expected]of [120,620,740].entries())assert.ok(Math.abs(partial.inputs[index].at_ms-expected)<0.001,JSON.stringify(partial.inputs));
  const observed=partialExport.input_evidence.events.filter(event=>event.kind==='note_on'||event.kind==='note_off');
  assert.deepEqual(observed.map(event=>event.kind),['note_on','note_off','note_on','note_off','note_on','note_off']);
  assert.deepEqual(observed.map(event=>event.midi),[60,null,67,null,72,null]);assert.ok(observed.every(event=>event.input_kind==='on_screen_keyboard'&&event.timestamp_basis==='event_monotonic'));
  for(let index=0;index<observed.length;index+=2)assert.equal(observed[index].source_id,observed[index+1].source_id);
  assert.deepEqual(observed.filter(event=>event.kind==='note_on').map(event=>event.onset_capture),[{pass_id:1,event_id:1},{pass_id:1,event_id:2},{pass_id:1,event_id:3}]);
  assert.equal(partialExport.input_evidence.release_assessment,'not_implemented');assert.equal(partial.revision,3,'Explicit releases never dirty onset assessment');
  assert.deepEqual(partial.assessment.grade_counts,{perfect:0,good:0,early:0,late:2,missed:1,extra:1});assert.deepEqual(partial.assessment.onset_completion,{total:2,complete:1,longest_complete_sequence:1});assert.equal(partial.assessment.accuracy_percent,50);
  assert.equal(await ui('#result-grade-perfect').textContent(),'0');assert.equal(await ui('#result-grade-late').textContent(),'2');assert.equal(await ui('#result-grade-missed').textContent(),'1');assert.equal(await ui('#result-grade-extra').textContent(),'1');assert.equal(await ui('#result-onsets-complete').textContent(),'1 / 2');assert.equal(await ui('#result-onsets-sequence').textContent(),'1');
  await ui('#feedback-pass').selectOption('1');await page.locator('.result-summary-help summary').click();assert.match(await ui('#result-onset-help').textContent(),/partial chord stays incomplete/);assert.match(await ui('#result-summary-limits').textContent(),/not a combo or an error-free streak/);await page.screenshot({path:join(artifactDirectory,'worldmusichub-live-results-partial-chord.png'),fullPage:true,animations:'disabled'});
  await closeShellPanels();await deliver([[64,160]]);await ui('#results-button').click();
  await page.waitForFunction(()=>{const summary=document.querySelector('#result-summary');return summary.dataset.phase==='assessed'&&summary.dataset.revision==='4'&&summary.dataset.assessedRevision==='4'});
  const correctedExport=await exportTake(),corrected=correctedExport.passes[0];assert.equal(await ui('#feedback-pass').inputValue(),'1','A delayed correction retains the chosen pass');assert.deepEqual(corrected.assessment.grade_counts,{perfect:0,good:0,early:0,late:3,missed:0,extra:1});assert.deepEqual(corrected.assessment.onset_completion,{total:2,complete:2,longest_complete_sequence:2});assert.equal(corrected.assessment.accuracy_percent,75);
  const delayed=correctedExport.input_evidence.events.filter(event=>['note_on','note_off'].includes(event.kind)).slice(-2);assert.equal(delayed[0].midi,64);assert.equal(delayed[1].midi,null);assert.equal(delayed[1].kind,'note_off');assert.equal(delayed[0].source_id,delayed[1].source_id);assert.ok(delayed.every(event=>event.received_wall_ms>event.event_wall_ms));assert.deepEqual(delayed[0].onset_capture,{pass_id:1,event_id:4});assert.equal(corrected.revision,4);
  assert.equal(await ui('#result-grade-perfect').textContent(),'0');assert.equal(await ui('#result-grade-late').textContent(),'3');assert.equal(await ui('#result-grade-extra').textContent(),'1');assert.equal(await ui('#result-onsets-complete').textContent(),'2 / 2');assert.equal(await ui('#result-onsets-sequence').textContent(),'2');assert.match(await ui('#result-summary-revision').textContent(),/revision 4.*revision 4/);
  for(const viewport of [{width:1280,height:720},{width:844,height:390},{width:390,height:844}]){await page.setViewportSize(viewport);await ui('#result-summary').scrollIntoViewIfNeeded();const bounds=await page.locator('#result-summary').evaluate(element=>({width:element.clientWidth,scrollWidth:element.scrollWidth,left:element.getBoundingClientRect().left,right:element.getBoundingClientRect().right}));assert.ok(bounds.scrollWidth<=bounds.width+1,JSON.stringify(bounds));assert.ok(bounds.left>=0&&bounds.right<=viewport.width,JSON.stringify(bounds));await page.screenshot({path:join(artifactDirectory,`worldmusichub-live-results-${viewport.width}x${viewport.height}.png`),fullPage:true,animations:'disabled'});}
  await ui('#theme-mode').selectOption('dark');await ui('#results-button').click();assert.equal(await ui('#result-grade-late').textContent(),'3');await page.screenshot({path:join(artifactDirectory,'worldmusichub-live-results-dark.png'),fullPage:true,animations:'disabled'});
  assert.deepEqual(await exportScore(),compiled.score);await writeFile(join(artifactDirectory,'worldmusichub-live-results-summary.json'),JSON.stringify({partial,corrected,canonical_score_unchanged:true},null,2));
});

test('actual Rust empty assessments and legacy metadata render explicit unavailable Results counters',testOptions,async()=>{
  const timeline={...initialCompilation.timeline,notes:[initialCompilation.timeline.notes[0]]};
  const checked=await rustApi('/api/assess',{timeline,inputs:[],tolerance_ms:180});
  const empty=await rustApi('/api/assess',{timeline:{notes:[],duration_ms:0},inputs:[],tolerance_ms:180});
  assert.deepEqual(empty.onset_completion,{total:0,complete:0,longest_complete_sequence:0});
  // Render the actual embedded Results component in an isolated browser document.
  // Removing optional fields reproduces an older saved response, without mocking an API.
  const views=await page.evaluate(async({checked,empty,timeline})=>{
    const{setupResultsSummary}=await import('/results-summary.js'),{getAppI18n}=await import('/app-locale.js');const isolated=document.implementation.createHTMLDocument('Results compatibility');isolated.body.append(document.querySelector('#result-summary').cloneNode(true));const render=setupResultsSummary(isolated,{i18n:getAppI18n(document)});
    const pass={id:1,label:'Take 1',revision:0,assessedRevision:0,closedWall:0,deadline:180,manualDeadline:null,inFlight:false,error:null,boundaryReviews:[],inputs:[],timeline,assessment:checked};
    const read=()=>({status:isolated.getElementById('result-summary-status').textContent,grades:isolated.getElementById('result-grade-status').textContent,onsets:isolated.getElementById('result-onset-status').textContent,counts:[...isolated.querySelectorAll('.result-grade-grid dd,.result-onset-grid dd')].map(node=>node.textContent)});
    render({pass,now:200});const supplied=read();const legacy={...checked};delete legacy.grade_counts;delete legacy.onset_completion;render({pass:{...pass,assessment:legacy},now:200});const absent=read();render({pass:{...pass,timeline:{notes:[]},assessment:empty},now:200});return{supplied,absent,empty:read()};
  },{checked,empty,timeline});
  assert.equal(views.supplied.counts[4],'1');assert.equal(views.supplied.counts[6],'0 / 1');for(const view of [views.absent,views.empty]){assert.ok(view.counts.every(value=>value==='—'));assert.match(view.grades,/Unavailable/);assert.match(view.onsets,/Unavailable/)}assert.match(views.empty.status,/no note-on targets.*not a successful take/);
});

test('whole application engraves real exported MusicXML and preserves the score across light/dark views', {timeout:60_000}, async () => {
  const source = await readFile(new URL('original-duet.musicxml',fixtures),'utf8');
  await hideNotation();
  const [compiledResponse] = await Promise.all([
    nextResponse('/api/compile'),
    ui('#score-file').setInputFiles({name:'original-duet.musicxml',mimeType:'application/xml',buffer:Buffer.from(source)}),
  ]);
  const compiled = await responseJson(compiledResponse);
  await readyForTitle(compiled.score.title);
  const [xmlResponse] = await Promise.all([nextResponse('/api/export/musicxml'), waitForEngraving()]);
  assert.deepEqual(xmlResponse.request().postDataJSON(), compiled.score, 'Visible notation exports the canonical imported score');
  const before = await exportScore();
  const exported = await responseJson(xmlResponse);
  assert.match(exported.xml, /^<\?xml/);
  assert.ok(Object.hasOwn(exported.part_id_map,compiled.score.parts[0].id));
  await waitForEngraving();
  assert.equal(await ui('#engraved-button').getAttribute('aria-pressed'),'true');
  assert.equal(await ui('#notation').isVisible(),false);
  assert.ok(await ui('#engraved-staff svg path').count()>30);
  assert.ok(await ui('#engraved-staff .vf-stavetie').count()>=1);
  await ui('#engraving-license-note').waitFor();
  assert.equal(await ui('#engraving-license-note').isVisible(),true);
  assert.ok(requests.some(request=>request.path==='/api/export/musicxml'));
  await screenshot('engraved-light');
  await ui('#theme-mode').selectOption('dark');
  await page.waitForFunction(()=>document.documentElement.dataset.theme==='dark' && [...document.querySelectorAll('#engraved-staff .vf-notehead path')].some(path=>getComputedStyle(path).fill==='rgb(243, 245, 239)') && document.querySelector('#engraving-status').textContent.includes('Generated staff preview'));
  await screenshot('engraved-dark');
  await ui('#engraving-part').selectOption(compiled.score.parts[0].id);
  await page.waitForFunction(()=>document.querySelector('#engraved-staff svg') && !document.querySelector('#engraved-staff').textContent.includes('Guitar'));
  assert.ok(await ui('#engraved-staff .vf-clef').count()>=2);
  await ui('#staff-button').click();
  assert.equal(await ui('#notation').isVisible(),true);
  assert.equal(await ui('#engraving-view').isVisible(),false);
  assert.equal(await ui('#engraved-staff svg').count(),0,'Switching to the pitch guide disposes the generated staff');
  assert.deepEqual(await exportScore(),before,'View/theme/part changes must not modify canonical notes or source data');
});

test('real Rust physical targets retain unison source voices and score one piano attack', testOptions, async () => {
  const score=structuredClone(initialCompilation.score);
  const first=score.parts[0].notes.find(note=>note.pitch);
  score.title='Original physical unison check';
  score.parts.push({id:'unison-part',name:'Unison source voice',instrument:'piano',notes:[{...structuredClone(first),id:'unison-source'}]});
  const [response]=await Promise.all([nextResponse('/api/practice-targets'),ui('#score-file').setInputFiles({name:'original-unison.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(score))})]);
  const plan=await responseJson(response);
  assert.equal(plan.source_note_count,16);assert.equal(plan.target_count,15);
  assert.ok(plan.groups.some(group=>group.source_note_ids.includes('unison-source')&&group.source_occurrence_ids.length===2));
  await page.waitForFunction(()=>document.querySelector('#practice-scope').textContent.includes('15 physical attacks from 16 sounding'));
  await setSessionMode('practice');
  const [assessmentResponse]=await Promise.all([nextResponse('/api/assess'),ui('#assess-button').click()]);
  assert.deepEqual(assessmentResponse.request().postDataJSON().timeline,plan.timeline);
  const assessment=await responseJson(assessmentResponse);assert.equal(assessment.misses.length,15);
  const downloadPromise=page.waitForEvent('download');await ui('#export-button').click();
  const exported=JSON.parse(await readFile(await(await downloadPromise).path(),'utf8'));
  assert.deepEqual(exported,score);
  const [partResponse]=await Promise.all([nextResponse('/api/practice-targets'),selectPracticePart('unison-part')]);
  const selected=await responseJson(partResponse);assert.equal(selected.source_note_count,1);assert.equal(selected.target_count,1);assert.deepEqual(selected.groups[0].source_note_ids,['unison-source']);
});

test('real local library preserves a source snapshot across reload and validates backup restoration', testOptions, async () => {
  const score=structuredClone(initialCompilation.score);score.title='Saved original exercise';score.source={format:'original-test-text',filename:'original.txt',content:'Original local source · 文本\r\nPreserve this exact payload.'};
  await ui('#score-file').setInputFiles({name:'original-library-score.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(score))});await readyForTitle(score.title);
  const importedCopies=await waitForBrowserImportCopies(1);assertAddedLibraryCopies([],importedCopies,[{label:null,score}]);
  await ui('#library-button').click();await page.waitForFunction(()=>document.querySelector('#library-status').textContent.startsWith('Ready.'));assert.equal(await ui('#library-list>li').getAttribute('data-library-key'),importedCopies[0].key);
  await ui('#library-label').fill('Original source copy');await ui('#library-save-copy').click();await page.waitForFunction(()=>document.querySelector('#library-status').textContent.startsWith('Saved'));
  const savedCopies=await browserLibrarySnapshot(),[saved]=assertAddedLibraryCopies(importedCopies,savedCopies,[{label:'Original source copy',score}]);
  const {bytes:backup,entries}=await downloadLibraryBackup();assert.deepEqual(entries,savedCopies.map(({label,score})=>({label,score})));
  await ui('#library-close').click();await reloadStage();await readyForTitle(initialCompilation.score.title);assert.deepEqual(await browserLibrarySnapshot(),savedCopies,'Reload inventories the same immutable copies without saving the initial catalog score');
  await ui('#library-button').click();await ui(`[data-library-key="${saved.key}"] [data-library-open]`).click();await page.waitForFunction(()=>!document.querySelector('#score-library').open);await readyForTitle(score.title);
  assert.deepEqual(await exportScore(),score);
  assert.deepEqual(await browserLibrarySnapshot(),savedCopies,'Opening the labeled copy does not create another saved import');
  await ui('#library-button').click();await page.waitForFunction(()=>document.querySelector('#library-status').textContent.startsWith('Ready.'));
  const before=requests.filter(request=>request.path==='/api/compile').length;
  await ui('#library-backup-file').setInputFiles({name:'worldmusichub-library-backup.json',mimeType:'application/json',buffer:Buffer.from(backup)});await page.waitForFunction(()=>document.querySelector('#library-status').textContent.startsWith('Restored'));
  const restoredCopies=await browserLibrarySnapshot();assertAddedLibraryCopies(savedCopies,restoredCopies,entries);
  assert.equal(await ui('#library-list>li').count(),restoredCopies.length);assert.deepEqual(requests.filter(request=>request.path==='/api/compile').slice(before).map(request=>JSON.parse(request.body)),entries.map(entry=>entry.score),'Rust validates every complete backup score before restore');
  await page.screenshot({path:join(artifactDirectory,'worldmusichub-live-library.png'),fullPage:true});
});

test('real numbered-text export previews Rust diagnostics and roundtrips original melody timing', testOptions, async () => {
  const [response]=await Promise.all([nextResponse('/api/export/jianpu'),ui('#export-jianpu').click()]);const exported=await responseJson(response);
  await ui('#jianpu-export-download:not([disabled])').waitFor();assert.equal(await ui('#jianpu-export-text').inputValue(),exported.text);assert.equal(exported.note_map.filter(id=>id!==null).length,initialCompilation.score.parts[0].notes.length);assert.match(await ui('#jianpu-export-diagnostics').textContent(),/original source bytes/);
  const promise=page.waitForEvent('download');await ui('#jianpu-export-download').click();const downloaded=await readFile(await(await promise).path(),'utf8');assert.equal(downloaded,exported.text);await ui('#jianpu-export-close').click();assert.deepEqual(await exportScore(),initialCompilation.score);
  const [importResponse]=await Promise.all([nextResponse('/api/import/jianpu'),ui('#score-file').setInputFiles({name:'original-roundtrip.jianpu',mimeType:'text/plain',buffer:Buffer.from(downloaded)})]);const imported=await responseJson(importResponse);
  const timing=timeline=>timeline.notes.map(note=>({midi:note.midi,start_ms:note.start_ms,duration_ms:note.duration_ms}));assert.deepEqual(timing(imported.timeline),timing(initialCompilation.timeline));assert.equal(imported.timeline.duration_ms,initialCompilation.timeline.duration_ms);await readyForTitle(imported.score.title);
});

test('real image review exports manually confirmed triplets and dotted rhythms through Jianpu and MusicXML',testOptions,async()=>{
  await hideNotation();
  const png=await readFile(new URL('omr-original-scale.png',fixtures));await ui('#score-image-file').setInputFiles({name:'original-rhythm.png',mimeType:'image/png',buffer:png});await ui('#image-review-dialog').waitFor();
  const[recognitionResponse]=await Promise.all([nextResponse('/api/import/image'),ui('#analyze-image').click()]);const recognition=await responseJson(recognitionResponse);assert.equal(recognition.candidates.length,8);await page.waitForFunction(()=>document.querySelectorAll('.review-note-row').length===8);
  const pitches=['C4','D4','E4','F#4','0','A4','B4','C5'],durations=['1/3','1/3','1/3','0.75','0.25','1.5','1.5','3'];
  for(let index=0;index<8;index++){await page.getByLabel(`Pitch for note ${index+1}`,{exact:true}).fill(pitches[index]);await page.getByLabel(`Duration for note ${index+1}`,{exact:true}).selectOption(durations[index])}
  assert.equal(await ui('#review-create').isDisabled(),true);await ui('#review-confirm').check();const[compileResponse]=await Promise.all([nextResponse('/api/compile'),ui('#review-create').click()]);const original=await responseJson(compileResponse);await ui('#image-review-dialog').waitFor({state:'hidden'});await readyForTitle(original.score.title);const[xmlResponse]=await Promise.all([nextResponse('/api/export/musicxml'),waitForEngraving()]);const xml=await responseJson(xmlResponse);assert.deepEqual(xmlResponse.request().postDataJSON(),original.score,'Opening notation exports the exact reviewed score before caching it');
  const notes=original.score.parts[0].notes;assert.deepEqual(notes[2].at,{numerator:2,denominator:3});assert.deepEqual(notes[7].at,{numerator:5,denominator:1});assert.equal(notes[4].velocity,0);assert.equal(notes[4].pitch,null);assert.deepEqual(original.score.measures.map(measure=>measure.length),[{numerator:4,denominator:1},{numerator:4,denominator:1}]);const preserved=JSON.parse(original.score.source.content);assert.deepEqual(preserved.manual_notes.map(row=>row.duration),durations);assert.deepEqual(Buffer.from(preserved.original_image_data_url.split(',')[1],'base64'),png);
  const[xmlFile]=await Promise.all([page.waitForEvent('download'),ui('#export-musicxml').click()]);assert.equal(await readFile(await xmlFile.path(),'utf8'),xml.xml,'Download reuses the checked canonical MusicXML cache; no redundant request is required');
  const[textResponse]=await Promise.all([nextResponse('/api/export/jianpu'),ui('#export-jianpu').click()]);const text=await responseJson(textResponse);await ui('#jianpu-export-download:not([disabled])').waitFor();assert.ok(text.text.includes(':1/3'));const textFilePromise=page.waitForEvent('download');await ui('#jianpu-export-download').click();assert.equal(await readFile(await(await textFilePromise).path(),'utf8'),text.text);await ui('#jianpu-export-close').click();assert.deepEqual(await exportScore(),original.score);
  for(const[endpoint,filename,content,mime]of[['/api/import/jianpu','roundtrip.jianpu',text.text,'text/plain'],['/api/import/musicxml','roundtrip.musicxml',xml.xml,'application/xml']]){
    const[response]=await Promise.all([nextResponse(endpoint),ui('#score-file').setInputFiles({name:filename,mimeType:mime,buffer:Buffer.from(content)})]);const imported=await responseJson(response);assert.equal(imported.timeline.notes.length,original.timeline.notes.length);for(let index=0;index<original.timeline.notes.length;index++){const actual=imported.timeline.notes[index],expected=original.timeline.notes[index];assert.equal(actual.midi,expected.midi);assert.ok(Math.abs(actual.start_ms-expected.start_ms)<1e-7);assert.ok(Math.abs(actual.duration_ms-expected.duration_ms)<1e-7)}assert.ok(Math.abs(imported.timeline.duration_ms-original.timeline.duration_ms)<1e-7);await readyForTitle(imported.score.title);
  }
});

test('real optional metronome distinguishes six eighth subdivisions from two compound clicks and scopes loops',testOptions,async()=>{
  assert.equal(requests.filter(request=>request.path==='/api/metronome').length,0);
  const score=structuredClone(initialCompilation.score);score.title='Original compound pulse study';score.parts[0].notes=score.parts[0].notes.slice(0,3).map((note,index)=>({...note,at:{numerator:index,denominator:1},duration:{numerator:1,denominator:1}}));score.measures=[{number:1,at:{numerator:0,denominator:1},length:{numerator:3,denominator:1}}];score.meters=[{at:{numerator:0,denominator:1},numerator:6,denominator:8}];
  await ui('#score-file').setInputFiles({name:'original-compound.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(score))});await readyForTitle(score.title);await ui('.practice-options>summary').click();const[unitResponse]=await Promise.all([nextResponse('/api/metronome'),ui('#metronome-enabled').check()]);const units=await responseJson(unitResponse);assert.equal(units.ticks.length,6);assert.equal(units.ticks.filter(tick=>tick.accent).length,1);assert.equal(units.pulse,'notated_unit');await page.waitForFunction(()=>document.querySelector('#metronome-status').textContent.startsWith('6 Rust-timed'));assert.match(await ui('#metronome-diagnostics').textContent(),/each eighth/);
  const[compoundResponse]=await Promise.all([nextResponse('/api/metronome'),ui('#metronome-pulse').selectOption('dotted_quarter')]);const compound=await responseJson(compoundResponse);assert.equal(compound.ticks.length,2);await page.waitForFunction(()=>document.querySelector('#metronome-status').textContent.startsWith('2 Rust-timed'));
  await ui('#loop-from').fill('1/2');await ui('#loop-to').fill('5/2');await ui('#loop-apply').click();await page.waitForFunction(()=>document.querySelector('#loop-status').textContent.includes('ready'));await page.waitForFunction(()=>document.querySelector('#metronome-status').textContent.startsWith('1 Rust-timed'));
  await ui('#count-in').uncheck();await ui('#play-button').click();await page.waitForFunction(()=>document.querySelector('#transport-status').textContent.includes('Listening'));await page.waitForFunction(time=>globalThis.__wmhReadPlaybackClock().positionMs>=time,compound.ticks[1].start_ms+50);await ui('#play-button').click();await ui('#sound-button').click();assert.match(await ui('#metronome-status').textContent(),/Global sound is muted/);assert.deepEqual(await exportScore(),score);
});

test('embedded source directory remains local until a fixed official link or local import is chosen',testOptions,async()=>{
  const before=requests.length,external=[];page.on('request',request=>{if(new URL(request.url()).origin!==origin)external.push(request.url())});await ui('#source-directory-button').click();assert.equal(await ui('.source-card').count(),3);assert.match(await ui('#score-source-directory').textContent(),/does not add license metadata/);await ui('#source-route').selectOption('musicxml');assert.equal(await ui('.source-card:not([hidden])').count(),1);assert.equal(await ui('.source-card:not([hidden])').getAttribute('data-source-id'),'openscore-lieder');await ui('#source-route').selectOption('all');await page.screenshot({path:join(artifactDirectory,'worldmusichub-live-sources.png'),fullPage:true});await ui('#source-directory-close').click();assert.equal(requests.length,before);assert.deepEqual(external,[]);assert.deepEqual(await exportScore(),initialCompilation.score);
});

test('real explicitly confirmed part-octave copy preserves source JSON and restores it exactly',testOptions,async()=>{
  const original=structuredClone(initialCompilation.score);original.title='Original reversible octave exercise';original.source={format:'original-test-text',filename:'original.txt',content:'\uFEFFOriginal source · 原稿\r\nKeep exact bytes and credits.'};await ui('#score-file').setInputFiles({name:'original.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(original))});await readyForTitle(original.title);const part=original.parts[0].id;await selectPracticePart(part);await page.waitForFunction(()=>document.querySelector('#practice-scope').textContent.includes('physical attacks'));
  await ui('#instrument-settings>summary').click();await ui('#adaptation-button').click();await ui('#adaptation-scope').selectOption('selected');await ui('#adaptation-octaves').fill('1');const[previewResponse]=await Promise.all([nextResponse('/api/adaptation/preview'),ui('#adaptation-preview').click()]);const preview=await responseJson(previewResponse);assert.equal(preview.operation.part_id,part);assert.equal(preview.changed_note_count,15);assert.equal(preview.original_preserved,true);await ui('#adaptation-result').waitFor();assert.equal(await ui('#score-title').textContent(),original.title);assert.equal(await ui('#adaptation-activate').isDisabled(),true);
  await ui('#adaptation-confirm').check();await ui('#adaptation-activate').click();await ui('#adaptation-dialog').waitFor({state:'hidden'});await readyForTitle(preview.compilation.score.title);assert.deepEqual(await humanModPartIds(),[part]);const copy=await exportScore();assert.deepEqual(copy,preview.compilation.score);assert.deepEqual(JSON.parse(copy.source.content).original,original);assert.equal(JSON.parse(copy.source.content).original.source.content,original.source.content);
  await ui('#adaptation-button').click();const[restoreResponse]=await Promise.all([nextResponse('/api/adaptation/restore'),ui('#adaptation-restore-preview').click()]);const restored=await responseJson(restoreResponse);assert.deepEqual(restored.score,original);await page.waitForFunction(()=>document.querySelector('#adaptation-status').textContent.startsWith('Original preview ready'));assert.equal(await ui('#score-title').textContent(),copy.title);await ui('#adaptation-confirm').check();await ui('#adaptation-activate').click();await ui('#adaptation-dialog').waitFor({state:'hidden'});await readyForTitle(original.title);assert.deepEqual(await exportScore(),original);assert.deepEqual(await humanModPartIds(),[part]);
});

async function openSemitoneReview(){
  if(!await ui('#instrument-settings').evaluate(element=>element.open))await ui('#instrument-settings>summary').click();
  await ui('#transposition-button').click();
}
async function realSemitonePreview(semitones){
  await openSemitoneReview();await ui('#transposition-semitones').fill(String(semitones));
  const [response]=await Promise.all([nextResponse('/api/transposition/preview'),ui('#transposition-preview').click()]);
  const result=await responseJson(response);await ui('#transposition-result').waitFor();return result;
}

test('real whole-score semitone preview retains exact sources, timeline, JSON and saved copy through restoration',testOptions,async()=>{
  const source=structuredClone(fixture);source.title='Whole-score semitone original';source.source={format:'original-test-text',filename:'原稿.txt',content:'\uFEFFExact original · 原稿\r\nKeep timing and spelling.',import_diagnostics:[{severity:'warning',code:'retained_original_test',message:'Original source notice',note_id:null}]};
  source.parts[0].notes[0].tie_start=true;source.parts[0].notes[1].pitch=structuredClone(source.parts[0].notes[0].pitch);source.parts[0].notes[1].tie_stop=true;
  source.parts[0].notes.push({...structuredClone(source.parts[0].notes[0]),id:'rest',at:{numerator:2,denominator:1},pitch:null,tie_start:false,tie_stop:false});
  source.parts.push({...structuredClone(fixture.parts[0]),id:'bass',name:'Bass',notes:fixture.parts[0].notes.map(note=>({...structuredClone(note),id:`bass-${note.id}`,pitch:{...note.pitch,octave:3}}))});source.keys.push({at:{numerator:2,denominator:1},fifths:-3,mode:'minor'});
  await ui('#score-file').setInputFiles({name:'whole-score.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(source))});await readyForTitle(source.title);
  const importedCopies=await waitForBrowserImportCopies(1);assertAddedLibraryCopies([],importedCopies,[{label:null,score:source}]);
  const original=await exportScore(),compiled=await rustApi('/api/compile',original);await selectPracticePart('piano');await page.waitForFunction(()=>document.querySelector('#practice-scope').textContent.includes('physical attacks'));
  await ui('.practice-options>summary').click();
  await ui('#loop-from').fill('0');await ui('#loop-to').fill('2');await ui('#loop-apply').click();await page.waitForFunction(()=>document.querySelector('#loop-status').textContent.includes('ready'));
  const copiesBefore=requests.filter(request=>request.path==='/api/compile').length,result=await realSemitonePreview(2);
  assert.equal(await ui('#score-title').textContent(),original.title);assert.equal(requests.filter(request=>request.path==='/api/compile').length,copiesBefore);assert.equal(await ui('#transposition-activate').isDisabled(),true);assert.equal(result.changed_note_count,4);assert.deepEqual(JSON.parse(result.compilation.score.source.content).original,original);assert.deepEqual(result.compilation.timeline,{...compiled.timeline,notes:compiled.timeline.notes.map(note=>({...note,midi:note.midi+2}))});
  assert.match(await ui('#transposition-result-summary').textContent(),/whole score/);assert.match(await ui('#transposition-key-sample').textContent(),/C major.*D major/);await ui('#transposition-confirm').check();await ui('#transposition-activate').click();await ui('#transposition-dialog').waitFor({state:'hidden'});await readyForTitle(result.compilation.score.title);assert.equal(await ui('#practice-part').inputValue(),'piano');assert.equal(await ui('#loop-enabled').isChecked(),false);assert.deepEqual(await exportScore(),result.compilation.score);
  assert.deepEqual(await browserLibrarySnapshot(),importedCopies,'Previewing and activating a derived score do not autosave or overwrite its original import');
  await ui('#library-button').click();await page.waitForFunction(()=>document.querySelector('#library-status').textContent.startsWith('Ready.'));await ui('#library-save-copy').click();await page.waitForFunction(()=>document.querySelector('#library-status').textContent.startsWith('Saved'));
  const savedCopies=await browserLibrarySnapshot();assertAddedLibraryCopies(importedCopies,savedCopies,[{label:null,score:result.compilation.score}]);await ui('#library-close').click();
  await openSemitoneReview();assert.equal(await ui('#transposition-preview').isDisabled(),true);const [response]=await Promise.all([nextResponse('/api/transposition/restore'),ui('#transposition-restore-preview').click()]);assert.deepEqual((await responseJson(response)).score,original);await page.waitForFunction(()=>document.querySelector('#transposition-status').textContent.startsWith('Original preview ready'));assert.equal(await ui('#score-title').textContent(),result.compilation.score.title);await ui('#transposition-confirm').check();await ui('#transposition-activate').click();await ui('#transposition-dialog').waitFor({state:'hidden'});await readyForTitle(original.title);assert.deepEqual(await exportScore(),original);
  await ui('#library-button').click();await page.waitForFunction(()=>document.querySelector('#library-status').textContent.startsWith('Ready.'));const backup=await downloadLibraryBackup();assert.deepEqual(backup.entries,savedCopies.map(({label,score})=>({label,score})),'Backup retains both the imported original and the independently saved derived score');assert.deepEqual(await browserLibrarySnapshot(),savedCopies,'Restoration cannot overwrite either saved source or create another copy');await ui('#library-close').click();
});

test('real semitone copy keeps out-of-range notes visible while actual Practice admission stays blocked',testOptions,async()=>{
  await setSessionMode('listen');await ui('#key-count').selectOption('49');await page.waitForFunction(()=>document.querySelector('#practice-scope').textContent.includes('physical attacks'));
  const original=await exportScore(),result=await realSemitonePreview(36);assert.equal(result.scored_mode_allowed,false);assert.ok(result.instrument_report.note_options.some(note=>!note.playable));assert.equal(result.changed_note_count,original.parts.flatMap(part=>part.notes).filter(note=>note.pitch).length);assert.match(await ui('#transposition-instrument-summary').textContent(),/not allowed in scored mode/);
  await ui('#transposition-confirm').check();await ui('#transposition-activate').click();await ui('#transposition-dialog').waitFor({state:'hidden'});await readyForTitle(result.compilation.score.title);assert.deepEqual(await exportScore(),result.compilation.score);assert.equal(await ui('#play-button').isEnabled(),true);
  await setSessionMode('practice');await page.waitForFunction(()=>!document.querySelector('#practice-gate').hidden);assert.equal(await ui('#play-button').isDisabled(),true);assert.equal(await ui('#assess-button').isDisabled(),true);assert.match(await ui('#practice-gate-reason').textContent(),/Selected notes outside this instrument range: \d+\./);assert.deepEqual(await exportScore(),result.compilation.score);
});

test('real landscape semitone review controls remain reachable and cancelled preview preserves a paused take',testOptions,async()=>{
  await hideNotation();await page.setViewportSize({width:844,height:390});await setSessionMode('practice');await ui('#count-in').uncheck();await closeShellPanels();await page.locator('#play-button').click();await page.waitForFunction(()=>globalThis.__wmhReadPlaybackClock().positionMs>0);await page.locator('#stage-title').click();await page.keyboard.press('a');await page.waitForFunction(()=>document.querySelector('#hud-captured').textContent==='1');await page.locator('#play-button').click();await page.waitForFunction(()=>document.querySelector('.performance-status').dataset.phase!=='grace');
  const before=await exportTakeData(),position=(await page.locator('#progress').evaluate(readPlaybackClock)).positionMs;await realSemitonePreview(2);
  async function visibleControl(selector){await page.locator(selector).scrollIntoViewIfNeeded();const geometry=await page.locator(selector).evaluate(element=>{const r=element.getBoundingClientRect(),d=element.closest('dialog'),b=d.getBoundingClientRect();return{control:{x:r.x,y:r.y,right:r.right,bottom:r.bottom,width:r.width,height:r.height},dialog:{x:b.x,y:b.y,right:b.right,bottom:b.bottom,width:b.width,height:b.height},viewport:{width:innerWidth,height:innerHeight},document:{width:document.documentElement.scrollWidth,height:document.documentElement.scrollHeight}}});assertInsideViewport(geometry.control,geometry.viewport,selector);assertInsideViewport(geometry.dialog,geometry.viewport,'Semitone review');assert.ok(geometry.control.y>=geometry.dialog.y&&geometry.control.bottom<=geometry.dialog.bottom);assertBoundedDocument(geometry)}
  await visibleControl('#transposition-semitones');await viewportSnapshot('transposition-844x390-controls');await visibleControl('#transposition-confirm');await ui('#transposition-confirm').check();await visibleControl('#transposition-activate');await viewportSnapshot('transposition-844x390-confirmation');await page.keyboard.press('Escape');await ui('#transposition-dialog').waitFor({state:'hidden'});await closeShellPanels();assert.deepEqual(await exportTakeData(),before);assert.equal((await page.locator('#progress').evaluate(readPlaybackClock)).positionMs,position);assert.match(await ui('#play-button').textContent(),/Play/);
});

test('real semitone activation cancels before compile commit and finishes review before delayed compatibility',testOptions,async()=>{
  await hideNotation();await setSessionMode('practice');await ui('#count-in').uncheck();await closeShellPanels();await page.locator('#play-button').click();await page.waitForFunction(()=>globalThis.__wmhReadPlaybackClock().positionMs>0);await page.locator('#stage-title').click();await page.keyboard.press('a');await page.waitForFunction(()=>document.querySelector('#hud-captured').textContent==='1');await page.locator('#play-button').click();await page.waitForFunction(()=>document.querySelector('.performance-status').dataset.phase!=='grace');const original=await exportScore(),before=await exportTakeData();
  let releaseCompile,compileSeen;const compileGate=new Promise(resolve=>releaseCompile=resolve),seenCompile=new Promise(resolve=>compileSeen=resolve);const delayedCompile=async route=>{compileSeen();await compileGate;await route.continue().catch(()=>{})};
  await realSemitonePreview(2);await ui('#transposition-confirm').check();await page.route('**/api/compile',delayedCompile);try{await ui('#transposition-activate').click();await seenCompile;await ui('#transposition-cancel').click()}finally{releaseCompile();await page.unroute('**/api/compile',delayedCompile)}assert.equal(await ui('#score-title').textContent(),original.title);assert.deepEqual(await exportTakeData(),before);assert.deepEqual(await exportScore(),original);
  const result=await realSemitonePreview(2);await ui('#transposition-confirm').check();let releaseCheck,checkSeen;const checkGate=new Promise(resolve=>releaseCheck=resolve),seenCheck=new Promise(resolve=>checkSeen=resolve);const delayedCheck=async route=>{checkSeen();await checkGate;await route.continue().catch(()=>{})};await page.route('**/api/instrument-check',delayedCheck);
  try{await ui('#transposition-activate').click();await seenCheck;await ui('#transposition-dialog').waitFor({state:'hidden'});assert.equal(await ui('#score-title').textContent(),result.compilation.score.title);assert.equal(await ui('#export-takes').isDisabled(),true);assert.match(await ui('#notice').textContent(),/copy loaded.*checks are updating/);await openSemitoneReview();assert.equal(await ui('#transposition-preview').isDisabled(),true)}finally{releaseCheck();await page.unroute('**/api/instrument-check',delayedCheck)}
  await page.waitForFunction(()=>!document.querySelector('#play-button').disabled);assert.equal(await ui('#transposition-dialog').isVisible(),true);assert.equal(await ui('#transposition-restore-preview').isVisible(),true);await ui('#transposition-close').click();assert.deepEqual(await exportScore(),result.compilation.score);assert.match(await ui('#play-button').textContent(),/Play/);
});

async function openExternalReviewFiles(xml,filename='audiveris.musicxml',image=null){
  await ui('#source-directory-button').click();await ui('#source-review-external').click();await ui('#external-output-file').setInputFiles({name:filename,mimeType:'application/xml',buffer:Buffer.from(xml)});
  if(image){await ui('#external-image-file').setInputFiles({name:image.filename,mimeType:'image/png',buffer:image.bytes});await ui('#external-original-figure').waitFor()}
  await ui('#external-engine-declaration').check();const[response]=await Promise.all([nextResponse('/api/omr/audiveris-draft'),ui('#external-prepare').click()]);const draft=await responseJson(response);await ui('#external-editor').waitFor();return draft;
}
async function attestExternalReview(){for(const key of ['notes_and_rests','rhythm_and_voices','ties_and_navigation','key_and_meter','tempo','source_rights'])await ui(`#external-confirm-${key}`).check()}
test('real Audiveris melody review corrects missed tempo and retains hash-matched original image and raw output',testOptions,async()=>{
  const provenance=JSON.parse(await readFile(new URL('audiveris-original-melody-provenance.json',fixtures),'utf8'));
  const image=await readFile(new URL(provenance.image,fixtures)),raw=await readFile(new URL(provenance.recognized_fixture,fixtures));
  assert.equal(createHash('sha256').update(image).digest('hex'),provenance.image_sha256);assert.equal(createHash('sha256').update(raw).digest('hex'),provenance.recognition_fixture_sha256);assert.equal(provenance.printed_quarter_bpm,90);
  assert.match(raw.toString('utf8'), /DTD MusicXML 4\.0\.3 Partwise/);
  const genericResponse = await fetch(`${origin}/api/import/musicxml`, {method: 'POST', headers: {'Content-Type': 'application/xml'}, body: raw});
  assert.equal(genericResponse.status, 400, 'The new standard-header route does not admit Audiveris 4.0.3 output');
  const genericError = await genericResponse.json();
  assert.match(genericError.error, /4\.0\.3|DTD|DOCTYPE|version/i);
  assert.equal(Object.hasOwn(genericError, 'score'), false);
  const compileCount=requests.filter(request=>request.path==='/api/compile').length,previousTitle=await ui('#score-title').textContent();const draft=await openExternalReviewFiles(raw,'audiveris-original-melody.musicxml',{filename:provenance.image,bytes:image});
  assert.equal(draft.requires_review,true);assert.equal(draft.confidence,null);assert.equal(Object.hasOwn(draft,'timeline'),false);assert.equal(draft.score.tempo[0].bpm,120,'The known recognition miss remains uncorrected until the user edits it');assert.equal(draft.score.parts[0].notes.length,16);assert.equal(draft.normalizations.length,1);assert.equal(await ui('#score-title').textContent(),previousTitle);assert.equal(requests.filter(request=>request.path==='/api/compile').length,compileCount);
  assert.equal(draft.score.source.format, 'external-omr-draft');
  assert.equal(JSON.parse(draft.score.source.content).input.output_content, raw.toString('utf8'));
  assert.equal((draft.score.source.import_diagnostics || []).filter(item => item.code === 'musicxml_header_normalized').length, 0);
  const draftCompile = await fetch(`${origin}/api/compile`, {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(draft.score)});
  assert.equal(draftCompile.status, 400);
  assert.match((await draftCompile.json()).error, /needs explicit.*review before playback or practice/);
  assert.deepEqual(await ui('#external-original-image').evaluate(image=>[image.naturalWidth,image.naturalHeight]),[provenance.width,provenance.height]);assert.match(await ui('.external-confidence').textContent(),/Confidence: unknown/);
  const unresolved=structuredClone(draft.score);unresolved.parts[0].notes.find(note=>note.pitch).tie_start=true;const refused=await fetch(`${origin}/api/omr/confirm`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({score:unresolved,confirmation:{notes_and_rests:true,rhythm_and_voices:true,ties_and_navigation:true,key_and_meter:true,tempo:true,source_rights:true}})});assert.equal(refused.status,400);assert.match((await refused.json()).error,/Review the ties.*unclosed tie start/);assert.equal(await ui('#score-title').textContent(),previousTitle);assert.equal(unresolved.source.content,draft.score.source.content,'The rejected review preserves the original source record');
  await attestExternalReview();await page.getByLabel('Tempo BPM 1',{exact:true}).fill('90');assert.equal(await ui('#external-confirm-load').isDisabled(),true);assert.equal(await ui('#external-confirm-source_rights').isChecked(),false);await ui('#external-title').fill('Manually reviewed original melody');await ui('#external-composer').fill('WorldMusicHub original exercise');assert.deepEqual(draft.score.keys,[],'The engine omitted a key declaration; the editor must not invent it');await ui('#external-map-kind').selectOption('keys');assert.equal(await ui('.external-map-row').count(),0);await ui('#external-add-map').click();assert.equal(await ui('#external-confirm-key_and_meter').isChecked(),false);await page.getByLabel('Key fifths 1',{exact:true}).fill('0');await page.getByLabel('Key mode 1',{exact:true}).fill('major');await attestExternalReview();
  await page.screenshot({path:join(artifactDirectory,'worldmusichub-live-external-omr-review.png'),fullPage:true});const[response]=await Promise.all([nextResponse('/api/omr/confirm'),ui('#external-confirm-load').click()]);const confirmed=await responseJson(response);await ui('#external-omr-dialog').waitFor({state:'hidden'});await readyForTitle('Manually reviewed original melody');assert.equal(confirmed.score.tempo[0].bpm,90);assert.deepEqual(confirmed.score.keys,[{at:{numerator:0,denominator:1},fifths:0,mode:'major'}]);assert.equal(confirmed.timeline.notes.length,15);assert.ok(Math.abs(confirmed.timeline.duration_ms-16*60000/90)<1e-7);
  const exported=await exportScore();assert.equal(exported.source.format,'external-omr-reviewed');const record=JSON.parse(exported.source.content);assert.equal(record.input.output_content,raw.toString('utf8'));assert.deepEqual(Buffer.from(record.input.original_image.base64,'base64'),image);assert.equal(record.input.original_image.filename,provenance.image);assert.equal(Object.values(record.confirmation).every(value=>value===true),true);assert.ok(confirmed.diagnostics.some(diagnostic=>diagnostic.message.startsWith('Retained import observation: ')));assert.equal(await ui('#tempo').inputValue(),'90');
});
test('real external duet corrections keep every part/staff/tie while fixing onsets, voices and tempo/key maps',testOptions,async()=>{
  const raw=await readFile(new URL('audiveris-original-duet.musicxml',fixtures)),referenceXml=await readFile(new URL('original-duet.musicxml',fixtures));const referenceResponse=await fetch(`${origin}/api/import/musicxml`,{method:'POST',headers:{'Content-Type':'application/xml'},body:referenceXml});assert.equal(referenceResponse.status,200);const reference=await referenceResponse.json();
  const draft=await openExternalReviewFiles(raw,'audiveris-original-duet.musicxml');assert.equal(draft.score.parts.length,2);assert.equal(await ui('#external-original-figure').isVisible(),false);assert.equal(await ui('#external-part option').count(),2);
  for(let index=0;index<draft.score.parts[0].notes.length;index++){const note=draft.score.parts[0].notes[index];if(note.at.numerator===2*note.at.denominator)await page.getByLabel(`Onset for draft note ${index+1}`,{exact:true}).fill('3');if(note.staff===2)await page.getByLabel(`Voice for draft note ${index+1}`,{exact:true}).fill('2');else if(note.voice==='2')await page.getByLabel(`Voice for draft note ${index+1}`,{exact:true}).fill('1')}
  await ui('#external-json-tab').click();const edited=JSON.parse(await ui('#external-json').inputValue());assert.equal(Object.hasOwn(edited,'source'),false);edited.tempo=reference.score.tempo;edited.keys=reference.score.keys;await ui('#external-json').fill(JSON.stringify(edited,null,2));await ui('#external-json-apply').click();await ui('#external-part').selectOption('1');assert.equal(await ui('.external-note-row').count(),draft.score.parts[1].notes.length);await attestExternalReview();
  const[response]=await Promise.all([nextResponse('/api/omr/confirm'),ui('#external-confirm-load').click()]);const confirmed=await responseJson(response);await ui('#external-omr-dialog').waitFor({state:'hidden'});await readyForTitle(confirmed.score.title);
  const written=score=>score.parts.map(part=>part.notes.map(note=>JSON.stringify([note.at,note.duration,note.pitch,note.voice,note.staff,note.tie_start,note.tie_stop])).sort());assert.deepEqual(written(confirmed.score),written(reference.score));assert.deepEqual(confirmed.score.tempo,reference.score.tempo);assert.deepEqual(confirmed.score.keys,reference.score.keys);assert.equal(JSON.parse((await exportScore()).source.content).input.output_content,raw.toString('utf8'));
  const timing=timeline=>timeline.notes.map(note=>[note.midi,Number(note.start_ms.toFixed(6)),Number(note.duration_ms.toFixed(6))]).sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b)));assert.deepEqual(timing(confirmed.timeline),timing(reference.timeline));
});

test('real Rust measure following turns engraved pages through repeat passes without changing playback or source', {timeout:60_000},async()=>{
 const score=structuredClone(initialCompilation.score);score.id='original-follow-study';score.title='Original repeated measure study';score.tempo=[{at:{numerator:0,denominator:1},bpm:300}];score.meters=[{at:{numerator:0,denominator:1},numerator:1,denominator:4}];score.measures=Array.from({length:20},(_,index)=>({number:42,at:{numerator:index,denominator:1},length:{numerator:1,denominator:1}}));const seed=score.parts[0].notes[0];score.parts[0].notes=Array.from({length:20},(_,index)=>({...structuredClone(seed),id:`follow-note-${index}`,at:{numerator:index,denominator:1},duration:{numerator:1,denominator:1},pitch:{step:['C','D','E','F','G'][index%5],alter:0,octave:4}}));score.repeats=[{from:{numerator:0,denominator:1},to:{numerator:12,denominator:1},times:2}];
 const navigationResponse=nextResponse('/api/notation-navigation');await ui('#score-file').setInputFiles({name:'original-follow-study.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(score))});await readyForTitle(score.title);await waitForEngraving();await page.waitForFunction(()=>document.querySelector('#written-cursor-status').dataset.status==='ready');const scoreNavigationRequests=()=>requests.filter(request=>request.path==='/api/notation-navigation'&&JSON.parse(request.body).id===score.id);assert.equal(scoreNavigationRequests().length,1,'Written cursor and page following share one validated navigation response');assert.equal(await ui('#engraving-follow').isChecked(),true);const navigation=await responseJson(await navigationResponse);assert.equal(navigation.occurrences.length,32);assert.equal(navigation.source_measure_count,20);assert.equal(navigation.duration_ms,6400);await page.waitForFunction(()=>document.querySelector('#engraving-follow-status').textContent.includes('Paused at written measure 42'));
 await ui('#count-in').uncheck();await ui('#play-button').click();await page.waitForFunction(()=>document.querySelector('#engraving-range').textContent.startsWith('Measures 9–'));assert.match(await ui('#play-button').textContent(),/Pause/);await page.waitForFunction(()=>document.querySelector('#engraving-follow-status').textContent.includes('pass 2/2')&&document.querySelector('#engraving-range').textContent.startsWith('Measures 1–8'));assert.match(await ui('#play-button').textContent(),/Pause/);await page.waitForFunction(()=>document.querySelector('#transport-status').textContent.includes('Complete'));assert.match(await ui('#engraving-follow-status').textContent(),/End of performance/);assert.match(await ui('#engraving-range').textContent(),/Measures 17–20/);await screenshot('measure-following');assert.deepEqual(await exportScore(),score);
 await ui('#engraving-prev').click();assert.equal(await ui('#engraving-follow').isChecked(),false);assert.match(await ui('#engraving-follow-status').textContent(),/Manual navigation suspended/);assert.equal(scoreNavigationRequests().length,1,'Manual paging does not refetch the shared current-note/page-following data');
});

test('real Rust follow crosses Jianpu rests and silent measures while manual browsing and view changes keep playback running', {timeout:60_000},async()=>{
  await page.setViewportSize({width:1280,height:720});
  const score=structuredClone(fixture),beat=n=>({numerator:n,denominator:1}),seed=score.parts[0].notes[0];
  score.id='original-shared-follow-study';score.title='Original shared follow study';score.tempo=[{at:beat(0),bpm:120}];
  score.meters=[{at:beat(0),numerator:1,denominator:4}];
  // The full-width desktop notation page holds 16 beats. Put the written
  // rest exactly at the next page boundary, followed by genuinely empty bars.
  score.measures=Array.from({length:32},(_,index)=>({number:7,at:beat(index),length:beat(1)}));
  score.parts[0].notes=Array.from({length:32},(_,index)=>({...structuredClone(seed),id:`shared-${index}`,at:beat(index),duration:beat(1),pitch:index===16?null:{step:'C',alter:0,octave:4},velocity:index===16?0:90})).filter((_,index)=>index!==17&&index!==18&&index!==19);
  score.repeats=[{from:beat(0),to:beat(24),times:2}];
  await ui('#score-file').setInputFiles({name:'shared-follow.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(score))});await readyForTitle(score.title);
  await ui('#jianpu-button').click();await page.waitForFunction(()=>document.querySelector('#written-cursor-status').dataset.status==='ready');
  assert.equal(await page.locator('#engraving-follow').isVisible(),true);assert.equal(await page.locator('#engraving-follow').isChecked(),true);
  await ui('#count-in').uncheck();await closeShellPanels();await page.locator('#reset-button').click();
  const firstPage=await page.locator('#notation-page').textContent();
  await page.locator('#play-button').click();
  await page.waitForFunction(()=>document.querySelector('#written-cursor-status').dataset.sourceMeasureIndex==='16');
  assert.notEqual(await page.locator('#notation-page').textContent(),firstPage,'An explicit written rest turns the basic page');
  assert.equal(await page.locator('#notation .score-note.active[data-note-id="shared-16"]').count(),1);
  await page.waitForFunction(()=>document.querySelector('#written-cursor-status').dataset.sourceMeasureIndex==='17');
  assert.equal(await page.locator('#notation .score-note.active').count(),0);assert.notEqual(await page.locator('#notation-page').textContent(),firstPage,'Silent measures retain the correct source page');
  await ui('#notation-prev').click();const manualPage=await page.locator('#notation-page').textContent();
  assert.equal(await page.locator('#engraving-follow').isChecked(),false);assert.match(await page.locator('#play-button').textContent(),/Pause/);
  const position=(await page.locator('#progress').evaluate(readPlaybackClock)).positionMs;
  await page.waitForFunction(previous=>globalThis.__wmhReadPlaybackClock().positionMs>previous+250,position);
  assert.equal(await page.locator('#notation-page').textContent(),manualPage,'Live playback does not undo a manual page choice');
  await ui('#staff-button').click();assert.equal(await page.locator('#notation-page').textContent(),manualPage);assert.equal(await page.locator('#engraving-follow').isChecked(),false);
  await page.locator('#notation-toggle').click();await page.locator('#notation-toggle').click();await ui('#jianpu-button').click();
  assert.equal(await page.locator('#engraving-follow').isChecked(),false);assert.equal(await page.locator('#notation-page').textContent(),manualPage);assert.match(await page.locator('#play-button').textContent(),/Pause/);
  await ui('#engraving-follow').check();
  await page.waitForFunction(()=>document.querySelector('#engraving-follow-status').textContent.includes('pass 2/2')&&document.querySelector('#written-cursor-status').dataset.sourceMeasureIndex==='0');
  assert.equal(await page.locator('#notation-page').textContent(),firstPage,'The Rust repeat occurrence turns back to the first written page');
  await ui('#engraved-button').click();assert.match(await page.locator('#play-button').textContent(),/Pause/);assert.equal(await page.locator('#engraving-follow').isChecked(),true);
  await waitForEngraving();await ui('#jianpu-button').click();assert.match(await page.locator('#play-button').textContent(),/Pause/);
  await page.locator('#play-button').click();const paused=(await page.locator('#progress').evaluate(readPlaybackClock)).positionMs;
  await ui('#engraved-button').click();await waitForEngraving();await ui('#staff-button').click();
  assert.equal((await page.locator('#progress').evaluate(readPlaybackClock)).positionMs,paused,'Paused view changes never change the transport position');
  assert.equal(requests.filter(request=>request.path==='/api/notation-navigation'&&JSON.parse(request.body).id===score.id).length,1);
  assert.deepEqual(await exportScore(),score);await screenshot('shared-follow-jianpu-manual');
});

test('real written-note cursor separates tied continuations, short unisons, rests and selected-part keys', testOptions, async () => {
  const score=structuredClone(fixture),beat=n=>({numerator:n,denominator:1}),seed=score.parts[0].notes[0];
  score.id='original-written-cursor-study';score.title='Original written cursor study';
  score.measures=[0,1].map(index=>({number:7,at:beat(index*4),length:beat(4)}));
  score.parts[0].notes=[
    {...structuredClone(seed),id:'tie-start',at:beat(0),duration:beat(2),tie_start:true},
    {...structuredClone(seed),id:'tie-stop',at:beat(2),duration:beat(2),tie_stop:true},
    {...structuredClone(seed),id:'short-D',at:beat(0),duration:beat(1),pitch:{step:'D',alter:0,octave:4},voice:'2'},
    {...structuredClone(seed),id:'written-rest',at:beat(1),duration:beat(2),pitch:null,velocity:0,voice:'2'},
  ];
  score.parts.push({id:'counter',name:'Counter voice',instrument:'piano',notes:[
    {...structuredClone(seed),id:'short-unison',at:beat(0),duration:beat(1)},
    {...structuredClone(seed),id:'repeated-C',at:beat(3),duration:beat(1)},
  ]});
  await ui('#score-file').setInputFiles({name:'original-written-cursor-study.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(score))});
  await readyForTitle(score.title);await ui('#engraving-follow').uncheck();await ui('#jianpu-button').click();
  await page.waitForFunction(()=>document.querySelector('#written-cursor-status').dataset.status==='ready');
  // Canonical scores use Listen for independent displayed-part inspection.
  // Solo practice below must keep notation on its actual human part.
  await setSessionMode('listen');await ui('#play-button:not([disabled])').waitFor();
  assert.equal(await ui('#notation-scope').isEnabled(),true,'Listen permits independent notation inspection');
  await ui('#count-in').uncheck();await ui('#reset-button').click();await closeShellPanels();
  const waitIds=expected=>page.waitForFunction(ids=>JSON.stringify(JSON.parse(document.querySelector('#written-cursor-status').dataset.sourceNoteIds||'[]').sort())===JSON.stringify(ids),[...expected].sort());
  const waitPainted=expected=>page.waitForFunction(ids=>JSON.stringify([...document.querySelectorAll('.score-note.active')].map(node=>node.dataset.noteId).sort())===JSON.stringify(ids),[...expected].sort());
  const snapshot=()=>page.evaluate(()=>({
    ids:JSON.parse(document.querySelector('#written-cursor-status').dataset.sourceNoteIds),
    activeWritten:[...document.querySelectorAll('.score-note.active')].map(n=>n.dataset.noteId).sort(),
    expectedKeys:[...document.querySelectorAll('#keyboard .piano-key.playing')].map(n=>Number(n.dataset.midi)).sort((a,b)=>a-b),
    heldKeys:document.querySelectorAll('#keyboard .piano-key.pressed').length,position:globalThis.__wmhReadPlaybackClock().positionMs,
  }));
  await ui('#notation-scope').selectOption('part');await ui('#notation-scope-part').selectOption('piano');await closeShellPanels();
  await waitIds(['short-D','short-unison','tie-start']);
  await waitPainted(['short-D','tie-start']);
  const initial=await snapshot();assert.deepEqual(initial.activeWritten,['short-D','tie-start']);assert.deepEqual(initial.expectedKeys,[60,62]);assert.equal(initial.heldKeys,0);
  await ui('#notation-part').selectOption('');await page.waitForFunction(()=>document.querySelectorAll('#notation .score-note.active').length===3);const allParts=await snapshot();assert.deepEqual(allParts.activeWritten,['short-D','short-unison','tie-start']);assert.deepEqual(allParts.expectedKeys,initial.expectedKeys);assert.equal(await ui('#practice-part').inputValue(),'','Shown parts do not edit the practice target');await ui('#notation-part').selectOption('piano');
  await ui('#play-button').click();await waitIds(['tie-start','written-rest']);await ui('#play-button').click();
  const first=await snapshot();assert.deepEqual(first.activeWritten,['tie-start','written-rest']);assert.deepEqual(first.expectedKeys,[60]);assert.equal(first.heldKeys,0);
  await ui('#play-button').click();await waitIds(['tie-stop','written-rest']);await ui('#play-button').click();
  const continuation=await snapshot();assert.deepEqual(continuation.activeWritten,['tie-stop','written-rest']);assert.deepEqual(continuation.expectedKeys,[60]);assert.equal(continuation.heldKeys,0);
  assert.equal(await ui('#engraving-follow').isChecked(),false,'Current-note display does not enable page following');
  await screenshot('written-cursor-tie-jianpu');
  assert.equal(requests.some(request=>request.path==='/api/assess'),false,'All-machine Listen inspection never creates an assessment');
  // A scoped target is now an explicit human Mod. Complete view still permits independent notation inspection.
  await configureStageMod({performers:['counter'],layout:'complete'});await ui('#notation-scope').selectOption('current');await ui('#play-button:not([disabled])').waitFor();await ui('#reset-button').click();await closeShellPanels();
  await waitIds(['short-unison']);await waitPainted(['short-unison']);const selectedComplete=await snapshot();assert.deepEqual(selectedComplete.activeWritten,['short-unison']);assert.deepEqual(selectedComplete.expectedKeys,[60]);
  await ui('#notation-part').selectOption('');await page.waitForFunction(()=>document.querySelectorAll('#notation [data-note-id=\"tie-start\"],#notation [data-note-id=\"short-D\"],#notation [data-note-id=\"short-unison\"]').length===3);await waitPainted(['short-unison']);assert.deepEqual((await snapshot()).expectedKeys,[60]);assert.equal(await ui('#practice-part').inputValue(),'counter');await ui('#notation-part').selectOption('counter');
  assert.equal(requests.some(request=>request.path==='/api/assess'),false,'Display inspection never creates an assessment');
  await setSessionMode('practice');await ui('#play-button:not([disabled])').waitFor();await ui('#reset-button').click();await closeShellPanels();
  await page.waitForFunction(()=>document.querySelector('#notation-scope').disabled&&document.querySelector('#notation-scope').value==='current'&&JSON.stringify(JSON.parse(document.querySelector('#workspace').dataset.renderedNotationParts||'[]'))==='["counter"]');
  for(const selector of ['#notation-scope','#notation-scope-part','#notation-part'])assert.equal(await ui(selector).isDisabled(),true,'Solo cannot display other parts through notation selectors');
  assert.match(await ui('#notation-scope-status').textContent(),/Solo practice shows only your human part/);
  await waitIds(['short-unison']);await waitPainted(['short-unison']);const selected=await snapshot();assert.deepEqual(selected.activeWritten,['short-unison']);assert.deepEqual(selected.expectedKeys,[60]);assert.equal(selected.heldKeys,0);
  assert.equal(await ui('#practice-part').inputValue(),'counter');assert.equal(await ui('#notation [data-note-id="tie-start"],#notation [data-note-id="short-D"]').count(),0,'Solo excludes the other source part from the displayed notation');
  await ui('#play-button').click();await waitIds(['repeated-C']);await ui('#play-button').click();const repeat=await snapshot();assert.deepEqual(repeat.activeWritten,['repeated-C']);assert.deepEqual(repeat.expectedKeys,[60]);
  assert.deepEqual(await exportScore(),score,'Display tracking never rewrites canonical music');
  await writeFile(join(artifactDirectory,'worldmusichub-live-written-cursor.json'),JSON.stringify({initial,allParts,first,continuation,selectedComplete,selected,repeat,source_retained:true,scope:'Real Rust navigation/timeline and browser; expected notes only, no physical input or sustain assessment'},null,2));
});

test('complete CC0 D768 edition retains every event and source while range gates, later pages and following remain explicit', {timeout:60_000},async()=>{
  const phases=[],started=performance.now();
  const checkpoint=async name=>{phases.push({name,elapsed_ms:performance.now()-started});await writeFile(join(artifactDirectory,'worldmusichub-live-cc0-d768-phase-checkpoints.json'),JSON.stringify({complete:name==='complete',phases},null,2));};
  const edition=JSON.parse(await readFile(join(root,'catalog/editions/cc0-schubert-wandrers-nachtlied-d768/score.json'),'utf8'));
  const written=edition.parts.flatMap(part=>part.notes),pitched=written.filter(note=>note.pitch),voice=edition.parts.find(part=>part.instrument==='Voice'),piano=edition.parts.find(part=>part.instrument==='piano');
  assert.equal(written.length,334);assert.equal(pitched.length,324);assert.equal(edition.measures.length,14);assert.equal(edition.provenance.kind,'curated_cc0_edition');assert.equal(edition.provenance.license,'CC0-1.0');assert.ok(voice&&piano);
  const editionPath=`/api/catalog/score/${edition.id}`;assert.equal(requests.filter(request=>request.path===editionPath).length,0,'The complete edition source must not load before selection');
  const editionNavigation=nextResponse('/api/notation-navigation');const selectionStarted=performance.now();const[response]=await Promise.all([nextResponse('/api/compile'),ui('.catalog-item').filter({hasText:edition.title}).click()]);const compiled=await responseJson(response);await activateCatalogTitle(edition.title);await waitForEngraving();const selectionToReadyMs=performance.now()-selectionStarted;assert.deepEqual(compiled.score,edition);assert.equal(requests.filter(request=>request.path===editionPath).length,1);assert.equal(compiled.timeline.notes.length,321);assert.deepEqual(compiled.timeline.notes.flatMap(note=>note.source_note_ids).sort(),pitched.map(note=>note.id).sort(),'All pitched source IDs survive tie compilation');
  assert.match(await ui('#score-meta').textContent(),/334 written events.*321 playback note events.*14 measures/);assert.match(await ui('#score-retention-note').textContent(),/324 pitched note segments \+ 10 rests/);assert.equal(await ui('#score-origin-label').textContent(),'CC0 source edition');assert.equal(await ui(`#practice-part option[value="${voice.id}"]`).textContent(),voice.name,'Raw part names are retained rather than silently cleaned');
  await waitForEngraving();assert.equal(await ui('#engraved-button').getAttribute('aria-pressed'),'true');assert.ok(await ui('#engraved-staff svg path').count()>100);await screenshot('cc0-d768-light');await checkpoint('initial-source-and-svg-ready');
  await ui('#score-details-button').click();assert.match(await ui('#provenance').textContent(),/Johann Wolfgang von Goethe/);assert.match(await ui('#provenance').textContent(),/pental/);assert.match(await ui('#diagnostic-list').textContent(),/327 key attacks versus 321 canonical/);assert.match(await ui('#diagnostic-list').textContent(),/fermata/);assert.equal(await ui('#provenance-link').getAttribute('href'),edition.provenance.source_url);await ui('#score-details>summary').click();assert.deepEqual(await exportScore(),edition);
  assert.equal(await ui('#key-count').inputValue(),'61');await setSessionMode('practice');await page.waitForFunction(()=>document.querySelector('#practice-gate-reason').textContent.includes('Selected notes outside this instrument range:'));assert.equal(await ui('#play-button').isDisabled(),true);assert.equal(await ui('#assess-button').isDisabled(),true);
  await selectPracticePart(voice.id);await ui('#play-button:not([disabled])').waitFor();assert.equal(await ui('#key-count').inputValue(),'61');await selectPracticePart(piano.id);await page.waitForFunction(()=>document.querySelector('#practice-gate-reason').textContent.includes('Selected notes outside this instrument range:'));assert.equal(await ui('#play-button').isDisabled(),true);await selectPracticePart('');await ui('#key-count').selectOption('76');await ui('#play-button:not([disabled])').waitFor();await setSessionMode('listen');assert.deepEqual(await exportScore(),edition,'Part/profile changes never adapt or discard source events');await checkpoint('source-provenance-and-range-gates-complete');
  const pageTurnStarted=performance.now();await ui('#engraving-next').click();await page.waitForFunction(()=>document.querySelector('#engraving-status').textContent.includes('Measures 9–14'));await waitForEngraving();const laterPageToReadyMs=performance.now()-pageTurnStarted;assert.match(await ui('#engraving-range').textContent(),/Measures 9–14 \/ 14/);await screenshot('cc0-d768-later-page');await ui('#theme-mode').selectOption('dark');await page.waitForFunction(()=>document.documentElement.dataset.theme==='dark'&&document.querySelector('#engraving-status').textContent.includes('Measures 9–14'));await screenshot('cc0-d768-dark');await checkpoint('later-page-and-theme-ready');
  await ui('.practice-options>summary').click();await ui('#loop-from').fill('32');await ui('#loop-to').fill('36');const[windowResponse]=await Promise.all([nextResponse('/api/practice-window'),ui('#loop-apply').click()]);const window=await responseJson(windowResponse);await page.waitForFunction(()=>document.querySelector('#loop-status').textContent.includes('ready'));await ui('#count-in').uncheck();await ui('#engraving-follow').check();const navigation=await responseJson(await editionNavigation);assert.equal(navigation.occurrences.length,14);assert.equal(navigation.sounding_groups.length,321);assert.ok(navigation.occurrences.every(occurrence=>occurrence.repeat_region_index===null));await page.waitForFunction(()=>document.querySelector('#engraving-follow-status').textContent.includes('source 9/14'));
  await ui('#play-button').click();await page.waitForFunction(start=>{const clock=globalThis.__wmhReadPlaybackClock();return clock.running&&clock.phase==='playing'&&clock.positionMs>start;},window.start_ms);assert.match(await ui('#engraving-follow-status').textContent(),/Following written measure 9/);assert.match(await ui('#engraving-range').textContent(),/Measures 9–14/);await ui('#play-button').click();assert.match(await ui('#transport-status').textContent(),/Paused/);assert.deepEqual(await exportScore(),edition);await ui('#engraving-prev').click();assert.equal(await ui('#engraving-follow').isChecked(),false);assert.match(await ui('#engraving-follow-status').textContent(),/Manual navigation suspended/);await checkpoint('loop-playback-and-manual-follow-complete');
  const[firstResponse]=await Promise.all([nextResponse('/api/compile'),ui(`[data-score-id="${initialCompilation.score.id}"]`).click()]);await responseJson(firstResponse);await activateCatalogTitle(initialCompilation.score.title);await checkpoint('alternate-source-ready');const cachedSelectionStarted=performance.now();const[againResponse]=await Promise.all([nextResponse('/api/compile'),ui(`[data-score-id="${edition.id}"]`).click()]);await responseJson(againResponse);await activateCatalogTitle(edition.title);await waitForEngraving();const cachedSelectionToReadyMs=performance.now()-cachedSelectionStarted;await checkpoint('cached-source-svg-ready');assert.equal(requests.filter(request=>request.path===editionPath).length,1,'Re-selecting a cached edition preserves the original without transferring its archive again');assert.deepEqual(await exportScore(),edition);
  await writeFile(join(artifactDirectory,'worldmusichub-live-cc0-d768-performance.json'),JSON.stringify({measured_at:new Date().toISOString(),platform:process.platform,architecture:process.arch,node:process.version,browser:browser.version(),viewport:page.viewportSize(),score_id:edition.id,written_events:334,sounding_events:321,source_measures:14,page_measures:8,selection_to_ready_svg_ms:selectionToReadyMs,later_page_to_ready_svg_ms:laterPageToReadyMs,cached_selection_to_ready_svg_ms:cachedSelectionToReadyMs,edition_score_requests:requests.filter(request=>request.path===editionPath).length,catalog_index_requests:requests.filter(request=>request.path==='/api/catalog/index').length,legacy_catalog_requests:requests.filter(request=>request.path==='/api/catalog').length,method:'One local CI browser run. Node monotonic clock from explicit click until actual generated SVG is visible; timings include browser automation and local HTTP. These observations are not a universal latency guarantee.'},null,2));
  await checkpoint('complete');
});

test('complete D768 retained originals, compatible copy, reference and license download byte-exactly', {timeout:60_000},async()=>{
  const edition=JSON.parse(await readFile(join(root,'catalog/editions/cc0-schubert-wandrers-nachtlied-d768/score.json'),'utf8'));
  await ui(`[data-score-id="${edition.id}"]`).click();await activateCatalogTitle(edition.title);await waitForEngraving();
  const envelope=JSON.parse(edition.source.content),expected=[{filename:edition.source.filename,bytes:Buffer.from(edition.source.content),sha256:null,size:null},...Object.entries(envelope.files).map(([filename,file])=>({filename,bytes:Buffer.from(file.content,file.encoding==='base64'?'base64':'utf8'),sha256:file.sha256,size:file.bytes})),{filename:'LICENSE-CC0.txt',bytes:Buffer.from(envelope.license_text),sha256:envelope.provenance.license_text_sha256,size:null}];
  let downloadCount=0;page.on('download',()=>downloadCount++);const external=[];page.on('request',request=>{if(new URL(request.url()).origin!==origin)external.push(request.url())});
  await ui('#source-files-button').click();assert.equal(await ui('#source-archive-files>li').count(),expected.length);assert.match(await ui('#source-archive-files').textContent(),/Raw converter MusicXML/);assert.match(await ui('#source-archive-files').textContent(),/Compatible import copy/);assert.equal(downloadCount,0);const evidence=[];
  for(const file of expected){
    await page.getByRole('button',{name:`Inspect retained file ${file.filename}`,exact:true}).click();await ui('#source-archive-download:not([disabled])').waitFor();assert.equal(downloadCount,evidence.length,'Inspection must not start a download');
    const hash=createHash('sha256').update(file.bytes).digest('hex');assert.equal(await ui('#source-computed-hash').textContent(),hash);assert.equal(await ui('#source-declared-hash').textContent(),file.sha256||'Not supplied');assert.match(await ui('#source-hash-status').textContent(),file.sha256?/matches the declaration/:/Unknown: no declared/);assert.match(await ui('#source-size-status').textContent(),file.size===null?/Unknown: no declared/:/matches the declaration/);assert.equal(await ui('#source-mismatch-note').isVisible(),false);
    if(file.filename==='converter.musicxml'){assert.ok(file.bytes.includes(Buffer.from('<!DOCTYPE')));assert.equal(await ui('#source-archive-role').textContent(),'Raw converter MusicXML');await page.screenshot({path:join(artifactDirectory,'worldmusichub-live-cc0-d768-retained-files.png'),fullPage:true});}
    const promise=page.waitForEvent('download');await ui('#source-archive-download').click();const downloaded=await promise;assert.equal(await downloaded.failure(),null);assert.equal(downloaded.suggestedFilename(),file.filename);assert.deepEqual(await readFile(await downloaded.path()),file.bytes);evidence.push({filename:file.filename,bytes:file.bytes.length,computed_sha256:hash,declared_sha256:file.sha256,declared_bytes:file.size});
  }
  assert.deepEqual(external,[]);await ui('#source-archive-close').click();assert.deepEqual(await exportScore(),edition);await writeFile(join(artifactDirectory,'worldmusichub-live-cc0-d768-source-files.json'),JSON.stringify({score_id:edition.id,files:evidence,canonical_score_unchanged:true},null,2));
});

test('complete D768 browser library backup and restore preserve sources while guitar recovery requires an explicit suitable range', {timeout:60_000},async()=>{
  const edition=JSON.parse(await readFile(join(root,'catalog/editions/cc0-schubert-wandrers-nachtlied-d768/score.json'),'utf8')),voice=edition.parts.find(part=>part.instrument==='Voice');
  await ui(`[data-score-id="${edition.id}"]`).click();await activateCatalogTitle(edition.title);await ui('#library-button').click();await page.waitForFunction(()=>document.querySelector('#library-status').textContent.startsWith('Ready.'));assert.equal(await ui('#library-list>li').count(),0);
  await ui('#library-label').fill('Complete D768 archive');await ui('#library-save-copy').click();await page.waitForFunction(()=>document.querySelector('#library-status').textContent.startsWith('Saved'));const originalKey=await ui('#library-list>li').getAttribute('data-library-key');
  const backupPromise=page.waitForEvent('download');await ui('#library-export-backup').click();const backupBytes=await readFile(await(await backupPromise).path()),backup=JSON.parse(backupBytes);assert.equal(backup.entries.length,1);assert.deepEqual(backup.entries[0].score,edition);assert.equal(backup.entries[0].score.source.content,edition.source.content);
  await ui('#library-close').click();await reloadStage();await readyForTitle(initialCompilation.score.title);await ui('#library-button').click();await page.getByRole('button',{name:'Open saved copy Complete D768 archive',exact:true}).click();await ui('#score-library').waitFor({state:'hidden'});await readyForTitle(edition.title);assert.deepEqual(await exportScore(),edition);
  await ui('#library-button').click();await page.waitForFunction(()=>document.querySelector('#library-status').textContent.startsWith('Ready.'));await ui('#library-backup-file').setInputFiles({name:'d768-backup.json',mimeType:'application/json',buffer:backupBytes});await page.waitForFunction(()=>document.querySelector('#library-status').textContent.startsWith('Restored 1 new copies'));assert.equal(await ui('#library-list>li').count(),2);const keys=await ui('#library-list>li').evaluateAll(rows=>rows.map(row=>row.dataset.libraryKey));assert.ok(keys.includes(originalKey));assert.equal(new Set(keys).size,2);const restoredKey=keys.find(key=>key!==originalKey);
  await page.screenshot({path:join(artifactDirectory,'worldmusichub-live-cc0-d768-library.png'),fullPage:true});await ui(`[data-library-key="${restoredKey}"] [data-library-open]`).click();await ui('#score-library').waitFor({state:'hidden'});await readyForTitle(edition.title);assert.deepEqual(await exportScore(),edition);
  await ui('#instrument').selectOption('guitar');await setSessionMode('practice');await page.waitForFunction(()=>document.querySelector('#practice-gate-reason').textContent.includes('Selected notes outside this instrument range:'));assert.equal(await ui('#play-button').isDisabled(),true);assert.equal(await ui('#assess-button').isDisabled(),true);assert.equal(await ui('#guitar-frets').inputValue(),'12');
  const [voiceResponse]=await Promise.all([nextResponse('/api/instrument-check'),selectPracticePart(voice.id)]);const voiceReport=await responseJson(voiceResponse);assert.equal(voiceReport.highest_midi,76);assert.ok(voiceReport.note_options.some(note=>note.midi===77&&!note.playable));await page.waitForFunction(()=>document.querySelector('#practice-gate-reason').textContent.includes('Selected notes outside this instrument range:'));assert.equal(await ui('#play-button').isDisabled(),true);
  await ui('#guitar-frets').fill('13');assert.match(await ui('#practice-gate-reason').textContent(),/edited|validate|Apply/);const[rangeResponse,voiceTargetResponse]=await Promise.all([nextResponse('/api/instrument-check'),nextResponse('/api/practice-targets'),ui('#instrument-apply').click()]);const rangeReport=await responseJson(rangeResponse),voicePlan=await responseJson(voiceTargetResponse);assert.equal(rangeReport.highest_midi,77);assert.ok(rangeReport.note_options.every(note=>note.playable));await ui('#play-button:not([disabled])').waitFor();assert.equal(await ui('#guitar-frets').inputValue(),'13');assert.equal(await ui('#practice-part').inputValue(),voice.id);assert.match(await ui('#instrument-diagnostics').textContent(),/fingering|pitch|duration|technique/i);assert.deepEqual(await exportScore(),edition,'An explicit playable voice range does not transpose, fold or remove any original part');
  await hideNotation();await page.waitForFunction(()=>document.querySelector('#guitar-guidance-state').textContent.includes('next onset'));assert.equal(await page.locator('dialog[open]').count(),0);assert.equal(await page.locator('#guitar-guidance').isVisible(),true);assert.equal(await page.locator('#stage-cue').isVisible(),true);const firstVoice=voicePlan.timeline.notes[0];assert.ok(firstVoice.start_ms>4000);assert.equal(await page.locator('.guitar-target').count(),voicePlan.timeline.notes.filter(note=>note.start_ms===firstVoice.start_ms).length,'The complete next onset remains available through a long rest; its true countdown is preserved');assert.ok((await page.locator('#guitar-guidance-state').textContent()).includes((firstVoice.start_ms/1000).toFixed(1)+'s'));assert.equal(voicePlan.source_note_count,voicePlan.target_count);assert.ok(voicePlan.groups.every(group=>group.part_ids.every(id=>id===voice.id)));await page.screenshot({path:join(artifactDirectory,'worldmusichub-live-cc0-d768-guitar-voice.png'),fullPage:true});await selectPracticePart('');await page.waitForFunction(()=>document.querySelector('#practice-gate-reason').textContent.includes('Selected notes outside this instrument range:'));assert.equal(await ui('#play-button').isDisabled(),true);await setSessionMode('listen');assert.equal(await ui('#play-button').isEnabled(),true);assert.deepEqual(await exportScore(),edition);
});

test('real Rust pitch feedback exposes independent missed targets and an extra played pitch without changing the score',testOptions,async()=>{
  assert.ok(initialCompilation.timeline.notes.every(note=>note.midi!==90));
  await setSessionMode('practice');await ui('#count-in').uncheck();await ui('#sound-button').click();await ui('#play-button:not([disabled])').waitFor();await ui('#play-button').click();await page.waitForFunction(()=>globalThis.__wmhReadPlaybackClock().positionMs>0);await ui('#keyboard .piano-key[data-midi="90"]').click();const[response]=await Promise.all([nextResponse('/api/assess'),ui('#assess-button').click()]);const assessment=await responseJson(response);await ui('#feedback-results').waitFor();assert.ok(Array.isArray(assessment.pitch_breakdown));assert.equal(assessment.hits.length,0);assert.equal(assessment.extras.length,1);assert.equal(assessment.extras[0].midi,90);assert.equal(assessment.misses.length,initialCompilation.timeline.notes.length);const extra=assessment.pitch_breakdown.find(row=>row.midi===90);assert.deepEqual(extra,{midi:90,expected:0,matched:0,missed:0,extra:1,mean_abs_error_ms:null,timing_bias_ms:null});assert.equal(await ui('#pitch-breakdown').getAttribute('open'),null);await ui('#pitch-breakdown-summary').click();assert.equal(await ui('#pitch-breakdown-body tr').count(),assessment.pitch_breakdown.length);
  for(const row of assessment.pitch_breakdown){const cells=await ui(`[data-pitch-midi="${row.midi}"] td`).allTextContents();assert.deepEqual(cells.slice(0,4),[row.expected,row.matched,row.missed,row.extra].map(String));assert.deepEqual(cells.slice(4),['—','—','No matched attacks']);}
  assert.match(await ui('#pitch-breakdown-note').textContent(),/independent unmatched attacks/);assert.match(await ui('#pitch-breakdown-note').textContent(),/manual offset.*small sample.*latency/);assert.deepEqual(await exportScore(),initialCompilation.score);const takePromise=page.waitForEvent('download');await ui('#export-takes').click();const take=JSON.parse(await readFile(await(await takePromise).path(),'utf8'));assert.deepEqual(take.passes[0].assessment.pitch_breakdown,assessment.pitch_breakdown);await page.screenshot({path:join(artifactDirectory,'worldmusichub-live-pitch-feedback.png'),fullPage:true});await writeFile(join(artifactDirectory,'worldmusichub-live-pitch-feedback.json'),JSON.stringify({score_id:initialCompilation.score.id,pitch_breakdown:assessment.pitch_breakdown,canonical_score_unchanged:true},null,2));
});

for (const fixtureName of ['original-duet', 'original-duet-standard-header']) {
  test(`MXL ${fixtureName} browser import retains archive, selected XML and warnings through downloads, JSON and library backup restore`, {timeout: 60_000}, async () => {
    const mxl = await readFile(new URL(`${fixtureName}.mxl`, fixtures)), xml = await readFile(new URL(`${fixtureName}.musicxml`, fixtures));
    const expectedHeaderCount = fixtureName === 'original-duet-standard-header' ? 1 : 0;
    const [importResponse, compileResponse] = await Promise.all([
      nextResponse('/api/import/mxl'), nextResponse('/api/compile'),
      ui('#score-file').setInputFiles({name: `${fixtureName}.mxl`, mimeType: 'application/zip', buffer: mxl}),
    ]);
    const imported = await responseJson(importResponse), compiled = await responseJson(compileResponse);
    assert.deepEqual(importResponse.request().postDataBuffer(), mxl);
    assert.deepEqual(compiled, imported);
    assertHeaderNormalization(imported, expectedHeaderCount);
    assert.equal(imported.score.source.format, 'worldmusichub-mxl-archive-v1');
    assert.equal(imported.score.source.filename, 'retained-mxl.json');
    const source = imported.score.source, envelope = JSON.parse(source.content);
    assert.equal(envelope.version, 1);
    assert.equal(envelope.selected_score_path, 'scores/duet.musicxml');
    assert.deepEqual(Buffer.from(envelope.files['original.mxl'].content, 'base64'), mxl);
    assert.equal(envelope.files['original.mxl'].bytes, mxl.length);
    assert.deepEqual(Buffer.from(envelope.files['selected.musicxml'].content), xml);
    assert.equal(envelope.files['selected.musicxml'].bytes, xml.length);
    await readyForTitle(imported.score.title);
    const firstImportCopies = await waitForBrowserImportCopies(1);
    assertAddedLibraryCopies([], firstImportCopies, [{label: null, score: compiled.score}]);
    assert.equal(await ui('#diagnostic-list>li').filter({hasText: 'musicxml_header_normalized:'}).count(), expectedHeaderCount);
    await ui('#source-files-button').click();
    assert.equal(await ui('#source-archive-files>li').count(), 3);
    assert.match(await ui('#source-archive-files').textContent(), /Original MXL archive/);
    assert.match(await ui('#source-archive-files').textContent(), /Selected MusicXML entry/);
    assert.match(await ui('#source-archive-files').textContent(), /scores\/duet.musicxml/);
    for (const [filename, bytes, hasSize] of [['retained-mxl.json', Buffer.from(source.content), false], ['original.mxl', mxl, true], ['selected.musicxml', xml, true]]) {
      await page.getByRole('button', {name: `Inspect retained file ${filename}`, exact: true}).click();
      await ui('#source-archive-download:not([disabled])').waitFor();
      assert.equal(await ui('#source-computed-hash').textContent(), createHash('sha256').update(bytes).digest('hex'));
      assert.equal(await ui('#source-declared-hash').textContent(), 'Not supplied');
      assert.match(await ui('#source-hash-status').textContent(), /Unknown: no declared/);
      assert.match(await ui('#source-size-status').textContent(), hasSize ? /matches the declaration/ : /Unknown: no declared/);
      const [downloaded] = await Promise.all([page.waitForEvent('download'), ui('#source-archive-download').click()]);
      assert.equal(await downloaded.failure(), null);
      assert.equal(downloaded.suggestedFilename(), filename);
      assert.deepEqual(await readFile(await downloaded.path()), bytes);
    }
    const screenshotName = expectedHeaderCount ? 'worldmusichub-live-mxl-standard-header-retained-files.png' : 'worldmusichub-live-mxl-retained-files.png';
    await page.screenshot({path: join(artifactDirectory, screenshotName), fullPage: true});
    await ui('#source-archive-close').click();
    const exported = await exportScore();
    assert.deepEqual(exported, imported.score);
    const [reloadedResponse] = await Promise.all([
      nextResponse('/api/compile'),
      ui('#score-file').setInputFiles({name: 'retained-mxl-score.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(exported))}),
    ]);
    const reloaded = await responseJson(reloadedResponse);
    assert.deepEqual(reloaded, compiled);
    assertHeaderNormalization(reloaded, expectedHeaderCount);
    await readyForTitle(imported.score.title);
    const importedCopies = await waitForBrowserImportCopies(2);
    assertAddedLibraryCopies(firstImportCopies, importedCopies, [{label: null, score: compiled.score}]);
    const restored = await libraryRoundtrip(compiled, 'Complete MXL archive', 'mxl-library-backup.json', importedCopies);
    assertHeaderNormalization(restored, expectedHeaderCount);
    assert.equal(restored.score.source.content, source.content);
    assert.equal(await ui('#diagnostic-list>li').filter({hasText: 'musicxml_header_normalized:'}).count(), expectedHeaderCount);
  });
}

test('real lobby preview leaves the active source and clock intact until an explicit new Start',testOptions,async()=>{
  const catalog=await rustApi('/api/catalog'),candidate=catalog.find(score=>score.id!==initialCompilation.score.id&&score.provenance.kind==='original_exercise');assert.ok(candidate);
  await ui('#count-in').uncheck();await ui('#play-button').click();await page.waitForFunction(()=>globalThis.__wmhReadPlaybackClock().positionMs>0);await page.locator('#back-to-library').click();const paused=(await page.locator('#progress').evaluate(readPlaybackClock)).positionMs;assert.ok(paused>0);assert.equal(await page.locator('#workspace').isVisible(),false);assert.match(await page.locator('#play-button').textContent(),/Play/);
  const before=requests.filter(request=>request.path==='/api/compile').length;const[previewResponse]=await Promise.all([nextResponse('/api/compile'),page.locator(`[data-score-id="${candidate.id}"]`).click()]);const preview=await responseJson(previewResponse);assert.deepEqual(preview.score,candidate);await page.locator('#start-performance:not([disabled])').waitFor();assert.equal(await page.locator('#preview-title').textContent(),candidate.title);assert.equal(await page.locator('#score-title').textContent(),initialCompilation.score.title);assert.deepEqual(await exportScore(),initialCompilation.score);assert.equal(requests.filter(request=>request.path==='/api/compile').length,before+1,'Browsing performs preview validation only');
  await closeShellPanels();await page.locator('#resume-session').click();assert.equal(await page.locator('#stage-title').textContent(),initialCompilation.score.title);await page.waitForTimeout(200);assert.equal((await page.locator('#progress').evaluate(readPlaybackClock)).positionMs,paused);assert.match(await page.locator('#play-button').textContent(),/Play/);await page.locator('#back-to-library').click();
  const[activationResponse]=await Promise.all([nextResponse('/api/compile'),startPreview({notation:false})]);assert.deepEqual((await responseJson(activationResponse)).score,candidate);assert.equal(await page.locator('#stage-title').textContent(),candidate.title);assert.equal(requests.filter(request=>request.path==='/api/compile').length,before+2,'Start recompiles through the canonical activation path');assert.deepEqual(await exportScore(),candidate);await closeShellPanels();await assertStoppedAtZero();
});

async function engravedNoteheadVisibility() {
  return page.evaluate(()=>{
    const bounds=box=>({x:box.left,y:box.top,right:box.right,bottom:box.bottom,width:Math.max(0,box.right-box.left),height:Math.max(0,box.bottom-box.top)});
    const viewport={left:0,top:0,right:innerWidth,bottom:innerHeight};
    const criteria={minimumVisibleFraction:.9,minimumVisibleWidth:4,minimumVisibleHeight:3};
    const samples=[...document.querySelectorAll('#engraved-staff .vf-notehead path')].map((note,index)=>{
      const rect=note.getBoundingClientRect(),visible={left:Math.max(rect.left,0),top:Math.max(rect.top,0),right:Math.min(rect.right,innerWidth),bottom:Math.min(rect.bottom,innerHeight)},clippingAncestors=[];
      const noteStyle=getComputedStyle(note);let painted=(noteStyle.fill!=='none'&&Number(noteStyle.fillOpacity)>0)||(noteStyle.stroke!=='none'&&Number(noteStyle.strokeOpacity)>0);
      for(let element=note;element;element=element.parentElement){
        const style=getComputedStyle(element);if(style.display==='none'||style.visibility==='hidden'||style.visibility==='collapse'||Number(style.opacity)===0)painted=false;
        // SVG groups do not establish overflow viewports; an ancestor <svg> does.
        if(element===note||element instanceof SVGElement&&!(element instanceof SVGSVGElement))continue;
        const clipX=/^(auto|scroll|hidden|clip|overlay)$/.test(style.overflowX),clipY=/^(auto|scroll|hidden|clip|overlay)$/.test(style.overflowY);if(!clipX&&!clipY)continue;
        const box=element.getBoundingClientRect(),html=element instanceof HTMLElement;
        const scaleX=html&&element.offsetWidth?box.width/element.offsetWidth:1,scaleY=html&&element.offsetHeight?box.height/element.offsetHeight:1;
        const left=box.left+(html?element.clientLeft*scaleX:0),top=box.top+(html?element.clientTop*scaleY:0);
        const clip={left,top,right:html?left+element.clientWidth*scaleX:box.right,bottom:html?top+element.clientHeight*scaleY:box.bottom};
        if(clipX){visible.left=Math.max(visible.left,clip.left);visible.right=Math.min(visible.right,clip.right);}
        if(clipY){visible.top=Math.max(visible.top,clip.top);visible.bottom=Math.min(visible.bottom,clip.bottom);}
        clippingAncestors.push({element:element.id?`#${element.id}`:`${element.localName}.${[...element.classList].join('.')}`,overflowX:style.overflowX,overflowY:style.overflowY,clip:bounds(clip)});
      }
      const visibleRect=bounds(visible),area=rect.width*rect.height,visibleFraction=area>0?visibleRect.width*visibleRect.height/area:0;
      const meaningful=painted&&visibleFraction>=criteria.minimumVisibleFraction&&visibleRect.width>=criteria.minimumVisibleWidth&&visibleRect.height>=criteria.minimumVisibleHeight;
      return{index,rect:bounds(rect),visibleRect,visibleFraction,painted,meaningful,clippingAncestorCount:clippingAncestors.length,clippingAncestors:clippingAncestors.slice(0,32)};
    });
    const rect=selector=>{const element=document.querySelector(selector);return element?bounds(element.getBoundingClientRect()):null;};
    let followToolbar=null;
    if(innerHeight<=600&&innerWidth>=651&&document.querySelector('#notation-dock .short-notation')){
      const controls=document.querySelector('.engraving-follow-controls'),style=getComputedStyle(controls);
      followToolbar={contentWidth:controls.clientWidth-parseFloat(style.paddingLeft)-parseFloat(style.paddingRight),status:rect('#engraving-follow-status'),pages:rect('.engraving-follow-controls .engraving-pages'),label:bounds(document.querySelector('#engraving-follow').closest('label').getBoundingClientRect())};
    }
    return{viewport:bounds(viewport),criteria,followToolbar,dock:rect('#notation-dock'),scroll:rect('.engraving-scroll'),noteheadCount:samples.length,meaningfullyVisibleCount:samples.filter(sample=>sample.meaningful).length,samples:samples.sort((a,b)=>Number(b.meaningful)-Number(a.meaningful)||b.visibleFraction-a.visibleFraction).slice(0,12)};
  });
}

async function viewportSnapshot(name,{requireVisibleNoteheads=false}={}) {
  await page.evaluate(async()=>{await document.fonts.ready;await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))});
  const screenshotOptions={path:join(artifactDirectory,`worldmusichub-live-${name}.png`),fullPage:false,animations:'disabled'};
  const visibility=requireVisibleNoteheads?await engravedNoteheadVisibility():null;
  if(visibility){
    await writeFile(join(artifactDirectory,`worldmusichub-live-${name}-visibility.json`),JSON.stringify(visibility,null,2));
    if(!visibility.meaningfullyVisibleCount)await page.screenshot(screenshotOptions);
    if(visibility.followToolbar){const bar=visibility.followToolbar;assert.ok(bar.status.width>=bar.contentWidth-1,'Short-landscape follow status must have a readable full-width row under either platform font');assert.ok(bar.status.y>=Math.max(bar.pages.bottom,bar.label.bottom)-1,'Follow status sits below paging and checkbox controls rather than in a narrow leftover column');}
    assert.ok(visibility.meaningfullyVisibleCount>0,`The prepared notation screenshot must show at least 90% of a real notehead (minimum 4×3 px) inside the viewport and every overflow-clipping ancestor: ${JSON.stringify(visibility)}`);
  }
  await page.screenshot(screenshotOptions);
  return visibility;
}

async function exportTakeData() {
  const [download]=await Promise.all([page.waitForEvent('download'),ui('#export-takes').click()]);
  assert.equal(await download.failure(),null);
  const data=JSON.parse(await readFile(await download.path(),'utf8'));
  await closeShellPanels();
  return data;
}

async function pausedTakeSnapshot() {
  return page.evaluate(()=>({
    title:document.querySelector('#score-title').textContent,
    stageTitle:document.querySelector('#stage-title').textContent,
    position:globalThis.__wmhReadPlaybackClock().positionMs,
    mode:document.querySelector('#session-mode').value,
    pass:document.querySelector('.performance-status').dataset.passId,
    revision:document.querySelector('.performance-status').dataset.revision,
    captured:document.querySelector('#hud-captured').textContent,
  }));
}

async function compactGeometry() {
  return page.evaluate(()=>{
    const rect=selector=>{const element=document.querySelector(selector),box=element.getBoundingClientRect();return{x:box.x,y:box.y,width:box.width,height:box.height,right:box.right,bottom:box.bottom,clientHeight:element.clientHeight,scrollHeight:element.scrollHeight}};
    return{viewport:{width:innerWidth,height:innerHeight},document:{width:document.documentElement.scrollWidth,height:document.documentElement.scrollHeight},lobby:rect('#song-lobby'),preview:rect('.song-preview'),identity:rect('.preview-identity'),title:rect('#preview-title'),credits:rect('#preview-meta'),music:rect('#preview-music-meta'),copy:{...rect('.preview-copy'),overflow:getComputedStyle(document.querySelector('.preview-copy')).overflowY,scrollTop:document.querySelector('.preview-copy').scrollTop},footer:rect('.preview-footer'),gate:rect('#preview-gate'),start:rect('#start-performance'),mod:rect('#configure-song-mod'),stage:rect('#workspace'),hud:rect('.stage-hud'),play:rect('.play-panel'),field:rect('#falling-notes'),keyboard:rect('#keyboard'),transport:rect('.transport'),hudItems:[...document.querySelectorAll('.stage-hud>button,.stage-hud>.stage-heading,.stage-hud nav>.button')].map(element=>{const box=element.getBoundingClientRect();return{id:element.id||element.className,x:box.x,right:box.right,y:box.y,bottom:box.bottom,centerY:box.y+box.height/2}})};
  });
}

function assertBoundedDocument(geometry) {
  assert.ok(geometry.document.width<=geometry.viewport.width+1&&geometry.document.height<=geometry.viewport.height+1,JSON.stringify(geometry));
}

function assertInsideViewport(rect,viewport,label) {
  assert.ok(rect.width>0&&rect.height>0&&rect.x>=-1&&rect.y>=-1&&rect.right<=viewport.width+1&&rect.bottom<=viewport.height+1,`${label}: ${JSON.stringify({rect,viewport})}`);
}

function assertPinnedPreview(geometry,viewport) {
  assertBoundedDocument(geometry);
  assert.equal(geometry.copy.overflow,'auto');
  for(const [name,label] of Object.entries({identity:'Selected score identity',title:'Selected title',credits:'Composer and source',music:'Opening musical metadata',footer:'Start footer',gate:'Compatibility reason',start:'Start performance',mod:'Mod settings'}))assertInsideViewport(geometry[name],viewport,label);
  assert.ok(geometry.identity.bottom<=geometry.copy.y+1,'Selected score identity stays above the scrollable details');
  assert.ok(geometry.footer.y>=geometry.copy.bottom-1,'Long preview text must scroll above the Start footer');
}

for(const viewport of [{width:1280,height:720},{width:1920,height:1080},{width:844,height:390},{width:390,height:844}]){
  test(`real D768 lobby and compact performance fit ${viewport.width} by ${viewport.height} with visible tools and exact source`,testOptions,async()=>{
    const edition=JSON.parse(await readFile(join(root,'catalog/editions/cc0-schubert-wandrers-nachtlied-d768/score.json'),'utf8'));
    await hideNotation();await page.setViewportSize(viewport);await ui('#theme-mode').selectOption('light');await setSessionMode('practice');await ui('#count-in').uncheck();await closeShellPanels();
    await page.locator('#play-button').click();await page.waitForFunction(()=>globalThis.__wmhReadPlaybackClock().positionMs>0);await page.locator('#stage-title').click();await page.keyboard.press('a');await page.waitForFunction(()=>document.querySelector('#hud-captured').textContent==='1');await page.locator('#back-to-library').click();await page.waitForFunction(()=>document.querySelector('.performance-status').dataset.phase!=='grace');
    const activeTake=await pausedTakeSnapshot(),takeBefore=await exportTakeData();assert.ok(activeTake.position>0);assert.ok(activeTake.pass);assert.equal(takeBefore.passes.length,1);assert.equal(takeBefore.passes[0].inputs.length,1);
    async function selectPreview(id,title) {
      const [response]=await Promise.all([nextResponse('/api/compile'),ui(`[data-score-id="${id}"]`).click()]);
      const compiled=await responseJson(response);assert.equal(compiled.score.id,id);
      await page.waitForFunction(expected=>document.querySelector('#preview-title').textContent===expected&&!document.querySelector('#configure-song-mod').disabled,title);
      if(id===edition.id){await configureSongMod(page,{performers:'all'});await page.waitForFunction(()=>document.querySelector('#preview-gate').textContent.includes('Selected notes outside this instrument range: 18.')&&document.querySelector('#preview-gate').classList.contains('preview-blocked')&&document.querySelector('#start-performance').disabled);}
      return compiled;
    }
    const preview=await selectPreview(edition.id,edition.title);assert.deepEqual(preview.score,edition);
    assert.equal(await page.locator('#preview-title').textContent(),edition.title);assert.ok((await page.locator('#preview-meta').textContent()).includes(edition.composer));
    const musicMeta=await page.locator('#preview-music-meta').textContent();assert.match(musicMeta,/^Opening: /);assert.match(musicMeta,/2 flats Mode unspecified/);assert.ok(musicMeta.includes(`${preview.score.tempo[0].bpm} BPM`));assert.ok(musicMeta.includes(`${preview.score.parts.length} parts`));
    assert.equal(await page.locator('#preview-notices').evaluate(element=>element.open),false);assert.equal(await page.locator('.preview-copy').evaluate(element=>element.scrollTop),0);
    if(viewport.width<651)await page.locator('.preview-footer').scrollIntoViewIfNeeded();
    const lobby=await compactGeometry();assertPinnedPreview(lobby,viewport);assert.equal(await page.locator('html').getAttribute('data-theme'),'light');assert.equal(await page.locator('#workspace').isVisible(),false);await viewportSnapshot(`compact-${viewport.width}x${viewport.height}-lobby`);
    await page.locator('#preview-notices-title').click();assert.ok(await page.locator('#preview-notice-list li').count()>0);assert.ok((await page.locator('#preview-notice-list').textContent()).length>300,'The retained D768 notices exercise a long preview');
    if(viewport.width<651)await page.locator('.preview-footer').scrollIntoViewIfNeeded();
    const expandedLobby=await compactGeometry();assertPinnedPreview(expandedLobby,viewport);assert.ok(expandedLobby.copy.scrollHeight>expandedLobby.copy.clientHeight,'Expanded source notices must exercise the preview detail scroller');await viewportSnapshot(`compact-${viewport.width}x${viewport.height}-lobby-notices`);
    await page.mouse.move(expandedLobby.copy.x+expandedLobby.copy.width/2,expandedLobby.copy.y+expandedLobby.copy.height/2);await page.mouse.wheel(0,expandedLobby.copy.scrollHeight);await page.waitForFunction(()=>{const copy=document.querySelector('.preview-copy');return copy.scrollTop>0&&copy.scrollTop+copy.clientHeight>=copy.scrollHeight-1});
    const scrolledLobby=await compactGeometry();assertPinnedPreview(scrolledLobby,viewport);for(const name of ['identity','title','credits','music','footer','gate','start','mod'])assert.deepEqual(scrolledLobby[name],expandedLobby[name],`${name} remains anchored while source details scroll`);assert.equal(await page.locator('#preview-music-meta').textContent(),musicMeta);await viewportSnapshot(`compact-${viewport.width}x${viewport.height}-lobby-notices-scrolled`);
    const catalog=await rustApi('/api/catalog/index'),candidate=catalog.items.find(item=>item.id!==edition.id&&item.id!==initialCompilation.score.id);assert.ok(candidate);
    await selectPreview(candidate.id,candidate.title);assert.equal(await page.locator('#preview-notices').evaluate(element=>element.open),false);assert.equal(await page.locator('.preview-copy').evaluate(element=>element.scrollTop),0);assert.deepEqual(await pausedTakeSnapshot(),activeTake,'Browsing another score preserves the paused take');
    await selectPreview(edition.id,edition.title);assert.equal(await page.locator('#preview-notices').evaluate(element=>element.open),false);assert.equal(await page.locator('.preview-copy').evaluate(element=>element.scrollTop),0);assert.equal(await page.locator('#preview-music-meta').textContent(),musicMeta);assert.deepEqual(await pausedTakeSnapshot(),activeTake,'Returning to D768 preserves the paused take');assert.deepEqual(await exportTakeData(),takeBefore,'Preview details, scrolling and catalog swaps preserve every captured input and clock segment');
    if(viewport.width>=1280){await ui('#theme-mode').selectOption('dark');await closeShellPanels();assert.equal(await page.locator('html').getAttribute('data-theme'),'dark');assertPinnedPreview(await compactGeometry(),viewport);await viewportSnapshot(`compact-${viewport.width}x${viewport.height}-lobby-dark`);await ui('#theme-mode').selectOption('light');await closeShellPanels();assert.equal(await page.locator('html').getAttribute('data-theme'),'light');}
    assert.deepEqual(await exportScore(),initialCompilation.score);await closeShellPanels();
    await startPreview({notation:false});assert.equal(await page.locator('#stage-title').textContent(),edition.title);assert.equal(await page.locator('.shell-header').isVisible(),false);assert.equal(await page.locator('#notation-dock').isVisible(),false);assert.equal(await page.locator('#stage-cue-main').textContent(),'READY');
    const stage=await compactGeometry();assertBoundedDocument(stage);assertInsideViewport(stage.stage,viewport,'Performance stage');assertInsideViewport(stage.play,viewport,'Playfield and transport');assertInsideViewport(stage.transport,viewport,'Transport');assert.ok(stage.stage.scrollHeight<=stage.stage.clientHeight+1,'The stage must not become a scrolling dashboard');assert.ok(stage.play.scrollHeight<=stage.play.clientHeight+1,'Playfield and transport must fit without panel scrolling');assert.ok(stage.field.height>=viewport.height*(viewport.width>=1280?.5:.32),`The musical field needs substantial vertical space: ${JSON.stringify(stage.field)}`);
    if(viewport.width>=1280){const centers=stage.hudItems.map(item=>item.centerY);assert.ok(Math.max(...centers)-Math.min(...centers)<=2,`Desktop tools and title share one HUD row: ${JSON.stringify(stage.hudItems)}`);assert.ok(stage.hud.height<=70,JSON.stringify(stage.hud));}
    for(const item of stage.hudItems)assert.ok(item.x>=-1&&item.right<=viewport.width+1,`HUD control stays reachable: ${JSON.stringify(item)}`);
    for(const id of ['midi-button','count-in','keyboard-base-midi','keyboard-input-offset','keyboard-preset']){assert.equal(await page.locator(`#${id}`).count(),1);assert.equal(await page.locator(`#settings-dialog #${id}`).count(),1);assert.equal(await page.locator(`#${id}`).isVisible(),false);}
    assert.equal(await page.locator('#piano-stage .piano-stage-toolbar #sound-button').count(),1);assert.equal(await page.locator('#sound-button').isVisible(),true);assert.match(await page.locator('#keyboard-range-context').textContent(),/61 keys/);await viewportSnapshot(`compact-${viewport.width}x${viewport.height}-stage`);
    if(viewport.width>=1280){await ui('#theme-mode').selectOption('dark');await closeShellPanels();assert.equal(await page.locator('html').getAttribute('data-theme'),'dark');const darkStage=await compactGeometry();assertBoundedDocument(darkStage);assertInsideViewport(darkStage.transport,viewport,'Dark transport');assert.ok(darkStage.field.height>=viewport.height*.5);await viewportSnapshot(`compact-${viewport.width}x${viewport.height}-stage-dark`);await ui('#theme-mode').selectOption('light');await closeShellPanels();assert.equal(await page.locator('html').getAttribute('data-theme'),'light');}
    const keyboardRange=await page.locator('#piano-scroll').evaluate(element=>({left:element.scrollLeft,width:element.clientWidth,total:element.scrollWidth}));
    if(keyboardRange.total>keyboardRange.width+1){const direction=await page.locator('#keyboard-pan-right').isEnabled()?'right':'left';await page.locator(`#keyboard-pan-${direction}`).click();await page.waitForFunction(previous=>Math.abs(document.querySelector('#piano-scroll').scrollLeft-previous)>1,keyboardRange.left);assert.equal(await page.locator('#keyboard .piano-key').count(),61,'Panning never truncates the configured keyboard');}
    for(const name of ['settings','score-tools','import-tools','results']){await page.locator(`#${name}-button`).click();await page.locator(`#${name}-dialog`).waitFor();if(name==='settings')for(const id of ['midi-button','count-in','keyboard-base-midi','keyboard-input-offset','keyboard-preset'])assert.equal(await page.locator(`#${id}`).isVisible(),true);await page.locator(`#${name}-dialog [data-close-panel]`).click();}
    await page.locator('#library-button').click();await page.locator('#score-library').waitFor();await page.locator('#library-close').click();
    await page.locator('#notation-toggle').click();await waitForEngraving();assert.ok(await page.locator('#engraved-staff svg').count()>0);assert.ok(await page.locator('#engraved-staff .vf-notehead path').count()>0,'Compact headers retain the actual generated notes');
    const svgText=(await page.locator('#engraved-staff svg text').allTextContents()).join(' ').replace(/\s+/g,' ');assert.equal(svgText.includes('Wandrers Nachtlied'),false,'The dock must not repeat the score title');assert.equal(svgText.includes(edition.composer),false,'The dock must not repeat the composer');assert.equal(await page.locator('#stage-title').textContent(),edition.title);
    await revealControl(page.locator('#engraving-follow'));assert.match(await page.locator('#engraving-range').textContent(),/Measures 1–8 \/ 14/);assert.equal(await page.locator('#engraving-follow').isVisible(),true);assert.equal(await page.locator('#engraving-follow-status').isVisible(),true);assert.equal(await page.locator('#engraving-follow').isChecked(),true);await page.waitForFunction(()=>document.querySelector('#engraving-follow-status').textContent.includes('Paused at written measure'));
    for(const selector of ['#engraving-range','#engraving-follow-status']){const bounds=await page.locator(selector).boundingBox();assertInsideViewport({...bounds,right:bounds.x+bounds.width,bottom:bounds.y+bounds.height},viewport,`Visible notation state ${selector}`);}
    const help=await page.locator('#engraving-follow-help').evaluate(element=>({inDetails:Boolean(element.closest('details')),open:element.closest('details')?.open}));assert.deepEqual(help,{inDetails:true,open:false});assert.equal(await page.locator('#dock-warning-count').isVisible(),true);assert.match(await page.locator('#dock-warning-count').textContent(),/Notation notices.*\d/);
    if(viewport.height<=600&&viewport.width>=651){assert.equal(await page.locator('#engraving-part').isVisible(),false);await page.locator('.dock-help>summary').click();assert.equal(await page.locator('#engraving-part').isVisible(),true);assert.equal(await page.locator('#engraving-page-size').isVisible(),true);await page.locator('.dock-help>summary').click();assert.equal(await page.locator('#engraving-part').isVisible(),false);assert.equal(await page.locator('#engraving-range').isVisible(),true);}
    const notationVisibility=await viewportSnapshot(`compact-${viewport.width}x${viewport.height}-notation`,{requireVisibleNoteheads:true});
    assert.deepEqual(await exportScore(),edition,'Viewport, panning, compact notation and tools preserve every canonical event and retained source byte');await closeShellPanels();await assertStoppedAtZero();
    await writeFile(join(artifactDirectory,`worldmusichub-live-compact-${viewport.width}x${viewport.height}.json`),JSON.stringify({viewport,score_id:edition.id,music_meta:musicMeta,lobby,expandedLobby,scrolledLobby,stage,notationVisibility,paused_take_unchanged:true,canonical_score_unchanged:true},null,2));
  });
}

test('real Rust HUD shows a checked pass snapshot and hides it across resume and the full delayed-input tail',testOptions,async()=>{
  await hideNotation();assert.ok(initialCompilation.timeline.notes.every(note=>note.midi!==90));await setSessionMode('practice');await ui('#count-in').uncheck();await ui('.practice-options>summary').click();await ui('#latency-offset').fill('500');await ui('#latency-offset').dispatchEvent('change');await closeShellPanels();
  assert.equal(await page.locator('#hud-result').isVisible(),false);await page.locator('#play-button').click();await page.waitForFunction(()=>globalThis.__wmhReadPlaybackClock().positionMs>600);await page.locator('#keyboard .piano-key[data-midi="90"]').click();await page.waitForFunction(()=>document.querySelector('#hud-captured').textContent==='1'&&document.querySelector('.performance-status').dataset.phase==='capturing');
  const captured=await page.locator('.performance-status').evaluate(element=>({pass:element.dataset.passId,revision:element.dataset.revision}));assert.ok(captured.pass);assert.equal(await page.locator('#hud-result').isVisible(),false);
  const assessedResponse=nextResponse('/api/assess');await ui('#assess-button').click();await page.waitForFunction(()=>document.querySelector('.performance-status').dataset.phase==='grace');assert.equal(await page.locator('#hud-result').isVisible(),false);await closeShellPanels();const response=await assessedResponse,assessment=await responseJson(response);assert.equal(assessment.hits.length,0);assert.equal(assessment.extras.length,1);assert.equal(assessment.extras[0].midi,90);assert.equal(assessment.misses.length,initialCompilation.timeline.notes.length);assert.equal(response.request().postDataJSON().inputs.length,1);
  await page.waitForFunction(()=>document.querySelector('.performance-status').dataset.phase==='assessed');assert.match(await page.locator('#hud-label').textContent(),/Previous check/);assert.equal(await page.locator('#hud-accuracy').textContent(),'0%');assert.equal(await page.locator('#hud-result').isVisible(),true);assert.match(await page.locator('#hud-result').textContent(),/Onset match rate/);assert.equal(await page.locator('.performance-status').getAttribute('data-pass-id'),captured.pass);assert.equal(await page.locator('.performance-status').getAttribute('data-revision'),captured.revision);await viewportSnapshot('hud-previous-rust-check');
  const resumedFrom=(await page.locator('#progress').evaluate(readPlaybackClock)).positionMs;
  await page.locator('#play-button').click();await page.waitForFunction(()=>document.querySelector('.performance-status').dataset.phase==='capturing');assert.equal(await page.locator('#hud-result').isVisible(),false);
  await waitForPlaybackClockAdvance(page,resumedFrom);
  // This observer only reads visible HUD mutations. Its measured grace interval
  // allows one animation frame around the recorder's exact 500 + 180 ms deadline.
  const observation=page.evaluate(()=>new Promise(resolve=>{const hud=document.querySelector('.performance-status'),result=document.querySelector('#hud-result'),samples=[];let graceStart=null;const observer=new MutationObserver(()=>{const phase=hud.dataset.phase,now=performance.now();if(phase==='grace'&&graceStart===null)graceStart=now;if(graceStart!==null)samples.push({elapsed:now-graceStart,phase,resultHidden:result.hidden,pass:hud.dataset.passId,revision:hud.dataset.revision});if(graceStart!==null&&phase==='assessed'){observer.disconnect();resolve(samples)}});observer.observe(hud,{attributes:true,subtree:true,childList:true,characterData:true})}));
  const[samples]=await Promise.all([observation,(async()=>{await page.locator('#play-button').click();await page.waitForFunction(()=>document.querySelector('.performance-status').dataset.phase==='grace');assert.equal(await page.locator('#hud-result').isVisible(),false);await viewportSnapshot('hud-delayed-input-tail')})()]);assert.ok(samples.some(sample=>sample.phase==='grace'));assert.ok(samples.filter(sample=>sample.phase==='grace').every(sample=>sample.resultHidden),'A previous Rust rate must remain hidden throughout delayed-input grace');assert.ok(samples.at(-1).elapsed>=650,`The 680 ms tail must not collapse into an ordinary pause: ${JSON.stringify(samples)}`);assert.ok(samples.every(sample=>sample.pass===captured.pass&&sample.revision===captured.revision));assert.equal(await page.locator('#hud-accuracy').textContent(),'0%');assert.equal(await page.locator('#hud-result').isVisible(),true);
  const takeDownload=page.waitForEvent('download');await ui('#export-takes').click();const exported=JSON.parse(await readFile(await(await takeDownload).path(),'utf8'));assert.equal(exported.latency_ms,500);assert.equal(exported.tolerance_ms,180);assert.equal(exported.passes.length,1);assert.equal(exported.passes[0].inputs.length,1);assert.equal(exported.passes[0].clock_segments.length,2);assert.deepEqual(exported.passes[0].assessment,assessment);assert.deepEqual(await exportScore(),initialCompilation.score);await writeFile(join(artifactDirectory,'worldmusichub-live-hud-snapshot-grace.json'),JSON.stringify({captured,assessment,samples,latency_ms:500,tolerance_ms:180,canonical_score_unchanged:true},null,2));
});

async function guitarGuidanceCards() {
  return page.locator('.guitar-target').evaluateAll(cards=>cards.map(card=>({id:card.dataset.targetId,start_ms:Number(card.dataset.startMs),duration_ms:Number(card.dataset.durationMs),sourceIds:JSON.parse(card.dataset.sourceIds),occurrenceIds:JSON.parse(card.dataset.occurrenceIds),phase:card.dataset.phase,pitch:card.querySelector('.guitar-target-pitch').textContent,time:card.querySelector('.guitar-target-time').textContent})));
}
function assertGuitarGuidancePlan(cards,plan) {
  assert.ok(cards.length>0);assert.equal(new Set(cards.map(card=>card.id)).size,cards.length);
  for(const card of cards){const note=plan.timeline.notes.find(note=>note.id===card.id),group=plan.groups.find(group=>group.target_id===card.id);assert.ok(note&&group,card.id);assert.equal(card.start_ms,note.start_ms);assert.equal(card.duration_ms,note.duration_ms);assert.deepEqual(card.sourceIds,group.source_note_ids);assert.deepEqual(card.occurrenceIds,group.source_occurrence_ids);}
}

async function simultaneousStageGeometry(){
  if(await page.locator('#notation-tools').isVisible()&&await page.locator('#notation-tools').evaluate(node=>node.open))await page.locator('#notation-tools>summary').click();
  return page.evaluate(()=>{
    const rect=selector=>{const e=document.querySelector(selector),r=e.getBoundingClientRect();return{x:r.x,y:r.y,right:r.right,bottom:r.bottom,width:r.width,height:r.height,clientHeight:e.clientHeight,scrollHeight:e.scrollHeight,clientWidth:e.clientWidth,scrollWidth:e.scrollWidth}};
    const visibleBox=element=>{const r=element.getBoundingClientRect(),v={x:Math.max(0,r.x),y:Math.max(0,r.y),right:Math.min(innerWidth,r.right),bottom:Math.min(innerHeight,r.bottom)};let painted=true;for(let parent=element;parent;parent=parent.parentElement){const style=getComputedStyle(parent);if(style.display==='none'||style.visibility==='hidden'||Number(style.opacity)===0)painted=false;if(parent===element)continue;const p=parent.getBoundingClientRect(),left=p.left+parent.clientLeft,top=p.top+parent.clientTop;if(/^(auto|scroll|hidden|clip|overlay)$/.test(style.overflowX)){v.x=Math.max(v.x,left);v.right=Math.min(v.right,left+parent.clientWidth)}if(/^(auto|scroll|hidden|clip|overlay)$/.test(style.overflowY)){v.y=Math.max(v.y,top);v.bottom=Math.min(v.bottom,top+parent.clientHeight)}}return{...v,width:Math.max(0,v.right-v.x),height:Math.max(0,v.bottom-v.y),painted}};
    const key=[...new Set([...document.querySelectorAll('#keyboard .piano-key.playing:not(.black)'),...document.querySelectorAll('#keyboard .piano-key:not(.black)')])].find(e=>{const r=e.getBoundingClientRect(),s=document.querySelector('#piano-scroll').getBoundingClientRect(),x=r.x+r.width/2,y=r.bottom-8;return r.left>=s.left&&r.right<=s.right&&document.elementFromPoint(x,y)?.closest('.piano-key')===e});
    let visibleKey=null;if(key){const r=key.getBoundingClientRect();visibleKey={midi:Number(key.dataset.midi),playing:key.classList.contains('playing'),label:key.getAttribute('aria-label'),x:r.x,y:r.y,right:r.right,bottom:r.bottom,width:r.width,height:r.height,lowerHit:document.elementFromPoint(r.x+r.width/2,r.bottom-8)?.closest('.piano-key')===key}}
    const displayChain=[];for(let node=document.querySelector('.performance-field');node;node=node.parentElement){const css=getComputedStyle(node),r=node.getBoundingClientRect();displayChain.push({id:node.id,className:node.className,hidden:node.hidden,display:css.display,visibility:css.visibility,height:css.height,minHeight:css.minHeight,overflow:css.overflow,rect:{x:r.x,y:r.y,width:r.width,height:r.height}});}
    return{displayChain,above:document.querySelector('#workspace').classList.contains('notation-above'),overlay:document.querySelector('#notation-lane-overlay')?rect('#notation-lane-overlay'):null,overlayInLane:Boolean(document.querySelector('#notation-lane-overlay')?.closest('.piano-lanes-shared')),panVisible:!document.querySelector('.keyboard-pan').hidden,panInTransport:document.querySelector('.keyboard-pan').parentElement===document.querySelector('.transport'),panControls:['#keyboard-pan-left','#keyboard-pan-right'].map(selector=>{const e=document.querySelector(selector),r=e.getBoundingClientRect(),hit=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2);return{selector,x:r.x,y:r.y,right:r.right,bottom:r.bottom,width:r.width,height:r.height,reachable:e===hit||e.contains(hit)}}),keyboard:rect('#keyboard'),strike:rect('.strike-line'),viewport:{width:innerWidth,height:innerHeight},document:{width:document.documentElement.scrollWidth,height:document.documentElement.scrollHeight},stage:rect('#workspace'),play:rect('.play-panel'),field:rect('.performance-field'),canvas:rect('#falling-notes'),canvasVisible:visibleBox(document.querySelector('#falling-notes')),piano:rect('#piano-scroll'),pan:rect('.keyboard-pan'),transport:rect('.transport'),dock:rect('#notation-dock'),visibleKey,transportControls:['#reset-button','#play-button','#sound-button'].map(selector=>{const e=document.querySelector(selector),r=e.getBoundingClientRect(),hit=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2);return{selector,x:r.x,y:r.y,right:r.right,bottom:r.bottom,width:r.width,height:r.height,reachable:e===hit||e.contains(hit)}})};
  });
}
function assertSimultaneousPiano(geometry){
  const {viewport}=geometry;assertBoundedDocument(geometry);
  for(const name of ['stage','play','field','piano',...(geometry.panVisible?['pan']:[]),'transport',...(!geometry.overlayInLane?['dock']:[])])assertInsideViewport(geometry[name],viewport,`Simultaneous ${name}`);
  assert.ok(geometry.stage.scrollHeight<=geometry.stage.clientHeight+1,'Active performance never becomes a scrolling page');assert.ok(geometry.play.scrollHeight<=geometry.play.clientHeight+1,'Instrument and transport remain bounded inside the play panel');
  if(geometry.overlayInLane){
    assert.equal(geometry.above,false,'Piano notation must not return to a detached above-band');
    assert.ok(geometry.overlay,'The actual paint root is present');
    const overlapWidth=Math.min(geometry.overlay.right,geometry.canvas.right)-Math.max(geometry.overlay.x,geometry.canvas.x),overlapHeight=Math.min(geometry.overlay.bottom,geometry.canvas.bottom)-Math.max(geometry.overlay.y,geometry.canvas.y);
    assert.ok(overlapWidth>=250&&overlapHeight>=100,'Staff/Jianpu physically share the falling-lane background');
  }else assert.ok(geometry.play.right<=geometry.dock.x+1,'Non-overlay notation and game keep separate visible columns');
  assert.equal(geometry.canvasVisible.painted,true);assert.ok(geometry.canvasVisible.height>=100&&geometry.canvasVisible.width>=250,'Falling notes retain their complete readable field');
  for(const surface of [geometry.keyboard,geometry.strike]){assert.ok(Math.abs(surface.x-geometry.canvas.x)<1&&Math.abs(surface.width-geometry.canvas.width)<1,'Falling notes, strike and keys share one horizontal coordinate surface');}assert.ok(Math.abs(geometry.canvas.bottom-geometry.strike.y)<1&&Math.abs(geometry.strike.bottom-geometry.keyboard.y)<1,'The strike line stays exactly between notes and keys');
  if(geometry.panVisible){assert.ok(geometry.piano.bottom<=geometry.pan.y+1,'Pan controls remain below the current keyboard');if(geometry.panInTransport){assert.ok(geometry.pan.y>=geometry.transport.y-1&&geometry.pan.bottom<=geometry.transport.bottom+1,'Compact pan controls fit in the transport row');}else assert.ok(geometry.pan.bottom<=geometry.transport.y+1,'Tall-stage pan controls stay above transport');for(const control of geometry.panControls){assertInsideViewport(control,viewport,control.selector);assert.ok(control.width>=40&&control.height>=34,'Pan controls retain full hit targets');assert.equal(control.reachable,true);}}else{assert.ok(geometry.piano.scrollWidth<=geometry.piano.clientWidth+1,'Pan controls may disappear only when the complete key range fits');assert.ok(geometry.piano.bottom<=geometry.transport.y+1);}assert.ok(geometry.visibleKey,'A current visible key must remain reachable');assertInsideViewport(geometry.visibleKey,viewport,'Visible piano key');assert.ok(geometry.visibleKey.height>=70);assert.equal(geometry.visibleKey.lowerHit,true);
  for(const control of geometry.transportControls){assertInsideViewport(control,viewport,control.selector);assert.equal(control.reachable,true,`${control.selector} is not covered by the notation dock`)}
}
for(const viewport of [{width:1280,height:720},{width:844,height:390}]){
  test(`real game, staff and current piano keybed stay visible together at ${viewport.width} by ${viewport.height}`,{timeout:60_000},async()=>{
    await hideNotation();await page.setViewportSize(viewport);await page.emulateMedia({reducedMotion:'reduce'});await setSessionMode('practice');await ui('#count-in').uncheck();await closeShellPanels();
    await page.locator('#play-button').click();await page.waitForFunction(()=>globalThis.__wmhReadPlaybackClock().positionMs>0);await page.locator('#stage-title').click();await page.keyboard.press('a');await page.waitForFunction(()=>document.querySelector('#hud-captured').textContent==='1');await page.locator('#play-button').click();await page.waitForFunction(()=>document.querySelector('.performance-status').dataset.phase!=='grace');const take=await exportTakeData(),position=(await page.locator('#progress').evaluate(readPlaybackClock)).positionMs;
    const toggle=page.locator('#notation-toggle');await toggle.focus();await page.keyboard.press('Space');await waitForEngraving();assert.equal(await page.evaluate(()=>document.activeElement?.id),'notation-toggle','Opening notation does not steal keyboard focus');assert.equal(await toggle.getAttribute('aria-expanded'),'true');
    const geometry=await simultaneousStageGeometry();assertSimultaneousPiano(geometry);assert.equal(await page.locator('#falling-notes').isVisible(),true);assert.equal(await page.locator('#piano-stage').isVisible(),true);assert.equal(await page.locator('#keyboard .piano-key').count(),61);const notation=await viewportSnapshot(`simultaneous-${viewport.width}x${viewport.height}-staff`,{requireVisibleNoteheads:true});
    if(geometry.panVisible){const beforePan=await page.locator('#piano-scroll').evaluate(e=>e.scrollLeft),direction=await page.locator('#keyboard-pan-right').isEnabled()?'right':'left';await page.locator(`#keyboard-pan-${direction}`).click();await page.waitForFunction(previous=>Math.abs(document.querySelector('#piano-scroll').scrollLeft-previous)>1,beforePan);}assertSimultaneousPiano(await simultaneousStageGeometry());
    await ui('#jianpu-button').click();assert.equal(await page.locator('#notation .jianpu-note').count()>0,true);assert.equal(await page.locator('#falling-notes').isVisible(),true);assertSimultaneousPiano(await simultaneousStageGeometry());await viewportSnapshot(`simultaneous-${viewport.width}x${viewport.height}-jianpu`);
    await ui('#engraved-button').click();await waitForEngraving();await page.locator('#settings-button').click();assert.equal(await page.locator('#settings-dialog').evaluate(e=>e.matches(':modal')),true);await page.keyboard.press('Tab');assert.equal(await page.evaluate(()=>document.activeElement?.closest('dialog')?.id),'settings-dialog');await page.locator('#settings-dialog [data-close-panel]').click();assertSimultaneousPiano(await simultaneousStageGeometry());
    await toggle.focus();await page.keyboard.press('Space');assert.equal(await page.locator('#notation-dock').isVisible(),false);assert.equal(await page.locator('#falling-notes').isVisible(),true);await page.keyboard.press('Space');await waitForEngraving();assertSimultaneousPiano(await simultaneousStageGeometry());
    assert.equal((await page.locator('#progress').evaluate(readPlaybackClock)).positionMs,position);assert.deepEqual(await exportTakeData(),take,'Notation modes, keyboard panning and panels preserve the complete paused take');assert.deepEqual(await exportScore(),initialCompilation.score);await writeFile(join(artifactDirectory,`worldmusichub-live-simultaneous-${viewport.width}x${viewport.height}.json`),JSON.stringify({geometry,notation,paused_take_unchanged:true},null,2));
  });
}

test('real short-landscape guitar keeps a complete labelled row and transport beside notation',testOptions,async()=>{
  await hideNotation();await page.setViewportSize({width:844,height:390});await page.emulateMedia({reducedMotion:'reduce'});await ui('#instrument').selectOption('guitar');await setSessionMode('practice');await ui('#play-button:not([disabled])').waitFor();await closeShellPanels();await page.locator('#notation-toggle').click();await waitForEngraving();
  const geometry=await page.evaluate(()=>{const rect=selector=>{const e=document.querySelector(selector),r=e.getBoundingClientRect();return{x:r.x,y:r.y,right:r.right,bottom:r.bottom,width:r.width,height:r.height,clientHeight:e.clientHeight,scrollHeight:e.scrollHeight}};return{viewport:{width:innerWidth,height:innerHeight},document:{width:document.documentElement.scrollWidth,height:document.documentElement.scrollHeight},stage:rect('#workspace'),play:rect('.play-panel'),field:rect('.performance-field'),dock:rect('#notation-dock'),guidance:rect('#guitar-guidance'),scroll:rect('.guitar-scroll'),transport:rect('.transport')}});
  assertBoundedDocument(geometry);for(const name of ['stage','play','field','dock','guidance','scroll','transport'])assertInsideViewport(geometry[name],geometry.viewport,name);assert.ok(geometry.play.right<=geometry.dock.x+1);assert.ok(geometry.scroll.height>=56,'The fret labels and a full playable row remain visible while notation is open');assert.ok(geometry.guidance.bottom<=geometry.scroll.y+1);assert.ok(geometry.scroll.bottom<=geometry.transport.y+1);assert.ok(geometry.stage.scrollHeight<=geometry.stage.clientHeight+1);assert.ok(geometry.play.scrollHeight<=geometry.play.clientHeight+1);
  const firstVisible=await guitarFretVisibility('.fret-button[data-string="0"][data-fret="0"]');assertWholeGuitarFret(firstVisible,'First guitar row beside notation');const notation=await viewportSnapshot('simultaneous-844x390-guitar',{requireVisibleNoteheads:true});
  const last=page.locator('.fret-button[data-string="5"][data-fret="12"]');await last.focus();assertWholeGuitarFret(await guitarFretVisibility('.fret-button[data-string="5"][data-fret="12"]'),'Focused last guitar row beside notation');assert.equal(await page.locator('#notation-dock').isVisible(),true);assert.match(await page.locator('#play-button').textContent(),/Play/);assert.deepEqual(await exportScore(),initialCompilation.score);await writeFile(join(artifactDirectory,'worldmusichub-live-simultaneous-844x390-guitar.json'),JSON.stringify({geometry,firstVisible,notation},null,2));
});

async function guitarFretVisibility(selector) {
  return page.locator(selector).evaluate(element=>{
    const bounds=r=>({x:r.left,y:r.top,right:r.right,bottom:r.bottom,width:Math.max(0,r.right-r.left),height:Math.max(0,r.bottom-r.top)}),box=element.getBoundingClientRect();
    const visible={left:Math.max(0,box.left),top:Math.max(0,box.top),right:Math.min(innerWidth,box.right),bottom:Math.min(innerHeight,box.bottom)},clippingAncestors=[];
    let painted=true;
    for(let parent=element;parent;parent=parent.parentElement){
      const style=getComputedStyle(parent);if(style.display==='none'||style.visibility==='hidden'||style.visibility==='collapse'||Number(style.opacity)===0)painted=false;
      if(parent===element)continue;
      const clipX=/^(auto|scroll|hidden|clip|overlay)$/.test(style.overflowX),clipY=/^(auto|scroll|hidden|clip|overlay)$/.test(style.overflowY);if(!clipX&&!clipY)continue;
      const r=parent.getBoundingClientRect(),left=r.left+parent.clientLeft,top=r.top+parent.clientTop,clip={left,top,right:left+parent.clientWidth,bottom:top+parent.clientHeight};
      if(clipX){visible.left=Math.max(visible.left,clip.left);visible.right=Math.min(visible.right,clip.right)}
      if(clipY){visible.top=Math.max(visible.top,clip.top);visible.bottom=Math.min(visible.bottom,clip.bottom)}
      clippingAncestors.push({element:parent.id||parent.className,clip:bounds(clip)});
    }
    const visibleRect=bounds(visible),rect=bounds(box),visibleFraction=rect.width*rect.height?visibleRect.width*visibleRect.height/(rect.width*rect.height):0;
    const centerHit=visibleRect.width>0&&visibleRect.height>0&&document.elementFromPoint(visibleRect.x+visibleRect.width/2,visibleRect.y+visibleRect.height/2)?.closest('.fret-button')===element;
    return{rect,visibleRect,visibleFraction,painted,centerHit,clippingAncestors};
  });
}
function assertWholeGuitarFret(visibility,label) {
  assert.ok(visibility.painted&&visibility.centerHit&&visibility.visibleFraction>=.98&&visibility.visibleRect.height>=visibility.rect.height-1&&visibility.visibleRect.width>=visibility.rect.width-1,`${label} must remain visible through every clipping ancestor and reachable at its center: ${JSON.stringify(visibility)}`);
}

test('real Rust guitar guide keeps fractional and repeated tie targets separate, and freezes countdowns through pause',testOptions,async()=>{
  await hideNotation();await ui('#instrument').selectOption('guitar');await setSessionMode('practice');await ui('#count-in').check();await ui('#play-button:not([disabled])').waitFor();
  const score=structuredClone(fixture),seed=score.parts[0].notes[0];score.id='guitar-expanded-time';score.title='Original guitar timing and unison study';
  score.source={format:'original-test-text',filename:'guitar-source.txt',content:'Original fractional, repeated, tied guitar study.\r\nKeep every source event.'};
  score.tempo=[{at:{numerator:0,denominator:1},bpm:120},{at:{numerator:1,denominator:1},bpm:80}];score.repeats=[{from:{numerator:0,denominator:1},to:{numerator:4,denominator:1},times:2}];
  const note=(id,at,duration,step,extra={})=>({...structuredClone(seed),id,at:{numerator:at[0],denominator:at[1]},duration:{numerator:duration[0],denominator:duration[1]},pitch:{step,alter:0,octave:4},...extra});
  score.parts=[{id:'lead',name:'Lead',instrument:'guitar',notes:[note('tie-head',[1,3],[1,3],'E',{tie_start:true}),note('tie-tail',[2,3],[1,3],'E',{tie_stop:true}),note('tempo-change',[3,2],[1,2],'G'),note('later',[3,1],[1,2],'A')]},{id:'unison',name:'Separate unison voice',instrument:'guitar',notes:[note('unison-source',[1,3],[1,3],'E')]}];
  const[compiledResponse,targetResponse]=await Promise.all([nextResponse('/api/compile'),nextResponse('/api/practice-targets'),ui('#score-file').setInputFiles({name:'guitar-expanded-time.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(score))})]);
  const compiled=await responseJson(compiledResponse),plan=await responseJson(targetResponse);await readyForTitle(score.title);await hideNotation();
  assert.deepEqual(compiled.score,score);assert.equal(plan.source_note_count,8);assert.equal(plan.target_count,8);assert.equal(plan.playable,true);assert.deepEqual(plan.timeline.notes.map(note=>[note.id,note.start_ms,note.duration_ms]),compiled.timeline.notes.map(note=>[note.id,note.start_ms,note.duration_ms]));
  await page.waitForFunction(()=>document.querySelectorAll('.guitar-target').length>0);const initialCards=await guitarGuidanceCards();assertGuitarGuidancePlan(initialCards,plan);
  const firstTime=plan.timeline.notes[0].start_ms,firstChord=plan.timeline.notes.filter(note=>note.start_ms===firstTime);assert.equal(firstChord.length,2);assert.ok(firstTime>166&&firstTime<167);assert.equal(firstChord[0].midi,firstChord[1].midi);assert.ok(firstChord.every(note=>initialCards.some(card=>card.id===note.id)));
  const tied=plan.groups.filter(group=>group.source_note_ids.includes('tie-head'));assert.equal(tied.length,2);assert.notEqual(tied[0].target_id,tied[1].target_id);assert.deepEqual(tied[0].source_note_ids,['tie-head','tie-tail']);assert.deepEqual(tied[1].source_note_ids,tied[0].source_note_ids);
  assert.equal(await page.locator('#stage-cue-main').textContent(),'READY');assert.equal(await page.locator('#stage-cue').isVisible(),true);assert.equal(await page.locator('#piano-stage').isVisible(),false);assert.match(await page.locator('#practice-hint').textContent(),/upcoming pitch times/);assert.doesNotMatch(await page.locator('#practice-hint').textContent(),/reaches the line/);
  await page.locator('#play-button').click();await page.waitForFunction(()=>document.querySelector('#guitar-guidance').dataset.phase==='count-in');assert.match(await page.locator('#stage-cue-main').textContent(),/^[1-4]$/);await page.locator('#play-button').click();assert.equal(await page.locator('#stage-cue-main').textContent(),'PAUSED');
  const pausedCountIn={cards:await guitarGuidanceCards(),state:await page.locator('#guitar-guidance-state').textContent()};await page.waitForTimeout(220);assert.deepEqual({cards:await guitarGuidanceCards(),state:await page.locator('#guitar-guidance-state').textContent()},pausedCountIn);assert.ok(pausedCountIn.cards.every(card=>card.phase==='upcoming'));
  await page.locator('#play-button:not([disabled])').click();await page.waitForFunction(()=>globalThis.__wmhReadPlaybackClock().positionMs>600);await page.locator('#play-button').click();const paused=await guitarGuidanceCards();assertGuitarGuidancePlan(paused,plan);await page.waitForTimeout(220);assert.deepEqual(await guitarGuidanceCards(),paused);
  const assessment=await rustApi('/api/assess',{timeline:plan.timeline,inputs:[{midi:firstChord[0].midi,at_ms:firstTime,velocity:90}],tolerance_ms:180});assert.equal(assessment.hits.length,1);assert.equal(assessment.misses.length,7);assert.equal(assessment.onset_completion.complete,0,'One same-pitch input cannot complete the two distinct guitar targets');
  assert.deepEqual(await exportScore(),score);await closeShellPanels();await writeFile(join(artifactDirectory,'worldmusichub-live-guitar-guidance-timing.json'),JSON.stringify({compiled:compiled.timeline,plan,initialCards,pausedCountIn,paused,assessment,canonical_score_unchanged:true},null,2));
});

test('real guitar string conflicts stay blocked while the guide retains every unplayable target',testOptions,async()=>{
  await hideNotation();await ui('#instrument').selectOption('guitar');await setSessionMode('practice');await ui('#play-button:not([disabled])').waitFor();
  const score=structuredClone(fixture),seed=score.parts[0].notes[0];score.id='guitar-conflicting-strings';score.title='Original one-string collision';score.parts[0].notes=['E','F'].map((step,index)=>({...structuredClone(seed),id:`conflict-${index}`,pitch:{step,alter:0,octave:2},voice:String(index+1)}));
  const[checkResponse,targetResponse]=await Promise.all([nextResponse('/api/instrument-check'),nextResponse('/api/practice-targets'),ui('#score-file').setInputFiles({name:'guitar-conflicting-strings.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(score))})]);
  const report=await responseJson(checkResponse),plan=await responseJson(targetResponse);await page.waitForFunction(title=>document.querySelector('#score-title').textContent===title&&document.querySelector('#practice-gate-reason').textContent.includes('simultaneous'),score.title);await hideNotation();
  assert.ok(report.note_options.every(note=>note.playable),'The two pitches fit individually');assert.ok(report.diagnostics.some(item=>item.code==='guitar_string_conflict'));assert.equal(plan.playable,false);assert.equal(plan.target_count,2);assert.equal(await page.locator('#play-button').isDisabled(),true);assert.equal(await ui('#assess-button').isDisabled(),true);assert.match(await page.locator('#practice-hint').textContent(),/arrangement/);
  await page.waitForFunction(()=>document.querySelectorAll('.guitar-target').length===2);assertGuitarGuidancePlan(await guitarGuidanceCards(),plan);assert.deepEqual(await exportScore(),score);
});

for(const viewport of [{width:1280,height:720},{width:844,height:390},{width:390,height:844}]){
  test(`real unobscured guitar stage keeps guidance, shared cues and all frets reachable at ${viewport.width} by ${viewport.height}`,testOptions,async()=>{
    await hideNotation();await page.setViewportSize(viewport);await page.emulateMedia({reducedMotion:'reduce'});await ui('#instrument').selectOption('guitar');await setSessionMode('practice');await ui('#play-button:not([disabled])').waitFor();await ui('#guitar-frets').fill('36');
    const[targetResponse]=await Promise.all([nextResponse('/api/practice-targets'),ui('#instrument-apply').click()]);const plan=await responseJson(targetResponse);assert.equal(targetResponse.request().postDataJSON().profile.frets,36);await ui('#play-button:not([disabled])').waitFor();await closeShellPanels();
    await page.waitForFunction(()=>document.querySelectorAll('.guitar-target').length>0);assertGuitarGuidancePlan(await guitarGuidanceCards(),plan);assert.equal(await page.locator('.fret-button').count(),222);assert.equal(await page.locator('#stage-cue-main').textContent(),'READY');assert.equal(await page.locator('dialog[open]').count(),0);
    const geometry=await page.evaluate(()=>{
      const rect=selector=>{const el=document.querySelector(selector),r=el.getBoundingClientRect();return{x:r.x,y:r.y,width:r.width,height:r.height,right:r.right,bottom:r.bottom,clientHeight:el.clientHeight,scrollHeight:el.scrollHeight,clientWidth:el.clientWidth,scrollWidth:el.scrollWidth,scrollTop:el.scrollTop,scrollLeft:el.scrollLeft}};
      return{viewport:{width:innerWidth,height:innerHeight},document:{width:document.documentElement.scrollWidth,height:document.documentElement.scrollHeight},play:rect('.play-panel'),transport:rect('.transport'),guidance:rect('#guitar-guidance'),cue:rect('#stage-cue'),scroll:rect('.guitar-scroll'),board:rect('#fretboard'),help:rect('.guitar-details'),first:rect('.fret-button[data-string="0"][data-fret="0"]')};
    });
    const firstVisible=await guitarFretVisibility('.fret-button[data-string="0"][data-fret="0"]');
    await writeFile(join(artifactDirectory,`worldmusichub-live-guitar-${viewport.width}x${viewport.height}-geometry.json`),JSON.stringify({...geometry,firstVisible},null,2));
    assertBoundedDocument(geometry);for(const name of ['play','transport','guidance','cue','scroll','help','first'])assertInsideViewport(geometry[name],viewport,name);
    assert.ok(geometry.play.scrollHeight<=geometry.play.clientHeight+1,'Transport stays outside the contained instrument scroller');assert.ok(geometry.scroll.height>=34,'At least a whole fret row stays reachable');assert.equal(geometry.scroll.scrollTop,0,'An oversized fretboard starts at its scroll origin');assert.ok(geometry.board.y>=geometry.scroll.y-1,'No centered overflow hides the top strings');assert.ok(geometry.cue.bottom<=geometry.guidance.y+1,'The shared cue never overlays pitch guidance');assert.ok(geometry.guidance.bottom<=geometry.scroll.y+1,'Fixed guidance never overlays fret controls');assert.ok(geometry.scroll.bottom<=geometry.transport.y+1);assert.ok(geometry.scroll.scrollWidth>geometry.scroll.clientWidth,'All 36 frets scroll inside the instrument');
    assertWholeGuitarFret(firstVisible,'First string at the scroll origin');assert.equal(await page.locator('#guitar-guidance').getAttribute('aria-live'),'off');assert.equal(await page.locator('#guitar-guidance').evaluate(el=>el.getAnimations({subtree:true}).length),0);await viewportSnapshot(`guitar-${viewport.width}x${viewport.height}-ready`);
    const last=page.locator('.fret-button[data-string="5"][data-fret="36"]');await last.focus();const lastBounds=await last.boundingBox(),lastVisible=await guitarFretVisibility('.fret-button[data-string="5"][data-fret="36"]');assertWholeGuitarFret(lastVisible,'Focused last string and fret');assertInsideViewport({...lastBounds,right:lastBounds.x+lastBounds.width,bottom:lastBounds.y+lastBounds.height},viewport,'Last string and fret');assert.ok(await page.locator('.guitar-scroll').evaluate(el=>el.scrollLeft>0));
    for(const key of ['Enter','Space']){await page.keyboard.down(key);assert.equal(await last.getAttribute('aria-pressed'),'true');await page.keyboard.up(key);assert.equal(await last.getAttribute('aria-pressed'),'false');assert.equal(await page.locator('.fret-button.pressed').count(),0);assert.match(await page.locator('#play-button').textContent(),/Play/,'Fret Space input must not start the transport');}
    await viewportSnapshot(`guitar-${viewport.width}x${viewport.height}-full-range`);await page.keyboard.down('Enter');await page.locator('#reset-button').focus();assert.equal(await page.locator('.fret-button.pressed').count(),0,'Moving focus releases a held accessible fret');await page.keyboard.up('Enter');
    const first=page.locator('.fret-button[data-string="0"][data-fret="0"]');await first.focus();assert.equal(await first.getAttribute('aria-label'),'String row 1 (tuning E4), fret 0: E4');assert.ok(await page.locator('.guitar-scroll').evaluate(el=>el.scrollLeft<50&&el.scrollTop<=23));await page.locator('#reset-button').focus();
    const disclosureEvidence=[],compact=viewport.width===844&&viewport.height===390,summary=page.locator('.guitar-details summary');
    for(let cycle=0;cycle<(compact?2:1);cycle++){
      await summary.click();assert.equal(await page.locator('.guitar-details').evaluate(el=>el.open),true);
      assert.ok(await page.locator('#guitar-guidance-sources li').count()>0);assert.match(await page.locator('#guitar-guidance-sources').textContent(),/Source occurrences:/);
      if(compact){
        await summary.scrollIntoViewIfNeeded();
        const opened=await summary.evaluate(element=>{
          const box=el=>{const r=el.getBoundingClientRect();return{x:r.x,y:r.y,right:r.right,bottom:r.bottom,width:r.width,height:r.height}};
          const stage=element.closest('.guitar-stage'),scroll=stage.querySelector('.guitar-scroll'),rect=box(element),hit=document.elementFromPoint(rect.x+rect.width/2,rect.y+rect.height/2);
          return{summary:rect,stage:box(stage),scroll:box(scroll),stageScrollTop:stage.scrollTop,gridRows:getComputedStyle(stage).gridTemplateRows,boardHeight:getComputedStyle(scroll).height,hit:hit?{tag:hit.tagName,id:hit.id,className:hit.className,string:hit.dataset.string,fret:hit.dataset.fret}:null,receivesPointer:hit===element||element.contains(hit)};
        });
        disclosureEvidence.push({cycle,opened});
        await writeFile(join(artifactDirectory,'worldmusichub-live-guitar-844x390-disclosures.json'),JSON.stringify(disclosureEvidence,null,2));
        assert.ok(opened.scroll.bottom<=opened.summary.y+1,`Expanded board must end before the source summary: ${JSON.stringify(opened)}`);
        assert.ok(opened.receivesPointer,`The visible summary must receive its close click: ${JSON.stringify(opened)}`);
      }
      await summary.click();assert.equal(await page.locator('.guitar-details').evaluate(el=>el.open),false);
      if(compact){assertWholeGuitarFret(await guitarFretVisibility('.fret-button[data-string="0"][data-fret="0"]'),'First string after closing source details');assert.equal(await page.locator('.fret-button.pressed').count(),0);}
    }
    await writeFile(join(artifactDirectory,`worldmusichub-live-guitar-${viewport.width}x${viewport.height}-geometry.json`),JSON.stringify({...geometry,firstVisible,lastVisible,lastFret:lastBounds,disclosureEvidence},null,2));assert.deepEqual(await exportScore(),initialCompilation.score);
  });
}

test('complete Beethoven edition renders all 18 measures and keeps every source event through piano range gates', {timeout:60_000}, async()=>{
  const edition=JSON.parse(await readFile(join(root,'catalog/editions/cc0-beethoven-gottes-macht-op48-5/score.json'),'utf8'));
  const editionNavigation=nextResponse('/api/notation-navigation');
  const written=edition.parts.flatMap(part=>part.notes),pitched=written.filter(note=>note.pitch);
  const voice=edition.parts.find(part=>part.id==='P1'),piano=edition.parts.find(part=>part.id==='P2');
  const editionPath=`/api/catalog/score/${edition.id}`;
  assert.equal(requests.filter(request=>request.path===editionPath).length,0);
  const [response]=await Promise.all([nextResponse('/api/compile'),ui(`[data-score-id="${edition.id}"]`).click()]);
  const compiled=await responseJson(response);await activateCatalogTitle(edition.title);await waitForEngraving();
  assert.deepEqual(compiled.score,edition);assert.equal(written.length,226);assert.equal(pitched.length,204);
  assert.equal(compiled.timeline.notes.length,198);assert.equal(edition.measures.length,18);
  assert.deepEqual(compiled.timeline.notes.flatMap(note=>note.source_note_ids).sort(),pitched.map(note=>note.id).sort());
  assert.equal(requests.filter(request=>request.path===editionPath).length,1);
  assert.match(await ui('#score-meta').textContent(),/226 written events.*198 playback note events.*18 measures/);
  assert.match(await ui('#score-retention-note').textContent(),/204 pitched note segments \+ 22 rests/);
  assert.equal(await ui('#score-origin-label').textContent(),'CC0 source edition');
  await ui('#score-details-button').click();
  assert.match(await ui('#provenance').textContent(),/Christian Fürchtegott Gellert/);
  const notices=await ui('#diagnostic-list').textContent();
  for(const phrase of ['+0.0002 BPM','unknown','138','60 same-pitch','controller 121','subtitle overlap'])assert.ok(notices.includes(phrase),phrase);
  await ui('#score-details>summary').click();
  const pages=[];
  for(const [index,label]of ['Measures 1–8 / 18','Measures 9–16 / 18','Measures 17–18 / 18'].entries()){
    if(index){await ui('#engraving-next').click();await page.waitForFunction(expected=>document.querySelector('#engraving-range').textContent.includes(expected),label);await waitForEngraving()}
    assert.ok((await ui('#engraving-range').textContent()).includes(label));
    const paths=await ui('#engraved-staff svg path').count();assert.ok(paths>20,'The selected measure range has actual rendered notation');
    pages.push({range:label,svg_paths:paths});await screenshot(`cc0-beethoven-page-${index+1}`);
  }
  assert.equal(await ui('#engraving-next').isDisabled(),true);
  await ui('#theme-mode').selectOption('dark');await page.waitForFunction(()=>document.documentElement.dataset.theme==='dark');await waitForEngraving();await screenshot('cc0-beethoven-last-page-dark');
  await page.setViewportSize({width:960,height:720});await waitForEngraving();
  await viewportSnapshot('cc0-beethoven-last-page-960x720',{requireVisibleNoteheads:true});
  await page.setViewportSize({width:1440,height:1100});await waitForEngraving();
  await setSessionMode('practice');
  await page.waitForFunction(()=>document.querySelector('#practice-gate-reason').textContent.includes('Selected notes outside this instrument range:'));
  assert.equal(await ui('#key-count').inputValue(),'61');assert.equal(await ui('#play-button').isDisabled(),true);
  assert.equal(await ui('#assess-button').isDisabled(),true);
  const selectedPages=[];
  async function readySelectedPart(part){
    await waitForEngraving();
    assert.equal(await ui('#engraving-part').inputValue(),part);
    assert.equal(await ui('#engraving-fallback').isVisible(),false);
    assert.equal(await ui('#engraved-button').getAttribute('aria-pressed'),'true');
    assert.match(await ui('#engraving-range').textContent(),/Measures 17–18 \/ 18/);
    const svgCount=await ui('#engraved-staff svg').count();assert.ok(svgCount>0);
    selectedPages.push({part:part||'all',range:await ui('#engraving-range').textContent(),svg_count:svgCount,fallback_hidden:true});
    await screenshot(`cc0-beethoven-final-page-${part||'all'}`);
  }
  assert.equal(await ui('#notation-scope').isDisabled(),true,'Solo notation follows the actual human selection');
  assert.equal(await ui('#notation-scope').inputValue(),'current');
  await selectPracticePart(voice.id);await ui('#play-button:not([disabled])').waitFor();await readySelectedPart(voice.id);
  await selectPracticePart(piano.id);await page.waitForFunction(()=>document.querySelector('#practice-gate-reason').textContent.includes('Selected notes outside this instrument range:'));await readySelectedPart(piano.id);
  assert.equal(await ui('#play-button').isDisabled(),true);
  const [blockedResponse]=await Promise.all([nextTargetResponse({kind:'piano',key_count:61,lowest_midi:null},compiled.timeline),selectPracticePart('')]);
  const blockedPlan=await responseJson(blockedResponse);assert.equal(blockedPlan.playable,false);
  assert.equal(await ui('#notation-scope').isDisabled(),true);assert.equal(await ui('#notation-scope').inputValue(),'current');
  await page.waitForFunction(()=>document.querySelector('#practice-gate-reason').textContent.includes('Selected notes outside this instrument range:'));await readySelectedPart('');
  assert.deepEqual(await page.locator('#workspace').evaluate(node=>JSON.parse(node.dataset.renderedNotationParts)),edition.parts.map(part=>part.id),'Current displays every selected human part when the legacy All target is chosen');
  // A blocked setup cannot create a checked take. Inspect its available gate and
  // source mappings instead of waiting for an intentionally unavailable export.
  const blockedUi=await page.evaluate(()=>({
    key_count:document.querySelector('#key-count').value,practice_part:document.querySelector('#practice-part').value,
    gate:document.querySelector('#practice-gate-reason').textContent,report:document.querySelector('#instrument-report').textContent,
    scope:document.querySelector('#practice-scope').textContent,mapping_summary:document.querySelector('#target-mapping-summary').textContent,
    mappings:[...document.querySelectorAll('#target-group-list li')].map(item=>item.textContent),
    play_disabled:document.querySelector('#play-button').disabled,check_disabled:document.querySelector('#assess-button').disabled,
    export_disabled:document.querySelector('#export-takes').disabled,take_history_hidden:document.querySelector('#take-history').hidden,
  }));
  const plans=[],planEvidence=[{request:blockedResponse.request().postDataJSON(),response:blockedPlan,ui:blockedUi}];
  const evidencePath=join(artifactDirectory,'worldmusichub-live-cc0-beethoven-target-plan-evidence.json');
  await writeFile(evidencePath,JSON.stringify(planEvidence,null,2));
  assert.deepEqual(planEvidence[0].request,{timeline:compiled.timeline,profile:{kind:'piano',key_count:61,lowest_midi:null}});
  assert.equal(blockedPlan.source_note_count,198);assert.equal(blockedPlan.target_count,168);
  assert.deepEqual(blockedPlan.groups.flatMap(group=>group.source_note_ids).sort(),pitched.map(note=>note.id).sort());
  assert.equal(blockedUi.key_count,'61');assert.equal(blockedUi.practice_part,'');assert.equal(await ui('#practice-gate').isVisible(),true);
  assert.match(blockedUi.gate,/Selected notes outside this instrument range: 8\./);assert.match(blockedUi.report,/Notes outside playable range: 8/);
  assert.match(blockedUi.scope,/168 physical attacks from 198 sounding events/);
  assert.equal(blockedUi.play_disabled,true);assert.equal(blockedUi.check_disabled,true);
  assert.equal(blockedUi.export_disabled,true);assert.equal(blockedUi.take_history_hidden,true);
  const mappedGroups=blockedPlan.groups.filter(group=>group.source_occurrence_ids.length>1||group.source_note_ids.length>1);
  assert.equal(blockedUi.mapping_summary,`Physical target source mapping · Grouped / tied targets: ${mappedGroups.length}`);
  assert.equal(blockedUi.mappings.length,mappedGroups.length);
  for(const [index,group]of mappedGroups.entries())assert.ok(blockedUi.mappings[index].includes(`${group.source_occurrence_ids.length} sounding events; source notes ${group.source_note_ids.join(', ')}; parts ${group.part_ids.join(', ')}`));
  for(const keys of ['76','88']){
    const profile={kind:'piano',key_count:Number(keys),lowest_midi:null};
    const [targetResponse]=await Promise.all([nextTargetResponse(profile,compiled.timeline),ui('#key-count').selectOption(keys)]);
    const plan=await responseJson(targetResponse),request=targetResponse.request().postDataJSON();
    planEvidence.push({request,response:plan});await writeFile(evidencePath,JSON.stringify(planEvidence,null,2));
    assert.deepEqual(request,{timeline:compiled.timeline,profile});
    assert.equal(plan.playable,true);assert.equal(plan.source_note_count,198);assert.equal(plan.target_count,168);
    await ui('#play-button:not([disabled])').waitFor();await waitForEngraving();assert.equal(await ui('#engraving-fallback').isVisible(),false);
    assert.equal(await ui('#key-count').inputValue(),keys);assert.equal(await ui('#practice-part').inputValue(),'');
    assert.equal(await ui('#export-takes').isDisabled(),true,'Changing the range clears the previous in-memory take');
    // Check my practice is the normal UI path for an empty, capture-disabled take.
    const assessmentRequest={timeline:plan.timeline,inputs:[],tolerance_ms:180};
    const [assessmentResponse]=await Promise.all([
      page.waitForResponse(response=>new URL(response.url()).pathname==='/api/assess'&&response.request().method()==='POST'
        &&isDeepStrictEqual(response.request().postDataJSON(),assessmentRequest),{timeout:10_000}),
      ui('#assess-button').click(),
    ]);
    const assessment=await responseJson(assessmentResponse);
    planEvidence.at(-1).assessment_request=assessmentResponse.request().postDataJSON();planEvidence.at(-1).assessment_response=assessment;
    await writeFile(evidencePath,JSON.stringify(planEvidence,null,2));
    assert.equal(assessment.hits.length,0);assert.equal(assessment.misses.length,168);assert.equal(assessment.extras.length,0);
    await ui('#result-summary[data-phase="assessed"][data-pass-id="1"][data-assessed-revision="0"]').waitFor();
    assert.equal(await ui('#accuracy').textContent(),'0%');assert.equal(await ui('#export-takes').isDisabled(),false);
    const take=await exportTakeData();planEvidence.at(-1).ui_exported_plan=take.target_plan;
    planEvidence.at(-1).ui_exported_passes=take.passes;
    await writeFile(evidencePath,JSON.stringify(planEvidence,null,2));
    assert.equal(take.practice_part,null);assert.deepEqual(take.target_plan,plan,'The visible ready UI must use this exact profile-matched Rust plan');
    assert.equal(take.passes.length,1);assert.equal(take.passes[0].capture_enabled,false);assert.equal(take.passes[0].pending,false);
    assert.deepEqual(take.passes[0].inputs,[]);assert.deepEqual(take.passes[0].timeline,plan.timeline);assert.deepEqual(take.passes[0].assessment,assessment);
    assert.deepEqual(plan.groups.flatMap(group=>group.source_note_ids).sort(),pitched.map(note=>note.id).sort());
    plans.push({keys,source_attack_count:plan.source_note_count,physical_target_count:plan.target_count,playable:plan.playable});
  }
  await setSessionMode('listen');await ui('.practice-options>summary').click();
  await ui('#loop-from').fill('64');await ui('#loop-to').fill('68');
  const [windowResponse]=await Promise.all([nextResponse('/api/practice-window'),ui('#loop-apply').click()]);
  const window=await responseJson(windowResponse);await page.waitForFunction(()=>document.querySelector('#loop-status').textContent.includes('ready'));
  await ui('#count-in').uncheck();
  await ui('#engraving-follow').check();
  const navigation=await responseJson(await editionNavigation);
  assert.equal(navigation.occurrences.length,18);assert.equal(navigation.sounding_groups.length,198);
  await page.waitForFunction(()=>document.querySelector('#engraving-follow-status').textContent.includes('source 17/18'));
  await ui('#play-button').click();await page.waitForFunction(start=>globalThis.__wmhReadPlaybackClock().positionMs>start,window.start_ms);
  assert.match(await ui('#engraving-follow-status').textContent(),/Following written measure 17/);
  assert.match(await ui('#engraving-range').textContent(),/Measures 17–18/);await ui('#play-button').click();
  assert.deepEqual(await exportScore(),edition,'Ranges, source pages and following preserve the entire original score');
  await writeFile(join(artifactDirectory,'worldmusichub-live-cc0-beethoven-acceptance.json'),JSON.stringify({score_id:edition.id,written_events:226,pitched_segments:204,rests:22,sounding_events:198,measures:18,pages,selected_part_final_pages:selectedPages,piano_plans:plans,all_source_ids_preserved:true,canonical_score_unchanged:true,limitations:edition.source.import_diagnostics},null,2));
});

test('complete Beethoven original PNG, MSCX, XML, reference MIDI and license download byte-exactly', {timeout:60_000}, async()=>{
  const edition=JSON.parse(await readFile(join(root,'catalog/editions/cc0-beethoven-gottes-macht-op48-5/score.json'),'utf8'));
  await ui(`[data-score-id="${edition.id}"]`).click();await activateCatalogTitle(edition.title);await waitForEngraving();
  const envelope=JSON.parse(edition.source.content);
  const expected=[{filename:edition.source.filename,bytes:Buffer.from(edition.source.content),sha256:null,size:null},...Object.entries(envelope.files).map(([filename,file])=>({filename,bytes:Buffer.from(file.content,file.encoding==='base64'?'base64':'utf8'),sha256:file.sha256,size:file.bytes})),{filename:'LICENSE-CC0.txt',bytes:Buffer.from(envelope.license_text),sha256:envelope.provenance.license_text_sha256,size:null}];
  assert.equal(expected.length,7);let downloads=0;page.on('download',()=>downloads++);
  const external=[];page.on('request',request=>{if(new URL(request.url()).origin!==origin)external.push(request.url())});
  await ui('#source-files-button').click();assert.equal(await ui('#source-archive-files>li').count(),7);
  const evidence=[];
  for(const file of expected){
    await page.getByRole('button',{name:`Inspect retained file ${file.filename}`,exact:true}).click();
    await ui('#source-archive-download:not([disabled])').waitFor();assert.equal(downloads,evidence.length);
    const hash=createHash('sha256').update(file.bytes).digest('hex');
    assert.equal(await ui('#source-computed-hash').textContent(),hash);
    assert.equal(await ui('#source-declared-hash').textContent(),file.sha256||'Not supplied');
    assert.match(await ui('#source-hash-status').textContent(),file.sha256?/matches the declaration/:/Unknown: no declared/);
    assert.match(await ui('#source-size-status').textContent(),file.size===null?/Unknown: no declared/:/matches the declaration/);
    assert.equal(await ui('#source-mismatch-note').isVisible(),false);
    if(file.filename==='source-1.png'){
      assert.deepEqual(file.bytes.subarray(0,8),Buffer.from([137,80,78,71,13,10,26,10]));
      await page.screenshot({path:join(artifactDirectory,'worldmusichub-live-cc0-beethoven-retained-png.png'),fullPage:true});
    }
    const promise=page.waitForEvent('download');await ui('#source-archive-download').click();const downloaded=await promise;
    assert.equal(await downloaded.failure(),null);assert.equal(downloaded.suggestedFilename(),file.filename);
    assert.deepEqual(await readFile(await downloaded.path()),file.bytes);
    evidence.push({filename:file.filename,bytes:file.bytes.length,computed_sha256:hash,declared_sha256:file.sha256,declared_bytes:file.size});
  }
  assert.deepEqual(external,[]);await ui('#source-archive-close').click();assert.deepEqual(await exportScore(),edition);
  await writeFile(join(artifactDirectory,'worldmusichub-live-cc0-beethoven-source-files.json'),JSON.stringify({score_id:edition.id,files:evidence,canonical_score_unchanged:true},null,2));
});

test('complete Beethoven browser library restore retains all originals and guitar voice requires an explicit suitable range', {timeout:60_000}, async()=>{
  const edition=JSON.parse(await readFile(join(root,'catalog/editions/cc0-beethoven-gottes-macht-op48-5/score.json'),'utf8'));
  const [response]=await Promise.all([nextResponse('/api/compile'),ui(`[data-score-id="${edition.id}"]`).click()]);
  const compiled=await responseJson(response);await activateCatalogTitle(edition.title);
  const restored=await libraryRoundtrip(compiled,'Complete Beethoven archive','beethoven-library-backup.json',[]);
  assert.deepEqual(restored.score,edition);assert.equal(restored.score.source.content,edition.source.content);
  const savedKey=await ui('#library-list>li').first().getAttribute('data-library-key');
  await reloadStage();await readyForTitle(initialCompilation.score.title);await ui('#library-button').click();
  const [reopenedResponse]=await Promise.all([nextResponse('/api/compile'),ui(`[data-library-key="${savedKey}"] [data-library-open]`).click()]);
  assert.deepEqual(await responseJson(reopenedResponse),compiled);await ui('#score-library').waitFor({state:'hidden'});await readyForTitle(edition.title);
  assert.deepEqual(await exportScore(),edition,'A real page reload preserves the saved full source archive');
  const restoredArchive=JSON.parse(restored.score.source.content);
  for(const file of Object.values(restoredArchive.files)){
    const bytes=Buffer.from(file.content,file.encoding==='base64'?'base64':'utf8');
    assert.equal(bytes.length,file.bytes);assert.equal(createHash('sha256').update(bytes).digest('hex'),file.sha256);
  }
  await ui('#instrument').selectOption('guitar');await setSessionMode('practice');
  await page.waitForFunction(()=>document.querySelector('#practice-gate-reason').textContent.includes('Selected notes outside this instrument range:'));
  assert.equal(await ui('#play-button').isDisabled(),true);assert.equal(await ui('#assess-button').isDisabled(),true);
  const [voiceResponse]=await Promise.all([nextResponse('/api/instrument-check'),selectPracticePart('P1')]);
  const voiceReport=await responseJson(voiceResponse);assert.equal(voiceReport.note_options.filter(note=>!note.playable).length,6);
  assert.equal(await ui('#guitar-frets').inputValue(),'12');assert.equal(await ui('#play-button').isDisabled(),true);
  await ui('#guitar-frets').fill('15');assert.match(await ui('#practice-gate-reason').textContent(),/edited|validate|Apply/);
  const [rangeResponse,targetResponse]=await Promise.all([nextResponse('/api/instrument-check'),nextResponse('/api/practice-targets'),ui('#instrument-apply').click()]);
  const range=await responseJson(rangeResponse),plan=await responseJson(targetResponse);await ui('#play-button:not([disabled])').waitFor();
  assert.equal(range.highest_midi,79);assert.ok(range.note_options.every(note=>note.playable));
  assert.equal(plan.playable,true);assert.equal(plan.source_note_count,30);assert.equal(plan.target_count,30);
  assert.ok(plan.groups.every(group=>group.part_ids.every(id=>id==='P1')));
  assert.match(await ui('#instrument-diagnostics').textContent(),/fingering|pitch|duration|technique/i);
  assert.deepEqual(await exportScore(),edition);
  await hideNotation();await ui('#guitar-guidance').waitFor();await screenshot('cc0-beethoven-guitar-voice');
  const [fullResponse]=await Promise.all([nextResponse('/api/practice-targets'),selectPracticePart('')]);
  const full=await responseJson(fullResponse);assert.equal(full.playable,false);assert.equal(full.target_count,198);
  await page.waitForFunction(()=>document.querySelector('#practice-gate-reason').textContent.includes('Selected notes outside this instrument range:'));
  assert.equal(await ui('#play-button').isDisabled(),true);await setSessionMode('listen');
  assert.equal(await ui('#play-button').isEnabled(),true);assert.deepEqual(await exportScore(),edition);
  await writeFile(join(artifactDirectory,'worldmusichub-live-cc0-beethoven-library-guitar.json'),JSON.stringify({score_id:edition.id,full_source_archive_unchanged:true,library_restore_equal:true,voice_guitar15:{source_attack_count:plan.source_note_count,physical_target_count:plan.target_count,playable:plan.playable},full_guitar15:{source_attack_count:full.source_note_count,physical_target_count:full.target_count,playable:full.playable}},null,2));
});

for(const viewport of [{width:1280,height:720},{width:844,height:390}]){
 test(`real fullscreen preserves dialogs, notation and complete guitar rows at ${viewport.width} by ${viewport.height}`,{timeout:60_000},async()=>{
  await hideNotation();await page.setViewportSize(viewport);await page.emulateMedia({reducedMotion:'reduce'});await closeShellPanels();
  assert.equal(await page.evaluate(()=>document.fullscreenEnabled&&typeof document.documentElement.requestFullscreen==='function'),true,'This supported hosted Chromium case must exercise the real Fullscreen API');
  const button=page.locator('#fullscreen-button');await button.focus();await page.keyboard.press('Enter');await page.waitForFunction(()=>document.fullscreenElement===document.documentElement);
  assert.equal(await button.getAttribute('aria-label'),'Exit fullscreen');assert.equal(await button.locator('svg').getAttribute('aria-hidden'),'true');assert.equal(await page.locator('#fullscreen-button').count(),1);await assertStoppedAtZero();
  const checkReachable=async selector=>{
   const value=await page.locator(selector).evaluate(element=>{const r=element.getBoundingClientRect(),hit=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2);return{x:r.x,y:r.y,width:r.width,height:r.height,right:r.right,bottom:r.bottom,reachable:element===hit||element.contains(hit),viewport:{width:innerWidth,height:innerHeight}}});
   assertInsideViewport(value,value.viewport,selector);assert.equal(value.reachable,true,`${selector} must be above the fullscreen root and reachable`);return value;
  };
  const icon=await checkReachable('#fullscreen-button');assert.ok(icon.width<=40&&icon.width>=34);assert.equal(await button.evaluate(el=>el.getAnimations({subtree:true}).length),0);
  for(const name of ['settings','results','score-tools','import-tools']){await page.locator(`#${name}-button`).click();assert.equal(await page.locator(`#${name}-dialog`).evaluate(el=>el.matches(':modal')),true);await checkReachable(`#${name}-dialog [data-close-panel]`);assert.equal(await page.evaluate(()=>document.fullscreenElement===document.documentElement),true);await page.locator(`#${name}-dialog [data-close-panel]`).click();}
  await page.locator('#score-tools-button').click();await page.locator('#source-files-button').click();assert.equal(await page.locator('#source-archive-dialog').evaluate(el=>el.matches(':modal')),true);await checkReachable('#source-archive-close');await page.locator('#source-archive-close').click();await closeShellPanels();
  await page.locator('#back-to-library').click();assert.equal(await page.locator('.shell-header #fullscreen-button').count(),1);await checkReachable('#fullscreen-button');await page.locator('#resume-session').click();assert.equal(await page.locator('.stage-hud #fullscreen-button').count(),1);
  await page.locator('#notation-toggle').click();await waitForEngraving();const notation=await viewportSnapshot(`fullscreen-${viewport.width}x${viewport.height}-notation`,{requireVisibleNoteheads:true});await hideNotation();
  await ui('#instrument').selectOption('guitar');await setSessionMode('practice');await ui('#play-button:not([disabled])').waitFor();await closeShellPanels();
  const geometry=await page.evaluate(()=>{const rect=selector=>{const el=document.querySelector(selector),r=el.getBoundingClientRect();return{x:r.x,y:r.y,width:r.width,height:r.height,right:r.right,bottom:r.bottom,clientHeight:el.clientHeight,scrollHeight:el.scrollHeight}};return{viewport:{width:innerWidth,height:innerHeight},document:{width:document.documentElement.scrollWidth,height:document.documentElement.scrollHeight},stage:rect('#workspace'),hud:rect('.stage-hud'),transport:rect('.transport'),scroll:rect('.guitar-scroll'),icon:rect('#fullscreen-button')}});
  assertBoundedDocument(geometry);for(const selector of ['stage','hud','transport','scroll','icon'])assertInsideViewport(geometry[selector],geometry.viewport,selector);assert.ok(geometry.scroll.height>=56,'Fullscreen tools cannot consume the complete labelled guitar row');assert.ok(geometry.scroll.bottom<=geometry.transport.y+1);assert.ok(geometry.stage.scrollHeight<=geometry.stage.clientHeight+1);assertWholeGuitarFret(await guitarFretVisibility('.fret-button[data-string="0"][data-fret="0"]'),'Fullscreen first guitar row');await viewportSnapshot(`fullscreen-${viewport.width}x${viewport.height}-guitar`);
  await button.click();await page.waitForFunction(()=>document.fullscreenElement===null);assert.equal(await button.getAttribute('aria-label'),'Enter fullscreen');await assertStoppedAtZero();
  await button.click();await page.waitForFunction(()=>document.fullscreenElement===document.documentElement);
  // A real external API exit exercises fullscreenchange without faking browser
  // state. Headless input is not a claim about physical Escape/OS handling.
  await page.locator('#settings-button').click();await page.locator('#tempo').focus();
  await page.evaluate(()=>document.exitFullscreen());await page.waitForFunction(()=>document.querySelector('#fullscreen-button').getAttribute('aria-label').startsWith('Enter'));
  assert.equal(await page.locator('#settings-dialog').isVisible(),true);assert.equal(await page.evaluate(()=>document.activeElement.id),'tempo');await checkReachable('#settings-dialog [data-close-panel]');await closeShellPanels();
  assert.deepEqual(await exportScore(),initialCompilation.score);await closeShellPanels();await writeFile(join(artifactDirectory,`worldmusichub-live-fullscreen-${viewport.width}x${viewport.height}.json`),JSON.stringify({viewport,icon,geometry,notation,native_fullscreen_api:true,native_dialogs_reachable:true,canonical_score_unchanged:true,physical_escape_or_os_window_validation:false},null,2));
 });
}

test('real fullscreen does not restart a paused take or erase genuine focus lifecycle evidence',testOptions,async()=>{
 await hideNotation();await setSessionMode('practice');await ui('#count-in').uncheck();await closeShellPanels();await page.locator('#play-button').click();await page.waitForFunction(()=>globalThis.__wmhReadPlaybackClock().positionMs>100);await page.locator('#stage-title').click();await page.keyboard.press('a');await page.locator('#play-button').click();await page.waitForFunction(()=>document.querySelector('.performance-status').dataset.phase!=='grace');
 const before=await exportTakeData(),snapshot=await pausedTakeSnapshot();assert.equal(before.passes.length,1);assert.equal(before.passes[0].inputs.length,1);
 await page.evaluate(()=>{window.fullscreenLifecycle=[];addEventListener('blur',()=>fullscreenLifecycle.push('blur'));document.addEventListener('visibilitychange',()=>{if(document.hidden)fullscreenLifecycle.push('hidden')})});
 await page.locator('#fullscreen-button').click();await page.waitForFunction(()=>document.fullscreenElement===document.documentElement);await page.locator('#fullscreen-button').click();await page.waitForFunction(()=>document.fullscreenElement===null);
 assert.deepEqual(await pausedTakeSnapshot(),snapshot);assert.match(await page.locator('#play-button').textContent(),/Play/);const after=await exportTakeData(),lifecycle=await page.evaluate(()=>fullscreenLifecycle);
 if(lifecycle.length===0)assert.deepEqual(after,before,'Without real focus events, changing browser presentation leaves every take field unchanged');
 else{const added=after.input_evidence.events.slice(before.input_evidence.events.length);assert.deepEqual(after.input_evidence.events.slice(0,before.input_evidence.events.length),before.input_evidence.events);assert.deepEqual(added.map(event=>event.reason),lifecycle);assert.ok(added.every(event=>event.kind==='boundary'));const unchanged=structuredClone(after);unchanged.input_evidence.events=before.input_evidence.events;assert.deepEqual(unchanged,before,'Only observed browser focus boundaries may be appended; timing, inputs and assessments stay exact');}
 await writeFile(join(artifactDirectory,'worldmusichub-live-fullscreen-paused-take.json'),JSON.stringify({snapshot,lifecycle,paused_take_unchanged_except_observed_lifecycle:true,score_id:initialCompilation.score.id},null,2));
});

async function installSelectableMidiInputs() {
 await page.addInitScript(()=>{
  window.midiRequests=0;
  const port=(id,name)=>({id,name,manufacturer:'Private fixture manufacturer',state:'connected',connection:'closed',onmidimessage:null,async open(){this.connection='open';return this},async close(){this.connection='closed';return this}});
  window.midiOne=port('private-keyboard-one','Fixture keyboard one');window.midiTwo=port('private-keyboard-two','Fixture keyboard two');
  window.selectableMidiAccess={inputs:new Map([[midiOne.id,midiOne],[midiTwo.id,midiTwo]]),onstatechange:null};
  Object.defineProperty(navigator,'requestMIDIAccess',{configurable:true,value:async options=>{midiRequests++;window.midiRequestOptions=options;return selectableMidiAccess}});
 });
 await reloadStage();await ui('#midi-button').click();await page.waitForFunction(()=>typeof midiOne.onmidimessage==='function'&&typeof midiTwo.onmidimessage==='function');
 assert.equal(await page.evaluate(()=>midiRequests),1);assert.deepEqual(await page.evaluate(()=>midiRequestOptions),{sysex:false});
}

test('real settings select one MIDI device, persist unavailable identity and keep source exports private',testOptions,async()=>{
 await installSelectableMidiInputs();await closeShellPanels();
 await page.evaluate(()=>{const t=performance.now();midiOne.onmidimessage({data:[0x90,60,93],timeStamp:t});midiTwo.onmidimessage({data:[0x90,60,88],timeStamp:t})});
 assert.equal(await page.locator('#keyboard .piano-key.pressed').count(),1);
 await page.evaluate(()=>midiOne.onmidimessage({data:[0x80,60,0],timeStamp:performance.now()}));assert.equal(await page.locator('#keyboard .piano-key.pressed').count(),1,'The second device still holds the same pitch');
 await page.evaluate(()=>midiTwo.onmidimessage({data:[0x80,60,0],timeStamp:performance.now()}));assert.equal(await page.locator('#keyboard .piano-key.pressed').count(),0);
 await ui('#midi-device-select').selectOption('device:private-keyboard-one');
 await page.waitForFunction(()=>typeof midiOne.onmidimessage==='function'&&midiTwo.onmidimessage===null&&midiTwo.connection==='closed');
 assert.match(await page.locator('#midi-device-list').textContent(),/Open/);await closeShellPanels();
 await page.evaluate(()=>{window.oldPracticeHandler=midiOne.onmidimessage;window.oldPracticeTime=performance.now();midiOne.onmidimessage({data:[0x90,60,93],timeStamp:oldPracticeTime})});assert.equal(await page.locator('#keyboard .piano-key.pressed').count(),1);
 await page.evaluate(()=>{midiOne={...midiOne,onmidimessage:null,connection:'closed'};selectableMidiAccess.inputs.set(midiOne.id,midiOne);selectableMidiAccess.onstatechange({port:midiOne,timeStamp:performance.now()})});
 await page.waitForFunction(()=>typeof midiOne.onmidimessage==='function');assert.equal(await page.locator('#keyboard .piano-key.pressed').count(),0);
 await page.evaluate(()=>{midiOne.onmidimessage({data:[0x90,60,99],timeStamp:performance.now()});oldPracticeHandler({data:[0x80,60,44],timeStamp:oldPracticeTime})});assert.equal(await page.locator('#keyboard .piano-key.pressed').count(),1,'An old queued release cannot stop the replacement generation');
 await page.evaluate(()=>midiOne.onmidimessage({data:[0x80,60,41],timeStamp:performance.now()}));assert.equal(await page.locator('#keyboard .piano-key.pressed').count(),0);
 await reloadStage();assert.equal(await page.evaluate(()=>midiRequests),0,'Saved selection does not request permission on page load');
 await ui('#midi-button').click();await page.waitForFunction(()=>typeof midiOne.onmidimessage==='function');assert.equal(await page.evaluate(()=>midiTwo.onmidimessage),null);
 await page.evaluate(()=>{midiOne.state='disconnected';midiOne.connection='pending';selectableMidiAccess.inputs.delete(midiOne.id);selectableMidiAccess.onstatechange({port:midiOne,timeStamp:performance.now()})});
 assert.equal(await page.locator('#midi-device-select').inputValue(),'device:private-keyboard-one');assert.match(await page.locator('#midi-device-select option:checked').textContent(),/unavailable/);assert.equal(await page.locator('#midi-test-toggle').isDisabled(),true);assert.equal(await page.evaluate(()=>midiTwo.onmidimessage),null);
 await ui('#midi-device-select').selectOption('none');assert.equal(await page.evaluate(()=>JSON.parse(localStorage.getItem('worldmusichub.midi-choice')).mode),'none');
 const score=await exportScore();assert.deepEqual(score,initialCompilation.score);assert.doesNotMatch(JSON.stringify(score),/private-keyboard|Fixture keyboard|Private fixture/);
 await writeFile(join(artifactDirectory,'worldmusichub-live-midi-device-selection.json'),JSON.stringify({explicit_single_selection:true,other_input_closed:true,equal_pitch_device_holds_independent:true,replaced_generation_survives_old_queued_release:true,saved_unavailable_input_did_not_fallback:true,permission_requested_only_by_click:true,source_export_unchanged:true,physical_hardware_test:false},null,2));
});

test('real MIDI key test and delayed test callbacks never enter an existing practice take',testOptions,async()=>{
 await installSelectableMidiInputs();await setSessionMode('practice');await ui('#count-in').uncheck();await closeShellPanels();await page.locator('#play-button').click();await page.waitForFunction(()=>globalThis.__wmhReadPlaybackClock().positionMs>100);
 await page.evaluate(()=>{const t=performance.now();midiOne.onmidimessage({data:[0x90,60,92],timeStamp:t});midiOne.onmidimessage({data:[0x80,60,31],timeStamp:t})});
 await page.waitForFunction(()=>document.querySelector('#hud-captured').textContent==='1');await page.locator('#play-button').click();await page.waitForFunction(()=>document.querySelector('.performance-status').dataset.phase!=='grace');
 const before=await exportTakeData();assert.equal(before.passes.length,1);assert.equal(before.passes[0].inputs.length,1);
 await ui('#midi-test-toggle').click();await page.waitForFunction(()=>document.querySelector('#midi-settings').dataset.testing==='true'&&typeof midiOne.onmidimessage==='function'&&typeof midiTwo.onmidimessage==='function');
 await page.evaluate(()=>{window.testModeTimestamp=performance.now();window.oldTestHandler=midiOne.onmidimessage;midiOne.onmidimessage({data:[0x92,67,109],timeStamp:testModeTimestamp});midiTwo.onmidimessage({data:[0x92,67,88],timeStamp:testModeTimestamp})});
 assert.match(await page.locator('#midi-test-last-note').textContent(),/G4/);assert.equal(await page.locator('#midi-test-channel').textContent(),'3');assert.equal(await page.locator('#midi-test-velocity').textContent(),'88');assert.equal(await page.locator('#midi-test-held').textContent(),'Held pitches: 1 / input contacts: 2; notes: G4');
 await page.evaluate(()=>midiOne.onmidimessage({data:[0x82,67,17],timeStamp:performance.now()}));assert.equal(await page.locator('#midi-test-held').textContent(),'Held pitches: 1 / input contacts: 1; notes: G4');assert.equal(await page.locator('#midi-test-velocity').textContent(),'17');
 await page.setViewportSize({width:844,height:390});await page.locator('#midi-test-scroll').scrollIntoViewIfNeeded();
 await page.evaluate(()=>midiOne.onmidimessage({data:[0x92,67,100],timeStamp:performance.now()}));
 const monitorGeometry=await page.locator('#midi-test-scroll').evaluate(element=>{const r=element.getBoundingClientRect(),key=element.querySelector('[data-midi-test-pitch="67"]'),k=key.getBoundingClientRect();const hit=(x,y)=>{const target=document.elementFromPoint(x,y);return Boolean(target&&(target===element||element.contains(target)))};return{width:r.width,height:r.height,documentWidth:document.documentElement.scrollWidth,viewport:{width:innerWidth,height:innerHeight},topReachable:hit(r.x+r.width/2,r.y+3),bottomReachable:hit(r.x+r.width/2,r.bottom-3),heldKeyVisible:k.left>=r.left&&k.right<=r.right&&hit(k.x+k.width/2,k.y+k.height/2)}});
 assert.ok(monitorGeometry.documentWidth<=844);assert.ok(monitorGeometry.width<=844);assert.ok(monitorGeometry.height>=80);assert.equal(monitorGeometry.topReachable,true);assert.equal(monitorGeometry.bottomReachable,true);assert.equal(monitorGeometry.heldKeyVisible,true);
 await page.screenshot({path:join(artifactDirectory,'worldmusichub-live-midi-key-test-844x390.png'),fullPage:true});
 await page.locator('#settings-dialog [data-close-panel]').click();await page.waitForFunction(()=>document.querySelector('#midi-settings').dataset.testing==='false'&&typeof midiOne.onmidimessage==='function'&&typeof midiTwo.onmidimessage==='function');
 await page.evaluate(()=>{oldTestHandler({data:[0x90,68,95],timeStamp:testModeTimestamp});midiOne.onmidimessage({data:[0x90,69,95],timeStamp:testModeTimestamp});midiOne.onmidimessage({data:[0x90,70,95]})});
 const after=await exportTakeData();assert.deepEqual(after.passes,before.passes);assert.equal(await page.locator('#keyboard .piano-key.pressed').count(),0);
 const added=after.input_evidence.events.slice(before.input_evidence.events.length);assert.ok(added.length>0);assert.ok(added.every(event=>event.kind==='boundary'&&['midi_key_test','midi_test_boundary'].includes(event.reason)),'Only explicit mode boundaries may be added, never test note events');
 const unchanged=structuredClone(after);unchanged.input_evidence.events=before.input_evidence.events;assert.equal(unchanged.midi_routing.excluded_ambiguous_messages,1);delete unchanged.midi_routing;assert.deepEqual(unchanged,before);
 assert.doesNotMatch(JSON.stringify(after),/private-keyboard|Fixture keyboard|Private fixture/);await ui('#midi-test-toggle').waitFor();assert.match(await page.locator('#midi-timing-status').textContent(),/1 timing-ambiguous/);
 await writeFile(join(artifactDirectory,'worldmusichub-live-midi-key-test.json'),JSON.stringify({practice_inputs_before:1,practice_inputs_after:after.passes[0].inputs.length,test_contacts_same_pitch:2,delayed_test_callbacks_excluded:2,missing_timestamp_excluded:1,source_identifiers_absent_from_export:true,monitorGeometry,physical_hardware_test:false},null,2));
});

test('short-landscape following reveals later systems with non-color cues and preserves a paused take during manual scrolling', {timeout:60_000}, async()=>{
  await page.setViewportSize({width:844,height:390});await page.emulateMedia({reducedMotion:'reduce'});
  const score=structuredClone(fixture),beat=n=>({numerator:n,denominator:1}),seed=score.parts[0].notes[0];
  score.id='original-pane-reveal-study';score.title='Original pane reveal study';score.tempo=[{at:beat(0),bpm:120}];score.repeats=[];
  score.measures=Array.from({length:6},(_,index)=>({number:7,at:beat(index*4),length:beat(4)}));
  score.parts[0].notes=Array.from({length:6},(_,index)=>({...structuredClone(seed),id:`reveal-note-${index}`,at:beat(index*4),duration:beat(4),pitch:{step:'C',alter:0,octave:4},tie_start:false,tie_stop:false}));
  await ui('#score-file').setInputFiles({name:'original-pane-reveal-study.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(score))});await readyForTitle(score.title);await waitForEngraving();
  await setSessionMode('practice');await ui('#count-in').uncheck();await ui('#reset-button').click();await closeShellPanels();
  await page.waitForFunction(()=>document.querySelector('#written-cursor-status').dataset.status==='ready');
  const stageBefore=await page.evaluate(()=>{const box=document.querySelector('.transport').getBoundingClientRect();return{windowX:scrollX,windowY:scrollY,transport:{x:box.x,y:box.y,width:box.width,height:box.height}}});
  await ui('#engraving-follow').check();await page.locator('#play-button').click();await waitForPlaybackClockAdvance(page);await page.locator('#stage-title').click();await page.keyboard.press('a');await page.waitForFunction(()=>document.querySelector('#hud-captured').textContent==='1');
  await page.waitForFunction(()=>Number(document.querySelector('#written-cursor-status').dataset.sourceMeasureIndex)>=3);await page.locator('#play-button').click();await page.waitForFunction(()=>document.querySelector('.performance-status').dataset.phase!=='grace');
  const cueVisible=()=>{const cue=document.querySelector('.engraving-expected-cue:not([hidden])'),dock=document.querySelector('#notation-lane-overlay');if(!cue)return false;const head=cue.getBoundingClientRect(),pane=dock.getBoundingClientRect();return head.width>0&&head.height>0&&head.left>=pane.left&&head.right<=pane.right&&head.top>=pane.top&&head.bottom<=pane.bottom};
  await page.waitForFunction(cueVisible);
  const current=await page.evaluate(()=>({ids:[...document.querySelectorAll('.engraving-expected-cue:not([hidden])')].map(node=>node.dataset.sourceNoteId),measure:Number(document.querySelector('#written-cursor-status').dataset.sourceMeasureIndex),scrollTop:document.querySelector('#notation-lane-overlay').scrollTop,range:document.querySelector('#engraving-range').textContent,focus:document.activeElement?.id}));
  assert.deepEqual(current.ids,[`reveal-note-${current.measure}`]);assert.ok(current.measure>=3&&current.scrollTop>0);assert.match(current.range,/Measures 1–6/);assert.equal(current.focus,'play-button','Revealing a glyph does not move focus');
  const take=await exportTakeData(),position=(await page.locator('#progress').evaluate(readPlaybackClock)).positionMs;assert.equal(take.passes[0].inputs.length,1);
  const dock=page.locator('#notation-lane-overlay');await revealControl(page.locator('#notation-pan-up'));
  const scrollSteps=await dock.evaluate(element=>Math.ceil(element.scrollTop/(element.clientHeight*.65))+1);
  for(let step=0;step<scrollSteps;step++)await page.locator('#notation-pan-up').click();
  await page.waitForFunction(()=>!document.querySelector('#engraving-follow').checked&&document.querySelector('#notation-lane-overlay').scrollTop===0);
  await page.evaluate(async()=>{for(let frame=0;frame<3;frame++)await new Promise(resolve=>requestAnimationFrame(resolve))});
  assert.equal(await dock.evaluate(element=>element.scrollTop),0,'Manual scrolling is not pulled back on the next frame');assert.equal(await page.evaluate(cueVisible),false,'The later system can stay offscreen in manual mode');
  await ui('#engraving-follow').check();await page.waitForFunction(cueVisible);assert.equal((await page.locator('#progress').evaluate(readPlaybackClock)).positionMs,position);
  const followedScroll=await dock.evaluate(element=>element.scrollTop);await ui('#notation-pan-up').focus();await page.keyboard.press('Enter');assert.equal(await ui('#engraving-follow').isChecked(),false,'Keyboard activation of the external scroll control suspends following');assert.ok(await dock.evaluate(element=>element.scrollTop)<followedScroll,'Keyboard navigation moves the actual painted overlay');
  await ui('#engraving-follow').check();await page.waitForFunction(cueVisible);await screenshot('verified-pane-reveal-844x390');
  const stageAfter=await page.evaluate(()=>{const box=document.querySelector('.transport').getBoundingClientRect();return{windowX:scrollX,windowY:scrollY,transport:{x:box.x,y:box.y,width:box.width,height:box.height}}});assert.deepEqual(stageAfter,stageBefore,'Owned pane reveal never scrolls or moves the stage and transport');
  await page.setViewportSize({width:1000,height:500});await page.waitForFunction(cueVisible);assert.deepEqual(await exportTakeData(),take,'Follow, manual scroll, re-enable and resize preserve every paused input and clock segment');assert.equal((await page.locator('#progress').evaluate(readPlaybackClock)).positionMs,position);assert.deepEqual(await exportScore(),score);
  await writeFile(join(artifactDirectory,'worldmusichub-live-verified-pane-reveal.json'),JSON.stringify({current,stageBefore,stageAfter,paused_take_unchanged:true,reduced_motion:true,manual_scroll_suspended:true},null,2));
});

test('real whole-phrase guitar route honors editable locks, exposes conflicts and preserves a paused take', {timeout:60_000}, async()=>{
  await page.setViewportSize({width:1280,height:720});await hideNotation();await ui('#instrument').selectOption('guitar');await setSessionMode('listen');await ui('#count-in').uncheck();
  await ui('#guitar-frets').fill('5');await ui('#instrument-apply').click();await ui('#play-button:not([disabled])').waitFor();
  const score=structuredClone(fixture),beat=n=>({numerator:n,denominator:1}),seed=score.parts[0].notes[0];
  score.id='original-whole-phrase-route';score.title='Original held E guitar route';score.measures=[{number:1,at:beat(0),length:beat(4)},{number:2,at:beat(4),length:beat(4)}];
  score.parts[0].notes=[{...structuredClone(seed),id:'held-e',at:beat(0),duration:beat(8),pitch:{step:'E',alter:0,octave:4}},{...structuredClone(seed),id:'later-g',at:beat(4),duration:beat(4),pitch:{step:'G',alter:0,octave:4},voice:'2'}];
  const watchPlan=predicate=>page.waitForResponse(response=>new URL(response.url()).pathname==='/api/fingering/guitar'&&response.request().method()==='POST'&&response.request().postDataJSON().score.id===score.id&&predicate(response.request().postDataJSON()),{timeout:15_000});
  const initialResponse=watchPlan(body=>body.locks.length===0);
  await ui('#score-file').setInputFiles({name:'original-whole-phrase-route.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(score))});await readyForTitle(score.title);await hideNotation();await setSessionMode('practice');await ui('#play-button:not([disabled])').waitFor();await closeShellPanels();
  const initial=await responseJson(await initialResponse);assert.equal(initial.status,'ready');assert.equal(initial.assignments.length,2);
  const held=initial.assignments.find(choice=>choice.source_note_ids.includes('held-e')),later=initial.assignments.find(choice=>choice.source_note_ids.includes('later-g'));
  assert.equal(held.string,2);assert.equal(held.fret,5,'Whole-phrase lookahead must reserve the high E string for the later G');assert.equal(later.string,1);assert.equal(later.fret,3);
  await page.waitForFunction(()=>document.querySelector('#guitar-planning').dataset.status==='ready'&&[...document.querySelectorAll('.guitar-target')].every(card=>JSON.parse(card.dataset.route).length===1));
  const routes=await page.locator('.guitar-target').evaluateAll(cards=>cards.map(card=>({id:card.dataset.targetId,route:JSON.parse(card.dataset.route)})));
  for(const card of routes){const assignment=initial.assignments.find(choice=>choice.occurrence_id===card.id);assert.deepEqual(card.route,[{string:assignment.string,fret:assignment.fret,finger:assignment.finger}]);}
  assert.equal(await page.locator('#guitar-show-alternatives').isChecked(),false);assert.equal(await page.locator('#guitar-show-picking').isChecked(),false);
  await page.waitForFunction(()=>document.querySelectorAll('#fretboard [data-recommended="true"]').length===1);
  const chosen=page.locator('#fretboard [data-recommended="true"]');assert.equal(await chosen.getAttribute('data-string'),'1');assert.equal(await chosen.getAttribute('data-fret'),'5');assert.equal(await page.locator('#fretboard .pitch-option').count(),0);
  await page.locator('#play-button').click();await waitForPlaybackClockAdvance(page);await page.locator('#stage-title').click();await page.keyboard.press('i');await page.waitForFunction(()=>document.querySelector('#hud-captured').textContent==='1');await page.locator('#play-button').click();await page.waitForFunction(()=>document.querySelector('.performance-status').dataset.phase!=='grace');
  const before=await exportTakeData();assert.equal(before.passes[0].inputs.length,1);
  await page.locator('#guitar-plan-controls summary').click();await page.locator('#guitar-lock-source').selectOption('held-e');await page.locator('#guitar-lock-string').selectOption('1');await page.locator('#guitar-lock-fret').selectOption('0');await page.locator('#guitar-lock-finger').selectOption('0');
  const blockedResponse=watchPlan(body=>body.locks.some(lock=>lock.source_note_id==='held-e'&&lock.string===1));await page.locator('#guitar-apply-lock').click();const blocked=await responseJson(await blockedResponse);
  assert.equal(blocked.status,'infeasible_under_model');assert.equal(blocked.complete,false);assert.deepEqual(blocked.assignments,[]);
  await page.waitForFunction(()=>document.querySelector('#guitar-planning').dataset.status==='infeasible_under_model'&&[...document.querySelectorAll('.guitar-target')].every(card=>JSON.parse(card.dataset.route).length===0));
  assert.match(await page.locator('#guitar-plan-diagnostics').textContent(),/later-g/);assert.equal(await page.locator('#fretboard [data-recommended="true"]').count(),0);assert.equal(await page.locator('.guitar-target').count(),2,'Unresolved fingering must not remove original targets');
  const localeRequests=getRequestsForLocale();
  await page.locator('#guitar-lock-fret').selectOption('2');await page.locator('#guitar-lock-fret').focus();
  await assertLocaleRoundTrip(page,{root:'#guitar-planning',message:{selector:'#guitar-plan-status',key:'guitar.runtime.status.infeasible_under_model'}});
  assert.deepEqual(getRequestsForLocale(),localeRequests,'Relabeling a conflicting guitar lock keeps its applied plan and pending field draft without another Rust request');
  assert.equal(await page.locator('#guitar-lock-fret').inputValue(),'2');assert.match(await page.locator('#guitar-lock-list').textContent(),/held-e/);
  await page.locator('#guitar-show-alternatives').check();await page.waitForFunction(()=>document.querySelectorAll('#fretboard .pitch-option').length>0);await page.locator('#guitar-show-alternatives').uncheck();
  const restoredResponse=watchPlan(body=>body.locks.length===0);await page.locator('#guitar-remove-lock').click();const restored=await responseJson(await restoredResponse);assert.equal(restored.status,'ready');assert.deepEqual(restored.assignments,initial.assignments);
  await page.waitForFunction(()=>document.querySelector('#guitar-planning').dataset.status==='ready');await page.locator('#guitar-show-picking').check();assert.match(await page.locator('.guitar-target-picking').first().textContent(),/suggestion/);await page.locator('#guitar-plan-controls summary').click();
  assert.deepEqual(await exportTakeData(),before,'Lock editing and replanning never reset or rewrite a paused practice take');assert.deepEqual(await exportScore(),score);await closeShellPanels();
  await screenshot('whole-phrase-guitar-route');await writeFile(join(artifactDirectory,'worldmusichub-live-guitar-whole-phrase.json'),JSON.stringify({initial,blocked,restored,routes,paused_take_unchanged:true,canonical_score_unchanged:true},null,2));
});

test('real piano hands preserve merged ties and repeat targets through editable locks and conflicting assignments', {timeout:60_000}, async()=>{
  await page.setViewportSize({width:1280,height:720});await hideNotation();
  const score=JSON.parse(await readFile(join(root,'tests/fixtures/original-piano-fingering.json'),'utf8'));
  const exported=await rustApi('/api/export/musicxml',score);assert.equal(new Set(exported.note_id_map.segments.map(segment=>segment.source_note_id)).size,5,'Every authored source note must have a valid engraving lane before UI acceptance');
  const watchPlan=predicate=>page.waitForResponse(response=>new URL(response.url()).pathname==='/api/fingering/piano'&&response.request().method()==='POST'&&response.request().postDataJSON().score.id===score.id&&predicate(response.request().postDataJSON()),{timeout:15_000});
  const initialResponse=watchPlan(body=>body.locks.length===0);
  await ui('#score-file').setInputFiles({name:'original-piano-fingering.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(score))});await readyForTitle(score.title);await hideNotation();await setSessionMode('practice');await ui('#count-in').uncheck();await ui('#play-button:not([disabled])').waitFor();await closeShellPanels();
  const initial=await responseJson(await initialResponse);assert.equal(initial.status,'ready');assert.equal(initial.profile.lowest_midi,null,'Existing preset keyboards remain supported');assert.equal(initial.source_occurrence_count,8);assert.equal(initial.physical_target_count,6);
  const compiled=await rustApi('/api/compile',score),physical=await rustApi('/api/practice-targets',{timeline:compiled.timeline,profile:initial.profile});assert.deepEqual(initial.targets.map(target=>target.target_id),physical.timeline.notes.map(note=>note.id));
  const merged=initial.targets.filter(target=>target.source_note_ids.includes('tie-end'));assert.equal(merged.length,2);assert.ok(merged.every(target=>['tie-start','tie-end','unison'].every(id=>target.source_note_ids.includes(id))));assert.notEqual(merged[0].target_id,merged[1].target_id);
  await page.waitForFunction(()=>document.querySelector('#piano-fingering-status').dataset.phase==='ready');await page.locator('#piano-fingering-guidance>summary').click();await page.waitForFunction(()=>document.querySelectorAll('.piano-finger-target').length===6);
  assert.equal(await page.locator('#piano-fingering-guidance').getAttribute('aria-live'),'off');const key=page.locator('#keyboard [data-midi="60"]');assert.equal(await key.getAttribute('aria-label'),'Play C4');assert.equal(await key.getAttribute('aria-pressed'),'false');assert.equal(await key.locator('.piano-finger-label').evaluate(element=>getComputedStyle(element).pointerEvents),'none');
  await page.locator('#play-button').click();await waitForPlaybackClockAdvance(page);await page.locator('#stage-title').click();await page.keyboard.press('r');await page.waitForFunction(()=>document.querySelector('#hud-captured').textContent==='1');await page.locator('#play-button').click();await page.waitForFunction(()=>document.querySelector('.performance-status').dataset.phase!=='grace');
  const take=await exportTakeData();assert.equal(take.passes[0].inputs.length,1);
  if(!await ui('#instrument-settings').evaluate(element=>element.open))await ui('#instrument-settings>summary').click();if(!await ui('.piano-lock-editor').evaluate(element=>element.open))await ui('.piano-lock-editor>summary').click();await ui('#piano-source-note').selectOption('tie-end');
  const leftResponse=watchPlan(body=>body.locks.some(lock=>lock.source_note_id==='tie-end'&&lock.hand==='left'&&lock.finger===null));await ui('#piano-source-hand').selectOption('left');assert.equal((await responseJson(await leftResponse)).status,'ready');
  const fingerResponse=watchPlan(body=>body.locks.some(lock=>lock.source_note_id==='tie-end'&&lock.hand==='left'&&lock.finger===5));await ui('#piano-source-finger').selectOption('5');const leftPlan=await responseJson(await fingerResponse);assert.equal(leftPlan.status,'ready');assert.ok(leftPlan.assignments.filter(choice=>choice.source_note_ids.includes('tie-end')).every(choice=>choice.hand==='left'&&choice.finger===5));
  await page.waitForFunction(()=>document.querySelector('#piano-fingering-status').dataset.phase==='ready');
  await ui('#piano-source-finger').focus();const localeRequests=getRequestsForLocale();
  await assertLocaleRoundTrip(page,{root:'#piano-fingering-settings',message:{selector:'#piano-fingering-title',key:'piano.runtime.title'}});
  assert.deepEqual(getRequestsForLocale(),localeRequests,'Relabeling an applied piano lock cannot request a different plan');
  assert.equal(await ui('#piano-source-note').inputValue(),'tie-end');assert.equal(await ui('#piano-source-hand').inputValue(),'left');assert.equal(await ui('#piano-source-finger').inputValue(),'5');
  await closeShellPanels();assert.equal(await key.locator('.piano-finger-label').textContent(),'L5');assert.equal(await key.getAttribute('aria-pressed'),'false','A recommendation never becomes a held input');
  await ui('#piano-source-note').selectOption('unison');const conflictResponse=watchPlan(body=>body.locks.some(lock=>lock.source_note_id==='unison'&&lock.hand==='right'));await ui('#piano-source-hand').selectOption('right');const conflict=await responseJson(await conflictResponse);
  assert.equal(conflict.status,'infeasible_under_model');assert.deepEqual(conflict.assignments,[]);assert.equal(conflict.targets.length,6);await page.waitForFunction(()=>document.querySelector('#piano-fingering-status').dataset.phase==='unavailable');assert.match(await ui('#piano-fingering-issues').textContent(),/tie-end/);assert.match(await ui('#piano-fingering-issues').textContent(),/unison/);assert.equal(await page.locator('.piano-finger-label').count(),0);
  const restoredResponse=watchPlan(body=>body.locks.length===1&&body.locks[0].source_note_id==='tie-end');await ui('#piano-lock-remove').click();const restored=await responseJson(await restoredResponse);assert.equal(restored.status,'ready');
  await ui('#piano-left-reach').fill('8');await page.waitForFunction(()=>document.querySelector('#piano-guidance-state').textContent.includes('Settings edited'));assert.equal(await page.locator('.piano-finger-label').count(),0,'Unapplied reach edits immediately invalidate visible guidance');
  const discardResponse=watchPlan(body=>body.left_hand.max_span_semitones===12&&body.locks.length===1);await ui('#piano-fingering-discard').click();assert.equal((await responseJson(await discardResponse)).status,'ready');await page.waitForFunction(()=>document.querySelector('#piano-fingering-status').dataset.phase==='ready');
  assert.deepEqual(await exportTakeData(),take,'Hand/finger editing and failed plans preserve the complete paused take');assert.deepEqual(await exportScore(),score);await closeShellPanels();await screenshot('piano-two-hand-guidance');
  await page.locator('#piano-fingering-guidance>summary').click();await page.setViewportSize({width:844,height:390});await page.emulateMedia({reducedMotion:'reduce'});await page.locator('#notation-toggle').click();await waitForEngraving();
  const withNotice=await simultaneousStageGeometry(),position=(await page.locator('#progress').evaluate(readPlaybackClock)).positionMs;assert.equal(await page.locator('#notice').isVisible(),true);assert.match(await page.locator('#notice-message').textContent(),/Complete score download/);
  await page.locator('#notice-dismiss').focus();await page.keyboard.press('Enter');assert.equal(await page.locator('#notice').isVisible(),false);assert.equal(await page.evaluate(()=>document.activeElement.id),'stage-title');
  const geometry=await simultaneousStageGeometry();assertSimultaneousPiano(geometry);assert.ok(geometry.canvasVisible.height>withNotice.canvasVisible.height,'Explicit dismissal restores space without hiding messages automatically');assert.equal((await page.locator('#progress').evaluate(readPlaybackClock)).positionMs,position);assert.deepEqual(await exportTakeData(),take,'Dismissing a status message does not alter the paused take');
  await ui('#notice-history>summary').click();assert.match(await ui('#notice-history-list').textContent(),/Complete score download/);await closeShellPanels();await screenshot('piano-two-hand-guidance-844x390');
  await writeFile(join(artifactDirectory,'worldmusichub-live-piano-two-hands.json'),JSON.stringify({initial,leftPlan,conflict,restored,withNotice,geometry,notice_dismissed_by_user:true,paused_take_unchanged:true,canonical_score_unchanged:true},null,2));
});

/** Actual rendered clipping, including each overflow ancestor; no mocked boxes. */
async function actualMarkerVisibility(selector) {
  return page.locator(selector).evaluateAll(nodes=>nodes.map(node=>{
    const r=node.getBoundingClientRect(),clip={left:Math.max(0,r.left),top:Math.max(0,r.top),right:Math.min(innerWidth,r.right),bottom:Math.min(innerHeight,r.bottom)};
    let painted=true;
    for(let parent=node;parent;parent=parent.parentElement){
      const style=getComputedStyle(parent);if(style.display==='none'||style.visibility!=='visible'||Number(style.opacity)===0)painted=false;
      if(parent instanceof SVGElement&&!(parent instanceof SVGSVGElement))continue;
      const box=parent.getBoundingClientRect(),html=parent instanceof HTMLElement;
      const left=box.left+(html?parent.clientLeft:0),top=box.top+(html?parent.clientTop:0);
      if(/^(auto|scroll|hidden|clip|overlay)$/.test(style.overflowX)){clip.left=Math.max(clip.left,left);clip.right=Math.min(clip.right,html?left+parent.clientWidth:box.right)}
      if(/^(auto|scroll|hidden|clip|overlay)$/.test(style.overflowY)){clip.top=Math.max(clip.top,top);clip.bottom=Math.min(clip.bottom,html?top+parent.clientHeight:box.bottom)}
    }
    const fraction=r.width*r.height>0?Math.max(0,clip.right-clip.left)*Math.max(0,clip.bottom-clip.top)/(r.width*r.height):0;
    return{id:node.dataset.noteId,occurrences:node.dataset.occurrenceIds?JSON.parse(node.dataset.occurrenceIds):[],string:node.dataset.string,text:node.textContent,painted,fraction,width:r.width,height:r.height};
  }));
}

test('dense real Jianpu separates every chord and voice without shrinking glyphs or losing scroll access', {timeout:60_000}, async()=>{
  await page.setViewportSize({width:1280,height:720});await ui('#jianpu-button').click();
  const score=densePianoforte(),compiled=await rustApi('/api/compile',score);assert.equal(compiled.timeline.notes.length,192);
  await ui('#score-file').setInputFiles({name:'original-dense-jianpu.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(score))});await readyForTitle(score.title);
  await ui('#jianpu-button').click();await ui('#engraving-follow').uncheck();
  for(let attempt=0;attempt<12&&await page.locator('#notation [data-note-id="dense-0-1-0"]').count()===0;attempt++)await ui('#notation-next').click();
  const evidence=[];
  for(const viewport of [{width:1280,height:720},{width:844,height:390},{width:390,height:844}]){
    await page.setViewportSize(viewport);await page.waitForFunction(()=>document.querySelectorAll('#notation .score-note').length===193);
    const geometry=await page.locator('#notation').evaluate(container=>{
      const svg=container.querySelector('svg');return{clientWidth:container.clientWidth,scrollWidth:container.scrollWidth,svgWidth:svg.getBoundingClientRect().width,
        notes:[...svg.querySelectorAll('.score-note')].map(note=>{const b=note.getBBox();return{id:note.dataset.noteId,x:b.x,y:b.y,width:b.width,height:b.height,font:parseFloat(getComputedStyle(note.querySelector('.jianpu-note')).fontSize)}})};
    });
    assert.deepEqual(geometry.notes.map(n=>n.id),score.parts[0].notes.map(n=>n.id));assert.ok(geometry.scrollWidth>geometry.clientWidth,'Dense notation remains horizontally scrollable');
    for(const note of geometry.notes)assert.ok(note.font>=25&&note.width>0&&note.height>0,`Readable original-size glyph ${note.id}`);
    for(let i=0;i<geometry.notes.length;i++)for(let j=i+1;j<geometry.notes.length;j++){
      const a=geometry.notes[i],b=geometry.notes[j];assert.ok(a.x+a.width<=b.x||b.x+b.width<=a.x||a.y+a.height<=b.y||b.y+b.height<=a.y,`Rendered notation overlaps: ${a.id} / ${b.id} at ${viewport.width}x${viewport.height}`);
    }
    await page.locator('#notation [data-note-id="dense-31-2-2"]').scrollIntoViewIfNeeded();
    const last=await actualMarkerVisibility('#notation [data-note-id="dense-31-2-2"]');assert.equal(last.length,1);assert.ok(last[0].painted&&last[0].fraction>=.95,'Later dense notes remain readable through real scroll controls');
    assert.equal(await ui('#engraving-follow').isChecked(),false);await screenshot(`dense-jianpu-${viewport.width}x${viewport.height}`);evidence.push({viewport,geometry,last});
  }
  assert.deepEqual(await exportScore(),score,'Presentation never drops, revoices or rewrites canonical events');
  await writeFile(join(artifactDirectory,'worldmusichub-live-dense-jianpu.json'),JSON.stringify({original_fixture:true,events:193,evidence,canonical_score_unchanged:true},null,2));
});


test('real guitar current and next six-note recommendations are entirely visible beside the score', {timeout:60_000}, async()=>{
  await page.setViewportSize({width:1280,height:720});await ui('#instrument').selectOption('guitar');await ui('#jianpu-button').click();
  const score=originalGuitarChordTransitions();
  const planResponse=page.waitForResponse(response=>new URL(response.url()).pathname==='/api/fingering/guitar'&&response.request().postDataJSON()?.score?.id===score.id);
  await ui('#score-file').setInputFiles({name:'original-guitar-chords.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(score))});await readyForTitle(score.title);
  const plan=await responseJson(await planResponse);assert.equal(plan.status,'ready');assert.equal(plan.assignments.length,18);
  await setSessionMode('practice');await ui('#count-in').uncheck();await ui('#play-button:not([disabled])').waitFor();await closeShellPanels();
  await page.locator('#play-button').click();await page.waitForFunction(()=>globalThis.__wmhReadPlaybackClock().positionMs>0);await page.locator('#play-button').click();
  await page.waitForFunction(()=>document.querySelector('#guitar-live-route')?.dataset.currentCount==='6'&&document.querySelector('#guitar-live-route')?.dataset.nextCount==='6');
  const take=await exportTakeData(),position=(await page.locator('#progress').evaluate(readPlaybackClock)).positionMs;assert.ok(position<1500);
  const evidence=[];
  for(const viewport of [{width:1280,height:720},{width:844,height:390}]){
    await page.setViewportSize(viewport);await ui('#jianpu-button').click();
    const current=await actualMarkerVisibility('.guitar-live-current .guitar-live-choice'),next=await actualMarkerVisibility('.guitar-live-next .guitar-live-choice');
    assert.equal(current.length,6);assert.equal(next.length,6);
    assert.deepEqual(new Set(current.flatMap(x=>x.occurrences)),new Set(plan.assignments.filter(x=>x.onset_index===0).map(x=>x.occurrence_id)));
    assert.deepEqual(new Set(next.flatMap(x=>x.occurrences)),new Set(plan.assignments.filter(x=>x.onset_index===1).map(x=>x.occurrence_id)));
    for(const marker of [...current,...next])assert.ok(marker.painted&&marker.fraction>=.98&&marker.height>=24,`Entire chosen guitar position must be visible: ${JSON.stringify({viewport,marker})}`);
    assert.equal(await page.locator('#guitar-show-alternatives').isChecked(),false);assert.match(await page.locator('#guitar-live-transition').textContent(),/Chosen frets/);
    assert.equal((await page.locator('#progress').evaluate(readPlaybackClock)).positionMs,position);evidence.push({viewport,current,next});await screenshot(`guitar-complete-chords-${viewport.width}x${viewport.height}`);
  }
  assert.deepEqual(await exportTakeData(),take);assert.deepEqual(await exportScore(),score);
  await writeFile(join(artifactDirectory,'worldmusichub-live-complete-guitar-chords.json'),JSON.stringify({plan,evidence,paused_take_unchanged:true,canonical_score_unchanged:true},null,2));
});

async function prepareKeyboardBrowserPractice(id) {
  await hideNotation();
  const score = keyboardBrowserScore(id);
  await ui('#score-file').setInputFiles({name:`${id}.json`,mimeType:'application/json',buffer:Buffer.from(JSON.stringify(score))});
  await readyForTitle(score.title);
  await hideNotation();
  await setSessionMode('practice');
  await ui('#count-in').uncheck();
  await ui('#play-button:not([disabled])').waitFor();
  await closeShellPanels();
  return score;
}

function assertTypingEvidence(take, expectedMidi) {
  const observed = take.input_evidence.events.filter(event => event.input_kind === 'typing_keyboard' && ['note_on','note_off'].includes(event.kind));
  assert.deepEqual(observed.filter(event => event.kind === 'note_on').map(event => event.midi),expectedMidi);
  assert.equal(observed.filter(event => event.kind === 'note_off').length,expectedMidi.length);
  for (let index=0; index<expectedMidi.length; index++) {
    const [on,off] = observed.slice(index*2,index*2+2);
    assert.equal(on.kind,'note_on'); assert.equal(off.kind,'note_off');
    assert.equal(on.source_id,off.source_id); assert.equal(off.midi,null);
    assert.equal(on.encoding,'key_down'); assert.equal(off.encoding,'key_up');
    assert.equal(on.timestamp_basis,'event_monotonic'); assert.equal(off.timestamp_basis,'event_monotonic');
    assert.ok(off.event_wall_ms>=on.event_wall_ms);
    assert.ok(on.onset_capture && Number.isInteger(on.onset_capture.event_id));
  }
}

test('real language picker starts from Chinese and preserves the paused take, source and form controls',testOptions,async()=>{
  // The shared bootstrap proves a fresh zh-CN page before its explicit English choice.
  const score = await prepareKeyboardBrowserPractice('original-locale-picker');
  await page.locator('#play-button').click();
  await waitForPlaybackClockAdvance(page);
  await page.locator('#stage-title').click(); await page.keyboard.press('r');
  await page.locator('#settings-button').click();
  assert.match(await page.locator('#play-button').textContent(),/Play/,'Entering Settings deliberately pauses playback');
  const position = (await page.locator('#progress').evaluate(readPlaybackClock)).positionMs;
  const before = await exportTakeData();
  await page.locator('#settings-button').click();
  const compileCount = requests.filter(request=>request.path==='/api/compile').length;
  const values = await page.locator('#settings-dialog input,#settings-dialog select,#settings-dialog textarea').evaluateAll(elements=>elements.filter(element=>element.id!=='interface-language').map(element=>({id:element.id,value:element.value,checked:element.checked})));
  for (const [locale,label,tempoAria,keyAria] of [['zh-CN','界面语言','速度，每分钟拍数','弹奏 C4'],['en','Interface language','Tempo in beats per minute','Play C4']]) {
    await page.locator('#interface-language').focus();
    await page.locator('#interface-language').selectOption(locale);
    assert.equal(await page.locator('html').getAttribute('lang'),locale);
    assert.equal(await page.locator('#interface-language').getAttribute('aria-label'),label);
    assert.equal(await page.locator('#tempo').getAttribute('aria-label'),tempoAria);
    assert.equal(await page.locator('#keyboard [data-midi="60"]').getAttribute('aria-label'),keyAria);
    assert.equal(await page.evaluate(()=>document.activeElement.id),'interface-language');
    assert.equal(await page.locator('#interface-language').inputValue(),locale);
    assert.equal((await page.locator('#progress').evaluate(readPlaybackClock)).positionMs,position);
    assert.deepEqual(await page.locator('#settings-dialog input,#settings-dialog select,#settings-dialog textarea').evaluateAll(elements=>elements.filter(element=>element.id!=='interface-language').map(element=>({id:element.id,value:element.value,checked:element.checked}))),values);
    assert.deepEqual(await exportTakeData(),before,'Changing display language preserves every paused clock segment, input and evidence event');
    await page.locator('#settings-button').click();
  }
  await page.locator('#keyboard-mapping-details>summary').click();
  const draft='[{"code":"KeyR","offset":0,"label":"原稿 draft","row":"custom"}]';
  await page.locator('#keyboard-mapping-editor').fill(draft);
  const focused = await page.evaluate(async()=>{
    const editor=document.querySelector('#keyboard-mapping-editor');editor.setSelectionRange(3,12);
    const before={value:editor.value,start:editor.selectionStart,end:editor.selectionEnd};
    const {getAppI18n}=await import('/app-locale.js');getAppI18n(document).setLocale('zh-CN');
    return {before,after:{value:editor.value,start:editor.selectionStart,end:editor.selectionEnd},same:document.activeElement===editor};
  });
  assert.equal(focused.same,true,'Service-level relabeling preserves an actively edited form field');
  assert.deepEqual(focused.after,focused.before);
  await page.locator('#interface-language').selectOption('en');
  await closeShellPanels();
  assert.deepEqual(await exportTakeData(),before);
  assert.deepEqual(await exportScore(),score);
  assert.equal(requests.filter(request=>request.path==='/api/compile').length,compileCount,'Locale rendering never recompiles or transposes the score');
  await closeShellPanels();
  await page.reload({waitUntil:'domcontentloaded'});await waitForPlaybackClock(page);
  await page.locator('#interface-language').waitFor({state:'attached'});
  assert.equal(await page.locator('html').getAttribute('lang'),'en','An explicit English choice persists on reload');
  assert.equal(await page.locator('#interface-language').inputValue(),'en');
  await writeFile(join(artifactDirectory,'worldmusichub-live-locale-picker.json'),JSON.stringify({fresh_default:'zh-CN',picker_languages:['en','zh-CN','en'],paused_take_unchanged:true,source_unchanged:true,edited_field_preserved:true,persisted_locale:'en'},null,2));
});

test('real running locale-service notifications retain a held note and the advancing canonical clock',testOptions,async()=>{
  const score=await prepareKeyboardBrowserPractice('original-running-locale');await page.evaluate(observeRealAudio);
  // Observe the device used by the production reader, without changing its clock
  // or returned position. This context may predate the oscillator observer.
  await page.evaluate(async()=>{
    const {CanonicalAudioReceiver}=await import('/canonical-audio-receiver.js'),sourceClock=CanonicalAudioReceiver.prototype.sourceClockAtTime;
    CanonicalAudioReceiver.prototype.sourceClockAtTime=function(...args){window.localeAudioContext=this.context;return sourceClock.apply(this,args);};
  });
  await page.locator('#play-button').click();await page.waitForFunction(()=>globalThis.__wmhReadPlaybackClock().positionMs>0);
  await page.locator('#play-button').click();const before=await exportTakeData();
  const compileCount=requests.filter(request=>request.path==='/api/compile').length;
  const resumedFrom=(await page.locator('#progress').evaluate(readPlaybackClock)).positionMs;
  await page.locator('#play-button').click();await waitForPlaybackClockAdvance(page,resumedFrom);await page.locator('#stage-title').click();await page.keyboard.down('r');
  assert.equal(await page.locator('#keyboard [data-midi="60"]').getAttribute('aria-pressed'),'true');
  const snapshots=await page.evaluate(async()=>{
    const {getAppI18n}=await import('/app-locale.js'),i18n=getAppI18n(document),key=document.querySelector('#keyboard [data-midi="60"]');
    const snapshot=()=>({position:globalThis.__wmhReadPlaybackClock().positionMs,pass:document.querySelector('.performance-status').dataset.passId,revision:document.querySelector('.performance-status').dataset.revision,captured:document.querySelector('#hud-captured').textContent,focused:document.activeElement.id,held:key.getAttribute('aria-pressed'),audio:{...audioObservation},sameKey:document.querySelector('#keyboard [data-midi="60"]')===key});
    const original=snapshot(),audio=window.localeAudioContext;
    if(!audio||audio.state!=='running')throw new Error('Locale timing requires the actual running source AudioContext');
    const frame=()=>Math.round(audio.currentTime*audio.sampleRate);
    const localize=locale=>{const wallBefore=performance.now(),frameBefore=frame();i18n.setLocale(locale);const state=snapshot(),frameAfter=frame(),wallAfter=performance.now();return{locale,state,frameBefore,frameAfter,wallBefore,wallAfter,play:document.querySelector('#play-button').textContent,keyLabel:key.getAttribute('aria-label')}};
    // Locale redraws refresh progress from the running clock. Establish a fresh
    // display baseline before measuring changes; the last animation frame may lag.
    const primed=localize('zh-CN'),baseline=localize('en'),localized=[];
    for(const locale of ['zh-CN','en','zh-CN'])localized.push(localize(locale));
    return {original,primed,baseline,localized,sampleRate:audio.sampleRate};
  });
  const {position:originalPosition,...originalState}=snapshots.original;
  for(const item of [snapshots.primed,snapshots.baseline,...snapshots.localized]){const{position,...state}=item.state;assert.deepEqual(state,originalState,'Synchronous display-only notifications preserve held contact, focus, recorder state and audio');assert.ok(position>=originalPosition,'A display-only notification cannot move the running clock backward');assert.match(item.play,item.locale==='en'?/Pause/:/暂停/);assert.equal(item.keyLabel,item.locale==='en'?'Play C4':'弹奏 C4');}
  let previous=snapshots.baseline;
  // AudioContext time advances in device quanta. Compare exact frame deltas to
  // device observations around each redraw, including a legitimate zero quantum.
  for(const item of snapshots.localized){const elapsedFrames=Math.round(item.state.position*snapshots.sampleRate/1000)-Math.round(previous.state.position*snapshots.sampleRate/1000),minimum=Math.max(0,item.frameBefore-previous.frameAfter),maximum=item.frameAfter-previous.frameBefore;assert.ok(elapsedFrames>=minimum&&elapsedFrames<=maximum,JSON.stringify({locale:item.locale,elapsedFrames,minimum,maximum,message:'Progress advances at the actual canonical audio-frame rate within the observed redraw interval'}));previous=item;}
  await page.waitForFunction(position=>globalThis.__wmhReadPlaybackClock().positionMs>position,snapshots.localized.at(-1).state.position);
  assert.equal(await page.locator('#keyboard [data-midi="60"]').getAttribute('aria-pressed'),'true');
  await page.keyboard.up('r');await page.locator('#play-button').click();
  const after=await exportTakeData();
  assert.equal(after.passes.length,1);assert.deepEqual(after.passes[0].inputs.map(input=>input.midi),[60]);
  assert.deepEqual(after.passes[0].timeline,before.passes[0].timeline);assert.equal(after.passes[0].revision,before.passes[0].revision+1);
  assert.deepEqual(after.passes[0].clock_segments.slice(0,-1),before.passes[0].clock_segments);assert.equal(after.passes[0].clock_segments.length,2);
  assert.deepEqual(after.input_evidence.events.slice(0,before.input_evidence.events.length),before.input_evidence.events);
  const added=after.input_evidence.events.slice(before.input_evidence.events.length);assert.deepEqual(added.map(event=>event.kind),['note_on','note_off','boundary']);assert.equal(added.at(-1).reason,'pause');
  assertTypingEvidence(after,[60]);assert.deepEqual(after.keyboard_input_configuration,before.keyboard_input_configuration);
  assert.deepEqual(await exportScore(),score);assert.equal(requests.filter(request=>request.path==='/api/compile').length,compileCount);
  await writeFile(join(artifactDirectory,'worldmusichub-live-locale-running-service.json'),JSON.stringify({method:'Actual running browser; display-locale service notifications, not user picker interaction',snapshots,after,canonical_score_unchanged:true},null,2));
});

test('real wide physical keyboard records every C2 through A sharp 5 pitch with explicit releases',testOptions,async()=>{
  const score=await prepareKeyboardBrowserPractice('original-wide-keyboard');
  assert.equal(await page.locator('#typing-octave').count(),0);
  assert.equal(await page.locator('#keyboard-base-midi').inputValue(),'36');assert.equal(await page.locator('#keyboard-input-offset').inputValue(),'0');
  assert.equal(await page.locator('#keyboard-active-range').getAttribute('data-low-midi'),'36');assert.equal(await page.locator('#keyboard-active-range').getAttribute('data-high-midi'),'82');
  const map=await page.locator('#keyboard-map [data-code]').evaluateAll(elements=>elements.map(element=>({code:element.dataset.code,midi:Number(element.dataset.noteMidi),enabled:element.dataset.enabled,row:element.parentElement.dataset.row})));
  assert.deepEqual(map,wideKeyboardBindings.map(({code,midi,row})=>({code,midi,enabled:'true',row})));
  assert.equal(await page.locator('#keyboard [data-midi="60"] .key-shortcut').textContent(),'R');assert.equal(await page.locator('#keyboard [data-midi="64"] .key-shortcut').textContent(),'I');
  await page.locator('#play-button').click();await waitForPlaybackClockAdvance(page);await page.locator('#stage-title').click();
  for(const binding of wideKeyboardBindings)await page.keyboard.press(binding.key);
  await page.waitForFunction(()=>document.querySelector('#hud-captured').textContent==='47');
  assert.equal(await page.locator('#keyboard .pressed').count(),0);assert.equal(await page.locator('#keyboard-map .held').count(),0);
  const [response]=await Promise.all([nextResponse('/api/assess'),ui('#assess-button').click()]);const assessed=await responseJson(response),submitted=response.request().postDataJSON();
  assert.deepEqual(submitted.inputs.map(input=>input.midi),wideKeyboardBindings.map(binding=>binding.midi));assert.ok(submitted.inputs.every(input=>Number.isFinite(input.at_ms)&&input.at_ms>=0));
  assert.equal(assessed.hits.length+assessed.extras.length,47);assert.equal(assessed.hits.length+assessed.misses.length,2);
  const compiled=await rustApi('/api/compile',score);assert.deepEqual(submitted.timeline,compiled.timeline);
  await ui('#feedback-results').waitFor();const take=await exportTakeData();assertTypingEvidence(take,wideKeyboardBindings.map(binding=>binding.midi));assert.deepEqual(take.passes[0].assessment,assessed);assert.deepEqual(await exportScore(),score);
  await writeFile(join(artifactDirectory,'worldmusichub-live-wide-keyboard.json'),JSON.stringify({map,submitted,assessed,take,canonical_score_unchanged:true},null,2));
});

test('real keyboard input transposition and custom mapping retain performed MIDI without changing score pitches',testOptions,async()=>{
  const score=await prepareKeyboardBrowserPractice('original-custom-keyboard');
  const playKey=async key=>{const previous=(await page.locator('#progress').evaluate(readPlaybackClock)).positionMs;await page.locator('#play-button').click();await waitForPlaybackClockAdvance(page,previous);await page.locator('#stage-title').click();await page.keyboard.press(key);await page.locator('#play-button').click();};
  await playKey('r');const initial=await exportTakeData(),compileCount=requests.filter(request=>request.path==='/api/compile').length;
  await ui('#keyboard-input-offset').fill('2');await ui('#keyboard-settings-apply').click();await closeShellPanels();
  assert.equal(await page.locator('#keyboard [data-midi="62"] .key-shortcut').textContent(),'R');
  const transposedFrom=(await page.locator('#progress').evaluate(readPlaybackClock)).positionMs;
  await page.locator('#play-button').click();await waitForPlaybackClockAdvance(page,transposedFrom);await page.locator('#stage-title').click();await page.keyboard.press('r');await page.keyboard.press('ArrowRight');await page.keyboard.press('r');await page.keyboard.press('ArrowUp');await page.keyboard.press('r');await page.locator('#play-button').click();
  await ui('#keyboard-base-midi').fill('60');await ui('#keyboard-input-offset').fill('0');await ui('#keyboard-settings-apply').click();await ui('#keyboard-preset').selectOption('custom');
  const duplicate=[{code:'KeyR',offset:0,label:'Root',row:'custom'},{code:'KeyI',offset:0,label:'Fifth',row:'custom'}];
  const configuration=await page.locator('#keyboard-map').getAttribute('data-configuration-id');
  await ui('#keyboard-mapping-editor').fill(JSON.stringify(duplicate));await ui('#keyboard-mapping-apply').click();assert.match(await ui('#keyboard-configuration-error').textContent(),/Multiple keys map to the same pitch/);assert.equal(await page.locator('#keyboard-map').getAttribute('data-configuration-id'),configuration);
  const custom=duplicate.map((binding,index)=>({...binding,offset:index*7}));await ui('#keyboard-mapping-editor').fill(JSON.stringify(custom));await ui('#keyboard-mapping-apply').click();assert.equal(await ui('#keyboard-configuration-error').isVisible(),false);assert.equal(await ui('#keyboard-preset').inputValue(),'custom');await closeShellPanels();
  const customFrom=(await page.locator('#progress').evaluate(readPlaybackClock)).positionMs;
  await page.locator('#play-button').click();await waitForPlaybackClockAdvance(page,customFrom);await page.locator('#stage-title').click();await page.keyboard.press('r');await page.keyboard.press('i');await page.locator('#play-button').click();
  const take=await exportTakeData(),performed=[60,62,63,75,60,67];assert.deepEqual(take.passes[0].inputs.map(input=>input.midi),performed);assertTypingEvidence(take,performed);
  assert.deepEqual(take.passes[0].timeline,initial.passes[0].timeline);assert.deepEqual(take.passes[0].timeline.notes.map(note=>note.midi),[60,64]);
  assert.deepEqual(take.keyboard_input_configuration.current_configuration.mapping,custom);assert.equal(take.keyboard_input_configuration.current_configuration.base_midi,60);assert.equal(take.keyboard_input_configuration.current_configuration.transpose_semitones,0);
  assert.ok(take.keyboard_input_configuration.events.some(event=>event.transpose_semitones===2));assert.ok(take.keyboard_input_configuration.events.some(event=>event.transpose_semitones===3));assert.ok(take.keyboard_input_configuration.events.some(event=>event.transpose_semitones===15));assert.ok(take.keyboard_input_configuration.events.every(event=>event.scope==='performance_input_only'));
  assert.equal(requests.filter(request=>request.path==='/api/compile').length,compileCount);assert.equal(requests.filter(request=>request.path.startsWith('/api/transposition')||request.path.startsWith('/api/adaptation')).length,0);assert.deepEqual(await exportScore(),score);
  await writeFile(join(artifactDirectory,'worldmusichub-live-keyboard-input-transposition.json'),JSON.stringify({performed,take,score_pitch_midi:[60,64],canonical_score_unchanged:true},null,2));
});

test('real muted keyboard controls validate MIDI bounds and never create, resume or play audio',testOptions,async()=>{
  await hideNotation();await page.evaluate(observeRealAudio);await page.locator('#sound-button').click();assert.equal(await page.locator('#sound-button').getAttribute('aria-pressed'),'true');
  const baseline=await page.evaluate(()=>({...audioObservation})),compileCount=requests.filter(request=>request.path==='/api/compile').length;
  const initialMap=await page.locator('#keyboard-map').getAttribute('data-configuration-id');
  for(const [selector,value,pattern] of [['#keyboard-base-midi','-1',/base MIDI pitch/],['#keyboard-base-midi','128',/base MIDI pitch/],['#keyboard-input-offset','128',/Input transposition/]]){
    await ui('#keyboard-base-midi').fill('36');await ui('#keyboard-input-offset').fill('0');await ui(selector).fill(value);await ui('#keyboard-settings-apply').click();assert.match(await ui('#keyboard-configuration-error').textContent(),pattern);assert.equal(await page.locator('#keyboard-map').getAttribute('data-configuration-id'),initialMap);
  }
  await ui('#keyboard-base-midi').fill('127');await ui('#keyboard-input-offset').fill('0');await ui('#keyboard-settings-apply').click();assert.equal(await ui('#keyboard-base-midi').getAttribute('min'),'0');assert.equal(await ui('#keyboard-base-midi').getAttribute('max'),'127');assert.equal(await ui('#keyboard-input-offset').getAttribute('min'),'-127');assert.equal(await ui('#keyboard-input-offset').getAttribute('max'),'127');
  assert.equal(await page.locator('#keyboard-map [data-enabled="true"]').count(),1);assert.equal(await page.locator('#keyboard-map [data-enabled="false"]').count(),46);assert.equal(await page.locator('#keyboard-active-range').getAttribute('data-high-midi'),'127');await closeShellPanels();
  await page.locator('#stage-title').click();await page.keyboard.down('z');assert.equal(await page.locator('#keyboard-map [data-code="KeyZ"]').getAttribute('class'),'keyboard-map-key held');await page.keyboard.up('z');await page.keyboard.press('x');assert.equal(await page.locator('#keyboard-map .held').count(),0);
  await page.locator('#keyboard-semitone-down').click();assert.equal(await page.locator('#keyboard-input-offset').inputValue(),'-1');await page.locator('#keyboard-octave-down').click();assert.equal(await page.locator('#keyboard-input-offset').inputValue(),'-13');await page.locator('#keyboard-performance-details>summary').click();await page.locator('#keyboard-offset-reset').click();assert.equal(await page.locator('#keyboard-input-offset').inputValue(),'0');
  await ui('#keyboard-preset').selectOption('legacy');assert.equal(await page.locator('#keyboard-map [data-code]').count(),17);assert.equal(await page.locator('#keyboard-base-midi').inputValue(),'60');await ui('#keyboard-preset').selectOption('wide');assert.equal(await page.locator('#keyboard-map [data-code]').count(),47);assert.equal(await page.locator('#keyboard-base-midi').inputValue(),'36');await closeShellPanels();await page.locator('#stage-title').click();await page.keyboard.press('r');
  assert.deepEqual(await page.evaluate(()=>audioObservation),baseline,'Muted configuration, transposition and manual input cannot initialize or resume an audio graph');assert.equal(requests.filter(request=>request.path==='/api/compile').length,compileCount);assert.deepEqual(await exportScore(),initialCompilation.score);
});

test('real IME and form-focus boundaries release physical notes without inventing note offs or captures',testOptions,async()=>{
  const score=await prepareKeyboardBrowserPractice('original-keyboard-ime');await page.locator('#play-button').click();await waitForPlaybackClockAdvance(page);await page.locator('#stage-title').click();await page.keyboard.down('r');assert.equal(await page.locator('#keyboard [data-midi="60"]').getAttribute('aria-pressed'),'true');
  await page.locator('#stage-title').dispatchEvent('compositionstart',{data:'中'});assert.equal(await page.locator('#keyboard .pressed').count(),0);assert.equal(await page.locator('#keyboard-map .held').count(),0);
  await page.keyboard.press('a');await page.locator('#stage-title').dispatchEvent('keydown',{key:'Process',code:'KeyI',keyCode:229,isComposing:true});await page.keyboard.up('r');await page.locator('#stage-title').dispatchEvent('compositionend',{data:'中文'});
  assert.equal(await page.locator('#hud-captured').textContent(),'1');await page.keyboard.down('i');assert.equal(await page.locator('#keyboard [data-midi="64"]').getAttribute('aria-pressed'),'true');
  await page.locator('#settings-button').click();assert.equal(await page.locator('#keyboard .pressed').count(),0);await page.keyboard.up('i');
  await page.locator('#keyboard-input-offset').focus();await page.keyboard.press('a');await page.keyboard.press('ArrowUp');assert.equal(await page.locator('#keyboard-map').getAttribute('data-configuration-id'),'1','An editable field owns its arrow keys until explicit Apply');
  const take=await exportTakeData();assert.deepEqual(take.passes[0].inputs.map(input=>input.midi),[60,64]);assert.equal(take.passes[0].revision,2);
  const events=take.input_evidence.events,ons=events.filter(event=>event.kind==='note_on');assert.deepEqual(ons.map(event=>event.midi),[60,64]);
  for(const onset of ons){const contact=events.filter(event=>event.source_id===onset.source_id);assert.deepEqual(contact.map(event=>event.kind),['note_on','synthetic_release','note_off']);assert.equal(contact[1].midi,onset.midi);assert.equal(contact[2].midi,null);assert.equal(contact[2].encoding,'key_up');assert.equal(contact[2].input_kind,'typing_keyboard');}
  assert.equal(events.find(event=>event.kind==='synthetic_release'&&event.midi===60).reason,'keyboard_composition');assert.equal(events.filter(event=>event.kind==='note_off').length,2,'Only the two real physical keyups become note-off observations');assert.equal(take.input_evidence.pairing,'not_implemented');assert.equal(take.input_evidence.release_assessment,'not_implemented');assert.deepEqual(await exportScore(),score);
  await writeFile(join(artifactDirectory,'worldmusichub-live-keyboard-ime.json'),JSON.stringify({take,canonical_score_unchanged:true,composition_not_recorded:true,physical_releases_retained:true},null,2));
});

test('real Sound Off scored Start and Play capture silently without creating an AudioContext',testOptions,async()=>{
  await page.addInitScript(observeRealAudio);await page.reload({waitUntil:'domcontentloaded'});await waitForPlaybackClock(page);await page.locator('#home-single-player').click();await page.locator('#start-performance:not([disabled])').waitFor();
  assert.deepEqual(await page.evaluate(()=>audioObservation),{construct:0,resume:0,oscillator:0,start:0,stop:0});
  // Free practice exposes the shared Sound switch before any scored activation.
  // No free recording is started; every sound change is a visible user action.
  await ui('#start-free-practice').click();await page.locator('#free-sound').click();assert.equal(await page.locator('#free-sound').getAttribute('aria-pressed'),'false');await page.locator('#free-exit').click();
  await ui('#count-in').uncheck();await closeShellPanels();await startPreview({reset:false,notation:false,mode:'practice'});assert.equal(await page.locator('#sound-button').getAttribute('aria-pressed'),'true');
  await page.waitForFunction(()=>globalThis.__wmhReadPlaybackClock().positionMs>0);await page.locator('#stage-title').click();await page.keyboard.press('r');await page.locator('#play-button').click();
  const position=(await page.locator('#progress').evaluate(readPlaybackClock)).positionMs;await page.locator('#play-button').click();await page.waitForFunction(previous=>globalThis.__wmhReadPlaybackClock().positionMs>previous,position);await page.locator('#stage-title').click();await page.keyboard.press('i');await page.locator('#play-button').click();
  const take=await exportTakeData();assert.equal(take.passes.length,1);assert.deepEqual(take.passes[0].inputs.map(input=>input.midi),[60,64]);assert.equal(take.passes[0].clock_segments.length,2);assertTypingEvidence(take,[60,64]);
  assert.deepEqual(await page.evaluate(()=>audioObservation),{construct:0,resume:0,oscillator:0,start:0,stop:0},'Silent Start, Play, resume and manual input must not initialize any audio graph');assert.deepEqual(await exportScore(),initialCompilation.score);
});

test('real delayed audio resume cannot start a scored transport after Settings cancels its play ticket',testOptions,async()=>{
  await page.addInitScript(observeRealAudio);await reloadStage();await hideNotation();await setSessionMode('practice');await ui('#count-in').uncheck();await closeShellPanels();
  await page.evaluate(async()=>{
    if(audioObservedContexts.length!==1)throw new Error('Expected one real initialized audio context');
    await audioObservedContexts[0].suspend();
    const prototype=(globalThis.AudioContext||globalThis.webkitAudioContext).prototype,resume=prototype.resume;
    window.audioResumePending=false;
    prototype.resume=function(...args){audioResumePending=true;return new Promise(resolve=>{window.finishAudioResume=async()=>{await resume.apply(this,args);resolve();};});};
  });
  await page.locator('#play-button').click();await page.waitForFunction(()=>audioResumePending);
  assert.equal((await page.locator('#progress').evaluate(readPlaybackClock)).positionMs,0);
  await page.locator('#settings-button').click();await page.evaluate(()=>finishAudioResume());
  await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
  assert.equal((await page.locator('#progress').evaluate(readPlaybackClock)).positionMs,0);assert.match(await page.locator('#play-button').textContent(),/Play/);assert.equal(await page.locator('#export-takes').isDisabled(),true,'A canceled async unlock cannot create a hidden pass');assert.equal(await page.locator('#keyboard .pressed').count(),0);
  await closeShellPanels();await page.locator('#play-button').click();await page.waitForFunction(()=>globalThis.__wmhReadPlaybackClock().positionMs>0);await page.locator('#play-button').click();
  const take=await exportTakeData();assert.equal(take.passes.length,1);assert.deepEqual(take.passes[0].inputs,[]);assert.equal(take.passes[0].clock_segments.length,1);assert.deepEqual(await exportScore(),initialCompilation.score);
});

async function downloadFreeRecord(selector='#free-export-record') {
  if(!await page.locator('#free-recordings').evaluate(node=>node.open))await page.locator('#free-recordings-toggle').click();
  assert.equal(await page.locator(selector).isVisible(),true,'The recording disclosure exposes the real export control');
  const [download]=await Promise.all([page.waitForEvent('download'),page.locator(selector).click()]);
  assert.equal(await download.failure(),null);const text=await readFile(await download.path(),'utf8');
  return {text,data:JSON.parse(text),filename:download.suggestedFilename()};
}
async function enterSilentFreePractice() {
  if(await page.locator('#workspace').isVisible())await page.locator('#back-to-library').click();
  await ui('#start-free-practice').click();await page.locator('#free-practice-screen').waitFor();
  if(await page.locator('#free-sound').getAttribute('aria-pressed')==='true')await page.locator('#free-sound').click();
  assert.equal(await page.locator('#free-sound').getAttribute('aria-pressed'),'false');
}
async function recordAndSaveFreeKeys(label,keys) {
  const previous=await page.locator('#free-record-select option').evaluateAll(options=>options.map(option=>option.value).filter(Boolean));
  await page.locator('#free-start:not([disabled])').click();await page.waitForFunction(()=>document.querySelector('#free-practice-screen').dataset.state==='recording');
  await page.locator('#free-practice-title').focus();for(const key of keys)await page.keyboard.press(key);
  await page.locator('#free-stop').click();await page.waitForFunction(()=>document.querySelector('#free-practice-screen').dataset.state==='stopped');
  const draft=await downloadFreeRecord('#free-export-draft');validatePerformanceRecord(draft.data);
  await page.locator('#free-record-label').fill(label);await page.locator('#free-save').click();await page.locator('#free-start:not([disabled])').waitFor();
  const saved=await downloadFreeRecord();assert.equal(saved.text,draft.text,'Saving only adds library metadata; the immutable record remains byte-for-byte complete');
  const current=await page.locator('#free-record-select option').evaluateAll(options=>options.map(option=>option.value).filter(Boolean)),added=current.filter(key=>!previous.includes(key));assert.equal(added.length,1);
  return {...saved,key:added[0]};
}
function assertFreeMusicalEvents(record,midi) {
  validatePerformanceRecord(record);assert.equal(record.score_context,null);assert.equal(record.mode,'free');assert.equal(record.state,'stopped');assert.ok(Object.values(record.capabilities).every(value=>value===false));
  const ons=record.observations.events.filter(event=>event.kind==='note_on');assert.deepEqual(ons.map(event=>event.midi),midi);assert.ok(ons.every(event=>event.input_kind==='typing_keyboard'&&event.timestamp_basis==='event_monotonic'&&event.onset_capture===null));
  assert.equal(record.observations.pairing,'not_implemented');assert.equal(record.observations.release_assessment,'not_implemented');assert.equal(record.observations.truncated,false);assert.equal(record.observations.omitted_observations,0);
}

test('real no-score Free practice survives an unavailable catalog and saves the complete silent immutable PC record',testOptions,async()=>{
  await page.addInitScript(observeRealAudio);
  const unavailable=route=>route.abort('failed');await page.route('**/api/catalog/index',unavailable);const requestStart=requests.length;
  try{
    const healthResponse=nextResponse('/api/health');
    await page.reload({waitUntil:'domcontentloaded'});await waitForPlaybackClock(page);const health=await responseJson(await healthResponse);
    assert.equal(health.name,'WorldMusicHub');assert.equal(health.engine,'rust');assert.equal(health.score_format_version,1);assert.equal(health.network,'loopback-only');
    await page.waitForFunction(()=>document.querySelector('#catalog-status').textContent.includes('metadata is unavailable')&&document.querySelector('[data-score-storage]').getAttribute('aria-busy')==='false');
    assert.equal(await page.locator('#resume-session').isVisible(),false);assert.equal(await page.locator('#score-tools-button').isDisabled(),true);assert.equal(await page.locator('#start-performance').isDisabled(),true);assert.ok(failedResources.some(failure=>failure.path==='/api/catalog/index'));
    await enterSilentFreePractice();const configuredKeys=Number(await page.locator('#key-count').inputValue());assert.equal(configuredKeys,61);assert.equal(await page.locator('#free-practice-keys [data-midi]').count(),configuredKeys);assert.deepEqual(await page.locator('#free-practice-keys [data-midi]').evaluateAll(keys=>[Number(keys[0].dataset.midi),Number(keys.at(-1).dataset.midi)]),[36,96]);assert.equal(await page.locator('#free-practice-keys [data-code]').count(),47);assert.equal(await page.locator('#free-practice-keys [data-code="KeyR"]').getAttribute('data-midi'),'60');assert.equal(await page.locator('#free-practice-keys [data-code="KeyI"]').getAttribute('data-midi'),'64');
    await page.locator('#free-start').click();await page.locator('#free-practice-title').focus();await page.keyboard.press('r');
    await page.locator('#free-pause').click();await page.locator('#free-practice-title').focus();await page.keyboard.press('i');
    await page.locator('#free-resume').click();await page.locator('#free-practice-title').focus();await page.keyboard.press('i');await page.keyboard.down('p');await page.locator('#free-stop').click();
    const sealed=await downloadFreeRecord('#free-export-draft');assertFreeMusicalEvents(sealed.data,[60,64,64,66]);
    const ons=sealed.data.observations.events.filter(event=>event.kind==='note_on');assert.deepEqual(ons.map(event=>event.segment_id),[1,null,2,2]);assert.equal(ons[1].routing,'outside_recording_segment');assert.equal(sealed.data.segments.length,2);assert.ok(sealed.data.segments[1].start_wall_ms>sealed.data.segments[0].end_wall_ms);
    const heldSource=ons.at(-1).source_id;assert.equal(sealed.data.observations.events.filter(event=>event.source_id===heldSource&&event.kind==='synthetic_release').length,1);assert.equal(sealed.data.observations.events.filter(event=>event.source_id===heldSource&&event.kind==='note_off').length,0);
    const configuration=sealed.data.configuration.find(item=>item.key==='keyboard_configuration').value;assert.equal(configuration.base_midi,36);assert.equal(configuration.transpose_semitones,0);assert.equal(configuration.mapping.length,47);assert.equal(sealed.data.configuration.find(item=>item.key==='sound').value,false);
    await page.keyboard.up('p');await page.locator('#free-practice-title').focus();await page.keyboard.press('r');assert.equal((await downloadFreeRecord('#free-export-draft')).text,sealed.text,'Stop seals the record before late physical release or later keys arrive');
    await page.locator('#free-record-label').fill('Silent PC performance');await page.locator('#free-save').click();await page.locator('#free-start:not([disabled])').waitFor();assert.equal((await downloadFreeRecord()).text,sealed.text);assert.equal(await page.locator('#free-record-select option[value]:not([value=""])').count(),1);
    assert.deepEqual(await page.evaluate(()=>audioObservation),{construct:0,resume:0,oscillator:0,start:0,stop:0});
    assert.deepEqual(requests.slice(requestStart).map(({path,method,body})=>({path,method,body})).sort((a,b)=>a.path.localeCompare(b.path)),[
      {path:'/api/catalog/index',method:'GET',body:null},{path:'/api/health',method:'GET',body:null},
    ],'Only the failed catalog read and verified storage capability probe are allowed; no compilation, targets, assessment or other score requests');
    await writeFile(join(artifactDirectory,'worldmusichub-live-free-no-score.json'),JSON.stringify({catalog_unavailable:true,actual_pc_input:true,audio_calls:await page.evaluate(()=>audioObservation),record:sealed.data,saved_export_unchanged:true},null,2));
  }finally{await page.unroute('**/api/catalog/index',unavailable);}
});

test('real Free A/B selection, import and backup preserve records while fixed-tone preview stays bounded and unscored',testOptions,async()=>{
  await enterSilentFreePractice();await page.evaluate(observeRealAudio);
  await page.evaluate(async()=>{const{Synth}=await import('/transport.js'),play=Synth.prototype.play;window.freePreviewToneCalls=[];Synth.prototype.play=function(...args){if(String(args[0]).startsWith('free-preview:'))freePreviewToneCalls.push({midi:args[1],duration_ms:args[2],instrument:args[4]});return play.apply(this,args);};});
  const requestStart=requests.length,A=await recordAndSaveFreeKeys('A original',['r']);assertFreeMusicalEvents(A.data,[60]);await page.locator('#free-choose-baseline').click();
  const B=await recordAndSaveFreeKeys('B original',['i','p']);assertFreeMusicalEvents(B.data,[64,66]);assert.notEqual(A.key,B.key);
  assert.equal(await page.locator('#free-comparison').isVisible(),true);assert.deepEqual(await page.locator('#free-comparison-body h3').allTextContents(),['A · A original','B · B original']);assert.match(await page.locator('#free-comparison-body').textContent(),/Onsets: 1.*Onsets: 2/);assert.match(await page.locator('#free-comparison').textContent(),/without alignment, accuracy, improvement/);
  await page.locator('#free-record-select').selectOption(A.key);await page.locator('#free-load').click();await page.locator('#free-performance-library').scrollIntoViewIfNeeded();await page.waitForFunction(()=>document.querySelector('#free-operation-status').textContent.includes('Recording opened'));assert.equal((await downloadFreeRecord()).text,A.text);
  await page.locator('#free-record-select').selectOption(B.key);await page.locator('#free-load').click();await page.waitForFunction(()=>document.querySelector('#free-practice-screen').getAttribute('aria-busy')==='false'&&[...document.querySelectorAll('#free-comparison-body h3')].at(-1)?.textContent==='B · B original');assert.equal((await downloadFreeRecord()).text,B.text);
  await page.locator('#free-sound').click();await page.locator('#free-preview-timbre').selectOption('guitar');await page.locator('#free-preview').click();await page.waitForFunction(()=>document.querySelector('#free-preview-status').textContent.startsWith('Preview finished'));
  assert.deepEqual(await page.evaluate(()=>freePreviewToneCalls),[{midi:64,duration_ms:160,instrument:'guitar'},{midi:66,duration_ms:160,instrument:'guitar'}]);assert.match(await page.locator('#free-preview-status').textContent(),/scheduled tones: 2 · skipped during playback: 0 · excluded before playback: 0/);assert.equal((await downloadFreeRecord()).text,B.text);assert.equal((await downloadFreeRecord('#free-export-draft')).text,B.text);
  assert.match(await page.locator('#free-performance-detail').textContent(),/fixed 160 ms tones.*2 minutes or 4,096 tones/);
  await page.locator('#free-import-file').setInputFiles({name:'retained-A.json',mimeType:'application/json',buffer:Buffer.from(A.text)});await page.locator('#free-import-record').click();await page.waitForFunction(()=>document.querySelectorAll('#free-record-select option').length===3&&!document.querySelector('#free-import-record').disabled);assert.equal((await downloadFreeRecord()).text,A.text);
  const bounded=boundedPreviewBrowserRecord();await page.locator('#free-import-file').setInputFiles({name:'original-preview-window-fixture.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(bounded))});await page.locator('#free-import-record').click();await page.waitForFunction(()=>document.querySelectorAll('#free-record-select option').length===4&&!document.querySelector('#free-import-record').disabled);
  await page.locator('#free-preview-timbre').selectOption('piano');await page.locator('#free-preview').click();await page.waitForFunction(()=>document.querySelector('#free-preview-status').textContent.startsWith('Preview finished'));
  assert.match(await page.locator('#free-preview-status').textContent(),/scheduled tones: 1 · skipped during playback: 0 · excluded before playback: 1/);assert.deepEqual(await page.evaluate(()=>freePreviewToneCalls.at(-1)),{midi:60,duration_ms:160,instrument:'piano'});assert.deepEqual((await downloadFreeRecord()).data,bounded,'A tone outside the preview window stays intact in the immutable exported observations');
  const backup=await downloadFreeRecord('#free-export-backup');assert.equal(backup.filename,'worldmusichub-performance-backup.json');assert.equal(backup.data.format,'worldmusichub-performance-backup');assert.equal(backup.data.entries.length,4);assert.equal(backup.data.entries.filter(entry=>isDeepStrictEqual(entry.record,A.data)).length,2);assert.ok(backup.data.entries.some(entry=>isDeepStrictEqual(entry.record,B.data)));assert.ok(backup.data.entries.some(entry=>isDeepStrictEqual(entry.record,bounded)));
  const originalKeys=await page.locator('#free-record-select option').evaluateAll(options=>options.map(option=>option.value));await page.locator('#free-import-file').setInputFiles({name:'performance-backup.json',mimeType:'application/json',buffer:Buffer.from(backup.text)});await page.locator('#free-restore-backup').click();await page.waitForFunction(()=>document.querySelectorAll('#free-record-select option').length===8&&!document.querySelector('#free-restore-backup').disabled);
  const restored=await downloadFreeRecord('#free-export-backup'),allKeys=await page.locator('#free-record-select option').evaluateAll(options=>options.map(option=>option.value));assert.equal(new Set(allKeys).size,8);assert.ok(originalKeys.every(key=>allKeys.includes(key)));for(const entry of backup.data.entries)assert.equal(restored.data.entries.filter(candidate=>isDeepStrictEqual(candidate,entry)).length,backup.data.entries.filter(candidate=>isDeepStrictEqual(candidate,entry)).length*2);
  assert.deepEqual(requests.slice(requestStart),[],'Saving, describing, previewing, importing and backing up performances never invoke score assessment or compilation');
  await writeFile(join(artifactDirectory,'worldmusichub-live-free-library-preview.json'),JSON.stringify({actual_pc_records:[A.data,B.data],synthetic_preview_window_fixture:bounded,preview_calls:await page.evaluate(()=>freePreviewToneCalls),backup:backup.data,restored:restored.data},null,2));
});

test('real Free recording and return preserve the complete paused scored take, loop and canonical source',testOptions,async()=>{
  const score=await prepareKeyboardBrowserPractice('original-score-beside-free');await ui('.practice-options>summary').click();await ui('#loop-from').fill('0');await ui('#loop-to').fill('4');await ui('#loop-apply').click();await page.waitForFunction(()=>document.querySelector('#loop-enabled').checked);await closeShellPanels();
  await page.locator('#play-button').click();await waitForPlaybackClockAdvance(page);await page.locator('#stage-title').click();await page.keyboard.press('r');await page.locator('#play-button').click();
  const before=await exportTakeData(),snapshot=await pausedTakeSnapshot(),loop=await page.locator('#loop-from,#loop-to,#loop-enabled').evaluateAll(elements=>elements.map(element=>({id:element.id,value:element.value,checked:element.checked})));
  const requestStart=requests.length;await enterSilentFreePractice();const free=await recordAndSaveFreeKeys('Separate free record',['i','p']);assertFreeMusicalEvents(free.data,[64,66]);assert.equal(await page.locator('#workspace').isVisible(),false);
  await page.locator('#free-exit').click();await page.locator('#resume-session').click();assert.deepEqual(await pausedTakeSnapshot(),snapshot);assert.deepEqual(await page.locator('#loop-from,#loop-to,#loop-enabled').evaluateAll(elements=>elements.map(element=>({id:element.id,value:element.value,checked:element.checked}))),loop);assert.deepEqual(await exportTakeData(),before,'Free observations, library writes and navigation cannot leak into the scored recorder or its keyboard-configuration history');assert.deepEqual(await exportScore(),score);
  assert.deepEqual(requests.slice(requestStart),[]);await closeShellPanels();await page.locator('#back-to-library').click();await ui('#start-free-practice').click();assert.equal((await downloadFreeRecord()).text,free.text,'Returning to Free practice retains its independently saved selection');
});

test('real explicit guitar phrase uses Rust inventory then filtered locks without changing source, take or playback loop',testOptions,async()=>{
  await hideNotation();await ui('#instrument').selectOption('guitar');await ui('#count-in').uncheck();
  const score=guitarPhraseBrowserScore(),watch=predicate=>page.waitForResponse(response=>new URL(response.url()).pathname==='/api/fingering/guitar'&&response.request().method()==='POST'&&response.request().postDataJSON()?.score?.id===score.id&&predicate(response.request().postDataJSON()));
  const initialPlan=watch(body=>!body.planning_scope&&body.locks.length===0);await ui('#score-file').setInputFiles({name:'original-guitar-phrase.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(score))});await readyForTitle(score.title);assert.equal((await responseJson(await initialPlan)).status,'ready');
  const compiled=await rustApi('/api/compile',score),source=id=>compiled.timeline.notes.find(note=>note.source_note_ids.includes(id));assert.equal(compiled.timeline.duration_ms,8000);
  await setSessionMode('practice');await ui('.practice-options>summary').click();await ui('#loop-from').fill('0');await ui('#loop-to').fill('8');await ui('#loop-apply').click();await page.waitForFunction(()=>document.querySelector('#loop-enabled').checked);await closeShellPanels();await page.locator('#play-button').click();await waitForPlaybackClockAdvance(page);await page.locator('#stage-title').click();await page.keyboard.press('r');await page.locator('#play-button').click();
  const before=await exportTakeData(),snapshot=await pausedTakeSnapshot(),loop=await page.locator('#loop-from,#loop-to,#loop-enabled').evaluateAll(elements=>elements.map(element=>({id:element.id,value:element.value,checked:element.checked})));
  await page.locator('#guitar-plan-controls>summary').click();
  const locks=[{source_note_id:'entry-e',string:2,fret:5,finger:3},{source_note_id:'outside-after',string:1,fret:5,finger:3}];
  for(const [index,lock]of locks.entries()){await page.locator('#guitar-lock-source').selectOption(lock.source_note_id);await page.locator('#guitar-lock-string').selectOption(String(lock.string));await page.locator('#guitar-lock-fret').selectOption(String(lock.fret));await page.locator('#guitar-lock-finger').selectOption(String(lock.finger));const response=watch(body=>!body.planning_scope&&body.locks.length===index+1);await page.locator('#guitar-apply-lock').click();assert.equal((await responseJson(await response)).status,'ready');}
  await page.waitForFunction(()=>document.querySelector('#guitar-planning').dataset.status==='ready');const requestStart=requests.length;
  await page.locator('#guitar-phrase-mode').selectOption('explicit');await page.locator('#guitar-phrase-from').fill('5/2');await page.locator('#guitar-phrase-to').fill('4');assert.equal(await page.locator('#guitar-planning').getAttribute('data-status'),'draft');assert.match(await page.locator('#guitar-phrase-status').textContent(),/old guidance is cleared/);assert.equal(requests.length,requestStart,'Editing a phrase remains a draft until Apply');
  const inventoryResponse=watch(body=>body.inventory_only===true),planResponse=watch(body=>!!body.planning_scope&&!body.inventory_only);await page.locator('#guitar-phrase-apply').click();const inventory=await responseJson(await inventoryResponse),plan=await responseJson(await planResponse);
  const scope={version:1,from:{numerator:5,denominator:2},to:{numerator:4,denominator:1}},included=[source('entry-e').id,source('inside-g').id];
  const expectedInventory={requested:scope,start_ms:2500,end_ms:4000,full_occurrence_count:4,selected_occurrence_count:2,included_occurrence_ids:included,entry_hold_occurrence_ids:[source('entry-e').id]};
  assert.equal(inventory.purpose,'scope_inventory');assert.equal(inventory.status,'unavailable');assert.equal(inventory.complete,false);assert.deepEqual(inventory.assignments,[]);assert.deepEqual(inventory.planning_scope,expectedInventory);assert.equal(plan.purpose,'phrase_plan');assert.equal(plan.status,'ready');assert.deepEqual(plan.planning_scope,expectedInventory);assert.deepEqual(plan.requested_locks,[locks[0]]);assert.deepEqual(plan.assignments.map(assignment=>assignment.occurrence_id),included);
  const held=plan.assignments.find(assignment=>assignment.occurrence_id===source('entry-e').id);assert.equal(held.start_ms,1000);assert.equal(held.end_ms,5000,'An entering sustain retains its full original tail beyond the exclusive phrase end');assert.deepEqual([held.string,held.fret,held.finger],[2,5,3]);
  const sent=requests.slice(requestStart);assert.deepEqual(sent.map(request=>request.path),['/api/fingering/guitar','/api/fingering/guitar']);const [inventoryBody,planBody]=sent.map(request=>JSON.parse(request.body));assert.equal(inventoryBody.inventory_only,true);assert.deepEqual(inventoryBody.locks,[]);assert.deepEqual(inventoryBody.planning_scope,scope);assert.deepEqual(planBody.locks,[locks[0]]);assert.deepEqual(planBody.planning_scope,scope);assert.deepEqual(planBody.score,score);
  await page.waitForFunction(()=>document.querySelector('#guitar-planning').dataset.status==='ready');assert.match(await page.locator('#guitar-phrase-status').textContent(),/2 of 4 occurrences · 1 entry holds/);assert.match(await page.locator('#guitar-lock-list').textContent(),/outside-after:.*outside this planning phrase; stored, inactive/);assert.match(await page.locator('#guitar-lock-count').textContent(),/2 session locks; 1 apply/);
  assert.deepEqual(await pausedTakeSnapshot(),snapshot);assert.deepEqual(await page.locator('#loop-from,#loop-to,#loop-enabled').evaluateAll(elements=>elements.map(element=>({id:element.id,value:element.value,checked:element.checked}))),loop);assert.deepEqual(await exportTakeData(),before);assert.deepEqual(await exportScore(),score);
  await closeShellPanels();const invalidRequestStart=requests.length;await page.locator('#guitar-phrase-from').fill('1/0');await page.locator('#guitar-phrase-apply').click();assert.match(await page.locator('#guitar-phrase-status').textContent(),/denominator/);assert.equal(requests.length,invalidRequestStart,'Invalid phrase text never sends a partial or coerced scope to Rust');const revertInventory=watch(body=>body.inventory_only===true),revertPlan=watch(body=>!!body.planning_scope&&!body.inventory_only);await page.locator('#guitar-phrase-revert').click();assert.deepEqual((await responseJson(await revertInventory)).planning_scope,expectedInventory);assert.deepEqual((await responseJson(await revertPlan)).assignments,plan.assignments);assert.equal(await page.locator('#guitar-phrase-from').inputValue(),'5/2');assert.deepEqual(await exportTakeData(),before);assert.deepEqual(await exportScore(),score);
  await writeFile(join(artifactDirectory,'worldmusichub-live-guitar-explicit-phrase.json'),JSON.stringify({inventory,plan,requests:[inventoryBody,planBody],outside_lock_retained:true,entry_tail_unchanged:true,paused_take_unchanged:true,canonical_score_unchanged:true,loop_unchanged:true},null,2));
});

registerBeginnerBrowserRegressions({test,getPage:()=>page,ui,setSessionMode,readyForTitle,exportScore,exportTakeData,closeShellPanels,artifactDirectory});
registerStaffRegisterBrowserRegressions({test,getPage:()=>page,ui,setSessionMode,readyForTitle,exportScore,closeShellPanels,actualMarkerVisibility,artifactDirectory});
registerAboveKeyboardBrowserRegressions({test,getPage:()=>page,ui,setSessionMode,readyForTitle,exportScore,exportTakeData,closeShellPanels,waitForEngraving,actualMarkerVisibility,simultaneousStageGeometry,assertSimultaneousPiano,artifactDirectory});
registerReferenceListeningBrowserRegressions({test,getPage:()=>page,ui,setSessionMode,readyForTitle,exportScore,exportTakeData,closeShellPanels,artifactDirectory});
registerFreePianoBrowserRegressions({test,getPage:()=>page,closeShellPanels,artifactDirectory});

registerLocaleBrowserRegressions({test,getPage:()=>page,ui,closeShellPanels,waitForEngraving,readyForTitle,exportScore,getRequests:getRequestsForLocale});

registerGameLobbyBrowserRegressions({test,getPage:()=>page,ui,closeShellPanels,exportScore,exportTakeData,artifactDirectory});

registerSharedPianoStageBrowserRegressions({test,getPage:()=>page,ui,setSessionMode,readyForTitle,closeShellPanels,artifactDirectory,exportScore,exportTakeData,waitForEngraving});
