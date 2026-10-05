import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import {webcrypto} from 'node:crypto';
import {CanonicalAudioReceiver} from '../web/canonical-audio-receiver.js';
import {CanonicalAudioCore} from '../web/canonical-audio-core.js';

const source=readFileSync(new URL('../crates/desktop-shell/reference-acceptance.js',import.meta.url),'utf8');
const observerSource=source.slice(source.indexOf('async function observeBasicKeyReceiver('),source.indexOf('// End shared audio-thread observer.'));
const canonicalSource=readFileSync(new URL('../crates/desktop-shell/canonical-practice-acceptance.js',import.meta.url),'utf8').split('(() => {')[0];
const helpers=runInNewContext(canonicalSource+';({offset:canonicalPracticeSampleOffsetFrames,compact:compactCanonicalPracticeAudio});',{structuredClone});

// Deterministic Node-only port/graph/rAF harness around the production receiver,
// plan and DSP core. No browser, device, native trust or actual-app proof.
export async function observeCanonicalPcm(plan,{legacy=false,muted=false,disconnected=false,zero=false,positionMs,rafHz=240,ReceiverClass=CanonicalAudioReceiver,Core=CanonicalAudioCore,canonical=true,earlyGraph=false,connectBeforeObserver=false,disconnectBeforeObserver=false,foreignDestination=false}={}){
 let frame=0,serial=0,node;const frames=new Map(),timers=new Map(),messages=[],samples=[],calls=[];
 class AudioNode extends EventTarget{constructor(context){super();this.context=context;}connect(target){return target;}disconnect(){}}
 class AudioDestinationNode extends AudioNode{}
 class GainNode extends AudioNode{constructor(context){super(context);this.gain={value:1,setValueAtTime(value){this.value=value;},cancelScheduledValues(){}};}}
 class AudioWorkletNode extends AudioNode{
  constructor(context){
   super(context);this.numberOfInputs=0;this.numberOfOutputs=1;this.port=new EventTarget();this.port.start=()=>{};this.port.close=()=>{};
   this.core=new Core(plan.sampleRate,{emit:(message,transfer=[])=>{
    const data=structuredClone(message,{transfer});messages.push(data);
    queueMicrotask(()=>{const event=new Event('message');event.data=data;this.port.dispatchEvent(event);this.port.onmessage?.(event);});
   }});
   this.port.postMessage=(message,transfer=[])=>{
    const copy=structuredClone(message,{transfer});calls.push(copy.type);
    queueMicrotask(()=>{this.core.handleMessage(copy,frame);while(this.core.state==='preparing')render(128);});
   };
  }
 }
 const context=new EventTarget();Object.assign(context,{sampleRate:plan.sampleRate,state:'running',currentTime:0,audioWorklet:{async addModule(){}},createGain:()=>new GainNode(context),createAnalyser(){const analyser=new AudioNode(context);analyser.getFloatTimeDomainData=values=>{values.fill(0);if(!zero)values.set(samples.map(value=>value*output.gain.value),values.length-samples.length);};return analyser;}});
 context.destination=new AudioDestinationNode(context);const output=new GainNode(context);output.gain.value=muted?0:1;
 function render(size){const block=new Float32Array(size);node.core.process([block],frame);samples.push(...block);if(samples.length>256)samples.splice(0,samples.length-256);frame+=size;context.currentTime=frame/plan.sampleRate;}
 class Receiver extends ReceiverClass{
  prepare(...args){this.prepareArgs=args;return this.preparePromise=super.prepare(...args);}
  start(...args){this.startArgs=args;return this.startPromise=super.start(...args);}
 }
 const originalPrepare=Receiver.prototype.prepare,originalStart=Receiver.prototype.start,originalConnect=AudioNode.prototype.connect;
 const root={AudioNode,AudioWorkletNode,crypto:webcrypto,performance:{now:()=>context.currentTime*1000},requestAnimationFrame:callback=>{const id=++serial;frames.set(id,callback);return id;},cancelAnimationFrame:id=>{frames.delete(id);}};
 const observe=runInNewContext(observerSource+';observeBasicKeyReceiver;',{structuredClone,Float32Array,Uint8Array});
 const graphObserver=earlyGraph?await observe({},{root,graphOnly:true}):undefined;
 if(connectBeforeObserver&&!disconnected)output.connect(foreignDestination?new AudioDestinationNode(context):context.destination);
 if(disconnectBeforeObserver)output.disconnect();
 const observer=await observe({},{Receiver,root,graphObserver,...(canonical?{readStartFrame:n=>n[1],readEndFrame:n=>n[2],...(!legacy?{readSampleOffsetFrames:helpers.offset}:{})}:{})});
 let receiver;
 try{
  if(!connectBeforeObserver&&!disconnected)output.connect(context.destination);
  receiver=await Receiver.create(context,output,{nodeFactory:()=>node=new AudioWorkletNode(context),setTimer:callback=>{const id=++serial;timers.set(id,callback);return id;},clearTimer:id=>timers.delete(id)});
  const prepareArgs=positionMs===undefined?[plan]:[plan,{positionMs}],prepared=receiver.prepare(...prepareArgs);assert.equal(prepared,receiver.preparePromise);assert.deepEqual(receiver.prepareArgs,prepareArgs);await prepared;
  const startArgs=[{anchorTime:context.currentTime+.05}],started=receiver.start(...startArgs);assert.equal(started,receiver.startPromise);assert.deepEqual(receiver.startArgs,startArgs);await started;
  const origin=frame;let tick=0;
  while(node.core.state==='running'){
   assert.ok(tick++<rafHz*30,'Deterministic schedule must terminate within its planned fixture duration');
   const target=origin+Math.ceil(tick*plan.sampleRate/rafHz);while(frame<target)render(Math.min(128,target-frame));
   await Promise.resolve();const pending=[...frames.values()];frames.clear();for(const callback of pending)callback();
  }
  await Promise.resolve();assert.equal(node.core.state,'ended',JSON.stringify(messages.find(message=>message.type==='error')));observer.assertHealthy();
  const row=helpers.compact(observer.snapshot())[0];assert.ok(row.pcm.blocks.length<=64);assert.deepEqual(calls,['prepare','start']);assert.equal(timers.size,0);
  return {row:structuredClone(row),graphHistory:structuredClone(observer.status().graphHistory),messages,firstGateFrame:messages.find(message=>message.type==='ended').ledger.actualStarts.find(value=>value>=0)??null};
 }finally{
  const cleanup=observer.restore();assert.equal(cleanup.restored,true,JSON.stringify(cleanup));assert.equal(frames.size,0);assert.equal(Receiver.prototype.prepare,originalPrepare);assert.equal(Receiver.prototype.start,originalStart);assert.equal(AudioNode.prototype.connect,originalConnect);receiver?.dispose();await Promise.resolve();
 }
}
