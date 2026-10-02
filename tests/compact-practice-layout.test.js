import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {parseHTML} from 'linkedom';
import {notationRevealViewport,createBasicNotationReveal} from '../web/notation-follow.js';
import {planEngravingReveal} from '../web/engraving-reveal.js';
import {setupGameShell} from '../web/game-shell.js';
import {setupPerformanceView} from '../web/performance-view.js';
import {setupKeyboardInputView} from '../web/keyboard-input-view.js';
import {createKeyboardInput} from '../web/keyboard-input.js';
import {createI18n} from '../web/i18n.js';

function notationGeometry() {
  const {document}=parseHTML('<aside id="dock"><section class="short-notation"><div class="engraving-follow-controls"></div><div id="notation"><svg><g class="score-note" data-note-id="current"></g></svg></div></section></aside>');
  const dock=document.getElementById('dock'),container=document.getElementById('notation'),toolbar=document.querySelector('.engraving-follow-controls');
  Object.assign(dock,{clientTop:1,clientLeft:1,clientWidth:388,clientHeight:304,scrollTop:200,scrollLeft:0,scrollHeight:1500,getBoundingClientRect:()=>({left:444,top:75,right:834,bottom:381}),scrollTo({top}){this.scrollTop=top}});
  Object.assign(container,{clientTop:0,clientLeft:0,clientWidth:372,clientHeight:1200,scrollTop:0,scrollLeft:0,scrollWidth:800,getBoundingClientRect:()=>({left:453,top:100,right:825,bottom:1300}),scrollTo({left}){this.scrollLeft=left}});
  toolbar.getBoundingClientRect=()=>({top:76,bottom:138,height:62});
  return {dock,container,toolbar};
}

test('compact follow reveal reserves the pinned toolbar rather than scrolling notes underneath it',()=>{
  const {dock,container,toolbar}=notationGeometry();
  const viewport=notationRevealViewport(dock,container);
  assert.equal(viewport.top,138);assert.equal(viewport.bottom,380);
  const hiddenByToolbar={left:510,right:522,top:106,bottom:120};
  const plan=planEngravingReveal([hiddenByToolbar],viewport),dy=plan.scrollTop-dock.scrollTop;
  assert.equal(plan.partial,false);
  assert.ok(hiddenByToolbar.top-dy>=138&&hiddenByToolbar.bottom-dy<=380);
  // Before it reaches the dock top, the toolbar's flow position is different.
  // Its eventual pinned height is the same reservation for this reveal.
  toolbar.getBoundingClientRect=()=>({top:180,bottom:242,height:62});
  assert.deepEqual(notationRevealViewport(dock,container),viewport);
  toolbar.getBoundingClientRect=()=>({top:76,bottom:160,height:84});
  assert.equal(notationRevealViewport(dock,container).top,160,'Wrapped status gets its actual full height');
});

test('basic notation follows inside the same reserved viewport and reports oversized groups honestly',()=>{
  const {dock,container}=notationGeometry(),note=container.querySelector('.score-note');
  note.getBoundingClientRect=()=>({left:510,right:522,top:306-dock.scrollTop,bottom:320-dock.scrollTop});
  const reveal=createBasicNotationReveal({dock,container});
  assert.deepEqual(reveal.reveal('occurrence',['current']),{status:'ready'});
  assert.equal(dock.scrollTop,156);assert.equal(container.scrollTop,0);
  const rect=note.getBoundingClientRect();assert.ok(rect.top>=138&&rect.bottom<=380);
  const oversized=[{left:510,right:522,top:150,bottom:164},{left:510,right:522,top:400,bottom:414}];
  assert.equal(planEngravingReveal(oversized,notationRevealViewport(dock,container)).partial,true);
  dock.querySelector('.short-notation').classList.remove('short-notation');
  assert.equal(notationRevealViewport(dock,container).top,76,'Tall/manual presentation keeps its original viewport');
});

