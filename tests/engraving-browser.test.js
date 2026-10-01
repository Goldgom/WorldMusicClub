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
    if (page && !page.isClosed()) {
      const mismatch = await page.evaluate(() => window.__wmhBinding?.tupleMismatch || null).catch(() => null);
      if (mismatch) {
        const filename = `worldmusichub-binding-tuple-mismatch-${t.name.replace(/[^a-z0-9-]+/gi, '-').slice(0, 90)}.json`;
        await writeFile(join(artifacts, filename), JSON.stringify(mismatch, null, 2) + '\n');
        console.log('Exact written-tuple mismatch evidence', filename, JSON.stringify({expected: mismatch.expected, graphNoteCount: mismatch.graphNoteCount, adapterStatus: mismatch.adapter.status}));
      }
    }
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

// Real renderer identity and isolated notehead-paint acceptance.
const bindingBeat = (numerator, denominator = 1) => ({numerator, denominator});
const bindingPitch = (step, octave, alter = 0) => ({step, alter, octave});
function bindingNote(id, at, duration, pitch, voice = 'melody', extra = {}) {
  return {id, at: bindingBeat(at), duration: bindingBeat(duration), pitch,
    voice, staff: 1, velocity: 80, tie_start: false, tie_stop: false, ...extra};
}
function bindingScore({includeUnisons = false} = {}) {
  return {
    version: 1, id: 'original-written-binding-acceptance',
    title: 'Original written-note binding exercise', composer: 'WorldMusicHub test authors',
    provenance: {kind: 'original_exercise', attribution: 'Original synthetic acceptance fixture by WorldMusicHub test authors', source_url: null, license: 'MIT'},
    source: null,
    parts: [{id: 'canonical/piano part', name: 'Binding piano', instrument: 'piano', notes: [
      // Deliberately reverse canonical pitch order. Export must put the longer
      // low head first; the short neighbouring head must still clear by itself.
      bindingNote('up-short-D4', 0, 1, bindingPitch('D', 4)),
      bindingNote('up-long-C4', 0, 2, bindingPitch('C', 4)),
      // Above the treble middle line, so the second chord must be down-stem.
      bindingNote('down-long-F5', 2, 2, bindingPitch('F', 5)),
      bindingNote('down-short-E5', 2, 1, bindingPitch('E', 5)),
      bindingNote('written-rest', 4, 1, null),
      bindingNote('after-rest-B4', 5, 1, bindingPitch('B', 4)),
      // Exactly equal pitch/onset/duration on one staff, but distinct XML voices.
      // Labels are selected to catch parseInt-based canonical-voice collisions.
      ...(includeUnisons ? [
        bindingNote('unison-01', 6, 1, bindingPitch('G', 4), '01'),
        bindingNote('unison-1abc', 6, 1, bindingPitch('G', 4), '1abc'),
      ] : []),
      bindingNote('cross-bar-A4', 7, 2, bindingPitch('A', 4)),
      bindingNote('tie-start-D5', 9, 1, bindingPitch('D', 5), 'melody', {tie_start: true}),
      bindingNote('tie-stop-D5', 10, 1, bindingPitch('D', 5), 'melody', {tie_stop: true}),
      bindingNote('exact-third-F4', 11, 1, bindingPitch('F', 4), 'melody', {
        at: bindingBeat(34, 3), duration: bindingBeat(2, 3),
      }),
    ]}],
    tempo: [{at: bindingBeat(0), bpm: 90}],
    meters: [{at: bindingBeat(0), numerator: 4, denominator: 4}],
    keys: [{at: bindingBeat(0), fifths: 0, mode: 'major'}],
    // All three printed labels deliberately match; only SourceMeasures object
    // identity/index may distinguish them, including the cross-bar continuation.
    measures: [0, 4, 8].map(at => ({number: 7, at: bindingBeat(at), length: bindingBeat(4)})),
    repeats: [],
  };
}
const bindingStatusIsUsable = status => status?.status === 'ready' || status?.status === 'partial';

