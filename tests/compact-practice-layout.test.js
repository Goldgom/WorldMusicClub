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
import {setupSongModView} from '../web/song-mod-view.js';
import {defaultSongMod} from '../web/song-mod.js';
import {browserMarkerVisibility} from './browser-marker-visibility.js';

test('long Mod diagnostics scroll with preview details while source identity, admission and Start stay anchored',()=>{
  const {document}=parseHTML('<body><section class="song-preview"><div class="preview-identity"><h2 id="preview-title">Retained source</h2><p id="preview-meta">Composer and source</p></div><div class="preview-copy"><p id="preview-status">Full source notices</p></div><div class="preview-footer"><p id="preview-gate">Blocked instrument range</p><div class="preview-actions"><button id="open-score" hidden>Inspect</button></div></div></section><main id="workspace"><div class="stage-hud"></div></main></body>');
  const i18n={locale:'en',subscribe(){}},view=setupSongModView({document,i18n,getContext:()=>null,onApply(){},onStart(){}});
  const mod=defaultSongMod({score:{id:'long-source',parts:[{id:'one'},{id:'two'}]},mode:'practice'}),reason='Selected notes outside this instrument range: 18. Change the range, tuning, part or loop before practicing. '.repeat(12);
  const copy=document.querySelector('.preview-copy'),footer=document.querySelector('.preview-footer'),identity=document.querySelector('.preview-identity'),summary=document.getElementById('song-mod-preview-summary'),configure=document.getElementById('configure-song-mod');
  for(const locale of ['en','zh-CN']){
    i18n.locale=locale;view.update({preview:{mod},stage:{mod},canStart:false,reason});
    assert.equal(summary.parentElement,copy);assert.equal(copy.firstElementChild,summary,'The current configuration is the first item in the existing detail scroller');
    assert.equal(summary.textContent.endsWith(reason),true,'No Mod diagnostic is shortened or discarded');
    assert.equal(summary.hidden,false);assert.equal(summary.getAttribute('aria-hidden'),null);assert.equal(summary.getAttribute('role'),'status');
    assert.equal(configure.getAttribute('aria-describedby'),summary.id,'The pinned Mod control still exposes its complete current description');
    assert.equal(document.getElementById('preview-title').parentElement,identity);assert.equal(document.getElementById('preview-meta').parentElement,identity);
    assert.equal(document.getElementById('preview-gate').parentElement,footer);
    assert.deepEqual([...footer.children].map(node=>node.className||node.id),['preview-gate','preview-actions'],'Only admission and the original actions consume pinned footer height');
    assert.deepEqual([...document.querySelectorAll('.preview-actions button')].filter(node=>!node.hidden).map(node=>node.id),['start-performance','configure-song-mod']);
  }
  view.update({reason,inspectionOnly:true});
  assert.equal(document.getElementById('open-score').parentElement,footer,'Inspection-only sources retain their existing pinned action');
});

test('portrait Mod keeps one readable button row without reserving another row for its summary',async()=>{
  // A CSS contract only; actual field dimensions remain checked by D768 and
  // the shared-stage hosted suites with their unchanged viewport thresholds.
  const css=await readFile(new URL('../web/piano-stage.css',import.meta.url),'utf8');
  const {document}=parseHTML(`<style>${css}</style><body class="game-shell"><main id="workspace" class="piano-workspace"><div class="piano-workspace-heading"><section id="song-mod-stage"><button id="edit-song-mod"></button><span id="song-mod-stage-summary"></span></section></div></main></body>`);
  const rules=[...document.querySelector('style').sheet.cssRules].filter(rule=>rule.media?.mediaText==='(max-width:650px)').flatMap(rule=>[...rule.cssRules]);
  const mod=rules.findLast(rule=>rule.selectorText.endsWith('>#song-mod-stage')),button=rules.findLast(rule=>rule.selectorText.endsWith(' #edit-song-mod')),summary=rules.findLast(rule=>rule.selectorText.endsWith(' #song-mod-stage-summary'));
  assert.equal(mod.style.flex,'1 1 100%');assert.equal(mod.style['flex-wrap'],'nowrap');assert.equal(mod.style.padding,'0');
  assert.equal(button.style.flex,'none');assert.equal(button.style['white-space'],'nowrap','Mod keeps its full label and inherited touch-target height');
  assert.equal(summary.style['min-width'],'0');assert.equal(summary.style['white-space'],'nowrap');assert.equal(summary.style.overflow,'hidden');assert.equal(summary.style['text-overflow'],'ellipsis');
  for(const rule of [mod,button,summary])for(const property of ['display','visibility','pointer-events','height','min-height'])assert.equal(rule.style.getPropertyValue(property),'','The compact arrangement does not hide controls or shrink their original targets');
  for(const piano of [true,false,true]){
    document.getElementById('workspace').classList.toggle('piano-workspace',piano);
    for(const [id,rule]of [['song-mod-stage',mod],['edit-song-mod',button],['song-mod-stage-summary',summary]])assert.equal(document.getElementById(id).matches(rule.selectorText),true,`${id} keeps its compact arrangement across piano and guitar`);
  }
});

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
  const closed='.performance-layout #workspace .guitar-stage:not(:has(#guitar-plan-controls[open],.guitar-details[open]))';
  assert.equal(rule(closed)['grid-template-rows'],'minmax(0,1fr) 56px max-content','A tall live matrix must yield space to the complete first fret row and disclosures');
  assert.equal(rule(closed+' #guitar-guidance')['max-height'],'100%');assert.equal(rule(closed+' #guitar-guidance').overflow,'auto','All matrix rows remain reachable through their own bounded scroller');
  assert.equal(rule('.performance-layout #guitar-planning')['grid-column'],'1');
  assert.equal(rule('.performance-layout .guitar-details')['grid-column'],'2');
  const expanded=rule('.performance-layout .guitar-stage:has(#guitar-plan-controls[open]),.performance-layout .guitar-stage:has(.guitar-details[open]),.performance-layout .play-panel:has(#practice-gate:not([hidden])) .guitar-stage');
  assert.equal(expanded['grid-template-rows'],'max-content max-content max-content','An explicitly taller board must expand its grid track before the disclosure row');
  assert.equal(expanded['grid-auto-rows'],'max-content','A full-width open disclosure can create another row, which must also retain its content height');
});

