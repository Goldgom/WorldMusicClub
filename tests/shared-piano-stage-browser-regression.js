import assert from 'node:assert/strict';
import {writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {originalAboveKeyboardScore} from './above-keyboard-browser-regression.js';
import {compareScreenshotPixels} from './browser-png-evidence.js';

export const settlePianoPaint=page=>page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))));

export async function readSharedPianoGeometry(page,mode='normal') {
  return page.evaluate(mode=>{
    const root=document.querySelector(mode==='free'?'#free-piano-stage':'#piano-stage');
    const rect=node=>{const r=node.getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height,right:r.right,bottom:r.bottom};};
    const style=node=>{const s=getComputedStyle(node);return Object.fromEntries(['backgroundColor','backgroundImage','color','borderTopColor','borderBottomColor','borderBottomWidth','borderRadius','boxShadow','fontSize','fontFamily','transform','transitionDuration','animationName'].map(name=>[name,s[name]]));};
    const surface=root.querySelector('.piano-surface-shared'),keyboard=root.querySelector('.piano-keybed-shared'),scroll=root.querySelector('.piano-scroll-shared');
    const keyRect=keyboard.getBoundingClientRect();
    const keys=[...keyboard.querySelectorAll('.piano-key')].map(node=>{const r=rect(node);return {midi:Number(node.dataset.midi),black:node.classList.contains('black'),pressed:node.getAttribute('aria-pressed'),rect:{x:r.x-keyRect.x,y:r.y-keyRect.y,width:r.width,height:r.height},style:style(node)};});
    const lane=root.querySelector('.piano-lanes-shared'),strike=root.querySelector('.strike-line'),toolbar=root.querySelector('.piano-stage-toolbar');
    const controls=[...toolbar.querySelectorAll('.piano-stage-actions > button')].map(node=>({id:node.id,rect:rect(node),style:style(node),hit:(()=>{const r=node.getBoundingClientRect(),hit=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2);return hit===node||node.contains(hit);})()}));
    return {mode,viewport:{width:innerWidth,height:innerHeight},documentWidth:document.documentElement.scrollWidth,stage:rect(root),surface:rect(surface),keyboard:rect(keyboard),lane:rect(lane),strike:rect(strike),toolbar:rect(toolbar),style:{stage:style(root),lane:style(lane),strike:style(strike),toolbar:style(toolbar)},keys,controls,scroll:{width:scroll.clientWidth,content:scroll.scrollWidth,left:scroll.scrollLeft}};
  },mode);
}

function nearly(a,b,message){assert.ok(Math.abs(a-b)<=1,`${message}: ${a} vs ${b}`);}
export function assertSamePianoStage(normal,free) {
  assert.deepEqual(normal.viewport,free.viewport);assert.equal(normal.keys.length,free.keys.length);
  for(const surface of ['stage','surface','keyboard','lane','strike','toolbar'])for(const axis of ['width','height'])nearly(normal[surface][axis],free[surface][axis],`Shared ${surface} ${axis}`);
  for(const mode of [normal,free]){
    assert.ok(mode.documentWidth<=mode.viewport.width,`${mode.mode} has no document-width overflow`);
    for(const node of ['lane','strike','keyboard'])nearly(mode[node].width,mode.surface.width,`${mode.mode} ${node} spans the same coordinate surface`);
    nearly(mode.lane.bottom,mode.strike.y,`${mode.mode}: lane ends exactly on strike line`);nearly(mode.strike.bottom,mode.keyboard.y,`${mode.mode}: strike line ends exactly at keybed`);
    assert.ok(mode.lane.height>=100,`${mode.mode}: visible falling field is usable`);
    assert.ok(mode.keys.find(key=>key.midi===60).rect.width>=21,`${mode.mode}: compact keys keep usable dimensions`);
    assert.ok(mode.controls.length>0&&mode.controls.every(control=>control.hit),`${mode.mode}: toolbar remains reachable`);
  }
  assert.deepEqual(normal.style,free.style,'The rendered stage, lane, strike and toolbar use identical colors and effects');
  for(let index=0;index<normal.keys.length;index++){
    const a=normal.keys[index],b=free.keys[index];assert.equal(a.midi,b.midi);assert.equal(a.black,b.black);
    for(const axis of ['x','y','width','height'])nearly(a.rect[axis],b.rect[axis],`MIDI ${a.midi}: ${axis}`);
    assert.deepEqual(a.style,b.style,`MIDI ${a.midi}: actual rendered key appearance`);
  }
  // Mode-specific action labels may differ; their actual control size and paint do not.
  for(const mode of [normal,free])for(const control of mode.controls){nearly(control.rect.height,normal.controls[0].rect.height,'Shared toolbar button height');assert.deepEqual(control.style,normal.controls[0].style,'Shared toolbar button colors, font and effects');}
}