async function installBindingObservation() {
  await page.evaluate(() => {
    if (window.__wmhBinding) return;
    const watch = window.__wmhBinding = {
      renderer: null, renderCalls: 0, graphicColorCalls: 0, events: [],
      serial: 0, nodeIds: new WeakMap(), patched: new WeakSet(), baseline: new Map(),
      groups: new Map(), rows: [],
    };
    const proto = window.opensheetmusicdisplay.OpenSheetMusicDisplay.prototype;
    const original = proto.render;
    proto.render = function (...args) {
      watch.renderer = this; watch.renderCalls++;
      return Reflect.apply(original, this, args);
    };
    watch.nodeId = node => {
      if (!watch.nodeIds.has(node)) watch.nodeIds.set(node, ++watch.serial);
      return watch.nodeIds.get(node);
    };
    watch.paint = node => {
      const css = getComputedStyle(node);
      return JSON.stringify({fill: node.getAttribute('fill'), stroke: node.getAttribute('stroke'),
        style: node.getAttribute('style'), computedFill: css.fill,
        computedStroke: css.stroke, opacity: css.opacity, strokeWidth: css.strokeWidth});
    };
    watch.snapshot = () => {
      watch.baseline = new Map([...document.querySelectorAll('#staff svg, #staff svg *')]
        .map(node => [node, watch.paint(node)]));
    };
    watch.changed = () => [...watch.baseline]
      .filter(([node, before]) => watch.paint(node) !== before).map(([node]) => node);
    watch.patchColorObserver = object => {
      for (let p = Object.getPrototypeOf(object); p; p = Object.getPrototypeOf(p)) {
        if (watch.patched.has(p)) continue;
        watch.patched.add(p);
        for (const name of ['setColor', 'color']) {
          const descriptor = Object.getOwnPropertyDescriptor(p, name);
          if (typeof descriptor?.value !== 'function') continue;
          const original = descriptor.value;
          Object.defineProperty(p, name, {...descriptor, value: function (...args) {
            watch.graphicColorCalls++;
            return Reflect.apply(original, this, args);
          }});
        }
      }
    };
    // Quarter-beat comparison stays exact; OSMD stores whole-note fractions and
    // may put the integer part in WholeValue. Never use RealValue/float tolerance.
    watch.sameBeat = (fraction, beat) => {
      if (!fraction || !Number.isSafeInteger(fraction.Numerator) ||
          !Number.isSafeInteger(fraction.Denominator) || fraction.Denominator <= 0 ||
          !Number.isSafeInteger(fraction.WholeValue ?? 0)) return false;
      const n = BigInt(fraction.Numerator) + BigInt(fraction.WholeValue ?? 0) * BigInt(fraction.Denominator);
      return n * 4n * BigInt(beat.denominator) === BigInt(beat.numerator) * BigInt(fraction.Denominator);
    };
    watch.sourcePitch = source => source.isRest() ? null : {
      step: {0:'C', 2:'D', 4:'E', 5:'F', 7:'G', 9:'A', 11:'B'}[source.Pitch.FundamentalNote],
      alter: source.Pitch.AccidentalHalfTones,
      octave: source.Pitch.Octave + window.opensheetmusicdisplay.Pitch.OctaveXmlDifference,
    };
    // Rust's serde_json::Value can reorder object keys. Identity depends on the
    // three exact written values, never JSON object insertion order.
    watch.samePitch = (actual, expected) => actual === null || expected === null
      ? actual === expected
      : actual.step === expected.step && actual.alter === expected.alter && actual.octave === expected.octave;
    watch.assert = (condition, message) => {if (!condition) throw Error(message);};
    watch.reindex = () => {
      const renderer = watch.renderer, host = document.querySelector('#staff');
      const graph = [];
      for (const row of renderer.GraphicSheet.MeasureList) for (const measure of row || [])
        for (const staff of measure?.staffEntries || []) for (const voice of staff.graphicalVoiceEntries || [])
          for (const note of voice.notes || []) if (!graph.includes(note)) graph.push(note);
      watch.groups = new Map(); watch.rows = [];
      const sourceMeasures = renderer.Sheet.SourceMeasures;
      for (const segment of watch.exported.note_id_map.segments) {
        if (segment.source_measure_index < watch.from - 1 || segment.source_measure_index > watch.to - 1 ||
            !watch.partIds.includes(segment.xml_part_id)) continue;
        const candidates = graph.filter(g => {
          const n = g.sourceNote, staff = n.ParentStaff;
          return staff.ParentInstrument.IdString === segment.xml_part_id && staff.ParentInstrument.Staves.indexOf(staff) + 1 === segment.staff &&
            sourceMeasures.indexOf(n.SourceMeasure) === segment.source_measure_index &&
            String(n.ParentVoiceEntry.ParentVoice.VoiceId) === segment.xml_voice &&
            watch.sameBeat(n.ParentVoiceEntry.Timestamp, segment.measure_at) &&
            watch.sameBeat(n.getAbsoluteTimestamp(), segment.at) && watch.sameBeat(n.Length, segment.duration) &&
            watch.samePitch(watch.sourcePitch(n), segment.pitch);
        });
        if (candidates.length !== 1) {
          const fraction = value => value ? {wholeValue: value.WholeValue, numerator: value.Numerator, denominator: value.Denominator} : null;
          const mapping = window.lastEngraving.mappingStatus();
          watch.tupleMismatch = {
            expected: segment, graphNoteCount: graph.length, candidateCount: candidates.length,
            modelTuplesTruncated: graph.length > 64,
            modelTuples: graph.slice(0, 64).map(g => {
              const n = g.sourceNote, staff = n.ParentStaff;
              return {xmlPartId: staff.ParentInstrument.IdString,
                staff: staff.ParentInstrument.Staves.indexOf(staff) + 1,
                sourceMeasureIndex: sourceMeasures.indexOf(n.SourceMeasure),
                xmlVoice: String(n.ParentVoiceEntry.ParentVoice.VoiceId),
                measureAtWholeNotes: fraction(n.ParentVoiceEntry.Timestamp),
                atWholeNotes: fraction(n.getAbsoluteTimestamp()), durationWholeNotes: fraction(n.Length),
                pitch: watch.sourcePitch(n)};
            }),
            adapter: {status: mapping.status, verifiedGlyphCount: mapping.verifiedGlyphCount,
              bindings: mapping.bindings.slice(0, 64), diagnostics: mapping.diagnostics.slice(0, 16)},
          };
        }
        watch.assert(candidates.length === 1, `Independent exact source tuple must be unique: ${segment.source_note_id}/${segment.source_measure_index}; got ${candidates.length}`);
        const g = candidates[0], vf = g.vfnote?.[0], index = g.vfnote?.[1];
        const heads = g.getNoteheadSVGs();
        watch.assert(Number.isInteger(index) && index >= 0 && g.vfnoteIndex === index, 'Pinned graph/VF index agreement');
        watch.assert(vf && heads.length === vf.note_heads.length && index < heads.length, 'Pinned whole-chord head count/index bounds');
        const head = heads[index], vfHead = vf.note_heads[index];
        watch.assert(head?.isConnected && host.contains(head) && head.closest('svg'), 'Head belongs to current mount');
        watch.assert(head.classList.contains('vf-notehead') && head.querySelector('path'), 'Actual painted head/rest glyph');
        const bbox = head.getBBox(), screen = head.getBoundingClientRect();
        watch.assert(bbox.width > 0 && bbox.height > 0 && screen.width > 0 && screen.height > 0, 'Nonempty visible glyph geometry');
        if (segment.pitch) {
          // Independently prove indexed DOM order using actual rendered geometry.
          // y is the glyph's centre line; the sloped oval can be slightly asymmetric.
          const cy = bbox.y + bbox.height / 2;
          watch.assert(Math.abs(cy - vfHead.getY()) < Math.min(2, bbox.height / 3), 'DOM head centre must agree with indexed VexFlow pitch line');
          watch.assert(Math.abs(bbox.x - vfHead.getAbsoluteX()) < 2, 'DOM head x must agree with indexed displaced/un-displaced VexFlow head');
          const key = vf.getKeys()[index].toLowerCase();
          watch.assert(key.startsWith(segment.pitch.step.toLowerCase()) && key.endsWith(`/${segment.pitch.octave}`), 'VexFlow indexed written pitch agrees with canonical pitch');
        }
        const key = `${segment.source_note_id}@${segment.source_measure_index}`;
        const binding = window.lastEngraving.mappingStatus().bindings.find(entry => entry.xmlNoteId === segment.xml_note_id);
        watch.assert(Boolean(binding), 'Public status accounts for every displayed segment');
        watch.assert(binding.sourceNoteId === segment.source_note_id && binding.sourceMeasureIndex === segment.source_measure_index, 'Public identity matches exact Rust segment');
        if (binding.status === 'bound') watch.assert(![...watch.groups.values()].includes(head), 'Verified written segments cannot alias one mutable SVG head');
        watch.groups.set(key, head);
        watch.patchColorObserver(g); watch.patchColorObserver(g.parentVoiceEntry);
        watch.rows.push({key, sourceId: segment.source_note_id, measure: segment.source_measure_index,
          xmlVoice: segment.xml_voice, xmlNoteId: segment.xml_note_id, bindingStatus: binding.status, node: watch.nodeId(head), chord: segment.chord,
          stem: vf.getStemDirection?.(), displaced: vfHead.isDisplaced?.(),
          x: screen.x, y: screen.y, width: screen.width, height: screen.height,
          cx: screen.x + screen.width / 2, cy: screen.y + screen.height / 2,
          localX: bbox.x, localY: bbox.y, rest: segment.pitch === null,
          indexedHead: index, chordHeadCount: heads.length});
      }
      watch.snapshot();
      return watch.rows;
    };
    watch.checkExpected = (sourceNoteIds, sourceMeasureIndex) => {
      const expected = sourceNoteIds.map(id => watch.groups.get(`${id}@${sourceMeasureIndex}`));
      watch.assert(expected.every(Boolean), 'Every requested fixture note resolves independently');
      const changed = watch.changed();
      watch.assert(changed.every(node => expected.some(head => head === node || head.contains(node))),
        'Only exact expected head/rest subtrees may change; other heads, stems, beams, ties, accidentals and labels keep their original paint');
      for (const head of expected) {
        watch.assert([...head.querySelectorAll('path')].some(path => watch.baseline.get(path) !== watch.paint(path)),
          'Each expected source note must visibly change its own painted glyph');
      }
      watch.assert([...watch.baseline.keys()].every(node => node.isConnected), 'Highlighting must keep every mounted SVG element');
      return {changedElements: changed.length, rows: watch.rows.filter(row => sourceNoteIds.includes(row.sourceId) && row.measure === sourceMeasureIndex)};
    };
  });
}

