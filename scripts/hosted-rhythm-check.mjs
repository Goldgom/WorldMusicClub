// Author/run only on an authorized hosted browser runner. This file is excluded
// from npm test and must never be used to bypass a local browser launch denial.
import assert from 'node:assert/strict';
import {spawn, execFileSync} from 'node:child_process';
import {createServer} from 'node:net';
import {createHash} from 'node:crypto';
import {mkdir, readFile, writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import path from 'node:path';

if (process.env.WMH_HOSTED_BROWSER !== '1' || process.env.GITHUB_ACTIONS !== 'true' || process.env.WMH_SOURCE_REF !== 'integration/rhythm-ui') {
  throw new Error('Requires the authorized GitHub Actions integration/rhythm-ui runner with WMH_HOSTED_BROWSER=1; local browser execution is not authorized.');
}
const root = fileURLToPath(new URL('../', import.meta.url));
const binary = path.resolve(root, process.env.WMH_SERVER_BINARY || `target/debug/practice-server${process.platform === 'win32' ? '.exe' : ''}`);
const output = path.resolve(root, process.env.WMH_ARTIFACT_DIR || 'test-results/rhythm-shell');
await mkdir(output, {recursive:true});
const cases = [
  {name:'desktop-zh-dark', width:1280, height:720, locale:'zh-CN', theme:'dark'},
  {name:'wide-zh-dark', width:1920, height:1080, locale:'zh-CN', theme:'dark'},
  {name:'landscape-zh-dark', width:844, height:390, locale:'zh-CN', theme:'dark'},
  {name:'landscape-en-light', width:844, height:390, locale:'en', theme:'light'},
  {name:'desktop-en-light', width:1280, height:720, locale:'en', theme:'light'},
  {name:'portrait-zh-dark', width:390, height:844, locale:'zh-CN', theme:'dark'},
];
const failures = [], results = [], sourceHashes = {};
const startedAt = new Date().toISOString();
let browser, server, serverOutput = '', provenance = null, status = 'running';
const report = () => writeFile(path.join(output, 'results.json'), JSON.stringify({
  status, startedAt, updatedAt:new Date().toISOString(), provenance, sourceHashes,
  browserVersion:browser?.version() ?? null, plannedCases:cases, results, failures,
  scope:'Actual Rust-backed app and browser recording/geometry. No physical MIDI, native shell, or acoustic latency measurement.',
}, null, 2) + '\n');
try {
  provenance = {
    checkoutCommit:execFileSync('git', ['rev-parse', 'HEAD'], {cwd:root,encoding:'utf8'}).trim(),
    sourceCommit:process.env.WMH_SOURCE_SHA ?? null, sourceRef:process.env.WMH_SOURCE_REF,
    workflowCommit:process.env.GITHUB_SHA ?? null, runUrl:process.env.WMH_RUN_URL ?? null,
  };
  assert.match(provenance.sourceCommit ?? '', /^[a-f0-9]{40}$/, 'A source commit is required');
  assert.equal(provenance.checkoutCommit, provenance.workflowCommit, 'Report must identify the exact checkout that built the server');
  for (const name of ['package.json','package-lock.json','.github/workflows/check.yml','scripts/hosted-rhythm-check.mjs','web/app.js','web/music.js','web/rhythm-shell.js','web/rhythm-shell.css','web/game-shell.js','web/index.html','web/i18n.js','web/locales/en.js','web/locales/zh-CN.js','web/locales/rhythm-en.js','web/locales/rhythm-zh-CN.js','web/locales/rhythm-schema.js']) {
    sourceHashes[name] = createHash('sha256').update(await readFile(path.join(root,name))).digest('hex');
  }
  provenance.serverBinarySha256 = createHash('sha256').update(await readFile(binary)).digest('hex');
  await report();
  const {chromium} = await import('playwright');
  const reservation = createServer();
  await new Promise((resolve, reject) => {reservation.once('error', reject); reservation.listen(0, '127.0.0.1', resolve);});
  const port = reservation.address().port;
  await new Promise((resolve, reject) => reservation.close(error => error ? reject(error) : resolve()));
  const origin = `http://127.0.0.1:${port}`;
  server = spawn(binary, ['--no-open', '--port', String(port)], {cwd:root, stdio:['ignore','pipe','pipe']});
  server.stdout.on('data', bytes => { serverOutput += bytes; });
  server.stderr.on('data', bytes => { serverOutput += bytes; });
  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(Error(`Server startup timeout: ${serverOutput}`)), 15000);
    server.once('error', error => { clearTimeout(timeout); reject(error); });
    server.once('exit', code => { clearTimeout(timeout); reject(Error(`Server exited ${code}: ${serverOutput}`)); });
    server.stdout.on('data', () => { if (serverOutput.includes(origin)) {clearTimeout(timeout); resolve();} });
  });
  browser = await chromium.launch({headless:true});
  for (const entry of cases) {
    const context = await browser.newContext({viewport:{width:entry.width,height:entry.height}, reducedMotion:'reduce', deviceScaleFactor:1});
    let page;
    const responses = [], caseFailuresBefore = failures.length;
    try {
      page = await context.newPage();
      page.setDefaultTimeout(15000);
      page.setDefaultNavigationTimeout(15000);
      page.on('pageerror', error => failures.push({case:entry.name,error:error.message}));
      page.on('response', response => {if (response.url().includes('/api/')) responses.push({path:new URL(response.url()).pathname,status:response.status()});});
      await page.addInitScript(({locale,theme}) => {
        localStorage.setItem('worldmusichub.locale.v1', locale);
        localStorage.setItem('worldmusichub.theme', JSON.stringify({mode:theme}));
      }, entry);
      await page.goto(origin); await page.evaluate(() => document.fonts.ready);
      await page.waitForFunction(() => !document.querySelector('#start-listen').disabled);
      assert.equal(await page.locator('html').getAttribute('lang'), entry.locale);
      assert.equal(await page.locator('.rhythm-shell').count(), 1);
      assert.equal(await page.locator('html').getAttribute('data-theme'), entry.theme);
      await page.screenshot({path:path.join(output, `${entry.name}-library.png`), fullPage:true});
      // Use the actual free sound control to mute before starting real playback.
      await page.locator('#start-free-practice').click();
      await page.locator('#free-sound').click(); await page.locator('#free-exit').click();
      await page.locator('#start-listen').click();
      await page.waitForFunction(() => document.body.dataset.screen === 'stage' && document.querySelector('#progress').value > 0);
      await page.locator('#play-button').click();
      const geometry = await page.evaluate(() => {
        const box = selector => {const rect=document.querySelector(selector).getBoundingClientRect();return {x:rect.x,y:rect.y,right:rect.right,bottom:rect.bottom,width:rect.width,height:rect.height};};
        return {documentWidth:document.documentElement.scrollWidth,falling:box('#falling-notes'),transport:box('.transport'),hud:box('.stage-hud')};
      });
      assert.ok(geometry.documentWidth <= entry.width + 1, `${entry.name}: horizontal overflow`);
      assert.ok(geometry.falling.height >= 100, `${entry.name}: falling canvas is too short`);
      assert.ok(geometry.transport.y >= 0 && geometry.transport.bottom <= entry.height + 1, `${entry.name}: transport outside viewport`);
      await page.screenshot({path:path.join(output, `${entry.name}-piano.png`), fullPage:true});
      await page.locator('#notation-toggle').click();
      await page.locator('#engraved-button').click();
      await page.waitForFunction(() => document.querySelector('#engraved-staff svg .vf-notehead path'));
      assert.equal(await page.locator('#engraving-fallback').isVisible(), false);
      await page.screenshot({path:path.join(output, `${entry.name}-staff.png`), fullPage:true});
      await page.locator('#jianpu-button').click();
      await page.waitForFunction(() => document.querySelector('#notation .score-note') && document.querySelector('#written-cursor-status').dataset.status === 'ready');
      assert.equal(await page.locator('#engraving-follow').isChecked(), true);
      await page.screenshot({path:path.join(output, `${entry.name}-jianpu.png`), fullPage:true});
      await page.locator('#notation-toggle').click();
      await page.locator('#settings-button').click();
      await page.locator('#instrument').selectOption('guitar');
      await page.locator('#settings-dialog [data-close-panel]').click();
      await page.waitForFunction(() => !document.querySelector('#guitar-stage').hidden && document.querySelectorAll('.fret-button').length === 78);
      const fret = await page.evaluate(() => {
        const board=document.querySelector('.guitar-scroll').getBoundingClientRect(), first=document.querySelector('.fret-button').getBoundingClientRect();
        return {boardTop:board.top,boardBottom:board.bottom,firstTop:first.top,firstBottom:first.bottom};
      });
      assert.ok(fret.firstTop >= fret.boardTop - 1 && fret.firstBottom <= fret.boardBottom + 1, `${entry.name}: incomplete first fret row`);
      await page.screenshot({path:path.join(output, `${entry.name}-guitar.png`), fullPage:true});
      const title = await page.locator('#score-title').textContent();
      await page.locator('#rhythm-stage-free').click();
      await page.locator('#free-start').click();
      await page.locator('#free-practice-title').focus();
      await page.keyboard.press('r'); await page.keyboard.press('t');
      await page.locator('#free-stop').click();
      await page.locator('#free-record-label').fill('节奏练习 / rhythm session');
      await page.locator('#free-save').click();
      await page.waitForFunction(() => !document.querySelector('#free-start').disabled);
      const downloadPromise = page.waitForEvent('download');
      await page.locator('#free-export-record').click();
      const download = await downloadPromise;
      assert.equal(await download.failure(), null);
      const record = JSON.parse(await readFile(await download.path(), 'utf8'));
      assert.equal(record.observations.events.filter(event => event.kind === 'note_on').length, 2);
      await page.screenshot({path:path.join(output, `${entry.name}-free.png`), fullPage:true});
      await page.locator('#rhythm-free-resume').click();
      assert.equal(await page.locator('body').getAttribute('data-screen'), 'stage');
      assert.equal(await page.locator('#score-title').textContent(), title);
      await page.locator('#back-to-library').click(); await page.locator('#resume-session').click();
      assert.equal(await page.locator('#score-title').textContent(), title);
      assert.ok(responses.some(response => response.path === '/api/compile' && response.status === 200), 'Real Rust compilation response required');
      assert.deepEqual(responses.filter(response => response.status >= 400), [], 'Real engine responses must succeed');
      results.push({...entry,status:failures.length === caseFailuresBefore ? 'passed' : 'failed',geometry,fret,recordedOnsets:2,responses});
    } catch (error) {
      failures.push({case:entry.name,error:error.stack ?? error.message});
      results.push({...entry,status:'failed',responses});
      if (page) await page.screenshot({path:path.join(output, `${entry.name}-failure.png`), fullPage:true}).catch(screenshotError => failures.push({case:entry.name,error:`Failure screenshot: ${screenshotError.message}`}));
    } finally { await context.close(); await report(); }
  }
  status = failures.length ? 'failed' : 'passed';
} catch (error) {
  status = 'failed'; failures.push({case:'bootstrap',error:error.stack ?? error.message});
} finally {
  await browser?.close().catch(error => {status = 'failed'; failures.push({case:'cleanup',error:error.message});});
  server?.kill('SIGTERM');
  await writeFile(path.join(output, 'server.log'), serverOutput);
  await report();
}
if (status === 'passed') process.stdout.write(`Hosted rhythm checks passed: ${output}\n`);
else { process.stderr.write(`Hosted rhythm checks failed: ${output}\n`); process.exitCode = 1; }
