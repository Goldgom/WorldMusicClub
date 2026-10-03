import test from 'node:test';
import assert from 'node:assert/strict';
import {IDBFactory} from 'fake-indexeddb';
import {openScoreLibrary} from '../web/local-library.js';
import {fixture} from './frontend-fixtures.js';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {assertAddedLibraryCopies} from './library-copy-assertions.js';
const create=()=>openScoreLibrary({factory:new IDBFactory()});

test('browser archive assertions ignore object key order while matching complete copies one to one',()=>{
 const score={...structuredClone(fixture),source:{format:'original-test-text',filename:'original.txt',content:'\uFEFFExact original · 文本\r\n{"a":1,"b":2}'}};
 const reordered={...score,source:{content:score.source.content,filename:score.source.filename,format:score.source.format}};
 const row=(key,value=score,label=null)=>({key,revision:1,score_id:value.id,label,score:structuredClone(value)});
 const old=row('old-copy'),first=row('first-copy',reordered),second=row('second-copy',score,'Labeled copy');
 const expected=[{label:'Labeled copy',score},{label:null,score}];
 const before=structuredClone({old,first,second,expected});
 assert.deepEqual(assertAddedLibraryCopies([old],[second,old,first],expected),[second,first]);
 assert.deepEqual({old,first,second,expected},before,'Comparison must not mutate scores or expected entries');
 assert.equal(assertAddedLibraryCopies([],[first,row('another-copy',reordered)],[{label:null,score},{label:null,score}]).length,2,'Identical imports remain distinct permitted copies');
 for(const changedContent of [score.source.content.slice(1),score.source.content.replace('\r\n','\n'),score.source.content.replace('{"a":1,"b":2}','{"b":2,"a":1}')]){
  const changed=row('changed-source');changed.score.source.content=changedContent;
  assert.throws(()=>assertAddedLibraryCopies([],[changed],[{label:null,score}]),assert.AssertionError,'Retained source strings stay exact even when parsed content could be equivalent');
 }
 const reversed=row('reversed-notes');reversed.score.parts[0].notes.reverse();
 assert.throws(()=>assertAddedLibraryCopies([],[reversed],[{label:null,score}]),assert.AssertionError,'Ordered note arrays are never treated as sets');
 const changedTime=row('changed-time');changedTime.score.parts[0].notes[0].at={numerator:1,denominator:3};
 assert.throws(()=>assertAddedLibraryCopies([],[changedTime],[{label:null,score}]),assert.AssertionError,'Exact rational note time remains part of the comparison');
 assert.throws(()=>assertAddedLibraryCopies([old],[old,first],expected),assert.AssertionError,'A missing copy fails');
 assert.throws(()=>assertAddedLibraryCopies([old],[old,first,row('substituted-copy')],expected),assert.AssertionError,'A duplicate cannot substitute for a missing labeled edition');
 assert.throws(()=>assertAddedLibraryCopies([old],[old,first,first],expected),assert.AssertionError,'Repeated storage keys fail');
 assert.throws(()=>assertAddedLibraryCopies([old],[first,second],expected),assert.AssertionError,'Existing copies cannot disappear');
 assert.throws(()=>assertAddedLibraryCopies([old],[{...old,revision:2},first,second],expected),assert.AssertionError,'Existing metadata cannot change');
});

