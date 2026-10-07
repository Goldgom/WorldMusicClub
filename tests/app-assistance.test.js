import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {appAssistanceContext,currentAppAssistanceBinding,AppAssistanceStore,assistancePracticeGate,scopedAssistanceTargets,assistanceTakeIdentity} from '../web/app-assistance.js';
import {ScorePreview} from '../web/score-preview.js';
import {createPracticeAssistanceController} from '../web/practice-assistance.js';
import {admitPracticeAssistance,practiceAssistanceBinding} from '../web/practice-assistance-receipt.js';
import {createSongMod,songModIdentity,songModOptions} from '../web/song-mod.js';
import {createPartInstrumentPolicy,assertPartInstrumentPolicyCurrent,resolvePartInstrumentInput} from '../web/part-instrument-policy.js';
import {buildCanonicalAudioPlan,CANONICAL_AUDIO_POLICY} from '../web/canonical-audio-plan.js';
const fixture=name=>JSON.parse(readFileSync(new URL(`./fixtures/assistance-${name}.json`,import.meta.url),'utf8'));
const f=fixture('canonical');
function context(compiled=f.compilation){return appAssistanceContext({score:compiled.score,compiled,practiceSelection:{kind:'all',part_ids:['piano']}},f.automatic.checked.plan.selection.profile,songModIdentity({score:compiled.score}));}
function admit(response=f.automatic,ctx=context()){return admitPracticeAssistance(response,{...ctx,selection:response.checked.plan.selection,mode:response.checked.plan.mode,settings:response.checked.plan.settings,revision:1});}
const memory=()=>{const values=new Map();return{values,getItem:key=>values.get(key)??null,setItem:(key,value)=>values.set(key,value)};};

test('app context preserves canonical compilation tokens and complete native Basic/VSQ reference domains',()=>{
 const ctx=context();assert.equal(ctx.source,null);assert.equal(ctx.sourceToken,f.compilation);assert.equal(ctx.runtimeToken,f.compilation.timeline);assert.equal(ctx.score,f.compilation.score);
 for(const kind of ['native-basic','native-vsq']){const fixtureValue=fixture(kind),source=fixtureValue.source,song={libraryKey:`native:${source.key}`,identity:source.content_sha256,profile:source.profile,runtime:{profile:source.runtime_policy,choice:source.choice}};
  const native=appAssistanceContext({score:f.compilation.score,compiled:f.compilation,cleanSong:song,practiceSelection:{kind:'all',part_ids:['piano']}},ctx.selection.profile,songModIdentity({score:f.compilation.score,cleanSong:song}));assert.deepEqual(native.source,source);assert.equal(native.sourceToken,song);assert.equal(native.runtimeToken,song.runtime);
 }
});

test('checked source targets scope loops without moving source time or allowing an empty fake grade',()=>{
 const checked=admit(),before=JSON.stringify(f.compilation),whole=scopedAssistanceTargets(checked,f.compilation.timeline),human=checked.human_targets.groups.flatMap(group=>group.source_occurrence_ids),machine=checked.machine_occurrence_ids;
 assert.deepEqual(whole.plan,checked.human_targets);assert.deepEqual(whole.sourceTimeline.notes.map(note=>note.id),human);assert.equal(whole.allowed,true);
 const empty=scopedAssistanceTargets(checked,f.compilation.timeline,{target_note_ids:machine,start_ms:0,end_ms:1000});assert.equal(empty.plan.target_count,0);assert.equal(empty.allowed,false);
 const scoped=scopedAssistanceTargets(checked,f.compilation.timeline,{target_note_ids:human,start_ms:1,end_ms:1000});assert.deepEqual(scoped.plan.timeline.notes,whole.plan.timeline.notes);assert.equal(scoped.plan.timeline.duration_ms,f.compilation.timeline.duration_ms);assert.equal(JSON.stringify(f.compilation),before);
 assert.throws(()=>scopedAssistanceTargets(structuredClone(checked),f.compilation.timeline));
});

test('same-part accompaniment uses retained machine recipe independently from live human sound',()=>{
 const checked=admit(),identity=songModIdentity({score:f.compilation.score}),mod=createSongMod(identity,{layout:'complete',showOtherParts:true,parts:[{partId:'piano',performer:'human',instrument:'reed',liveInstrument:'guitar',muted:false,visible:true}]});
 assert.deepEqual(songModOptions(mod).instrumentOverrides,{});assert.deepEqual(songModOptions(mod,{assistance:checked}).instrumentOverrides,{piano:'reed'});
 const policy=createPartInstrumentPolicy(mod,{assistance:checked,performanceInstrument:'piano'});assert.equal(resolvePartInstrumentInput(policy).instrument,'guitar');assert.deepEqual(policy.machineInstrumentOverrides,{piano:'reed'});
 const plan=buildCanonicalAudioPlan(f.compilation,f.audio_profile,{sampleRate:48000,mode:'practice',practiceSelection:{kind:'all',part_ids:['piano']},acceptedPolicyId:CANONICAL_AUDIO_POLICY,assistance:checked,assistanceContext:practiceAssistanceBinding(checked),instrumentOverrides:policy.machineInstrumentOverrides});
 assert.equal(plan.count,checked.machine_occurrence_ids.length);assert.deepEqual(plan.instruments,[2]);assert.equal(plan.sourceFingerprint,f.audio_profile.source_fingerprint);
 assert.throws(()=>assertPartInstrumentPolicyCurrent(policy,{mod,performanceInstrument:'piano',assistance:admit(f.original)}),{code:'stale_part_instrument_policy'});
 const exported=assistanceTakeIdentity(checked);assert.deepEqual(exported.plan,checked.plan);assert.notEqual(exported.plan,checked.plan);
});

