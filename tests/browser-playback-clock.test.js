import test from 'node:test';
import assert from 'node:assert/strict';
import {createContext, runInContext} from 'node:vm';
import {installPlaybackClockReader, readPlaybackClock, waitForPlaybackClock, waitForPlaybackClockAdvance, capturePlaybackEventTime, assertPausedPlaybackClock} from './browser-playback-clock.js';
import {createPlaybackClock} from '../web/playback-clock-view.js';
import {compileBrowserFixture} from './frontend-browser-compilation-fixture.js';
import {syntheticCanonicalProfile} from './canonical-dom-audio-fixture.js';
import {fixture as scoreFixture} from './frontend-fixtures.js';
import {buildCanonicalAudioPlan, CANONICAL_AUDIO_POLICY} from '../web/canonical-audio-plan.js';
import {installLoopClockFixture} from './frontend-clock-fixture.js';
import {canonicalPracticeApp} from './canonical-practice-fixtures.js';

const durationMs = 4083.3371666666667;
function realmWithClock(positionMs) {
  const snapshot = {version:1,available:true,positionMs,transportPositionMs:positionMs,
    durationMs,rangeStartMs:0,rangeEndMs:durationMs,running:false,completed:false,phase:'paused'};
  const progress = {id:'progress',dataset:{playbackClock:JSON.stringify(snapshot)},
    getAttribute(name) { return name === 'data-playback-clock' ? this.dataset.playbackClock ?? null : null; },
    get value() { throw Error('Native range value is not the source clock'); },
    get max() { throw Error('Native range max is not the source duration'); }};
  const document = {getElementById:id=>id==='progress'?progress:null};
  return {progress,context:createContext({document})};
}

test('browser reader installation preserves exact numeric source clocks now and after navigation',async()=>{
  const current = realmWithClock(durationMs),calls=[];
  let init;
  const page = {
    async addInitScript(script) { calls.push('init'); init=script.content; },
    async evaluate(source) { calls.push('evaluate'); return runInContext(source,current.context); },
  };
  await installPlaybackClockReader(page);
  assert.deepEqual(calls,['init','evaluate']);
  const clock = runInContext('globalThis.__wmhReadPlaybackClock()',current.context);
  assert.equal(clock.positionMs,durationMs);
  assert.equal(clock.durationMs,durationMs);
  assert.equal(readPlaybackClock(current.progress).positionMs,durationMs);

  const navigation = realmWithClock(0);
  runInContext(init,navigation.context);
  assert.equal(runInContext('globalThis.__wmhReadPlaybackClock().positionMs',navigation.context),0);
  assert.equal(runInContext('globalThis.__wmhReadPlaybackClock().positionMs + 250',navigation.context),250);
  navigation.progress.dataset.playbackClock=JSON.stringify({...clock,positionMs:1000,transportPositionMs:1000});
  assert.equal(runInContext('globalThis.__wmhReadPlaybackClock().positionMs > 250',navigation.context),true);
});


function readinessPage({beforePoll=()=>{},pollLimit=3}={}) {
  const realm=realmWithClock(0),state={element:realm.progress,polls:0,reads:0,disposals:0};
  const timeout=Object.assign(new Error('Existing Playwright readiness timeout'),{name:'TimeoutError'});
  realm.context.document.getElementById=id=>id==='progress'?state.element:null;
  realm.context.__wmhReadPlaybackClock=element=>{state.reads++;return readPlaybackClock(element);};
  const page={async waitForFunction(predicate,...options){
    assert.deepEqual(options,[],'The helper must retain the existing Playwright timeout and polling');
    for(let poll=1;poll<=pollLimit;poll++){
      state.polls=poll;beforePoll({poll,state,progress:realm.progress});
      if(runInContext(`(${predicate.toString()})()`,realm.context))return{async dispose(){state.disposals++;}};
    }
    throw timeout;
  }};
  return {page,state,progress:realm.progress,timeout};
}

test('browser clock readiness waits for the first valid published snapshot after navigation',async()=>{
  let published;
  const fixture=readinessPage({beforePoll({poll,state,progress}){
    if(poll===1){published=progress.dataset.playbackClock;state.element=null;}
    if(poll===2){state.element=progress;delete progress.dataset.playbackClock;}
    if(poll===3)progress.dataset.playbackClock=published;
  }});
  await waitForPlaybackClock(fixture.page);
  assert.equal(fixture.state.polls,3);
  assert.equal(fixture.state.reads,1,'Strict observation starts as soon as metadata exists');
  assert.equal(fixture.state.disposals,1);
});

