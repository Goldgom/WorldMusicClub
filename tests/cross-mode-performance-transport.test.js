import test from 'node:test';
import assert from 'node:assert/strict';
import {readPlaybackClock} from '../web/playback-clock-view.js';
import {crossModePerformanceApp,setMod,applyMod,renderer,startPerformance} from './cross-mode-performance-fixtures.js';

test('profile switches restore supported count-in, A/B, tempo and transpose controls without carrying the prior loop',async()=>{
  const f=await crossModePerformanceApp(),{app,sources}=f;
  try{
    for(const name of ['canonical','basic','vsq','canonical']){
      await f.select(name);await app.click('configure-song-mod');await app.click('song-mod-all-machine');setMod(app,'performer',sources[name].score.parts[0].id,'human');await applyMod(app);
      app.$('count-in').checked=true;await startPerformance(app,name);
      const canonical=name==='canonical',basic=name==='basic',receiver=f.receiver(),core=receiver.core;
      assert.equal(app.$('count-in').disabled,basic);
      for(const id of ['loop-apply','loop-enabled','tempo','transposition-button'])assert.equal(app.$(id).disabled,!canonical,`${name}: ${id}`);
      assert.equal(app.$('loop-enabled').checked,false,'An earlier canonical loop cannot become the new source window');
      const position=core.positionFrame/core.sampleRate*1000;
      assert.equal(position,basic?0:Math.round(-4*60000/Number(app.$('tempo').value)*core.sampleRate/1000)/core.sampleRate*1000);
      const take=await app.exported('export-takes');assert.equal(take.passes[0].clock_segments[0].positionStart,position);
      assert.equal(core.startedCount,0,'No source onset precedes the admitted anchor');
      f.time(basic?100:-position+100);await app.tick();app.frame();
      await app.click('play-button');await app.until(()=>!app.$('play-button').disabled);
      const paused=readPlaybackClock(app.$('progress')).positionMs;assert.ok(paused>0);
      await app.click('play-button');await app.until(()=>renderer(app,name).dataset.rendererState==='playing');
      const resumed=await app.exported('export-takes');
      assert.ok(Math.abs(resumed.passes[0].clock_segments.at(-1).positionStart-paused)<=.125,'Resume does not repeat count-in');
      if(canonical){
        app.$('count-in').checked=false;app.$('loop-from').value='4';app.$('loop-to').value='5';await app.click('loop-apply');
        await app.until(()=>app.$('loop-enabled').checked&&!app.$('play-button').disabled);
        await app.click('play-button');await app.until(()=>renderer(app,name).dataset.rendererState==='playing');
        const looping=f.receiver();assert.equal(looping.core.plan.rangeStartFrame,2000*8);assert.equal(looping.core.plan.rangeEndFrame,2500*8);
        f.time(600);await app.tick();app.frame();
        assert.equal((await app.exported('export-takes')).passes.length,2,'The A/B pass boundary remains on the audio clock');
        await app.click('edit-song-mod');setMod(app,'visible',sources[name].score.parts[1].id,false);await applyMod(app);
        assert.equal(app.$('loop-enabled').checked,true,'A display-only Mod edit retains this source’s loop');
        assert.equal(app.$('loop-from').value,'4');assert.equal(app.$('loop-to').value,'5');
      }
    }
  }finally{await app.close();}
});

test('all-human plans across profiles retain target ownership with zero machine gates',async()=>{
  const f=await crossModePerformanceApp(),{app,sources}=f;
  try{
    app.$('count-in').checked=false;
    for(const name of ['canonical','basic','vsq']){
      await f.select(name);await app.click('configure-song-mod');await app.click('song-mod-all-human');await applyMod(app);await startPerformance(app,name);
      assert.equal(app.$('session-mode').value,'practice');assert.equal(f.receiver().core.plan.count,0);
      const take=await app.exported('export-takes');assert.equal(take.passes.length,1);assert.equal(take.practice_selection.kind,'all');
      assert.deepEqual(take.practice_selection.part_ids,sources[name].score.parts.map(part=>part.id));
      assert.ok(take.target_plan.target_count>0);assert.deepEqual(take.passes[0].inputs,[]);assert.deepEqual(take.passes[0].captures,[]);
    }
  }finally{await app.close();}
});
