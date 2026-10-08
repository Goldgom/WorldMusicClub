import test from 'node:test';
import assert from 'node:assert/strict';
import {CleanSongPlayer} from '../web/clean-song-player.js';
import {basicKeySong} from './basic-key-rendition-fixtures.js';
import {originalVsqAudioSong} from './practice-assistance-audio-fixtures.js';
import {basicKeyAudioHarness} from './basic-key-audio-harness.js';
import {BASIC_KEY_RENDITION} from '../web/basic-key-player.js';
import {compilePartActivity,samplePartActivity} from '../web/part-activity-model.js';
for(const kind of ['basic','vsq'])test(`independent activity ${kind}: frame units, half-open gates, no cached source traversal and stale epoch`,async()=>{
 const audio=basicKeyAudioHarness(),old=Object.getOwnPropertyDescriptor(globalThis,'AudioWorkletNode');globalThis.AudioWorkletNode=class{constructor(){return audio.nodeFactory();}};
 const player=new CleanSongPlayer({getPositionMs:()=>0}),song=kind==='basic'?basicKeySong():originalVsqAudioSong();player.select(song);
 try{
  await player.start({context:audio.context,output:audio.output,acceptedPolicyId:BASIC_KEY_RENDITION,mode:'listen'});const renderer=kind==='basic'?player.basicKeys:player.vsq;audio.context.currentTime=renderer.anchor.anchorTime+1;
  const first=player.activityPlayback({positionMs:0,transport:'running'});assert.equal(first.status,'ready');const model=compilePartActivity(first.snapshot,first.binding);
  assert.deepEqual(first.snapshot.gates.map(g=>[g.occurrenceId,g.startMs,g.endMs]),renderer.plan.notes.map(n=>[n[0],n[2]*1000/renderer.plan.sampleRate,n[3]*1000/renderer.plan.sampleRate]));
  for(const t of [...new Set(first.snapshot.gates.flatMap(g=>[g.startMs,g.endMs,(g.startMs+g.endMs)/2]))]){const sampled=samplePartActivity(model,{...first.frame,positionMs:t});for(const row of sampled.rows)assert.equal(row.activeGateCount,first.snapshot.gates.filter(g=>g.partId===row.partId&&g.startMs<=t&&g.endMs>t).length,`${row.partId} at ${t}`);}
  let reads=0;const protectedArrays=new Set([song.runtime.parts,song.compilation.timeline.notes]),originals=new Map();
  for(const method of ['map','filter','forEach','some','every',Symbol.iterator]){const original=Array.prototype[method];originals.set(method,original);Array.prototype[method]=function(...args){if(protectedArrays.has(this)){reads++;throw new Error('Full clean source traversal during cached activity frame');}return original.apply(this,args);};}
  try{for(let n=0;n<100;n++){const next=player.activityPlayback({positionMs:n,transport:'running'});assert.equal(next.status,'ready');assert.equal(next.snapshot,first.snapshot);}assert.equal(reads,0);}finally{for(const [method,original]of originals)Array.prototype[method]=original;}
  renderer.epoch++;assert.equal(player.activityPlayback({positionMs:0,transport:'running'}).status,'unavailable');
 }finally{player.destroy();if(old)Object.defineProperty(globalThis,'AudioWorkletNode',old);else delete globalThis.AudioWorkletNode;}
});
