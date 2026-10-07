import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {nativeScoreServer,nativeStorageApp,nativeResponse,deferred} from './native-storage-app-fixtures.js';
import {ASSISTANCE_STORAGE_PREFIX} from '../web/practice-assistance.js';
import {CanonicalPlayer} from '../web/canonical-player.js';
const fixture=JSON.parse(readFileSync(new URL('./fixtures/assistance-canonical.json',import.meta.url),'utf8'));
const control=(app,kind,id='piano')=>app.$('song-mod-parts').querySelector(`[data-mod-${kind}="${id}"]`);
const set=(app,node,value,type='change')=>{node.value=String(value);app.emit(node,type);};
const source=app=>app.audioNodes.findLast(node=>node.kind==='audio-worklet'&&node.connected&&node.core.plan?.count!==undefined);
async function setup({storageValues=new Map(),localStorageDescriptor,hold,failAudio=()=>false}={}){
 const score=fixture.compilation.score,server=await nativeScoreServer({scores:[score]});let wall=1000;
 server.setRoute(async({path,body})=>{
  if(path==='/api/compile'&&body.id===score.id)return nativeResponse(fixture.compilation);
  if(path==='/api/canonical-audio-profile'&&body.id===score.id)return failAudio()?nativeResponse({error:'Original test audio preparation failed'},503):nativeResponse(fixture.audio_profile);
  if(path.startsWith('/api/practice-assistance/')){if(hold)await hold(path,body);const result=path.endsWith('/generate')?fixture.automatic:body.selection.selected_part_ids.length?fixture.original:fixture.listen;assert.deepEqual(body.selection,result.checked.plan.selection);if(path.endsWith('/generate'))assert.deepEqual(body.settings,result.checked.plan.settings);assert.deepEqual(body.score,score);return nativeResponse(result);}
 });
 const app=await nativeStorageApp(server,{now:()=>wall,storageValues,localStorageDescriptor}),key=[...server.records.keys()][0];
 await app.until(()=>Boolean(app.savedButton(key)));await app.click('home-single-player');set(app,app.$('key-count'),88);app.savedButton(key).click();await app.until(()=>!app.$('configure-song-mod').disabled);await app.tick();
 return{app,server,score,storageValues,time(ms){wall=ms;app.renderAudioTo((ms-1000)/1000);app.frame();},async automatic(){await app.click('configure-song-mod');set(app,app.$('song-mod-assistance-mode'),'automatic');for(const [name,value] of Object.entries(fixture.automatic.checked.plan.settings)){if(name!=='algorithm_id')set(app,app.$(`song-mod-assistance-${name}`),value,'input');}await app.click('song-mod-assistance-check');await app.until(()=>app.$('song-mod-assistance-status').dataset.phase==='prepared');},async apply(){await app.click('song-mod-apply');await app.until(()=>!app.$('song-mod-dialog').open,()=>app.$('song-mod-error').textContent);}};
}

test('real app default Original has no assistance requests; explicit Automatic routes only checked humans to scoring and keeps same-part machine audio',async()=>{
 const f=await setup(),{app,server}=f,before=JSON.stringify(f.score);
 try{
  await app.until(()=>!app.$('start-performance').disabled);assert.equal(server.requests.filter(r=>r.path.includes('/assistance/')||r.path.includes('/practice-assistance/')).length,0);
  await f.automatic();assert.equal(control(app,'instrument').disabled,false);set(app,control(app,'instrument'),'reed');set(app,control(app,'live-instrument'),'guitar');await f.apply();
  assert.equal(app.document.body.dataset.screen,'library');assert.equal(source(app),undefined);assert.equal([...f.storageValues].filter(([key])=>key.startsWith(ASSISTANCE_STORAGE_PREFIX)).length,1);
  app.$('count-in').checked=false;app.$('metronome-enabled').checked=false;await app.click('start-performance');await app.until(()=>app.$('canonical-audio-policy').dataset.rendererState==='playing',()=>app.$('notice-message').textContent);
  const receiver=source(app),checked=fixture.automatic.checked;assert.equal(receiver.core.plan.count,checked.machine_occurrence_ids.length);assert.deepEqual([...receiver.core.plan.instruments],[2]);
  const take=await app.exported('export-takes');assert.deepEqual(take.target_plan.timeline.notes,checked.human_targets.timeline.notes);assert.deepEqual(take.passes[0].timeline.notes,checked.human_targets.timeline.notes);assert.equal(take.passes[0].interpretation.practice_assistance.plan.selection_digest,checked.plan.selection_digest);assert.equal(take.passes[0].interpretation.song_mod.config.parts[0].liveInstrument,'guitar');assert.deepEqual(take.passes[0].inputs,[]);assert.equal(JSON.stringify(f.score),before);
  assert.ok(server.requests.filter(r=>r.path==='/api/practice-assistance/generate').length>=2,'Stage revalidates its own token-bound receipt');
  assert.ok(server.requests.filter(r=>r.path==='/api/instrument-check').slice(-2).every(r=>r.body.timeline.notes.every(n=>checked.human_targets.groups.some(g=>g.source_occurrence_ids.includes(n.id)))));
 }finally{await app.close();}
});

