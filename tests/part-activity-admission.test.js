import test from 'node:test';
import assert from 'node:assert/strict';
import {canonicalActivityPlayback,captureCanonicalActivityAdmission,retirePartActivityAdmission,isAdmittedPartActivitySnapshot} from '../web/part-activity-playback.js';
import {compilePartActivity,samplePartActivity} from '../web/part-activity-model.js';
import {CanonicalPracticeSession} from '../web/canonical-practice-session.js';
import {buildCanonicalAudioPlan,CANONICAL_AUDIO_POLICY} from '../web/canonical-audio-plan.js';
import {capacityEvidence} from './canonical-audio-fixtures.js';
import {audioFixture,audioAssistanceFixture,originalVsqAudioSong} from './practice-assistance-audio-fixtures.js';
import {CleanSongPlayer} from '../web/clean-song-player.js';
import {basicKeySong} from './basic-key-rendition-fixtures.js';
import {basicKeyAudioHarness} from './basic-key-audio-harness.js';
import {BASIC_KEY_RENDITION} from '../web/basic-key-player.js';
const make=(options={})=>{const{compilation,profile}=capacityEvidence({count:4});const plan=buildCanonicalAudioPlan(compilation,profile,{sampleRate:48000,acceptedPolicyId:CANONICAL_AUDIO_POLICY,mode:'listen',...options});const s={compilation,plan,epoch:1,player:{running:true,context:{state:'running'}},interpretation:{sound_enabled:true}};captureCanonicalActivityAdmission(s);return s;};
test('canonical admission preserves immutable occurrence gates; model is half-open and binding checked',()=>{
 const s=make(),a=canonicalActivityPlayback(s,{positionMs:0,transport:'running',sourceClock:{positionMs:0}}),m=compilePartActivity(a.snapshot,a.binding);
 assert.equal(a.status,'ready');assert.ok(isAdmittedPartActivitySnapshot(a.snapshot));assert.equal(isAdmittedPartActivitySnapshot({...a.snapshot}),false);assert.equal(a.snapshot.gates.length,4);assert.ok(Object.isFrozen(a.snapshot.gates[0]));
 const gate=a.snapshot.gates[0];assert.equal(samplePartActivity(m,{...a.frame,positionMs:gate.startMs}).rows[0].state,'playing');assert.equal(samplePartActivity(m,{...a.frame,positionMs:gate.endMs}).rows[0].activeGateCount,0);
 assert.throws(()=>samplePartActivity(m,{...a.frame,binding:{...a.binding,planToken:{}}}));assert.throws(()=>compilePartActivity({...a.snapshot},a.binding));
 for(const transport of ['ready','preparing','paused','ended'])assert.equal(samplePartActivity(m,{...a.frame,transport}).rows[0].state,transport);
 assert.equal(samplePartActivity(m,{...a.frame,soundEnabled:false}).rows[0].state,'muted');assert.equal(samplePartActivity(m,{...a.frame,countIn:true}).rows[0].state,'ready');assert.equal(samplePartActivity(m,{...a.frame,rendererState:'suspended'}).rows[0].state,'unavailable');
});
test('canonical range clips admitted gates; supplied clock reused; repeated frames never read source',()=>{
 const s=make({range:{startMs:2.5,endMs:4.5},countInMs:100,loop:true});s.sourceClock=()=>{throw Error('extra clock');};
 const a=canonicalActivityPlayback(s,{sourceClock:{positionMs:3},positionMs:2.5,transport:'running'});assert.deepEqual(a.snapshot.gates.map(g=>[g.startMs,g.endMs]),[[2.5,3],[4,4.5]]);
 Object.defineProperty(s.compilation,'score',{get(){throw Error('source read');}});Object.defineProperty(s.compilation.timeline,'notes',{get(){throw Error('timeline read');}});
 for(let n=0;n<100;n++)assert.equal(canonicalActivityPlayback(s,{sourceClock:{positionMs:n},positionMs:n,transport:'running'}).snapshot,a.snapshot);
 s.player.epoch=9;assert.equal(canonicalActivityPlayback(s).status,'unavailable');
});
test('assisted machine subset keeps tied/repeated source identities distinct and rejects ownership changes',()=>{
 const{compilation,profile}=audioFixture('canonical-audio-evidence'),partIds=compilation.score.parts.map(p=>p.id),humanIds=[...new Set(compilation.timeline.notes.filter(n=>n.midi===60).flatMap(n=>n.source_note_ids))],f=audioAssistanceFixture(compilation,{partIds,humanIds});
 const plan=buildCanonicalAudioPlan(compilation,profile,{sampleRate:48000,acceptedPolicyId:CANONICAL_AUDIO_POLICY,mode:'practice',practiceSelection:{kind:'parts',part_ids:partIds},assistance:f.assistance,assistanceContext:f.binding});
 const s={compilation,plan,player:{assistance:f.assistance},interpretation:{sound_enabled:false}};captureCanonicalActivityAdmission(s,{assistance:f.assistance,assistanceContext:f.binding});const a=canonicalActivityPlayback(s,{positionMs:0,transport:'paused'});assert.equal(a.snapshot.gates.length,2);assert.ok(a.snapshot.parts.every(p=>p.machineSubset));assert.notEqual(a.snapshot.gates[0].occurrenceId,a.snapshot.gates[1].occurrenceId);
});
test('actual silent canonical session clears on failed/cancelled preparation and retirement cannot sound',async()=>{
 const{compilation,profile}=capacityEvidence({count:4});const s=new CanonicalPracticeSession();s.select(compilation,profile);await s.prepare({soundEnabled:false,mode:'listen'});const a=canonicalActivityPlayback(s,{positionMs:0,transport:'running'});assert.equal(a.frame.soundEnabled,false);
 const retired=retirePartActivityAdmission(s);assert.equal(retired.current(),false);s.stop();assert.equal(retired.current(),true);assert.equal(canonicalActivityPlayback(s).status,'unavailable');
 await assert.rejects(s.prepare({soundEnabled:false,mutedPartIds:['missing']}));assert.equal(canonicalActivityPlayback(s).status,'unavailable');assert.equal(retired.current(),false);
});
for(const kind of ['basic','vsq'])test(`${kind}: actual prepare/start/pause/reprepare/source identity plus zero per-frame source traversal`,async()=>{
 const audio=basicKeyAudioHarness(),old=Object.getOwnPropertyDescriptor(globalThis,'AudioWorkletNode');globalThis.AudioWorkletNode=class{constructor(){return audio.nodeFactory();}};
 const p=new CleanSongPlayer({getPositionMs:()=>0}),song=kind==='basic'?basicKeySong():originalVsqAudioSong();p.select(song);
 try{
  await p.start({context:audio.context,output:audio.output,acceptedPolicyId:BASIC_KEY_RENDITION,mode:'listen'});const a=p.activityPlayback({positionMs:0,transport:'running',countIn:false});assert.equal(a.status,'ready');const active=kind==='basic'?p.basicKeys:p.vsq;assert.deepEqual(a.snapshot.gates.map(g=>g.occurrenceId),active.plan.notes.map(n=>n[0]));
  const forbidden=new Set([song.runtime.parts,song.compilation.timeline.notes]),map=Array.prototype.map,filter=Array.prototype.filter;Array.prototype.map=function(...args){assert.ok(!forbidden.has(this));return map.apply(this,args);};Array.prototype.filter=function(...args){assert.ok(!forbidden.has(this));return filter.apply(this,args);};
  try{for(let n=0;n<100;n++)assert.equal(p.activityPlayback({positionMs:n,transport:'running',countIn:false}).snapshot,a.snapshot);}finally{Array.prototype.map=map;Array.prototype.filter=filter;}
  const retired=retirePartActivityAdmission(p,{clean:true});assert.equal(retired.current(),false);p.pause();assert.equal(p.activityPlayback().status,'unavailable');assert.equal(retired.current(),true);
  await p.prepare({context:audio.context,output:audio.output,acceptedPolicyId:BASIC_KEY_RENDITION,mode:'listen'});assert.equal(retired.current(),false);assert.notEqual(p.activityPlayback().binding.planToken,a.binding.planToken);p.select(null);assert.equal(retired.current(),false);
 }finally{p.destroy();if(old)Object.defineProperty(globalThis,'AudioWorkletNode',old);else delete globalThis.AudioWorkletNode;}
});
