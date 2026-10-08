import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {parseHTML} from 'linkedom';
import {setupCompleteScoreReader} from '../web/complete-score-reader.js';
import {createI18n} from '../web/i18n.js';
import {fixture} from './frontend-fixtures.js';
import {prepareCleanSong} from '../web/clean-song-package.js';
import {notationAudioAdmission} from '../web/engraving-render-scheduler.js';

const deferred=()=>{let resolve;const promise=new Promise(done=>resolve=done);return{promise,resolve};};
const tick=()=>new Promise(resolve=>setImmediate(resolve));
const read=name=>JSON.parse(readFileSync(new URL(`./fixtures/${name}.json`,import.meta.url),'utf8'));
function nativeFixture(name='basic-key-rendition-notation-page'){
 const data=read(name),descriptor=data.open.clean_package;
 return{data,song:prepareCleanSong(`native:song-${descriptor.content_sha256}`,descriptor,null)};
}
function environment({score=structuredClone(fixture),song=null,getExportScore,fetch,render,loadAdapter,observe=false,nativeDialog=false,measureCount=8,maxParts=4}={}){
 const {document,window}=parseHTML('<html><body><main id="stage"><button id="open">Open</button><input id="follow" type="checkbox"></main><aside inert></aside></body></html>');
 // linkedom deliberately omits browser selection/focus/dialog implementations.
 // These shims test ownership and event routing, not native-browser layout.
 let active=document.getElementById('open');Object.defineProperty(document,'activeElement',{get:()=>active});
 window.HTMLElement.prototype.focus=function(){active=this;};
 Object.defineProperty(window.HTMLElement.prototype,'tabIndex',{configurable:true,get(){return this.hasAttribute('tabindex')?Number(this.getAttribute('tabindex')):['BUTTON','SELECT','A','SUMMARY'].includes(this.tagName)?0:-1;},set(value){this.setAttribute('tabindex',value);}});
 const selectPrototype=Object.getPrototypeOf(document.createElement('select')),value=Object.getOwnPropertyDescriptor(selectPrototype,'value');
 if(!value.set)Object.defineProperty(selectPrototype,'value',{...value,set(next){for(const option of this.options){if(option.value===next)option.setAttribute('selected','');else option.removeAttribute('selected');}}});
 const i18n=createI18n({locale:'en'});
 const calls=[],renders=[],visibility=[],disposals=[],observers=[];let source=score,clean=song,adapterLoads=0;
 if(observe)window.IntersectionObserver=class{constructor(callback,options){this.callback=callback;this.options=options;this.disconnected=false;observers.push(this);}observe(target){this.target=target;}disconnect(){this.disconnected=true;}};
 else window.IntersectionObserver=undefined;
 const defaultFetch=async(path,options)=>({ok:true,json:async()=>({xml:'<score-partwise/>',part_id_map:Object.fromEntries(source.parts.map(part=>[part.id,`xml-${part.id}`])),diagnostics:[]})});
 const reader=setupCompleteScoreReader({document,getScore:()=>source,getCleanSong:()=>clean,getExportScore:getExportScore?()=>getExportScore(source):()=>source,i18n,measureCount,maxParts,onVisibility:visible=>visibility.push(visible),fetch:async(path,options)=>{calls.push({path,options,body:JSON.parse(options.body)});return(fetch||defaultFetch)(path,options);},loadAdapter:async()=>{adapterLoads++;if(loadAdapter)return loadAdapter();return{async renderEngravedStaff(container,xml,options,signal){renders.push({container,xml,options,signal});if(render)return render(container,xml,options,signal);const svg=document.createElement('svg');container.append(svg);return{ok:true,status:'ready',dispose(){disposals.push(container);container.replaceChildren();}};}};}});
 const dialog=document.getElementById('complete-score-reader');if(nativeDialog){dialog.showModal=()=>dialog.setAttribute('open','');dialog.close=()=>{dialog.removeAttribute('open');dialog.dispatchEvent(new window.Event('close'));};Object.defineProperty(dialog,'open',{get:()=>dialog.hasAttribute('open')});}
 return{reader,document,window,dialog,i18n,calls,renders,visibility,disposals,observers,get adapterLoads(){return adapterLoads;},setScore(next){source=next;reader.scoreChanged();},setSong(next){clean=next;reader.scoreChanged();},close(){reader.dispose();}};
}