async function renderBinding(score, exported, renderOptions = {}) {
  // First load the real shipped bundle through the production adapter. This warm
  // render is unbound; the observed render below is a fresh real OSMD instance.
  if (!await page.evaluate(() => Boolean(window.__wmhBinding))) {
    await render(exported.xml);
    await installBindingObservation();
  }
  const result = await page.evaluate(async ({score, exported, options}) => {
    const watch = window.__wmhBinding;
    watch.exported = exported;
    watch.from = options.fromMeasure ?? 1;
    watch.to = options.toMeasure ?? score.measures.length;
    watch.partIds = options.partIds ?? Object.values(exported.part_id_map);
    watch.events = [];
    const ready = await window.engraving.renderEngravedStaff(document.querySelector('#staff'), exported.xml, {
      ...options,
      identity: {score, noteMap: exported.note_id_map, partIdMap: exported.part_id_map, voiceIdMap: exported.voice_id_map},
      onMappingChange: status => watch.events.push({status, liveSvg: Boolean(document.querySelector('#staff svg'))}),
    });
    window.lastEngraving = ready;
    watch.assert(typeof ready.mappingStatus === 'function', 'Public mappingStatus API');
    watch.assert(typeof ready.setExpectedWrittenNotes === 'function', 'Public exact written-note setter');
    watch.assert(typeof ready.clearExpectedWrittenNotes === 'function', 'Public written-note clearer');
    return {status: ready.status, message: ready.message, mapping: ready.mappingStatus(), events: watch.events};
  }, {score, exported, options: renderOptions});
  assert.equal(result.status, 'ready', result.message);
  assert.ok(bindingStatusIsUsable(result.mapping), JSON.stringify(result.mapping));
  assert.equal(result.mapping.version, 1);
  assert.equal(result.mapping.segmentCount, exported.note_id_map.segments.length);
  assert.equal(result.mapping.bindings.length, result.mapping.segmentCount);
  assert.equal(result.mapping.verifiedGlyphCount, result.mapping.bindings.filter(binding => binding.status === 'bound').length);
  assert.equal(result.mapping.displayedSegmentCount, result.mapping.bindings.filter(binding => binding.status !== 'not-displayed').length);
  assert.ok(result.events.length >= 1, 'Mapping callback fires after successful initial mapping');
  assert.ok(result.events.every(event => event.liveSvg), 'Mapping publication follows mounted SVG publication');
  assert.deepEqual(result.events.at(-1).status, result.mapping, 'Callback publishes the current public status');
  const rows = await page.evaluate(() => window.__wmhBinding.reindex());
  return {result, rows};
}
async function expectBinding(sourceNoteIds, sourceMeasureIndex) {
  return page.evaluate(({sourceNoteIds, sourceMeasureIndex}) => {
    const accepted = window.lastEngraving.setExpectedWrittenNotes({sourceNoteIds, sourceMeasureIndex});
    window.__wmhBinding.assert(accepted === true, 'Valid exact request must be accepted');
    return window.__wmhBinding.checkExpected(sourceNoteIds, sourceMeasureIndex);
  }, {sourceNoteIds, sourceMeasureIndex});
}
async function clearBinding() {
  const outcome = await page.evaluate(() => {
    window.lastEngraving.clearExpectedWrittenNotes();
    return {changed: window.__wmhBinding.changed().length, allConnected: [...window.__wmhBinding.baseline.keys()].every(node => node.isConnected)};
  });
  assert.equal(outcome.changed, 0, 'Clear restores original fill/stroke/style attributes and computed paint for the whole SVG');
  assert.equal(outcome.allConnected, true);
}
async function bindingEvidence(name, data) {
  await screenshot(`binding-${name}`);
  await writeFile(join(artifacts, `worldmusichub-binding-${name}.json`), JSON.stringify(data, null, 2) + '\n');
}