test('browser clock readiness keeps absent publication bounded by the existing waiter',async()=>{
  for(const missingElement of [true,false]){
    const fixture=readinessPage({beforePoll({state,progress}){
      if(missingElement)state.element=null;else delete progress.dataset.playbackClock;
    }});
    await assert.rejects(waitForPlaybackClock(fixture.page),error=>error===fixture.timeout);
    assert.equal(fixture.state.polls,3);
    assert.equal(fixture.state.reads,0);
    assert.equal(fixture.state.disposals,0);
  }
});

test('browser clock readiness rejects malformed published metadata immediately',async()=>{
  for(const raw of ['', '{broken', JSON.stringify({version:1})]){
    const fixture=readinessPage();fixture.progress.dataset.playbackClock=raw;
    await assert.rejects(waitForPlaybackClock(fixture.page),/playback clock is missing or invalid/);
    assert.equal(fixture.state.polls,1,'Malformed publication must fail rather than wait for replacement');
    assert.equal(fixture.state.reads,1);
    assert.equal(fixture.state.disposals,0);
  }
});

test('browser clock readiness accepts a valid published unavailable snapshot',async()=>{
  const fixture=readinessPage();
  fixture.progress.dataset.playbackClock=JSON.stringify({...readPlaybackClock(fixture.progress),available:false,phase:'unavailable'});
  await waitForPlaybackClock(fixture.page);
  assert.equal(fixture.state.polls,1);
  assert.equal(fixture.state.reads,1);
  assert.equal(fixture.state.disposals,1);
});

test('browser clock installation on about:blank does not wait for app publication',async()=>{
  const context=createContext({document:{getElementById:()=>null}}),calls=[];
  const page={
    async addInitScript(){calls.push('init');},
    async evaluate(source){calls.push('evaluate');return runInContext(source,context);},
    async waitForFunction(){throw Error('Installation must not wait before app navigation');},
  };
  await installPlaybackClockReader(page);
  assert.deepEqual(calls,['init','evaluate']);
  assert.equal(typeof context.__wmhReadPlaybackClock,'function');
});

test('browser input readiness waits through preparation and the future source anchor',async()=>{
  for(const previous of [0,1600.125]){
    const realm=realmWithClock(previous),states=[
      {positionMs:previous,hasStarted:previous>0},
      {positionMs:previous,preparing:true},
      {positionMs:previous,hasStarted:true,running:true},
      {positionMs:previous+1,hasStarted:true},
      {positionMs:previous+1,hasStarted:true,running:true},
    ];
    let polls=0,disposed=0;
    realm.context.__wmhReadPlaybackClock=()=>readPlaybackClock(realm.progress);
    const page={async waitForFunction(predicate,...args){
      assert.deepEqual(args,[previous],'Keep the browser waiter bounded by its configured timeout');
      realm.context.previous=previous;
      for(const state of states){
        polls++;
        realm.progress.dataset.playbackClock=JSON.stringify(createPlaybackClock({durationMs,...state}));
        if(runInContext(`(${predicate.toString()})(previous)`,realm.context))return{async dispose(){disposed++;}};
      }
      throw Error('The source clock never advanced while playing');
    }};
    await waitForPlaybackClockAdvance(page,previous);
    assert.equal(polls,states.length,'A stale positive paused position cannot admit resumed input');
    assert.equal(disposed,1);
  }
});

test('browser input readiness preserves timeout and malformed-clock failures',async()=>{
  const timeout=Object.assign(new Error('Existing browser timeout'),{name:'TimeoutError'});
  await assert.rejects(waitForPlaybackClockAdvance({async waitForFunction(){throw timeout;}}),error=>error===timeout);
  const realm=realmWithClock(0);realm.progress.dataset.playbackClock='{broken';
  realm.context.__wmhReadPlaybackClock=()=>readPlaybackClock(realm.progress);
  await assert.rejects(waitForPlaybackClockAdvance({async waitForFunction(predicate){
    return runInContext(`(${predicate.toString()})(0)`,realm.context);
  }}),/playback clock is missing or invalid/);
});

