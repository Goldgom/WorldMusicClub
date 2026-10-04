import {basicKeyNotationRequest,basicKeyNotationPage} from '../web/basic-key-notation.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {prepareCleanSong,isBasicKeysSong,isBasicKeysSummary,basicKeysParts} from '../web/clean-song-package.js';
import {setupPianoFingering} from '../web/piano-fingering.js';
import {setupGuitarFingering} from '../web/guitar-fingering.js';
import {fingeringSource} from '../web/fingering-source.js';
import {ScorePreview} from '../web/score-preview.js';
import {openScoreStorage} from '../web/native-score-storage.js';
import {CleanSongPlayer,inspectCleanRendition} from '../web/clean-song-player.js';
import {getAppI18n} from '../web/app-locale.js';
import {nativeScoreServer,nativeStorageApp,nativeResponse} from './native-storage-app-fixtures.js';
import {createBulkImportTransport} from '../web/bulk-import.js';
import {importFile,importReport,importItem} from './bulk-import-fixtures.js';
import {fakeAudio} from './clean-song-fixtures.js';
const opened=()=>JSON.parse(readFileSync(new URL('./fixtures/basic-keys-native-open.json',import.meta.url),'utf8'));
function source(value=opened()){const descriptor=value.clean_package,score=JSON.parse(descriptor.score_json).notation,key=`native:song-${descriptor.content_sha256}`;return{value,descriptor,score,key};}
function admitted(){const {descriptor,score,key}=source();return prepareCleanSong(key,descriptor,score);}
async function nativeFixture(openValue){
  const {value,descriptor,score,key}=source(openValue),server=await nativeScoreServer(),storageKey=key.slice(7);
  const summary={version:2,content_sha256:descriptor.content_sha256,profile:descriptor.profile,capabilities:descriptor.capabilities,coverage:descriptor.coverage,notation_available:true,media:[]};
  const entry={key:storageKey,revision:1,title:score.title,composer:score.composer,score_id:score.id,label:score.title,score_bytes:Buffer.byteLength(JSON.stringify(score)),saved_at_unix_ms:1700000000000,clean_package:summary};
  server.records.set(storageKey,{...value,entry});return{server,storageKey,key,summary,entry,descriptor,score};
}

test('basic-key admission preserves exact complete source bytes and separates target and source coverage',async()=>{
  const song=admitted();assert.ok(isBasicKeysSong(song));assert.equal(song.score_json,source().descriptor.score_json);assert.equal(song.coverage.key_attacks,5);assert.equal(song.coverage.notation_notes,3);assert.equal(song.compilation.timeline.notes.length,2);assert.deepEqual(song.compilation.timeline.notes.map(note=>note.midi),[60,72]);assert.deepEqual(song.notation.meters,[]);assert.deepEqual(song.notation.tempo,[]);
  const inventory=basicKeysParts(song);assert.equal(inventory.reduce((sum,part)=>sum+part.attacks,0),5);assert.equal(inventory.reduce((sum,part)=>sum+part.unresolved,0),1);assert.equal(inventory.reduce((sum,part)=>sum+part.instantaneous,0),1);assert.equal(inventory.filter(part=>part.percussion).reduce((sum,part)=>sum+part.attacks,0),1);assert.ok(inventory.filter(part=>part.percussion).every(part=>!part.practice_available));
  for(const note of song.compilation.timeline.notes){assert.equal(note.id,note.source_note_id);assert.deepEqual(note.source_note_ids,[note.id]);assert.ok(/^midi-t[0-9]+-e[0-9]+$/.test(note.id));}
  assert.equal(inspectCleanRendition(song).supported,false);const player=new CleanSongPlayer({getPositionMs:()=>0});player.select(song);await assert.rejects(player.start(fakeAudio()),{code:'clean_renderer_unsupported'});player.destroy();
});

test('native basic-key runtime rejects missing parts, forged targets, percussion targets and inconsistent coverage',()=>{
  for(const mutate of [d=>d.runtime.parts.pop(),d=>d.coverage.unresolved_ends=0,d=>d.runtime.compilation.timeline.notes.pop(),d=>d.runtime.compilation.timeline.notes[0].source_note_ids=['wrong'],d=>d.runtime.source_sha256='b'.repeat(64),d=>d.runtime.parts.find(p=>p.percussion).percussion=false,d=>d.runtime.compilation.timeline.notes[0].duration_ms=0,d=>d.runtime.compilation=null,d=>d.runtime.reference_audio='available']){const {descriptor,score,key}=source();mutate(descriptor);assert.throws(()=>prepareCleanSong(key,descriptor,score),{code:'clean_package_invalid'});}
});

