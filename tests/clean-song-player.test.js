import test from 'node:test';
import assert from 'node:assert/strict';
import {CleanSongPlayer,inspectCleanRendition} from '../web/clean-song-player.js';
import {ReferenceAudioReceiver} from '../web/midi-reference-synth.js';
import {cleanSong,fakeAudio,initialSensitivitySong,initialSensitivity12Song} from './clean-song-fixtures.js';
function harness(song=cleanSong()){const audio=fakeAudio(),timers=new Map(),errors=[];let position=-50,index=0;const player=new CleanSongPlayer({getPositionMs:()=>position,setTimer:fn=>{timers.set(++index,fn);return index;},clearTimer:id=>timers.delete(id),onError:error=>errors.push(error)});player.select(song);return{...audio,player,timers,errors,position:value=>{position=value;},start:options=>player.start({...audio,...options})};}
const authoredDeviceName='Authored receiver 音源  ';
function nameChannelTracks({score,runtime}){for(const events of [score.performance.events,runtime.events])for(const event of events)if(event.origin.track>0&&event.origin.event===0)event.command={kind:'text',role:'device_name',text:authoredDeviceName};}
const namedSong=edit=>cleanSong(data=>{nameChannelTracks(data);edit?.(data);});
test('full reference plays independent program families from the shared clock without global piano',()=>{const h=harness();h.start();const oscillators=h.nodes.filter(node=>node.kind==='oscillator');assert.equal(oscillators.length,4);assert.equal(oscillators[0].starts[0],0.05);assert.notEqual(oscillators[1].frequency.events[0].value,oscillators[3].frequency.events[0].value);assert.equal(h.player.lanes.size,2);h.player.stop();assert.equal(h.timers.size,0);assert.ok(oscillators.every(node=>node.disconnected));});
test('practice human target and muted part never schedule machine voices',()=>{const song=cleanSong(),h=harness(song),[first,second]=song.score.performance.parts;h.start({mode:'practice',targetPart:first.id});assert.equal(h.player.lanes.get(first.id).receiver.voices.size,0);assert.equal(h.player.lanes.get(second.id).receiver.voices.size,1);h.start({mode:'practice',targetPart:first.id,mutedParts:[second.id]});assert.equal(h.nodes.filter(node=>node.kind==='oscillator'&&!node.disconnected).length,0);h.player.stop();});
test('legacy source renderer uses the full explicit human union for lane gains and every scheduled gate',()=>{
 const song=cleanSong(),before=JSON.stringify(song),[first,second]=song.score.performance.parts,original=ReferenceAudioReceiver.prototype.schedule;let scheduled=[];
 ReferenceAudioReceiver.prototype.schedule=function(note,start,end){scheduled.push({note,start,end});return original.call(this,note,start,end);};
 try{
  for(const [options,humans] of [
   [{mode:'listen',practiceSelection:{kind:'all'}},[]],
   [{mode:'practice',practiceSelection:{kind:'all'}},[first.id,second.id]],
   [{mode:'practice',targetPart:first.id,practiceSelection:{kind:'parts',part_ids:[second.id,first.id]}},[first.id,second.id]],
   [{mode:'practice',targetPart:second.id,practiceSelection:{kind:'parts',part_ids:[first.id]}},[first.id]],
  ]){
   const h=harness(song);scheduled=[];
   try{
    h.start(options);assert.deepEqual([...h.player.humanParts],humans);
    for(const part of song.score.performance.parts){h.player.command({command:{kind:'volume',channel:part.channel,value:127}},0);h.player.command({command:{kind:'reverb_send',channel:part.channel,value:48}},0);assert.equal(h.player.lanes.get(part.id).gain.gain.value,humans.includes(part.id)?0:1);}
    for(let position=0;position<=1800;position+=20){h.position(position);h.context.currentTime=(position+50)/1000;h.player.pump();}
    assert.deepEqual(scheduled.map(item=>item.note.eventId),song.runtime.notes.filter(note=>!humans.includes(note.part_id)).map(note=>note.event_id));assert.deepEqual(h.errors,[]);
    for(const item of scheduled){const note=song.runtime.notes.find(note=>note.event_id===item.note.eventId);assert.equal(item.note.key,note.key);assert.ok(Math.abs(item.start-(note.start_ms+50)/1000)<1e-12);assert.ok(Math.abs(item.end-(note.end_ms+50)/1000)<1e-12);}
   }finally{h.player.stop();}
  }
  assert.equal(JSON.stringify(song),before);
  for(const practiceSelection of [{kind:'parts',part_ids:[]},{kind:'parts',part_ids:['missing']},{kind:'parts',part_ids:[first.id,first.id]}]){const h=harness(song);assert.throws(()=>h.start({mode:'practice',practiceSelection}),{code:'clean_target_required'});assert.equal(h.nodes.length,1);h.player.stop();}
 }finally{ReferenceAudioReceiver.prototype.schedule=original;}
});
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

