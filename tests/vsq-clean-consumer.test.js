import {basicKeyAudioHarness} from './basic-key-audio-harness.js';
import {BasicKeyAudioReceiver} from '../web/basic-key-audio-receiver.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {prepareCleanSong,prepareVsqPractice,isVsqSong,isVsqSummary} from '../web/clean-song-package.js';
import {openScoreStorage} from '../web/native-score-storage.js';
import {CleanSongPlayer,inspectCleanRendition} from '../web/clean-song-player.js';
import {VsqPracticePlayer} from '../web/vsq-practice-player.js';
import {keyAt,numberedNotationLayout} from '../web/music.js';
import {getAppI18n} from '../web/app-locale.js';
import {createBulkImportTransport} from '../web/bulk-import.js';
import {fakeAudio,cleanSong} from './clean-song-fixtures.js';
import {nativeScoreServer,nativeStorageApp,nativeResponse,deferred} from './native-storage-app-fixtures.js';
import {importFile,importReport,importItem,selectImportFiles} from './bulk-import-fixtures.js';

const read=name=>JSON.parse(readFileSync(new URL(`./fixtures/${name}.json`,import.meta.url),'utf8'));
const opened=()=>read('vsq-clean-v1-native-open'),response=()=>read('vsq-clean-v1-runtime');
function source(){const value=opened(),descriptor=value.clean_package,score=JSON.parse(value.score_json),key=`native:song-${descriptor.content_sha256}`;return{value,descriptor,score,key};}
function admitted(){const {descriptor,score,key}=source();return prepareCleanSong(key,descriptor,score);}
function practiced(){return prepareVsqPractice(admitted(),response());}
async function nativeFixture(){
  const {value,descriptor,score,key}=source(),server=await nativeScoreServer(),storageKey=key.slice(7);
  const summary={version:2,content_sha256:descriptor.content_sha256,profile:descriptor.profile,capabilities:descriptor.capabilities,interpretation_limits:descriptor.interpretation_limits,media:[]};
  const entry={key:storageKey,revision:1,title:score.title,composer:score.composer,score_id:score.id,label:score.title,score_bytes:Buffer.byteLength(value.score_json),saved_at_unix_ms:1700000000000,clean_package:summary};
  server.records.set(storageKey,{...value,entry});server.setRoute(({path})=>path==='/api/library/runtime'?nativeResponse(response()):undefined);
  return{server,storageKey,key,summary,entry,descriptor,score};
}
async function appFixture(options={}){const fixture=await nativeFixture(),app=await nativeStorageApp(fixture.server,options);await app.until(()=>app.savedButton(fixture.storageKey)&&!app.$('start-listen').disabled);await app.click('home-single-player');app.savedButton(fixture.storageKey).click();await app.until(()=>app.$('song-lobby').dataset.previewStatus==='choice');app.$('count-in').checked=false;return{...fixture,app};}
const connectedReceivers=app=>app.audioNodes.filter(node=>node.kind==='audio-worklet'&&node.connected);
const admittedGates=app=>connectedReceivers(app).flatMap(node=>[...node.core.plan.ends].filter(end=>end>node.core.positionFrame));
function playerHarness(Player=CleanSongPlayer){
 const audio=basicKeyAudioHarness(),original=Object.getOwnPropertyDescriptor(globalThis,'AudioWorkletNode'),errors=[];
 globalThis.AudioWorkletNode=class{constructor(){return audio.nodeFactory();}};
 const player=new Player({getPositionMs:()=>{throw Error('No main-thread clock polling');},onError:error=>errors.push(error)});player.select(practiced());
 return{...audio,player,errors,start:options=>player.start({...audio,...options}),close(){player.stop();if(original)Object.defineProperty(globalThis,'AudioWorkletNode',original);else delete globalThis.AudioWorkletNode;}};
}
const choose=async app=>{await app.click('vsq-choose-base-notes');await app.until(()=>app.$('song-lobby').dataset.previewStatus==='ready'&&!app.$('start-practice').disabled);};
const start=async(app,mode)=>{await app.click(`start-${mode}`);await app.until(()=>app.document.body.dataset.screen==='stage'&&app.$('clean-song-stage').dataset.rendererState==='playing');};

test('VSQ admission keeps unsafe authoring integers in exact strings and does not grant implicit runtime',()=>{
  const song=admitted(),{descriptor}=source();assert.ok(isVsqSong(song));assert.equal(song.runtime,null);assert.equal(song.compilation,null);assert.equal(song.score_json,descriptor.score_json);assert.equal(song.metadata_json,descriptor.metadata_json);assert.match(song.score_json,/9007199254740993/);assert.equal(inspectCleanRendition(song).supported,false);assert.equal(song.notation.parts.length,2);assert.deepEqual(song.notation.keys,[]);assert.equal(keyAt(song.notation,4),null);assert.equal(Object.isFrozen(song.notation),true);
  const layout=numberedNotationLayout(song.notation,{allParts:true,numberedMode:'movable'});assert.doesNotMatch(JSON.stringify(layout),/C4 \(major\)/);
  for(const mutate of [d=>d.runtime=response().runtime,d=>d.profile='unknown',d=>d.capabilities.whole_vocal_rendering='ready',d=>d.interpretation_limits.pop()]){const {descriptor,score,key}=source();mutate(descriptor);assert.throws(()=>prepareCleanSong(key,descriptor,score),{code:'clean_package_invalid'});}
});

