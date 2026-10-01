import test from 'node:test';
import assert from 'node:assert/strict';
import {pianoContext,pianoResult} from './piano-fingering-fixtures.js';
import {defaultPianoSettings,pianoSourceNotes,validatePianoFingering,validatePianoSettings,setupPianoFingering,pianoPlanMessage} from '../web/piano-fingering.js';

test('piano validation accepts preset keyboard range and preserves unison voices, ties, repeats and fractional onsets',()=>{
  const context=pianoContext(),result=pianoResult(context),before=structuredClone({context,result});
  assert.equal(validatePianoFingering(result,context,defaultPianoSettings()),result);assert.deepEqual({context,result},before);
  assert.equal(result.targets.length,3);assert.deepEqual(result.targets[0].source_note_ids,['c4','tie-end','unison']);
  assert.deepEqual(pianoSourceNotes(context).map(note=>note.id),['c4','e4','tie-end','unison']);
  context.profile={kind:'piano',key_count:88,lowest_midi:21};assert.equal(validatePianoFingering(pianoResult(context),context,defaultPianoSettings()).profile.lowest_midi,21);
});
test('piano plans cannot omit or duplicate merged sources or rewrite timing, identity, hands, ranges or request context',()=>{
  for(const mutate of [p=>p.version=2,p=>p.score_id='other',p=>p.part_id='other',p=>p.profile.key_count=49,p=>p.changed_source_notes=true,p=>p.source_occurrence_count=2,p=>p.physical_target_count=2,p=>p.targets.pop(),p=>p.targets[0].source_note_ids.pop(),p=>p.targets[0].source_occurrence_ids.pop(),p=>p.targets[0].source_occurrence_ids.push('c4@1'),p=>p.targets[0].target_id='fabricated',p=>p.targets[0].part_ids=['piano'],p=>p.targets[0].end_ms-=1,p=>p.assignments[0].hand='both',p=>p.assignments[0].finger=0,p=>p.assignments[0].start_ms=0,p=>p.assignments.pop(),p=>p.assignments.push(p.assignments[0]),p=>p.left_hand.max_span_semitones=24,p=>p.objective_cost=Infinity,p=>p.beam_width=100,p=>p.explored_choices=2000001]){
    const context=pianoContext(),result=pianoResult(context);mutate(result);assert.throws(()=>validatePianoFingering(result,context,defaultPianoSettings()),/does not match/);
  }
});
test('all locks on tied and merged source segments must agree with each complete recommendation',()=>{
  const context=pianoContext(),settings={...defaultPianoSettings(),locks:[{source_note_id:'tie-end',hand:'right',finger:1},{source_note_id:'unison',hand:null,finger:1}]};
  const result=pianoResult(context,settings);assert.equal(validatePianoFingering(result,context,settings),result);
  settings.locks[1].hand='left';result.requested_locks=structuredClone(settings.locks);assert.throws(()=>validatePianoFingering(result,context,settings));
});
test('model conflicts and bounded search failures retain target identities without exposing partial assignments',()=>{
  const context=pianoContext();for(const status of ['infeasible_under_model','no_plan_found','search_limit']){
    const result={...pianoResult(context),status,complete:false,assignments:[],objective_cost:null,issues:[{code:'conflict',message:'Review this target',onset_index:0,target_ids:['c4@1'],source_occurrence_ids:['c4@1','unison@1'],source_note_ids:['c4','tie-end','unison']}]};
    assert.equal(validatePianoFingering(result,context,defaultPianoSettings()),result);assert.throws(()=>validatePianoFingering({...result,assignments:[pianoResult(context).assignments[0]]},context,defaultPianoSettings()));
    assert.match(pianoPlanMessage(result),status==='infeasible_under_model'?/constraints conflict/:/does not prove/);
  }
  const unavailable={...pianoResult(context),status:'unavailable',complete:false,physical_target_count:null,targets:[],assignments:[],objective_cost:null,diagnostics:[{message:'Too many source occurrences; no notes omitted.'}]};
  assert.equal(validatePianoFingering(unavailable,context,defaultPianoSettings()),unavailable);assert.throws(()=>validatePianoFingering({...unavailable,status:'ready'},context,defaultPianoSettings()));
});
test('settings accept only canonical sounding selected source IDs, ordered ranges and valid optional locks',()=>{
  const context=pianoContext(),settings=defaultPianoSettings();assert.equal(validatePianoSettings(settings,context),settings);
  for(const mutate of [s=>s.left_hand.lowest_midi=128,s=>Object.assign(s.right_hand,{lowest_midi:70,highest_midi:60}),s=>s.left_hand.max_span_semitones=25,s=>s.locks=[{source_note_id:'missing',hand:'left',finger:null}],s=>s.locks=[{source_note_id:'c4',hand:null,finger:null}],s=>s.locks=[{source_note_id:'c4',hand:'left',finger:6}]]){
    const changed=defaultPianoSettings();mutate(changed);assert.throws(()=>validatePianoSettings(changed,context));
  }
  context.part_id='piano';assert.throws(()=>validatePianoSettings({...settings,locks:[{source_note_id:'unison',hand:'left',finger:null}]},context));
});
test('advisory requests are lazy, deduplicated, cached and never mutate source or input state',async()=>{
  const context=pianoContext(),before=structuredClone(context),calls=[];const guide=setupPianoFingering({getContext:()=>context,api:(path,body,signal)=>new Promise(resolve=>calls.push({path,body,signal,resolve}))});
  assert.equal(calls.length,0);const first=guide.prepare(),second=guide.prepare();assert.equal(first,second);await Promise.resolve();assert.equal(calls.length,1);assert.equal(calls[0].path,'/api/fingering/piano');
  calls[0].resolve(pianoResult(context));await first;assert.equal(guide.state().phase,'ready');assert.equal(guide.assignment('unison@1'),guide.assignment('c4@1'));await guide.prepare();assert.equal(calls.length,1);assert.deepEqual(context,before);assert.equal(guide.state().annotationVersion,1);
});
test('stale responses cannot survive keyboard, part, tempo, timeline or source changes',async()=>{
  for(const change of [c=>({...c,profile:{...c.profile,key_count:88}}),c=>({...c,part_id:'piano'}),c=>({...c,timeline:structuredClone(c.timeline)}),c=>({...c,score:{...c.score,tempo:[{at:{numerator:0,denominator:1},bpm:80}]}})]){
    let context=pianoContext();const old=context,calls=[];const guide=setupPianoFingering({getContext:()=>context,api:(_path,_body,signal)=>new Promise(resolve=>calls.push({resolve,signal}))});
    const first=guide.prepare();await Promise.resolve();context=change(context);const second=guide.prepare();assert.equal(calls[0].signal.aborted,true);calls[0].resolve(pianoResult(old));await first;assert.equal(guide.assignment('c4@1'),null);calls[1].resolve(pianoResult(context));await second;assert.equal(guide.state().phase,'ready');
  }
});
test('draft hand edits and source locks immediately invalidate recommendations, and scope reset is explicit',async()=>{
  let context=pianoContext();const calls=[];const guide=setupPianoFingering({getContext:()=>context,api:async(_path,body)=>{calls.push(body);return pianoResult(context,body);}});
  await guide.prepare();guide.setDraftDirty();assert.equal(guide.assignment('c4@1'),null);await guide.prepare();assert.equal(calls.length,1);
  const settings={...defaultPianoSettings(),left_hand:{lowest_midi:21,highest_midi:72,max_span_semitones:10},locks:[{source_note_id:'c4',hand:'right',finger:1}]};guide.setSettings(settings);await guide.prepare();assert.equal(guide.state().phase,'ready');assert.equal(calls.length,2);
  context={...context,part_id:'piano'};assert.equal(guide.state().settings.locks.length,0);assert.match(guide.state().message,/locks were cleared/);assert.deepEqual(guide.state().settings.left_hand,settings.left_hand);
});
test('dirty or wrong instrument contexts do not request, transient failures require explicit retry, reentrant state reads are safe',async()=>{
  let context=pianoContext(),calls=0,guide;context.dirty=true;guide=setupPianoFingering({getContext:()=>context,onChange:()=>guide.state(),api:()=>{if(++calls===1)throw Error('Temporary failure');return pianoResult(context);}});
  await guide.prepare();assert.equal(calls,0);context={...context,dirty:false,profile:{kind:'guitar'}};await guide.prepare();assert.equal(calls,0);context=pianoContext();await guide.prepare();assert.equal(guide.state().phase,'error');await guide.prepare();assert.equal(calls,1);await guide.prepare({retry:true});assert.equal(guide.state().phase,'ready');assert.equal(calls,2);
});
test('loading notifications can reenter prepare without duplicate requests or recursive planning',async()=>{
  const context=pianoContext();let calls=0,guide;guide=setupPianoFingering({getContext:()=>context,onChange:()=>{guide.state();guide.prepare();},api:async()=>{calls++;return pianoResult(context);}});
  await guide.prepare();assert.equal(calls,1);assert.equal(guide.state().phase,'ready');
});
