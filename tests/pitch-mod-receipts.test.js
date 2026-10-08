import {withMockBasicEligibility} from './basic-human-admission-fixtures.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {admitPitchModView,pitchModContext,assertPitchModContext,isPitchModPreferenceKey} from '../web/pitch-mod-context.js';
import {appAssistanceContext,currentAppAssistanceBinding} from '../web/app-assistance.js';
import {assistanceRequest,assistancePreferenceKey,PracticeAssistanceStore,createPracticeAssistanceController} from '../web/practice-assistance.js';
import {admitPracticeAssistance,assertPracticeAssistanceCurrent,practiceAssistanceBinding} from '../web/practice-assistance-receipt.js';
import {PracticeProgressionStore,createProgressiveAssistanceController} from '../web/practice-progression.js';
import {admitPracticeProgression,assertPracticeProgressionCurrent} from '../web/practice-progression-receipt.js';
import {fingeringSource,fingeringRequest,fingeringResponse,currentFingeringSource} from '../web/fingering-source.js';
import {setupPianoFingering,defaultPianoSettings} from '../web/piano-fingering.js';
import {prepareCleanSong,prepareVsqPractice} from '../web/clean-song-package.js';
import {songModIdentity} from '../web/song-mod.js';

// Original pitches, timing, ownership and recommendations are Rust handler
// output. New Basic eligibility fields are explicitly mocked at this consumer
// boundary; no source fixture is rewritten or claimed to be regenerated.
const fixtures=withMockBasicEligibility(JSON.parse(readFileSync(new URL('./fixtures/pitch-mod-handler-vectors.json',import.meta.url),'utf8'))).vectors;
const copy=value=>structuredClone(value);
const memory=()=>{const values=new Map();return{values,getItem:key=>values.get(key)??null,setItem:(key,value)=>values.set(key,value)};};
function fixture(kind='canonical_api'){
  const vector=copy(fixtures[kind]),projection=vector.plus2,opened=vector.original.opened;
  let originalSong=null;
  if(opened){originalSong=prepareCleanSong(`native:song-${opened.clean_package.content_sha256}`,opened.clean_package,JSON.parse(opened.score_json));if(kind==='vsq')originalSong=prepareVsqPractice(originalSong,vector.original.choice_response);}
  const original={score:originalSong?.compilation.score||vector.original.score,compiled:originalSong?.compilation||vector.zero.compilation,cleanSong:originalSong};
  const compiled=projection.compilation,song=originalSong?{...originalSong,notation:compiled.score,compilation:compiled,runtime:projection.runtime}:null;
  const view={configuration:projection.configuration,identity:projection.identity,receipt:projection.receipt,sourceView:original,source_pitches:projection.source_pitches,score:compiled.score,compiled,cleanSong:song};
  admitPitchModView(view,projection.source);
  const value={score:compiled.score,compiled,cleanSong:song,pitchView:view,practiceSelection:{part_ids:vector.assistance.checked.plan.selection.selected_part_ids}};
  const context=appAssistanceContext(value,vector.assistance.checked.plan.selection.profile,songModIdentity(original));
  return{vector,projection,view,original,value,context};
}
const binding=f=>({...f.context,mode:'original',settings:null,revision:1});
const guideContext=f=>({score:f.view.score,timeline:f.view.compiled.timeline,cleanSong:f.view.cleanSong,pitchView:f.view,part_id:f.vector.fingering?.plan.part_id??null,profile:f.context.selection.profile,dirty:false});

