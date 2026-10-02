import test from 'node:test';
import assert from 'node:assert/strict';
import {IDBFactory} from 'fake-indexeddb';
import {FreePracticeRecorder, FREE_RECORD_LIMITS} from '../web/free-practice-recorder.js';
import {openPerformanceLibrary, validatePerformanceRecord, PERFORMANCE_BACKUP_FORMAT, PERFORMANCE_LIBRARY_LIMITS, describePerformance, comparePerformances} from '../web/performance-library.js';

import {createKeyboardInput, DEFAULT_KEYBOARD_MAPPING} from '../web/keyboard-input.js';
const keyboardConfiguration=(id=1,extra={})=>({configuration_id:id,base_midi:36,transpose_semitones:0,duplicate_pitch_policy:'reject',mapping:structuredClone(DEFAULT_KEYBOARD_MAPPING),...extra});

const createdAt='2026-10-01T22:00:00.000Z', stoppedAt='2026-10-01T22:01:00.000Z';
const observe=(eventWall,extra={})=>({source:'PRIVATE-device:0:60',generationToken:{},inputKind:'midi',channel:0,midi:60,velocity:90,encoding:'midi_note_on',eventWall,receivedWall:eventWall,...extra});
function recording({id='free-session',limit=100000,gap=false,empty=false}={}) {
 const r=new FreePracticeRecorder({id,createdAt,evidenceLimit:limit});r.start(100);
 if(!empty){r.observe('note_on',observe(120));r.observe('note_off',observe(160,{velocity:33,encoding:'midi_note_off'}));}
 if(gap){r.pause(200);r.observe('note_on',observe(220));r.resume(300);r.observe('note_on',observe(320));}
 return r.stop(400,stoppedAt);
}
const create=()=>openPerformanceLibrary({factory:new IDBFactory()});
const backup=entries=>JSON.stringify({format:PERFORMANCE_BACKUP_FORMAT,version:1,exported_at:createdAt,entries});
const settle=tx=>new Promise((resolve,reject)=>{tx.oncomplete=resolve;tx.onabort=()=>reject(tx.error);});

