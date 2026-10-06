import {configureSongMod} from './hosted-song-mod-controls.mjs';
// Standalone focused hosted regression. Do not run to bypass a local launch
// denial. The unmodified Rust executable serves assets and assesses real inputs.
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {setTimeout as delay} from 'node:timers/promises';
import {startHostedAssetServer,validateHostedAssetEvidence,boundedHostedResponse} from './hosted-worklet-assets.mjs';
import {finishDenseReport} from './dense-report-cleanup.mjs';
import {installPlaybackClockReader,waitForPlaybackClock} from '../tests/browser-playback-clock.js';
import {STALLED_KEYS,originalStalledKeyboardScore,installStalledKeyboardObserver,validateStalledKeyboardEvidence} from './stalled-keyboard-evidence.mjs';

if(process.env.GITHUB_ACTIONS!=='true'||process.env.WMH_HOSTED_BROWSER!=='1')throw Error('Stalled keyboard checks require the authorized hosted Actions runner.');
const root=fileURLToPath(new URL('../',import.meta.url));
const git=(...args)=>execFileSync('git',args,{cwd:root,encoding:'utf8'}).trim();
const sourceSha=git('rev-parse','HEAD');assert.equal(process.env.WMH_SOURCE_SHA,sourceSha);assert.equal(git('status','--porcelain','--untracked-files=normal'),'','Hosted source must be clean');
const output=resolve(process.env.WMH_ARTIFACT_DIR||join(root,'test-results/stalled-keyboard'));
await mkdir(output,{recursive:true});const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
const report={version:1,kind:'original-hosted-stalled-keyboard',input_driver:'playwright-chromium-cdp',source_sha:sourceSha,source_tree:git('rev-parse','HEAD^{tree}'),originalFixture:true,fixture:originalStalledKeyboardScore(),asset_server:{},assets:[],assessments:[],commands:[],pageErrors:[],ok:false,
  claims:{trusted_browser_input:true,physical_keyboard:false,physical_audio:false,synthetic_dom_input:false,timestamp_override:false,clock_override:false,injected_main_thread_block:true,production_source_changed:false}};
