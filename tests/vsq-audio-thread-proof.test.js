// Synthetic verifier evidence only. This suite does not run a browser or assert
// native trust, PCM audibility, or Windows acceptance.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {webcrypto} from 'node:crypto';
import {vsqAcceptanceFixture} from '../scripts/prepare-vsq-song-fixtures.mjs';
import {expectedVsqAudioPlan,expectedVsqTriangleHash,vsqAudioSourceNotes,validateVsqAudioThreadRuns,VSQ_TRIANGLE_RECIPE} from '../scripts/vsq-audio-thread-proof.mjs';
import {syntheticVsqAudioThreadRun as syntheticVsqRun} from './vsq-audio-thread-proof-fixtures.js';
const syntheticVsqAudioThreadRun=options=>syntheticVsqRun(response,options);
import {createBasicKeyAudioTransfer} from '../web/basic-key-audio-plan.js';
import {buildVsqAudioPlan} from '../web/vsq-audio-plan.js';
import {prepareCleanSong,prepareVsqPractice} from '../web/clean-song-package.js';
const fixture=vsqAcceptanceFixture(),response=fixture.runtime;
test('independent VSQ sample oracle retains source coordinates, exact rational ends and both declared recipes',()=>{
 const song=prepareVsqPractice(prepareCleanSong(`native:${fixture.key}`,fixture.opened.clean_package,JSON.parse(fixture.opened.score_json)),response);
 for(const sampleRate of [44100,48000])for(const instrument of ['piano','guitar'])for(const options of [{},{mode:'practice',targetPart:'vsq-track-2'},{mutedParts:['vsq-track-1']},{soloParts:['vsq-track-2']},{mutedParts:['vsq-track-1','vsq-track-2']}]){
  const input={sampleRate,instrument,...options},plan=buildVsqAudioPlan(song,input),notes=vsqAudioSourceNotes(response,input);
  assert.deepEqual(plan,expectedVsqAudioPlan(notes,{sampleRate,sourceSha256:response.runtime.source_sha256,sourceNotes:2,endMicroseconds:response.runtime.end_microseconds}));
 }
 assert.equal(expectedVsqAudioPlan(vsqAudioSourceNotes(response),{sampleRate:48000,sourceSha256:response.runtime.source_sha256,endMicroseconds:response.runtime.end_microseconds}).notes[0][3],68101);
});
test('VSQ ledger admission rejects altered rational gates, policy, authored digits, role, velocity and table transfer',()=>{
 const run=syntheticVsqAudioThreadRun();validateVsqAudioThreadRuns([run],response);
 for(const mutate of [r=>r.plan.notes[0][3]--,r=>r.plan.notes[0][1]=r.plan.notes[0][1].replace('ID#0001','ID#00000001'),r=>r.plan.notes[0][4]++,r=>r.plan.notes[0][5]=1,r=>r.plan.notes[0][6]=0,r=>r.plan.policyId='wmh-basic-key-rendition-fifo-v1',r=>r.prepared.identityKind='midi-source-coordinate',r=>r.terminals[0].record.identityKind='midi-source-coordinate',r=>r.timbre.sha256='0'.repeat(64),r=>r.timbre.detached=false,r=>r.timbre.transferred=false,r=>r.rawTerminals[0].isTrusted=false,r=>r.terminals[0].record.ledger.actualStarts.pop()]){const changed=structuredClone(run);mutate(changed);assert.throws(()=>validateVsqAudioThreadRuns([changed],response));}
 const rounded=structuredClone(response);rounded.runtime.notes[0].end_microseconds.numerator='227000000';assert.throws(()=>validateVsqAudioThreadRuns([run],rounded));
});
test('VSQ oracle validates count-in, pause cancellation, resumed gates and zero-machine-muted plans',()=>{
 validateVsqAudioThreadRuns([syntheticVsqAudioThreadRun({positionMs:-2000})],response);
 validateVsqAudioThreadRuns([syntheticVsqAudioThreadRun({cancelMs:350}),syntheticVsqAudioThreadRun({positionMs:350,receiverId:2})],response);
 validateVsqAudioThreadRuns([syntheticVsqAudioThreadRun({mutedParts:['vsq-track-1','vsq-track-2']})],response,{mutedParts:['vsq-track-1','vsq-track-2'],pcm:false});
 const source=readFile(new URL('../scripts/vsq-audio-thread-proof.mjs',import.meta.url),'utf8');return source.then(value=>{assert.doesNotMatch(value,/from ['"].*web\//);assert.doesNotMatch(value,/buildVsqAudioPlan|basicKeyGateFrames/);});
});
test('shared observer hashes the actual transferred VSQ table, bounds JSON and restores the real port method',async()=>{
 const source=await readFile(new URL('../crates/desktop-shell/reference-acceptance.js',import.meta.url),'utf8'),begin=source.indexOf('async function observeBasicKeyReceiver('),end=source.indexOf('// End shared audio-thread observer.',begin),realm=vm.createContext({structuredClone,Float32Array,Uint8Array});vm.runInContext(source.slice(begin,end)+';globalThis.observe=observeBasicKeyReceiver;',realm);
 const plan=syntheticVsqAudioThreadRun().plan,calls=[];
 class AudioNode extends EventTarget{connect(target){return target;}disconnect(){}}
 class AudioWorkletNode extends AudioNode{constructor(context){super();this.context=context;this.numberOfInputs=0;this.numberOfOutputs=1;this.port=new EventTarget();this.port.postMessage=function(...args){calls.push({owner:this,args});structuredClone(args[0],{transfer:args[1]});return 73;};}}
 const context={state:'running',currentTime:0,createAnalyser(){const node=new AudioNode();node.getFloatTimeDomainData=values=>values.fill(0);return node;}},output=new AudioNode();output.context=context;
 class Receiver{constructor(){this.context=context;this.node=new AudioWorkletNode(context);this.output=output;this.onEnded=this.onStopped=this.onError=()=>{};this.pending=new Map();this.generation=0;this.disposed=false;}prepare(value){this.plan=value;this.generation++;this.positionFrame=0;const packed=createBasicKeyAudioTransfer(value);this.result=this.node.port.postMessage({type:'prepare',generation:this.generation,wire:packed.wire},packed.transfer);return this.promise=Promise.resolve({type:'ready'});}start(){return Promise.resolve({});}}
 const root={AudioNode,AudioWorkletNode,crypto:webcrypto,performance:{now:()=>0},cancelAnimationFrame(){},requestAnimationFrame:()=>1},observer=await realm.observe({},{Receiver,root}),receiver=new Receiver(),original=receiver.node.port.postMessage;
 const returned=receiver.prepare(plan);assert.equal(returned,receiver.promise);await returned;assert.equal(receiver.result,73);assert.equal(calls[0].owner,receiver.node.port);assert.equal(calls[0].args[0].wire.buffers.triangles.byteLength,0);
 for(let i=0;i<100&&!observer.snapshot()[0].timbre.sha256;i++)await new Promise(resolve=>setTimeout(resolve,1));
 assert.deepEqual(JSON.parse(JSON.stringify(observer.snapshot()[0].timbre)),syntheticVsqAudioThreadRun().timbre);assert.ok(JSON.stringify(observer.snapshot()).length<10000,'Table arrays must never enter reports');assert.deepEqual([...observer.status().errors],[]);assert.equal(observer.restore().restored,true);assert.equal(receiver.node.port.postMessage,original);
});
test('bounded PCM observation reserves source-onset evidence after a long count-in',async()=>{
 const source=await readFile(new URL('../crates/desktop-shell/reference-acceptance.js',import.meta.url),'utf8'),begin=source.indexOf(' function sample(entry,row){'),end=source.indexOf(' const create=Receiver.create;',begin),frames=[];
 const context={state:'running',currentTime:0,destination:{}},row={started:{anchorTime:0},pcm:{blocks:[]}},entry={sampleRow:row,sampleFromAudioTime:2,owner:{context,connected:true,state:'running'},analyser:{getFloatTimeDomainData:values=>values.fill(context.currentTime>=2?.1:0)}};
 const realm=vm.createContext({active:true,Float32Array,clock:()=>({wallMs:context.currentTime*1000}),graphPath:()=>[{type:'AudioWorkletNode'},{type:'AudioDestinationNode'}],root:{requestAnimationFrame:callback=>(frames.push(callback),frames.length)}});vm.runInContext(source.slice(begin,end)+';globalThis.sample=sample;',realm);realm.sample(entry,row);
 for(let index=1;index<=150;index++){context.currentTime=index/100;frames.shift()();}assert.equal(row.pcm.blocks.length,4,'Count-in must not exhaust the finite analyser budget');assert.equal(frames.length,1);
 context.currentTime=2.01;frames.shift()();assert.equal(row.pcm.blocks.length,5);assert.ok(row.pcm.blocks.at(-1).peak>0);assert.ok(row.pcm.graphToDestination);entry.owner.disposed=true;frames.shift()();assert.equal(frames.length,0);
});
