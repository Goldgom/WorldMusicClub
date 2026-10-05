import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {nativeScoreServer,nativeStorageApp,nativeResponse} from './native-storage-app-fixtures.js';
import {basicKeyRenditionFixture} from './basic-key-rendition-fixtures.js';
import {originalMultipartNotation} from './notation-scope-fixtures.js';
import {SONG_MOD_STORAGE_PREFIX} from '../web/song-mod.js';

async function basicFixture({storageValues=new Map()}={}){
 const opened=basicKeyRenditionFixture(),descriptor=opened.clean_package,score=JSON.parse(descriptor.score_json).notation,server=await nativeScoreServer(),key=`song-${descriptor.content_sha256}`;
 const summary={version:2,content_sha256:descriptor.content_sha256,profile:descriptor.profile,capabilities:descriptor.capabilities,coverage:descriptor.coverage,notation_available:true,media:[]};
 server.records.set(key,{...opened,entry:{key,revision:1,title:score.title,composer:score.composer,score_id:score.id,label:score.title,score_bytes:Buffer.byteLength(JSON.stringify(score)),saved_at_unix_ms:1700000000000,clean_package:summary}});
 const pages=JSON.parse(readFileSync(new URL('./fixtures/basic-key-rendition-notation-page.json',import.meta.url))),third=JSON.parse(readFileSync(new URL('./fixtures/basic-key-rendition-third-part.json',import.meta.url)));
 server.setRoute(({path,body})=>path==='/api/library/basic-keys/notation'?nativeResponse(body.settings.part_id===score.parts[1].id?pages.percussion.response:body.settings.part_id===score.parts[2].id?third.response:pages.melodic.response):undefined);
 let clock=1000;const app=await nativeStorageApp(server,{now:()=>clock,storageValues});await app.until(()=>app.savedButton(key)&&!app.$('start-listen').disabled);await app.click('home-single-player');app.savedButton(key).click();await app.until(()=>!app.$('configure-song-mod').disabled);await app.click('basic-key-preview-piano-88');await app.until(()=>!app.$('start-performance').disabled);return{app,score,descriptor,server,storageValues,time:ms=>{clock=ms;app.renderAudioTo((ms-1000)/1000);app.frame();}};
}
const control=(app,kind,id)=>app.$('song-mod-parts').querySelector(`[data-mod-${kind}="${id}"]`);
const set=(app,kind,id,value)=>{const node=control(app,kind,id);if(typeof value==='boolean')node.checked=value;else node.value=value;app.emit(node,'change');};
const source=app=>app.audioNodes.findLast(node=>node.kind==='audio-worklet'&&node.connected&&node.core.plan?.count!==undefined);
const apply=async app=>{await app.click('song-mod-apply');await app.until(()=>!app.$('song-mod-dialog').open);};

test('selected song exposes one Start and Mod; Basic per-part roles, mute, visibility and source sound round trip without editing source',async()=>{
 const f=await basicFixture(),{app,score,descriptor,storageValues}=f,before=descriptor.score_json;
 try{
  assert.deepEqual([...app.document.querySelectorAll('.preview-actions button')].filter(node=>!node.hidden).map(node=>node.id),['start-performance','configure-song-mod']);assert.equal(app.$('falling-note-labels').checked,false);
  await app.click('configure-song-mod');assert.equal(app.$('song-mod-dialog').open,true);assert.equal(control(app,'instrument',score.parts[0].id).disabled,true);assert.equal(control(app,'instrument',score.parts[1].id).disabled,false);
  app.$('song-mod-layout').value='complete';set(app,'mute',score.parts[0].id,true);set(app,'mute',score.parts[2].id,true);set(app,'visible',score.parts[2].id,false);await apply(app);
  assert.equal(app.document.body.dataset.screen,'library');assert.equal(app.audioNodes.filter(node=>node.kind==='audio-worklet'&&node.connected).length,0);
  const saved=JSON.parse([...storageValues].find(([key])=>key.startsWith(SONG_MOD_STORAGE_PREFIX))[1]);assert.equal(saved.config.parts[2].muted,true);assert.equal(saved.config.parts[2].visible,false);
  await app.click('start-performance');await app.until(()=>app.$('clean-song-stage').dataset.rendererState==='playing');f.time(1060);
  assert.equal(source(app).core.plan.count,1);assert.equal(app.$('session-mode').value,'practice');await app.click('notation-toggle');await app.click('jianpu-button');await app.until(()=>JSON.parse(app.$('workspace').dataset.renderedNotationParts||'[]').length===2,'Visible Mod part set');assert.deepEqual(JSON.parse(app.$('workspace').dataset.renderedNotationParts),score.parts.slice(0,2).map(p=>p.id));
  await app.click('play-button');const exported=await app.exported('export-takes');assert.ok(exported.passes.length);assert.ok(exported.passes[0].timeline.notes.every(note=>note.part_id===score.parts[0].id));assert.deepEqual(exported.song_mod,saved);assert.equal(descriptor.score_json,before);
  await app.click('edit-song-mod');set(app,'performer',score.parts[1].id,'human');await app.click('song-mod-cancel');assert.deepEqual((await app.exported('export-takes')).song_mod,saved);
  await app.click('edit-song-mod');await app.click('song-mod-restore');await apply(app);assert.equal((await app.exported('export-takes')).song_mod.config.parts[2].muted,false);assert.equal((await app.exported('export-takes')).song_mod.config.parts[2].visible,true);
 }finally{await app.close();}
});

