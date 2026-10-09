// Hosted CI only: real Chromium picker/controls/AudioWorklets and real Rust
// native-filesystem dispatch over stdin. Never a local browser/server launch.
import assert from 'node:assert/strict';
import {isDeepStrictEqual} from 'node:util';
import {basicAdmissionSource,basicAdmissionTimeline,validateBasicPracticeAdmissionEvidence} from './basic-practice-admission-proof.mjs';
import {execFileSync} from 'node:child_process';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {basename,join,resolve} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {startVsqNativeDriver} from '../tests/vsq-native-driver-fixtures.js';
import {startHostedAssetServer,createHostedNativeBridge,validateHostedAssetEvidence} from './hosted-worklet-assets.mjs';
import {observeManagementWorkletLoads,validateManagementWorkletLoads} from './management-hosted-runtime.mjs';
import {audioThreadObserverSource} from './dense-rendition-observer.mjs';
import {validateAudioThreadRuns,validateAudioThreadStatus} from './audio-thread-rendition-proof.mjs';
import {startSongModPerformance} from './hosted-song-mod-controls.mjs';
import {prepareDirectMidiFixtures,directMidiDigest} from './prepare-direct-midi-fixtures.mjs';
import {validateDirectMidiImport,validateDirectMidiOpened,validateDirectMidiTake,directMidiAudioOracle} from './direct-midi-proof.mjs';

/** Capture only JSON actually consumed by the app; never fetch a duplicate or
 * clone a response. The hosted native bridge independently retains wire bytes. */
