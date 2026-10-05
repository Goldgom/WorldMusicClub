import {installPlaybackClockReader, waitForPlaybackClock} from './browser-playback-clock.js';
import assert from 'node:assert/strict';
import {writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {originalAboveKeyboardScore} from './above-keyboard-browser-regression.js';
import {compareScreenshotPixels} from './browser-png-evidence.js';
import {contrastRatio} from '../web/themes.js';
import {readBeginnerHelpGeometry,assertBeginnerHelpGeometry} from './beginner-browser-regression.js';
import {readNotationHudGeometry,assertNotationHudClear} from './notation-hud-geometry.js';

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
    const layoutMetrics=node=>{const css=getComputedStyle(node);return {id:node.id,className:node.className,rect:rect(node),css:Object.fromEntries(['display','height','minHeight','maxHeight','lineHeight','fontSize','paddingTop','paddingBottom','marginTop','marginBottom','borderTopWidth','borderBottomWidth','boxSizing','alignItems','alignSelf','rowGap'].map(name=>[name,css[name]]))};};
    const layoutDiagnostics={stage:layoutMetrics(root),toolbar:layoutMetrics(toolbar),toolbarChildren:[...toolbar.children].map(layoutMetrics),actionChildren:[...toolbar.querySelectorAll('.piano-stage-actions > *')].map(layoutMetrics),surface:layoutMetrics(surface),lane:layoutMetrics(lane),keyboard:layoutMetrics(keyboard)};
    const transport=document.querySelector(mode==='free'?'#free-practice-screen .piano-transport':'.transport');
    const auxiliary=mode==='normal'?['#keyboard-pan-left','#keyboard-pan-right','#piano-fingering-guidance>summary'].map(selector=>document.querySelector(selector)).filter(node=>node&&node.getBoundingClientRect().width>0).map(node=>{const r=rect(node),hit=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2);return{id:node.id||'piano-guidance-summary',rect:r,hit:hit===node||node.contains(hit)}}):[];
    const label=selector=>root.querySelector(selector)?.textContent.trim()??null;const labels={title:label('.piano-stage-title'),midi:label(mode==='free'?'#free-connect-midi':'#piano-connect-midi'),keyboard:label(mode==='free'?'#free-keyboard-settings':'#piano-keyboard-settings'),...(mode==='normal'?{background:label('[data-i18n="performance.scoreBackground"]'),opacity:label('[data-i18n="performance.scoreOpacity"]'),options:label('#notation-tools>summary')}: {})};
    return {labels,transport:rect(transport),auxiliary,locale:document.documentElement.lang,layoutDiagnostics,mode,viewport:{width:innerWidth,height:innerHeight},documentWidth:document.documentElement.scrollWidth,stage:rect(root),surface:rect(surface),keyboard:rect(keyboard),lane:rect(lane),strike:rect(strike),toolbar:rect(toolbar),style:{stage:style(root),lane:style(lane),strike:style(strike),toolbar:style(toolbar)},keys,controls,scroll:{width:scroll.clientWidth,content:scroll.scrollWidth,left:scroll.scrollLeft}};
  },mode);
}

