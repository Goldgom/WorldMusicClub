/**
 * Real Chromium + real Rust MusicXML export + the shipped OSMD bundle.
 * Prepare assets and build the server before running. No score/API/OSMD mocks.
 * Only the test HTML shell is fulfilled by Playwright; all JS/assets/APIs use Rust.
 * The missing-asset case deliberately aborts the bundle request as fault injection.
 * WMH_SERVER_BINARY / WMH_ARTIFACT_DIR match full-app-browser.test.js.
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
import {createHash} from 'node:crypto';
import {chromium} from 'playwright';
import {ENGRAVING_BUNDLE_SHA256} from '../web/engraving.js';

const root = fileURLToPath(new URL('../', import.meta.url));
const binary = resolve(root, process.env.WMH_SERVER_BINARY || join('target', 'debug', `practice-server${process.platform === 'win32' ? '.exe' : ''}`));
const artifacts = resolve(process.env.WMH_ARTIFACT_DIR || tmpdir());
const options = {timeout: 45_000};
const harness = '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>WorldMusicHub real engraving verification</title></head><body style="margin:0;padding:20px;background:#eff4ee;color:#17251d;font:16px system-ui"><main style="max-width:1200px;margin:auto"><h1>WorldMusicHub · Staff engraving</h1><p id="caption">Original score · Rust MusicXML export · offline OpenSheetMusicDisplay</p><div id="viewport" style="overflow:auto;border-radius:14px;border:1px solid #9baca0"><div id="staff" style="width:100%;min-height:160px"></div></div><p id="status" role="status"></p></main></body></html>';
let server, serverError, serverOutput = '', browser, context, page, origin, productionCsp, duet;
let pageErrors = [], apiFailures = [], offOrigin = [], requests = [];

async function availablePort() {
  const reservation = createServer();
  await new Promise((yes, no) => {reservation.once('error', no); reservation.listen(0, '127.0.0.1', yes);});
  const port = reservation.address().port;
  await new Promise((yes, no) => reservation.close(error => error ? no(error) : yes()));
  return port;
}
const running = () => server && server.exitCode === null && server.signalCode === null && !serverError;
const emergencyStop = () => { if (running()) server.kill('SIGKILL'); };
const interrupt = () => { emergencyStop(); process.exit(130); };
async function stopServer() {
  if (!running()) return;
  const exited = new Promise(yes => server.once('exit', yes));
  server.kill('SIGTERM');
  await Promise.race([exited, delay(2500, undefined, {ref: false})]);
  if (running()) {server.kill('SIGKILL'); await Promise.race([exited, delay(2500, undefined, {ref: false})]);}
  assert.ok(!running(), 'Engraving test Rust server failed to stop');
}
async function waitForServer() {
  const deadline = Date.now() + 15_000;
  let error;
  while (Date.now() < deadline) {
    if (serverError) throw serverError;
    if (!running()) throw Error(`Rust server exited while starting: ${serverOutput}`);
    try {
      const response = await fetch(`${origin}/api/health`, {signal: AbortSignal.timeout(1000)});
      assert.equal(response.status, 200);
      const health = await response.json();
      assert.equal(health.engine, 'rust');
      assert.equal(health.network, 'loopback-only');
      productionCsp = response.headers.get('content-security-policy');
      assert.match(productionCsp, /script-src 'self'/);
      return;
    } catch (failure) {error = failure; await delay(100);}
  }
  throw Error(`Rust startup timed out: ${error?.message}\n${serverOutput}`);
}

before(async () => {
  assert.ok(existsSync(binary), `Build first: npm run prepare:engraving && cargo build -p practice-server --locked\nMissing ${binary}`);
  await mkdir(artifacts, {recursive: true});
  const port = await availablePort();
  origin = `http://127.0.0.1:${port}`;
  server = spawn(binary, ['--no-open', '--port', String(port)], {cwd: root, stdio: ['ignore', 'pipe', 'pipe']});
  server.on('error', error => {serverError = error;});
  for (const stream of [server.stdout, server.stderr]) {
    stream.setEncoding('utf8');
    stream.on('data', chunk => {serverOutput = (serverOutput + chunk).slice(-32_768);});
  }
  process.once('exit', emergencyStop); process.once('SIGINT', interrupt); process.once('SIGTERM', interrupt);
  await waitForServer();
  const vendorResponse = await fetch(`${origin}/vendor/opensheetmusicdisplay.min.js`);
  assert.equal(vendorResponse.status, 200, 'Prepare vendor assets BEFORE building the Rust executable');
  assert.match(vendorResponse.headers.get('content-type'), /javascript/);
  const vendor = Buffer.from(await vendorResponse.arrayBuffer());
  assert.equal(createHash('sha256').update(vendor).digest('hex'), ENGRAVING_BUNDLE_SHA256);
  const source = await readFile(new URL('./fixtures/original-duet.musicxml', import.meta.url), 'utf8');
  const imported = await fetch(`${origin}/api/import/musicxml`, {method: 'POST', headers: {'Content-Type': 'application/xml'}, body: source});
  assert.equal(imported.status, 200, await imported.clone().text());
  duet = await imported.json();
  const executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || ['/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/google-chrome'].find(existsSync);
  browser = await chromium.launch({...(executablePath ? {executablePath} : {}), headless: true, timeout: 30_000, args: ['--no-sandbox', '--disable-dev-shm-usage']});
}, {timeout: 60_000});

after(async () => {
  try {await browser?.close();}
  finally {
    try {await stopServer();}
    finally {process.removeListener('exit', emergencyStop); process.removeListener('SIGINT', interrupt); process.removeListener('SIGTERM', interrupt);}
  }
}, {timeout: 15_000});

async function openHarnessContext(deviceScaleFactor = 1) {
  context = await browser.newContext({viewport: {width: 1440, height: 1100}, colorScheme: 'light', serviceWorkers: 'block', deviceScaleFactor});
  context.setDefaultTimeout(10_000); context.setDefaultNavigationTimeout(15_000);
  // Block any unexpected network destination before it can receive score data.
  await context.route('**/*', async route => {
    const url = new URL(route.request().url());
    if (url.origin !== origin) {offOrigin.push(url.href); return route.abort('blockedbyclient');}
    await route.continue();
  });
  // A fixed local HTML shell isolates the adapter from the still-independent application UI.
  // Reuse the actual server CSP; do not relax policy for the renderer.
  await context.route(`${origin}/__engraving-harness`, route => route.fulfill({status: 200, contentType: 'text/html; charset=utf-8', headers: {'Content-Security-Policy': productionCsp, 'X-Content-Type-Options': 'nosniff'}, body: harness}));
  page = await context.newPage();
  page.on('pageerror', error => pageErrors.push(error.message));
  page.on('request', request => requests.push(request.url()));
  page.on('response', response => {const url = new URL(response.url()); if (url.origin === origin && url.pathname.startsWith('/api/') && response.status() >= 400) apiFailures.push(`${response.status()} ${url.pathname}`);});
  await page.goto(`${origin}/__engraving-harness`, {waitUntil: 'domcontentloaded'});
  await page.evaluate(async () => {window.engraving = await import('/engraving.js');});
}
beforeEach(async () => {
  pageErrors = []; apiFailures = []; offOrigin = []; requests = [];
  await openHarnessContext();
}, {timeout: 25_000});