test('explicit local save keeps a complete immutable canonical/source snapshot',async()=>{
 const library=await create();try{const score=structuredClone(fixture);score.source={format:'musicxml',filename:'fragment.xml',content:'<score>\r\n音符 &amp; 原稿</score>'};const saved=await library.save(score,{label:'My fragment'});score.title='Changed elsewhere';const loaded=await library.get(saved.key);assert.equal(loaded.score.title,fixture.title);assert.equal(loaded.score.source.content,'<score>\r\n音符 &amp; 原稿</score>');assert.equal(loaded.label,'My fragment');const rows=await library.list();assert.equal(rows.length,1);assert.ok(!('score'in rows[0]));}finally{library.close()}
});
test('score identity never overwrites another copy and revisions prevent lost updates',async()=>{
 const factory=new IDBFactory(),a=await openScoreLibrary({factory}),b=await openScoreLibrary({factory});try{
  const first=await a.save(fixture),second=await a.save(fixture);assert.notEqual(first.key,second.key);
  const update=await b.save({...fixture,title:'Revision 2'},{key:first.key,expectedRevision:1});assert.equal(update.revision,2);
  await assert.rejects(a.save(fixture,{key:first.key,expectedRevision:1}),/changed/);
  await assert.rejects(a.remove(first.key,{expectedRevision:1}),/changed/);
  assert.equal((await a.get(first.key)).score.title,'Revision 2');assert.equal(await a.remove(first.key,{expectedRevision:2}),true);assert.equal(await a.get(first.key),null);
 }finally{a.close();b.close()}
});
test('backup restores atomically as new copies after every Rust validation succeeds',async()=>{
 const a=await create(),b=await create();try{
  await a.save(fixture,{label:'First'});await a.save({...fixture,title:'Second'});
  const backup=await a.exportBackup();let calls=0;
  await assert.rejects(b.restoreBackup(backup,{validate:async()=>{calls++;if(calls===2)throw Error('Invalid score');return true}}),/score 2/);
  assert.equal((await b.list()).length,0);
  await assert.rejects(b.restoreBackup(backup),/Rust/);
  const restored=await b.restoreBackup(backup,{validate:async()=>true});assert.equal(restored.length,2);const first=restored.find(row=>row.label==='First');assert.ok(first);
  assert.deepEqual((await b.get(first.key)).score,fixture);
  await b.restoreBackup(backup,{validate:async()=>true});assert.equal((await b.list()).length,4);
 }finally{a.close();b.close()}
});
test('count limits and failed writes leave existing saved copies intact',async()=>{
 const library=await create();try{
  const promises=Array.from({length:101},()=>library.save(fixture));const result=await Promise.allSettled(promises);
  assert.equal(result.filter(r=>r.status==='fulfilled').length,100);assert.match(result.find(r=>r.status==='rejected').reason.message,/100/);assert.equal((await library.list()).length,100);
  await assert.rejects(library.save({...fixture,source:{format:'text',filename:null,content:'x'.repeat(8*1024*1024)}}),/8 MiB/);
  assert.equal((await library.list()).length,100);
 }finally{library.close()}
});
test('storage unavailability, closed handles and unsupported backups fail clearly',async()=>{
 await assert.rejects(openScoreLibrary({factory:null}),/does not provide/);
 const library=await create();await assert.rejects(library.restoreBackup('{',{validate:async()=>true}),/JSON/);
 await assert.rejects(library.restoreBackup('{"format":"new-format","version":2,"entries":[]}',{validate:async()=>true}),/Unsupported/);
 library.close();await assert.rejects(library.list(),/closed/);
});

for(const[id,count]of[['cc0-schubert-wandrers-nachtlied-d768',334],['cc0-beethoven-gottes-macht-op48-5',226]])test(`complete CC0 ${id} backup restores all notes, original bytes, notices and producer metadata`,async()=>{
 const edition=JSON.parse(readFileSync(new URL(`../catalog/editions/${id}/score.json`,import.meta.url),'utf8'));
 const expected=structuredClone(edition),first=await create(),second=await create();
 try{
  const saved=await first.save(edition,{label:'Complete source edition'});
  edition.parts[0].notes.find(note=>note.pitch).pitch.octave=1;edition.source.content='Later unsaved edit';
  const loaded=(await first.get(saved.key)).score;assert.deepEqual(loaded,expected);
  assert.equal(loaded.parts.flatMap(part=>part.notes).length,count);
  const backup=await first.exportBackup();let validated=0;
  const restored=await second.restoreBackup(backup,{validate:async score=>{validated++;assert.deepEqual(score,expected);return true}});
  assert.equal(validated,1);assert.equal(restored.length,1);
  const actual=(await second.get(restored[0].key)).score;assert.deepEqual(actual,expected);
  assert.deepEqual(actual.format_metadata,expected.format_metadata);
  assert.ok(actual.source.import_diagnostics.some(item=>item.code==='written_note_practice_edition'));
  const envelope=JSON.parse(actual.source.content);
  for(const file of Object.values(envelope.files)){
   const bytes=Buffer.from(file.content,file.encoding==='base64'?'base64':'utf8');
   assert.equal(bytes.length,file.bytes);assert.equal(createHash('sha256').update(bytes).digest('hex'),file.sha256);
  }
  assert.equal(createHash('sha256').update(envelope.license_text).digest('hex'),envelope.provenance.license_text_sha256);
 }finally{first.close();second.close()}
});

