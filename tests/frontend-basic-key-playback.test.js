import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {basicKeyRenditionFixture} from './basic-key-rendition-fixtures.js';
import {nativeScoreServer,nativeStorageApp,nativeResponse,authoredScore} from './native-storage-app-fixtures.js';
import {getAppI18n} from '../web/app-locale.js';
import {keyboardGeometry} from '../web/music.js';

async function setup({notation=false,originalAcceptance=false,audioWorklet=true,audioMessages=true,advanceAudio=true}={}){
 const oracle=originalAcceptance?JSON.parse(readFileSync(new URL('./fixtures/basic-key-acceptance/rendition-native.json',import.meta.url),'utf8')):null;
 const opened=oracle?.open||basicKeyRenditionFixture(),descriptor=opened.clean_package,score=JSON.parse(descriptor.score_json).notation,server=await nativeScoreServer(),key=`song-${descriptor.content_sha256}`;
 const summary={version:2,content_sha256:descriptor.content_sha256,profile:descriptor.profile,capabilities:descriptor.capabilities,coverage:descriptor.coverage,notation_available:true,media:[]};
 const entry={key,revision:1,title:score.title,composer:score.composer,score_id:score.id,label:score.title,score_bytes:Buffer.byteLength(JSON.stringify(score)),saved_at_unix_ms:1700000000000,clean_package:summary};server.records.set(key,{...opened,entry});
 const third=notation?JSON.parse(readFileSync(new URL('./fixtures/basic-key-rendition-third-part.json',import.meta.url),'utf8')):null;
 const pages=notation?JSON.parse(readFileSync(new URL('./fixtures/basic-key-rendition-notation-page.json',import.meta.url),'utf8')):null;
 server.setRoute(({path,body})=>{if(path==='/api/library/basic-keys/notation'&&oracle){const row=oracle.pages.find(row=>['part_id','first_measure','measure_count','position_ms','rendition_policy_id'].every(key=>row.request.settings[key]===body.settings[key])&&JSON.stringify(row.request.settings.display_meter)===JSON.stringify(body.settings.display_meter));assert.ok(row,`Missing original native page: ${JSON.stringify(body)}`);assert.deepEqual(body,row.request);return nativeResponse(row.response);}if(path==='/api/library/basic-keys/notation'&&pages){assert.equal(body.source.content_sha256,descriptor.content_sha256);if(!body.settings.rendition_policy_id)return nativeResponse(pages.legacy);assert.equal(body.settings.rendition_policy_id,'wmh-basic-key-rendition-fifo-v1');return nativeResponse(body.settings.part_id===score.parts[1].id?pages.percussion.response:body.settings.part_id===score.parts[2].id?third.response:pages.melodic.response);}if(path==='/api/instrument-check'){const keys=keyboardGeometry(body.profile.key_count,body.profile.lowest_midi),low=keys[0].midi,high=keys.at(-1).midi;return nativeResponse({lowest_midi:low,highest_midi:high,note_options:body.timeline.notes.map(note=>({note_id:note.id,midi:note.midi,playable:note.midi>=low&&note.midi<=high,positions:[]})),diagnostics:[],changed_source_notes:false});}});
 let clock=1000;const app=await nativeStorageApp(server,{now:()=>clock,audioWorklet,audioMessages});await app.until(()=>app.savedButton(key)&&!app.$('start-listen').disabled);await app.click('home-single-player');app.savedButton(key).click();await app.until(()=>app.$('song-lobby').dataset.previewStatus==='ready'&&!app.$('start-practice').disabled);return{app,server,key,descriptor,score,time:value=>{clock=value;if(advanceAudio)app.renderAudioTo((value-1000)/1000);}};
}
// These are retained plan gates, not OscillatorNode counts or actual rendered voices.
const admittedGates=app=>app.audioNodes.filter(node=>node.kind==='audio-worklet'&&node.connected).flatMap(node=>[...node.core.plan.ends].flatMap((end,index)=>end>node.core.positionFrame?[{kind:node.core.plan.roles[index]?'percussion_selector':'melodic_key'}]:[]));
const connectedReceivers=app=>app.audioNodes.filter(node=>node.kind==='audio-worklet'&&node.connected);

