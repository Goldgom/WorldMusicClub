import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {preparePerformanceSong,isPerformanceSong,isPerformanceSummary,isCleanSong,prepareCleanSong} from '../web/clean-song-package.js';
import {openScoreStorage} from '../web/native-score-storage.js';
import {createCleanPerformancePlayer} from '../web/clean-performance-player.js';
import {nativeScoreServer} from './native-storage-app-fixtures.js';
const original=JSON.parse(await readFile(new URL('./fixtures/complete-performance-v2-native-open.json',import.meta.url)));
const key=`native:${original.entry.key}`;
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const clone=()=>structuredClone(original);
const prepare=record=>preparePerformanceSong(key,record.clean_package,record.score_json);
function changeScore(record,edit){const d=record.clean_package,score=JSON.parse(d.score_json),metadata=JSON.parse(d.metadata_json);edit(score,d.runtime,metadata);d.score_json=JSON.stringify(score);metadata.score.bytes=Buffer.byteLength(d.score_json);metadata.score.sha256=sha(d.score_json);d.runtime.score_sha256=metadata.score.sha256;d.metadata_json=JSON.stringify(metadata);return record;}

test('native typed admission retains all eleven tracks, independent commands and explicit null notation',async()=>{
 const song=await prepare(clone());assert.ok(isPerformanceSong(song));assert.ok(isCleanSong(song));assert.ok(isPerformanceSummary(original.entry.clean_package));assert.equal(song.notation,null);assert.equal(song.compilation,null);assert.equal(song.reference.playable,true);assert.equal(song.reference.trackCount,11);assert.equal(song.reference.voices.length,20);assert.equal(song.reference.tracks[0].channels.length,0);assert.equal(song.score.coverage.targets.represented_attacks,0);assert.equal(song.score.performance.events.filter(e=>e.command.kind==='key_attack').length,20);assert.equal(song.score.performance.events.some(e=>'duration'in e.command),false);assert.ok(Object.isFrozen(song.runtime.events[0]));assert.equal(isPerformanceSong(structuredClone(song)),false);assert.throws(()=>prepareCleanSong(key,original.clean_package,null),{code:'clean_package_invalid'});
});
test('native admission binds source, title, exact clean bytes, all runtime events and declared media',async()=>{
 const edits=[r=>r.score_json='{}',r=>r.clean_package.profile='wmh-semantic-midi1-v1',r=>r.clean_package.runtime.events.pop(),r=>r.clean_package.runtime.score_id='wrong',r=>r.clean_package.runtime.source_sha256='0'.repeat(64),r=>r.clean_package.runtime.tracks.pop(),r=>r.clean_package.media[0].parts=['missing'],r=>r.clean_package.media[0].path='media/stem.wav',r=>{const m=JSON.parse(r.clean_package.metadata_json);m.title='Wrong';r.clean_package.metadata_json=JSON.stringify(m);},r=>{const m=JSON.parse(r.clean_package.metadata_json);m.sources[0].sha256='0'.repeat(64);r.clean_package.metadata_json=JSON.stringify(m);},r=>{const s=JSON.parse(r.clean_package.score_json);s.title='Changed without hash';r.clean_package.score_json=JSON.stringify(s);}];
 for(const edit of edits){const record=clone();edit(record);await assert.rejects(prepare(record));}
 const modified=clone();modified.clean_package.score_json+=' ';await assert.rejects(prepare(modified));
 const whitespace=clone();whitespace.clean_package.score_json+=' ';const m=JSON.parse(whitespace.clean_package.metadata_json);m.score.bytes++;whitespace.clean_package.metadata_json=JSON.stringify(m);await assert.rejects(prepare(whitespace),{code:'score_hash_mismatch'});
});
test('preserved unsupported semantics remain admitted but block reference playback',async()=>{
 const record=changeScore(clone(),(score,runtime)=>{for(const list of [score.performance.events,runtime.events]){const event=list.find(e=>e.command.kind==='instrument_program');event.command={kind:'channel_pressure',channel:event.command.channel,pressure:80};}});
 const song=await prepare(record);assert.ok(isPerformanceSong(song));assert.equal(song.reference.playable,false);assert.ok(song.reference.blockers.some(b=>b.code==='unsupported_channel_pressure'));assert.throws(()=>createCleanPerformancePlayer(song.reference,{contextFactory:()=>{throw Error('never')}}),{code:'playback_blocked'});assert.equal(song.score.performance.tracks.length,11);assert.equal(song.notation,null);
});
test('native storage skips canonical compilation for null notation and retains export/media access',async()=>{
 const server=await nativeScoreServer();server.records.set(original.entry.key,clone());let compileCalls=0;
 const storage=await openScoreStorage({fetcher:server.fetcher,origin:'https://wmh.localhost',validateScore:()=>{compileCalls++;throw Error('must not compile null notation')}});
 const loaded=await storage.load(key);assert.equal(loaded.score,null);assert.equal(loaded.score_json,null);assert.ok(isPerformanceSong(loaded.cleanSong));assert.equal(compileCalls,0);assert.equal((await storage.list()).entries[0].clean_package.notation_available,false);await assert.rejects(storage.chooseVsqPractice(loaded.cleanSong),{code:'library_runtime_choice'});await assert.rejects(storage.exportBackup(),{code:'clean_pack_export_required'});
 const media=await readFile(new URL('./fixtures/complete-performance-v2/media/stem.wav',import.meta.url));server.setRoute(({path})=>path==='/api/library/asset'?{ok:true,url:'https://wmh.localhost/api/library/asset',redirected:false,headers:{get:()=> 'audio/wav'},arrayBuffer:async()=>Uint8Array.from(media).buffer}:undefined);assert.equal((await storage.loadAsset(key,loaded.cleanSong.media[0].handle)).size,media.length);storage.close();
});
test('native storage requires explicit unavailable notation and matching performance summary',async()=>{
 for(const edit of [r=>r.score_json='null',r=>r.entry.clean_package.notation_available=true,r=>r.entry.clean_package.coverage.targets.represented_attacks=1]){const server=await nativeScoreServer(),record=clone();edit(record);server.records.set(original.entry.key,record);const storage=await openScoreStorage({fetcher:server.fetcher,origin:'https://wmh.localhost'});try{await assert.rejects(storage.load(key),{code:'library_invalid_response'});}finally{storage.close();}}
});

test('optional media nulls omitted by native serde preserve the declared cover binding',async()=>{
 const record=clone(),metadata=JSON.parse(record.clean_package.metadata_json);
 // Reuse the repository's original one-pixel authored PNG descriptor.
 const png=Buffer.from([137,80,78,71,13,10,26,10,0,0,0,13,73,72,68,82,0,0,0,1,0,0,0,1,8,6,0,0,0,31,21,196,137,0,0,0,13,73,68,65,84,120,156,99,96,96,96,248,15,0,1,4,1,0,95,229,195,75,0,0,0,0,73,69,78,68,174,66,96,130]);
 const asset={id:'cover',role:'cover',mime:'image/png',bytes:png.length,sha256:sha(png)};
 metadata.media.push({...asset,path:'media/cover.png',rights:{status:'original_authored',attribution:'Original test pixel',license:'CC0-1.0'},parts:null,offset_ms:null});
 record.clean_package.metadata_json=JSON.stringify(metadata);record.clean_package.media.push({...asset,handle:`asset-${sha('authored-cover-handle')}`});
 assert.equal((await prepare(record)).media.length,2);
});
