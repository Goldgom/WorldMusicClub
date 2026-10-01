import test from 'node:test';
import assert from 'node:assert/strict';
import {InputEvidence, INPUT_EVIDENCE_LIMIT} from '../web/input-evidence.js';
import {PracticeRecorder} from '../web/practice-recorder.js';
import {eventTimeEvidence, normalizeEventTime} from '../web/midi.js';

const timeline={duration_ms:500,notes:[{id:'last',midi:60,start_ms:450,duration_ms:50}]};
const begin=(recorder,wallTime=1000)=>recorder.begin({wallTime,position:0,startMs:0,endMs:500,timeline});
const observation=(eventWall,extra={})=>({source:'private-device-key',inputKind:'midi',channel:0,midi:60,velocity:90,eventWall,receivedWall:eventWall,...extra});
const legacy=recorder=>{const {input_evidence,...data}=recorder.exportData();return structuredClone(data)};

test('release observations preserve the exact legacy onset export, snapshots and assessment revisions',()=>{
 const recorder=new PracticeRecorder({latencyMs:100}),pass=begin(recorder);
 const input=observation(1550,{receivedWall:2000});const captured=recorder.capture(input);recorder.observeOnset(input,captured);
 recorder.closeAtEnd(1500);const job=recorder.submit(pass);recorder.complete(job,{hits:[],misses:['last']});
 const before=legacy(recorder),submitted=structuredClone(job.inputs),snapshot=recorder.exportData().input_evidence;
 recorder.evidence.release(observation(1650,{receivedWall:2400,velocity:44,encoding:'midi_note_off'}));
 recorder.evidence.cancel({reason:'pause',eventWall:2500,boundaryWall:2500});
 assert.deepEqual(legacy(recorder),before);assert.deepEqual(job.inputs,submitted);assert.deepEqual(recorder.ready(3000),[]);
 assert.equal(recorder.pending,false);assert.equal(snapshot.events.length,1);
 const evidence=recorder.exportData().input_evidence;
 assert.deepEqual(evidence.events[0].onset_capture,{pass_id:1,event_id:1});
 assert.equal(evidence.events[1].velocity,44);assert.equal(evidence.events[1].received_wall_ms,2400);
 assert.equal(evidence.pairing,'not_implemented');assert.equal(evidence.release_assessment,'not_implemented');assert.equal(evidence.duration_eligibility,'unknown');
 assert.equal(evidence.events.some(event=>Object.hasOwn(event,'duration_ms')||Object.hasOwn(event,'paired_on_event_id')),false);
 assert.throws(()=>{evidence.events[0].onset_capture.pass_id=9},TypeError);
});

test('receipt order preserves off-before-on and repeated attacks without pairing or timestamp sorting',()=>{
 const recorder=new PracticeRecorder();begin(recorder);const token={};
 recorder.evidence.release(observation(1200,{receivedWall:2000,generationToken:token,velocity:0}));
 for(const [eventWall,velocity] of [[1100,40],[1150,100]]){
  const event=observation(eventWall,{receivedWall:2100,generationToken:token,velocity});
  recorder.observeOnset(event,recorder.capture(event));
 }
 const evidence=recorder.exportData().input_evidence;
 assert.deepEqual(evidence.events.map(e=>e.event_wall_ms),[1200,1100,1150]);
 assert.deepEqual(evidence.events.map(e=>e.event_id),[1,2,3]);assert.equal(new Set(evidence.events.map(e=>e.source_id)).size,1);
 assert.deepEqual(evidence.events.slice(1).map(e=>e.onset_capture.event_id),[1,2]);assert.deepEqual(recorder.active.inputs.map(e=>e.velocity),[40,100]);
});

test('opaque source aliases distinguish channels, ports and connection generations without device data',()=>{
 const evidence=new InputEvidence();evidence.start();const first={},other={},replacement={};
 for(const [source,generationToken,channel] of [['midi:SECRET-ID:0:60',first,0],['midi:SECRET-ID:1:60',first,1],['midi:OTHER-ID:0:60',other,0],['midi:SECRET-ID:0:60',replacement,0]])evidence.append({...observation(100),kind:'note_on',source,generationToken,channel});
 const exported=evidence.exportData();assert.equal(new Set(exported.events.map(e=>e.source_id)).size,4);
 assert.deepEqual(exported.events.map(e=>e.source_generation),['generation-1','generation-1','generation-2','generation-3']);
 assert.doesNotMatch(JSON.stringify(exported),/SECRET|OTHER-ID|private-device|generationToken|manufacturer/);
 const fresh=new InputEvidence();fresh.start();fresh.append({...observation(100),kind:'note_on',source:'unrelated-new-device'});
 assert.equal(fresh.events[0].source_id,'source-1','Aliases start afresh for each recorder');
});

