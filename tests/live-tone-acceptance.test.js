import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {runInNewContext} from 'node:vm';
import {validateLiveToneEvidence,validateLiveToneCleanup,validateLiveToneInput} from '../scripts/live-tone-proof.mjs';
import {syntheticLiveToneEvidence,syntheticLiveToneTransport} from './live-tone-evidence-fixtures.js';
const source=await readFile(new URL('../crates/desktop-shell/live-tone-acceptance.js',import.meta.url),'utf8');
const observe=runInNewContext(`${source}\nobserveLiveToneAudio`,{structuredClone,Float32Array});
const serializable=value=>JSON.parse(JSON.stringify(value));
const verify=e=>validateLiveToneEvidence(e,{...e.expected,transport:syntheticLiveToneTransport(syntheticLiveToneEvidence(e.expected))});

test('live proof binds one native human token, fixed connected output and exact original input timestamps',()=>{
 for(const expected of [{keyCode:'Digit2',midi:72},{keyCode:'KeyU',midi:63}])verify(syntheticLiveToneEvidence(expected));
});
test('live proof rejects fabricated, absent, untrusted, silent, unconnected and graph-mutated receipts',()=>{
 const changes=[
  e=>delete e.initialization.ready,e=>e.initialization.ready.isTrusted=false,e=>e.initialization.ready.nativeMessage=false,e=>e.initialization.ready.portMatches=false,e=>e.initialization.ready.record.generation++,e=>e.initialization.tapReady.sequence=e.ready.sequence,e=>e.initialization.tapReady.source.started=1,e=>e.initialization.tapReady.source.activeReceivers=1,
  e=>e.ready.receiver.nativeNode=false,e=>e.ready.receiver.nativePort=false,e=>e.ready.receiver.contextMatches=false,e=>e.ready.receiver.numberOfInputs=1,e=>e.ready.receiver.tapConnected=false,e=>e.after.receiver.nodeId++,e=>e.after.nodes++,e=>e.after.graphRevision++,e=>e.after.source.activeReceivers=0,e=>e.after.source.started++,e=>e.ready.source.errors.push('broken frame'),e=>e.errors.push('observation failed'),e=>e.overflow=true,
  e=>e.inputs[0].isTrusted=false,e=>e.inputs[0].repeat=true,e=>e.inputs[0].surface='other',e=>e.inputs[0].code='KeyR',e=>e.inputs[1].eventTime=e.inputs[0].eventTime,e=>e.inputs[0].eventTime++,e=>e.inputs.pop(),e=>e.inputs[0].source.activeReceivers=0,
  e=>e.calls=[],e=>e.calls[0].inputSequence++,e=>e.calls[0].token++,e=>e.calls[0].midi++,e=>e.calls[0].id='midi-t3-e1',e=>e.calls[0].id=e.calls[0].id.replace('Digit2','KeyU'),e=>e.calls[0].graphRevision++,e=>e.calls[0].duration=0,e=>e.calls[0].velocity=0,e=>e.calls[0].source.activeReceivers=0,
  e=>e.receipts=[],e=>e.receipts.pop(),e=>e.receipts.push(structuredClone(e.receipts[1])),e=>e.receipts[0].nativeMessage=false,e=>e.receipts[0].isTrusted=false,e=>e.receipts[1].portMatches=false,e=>e.receipts[1].record.id+='old',e=>e.receipts[1].record.generation++,e=>e.receipts[1].record.token--,e=>e.receipts[1].record.midi++,e=>e.receipts[1].record.key++,e=>e.receipts[1].record.source='source-score',e=>e.receipts[1].record.kind='click',e=>e.receipts[1].record.reason='canceled',e=>e.receipts[1].record.reason='retrigger',e=>e.receipts[1].record.reason='silence',e=>e.receipts[1].record.pcmPeak=0,e=>e.receipts[1].record.pcmEnergy=0,e=>e.receipts[1].record.nonzeroSamples=0,e=>e.receipts[1].record.actualEndFrame=e.receipts[1].record.actualStartFrame,e=>e.receipts[0].record.frame++,e=>e.receipts[1].record.frame++,e=>e.receipts[1].record.renderedSamples--,e=>e.receipts[1].record.lastRenderedFrame=e.receipts[1].record.actualEndFrame,
  e=>e.pcm.blocks=[],e=>e.pcm.blocks[0].peak=0,e=>e.pcm.blocks[0].energy=0,e=>e.pcm.blocks[0].nonzeroSamples=0,e=>e.pcm.blocks[0].graphToDestination=null,e=>e.pcm.blocks[0].graphToDestination[1].gain=0,e=>e.pcm.blocks[0].graphToDestination.at(-1).id++,e=>e.pcm.blocks[0].audioTime=100,e=>e.pcm.blocks[0].contextState='suspended',e=>e.pcm.blocks[0].graphRevision++,
 ];
 for(const [index,change]of changes.entries()){const e=syntheticLiveToneEvidence();change(e);assert.throws(()=>verify(e),`Adversary ${index} was accepted`);}
});

