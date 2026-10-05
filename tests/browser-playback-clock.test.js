import test from 'node:test';
import assert from 'node:assert/strict';
import {createContext, runInContext} from 'node:vm';
import {installPlaybackClockReader, readPlaybackClock} from './browser-playback-clock.js';

const durationMs = 4083.3371666666667;
function realmWithClock(positionMs) {
  const snapshot = {version:1,available:true,positionMs,transportPositionMs:positionMs,
    durationMs,rangeStartMs:0,rangeEndMs:durationMs,running:false,completed:false,phase:'paused'};
  const progress = {id:'progress',dataset:{playbackClock:JSON.stringify(snapshot)},
    getAttribute(name) { return name === 'data-playback-clock' ? this.dataset.playbackClock : null; },
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
