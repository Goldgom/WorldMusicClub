import test from 'node:test';
import assert from 'node:assert/strict';
import {FreePracticeRecorder, FREE_RECORD_FORMAT, FREE_RECORD_LIMITS, validateFreeKeyboardConfiguration} from '../web/free-practice-recorder.js';

import {createKeyboardInput, DEFAULT_KEYBOARD_MAPPING} from '../web/keyboard-input.js';

const keyboardConfiguration=(id=1,extra={})=>({configuration_id:id,base_midi:36,transpose_semitones:0,duplicate_pitch_policy:'reject',mapping:structuredClone(DEFAULT_KEYBOARD_MAPPING),...extra});
const createdAt='2026-10-01T22:00:00.000Z', stoppedAt='2026-10-01T22:01:00.000Z';
const recorder=options=>new FreePracticeRecorder({id:'original-free-session',createdAt,...options});
const on=(wall=120,source='private-device:0:60',options={})=>({source,generationToken:'private-port-generation',inputKind:'midi',channel:0,midi:60,velocity:84,eventWall:wall,receivedWall:wall,encoding:'note_on',...options});

test('free capture needs no score, assessment, storage, DOM or audio and preserves observed releases',()=>{
 const r=recorder();assert.equal(r.observe('note_on',on()).accepted,false);r.start(100);
 assert.equal(r.observe('note_on',on()).accepted,true);
 assert.equal(r.observe('note_off',on(175,undefined,{velocity:41,encoding:'note_off'})).accepted,true);
 const data=r.stop(200,stoppedAt);
 assert.equal(data.format,FREE_RECORD_FORMAT);assert.equal(data.mode,'free');assert.equal(data.score_context,null);
 assert.equal(data.capabilities.assessment,false);assert.equal(data.capabilities.duration_inference,false);
 assert.deepEqual(data.observations.events.filter(e=>e.kind.startsWith('note')).map(e=>[e.kind,e.midi,e.velocity,e.event_ms,e.velocity_provenance]),[['note_on',60,84,20,'midi_message'],['note_off',60,41,75,'midi_message']]);
 assert.equal(data.observations.pairing,'not_implemented');assert.doesNotMatch(JSON.stringify(data),/private-device|private-port-generation|first practice pass/);
});

test('pause keeps the real gap and delayed events retain receipt order and exact segment routing',()=>{
 const r=recorder();r.start(100);r.observe('note_on',on(120));r.pause(150);r.observe('note_off',on(135,undefined,{receivedWall:160,velocity:0}));
 r.observe('note_on',on(180,'paused-note'));r.resume(200);r.observe('note_on',on(220,'later-note'));const data=r.stop(250,stoppedAt);
 assert.deepEqual(data.segments,[{id:1,start_wall_ms:100,end_wall_ms:150},{id:2,start_wall_ms:200,end_wall_ms:250}]);
 const observed=data.observations.events.filter(e=>e.kind.startsWith('note'));
 assert.deepEqual(observed.map(e=>[e.event_wall_ms,e.segment_id]),[[120,1],[135,1],[180,null],[220,2]]);
 assert.equal(observed[1].received_ms,60);assert.equal(observed[2].routing,'outside_recording_segment');
 assert.ok(data.observations.events.some(e=>e.kind==='synthetic_release'&&e.reason==='pause'));
 assert.equal(data.clock.gap_policy,'preserved');assert.equal(data.closure.late_delivery_grace_ms,0);
});

test('stop returns independent sealed snapshots and rejects late callbacks without rewriting history',()=>{
 const r=recorder();r.start(10);r.observe('note_on',on(20));const first=r.stop(30,stoppedAt),retained=structuredClone(first);
 first.observations.events[1].midi=99;first.segments[0].start_wall_ms=500;first.capabilities.assessment=true;
 assert.deepEqual(r.snapshot(),retained);assert.deepEqual(r.observe('note_off',on(25,undefined,{receivedWall:40})),{accepted:false,reason:'free.not_active'});
 assert.deepEqual(r.stop(45,stoppedAt),retained);assert.equal(r.resume(50),false);assert.equal(r.pause(50),false);
});

