// Real app handlers with committed original fixtures and in-memory DOM/audio.
// This suite does not launch a browser/server or claim native pointer acceptance.
import test from 'node:test';
import assert from 'node:assert/strict';
import {vsqAcceptanceFixture} from '../scripts/prepare-vsq-song-fixtures.mjs';
import {nativeScoreServer,nativeStorageApp,nativeResponse,deferred,authoredScore} from './native-storage-app-fixtures.js';
import {getAppI18n} from '../web/app-locale.js';
import {cleanDescriptor,mediaFixture} from './clean-song-fixtures.js';
import {readPlaybackClock} from '../web/playback-clock-view.js';
import {installRangeSerializationFixture,OBSERVED_RANGE_ENDPOINT} from './range-input-fixtures.js';

async function setup(options={}){
 const {rangeSerialization=false,...appOptions}=options;
 const fixture=vsqAcceptanceFixture(),server=await nativeScoreServer(),score=fixture.score.notation;
 server.records.set(fixture.key,{...fixture.opened,entry:{key:fixture.key,revision:1,title:score.title,composer:score.composer,score_id:score.id,label:score.title,score_bytes:Buffer.byteLength(fixture.opened.score_json),saved_at_unix_ms:1700000000000,clean_package:fixture.summary}});
 server.setRoute(({path})=>path==='/api/library/runtime'?nativeResponse(fixture.runtime):undefined);
 let clock=1000;
 const app=await nativeStorageApp(server,{now:()=>clock,...appOptions});
 if(rangeSerialization){const restore=installRangeSerializationFixture(app.window),close=app.close;app.close=async()=>{try{await close();}finally{restore();}};}
 await app.until(()=>app.savedButton(fixture.key)&&!app.$('start-listen').disabled);
 await app.click('home-single-player');app.savedButton(fixture.key).click();
 await app.until(()=>app.$('song-lobby').dataset.previewStatus==='choice'&&!app.$('vsq-listen-basic').disabled);
 return{app,fixture,time(value){clock=value;app.renderAudioTo((value-1000)/1000);}};
}

test('Listen has a real fractional range control and seeks into the source-declared silent tail',async()=>{
 const {app,fixture,time}=await setup();
 try{
  await app.click('vsq-listen-basic');await app.until(()=>app.$('clean-song-stage').dataset.rendererState==='playing');
  const progress=app.$('progress'),duration=fixture.runtime.compilation.timeline.duration_ms;
  assert.equal(progress.localName,'input','A display-only progress element cannot receive native pointer or keyboard seek');
  assert.equal(progress.type,'range');assert.equal(progress.getAttribute('step'),'any');
  assert.equal(typeof progress.value,'string','A native range retains the HTMLInputElement string value contract');
  assert.equal(Number(progress.max),duration);assert.equal(progress.disabled,false);
  time(1300);app.frame();progress.value=2041;app.emit(progress,'input');
  assert.equal(progress.value,'2041');assert.equal(readPlaybackClock(progress).positionMs,2041);assert.match(app.$('play-button').textContent,/Play/);
  assert.equal(app.audioNodes.filter(node=>node.kind==='audio-worklet'&&node.connected).length,0);
  time(1800);app.frame();assert.equal(readPlaybackClock(progress).positionMs,2041,'Seeking stays paused');
  await app.click('play-button');await app.until(()=>app.$('clean-song-stage').dataset.rendererState==='playing');
  const receiver=app.audioNodes.findLast(node=>node.kind==='audio-worklet'&&node.connected);
  assert.equal(receiver.core.positionFrame,2041*8,'Explicit Play resumes the source tail without a count-in or prefix restart');
  time(4000);await app.tick();app.frame();
  assert.equal(receiver.core.startedCount,0,'The silent source tail contains no new note gates');
  assert.equal(app.$('clean-song-stage').dataset.rendererState,'ended');
  assert.equal(readPlaybackClock(progress).positionMs,duration,'The exact published source endpoint is independent of the native range representation');
  assert.equal(app.requests.some(row=>row.path==='/api/assess'),false);
 }finally{await app.close();}
});

