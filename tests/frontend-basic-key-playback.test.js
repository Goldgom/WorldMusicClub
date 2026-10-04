import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {basicKeyRenditionFixture} from './basic-key-rendition-fixtures.js';
import {nativeScoreServer,nativeStorageApp,nativeResponse} from './native-storage-app-fixtures.js';
import {getAppI18n} from '../web/app-locale.js';
import {keyboardGeometry} from '../web/music.js';

async function setup({notation=false}={}){
 const opened=basicKeyRenditionFixture(),descriptor=opened.clean_package,score=JSON.parse(descriptor.score_json).notation,server=await nativeScoreServer(),key=`song-${descriptor.content_sha256}`;
 const summary={version:2,content_sha256:descriptor.content_sha256,profile:descriptor.profile,capabilities:descriptor.capabilities,coverage:descriptor.coverage,notation_available:true,media:[]};
 const entry={key,revision:1,title:score.title,composer:score.composer,score_id:score.id,label:score.title,score_bytes:Buffer.byteLength(JSON.stringify(score)),saved_at_unix_ms:1700000000000,clean_package:summary};server.records.set(key,{...opened,entry});
 const third=notation?JSON.parse(readFileSync(new URL('./fixtures/basic-key-rendition-third-part.json',import.meta.url),'utf8')):null;
 const pages=notation?JSON.parse(readFileSync(new URL('./fixtures/basic-key-rendition-notation-page.json',import.meta.url),'utf8')):null;
 server.setRoute(({path,body})=>{if(path==='/api/library/basic-keys/notation'&&pages){assert.equal(body.source.content_sha256,descriptor.content_sha256);if(!body.settings.rendition_policy_id)return nativeResponse(pages.legacy);assert.equal(body.settings.rendition_policy_id,'wmh-basic-key-rendition-fifo-v1');return nativeResponse(body.settings.part_id===score.parts[1].id?pages.percussion.response:body.settings.part_id===score.parts[2].id?third.response:pages.melodic.response);}if(path==='/api/instrument-check'){const keys=keyboardGeometry(body.profile.key_count,body.profile.lowest_midi),low=keys[0].midi,high=keys.at(-1).midi;return nativeResponse({lowest_midi:low,highest_midi:high,note_options:body.timeline.notes.map(note=>({note_id:note.id,midi:note.midi,playable:note.midi>=low&&note.midi<=high,positions:[]})),diagnostics:[],changed_source_notes:false});}});
 let clock=1000;const app=await nativeStorageApp(server,{now:()=>clock});await app.until(()=>app.savedButton(key)&&!app.$('start-listen').disabled);await app.click('home-single-player');app.savedButton(key).click();await app.until(()=>app.$('song-lobby').dataset.previewStatus==='ready'&&!app.$('start-practice').disabled);return{app,server,key,descriptor,score,time:value=>{clock=value;}};
}
const sounds=app=>app.audioNodes.filter(node=>['oscillator','buffer-source'].includes(node.kind)&&!node.disconnected);

test('complete basic Listen, pause, reset and natural end run on the native full timeline',async()=>{
 const {app,descriptor,time}=await setup();try{
  assert.equal(app.$('start-listen').disabled,false);assert.match(app.$('clean-song-rendition').textContent,/retains all 5 note onsets.*selected human part.*default synthesized/);assert.match(app.$('basic-key-policy-text').textContent,/FIFO.*20 ms.*CC120\/123/);
  const compiles=app.requests.filter(request=>request.path==='/api/compile').length;await app.click('start-listen');await app.until(()=>app.$('clean-song-stage').dataset.rendererState==='playing');assert.equal(sounds(app).length,2);assert.equal(app.requests.filter(request=>request.path==='/api/compile').length,compiles);assert.equal(app.plays.filter(args=>String(args[0]).startsWith('score:')).length,0);assert.match(app.$('song-complete-range-text').textContent,/5 eligible targets/);
  await app.click('play-button');assert.equal(sounds(app).length,0);assert.equal(app.$('clean-song-stage').dataset.rendererState,'paused');await app.click('play-button');assert.equal(sounds(app).length,2);await app.click('reset-button');assert.equal(sounds(app).length,0);assert.equal(app.$('clean-song-stage').dataset.rendererState,'ready');await app.click('play-button');time(2151);app.frame();assert.equal(app.$('clean-song-stage').dataset.rendererState,'ended');assert.equal(sounds(app).length,0);assert.equal(app.$('progress').value,1000);assert.equal(descriptor.score_json,basicKeyRenditionFixture().clean_package.score_json);
 }finally{await app.close();}
});

