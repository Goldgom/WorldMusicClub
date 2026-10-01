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

const root = fileURLToPath(new URL('../', import.meta.url));
const binary = resolve(root, process.env.WMH_SERVER_BINARY || join('target', 'debug', `practice-server${process.platform === 'win32' ? '.exe' : ''}`));
const artifactDirectory = resolve(process.env.WMH_ARTIFACT_DIR || tmpdir());
const fixtures = new URL('./fixtures/', import.meta.url);
const testOptions = {timeout: 45_000};
let server, browser, context, page, origin, initialCompilation;
let serverOutput = '', serverError, pageErrors = [], apiFailures = [], requests = [];
let browserConsole = [], failedResources = [], resourceFailures = [], currentTestName='bootstrap';
const bootstrapTimeout = 25_000;

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
  await page.waitForFunction(expected => {
    return document.querySelector('#score-title').textContent === expected
      && !document.querySelector('#play-button').disabled;
  }, title);
}

async function exportScore() {
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.locator('#export-button').click(),
  ]);
  assert.equal(await download.failure(), null);
  const path = await download.path();
  assert.ok(path, 'The browser must produce a real JSON download');
  const score = JSON.parse(await readFile(path, 'utf8'));
  assert.equal(download.suggestedFilename(), `${score.id.replace(/[^\w.-]/g, '_')}.json`);
  return score;
}

async function assertStoppedAtZero() {
  assert.match(await page.locator('#play-button').textContent(), /Play/);
  assert.equal(await page.locator('#transport-status').textContent(), 'Ready when you are');
  assert.equal(await page.locator('#progress').evaluate(element => element.value), 0);
  // Observe actual animation frames: loading/confirming a score must not autoplay.
  await page.waitForTimeout(250);
  assert.equal(await page.locator('#progress').evaluate(element => element.value), 0);
  assert.equal(await page.locator('.piano-key.pressed').count(), 0);
}

async function captureFailureState(stage) {
  if(!page||page.isClosed())return;
  const name=`worldmusichub-live-${stage}-${currentTestName.replace(/[^a-zA-Z0-9]+/g,'-').slice(0,85)}`;
  const observed=await page.evaluate(()=>({scoreTitle:document.querySelector('#score-title')?.textContent,notice:document.querySelector('#notice')?.textContent,engravingStatus:document.querySelector('#engraving-status')?.textContent,engravingFallback:document.querySelector('#engraving-fallback')?.textContent,fallbackHidden:document.querySelector('#engraving-fallback')?.hidden,engravedSelected:document.querySelector('#engraved-button')?.getAttribute('aria-pressed'),svgCount:document.querySelectorAll('#engraved-staff svg').length,followStatus:document.querySelector('#engraving-follow-status')?.textContent,practiceGate:document.querySelector('#practice-gate-reason')?.textContent,transport:document.querySelector('#transport-status')?.textContent})).catch(error=>({observationError:error.message}));
  const diagnostics={test:currentTestName,observed,pageErrors,apiFailures,browserConsole,failedResources,resourceFailures,apiRequests:requests.map(request=>({path:request.path,method:request.method})),serverOutput:serverOutput.slice(-4000)};
  await writeFile(join(artifactDirectory,`${name}.json`),JSON.stringify(diagnostics,null,2));
  await page.screenshot({path:join(artifactDirectory,`${name}.png`),fullPage:true,timeout:3000}).catch(()=>{});
}
async function waitForEngraving(timeout=25_000) {
  await page.waitForFunction(()=>Boolean(document.querySelector('#engraved-staff svg')&&document.querySelector('#engraving-status').textContent.includes('Generated staff preview'))||!document.querySelector('#engraving-fallback').hidden,null,{timeout});
  if(await page.locator('#engraving-fallback').isVisible()){
    const reason=await page.locator('#engraving-fallback').textContent();await captureFailureState('engraving-failure');assert.fail(`Expected real engraved SVG; the app reported: ${reason}`);
  }
  await page.locator('#engraved-staff svg').first().waitFor({state:'visible',timeout});
  assert.match(await page.locator('#engraving-status').textContent(),/Generated staff preview/);
}

async function screenshot(name) {
  if(await page.locator('#engraved-button').getAttribute('aria-pressed')==='true'){
    await waitForEngraving();
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
    await readyForTitle(initialCompilation.score.title);
    await page.waitForFunction(()=>document.querySelector('#practice-scope').textContent.includes('physical attacks'));
    await waitForEngraving();
    assert.equal(await page.locator('#engraved-button').getAttribute('aria-pressed'),'true','Supported original scores use the offline engraved view by default');
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
    if(t.signal.aborted||pageErrors.length||apiFailures.length)await captureFailureState('failure');
    await context?.close();
  }
}, {timeout: 10_000});

