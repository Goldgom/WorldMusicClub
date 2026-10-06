// Fresh Rust dispatch + actual app/Mod/audio cores, with original fixtures only.
// Native protocol is stdio. This is not browser/device/Windows acceptance.
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {mkdtemp,rm,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {canonicalPracticeFixture,CANONICAL_PRACTICE_FILES} from '../scripts/prepare-canonical-practice-fixtures.mjs';
import {basicKeyAcceptanceFixture,BASIC_KEY_FILES} from '../scripts/prepare-basic-key-fixtures.mjs';
import {vsqAcceptanceFixture} from '../scripts/prepare-vsq-song-fixtures.mjs';
import {startVsqNativeDriver} from './vsq-native-driver-fixtures.js';
import {nativeStorageApp} from './native-storage-app-fixtures.js';
import {setMod,applyMod,renderer,startPerformance} from './cross-mode-performance-fixtures.js';
import {readPlaybackClock} from '../web/playback-clock-view.js';

const binary=process.env.WMH_NATIVE_IMPORT_DRIVER;
assert.ok(binary,'Set WMH_NATIVE_IMPORT_DRIVER to a driver built from this source');
const directory=await mkdtemp(join(tmpdir(),'wmh-cross-mode-audit-')),driver=startVsqNativeDriver({binary,directory}),sources={},requests=[];
let app,clock=1000;
const report={source_sha:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),driver_sha256:createHash('sha256').update(await readFile(binary)).digest('hex'),transport_sha256:createHash('sha256').update(await readFile(new URL('../web/transport.js',import.meta.url))).digest('hex'),browser:false,native_window:false,physical_audio:false,transitions:[]};
const request=async(path,body,type='application/json',headers={})=>{
  const response=await driver.fetcher(path,{method:body===undefined?'GET':'POST',headers:{'Content-Type':type,...headers},body:body===undefined?undefined:type==='application/json'?JSON.stringify(body):body});
  const value=await response.json();assert.equal(response.status,200,`${path}: ${JSON.stringify(value)}`);return value;
};
try{
  const canonical=canonicalPracticeFixture(),xml=canonical.files.get(CANONICAL_PRACTICE_FILES.musicxml);
  for(const [name,compiled]of [['json',await request('/api/compile',canonical.score)],['xml',await request('/api/import/musicxml',xml,'application/xml')]]){
    const saved=await request('/api/library/save',{score_json:JSON.stringify(compiled.score),label:null,allow_conflicting_id:false});
    sources[name]={key:saved.key,score:compiled.score,profile:await request('/api/canonical-audio-profile',compiled.score)};
  }
  assert.equal(sources.xml.score.source.content,xml.toString(),'MusicXML retains the exact supplied original');
  for(const [name,fixture,filename]of [['basic',basicKeyAcceptanceFixture(),BASIC_KEY_FILES.valid],['vsq',vsqAcceptanceFixture(),'original-vsq.zip']]){
    const saved=await request('/api/library/import/commit',fixture.bytes,'application/zip',{'X-WMH-Filename':filename});
    assert.equal(saved.summary.saved,1);const key=saved.items[0].entry.key,opened=await request('/api/library/load',{key});
    sources[name]={key,score:JSON.parse(opened.clean_package.score_json).notation,original:opened.clean_package.score_json};
  }
  const fetcher=async(path,options={})=>{
    requests.push({path,body:typeof options.body==='string'?JSON.parse(options.body):null});
    const response=await driver.fetcher(path,options),bytes=await response.bytes();
    return{...response,url:'https://wmh.localhost'+path,redirected:false,headers:new Headers({'Content-Type':response.contentType}),json:async()=>JSON.parse(bytes),text:async()=>bytes.toString(),blob:async()=>new Blob([bytes],{type:response.contentType})};
  };
  app=await nativeStorageApp({fetcher,requests},{now:()=>clock});await app.until(()=>Object.values(sources).every(source=>app.savedButton(source.key)));await app.click('home-single-player');
  app.$('count-in').checked=false;
  for(const name of ['json','basic','xml','vsq','json']){
    const mode=['json','xml'].includes(name)?'canonical':name,source=sources[name];
    if(app.document.body.dataset.screen==='stage')await app.click('back-to-library');
    const runtimeRequests=requests.filter(row=>row.path==='/api/library/runtime').length;
    app.savedButton(source.key).click();await app.until(()=>app.$('preview-title').textContent===source.score.title&&app.$('song-lobby').dataset.previewStatus===(name==='vsq'?'choice':'ready'));
    if(name==='vsq'){
      assert.equal(app.$('start-performance').disabled,true);assert.equal(app.$('vsq-full-vocal').disabled,true);
      assert.equal(requests.filter(row=>row.path==='/api/library/runtime').length,runtimeRequests);
      await app.click('vsq-choose-base-notes');await app.until(()=>!app.$('configure-song-mod').disabled);
      assert.equal(requests.filter(row=>row.path==='/api/library/runtime').length,runtimeRequests+1);
    }
    await app.click('configure-song-mod');await app.click('song-mod-all-machine');setMod(app,'performer',source.score.parts[0].id,'human');await applyMod(app);await startPerformance(app,mode);
    clock+=120;app.renderAudioTo((clock-1000)/1000);app.frame();await app.click('play-button');await app.until(()=>!app.$('play-button').disabled);
    const before=await app.exported('export-takes');assert.equal(before.passes.length,1);assert.deepEqual(before.passes[0].inputs,[]);assert.deepEqual(before.passes[0].captures,[]);assert.equal(before.song_mod.songId,source.score.id);
    assert.ok(before.passes[0].timeline.notes.every(note=>note.part_id===source.score.parts[0].id));
    await app.click('edit-song-mod');setMod(app,'visible',source.score.parts[1].id,false);setMod(app,'mute',source.score.parts[1].id,true);await applyMod(app);
    const after=await app.exported('export-takes');assert.deepEqual(after.passes,before.passes);assert.deepEqual(after.target_plan,before.target_plan);
    const pausedPosition=readPlaybackClock(app.$('progress')).positionMs;
    await app.click('play-button');await app.until(()=>renderer(app,mode).dataset.rendererState==='playing');assert.equal((await app.exported('export-takes')).passes.length,1);
    await app.click('play-button');await app.until(()=>!app.$('play-button').disabled);
    const rapidPausePosition=readPlaybackClock(app.$('progress')).positionMs;
    report.transitions.push({source:name,score_id:source.score.id,target_count:after.target_plan.target_count,history_isolated:true,display_mute_preserves_take:true,rapid_resume_pause:{before_ms:pausedPosition,after_ms:rapidPausePosition,ok:Math.abs(pausedPosition-rapidPausePosition)<=.125}});
  }
  await app.until(()=>!app.$('play-button').disabled);
  const original=await app.exported('export-button'),beforeTranspose=await app.exported('export-takes');
  await app.click('transposition-button');app.$('transposition-semitones').value='2';app.emit(app.$('transposition-semitones'),'input');await app.click('transposition-preview');
  await app.until(()=>!app.$('transposition-result').hidden,'Native transposition preview');
  assert.deepEqual(await app.exported('export-button'),original,'Preview cannot mutate the active score');
  app.$('transposition-confirm').checked=true;app.emit(app.$('transposition-confirm'),'change');await app.click('transposition-activate');
  await app.until(()=>!app.$('transposition-dialog').open&&app.$('score-title').textContent!==original.title);
  const transposed=await app.exported('export-button'),transposedTake=await app.exported('export-takes');
  assert.deepEqual(JSON.parse(transposed.source.content).original,original);assert.equal(transposedTake.passes.length,0);
  assert.notEqual(transposedTake.song_mod.sourceRevision.value,beforeTranspose.song_mod.sourceRevision.value);
  assert.deepEqual(transposedTake.song_mod.config,beforeTranspose.song_mod.config);
  await app.click('transposition-button');await app.click('transposition-restore-preview');
  await app.until(()=>app.$('transposition-status').textContent.startsWith('Original preview ready'));
  app.$('transposition-confirm').checked=true;app.emit(app.$('transposition-confirm'),'change');await app.click('transposition-activate');
  await app.until(()=>!app.$('transposition-dialog').open&&app.$('score-title').textContent===original.title);
  assert.deepEqual(await app.exported('export-button'),original);report.transpose_restore=true;
  for(const source of Object.values(sources).filter(value=>value.original))assert.equal((await request('/api/library/load',{key:source.key})).clean_package.score_json,source.original);
  report.ok=report.transitions.every(row=>row.rapid_resume_pause.ok);
}finally{await app?.close();await driver.close();await rm(directory,{recursive:true,force:true});}
console.log(JSON.stringify(report,null,2));
assert.equal(report.ok,true,'A source profile rewound during the future audio anchor; see rapid_resume_pause');