test('native VSQ runtime binds every note, exact native timing and separate reference velocity',()=>{
  const song=practiced();assert.equal(song.runtime.notes.length,2);assert.deepEqual(song.runtime.notes.map(note=>note.dynamics),[0,0]);assert.deepEqual(song.runtime.parts.map(part=>part.audible),[true,false]);assert.equal(song.compilation.timeline.notes[0].duration_ms,1418.75116875);assert.equal(song.compilation.timeline.notes[0].start_ms,0);assert.equal(song.notation.parts[0].notes[0].at.numerator,4);assert.equal(song.reference_velocity,90);assert.equal(inspectCleanRendition(song).supported,true);
  for(const mutate of [r=>r.runtime.notes.pop(),r=>r.runtime.parts.pop(),r=>r.runtime.notes[0].channel=0,r=>r.runtime.notes[0].note_id='wrong',r=>r.compilation.timeline.notes[0].start_ms=123,r=>r.runtime.source_sha256='b'.repeat(64),r=>r.compilation.score.keys=[{at:{numerator:0,denominator:1},fifths:0,mode:'major'}],r=>r.reference_velocity=0]){const result=response();mutate(result);assert.throws(()=>prepareVsqPractice(admitted(),result),{code:'clean_package_invalid'});}
});

test('native load never compiles VSQ notation for playback and each load requires a fresh explicit choice',async()=>{
  const {server,key,descriptor}=await nativeFixture();let validation=0;
  const storage=await openScoreStorage({fetcher:server.fetcher,origin:'https://wmh.localhost',validateScore:async()=>{validation++;return true;}});
  try{const first=await storage.load(key);assert.equal(validation,0);assert.equal(first.cleanSong.runtime,null);assert.equal(first.cleanSong.score_json,descriptor.score_json);assert.equal(server.requests.filter(r=>r.path==='/api/library/runtime').length,0);
    const song=await storage.chooseVsqPractice(first.cleanSong);assert.ok(song.runtime);assert.deepEqual(server.requests.at(-1).body,{key:key.slice(7),profile:'wmh-vsq-clean-v1',choice:'base_notes_instrumental'});assert.equal(server.requests.at(-1).options.credentials,'same-origin');assert.equal(server.requests.at(-1).options.redirect,'error');const next=await storage.load(key);assert.equal(next.cleanSong.runtime,null);await assert.rejects(storage.chooseVsqPractice(first.cleanSong),{code:'library_runtime_choice'});await assert.rejects(storage.exportBackup(),{code:'clean_pack_export_required'});
  }finally{storage.close();}
});

test('failed or cancelled VSQ reloads cannot replace the validated explicit-choice admission',async()=>{
  for(const failure of ['wrong-entry','aborted']){
    const {server,key}=await nativeFixture(),controller=new AbortController();let validations=0;
    const storage=await openScoreStorage({fetcher:server.fetcher,origin:'https://wmh.localhost',validateScore:async()=>{validations++;throw Error('Do not recompile native VSQ authoring');}});
    try{
      const first=await storage.load(key);
      server.setRoute(({path,defaultReply})=>{
        if(path==='/api/library/runtime')return nativeResponse(response());
        if(path!=='/api/library/load')return;
        const reply=defaultReply();return{...reply,json:async()=>{const value=await reply.json();if(failure==='wrong-entry')value.entry.key=`song-${'0'.repeat(64)}`;else controller.abort();return value;}};
      });
      await assert.rejects(storage.load(key,{signal:controller.signal}),failure==='wrong-entry'?{code:'library_invalid_response'}:{name:'AbortError'});
      assert.equal(server.requests.filter(request=>request.path==='/api/library/runtime').length,0);
      const chosen=await storage.chooseVsqPractice(first.cleanSong);assert.ok(chosen.runtime);assert.equal(chosen.score_json,first.cleanSong.score_json);assert.equal(validations,0);
    }finally{storage.close();}
  }
});

test('a VSQ load completing after storage closes never grants a runtime choice',async()=>{
  const {server,key}=await nativeFixture(),gate=deferred();
  const storage=await openScoreStorage({fetcher:server.fetcher,origin:'https://wmh.localhost',validateScore:async()=>{throw Error('Do not recompile native VSQ authoring');}});
  server.setRoute(async({path,defaultReply})=>{if(path==='/api/library/load'){await gate.promise;return defaultReply();}});
  const pending=storage.load(key);storage.close();gate.resolve();const late=await pending;
  assert.equal(late.cleanSong.runtime,null);await assert.rejects(storage.chooseVsqPractice(late.cleanSong),{code:'library_runtime_choice'});
  assert.equal(server.requests.filter(request=>request.path==='/api/library/runtime').length,0);
});