afterEach(async t => {
  try {
    assert.deepEqual(pageErrors, [], 'No uncaught browser errors');
    assert.deepEqual(apiFailures, [], 'Every browser API call must reach a successful Rust response');
    assert.deepEqual(offOrigin, [], 'Engraving must not request any off-origin resource');
    assert.ok(requests.every(url => new URL(url).origin === origin), 'All observed browser requests stay on the local origin');
  } finally {
    if (t.signal.aborted && page && !page.isClosed()) await page.screenshot({path: join(artifacts, 'worldmusichub-engraving-failure.png'), fullPage: true, timeout: 3000}).catch(() => {});
    await context?.close();
  }
}, {timeout: 10_000});

async function exportScore(score = duet.score) {
  const response = await page.evaluate(async score => {
    const response = await fetch('/api/export/musicxml', {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(score)});
    return {status: response.status, body: await response.json()};
  }, score);
  assert.equal(response.status, 200, JSON.stringify(response.body));
  assert.match(response.body.xml, /^<\?xml/);
  assert.ok(Array.isArray(response.body.voice_id_map));
  return response.body;
}
async function render(xml, renderOptions = {}) {
  const outcome = await page.evaluate(async ({xml, options}) => {
    const rendered = await window.engraving.renderEngravedStaff(document.querySelector('#staff'), xml, options);
    window.lastEngraving = rendered;
    document.querySelector('#status').textContent = rendered.message;
    return {ok: rendered.ok, status: rendered.status, message: rendered.message, metadata: rendered.metadata};
  }, {xml, options: renderOptions});
  assert.equal(outcome.status, 'ready', outcome.message);
  await page.locator('#staff svg').first().waitFor({state: 'visible'});
  return outcome;
}
async function geometry() {
  return page.evaluate(() => {
    const root = document.querySelector('#staff');
    const count = selector => root.querySelectorAll(selector).length;
    return {svg: count('svg'), paths: count('svg path'), notes: count('.vf-stavenote'), noteheads: count('.vf-notehead'), ties: count('.vf-stavetie'), clefs: count('.vf-clef'), keys: count('.vf-keysignature'), times: count('.vf-timesignature'), stems: count('.vf-stem'), noteheadShapes: new Set([...root.querySelectorAll('.vf-notehead path')].map(path => path.getAttribute('d'))).size, text: root.textContent, width: root.clientWidth, mountWidth: root.firstElementChild?.getBoundingClientRect().width, height: root.getBoundingClientRect().height};
  });
}
async function screenshot(name) {
  await page.evaluate(async () => {await document.fonts.ready; await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));});
  await page.screenshot({path: join(artifacts, `worldmusichub-engraving-${name}.png`), fullPage: true, animations: 'disabled'});
}

