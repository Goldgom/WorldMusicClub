import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {CanonicalAudioCore} from '../web/canonical-audio-core.js';
import {CanonicalAudioReceiver} from '../web/canonical-audio-receiver.js';
import {CanonicalPlayer} from '../web/canonical-player.js';
import {CanonicalPracticeSession} from '../web/canonical-practice-session.js';
import {buildCanonicalAudioPlan,CANONICAL_AUDIO_POLICY} from '../web/canonical-audio-plan.js';
import {basicKeyAudioHarness} from './basic-key-audio-harness.js';
const fixture=()=>JSON.parse(readFileSync(new URL('./fixtures/canonical-audio-evidence.json',import.meta.url)));
const options={mode:'practice',practiceSelection:{kind:'parts',part_ids:['人 手 🎹']},acceptedPolicyId:CANONICAL_AUDIO_POLICY};
const plan=(sampleRate=48000)=>{const f=fixture();return buildCanonicalAudioPlan(f.compilation,f.profile,{...options,sampleRate});};
const create=async(h,extra={})=>CanonicalAudioReceiver.create(h.context,h.output,{...extra,nodeFactory:()=>h.nodeFactory({Core:CanonicalAudioCore})});
const settle=async()=>{for(let i=0;i<6;i++)await Promise.resolve();};

for(const ranged of [false,true])test(`canonical ${ranged?'range':'complete'} disposal inherits muted ACK ownership without changing its gate ledger`,async()=>{
 const h=basicKeyAudioHarness({autoMessages:false}),stopped=[],f=fixture(),p=ranged?buildCanonicalAudioPlan(f.compilation,f.profile,{...options,sampleRate:48000,range:{startMs:250,endMs:500},countInMs:100,loop:{enabled:true,maxPasses:3}}):plan(),r=await create(h,{onStopped:m=>stopped.push(m)});
 const preparing=r.prepare(p);h.deliverCore();h.finishPreparation();h.deliverMain();await preparing;
 const starting=r.start({anchorTime:h.context.currentTime+.001});h.deliverCore();h.deliverMain();await starting;
 for(let i=0;i<60;i++)h.renderBlock();
 r.dispose();assert.equal(r.outputGate.gain.value,0);assert.equal(r.connected,true);assert.equal(r.sourcePositionMs(),null);
 h.deliverCore();const ack=h.toMain.find(([,m])=>m.type==='canceled')[1];assert.equal(ack.ledger.actualStarts.length,ranged?p.recordCapacity:p.notes.length);assert.equal(r.disposalAckMatches(ack),true);h.deliverMain();
 assert.equal(r.disposed,true);assert.equal(r.connected,false);assert.equal(stopped.length,1);assert.equal(stopped[0].planFingerprint,p.planFingerprint);assert.deepEqual(stopped[0].ledger,ack.ledger);
});

test('canonical disposal rejects a wrong plan fingerprint through its existing fail-closed path',async()=>{
 const h=basicKeyAudioHarness({autoMessages:false}),stopped=[],errors=[],r=await create(h,{onStopped:m=>stopped.push(m),onError:e=>errors.push(e)});
 const preparing=r.prepare(plan());h.deliverCore();h.finishPreparation();h.deliverMain();await preparing;
 r.dispose();h.deliverCore();const ack=h.toMain.find(([,m])=>m.type==='canceled')[1];ack.planFingerprint='0'.repeat(64);h.deliverMain();
 assert.equal(r.disposed,true);assert.equal(r.connected,false);assert.deepEqual(stopped,[]);assert.equal(r.lastCompletion,null);assert.equal(errors.length,1);assert.equal(errors[0].code,'canonical_audio_fingerprint');
});