test('canonical reference supports only named zero origins with rate identity preserved',()=>{
 const timecode={frame_rate:'fps30',hours:0,minutes:0,seconds:0,frames:0,fractional_frames:0};
 const good=cleanSong(({runtime,score})=>{for(const events of [runtime.events,score.performance.events])events[0].command={kind:'smpte_offset',timecode};});
 assert.equal(inspectCleanRendition(good).supported,true);const h=harness(good);h.start();assert.equal(h.nodes.filter(node=>node.kind==='oscillator').length,4);h.player.stop();
 for(const change of [e=>e.command.timecode.hours=1,e=>e.command.timecode.frame_rate='unknown',e=>e.at_ms=1,e=>e.origin.track=1,e=>e.exact_microseconds={numerator:'1',denominator:3},e=>e.exact_microseconds={numerator:'0',denominator:0}]){
  const bad=cleanSong(({runtime})=>{runtime.events[0].command={kind:'smpte_offset',timecode:{...timecode}};change(runtime.events[0]);});
  assert.equal(inspectCleanRendition(bad).supported,false);
 }
});

test('zero origin checks channel source coordinates even in reordered runtime arrays',()=>{
 const timecode={frame_rate:'fps30',hours:0,minutes:0,seconds:0,frames:0,fractional_frames:0};
 const bad=cleanSong(({runtime})=>{runtime.events[0].origin.event=1;runtime.events[0].command={kind:'smpte_offset',timecode};runtime.events[1].origin={track:0,event:0};runtime.events[1].command={kind:'instrument_program',channel:0,program:0};});
 assert.equal(inspectCleanRendition(bad).supported,false);
});

test('all three twelve-semitone groups preserve repeated steps, fractional clocks and unchanged audible keys',()=>{
 const song=initialSensitivity12Song(),h=harness(song),scheduled=[],before=JSON.stringify(song);
 const original=ReferenceAudioReceiver.prototype.schedule;
 ReferenceAudioReceiver.prototype.schedule=function(note,start,end){scheduled.push({note,start,end});return original.call(this,note,start,end);};
 try{
  assert.equal(inspectCleanRendition(song).supported,true);h.start();
  for(const [channel,length] of [[0,4],[1,8],[2,8]]){
   const state=h.player.channels.get(channel);
   assert.equal(state.sensitivity12_steps.length,length);assert.equal(state.sensitivity_semitones,12);
   assert.equal(state.sensitivity_cents,0);assert.equal(state.pitch_bend,0);
   assert.equal(state.rpn_most_significant,0);assert.equal(state.rpn_least_significant,0);
  }
  for(let position=0;position<=2000;position+=20){h.position(position);h.context.currentTime=(position+50)/1000;h.player.pump();}
  assert.equal(h.errors.length,0);assert.deepEqual(scheduled.map(item=>[item.note.eventId,item.note.key]),song.runtime.notes.map(note=>[note.event_id,note.key]));
  for(const item of scheduled){const note=song.runtime.notes.find(note=>note.event_id===item.note.eventId);assert.ok(Math.abs(item.start-(note.start_ms+50)/1000)<1e-12);assert.ok(Math.abs(item.end-(note.end_ms+50)/1000)<1e-12);}
  assert.equal(JSON.stringify(song),before);assert.equal(song.score.performance.tracks.length,4);
  h.player.pause();h.position(250);scheduled.length=0;h.start();assert.equal(scheduled.length,2);
  for(const part of song.score.performance.parts){h.position(-50);h.context.currentTime=0;scheduled.length=0;h.start({mode:'practice',targetPart:part.id});assert.equal(scheduled.length,1);assert.ok(scheduled.every(item=>song.runtime.notes.find(note=>note.event_id===item.note.eventId).part_id!==part.id));}
 }finally{h.player.stop();ReferenceAudioReceiver.prototype.schedule=original;}
});

