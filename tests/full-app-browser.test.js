/**
 * Full-stack checks against the actual Rust executable and its embedded UI.
 * Build first: cargo build -p practice-server --locked
 * Run: node --test tests/full-app-browser.test.js
 * Optional: WMH_SERVER_BINARY selects another already-built executable;
 * WMH_ARTIFACT_DIR selects the screenshot directory (default: OS temp directory).
 * No API routes, audio APIs, or score-compilation results are mocked here.
 */
import test, {before, after, beforeEach, afterEach} from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {createHash} from 'node:crypto';
import {existsSync} from 'node:fs';
import {mkdir, readFile, writeFile} from 'node:fs/promises';
import {createServer} from 'node:net';
import {tmpdir} from 'node:os';
import {join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {setTimeout as delay} from 'node:timers/promises';
import {chromium} from 'playwright';
import {fixture} from './frontend-fixtures.js';

const root = fileURLToPath(new URL('../', import.meta.url));
const binary = resolve(root, process.env.WMH_SERVER_BINARY || join('target', 'debug', `practice-server${process.platform === 'win32' ? '.exe' : ''}`));
const artifactDirectory = resolve(process.env.WMH_ARTIFACT_DIR || tmpdir());
const fixtures = new URL('./fixtures/', import.meta.url);
const testOptions = {timeout: 45_000};
let server, browser, context, page, origin, initialCompilation;
let serverOutput = '', serverError, pageErrors = [], apiFailures = [], requests = [];
let browserConsole = [], failedResources = [], resourceFailures = [], currentTestName='bootstrap';
const bootstrapTimeout = 25_000;

// Route legacy coverage through the same visible panels that a player uses.
// Inspection only discovers the owning surface; every state change is a real click.
const shellPanels = ['settings', 'score-tools', 'import-tools', 'results'];
async function closeShellPanels(except = null) {
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
    notation: Boolean(element.closest('#notation-dock')),
    stage: Boolean(element.closest('#workspace')),
  }));
  const panel = shellPanels.find(name => `${name}-dialog` === owner.dialog);
  if (owner.dialog && !panel) return; // Existing review dialogs keep their own explicit lifecycle.
  await closeShellPanels(panel);
  if (panel && !await page.locator(`#${panel}-dialog`).isVisible()) await page.locator(`#${panel}-button`).click();
  if (owner.lobby && !await page.locator('#song-lobby').isVisible()) await page.locator('#back-to-library').click();
  if (owner.stage && await page.locator('#song-lobby').isVisible()) await page.locator('#resume-session').click();
  if (owner.notation && !await page.locator('#notation-dock').isVisible()) {
    if (await page.locator('#song-lobby').isVisible()) await page.locator('#resume-session').click();
    await page.locator('#notation-toggle').click();
  }
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
async function startPreview({reset = true, notation = true, mode = 'listen'} = {}) {
  await closeShellPanels();
  await page.locator(`#start-${mode}:not([disabled])`).waitFor();
  await page.locator(`#start-${mode}`).click();
  await page.locator('#play-button').waitFor({state: 'visible'});
  await page.waitForFunction(() => !document.querySelector('#start-listen').disabled);
  if (reset) await page.locator('#reset-button').click();
  if (notation && !await page.locator('#notation-dock').isVisible()) await page.locator('#notation-toggle').click();
}
async function reloadStage(options) {
  const response = await page.reload(options);
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
    && !document.querySelector('#start-listen').disabled, title);
  await startPreview();
  await readyForTitle(title);
}

