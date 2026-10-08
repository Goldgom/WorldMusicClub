import test from 'node:test';
import assert from 'node:assert/strict';
import {createI18n} from '../web/i18n.js';
import {setupEngravedView} from '../web/engraved-view.js';
import {fixture} from './frontend-fixtures.js';
import {readFileSync} from 'node:fs';
import {prepareCleanSong} from '../web/clean-song-package.js';
import {basicKeyWrittenAt} from '../web/basic-key-notation.js';
import {planEngravingReveal} from '../web/engraving-reveal.js';
import {NotationNavigationIndex,setupNotationFollowing} from '../web/notation-follow.js';
import {originalAboveKeyboardScore} from './above-keyboard-browser-regression.js';
import {notationAudioAdmission} from '../web/engraving-render-scheduler.js';
import {setupWrittenCursor} from '../web/written-cursor.js';
import {audioAssistanceFixture} from './practice-assistance-audio-fixtures.js';
import {createPracticeAssistanceDisplayIndex} from '../web/practice-assistance-display.js';
import {beat,pitchMidi} from '../web/music.js';
const deferred=()=>{let resolve;const promise=new Promise(done=>resolve=done);return{promise,resolve}};
function environment({loadAdapter,onManualNavigation,onBasicPage,onRenderComplete,isVisible,getCleanSong,getPracticePart=()=>null,getPracticeSelection,getPracticeDisplay,getPracticeAssistanceDisplay,getMode,observeResize=false,i18n=createI18n({locale:'en'})}={}){
 const prior=Object.fromEntries(['document','window','MutationObserver','ResizeObserver','fetch'].map(key=>[key,globalThis[key]]));const elements=new Map(),calls=[],visible=[],failures=[],resizeObservers=[],windowListeners=new Map();let score=null,pauses=0;const failure=deferred();
 const element=id=>{if(!elements.has(id))elements.set(id,{textContent:'',hidden:true,value:'',children:[],listeners:new Map(),addEventListener(type,handler){this.listeners.set(type,handler)},replaceChildren(){this.children=[]},append(item){this.children.push(item)}});return elements.get(id)};
 globalThis.document={getElementById:element,createElement:()=>({children:[],dataset:{},append(item){this.children.push(item)},replaceChildren(){this.children=[]}}),documentElement:{dataset:{theme:'light'}}};globalThis.window={addEventListener(type,handler){if(!windowListeners.has(type))windowListeners.set(type,[]);windowListeners.get(type).push(handler)}};globalThis.MutationObserver=class{observe(){}};globalThis.fetch=(path,options)=>{const response=deferred();calls.push({path,options,...response});return response.promise};
 if(observeResize)globalThis.ResizeObserver=class{constructor(callback){this.callback=callback;this.observed=[];resizeObservers.push(this)}observe(element){this.observed.push(element)}disconnect(){this.observed=[]}};
 const view=setupEngravedView({i18n,getScore:()=>score,getCleanSong,getPracticePart,getPracticeSelection,getPracticeDisplay,getPracticeAssistanceDisplay,getMode,isVisible,pausePlayback(){pauses++},onVisibility:value=>visible.push(value),onFallback(){failures.push(element('engraving-fallback').textContent);failure.resolve()},notice(){},loadAdapter,onManualNavigation,onBasicPage,onRenderComplete});
 return{view,elements,calls,visible,failures,failure,resizeObservers,windowListeners,get pauses(){return pauses},setScore(next=structuredClone(fixture)){score=next;view.updateScore();return score},close(){view.hide();for(const[key,value]of Object.entries(prior))if(value===undefined)delete globalThis[key];else globalThis[key]=value}};
}
test('the first score requests engraved presentation by default, without starting playback',()=>{const env=environment();try{assert.equal(env.calls.length,0);env.setScore();assert.equal(env.calls.length,1);assert.equal(env.view.isActive(),true);assert.equal(env.visible.at(-1),true);assert.equal(JSON.parse(env.calls[0].options.body).id,fixture.id);env.view.updateScore();assert.equal(env.calls.length,1,'Ordinary UI refreshes must not re-render an unchanged score');}finally{env.close()}});
test('duplicate visible surface notifications retain pending export and ready mount, while hiding cancels and returning renders',async()=>{
 let shown=false,renders=0,disposals=0;const mount={tagName:'svg'};
 const env=environment({isVisible:()=>shown,loadAdapter:async()=>({disposeEngravedStaff(){},async renderEngravedStaff(container,xml,options){renders++;container.append(mount);return{ok:true,metadata:{fromMeasure:options.fromMeasure,toMeasure:options.toMeasure},dispose(){disposals++;container.replaceChildren()}}}})});
 try{
  env.setScore();assert.equal(env.calls.length,0,'A hidden stage does not export');
  shown=true;env.view.surfaceChanged();const pending=env.calls[0];env.view.surfaceChanged();
  assert.equal(env.calls.length,1,'Notation opening and stage entry share the pending request');assert.equal(pending.options.signal.aborted,false);
  shown=false;env.view.surfaceChanged();assert.equal(pending.options.signal.aborted,true,'Leaving the stage cancels its pending request');
  shown=true;env.view.surfaceChanged();assert.equal(env.calls.length,2);env.view.surfaceChanged();assert.equal(env.calls.length,2);
  const exported={xml:'<score-partwise/>',part_id_map:{piano:'P1'},diagnostics:[]};
  pending.resolve({ok:false,status:400,json:async()=>({error:'Obsolete hidden-surface error'})});
  env.calls[1].resolve({ok:true,json:async()=>exported});await new Promise(resolve=>setImmediate(resolve));
  assert.equal(renders,1);assert.deepEqual(env.failures,[]);env.view.surfaceChanged();
  assert.equal(renders,1);assert.equal(disposals,0);assert.deepEqual(env.elements.get('engraved-staff').children,[mount]);
  shown=false;env.view.surfaceChanged();assert.equal(disposals,1);shown=true;env.view.surfaceChanged();await new Promise(resolve=>setImmediate(resolve));
  assert.equal(renders,2,'Returning mounts a new visible renderer');assert.equal(env.calls.length,2,'Returning uses the exact cached export');assert.equal(env.pauses,0);
 }finally{env.close()}
});

test('Jianpu surface entry owns one native page request while Follow is off and rejects a hidden prior score response',async()=>{
 const data=JSON.parse(readFileSync(new URL('./fixtures/basic-key-rendition-notation-page.json',import.meta.url),'utf8')),third=JSON.parse(readFileSync(new URL('./fixtures/basic-key-rendition-third-part.json',import.meta.url),'utf8')),descriptor=data.open.clean_package;
 let song=prepareCleanSong(`native:song-${descriptor.content_sha256}`,descriptor,null),shown=false,part=song.notation.parts[0].id,adapterLoads=0;const painted=[];
 const env=environment({isVisible:()=>shown,getCleanSong:()=>song,getPracticePart:()=>part,getMode:()=> 'practice',onBasicPage:page=>painted.push(page?.part_id),loadAdapter:async()=>{adapterLoads++;throw new Error('Jianpu must not load the staff renderer');}});
 try{
  env.setScore(song.notation);env.view.hide({remember:true});document.getElementById('engraving-follow').checked=false;
  shown=true;env.view.surfaceChanged();const obsolete=env.calls[0];assert.equal(env.calls.length,1,'Opening Jianpu starts its page without a Follow frame');assert.equal(env.view.isActive(),false);env.view.surfaceChanged();assert.equal(env.calls.length,1);assert.equal(obsolete.options.signal.aborted,false,'Repeated visible notifications preserve the same owner');
  shown=false;env.view.surfaceChanged();assert.equal(obsolete.options.signal.aborted,true);song=prepareCleanSong(`native:song-${descriptor.content_sha256}`,descriptor,null);part=song.notation.parts[2].id;env.setScore(song.notation);assert.equal(env.calls.length,1,'Loading the replacement in the library stays lazy');
  shown=true;env.view.surfaceChanged();env.view.surfaceChanged();assert.equal(env.calls.length,2);assert.equal(JSON.parse(env.calls[1].options.body).settings.part_id,part);obsolete.resolve({ok:true,json:async()=>data.melodic.response});await new Promise(resolve=>setImmediate(resolve));assert.deepEqual(painted,[]);assert.equal(env.view.basicPage(),null);
  env.calls[1].resolve({ok:true,json:async()=>third.response});await new Promise(resolve=>setImmediate(resolve));assert.deepEqual(painted,[part]);assert.equal(env.view.scopeInfo().status,'ready');assert.equal(env.view.basicPage().part_id,part);env.view.surfaceChanged();assert.equal(env.calls.length,2,'A ready retained page does not export again');assert.equal(adapterLoads,0);assert.equal(env.pauses,0);assert.deepEqual(env.failures,[]);
 }finally{env.close();}
});
test('a native notation reply defers parsing, validation and publication while audio owns admission',async()=>{
 const data=JSON.parse(readFileSync(new URL('./fixtures/basic-key-rendition-notation-page.json',import.meta.url),'utf8')),descriptor=data.open.clean_package;
 const song=prepareCleanSong(`native:song-${descriptor.content_sha256}`,descriptor,null),part=song.notation.parts[0].id,painted=[];
 let shown=false,parsed=0,audio;
 const env=environment({isVisible:()=>shown,getCleanSong:()=>song,getPracticePart:()=>part,getMode:()=> 'practice',onBasicPage:page=>painted.push(page?.part_id)});
 try{
  env.setScore(song.notation);env.view.hide({remember:true});shown=true;env.view.surfaceChanged();
  audio=await notationAudioAdmission(globalThis).acquireAudio();
  env.calls[0].resolve({ok:true,json:async()=>{parsed++;return data.melodic.response;}});
  await new Promise(resolve=>setImmediate(resolve));assert.equal(parsed,0);assert.deepEqual(painted,[]);
  audio.release();audio=null;await new Promise(resolve=>setImmediate(resolve));
  assert.equal(parsed,1);assert.deepEqual(painted,[part]);assert.equal(env.view.basicPage().part_id,part);assert.deepEqual(env.failures,[]);
 }finally{audio?.release();env.close();}
});

