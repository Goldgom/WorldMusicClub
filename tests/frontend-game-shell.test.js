import {createI18n} from '../web/i18n.js';
import {getAppI18n} from '../web/app-locale.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {parseHTML} from 'linkedom';
import {ScorePreview,filterCatalog,stageShortcutAllowed} from '../web/score-preview.js';
import {setupGameShell} from '../web/game-shell.js';
import {setupFullscreen} from '../web/fullscreen.js';
import {fixture} from './frontend-fixtures.js';

const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b});return{promise,resolve,reject}};
const compiled=score=>({score,timeline:{notes:[],duration_ms:1000},diagnostics:[]});
test('catalog browsing keeps its candidate separate and cannot activate a take',async()=>{
 const current={score:structuredClone(fixture),inputs:[{midi:60,at_ms:150}]},before=structuredClone(current),candidate={...structuredClone(fixture),id:'candidate'};
 const preview=new ScorePreview({compile:async score=>compiled(score),check:async()=>({status:'ready',reason:'Checked'})});
 await preview.select(candidate.id,async()=>candidate);assert.equal(preview.canStart('listen'),true);assert.equal(preview.canStart('practice'),true);assert.deepEqual(current,before);assert.equal(preview.value.score.id,'candidate');
});
test('stale fetch, compile and compatibility work never replaces a newer preview or imported score',async()=>{
 for(const slowStage of ['fetch','compile','check']){
  const gate=deferred(),entered=deferred();let oldSignal;
  const preview=new ScorePreview({compile:async(score,signal)=>{if(score.id==='old'&&slowStage==='compile'){oldSignal=signal;entered.resolve();await gate.promise}return compiled(score)},check:async(result,part,signal)=>{if(result.score.id==='old'&&slowStage==='check'){oldSignal=signal;entered.resolve();await gate.promise}return{status:'ready',reason:'Checked'}}});
  const old=preview.select('old',async signal=>{if(slowStage==='fetch'){oldSignal=signal;entered.resolve();await gate.promise}return{...fixture,id:'old'}});await entered.promise;
  const imported=compiled({...structuredClone(fixture),id:'imported'});preview.adopt(imported,{status:'ready',reason:'Imported'});gate.resolve();await old;
  assert.equal(oldSignal.aborted,true);assert.equal(preview.value.score.id,'imported');assert.equal(preview.value.compatibility.reason,'Imported');
 }
});
test('Listen remains available while Practice compatibility is pending, blocked or failed',async()=>{
 for(const condition of ['pending','blocked','error']){
  const gate=deferred(),entered=deferred();const preview=new ScorePreview({compile:async score=>compiled(score),check:async()=>{entered.resolve();await gate.promise;if(condition==='error')throw Error('Server unavailable');return{status:condition,reason:'Review range'}}});
  const work=preview.select('test',async()=>fixture);await entered.promise;assert.equal(preview.canStart('listen'),true);assert.equal(preview.canStart('practice'),false);gate.resolve();await work;assert.equal(preview.canStart('listen'),true);assert.equal(preview.canStart('practice'),false);
 }
});
test('failed compilation cannot enable either Start and an explicit retry can recover',async()=>{
 let fail=true;const preview=new ScorePreview({compile:async score=>{if(fail)throw Error('Review is required');return compiled(score)},check:async()=>({status:'ready',reason:'Checked'})});
 await preview.select('test',async()=>fixture);assert.equal(preview.value.status,'error');assert.equal(preview.canStart('listen'),false);assert.equal(preview.canStart('practice'),false);fail=false;await preview.select('test',async()=>fixture);assert.equal(preview.canStart('practice'),true);
});
test('stage shortcuts leave lobby buttons, panels, text entry and repeat keys to their normal controls',()=>{
 const args={screen:'stage',target:{tagName:'H1'}};assert.equal(stageShortcutAllowed(args),true);
 for(const tagName of ['A','SUMMARY','INPUT','SELECT','TEXTAREA'])assert.equal(stageShortcutAllowed({...args,target:{tagName}}),false);
 assert.equal(stageShortcutAllowed({...args,target:{tagName:'BUTTON'}}),true,'Letter shortcuts remain usable immediately after pressing Play; the Space handler separately leaves button activation native');
 for(const key of ['defaultPrevented','repeat','ctrlKey','metaKey','altKey','dialogOpen'])assert.equal(stageShortcutAllowed({...args,[key]:true}),false);
 assert.equal(stageShortcutAllowed({...args,screen:'library'}),false);assert.equal(stageShortcutAllowed({...args,target:{tagName:'DIV',isContentEditable:true}}),false);
});
test('catalog filters use title/composer and explicit source kind without altering canonical metadata',()=>{
 const scores=[{...fixture,title:'初见 · First Steps'},{...fixture,id:'d768',title:'Wandrers Nachtlied',composer:'Franz Schubert',provenance:{kind:'curated_cc0_edition'}}],before=structuredClone(scores);
 assert.equal(filterCatalog(scores,'ＦＩＲＳＴ').length,1);assert.equal(filterCatalog(scores,'Schubert Nachtlied')[0].id,'d768');assert.equal(filterCatalog(scores,'','original')[0].id,fixture.id);assert.equal(filterCatalog(scores,'','edition')[0].id,'d768');assert.deepEqual(scores,before);
});