test('basic-key selection admits practice without reference listening and keeps percussion visible but ineligible',async()=>{
  const song=admitted(),inventory=basicKeysParts(song),preview=new ScorePreview({compile:()=>{throw Error('Do not compile basic notation through ordinary defaults');},check:async()=>({status:'ready'})});
  await preview.select(song.libraryKey,async()=>({score:song.notation,cleanSong:song}));assert.equal(preview.canStart('listen'),false);assert.equal(preview.canStart('practice'),true);
  await preview.select(song.libraryKey,async()=>({score:song.notation,cleanSong:song}),{part:inventory.find(part=>part.percussion).id});assert.equal(preview.canStart('practice'),false);assert.equal(preview.value.score.parts.length,song.notation.parts.length);assert.equal(preview.value.compatibility.status,'blocked');
});

test('native basic-key load skips ordinary canonical compilation, and export requires the complete package',async()=>{
  const {server,key,descriptor}=await nativeFixture();let validations=0;const storage=await openScoreStorage({fetcher:server.fetcher,origin:'https://wmh.localhost',validateScore:async()=>{validations++;throw Error('No substitute clock');}});
  try{const loaded=await storage.load(key);assert.ok(isBasicKeysSong(loaded.cleanSong));assert.equal(validations,0);assert.equal(loaded.cleanSong.score_json,descriptor.score_json);await assert.rejects(storage.exportBackup(),{code:'clean_pack_export_required'});}finally{storage.close();}
});

test('basic-key saved and duplicate rows are recognized without claiming automatic playback',async()=>{
  const {summary,entry}=await nativeFixture(),file=importFile('original-basic-keys.zip','synthetic');assert.ok(isBasicKeysSummary(summary));
  for(const status of ['saved','duplicate']){let complete=summary;const transport=createBulkImportTransport({origin:'https://wmh.localhost',fetcher:async()=>nativeResponse(importReport(file,{mode:'commit',items:[importItem({status,playable:false,entry:{key:entry.key},clean_package:complete})]}))});assert.equal((await transport.commit(file)).items[0].playable,false);complete={...summary,coverage:{...summary.coverage,represented_events:0}};await assert.rejects(transport.commit(file),{code:'pack_invalid_response'});}
});

test('ordinary app shows every key part and exact coverage, then grades only selected human targets without machine audio',async()=>{
  const {server,storageKey}=await nativeFixture(),app=await nativeStorageApp(server);
  try{
    await app.until(()=>app.savedButton(storageKey)&&!app.$('start-listen').disabled);await app.click('home-single-player');app.savedButton(storageKey).click();await app.until(()=>app.$('song-lobby').dataset.previewStatus==='ready'&&!app.$('start-practice').disabled);
    const inventory=basicKeysParts(admitted()),percussion=inventory.find(part=>part.percussion);
    assert.equal(app.$('start-listen').disabled,true);assert.equal(app.$('preview-part').children.length,inventory.length);assert.equal(app.$('preview-part').querySelector(`option[value="${percussion.id}"]`).disabled,true);assert.match(app.$('clean-song-preview-status').textContent,/5 attacks.*3 positive determined.*1 instantaneous.*1 unresolved/);assert.match(app.$('clean-song-rendition').textContent,/120 BPM/);assert.equal(app.$('clean-song-tracks').children.length,4);
    getAppI18n(app.document).setLocale('zh-CN');assert.match(app.$('clean-song-rendition').textContent,/参考音频不可用/);assert.match(app.$('clean-song-preview-status').textContent,/未确定/);
    await app.click('start-practice');await app.until(()=>app.document.body.dataset.screen==='stage'&&app.$('clean-song-stage').dataset.rendererState==='key-practice-running');
    assert.equal(app.$('count-in').disabled,true);assert.equal(app.$('tempo').value,'120');assert.match(app.$('score-key').textContent,/源拍号未确定/);assert.equal(app.$('notation-part').value,inventory[0].id);assert.equal(app.document.querySelectorAll('#clean-song-parts input').length,inventory.length);assert.ok([...app.document.querySelectorAll('#clean-song-parts input')].every(input=>input.disabled));assert.equal(app.audioNodes.filter(node=>node.kind==='oscillator'&&!node.disconnected).length,0);
    await app.click('play-button');const take=await app.exported('export-takes');assert.equal(take.passes[0].timeline.notes.length,1);assert.equal(take.passes[0].timeline.notes[0].midi,60);assert.deepEqual(take.passes[0].inputs,[]);assert.equal(server.requests.filter(request=>request.path==='/api/library/runtime').length,0);
    const page=JSON.parse(readFileSync(new URL('./fixtures/basic-keys-notation-page.json',import.meta.url),'utf8'));server.setRoute(({path})=>path==='/api/library/basic-keys/notation'?nativeResponse(page.missing):undefined);
    const unlocks=app.audio().unlocks;await app.click('back-to-library');app.savedButton(storageKey).click();await app.until(()=>!app.$('open-score').disabled);await app.click('open-score');await app.until(()=>app.document.body.dataset.screen==='stage'&&app.$('workspace').dataset.scoreState==='inspection');
    const reopened=await app.exported('export-takes');assert.deepEqual(reopened.passes,take.passes,'Opening the same saved score retains the paused take');assert.equal(app.audio().unlocks,unlocks,'Inspection does not unlock or resume audio');
    assert.equal(app.$('export-jianpu').disabled,true);await app.click('export-jianpu');assert.equal(server.requests.filter(request=>request.path==='/api/export/jianpu').length,0);
    await app.click('reset-button');assert.equal(app.audioNodes.filter(node=>node.kind==='oscillator'&&!node.disconnected).length,0);
  }finally{await app.close();}
});


