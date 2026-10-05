import test from 'node:test';
import assert from 'node:assert/strict';
import {createContext, runInContext} from 'node:vm';
import {installPlaybackClockReader, readPlaybackClock, waitForPlaybackClock, waitForPlaybackClockAdvance} from './browser-playback-clock.js';
import {createPlaybackClock} from '../web/playback-clock-view.js';
import {compileBrowserFixture} from './frontend-browser-compilation-fixture.js';
import {syntheticCanonicalProfile} from './canonical-dom-audio-fixture.js';
import {fixture as scoreFixture} from './frontend-fixtures.js';
import {buildCanonicalAudioPlan, CANONICAL_AUDIO_POLICY} from '../web/canonical-audio-plan.js';
import {installLoopClockFixture} from './frontend-clock-fixture.js';

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
