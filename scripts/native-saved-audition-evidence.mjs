// Shared strict receipt checks for saved native canonical lobby auditions.
// Callers supply the independent authored source gates, duration and archive key.
import {isDeepStrictEqual} from 'node:util';
import {buildCanonicalAudioPlan,CANONICAL_AUDIO_POLICY} from '../web/canonical-audio-plan.js';
import {validateCanonicalFrameLedger} from './verify-canonical-practice-evidence.mjs';
import {validateAudioThreadStatus,validateAudioThreadLifecycle} from './audio-thread-rendition-proof.mjs';
const assert=(value,message)=>{if(!value)throw Error(message);};
const equal=(a,b,message)=>assert(isDeepStrictEqual(a,b),message);
const positive=value=>Number.isSafeInteger(value)&&value>0;
export function validateSavedCanonicalAudition(value,score,{actions,durationMs,gates,previewId}){
 try{
  assert(value?.version===1&&!value.error&&!value.cleanupError&&!value.observationError&&value.fetchRestored===true,'Actual canonical audition evidence is missing');
  // Native storage validates the loaded archive before ScorePreview compiles
  // the same source for the lobby. Keep both consumed responses: selecting one
  // matching body would hide a missing, extra, or divergent compilation.
  equal(value.responses,[
    {path:'/api/compile',status:200,state:'consumed',body:value.compilation},
    {path:'/api/compile',status:200,state:'consumed',body:value.compilation},
    {path:'/api/canonical-audio-profile',status:200,state:'consumed',body:value.profile},
  ],'Audition must bind the exact storage-validation, preview-compilation and audio-profile responses consumed by the application');
  equal(value.compilation?.score,score,'Audition compilation must retain the exact saved source');
  const timeline=value.compilation.timeline;
  assert(timeline.duration_ms===durationMs,'Original audition duration changed');
  equal(timeline.notes.map(note=>[note.part_id,note.midi,note.start_ms,note.duration_ms,note.velocity,note.source_note_ids]),gates,'Original audition source gates changed');
  assert(Array.isArray(value.audio)&&value.audio.length===1,'Audition must own one canonical receiver generation');const run=value.audio[0],plan=run.plan;
  const expected=buildCanonicalAudioPlan(value.compilation,value.profile,{sampleRate:plan.sampleRate,mode:'listen',acceptedPolicyId:CANONICAL_AUDIO_POLICY,range:{startMs:0,endMs:durationMs},countInMs:0});
  equal(plan,expected,'Audition plan must match the exact source/profile and Listen range');
  equal(run.node,{actualAudioWorkletNode:true,contextMatches:true,numberOfInputs:0,numberOfOutputs:1},'Audition must use the real native Worklet node');
  assert(positive(run.receiverId)&&positive(run.planGeneration)&&run.positionFrame===0,'Audition receiver identity or source start is invalid');
  for(const [row,type]of [[run.prepared,'ready'],[run.started,'started']]){assert(row?.type===type&&row.generation===run.planGeneration&&row.planGeneration===run.planGeneration&&row.planFingerprint===plan.planFingerprint&&row.sampleRate===plan.sampleRate,'Audition native admission is not bound to its source plan');}
  assert(run.started.connected&&run.started.outputContextMatches&&run.started.outputGain>0&&positive(run.started.anchorFrame)&&run.started.anchorFrame>run.started.frame&&run.started.anchorTime===run.started.anchorFrame/plan.sampleRate,'Audition output or audio-clock anchor is invalid');
  const graph=run.started.graphToDestination;assert(Array.isArray(graph)&&graph.length>=3&&graph[0].type==='AudioWorkletNode'&&graph.at(-1).type==='AudioDestinationNode','Audition lacks its connected destination graph');
  assert(Array.isArray(run.messages)&&run.messages.length===4,'Audition needs exactly the ready/start/pass/cancel messages');equal(run.messages.map(row=>row.type),['ready','started','pass_started','canceled'],'Audition native lifecycle changed');
  for(const message of run.messages)assert(message.isTrusted===true&&message.portMatches===true&&message.planGeneration===run.planGeneration&&(message.type==='canceled'?message.generation>run.planGeneration:message.generation===run.planGeneration),'Audition lifecycle contains a forged or stale native message');
  assert(run.terminals.length===1&&run.rawTerminals.length===1,'Audition requires one cancellation and its raw native ledger');const terminal=run.terminals[0],raw=run.rawTerminals[0];
  assert(terminal.ledgerType==='Float64Array'&&raw.ledgerType==='Float64Array'&&raw.isTrusted===true&&raw.portMatches===true,'Audition cancellation ledger must come from its actual native MessagePort');
  const {anchorTime,positionMs,...callbackRecord}=terminal.record;equal(callbackRecord,raw.record,'Audition callback and raw native cancellation differ');
  assert(terminal.record.type==='canceled'&&terminal.record.reason==='dispose'&&terminal.record.generation>run.planGeneration&&terminal.record.frame>run.started.anchorFrame&&terminal.record.frame<run.started.anchorFrame+plan.durationFrames,'Explicit Stop must cancel the advancing audition before source End');
  assert(run.messages[2].frame===run.started.anchorFrame,'Audition first source pass must begin at the actual audio anchor');const cancel=run.messages[3];assert(cancel.generation===terminal.record.generation&&cancel.frame===terminal.record.frame,'Audition cancellation must match the actual native message');
  assert(run.pcm?.method==='passive-output-analyser'&&run.pcm.fftSize===256&&Array.isArray(run.pcm.blocks)&&run.pcm.blocks.length>0&&run.pcm.blocks.length<=64,'Audition needs bounded actual output PCM');
  for(const block of run.pcm.blocks)assert(Number.isFinite(block.audioTime)&&Number.isFinite(block.peak)&&Number.isFinite(block.rms)&&block.peak>=0&&block.rms>=0&&block.rms<=block.peak+1e-12,'Audition PCM block is invalid');
  assert(run.pcm.blocks.some(block=>block.audioTime>=run.started.anchorTime&&block.peak>1e-6&&block.rms>1e-8),'Audition has no positive actual PCM after its start anchor');
  validateCanonicalFrameLedger(run,{pcm:true});validateAudioThreadLifecycle(run.lifecycle);validateAudioThreadStatus(value.playingAudio);validateAudioThreadStatus(value.finalAudio,{quiet:true});
  assert(value.playingAudio.receivers===1&&value.playingAudio.started===1&&value.playingAudio.activeReceivers===1&&value.playingAudio.pendingReceivers===0&&value.finalAudio.receivers===1&&value.finalAudio.started===1&&value.finalAudio.completed===0,'Audition receiver admission or stop outcome differs');
  equal(value.cleanup,{restored:true,overflow:false,errors:[],cleanupErrors:[]},'Audition observers did not restore cleanly');
  for(const sample of [value.before,value.playing,value.stopped]){assert(sample?.screen==='library'&&sample.previewId===previewId&&sample.durationMs===durationMs&&sample.captured==='0'&&sample.assessments===0,'Audition left its saved-source lobby or generated scored input');equal(sample.grades,value.before.grades,'Audition changed scored grades');}
  assert(value.before.status==='ready'&&value.before.positionMs===0&&value.playing.status==='playing'&&value.playing.positionMs>250&&value.playing.positionMs<durationMs&&value.stopped.status==='stopped'&&value.stopped.positionMs>=value.playing.positionMs&&value.stopped.positionMs<durationMs,'Audition source clock did not advance and then stop');
  assert(positive(value.playAction)&&value.stopAction===value.playAction+1,'Audition must have separate consecutive native Play and Stop clicks');
  equal(value.trusted,[value.playAction,value.stopAction].map(actionSequence=>({type:'click',id:'lobby-preview-play',trusted:true,actionSequence})),'Audition requires both actual trusted lobby button clicks');
  if(actions)for(const sequence of [value.playAction,value.stopAction])assert(actions[sequence-1]?.sequence===sequence&&actions[sequence-1].kind==='click','Audition click lacks its native action');
  return{generations:1,started:terminal.record.started,canceledFrame:terminal.record.frame};
 }catch(error){throw Error(`Saved-score audition: ${error.message}`);}
}
