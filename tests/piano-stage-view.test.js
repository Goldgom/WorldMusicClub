import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {parseHTML} from 'linkedom';
import {keyboardGeometry} from '../web/music.js';
import {mountPianoStage,renderPianoKeybed,renderPianoRails,createPianoToolbar,updatePianoToolbarTitles,pianoMinimumWidth,observePianoNoticeBudget} from '../web/piano-stage-view.js';
import {assertPianoToolbarClear} from './shared-piano-stage-browser-regression.js';

test('shared stage mounting keeps the original interactive keybed, falling canvas and strike nodes',()=>{
  const {document}=parseHTML('<section id="stage"><div id="scroll"><div id="surface"><canvas></canvas><div class="strike-line"></div><div id="keyboard"><button data-midi="60" aria-pressed="true"></button></div></div></div></section>');
  const stage=document.getElementById('stage'),scroll=document.getElementById('scroll'),surface=document.getElementById('surface'),keyboard=document.getElementById('keyboard'),canvas=document.querySelector('canvas'),strike=surface.querySelector('.strike-line'),key=keyboard.firstElementChild;
  let presses=0;key.addEventListener('click',()=>presses++);
  const first=mountPianoStage({document,stage,scroll,surface,keyboard,canvas});
  const second=mountPianoStage({document,stage,scroll,surface,keyboard,canvas,lane:first.lane});
  assert.equal(first.lane,second.lane);assert.equal(first.rails,second.rails);assert.equal(first.strike,strike);assert.equal(second.strike,strike);assert.equal(canvas.parentElement,first.lane);assert.equal(keyboard.firstElementChild,key);assert.equal(key.getAttribute('aria-pressed'),'true');key.click();assert.equal(presses,1);
  assert.equal(surface.querySelectorAll('.piano-lanes-shared').length,1);assert.equal(surface.querySelectorAll('.piano-rails-shared').length,1);assert.equal(surface.querySelectorAll('.strike-line').length,1);assert.equal(first.lane.nextElementSibling,strike);assert.equal(strike.nextElementSibling,keyboard);
});

test('both mode keybeds have identical configured chromatic geometry, labels and rail coordinates',()=>{
  const {document}=parseHTML('<main></main>');
  for(const [count,lowest]of [[49,48],[61,36],[76,28],[88,21],[12,115]]){
    const geometry=keyboardGeometry(count,lowest),normal=document.createElement('div'),free=document.createElement('div'),rails=document.createElement('div');
    const bindings=[{code:'KeyR',label:'R',midi:60,enabled:true},{code:'KeyA',label:'alias',midi:60,enabled:true},{code:'KeyQ',label:'disabled',midi:61,enabled:false},{code:'KeyZ',label:'outside',midi:127,enabled:true}];
    const options={document,geometry,bindings,labelForNote:midi=>`Play MIDI ${midi}`};
    renderPianoKeybed({...options,keyboard:normal});renderPianoKeybed({...options,keyboard:free,decorateKey:key=>key.classList.add('free-practice-key')});renderPianoRails({document,rails,geometry});
    const details=node=>[...node.children].map(key=>({midi:Number(key.dataset.midi),left:key.style.left,width:key.style.width,black:key.classList.contains('black'),label:key.getAttribute('aria-label'),pressed:key.getAttribute('aria-pressed'),disabled:key.disabled,legend:key.querySelector('.key-shortcut').textContent}));
    assert.deepEqual(details(normal),details(free));assert.equal(normal.children.length,count);assert.deepEqual([normal.firstElementChild.dataset.midi,normal.lastElementChild.dataset.midi],[String(lowest),String(lowest+count-1)]);
    assert.deepEqual([...rails.children].map(node=>({midi:Number(node.dataset.pitch),left:node.style.left,width:node.style.width,black:node.classList.contains('black')})),details(normal).map(({midi,left,width,black})=>({midi,left,width,black})));
    assert.equal(pianoMinimumWidth(geometry),Math.max(640,geometry.filter(key=>!key.black).length*22));
    if(lowest<=60&&lowest+count>60){assert.equal(normal.querySelector('[data-midi="60"] .key-shortcut').textContent,'R / alias');assert.equal(normal.querySelector('[data-midi="61"] .key-shortcut').textContent,'');}
    assert.equal(normal.querySelector('[data-code="KeyZ"]'),null,'An out-of-range PC binding never silently expands the configured visual range');
    assert.ok([...normal.children].every(key=>!key.disabled),'Visual range is independent of whether a PC shortcut maps to a key');
  }
});

test('shared toolbar reuses mode-owned action handlers and marks them as nonmusical controls',()=>{
  const {document}=parseHTML('<h2>Piano</h2><div><button>Sound</button></div>'),title=document.querySelector('h2'),actions=document.querySelector('div'),button=actions.firstElementChild;let count=0;button.addEventListener('click',()=>count++);
  const toolbar=createPianoToolbar({document,title,actions});assert.equal(toolbar.dataset.keyboardInput,'off');assert.equal(toolbar.firstElementChild,title);assert.equal(toolbar.lastElementChild,actions);assert.equal(actions.firstElementChild,button);button.click();assert.equal(count,1);
  assert.equal(button.title,'Sound');button.textContent='声音已关闭';button.setAttribute('aria-pressed','true');updatePianoToolbarTitles(actions);assert.equal(button.title,'声音已关闭');assert.equal(button.textContent,'声音已关闭');assert.equal(button.getAttribute('aria-pressed'),'true');assert.equal(actions.firstElementChild,button);button.click();assert.equal(count,2);
});