test('configuration changes release contacts and are bounded independent display/input settings',()=>{
 const r=recorder();r.start(100);r.observe('note_on',on(110));r.configure('keyboard_semitone_transpose',1,120);r.configure('sound',false,125);
 assert.throws(()=>r.configure('device_id','private',130),{code:'free.invalid_configuration'});
 assert.throws(()=>r.configure('keyboard_base_midi',128,130),{code:'free.invalid_configuration'});
 assert.deepEqual(r.snapshot().configuration.map(e=>[e.key,e.value]),[['keyboard_semitone_transpose',1],['sound',false]]);
 assert.equal(r.snapshot().observations.events.filter(e=>e.kind==='synthetic_release').length,1);
 assert.throws(()=>r.pause(124),{code:'free.invalid_clock'});
});

test('observation caps disclose omissions and never evict the first input',()=>{
 let warnings=0;const r=recorder({evidenceLimit:3,onLimit:()=>warnings++});r.start(10);r.observe('note_on',on(20));r.observe('note_off',on(25));
 assert.deepEqual(r.observe('note_on',on(30)),{accepted:false,reason:'free.observation_limit'});
 const data=r.stop(40,stoppedAt);assert.equal(data.observations.events.length,3);assert.equal(data.observations.events[1].midi,60);
 assert.equal(data.observations.truncated,true);assert.ok(data.observations.omitted_observations>=2);assert.equal(warnings,1);assert.equal(data.observations.first_omitted_received_wall_ms,30);
});

test('invalid observations/clock transitions are rejected and UI velocity remains labelled constant',()=>{
 assert.throws(()=>recorder({id:'bad/id'}),{code:'free.invalid_identity'});assert.throws(()=>recorder({createdAt:'wrong'}),{code:'free.invalid_identity'});
 const r=recorder();assert.throws(()=>r.start(Infinity),{code:'free.invalid_clock'});r.start(100);
 assert.throws(()=>r.start(110),{code:'free.already_started'});
 for(const patch of [{midi:128},{velocity:-1},{channel:16},{eventWall:NaN},{receivedWall:99},{inputKind:'unknown'},{source:''}])assert.throws(()=>r.observe('note_on',on(110,undefined,patch)),{code:'free.invalid_observation'});
 r.observe('note_on',on(110,'keyboard:KeyA',{inputKind:'typing_keyboard',channel:null,velocity:90,generationToken:null}));
 assert.equal(r.snapshot().observations.events.at(-1).velocity_provenance,'ui_default');
 assert.throws(()=>r.stop(120,'2025-01-01'),{code:'free.invalid_stop'});assert.equal(r.state,'recording');
});

test('missing onsets and pre-start event timestamps stay explicit rather than inventing duration',()=>{
 const r=recorder();r.start(100);r.observe('note_off',on(80,'late-release',{receivedWall:110,velocity:15}));
 const release=r.snapshot().observations.events.at(-1);assert.equal(release.routing,'before_start');assert.equal(release.event_ms,-20);assert.equal(release.midi,60);
 assert.equal(r.snapshot().capabilities.release_pairing,false);
});

test('cleanup respects source generations and unsupported channel filters cannot clear unrelated keys',()=>{
 const r=recorder();r.start(10);r.observe('note_on',on(20,'key-a',{generationToken:'one'}));r.observe('note_on',on(21,'key-a',{generationToken:'two'}));
 assert.throws(()=>r.cleanup(25,'input_cleanup',{channel:0}),{code:'free.invalid_cleanup_scope'});
 r.cleanup(30,'input_cleanup',{generationToken:'one'});
 let releases=r.snapshot().observations.events.filter(e=>e.kind==='synthetic_release');assert.equal(releases.length,1);assert.equal(releases[0].source_generation,'generation-1');
 r.stop(40,stoppedAt);releases=r.snapshot().observations.events.filter(e=>e.kind==='synthetic_release');assert.equal(releases.length,2);assert.equal(releases[1].source_generation,'generation-2');
});