test('complete basic Listen, pause, reset and natural end run on the native full timeline',async()=>{
 const {app,descriptor,time}=await setup();try{
  assert.equal(app.$('start-listen').disabled,false);assert.match(app.$('clean-song-rendition').textContent,/retains all 5 note onsets.*selected human part.*default synthesized/);assert.match(app.$('basic-key-policy-text').textContent,/FIFO.*20 ms.*CC120\/123/);
  const compiles=app.requests.filter(request=>request.path==='/api/compile').length;await app.click('start-listen');await app.until(()=>app.$('clean-song-stage').dataset.rendererState==='playing');assert.equal(admittedGates(app).length,5);assert.equal(app.requests.filter(request=>request.path==='/api/compile').length,compiles);assert.equal(app.plays.filter(args=>String(args[0]).startsWith('score:')).length,0);assert.match(app.$('song-complete-range-text').textContent,/5 eligible targets/);
  await app.click('play-button');assert.equal(admittedGates(app).length,0);assert.equal(app.$('clean-song-stage').dataset.rendererState,'paused');await app.click('play-button');assert.equal(admittedGates(app).length,5);await app.click('reset-button');assert.equal(admittedGates(app).length,0);assert.equal(app.$('clean-song-stage').dataset.rendererState,'ready');await app.click('play-button');time(2151);assert.equal(connectedReceivers(app)[0].core.startedCount,5);assert.equal(connectedReceivers(app)[0].core.endedCount,5);await app.tick();app.frame();assert.equal(app.$('clean-song-stage').dataset.rendererState,'ended');assert.equal(admittedGates(app).length,0);assert.equal(app.$('progress').value,1000);assert.equal(descriptor.score_json,basicKeyRenditionFixture().clean_package.score_json);
 }finally{await app.close();}
});

test('complete basic accompaniment never enters captures, while real human input enters the selected-part take',async()=>{
 const {app,time,score}=await setup();try{
  await app.click('start-practice');await app.until(()=>app.$('clean-song-stage').dataset.rendererState==='playing');assert.deepEqual(admittedGates(app).map(node=>node.kind),['percussion_selector','melodic_key']);const firstCore=connectedReceivers(app)[0].core,expectedWall=1000+(firstCore.anchorFrame/app.audioHarnesses[0].context.sampleRate-app.audioHarnesses[0].context.currentTime)*1000,expectedPosition=firstCore.positionFrame*1000/app.audioHarnesses[0].context.sampleRate;time(1100);await app.click('play-button');let take=await app.exported('export-takes');assert.equal(take.passes[0].timeline.notes.length,3);assert.equal(take.passes[0].clock_segments[0].wallStart,expectedWall);assert.equal(take.passes[0].clock_segments[0].positionStart,expectedPosition);assert.equal(take.passes[0].interpretation.policy_id,'wmh-basic-key-rendition-fifo-v1');assert.equal(take.passes[0].interpretation.runtime_profile,'wmh-basic-key-practice-v2');assert.deepEqual(take.passes[0].interpretation.source_target_ids,take.passes[0].timeline.notes.map(note=>note.id));assert.deepEqual(take.passes[0].inputs,[]);assert.deepEqual(take.passes[0].captures,[]);assert.ok(take.passes[0].timeline.notes.every(note=>note.part_id===score.parts[0].id));
  await app.click('play-button');time(1200);const key=app.document.querySelector('#keyboard [data-midi="60"]');app.emit(key,'pointerdown',{pointerId:7,button:0});await app.tick();time(1250);app.emit(key,'pointerup',{pointerId:7});await app.click('play-button');take=await app.exported('export-takes');assert.equal(take.passes[0].inputs.length,1);assert.equal(take.passes[0].inputs[0].midi,60);assert.equal(take.passes[0].captures.length,1);
 }finally{await app.close();}
});

