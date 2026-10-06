import assert from 'node:assert/strict';
const integer=value=>Number.isSafeInteger(value)&&value>=0;
const positive=value=>Number.isFinite(value)&&value>0;
const native=row=>{assert.equal(row.nativeMessage,true,'Actual native MessageEvent required');assert.equal(row.nativePort,true,'Actual native MessagePort required');assert.equal(row.isTrusted,true,'Live-tone processor receipt must be trusted');assert.equal(row.portMatches,true,'Live-tone processor receipt must come from the owned native port');};
const running=value=>{assert.ok(value?.activeReceivers>0,'Source accompaniment must remain running through the real key');assert.deepEqual(value.errors,[]);assert.equal(value.overflow,false);};
function graph(receiver,path,{initialization=false}={}){assert.ok(Array.isArray(path)&&path.length>=3&&path.length<=16,'Live-tone output must reach the actual destination');assert.equal(path[0].id,receiver.nodeId);assert.equal(path[0].type,'AudioWorkletNode');assert.equal(path[1].id,receiver.gateId);assert.equal(path.at(-1).id,receiver.destinationId);assert.equal(path.at(-1).type,'AudioDestinationNode');for(const row of path){assert.ok(integer(row.id)&&row.id>0);if(row.type==='GainNode'||row.gain!==null)assert.ok(Number.isFinite(row.gain)&&(initialization?row.gain>=0:row.gain>0),initialization?'Initialized live output gain must be finite and nonnegative':'Live output path must not be muted');}}
export function validateLiveToneEvidence(e,{keyCode,midi,transport}={}) {
 assert.equal(e?.version,1,'Genuine human live-tone evidence required');assert.deepEqual(e.expected,{keyCode,midi});assert.equal(e.overflow,false);assert.deepEqual(e.errors,[]);
 const {ready,after,initialization}=e;assert.equal(ready.label,'ready');assert.equal(after.label,'after');assert.ok(ready.sequence<after.sequence);assert.equal(ready.nodes,1);assert.equal(after.nodes,1,'Key must reuse its persistent receiver');assert.equal(ready.graphRevision,after.graphRevision,'Key must not connect or disconnect any audio nodes');
 const receiver=ready.receiver;for(const boundary of [ready,after]){assert.ok(Number.isFinite(boundary.wallMs));running(boundary.source);const r=boundary.receiver;assert.equal(r.receiverId,receiver.receiverId);assert.equal(r.nodeId,receiver.nodeId);assert.equal(r.gateId,receiver.gateId);assert.equal(r.destinationId,receiver.destinationId);assert.equal(r.generation,receiver.generation);assert.equal(r.state,'ready');assert.equal(r.disposed,false);assert.equal(r.contextState,'running');assert.equal(r.sampleRate,receiver.sampleRate);assert.ok(integer(r.sampleRate)&&r.sampleRate>=8000&&r.sampleRate<=384000);assert.equal(r.nativeNode,true);assert.equal(r.nativePort,true);assert.equal(r.contextMatches,true);assert.equal(r.numberOfInputs,0);assert.equal(r.numberOfOutputs,1);assert.equal(r.tapConnected,true);graph(r,r.graphToDestination);}
 assert.equal(ready.source.started,after.source.started,'Source receiver must not be replaced during key');assert.ok(after.receiver.audioTime>=ready.receiver.audioTime);
 native(initialization.ready);assert.equal(initialization.ready.record.type,'ready');assert.equal(initialization.ready.record.source,'live-tone');assert.equal(initialization.ready.record.generation,receiver.generation);assert.equal(initialization.ready.record.sampleRate,receiver.sampleRate);assert.equal(initialization.ready.receiverId,receiver.receiverId);assert.equal(initialization.ready.nodeId,receiver.nodeId);
 // The original port handler can resolve create(), whose continuation fixes
 // the tap, before a later passive listener observes that same native ACK.
 // Both observations must follow creation and precede the active-source key;
 // their relative listener/microtask order is not an audio startup order.
 const initialized=[initialization.created,initialization.ready,initialization.tapReady,ready];
 for(const row of initialized){assert.ok(integer(row.sequence)&&row.sequence>0);assert.ok(Number.isFinite(row.wallMs));}
 assert.equal(new Set(initialized.map(row=>row.sequence)).size,4,'Initialization observations must have distinct sequence identities');
 for(const row of [initialization.ready,initialization.tapReady]){assert.ok(initialization.created.sequence<row.sequence&&row.sequence<ready.sequence,'Ready ACK and fixed tap must both follow creation and precede the active-source key boundary');assert.ok(initialization.created.wallMs<=row.wallMs&&row.wallMs<=ready.wallMs,'Initialization observation clock must preserve its partial order');}
 const tap=initialization.tapReady.receiver;assert.ok(tap,'Actual ready-promise owner state required at fixed tap initialization');
 for(const key of ['receiverId','nodeId','gateId','destinationId','generation','sampleRate'])assert.equal(tap[key],receiver[key],`Fixed tap owner ${key} must match its native receiver`);
 // A scheduled gate value can still read zero in create's continuation,
 // before the rendering quantum advances. This is connection evidence;
 // every actual key boundary and PCM block still requires positive gain.
 assert.equal(tap.state,'ready');assert.equal(tap.disposed,false);assert.equal(tap.contextState,'running');for(const key of ['nativeNode','nativePort','contextMatches','tapConnected'])assert.equal(tap[key],true);graph(tap,tap.graphToDestination,{initialization:true});
 assert.ok(initialization.tapReady.graphRevision<=ready.graphRevision);assert.equal(initialization.tapReady.source?.started,0,'Fixed live tap must precede every accompaniment start');assert.equal(initialization.tapReady.source.activeReceivers,0);assert.equal(initialization.tapReady.source.pendingReceivers,0);assert.deepEqual(initialization.tapReady.source.errors,[]);assert.equal(initialization.tapReady.source.overflow,false);
 const inWindow=row=>{assert.ok(integer(row.sequence)&&row.sequence>ready.sequence&&row.sequence<after.sequence,'Live evidence must be inside the original key boundary');assert.equal(row.graphRevision,ready.graphRevision,'Graph edit during live input');assert.ok(Number.isFinite(row.wallMs)&&row.wallMs>=ready.wallMs&&row.wallMs<=after.wallMs);};
 assert.equal(e.inputs.length,2,'Exactly one original trusted down/up pair required');const [down,up]=e.inputs;assert.equal(down.type,'keydown');assert.equal(up.type,'keyup');assert.ok(down.sequence<up.sequence);for(const input of e.inputs){inWindow(input);assert.equal(input.code,keyCode);assert.equal(input.isTrusted,true);assert.equal(input.repeat,false);assert.equal(input.surface,'stage-title');assert.ok(Number.isFinite(input.eventTime)&&input.eventTime>=0);running(input.source);const actual=transport?.rows.filter(row=>row.event?.type===input.type&&row.event?.code===keyCode);assert.equal(actual?.length,1,'Live sound must bind original transport input');assert.equal(actual[0].event.trusted,true);assert.equal(actual[0].event.surface,'stage-title');assert.equal(actual[0].event.repeat,false);assert.equal(actual[0].event.eventTime,input.eventTime,'Live sound must retain the exact original trusted timestamp');}
 assert.ok(up.eventTime>=down.eventTime+30,'Positive live PCM uses a held key; instantaneous cancellation is tested separately');
 assert.equal(e.calls.length,1,'Only the one trusted human sound call is admissible');const call=e.calls[0];inWindow(call);assert.ok(call.sequence>down.sequence&&call.sequence<up.sequence);assert.equal(call.inputSequence,down.sequence);assert.equal(call.receiverId,receiver.receiverId);assert.equal(call.generation,receiver.generation);assert.ok(integer(call.token)&&call.token>0);assert.match(call.id,new RegExp(`^manual:key:keyboard-[1-9][0-9]*:[1-9][0-9]*:${keyCode}$`));assert.equal(call.midi,midi);assert.equal(call.duration,null);assert.equal(call.delay,0);assert.ok(positive(call.velocity)&&call.velocity<=127);running(call.source);
 assert.ok(Array.isArray(e.receipts)&&e.receipts.length<=128);const receipts=e.receipts.filter(row=>row.record.kind==='note');assert.equal(receipts.length,2,'Actual started and terminal receipts required for precisely this human token');const [start,end]=receipts;assert.equal(start.record.type,'started');assert.equal(end.record.type,'ended');assert.ok(call.sequence<start.sequence&&start.sequence<end.sequence&&up.sequence<end.sequence);
 for(const row of receipts){inWindow(row);native(row);assert.equal(row.receiverId,receiver.receiverId);assert.equal(row.nodeId,receiver.nodeId);const r=row.record;assert.equal(r.source,'live-tone');assert.equal(r.generation,call.generation);assert.equal(r.token,call.token,'Old/canceled/retriggered tail cannot prove this key');assert.equal(r.id,call.id);assert.equal(r.midi,midi);assert.equal(r.key,midi);assert.equal(r.kind,'note');assert.equal(r.sampleRate,receiver.sampleRate);assert.ok(integer(r.requestedStartFrame)&&integer(r.actualStartFrame));assert.ok(r.actualStartFrame>=r.requestedStartFrame);assert.ok(integer(r.frame));}
 const s=start.record,t=end.record;assert.equal(s.frame,s.actualStartFrame);assert.equal(t.frame,t.actualEndFrame);assert.equal(s.actualEndFrame,null);assert.equal(s.nonzeroSamples,0);assert.equal(s.renderedSamples,0);assert.equal(s.pcmEnergy,0);assert.equal(s.pcmPeak,0);assert.equal(t.requestedStartFrame,s.requestedStartFrame);assert.equal(t.actualStartFrame,s.actualStartFrame);assert.ok(integer(t.actualEndFrame)&&t.actualEndFrame>t.actualStartFrame);assert.ok(integer(t.renderedSamples)&&t.renderedSamples>0&&t.renderedSamples===t.actualEndFrame-t.actualStartFrame);assert.ok(integer(t.nonzeroSamples)&&t.nonzeroSamples>0&&t.nonzeroSamples<=t.renderedSamples);assert.ok(positive(t.pcmPeak)&&positive(t.pcmEnergy),'Terminal token must report actual nonzero rendered PCM');assert.ok(integer(t.firstNonzeroFrame)&&t.firstNonzeroFrame>=t.actualStartFrame&&t.firstNonzeroFrame<t.actualEndFrame);assert.ok(integer(t.lastRenderedFrame)&&t.lastRenderedFrame>=t.firstNonzeroFrame&&t.lastRenderedFrame===t.actualEndFrame-1);assert.equal(t.reason,'release','Only the original key release may finish this human token');
 assert.equal(e.pcm.method,'passive-fixed-live-gate-analyser');assert.equal(e.pcm.fftSize,16384);assert.ok(e.pcm.blocks.length>0&&e.pcm.blocks.length<=64);let heard=false;for(const block of e.pcm.blocks){inWindow(block);assert.equal(block.contextState,'running');assert.equal(block.samples,16384);assert.ok(Number.isFinite(block.audioTime));assert.ok(Number.isFinite(block.peak)&&block.peak>=0&&Number.isFinite(block.energy)&&block.energy>=0);assert.ok(integer(block.nonzeroSamples)&&block.nonzeroSamples<=block.samples);graph(receiver,block.graphToDestination);if(block.sequence>call.sequence&&block.audioTime*receiver.sampleRate>=t.firstNonzeroFrame&&(block.audioTime*receiver.sampleRate-block.samples)<=t.lastRenderedFrame&&block.peak>1e-6&&block.energy>1e-10&&block.nonzeroSamples>0)heard=true;}
 assert.equal(heard,true,'Destination-connected live output must contain real PCM overlapping the exact human token');return e;
}
export function validateLiveToneCleanup(value){assert.deepEqual(value,{restored:true,overflow:false,errors:[],cleanupErrors:[]},'Live-tone observer must restore every native method and listener');}