test('nominal MIDI keys report unsupported fingering without serializing scores or retrying requests',async()=>{
  const song=admitted(),context={cleanSong:song,score:song.notation,timeline:song.compilation.timeline,part_id:song.notation.parts[0].id,dirty:false,profile:{kind:'piano',key_count:88,lowest_midi:21}};
  let calls=0;const api=async()=>{calls++;throw Error('Unsupported fingering must not request the generic or native planner');};
  assert.throws(()=>fingeringSource(context),{code:'basic_keys_fingering_unavailable'});
  const piano=setupPianoFingering({api,getContext:()=>context});await piano.prepare();await piano.prepare({retry:true});
  assert.equal(piano.state().phase,'unavailable');assert.equal(piano.state().messageCode,'piano_basic_keys');assert.match(piano.state().message,/nominal MIDI key projections/);
  context.profile={kind:'guitar',tuning:[40,45,50,55,59,64],frets:24,capo:0};const guitar=setupGuitarFingering({api,getContext:()=>context});await guitar.prepare();await guitar.prepare({retry:true});
  assert.equal(guitar.state().phase,'unavailable');assert.equal(guitar.state().messageCode,'guitar_basic_keys');assert.equal(calls,0);
});


test('Open score admits a no-clock source for paused inspection without timeline, audio or assessment activation',async()=>{
 const data=JSON.parse(readFileSync(new URL('./fixtures/basic-keys-notation-no-clock.json',import.meta.url),'utf8'));
 const {server,key}=await nativeFixture(data.open);server.setRoute(({path,body})=>{if(path==='/api/library/basic-keys/notation'){assert.deepEqual(body,data.request);return nativeResponse(data.response);}});
 const app=await nativeStorageApp(server);
 try{
  await app.until(()=>app.savedButton(key.slice(7)));app.savedButton(key.slice(7)).click();await app.until(()=>!app.$('open-score').hidden&&!app.$('open-score').disabled);
  assert.equal(app.$('start-practice').disabled,true);assert.equal(app.$('start-listen').disabled,true);const before=server.requests.length;
  await app.click('open-score');await app.until(()=>app.document.body.dataset.screen==='stage'&&server.requests.some(request=>request.path==='/api/library/basic-keys/notation'));
  assert.equal(app.$('workspace').dataset.scoreState,'inspection');assert.equal(app.$('play-button').disabled,true);assert.equal(app.$('assess-button').disabled,true);assert.equal(app.$('progress').disabled,true);assert.match(app.$('time-label').textContent,/Source clock unavailable/);assert.match(app.$('stage-subtitle').textContent,/Score inspection/);assert.equal(app.audio().unlocks,0);
  assert.ok(server.requests.slice(before).every(request=>!['/api/compile','/api/assess','/api/practice-targets','/api/instrument-check','/api/export/musicxml'].includes(request.path)));
 }finally{await app.close();}
});


test('source-bound notation rejects substituted identities, key pitches, clock ranges and incomplete page coverage',()=>{
 const song=admitted(),data=JSON.parse(readFileSync(new URL('./fixtures/basic-keys-notation-page.json',import.meta.url),'utf8'));
 assert.deepEqual(basicKeyNotationRequest(song,{partId:data.request.settings.part_id,from:1,count:8,displayMeter:{numerator:4,denominator:4}}),data.request);
 assert.equal(basicKeyNotationPage(data.ready,data.request,song),data.ready.page);
 for(const change of [r=>r.source.content_sha256='0'.repeat(64),r=>r.page.source_sha256='0'.repeat(64),r=>r.page.part_id='other',r=>r.page.score.parts[0].notes[0].pitch.octave++,r=>r.page.score.parts[0].notes[0].id='other',r=>r.page.measures[0].start_ms++,r=>r.page.source_end_ms++,r=>r.page.coverage.rendered_positive_keys++,r=>r.page.coverage.part_attacks++]){
  const response=structuredClone(data.ready);change(response);assert.throws(()=>basicKeyNotationPage(response,data.request,song),{code:'basic_keys_notation_identity'});
 }
});