test('complete basic accompaniment never enters captures, while real human input enters the selected-part take',async()=>{
 const {app,time,score}=await setup();try{
  await app.click('start-practice');await app.until(()=>app.$('clean-song-stage').dataset.rendererState==='playing');assert.deepEqual(sounds(app).map(node=>node.kind),['buffer-source']);time(1100);await app.click('play-button');let take=await app.exported('export-takes');assert.equal(take.passes[0].timeline.notes.length,3);assert.equal(take.passes[0].interpretation.policy_id,'wmh-basic-key-rendition-fifo-v1');assert.equal(take.passes[0].interpretation.runtime_profile,'wmh-basic-key-practice-v2');assert.deepEqual(take.passes[0].interpretation.source_target_ids,take.passes[0].timeline.notes.map(note=>note.id));assert.deepEqual(take.passes[0].inputs,[]);assert.deepEqual(take.passes[0].captures,[]);assert.ok(take.passes[0].timeline.notes.every(note=>note.part_id===score.parts[0].id));
  await app.click('play-button');time(1200);const key=app.document.querySelector('#keyboard [data-midi="60"]');app.emit(key,'pointerdown',{pointerId:7,button:0});await app.tick();time(1250);app.emit(key,'pointerup',{pointerId:7});await app.click('play-button');take=await app.exported('export-takes');assert.equal(take.passes[0].inputs.length,1);assert.equal(take.passes[0].inputs[0].midi,60);assert.equal(take.passes[0].captures.length,1);
 }finally{await app.close();}
});

test('mute, solo and reset are explicit output choices; source facts and human targets stay intact',async()=>{
 const {app,score}=await setup();try{
  await app.click('start-listen');await app.until(()=>app.$('clean-song-stage').dataset.rendererState==='playing');await app.click('play-button');
  const solo=app.document.querySelector(`[data-solo-part-id="${score.parts[0].id}"]`);solo.click();await app.tick();assert.equal(solo.getAttribute('aria-pressed'),'true');await app.click('play-button');assert.equal(sounds(app).length,1);await app.click('play-button');
  const mute=app.document.querySelector(`#clean-song-parts input[data-part-id="${score.parts[0].id}"]`);mute.checked=false;app.emit(mute,'change');await app.click('play-button');assert.equal(sounds(app).length,0);assert.match(app.$('clean-song-stage-status').textContent,/All parts are muted or excluded/);await app.click('play-button');await app.click('clean-song-reset-mix');await app.click('play-button');assert.equal(sounds(app).length,2);
  await app.click('play-button');getAppI18n(app.document).setLocale('zh-CN');assert.match(app.$('clean-song-stage-status').textContent,/默认正弦音与打击脉冲/);assert.doesNotMatch(app.$('clean-song-stage-status').textContent,/Only human|Basic interpretation|Audible parts/);assert.match(app.$('clean-song-reset-mix').textContent,/重置静音与独奏/);
 }finally{await app.close();}
});

test('song selection exposes percussion-selector range repair before entering the stage',async()=>{
 const {app,score}=await setup();try{
  const select=app.$('preview-part');select.value=score.parts[1].id;app.emit(select,'change');await app.until(()=>app.$('preview-gate').classList.contains('preview-blocked'));
  assert.equal(app.$('start-practice').disabled,true);assert.equal(app.$('start-listen').disabled,false);assert.match(app.$('basic-key-preview-range-text').textContent,/percussion selector practice.*1 outside/);assert.equal(app.$('basic-key-preview-piano-88').hidden,false);
  await app.click('basic-key-preview-piano-88');await app.until(()=>!app.$('start-practice').disabled);assert.equal(app.$('key-count').value,'88');assert.match(app.$('basic-key-preview-range-text').textContent,/0 outside/);await app.click('start-practice');await app.until(()=>app.$('clean-song-stage').dataset.rendererState==='playing');assert.equal(sounds(app).filter(node=>node.kind==='buffer-source').length,0);assert.equal(sounds(app).filter(node=>node.kind==='oscillator').length,1);await app.click('play-button');const take=await app.exported('export-takes');assert.equal(take.practice_part,score.parts[1].id);assert.deepEqual(take.passes[0].timeline.notes.map(note=>note.midi),[35]);assert.deepEqual(take.passes[0].inputs,[]);
 }finally{await app.close();}
});