async function hideNotation() {
  await closeShellPanels();
  if (await page.locator('#notation-dock').isVisible()) await page.locator('#notation-toggle').click();
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

async function libraryRoundtrip(compilation, label, filename) {
  await ui('#library-button').click();
  await page.waitForFunction(() => document.querySelector('#library-status').textContent.startsWith('Ready.'));
  assert.equal(await ui('#library-list>li').count(), 0);
  await ui('#library-label').fill(label);
  await ui('#library-save-copy').click();
  await page.waitForFunction(() => document.querySelector('#library-status').textContent.startsWith('Saved'));
  const originalKey = await ui('#library-list>li').getAttribute('data-library-key');
  const [download] = await Promise.all([page.waitForEvent('download'), ui('#library-export-backup').click()]);
  assert.equal(await download.failure(), null);
  const backup = await readFile(await download.path());
  const entries = JSON.parse(backup).entries;
  assert.equal(entries.length, 1);
  assert.deepEqual(entries[0].score, compilation.score);
  const [validationResponse] = await Promise.all([
    nextResponse('/api/compile'),
    ui('#library-backup-file').setInputFiles({name: filename, mimeType: 'application/json', buffer: backup}),
  ]);
  assert.deepEqual(await responseJson(validationResponse), compilation, 'Backup restoration validates the retained score and diagnostics with Rust');
  await page.waitForFunction(() => document.querySelector('#library-status').textContent.startsWith('Restored 1 new copies'));
  const keys = await ui('#library-list>li').evaluateAll(rows => rows.map(row => row.dataset.libraryKey));
  assert.equal(keys.length, 2);
  assert.ok(keys.includes(originalKey));
  assert.equal(new Set(keys).size, 2);
  const restoredKey = keys.find(key => key !== originalKey);
  const [restoredResponse] = await Promise.all([
    nextResponse('/api/compile'),
    ui(`[data-library-key="${restoredKey}"] [data-library-open]`).click(),
  ]);
  const restored = await responseJson(restoredResponse);
  assert.deepEqual(restored, compilation, 'Opening a restored copy preserves each retained warning without duplication');
  await ui('#score-library').waitFor({state: 'hidden'});
  await readyForTitle(compilation.score.title);
  assert.deepEqual(await exportScore(), compilation.score);
  return restored;
}

async function assertStoppedAtZero() {
  assert.match(await ui('#play-button').textContent(), /Play/);
  assert.equal(await ui('#transport-status').textContent(), 'Ready when you are');
  assert.equal(await ui('#progress').evaluate(element => element.value), 0);
  // Observe actual animation frames: loading/confirming a score must not autoplay.
  await page.waitForTimeout(250);
  assert.equal(await ui('#progress').evaluate(element => element.value), 0);
  assert.equal(await ui('.piano-key.pressed').count(), 0);
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
  await revealControl(page.locator('#engraved-button'));
  await page.waitForFunction(()=>Boolean(document.querySelector('#engraved-staff svg')&&document.querySelector('#engraving-status').textContent.includes('Generated staff preview'))||!document.querySelector('#engraving-fallback').hidden,null,{timeout});
  if(await ui('#engraving-fallback').isVisible()){
    const reason=await ui('#engraving-fallback').textContent();await captureFailureState('engraving-failure');assert.fail(`Expected real engraved SVG; the app reported: ${reason}`);
  }
  await ui('#engraved-staff svg').first().waitFor({state:'visible',timeout});
  assert.match(await ui('#engraving-status').textContent(),/Generated staff preview/);
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
  currentTestName=t.name||'unknown-test';
  pageErrors = []; apiFailures = []; requests = []; browserConsole = []; failedResources = []; resourceFailures = [];
  context = await browser.newContext({viewport: {width: 1440, height: 1100}, colorScheme: 'light', acceptDownloads: true});
  context.setDefaultTimeout(10_000);
  context.setDefaultNavigationTimeout(15_000);
  page = await context.newPage();
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
    initialCompilation = await responseJson(compilation);
    assert.equal(await ui('#song-lobby').isVisible(), true);
    await startPreview();
    await readyForTitle(initialCompilation.score.title);
    await page.waitForFunction(()=>document.querySelector('#practice-scope').textContent.includes('physical attacks'));
    await waitForEngraving();
    assert.equal(await ui('#engraved-button').getAttribute('aria-pressed'),'true','Supported original scores use the offline engraved view by default');
  } catch (error) {
    const observed = await page.evaluate(() => ({url:location.href,readyState:document.readyState,title:document.title,notice:document.querySelector('#notice')?.textContent,scoreTitle:document.querySelector('#score-title')?.textContent,playDisabled:document.querySelector('#play-button')?.disabled})).catch(failure=>({observationError:failure.message}));
    const diagnostics={failure:error.message,observed,pageErrors,apiFailures,browserConsole,failedResources,resourceFailures,apiRequests:requests.map(request=>({path:request.path,method:request.method})),serverRunning:serverRunning(),serverOutput:serverOutput.slice(-4000)};
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
    assert.equal(await ui('.piano-key').count(), count);
  }
  await ui('#stage-title').click();
  await page.keyboard.down('a');
  assert.equal(await ui('.piano-key.pressed').count(), 1);
  assert.equal(await ui('.piano-key[data-midi="60"]').getAttribute('aria-pressed'), 'true');
  await page.keyboard.up('a');
  assert.equal(await ui('.piano-key.pressed').count(), 0);
  await ui('#count-in').uncheck();
  await ui('#stage-title').click();
  await page.keyboard.press('Space');
  await page.waitForFunction(() => document.querySelector('#progress').value > 0);
  assert.match(await ui('#play-button').textContent(), /Pause/);
  await page.keyboard.press('Space');
  assert.match(await ui('#transport-status').textContent(), /Paused/);
  const pausedAt = await ui('#progress').evaluate(element => element.value);
  await page.waitForTimeout(150);
  assert.equal(await ui('#progress').evaluate(element => element.value), pausedAt);
  await page.keyboard.press('Space');
  await page.waitForFunction(position => document.querySelector('#progress').value > position, pausedAt);
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
  assert.equal(await ui('#notation-part option').count(), 2);
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
    const restored = await libraryRoundtrip(compiled, `MusicXML ${version} with its original header`, 'standard-header-backup.json');
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
  await page.waitForFunction(() => document.querySelector('#progress').value > 0);
  const compileCount = requests.filter(request => request.path === '/api/compile').length;
  await ui('#score-image-file').setInputFiles({name: 'original-scale.png', mimeType: 'image/png', buffer: png});
  await ui('#image-review-dialog').waitFor();
  assert.match(await ui('#transport-status').textContent(), /Paused/);
  const stoppedAt = await ui('#progress').evaluate(element => element.value);
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
  assert.equal(await ui('#progress').evaluate(element => element.value), stoppedAt);
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
  await ui('#session-mode').selectOption('practice');
  await ui('#count-in').uncheck();
  await ui('#stage-title').click();
  await page.keyboard.press('a');
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
  await page.keyboard.press('a');
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
  assert.equal(await ui('.piano-key.pressed').count(), 0);
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
  const compiled=await responseJson(compiledResponse);await readyForTitle(score.title);await ui('#session-mode').selectOption('practice');await ui('#count-in').uncheck();await ui('#play-button:not([disabled])').waitFor();await ui('#play-button').click();
  await page.waitForFunction(()=>document.querySelector('#progress').value>800);
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
    const{setupResultsSummary}=await import('/results-summary.js');const isolated=document.implementation.createHTMLDocument('Results compatibility');isolated.body.append(document.querySelector('#result-summary').cloneNode(true));const render=setupResultsSummary(isolated);
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
  await ui('#session-mode').selectOption('practice');
  const [assessmentResponse]=await Promise.all([nextResponse('/api/assess'),ui('#assess-button').click()]);
  assert.deepEqual(assessmentResponse.request().postDataJSON().timeline,plan.timeline);
  const assessment=await responseJson(assessmentResponse);assert.equal(assessment.misses.length,15);
  const downloadPromise=page.waitForEvent('download');await ui('#export-button').click();
  const exported=JSON.parse(await readFile(await(await downloadPromise).path(),'utf8'));
  assert.deepEqual(exported,score);
  const [partResponse]=await Promise.all([nextResponse('/api/practice-targets'),ui('#practice-part').selectOption('unison-part')]);
  const selected=await responseJson(partResponse);assert.equal(selected.source_note_count,1);assert.equal(selected.target_count,1);assert.deepEqual(selected.groups[0].source_note_ids,['unison-source']);
});

