import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture} from './frontend-fixtures.js';
import {validateGuitarFingering,setupGuitarFingering,guitarSelectedNotes,guitarSelectedPartIds} from '../web/guitar-fingering.js';

function context(){const score=structuredClone(fixture);return{score,timeline:{duration_ms:2000,notes:score.parts[0].notes.map((note,index)=>({id:note.id,source_note_ids:[note.id],part_id:'piano',midi:index?64:60,start_ms:index*500,duration_ms:500}))},part_id:null,profile:{kind:'guitar',tuning:[40,45,50,55,59,64],frets:12,capo:0},dirty:false};}
const defaults=()=>({max_fret_span:3,locks:[]});
function result(ctx,settings=defaults()){
 const notes=guitarSelectedNotes(ctx);
 return{version:1,algorithm:'deterministic_guitar_beam_v1',score_id:ctx.score.id,part_id:ctx.part_id,...(ctx.selected_part_ids===undefined?{}:{selected_part_ids:guitarSelectedPartIds(ctx)}),status:notes.length?'ready':'no_targets',profile:structuredClone(ctx.profile),complete:true,changed_source_notes:false,source_occurrence_count:notes.length,max_fret_span:settings.max_fret_span,beam_width:64,explored_choices:2,beam_pruned:false,objective_cost:notes.length?6:0,requested_locks:structuredClone(settings.locks),diagnostics:[],assignments:notes.map((note,index)=>({occurrence_id:note.id,source_note_ids:[...note.source_note_ids],part_id:note.part_id,midi:note.midi,start_ms:note.start_ms,end_ms:note.start_ms+note.duration_ms,string:index?6:5,fret:index?0:1,finger:index?0:1,onset_index:index,picking_hint:index?'upstroke_suggestion':'downstroke_suggestion'}))};
}
test('explicit union normalizes an omitted legacy part to the Rust null envelope',async()=>{
 const ctx=context();delete ctx.part_id;ctx.selected_part_ids=['piano'];
 const plan=result({...ctx,part_id:null});
 assert.equal(validateGuitarFingering(plan,ctx,defaults()),plan);
 const requests=[],guide=setupGuitarFingering({getContext:()=>ctx,api:async(_path,body)=>{requests.push(body);return plan;}});
 await guide.prepare();assert.equal(guide.state().phase,'ready');assert.equal(requests.length,1);
 assert.equal(requests[0].part_id,null);assert.deepEqual(requests[0].selected_part_ids,['piano']);
 const wrong={...plan,part_id:'piano'};assert.throws(()=>validateGuitarFingering(wrong,ctx,defaults()));
});
test('guitar plan validation retains exact source/part/timing and capo-relative position correspondence',()=>{
 const ctx=context(),plan=result(ctx),before=structuredClone({ctx,plan});assert.equal(validateGuitarFingering(plan,ctx,defaults()),plan);assert.deepEqual({ctx,plan},before);
 const reordered={...plan,profile:{capo:0,frets:12,tuning:[40,45,50,55,59,64],kind:'guitar'}};assert.equal(validateGuitarFingering(reordered,ctx,defaults()),reordered);
});
test('guitar plans cannot omit occurrences, substitute fingers/ranges or rewrite the original clock',()=>{
 for(const mutate of[p=>p.version=2,p=>p.algorithm='future',p=>p.score_id='other',p=>p.part_id='other',p=>p.profile.capo=1,p=>p.complete=false,p=>p.source_occurrence_count=1,p=>p.assignments.pop(),p=>p.assignments.push({...p.assignments[0]}),p=>p.assignments[0].midi=61,p=>p.assignments[0].source_note_ids=['other'],p=>p.assignments[0].start_ms=.001,p=>p.assignments[0].end_ms=499,p=>p.assignments[0].string=1,p=>p.assignments[0].fret=2,p=>p.assignments[0].finger=0,p=>p.assignments[1].finger=1,p=>p.objective_cost=NaN,p=>p.changed_source_notes=true]){
  const ctx=context(),plan=result(ctx);mutate(plan);assert.throws(()=>validateGuitarFingering(plan,ctx,defaults()),/does not match/);
 }
});
test('incomplete recommendations remain empty and cannot masquerade as successful partial phrases',()=>{
 const ctx=context(),plan={...result(ctx),status:'no_plan_found',complete:false,assignments:[],objective_cost:null,beam_pruned:true};assert.equal(validateGuitarFingering(plan,ctx,defaults()),plan);
 assert.throws(()=>validateGuitarFingering({...plan,assignments:[result(ctx).assignments[0]]},ctx,defaults()));
 assert.throws(()=>validateGuitarFingering({...plan,complete:true},ctx,defaults()));
});
test('every chosen position must satisfy all requested source-note locks',()=>{
 const ctx=context(),settings={max_fret_span:3,locks:[{source_note_id:'c4',string:5,fret:1,finger:1}]},plan=result(ctx,settings);
 assert.equal(validateGuitarFingering(plan,ctx,settings),plan);settings.locks[0].finger=2;assert.throws(()=>validateGuitarFingering(plan,ctx,settings));plan.requested_locks=structuredClone(settings.locks);assert.throws(()=>validateGuitarFingering(plan,ctx,settings));
});
test('advisory preparation is lazy, cached and separate from playback or scoring state',async()=>{
 const ctx=context(),calls=[],states=[],before=structuredClone(ctx);const guide=setupGuitarFingering({getContext:()=>ctx,onChange:s=>states.push(s),api:(path,body,signal)=>new Promise(resolve=>calls.push({path,body,signal,resolve}))});
 assert.equal(calls.length,0);const first=guide.prepare(),second=guide.prepare();assert.equal(first,second);await Promise.resolve();assert.equal(calls.length,1);assert.equal(calls[0].path,'/api/fingering/guitar');assert.deepEqual(calls[0].body,{score:ctx.score,part_id:null,profile:ctx.profile,...defaults()});
 calls[0].resolve(result(ctx));await first;assert.equal(guide.state().phase,'ready');assert.equal(guide.assignment('c4').string,5);await guide.prepare();assert.equal(calls.length,1);assert.deepEqual(ctx,before);assert.equal(states.at(-1).plan.assignments.length,2);
});
test('changed profiles or source scores abort stale guidance instead of recoloring new targets',async()=>{
 let ctx=context();const old=ctx,calls=[];const guide=setupGuitarFingering({getContext:()=>ctx,api:(_path,_body,signal)=>new Promise(resolve=>calls.push({signal,resolve}))});
 const first=guide.prepare();await Promise.resolve();ctx={...ctx,profile:{...ctx.profile,frets:15}};const second=guide.prepare();await Promise.resolve();assert.equal(calls[0].signal.aborted,true);calls[0].resolve(result(old));await first;assert.equal(guide.assignment('c4'),null);
 calls[1].resolve(result(ctx));await second;assert.equal(guide.state().phase,'ready');const next=context();next.score.id='new-score';ctx=next;assert.equal(guide.assignment('c4'),null);assert.equal(guide.state().phase,'idle');
});
test('edited locks invalidate immediately, survive same-score replan, and reset for a different score',async()=>{
 let ctx=context();const calls=[];const guide=setupGuitarFingering({getContext:()=>ctx,api:async(_path,body)=>{calls.push(body);return result(ctx,body);}});
 await guide.prepare();guide.setSettings({max_fret_span:4,locks:[{source_note_id:'c4',string:5,fret:1,finger:1}]});assert.equal(guide.assignment('c4'),null);await guide.prepare();assert.equal(calls.length,2);assert.equal(guide.state().settings.max_fret_span,4);assert.equal(guide.state().plan.requested_locks.length,1);
 ctx=context();guide.state();assert.deepEqual(guide.state().settings,defaults());
 for(const settings of [{max_fret_span:13,locks:[]},{max_fret_span:3,locks:[{source_note_id:'c4'}]},{max_fret_span:3,locks:[{source_note_id:'c4',finger:5}]}])assert.throws(()=>guide.setSettings(settings));
});
test('dirty or non-guitar contexts do not request a plan and a failed request needs explicit retry',async()=>{
 let ctx=context(),calls=0;ctx.dirty=true;const guide=setupGuitarFingering({getContext:()=>ctx,api:()=>{if(++calls===1)throw Error('Temporary local failure');return result(ctx);}});
 await guide.prepare();assert.equal(calls,0);ctx={...ctx,dirty:false,profile:{kind:'piano',key_count:61,lowest_midi:null}};await guide.prepare();assert.equal(calls,0);ctx=context();await guide.prepare();assert.equal(guide.state().phase,'error');await guide.prepare();assert.equal(calls,1);await guide.prepare({retry:true});assert.equal(guide.state().phase,'ready');assert.equal(calls,2);
});
test('status readers may reenter change notifications without recursive invalidation',async()=>{
 let ctx=null,guide;guide=setupGuitarFingering({getContext:()=>ctx,onChange:()=>guide.state(),api:async()=>result(ctx)});
 await guide.prepare();assert.equal(guide.state().phase,'inactive');ctx=context();await guide.prepare();assert.equal(guide.state().phase,'ready');
});