test('static DOM shell keeps every source control exactly once and pauses on panel and screen transitions',async()=>{
 const html=await readFile(new URL('../web/index.html',import.meta.url),'utf8'),{document,window}=parseHTML(html),original=Object.getOwnPropertyDescriptor(globalThis,'document');
 Object.defineProperty(globalThis,'document',{configurable:true,value:document});let pauses=0,focused=null;const screens=[],notation=[];
 window.HTMLElement.prototype.focus=function(){focused=this;};
 window.HTMLElement.prototype.showModal=function(){this.setAttribute('open','')};window.HTMLElement.prototype.close=function(){this.removeAttribute('open');this.dispatchEvent(new window.Event('close'))};
 Object.defineProperty(window.HTMLElement.prototype,'open',{configurable:true,get(){return this.hasAttribute('open')},set(value){this.toggleAttribute('open',Boolean(value))}});
 try{
  const ids=[...document.querySelectorAll('[id]')].map(el=>el.id),shell=setupGameShell({pausePlayback:()=>pauses++,onScreen:value=>screens.push(value),onNotation:value=>notation.push(value)});
  for(const id of ids)assert.equal(document.querySelectorAll(`[id="${id}"]`).length,1,id);
  assert.equal(document.querySelector('#workspace').hidden,true);assert.equal(document.querySelector('#song-lobby').hidden,true);assert.equal(document.querySelector('#game-home').hidden,false);
  assert.equal(document.querySelectorAll('#fullscreen-button').length,1);
  assert.equal(document.querySelector('#fullscreen-button').getAttribute('aria-label'),'进入全屏');
  assert.equal(document.querySelector('#fullscreen-button').getAttribute('aria-disabled'),'true');
  assert.equal(document.querySelector('.skip-link').getAttribute('href'),'#home-title');assert.equal(document.querySelector('#song-lobby').getAttribute('role'),'main');
  for(const id of ['instrument','key-count','practice-part','latency-offset','theme-mode'])assert.equal(document.getElementById(id).closest('dialog').id,'settings-dialog');
  for(const id of ['export-button','source-files-button','score-details'])assert.equal(document.getElementById(id).closest('dialog').id,'score-tools-dialog');
  for(const id of ['score-file','score-image-file','jianpu-editor-button'])assert.equal(document.getElementById(id).closest('dialog').id,'import-tools-dialog');
  assert.equal(document.getElementById('engraved-staff').closest('aside').id,'notation-dock');
  assert.equal(document.getElementById('notation-dock').nextElementSibling,document.querySelector('.play-panel'),'Reading order places the original score surface before the playable keys');
  shell.open('settings');assert.equal(pauses,1);assert.equal(document.getElementById('settings-dialog').open,true);shell.show('stage');assert.equal(pauses,2);assert.equal(document.getElementById('settings-dialog').open,false);assert.equal(document.getElementById('song-lobby').hidden,true);assert.deepEqual(screens,['stage']);
  document.getElementById('notation-toggle').click();assert.deepEqual(notation,[true]);assert.equal(shell.notationVisible(),true);
  assert.equal(document.querySelector('.skip-link').getAttribute('href'),'#stage-title');shell.show('library');assert.equal(pauses,3);assert.equal(shell.screen(),'library');assert.equal(document.querySelector('#workspace').hidden,true);assert.equal(document.querySelector('.skip-link').getAttribute('href'),'#lobby-title');
  shell.open('settings');const settings=document.getElementById('settings-dialog');settings.removeAttribute('open');const next=document.querySelector('.skip-link');next.focus();settings.dispatchEvent(new window.Event('close'));assert.ok(focused===next,'A queued close event must not steal focus after the user has moved to another control');
 }finally{if(original)Object.defineProperty(globalThis,'document',original);else delete globalThis.document}
});