test('sealed performance snapshots are independent, immutable new copies with metadata-only listing',async()=>{
 const library=await create();try{
  const original=recording({gap:true}),expected=structuredClone(original),first=await library.save(original,{label:'  Evening practice  '});
  original.observations.events[1].midi=99;
  const loaded=await library.load(first.key);assert.deepEqual(loaded.record,expected);assert.equal(loaded.label,'Evening practice');assert.equal(loaded.revision,1);assert.equal(loaded.record_revision,1);
  loaded.record.segments[0].end_wall_ms=999;
  assert.deepEqual((await library.get(first.key)).record,expected);
  const second=await library.save(expected);assert.notEqual(first.key,second.key);assert.equal(second.record_id,first.record_id);
  const rows=await library.list();assert.equal(rows.length,2);assert.equal(rows.some(row=>'record' in row||'raw'in row),false);
  await assert.rejects(library.save(expected,{key:first.key,expectedRevision:1}),{code:'performance.immutable'});
  assert.equal(typeof library.remove,'undefined');assert.deepEqual(JSON.parse(await library.exportRecord(first.key)),expected);
  assert.doesNotMatch(await library.exportBackup(),/PRIVATE-device|generationToken|score_context":\{/);
 }finally{library.close()}
});

test('only strict sealed v1 records are savable, including zero-input and capped records',async()=>{
 const library=await create();try{
  const r=new FreePracticeRecorder({id:'draft',createdAt});r.start(100);
  await assert.rejects(library.save(r.snapshot()),{code:'performance.invalid_record'});
  assert.equal(validatePerformanceRecord(recording({empty:true})),true);
  const capped=recording({limit:2});assert.equal(capped.observations.truncated,true);assert.equal(validatePerformanceRecord(capped),true);
  await library.save(capped);assert.equal((await library.list()).length,1);
 }finally{library.close()}
});

test('unknown versions/fields, raw device identifiers, and invented assessment fields are rejected',()=>{
 for(const mutate of [r=>r.version=2,r=>r.revision=2,r=>r.mode='scored',r=>r.extra=true,r=>r.observations.events[1].device_id='secret',r=>r.observations.events[1].onset_capture={pass_id:1},r=>r.capabilities.assessment=true,r=>r.clock.gap_policy='removed',r=>r.closure.late_delivery_grace_ms=100,r=>r.score_context={id:'fake'},r=>r.observations.sources[0].id='private-device']){
  const data=recording();mutate(data);assert.throws(()=>validatePerformanceRecord(data));
 }
});

test('source/generation/segment references and opaque mapping order must be complete and consistent',()=>{
 for(const mutate of [r=>r.observations.sources.pop(),r=>r.observations.sources.push({id:'source-3',generation:null,input_kind:'midi'}),r=>r.observations.events[1].source_id='source-99',r=>r.observations.events[1].source_generation='generation-99',r=>r.observations.events[1].input_kind='typing_keyboard',r=>r.observations.events[1].segment_id=null,r=>r.observations.events[1].routing='outside_recording_segment',r=>r.segments[0].id=3,r=>r.segments[0].end_wall_ms=500]){
  const data=recording();mutate(data);assert.throws(()=>validatePerformanceRecord(data),{code:'performance.invalid_record'});
 }
});

test('non-finite and inconsistent times, receipt reordering, and fabricated truncation are rejected',()=>{
 for(const mutate of [r=>r.clock.origin_monotonic_ms=NaN,r=>r.clock.stopped_monotonic_ms=Infinity,r=>r.stopped_at='2026-10-01',r=>r.stopped_at='2025-10-01T22:01:00.000Z',r=>r.observations.events[1].event_ms=22,r=>r.observations.events[1].received_ms=-1,r=>r.observations.events[1].event_wall_ms=999,r=>r.observations.events[2].received_wall_ms=119,r=>r.observations.events[1].raw_timestamp_ms=Infinity,r=>r.observations.events[1].velocity_provenance='ui_default',r=>r.observations.truncated=true,r=>r.observations.omitted_observations=1,r=>r.observations.first_omitted_received_wall_ms=150]){
  const data=recording();mutate(data);assert.throws(()=>validatePerformanceRecord(data),{code:'performance.invalid_record'});
 }
 const capped=recording({limit:2});capped.observations.first_omitted_received_wall_ms=401;assert.throws(()=>validatePerformanceRecord(capped));
 const missing=recording({empty:true});missing.observations.events.pop();assert.throws(()=>validatePerformanceRecord(missing));
});

test('malformed or oversized nested structures cannot be stripped into a valid record',()=>{
 for(const mutate of [r=>delete r.observations.events[1].midi,r=>r.configuration=Array(1001).fill({}),r=>r.segments=Array(1001).fill({}),r=>r.observations.events=Array(100001).fill({}),r=>r.observations.events[1].encoding='x'.repeat(65),r=>r.observations.events[1].velocity=128,r=>r.configuration=[{sequence:1,wall_ms:101,key:'device_id',value:'private'}],r=>r.observations.events.extra=true,r=>Object.defineProperty(r.observations.events[1],'midi',{get(){throw Error('Getter must not run')},enumerable:true}),r=>r.configuration=Array(1)]){
  const data=recording();mutate(data);assert.throws(()=>validatePerformanceRecord(data),{code:'performance.invalid_record'});
 }
});

test('receipt-ordered delayed events and negative pre-start offsets retain exact data through backup',async()=>{
 const r=new FreePracticeRecorder({id:'delayed',createdAt});r.start(100);
 const generationToken={};r.observe('note_off',observe(80,{generationToken,receivedWall:110}));r.observe('note_on',observe(70,{generationToken,receivedWall:120}));
 const data=r.stop(200,stoppedAt),first=await create(),second=await create();try{
  const original=await first.save(data,{label:'Delayed'}),text=await first.exportBackup();
  const [imported]=await second.restoreBackup(text);assert.notEqual(imported.key,original.key);assert.equal(imported.record_id,'delayed');assert.equal(imported.record_revision,1);
  assert.deepEqual((await second.load(imported.key)).record,data);assert.deepEqual(data.observations.events.slice(1,3).map(e=>e.event_ms),[-20,-30]);
 }finally{first.close();second.close()}
});

test('imports append atomically with new local IDs, never overwrite existing recordings',async()=>{
 const library=await create();try{
  const data=recording(),existing=await library.save(data),text=backup([{label:'one',record:data},{label:'two',record:recording({id:'second'})}]);
  const copies=await library.restoreBackup(text);assert.equal(copies.length,2);assert.notEqual(copies[0].key,existing.key);
  await library.restoreBackup(text);const single=await library.importRecord(JSON.stringify(data),{label:'single'});
  assert.equal((await library.list()).length,6);assert.equal(single.record_id,data.id);assert.deepEqual((await library.get(existing.key)).record,data);
  const invalid=JSON.parse(text);invalid.entries[1].record.observations.events[1].source_id='absent';
  await assert.rejects(library.restoreBackup(JSON.stringify(invalid)));assert.equal((await library.list()).length,6);
  await assert.rejects(library.restoreBackup('{'));await assert.rejects(library.restoreBackup(JSON.stringify({...JSON.parse(text),version:2})),{code:'performance.unsupported_version'});
 }finally{library.close()}
});

test('concurrent saves enforce the shared 100-record bound without eviction',async()=>{
 const factory=new IDBFactory(),a=await openPerformanceLibrary({factory}),b=await openPerformanceLibrary({factory});try{
  const data=recording({empty:true});const outcomes=await Promise.allSettled(Array.from({length:101},(_,i)=>(i%2?a:b).save(data)));
  assert.equal(outcomes.filter(result=>result.status==='fulfilled').length,100);assert.equal(outcomes.find(result=>result.status==='rejected').reason.code,'performance.record_limit');assert.equal((await a.list()).length,100);
  await assert.rejects(a.restoreBackup(backup([{label:null,record:data}])),{code:'performance.record_limit'});assert.equal((await b.list()).length,100);
 }finally{a.close();b.close()}
});

test('request success followed by transaction abort never reports Saved and rolls back both stores',async()=>{
 const library=await create(),originalTransaction=library.db.transaction.bind(library.db);try{
  let requestSucceeded=false;library.db.transaction=(names,mode)=>{
   const tx=originalTransaction(names,mode),store=tx.objectStore('records'),add=store.add.bind(store);
   if(mode==='readwrite')store.add=value=>{const request=add(value);request.addEventListener('success',()=>{requestSucceeded=true;tx.abort()});return request};
   return tx;
  };
  await assert.rejects(library.save(recording()));assert.equal(requestSucceeded,true);
  library.db.transaction=originalTransaction;assert.equal((await library.list()).length,0);
  const tx=library.db.transaction('records','readonly'),request=tx.objectStore('records').count();await settle(tx);assert.equal(request.result,0);
 }finally{library.close()}
});

test('quota/write failures preserve the stopped draft and earlier saved snapshots',async()=>{
 const library=await create();const data=recording(),before=structuredClone(data),saved=await library.save(data),originalTransaction=library.db.transaction.bind(library.db);try{
  library.db.transaction=(names,mode)=>{const tx=originalTransaction(names,mode);if(mode==='readwrite')tx.objectStore('records').add=()=>{throw new DOMException('Full','QuotaExceededError')};return tx};
  await assert.rejects(library.save(data),{code:'performance.quota'});assert.deepEqual(data,before);
  library.db.transaction=originalTransaction;assert.equal((await library.list()).length,1);assert.deepEqual((await library.get(saved.key)).record,before);
  assert.ok(await library.save(data));
 }finally{library.close()}
});

test('a later add failure aborts the entire multi-record import',async()=>{
 const library=await create(),data=recording(),saved=await library.save(data),originalTransaction=library.db.transaction.bind(library.db);try{
  library.db.transaction=(names,mode)=>{const tx=originalTransaction(names,mode);if(mode==='readwrite'){const store=tx.objectStore('records'),add=store.add.bind(store);let count=0;store.add=value=>{if(++count===2)throw new DOMException('Full','QuotaExceededError');return add(value)}}return tx};
  await assert.rejects(library.restoreBackup(backup([{label:'one',record:data},{label:'two',record:data}])),{code:'performance.quota'});
  library.db.transaction=originalTransaction;assert.equal((await library.list()).length,1);assert.deepEqual((await library.get(saved.key)).record,data);
 }finally{library.close()}
});

test('local storage unavailable/closed/incomplete reads fail without resetting data',async()=>{
 await assert.rejects(openPerformanceLibrary({factory:null}),{code:'performance.unavailable'});
 const library=await create(),saved=await library.save(recording());
 let tx=library.db.transaction('records','readwrite');tx.objectStore('records').delete(saved.key);await settle(tx);
 await assert.rejects(library.load(saved.key),{code:'performance.corrupt_storage'});await assert.rejects(library.exportBackup(),{code:'performance.corrupt_storage'});
 assert.equal((await library.list()).length,1);assert.equal(await library.get('missing'),null);await assert.rejects(library.exportRecord('missing'),{code:'performance.not_found'});
 library.close();await assert.rejects(library.save(recording()),{code:'performance.closed'});
});

test('version changes close handles and never touch the saved-score database',async()=>{
 const factory=new IDBFactory(),library=await openPerformanceLibrary({factory});await library.save(recording());
 const opened=new Promise((resolve,reject)=>{const request=factory.open('worldmusichub.performances',2);request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error)});
 const upgraded=await opened;assert.equal(library.closed,true);assert.equal(upgraded.objectStoreNames.contains('records'),true);upgraded.close();
 await assert.rejects(library.list(),{code:'performance.closed'});await assert.rejects(openPerformanceLibrary({factory}),{code:'performance.storage'});
 assert.deepEqual((await factory.databases()).map(item=>item.name),['worldmusichub.performances']);
});

