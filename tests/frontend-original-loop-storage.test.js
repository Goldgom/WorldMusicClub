import test from 'node:test';
import assert from 'node:assert/strict';
import {nativeScoreServer,nativeStorageApp,nativeResponse} from './native-storage-app-fixtures.js';
import {compileBrowserFixture} from './frontend-browser-compilation-fixture.js';
import {fixture} from './frontend-fixtures.js';
import {beat} from '../web/music.js';
import {readPlaybackClock} from '../web/playback-clock-view.js';
import {capturePlaybackEventTime} from './browser-playback-clock.js';

// Production handlers, original exercises, and an in-memory DOM/protocol.
// No browser, listener, native application, or user score files are opened.
async function setup({late=false,outOfRangeTail=false,localStorageDescriptor}={}) {
  const score=structuredClone(fixture);score.id='original-loop-storage';score.title='Original loop and storage exercise';
  if(late){score.tempo[0].bpm=240;score.parts[0].notes=[{...score.parts[0].notes[0],at:{numerator:9,denominator:5},duration:{numerator:1,denominator:5}}];score.measures[0].length={numerator:2,denominator:1};}
  if(outOfRangeTail)score.parts[0].notes[1].pitch.octave=9;
  const server=await nativeScoreServer({scores:[score]});let wall=1000;
  server.setRoute(({path,body})=>{
    if(path==='/api/compile')return nativeResponse(compileBrowserFixture(body));
    if(path==='/api/instrument-check')return nativeResponse({lowest_midi:36,highest_midi:96,note_options:body.timeline.notes.map(note=>({note_id:note.id,midi:note.midi,playable:note.midi>=36&&note.midi<=96,positions:[]})),diagnostics:[],changed_source_notes:false});
    if(path==='/api/practice-window'){
      const unit=60000/body.score.tempo[0].bpm,start=beat(body.from)*unit,end=beat(body.to)*unit;
      return nativeResponse({start_ms:start,end_ms:end,target_note_ids:compileBrowserFixture(body.score).timeline.notes.filter(note=>note.start_ms>=start&&note.start_ms<end).map(note=>note.id),crossing_notes:0,diagnostics:[]});
    }
    if(path==='/api/assess')return nativeResponse({hits:body.inputs.map(()=>({grade:'perfect',note_id:'c4'})),misses:[],extras:[],accuracy_percent:100,mean_abs_error_ms:0});
    if(path.includes('/assistance/')||path.includes('/practice-assistance/'))return nativeResponse({code:'unexpected_assistance_opt_in',error:'Original part assignments must not require note assistance'},422);
  });
  const app=await nativeStorageApp(server,{now:()=>wall,localStorageDescriptor}),key=[...server.records.keys()][0];
  await app.until(()=>Boolean(app.savedButton(key)));await app.click('home-single-player');app.savedButton(key).click();await app.until(()=>!app.$('configure-song-mod').disabled);
  const set=(id,value,type='change')=>{app.$(id).value=String(value);app.emit(app.$(id),type);};
  const apply=async()=>{await app.click('song-mod-apply');await app.until(()=>!app.$('song-mod-dialog').open||Boolean(app.$('song-mod-error').textContent));assert.equal(app.$('song-mod-dialog').open,false,app.$('song-mod-error').textContent);};
  return{app,server,score,set,apply,time(ms){wall=ms;app.frame();},async stage(){app.importFile(score);await app.until(()=>app.$('score-title').textContent===score.title&&!app.$('play-button').disabled);await app.click('resume-session');},async human(){await app.click('edit-song-mod');await app.click('song-mod-all-human');await apply();},async loop(){set('loop-to',late?2:1);await app.click('loop-apply');await app.until(()=>app.$('loop-enabled').checked&&!app.$('play-button').disabled);},async play(){app.$('count-in').checked=false;app.$('metronome-enabled').checked=false;await app.click('sound-button');assert.equal(app.$('sound-button').getAttribute('aria-pressed'),'true');await app.click('play-button');await app.until(()=>app.$('canonical-audio-policy').dataset.rendererState==='silent');}};
}