test('desktop piano opens its real score on first entry and keeps an explicit close through navigation',async()=>{
 const {document,window}=parseHTML(await readFile(new URL('../web/index.html',import.meta.url),'utf8'));
 const original=Object.getOwnPropertyDescriptor(globalThis,'document');Object.defineProperty(globalThis,'document',{configurable:true,value:document});
 const sizes=new Map(['innerWidth','innerHeight'].map(key=>[key,Object.getOwnPropertyDescriptor(window,key)]));
 const shown=[];let shell;
 try{
  Object.defineProperties(window,{innerWidth:{configurable:true,value:1280},innerHeight:{configurable:true,value:720}});
  Object.defineProperty(document.getElementById('instrument'),'value',{configurable:true,value:'piano'});
  shell=setupGameShell({pausePlayback(){},onScreen(){},onNotation:value=>shown.push(value)});
  const dock=document.getElementById('notation-dock'),toggle=document.getElementById('notation-toggle');
  shell.show('stage');assert.equal(dock.hidden,false);assert.equal(shell.notationVisible(),true);assert.equal(toggle.getAttribute('aria-expanded'),'true');assert.deepEqual(shown,[true]);
  toggle.click();assert.equal(dock.hidden,true);assert.deepEqual(shown,[true,false]);
  shell.show('library');shell.show('stage');assert.equal(dock.hidden,true,'Returning to the score respects the player’s explicit visibility choice');
  toggle.click();assert.equal(dock.hidden,false);assert.equal(document.getElementById('notation-dock'),dock);
 }finally{shell?.destroy();for(const[key,descriptor]of sizes)if(descriptor)Object.defineProperty(window,key,descriptor);else delete window[key];if(original)Object.defineProperty(globalThis,'document',original);else delete globalThis.document}
});

function fullscreenFixture({enabled=true,request,exit,i18n=createI18n({locale:'en',onReport(){}})}={}) {
 const {document,window}=parseHTML('<html><body><button id="fullscreen"></button><span id="status"></span><dialog id="panel"><input value="Keep this draft"></dialog><button id="other">Other control</button></body></html>');
 const button=document.getElementById('fullscreen'),status=document.getElementById('status'),timers=new Map(),calls=[];
 let nextTimer=0,active=null;
 Object.defineProperties(document,{fullscreenEnabled:{configurable:true,value:enabled},fullscreenElement:{get:()=>active},hidden:{configurable:true,value:false}});
 document.documentElement.requestFullscreen=function(){calls.push({kind:'enter',target:this});return request?.()??new Promise(()=>{})};
 document.exitFullscreen=function(){calls.push({kind:'exit',target:this});return exit?.()??new Promise(()=>{})};
 const controller=setupFullscreen({document,button,status,...(i18n?{i18n}:{}),timeoutMs:80,setTimer:(callback,ms)=>{const id=++nextTimer;timers.set(id,{callback,ms});return id},clearTimer:id=>timers.delete(id)});
 const change=element=>{active=element;document.dispatchEvent(new window.Event('fullscreenchange'))};
 const tick=ms=>{for(const[id,timer]of [...timers])if(timer.ms===ms){timers.delete(id);timer.callback()}};
 return {document,window,button,status,calls,timers,controller,i18n:i18n||getAppI18n(document),change,tick,setActive:element=>{active=element}};
}
const microtasks=async()=>{await Promise.resolve();await Promise.resolve()};