function pauseClockPage({states,afterHold=()=>{}}) {
  const realm=realmWithClock(866*1000/44100),play={disabled:true};
  const observed={polls:0,holds:0,disposals:0};
  const timeout=Object.assign(new Error('Existing browser pause readiness timeout'),{name:'TimeoutError'});
  realm.context.__wmhReadPlaybackClock=()=>readPlaybackClock(realm.progress);
  realm.context.document.getElementById=id=>id==='progress'?realm.progress:id==='play-button'?play:null;
  const page={
    async waitForFunction(predicate,...options){
      assert.deepEqual(options,[],'Use the existing bounded waiter, without retrying playback');
      for(const state of states){
        observed.polls++;play.disabled=state.disabled;
        if(state.clock)realm.progress.dataset.playbackClock=JSON.stringify(state.clock);
        const result=runInContext(`(${predicate.toString()})()`,realm.context);
        if(result)return{async jsonValue(){return structuredClone(result);},async dispose(){observed.disposals++;}};
      }
      throw timeout;
    },
    async waitForTimeout(ms){assert.equal(ms,150);observed.holds++;afterHold(realm.progress);},
    async evaluate(reader){return runInContext(`(${reader.toString()})()`,realm.context);},
  };
  return{page,progress:realm.progress,observed,timeout};
}

test('pause assertion captures the acknowledged frame only after Play is ready',async()=>{
  const optimistic=createPlaybackClock({positionMs:866*1000/44100,durationMs,hasStarted:true});
  const acknowledged=createPlaybackClock({positionMs:867*1000/44100,durationMs,hasStarted:true});
  const fixture=pauseClockPage({states:[
    {disabled:false,clock:createPlaybackClock({positionMs:0,durationMs})},
    {disabled:false,clock:createPlaybackClock({positionMs:optimistic.positionMs,durationMs,running:true})},
    {disabled:true,clock:optimistic},
    {disabled:false,clock:acknowledged},
  ]});
  const paused=await assertPausedPlaybackClock(fixture.page);
  assert.deepEqual(paused,acknowledged);
  assert.deepEqual(fixture.observed,{polls:4,holds:1,disposals:1});
});

test('pause assertion times out on an unacknowledged pause and rejects malformed clocks',async()=>{
  const fixture=pauseClockPage({states:[{disabled:true},{disabled:true}]});
  await assert.rejects(assertPausedPlaybackClock(fixture.page),error=>error===fixture.timeout);
  assert.deepEqual(fixture.observed,{polls:2,holds:0,disposals:0});
  const malformed=pauseClockPage({states:[{disabled:false}]});malformed.progress.dataset.playbackClock='{broken';
  await assert.rejects(assertPausedPlaybackClock(malformed.page),/playback clock is missing or invalid/);
  assert.deepEqual(malformed.observed,{polls:1,holds:0,disposals:0});
});

test('pause assertion still fails on one frame or smaller drift after readiness',async()=>{
  for(const driftMs of [1000/44100,1e-10]){
    const fixture=pauseClockPage({states:[{disabled:false}],afterHold(progress){
      const clock=readPlaybackClock(progress);
      progress.dataset.playbackClock=JSON.stringify({...clock,positionMs:clock.positionMs+driftMs,transportPositionMs:clock.transportPositionMs+driftMs});
    }});
    await assert.rejects(assertPausedPlaybackClock(fixture.page),error=>error.code==='ERR_ASSERTION'&&/Paused clock changed after Play became ready/.test(error.message));
    assert.deepEqual(fixture.observed,{polls:1,holds:1,disposals:1},'Do not wait for drifting samples to become equal');
  }
});

test('pause assertion rejects resumed playback even when its first position is unchanged',async()=>{
  const fixture=pauseClockPage({states:[{disabled:false}],afterHold(progress){
    progress.dataset.playbackClock=JSON.stringify({...readPlaybackClock(progress),phase:'playing',running:true});
  }});
  await assert.rejects(assertPausedPlaybackClock(fixture.page),{code:'ERR_ASSERTION'});
});