test('surface notifications preserve an in-flight renderer and its latest exact queued source identities',async()=>{
 const ready=deferred(),mount={tagName:'svg'},received=[];let renders=0,signal;
 const env=environment({loadAdapter:async()=>({disposeEngravedStaff(){},async renderEngravedStaff(container,xml,options,pendingSignal){
  assert.equal(options.cooperative,true);renders++;signal=pendingSignal;await ready.promise;container.append(mount);
  return{ok:true,metadata:{fromMeasure:options.fromMeasure,toMeasure:options.toMeasure},dispose(){container.replaceChildren()},mappingStatus:()=>({status:'ready',verifiedGlyphCount:1,diagnostics:[]}),setExpectedWrittenNotes(value){received.push(value);return true},clearExpectedWrittenNotes:()=>true};
 }})});
 try{
  const score=env.setScore(),original=JSON.stringify(score),expected={sourceNoteIds:['e4'],sourceMeasureIndex:0};
  env.calls[0].resolve({ok:true,json:async()=>({xml:'<score-partwise/>',part_id_map:{piano:'P1'},diagnostics:[]})});await new Promise(resolve=>setImmediate(resolve));
  env.view.setExpectedWrittenNotes({sourceNoteIds:['c4'],sourceMeasureIndex:0});env.view.surfaceChanged();env.view.setExpectedWrittenNotes(expected);env.view.surfaceChanged();
  assert.equal(renders,1);assert.equal(signal.aborted,false);assert.equal(env.calls.length,1);assert.equal(env.view.navigationState().ready,false);
  ready.resolve();await new Promise(resolve=>setImmediate(resolve));env.view.surfaceChanged();
  assert.deepEqual(received,[expected]);assert.deepEqual(env.elements.get('engraved-staff').children,[mount]);assert.equal(env.view.navigationState().ready,true);
  assert.equal(renders,1);assert.equal(env.calls.length,1);assert.equal(env.pauses,0);assert.equal(JSON.stringify(score),original);
 }finally{ready.resolve();env.close()}
});
test('explicit simplified or numbered selection survives score changes and cancels old exports',()=>{const env=environment();try{env.setScore();env.view.hide({remember:true});assert.equal(env.calls[0].options.signal.aborted,true);env.setScore({...structuredClone(fixture),id:'next'});assert.equal(env.calls.length,1);assert.equal(env.view.isActive(),false);env.view.show();assert.equal(env.calls.length,2);assert.equal(env.view.isActive(),true);}finally{env.close()}});
test('failed engraving retains its exact reason with a named fallback and retries only for a new score or explicit request',async()=>{const env=environment();try{env.setScore();env.calls[0].resolve({ok:false,status:400,json:async()=>({error:'Unsupported nonrepresentable rhythm.'})});await env.failure.promise;assert.equal(env.view.isActive(),false);assert.equal(env.elements.get('engraving-fallback').hidden,false);assert.match(env.failures[0],/Unsupported nonrepresentable rhythm/);assert.match(env.failures[0],/simplified pitch guide/);env.view.updateScore();assert.equal(env.calls.length,1);env.setScore({...structuredClone(fixture),id:'new-source'});assert.equal(env.calls.length,2);assert.equal(env.view.isActive(),true);assert.equal(env.elements.get('engraving-fallback').hidden,true);}finally{env.close()}});

test('automatic following renders only changed source pages and never pauses the audio transport',()=>{const env=environment();try{const score=structuredClone(fixture);score.measures=Array.from({length:20},(_,index)=>({number:99-index,at:{numerator:index*4,denominator:1},length:{numerator:4,denominator:1}}));env.setScore(score);assert.equal(env.pauses,0);assert.equal(env.view.followMeasure(7),false);assert.equal(env.calls.length,1);assert.equal(env.view.followMeasure(8),true);assert.equal(env.calls.length,2);assert.equal(env.calls[0].options.signal.aborted,true);assert.equal(env.pauses,0);for(let index=8;index<16;index++)assert.equal(env.view.followMeasure(index),false);assert.equal(env.calls.length,2);assert.equal(env.view.navigationState().from,9);assert.equal(env.view.followMeasure(0),true);assert.equal(env.calls.length,3);assert.equal(env.pauses,0);}finally{env.close()}});

test('pending expected-note requests validate exact membership without rerendering or requesting timing',()=>{const env=environment();try{env.setScore();const pauses=env.pauses;for(let frame=0;frame<20;frame++)assert.equal(env.view.setExpectedWrittenNotes({sourceNoteIds:frame%2?['c4']:['e4'],sourceMeasureIndex:0}),true);assert.equal(env.calls.length,1);assert.equal(env.pauses,pauses);for(const value of [{sourceNoteIds:['c4','c4'],sourceMeasureIndex:0},{sourceNoteIds:['missing'],sourceMeasureIndex:0},{sourceNoteIds:'c4',sourceMeasureIndex:0},{sourceNoteIds:[],sourceMeasureIndex:1}])assert.equal(env.view.setExpectedWrittenNotes(value),false);env.view.clearExpectedWrittenNotes();env.view.hide();assert.equal(env.view.setExpectedWrittenNotes({sourceNoteIds:['c4'],sourceMeasureIndex:0}),false);assert.equal(env.view.mappingStatus().verifiedGlyphCount,0);}finally{env.close()}});

test('successful static adapters without note mapping retain staff and report highlighting unavailable',async()=>{
 for(const queued of [false,true]){
  const svg={tagName:'svg'},expected={sourceNoteIds:['c4'],sourceMeasureIndex:0};let disposals=0;
  const env=environment({loadAdapter:async()=>({renderEngravedStaff:async(container,xml,options)=>{container.append(svg);return{ok:true,status:'ready',metadata:{fromMeasure:options.fromMeasure,toMeasure:options.toMeasure},dispose(){disposals++;container.replaceChildren()}}},disposeEngravedStaff(){}})});
  try{
   env.setScore();if(queued)assert.equal(env.view.setExpectedWrittenNotes(expected),true);
   env.calls[0].resolve({ok:true,json:async()=>({xml:'<score-partwise/>',part_id_map:{piano:'P1'},diagnostics:[{code:'source_notice',message:'Original source warning.'}]})});
   await new Promise(resolve=>setImmediate(resolve));
   assert.deepEqual(env.failures,[],'Optional mapping must not make a successful static render fall back');
   assert.equal(env.view.isActive(),true);assert.equal(env.view.navigationState().ready,true);
   assert.deepEqual(env.elements.get('engraved-staff').children,[svg]);assert.equal(disposals,0);
   assert.equal(env.elements.get('engraving-fallback').hidden,true);
   assert.match(env.elements.get('engraving-status').textContent,/Generated staff preview/);
   const mapping=env.view.mappingStatus();assert.equal(mapping.status,'unavailable');assert.equal(mapping.verifiedGlyphCount,0);
   assert.ok(mapping.diagnostics.some(item=>item.code==='engraving_note_mapping_unavailable'));
   const notices=env.elements.get('engraving-diagnostics').children.map(item=>item.textContent);
   assert.ok(notices.includes('Original technical details: Original source warning.'));assert.ok(notices.some(message=>/notehead mapping.*unavailable/i.test(message)));
   assert.equal(env.view.setExpectedWrittenNotes(expected),false);assert.equal(env.view.clearExpectedWrittenNotes(),false);
   assert.equal(env.calls.length,1);assert.equal(env.pauses,0);
   env.view.hide();assert.equal(disposals,1);assert.equal(env.view.navigationState().ready,false);
  }finally{env.close()}
 }
});