test('narrow shared toolbar icons preserve their row and distinguish actual normal/Free Sound states',async()=>{
  const css=await readFile(new URL('../web/piano-stage.css',import.meta.url),'utf8');
  const {document}=parseHTML(`<style>${css}</style><main class="game-shell"><section class="piano-stage-toolbar"><button id="sound-button" aria-pressed="true"></button><button id="free-sound" aria-pressed="false"></button></section></main>`);
  const rules=[...document.querySelector('style').sheet.cssRules].filter(rule=>rule.media?.mediaText==='(max-height:600px) and (min-width:651px) and (max-width:800px)').flatMap(rule=>[...rule.cssRules]);
  const actions=rules.find(rule=>rule.selectorText.endsWith('.piano-stage-actions>.button'));
  for(const [property,value]of Object.entries({width:'36px','min-width':'36px',height:'32px','min-height':'32px',overflow:'hidden','text-indent':'-9999px'}))assert.equal(actions.style[property],value);
  const sound=rules.find(rule=>rule.selectorText.endsWith(':is(#sound-button,#free-sound)'));
  assert.equal(sound.style['min-width'],'36px','The original ID-specific 100px Sound minimum must yield at this breakpoint');
  const muted=rules.find(rule=>rule.selectorText.includes('#sound-button[aria-pressed=true]'));
  assert.notEqual(muted.style['--piano-action-icon'],sound.style['--piano-action-icon']);
  for(const [id,pressed]of [['sound-button','false'],['free-sound','true']]){
    const node=document.getElementById(id);assert.equal(node.matches(muted.selectorText),true);node.setAttribute('aria-pressed',pressed);assert.equal(node.matches(muted.selectorText),false,'The same visible Sound state uses the correct original polarity');
  }
});

test('toolbar evidence rejects the observed Sound/checkbox overlap and every intercepted native control',()=>{
  const box=(id,x,width)=>({id,rect:{x,y:104,width,height:32,right:x+width,bottom:136},hit:true});
  const midi=box('piano-connect-midi',21,88),mapping=box('piano-keyboard-settings',115,108),sound=box('sound-button',230,100),checkbox=box('notation-overlay-visible',294,13),label=box('notation-overlay-visible-label',294,130),opacity=box('notation-overlay-opacity',490,52),opacityLabel=box('notation-overlay-opacity-label',440,160);
  const geometry={mode:'normal',locale:'en',viewport:{width:651,height:390},toolbar:{x:10,y:100,right:641,bottom:140},controls:[midi,mapping,sound],toolbarTargets:[midi,mapping,sound,checkbox,opacity],toolbarGroups:[midi,mapping,sound,label,opacityLabel]};
  assert.throws(()=>assertPianoToolbarClear(geometry),/toolbar bounds overlap/);
  const fixed=structuredClone(geometry);for(const [index,id]of ['piano-connect-midi','piano-keyboard-settings','sound-button'].entries()){const control=box(id,21+index*42,36);fixed.controls[index]=fixed.toolbarTargets[index]=fixed.toolbarGroups[index]=control;}assert.doesNotThrow(()=>assertPianoToolbarClear(fixed));
  for(const control of fixed.toolbarTargets){const original=control.hit;control.hit=false;assert.throws(()=>assertPianoToolbarClear(fixed),/receives its own hit/);control.hit=original;}
  const missing=structuredClone(fixed);missing.toolbarTargets=missing.toolbarTargets.filter(control=>control.id!=='notation-overlay-visible');assert.throws(()=>assertPianoToolbarClear(missing),/remains visible/);
});

 test('notice budget tracks the rendered original banner and restores the shared lane allocation on dismissal',()=>{
  const {document:dom}=parseHTML('<html><body><p id="notice" hidden>Notice</p></body></html>'),banner=dom.getElementById('notice'),callbacks={},observed=[];let height=32,disposed=0,frame;const flush=()=>{const callback=frame;frame=null;callback?.();},window={requestAnimationFrame(callback){frame=callback;return 1;},cancelAnimationFrame(){frame=null;},addEventListener(type,callback){callbacks[type]=callback},removeEventListener(type,callback){assert.ok(callbacks[type]===callback);delete callbacks[type]}},document={defaultView:window,body:dom.body,getElementById:id=>dom.getElementById(id)};
  banner.getBoundingClientRect=()=>({height});window.getComputedStyle=()=>({marginTop:'2px',marginBottom:'3px'});
  window.ResizeObserver=class{constructor(callback){callbacks.resizeObserver=callback}observe(node){observed.push(node)}disconnect(){disposed++}};window.MutationObserver=class{constructor(callback){callbacks.mutation=callback}observe(node,options){observed.push(node);assert.deepEqual(options.attributeFilter,['hidden'])}disconnect(){disposed++}};
  const stop=observePianoNoticeBudget({document}),budget=()=>document.body.style.getPropertyValue('--piano-notice-space');flush();assert.equal(budget(),'0px');assert.ok(observed.every(node=>node===banner));
  banner.hidden=false;callbacks.mutation();flush();assert.equal(budget(),'37px');height=54.2;callbacks.resizeObserver();flush();assert.equal(budget(),'60px');banner.hidden=true;callbacks.mutation();flush();assert.equal(budget(),'0px','Dismissal restores the complete shared normal/free lane budget');
  banner.hidden=false;callbacks.resize();flush();assert.equal(budget(),'60px');stop();assert.equal(disposed,2);assert.ok(!budget());
 });