test('tab-only quota recipe revalidates in a separate controller and stale callback reads current digest/tokens',async()=>{
 const storage=memory(),store=new AppAssistanceStore({storage});storage.setItem=()=>{throw new Error('quota');};let ctx=context(),calls=0;
 const controller=createPracticeAssistanceController({api:async()=>{calls++;return f.automatic;},getContext:()=>ctx,store});await controller.restore();assert.equal(calls,0);assert.equal(assistancePracticeGate(controller),null);
 controller.beginDraft();controller.setDraft({mode:'automatic',settings:f.automatic.checked.plan.settings});await controller.prepareDraft();controller.commitDraft({resetConfirmed:true});assert.equal(controller.state().persistence.status,'unsaved');
 const old=currentAppAssistanceBinding(controller,ctx),first=controller.current();ctx=context(structuredClone(f.compilation));
 assert.throws(()=>currentAppAssistanceBinding(controller,ctx));assert.equal(assistancePracticeGate(controller).status,'pending');
 const stage=createPracticeAssistanceController({api:async()=>{calls++;return f.automatic;},getContext:()=>ctx,store});const restored=await stage.restore();assert.equal(calls,2);assert.equal(stage.state().persistence.status,'unsaved');assert.equal(restored.plan.selection_digest,first.plan.selection_digest);assert.notEqual(currentAppAssistanceBinding(stage,ctx).sourceToken,old.sourceToken);
 storage.values.set(store.key(ctx),'bad recipe');stage.reset();await stage.restore();assert.equal(stage.current(),null);assert.equal(assistancePracticeGate(stage).status,'blocked');assert.equal(storage.values.get(store.key(ctx)),'bad recipe');
});


test('real Rust cross-scope Automatic with selected human parts but zero human targets cannot admit Practice',()=>{
 const native=fixture('native-vsq'),response=native.narrow_scope,compiled=native.selected_runtime.compilation,ctx={source:native.source,sourceToken:native.selected_runtime,runtimeToken:native.selected_runtime.runtime,selection:response.checked.plan.selection};
 const assistance=admitPracticeAssistance(response,{...ctx,mode:'automatic',settings:response.checked.plan.settings,revision:1}),identity=songModIdentity({score:compiled.score});
 const mod=createSongMod(identity,{layout:'complete',showOtherParts:true,parts:compiled.score.parts.map(part=>({partId:part.id,performer:assistance.plan.selection.selected_part_ids.includes(part.id)?'human':'machine',instrument:'source',liveInstrument:'follow',muted:false,visible:true}))});
 const options=songModOptions(mod,{assistance});assert.equal(options.mode,'practice');assert.equal(scopedAssistanceTargets(assistance,compiled.timeline).allowed,false);
 const preview=new ScorePreview({assistanceController:{state:()=>({phase:'ready',active:assistance,persistence:{status:'saved'}}),current:()=>assistance}});preview.value={status:'ready',score:compiled.score,compiled,songMod:mod,...options,compatibility:{status:'ready'}};
 assert.equal(preview.canStart('practice'),false);assert.equal(assistance.scored_mode_allowed,false);assert.equal(assistance.human_targets.target_count,0);assert.equal(assistance.machine_occurrence_ids.length,compiled.timeline.notes.length);
});

test('failed Off preserves an unsaved Automatic overlay; successful Off removes it before another controller restores',async()=>{
 const storage=memory(),write=storage.setItem;storage.setItem=()=>{throw Error('quota');};const store=new AppAssistanceStore({storage}),ctx=context(),controller=createPracticeAssistanceController({getContext:()=>ctx,store,api:async()=>f.automatic});await controller.restore();controller.beginDraft();controller.setDraft({mode:'automatic',settings:f.automatic.checked.plan.settings});await controller.prepareDraft();controller.commitDraft({resetConfirmed:true});const active=controller.current();assert.equal(controller.state().persistence.status,'unsaved');controller.beginDraft();assert.throws(()=>controller.disableDraft({resetConfirmed:true}),/could not be saved/);assert.equal(controller.current(),active);assert.equal(store.read(ctx).recipe.mode,'automatic');assert.equal(storage.values.size,0);
 storage.setItem=write;controller.disableDraft({resetConfirmed:true});assert.equal(store.read(ctx).status,'off');assert.equal(store.read(ctx).recipe,null);const reload=createPracticeAssistanceController({getContext:()=>ctx,store,api:async()=>{throw Error('No request after explicit Off');}});await reload.restore();assert.equal(reload.state().phase,'off');assert.equal(assistancePracticeGate(reload),null);
});

