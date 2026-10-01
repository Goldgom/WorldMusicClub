import test from 'node:test';
import assert from 'node:assert/strict';
import {setupEngravedView} from '../web/engraved-view.js';
import {fixture} from './frontend-fixtures.js';
const deferred=()=>{let resolve;const promise=new Promise(done=>resolve=done);return{promise,resolve}};
function environment({loadAdapter}={}){
 const prior=Object.fromEntries(['document','window','MutationObserver','fetch'].map(key=>[key,globalThis[key]]));const elements=new Map(),calls=[],visible=[],failures=[];let score=null,pauses=0;const failure=deferred();
 const element=id=>{if(!elements.has(id))elements.set(id,{textContent:'',hidden:true,value:'',children:[],addEventListener(){},replaceChildren(){this.children=[]},append(item){this.children.push(item)}});return elements.get(id)};
 globalThis.document={getElementById:element,createElement:()=>({}),documentElement:{dataset:{theme:'light'}}};globalThis.window={addEventListener(){}};globalThis.MutationObserver=class{observe(){}};globalThis.fetch=(_,options)=>{const response=deferred();calls.push({options,...response});return response.promise};
 const view=setupEngravedView({getScore:()=>score,getPracticePart:()=>null,pausePlayback(){pauses++},onVisibility:value=>visible.push(value),onFallback(){failures.push(element('engraving-fallback').textContent);failure.resolve()},notice(){},loadAdapter});
 return{view,elements,calls,visible,failures,failure,get pauses(){return pauses},setScore(next=structuredClone(fixture)){score=next;view.updateScore();return score},close(){view.hide();for(const[key,value]of Object.entries(prior))if(value===undefined)delete globalThis[key];else globalThis[key]=value}};
}
test('the first score requests engraved presentation by default, without starting playback',()=>{const env=environment();try{assert.equal(env.calls.length,0);env.setScore();assert.equal(env.calls.length,1);assert.equal(env.view.isActive(),true);assert.equal(env.visible.at(-1),true);assert.equal(JSON.parse(env.calls[0].options.body).id,fixture.id);env.view.updateScore();assert.equal(env.calls.length,1,'Ordinary UI refreshes must not re-render an unchanged score');}finally{env.close()}});
test('explicit simplified or numbered selection survives score changes and cancels old exports',()=>{const env=environment();try{env.setScore();env.view.hide({remember:true});assert.equal(env.calls[0].options.signal.aborted,true);env.setScore({...structuredClone(fixture),id:'next'});assert.equal(env.calls.length,1);assert.equal(env.view.isActive(),false);env.view.show();assert.equal(env.calls.length,2);assert.equal(env.view.isActive(),true);}finally{env.close()}});
test('failed engraving retains its exact reason with a named fallback and retries only for a new score or explicit request',async()=>{const env=environment();try{env.setScore();env.calls[0].resolve({ok:false,status:400,json:async()=>({error:'Unsupported nonrepresentable rhythm.'})});await env.failure.promise;assert.equal(env.view.isActive(),false);assert.equal(env.elements.get('engraving-fallback').hidden,false);assert.match(env.failures[0],/Unsupported nonrepresentable rhythm/);assert.match(env.failures[0],/simplified pitch guide/);env.view.updateScore();assert.equal(env.calls.length,1);env.setScore({...structuredClone(fixture),id:'new-source'});assert.equal(env.calls.length,2);assert.equal(env.view.isActive(),true);assert.equal(env.elements.get('engraving-fallback').hidden,true);}finally{env.close()}});

test('automatic following renders only changed source pages and never pauses the audio transport',()=>{const env=environment();try{const score=structuredClone(fixture);score.measures=Array.from({length:20},(_,index)=>({number:99-index,at:{numerator:index*4,denominator:1},length:{numerator:4,denominator:1}}));env.setScore(score);assert.equal(env.pauses,1);assert.equal(env.view.followMeasure(7),false);assert.equal(env.calls.length,1);assert.equal(env.view.followMeasure(8),true);assert.equal(env.calls.length,2);assert.equal(env.calls[0].options.signal.aborted,true);assert.equal(env.pauses,1);for(let index=8;index<16;index++)assert.equal(env.view.followMeasure(index),false);assert.equal(env.calls.length,2);assert.equal(env.view.navigationState().from,9);assert.equal(env.view.followMeasure(0),true);assert.equal(env.calls.length,3);assert.equal(env.pauses,1);}finally{env.close()}});

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
   assert.ok(notices.includes('Original source warning.'));assert.ok(notices.some(message=>/notehead mapping.*unavailable/i.test(message)));
   assert.equal(env.view.setExpectedWrittenNotes(expected),false);assert.equal(env.view.clearExpectedWrittenNotes(),false);
   assert.equal(env.calls.length,1);assert.equal(env.pauses,1);
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
