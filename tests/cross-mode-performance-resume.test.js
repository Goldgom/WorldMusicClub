import test from 'node:test';
import assert from 'node:assert/strict';
import {readPlaybackClock} from '../web/playback-clock-view.js';
import {crossModePerformanceApp,setMod,applyMod,renderer,startPerformance} from './cross-mode-performance-fixtures.js';

// Regression: the future 50 ms audio admission anchor is not elapsed source
// playback. Pausing inside that lead must keep the already-paused position.
for(const name of ['canonical','basic','vsq'])test(`${name}: Resume then Pause before the audio anchor preserves source position and recorder agreement`,async()=>{
  const f=await crossModePerformanceApp(),{app,sources}=f;
  try{
    app.$('count-in').checked=false;await f.select(name);await app.click('configure-song-mod');await app.click('song-mod-all-machine');setMod(app,'performer',sources[name].score.parts[0].id,'human');await applyMod(app);await startPerformance(app,name);
    f.time(200);await app.click('play-button');await app.until(()=>!app.$('play-button').disabled);
    const paused=readPlaybackClock(app.$('progress')).positionMs;assert.ok(paused>100);
    await app.click('play-button');await app.until(()=>renderer(app,name).dataset.rendererState==='playing');
    await app.click('play-button');await app.until(()=>!app.$('play-button').disabled);
    const clock=readPlaybackClock(app.$('progress')),take=await app.exported('export-takes');
    assert.equal(take.passes.length,1);assert.equal(clock.running,false);
    assert.ok(Math.abs(take.passes[0].clock_segments.at(-1).positionStart-paused)<.125);
    assert.ok(Math.abs(clock.positionMs-paused)<.125,`${name} rewound from ${paused} ms to ${clock.positionMs} ms before any resumed audio elapsed`);
  }finally{await app.close();}
});
