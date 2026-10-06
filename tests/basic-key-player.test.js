import test from 'node:test';
import assert from 'node:assert/strict';
import {basicKeySong,basicKeyRenditionFixture} from './basic-key-rendition-fixtures.js';
import {fakeAudio} from './clean-song-fixtures.js';
import {prepareCleanSong,basicKeysParts} from '../web/clean-song-package.js';
import {CleanSongPlayer,inspectCleanRendition} from '../web/clean-song-player.js';
import {BASIC_KEY_RENDITION,BASIC_KEY_TIMBRE,BASIC_KEY_PERCUSSION} from '../web/basic-key-player.js';
import {BasicKeyAudioReceiver} from '../web/basic-key-audio-receiver.js';
import {ReferenceAudioReceiver} from '../web/midi-reference-synth.js';
import {ScorePreview} from '../web/score-preview.js';
import {basicKeyAudioHarness} from './basic-key-audio-harness.js';
import {basicKeyAllocationBudget} from '../web/basic-key-rendition.js';

function harness(){
 const song=basicKeySong(),audio=basicKeyAudioHarness(),errors=[];let position=0;
 const original=Object.getOwnPropertyDescriptor(globalThis,'AudioWorkletNode');
 globalThis.AudioWorkletNode=class{constructor(){return audio.nodeFactory();}};
 const player=new CleanSongPlayer({getPositionMs:()=>position,onError:error=>errors.push(error)});player.select(song);
 return{song,...audio,player,errors,start:options=>player.start({context:audio.context,output:audio.output,acceptedPolicyId:BASIC_KEY_RENDITION,...options}),at:ms=>{position=ms;},renderTo(seconds){while(audio.frame<Math.ceil(seconds*audio.context.sampleRate))audio.renderBlock(Math.min(128,Math.ceil(seconds*audio.context.sampleRate)-audio.frame));},close(){player.stop();if(original)Object.defineProperty(globalThis,'AudioWorkletNode',original);else delete globalThis.AudioWorkletNode;}};
}
const core=h=>h.nodes.at(-1).core;
const selected=h=>h.player.basicKeys.receiver.plan.notes;

test('complete basic-key admission joins every attack, percussion and chosen gate without changing source bytes',()=>{
 const opened=basicKeyRenditionFixture(),song=basicKeySong();assert.equal(song.score_json,opened.clean_package.score_json);assert.equal(song.metadata_json,opened.clean_package.metadata_json);assert.equal(song.compilation.timeline.notes.length,5);assert.equal(basicKeysParts(song).reduce((sum,part)=>sum+part.practice_targets,0),5);assert.ok(basicKeysParts(song).every(part=>part.practice_available));assert.equal(inspectCleanRendition(song).supported,true);assert.equal(song.compilation.timeline.notes.find(note=>note.midi===64).duration_ms,20);assert.equal(song.notation.parts[0].notes.length,1);assert.ok(Object.isFrozen(song.runtime.rendition.notes[0]));
 for(const change of [r=>r.rendition.notes.pop(),r=>r.rendition.notes[0][1][1]++,r=>r.rendition.notes[0][2][1]++,r=>r.rendition.notes[1][5]='melodic_key',r=>r.rendition.notes[2][7][0]='999999',r=>r.rendition.note_columns.reverse(),r=>r.rendition.policy_id='guess',r=>r.compilation.timeline.notes[0][0]='wrong',r=>r.compilation.timeline.notes[0][2]++,r=>r.compilation.timeline.notes.reverse(),r=>r.rendition.coverage.derived_voices--]){
  const data=basicKeyRenditionFixture().clean_package;change(data.runtime);assert.throws(()=>prepareCleanSong(`native:song-${data.content_sha256}`,data,JSON.parse(data.score_json).notation),{code:'clean_package_invalid'});
 }
});