test('actual Rust catalog, compiler and assessment preserve original exercises and exact timing', testOptions, async () => {
  const catalog = await rustApi('/api/catalog');
  const originals=catalog.filter(score=>score.provenance.kind==='original_exercise');
  assert.deepEqual(originals.map(score => score.id), ['first-steps', 'steady-hands', 'little-syncopation']);
  assert.equal(await page.locator('.catalog-item').count(), catalog.length);
  assert.equal(await page.locator('#catalog-count').textContent(), String(catalog.length));
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
    const [response] = await Promise.all([nextResponse('/api/compile'), page.locator('.catalog-item').nth(index).click()]);
    assert.equal((await responseJson(response)).score.id, catalog[index].id);
    await readyForTitle(catalog[index].title);
  }
  const [response] = await Promise.all([nextResponse('/api/compile'), page.locator('.catalog-item').first().click()]);
  await responseJson(response);
  await readyForTitle(catalog[0].title);
  await page.locator('#staff-button').click();
  assert.equal(await page.locator('#notation').isVisible(),true,'Count the explicitly selected pitch-guide page, not its hidden responsive layout');
  assert.equal(await page.locator('.note-head').count(), 15);
  assert.equal(await page.locator('.rest').count(), 1);
  await page.locator('#jianpu-button').click();
  assert.equal(await page.locator('.jianpu-note').count(), 16);
  await page.locator('#staff-button').click();
  for (const count of [49, 76, 88, 61]) {
    await page.locator('#key-count').selectOption(String(count));
    assert.equal(await page.locator('.piano-key').count(), count);
  }
  await page.locator('#workspace').focus();
  await page.keyboard.down('a');
  assert.equal(await page.locator('.piano-key.pressed').count(), 1);
  assert.equal(await page.locator('.piano-key[data-midi="60"]').getAttribute('aria-pressed'), 'true');
  await page.keyboard.up('a');
  assert.equal(await page.locator('.piano-key.pressed').count(), 0);
  await page.locator('#count-in').uncheck();
  await page.locator('#workspace').focus();
  await page.keyboard.press('Space');
  await page.waitForFunction(() => document.querySelector('#progress').value > 0);
  assert.match(await page.locator('#play-button').textContent(), /Pause/);
  await page.keyboard.press('Space');
  assert.match(await page.locator('#transport-status').textContent(), /Paused/);
  const pausedAt = await page.locator('#progress').evaluate(element => element.value);
  await page.waitForTimeout(150);
  assert.equal(await page.locator('#progress').evaluate(element => element.value), pausedAt);
  await page.keyboard.press('Space');
  await page.waitForFunction(position => document.querySelector('#progress').value > position, pausedAt);
  await page.locator('#reset-button').click();
  await assertStoppedAtZero();
  await page.locator('#instrument').selectOption('guitar');
  assert.equal(await page.locator('#guitar-stage').isVisible(), true);
  assert.equal(await page.locator('.fret-button').count(), 78);
  await page.locator('[data-string="5"][data-fret="0"]').click();
  await page.locator('#instrument').selectOption('piano');
  assert.equal(await page.locator('#piano-stage').isVisible(), true);
});

test('live Rust-backed desktop light/dark and mobile layouts produce real screenshots', testOptions, async () => {
  await page.locator('#theme-mode').selectOption('light');
  assert.equal(await page.locator('html').getAttribute('data-theme'), 'light');
  await screenshot('light');
  await page.locator('#theme-mode').selectOption('dark');
  assert.equal(await page.locator('html').getAttribute('data-theme'), 'dark');
  const [response] = await Promise.all([nextResponse('/api/compile'), page.reload({waitUntil: 'domcontentloaded'})]);
  await responseJson(response);
  await readyForTitle(initialCompilation.score.title);
  assert.equal(await page.locator('#theme-mode').inputValue(), 'dark');
  await screenshot('dark');
  await page.locator('#theme-mode').selectOption('light');
  await page.setViewportSize({width: 390, height: 844});
  const geometry = await page.evaluate(() => ({
    document: document.documentElement.scrollWidth,
    viewport: innerWidth,
    piano: document.querySelector('#piano-scroll').scrollWidth,
    pianoViewport: document.querySelector('#piano-scroll').clientWidth,
  }));
  assert.ok(geometry.document <= geometry.viewport + 1, JSON.stringify(geometry));
  assert.ok(geometry.piano > geometry.pianoViewport, 'The full keyboard scrolls inside its mobile container');
  assert.equal(await page.locator('#mobile-import-button').isVisible(), true);
  await screenshot('mobile');
});