test('exact unequal-duration chord heads and displaced seconds work for both stem directions without graph coloring or redraw', options, async () => {
  const score = bindingScore(), before = JSON.stringify(score), exported = await exportScore(score);
  assert.equal(exported.note_id_map?.version, 1);
  const {rows} = await renderBinding(score, exported);
  const cases = [
    {long: 'up-long-C4', short: 'up-short-D4', direction: 1},
    {long: 'down-long-F5', short: 'down-short-E5', direction: -1},
  ];
  for (const chord of cases) {
    const members = rows.filter(row => [chord.long, chord.short].includes(row.sourceId));
    assert.equal(members.length, 2); assert.ok(members.every(row => row.chordHeadCount === 2));
    assert.ok(members.every(row => row.stem === chord.direction), JSON.stringify(members));
    assert.ok(members.some(row => row.displaced), 'A neighbouring second must exercise a displaced head');
    assert.ok(Math.abs(members[0].cx - members[1].cx) > 2, 'Seconds must have distinct horizontal head geometry');
    assert.ok(Math.abs(members[0].cy - members[1].cy) > 2, 'Pitched geometry must prove which head is which');
    const long = exported.note_id_map.segments.find(segment => segment.source_note_id === chord.long);
    const short = exported.note_id_map.segments.find(segment => segment.source_note_id === chord.short);
    assert.deepEqual(long.duration, bindingBeat(2)); assert.deepEqual(short.duration, bindingBeat(1));
    await expectBinding([chord.long, chord.short], 0);
    await expectBinding([chord.long], 0); // Short head must immediately restore while long remains marked.
    await expectBinding([chord.short], 0); // Reverse membership catches accidental whole-chord coloring.
    await clearBinding();
  }
  const activity = await page.evaluate(async () => {
    const watch = window.__wmhBinding;
    const before = {renders: watch.renderCalls, graphColors: watch.graphicColorCalls, nodes: [...watch.baseline.keys()]};
    let childMutations = 0;
    const observer = new MutationObserver(records => {childMutations += records.filter(r => r.type === 'childList').length;});
    observer.observe(document.querySelector('#staff'), {subtree: true, childList: true});
    // Bounded display loop: changing exact expected membership is the only input.
    for (let frame = 0; frame < 12; frame++) {
      const sourceNoteIds = frame % 2 ? ['up-long-C4'] : ['up-long-C4', 'up-short-D4'];
      window.lastEngraving.setExpectedWrittenNotes({sourceNoteIds, sourceMeasureIndex: 0});
      watch.checkExpected(sourceNoteIds, 0);
      await new Promise(resolve => requestAnimationFrame(resolve));
    }
    observer.disconnect();
    return {renders: watch.renderCalls - before.renders, graphColors: watch.graphicColorCalls - before.graphColors,
      childMutations, sameNodes: before.nodes.every(node => node.isConnected)};
  });
  assert.deepEqual(activity, {renders: 0, graphColors: 0, childMutations: 0, sameNodes: true});
  await clearBinding();
  assert.equal(JSON.stringify(score), before, 'Canonical source remains unchanged');
  assert.equal((await exportScore(score)).xml, exported.xml);
  await bindingEvidence('chord-seconds-both-stems', {activity, rows, note_id_map: exported.note_id_map});
});

