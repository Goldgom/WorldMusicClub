import test from 'node:test';
import assert from 'node:assert/strict';
import {CleanSongPlayer,inspectCleanRendition} from '../web/clean-song-player.js';
import {ReferenceAudioReceiver} from '../web/midi-reference-synth.js';
import {cleanSong,fakeAudio,initialSensitivitySong} from './clean-song-fixtures.js';
function harness(song=cleanSong()){const audio=fakeAudio(),timers=new Map(),errors=[];let position=-50,index=0;const player=new CleanSongPlayer({getPositionMs:()=>position,setTimer:fn=>{timers.set(++index,fn);return index;},clearTimer:id=>timers.delete(id),onError:error=>errors.push(error)});player.select(song);return{...audio,player,timers,errors,position:value=>{position=value;},start:options=>player.start({...audio,...options})};}
test('full reference plays independent program families from the shared clock without global piano',()=>{const h=harness();h.start();const oscillators=h.nodes.filter(node=>node.kind==='oscillator');assert.equal(oscillators.length,4);assert.equal(oscillators[0].starts[0],0.05);assert.notEqual(oscillators[1].frequency.events[0].value,oscillators[3].frequency.events[0].value);assert.equal(h.player.lanes.size,2);h.player.stop();assert.equal(h.timers.size,0);assert.ok(oscillators.every(node=>node.disconnected));});
test('practice human target and muted part never schedule machine voices',()=>{const song=cleanSong(),h=harness(song),[first,second]=song.score.performance.parts;h.start({mode:'practice',targetPart:first.id});assert.equal(h.player.lanes.get(first.id).receiver.voices.size,0);assert.equal(h.player.lanes.get(second.id).receiver.voices.size,1);h.start({mode:'practice',targetPart:first.id,mutedParts:[second.id]});assert.equal(h.nodes.filter(node=>node.kind==='oscillator'&&!node.disconnected).length,0);h.player.stop();});
test('CC91 room is bounded, independently gated, and zero clears wet output',()=>{const song=cleanSong(({runtime,score})=>{for(const events of [runtime.events,score.performance.events]){const event=events.find(e=>e.command.kind==='volume');event.command={kind:'reverb_send',channel:0,value:48};}}),h=harness(song);h.start();const lane=h.player.lanes.get(song.score.performance.parts[0].id);assert.equal(lane.room!==null,true);assert.equal(h.nodes.filter(node=>node.type==='convolver').length,2);const wet=h.nodes.filter(node=>node.type==='gain'&&node.gain.events.some(event=>event.value===0.22));assert.equal(wet.length,1);h.player.command({command:{kind:'reverb_send',channel:0,value:0}},.5);assert.equal(wet[0].gain.value,0);const callback=[...h.timers.values()][0];h.player.pause();assert.ok(h.nodes.filter(node=>node.type==='convolver').every(node=>node.buffer===null&&node.disconnected));callback();assert.equal(h.player.running,false);h.start();assert.equal(h.nodes.filter(node=>node.type==='convolver'&&!node.disconnected).length,2);h.player.stop();});
test('unsupported banks chorus and pressure block the whole rendition; metadata stays supported',()=>{assert.equal(inspectCleanRendition(cleanSong()).supported,true);for(const command of [{kind:'bank_select',channel:0,component:'msb',value:1},{kind:'chorus_send',channel:0,value:1},{kind:'channel_pressure',channel:0,pressure:2}]){const song=cleanSong(({runtime})=>runtime.events[0].command=command);assert.equal(inspectCleanRendition(song).supported,false);const h=harness(song);assert.throws(()=>h.start(),error=>error.code==='clean_renderer_unsupported');assert.equal(h.nodes.length,1);}});
test('scheduler interruption stops all voices and stale callbacks cannot restart',()=>{const h=harness();h.start();const callback=[...h.timers.values()][0];h.position(900);h.context.currentTime=.95;callback();assert.equal(h.errors[0].code,'clean_late_scheduler');assert.equal(h.player.running,false);assert.equal(h.player.lanes.size,0);callback();assert.equal(h.errors.length,1);});
test('resume uses each held note onset program even after later program changes',()=>{const song=cleanSong(({runtime})=>{runtime.events.push({event_id:'unit-program',at_ms:100,origin:{track:1,event:50},command:{kind:'instrument_program',channel:0,program:48}});runtime.events.sort((a,b)=>a.at_ms-b.at_ms);}),h=harness(song);h.position(250);h.start();const lane=h.player.lanes.get(song.score.performance.parts[0].id);assert.equal(lane.receiver.voices.size,1);assert.equal(h.player.programs.get(song.runtime.notes[0].event_id),0);h.player.stop();});
test('partial audio allocation failure releases all prior lanes and suppresses playback',()=>{const h=harness(),create=h.context.createStereoPanner;let count=0;h.context.createStereoPanner=()=>{if(++count===2)throw new Error('device allocation failed');return create();};assert.throws(()=>h.start(),/device allocation/);assert.equal(h.player.running,false);assert.equal(h.player.lanes.size,0);assert.ok(h.nodes.filter(node=>node.kind!=='output').every(node=>node.disconnected));assert.equal(h.timers.size,0);});
test('resumed held notes wait for the same admission boundary as the shared transport',()=>{const h=harness();h.position(200);h.start({resumePositionMs:250});const onsets=h.nodes.filter(node=>node.kind==='oscillator').flatMap(node=>node.starts);assert.deepEqual(onsets,[.05,.05,.05,.05]);h.player.stop();});


