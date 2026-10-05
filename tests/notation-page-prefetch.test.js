import test from 'node:test';
import assert from 'node:assert/strict';
import {NotationPagePrefetch} from '../web/notation-page-prefetch.js';
import {parseHTML} from 'linkedom';
import {prepareNotationBatch,notationPreparationWithinBudget,NOTATION_PREPARATION_LIMITS} from '../web/notation-prepared-batch.js';
import {setupEngravedView} from '../web/engraved-view.js';
import {prepareCleanSong} from '../web/clean-song-package.js';
import {publishPlaybackClock} from '../web/playback-clock-view.js';
import {createI18n} from '../web/i18n.js';
import {readFileSync} from 'node:fs';
const deferred=()=>{let resolve;const promise=new Promise(done=>{resolve=done;});return{promise,resolve};};
test('next-page admission stays bounded and replacement rejects a late source or scope response',async()=>{
 const cache=new NotationPagePrefetch(),first=deferred(),second=deferred();let oldSignal;
 cache.prime('source-A:all:next',{source:'A',scope:'all',from:9},signal=>{oldSignal=signal;return first.promise;});await Promise.resolve();cache.prime('source-B:part:next',{source:'B',scope:'part',from:9},()=>second.promise);assert.equal(oldSignal.aborted,true);first.resolve({wrong:'old-page'});await Promise.resolve();assert.equal(cache.peek().key,'source-B:part:next');second.resolve({pages:['new-page']});assert.deepEqual(await cache.take('source-B:part:next'),{pages:['new-page']});assert.equal(cache.peek(),null);
});
test('a pending next page is adopted once without discarding the caller-owned current page',async()=>{
 const cache=new NotationPagePrefetch(),next=deferred(),current={pages:['current']};let calls=0;cache.prime('same',{from:9},()=>{calls++;return next.promise;});cache.prime('same',{from:9},()=>{throw Error('No duplicate load');});const waiting=cache.take('same');assert.deepEqual(current,{pages:['current']});next.resolve({pages:['next']});assert.deepEqual(await waiting,{pages:['next']});assert.equal(calls,1);assert.equal(await cache.take('same'),null);
});
test('closing notation cancels speculative work and a failed prefetch can be retried by an explicit current-page load',async()=>{
 const cache=new NotationPagePrefetch(),next=deferred();let signal;cache.prime('one',{from:2},value=>{signal=value;return next.promise;});await Promise.resolve();cache.clear();assert.equal(signal.aborted,true);next.resolve({pages:['late']});assert.equal(await cache.take('one'),null);await cache.prime('two',{from:2},async()=>{throw Error('Temporary native failure');});assert.match(cache.peek().error.message,/Temporary/);assert.equal(await cache.take('two'),null);assert.equal(cache.peek(),null);
});

test('a disposable next batch transfers ownership once and releases superseded or late results',async()=>{
 const disposed=[],old=deferred(),cache=new NotationPagePrefetch({dispose:value=>disposed.push(value.id)});
 cache.prime('old',{},()=>old.promise);await Promise.resolve();await cache.prime('new',{},()=>({id:'new'}));old.resolve({id:'old'});await new Promise(resolve=>setImmediate(resolve));
 assert.deepEqual(disposed,['old']);const claimed=await cache.take('new');cache.clear();assert.equal(claimed.id,'new');assert.deepEqual(disposed,['old'],'Adoption transfers disposal to the live owner');
 await cache.prime('third',{},()=>({id:'third'}));cache.clear();cache.clear();assert.deepEqual(disposed,['old','third']);
 let started=false;cache.prime('cancelled-before-start',{},()=>{started=true;});cache.clear();await Promise.resolve();assert.equal(started,false);
});