test('blocked opens report the blocker and close a late successful connection',async()=>{
 let request,closed=false;
 const promise=openPerformanceLibrary({factory:{open(){request={};return request}}});
 request.onblocked();await assert.rejects(promise,{code:'performance.blocked'});
 request.result={close(){closed=true}};request.onsuccess();assert.equal(closed,true);
});

test('record, backup byte limits and UTF-8 labels are enforced before writes',async()=>{
 const library=await create();try{
  await assert.rejects(library.save(recording(),{label:'界'.repeat(201)}),{code:'performance.invalid_label'});
  await assert.rejects(library.importRecord(' '.repeat(PERFORMANCE_LIBRARY_LIMITS.recordBytes+1)),{code:'performance.import_bytes'});
  // Use multi-byte text to ensure bytes, rather than JS string length, set the limit.
  await assert.rejects(library.restoreBackup('界'.repeat(Math.floor(PERFORMANCE_LIBRARY_LIMITS.backupBytes/3)+1)),{code:'performance.import_bytes'});
  assert.equal((await library.list()).length,0);
 }finally{library.close()}
});


test('A/B descriptions count retained pitches and intervals without grading or inventing releases',()=>{
 const r=new FreePracticeRecorder({id:'comparison',createdAt});r.start(100);
 for(const [eventWall,receivedWall,midi] of [[120,120,60],[120,120,64],[170,170,60],[150,180,72]])r.observe('note_on',observe(eventWall,{receivedWall,midi}));
 r.pause(200);r.observe('note_on',observe(220));r.resume(300);r.observe('note_on',observe(320));r.pause(350);
 const record=r.stop(400,stoppedAt),before=structuredClone(record),summary=describePerformance(record);
 assert.equal(summary.event_counts.note_on,6);assert.equal(summary.event_counts.note_off,0);
 assert.deepEqual(summary.pitch_onsets,{range:{min:60,max:72},distribution:[{midi:60,count:4},{midi:64,count:1},{midi:72,count:1}]});
 assert.deepEqual(summary.inter_onset_intervals.distribution,[{ms:0,count:1},{ms:50,count:1}]);
 assert.deepEqual(summary.inter_onset_intervals.excluded,{reordered:1,unassigned:2,across_boundaries:0});
 assert.deepEqual(summary.preserved_gaps,[{from_ms:100,to_ms:200},{from_ms:250,to_ms:300}]);
 assert.deepEqual(summary.musical_observation_routing,{recording_segment:5,before_start:0,outside_recording_segment:1});
 assert.equal(summary.release_pairing,'unknown');assert.equal(summary.assessment,null);
 const comparison=comparePerformances(record,recording({empty:true}));assert.equal(comparison.a.record_id,'comparison');assert.equal(comparison.b.pitch_onsets.range,null);
 assert.deepEqual(record,before);
});