test('VSQ Dynamics zero retains fixed reference velocity and excludes human/muted parts on the audio thread',async()=>{
 const h=playerHarness();try{
  await h.start({mode:'listen',mutedParts:['vsq-track-2'],instrument:'piano'});assert.equal(h.player.vsq.plan.notes.length,1);assert.equal(h.player.vsq.plan.notes[0][5],90);assert.equal(h.player.vsq.plan.notes[0][6],2);h.player.stop();
  await h.start({mode:'practice',targetPart:'vsq-track-1',mutedParts:['vsq-track-2'],instrument:'guitar'});assert.equal(h.player.vsq.plan.notes.length,0);h.player.stop();
  await h.start({mode:'practice',targetPart:'vsq-track-1',instrument:'guitar'});assert.equal(h.player.vsq.plan.notes.length,1);assert.equal(h.player.vsq.plan.notes[0][6],3);h.player.stop();assert.equal(h.nodes.filter(node=>node.connected).length,0);assert.deepEqual(h.errors,[]);
 }finally{h.close();}
});

test('legacy MIDI browser timer defaults retain global receiver through start, pause and restart cleanup',()=>{
  const originalSet=globalThis.setTimeout,originalClear=globalThis.clearTimeout,pending=new Map();let sequence=0;
  globalThis.setTimeout=function(callback,delay){assert.equal(this,globalThis,'Browser timer requires the global receiver');assert.equal(delay,20);const id=++sequence;pending.set(id,callback);return id;};
  globalThis.clearTimeout=function(id){assert.equal(this,globalThis,'Browser timer cancellation requires the global receiver');assert.ok(pending.delete(id),'Cancel the owned timer exactly once');};
  try{
    for(const [Player,song] of [[CleanSongPlayer,cleanSong()]]){
      const audio=fakeAudio(),player=new Player({getPositionMs:()=>0});
      try{
        player.select(song);player.start(audio);assert.equal(pending.size,1);assert.ok(audio.nodes.some(node=>node.kind==='oscillator'&&!node.disconnected));const stale=[...pending.values()][0];
        if(player.pause)player.pause();else player.stop();assert.equal(pending.size,0);assert.ok(audio.nodes.filter(node=>node.kind==='oscillator').every(node=>node.disconnected));stale();assert.equal(pending.size,0);assert.ok(audio.nodes.filter(node=>node.kind==='oscillator').every(node=>node.disconnected));
        player.start(audio);assert.equal(pending.size,1);assert.ok(audio.nodes.some(node=>node.kind==='oscillator'&&!node.disconnected));player.stop();assert.equal(pending.size,0);assert.ok(audio.nodes.filter(node=>node.kind==='oscillator').every(node=>node.disconnected));
      }finally{player.stop();}
    }
  }finally{globalThis.setTimeout=originalSet;globalThis.clearTimeout=originalClear;}
});

test('VSQ saved/duplicate import outcomes may be playable:false only with the explicit complete-package capability',async()=>{
  const {summary,entry}=await nativeFixture(),file=importFile('original-synthetic-vsq.zip','synthetic');assert.ok(isVsqSummary(summary));
  for(const status of ['saved','duplicate']){let complete=summary;const transport=createBulkImportTransport({origin:'https://wmh.localhost',fetcher:async()=>nativeResponse(importReport(file,{mode:'commit',items:[importItem({status,playable:false,entry:{key:entry.key},clean_package:complete})]}))});assert.equal((await transport.commit(file)).items[0].playable,false);complete={...summary,profile:'unknown'};await assert.rejects(transport.commit(file),{code:'pack_invalid_response'});}
});