test('compact guitar guidance shows both complete chosen shapes before its scrollable explanation',async()=>{
  const css=await readFile(new URL('../web/guitar-live-guidance.css',import.meta.url),'utf8'),{document}=parseHTML(`<style>${css}</style>`);
  const rules=[...document.querySelector('style').sheet.cssRules].find(rule=>rule.media?.mediaText==='(max-height:600px) and (min-width:651px)').cssRules;
  const rule=selector=>[...rules].find(item=>item.selectorText===selector).style;
  assert.equal(rule('#guitar-live-route').display,'flex');assert.equal(rule('#guitar-live-route')['flex-direction'],'column');assert.equal(rule('.guitar-live-band').order,'-1');assert.equal(rule('.guitar-live-band').flex,'none');
  const padding=rule('.performance-layout #guitar-guidance,.performance-layout #workspace.with-notation #guitar-guidance').padding;
  assert.equal(padding,'1px 7px');
  const position=parseFloat(rule('.guitar-live-position')['line-height']),action=parseFloat(rule('.guitar-live-action')['line-height']);
  assert.ok(position+action>=24,'Every current and next choice retains its original complete two-line marker');
  // Real 500 markers are 28px; heading 14.296875px. The table includes the
  // tuning line, solid current separator, dashed next separator and borders.
  const table=14+(position+action+1)+(position+action+2)+2,heading=14.296875;
  assert.equal(table,75);assert.ok(heading+table+2*parseFloat(padding)+2<94,'Both chosen shapes fit before the retained legend and transition text');
  for(const selector of ['#guitar-live-route','.guitar-live-band'])for(const property of ['visibility','max-height','overflow'])assert.equal(rule(selector).getPropertyValue(property),'','Guidance text is reordered, never removed or clipped');
});

test('portrait score scope uses a reserved title slot instead of overflowing the background controls',async()=>{
  const css=await readFile(new URL('../web/piano-stage.css',import.meta.url),'utf8'),{document}=parseHTML(`<style>${css}</style>`);
  const rules=[...document.querySelector('style').sheet.cssRules].filter(rule=>rule.media?.mediaText==='(max-width:650px)').flatMap(rule=>[...rule.cssRules]),style=selector=>rules.findLast(rule=>rule.selectorText===selector).style;
  assert.equal(style('.game-shell .piano-stage-toolbar .notation-overlay-options').display,'contents');
  const scope=style('.game-shell .piano-stage-toolbar .notation-scope-summary');assert.equal(scope['grid-column'],'1/span 2');assert.equal(scope['grid-row'],'1');assert.equal(scope['align-self'],'end');
  const title=style('.game-shell .piano-stage-shared .piano-stage-title');assert.ok(parseFloat(title['line-height'])+2*parseFloat(scope['line-height'])<=40,'Piano title and two readable scope lines fit above the separate options row');
  for(const [selector,column]of [[':first-child','1/span 5'],[':nth-child(2)','6/span 4']]){const label=style('.game-shell .piano-stage-toolbar .notation-overlay-options>label'+selector);assert.equal(label['grid-column'],column);assert.equal(label['grid-row'],'2');}
  assert.equal(style('.game-shell .piano-stage-toolbar .notation-tools')['grid-column'],'10/-1','Score options retain their original, nonoverlapping native target');
});