test('loading callbacks may reenter prepare without spawning duplicate requests',async()=>{
 const ctx=context(),calls=[];let guide;
 guide=setupGuitarFingering({getContext:()=>ctx,onChange:state=>{if(state.phase==='loading')guide.prepare()},api:async(_path,body)=>{calls.push(body);return result(ctx,body)}});
 await guide.prepare();assert.equal(calls.length,1);assert.equal(guide.state().phase,'ready');
});

test('queued requests cancelled before execution never leave the process or publish a stale phase',async()=>{
 let ctx=context();const calls=[];
 const guide=setupGuitarFingering({getContext:()=>ctx,api:async(_path,body)=>{calls.push(body);return result(ctx,body)}});
 const original=guide.prepare();ctx={...ctx,dirty:true};guide.state();await original;
 assert.equal(calls.length,0);assert.equal(guide.assignment('c4'),null);await guide.prepare();assert.equal(guide.state().phase,'inactive');
});

test('out-of-order completions cannot overwrite newer locks and in-place request mutations are rejected',async()=>{
 const ctx=context(),calls=[];
 const guide=setupGuitarFingering({getContext:()=>ctx,api:(_path,body,signal)=>new Promise((resolve,reject)=>calls.push({body,signal,resolve,reject}))});
 const old=guide.prepare();await Promise.resolve();guide.setSettings({max_fret_span:5,locks:[{source_note_id:'c4',finger:1}]});const next=guide.prepare();await Promise.resolve();
 assert.equal(calls[0].signal.aborted,true);assert.deepEqual(calls[1].body.locks,[{source_note_id:'c4',string:null,fret:null,finger:1}]);calls[1].resolve(result(ctx,calls[1].body));await next;const newer=guide.state().plan;
 calls[0].reject(Error('old request failed'));await old;assert.equal(guide.state().plan,newer);assert.equal(guide.state().phase,'ready');
 guide.setSettings(defaults());const mutated=guide.prepare();await Promise.resolve();const stale=result(ctx,calls[2].body);ctx.score.title='Changed while pending';calls[2].resolve(stale);await mutated;assert.equal(guide.state().plan,null);
});