test('ordinary Original Mod retains A/B and late compensated MIDI stays in its original exported loop',async()=>{
  const f=await setup({late:true}),{app}=f;
  try{
    await f.stage();await app.click('midi-button');f.set('latency-offset',500);await f.loop();await f.human();
    assert.equal(app.$('loop-enabled').checked,true,'A performer change must retain the reviewed A/B range');
    assert.match(app.$('practice-scope').textContent,/in A–B/);await f.play();
    f.time(1517);f.time(1950);app.midi([0x90,60,90]);app.midi([0x80,60,0]);await app.click('play-button');f.time(2079);
    const pending=await app.exported('export-takes');assert.equal(pending.passes.length,2);const first=pending.passes[0];
    assert.equal(first.label,'Loop 1');assert.deepEqual(first.clock_segments,[{wallStart:1000,wallEnd:1500,positionStart:0}]);
    assert.equal(first.grace_deadline_wall_ms,2180);assert.equal(first.assessment,null);assert.equal(first.assessed_revision,-1);assert.equal(first.pending,true);
    assert.deepEqual(first.inputs,[{midi:60,at_ms:450,velocity:90}]);assert.equal(first.captures[0].event_wall_ms,1950);assert.equal(first.captures[0].received_wall_ms,1950);
    assert.equal(pending.passes[1].clock_segments[0].wallStart,1500);assert.equal(pending.passes[1].inputs.length,0);
    f.time(2180);await app.until(()=>app.$('feedback-description').textContent.startsWith('Loop 1:'));
    assert.deepEqual(f.server.requests.filter(request=>request.path==='/api/assess')[0].body.inputs,first.inputs);
    const assessed=await app.exported('export-takes');assert.equal(assessed.passes[0].pending,false);assert.equal(assessed.passes[0].assessment.accuracy_percent,100);assert.deepEqual(assessed.passes[0].inputs,first.inputs);
  }finally{await app.close();}
});

test('ordinary Original Mod retains loop overshoot and stops on a clock interruption without invented takes',async()=>{
  const f=await setup(),{app}=f;
  try{
    await f.stage();await f.loop();await f.human();assert.equal(app.$('loop-enabled').checked,true);await f.play();
    for(const frame of [1517,2013,2510,5000])f.time(frame);
    assert.match(app.$('transport-status').textContent,/clock interruption/);assert.match(app.$('notice-message').textContent,/no missing takes were invented/);assert.match(app.$('take-interruption-note').textContent,/Loop clock interruptions: 1/);
    const exported=await app.exported('export-takes');assert.ok(exported.passes.every(pass=>pass.interpretation.sound_enabled===false));assert.equal(exported.target_plan.target_count,1,'Scoring uses only the retained A/B window');
    assert.deepEqual(exported.passes.map(pass=>pass.clock_segments[0].wallStart),[1000,1500,2000,2500]);assert.deepEqual(exported.passes.map(pass=>pass.clock_segments[0].wallEnd),[1500,2000,2500,3000]);assert.equal(exported.interruptions[0].skipped_passes,4);
    const boundaries=exported.input_evidence.events.filter(event=>event.kind==='boundary'&&event.reason.startsWith('loop_'));
    assert.deepEqual(boundaries.map(event=>event.boundary_wall_ms),[1500,2000,2500,3000]);assert.deepEqual(boundaries.map(event=>event.event_wall_ms),[1517,2013,2510,5000]);assert.equal(boundaries.at(-1).reason,'loop_clock_stall');
    assert.equal(f.server.requests.filter(request=>request.path.includes('assistance/')).length,0);
  }finally{await app.close();}
});

test('retained Original loop checks only its targets while the full-song preview remains blocked by an outside-range note',async()=>{
  const f=await setup({outOfRangeTail:true}),{app}=f;
  try{
    await f.stage();await f.loop();await f.human();assert.equal(app.$('loop-enabled').checked,true);assert.equal(app.$('play-button').disabled,false);await f.play();
    const exported=await app.exported('export-takes');assert.equal(exported.target_plan.target_count,1);assert.deepEqual(exported.target_plan.timeline.notes.map(note=>note.id),['c4']);
    await app.click('back-to-library');assert.equal(app.$('start-performance').disabled,true,'A loop-limited admission cannot approve the complete song');
    assert.match(app.$('preview-gate').textContent,/outside|range|unplayable/i);assert.equal(app.$('resume-session').disabled,false);
    await app.click('resume-session');assert.equal(app.$('loop-enabled').checked,true);assert.equal(app.$('play-button').disabled,false);
    assert.deepEqual((await app.exported('export-takes')).target_plan,exported.target_plan);
  }finally{await app.close();}
});