test('piano score options pin paging and complete Follow status ahead of long scope and help content',async()=>{
  const css=await readFile(new URL('../web/piano-stage.css',import.meta.url),'utf8'),{document}=parseHTML(`<style>${css}</style>`),rules=[...document.querySelector('style').sheet.cssRules];
  const style=selector=>rules.findLast(rule=>rule.selectorText===selector).style,prefix='.game-shell #workspace.notation-on-lanes #notation-dock';
  const pane=style(prefix+' .notation-panel'),children=style(prefix+' .notation-panel>*'),follow=style(prefix+' .engraving-follow-controls'),status=style(prefix+' #engraving-follow-status');
  assert.equal(pane.display,'flex');assert.equal(pane['flex-direction'],'column');assert.equal(pane.overflow,'visible');assert.equal(children.flex,'none','Long content cannot shrink the controls beneath their native targets');
  assert.equal(follow.order,'-1');assert.equal(follow.position,'sticky');assert.equal(follow.top,'0');assert.equal(follow['flex-wrap'],'wrap');assert.equal(follow.background,'var(--paper)','Scrolled explanations cannot paint through the pinned controls');
  assert.equal(status['flex-basis'],'100%');assert.equal(status['white-space'],'normal','Follow status keeps its own readable full-width row below paging and checkbox');
  assert.equal(style(prefix).overflow,'auto','All retained scope, source and help details remain reachable in the original pane');
  for(const selector of [prefix+' .notation-panel',prefix+' .engraving-follow-controls',prefix+' #engraving-follow-status'])for(const property of ['height','max-height','text-overflow'])assert.equal(style(selector).getPropertyValue(property),'','The pinned content is not clipped or shortened');
});


test('selected guitar ownership shares the full stage width before the two compact disclosures',async()=>{
  // Check the final cascade and actual selector applicability, not a simulated
  // browser height. Hosted tests retain the 98% / 24px marker requirements.
  const files=['performance-stage.css','guitar-live-guidance.css'];
  const css=(await Promise.all(files.map(file=>readFile(new URL('../web/'+file,import.meta.url),'utf8')))).join('\n');
  const {document}=parseHTML(`<style>${css}</style><body class="performance-layout"><main id="workspace" class="with-notation"><div class="guitar-stage"><div id="guitar-guidance"></div><div class="guitar-scroll"></div><section id="guitar-planning"><p id="guitar-selected-parts">Human parts: Guitar · 18 source occurrences in this selection</p><details id="guitar-plan-controls"><summary>Route settings</summary><p id="guitar-plan-status">One whole-phrase route · 18</p></details></section><details class="guitar-details"><summary>Tuning &amp; sources</summary></details></div></main></body>`);
  const rules=[...document.querySelector('style').sheet.cssRules].filter(rule=>rule.media?.mediaText==='(max-height:600px) and (min-width:651px)').flatMap(rule=>[...rule.cssRules]);
  const selected='.performance-layout #workspace .guitar-stage:has(#guitar-selected-parts):not(:has(#guitar-plan-controls[open],.guitar-details[open]))';
  const rule=selector=>rules.findLast(item=>item.selectorText===selector).style;
  const stage=document.querySelector('.guitar-stage'),planning=document.getElementById('guitar-planning'),label=document.getElementById('guitar-selected-parts'),route=document.getElementById('guitar-plan-controls'),sources=document.querySelector('.guitar-details');
  assert.equal(stage.matches(selected),true);assert.equal(planning.matches(selected+' #guitar-planning'),true);
  assert.equal(rule(selected)['grid-template-rows'],'minmax(0,1fr) 56px max-content max-content');
  assert.equal(rule(selected+' #guitar-planning').display,'contents','Only the closed planning wrapper stops reserving its own half-width footer row');
  const scope=rule(selected+' #guitar-selected-parts');assert.equal(scope['grid-column'],'1/-1');assert.equal(scope['grid-row'],'3');assert.equal(scope.margin,'0');assert.equal(scope['line-height'],'1.4');
  assert.equal(scope['max-height'],'2.8em');assert.equal(scope.overflow,'auto','Long source names stay reachable in a bounded scroller');assert.equal(scope['overflow-wrap'],'anywhere');
  for(const property of ['font-size','display','visibility','text-overflow','white-space','-webkit-line-clamp'])assert.equal(scope.getPropertyValue(property),'','Full labels keep their existing 12px font and wrap without elision');
  assert.equal(rule(selected+' #guitar-plan-controls')['grid-column'],'1');assert.equal(rule(selected+' #guitar-plan-controls')['grid-row'],'4');
  assert.equal(rule(selected+' .guitar-details')['grid-column'],'2');assert.equal(rule(selected+' .guitar-details')['grid-row'],'4');
  for(const disclosure of [route,sources]){disclosure.setAttribute('open','');assert.equal(stage.matches(selected),false,'Opening either existing control restores the original editor/source layout');disclosure.removeAttribute('open');assert.equal(stage.matches(selected),true);}
  assert.equal(label.textContent,'Human parts: Guitar · 18 source occurrences in this selection');assert.equal(route.querySelector('summary').textContent,'Route settings');assert.equal(sources.querySelector('summary').textContent,'Tuning & sources');
  // Recorded source dimensions from hosted run 37560469397: the old half-width
  // label was two 19.1875px lines, plus 24px of default paragraph margins. The
  // new full-width single line recovers >40px without changing marker fonts.
  const recovered=2*19.1875+24-12*Number(scope['line-height']);
  const oldVisibleNext=28*0.09654017857142858;
  assert.ok(recovered>28-oldVisibleNext+3,'Recovered footer space exceeds the observed missing Next marker height plus the added grid gap');
});