test('same-ID score replacement, tempo timeline and reversible transposition clear current assignments',async()=>{
 let ctx=context();const guide=setupGuitarFingering({getContext:()=>ctx,api:async(_path,body)=>result(ctx,body)});
 await guide.prepare();guide.setSettings({max_fret_span:3,locks:[{source_note_id:'c4',finger:1}]});await guide.prepare();
 ctx={...ctx,score:structuredClone(ctx.score),timeline:{...ctx.timeline,notes:ctx.timeline.notes.map(note=>({...note,start_ms:note.start_ms*2,duration_ms:note.duration_ms*2}))}};
 assert.equal(guide.assignment('c4'),null);assert.deepEqual(guide.state().settings,defaults());await guide.prepare();assert.equal(guide.assignment('e4').start_ms,1000);
 const restored=context();ctx={...ctx,score:{...ctx.score,id:ctx.score.id+':semitones:+12'},timeline:{...ctx.timeline,notes:ctx.timeline.notes.map(note=>({...note,midi:note.midi+12}))}};assert.equal(guide.assignment('c4'),null);
 ctx=restored;assert.equal(guide.assignment('c4'),null);await guide.prepare();assert.equal(guide.assignment('c4').midi,60);
});

test('tied source locks constrain the whole occurrence and repeated unisons retain distinct identities',()=>{
 const ctx=context();ctx.timeline.notes=[
  {id:'tie@1',source_note_ids:['tie-head','tie-end'],part_id:'piano',midi:64,start_ms:0,duration_ms:500},
  {id:'unison@1',source_note_ids:['unison'],part_id:'piano',midi:64,start_ms:0,duration_ms:500},
  {id:'tie@2',source_note_ids:['tie-head','tie-end'],part_id:'piano',midi:64,start_ms:1000,duration_ms:500},
 ];
 const settings={max_fret_span:3,locks:[{source_note_id:'tie-end',string:6,fret:0,finger:0}]},plan=result(ctx,settings);
 plan.assignments=ctx.timeline.notes.map((note,index)=>({occurrence_id:note.id,source_note_ids:note.source_note_ids,part_id:note.part_id,midi:64,start_ms:note.start_ms,end_ms:note.start_ms+note.duration_ms,onset_index:index===2?1:0,string:index===1?5:6,fret:index===1?5:0,finger:index===1?4:0,picking_hint:index===2?'upstroke_suggestion':'simultaneous_pluck_review'}));
 assert.equal(validateGuitarFingering(plan,ctx,settings),plan);plan.assignments[2].source_note_ids=['tie-head'];assert.throws(()=>validateGuitarFingering(plan,ctx,settings));
});

