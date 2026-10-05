import test from 'node:test';
import assert from 'node:assert/strict';
import {runInNewContext} from 'node:vm';
import {canonicalPreviewAudioBootstrap,assertCanonicalPreviewOutput,canonicalPreviewAudioCheckpoint} from './browser-canonical-preview-audio.js';
import {fixture} from './frontend-fixtures.js';
import {compileBrowserFixture} from './frontend-browser-compilation-fixture.js';
import {syntheticCanonicalProfile} from './canonical-dom-audio-fixture.js';
import {buildCanonicalAudioPlan,CANONICAL_AUDIO_POLICY} from '../web/canonical-audio-plan.js';

// Synthetic validation records only: these are negative-oracle unit checks,
// never evidence of browser audio, a native MessagePort, or a physical device.
function syntheticOutput() {
  const compilation=compileBrowserFixture(fixture),profile=syntheticCanonicalProfile(compilation);
  const plan=buildCanonicalAudioPlan(compilation,profile,{sampleRate:48000,mode:'listen',acceptedPolicyId:CANONICAL_AUDIO_POLICY,range:{startMs:0,endMs:compilation.timeline.duration_ms},countInMs:0});
  const graph=[{type:'AudioWorkletNode',gain:null},{type:'GainNode',gain:1},{type:'GainNode',gain:.315},{type:'AudioDestinationNode',gain:null}];
  const run={plan:structuredClone(plan),node:{actualAudioWorkletNode:true,contextMatches:true,numberOfInputs:0,numberOfOutputs:1},prepared:{planFingerprint:plan.planFingerprint},started:{planFingerprint:plan.planFingerprint,connected:true,outputContextMatches:true,anchorTime:.1,observedAudioTime:.05,outputGain:.315,graphToDestination:structuredClone(graph)},messages:['ready','started'].map(type=>({type,isTrusted:true,portMatches:true})),pcm:{method:'passive-output-analyser',fftSize:256,graphToDestination:graph,blocks:[{audioTime:.2,peak:.03,rms:.01}]}};
  return{run,compilation,profile};
}
test('canonical lobby audio bootstrap exposes shared passive tools without running a browser or app',()=>{
  const root={};runInNewContext(canonicalPreviewAudioBootstrap,root);
  assert.equal(typeof root.__wmhPreviewAudioTools.observeReceiver,'function');assert.equal(typeof root.__wmhPreviewAudioTools.sampleOffset,'function');assert.equal(typeof root.__wmhPreviewAudioTools.compact,'function');
});
test('canonical lobby output oracle rejects silent, disconnected, forged and changed-source observations',()=>{
  const {run,compilation,profile}=syntheticOutput();assertCanonicalPreviewOutput(run,compilation,profile);
  for(const mutate of [
    value=>value.pcm.blocks.forEach(block=>{block.peak=block.rms=0;}),
    value=>value.pcm.blocks.forEach(block=>block.audioTime=.01),
    value=>value.pcm.graphToDestination.pop(),
    value=>value.started.graphToDestination[2].gain=0,
    value=>value.started.outputGain=0,
    value=>value.pcm.graphToDestination[1].gain=0,
    value=>{value.started.graphToDestination[1].gain=0;value.started.observedAudioTime=.1;},
    value=>{value.started.graphToDestination[1].gain=0;value.started.observedAudioTime=NaN;},
    value=>value.messages[1].isTrusted=false,
    value=>value.messages[0].portMatches=false,
    value=>value.node.actualAudioWorkletNode=false,
    value=>value.plan.notes[0][3]++,
  ]){const changed=structuredClone(run);mutate(changed);assert.throws(()=>assertCanonicalPreviewOutput(changed,compilation,profile));}
});

test('a scheduled receiver gate may be closed before its anchor only when later PCM and all downstream gains are audible',()=>{
  const {run,compilation,profile}=syntheticOutput();run.started.graphToDestination[1].gain=0;
  assertCanonicalPreviewOutput(run,compilation,profile);
  run.pcm.graphToDestination[2].gain=0;assert.throws(()=>assertCanonicalPreviewOutput(run,compilation,profile),/gains must remain audible/);
});
test('pre-assertion preview checkpoints bound PCM and messages while retaining both gate graphs',()=>{
  const {run}=syntheticOutput();run.started.graphToDestination[1].gain=0;run.messages=Array.from({length:30},(_,index)=>({type:'message',index}));run.pcm.blocks=Array.from({length:90},()=>({audioTime:.2,peak:.03,rms:.01}));run.terminals=[];run.rawTerminals=[];
  const before=structuredClone(run),checkpoint=canonicalPreviewAudioCheckpoint({status:{errors:[],graphHistory:{events:[]}},runs:[run]},0,{phase:'playing'});
  assert.equal(checkpoint.run.messages.length,16);assert.equal(checkpoint.run.pcm.blocks.length,64);assert.equal(checkpoint.run.started.graphToDestination[1].gain,0);assert.equal(checkpoint.run.pcm.graphToDestination[1].gain,1);assert.equal(checkpoint.phase,'playing');assert.deepEqual(run,before);
});