test('default browser timer calls retain their global receiver through start and pause',()=>{
 const originalSet=globalThis.setTimeout,originalClear=globalThis.clearTimeout,timers=new Map();let sequence=0;
 globalThis.setTimeout=function(callback){assert.equal(this,globalThis,'browser timer receiver');timers.set(++sequence,callback);return sequence;};
 globalThis.clearTimeout=function(id){assert.equal(this,globalThis,'browser timer cancellation receiver');timers.delete(id);};
 const audio=fakeAudio(),player=new CleanSongPlayer({getPositionMs:()=>-50});
 try{player.select(cleanSong());player.start(audio);assert.equal(timers.size,1);player.pause();assert.equal(timers.size,0);assert.equal(player.running,false);player.start(audio);assert.equal(timers.size,1);player.stop();assert.equal(timers.size,0);}
 finally{player.stop();globalThis.setTimeout=originalSet;globalThis.clearTimeout=originalClear;}
});

test('initial sensitivity is applied with centered bend and preserves every scheduled key and silent track',()=>{
  const song=initialSensitivitySong(),h=harness(song),scheduled=[];
  const original=ReferenceAudioReceiver.prototype.schedule;
  ReferenceAudioReceiver.prototype.schedule=function(note,start,end){scheduled.push({note,start,end});return original.call(this,note,start,end);};
  try{
    assert.equal(inspectCleanRendition(song).supported,true);
    h.start();
    for(const channel of [0,1,2]){
      const state=h.player.channels.get(channel);
      assert.equal(state.sensitivity_step,6);assert.equal(state.sensitivity_semitones,24);assert.equal(state.sensitivity_cents,0);
      assert.equal(state.pitch_bend,0);assert.equal(state.rpn_most_significant,127);assert.equal(state.rpn_least_significant,127);
    }
    assert.equal(song.score.performance.tracks.length,4);assert.equal(h.player.lanes.size,2);
    for(let position=0;position<=2000;position+=20){h.position(position);h.context.currentTime=(position+50)/1000;h.player.pump();}
    assert.equal(h.errors.length,0);
    assert.deepEqual(scheduled.map(item=>[item.note.eventId,item.note.key]),song.runtime.notes.map(note=>[note.event_id,note.key]));
    for(const item of scheduled){const note=song.runtime.notes.find(note=>note.event_id===item.note.eventId);assert.ok(Math.abs(item.start-(note.start_ms+50)/1000)<1e-12);assert.ok(Math.abs(item.end-(note.end_ms+50)/1000)<1e-12);}
    h.player.stop();
    h.position(250);scheduled.length=0;h.start();
    assert.equal(scheduled.length,2);assert.ok(scheduled.every(item=>item.start===h.context.currentTime));
    for(const part of song.score.performance.parts){
      h.position(-50);h.context.currentTime=0;scheduled.length=0;h.start({mode:'practice',targetPart:part.id});
      assert.ok(scheduled.every(item=>song.runtime.notes.find(note=>note.event_id===item.note.eventId).part_id!==part.id));
      assert.equal(scheduled.length,1);
    }
  }finally{h.player.stop();ReferenceAudioReceiver.prototype.schedule=original;}
});
test('renderer refuses malformed or mismatched sensitivity groups before allocating audio',()=>{
  for(const change of [
    ({runtime})=>{const index=runtime.events.findIndex(e=>e.command.kind==='initial_pitch_bend_sensitivity');[runtime.events[index],runtime.events[index+1]]=[runtime.events[index+1],runtime.events[index]];},
    ({runtime})=>{runtime.events.splice(runtime.events.findIndex(e=>e.command.kind==='initial_pitch_bend_sensitivity'),1);},
    ({runtime})=>{runtime.events.find(e=>e.command.kind==='initial_pitch_bend_sensitivity').command.step='set_semitones12';},
    ({runtime})=>{runtime.events.find(e=>e.command.kind==='initial_pitch_bend_sensitivity').command.value=0;},
    ({runtime})=>{runtime.events.find(e=>e.command.kind==='initial_pitch_bend_sensitivity').at_ms=1;},
    ({runtime})=>{runtime.events.find(e=>e.command.kind==='initial_pitch_bend_sensitivity').origin.event+=1;},
    ({runtime})=>{runtime.events.find(e=>e.command.kind==='initial_pitch_bend_sensitivity').command.channel=1;},
    ({runtime})=>{runtime.events.push({at_ms:500,origin:{track:1,event:100},command:{kind:'pitch_bend',channel:0,value:0}});},
    ({score,runtime})=>{for(const events of [score.performance.events,runtime.events])events.filter(e=>e.command.kind==='initial_pitch_bend_sensitivity').slice(0,6).forEach((event,index)=>{if(index===1)event.command.step='select_most_significant_zero';});},
  ]){
    const song=initialSensitivitySong(change),h=harness(song);
    assert.equal(inspectCleanRendition(song).supported,false);
    assert.throws(()=>h.start(),error=>error.code==='clean_renderer_unsupported');assert.equal(h.nodes.length,1);
  }
});