test('rounded native range readback cannot change the exact source clock or fake completion',async()=>{
 const {app,fixture,time}=await setup({rangeSerialization:true});
 try{
  app.$('count-in').checked=false;
  await app.click('vsq-listen-basic');await app.until(()=>app.$('clean-song-stage').dataset.rendererState==='playing');
  const progress=app.$('progress'),duration=fixture.runtime.compilation.timeline.duration_ms;
  assert.equal(duration,OBSERVED_RANGE_ENDPOINT.source);
  progress.value='2041';app.emit(progress,'input');
  assert.equal(readPlaybackClock(app.document).positionMs,2041);assert.equal(readPlaybackClock(progress).phase,'paused');
  await app.click('play-button');time(3300);await app.tick();app.frame();
  const completed=readPlaybackClock(progress);
  assert.equal(progress.value,OBSERVED_RANGE_ENDPOINT.raw);assert.notEqual(Number(progress.value),duration);
  assert.equal(completed.positionMs,duration);assert.equal(completed.transportPositionMs,duration);
  assert.equal(completed.completed,true);assert.equal(completed.phase,'ended');assert.equal(completed.running,false);
  await app.click('reset-button');progress.value=String(duration);app.emit(progress,'input');
  assert.equal(progress.value,OBSERVED_RANGE_ENDPOINT.raw);assert.equal(readPlaybackClock(progress).positionMs,duration);
  assert.equal(readPlaybackClock(progress).completed,true);assert.match(app.$('play-button').textContent,/Play again/);
  await app.click('play-button');await app.until(()=>app.$('clean-song-stage').dataset.rendererState==='playing');
  assert.equal(app.audioNodes.findLast(node=>node.kind==='audio-worklet'&&node.connected).core.positionFrame,0);
 }finally{await app.close();}
});

test('signed display clock and written-note lookup share count-in, exact zero, grace and finished frames',async()=>{
 const {app,fixture,time}=await setup({rangeSerialization:true});
 try{
  await app.click('vsq-listen-basic');await app.until(()=>app.$('clean-song-stage').dataset.rendererState==='playing');
  if(app.$('notation-toggle').getAttribute('aria-expanded')!=='true')await app.click('notation-toggle');
  await app.click('jianpu-button');await app.until(()=>app.$('written-cursor-status').dataset.status==='ready');
  const receiver=app.audioNodes.findLast(node=>node.kind==='audio-worklet'&&node.connected),audio=app.audioHarnesses[0];
  const zeroWall=1000+(receiver.core.anchorFrame/audio.context.sampleRate-audio.context.currentTime)*1000-receiver.core.positionFrame*1000/audio.context.sampleRate;
  const noteIds=()=>JSON.parse(app.$('written-cursor-status').dataset.sourceNoteIds);
  for(const offset of [-.125,0,.125]){
   time(zeroWall+offset);app.frame();const clock=readPlaybackClock(app.document);
   assert.equal(clock.transportPositionMs,offset);assert.equal(clock.positionMs,Math.max(0,offset));
   assert.equal(clock.running,true);assert.equal(clock.completed,false);
   assert.deepEqual(noteIds(),offset<0?[]:['vsq-t1-ID#0001','vsq-t2-ID#0001']);
  }
  const duration=fixture.runtime.compilation.timeline.duration_ms;
  time(zeroWall+duration+1);await app.tick();app.frame();
  assert.equal(readPlaybackClock(app.document).positionMs,duration);
  assert.equal(readPlaybackClock(app.document).phase,'playing','The displayed endpoint does not fabricate completion during Listen grace');
  assert.deepEqual(noteIds(),[]);
  time(zeroWall+duration+100);await app.tick();app.frame();const finished=readPlaybackClock(app.document);
  assert.equal(finished.transportPositionMs,duration);assert.equal(finished.positionMs,duration);
  assert.equal(finished.completed,true);assert.equal(finished.phase,'ended');assert.deepEqual(noteIds(),[]);
 }finally{await app.close();}
});