function harness(){
 const listeners=new Map(),frames=new Map(),nativeCalls=[];let wall=0,nextFrame=0,token=0;
 class MessageEvent{constructor(data,port,{trusted=true}={}){Object.assign(this,{data,target:port,currentTarget:port,isTrusted:trusted});}}
 class MessagePort{constructor(){this.listeners=new Set();}addEventListener(type,fn){this.listeners.add(fn);}removeEventListener(type,fn){this.listeners.delete(fn);}emit(data,options){const event=options?.plain?{data,target:this,currentTarget:this,isTrusted:true}:new MessageEvent(data,this,options);for(const listener of this.listeners)listener(event);this.onmessage?.(event);}}
 class AudioNode{constructor(context){this.context=context;}connect(...args){nativeCalls.push(['connect',this,...args]);if(args[0]===null)throw this.context.sentinel;return args[0];}disconnect(...args){nativeCalls.push(['disconnect',this,...args]);return 'native-disconnected';}}
 class AudioDestinationNode extends AudioNode{}
 class GainNode extends AudioNode{constructor(context){super(context);this.gain={value:1};}}
 class AnalyserNode extends AudioNode{constructor(context){super(context);this.fftSize=16384;}getFloatTimeDomainData(values){values.fill(.125);}}
 class AudioWorkletNode extends AudioNode{constructor(context){super(context);this.port=new MessagePort();this.listeners=new Set();this.numberOfInputs=0;this.numberOfOutputs=1;}addEventListener(type,fn){this.listeners.add(fn);}removeEventListener(type,fn){this.listeners.delete(fn);}}
 const context={state:'running',sampleRate:48000,currentTime:0,sentinel:Error('original native failure'),createGain(){return new GainNode(this);},createAnalyser(){return new AnalyserNode(this);}};context.destination=new AudioDestinationNode(context);
 let lastPromise;
 class Receiver{
  static create(context,output,options){const owner=new Receiver(context,output,options);lastPromise=owner.request('initialize').then(()=>{owner.state='ready';return owner;});return lastPromise;}
  constructor(context,output,{onEvent=()=>{}}={}){Object.assign(this,{context,output,onEvent,generation:1,state:'initializing',disposed:false});this.node=new AudioWorkletNode(context);this.outputGate=context.createGain();this.node.connect(this.outputGate);this.outputGate.connect(output);this.node.port.onmessage=event=>{if(['started','ended'].includes(event.data.type))this.onEvent(event.data);};}
  request(type){if(type==='fail')throw context.sentinel;return Promise.resolve().then(()=>{this.node.port.emit({type:'ready',source:'live-tone',generation:1,sampleRate:48000,frame:0});return 'real-ack';});}
  play(...args){nativeCalls.push(['play',this,...args]);if(args[0]==='throw')throw context.sentinel;return ++token;}
 }
 const document={addEventListener(type,fn){listeners.set(type,fn);},removeEventListener(type,fn){if(listeners.get(type)===fn)listeners.delete(type);}};
 const root={AudioNode,AudioWorkletNode,MessagePort,MessageEvent,performance:{now:()=>wall},requestAnimationFrame(fn){const id=++nextFrame;frames.set(id,fn);return id;},cancelAnimationFrame(id){frames.delete(id);}};
 const time=value=>{wall=value;context.currentTime=value/1000;};
 const input=(type,value)=>{time(value);listeners.get(type)?.({type,code:'Digit2',isTrusted:true,repeat:false,timeStamp:value,target:{closest:()=>({id:'stage-title'})}});};
 const frame=value=>{time(value);const [id,fn]=frames.entries().next().value;frames.delete(id);fn();};
 return{Receiver,root,document,context,nativeCalls,frames,listeners,time,input,frame,get lastPromise(){return lastPromise;}};
}
async function initialized(f,options={}){const observer=await observe(f.document,{Receiver:f.Receiver,root:f.root,keyCode:'Digit2',midi:72,readSource:()=>({activeReceivers:f.context.currentTime>0?1:0,pendingReceivers:0,started:f.context.currentTime>0?1:0,errors:[],overflow:false})}),output=f.context.createGain();output.connect(f.context.destination);const promise=f.Receiver.create(f.context,output,options);assert.equal(promise,f.lastPromise,'Observer must return the exact original create promise');const owner=await promise;return{observer,owner};}
function receipt(type,id,token){return{type,source:'live-tone',generation:1,token,kind:'note',id,midi:72,key:72,sampleRate:48000,frame:type==='started'?9600:12096,requestedStartFrame:9600,actualStartFrame:9600,actualEndFrame:type==='started'?null:12096,pcmPeak:type==='started'?0:.125,pcmEnergy:type==='started'?0:38,nonzeroSamples:type==='started'?0:2495,renderedSamples:type==='started'?0:2496,firstNonzeroFrame:type==='started'?null:9601,lastRenderedFrame:type==='started'?null:12095,reason:type==='started'?'start':'release'};}
function perform(f,owner,observer,{plain=false,mutate=false}={}){
 f.time(100);observer.begin();f.input('keydown',200);const id='manual:key:keyboard-2:3:Digit2',token=owner.play(id,72,null,0,'piano',90);f.time(201);owner.node.port.emit(receipt('started',id,token),{plain});f.frame(216);if(mutate)owner.outputGate.connect(f.context.createGain());f.input('keyup',240);f.time(252);owner.node.port.emit(receipt('ended',id,token));f.frame(256);assert.equal(observer.settled(),true);f.time(260);return serializable(observer.finish());
}
test('observer captures genuine port ownership and fixes its analyser before create await resumes',async()=>{
 const f=harness(),original={create:f.Receiver.create,play:f.Receiver.prototype.play,request:f.Receiver.prototype.request,connect:f.root.AudioNode.prototype.connect,disconnect:f.root.AudioNode.prototype.disconnect,constructor:f.root.AudioWorkletNode},callbacks=[];
 const {observer,owner}=await initialized(f,{onEvent:value=>{callbacks.push(value);return 'callback-result';}});
 assert.equal(f.root.AudioWorkletNode,original.constructor,'No native constructor replacement');assert.equal(f.nativeCalls.filter(row=>row[0]==='connect').length,4,'Only the fixed initialization tap is added');
 const count=f.nativeCalls.length,e=perform(f,owner,observer);assert.equal(f.nativeCalls.slice(count).filter(row=>['connect','disconnect'].includes(row[0])).length,0);assert.equal(callbacks.length,2);assert.equal(callbacks[0].token,e.calls[0].token);validateLiveToneEvidence(e,{keyCode:'Digit2',midi:72,transport:syntheticLiveToneTransport(e)});
 assert.equal(owner.onEvent(callbacks[0]),'callback-result','Application callback is untouched');assert.throws(()=>owner.play('throw',72),value=>value===f.context.sentinel);assert.throws(()=>owner.request('fail'),value=>value===f.context.sentinel);assert.throws(()=>owner.node.connect(null),value=>value===f.context.sentinel);
 validateLiveToneCleanup(serializable(observer.restore()));assert.equal(f.Receiver.create,original.create);assert.equal(f.Receiver.prototype.play,original.play);assert.equal(f.Receiver.prototype.request,original.request);assert.equal(f.root.AudioNode.prototype.connect,original.connect);assert.equal(f.root.AudioNode.prototype.disconnect,original.disconnect);assert.equal(f.listeners.size,0);assert.equal(owner.node.port.listeners.size,0);assert.equal(f.frames.size,0);
});
test('passive observer records fabricated native-looking events and intervening graph mutations as failures',async()=>{
 for(const options of [{plain:true},{mutate:true}]){const f=harness(),{observer,owner}=await initialized(f),e=perform(f,owner,observer,options);assert.throws(()=>validateLiveToneEvidence(e,{keyCode:'Digit2',midi:72,transport:syntheticLiveToneTransport(e)}));validateLiveToneCleanup(serializable(observer.restore()));}
});
test('observer preserves request rejection, never writes score inputs and has no key-time audio graph creation',async()=>{
 assert.doesNotMatch(source,/dispatchEvent|\.snapshot\(|\/api\/assess|recorder\.|createOscillator|createBufferSource|postMessage/);
 const play=source.slice(source.indexOf('function played('),source.indexOf('Receiver.prototype.play=played'));assert.doesNotMatch(play,/\.connect\(|\.disconnect\(|createAnalyser/);
 const f=harness(),failure=Error('original create rejection');let rejected;f.Receiver.create=()=>rejected=Promise.reject(failure);const observer=await observe(f.document,{Receiver:f.Receiver,root:f.root,keyCode:'Digit2',midi:72});const result=f.Receiver.create();assert.equal(result,rejected);await assert.rejects(result,value=>value===failure);assert.throws(()=>observer.assertHealthy(),/original create rejection/);assert.equal(observer.restore().restored,true);
});

test('live sound stays bound to the original scored input instead of contributing processor clocks',()=>{
 const evidence=syntheticLiveToneEvidence(),event={kind:'note_on',input_kind:'typing_keyboard',encoding:'key_down',raw_timestamp_ms:1100,timestamp_basis:'event_monotonic',midi:72,velocity:90},take={input_evidence:{events:[event]}};validateLiveToneInput(take,evidence);
 for(const mutate of [t=>t.input_evidence.events[0].raw_timestamp_ms++,t=>t.input_evidence.events[0].timestamp_basis='processor_frame',t=>t.input_evidence.events[0].midi++,t=>t.input_evidence.events[0].velocity=0,t=>t.input_evidence.events.push({kind:'started',source:'live-tone'})]){const changed=structuredClone(take);mutate(changed);assert.throws(()=>validateLiveToneInput(changed,evidence));}
});

test('renderer and hosted entry points install the passive helper before source work and keep the scoring window intact',async()=>{
 const files=await Promise.all(['crates/desktop-shell/basic-key-acceptance.js','crates/desktop-shell/vsq-song-acceptance.js','scripts/hosted-basic-key-check.mjs','scripts/hosted-vsq-song-check.mjs'].map(path=>readFile(new URL(`../${path}`,import.meta.url),'utf8')));
 for(const runner of files.slice(0,2)){assert.ok(runner.includes('live=await observeLiveToneAudio'));assert.ok(runner.includes('live.begin()'));assert.ok(runner.includes('report.humanLiveAudio=live.finish()'));assert.ok(runner.includes('liveToneCleanup'));}
 for(const [index,runner]of files.slice(2).entries()){assert.ok(runner.indexOf("'live-tone-acceptance.js'")<runner.indexOf(index===0?"'basic-key-acceptance.js'":"'vsq-song-acceptance.js'"));assert.ok(runner.includes(`page.keyboard.press('${index===0?'Digit2':'KeyU'}',{delay:40})`));}
 assert.ok(files[0].includes("value)>=350,'C5 source onset approaching'"));assert.ok(files[0].includes("value)<650,'Real input window missed"));assert.ok(files[1].includes("value)<120,'VSQ source onset window missed"));
 assert.doesNotMatch(source,/root\.AudioWorkletNode\s*=|globalThis\.AudioWorkletNode\s*=|new AudioWorkletNode/);
});
test('fixed output history tolerates a main-thread long frame without moving the real key or processor frames',async()=>{
 const f=harness(),{observer,owner}=await initialized(f);f.time(100);observer.begin();f.input('keydown',200);const id='manual:key:keyboard-2:3:Digit2',token=owner.play(id,72,null,0,'piano',90);f.time(201);owner.node.port.emit(receipt('started',id,token));f.input('keyup',240);f.time(252);owner.node.port.emit(receipt('ended',id,token));
 // The actual observed output block is late; its fixed 16384-sample history
 // intersects the native voice interval. Neither timestamp is rewritten.
 f.frame(400);assert.equal(observer.settled(),true);f.time(401);const e=serializable(observer.finish());assert.equal(e.inputs[0].eventTime,200);assert.equal(e.receipts[1].record.actualEndFrame,12096);assert.equal(e.pcm.blocks[0].audioTime,.4);validateLiveToneEvidence(e,{keyCode:'Digit2',midi:72,transport:syntheticLiveToneTransport(e)});validateLiveToneCleanup(serializable(observer.restore()));
});
