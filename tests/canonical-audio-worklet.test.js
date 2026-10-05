import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {performance} from 'node:perf_hooks';
import {CanonicalAudioCore} from '../web/canonical-audio-core.js';
import {buildCanonicalAudioPlan,CANONICAL_AUDIO_POLICY,createCanonicalAudioTransfer} from '../web/canonical-audio-plan.js';
import {capacityEvidence} from './canonical-audio-fixtures.js';
const fixture=()=>JSON.parse(readFileSync(new URL('./fixtures/canonical-audio-evidence.json',import.meta.url)));
const plan=(f=fixture(),selection={kind:'parts',part_ids:['人 手 🎹']})=>buildCanonicalAudioPlan(f.compilation,f.profile,{sampleRate:48000,mode:'practice',practiceSelection:selection,acceptedPolicyId:CANONICAL_AUDIO_POLICY});
function setup(p=plan(),{positionFrame=0,Core=CanonicalAudioCore}={}){
 const messages=[],trace=[],core=new Core(48000,{emit:(m,transfer=[])=>messages.push(structuredClone(m,{transfer})),trace:m=>trace.push(m)}),packed=createCanonicalAudioTransfer(p);let frame=0;
 core.handleMessage({type:'prepare',generation:1,requestId:1,wire:structuredClone(packed.wire,{transfer:packed.transfer}),positionFrame},0);
 const block=(size=128)=>{const channel=new Float32Array(size);core.process([channel],frame);frame+=size;return channel;};
 while(core.state==='preparing'){block();assert.ok(core.lastPrepareWork<=256);}
 assert.equal(core.state,'ready',JSON.stringify(messages.at(-1)));
 return {p,core,messages,trace,block,get frame(){return frame;},command(type,extra={}){core.handleMessage({type,generation:core.generation,requestId:messages.length+1,...extra},frame);}};
}
test('actual production processor imports without TextEncoder, WebCrypto or browser globals',()=>{
 const script=`delete globalThis.TextEncoder;delete globalThis.crypto;globalThis.AudioWorkletProcessor=class{constructor(){this.port={postMessage(){}}}};globalThis.sampleRate=48000;globalThis.currentFrame=0;globalThis.registerProcessor=(name,C)=>{if(name!=='wmh-canonical-audio-v1')throw Error(name);const processor=new C();if(processor.process([],[[new Float32Array(128)]])!==true)throw Error('process')};await import('./web/canonical-audio-processor.js');`;
 execFileSync(process.execPath,['--input-type=module','-e',script],{cwd:new URL('..',import.meta.url)});
});
test('production processor schedules the whole original score while host rendering/messages are stalled',async()=>{
 const previous={AudioWorkletProcessor:globalThis.AudioWorkletProcessor,sampleRate:globalThis.sampleRate,currentFrame:globalThis.currentFrame,registerProcessor:globalThis.registerProcessor};const emitted=[];let Registered;
 try{
  globalThis.AudioWorkletProcessor=class{constructor(){this.port={postMessage:(m,transfer=[])=>emitted.push(structuredClone(m,{transfer}))};}};globalThis.sampleRate=48000;globalThis.currentFrame=0;globalThis.registerProcessor=(name,C)=>{assert.equal(name,'wmh-canonical-audio-v1');Registered=C;};
  await import('../web/canonical-audio-processor.js');const processor=new Registered(),p=plan(),packed=createCanonicalAudioTransfer(p);
  processor.port.onmessage({data:{type:'prepare',generation:1,positionFrame:-2400,wire:packed.wire}});
  const channel=new Float32Array(128);while(processor.core.state==='preparing'){processor.process([],[[channel]]);globalThis.currentFrame+=128;}
  const anchor=globalThis.currentFrame+128;processor.port.onmessage({data:{type:'start',generation:1,anchorFrame:anchor}});
  let energy=0;while(processor.core.state==='running'){processor.process([],[[channel]]);globalThis.currentFrame+=128;for(const value of channel)energy+=Math.abs(value);}
  assert.ok(energy>100);const ended=emitted.find(m=>m.type==='ended');assert.equal(ended.started,6);assert.equal(ended.ended,6);assert.equal(ended.frame,anchor+2400+p.durationFrames);
  for(let i=0;i<p.count;i++){assert.equal(ended.ledger.actualStarts[i],anchor+2400+p.notes[i][1]);assert.equal(ended.ledger.actualEnds[i],anchor+2400+p.notes[i][2]);}
  assert.equal(ended.sourceFingerprint,p.sourceFingerprint);assert.equal(ended.planFingerprint,p.planFingerprint);
 }finally{for(const [k,v]of Object.entries(previous)){if(v===undefined)delete globalThis[k];else globalThis[k]=v;}}
});
test('all-human playback emits no attack and preserves count-in and complete source end',()=>{
 const h=setup(plan(fixture(),{kind:'all'}),{positionFrame:-960});h.command('start',{anchorFrame:h.frame+128});let energy=0;while(h.core.state==='running')for(const v of h.block())energy+=Math.abs(v);
 const e=h.messages.find(m=>m.type==='ended');assert.equal(energy,0);assert.equal(e.started,0);assert.equal(e.sourceNotes,7);assert.equal(e.frame,e.anchorFrame+960+192000);assert.equal(e.ledger.actualStarts.length,0);
});
function renderWithPause(pause){
 const h=setup(),startFrame=h.frame,anchor=startFrame+100;h.command('start',{anchorFrame:anchor});const output=[];let pauseFrame,resumeFrame,held;
 while(h.core.state==='running'){
  if(pause&&!pauseFrame&&h.frame===2048){pauseFrame=h.frame;held=h.core.voiceSlots[h.core.activeSlots[0]].phase;h.command('pause');assert.equal(h.core.state,'paused');
   for(let i=0;i<3;i++)output.push(...h.block());assert.equal(h.core.voiceSlots[h.core.activeSlots[0]].phase,held);
   resumeFrame=h.frame+64;h.command('resume',{anchorFrame:resumeFrame});assert.equal(h.core.state,'running');assert.equal(h.core.sourcePosition(h.frame),pauseFrame-anchor);
  }
  output.push(...h.block());
 }
 return {h,output,startFrame,pauseFrame,resumeFrame};
}
test('pause/resume keeps held PCM phase and envelope, one clock shift and full pause ledger',()=>{
 const plain=renderWithPause(false),paused=renderWithPause(true),shift=paused.resumeFrame-paused.pauseFrame;
 const compressed=paused.output.slice(0,paused.pauseFrame-paused.startFrame).concat(paused.output.slice(paused.resumeFrame-paused.startFrame));
 assert.deepEqual(compressed.slice(0,plain.h.messages.at(-1).frame-plain.startFrame),plain.output.slice(0,plain.h.messages.at(-1).frame-plain.startFrame));
 assert.ok(paused.output.slice(paused.pauseFrame-paused.startFrame,paused.resumeFrame-paused.startFrame).every(v=>v===0));
 const e=paused.h.messages.find(m=>m.type==='ended'),base=plain.h.messages.find(m=>m.type==='ended');assert.equal(e.frame,base.frame+shift);assert.equal(e.totalPausedFrames,shift);assert.deepEqual([...e.pauseSpans],[paused.pauseFrame,paused.resumeFrame]);
 assert.equal(e.ledger.actualStarts[0],base.ledger.actualStarts[0]);assert.equal(e.ledger.actualEnds[0],base.ledger.actualEnds[0]+shift);
 for(let i=2;i<e.notes;i++)assert.equal(e.ledger.actualStarts[i],base.ledger.actualStarts[i]+shift);
});
test('cancel/replace during preparation and held pause fences generations with no old tails',()=>{
 const h=setup();h.command('start',{anchorFrame:h.frame+32});for(let i=0;i<8;i++)h.block();h.command('pause');const frozen=h.frame;h.command('cancel',{generation:2,reason:'song-switch'});
 assert.equal(h.core.state,'canceled');assert.ok(h.block().every(v=>v===0));const cancel=h.messages.find(m=>m.type==='canceled');assert.equal(cancel.planGeneration,1);assert.deepEqual([...cancel.pauseSpans],[frozen,-1]);assert.equal(cancel.ledger.actualEnds[0],frozen);
 h.core.handleMessage({type:'resume',generation:1,anchorFrame:h.frame+32},h.frame);assert.equal(h.core.state,'canceled');assert.equal(h.messages.at(-1).type,'stale');
 const packed=createCanonicalAudioTransfer(plan(fixture(),{kind:'all'}));h.core.handleMessage({type:'prepare',generation:3,positionFrame:0,wire:packed.wire},h.frame);h.command('cancel',{generation:4});assert.equal(h.core.state,'canceled');assert.ok(h.block().every(v=>v===0));
});
test('transfer tamper, selection binding, rate mismatch and voice overflow fail before ready',()=>{
 for(const mutate of [w=>new Float64Array(w.buffers.starts)[0]++,w=>new Uint32Array(w.buffers.occurrences)[0]=9999,w=>w.selectionFingerprint='0'.repeat(64),w=>w.planFingerprint='0'.repeat(64),w=>w.sampleRate=44100]){
  const p=plan(),packed=createCanonicalAudioTransfer(p);mutate(packed.wire);const messages=[],c=new CanonicalAudioCore(48000,{emit:m=>messages.push(m)});c.handleMessage({type:'prepare',generation:1,positionFrame:0,wire:packed.wire},0);let frame=0;while(c.state==='preparing'){c.process([new Float32Array(128)],frame);frame+=128;}assert.equal(c.state,'error');assert.ok(!messages.some(m=>m.type==='ready'));
 }
});
test('100k-row preparation is bounded to 256 work items/quantum and cancellation is immediate',()=>{
 const f=capacityEvidence({count:100000}),p=plan(f,{kind:'parts',part_ids:['human']}),packed=createCanonicalAudioTransfer(p),messages=[],c=new CanonicalAudioCore(48000,{emit:m=>messages.push(m)});
 const before=performance.now();c.handleMessage({type:'prepare',generation:1,positionFrame:0,wire:packed.wire},0);const messageMs=performance.now()-before;assert.equal(c.state,'preparing');assert.equal(c.prepareCursor,0);
 let blocks=0,maxChunkMs=0,frame=0;const channel=new Float32Array(128);
 while(c.state==='preparing'){const start=performance.now();c.process([channel],frame);maxChunkMs=Math.max(maxChunkMs,performance.now()-start);frame+=128;blocks++;assert.ok(c.lastPrepareWork<=256);assert.ok(channel.every(v=>v===0));}
 assert.equal(c.state,'ready');assert.equal(c.eligibleCount,100000);assert.ok(blocks>=Math.ceil(200000/256));
 const p2=createCanonicalAudioTransfer(p);c.handleMessage({type:'prepare',generation:2,positionFrame:0,wire:p2.wire},frame);c.process([channel],frame);assert.equal(c.state,'preparing');c.handleMessage({type:'cancel',generation:3},frame+128);assert.equal(c.state,'canceled');c.process([channel],frame+128);assert.ok(channel.every(v=>v===0));
 console.log(JSON.stringify({evidence:'canonical-processor-capacity-development-not-device',messageMs,maxChunkMs,blocks,algorithmRowsPerQuantum:256,transferBytes:packed.transfer.reduce((n,b)=>n+b.byteLength,0)}));
});