test('mute, solo and reset are explicit output choices; source facts and human targets stay intact',async()=>{
 const {app,score}=await setup();try{
  await app.click('start-listen');await app.until(()=>app.$('clean-song-stage').dataset.rendererState==='playing');await app.click('play-button');
  const solo=app.document.querySelector(`[data-solo-part-id="${score.parts[0].id}"]`);solo.click();await app.tick();assert.equal(solo.getAttribute('aria-pressed'),'true');await app.click('play-button');assert.equal(admittedGates(app).length,3);await app.click('play-button');
  const mute=app.document.querySelector(`#clean-song-parts input[data-part-id="${score.parts[0].id}"]`);mute.checked=false;app.emit(mute,'change');await app.click('play-button');assert.equal(admittedGates(app).length,0);assert.match(app.$('clean-song-stage-status').textContent,/All parts are muted or excluded/);await app.click('play-button');await app.click('clean-song-reset-mix');await app.click('play-button');assert.equal(admittedGates(app).length,5);
  await app.click('play-button');getAppI18n(app.document).setLocale('zh-CN');assert.match(app.$('clean-song-stage-status').textContent,/默认正弦音与打击脉冲/);assert.doesNotMatch(app.$('clean-song-stage-status').textContent,/Only human|Basic interpretation|Audible parts/);assert.match(app.$('clean-song-reset-mix').textContent,/重置静音与独奏/);
 }finally{await app.close();}
});

test('song selection exposes percussion-selector range repair before entering the stage',async()=>{
 const {app,score}=await setup();try{
  const select=app.$('preview-part');select.value=score.parts[1].id;app.emit(select,'change');await app.until(()=>app.$('preview-gate').classList.contains('preview-blocked'));
  assert.equal(app.$('start-practice').disabled,true);assert.equal(app.$('start-listen').disabled,false);assert.match(app.$('basic-key-preview-range-text').textContent,/percussion selector practice.*1 outside/);assert.equal(app.$('basic-key-preview-piano-88').hidden,false);
  await app.click('basic-key-preview-piano-88');await app.until(()=>!app.$('start-practice').disabled);assert.equal(app.$('key-count').value,'88');assert.match(app.$('basic-key-preview-range-text').textContent,/0 outside/);await app.click('start-practice');await app.until(()=>app.$('clean-song-stage').dataset.rendererState==='playing');assert.equal(admittedGates(app).filter(node=>node.kind==='percussion_selector').length,0);assert.equal(admittedGates(app).filter(node=>node.kind==='melodic_key').length,4);await app.click('play-button');const take=await app.exported('export-takes');assert.equal(take.practice_part,score.parts[1].id);assert.deepEqual(take.passes[0].timeline.notes.map(note=>note.midi),[35]);assert.deepEqual(take.passes[0].inputs,[]);
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
  if(app.$('free-sound').getAttribute('aria-pressed')==='true')await app.click('free-sound');await app.click('free-start');time(1300);app.emit(app.$('free-practice-title'),'keydown',{code:'KeyZ',key:'z'});time(1350);app.emit(app.$('free-practice-title'),'keyup',{code:'KeyZ',key:'z'});app.frame();await app.click('free-stop');const take=await app.exported('free-export-draft');assert.equal(take.score_context,null);assert.equal(take.mode,'free');assert.deepEqual(take.observations.events.filter(event=>event.kind==='note_on').map(event=>event.midi),[36]);assert.equal(app.requests.filter(request=>request.path==='/api/library/basic-keys/notation').length,notationRequests);assert.equal(admittedGates(app).length,0);
  await app.click('free-exit');await app.click('resume-session');await app.until(()=>JSON.parse(app.$('workspace').dataset.renderedNotationParts||'[]').length===3);assert.equal(app.$('notation-scope').value,'all');assert.equal(app.$('practice-part').value,target);assert.notEqual(app.$('clean-song-stage').dataset.rendererState,'playing');assert.equal(admittedGates(app).length,0);assert.deepEqual(JSON.parse(app.$('workspace').dataset.renderedNotationParts),score.parts.map(part=>part.id));
 }finally{await app.close();}
});