export async function readLaneOverlayGeometry(page) {
  return page.evaluate(()=>{
    const overlay=document.querySelector('#notation-lane-overlay'),lane=overlay.closest('.piano-lanes-shared'),canvas=lane.querySelector('canvas'),rails=lane.querySelector('.piano-rails-shared'),rect=node=>{const r=node.getBoundingClientRect();return{x:r.x,y:r.y,width:r.width,height:r.height,right:r.right,bottom:r.bottom};};
    const o=rect(overlay),l=rect(lane),root=[document.querySelector('#notation'),document.querySelector('.engraving-scroll')].find(node=>node&&getComputedStyle(node).display!=='none'&&node.getBoundingClientRect().height>0);
    const paints=[overlay,...(root?[root,...root.querySelectorAll('svg')]:[])].map(node=>({id:node.id,tag:node.tagName,pointer:getComputedStyle(node).pointerEvents,background:getComputedStyle(node).backgroundColor}));
    const x=(Math.max(o.x,l.x)+Math.min(o.right,l.right))/2,y=(Math.max(o.y,l.y)+Math.min(o.bottom,l.bottom))/2;
    const hit=document.elementFromPoint(x,y);
    const pixels=canvas.getContext('2d').getImageData(0,0,canvas.width,canvas.height).data;let opaque=0,transparent=0;
    for(let offset=3;offset<pixels.length;offset+=4){if(pixels[offset]===255)opaque++;if(pixels[offset]===0)transparent++;}
    return {overlay:o,lane:l,canvas:rect(canvas),inside:lane.contains(overlay),opacity:Number(getComputedStyle(overlay).opacity),hidden:overlay.hidden,paints,hitInsideOverlay:Boolean(hit&&overlay.contains(hit)),z:{overlay:Number(getComputedStyle(overlay).zIndex),canvas:Number(getComputedStyle(canvas).zIndex),rails:rails?Number(getComputedStyle(rails).zIndex):0},canvasAlpha:{opaque,transparent,total:pixels.length/4},controlsInside:overlay.querySelectorAll('button,input,select,textarea,details').length,rootInside:Boolean(root&&overlay.contains(root)),intersection:{width:Math.max(0,Math.min(o.right,l.right)-Math.max(o.x,l.x)),height:Math.max(0,Math.min(o.bottom,l.bottom)-Math.max(o.y,l.y))}};
  });
}

export function assertLaneOverlay(geometry) {
  assert.equal(geometry.inside,true,'The real notation paint root is a descendant of the falling-lane viewport');assert.equal(geometry.rootInside,true);
  assert.ok(geometry.intersection.width>=250&&geometry.intersection.height>=100,'The notation physically intersects a readable area of the falling-lane background');
  assert.ok(geometry.z.rails<geometry.z.overlay&&geometry.z.overlay<geometry.z.canvas,'Notation paints above lane rails and below actual falling blocks');
  assert.equal(geometry.controlsInside,0,'Interactive notation controls stay outside the pointer-inert paint layer');assert.equal(geometry.hitInsideOverlay,false,'Hit testing cannot land on notation paint');
  assert.ok(geometry.paints.every(node=>node.pointer==='none'),JSON.stringify(geometry.paints));
  assert.ok(geometry.paints.every(node=>node.background==='rgba(0, 0, 0, 0)'),`No opaque notation card: ${JSON.stringify(geometry.paints)}`);
  assert.ok(geometry.canvasAlpha.transparent>geometry.canvasAlpha.total*.5,'The actual canvas leaves notation-background pixels transparent');
}

