import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture} from './frontend-fixtures.js';
import {validateGuitarFingering,setupGuitarFingering} from '../web/guitar-fingering.js';

function context(){const score=structuredClone(fixture);return{score,timeline:{duration_ms:2000,notes:score.parts[0].notes.map((note,index)=>({id:note.id,source_note_ids:[note.id],part_id:'piano',midi:index?64:60,start_ms:index*500,duration_ms:500}))},part_id:null,profile:{kind:'guitar',tuning:[40,45,50,55,59,64],frets:12,capo:0},dirty:false};}
const defaults=()=>({max_fret_span:3,locks:[]});
function result(ctx,settings=defaults()){
 const notes=ctx.timeline.notes.filter(note=>ctx.part_id===null||note.part_id===ctx.part_id);
 return{version:1,algorithm:'deterministic_guitar_beam_v1',score_id:ctx.score.id,part_id:ctx.part_id,status:notes.length?'ready':'no_targets',profile:structuredClone(ctx.profile),complete:true,changed_source_notes:false,source_occurrence_count:notes.length,max_fret_span:settings.max_fret_span,beam_width:64,explored_choices:2,beam_pruned:false,objective_cost:notes.length?6:0,requested_locks:structuredClone(settings.locks),diagnostics:[],assignments:notes.map((note,index)=>({occurrence_id:note.id,source_note_ids:[...note.source_note_ids],part_id:note.part_id,midi:note.midi,start_ms:note.start_ms,end_ms:note.start_ms+note.duration_ms,string:index?6:5,fret:index?0:1,finger:index?0:1,onset_index:index,picking_hint:index?'upstroke_suggestion':'downstroke_suggestion'}))};
}
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