test('channel panic and port cleanup remain scoped synthetic observations, never explicit offs',()=>{
 const evidence=new InputEvidence();evidence.start();const first={},second={};
 for(const [source,generationToken,channel] of [['midi:first:0:60',first,0],['midi:first:1:60',first,1],['midi:second:0:60',second,0],['key:KeyA',null,null]])evidence.append({...observation(100),kind:'note_on',source,generationToken,channel});
 evidence.cancel({prefix:'midi:first:0:',generationToken:first,channel:0,reason:'midi_cc120',eventWall:200});
 assert.equal(evidence.active.size,3);assert.equal(evidence.events.at(-1).reason,'midi_cc120');assert.equal(evidence.events.at(-1).channel,0);
 evidence.cancel({prefix:'midi:first:',generationToken:first,reason:'midi_disconnected',eventWall:300});
 assert.equal(evidence.active.size,2);assert.equal(evidence.events.at(-1).channel,1);
 assert.equal(evidence.events.filter(e=>e.kind==='note_off').length,0);
 assert.equal(evidence.events.filter(e=>e.kind==='synthetic_release').length,2);
});

test('UI release and duplicate cleanup stay distinct and pitch reuse never rewrites earlier evidence',()=>{
 const evidence=new InputEvidence();evidence.start();
 evidence.release({source:'key:Unrelated',eventWall:100});assert.equal(evidence.events.length,0);
 evidence.release({source:'pointer:4',inputKind:'on_screen_pointer',eventWall:110,encoding:'pointer_up'});
 evidence.append({...observation(100),source:'pointer:4',inputKind:'on_screen_pointer',kind:'note_on'});
 evidence.release({source:'pointer:4',eventWall:120,encoding:'pointer_up'});
 const releasedCount=evidence.events.length;
 evidence.cancel({source:'pointer:4',eventWall:121,reason:'lostpointercapture'});
 assert.equal(evidence.events.length,releasedCount);
 assert.equal(evidence.events.filter(e=>e.kind==='synthetic_release').length,0);
 for(const midi of [60,64]){
  evidence.append({...observation(200),source:'accessible-key',inputKind:'on_screen_keyboard',midi,kind:'note_on'});
  evidence.release({source:'accessible-key',eventWall:220,encoding:'key_up'});
 }
 assert.deepEqual(evidence.events.filter(e=>e.encoding==='key_up').map(e=>e.midi),[null,null],'UI keyup does not intrinsically identify a pitch');
 assert.deepEqual(evidence.events.filter(e=>e.kind==='note_on'&&e.input_kind==='on_screen_keyboard').map(e=>e.midi),[60,64]);
 const keysReleasedCount=evidence.events.length;evidence.cancel({source:'accessible-key',eventWall:250,reason:'focusout'});assert.equal(evidence.events.length,keysReleasedCount);
 evidence.append({...observation(300),source:'accessible-key',kind:'note_on'});
 evidence.cancel({source:'accessible-key',eventWall:310,reason:'focusout'});
 evidence.cancel({source:'accessible-key',eventWall:311,reason:'blur'});
 assert.equal(evidence.events.filter(e=>e.kind==='synthetic_release').length,1);
 evidence.release({source:'accessible-key',eventWall:320,encoding:'key_up'});
 const endedCount=evidence.events.length;evidence.release({source:'accessible-key',eventWall:330,encoding:'key_up'});
 assert.equal(evidence.events.length,endedCount,'Unrelated later typing does not become musical input merely because a source was used earlier');
});