test('twelve-semitone setup permits the reviewed program and controller prefix but still blocks nonzero banks',()=>{
 for(const command of [{kind:'instrument_program',program:24},{kind:'bank_select',component:'most_significant',value:0},
  {kind:'volume',value:90},{kind:'pan',value:32},{kind:'expression',value:80},{kind:'reverb_send',value:24},{kind:'chorus_send',value:0}]){
  const song=initialSensitivity12Song(({score,runtime})=>{for(const events of [score.performance.events,runtime.events])events.find(e=>e.command.kind==='instrument_program'&&e.command.channel===0).command={...command,channel:0};});
  assert.equal(inspectCleanRendition(song).supported,true,command.kind);
 }
 const song=initialSensitivity12Song(({score,runtime})=>{for(const events of [score.performance.events,runtime.events])events.find(e=>e.command.kind==='instrument_program'&&e.command.channel===0).command={kind:'bank_select',component:'most_significant',value:1,channel:0};});
 assert.deepEqual(inspectCleanRendition(song).blockers,['bank_select']);
});

test('strict twelve-semitone admission rejects malformed, incomplete, reordered and misplaced groups before allocation',()=>{
 const kind='initial_pitch_bend_sensitivity12',first=events=>events.find(event=>event.command.kind===kind);
 const both=(data,edit)=>{for(const events of [data.score.performance.events,data.runtime.events])edit(events);};
 const edits=[
  data=>both(data,events=>first(events).command.step='set_semitones24'),
  data=>both(data,events=>first(events).command.step='deselect_most_significant'),
  data=>both(data,events=>first(events).command.value=12),
  data=>both(data,events=>first(events).command.channel=16),
  data=>both(data,events=>first(events).command.kind='text'),
  data=>both(data,events=>{const event=events.find(e=>e.command.kind==='instrument_program'&&e.command.channel===0);event.command={kind:'initial_sustain_off',channel:0};}),
  data=>both(data,events=>{const event=events.find(e=>e.command.kind==='instrument_program'&&e.command.channel===0);event.command={kind:'channel_pressure',channel:0,pressure:0};}),
  data=>both(data,events=>{events.find(e=>e.command.kind==='pan'&&e.command.channel===1).command={kind:'volume',channel:0,value:0};}),
  data=>both(data,events=>{const group=events.filter(e=>e.command.kind===kind&&e.command.channel===0);group.at(-1).command.step='set_semitones12';}),
  data=>both(data,events=>{events.find(e=>e.command.kind==='volume'&&e.command.channel===0).command={kind,channel:0,step:'select_least_significant_zero'};}),
  data=>both(data,events=>{events.find(e=>e.command.kind==='pan'&&e.command.channel===0).command={kind:'pitch_bend',channel:0,value:0};}),
  ({runtime})=>{const index=runtime.events.findIndex(e=>e.command.kind===kind);[runtime.events[index],runtime.events[index+1]]=[runtime.events[index+1],runtime.events[index]];},
  ({runtime})=>first(runtime.events).exact_microseconds.denominator=0,
  ({runtime})=>first(runtime.events).exact_microseconds.numerator='-1',
  ({runtime})=>first(runtime.events).at_ms+=0.01,
  ({runtime})=>first(runtime.events).origin.event++,
  ({runtime})=>runtime.notes[0].attack.event++,
  ({score})=>first(score.performance.events).at.numerator=-1,
  ({score})=>{for(const event of score.performance.events)if(event.at.numerator>0&&event.at.denominator===9600)event.at.numerator+=9600;},
  data=>{for(const events of [data.score.performance.events,data.runtime.events])for(const event of events.filter(e=>e.command.kind===kind&&e.command.channel===0)){
   if(event.at)event.at={numerator:1,denominator:1};else{event.at_ms=500;event.exact_microseconds={numerator:'500000',denominator:1};}
  }data.score.performance.events.sort((a,b)=>a.at.numerator/a.at.denominator-b.at.numerator/b.at.denominator||a.origin.track-b.origin.track||a.origin.event-b.origin.event);data.runtime.events.sort((a,b)=>a.at_ms-b.at_ms||a.origin.track-b.origin.track||a.origin.event-b.origin.event);},
 ];
 for(const edit of edits){const song=initialSensitivity12Song(edit),h=harness(song);assert.equal(inspectCleanRendition(song).supported,false);assert.throws(()=>h.start(),error=>error.code==='clean_renderer_unsupported');assert.equal(h.nodes.length,1);}
});