test('.xml browser import reaches the Rust parser and exports its exact source, chord spelling and ties', testOptions, async () => {
  const xml = await readFile(new URL('original-duet.musicxml', fixtures), 'utf8');
  const [importResponse, compileResponse] = await Promise.all([
    nextResponse('/api/import/musicxml'),
    nextResponse('/api/compile'),
    page.locator('#score-file').setInputFiles({name: 'original-duet.xml', mimeType: 'application/xml', buffer: Buffer.from(xml)}),
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
  assert.equal(await page.locator('#notation-part option').count(), 2);
  await assertStoppedAtZero();
  const exported = await exportScore();
  assert.deepEqual(exported, imported.score);
  assert.equal(exported.source.content, xml);
});

test('PNG review uses real Rust candidates and requires every duration plus renewed explicit confirmation', testOptions, async () => {
  const png = await readFile(new URL('omr-original-scale.png', fixtures));
  await page.locator('#count-in').uncheck();
  await page.locator('#play-button').click();
  await page.waitForFunction(() => document.querySelector('#progress').value > 0);
  const compileCount = requests.filter(request => request.path === '/api/compile').length;
  await page.locator('#score-image-file').setInputFiles({name: 'original-scale.png', mimeType: 'image/png', buffer: png});
  await page.locator('#image-review-dialog').waitFor();
  assert.match(await page.locator('#transport-status').textContent(), /Paused/);
  const stoppedAt = await page.locator('#progress').evaluate(element => element.value);
  const [response] = await Promise.all([nextResponse('/api/import/image'), page.locator('#analyze-image').click()]);
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
  assert.equal(await page.locator('#progress').evaluate(element => element.value), stoppedAt);
  assert.equal(await page.locator('#review-create').isDisabled(), true);
  await page.locator('#review-confirm').check();
  assert.equal(await page.locator('#review-create').isDisabled(), true, 'Confirmation alone cannot invent missing rhythms');
  for (let index = 0; index < review.candidates.length; index++) {
    const pitch = review.candidates[index].tentative_pitch;
    assert.equal(await page.getByLabel(`Pitch for note ${index + 1}`, {exact: true}).inputValue(), `${pitch.step}${pitch.octave}`);
    await page.getByLabel(`Duration for note ${index + 1}`, {exact: true}).selectOption('1');
  }
  assert.equal(await page.locator('#review-confirm').isChecked(), false, 'Editing durations invalidates old confirmation');
  assert.equal(await page.locator('#review-create').isDisabled(), true);
  await page.locator('#review-confirm').check();
  assert.equal(await page.locator('#review-create').isEnabled(), true);
  await page.getByLabel('Pitch for note 1', {exact: true}).fill('F##4');
  assert.equal(await page.locator('#review-confirm').isChecked(), false, 'Editing pitch also requires renewed confirmation');
  assert.equal(await page.locator('#review-create').isDisabled(), true);
  await page.locator('#review-title').fill('My checked scale');
  assert.equal(requests.filter(request => request.path === '/api/compile').length, compileCount, 'Recognition never silently creates a playable score');
  await screenshot('image-review');
  await page.locator('#review-confirm').check();
  const [compiledResponse] = await Promise.all([nextResponse('/api/compile'), page.locator('#review-create').click()]);
  const compiled = await responseJson(compiledResponse);
  await page.locator('#image-review-dialog').waitFor({state: 'hidden'});
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
  await page.locator('#session-mode').selectOption('practice');
  await page.locator('#count-in').uncheck();
  await page.locator('#workspace').focus();
  await page.keyboard.press('a');
  const [emptyResponse] = await Promise.all([nextResponse('/api/assess'), page.locator('#assess-button').click()]);
  const empty = await responseJson(emptyResponse);
  assert.deepEqual(emptyResponse.request().postDataJSON().inputs, [], 'Notes before playback must not enter the take');
  assert.equal(empty.misses.length, 15);
  await page.locator('#feedback-results').waitFor();
  assert.equal(await page.locator('#accuracy').textContent(), '0%');
  await page.locator('#play-button:not([disabled])').waitFor();
  await page.locator('#workspace').focus();
  await page.keyboard.press('Space');
  await page.waitForFunction(() => document.querySelector('#play-button').textContent.includes('Pause'));
  await page.keyboard.press('a');
  const [response] = await Promise.all([nextResponse('/api/assess'), page.locator('#assess-button').click()]);
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
  assert.equal(await page.locator('#hits').textContent(), String(assessment.hits.length));
  assert.equal(await page.locator('#misses').textContent(), `${assessment.misses.length} / ${assessment.extras.length}`);
  assert.match(await page.locator('#transport-status').textContent(), /Paused/);
  assert.equal(await page.locator('.piano-key.pressed').count(), 0);
});

test('whole application engraves real exported MusicXML and preserves the score across light/dark views', {timeout:60_000}, async () => {
  const source = await readFile(new URL('original-duet.musicxml',fixtures),'utf8');
  const [compiledResponse,xmlResponse] = await Promise.all([
    nextResponse('/api/compile'),nextResponse('/api/export/musicxml'),
    page.locator('#score-file').setInputFiles({name:'original-duet.musicxml',mimeType:'application/xml',buffer:Buffer.from(source)}),
  ]);
  const compiled = await responseJson(compiledResponse);
  await readyForTitle(compiled.score.title);
  const before = await exportScore();
  const exported = await responseJson(xmlResponse);
  assert.match(exported.xml, /^<\?xml/);
  assert.ok(Object.hasOwn(exported.part_id_map,compiled.score.parts[0].id));
  await waitForEngraving();
  assert.equal(await page.locator('#engraved-button').getAttribute('aria-pressed'),'true');
  assert.equal(await page.locator('#notation').isVisible(),false);
  assert.ok(await page.locator('#engraved-staff svg path').count()>30);
  assert.ok(await page.locator('#engraved-staff .vf-stavetie').count()>=1);
  assert.equal(await page.locator('#engraving-license-note').isVisible(),true);
  assert.ok(requests.some(request=>request.path==='/api/export/musicxml'));
  await screenshot('engraved-light');
  await page.locator('#theme-mode').selectOption('dark');
  await page.waitForFunction(()=>document.documentElement.dataset.theme==='dark' && [...document.querySelectorAll('#engraved-staff .vf-notehead path')].some(path=>getComputedStyle(path).fill==='rgb(243, 245, 239)') && document.querySelector('#engraving-status').textContent.includes('Generated staff preview'));
  await screenshot('engraved-dark');
  await page.locator('#engraving-part').selectOption(compiled.score.parts[0].id);
  await page.waitForFunction(()=>document.querySelector('#engraved-staff svg') && !document.querySelector('#engraved-staff').textContent.includes('Guitar'));
  assert.ok(await page.locator('#engraved-staff .vf-clef').count()>=2);
  await page.locator('#staff-button').click();
  assert.equal(await page.locator('#notation').isVisible(),true);
  assert.equal(await page.locator('#engraving-view').isVisible(),false);
  assert.equal(await page.locator('#engraved-staff svg').count(),0,'Switching to the pitch guide disposes the generated staff');
  assert.deepEqual(await exportScore(),before,'View/theme/part changes must not modify canonical notes or source data');
});

test('real Rust physical targets retain unison source voices and score one piano attack', testOptions, async () => {
  const score=structuredClone(initialCompilation.score);
  const first=score.parts[0].notes.find(note=>note.pitch);
  score.title='Original physical unison check';
  score.parts.push({id:'unison-part',name:'Unison source voice',instrument:'piano',notes:[{...structuredClone(first),id:'unison-source'}]});
  const [response]=await Promise.all([nextResponse('/api/practice-targets'),page.locator('#score-file').setInputFiles({name:'original-unison.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(score))})]);
  const plan=await responseJson(response);
  assert.equal(plan.source_note_count,16);assert.equal(plan.target_count,15);
  assert.ok(plan.groups.some(group=>group.source_note_ids.includes('unison-source')&&group.source_occurrence_ids.length===2));
  await page.waitForFunction(()=>document.querySelector('#practice-scope').textContent.includes('15 physical attacks from 16 sounding'));
  await page.locator('#session-mode').selectOption('practice');
  const [assessmentResponse]=await Promise.all([nextResponse('/api/assess'),page.locator('#assess-button').click()]);
  assert.deepEqual(assessmentResponse.request().postDataJSON().timeline,plan.timeline);
  const assessment=await responseJson(assessmentResponse);assert.equal(assessment.misses.length,15);
  const downloadPromise=page.waitForEvent('download');await page.locator('#export-button').click();
  const exported=JSON.parse(await readFile(await(await downloadPromise).path(),'utf8'));
  assert.deepEqual(exported,score);
  const [partResponse]=await Promise.all([nextResponse('/api/practice-targets'),page.locator('#practice-part').selectOption('unison-part')]);
  const selected=await responseJson(partResponse);assert.equal(selected.source_note_count,1);assert.equal(selected.target_count,1);assert.deepEqual(selected.groups[0].source_note_ids,['unison-source']);
});

test('real local library preserves a source snapshot across reload and validates backup restoration', testOptions, async () => {
  const score=structuredClone(initialCompilation.score);score.title='Saved original exercise';score.source={format:'original-test-text',filename:'original.txt',content:'Original local source · 文本\r\nPreserve this exact payload.'};
  await page.locator('#score-file').setInputFiles({name:'original-library-score.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(score))});await readyForTitle(score.title);
  await page.locator('#library-button').click();await page.waitForFunction(()=>document.querySelector('#library-status').textContent.startsWith('Ready.'));assert.equal(await page.locator('#library-list>li').count(),0);
  await page.locator('#library-label').fill('Original source copy');await page.locator('#library-save-copy').click();await page.waitForFunction(()=>document.querySelector('#library-status').textContent.startsWith('Saved'));
  const backupPromise=page.waitForEvent('download');await page.locator('#library-export-backup').click();const backup=await readFile(await(await backupPromise).path(),'utf8');assert.deepEqual(JSON.parse(backup).entries[0].score,score);
  await page.locator('#library-close').click();await page.reload();await readyForTitle(initialCompilation.score.title);await page.locator('#library-button').click();await page.locator('[data-library-open]').waitFor();await page.locator('[data-library-open]').click();await page.waitForFunction(()=>!document.querySelector('#score-library').open);await readyForTitle(score.title);
  assert.deepEqual(await exportScore(),score);
  await page.locator('#library-button').click();await page.waitForFunction(()=>document.querySelector('#library-status').textContent.startsWith('Ready.'));
  const before=requests.filter(request=>request.path==='/api/compile').length;
  await page.locator('#library-backup-file').setInputFiles({name:'worldmusichub-library-backup.json',mimeType:'application/json',buffer:Buffer.from(backup)});await page.waitForFunction(()=>document.querySelector('#library-status').textContent.startsWith('Restored'));
  assert.equal(await page.locator('#library-list>li').count(),2);assert.equal(requests.filter(request=>request.path==='/api/compile').length,before+1);
  await page.screenshot({path:join(artifactDirectory,'worldmusichub-live-library.png'),fullPage:true});
});

test('real numbered-text export previews Rust diagnostics and roundtrips original melody timing', testOptions, async () => {
  const [response]=await Promise.all([nextResponse('/api/export/jianpu'),page.locator('#export-jianpu').click()]);const exported=await responseJson(response);
  await page.locator('#jianpu-export-download:not([disabled])').waitFor();assert.equal(await page.locator('#jianpu-export-text').inputValue(),exported.text);assert.equal(exported.note_map.filter(id=>id!==null).length,initialCompilation.score.parts[0].notes.length);assert.match(await page.locator('#jianpu-export-diagnostics').textContent(),/original source bytes/);
  const promise=page.waitForEvent('download');await page.locator('#jianpu-export-download').click();const downloaded=await readFile(await(await promise).path(),'utf8');assert.equal(downloaded,exported.text);await page.locator('#jianpu-export-close').click();assert.deepEqual(await exportScore(),initialCompilation.score);
  const [importResponse]=await Promise.all([nextResponse('/api/import/jianpu'),page.locator('#score-file').setInputFiles({name:'original-roundtrip.jianpu',mimeType:'text/plain',buffer:Buffer.from(downloaded)})]);const imported=await responseJson(importResponse);
  const timing=timeline=>timeline.notes.map(note=>({midi:note.midi,start_ms:note.start_ms,duration_ms:note.duration_ms}));assert.deepEqual(timing(imported.timeline),timing(initialCompilation.timeline));assert.equal(imported.timeline.duration_ms,initialCompilation.timeline.duration_ms);await readyForTitle(imported.score.title);
});

test('real image review exports manually confirmed triplets and dotted rhythms through Jianpu and MusicXML',testOptions,async()=>{
  const png=await readFile(new URL('omr-original-scale.png',fixtures));await page.locator('#score-image-file').setInputFiles({name:'original-rhythm.png',mimeType:'image/png',buffer:png});await page.locator('#image-review-dialog').waitFor();
  const[recognitionResponse]=await Promise.all([nextResponse('/api/import/image'),page.locator('#analyze-image').click()]);const recognition=await responseJson(recognitionResponse);assert.equal(recognition.candidates.length,8);await page.waitForFunction(()=>document.querySelectorAll('.review-note-row').length===8);
  const pitches=['C4','D4','E4','F#4','0','A4','B4','C5'],durations=['1/3','1/3','1/3','0.75','0.25','1.5','1.5','3'];
  for(let index=0;index<8;index++){await page.getByLabel(`Pitch for note ${index+1}`,{exact:true}).fill(pitches[index]);await page.getByLabel(`Duration for note ${index+1}`,{exact:true}).selectOption(durations[index])}
  assert.equal(await page.locator('#review-create').isDisabled(),true);await page.locator('#review-confirm').check();const[compileResponse,xmlResponse]=await Promise.all([nextResponse('/api/compile'),nextResponse('/api/export/musicxml'),page.locator('#review-create').click()]);const original=await responseJson(compileResponse);const xml=await responseJson(xmlResponse);assert.deepEqual(xmlResponse.request().postDataJSON(),original.score,'Default engraving exports the exact reviewed score before caching it');await page.locator('#image-review-dialog').waitFor({state:'hidden'});
  const notes=original.score.parts[0].notes;assert.deepEqual(notes[2].at,{numerator:2,denominator:3});assert.deepEqual(notes[7].at,{numerator:5,denominator:1});assert.equal(notes[4].velocity,0);assert.equal(notes[4].pitch,null);assert.deepEqual(original.score.measures.map(measure=>measure.length),[{numerator:4,denominator:1},{numerator:4,denominator:1}]);const preserved=JSON.parse(original.score.source.content);assert.deepEqual(preserved.manual_notes.map(row=>row.duration),durations);assert.deepEqual(Buffer.from(preserved.original_image_data_url.split(',')[1],'base64'),png);
  const[xmlFile]=await Promise.all([page.waitForEvent('download'),page.locator('#export-musicxml').click()]);assert.equal(await readFile(await xmlFile.path(),'utf8'),xml.xml,'Download reuses the checked canonical MusicXML cache; no redundant request is required');
  const[textResponse]=await Promise.all([nextResponse('/api/export/jianpu'),page.locator('#export-jianpu').click()]);const text=await responseJson(textResponse);await page.locator('#jianpu-export-download:not([disabled])').waitFor();assert.ok(text.text.includes(':1/3'));const textFilePromise=page.waitForEvent('download');await page.locator('#jianpu-export-download').click();assert.equal(await readFile(await(await textFilePromise).path(),'utf8'),text.text);await page.locator('#jianpu-export-close').click();assert.deepEqual(await exportScore(),original.score);
  for(const[endpoint,filename,content,mime]of[['/api/import/jianpu','roundtrip.jianpu',text.text,'text/plain'],['/api/import/musicxml','roundtrip.musicxml',xml.xml,'application/xml']]){
    const[response]=await Promise.all([nextResponse(endpoint),page.locator('#score-file').setInputFiles({name:filename,mimeType:mime,buffer:Buffer.from(content)})]);const imported=await responseJson(response);assert.equal(imported.timeline.notes.length,original.timeline.notes.length);for(let index=0;index<original.timeline.notes.length;index++){const actual=imported.timeline.notes[index],expected=original.timeline.notes[index];assert.equal(actual.midi,expected.midi);assert.ok(Math.abs(actual.start_ms-expected.start_ms)<1e-7);assert.ok(Math.abs(actual.duration_ms-expected.duration_ms)<1e-7)}assert.ok(Math.abs(imported.timeline.duration_ms-original.timeline.duration_ms)<1e-7);await readyForTitle(imported.score.title);
  }
});

test('real optional metronome distinguishes six eighth subdivisions from two compound clicks and scopes loops',testOptions,async()=>{
  assert.equal(requests.filter(request=>request.path==='/api/metronome').length,0);
  const score=structuredClone(initialCompilation.score);score.title='Original compound pulse study';score.parts[0].notes=score.parts[0].notes.slice(0,3).map((note,index)=>({...note,at:{numerator:index,denominator:1},duration:{numerator:1,denominator:1}}));score.measures=[{number:1,at:{numerator:0,denominator:1},length:{numerator:3,denominator:1}}];score.meters=[{at:{numerator:0,denominator:1},numerator:6,denominator:8}];
  await page.locator('#score-file').setInputFiles({name:'original-compound.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(score))});await readyForTitle(score.title);await page.locator('.practice-options summary').click();const[unitResponse]=await Promise.all([nextResponse('/api/metronome'),page.locator('#metronome-enabled').check()]);const units=await responseJson(unitResponse);assert.equal(units.ticks.length,6);assert.equal(units.ticks.filter(tick=>tick.accent).length,1);assert.equal(units.pulse,'notated_unit');await page.waitForFunction(()=>document.querySelector('#metronome-status').textContent.startsWith('6 Rust-timed'));assert.match(await page.locator('#metronome-diagnostics').textContent(),/each eighth/);
  const[compoundResponse]=await Promise.all([nextResponse('/api/metronome'),page.locator('#metronome-pulse').selectOption('dotted_quarter')]);const compound=await responseJson(compoundResponse);assert.equal(compound.ticks.length,2);await page.waitForFunction(()=>document.querySelector('#metronome-status').textContent.startsWith('2 Rust-timed'));
  await page.locator('#loop-from').fill('1/2');await page.locator('#loop-to').fill('5/2');await page.locator('#loop-apply').click();await page.waitForFunction(()=>document.querySelector('#loop-status').textContent.includes('ready'));await page.waitForFunction(()=>document.querySelector('#metronome-status').textContent.startsWith('1 Rust-timed'));
  await page.locator('#count-in').uncheck();await page.locator('#play-button').click();await page.waitForFunction(()=>document.querySelector('#transport-status').textContent.includes('Listening'));await page.waitForFunction(time=>document.querySelector('#progress').value>=time,compound.ticks[1].start_ms+50);await page.locator('#play-button').click();await page.locator('#sound-button').click();assert.match(await page.locator('#metronome-status').textContent(),/Global sound is muted/);assert.deepEqual(await exportScore(),score);
});

test('embedded source directory remains local until a fixed official link or local import is chosen',testOptions,async()=>{
  const before=requests.length,external=[];page.on('request',request=>{if(new URL(request.url()).origin!==origin)external.push(request.url())});await page.locator('#source-directory-button').click();assert.equal(await page.locator('.source-card').count(),3);assert.match(await page.locator('#score-source-directory').textContent(),/does not add license metadata/);await page.locator('#source-route').selectOption('musicxml');assert.equal(await page.locator('.source-card').count(),1);assert.equal(await page.locator('.source-card').getAttribute('data-source-id'),'openscore-lieder');await page.locator('#source-route').selectOption('all');await page.screenshot({path:join(artifactDirectory,'worldmusichub-live-sources.png'),fullPage:true});await page.locator('#source-directory-close').click();assert.equal(requests.length,before);assert.deepEqual(external,[]);assert.deepEqual(await exportScore(),initialCompilation.score);
});

test('real explicitly confirmed part-octave copy preserves source JSON and restores it exactly',testOptions,async()=>{
  const original=structuredClone(initialCompilation.score);original.title='Original reversible octave exercise';original.source={format:'original-test-text',filename:'original.txt',content:'\uFEFFOriginal source · 原稿\r\nKeep exact bytes and credits.'};await page.locator('#score-file').setInputFiles({name:'original.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(original))});await readyForTitle(original.title);const part=original.parts[0].id;await page.locator('#practice-part').selectOption(part);await page.waitForFunction(()=>document.querySelector('#practice-scope').textContent.includes('physical attacks'));
  await page.locator('#instrument-settings>summary').click();await page.locator('#adaptation-button').click();await page.locator('#adaptation-scope').selectOption('selected');await page.locator('#adaptation-octaves').fill('1');const[previewResponse]=await Promise.all([nextResponse('/api/adaptation/preview'),page.locator('#adaptation-preview').click()]);const preview=await responseJson(previewResponse);assert.equal(preview.operation.part_id,part);assert.equal(preview.changed_note_count,15);assert.equal(preview.original_preserved,true);await page.locator('#adaptation-result').waitFor();assert.equal(await page.locator('#score-title').textContent(),original.title);assert.equal(await page.locator('#adaptation-activate').isDisabled(),true);
  await page.locator('#adaptation-confirm').check();await page.locator('#adaptation-activate').click();await page.locator('#adaptation-dialog').waitFor({state:'hidden'});await readyForTitle(preview.compilation.score.title);assert.equal(await page.locator('#practice-part').inputValue(),part);const copy=await exportScore();assert.deepEqual(copy,preview.compilation.score);assert.deepEqual(JSON.parse(copy.source.content).original,original);assert.equal(JSON.parse(copy.source.content).original.source.content,original.source.content);
  await page.locator('#adaptation-button').click();const[restoreResponse]=await Promise.all([nextResponse('/api/adaptation/restore'),page.locator('#adaptation-restore-preview').click()]);const restored=await responseJson(restoreResponse);assert.deepEqual(restored.score,original);await page.waitForFunction(()=>document.querySelector('#adaptation-status').textContent.startsWith('Original preview ready'));assert.equal(await page.locator('#score-title').textContent(),copy.title);await page.locator('#adaptation-confirm').check();await page.locator('#adaptation-activate').click();await page.locator('#adaptation-dialog').waitFor({state:'hidden'});await readyForTitle(original.title);assert.deepEqual(await exportScore(),original);assert.equal(await page.locator('#practice-part').inputValue(),part);
});

async function openExternalReviewFiles(xml,filename='audiveris.musicxml',image=null){
  await page.locator('#source-directory-button').click();await page.locator('#source-review-external').click();await page.locator('#external-output-file').setInputFiles({name:filename,mimeType:'application/xml',buffer:Buffer.from(xml)});
  if(image){await page.locator('#external-image-file').setInputFiles({name:image.filename,mimeType:'image/png',buffer:image.bytes});await page.locator('#external-original-figure').waitFor()}
  await page.locator('#external-engine-declaration').check();const[response]=await Promise.all([nextResponse('/api/omr/audiveris-draft'),page.locator('#external-prepare').click()]);const draft=await responseJson(response);await page.locator('#external-editor').waitFor();return draft;
}
async function attestExternalReview(){for(const key of ['notes_and_rests','rhythm_and_voices','ties_and_navigation','key_and_meter','tempo','source_rights'])await page.locator(`#external-confirm-${key}`).check()}
test('real Audiveris melody review corrects missed tempo and retains hash-matched original image and raw output',testOptions,async()=>{
  const provenance=JSON.parse(await readFile(new URL('audiveris-original-melody-provenance.json',fixtures),'utf8'));
  const image=await readFile(new URL(provenance.image,fixtures)),raw=await readFile(new URL(provenance.recognized_fixture,fixtures));
  assert.equal(createHash('sha256').update(image).digest('hex'),provenance.image_sha256);assert.equal(createHash('sha256').update(raw).digest('hex'),provenance.recognition_fixture_sha256);assert.equal(provenance.printed_quarter_bpm,90);
  const compileCount=requests.filter(request=>request.path==='/api/compile').length,previousTitle=await page.locator('#score-title').textContent();const draft=await openExternalReviewFiles(raw,'audiveris-original-melody.musicxml',{filename:provenance.image,bytes:image});
  assert.equal(draft.requires_review,true);assert.equal(draft.confidence,null);assert.equal(Object.hasOwn(draft,'timeline'),false);assert.equal(draft.score.tempo[0].bpm,120,'The known recognition miss remains uncorrected until the user edits it');assert.equal(draft.score.parts[0].notes.length,16);assert.equal(draft.normalizations.length,1);assert.equal(await page.locator('#score-title').textContent(),previousTitle);assert.equal(requests.filter(request=>request.path==='/api/compile').length,compileCount);
  assert.deepEqual(await page.locator('#external-original-image').evaluate(image=>[image.naturalWidth,image.naturalHeight]),[provenance.width,provenance.height]);assert.match(await page.locator('.external-confidence').textContent(),/Confidence: unknown/);
  await attestExternalReview();await page.getByLabel('Tempo BPM 1',{exact:true}).fill('90');assert.equal(await page.locator('#external-confirm-load').isDisabled(),true);assert.equal(await page.locator('#external-confirm-source_rights').isChecked(),false);await page.locator('#external-title').fill('Manually reviewed original melody');await page.locator('#external-composer').fill('WorldMusicHub original exercise');assert.deepEqual(draft.score.keys,[],'The engine omitted a key declaration; the editor must not invent it');await page.locator('#external-map-kind').selectOption('keys');assert.equal(await page.locator('.external-map-row').count(),0);await page.locator('#external-add-map').click();assert.equal(await page.locator('#external-confirm-key_and_meter').isChecked(),false);await page.getByLabel('Key fifths 1',{exact:true}).fill('0');await page.getByLabel('Key mode 1',{exact:true}).fill('major');await attestExternalReview();
  await page.screenshot({path:join(artifactDirectory,'worldmusichub-live-external-omr-review.png'),fullPage:true});const[response]=await Promise.all([nextResponse('/api/omr/confirm'),page.locator('#external-confirm-load').click()]);const confirmed=await responseJson(response);await page.locator('#external-omr-dialog').waitFor({state:'hidden'});await readyForTitle('Manually reviewed original melody');assert.equal(confirmed.score.tempo[0].bpm,90);assert.deepEqual(confirmed.score.keys,[{at:{numerator:0,denominator:1},fifths:0,mode:'major'}]);assert.equal(confirmed.timeline.notes.length,15);assert.ok(Math.abs(confirmed.timeline.duration_ms-16*60000/90)<1e-7);
  const exported=await exportScore();assert.equal(exported.source.format,'external-omr-reviewed');const record=JSON.parse(exported.source.content);assert.equal(record.input.output_content,raw.toString('utf8'));assert.deepEqual(Buffer.from(record.input.original_image.base64,'base64'),image);assert.equal(record.input.original_image.filename,provenance.image);assert.equal(Object.values(record.confirmation).every(value=>value===true),true);assert.ok(confirmed.diagnostics.some(diagnostic=>diagnostic.message.startsWith('Retained import observation: ')));assert.equal(await page.locator('#tempo').inputValue(),'90');
});
test('real external duet corrections keep every part/staff/tie while fixing onsets, voices and tempo/key maps',testOptions,async()=>{
  const raw=await readFile(new URL('audiveris-original-duet.musicxml',fixtures)),referenceXml=await readFile(new URL('original-duet.musicxml',fixtures));const referenceResponse=await fetch(`${origin}/api/import/musicxml`,{method:'POST',headers:{'Content-Type':'application/xml'},body:referenceXml});assert.equal(referenceResponse.status,200);const reference=await referenceResponse.json();
  const draft=await openExternalReviewFiles(raw,'audiveris-original-duet.musicxml');assert.equal(draft.score.parts.length,2);assert.equal(await page.locator('#external-original-figure').isVisible(),false);assert.equal(await page.locator('#external-part option').count(),2);
  for(let index=0;index<draft.score.parts[0].notes.length;index++){const note=draft.score.parts[0].notes[index];if(note.at.numerator===2*note.at.denominator)await page.getByLabel(`Onset for draft note ${index+1}`,{exact:true}).fill('3');if(note.staff===2)await page.getByLabel(`Voice for draft note ${index+1}`,{exact:true}).fill('2');else if(note.voice==='2')await page.getByLabel(`Voice for draft note ${index+1}`,{exact:true}).fill('1')}
  await page.locator('#external-json-tab').click();const edited=JSON.parse(await page.locator('#external-json').inputValue());assert.equal(Object.hasOwn(edited,'source'),false);edited.tempo=reference.score.tempo;edited.keys=reference.score.keys;await page.locator('#external-json').fill(JSON.stringify(edited,null,2));await page.locator('#external-json-apply').click();await page.locator('#external-part').selectOption('1');assert.equal(await page.locator('.external-note-row').count(),draft.score.parts[1].notes.length);await attestExternalReview();
  const[response]=await Promise.all([nextResponse('/api/omr/confirm'),page.locator('#external-confirm-load').click()]);const confirmed=await responseJson(response);await page.locator('#external-omr-dialog').waitFor({state:'hidden'});await readyForTitle(confirmed.score.title);
  const written=score=>score.parts.map(part=>part.notes.map(note=>JSON.stringify([note.at,note.duration,note.pitch,note.voice,note.staff,note.tie_start,note.tie_stop])).sort());assert.deepEqual(written(confirmed.score),written(reference.score));assert.deepEqual(confirmed.score.tempo,reference.score.tempo);assert.deepEqual(confirmed.score.keys,reference.score.keys);assert.equal(JSON.parse((await exportScore()).source.content).input.output_content,raw.toString('utf8'));
  const timing=timeline=>timeline.notes.map(note=>[note.midi,Number(note.start_ms.toFixed(6)),Number(note.duration_ms.toFixed(6))]).sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b)));assert.deepEqual(timing(confirmed.timeline),timing(reference.timeline));
});

test('real Rust measure following turns engraved pages through repeat passes without changing playback or source', {timeout:60_000},async()=>{
 const score=structuredClone(initialCompilation.score);score.id='original-follow-study';score.title='Original repeated measure study';score.tempo=[{at:{numerator:0,denominator:1},bpm:300}];score.meters=[{at:{numerator:0,denominator:1},numerator:1,denominator:4}];score.measures=Array.from({length:20},(_,index)=>({number:42,at:{numerator:index,denominator:1},length:{numerator:1,denominator:1}}));const seed=score.parts[0].notes[0];score.parts[0].notes=Array.from({length:20},(_,index)=>({...structuredClone(seed),id:`follow-note-${index}`,at:{numerator:index,denominator:1},duration:{numerator:1,denominator:1},pitch:{step:['C','D','E','F','G'][index%5],alter:0,octave:4}}));score.repeats=[{from:{numerator:0,denominator:1},to:{numerator:12,denominator:1},times:2}];
 await page.locator('#score-file').setInputFiles({name:'original-follow-study.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(score))});await readyForTitle(score.title);await waitForEngraving();assert.equal(requests.filter(request=>request.path==='/api/notation-navigation').length,0);const[response]=await Promise.all([nextResponse('/api/notation-navigation'),page.locator('#engraving-follow').check()]);const navigation=await responseJson(response);assert.equal(navigation.occurrences.length,32);assert.equal(navigation.source_measure_count,20);assert.equal(navigation.duration_ms,6400);await page.waitForFunction(()=>document.querySelector('#engraving-follow-status').textContent.includes('Paused at written measure 42'));
 await page.locator('#count-in').uncheck();await page.locator('#play-button').click();await page.waitForFunction(()=>document.querySelector('#engraving-range').textContent.startsWith('Measures 9–'));assert.match(await page.locator('#play-button').textContent(),/Pause/);await page.waitForFunction(()=>document.querySelector('#engraving-follow-status').textContent.includes('pass 2/2')&&document.querySelector('#engraving-range').textContent.startsWith('Measures 1–8'));assert.match(await page.locator('#play-button').textContent(),/Pause/);await page.waitForFunction(()=>document.querySelector('#transport-status').textContent.includes('Complete'));assert.match(await page.locator('#engraving-follow-status').textContent(),/End of performance/);assert.match(await page.locator('#engraving-range').textContent(),/Measures 17–20/);await screenshot('measure-following');assert.deepEqual(await exportScore(),score);
 await page.locator('#engraving-prev').click();assert.equal(await page.locator('#engraving-follow').isChecked(),false);assert.match(await page.locator('#engraving-follow-status').textContent(),/Manual navigation suspended/);assert.equal(requests.filter(request=>request.path==='/api/notation-navigation').length,1);
});

test('complete CC0 D768 edition retains every event and source while range gates, later pages and following remain explicit', {timeout:60_000},async()=>{
  const edition=JSON.parse(await readFile(join(root,'catalog/editions/cc0-schubert-wandrers-nachtlied-d768/score.json'),'utf8'));
  const written=edition.parts.flatMap(part=>part.notes),pitched=written.filter(note=>note.pitch),voice=edition.parts.find(part=>part.instrument==='Voice'),piano=edition.parts.find(part=>part.instrument==='piano');
  assert.equal(written.length,334);assert.equal(pitched.length,324);assert.equal(edition.measures.length,14);assert.equal(edition.provenance.kind,'curated_cc0_edition');assert.equal(edition.provenance.license,'CC0-1.0');assert.ok(voice&&piano);
  const[response]=await Promise.all([nextResponse('/api/compile'),page.locator('.catalog-item').filter({hasText:edition.title}).click()]);const compiled=await responseJson(response);await readyForTitle(edition.title);assert.deepEqual(compiled.score,edition);assert.equal(compiled.timeline.notes.length,321);assert.deepEqual(compiled.timeline.notes.flatMap(note=>note.source_note_ids).sort(),pitched.map(note=>note.id).sort(),'All pitched source IDs survive tie compilation');
  assert.match(await page.locator('#score-meta').textContent(),/334 written events.*321 playback note events.*14 measures/);assert.match(await page.locator('#score-retention-note').textContent(),/324 pitched note segments \+ 10 rests/);assert.equal(await page.locator('#score-origin-label').textContent(),'CC0 source edition');assert.equal(await page.locator(`#practice-part option[value="${voice.id}"]`).textContent(),voice.name,'Raw part names are retained rather than silently cleaned');
  await waitForEngraving();assert.equal(await page.locator('#engraved-button').getAttribute('aria-pressed'),'true');assert.ok(await page.locator('#engraved-staff svg path').count()>100);await screenshot('cc0-d768-light');
  await page.locator('#score-details-button').click();assert.match(await page.locator('#provenance').textContent(),/Johann Wolfgang von Goethe/);assert.match(await page.locator('#provenance').textContent(),/pental/);assert.match(await page.locator('#diagnostic-list').textContent(),/327 key attacks versus 321 canonical/);assert.match(await page.locator('#diagnostic-list').textContent(),/fermata/);assert.equal(await page.locator('#provenance-link').getAttribute('href'),edition.provenance.source_url);await page.locator('#score-details>summary').click();assert.deepEqual(await exportScore(),edition);
  assert.equal(await page.locator('#key-count').inputValue(),'61');await page.locator('#session-mode').selectOption('practice');await page.waitForFunction(()=>document.querySelector('#practice-gate-reason').textContent.includes('cannot be played'));assert.equal(await page.locator('#play-button').isDisabled(),true);assert.equal(await page.locator('#assess-button').isDisabled(),true);
  await page.locator('#practice-part').selectOption(voice.id);await page.locator('#play-button:not([disabled])').waitFor();assert.equal(await page.locator('#key-count').inputValue(),'61');await page.locator('#practice-part').selectOption(piano.id);await page.waitForFunction(()=>document.querySelector('#practice-gate-reason').textContent.includes('cannot be played'));assert.equal(await page.locator('#play-button').isDisabled(),true);await page.locator('#practice-part').selectOption('');await page.locator('#key-count').selectOption('76');await page.locator('#play-button:not([disabled])').waitFor();await page.locator('#session-mode').selectOption('listen');assert.deepEqual(await exportScore(),edition,'Part/profile changes never adapt or discard source events');
  await page.locator('#engraving-next').click();await page.waitForFunction(()=>document.querySelector('#engraving-status').textContent.includes('Measures 9–14'));assert.match(await page.locator('#engraving-range').textContent(),/Measures 9–14 \/ 14/);await screenshot('cc0-d768-later-page');await page.locator('#theme-mode').selectOption('dark');await page.waitForFunction(()=>document.documentElement.dataset.theme==='dark'&&document.querySelector('#engraving-status').textContent.includes('Measures 9–14'));await screenshot('cc0-d768-dark');
  await page.locator('.practice-options summary').click();await page.locator('#loop-from').fill('32');await page.locator('#loop-to').fill('36');const[windowResponse]=await Promise.all([nextResponse('/api/practice-window'),page.locator('#loop-apply').click()]);const window=await responseJson(windowResponse);await page.waitForFunction(()=>document.querySelector('#loop-status').textContent.includes('ready'));await page.locator('#count-in').uncheck();const[navigationResponse]=await Promise.all([nextResponse('/api/notation-navigation'),page.locator('#engraving-follow').check()]);const navigation=await responseJson(navigationResponse);assert.equal(navigation.occurrences.length,14);assert.equal(navigation.sounding_groups.length,321);assert.ok(navigation.occurrences.every(occurrence=>occurrence.repeat_region_index===null));await page.waitForFunction(()=>document.querySelector('#engraving-follow-status').textContent.includes('source 9/14'));
  await page.locator('#play-button').click();await page.waitForFunction(start=>document.querySelector('#progress').value>start,window.start_ms);assert.match(await page.locator('#engraving-follow-status').textContent(),/Following written measure 9/);assert.match(await page.locator('#engraving-range').textContent(),/Measures 9–14/);await page.locator('#play-button').click();assert.match(await page.locator('#transport-status').textContent(),/Paused/);assert.deepEqual(await exportScore(),edition);await page.locator('#engraving-prev').click();assert.equal(await page.locator('#engraving-follow').isChecked(),false);assert.match(await page.locator('#engraving-follow-status').textContent(),/Manual navigation suspended/);
});