test('clock segments and configuration journals have explicit resource bounds',()=>{
 const r=recorder({evidenceLimit:1});r.start(0);
 for(let i=1;i<1000;i++){r.pause(i*2);r.resume(i*2+1)}
 r.pause(2000);assert.throws(()=>r.resume(2001),{code:'free.segment_limit'});assert.equal(r.state,'paused');
 for(let i=0;i<1000;i++)r.configure('sound',false,2100+i);
 assert.throws(()=>r.configure('sound',true,4000),{code:'free.configuration_limit'});assert.equal(r.snapshot().configuration.length,1000);
});

test('receipt clocks cannot move backward, run ahead of delivery, or seal before received input',()=>{
 const r=recorder();r.start(100);r.observe('note_on',on(120,undefined,{receivedWall:150}));
 assert.throws(()=>r.observe('note_off',on(130,undefined,{receivedWall:149})),{code:'free.invalid_observation'});
 assert.throws(()=>r.observe('note_on',on(170,undefined,{receivedWall:160})),{code:'free.invalid_observation'});
 assert.throws(()=>r.observe('note_on',on(170,undefined,{rawTimestamp:NaN})),{code:'free.invalid_observation'});
 assert.throws(()=>r.stop(140,stoppedAt),{code:'free.invalid_clock'});
 assert.equal(r.state,'recording');const data=r.stop(200,stoppedAt);
 assert.equal(data.clock.stopped_monotonic_ms,200);assert.equal(data.clock.domain_id,'free:original-free-session');assert.equal(data.revision,1);
});

test('saved source mappings contain opaque identities and existing on-screen input kinds',()=>{
 const r=recorder();r.start(0);
 for(const [index,inputKind] of ['on_screen_pointer','on_screen_keyboard','typing_keyboard'].entries())r.observe('note_on',on(index+1,`private-source-${index}`,{generationToken:{},inputKind}));
 const data=r.stop(5,stoppedAt);
 assert.deepEqual(data.observations.sources,[{id:'source-1',generation:'generation-1',input_kind:'on_screen_pointer'},{id:'source-2',generation:'generation-2',input_kind:'on_screen_keyboard'},{id:'source-3',generation:'generation-3',input_kind:'typing_keyboard'}]);
 assert.doesNotMatch(JSON.stringify(data),/private-source|generationToken/);
 assert.throws(()=>recorder({createdAt:'2026-10-01'}),{code:'free.invalid_identity'});
});

test('malformed cleanup selectors leave owned contacts untouched',()=>{
 const r=recorder();r.start(0);r.observe('note_on',on(1));
 for(const selector of [null,[],{prefix:''},{source:7}])assert.throws(()=>r.cleanup(2,'input_cleanup',selector),{code:'free.invalid_cleanup_scope'});
 assert.equal(r.snapshot().observations.events.length,2);assert.equal(r.evidence.active.size,1);
});


test('source identity cannot silently change input kind, and sealed internals cannot be mutated',()=>{
 const r=recorder();r.start(100);const generationToken={};r.observe('note_on',on(110,'same-source',{generationToken}));
 assert.throws(()=>r.observe('note_on',on(120,'same-source',{generationToken,inputKind:'typing_keyboard'})),{code:'free.invalid_observation'});
 const record=r.stop(115,stoppedAt);assert.equal(record.observations.events.filter(e=>e.kind==='note_on').length,1);
 assert.throws(()=>{r.sealed.observations.events[1].midi=90},TypeError);assert.equal(r.snapshot().observations.events[1].midi,60);
});


