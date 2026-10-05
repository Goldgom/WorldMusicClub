import {installPlaybackClockReader, waitForPlaybackClock} from '../tests/browser-playback-clock.js';
// Author/run only on an authorized hosted browser runner. This file is excluded
// from npm test and must never be used to bypass a local browser launch denial.
import assert from 'node:assert/strict';
import {spawn, execFileSync} from 'node:child_process';
import {createServer} from 'node:net';
import {createHash} from 'node:crypto';
import {mkdir, readFile, writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import path from 'node:path';

if (process.env.WMH_HOSTED_BROWSER !== '1' || process.env.GITHUB_ACTIONS !== 'true' || !(['integration/rhythm-ui', 'dev/initial-prototype', 'main'].includes(process.env.WMH_SOURCE_REF) || /^validation\/.+/.test(process.env.WMH_SOURCE_REF || ''))) {
  throw new Error('Requires an authorized GitHub Actions WorldMusicClub source runner with WMH_HOSTED_BROWSER=1; local browser execution is not authorized.');
}
const root = fileURLToPath(new URL('../', import.meta.url));
const binary = path.resolve(root, process.env.WMH_SERVER_BINARY || `target/debug/practice-server${process.platform === 'win32' ? '.exe' : ''}`);
const output = path.resolve(root, process.env.WMH_ARTIFACT_DIR || 'test-results/rhythm-shell');
await mkdir(output, {recursive:true});
const cases = [
  {name:'desktop-zh-dark', width:1280, height:720, locale:'zh-CN', theme:'dark'},
  {name:'wide-zh-dark', width:1920, height:1080, locale:'zh-CN', theme:'dark'},
  {name:'landscape-zh-dark', width:844, height:390, locale:'zh-CN', theme:'dark'},
  {name:'reference-landscape-zh-dark', width:1033, height:403, locale:'zh-CN', theme:'dark'},
  {name:'landscape-en-light', width:844, height:390, locale:'en', theme:'light'},
  {name:'desktop-en-light', width:1280, height:720, locale:'en', theme:'light'},
  {name:'portrait-zh-dark', width:390, height:844, locale:'zh-CN', theme:'dark'},
];
const failures = [], results = [], sourceHashes = {};
const startedAt = new Date().toISOString();
let browser, server, serverOutput = '', provenance = null, status = 'running';
async function scoreControls(page) {
  if(await page.locator('#notation-toggle').getAttribute('aria-expanded')!=='true')await page.locator('#notation-toggle').click();
  if(await page.locator('#notation-tools').isVisible()&&!await page.locator('#notation-tools').evaluate(node=>node.open))await page.locator('#notation-tools>summary').click();
}
async function closeScoreControls(page) {
  if(await page.locator('#notation-tools').isVisible()&&await page.locator('#notation-tools').evaluate(node=>node.open))await page.locator('#notation-tools>summary').click();
}
async function checkLaneOverlay(page, entry, view) {
  await closeScoreControls(page);
  await page.waitForFunction(() => document.querySelector('#workspace').classList.contains('notation-on-lanes')&&!document.querySelector('#notation-lane-overlay').hidden);
  const geometry = await page.evaluate(() => {
    const box = selector => {const node=document.querySelector(selector),r=node.getBoundingClientRect();return {x:r.x,y:r.y,right:r.right,bottom:r.bottom,width:r.width,height:r.height,clientHeight:node.clientHeight,scrollHeight:node.scrollHeight};};
    const overlay=document.querySelector('#notation-lane-overlay'),canvas=document.querySelector('#falling-notes'),r=overlay.getBoundingClientRect(),hit=document.elementFromPoint(Math.min(innerWidth-1,r.x+r.width/2),r.y+r.height/2);
    return {above:document.querySelector('#workspace').classList.contains('notation-above'),overlay:box('#notation-lane-overlay'),overlayInLane:overlay.parentElement===canvas.parentElement,
      overlayStyle:{pointer:getComputedStyle(overlay).pointerEvents,background:getComputedStyle(overlay).backgroundColor,z:Number(getComputedStyle(overlay).zIndex),canvasZ:Number(getComputedStyle(canvas).zIndex)},intercepted:Boolean(hit&&overlay.contains(hit)),interactivePaint:overlay.querySelectorAll('button,input,select,textarea').length,
      range:[...document.querySelectorAll('#keyboard .piano-key')].map(node=>Number(node.dataset.midi)),document:{width:document.documentElement.scrollWidth,height:document.documentElement.scrollHeight},
      play:box('.play-panel'),canvas:box('#falling-notes'),strike:box('.strike-line'),keyboard:box('#keyboard'),transport:box('.transport'),stage:box('#workspace')};
  });
  await writeFile(path.join(output,`${entry.name}-${view}-notation-geometry.json`),JSON.stringify(geometry,null,2)+'\n');
  assert.equal(geometry.above,false);assert.equal(geometry.overlayInLane,true,`${entry.name}: original score paint is inside the falling lane`);
  assert.ok(Math.min(geometry.overlay.right,geometry.canvas.right)-Math.max(geometry.overlay.x,geometry.canvas.x)>=250&&Math.min(geometry.overlay.bottom,geometry.canvas.bottom)-Math.max(geometry.overlay.y,geometry.canvas.y)>=100,'Score physically intersects the lane background');
  assert.equal(geometry.overlayStyle.pointer,'none');assert.equal(geometry.overlayStyle.background,'rgba(0, 0, 0, 0)');assert.ok(geometry.overlayStyle.z<geometry.overlayStyle.canvasZ);assert.equal(geometry.intercepted,false);assert.equal(geometry.interactivePaint,0);
  assert.ok(geometry.canvas.height>=100,'The musical field keeps its original readable minimum');
  if(entry.width>=1280&&entry.height>=720)assert.ok(geometry.overlay.height>=240,'The desktop score retains its readable paint area inside the lane');
  assert.ok(geometry.keyboard.height>=(entry.height<=600?70:100),'The complete keybed remains reserved');
  assert.ok(geometry.transport.y>=0&&geometry.transport.bottom<=entry.height+1&&geometry.stage.scrollHeight<=geometry.stage.clientHeight+1,'Transport stays anchored inside the viewport');
  assert.ok(geometry.document.width<=entry.width+1&&geometry.document.height<=entry.height+1,'The performance stays bounded');
  for(const surface of [geometry.strike,geometry.keyboard])assert.ok(Math.abs(surface.x-geometry.canvas.x)<1&&Math.abs(surface.width-geometry.canvas.width)<1,'Notes, strike line and keys stay aligned');
  assert.ok(Math.abs(geometry.canvas.bottom-geometry.strike.y)<1&&Math.abs(geometry.strike.bottom-geometry.keyboard.y)<1);
  return geometry;
}
async function checkCompactHeader(page, entry, view) {
  if (entry.height > 600 || entry.width <= 650) return null;
  const inspect = () => page.evaluate(() => {
    const title=document.querySelector('#stage-title'), guide=document.querySelector('#beginner-controls');
    const toggle=document.querySelector('#beginner-enabled'), label=toggle.closest('label'), help=guide.querySelector('summary');
    const rect=node=>{const r=node.getBoundingClientRect();return{x:r.x,y:r.y,right:r.right,bottom:r.bottom,width:r.width,height:r.height};};
    const hit=node=>{const r=node.getBoundingClientRect(),top=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2);return {reachable:Boolean(top && (top===node || node.contains(top))),hitId:top?.id,hitTag:top?.tagName};};
    return {title:rect(title),guide:rect(guide),toggle:rect(toggle),help:rect(help),
      titleHit:hit(title),labelHit:hit(label),toggleHit:hit(toggle),helpHit:hit(help),
      compact:guide.classList.contains('beginner-controls-compact'),documentWidth:document.documentElement.scrollWidth};
  });
  const assertBounds = state => {
    assert.equal(state.compact, true);
    assert.ok(state.title.width >= 63 && state.title.height >= 20, `${entry.name}: title has no useful hit area`);
    assert.ok(state.title.right <= state.guide.x - 1, `${entry.name}: beginner controls overlap the title`);
    assert.ok(state.toggle.width >= 18 && state.toggle.height >= 18, `${entry.name}: checkbox shrank`);
    assert.ok(state.help.width >= 20 && state.help.height >= 20, `${entry.name}: help target shrank`);
    for (const name of ['titleHit','labelHit','toggleHit','helpHit']) assert.equal(state[name].reachable, true, `${entry.name}: ${name} is intercepted (${state[name].hitId || state[name].hitTag})`);
    assert.ok(state.documentWidth <= entry.width + 1, `${entry.name}: compact heading causes horizontal overflow`);
  };
  const before=await inspect();
  await writeFile(path.join(output, `${entry.name}-${view}-header-geometry.json`), JSON.stringify({before},null,2)+'\n');
  assertBounds(before);
  await page.locator('#stage-title').click();
  assert.equal(await page.evaluate(() => document.activeElement?.id), 'stage-title');
  assert.equal(await page.locator('#beginner-enabled').isChecked(), false, 'Title click must not toggle the guide');
  await page.keyboard.down('r');
  try {await page.waitForFunction(() => document.querySelector('#keyboard-map [data-code="KeyR"]').classList.contains('held'));}
  finally {await page.keyboard.up('r');}
  await page.waitForFunction(() => !document.querySelector('#keyboard-map [data-code="KeyR"]').classList.contains('held'));
  await page.locator('#beginner-controls .beginner-toggle-label').click();
  assert.equal(await page.locator('#beginner-enabled').isChecked(), true, 'The full guide label remains clickable');
  const enabled=await inspect();
  await writeFile(path.join(output, `${entry.name}-${view}-header-geometry.json`), JSON.stringify({before,enabled},null,2)+'\n');
  assertBounds(enabled);
  await page.locator('#beginner-controls summary').click();
  assert.equal(await page.locator('#beginner-controls details').evaluate(node=>node.open), true);
  await page.locator('#beginner-controls summary').click();
  assert.equal(await page.locator('#beginner-controls details').evaluate(node=>node.open), false);
  await page.locator('#beginner-enabled').focus(); await page.keyboard.press('Space');
  assert.equal(await page.locator('#beginner-enabled').isChecked(), false, 'Native checkbox keyboard activation stays available');
  await page.locator('#stage-title').click();
  assert.equal(await page.evaluate(() => document.activeElement?.id), 'stage-title');
  await page.screenshot({path:path.join(output, `${entry.name}-${view}-header-hit-targets.png`), fullPage:true});
  return {before,enabled,normalTitleClick:true,keyboardInput:true,labelClick:true,helpClick:true,checkboxKeyboard:true};
}
async function checkReducedMotionPause(page, entry) {
  await page.waitForFunction(() => document.querySelector('#stage-cue').dataset.cueState === 'paused');
  const expected=await page.evaluate(async () => {
    const {getAppI18n}=await import('/app-locale.js');
    return {paused:getAppI18n(document).t('app.paused'),motion:getAppI18n(document).t('app.reducedMotion')};
  });
  assert.equal(await page.locator('.play-panel').getAttribute('data-instrument'), 'piano');
  assert.equal(await page.evaluate(() => matchMedia('(prefers-reduced-motion: reduce)').matches), true);
  assert.equal(await page.locator('#stage-cue').evaluate(node=>node.hidden), false, 'The controller retains the paused state; presentation alone removes the duplicate');
  assert.equal(await page.locator('#stage-cue').isVisible(), false, 'Reduced-motion piano has only one visible central explanation');
  assert.equal(await page.locator('#transport-status').textContent(), expected.paused);
  assert.equal(await page.locator('#transport-status').isVisible(), true);
  assert.equal(await page.locator('#play-button').isVisible(), true);
  assert.equal(await page.locator('#play-button').isEnabled(), true);
  const playName=(await page.locator('#play-button').textContent()).trim();
  assert.ok(playName.length > 0);
  assert.equal(await page.getByRole('button',{name:playName,exact:true}).count(), 1, 'Resume retains its accessible button name');
  assert.equal(await page.locator('#transport-status').evaluate(node=>Boolean(node.closest('[aria-hidden="true"],[inert]'))), false);
  try {
    await page.emulateMedia({reducedMotion:'no-preference'});
    assert.equal(await page.locator('#stage-cue').isVisible(), true, 'Ordinary motion retains the paused overlay');
  } finally {await page.emulateMedia({reducedMotion:'reduce'});}
  assert.equal(await page.locator('#stage-cue').isVisible(), false);
  assert.equal(await page.locator('#transport-status').textContent(), expected.paused);
  await page.screenshot({path:path.join(output, `${entry.name}-reduced-motion-paused.png`), fullPage:true});
  return {cueState:'paused',reducedPianoCueVisible:false,ordinaryMotionCueVisible:true,transportStatus:expected.paused,playName,canvasExplanation:expected.motion};
}
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
  for (const name of ['package.json','package-lock.json','.github/workflows/rhythm-interaction-preview.yml','.github/workflows/check.yml','.github/workflows/windows-release.yml','scripts/hosted-rhythm-check.mjs','web/app.js','web/style.css','web/music.js','web/performance-view.js','web/stage-notation-layout.js','web/piano-stage-view.js','web/piano-stage.css','web/rhythm-shell.js','web/rhythm-shell.css','web/game-shell.js','web/index.html','web/i18n.js','web/locales/en.js','web/locales/zh-CN.js','web/locales/rhythm-en.js','web/locales/rhythm-zh-CN.js','web/locales/rhythm-schema.js']) {
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
      await installPlaybackClockReader(page);
      page.setDefaultTimeout(15000);
      page.setDefaultNavigationTimeout(15000);
      page.on('pageerror', error => failures.push({case:entry.name,error:error.message}));
      page.on('response', response => {if (response.url().includes('/api/')) responses.push({path:new URL(response.url()).pathname,status:response.status()});});
      await page.addInitScript(({locale,theme}) => {
        localStorage.setItem('worldmusichub.locale.v1', locale);
        localStorage.setItem('worldmusichub.theme', JSON.stringify({mode:theme}));
      }, entry);
      await page.goto(origin);await waitForPlaybackClock(page); await page.evaluate(() => document.fonts.ready);
      if (await page.locator('#game-home').isVisible()) await page.locator('#home-single-player').click();
      await page.waitForFunction(() => !document.querySelector('#start-listen').disabled);
      assert.equal(await page.locator('html').getAttribute('lang'), entry.locale);
      assert.equal(await page.locator('.rhythm-shell').count(), 1);
      assert.equal(await page.locator('html').getAttribute('data-theme'), entry.theme);
      await page.screenshot({path:path.join(output, `${entry.name}-library.png`), fullPage:true});
      // Use the actual free sound control to mute before starting real playback.
      if (!await page.locator('#start-free-practice').isVisible() && await page.locator('#lobby-home').isVisible()) await page.locator('#lobby-home').click();
      await page.locator('#start-free-practice').click();
      await page.locator('#free-sound').click(); await page.locator('#free-exit').click();
      if (await page.locator('#game-home').isVisible()) await page.locator('#home-single-player').click();
      await page.locator('#start-listen').click();
      await page.waitForFunction(() => document.body.dataset.screen === 'stage' && globalThis.__wmhReadPlaybackClock().positionMs > 0);
      if (entry.width >= 1280 && entry.height >= 720) assert.equal(await page.locator('#notation-lane-overlay').isVisible(),true,'The first desktop piano entry shows its background score without an extra toggle');
      // Exercise the real hover layer before Pause, including its portrait
      // overlap. Informational help must never own this transport pointer hit.
      await page.locator('#progress').hover();
      await page.waitForFunction(() => Number(getComputedStyle(document.getElementById('progress-help')).opacity) === 1);
      const seekHelp = await page.evaluate(() => {
        const help=document.getElementById('progress-help'),range=document.getElementById('progress'),play=document.getElementById('play-button'),r=play.getBoundingClientRect(),h=help.getBoundingClientRect();
        const x=r.x+r.width/2,y=r.y+r.height/2,hit=document.elementFromPoint(x,y);
        return {visible:Number(getComputedStyle(help).opacity)===1,pointerEvents:getComputedStyle(help).pointerEvents,guidance:help.textContent,describedBy:range.getAttribute('aria-describedby'),coversPausePoint:x>=h.x&&x<=h.right&&y>=h.y&&y<=h.bottom,pauseReceivesHit:hit===play||play.contains(hit),hitId:hit?.id||null};
      });
      assert.equal(seekHelp.visible,true);assert.ok(seekHelp.guidance.trim()&&seekHelp.describedBy?.split(/\s+/).includes('progress-help'),'Seek help remains available to assistive reading');
      assert.equal(seekHelp.pauseReceivesHit,true,`Visible seek guidance blocks Pause: ${JSON.stringify(seekHelp)}`);
      await page.locator('#play-button').click();
      const reducedMotionPause = await checkReducedMotionPause(page, entry);
      const compactHeader = await checkCompactHeader(page, entry, 'piano');
      const geometry = await page.evaluate(() => {
        const box = selector => {const rect=document.querySelector(selector).getBoundingClientRect();return {x:rect.x,y:rect.y,right:rect.right,bottom:rect.bottom,width:rect.width,height:rect.height};};
        return {documentWidth:document.documentElement.scrollWidth,falling:box('#falling-notes'),transport:box('.transport'),hud:box('.stage-hud')};
      });
      assert.ok(geometry.documentWidth <= entry.width + 1, `${entry.name}: horizontal overflow`);
      assert.ok(geometry.falling.height >= 100, `${entry.name}: falling canvas is too short`);
      assert.ok(geometry.transport.y >= 0 && geometry.transport.bottom <= entry.height + 1, `${entry.name}: transport outside viewport`);
      await page.screenshot({path:path.join(output, `${entry.name}-piano.png`), fullPage:true});
      await scoreControls(page);
      await page.locator('#engraved-button').click();
      await page.waitForFunction(() => document.querySelector('#engraved-staff svg .vf-notehead path'));
      assert.equal(await page.locator('#engraving-fallback').isVisible(), false);
      await closeScoreControls(page);
      const notationHeader = await checkCompactHeader(page, entry, 'staff');
      const staffGeometry = await checkLaneOverlay(page, entry, 'staff');
      await page.screenshot({path:path.join(output, `${entry.name}-staff.png`), fullPage:true});
      await scoreControls(page);await page.locator('#jianpu-button').click();
      await page.waitForFunction(() => document.querySelector('#notation .score-note') && document.querySelector('#written-cursor-status').dataset.status === 'ready');
      assert.equal(await page.locator('#engraving-follow').isChecked(), true);
      const jianpuGeometry = await checkLaneOverlay(page, entry, 'jianpu');assert.deepEqual(jianpuGeometry.range,staffGeometry.range,'Changing notation preserves every configured key');
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
      assert.equal(await page.locator('#stage-cue').isVisible(), true, 'Reduced motion keeps the guitar cue visible');
      const title = await page.locator('#score-title').textContent();
      await page.locator('#rhythm-stage-free').click();
      await page.locator('#free-start').click();
      await page.locator('#free-practice-title').focus();
      await page.keyboard.press('r'); await page.keyboard.press('t');
      await page.locator('#free-stop').click();
      if(!await page.locator('#free-recordings').evaluate(node=>node.open))await page.locator('#free-recordings-toggle').click();
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
      await page.locator('#reset-button').click();
      await page.waitForFunction(() => document.querySelector('#stage-cue').dataset.cueState === 'ready');
      await page.locator('#settings-button').click();
      await page.locator('#instrument').selectOption('piano');
      await page.locator('#settings-dialog [data-close-panel]').click();
      await page.waitForFunction(() => !document.querySelector('#piano-stage').hidden && document.querySelector('#stage-cue').dataset.cueState === 'ready');
      assert.equal(await page.locator('#stage-cue').isVisible(), true, 'Ready piano is not suppressed by the paused-only rule');
      results.push({...entry,status:failures.length === caseFailuresBefore ? 'passed' : 'failed',seekHelp,compactHeader,notationHeader,staffGeometry,jianpuGeometry,reducedMotionPause,readyPianoCueVisible:true,guitarCueVisible:true,geometry,fret,recordedOnsets:2,responses});
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