test('keyboard seeks clamp to the exact endpoints, retain source bytes, and redraw both locales',async()=>{
 const {app,fixture}=await setup(),original=JSON.stringify(fixture.opened);
 try{
  await app.click('vsq-listen-basic');await app.until(()=>app.$('clean-song-stage').dataset.rendererState==='playing');
  const progress=app.$('progress'),duration=fixture.runtime.compilation.timeline.duration_ms;
  assert.equal(progress.getAttribute('aria-describedby'),'progress-help');
  assert.match(progress.getAttribute('aria-label'),/Playback progress/);
  app.emit(progress,'keydown',{key:'End'});assert.equal(readPlaybackClock(progress).positionMs,duration);
  app.emit(progress,'keydown',{key:'ArrowRight'});assert.equal(readPlaybackClock(progress).positionMs,duration);
  app.emit(progress,'keydown',{key:'ArrowLeft'});assert.equal(readPlaybackClock(progress).positionMs,duration-1000);
  app.emit(progress,'keydown',{key:'Home'});assert.equal(readPlaybackClock(progress).positionMs,0);
  app.emit(progress,'keydown',{key:'ArrowLeft'});assert.equal(readPlaybackClock(progress).positionMs,0);
  app.emit(progress,'keydown',{key:'ArrowUp'});assert.equal(readPlaybackClock(progress).positionMs,1000);
  app.emit(progress,'keydown',{key:'PageUp'});assert.equal(readPlaybackClock(progress).positionMs,duration);
  app.emit(progress,'keydown',{key:'PageDown'});assert.equal(readPlaybackClock(progress).positionMs,0);
  progress.value=2041;app.emit(progress,'input');
  const requests=app.requests.length,i18n=getAppI18n(app.document);
  for(const locale of ['zh-CN','en']){
   i18n.setLocale(locale);assert.equal(readPlaybackClock(progress).positionMs,2041);assert.equal(Number(progress.max),duration);
   assert.match(app.$('progress-help').textContent,locale==='en'?/Playback stays paused/:/保持暂停/);
   assert.match(app.$('transport-status').textContent,locale==='en'?/press Play/:/按播放/);
  }
  assert.equal(app.requests.length,requests);assert.equal(JSON.stringify(fixture.opened),original);
 }finally{await app.close();}
});

test('seeking to the exact source endpoint completes without sound and explicit Play replays from the beginning',async()=>{
 const {app,fixture,time}=await setup();
 try{
  app.$('count-in').checked=false;
  await app.click('vsq-listen-basic');await app.until(()=>app.$('clean-song-stage').dataset.rendererState==='playing');
  const progress=app.$('progress'),duration=fixture.runtime.compilation.timeline.duration_ms;
  app.emit(progress,'keydown',{key:'End'});
  assert.equal(readPlaybackClock(progress).positionMs,duration);assert.match(app.$('play-button').textContent,/Play again/);
  assert.equal(app.$('clean-song-stage').dataset.rendererState,'ended');
  const starts=app.audioNodes.filter(node=>node.kind==='audio-worklet').length;
  time(1600);app.frame();await app.tick();
  assert.equal(readPlaybackClock(progress).positionMs,duration);assert.equal(app.audioNodes.filter(node=>node.kind==='audio-worklet').length,starts);
  assert.equal(app.audioNodes.filter(node=>node.kind==='audio-worklet'&&node.connected).length,0);
  await app.click('play-button');await app.until(()=>app.$('clean-song-stage').dataset.rendererState==='playing');
  const receiver=app.audioNodes.findLast(node=>node.kind==='audio-worklet'&&node.connected);
  assert.equal(receiver.core.positionFrame,0);assert.equal(app.audioNodes.filter(node=>node.kind==='audio-worklet').length,starts+1);
  assert.doesNotMatch(app.$('notice-message').textContent,/invalid_audio_plan|source position/);
 }finally{await app.close();}
});

