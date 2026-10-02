import test from 'node:test';
import assert from 'node:assert/strict';
import {createI18n} from '../web/i18n.js';
import {setupEngravedView} from '../web/engraved-view.js';
import {fixture} from './frontend-fixtures.js';
import {planEngravingReveal} from '../web/engraving-reveal.js';
const deferred=()=>{let resolve;const promise=new Promise(done=>resolve=done);return{promise,resolve}};
function environment({loadAdapter,onManualNavigation,observeResize=false,i18n=createI18n({locale:'en'})}={}){
 const prior=Object.fromEntries(['document','window','MutationObserver','ResizeObserver','fetch'].map(key=>[key,globalThis[key]]));const elements=new Map(),calls=[],visible=[],failures=[],resizeObservers=[],windowListeners=new Map();let score=null,pauses=0;const failure=deferred();
 const element=id=>{if(!elements.has(id))elements.set(id,{textContent:'',hidden:true,value:'',children:[],listeners:new Map(),addEventListener(type,handler){this.listeners.set(type,handler)},replaceChildren(){this.children=[]},append(item){this.children.push(item)}});return elements.get(id)};
 globalThis.document={getElementById:element,createElement:()=>({}),documentElement:{dataset:{theme:'light'}}};globalThis.window={addEventListener(type,handler){if(!windowListeners.has(type))windowListeners.set(type,[]);windowListeners.get(type).push(handler)}};globalThis.MutationObserver=class{observe(){}};globalThis.fetch=(_,options)=>{const response=deferred();calls.push({options,...response});return response.promise};
 if(observeResize)globalThis.ResizeObserver=class{constructor(callback){this.callback=callback;this.observed=[];resizeObservers.push(this)}observe(element){this.observed.push(element)}disconnect(){this.observed=[]}};
 const view=setupEngravedView({i18n,getScore:()=>score,getPracticePart:()=>null,pausePlayback(){pauses++},onVisibility:value=>visible.push(value),onFallback(){failures.push(element('engraving-fallback').textContent);failure.resolve()},notice(){},loadAdapter,onManualNavigation});
 return{view,elements,calls,visible,failures,failure,resizeObservers,windowListeners,get pauses(){return pauses},setScore(next=structuredClone(fixture)){score=next;view.updateScore();return score},close(){view.hide();for(const[key,value]of Object.entries(prior))if(value===undefined)delete globalThis[key];else globalThis[key]=value}};
}
test('the first score requests engraved presentation by default, without starting playback',()=>{const env=environment();try{assert.equal(env.calls.length,0);env.setScore();assert.equal(env.calls.length,1);assert.equal(env.view.isActive(),true);assert.equal(env.visible.at(-1),true);assert.equal(JSON.parse(env.calls[0].options.body).id,fixture.id);env.view.updateScore();assert.equal(env.calls.length,1,'Ordinary UI refreshes must not re-render an unchanged score');}finally{env.close()}});
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
  for(const invalidate of [()=>env.resizeObservers[0].callback(),()=>env.windowListeners.get('resize')[0](),()=>dock.listeners.get('toggle')({}),()=>env.view.resetReveal()]){dock.scrollTop=0;invalidate();assert.equal(env.view.revealExpectedWrittenNotes('repeat-2').status,'ready');assert.equal(dock.scrollTop,272)}assert.equal(reads,7,'Resize, layout details and explicit re-enable refresh an otherwise unchanged identity');
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