test('complete reader is lazy, independent of follow/current view, and reaches every canonical part/window',async()=>{
 const score=structuredClone(fixture);score.parts=Array.from({length:7},(_,index)=>({...score.parts[0],id:`part-${index}`,name:`Part ${index}`,notes:score.parts[0].notes.map(note=>({...note,id:`${note.id}-${index}`}))}));score.measures=Array.from({length:19},(_,index)=>({...score.measures[0],number:index+1,at:{numerator:index*4,denominator:1}}));
 const original=JSON.stringify(score),env=environment({score});try{
  const follow=env.document.getElementById('follow');follow.checked=false;env.document.getElementById('stage').scrollTop=83;
  assert.equal(env.calls.length,0);assert.equal(env.reader.isOpen(),false);await env.reader.open();
  assert.equal(env.calls.length,1);assert.equal(env.renders.length,1);assert.deepEqual(env.reader.state().partIds,score.parts.map(part=>part.id));assert.equal(env.reader.state().endReached,false);assert.match(env.document.querySelector('.complete-score-reader-status').textContent,/4 of 7/);
  while(!env.reader.state().endReached)await env.reader.loadMore();
  assert.deepEqual(env.renders.map(({options})=>[options.fromMeasure,options.toMeasure,options.partIds.length]),[[1,8,4],[1,8,3],[9,16,4],[9,16,3],[17,19,4],[17,19,3]]);
  assert.equal(env.calls.length,1,'Exact native export is reused without re-exporting pages');assert.equal(env.reader.state().unavailableSections,0);assert.equal(env.reader.state().loadedSections,6);
  assert.equal(follow.checked,false);assert.equal(env.document.getElementById('stage').scrollTop,83);assert.equal(JSON.stringify(score),original);env.reader.close();assert.equal(env.disposals.length,6);assert.equal(follow.checked,false);assert.deepEqual(env.visibility,[true,false]);assert.equal(env.document.activeElement.id,'open');
 }finally{env.close();}
});

test('source snapshot exported by getExportScore is not the reduced practice score',async()=>{
 const full=structuredClone(fixture),display={...full,parts:[]},env=environment({score:display,getExportScore:()=>full,fetch:async()=>({ok:true,json:async()=>({xml:'xml',part_id_map:{piano:'P1'}})})});try{await env.reader.open();assert.deepEqual(env.calls[0].body,full);assert.equal(env.reader.state().totalParts,1);assert.deepEqual(env.renders[0].options.partIds,['P1']);}finally{env.close();}
});

test('source replacement synchronously hides/disposes and rejects a late export without painting',async()=>{
 const pending=deferred(),env=environment({fetch:()=>pending.promise});try{
  const opening=env.reader.open(),signal=env.calls[0].options.signal;env.setScore({...structuredClone(fixture),id:'replacement'});
  assert.equal(signal.aborted,true);assert.equal(env.reader.isOpen(),false);assert.equal(env.dialog.hidden,true);pending.resolve({ok:true,json:async()=>({xml:'obsolete',part_id_map:{piano:'P1'}})});await opening;assert.equal(env.renders.length,0);assert.equal(env.document.querySelectorAll('.complete-score-reader-section').length,0);assert.deepEqual(env.visibility,[true,false]);
 }finally{env.close();}
});

test('close during a renderer cancels the owner and disposes its eventual result',async()=>{
 const pending=deferred();let disposed=0,signal;const env=environment({render:async(container,xml,options,owner)=>{signal=owner;await pending.promise;return{ok:true,dispose(){disposed++;}};}});try{const opening=env.reader.open();await tick();env.reader.close();assert.equal(signal.aborted,true);pending.resolve();await opening;assert.equal(disposed,1);assert.equal(env.reader.state().status,'closed');}finally{env.close();}
});

test('fallback and native dialog Escape/back restore focus and preserve prior inert state',async()=>{
 for(const nativeDialog of [false,true]){const env=environment({nativeDialog});try{
  await env.reader.open();assert.equal(env.document.activeElement.className,'complete-score-reader-back');if(!nativeDialog)assert.equal(env.document.getElementById('stage').hasAttribute('inert'),true);
  const last=env.document.querySelector('.complete-score-reader-scroll');last.focus();const tab=new env.window.Event('keydown',{bubbles:true,cancelable:true});Object.defineProperties(tab,{key:{value:'Tab'},shiftKey:{value:false}});env.document.dispatchEvent(tab);assert.equal(env.document.activeElement.className,'complete-score-reader-back');assert.equal(tab.defaultPrevented,true);
  const escape=new env.window.Event('keydown',{bubbles:true,cancelable:true});Object.defineProperty(escape,'key',{value:'Escape'});env.document.dispatchEvent(escape);assert.equal(env.reader.isOpen(),false);assert.equal(env.document.activeElement.id,'open');assert.equal(env.document.getElementById('stage').hasAttribute('inert'),false);assert.equal(env.document.querySelector('aside').hasAttribute('inert'),true);
 }finally{env.close();}}
});