test('rests bind exactly and same-staff identical unisons are individually verified or explicitly unavailable', options, async () => {
  const score = bindingScore({includeUnisons: true});
  // The same written pitch/onset also occurs in a different part, and in the
  // original part's second staff. Neither may be conflated with the first staff.
  score.parts[0].notes.push(bindingNote('other-staff-G4', 6, 1, bindingPitch('G', 4), '01', {staff: 2}));
  score.parts.push({id: 'canonical/second part', name: 'Binding second part', instrument: 'piano',
    notes: [bindingNote('other-part-G4', 6, 1, bindingPitch('G', 4), '01')]});
  const exported = await exportScore(score);
  const {rows} = await renderBinding(score, exported);
  const unisons = rows.filter(row => row.sourceId.startsWith('unison-'));
  assert.equal(unisons.length, 2);
  assert.equal(new Set(unisons.map(row => row.xmlVoice)).size, 2);
  const coincident = unisons[0].node === unisons[1].node ||
    (Math.abs(unisons[0].cx - unisons[1].cx) < 0.5 && Math.abs(unisons[0].cy - unisons[1].cy) < 0.5);
  const mapping = await page.evaluate(() => window.lastEngraving.mappingStatus());
  if (coincident) {
    assert.ok(unisons.every(row => row.bindingStatus === 'unavailable'), 'Coincident same-staff unisons must not receive individual colors');
  }
  for (const row of unisons) {
    if (row.bindingStatus === 'bound') {
      assert.equal(coincident, false, 'Individual unison coloring needs distinct visible geometry');
      await expectBinding([row.sourceId], 1); await clearBinding();
    } else {
      assert.equal(row.bindingStatus, 'unavailable');
      assert.equal(mapping.status, 'partial');
      assert.ok(mapping.diagnostics.some(diagnostic => diagnostic.sourceNoteIds.includes(row.sourceId) &&
        diagnostic.xmlNoteIds.includes(row.xmlNoteId) && diagnostic.message), 'Unavailable unison names the exact canonical and XML note');
      const changed = await page.evaluate(sourceNoteId => {
        window.lastEngraving.setExpectedWrittenNotes({sourceNoteIds: [sourceNoteId], sourceMeasureIndex: 1});
        return window.__wmhBinding.changed().length;
      }, row.sourceId);
      assert.equal(changed, 0, 'Unverified identical voice glyph stays unchanged');
      await clearBinding();
    }
  }
  for (const id of ['other-staff-G4', 'other-part-G4']) {await expectBinding([id], 1); await clearBinding();}
  await expectBinding(['written-rest'], 1);
  assert.equal(rows.find(row => row.sourceId === 'written-rest').rest, true);
  await bindingEvidence('rests-identical-unisons', {rows, mapping, coincident});
  await clearBinding();
  const selected = await renderBinding(score, exported, {partIds: [exported.part_id_map['canonical/second part']]});
  assert.ok(selected.result.mapping.bindings.filter(entry => entry.sourceNoteId !== 'other-part-G4')
    .every(entry => entry.status === 'not-displayed'), 'Hidden part bindings are explicit');
  await expectBinding(['other-part-G4'], 1); await clearBinding();
});