const phrase=(from=0,to=1)=>({version:1,from:{numerator:from,denominator:1},to:{numerator:to,denominator:1}});
function phraseResult(ctx,body,ids=['c4'],entry=[]){
 const plan=result(ctx,body),notes=ctx.timeline.notes.filter(note=>ids.includes(note.id));
 const starts=[...new Set(notes.map(note=>note.start_ms))].sort((a,b)=>a-b);
 plan.purpose=body.inventory_only?'scope_inventory':'phrase_plan';
 plan.planning_scope={requested:structuredClone(body.planning_scope),start_ms:250,end_ms:500,full_occurrence_count:guitarSelectedNotes(ctx).length,selected_occurrence_count:ids.length,included_occurrence_ids:ids,entry_hold_occurrence_ids:entry};
 plan.source_occurrence_count=ids.length;
 plan.assignments=plan.assignments.filter(choice=>ids.includes(choice.occurrence_id)).map(choice=>({...choice,onset_index:starts.indexOf(choice.start_ms),picking_hint:notes.filter(note=>note.start_ms===choice.start_ms).length>1?'simultaneous_pluck_review':starts.indexOf(choice.start_ms)%2?'upstroke_suggestion':'downstroke_suggestion'}));
 if(body.inventory_only)Object.assign(plan,{status:'unavailable',complete:false,assignments:[],objective_cost:null});
 return plan;
}
test('phrase planning uses Rust inventory before excluding outside locks and retains session annotations',async()=>{
 const ctx=context(),calls=[],guide=setupGuitarFingering({getContext:()=>ctx,api:async(path,body)=>{calls.push(body);return phraseResult(ctx,body,['c4'],['c4']);}});
 guide.setSettings({max_fret_span:3,locks:[{source_note_id:'c4',finger:1},{source_note_id:'e4',finger:0}]});guide.setPlanningScope(phrase());
 const before=structuredClone(ctx);await guide.prepare();assert.equal(calls.length,2);
 assert.equal(calls[0].inventory_only,true);assert.deepEqual(calls[0].locks,[]);
 assert.deepEqual(calls[1].locks,[{source_note_id:'c4',string:null,fret:null,finger:1}]);
 assert.equal(guide.state().settings.locks.length,2);assert.equal(guide.state().plan.purpose,'phrase_plan');assert.equal(guide.assignment('e4'),null);
 assert.deepEqual(guide.state().scopeInventory.entry_hold_occurrence_ids,['c4']);assert.deepEqual(ctx,before);
});
test('phrase inventory is authoritative even when rounded boundary times cannot establish note ownership',()=>{
 const ctx=context(),scope=phrase(),body={...defaults(),planning_scope:scope},plan=phraseResult(ctx,body,['e4'],[]);
 // Inventory deliberately includes the note at its displayed end boundary: membership is not inferred from ms.
 assert.equal(plan.assignments[0].start_ms,plan.planning_scope.end_ms);
 const settings={...body,scope_inventory:structuredClone(plan.planning_scope)};
 assert.equal(validateGuitarFingering(plan,ctx,settings),plan);
 for(const mutate of [p=>p.planning_scope.included_occurrence_ids=['c4'],p=>p.planning_scope.entry_hold_occurrence_ids=['e4'],p=>p.planning_scope.requested.to.numerator=2,p=>p.planning_scope.start_ms=251,p=>p.purpose='scope_inventory']){
  const wrong=structuredClone(plan);mutate(wrong);assert.throws(()=>validateGuitarFingering(wrong,ctx,settings));
 }
});
test('invalid Rust scope inventories never advance to a lock-bearing planner request',async()=>{
 for(const mutate of [p=>p.planning_scope.included_occurrence_ids=['missing'],p=>{p.planning_scope.included_occurrence_ids=['c4','c4'];p.planning_scope.selected_occurrence_count=2},p=>p.planning_scope.entry_hold_occurrence_ids=['e4'],p=>p.planning_scope.full_occurrence_count=1,p=>p.purpose='phrase_plan',p=>p.complete=true,p=>p.assignments=[result(context()).assignments[0]]]){
  const ctx=context(),calls=[],guide=setupGuitarFingering({getContext:()=>ctx,api:async(_path,body)=>{calls.push(body);const plan=phraseResult(ctx,body);mutate(plan);return plan}});
  guide.setPlanningScope(phrase());await guide.prepare();assert.equal(calls.length,1);assert.equal(guide.state().phase,'error');assert.equal(guide.state().plan,null);
 }
});
test('phrase edits clear old guidance immediately and invalid drafts block auto preparation until revert',async()=>{
 const ctx=context(),calls=[],guide=setupGuitarFingering({getContext:()=>ctx,api:async(_path,body)=>{calls.push(body);return body.planning_scope?phraseResult(ctx,body):result(ctx,body)}});
 await guide.prepare();assert.ok(guide.assignment('c4'));guide.editPlanningScope();assert.equal(guide.assignment('c4'),null);
 assert.throws(()=>guide.setPlanningScope(phrase(2,1)));await guide.prepare();assert.equal(calls.length,1);assert.equal(guide.state().phase,'draft');
 guide.revertPlanningScopeDraft();await guide.prepare();assert.ok(guide.assignment('c4'));assert.equal(calls.length,2);
 guide.setPlanningScope(phrase());await guide.prepare();assert.equal(calls.length,4);assert.equal(guide.state().plan.assignments.length,1);
 guide.setPlanningScope(null);await guide.prepare();assert.equal(calls.length,5);assert.equal(calls[4].planning_scope,undefined);assert.equal(guide.state().plan.assignments.length,2);
});
test('older range preflight and plan responses cannot win after either request phase is invalidated',async()=>{
 const ctx=context(),calls=[],guide=setupGuitarFingering({getContext:()=>ctx,api:(_path,body,signal)=>new Promise(resolve=>calls.push({body,signal,resolve}))});
 guide.setPlanningScope(phrase());const old=guide.prepare();await Promise.resolve();
 guide.setPlanningScope(phrase(1,2));const fresh=guide.prepare();await Promise.resolve();
 assert.equal(calls[0].signal.aborted,true);calls[0].resolve(phraseResult(ctx,calls[0].body));await old;assert.equal(calls.length,2);
 calls[1].resolve(phraseResult(ctx,calls[1].body,['e4']));await new Promise(resolve=>setImmediate(resolve));assert.equal(calls.length,3);
 guide.editPlanningScope();calls[2].resolve(phraseResult(ctx,calls[2].body,['e4']));await fresh;
 assert.equal(guide.state().plan,null);assert.equal(guide.state().phase,'draft');assert.equal(calls[2].signal.aborted,true);
});
test('scope final response is rejected if its exact inventory differs from preflight',async()=>{
 const ctx=context(),guide=setupGuitarFingering({getContext:()=>ctx,api:async(_path,body)=>phraseResult(ctx,body,body.inventory_only?['c4']:['e4'])});
 guide.setPlanningScope(phrase());await guide.prepare();assert.equal(guide.state().phase,'error');assert.equal(guide.state().plan,null);
});
test('scoped requests validate a small complete plan in a score with more than one thousand occurrences',async()=>{
 const ctx=context();ctx.timeline.notes.push(...Array.from({length:1000},(_,i)=>({...ctx.timeline.notes[1],id:`outside-${i}`,source_note_ids:[`outside-source-${i}`],start_ms:1000+i*500})));
 const guide=setupGuitarFingering({getContext:()=>ctx,api:async(_path,body)=>phraseResult(ctx,body)});guide.setPlanningScope(phrase());await guide.prepare();
 assert.equal(guide.state().phase,'ready');assert.equal(guide.state().plan.assignments.length,1);assert.equal(guide.state().scopeInventory.full_occurrence_count,1002);
});