test('canonical receiver prepare/start/pause/resume shares source clock and opaque completion mapping',async()=>{
 const h=basicKeyAudioHarness(),r=await create(h),p=plan();
 try{
  const ready=await r.prepare(p,{positionMs:-100});assert.equal(ready.sourceFingerprint,p.sourceFingerprint);assert.equal(r.state,'ready');
  const start=await r.start();assert.equal(start.positionMs,-100);assert.equal(r.state,'running');assert.equal(r.sourcePositionMs(),-100);
  for(let i=0;i<100;i++)h.renderBlock();const pause=await r.pause();assert.equal(r.state,'paused');const at=r.sourcePositionMs();assert.equal(at,pause.sourcePositionFrame/48);
  for(let i=0;i<10;i++)h.renderBlock();assert.equal(r.sourcePositionMs(),at);
  const resumed=await r.resume();assert.equal(r.state,'running');assert.ok(resumed.resumeTime>h.context.currentTime);assert.equal(r.sourcePositionMs(),at);
  while(h.nodes[0].core.state==='running')h.renderBlock();h.deliverMain();assert.equal(r.state,'ended');assert.equal(r.sourcePositionMs(),4000);
  const audit=await r.audit();assert.equal(audit.rows.length,6);assert.equal(audit.rows[0].noteId,'occurrence-0');assert.equal(audit.rows[0].partId,'机 器/一');assert.deepEqual(audit.rows[0].sourceNoteIds,['同音:一']);assert.ok(audit.pauseSpans.length===2);
  assert.equal(audit.planFingerprint,p.planFingerprint);assert.equal(audit.started,6);assert.equal(audit.ended,6);
 }finally{r.dispose();await settle();}
});
test('canonical receiver refuses source/sample-rate mismatches and forged acknowledgements',async()=>{
 const h=basicKeyAudioHarness(),errors=[],r=await create(h,{onError:e=>errors.push(e)});
 try{
  await assert.rejects(r.prepare(plan(44100)),{code:'invalid_canonical_audio_plan'});await r.prepare(plan());
  r.receive({type:'started',generation:r.generation,planGeneration:r.planGeneration,sampleRate:48000,sourceFingerprint:'0'.repeat(64),compiledFingerprint:r.plan.compiledFingerprint,selectionFingerprint:r.plan.selectionFingerprint,planFingerprint:r.plan.planFingerprint});
  assert.equal(r.state,'error');assert.equal(errors[0].code,'canonical_audio_fingerprint');assert.equal(h.nodes[0].connected,false);assert.equal(r.sourcePositionMs(),null);
 }finally{r.dispose();await settle();}
});
test('pause/prepare backpressure and cancel prevent stale acknowledgements reopening the clock',async()=>{
 const h=basicKeyAudioHarness({autoMessages:false}),r=await create(h);
 try{
  const pending=r.prepare(plan());await assert.rejects(r.prepare(plan()),{code:'audio_prepare_pending'});h.deliverCore();h.finishPreparation();h.deliverMain();await pending;
  const starting=r.start();h.deliverCore();h.deliverMain();await starting;h.renderBlock();
  const pause=r.pause();h.deliverCore();r.cancel('switch');await assert.rejects(pause,{code:'audio_canceled'});h.deliverMain();h.deliverCore();assert.equal(r.state,'canceled');assert.equal(r.sourcePositionMs(),null);assert.equal(h.nodes[0].connected,false);assert.ok(h.renderBlock()[0].every(v=>v===0));
 }finally{r.dispose();h.deliverCore();h.deliverMain();}
});
test('late resumed ack cancels the generation and output without catch-up',async()=>{
 const h=basicKeyAudioHarness({autoMessages:false}),errors=[],r=await create(h,{onError:e=>errors.push(e)});
 try{
  const prep=r.prepare(plan());h.deliverCore();h.finishPreparation();h.deliverMain();await prep;const start=r.start();h.deliverCore();h.deliverMain();await start;
  for(let i=0;i<24;i++)h.renderBlock();const paused=r.pause();h.deliverCore();h.deliverMain();await paused;
  const resumed=r.resume();h.deliverCore();for(let i=0;i<24;i++)h.renderBlock();h.deliverMain();await assert.rejects(resumed,{code:'clean_late_start'});
  assert.equal(r.state,'error');assert.equal(h.nodes[0].connected,false);h.deliverCore();assert.ok(h.renderBlock()[0].every(v=>v===0));assert.equal(errors.at(-1).code,'clean_late_start');
 }finally{r.dispose();h.deliverCore();h.deliverMain();}
});
test('audio context interruption while paused requires a fresh explicit preparation',async()=>{
 const h=basicKeyAudioHarness(),errors=[],r=await create(h,{onError:e=>errors.push(e)});
 try{await r.prepare(plan());await r.start();await r.pause();h.setState('suspended');assert.equal(r.state,'error');assert.equal(h.nodes[0].connected,false);h.setState('running');assert.equal(r.state,'error');await assert.rejects(r.resume(),{code:'clean_audio_unavailable'});assert.equal(errors[0].code,'clean_clock_unavailable');}
 finally{r.dispose();await settle();}
});
test('player races song switch against module preparation and never exposes a stale receiver',async()=>{
 const h=basicKeyAudioHarness(),f=fixture();let release;const wait=new Promise(resolve=>{release=resolve;});let created;
 const player=new CanonicalPlayer({receiverFactory:async()=>{await wait;return created=await create(h);}});player.select(f.compilation,f.profile);
 const pending=player.prepare({...options,context:h.context,output:h.output});player.select(f.compilation,f.profile);release();assert.equal(await pending,null);await settle();assert.equal(player.receiver,null);assert.equal(player.running,false);assert.equal(created.disposed,true);
});
test('player requires newly bound tempo/pitch copies and rejects malformed loop options explicitly',async()=>{
 const h=basicKeyAudioHarness(),f=fixture(),player=new CanonicalPlayer({receiverFactory:()=>create(h)});player.select(f.compilation,f.profile);
 try{
  await assert.rejects(player.prepare({...options,context:h.context,output:h.output,loop:{from:0,to:1000}}),{code:'invalid_canonical_audio_plan'});
  f.compilation.score.tempo[0].bpm=130;await assert.rejects(player.prepare({...options,context:h.context,output:h.output}),{code:'invalid_canonical_audio_plan'});
  const fresh=fixture();player.select(fresh.compilation,fresh.profile);await player.prepare({...options,context:h.context,output:h.output});await player.startPrepared();assert.equal(player.running,true);await player.pause();assert.equal(player.running,false);await player.resume();assert.equal(player.running,true);player.stop();await settle();assert.equal(player.sourcePositionMs(),null);
 }finally{player.stop();await settle();}
});
test('canonical scheduling modules have no path to machine-generated input/scoring/feedback',()=>{
 for(const name of ['canonical-audio-core','canonical-audio-plan','canonical-audio-processor','canonical-audio-receiver','canonical-player']){
  const text=readFileSync(new URL(`../web/${name}.js`,import.meta.url),'utf8');assert.doesNotMatch(text,/requestAnimationFrame|\bSynth\b|plan_targets\(|InputEvent|recordInput|assess\(|onHit\(|dispatchEvent\(/);
 }
});

test('session forwards synthetic part colors and mute to sounding and silent plans with honest interpretation',async()=>{
 const h=basicKeyAudioHarness(),f=fixture(),before=JSON.stringify(f),session=new CanonicalPracticeSession({api:async()=>f.profile,playerFactory:callbacks=>new CanonicalPlayer({...callbacks,receiverFactory:()=>create(h)})});session.select(f.compilation);
 const configured={...options,context:h.context,output:h.output,instrumentOverrides:{'机 器/一':'triangle','机器二':'reed'},mutedPartIds:['机器二'],range:{startMs:0,endMs:500},countInMs:100,loop:{enabled:true,maxPasses:3}};
 try{
  const sounding=await session.prepare(configured);assert.equal(sounding.plan.count,4);assert.ok(sounding.plan.instruments.every(i=>i===1));assert.equal(h.nodes.at(-1).core.plan.synthesisPolicyId,sounding.plan.synthesisPolicyId);
  assert.deepEqual(sounding.interpretation.instrument_overrides,configured.instrumentOverrides);assert.deepEqual(sounding.interpretation.muted_part_ids,configured.mutedPartIds);assert.equal(sounding.interpretation.reference_timbre,'per-part synthetic');assert.equal(sounding.interpretation.source_timbres_preserved,false);assert.match(sounding.interpretation.timbre_description,/not acoustic instrument reproduction/);assert.equal(sounding.interpretation.policy_id,CANONICAL_AUDIO_POLICY);
  const silent=await session.prepare({...configured,soundEnabled:false});assert.equal(silent.plan.planFingerprint,sounding.plan.planFingerprint);assert.equal(silent.interpretation.sound_enabled,false);assert.equal(silent.interpretation.source_clock_available,true);assert.equal(JSON.stringify(f),before);
  const baseline=await session.prepare({...options,context:h.context,soundEnabled:false});assert.equal(baseline.interpretation.reference_timbre,'sine');assert.equal(baseline.interpretation.instrument_overrides,undefined);assert.equal(baseline.interpretation.muted_part_ids,undefined);
 }finally{session.stop();await settle();}
});
