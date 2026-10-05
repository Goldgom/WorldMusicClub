import {configureSongMod,startSongModPerformance} from './hosted-song-mod-controls.mjs';
import {installPlaybackClockReader,readPlaybackClock, waitForPlaybackClock} from '../tests/browser-playback-clock.js';
// Execute only on the explicitly authorized hosted runner. No local browser or
// server launch is permitted. Fixtures below are authored here, never uploads
// from the user's music collection. Screenshots are required evidence.
import assert from 'node:assert/strict';
import {spawn,execFileSync} from 'node:child_process';
import {createServer} from 'node:net';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {originalMultipartNotation} from '../tests/notation-scope-fixtures.js';
import {validateCleanScreenshot} from './verify-native-clean-song-evidence.mjs';

if(process.env.GITHUB_ACTIONS!=='true'||process.env.WMH_HOSTED_BROWSER!=='1')throw Error('Notation layout browser checks require the authorized hosted Actions runner.');
const root=fileURLToPath(new URL('../',import.meta.url)),sha=execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim();
assert.match(process.env.WMH_SOURCE_SHA||'',/^[a-f0-9]{40}$/);assert.equal(process.env.WMH_SOURCE_SHA,sha);assert.equal(execFileSync('git',['status','--porcelain','--untracked-files=normal'],{cwd:root,encoding:'utf8'}).trim(),'','Hosted notation source must be clean');
const output=path.resolve(process.env.WMH_ARTIFACT_DIR||path.join(root,'test-results/notation-scope')),score=originalMultipartNotation(),raw=JSON.stringify(score);
await mkdir(output,{recursive:true});
const baseline=process.env.WMH_NOTATION_BASELINE==='1';
const binary=path.resolve(root,process.env.WMH_SERVER_BINARY||'target/debug/practice-server'),binaryBytes=await readFile(binary),digest=bytes=>createHash('sha256').update(bytes).digest('hex');
const report={version:1,source_sha:sha,source_tree:execFileSync('git',['rev-parse','HEAD^{tree}'],{cwd:root,encoding:'utf8'}).trim(),server_sha256:digest(binaryBytes),server_bytes:binaryBytes.length,rights:'original_authored_CC0-1.0',fixture_sha256:createHash('sha256').update(raw).digest('hex'),kind:baseline?'baseline-reproduction':'hosted-layout-acceptance',screenshots:[],artifacts:[],cases:[],page_errors:[],navigation:[],ok:false};
let browser,server,serverLog='',page;const navigationReads=[];
const screenshot=async name=>{const filename=`${name}.png`;await page.screenshot({path:path.join(output,filename),fullPage:true});const bytes=await readFile(path.join(output,filename));validateCleanScreenshot(bytes);report.screenshots.push(filename);report.artifacts.push({path:filename,bytes:bytes.length,sha256:digest(bytes)});};
const controls=async open=>{if(await page.locator('#notation-toggle').getAttribute('aria-expanded')!=='true')await page.locator('#notation-toggle').click();const tools=page.locator('#notation-tools');if(await tools.evaluate(node=>node.open)!==open)await tools.locator('summary').first().click();};
async function selectVisibleNotationPageSize(value){
  const control=page.locator('#engraving-page-size'),details=control.locator('xpath=ancestor::details[1]');
  assert.equal(await details.count(),1,'Page-size control must have its real disclosure');
  const wasOpen=await details.evaluate(node=>node.open);
  if(!wasOpen)await details.locator('summary').first().click();
  await control.waitFor({state:'visible'});await control.selectOption(value);
  if(!wasOpen)await details.locator('summary').first().click();
}
const settle=()=>page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
const waitPaint=(ids,mode)=>page.waitForFunction(({ids,mode})=>{const stage=document.getElementById('workspace'),root=document.getElementById(mode==='staff'?'engraved-staff':'notation');return stage.dataset.notationRenderStatus==='ready'&&stage.dataset.renderedNotationParts===JSON.stringify(ids)&&Boolean(root.querySelector(mode==='staff'?'.vf-notehead':'.jianpu-note'));},{ids,mode});
const performanceState=()=>page.evaluate(()=>({practicePart:document.getElementById('practice-part').value,humanTarget:document.getElementById('clean-song-target')?.value||null,
  soundMuted:document.getElementById('sound-button').getAttribute('aria-pressed'),scope:document.getElementById('practice-scope').textContent,
  mix:[...document.querySelectorAll('#clean-song-parts input')].map(input=>({partId:input.dataset.partId,checked:input.checked})),
  solos:[...document.querySelectorAll('[data-solo-part]')].map(input=>({partId:input.dataset.soloPart,checked:input.checked,pressed:input.getAttribute('aria-pressed')}))}));