for(const storage of ['property getter','read method'])test(`unavailable ${storage} keeps default Original Mod, appearance and latency usable in this tab`,async()=>{
  const denied=()=>{throw new DOMException('Storage unavailable','SecurityError');};
  const f=await setup({localStorageDescriptor:storage==='property getter'?{get:denied}:{value:{getItem:denied,setItem:denied}}}),{app}=f;
  try{
    await app.click('configure-song-mod');assert.equal(app.$('song-mod-assistance-mode').value,'original');await app.click('song-mod-all-machine');await f.apply();
    const storageNotice='Saved note-assistance preferences could not be read. Original full-part practice is available in this tab; this choice has not been saved.';
    assert.ok(app.$('song-mod-preview-summary').textContent.includes(storageNotice));assert.match(app.$('song-mod-preview-summary').textContent,/This tab only; saving unavailable/);
    assert.equal(f.server.requests.filter(request=>request.path.includes('assistance/')).length,0,'Storage denial alone must not opt into note assistance');
    app.$('count-in').checked=false;await app.click('sound-button');await app.click('start-performance');await app.until(()=>app.document.body.dataset.screen==='stage'&&!app.$('play-button').disabled);await app.click('reset-button');
    await f.human();assert.ok(app.$('song-mod-stage-summary').textContent.includes(storageNotice));assert.match(app.$('song-mod-stage-summary').textContent,/This tab only; saving unavailable/);f.set('theme-mode','dark');assert.equal(app.document.documentElement.dataset.theme,'dark');assert.match(app.$('theme-storage-status').textContent,/this tab.*could not be saved/);
    f.set('latency-offset',180);assert.equal(app.$('latency-offset').value,'180');assert.match(app.$('latency-storage-status').textContent,/this tab.*could not be saved/);assert.equal(app.$('play-button').disabled,false);
    await app.click('play-button');await app.until(()=>app.$('canonical-audio-policy').dataset.rendererState==='silent'&&app.$('play-button').textContent.includes('Pause'));
    // Silent plan readiness precedes transport admission. The public clock is
    // published by the app animation frame, which this fixture drives itself.
    app.frame();assert.equal(readPlaybackClock(app.document).running,true);
    const exported=await app.exported('export-takes');assert.equal(exported.passes.length,1);assert.equal(exported.passes[0].timeline.notes.length,2);assert.equal(exported.practice_assistance,null);
    assert.equal(f.server.requests.filter(request=>request.path.includes('assistance/')).length,0);
  }finally{await app.close();}
});

async function capturedEvent(app){
  const original=Object.getOwnPropertyDescriptor(globalThis,'__wmhReadPlaybackClock');
  Object.defineProperty(globalThis,'__wmhReadPlaybackClock',{configurable:true,value:()=>readPlaybackClock(app.document)});
  try{return await capturePlaybackEventTime({async waitForFunction(predicate){const value=await app.until(predicate);return{async jsonValue(){return value;},async dispose(){}};}});}
  finally{if(original)Object.defineProperty(globalThis,'__wmhReadPlaybackClock',original);else delete globalThis.__wmhReadPlaybackClock;}
}

test('a separate timestamp sampled after an advancing one-second take has ended is correctly excluded',async()=>{
  const f=await setup(),{app}=f;
  try{
    await f.stage();await app.click('midi-button');await f.human();await f.play();f.time(1017);
    assert.equal(readPlaybackClock(app.document).positionMs,17);assert.equal(readPlaybackClock(app.document).running,true);
    // Model a stalled host round-trip between the old readiness wait and its
    // later evaluate(performance.now). This timestamp is genuinely outside.
    f.time(2300);const outside=performance.now();f.time(2520);app.midi([0x90,60,90],outside);app.midi([0x80,60,0]);
    const take=await app.exported('export-takes');assert.equal(take.passes.length,1);assert.equal(take.passes[0].clock_segments[0].wallStart,1000);assert.equal(take.passes[0].clock_segments[0].wallEnd,2000);assert.deepEqual(take.passes[0].inputs,[]);
    assert.equal(take.input_evidence.events.find(event=>event.kind==='note_on').event_wall_ms,2300,'Raw outside-window evidence survives without being assigned to the take');
  }finally{await app.close();}
});

