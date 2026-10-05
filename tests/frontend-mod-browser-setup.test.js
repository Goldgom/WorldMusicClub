import test from 'node:test';
import assert from 'node:assert/strict';
import {nativeScoreServer,nativeStorageApp,nativeResponse} from './native-storage-app-fixtures.js';
import {fixture} from './frontend-fixtures.js';
import {readPlaybackClock} from '../web/playback-clock-view.js';

// In-memory DOM/backend wiring only. These checks launch no browser/server and
// cannot establish native trusted input, device audio or hosted acceptance.
async function pausedImport(score=fixture) {
  const server=await nativeScoreServer(),app=await nativeStorageApp(server,{now:()=>1000});
  await app.click('import-tools-button');app.importFile(score);
  await app.until(()=>app.$('score-title').textContent===score.title&&app.$('practice-scope').textContent.includes('physical attacks'));
  app.$('import-tools-dialog').querySelector('[data-close-panel]').click();
  if(app.document.body.dataset.screen==='home')await app.click('home-single-player');
  if(app.document.body.dataset.screen==='library')await app.click('resume-session');
  return{server,app};
}
test('a frozen-clock original fixture can activate paused through Import and Resume without live-audio Start',async()=>{
  const {app}=await pausedImport();
  try{
    assert.equal(app.document.body.dataset.screen,'stage');assert.equal(performance.now(),1000);
    const clock=readPlaybackClock(app.$('progress'));assert.equal(clock.positionMs,0);assert.equal(clock.running,false);
    assert.equal(app.audio().contexts,0);assert.equal(app.$('canonical-audio-policy').dataset.rendererState,'stopped');
    assert.deepEqual((await app.exported('export-button')).parts,fixture.parts);
    assert.equal((await app.exported('export-takes')).passes.length,0);
  }finally{await app.close();}
});
test('stage Mod closure precedes the second target check and the final out-of-range reason',async()=>{
  const score=structuredClone(fixture);score.title='Original setup range test';score.parts[0].notes[0].pitch={step:'C',alter:0,octave:8};
  const {app,server}=await pausedImport(score);let release,seen=0;
  try{
    server.setRoute(({path,body,defaultReply})=>{
      if(path==='/api/instrument-check')return nativeResponse({lowest_midi:36,highest_midi:96,note_options:body.timeline.notes.map(note=>({note_id:note.id,midi:note.midi,playable:note.midi>=36&&note.midi<=96,positions:[]})),diagnostics:[],changed_source_notes:false});
      if(path==='/api/practice-targets'&&++seen===2)return new Promise(resolve=>{release=()=>resolve(defaultReply());});
    });
    await app.click('edit-song-mod');await app.click('song-mod-all-human');app.$('song-mod-apply').click();await app.until(()=>Boolean(release),'Second target request must be waiting after Mod closes');
    assert.equal(app.$('song-mod-dialog').open,false);assert.match(app.$('practice-scope').textContent,/pending/);assert.equal(app.$('play-button').disabled,true);
    release();await app.until(()=>app.$('practice-gate-reason').textContent==='Selected notes outside this instrument range: 1. Change the range, tuning, part or loop before practicing.','Completed target check must publish the exact blocked reason');
    assert.match(app.$('practice-scope').textContent,/2 physical/);assert.equal(app.$('play-button').disabled,true);assert.equal(app.$('assess-button').disabled,true);
  }finally{release?.();await app.close();}
});
test('failed human preview Apply retains the draft and previous Listen settings until explicit recovery',async()=>{
  const server=await nativeScoreServer({scores:[fixture]}),app=await nativeStorageApp(server,{now:()=>1000});
  try{
    const key=[...server.records.keys()][0];await app.until(()=>app.savedButton(key));await app.click('home-single-player');app.savedButton(key).click();await app.until(()=>!app.$('configure-song-mod').disabled);
    await app.click('configure-song-mod');await app.click('song-mod-all-machine');await app.click('song-mod-apply');await app.until(()=>!app.$('song-mod-dialog').open);
    server.setRoute(({path})=>path==='/api/practice-targets'?nativeResponse({error:'Preview target service unavailable'},503):undefined);
    await app.click('configure-song-mod');await app.click('song-mod-all-human');await app.click('song-mod-apply');await app.until(()=>app.$('song-mod-error').textContent==='Preview target service unavailable'&&!app.$('song-mod-apply').disabled);
    assert.equal(app.$('song-mod-dialog').open,true);assert.match(app.$('song-mod-preview-summary').textContent,/0 human.*Listen/);assert.equal(app.document.body.dataset.screen,'library');
    assert.ok([...app.$('song-mod-parts').querySelectorAll('[data-mod-performer]')].every(node=>node.value==='human'));
    await app.click('song-mod-all-machine');await app.click('song-mod-apply');await app.until(()=>!app.$('song-mod-dialog').open);assert.equal(app.$('start-performance').disabled,false);assert.match(app.$('song-mod-preview-summary').textContent,/Listen/);
  }finally{await app.close();}
});
