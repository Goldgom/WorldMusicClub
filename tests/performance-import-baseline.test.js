import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
import {performanceAcceptanceFixtures} from '../scripts/prepare-performance-song-fixtures.mjs';
import {nativeStorageApp,nativeResponse} from './native-storage-app-fixtures.js';
import {bulkNativeFixture,importFile,importItem,importReport,selectImportFiles} from './bulk-import-fixtures.js';
import {PerformanceAudio} from './complete-performance-ui-fixture.js';
import {getAppI18n} from '../web/app-locale.js';

// Node-only contracts: production app handlers and acceptance setup helpers,
// authored in-memory native replies, modeled DOM input and Web Audio. These
// tests cannot produce trusted gestures or replace Windows/native acceptance.
const source=await readFile(new URL('../crates/desktop-shell/performance-song-acceptance.js',import.meta.url),'utf8');
const helpers=vm.runInNewContext(`${source.split('(() => {')[0]}\n({preparePerformanceBaseline,activatePerformanceOriginalScore,readPerformanceImportState})`,{structuredClone});
const navigation=await readFile(new URL('../crates/desktop-shell/acceptance-wait.js',import.meta.url),'utf8');
const {createAcceptanceNavigation}=vm.runInNewContext(`${navigation}\n({createAcceptanceNavigation})`,{AbortController,setTimeout,clearTimeout});
const plain=value=>JSON.parse(JSON.stringify(value));
const forbidden=path=>/assess|fingering|\/api\/compile|practice-targets|instrument-check|notation-navigation|\/api\/library\/runtime/.test(path);

async function fixture(){
 const pack=performanceAcceptanceFixtures(),server=await bulkNativeFixture();
 const opened=await Promise.all(pack.fixtures.map(async song=>JSON.parse(await readFile(new URL(`./fixtures/${song.name}-native-open.json`,import.meta.url),'utf8'))));
 server.setImportRoute(({path,body})=>{
  if(!['/api/library/import/preview','/api/library/import/commit'].includes(path))return;
  const mode=path.endsWith('/commit')?'commit':'preview';
  const items=opened.map((record,index)=>{
   if(mode==='commit')server.records.set(record.entry.key,structuredClone(record));
   return importItem({index,path:`${pack.fixtures[index].folder}/score.json`,title:record.entry.title,status:mode==='commit'?'saved':'ready',playable:false,clean_package:record.entry.clean_package,...(mode==='commit'?{entry:record.entry}:{})});
  });
  return nativeResponse(importReport(body,{mode,items,sha256:pack.manifest.sha256}));
 });
 let clock=1000;
 const app=await nativeStorageApp(server,{now:()=>clock}),prototype=app.window.HTMLElement.prototype,geometry=Object.getOwnPropertyDescriptor(prototype,'getBoundingClientRect');
 Object.defineProperty(prototype,'getBoundingClientRect',{configurable:true,writable:true,value(){return{width:120,height:40};}});
 const contexts=[],audioDescriptor=Object.getOwnPropertyDescriptor(globalThis,'AudioContext');
 class ObservedAudio extends PerformanceAudio{constructor(){super();contexts.push(this);}}
 Object.defineProperty(globalThis,'AudioContext',{configurable:true,value:ObservedAudio});
 const click=id=>app.$(id).click(),menu=createAcceptanceNavigation({document:app.document,click,until:app.until});
 const snapshot=()=>plain(helpers.readPerformanceImportState(app.document));
 const starts=()=>contexts.flatMap(context=>context.nodes).reduce((sum,node)=>sum+node.starts.length,0);
 async function importSeed({blur=true}={}){
  const before=snapshot(),requestStart=app.requests.length,sourceStarts=starts();
  await app.click('import-tools-button');await app.click('import-button');
  if(blur){clock+=100;app.emit(app.window,'blur');clock+=100;app.emit(app.window,'focus');}
  selectImportFiles(app,[importFile(pack.filename,pack.bytes)]);
  await app.until(()=>app.$('bulk-import-dialog').dataset.phase==='review'&&app.document.querySelectorAll('.bulk-import-song').length===pack.fixtures.length);
  assert.equal(server.records.size,0,'Preflight must not save typed songs');
  assert.equal(app.$('complete-performance-listening').hidden,true,'Import review must not select a typed preview');
  await app.click('bulk-import-save');
  await app.until(()=>app.$('bulk-import-dialog').dataset.phase==='review'&&app.document.querySelector('[data-import-file]')?.dataset.phase==='complete');
  assert.equal(server.records.size,pack.fixtures.length);assert.equal(app.document.querySelectorAll('#catalog [data-library-key]').length,pack.fixtures.length);
  assert.deepEqual([...server.records.values()],opened,'Commit retains the exact null-notation packages');
  await app.click('bulk-import-done');
  assert.deepEqual(snapshot(),before,'Typed import/save must not change the original preview or active score/take display');
  assert.equal(starts(),sourceStarts,'Importing typed songs must not schedule audio');
  assert.equal(contexts.length,0,'Importing typed songs must not unlock audio');
  assert.deepEqual(app.requests.slice(requestStart).filter(row=>forbidden(row.path)),[],'Importing typed songs must not request grading or target/notation compilation');
  assert.equal(app.requests.slice(requestStart).filter(row=>row.path==='/api/library/load').length,0,'Saving must not automatically load a typed song');
 }
 async function prepareHumanTake(){
  const original=snapshot();
  const setup=await helpers.activatePerformanceOriginalScore({document:app.document,click,menu});
  assert.equal(setup.previewId,original.previewId);assert.equal(setup.title,original.previewTitle);
  app.$('session-mode').value='practice';app.emit(app.$('session-mode'),'change');app.$('count-in').checked=false;
  await app.click('play-button');clock+=100;app.frame();
  app.emit(app.$('stage-title'),'keydown',{code:'KeyR',key:'r'});clock+=10;app.emit(app.$('stage-title'),'keyup',{code:'KeyR',key:'r'});app.frame();
  clock+=50;await app.click('play-button');await menu.returnToLibrary();
  const take=await app.exported('export-takes');
  assert.equal(take.score_id,'test-score');assert.equal(take.passes.length,1);assert.equal(take.passes[0].inputs.length,1);
  assert.ok(take.passes[0].timeline.notes.length>0);assert.equal(take.passes[0].assessment,null);
  assert.equal(take.input_evidence.events.filter(row=>row.kind==='note_on'&&row.input_kind==='typing_keyboard').length,1);
  assert.equal(contexts.length,0,'Canonical setup and modeled input remain silent');
  return take;
 }
 async function close(){
  Object.defineProperty(globalThis,'AudioContext',audioDescriptor);
  try{await app.close();}finally{if(geometry)Object.defineProperty(prototype,'getBoundingClientRect',geometry);else delete prototype.getBoundingClientRect;}
 }
 await menu.enterLibrary();
 return{app,server,pack,contexts,menu,snapshot,starts,importSeed,prepareHumanTake,advance:ms=>{clock+=ms;},close};
}