test('incomplete mapping capabilities never claim ready or call a partial highlighter',async()=>{
 for(const missing of ['mappingStatus','setExpectedWrittenNotes','clearExpectedWrittenNotes']){
  let mappingCalls=0;const expected={sourceNoteIds:['c4'],sourceMeasureIndex:0};
  const result={ok:true,status:'ready',metadata:{fromMeasure:1,toMeasure:1},dispose(){},mappingStatus(){mappingCalls++;return{status:'ready',verifiedGlyphCount:1,diagnostics:[]}},setExpectedWrittenNotes(){mappingCalls++;return true},clearExpectedWrittenNotes(){mappingCalls++;return true}};result[missing]=null;
  const env=environment({loadAdapter:async()=>({renderEngravedStaff:async()=>result,disposeEngravedStaff(){}})});
  try{
   env.setScore();env.view.setExpectedWrittenNotes(expected);env.calls[0].resolve({ok:true,json:async()=>({xml:'<score-partwise/>',part_id_map:{piano:'P1'},diagnostics:[]})});await new Promise(resolve=>setImmediate(resolve));
   assert.deepEqual(env.failures,[]);assert.equal(env.view.navigationState().ready,true);
   assert.equal(env.view.mappingStatus().status,'unavailable');assert.equal(env.view.mappingStatus().verifiedGlyphCount,0);
   assert.equal(env.view.setExpectedWrittenNotes(expected),false);assert.equal(env.view.clearExpectedWrittenNotes(),false);assert.equal(mappingCalls,0,missing);
  }finally{env.close()}
 }
});

test('complete mapping capabilities replay queued identities and preserve their reported status',async()=>{
 const applied=[],expected={sourceNoteIds:['c4'],sourceMeasureIndex:0},mapping={status:'partial',verifiedGlyphCount:1,displayedSegmentCount:2,diagnostics:[]};let cleared=0;
 const env=environment({loadAdapter:async()=>({renderEngravedStaff:async()=>({ok:true,status:'ready',metadata:{fromMeasure:1,toMeasure:1},dispose(){},mappingStatus:()=>mapping,setExpectedWrittenNotes(value){applied.push(value);return true},clearExpectedWrittenNotes(){cleared++;return true}}),disposeEngravedStaff(){}})});
 try{
  env.setScore();assert.equal(env.view.setExpectedWrittenNotes(expected),true);env.calls[0].resolve({ok:true,json:async()=>({xml:'<score-partwise/>',part_id_map:{piano:'P1'},diagnostics:[]})});await new Promise(resolve=>setImmediate(resolve));
  assert.deepEqual(env.failures,[]);assert.deepEqual(applied,[expected]);assert.equal(env.view.mappingStatus(),mapping);
  assert.ok(env.elements.get('engraving-diagnostics').children.some(item=>/1 of 2/.test(item.textContent)));
  assert.equal(env.view.setExpectedWrittenNotes(expected),true);assert.equal(applied.length,2);assert.equal(env.view.clearExpectedWrittenNotes(),true);assert.equal(cleared,1);
 }finally{env.close()}
});

test('verified reveal plans minimally move and clamp only the owned pane coordinates',()=>{
 const viewport={left:100,right:300,top:50,bottom:200,scrollTop:0,scrollLeft:0,maxTop:500,maxLeft:400};
 assert.deepEqual(planEngravingReveal([{left:150,right:160,top:100,bottom:110}],viewport),{scrollTop:0,scrollLeft:0,partial:false});
 assert.deepEqual(planEngravingReveal([{left:320,right:330,top:240,bottom:250}],viewport),{scrollTop:62,scrollLeft:42,partial:false});
 assert.deepEqual(planEngravingReveal([{left:-50,right:-40,top:-30,bottom:-20}],viewport),{scrollTop:0,scrollLeft:0,partial:true});
 const group=[{left:120,right:130,top:300,bottom:310},{left:150,right:160,top:600,bottom:610}];assert.equal(planEngravingReveal(group,viewport).partial,true);assert.deepEqual(planEngravingReveal(group,viewport),planEngravingReveal([...group].reverse(),viewport));
 const almostFull=[{left:105,right:295,top:55,bottom:195}];assert.deepEqual(planEngravingReveal(almostFull,viewport),{scrollTop:0,scrollLeft:0,partial:false},'A fitting group remains wholly visible instead of reserving an impossible margin');
 const full=[{left:180,right:380,top:125,bottom:275}];assert.deepEqual(planEngravingReveal(full,viewport),{scrollTop:75,scrollLeft:80,partial:false},'A viewport-sized group can be fully shown without a margin');
 assert.deepEqual(planEngravingReveal([{left:320,right:330,top:240,bottom:250}],{...viewport,maxTop:40,maxLeft:20}),{scrollTop:40,scrollLeft:20,partial:true});
 assert.equal(planEngravingReveal([],viewport),null);assert.equal(planEngravingReveal([{left:NaN,right:4,top:0,bottom:10}],viewport),null);
 assert.equal(planEngravingReveal(almostFull,{...viewport,right:viewport.left}),null);assert.equal(planEngravingReveal(almostFull,{...viewport,scrollTop:NaN}),null);
});

test('following reveals fresh verified bounds once per identity or geometry change and preserves paused state',async()=>{
 let reads=0,renderGeneration=1,boundsStatus='ready',throwBounds=false;const expected={sourceNoteIds:['c4'],sourceMeasureIndex:0},mapping={status:'ready',verifiedGlyphCount:1,diagnostics:[]};
 const env=environment({observeResize:true,loadAdapter:async()=>({renderEngravedStaff:async()=>({ok:true,status:'ready',metadata:{fromMeasure:1,toMeasure:1},dispose(){},mappingStatus:()=>mapping,setExpectedWrittenNotes:()=>true,clearExpectedWrittenNotes:()=>true,renderGeneration:()=>renderGeneration,expectedNoteBounds(){reads++;if(throwBounds)throw Error('Optional layout unavailable');return{status:boundsStatus,rects:[{xmlNoteId:'N1',left:250-scroller.scrollLeft,right:260-scroller.scrollLeft,top:350-dock.scrollTop,bottom:360-dock.scrollTop}]}}}),disposeEngravedStaff(){}})});
 const dock=env.elements.get('notation-dock'),scroller={clientTop:0,clientLeft:0,clientWidth:100,scrollLeft:0,scrollTop:0,scrollWidth:600,getBoundingClientRect:()=>({top:0,left:0,right:100,bottom:600}),scrollTo(value){Object.assign(this,{scrollLeft:value.left,scrollTop:value.top});assert.equal(value.behavior,'instant')}};
 Object.assign(dock,{clientTop:0,clientLeft:0,clientHeight:100,clientWidth:100,scrollTop:0,scrollLeft:0,scrollHeight:700,getBoundingClientRect:()=>({top:0,left:0,right:100,bottom:100}),scrollTo(value){Object.assign(this,{scrollLeft:value.left,scrollTop:value.top});assert.equal(value.behavior,'instant')}});
 env.elements.get('engraved-staff').closest=()=>scroller;
 try{
  const score=env.setScore(),before=JSON.stringify(score);env.view.setExpectedWrittenNotes(expected);env.calls[0].resolve({ok:true,json:async()=>({xml:'<score-partwise/>',part_id_map:{piano:'P1'},diagnostics:[]})});await new Promise(resolve=>setImmediate(resolve));
  assert.equal(env.view.revealExpectedWrittenNotes('occurrence-1').status,'unavailable');assert.equal(reads,0);
  env.elements.get('engraving-follow').checked=true;assert.equal(env.view.revealExpectedWrittenNotes('different-measure',1).status,'unavailable');assert.equal(reads,0,'A newer Rust occurrence cannot reveal a preceding frame\'s expected source measure');
  env.elements.get('engraving-follow').checked=true;assert.equal(env.view.revealExpectedWrittenNotes('occurrence-1').status,'ready');assert.equal(dock.scrollTop,272);assert.equal(scroller.scrollLeft,172);
  for(let frame=0;frame<40;frame++){env.view.setExpectedWrittenNotes(expected);env.view.revealExpectedWrittenNotes('occurrence-1')}assert.equal(reads,1,'Unchanged display frames must not read glyph geometry');
  renderGeneration++;env.view.revealExpectedWrittenNotes('occurrence-1');assert.equal(reads,2);env.view.revealExpectedWrittenNotes('repeat-2');assert.equal(reads,3);
  for(const invalidate of [()=>env.resizeObservers[0].callback(),()=>env.windowListeners.get('resize')[0](),()=>dock.listeners.get('toggle')({}),()=>env.view.resetReveal(),()=>env.view.surfaceChanged()]){dock.scrollTop=0;invalidate();assert.equal(env.view.revealExpectedWrittenNotes('repeat-2').status,'ready');assert.equal(dock.scrollTop,272)}assert.equal(reads,8,'Resize, layout details, explicit re-enable and surface changes refresh an otherwise unchanged identity');
  dock.scrollTop=0;boundsStatus='unavailable';env.view.resetReveal();assert.equal(env.view.revealExpectedWrittenNotes('repeat-2').status,'unavailable');assert.equal(dock.scrollTop,0,'Unverified rectangles are never scroll targets');
  boundsStatus='ready';throwBounds=true;env.view.resetReveal();assert.doesNotThrow(()=>env.view.revealExpectedWrittenNotes('repeat-2'));assert.equal(dock.scrollTop,0,'Optional geometry errors preserve the playback frame and pane');throwBounds=false;
  env.view.setExpectedWrittenNotes({sourceNoteIds:['unknown'],sourceMeasureIndex:0});env.view.setExpectedWrittenNotes(expected);assert.equal(env.view.revealExpectedWrittenNotes('repeat-2').status,'ready');assert.equal(dock.scrollTop,272);
  const readCount=reads;env.elements.get('engraving-follow').checked=false;env.view.revealExpectedWrittenNotes('repeat-3');assert.equal(reads,readCount);assert.equal(env.calls.length,1);assert.equal(env.pauses,0);assert.equal(JSON.stringify(score),before);
  assert.deepEqual(env.resizeObservers[0].observed,[dock]);for(const listener of env.windowListeners.get('pagehide'))listener();assert.deepEqual(env.resizeObservers[0].observed,[]);for(const listener of env.windowListeners.get('pageshow'))listener({persisted:true});assert.deepEqual(env.resizeObservers[0].observed,[dock]);
 }finally{env.close()}
});

