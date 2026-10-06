import test from 'node:test';
import assert from 'node:assert/strict';
import {validateLiveToneReleasedCheckpoint} from '../scripts/live-tone-proof.mjs';
import {validateHumanModLiveTone} from '../scripts/human-mod-live-tone-proof.mjs';
import {syntheticFixture,addSyntheticReleasedCheckpoint} from './human-mod-proof-fixtures.js';

// Complete synthetic observer records only. Passing these mutation contracts
// never establishes a native/browser run, physical audibility or acceptance.
function fixture(options){const value=syntheticFixture(options);addSyntheticReleasedCheckpoint(value.e);return value;}
const released=e=>e.checkpoints[0],blocks=e=>released(e).pcm.blocks;
const verify=e=>validateLiveToneReleasedCheckpoint(e);

test('released-window contracts retain complete synthetic original observations without claiming native acceptance',()=>{
 for(const instrument of ['piano','guitar'])for(const rate of [8000,44100,48000,96000,384000]){
  const {e,options}=fixture({instrument,rate}),before=structuredClone(e);
  assert.equal(validateHumanModLiveTone(e,options),e);assert.equal(verify(e),e);assert.deepEqual(e,before);
  assert.equal(e.fixtureKind,'synthetic-verifier-only');assert.equal(e.actual_app,undefined);
 }
});

test('finite released windows admit observed gaps and the full supported held-note duration',()=>{
 for(const holdMs of [30,73,10000]){const {e,options}=fixture({holdMs,rate:8000});validateHumanModLiveTone(e,options);verify(e);}
 const {e}=fixture();
 // Delayed finite samples remain valid. They do not claim PCM coverage during
 // the gap; the seal and after boundary still follow fresh final samples.
 for(const block of blocks(e).slice(1)){block.wallMs+=700;block.audioTime+=.7;}
 for(const boundary of [released(e).closed,e.after]){boundary.wallMs+=700;boundary.receiver.audioTime+=.7;}
 e.silenceEstablished.audioTime+=.7;verify(e);
});

test('a final forced capture may share the previous running audio quantum',()=>{
 const {e}=fixture(),row=released(e),last=blocks(e).at(-1),copy={...structuredClone(last),sequence:last.sequence+1};
 blocks(e).push(copy);row.closed.sequence++;e.after.sequence++;verify(e);
});

test('the original terminal frame controls the drain when its rendered quantum is ahead of the checkpoint clock',()=>{
 const {e}=fixture(),row=released(e),rate=e.ready.receiver.sampleRate,end=e.receipts[1].record.actualEndFrame/rate;
 row.receiver.audioTime=end-128/rate;row.wallMs=e.receipts[1].wallMs+1;
 const firstQuiet=end+(16384+256)/rate+.001,origin=e.ready.wallMs-e.ready.receiver.audioTime*1000;
 blocks(e).slice(1).forEach((block,index)=>{block.audioTime=firstQuiet+index*.06;block.wallMs=origin+block.audioTime*1000;});
 for(const [index,boundary]of [row.closed,e.after].entries()){boundary.receiver.audioTime=firstQuiet+.121+index*.001;boundary.wallMs=origin+boundary.receiver.audioTime*1000;}
 e.silenceEstablished.audioTime=firstQuiet;verify(e);
 // This frame has drained the checkpoint's clock, but not the exact terminal.
 blocks(e)[1].audioTime=row.receiver.audioTime+(16384+256+64)/rate;
 e.silenceEstablished.audioTime=blocks(e)[1].audioTime;
 assert.throws(()=>verify(e),/drained FFT/);
});