test('seed imports exact typed songs before the original take; reference input/navigation preserves the complete baseline',async()=>{
 const f=await fixture(),order=[];
 try{
  let before;
  await helpers.preparePerformanceBaseline({phase:'performance-seed',importSeed:async()=>{order.push('import');await f.importSeed();assert.equal(f.app.$('hud-captured').textContent,'0');assert.equal(f.app.$('resume-session').hidden,true);},prepareHumanTake:async()=>{order.push('human');before=await f.prepareHumanTake();}});
  assert.deepEqual(order,['import','human']);
  const requestStart=f.app.requests.length;
  f.app.savedButton(f.pack.fixtures[0].key).click();await f.app.until(()=>f.app.$('song-lobby').dataset.previewStatus==='performance');
  assert.equal(f.app.$('start-listen').disabled,true);assert.equal(f.app.$('start-practice').disabled,true);assert.equal(f.app.$('complete-performance-play').disabled,true);assert.equal(f.starts(),0);
  f.app.$('complete-performance-policy-accept').checked=true;f.app.emit(f.app.$('complete-performance-policy-accept'),'change');
  assert.equal(f.starts(),0,'Policy choice must not start audio');
  if(!f.app.$('complete-performance-sound').checked){f.app.$('complete-performance-sound').checked=true;f.app.emit(f.app.$('complete-performance-sound'),'change');}
  await f.app.click('complete-performance-play');await f.app.until(()=>f.app.$('complete-performance-status').dataset.state==='playing');
  // The authored package's first attack is at 0.2500005 s. Advance only the
  // fixture AudioContext into the production scheduler's next lookahead window.
  assert.equal(f.contexts.length,1);f.contexts[0].currentTime=.16;
  await f.app.until(()=>f.starts()>0,'Production reference scheduler did not create modeled audio sources');
  const key=f.app.document.querySelector('#keyboard [data-midi="60"]');
  f.app.emit(key,'pointerdown',{pointerId:91,button:0});f.app.emit(key,'pointerup',{pointerId:91});
  f.app.emit(f.app.$('complete-performance-title'),'keydown',{code:'KeyR',key:'r'});f.app.emit(f.app.$('complete-performance-title'),'keyup',{code:'KeyR',key:'r'});
  await f.app.click('assess-button');assert.deepEqual(await f.app.exported('export-takes'),before);
  await f.app.click('lobby-home');assert.equal(f.app.$('complete-performance-status').dataset.state,'stopped');
  assert.ok(f.contexts.flatMap(context=>context.nodes).filter(node=>['oscillator','noise'].includes(node.kind)).every(node=>node.disconnected));
  await f.app.click('home-single-player');f.app.savedButton(f.pack.fixtures[0].key).click();await f.app.until(()=>f.app.$('song-lobby').dataset.previewStatus==='performance');
  assert.equal(f.app.$('complete-performance-policy-accept').checked,false);assert.equal(f.app.$('complete-performance-play').disabled,true);
  assert.deepEqual(await f.app.exported('export-takes'),before,'Full take, including all input evidence and grades, must remain equal');
  assert.deepEqual(f.app.requests.slice(requestStart).filter(row=>forbidden(row.path)),[]);
 }finally{await f.close();}
});