for(const delay of [220,1300])test(`atomic in-take MIDI timestamp survives a ${delay} ms callback delay and rejects pre-take input`,async()=>{
  const f=await setup(),{app}=f;
  try{
    await f.stage();await app.click('midi-button');await f.human();await f.play();f.time(1017);const captured=await capturedEvent(app);
    assert.equal(captured.eventWall,1017);assert.equal(captured.clock.positionMs,17);assert.equal(captured.clock.running,true);
    app.midi([0x90,65,90],1);app.midi([0x80,65,0],1);f.time(captured.eventWall+delay);const delivered=performance.now();app.midi([0x90,60,90],captured.eventWall);app.midi([0x80,60,0]);
    await app.tick();const before=f.server.requests.filter(request=>request.path==='/api/assess').length;await app.click('assess-button');f.time(delivered+181);await app.until(()=>f.server.requests.filter(request=>request.path==='/api/assess').length>before);
    const data=f.server.requests.filter(request=>request.path==='/api/assess').at(-1).body,take=await app.exported('export-takes'),pass=take.passes[0],segment=pass.clock_segments[0];
    assert.equal(take.passes.length,1);assert.equal(segment.wallStart,1000);assert.equal(pass.inputs.length,1);assert.equal(pass.captures.length,1);assert.equal(pass.captures[0].event_wall_ms,1017);assert.equal(pass.captures[0].received_wall_ms,delivered);assert.ok(delivered-captured.eventWall>=200);
    const expected=segment.positionStart+captured.eventWall-take.latency_ms-segment.wallStart;assert.deepEqual(data.inputs,[{midi:60,at_ms:expected,velocity:90}]);assert.deepEqual(pass.inputs,data.inputs);assert.equal(expected,17);assert.equal(pass.revision,1);
  }finally{await app.close();}
});

test('audio-backed first-take capture is bound to its admitted sample anchor and original MIDI event wall time',async()=>{
  const f=await setup(),{app}=f;
  const advance=wall=>{f.time(wall);app.renderAudioTo((wall-1000)/1000);app.frame();};
  try{
    await f.stage();await app.click('midi-button');await f.human();app.$('count-in').checked=false;app.$('metronome-enabled').checked=false;
    await app.click('play-button');await app.until(()=>app.$('canonical-audio-policy').dataset.rendererState==='playing');const anchor=app.sourceStartWall();assert.ok(Number.isFinite(anchor)&&anchor>1000);
    advance(anchor+17);const captured=await capturedEvent(app);assert.equal(captured.eventWall,anchor+17);assert.ok(captured.clock.positionMs>0&&captured.clock.positionMs<captured.clock.durationMs);
    app.midi([0x90,65,90],1);app.midi([0x80,65,0],1);advance(captured.eventWall+220);const delivered=performance.now();app.midi([0x90,60,90],captured.eventWall);app.midi([0x80,60,0]);
    const before=f.server.requests.filter(request=>request.path==='/api/assess').length;await app.click('assess-button');advance(delivered+181);await app.until(()=>f.server.requests.filter(request=>request.path==='/api/assess').length>before);
    const data=f.server.requests.filter(request=>request.path==='/api/assess').at(-1).body,take=await app.exported('export-takes'),pass=take.passes[0],segment=pass.clock_segments[0];
    assert.equal(take.passes.length,1);assert.equal(pass.interpretation.sound_enabled,true);assert.equal(segment.wallStart,anchor);assert.equal(pass.inputs.length,1);assert.equal(pass.captures.length,1);assert.equal(pass.captures[0].event_wall_ms,captured.eventWall);assert.equal(pass.captures[0].received_wall_ms,delivered);assert.equal(delivered-captured.eventWall,220);
    const expected=segment.positionStart+captured.eventWall-take.latency_ms-segment.wallStart;assert.deepEqual(data.inputs,[{midi:60,at_ms:expected,velocity:90}]);assert.deepEqual(pass.inputs,data.inputs);assert.ok(Math.abs(expected-17)<1e-6);assert.equal(pass.revision,1);
  }finally{await app.close();}
});