test('marker visibility skips only boxless contents wrappers and still enforces every real clip',()=>{
  const prior=new Map(['innerWidth','innerHeight','HTMLElement','SVGElement','SVGSVGElement','getComputedStyle'].map(name=>[name,Object.getOwnPropertyDescriptor(globalThis,name)]));
  class HtmlBox {
    constructor(id,rect,style={},parentElement=null){Object.assign(this,{id,tagName:'DIV',dataset:{},textContent:id,parentElement,rect,style:{display:'block',visibility:'visible',opacity:'1',overflowX:'visible',overflowY:'visible',...style},clientLeft:0,clientTop:0,clientWidth:rect.width,clientHeight:rect.height});}
    getBoundingClientRect(){return this.rect;}
  }
  class SvgBox{}class SvgRoot extends SvgBox{}
  const rectangle=(left,top,width,height)=>({left,top,width,height,right:left+width,bottom:top+height});
  for(const [name,value]of Object.entries({innerWidth:844,innerHeight:390,HTMLElement:HtmlBox,SVGElement:SvgBox,SVGSVGElement:SvgRoot,getComputedStyle:node=>node.style}))Object.defineProperty(globalThis,name,{configurable:true,value});
  try{
    const stage=new HtmlBox('stage',rectangle(10,130,824,207),{overflowX:'hidden',overflowY:'auto'});
    const wrapper=new HtmlBox('guitar-planning',rectangle(0,0,0,0),{display:'contents',overflowX:'auto',overflowY:'auto'},stage);
    // The retained hosted report supplies width=802 and height=16.796875. The
    // coordinates here are a synthetic unit fixture, not new browser evidence.
    const label=new HtmlBox('guitar-selected-parts',rectangle(21,296,802,16.796875),{overflowX:'auto',overflowY:'auto'},wrapper);
    const measure=()=>browserMarkerVisibility([label])[0];
    let result=measure();assert.equal(result.fraction,1);assert.equal(result.painted,true);
    const transferred=Function(`return (${browserMarkerVisibility.toString()});`)();assert.deepEqual(transferred([label])[0],result,'The browser-evaluated function is self-contained after serialization');
    assert.deepEqual(result.boxlessAncestors,[{element:'#guitar-planning',display:'contents',overflowX:'auto',overflowY:'auto'}]);
    assert.deepEqual(result.clippingAncestors.map(item=>item.element),['#guitar-selected-parts','#stage']);
    assert.deepEqual(result.visibleRect,result.rect);
    // A real zero-height scroller is genuinely clipped; skipping every empty
    // ancestor rectangle would conceal the exact product failure we must catch.
    wrapper.style.display='block';result=measure();assert.equal(result.fraction,0);assert.ok(result.clippingAncestors.some(item=>item.element==='#guitar-planning'));
    wrapper.style.display='contents';stage.clientHeight=174.3984375;result=measure();assert.equal(result.fraction,.5);assert.ok(result.fraction<.98,'Real partial scope clipping still fails the unchanged browser criterion');
    stage.clientHeight=207;stage.clientWidth=412;result=measure();assert.ok(result.fraction<.51,'Real horizontal clipping outside a boxless wrapper remains authoritative');
    stage.clientWidth=824;
    for(const [property,value]of [['opacity','0'],['visibility','hidden'],['display','none']]){const saved=wrapper.style[property];wrapper.style[property]=value;assert.equal(measure().painted,false);wrapper.style[property]=saved;}
    label.rect=rectangle(21,380,802,16.796875);result=measure();assert.equal(result.fraction,0,'The real stage and viewport still clip an offscreen marker');
  }finally{for(const[name,descriptor]of prior)if(descriptor)Object.defineProperty(globalThis,name,descriptor);else delete globalThis[name];}
});