async function geometry(mode) {
  return page.evaluate(mode=>{
    const rect=node=>{const r=node.getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height,right:r.right,bottom:r.bottom};};
    const overlay=document.getElementById('notation-lane-overlay'),surface=document.getElementById(mode==='staff'?'engraved-staff':'notation'),keyboard=document.getElementById('keyboard'),bounds=rect(overlay);
    const glyphs=[...surface.querySelectorAll(mode==='staff'?'.vf-notehead':'.jianpu-note')].map(node=>({bounds:rect(node),font:parseFloat(getComputedStyle(node).fontSize)}));
    const key=keyboard.querySelector('[data-midi="60"]'),keyBounds=rect(key),hit=document.elementFromPoint(keyBounds.x+keyBounds.width/2,keyBounds.bottom-12);
    const visible=glyphs.filter(glyph=>glyph.bounds.bottom>bounds.y&&glyph.bounds.y<bounds.bottom&&glyph.bounds.right>bounds.x&&glyph.bounds.x<bounds.right);
    return {viewport:{width:innerWidth,height:innerHeight},overlay:bounds,keyboard:rect(keyboard),scrollTop:overlay.scrollTop,scrollHeight:overlay.scrollHeight,clientHeight:overlay.clientHeight,
      fit:overlay.dataset.notationFit,scale:Number(overlay.dataset.notationScale||1),glyphs,visibleGlyphs:visible.length,keyboardReachable:hit===key||key.contains(hit),keyboardHit:{keyBounds,point:{x:keyBounds.x+keyBounds.width/2,y:keyBounds.bottom-12},target:hit?.id||hit?.className||hit?.tagName||null},
      renderedParts:document.getElementById('notation-scope-status')?.parentElement.dataset.renderedParts,totalParts:document.getElementById('notation-scope-status')?.parentElement.dataset.totalParts,
      renderStatus:document.getElementById('workspace').dataset.notationRenderStatus,renderedIds:JSON.parse(document.getElementById('workspace').dataset.renderedNotationParts||'[]'),range:document.getElementById('engraving-range').textContent,focusedIds:JSON.parse(document.getElementById('written-cursor-status').dataset.sourceNoteIds||'[]'),sourceMeasure:document.getElementById('written-cursor-status').dataset.sourceMeasureIndex,
      scope:document.getElementById('notation-scope')?.value,status:document.getElementById('notation-scope-status')?.textContent,progress:globalThis.__wmhReadPlaybackClock().positionMs,
      horizontalDocumentOverflow:document.documentElement.scrollWidth>innerWidth+1,sourceIds:[...surface.querySelectorAll('[data-note-id],[data-source-note-id]')].map(node=>node.dataset.noteId||node.dataset.sourceNoteId)};
  },mode);
}
function checkParts(value,ids){assert.equal(value.renderStatus,'ready');assert.deepEqual(value.renderedIds,ids);assert.equal(Number(value.renderedParts),ids.length);const sourceParts=new Map(score.parts.flatMap(part=>part.notes.map(note=>[note.id,part.id])));assert.ok(value.sourceIds.length>0,'Painted glyph bindings must expose original note IDs');const painted=[...new Set(value.sourceIds.map(id=>{assert.ok(sourceParts.has(id),'Unknown painted source ID');return sourceParts.get(id);}))];assert.deepEqual(painted.sort(),[...ids].sort(),'Every requested part must have actual source-bound paint');}
function checkGeometry(value,mode) {
  report.last_geometry={mode,value};
  assert.ok(value.glyphs.length>0&&value.visibleGlyphs>0,'Actual visible notation glyphs are required');
  assert.ok(value.overlay.bottom<=value.keyboard.y+1,'Notation must stop before the keyboard');assert.equal(value.keyboardReachable,true,'Score paint/options must not intercept keys');
  assert.equal(value.horizontalDocumentOverflow,false);assert.ok(value.scale>=.75);
  if(mode==='staff')assert.ok(value.glyphs.every(glyph=>glyph.bounds.height>=6.9),'Staff noteheads retain readable height');
  else assert.ok(value.glyphs.every(glyph=>glyph.font*value.scale>=17.9),'Jianpu digits retain readable size');
  if(value.fit==='scroll')assert.ok(value.scrollHeight>value.clientHeight+1||value.glyphs.some(glyph=>glyph.bounds.right>value.overlay.right),'Overflow must remain reachable');
}
try {
  const reservation=createServer();await new Promise((resolve,reject)=>{reservation.once('error',reject);reservation.listen(0,'127.0.0.1',resolve);});const port=reservation.address().port;await new Promise(resolve=>reservation.close(resolve));
  server=spawn(binary,['--no-open','--port',String(port)],{cwd:root,stdio:['ignore','pipe','pipe']});
  for(const stream of [server.stdout,server.stderr])stream.on('data',data=>{serverLog=(serverLog+data).slice(-65536);});
  const origin=`http://127.0.0.1:${port}`;let ready=false;for(let count=0;count<120;count++){try{if((await fetch(`${origin}/api/health`)).ok){ready=true;break;}}catch{}if(server.exitCode!==null)throw Error(serverLog);await new Promise(resolve=>setTimeout(resolve,100));}assert.ok(ready);
  const {chromium}=await import('playwright');browser=await chromium.launch({headless:true});const context=await browser.newContext({viewport:{width:1280,height:720}});page=await context.newPage();await installPlaybackClockReader(page);page.on('pageerror',error=>report.page_errors.push(error.message));page.on('response',response=>{if(new URL(response.url()).pathname==='/api/notation-navigation')navigationReads.push((async()=>{assert.equal(response.status(),200);const request=response.request().postDataJSON(),body=await response.json();assert.deepEqual(request,score);assert.equal(body.source_measure_count,24);report.navigation.push(body);})().catch(error=>report.page_errors.push(error.stack||String(error))));});
  await page.addInitScript(()=>localStorage.setItem('worldmusichub.locale.v1','en'));
  await page.goto(origin);await waitForPlaybackClock(page);await page.locator('#home-single-player').click();await page.locator('#score-file').setInputFiles({name:'original-multipart.wmhscore.json',mimeType:'application/json',buffer:Buffer.from(raw)});
  await page.waitForFunction(title=>document.getElementById('score-title').textContent===title,score.title);
  // Imported scores open directly; retain the real app navigation in either
  // supported lobby/direct-import flow rather than replacing page DOM.
  if(await page.locator('#song-lobby').isVisible())await startSongModPerformance(page,{performers:'none'});
  else await configureSongMod(page,{origin:'stage',restore:true,performers:'none',layout:'solo',showOtherParts:true});
  await page.waitForFunction(()=>document.body.dataset.screen==='stage');if((await page.locator('#progress').evaluate(readPlaybackClock)).running)await page.locator('#play-button').click();
  await controls(true);
  const originalPerformanceState=await performanceState();
  for(const [width,height]of [[1280,720],[1440,900],[1920,1080]])for(const mode of ['staff','jianpu']) {
    await page.setViewportSize({width,height});await controls(true);await page.locator(mode==='staff'?'#engraved-button':'#jianpu-button').click();
    if(baseline){await page.locator(mode==='staff'?'#engraving-part':'#notation-part').selectOption('');}
    else {await page.locator('#notation-scope').selectOption('all');await waitPaint(score.parts.slice(0,4).map(part=>part.id),mode);}
    await page.waitForFunction(mode=>Boolean(document.querySelector(mode==='staff'?'#engraved-staff .vf-notehead':'#notation .jianpu-note')),mode);await controls(false);await settle();
    const value=await geometry(mode);await screenshot(`${height}-${mode}-all-first`);
    if(baseline){assert.ok(value.scrollHeight>value.clientHeight);report.cases.push({name:`${height}-${mode}-baseline-clipping`,geometry:value});continue;}
    checkGeometry(value,mode);assert.equal(Number(value.totalParts),12);checkParts(value,score.parts.slice(0,4).map(part=>part.id));
    await controls(true);const before=value.scrollTop;await page.locator('#notation-pan-down').click();await controls(false);await settle();const scrolled=await geometry(mode);if(value.scrollHeight>value.clientHeight+1)assert.ok(scrolled.scrollTop>before);await screenshot(`${height}-${mode}-all-scrolled`);
    const batches=[value];let partPages=1;for(let first=4;first<12;first+=4){await controls(true);assert.equal(await page.locator('#notation-parts-next').isDisabled(),false);await page.locator('#notation-parts-next').click();await waitPaint(score.parts.slice(first,first+4).map(part=>part.id),mode);await controls(false);await settle();const batch=await geometry(mode);checkGeometry(batch,mode);checkParts(batch,score.parts.slice(first,first+4).map(part=>part.id));batches.push(batch);partPages++;await screenshot(`${height}-${mode}-all-${first===8?'last':'middle'}`);}assert.equal(await page.locator('#notation-parts-next').isDisabled(),true);const last=batches.at(-1);assert.equal(new Set(batches.flatMap(batch=>batch.renderedIds)).size,12);
    report.cases.push({name:`${height}-${mode}-all`,first:value,scrolled,last,batches,partPages});
    assert.deepEqual(await performanceState(),originalPerformanceState,'View changes must not change audio mix or human performance targets');
  }
  if(!baseline) {
    await page.setViewportSize({width:1280,height:720});await controls(true);await page.locator('#notation-scope').selectOption('part');await page.locator('#notation-scope-part').selectOption(score.parts[10].id);await waitPaint([score.parts[10].id],'jianpu');await controls(false);await settle();
    const selected=await geometry('jianpu');checkParts(selected,[score.parts[10].id]);await screenshot('selected-part-11');
    assert.deepEqual(await performanceState(),originalPerformanceState,'Selecting a displayed part must not change the audio mix or human target');
    // Browser CSS zoom exercises layout/reveal resize without modifying music.
    await page.evaluate(()=>{document.documentElement.style.zoom='1.25';dispatchEvent(new Event('resize'));});await settle();checkGeometry(await geometry('jianpu'),'jianpu');await screenshot('jianpu-125-percent-zoom');await page.evaluate(()=>{document.documentElement.style.zoom='';dispatchEvent(new Event('resize'));});
    await controls(true);await page.locator('#notation-scope').selectOption('current');await controls(false);await settle();
    await configureSongMod(page,{origin:'stage',restore:true,performers:[score.parts[10].id],layout:'solo',showOtherParts:true});await page.locator('#settings-button').click();await page.locator('#count-in').uncheck();await page.locator('[data-close-panel="settings"]').click();await waitPaint([score.parts[10].id],'jianpu');await settle();
    const current=await geometry('jianpu');checkParts(current,[score.parts[10].id]);assert.ok(current.status.includes(score.parts[10].name));
    await configureSongMod(page,{origin:'stage',restore:true,performers:[score.parts[11].id],layout:'solo',showOtherParts:true});await waitPaint([score.parts[11].id],'jianpu');await settle();
    const changed=await geometry('jianpu');assert.ok(changed.status.includes(score.parts[11].name));checkParts(changed,[score.parts[11].id]);await screenshot('current-part-changed-to-12');
    // Follow a held original note into the next one-bar staff page. The clock
    // advances normally; changing score layout does not seek or rewrite it.
    await controls(true);await page.locator('#engraved-button').click();await selectVisibleNotationPageSize('1');await waitPaint([score.parts[11].id],'staff');await page.locator('#engraving-follow').check();await controls(false);await page.locator('#reset-button').click();await page.locator('#play-button').click();
    await page.waitForFunction(()=>{const ids=JSON.parse(document.getElementById('written-cursor-status').dataset.sourceNoteIds||'[]');return document.getElementById('workspace').dataset.notationRenderStatus==='ready'&&Number(document.getElementById('written-cursor-status').dataset.sourceMeasureIndex)===1&&ids.includes('original-held-12')&&Number(document.getElementById('engraving-range').textContent.match(/\d+/)?.[0])===2;},{},{timeout:15000});
    await page.locator('#play-button').click();await settle();const crossed=await geometry('staff');checkGeometry(crossed,'staff');checkParts(crossed,[score.parts[11].id]);await Promise.all(navigationReads);const occurrence=report.navigation.at(-1)?.occurrences.find(row=>row.source_measure_index===1);assert.ok(occurrence&&occurrence.continuing_note_ids.includes('original-held-12'));assert.ok(crossed.progress>=occurrence.start_ms&&crossed.progress<occurrence.end_ms,'Real playback must cross the native first measure boundary');assert.equal(crossed.sourceMeasure,'1');assert.ok(crossed.focusedIds.includes('original-held-12'));assert.match(crossed.range,/Measures 2–2 /);await screenshot('held-note-follow-page-boundary');
    report.cases.push({name:'selected-current-zoom-and-held-page',selected,current,changed,crossed});
  }
  await Promise.all(navigationReads);assert.deepEqual(report.page_errors,[]);assert.ok(report.screenshots.length>=6);if(!baseline)assert.equal(report.cases.length,7);for(const artifact of report.artifacts){const bytes=await readFile(path.join(output,artifact.path));assert.equal(bytes.length,artifact.bytes);assert.equal(digest(bytes),artifact.sha256);}assert.equal(digest(await readFile(binary)),report.server_sha256);report.ok=true;
}catch(error){report.error=error.stack||String(error);process.exitCode=1;if(page)try{await screenshot('failure');}catch{}}
finally{await browser?.close();server?.kill();await writeFile(path.join(output,'report.json'),JSON.stringify(report,null,2)+'\n');await writeFile(path.join(output,'server.log'),serverLog);}
if(!report.ok)throw Error(report.error);