test('stage reset confirmation, Cancel and Original apply preserve or replace the take at one paused boundary',async()=>{
 const f=await setup(),{app}=f;
 try{
  await f.automatic();await f.apply();app.$('count-in').checked=false;await app.click('start-performance');await app.until(()=>app.$('canonical-audio-policy').dataset.rendererState==='playing');await app.click('edit-song-mod');
  const before=await app.exported('export-takes');set(app,app.$('song-mod-assistance-mode'),'original');assert.equal(app.$('song-mod-apply').disabled,true);await app.click('song-mod-cancel');assert.deepEqual((await app.exported('export-takes')).passes,before.passes);
  await app.click('edit-song-mod');set(app,app.$('song-mod-assistance-mode'),'original');app.$('song-mod-assistance-reset').checked=true;app.emit(app.$('song-mod-assistance-reset'),'change');await f.apply();
  assert.equal(source(app),undefined);assert.equal(app.$('canonical-audio-policy').dataset.rendererState,'stopped');const after=await app.exported('export-takes');assert.equal(after.passes.length,0);assert.equal(after.practice_assistance.plan.mode,'original');assert.deepEqual(after.target_plan.timeline.notes,fixture.original.checked.human_targets.timeline.notes);
  await app.click('play-button');await app.until(()=>app.$('canonical-audio-policy').dataset.rendererState==='playing');assert.equal(source(app).core.plan.count,0);
 }finally{await app.close();}
});

test('saved recipe waits for current Rust validation and invalid storage remains blocked without a whole-part fallback',async()=>{
 const values=new Map();let f=await setup({storageValues:values});try{await f.automatic();await f.apply();}finally{await f.app.close();}
 const wait=deferred();let entered=false;f=await setup({storageValues:values,hold:async()=>{entered=true;await wait.promise;}});
 try{await f.app.until(()=>entered);assert.equal(f.app.$('start-performance').disabled,true);assert.equal(source(f.app),undefined);wait.resolve();await f.app.until(()=>!f.app.$('start-performance').disabled);assert.match(f.app.$('song-mod-preview-summary').textContent,/1 human/);}finally{wait.resolve();await f.app.close();}
 const key=[...values.keys()].find(key=>key.startsWith(ASSISTANCE_STORAGE_PREFIX));values.set(key,'broken');f=await setup({storageValues:values});try{await f.app.tick();assert.equal(f.app.$('start-performance').disabled,true);assert.equal(values.get(key),'broken');assert.equal(f.server.requests.filter(r=>r.path==='/api/practice-assistance/generate').length,0);await f.app.click('configure-song-mod');assert.equal(f.app.$('song-mod-assistance-replace-label').hidden,false);await f.app.click('song-mod-cancel');assert.equal(f.app.$('start-performance').disabled,true);}finally{await f.app.close();}
});

test('Cancel during Rust preparation fences late ownership and repeated Apply never autoplays',async()=>{
 const wait=deferred();let entered=false;const f=await setup({hold:async()=>{entered=true;await wait.promise;}}),{app}=f;
 try{await app.click('configure-song-mod');set(app,app.$('song-mod-assistance-mode'),'automatic');for(const [name,value]of Object.entries(fixture.automatic.checked.plan.settings))if(name!=='algorithm_id')set(app,app.$(`song-mod-assistance-${name}`),value,'input');await app.click('song-mod-apply');await app.until(()=>entered);await app.click('song-mod-apply');await app.click('song-mod-cancel');wait.resolve();await app.tick();await app.tick();assert.equal(app.$('song-mod-dialog').open,false);assert.equal(source(app),undefined);assert.equal([...f.storageValues.keys()].filter(key=>key.startsWith(ASSISTANCE_STORAGE_PREFIX)).length,0);assert.equal(f.server.requests.filter(r=>r.path==='/api/practice-assistance/generate').length,1);}finally{wait.resolve();await app.close();}
});

