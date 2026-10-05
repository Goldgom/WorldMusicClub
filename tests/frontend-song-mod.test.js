import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {nativeScoreServer,nativeStorageApp,nativeResponse} from './native-storage-app-fixtures.js';
import {basicKeyRenditionFixture} from './basic-key-rendition-fixtures.js';
import {originalMultipartNotation} from './notation-scope-fixtures.js';
import {beat,pitchMidi} from '../web/music.js';
import {getAppI18n} from '../web/app-locale.js';
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

test('compact stage Mod keeps its complete current summary available on the real button across locale and performer changes',async()=>{
 const f=await basicFixture(),{app}=f,i18n=getAppI18n(app.document);
 try{
  await app.click('configure-song-mod');await app.click('song-mod-all-machine');await apply(app);await app.click('start-performance');await app.until(()=>app.$('clean-song-stage').dataset.rendererState==='playing');
  const button=app.$('edit-song-mod'),description=app.$('song-mod-stage-summary');
  for(const locale of ['zh-CN','en']){
   i18n.setLocale(locale);assert.equal(button.getAttribute('aria-describedby'),description.id);assert.equal(description.hidden,false);assert.equal(description.getAttribute('aria-hidden'),null);
   assert.equal(button.title,description.textContent);assert.match(button.title,locale==='en'?/0 human · 3 machine.*Listen \(no scoring\)/:/0 个真人声部 · 3 个机器声部.*聆听（不评分）/);
   assert.equal(app.document.querySelectorAll('#edit-song-mod').length,1);
  }
  await app.click('edit-song-mod');await app.click('song-mod-all-human');await apply(app);
  assert.equal(app.$('edit-song-mod'),button);assert.equal(button.title,description.textContent);assert.match(button.title,/3 human · 0 machine/);assert.doesNotMatch(button.title,/Listen/);
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
 try{await app.click('configure-song-mod');set(app,'performer',score.parts[2].id,'human');gate=true;const before=app.requests.filter(r=>r.path==='/api/practice-targets').length;app.$('song-mod-apply').click();app.$('song-mod-apply').click();await app.until(()=>Boolean(release));assert.equal(app.requests.filter(r=>r.path==='/api/practice-targets').length,before+1);await app.click('song-mod-cancel');assert.equal(app.$('song-mod-dialog').open,false);assert.equal(app.$('start-performance').disabled,false);assert.equal(app.$('configure-song-mod').disabled,false);release();gate=false;await app.tick();assert.equal([...storageValues.keys()].some(key=>key.startsWith(SONG_MOD_STORAGE_PREFIX)),false);
  await app.click('configure-song-mod');set(app,'performer',score.parts[2].id,'human');gate=true;release=null;app.$('song-mod-apply').click();await app.until(()=>Boolean(release));await app.click('start-free-practice');release();gate=false;await app.tick();assert.equal(app.document.body.dataset.screen,'free');assert.equal([...storageValues.keys()].some(key=>key.startsWith(SONG_MOD_STORAGE_PREFIX)),false);
 }finally{release?.();await app.close();}
});


test('derived canonical tempo revision keeps its Mod through library reentry and leaves the prior saved revision intact',async()=>{
 const score=originalMultipartNotation({partCount:2,measures:4}),server=await nativeScoreServer({scores:[score]}),storageValues=new Map(),app=await nativeStorageApp(server,{now:()=>1000,storageValues});
 try{const key=[...server.records.keys()][0];await app.until(()=>app.savedButton(key)&&!app.$('start-performance').disabled);await app.click('home-single-player');app.savedButton(key).click();await app.until(()=>!app.$('configure-song-mod').disabled);await app.click('configure-song-mod');await app.click('song-mod-all-machine');set(app,'instrument',score.parts[0].id,'reed');await apply(app);await app.click('start-performance');await app.until(()=>app.$('canonical-audio-policy').dataset.rendererState==='playing');await app.click('play-button');const before=(await app.exported('export-takes')).song_mod;
  app.$('tempo').value='123';app.emit(app.$('tempo'),'change');await app.until(()=>!app.$('play-button').disabled&&app.$('tempo').value==='123');const changed=(await app.exported('export-takes')).song_mod;assert.notEqual(changed.sourceRevision.value,before.sourceRevision.value);assert.deepEqual(changed.config,before.config);assert.equal([...storageValues.keys()].filter(k=>k.startsWith(SONG_MOD_STORAGE_PREFIX)).length,2);
  await app.click('back-to-library');await app.click('configure-song-mod');assert.equal(control(app,'performer',score.parts[0].id).value,'machine');assert.equal(control(app,'instrument',score.parts[0].id).value,'reed');await app.click('song-mod-cancel');await app.click('start-performance');await app.until(()=>app.$('canonical-audio-policy').dataset.rendererState==='playing');assert.deepEqual((await app.exported('export-takes')).song_mod,changed);
 }finally{await app.close();}
});

test('stage Apply closes its cancellable draft before committing and checking new physical targets',async()=>{
 const score=originalMultipartNotation({partCount:2,measures:4}),server=await nativeScoreServer({scores:[score]}),app=await nativeStorageApp(server,{now:()=>1000});let release,gate=false;
 try{const key=[...server.records.keys()][0];await app.until(()=>app.savedButton(key)&&!app.$('start-performance').disabled);await app.click('home-single-player');app.savedButton(key).click();await app.until(()=>!app.$('start-performance').disabled);await app.click('start-performance');await app.until(()=>app.$('canonical-audio-policy').dataset.rendererState==='playing');await app.click('edit-song-mod');await app.click('song-mod-all-machine');
  server.setRoute(({path,defaultReply})=>gate&&path==='/api/practice-targets'?new Promise(resolve=>{release=()=>resolve(defaultReply());}):undefined);gate=true;app.$('song-mod-apply').click();await app.until(()=>Boolean(release));assert.equal(app.$('song-mod-dialog').open,false,'No Cancel is offered after the commit boundary');assert.equal(app.$('session-mode').value,'listen');release();gate=false;await app.until(()=>!app.$('play-button').disabled);assert.equal((await app.exported('export-takes')).passes.length,0);
 }finally{release?.();await app.close();}
});


test('display and playback mute edits preserve the human take, targets and paused clock',async()=>{
 const f=await basicFixture(),{app,score}=f,parts=score.parts;
 const humanState=take=>take.passes.map(pass=>({id:pass.id,timeline:pass.timeline,inputs:pass.inputs,captures:pass.captures}));
 try{await app.click('start-performance');await app.until(()=>app.$('clean-song-stage').dataset.rendererState==='playing');f.time(1120);const key=app.document.querySelector('#keyboard [data-midi="60"]');app.emit(key,'pointerdown',{pointerId:71,button:0});await app.tick();f.time(1160);app.emit(key,'pointerup',{pointerId:71});await app.click('play-button');const before=await app.exported('export-takes'),position=app.$('progress').value;assert.equal(before.passes[0].inputs.length,1);
  await app.click('edit-song-mod');app.$('song-mod-layout').value='complete';app.$('song-mod-show-others').checked=false;app.emit(app.$('song-mod-show-others'),'change');set(app,'visible',parts[2].id,false);assert.match(app.$('song-mod-warning').textContent,/keep the current position/);await apply(app);let after=await app.exported('export-takes');assert.deepEqual(humanState(after),humanState(before));assert.deepEqual(after.target_plan,before.target_plan);assert.equal(app.$('progress').value,position);
  await app.click('edit-song-mod');set(app,'mute',parts[1].id,true);await apply(app);after=await app.exported('export-takes');assert.deepEqual(humanState(after),humanState(before));assert.deepEqual(after.target_plan,before.target_plan);assert.equal(app.$('progress').value,position);await app.click('play-button');await app.until(()=>app.$('clean-song-stage').dataset.rendererState==='playing');assert.equal(source(app).core.plan.count,1);assert.equal((await app.exported('export-takes')).passes.length,before.passes.length);
 }finally{await app.close();}
});

test('locale changes cannot restore retired lobby or stage configuration controls',async()=>{
 const f=await basicFixture(),{app}=f,i18n=getAppI18n(app.document);
 try{for(const locale of ['zh-CN','en']){i18n.setLocale(locale);assert.deepEqual([...app.document.querySelectorAll('.preview-actions button')].filter(node=>!node.hidden).map(node=>node.id),['start-performance','configure-song-mod']);assert.equal(app.$('complete-practice-controls').hidden,true);}await app.click('start-performance');await app.until(()=>app.$('clean-song-stage').dataset.rendererState==='playing');i18n.setLocale('zh-CN');assert.equal(app.$('complete-practice-controls').hidden,true);assert.equal(app.$('clean-song-target').closest('label').hidden,true);assert.equal(app.$('session-mode').closest('label').hidden,true);
 }finally{await app.close();}
});

test('canonical playback mute rebuilds held audio at the paused source position without clearing its human pass',async()=>{
 const score=originalMultipartNotation({partCount:2,measures:4}),server=await nativeScoreServer({scores:[score]});let clock=1000;const app=await nativeStorageApp(server,{now:()=>clock});
 try{const key=[...server.records.keys()][0];await app.until(()=>app.savedButton(key)&&!app.$('start-performance').disabled);await app.click('home-single-player');app.savedButton(key).click();await app.until(()=>!app.$('configure-song-mod').disabled);await app.click('configure-song-mod');await app.click('song-mod-all-machine');set(app,'performer',score.parts[0].id,'human');await apply(app);app.$('count-in').checked=false;await app.click('start-performance');await app.until(()=>app.$('canonical-audio-policy').dataset.rendererState==='playing');clock=1150;app.renderAudioTo(.15);app.frame();const keyNode=app.document.querySelector('#keyboard [data-midi="60"]');app.emit(keyNode,'pointerdown',{pointerId:72,button:0});await app.tick();clock=1190;app.renderAudioTo(.19);app.emit(keyNode,'pointerup',{pointerId:72});await app.click('play-button');const before=await app.exported('export-takes'),position=app.$('progress').value;assert.equal(before.passes[0].inputs.length,1);
  await app.click('edit-song-mod');set(app,'mute',score.parts[1].id,true);await apply(app);const after=await app.exported('export-takes');assert.equal(after.passes[0].id,before.passes[0].id);assert.deepEqual(after.passes[0].inputs,before.passes[0].inputs);assert.deepEqual(after.passes[0].captures,before.passes[0].captures);assert.deepEqual(after.target_plan,before.target_plan);assert.equal(app.$('progress').value,position);await app.click('play-button');await app.until(()=>app.$('canonical-audio-policy').dataset.rendererState==='playing');assert.equal(source(app).core.plan.count,0);assert.equal(source(app).core.positionFrame,Math.round(Number(position)*source(app).core.sampleRate/1000));assert.equal((await app.exported('export-takes')).passes.length,1);
 }finally{await app.close();}
});


test('an already active legacy Listen session opens Mod with machine roles and display edits cannot create human ownership',async()=>{
 const f=await basicFixture(),{app,score}=f;
 try{await app.click('start-listen');await app.until(()=>app.$('clean-song-stage').dataset.rendererState==='playing');await app.click('edit-song-mod');assert.ok(score.parts.every(part=>control(app,'performer',part.id).value==='machine'));set(app,'visible',score.parts[1].id,false);await apply(app);assert.equal(app.$('session-mode').value,'listen');const take=await app.exported('export-takes');assert.equal(take.passes.length,0);assert.ok(take.song_mod.config.parts.every(part=>part.performer==='machine'));}
 finally{await app.close();}
});


test('one-part All-human Mod retains selected-part octave adaptation and exact original restore',async()=>{
 const transposed=JSON.parse(readFileSync(new URL('./fixtures/first-steps-transposed-v1.json',import.meta.url),'utf8')),original=JSON.parse(transposed.source.content).original;
 original.title='Original reversible octave exercise';original.source={format:'original-test-text',filename:'original.txt',content:'\uFEFFOriginal source · 原稿\r\nKeep exact bytes and credits.'};const partId=original.parts[0].id;
 const compile=score=>{const notes=score.parts.flatMap(part=>part.notes.filter(note=>note.pitch).map(note=>({id:note.id,source_note_id:note.id,source_note_ids:[note.id],velocity:note.velocity,part_id:part.id,midi:pitchMidi(note.pitch),start_ms:beat(note.at)*500,duration_ms:beat(note.duration)*500,voice:note.voice,staff:note.staff})));return {score,timeline:{notes,duration_ms:Math.max(...notes.map(note=>note.start_ms+note.duration_ms))},diagnostics:[]};};
 const server=await nativeScoreServer({scores:[original]});let prepared;
 server.setRoute(({path,body})=>{
  if(path==='/api/compile')return nativeResponse(compile(body));
  if(path==='/api/adaptation/preview'){
   assert.deepEqual(body.operation,{part_id:partId,octaves:1});assert.deepEqual(body.score,original);const score=structuredClone(body.score);score.id+=':octave:+1';score.title+=' [+1 octave]';for(const part of score.parts)if(part.id===body.operation.part_id)for(const note of part.notes)if(note.pitch)note.pitch.octave+=1;
   score.source={format:'octave-adaptation',filename:null,content:JSON.stringify({version:1,operation:body.operation,original:body.score}),import_diagnostics:[]};const compilation=compile(score);
   prepared={compilation,operation:body.operation,changed_note_count:15,original_preserved:true,scored_mode_allowed:true,instrument_report:{lowest_midi:36,highest_midi:96,note_options:compilation.timeline.notes.map(note=>({note_id:note.id,midi:note.midi,playable:true,positions:[]})),diagnostics:[],changed_source_notes:false}};return nativeResponse(prepared);
  }
  if(path==='/api/adaptation/restore')return nativeResponse(compile(JSON.parse(body.source.content).original));
 });
 const app=await nativeStorageApp(server);
 try{const key=[...server.records.keys()][0];await app.until(()=>app.savedButton(key)&&!app.$('start-performance').disabled);await app.click('home-single-player');app.savedButton(key).click();await app.until(()=>!app.$('configure-song-mod').disabled);await app.click('configure-song-mod');await app.click('song-mod-all-machine');await apply(app);if(app.$('sound-button').getAttribute('aria-pressed')!=='true')await app.click('sound-button');await app.click('start-performance');await app.until(()=>app.document.body.dataset.screen==='stage');await app.click('edit-song-mod');await app.click('song-mod-all-human');await apply(app);await app.until(()=>!app.$('play-button').disabled);
  const before=await app.exported('export-takes');assert.equal(before.practice_selection.kind,'all');assert.equal(before.practice_part,null);assert.deepEqual(before.practice_selection.part_ids,[partId]);assert.equal(before.target_plan.target_count,15);
  await app.click('adaptation-button');assert.equal(app.$('adaptation-scope').options[1].disabled,false);app.$('adaptation-scope').value='selected';app.$('adaptation-octaves').value='1';await app.click('adaptation-preview');await app.until(()=>!app.$('adaptation-result').hidden);assert.equal(prepared.operation.part_id,partId);assert.equal(prepared.changed_note_count,15);assert.equal(app.$('adaptation-activate').disabled,true);assert.deepEqual(await app.exported('export-button'),original);
  app.$('adaptation-confirm').checked=true;app.emit(app.$('adaptation-confirm'),'change');await app.click('adaptation-activate');await app.until(()=>!app.$('adaptation-dialog').open&&app.$('score-title').textContent===prepared.compilation.score.title);const copy=await app.exported('export-button');assert.deepEqual(copy,prepared.compilation.score);assert.deepEqual(JSON.parse(copy.source.content).original,original);assert.equal(JSON.parse(copy.source.content).original.source.content,original.source.content);assert.equal((await app.exported('export-takes')).practice_selection.kind,'all');assert.equal((await app.exported('export-takes')).practice_part,null);
  await app.click('adaptation-button');await app.click('adaptation-restore-preview');await app.until(()=>app.$('adaptation-status').textContent.startsWith('Original preview ready'));app.$('adaptation-confirm').checked=true;app.emit(app.$('adaptation-confirm'),'change');await app.click('adaptation-activate');await app.until(()=>!app.$('adaptation-dialog').open&&app.$('score-title').textContent===original.title);assert.deepEqual(await app.exported('export-button'),original);const restored=await app.exported('export-takes');assert.equal(restored.practice_selection.kind,'all');assert.equal(restored.practice_part,null);assert.deepEqual(restored.practice_selection.part_ids,[partId]);
 }finally{await app.close();}
});

test('multipart All-human Mod does not invent a selected part for octave adaptation',async()=>{
 const score=originalMultipartNotation({partCount:2,measures:4}),server=await nativeScoreServer({scores:[score]}),app=await nativeStorageApp(server);
 try{const key=[...server.records.keys()][0];await app.until(()=>app.savedButton(key)&&!app.$('start-performance').disabled);await app.click('home-single-player');app.savedButton(key).click();await app.until(()=>!app.$('configure-song-mod').disabled);await app.click('configure-song-mod');await app.click('song-mod-all-human');await apply(app);if(app.$('sound-button').getAttribute('aria-pressed')!=='true')await app.click('sound-button');await app.click('start-performance');await app.until(()=>app.document.body.dataset.screen==='stage');await app.click('adaptation-button');assert.equal(app.$('adaptation-scope').options[1].disabled,true);assert.equal(app.$('adaptation-scope').value,'all');assert.equal(server.requests.filter(request=>request.path==='/api/adaptation/preview').length,0);const take=await app.exported('export-takes');assert.equal(take.practice_selection.kind,'all');assert.equal(take.practice_part,null);assert.equal(take.practice_selection.part_ids.length,2);
 }finally{await app.close();}
});