test('strict twelve-semitone source clocks and canonical key activity are checked independently from runtime clocks',()=>{
 const edits=[
  // Both clocks stay ordered and before all runtime keys; only their binding differs.
  ({score})=>{for(const event of score.performance.events)if(event.at.denominator===9600)event.at.numerator*=2;},
  ({runtime})=>{for(const event of runtime.events)if(event.at_ms>0&&event.at_ms<1){event.exact_microseconds.numerator=String(BigInt(event.exact_microseconds.numerator)*2n);event.at_ms*=2;}},
  ({score,runtime})=>{for(const events of [score.performance.events,runtime.events])events.find(e=>e.command.kind==='tempo').command.microseconds_per_quarter=600000;},
  // Runtime clocks and setup clocks remain unchanged; canonical source keys now precede setup.
  ({runtime})=>{runtime.compilation.score.parts[0].notes[0].at={numerator:0,denominator:1};},
  ({runtime})=>{runtime.compilation.score.parts[0].notes[0].duration={numerator:0,denominator:1};},
  ({score,runtime})=>{score.performance.notes[0].attack=null;runtime.notes[0].attack=null;},
 ];
 for(const edit of edits){const song=initialSensitivity12Song(edit),h=harness(song);assert.equal(inspectCleanRendition(song).supported,false);assert.throws(()=>h.start(),error=>error.code==='clean_renderer_unsupported');assert.equal(h.nodes.length,1);}
});

test('strict twelve-semitone final steps can share an exact key time when source coordinates put setup first',()=>{
 const song=initialSensitivity12Song(({score,runtime})=>{
  for(const event of score.performance.events)if(event.at.denominator===9600)event.at={numerator:1,denominator:480};
  for(const event of runtime.events)if(event.at_ms>0&&event.at_ms<1){event.exact_microseconds={numerator:'3125',denominator:3};event.at_ms=3125/3/1000;}
  score.performance.events.sort((a,b)=>a.at.numerator/a.at.denominator-b.at.numerator/b.at.denominator||a.origin.track-b.origin.track||a.origin.event-b.origin.event);
  runtime.events.sort((a,b)=>a.at_ms-b.at_ms||a.origin.track-b.origin.track||a.origin.event-b.origin.event);
 });
 assert.equal(inspectCleanRendition(song).supported,true);const h=harness(song);h.start();assert.equal(h.errors.length,0);assert.equal(h.nodes.filter(node=>node.kind==='oscillator').length,4);h.player.stop();
});

