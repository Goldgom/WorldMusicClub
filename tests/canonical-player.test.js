import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {CanonicalAudioCore} from '../web/canonical-audio-core.js';
import {CanonicalAudioReceiver} from '../web/canonical-audio-receiver.js';
import {CanonicalPlayer} from '../web/canonical-player.js';
import {buildCanonicalAudioPlan,CANONICAL_AUDIO_POLICY} from '../web/canonical-audio-plan.js';
import {basicKeyAudioHarness} from './basic-key-audio-harness.js';
const fixture=()=>JSON.parse(readFileSync(new URL('./fixtures/canonical-audio-evidence.json',import.meta.url)));
const options={mode:'practice',practiceSelection:{kind:'parts',part_ids:['人 手 🎹']},acceptedPolicyId:CANONICAL_AUDIO_POLICY};
const plan=(sampleRate=48000)=>{const f=fixture();return buildCanonicalAudioPlan(f.compilation,f.profile,{...options,sampleRate});};
const create=async(h,extra={})=>CanonicalAudioReceiver.create(h.context,h.output,{...extra,nodeFactory:()=>h.nodeFactory({Core:CanonicalAudioCore})});
const settle=async()=>{for(let i=0;i<6;i++)await Promise.resolve();};

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
