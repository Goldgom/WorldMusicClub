import {basicKeyAudioHarness} from './basic-key-audio-harness.js';
import {CanonicalAudioCore} from '../web/canonical-audio-core.js';
import {CANONICAL_AUDIO_PROTOCOL} from '../web/canonical-audio-plan.js';
import {canonicalFingerprint} from '../web/canonical-audio-fingerprint.js';
import {CANONICAL_AUDIO_PROFILE,CANONICAL_AUDIO_POLICY} from '../web/canonical-audio-plan.js';
import {LiveToneCore,LIVE_TONE_PROTOCOL} from '../web/live-tone-core.js';

/** Shared Node-only fixture for older app tests. Source and live audio use
 * production DSP cores; no browser worklet or physical output is claimed. */
export function canonicalDomAudio({onCreate=()=>{}}={}){
  const devices=[];
  const param=()=>({value:0,setValueAtTime(value){this.value=value;},linearRampToValueAtTime(){},exponentialRampToValueAtTime(){},setTargetAtTime(){},cancelScheduledValues(){}});
  class AudioContext {
    constructor(){onCreate();devices.push(this);this.state='running';this.sampleRate=8000;this.destination={};this.createdWall=performance.now();this.harness=basicKeyAudioHarness({sampleRate:8000});this.audioWorklet=this.harness.context.audioWorklet;}
    get currentTime(){return this.harness.context.currentTime;}
    set currentTime(seconds){const target=Math.floor(seconds*this.sampleRate);while(this.harness.frame<target)this.harness.renderBlock(Math.min(128,target-this.harness.frame));}
    addEventListener(...args){this.harness.context.addEventListener(...args);}
    removeEventListener(...args){this.harness.context.removeEventListener(...args);}
    async resume(){this.state='running';this.harness.setState('running');}
    createGain(){return{gain:param(),connect(){},disconnect(){}};}
    createOscillator(){return{frequency:{},connect(){},disconnect(){},start(){},stop(){}};}
  }
  class AudioWorkletNode {
    constructor(context,name){const node=context.harness.nodeFactory(name===CANONICAL_AUDIO_PROTOCOL?{Core:CanonicalAudioCore}:name===LIVE_TONE_PROTOCOL?{Core:LiveToneCore}:undefined),post=node.port.postMessage;node.port.postMessage=function(message,...args){if(message.type==='start')context.wallAudioOffset=context.currentTime-(performance.now()-context.createdWall)/1000;return post.call(this,message,...args);};return node;}
  }
  return {AudioContext,AudioWorkletNode,sources:()=>devices.flatMap(device=>device.harness.nodes).filter(node=>node.core?.plan?.protocol===CANONICAL_AUDIO_PROTOCOL),advanceWall(wall){for(const device of devices)device.currentTime=(wall-device.createdWall)/1000+(device.wallAudioOffset||0);}};
}

/** Host-side fixture evidence, never a replacement for Rust acceptance. */
export function syntheticCanonicalProfile(compilation){
  const score=compilation.score,source_note_ids=score.parts.flatMap(part=>part.notes.map(note=>note.id));
  const profile={profile:CANONICAL_AUDIO_PROFILE,policy_id:CANONICAL_AUDIO_POLICY,source_fingerprint:canonicalFingerprint('wmh-canonical-score-v1',score),duration_ms:compilation.timeline.duration_ms,part_ids:score.parts.map(part=>part.id),source_note_ids,source_references:compilation.timeline.notes.reduce((sum,note)=>sum+note.source_note_ids.length,0),occurrences:compilation.timeline.notes.map(note=>({id:note.id,part_index:score.parts.findIndex(part=>part.id===note.part_id),source_indices:note.source_note_ids.map(id=>source_note_ids.indexOf(id)),midi:note.midi,velocity:note.velocity,start_ms:note.start_ms,duration_ms:note.duration_ms}))};
  profile.compiled_fingerprint=canonicalFingerprint(CANONICAL_AUDIO_PROFILE,profile);return profile;
}