test('real local library preserves a source snapshot across reload and validates backup restoration', testOptions, async () => {
  const score=structuredClone(initialCompilation.score);score.title='Saved original exercise';score.source={format:'original-test-text',filename:'original.txt',content:'Original local source · 文本\r\nPreserve this exact payload.'};
  await ui('#score-file').setInputFiles({name:'original-library-score.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(score))});await readyForTitle(score.title);
  await ui('#library-button').click();await page.waitForFunction(()=>document.querySelector('#library-status').textContent.startsWith('Ready.'));assert.equal(await ui('#library-list>li').count(),0);
  await ui('#library-label').fill('Original source copy');await ui('#library-save-copy').click();await page.waitForFunction(()=>document.querySelector('#library-status').textContent.startsWith('Saved'));
  const backupPromise=page.waitForEvent('download');await ui('#library-export-backup').click();const backup=await readFile(await(await backupPromise).path(),'utf8');assert.deepEqual(JSON.parse(backup).entries[0].score,score);
  await ui('#library-close').click();await reloadStage();await readyForTitle(initialCompilation.score.title);await ui('#library-button').click();await ui('[data-library-open]').waitFor();await ui('[data-library-open]').click();await page.waitForFunction(()=>!document.querySelector('#score-library').open);await readyForTitle(score.title);
  assert.deepEqual(await exportScore(),score);
  await ui('#library-button').click();await page.waitForFunction(()=>document.querySelector('#library-status').textContent.startsWith('Ready.'));
  const before=requests.filter(request=>request.path==='/api/compile').length;
  await ui('#library-backup-file').setInputFiles({name:'worldmusichub-library-backup.json',mimeType:'application/json',buffer:Buffer.from(backup)});await page.waitForFunction(()=>document.querySelector('#library-status').textContent.startsWith('Restored'));
  assert.equal(await ui('#library-list>li').count(),2);assert.equal(requests.filter(request=>request.path==='/api/compile').length,before+1);
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
  await ui('#score-file').setInputFiles({name:'original-compound.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(score))});await readyForTitle(score.title);await ui('.practice-options summary').click();const[unitResponse]=await Promise.all([nextResponse('/api/metronome'),ui('#metronome-enabled').check()]);const units=await responseJson(unitResponse);assert.equal(units.ticks.length,6);assert.equal(units.ticks.filter(tick=>tick.accent).length,1);assert.equal(units.pulse,'notated_unit');await page.waitForFunction(()=>document.querySelector('#metronome-status').textContent.startsWith('6 Rust-timed'));assert.match(await ui('#metronome-diagnostics').textContent(),/each eighth/);
  const[compoundResponse]=await Promise.all([nextResponse('/api/metronome'),ui('#metronome-pulse').selectOption('dotted_quarter')]);const compound=await responseJson(compoundResponse);assert.equal(compound.ticks.length,2);await page.waitForFunction(()=>document.querySelector('#metronome-status').textContent.startsWith('2 Rust-timed'));
  await ui('#loop-from').fill('1/2');await ui('#loop-to').fill('5/2');await ui('#loop-apply').click();await page.waitForFunction(()=>document.querySelector('#loop-status').textContent.includes('ready'));await page.waitForFunction(()=>document.querySelector('#metronome-status').textContent.startsWith('1 Rust-timed'));
  await ui('#count-in').uncheck();await ui('#play-button').click();await page.waitForFunction(()=>document.querySelector('#transport-status').textContent.includes('Listening'));await page.waitForFunction(time=>document.querySelector('#progress').value>=time,compound.ticks[1].start_ms+50);await ui('#play-button').click();await ui('#sound-button').click();assert.match(await ui('#metronome-status').textContent(),/Global sound is muted/);assert.deepEqual(await exportScore(),score);
});

test('embedded source directory remains local until a fixed official link or local import is chosen',testOptions,async()=>{
  const before=requests.length,external=[];page.on('request',request=>{if(new URL(request.url()).origin!==origin)external.push(request.url())});await ui('#source-directory-button').click();assert.equal(await ui('.source-card').count(),3);assert.match(await ui('#score-source-directory').textContent(),/does not add license metadata/);await ui('#source-route').selectOption('musicxml');assert.equal(await ui('.source-card').count(),1);assert.equal(await ui('.source-card').getAttribute('data-source-id'),'openscore-lieder');await ui('#source-route').selectOption('all');await page.screenshot({path:join(artifactDirectory,'worldmusichub-live-sources.png'),fullPage:true});await ui('#source-directory-close').click();assert.equal(requests.length,before);assert.deepEqual(external,[]);assert.deepEqual(await exportScore(),initialCompilation.score);
});

test('real explicitly confirmed part-octave copy preserves source JSON and restores it exactly',testOptions,async()=>{
  const original=structuredClone(initialCompilation.score);original.title='Original reversible octave exercise';original.source={format:'original-test-text',filename:'original.txt',content:'\uFEFFOriginal source · 原稿\r\nKeep exact bytes and credits.'};await ui('#score-file').setInputFiles({name:'original.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(original))});await readyForTitle(original.title);const part=original.parts[0].id;await ui('#practice-part').selectOption(part);await page.waitForFunction(()=>document.querySelector('#practice-scope').textContent.includes('physical attacks'));
  await ui('#instrument-settings>summary').click();await ui('#adaptation-button').click();await ui('#adaptation-scope').selectOption('selected');await ui('#adaptation-octaves').fill('1');const[previewResponse]=await Promise.all([nextResponse('/api/adaptation/preview'),ui('#adaptation-preview').click()]);const preview=await responseJson(previewResponse);assert.equal(preview.operation.part_id,part);assert.equal(preview.changed_note_count,15);assert.equal(preview.original_preserved,true);await ui('#adaptation-result').waitFor();assert.equal(await ui('#score-title').textContent(),original.title);assert.equal(await ui('#adaptation-activate').isDisabled(),true);
  await ui('#adaptation-confirm').check();await ui('#adaptation-activate').click();await ui('#adaptation-dialog').waitFor({state:'hidden'});await readyForTitle(preview.compilation.score.title);assert.equal(await ui('#practice-part').inputValue(),part);const copy=await exportScore();assert.deepEqual(copy,preview.compilation.score);assert.deepEqual(JSON.parse(copy.source.content).original,original);assert.equal(JSON.parse(copy.source.content).original.source.content,original.source.content);
  await ui('#adaptation-button').click();const[restoreResponse]=await Promise.all([nextResponse('/api/adaptation/restore'),ui('#adaptation-restore-preview').click()]);const restored=await responseJson(restoreResponse);assert.deepEqual(restored.score,original);await page.waitForFunction(()=>document.querySelector('#adaptation-status').textContent.startsWith('Original preview ready'));assert.equal(await ui('#score-title').textContent(),copy.title);await ui('#adaptation-confirm').check();await ui('#adaptation-activate').click();await ui('#adaptation-dialog').waitFor({state:'hidden'});await readyForTitle(original.title);assert.deepEqual(await exportScore(),original);assert.equal(await ui('#practice-part').inputValue(),part);
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
 await ui('#score-file').setInputFiles({name:'original-follow-study.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(score))});await readyForTitle(score.title);await waitForEngraving();assert.equal(requests.filter(request=>request.path==='/api/notation-navigation').length,0);const[response]=await Promise.all([nextResponse('/api/notation-navigation'),ui('#engraving-follow').check()]);const navigation=await responseJson(response);assert.equal(navigation.occurrences.length,32);assert.equal(navigation.source_measure_count,20);assert.equal(navigation.duration_ms,6400);await page.waitForFunction(()=>document.querySelector('#engraving-follow-status').textContent.includes('Paused at written measure 42'));
 await ui('#count-in').uncheck();await ui('#play-button').click();await page.waitForFunction(()=>document.querySelector('#engraving-range').textContent.startsWith('Measures 9–'));assert.match(await ui('#play-button').textContent(),/Pause/);await page.waitForFunction(()=>document.querySelector('#engraving-follow-status').textContent.includes('pass 2/2')&&document.querySelector('#engraving-range').textContent.startsWith('Measures 1–8'));assert.match(await ui('#play-button').textContent(),/Pause/);await page.waitForFunction(()=>document.querySelector('#transport-status').textContent.includes('Complete'));assert.match(await ui('#engraving-follow-status').textContent(),/End of performance/);assert.match(await ui('#engraving-range').textContent(),/Measures 17–20/);await screenshot('measure-following');assert.deepEqual(await exportScore(),score);
 await ui('#engraving-prev').click();assert.equal(await ui('#engraving-follow').isChecked(),false);assert.match(await ui('#engraving-follow-status').textContent(),/Manual navigation suspended/);assert.equal(requests.filter(request=>request.path==='/api/notation-navigation').length,1);
});

test('complete CC0 D768 edition retains every event and source while range gates, later pages and following remain explicit', {timeout:60_000},async()=>{
  const edition=JSON.parse(await readFile(join(root,'catalog/editions/cc0-schubert-wandrers-nachtlied-d768/score.json'),'utf8'));
  const written=edition.parts.flatMap(part=>part.notes),pitched=written.filter(note=>note.pitch),voice=edition.parts.find(part=>part.instrument==='Voice'),piano=edition.parts.find(part=>part.instrument==='piano');
  assert.equal(written.length,334);assert.equal(pitched.length,324);assert.equal(edition.measures.length,14);assert.equal(edition.provenance.kind,'curated_cc0_edition');assert.equal(edition.provenance.license,'CC0-1.0');assert.ok(voice&&piano);
  const editionPath=`/api/catalog/score/${edition.id}`;assert.equal(requests.filter(request=>request.path===editionPath).length,0,'The complete edition source must not load before selection');
  const selectionStarted=performance.now();const[response]=await Promise.all([nextResponse('/api/compile'),ui('.catalog-item').filter({hasText:edition.title}).click()]);const compiled=await responseJson(response);await activateCatalogTitle(edition.title);await waitForEngraving();const selectionToReadyMs=performance.now()-selectionStarted;assert.deepEqual(compiled.score,edition);assert.equal(requests.filter(request=>request.path===editionPath).length,1);assert.equal(compiled.timeline.notes.length,321);assert.deepEqual(compiled.timeline.notes.flatMap(note=>note.source_note_ids).sort(),pitched.map(note=>note.id).sort(),'All pitched source IDs survive tie compilation');
  assert.match(await ui('#score-meta').textContent(),/334 written events.*321 playback note events.*14 measures/);assert.match(await ui('#score-retention-note').textContent(),/324 pitched note segments \+ 10 rests/);assert.equal(await ui('#score-origin-label').textContent(),'CC0 source edition');assert.equal(await ui(`#practice-part option[value="${voice.id}"]`).textContent(),voice.name,'Raw part names are retained rather than silently cleaned');
  await waitForEngraving();assert.equal(await ui('#engraved-button').getAttribute('aria-pressed'),'true');assert.ok(await ui('#engraved-staff svg path').count()>100);await screenshot('cc0-d768-light');
  await ui('#score-details-button').click();assert.match(await ui('#provenance').textContent(),/Johann Wolfgang von Goethe/);assert.match(await ui('#provenance').textContent(),/pental/);assert.match(await ui('#diagnostic-list').textContent(),/327 key attacks versus 321 canonical/);assert.match(await ui('#diagnostic-list').textContent(),/fermata/);assert.equal(await ui('#provenance-link').getAttribute('href'),edition.provenance.source_url);await ui('#score-details>summary').click();assert.deepEqual(await exportScore(),edition);
  assert.equal(await ui('#key-count').inputValue(),'61');await ui('#session-mode').selectOption('practice');await page.waitForFunction(()=>document.querySelector('#practice-gate-reason').textContent.includes('cannot be played'));assert.equal(await ui('#play-button').isDisabled(),true);assert.equal(await ui('#assess-button').isDisabled(),true);
  await ui('#practice-part').selectOption(voice.id);await ui('#play-button:not([disabled])').waitFor();assert.equal(await ui('#key-count').inputValue(),'61');await ui('#practice-part').selectOption(piano.id);await page.waitForFunction(()=>document.querySelector('#practice-gate-reason').textContent.includes('cannot be played'));assert.equal(await ui('#play-button').isDisabled(),true);await ui('#practice-part').selectOption('');await ui('#key-count').selectOption('76');await ui('#play-button:not([disabled])').waitFor();await ui('#session-mode').selectOption('listen');assert.deepEqual(await exportScore(),edition,'Part/profile changes never adapt or discard source events');
  const pageTurnStarted=performance.now();await ui('#engraving-next').click();await page.waitForFunction(()=>document.querySelector('#engraving-status').textContent.includes('Measures 9–14'));await waitForEngraving();const laterPageToReadyMs=performance.now()-pageTurnStarted;assert.match(await ui('#engraving-range').textContent(),/Measures 9–14 \/ 14/);await screenshot('cc0-d768-later-page');await ui('#theme-mode').selectOption('dark');await page.waitForFunction(()=>document.documentElement.dataset.theme==='dark'&&document.querySelector('#engraving-status').textContent.includes('Measures 9–14'));await screenshot('cc0-d768-dark');
  await ui('.practice-options summary').click();await ui('#loop-from').fill('32');await ui('#loop-to').fill('36');const[windowResponse]=await Promise.all([nextResponse('/api/practice-window'),ui('#loop-apply').click()]);const window=await responseJson(windowResponse);await page.waitForFunction(()=>document.querySelector('#loop-status').textContent.includes('ready'));await ui('#count-in').uncheck();const[navigationResponse]=await Promise.all([nextResponse('/api/notation-navigation'),ui('#engraving-follow').check()]);const navigation=await responseJson(navigationResponse);assert.equal(navigation.occurrences.length,14);assert.equal(navigation.sounding_groups.length,321);assert.ok(navigation.occurrences.every(occurrence=>occurrence.repeat_region_index===null));await page.waitForFunction(()=>document.querySelector('#engraving-follow-status').textContent.includes('source 9/14'));
  await ui('#play-button').click();await page.waitForFunction(start=>document.querySelector('#progress').value>start,window.start_ms);assert.match(await ui('#engraving-follow-status').textContent(),/Following written measure 9/);assert.match(await ui('#engraving-range').textContent(),/Measures 9–14/);await ui('#play-button').click();assert.match(await ui('#transport-status').textContent(),/Paused/);assert.deepEqual(await exportScore(),edition);await ui('#engraving-prev').click();assert.equal(await ui('#engraving-follow').isChecked(),false);assert.match(await ui('#engraving-follow-status').textContent(),/Manual navigation suspended/);
  const[firstResponse]=await Promise.all([nextResponse('/api/compile'),ui(`[data-score-id="${initialCompilation.score.id}"]`).click()]);await responseJson(firstResponse);await activateCatalogTitle(initialCompilation.score.title);const cachedSelectionStarted=performance.now();const[againResponse]=await Promise.all([nextResponse('/api/compile'),ui(`[data-score-id="${edition.id}"]`).click()]);await responseJson(againResponse);await activateCatalogTitle(edition.title);await waitForEngraving();const cachedSelectionToReadyMs=performance.now()-cachedSelectionStarted;assert.equal(requests.filter(request=>request.path===editionPath).length,1,'Re-selecting a cached edition preserves the original without transferring its archive again');assert.deepEqual(await exportScore(),edition);
  await writeFile(join(artifactDirectory,'worldmusichub-live-cc0-d768-performance.json'),JSON.stringify({measured_at:new Date().toISOString(),platform:process.platform,architecture:process.arch,node:process.version,browser:browser.version(),viewport:page.viewportSize(),score_id:edition.id,written_events:334,sounding_events:321,source_measures:14,page_measures:8,selection_to_ready_svg_ms:selectionToReadyMs,later_page_to_ready_svg_ms:laterPageToReadyMs,cached_selection_to_ready_svg_ms:cachedSelectionToReadyMs,edition_score_requests:requests.filter(request=>request.path===editionPath).length,catalog_index_requests:requests.filter(request=>request.path==='/api/catalog/index').length,legacy_catalog_requests:requests.filter(request=>request.path==='/api/catalog').length,method:'One local CI browser run. Node monotonic clock from explicit click until actual generated SVG is visible; timings include browser automation and local HTTP. These observations are not a universal latency guarantee.'},null,2));
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
  await ui('#instrument').selectOption('guitar');await ui('#session-mode').selectOption('practice');await page.waitForFunction(()=>document.querySelector('#practice-gate-reason').textContent.includes('cannot be played'));assert.equal(await ui('#play-button').isDisabled(),true);assert.equal(await ui('#assess-button').isDisabled(),true);assert.equal(await ui('#guitar-frets').inputValue(),'12');
  const [voiceResponse]=await Promise.all([nextResponse('/api/instrument-check'),ui('#practice-part').selectOption(voice.id)]);const voiceReport=await responseJson(voiceResponse);assert.equal(voiceReport.highest_midi,76);assert.ok(voiceReport.note_options.some(note=>note.midi===77&&!note.playable));await page.waitForFunction(()=>document.querySelector('#practice-gate-reason').textContent.includes('cannot be played'));assert.equal(await ui('#play-button').isDisabled(),true);
  await ui('#guitar-frets').fill('13');assert.match(await ui('#practice-gate-reason').textContent(),/edited|validate|Apply/);const[rangeResponse,voiceTargetResponse]=await Promise.all([nextResponse('/api/instrument-check'),nextResponse('/api/practice-targets'),ui('#instrument-apply').click()]);const rangeReport=await responseJson(rangeResponse),voicePlan=await responseJson(voiceTargetResponse);assert.equal(rangeReport.highest_midi,77);assert.ok(rangeReport.note_options.every(note=>note.playable));await ui('#play-button:not([disabled])').waitFor();assert.equal(await ui('#guitar-frets').inputValue(),'13');assert.equal(await ui('#practice-part').inputValue(),voice.id);assert.match(await ui('#instrument-diagnostics').textContent(),/fingering|pitch|duration|technique/i);assert.deepEqual(await exportScore(),edition,'An explicit playable voice range does not transpose, fold or remove any original part');
  await hideNotation();await page.waitForFunction(()=>document.querySelector('#guitar-guidance-state').textContent.includes('next onset'));assert.equal(await page.locator('dialog[open]').count(),0);assert.equal(await page.locator('#guitar-guidance').isVisible(),true);assert.equal(await page.locator('#stage-cue').isVisible(),true);const firstVoice=voicePlan.timeline.notes[0];assert.ok(firstVoice.start_ms>4000);assert.equal(await page.locator('.guitar-target').count(),0,'The opening vocal rest is explicit instead of inventing near-term targets');assert.ok((await page.locator('#guitar-guidance-state').textContent()).includes((firstVoice.start_ms/1000).toFixed(1)+'s'));assert.equal(voicePlan.source_note_count,voicePlan.target_count);assert.ok(voicePlan.groups.every(group=>group.part_ids.every(id=>id===voice.id)));await page.screenshot({path:join(artifactDirectory,'worldmusichub-live-cc0-d768-guitar-voice.png'),fullPage:true});await ui('#practice-part').selectOption('');await page.waitForFunction(()=>document.querySelector('#practice-gate-reason').textContent.includes('cannot be played'));assert.equal(await ui('#play-button').isDisabled(),true);await ui('#session-mode').selectOption('listen');assert.equal(await ui('#play-button').isEnabled(),true);assert.deepEqual(await exportScore(),edition);
});

test('real Rust pitch feedback exposes independent missed targets and an extra played pitch without changing the score',testOptions,async()=>{
  assert.ok(initialCompilation.timeline.notes.every(note=>note.midi!==90));
  await ui('#session-mode').selectOption('practice');await ui('#count-in').uncheck();await ui('#sound-button').click();await ui('#play-button:not([disabled])').waitFor();await ui('#play-button').click();await page.waitForFunction(()=>document.querySelector('#progress').value>0);await ui('.piano-key[data-midi="90"]').click();const[response]=await Promise.all([nextResponse('/api/assess'),ui('#assess-button').click()]);const assessment=await responseJson(response);await ui('#feedback-results').waitFor();assert.ok(Array.isArray(assessment.pitch_breakdown));assert.equal(assessment.hits.length,0);assert.equal(assessment.extras.length,1);assert.equal(assessment.extras[0].midi,90);assert.equal(assessment.misses.length,initialCompilation.timeline.notes.length);const extra=assessment.pitch_breakdown.find(row=>row.midi===90);assert.deepEqual(extra,{midi:90,expected:0,matched:0,missed:0,extra:1,mean_abs_error_ms:null,timing_bias_ms:null});assert.equal(await ui('#pitch-breakdown').getAttribute('open'),null);await ui('#pitch-breakdown-summary').click();assert.equal(await ui('#pitch-breakdown-body tr').count(),assessment.pitch_breakdown.length);
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
    const restored = await libraryRoundtrip(compiled, 'Complete MXL archive', 'mxl-library-backup.json');
    assertHeaderNormalization(restored, expectedHeaderCount);
    assert.equal(restored.score.source.content, source.content);
    assert.equal(await ui('#diagnostic-list>li').filter({hasText: 'musicxml_header_normalized:'}).count(), expectedHeaderCount);
  });
}

test('real lobby preview leaves the active source and clock intact until an explicit new Start',testOptions,async()=>{
  const catalog=await rustApi('/api/catalog'),candidate=catalog.find(score=>score.id!==initialCompilation.score.id&&score.provenance.kind==='original_exercise');assert.ok(candidate);
  await ui('#count-in').uncheck();await ui('#play-button').click();await page.waitForFunction(()=>document.querySelector('#progress').value>0);await page.locator('#back-to-library').click();const paused=await page.locator('#progress').evaluate(element=>element.value);assert.ok(paused>0);assert.equal(await page.locator('#workspace').isVisible(),false);assert.match(await page.locator('#play-button').textContent(),/Play/);
  const before=requests.filter(request=>request.path==='/api/compile').length;const[previewResponse]=await Promise.all([nextResponse('/api/compile'),page.locator(`[data-score-id="${candidate.id}"]`).click()]);const preview=await responseJson(previewResponse);assert.deepEqual(preview.score,candidate);await page.locator('#start-listen:not([disabled])').waitFor();assert.equal(await page.locator('#preview-title').textContent(),candidate.title);assert.equal(await page.locator('#score-title').textContent(),initialCompilation.score.title);assert.deepEqual(await exportScore(),initialCompilation.score);assert.equal(requests.filter(request=>request.path==='/api/compile').length,before+1,'Browsing performs preview validation only');
  await closeShellPanels();await page.locator('#resume-session').click();assert.equal(await page.locator('#stage-title').textContent(),initialCompilation.score.title);await page.waitForTimeout(200);assert.equal(await page.locator('#progress').evaluate(element=>element.value),paused);assert.match(await page.locator('#play-button').textContent(),/Play/);await page.locator('#back-to-library').click();
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
    return{viewport:bounds(viewport),criteria,dock:rect('#notation-dock'),scroll:rect('.engraving-scroll'),noteheadCount:samples.length,meaningfullyVisibleCount:samples.filter(sample=>sample.meaningful).length,samples:samples.sort((a,b)=>Number(b.meaningful)-Number(a.meaningful)||b.visibleFraction-a.visibleFraction).slice(0,12)};
  });
}

async function viewportSnapshot(name,{requireVisibleNoteheads=false}={}) {
  await page.evaluate(async()=>{await document.fonts.ready;await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))});
  const screenshotOptions={path:join(artifactDirectory,`worldmusichub-live-${name}.png`),fullPage:false,animations:'disabled'};
  const visibility=requireVisibleNoteheads?await engravedNoteheadVisibility():null;
  if(visibility){
    await writeFile(join(artifactDirectory,`worldmusichub-live-${name}-visibility.json`),JSON.stringify(visibility,null,2));
    if(!visibility.meaningfullyVisibleCount)await page.screenshot(screenshotOptions);
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
    position:document.querySelector('#progress').value,
    mode:document.querySelector('#session-mode').value,
    pass:document.querySelector('.performance-status').dataset.passId,
    revision:document.querySelector('.performance-status').dataset.revision,
    captured:document.querySelector('#hud-captured').textContent,
  }));
}

async function compactGeometry() {
  return page.evaluate(()=>{
    const rect=selector=>{const element=document.querySelector(selector),box=element.getBoundingClientRect();return{x:box.x,y:box.y,width:box.width,height:box.height,right:box.right,bottom:box.bottom,clientHeight:element.clientHeight,scrollHeight:element.scrollHeight}};
    return{viewport:{width:innerWidth,height:innerHeight},document:{width:document.documentElement.scrollWidth,height:document.documentElement.scrollHeight},lobby:rect('#song-lobby'),preview:rect('.song-preview'),identity:rect('.preview-identity'),title:rect('#preview-title'),credits:rect('#preview-meta'),music:rect('#preview-music-meta'),copy:{...rect('.preview-copy'),overflow:getComputedStyle(document.querySelector('.preview-copy')).overflowY,scrollTop:document.querySelector('.preview-copy').scrollTop},footer:rect('.preview-footer'),gate:rect('#preview-gate'),listen:rect('#start-listen'),practice:rect('#start-practice'),stage:rect('#workspace'),hud:rect('.stage-hud'),play:rect('.play-panel'),field:rect('#falling-notes'),keyboard:rect('#keyboard'),transport:rect('.transport'),hudItems:[...document.querySelectorAll('.stage-hud>button,.stage-hud>.stage-heading,.stage-hud nav>.button')].map(element=>{const box=element.getBoundingClientRect();return{id:element.id||element.className,x:box.x,right:box.right,y:box.y,bottom:box.bottom,centerY:box.y+box.height/2}})};
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
  for(const [name,label] of Object.entries({identity:'Selected score identity',title:'Selected title',credits:'Composer and source',music:'Opening musical metadata',footer:'Start footer',gate:'Compatibility reason',listen:'Listen Start',practice:'Practice Start'}))assertInsideViewport(geometry[name],viewport,label);
  assert.ok(geometry.identity.bottom<=geometry.copy.y+1,'Selected score identity stays above the scrollable details');
  assert.ok(geometry.footer.y>=geometry.copy.bottom-1,'Long preview text must scroll above the Start footer');
}

for(const viewport of [{width:1280,height:720},{width:1920,height:1080},{width:844,height:390},{width:390,height:844}]){
  test(`real D768 lobby and compact performance fit ${viewport.width} by ${viewport.height} with visible tools and exact source`,testOptions,async()=>{
    const edition=JSON.parse(await readFile(join(root,'catalog/editions/cc0-schubert-wandrers-nachtlied-d768/score.json'),'utf8'));
    await hideNotation();await page.setViewportSize(viewport);await ui('#theme-mode').selectOption('light');await ui('#session-mode').selectOption('practice');await ui('#count-in').uncheck();await closeShellPanels();
    await page.locator('#play-button').click();await page.waitForFunction(()=>document.querySelector('#progress').value>0);await page.locator('#stage-title').click();await page.keyboard.press('a');await page.waitForFunction(()=>document.querySelector('#hud-captured').textContent==='1');await page.locator('#back-to-library').click();await page.waitForFunction(()=>document.querySelector('.performance-status').dataset.phase!=='grace');
    const activeTake=await pausedTakeSnapshot(),takeBefore=await exportTakeData();assert.ok(activeTake.position>0);assert.ok(activeTake.pass);assert.equal(takeBefore.passes.length,1);assert.equal(takeBefore.passes[0].inputs.length,1);
    async function selectPreview(id,title) {
      const [response]=await Promise.all([nextResponse('/api/compile'),ui(`[data-score-id="${id}"]`).click()]);
      const compiled=await responseJson(response);assert.equal(compiled.score.id,id);
      await page.waitForFunction(expected=>document.querySelector('#preview-title').textContent===expected&&!document.querySelector('#start-listen').disabled,title);
      if(id===edition.id)await page.waitForFunction(()=>document.querySelector('#preview-gate').textContent.includes('18 selected notes cannot be played')&&document.querySelector('#preview-gate').classList.contains('preview-blocked')&&document.querySelector('#start-practice').disabled);
      return compiled;
    }
    const preview=await selectPreview(edition.id,edition.title);assert.deepEqual(preview.score,edition);
    assert.equal(await page.locator('#preview-title').textContent(),edition.title);assert.ok((await page.locator('#preview-meta').textContent()).includes(edition.composer));
    const musicMeta=await page.locator('#preview-music-meta').textContent();assert.match(musicMeta,/^Opening · 起始: /);assert.match(musicMeta,/2 flats · mode unspecified/);assert.ok(musicMeta.includes(`${preview.score.tempo[0].bpm} BPM`));assert.ok(musicMeta.includes(`${preview.score.parts.length} parts`));
    assert.equal(await page.locator('#preview-notices').evaluate(element=>element.open),false);assert.equal(await page.locator('.preview-copy').evaluate(element=>element.scrollTop),0);
    if(viewport.width<651)await page.locator('.preview-footer').scrollIntoViewIfNeeded();
    const lobby=await compactGeometry();assertPinnedPreview(lobby,viewport);assert.equal(await page.locator('html').getAttribute('data-theme'),'light');assert.equal(await page.locator('#workspace').isVisible(),false);await viewportSnapshot(`compact-${viewport.width}x${viewport.height}-lobby`);
    await page.locator('#preview-notices-title').click();assert.ok(await page.locator('#preview-notice-list li').count()>0);assert.ok((await page.locator('#preview-notice-list').textContent()).length>300,'The retained D768 notices exercise a long preview');
    if(viewport.width<651)await page.locator('.preview-footer').scrollIntoViewIfNeeded();
    const expandedLobby=await compactGeometry();assertPinnedPreview(expandedLobby,viewport);assert.ok(expandedLobby.copy.scrollHeight>expandedLobby.copy.clientHeight,'Expanded source notices must exercise the preview detail scroller');await viewportSnapshot(`compact-${viewport.width}x${viewport.height}-lobby-notices`);
    await page.mouse.move(expandedLobby.copy.x+expandedLobby.copy.width/2,expandedLobby.copy.y+expandedLobby.copy.height/2);await page.mouse.wheel(0,expandedLobby.copy.scrollHeight);await page.waitForFunction(()=>{const copy=document.querySelector('.preview-copy');return copy.scrollTop>0&&copy.scrollTop+copy.clientHeight>=copy.scrollHeight-1});
    const scrolledLobby=await compactGeometry();assertPinnedPreview(scrolledLobby,viewport);for(const name of ['identity','title','credits','music','footer','gate','listen','practice'])assert.deepEqual(scrolledLobby[name],expandedLobby[name],`${name} remains anchored while source details scroll`);assert.equal(await page.locator('#preview-music-meta').textContent(),musicMeta);await viewportSnapshot(`compact-${viewport.width}x${viewport.height}-lobby-notices-scrolled`);
    const catalog=await rustApi('/api/catalog/index'),candidate=catalog.items.find(item=>item.id!==edition.id&&item.id!==initialCompilation.score.id);assert.ok(candidate);
    await selectPreview(candidate.id,candidate.title);assert.equal(await page.locator('#preview-notices').evaluate(element=>element.open),false);assert.equal(await page.locator('.preview-copy').evaluate(element=>element.scrollTop),0);assert.deepEqual(await pausedTakeSnapshot(),activeTake,'Browsing another score preserves the paused take');
    await selectPreview(edition.id,edition.title);assert.equal(await page.locator('#preview-notices').evaluate(element=>element.open),false);assert.equal(await page.locator('.preview-copy').evaluate(element=>element.scrollTop),0);assert.equal(await page.locator('#preview-music-meta').textContent(),musicMeta);assert.deepEqual(await pausedTakeSnapshot(),activeTake,'Returning to D768 preserves the paused take');assert.deepEqual(await exportTakeData(),takeBefore,'Preview details, scrolling and catalog swaps preserve every captured input and clock segment');
    if(viewport.width>=1280){await ui('#theme-mode').selectOption('dark');await closeShellPanels();assert.equal(await page.locator('html').getAttribute('data-theme'),'dark');assertPinnedPreview(await compactGeometry(),viewport);await viewportSnapshot(`compact-${viewport.width}x${viewport.height}-lobby-dark`);await ui('#theme-mode').selectOption('light');await closeShellPanels();assert.equal(await page.locator('html').getAttribute('data-theme'),'light');}
    assert.deepEqual(await exportScore(),initialCompilation.score);await closeShellPanels();
    await startPreview({notation:false});assert.equal(await page.locator('#stage-title').textContent(),edition.title);assert.equal(await page.locator('.shell-header').isVisible(),false);assert.equal(await page.locator('#notation-dock').isVisible(),false);assert.equal(await page.locator('#stage-cue-main').textContent(),'READY');
    const stage=await compactGeometry();assertBoundedDocument(stage);assertInsideViewport(stage.stage,viewport,'Performance stage');assertInsideViewport(stage.play,viewport,'Playfield and transport');assertInsideViewport(stage.transport,viewport,'Transport');assert.ok(stage.stage.scrollHeight<=stage.stage.clientHeight+1,'The stage must not become a scrolling dashboard');assert.ok(stage.play.scrollHeight<=stage.play.clientHeight+1,'Playfield and transport must fit without panel scrolling');assert.ok(stage.field.height>=viewport.height*(viewport.width>=1280?.5:.32),`The musical field needs substantial vertical space: ${JSON.stringify(stage.field)}`);
    if(viewport.width>=1280){const centers=stage.hudItems.map(item=>item.centerY);assert.ok(Math.max(...centers)-Math.min(...centers)<=2,`Desktop tools and title share one HUD row: ${JSON.stringify(stage.hudItems)}`);assert.ok(stage.hud.height<=70,JSON.stringify(stage.hud));}
    for(const item of stage.hudItems)assert.ok(item.x>=-1&&item.right<=viewport.width+1,`HUD control stays reachable: ${JSON.stringify(item)}`);
    for(const id of ['midi-button','count-in','typing-octave']){assert.equal(await page.locator(`#${id}`).count(),1);assert.equal(await page.locator(`#settings-dialog #${id}`).count(),1);assert.equal(await page.locator(`#${id}`).isVisible(),false);}
    assert.equal(await page.locator('.transport #sound-button').count(),1);assert.match(await page.locator('#keyboard-range-context').textContent(),/61 keys/);await viewportSnapshot(`compact-${viewport.width}x${viewport.height}-stage`);
    if(viewport.width>=1280){await ui('#theme-mode').selectOption('dark');await closeShellPanels();assert.equal(await page.locator('html').getAttribute('data-theme'),'dark');const darkStage=await compactGeometry();assertBoundedDocument(darkStage);assertInsideViewport(darkStage.transport,viewport,'Dark transport');assert.ok(darkStage.field.height>=viewport.height*.5);await viewportSnapshot(`compact-${viewport.width}x${viewport.height}-stage-dark`);await ui('#theme-mode').selectOption('light');await closeShellPanels();assert.equal(await page.locator('html').getAttribute('data-theme'),'light');}
    const keyboardRange=await page.locator('#piano-scroll').evaluate(element=>({left:element.scrollLeft,width:element.clientWidth,total:element.scrollWidth}));
    if(keyboardRange.total>keyboardRange.width+1){const direction=await page.locator('#keyboard-pan-right').isEnabled()?'right':'left';await page.locator(`#keyboard-pan-${direction}`).click();await page.waitForFunction(previous=>Math.abs(document.querySelector('#piano-scroll').scrollLeft-previous)>1,keyboardRange.left);assert.equal(await page.locator('.piano-key').count(),61,'Panning never truncates the configured keyboard');}
    for(const name of ['settings','score-tools','import-tools','results']){await page.locator(`#${name}-button`).click();await page.locator(`#${name}-dialog`).waitFor();if(name==='settings')for(const id of ['midi-button','count-in','typing-octave'])assert.equal(await page.locator(`#${id}`).isVisible(),true);await page.locator(`#${name}-dialog [data-close-panel]`).click();}
    await page.locator('#library-button').click();await page.locator('#score-library').waitFor();await page.locator('#library-close').click();
    await page.locator('#notation-toggle').click();await waitForEngraving();assert.ok(await page.locator('#engraved-staff svg').count()>0);assert.ok(await page.locator('#engraved-staff .vf-notehead path').count()>0,'Compact headers retain the actual generated notes');
    const svgText=(await page.locator('#engraved-staff svg text').allTextContents()).join(' ').replace(/\s+/g,' ');assert.equal(svgText.includes('Wandrers Nachtlied'),false,'The dock must not repeat the score title');assert.equal(svgText.includes(edition.composer),false,'The dock must not repeat the composer');assert.equal(await page.locator('#stage-title').textContent(),edition.title);
    assert.match(await page.locator('#engraving-range').textContent(),/Measures 1–8 \/ 14/);assert.equal(await page.locator('#engraving-follow').isVisible(),true);assert.equal(await page.locator('#engraving-follow-status').isVisible(),true);assert.match(await page.locator('#engraving-follow-status').textContent(),/Following is off/);
    for(const selector of ['#engraving-range','#engraving-follow-status']){const bounds=await page.locator(selector).boundingBox();assertInsideViewport({...bounds,right:bounds.x+bounds.width,bottom:bounds.y+bounds.height},viewport,`Visible notation state ${selector}`);}
    const help=await page.locator('#engraving-follow-help').evaluate(element=>({inDetails:Boolean(element.closest('details')),open:element.closest('details')?.open}));assert.deepEqual(help,{inDetails:true,open:false});assert.equal(await page.locator('#dock-warning-count').isVisible(),true);assert.match(await page.locator('#dock-warning-count').textContent(),/Notation notices.*\d/);
    if(viewport.height<=600&&viewport.width>=651){assert.equal(await page.locator('#engraving-part').isVisible(),false);await page.locator('.dock-help>summary').click();assert.equal(await page.locator('#engraving-part').isVisible(),true);assert.equal(await page.locator('#engraving-page-size').isVisible(),true);await page.locator('.dock-help>summary').click();assert.equal(await page.locator('#engraving-part').isVisible(),false);assert.equal(await page.locator('#engraving-range').isVisible(),true);}
    const notationVisibility=await viewportSnapshot(`compact-${viewport.width}x${viewport.height}-notation`,{requireVisibleNoteheads:true});
    assert.deepEqual(await exportScore(),edition,'Viewport, panning, compact notation and tools preserve every canonical event and retained source byte');await closeShellPanels();await assertStoppedAtZero();
    await writeFile(join(artifactDirectory,`worldmusichub-live-compact-${viewport.width}x${viewport.height}.json`),JSON.stringify({viewport,score_id:edition.id,music_meta:musicMeta,lobby,expandedLobby,scrolledLobby,stage,notationVisibility,paused_take_unchanged:true,canonical_score_unchanged:true},null,2));
  });
}

test('real Rust HUD shows a checked pass snapshot and hides it across resume and the full delayed-input tail',testOptions,async()=>{
  await hideNotation();assert.ok(initialCompilation.timeline.notes.every(note=>note.midi!==90));await ui('#session-mode').selectOption('practice');await ui('#count-in').uncheck();await ui('.practice-options>summary').click();await ui('#latency-offset').fill('500');await ui('#latency-offset').dispatchEvent('change');await closeShellPanels();
  assert.equal(await page.locator('#hud-result').isVisible(),false);await page.locator('#play-button').click();await page.waitForFunction(()=>document.querySelector('#progress').value>600);await page.locator('.piano-key[data-midi="90"]').click();await page.waitForFunction(()=>document.querySelector('#hud-captured').textContent==='1'&&document.querySelector('.performance-status').dataset.phase==='capturing');
  const captured=await page.locator('.performance-status').evaluate(element=>({pass:element.dataset.passId,revision:element.dataset.revision}));assert.ok(captured.pass);assert.equal(await page.locator('#hud-result').isVisible(),false);
  const assessedResponse=nextResponse('/api/assess');await ui('#assess-button').click();await page.waitForFunction(()=>document.querySelector('.performance-status').dataset.phase==='grace');assert.equal(await page.locator('#hud-result').isVisible(),false);await closeShellPanels();const response=await assessedResponse,assessment=await responseJson(response);assert.equal(assessment.hits.length,0);assert.equal(assessment.extras.length,1);assert.equal(assessment.extras[0].midi,90);assert.equal(assessment.misses.length,initialCompilation.timeline.notes.length);assert.equal(response.request().postDataJSON().inputs.length,1);
  await page.waitForFunction(()=>document.querySelector('.performance-status').dataset.phase==='assessed');assert.match(await page.locator('#hud-label').textContent(),/Previous check/);assert.equal(await page.locator('#hud-accuracy').textContent(),'0%');assert.equal(await page.locator('#hud-result').isVisible(),true);assert.match(await page.locator('#hud-result').textContent(),/Onset match rate/);assert.equal(await page.locator('.performance-status').getAttribute('data-pass-id'),captured.pass);assert.equal(await page.locator('.performance-status').getAttribute('data-revision'),captured.revision);await viewportSnapshot('hud-previous-rust-check');
  await page.locator('#play-button').click();await page.waitForFunction(()=>document.querySelector('.performance-status').dataset.phase==='capturing');assert.equal(await page.locator('#hud-result').isVisible(),false);
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
  await hideNotation();await ui('#instrument').selectOption('guitar');await ui('#session-mode').selectOption('practice');await ui('#count-in').check();await ui('#play-button:not([disabled])').waitFor();
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
  await page.locator('#play-button:not([disabled])').click();await page.waitForFunction(()=>document.querySelector('#progress').value>600);await page.locator('#play-button').click();const paused=await guitarGuidanceCards();assertGuitarGuidancePlan(paused,plan);await page.waitForTimeout(220);assert.deepEqual(await guitarGuidanceCards(),paused);
  const assessment=await rustApi('/api/assess',{timeline:plan.timeline,inputs:[{midi:firstChord[0].midi,at_ms:firstTime,velocity:90}],tolerance_ms:180});assert.equal(assessment.hits.length,1);assert.equal(assessment.misses.length,7);assert.equal(assessment.onset_completion.complete,0,'One same-pitch input cannot complete the two distinct guitar targets');
  assert.deepEqual(await exportScore(),score);await closeShellPanels();await writeFile(join(artifactDirectory,'worldmusichub-live-guitar-guidance-timing.json'),JSON.stringify({compiled:compiled.timeline,plan,initialCards,pausedCountIn,paused,assessment,canonical_score_unchanged:true},null,2));
});

test('real guitar string conflicts stay blocked while the guide retains every unplayable target',testOptions,async()=>{
  await hideNotation();await ui('#instrument').selectOption('guitar');await ui('#session-mode').selectOption('practice');await ui('#play-button:not([disabled])').waitFor();
  const score=structuredClone(fixture),seed=score.parts[0].notes[0];score.id='guitar-conflicting-strings';score.title='Original one-string collision';score.parts[0].notes=['E','F'].map((step,index)=>({...structuredClone(seed),id:`conflict-${index}`,pitch:{step,alter:0,octave:2},voice:String(index+1)}));
  const[checkResponse,targetResponse]=await Promise.all([nextResponse('/api/instrument-check'),nextResponse('/api/practice-targets'),ui('#score-file').setInputFiles({name:'guitar-conflicting-strings.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(score))})]);
  const report=await responseJson(checkResponse),plan=await responseJson(targetResponse);await page.waitForFunction(title=>document.querySelector('#score-title').textContent===title&&document.querySelector('#practice-gate-reason').textContent.includes('simultaneous'),score.title);await hideNotation();
  assert.ok(report.note_options.every(note=>note.playable),'The two pitches fit individually');assert.ok(report.diagnostics.some(item=>item.code==='guitar_string_conflict'));assert.equal(plan.playable,false);assert.equal(plan.target_count,2);assert.equal(await page.locator('#play-button').isDisabled(),true);assert.equal(await ui('#assess-button').isDisabled(),true);assert.match(await page.locator('#practice-hint').textContent(),/arrangement/);
  await page.waitForFunction(()=>document.querySelectorAll('.guitar-target').length===2);assertGuitarGuidancePlan(await guitarGuidanceCards(),plan);assert.deepEqual(await exportScore(),score);
});

for(const viewport of [{width:1280,height:720},{width:844,height:390},{width:390,height:844}]){
  test(`real unobscured guitar stage keeps guidance, shared cues and all frets reachable at ${viewport.width} by ${viewport.height}`,testOptions,async()=>{
    await hideNotation();await page.setViewportSize(viewport);await page.emulateMedia({reducedMotion:'reduce'});await ui('#instrument').selectOption('guitar');await ui('#session-mode').selectOption('practice');await ui('#play-button:not([disabled])').waitFor();await ui('#guitar-frets').fill('36');
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
    const first=page.locator('.fret-button[data-string="0"][data-fret="0"]');await first.focus();assert.equal(await first.getAttribute('aria-label'),'String 1, fret 0: E4');assert.ok(await page.locator('.guitar-scroll').evaluate(el=>el.scrollLeft<50&&el.scrollTop<=23));await page.locator('#reset-button').focus();await page.locator('.guitar-details summary').click();assert.ok(await page.locator('#guitar-guidance-sources li').count()>0);assert.match(await page.locator('#guitar-guidance-sources').textContent(),/Source occurrences:/);await page.locator('.guitar-details summary').click();
    await writeFile(join(artifactDirectory,`worldmusichub-live-guitar-${viewport.width}x${viewport.height}-geometry.json`),JSON.stringify({...geometry,firstVisible,lastVisible,lastFret:lastBounds},null,2));assert.deepEqual(await exportScore(),initialCompilation.score);
  });
}