/** Supplement the original live-tone/transport proof with its one released
 * checkpoint, captured before source playback pauses. This verifies retained
 * finite observations, not continuous PCM coverage or actual native provenance.
 * The original observer's sealed window and final boundary must both be fresh.
 * The renderer allows 15 seconds to establish silence; this contract allows
 * 30 seconds for the complete observation and at most a 10-second held note.
 * Callers still validate the original input, recipe, take and host separately.
 */
export function validateLiveToneReleasedCheckpoint(e) {
 assert.equal(e?.version,1);assert.equal(e.pcmCoverage,'finite-checkpoint-windows');assert.equal(e.overflow,false);assert.deepEqual(e.errors,[]);
 assert.ok(Array.isArray(e.checkpoints)&&e.checkpoints.length===1,'Exactly one original released checkpoint required');
 const {ready,after}=e,row=e.checkpoints[0],closed=row.closed,r=ready.receiver,rate=r.sampleRate;
 assert.equal(ready.label,'ready');assert.equal(after.label,'after');assert.equal(row.label,'released');assert.equal(row.callCount,1);
 assert.equal(row.sampling,'sealed','Only a sealed released window can prove silence');assert.equal(closed?.label,'released-sealed');
 assert.ok(integer(rate)&&rate>=8000&&rate<=384000);
 const identities=['receiverId','nodeId','gateId','destinationId','generation','sampleRate'];
 for(const key of identities)assert.ok(integer(r[key])&&r[key]>0,`Original live ${key} must be a positive integer`);
 const audible=path=>{graph(r,path);assert.equal(path[1].type,'GainNode');assert.deepEqual(path.map(node=>[node.id,node.type]),r.graphToDestination.map(node=>[node.id,node.type]),'Released output must retain the original connected path');};
 const source=value=>{running(value);assert.ok(integer(value.activeReceivers)&&value.activeReceivers>0);assert.equal(value.pendingReceivers,0);assert.ok(integer(value.started)&&value.started>0);assert.equal(value.started,ready.source.started,'Source accompaniment must not restart before the released observation finishes');};
 const observations=[];
 const observe=value=>{assert.ok(integer(value.sequence)&&value.sequence>0);assert.ok(Number.isFinite(value.wallMs)&&value.wallMs>=0);assert.equal(value.graphRevision,ready.graphRevision,'Released observation must retain the original graph');observations.push(value);};
 for(const boundary of [ready,row,closed,after]){
  observe(boundary);assert.equal(boundary.nodes,1,'Released observation must retain its one persistent receiver');source(boundary.source);
  const receiver=boundary.receiver;for(const key of identities)assert.equal(receiver[key],r[key],`Released live ${key} must retain the original owner`);
  assert.equal(receiver.state,'ready');assert.equal(receiver.disposed,false);assert.equal(receiver.contextState,'running');
  for(const key of ['nativeNode','nativePort','contextMatches','tapConnected'])assert.equal(receiver[key],true);
  assert.equal(receiver.numberOfInputs,0);assert.equal(receiver.numberOfOutputs,1);assert.ok(Number.isFinite(receiver.audioTime)&&receiver.audioTime>=0);audible(receiver.graphToDestination);
 }
 assert.ok(integer(ready.graphRevision));assert.ok(ready.sequence<row.sequence&&row.sequence<closed.sequence&&closed.sequence<after.sequence,'Released, sealed and final boundaries must retain their original order');
 assert.ok(after.wallMs-ready.wallMs<=30000&&after.receiver.audioTime-r.audioTime<=30,'Live observation must remain within its finite 30-second budget');
 assert.ok(closed.wallMs-row.wallMs<=15000&&closed.receiver.audioTime-row.receiver.audioTime<=15,'Released observation exceeds its finite 15-second wait');
 assert.ok(Array.isArray(e.inputs)&&e.inputs.length===2,'Exactly one original down/up pair must precede release');
 assert.ok(Array.isArray(e.calls)&&e.calls.length===1,'Only the original human voice may inhabit the released window');
 assert.ok(Array.isArray(e.receipts)&&e.receipts.length===2,'The original started and ended receipts must establish release');
 const [down,up]=e.inputs,call=e.calls[0],[start,end]=e.receipts,t=end.record;
 assert.equal(down.type,'keydown');assert.equal(up.type,'keyup');
 for(const input of e.inputs){observe(input);assert.equal(input.code,e.expected.keyCode);assert.equal(input.isTrusted,true);assert.equal(input.repeat,false);assert.equal(input.surface,'stage-title');assert.ok(Number.isFinite(input.eventTime)&&input.eventTime>=0);source(input.source);}
 assert.ok(up.eventTime-down.eventTime>=30&&up.eventTime-down.eventTime<=10000,'The original held key must stay within its 10-second note budget');
 observe(call);source(call.source);assert.equal(call.inputSequence,down.sequence);assert.equal(call.receiverId,r.receiverId);assert.equal(call.generation,r.generation);assert.ok(integer(call.token)&&call.token>0);
 assert.equal(start.record.type,'started');assert.equal(t.type,'ended');assert.equal(t.reason,'release');
 assert.ok(down.sequence<call.sequence&&call.sequence<start.sequence&&start.sequence<up.sequence&&up.sequence<end.sequence&&end.sequence<row.sequence,'Released silence must follow this exact original key and native terminal receipt');
 for(const receipt of [start,end]){observe(receipt);native(receipt);assert.equal(receipt.receiverId,r.receiverId);assert.equal(receipt.nodeId,r.nodeId);const record=receipt.record;for(const key of ['generation','token','id','midi'])assert.equal(record[key],call[key]);assert.equal(record.source,'live-tone');assert.equal(record.kind,'note');assert.equal(record.sampleRate,rate);assert.equal(record.key,e.expected.midi);}
 assert.ok(integer(t.actualStartFrame)&&integer(t.actualEndFrame)&&t.actualEndFrame>t.actualStartFrame);assert.equal(t.frame,t.actualEndFrame);assert.equal(t.actualStartFrame,start.record.actualStartFrame);
 assert.ok(t.actualStartFrame>=Math.floor(r.audioTime*rate)&&t.actualEndFrame<=Math.ceil(row.receiver.audioTime*rate)+256&&t.actualEndFrame<=Math.ceil(after.receiver.audioTime*rate),'Original native note must fit the released boundary within its rendering allowance');
 assert.ok(t.actualEndFrame-t.actualStartFrame<=rate*10+Math.ceil(.012*rate),'Original note exceeds the 10-second hold and 12 ms release bound');
 const pcm=(value,before,afterBoundary)=>{
  assert.equal(value.method,'passive-fixed-live-gate-analyser');assert.equal(value.fftSize,16384);assert.ok(Array.isArray(value.blocks)&&value.blocks.length>0&&value.blocks.length<=64,'Each fixed-tap window needs a bounded set of actual PCM blocks');
  let previous=before;
  for(const block of value.blocks){
   observe(block);assert.ok(block.sequence>previous.sequence&&block.sequence<afterBoundary.sequence,'PCM blocks must retain their ordered window sequence');
   assert.equal(block.contextState,'running');assert.equal(block.tapConnected,true);assert.equal(block.samples,16384);
   assert.ok(Number.isFinite(block.audioTime)&&block.audioTime>=before.receiver.audioTime&&block.audioTime<=afterBoundary.receiver.audioTime,'PCM audio time must be inside its original observation window');
   assert.ok(Number.isFinite(block.peak)&&block.peak>=0&&Number.isFinite(block.energy)&&block.energy>=0);assert.ok(integer(block.nonzeroSamples)&&block.nonzeroSamples<=block.samples);audible(block.graphToDestination);previous=block;
  }
 };
 pcm(e.pcm,ready,row);pcm(row.pcm,row,closed);
 assert.ok(e.pcm.blocks.some(block=>block.sequence>call.sequence&&block.audioTime*rate>=t.firstNonzeroFrame&&block.audioTime*rate-block.samples<=t.lastRenderedFrame&&block.peak>1e-6&&block.energy>1e-10&&block.nonzeroSamples>0),'Original fixed-tap PCM must overlap the same released native token');
 observations.sort((a,b)=>a.sequence-b.sequence);
 assert.equal(observations[0],ready);assert.equal(observations.at(-1),after);
 let previousAudio=ready;
 const audioTime=value=>value.receiver?.audioTime??value.audioTime;
 // Running AudioContext observations may straddle rendering quanta. Permit
 // clock jitter without letting a finite wall window certify arbitrary audio
 // times. Sampling gaps remain permitted; no continuous PCM claim is made.
 const clockSlack=.1+256/rate;
 for(const [index,value]of observations.entries()){
  if(index){const previous=observations[index-1];assert.ok(value.sequence>previous.sequence,'Every observation must retain a distinct original sequence');assert.ok(value.wallMs>=previous.wallMs,'Observation wall times must follow their original sequence');}
  if(audioTime(value)!==undefined){const elapsed=audioTime(value)-audioTime(previousAudio);assert.ok(elapsed>=0&&elapsed<=(value.wallMs-previousAudio.wallMs)/1000+clockSlack,'Audio observations must advance within their finite wall-clock window');assert.ok(audioTime(value)-r.audioTime<=(value.wallMs-ready.wallMs)/1000+clockSlack,'Audio observations cannot outpace the original wall-clock window');previousAudio=value;}
 }
 const quietFrame=Math.max(row.receiver.audioTime*rate,t.actualEndFrame)+row.pcm.fftSize+256,quiet=row.pcm.blocks.filter(block=>block.audioTime*rate>=quietFrame);
 assert.ok(quiet.length>=3&&quiet.at(-1).audioTime-quiet[0].audioTime>=.1,'Released silence needs a drained FFT window and at least 100 ms of advancing-clock observations');
 for(const block of quiet){assert.equal(block.peak,0,'Live output leaked after the original release drain');assert.equal(block.energy,0);assert.equal(block.nonzeroSamples,0);}
 assert.deepEqual(e.silenceEstablished,{sequence:quiet[0].sequence,audioTime:quiet[0].audioTime},'Original silenceEstablished must bind the first drained sample');
 const last=row.pcm.blocks.at(-1);
 for(const boundary of [closed,after]){assert.ok(boundary.wallMs-last.wallMs>=0&&boundary.wallMs-last.wallMs<=100,'Released seal and finish require a fresh final PCM sample');assert.ok(boundary.receiver.audioTime-last.audioTime>=0&&boundary.receiver.audioTime-last.audioTime<=.1,'Released seal and finish cannot reuse old audio samples');}
 return e;
}
// Scoring remains derived solely from the retained input event. DSP frames and
// PCM values may prove sound, but never supply a captured performance timestamp.
export function validateLiveToneInput(take,e){
 const onsets=take.input_evidence?.events.filter(event=>event.kind==='note_on');assert.equal(onsets?.length,1);const input=onsets[0],call=e.calls[0],down=e.inputs.find(input=>input.type==='keydown');assert.equal(input.input_kind,'typing_keyboard');assert.equal(input.encoding,'key_down');assert.equal(input.raw_timestamp_ms,down.eventTime,'Scored input and live tone must retain the same original DOM timestamp');assert.ok(['event_monotonic','event_epoch','event_clamped'].includes(input.timestamp_basis));assert.equal(input.midi,call.midi);assert.equal(input.velocity,call.velocity);assert.ok(take.input_evidence.events.every(event=>!['started','ended'].includes(event.kind)&&event.source!=='live-tone'),'Sound receipts must never enter recorded input');return input;
}
