import {waitForSongMod,startSongModPerformance} from './hosted-song-mod-controls.mjs';
// Authorized hosted browser only. A real native Rust backend runs over stdin;
// no mocked save responses and no private score content enter this evidence.
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {authoredLegacyPack,startNativeImportDriver} from '../tests/native-import-driver-fixtures.js';
import {startHostedAssetServer,createHostedNativeBridge,validateHostedAssetEvidence,NATIVE_PROTOCOL_ORIGIN} from './hosted-worklet-assets.mjs';
import {observeManagementWorkletLoads,validateManagementWorkletLoads} from './management-hosted-runtime.mjs';

// Only API traffic enters native stdio. Worklet module fetches must reach the
// ordinary exact-source server, including requests outside page interception.
export async function installBulkImportNativeBridge(context,{origin,getOwnedPage,driver,evidence}) {
 const bridge=createHostedNativeBridge({origin,getOwnedPage});
 evidence.native_bridge=bridge.evidence;evidence.route_errors=[];
 await context.route(url=>url.origin!==origin||url.pathname.startsWith('/api/'),async route=>{
  const request=route.request(),url=new URL(request.url());
  try{
   assert.equal(url.origin,origin,'Bulk-import request left its owned origin');
   await bridge.run(request,async(headers,row)=>{
    const body=request.postDataBuffer()||undefined;
    row.native_request_bytes=body?.length||0;row.native_request_sha256=createHash('sha256').update(body||Buffer.alloc(0)).digest('hex');
    const response=await driver.fetcher(url.pathname+url.search,{method:request.method(),headers,body}),bytes=await response.bytes();
    row.native_status=response.status;row.native_response_sha256=createHash('sha256').update(bytes).digest('hex');
    await route.fulfill({status:response.status,contentType:response.contentType,body:bytes});
   });
  }catch(error){evidence.route_errors.push(String(error.stack||error));await route.abort();}
 });
 return bridge;
}