test('near-end observer is scoped to the reader, loads one bounded batch, and disconnects on close',async()=>{
 const score=structuredClone(fixture);score.measures=Array.from({length:20},(_,i)=>({...score.measures[0],number:i+1}));const env=environment({score,observe:true});try{await env.reader.open();const observer=env.observers.at(-1);assert.equal(observer.options.root,env.document.querySelector('.complete-score-reader-scroll'));assert.equal(env.renders.length,1);observer.callback([{isIntersecting:true}]);await tick();assert.equal(env.renders.length,2);env.reader.close();assert.equal(observer.disconnected,true);observer.callback([{isIntersecting:true}]);await tick();assert.equal(env.renders.length,2);}finally{env.close();}
});

test('basic native coverage includes every part, synthetic onset and percussion event without inventing staff notes',async()=>{
 const {data,song}=nativeFixture(),pages=new Map([data.melodic,data.percussion,data.third_part].map(item=>[item.request.settings.part_id,item.response])),env=environment({score:song.notation,song,fetch:async(path,options)=>({ok:true,json:async()=>structuredClone(pages.get(JSON.parse(options.body).settings.part_id))})});try{
  env.document.querySelectorAll('.complete-score-reader-controls select')[1].value='4/4';await env.reader.open();const report=env.reader.state();assert.equal(report.endReached,true);assert.equal(report.totalParts,3);assert.equal(report.reachedParts,3);assert.equal(report.inspectedAttacks,5);assert.equal(report.sourceAttacks,5);assert.equal(report.eventDetails,2);assert.equal(env.renders.length,2);assert.equal(env.calls.length,3);
  const eventRows=[...env.document.querySelectorAll('.complete-score-reader-events li')];assert.equal(eventRows.length,2);assert.ok(eventRows.some(row=>row.textContent.includes('percussion selector')));assert.ok(eventRows.some(row=>row.textContent.includes('synthetic onset')));assert.ok(env.calls.every(call=>!('position_ms'in call.body.settings)));assert.ok(env.renders.every(call=>call.options.cooperative&&call.options.identity));assert.match(env.document.querySelector('.complete-score-reader-source-notice').textContent,/not invented pitched notes/);
 }finally{env.close();}
});

test('native long score loads later measures lazily, retaining terminal synthetic attacks',async()=>{
 const {data,song}=nativeFixture('basic-key-rendition-notation-tail'),env=environment({score:song.notation,song,measureCount:1,fetch:async(path,options)=>({ok:true,json:async()=>structuredClone(data.pages[JSON.parse(options.body).settings.first_measure].response)})});try{
  await env.reader.open();assert.equal(env.calls.length,1);assert.equal(env.reader.state().endReached,false);assert.equal(env.reader.state().inspectedAttacks,2);
  while(!env.reader.state().endReached)await env.reader.loadMore();assert.deepEqual(env.calls.map(call=>call.body.settings.first_measure),[0,1,2,3]);assert.equal(env.reader.state().inspectedAttacks,3);assert.equal(env.reader.state().eventDetails,2);assert.ok(env.document.querySelector('[data-note-id="midi-t1-e7"]'));
 }finally{env.close();}
});

test('dense native pages retry smaller windows and a one-measure limit stays visibly unavailable',async()=>{
 const {data,song}=nativeFixture();let attempts=0;const env=environment({score:song.notation,song,maxParts:1,fetch:async(path,options)=>{attempts++;const count=JSON.parse(options.body).settings.measure_count,response=structuredClone(data.melodic.response);if(count>1){response.page.status='page_limit';delete response.page.score;delete response.page.musicxml;}return{ok:true,json:async()=>response};}});try{
  await env.reader.open();assert.equal(attempts,4);assert.deepEqual(env.calls.map(call=>call.body.settings.measure_count),[8,4,2,1]);assert.equal(env.reader.state().unavailableSections,0);assert.equal(env.reader.state().reachedParts,1);assert.equal(env.reader.state().endReached,false);
 }finally{env.close();}
 const blocked=environment({score:song.notation,song,maxParts:1,measureCount:1,fetch:async()=>{const response=structuredClone(data.melodic.response);response.page.status='page_limit';delete response.page.score;delete response.page.musicxml;return{ok:true,json:async()=>response};}});try{await blocked.reader.open();assert.equal(blocked.reader.state().unavailableSections,1);assert.match(blocked.document.querySelector('.complete-score-reader-section-notice').textContent,/not been silently truncated/);assert.equal(blocked.reader.state().endReached,false);}finally{blocked.close();}
});

