import assert from 'node:assert/strict';
import {validateLiveToneInput} from '../scripts/live-tone-proof.mjs';

const integer=value=>Number.isSafeInteger(value)&&value>=0;
const positive=value=>Number.isFinite(value)&&value>0;
function native(row){for(const key of ['nativeMessage','nativePort','isTrusted','portMatches'])assert.equal(row[key],true,`Native live receipt requires ${key}`);}
function path(receiver,rows,{initial=false}={}){
  assert.ok(Array.isArray(rows)&&rows.length>=3&&rows.length<=16,'The retained live receiver must reach the real destination');
  assert.equal(rows[0].id,receiver.nodeId);assert.equal(rows[0].type,'AudioWorkletNode');assert.equal(rows[1].id,receiver.gateId);assert.equal(rows.at(-1).id,receiver.destinationId);assert.equal(rows.at(-1).type,'AudioDestinationNode');
  for(const row of rows){assert.ok(integer(row.id)&&row.id>0);if(row.type==='GainNode'||row.gain!==null)assert.ok(Number.isFinite(row.gain)&&(initial?row.gain>=0:row.gain>0),'Silence must be measured with an audible connected live path');}
}
function owner(receiver,reference,{initial=false}={}){
  for(const key of ['receiverId','nodeId','gateId','destinationId','generation','sampleRate'])assert.equal(receiver[key],reference[key],`Persistent live ${key} changed`);
  assert.equal(receiver.state,'ready');assert.equal(receiver.disposed,false);assert.equal(receiver.contextState,'running');
  for(const key of ['nativeNode','nativePort','contextMatches','tapConnected'])assert.equal(receiver[key],true);
  assert.equal(receiver.numberOfInputs,0);assert.equal(receiver.numberOfOutputs,1);assert.ok(Number.isFinite(receiver.audioTime));path(reference,receiver.graphToDestination,{initial});
}
function source(value,started){assert.ok(integer(value.activeReceivers)&&integer(value.pendingReceivers));assert.equal(value.started,started,'Navigation must not start or replay source audio');assert.deepEqual(value.errors,[]);assert.equal(value.overflow,false);}