async function runHostedBulkImportCheck() {

if(process.env.GITHUB_ACTIONS!=='true'||process.env.WMH_HOSTED_BROWSER!=='1')throw Error('Only an authorized hosted GitHub Actions browser runner may execute this regression.');
const root=fileURLToPath(new URL('../',import.meta.url)),head=execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim();
if(!/^[0-9a-f]{40}$/.test(process.env.WMH_SOURCE_SHA||'')||process.env.WMH_SOURCE_SHA!==head)throw Error('A verified exact source SHA is required.');
if(!process.env.WMH_NATIVE_IMPORT_DRIVER)throw Error('Build native_import_driver for this exact source and set WMH_NATIVE_IMPORT_DRIVER.');
const output=path.resolve(process.env.WMH_ARTIFACT_DIR||path.join(root,'test-results/bulk-import'));await mkdir(output,{recursive:true});
const library=path.join(output,'authored-library'),fixture=authoredLegacyPack(),report={source_sha:head,kind:'hosted-browser-real-native-stdin',native_filesystem:true,native_window:false,native_protocol_origin:NATIVE_PROTOCOL_ORIGIN,profiles:[],cases:[],screenshots:[],ok:false};
let browser,assetServer,origin,session;
async function closeSession(){
 const owned=session;if(!owned)return;session=null;
 const errors=[];
 if(owned.page)try{
  owned.profile.worklet_loads=await owned.page.evaluate(()=>globalThis.__wmhManagementWorkletLoads??null);
  owned.profile.page_state=await owned.page.evaluate(()=>({screen:document.body.dataset.screen,play_disabled:document.querySelector('#play-button')?.disabled,playback_clock:document.querySelector('#progress')?.getAttribute('data-playback-clock'),notice:document.querySelector('#notice')?.textContent,score_title:document.querySelector('#score-title')?.textContent,preview_id:document.querySelector('#song-lobby')?.dataset.previewId}));
 }catch(error){errors.push(error);}
 owned.bridge?.stopAdmission();
 for(const [name,resource]of [['context',owned.context],['native_bridge',owned.bridge&&{close:()=>owned.bridge.drain()}],['driver',owned.driver]])if(resource){
  try{await resource.close();owned.profile.cleanup[name]='closed';}catch(error){owned.profile.cleanup[name]=String(error.stack||error);errors.push(error);}
 }
 if(errors.length)throw new AggregateError(errors,'Bulk-import profile cleanup failed: '+errors.map(String).join('; '));
}
try{
 const binary=path.resolve(process.env.WMH_NATIVE_IMPORT_DRIVER);report.driver_sha256=createHash('sha256').update(await readFile(binary)).digest('hex');
 for(const name of ['web/app.js','web/song-mod.js','web/song-mod-view.js','scripts/hosted-song-mod-controls.mjs','web/bulk-import.js','web/bulk-import-view.js','web/bulk-import-view.css','tests/native-import-driver-fixtures.js','scripts/hosted-bulk-import-check.mjs','scripts/hosted-worklet-assets.mjs','scripts/management-hosted-runtime.mjs']){report.source_hashes??={};report.source_hashes[name]=createHash('sha256').update(await readFile(path.join(root,name))).digest('hex')}
 report.asset_server={};assetServer=await startHostedAssetServer({root,sourceSha:head,binary:path.resolve(root,process.env.WMH_SERVER_BINARY||'target/debug/practice-server'),evidence:report.asset_server});origin=assetServer.origin;report.origin=origin;
 const {chromium}=await import('playwright');browser=await chromium.launch({headless:true});
 async function launch(){
  const profile={page_errors:[],cleanup:{}};report.profiles.push(profile);
  const owned={profile,driver:startNativeImportDriver({binary,directory:library,cwd:root})};session=owned;
  owned.context=await browser.newContext({viewport:{width:1365,height:900},acceptDownloads:true,serviceWorkers:'block'});
  await owned.context.addInitScript(observeManagementWorkletLoads);
  owned.bridge=await installBulkImportNativeBridge(owned.context,{origin,getOwnedPage:()=>owned.page,driver:owned.driver,evidence:profile});
  owned.page=await owned.context.newPage();owned.page.on('pageerror',error=>profile.page_errors.push(String(error.stack||error)));
  await owned.page.goto(origin);await owned.page.locator('#home-single-player').click();await waitForSongMod(owned.page);return owned.page;
 }
 let page=await launch();
 await startSongModPerformance(page,{performers:'none'});await page.waitForFunction(()=>document.body.dataset.screen==='stage'&&!document.querySelector('#play-button').disabled);report.bootstrap=await page.locator('#progress').evaluate(node=>JSON.parse(node.getAttribute('data-playback-clock')));assert.equal(report.bootstrap.running,true);await page.locator('#back-to-library').click();const activeTitle=await page.locator('#score-title').textContent(),preview=await page.locator('#song-lobby').getAttribute('data-preview-id');
 await page.locator('#import-tools-button').click();
 assert.equal(await page.locator('#score-file').getAttribute('multiple'),'');
 const picker=page.waitForEvent('filechooser');await page.locator('#import-button').click();await(await picker).setFiles({name:fixture.filename,mimeType:'application/zip',buffer:fixture.bytes});
 await page.waitForFunction(()=>document.querySelector('#bulk-import-dialog')?.dataset.phase==='review'&&document.querySelectorAll('.bulk-import-song').length===3);
 assert.equal(await page.locator('#catalog [data-library-key]').count(),0);assert.equal(await page.locator('[data-status="retained_nonplayable"]').count(),1);assert.equal(await page.locator('#score-title').textContent(),activeTitle);
 await page.screenshot({path:path.join(output,'native-pack-preflight-zh.png'),fullPage:true});report.screenshots.push('native-pack-preflight-zh.png');
 await page.locator('#bulk-import-save').click();await page.waitForFunction(()=>document.querySelector('#bulk-import-dialog')?.dataset.phase==='review'&&document.querySelectorAll('#catalog [data-library-key]').length===2);
 assert.equal(await page.locator('#score-title').textContent(),activeTitle);assert.equal(await page.locator('#song-lobby').getAttribute('data-preview-id'),preview);assert.equal(await page.locator('[data-status="retained_nonplayable"] [data-import-browse]').isVisible(),false);
 if(await page.locator('#bulk-import-history').getAttribute('open')===null)await page.locator('#bulk-import-history > summary').click();await page.locator('[data-import-archive]').first().waitFor();
 const originalDownload=page.waitForEvent('download');await page.locator('[data-import-archive]').first().click();const original=await originalDownload,originalPath=path.join(output,'authored-original.zip');await original.saveAs(originalPath);assert.deepEqual(await readFile(originalPath),fixture.bytes);
 await page.locator('#bulk-import-export-all').click();const packDownload=page.waitForEvent('download');await page.locator('#bulk-import-export-pack').click();const pack=await packDownload,packPath=path.join(output,'authored-unified-pack.zip');await pack.saveAs(packPath);assert.ok((await readFile(packPath)).length>0);
 await page.screenshot({path:path.join(output,'native-pack-saved-originals-zh.png'),fullPage:true});report.screenshots.push('native-pack-saved-originals-zh.png');
 report.cases.push({name:'actual-file-picker-unicode-zip-preflight-save-original-export',saved:2,retained_nonplayable:1,original_sha256:createHash('sha256').update(fixture.bytes).digest('hex'),ok:true});
 await page.locator('#bulk-import-done').click();await page.locator('#settings-button').click();await page.locator('#interface-language').selectOption('en');await page.locator('#settings-dialog .shell-dialog-heading button').click();
 await page.locator('#import-tools-button').click();const unifiedPicker=page.waitForEvent('filechooser');await page.locator('#import-button').click();await(await unifiedPicker).setFiles(packPath);await page.waitForFunction(()=>document.querySelector('#bulk-import-dialog').dataset.phase==='review'&&document.querySelectorAll('.bulk-import-song').length===2);await page.locator('#bulk-import-save').click();await page.waitForFunction(()=>document.querySelector('#bulk-import-dialog').dataset.phase==='review'&&document.querySelectorAll('[data-status="duplicate"]').length===2);assert.equal(await page.locator('#catalog [data-library-key]').count(),2);
 await page.screenshot({path:path.join(output,'unified-pack-roundtrip-en.png'),fullPage:true});report.screenshots.push('unified-pack-roundtrip-en.png');report.cases.push({name:'unified-pack-export-reimport-deduplication',ok:true});
 await closeSession();page=await launch();await page.waitForFunction(()=>document.querySelectorAll('#catalog [data-library-key]').length===2);await page.locator('#catalog [data-library-key]').first().click();await waitForSongMod(page);await page.locator('#import-tools-button').click();await page.locator('#bulk-import-history-button').click();if(await page.locator('#bulk-import-history').getAttribute('open')===null)await page.locator('#bulk-import-history > summary').click();await page.locator('[data-import-archive]').first().waitFor();await page.screenshot({path:path.join(output,'native-pack-fresh-profile-restart.png'),fullPage:true});report.screenshots.push('native-pack-fresh-profile-restart.png');report.cases.push({name:'fresh-native-process-and-browser-profile-restart',saved:2,ok:true});await closeSession();
 for(const [index,profile]of report.profiles.entries()){
  assert.deepEqual(profile.route_errors,[]);assert.deepEqual(profile.page_errors,[]);
  assert.equal(profile.native_bridge.drain.status,'complete');assert.ok(profile.native_bridge.requests.length>0);assert.ok(profile.native_bridge.requests.every(row=>row.status==='settled'));
  validateManagementWorkletLoads(profile.worklet_loads,origin,{required:index===0});
  if(index===0)assert.ok(profile.worklet_loads.modules.some(row=>row.url===`${origin}/canonical-audio-processor.js`&&row.status==='loaded'),'The preservation baseline must use its real canonical source worklet');
 }
 report.ok=true;
}catch(error){report.error=error.stack||String(error);process.exitCode=1}
finally{
 const cleanupErrors=[];
 for(const close of [()=>closeSession(),()=>browser?.close(),()=>assetServer?.close()])try{await close();}catch(error){cleanupErrors.push(String(error.stack||error));}
 if(report.ok)try{validateHostedAssetEvidence(report.asset_server,{origin,sourceSha:head});}catch(error){cleanupErrors.push(String(error.stack||error));}
 if(cleanupErrors.length){report.cleanup_errors=cleanupErrors;report.error??=cleanupErrors.join('\n');report.ok=false;process.exitCode=1;}
 await writeFile(path.join(output,'report.json'),JSON.stringify(report,null,2)+'\n');
}
if(!report.ok)throw Error(report.error);
}

// Importing the route adapter for deterministic tests never launches a process,
// listener or browser. Direct execution still enforces the hosted-only gates.
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href)await runHostedBulkImportCheck();