test('split source notes and explicit tie endpoints follow source measure ordinals even with duplicate printed labels', options, async () => {
  const score = bindingScore(), exported = await exportScore(score);
  const split = exported.note_id_map.segments.filter(segment => segment.source_note_id === 'cross-bar-A4');
  assert.deepEqual(split.map(segment => segment.source_measure_index), [1, 2]);
  assert.deepEqual(split.map(segment => [segment.tie_start, segment.tie_stop]), [[true, false], [false, true]]);
  assert.ok(split.every(segment => segment.measure_number === 7));
  await renderBinding(score, exported);
  assert.ok((await geometry()).ties >= 2, 'Both cross-bar split and pre-existing explicit ties are real VexFlow curves');
  await expectBinding(['cross-bar-A4'], 1);
  await expectBinding(['cross-bar-A4'], 2); // The prior written segment clears, even though canonical ID stays the same.
  await expectBinding(['tie-start-D5'], 2);
  await expectBinding(['tie-stop-D5'], 2); // Never propagate a mark to a sounding/tie-chain peer.
  await expectBinding(['exact-third-F4'], 2); // WholeValue + exact thirds are exercised in the graph tuple.
  await clearBinding();
  await renderBinding(score, exported, {fromMeasure: 3, toMeasure: 3});
  await expectBinding(['cross-bar-A4'], 2);
  await bindingEvidence('split-note-source-ordinal', {split, status: await page.evaluate(() => window.lastEngraving.mappingStatus())});
  await clearBinding();
});