test('Listen renders all native IDs through the audio core while the UI clock does not pump',async()=>{
 const h=harness(),before=JSON.stringify(h.song);
 try{
  const anchor=await h.start();assert.ok(Math.abs(anchor.anchorTime-h.context.currentTime-.05)<=1/h.context.sampleRate);assert.equal(core(h).startedCount,0,'Admission precedes the first audible sample');
  assert.equal(selected(h).length,5);assert.equal(selected(h).filter(note=>note[6]===1).length,1);
  h.renderTo(1.1);await Promise.resolve();
  assert.equal(core(h).startedCount,5);assert.equal(core(h).endedCount,5);assert.equal(core(h).activeCount,0);assert.equal(core(h).state,'ended');
  const ledger=h.player.basicKeys.receiver.lastCompletion;assert.equal(ledger.sourceSha256,h.song.score.source.sha256);
  for(const [index,note] of selected(h).entries()){assert.equal(ledger.ledger.actualStarts[index],anchor.anchorFrame+note[2]);assert.equal(ledger.ledger.actualEnds[index],anchor.anchorFrame+note[3]);}
  assert.equal(JSON.stringify(h.song),before);assert.deepEqual(h.errors,[]);
 }finally{h.close();}
});

test('part practice, mute and solo filter output after whole-source interpretation',async()=>{
 const h=harness(),[first,drums,last]=h.song.notation.parts;
 try{
  await h.start({mode:'practice',targetPart:first.id});assert.equal(selected(h).length,2);assert.equal(selected(h).filter(note=>note[6]===1).length,1);
  await h.start({mutedParts:[drums.id],soloParts:[first.id]});assert.equal(selected(h).length,3);
  await h.start({mode:'practice',targetPart:drums.id,soloParts:[first.id,last.id]});assert.equal(selected(h).length,4);
  await h.start({mutedParts:[first.id,drums.id,last.id]});assert.equal(selected(h).length,0);assert.equal(h.song.compilation.timeline.notes.length,5);
 }finally{h.close();}
});

test('pause/reset/resume cancel all active and future gates with fresh explicit anchors',async()=>{
 const h=harness();try{
  await assert.rejects(h.start({acceptedPolicyId:'other'}),{code:'reference_policy_required'});assert.equal(h.nodes.length,0);
  await h.start();const old=core(h),receiver=h.player.basicKeys.receiver;h.renderTo(.06);assert.equal(old.activeCount,2);h.player.pause();assert.equal(receiver.outputGate.gain.value,0);await Promise.resolve();assert.equal(old.activeCount,0);await Promise.resolve();assert.equal(h.nodes.at(-1).connected,false);h.renderTo(1.2);assert.equal(old.startedCount,2);
  const anchor=await h.start({resumePositionMs:600});assert.equal(anchor.positionMs,600);h.renderTo(anchor.anchorTime+.01);assert.equal(core(h).startedCount,2);assert.equal(core(h).skippedCount,3);
  h.player.stop();await Promise.resolve();assert.equal(core(h).activeCount,0);assert.deepEqual(h.errors,[]);
 }finally{h.close();}
});

test('canceling a pending module preparation cannot connect or restart a newer song',async()=>{
 const h=harness();let release;h.context.audioWorklet.addModule=()=>new Promise(resolve=>{release=resolve;});
 try{const start=h.start();await Promise.resolve();h.player.select(null);release();assert.equal(await start,null);assert.equal(h.nodes.length,1);assert.equal(h.nodes[0].connected,false);assert.equal(h.player.basicKeys.running,false);}finally{h.close();}
});

test('a stopped audio context cancels the generation and does not resume automatically',async()=>{
 const h=harness();try{await h.start();h.renderTo(.06);h.setState('suspended');assert.equal(h.errors[0].code,'clean_clock_unavailable');assert.equal(h.player.basicKeys.running,false);assert.equal(h.nodes.at(-1).connected,false);await Promise.resolve();h.setState('running');h.renderTo(.8);await Promise.resolve();assert.equal(core(h).startedCount,2);}finally{h.close();}
});

test('basic synth preserves every nominal key frequency and all percussion selectors without clamping or original-kit claims',()=>{
 const h=fakeAudio();h.context.sampleRate=48000;const receiver=new ReferenceAudioReceiver(h.context,h.output,{maxVoices:256,ErrorType:Error});
 try{for(const key of [0,127]){const before=h.nodes.length;receiver.schedule({key,velocity:90,referenceTimbre:BASIC_KEY_TIMBRE},.05,.1,{preserveFrequency:true});const tones=h.nodes.slice(before).filter(node=>node.kind==='oscillator');assert.ok(tones.every(tone=>tone.frequency.events[0].value===440*2**((key-69)/12)));}for(const key of [0,26,35,87,127])receiver.schedule({key,velocity:90,referencePercussion:BASIC_KEY_PERCUSSION},.05,.1,{preserveFrequency:true});assert.equal(h.nodes.filter(node=>node.kind==='buffer-source').length,5);}finally{receiver.silence();}
});