test('ordinary VSQ library selection exposes clear Chinese choice, keeps unknown key, and has no implicit playback',async()=>{
  const {app,server,storageKey}=await appFixture();try{
    assert.equal(app.$('start-listen').disabled,true);assert.equal(app.$('start-practice').disabled,true);assert.equal(app.$('vsq-full-vocal').disabled,true);assert.equal(app.$('vsq-interpretation-limits').children.length,8);assert.equal(server.requests.filter(r=>r.path==='/api/library/runtime').length,0);assert.equal(admittedGates(app).length,0);assert.match(app.$('preview-music-meta').textContent,/unspecified/i);
    getAppI18n(app.document).setLocale('zh-CN');assert.match(app.$('vsq-choose-base-notes').textContent,/选择基础音符器乐练习/);assert.match(app.$('clean-song-rendition').textContent,/基础乐器聆听全部创作声部.*暂不支持原歌声合成/);assert.match(app.$('vsq-practice-description').textContent,/源歌手和声库独立/);assert.doesNotMatch(app.$('vsq-interpretation-limits').textContent,/not rendered|unavailable/i);
    const before=server.requests.filter(r=>r.path==='/api/compile').length;await choose(app);assert.equal(admittedGates(app).length,0);assert.equal(app.$('vsq-choose-base-notes').hidden,true);assert.equal(server.requests.filter(r=>r.path==='/api/compile').length,before);await start(app,'listen');assert.equal(admittedGates(app).length,2);assert.equal(app.$('clean-song-stage').dataset.rendererState,'playing');assert.equal(app.$('export-button').disabled,true);assert.equal(app.$('notation-part').value,'');await app.click('reset-button');assert.equal(admittedGates(app).length,0);await app.click('play-button');assert.equal(admittedGates(app).length,2);assert.equal(server.requests.filter(r=>r.path==='/api/library/runtime').length,1);
    await app.click('back-to-library');app.savedButton(storageKey).click();await app.until(()=>app.$('song-lobby').dataset.previewStatus==='choice');assert.equal(app.$('start-listen').disabled,true);assert.equal(app.$('vsq-choose-base-notes').hidden,false);
  }finally{await app.close();}
});

test('VSQ full-part practice includes source-muted accompaniment while grading only the human target',async()=>{
  const {app,server}=await appFixture();try{await choose(app);await start(app,'practice');assert.equal(admittedGates(app).length,1);await app.click('play-button');let take=await app.exported('export-takes');assert.equal(take.practice_part,'vsq-track-1');assert.deepEqual(take.passes[0].timeline.notes.map(n=>n.id),['vsq-t1-ID#0001']);assert.deepEqual(take.passes[0].inputs,[]);
    const checkbox=app.document.querySelector('#clean-song-parts input[data-part-id="vsq-track-2"]');assert.equal(checkbox.checked,true);assert.match(checkbox.parentNode.textContent,/source-muted/);checkbox.checked=false;app.emit(checkbox,'change');await app.click('play-button');assert.equal(admittedGates(app).length,0);await app.click('play-button');const target=app.$('clean-song-target');target.value='vsq-track-2';app.emit(target,'change');await app.until(()=>!app.$('play-button').disabled);await app.click('play-button');assert.equal(admittedGates(app).length,1);take=await app.exported('export-takes');assert.equal(take.practice_part,'vsq-track-2');assert.deepEqual(take.passes[0].timeline.notes.map(n=>n.id),['vsq-t2-ID#0001']);assert.deepEqual(take.passes[0].inputs,[]);assert.equal(server.requests.filter(r=>r.path==='/api/library/runtime').length,1);
  }finally{await app.close();}
});

test('repeated choice clicks coalesce, errors allow retry, and late runtime cannot replace a newer song',async()=>{
  const {app,server}=await appFixture();const pending=deferred();try{
    server.setRoute(({path})=>path==='/api/library/runtime'?nativeResponse({code:'library_runtime_invalid',error:'Synthetic failure'},422):undefined);await app.click('vsq-choose-base-notes');await app.until(()=>app.$('song-lobby').dataset.previewStatus==='choice');assert.match(app.$('vsq-choice-status').textContent,/Retry/);assert.equal(app.$('start-listen').disabled,true);
    server.setRoute(async({path})=>path==='/api/library/runtime'?(await pending.promise,nativeResponse(response())):undefined);await app.click('vsq-choose-base-notes');await app.click('vsq-choose-base-notes');assert.equal(server.requests.filter(r=>r.path==='/api/library/runtime').length,2);const button=app.document.querySelector('#catalog [data-score-id]');button.click();await app.until(()=>app.$('clean-song-preview').hidden);pending.resolve();await app.tick();assert.equal(app.$('clean-song-preview').hidden,true);assert.equal(admittedGates(app).length,0);
  }finally{pending.resolve();await app.close();}
});

test('application restart never restores a VSQ interpretation choice',async()=>{
  const {app,server,storageKey}=await appFixture();await choose(app);await app.close();const restarted=await nativeStorageApp(server);try{await restarted.until(()=>restarted.savedButton(storageKey)&&!restarted.$('start-listen').disabled);await restarted.click('home-single-player');restarted.savedButton(storageKey).click();await restarted.until(()=>restarted.$('song-lobby').dataset.previewStatus==='choice');assert.equal(restarted.$('start-listen').disabled,true);assert.equal(server.requests.filter(r=>r.path==='/api/library/runtime').length,1);}finally{await restarted.close();}
});

