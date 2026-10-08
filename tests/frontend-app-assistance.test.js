import {withMockBasicEligibility} from './basic-human-admission-fixtures.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {nativeScoreServer,nativeStorageApp,nativeResponse,deferred} from './native-storage-app-fixtures.js';
import {ASSISTANCE_STORAGE_PREFIX} from '../web/practice-assistance.js';
import {CanonicalPlayer} from '../web/canonical-player.js';
import {SongModStore,defaultSongMod,createSongMod} from '../web/song-mod.js';
const fixture=JSON.parse(readFileSync(new URL('./fixtures/assistance-canonical.json',import.meta.url),'utf8'));
const control=(app,kind,id='piano')=>app.$('song-mod-parts').querySelector(`[data-mod-${kind}="${id}"]`);
const set=(app,node,value,type='change')=>{node.value=String(value);app.emit(node,type);};
const source=app=>app.audioNodes.findLast(node=>node.kind==='audio-worklet'&&node.connected&&node.core.plan?.count!==undefined);
async function setup({storageValues=new Map(),localStorageDescriptor,hold,route,failOriginal=false,failAudio=()=>false,legacyLive=null}={}){
 const score=fixture.compilation.score,server=await nativeScoreServer({scores:[score]});let wall=1000;
 server.setRoute(async request=>{
  const custom=await route?.(request);if(custom!==undefined)return custom;
  const {path,body}=request;
  if(path==='/api/compile'&&body.id===score.id)return nativeResponse(fixture.compilation);
  if(path==='/api/canonical-audio-profile'&&body.id===score.id)return failAudio()?nativeResponse({error:'Original test audio preparation failed'},503):nativeResponse(fixture.audio_profile);
  if(failOriginal&&path==='/api/practice-assistance/original')return nativeResponse({code:'assistance_response_limit',error:'Complete assistance response exceeds 16 MiB; no IDs or ownership entries were truncated'},422);
  if(path.startsWith('/api/practice-assistance/')){if(hold)await hold(path,body);const result=path.endsWith('/generate')?fixture.automatic:body.selection.selected_part_ids.length?fixture.original:fixture.listen;assert.deepEqual(body.selection,result.checked.plan.selection);if(path.endsWith('/generate'))assert.deepEqual(body.settings,result.checked.plan.settings);assert.deepEqual(body.score,score);return nativeResponse(result);}
 });
 // Existing v2 sidecars retain their live sound even though its editor is retired.
 if(legacyLive){const base=defaultSongMod({score,mode:'practice',part:score.parts[0].id,practiceLayout:'complete'}),config=structuredClone(base.config);config.parts[0].liveInstrument=legacyLive;const mod=createSongMod(base,config);storageValues.set(new SongModStore().key(mod),JSON.stringify(mod));}
 const app=await nativeStorageApp(server,{now:()=>wall,storageValues,localStorageDescriptor}),key=[...server.records.keys()][0];
 await app.until(()=>Boolean(app.savedButton(key)));await app.click('home-single-player');set(app,app.$('key-count'),88);app.savedButton(key).click();await app.until(()=>!app.$('configure-song-mod').disabled);await app.tick();
 return{app,server,score,storageValues,time(ms){wall=ms;app.renderAudioTo((ms-1000)/1000);app.frame();},async automatic(){await app.click('configure-song-mod');set(app,app.$('song-mod-assistance-mode'),'automatic');for(const [name,value] of Object.entries(fixture.automatic.checked.plan.settings)){if(name!=='algorithm_id')set(app,app.$(`song-mod-assistance-${name}`),value,'input');}await app.click('song-mod-assistance-check');await app.until(()=>app.$('song-mod-assistance-status').dataset.phase==='prepared');},async apply(){await app.click('song-mod-apply');await app.until(()=>!app.$('song-mod-dialog').open,()=>app.$('song-mod-error').textContent);}};
}

