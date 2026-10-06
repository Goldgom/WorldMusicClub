import test from 'node:test';
import assert from 'node:assert/strict';
import {readPlaybackClock} from '../web/playback-clock-view.js';
import {SONG_MOD_STORAGE_PREFIX} from '../web/song-mod.js';
import {crossModePerformanceApp,modControl,setMod,applyMod,renderer,startPerformance} from './cross-mode-performance-fixtures.js';

const humanState=take=>take.passes.map(({id,timeline,inputs,captures})=>({id,timeline,inputs,captures}));

test('one app crosses canonical, Basic and VSQ through Start/Mod without stale roles, inputs or take history',async()=>{
  const f=await crossModePerformanceApp(),{app,sources}=f,originals=Object.fromEntries(Object.entries(sources).map(([name,value])=>[name,JSON.stringify(value)])),saved=new Map();
  try{
    app.$('count-in').checked=false;
    for(const name of ['canonical','basic','vsq','canonical']){
      await f.select(name);const parts=sources[name].score.parts;
      assert.deepEqual([...app.document.querySelectorAll('.preview-actions button')].filter(node=>!node.hidden).map(node=>node.id),['start-performance','configure-song-mod']);
      await app.click('configure-song-mod');
      assert.deepEqual([...app.$('song-mod-parts').querySelectorAll('[data-mod-performer]')].map(node=>node.dataset.modPerformer),parts.map(part=>part.id));
      if(saved.has(name)){
        assert.equal(modControl(app,'visible',parts[1].id).checked,false,'Same-source display preference survives other profiles');
        assert.equal(modControl(app,'mute',parts[1].id).checked,true,'Same-source mute survives other profiles');
      }
      await app.click('song-mod-all-machine');setMod(app,'performer',parts[0].id,'human');
      app.$('song-mod-layout').value='complete';
      await applyMod(app);await startPerformance(app,name);f.time(100);
      let take=await app.exported('export-takes');
      assert.equal(take.song_mod.songId,sources[name].score.id);
      assert.equal(take.passes.length,1,'A new source starts a new history');
      assert.deepEqual(take.passes[0].inputs,[],'Previous-source input and machine playback cannot become human input');
      assert.deepEqual(take.passes[0].captures,[]);
      assert.ok(take.passes[0].timeline.notes.every(note=>note.part_id===parts[0].id));
      const key=app.document.querySelector('#keyboard [data-midi="60"]');
      app.emit(key,'pointerdown',{pointerId:71,button:0});await app.tick();f.time(40);app.emit(key,'pointerup',{pointerId:71});
      await app.click('play-button');await app.until(()=>!readPlaybackClock(app.$('progress')).running);
      take=await app.exported('export-takes');assert.equal(take.passes[0].inputs.length,1);
      const position=readPlaybackClock(app.$('progress')).positionMs;
      const machineGates=f.receiver()?.core.plan.count??app.audioNodes.findLast(node=>node.kind==='audio-worklet').core.plan.count;
      await app.click('edit-song-mod');setMod(app,'visible',parts[1].id,false);await applyMod(app);
      if(app.$('notation-toggle').getAttribute('aria-expanded')!=='true')await app.click('notation-toggle');
      await app.click('jianpu-button');
      await app.until(()=>JSON.parse(app.$('workspace').dataset.renderedNotationParts||'[]').length===parts.length-1,'The current source’s visible notation parts render');
      assert.deepEqual(JSON.parse(app.$('workspace').dataset.renderedNotationParts),parts.filter(part=>part.id!==parts[1].id).map(part=>part.id));
      assert.deepEqual(humanState(await app.exported('export-takes')),humanState(take));
      assert.equal(readPlaybackClock(app.$('progress')).positionMs,position,'Display-only edits preserve the paused clock');
      await app.click('play-button');await app.until(()=>renderer(app,name).dataset.rendererState==='playing');
      assert.equal(f.receiver().core.plan.count,machineGates,'Display-only edits leave machine audio ownership unchanged');
      f.time(100);
      await app.click('play-button');await app.until(()=>!app.$('play-button').disabled);
      const beforeMutePosition=readPlaybackClock(app.$('progress')).positionMs;
      await app.click('edit-song-mod');setMod(app,'mute',parts[1].id,true);await applyMod(app);
      const edited=await app.exported('export-takes');
      assert.deepEqual(humanState(edited),humanState(take),'Display/mute keeps the paused human take');
      assert.deepEqual(edited.target_plan,take.target_plan);
      assert.equal(readPlaybackClock(app.$('progress')).positionMs,beforeMutePosition);
      saved.set(name,edited.song_mod);
      await app.click('play-button');await app.until(()=>renderer(app,name).dataset.rendererState==='playing');
      assert.equal(f.receiver().core.plan.count,{canonical:2,basic:1,vsq:0}[name],'Mute removes only the explicitly muted machine part');
      assert.equal((await app.exported('export-takes')).passes.length,1,'Resume keeps the existing pass');
      await app.click('back-to-library');assert.equal(readPlaybackClock(app.$('progress')).running,false);
    }
    assert.equal([...f.storageValues.keys()].filter(key=>key.startsWith(SONG_MOD_STORAGE_PREFIX)).length,3);
    for(const [name,value]of Object.entries(sources))assert.equal(JSON.stringify(value),originals[name],`${name} source is unchanged`);
  }finally{await app.close();}
});

test('canonical, Basic and VSQ role changes keep Listen input-free and reset only ownership-dependent history',async()=>{
  const f=await crossModePerformanceApp(),{app,sources}=f;
  try{
    app.$('count-in').checked=false;
    for(const name of ['canonical','basic','vsq']){
      await f.select(name);await app.click('configure-song-mod');await app.click('song-mod-all-machine');await applyMod(app);await startPerformance(app,name);
      assert.equal(app.$('session-mode').value,'listen');assert.equal((await app.exported('export-takes')).passes.length,0);
      const parts=sources[name].score.parts;
      await app.click('edit-song-mod');setMod(app,'performer',parts[0].id,'human');await applyMod(app);
      assert.equal(app.$('session-mode').value,'practice');assert.equal((await app.exported('export-takes')).passes.length,0);
      await app.click('play-button');await app.until(()=>renderer(app,name).dataset.rendererState==='playing');f.time(100);
      assert.equal((await app.exported('export-takes')).passes.length,1);
      await app.click('reset-button');assert.equal(readPlaybackClock(app.$('progress')).positionMs,0);
      assert.equal((await app.exported('export-takes')).passes.length,0,'The existing explicit Reset action clears in-memory history');
      await app.click('play-button');await app.until(()=>renderer(app,name).dataset.rendererState==='playing');
      assert.equal((await app.exported('export-takes')).passes.length,1,'Playback after Reset creates a fresh history');
      await app.click('edit-song-mod');await app.click('song-mod-all-machine');await applyMod(app);
      assert.equal((await app.exported('export-takes')).passes.length,0);
      assert.equal(app.$('assess-button').disabled,true);
      await app.click('play-button');await app.until(()=>renderer(app,name).dataset.rendererState==='playing');
      assert.equal((await app.exported('export-takes')).passes.length,0);
    }
  }finally{await app.close();}
});
