import test from 'node:test';
import assert from 'node:assert/strict';
import {createContext, runInContext} from 'node:vm';
import {installPlaybackClockReader, readPlaybackClock, waitForPlaybackClock} from './browser-playback-clock.js';

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