test('production canonical pause corrects the optimistic 44.1 kHz frame once before enabling Play',async()=>{
  // Node DOM/port harness with production app, session, receiver and DSP core.
  // Delaying the real pause ACK is not browser/device acceptance evidence.
  const sampleRate=44100,f=await canonicalPracticeApp({audioSampleRate:sampleRate}),{app}=f;
  const sourceBefore=JSON.stringify(f.evidence);
  try{
    app.$('count-in').checked=false;await app.click('start-listen');
    await app.until(()=>app.$('canonical-audio-policy').dataset.rendererState==='playing');
    const node=f.receiver(),harness=app.audioHarnesses.find(h=>h.nodes.includes(node)),zero=app.sourceStartWall();
    const pauseWall=zero+866.75*1000/sampleRate;
    f.time(pauseWall);
    const pauseFrame=node.core.anchorFrame+867;
    while(harness.frame<pauseFrame)harness.renderBlock(Math.min(128,pauseFrame-harness.frame));
    app.frame();
    assert.equal(readPlaybackClock(app.document).positionMs,866*1000/sampleRate);

    const receive=node.port.onmessage;let acknowledgement;
    node.port.onmessage=event=>{if(event.data.type==='paused')acknowledgement=event;else receive(event);};
    app.$('play-button').click();await app.tick();
    const optimistic=readPlaybackClock(app.document);
    assert.equal(optimistic.phase,'paused');assert.equal(optimistic.positionMs,19.63718820861678);
    assert.equal(app.$('play-button').disabled,true);
    assert.equal(node.core.state,'paused');assert.equal(acknowledgement.data.sourcePositionFrame,867);
    assert.equal(acknowledgement.data.frame,pauseFrame);

    const realm=createContext({document:app.document,__wmhReadPlaybackClock:()=>readPlaybackClock(app.document)});
    let polls=0,disposals=0;
    const page={
      async waitForFunction(predicate,...options){
        assert.deepEqual(options,[]);
        polls++;assert.equal(runInContext(`(${predicate.toString()})()`,realm),false,'Paused display must not admit an unacknowledged receiver');
        receive(acknowledgement);await app.tick();
        polls++;const value=runInContext(`(${predicate.toString()})()`,realm);
        assert.ok(value,'The ACK commit enables Play and publishes its exact frame');
        return{async jsonValue(){return structuredClone(value);},async dispose(){disposals++;}};
      },
      async waitForTimeout(ms){assert.equal(ms,150);f.time(pauseWall+ms);app.frame();},
      async evaluate(reader){return reader(app.document);},
    };
    const paused=await assertPausedPlaybackClock(page);
    assert.equal(paused.positionMs,19.65986394557823);assert.equal(paused.positionMs,867*1000/sampleRate);
    assert.equal(polls,2);assert.equal(disposals,1);assert.equal(app.$('play-button').disabled,false);
    f.time(pauseWall+300);app.frame();assert.equal(readPlaybackClock(app.document).positionMs,paused.positionMs);
    assert.equal(node.core.pauseCount,1);assert.equal(JSON.stringify(f.evidence),sourceBefore);
  }finally{await app.close();}
});

test('event capture samples one real timestamp inside the admitted window, excluding preparation and post-end grace',async()=>{
  const realm=realmWithClock(0),states=[
    {positionMs:0,preparing:true},
    {positionMs:0,hasStarted:true,running:true},
    {positionMs:durationMs,hasStarted:true,running:true},
    {positionMs:durationMs+181,hasStarted:true,running:true},
    {positionMs:durationMs,hasStarted:true,completed:true},
    {positionMs:17,hasStarted:true,running:true},
  ];
  let polls=0,wall=1000,reads=0,disposals=0;
  realm.context.__wmhReadPlaybackClock=()=>readPlaybackClock(realm.progress);
  realm.context.performance={now(){reads++;return wall;}};
  const page={async waitForFunction(predicate,...options){
    assert.deepEqual(options,[],'Keep the existing timeout; never retry or restart playback');
    for(const state of states){
      polls++;wall+=17;realm.progress.dataset.playbackClock=JSON.stringify(createPlaybackClock({durationMs,...state}));
      const captured=runInContext(`(${predicate.toString()})()`,realm.context);
      if(captured)return{async jsonValue(){wall+=1500;return structuredClone(captured);},async dispose(){disposals++;}};
    }
    throw Error('No in-take observation');
  }};
  const captured=await capturePlaybackEventTime(page);
  assert.equal(polls,states.length);assert.equal(reads,1);assert.equal(disposals,1);
  assert.equal(captured.eventWall,1102);assert.equal(wall,2602,'A delayed host read must not replace the captured timestamp');
  assert.equal(captured.clock.positionMs,17);assert.equal(captured.clock.running,true);
});

test('event capture retains timeout and malformed-clock failures without inventing an earlier timestamp',async()=>{
  const timeout=Object.assign(new Error('Existing browser timeout'),{name:'TimeoutError'});
  await assert.rejects(capturePlaybackEventTime({async waitForFunction(){throw timeout;}}),error=>error===timeout);
  const realm=realmWithClock(0);realm.progress.dataset.playbackClock='{broken';
  realm.context.__wmhReadPlaybackClock=()=>readPlaybackClock(realm.progress);
  realm.context.performance={now(){throw Error('A malformed clock cannot own an event timestamp');}};
  await assert.rejects(capturePlaybackEventTime({async waitForFunction(predicate){return runInContext(`(${predicate.toString()})()`,realm.context);}}),/playback clock is missing or invalid/);
});