test('ordinary Jianpu uses the complete native rendition page, highlights synthetic gates, and offers explicit source inspection',async()=>{
 const {app,time,score}=await setup({notation:true});try{
  await app.click('sound-button');await app.click('open-score');await app.until(()=>app.$('basic-rendition-events-list').children.length===1,'Native interpreted page admitted');await app.click('jianpu-button');await app.until(()=>app.$('notation').querySelector('[data-note-id="midi-t1-e8"]'),'Jianpu expected interpreted note');app.$('notation-scope').value='current';app.emit(app.$('notation-scope'),'change');await app.tick();app.$('session-mode').value='listen';app.emit(app.$('session-mode'),'change');await app.click('play-button');
  assert.equal(app.$('engraving-basic-meter').value,'4/4');assert.equal(app.$('notation').querySelectorAll('.score-note').length,2);assert.equal(app.$('basic-rendition-events-list').children.length,1);assert.equal(app.$('basic-rendition-events-list').children[0].dataset.noteId,'midi-t1-e6');assert.match(app.$('basic-rendition-events-list').textContent,/20 ms onset marker/);time(1560);app.frame();assert.equal(app.$('basic-rendition-events-list').children[0].classList.contains('active'),true);assert.equal(app.$('notation').querySelector('[data-note-id="midi-t1-e8"]').classList.contains('active'),true);
  app.$('engraving-basic-view-mode').value='source';app.emit(app.$('engraving-basic-view-mode'),'change');await app.until(()=>app.$('basic-rendition-events').hidden&&app.$('notation').querySelectorAll('.score-note').length===1);assert.match(app.$('basic-notation-note').textContent,/Source-only/);assert.ok(app.requests.some(request=>request.path==='/api/library/basic-keys/notation'&&!request.body.settings.rendition_policy_id));
  app.$('engraving-basic-view-mode').value='rendition';app.emit(app.$('engraving-basic-view-mode'),'change');await app.until(()=>app.$('notation').querySelectorAll('.score-note').length===2);app.$('notation-part').value=score.parts[1].id;app.emit(app.$('notation-part'),'change');await app.until(()=>app.$('basic-rendition-events-list').textContent.includes('Percussion selector 35'));assert.equal(app.$('notation').querySelectorAll('.jianpu-note').length,0);assert.equal(app.$('basic-rendition-events-list').children[0].dataset.role,'percussion_selector');
 }finally{await app.close();}
});