test('resize publishes fresh bindings and restores the configured light and dark base colors', options, async () => {
  const score = bindingScore(), exported = await exportScore(score);
  const evidence = [];
  for (const dark of [false, true]) {
    await page.setViewportSize({width: 1440, height: 1100});
    await renderBinding(score, exported, {dark});
    await expectBinding(['up-long-C4'], 0);
    const before = await page.evaluate(() => {
      const watch = window.__wmhBinding;
      watch.oldHeads = [...watch.groups.values()];
      return {events: watch.events.length, renders: watch.renderCalls};
    });
    await page.setViewportSize({width: 390, height: 844});
    await page.waitForFunction(events => window.__wmhBinding.events.length > events, before.events);
    const rebuilt = await page.evaluate(() => {
      const watch = window.__wmhBinding;
      const oldDisconnected = watch.oldHeads.every(node => !node.isConnected);
      // Clearing before the fresh baseline verifies there is no retained paint on
      // the replacement DOM, whether the helper replays selection automatically
      // or the onMappingChange consumer resends its current expected set.
      window.lastEngraving.clearExpectedWrittenNotes();
      return {oldDisconnected, rows: watch.reindex(), mapping: window.lastEngraving.mappingStatus(),
        callback: watch.events.at(-1), renders: watch.renderCalls};
    });
    assert.equal(rebuilt.oldDisconnected, true, 'Reflow may not retain detached head handles');
    assert.ok(bindingStatusIsUsable(rebuilt.mapping));
    assert.deepEqual(rebuilt.callback.status, rebuilt.mapping);
    assert.equal(rebuilt.callback.liveSvg, true);
    assert.ok(rebuilt.renders > before.renders, 'Width change really went through OSMD layout/render');
    await expectBinding(['up-short-D4'], 0);
    await clearBinding();
    const fills = await page.locator('#staff .vf-notehead path').evaluateAll(paths => paths.map(path => getComputedStyle(path).fill));
    assert.ok(fills.length > 0 && fills.every(fill => fill === (dark ? 'rgb(243, 245, 239)' : 'rgb(23, 37, 29)')), JSON.stringify(fills));
    evidence.push({dark, rebuilt, fills});
    await screenshot(`binding-resize-${dark ? 'dark' : 'light'}`);
  }
  await writeFile(join(artifacts, 'worldmusichub-binding-resize.json'), JSON.stringify(evidence, null, 2) + '\n');
});

test('replaced and disposed binding handles cannot recolor or resurrect the newer mount', options, async () => {
  const score = bindingScore(), exported = await exportScore(score);
  await renderBinding(score, exported);
  await expectBinding(['up-long-C4'], 0);
  await page.evaluate(() => {window.staleBinding = window.lastEngraving; window.staleBindingNodes = [...window.__wmhBinding.groups.values()];});
  const replacement = structuredClone(score);
  replacement.id += '-replacement'; replacement.title = 'Replacement binding mount';
  for (const note of replacement.parts[0].notes) if (note.pitch) note.pitch.octave++;
  const newExport = await exportScore(replacement);
  await renderBinding(replacement, newExport);
  const safe = await page.evaluate(() => {
    const watch = window.__wmhBinding;
    const renders = watch.renderCalls, oldDisconnected = window.staleBindingNodes.every(node => !node.isConnected);
    window.staleBinding.setExpectedWrittenNotes({sourceNoteIds: ['up-short-D4'], sourceMeasureIndex: 0});
    window.staleBinding.clearExpectedWrittenNotes(); window.staleBinding.dispose();
    return {oldDisconnected, changed: watch.changed().length, renders: watch.renderCalls - renders,
      currentMounted: [...watch.groups.values()].every(node => node.isConnected), title: document.querySelector('#staff').textContent};
  });
  assert.equal(safe.oldDisconnected, true); assert.equal(safe.changed, 0); assert.equal(safe.renders, 0);
  assert.equal(safe.currentMounted, true); assert.match(safe.title, /Replacement binding mount/);
  await expectBinding(['up-long-C4'], 0); await clearBinding();
  await page.evaluate(() => window.lastEngraving.dispose());
  await page.setViewportSize({width: 700, height: 900});
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  assert.equal(await page.locator('#staff svg').count(), 0);
});