for(const kind of ['canonical_api','basic','vsq']){
  test(`${kind} keeps requests original, tokens effective, and admits pitch receipt shapes with mocked Basic eligibility`,()=>{
    const f=fixture(kind),b=binding(f),before=JSON.stringify(f.original),request=assistanceRequest(f.context,b);
    assert.deepEqual(request.body.pitch_mod,f.projection.configuration);
    if(f.context.source){assert.deepEqual(request.body.source,f.projection.source);assert.notEqual(request.body.source.runtime_policy,'wmc-pitch-mod-v1');assert.equal('score' in request.body,false);}
    else{assert.equal(request.body.score,f.original.score);assert.notEqual(request.body.score,f.view.score);}
    assert.equal(f.context.sourceToken,f.view.cleanSong||f.view.compiled);assert.equal(f.context.runtimeToken,f.view.cleanSong?.runtime||f.view.compiled.timeline);
    const checked=admitPracticeAssistance(f.vector.assistance,b),stored=practiceAssistanceBinding(checked);
    assert.deepEqual(checked.receipt,f.projection.receipt);assert.equal(stored.pitchMod,f.context.pitchMod);assert.equal(assertPracticeAssistanceCurrent(checked,b),checked);
    assert.equal(currentAppAssistanceBinding({current:()=>checked},f.context).pitchMod,f.context.pitchMod);
    const progression=admitPracticeProgression(f.vector.progression,{...f.context,layer:'single'});
    assert.equal(assertPracticeProgressionCurrent(progression,{...f.context,layer:'single'}),progression);
    assert.equal(JSON.stringify(f.original),before);
  });

  test(`${kind} rejects cross-source, shift, identity, old receipt and unadmitted replay`,()=>{
    const f=fixture(kind),b=binding(f),checked=admitPracticeAssistance(f.vector.assistance,b);
    for(const mutate of [r=>r.pitch_mod.semitones++,r=>r.pitch_mod.version++,r=>r.pitch_mod.digest='a'.repeat(64),r=>r.pitch_mod.original_receipt.runtime_digest='b'.repeat(64),r=>r.pitch_mod.written_interval.fifths_delta++,r=>delete r.pitch_mod,r=>r.source.runtime_policy='wmc-pitch-mod-v1',r=>{r.checked.receipt=copy(f.view.identity.original_receipt);r.checked.plan.receipt=copy(r.checked.receipt);}]){const response=copy(f.vector.assistance);mutate(response);assert.throws(()=>admitPracticeAssistance(response,b));}
    for(const patch of [{pitchMod:undefined},{pitchMod:copy(f.context.pitchMod)},{pitchMod:fixture(kind).context.pitchMod},{receipt:f.view.identity.original_receipt},{runtimeToken:{}}])assert.throws(()=>assertPracticeAssistanceCurrent(checked,{...b,...patch}));
    assert.throws(()=>admitPracticeAssistance(f.vector.assistance,{...b,sourceToken:f.original.compiled,runtimeToken:f.original.compiled.timeline}));
    assert.throws(()=>pitchModContext(copy(f.view)));
    assert.throws(()=>admitPracticeAssistance(f.vector.assistance,{...b,pitchMod:undefined}));
    const progression=copy(f.vector.progression);progression.pitch_mod.digest='c'.repeat(64);assert.throws(()=>admitPracticeProgression(progression,{...f.context,layer:'single'}));
  });

  test(`${kind} pitch preference keys isolate original recipes and only authorize same-source bundle keys`,()=>{
    const f=fixture(kind),zero=appAssistanceContext({...f.original,practiceSelection:f.value.practiceSelection},f.context.selection.profile,songModIdentity(f.original)),base=assistancePreferenceKey(zero),shifted=assistancePreferenceKey(f.context),storage=memory();
    const legacy=new PracticeAssistanceStore({storage}),progression=new PracticeProgressionStore({storage});
    assert.deepEqual(JSON.parse(shifted),[base,'wmc-pitch-mod',1,2,f.projection.identity.digest]);
    for(const store of [legacy,progression]){storage.values.set(store.key(zero),'original bytes');assert.equal(store.read(f.context).status,'default');assert.notEqual(store.key(zero),store.key(f.context));assert.equal(storage.values.get(store.key(zero)),'original bytes');}
    assert.equal(isPitchModPreferenceKey(base,base),true);assert.equal(isPitchModPreferenceKey(shifted,base),true);
    for(const wrong of [JSON.stringify(['other','wmc-pitch-mod',1,2,f.projection.identity.digest]),JSON.stringify([base,'wmc-pitch-mod',2,2,f.projection.identity.digest]),JSON.stringify([base,'wmc-pitch-mod',1,0,f.projection.identity.digest]),JSON.stringify([base,'wmc-pitch-mod',1,13,f.projection.identity.digest]),JSON.stringify([base,'wmc-pitch-mod',1,2,'invalid']),`${shifted} `])assert.equal(isPitchModPreferenceKey(wrong,base),false);
    const originalRequest=assistanceRequest(zero,{mode:'original',settings:null,selection:zero.selection});assert.equal('pitch_mod' in originalRequest.body,false);assert.equal('pitchMod' in originalRequest.binding,false);
  });
}

