import test from 'node:test';
import assert from 'node:assert/strict';
import {createI18n} from '../web/i18n.js';
import {setupEngravedView} from '../web/engraved-view.js';
import {fixture} from './frontend-fixtures.js';
import {readFileSync} from 'node:fs';
import {prepareCleanSong} from '../web/clean-song-package.js';
import {basicKeyWrittenAt} from '../web/basic-key-notation.js';
import {planEngravingReveal} from '../web/engraving-reveal.js';
const deferred=()=>{let resolve;const promise=new Promise(done=>resolve=done);return{promise,resolve}};
function environment({loadAdapter,onManualNavigation,onBasicPage,isVisible,getCleanSong,getPracticePart=()=>null,getMode,observeResize=false,i18n=createI18n({locale:'en'})}={}){
 const prior=Object.fromEntries(['document','window','MutationObserver','ResizeObserver','fetch'].map(key=>[key,globalThis[key]]));const elements=new Map(),calls=[],visible=[],failures=[],resizeObservers=[],windowListeners=new Map();let score=null,pauses=0;const failure=deferred();
 const element=id=>{if(!elements.has(id))elements.set(id,{textContent:'',hidden:true,value:'',children:[],listeners:new Map(),addEventListener(type,handler){this.listeners.set(type,handler)},replaceChildren(){this.children=[]},append(item){this.children.push(item)}});return elements.get(id)};
 globalThis.document={getElementById:element,createElement:()=>({children:[],dataset:{},append(item){this.children.push(item)},replaceChildren(){this.children=[]}}),documentElement:{dataset:{theme:'light'}}};globalThis.window={addEventListener(type,handler){if(!windowListeners.has(type))windowListeners.set(type,[]);windowListeners.get(type).push(handler)}};globalThis.MutationObserver=class{observe(){}};globalThis.fetch=(path,options)=>{const response=deferred();calls.push({path,options,...response});return response.promise};
 if(observeResize)globalThis.ResizeObserver=class{constructor(callback){this.callback=callback;this.observed=[];resizeObservers.push(this)}observe(element){this.observed.push(element)}disconnect(){this.observed=[]}};
 const view=setupEngravedView({i18n,getScore:()=>score,getCleanSong,getPracticePart,getMode,isVisible,pausePlayback(){pauses++},onVisibility:value=>visible.push(value),onFallback(){failures.push(element('engraving-fallback').textContent);failure.resolve()},notice(){},loadAdapter,onManualNavigation,onBasicPage});
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
 const env=environment({getCleanSong:()=>song,getPracticePart:()=>song.notation.parts[0].id,getMode:()=> 'practice',loadAdapter:async()=>({disposeEngravedStaff(){},async renderEngravedStaff(_container,_xml,options){painted.push(options.identity.score.measures[0].number);return{ok:true,metadata:{fromMeasure:1,toMeasure:1},dispose(){disposed++;},mappingStatus:()=>({status:'ready',diagnostics:[]}),setExpectedWrittenNotes:()=>true,clearExpectedWrittenNotes:()=>true};}})});
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