test('compact guitar footer retains both original controls and full labels with status in its editor',async()=>{
  const {document,window}=parseHTML(await readFile(new URL('../web/index.html',import.meta.url),'utf8'));
  const prior=new Map(['document','window'].map(name=>[name,Object.getOwnPropertyDescriptor(globalThis,name)]));
  Object.defineProperty(globalThis,'document',{configurable:true,value:document});Object.defineProperty(globalThis,'window',{configurable:true,value:window});
  window.matchMedia=()=>({matches:true,addEventListener(){},removeEventListener(){}});
  Object.defineProperty(window.HTMLSelectElement.prototype,'value',{configurable:true,get(){return this.querySelector('option[selected]')?.value||this.querySelector('option')?.value||''},set(value){for(const option of this.querySelectorAll('option'))option.toggleAttribute('selected',option.value===String(value))}});
  window.HTMLElement.prototype.showModal=function(){this.setAttribute('open','')};
  window.HTMLElement.prototype.close=function(){this.removeAttribute('open')};
  try {
    const controls=document.getElementById('guitar-plan-controls'),route=controls.querySelector('summary'),sources=document.querySelector('.guitar-details summary'),status=document.getElementById('guitar-plan-status');
    const routeLabel=route.textContent,sourceLabel=sources.textContent;
    setupGameShell({pausePlayback(){},onNotation(){},onScreen(){}});
    const keyboardView=setupKeyboardInputView({document,controller:createKeyboardInput(),i18n:createI18n({locale:'zh-CN'})});
    const inputFooter=document.querySelector('.keyboard-input-footer');
    setupPerformanceView({getContext:()=>({instrument:'guitar',mode:'practice',position:0,segmentStart:0,now:0,recorder:{active:null,interruptions:[]}})});
    assert.equal(controls.querySelector('summary'),route);assert.equal(document.querySelector('.guitar-details summary'),sources);
    assert.equal(status.parentElement,controls);assert.equal(status.previousElementSibling,route);
    assert.equal(route.getAttribute('aria-label'),routeLabel);assert.equal(sources.getAttribute('aria-label'),sourceLabel);
    assert.equal(route.textContent,'指法设置');assert.equal(sources.textContent,'调弦与来源');
    assert.equal(document.querySelectorAll('#guitar-plan-status').length,1);
    assert.equal(inputFooter.parentElement.id,'keyboard-input-settings','Performance setup must leave compact keyboard controls in their Settings section');
    assert.equal(document.querySelector('.play-panel>.keyboard-input-footer'),null);
    assert.equal(document.querySelector('#keyboard-compact-status').hidden,false);
    assert.equal(document.querySelector('#keyboard-compact-status').previousElementSibling.id,'stage-subtitle');
    keyboardView.destroy();
  } finally {
    for(const[name,descriptor]of prior)if(descriptor)Object.defineProperty(globalThis,name,descriptor);else delete globalThis[name];
  }
});

test('compact CSS reserves a complete fret row and allows the Follow toolbar to stick to its dock',async()=>{
  // A CSS contract, not browser geometry: Windows/Linux layout still needs the
  // real 844x390 suite with notehead and complete-marker visibility assertions.
  const css=await readFile(new URL('../web/performance-stage.css',import.meta.url),'utf8');
  const {document}=parseHTML(`<style>${css}</style>`);
  const rules=[...document.querySelector('style').sheet.cssRules].filter(rule=>rule.media?.mediaText==='(max-height:600px) and (min-width:651px)').flatMap(rule=>[...rule.cssRules]);
  const rule=selector=>rules.findLast(item=>item.selectorText===selector).style;
  assert.equal(rule('.performance-layout #notation-dock .short-notation').overflow,'visible');
  assert.equal(rule('.performance-layout #notation-dock .short-notation .engraving-follow-controls').position,'sticky');
  assert.equal(rule('.performance-layout .guitar-stage')['grid-template-rows'],'max-content minmax(56px,1fr) max-content','Full guidance and both disclosure summaries reserve their content height around a complete first fret row');
  assert.equal(rule('.performance-layout #guitar-planning')['grid-column'],'1');
  assert.equal(rule('.performance-layout .guitar-details')['grid-column'],'2');
  const expanded=rule('.performance-layout .guitar-stage:has(#guitar-plan-controls[open]),.performance-layout .guitar-stage:has(.guitar-details[open]),.performance-layout .play-panel:has(#practice-gate:not([hidden])) .guitar-stage');
  assert.equal(expanded['grid-template-rows'],'max-content max-content max-content','An explicitly taller board must expand its grid track before the disclosure row');
  assert.equal(expanded['grid-auto-rows'],'max-content','A full-width open disclosure can create another row, which must also retain its content height');
});