for(const lost of ['read access','saved bytes'])test(`known checked assignment cannot fall back to Original after losing ${lost}`,async()=>{
 const storage=memory(),store=new AppAssistanceStore({storage}),ctx=context();let calls=0;
 const controller=createPracticeAssistanceController({getContext:()=>ctx,store,api:async()=>{calls++;return f.automatic;}});
 await controller.restore();controller.beginDraft();controller.setDraft({mode:'automatic',settings:f.automatic.checked.plan.settings});await controller.prepareDraft();const active=controller.commitDraft({resetConfirmed:true});
 if(lost==='read access')storage.getItem=()=>{throw Error('Storage access lost');};else storage.values.delete(store.key(ctx));
 assert.equal(controller.current(),active,'The admitted active receipt remains pinned');controller.reset();await controller.restore();
 assert.equal(controller.current(),null);assert.equal(assistancePracticeGate(controller).status,'blocked');assert.equal(controller.state().persistence.status,'unavailable');assert.equal(calls,1);
});

test('only first-use unavailable storage permits Original defaults; observed invalid or readable state remains strict',async()=>{
 for(const initial of ['unavailable','invalid','readable']){
  let denied=initial==='unavailable';const storage=memory(),get=storage.getItem,ctx=context();storage.getItem=key=>{if(denied)throw Error('Storage disabled');return get(key);};if(initial==='invalid')storage.values.set(new AppAssistanceStore({storage}).key(ctx),'broken');
  const store=new AppAssistanceStore({storage}),controller=createPracticeAssistanceController({getContext:()=>ctx,store,api:async()=>{throw Error('Default storage policy must not make assistance requests');}});
  await controller.restore();if(initial==='unavailable'){assert.equal(controller.state().phase,'default');assert.equal(controller.state().persistence.storageUnavailable,true);assert.equal(assistancePracticeGate(controller),null);}else{denied=true;controller.reset();await controller.restore();assert.equal(controller.state().blocked,true);assert.equal(assistancePracticeGate(controller).status,'blocked');}
 }
});

test('explicit Automatic under first-use unavailable storage remains a checked tab-only recipe across controllers',async()=>{
 const denied=()=>{throw Error('Storage disabled');},store=new AppAssistanceStore({storage:{getItem:denied,setItem:denied}}),ctx=context();let calls=0;
 const make=()=>createPracticeAssistanceController({getContext:()=>ctx,store,api:async()=>{calls++;return f.automatic;}}),preview=make();await preview.restore();preview.beginDraft();preview.setDraft({mode:'automatic',settings:f.automatic.checked.plan.settings});await preview.prepareDraft();const active=preview.commitDraft({resetConfirmed:true});assert.equal(preview.state().persistence.status,'unsaved');
 const stage=make();await stage.restore();assert.equal(calls,2);assert.equal(stage.state().persistence.status,'unsaved');assert.equal(stage.current().plan.selection_digest,active.plan.selection_digest);assert.equal(assistancePracticeGate(stage),null);
});

test('storage recovery and changed bytes cannot revive an unsaved recipe or default a known checked source',async()=>{
 const storage=memory(),get=storage.getItem,set=storage.setItem,ctx=context();let denied=true,calls=0;
 storage.getItem=key=>{if(denied)throw Error('Storage disabled');return get(key);};storage.setItem=(key,value)=>{if(denied)throw Error('Storage disabled');return set(key,value);};
 const store=new AppAssistanceStore({storage}),make=()=>createPracticeAssistanceController({getContext:()=>ctx,store,api:async()=>{calls++;return f.automatic;}}),preview=make();
 await preview.restore();preview.beginDraft();preview.setDraft({mode:'automatic',settings:f.automatic.checked.plan.settings});await preview.prepareDraft();const active=preview.commitDraft({resetConfirmed:true});assert.equal(store.read(ctx).status,'unsaved');
 denied=false;assert.equal(store.read(ctx).recipe.expected_selection_digest,active.plan.selection_digest,'Unchanged empty bytes still own the tab-only overlay');storage.values.set(store.key(ctx),'another window wrote incompatible bytes');
 const blocked=make();await blocked.restore();assert.equal(blocked.state().persistence.status,'invalid');assert.equal(blocked.current(),null);assert.equal(calls,1);assert.equal(preview.current(),active);
 storage.values.delete(store.key(ctx));blocked.reset();await blocked.restore();assert.equal(blocked.state().persistence.status,'unavailable');assert.equal(blocked.current(),null);assert.equal(assistancePracticeGate(blocked).status,'blocked');assert.equal(calls,1);
});