test('all-machine Start is Listen and never creates a human take; all-human keeps silent machine plan and physical targets',async()=>{
 const f=await basicFixture(),{app,score}=f;
 try{
  await app.click('configure-song-mod');await app.click('song-mod-all-machine');await apply(app);assert.match(app.$('song-mod-preview-summary').textContent,/Listen/);await app.click('start-performance');await app.until(()=>app.$('clean-song-stage').dataset.rendererState==='playing');f.time(1060);assert.equal(app.$('session-mode').value,'listen');assert.equal(source(app).core.plan.count,5);assert.equal((await app.exported('export-takes')).passes.length,0);
  await app.click('edit-song-mod');await app.click('song-mod-all-human');await apply(app);assert.equal(app.$('session-mode').value,'practice');assert.equal((await app.exported('export-takes')).passes.length,0);await app.click('play-button');await app.until(()=>app.$('clean-song-stage').dataset.rendererState==='playing');assert.equal(source(app).core.plan.count,0);const exported=await app.exported('export-takes');assert.equal(exported.song_mod.config.parts.length,score.parts.length);assert.equal(exported.practice_selection.kind,'all');assert.ok(exported.target_plan.target_count<=exported.target_plan.source_note_count);
 }finally{await app.close();}
});

test('a reopened Basic source restores saved Mod assignment rather than a first-part fallback',async()=>{
 const storageValues=new Map();let f=await basicFixture({storageValues});
 try{await f.app.click('configure-song-mod');await f.app.click('song-mod-all-machine');set(f.app,'mute',f.score.parts[1].id,true);await apply(f.app);}finally{await f.app.close();}
 f=await basicFixture({storageValues});try{await f.app.click('configure-song-mod');assert.ok(f.score.parts.every(part=>control(f.app,'performer',part.id).value==='machine'));assert.equal(control(f.app,'mute',f.score.parts[1].id).checked,true);await f.app.click('song-mod-cancel');await f.app.click('start-performance');await f.app.until(()=>f.app.$('clean-song-stage').dataset.rendererState==='playing');assert.equal(f.app.$('session-mode').value,'listen');assert.equal(source(f.app).core.plan.count,4);}finally{await f.app.close();}
});

test('canonical stage Mod preserves A/B loop and tempo controls and requires no new source compilation on Apply',async()=>{
 const score=originalMultipartNotation({partCount:2,measures:4}),server=await nativeScoreServer({scores:[score]}),app=await nativeStorageApp(server,{now:()=>1000});
 try{const key=[...server.records.keys()][0];await app.until(()=>app.savedButton(key)&&!app.$('start-performance').disabled);await app.click('home-single-player');app.savedButton(key).click();await app.until(()=>!app.$('start-performance').disabled);await app.click('start-performance');await app.until(()=>app.document.body.dataset.screen==='stage');await app.click('play-button');const compilations=server.requests.filter(r=>r.path==='/api/compile').length,tempo=app.$('tempo').value;
  await app.click('edit-song-mod');await app.click('song-mod-all-machine');await apply(app);assert.equal(app.$('tempo').disabled,false);assert.equal(app.$('loop-apply').disabled,false);assert.equal(app.$('tempo').value,tempo);assert.equal(server.requests.filter(r=>r.path==='/api/compile').length,compilations);
 }finally{await app.close();}
});


test('Basic Mod sound controls reach actual audio-thread timbre buffers and restore source percussion recipe',async()=>{
 const f=await basicFixture(),{app,score}=f;
 try{await app.click('configure-song-mod');set(app,'instrument',score.parts[1].id,'reed');set(app,'instrument',score.parts[2].id,'triangle');await apply(app);await app.click('start-performance');await app.until(()=>app.$('clean-song-stage').dataset.rendererState==='playing');const plan=source(app).core.plan;assert.ok(plan.timbreProfile);assert.ok([...plan.timbres].some(value=>value>0));assert.match(app.$('clean-song-stage-status').textContent,/pitched synthesis/);assert.equal((await app.exported('export-takes')).song_mod.config.parts[1].instrument,'reed');
  await app.click('edit-song-mod');await app.click('song-mod-restore');await apply(app);await app.click('play-button');await app.until(()=>app.$('clean-song-stage').dataset.rendererState==='playing');assert.equal(source(app).core.plan.timbreProfile,undefined);assert.ok([...source(app).core.plan.roles].includes(1),'Source percussion remains the admitted pulse role');
 }finally{await app.close();}
});

test('Cancel and navigation during pending Mod checks cannot save or apply a stale draft; repeated Apply checks once',async()=>{
 const f=await basicFixture(),{app,server,score,storageValues}=f;let release,gate=false;
 server.setRoute(({path,defaultReply})=>gate&&path==='/api/practice-targets'?new Promise(resolve=>{release=()=>resolve(defaultReply());}):undefined);
 try{await app.click('configure-song-mod');set(app,'performer',score.parts[2].id,'human');gate=true;const before=app.requests.filter(r=>r.path==='/api/practice-targets').length;app.$('song-mod-apply').click();app.$('song-mod-apply').click();await app.until(()=>Boolean(release));assert.equal(app.requests.filter(r=>r.path==='/api/practice-targets').length,before+1);await app.click('song-mod-cancel');assert.equal(app.$('song-mod-dialog').open,false);release();gate=false;await app.tick();assert.equal([...storageValues.keys()].some(key=>key.startsWith(SONG_MOD_STORAGE_PREFIX)),false);
  await app.click('configure-song-mod');set(app,'performer',score.parts[2].id,'human');gate=true;release=null;app.$('song-mod-apply').click();await app.until(()=>Boolean(release));await app.click('start-free-practice');release();gate=false;await app.tick();assert.equal(app.document.body.dataset.screen,'free');assert.equal([...storageValues.keys()].some(key=>key.startsWith(SONG_MOD_STORAGE_PREFIX)),false);
 }finally{release?.();await app.close();}
});