test('strict twelve-semitone clock binding follows a nonzero native tempo anchor without replacing runtime time',()=>{
 const song=initialSensitivity12Song(({score,runtime})=>{
  for(const events of [score.performance.events,runtime.events]){
   const text=events.find(event=>event.origin.track===0&&event.origin.event===0),tempo=events.find(event=>event.command.kind==='tempo');
   text.command={kind:'tempo',microseconds_per_quarter:500000};tempo.command.microseconds_per_quarter=600000;
   if(tempo.at)tempo.at={numerator:2,denominator:9600};else{tempo.exact_microseconds={numerator:'625',denominator:6};tempo.at_ms=625/6/1000;}
  }
  const changeClock=value=>{
   if(BigInt(value.numerator)*6n<BigInt(value.denominator)*625n)return value;
   let n=BigInt(value.numerator)*36n-625n*BigInt(value.denominator),d=BigInt(value.denominator)*30n,a=n,b=d;
   while(b)[a,b]=[b,a%b];return{numerator:String(n/a),denominator:Number(d/a)};
  };
  const milliseconds=value=>Number(value.numerator)/value.denominator/1000;
  for(const event of runtime.events){event.exact_microseconds=changeClock(event.exact_microseconds);event.at_ms=milliseconds(event.exact_microseconds);}
  for(const note of runtime.notes){note.start_microseconds=changeClock(note.start_microseconds);note.end_microseconds=changeClock(note.end_microseconds);note.start_ms=milliseconds(note.start_microseconds);note.end_ms=milliseconds(note.end_microseconds);}
  runtime.duration_microseconds=changeClock(runtime.duration_microseconds);runtime.duration_ms=milliseconds(runtime.duration_microseconds);runtime.compilation.timeline.duration_ms=runtime.duration_ms;
  for(const note of runtime.compilation.timeline.notes){const timed=runtime.notes.find(item=>item.note_id===note.id);note.start_ms=timed.start_ms;note.duration_ms=timed.end_ms-timed.start_ms;}
  score.performance.events.sort((a,b)=>a.at.numerator/a.at.denominator-b.at.numerator/b.at.denominator||a.origin.track-b.origin.track||a.origin.event-b.origin.event);
  runtime.events.sort((a,b)=>a.at_ms-b.at_ms||a.origin.track-b.origin.track||a.origin.event-b.origin.event);
 });
 const before=JSON.stringify(song.runtime);assert.equal(inspectCleanRendition(song).supported,true);const h=harness(song);h.start();assert.equal(h.errors.length,0);assert.equal(JSON.stringify(song.runtime),before);h.player.stop();
});

test('strict named route requires its explicit policy and preserves every source note and scheduled instant',()=>{
 const song=namedSong(),profile=inspectCleanRendition(song),h=harness(song),scheduled=[],before=JSON.stringify(song);
 assert.equal(profile.supported,true);assert.equal(profile.logical_device_mapping.device_name,authoredDeviceName);
 assert.equal(profile.logical_device_mapping.receiver,'wmh-procedural-reference-v1');
 assert.equal(profile.logical_device_mapping.policy,'single_named_device_to_procedural_receiver');
 assert.deepEqual(inspectCleanRendition(song).logical_device_mapping,profile.logical_device_mapping);
 const displayCopy=inspectCleanRendition(song).logical_device_mapping;Reflect.set(displayCopy,'device_name','Altered display copy');
 assert.equal(inspectCleanRendition(song).logical_device_mapping.device_name,authoredDeviceName);
 assert.match(profile.rendition,/:single-named-device-v1$/);
 assert.throws(()=>h.start(),{code:'reference_policy_required'});assert.equal(h.nodes.length,1);
 const original=ReferenceAudioReceiver.prototype.schedule;
 ReferenceAudioReceiver.prototype.schedule=function(note,start,end){scheduled.push({note,start,end});return original.call(this,note,start,end);};
 try{
  h.start({acceptedPolicyId:profile.rendition});
  for(let position=0;position<=1800;position+=20){h.position(position);h.context.currentTime=(position+50)/1000;h.player.pump();}
  assert.deepEqual(scheduled.map(item=>item.note.eventId),song.runtime.notes.map(note=>note.event_id));
  for(const item of scheduled){const note=song.runtime.notes.find(note=>note.event_id===item.note.eventId);assert.equal(item.note.key,note.key);assert.ok(Math.abs(item.start-(note.start_ms+50)/1000)<1e-12);assert.ok(Math.abs(item.end-(note.end_ms+50)/1000)<1e-12);}
  assert.equal(JSON.stringify(song),before);assert.equal(h.errors.length,0);
 }finally{h.player.stop();ReferenceAudioReceiver.prototype.schedule=original;}
});