function originalBatch(parts=4){
 const pages=Array.from({length:parts},(_,part)=>({view_version:2,status:'ready',part_id:`part-${part}`,interpreted_notes:[{note_id:`original-${part}`}],score:{parts:[{notes:[{id:`original-${part}`}]}]},musicxml:{xml:'<score-partwise/>',note_id_map:{version:1,segments:[{source_note_id:`original-${part}`} ]}}}));
 return {basicBatch:{status:'ready',targetCount:parts},basicPages:pages};
}
test('speculation enforces aggregate target, written-segment and UTF-8 budgets without changing the page',()=>{
 const batch=originalBatch(),before=JSON.stringify(batch);assert.equal(notationPreparationWithinBudget(batch),true);
 for(const change of [value=>value.basicBatch.targetCount=2049,value=>value.basicPages.push(value.basicPages[0]),value=>value.basicPages[0].view_version=1,value=>value.basicPages[0].musicxml.note_id_map.segments=Array.from({length:4097},()=>({})),value=>value.basicPages[0].musicxml.xml='é'.repeat(NOTATION_PREPARATION_LIMITS.xmlBytes/2+1),value=>value.basicPages[0].musicxml.note_id_map.extra='é'.repeat(NOTATION_PREPARATION_LIMITS.mapBytes/2+1)]){
  const changed=structuredClone(batch);change(changed);const original=JSON.stringify(changed);assert.equal(notationPreparationWithinBudget(changed),false);assert.equal(JSON.stringify(changed),original,'An over-budget complete page remains intact for foreground rendering');
 }
 assert.equal(JSON.stringify(batch),before);
});

function stagingEnvironment(){
 const {document}=parseHTML('<html><body><section id="live"><p>Current staff</p></section></body></html>'),live=document.getElementById('live'),controller=new AbortController(),renders=[],applied=[],refreshed=[];
 let current=true;
 const options={document,width:900,pages:originalBatch().basicPages,signal:controller.signal,isCurrent:()=>current,needsEngraving:page=>page.score.parts[0].notes.length>0,quietPart:(mount,page)=>{mount.textContent=page.part_id;},async renderPage(mount,page,signal){
  const svg=document.createElement('svg');svg.dataset.sourceNoteId=page.score.parts[0].notes[0].id;mount.append(svg);
  let disposed=false;const result={ok:true,dispose(){if(disposed)return;disposed=true;signal.removeEventListener('abort',result.dispose);svg.remove();},mappingStatus:()=>({status:'ready',verifiedGlyphCount:1,displayedSegmentCount:1,diagnostics:[]}),setExpectedWrittenNotes:value=>{applied.push({part:page.part_id,value});return true;},clearExpectedWrittenNotes:()=>true,refreshExpectedCueGeometry:()=>refreshed.push(mount.parentElement?.id),expectedNoteBounds:()=>({status:'ready',rects:[{sourceNoteId:svg.dataset.sourceNoteId}]})};signal.addEventListener('abort',result.dispose,{once:true});renders.push({mount,page,result,get disposed(){return disposed;}});return result;
 }};
 return {document,live,controller,renders,applied,refreshed,options,invalidate(){current=false;}};
}
test('one prepared batch publishes the same complete owned nodes together and keeps cues private until adoption',async()=>{
 const env=stagingEnvironment(),old=env.live.firstElementChild,before=JSON.stringify(env.options.pages),prepared=await prepareNotationBatch(env.options);
 assert.equal(env.renders.length,4);assert.equal(env.live.firstElementChild,old);assert.equal(env.live.querySelectorAll('svg').length,0);
 const root=env.document.querySelector('[data-notation-preparation]');assert.equal(root.getAttribute('aria-hidden'),'true');assert.equal(root.inert,true);assert.equal(root.style.width,'900px');
 const originalNodes=env.renders.map(item=>item.mount.querySelector('svg'));
 assert.equal(prepared.renderer.setExpectedWrittenNotes({sourceNoteIds:['original-1'],sourceMeasureIndex:0}),false);assert.deepEqual(prepared.renderer.expectedNoteBounds(),{status:'unavailable',rects:[]});assert.deepEqual(env.applied,[]);assert.deepEqual(env.refreshed,[]);
 assert.equal(prepared.activate(env.live),true);assert.equal(prepared.active,true);assert.equal(env.document.querySelector('[data-notation-preparation]'),null);
 assert.deepEqual([...env.live.querySelectorAll('svg')],originalNodes);assert.deepEqual(env.refreshed,['live','live','live','live']);
 prepared.renderer.setExpectedWrittenNotes({sourceNoteIds:['original-1'],sourceMeasureIndex:0});assert.deepEqual(env.applied.map(item=>item.value.sourceNoteIds),[[],['original-1'],[],[]]);assert.equal(JSON.stringify(env.options.pages),before);
 prepared.dispose();prepared.dispose();assert.ok(env.renders.every(item=>item.disposed));assert.equal(env.live.children.length,0);
});
test('cancellation disposes completed and pending part mounts without touching current notation',async()=>{
 const env=stagingEnvironment(),pause=deferred(),render=env.options.renderPage;let started;
 const waiting=new Promise(resolve=>{started=resolve;});
 env.options.renderPage=async(...args)=>{const result=await render(...args);if(env.renders.length===2){started();await pause.promise;}return result;};
 const pending=prepareNotationBatch(env.options);await waiting;env.controller.abort();
 assert.equal(env.document.querySelector('[data-notation-preparation]'),null);assert.equal(env.live.textContent,'Current staff');assert.ok(env.renders.every(item=>item.disposed));pause.resolve();assert.equal(await pending,null);assert.equal(env.renders.length,2);
});
test('stale dimensions/source or a failed part discard the whole prepared batch without a partial swap',async()=>{
 for(const kind of ['stale','error']){
  const env=stagingEnvironment(),render=env.options.renderPage;
  env.options.renderPage=async(...args)=>{const result=await render(...args);if(env.renders.length===2){if(kind==='stale')env.invalidate();else return {...result,ok:false,status:'error'};}return result;};
  if(kind==='stale')assert.equal(await prepareNotationBatch(env.options),null);else await assert.rejects(prepareNotationBatch(env.options));
  assert.equal(env.document.querySelector('[data-notation-preparation]'),null);assert.equal(env.live.textContent,'Current staff');assert.ok(env.renders.every(item=>item.disposed));
 }
});