test('fullscreen uses a direct root request, serializes clicks and follows actual events including Escape',async()=>{
 const enter=deferred(),exit=deferred(),f=fullscreenFixture({request:()=>enter.promise,exit:()=>exit.promise});
 try{
  f.button.click();assert.equal(f.calls.length,1,'The API is invoked synchronously in the native click handler');assert.equal(f.calls[0].target,f.document.documentElement);assert.equal(f.button.getAttribute('aria-busy'),'true');
  f.button.click();assert.equal(f.calls.length,1,'A second click cannot create an overlapping request');assert.equal(f.button.getAttribute('aria-label'),'Enter fullscreen','An intent is not browser state');
  f.change(f.document.documentElement);assert.equal(f.button.getAttribute('aria-label'),'Exit fullscreen');assert.equal(f.button.getAttribute('aria-busy'),'false');assert.match(f.button.title,/Esc/);assert.equal(f.button.hasAttribute('aria-pressed'),false);
  f.change(null);enter.resolve();await microtasks();assert.equal(f.button.getAttribute('aria-label'),'Enter fullscreen','Late completion cannot undo Escape');assert.equal(f.calls.length,1);
  f.change(f.document.documentElement);f.button.click();assert.equal(f.calls.at(-1).kind,'exit');assert.equal(f.calls.at(-1).target,f.document);f.change(null);exit.reject(Error('Already exited'));await microtasks();assert.equal(f.status.textContent,'','A browser exit is authoritative even when the promise later rejects');
 }finally{f.controller.destroy()}
});

test('fullscreen handles refusal, synchronous throws, missing support and retry without disabling other tools',async()=>{
 for(const synchronous of [false,true]){
  let reject=true;const f=fullscreenFixture({request:()=>{if(reject){if(synchronous)throw Error('Policy denied');return Promise.reject(Error('Policy denied'))}return Promise.resolve()}});
  try{f.button.click();await microtasks();assert.match(f.status.textContent,/Could not enter fullscreen/);assert.equal(f.button.getAttribute('aria-label'),'Enter fullscreen');assert.equal(f.button.getAttribute('aria-busy'),'false');assert.equal(f.document.getElementById('other').hasAttribute('disabled'),false);reject=false;f.button.click();await microtasks();assert.equal(f.calls.length,2);assert.equal(f.status.textContent,'');}finally{f.controller.destroy()}
 }
 for(const absent of [false,true]){
  const f=fullscreenFixture({enabled:absent});if(absent)delete f.document.documentElement.requestFullscreen;
  try{f.button.click();assert.equal(f.calls.length,0);assert.equal(f.button.getAttribute('aria-disabled'),'true');assert.match(f.status.textContent,/unavailable/);assert.equal(f.button.disabled,false);f.tick(6000);assert.equal(f.status.textContent,'');}finally{f.controller.destroy()}
 }
});

test('fullscreen timeout cancels intent, bounds busy state and exits late entry before allowing a retry',async()=>{
 const enter=deferred(),exit=deferred(),f=fullscreenFixture({request:()=>enter.promise,exit:()=>exit.promise});
 try{
  f.button.click();f.tick(80);assert.equal(f.button.getAttribute('aria-busy'),'false');assert.match(f.status.textContent,/did not finish/);
  f.button.click();assert.equal(f.calls.length,1);assert.match(f.status.textContent,/earlier fullscreen request/);
  f.change(f.document.documentElement);assert.equal(f.calls.at(-1).kind,'exit');assert.equal(f.button.getAttribute('aria-label'),'Exit fullscreen','Recovery does not pretend the browser has exited');
  enter.resolve();await microtasks();assert.equal(f.button.getAttribute('aria-busy'),'true','Old completion cannot clear the recovery operation');f.change(null);exit.resolve();await microtasks();assert.equal(f.button.getAttribute('aria-label'),'Enter fullscreen');assert.equal(f.button.getAttribute('aria-busy'),'false');f.button.click();assert.equal(f.calls.at(-1).kind,'enter');
 }finally{f.controller.destroy()}
});

