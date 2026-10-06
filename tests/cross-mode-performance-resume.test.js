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
    // Leave the existing 180 ms prior-segment input tolerance before probing
    // the new resume segment's future accepted anchor.
    f.time(250);
    await app.click('play-button');await app.until(()=>renderer(app,name).dataset.rendererState==='playing');
    const key=app.document.querySelector('#keyboard [data-midi="60"]');
    app.emit(key,'pointerdown',{pointerId:73,button:0});await app.tick();app.emit(key,'pointerup',{pointerId:73});
    assert.equal((await app.exported('export-takes')).passes[0].inputs.length,0,'Input inside the resume lead cannot enter the accepted source segment');
    await app.click('play-button');await app.until(()=>!app.$('play-button').disabled);
    const clock=readPlaybackClock(app.$('progress')),take=await app.exported('export-takes');
    assert.equal(take.passes.length,1);assert.equal(clock.running,false);
    assert.ok(Math.abs(take.passes[0].clock_segments.at(-1).positionStart-paused)<.125);
    assert.ok(Math.abs(clock.positionMs-paused)<.125,`${name} rewound from ${paused} ms to ${clock.positionMs} ms before any resumed audio elapsed`);
    await app.click('play-button');await app.until(()=>renderer(app,name).dataset.rendererState==='playing');
    f.time(60);app.emit(key,'pointerdown',{pointerId:74,button:0});await app.tick();app.emit(key,'pointerup',{pointerId:74});
    const afterAnchor=await app.exported('export-takes');
    assert.equal(afterAnchor.passes[0].inputs.length,1);
    assert.ok(Math.abs(afterAnchor.passes[0].inputs[0].at_ms-(paused+10))<.125,'Capture follows the actual accepted audio anchor, without consuming its future lead');
  }finally{await app.close();}
});