test('an adoption geometry exception releases the taken batch instead of leaving ownerless live observers',async()=>{
 const env=stagingEnvironment(),render=env.options.renderPage;
 env.options.renderPage=async(...args)=>{const result=await render(...args);result.refreshExpectedCueGeometry=()=>{throw Error('Synthetic adoption geometry failure');};return result;};
 const prepared=await prepareNotationBatch(env.options);
 assert.throws(()=>prepared.activate(env.live),/adoption geometry failure/);
 assert.equal(prepared.active,false);assert.ok(env.renders.every(item=>item.disposed));assert.equal(env.live.querySelector('svg'),null);assert.equal(env.document.querySelector('[data-notation-preparation]'),null);
 prepared.dispose();assert.equal(prepared.renderer.setExpectedWrittenNotes({sourceNoteIds:['original-1'],sourceMeasureIndex:0}),false);
});

const turn=()=>new Promise(resolve=>setImmediate(resolve));
function nativePreparationEnvironment({delay=false}={}){
 const fixture=JSON.parse(readFileSync(new URL('./fixtures/basic-key-quiet-window.json',import.meta.url),'utf8')),descriptor=fixture.open.clean_package,song=prepareCleanSong(`native:song-${descriptor.content_sha256}`,descriptor,null);
 const {document}=parseHTML('<html><body></body></html>'),find=document.getElementById.bind(document),requests=[],renders=[],mutations=[],resizes=[],windowListeners=new Map(),delayed=deferred();let width=900;
 document.getElementById=id=>{let node=find(id);if(!node){node=document.createElement('div');node.id=id;node.value='';document.body.append(node);}return node;};
 const viewWindow={CustomEvent:document.defaultView.CustomEvent,addEventListener(type,callback){windowListeners.set(type,callback);}};
 Object.defineProperty(document,'defaultView',{value:viewWindow});
 const saved=Object.fromEntries(['window','MutationObserver','ResizeObserver','fetch'].map(key=>[key,globalThis[key]]));
 globalThis.window=viewWindow;
 globalThis.MutationObserver=class{constructor(callback){this.callback=callback;mutations.push(this);}observe(node,options){this.node=node;this.options=options;}disconnect(){}};
 globalThis.ResizeObserver=class{constructor(callback){this.callback=callback;resizes.push(this);}observe(){}disconnect(){}};
 globalThis.fetch=(path,options)=>{const response=deferred();requests.push({path,options,...response});return response.promise;};
 const live=document.getElementById('engraved-staff');Object.defineProperty(live,'clientWidth',{get:()=>width});
 const clock=(running,position=1000)=>publishPlaybackClock(document.getElementById('progress'),{positionMs:position,durationMs:song.compilation.timeline.duration_ms,running,hasStarted:running||position>0});
 clock(false,0);
 const adapter={disposeEngravedStaff(){},async renderEngravedStaff(mount,xml,options,signal){
  const svg=document.createElement('svg');svg.dataset.originalId=options.identity.score.parts[0].notes[0].id;mount.append(svg);
  const entry={mount,svg,options,signal,disposed:false,applied:[],geometry:[]};renders.push(entry);
  const result={ok:true,metadata:{fromMeasure:1,toMeasure:1},dispose(){if(entry.disposed)return;entry.disposed=true;signal.removeEventListener('abort',result.dispose);svg.remove();},mappingStatus:()=>({status:'ready',verifiedGlyphCount:1,displayedSegmentCount:1,diagnostics:[]}),setExpectedWrittenNotes(value){entry.applied.push(value);return true;},clearExpectedWrittenNotes:()=>true,refreshExpectedCueGeometry(){entry.geometry.push(mount.parentElement?.id);},expectedNoteBounds:()=>({status:'ready',rects:[]})};
  signal.addEventListener('abort',result.dispose,{once:true});options.onMappingChange?.(result.mappingStatus());if(delay)await delayed.promise;return result;
 }};
 const view=setupEngravedView({document,i18n:createI18n({locale:'en'}),getScore:()=>song.notation,getCleanSong:()=>song,getPracticePart:()=>song.notation.parts[0].id,getMode:()=> 'practice',isVisible:()=>true,onVisibility(){},onFallback(){},notice(){},loadAdapter:async()=>adapter});
 return {fixture,song,document,live,view,requests,renders,mutations,resizes,clock,delayed,setWidth(value){width=value;windowListeners.get('resize')?.();},async readyJson(){view.updateScore();requests[0].resolve({ok:true,json:async()=>fixture.first.response});await turn();requests[1].resolve({ok:true,json:async()=>fixture.next.response});await turn();},close(){delayed.resolve();view.hide();for(const[key,value]of Object.entries(saved))if(value===undefined)delete globalThis[key];else globalThis[key]=value;}};
}