test('completed original guitar staff reveals its current note before another idle frame without changing the paused take',async()=>{
 const score=structuredClone(fixture),original=JSON.stringify(score),expected={sourceNoteIds:['c4'],sourceMeasureIndex:0};
 const timeline={duration_ms:2000,notes:score.parts[0].notes.map((note,index)=>({id:note.id,source_note_ids:[note.id],part_id:'piano',start_ms:index*500,duration_ms:500}))};
 const navigation=new NotationNavigationIndex({version:1,source_measure_count:1,duration_ms:2000,diagnostics:[],occurrences:[{id:'original-first-measure',source_measure_index:0,measure_number:1,source_from:{numerator:0,denominator:1},source_to:{numerator:4,denominator:1},start_ms:0,end_ms:2000,repeat_region_index:null,repeat_pass:null,repeat_times:null,written_note_ids:['c4','e4'],continuing_note_ids:[]}],sounding_groups:timeline.notes.map(note=>({occurrence_id:note.id,source_note_ids:note.source_note_ids,part_id:note.part_id,start_ms:note.start_ms,end_ms:note.start_ms+note.duration_ms}))},score,timeline);
 const take=Object.freeze({position:0,running:false,inputs:Object.freeze([{midi:64,at:0}])}),before=JSON.stringify(take);
 let current=null,completions=0,renders=0,follow;
 const env=environment({onRenderComplete(){
  completions++;assert.equal(env.view.navigationState().ready,true,'The owned renderer is installed before notification');
  // The app first refreshes exact written IDs in display-only mode, then asks
  // the existing follower to reveal them. No idle tick or transport action runs.
  env.view.setExpectedWrittenNotes(expected);follow.viewportChanged();
 },loadAdapter:async()=>({disposeEngravedStaff(){},async renderEngravedStaff(){
  renders++;return{ok:true,metadata:{fromMeasure:1,toMeasure:1},dispose(){},mappingStatus:()=>({status:'ready',verifiedGlyphCount:2,diagnostics:[]}),setExpectedWrittenNotes(value){current=value;return true},clearExpectedWrittenNotes(){current=null;return true},expectedNoteBounds(){return{status:current?'ready':'unavailable',rects:current?[{left:639.55,right:651.57,top:436.67-dock.scrollTop,bottom:447.14-dock.scrollTop}]:[]}}};
 }})});
 const dock=document.getElementById('notation-dock'),status=document.getElementById('engraving-follow-status');status.setAttribute=()=>{};
 const scroller={clientLeft:0,clientWidth:372,scrollLeft:0,scrollTop:0,scrollWidth:372,getBoundingClientRect:()=>({left:452.52,right:824.52,top:326.39-dock.scrollTop,bottom:862.89-dock.scrollTop})};
 Object.assign(dock,{clientTop:1,clientLeft:1,clientHeight:348,clientWidth:388,scrollTop:0,scrollLeft:0,scrollHeight:920,getBoundingClientRect:()=>({left:443.52,right:834,top:38,bottom:388}),querySelector:()=>({getBoundingClientRect:()=>({height:61.39})}),scrollTo(value){this.scrollTop=value.top;this.scrollLeft=value.left;}});
 env.elements.get('engraved-staff').closest=()=>scroller;
 try{
  env.setScore(score);
  follow=setupNotationFollowing({getContext:()=>({score,timeline}),getPlayback:()=>take,prepareNavigation:async()=>navigation,view:{isActive:()=>true,navigationState:env.view.navigationState,followMeasure:env.view.followMeasure,revealExpectedWrittenNotes:env.view.revealExpectedWrittenNotes,resetReveal:env.view.resetReveal}});
  await follow.prepare();assert.equal(completions,0);assert.equal(dock.scrollTop,0,'The retained failure geometry starts with every note below the pane');
  env.calls[0].resolve({ok:true,json:async()=>({xml:'<score-partwise/>',part_id_map:{piano:'P1'},diagnostics:[]})});await new Promise(resolve=>setImmediate(resolve));
  assert.equal(completions,1);assert.equal(renders,1);assert.equal(env.calls.length,1);assert.ok(dock.scrollTop>60);
  assert.ok(436.67-dock.scrollTop>=100.39&&447.14-dock.scrollTop<=387,'The complete real-sized head fits under Follow and above the dock clip');
  assert.deepEqual(current,expected);assert.equal(JSON.stringify(take),before);assert.equal(JSON.stringify(score),original);assert.equal(env.pauses,0);
  const settled=dock.scrollTop;for(let frame=0;frame<10;frame++)follow.tick(take.position,take.running);
  assert.equal(completions,1);assert.equal(renders,1);assert.equal(env.calls.length,1);assert.equal(dock.scrollTop,settled,'Notification does not start a render/reveal loop');
  follow.suspend();dock.scrollTop=0;env.view.hide();env.view.show();await new Promise(resolve=>setImmediate(resolve));
  assert.equal(completions,2);assert.equal(dock.scrollTop,0,'Manual scrolling remains authoritative after another completed render');
 }finally{env.close()}
});

test('a superseded or hidden renderer completion cannot notify the current score',async()=>{
 for(const invalidate of ['replace','hide']){
  const gate=deferred();let completions=0,disposed=0;
  const env=environment({onRenderComplete(){completions++},loadAdapter:async()=>({disposeEngravedStaff(){},async renderEngravedStaff(){await gate.promise;return{ok:true,metadata:{fromMeasure:1,toMeasure:1},dispose(){disposed++}}}})});
  try{
   env.setScore();env.calls[0].resolve({ok:true,json:async()=>({xml:'<score-partwise/>',part_id_map:{piano:'P1'},diagnostics:[]})});await new Promise(resolve=>setImmediate(resolve));
   if(invalidate==='hide')env.view.hide();else env.setScore({...structuredClone(fixture),id:'new-original-score'});
   gate.resolve();await new Promise(resolve=>setImmediate(resolve));
   assert.equal(completions,0,`${invalidate} invalidates notification as well as paint`);assert.equal(disposed,1);
  }finally{gate.resolve();env.close()}
 }
});

test('renderer completion waits outside the audio ACK window and keeps readiness pending until admitted',async()=>{
 const entered=deferred(),finish=deferred(),gate=notationAudioAdmission(globalThis),events=[];let audioLease=null,completions=0;
 const env=environment({onRenderComplete(){completions++;events.push('completed paint');assert.equal(audioLease,null);const lease=gate.tryVisual();assert.ok(lease);lease.release();},loadAdapter:async()=>({disposeEngravedStaff(){},async renderEngravedStaff(){
  const lease=gate.tryVisual();assert.ok(lease);entered.resolve();try{await finish.promise;return{ok:true,metadata:{fromMeasure:1,toMeasure:1},dispose(){}}}finally{lease.release()}
 }})});
 try{
  env.setScore();env.calls[0].resolve({ok:true,json:async()=>({xml:'<score-partwise/>',part_id_map:{piano:'P1'},diagnostics:[]})});await entered.promise;
  const admitted=gate.acquireAudio().then(lease=>{audioLease=lease;events.push('audio admitted');return lease});finish.resolve();await admitted;await new Promise(resolve=>setImmediate(resolve));
  assert.deepEqual(events,['audio admitted']);assert.equal(completions,0);assert.equal(env.view.navigationState().ready,false);assert.match(env.elements.get('engraving-status').textContent,/Preparing exact MusicXML/);
  const owned=audioLease;audioLease=null;owned.release();await new Promise(resolve=>setImmediate(resolve));
  assert.deepEqual(events,['audio admitted','completed paint']);assert.equal(completions,1);assert.equal(env.view.navigationState().ready,true);assert.match(env.elements.get('engraving-status').textContent,/Generated staff preview/);
 }finally{audioLease?.release();finish.resolve();env.close()}
});

test('queued completion rechecks source, generation and visibility after audio releases its lease',async()=>{
 for(const invalidate of ['replace','hide','visibility']){
  const gate=notationAudioAdmission(globalThis),entered=deferred(),finish=deferred();let completions=0,shown=true,audioLease;
  const env=environment({isVisible:()=>shown,onRenderComplete(){completions++},loadAdapter:async()=>({disposeEngravedStaff(){},async renderEngravedStaff(){const lease=gate.tryVisual();assert.ok(lease);entered.resolve();try{await finish.promise;return{ok:true,metadata:{fromMeasure:1,toMeasure:1},dispose(){}}}finally{lease.release()}}})});
  try{
   env.setScore();env.calls[0].resolve({ok:true,json:async()=>({xml:'<score-partwise/>',part_id_map:{piano:'P1'},diagnostics:[]})});await entered.promise;
   const admitted=gate.acquireAudio();finish.resolve();audioLease=await admitted;await new Promise(resolve=>setImmediate(resolve));
   if(invalidate==='replace')env.setScore({...structuredClone(fixture),id:'replacement-original'});else if(invalidate==='hide')env.view.hide();else shown=false;
   audioLease.release();audioLease=null;await new Promise(resolve=>setImmediate(resolve));assert.equal(completions,0,invalidate);assert.doesNotMatch(env.elements.get('engraving-status').textContent,/Generated staff preview/);
  }finally{audioLease?.release();finish.resolve();env.close()}
 }
});

