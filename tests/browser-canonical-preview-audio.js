import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {audioThreadObserverSource} from '../scripts/dense-rendition-observer.mjs';
import {validateAudioThreadStatus,validateAudioThreadLifecycle} from '../scripts/audio-thread-rendition-proof.mjs';
import {validateCanonicalFrameLedger} from '../scripts/verify-canonical-practice-evidence.mjs';

const canonical=readFileSync(new URL('../crates/desktop-shell/canonical-practice-acceptance.js',import.meta.url),'utf8');
const boundary=canonical.indexOf('(() => {');
assert.ok(boundary>0,'Shared canonical observation helpers must precede the acceptance runner');
// Reuse the acceptance observer and bounded PCM sampling/ledger compaction.
// This never replaces a processor, response, audio clock or app callback result.
export const canonicalPreviewAudioBootstrap=`${canonical.slice(0,boundary)}\nglobalThis.__wmhPreviewAudioTools=Object.freeze({observeReceiver:${audioThreadObserverSource},sampleOffset:canonicalPracticeSampleOffsetFrames,compact:compactCanonicalPracticeAudio});`;

export async function installCanonicalPreviewAudio(page) {
  await page.evaluate(async()=>{
    const {CanonicalAudioReceiver}=await import('/canonical-audio-receiver.js'),tools=globalThis.__wmhPreviewAudioTools;
    globalThis.__wmhPreviewAudio=await tools.observeReceiver(document,{Receiver:CanonicalAudioReceiver,readStartFrame:note=>note[1],readEndFrame:note=>note[2],readSampleOffsetFrames:tools.sampleOffset});
  });
}
export async function readCanonicalPreviewAudio(page) {
  return page.evaluate(()=>{const observer=globalThis.__wmhPreviewAudio;observer.assertHealthy();return{status:observer.status(),runs:globalThis.__wmhPreviewAudioTools.compact(observer.snapshot())};});
}
export function assertCanonicalPreviewOutput(run,compilation,profile) {
  const plan=run.plan,rate=plan.sampleRate,timeline=compilation.timeline;
  assert.equal(plan.protocol,'wmh-canonical-audio-v1');assert.equal(plan.policyId,'wmh-canonical-sine-ms-v1');
  assert.equal(plan.sourceFingerprint,profile.source_fingerprint);assert.equal(plan.compiledFingerprint,profile.compiled_fingerprint);
  assert.deepEqual(plan.partIds,compilation.score.parts.map(part=>part.id));assert.deepEqual(plan.selection,{kind:'listen',part_ids:[]});
  assert.deepEqual(plan.notes,timeline.notes.map((note,index)=>[index,Math.floor(note.start_ms*rate/1000),Math.ceil((note.start_ms+note.duration_ms)*rate/1000),note.midi,note.velocity]),'Audition retains the consumed Rust source gates');
  const start=Math.min(...timeline.notes.map(note=>note.start_ms));assert.equal(plan.rangeMode,true);assert.equal(plan.rangeStartFrame,Math.round(start*rate/1000));assert.equal(plan.rangeEndFrame,Math.round(Math.min(timeline.duration_ms,start+30000)*rate/1000));
  assert.deepEqual(run.node,{actualAudioWorkletNode:true,contextMatches:true,numberOfInputs:0,numberOfOutputs:1});
  assert.equal(run.prepared.planFingerprint,plan.planFingerprint);assert.equal(run.started.planFingerprint,plan.planFingerprint);assert.equal(run.started.connected,true);assert.equal(run.started.outputContextMatches,true);
  const graph=path=>{assert.ok(path?.length>=3,'Preview needs a real connected output path');assert.equal(path[0].type,'AudioWorkletNode');assert.equal(path.at(-1).type,'AudioDestinationNode');for(const node of path)if(node.gain!==null)assert.ok(Number.isFinite(node.gain)&&node.gain>0,'Preview output gains must remain audible');};
  graph(run.started.graphToDestination);graph(run.pcm.graphToDestination);
  for(const type of ['ready','started'])assert.equal(run.messages.filter(message=>message.type===type).length,1);
  assert.ok(run.messages.every(message=>message.isTrusted===true&&message.portMatches===true),'Preview receipts must come from the actual native MessagePort');
  assert.equal(run.pcm.method,'passive-output-analyser');assert.equal(run.pcm.fftSize,256);assert.ok(run.pcm.blocks.length>0&&run.pcm.blocks.length<=64);
  for(const block of run.pcm.blocks)assert.ok(Number.isFinite(block.audioTime)&&Number.isFinite(block.peak)&&Number.isFinite(block.rms)&&block.peak>=0&&block.rms>=0&&block.rms<=block.peak+1e-12,'PCM samples must be finite and physically bounded');
  assert.ok(run.pcm.blocks.some(block=>block.audioTime>=run.started.anchorTime&&block.peak>1e-6&&block.rms>1e-8),'Preview must produce nonzero real PCM after its audio anchor');
}
export function assertCanonicalPreviewStopped(evidence,index,{pcm=false}={}) {
  validateAudioThreadStatus(evidence.status);const run=evidence.runs[index];assert.ok(run);validateAudioThreadLifecycle(run.lifecycle);
  // Other rows may belong to the independently paused scored session.
  assert.ok(run.rawTerminals.length>0&&run.rawTerminals.every(row=>row.isTrusted===true&&row.portMatches===true&&row.ledgerType==='Float64Array'),'Stop requires the actual native cancellation ledger');
  assert.equal(run.terminals[0].record.type,'canceled','The explicit Stop must cancel the audition');
  validateCanonicalFrameLedger(run,{pcm,runName:'browser lobby audition'});
}
