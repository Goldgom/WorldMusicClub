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