test('complete current PC configuration archives every mapping field as an immutable independent value',()=>{
 const input=createKeyboardInput(),configuration=structuredClone(input.exportConfigurationData().current_configuration),expected=structuredClone(configuration),r=recorder();
 r.start(100);assert.equal(r.configure('keyboard_configuration',configuration,100),true);
 configuration.mapping[0].offset=99;configuration.base_midi=12;
 let record=r.snapshot();assert.deepEqual(record.configuration[0],{sequence:1,wall_ms:100,key:'keyboard_configuration',value:expected});
 record.configuration[0].value.mapping[0].label='changed outside';assert.deepEqual(r.snapshot().configuration[0].value,expected);
 assert.throws(()=>{r.configuration[0].value.mapping[0].offset=50},TypeError);
 assert.equal(r.configure('keyboard_configuration',expected,110),false);assert.equal(r.configuration.length,1);
 r.observe('note_on',on(120,'keyboard-held',{inputKind:'typing_keyboard',generationToken:null}));
 const next=keyboardConfiguration(2,{transpose_semitones:12});assert.equal(r.configure('keyboard_configuration',next,130),true);
 assert.equal(r.state,'recording');assert.equal(r.evidence.active.size,0);
 assert.equal(r.snapshot().observations.events.filter(e=>e.kind==='synthetic_release').length,1);
 assert.deepEqual(r.stop(150,stoppedAt).configuration.map(item=>item.value),[expected,next]);
});

test('archive validation reuses physical-code bounds and rejects implicit or aliased invalid mappings',()=>{
 const invalids=[value=>value.mapping=[],value=>value.mapping=Array(129).fill(value.mapping[0]),value=>value.mapping[0].code='ArrowUp',value=>value.mapping[0].code='KeyInvalid',value=>value.mapping[1].code=value.mapping[0].code,value=>value.mapping[0].offset=128,value=>value.mapping[0].offset=0.5,value=>value.mapping[1].offset=value.mapping[0].offset,value=>value.mapping[0].label=' ',value=>value.mapping[0].label='界'.repeat(25),value=>value.mapping[0].row='row'.repeat(9),value=>delete value.mapping[0].label,value=>value.mapping[0].raw_device_id='private',value=>value.mapping[0]=null,value=>value.mapping=Array(1),value=>value.base_midi=undefined,value=>value.base_midi=128,value=>value.transpose_semitones=-128,value=>value.transpose_semitones=undefined,value=>value.duplicate_pitch_policy='allow',value=>value.configuration_id=0,value=>value.configuration_id=Number.MAX_SAFE_INTEGER+1,value=>value.history=[],value=>value.mapping[0].label=null,value=>Object.defineProperty(value.mapping[0],'offset',{get(){throw Error('Do not read accessor')},enumerable:true})];
 for(const mutate of invalids){const config=keyboardConfiguration();mutate(config);assert.throws(()=>validateFreeKeyboardConfiguration(config),{code:'free.invalid_configuration'});}
 const explicit=keyboardConfiguration(3,{duplicate_pitch_policy:'explicit_aliases'});explicit.mapping[1].offset=explicit.mapping[0].offset;assert.equal(validateFreeKeyboardConfiguration(explicit),true);
 const outside=keyboardConfiguration(4,{mapping:[{code:'KeyA',offset:127,label:'A',row:'custom'}],base_midi:127});assert.throws(()=>validateFreeKeyboardConfiguration(outside),{code:'free.invalid_configuration'});
});

test('a rejected mapping pauses and blocks PC evidence until an accepted full archive restores certainty',()=>{
 const r=recorder();r.start(100);r.configure('keyboard_configuration',keyboardConfiguration(),100);r.observe('note_on',on(110,'held',{inputKind:'typing_keyboard'}));
 const bad=keyboardConfiguration(2);bad.mapping[0].code='Escape';
 assert.throws(()=>r.configure('keyboard_configuration',bad,120),{code:'free.invalid_configuration'});assert.equal(r.state,'paused');assert.equal(r.evidence.active.size,0);
 assert.deepEqual(r.observe('note_on',on(130,'new-map',{inputKind:'typing_keyboard'})),{accepted:false,reason:'free.keyboard_configuration_required'});
 assert.throws(()=>r.resume(140),{code:'free.keyboard_configuration_required'});assert.equal(r.configuration.length,1);
 assert.equal(r.configure('keyboard_configuration',keyboardConfiguration(2,{base_midi:48}),150),true);assert.equal(r.state,'paused');assert.equal(r.resume(160),true);
 assert.equal(r.observe('note_on',on(170,'new-map',{inputKind:'typing_keyboard'})).accepted,true);
 const data=r.stop(180,stoppedAt);assert.deepEqual(data.segments,[{id:1,start_wall_ms:100,end_wall_ms:120},{id:2,start_wall_ms:160,end_wall_ms:180}]);
 assert.ok(data.observations.events.some(event=>event.reason==='keyboard_configuration_rejected'));
});