test('VSQ import review, saved browse and pack export remain available with playable:false',async()=>{
  const {server,storageKey,summary,entry,descriptor}=await nativeFixture(),record=server.records.get(storageKey);server.records.clear();const file=importFile('original-synthetic-vsq.zip','synthetic');let committed=false;
  server.setRoute(({path})=>{
    if(path==='/api/library/imports')return nativeResponse({format:'worldmusichub-import-history',version:1,imports:[],issues:[]});
    if(path.startsWith('/api/library/import/')){const mode=path.endsWith('/commit')?'commit':'preview';if(mode==='commit'){server.records.set(storageKey,record);committed=true;}return nativeResponse(importReport(file,{mode,items:[importItem({title:entry.title,status:mode==='commit'?'saved':'ready',playable:false,clean_package:summary,...(mode==='commit'?{entry}:{})})]}));}
    if(path==='/api/library/pack/export')return{...nativeResponse(null),blob:async()=>new Blob([descriptor.score_json],{type:'application/zip'})};
  });
  const app=await nativeStorageApp(server);try{await app.until(()=>!app.$('start-listen').disabled);await app.click('home-single-player');selectImportFiles(app,[file]);await app.until(()=>app.$('bulk-import-dialog').dataset.phase==='review');getAppI18n(app.document).setLocale('zh-CN');assert.match(app.$('bulk-import-groups').textContent,/保留完整 VSQ 曲包/);assert.doesNotMatch(app.$('bulk-import-groups').textContent,/不能播放，仅保留原件/);await app.click('bulk-import-save');await app.until(()=>committed&&app.savedButton(storageKey)&&app.$('bulk-import-dialog').dataset.phase==='review');const browse=app.document.querySelector('[data-import-browse]');assert.equal(browse.hidden,false);browse.click();await app.until(()=>app.$('song-lobby').dataset.previewStatus==='choice');assert.equal(app.$('start-listen').disabled,true);
    await app.click('bulk-import-history-button');const checkbox=app.document.querySelector(`[data-import-export-key="${storageKey}"]`);assert.ok(checkbox);checkbox.checked=true;app.emit(checkbox,'change');assert.match(app.$('bulk-import-export-pack').textContent,/导出完整纯净曲包/);await app.click('bulk-import-export-pack');await app.until(()=>app.downloads.length===1);const call=server.requests.find(r=>r.path==='/api/library/pack/export');assert.deepEqual(call.body,{keys:[storageKey]});assert.match(await app.downloads[0].text(),/9007199254740993/);assert.equal(server.requests.some(r=>r.path==='/api/library/runtime'),false);
  }finally{await app.close();}
});


test('VSQ basic instrument actions derive and start the full-part mix from one click',async()=>{
 for(const [mode,voices]of [['listen',2],['practice',1]]){
  const {app,server}=await appFixture();try{
   assert.equal(app.$(`vsq-${mode}-basic`).disabled,false);await app.click(`vsq-${mode}-basic`);await app.until(()=>app.document.body.dataset.screen==='stage'&&app.$('clean-song-stage').dataset.rendererState==='playing');
   assert.equal(admittedGates(app).length,voices);assert.equal(server.requests.filter(request=>request.path==='/api/library/runtime').length,1);assert.ok(app.audio().unlocks>0);
   if(mode==='practice'){await app.click('play-button');const take=await app.exported('export-takes');assert.deepEqual(take.passes[0].inputs,[]);assert.deepEqual(take.passes[0].captures,[]);assert.match(app.$('clean-song-stage-status').textContent,/You play.*other audible parts: 1/);}
  }finally{await app.close();}
 }
});

test('late VSQ direct-start derivation cannot start after another selection',async()=>{
 const {app,server}=await appFixture(),pending=deferred();try{
  server.setRoute(async({path})=>path==='/api/library/runtime'?(await pending.promise,nativeResponse(response())):undefined);
  await app.click('vsq-listen-basic');await app.until(()=>app.$('song-lobby').dataset.previewStatus==='choosing');const bundled=app.document.querySelector('#catalog [data-score-id]');bundled.click();await app.until(()=>app.$('clean-song-preview').hidden);pending.resolve();await app.tick();assert.equal(admittedGates(app).length,0);assert.notEqual(app.document.body.dataset.screen,'stage');
 }finally{pending.resolve();await app.close();}
});

test('VSQ direct-start derivation is cancelled by Home navigation',async()=>{
 const {app,server}=await appFixture(),pending=deferred();try{
  server.setRoute(async({path})=>path==='/api/library/runtime'?(await pending.promise,nativeResponse(response())):undefined);
  await app.click('vsq-listen-basic');await app.until(()=>app.$('song-lobby').dataset.previewStatus==='choosing');await app.click('lobby-home');assert.equal(app.document.body.dataset.screen,'home');pending.resolve();await app.tick();await app.tick();assert.equal(app.document.body.dataset.screen,'home');assert.equal(admittedGates(app).length,0);
 }finally{pending.resolve();await app.close();}
});


test('VSQ explicit resume excludes a gate ended inside the 50 ms admission lead',async()=>{
 const h=playerHarness(VsqPracticePlayer),resume=h.player.song.runtime.notes[0].end_ms+34.6;
 try{const anchor=await h.start({resumePositionMs:resume});assert.equal(h.nodes.at(-1).core.eligibleCount,0);assert.equal(h.nodes.at(-1).core.skippedCount,2);assert.equal(anchor.positionMs,Math.round(resume*48)/48);assert.ok(anchor.anchorTime>h.context.currentTime);}finally{h.close();}
});