test('pointer seeking cancels held PC, pointer and MIDI sounds and follows paused written notes',async()=>{
 const {app,time}=await setup();
 try{
  await app.click('midi-button');await app.until(()=>Boolean(app.midiDevice.onmidimessage));
  await app.click('vsq-listen-basic');await app.until(()=>app.$('clean-song-stage').dataset.rendererState==='playing');
  if(app.$('notation-toggle').getAttribute('aria-expanded')!=='true')await app.click('notation-toggle');
  await app.click('jianpu-button');await app.until(()=>app.$('written-cursor-status').dataset.status==='ready');
  time(1300);app.frame();
  app.emit(app.$('stage-title'),'keydown',{code:'KeyZ',key:'z'});
  app.emit(app.document.querySelector('#keyboard [data-midi="60"]'),'pointerdown',{pointerId:7,button:0});
  app.midi([0x90,67,90]);await app.tick();
  assert.ok(app.document.querySelectorAll('#keyboard .pressed').length>=3);
  const progress=app.$('progress');app.emit(progress,'pointerdown',{pointerId:8,button:0});
  assert.equal(app.document.querySelectorAll('#keyboard .pressed').length,0);
  assert.equal(app.audioNodes.filter(node=>node.kind==='audio-worklet'&&node.connected).length,0);
  const live=app.audioNodes.find(node=>node.kind==='live-audio-worklet');
  await app.tick();assert.equal(live.core.notes.some(note=>note.occupied),false);
  progress.value=500;app.emit(progress,'input');
  assert.equal(readPlaybackClock(progress).positionMs,500);
  assert.deepEqual(JSON.parse(app.$('written-cursor-status').dataset.sourceNoteIds),['vsq-t1-ID#0001','vsq-t2-ID#0001']);
  progress.value=2041;app.emit(progress,'input');
  assert.deepEqual(JSON.parse(app.$('written-cursor-status').dataset.sourceNoteIds),[]);
  app.emit(app.$('stage-title'),'keyup',{code:'KeyZ',key:'z'});app.midi([0x80,67,0]);
  time(1600);app.frame();assert.equal(readPlaybackClock(progress).positionMs,2041);
  assert.equal(app.$('export-takes').disabled,true);
 }finally{await app.close();}
});

test('seeking synchronizes the retained PV while revoking playback until explicit Play',async()=>{
 const media=mediaFixture({id:'pv',role:'pv',mime:'video/webm',content:'authored-seek-pv'});
 const descriptor=cleanDescriptor(({metadata})=>metadata.media=[media.descriptor]),score=descriptor.runtime.compilation.score,key=`song-${descriptor.content_sha256}`;
 const server=await nativeScoreServer();let clock=1000;
 server.records.set(key,{entry:{key,revision:1,title:score.title,composer:'',score_id:score.id,label:score.title,score_bytes:JSON.stringify(score).length,saved_at_unix_ms:1700000000000,clean_package:{version:2,content_sha256:descriptor.content_sha256,media:descriptor.media}},score_json:JSON.stringify(score),clean_package:descriptor});
 server.setRoute(({path})=>path==='/api/library/asset'?{ok:true,url:'https://wmh.localhost/api/library/asset',headers:{get:()=>media.descriptor.mime},arrayBuffer:async()=>Uint8Array.from(media.data).buffer}:undefined);
 const app=await nativeStorageApp(server,{now:()=>clock});
 try{
  await app.until(()=>app.savedButton(key)&&!app.$('start-listen').disabled);
  await app.click('home-single-player');app.savedButton(key).click();
  await app.until(()=>app.$('song-lobby').dataset.previewStatus==='ready'&&!app.$('clean-song-preview').hidden);
  app.$('count-in').checked=false;
  const video=app.$('clean-song-pv');let plays=0;
  video.pause=()=>{video.paused=true;};video.play=()=>{plays++;video.paused=false;return Promise.resolve();};video.load=()=>{};
  await app.click('start-listen');await app.until(()=>Boolean(video.src));
  video.onloadeddata();clock=1200;app.frame();await app.tick();assert.equal(plays,1);
  const progress=app.$('progress');progress.value=600;app.emit(progress,'input');
  assert.equal(readPlaybackClock(progress).positionMs,600);assert.equal(video.currentTime,.6);assert.equal(video.paused,true);
  clock=1600;app.frame();await app.tick();assert.equal(plays,1);assert.equal(video.currentTime,.6);
  await app.click('play-button');assert.equal(plays,2);assert.equal(video.paused,false);
 }finally{await app.close();}
});

