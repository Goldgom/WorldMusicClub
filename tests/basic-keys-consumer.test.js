import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {prepareCleanSong,isBasicKeysSong,isBasicKeysSummary,basicKeysParts} from '../web/clean-song-package.js';
import {ScorePreview} from '../web/score-preview.js';
import {openScoreStorage} from '../web/native-score-storage.js';
import {CleanSongPlayer,inspectCleanRendition} from '../web/clean-song-player.js';
import {getAppI18n} from '../web/app-locale.js';
import {nativeScoreServer,nativeStorageApp,nativeResponse} from './native-storage-app-fixtures.js';
import {createBulkImportTransport} from '../web/bulk-import.js';
import {importFile,importReport,importItem} from './bulk-import-fixtures.js';
import {fakeAudio} from './clean-song-fixtures.js';
const opened=()=>JSON.parse(readFileSync(new URL('./fixtures/basic-keys-native-open.json',import.meta.url),'utf8'));
function source(){const value=opened(),descriptor=value.clean_package,score=JSON.parse(descriptor.score_json).notation,key=`native:song-${descriptor.content_sha256}`;return{value,descriptor,score,key};}
function admitted(){const {descriptor,score,key}=source();return prepareCleanSong(key,descriptor,score);}
async function nativeFixture(){
  const {value,descriptor,score,key}=source(),server=await nativeScoreServer(),storageKey=key.slice(7);
  const summary={version:2,content_sha256:descriptor.content_sha256,profile:descriptor.profile,capabilities:descriptor.capabilities,coverage:descriptor.coverage,notation_available:true,media:[]};
  const entry={key:storageKey,revision:1,title:score.title,composer:score.composer,score_id:score.id,label:score.title,score_bytes:Buffer.byteLength(JSON.stringify(score)),saved_at_unix_ms:1700000000000,clean_package:summary};
  server.records.set(storageKey,{...value,entry});return{server,storageKey,key,summary,entry,descriptor,score};
}

test('basic-key admission preserves exact complete source bytes and separates target and source coverage',()=>{
  const song=admitted();assert.ok(isBasicKeysSong(song));assert.equal(song.score_json,source().descriptor.score_json);assert.equal(song.coverage.key_attacks,5);assert.equal(song.coverage.notation_notes,3);assert.equal(song.compilation.timeline.notes.length,2);assert.deepEqual(song.compilation.timeline.notes.map(note=>note.midi),[60,72]);assert.deepEqual(song.notation.meters,[]);assert.deepEqual(song.notation.tempo,[]);
  const inventory=basicKeysParts(song);assert.equal(inventory.reduce((sum,part)=>sum+part.attacks,0),5);assert.equal(inventory.reduce((sum,part)=>sum+part.unresolved,0),1);assert.equal(inventory.reduce((sum,part)=>sum+part.instantaneous,0),1);assert.equal(inventory.filter(part=>part.percussion).reduce((sum,part)=>sum+part.attacks,0),1);assert.ok(inventory.filter(part=>part.percussion).every(part=>!part.practice_available));
  for(const note of song.compilation.timeline.notes){assert.equal(note.id,note.source_note_id);assert.deepEqual(note.source_note_ids,[note.id]);assert.ok(/^midi-t[0-9]+-e[0-9]+$/.test(note.id));}
  assert.equal(inspectCleanRendition(song).supported,false);const player=new CleanSongPlayer({getPositionMs:()=>0});player.select(song);assert.throws(()=>player.start(fakeAudio()),{code:'clean_renderer_unsupported'});player.destroy();
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
    assert.equal(app.$('count-in').disabled,true);assert.equal(app.$('notation-part').value,'');assert.equal(app.document.querySelectorAll('#clean-song-parts input').length,inventory.length);assert.ok([...app.document.querySelectorAll('#clean-song-parts input')].every(input=>input.disabled));assert.equal(app.audioNodes.filter(node=>node.kind==='oscillator'&&!node.disconnected).length,0);
    await app.click('play-button');const take=await app.exported('export-takes');assert.equal(take.passes[0].timeline.notes.length,1);assert.equal(take.passes[0].timeline.notes[0].midi,60);assert.deepEqual(take.passes[0].inputs,[]);assert.equal(server.requests.filter(request=>request.path==='/api/library/runtime').length,0);
    await app.click('reset-button');assert.equal(app.audioNodes.filter(node=>node.kind==='oscillator'&&!node.disconnected).length,0);
  }finally{await app.close();}
});