test('scoped bounded or infeasible results retain the exact inventory without presenting partial assignments',()=>{
 const ctx=context(),body={...defaults(),planning_scope:phrase()},base=phraseResult(ctx,body),settings={...body,scope_inventory:base.planning_scope};
 for(const status of ['infeasible_under_model','no_plan_found','search_limit','unavailable']){
  const plan={...base,status,complete:false,assignments:[],objective_cost:null};assert.equal(validateGuitarFingering(plan,ctx,settings),plan);
  assert.throws(()=>validateGuitarFingering({...plan,assignments:base.assignments},ctx,settings));
 }
});
test('score, selected part, profile and lock revisions invalidate both phases of scoped work',async()=>{
 for(const change of ['score','part','profile','locks'])for(const phase of ['inventory','plan']){
  let ctx=context();const initial=ctx,calls=[],guide=setupGuitarFingering({getContext:()=>ctx,api:(_path,body,signal)=>new Promise(resolve=>calls.push({body,signal,resolve}))});
  guide.setPlanningScope(phrase());const pending=guide.prepare();await Promise.resolve();
  if(phase==='plan'){calls[0].resolve(phraseResult(initial,calls[0].body));await new Promise(resolve=>setImmediate(resolve));}
  const current=calls.at(-1);
  if(change==='score')ctx={...ctx,score:structuredClone(ctx.score)};
  else if(change==='part')ctx={...ctx,part_id:'piano'};
  else if(change==='profile')ctx={...ctx,profile:{...ctx.profile,frets:15}};
  else guide.setSettings({max_fret_span:4,locks:[{source_note_id:'c4',finger:1}]});
  guide.state();assert.equal(current.signal.aborted,true);current.resolve(phraseResult(initial,current.body));await pending;
  assert.equal(guide.state().plan,null);assert.equal(calls.length,phase==='plan'?2:1);
 }
});

