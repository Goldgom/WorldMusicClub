// Execute only on the explicitly authorized hosted runner. No local browser or
// server launch is permitted. Fixtures below are authored here, never uploads
// from the user's music collection. Screenshots are required evidence.
import assert from 'node:assert/strict';
import {spawn,execFileSync} from 'node:child_process';
import {createServer} from 'node:net';
import {mkdir,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {originalMultipartNotation} from '../tests/notation-scope-fixtures.js';

if(process.env.GITHUB_ACTIONS!=='true'||process.env.WMH_HOSTED_BROWSER!=='1')throw Error('Notation layout browser checks require the authorized hosted Actions runner.');
const root=fileURLToPath(new URL('../',import.meta.url)),sha=execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim();
assert.match(process.env.WMH_SOURCE_SHA||'',/^[a-f0-9]{40}$/);assert.equal(process.env.WMH_SOURCE_SHA,sha);
const output=path.resolve(process.env.WMH_ARTIFACT_DIR||path.join(root,'test-results/notation-scope')),score=originalMultipartNotation(),raw=JSON.stringify(score);
await mkdir(output,{recursive:true});
const baseline=process.env.WMH_NOTATION_BASELINE==='1';
const report={version:1,source_sha:sha,rights:'original_authored_CC0-1.0',fixture_sha256:createHash('sha256').update(raw).digest('hex'),kind:baseline?'baseline-reproduction':'hosted-layout-acceptance',screenshots:[],cases:[],page_errors:[],ok:false};
let browser,server,serverLog='',page;
const screenshot=async name=>{const filename=`${name}.png`;await page.screenshot({path:path.join(output,filename),fullPage:true});report.screenshots.push(filename);};
const controls=async open=>{if(await page.locator('#notation-toggle').getAttribute('aria-expanded')!=='true')await page.locator('#notation-toggle').click();const tools=page.locator('#notation-tools');if(await tools.evaluate(node=>node.open)!==open)await tools.locator('summary').first().click();};
const settle=()=>page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
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
      fit:overlay.dataset.notationFit,scale:Number(overlay.dataset.notationScale||1),glyphs,visibleGlyphs:visible.length,keyboardReachable:hit===key||key.contains(hit),
      renderedParts:document.getElementById('notation-scope-status')?.parentElement.dataset.renderedParts,totalParts:document.getElementById('notation-scope-status')?.parentElement.dataset.totalParts,
      scope:document.getElementById('notation-scope')?.value,status:document.getElementById('notation-scope-status')?.textContent,progress:document.getElementById('progress').value,
      horizontalDocumentOverflow:document.documentElement.scrollWidth>innerWidth+1,sourceIds:[...surface.querySelectorAll('[data-note-id]')].map(node=>node.dataset.noteId)};
  },mode);
}
function checkGeometry(value,mode) {
  assert.ok(value.glyphs.length>0&&value.visibleGlyphs>0,'Actual visible notation glyphs are required');
  assert.ok(value.overlay.bottom<=value.keyboard.y+1,'Notation must stop before the keyboard');assert.equal(value.keyboardReachable,true,'Score paint/options must not intercept keys');
  assert.equal(value.horizontalDocumentOverflow,false);assert.ok(value.scale>=.75);
  if(mode==='staff')assert.ok(value.glyphs.every(glyph=>glyph.bounds.height>=6.9),'Staff noteheads retain readable height');
  else assert.ok(value.glyphs.every(glyph=>glyph.font*value.scale>=17.9),'Jianpu digits retain readable size');
  if(value.fit==='scroll')assert.ok(value.scrollHeight>value.clientHeight+1||value.glyphs.some(glyph=>glyph.bounds.right>value.overlay.right),'Overflow must remain reachable');
}
try {
  const reservation=createServer();await new Promise((resolve,reject)=>{reservation.once('error',reject);reservation.listen(0,'127.0.0.1',resolve);});const port=reservation.address().port;await new Promise(resolve=>reservation.close(resolve));
  server=spawn(path.resolve(root,process.env.WMH_SERVER_BINARY||'target/debug/practice-server'),['--no-open','--port',String(port)],{cwd:root,stdio:['ignore','pipe','pipe']});
  for(const stream of [server.stdout,server.stderr])stream.on('data',data=>{serverLog=(serverLog+data).slice(-65536);});
  const origin=`http://127.0.0.1:${port}`;let ready=false;for(let count=0;count<120;count++){try{if((await fetch(`${origin}/api/health`)).ok){ready=true;break;}}catch{}if(server.exitCode!==null)throw Error(serverLog);await new Promise(resolve=>setTimeout(resolve,100));}assert.ok(ready);
  const {chromium}=await import('playwright');browser=await chromium.launch({headless:true});const context=await browser.newContext({viewport:{width:1280,height:720}});page=await context.newPage();page.on('pageerror',error=>report.page_errors.push(error.message));
  await page.addInitScript(()=>localStorage.setItem('worldmusichub.locale.v1','en'));
  await page.goto(origin);await page.locator('#home-single-player').click();await page.locator('#score-file').setInputFiles({name:'original-multipart.wmhscore.json',mimeType:'application/json',buffer:Buffer.from(raw)});
  await page.waitForFunction(title=>document.getElementById('score-title').textContent===title,score.title);
  // Imported scores open directly; retain the real app navigation in either
  // supported lobby/direct-import flow rather than replacing page DOM.
  if(await page.locator('#start-listen').isVisible())await page.locator('#start-listen').click();
  await page.waitForFunction(()=>document.body.dataset.screen==='stage');if(Number(await page.locator('#progress').getAttribute('value'))>0)await page.locator('#play-button').click();
  await controls(true);
  const originalPerformanceState=await performanceState();
  for(const [width,height]of [[1280,720],[1440,900],[1920,1080]])for(const mode of ['staff','jianpu']) {
    await page.setViewportSize({width,height});await controls(true);await page.locator(mode==='staff'?'#engraved-button':'#jianpu-button').click();
    if(baseline){await page.locator(mode==='staff'?'#engraving-part':'#notation-part').selectOption('');}
    else {await page.locator('#notation-scope').selectOption('all');await page.waitForFunction(()=>document.getElementById('notation-scope').value==='all');}
    await page.waitForFunction(mode=>Boolean(document.querySelector(mode==='staff'?'#engraved-staff .vf-notehead':'#notation .jianpu-note')),mode);await controls(false);await settle();
    const value=await geometry(mode);await screenshot(`${height}-${mode}-all-first`);
    if(baseline){assert.ok(value.scrollHeight>value.clientHeight);report.cases.push({name:`${height}-${mode}-baseline-clipping`,geometry:value});continue;}
    checkGeometry(value,mode);assert.equal(Number(value.totalParts),12);assert.ok(Number(value.renderedParts)>0&&Number(value.renderedParts)<=12);
    await controls(true);const before=value.scrollTop;await page.locator('#notation-pan-down').click();await controls(false);await settle();const scrolled=await geometry(mode);if(value.scrollHeight>value.clientHeight+1)assert.ok(scrolled.scrollTop>before);await screenshot(`${height}-${mode}-all-scrolled`);
    await controls(true);let partPages=1;while(await page.locator('#notation-parts-next').isVisible()&&!await page.locator('#notation-parts-next').isDisabled()){await page.locator('#notation-parts-next').click();await settle();assert.ok(++partPages<=12,'Part paging must terminate');}await controls(false);await settle();const last=await geometry(mode);checkGeometry(last,mode);await screenshot(`${height}-${mode}-all-last`);
    report.cases.push({name:`${height}-${mode}-all`,first:value,scrolled,last,partPages});
    assert.deepEqual(await performanceState(),originalPerformanceState,'View changes must not change audio mix or human performance targets');
  }
  if(!baseline) {
    await page.setViewportSize({width:1280,height:720});await controls(true);await page.locator('#notation-scope').selectOption('part');await page.locator('#notation-scope-part').selectOption(score.parts[10].id);await controls(false);await settle();
    const selected=await geometry('jianpu');assert.equal(Number(selected.renderedParts),1);assert.ok(selected.sourceIds.every(id=>id.includes('11')));await screenshot('selected-part-11');
    assert.deepEqual(await performanceState(),originalPerformanceState,'Selecting a displayed part must not change the audio mix or human target');
    // Browser CSS zoom exercises layout/reveal resize without modifying music.
    await page.evaluate(()=>{document.documentElement.style.zoom='1.25';dispatchEvent(new Event('resize'));});await settle();checkGeometry(await geometry('jianpu'),'jianpu');await screenshot('jianpu-125-percent-zoom');await page.evaluate(()=>{document.documentElement.style.zoom='';dispatchEvent(new Event('resize'));});
    await controls(true);await page.locator('#notation-scope').selectOption('current');await controls(false);await settle();
    await page.locator('#settings-button').click();await page.locator('#practice-part').selectOption(score.parts[10].id);await page.locator('#count-in').uncheck();await page.locator('[data-close-panel="settings"]').click();await settle();
    const current=await geometry('jianpu');assert.equal(Number(current.renderedParts),1);assert.ok(current.status.includes(score.parts[10].name));
    await page.locator('#settings-button').click();await page.locator('#practice-part').selectOption(score.parts[11].id);await page.locator('[data-close-panel="settings"]').click();await settle();
    const changed=await geometry('jianpu');assert.ok(changed.status.includes(score.parts[11].name));assert.ok(changed.sourceIds.every(id=>id.includes('12')));await screenshot('current-part-changed-to-12');
    // Follow a held original note into the next one-bar staff page. The clock
    // advances normally; changing score layout does not seek or rewrite it.
    await controls(true);await page.locator('#engraved-button').click();await page.locator('#engraving-page-size').selectOption('1');await page.locator('#engraving-follow').check();await controls(false);await page.locator('#reset-button').click();await page.locator('#play-button').click();
    await page.waitForFunction(()=>document.getElementById('progress').value>=.05,{},{timeout:15000});
    await page.locator('#play-button').click();await settle();const crossed=await geometry('staff');checkGeometry(crossed,'staff');assert.ok(crossed.progress>=.05);assert.match(await page.locator('#engraving-range').textContent(),/Measures [2-9]/);await screenshot('held-note-follow-page-boundary');
    report.cases.push({name:'selected-current-zoom-and-held-page',selected,current,changed,crossed});
  }
  assert.deepEqual(report.page_errors,[]);assert.ok(report.screenshots.length>=6);report.ok=true;
}catch(error){report.error=error.stack||String(error);process.exitCode=1;if(page)try{await screenshot('failure');}catch{}}
finally{await browser?.close();server?.kill();await writeFile(path.join(output,'report.json'),JSON.stringify(report,null,2)+'\n');await writeFile(path.join(output,'server.log'),serverLog);}
if(!report.ok)throw Error(report.error);
