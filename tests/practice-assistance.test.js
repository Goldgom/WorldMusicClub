import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {assistanceContext,assistanceBinding,assistanceResponse,memoryStorage,deferred} from './practice-assistance-fixtures.js';
import {admitPracticeAssistance,assertPracticeAssistanceCurrent,practiceAssistanceBinding,defaultAssistanceSettings,validateAssistanceSettings} from '../web/practice-assistance-receipt.js';
import {createPracticeAssistanceController,PracticeAssistanceStore,assistanceRequest} from '../web/practice-assistance.js';
function harness({context=assistanceContext(),storage=memoryStorage(),api}={}){
  const calls=[],store=new PracticeAssistanceStore({storage});let current=context;
  const controller=createPracticeAssistanceController({getContext:()=>current,store,api:async(path,body,signal)=>{calls.push({path,body,signal});return api?api(path,body,signal):assistanceResponse(current,{mode:path.endsWith('/original')?'original':'automatic',settings:body.settings??null,selection:body.selection});}});
  return{controller,store,storage,calls,get context(){return current;},set context(value){current=value;}};
}
async function prepare(h,{selection}={}){h.controller.beginDraft();h.controller.setDraft({mode:'automatic',settings:defaultAssistanceSettings(),...(selection?{selection}:{})});return h.controller.prepareDraft();}
async function savedHarness(options={}){const h=harness(options);await prepare(h);h.controller.commitDraft({resetConfirmed:true});return h;}

