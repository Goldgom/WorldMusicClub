import test from 'node:test';
import assert from 'node:assert/strict';
import {directMidiFixtures,directMidiDigest,DIRECT_MIDI_POLICY} from '../scripts/prepare-direct-midi-fixtures.mjs';
import {validateDirectMidiImport,validateDirectMidiOpened,validateDirectMidiTake,directMidiAudioOracle,directMidiFixtureMetadata,validateDirectMidiPackageIdentity} from '../scripts/direct-midi-proof.mjs';

// Deliberately constructed validator unit inputs. These are not Rust responses
// and cannot be used as browser, native process or AudioWorklet evidence.
const fixture=directMidiFixtures().boundary;
function opened(){
 const source={format:'midi',bytes:fixture.bytes.length,sha256:fixture.manifest.sha256},coverage={source_tracks:1,source_events:fixture.manifest.source_events,represented_events:fixture.manifest.source_events,key_attacks:4,key_releases:4};
 const score={source,performance:{source_format:0,ppq:384,tracks:fixture.tracks.map((events,source_index)=>({events:structuredClone(events),source_index}))},coverage};
 const score_json=JSON.stringify(score),metadata=directMidiFixtureMetadata(score_json,fixture),metadata_json=JSON.stringify(metadata),identity=directMidiDigest(JSON.stringify(metadata)),key=`song-${identity}`;
 return{entry:{key},clean_package:{profile:'wmh-basic-keys-midi1-v1',content_sha256:identity,score_json,metadata_json,coverage,runtime:{profile:'wmh-basic-key-practice-v2',source_sha256:source.sha256,rendition:{policy_id:DIRECT_MIDI_POLICY,coverage:{source_attacks:4},duration_ms:2000,notes:[[],[],[],[]]},compilation:{timeline:{notes:fixture.expectedNotes.map(n=>[n.id,'midi-t1-c1-r0',n.midi,n.velocity,n.start_ms,n.duration_ms])}}}}};
}
function importReport(){const identity=opened().clean_package.content_sha256,key=`song-${identity}`;return{format:'worldmusichub-import-report',version:1,mode:'commit',source:{filename:fixture.filename,bytes:fixture.bytes.length,sha256:fixture.manifest.sha256,retained:true,archive_key:'original-authored'},items:[{status:'saved',entry:{key},clean_package:{profile:'wmh-basic-keys-midi1-v1',content_sha256:identity,coverage:{key_attacks:4}}}],warnings:['Explicit FIFO rendition retained']};}
function take(){return{passes:[{inputs:[],captures:[],interpretation:{policy_id:DIRECT_MIDI_POLICY},timeline:{notes:structuredClone(fixture.expectedNotes)}}],target_plan:{source_note_count:4,target_count:4,timeline:{notes:structuredClone(fixture.expectedNotes)}}};}

test('direct MIDI proof rejects lost original bytes, changed policy, source events and shortened targets',()=>{
 validateDirectMidiOpened(opened(),fixture);validateDirectMidiImport(importReport(),fixture);validateDirectMidiTake(take(),fixture);
 for(const mutate of [o=>o.entry.key=`song-${'b'.repeat(64)}`,o=>o.clean_package.runtime.rendition.policy_id='guessed',o=>o.clean_package.runtime.compilation.timeline.notes.pop(),o=>o.clean_package.runtime.compilation.timeline.notes[1][0]='midi-t1-e7',o=>o.clean_package.runtime.compilation.timeline.notes[0][5]=249,o=>o.clean_package.runtime.compilation.timeline.notes.at(-1)[2]=71,o=>o.clean_package.coverage.represented_events--]){const value=opened();mutate(value);assert.throws(()=>validateDirectMidiOpened(value,fixture));}
 for(const change of [s=>s.performance.tracks[0].events.splice(1,1),s=>s.performance.tracks[0].events[8][1][2]=61,s=>s.performance.tracks[0].events.reverse(),s=>s.source.bytes--]){const value=opened(),score=JSON.parse(value.clean_package.score_json);change(score);value.clean_package.score_json=JSON.stringify(score);const metadata=directMidiFixtureMetadata(value.clean_package.score_json,fixture);value.clean_package.metadata_json=JSON.stringify(metadata);value.clean_package.content_sha256=directMidiDigest(JSON.stringify(metadata));value.entry.key=`song-${value.clean_package.content_sha256}`;assert.throws(()=>validateDirectMidiOpened(value,fixture));}
 for(const mutate of [r=>r.source.retained=false,r=>r.source.sha256='0'.repeat(64),r=>r.items[0].status='retained_nonplayable',r=>r.items[0].clean_package.coverage.key_attacks--,r=>r.warnings=[]]){const value=importReport();mutate(value);assert.throws(()=>validateDirectMidiImport(value,fixture));}
 for(const mutate of [t=>t.passes[0].timeline.notes.pop(),t=>t.passes[0].inputs.push({midi:60}),t=>t.passes[0].captures.push({event_id:1}),t=>t.target_plan.target_count=3,t=>t.passes[0].interpretation.policy_id='canonical']){const value=take();mutate(value);assert.throws(()=>validateDirectMidiTake(value,fixture));}
});
test('sample-frame audio oracle independently names every original attack including the late tail',()=>{
 const rows=directMidiAudioOracle(fixture);assert.deepEqual(rows.map(row=>row.eventId),[6,7,10,12].map(index=>`midi:${fixture.manifest.sha256}:t0:e${index}`));assert.deepEqual(rows.map(row=>[row.key,row.startMs,row.durationMs]),[[60,0,250],[60,250,250],[67,750,250],[72,1500,500]]);
});