test('VSQ count-in, audio samples, transport and human input share one accepted source anchor',async()=>{
 let clock=1000;const {app}=await appFixture({now:()=>clock});
 const advance=wall=>{clock=wall;app.renderAudioTo((wall-1000)/1000);};
 try{
  await choose(app);app.$('count-in').checked=true;await start(app,'practice');const countIn=4*60000/Number(app.$('tempo').value);
  const node=connectedReceivers(app)[0],core=node.core,audio=app.audioHarnesses[0],sourceStart=core.positionFrame*1000/core.sampleRate,wallStart=clock+(core.anchorFrame/core.sampleRate-audio.context.currentTime)*1000;
  assert.equal(sourceStart,Math.round(-countIn*core.sampleRate/1000)*1000/core.sampleRate);assert.equal(core.startedCount,0);assert.equal(app.audioNodes.filter(node=>node.kind==='oscillator').length,0,'Machine playback allocates no oscillator nodes');
  advance(wallStart-sourceStart-1);assert.equal(core.startedCount,0);advance(wallStart-sourceStart+1);assert.equal(core.startedCount,1);
  let take=await app.exported('export-takes');assert.equal(take.passes[0].clock_segments[0].wallStart,wallStart);assert.equal(take.passes[0].clock_segments[0].positionStart,sourceStart);assert.deepEqual(take.passes[0].inputs,[]);assert.deepEqual(take.passes[0].captures,[]);
  const human=app.document.querySelector('#keyboard [data-midi="63"]');app.emit(human,'pointerdown',{pointerId:71,button:0});await app.tick();app.emit(human,'pointerup',{pointerId:71});await app.click('play-button');
  take=await app.exported('export-takes');assert.equal(take.passes[0].inputs.length,1);assert.equal(take.passes[0].inputs[0].midi,63);assert.ok(Math.abs(take.passes[0].inputs[0].at_ms-1)<.001);assert.equal(take.passes[0].interpretation.policy_id,'wmh-vsq-base-note-reference-v1');
  await app.click('play-button');await app.until(()=>connectedReceivers(app).length===1);assert.ok(connectedReceivers(app)[0].core.positionFrame>0,'Resume does not repeat count-in');
 }finally{await app.close();}
});

for(const action of ['pause','reset','mute','blur','hidden','settings','navigation','part'])test(`pending VSQ audio preparation is canceled by ${action} without a take or auto-resume`,async()=>{
 const {app}=await appFixture();let release;
 try{
  await choose(app);app.setAudioModule(()=>new Promise(resolve=>{release=resolve;}));await app.click('start-practice');await app.until(()=>Boolean(release)&&app.document.body.dataset.screen==='stage');
  if(action==='pause')await app.click('play-button');
  else if(action==='reset')await app.click('reset-button');
  else if(action==='mute')await app.click('sound-button');
  else if(action==='blur')app.emit(app.window,'blur');
  else if(action==='hidden'){Object.defineProperty(app.document,'hidden',{configurable:true,value:true});app.emit(app.document,'visibilitychange');}
  else if(action==='settings')await app.click('settings-button');
  else if(action==='part'){app.$('practice-part').value='vsq-track-2';app.emit(app.$('practice-part'),'change');}
  else await app.click('back-to-library');
  release();await app.tick();await app.tick();assert.equal(connectedReceivers(app).length,0);assert.notEqual(app.$('clean-song-stage').dataset.rendererState,'playing');assert.equal(app.$('export-takes').disabled,true);
 }finally{release?.();await app.close();}
});

for(const state of ['suspended','closed'])test(`VSQ source-only ${state} audio reports its own clock failure`,async()=>{
 const h=playerHarness(VsqPracticePlayer);try{
  await h.start();const node=h.nodes.at(-1);h.setState(state);await Promise.resolve();await Promise.resolve();
  assert.deepEqual(h.errors.map(error=>error.code),['clean_clock_unavailable']);assert.equal(node.connected,false);assert.equal(node.core.state,'canceled');
  const count=h.nodes.length;h.setState('running');await Promise.resolve();assert.equal(h.nodes.length,count);assert.equal(node.connected,false);assert.equal(node.core.state,'canceled');
 }finally{h.close();}
});