test('real app default Original has no assistance requests; explicit Automatic routes only checked humans to scoring and keeps same-part machine audio',async()=>{
 const f=await setup({legacyLive:'guitar'}),{app,server}=f,before=JSON.stringify(f.score);
 try{
  await app.until(()=>!app.$('start-performance').disabled);assert.equal(server.requests.filter(r=>r.path.includes('/assistance/')||r.path.includes('/practice-assistance/')).length,0);
  await f.automatic();assert.equal(control(app,'instrument').disabled,false);set(app,control(app,'instrument'),'reed');assert.equal(control(app,'live-instrument'),null);await f.apply();
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
 const native=withMockBasicEligibility(JSON.parse(readFileSync(new URL('./fixtures/assistance-native-basic.json',import.meta.url),'utf8'))),opened=native.opened,descriptor=opened.clean_package,score=JSON.parse(descriptor.score_json).notation,server=await nativeScoreServer(),key=native.source.key;
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

test('navigation during assisted audio preparation cancels the receiver and cannot record a stale take',async()=>{
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

for(const edit of ['cancel','apply'])test(`resuming Automatic preserves its frozen take, scoring and audio after lobby Original ${edit}`,async()=>{
 const f=await setup(),{app}=f;
 try{
  await f.automatic();await f.apply();app.$('count-in').checked=false;await app.click('start-performance');await app.until(()=>app.$('canonical-audio-policy').dataset.rendererState==='playing');await app.click('back-to-library');const before=await app.exported('export-takes');await app.until(()=>!app.$('configure-song-mod').disabled);await app.click('configure-song-mod');set(app,app.$('song-mod-assistance-mode'),'original');if(edit==='apply')await f.apply();else await app.click('song-mod-cancel');
  const key=[...f.storageValues.keys()].find(key=>key.startsWith(ASSISTANCE_STORAGE_PREFIX));assert.equal(JSON.parse(f.storageValues.get(key)).mode,edit==='apply'?'original':'automatic');
  await app.click('resume-session');await app.until(()=>!app.$('play-button').disabled);const resumed=await app.exported('export-takes');assert.deepEqual(resumed.passes,before.passes);assert.deepEqual(resumed.target_plan,before.target_plan);assert.deepEqual(resumed.practice_assistance,before.practice_assistance);assert.equal(source(app),undefined);
  await app.click('play-button');await app.until(()=>app.$('canonical-audio-policy').dataset.rendererState==='playing');const played=await app.exported('export-takes');assert.equal(played.passes.length,1);assert.deepEqual(played.passes[0].timeline.notes,fixture.automatic.checked.human_targets.timeline.notes);assert.equal(played.practice_assistance.plan.selection_digest,played.passes[0].interpretation.practice_assistance.plan.selection_digest);assert.equal(played.practice_assistance.plan.mode,'automatic');assert.equal(source(app).core.plan.count,fixture.automatic.checked.machine_occurrence_ids.length);assert.equal(played.passes[0].interpretation.playback_segments.at(-1).assistance_fingerprint,played.passes[0].interpretation.assistance_fingerprint);
  if(edit==='apply'){await app.click('back-to-library');await app.until(()=>!app.$('start-performance').disabled);await app.click('start-performance');await app.until(()=>app.$('canonical-audio-policy').dataset.rendererState==='playing');const fresh=await app.exported('export-takes');assert.equal(fresh.practice_assistance.plan.mode,'original');assert.equal(fresh.passes.length,1);assert.deepEqual(fresh.passes[0].timeline.notes,fixture.original.checked.human_targets.timeline.notes);assert.equal(source(app).core.plan.count,0);}
 }finally{await app.close();}
});

const offChoice=async app=>{await app.click('song-mod-assistance-off');assert.equal(app.$('song-mod-assistance-check').hidden,true);};
const acknowledgeReset=app=>{app.$('song-mod-assistance-reset').checked=true;app.emit(app.$('song-mod-assistance-reset'),'change');};
test('explicit preview Off escapes an oversized checked Original response, survives reload and uses actual full-part targets/audio',async()=>{
 const values=new Map();let f=await setup({storageValues:values,failOriginal:true}),{app}=f;
 try{
  await f.automatic();await f.apply();await app.click('configure-song-mod');set(app,app.$('song-mod-assistance-mode'),'original');await app.click('song-mod-apply');await app.until(()=>app.$('song-mod-error').textContent.includes('16 MiB'));await app.click('song-mod-cancel');
  const key=[...values.keys()].find(k=>k.startsWith(ASSISTANCE_STORAGE_PREFIX)),before=values.get(key);await app.click('configure-song-mod');await offChoice(app);await app.click('song-mod-cancel');assert.equal(values.get(key),before);
  await app.click('configure-song-mod');await offChoice(app);await f.apply();assert.equal(JSON.parse(values.get(key)).format,'wmc-practice-assistance-off');assert.match(app.$('song-mod-preview-summary').textContent,/assistance is off/);assert.equal(f.server.requests.filter(r=>r.path==='/api/practice-assistance/original').length,1);assert.equal(source(app),undefined);
 }finally{await app.close();}
 f=await setup({storageValues:values,failOriginal:true});app=f.app;
 try{
  await app.until(()=>!app.$('start-performance').disabled);assert.match(app.$('song-mod-preview-summary').textContent,/assistance is off/);assert.equal(f.server.requests.some(r=>r.path.startsWith('/api/practice-assistance/')),false);app.$('count-in').checked=false;await app.click('start-performance');await app.until(()=>app.$('canonical-audio-policy').dataset.rendererState==='playing');f.time(app.sourceStartWall()+20);const key=app.document.querySelector('#keyboard [data-midi="60"]');app.emit(key,'pointerdown',{pointerId:96,button:0});f.time(app.sourceStartWall()+40);app.emit(key,'pointerup',{pointerId:96,button:0});const take=await app.exported('export-takes');assert.equal(take.practice_assistance,null);assert.equal(take.practice_assistance_disabled,true);assert.equal(take.target_plan.target_count,fixture.original.checked.human_targets.target_count);assert.equal(take.passes[0].timeline.notes.length,2);assert.equal(take.passes[0].inputs.length,1);assert.equal(take.passes[0].interpretation.practice_assistance_disabled,true);assert.equal(source(app).core.plan.count,0);assert.deepEqual(await app.exported('export-button'),fixture.compilation.score);
 }finally{await app.close();}
});

test('preview Off does not alter a paused Automatic take; explicit stage Off requires reset and replaces its plan atomically',async()=>{
 const f=await setup({failOriginal:true}),{app}=f;
 try{
  await f.automatic();await f.apply();app.$('count-in').checked=false;await app.click('start-performance');await app.until(()=>app.$('canonical-audio-policy').dataset.rendererState==='playing');await app.click('back-to-library');const before=await app.exported('export-takes');await app.click('configure-song-mod');await offChoice(app);await f.apply();await app.click('resume-session');await app.until(()=>!app.$('play-button').disabled);const resumed=await app.exported('export-takes');assert.deepEqual(resumed.passes,before.passes);assert.deepEqual(resumed.practice_assistance,before.practice_assistance);
  await app.click('edit-song-mod');await offChoice(app);assert.equal(app.$('song-mod-apply').disabled,true);await app.click('song-mod-cancel');const afterCancel=await app.exported('export-takes');assert.deepEqual(afterCancel.passes,before.passes);assert.equal(afterCancel.practice_assistance_disabled,undefined);assert.equal(afterCancel.practice_assistance.plan.mode,'automatic');assert.match(app.$('song-mod-stage-summary').textContent,/This session keeps its checked note assignment/);
  await app.click('edit-song-mod');await offChoice(app);acknowledgeReset(app);await f.apply();const reset=await app.exported('export-takes');assert.equal(reset.passes.length,0);assert.equal(reset.practice_assistance,null);assert.equal(reset.practice_assistance_disabled,true);assert.equal(reset.target_plan.target_count,2);assert.equal(source(app),undefined);assert.equal(f.server.requests.some(r=>r.path==='/api/practice-assistance/original'),false);
  await app.click('play-button');await app.until(()=>app.$('canonical-audio-policy').dataset.rendererState==='playing');const take=await app.exported('export-takes');assert.equal(take.passes[0].timeline.notes.length,2);assert.equal(source(app).core.plan.count,0);
 }finally{await app.close();}
});

for(const failure of ['conflict','write'])test(`stage Off ${failure} failure preserves the current Automatic receipt, take and previous bytes`,async()=>{
 const values=new Map();let refuse=false;const f=await setup({storageValues:values,failOriginal:true,localStorageDescriptor:{value:{getItem:key=>values.get(key)??null,setItem:(key,value)=>{if(refuse&&key.startsWith(ASSISTANCE_STORAGE_PREFIX))throw Error('quota');values.set(key,value);}}}}),{app}=f;
 try{
  await f.automatic();await f.apply();await app.click('start-performance');await app.until(()=>app.$('canonical-audio-policy').dataset.rendererState==='playing');await app.click('edit-song-mod');const before=await app.exported('export-takes'),key=[...values.keys()].find(k=>k.startsWith(ASSISTANCE_STORAGE_PREFIX));await offChoice(app);acknowledgeReset(app);if(failure==='conflict')values.set(key,values.get(key)+' ');else refuse=true;const bytes=values.get(key);await app.click('song-mod-apply');await app.until(()=>app.$('song-mod-error').textContent.includes(failure==='conflict'?'another window':'could not be saved'));assert.equal(values.get(key),bytes);assert.equal(app.$('song-mod-dialog').open,true);const after=await app.exported('export-takes');assert.deepEqual(after.passes,before.passes);assert.deepEqual(after.practice_assistance,before.practice_assistance);assert.deepEqual(after.target_plan,before.target_plan);assert.equal(source(app),undefined);await app.click('song-mod-cancel');
 }finally{await app.close();}
});

test('failed Off keeps a tab-only Automatic session when quota prevented saving its original recipe',async()=>{
 const values=new Map(),f=await setup({storageValues:values,failOriginal:true,localStorageDescriptor:{value:{getItem:key=>values.get(key)??null,setItem:(key,value)=>{if(key.startsWith(ASSISTANCE_STORAGE_PREFIX))throw Error('quota');values.set(key,value);}}}}),{app}=f;
 try{
  await f.automatic();await f.apply();assert.match(app.$('song-mod-preview-summary').textContent,/tab only/i);await app.click('start-performance');await app.until(()=>app.$('canonical-audio-policy').dataset.rendererState==='playing');await app.click('edit-song-mod');const before=await app.exported('export-takes');await offChoice(app);acknowledgeReset(app);await app.click('song-mod-apply');await app.until(()=>app.$('song-mod-error').textContent.includes('could not be saved'));const after=await app.exported('export-takes');assert.deepEqual(after.practice_assistance,before.practice_assistance);assert.deepEqual(after.passes,before.passes);assert.equal([...values.keys()].some(key=>key.startsWith(ASSISTANCE_STORAGE_PREFIX)),false);await app.click('song-mod-cancel');assert.match(app.$('song-mod-stage-summary').textContent,/tab only/i);await app.click('play-button');await app.until(()=>app.$('canonical-audio-policy').dataset.rendererState==='playing');assert.equal(source(app).core.plan.count,1);
 }finally{await app.close();}
});

for(const outcome of ['rejected','cancelled'])test(`${outcome} source replacement preserves admitted Automatic targets, existing take and resumable audio`,async()=>{
 const pending=deferred();let request;
 const f=await setup({route:r=>{if(r.path==='/api/compile'&&r.body.id==='replacement-attempt'){request=r;return pending.promise;}}}),{app}=f;
 try{
  await f.automatic();await f.apply();app.$('count-in').checked=false;await app.click('start-performance');await app.until(()=>app.$('canonical-audio-policy').dataset.rendererState==='playing');
  f.time(app.sourceStartWall()+20);const key=app.document.querySelector('#keyboard [data-midi="60"]');app.emit(key,'pointerdown',{pointerId:101,button:0});app.emit(key,'pointerup',{pointerId:101});await app.click('play-button');await app.click('back-to-library');await app.until(()=>!app.$('start-performance').disabled);
  const before=await app.exported('export-takes'),stored=[...f.storageValues],original=await app.exported('export-button');assert.equal(before.passes[0].inputs.length,1);
  app.importFile({...structuredClone(f.score),id:'replacement-attempt',title:'Unaccepted source'});await app.until(()=>Boolean(request));
  assert.equal(app.$('configure-song-mod').disabled,true);assert.equal(app.$('start-performance').disabled,true);assert.deepEqual((await app.exported('export-takes')).practice_assistance,before.practice_assistance);
  if(outcome==='rejected')pending.resolve(nativeResponse({error:'Replacement compile rejected'},400));else app.importFile('{broken',{name:'cancel-replacement.json'});
  await app.until(()=>app.$('notice-message').textContent.includes(outcome==='rejected'?'Replacement compile rejected':'cancel-replacement.json'));
  assert.equal(app.$('start-performance').disabled,false);assert.equal(app.$('play-button').disabled,false);assert.deepEqual(await app.exported('export-button'),original);assert.deepEqual(await app.exported('export-takes'),before);assert.deepEqual([...f.storageValues],stored);assert.equal(source(app),undefined);
  if(outcome==='cancelled'){pending.resolve(request.defaultReply());await app.tick();await app.tick();assert.deepEqual(await app.exported('export-button'),original);assert.deepEqual(await app.exported('export-takes'),before);}
  await app.click('resume-session');await app.click('play-button');await app.until(()=>app.$('canonical-audio-policy').dataset.rendererState==='playing');const resumed=await app.exported('export-takes');assert.equal(resumed.passes.length,1);assert.deepEqual(resumed.target_plan,before.target_plan);assert.deepEqual(resumed.practice_assistance,before.practice_assistance);assert.equal(resumed.passes[0].interpretation.playback_segments.at(-1).assistance_fingerprint,before.passes[0].interpretation.assistance_fingerprint);assert.equal(source(app).core.plan.count,fixture.automatic.checked.machine_occurrence_ids.length);assert.deepEqual(resumed.passes[0].inputs,before.passes[0].inputs);
 }finally{pending.resolve(nativeResponse({error:'Cancelled test request'},400));await app.close();}
});