async function readCompactPianoHeading(page,mode){
  return page.evaluate(mode=>{
    const prefix=mode==='free'?'free-':'',heading=document.querySelector(mode==='free'?'.free-practice-heading':'.stage-hud'),panel=document.getElementById(`${prefix}beginner-controls`);
    const rect=node=>{const r=node.getBoundingClientRect();return{x:r.x,y:r.y,right:r.right,bottom:r.bottom,width:r.width,height:r.height};};
    const control=node=>{const r=rect(node),hit=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2);return{id:node.id||node.tagName,rect:r,hit:hit===node||node.contains(hit),hitTarget:hit?.id||hit?.className||hit?.tagName||null};};
    const label=panel.querySelector('.beginner-toggle-label'),help=panel.querySelector('summary'),title=document.getElementById(mode==='free'?'free-practice-title':'stage-title');
    const controls=[...heading.querySelectorAll('button,input,summary')].filter(node=>node.getBoundingClientRect().width>0&&node.getBoundingClientRect().height>0).map(control);
    const titleStyle=getComputedStyle(title);
    return{mode,locale:document.documentElement.lang,viewport:{width:innerWidth,height:innerHeight},heading:rect(heading),navigation:rect(heading.querySelector('nav')),title:rect(title),titleStyle:{overflow:titleStyle.overflow,textOverflow:titleStyle.textOverflow,whiteSpace:titleStyle.whiteSpace},notationExpanded:mode==='normal'?document.getElementById('notation-toggle').getAttribute('aria-expanded'):null,track:rect(panel.parentElement),panel:rect(panel),label:rect(label),help:rect(help),glyphs:[...panel.querySelectorAll('.beginner-short-label')].map(rect),controls,resume:mode==='free'?rect(document.getElementById('rhythm-free-resume')):null};
  },mode);
}
function assertCompactPianoHeading(proof){
  const inside=(inner,outer)=>inner.x>=outer.x-1&&inner.right<=outer.right+1&&inner.y>=outer.y-1&&inner.bottom<=outer.bottom+1;
  assert.ok(inside(proof.panel,proof.track),`The ${proof.mode} guide fits its intrinsic heading track: ${JSON.stringify(proof)}`);
  assert.ok(proof.title.right<=proof.panel.x+1,'Title and guide use separate grid cells');
  assert.ok(proof.title.width>=63,'The title retains its 64px focus target');assert.deepEqual(proof.titleStyle,{overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'},'Long titles retain their existing ellipsis');
  assert.ok(proof.label.right<=proof.help.x+1,'Guide label and help retain separate readable bounds');
  assert.ok(proof.glyphs.every(glyph=>glyph.width>0&&glyph.height>0&&inside(glyph,proof.panel)),'Every rendered beginner label remains inside its guide');
  if(proof.resume){assert.ok(proof.panel.right<=proof.resume.x+1,'Free guide does not cover any part of Return to stage');assert.ok(proof.resume.right<=proof.navigation.x+1||proof.resume.bottom<=proof.navigation.y+1,'Session navigation reserves a separate row or track after Return to stage');}
  for(const control of proof.controls){assert.ok(inside(control.rect,{x:0,y:0,right:proof.viewport.width,bottom:proof.viewport.height}),`${control.id} stays inside the viewport`);assert.equal(control.hit,true,`${proof.locale} ${proof.mode} ${control.id} receives its own pointer hit: ${JSON.stringify(control)}`);}
  for(let index=0;index<proof.controls.length;index++)for(const other of proof.controls.slice(index+1)){
    const a=proof.controls[index].rect,b=other.rect,overlap=Math.max(0,Math.min(a.right,b.right)-Math.max(a.x,b.x))*Math.max(0,Math.min(a.bottom,b.bottom)-Math.max(a.y,b.y));
    assert.ok(overlap<1,`Heading controls never overlap: ${proof.controls[index].id}, ${other.id}: ${JSON.stringify(proof)}`);
  }
  const toggle=proof.controls.find(control=>control.id===(proof.mode==='free'?'free-beginner-enabled':'beginner-enabled'));
  assert.ok(toggle.rect.width>=18&&toggle.rect.height>=18,'The actual checkbox target is not reduced');assert.ok(proof.help.width>=20&&proof.help.height>=20,'The actual help target is not reduced');
}

function assertPianoToolbarLabels(geometry){
  const values=geometry.locale==='zh-CN'?['钢琴','连接 MIDI','编辑按键映射','轨道背景乐谱','不透明度','读谱设置']:['Piano','Connect MIDI','Edit key mapping','Score background','Opacity','Score options'];
  const names=['title','midi','keyboard',...(geometry.mode==='normal'?['background','opacity','options']:[])];
  for(const [index,name]of names.entries())assert.equal(geometry.labels[name],values[index],`${geometry.locale} ${geometry.mode} toolbar ${name} must have its rendered label`);
}

function nearly(a,b,message){assert.ok(Math.abs(a-b)<=1,`${message}: ${a} vs ${b}`);}
export function assertSamePianoStage(normal,free) {
  assertPianoToolbarLabels(normal);assertPianoToolbarLabels(free);
  assert.deepEqual(normal.viewport,free.viewport);assert.equal(normal.keys.length,free.keys.length);
  for(const surface of ['stage','surface','keyboard','lane','strike','toolbar'])for(const axis of ['width','height'])nearly(normal[surface][axis],free[surface][axis],`Shared ${surface} ${axis}`);
  for(const mode of [normal,free]){
    assert.ok(mode.documentWidth<=mode.viewport.width,`${mode.mode} has no document-width overflow`);
    assert.ok(mode.transport.x>=0&&mode.transport.right<=mode.viewport.width+1&&mode.transport.y>=0&&mode.transport.bottom<=mode.viewport.height+1,`${mode.mode}: transport stays inside the viewport`);
    for(const control of mode.auxiliary){assert.ok(control.rect.x>=0&&control.rect.right<=mode.viewport.width+1&&control.rect.y>=0&&control.rect.bottom<=mode.viewport.height+1,`${control.id}: auxiliary control stays visible`);assert.equal(control.hit,true,`${control.id}: auxiliary control is reachable`);}
    if(mode.mode==='normal'&&mode.viewport.width===700)assert.equal(mode.auxiliary.filter(control=>control.id.startsWith('keyboard-pan-')).length,2,'The narrow landscape case exercises both actual pan controls');

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
    const notationInk=document.querySelector('#notation').hidden?[]:[...overlay.querySelectorAll('.jianpu-note')].map(node=>{
      const style=getComputedStyle(node);let alpha=Number(style.fillOpacity);for(let ancestor=node;ancestor;ancestor=ancestor.parentElement){alpha*=Number(getComputedStyle(ancestor).opacity);if(ancestor===overlay)break;}
      return {fill:style.fill,alpha,fontSize:parseFloat(style.fontSize),active:Boolean(node.closest('.score-note.active'))};
    });
    const laneColors=['--piano-field','--piano-field-end'].map(name=>getComputedStyle(lane).getPropertyValue(name).trim());
    return {notationInk,laneColors,overlay:o,lane:l,canvas:rect(canvas),inside:lane.contains(overlay),opacity:Number(getComputedStyle(overlay).opacity),hidden:overlay.hidden,paints,hitInsideOverlay:Boolean(hit&&overlay.contains(hit)),z:{overlay:Number(getComputedStyle(overlay).zIndex),canvas:Number(getComputedStyle(canvas).zIndex),rails:rails?Number(getComputedStyle(rails).zIndex):0},canvasAlpha:{opaque,transparent,total:pixels.length/4},controlsInside:overlay.querySelectorAll('button,input,select,textarea,details').length,rootInside:Boolean(root&&overlay.contains(root)),intersection:{width:Math.max(0,Math.min(o.right,l.right)-Math.max(o.x,l.x)),height:Math.max(0,Math.min(o.bottom,l.bottom)-Math.max(o.y,l.y))}};
  });
}

export function assertLaneOverlay(geometry) {
  for(const ink of geometry.notationInk){
    assert.ok(ink.fontSize>=25,'Jianpu digits remain full-size large text');
    const rgb=ink.fill.match(/^rgba?\(([^)]+)\)$/)?.[1].split(',').slice(0,3).map(Number);assert.ok(rgb?.length===3&&rgb.every(Number.isFinite),`Actual computed Jianpu fill: ${ink.fill}`);
    for(const background of geometry.laneColors){const back=[1,3,5].map(index=>parseInt(background.slice(index,index+2),16));const effective='#'+rgb.map((color,index)=>Math.round(color*ink.alpha+back[index]*(1-ink.alpha)).toString(16).padStart(2,'0')).join('');const ratio=contrastRatio(effective,background);assert.ok(ratio>=3,`Jianpu ${ink.active?'current':'ordinary'} digit contrast at actual ${ink.alpha} opacity: ${ratio.toFixed(2)} against ${background}`);}
  }
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
export function registerSharedPianoStageBrowserRegressions({test,getPage,ui,setSessionMode,readyForTitle,closeShellPanels,artifactDirectory,exportScore,exportTakeData,waitForEngraving}) {
  test('normal and free piano share actual geometry colors toolbar and held feedback at the same configured range',{timeout:90_000},async()=>{
    const page=getPage(),score=originalAboveKeyboardScore(),evidence=[];await installPlaybackClockReader(page);await waitForPlaybackClock(page);score.id='original-shared-stage';score.title='Original shared piano stage comparison';score.parts[0].notes=score.parts[0].notes.filter(note=>note.at.numerator>=4);
    await ui('#instrument').selectOption('piano');await ui('#key-count').selectOption('61');await setSessionMode('practice');await ui('#count-in').uncheck();
    await ui('#score-file').setInputFiles({name:`${score.id}.json`,mimeType:'application/json',buffer:Buffer.from(JSON.stringify(score))});await readyForTitle(score.title);await closeShellPanels();
    if(await page.locator('#notation-toggle').getAttribute('aria-expanded')==='true')await page.locator('#notation-toggle').click();
    if(await page.locator('#sound-button').getAttribute('aria-pressed')==='true')await ui('#sound-button').click();
    await page.locator('#play-button').click();await page.waitForFunction(()=>globalThis.__wmhReadPlaybackClock().positionMs>150);await page.locator('#play-button').click();await page.waitForFunction(()=>document.querySelector('.performance-status').dataset.phase!=='grace');
    const take=await exportTakeData();assert.equal(take.passes.length,1);await closeShellPanels();if(await page.locator('#notice-dismiss').isVisible())await page.locator('#notice-dismiss').click();
    const footerNode=await page.locator('.keyboard-input-footer').elementHandle();
    const footerProof=async mode=>{
      const proof=await footerNode.evaluate((node,mode)=>{
        const ids=['keyboard-active-range','keyboard-current-offset','keyboard-octave-down','keyboard-semitone-down','keyboard-semitone-up','keyboard-octave-up','keyboard-performance-details','keyboard-map','keyboard-offset-reset','keyboard-open-settings'];
        const compact=matchMedia('(max-height:600px) and (min-width:651px), (max-width:650px)').matches;
        const buttons=['keyboard-octave-down','keyboard-semitone-down','keyboard-semitone-up','keyboard-octave-up'].map(id=>{const button=document.getElementById(id),r=button.getBoundingClientRect(),hit=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2);return{id,text:button.textContent,label:button.getAttribute('aria-label'),reachable:hit===button||button.contains(hit)};});
        return {mode,compact,same:node===document.querySelector('.keyboard-input-footer'),count:document.querySelectorAll('.keyboard-input-footer').length,ids:ids.map(id=>({id,count:document.querySelectorAll(`#${id}`).length,inside:node.contains(document.getElementById(id))})),host:node.closest('#keyboard-input-settings,.free-performance-panel,.play-panel')?.id||node.closest('.free-performance-panel,.play-panel')?.className,after:node.previousElementSibling?.id,indicatorInFree:Boolean(document.querySelector('#keyboard-compact-status').closest('.free-practice-heading')),buttons};
      },mode);
      assert.equal(proof.same,true);assert.equal(proof.count,1);assert.ok(proof.ids.every(row=>row.count===1&&row.inside),'Every physical input control retains one shared footer owner');
      assert.deepEqual(proof.buttons.map(button=>button.text),['−12','−1','+1','+12']);assert.ok(proof.buttons.every(button=>button.label),'Every shared transpose control retains its accessible name');
      if(proof.compact){assert.equal(proof.host,'keyboard-input-settings');assert.equal(proof.indicatorInFree,mode==='free');}else{assert.ok(proof.buttons.every(button=>button.reachable),'Shared physical input controls are reachable in both modes');if(mode==='free')assert.equal(proof.after,'free-piano-stage');else assert.ok(proof.host.includes('play-panel'));}
      return proof;
    };
    const localeProof=[];await page.setViewportSize({width:1280,height:720});
    for(const locale of ['en','zh-CN']){
      await ui('#interface-language').selectOption(locale);await closeShellPanels();await settlePianoPaint(page);
      const normal=await readSharedPianoGeometry(page);assert.equal(normal.locale,locale);assertPianoToolbarLabels(normal);
      if(locale==='en')await page.screenshot({path:join(artifactDirectory,'worldmusichub-shared-piano-1280x720-en-normal.png'),fullPage:true,animations:'disabled'});
      await page.locator('#rhythm-stage-free').click();await settlePianoPaint(page);const free=await readSharedPianoGeometry(page,'free');assert.equal(free.locale,locale);assertPianoToolbarLabels(free);
      if(locale==='en')await page.screenshot({path:join(artifactDirectory,'worldmusichub-shared-piano-1280x720-en-free.png'),fullPage:true,animations:'disabled'});
      localeProof.push({locale,normal:normal.labels,free:free.labels});await page.locator('#rhythm-free-resume').click();
    }
    const layouts=[{width:1280,height:720},{width:1920,height:1080},{width:844,height:390},{width:700,height:390},{width:390,height:844}];
    for(const viewport of layouts)for(const theme of viewport.width>=1280?['light','dark']:['light']){
      await page.setViewportSize(viewport);await page.emulateMedia({reducedMotion:theme==='dark'?'reduce':'no-preference'});await ui('#theme-mode').selectOption(theme);await closeShellPanels();
      await page.locator('#piano-scroll').evaluate(node=>{node.scrollLeft=0;});await settlePianoPaint(page);
      const normal=await readSharedPianoGeometry(page),normalFooter=await footerProof('normal');assert.equal(normal.keys.length,61);assert.deepEqual([normal.keys[0].midi,normal.keys.at(-1).midi],[36,96]);
      const suffix=`${viewport.width}x${viewport.height}-${theme}`;
      await page.screenshot({path:join(artifactDirectory,`worldmusichub-shared-piano-${suffix}-normal.png`),fullPage:true,animations:'disabled'});
      await page.locator('#rhythm-stage-free').click();
      await page.locator('#free-keyboard-scroll').evaluate(node=>{node.scrollLeft=0;});await settlePianoPaint(page);
      const free=await readSharedPianoGeometry(page,'free'),freeFooter=await footerProof('free');
      await page.screenshot({path:join(artifactDirectory,`worldmusichub-shared-piano-${suffix}-free.png`),fullPage:true,animations:'disabled'});
      await writeFile(join(artifactDirectory,'worldmusichub-shared-piano-layout-checkpoint.json'),JSON.stringify({original_fixtures_only:true,complete:false,localeProof,completed_pairs:evidence,current:{viewport,theme,normal,free,normalFooter,freeFooter}},null,2));
      assertSamePianoStage(normal,free);
      evidence.push({viewport,theme,reduced_motion:theme==='dark',normal,free,normalFooter,freeFooter});await page.locator('#rhythm-free-resume').click();
    }
    const compactHeaderProof=[];
    for(const locale of ['en','zh-CN'])for(const {width,height} of [{width:651,height:390},{width:700,height:390},{width:731,height:390},{width:390,height:844}]){
      await page.setViewportSize({width,height});await ui('#interface-language').selectOption(locale);await closeShellPanels();
      if(width===390&&await page.locator('#notation-toggle').getAttribute('aria-expanded')!=='true')await page.locator('#notation-toggle').click();
      await settlePianoPaint(page);
      const normal=await readCompactPianoHeading(page,'normal');assertCompactPianoHeading(normal);
      if(width===390){assert.equal(normal.notationExpanded,'true','The wider Close score label is part of the portrait regression');await page.screenshot({path:join(artifactDirectory,`worldmusichub-compact-heading-${locale}-${width}x${height}-normal.png`),fullPage:false,animations:'disabled'});const help=page.locator('#beginner-controls summary');await help.focus();assert.equal(await help.evaluate(node=>document.activeElement===node),true);await page.keyboard.press('Enter');assert.equal(await page.locator('#beginner-controls details').evaluate(node=>node.open),true);await page.keyboard.press('Enter');assert.equal(await page.locator('#beginner-controls details').evaluate(node=>node.open),false);}
      await page.locator('#rhythm-stage-free').click();await settlePianoPaint(page);
      const free=await readCompactPianoHeading(page,'free');
      await page.screenshot({path:join(artifactDirectory,`worldmusichub-compact-heading-${locale}-${width}x${height}-free.png`),fullPage:false,animations:'disabled'});
      compactHeaderProof.push({normal,free});await writeFile(join(artifactDirectory,'worldmusichub-live-compact-heading-bounds.json'),JSON.stringify(compactHeaderProof,null,2));assertCompactPianoHeading(free);
      const checkbox=page.locator('#free-beginner-enabled'),before=await checkbox.isChecked(),helpCycles=[];
      for(const enabled of [!before,before]){
        await checkbox.click();assert.equal(await checkbox.isChecked(),enabled);
        const help=page.locator('#free-beginner-controls summary');await help.click();
        const proof=await readBeginnerHelpGeometry(page,'free-');helpCycles.push({enabled,...proof});await writeFile(join(artifactDirectory,`worldmusichub-live-compact-help-${locale}-${width}x${height}-free.json`),JSON.stringify(helpCycles,null,2));assertBeginnerHelpGeometry(proof);
        await help.click();assert.equal(await page.locator('#free-beginner-controls details').evaluate(node=>node.open),false);
      }
      await page.locator('#rhythm-free-resume').click();assert.equal(await page.locator('body').getAttribute('data-screen'),'stage');
    }
    await page.setViewportSize({width:1280,height:720});await ui('#theme-mode').selectOption('light');await closeShellPanels();
    const held=async mode=>{const root=mode==='normal'?'#keyboard':'#free-practice-keys';await page.locator(mode==='normal'?'#stage-title':'#free-practice-title').focus();await page.keyboard.down('r');await page.waitForFunction(root=>document.querySelector(`${root} [data-midi="60"]`).getAttribute('aria-pressed')==='true',root);const geometry=await readSharedPianoGeometry(page,mode);await page.screenshot({path:join(artifactDirectory,`worldmusichub-shared-piano-1280x720-${mode}-held.png`),fullPage:true,animations:'disabled'});await page.keyboard.up('r');await page.waitForFunction(root=>!document.querySelector(`${root} .pressed`),root);return geometry.keys.find(key=>key.midi===60);};
    const normalHeld=await held('normal');await page.locator('#rhythm-stage-free').click();
    const freeIsolationTake=await exportTakeData();await closeShellPanels();
    const {input_evidence:beforeNormalEvidence,...beforeNormal}=take,{input_evidence:afterNormalEvidence,...afterNormal}=freeIsolationTake;
    assert.deepEqual(afterNormal,beforeNormal,'The deliberate paused normal key probe never changes a score pass or assessment');assert.deepEqual(afterNormalEvidence.events.slice(0,beforeNormalEvidence.events.length),beforeNormalEvidence.events);
    const normalProbe=afterNormalEvidence.events.slice(beforeNormalEvidence.events.length);assert.deepEqual(normalProbe.map(event=>[event.kind,event.midi,event.encoding,event.onset_capture]),[['note_on',60,'key_down',null],['note_off',null,'key_up',null]],'Retain exactly the intentional normal keydown/keyup as raw, ungraded evidence');assert.deepEqual({...afterNormalEvidence,events:beforeNormalEvidence.events},beforeNormalEvidence);
    await page.locator('#free-start').click();const freeHeld=await held('free');assert.deepEqual(normalHeld.style,freeHeld.style,'An actual held C4 has identical visible feedback in both modes');
    const unpressed=(await readSharedPianoGeometry(page,'free')).keys.find(key=>key.midi===60);assert.notDeepEqual(freeHeld.style,unpressed.style,'Pressed feedback is visibly different from idle');
    await page.locator('#free-practice-title').focus();await page.evaluate(()=>document.dispatchEvent(new CompositionEvent('compositionstart',{bubbles:true})));await page.keyboard.press('r');assert.equal(await page.locator('#free-practice-keys .pressed').count(),0);await page.evaluate(()=>document.dispatchEvent(new CompositionEvent('compositionend',{bubbles:true})));
    await page.keyboard.down('r');await page.waitForFunction(()=>document.querySelector('#free-practice-keys .pressed'));await page.locator('#free-keyboard-settings').click();await page.waitForFunction(()=>!document.querySelector('#free-practice-keys .pressed'));await page.keyboard.up('r');await closeShellPanels();
    assert.equal(await page.locator('#free-practice-screen').getAttribute('data-state'),'paused');await page.locator('#rhythm-free-resume').click();assert.equal(await page.locator('#keyboard .pressed').count(),0);
    assert.deepEqual(await exportTakeData(),freeIsolationTake,'Free input, IME and navigation cannot mutate the retained normal take');assert.deepEqual(await exportScore(),score);
    await closeShellPanels();await page.locator('#rhythm-stage-free').click();await footerProof('free');await page.locator('#free-resume').click();await page.locator('#free-practice-title').focus();await page.keyboard.down('r');await page.waitForFunction(()=>document.querySelector('#free-practice-keys [data-midi="60"].pressed'));
    await page.locator('#keyboard-semitone-up').click();assert.equal(await page.locator('#keyboard-current-offset').textContent(),'+1');await page.waitForFunction(()=>!document.querySelector('#free-practice-keys .pressed'));await page.keyboard.down('r');assert.equal(await page.locator('#free-practice-keys .pressed').count(),0,'Repeated held typing cannot restart input after footer transposition');await page.keyboard.up('r');await page.locator('#free-practice-title').focus();await page.keyboard.press('r');await page.locator('#free-stop').click();
    if(!await page.locator('#free-recordings').evaluate(node=>node.open))await page.locator('#free-recordings-toggle').click();
    const [freeDownload]=await Promise.all([page.waitForEvent('download'),page.locator('#free-export-draft').click()]);const freeStream=await freeDownload.createReadStream();let freeJson='';for await(const chunk of freeStream)freeJson+=chunk;const footerRecord=JSON.parse(freeJson);
    assert.deepEqual(footerRecord.observations.events.filter(event=>event.kind==='note_on').map(event=>event.midi),[60,60,60,61]);assert.deepEqual(footerRecord.configuration.filter(row=>row.key==='keyboard_configuration').map(row=>row.value.transpose_semitones),[0,1]);
    await page.locator('#rhythm-free-resume').click();await footerProof('normal');assert.equal(await page.locator('#keyboard .pressed').count(),0);const {keyboard_input_configuration:oldConfiguration,...oldTake}=freeIsolationTake,{keyboard_input_configuration:newConfiguration,...newTake}=await exportTakeData();assert.deepEqual(newTake,oldTake,'Using shared free transpose leaves every retained score pass, clock and assessment unchanged');assert.deepEqual(newConfiguration.events.slice(0,oldConfiguration.events.length),oldConfiguration.events);assert.equal(newConfiguration.current_configuration.transpose_semitones,1);assert.deepEqual(await exportScore(),score);await footerNode.dispose();
    const sharedFooter={one_original_node:true,mode_cleanup_preserved:true,transpose_configuration:footerRecord.configuration.filter(row=>row.key==='keyboard_configuration'),actual_free_onsets:footerRecord.observations.events.filter(event=>event.kind==='note_on').map(event=>event.midi),score_passes_preserved:true};
    await writeFile(join(artifactDirectory,'worldmusichub-shared-piano-stage.json'),JSON.stringify({original_fixtures_only:true,configured_range:{key_count:61,lowest_midi:36,highest_midi:96},localeProof,evidence,compactHeaderProof,normalProbe,sharedFooter,held:{normal:normalHeld,free:freeHeld},actual_paired_screenshots:true,normal_take_preserved:true,score_preserved:true,ime_suppressed:true,protected_control_released_input:true,navigation_released_input:true},null,2));
  });
  test('original falling bars visibly cross staff and Jianpu lane background during actual playback',{timeout:90_000},async()=>{
    const page=getPage(),score=originalAboveKeyboardScore(),evidence=[];await installPlaybackClockReader(page);await waitForPlaybackClock(page);score.id='original-live-overlay';score.title='Original live falling-lane overlay';score.tempo[0].bpm=60;
    await ui('#instrument').selectOption('piano');await ui('#key-count').selectOption('61');await setSessionMode('listen');await ui('#count-in').uncheck();await ui('#score-file').setInputFiles({name:`${score.id}.json`,mimeType:'application/json',buffer:Buffer.from(JSON.stringify(score))});await readyForTitle(score.title);
    await ui('#interface-language').selectOption('zh-CN');await ui('#theme-mode').selectOption('light');await page.emulateMedia({reducedMotion:'no-preference'});
    for(const viewport of [{width:1280,height:720},{width:1920,height:1080},{width:1033,height:403},{width:844,height:390},{width:390,height:844}])for(const [button,view]of [['#engraved-button','staff'],['#jianpu-button','jianpu']]){
      await page.setViewportSize(viewport);await ui('#interface-language').selectOption([1920,844].includes(viewport.width)?'zh-CN':'en');await ui(button).click();await ui('#engraving-follow').check();await closeShellPanels();if(view==='staff')await waitForEngraving();
      if(await page.locator('#notice-dismiss').isVisible())await page.locator('#notice-dismiss').click();await page.locator('#reset-button').click();await page.locator('#play-button').click();
      await page.waitForFunction(()=>globalThis.__wmhReadPlaybackClock().positionMs>300&&document.querySelector('#stage-cue').hidden);
      const toolbar=await readSharedPianoGeometry(page);assertPianoToolbarLabels(toolbar);
      const geometry=await readLaneOverlayGeometry(page);assertLaneOverlay(geometry);assert.ok(geometry.canvasAlpha.opaque>20,'The real canvas contains painted falling blocks');
      const selector=view==='staff'?'.engraving-expected-cue:not([hidden])':'#notation .score-note.active',current=await page.locator(selector).count();assert.equal(current,2,'Both original staff voices are visibly followed while playing');
      const hud=await readNotationHudGeometry(page,selector);await writeFile(join(artifactDirectory,'worldmusichub-live-notation-hud-checkpoint.json'),JSON.stringify({original_fixtures_only:true,viewport,view,playing:true,hud},null,2));assertNotationHudClear(hud);
      assert.equal(await page.locator('#notation-tools').evaluate(node=>node.open),false,'Music keeps rendering while its controls are closed');
      await page.screenshot({path:join(artifactDirectory,`worldmusichub-lane-overlay-live-${viewport.width}x${viewport.height}-${view}.png`),fullPage:true,animations:'disabled'});
      await page.locator('#play-button').click();await settlePianoPaint(page);
      const pausedHud=await readNotationHudGeometry(page,selector);assert.equal(pausedHud.cueState,'paused');assertNotationHudClear(pausedHud);
      evidence.push({viewport,view,geometry,toolbar_labels:toolbar.labels,locale:toolbar.locale,current_markers:current,playing:true,controls_closed:true,hud,pausedHud});
    }
    assert.deepEqual(await exportScore(),score);await writeFile(join(artifactDirectory,'worldmusichub-lane-overlay-live.json'),JSON.stringify({original_fixtures_only:true,actual_playback:true,evidence},null,2));
  });

}