for(const state of ['suspended','closed'])test(`VSQ ${state} live audio cancels the source first and cannot auto-resume`,async()=>{
 const {app}=await appFixture(),sourceFailures=[],originalFail=BasicKeyAudioReceiver.prototype.fail;
 BasicKeyAudioReceiver.prototype.fail=function(error){sourceFailures.push(error.code);return originalFail.call(this,error);};
 try{
  await choose(app);await start(app,'practice');const source=connectedReceivers(app)[0],live=app.audioNodes.find(node=>node.kind==='live-audio-worklet'),sourcePlan=source.core.plan;
  assert.ok(app.audioNodes.indexOf(live)<app.audioNodes.indexOf(source),'Live receiver is registered before source preparation');
  app.setAudioState(state);await app.tick();assert.equal(connectedReceivers(app).length,0);assert.equal(app.$('clean-song-stage').dataset.rendererState,'paused');
  assert.equal(source.core.state,'canceled');assert.equal(source.core.plan,sourcePlan);assert.deepEqual(sourceFailures,[],'The later source state listener sees cancellation, so it emits no second clock failure');
  assert.equal(live.core.state,'suspended');assert.equal(live.connected,true);const graph=structuredClone(app.audioGraphEvents),nodeCount=app.audioNodes.length;
  for(const locale of ['en','zh-CN']){getAppI18n(app.document).setLocale(locale);const message=app.$('notice-message').textContent;assert.match(message,state==='closed'?/live_audio_closed/:/live_audio_interrupted/);if(state==='closed')assert.match(message,locale==='en'?/Reopen the app/:/重新打开应用/);else{assert.match(message,locale==='en'?/new play or note action/:/重新点击播放或按音符键/);assert.doesNotMatch(message,/Reopen the app|重新打开应用/);}}
  if(state==='suspended'){
   app.setAudioState('running');await app.tick();assert.equal(connectedReceivers(app).length,0);assert.equal(app.$('clean-song-stage').dataset.rendererState,'paused');assert.equal(live.core.state,'suspended');assert.deepEqual(app.audioGraphEvents,graph);
   await app.click('play-button');await app.until(()=>app.$('clean-song-stage').dataset.rendererState==='playing');assert.equal(live.core.state,'ready');assert.equal(app.audioNodes.find(node=>node.kind==='live-audio-worklet'),live);assert.equal(app.audioNodes.filter(node=>node.kind==='live-audio-worklet').length,1);assert.equal(live.core.activeNotes,0);
  }else{
   await app.click('play-button');assert.match(app.$('notice-message').textContent,/live_audio_closed/);assert.match(app.$('notice-message').textContent,/重新打开应用/);assert.equal(connectedReceivers(app).length,0);assert.equal(app.$('clean-song-stage').dataset.rendererState,'paused');assert.equal(app.audioNodes.length,nodeCount);assert.deepEqual(app.audioGraphEvents,graph);
   await app.click('sound-button');await app.click('play-button');assert.equal(app.$('clean-song-stage').dataset.rendererState,'playing');assert.equal(connectedReceivers(app).length,0);assert.equal(app.audioNodes.length,nodeCount);
  }
  assert.deepEqual(sourceFailures,[]);
 }finally{BasicKeyAudioReceiver.prototype.fail=originalFail;await app.close();}
});

test('missing worklet blocks VSQ audio explicitly; silent practice and sound toggles never restart it',async()=>{
 const {app}=await appFixture({audioWorklet:false});try{
  await choose(app);await app.click('start-practice');await app.until(()=>app.document.body.dataset.screen==='stage');assert.equal(app.$('play-button').disabled,true);assert.match(app.$('notice-message').textContent,/requires AudioWorklet/);assert.equal(connectedReceivers(app).length,0);assert.equal(app.$('export-takes').disabled,true);
  await app.click('sound-button');await app.click('play-button');assert.equal(app.$('clean-song-stage').dataset.rendererState,'playing');assert.equal(connectedReceivers(app).length,0);await app.click('sound-button');assert.notEqual(app.$('clean-song-stage').dataset.rendererState,'playing');assert.equal(app.$('play-button').disabled,true);
 }finally{await app.close();}
});

test('VSQ late start acknowledgment cannot begin a take or backdate transport',async()=>{
 const {app}=await appFixture({audioMessages:false});try{
  await choose(app);await app.click('start-practice');await app.until(()=>app.audioHarnesses.some(audio=>audio.toCore.length));const audio=app.audioHarnesses[0];audio.deliverCore();audio.finishPreparation();audio.deliverMain();await app.tick();audio.deliverCore();
  assert.equal(audio.toMain[0][1].type,'started');const anchor=audio.toMain[0][1].anchorFrame;while(audio.frame<=anchor)audio.renderBlock();audio.deliverMain();await app.tick();audio.deliverCore();assert.equal(connectedReceivers(app).length,0);assert.notEqual(app.$('clean-song-stage').dataset.rendererState,'playing');assert.equal(app.$('export-takes').disabled,true);assert.match(app.$('notice-message').textContent,/clean_late_start/);
 }finally{await app.close();}
});