for(const reload of [true,false])test(`restarting basic-key practice after Jianpu inspection paints the newly selected human part without Follow (${reload?'reloaded':'retained'} source)`,async()=>{
 const {app,time,score,key,descriptor}=await setup({originalAcceptance:true}),sourceBefore=descriptor.score_json;try{
  await app.click('sound-button');await app.click('open-score');await app.until(()=>app.$('basic-rendition-events-list').children.length===2,'Native inspection page admitted');
  app.$('engraving-page-size').value='2';app.emit(app.$('engraving-page-size'),'change');await app.until(()=>app.requests.some(request=>request.path==='/api/library/basic-keys/notation'&&request.body.settings.measure_count===2));await app.click('jianpu-button');
  app.$('notation-scope').value='all';app.emit(app.$('notation-scope'),'change');await app.until(()=>JSON.parse(app.$('workspace').dataset.renderedNotationParts||'[]').length===3);
  app.$('notation-scope').value='current';app.emit(app.$('notation-scope'),'change');await app.until(()=>JSON.parse(app.$('workspace').dataset.renderedNotationParts||'[]').join()===score.parts[0].id);assert.equal(app.$('engraving-follow').checked,false);
  await app.click('back-to-library');if(reload)app.savedButton(key).click();await app.until(()=>!app.$('start-practice').disabled&&app.$('preview-part').value===score.parts[0].id);app.$('preview-part').value=score.parts[2].id;app.emit(app.$('preview-part'),'change');await app.until(()=>!app.$('start-practice').disabled&&app.$('preview-part').value===score.parts[2].id);
  const before=app.requests.length;await app.click('start-practice');await app.until(()=>app.$('clean-song-stage').dataset.rendererState==='playing');time(1311.3);await app.click('play-button');app.frame();
  await app.until(()=>app.$('workspace').dataset.notationRenderStatus==='ready'&&JSON.parse(app.$('workspace').dataset.renderedNotationParts||'[]').join()===score.parts[2].id,'Current human part painted after returning from inspection');
  assert.equal(app.$('notation-scope').value,'current');assert.equal(app.$('practice-part').value,score.parts[2].id);assert.equal(app.$('engraving-follow').checked,false);assert.equal(app.$('jianpu-button').getAttribute('aria-pressed'),'true');assert.ok(app.$('notation').querySelector('[data-note-id="midi-t3-e1"]'));assert.equal(app.$('notation').querySelector('[data-note-id="midi-t1-e4"]'),null);
  assert.ok(app.requests.slice(before).some(request=>request.path==='/api/library/basic-keys/notation'&&request.body.settings.part_id===score.parts[2].id));const take=await app.exported('export-takes');assert.equal(take.practice_part,score.parts[2].id);assert.deepEqual(take.passes[0].inputs,[]);assert.deepEqual(take.passes[0].captures,[]);assert.deepEqual(take.passes[0].timeline.notes.map(note=>[note.id,note.start_ms,note.duration_ms]),[['midi-t3-e1',500,500]]);assert.equal(descriptor.score_json,sourceBefore);
 }finally{await app.close();}
});


test('missing AudioWorklet shows a localized blocker and disables audible playback',async()=>{
 const {app}=await setup({audioWorklet:false});try{
  await app.click('start-listen');await app.until(()=>app.document.body.dataset.screen==='stage');
  assert.equal(app.$('play-button').disabled,true);assert.match(app.$('notice-message').textContent,/requires AudioWorklet/);assert.equal(connectedReceivers(app).length,0);
  getAppI18n(app.document).setLocale('zh-CN');assert.match(app.$('play-button').title,/AudioWorklet/);
  await app.click('sound-button');assert.equal(app.$('play-button').disabled,false);await app.click('play-button');assert.equal(app.$('clean-song-stage').dataset.rendererState,'playing');assert.equal(connectedReceivers(app).length,0);
 }finally{await app.close();}
});