test('controller display metadata uses stable codes without changing error prose or request semantics',async()=>{
 const ctx=context(),guide=setupGuitarFingering({getContext:()=>ctx,api:async()=>{throw Object.assign(Error('Engine text without a status word'),{code:'engine_detail_17'});}});
 assert.throws(()=>guide.setSettings({max_fret_span:13,locks:[]}),error=>error.code==='guitar_settings_invalid'&&/fret span/.test(error.message));
 assert.throws(()=>guide.setSettings({max_fret_span:3,locks:[{source_note_id:'c4',finger:5}]}),error=>error.code==='guitar_lock_invalid');
 assert.throws(()=>guide.setSettings({max_fret_span:3,locks:[{source_note_id:'absent',finger:1}]}),error=>error.code==='guitar_lock_source');
 const pending=guide.prepare();assert.equal(guide.state().messageCode,'guitar_loading');await pending;
 assert.equal(guide.state().messageCode,'guitar_error');assert.deepEqual(guide.state().errorDetails,{code:'engine_detail_17',message:'Engine text without a status word'});assert.match(guide.state().message,/Engine text without/);
 guide.editPlanningScope();assert.equal(guide.state().messageCode,'guitar_draft');assert.equal(guide.state().errorDetails,null);
});

function unionContext(){
 const ctx=context(),part=ctx.score.parts[0];
 ctx.score.parts=['A','B','C'].map(id=>({...part,id,name:`Part ${id}`,notes:[]}));
 ctx.timeline.notes=[{...ctx.timeline.notes[0],part_id:'A'},{...ctx.timeline.notes[1],part_id:'B'},{...ctx.timeline.notes[1],id:'machine',source_note_ids:['machine'],part_id:'C',start_ms:1000}];
 ctx.selected_part_ids=['B','A'];return ctx;
}
test('selected human union normalizes in source order, filters machine locks and binds the echoed scope',async()=>{
 const ctx=unionContext(),calls=[],guide=setupGuitarFingering({getContext:()=>ctx,api:async(path,body)=>{calls.push({path,body});return result(ctx,body)}});
 guide.setSettings({max_fret_span:3,locks:[{source_note_id:'e4',finger:0},{source_note_id:'machine',finger:0}]});
 await guide.prepare();assert.equal(guide.state().phase,'ready');
 assert.deepEqual(calls[0].body.selected_part_ids,['A','B']);assert.equal(calls[0].body.part_id,null);
 assert.deepEqual(calls[0].body.locks,[{source_note_id:'e4',string:null,fret:null,finger:0}]);
 assert.deepEqual(guide.state().plan.assignments.map(note=>note.part_id),['A','B']);assert.equal(guide.assignment('machine'),null);
 ctx.selected_part_ids=['A','B'];await guide.prepare();assert.equal(calls.length,1,'Equivalent source-order selections share a cache');
 const plan=result(ctx),settings=defaults();
 for(const mutate of [p=>delete p.selected_part_ids,p=>p.selected_part_ids=['A'],p=>p.selected_part_ids=['B','A'],p=>p.selected_part_ids=['A','C'],p=>p.selected_part_ids=null,p=>p.part_id='A']){
  const invalid=structuredClone(plan);mutate(invalid);assert.throws(()=>validateGuitarFingering(invalid,ctx,settings));
 }
});
test('A+B to A+C invalidates cached guidance and late responses with the same first human part',async()=>{
 let ctx=unionContext();const old=structuredClone(ctx),calls=[],guide=setupGuitarFingering({getContext:()=>ctx,api:(path,body,signal)=>new Promise(resolve=>calls.push({path,body,signal,resolve}))});
 const first=guide.prepare();await Promise.resolve();ctx={...ctx,selected_part_ids:['A','C']};const fresh=guide.prepare();await Promise.resolve();
 assert.equal(calls[0].signal.aborted,true);assert.deepEqual(calls[1].body.selected_part_ids,['A','C']);
 calls[1].resolve(result(ctx));await fresh;assert.ok(guide.assignment('machine'));assert.equal(guide.assignment('e4'),null);
 calls[0].resolve(result(old));await first;assert.deepEqual(guide.state().plan.selected_part_ids,['A','C']);
 ctx.selected_part_ids[1]='B';assert.equal(guide.assignment('machine'),null,'In-place ownership edits clear the old route');
});
test('selected union changes cancel both phrase phases and preserve inactive source locks',async()=>{
 for(const phase of ['inventory','plan']){
  let ctx=unionContext();const old=structuredClone(ctx),calls=[],guide=setupGuitarFingering({getContext:()=>ctx,api:(path,body,signal)=>new Promise(resolve=>calls.push({path,body,signal,resolve}))});
  guide.setSettings({max_fret_span:3,locks:[{source_note_id:'e4',finger:0},{source_note_id:'machine',finger:0}]});guide.setPlanningScope(phrase());
  const pending=guide.prepare();await Promise.resolve();assert.deepEqual(calls[0].body.selected_part_ids,['A','B']);assert.deepEqual(calls[0].body.locks,[]);
  if(phase==='plan'){calls[0].resolve(phraseResult(old,calls[0].body,['e4']));await new Promise(resolve=>setImmediate(resolve));assert.deepEqual(calls[1].body.selected_part_ids,['A','B']);assert.equal(calls[1].body.locks[0].source_note_id,'e4');}
  const current=calls.at(-1);ctx={...ctx,selected_part_ids:['A','C']};guide.state();assert.equal(current.signal.aborted,true);assert.equal(guide.state().scopeInventory,null);
  current.resolve(phraseResult(old,current.body,['e4']));await pending;assert.equal(guide.state().plan,null);assert.equal(calls.length,phase==='plan'?2:1);assert.equal(guide.state().settings.locks.length,2);
 }
});
test('malformed explicit unions invalidate previous guidance and never become legacy All',async()=>{
 for(const ids of [null,[],['A','A'],['A','unknown'],'A']){
  const ctx=unionContext(),calls=[],guide=setupGuitarFingering({getContext:()=>ctx,api:async(path,body)=>{calls.push(body);return result(ctx,body)}});
  await guide.prepare();ctx.selected_part_ids=ids;assert.equal(guide.assignment('c4'),null);await guide.prepare();assert.equal(calls.length,1);assert.equal(guide.state().errorDetails.code,'guitar_selection_invalid');
 }
 const ctx=unionContext();ctx.part_id='A';const guide=setupGuitarFingering({getContext:()=>ctx,api:()=>{throw Error('Unexpected request')}});await guide.prepare();assert.equal(guide.state().errorDetails.code,'guitar_selection_invalid');
});
