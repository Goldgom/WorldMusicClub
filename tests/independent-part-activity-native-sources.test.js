import test from 'node:test';
import assert from 'node:assert/strict';
import {readPlaybackClock} from '../web/playback-clock-view.js';
import {crossModePerformanceApp,setMod,applyMod,renderer,startPerformance} from './cross-mode-performance-fixtures.js';
for(const name of ['basic','vsq'])test(`independent activity ${name} production: paused/ended retirement cannot survive new admission or source`,async()=>{
 const f=await crossModePerformanceApp(),{app,sources}=f,strip=()=>app.document.querySelector('.part-activity-strip');
 const state=()=>strip()?.hidden?'hidden':strip()?.querySelector('[data-state]')?.dataset.state;
 try{
  app.$('count-in').checked=false;await f.select(name);await app.click('configure-song-mod');await app.click('song-mod-all-machine');setMod(app,'performer',sources[name].score.parts[0].id,'human');app.$('song-mod-layout').value='complete';await applyMod(app);await startPerformance(app,name);f.time(100);assert.ok(strip());assert.equal(strip().hidden,false);assert.ok(['playing','silent'].includes(state()));const first=f.receiver(),take=await app.exported('export-takes');assert.ok(take.passes.every(p=>p.inputs.length===0));
  await app.click('play-button');await app.until(()=>!app.$('play-button').disabled);app.frame();assert.equal(state(),'paused','Stopped clean player retains only a paused display receipt');const paused=await app.exported('export-takes');assert.deepEqual(paused.target_plan,take.target_plan);
  await app.click('play-button');await app.until(()=>renderer(app,name).dataset.rendererState==='playing');app.frame();assert.notEqual(f.receiver(),first);assert.notEqual(state(),'playing','New source anchor has not arrived');f.time(60);assert.ok(['playing','silent'].includes(state()));
  f.time(readPlaybackClock(app.document).durationMs+500);await app.tick();app.frame();await app.until(()=>readPlaybackClock(app.document).completed&&!app.$('play-button').disabled);app.frame();assert.equal(state(),'ended','Ended retained rows never pretend still sounding');const ended=await app.exported('export-takes');
  await app.click('play-button');await app.until(()=>renderer(app,name).dataset.rendererState==='playing');app.frame();assert.notEqual(state(),'playing');f.time(60);assert.ok(['playing','silent'].includes(state()));const replay=await app.exported('export-takes');assert.deepEqual(replay.passes[0],ended.passes[0]);assert.equal(replay.passes.length,2);assert.deepEqual(replay.passes[1].inputs,[]);
  await f.select(name==='basic'?'vsq':'basic');app.frame();assert.equal(strip().hidden,true,'Replacement source cannot display retired prior source rows');
 }finally{await app.close();}
});