test('quota failure keeps a checked tab-only assignment through stage revalidation without overwriting the older recipe',async()=>{
 const values=new Map();let quota=false;
 const f=await setup({storageValues:values,localStorageDescriptor:{value:{getItem:key=>values.get(key)??null,setItem:(key,value)=>{if(quota&&key.startsWith(ASSISTANCE_STORAGE_PREFIX))throw Error('quota');values.set(key,value);}}}}),{app}=f;
 try{
  await app.click('configure-song-mod');await app.click('song-mod-assistance-check');await app.until(()=>app.$('song-mod-assistance-status').dataset.phase==='prepared');await f.apply();const key=[...values.keys()].find(key=>key.startsWith(ASSISTANCE_STORAGE_PREFIX)),old=values.get(key);quota=true;
  await f.automatic();await f.apply();assert.equal(values.get(key),old);assert.match(app.$('song-mod-preview-summary').textContent,/not saved|tab only/i);app.$('count-in').checked=false;await app.click('start-performance');await app.until(()=>app.$('canonical-audio-policy').dataset.rendererState==='playing');const exported=await app.exported('export-takes');assert.equal(exported.practice_assistance.plan.mode,'automatic');assert.equal(exported.target_plan.target_count,1);assert.equal(values.get(key),old);assert.match(app.$('song-mod-stage-summary').textContent,/not saved|tab only/i);
 }finally{await app.close();}
});

test('current Basic native source reference and complete runtime reach assisted scoring and same-part machine gates',async()=>{
 const native=JSON.parse(readFileSync(new URL('./fixtures/assistance-native-basic.json',import.meta.url),'utf8')),opened=native.opened,descriptor=opened.clean_package,score=JSON.parse(descriptor.score_json).notation,server=await nativeScoreServer(),key=native.source.key;
 const summary={version:2,content_sha256:descriptor.content_sha256,profile:descriptor.profile,capabilities:descriptor.capabilities,coverage:descriptor.coverage,notation_available:true,media:[]};server.records.set(key,{...opened,entry:{key,revision:1,title:score.title,composer:score.composer,score_id:score.id,label:score.title,score_bytes:Buffer.byteLength(descriptor.score_json),saved_at_unix_ms:1700000000000,clean_package:summary}});
 server.setRoute(({path,body})=>{if(path==='/api/library/assistance/generate'){assert.deepEqual(body.source,native.source);assert.deepEqual(body.selection,native.automatic.checked.plan.selection);assert.deepEqual(body.settings,native.automatic.checked.plan.settings);return nativeResponse(native.automatic);}});
 const app=await nativeStorageApp(server,{now:()=>1000}),before=descriptor.score_json;
 try{
  await app.until(()=>Boolean(app.savedButton(key)));await app.click('home-single-player');set(app,app.$('key-count'),'custom');set(app,app.$('custom-key-count'),88,'input');set(app,app.$('custom-lowest'),'A0','input');await app.click('instrument-apply');app.savedButton(key).click();await app.until(()=>!app.$('configure-song-mod').disabled);await app.click('configure-song-mod');await app.click('song-mod-all-human');set(app,app.$('song-mod-assistance-mode'),'automatic');for(const [field,value]of Object.entries(native.automatic.checked.plan.settings))if(field!=='algorithm_id')set(app,app.$(`song-mod-assistance-${field}`),value,'input');await app.click('song-mod-assistance-check');await app.until(()=>app.$('song-mod-assistance-status').dataset.phase==='prepared');
  const part=native.automatic.checked.source_ownership.find(unit=>unit.owner==='machine'&&unit.part_id===score.parts[0].id).part_id;assert.equal(control(app,'instrument',part).disabled,false);set(app,control(app,'instrument',part),'reed');await app.click('song-mod-apply');await app.until(()=>!app.$('song-mod-dialog').open);await app.click('start-performance');await app.until(()=>app.$('clean-song-stage').dataset.rendererState==='playing',()=>app.$('notice-message').textContent);
  const exported=await app.exported('export-takes');assert.deepEqual(exported.target_plan.timeline.notes,native.automatic.checked.human_targets.timeline.notes);assert.equal(source(app).core.plan.count,native.automatic.checked.machine_occurrence_ids.length);assert.deepEqual(exported.practice_assistance.receipt,native.automatic.checked.receipt);assert.equal(exported.passes[0].inputs.length,0);assert.equal(descriptor.score_json,before);
 }finally{await app.close();}
});