test('missing, unknown-version and incomplete identity maps fail closed while the real staff remains usable', options, async () => {
  const score = bindingScore(), exported = await exportScore(score);
  await renderBinding(score, exported);
  const outcomes = await page.evaluate(async ({score, exported}) => {
    const maps = [undefined, {...exported.note_id_map, version: 987},
      {...exported.note_id_map, segments: exported.note_id_map.segments.slice(1)}];
    const outcomes = [];
    for (const noteMap of maps) {
      const rendered = await window.engraving.renderEngravedStaff(document.querySelector('#staff'), exported.xml, {
        identity: {score, noteMap, partIdMap: exported.part_id_map, voiceIdMap: exported.voice_id_map},
      });
      window.lastEngraving = rendered;
      const watch = window.__wmhBinding; watch.snapshot();
      const accepted = rendered.setExpectedWrittenNotes({sourceNoteIds: ['up-long-C4'], sourceMeasureIndex: 0});
      outcomes.push({accepted, status: rendered.status, mapping: rendered.mappingStatus(), changed: watch.changed().length,
        heads: document.querySelectorAll('#staff .vf-notehead').length});
      rendered.clearExpectedWrittenNotes();
    }
    return outcomes;
  }, {score, exported});
  for (const outcome of outcomes) {
    assert.equal(outcome.status, 'ready', 'Mapping metadata problems must not remove an otherwise valid engraving');
    assert.equal(bindingStatusIsUsable(outcome.mapping), false, JSON.stringify(outcome.mapping));
    assert.equal(outcome.mapping?.status, 'unavailable');
    assert.ok(outcome.mapping.diagnostics.some(diagnostic => diagnostic.code && diagnostic.message), 'Fail-closed mapping explains why');
    assert.equal(outcome.accepted, false); assert.equal(outcome.changed, 0); assert.ok(outcome.heads > 0);
  }
  await bindingEvidence('identity-map-fail-closed', outcomes);
});


test('invalid exact expected-note requests are rejected without changing mounted glyphs', options, async () => {
  const score = bindingScore(), exported = await exportScore(score);
  await renderBinding(score, exported);
  const outcomes = await page.evaluate(() => {
    const requests = [
      {sourceNoteIds: ['not-in-the-score'], sourceMeasureIndex: 0},
      {sourceNoteIds: ['up-long-C4', 'up-long-C4'], sourceMeasureIndex: 0},
      {sourceNoteIds: 'up-long-C4', sourceMeasureIndex: 0},
      {sourceNoteIds: ['up-long-C4'], sourceMeasureIndex: -1},
      {sourceNoteIds: ['up-long-C4'], sourceMeasureIndex: 0.5},
      {sourceNoteIds: ['up-long-C4'], sourceMeasureIndex: 99},
    ];
    return requests.map(request => ({accepted: window.lastEngraving.setExpectedWrittenNotes(request),
      changed: window.__wmhBinding.changed().length}));
  });
  assert.ok(outcomes.every(outcome => outcome.accepted === false && outcome.changed === 0), JSON.stringify(outcomes));
  await expectBinding(['up-long-C4'], 0);
  const emptied = await page.evaluate(() => ({accepted: window.lastEngraving.setExpectedWrittenNotes({sourceNoteIds: [], sourceMeasureIndex: 0}),
    changed: window.__wmhBinding.changed().length}));
  assert.deepEqual(emptied, {accepted: true, changed: 0}, 'An exact empty membership array clears the marker');
});