test('All uses every independently validated part page and unions simultaneous notes, sustained notes and selectors',async()=>{
 const {app,time,score}=await setup({notation:true});try{
  await app.click('sound-button');await app.click('start-listen');await app.until(()=>app.$('clean-song-stage').dataset.rendererState==='playing');assert.equal(app.$('notation-scope').value,'all');if(app.$('notation-toggle').getAttribute('aria-expanded')!=='true')await app.click('notation-toggle');await app.until(()=>app.$('basic-rendition-events-list').children.length===2,'All native pages admitted');await app.click('jianpu-button');await app.until(()=>app.$('notation').querySelector('[data-note-id="midi-t3-e1"]'));
  assert.deepEqual([...app.$('notation').querySelectorAll('section[data-notation-part-id]')].map(node=>node.dataset.notationPartId),score.parts.map(part=>part.id));assert.deepEqual(JSON.parse(app.$('workspace').dataset.renderedNotationParts),score.parts.map(part=>part.id));assert.match(app.$('notation-scope-status').textContent,/3 \/ 3 source parts shown/);
  time(1060);app.frame();assert.deepEqual(JSON.parse(app.$('written-cursor-status').dataset.sourceNoteIds).sort(),['midi-t1-e4','midi-t2-e1']);const drum=app.$('basic-rendition-events-list').querySelector('[data-note-id="midi-t2-e1"]');assert.equal(drum.classList.contains('active'),true);time(1065);app.frame();assert.equal(drum.getAttribute('aria-current'),'true');
  time(1560);app.frame();assert.deepEqual(JSON.parse(app.$('written-cursor-status').dataset.sourceNoteIds).sort(),['midi-t1-e6','midi-t1-e8','midi-t3-e1']);const synthetic=app.$('basic-rendition-events-list').querySelector('[data-note-id="midi-t1-e6"]');assert.equal(synthetic.classList.contains('active'),true);time(1571);app.frame();assert.equal(synthetic.classList.contains('active'),false);assert.deepEqual(JSON.parse(app.$('written-cursor-status').dataset.sourceNoteIds).sort(),['midi-t1-e8','midi-t3-e1']);
  const human=app.$('practice-part').value,mix=[...app.document.querySelectorAll('#clean-song-parts input')].map(input=>input.checked);app.$('notation-scope').value='part';app.emit(app.$('notation-scope'),'change');app.$('notation-scope-part').value=score.parts[2].id;app.emit(app.$('notation-scope-part'),'change');await app.until(()=>JSON.parse(app.$('workspace').dataset.renderedNotationParts||'[]').join()===score.parts[2].id);assert.equal(app.$('practice-part').value,human);assert.deepEqual([...app.document.querySelectorAll('#clean-song-parts input')].map(input=>input.checked),mix);
  app.$('session-mode').value='practice';app.emit(app.$('session-mode'),'change');assert.equal(app.$('notation-scope').value,'part');assert.equal(app.$('notation-part').value,score.parts[2].id);assert.equal(app.$('practice-part').value,human);
  app.$('notation-scope').value='current';app.emit(app.$('notation-scope'),'change');await app.until(()=>app.$('notation-part').value===human);assert.equal(app.$('notation-scope').value,'current');assert.equal(app.requests.some(request=>request.path==='/api/assess'),false);
 }finally{await app.close();}
});

test('loaded All notation stops at free practice and returns without restarting or contaminating the free take',async()=>{
 const {app,time,score}=await setup({notation:true});try{
  await app.click('sound-button');await app.click('start-listen');await app.until(()=>app.$('clean-song-stage').dataset.rendererState==='playing');await app.click('play-button');if(app.$('notation-toggle').getAttribute('aria-expanded')!=='true')await app.click('notation-toggle');await app.click('jianpu-button');await app.until(()=>JSON.parse(app.$('workspace').dataset.renderedNotationParts||'[]').length===3);const target=app.$('practice-part').value;await app.click('back-to-library');await app.click('start-free-practice');assert.equal(app.document.body.dataset.screen,'free');assert.equal(app.$('workspace').dataset.notationRenderStatus,'hidden');assert.deepEqual(JSON.parse(app.$('workspace').dataset.renderedNotationParts),[]);const notationRequests=app.requests.filter(request=>request.path==='/api/library/basic-keys/notation').length;
  if(app.$('free-sound').getAttribute('aria-pressed')==='true')await app.click('free-sound');await app.click('free-start');time(1300);app.emit(app.$('free-practice-title'),'keydown',{code:'KeyZ',key:'z'});time(1350);app.emit(app.$('free-practice-title'),'keyup',{code:'KeyZ',key:'z'});app.frame();await app.click('free-stop');const take=await app.exported('free-export-draft');assert.equal(take.score_context,null);assert.equal(take.mode,'free');assert.deepEqual(take.observations.events.filter(event=>event.kind==='note_on').map(event=>event.midi),[36]);assert.equal(app.requests.filter(request=>request.path==='/api/library/basic-keys/notation').length,notationRequests);assert.equal(sounds(app).length,0);
  await app.click('free-exit');await app.click('resume-session');await app.until(()=>JSON.parse(app.$('workspace').dataset.renderedNotationParts||'[]').length===3);assert.equal(app.$('notation-scope').value,'all');assert.equal(app.$('practice-part').value,target);assert.notEqual(app.$('clean-song-stage').dataset.rendererState,'playing');assert.equal(sounds(app).length,0);assert.deepEqual(JSON.parse(app.$('workspace').dataset.renderedNotationParts),score.parts.map(part=>part.id));
 }finally{await app.close();}
});
