// Authorized hosted GitHub Actions only; real Chromium + real Rust stdio.
// The action/report protocol belongs to acceptance, never to the application API.
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {startVsqNativeDriver} from '../tests/vsq-native-driver-fixtures.js';
import {prepareVsqFixtures,vsqAcceptanceFixture,VSQ_FIXTURE_FILENAME} from './prepare-vsq-song-fixtures.mjs';
import {validateVsqRenderer,validateVsqTake,VSQ_PHASES} from './verify-native-vsq-song-evidence.mjs';
import {digest,inspectAuthoredZip,assertCleanExportInventory} from '../tests/clean-song-package-fixtures.js';
if(process.env.GITHUB_ACTIONS!=='true'||process.env.WMH_HOSTED_BROWSER!=='1')throw Error('Only the authorized hosted browser runner may execute VSQ acceptance');
const root=fileURLToPath(new URL('../',import.meta.url)),head=execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim();
assert.match(process.env.WMH_SOURCE_SHA||'',/^[a-f0-9]{40}$/);assert.equal(process.env.WMH_SOURCE_SHA,head,'Exact hosted source SHA required');assert.ok(process.env.WMH_NATIVE_IMPORT_DRIVER,'Exact-source driver required');
const viewportHeight=Number(process.env.WMH_VIEWPORT_HEIGHT||720);assert.ok([720,900].includes(viewportHeight),'VSQ hosted viewport must be 720 or 900 pixels high');
const output=path.resolve(process.env.WMH_ARTIFACT_DIR||path.join(root,'test-results/vsq-song',String(viewportHeight))),origin='https://wmh.localhost',fixture=vsqAcceptanceFixture(),binary=path.resolve(process.env.WMH_NATIVE_IMPORT_DRIVER);
const report={version:1,kind:'hosted-browser-real-native-vsq-package',viewport:{width:1280,height:viewportHeight},source_sha:head,source_tree:execFileSync('git',['rev-parse','HEAD^{tree}'],{cwd:root,encoding:'utf8'}).trim(),native_filesystem:true,native_window:false,physical_audio:false,original_vocal_or_acoustic_fidelity:false,phases:[],ok:false};let browser,driver,context,page;
async function bounded(operation,label,milliseconds=10000){let timer;try{return await Promise.race([operation,new Promise((_,reject)=>timer=setTimeout(()=>reject(Error(`VSQ ${label} exceeded ${milliseconds}ms`)),milliseconds))]);}finally{clearTimeout(timer);}}
await mkdir(path.join(output,'downloads'),{recursive:true});await prepareVsqFixtures(path.join(output,'fixtures'));report.driver_sha256=digest(await readFile(binary));report.fixture=fixture.manifest;
try {
 const {chromium}=await import('playwright');browser=await chromium.launch({headless:true});
 for(const phase of VSQ_PHASES){
  const phaseReport={phase,ok:false,actions:[],results:[],page_errors:[],api_trace:[]},downloads=[],results=new Map();report.phases.push(phaseReport);let renderer=null,actionFailure=null,actionPending=false;
  driver=startVsqNativeDriver({binary,directory:path.join(output,'Scores'),cwd:root});phaseReport.process_id=driver.pid;context=await browser.newContext({viewport:{width:1280,height:viewportHeight},acceptDownloads:true});
  const scripts=await Promise.all(['acceptance-wait.js','reference-acceptance.js','vsq-song-acceptance.js'].map(name=>readFile(path.join(root,'crates/desktop-shell',name),'utf8')));await context.addInitScript(`globalThis.__WMH_ACCEPTANCE_PHASE__=${JSON.stringify(phase)};\n${scripts.join('\n')}`);
  async function action(a){try{
   assert.ok(!actionPending,'Concurrent VSQ browser actions');actionPending=true;assert.equal(a.sequence,phaseReport.actions.length+1);phaseReport.actions.push(a);assert.ok(['click','picker','select-last','key-r'].includes(a.kind));
   if(a.kind==='picker'){assert.equal(a.file,VSQ_FIXTURE_FILENAME);const picker=page.waitForEvent('filechooser',{timeout:10000});await page.mouse.click(a.x,a.y);await(await picker).setFiles(path.join(output,'fixtures',a.file));}
   else{await page.mouse.click(a.x,a.y);if(a.kind==='select-last'){await page.keyboard.press('End');await page.keyboard.press('Enter');}if(a.kind==='key-r')await page.keyboard.press('r');}
   await page.screenshot({path:path.join(output,`browser-action-${phase}-${a.sequence}.png`),fullPage:true});results.set(a.sequence,{ok:true,browser_action:true});
  }catch(error){actionFailure=String(error);results.set(a.sequence,{ok:false,error:actionFailure});}finally{phaseReport.results.push({sequence:a.sequence,...results.get(a.sequence)});actionPending=false;}}
  await context.route(`${origin}/**`,async route=>{const q=route.request(),url=new URL(q.url()),name=url.pathname;
   if(name.startsWith('/__desktop_smoke/')){
    if(name==='/__desktop_smoke/action'){const a=q.postDataJSON();await route.fulfill({status:200,json:{}});void action(a);return;}
    if(name==='/__desktop_smoke/state'){await route.fulfill({status:200,json:{phase,downloads}});return;}
    if(name==='/__desktop_smoke/report'){renderer=q.postDataJSON();await writeFile(path.join(output,`renderer-${phase}.json`),JSON.stringify(renderer,null,2)+'\n');await route.fulfill({status:200,json:{}});return;}
    const sequence=Number(name.slice('/__desktop_smoke/result/'.length)),result=results.get(sequence);await route.fulfill({status:result?200:404,json:result||{error:'pending'}});return;
   }
   if(name.startsWith('/api/')){try{assert.ok(phaseReport.api_trace.length<256,'VSQ hosted API trace bound');const row={path:name,status:null};phaseReport.api_trace.push(row);const response=await bounded(driver.fetcher(name+url.search,{method:q.method(),headers:q.headers(),body:q.postDataBuffer()||undefined}),`native response ${name}`),body=await response.bytes();row.status=response.status;await route.fulfill({status:response.status,contentType:response.contentType,body});}catch(error){phaseReport.page_errors.push(String(error));await route.abort();}return;}
   const file=path.resolve(root,'web','.'+decodeURIComponent(name==='/'?'/index.html':name));if(!file.startsWith(path.join(root,'web')+path.sep)){await route.abort();return;}try{await route.fulfill({status:200,contentType:({'.html':'text/html','.js':'text/javascript','.css':'text/css','.json':'application/json','.svg':'image/svg+xml','.png':'image/png','.woff2':'font/woff2'})[path.extname(file)]||'application/octet-stream',body:await readFile(file)});}catch{await route.fulfill({status:404,body:'Not found'});}
  });
  page=await context.newPage();page.setDefaultTimeout(10000);page.on('pageerror',error=>phaseReport.page_errors.push(String(error)));page.on('download',async download=>{const ext=download.suggestedFilename().endsWith('.zip')?'zip':'json',row={file:`${phase}-${downloads.length+1}.${ext}`,suggested_name:download.suggestedFilename(),complete:false,success:false};downloads.push(row);try{await download.saveAs(path.join(output,'downloads',row.file));row.success=true;}catch(error){phaseReport.page_errors.push(String(error));}finally{row.complete=true;}});
  await page.goto(origin);await bounded((async()=>{while(!renderer&&!actionFailure){await new Promise(resolve=>setTimeout(resolve,100));}assert.equal(actionFailure,null);})(),`${phase} report (see API/action diagnostics)`,120000);assert.deepEqual(phaseReport.page_errors,[]);validateVsqRenderer(renderer,fixture);assert.deepEqual(renderer.pickerObservations.map(row=>row.sequence),phaseReport.actions.filter(action=>action.kind==='picker').map(action=>action.sequence),'VSQ file delegation is not bound to the actual browser picker');validateVsqTake(JSON.parse(await readFile(path.join(output,'downloads',renderer.files.machineTake))),fixture);if(phase==='vsq-seed'){validateVsqTake(JSON.parse(await readFile(path.join(output,'downloads',renderer.files.humanTake))),fixture,{human:true,transport:renderer.transportAdmission});assertCleanExportInventory(inspectAuthoredZip(await readFile(path.join(output,'downloads',renderer.files.package))),fixture,fixture.key);}
  await page.screenshot({path:path.join(output,`browser-${phase}.png`),fullPage:true});phaseReport.ok=true;await context.close();context=null;await bounded(driver.close(),`${phase} native process close`);driver=null;
 }
 assert.equal(new Set(report.phases.map(p=>p.process_id)).size,2,'Hosted VSQ must reopen a fresh native process');report.ok=true;
}catch(error){report.error=error.stack||String(error);process.exitCode=1;try{await page?.screenshot({path:path.join(output,'browser-vsq-failure.png'),fullPage:true});}catch{}}
finally{await context?.close();await browser?.close();await driver?.close();await writeFile(path.join(output,'report.json'),JSON.stringify(report,null,2)+'\n');}
if(!report.ok)throw Error(report.error);