let assetServer,browser,context,page,observerInstalled=false;
const commandTasks=[],responseTasks=[];
const control=(id)=>page.locator(`#${id}`);
async function closePanels(){for(const panel of ['settings','results','score-tools','import-tools']){const dialog=control(`${panel}-dialog`);if(await dialog.isVisible())await dialog.locator('[data-close-panel]').click();}}
async function exportTake(filename){if(!await control('results-dialog').isVisible())await control('results-button').click();const waiting=page.waitForEvent('download');await control('export-takes').click();const download=await waiting;assert.equal(await download.failure(),null);const path=join(output,filename);await download.saveAs(path);const data=JSON.parse(await readFile(path,'utf8'));await closePanels();return data;}
async function waitCompletedRevision(revision){await page.waitForFunction(revision=>{const rows=globalThis.__wmhStalledKeyboard.snapshot().recorder;return rows.some(row=>row.method==='complete'&&row.job.revision===revision)&&!document.getElementById('play-button').disabled;},revision,{timeout:15000});}
try{
  assetServer=await startHostedAssetServer({root,sourceSha,binary:resolve(root,process.env.WMH_SERVER_BINARY||'target/debug/practice-server'),evidence:report.asset_server});report.origin=assetServer.origin;
  // Bind all scored-input implementation bytes served by the real executable,
  // in addition to the shared helper's checked Worklet import closure.
  for(const name of ['app.js','song-mod.js','song-mod-view.js','part-instrument-policy.js','skin-format.js','skin-runtime.js','skin-settings.js','skin-storage.js','skin-settings.css','keyboard-input.js','midi-messages.js','practice-recorder.js','input-evidence.js','transport.js']){
    const expected=await readFile(join(root,'web',name));const response=await fetch(`${report.origin}/${name}`,{redirect:'error',signal:AbortSignal.timeout(10000)});assert.equal(response.status,200);const bytes=await boundedHostedResponse(response);assert.equal(digest(bytes),digest(expected));report.assets.push({name,bytes:bytes.length,sha256:digest(bytes),status:200});
  }
  const {chromium}=await import('playwright');browser=await chromium.launch({headless:true});report.browser_version=browser.version();context=await browser.newContext({viewport:{width:1280,height:900},acceptDownloads:true});page=await context.newPage();page.setDefaultTimeout(15000);
  await installPlaybackClockReader(page);
  page.on('pageerror',error=>report.pageErrors.push(String(error.stack||error)));
  // Observe actual network responses. No routes or assessment stubs are used.
  page.on('response',response=>{
    if(new URL(response.url()).pathname!=='/api/assess')return;
    const row={status:response.status(),request:response.request().postDataJSON()};report.assessments.push(row);
    responseTasks.push(response.json().then(value=>{row.response=value;}).catch(error=>{report.pageErrors.push(String(error));}));
  });
  await page.exposeBinding('__wmhStallStarted',({page:owner},block)=>{
    assert.equal(owner,page);const key=STALLED_KEYS.find(row=>row.id===block.id);assert.ok(key);assert.ok(report.commands.length<4);
    // Do not await keydown before issuing keyup: its acknowledgment can wait
    // until the renderer finishes blocking. Neither call supplies a timestamp.
    for(const[type,offset]of [['down',300],['up',400]]){
      const row={blockId:block.id,type,key:key.key,delayAfterNotificationMs:offset,notificationHostNs:process.hrtime.bigint().toString()};report.commands.push(row);
      commandTasks.push(delay(offset).then(async()=>{row.sentHostNs=process.hrtime.bigint().toString();await page.keyboard[type](key.key);row.completedHostNs=process.hrtime.bigint().toString();}).catch(error=>{row.error=String(error);report.pageErrors.push(String(error));}));
    }
  });
  await page.goto(report.origin);await waitForPlaybackClock(page);await control('home-single-player').click();
  await control('score-file').setInputFiles({name:'original-stalled-keyboard.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(report.fixture))});
  await page.waitForFunction(title=>document.getElementById('score-title').textContent===title&&!document.getElementById('play-button').disabled,report.fixture.title);
  await closePanels();if(await control('song-lobby').isVisible())await control('resume-session').click();
  await configureSongMod(page,{origin:'stage',restore:true,performers:'all',layout:'solo',showOtherParts:true});
  await control('settings-button').click();assert.equal(await control('latency-offset').inputValue(),'0');
  // Performance controls reparent count-in into the settings dialog. Exercise
  // it while that real panel is open, before returning to stage controls.
  assert.equal(await control('count-in').isVisible(),true);await control('count-in').uncheck();await closePanels();
  if(await control('sound-button').getAttribute('aria-pressed')!=='true')await control('sound-button').click();
  if(await control('notation-toggle').getAttribute('aria-expanded')==='true')await control('notation-toggle').click();
  await page.evaluate(installStalledKeyboardObserver);observerInstalled=true;await control('play-button:not([disabled])').waitFor();
  await control('play-button').click();await page.waitForFunction(()=>globalThis.__wmhReadPlaybackClock().running);
  // Make a real completed provisional assessment of this active pass, then
  // resume it normally. This creates a genuine paused clock segment gap.
  await control('results-button').click();await control('assess-button').click();await control('feedback-results').waitFor({state:'visible'});await waitCompletedRevision(0);
  report.baseline=await exportTake('provisional-take.json');assert.equal(report.baseline.passes.length,1);assert.equal(report.baseline.passes[0].inputs.length,0);assert.equal(report.baseline.passes[0].clock_segments[0].wallEnd!==null,true);
  assert.ok(report.baseline.passes[0].clock_segments[0].wallEnd-report.baseline.passes[0].clock_segments[0].wallStart<1200,'Setup consumed the first target window');
  await control('stage-title').focus();await control('play-button').click();await control('stage-title').focus();
  const resumed=await page.evaluate(()=>globalThis.__wmhStalledKeyboard.snapshot().recorder.findLast(row=>row.method==='resume'));
  assert.ok(resumed);const segment=resumed.after.segments.at(-1);report.resumedSegment=segment;
  await page.evaluate(({keys,segment})=>globalThis.__wmhStalledKeyboard.arm(keys.map(key=>({id:key.id,wall:segment.wallStart+key.targetMs-300-segment.positionStart}))),{keys:STALLED_KEYS,segment});
  await page.waitForFunction(()=>{const trace=globalThis.__wmhStalledKeyboard.snapshot();if(trace.errors.length)throw Error(trace.errors.join('; '));return trace.blocks.length===2&&trace.inputs.length===4&&trace.recorder.some(row=>row.method==='complete'&&row.job.revision===2);},null,{timeout:15000,polling:50});
  await Promise.all(commandTasks);await waitCompletedRevision(2);await Promise.all(responseTasks);
  report.take=await exportTake('corrected-take.json');await page.screenshot({path:join(output,'corrected-practice.png'),fullPage:true});
  report.trace=await page.evaluate(()=>{const value=__wmhStalledKeyboard.stop();delete globalThis.__wmhStalledKeyboard;return value;});observerInstalled=false;
  assert.equal(report.commands.length,4);assert.ok(report.commands.every(row=>row.completedHostNs&&!row.error));report.ok=true;
}catch(error){report.error=String(error.stack||error);process.exitCode=1;if(page)try{await page.screenshot({path:join(output,'failure.png'),fullPage:true,timeout:5000});}catch{}}
finally{
  if(observerInstalled)try{report.trace=await page.evaluate(()=>{const value=__wmhStalledKeyboard.stop();delete globalThis.__wmhStalledKeyboard;return value;});}catch(error){report.pageErrors.push(String(error));}
  await Promise.allSettled([...commandTasks,...responseTasks]);
  await finishDenseReport(report,{resources:[['context',context],['browser',browser],['asset-server',assetServer]].map(([name,resource])=>({name,present:Boolean(resource),close:()=>resource.close()})),validate:value=>{validateHostedAssetEvidence(value.asset_server,{origin:value.origin,sourceSha});value.metrics=validateStalledKeyboardEvidence(value);},persist:async value=>{assert.ok(Buffer.byteLength(JSON.stringify(value))<1024*1024);await writeFile(join(output,'report.json'),JSON.stringify(value,null,2)+'\n');}});
  console.log(JSON.stringify({ok:report.ok,source_sha:sourceSha,metrics:report.metrics,error:report.error}));
}
if(!report.ok)throw Error(report.error);