test('seek fences a pending audio-module completion and never starts the old position',async()=>{
 const {app,time}=await setup(),gate=deferred();
 try{
  app.setAudioModule(()=>gate.promise);
  await app.click('vsq-listen-basic');await app.until(()=>app.document.body.dataset.screen==='stage'&&app.audio().contexts===1);
  await app.tick();const progress=app.$('progress');progress.value=2041;app.emit(progress,'input');
  gate.resolve();await app.tick();await app.tick();time(1800);app.frame();
  assert.equal(readPlaybackClock(progress).positionMs,2041);assert.match(app.$('play-button').textContent,/Play/);
  assert.equal(app.audioNodes.filter(node=>node.kind==='audio-worklet'&&node.connected).length,0);
  assert.equal(app.$('export-takes').disabled,true);
  app.setAudioModule(null);await app.click('play-button');await app.until(()=>app.$('clean-song-stage').dataset.rendererState==='playing');
  assert.equal(app.audioNodes.findLast(node=>node.kind==='audio-worklet'&&node.connected).core.positionFrame,2041*8);
 }finally{gate.resolve();await app.close();}
});

test('seek cancels source preparation before its delayed ready acknowledgement',async()=>{
 const {app,time}=await setup({audioMessages:false});
 try{
  await app.click('vsq-listen-basic');await app.until(()=>app.audioNodes.some(node=>node.kind==='audio-worklet'));
  const progress=app.$('progress'),audio=app.audioHarnesses[0];
  progress.value=2041;app.emit(progress,'input');
  audio.deliverCore();audio.finishPreparation();audio.deliverMain();await app.tick();
  time(1800);app.frame();
  assert.equal(readPlaybackClock(progress).positionMs,2041);assert.match(app.$('play-button').textContent,/Play/);
  assert.equal(app.audioNodes.filter(node=>node.kind==='audio-worklet'&&node.connected).length,0);
  assert.equal(audio.toCore.some(([,message])=>message.type==='start'),false);
 }finally{await app.close();}
});

test('Practice seeking is disabled, explains why, and preserves the paused take through navigation',async()=>{
 const {app,time}=await setup();
 try{
  await app.click('vsq-practice-basic');await app.until(()=>app.$('clean-song-stage').dataset.rendererState==='playing');
  time(1200);app.emit(app.$('stage-title'),'keydown',{code:'KeyZ',key:'z'});await app.tick();
  app.emit(app.$('stage-title'),'keyup',{code:'KeyZ',key:'z'});await app.click('play-button');
  const before=await app.exported('export-takes'),progress=app.$('progress'),position=readPlaybackClock(progress).positionMs;
  assert.equal(before.passes.length,1);assert.equal(before.passes[0].inputs.length,1);assert.equal(progress.disabled,true);
  progress.value=2041;app.emit(progress,'input');app.emit(progress,'keydown',{key:'End'});
  assert.equal(readPlaybackClock(progress).positionMs,position);assert.deepEqual(await app.exported('export-takes'),before);
  const i18n=getAppI18n(app.document);
  for(const locale of ['zh-CN','en']){i18n.setLocale(locale);assert.match(app.$('progress-help').textContent,locale==='en'?/only in Listen.*continuous/:/仅聆听模式.*连续/);assert.equal(progress.disabled,true);}
  await app.click('back-to-library');await app.click('resume-session');
  assert.deepEqual(await app.exported('export-takes'),before);assert.equal(readPlaybackClock(progress).positionMs,position);assert.equal(progress.disabled,true);
 }finally{await app.close();}
});