// This is a separate navigation contract: source receivers may be disposed at
// pause, while the actual live node and its fixed, audible output tap must stay
// connected. It does not relax the active-accompaniment live-tone proof.
export function validateLiveToneNavigation(e,{route,release,takeBefore,takeAfter}={}){
  assert.ok(['settings','authoring'].includes(route));assert.ok(['keyup','navigation'].includes(release));
  assert.equal(e.version,1);assert.equal(e.pcmCoverage,'finite-checkpoint-windows');assert.deepEqual(e.expected,{keyCode:'KeyR',midi:60});assert.equal(e.overflow,false);assert.deepEqual(e.errors,[]);
  const {ready,after,initialization}=e,r=ready.receiver,rate=r.sampleRate;
  assert.ok(integer(rate)&&rate>=8000&&rate<=384000);assert.equal(ready.label,'ready');assert.equal(after.label,'after');assert.ok(ready.sequence<after.sequence);
  const within=row=>{assert.ok(integer(row.sequence)&&row.sequence>ready.sequence&&row.sequence<after.sequence);assert.ok(Number.isFinite(row.wallMs)&&row.wallMs>=ready.wallMs&&row.wallMs<=after.wallMs);};
  const checkpoints=e.checkpoints;assert.deepEqual(checkpoints.map(row=>row.label),['navigation','entered','blocked-input','returned','finished']);
  for(const [index,row]of checkpoints.entries()){within(row);if(index)assert.ok(row.sequence>checkpoints[index-1].sequence);assert.equal(row.callCount,1);assert.equal(row.sampling,'sealed','Exhausted or still-open windows cannot certify silence');within(row.closed);assert.equal(row.closed.label,`${row.label}-sealed`);assert.ok(row.sequence<row.closed.sequence&&row.closed.sequence<(checkpoints[index+1]?.sequence??after.sequence));}
  const navigation=checkpoints[0];assert.ok(ready.source.activeReceivers>0,'Begin during the real running human session');assert.equal(ready.source.pendingReceivers,0);
  for(const row of [ready,...checkpoints.flatMap(row=>[row,row.closed]),after]){assert.equal(row.nodes,1,'Cleanup must keep observing the same persistent live node');owner(row.receiver,r);source(row.source,ready.source.started);if(row!==ready&&row!==navigation&&row!==navigation.closed){assert.equal(row.source.activeReceivers,0,'Source playback must stop on navigation');assert.equal(row.source.pendingReceivers,0);assert.ok(row.source.ownedNodes?.length>0,'Actual source receiver disposal must remain observed');for(const node of row.source.ownedNodes){assert.equal(node.connected,false);assert.equal(node.nodeConnections,0);assert.equal(node.gateConnections,0);assert.equal(node.disposed,true);assert.equal(node.disposing,false);assert.equal(node.pendingCommands,0);assert.equal(node.pendingStarts,0);}}}
  assert.ok(after.receiver.audioTime>ready.receiver.audioTime,'A suspended audio clock cannot prove silence');
  native(initialization.ready);assert.equal(initialization.ready.receiverId,r.receiverId);assert.equal(initialization.ready.nodeId,r.nodeId);assert.equal(initialization.ready.record.type,'ready');assert.equal(initialization.ready.record.source,'live-tone');assert.equal(initialization.ready.record.generation,r.generation);assert.equal(initialization.ready.record.sampleRate,rate);
  const init=[initialization.created,initialization.ready,initialization.tapReady,ready];assert.equal(new Set(init.map(row=>row.sequence)).size,4);
  for(const row of init){assert.ok(integer(row.sequence)&&row.sequence>0);assert.ok(Number.isFinite(row.wallMs));}
  for(const row of init.slice(1,3)){assert.ok(initialization.created.sequence<row.sequence&&row.sequence<ready.sequence);assert.ok(initialization.created.wallMs<=row.wallMs&&row.wallMs<=ready.wallMs);}
  owner(initialization.tapReady.receiver,r,{initial:true});source(initialization.tapReady.source,0);assert.equal(initialization.tapReady.source.activeReceivers,0);assert.equal(initialization.tapReady.source.pendingReceivers,0);
  assert.equal(e.inputs.length,4,'One sounded key pair and one blocked key pair required');const [down,up,blockedDown,blockedUp]=e.inputs;
  for(const [index,input]of e.inputs.entries()){within(input);assert.equal(input.type,index%2?'keyup':'keydown');assert.equal(input.code,'KeyR');assert.equal(input.isTrusted,true);assert.equal(input.repeat,false);assert.ok(Number.isFinite(input.eventTime)&&input.eventTime>=0);if(index)assert.ok(input.sequence>e.inputs[index-1].sequence);}
  assert.equal(down.surface,'stage-title');assert.ok(up.eventTime>=down.eventTime+30,'A held human note must really sound');
  assert.ok(blockedDown.sequence>checkpoints[1].sequence&&blockedUp.sequence<checkpoints[2].sequence);assert.equal(blockedDown.surface,null,'The forbidden key must be typed off the performance surface');
  assert.equal(e.calls.length,1,'No navigation, forbidden key or return may replay live input');const call=e.calls[0];within(call);assert.ok(down.sequence<call.sequence&&call.sequence<up.sequence);assert.equal(call.inputSequence,down.sequence);assert.equal(call.receiverId,r.receiverId);assert.equal(call.generation,r.generation);assert.ok(integer(call.token)&&call.token>0);assert.match(call.id,/^manual:key:keyboard-[1-9][0-9]*:[1-9][0-9]*:KeyR$/);assert.equal(call.midi,60);assert.equal(call.duration,null);assert.equal(call.delay,0);assert.ok(positive(call.velocity)&&call.velocity<=127);source(call.source,ready.source.started);
  assert.equal(e.receipts.length,2,'Exactly the original native started and ended token must be retained');const [start,end]=e.receipts;
  assert.equal(start.record.type,'started');assert.equal(end.record.type,'ended');assert.ok(call.sequence<start.sequence&&start.sequence<end.sequence);
  for(const row of [start,end]){within(row);native(row);assert.equal(row.receiverId,r.receiverId);assert.equal(row.nodeId,r.nodeId);const token=row.record;for(const key of ['generation','token','id','midi'])assert.equal(token[key],call[key]);assert.equal(token.source,'live-tone');assert.equal(token.kind,'note');assert.equal(token.key,60);assert.equal(token.sampleRate,rate);assert.ok(integer(token.requestedStartFrame)&&integer(token.actualStartFrame)&&token.actualStartFrame>=token.requestedStartFrame);}
  const s=start.record,t=end.record;assert.equal(s.frame,s.actualStartFrame);assert.equal(s.actualEndFrame,null);for(const key of ['nonzeroSamples','renderedSamples','pcmEnergy','pcmPeak'])assert.equal(s[key],0);
  assert.equal(t.frame,t.actualEndFrame);assert.equal(t.requestedStartFrame,s.requestedStartFrame);assert.equal(t.actualStartFrame,s.actualStartFrame);assert.ok(integer(t.actualEndFrame)&&t.actualEndFrame>t.actualStartFrame);assert.equal(t.renderedSamples,t.actualEndFrame-t.actualStartFrame);assert.ok(integer(t.nonzeroSamples)&&t.nonzeroSamples>0&&t.nonzeroSamples<=t.renderedSamples);assert.ok(positive(t.pcmPeak)&&positive(t.pcmEnergy));assert.ok(integer(t.firstNonzeroFrame)&&t.firstNonzeroFrame>=t.actualStartFrame&&t.firstNonzeroFrame<t.actualEndFrame);assert.equal(t.lastRenderedFrame,t.actualEndFrame-1);
  if(release==='keyup'){assert.equal(t.reason,'release');assert.ok(up.sequence<end.sequence&&end.sequence<navigation.sequence,'Original keyup must finish the voice before navigation');}
  else{assert.ok(['silence','stopped'].includes(t.reason),'Held-key navigation must cancel the native voice');assert.ok(navigation.sequence<end.sequence&&navigation.sequence<up.sequence,'Cleanup must happen after navigation begins');}
  assert.ok(Array.isArray(e.actions)&&e.actions.length<=32);for(const action of e.actions){within(action);assert.equal(action.isTrusted,true);assert.ok(['pointerdown','click'].includes(action.type));assert.ok(Number.isFinite(action.eventTime));}
  if(release==='navigation'){const pointer=e.actions.find(row=>row.type==='pointerdown'&&row.control===(route==='settings'?'settings-button':'back-to-library'));assert.ok(pointer&&navigation.sequence<pointer.sequence&&pointer.sequence<end.sequence&&end.sequence<up.sequence,'The trusted navigation pointer must cancel the held tone before the later physical keyup');}
  const controls=route==='settings'?['settings-button']:['back-to-library','lobby-home','home-song-authoring'];let prior=navigation.sequence;
  for(const control of controls){const click=e.actions.find(row=>row.type==='click'&&row.control===control&&row.sequence>prior&&row.sequence<checkpoints[1].sequence);assert.ok(click,`Actual trusted ${control} navigation required`);prior=click.sequence;}
  const pcm=(value,before)=>{assert.equal(value.method,'passive-fixed-live-gate-analyser');assert.equal(value.fftSize,16384);assert.ok(value.blocks.length>0&&value.blocks.length<=64);let previous=-1;for(const block of value.blocks){within(block);assert.ok(block.sequence<before);assert.equal(block.contextState,'running');assert.equal(block.samples,16384);assert.equal(block.tapConnected,true,'Every PCM block needs its fixed live tap');assert.ok(Number.isFinite(block.audioTime)&&block.audioTime>=previous);previous=block.audioTime;assert.ok(Number.isFinite(block.peak)&&block.peak>=0&&Number.isFinite(block.energy)&&block.energy>=0);assert.ok(integer(block.nonzeroSamples)&&block.nonzeroSamples<=block.samples);path(r,block.graphToDestination);}};
  pcm(e.pcm,navigation.sequence);assert.ok(e.pcm.blocks.some(block=>block.sequence>call.sequence&&block.audioTime*rate>=t.firstNonzeroFrame&&block.audioTime*rate-block.samples<=t.lastRenderedFrame&&block.peak>1e-6&&block.energy>1e-10&&block.nonzeroSamples>0),'Positive connected PCM must overlap this exact human token before navigation');
  let established=null;
  for(const [index,row]of checkpoints.entries()){
    pcm(row.pcm,row.closed.sequence);assert.ok(row.pcm.blocks.every(block=>block.sequence>row.sequence));
    const last=row.pcm.blocks.at(-1);assert.ok(row.closed.wallMs-last.wallMs>=0&&row.closed.wallMs-last.wallMs<=100,'A window must close on a fresh PCM sample');assert.ok(row.closed.receiver.audioTime-last.audioTime>=0&&row.closed.receiver.audioTime-last.audioTime<=.1,'Window completion cannot reuse old audio samples');
    if(index===0&&release!=='keyup')continue;
    // Drain once. After the first established silent block, every later
    // observed block is evidence: a new checkpoint grants no fresh grace.
    const quietFrame=Math.max(row.receiver.audioTime*rate,t.actualEndFrame)+row.pcm.fftSize+256;
    const blocks=established?row.pcm.blocks:row.pcm.blocks.filter(block=>block.audioTime*rate>=quietFrame);
    assert.ok(blocks.length>=3&&blocks.at(-1).audioTime-blocks[0].audioTime>=.1,'Silence needs a drained FFT window and at least 100 ms of advancing-clock observations');
    established??={sequence:blocks[0].sequence,audioTime:blocks[0].audioTime};
    for(const block of blocks){assert.equal(block.peak,0,'Live output leaked after established silence');assert.equal(block.energy,0);assert.equal(block.nonzeroSamples,0);}
  }
  assert.deepEqual(e.silenceEstablished,established,'The original silence-established boundary must survive every checkpoint');
  const last=checkpoints.at(-1).pcm.blocks.at(-1);assert.ok(after.wallMs-last.wallMs>=0&&after.wallMs-last.wallMs<=100,'Finish requires a fresh final PCM sample');assert.ok(after.receiver.audioTime-last.audioTime>=0&&after.receiver.audioTime-last.audioTime<=.1,'Finish cannot certify a later audio time from a stopped sample budget');
  validateLiveToneInput(takeBefore,e);assert.deepEqual(takeAfter,takeBefore,'Navigation, blocked input and returning to the stage must preserve the complete paused take');
  const on=takeBefore.input_evidence.events.find(event=>event.kind==='note_on'),off=takeBefore.input_evidence.events.filter(event=>event.kind==='note_off');assert.equal(off.length,1);assert.equal(off[0].source_id,on.source_id);assert.equal(off[0].encoding,'key_up');assert.equal(off[0].raw_timestamp_ms,up.eventTime,'The real physical keyup retains its own DOM timestamp');assert.equal(takeBefore.passes.length,1);assert.equal(takeBefore.passes[0].inputs.length,1);assert.equal(takeBefore.passes[0].inputs[0].midi,60);
  return e;
}