test('Rust-exported original duet engraves durations, rests, ties, voices, two staves and signatures', options, async () => {
  const exported = await exportScore();
  assert.match(exported.xml, /<rest\s*\/>/);
  assert.match(exported.xml, /<type>half<\/type>/);
  assert.match(exported.xml, /<type>quarter<\/type>/);
  assert.match(exported.xml, /<staves>2<\/staves>/);
  assert.match(exported.xml, /<tied type="start"/);
  assert.match(exported.xml, /<voice>2<\/voice>/);
  assert.match(exported.xml, /<fifths>-2<\/fifths>/);
  const shown = await render(exported.xml);
  assert.equal(shown.metadata.measureCount, 3);
  assert.equal(shown.metadata.partIds.length, 2);
  await screenshot('light');
  const drawn = await geometry();
  assert.ok(drawn.paths > 30, JSON.stringify(drawn));
  assert.ok(drawn.notes >= 8 && drawn.noteheads >= 10, JSON.stringify(drawn));
  assert.ok(drawn.noteheadShapes >= 4, 'Pitched half/quarter notes and rests must not collapse to one pitch-only glyph');
  assert.ok(drawn.ties >= 1, 'The actual SVG must contain VexFlow tie geometry');
  assert.ok(drawn.clefs >= 3, 'Both piano staves plus the second part must be engraved');
  assert.ok(drawn.keys >= 3 && drawn.times >= 3, JSON.stringify(drawn));
  assert.match(drawn.text, /Small Exact Duet/);
  assert.match(drawn.text, /Piano/);
  assert.match(drawn.text, /Guitar/);
  assert.ok(requests.some(url => url.endsWith('/vendor/opensheetmusicdisplay.min.js')));
});

test('part selection hides the other instrument without changing canonical notes or exported XML', options, async () => {
  const before = JSON.stringify(duet.score);
  const exported = await exportScore();
  await render(exported.xml);
  const all = await geometry();
  const piano = exported.part_id_map[duet.score.parts[0].id];
  const guitar = exported.part_id_map[duet.score.parts[1].id];
  await render(exported.xml, {partIds: [piano]});
  const selected = await geometry();
  assert.ok(selected.clefs >= 2 && selected.clefs < all.clefs, JSON.stringify({all, selected}));
  assert.doesNotMatch(selected.text, /Guitar/);
  assert.ok(selected.ties >= 1);
  await render(exported.xml, {partIds: [guitar]});
  const other = await geometry();
  assert.ok(other.noteheads < selected.noteheads);
  assert.equal(other.ties, 0);
  assert.doesNotMatch(other.text, /Piano/);
  assert.equal(JSON.stringify(duet.score), before);
  assert.equal((await exportScore()).xml, exported.xml);
});

