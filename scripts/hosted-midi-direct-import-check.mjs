// Hosted CI only: real Chromium picker/controls/AudioWorklets and real Rust
// native-filesystem dispatch over stdin. Never a local browser/server launch.
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {startVsqNativeDriver} from '../tests/vsq-native-driver-fixtures.js';
import {startHostedAssetServer,createHostedNativeBridge,validateHostedAssetEvidence} from './hosted-worklet-assets.mjs';
import {observeManagementWorkletLoads,validateManagementWorkletLoads} from './management-hosted-runtime.mjs';
import {audioThreadObserverSource} from './dense-rendition-observer.mjs';
import {validateAudioThreadRuns,validateAudioThreadStatus} from './audio-thread-rendition-proof.mjs';
import {startSongModPerformance} from './hosted-song-mod-controls.mjs';
import {prepareDirectMidiFixtures,directMidiDigest} from './prepare-direct-midi-fixtures.mjs';
import {validateDirectMidiImport,validateDirectMidiOpened,validateDirectMidiTake,directMidiAudioOracle} from './direct-midi-proof.mjs';

function observeDirectMidiControls(){
 const evidence={events:[],overflow:false};globalThis.__directMidiControls=evidence;
 for(const type of ['click','input','change'])document.addEventListener(type,event=>{
  if(evidence.events.length>=512){evidence.overflow=true;return;}
  const target=event.target;evidence.events.push({type,id:target?.id||null,trusted:event.isTrusted===true,files:target?.id==='score-file'?[...target.files].map(file=>({name:file.name,bytes:file.size})):null});
 },true);
}
export async function runHostedMidiDirectImportCheck(){
 assert.equal(process.env.GITHUB_ACTIONS,'true','Direct MIDI browser acceptance runs only on authorized hosted CI');assert.equal(process.env.WMH_HOSTED_BROWSER,'1');
 const root=fileURLToPath(new URL('../',import.meta.url)),git=(...args)=>execFileSync('git',args,{cwd:root,encoding:'utf8'}).trim(),head=git('rev-parse','HEAD');
 assert.match(process.env.WMH_SOURCE_SHA||'',/^[a-f0-9]{40}$/);assert.equal(process.env.WMH_SOURCE_SHA,head);assert.equal(git('status','--porcelain','--untracked-files=normal'),'','Exact hosted source must be clean');assert.ok(process.env.WMH_NATIVE_IMPORT_DRIVER);
 const output=resolve(process.env.WMH_ARTIFACT_DIR||join(root,'test-results/direct-midi')),height=Number(process.env.WMH_VIEWPORT_HEIGHT||720),binary=resolve(process.env.WMH_NATIVE_IMPORT_DRIVER);assert.ok([720,900].includes(height));await mkdir(output,{recursive:true});await mkdir(join(output,'downloads'),{recursive:true});
 const fixtures=await prepareDirectMidiFixtures(join(output,'fixtures')),fixture=fixtures.boundary;
 const report={version:1,kind:'hosted-browser-real-native-direct-midi',source_sha:head,source_tree:git('rev-parse','HEAD^{tree}'),driver_sha256:directMidiDigest(await readFile(binary)),viewport:{width:1280,height},fixture:fixture.manifest,native_filesystem:true,native_window:false,physical_audio:false,private_music:false,profiles:[],screenshots:[],ok:false};
 let browser,assetServer,origin,session,openedBefore,commitBefore;
 async function screenshot(label){const path=`${label}.png`;await session.page.screenshot({path:join(output,path),fullPage:true});report.screenshots.push({path,sha256:directMidiDigest(await readFile(join(output,path)))});}
 async function closeSession(){
  const owned=session;if(!owned)return;session=null;const failures=[];
  try{owned.profile.controls=await owned.page.evaluate(()=>__directMidiControls);owned.profile.worklet_loads=await owned.page.evaluate(()=>__wmhManagementWorkletLoads);owned.profile.observer_cleanup=await owned.page.evaluate(()=>__directMidiAudio.restore());assert.equal(owned.profile.observer_cleanup.restored,true);assert.deepEqual(owned.profile.observer_cleanup.cleanupErrors,[]);}catch(error){failures.push(String(error));}
  owned.bridge.stopAdmission();
  for(const [name,close]of [['context',()=>owned.context.close()],['native_bridge',()=>owned.bridge.drain()],['driver',()=>owned.driver.close()]])try{await close();owned.profile.cleanup[name]='closed';}catch(error){owned.profile.cleanup[name]=String(error);failures.push(String(error));}
  if(failures.length)throw Error(failures.join('\n'));
 }
 async function launch(phase){
  const profile={phase,process_id:null,api:[],page_errors:[],route_errors:[],cleanup:{},ok:false};report.profiles.push(profile);
  const owned={profile,driver:startVsqNativeDriver({binary,directory:join(output,'Scores'),cwd:root,requestTimeoutMs:30000})};session=owned;profile.process_id=owned.driver.pid;
  owned.context=await browser.newContext({viewport:report.viewport,acceptDownloads:true,serviceWorkers:'block'});
  await owned.context.addInitScript(observeManagementWorkletLoads);await owned.context.addInitScript(observeDirectMidiControls);await owned.context.addInitScript(`globalThis.__directMidiObserveAudio=${audioThreadObserverSource};`);
  owned.bridge=createHostedNativeBridge({origin,getOwnedPage:()=>owned.page,requestTimeoutMs:30000,maxRequests:256});profile.native_bridge=owned.bridge.evidence;
  await owned.context.route(url=>url.origin!==origin||url.pathname.startsWith('/api/'),async route=>{
   const request=route.request(),url=new URL(request.url());try{
    assert.equal(url.origin,origin,'Direct MIDI request left its exact-source origin');
    await owned.bridge.run(request,async(headers,admission)=>{
     assert.ok(profile.api.length<256);const body=request.postDataBuffer()||undefined,row={sequence:profile.api.length+1,path:url.pathname+url.search,method:request.method(),request_bytes:body?.length||0,request_sha256:directMidiDigest(body||Buffer.alloc(0)),status:null};profile.api.push(row);
     const response=await owned.driver.fetcher(row.path,{method:row.method,headers,body}),bytes=await response.bytes();row.status=response.status;row.response_sha256=directMidiDigest(bytes);row.response_bytes=bytes.length;
     if(['/api/import/midi','/api/library/import/preview','/api/library/import/commit','/api/library/load','/api/library/runtime','/api/practice-targets','/api/instrument-check'].includes(url.pathname)){assert.ok(bytes.length<=1024*1024,'Original fixture response exceeds one MiB');row.response=JSON.parse(bytes);}
     Object.assign(admission,{native_sequence:row.sequence,native_status:row.status,native_request_bytes:row.request_bytes,native_request_sha256:row.request_sha256,native_response_sha256:row.response_sha256});
     await route.fulfill({status:response.status,contentType:response.contentType,body:bytes});
    });
   }catch(error){profile.route_errors.push(String(error.stack||error));try{await route.abort();}catch{}}
  });
  owned.page=await owned.context.newPage();owned.page.setDefaultTimeout(15000);owned.page.on('pageerror',error=>profile.page_errors.push(String(error.stack||error)));
  await owned.page.goto(origin);await owned.page.evaluate(async()=>{globalThis.__directMidiAudio=await __directMidiObserveAudio(document);});await owned.page.locator('#home-single-player').click();return owned;
 }
 async function chooseRaw(raw){
  const {page}=session;
  // Source rejection leaves the import dialog open; reuse it on repeated picks.
  if(!await page.locator('#import-tools-dialog').evaluate(dialog=>dialog.open))await page.locator('#import-tools-button').click();
  const chooser=page.waitForEvent('filechooser');await page.locator('#import-button').click();await(await chooser).setFiles({name:raw.filename,mimeType:'audio/midi',buffer:raw.bytes});
 }
 async function downloadTake(label){
  const {page}=session;await page.locator('#results-button').click();const promise=page.waitForEvent('download');await page.locator('#export-takes').click();const download=await promise,path=`${label}-take.json`;await download.saveAs(join(output,'downloads',path));await page.locator('#results-dialog [data-close-panel]').click();const value=JSON.parse(await readFile(join(output,'downloads',path)));validateDirectMidiTake(value,fixture);return{path:`downloads/${path}`,sha256:directMidiDigest(JSON.stringify(value)),value};
 }
 async function directStart(phase){
  const {page,profile}=session;
  await page.waitForFunction(()=>document.getElementById('start-performance').disabled===false);
  // No Mod repair, manual package, source conversion screen or hidden action.
  await page.locator('#start-performance').click();
  await page.waitForFunction(()=>document.body.dataset.screen==='stage'&&document.getElementById('clean-song-stage').dataset.rendererState==='playing');
  assert.equal(await page.locator('#session-mode').inputValue(),'practice');
  await page.waitForFunction(()=>{__directMidiAudio.assertHealthy();return document.getElementById('clean-song-stage').dataset.rendererState==='ended'&&__directMidiAudio.quiet();},{},{timeout:20000});
  profile.take=await downloadTake(phase);await screenshot(`${phase}-direct-start-full-targets`);await page.locator('#back-to-library').click();
 }
 try{
  report.asset_server={};assetServer=await startHostedAssetServer({root,sourceSha:head,binary:resolve(root,process.env.WMH_SERVER_BINARY||'target/debug/practice-server'),evidence:report.asset_server});origin=assetServer.origin;report.origin=origin;
  const {chromium}=await import('playwright');browser=await chromium.launch({headless:true});report.browser_version=browser.version();
  await launch('seed');await chooseRaw(fixture);
  await session.page.waitForFunction(()=>document.getElementById('song-lobby').dataset.previewId?.startsWith('native:song-')&&document.getElementById('start-performance').disabled===false);
  const first=session.profile.api,strict=first.find(row=>row.path==='/api/import/midi'),preview=first.find(row=>row.path==='/api/library/import/preview'),commit=first.find(row=>row.path==='/api/library/import/commit');assert.equal(strict.status,400);assert.match(strict.response.error,/overlapping/i);assert.equal(preview.status,200);assert.equal(commit.status,200);assert.ok(strict.sequence<preview.sequence&&preview.sequence<commit.sequence);for(const row of [strict,preview,commit])assert.equal(row.request_sha256,fixture.manifest.sha256);
  validateDirectMidiImport(preview.response,fixture,{mode:'preview',status:'ready'});validateDirectMidiImport(commit.response,fixture);commitBefore=commit.response;
  openedBefore=validateDirectMidiOpened(first.findLast(row=>row.path==='/api/library/load').response,fixture);assert.equal(await session.page.locator('#song-lobby').getAttribute('data-preview-id'),`native:${openedBefore.entry.key}`);assert.equal(await session.page.locator('#catalog [data-library-key]').count(),1);assert.equal(await session.page.locator('#bulk-import-dialog').evaluate(node=>node.open),false);
  assert.equal(await session.page.evaluate(()=>__directMidiAudio.count()),0,'Importing a raw source must not start audio');await screenshot('seed-raw-midi-saved-preview');await directStart('seed');
  const audioStart=await session.page.evaluate(()=>__directMidiAudio.count());await startSongModPerformance(session.page,{performers:'none',layout:'complete'});
  await session.page.waitForFunction(()=>{__directMidiAudio.assertHealthy();return document.getElementById('clean-song-stage').dataset.rendererState==='ended'&&__directMidiAudio.quiet();},{},{timeout:15000});
  session.profile.machine_audio=await session.page.evaluate(index=>({status:__directMidiAudio.status(),runs:__directMidiAudio.snapshot().slice(index)}),audioStart);validateAudioThreadStatus(session.profile.machine_audio.status,{quiet:true});validateAudioThreadRuns(session.profile.machine_audio.runs,directMidiAudioOracle(fixture),{sourceSha256:fixture.manifest.sha256,durationMs:2000,sourceNotes:4});await screenshot('seed-all-source-attacks-real-audio');await session.page.locator('#back-to-library').click();
  session.profile.invalid=[];
  for(const invalid of fixtures.invalid){const start=session.profile.api.length,prior=await session.page.locator('#song-lobby').getAttribute('data-preview-id');await chooseRaw(invalid);await session.page.waitForFunction(filename=>document.getElementById('notice-message').textContent.includes(filename),invalid.filename);const rows=session.profile.api.slice(start);const preview=rows.find(row=>row.path==='/api/library/import/preview');assert.ok(preview&&preview.status===200);assert.ok(preview.response.items.every(item=>!item.playable&&!item.entry&&!item.clean_package));assert.equal(rows.some(row=>row.path==='/api/library/import/commit'),false);assert.equal(await session.page.locator('#song-lobby').getAttribute('data-preview-id'),prior);assert.equal(await session.page.locator('#catalog [data-library-key]').count(),1);session.profile.invalid.push({filename:invalid.filename,preview:preview.response,preserved_preview:prior});}
  session.profile.ok=true;await closeSession();
  await launch('restart');await session.page.locator(`#catalog [data-library-key="native:${openedBefore.entry.key}"]`).click();await session.page.waitForFunction(()=>document.getElementById('start-performance').disabled===false);const opened=session.profile.api.findLast(row=>row.path==='/api/library/load').response;validateDirectMidiOpened(opened,fixture);assert.deepEqual(opened,openedBefore,'Native-process/browser-profile restart must retain all original package bytes and runtime');assert.equal(session.profile.api.some(row=>row.path.startsWith('/api/library/import/')),false,'Restart must use saved library data');await directStart('restart');
  await session.page.locator('#import-tools-button').click();await session.page.locator('#bulk-import-history-button').click();const details=session.page.locator('#bulk-import-history');if(!await details.evaluate(node=>node.open))await details.locator('summary').first().click();const original=session.page.waitForEvent('download');await session.page.locator(`[data-import-archive="${commitBefore.source.archive_key}"]`).click();const download=await original,rawPath='downloads/restarted-original.mid';await download.saveAs(join(output,rawPath));assert.deepEqual(await readFile(join(output,rawPath)),fixture.bytes);session.profile.raw_export={path:rawPath,bytes:fixture.bytes.length,sha256:fixture.manifest.sha256};await screenshot('restart-retained-original-download');session.profile.ok=true;await closeSession();
  assert.equal(new Set(report.profiles.map(profile=>profile.process_id)).size,2,'Restart must use a new native process');
  for(const profile of report.profiles){assert.deepEqual(profile.page_errors,[]);assert.deepEqual(profile.route_errors,[]);assert.equal(profile.native_bridge.drain.status,'complete');assert.ok(profile.native_bridge.requests.every(row=>row.status==='settled'));assert.equal(profile.controls.overflow,false);assert.ok(profile.controls.events.some(event=>event.id==='start-performance'&&event.type==='click'&&event.trusted));validateManagementWorkletLoads(profile.worklet_loads,origin);assert.ok(profile.worklet_loads.modules.some(row=>row.url===`${origin}/basic-key-audio-processor.js`));}
  assert.ok(report.profiles[0].controls.events.some(event=>event.id==='score-file'&&event.type==='change'&&event.trusted&&event.files?.[0]?.name===fixture.filename));report.ok=true;
 }catch(error){report.error=String(error.stack||error);if(session?.page)try{report.failure_state=await session.page.evaluate(()=>({notice:document.getElementById('notice')?.textContent,preview:document.getElementById('song-lobby')?.dataset.previewId,clock:document.getElementById('progress')?.getAttribute('data-playback-clock')}));await screenshot('direct-midi-failure');}catch{}}
 finally{
  report.cleanup_errors=[];for(const [name,close]of [['profile',()=>closeSession()],['browser',()=>browser?.close()],['asset_server',()=>assetServer?.close()]])try{await close();}catch(error){report.cleanup_errors.push({name,error:String(error.stack||error)});}
  if(report.ok)try{validateHostedAssetEvidence(report.asset_server,{origin,sourceSha:head});}catch(error){report.cleanup_errors.push({name:'asset-evidence',error:String(error)});}
  if(report.cleanup_errors.length)report.ok=false;assert.ok(Buffer.byteLength(JSON.stringify(report))<8*1024*1024);await writeFile(join(output,'report.json'),JSON.stringify(report,null,2)+'\n');
 }
 if(!report.ok)throw Error(report.error||JSON.stringify(report.cleanup_errors));return report;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){const report=await runHostedMidiDirectImportCheck();console.log(JSON.stringify({ok:report.ok,source_sha:report.source_sha,profiles:report.profiles.map(row=>row.phase)}));}