test('ordinary Listen seek/reset transitions publish canonical loop bounds atomically',async()=>{
 const server=await nativeScoreServer();let clock=1000;
 server.setRoute(({path,body})=>path==='/api/practice-window'?nativeResponse({start_ms:250,end_ms:750,from:body.from,to:body.to,target_note_ids:body.score.parts.flatMap(part=>part.notes.slice(1).map(note=>note.id))}):undefined);
 const app=await nativeStorageApp(server,{now:()=>clock});
 try{
  await app.until(()=>!app.$('start-listen').disabled);await app.click('home-single-player');await app.click('start-listen');
  await app.until(()=>app.document.body.dataset.screen==='stage');await app.click('play-button');
  app.emit(app.$('progress'),'keydown',{key:'End'});assert.equal(readPlaybackClock(app.document).completed,true);
  app.$('loop-from').value='0.5';app.$('loop-to').value='1.5';await app.click('loop-apply');
  await app.until(()=>app.$('loop-enabled').checked);const progress=app.$('progress');
  assert.equal(readPlaybackClock(progress).completed,false);assert.equal(readPlaybackClock(progress).phase,'ready');
  assert.equal(Number(progress.min),250);assert.equal(Number(progress.max),750);assert.match(app.$('progress-help').textContent,/selected loop/);
  progress.value=0;app.emit(progress,'input');assert.equal(readPlaybackClock(progress).positionMs,250);
  progress.value=900;app.emit(progress,'input');assert.equal(readPlaybackClock(progress).positionMs,750);
  app.emit(progress,'keydown',{key:'Home'});assert.equal(readPlaybackClock(progress).positionMs,250);
  app.emit(progress,'keydown',{key:'End'});assert.equal(readPlaybackClock(progress).positionMs,750);
  clock=2000;app.frame();assert.equal(readPlaybackClock(progress).positionMs,750);assert.match(app.$('play-button').textContent,/Play again/);
  app.$('count-in').checked=false;await app.click('play-button');app.frame();
  assert.equal(readPlaybackClock(progress).positionMs,250,'Explicit Replay starts at the validated loop start');
  assert.match(app.$('play-button').textContent,/Pause/);
  app.emit(progress,'keydown',{key:'End'});assert.equal(readPlaybackClock(progress).completed,true);
  app.$('loop-enabled').checked=false;app.emit(app.$('loop-enabled'),'change');
  assert.equal(readPlaybackClock(progress).completed,false);assert.equal(readPlaybackClock(progress).rangeEndMs,1000);
  assert.equal(readPlaybackClock(progress).positionMs,0);assert.equal(app.$('loop-enabled').checked,false);
  await app.click('loop-apply');await app.until(()=>app.$('loop-enabled').checked);
  app.emit(progress,'keydown',{key:'End'});assert.equal(readPlaybackClock(progress).completed,true);
  app.$('loop-from').value='0.75';app.emit(app.$('loop-from'),'input');
  assert.equal(readPlaybackClock(progress).completed,false);assert.equal(readPlaybackClock(progress).rangeEndMs,1000);
  assert.equal(readPlaybackClock(progress).positionMs,0);assert.equal(app.$('loop-enabled').checked,false);
  assert.doesNotMatch(app.$('loop-status').textContent,/missing or invalid/);
 }finally{await app.close();}
});

test('loading a different-duration score after completion publishes only its reset clock',async()=>{
 const {app}=await setup({rangeSerialization:true});
 try{
  await app.click('vsq-listen-basic');await app.until(()=>app.$('clean-song-stage').dataset.rendererState==='playing');
  app.emit(app.$('progress'),'keydown',{key:'End'});
  assert.equal(readPlaybackClock(app.document).completed,true);
  const next=authoredScore({id:'seek-after-completion',title:'Original next score'});
  app.importFile(next);await app.until(()=>app.$('score-title').textContent===next.title&&!app.$('play-button').disabled);
  const clock=readPlaybackClock(app.document);
  assert.equal(clock.durationMs,1000);assert.equal(clock.positionMs,0);assert.equal(clock.transportPositionMs,0);
  assert.equal(clock.completed,false);assert.equal(clock.phase,'ready');
  assert.doesNotMatch(app.$('notice-message').textContent,/missing or invalid/);
  assert.equal(app.audioNodes.filter(node=>node.kind==='audio-worklet'&&node.connected).length,0);
 }finally{await app.close();}
});