test('audio preparation failure leaves the assistance and Mod draft cancellable and never stores a partial commit',async()=>{
 const f=await setup({failAudio:()=>true}),{app}=f;
 try{await f.automatic();await app.click('song-mod-apply');await app.until(()=>app.$('song-mod-error').textContent.includes('audio preparation failed'));assert.equal(app.$('song-mod-dialog').open,true);assert.equal([...f.storageValues.keys()].filter(key=>key.startsWith(ASSISTANCE_STORAGE_PREFIX)).length,0);assert.equal(source(app),undefined);await app.click('song-mod-cancel');assert.equal(app.$('song-mod-dialog').open,false);assert.equal(app.$('start-performance').disabled,false);}finally{await app.close();}
});

test('navigation during assisted audio preparation revokes the current receipt and cannot start a stale receiver or record a take',async()=>{
 const f=await setup(),{app}=f,prepare=CanonicalPlayer.prototype.prepare,start=CanonicalPlayer.prototype.startPrepared,wait=deferred();let ready=false,starts=0;
 try{
  await f.automatic();await f.apply();CanonicalPlayer.prototype.prepare=async function(...args){const result=await prepare.apply(this,args);ready=true;await wait.promise;return result;};CanonicalPlayer.prototype.startPrepared=function(...args){starts++;return start.apply(this,args);};
  await app.click('start-performance');await app.until(()=>ready);await app.click('back-to-library');wait.resolve();await app.tick();await app.tick();assert.equal(starts,0);assert.equal(source(app),undefined);assert.equal((await app.exported('export-takes')).passes.length,0);assert.equal(app.document.body.dataset.screen,'library');assert.equal(app.$('notice-message').textContent,'');
 }finally{wait.resolve();CanonicalPlayer.prototype.prepare=prepare;CanonicalPlayer.prototype.startPrepared=start;await app.close();}
});

test('intentional assisted Listen keeps the complete machine song and creates no human take or grade',async()=>{
 const f=await setup(),{app}=f;
 try{
  await f.automatic();await f.apply();await app.click('configure-song-mod');await app.click('song-mod-all-machine');set(app,app.$('song-mod-assistance-mode'),'original');await f.apply();assert.match(app.$('song-mod-preview-summary').textContent,/Listen/);await app.click('start-performance');await app.until(()=>app.$('canonical-audio-policy').dataset.rendererState==='playing');assert.equal(app.$('session-mode').value,'listen');assert.equal(source(app).core.plan.count,fixture.compilation.timeline.notes.length);const exported=await app.exported('export-takes');assert.equal(exported.passes.length,0);assert.equal(exported.practice_assistance.scored_mode_allowed,false);assert.deepEqual(exported.practice_assistance.plan.selection.selected_part_ids,[]);assert.equal(app.$('assess-button').disabled,true);
 }finally{await app.close();}
});

test('assessment without playback validates the current assistance in the silent audio plan and scores checked human targets only',async()=>{
 const f=await setup(),{app}=f;
 try{
  await f.automatic();await f.apply();await app.click('start-performance');await app.until(()=>app.$('canonical-audio-policy').dataset.rendererState==='playing');await app.click('reset-button');await app.click('assess-button');await app.until(()=>Boolean(app.$('feedback-pass').querySelector('option[value="1"]')));const exported=await app.exported('export-takes');assert.equal(exported.passes.length,1);assert.match(exported.passes[0].interpretation.assistance_fingerprint,/^[a-f0-9]{64}$/);assert.deepEqual(exported.passes[0].timeline.notes,fixture.automatic.checked.human_targets.timeline.notes);assert.equal(exported.passes[0].inputs.length,0);assert.equal(source(app),undefined);
 }finally{await app.close();}
});