test('hosted companion is guarded, preserves the raw picker path and never substitutes generated package admission',async()=>{
 const {readFile}=await import('node:fs/promises'),source=await readFile(new URL('../scripts/hosted-midi-direct-import-check.mjs',import.meta.url),'utf8');
 assert.ok(source.indexOf("assert.equal(process.env.GITHUB_ACTIONS,'true'")<source.indexOf('await startHostedAssetServer('));assert.ok(source.indexOf("assert.equal(process.env.WMH_HOSTED_BROWSER,'1')")<source.indexOf('await startHostedAssetServer('));assert.match(source,/await\(await chooser\)\.setFiles/);assert.match(source,/createHostedNativeBridge/);assert.match(source,/await owned\.driver\.fetcher/);assert.doesNotMatch(source,/\/api\/clean-song\/draft|zip_base64|setInputFiles|dispatchEvent\(/);
 const direct=source.slice(source.indexOf('async function directStart('),source.indexOf('\n try{\n  report.asset_server'));
 assert.match(direct,/#start-performance'\)\.click\(\)/);assert.doesNotMatch(direct,/configureSongMod|startSongModPerformance|song-mod-all-human/);assert.match(source,/native_window:false/);assert.match(source,/physical_audio:false/);
});

test('hosted repeated raw picker reuses the still-open import dialog after a rejected source',async()=>{
 const {readFile}=await import('node:fs/promises'),source=await readFile(new URL('../scripts/hosted-midi-direct-import-check.mjs',import.meta.url),'utf8');
 const picker=source.slice(source.indexOf('async function chooseRaw('),source.indexOf('async function downloadTake('));
 assert.match(picker,/if\(!await page\.locator\('#import-tools-dialog'\)\.evaluate\(dialog=>dialog\.open\)\)await page\.locator\('#import-tools-button'\)\.click\(\)/);
 assert.match(picker,/await page\.locator\('#import-button'\)\.click\(\)/);
});

test('original package identity is independently reconstructed from complete typed metadata',()=>{
 const value=opened(),clean=value.clean_package,metadata=JSON.parse(clean.metadata_json),identity=clean.content_sha256;
 assert.equal(validateDirectMidiPackageIdentity(clean,fixture),identity);
 const reverse=value=>Array.isArray(value)?value.map(reverse):value&&typeof value==='object'?Object.fromEntries(Object.entries(value).reverse().map(([key,item])=>[key,reverse(item)])):value;
 const pretty={...clean,metadata_json:JSON.stringify(reverse(metadata),null,2)};
 assert.notEqual(directMidiDigest(pretty.metadata_json),identity,'Raw whitespace/key order must not define identity');
 assert.equal(validateDirectMidiPackageIdentity(pretty,fixture),identity);validateDirectMidiOpened({...value,clean_package:pretty},fixture);
 for(const hash of ['a'.repeat(64),directMidiDigest(pretty.metadata_json)]){
  const forged=structuredClone(value);forged.clean_package={...pretty,content_sha256:hash};forged.entry.key=`song-${hash}`;
  assert.throws(()=>validateDirectMidiOpened(forged,fixture),/Package identity/,'Coherent but invented key and digest must fail');
 }
 for(const mutate of [m=>delete m.version,m=>m.version='2',m=>m.version=1,m=>m.extra=true,m=>m.id='another-song',m=>m.title='another-title.mid',m=>m.score.bytes=String(m.score.bytes),m=>m.score.path='../score.json',m=>m.score.extra=true,m=>m.sources[0].bytes++,m=>m.sources.push(m.sources[0]),m=>delete m.rights.license,m=>m.rights.license='CC0-1.0',m=>m.rights.status='original_authored',m=>m.rights.extra=true,m=>m.media.push({id:'unrequested'})]){
  const forged=structuredClone(value),changed=JSON.parse(forged.clean_package.metadata_json);mutate(changed);forged.clean_package.metadata_json=JSON.stringify(changed);forged.clean_package.content_sha256=directMidiDigest(JSON.stringify(changed));forged.entry.key=`song-${forged.clean_package.content_sha256}`;
  assert.throws(()=>validateDirectMidiOpened(forged,fixture));
 }
 assert.throws(()=>validateDirectMidiPackageIdentity({...clean,metadata_json:clean.metadata_json.replace('{','{\"version\":2,')},fixture),/duplicate keys/);
 assert.throws(()=>validateDirectMidiPackageIdentity({...clean,metadata_json:clean.metadata_json.replace('\"version\":2','\"version\":2.0')},fixture),/JSON aliases/);
 assert.throws(()=>validateDirectMidiPackageIdentity({...clean,metadata_json:' '.repeat(16*1024+1)},fixture));
 assert.throws(()=>directMidiFixtureMetadata('x'.repeat(256*1024+1),fixture));
});
