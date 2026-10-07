import test from 'node:test';
import assert from 'node:assert/strict';
import {createProgressiveAssistanceController,PracticeProgressionStore,PROGRESSION_STORAGE_PREFIX} from '../web/practice-progression.js';
import {admitPracticeProgression,assertPracticeProgressionCurrent,progressionForAssistance} from '../web/practice-progression-receipt.js';
import {PracticeAssistanceStore,createPracticeAssistanceController} from '../web/practice-assistance.js';
import {assistanceContext,assistanceResponse,memoryStorage,deferred} from './practice-assistance-fixtures.js';

// Synthetic DTOs exercise boundaries only. Real Rust fixture coverage is separate.
export function response(context,layer='single'){
  const original=assistanceResponse(context,{mode:'explicit',settings:null}),assistance=original.checked;
  const plan={format:'wmc-practice-progression',schema_version:1,planner_revision:1,revision:1,algorithm_id:'wmc-keyboard-progression-v1',scheme_id:'wmc-keyboard-three-layer-v1',receipt:assistance.receipt,selection:assistance.plan.selection,selection_digest:'d'.repeat(64),scheme_digest:'e'.repeat(64),hierarchy_digest:'f'.repeat(64),layer,plan_digest:{single:'1',balanced:'2',dense:'3'}[layer].repeat(64)};
  const layers=['single','balanced','dense'].map((layer,index)=>({layer,constraints:Object.fromEntries(['max_targets_per_onset','min_onset_interval_ms','max_simultaneous_keys','max_held_span_semitones'].map((key,j)=>[key,[[1,500,1,0],[2,250,3,7],[4,125,6,12]][index][j]])),human_source_unit_count:assistance.coverage.human_source_unit_count,human_occurrence_count:assistance.coverage.human_occurrence_count,human_target_count:assistance.coverage.human_target_count,scored_mode_allowed:assistance.scored_mode_allowed,equals_previous_layer:index>0}));
  return {source:original.source,checked:{plan,layers,assistance}};
}
function fixture({storage=memoryStorage(),context=assistanceContext(),hold}={}){
  let live=context;const calls=[],store=new PracticeAssistanceStore({storage}),progressionStore=new PracticeProgressionStore({storage});
  const api=async(path,body,signal)=>{calls.push({path,body,signal});await hold?.(path,body);const selected={...live,selection:body.selection||body.plan.selection};return path.includes('progression/')?response(selected,body.layer||body.plan.layer):assistanceResponse(selected,{mode:path.endsWith('/original')?'original':'automatic',settings:body.settings||null});};
  const controller=createProgressiveAssistanceController({api,getContext:()=>live,store,progressionStore});
  return{controller,api,store,progressionStore,storage,calls,get context(){return live;},set context(value){live=value;}};
}
async function prepare(f,layer='single'){f.controller.beginDraft();f.controller.setDraft({mode:'progression',layer});return f.controller.prepareDraft();}
async function apply(f,layer='single'){await prepare(f,layer);return f.controller.commitDraft({resetConfirmed:true});}

