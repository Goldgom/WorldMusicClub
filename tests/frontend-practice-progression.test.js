import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {nativeScoreServer,nativeStorageApp,nativeResponse,deferred} from './native-storage-app-fixtures.js';
import {PROGRESSION_STORAGE_PREFIX} from '../web/practice-progression.js';
import {ASSISTANCE_STORAGE_PREFIX} from '../web/practice-assistance.js';
import {beat} from '../web/music.js';
import {songModIdentity} from '../web/song-mod.js';

// Pure Node production-app DOM/audio-core harness. DTOs come unchanged from
// Rust handlers; this is not browser, native-package or executable acceptance.
const fixture=JSON.parse(readFileSync(new URL('./fixtures/progression-canonical.json',import.meta.url),'utf8'));
const set=(app,id,value,type='change')=>{const node=app.$(id);node.value=String(value);app.emit(node,type);};
const source=app=>app.audioNodes.findLast(node=>node.kind==='audio-worklet'&&node.connected&&node.core.plan?.count!==undefined);
const acknowledge=app=>{app.$('song-mod-assistance-reset').checked=true;app.emit(app.$('song-mod-assistance-reset'),'change');};
const saved=values=>[...values].filter(([key])=>key.startsWith(PROGRESSION_STORAGE_PREFIX));
async function setup({storageValues=new Map(),localStorageDescriptor,hold,failOriginal=false}={}){
  const score=fixture.score,server=await nativeScoreServer({scores:[score]});let wall=1000;
  server.setRoute(async request=>{
    const {path,body}=request;
    if(path==='/api/compile'&&body.id===score.id)return nativeResponse(fixture.compilation);
    if(path==='/api/canonical-audio-profile'&&body.id===score.id)return nativeResponse(fixture.audio_profile);
    if(path.startsWith('/api/practice-progression/')){
      assert.deepEqual(body.score,score);const layer=body.layer||body.plan.layer,response=fixture.layers[layer].response;
      if(path.endsWith('/validate'))assert.deepEqual(body.plan,response.checked.plan);else assert.deepEqual(body.selection,fixture.selection);
      await hold?.(request);return nativeResponse(response);
    }
    if(path==='/api/practice-assistance/original'){assert.deepEqual(body.score,score);assert.deepEqual(body.selection,fixture.selection);return failOriginal?nativeResponse({code:'assistance_response_limit',error:'Original ownership DTO exceeds its response budget'},422):nativeResponse(fixture.original);}
    if(path==='/api/practice-window'){const start=beat(body.from)*500,end=beat(body.to)*500;return nativeResponse({start_ms:start,end_ms:end,target_note_ids:fixture.compilation.timeline.notes.filter(note=>note.start_ms>=start&&note.start_ms<end).map(note=>note.id),crossing_notes:0,diagnostics:[]});}
    if(path==='/api/assess')return nativeResponse({error:'Scoring result deliberately omitted from DOM transport fixture'},503);
  });
  const app=await nativeStorageApp(server,{now:()=>wall,storageValues,localStorageDescriptor}),key=[...server.records.keys()][0];await app.until(()=>Boolean(app.savedButton(key)));await app.click('home-single-player');set(app,'key-count',88);app.savedButton(key).click();await app.until(()=>!app.$('configure-song-mod').disabled);await app.tick();
  return{app,server,score,storageValues,time(ms){wall=ms;app.renderAudioTo((ms-1000)/1000);app.frame();},
    async open(layer='single',where='preview'){await app.click(where==='stage'?'edit-song-mod':'configure-song-mod');set(app,'song-mod-assistance-mode','progression');set(app,'song-mod-progression-layer',layer);},
    async check(){await app.click('song-mod-assistance-check');await app.until(()=>app.$('song-mod-assistance-status').dataset.phase==='prepared',()=>app.$('song-mod-assistance-status').textContent);},
    async apply(){assert.equal(app.$('song-mod-apply').disabled,false);await app.click('song-mod-apply');await app.until(()=>!app.$('song-mod-dialog').open,()=>app.$('song-mod-error').textContent);},
    async start(){app.$('count-in').checked=false;app.$('metronome-enabled').checked=false;await app.click('start-performance');await app.until(()=>app.$('canonical-audio-policy').dataset.rendererState==='playing',()=>app.$('notice-message').textContent);},
  };
}
test('explicit nested mode previews 3/6/12 targets, saves once, and feeds only checked humans to the take',async()=>{
  const f=await setup(),{app,server}=f,before=JSON.stringify(f.score);
  try{
    assert.equal(server.requests.filter(request=>request.path.includes('progression')).length,0);await f.open();await f.check();assert.match(app.$('song-mod-progression-summary').textContent,/3 human targets.*6 human targets.*12 human targets/);assert.equal(saved(f.storageValues).length,0);assert.equal(source(app),undefined);
    await f.apply();assert.equal(saved(f.storageValues).length,1);assert.equal([...f.storageValues.keys()].filter(key=>key.startsWith(ASSISTANCE_STORAGE_PREFIX)).length,0);assert.match(app.$('song-mod-preview-summary').textContent,/Progressive assistance/);await f.start();
    f.time(1750);const checked=fixture.layers.single.response.checked,take=await app.exported('export-takes');assert.deepEqual(take.target_plan.timeline.notes,checked.assistance.human_targets.timeline.notes);assert.equal(source(app).core.plan.count,checked.assistance.machine_occurrence_ids.length);assert.deepEqual(take.practice_progression,checked.plan);assert.deepEqual(take.passes[0].interpretation.practice_progression,checked.plan);assert.deepEqual(take.passes[0].inputs,[]);assert.equal(JSON.stringify(f.score),before);
    assert.ok(server.requests.some(request=>request.path==='/api/practice-progression/validate'),'Stage validates its own current source proof');
  }finally{await app.close();}
});
test('stage change requires fresh reset, Check and Cancel preserve the take, Apply pauses and clears it',async()=>{
  const f=await setup(),{app}=f;
  try{
    await f.open();await f.apply();await f.start();await f.open('dense','stage');const before=await app.exported('export-takes');assert.equal(app.$('song-mod-apply').disabled,true);await f.check();assert.deepEqual((await app.exported('export-takes')).passes,before.passes);await app.click('song-mod-cancel');assert.deepEqual((await app.exported('export-takes')).passes,before.passes);
    await f.open('dense','stage');acknowledge(app);set(app,'song-mod-progression-layer','balanced');assert.equal(app.$('song-mod-assistance-reset').checked,false);set(app,'song-mod-progression-layer','dense');acknowledge(app);await f.apply();const after=await app.exported('export-takes');assert.equal(after.passes.length,0);assert.equal(after.target_plan.target_count,12);assert.equal(after.practice_progression.layer,'dense');assert.equal(source(app),undefined);assert.equal(app.$('canonical-audio-policy').dataset.rendererState,'stopped');
  }finally{await app.close();}
});
test('saved progression waits for complete proof validation; Off bypasses oversized Original and remains Off on reopen',async()=>{
  const values=new Map();let f=await setup({storageValues:values});try{await f.open();await f.apply();}finally{await f.app.close();}
  const gate=deferred();let entered=false;f=await setup({storageValues:values,failOriginal:true,hold:async request=>{if(request.path.endsWith('/validate')){entered=true;await gate.promise;}}});
  try{
    await f.app.until(()=>entered);assert.equal(f.app.$('start-performance').disabled,true);gate.resolve();await f.app.until(()=>!f.app.$('start-performance').disabled);await f.app.click('configure-song-mod');set(f.app,'song-mod-assistance-mode','original');await f.app.click('song-mod-assistance-check');await f.app.until(()=>f.app.$('song-mod-assistance-status').dataset.phase==='error');const requests=f.server.requests.filter(request=>request.path.endsWith('/original')).length;
    await f.app.click('song-mod-assistance-off');await f.apply();assert.equal(f.server.requests.filter(request=>request.path.endsWith('/original')).length,requests);assert.equal(JSON.parse(saved(values)[0][1]).mode,'off');assert.equal(JSON.parse(saved(values)[0][1]).plan,null);
  }finally{gate.resolve();await f.app.close();}
  f=await setup({storageValues:values,failOriginal:true});try{await f.app.until(()=>!f.app.$('start-performance').disabled);assert.equal(f.server.requests.filter(request=>request.path.includes('progression')||request.path.endsWith('/original')).length,0);await f.app.click('configure-song-mod');await f.apply();assert.equal(f.server.requests.filter(request=>request.path.endsWith('/original')).length,0,'Reopening Off does not silently opt into Original');await f.start();const take=await f.app.exported('export-takes');assert.equal(take.practice_assistance,null);assert.equal(take.practice_progression,null);assert.equal(take.target_plan.target_count,12);}finally{await f.app.close();}
});
test('quota failure leaves the progression, Mod and active take unchanged and the draft cancellable',async()=>{
  const values=new Map();let quota=false;const f=await setup({storageValues:values,localStorageDescriptor:{value:{getItem:key=>values.get(key)??null,setItem:(key,value)=>{if(quota&&key.startsWith(PROGRESSION_STORAGE_PREFIX))throw Error('quota');values.set(key,value);}}}}),{app}=f;
  try{await f.open();await f.apply();await f.start();await f.open('dense','stage');const before=await app.exported('export-takes'),bytes=saved(values)[0][1];quota=true;acknowledge(app);await app.click('song-mod-apply');await app.until(()=>/could not be saved/.test(app.$('song-mod-error').textContent));assert.equal(app.$('song-mod-dialog').open,true);assert.equal(saved(values)[0][1],bytes);assert.deepEqual((await app.exported('export-takes')).passes,before.passes);await app.click('song-mod-cancel');assert.deepEqual((await app.exported('export-takes')).practice_progression,before.practice_progression);}finally{await app.close();}
});
test('Cancel fences a late checked stage without saving or revealing stale counts',async()=>{
  const gate=deferred();let entered=false;const f=await setup({hold:async()=>{entered=true;await gate.promise;}}),{app}=f;
  try{await f.open();await app.click('song-mod-assistance-check');await app.until(()=>entered);await app.click('song-mod-cancel');gate.resolve();await app.tick();await f.open('balanced');assert.doesNotMatch(app.$('song-mod-progression-summary').textContent,/3 human targets|6 human targets|12 human targets/);assert.equal(saved(f.storageValues).length,0);assert.equal(source(app),undefined);}finally{gate.resolve();await app.close();}
});
test('loop changes revalidate admission while stages keep full-source membership and full lobby admission',async()=>{
  const f=await setup(),{app,server}=f;
  try{
    await f.open();await f.apply();await f.start();await app.click('edit-song-mod');await app.click('song-mod-cancel');set(app,'loop-from','0','input');set(app,'loop-to','2','input');await app.click('loop-apply');await app.until(()=>app.$('loop-enabled').checked&&!app.$('play-button').disabled);const scoped=await app.exported('export-takes');assert.equal(scoped.target_plan.target_count,2);assert.equal(scoped.practice_progression.hierarchy_digest,fixture.layers.single.response.checked.plan.hierarchy_digest);
    const requests=server.requests.length;await f.open('dense','stage');await f.check();assert.match(app.$('song-mod-progression-summary').textContent,/3 human targets.*6 human targets.*12 human targets/);acknowledge(app);await f.apply();const dense=await app.exported('export-takes');assert.equal(dense.target_plan.target_count,8);assert.equal(dense.practice_progression.layer,'dense');const admitted=server.requests.slice(requests).filter(request=>request.path==='/api/instrument-check').map(request=>request.body.timeline.notes.length);assert.ok(admitted.includes(8),'The loop was admitted');assert.ok(admitted.includes(12),'The full lobby source was admitted independently');
  }finally{await app.close();}
});
test('production app rejects a competing v1 save after first progression Check without changing the active take',async()=>{
  const f=await setup(),{app,storageValues}=f;
  try{
    await f.start();await f.open('single','stage');await f.check();const before=await app.exported('export-takes');assert.equal(before.target_plan.target_count,12);assert.equal(saved(storageValues).length,0);
    const identity=songModIdentity({score:fixture.compilation.score}),preferenceKey=JSON.stringify([identity.songId,identity.sourceRevision.kind,identity.sourceRevision.value]),key=ASSISTANCE_STORAGE_PREFIX+encodeURIComponent(preferenceKey),plan=fixture.original.checked.plan;
    assert.equal(storageValues.has(key),false);const external=JSON.stringify({format:'wmc-practice-assistance-recipe',version:1,preference_key:preferenceKey,source:null,selection:plan.selection,mode:'original',settings:null,planner_revision:plan.planner_revision,revision:plan.revision,expected_selection_digest:plan.selection_digest});storageValues.set(key,external);
    acknowledge(app);await app.click('song-mod-apply');await app.until(()=>/previous saved assignment changed/.test(app.$('song-mod-error').textContent));assert.equal(app.$('song-mod-dialog').open,true);assert.equal(saved(storageValues).length,0);assert.equal(storageValues.get(key),external);const after=await app.exported('export-takes');assert.deepEqual(after.passes,before.passes);assert.deepEqual(after.target_plan,before.target_plan);assert.deepEqual(after.song_mod,before.song_mod);assert.deepEqual(after.practice_assistance,before.practice_assistance);assert.deepEqual(after.practice_progression,before.practice_progression);await app.click('song-mod-cancel');assert.deepEqual((await app.exported('export-takes')).passes,before.passes);
  }finally{await app.close();}
});