test('pause, resume, loop boundaries and stalled gaps retain observations without inventing onset ownership',()=>{
 const recorder=new PracticeRecorder({latencyMs:100});begin(recorder);
 const first=observation(1300);recorder.observeOnset(first,recorder.capture(first));
 recorder.pause(1400);recorder.evidence.cancel({reason:'pause',eventWall:1400,boundaryWall:1400});
 recorder.evidence.release(observation(1800,{encoding:'midi_note_off'}));
 recorder.resume(2000,400);recorder.closeAtEnd(2100);
 recorder.evidence.cancel({reason:'loop_clock_stall',eventWall:3500,boundaryWall:2100});
 recorder.recordInterruption({boundaryWall:2100,observedWall:3500,skippedPasses:2});
 const gap=observation(3000,{receivedWall:3600});recorder.observeOnset(gap,recorder.capture(gap));
 recorder.evidence.release(observation(3050,{receivedWall:3700}));
 const free=observation(4000);recorder.observeOnset(free,recorder.capture(free));
 const events=recorder.exportData().input_evidence.events;
 assert.deepEqual(events.find(e=>e.event_wall_ms===3000).onset_capture,{pass_id:null,event_id:2});
 assert.equal(events.find(e=>e.event_wall_ms===4000).onset_capture,null);
 assert.equal(events.find(e=>e.reason==='loop_clock_stall').boundary_wall_ms,2100);
 assert.equal(recorder.passes.length,1);assert.equal(recorder.active.inputs.length,1);assert.equal(recorder.active.revision,1);
 assert.equal(events.find(e=>e.kind==='note_off').event_wall_ms,1800,'Off remains present during the paused gap');
});

test('evidence begins with an enabled practice pass and empty assessment does not claim capture',()=>{
 const recorder=new PracticeRecorder();recorder.observeOnset(observation(900));assert.equal(recorder.evidence.events.length,0);
 recorder.begin({wallTime:1000,position:0,startMs:0,endMs:500,timeline,captureEnabled:false});
 assert.equal(Object.hasOwn(recorder.exportData(),'input_evidence'),false);
 begin(recorder,2000);recorder.evidence.cancel({reason:'pagehide',eventWall:2010});
 recorder.observeOnset(observation(2005,{receivedWall:2100}));
 assert.deepEqual(recorder.evidence.events.map(e=>e.kind),['boundary','note_on'],'A boundary is retained even when the onset arrives after cleanup');
});

test('timestamp evidence preserves existing normalization and discloses epoch, clamps and fallback',()=>{
 const clock={now:2000,timeOrigin:1_700_000_000_000};
 for(const [raw,basis,time] of [[1500,'event_monotonic',1500],[clock.timeOrigin+1500,'event_epoch',1500],[2020,'event_clamped',2000],[0,'receipt_fallback',2000],[NaN,'receipt_fallback',2000],[clock.timeOrigin+5000,'receipt_fallback',2000]]){
  const result=eventTimeEvidence(raw,clock);assert.equal(result.timestampBasis,basis);assert.equal(result.eventWall,time);assert.equal(result.eventWall,normalizeEventTime(raw,clock));assert.equal(result.receivedWall,2000);
 }
});

test('evidence cap is visible, never evicts, bounds aliases, and leaves later onset scoring intact',()=>{
 let notices=0;const recorder=new PracticeRecorder({evidenceLimit:2,onEvidenceLimit:()=>notices++});begin(recorder);
 for(let index=0;index<5;index++){
  const event=observation(1100+index,{source:`private-${index}`,generationToken:{}});
  recorder.observeOnset(event,recorder.capture(event));
 }
 recorder.evidence.release(observation(1200,{source:'another-device',generationToken:{}}));
 const exported=recorder.exportData();assert.equal(notices,1);assert.equal(exported.input_evidence.events.length,2);
 assert.equal(exported.input_evidence.truncated,true);assert.equal(exported.input_evidence.omitted_observations,4);assert.equal(exported.input_evidence.first_omitted_received_wall_ms,1102);
 assert.equal(recorder.evidence.sources.size,2);assert.equal(recorder.evidence.generations.size,2);
 assert.equal(exported.passes[0].inputs.length,5);assert.equal(exported.passes[0].revision,5);
 assert.equal(exported.input_evidence.events.at(-1).event_wall_ms,1101);
 assert.equal(INPUT_EVIDENCE_LIMIT,100_000);assert.throws(()=>new InputEvidence({limit:0}));
});