test('Escape cancels an entry that has not appeared yet without suppressing native Escape behavior',async()=>{
 const enter=deferred(),exit=deferred(),f=fullscreenFixture({request:()=>enter.promise,exit:()=>exit.promise});
 try{
  f.button.click();const event=new f.window.Event('keydown',{bubbles:true,cancelable:true});Object.defineProperty(event,'key',{value:'Escape'});f.document.dispatchEvent(event);
  assert.equal(event.defaultPrevented,false);assert.equal(f.button.getAttribute('aria-busy'),'false');assert.match(f.status.textContent,/entry cancelled/);
  f.change(f.document.documentElement);enter.resolve();await microtasks();assert.equal(f.calls.filter(call=>call.kind==='exit').length,1);f.change(null);exit.resolve();await microtasks();assert.equal(f.button.getAttribute('aria-label'),'Enter fullscreen');
  f.document.dispatchEvent(event);assert.equal(f.calls.length,2,'Escape outside a pending entry remains entirely native');
 }finally{f.controller.destroy()}
});

test('fullscreen late entry preserves an open modal, its contents and focus without reopening it',async()=>{
 for(const completionFirst of [false,true]){
  const enter=deferred(),exit=deferred(),f=fullscreenFixture({request:()=>enter.promise,exit:()=>exit.promise});
  let focusCalls=0;f.window.HTMLElement.prototype.focus=()=>focusCalls++;
  try{
   f.button.click();const dialog=f.document.getElementById('panel');dialog.setAttribute('open','');
   if(completionFirst){f.setActive(f.document.documentElement);enter.resolve();await microtasks()}else{f.change(f.document.documentElement);enter.resolve();await microtasks()}
   assert.equal(f.calls.filter(call=>call.kind==='exit').length,1);assert.equal(dialog.hasAttribute('open'),true);assert.equal(dialog.querySelector('input').value,'Keep this draft');assert.equal(focusCalls,0);f.change(null);exit.resolve();await microtasks();assert.equal(dialog.hasAttribute('open'),true);
  }finally{f.controller.destroy()}
 }
});

test('fullscreen leaves ordinary dialogs above completed entry and reports a failed exit truthfully',async()=>{
 const enter=deferred(),f=fullscreenFixture({request:()=>enter.promise,exit:()=>Promise.reject(Error('Exit denied'))});
 try{
  f.button.click();f.change(f.document.documentElement);enter.resolve();await microtasks();f.document.getElementById('panel').setAttribute('open','');f.change(f.document.documentElement);assert.equal(f.calls.length,1,'A panel opened after entry does not cancel an established fullscreen session');
  f.button.click();await microtasks();assert.equal(f.button.getAttribute('aria-label'),'Exit fullscreen');assert.equal(f.button.getAttribute('aria-busy'),'false');assert.match(f.status.textContent,/Press Esc or try again/);
  f.change(null);assert.equal(f.status.textContent,'','A subsequent browser Escape must clear the obsolete failure message');assert.equal(f.button.getAttribute('aria-label'),'Enter fullscreen');
 }finally{f.controller.destroy()}
});

test('fullscreen failed modal recovery keeps its exit action and error instead of reporting success',async()=>{
 const enter=deferred(),f=fullscreenFixture({request:()=>enter.promise,exit:()=>{throw Error('Exit refused')}});
 try{
  f.button.click();const dialog=f.document.getElementById('panel');dialog.setAttribute('open','');f.change(f.document.documentElement);enter.resolve();await microtasks();
  assert.equal(f.button.getAttribute('aria-label'),'Exit fullscreen');assert.equal(f.button.getAttribute('aria-busy'),'false');assert.match(f.status.textContent,/Could not exit fullscreen/);assert.equal(dialog.hasAttribute('open'),true);assert.equal(f.calls.filter(call=>call.kind==='exit').length,1,'A failed recovery cannot enter an automatic retry loop');
 }finally{f.controller.destroy()}
});

