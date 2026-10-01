import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {parseHTML} from 'linkedom';
import {ScorePreview,filterCatalog,stageShortcutAllowed} from '../web/score-preview.js';
import {setupGameShell} from '../web/game-shell.js';
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
 Object.defineProperty(globalThis,'document',{configurable:true,value:document});let pauses=0;const screens=[],notation=[];
 window.HTMLElement.prototype.showModal=function(){this.setAttribute('open','')};window.HTMLElement.prototype.close=function(){this.removeAttribute('open');this.dispatchEvent(new window.Event('close'))};
 Object.defineProperty(window.HTMLElement.prototype,'open',{configurable:true,get(){return this.hasAttribute('open')},set(value){this.toggleAttribute('open',Boolean(value))}});
 try{
  const ids=[...document.querySelectorAll('[id]')].map(el=>el.id),shell=setupGameShell({pausePlayback:()=>pauses++,onScreen:value=>screens.push(value),onNotation:value=>notation.push(value)});
  for(const id of ids)assert.equal(document.querySelectorAll(`[id="${id}"]`).length,1,id);
  assert.equal(document.querySelector('#workspace').hidden,true);assert.equal(document.querySelector('#song-lobby').hidden,false);
  assert.equal(document.querySelector('.skip-link').getAttribute('href'),'#lobby-title');assert.equal(document.querySelector('#song-lobby').getAttribute('role'),'main');
  for(const id of ['instrument','key-count','practice-part','latency-offset','theme-mode'])assert.equal(document.getElementById(id).closest('dialog').id,'settings-dialog');
  for(const id of ['export-button','source-files-button','score-details'])assert.equal(document.getElementById(id).closest('dialog').id,'score-tools-dialog');
  for(const id of ['score-file','score-image-file','jianpu-editor-button'])assert.equal(document.getElementById(id).closest('dialog').id,'import-tools-dialog');
  assert.equal(document.getElementById('engraved-staff').closest('aside').id,'notation-dock');
  shell.open('settings');assert.equal(pauses,1);assert.equal(document.getElementById('settings-dialog').open,true);shell.show('stage');assert.equal(pauses,2);assert.equal(document.getElementById('settings-dialog').open,false);assert.equal(document.getElementById('song-lobby').hidden,true);assert.deepEqual(screens,['stage']);
  document.getElementById('notation-toggle').click();assert.deepEqual(notation,[true]);assert.equal(shell.notationVisible(),true);
  assert.equal(document.querySelector('.skip-link').getAttribute('href'),'#stage-title');shell.show('library');assert.equal(pauses,3);assert.equal(shell.screen(),'library');assert.equal(document.querySelector('#workspace').hidden,true);assert.equal(document.querySelector('.skip-link').getAttribute('href'),'#lobby-title');
 }finally{if(original)Object.defineProperty(globalThis,'document',original);else delete globalThis.document}
});