test('a real app blur handler changes a prior whole take honestly; typed import/save adds no onset, grade or further evidence',async()=>{
 const f=await fixture();
 try{
  const before=await f.prepareHumanTake();f.advance(100);f.app.emit(f.app.window,'blur');f.advance(100);f.app.emit(f.app.window,'focus');
  const blurred=await f.app.exported('export-takes');
  assert.notDeepEqual(blurred,before,'The full comparator must reject a lifecycle boundary added after its baseline');
  assert.equal(blurred.input_evidence.events.length,before.input_evidence.events.length+1);
  assert.equal(blurred.input_evidence.events.at(-1).kind,'boundary');assert.equal(blurred.input_evidence.events.at(-1).reason,'blur');
  assert.deepEqual(blurred.passes,before.passes,'Blur must not manufacture a played note or a grade');
  await f.importSeed({blur:false});
  assert.deepEqual(await f.app.exported('export-takes'),blurred,'Actual file-change/save handlers preserve every retained field after the honest blur boundary');
 }finally{await f.close();}
});

test('controls and restart prepare the human baseline without repeating seed import',async()=>{
 for(const phase of ['performance-controls','performance-restart']){
  const calls=[];await helpers.preparePerformanceBaseline({phase,importSeed:async()=>{throw Error('Non-seed import is forbidden');},prepareHumanTake:async()=>{calls.push('human');}});assert.deepEqual(calls,['human']);
 }
});

test('new authored named and bank previews disclose their route in the actual app and stay silent before policy',async()=>{
 const f=await fixture();try{
  await f.importSeed();const take=await f.prepareHumanTake(),requestStart=f.app.requests.length;
  for(const song of f.pack.fixtures.slice(2)){
   f.app.savedButton(song.key).click();await f.app.until(()=>f.app.$('song-lobby').dataset.previewId===`native:${song.key}`&&f.app.$('song-lobby').dataset.previewStatus==='performance');
   const routing=f.app.$('complete-performance-policy-routing'),policy=f.app.$('complete-performance-policy-accept');
   assert.equal(routing.hidden,false);assert.equal(policy.checked,false);assert.equal(policy.disabled,!song.reference.playable);
   assert.equal(f.app.$('complete-performance-play').disabled,true);assert.equal(f.app.$('start-listen').disabled,true);assert.equal(f.app.$('start-practice').disabled,true);
   getAppI18n(f.app.document).setLocale('en');assert.equal(routing.textContent,'Logical destination “WMH Authored Receiver A” is mapped to the selected procedural reference receiver. The source device and timbre are unverified.');
   assert.equal(f.app.$('complete-performance-policy-label').textContent,'I select this reference sound, event playback and logical device mapping policy');
   getAppI18n(f.app.document).setLocale('zh-CN');assert.equal(routing.textContent,'逻辑目标“WMH Authored Receiver A”映射到所选程序合成参考接收器。未验证源设备与原始音色。');
   assert.equal(f.app.$('complete-performance-policy-label').textContent,'我选择此参考声音、事件播放与逻辑设备映射策略');
   getAppI18n(f.app.document).setLocale('en');
   if(song.reference.playable){policy.checked=true;f.app.emit(policy,'change');if(!f.app.$('complete-performance-sound').checked){f.app.$('complete-performance-sound').checked=true;f.app.emit(f.app.$('complete-performance-sound'),'change');}assert.equal(f.app.$('complete-performance-play').disabled,false);}
   else{assert.match(f.app.$('complete-performance-problems').textContent,/unsupported_bank_select/);await f.app.click('complete-performance-play');assert.equal(policy.checked,false);}
   assert.equal(f.starts(),0);assert.equal(f.contexts.length,0);assert.deepEqual(await f.app.exported('export-takes'),take);
  }
  assert.deepEqual(f.app.requests.slice(requestStart).filter(row=>forbidden(row.path)),[]);
 }finally{await f.close();}
});