export function observeHostedBasicAdmissions(){
 const original=globalThis.fetch,evidence={clock:{basis:'performance.now',timeOrigin:performance.timeOrigin},rows:[],clicks:[],boundaries:[],events:0,errors:[],restored:false},restores=new Set();let stopped=false;
 const context=()=>({screen:document.body?.dataset.screen||null,previewId:document.getElementById('song-lobby')?.dataset.previewId||null});
 const error=value=>evidence.errors.push(String(value).slice(0,512)),tick=()=>++evidence.events;
 const startClick=event=>{if(stopped||!event.target?.closest?.('#start-performance'))return;if(evidence.clicks.length>=64){error('Start action evidence bound');return;}evidence.clicks.push({event:tick(),wall:performance.now(),trusted:event.isTrusted===true,...context()});};
 document.addEventListener('click',startClick,true);
 function fetch(...args){
  const promise=Reflect.apply(original,this,args),path=typeof args[0]==='string'?args[0]:args[0]?.url;
  if(stopped||path!=='/api/library/practice-admission')return promise;
  try{
   if(evidence.rows.length>=128)throw Error('Basic admission evidence bound');
   const row={path,request:JSON.parse(args[1].body),status:null,response:null,observation:'fetching',startedEvent:tick(),consumedEvent:null,startedWall:performance.now(),consumedWall:null,started:context(),settled:null};evidence.rows.push(row);
   Reflect.apply(Promise.prototype.then,promise,[response=>{
    row.status=response.status;row.observation='awaiting-json';const originalJson=response.json,descriptor=Object.getOwnPropertyDescriptor(response,'json');
    const restore=()=>{if(response.json===json){if(descriptor)Object.defineProperty(response,'json',descriptor);else delete response.json;}restores.delete(restore);};
    function json(...values){const result=Reflect.apply(originalJson,this,values);if(this===response)Reflect.apply(Promise.prototype.then,result,[body=>{try{if(!stopped){if(new TextEncoder().encode(JSON.stringify(body)).length>256*1024)throw Error('Basic response bound');row.response=structuredClone(body);row.observation='consumed';row.consumedEvent=tick();row.consumedWall=performance.now();row.settled=context();}}catch(value){error(value);}finally{restore();}},value=>{row.observation='body-rejected';error(value);restore();}]);return result;}
    response.json=json;restores.add(restore);
   },value=>{row.observation='fetch-rejected';error(value);}]);
  }catch(value){error(value);}
  return promise;
 }
 globalThis.fetch=fetch;
 globalThis.__hostedBasicAdmissions={evidence,mark(label){if(stopped||!['before-start','transport-started','take-exported'].includes(label)||evidence.boundaries.some(row=>row.label===label))throw Error('Invalid Human-run boundary');const boundary={label,event:tick(),wall:performance.now(),admissionCount:evidence.rows.length,...context(),mode:document.getElementById('session-mode')?.value||null,renderer:document.getElementById('clean-song-stage')?.dataset.rendererState||null};evidence.boundaries.push(boundary);return structuredClone(boundary);},restore(){stopped=true;document.removeEventListener('click',startClick,true);for(const restore of [...restores])restore();if(globalThis.fetch===fetch)globalThis.fetch=original;evidence.restored=globalThis.fetch===original;return evidence;}};
}
export function validateHostedDirectMidiAdmissions(profile,opened,fixture){
 const observed=profile.admissions;assert.equal(observed?.restored,true);assert.deepEqual(observed.errors,[]);assert.ok(observed.rows.length>0&&observed.rows.length<=128);
 const wire=profile.api.filter(row=>row.path==='/api/library/practice-admission');assert.equal(wire.length,observed.rows.length,'Every native admission must also have application-consumption evidence');
 const source=basicAdmissionSource(opened),timeline=basicAdmissionTimeline(opened),current=[],events=[],walls=new Map(),pass=profile.take.value.passes.at(-1),wallStart=pass?.clock_segments?.[0]?.wallStart;
 assert.equal(observed.clock?.basis,'performance.now');assert.ok(Number.isFinite(observed.clock.timeOrigin)&&observed.clock.timeOrigin>0);
 assert.equal(profile.take.browserClock?.basis,'performance.now');assert.equal(profile.take.browserClock.timeOrigin,observed.clock.timeOrigin,'Admission and downloaded take must belong to the same browser performance clock');
 assert.ok(Number.isFinite(wallStart)&&wallStart>=0,'The exact retained Human pass start is required');
 const event=(value,wall)=>{assert.ok(Number.isSafeInteger(value)&&value>0&&value<=observed.events);assert.ok(Number.isFinite(wall)&&wall>=0);events.push(value);walls.set(value,wall);};
 assert.ok(Number.isSafeInteger(observed.events)&&observed.events>0&&observed.events<=512);
 assert.deepEqual(observed.boundaries.map(row=>row.label),['before-start','transport-started','take-exported']);
 const [before,started,exported]=observed.boundaries;
 for(const boundary of observed.boundaries){event(boundary.event,boundary.wall);assert.equal(boundary.previewId,`native:${source.key}`);assert.equal(boundary.admissionCount,observed.rows.filter(row=>row.startedEvent<boundary.event).length,'Boundary must retain every prior admission');}
 assert.ok(before.event<started.event&&started.event<exported.event);assert.equal(before.screen,'library');
 for(const boundary of [started,exported]){assert.equal(boundary.screen,'stage');assert.equal(boundary.mode,'practice');}
 assert.equal(started.renderer,'playing');assert.equal(exported.renderer,'ended');
 assert.ok(Array.isArray(observed.clicks)&&observed.clicks.length>0&&observed.clicks.length<=64);
 for(const click of observed.clicks)event(click.event,click.wall);
 const clicks=observed.clicks.filter(click=>click.event>before.event&&click.event<started.event);assert.equal(clicks.length,1,'The Human run must have one observed Start action');const click=clicks[0];assert.equal(click.trusted,true);assert.equal(click.screen,'library');assert.equal(click.previewId,`native:${source.key}`);
 assert.ok(click.wall<wallStart&&wallStart<exported.wall,'Actual Human pass start must follow its trusted Start and precede export');assert.ok(Number.isFinite(profile.take.browserClock.capturedWall)&&profile.take.browserClock.capturedWall>=wallStart&&profile.take.browserClock.capturedWall<=exported.wall);

 for(const [index,row]of observed.rows.entries()){
  event(row.startedEvent,row.startedWall);event(row.consumedEvent,row.consumedWall);assert.ok(row.startedEvent<row.consumedEvent);if(index)assert.ok(observed.rows[index-1].startedEvent<row.startedEvent);
  assert.equal(row.observation,'consumed');assert.deepEqual(row.started,row.settled);assert.equal(row.started.previewId,`native:${source.key}`);assert.ok(['library','stage'].includes(row.started.screen));
  assert.equal(wire[index].method,'POST');assert.equal(wire[index].status,200);assert.deepEqual(wire[index].request,row.request);assert.deepEqual(wire[index].response,row.response,'Consumed receipt must be the native bridge response');
  const checked=validateBasicPracticeAdmissionEvidence(row,{source,timeline,selection:row.request.selection,eligibilityReceipt:opened.clean_package.runtime.source_eligibility?.receipt});
  if(row.started.screen==='stage'&&row.startedEvent>click.event&&row.consumedEvent<started.event&&row.consumedWall<wallStart&&checked.human_targets.target_count===fixture.expectedNotes.length)current.push(checked);
 }
 assert.deepEqual(events.sort((a,b)=>a-b),Array.from({length:observed.events},(_,index)=>index+1),'Admission, action and Human-run boundary event log must be complete');
 assert.ok(observed.rows.some(row=>row.started.screen==='library'&&row.consumedEvent<before.event),'Saved preview must consume source admission before Start');assert.ok(current.length>0,'Direct Human transport must consume fresh stage admission before its actual retained pass start');
 for(let index=1;index<events.length;index++)assert.ok(walls.get(events[index-1])<=walls.get(events[index]),'Browser performance times must preserve observed event order');
 const checked=current.findLast(value=>isDeepStrictEqual(value.human_targets.timeline,pass.timeline));assert.ok(checked,'Retained take must use the current complete admitted source clock');
 assert.deepEqual(profile.take.value.target_plan,checked.human_targets);assert.deepEqual(pass.interpretation.basic_practice_admission,{receipt:checked.receipt,selection_digest:checked.plan.selection_digest});
 return checked;
}