test('Beethoven rest-only voice pages retain source measures and recover other visible parts', options, async () => {
  const score=JSON.parse(await readFile(join(root,'catalog/editions/cc0-beethoven-gottes-macht-op48-5/score.json'),'utf8'));
  const before=JSON.stringify(score),exported=await exportScore(score);
  const voice=exported.part_id_map.P1,piano=exported.part_id_map.P2,evidence=[];
  const rests=score.parts.find(part=>part.id==='P1').notes.filter(note=>note.at.numerator/note.at.denominator>=56);
  assert.equal(rests.length,4);assert.ok(rests.every(note=>note.pitch===null&&note.duration.numerator/note.duration.denominator===4));
  for(const fromMeasure of [15,17]){
    const shown=await render(exported.xml,{partIds:[voice],fromMeasure,toMeasure:fromMeasure+1});
    const drawn=await geometry();assert.equal(shown.metadata.fromMeasure,fromMeasure);assert.equal(shown.metadata.toMeasure,fromMeasure+1);
    assert.equal(drawn.notes,2,'Both source rest measures must have actual VexFlow note/rest geometry');
    assert.ok(drawn.svg>0&&drawn.paths>0);assert.doesNotMatch(drawn.text,/Pianoforte/);
    evidence.push({part:'P1',fromMeasure,toMeasure:fromMeasure+1,geometry:drawn});
    await screenshot(`beethoven-voice-rests-${fromMeasure}-${fromMeasure+1}`);
  }
  for(const [part,partIds]of [['P2',[piano]],['all',[voice,piano]]]){
    await render(exported.xml,{partIds,fromMeasure:17,toMeasure:18});
    const drawn=await geometry();assert.ok(drawn.svg>0&&drawn.notes>2);assert.match(drawn.text,/Pianoforte/);
    evidence.push({part,fromMeasure:17,toMeasure:18,geometry:drawn});
  }
  assert.equal(JSON.stringify(score),before);assert.equal((await exportScore(score)).xml,exported.xml);
  await writeFile(join(artifacts,'worldmusichub-live-beethoven-rest-paging.json'),JSON.stringify({score_id:score.id,canonical_score_unchanged:true,exported_xml_unchanged:true,evidence},null,2));
});

test('measure windows count the initial pickup as ordinal one and preserve the later tie', options, async () => {
  const exported = await exportScore();
  assert.match(exported.xml, /<measure number="0" implicit="yes">/);
  const first = await render(exported.xml, {fromMeasure: 1, toMeasure: 1});
  const pickup = await geometry();
  const second = await render(exported.xml, {fromMeasure: 2, toMeasure: 2});
  const middle = await geometry();
  const third = await render(exported.xml, {fromMeasure: 3, toMeasure: 3});
  const finalBar = await geometry();
  assert.deepEqual([first.metadata.fromMeasure, first.metadata.toMeasure], [1, 1]);
  assert.deepEqual([second.metadata.fromMeasure, second.metadata.toMeasure], [2, 2]);
  assert.deepEqual([third.metadata.fromMeasure, third.metadata.toMeasure], [3, 3]);
  assert.ok(pickup.noteheads < middle.noteheads, JSON.stringify({pickup, middle}));
  assert.equal(pickup.ties, 0);
  assert.equal(middle.ties, 0, 'Ordinal two must not accidentally render the final measure');
  assert.ok(finalBar.ties >= 1, 'Ordinal three must include the final tied notes');
});

test('dark engraving reflows at a narrow viewport and exports a readable screenshot', options, async () => {
  const exported = await exportScore();
  await page.evaluate(() => {document.body.style.background = '#101513'; document.body.style.color = '#f3f5ef';});
  await render(exported.xml, {dark: true});
  const wide = await geometry();
  await page.setViewportSize({width: 390, height: 844});
  await page.waitForFunction(() => {
    const host = document.querySelector('#staff');
    const expected = Math.max(320, Math.min(4096, Math.round(host.clientWidth) || 800));
    return host.firstElementChild?.style.width === `${expected}px`;
  });
  await screenshot('dark');
  const narrow = await geometry();
  assert.ok(narrow.mountWidth >= 320 && narrow.mountWidth <= 350, JSON.stringify(narrow));
  assert.ok(narrow.mountWidth < wide.mountWidth);
  assert.equal(narrow.noteheads, wide.noteheads, 'Reflow must keep all note/rest glyphs');
  assert.ok(await page.locator('#staff .vf-notehead path').evaluateAll(paths => paths.some(path => getComputedStyle(path).fill === 'rgb(243, 245, 239)')), 'Dark mode must use the configured light notation color');
  await page.evaluate(() => window.lastEngraving.dispose());
  await page.setViewportSize({width: 800, height: 900});
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  assert.equal(await page.locator('#staff svg').count(), 0, 'Disposed resize observers must not resurrect an engraving');
});

