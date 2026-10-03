// Standalone hosted regression. Never execute this to bypass a local-browser
// denial. Browser-backed storage and a mocked native UI contract are distinct
// from Windows native filesystem acceptance.
import assert from 'node:assert/strict';
import {spawn,execFileSync} from 'node:child_process';
import {createServer} from 'node:net';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {fixture} from '../tests/frontend-fixtures.js';

if(process.env.GITHUB_ACTIONS!=='true'||process.env.WMH_HOSTED_BROWSER!=='1')throw Error('Only an authorized hosted GitHub Actions browser runner may execute this regression.');
const root=fileURLToPath(new URL('../',import.meta.url));
const head=execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim();
if(!/^[0-9a-f]{40}$/.test(process.env.WMH_SOURCE_SHA||'')||process.env.WMH_SOURCE_SHA!==head)throw Error('A verified exact source SHA is required.');
const output=path.resolve(process.env.WMH_ARTIFACT_DIR||path.join(root,'test-results/score-storage'));
await mkdir(output,{recursive:true});
const report={source_sha:head,kind:'hosted-browser-and-native-ui-contract',native_filesystem_acceptance:false,cases:[],source_hashes:{},ok:false};
for(const name of ['web/app.js','web/score-preview.js','web/native-score-storage.js','web/score-storage-model.js','web/score-storage-view.js','web/score-storage-view.css'])report.source_hashes[name]=createHash('sha256').update(await readFile(path.join(root,name))).digest('hex');
const original={...structuredClone(fixture),id:'authored-storage-hosted-exercise',title:'Original storage regression',source:{format:'authored-storage-source-v1',filename:'original-source.txt',content:'\uFEFFOriginal authored source\r\nAAEC/w==\r\n'}};
const raw=`\n${JSON.stringify(original,null,2)}\n`;
let server,browser,serverLog='';
try{
 const reservation=createServer();await new Promise((resolve,reject)=>{reservation.once('error',reject);reservation.listen(0,'127.0.0.1',resolve)});
 const port=reservation.address().port;await new Promise(resolve=>reservation.close(resolve));
 const binary=path.resolve(root,process.env.WMH_SERVER_BINARY||`target/debug/practice-server${process.platform==='win32'?'.exe':''}`);
 server=spawn(binary,['--no-open','--port',String(port)],{cwd:root,stdio:['ignore','pipe','pipe']});for(const stream of [server.stdout,server.stderr])stream.on('data',data=>{serverLog=(serverLog+data).slice(-65536)});
 const origin=`http://127.0.0.1:${port}`;let ready=false;
 for(let i=0;i<120;i++){try{if((await fetch(`${origin}/api/health`)).ok){ready=true;break}}catch{}if(server.exitCode!==null)throw Error(`Server exited: ${serverLog}`);await new Promise(resolve=>setTimeout(resolve,100))}
 assert.equal(ready,true,'Rust server did not become ready');
 const {chromium}=await import('playwright');browser=await chromium.launch({headless:true});
 const context=await browser.newContext({viewport:{width:1280,height:900},acceptDownloads:true}),page=await context.newPage();
 await page.goto(origin);await page.locator('#home-single-player').click();
 await page.locator('#score-file').setInputFiles({name:'original.wmhscore.json',mimeType:'application/json',buffer:Buffer.from(raw)});
 await page.waitForFunction(()=>document.querySelector('[data-score-storage] .score-storage-status')?.dataset.persistence==='saved');
 const saved=page.locator('[data-library-key^="browser:"]').filter({hasText:original.title});await saved.waitFor();
 const identity=await saved.getAttribute('data-library-key');assert.ok(identity.startsWith('browser:'));
 await page.reload();await page.locator('#home-single-player').click();
 const restored=page.locator(`[data-library-key="${identity}"]`);await restored.waitFor();await restored.click();
 await page.waitForFunction(title=>document.querySelector('#preview-title').textContent===title&&!document.querySelector('#start-listen').disabled,original.title);
 await page.locator('#settings-button').click();
 assert.match(await page.locator('[data-score-storage]').textContent(),/IndexedDB/);
 assert.equal(await page.locator('[data-storage-action="choose"]').isDisabled(),true);
 assert.equal(await page.locator('[data-storage-action="open"]').isDisabled(),true);
 const downloadPromise=page.waitForEvent('download');await page.locator('[data-storage-action="backup"]').click();const download=await downloadPromise;
 const backupPath=path.join(output,'authored-browser-backup.json');await download.saveAs(backupPath);const backup=JSON.parse(await readFile(backupPath,'utf8'));
 assert.equal(backup.format,'worldmusichub-library-backup');assert.deepEqual(backup.entries.map(entry=>entry.score),[original]);
 await page.screenshot({path:path.join(output,'browser-storage-reload-backup.png'),fullPage:true});
 report.cases.push({name:'real-rust-browser-import-reload-backup',ok:true,identity,source_unchanged:true});await context.close();

 const nativeContext=await browser.newContext({viewport:{width:1280,height:900}}),nativePage=await nativeContext.newPage();let saveCalls=0;
 const fulfill=(route,value,status=200)=>route.fulfill({status,contentType:'application/json',body:JSON.stringify(value)});
 await nativePage.route('**/api/health',route=>fulfill(route,{name:'WorldMusicHub',engine:'rust',network:'native-protocol-no-listener',score_format_version:1}));
 await nativePage.route('**/api/library/list',route=>fulfill(route,{storage:'native-filesystem',library_format_version:1,directory:'C:\\AuthoredHostedContract\\Scores',entries:[],issues:[]}));
 await nativePage.route('**/api/library/save',route=>{saveCalls++;assert.equal(route.request().postDataJSON().score_json,raw);return fulfill(route,{code:'library_io',error:'Authored fixture: native disk save failed'},500)});
 await nativePage.goto(origin);await nativePage.locator('#home-single-player').click();
 await nativePage.locator('#score-file').setInputFiles({name:'original.wmhscore.json',mimeType:'application/json',buffer:Buffer.from(raw)});
 await nativePage.waitForFunction(()=>document.querySelector('[data-score-storage] .score-storage-status')?.dataset.persistence==='not-saved');
 assert.equal(saveCalls,1);assert.equal(await nativePage.locator('#score-title').textContent(),original.title);
 assert.match(await nativePage.locator('#notice-message').textContent(),/尚未保存|not saved/);
 assert.equal(await nativePage.locator('[data-library-key]').count(),0);
 const scoreDatabases=await nativePage.evaluate(async()=>typeof indexedDB.databases==='function'?(await indexedDB.databases()).filter(db=>db.name==='worldmusichub.scores.v1'):null);
 assert.deepEqual(scoreDatabases,[],'Native save failure must not open or write browser score storage');
 await nativePage.locator('#settings-button').click();await nativePage.screenshot({path:path.join(output,'mock-native-save-failure.png'),fullPage:true});
 report.cases.push({name:'mock-native-failure-retains-usable-import-without-idb-fallback',ok:true,save_calls:saveCalls,native_filesystem_test:false});await nativeContext.close();
 report.ok=true;
}catch(error){report.error=error.stack||String(error);process.exitCode=1}
finally{await browser?.close();server?.kill();await writeFile(path.join(output,'report.json'),JSON.stringify(report,null,2)+'\n');await writeFile(path.join(output,'server.log'),serverLog)}
if(!report.ok)throw Error(report.error);
