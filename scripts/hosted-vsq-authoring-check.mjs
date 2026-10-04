// Authorized hosted Actions only: exact-source asset server and actual Rust stdio.
// Only owned application API requests cross the acceptance bridge.
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createAuthoringHostedConsole} from './song-authoring-hosted-console.mjs';
import {createAuthoringHostedChooser} from './song-authoring-hosted-chooser.mjs';
import {startVsqNativeDriver} from '../tests/vsq-native-driver-fixtures.js';
import {prepareVsqAuthoringFixtures,VSQ_AUTHORING_FIXTURE_FILENAME,vsqAuthoringFixture} from './prepare-vsq-authoring-fixtures.mjs';
import {assertVsqAuthoringZip} from './check-vsq-authoring-native.mjs';
import {VSQ_AUTHORING_PHASES,validateVsqAuthoringRenderer,validateVsqAuthoringTakes,validateAuthoringSavedBytes,vsqAuthoringScreenshotRoles} from './verify-native-vsq-authoring-evidence.mjs';
import {validateCleanScreenshot} from './verify-native-clean-song-evidence.mjs';
import {startHostedAssetServer,createHostedNativeBridge,validateHostedAssetEvidence} from './hosted-worklet-assets.mjs';
import {digest} from '../tests/clean-song-package-fixtures.js';
if(process.env.GITHUB_ACTIONS!=='true'||process.env.WMH_HOSTED_BROWSER!=='1')throw Error('Only the authorized hosted browser runner may execute authoring acceptance');
const root=fileURLToPath(new URL('../',import.meta.url)),git=(...args)=>execFileSync('git',args,{cwd:root,encoding:'utf8'}).trim(),head=git('rev-parse','HEAD');
assert.equal(git('status','--porcelain','--untracked-files=normal'),'','Authoring hosted source must be clean');assert.match(process.env.WMH_SOURCE_SHA||'',/^[a-f0-9]{40}$/);assert.equal(process.env.WMH_SOURCE_SHA,head);assert.ok(process.env.WMH_NATIVE_IMPORT_DRIVER,'Exact-source driver required');
const width=Number(process.env.WMH_VIEWPORT_WIDTH||1280),height=Number(process.env.WMH_VIEWPORT_HEIGHT||720);assert.ok(['1280x720','1280x900','1920x1080'].includes(`${width}x${height}`),'Finite authoring viewport required');
const output=path.resolve(process.env.WMH_ARTIFACT_DIR||path.join(root,'test-results/vsq-authoring',`${width}x${height}`)),binary=path.resolve(process.env.WMH_NATIVE_IMPORT_DRIVER);
const report={version:1,kind:'hosted-browser-real-native-vsq-authoring',viewport:{width,height},source_sha:head,source_tree:git('rev-parse','HEAD^{tree}'),driver_sha256:digest(await readFile(binary)),native_filesystem:true,native_window:false,physical_audio:false,full_checkpoint_acceptance:false,phases:[],ok:false};
let browser,driver,context,page,chooser,consoleObserver,assetServer,origin,nativeBridge;
async function bounded(operation,label,ms=10000){let timer;try{return await Promise.race([operation,new Promise((_,reject)=>timer=setTimeout(()=>reject(Error(`${label} exceeded ${ms}ms`)),ms))]);}finally{clearTimeout(timer);}}
await mkdir(path.join(output,'downloads'),{recursive:true});await prepareVsqAuthoringFixtures(path.join(output,'fixtures'));
try{
 report.asset_server={};assetServer=await startHostedAssetServer({root,sourceSha:head,binary:path.resolve(root,process.env.WMH_SERVER_BINARY||'target/debug/practice-server'),evidence:report.asset_server});origin=assetServer.origin;report.origin=origin;
 const {chromium}=await import('playwright');browser=await chromium.launch({headless:true});
 for(const phase of VSQ_AUTHORING_PHASES){
  const host={phase,ok:false,actions:[],results:[],page_errors:[],api_trace:[]},downloads=[],results=new Map();report.phases.push(host);nativeBridge=createHostedNativeBridge({origin,getOwnedPage:()=>page});host.native_bridge=nativeBridge.evidence;let renderer=null,actionFailure=null,actionPending=false;
  driver=startVsqNativeDriver({binary,directory:path.join(output,'Scores'),cwd:root});host.process_id=driver.pid;context=await browser.newContext({viewport:{width,height},acceptDownloads:true});consoleObserver=createAuthoringHostedConsole({origin});host.console=consoleObserver.evidence;
  const scripts=await Promise.all(['acceptance-wait.js','reference-acceptance.js','vsq-song-acceptance.js','performance-song-acceptance.js','song-authoring-acceptance.js','vsq-authoring-acceptance.js'].map(name=>readFile(path.join(root,'crates/desktop-shell',name),'utf8')));
  for(const index of [2,3,4]){assert.equal(scripts[index].split('(() => {').length,2);scripts[index]=scripts[index].split('(() => {')[0];}await context.addInitScript(`globalThis.__WMH_ACCEPTANCE_PHASE__=${JSON.stringify(phase)};\n${scripts.join('\n')}`);
  async function action(value){try{assert.equal(actionPending,false);actionPending=true;assert.equal(value.sequence,host.actions.length+1);assert.ok(value.sequence<=64);assert.ok(['click','picker','key-r'].includes(value.kind));host.actions.push(value);
   if(value.kind==='picker')await chooser.choose(value,path.join(output,'fixtures'));else{await page.mouse.click(value.x,value.y);if(value.kind==='key-r')await page.keyboard.press('r');}
   await page.screenshot({path:path.join(output,`browser-action-${phase}-${value.sequence}.png`),fullPage:true});results.set(value.sequence,{ok:true,browser_action:true});
  }catch(error){actionFailure=String(error);results.set(value.sequence,{ok:false,error:actionFailure});}finally{host.results.push({sequence:value.sequence,...results.get(value.sequence)});actionPending=false;}}
  await context.route(url=>url.origin===origin&&(url.pathname.startsWith('/api/')||url.pathname.startsWith('/__desktop_smoke/')),async route=>{const request=route.request(),url=new URL(request.url()),name=url.pathname;
   if(name.startsWith('/__desktop_smoke/')){
    if(name==='/__desktop_smoke/action'){const value=request.postDataJSON();await route.fulfill({status:200,json:{}});void action(value);return;}
    if(name==='/__desktop_smoke/state'){await route.fulfill({status:200,json:{phase,downloads}});return;}
    if(name==='/__desktop_smoke/report'){renderer=request.postDataJSON();await writeFile(path.join(output,`renderer-${phase}.json`),JSON.stringify(renderer,null,2)+'\n');await route.fulfill({status:200,json:{}});return;}
    const sequence=Number(name.slice('/__desktop_smoke/result/'.length)),result=results.get(sequence);if(result)await route.fulfill({status:200,json:result});else{const pending=consoleObserver.pendingResponse({sequence,url:request.url(),method:request.method(),owned:actionPending&&host.actions.at(-1)?.sequence===sequence,status:404,body:{error:'pending'}});try{await route.fulfill({status:404,json:{error:'pending'}});pending.finish(true);}catch(error){pending.finish(false);throw error;}}return;
   }
   if(name.startsWith('/api/')){try{await nativeBridge.run(request,async headers=>{assert.ok(host.api_trace.length<256);const row={path:name,status:null};host.api_trace.push(row);const response=await bounded(driver.fetcher(name+url.search,{method:request.method(),headers,body:request.postDataBuffer()||undefined}),`Rust ${name}`);row.status=response.status;const body=await response.bytes();let receipt;if(name==='/api/clean-song/draft'&&response.status===422){const result=JSON.parse(body);receipt=consoleObserver.rejectedResponse({path:name,method:request.method(),status:response.status,source_name:result.source_name,state:result.state,source_sha256:result.source.sha256});}try{await route.fulfill({status:response.status,contentType:response.contentType,body});receipt?.finish(true);}catch(error){receipt?.finish(false);if(!nativeBridge.closing)throw error;row.delivery='context-closed-during-cleanup';}});}catch(error){host.page_errors.push(String(error));try{await route.abort();}catch{}}return;}
   throw Error('Hosted route must not intercept a shipped asset');
  });
  page=await context.newPage();page.setDefaultTimeout(10000);chooser=createAuthoringHostedChooser(page,{pickerFiles:(alias,directory)=>{assert.equal(alias,VSQ_AUTHORING_FIXTURE_FILENAME,'Outside the finite original VSQ authoring picker');return [path.join(directory,VSQ_AUTHORING_FIXTURE_FILENAME)];},onError:error=>{host.page_errors.push(error);actionFailure=error;}});host.chooser_observer=chooser.evidence;page.on('console',message=>consoleObserver.observe(message));page.on('pageerror',error=>host.page_errors.push(String(error)));
  page.on('download',async download=>{const extension=/\.(?:zip|wmhpack)$/.test(download.suggestedFilename())?'zip':'json',row={file:`${phase}-${downloads.length+1}.${extension}`,suggested_name:download.suggestedFilename(),complete:false,success:false};downloads.push(row);try{await download.saveAs(path.join(output,'downloads',row.file));row.success=true;}catch(error){host.page_errors.push(String(error));}finally{row.complete=true;}});
  chooser.navigation('start');await page.goto(origin);chooser.navigation('end');await bounded((async()=>{while(!renderer&&!actionFailure)await new Promise(resolve=>setTimeout(resolve,100));assert.equal(actionFailure,null);})(),`${phase} renderer`,150000);
  assert.deepEqual(host.page_errors,[]);consoleObserver.assertComplete();chooser.assertComplete(host.actions.filter(action=>action.kind==='picker').map(action=>action.sequence));assert.equal(renderer.phase,phase);assert.equal(renderer.actions,host.actions.length);assert.deepEqual(renderer.pickerObservations.map(row=>({sequence:row.sequence,file:row.file})),host.actions.filter(row=>row.kind==='picker').map(row=>({sequence:row.sequence,file:row.file})));validateVsqAuthoringRenderer(renderer,undefined,undefined,origin);assert.deepEqual({width:renderer.layout.width,height:renderer.layout.height},{width,height});validateVsqAuthoringTakes(JSON.parse(await readFile(path.join(output,'downloads',renderer.files.beforeTake))),JSON.parse(await readFile(path.join(output,'downloads',renderer.files.afterTake))),renderer);
  if(phase==='vsq-authoring-seed')assertVsqAuthoringZip(await readFile(path.join(output,'downloads',renderer.files.package)),vsqAuthoringFixture());
  for(const role of vsqAuthoringScreenshotRoles(renderer)){const sequence=renderer.screenshots[role];assert.ok(Number.isSafeInteger(sequence)&&sequence>0&&host.actions[sequence-1]?.kind==='click');validateCleanScreenshot(await readFile(path.join(output,`browser-action-${phase}-${sequence}.png`)));}
  host.renderer=renderer;await page.screenshot({path:path.join(output,`browser-${phase}.png`),fullPage:true});nativeBridge.stopAdmission();await context.close();context=null;await nativeBridge.drain();assert.deepEqual(host.page_errors,[]);consoleObserver.assertComplete();chooser.assertComplete(host.actions.filter(action=>action.kind==='picker').map(action=>action.sequence));chooser.stop();chooser=null;host.ok=true;await bounded(driver.close(),`${phase} close`);driver=null;
 }
 assert.equal(new Set(report.phases.map(phase=>phase.process_id)).size,2,'Fresh native process required');const [seed,restart]=report.phases.map(phase=>phase.renderer);assert.deepEqual(restart.inventory,seed.inventory);assert.deepEqual(restart.opened,seed.opened);await validateAuthoringSavedBytes(path.join(output,'Scores'),seed);report.ok=true;
}catch(error){report.error=error.stack||String(error);process.exitCode=1;try{await page?.screenshot({path:path.join(output,'browser-vsq-authoring-failure.png'),fullPage:true});}catch{}}
finally{
 report.cleanup_errors=[];nativeBridge?.stopAdmission();
 for(const[name,close]of [['context',()=>context?.close()],['native-requests',()=>nativeBridge?.drain()],['console',()=>consoleObserver?.reconcile()],['chooser',()=>chooser?.stop()],['browser',()=>browser?.close()],['driver',()=>driver?.close()],['asset-server',()=>assetServer?.close()]])try{await close();}catch(error){report.cleanup_errors.push({name,error:String(error)});}
 if(report.cleanup_errors.length){report.ok=false;report.error??=`Hosted VSQ authoring cleanup failed: ${JSON.stringify(report.cleanup_errors)}`;}
 if(report.ok)try{validateHostedAssetEvidence(report.asset_server,{origin,sourceSha:head});}catch(error){report.ok=false;report.error=String(error.stack||error);}
 await writeFile(path.join(output,'report.json'),JSON.stringify(report,null,2)+'\n');
}
if(!report.ok)throw Error(report.error);