test('fullscreen page lifecycle cancels only entry intent and never creates an automatic new request',async()=>{
 for(const event of ['visibilitychange','pagehide']){
  const enter=deferred(),exit=deferred(),f=fullscreenFixture({request:()=>enter.promise,exit:()=>exit.promise});
  try{
   f.button.click();if(event==='visibilitychange'){Object.defineProperty(f.document,'hidden',{value:true});f.document.dispatchEvent(new f.window.Event(event))}else f.window.dispatchEvent(new f.window.Event(event));
   f.change(f.document.documentElement);assert.equal(f.calls.at(-1).kind,'exit');enter.resolve();await microtasks();f.change(null);exit.resolve();await microtasks();Object.defineProperty(f.document,'hidden',{value:false});f.window.dispatchEvent(new f.window.Event('pageshow'));assert.equal(f.calls.filter(call=>call.kind==='enter').length,1);assert.equal(f.button.getAttribute('aria-busy'),'false');
  }finally{f.controller.destroy()}
 }
});


test('fullscreen defaults to Chinese and locale redraw preserves an in-flight browser request, modal and focus',async()=>{
 const enter=deferred(),exit=deferred(),f=fullscreenFixture({i18n:null,request:()=>enter.promise,exit:()=>exit.promise});
 let focused=null;f.window.HTMLElement.prototype.focus=function(){focused=this;};
 try{
  assert.equal(f.button.getAttribute('aria-label'),'进入全屏');f.button.click();
  const input=f.document.querySelector('#panel input'),svg=f.button.querySelector('svg');input.focus();
  f.document.getElementById('panel').setAttribute('open','');const timers=[...f.timers.keys()];
  f.i18n.setLocale('en');assert.equal(f.button.getAttribute('aria-label'),'Enter fullscreen');assert.equal(f.button.getAttribute('aria-busy'),'true');assert.equal(f.calls.length,1);assert.deepEqual([...f.timers.keys()],timers);assert.equal(f.button.querySelector('svg'),svg);assert.equal(focused,input);assert.equal(input.value,'Keep this draft');assert.equal(f.document.getElementById('panel').hasAttribute('open'),true);
  f.i18n.setLocale('zh-CN');assert.equal(f.button.getAttribute('aria-label'),'进入全屏');assert.equal(f.calls.length,1);
  f.change(f.document.documentElement);enter.resolve();await microtasks();assert.equal(f.calls.length,2,'Only the actual browser event triggers modal recovery');f.change(null);exit.resolve();await microtasks();
 }finally{f.controller.destroy()}
});

test('fullscreen current error translates without retry or timeout extension and disposal unsubscribes',async()=>{
 const f=fullscreenFixture({request:()=>Promise.reject(Error('External browser detail'))});
 try{
  f.button.click();await microtasks();assert.match(f.status.textContent,/Could not enter fullscreen/);const timers=[...f.timers.keys()];
  f.i18n.setLocale('zh-CN');assert.equal(f.status.textContent,'无法进入全屏。你可以继续演奏或重试。');assert.equal(f.button.getAttribute('aria-label'),'进入全屏');assert.equal(f.calls.length,1);assert.deepEqual([...f.timers.keys()],timers);
  f.tick(6000);assert.equal(f.status.textContent,'');f.i18n.setLocale('en');assert.equal(f.status.textContent,'');
  f.controller.destroy();const label=f.button.getAttribute('aria-label');f.i18n.setLocale('zh-CN');assert.equal(f.button.getAttribute('aria-label'),label);f.button.click();assert.equal(f.calls.length,1);
 }finally{f.controller.destroy()}
});
