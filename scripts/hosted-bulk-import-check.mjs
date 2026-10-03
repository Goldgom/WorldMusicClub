// Authorized hosted browser only. A real native Rust backend runs over stdin;
// no mocked save responses and no private score content enter this evidence.
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {authoredLegacyPack,startNativeImportDriver} from '../tests/native-import-driver-fixtures.js';

if(process.env.GITHUB_ACTIONS!=='true'||process.env.WMH_HOSTED_BROWSER!=='1')throw Error('Only an authorized hosted GitHub Actions browser runner may execute this regression.');
const root=fileURLToPath(new URL('../',import.meta.url)),head=execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim();
if(!/^[0-9a-f]{40}$/.test(process.env.WMH_SOURCE_SHA||'')||process.env.WMH_SOURCE_SHA!==head)throw Error('A verified exact source SHA is required.');
if(!process.env.WMH_NATIVE_IMPORT_DRIVER)throw Error('Build native_import_driver for this exact source and set WMH_NATIVE_IMPORT_DRIVER.');
const output=path.resolve(process.env.WMH_ARTIFACT_DIR||path.join(root,'test-results/bulk-import'));await mkdir(output,{recursive:true});
const library=path.join(output,'authored-library'),fixture=authoredLegacyPack(),origin='https://wmh.localhost',report={source_sha:head,kind:'hosted-browser-real-native-stdin',native_filesystem:true,native_window:false,cases:[],screenshots:[],ok:false};
let browser,driver;
try{
 const binary=path.resolve(process.env.WMH_NATIVE_IMPORT_DRIVER);report.driver_sha256=createHash('sha256').update(await readFile(binary)).digest('hex');
 for(const name of ['web/app.js','web/bulk-import.js','web/bulk-import-view.js','web/bulk-import-view.css','tests/native-import-driver-fixtures.js']){report.source_hashes??={};report.source_hashes[name]=createHash('sha256').update(await readFile(path.join(root,name))).digest('hex')}
 const {chromium}=await import('playwright');browser=await chromium.launch({headless:true});
 async function launch(){
  driver=startNativeImportDriver({binary,directory:library,cwd:root});
  const context=await browser.newContext({viewport:{width:1365,height:900},acceptDownloads:true});
  await context.route(`${origin}/**`,async route=>{
   const request=route.request(),url=new URL(request.url());
   if(url.pathname.startsWith('/api/')){const response=await driver.fetcher(url.pathname+url.search,{method:request.method(),headers:request.headers(),body:request.postDataBuffer()||undefined});await route.fulfill({status:response.status,contentType:response.contentType,body:await response.bytes()});return}
   const relative=decodeURIComponent(url.pathname==='/'?'/index.html':url.pathname),file=path.resolve(root,'web',`.${relative}`);if(!file.startsWith(path.join(root,'web')+path.sep)){await route.abort();return}
   try{const body=await readFile(file),type=({'.html':'text/html','.js':'text/javascript','.css':'text/css','.json':'application/json','.svg':'image/svg+xml','.png':'image/png','.woff2':'font/woff2'})[path.extname(file)]||'application/octet-stream';await route.fulfill({status:200,contentType:type,body})}catch{await route.fulfill({status:404,body:'Not found'})}
  });
  const page=await context.newPage();await page.goto(origin);await page.locator('#home-single-player').click();await page.locator('#start-listen').waitFor({state:'visible'});return{context,page};
 }
 let {context,page}=await launch();
 await page.locator('#start-listen').click();await page.waitForFunction(()=>document.body.dataset.screen==='stage'&&!document.querySelector('#play-button').disabled);await page.locator('#back-to-library').click();const activeTitle=await page.locator('#score-title').textContent(),preview=await page.locator('#song-lobby').getAttribute('data-preview-id');
 await page.locator('#import-tools-button').click();
 assert.equal(await page.locator('#score-file').getAttribute('multiple'),'');
 const picker=page.waitForEvent('filechooser');await page.locator('#import-button').click();await(await picker).setFiles({name:fixture.filename,mimeType:'application/zip',buffer:fixture.bytes});
 await page.waitForFunction(()=>document.querySelector('#bulk-import-dialog')?.dataset.phase==='review'&&document.querySelectorAll('.bulk-import-song').length===3);
 assert.equal(await page.locator('#catalog [data-library-key]').count(),0);assert.equal(await page.locator('[data-status="retained_nonplayable"]').count(),1);assert.equal(await page.locator('#score-title').textContent(),activeTitle);
 await page.screenshot({path:path.join(output,'native-pack-preflight-zh.png'),fullPage:true});report.screenshots.push('native-pack-preflight-zh.png');
 await page.locator('#bulk-import-save').click();await page.waitForFunction(()=>document.querySelector('#bulk-import-dialog')?.dataset.phase==='review'&&document.querySelectorAll('#catalog [data-library-key]').length===2);
 assert.equal(await page.locator('#score-title').textContent(),activeTitle);assert.equal(await page.locator('#song-lobby').getAttribute('data-preview-id'),preview);assert.equal(await page.locator('[data-status="retained_nonplayable"] [data-import-browse]').isVisible(),false);
 await page.locator('#bulk-import-history').evaluate(node=>{node.open=true});await page.locator('[data-import-archive]').first().waitFor();
 const originalDownload=page.waitForEvent('download');await page.locator('[data-import-archive]').first().click();const original=await originalDownload,originalPath=path.join(output,'authored-original.zip');await original.saveAs(originalPath);assert.deepEqual(await readFile(originalPath),fixture.bytes);
 await page.locator('#bulk-import-export-all').click();const packDownload=page.waitForEvent('download');await page.locator('#bulk-import-export-pack').click();const pack=await packDownload,packPath=path.join(output,'authored-unified-pack.zip');await pack.saveAs(packPath);assert.ok((await readFile(packPath)).length>0);
 await page.screenshot({path:path.join(output,'native-pack-saved-originals-zh.png'),fullPage:true});report.screenshots.push('native-pack-saved-originals-zh.png');
 report.cases.push({name:'actual-file-picker-unicode-zip-preflight-save-original-export',saved:2,retained_nonplayable:1,original_sha256:createHash('sha256').update(fixture.bytes).digest('hex'),ok:true});
 await page.locator('#bulk-import-done').click();await page.locator('#settings-button').click();await page.locator('#interface-language').selectOption('en');await page.locator('#settings-dialog .shell-dialog-heading button').click();
 await page.locator('#import-tools-button').click();const unifiedPicker=page.waitForEvent('filechooser');await page.locator('#import-button').click();await(await unifiedPicker).setFiles(packPath);await page.waitForFunction(()=>document.querySelector('#bulk-import-dialog').dataset.phase==='review'&&document.querySelectorAll('.bulk-import-song').length===2);await page.locator('#bulk-import-save').click();await page.waitForFunction(()=>document.querySelector('#bulk-import-dialog').dataset.phase==='review'&&document.querySelectorAll('[data-status="duplicate"]').length===2);assert.equal(await page.locator('#catalog [data-library-key]').count(),2);
 await page.screenshot({path:path.join(output,'unified-pack-roundtrip-en.png'),fullPage:true});report.screenshots.push('unified-pack-roundtrip-en.png');report.cases.push({name:'unified-pack-export-reimport-deduplication',ok:true});
 await context.close();await driver.close();driver=null;({context,page}=await launch());await page.waitForFunction(()=>document.querySelectorAll('#catalog [data-library-key]').length===2);await page.locator('#catalog [data-library-key]').first().click();await page.waitForFunction(()=>!document.querySelector('#start-listen').disabled);await page.locator('#import-tools-button').click();await page.locator('#bulk-import-history-button').click();await page.locator('#bulk-import-history').evaluate(node=>{node.open=true});await page.locator('[data-import-archive]').first().waitFor();await page.screenshot({path:path.join(output,'native-pack-fresh-profile-restart.png'),fullPage:true});report.screenshots.push('native-pack-fresh-profile-restart.png');report.cases.push({name:'fresh-native-process-and-browser-profile-restart',saved:2,ok:true});await context.close();
 report.ok=true;
}catch(error){report.error=error.stack||String(error);process.exitCode=1}
finally{await browser?.close();await driver?.close();await writeFile(path.join(output,'report.json'),JSON.stringify(report,null,2)+'\n')}
if(!report.ok)throw Error(report.error);