for(const interruption of ['pause','reset','mute','blur','hidden','settings','navigation','part','source'])test(`pending audio preparation cannot restart after ${interruption}`,async()=>{
 const {app}=await setup();let release;
 try{
  app.setAudioModule(()=>new Promise(resolve=>{release=resolve;}));await app.click('start-practice');await app.until(()=>Boolean(release)&&app.document.body.dataset.screen==='stage');
  assert.equal(connectedReceivers(app).length,0);assert.notEqual(app.$('clean-song-stage').dataset.rendererState,'playing');
  if(interruption==='pause')await app.click('play-button');
  else if(interruption==='reset')await app.click('reset-button');
  else if(interruption==='mute')await app.click('sound-button');
  else if(interruption==='blur')app.emit(app.window,'blur');
  else if(interruption==='hidden'){Object.defineProperty(app.document,'hidden',{configurable:true,value:true});app.emit(app.document,'visibilitychange');}
  else if(interruption==='settings'){await app.click('settings-button');}
  else if(interruption==='part'){app.$('practice-part').value=app.$('practice-part').children[1].value;app.emit(app.$('practice-part'),'change');}
  else if(interruption==='source'){app.importFile(authoredScore({id:'new-audio-source',title:'New source'}));await app.until(()=>app.$('score-title').textContent==='New source');}
  else await app.click('back-to-library');
  release();await app.tick();await app.tick();assert.equal(connectedReceivers(app).length,0);assert.notEqual(app.$('clean-song-stage').dataset.rendererState,'playing');assert.equal(app.$('export-takes').disabled,true,'A canceled preparation must not begin a scored pass');
 }finally{release?.();await app.close();}
});


test('a late start acknowledgement cancels audio without backdating transport or a scored pass',async()=>{
 const {app}=await setup({audioMessages:false});try{
  await app.click('start-practice');await app.until(()=>app.audioHarnesses.some(h=>h.toCore.length));
  const audio=app.audioHarnesses[0];audio.deliverCore();audio.finishPreparation();audio.deliverMain();await app.tick();
  assert.equal(audio.toCore[0][1].type,'start');audio.deliverCore();assert.equal(audio.toMain[0][1].type,'started');
  app.renderAudioTo(.06);audio.deliverMain();await app.tick();audio.deliverCore();
  assert.equal(connectedReceivers(app).length,0);assert.notEqual(app.$('clean-song-stage').dataset.rendererState,'playing');assert.equal(app.$('export-takes').disabled,true);assert.match(app.$('notice-message').textContent,/clean_late_start/);
 }finally{await app.close();}
});


for(const state of ['suspended','closed'])test(`an audio context becoming ${state} stops playback and never resumes on a state notification`,async()=>{
 const {app}=await setup();try{
  await app.click('start-practice');await app.until(()=>app.$('clean-song-stage').dataset.rendererState==='playing');app.setAudioState(state);await app.tick();
  assert.equal(connectedReceivers(app).length,0);assert.equal(app.$('clean-song-stage').dataset.rendererState,'paused');assert.match(app.$('notice-message').textContent,/clean_clock_unavailable/);
  app.setAudioState('running');await app.tick();assert.equal(connectedReceivers(app).length,0);assert.equal(app.$('clean-song-stage').dataset.rendererState,'paused');
 }finally{await app.close();}
});


test('context interruption during module loading fences preparation even if the device returns to running',async()=>{
 const {app}=await setup();let release;
 try{app.setAudioModule(()=>new Promise(resolve=>{release=resolve;}));await app.click('start-practice');await app.until(()=>Boolean(release));app.setAudioState('suspended');app.setAudioState('running');release();await app.tick();await app.tick();assert.equal(connectedReceivers(app).length,0);assert.notEqual(app.$('clean-song-stage').dataset.rendererState,'playing');assert.equal(app.$('export-takes').disabled,true);}finally{release?.();await app.close();}
});

test('pausing after the final gate but inside the Listen grace exposes replay instead of preparing beyond the source',async()=>{
 const {app,time}=await setup();try{
  await app.click('start-listen');await app.until(()=>app.$('clean-song-stage').dataset.rendererState==='playing');time(2070);await app.tick();app.frame();assert.equal(app.$('clean-song-stage').dataset.rendererState,'playing');await app.click('play-button');assert.equal(app.$('clean-song-stage').dataset.rendererState,'ended');await app.click('play-button');await app.until(()=>app.$('clean-song-stage').dataset.rendererState==='playing');assert.equal(connectedReceivers(app)[0].core.positionFrame,0);assert.doesNotMatch(app.$('notice-message').textContent,/invalid_audio_plan/);
 }finally{await app.close();}
});