test('strict named routing includes silent control tracks and reviewed fractional twelve-semitone setup',()=>{
 const song=initialSensitivity12Song(nameChannelTracks),profile=inspectCleanRendition(song),h=harness(song);
 assert.equal(profile.supported,true);h.start({acceptedPolicyId:profile.rendition});
 assert.equal(h.player.channels.get(2).sensitivity_semitones,12);assert.equal(h.player.lanes.size,2);h.player.stop();
 const bad=initialSensitivity12Song(data=>{nameChannelTracks(data);for(const events of [data.score.performance.events,data.runtime.events])events.find(event=>event.origin.track===3&&event.origin.event===0).command.role='track_name';});
 assert.equal(inspectCleanRendition(bad).logical_device_route_reason,'mixed_named_default_routes');
});

test('strict unresolved logical routes block before audio allocation without discarding retained source events',()=>{
 const both=(data,edit)=>{for(const events of [data.score.performance.events,data.runtime.events])edit(events);};
 const first=events=>events.find(event=>event.origin.track===1&&event.origin.event===0);
 const edits=[
  data=>both(data,events=>first(events).command.text=''),
  data=>both(data,events=>first(events).command.text=' \t\n'),
  data=>both(data,events=>events.find(event=>event.origin.track===2&&event.origin.event===0).command.text='Other authored device'),
  data=>both(data,events=>events.find(event=>event.origin.track===2&&event.origin.event===0).command.role='track_name'),
  data=>both(data,events=>{events.find(event=>event.origin.track===1&&event.origin.event===1).command={kind:'text',role:'device_name',text:authoredDeviceName};}),
  data=>both(data,events=>{first(events).command={kind:'text',role:'program_name',text:'Authored program'};events.find(event=>event.origin.track===1&&event.origin.event===1).command={kind:'text',role:'device_name',text:authoredDeviceName};}),
  data=>both(data,events=>{first(events).command={kind:'instrument_program',channel:0,program:0};events.find(event=>event.origin.track===1&&event.origin.event===1).command={kind:'text',role:'device_name',text:authoredDeviceName};}),
  data=>both(data,events=>{events[0].command={kind:'text',role:'device_name',text:'Other authored conductor'};}),
  data=>both(data,events=>{for(const event of events)if(event.origin.track===2&&event.command.channel!==undefined)event.command.channel=0;}),
  data=>both(data,events=>{const event=first(events);if(event.at)event.at={numerator:1,denominator:500000};else{event.exact_microseconds={numerator:'1',denominator:1};event.at_ms=.001;}}),
 ];
 for(const edit of edits){const song=namedSong(edit),before=JSON.stringify(song),profile=inspectCleanRendition(song),h=harness(song);assert.equal(profile.supported,false);assert.ok(profile.blockers.includes('unresolved_logical_device_route'));assert.equal(profile.logical_device_mapping,null);assert.throws(()=>h.start(),{code:'clean_renderer_unsupported'});assert.equal(h.nodes.length,1);assert.equal(JSON.stringify(song),before);}
});

test('strict named routing rejects source/runtime name, coordinate and exact clock disagreements',()=>{
 const first=events=>events.find(event=>event.origin.track===1&&event.origin.event===0);
 const edits=[
  ({runtime})=>first(runtime.events).command.text='Changed authored device',
  ({runtime})=>first(runtime.events).command.role='track_name',
  ({score})=>first(score.performance.events).command.role='track_name',
  ({runtime})=>first(runtime.events).origin.event++,
  ({score})=>first(score.performance.events).origin.event++,
  ({runtime})=>first(runtime.events).event_id='unbound-event',
  ({runtime})=>first(runtime.events).exact_microseconds.numerator='1',
  ({runtime})=>first(runtime.events).exact_microseconds.denominator=0,
  ({runtime})=>first(runtime.events).at_ms=.001,
  ({score})=>first(score.performance.events).at.numerator=1,
  ({runtime})=>runtime.notes[0].attack.event++,
  ({score})=>score.performance.notes[0].release.event++,
  ({runtime})=>runtime.notes[0].start_microseconds.numerator='1',
  ({runtime})=>runtime.compilation.score.parts[0].notes[0].at={numerator:1,denominator:1},
 ];
 for(const edit of edits){const song=namedSong(edit),profile=inspectCleanRendition(song),h=harness(song);assert.equal(profile.supported,false);assert.equal(profile.logical_device_route_reason,'source_runtime_binding');assert.throws(()=>h.start(),{code:'clean_renderer_unsupported'});assert.equal(h.nodes.length,1);}
});

