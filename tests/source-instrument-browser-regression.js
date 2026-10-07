/** Registered by full-app-browser: unchanged real Rust responses, visible controls only. */
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {selectLegacyEnglish} from './browser-input-fixtures.js';
import {openSongMod} from '../scripts/hosted-song-mod-controls.mjs';
const hash=value=>createHash('sha256').update(value).digest('hex');
const deferred=()=>{let resolve;const promise=new Promise(yes=>{resolve=yes;});return{promise,resolve};};
// Self-authored CC0 SMF: named track/instrument, explicit program, two attacks.
// No fabricated Rust DTO, private music or General MIDI instrument inference.
function midi(name,program){const text=Buffer.from(name),events=Buffer.from([0,255,3,text.length,...text,0,255,4,text.length,...text,0,192,program,0,144,60,90,131,0,128,60,0,0,144,64,90,131,0,128,64,0,0,255,47,0]);const header=Buffer.alloc(14);header.write('MThd');header.writeUInt32BE(6,4);header.writeUInt16BE(0,8);header.writeUInt16BE(1,10);header.writeUInt16BE(384,12);const track=Buffer.alloc(8);track.write('MTrk');track.writeUInt32BE(events.length,4);return Buffer.concat([header,track,events]);}
async function original(origin,name,program){const bytes=midi(name,program),response=await fetch(`${origin}/api/import/midi`,{method:'POST',headers:{'Content-Type':'audio/midi'},body:bytes});assert.equal(response.status,200);const result=await response.json();assert.ok(result.score);result.score.title=name;return{score:result.score,sha256:hash(bytes)};}
async function importScore(page,score){await page.locator('#import-tools-button').click();await page.locator('#score-file').setInputFiles({name:score.id+'.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(score))});await page.waitForFunction(title=>document.querySelector('#preview-title')?.textContent===title&&!document.querySelector('#configure-song-mod')?.disabled&&document.querySelector('.score-storage-status')?.dataset.persistence==='saved',score.title);await page.locator('#import-tools-dialog [data-close-panel]').click();}
async function detailText(page){return page.locator('.song-mod-source-details dl').allTextContents();}
async function assertDetails(page,name,program){await page.waitForFunction(name=>[...document.querySelectorAll('.song-mod-source-details dl')].some(node=>node.textContent.includes(name)),name);const rows=await detailText(page);assert.equal(rows.length,1);assert.ok(rows[0].includes(name));assert.match(rows[0],new RegExp(`${program} / Unknown / Unknown`));assert.match(rows[0],/60–64/);assert.match(rows[0],/2 \/ 2/);assert.equal(await page.locator('[data-mod-live-instrument]').count(),0);assert.equal(await page.locator('[data-mod-liveInstrument]').count(),0);assert.equal(await page.locator('#song-mod-unify-sound').count(),0);assert.match(await page.locator('.song-mod-source-details summary').innerText(),/not identified/);return rows;}

export function registerSourceInstrumentBrowserRegression({test,getPage,getOrigin,closeShellPanels,artifactDirectory,binary}){
test('real source details reject late source switches and survive pitch Mod and saved-source reload without a live column',{timeout:90000},async()=>{
 const page=getPage(),origin=getOrigin(),artifacts=artifactDirectory,errors=[],requests=[],exchanges=[],held=deferred(),captured=deferred();page.on('pageerror',error=>errors.push(error.message));
 await closeShellPanels();if(await page.locator('#workspace').isVisible())await page.locator('#back-to-library').click();
 const report={version:1,ok:false,source:{sha:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),server_sha256:hash(readFileSync(binary))},original_fixtures_only:true,physical_audio_verified:false,physical_midi_verified:false,windows_native_verified:false,accepted_package:false};
 if(process.env.WMH_SOURCE_SHA)assert.equal(report.source.sha,process.env.WMH_SOURCE_SHA,'Hosted run must name exact source');
 const a=await original(origin,'Authored metadata A',0),b=await original(origin,'Authored metadata B',40);report.fixtures=[{title:a.score.title,midi_sha256:a.sha256},{title:b.score.title,midi_sha256:b.sha256}];
 let heldOnce=false;
 await page.route('**/api/source-instrument-details/canonical',async route=>{const request=route.request(),body=request.postDataJSON();requests.push(body);const response=await route.fetch(),json=await response.json();exchanges.push({request:body,httpStatus:response.status(),response:json});assert.equal(response.status(),200);assert.equal(json.request_sha256,hash(request.postData()));if(!heldOnce&&body.source.content===a.score.source.content){heldOnce=true;captured.resolve();await held.promise;}await route.fulfill({response});});
 try{
  await importScore(page,a.score);await captured.promise;await openSongMod(page);assert.match((await detailText(page)).join(' '),/Loading/);await page.locator('#song-mod-cancel').click();
  await importScore(page,b.score);await openSongMod(page);report.beforePitch=await assertDetails(page,b.score.title,40);await page.locator('.song-mod-source-details summary').click();const late=page.waitForResponse(response=>new URL(response.url()).pathname==='/api/source-instrument-details/canonical'&&response.request().postDataJSON().source.content===a.score.source.content);held.resolve();await late;await page.evaluate(()=>new Promise(yes=>requestAnimationFrame(()=>requestAnimationFrame(yes))));assert.deepEqual(await detailText(page),report.beforePitch);assert.ok(!(await detailText(page)).join(' ').includes(a.score.title));
  await page.screenshot({path:join(artifacts,'source-instrument-details-before-pitch.png')});
  await page.locator('#song-mod-pitch-shift').fill('2');await page.locator('#song-mod-pitch-check').click();await page.waitForFunction(()=>document.querySelector('#song-mod-pitch-status')?.dataset.pitchModStatus==='checked');await page.locator('#song-mod-apply').click();await page.locator('#song-mod-dialog').waitFor({state:'hidden'});await openSongMod(page);report.afterPitch=await assertDetails(page,b.score.title,40);assert.deepEqual(report.afterPitch,report.beforePitch);await page.locator('#song-mod-cancel').click();
  await page.reload({waitUntil:'domcontentloaded'});await selectLegacyEnglish(page);await page.locator('#home-single-player').click();const saved=page.locator('#catalog [data-library-key]').filter({hasText:b.score.title});await saved.first().click();await openSongMod(page);report.afterReload=await assertDetails(page,b.score.title,40);assert.deepEqual(report.afterReload,report.beforePitch);assert.equal(await page.locator('#song-mod-pitch-shift').inputValue(),'2');
  for(const body of requests){assert.deepEqual(body,body.source.content===a.score.source.content?a.score:b.score,'Metadata endpoint receives only the unchanged original score');}
  await page.locator('.song-mod-source-details summary').click();await page.screenshot({path:join(artifacts,'source-instrument-details-after-reload.png')});assert.deepEqual(errors,[]);report.ok=true;
 }finally{held.resolve();report.requests=requests;report.exchanges=exchanges;report.pageErrors=errors;await writeFile(join(artifacts,'source-instrument-details-browser.json'),JSON.stringify(report,null,2));await page.unroute('**/api/source-instrument-details/canonical');}
});

}