test('natural completion waits for exact audio gate ends when the wall clock leads the audio clock',async()=>{
 const {app,time}=await setup({advanceAudio:false});try{
  await app.click('start-listen');await app.until(()=>app.$('clean-song-stage').dataset.rendererState==='playing');const audio=app.audioHarnesses[0],node=connectedReceivers(app)[0],core=node.core;
  app.renderAudioTo(1.03);time(2131);app.frame();assert.equal(app.$('clean-song-stage').dataset.rendererState,'playing');assert.equal(node.connected,true);assert.equal(core.activeCount,2);
  app.renderAudioTo(1.06);await app.tick();app.frame();assert.equal(app.$('clean-song-stage').dataset.rendererState,'ended');assert.equal(node.connected,false);for(const [index,end] of core.plan.ends.entries())assert.equal(node.lastCompletion.ledger.actualEnds[index],core.anchorFrame+end);
 }finally{await app.close();}
});

for(const interruption of ['pause','blur','mute'])test(`Practice ${interruption} inside final input grace preserves the prior take until assessment and explicit replay`,async()=>{
 const {app,time}=await setup();try{
  await app.click('start-practice');await app.until(()=>app.$('clean-song-stage').dataset.rendererState==='playing');time(2070);await app.tick();app.frame();
  const before=await app.exported('export-takes');assert.equal(before.passes.length,1);assert.equal(before.passes[0].clock_segments[0].wallEnd,2050);assert.equal(before.passes[0].grace_deadline_wall_ms,2230);
  if(interruption==='pause')await app.click('play-button');else if(interruption==='blur')app.emit(app.window,'blur');else await app.click('sound-button');
  assert.equal(app.$('play-button').disabled,true);assert.equal(connectedReceivers(app).length,0);time(2130);const key=app.document.querySelector('#keyboard [data-midi="60"]');app.emit(key,'pointerdown',{pointerId:701,button:0});await app.tick();app.emit(key,'pointerup',{pointerId:701});
  const grace=await app.exported('export-takes');assert.equal(grace.passes.length,1);assert.equal(grace.passes[0].clock_segments[0].wallEnd,2050);assert.equal(grace.passes[0].grace_deadline_wall_ms,2230);assert.equal(grace.passes[0].inputs.length,1);assert.equal(grace.passes[0].captures.length,1);assert.equal(grace.passes[0].inputs[0].at_ms,1080);
  time(2240);app.frame();await app.until(()=>!app.$('play-button').disabled);assert.equal((await app.exported('export-takes')).passes.length,1,'Assessment completion must not create another take');await app.click('play-button');await app.until(()=>app.$('clean-song-stage').dataset.rendererState==='playing');await app.click('play-button');const replay=await app.exported('export-takes');assert.equal(replay.passes.length,2);assert.equal(replay.passes[0].inputs.length,1);assert.deepEqual(replay.passes[1].inputs,[]);assert.equal(replay.passes[1].clock_segments[0].positionStart,0);
 }finally{await app.close();}
});


test('a real startup rejection remains visible in both locales without misreporting browser support',async()=>{
 const {app}=await setup();try{
  app.setAudioModule(()=>Promise.reject(Object.assign(new Error('Original loader failure for startup diagnosis'),{name:'AbortError'})));await app.click('start-listen');await app.until(()=>app.$('notice-message').textContent.includes('Original loader failure'));
  for(const locale of ['en','zh-CN']){getAppI18n(app.document).setLocale(locale);const message=app.$('notice-message').textContent;assert.match(message,/AbortError.*Original loader failure/);assert.match(message,/basic-key-audio-processor\.js/);assert.doesNotMatch(message,/requires AudioWorklet|需要浏览器支持 AudioWorklet/);}
  assert.match(app.$('notice-message').textContent,/阶段：音频模块加载/);assert.doesNotMatch(app.$('notice-message').textContent,/The basic-key audio processor could not be loaded/);
  assert.equal(connectedReceivers(app).length,0);assert.equal(app.$('progress').value,0);assert.equal(app.$('clean-song-stage').dataset.rendererState,'ready');assert.equal(app.$('export-takes').disabled,true);
 }finally{await app.close();}
});
