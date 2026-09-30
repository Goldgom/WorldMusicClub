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
let browserConsole = [], failedResources = [], resourceFailures = [];
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

async function screenshot(name) {
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

beforeEach(async () => {
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
    if (t.signal.aborted && page && !page.isClosed()) {
      await page.screenshot({path: join(artifactDirectory, 'worldmusichub-live-failure.png'), fullPage: true, timeout: 3000}).catch(() => {});
    }
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
  await page.getByLabel('Pitch for note 1', {exact: true}).fill('F#4');
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
  assert.equal(compiled.timeline.notes[0].midi, 66);
  assert.deepEqual(compiled.score.parts[0].notes[0].pitch, {step: 'F', alter: 1, octave: 4});
  assert.deepEqual(compiled.score.parts[0].notes[0].duration, {numerator: 4, denominator: 4});
  await assertStoppedAtZero();
  const exported = await exportScore();
  assert.deepEqual(exported, compiled.score);
  assert.equal(exported.source.format, 'image-review');
  assert.equal(exported.source.filename, 'original-scale.png');
  const preserved = JSON.parse(exported.source.content);
  assert.deepEqual(preserved.recognition_review, review);
  assert.deepEqual(Buffer.from(preserved.original_image_data_url.split(',')[1], 'base64'), png);
  assert.equal(preserved.manual_notes[0].pitch, 'F#4');
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
  const [compiledResponse] = await Promise.all([
    nextResponse('/api/compile'),
    page.locator('#score-file').setInputFiles({name:'original-duet.musicxml',mimeType:'application/xml',buffer:Buffer.from(source)}),
  ]);
  const compiled = await responseJson(compiledResponse);
  await readyForTitle(compiled.score.title);
  const before = await exportScore();
  const [xmlResponse] = await Promise.all([nextResponse('/api/export/musicxml'),page.locator('#engraved-button').click()]);
  const exported = await responseJson(xmlResponse);
  assert.match(exported.xml, /^<\?xml/);
  assert.ok(Object.hasOwn(exported.part_id_map,compiled.score.parts[0].id));
  await page.locator('#engraved-staff svg').first().waitFor({state:'visible',timeout:25_000});
  await page.waitForFunction(()=>document.querySelector('#engraving-status').textContent.includes('Generated staff preview'));
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