test('native next-page rendering waits for the playing clock and adopts exact source-owned mounts without rendering again',async()=>{
 const env=nativePreparationEnvironment();try{
  await env.readyJson();assert.equal(env.renders.length,0,'JSON prefetch before Listen cannot start speculative OSMD work');const old=env.live.firstElementChild;
  env.view.followPosition(1000);await turn();assert.equal(env.renders.length,0);
  env.clock(true);assert.equal(env.view.followPosition(1000).status,'ready');await turn();
  assert.equal(env.renders.length,1);const entry=env.renders[0],before=JSON.stringify(env.song);assert.equal(entry.options.cooperative,true);assert.equal(env.view.basicPage().first_measure,0);assert.equal(env.live.firstElementChild,old);assert.equal(env.live.querySelector('svg'),null);assert.deepEqual(entry.applied,[]);assert.deepEqual(entry.geometry,[]);
  assert.equal(env.view.followPosition(16001).status,'pending');await turn();
  assert.equal(env.view.basicPage().first_measure,8);assert.equal(env.renders.length,1,'The page boundary adopts the prepared renderer instead of rebuilding it');assert.equal(env.live.querySelector('svg'),entry.svg);assert.deepEqual(entry.geometry,['engraved-staff']);assert.equal(env.document.querySelector('[data-notation-preparation]'),null);
  assert.equal(env.view.setExpectedWrittenNotes({sourceNoteIds:['midi-t1-e2'],sourceMeasureIndex:8}),true);assert.deepEqual(entry.applied.at(-1),{sourceNoteIds:['midi-t1-e2'],sourceMeasureIndex:0});assert.equal(JSON.stringify(env.song),before);
 }finally{env.close();}
});