test('A/B interval descriptions exclude observations across recording boundaries',()=>{
 const r=new FreePracticeRecorder({id:'gap-compare',createdAt});r.start(100);r.observe('note_on',observe(120));r.pause(200);r.resume(300);r.observe('note_on',observe(320));
 const result=describePerformance(r.stop(400,stoppedAt));assert.equal(result.inter_onset_intervals.excluded.across_boundaries,1);assert.deepEqual(result.inter_onset_intervals.distribution,[]);
});

test('byte-aware capture retains a savable prefix and a bounded, verifiable omission summary',async()=>{
 const r=new FreePracticeRecorder({id:'byte-limited',createdAt});r.start(100);let count=0;
 for(;count<100000;count++)if(!r.observe('note_on',observe(count+101,{generationToken:null,encoding:'\u0000'.repeat(64)})).accepted)break;
 assert.ok(count<100000);const data=r.stop(count+201,stoppedAt);
 assert.equal(data.observations.omission_reason,'byte_limit');assert.equal(data.observations.truncated,true);
 assert.equal(data.observations.events[1].midi,60);assert.equal(data.observations.events.length,count+1);assert.equal(validatePerformanceRecord(data),true);
 assert.ok(new TextEncoder().encode(JSON.stringify(data)).byteLength<PERFORMANCE_LIBRARY_LIMITS.recordBytes);
 const library=await create();try{
  const saved=await library.save(data);assert.equal((await library.get(saved.key)).record.observations.events.length,count+1);
  const fit=Math.floor(PERFORMANCE_LIBRARY_LIMITS.totalBytes/saved.bytes);
  for(let i=1;i<fit;i++)await library.save(data);
  await assert.rejects(library.save(data),{code:'performance.total_bytes'});assert.equal((await library.list()).length,fit);
  const forged=structuredClone(data);forged.observations.estimated_retained_bytes=0;assert.throws(()=>validatePerformanceRecord(forged));
 }finally{library.close()}
});