test('optional completion failure retains valid staff and releases visual ownership',async()=>{
 const gate=notationAudioAdmission(globalThis);let completions=0;
 const env=environment({onRenderComplete(){completions++;throw Error('Optional reveal failed')},loadAdapter:async()=>({disposeEngravedStaff(){},async renderEngravedStaff(){return{ok:true,metadata:{fromMeasure:1,toMeasure:1},dispose(){}}}})});
 try{
  env.setScore();env.calls[0].resolve({ok:true,json:async()=>({xml:'<score-partwise/>',part_id_map:{piano:'P1'},diagnostics:[]})});await new Promise(resolve=>setImmediate(resolve));
  assert.equal(completions,1);assert.deepEqual(env.failures,[]);assert.equal(env.view.isActive(),true);assert.equal(env.view.navigationState().ready,true);assert.match(env.elements.get('engraving-status').textContent,/Generated staff preview/);
  const audio=await gate.acquireAudio();audio.release();await env.view.refreshCompletedPaint();assert.equal(completions,2);assert.deepEqual(env.failures,[]);
 }finally{env.close()}
});

test('completion requesting a later source page cannot clear that successor render pending state',async()=>{
 const successor=deferred();let completions=0,renders=0;const env=environment({onRenderComplete(){if(++completions===1)env.view.followMeasure(8)},loadAdapter:async()=>({disposeEngravedStaff(){},async renderEngravedStaff(_container,_xml,options){if(++renders===2)await successor.promise;return{ok:true,metadata:{fromMeasure:options.fromMeasure,toMeasure:options.toMeasure},dispose(){}}}})});
 try{
  const score=structuredClone(fixture);score.measures=Array.from({length:12},(_,index)=>({number:index+1,at:{numerator:index*4,denominator:1},length:{numerator:4,denominator:1}}));env.setScore(score);
  env.calls[0].resolve({ok:true,json:async()=>({xml:'<score-partwise/>',part_id_map:{piano:'P1'},diagnostics:[]})});await new Promise(resolve=>setImmediate(resolve));
  assert.equal(completions,1);assert.equal(renders,2);assert.equal(env.calls.length,1);assert.equal(env.view.navigationState().from,9);assert.equal(env.view.navigationState().ready,false);assert.match(env.elements.get('engraving-status').textContent,/Preparing exact MusicXML/);
  successor.resolve();await new Promise(resolve=>setImmediate(resolve));assert.equal(completions,2);assert.equal(env.calls.length,1);assert.equal(env.view.navigationState().ready,true);
 }finally{successor.resolve();env.close()}
});

for(const navigationFirst of [true,false])test(`cold original guitar reveals without an idle frame when navigation finishes ${navigationFirst?'before':'after'} paint`,async()=>{
 const score=structuredClone(fixture),timeline={duration_ms:2000,notes:score.parts[0].notes.map((note,index)=>({id:note.id,source_note_ids:[note.id],part_id:'piano',start_ms:index*500,duration_ms:500}))};
 const response={version:1,source_measure_count:1,duration_ms:2000,diagnostics:[],occurrences:[{id:'original-first-measure',source_measure_index:0,measure_number:1,source_from:{numerator:0,denominator:1},source_to:{numerator:4,denominator:1},start_ms:0,end_ms:2000,repeat_region_index:null,repeat_pass:null,repeat_times:null,written_note_ids:['c4','e4'],continuing_note_ids:[]}],sounding_groups:timeline.notes.map(note=>({occurrence_id:note.id,source_note_ids:note.source_note_ids,part_id:note.part_id,start_ms:note.start_ms,end_ms:note.start_ms+note.duration_ms})),written_cursor:{version:1,source_note_ids:['c4','e4'],spans:[{source_note_index:0,measure_occurrence_index:0,start_ms:0,end_ms:500},{source_note_index:1,measure_occurrence_index:0,start_ms:500,end_ms:1000}]}};
 const navigation=deferred(),gate=notationAudioAdmission(globalThis),playback=Object.freeze({position:0,running:false}),original=JSON.stringify({score,timeline,playback});let current=null,completions=0,requests=0,follow,cursor,refresh,audioLease,audioRequest;
 const env=environment({onRenderComplete(){
  completions++;const written=cursor.at(playback.position);
  if(written?.occurrence)env.view.setExpectedWrittenNotes({sourceNoteIds:written.entries.map(entry=>entry.sourceNoteId),sourceMeasureIndex:written.occurrence.source_measure_index});else env.view.clearExpectedWrittenNotes();
  follow.viewportChanged();
 },loadAdapter:async()=>({disposeEngravedStaff(){},async renderEngravedStaff(){return{ok:true,metadata:{fromMeasure:1,toMeasure:1},dispose(){},mappingStatus:()=>({status:'ready',verifiedGlyphCount:2,diagnostics:[]}),setExpectedWrittenNotes(value){current=value;return true},clearExpectedWrittenNotes(){current=null;return true},expectedNoteBounds(){return{status:current?'ready':'unavailable',rects:current?[{left:639.55,right:651.57,top:436.67-dock.scrollTop,bottom:447.14-dock.scrollTop}]:[]}}}}})});
 const dock=document.getElementById('notation-dock'),status=document.getElementById('engraving-follow-status');status.setAttribute=()=>{};
 const scroller={clientLeft:0,clientWidth:372,scrollLeft:0,scrollTop:0,scrollWidth:372,getBoundingClientRect:()=>({left:452.52,right:824.52,top:326.39-dock.scrollTop,bottom:862.89-dock.scrollTop})};
 Object.assign(dock,{clientTop:1,clientLeft:1,clientHeight:348,clientWidth:388,scrollTop:0,scrollLeft:0,scrollHeight:920,getBoundingClientRect:()=>({left:443.52,right:834,top:38,bottom:388}),querySelector:()=>({getBoundingClientRect:()=>({height:61.39})}),scrollTo(value){this.scrollTop=value.top;this.scrollLeft=value.left;}});env.elements.get('engraved-staff').closest=()=>scroller;
 cursor=setupWrittenCursor({getContext:()=>({score,timeline}),api:async()=>{requests++;return navigation.promise},onStatus({status}){if(status==='ready'){if(!navigationFirst)audioRequest=gate.acquireAudio().then(lease=>{audioLease=lease});refresh=Promise.resolve().then(()=>follow.prepare()).then(()=>env.view.refreshCompletedPaint());}}});
 follow=setupNotationFollowing({getContext:()=>({score,timeline}),getPlayback:()=>({...playback,written:cursor.at(playback.position)}),prepareNavigation:async options=>{await cursor.prepare(options);return cursor.navigation()},view:{isActive:()=>true,navigationState:env.view.navigationState,followMeasure:env.view.followMeasure,revealExpectedWrittenNotes:env.view.revealExpectedWrittenNotes,resetReveal:env.view.resetReveal}});
 try{
  env.setScore(score);const cursorReady=cursor.prepare(),followReady=follow.prepare();assert.equal(requests,1);
  if(navigationFirst){navigation.resolve(response);await cursorReady;await followReady;assert.equal(await refresh,false);assert.equal(current,null);}
  env.calls[0].resolve({ok:true,json:async()=>({xml:'<score-partwise/>',part_id_map:{piano:'P1'},diagnostics:[]})});await new Promise(resolve=>setImmediate(resolve));
  if(!navigationFirst){
   assert.equal(current,null);assert.equal(dock.scrollTop,0);assert.equal(cursor.state().status,'loading');assert.match(status.textContent,/准备乐谱跟随|Preparing score following/);
   navigation.resolve(response);await cursorReady;await followReady;await audioRequest;
   assert.equal(cursor.state().status,'ready');assert.equal(current,null);assert.equal(dock.scrollTop,0);assert.equal(completions,1,'Late navigation refresh cannot enter the audio ACK window');
   audioLease.release();audioLease=null;assert.equal(await refresh,true);
  }
  assert.deepEqual(current,{sourceNoteIds:['c4'],sourceMeasureIndex:0});assert.ok(dock.scrollTop>60);assert.equal(requests,1);assert.equal(env.calls.length,1);assert.equal(completions,navigationFirst?1:2);assert.equal(JSON.stringify({score,timeline,playback}),original);assert.equal(env.pauses,0);
 }finally{audioLease?.release();navigation.resolve(response);follow.suspend();cursor.reset();env.close()}
});