test('scope, dimensions, seek, pause and source-generation changes discard prepared native renderers',async()=>{
 for(const change of ['scope','width','seek','pause','hide','theme']){
  const env=nativePreparationEnvironment();try{
   await env.readyJson();env.clock(true);env.view.followPosition(1000);await turn();const entry=env.renders[0];assert.ok(entry);assert.ok(env.document.querySelector('[data-notation-preparation]'));
   if(change==='scope')env.view.setScope({scope:'all'});
   if(change==='width')env.setWidth(800);
   if(change==='seek')env.document.getElementById('progress').dispatchEvent(new env.document.defaultView.CustomEvent('input'));
   if(change==='pause'){env.clock(false);env.mutations.find(item=>item.node.id==='progress').callback();}
   if(change==='hide')env.view.hide();
   if(change==='theme'){env.document.documentElement.dataset.theme='dark';env.mutations.find(item=>item.node===env.document.documentElement).callback();}
   assert.equal(entry.disposed,true,change);assert.equal(entry.signal.aborted,true,change);assert.equal(env.document.querySelector('[data-notation-preparation]'),null,change);assert.equal(env.live.querySelector('svg'),null,change);assert.deepEqual(entry.applied,[],change);
  }finally{env.close();}
 }
});

test('an unfinished next visual batch stays private at the boundary and a later seek cannot adopt it',async()=>{
 const env=nativePreparationEnvironment({delay:true});try{
  await env.readyJson();env.clock(true);env.view.followPosition(1000);await turn();const entry=env.renders[0],old=env.live.firstElementChild;
  env.view.followPosition(16001);await turn();assert.equal(env.live.firstElementChild,old);assert.equal(env.view.basicPage().first_measure,0,'Current native page changes only when the whole staged batch is ready');assert.deepEqual(entry.applied,[]);
  env.view.hide();env.delayed.resolve();await turn();assert.equal(entry.disposed,true);assert.equal(env.live.children.length,0);assert.equal(env.document.querySelector('[data-notation-preparation]'),null);
 }finally{env.close();}
});

test('a backwards seek during pending adoption requests the new source position before any future-page publication',async()=>{
 const env=nativePreparationEnvironment({delay:true});try{
  await env.readyJson();env.clock(true);env.view.followPosition(1000);await turn();const entry=env.renders[0],old=env.live.firstElementChild;
  env.view.followPosition(16001);await turn();env.view.followPosition(1000);env.delayed.resolve();await turn();
  assert.equal(entry.disposed,true);assert.equal(env.live.firstElementChild,old);assert.equal(env.live.querySelector('svg'),null);assert.equal(env.view.basicPage().first_measure,0);
  assert.equal(JSON.parse(env.requests.at(-1).options.body).settings.position_ms,1000);assert.deepEqual(entry.applied,[]);
 }finally{env.close();}
});

test('a staged resize failure cannot leave a broken prepared batch or repeatedly retry while the page is unchanged',async()=>{
 const env=nativePreparationEnvironment();try{
  await env.readyJson();env.clock(true);env.view.followPosition(1000);await turn();const entry=env.renders[0],old=env.live.firstElementChild;
  entry.options.onError({status:'error',message:'Synthetic staged resize failure'});
  assert.equal(entry.disposed,true);assert.equal(entry.signal.aborted,true);assert.equal(env.document.querySelector('[data-notation-preparation]'),null);assert.equal(env.live.firstElementChild,old);assert.equal(env.view.isActive(),true);
  for(const position of [1100,1200,1300])env.view.followPosition(position);await turn();assert.equal(env.renders.length,1);
  env.view.followPosition(16001);await turn();assert.equal(env.renders.length,2,'The complete target page can still use the ordinary foreground renderer');assert.equal(env.live.querySelector('svg'),env.renders[1].svg);
 }finally{env.close();}
});