test('invalid native source identity cannot publish a staff or claim attack coverage',async()=>{
 const {data,song}=nativeFixture(),response=structuredClone(data.melodic.response);response.source.content_sha256='0'.repeat(64);const env=environment({score:song.notation,song,fetch:async()=>({ok:true,json:async()=>response})});try{await env.reader.open();assert.equal(env.renders.length,0);assert.equal(env.reader.state().inspectedAttacks,0);assert.equal(env.reader.state().unavailableSections,3);assert.match(env.document.querySelector('.complete-score-reader-status').textContent,/not been represented/);}finally{env.close();}
});

test('renderer refusal retains every part and reports unavailable coverage instead of complete notation',async()=>{
 const score=structuredClone(fixture);score.parts=Array.from({length:6},(_,i)=>({...score.parts[0],id:`p${i}`}));const env=environment({score,render:async()=>({ok:false,status:'unsupported',message:'Unsupported source feature.',dispose(){}})});try{await env.reader.open();await env.reader.loadMore();assert.equal(env.reader.state().endReached,true);assert.equal(env.reader.state().unavailableSections,2);assert.equal(env.reader.state().reachedParts,6);assert.match(env.document.querySelector('.complete-score-reader-status').textContent,/full staff coverage is not established/);assert.equal(env.document.querySelectorAll('[data-status="unavailable"]').length,2);}finally{env.close();}
});

test('notation adapter respects the shared audio admission gate and close aborts queued work',async()=>{
 const env=environment();try{const lease=await notationAudioAdmission(env.window).acquireAudio();const opening=env.reader.open();await tick();assert.equal(env.adapterLoads,0);env.reader.close();lease.release();await opening;assert.equal(env.adapterLoads,0);assert.equal(env.renders.length,0);}finally{env.close();}
});