test('paused original grand-staff following reveals and reports a compact viewport before another playback frame',async()=>{
 const score=originalAboveKeyboardScore(),original=JSON.stringify(score),measure=8,ids=['band-8-1','band-8-2'];
 const timeline={duration_ms:12000,notes:score.parts[0].notes.map(note=>({id:note.id,source_note_ids:[note.id],part_id:score.parts[0].id,start_ms:note.at.numerator*250,duration_ms:1000}))};
 const navigation=new NotationNavigationIndex({version:1,source_measure_count:12,duration_ms:12000,diagnostics:[],
  occurrences:score.measures.map((item,index)=>({id:`original-${index}`,source_measure_index:index,measure_number:item.number,source_from:item.at,source_to:{numerator:(index+1)*4,denominator:1},start_ms:index*1000,end_ms:(index+1)*1000,repeat_region_index:null,repeat_pass:null,repeat_times:null,written_note_ids:[`band-${index}-1`,`band-${index}-2`],continuing_note_ids:[]})),
  sounding_groups:timeline.notes.map(note=>({occurrence_id:note.id,source_note_ids:note.source_note_ids,part_id:note.part_id,start_ms:note.start_ms,end_ms:note.start_ms+note.duration_ms}))},score,timeline);
 const playback=Object.freeze({position:8250,running:false}),expected={sourceNoteIds:ids,sourceMeasureIndex:measure};
 let current=null,reads=0,renders=0,clockReads=0,height=300,headTop=110;
 const env=environment({loadAdapter:async()=>({disposeEngravedStaff(){},async renderEngravedStaff(_container,_xml,options){
  renders++;return{ok:true,metadata:{fromMeasure:options.fromMeasure,toMeasure:options.toMeasure},dispose(){},mappingStatus:()=>({status:'ready',verifiedGlyphCount:2,diagnostics:[]}),setExpectedWrittenNotes(value){current=value;return true},clearExpectedWrittenNotes(){current=null;return true},expectedNoteBounds(){
   reads++;return{status:current?'ready':'unavailable',rects:(current?.sourceNoteIds||[]).map((id,index)=>({sourceNoteId:id,xmlNoteId:id,left:120,right:136,top:90+headTop+index*145-overlay.scrollTop,bottom:106+headTop+index*145-overlay.scrollTop}))};
  }};
 }})});
 const dock=document.getElementById('notation-dock'),overlay=document.getElementById('notation-lane-overlay'),status=document.getElementById('engraving-follow-status');
 status.setAttribute=()=>{};dock.ownerDocument=document;
 Object.assign(overlay,{hidden:false,clientTop:0,clientLeft:0,clientWidth:1000,scrollTop:0,scrollLeft:0,scrollHeight:500,getBoundingClientRect:()=>({top:90,left:10,width:1000,height}),scrollTo({top,left}){this.scrollTop=top;this.scrollLeft=left}});
 Object.defineProperty(overlay,'clientHeight',{get:()=>height});
 const scroller={clientTop:0,clientLeft:0,clientWidth:968,scrollLeft:0,scrollTop:0,scrollWidth:968,getBoundingClientRect:()=>({left:26,width:968}),scrollTo({left}){this.scrollLeft=left}};
 env.elements.get('engraved-staff').closest=()=>scroller;
 const follow=setupNotationFollowing({document,i18n:createI18n({locale:'zh-CN'}),getContext:()=>({score,timeline}),getPlayback:()=>{clockReads++;return playback},prepareNavigation:async()=>navigation,view:env.view});
 try{
  env.setScore(score);env.view.followMeasure(measure);env.view.setExpectedWrittenNotes(expected);
  env.calls.at(-1).resolve({ok:true,json:async()=>({xml:'<score-partwise/>',part_id_map:{piano:'P1'},diagnostics:[]})});await new Promise(resolve=>setImmediate(resolve));
  await follow.prepare();assert.match(status.textContent,/已暂停于谱面第 9 小节/);assert.doesNotMatch(status.textContent,/部分预期音符/);
  assert.equal(reads,1);height=130;overlay.scrollTop=135;
  follow.viewportChanged();
  assert.match(status.textContent,/部分预期音符/,'Paused resize must publish partial visibility without waiting for the idle transport frame');
  assert.equal(reads,2);assert.equal(overlay.scrollTop,98,'Reveal the exact upper voice that was clipped by the inherited scroll position');
  assert.equal(env.view.revealExpectedWrittenNotes('original-8',measure).status,'partial');assert.equal(reads,2,'A stable playback frame reuses the freshly measured partial result');
  follow.tick(playback.position,false);assert.match(status.textContent,/部分预期音符/,'An ordinary paused tick cannot overwrite the limitation with stale ready status');
  height=300;follow.viewportChanged();assert.doesNotMatch(status.textContent,/部分预期音符/,'Only a genuinely fitting viewport clears the warning');
  env.view.hide();env.view.show();env.view.setExpectedWrittenNotes(expected);height=130;headTop=40;overlay.scrollTop=135;
  await new Promise(resolve=>setImmediate(resolve));follow.viewportChanged();
  assert.equal(renders,2,'Switching back mounts fresh staff glyphs');assert.match(status.textContent,/部分预期音符/);assert.equal(overlay.scrollTop,28);assert.deepEqual(current,expected);
  follow.suspend();const before=clockReads;follow.viewportChanged();assert.equal(clockReads,before,'Manual following stays suspended across subsequent fit notifications');
  assert.equal(env.pauses,0);assert.deepEqual(playback,{position:8250,running:false});assert.equal(JSON.stringify(score),original);assert.equal(env.view.navigationState().from,9);
 }finally{follow.suspend();env.close();}
});

test('intentional notation scrolling suspends optional follow without preventing native input',()=>{
 let manual=0;const env=environment({onManualNavigation(){manual++;env.elements.get('engraving-follow').checked=false}}),dock=env.elements.get('notation-dock'),checkbox=document.getElementById('engraving-follow');
 try{
  for(const[type,event]of[['wheel',{}],['touchmove',{}],['pointerdown',{target:dock}],['keydown',{key:'PageDown',target:dock}]]){checkbox.checked=true;dock.listeners.get(type)(event);assert.equal(checkbox.checked,false)}
  assert.equal(manual,4);checkbox.checked=true;dock.listeners.get('keydown')({key:' ',target:{closest:()=>({})}});assert.equal(checkbox.checked,true,'Space on controls keeps its normal control action');dock.listeners.get('keydown')({key:'a',target:dock});assert.equal(checkbox.checked,true,'Piano letters are not scroll shortcuts');
  for(const event of [{key:'Home',target:{isContentEditable:true}},{key:'Home',ctrlKey:true,target:dock},{key:'PageDown',defaultPrevented:true,target:dock}]){dock.listeners.get('keydown')(event);assert.equal(checkbox.checked,true,'Handled and editing keys do not suspend follow')}
  checkbox.checked=false;dock.listeners.get('wheel')({});assert.equal(manual,4);
 }finally{env.close()}
});


test('manual engraved pages survive switching away and back without pausing playback',()=>{
 const env=environment();try{
  const score=structuredClone(fixture);score.measures=Array.from({length:20},(_,index)=>({number:index+1,at:{numerator:index*4,denominator:1},length:{numerator:4,denominator:1}}));
  env.setScore(score);env.elements.get('engraving-next').listeners.get('click')();assert.equal(env.view.navigationState().from,9);
  env.view.hide({remember:true});env.view.show();assert.equal(env.view.navigationState().from,9);assert.equal(env.pauses,0);
 }finally{env.close()}
});


test('basic-key pages bind saved identity and keep an explicit missing-meter choice without a legacy export request',async()=>{
 const open=JSON.parse(readFileSync(new URL('./fixtures/basic-keys-native-open.json',import.meta.url),'utf8')),data=JSON.parse(readFileSync(new URL('./fixtures/basic-keys-notation-page.json',import.meta.url),'utf8'));
 const song=prepareCleanSong(`native:song-${open.clean_package.content_sha256}`,open.clean_package,null),renders=[];
 const env=environment({getCleanSong:()=>song,loadAdapter:async()=>({disposeEngravedStaff(){},async renderEngravedStaff(_container,_xml,options){renders.push(options);return{ok:true,metadata:{fromMeasure:1,toMeasure:1},dispose(){}};}})});
 try{
  env.setScore(song.notation);assert.equal(env.calls[0].path,'/api/library/basic-keys/notation');const initial=JSON.parse(env.calls[0].options.body);assert.equal(initial.settings.display_meter,null);assert.equal(JSON.stringify(initial).includes('notes'),false);assert.ok(Buffer.byteLength(env.calls[0].options.body)<1024);
  env.calls[0].resolve({ok:true,json:async()=>data.missing});await new Promise(resolve=>setImmediate(resolve));
  assert.equal(renders.length,0);assert.equal(env.view.isActive(),true);assert.match(env.elements.get('engraving-status').textContent,/no unambiguous opening meter/);assert.equal(env.elements.get('export-musicxml').disabled,true);
  env.elements.get('engraving-basic-meter').value='4/4';env.elements.get('engraving-basic-meter').listeners.get('change')();assert.equal(env.calls.length,2);assert.deepEqual(JSON.parse(env.calls[1].options.body),data.request);
  env.calls[1].resolve({ok:true,json:async()=>data.ready});await new Promise(resolve=>setImmediate(resolve));
  assert.equal(renders.length,1);assert.equal(renders[0].identity.score.parts.length,1);assert.deepEqual(song.notation.measures,[]);assert.match(env.elements.get('engraving-basic-provenance').textContent,/explicit view choice/);assert.match(env.elements.get('engraving-basic-provenance').textContent,/SMF default/);assert.equal(env.elements.get('engraving-basic-attack-list').children.length,2);
  assert.deepEqual(env.failures,[]);assert.ok(env.calls.every(call=>call.path==='/api/library/basic-keys/notation'));
 }finally{env.close();}
});