test('newer render wins and aborted rendering never replaces the current DOM', options, async () => {
  const oldScore = structuredClone(duet.score); oldScore.title = 'Superseded engraving';
  const newScore = structuredClone(duet.score); newScore.title = 'Latest engraving';
  const older = await exportScore(oldScore), latest = await exportScore(newScore);
  const outcomes = await page.evaluate(async ({older, latest}) => {
    const host = document.querySelector('#staff');
    const first = window.engraving.renderEngravedStaff(host, older);
    const second = window.engraving.renderEngravedStaff(host, latest);
    const [oldResult, newResult] = await Promise.all([first, second]);
    oldResult.dispose(); // A cancelled result must not delete the new one.
    return {oldStatus: oldResult.status, newStatus: newResult.status, text: host.textContent, nodes: host.querySelectorAll('.engraved-staff').length};
  }, {older: older.xml, latest: latest.xml});
  assert.equal(outcomes.oldStatus, 'cancelled');
  assert.equal(outcomes.newStatus, 'ready');
  assert.equal(outcomes.nodes, 1);
  assert.match(outcomes.text, /Latest engraving/);
  assert.doesNotMatch(outcomes.text, /Superseded engraving/);
  const cancelled = await page.evaluate(async xml => {
    const host = document.querySelector('#staff');
    const controller = new AbortController();
    const pending = window.engraving.renderEngravedStaff(host, xml, {}, controller.signal);
    controller.abort();
    const outcome = await pending;
    const basic = document.createElement('p'); basic.id = 'basic-fallback'; basic.textContent = 'Basic pitch view'; host.replaceChildren(basic);
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    return {status: outcome.status, text: host.textContent, svg: host.querySelectorAll('svg').length};
  }, older.xml);
  assert.equal(cancelled.status, 'cancelled');
  assert.equal(cancelled.svg, 0);
  assert.equal(cancelled.text, 'Basic pitch view');
});

test('missing bundle preserves a labelled basic view and a later retry uses the real asset', options, async () => {
  const exported = await exportScore();
  const bundle = `${origin}/vendor/opensheetmusicdisplay.min.js`;
  await context.route(bundle, route => route.abort('failed'));
  const failed = await page.evaluate(async xml => {
    const host = document.querySelector('#staff');
    const basic = document.createElement('p'); basic.id = 'basic-fallback'; basic.textContent = 'Basic pitch view'; host.appendChild(basic);
    const outcome = await window.engraving.renderEngravedStaff(host, xml);
    return {status: outcome.status, message: outcome.message, sameFallback: host.firstElementChild === basic, svg: host.querySelectorAll('svg').length};
  }, exported.xml);
  assert.equal(failed.status, 'unavailable');
  assert.match(failed.message, /offline engraving bundle is unavailable/);
  assert.equal(failed.sameFallback, true);
  assert.equal(failed.svg, 0);
  await context.unroute(bundle);
  await render(exported.xml);
  assert.equal(await page.locator('#basic-fallback').count(), 0);
  assert.ok((await geometry()).ties >= 1);
});


test('fresh high-DPI original staff fixtures are suitable inputs for separate local OMR evaluation', options, async () => {
  await context.close();
  await openHarnessContext(3);
  const catalog=await page.evaluate(async()=>{const response=await fetch('/api/catalog');if(!response.ok)throw Error('Catalog unavailable');return response.json()});
  const melody=catalog.find(score=>score.id==='first-steps');assert.equal(melody.provenance.kind,'original_exercise');
  for(const [name,score] of [['duet',duet.score],['melody',melody]]){
    const exported=await exportScore(score);await render(exported.xml,{zoom:1.2});
    const path=join(artifacts,`worldmusichub-omr-original-${name}-3x.png`);
    await page.locator('#staff').screenshot({path,animations:'disabled',scale:'device'});
    const png=await readFile(path),width=png.readUInt32BE(16),height=png.readUInt32BE(20);
    assert.ok(width>=3000&&width*height<=16_000_000,'Fresh fixture is high-DPI but within the image-import pixel cap');
    await writeFile(join(artifacts,`worldmusichub-omr-original-${name}-groundtruth.json`),JSON.stringify({fixture_version:1,kind:'original-generated-engraving',renderer:'OpenSheetMusicDisplay 2.1.3',device_scale_factor:3,zoom:1.2,width,height,image_sha256:createHash('sha256').update(png).digest('hex'),score,musicxml:exported.xml,note:'Generated test input, not an OMR success claim. Compare separately recognized output against this canonical score.'},null,2)+'\n');
  }
});