async function setOverlayOpacity(page,ui,value){
  await ui('#notation-overlay-opacity').focus();
  await page.keyboard.press('Home');
  const bounds=await page.locator('#notation-overlay-opacity').evaluate(node=>({min:Number(node.min||0),step:Number(node.step||1)}));
  const steps=(value-bounds.min)/bounds.step;assert.ok(Number.isInteger(steps)&&steps>=0,'The opacity target must be reachable by its real keyboard control');
  for(let index=0;index<steps;index++)await page.keyboard.press('ArrowRight');
  assert.equal(Number(await page.locator('#notation-overlay-opacity').inputValue()),value);
}

export async function captureOverlayPaintEvidence({page,ui,view,artifactDirectory,prefix}) {
  if(await page.locator('#notation-tools').evaluate(node=>node.open))await page.locator('#notation-tools>summary').click();
  const before=await readSharedPianoGeometry(page),geometry=await readLaneOverlayGeometry(page);assertLaneOverlay(geometry);
  let exports=0;const requestListener=request=>{if(new URL(request.url()).pathname==='/api/export/musicxml')exports++;};page.on('request',requestListener);
  const key=await page.locator('#keyboard [data-midi="60"]').elementHandle(),follow=await page.locator('#engraving-follow').isChecked();
  const lane=page.locator('#piano-stage .piano-lanes-shared');
  await setOverlayOpacity(page,ui,100);await settlePianoPaint(page);
  const full=await lane.screenshot({path:join(artifactDirectory,`${prefix}-${view}-opacity100.png`),animations:'disabled'});
  await setOverlayOpacity(page,ui,35);await settlePianoPaint(page);
  const faint=await lane.screenshot({path:join(artifactDirectory,`${prefix}-${view}-opacity35.png`),animations:'disabled'});
  await ui('#notation-overlay-visible').uncheck();await settlePianoPaint(page);
  const off=await lane.screenshot({path:join(artifactDirectory,`${prefix}-${view}-hidden.png`),animations:'disabled'});
  const visiblePixels=compareScreenshotPixels(full,off),opacityPixels=compareScreenshotPixels(full,faint),faintPixels=compareScreenshotPixels(faint,off);
  assert.ok(visiblePixels.changed>=50&&visiblePixels.fraction>.0005,`${view}: actual notation ink must be visible behind the falling canvas`);
  assert.ok(visiblePixels.fraction<.55,`${view}: showing notation must not fill the lane with an opaque card`);
  assert.ok(opacityPixels.changed>=30,`${view}: opacity control must change actual score pixels`);assert.ok(faintPixels.meanDelta<visiblePixels.meanDelta*.7,`${view}: 35% has lower actual ink contrast than 100%`);
  const after=await readSharedPianoGeometry(page);for(const name of ['stage','lane','strike','keyboard','toolbar'])assert.deepEqual(after[name],before[name],`Overlay opacity/visibility cannot move ${name}`);
  await ui('#notation-overlay-visible').check();await setOverlayOpacity(page,ui,65);await settlePianoPaint(page);
  assert.equal(await key.evaluate(node=>node===document.querySelector('#keyboard [data-midi="60"]')),true,'Overlay controls preserve the actual key node');await key.dispose();
  assert.equal(await page.locator('#engraving-follow').isChecked(),follow,'Opacity/visibility leave the exact follow preference unchanged');page.off('request',requestListener);assert.equal(exports,0,'Opacity/visibility never trigger another MusicXML export');
  return {view,geometry,visiblePixels,opacityPixels,faintPixels,geometry_unchanged:true,key_node_preserved:true,follow_preserved:true,redundant_musicxml_exports:exports};
}