test('VSQ full Listen reaches the native source end despite a stalled main thread and restarts explicitly',async()=>{
 let clock=1000;const {app}=await appFixture({now:()=>clock});try{
  await choose(app);await start(app,'listen');const node=connectedReceivers(app)[0],core=node.core;
  app.renderAudioTo(4.2);await app.tick();assert.equal(core.state,'ended');assert.equal(core.startedCount,2);assert.equal(core.endedCount,2);assert.equal(core.activeCount,0);assert.equal(node.lastCompletion.frame,core.anchorFrame+core.plan.durationFrames);assert.equal(app.$('export-takes').disabled,true);
  clock=5300;app.frame();assert.equal(app.$('clean-song-stage').dataset.rendererState,'ended');assert.equal(connectedReceivers(app).length,0);await app.click('play-button');await app.until(()=>app.$('clean-song-stage').dataset.rendererState==='playing');assert.equal(connectedReceivers(app)[0].core.positionFrame,0);
 }finally{await app.close();}
});

test('VSQ receiver seek disconnects immediately and requires a fresh explicit preparation',async()=>{
 const h=playerHarness();try{
  const first=await h.start(),node=h.nodes.at(-1);while(h.context.currentTime<first.anchorTime+.01)h.renderBlock();assert.equal(node.core.activeCount,2);
  h.player.vsq.receiver.seek(600);assert.equal(node.connected,false);await Promise.resolve();assert.equal(node.core.activeCount,0);const starts=node.core.startedCount;h.renderBlock(1024);assert.equal(node.core.startedCount,starts);
  const second=await h.start({resumePositionMs:600});assert.equal(second.positionMs,600);assert.notEqual(h.nodes.at(-1),node);assert.equal(h.nodes.at(-1).core.eligibleCount,2);
 }finally{h.close();}
});


test('VSQ keeps explicit source preparation, then uses Mod and one Start action with real synthetic override',async()=>{
 const {app,server,storageKey}=await appFixture(),i18n=getAppI18n(app.document),choice=app.$('vsq-choose-base-notes');
 try{
  assert.equal(app.$('vsq-listen-basic').hidden,true);assert.equal(app.$('start-listen').hidden,true);assert.equal(app.$('start-performance').disabled,true);assert.equal(app.$('configure-song-mod').disabled,true);assert.equal(choice.disabled,false);assert.equal(server.requests.some(r=>r.path==='/api/library/runtime'),false);assert.equal(admittedGates(app).length,0);
  for(const locale of ['zh-CN','en']){i18n.setLocale(locale);assert.match(app.$('song-mod-preview-summary').textContent,locale==='en'?/basic instrumental renderer/:/基础器乐渲染器/);}
  server.setRoute(({path})=>path==='/api/library/runtime'?nativeResponse({code:'library_runtime_invalid',error:'Authored preparation failure'},422):undefined);
  await app.click('vsq-choose-base-notes');await app.until(()=>app.$('song-lobby').dataset.previewStatus==='choice'&&!choice.disabled);assert.match(app.$('preview-status').textContent,/could not be prepared.*Retry/);assert.equal(admittedGates(app).length,0);assert.equal(server.requests.filter(r=>r.path==='/api/library/runtime').length,1);
  server.setRoute(({path})=>path==='/api/library/runtime'?nativeResponse(response()):undefined);
  await app.click('vsq-choose-base-notes');await app.until(()=>!app.$('configure-song-mod').disabled);assert.equal(admittedGates(app).length,0);assert.equal(app.document.body.dataset.screen,'library');
  await app.click('configure-song-mod');await app.click('song-mod-all-machine');const sound=app.$('song-mod-parts').querySelector('[data-mod-instrument]');assert.equal(sound.disabled,false);sound.value='reed';app.emit(sound,'change');await app.click('song-mod-apply');await app.until(()=>!app.$('song-mod-dialog').open&&!app.$('start-performance').disabled);await app.click('start-performance');await app.until(()=>app.$('clean-song-stage').dataset.rendererState==='playing');
  assert.equal(admittedGates(app).length,2);assert.equal(app.$('session-mode').value,'listen');assert.ok(connectedReceivers(app)[0].core.plan.timbreProfile);assert.ok([...connectedReceivers(app)[0].core.plan.timbres].some(Boolean));assert.equal(app.$('start-listen').hidden,true);assert.equal(app.$('vsq-listen-basic').hidden,true);
  for(const locale of ['zh-CN','en']){i18n.setLocale(locale);assert.equal(app.$('start-performance').textContent,locale==='en'?'Start performance':'开始演奏');assert.match(app.$('clean-song-stage-status').textContent,locale==='en'?/pitched synthesis/:/有音高合成/);}
  await app.click('back-to-library');app.savedButton(storageKey).click();await app.until(()=>app.$('song-lobby').dataset.previewStatus==='choice');assert.equal(app.$('start-performance').disabled,true);assert.equal(server.requests.filter(r=>r.path==='/api/library/runtime').length,2,'Reload cannot silently accept the renderer again');
  app.document.querySelector('#catalog [data-score-id]').click();await app.until(()=>app.$('song-lobby').dataset.previewStatus==='ready'&&app.$('clean-song-preview').hidden);assert.equal(app.$('start-listen').hidden,true);assert.equal(app.$('start-performance').hidden,false);
 }finally{await app.close();}
});