export function observeDirectMidiControls(){
 const evidence={events:[],overflow:false};globalThis.__directMidiControls=evidence;
 for(const type of ['click','input','change'])document.addEventListener(type,event=>{
  if(evidence.events.length>=512){evidence.overflow=true;return;}
  const target=event.target;evidence.events.push({type,id:target?.id||null,trusted:event.isTrusted===true,files:target?.id==='score-file'?[...target.files].map(file=>({name:file.name,bytes:file.size})):null});
 },true);
}
export async function chooseRaw(page,directory,raw){
 assert.equal(basename(raw.filename),raw.filename,'Hosted MIDI fixture must retain its original basename');
 const path=resolve(directory,raw.filename),bytes=await readFile(path);
 assert.deepEqual(bytes,raw.bytes,'Hosted MIDI picker must select the exact authored bytes on disk');
 assert.equal(bytes.length,raw.manifest?.bytes??raw.bytes.length);
 assert.equal(directMidiDigest(bytes),raw.manifest?.sha256??directMidiDigest(raw.bytes),'Hosted MIDI picker file must match its authored digest');
 // Source rejection leaves the import dialog open; reuse it on repeated picks.
 if(!await page.locator('#import-tools-dialog').evaluate(dialog=>dialog.open))await page.locator('#import-tools-button').click();
 // A FilePayload uses Playwright's synthetic DataTransfer input/change route.
 // A real disk path uses Chromium's file-input operation; retain isTrusted.
 const chooser=page.waitForEvent('filechooser');await page.locator('#import-button').click();await(await chooser).setFiles(path);
}
export function validateDirectMidiPickerChange(controls,fixture){
 assert.equal(controls.overflow,false);
 const click=controls.events.findIndex(event=>event.id==='import-button'&&event.type==='click'&&event.trusted===true);
 assert.ok(click>=0,'Original import button must be clicked with a trusted action');
 assert.ok(controls.events.slice(click+1).some(event=>event.id==='score-file'&&event.type==='change'&&event.trusted===true&&event.files?.length===1&&event.files[0].name===fixture.filename&&event.files[0].bytes===fixture.bytes.length),'Original MIDI picker must emit a trusted change for the exact authored file');
 return controls;
}
export function validateDirectMidiMachineIsolation(value){
 assert.deepEqual(value,{mode:'listen',captured:'0',export_disabled:true,assess_disabled:true,assessment_requests:0},'Audible machine playback must not create a human take or assessment');
 return value;
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
  try{owned.profile.admissions=await owned.page.evaluate(()=>__hostedBasicAdmissions.restore());owned.profile.controls=await owned.page.evaluate(()=>__directMidiControls);owned.profile.worklet_loads=await owned.page.evaluate(()=>__wmhManagementWorkletLoads);owned.profile.observer_cleanup=await owned.page.evaluate(()=>__directMidiAudio.restore());assert.equal(owned.profile.observer_cleanup.restored,true);assert.deepEqual(owned.profile.observer_cleanup.cleanupErrors,[]);}catch(error){failures.push(String(error));}
  owned.bridge.stopAdmission();
  for(const [name,close]of [['context',()=>owned.context.close()],['native_bridge',()=>owned.bridge.drain()],['driver',()=>owned.driver.close()]])try{await close();owned.profile.cleanup[name]='closed';}catch(error){owned.profile.cleanup[name]=String(error);failures.push(String(error));}
  if(failures.length)throw Error(failures.join('\n'));
 }
 async function launch(phase){
  const profile={phase,process_id:null,api:[],page_errors:[],route_errors:[],cleanup:{},ok:false};report.profiles.push(profile);
  const owned={profile,driver:startVsqNativeDriver({binary,directory:join(output,'Scores'),cwd:root,requestTimeoutMs:30000})};session=owned;profile.process_id=owned.driver.pid;
  const buildResponse=await owned.driver.fetcher('/api/diagnostics/build',{method:'GET'});assert.equal(buildResponse.status,200);profile.build_identity=JSON.parse(await buildResponse.bytes());
  assert.equal(profile.build_identity.compiled.source_sha,head);assert.equal(profile.build_identity.compiled.source_tree,report.source_tree);assert.equal(profile.build_identity.compiled.source_status,'clean');assert.equal(profile.build_identity.compiled.source_error,null);assert.equal(profile.build_identity.native.executable_sha256,report.driver_sha256);assert.equal(profile.build_identity.native.process_id,profile.process_id);
  owned.context=await browser.newContext({viewport:report.viewport,acceptDownloads:true,serviceWorkers:'block'});
  await owned.context.addInitScript(observeHostedBasicAdmissions);await owned.context.addInitScript(observeManagementWorkletLoads);await owned.context.addInitScript(observeDirectMidiControls);await owned.context.addInitScript(`globalThis.__directMidiObserveAudio=${audioThreadObserverSource};`);
  owned.bridge=createHostedNativeBridge({origin,getOwnedPage:()=>owned.page,requestTimeoutMs:30000,maxRequests:256});profile.native_bridge=owned.bridge.evidence;
  await owned.context.route(url=>url.origin!==origin||url.pathname.startsWith('/api/'),async route=>{
   const request=route.request(),url=new URL(request.url());try{
    assert.equal(url.origin,origin,'Direct MIDI request left its exact-source origin');
    await owned.bridge.run(request,async(headers,admission)=>{
     assert.ok(profile.api.length<256);const body=request.postDataBuffer()||undefined,row={sequence:profile.api.length+1,path:url.pathname+url.search,method:request.method(),request_bytes:body?.length||0,request_sha256:directMidiDigest(body||Buffer.alloc(0)),status:null};profile.api.push(row);
     const response=await owned.driver.fetcher(row.path,{method:row.method,headers,body}),bytes=await response.bytes();row.status=response.status;row.response_sha256=directMidiDigest(bytes);row.response_bytes=bytes.length;
     if(['/api/import/midi','/api/library/import/preview','/api/library/import/commit','/api/library/load','/api/library/runtime','/api/practice-targets','/api/library/practice-admission','/api/instrument-check'].includes(url.pathname)){assert.ok(bytes.length<=1024*1024,'Original fixture response exceeds one MiB');row.response=JSON.parse(bytes);if(url.pathname==='/api/library/practice-admission')row.request=JSON.parse(body.toString());}
     Object.assign(admission,{native_sequence:row.sequence,native_status:row.status,native_request_bytes:row.request_bytes,native_request_sha256:row.request_sha256,native_response_sha256:row.response_sha256});
     await route.fulfill({status:response.status,contentType:response.contentType,body:bytes});
    });
   }catch(error){profile.route_errors.push(String(error.stack||error));try{await route.abort();}catch{}}
  });
  owned.page=await owned.context.newPage();owned.page.setDefaultTimeout(15000);owned.page.on('pageerror',error=>profile.page_errors.push(String(error.stack||error)));
  await owned.page.goto(origin);await owned.page.evaluate(async()=>{globalThis.__directMidiAudio=await __directMidiObserveAudio(document);});await owned.page.locator('#home-single-player').click();return owned;
 }
 async function downloadTake(label){
  const {page}=session;await page.locator('#results-button').click();const promise=page.waitForEvent('download');await page.locator('#export-takes').click();const download=await promise,path=`${label}-take.json`;await download.saveAs(join(output,'downloads',path));await page.locator('#results-dialog [data-close-panel]').click();const value=JSON.parse(await readFile(join(output,'downloads',path)));validateDirectMidiTake(value,fixture);const browserClock=await page.evaluate(()=>({basis:'performance.now',timeOrigin:performance.timeOrigin,capturedWall:performance.now()}));return{path:`downloads/${path}`,sha256:directMidiDigest(JSON.stringify(value)),value,browserClock};
 }
 async function directStart(phase){
  const {page,profile}=session;
  await page.waitForFunction(()=>document.getElementById('start-performance').disabled===false);
  // No Mod repair, manual package, source conversion screen or hidden action.
  await page.evaluate(()=>__hostedBasicAdmissions.mark('before-start'));
  await page.locator('#start-performance').click();
  await page.waitForFunction(()=>{if(document.body.dataset.screen!=='stage'||document.getElementById('clean-song-stage').dataset.rendererState!=='playing')return false;__hostedBasicAdmissions.mark('transport-started');return true;});
  assert.equal(await page.locator('#session-mode').inputValue(),'practice');
  await page.waitForFunction(()=>{__directMidiAudio.assertHealthy();return document.getElementById('clean-song-stage').dataset.rendererState==='ended'&&__directMidiAudio.quiet();},{},{timeout:20000});
  profile.take=await downloadTake(phase);await page.evaluate(()=>__hostedBasicAdmissions.mark('take-exported'));await screenshot(`${phase}-direct-start-full-targets`);await page.locator('#back-to-library').click();
 }
 try{
  report.asset_server={};assetServer=await startHostedAssetServer({root,sourceSha:head,binary:resolve(root,process.env.WMH_SERVER_BINARY||'target/debug/practice-server'),evidence:report.asset_server});origin=assetServer.origin;report.origin=origin;
  const {chromium}=await import('playwright');browser=await chromium.launch({headless:true});report.browser_version=browser.version();
  await launch('seed');await chooseRaw(session.page,join(output,'fixtures'),fixture);
  await session.page.waitForFunction(()=>document.getElementById('song-lobby').dataset.previewId?.startsWith('native:song-')&&document.getElementById('start-performance').disabled===false);
  const first=session.profile.api,strict=first.find(row=>row.path==='/api/import/midi'),preview=first.find(row=>row.path==='/api/library/import/preview'),commit=first.find(row=>row.path==='/api/library/import/commit');assert.equal(strict.status,400);assert.match(strict.response.error,/overlapping/i);assert.equal(preview.status,200);assert.equal(commit.status,200);assert.ok(strict.sequence<preview.sequence&&preview.sequence<commit.sequence);for(const row of [strict,preview,commit])assert.equal(row.request_sha256,fixture.manifest.sha256);
  validateDirectMidiImport(preview.response,fixture,{mode:'preview',status:'ready'});validateDirectMidiImport(commit.response,fixture);commitBefore=commit.response;
  openedBefore=validateDirectMidiOpened(first.findLast(row=>row.path==='/api/library/load').response,fixture);assert.equal(await session.page.locator('#song-lobby').getAttribute('data-preview-id'),`native:${openedBefore.entry.key}`);assert.equal(await session.page.locator('#catalog [data-library-key]').count(),1);assert.equal(await session.page.locator('#bulk-import-dialog').evaluate(node=>node.open),false);
  assert.equal(await session.page.evaluate(()=>__directMidiAudio.count()),0,'Importing a raw source must not start audio');await screenshot('seed-raw-midi-saved-preview');await directStart('seed');
  const audioStart=await session.page.evaluate(()=>__directMidiAudio.count()),machineApiStart=session.profile.api.length;await startSongModPerformance(session.page,{performers:'none',layout:'complete'});
  await session.page.waitForFunction(()=>{__directMidiAudio.assertHealthy();return document.getElementById('clean-song-stage').dataset.rendererState==='ended'&&__directMidiAudio.quiet();},{},{timeout:15000});
  session.profile.machine_isolation=validateDirectMidiMachineIsolation({...await session.page.evaluate(()=>({mode:document.getElementById('session-mode').value,captured:document.getElementById('hud-captured').textContent.trim(),export_disabled:document.getElementById('export-takes').disabled,assess_disabled:document.getElementById('assess-button').disabled})),assessment_requests:session.profile.api.slice(machineApiStart).filter(row=>row.path==='/api/assess').length});
  session.profile.machine_audio=await session.page.evaluate(index=>({status:__directMidiAudio.status(),runs:__directMidiAudio.snapshot().slice(index)}),audioStart);validateAudioThreadStatus(session.profile.machine_audio.status,{quiet:true});validateAudioThreadRuns(session.profile.machine_audio.runs,directMidiAudioOracle(fixture),{sourceSha256:fixture.manifest.sha256,durationMs:2000,sourceNotes:4});await screenshot('seed-all-source-attacks-real-audio');await session.page.locator('#back-to-library').click();
  session.profile.invalid=[];
  for(const invalid of fixtures.invalid){const start=session.profile.api.length,prior=await session.page.locator('#song-lobby').getAttribute('data-preview-id');await chooseRaw(session.page,join(output,'fixtures'),invalid);await session.page.waitForFunction(filename=>document.getElementById('notice-message').textContent.includes(filename),invalid.filename);const rows=session.profile.api.slice(start);const preview=rows.find(row=>row.path==='/api/library/import/preview');assert.ok(preview&&preview.status===200);assert.ok(preview.response.items.every(item=>!item.playable&&!item.entry&&!item.clean_package));assert.equal(rows.some(row=>row.path==='/api/library/import/commit'),false);assert.equal(await session.page.locator('#song-lobby').getAttribute('data-preview-id'),prior);assert.equal(await session.page.locator('#catalog [data-library-key]').count(),1);session.profile.invalid.push({filename:invalid.filename,preview:preview.response,preserved_preview:prior});}
  session.profile.ok=true;await closeSession();
  await launch('restart');await session.page.locator(`#catalog [data-library-key="native:${openedBefore.entry.key}"]`).click();await session.page.waitForFunction(()=>document.getElementById('start-performance').disabled===false);const opened=session.profile.api.findLast(row=>row.path==='/api/library/load').response;validateDirectMidiOpened(opened,fixture);assert.deepEqual(opened,openedBefore,'Native-process/browser-profile restart must retain all original package bytes and runtime');assert.equal(session.profile.api.some(row=>row.path.startsWith('/api/library/import/')),false,'Restart must use saved library data');await directStart('restart');
  await session.page.locator('#import-tools-button').click();await session.page.locator('#bulk-import-history-button').click();const details=session.page.locator('#bulk-import-history');if(!await details.evaluate(node=>node.open))await details.locator('summary').first().click();const original=session.page.waitForEvent('download');await session.page.locator(`[data-import-archive="${commitBefore.source.archive_key}"]`).click();const download=await original,rawPath='downloads/restarted-original.mid';await download.saveAs(join(output,rawPath));assert.deepEqual(await readFile(join(output,rawPath)),fixture.bytes);session.profile.raw_export={path:rawPath,bytes:fixture.bytes.length,sha256:fixture.manifest.sha256};await screenshot('restart-retained-original-download');session.profile.ok=true;await closeSession();
  assert.equal(new Set(report.profiles.map(profile=>profile.process_id)).size,2,'Restart must use a new native process');
  for(const profile of report.profiles){validateHostedDirectMidiAdmissions(profile,openedBefore,fixture);assert.deepEqual(profile.page_errors,[]);assert.deepEqual(profile.route_errors,[]);assert.equal(profile.native_bridge.drain.status,'complete');assert.ok(profile.native_bridge.requests.every(row=>row.status==='settled'));assert.equal(profile.controls.overflow,false);assert.ok(profile.controls.events.some(event=>event.id==='start-performance'&&event.type==='click'&&event.trusted));validateManagementWorkletLoads(profile.worklet_loads,origin);assert.ok(profile.worklet_loads.modules.some(row=>row.url===`${origin}/basic-key-audio-processor.js`));}
  validateDirectMidiPickerChange(report.profiles[0].controls,fixture);report.ok=true;
 }catch(error){report.error=String(error.stack||error);if(session?.page)try{report.failure_state=await session.page.evaluate(()=>({notice:document.getElementById('notice')?.textContent,preview:document.getElementById('song-lobby')?.dataset.previewId,clock:document.getElementById('progress')?.getAttribute('data-playback-clock')}));await screenshot('direct-midi-failure');}catch{}}
 finally{
  report.cleanup_errors=[];for(const [name,close]of [['profile',()=>closeSession()],['browser',()=>browser?.close()],['asset_server',()=>assetServer?.close()]])try{await close();}catch(error){report.cleanup_errors.push({name,error:String(error.stack||error)});}
  if(report.ok)try{validateHostedAssetEvidence(report.asset_server,{origin,sourceSha:head});}catch(error){report.cleanup_errors.push({name:'asset-evidence',error:String(error)});}
  if(report.cleanup_errors.length)report.ok=false;assert.ok(Buffer.byteLength(JSON.stringify(report))<8*1024*1024);await writeFile(join(output,'report.json'),JSON.stringify(report,null,2)+'\n');
 }
 if(!report.ok)throw Error(report.error||JSON.stringify(report.cleanup_errors));return report;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){const report=await runHostedMidiDirectImportCheck();console.log(JSON.stringify({ok:report.ok,source_sha:report.source_sha,profiles:report.profiles.map(row=>row.phase)}));}