test('metadata add request failure rolls back the payload and cannot overwrite an existing ID',async()=>{
 const library=await create(),data=recording(),saved=await library.save(data),originalTransaction=library.db.transaction.bind(library.db);try{
  library.db.transaction=(names,mode)=>{const tx=originalTransaction(names,mode);if(mode==='readwrite'){const store=tx.objectStore('metadata'),add=store.add.bind(store);store.add=row=>add({...row,key:saved.key})}return tx};
  await assert.rejects(library.save(data),{code:'performance.storage'});
  library.db.transaction=originalTransaction;assert.equal((await library.list()).length,1);assert.deepEqual((await library.get(saved.key)).record,data);
  const tx=library.db.transaction('records','readonly'),request=tx.objectStore('records').count();await settle(tx);assert.equal(request.result,1);
 }finally{library.close()}
});


test('complete keyboard archives save and restore exact mappings, aliases and scalar v1 settings',async()=>{
 const r=new FreePracticeRecorder({id:'mapped-pc',createdAt});r.start(100);r.configure('sound',false,100);
 const initial=structuredClone(createKeyboardInput().exportConfigurationData().current_configuration);r.configure('keyboard_configuration',initial,100);
 initial.mapping[0].label='external mutation';
 const alias=keyboardConfiguration(2,{duplicate_pitch_policy:'explicit_aliases',base_midi:48,transpose_semitones:-12});alias.mapping[1].offset=alias.mapping[0].offset;alias.mapping[0].label='低音';
 r.configure('keyboard_configuration',alias,110);r.observe('note_on',observe(120,{inputKind:'typing_keyboard',generationToken:null}));
 const record=r.stop(200,stoppedAt),expected=structuredClone(record),first=await create(),second=await create();try{
  const saved=await first.save(record,{label:'完整键位'});record.configuration[2].value.mapping[0].label='after save';alias.mapping[0].offset=99;
  assert.deepEqual((await first.get(saved.key)).record,expected);
  const [restored]=await second.restoreBackup(await first.exportBackup());assert.notEqual(restored.key,saved.key);assert.deepEqual((await second.get(restored.key)).record,expected);
  assert.equal(expected.configuration[1].value.mapping[0].label,DEFAULT_KEYBOARD_MAPPING[0].label);
  assert.equal(expected.configuration[2].value.duplicate_pitch_policy,'explicit_aliases');
  const oldStyle=recording();assert.equal(validatePerformanceRecord(oldStyle),true);await second.save(oldStyle);
 }finally{first.close();second.close()}
});