test('wrapper binds selected stage, source/profile/tokens/range, full proof and actual checked targets',()=>{
  const context=assistanceContext(),binding={...context,layer:'single'},checked=admitPracticeProgression(response(context),binding);
  assert.equal(progressionForAssistance(checked.assistance),checked);assert.ok(Object.isFrozen(checked.plan));assert.equal(assertPracticeProgressionCurrent(checked,binding),checked);
  for(const change of [{layer:'dense'},{sourceToken:{}},{runtimeToken:{}},{admissionKey:'new-loop'},{plan:{...checked.plan,plan_digest:'0'.repeat(64)}}])assert.throws(()=>assertPracticeProgressionCurrent(checked,{...binding,...change}));
  for(const mutate of [r=>r.checked.layers.pop(),r=>r.checked.layers[0].human_target_count++,r=>r.checked.layers[1].equals_previous_layer=false,r=>r.checked.plan.layer='dense',r=>r.checked.plan.human_source_ids=['a'],r=>r.checked.assistance.plan.mode='automatic']){const bad=response(context);mutate(bad);assert.throws(()=>admitPracticeProgression(bad,binding));}
  assert.throws(()=>assertPracticeProgressionCurrent(structuredClone(checked),binding));
});
test('untouched v1 default stays request-free and explicit Check/Cancel neither saves nor replaces its active take',async()=>{
  const f=fixture();assert.equal(await f.controller.restore(),null);assert.equal(f.calls.length,0);assert.equal(f.storage.values.size,0);
  const checked=await prepare(f);assert.equal(checked.plan.mode,'explicit');assert.equal(f.controller.current(),null);assert.equal(f.storage.values.size,0);f.controller.cancelDraft();assert.equal(f.controller.current(),null);
  const active=await apply(f);const bytes=[...f.storage.values];await prepare(f,'dense');f.controller.cancelDraft();assert.equal(f.controller.current(),active);assert.deepEqual([...f.storage.values],bytes);
});
test('one new atomic record overrides but never rewrites v1; restore validates the complete progression proof',async()=>{
  const f=fixture(),legacy=createPracticeAssistanceController({api:f.api,getContext:()=>f.context,store:f.store});legacy.beginDraft();legacy.setDraft({mode:'automatic'});await legacy.prepareDraft();legacy.commitDraft({resetConfirmed:true});const old=f.storage.values.get(f.store.key(f.context));
  await f.controller.restore();await apply(f,'balanced');assert.equal(f.storage.values.get(f.store.key(f.context)),old);assert.equal(f.storage.values.size,2);
  const saved=JSON.parse(f.storage.values.get(f.progressionStore.key(f.context)));assert.equal(saved.mode,'progression');assert.equal(saved.plan.layer,'balanced');assert.equal(saved.plan.human_source_ids,undefined);
  const reopened=fixture({storage:f.storage});await reopened.controller.restore();assert.equal(reopened.calls.length,1);assert.match(reopened.calls[0].path,/progression\/validate$/);assert.deepEqual(reopened.calls[0].body.plan,saved.plan);assert.equal(reopened.controller.state().progression.plan.plan_digest,saved.plan.plan_digest);
});
test('Off uses ordinary full-part admission without a large Original DTO and never revives previous v1 Automatic',async()=>{
  const f=fixture(),legacy=createPracticeAssistanceController({api:f.api,getContext:()=>f.context,store:f.store});legacy.beginDraft();legacy.setDraft({mode:'automatic'});await legacy.prepareDraft();legacy.commitDraft({resetConfirmed:true});const old=f.storage.values.get(f.store.key(f.context));
  await apply(f);f.controller.beginDraft();const requests=f.calls.length;f.controller.disableDraft({resetConfirmed:true});assert.equal(f.calls.length,requests);assert.equal(f.controller.current(),null);assert.equal(f.controller.state().phase,'off');assert.equal(f.storage.values.get(f.store.key(f.context)),old);
  const reopened=fixture({storage:f.storage});assert.equal(await reopened.controller.restore(),null);assert.equal(reopened.controller.state().phase,'off');assert.equal(reopened.calls.length,0);
});
test('explicit return to legacy Automatic is a single new-record write and old v1 bytes remain unchanged',async()=>{
  const f=fixture();await apply(f);f.controller.beginDraft();f.controller.setDraft({mode:'automatic'});await f.controller.prepareDraft();f.controller.commitDraft({resetConfirmed:true});assert.equal(f.controller.current().plan.mode,'automatic');assert.equal(f.storage.values.size,1);assert.equal(JSON.parse([...f.storage.values.values()][0]).mode,'automatic');
  const reopened=fixture({storage:f.storage});await reopened.controller.restore();assert.equal(reopened.controller.current().plan.mode,'automatic');assert.match(reopened.calls[0].path,/assistance\/generate$/);
});
test('quota, changed bytes and unreadable preferences preserve active assignment and never half-commit',async()=>{
  for(const failure of ['quota','conflict','unreadable']){
    const storage=memoryStorage(),f=fixture({storage});const active=await apply(f),before=new Map(storage.values);await prepare(f,'dense');
    if(failure==='quota')storage.setItem=()=>{throw Error('quota');};if(failure==='conflict')storage.values.set(f.progressionStore.key(f.context),'external change');if(failure==='unreadable')storage.getItem=()=>{throw Error('denied');};
    assert.throws(()=>f.controller.commitDraft({resetConfirmed:true}),/saved|changed|replacing|read/i);assert.equal(f.controller.current(),active);if(failure!=='conflict')assert.deepEqual(storage.values,before);
  }
});
test('corrupt saved records fail closed; explicit replacement is required and never occurs on Check',async()=>{
  const f=fixture();f.storage.values.set(f.progressionStore.key(f.context),'broken');await f.controller.restore();assert.equal(f.controller.state().blocked,true);await prepare(f);assert.equal([...f.storage.values.values()][0],'broken');assert.throws(()=>f.controller.commitDraft({resetConfirmed:true}),/replacing/);f.controller.commitDraft({resetConfirmed:true,replaceInvalid:true});assert.equal(f.controller.state().phase,'ready');
});
test('a new competing v1 save cannot be silently superseded by a progression draft opened from default',async()=>{
  const f=fixture();await prepare(f);f.storage.values.set(f.store.key(f.context),'other window');assert.throws(()=>f.controller.commitDraft({resetConfirmed:true}),/previous saved assignment changed/);assert.equal(f.storage.values.has(f.progressionStore.key(f.context)),false);assert.equal(f.controller.current(),null);
});
test('source/selection/profile/rate/range changes revoke draft results; Cancel fences late responses',async()=>{
  for(const mutate of [c=>({...c,sourceToken:{}}),c=>({...c,selection:{...c.selection,selected_part_ids:['bass']}}),c=>({...c,selection:{...c.selection,profile:{kind:'piano',key_count:61,lowest_midi:36}}}),c=>({...c,runtimeToken:{}}),c=>({...c,admissionKey:'range-2'})]){
    const gate=deferred(),f=fixture({hold:()=>gate.promise});const pending=prepare(f);await Promise.resolve();f.context=mutate(f.context);f.controller.state();gate.resolve();assert.equal(await pending,null);assert.equal(f.controller.current(),null);assert.equal(f.storage.values.size,0);
  }
  const gate=deferred(),f=fixture({hold:()=>gate.promise});const pending=prepare(f);await Promise.resolve();f.controller.cancelDraft();gate.resolve();assert.equal(await pending,null);assert.equal(f.storage.values.size,0);
});
test('explicit Original still checks its independent full assignment',async()=>{
  const f=fixture();await apply(f);f.controller.beginDraft();f.controller.setDraft({mode:'original'});await f.controller.prepareDraft();assert.equal(f.controller.state().prepared.plan.mode,'original');assert.equal(f.controller.state().preparedProgression,null);f.controller.commitDraft({resetConfirmed:true});assert.equal(JSON.parse([...f.storage.values.values()][0]).mode,'original');
});
test('synchronous Cancel and malformed changing profiles fail closed without late requests or stale data',async()=>{
  const f=fixture();const pending=prepare(f);f.controller.cancelDraft();assert.equal(await pending,null);assert.equal(f.calls.length,0);await apply(f);f.context={...f.context,selection:{...f.context.selection,profile:{kind:'piano',key_count:0,lowest_midi:21}}};assert.equal(f.controller.state().phase,'blocked');assert.equal(f.controller.current(),null);assert.equal(f.controller.state().preparedProgression,null);
});
test('a saved proof rejected by Rust cannot be silently regenerated by reopening and checking an unchanged draft',async()=>{
  const f=fixture();await apply(f);const key=f.progressionStore.key(f.context),saved=JSON.parse(f.storage.values.get(key));saved.plan.plan_digest='0'.repeat(64);f.storage.values.set(key,JSON.stringify(saved));const reopened=fixture({storage:f.storage});await reopened.controller.restore();assert.equal(reopened.controller.state().phase,'blocked');reopened.controller.beginDraft();await assert.rejects(reopened.controller.prepareDraft(),/saved proof/);assert.ok(reopened.calls.every(call=>call.path.endsWith('/validate')));assert.equal(reopened.storage.values.get(key),JSON.stringify(saved));reopened.controller.setDraft({layer:'dense'});await reopened.controller.prepareDraft();assert.match(reopened.calls.at(-1).path,/generate$/);
});
test('cancelling first progression opt-in restores v1 authority for later ordinary edits',async()=>{
  const f=fixture();await prepare(f);f.controller.cancelDraft();f.controller.beginDraft();f.controller.setDraft({mode:'automatic'});await f.controller.prepareDraft();f.controller.commitDraft({resetConfirmed:true});assert.equal(f.storage.values.size,1);assert.ok(f.storage.values.has(f.store.key(f.context)));assert.equal(f.storage.values.has(f.progressionStore.key(f.context)),false);
});
test('the default legacy store shares the same baseline guard when no store is injected',async()=>{
  const previous=Object.getOwnPropertyDescriptor(globalThis,'localStorage'),storage=memoryStorage(),context=assistanceContext();Object.defineProperty(globalThis,'localStorage',{configurable:true,value:storage});
  try{
    const controller=createProgressiveAssistanceController({getContext:()=>context,api:async(_path,body)=>response(context,body.layer)});await controller.restore();controller.beginDraft();controller.setDraft({mode:'progression'});await controller.prepareDraft();storage.values.set(new PracticeAssistanceStore().key(context),'competing v1 choice');assert.throws(()=>controller.commitDraft({resetConfirmed:true}),/previous saved assignment changed/);assert.equal(controller.current(),null);assert.equal([...storage.values.keys()].some(key=>key.startsWith(PROGRESSION_STORAGE_PREFIX)),false);
  }finally{if(previous)Object.defineProperty(globalThis,'localStorage',previous);else delete globalThis.localStorage;}
});