test('admission rejects mismatched source descriptors and mutable original/shift/receipt state',()=>{
  for(const mutate of [f=>f.view.configuration.semitones++,f=>f.view.identity.digest='d'.repeat(64),f=>f.view.receipt.runtime_digest='e'.repeat(64),f=>f.original.score.title+=' changed',f=>f.view.sourceView={...f.view.sourceView,compiled:copy(f.original.compiled)}]){const f=fixture();mutate(f);assert.throws(()=>pitchModContext(f.view));assert.throws(()=>assertPitchModContext(f.context.pitchMod,f.context.source));}
  const f=fixture();assert.throws(()=>admitPitchModView(f.view,{...f.projection.source,source_binding:{...f.projection.source.source_binding,digest:'f'.repeat(64)}}));
  assert.throws(()=>appAssistanceContext({...f.value,compiled:f.original.compiled},f.context.selection.profile,songModIdentity(f.original)));
});

for(const progressive of [false,true])test(`${progressive?'progression':'assistance'} controllers fence renewed pitch views and send original sources through save/restore`,async()=>{
  const f=fixture(),storage=memory(),store=new PracticeAssistanceStore({storage}),progressionStore=new PracticeProgressionStore({storage}),calls=[];let context=f.context,resolve;
  const create=()=> (progressive?createProgressiveAssistanceController:createPracticeAssistanceController)({store,progressionStore,getContext:()=>context,api:(path,body)=>{calls.push({path,body});return new Promise(done=>resolve=done);}});
  const controller=create();await controller.restore();controller.beginDraft();if(progressive)controller.setDraft({mode:'progression',layer:'single'});
  const pending=controller.prepareDraft();await Promise.resolve();assert.equal(calls[0].body.score,f.original.score);assert.deepEqual(calls[0].body.pitch_mod,f.projection.configuration);
  context=fixture().context;resolve(progressive?f.vector.progression:f.vector.assistance);assert.equal(await pending,null);assert.equal(controller.current(),null);assert.equal(storage.values.size,0);
  context=f.context;controller.beginDraft();if(progressive)controller.setDraft({mode:'progression',layer:'single'});const fresh=controller.prepareDraft();await Promise.resolve();resolve(progressive?f.vector.progression:f.vector.assistance);await fresh;controller.commitDraft({resetConfirmed:true});assert.ok(controller.current());
  const originalBytes=[...storage.values];const reloaded=create(),restoring=reloaded.restore();await Promise.resolve();resolve(progressive?f.vector.progression:f.vector.assistance);await restoring;assert.ok(reloaded.current());assert.deepEqual([...storage.values],originalBytes);
  if(progressive){assert.match(calls.at(-1).path,/progression\/validate$/);assert.deepEqual(calls.at(-1).body.plan,f.vector.progression.checked.plan);}
});

for(const kind of ['canonical_api','vsq'])test(`${kind} fingering binds actual Rust effective plan while requesting original source`,async()=>{
  const f=fixture(kind),ctx=guideContext(f),source=fingeringSource(ctx),request=fingeringRequest('piano',ctx,defaultPianoSettings(),source);
  if(kind==='canonical_api'){assert.equal(request.path,'/api/pitch-mod/fingering/piano');assert.equal(request.body.score,f.original.score);assert.deepEqual(request.body.configuration,f.projection.configuration);}
  else{assert.equal(request.path,'/api/library/fingering/piano');assert.equal('runtime_policy' in request.body.source,false);assert.deepEqual(request.body.pitch_mod,f.projection.configuration);}
  assert.equal(fingeringResponse(f.vector.fingering,source),f.vector.fingering.plan);assert.equal(currentFingeringSource(ctx,ctx.cleanSong,source),true);
  for(const mutate of [r=>r.pitch_mod.semitones++,r=>delete r.pitch_mod,r=>r.receipt=copy(f.projection.identity.original_receipt),r=>r.source.profile='other',r=>r.pitch_mod.digest='0'.repeat(64)]){const response=copy(f.vector.fingering);mutate(response);assert.throws(()=>fingeringResponse(response,source));}
  let context=ctx,resolve;const calls=[],controller=setupPianoFingering({getContext:()=>context,api:(path,body)=>{calls.push({path,body});return new Promise(done=>resolve=done);}});
  const pending=controller.prepare();await Promise.resolve();assert.deepEqual(calls[0],request);resolve(f.vector.fingering);assert.deepEqual(await pending,f.vector.fingering.plan);assert.equal(controller.state().phase,'ready');
  context=guideContext(fixture(kind));assert.equal(controller.state().plan,null);const late=controller.prepare();await Promise.resolve();context=ctx;resolve(f.vector.fingering);assert.equal(await late,null);
});