test('mapping imports reject missing fields, implicit aliases, unsupported identities and hidden history',async()=>{
 const r=new FreePracticeRecorder({id:'strict-map',createdAt});r.start(100);r.configure('keyboard_configuration',keyboardConfiguration(2),100);r.configure('keyboard_configuration',keyboardConfiguration(3,{transpose_semitones:1}),110);const original=r.stop(200,stoppedAt),library=await create();try{
  const saved=await library.save(original);
  const invalids=[value=>delete value.configuration[0].value.mapping,value=>value.configuration[0].value.mapping[0].offset=128,value=>value.configuration[0].value.mapping[0].code='Escape',value=>value.configuration[0].value.mapping[1].code=value.configuration[0].value.mapping[0].code,value=>value.configuration[0].value.mapping[1].offset=value.configuration[0].value.mapping[0].offset,value=>value.configuration[0].value.mapping[0].row='界'.repeat(25),value=>value.configuration[0].value.history=[],value=>value.configuration[0].value.raw_device_id='private',value=>value.configuration[1].value.configuration_id=2];
  for(const mutate of invalids){const data=structuredClone(original);mutate(data);assert.throws(()=>validatePerformanceRecord(data),{code:'performance.invalid_record'});await assert.rejects(library.restoreBackup(backup([{label:null,record:data}])),{code:'performance.invalid_record'});}
  assert.equal((await library.list()).length,1);assert.deepEqual((await library.get(saved.key)).record,original);
 }finally{library.close()}
});

test('configuration aggregate byte caps are independently validated on imported records',()=>{
 const record=recording({empty:true}),large=keyboardConfiguration(1,{mapping:DEFAULT_KEYBOARD_MAPPING.map(binding=>({...binding,label:'\u0000'.repeat(24),row:'界'.repeat(24)}))});
 record.configuration=Array.from({length:100},(_,index)=>({sequence:index+1,wall_ms:100,key:'keyboard_configuration',value:{...large,configuration_id:index+1}}));
 assert.ok(new TextEncoder().encode(JSON.stringify(record.configuration)).byteLength>FREE_RECORD_LIMITS.configurationBytes);
 assert.throws(()=>validatePerformanceRecord(record),{code:'performance.invalid_record'});
});

test('maximum segment and configuration budgets coexist with full evidence and remain savable',async()=>{
 const r=new FreePracticeRecorder({id:'all-budgets',createdAt});r.start(0);
 for(let i=1;i<FREE_RECORD_LIMITS.segments;i++){r.pause(i*2);r.resume(i*2+1);}
 let wall=2000;
 for(let id=1;id<=1000;id++,wall++){
  const value=keyboardConfiguration(id,{mapping:DEFAULT_KEYBOARD_MAPPING.map(binding=>({...binding,label:'\u0000'.repeat(24),row:'界'.repeat(24)}))});
  try{r.configure('keyboard_configuration',value,wall);}catch(error){assert.equal(error.code,'free.configuration_byte_limit');break;}
 }
 assert.equal(r.state,'paused');assert.ok(r.configurationBytes>FREE_RECORD_LIMITS.configurationBytes-20000);
 let count=0;wall++;
 for(;count<100000;count++,wall++)if(!r.observe('note_on',observe(wall,{generationToken:null,encoding:'\u0000'.repeat(64)})).accepted)break;
 const record=r.stop(wall+1,stoppedAt);assert.equal(record.observations.omission_reason,'byte_limit');assert.equal(record.segments.length,1000);assert.equal(validatePerformanceRecord(record),true);
 assert.ok(new TextEncoder().encode(JSON.stringify(record)).byteLength<PERFORMANCE_LIBRARY_LIMITS.recordBytes);
 const library=await create();try{const saved=await library.save(record);assert.equal((await library.get(saved.key)).record.configuration.length,record.configuration.length);}finally{library.close()}
});
