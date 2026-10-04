import test from 'node:test';
import assert from 'node:assert/strict';
import {basicKeySong,basicKeyRenditionFixture} from './basic-key-rendition-fixtures.js';
import {fakeAudio} from './clean-song-fixtures.js';
import {prepareCleanSong,basicKeysParts} from '../web/clean-song-package.js';
import {CleanSongPlayer,inspectCleanRendition} from '../web/clean-song-player.js';
import {BASIC_KEY_RENDITION,BASIC_KEY_TIMBRE,BASIC_KEY_PERCUSSION} from '../web/basic-key-player.js';
import {ReferenceAudioReceiver} from '../web/midi-reference-synth.js';
import {ScorePreview} from '../web/score-preview.js';
import {basicKeyAllocationBudget} from '../web/basic-key-rendition.js';

function harness(){const song=basicKeySong(),audio=fakeAudio(),timers=new Map(),errors=[];let position=-50,next=0;const player=new CleanSongPlayer({getPositionMs:()=>position,setTimer:fn=>{timers.set(++next,fn);return next;},clearTimer:id=>timers.delete(id),onError:error=>errors.push(error)});player.select(song);return{song,...audio,player,timers,errors,start:options=>player.start({...audio,acceptedPolicyId:BASIC_KEY_RENDITION,...options}),at:ms=>{position=ms;},pump:()=>{const callback=[...timers.values()][0];timers.clear();callback?.();}};}
const active=h=>h.nodes.filter(node=>['oscillator','buffer-source'].includes(node.kind)&&!node.disconnected);

test('complete basic-key admission joins every attack, percussion and chosen gate without changing source bytes',()=>{
 const opened=basicKeyRenditionFixture(),song=basicKeySong();assert.equal(song.score_json,opened.clean_package.score_json);assert.equal(song.metadata_json,opened.clean_package.metadata_json);assert.equal(song.compilation.timeline.notes.length,5);assert.equal(basicKeysParts(song).reduce((sum,part)=>sum+part.practice_targets,0),5);assert.ok(basicKeysParts(song).every(part=>part.practice_available));assert.equal(inspectCleanRendition(song).supported,true);assert.equal(song.compilation.timeline.notes.find(note=>note.midi===64).duration_ms,20);assert.equal(song.notation.parts[0].notes.length,1);assert.ok(Object.isFrozen(song.runtime.rendition.notes[0]));
 for(const change of [r=>r.rendition.notes.pop(),r=>r.rendition.notes[0][1][1]++,r=>r.rendition.notes[0][2][1]++,r=>r.rendition.notes[1][5]='melodic_key',r=>r.rendition.notes[2][7][0]='999999',r=>r.rendition.note_columns.reverse(),r=>r.rendition.policy_id='guess',r=>r.compilation.timeline.notes[0][0]='wrong',r=>r.compilation.timeline.notes[0][2]++,r=>r.compilation.timeline.notes.reverse(),r=>r.rendition.coverage.derived_voices--]){
  const data=basicKeyRenditionFixture().clean_package;change(data.runtime);assert.throws(()=>prepareCleanSong(`native:song-${data.content_sha256}`,data,JSON.parse(data.score_json).notation),{code:'clean_package_invalid'});
 }
});

test('Listen schedules all native IDs, with percussion fallback and no input/scoring dependencies',()=>{
 const h=harness(),before=JSON.stringify(h.song),scheduled=[],original=ReferenceAudioReceiver.prototype.schedule;
 ReferenceAudioReceiver.prototype.schedule=function(note,start,end,options){scheduled.push({note,start,end});return original.call(this,note,start,end,options);};
 try{h.start();assert.equal(active(h).length,2);assert.equal(scheduled[1].note.referencePercussion.name,'WMH basic percussion pulse');h.at(450);h.context.currentTime=.5;h.pump();assert.equal(scheduled.length,5);assert.equal(new Set(scheduled.map(item=>item.note.eventId)).size,5);assert.equal(scheduled.find(item=>item.note.key===64).end-scheduled.find(item=>item.note.key===64).start,.020000000000000018);assert.equal(JSON.stringify(h.song),before);h.at(1000);h.context.currentTime=1.05;h.pump();assert.equal(active(h).length,0);assert.equal(h.timers.size,0);assert.deepEqual(h.errors,[]);}finally{ReferenceAudioReceiver.prototype.schedule=original;h.player.stop();}
});

test('part practice, user mute and solo filter output after the whole-source interpretation',()=>{
 const h=harness(),[first,drums,last]=h.song.notation.parts;
 try{h.start({mode:'practice',targetPart:first.id});assert.deepEqual(active(h).map(node=>node.kind),['buffer-source']);h.player.stop();h.start({mutedParts:[drums.id],soloParts:[first.id]});assert.equal(active(h).length,1);h.player.stop();h.start({mode:'practice',targetPart:drums.id,soloParts:[first.id,last.id]});assert.equal(active(h).length,1);h.player.stop();h.start({mutedParts:[first.id,drums.id,last.id]});assert.equal(active(h).length,0);assert.equal(h.song.compilation.timeline.notes.length,5);}finally{h.player.stop();}
});

test('pause/reset/resume and stale callbacks cancel every active and scheduled sound',()=>{
 const h=harness();try{assert.throws(()=>h.start({acceptedPolicyId:'other'}),{code:'reference_policy_required'});assert.equal(active(h).length,0);h.start();const stale=[...h.timers.values()][0];h.player.pause();assert.equal(active(h).length,0);stale();assert.equal(h.timers.size,0);h.at(550);h.context.currentTime=1;h.start({resumePositionMs:600});assert.equal(active(h).length,2);assert.ok(active(h).every(node=>node.starts[0]===1.05));h.player.stop();assert.equal(active(h).length,0);h.at(-50);h.start();assert.equal(active(h).length,2);h.at(700);h.pump();assert.equal(h.errors[0].code,'clean_late_scheduler');assert.equal(active(h).length,0);assert.equal(h.timers.size,0);}finally{h.player.stop();}
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

test('a stalled scheduler reports even fully expired notes instead of silently skipping to End',()=>{
 const h=harness();try{h.start();h.at(1200);h.context.currentTime=1.25;h.pump();assert.equal(h.errors.length,1);assert.equal(h.errors[0].code,'clean_late_scheduler');assert.equal(active(h).length,0);assert.equal(h.timers.size,0);}finally{h.player.stop();}
});