test('mocked browser compilation retains the legacy timings and supplies exact audio identities',()=>{
  const score=structuredClone(scoreFixture),original=structuredClone(score),compiled=compileBrowserFixture(score);
  assert.deepEqual(compiled.timeline.notes.map(({id,part_id,midi,start_ms,duration_ms,voice,staff})=>({id,part_id,midi,start_ms,duration_ms,voice,staff})),[
    {id:'c4',part_id:'piano',midi:60,start_ms:0,duration_ms:500,voice:'1',staff:1},
    {id:'e4',part_id:'piano',midi:64,start_ms:500,duration_ms:500,voice:'1',staff:1},
  ]);
  assert.equal(compiled.timeline.duration_ms,1000);
  assert.deepEqual(compiled.timeline.notes.map(note=>[note.velocity,note.source_note_id,note.source_note_ids]),[[90,'c4',['c4']],[90,'e4',['e4']]]);
  const profile=syntheticCanonicalProfile(compiled),options={sampleRate:48000,mode:'listen',acceptedPolicyId:CANONICAL_AUDIO_POLICY};
  const plan=buildCanonicalAudioPlan(compiled,profile,options);
  assert.equal(plan.count,2);assert.deepEqual(plan.sourceIds,['c4','e4']);assert.equal(plan.durationFrames,48000);
  assert.deepEqual(score,original,'Mock compilation/profile generation cannot edit the exported source');
  for(const bpm of [60,240]){
    score.tempo[0].bpm=bpm;const changed=compileBrowserFixture(score);
    assert.equal(changed.timeline.duration_ms,120000/bpm);
    assert.equal(changed.timeline.notes[1].start_ms,60000/bpm);
  }
});

test('mocked profile does not bypass production source and occurrence mismatch rejection',()=>{
  const original=compileBrowserFixture(structuredClone(scoreFixture)),profile=syntheticCanonicalProfile(original);
  const options={sampleRate:48000,mode:'listen',acceptedPolicyId:CANONICAL_AUDIO_POLICY};
  for(const mutate of [
    compiled=>{compiled.score.title+='different source';},
    compiled=>{compiled.timeline.notes[0].velocity--;},
    compiled=>{compiled.timeline.notes[0].source_note_id='e4';},
    compiled=>{compiled.timeline.notes[0].source_note_ids=['e4'];},
    compiled=>{compiled.timeline.notes[0].duration_ms++;},
  ]){
    const compiled=structuredClone(original);mutate(compiled);
    assert.throws(()=>buildCanonicalAudioPlan(compiled,profile,options));
  }
});

test('mocked profile preserves rests and cross-part unisons without merging source voices',()=>{
  const score=structuredClone(scoreFixture);
  score.parts[0].notes.push({...structuredClone(score.parts[0].notes[0]),id:'rest',pitch:null,velocity:0});
  score.parts.push({id:'other',name:'Other',instrument:'piano',notes:[{...structuredClone(score.parts[0].notes[0]),id:'other-c4'}]});
  const compiled=compileBrowserFixture(score),profile=syntheticCanonicalProfile(compiled);
  const plan=buildCanonicalAudioPlan(compiled,profile,{sampleRate:48000,mode:'listen',acceptedPolicyId:CANONICAL_AUDIO_POLICY});
  assert.deepEqual(profile.source_note_ids,['c4','e4','rest','other-c4']);assert.equal(plan.count,3);
  assert.deepEqual(plan.notes.filter(note=>note[1]===0&&note[3]===60).map(note=>plan.mapping[note[0]].id),['c4','other-c4']);
});

test('controlled browser input clock cannot advance or replace a real audio clock',()=>{
  class AudioContext {currentTime=12.5;}
  class AudioWorkletNode {}
  const target={performance:{now:()=>5},AudioContext,AudioWorkletNode,requestAnimationFrame:()=>1,cancelAnimationFrame(){}};
  const audio=new target.AudioContext();installLoopClockFixture(target);
  target.loopTestClock=5000;
  assert.equal(target.performance.now(),5000);assert.equal(audio.currentTime,12.5);
  assert.equal(target.AudioContext,AudioContext);assert.equal(target.AudioWorkletNode,AudioWorkletNode);
});