// Imported by the authorized hosted runner. This module never launches a browser.
export function registerSharedPianoStageBrowserRegressions({test,getPage,ui,readyForTitle,closeShellPanels,artifactDirectory,exportScore,exportTakeData,waitForEngraving}) {
  test('normal and free piano share actual geometry colors toolbar and held feedback at the same configured range',{timeout:90_000},async()=>{
    const page=getPage(),score=originalAboveKeyboardScore(),evidence=[];score.id='original-shared-stage';score.title='Original shared piano stage comparison';score.parts[0].notes=score.parts[0].notes.filter(note=>note.at.numerator>=4);
    await ui('#instrument').selectOption('piano');await ui('#key-count').selectOption('61');await ui('#session-mode').selectOption('practice');await ui('#count-in').uncheck();
    await ui('#score-file').setInputFiles({name:`${score.id}.json`,mimeType:'application/json',buffer:Buffer.from(JSON.stringify(score))});await readyForTitle(score.title);await closeShellPanels();
    if(await page.locator('#notation-toggle').getAttribute('aria-expanded')==='true')await page.locator('#notation-toggle').click();
    if(await page.locator('#sound-button').getAttribute('aria-pressed')==='true')await ui('#sound-button').click();
    await page.locator('#play-button').click();await page.waitForFunction(()=>Number(document.querySelector('#progress').value)>150);await page.locator('#play-button').click();await page.waitForFunction(()=>document.querySelector('.performance-status').dataset.phase!=='grace');
    const take=await exportTakeData();assert.equal(take.passes.length,1);await closeShellPanels();if(await page.locator('#notice-dismiss').isVisible())await page.locator('#notice-dismiss').click();
    const layouts=[{width:1280,height:720},{width:1920,height:1080},{width:844,height:390},{width:390,height:844}];
    for(const viewport of layouts)for(const theme of viewport.width>=1280?['light','dark']:['light']){
      await page.setViewportSize(viewport);await page.emulateMedia({reducedMotion:theme==='dark'?'reduce':'no-preference'});await ui('#theme-mode').selectOption(theme);await closeShellPanels();
      await page.locator('#piano-scroll').evaluate(node=>{node.scrollLeft=0;});await settlePianoPaint(page);
      const normal=await readSharedPianoGeometry(page);assert.equal(normal.keys.length,61);assert.deepEqual([normal.keys[0].midi,normal.keys.at(-1).midi],[36,96]);
      const suffix=`${viewport.width}x${viewport.height}-${theme}`;
      await page.screenshot({path:join(artifactDirectory,`worldmusichub-shared-piano-${suffix}-normal.png`),fullPage:true,animations:'disabled'});
      await page.locator('#rhythm-stage-free').click();
      await page.locator('#free-keyboard-scroll').evaluate(node=>{node.scrollLeft=0;});await settlePianoPaint(page);
      const free=await readSharedPianoGeometry(page,'free');assertSamePianoStage(normal,free);
      await page.screenshot({path:join(artifactDirectory,`worldmusichub-shared-piano-${suffix}-free.png`),fullPage:true,animations:'disabled'});
      evidence.push({viewport,theme,reduced_motion:theme==='dark',normal,free});await page.locator('#rhythm-free-resume').click();
    }
    await page.setViewportSize({width:1280,height:720});await ui('#theme-mode').selectOption('light');await closeShellPanels();
    const held=async mode=>{const root=mode==='normal'?'#keyboard':'#free-practice-keys';await page.locator(mode==='normal'?'#stage-title':'#free-practice-title').focus();await page.keyboard.down('r');await page.waitForFunction(root=>document.querySelector(`${root} [data-midi="60"]`).getAttribute('aria-pressed')==='true',root);const geometry=await readSharedPianoGeometry(page,mode);await page.screenshot({path:join(artifactDirectory,`worldmusichub-shared-piano-1280x720-${mode}-held.png`),fullPage:true,animations:'disabled'});await page.keyboard.up('r');await page.waitForFunction(root=>!document.querySelector(`${root} .pressed`),root);return geometry.keys.find(key=>key.midi===60);};
    const normalHeld=await held('normal');await page.locator('#rhythm-stage-free').click();await page.locator('#free-start').click();const freeHeld=await held('free');assert.deepEqual(normalHeld.style,freeHeld.style,'An actual held C4 has identical visible feedback in both modes');
    const unpressed=(await readSharedPianoGeometry(page,'free')).keys.find(key=>key.midi===60);assert.notDeepEqual(freeHeld.style,unpressed.style,'Pressed feedback is visibly different from idle');
    await page.locator('#free-practice-title').focus();await page.evaluate(()=>document.dispatchEvent(new CompositionEvent('compositionstart',{bubbles:true})));await page.keyboard.press('r');assert.equal(await page.locator('#free-practice-keys .pressed').count(),0);await page.evaluate(()=>document.dispatchEvent(new CompositionEvent('compositionend',{bubbles:true})));
    await page.keyboard.down('r');await page.waitForFunction(()=>document.querySelector('#free-practice-keys .pressed'));await page.locator('#free-keyboard-settings').click();await page.waitForFunction(()=>!document.querySelector('#free-practice-keys .pressed'));await page.keyboard.up('r');await closeShellPanels();
    assert.equal(await page.locator('#free-practice-screen').getAttribute('data-state'),'paused');await page.locator('#rhythm-free-resume').click();assert.equal(await page.locator('#keyboard .pressed').count(),0);
    assert.deepEqual(await exportTakeData(),take,'Free input, IME and navigation cannot mutate the retained normal take');assert.deepEqual(await exportScore(),score);
    await writeFile(join(artifactDirectory,'worldmusichub-shared-piano-stage.json'),JSON.stringify({original_fixtures_only:true,configured_range:{key_count:61,lowest_midi:36,highest_midi:96},evidence,held:{normal:normalHeld,free:freeHeld},actual_paired_screenshots:true,normal_take_preserved:true,score_preserved:true,ime_suppressed:true,protected_control_released_input:true,navigation_released_input:true},null,2));
  });
  test('original falling bars visibly cross staff and Jianpu lane background during actual playback',{timeout:90_000},async()=>{
    const page=getPage(),score=originalAboveKeyboardScore(),evidence=[];score.id='original-live-overlay';score.title='Original live falling-lane overlay';score.tempo[0].bpm=60;
    await ui('#instrument').selectOption('piano');await ui('#key-count').selectOption('61');await ui('#session-mode').selectOption('listen');await ui('#count-in').uncheck();await ui('#score-file').setInputFiles({name:`${score.id}.json`,mimeType:'application/json',buffer:Buffer.from(JSON.stringify(score))});await readyForTitle(score.title);
    await ui('#interface-language').selectOption('zh-CN');await ui('#theme-mode').selectOption('light');await page.emulateMedia({reducedMotion:'no-preference'});
    for(const viewport of [{width:1280,height:720},{width:1920,height:1080}])for(const [button,view]of [['#engraved-button','staff'],['#jianpu-button','jianpu']]){
      await page.setViewportSize(viewport);await ui(button).click();await ui('#engraving-follow').check();await closeShellPanels();if(view==='staff')await waitForEngraving();
      if(await page.locator('#notice-dismiss').isVisible())await page.locator('#notice-dismiss').click();await page.locator('#reset-button').click();await page.locator('#play-button').click();
      await page.waitForFunction(()=>Number(document.querySelector('#progress').value)>300&&document.querySelector('#stage-cue').hidden);
      const geometry=await readLaneOverlayGeometry(page);assertLaneOverlay(geometry);assert.ok(geometry.canvasAlpha.opaque>20,'The real canvas contains painted falling blocks');
      const current=await page.locator(view==='staff'?'.engraving-expected-cue:not([hidden])':'#notation .score-note.active').count();assert.equal(current,2,'Both original staff voices are visibly followed while playing');
      assert.equal(await page.locator('#notation-tools').evaluate(node=>node.open),false,'Music keeps rendering while its controls are closed');
      await page.screenshot({path:join(artifactDirectory,`worldmusichub-lane-overlay-live-${viewport.width}x${viewport.height}-${view}.png`),fullPage:true,animations:'disabled'});
      evidence.push({viewport,view,geometry,current_markers:current,playing:true,controls_closed:true});await page.locator('#play-button').click();
    }
    assert.deepEqual(await exportScore(),score);await writeFile(join(artifactDirectory,'worldmusichub-lane-overlay-live.json'),JSON.stringify({original_fixtures_only:true,actual_playback:true,evidence},null,2));
  });

}