test('responsive CSS bounds the modal and uses an independent lazy scroll container',()=>{
 const css=readFileSync(new URL('../web/complete-score-reader.css',import.meta.url),'utf8');assert.match(css,/max-width: calc\(100vw/);assert.match(css,/max-height: calc\(100dvh/);assert.match(css,/\.complete-score-reader-scroll[^}]*overflow: auto/s);assert.match(css,/\.complete-score-reader\[hidden\] \{ display: none/);assert.match(css,/overscroll-behavior: contain/);
});


test('source-only pages retain unresolved and instantaneous events and disclose unbrowsable percussion',async()=>{
 const {data,song}=nativeFixture(),env=environment({score:song.notation,song,fetch:async(path,options)=>{const settings=JSON.parse(options.body).settings;assert.equal(settings.rendition_policy_id,undefined);let response;if(settings.part_id===data.melodic.request.settings.part_id)response=structuredClone(data.legacy);else{response=structuredClone(data.percussion.response);response.page={...response.page,view_version:1,status:'percussion_mapping_required',coverage:{source_attacks:5,part_attacks:1,window_attacks:0,rendered_positive_keys:0,unresolved_attacks:0,instantaneous_attacks:0},unresolved:[],instantaneous:[],continuations:[]};delete response.page.score;delete response.page.musicxml;delete response.page.measure_count;delete response.page.total_measures;}return{ok:true,json:async()=>response};}});try{
  env.document.querySelector('.complete-score-reader-controls select').value='source';await env.reader.open();assert.equal(env.renders.length,1);assert.equal(env.reader.state().inspectedAttacks,3);assert.equal(env.reader.state().endReached,false);assert.equal(env.reader.state().hasMore,false);assert.equal(env.reader.state().blockedParts,2);assert.match(env.document.querySelector('.complete-score-reader-status').textContent,/could not be browsed to their end/);assert.ok([...env.document.querySelectorAll('.complete-score-reader-events li')].some(row=>row.textContent.includes('unresolved source duration')));assert.ok([...env.document.querySelectorAll('.complete-score-reader-events li')].some(row=>row.textContent.includes('instantaneous source attack')));
 }finally{env.close();}
});

test('locale changes only redraw retained labels, and close restores prior page scroll lock',async()=>{
 const env=environment();try{env.document.body.style.overflow='scroll';await env.reader.open();assert.equal(env.document.body.style.overflow,'hidden');const count=env.calls.length,renders=env.renders.length;env.i18n.setLocale('zh-CN');assert.equal(env.document.getElementById('complete-score-reader-title').textContent,'完整乐谱');assert.equal(env.calls.length,count);assert.equal(env.renders.length,renders);env.reader.close();assert.equal(env.document.body.style.overflow,'scroll');assert.equal(env.document.querySelector('.complete-score-reader-backdrop').hidden,true);}finally{env.close();}
});

test('changing a reader-only display choice aborts old work without mutating the stage',async()=>{
 const {data,song}=nativeFixture(),pending=deferred(),pages=new Map([data.melodic,data.percussion,data.third_part].map(item=>[item.request.settings.part_id,item.response]));let first=true;
 const env=environment({score:song.notation,song,fetch:(path,options)=>{if(first){first=false;return pending.promise;}return Promise.resolve({ok:true,json:async()=>structuredClone(pages.get(JSON.parse(options.body).settings.part_id))});}});try{
  const opening=env.reader.open(),obsolete=env.calls[0];const control=env.document.querySelectorAll('.complete-score-reader-controls select')[1];control.value='3/4';control.dispatchEvent(new env.window.Event('change'));assert.equal(obsolete.options.signal.aborted,true);pending.resolve({ok:true,json:async()=>structuredClone(data.melodic.response)});await opening;await tick();assert.equal(env.reader.state().inspectedAttacks,5);assert.equal(env.reader.state().loadedSections,3);assert.ok(env.calls.slice(1).every(call=>call.body.settings.display_meter.numerator===3));assert.equal(env.document.getElementById('stage').hasAttribute('inert'),true);
 }finally{env.close();}
});


test('a throwing optional renderer still retains native event identities without duplicate sections',async()=>{
 const {data,song}=nativeFixture(),pages=new Map([data.melodic,data.percussion,data.third_part].map(item=>[item.request.settings.part_id,item.response])),env=environment({score:song.notation,song,render:async()=>{throw new Error('Optional renderer failed.');},fetch:async(path,options)=>({ok:true,json:async()=>structuredClone(pages.get(JSON.parse(options.body).settings.part_id))})});try{await env.reader.open();assert.equal(env.reader.state().loadedSections,3);assert.equal(env.reader.state().unavailableSections,2);assert.equal(env.reader.state().inspectedAttacks,5);assert.equal(env.reader.state().eventDetails,5);assert.equal(env.document.querySelectorAll('.complete-score-reader-section').length,3);assert.equal(env.document.querySelectorAll('.complete-score-reader-events li').length,5);}finally{env.close();}
});


test('close/reopen starts at the source beginning and repeated open preserves the existing owner',async()=>{
 const score=structuredClone(fixture);score.measures=Array.from({length:17},(_,i)=>({...score.measures[0],number:i+1}));const env=environment({score});try{await env.reader.open();await env.reader.loadMore();assert.equal(env.renders.at(-1).options.fromMeasure,9);const calls=env.calls.length,renders=env.renders.length;await env.reader.open();assert.equal(env.calls.length,calls);assert.equal(env.renders.length,renders);env.reader.close();await env.reader.open();assert.equal(env.renders.at(-1).options.fromMeasure,1);assert.equal(env.reader.state().loadedSections,1);assert.equal(env.document.querySelectorAll('.complete-score-reader-section').length,1);assert.equal(env.reader.state().endReached,false);assert.deepEqual(env.visibility,[true,false,true]);}finally{env.close();}
});


test('compact modal keeps all variable-height content in the scroll surface and Back outside it',async()=>{
 const {song}=nativeFixture(),env=environment({score:song.notation,song,fetch:async()=>({ok:false,json:async()=>({error:'Source detail '.repeat(100)})})});try{
  await env.reader.open();const scroller=env.document.querySelector('.complete-score-reader-scroll'),header=env.document.querySelector('.complete-score-reader-header');
  assert.deepEqual([...env.dialog.children],[header,scroller],'Variable-height title, prose and controls cannot consume fixed modal height');
  for(const className of ['song','intro','controls','source-notice','status','sections','sentinel'])assert.equal(env.document.querySelector(`.complete-score-reader-${className}`).parentNode,scroller,className);
  assert.equal(env.document.querySelector('.complete-score-reader-back').parentNode,header,'Back remains reachable while the content is scrolled');
  const css=readFileSync(new URL('../web/complete-score-reader.css',import.meta.url),'utf8');assert.match(css,/\.complete-score-reader-scroll[^}]*min-height: 0[^}]*flex: 1 1 auto[^}]*overflow: auto/s);assert.doesNotMatch(css,/\.complete-score-reader-scroll[^}]*min-height: (?:5rem|[1-9]\d*px)/s);
 }finally{env.close();}
});