test('basic-key follow uses original source clock pages for leading silence, late tempo, boundary ties, seek and restart',async()=>{
 const data=JSON.parse(readFileSync(new URL('./fixtures/basic-keys-notation-follow.json',import.meta.url),'utf8')),open=data.open;
 const song=prepareCleanSong(`native:song-${open.clean_package.content_sha256}`,open.clean_package,null),rendered=[],expected=[];
 const env=environment({getCleanSong:()=>song,loadAdapter:async()=>({disposeEngravedStaff(){},async renderEngravedStaff(_container,_xml,options){rendered.push(options);return{ok:true,metadata:{fromMeasure:1,toMeasure:1},dispose(){},mappingStatus:()=>({status:'ready',diagnostics:[]}),setExpectedWrittenNotes:value=>{expected.push(value);return true;},clearExpectedWrittenNotes:()=>true};}})});
 try{
  env.setScore(song.notation);env.elements.get('engraving-page-size').value='1';env.elements.get('engraving-page-size').listeners.get('change')();assert.equal(env.calls[0].options.signal.aborted,true);
  env.calls[1].resolve({ok:true,json:async()=>data.pages[0].response});await new Promise(resolve=>setImmediate(resolve));
  assert.equal(env.view.followPosition(0).status,'ready');assert.equal(env.calls.length,2);assert.deepEqual(basicKeyWrittenAt(song,env.view.basicPage(),100,[]).entries,[],'Leading silence belongs to the first source-clock page');
  const first=song.compilation.timeline.notes[0];assert.equal(first.start_ms,500);assert.equal(basicKeyWrittenAt(song,env.view.basicPage(),500,[first]).entries[0].sourceNoteId,first.id);
  for(const item of data.pages.slice(1)){
   const position=item.request.settings.position_ms;assert.equal(env.view.followPosition(position).status,'pending');const call=env.calls.at(-1),request=JSON.parse(call.options.body);assert.equal(request.settings.position_ms,position);assert.ok(Buffer.byteLength(call.options.body)<1024);call.resolve({ok:true,json:async()=>item.response});await new Promise(resolve=>setImmediate(resolve));
   const followed=env.view.followPosition(position);assert.equal(followed.status,'ready');assert.equal(followed.measure.source_measure_index,item.response.page.first_measure);assert.equal(env.view.navigationState().from,item.response.page.first_measure+1);assert.equal(rendered.at(-1).fromMeasure,1);assert.equal(rendered.at(-1).identity.score.parts[0].notes[0].id,first.id);assert.equal(env.view.setExpectedWrittenNotes({sourceNoteIds:[first.id],sourceMeasureIndex:item.response.page.first_measure}),true);assert.deepEqual(expected.at(-1),{sourceNoteIds:[first.id],sourceMeasureIndex:0});
  }
  assert.equal(env.view.followPosition(10000).status,'pending','An explicit seek to the source end loads the final page');const ending=structuredClone(data.pages[2].response);ending.page.resolved_position_ms=10000;env.calls.at(-1).resolve({ok:true,json:async()=>ending});await new Promise(resolve=>setImmediate(resolve));assert.equal(env.view.followPosition(10000).status,'end');assert.equal(env.view.navigationState().from,3);
  assert.equal(env.view.followPosition(0).status,'pending','Restart returns to the first source page');const restarting=structuredClone(data.pages[0].response);env.calls.at(-1).resolve({ok:true,json:async()=>restarting});await new Promise(resolve=>setImmediate(resolve));assert.equal(env.view.followPosition(0).status,'ready');assert.deepEqual(song.notation.measures,[]);assert.deepEqual(env.failures,[]);
 }finally{env.close();}
});


test('a declared first meter after beat zero gets an explicit initial grid without overriding a later Source choice',async()=>{
 const data=JSON.parse(readFileSync(new URL('./fixtures/basic-key-late-initial-meter.json',import.meta.url),'utf8')),descriptor=data.open.clean_package,song=prepareCleanSong(`native:song-${descriptor.content_sha256}`,descriptor,null),before=song.score_json;
 const env=environment({getCleanSong:()=>song,getPracticePart:()=>song.notation.parts[0].id,getMode:()=> 'practice',loadAdapter:async()=>({disposeEngravedStaff(){},renderEngravedStaff:async()=>({ok:true,metadata:{fromMeasure:1,toMeasure:2},dispose(){}})})});
 try{env.setScore(song.notation);assert.equal(song.score.performance.timing.meter,'source_declared');assert.deepEqual(song.notation.meters[0].at,{numerator:1,denominator:48});assert.equal(env.elements.get('engraving-basic-meter').value,'4/4');assert.deepEqual(JSON.parse(env.calls[0].options.body).settings.display_meter,{numerator:4,denominator:4});env.calls[0].resolve({ok:true,json:async()=>data.chosen.response});await new Promise(resolve=>setImmediate(resolve));assert.equal(env.view.basicPage().status,'ready');assert.equal(env.view.basicPage().meter_origin,'source_with_chosen_initial_meter');env.elements.get('engraving-basic-meter').value='source';env.elements.get('engraving-basic-meter').listeners.get('change')();assert.equal(JSON.parse(env.calls.at(-1).options.body).settings.display_meter,null);env.calls.at(-1).resolve({ok:true,json:async()=>data.missing.response});await new Promise(resolve=>setImmediate(resolve));assert.equal(env.elements.get('engraving-basic-meter').value,'source');assert.equal(env.view.basicPage().status,'display_meter_required');assert.equal(song.score_json,before);}finally{env.close();}
});

test('bounded rendition prefetch retains current paint while waiting and never paints a stale fast page',async()=>{
 const data=JSON.parse(readFileSync(new URL('./fixtures/basic-key-rendition-notation-tail.json',import.meta.url),'utf8')),descriptor=data.open.clean_package,song=prepareCleanSong(`native:song-${descriptor.content_sha256}`,descriptor,null),painted=[];let disposed=0;
 const env=environment({getCleanSong:()=>song,getPracticePart:()=>song.notation.parts[0].id,getMode:()=> 'practice',loadAdapter:async()=>({disposeEngravedStaff(){},async renderEngravedStaff(_container,_xml,options,signal){painted.push(options.identity.score.measures[0].number);let released=false;const result={ok:true,metadata:{fromMeasure:1,toMeasure:1},dispose(){if(released)return;released=true;signal.removeEventListener('abort',result.dispose);disposed++;},mappingStatus:()=>({status:'ready',diagnostics:[]}),setExpectedWrittenNotes:()=>true,clearExpectedWrittenNotes:()=>true};signal.addEventListener('abort',result.dispose,{once:true});return result;}})});
 try{env.setScore(song.notation);env.elements.get('engraving-page-size').value='1';env.elements.get('engraving-page-size').listeners.get('change')();env.calls[1].resolve({ok:true,json:async()=>data.pages[0].response});await new Promise(resolve=>setImmediate(resolve));assert.equal(env.calls.length,3);assert.equal(JSON.parse(env.calls[2].options.body).settings.first_measure,1);assert.equal(JSON.parse(env.calls[2].options.body).settings.position_ms,undefined);assert.equal(env.view.followPosition(5).status,'pending');assert.equal(disposed,0,'Current paint remains while the next native batch waits');assert.equal(env.view.followPosition(33).status,'pending');env.calls[2].resolve({ok:true,json:async()=>data.pages[1].response});await new Promise(resolve=>setImmediate(resolve));assert.equal(env.calls.length,4);assert.equal(JSON.parse(env.calls[3].options.body).settings.position_ms,33);assert.deepEqual(painted,[1],'A delayed middle page is never mounted as current');assert.equal(disposed,0);env.calls[3].resolve({ok:true,json:async()=>data.tail.response});await new Promise(resolve=>setImmediate(resolve));assert.equal(env.view.followPosition(33).status,'ready');assert.equal(env.view.basicPage().first_measure,3);assert.equal(env.view.basicPage().follow_end_ms,34);assert.deepEqual(painted,[1]);assert.equal(env.elements.get('basic-rendition-events-list').children.length,2,'The terminal marker-only page never enters the pitched renderer');assert.equal(disposed,1);assert.equal(env.calls.length,4,'At most one next batch is prefetched');}finally{env.close();}
});