test('admission retains canonical, Basic and VSQ Rust receipts, repeated atomic groups and all counts',()=>{
  for(const options of [{},{canonical:true},{vsq:true}]){
    const context=assistanceContext(options),binding=assistanceBinding(context),response=assistanceResponse(context),before=structuredClone(response);
    const admitted=admitPracticeAssistance(response,binding);assert.deepEqual(admitted,response.checked);assert.deepEqual(response,before);assert.ok(Object.isFrozen(admitted.human_targets.groups[0].source_occurrence_ids));
    assert.deepEqual(admitted.human_targets.groups[0].source_note_ids,['a','unison']);assert.equal(admitted.coverage.human_occurrence_count,4);
    assert.equal(assertPracticeAssistanceCurrent(admitted,binding),admitted);assert.equal(assertPracticeAssistanceCurrent(admitted,practiceAssistanceBinding(admitted)),admitted);
    assert.throws(()=>assertPracticeAssistanceCurrent(structuredClone(admitted),binding),/admitted Rust/);
  }
});
test('source/profile/policy/choice/schema/revision/settings/tokens/digest fences fail closed',()=>{
  const context=assistanceContext({vsq:true}),binding=assistanceBinding(context);
  for(const change of [r=>r.source.key='song-other',r=>r.source.choice=null,r=>r.checked.plan.schema_version=0,r=>r.checked.plan.planner_revision=2,r=>r.checked.plan.revision=2,r=>r.checked.receipt.runtime_policy='made-up',r=>r.checked.receipt.source_binding.domain='wmc-canonical-score-serde-json',r=>r.checked.receipt.saved_package_sha256='d'.repeat(64),r=>r.checked.plan.selection.profile.key_count=61,r=>r.checked.plan.settings.max_targets_per_onset=3]){
    const response=assistanceResponse(context);change(response);assert.throws(()=>admitPracticeAssistance(response,binding));
  }
  const a=admitPracticeAssistance(assistanceResponse(context),binding);
  for(const patch of [{sourceToken:{}},{runtimeToken:{}},{revision:2},{expected_selection_digest:'d'.repeat(64)},{receipt:{...a.receipt,runtime_digest:'d'.repeat(64)}},{selection:{...binding.selection,selected_part_ids:['bass']}}])assert.throws(()=>assertPracticeAssistanceCurrent(a,{...binding,...patch}));
});
test('incomplete, duplicate and split atomic target identifiers are rejected',()=>{
  const context=assistanceContext(),binding=assistanceBinding(context);
  for(const mutate of [c=>c.machine_occurrence_ids.push('a@1'),c=>c.human_targets.groups[1].source_occurrence_ids[0]='a@1',c=>c.human_targets.groups[0].source_note_ids.pop(),c=>c.source_ownership[1].owner='machine',c=>c.source_ownership.push(c.source_ownership[0]),c=>c.coverage.human_occurrence_count--,c=>c.human_targets.groups.pop(),c=>c.human_targets.timeline.notes[0].id='fabricated',c=>c.plan.human_source_ids.pop(),c=>c.human_targets.groups[0].part_ids=['bass'],c=>c.human_targets.timeline.notes[0].duration_ms=Infinity]){
    const response=assistanceResponse(context);mutate(response.checked);assert.throws(()=>admitPracticeAssistance(response,binding));
  }
});
test('settings are explicit bounded numbers; automatic guitar is unavailable and Original remains supported',()=>{
  const s=defaultAssistanceSettings();assert.equal(validateAssistanceSettings(s),s);
  for(const patch of [{max_targets_per_onset:33},{max_simultaneous_keys:0},{min_onset_interval_ms:60001},{max_held_span_semitones:128},{algorithm_id:'old'}])assert.throws(()=>validateAssistanceSettings({...s,...patch}));
  const c=assistanceContext();c.selection.profile={kind:'guitar',tuning:[64,59,55,50,45,40],frets:20,capo:0};assert.throws(()=>assistanceRequest(c,{selection:c.selection,mode:'automatic',settings:s}),/keyboard\/Piano/);
  assert.equal(admitPracticeAssistance(assistanceResponse(c,{mode:'original'}),assistanceBinding(c,{mode:'original',settings:null})).plan.mode,'original');
});
test('default Original restores without requests, persistence, playback or source changes',async()=>{
  const h=harness(),before=structuredClone(h.context);await h.controller.restore();assert.equal(h.controller.state().phase,'default');assert.equal(h.calls.length,0);assert.equal(h.storage.values.size,0);assert.deepEqual(h.context,before);
  const code=readFileSync(new URL('../web/practice-assistance.js',import.meta.url),'utf8');assert.doesNotMatch(code,/\.play\(|\.resume\(|AudioContext|new Synth|\.score\s*=(?!=)/);
});
test('Apply requires explicit reset, keeps one complete song, persists a compact deterministic recipe and restores through Rust',async()=>{
  const h=harness(),sourceBefore=structuredClone(h.context);await prepare(h);assert.throws(()=>h.controller.commitDraft(),/Confirm the reset/);assert.equal(h.storage.values.size,0);
  const active=h.controller.commitDraft({resetConfirmed:true});assert.equal(h.controller.current(),active);assert.deepEqual(h.context,sourceBefore);
  const raw=[...h.storage.values.values()][0],recipe=JSON.parse(raw);assert.ok(raw.length<2048);assert.equal('human_source_ids' in recipe,false);assert.equal(recipe.expected_selection_digest,active.plan.selection_digest);
  const reopened=harness({context:h.context,storage:h.storage});await reopened.controller.restore();assert.equal(reopened.calls.length,1);assert.equal(reopened.calls[0].path,'/api/library/assistance/generate');assert.equal(reopened.controller.current().plan.selection_digest,active.plan.selection_digest);
});
test('canonical recipes keep their own source identity and regenerate from the captured score',async()=>{
  const h=await savedHarness({context:assistanceContext({canonical:true})});assert.equal(h.calls[0].path,'/api/practice-assistance/generate');assert.equal(h.calls[0].body.score,h.context.score);assert.equal('timeline' in h.calls[0].body,false);
  const reopened=harness({context:h.context,storage:h.storage});await reopened.controller.restore();assert.equal(reopened.controller.state().phase,'ready');
});
test('Cancel before and during planning, rapid changes, and navigation fence late native results',async()=>{
  for(const action of ['cancel','settings','source','runtime','profile','selection','reset']){
    const gate=deferred(),h=harness({api:()=>gate.promise});h.controller.beginDraft();h.controller.setDraft({mode:'automatic'});const pending=h.controller.prepareDraft();assert.equal(h.controller.prepareDraft(),pending);await Promise.resolve();const old=h.context;
    if(action==='cancel')h.controller.cancelDraft();if(action==='settings')h.controller.setDraft({settings:{...defaultAssistanceSettings(),max_targets_per_onset:1}});
    if(action==='source')h.context={...h.context,sourceToken:{}};if(action==='runtime')h.context={...h.context,runtimeToken:{}};
    if(action==='profile')h.context={...h.context,selection:{...h.context.selection,profile:{...h.context.selection.profile,key_count:61}}};if(action==='selection')h.context={...h.context,selection:{...h.context.selection,selected_part_ids:['bass']}};if(action==='reset')h.controller.reset();
    h.controller.state();gate.resolve(assistanceResponse(old));await pending;assert.equal(h.controller.current(),null);assert.equal(h.controller.state().prepared,null);assert.equal(h.storage.values.size,0);assert.equal(h.calls[0].signal.aborted,true);
  }
  const h=harness();h.controller.beginDraft();h.controller.setDraft({mode:'automatic'});const pending=h.controller.prepareDraft();h.controller.cancelDraft();await pending;assert.equal(h.calls.length,0);
});
test('saved bad schemas and recipe digest changes stay blocked, preserved and never fall back',async()=>{
  for(const mutate of [r=>r.version=99,r=>r.revision=2,r=>r.expected_selection_digest='d'.repeat(64),r=>r.selection.profile.key_count=61]){
    const h=await savedHarness(),key=h.store.key(h.context),recipe=JSON.parse(h.storage.values.get(key));mutate(recipe);const raw=JSON.stringify(recipe);h.storage.values.set(key,raw);
    const reload=harness({context:h.context,storage:h.storage});await reload.controller.restore();assert.equal(reload.controller.state().blocked,true);assert.equal(reload.controller.current(),null);assert.equal(h.storage.values.get(key),raw);
  }
});
test('invalid preference overwrite needs an explicit replacement and quota failure keeps the older saved value',async()=>{
  const h=await savedHarness(),key=h.store.key(h.context);h.storage.values.set(key,'invalid original bytes');const reopen=harness({context:h.context,storage:h.storage});await reopen.controller.restore();await prepare(reopen);
  assert.throws(()=>reopen.controller.commitDraft({resetConfirmed:true}),/confirm its replacement/);assert.equal(h.storage.values.get(key),'invalid original bytes');reopen.controller.commitDraft({resetConfirmed:true,replaceInvalid:true});assert.equal(reopen.controller.state().persistence.status,'saved');
  const before=h.storage.values.get(key);h.storage.setItem=()=>{throw Error('Quota exceeded');};const quota=harness({context:h.context,storage:h.storage});await quota.controller.restore();quota.controller.beginDraft();quota.controller.setDraft({settings:{...defaultAssistanceSettings(),max_targets_per_onset:1}});await quota.controller.prepareDraft();quota.controller.commitDraft({resetConfirmed:true});assert.equal(quota.controller.state().persistence.status,'unsaved');assert.equal(h.storage.values.get(key),before);
});
test('external preference updates cannot be silently overwritten at Apply',async()=>{
  const h=await savedHarness(),key=h.store.key(h.context);h.controller.beginDraft();h.controller.setDraft({settings:{...defaultAssistanceSettings(),max_targets_per_onset:1}});await h.controller.prepareDraft();const other=JSON.parse(h.storage.values.get(key));other.settings.max_targets_per_onset=3;h.storage.values.set(key,JSON.stringify(other));assert.throws(()=>h.controller.commitDraft({resetConfirmed:true}),/another window/);assert.equal(h.controller.state().active.plan.settings.max_targets_per_onset,2);
});
test('Cancel preserves the active assignment and source/profile replacement immediately revokes it',async()=>{
  const h=await savedHarness(),active=h.controller.current();h.controller.beginDraft();h.controller.setDraft({mode:'original'});await h.controller.prepareDraft();h.controller.cancelDraft();assert.equal(h.controller.current(),active);
  h.context={...h.context,runtimeToken:{}};assert.equal(h.controller.current(),null);assert.equal(h.controller.state().phase,'idle');
});

test('Original empty human union retains the complete machine song and no scored targets',()=>{
 const c=assistanceContext();c.selection.selected_part_ids=[];const checked=admitPracticeAssistance(assistanceResponse(c,{mode:'original'}),assistanceBinding(c,{mode:'original',settings:null}));assert.equal(checked.coverage.machine_occurrence_count,6);assert.equal(checked.scored_mode_allowed,false);assert.equal(checked.all_selected_human,false);assert.throws(()=>assistanceRequest(c,{selection:c.selection,mode:'automatic',settings:defaultAssistanceSettings()}),/at least one/);
});
test('a selection commit is fenced and then joins the same synchronous Mod context update',async()=>{
 const h=await savedHarness(),selection={...h.context.selection,selected_part_ids:['piano','bass']};await prepare(h,{selection});assert.throws(()=>h.controller.commitDraft({resetConfirmed:true,isCurrent:()=>false}),/no longer current/);const next=h.controller.commitDraft({resetConfirmed:true});h.context={...h.context,selection};assert.equal(h.controller.current(),next);
});

test('failed saved digest cannot be silently regenerated by opening and applying an unchanged draft',async()=>{
 const h=await savedHarness(),key=h.store.key(h.context),recipe=JSON.parse(h.storage.values.get(key));recipe.expected_selection_digest='d'.repeat(64);const raw=JSON.stringify(recipe);h.storage.values.set(key,raw);
 const reload=harness({context:h.context,storage:h.storage});await reload.controller.restore();reload.controller.beginDraft();await assert.rejects(reload.controller.prepareDraft(),/does not match/);assert.equal(h.storage.values.get(key),raw);assert.equal(reload.controller.current(),null);
 reload.controller.setDraft({settings:{...recipe.settings,max_targets_per_onset:1}});await reload.controller.prepareDraft();reload.controller.commitDraft({resetConfirmed:true});assert.equal(reload.controller.current().plan.settings.max_targets_per_onset,1);
});
test('unreadable storage never pretends a prior recipe is absent, and quota disclosure survives reopening Mod',async()=>{
 const unreadable=harness({storage:{getItem(){throw Error('Storage disabled');}}});await unreadable.controller.restore();assert.equal(unreadable.controller.state().blocked,true);assert.equal(unreadable.calls.length,0);
 const h=await savedHarness(),key=h.store.key(h.context),before=h.storage.values.get(key);h.storage.setItem=()=>{throw Error('Quota exceeded');};h.controller.beginDraft();h.controller.setDraft({settings:{...defaultAssistanceSettings(),max_targets_per_onset:1}});await h.controller.prepareDraft();h.controller.commitDraft({resetConfirmed:true});h.controller.beginDraft();assert.equal(h.controller.state().persistence.status,'unsaved');assert.equal(h.controller.state().draft.settings.max_targets_per_onset,1);h.controller.cancelDraft();assert.equal(h.controller.current().plan.settings.max_targets_per_onset,1);assert.equal(h.storage.values.get(key),before);
});
test('complete cross-scope atomic exclusion may identify an unselected machine owner',()=>{
 const context=assistanceContext(),response=assistanceResponse(context);response.checked.exclusion_reasons=[{source_ids:['b','bass'],code:'cross_scope_physical_group'}];assert.equal(admitPracticeAssistance(response,assistanceBinding(context)).coverage.human_target_count,2);
 response.checked.exclusion_reasons[0].code='onset_density';assert.throws(()=>admitPracticeAssistance(response,assistanceBinding(context)));
});

test('changed guitar profile can explicitly rebuild Original without inheriting the old selection digest',async()=>{
 const context=assistanceContext();context.selection.profile={kind:'guitar',tuning:[64,59,55,50,45,40],frets:12,capo:0};const h=harness({context});
 await h.controller.restore();h.controller.beginDraft();await h.controller.prepareDraft();const original=h.controller.commitDraft({resetConfirmed:true}),key=h.store.key(h.context),raw=h.storage.values.get(key);
 h.context={...h.context,selection:{...h.context.selection,profile:{...h.context.selection.profile,frets:20}}};await h.controller.restore();assert.equal(h.controller.state().phase,'blocked');assert.equal(h.controller.current(),null);
 h.controller.beginDraft();h.controller.setDraft({mode:'original',settings:null});assert.equal(h.controller.state().draft.expected_selection_digest,undefined);await h.controller.prepareDraft();h.controller.cancelDraft();assert.equal(h.storage.values.get(key),raw);assert.equal(h.controller.current(),null);
 h.controller.beginDraft();await h.controller.prepareDraft();assert.throws(()=>h.controller.commitDraft(),/Confirm the reset/);assert.equal(h.storage.values.get(key),raw);const rebuilt=h.controller.commitDraft({resetConfirmed:true});assert.equal(rebuilt.plan.selection.profile.frets,20);assert.notEqual(rebuilt.plan.selection_digest,original.plan.selection_digest);
 const recipe=JSON.parse(h.storage.values.get(key));recipe.expected_selection_digest='d'.repeat(64);const tampered=JSON.stringify(recipe);h.storage.values.set(key,tampered);h.controller.reset();await h.controller.restore();h.controller.beginDraft();h.controller.setDraft({mode:'original',settings:null});assert.equal(h.controller.state().draft.expected_selection_digest,recipe.expected_selection_digest);await assert.rejects(h.controller.prepareDraft(),/does not match/);assert.equal(h.storage.values.get(key),tampered);
});

test('explicit Off replaces only its source recipe, persists a closed marker and restores without checked Original',async()=>{
 const h=await savedHarness(),key=h.store.key(h.context),active=h.controller.current();h.storage.values.set('unrelated-setting','keep');h.controller.beginDraft();assert.throws(()=>h.controller.disableDraft(),/Confirm the reset/);assert.equal(h.controller.current(),active);h.controller.disableDraft({resetConfirmed:true});
 assert.equal(h.controller.current(),null);assert.equal(h.controller.state().phase,'off');assert.equal(h.controller.state().persistence.status,'off');const marker=JSON.parse(h.storage.values.get(key));assert.deepEqual(Object.keys(marker),['format','version','preference_key','source']);assert.equal(marker.format,'wmc-practice-assistance-off');assert.deepEqual(marker.source,h.context.source);assert.equal(h.storage.values.get('unrelated-setting'),'keep');
 const reload=harness({context:h.context,storage:h.storage});await reload.controller.restore();assert.equal(reload.controller.state().phase,'off');assert.equal(reload.calls.length,0);reload.controller.beginDraft();reload.controller.cancelDraft();assert.equal(reload.controller.state().phase,'off');
 await prepare(reload);reload.controller.commitDraft({resetConfirmed:true});assert.equal(reload.controller.current().plan.mode,'automatic');assert.equal(JSON.parse(h.storage.values.get(key)).format,'wmc-practice-assistance-recipe');
});

test('Off markers with wrong identity, version or extra fields stay invalid and cannot unlock ordinary practice',async()=>{
 const h=await savedHarness();h.controller.beginDraft();h.controller.disableDraft({resetConfirmed:true});const key=h.store.key(h.context),off=JSON.parse(h.storage.values.get(key));
 for(const mutate of [m=>m.version=2,m=>m.preference_key='another-source',m=>m.source.content_sha256='d'.repeat(64),m=>m.unchecked=true]){const marker=structuredClone(off);mutate(marker);const raw=JSON.stringify(marker);h.storage.values.set(key,raw);const reload=harness({context:h.context,storage:h.storage});await reload.controller.restore();assert.equal(reload.controller.state().persistence.status,'invalid');assert.equal(reload.controller.state().blocked,true);assert.equal(reload.calls.length,0);assert.equal(h.storage.values.get(key),raw);reload.controller.beginDraft();assert.throws(()=>reload.controller.disableDraft({resetConfirmed:true}),/confirm replacing/);assert.equal(h.storage.values.get(key),raw);}
});

test('Off optimistic-byte conflict, missing storage and write failure never clear the current receipt or prior recipe',async()=>{
 for(const failure of ['conflict','read','write']){const h=await savedHarness(),key=h.store.key(h.context),active=h.controller.current();h.controller.beginDraft();const before=h.storage.values.get(key);if(failure==='conflict')h.storage.values.set(key,before+' ');if(failure==='read')h.storage.getItem=()=>{throw Error('read unavailable');};if(failure==='write')h.storage.setItem=()=>{throw Error('quota');};const expected=h.storage.values.get(key);assert.throws(()=>h.controller.disableDraft({resetConfirmed:true}),/another window|cannot be read|could not be saved/);assert.equal(h.controller.current(),active);assert.equal(h.storage.values.get(key),expected);}
});
