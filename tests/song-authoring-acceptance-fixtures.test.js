// Original source bytes and actual captured Rust responses only. Mutation cases
// below are adversarial verifier tests, never native/browser acceptance reports.
import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFile,mkdtemp,readdir,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {AUTHORING_PAIR_ALIAS,AUTHORING_FIXTURE_FILENAMES,authoringAcceptanceFixtures,prepareSongAuthoringFixtures,validateAuthoringDraft,authoringDraftFingerprint} from '../scripts/prepare-song-authoring-fixtures.mjs';
import {assertAuthoringZip} from '../scripts/check-song-authoring-native.mjs';
import {storedZip} from './native-import-driver-fixtures.js';
const digest=value=>createHash('sha256').update(value).digest('hex');
const fixtures=authoringAcceptanceFixtures();
const read=name=>readFile(new URL(`./fixtures/song-authoring/${name}`,import.meta.url));
const captured=async id=>JSON.parse(await read(`acceptance-${id}-response.json`));

// Small independent Standard MIDI File reader for only this finite authored
// vocabulary. It reads raw event boundaries and absolute ticks, not note pairs,
// notation, conversion states, receiver semantics or runtime timing.
function readOriginal(bytes){
  assert.equal(bytes.toString('ascii',0,4),'MThd');assert.equal(bytes.readUInt32BE(4),6);assert.equal(bytes.readUInt16BE(8),1);assert.equal(bytes.readUInt16BE(12),480);
  const tracks=[];let offset=14;
  for(let track=0;track<bytes.readUInt16BE(10);track++){
    assert.equal(bytes.toString('ascii',offset,offset+4),'MTrk');const end=offset+8+bytes.readUInt32BE(offset+4);offset+=8;let tick=0;const events=[];
    const vlq=()=>{let value=0,n=0,b;do{assert.ok(offset<end&&n++<4);b=bytes[offset++];value=value*128+(b&127);}while(b&128);return value;};
    while(offset<end){tick+=vlq();const start=offset,status=bytes[offset++];assert.ok(status>=0x80);if(status===255){offset++;const length=vlq();offset+=length;}else offset+=(status&0xf0)===0xc0?1:2;assert.ok(offset<=end);events.push({tick,bytes:[...bytes.subarray(start,offset)]});}
    assert.deepEqual(events.at(-1),{tick:1920,bytes:[255,47,0]});tracks.push(events);
  }
  assert.equal(offset,bytes.length);return tracks;
}
test('finite deterministic original MIDI retains conductor, every route and outside-61-key notes',()=>{
  assert.deepEqual(Object.keys(AUTHORING_FIXTURE_FILENAMES),['strict','events','blocked']);assert.equal(AUTHORING_PAIR_ALIAS,'authoring-original-pair');
  assert.deepEqual(authoringAcceptanceFixtures().map(f=>f.bytes),fixtures.map(f=>f.bytes));
  const pinned=['dc4cc5702ba3d82c7b43f9b727721479e28dbfc29b5389badfbfaa4704eeac99','444b550fc5647a46f8715f7bc0376b7daaf6999330049241a113c76a33549cc9','b9929313dd67c00b175e709593d451aaa8dbcc183259135ef93f6af74d66571f'];
  for(const [i,f]of fixtures.entries()){
    assert.equal(digest(f.bytes),pinned[i]);assert.equal(f.manifest.sha256,pinned[i]);assert.ok(f.bytes.length<1024);assert.deepEqual(Buffer.from(f.request.source_base64,'base64'),f.bytes);
    const parsed=readOriginal(f.bytes);assert.equal(parsed.length,i===2?4:3);assert.equal(parsed.flat().length,[23,22,26][i]);
    for(const [track,events]of parsed.entries())assert.deepEqual(events,f.sourceEvents.filter(e=>e.origin.track===track).map(({tick,bytes})=>({tick,bytes})));
    assert.deepEqual(f.inventory.tracks[0].channels,[]);assert.equal(f.inventory.tracks[0].source_event_count,4);assert.equal(f.inventory.key_attacks,6);assert.equal(f.inventory.key_releases,6);assert.deepEqual(f.manifest.pitches,[24,60,64,67,100]);
    assert.equal(f.sourceEvents.filter(e=>e.command.kind==='key_attack'&&e.command.channel===1).length,2);
  }
  const first=authoringAcceptanceFixtures();first[0].bytes[0]=0;first[0].inventory.tracks[0].name='modified';assert.deepEqual(authoringAcceptanceFixtures().map(f=>f.bytes),fixtures.map(f=>f.bytes));assert.equal(authoringAcceptanceFixtures()[0].inventory.tracks[0].name,'Original conductor');
});
test('original overlap, nonzero bank and unsupported controller are explicit source events',()=>{
  const strict=fixtures[0],events=fixtures[1],blocked=fixtures[2];
  assert.ok(strict.sourceEvents.some(e=>e.command.kind==='bank_select'&&e.command.channel===0&&e.command.value===1));
  assert.deepEqual(events.sourceEvents.filter(e=>e.command.key===60).map(e=>[e.tick,e.command.kind]),[[0,'key_attack'],[240,'key_attack'],[480,'key_release'],[720,'key_release']]);
  const controller=blocked.sourceEvents.find(e=>e.command.kind==='unsupported_controller');assert.equal(controller.command.controller,2);assert.equal(controller.origin.track,3);assert.equal(controller.command.channel,2);
  assert.deepEqual(blocked.inventory.tracks[3].channels,[{channel:2,source_event_count:1,key_attacks:0,key_releases:0}]);
});
test('fixture writer creates only three original sources plus finite manifest and never overwrites',async()=>{
  const directory=await mkdtemp(join(tmpdir(),'authoring-fixture-test-'));
  try{const manifest=await prepareSongAuthoringFixtures(directory);assert.equal(manifest.rights.status,'original_authored');assert.equal(manifest.rights.license,'CC0-1.0');assert.deepEqual(manifest.aliases[AUTHORING_PAIR_ALIAS],[fixtures[0].filename,fixtures[1].filename]);
    assert.deepEqual((await readdir(directory)).sort(),['authoring-fixtures.json',...Object.values(AUTHORING_FIXTURE_FILENAMES)].sort());
    for(const f of fixtures)assert.deepEqual(await readFile(join(directory,f.filename)),f.bytes);
    assert.deepEqual(JSON.parse(await readFile(join(directory,'authoring-fixtures.json'))),manifest);
    await assert.rejects(prepareSongAuthoringFixtures(directory),{code:'EEXIST'});
    const sentinel=Buffer.from('preserve existing original');await writeFile(join(directory,fixtures[0].filename),sentinel);await assert.rejects(prepareSongAuthoringFixtures(directory),{code:'EEXIST'});assert.deepEqual(await readFile(join(directory,fixtures[0].filename)),sentinel);
  }finally{await rm(directory,{recursive:true,force:true});}
});
test('captured Rust draft bytes match original generator and honest provenance',async()=>{
  const provenance=JSON.parse(await read('acceptance-provenance.json'));assert.equal(provenance.rights.license,'CC0-1.0');assert.match(provenance.capture,/Real native_import_driver/);assert.equal(provenance.limits.physical_audio,false);assert.equal(provenance.source_dirty,true);assert.match(provenance.source_basis_commit,/^[0-9a-f]{40}$/);assert.match(provenance.source_basis_tree,/^[0-9a-f]{40}$/);assert.equal('rust_source_commit' in provenance,false);assert.match(provenance.source_scope,/uncommitted acceptance-only harness/);
  for(const f of fixtures){const entry=provenance.files.find(e=>e.source.id===f.id),raw=await read(entry.filename);assert.deepEqual(entry.source,f.manifest);assert.equal(raw.length,entry.bytes);assert.equal(digest(raw),entry.sha256);const draft=JSON.parse(raw),result=validateAuthoringDraft(draft,f);if(f.id==='blocked')assert.equal(result.score,null);else{assert.equal(result.metadata.title,draft.title);assert.equal(result.score.performance.profile,f.expectedProfile);assert.equal(authoringDraftFingerprint(draft.package),draft.draft_sha256);}}
});
function rebind(draft){const metadata=JSON.parse(draft.package.metadata_json);metadata.score.bytes=Buffer.byteLength(draft.package.score_json);metadata.score.sha256=digest(draft.package.score_json);draft.package.metadata_json=JSON.stringify(metadata);draft.draft_sha256=authoringDraftFingerprint(draft.package);}
test('shared draft verifier rejects omitted conductor, missing notes, altered source identities and false coverage',async()=>{
  for(const f of fixtures.filter(f=>f.id!=='blocked')){
    const original=await captured(f.id);
    const mutations=[d=>d.inventory.tracks.shift(),d=>d.inventory.source_events--,d=>d.inventory.tracks[0].source_event_count--,d=>d.source.sha256='0'.repeat(64),d=>d.package.score_json+=' ',d=>d.draft_sha256='0'.repeat(64),d=>d.title='changed without reprepare',d=>d.inventory.parts[0].notation_available=!d.inventory.parts[0].notation_available];
    for(const mutate of mutations){const changed=structuredClone(original);mutate(changed);assert.throws(()=>validateAuthoringDraft(changed,f));}
    for(const edit of [s=>s.performance.tracks.shift(),s=>s.performance.events.shift(),s=>s.performance.events[0].origin.event++,s=>s.performance.events[0].at.numerator++,s=>s.performance.parts[0].channel++,s=>s.performance.tracks[0].name='invented']){
      const changed=structuredClone(original),score=JSON.parse(changed.package.score_json);edit(score);changed.package.score_json=JSON.stringify(score);rebind(changed);assert.throws(()=>validateAuthoringDraft(changed,f));
    }
  }
  const strict=await captured('strict'),score=JSON.parse(strict.package.score_json);score.performance.notes.pop();strict.package.score_json=JSON.stringify(score);rebind(strict);assert.throws(()=>validateAuthoringDraft(strict,fixtures[0]));
  const events=await captured('events'),eventScore=JSON.parse(events.package.score_json);eventScore.performance.events.find(e=>e.command.key===24).command.key=36;events.package.score_json=JSON.stringify(eventScore);rebind(events);assert.throws(()=>validateAuthoringDraft(events,fixtures[1]));
  const blocked=await captured('blocked');blocked.diagnostics.find(d=>d.code==='complete_conversion_rejected').source_event_id=null;assert.throws(()=>validateAuthoringDraft(blocked,fixtures[2]));
});
test('ZIP verifier preserves exact Rust strings and rejects omitted score or undeclared source',async()=>{
  const packages=await Promise.all(['strict','events'].map(async id=>(await captured(id)).package));
  const entries=packages.flatMap((p,i)=>[[`songs/${i}/metadata.json`,p.metadata_json],[`songs/${i}/score.json`,p.score_json]]);
  entries.push(['manifest.json',JSON.stringify({format:'worldmusichub-song-pack',version:2,songs:[{folder:'songs/0'},{folder:'songs/1'}]})]);
  assert.equal(assertAuthoringZip(storedZip(entries),packages).length,5);
  assert.throws(()=>assertAuthoringZip(storedZip(entries.slice(1)),packages));
  assert.throws(()=>assertAuthoringZip(storedZip([...entries,['source.mid',fixtures[0].bytes]]),packages));
  const altered=entries.map(([path,bytes])=>[path,path==='songs/0/metadata.json'?bytes+'\n':bytes]);assert.throws(()=>assertAuthoringZip(storedZip(altered),packages));
});
test('native authoring check fails closed without an explicit exact-source driver',()=>{
  const env={...process.env};delete env.WMH_NATIVE_IMPORT_DRIVER;delete env.WMH_AUTHORING_REPORT;
  const result=spawnSync(process.execPath,['scripts/check-song-authoring-native.mjs'],{cwd:new URL('../',import.meta.url),env,encoding:'utf8',timeout:10000});assert.equal(result.status,1);assert.match(result.stderr,/exact-source native_import_driver/);assert.equal(result.stdout,'');
});