test('configuration IDs must advance, while exact duplicate announcements do not consume history',()=>{
 const r=recorder();r.start(100);r.configure('keyboard_configuration',keyboardConfiguration(7),100);
 assert.equal(r.configure('keyboard_configuration',keyboardConfiguration(7),110),false);
 assert.throws(()=>r.configure('keyboard_configuration',keyboardConfiguration(7,{base_midi:48}),120),{code:'free.invalid_configuration'});
 assert.throws(()=>r.configure('keyboard_configuration',keyboardConfiguration(6),130),{code:'free.invalid_configuration'});
 assert.equal(r.configuration.length,1);assert.equal(r.configure('keyboard_configuration',keyboardConfiguration(7),140),false);assert.equal(r.resume(150),true);
});

test('full configuration byte admission is UTF-8 bounded and failure preserves the prior prefix',()=>{
 const r=recorder();r.start(0);let accepted=0,last;
 for(let id=1;id<=1000;id++){
  const value=keyboardConfiguration(id,{mapping:DEFAULT_KEYBOARD_MAPPING.map(binding=>({...binding,label:'\u0000'.repeat(24),row:'界'.repeat(24)}))});
  try{r.configure('keyboard_configuration',value,id);accepted++;last=value;}catch(error){assert.equal(error.code,'free.configuration_byte_limit');break;}
 }
 assert.ok(accepted>1&&accepted<1000);assert.equal(r.configuration.length,accepted);assert.equal(r.state,'paused');assert.deepEqual(r.configuration.at(-1).value,last);
 assert.ok(r.configurationBytes<=FREE_RECORD_LIMITS.configurationBytes);assert.throws(()=>r.resume(1001),{code:'free.keyboard_configuration_required'});
 const data=r.stop(1002,stoppedAt);assert.equal(data.configuration.length,accepted);assert.ok(new TextEncoder().encode(JSON.stringify(data.configuration)).byteLength<FREE_RECORD_LIMITS.configurationBytes);
});

test('configuration entry exhaustion rejects a new mapping without accepting pitches under it',()=>{
 const r=recorder({evidenceLimit:1});r.start(0);
 for(let i=0;i<1000;i++)r.configure('sound',false,i);
 assert.throws(()=>r.configure('keyboard_configuration',keyboardConfiguration(),1000),{code:'free.configuration_limit'});
 assert.equal(r.state,'paused');assert.equal(r.configuration.length,1000);
 assert.deepEqual(r.observe('note_on',on(1001,'blocked-pc',{inputKind:'typing_keyboard'})),{accepted:false,reason:'free.keyboard_configuration_required'});
 assert.equal(r.stop(1002,stoppedAt).configuration.length,1000);
});


test('a malformed configuration clock blocks PC capture without inventing a boundary timestamp',()=>{
 const r=recorder();r.start(100);r.configure('keyboard_configuration',keyboardConfiguration(),100);r.observe('note_on',on(110));const before=r.snapshot();
 assert.throws(()=>r.configure('keyboard_configuration',keyboardConfiguration(2),105),{code:'free.invalid_clock'});
 assert.deepEqual(r.snapshot(),before);assert.deepEqual(r.observe('note_on',on(120,'unknown-map',{inputKind:'typing_keyboard'})),{accepted:false,reason:'free.keyboard_configuration_required'});
 r.pause(130,'keyboard_configuration_rejected');assert.throws(()=>r.resume(140),{code:'free.keyboard_configuration_required'});
 r.configure('keyboard_configuration',keyboardConfiguration(2),150);assert.equal(r.resume(160),true);
});