test('eight quiet native measures keep their clock and automatically reach the ninth-measure target',async()=>{
 const data=JSON.parse(readFileSync(new URL('./fixtures/basic-key-quiet-window.json',import.meta.url),'utf8')),descriptor=data.open.clean_package,song=prepareCleanSong(`native:song-${descriptor.content_sha256}`,descriptor,null),painted=[];
 const env=environment({getCleanSong:()=>song,getPracticePart:()=>song.notation.parts[0].id,getMode:()=> 'practice',loadAdapter:async()=>({disposeEngravedStaff(){},async renderEngravedStaff(_container,_xml,options){painted.push(options.identity.score.parts[0].notes.map(note=>note.id));return{ok:true,metadata:{fromMeasure:1,toMeasure:1},dispose(){}};}})});
 try{env.setScore(song.notation);env.calls[0].resolve({ok:true,json:async()=>data.first.response});await new Promise(resolve=>setImmediate(resolve));assert.deepEqual(painted,[],'The empty written window does not enter OSMD');assert.equal(env.view.followPosition(1000).status,'ready');assert.equal(env.view.followPosition(15999).status,'ready');assert.equal(env.view.basicPage().source_end_ms,16000);assert.equal(env.calls.length,2,'The next real source window is prefetched immediately');assert.equal(JSON.parse(env.calls[1].options.body).settings.first_measure,8);assert.equal(env.view.followPosition(16001).status,'pending');env.calls[1].resolve({ok:true,json:async()=>data.next.response});await new Promise(resolve=>setImmediate(resolve));assert.equal(env.view.followPosition(16001).status,'ready');assert.deepEqual(painted,[['midi-t1-e2']]);assert.equal(env.view.basicPage().first_measure,8);assert.equal(env.calls.length,2);assert.equal(env.pauses,0);}finally{env.close();}
});

test('hiding a loaded native view cancels its next page and rejects the late response before return',async()=>{
 const data=JSON.parse(readFileSync(new URL('./fixtures/basic-key-quiet-window.json',import.meta.url),'utf8')),descriptor=data.open.clean_package,song=prepareCleanSong(`native:song-${descriptor.content_sha256}`,descriptor,null);let visible=true;
 const env=environment({getCleanSong:()=>song,getPracticePart:()=>song.notation.parts[0].id,getMode:()=> 'practice',isVisible:()=>visible});
 try{env.setScore(song.notation);env.calls[0].resolve({ok:true,json:async()=>data.first.response});await new Promise(resolve=>setImmediate(resolve));const old=env.calls[1];assert.equal(old.options.signal.aborted,false);visible=false;env.view.surfaceChanged();assert.equal(old.options.signal.aborted,true);old.resolve({ok:true,json:async()=>data.next.response});await new Promise(resolve=>setImmediate(resolve));assert.equal(env.view.basicPage().first_measure,0);assert.equal(env.calls.length,2);visible=true;env.view.surfaceChanged();await new Promise(resolve=>setImmediate(resolve));assert.equal(env.calls.length,3);assert.equal(JSON.parse(env.calls[2].options.body).settings.first_measure,8);assert.equal(env.view.basicPage().first_measure,0);assert.equal(env.pauses,0);}finally{env.close();}
});

test('All staff mounts keep independent native identities and send each renderer only its own shared-clock IDs',async()=>{
 const data=JSON.parse(readFileSync(new URL('./fixtures/basic-key-rendition-notation-page.json',import.meta.url),'utf8')),third=JSON.parse(readFileSync(new URL('./fixtures/basic-key-rendition-third-part.json',import.meta.url),'utf8')),descriptor=data.open.clean_package,song=prepareCleanSong(`native:song-${descriptor.content_sha256}`,descriptor,null),identities=[],received=new Map();
 const env=environment({getCleanSong:()=>song,getMode:()=> 'listen',loadAdapter:async()=>({disposeEngravedStaff(){},async renderEngravedStaff(_container,_xml,{identity,cooperative}){assert.equal(cooperative,true);identities.push(identity);const id=identity.score.parts[0].id;received.set(id,[]);return{ok:true,metadata:{fromMeasure:1,toMeasure:1},dispose(){},mappingStatus:()=>({status:'ready',verifiedGlyphCount:identity.score.parts[0].notes.length,diagnostics:[]}),setExpectedWrittenNotes:value=>{received.get(id).push(value);return true;},clearExpectedWrittenNotes:()=>true};}})});
 try{env.setScore(song.notation);assert.equal(env.calls.length,3);for(const call of env.calls){const id=JSON.parse(call.options.body).settings.part_id;call.resolve({ok:true,json:async()=>id===song.notation.parts[0].id?data.melodic.response:id===song.notation.parts[1].id?data.percussion.response:third.response});}await new Promise(resolve=>setImmediate(resolve));assert.deepEqual(identities.map(identity=>identity.score.parts.map(part=>part.id)),[[song.notation.parts[0].id],[song.notation.parts[2].id]]);assert.equal(env.elements.get('engraved-staff').children.length,3);assert.equal(env.view.setExpectedWrittenNotes({sourceNoteIds:['midi-t1-e8','midi-t2-e1','midi-t3-e1'],sourceMeasureIndex:0}),true);assert.deepEqual(received.get(song.notation.parts[0].id).at(-1),{sourceNoteIds:['midi-t1-e8'],sourceMeasureIndex:0});assert.deepEqual(received.get(song.notation.parts[2].id).at(-1),{sourceNoteIds:['midi-t3-e1'],sourceMeasureIndex:0});const written=basicKeyWrittenAt(song,env.view.basicPages(),500,song.compilation.timeline.notes.filter(note=>note.start_ms<=500&&note.start_ms+note.duration_ms>500));assert.deepEqual(written.entries.map(entry=>entry.sourceNoteId).sort(),['midi-t1-e6','midi-t1-e8','midi-t3-e1']);assert.equal(env.view.mappingStatus().status,'ready');}finally{env.close();}
});

test('engraved view forwards the current receipt and filters same-part machine feedback across ownership changes',async()=>{
 const score=structuredClone(fixture),notes=score.parts.flatMap(part=>part.notes.filter(note=>note.pitch).map(note=>({id:note.id,source_note_id:note.id,source_note_ids:[note.id],part_id:part.id,midi:pitchMidi(note.pitch),start_ms:beat(note.at)*1000,duration_ms:beat(note.duration)*1000,velocity:note.velocity,voice:note.voice,staff:note.staff}))),source={score,timeline:{notes,duration_ms:Math.max(...notes.map(note=>note.start_ms+note.duration_ms))}};
 const assignment=humanIds=>{const {assistance}=audioAssistanceFixture(source,{partIds:score.parts.map(part=>part.id),humanIds});return{assistance,ownershipIndex:createPracticeAssistanceDisplayIndex({assistance,sourceNotes:notes})};};
 let display=assignment([notes[0].id]),rendered=0,showOthers=true;const forwarded=[],expected=[],i18n=createI18n({locale:'en'});
 const env=environment({i18n,getMode:()=> 'practice',getPracticePart:()=>score.parts[0].id,getPracticeSelection:()=>({kind:'parts',part_ids:score.parts.map(part=>part.id)}),getPracticeDisplay:()=>({layout:'complete',showOthers}),getPracticeAssistanceDisplay:()=>display,loadAdapter:async()=>({disposeEngravedStaff(){},async renderEngravedStaff(container,xml,options){rendered++;forwarded.push(options.getPracticeAssistanceDisplay());return{ok:true,metadata:{fromMeasure:1,toMeasure:score.measures.length},dispose(){},mappingStatus:()=>({status:'ready',diagnostics:[]}),setExpectedWrittenNotes:value=>{expected.push(value);return true},clearExpectedWrittenNotes:()=>true};}})});
 try{
  env.setScore(score);env.calls[0].resolve({ok:true,json:async()=>({xml:'<score-partwise/>',part_id_map:{piano:'P1'},diagnostics:[]})});await new Promise(resolve=>setImmediate(resolve));
  assert.equal(rendered,1);assert.equal(forwarded[0].assistance,display.assistance);assert.equal(forwarded[0].ownershipIndex,display.ownershipIndex);
  env.view.setExpectedWrittenNotes({sourceNoteIds:notes.slice(0,2).map(note=>note.id),sourceMeasureIndex:0});assert.deepEqual(expected.at(-1).sourceNoteIds,[notes[0].id]);
  display=assignment([notes[1].id]);env.view.updateScore();env.calls.at(-1).resolve({ok:true,json:async()=>({xml:'<score-partwise/>',part_id_map:{piano:'P1'},diagnostics:[]})});await new Promise(resolve=>setImmediate(resolve));assert.equal(rendered,2,'Changed note assignment invalidates the painted/prepared role context even when the selected part is unchanged');
  env.view.setExpectedWrittenNotes({sourceNoteIds:notes.slice(0,2).map(note=>note.id),sourceMeasureIndex:0});assert.deepEqual(expected.at(-1).sourceNoteIds,[notes[1].id]);assert.equal(forwarded[1].assistance,display.assistance);assert.equal(env.pauses,0);
  showOthers=false;env.view.updateScore();env.calls.at(-1).resolve({ok:true,json:async()=>({xml:'<score-partwise/>',part_id_map:{piano:'P1'},diagnostics:[]})});await new Promise(resolve=>setImmediate(resolve));assert.equal(forwarded.at(-1).showMachine,false);assert.match(env.elements.get('engraving-status').textContent,/Full staff notation stays visible to preserve shared stems, flags and accidentals/);
  i18n.setLocale('zh-CN');assert.match(env.elements.get('engraving-status').textContent,/完整五线谱仍然显示/);assert.match(env.elements.get('engraving-status').textContent,/机器下落音符和简谱提示已隐藏/);
 }finally{env.close();}
});