const mutations=[
 ['missing original coverage',e=>{delete e.pcmCoverage;}],
 ['missing released checkpoint',e=>{e.checkpoints=[];}],
 ['extra checkpoint',e=>{e.checkpoints.push(structuredClone(released(e)));}],
 ['renamed checkpoint',e=>{released(e).label='finished';}],
 ['replayed human call count',e=>{released(e).callCount=2;}],
 ['unsealed window',e=>{released(e).sampling='observing';}],
 ['exhausted window',e=>{released(e).sampling='exhausted';}],
 ['missing seal',e=>{delete released(e).closed;}],
 ['foreign seal label',e=>{released(e).closed.label='another-sealed';}],
 ['seal before last sample',e=>{released(e).closed.sequence=blocks(e).at(-1).sequence;}],
 ['final before seal',e=>{e.after.sequence=released(e).closed.sequence;}],
 ['zero ready sequence',e=>{e.ready.sequence=0;}],
 ['negative ready wall time',e=>{e.ready.wallMs=-1;}],
 ['zero PCM sequence',e=>{blocks(e)[1].sequence=0;}],
 ['duplicate PCM sequence',e=>{blocks(e)[2].sequence=blocks(e)[1].sequence;}],
 ['reversed PCM records',e=>{[blocks(e)[1],blocks(e)[2]]=[blocks(e)[2],blocks(e)[1]];}],
 ['PCM before released boundary',e=>{blocks(e)[0].sequence=released(e).sequence;}],
 ['PCM beyond seal',e=>{blocks(e).at(-1).sequence=released(e).closed.sequence+1;}],
 ['PCM before its wall window',e=>{blocks(e)[0].wallMs=released(e).wallMs-1;}],
 ['PCM beyond its wall window',e=>{blocks(e).at(-1).wallMs=released(e).closed.wallMs+1;}],
 ['reversed PCM wall times',e=>{blocks(e)[2].wallMs=blocks(e)[1].wallMs-1;}],
 ['reversed PCM audio times',e=>{blocks(e)[2].audioTime=blocks(e)[1].audioTime-.01;}],
 ['absurd PCM audio times',e=>{blocks(e).slice(1).forEach((block,index)=>{block.audioTime=(index+1)*100000;});}],
 ['coherent absurd seal and final times',e=>{blocks(e).slice(1).forEach((block,index)=>{block.audioTime=(index+1)*100000;});released(e).closed.receiver.audioTime=300000;e.after.receiver.audioTime=300000;e.silenceEstablished.audioTime=100000;}],
 ['audio progression outruns observed wall time',e=>{for(const block of blocks(e).slice(1))block.audioTime+=2;for(const boundary of [released(e).closed,e.after])boundary.receiver.audioTime+=2;e.silenceEstablished.audioTime+=2;}],
 ['unbounded released interval',e=>{for(const block of blocks(e).slice(1)){block.wallMs+=15000;block.audioTime+=15;}for(const boundary of [released(e).closed,e.after]){boundary.wallMs+=15000;boundary.receiver.audioTime+=15;}e.silenceEstablished.audioTime+=15;}],
 ['empty PCM window',e=>{released(e).pcm.blocks=[];}],
 ['oversized PCM window',e=>{released(e).pcm.blocks=Array.from({length:65},()=>structuredClone(blocks(e)[0]));}],
 ['foreign analyser method',e=>{released(e).pcm.method='fabricated';}],
 ['wrong fixed FFT size',e=>{released(e).pcm.fftSize=1024;}],
 ['zero actual samples',e=>{blocks(e)[1].samples=0;}],
 ['missing fixed tap',e=>{blocks(e)[1].tapConnected=false;}],
 ['empty audible graph',e=>{blocks(e)[1].graphToDestination=[];}],
 ['foreign intermediate graph',e=>{blocks(e)[1].graphToDestination[2].id=99;}],
 ['muted graph',e=>{blocks(e)[1].graphToDestination[1].gain=0;}],
 ['missing actual output context',e=>{blocks(e)[1].contextState='suspended';}],
 ['nonfinite PCM energy',e=>{blocks(e)[0].energy=Infinity;}],
 ['negative PCM peak',e=>{blocks(e)[0].peak=-1;}],
 ['impossible nonzero count',e=>{blocks(e)[0].nonzeroSamples=16385;}],
 ['changed PCM graph revision',e=>{blocks(e)[1].graphRevision++;}],
 ['changed checkpoint graph revision',e=>{released(e).graphRevision++;}],
 ['stale seal wall clock',e=>{released(e).closed.wallMs+=101;e.after.wallMs+=101;}],
 ['stale final wall clock',e=>{e.after.wallMs+=101;}],
 ['stale seal audio clock',e=>{released(e).closed.receiver.audioTime+=.101;e.after.receiver.audioTime+=.101;}],
 ['stale final audio clock',e=>{e.after.receiver.audioTime+=.101;}],
 ['forged silence identity',e=>{e.silenceEstablished.sequence++;}],
 ['forged silence clock',e=>{e.silenceEstablished.audioTime+=.001;}],
 ['missing silence identity',e=>{delete e.silenceEstablished;}],
 ['undrained quiet blocks',e=>{const row=released(e);for(const [index,block]of blocks(e).entries())block.audioTime=row.receiver.audioTime+index*.02;e.silenceEstablished={sequence:blocks(e)[1].sequence,audioTime:blocks(e)[1].audioTime};}],
 ['insufficient quiet sample count',e=>{blocks(e).splice(2,1);}],
 ['less than 100 ms quiet duration',e=>{blocks(e).at(-1).audioTime=blocks(e)[1].audioTime+.09;}],
 ['nonzero drained peak',e=>{blocks(e)[1].peak=.01;}],
 ['nonzero drained energy',e=>{blocks(e)[2].energy=.01;}],
 ['nonzero drained sample',e=>{blocks(e).at(-1).nonzeroSamples=1;}],
 ['missing positive original PCM',e=>{e.pcm.blocks[0].peak=0;}],
 ['original PCM after released boundary',e=>{e.pcm.blocks[0].sequence=released(e).sequence+1;}],
 ['foreign terminal token',e=>{e.receipts[1].record.token++;}],
 ['foreign terminal generation',e=>{e.receipts[1].record.generation++;}],
 ['foreign terminal node',e=>{e.receipts[1].nodeId++;}],
 ['untrusted original terminal',e=>{e.receipts[1].isTrusted=false;}],
 ['missing original terminal',e=>{e.receipts.pop();}],
 ['non-release terminal',e=>{e.receipts[1].record.reason='stopped';}],
 ['terminal after checkpoint',e=>{e.receipts[1].sequence=released(e).sequence+1;}],
 ['terminal frame beyond checkpoint rendering allowance',e=>{const t=e.receipts[1].record;t.actualEndFrame=t.frame=Math.ceil(released(e).receiver.audioTime*t.sampleRate)+257;}],
 ['forged note start before original boundary',e=>{e.receipts[0].record.actualStartFrame=e.receipts[1].record.actualStartFrame=0;}],
 ['unbounded original key hold',e=>{e.inputs[1].eventTime=e.inputs[0].eventTime+10001;}],
 ['extra original input',e=>{e.inputs.push(structuredClone(e.inputs[1]));}],
 ['replayed original call',e=>{e.calls.push(structuredClone(e.calls[0]));}],
 ['foreign original input association',e=>{e.calls[0].inputSequence++;}],
 ['early released checkpoint',e=>{released(e).sequence=e.inputs[1].sequence;}],
];
for(const boundary of ['ready','released','closed','after']){
 const row=e=>boundary==='released'?released(e):boundary==='closed'?released(e).closed:e[boundary];
 for(const key of ['receiverId','nodeId','gateId','destinationId','generation','sampleRate'])mutations.push([`${boundary} foreign ${key}`,e=>{row(e).receiver[key]++;}]);
 for(const key of ['nativeNode','nativePort','contextMatches','tapConnected'])mutations.push([`${boundary} missing ${key}`,e=>{row(e).receiver[key]=false;}]);
 mutations.push([`${boundary} paused source`,e=>{row(e).source.activeReceivers=0;}],[`${boundary} replaced source`,e=>{row(e).source.started++;}],[`${boundary} suspended context`,e=>{row(e).receiver.contextState='suspended';}],[`${boundary} disposed owner`,e=>{row(e).receiver.disposed=true;}],[`${boundary} extra live receiver`,e=>{row(e).nodes=2;}]);
}
for(const [name,mutate]of mutations)test(`released-window contract rejects ${name}`,()=>{const {e}=fixture();mutate(e);assert.throws(()=>verify(e));});