test('strict no-name policy stays unchanged, bank zero remains required and unsupported runtime routes never become metadata',()=>{
 assert.equal(inspectCleanRendition(cleanSong()).rendition,'wmh-procedural-reference-v1');
 assert.equal(inspectCleanRendition(cleanSong()).logical_device_mapping,null);
 const bank=namedSong(({score,runtime})=>{for(const events of [score.performance.events,runtime.events])events.find(event=>event.command.kind==='volume').command={kind:'bank_select',channel:0,component:'most_significant',value:1};});
 assert.deepEqual(inspectCleanRendition(bank).blockers,['bank_select']);assert.ok(inspectCleanRendition(bank).logical_device_mapping);
 for(const command of [{kind:'midi_port',port:0},{kind:'channel_prefix',channel:0},{kind:'sysex',data:[]},{kind:'sys_ex',data:[]},{kind:'text',role:'midi_port',text:'0'}]){
  const song=cleanSong(({runtime})=>runtime.events[0].command=command),profile=inspectCleanRendition(song),h=harness(song);
  assert.equal(profile.supported,false);assert.deepEqual(profile.blockers,['unresolved_logical_device_route']);assert.throws(()=>h.start(),{code:'clean_renderer_unsupported'});assert.equal(h.nodes.length,1);
 }
});

test('strict named route labels match source UTF-8/control bounds and preserve exact spaces and case',()=>{
 const named=name=>initialSensitivitySong(data=>{nameChannelTracks(data);for(const events of [data.score.performance.events,data.runtime.events])for(const event of events)if(event.command.role==='device_name')event.command.text=name;});
 for(const name of ['Route\0A','Route\nA','Route\tA','Route\rA','Route\x7fA','Route\u0085A','\u00a0\u2003','A'.repeat(4097),'é'.repeat(2049),'Route\ud800A','A'.repeat(257),'DM: literal route','\u2003DM: literal route']){
  const result=inspectCleanRendition(named(name));assert.equal(result.supported,false);assert.equal(result.logical_device_route_reason,'empty_or_invalid_name');
 }
 for(const name of ['  Studio A  ','  studio a  ','A'.repeat(256),'A '.repeat(2048),'é'.repeat(2048),'🎹'.repeat(1024)]){
  const result=inspectCleanRendition(named(name));assert.equal(result.supported,true);assert.equal(result.logical_device_mapping.device_name,name);
 }
});


test('explicit resume excludes a gate ended inside the 50 ms admission lead',()=>{
 const h=harness(),scheduled=[],original=ReferenceAudioReceiver.prototype.schedule;
 ReferenceAudioReceiver.prototype.schedule=function(note,start,end,...options){scheduled.push({note,start,end});return original.call(this,note,start,end,...options);};
 try{h.position(984.6);h.start({resumePositionMs:1034.6});assert.ok(scheduled.length);assert.ok(scheduled.every(row=>row.end>row.start));assert.ok(scheduled.every(row=>h.player.song.runtime.notes.find(note=>note.event_id===row.note.eventId).end_ms>1034.6));}finally{h.player.stop();ReferenceAudioReceiver.prototype.schedule=original;}
});

test('legacy references reject requested synthetic overrides before allocating or silently falling back',()=>{
 const h=harness(),id=h.player.song.score.performance.parts[0].id;
 assert.throws(()=>h.start({instrumentOverrides:{[id]:'triangle'}}),{code:'invalid_instrument_override'});
 assert.throws(()=>h.player.prepare({instrumentOverrides:{[id]:'triangle'}}),{code:'invalid_instrument_override'});
 assert.equal(h.nodes.length,1);assert.equal(h.player.running,false);
});