test('preview prefers melodic human targets, permits explicit selector practice, and keeps Listen available outside device range',async()=>{
 const song=basicKeySong(),preview=new ScorePreview({compile:()=>{throw Error('No new notation compiler');},check:async()=>({status:'blocked'})});await preview.select(song.libraryKey,async()=>({score:song.notation,cleanSong:song}));assert.equal(preview.value.part,song.notation.parts[0].id);assert.equal(preview.canStart('listen'),true);assert.equal(preview.canStart('practice'),false);preview.check=async()=>({status:'ready'});await preview.select(song.libraryKey,async()=>({score:song.notation,cleanSong:song}),{part:song.notation.parts[1].id});assert.equal(preview.canStart('practice'),true);
});

test('resource preflight counts complete lookahead allocation intervals and exact gate ends',()=>{
 const notes=Array.from({length:129},(_,i)=>({id:String(i),part_id:i%2?'a':'b',start_ms:i/2,duration_ms:.25}));
 assert.equal(basicKeyAllocationBudget(notes),129,'Only one gate overlaps, but all future nodes are allocated within lookahead');
 assert.equal(basicKeyAllocationBudget(notes,{include:note=>note.part_id==='a'}),64);
 assert.equal(basicKeyAllocationBudget([{start_ms:0,duration_ms:100},{start_ms:200,duration_ms:1}]),1,'Pruning gate ends at the next allocation boundary frees the voice');
});

test('lack of AudioWorklet support explicitly rejects and creates no timer fallback',async()=>{
 const h=harness();try{delete h.context.audioWorklet;await assert.rejects(h.start(),{code:'audio_worklet_unavailable'});assert.equal(h.nodes.length,0);assert.equal(h.player.basicKeys.running,false);}finally{h.close();}
});


test('an accepted audio ACK delayed before the player continuation cannot backdate transport admission',async()=>{
 const h=harness(),original=BasicKeyAudioReceiver.prototype.start;
 BasicKeyAudioReceiver.prototype.start=function(options){return original.call(this,options).then(anchor=>{h.renderTo(anchor.anchorTime+.01);return anchor;});};
 try{await assert.rejects(h.start(),{code:'clean_late_start'});assert.equal(h.player.basicKeys.running,false);assert.equal(h.nodes.at(-1).connected,false);}finally{BasicKeyAudioReceiver.prototype.start=original;h.close();}
});


test('canceling between preparation and the convenience start continuation fences that start',async()=>{
 const h=harness(),basic=h.player.basicKeys,prepare=basic.prepare.bind(basic);
 basic.prepare=options=>prepare(options).then(result=>{queueMicrotask(()=>basic.stop());return result;});
 try{assert.equal(await h.start(),null);assert.equal(basic.running,false);await Promise.resolve();await Promise.resolve();assert.equal(h.nodes.at(-1).connected,false);assert.equal(h.nodes.at(-1).core.startedCount,0);}finally{h.close();}
});

test('per-part colors reach the worklet through convenience start and reset on source preparation',async()=>{
 const h=harness(),ids=h.song.runtime.parts.map(part=>part.id);
 try{
  await h.start({instrumentOverrides:{[ids[0]]:'triangle',[ids[1]]:'reed'}});
  assert.deepEqual([...core(h).plan.timbres],h.player.basicKeys.plan.timbres);assert.ok(core(h).plan.timbres.includes(2));assert.ok(core(h).plan.timbres.includes(3));
  assert.equal(core(h).plan.sourceSha256,h.song.score.source.sha256);assert.equal(core(h).plan.policyId,BASIC_KEY_RENDITION);
  await h.player.prepare({context:h.context,output:h.output,acceptedPolicyId:BASIC_KEY_RENDITION,instrumentOverrides:{}});
  assert.equal(core(h).plan.timbres,undefined);
  await assert.rejects(h.start({instrumentOverrides:{[ids[0]]:'piano'}}),{code:'invalid_instrument_override'});assert.equal(h.player.basicKeys.running,false);
 }finally{h.close();}
});