test('library snapshots and backups retain the entire MXL envelope and all original archive bytes',async()=>{
 const raw=readFileSync(new URL('./fixtures/original-duet.mxl',import.meta.url)),xml=readFileSync(new URL('./fixtures/original-duet.musicxml',import.meta.url)),content=JSON.stringify({version:1,selected_score_path:'scores/duet.musicxml',files:{'original.mxl':{encoding:'base64',bytes:raw.length,content:raw.toString('base64')},'selected.musicxml':{encoding:'utf-8',bytes:xml.length,content:xml.toString('utf8')}}});
 // This storage fixture tests immutable bytes. The real browser test also validates musical import with Rust.
 const score={...structuredClone(fixture),source:{format:'worldmusichub-mxl-archive-v1',filename:'retained-mxl.json',content}},expected=structuredClone(score),first=await create(),second=await create();
 try{const saved=await first.save(score,{label:'Retained MXL'});score.source.content='Later unsaved edit';assert.deepEqual((await first.get(saved.key)).score,expected);const backup=await first.exportBackup();let validations=0;const restored=await second.restoreBackup(backup,{validate:async restoredScore=>{validations++;assert.deepEqual(restoredScore,expected);return true}});assert.equal(validations,1);assert.equal(restored.length,1);const actual=(await second.get(restored[0].key)).score;assert.deepEqual(actual,expected);const envelope=JSON.parse(actual.source.content);assert.deepEqual(Buffer.from(envelope.files['original.mxl'].content,'base64'),raw);assert.deepEqual(Buffer.from(envelope.files['selected.musicxml'].content),xml);assert.equal(envelope.selected_score_path,'scores/duet.musicxml')}finally{first.close();second.close()}
});

test('storage and validation errors add stable codes without changing legacy text, causes or atomicity',async()=>{
 const quota=Object.assign(new Error('Original browser quota diagnostic <raw>'),{name:'QuotaExceededError'});
 await assert.rejects(openScoreLibrary({factory:{open(){throw quota}}}),error=>{assert.equal(error.code,'library_storage_full');assert.match(error.message,/Browser storage is full/);assert.equal(error.cause,quota);return true});
 await assert.rejects(openScoreLibrary({factory:null}),error=>error.code==='library_storage_unsupported'&&/does not provide/.test(error.message));
 const library=await create();try{
  const saved=await library.save(fixture);await assert.rejects(library.remove(saved.key,{expectedRevision:0}),error=>error.code==='library_delete_revision'&&/changed in another tab/.test(error.message));
  await assert.rejects(library.save(fixture,{key:saved.key,expectedRevision:0}),error=>error.code==='library_save_revision');
  const backup=await library.exportBackup(),abort=new DOMException('用户取消','AbortError');
  await assert.rejects(library.restoreBackup(backup,{validate:async()=>{throw abort}}),error=>{assert.equal(error.code,'library_restore_aborted');assert.equal(error.cause,abort);assert.deepEqual(error.params,{count:1});assert.equal(error.message,'Backup score 1 was not restored: 用户取消');return true});
  const external=Object.assign(new Error('was not restored: abort is merely literal text'),{code:'ENGINE_FAILURE'});
  await assert.rejects(library.restoreBackup(backup,{validate:async()=>{throw external}}),error=>{assert.equal(error.code,'library_restore_score');assert.equal(error.cause,external);return true});
  assert.equal((await library.list()).length,1);assert.deepEqual((await library.get(saved.key)).score,fixture);
  assert.deepEqual(Object.keys(JSON.parse(await library.exportBackup())).sort(),['entries','exported_at','format','version']);
 }finally{library.close()}
});
