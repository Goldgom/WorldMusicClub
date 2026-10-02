import test from 'node:test';
import assert from 'node:assert/strict';
import {IDBFactory} from 'fake-indexeddb';
import {createFreePracticeSession,createFreePracticePreview,FREE_PREVIEW_LIMITS} from '../web/free-practice.js';
import {FreePracticeRecorder} from '../web/free-practice-recorder.js';
import {openPerformanceLibrary} from '../web/performance-library.js';

const date='2026-10-02T00:00:00.000Z';
const event=(wall=20,extra={})=>({source:'input-1',inputKind:'midi',channel:0,midi:60,velocity:90,eventWall:wall,receivedWall:wall,...extra});
function session(options={}){let wall=10,id=0;const value=createFreePracticeSession({now:()=>wall,dateNow:()=>date,newId:()=>`session-${++id}`,...options});return {value,at(time){wall=time;return value;}};}
function record(onsets=[20,100],options={}){const r=new FreePracticeRecorder({id:'preview-record',createdAt:date});r.start(10);for(let i=0;i<onsets.length;i++)r.observe('note_on',event(onsets[i],{source:`source-${i}`,...options}));return r.stop(Math.max(11,...onsets)+10,date);}
const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};};
function clock(){let wall=0,id=0;const jobs=new Map();return {now:()=>wall,schedule(fn,delay){jobs.set(++id,{fn,at:wall+delay});return id;},cancel(id){jobs.delete(id);},advance(ms){const target=wall+ms;let guard=10000;while(guard--){const next=[...jobs].sort((a,b)=>a[1].at-b[1].at)[0];if(!next||next[1].at>target)break;wall=next[1].at;jobs.delete(next[0]);next[1].fn();}wall=target;},jump(ms){wall+=ms;const next=[...jobs].sort((a,b)=>a[1].at-b[1].at)[0];if(next){jobs.delete(next[0]);next[1].fn();}},size:()=>jobs.size};}
function preview(extra={}){const time=clock(),calls=[],stops=[];let sound=true;const audio={unlock:async()=>{calls.push('unlock');},play:(...args)=>calls.push(args),stop:id=>stops.push(id)};const value=createFreePracticePreview({audio,soundEnabled:()=>sound,...time,...extra});return {value,time,calls,stops,audio,mute(){sound=false;}};}

test('silent free recording requires no score, API, storage, permissions or audio',()=>{
 const {value,at}=session({openLibrary:()=>{throw Error('Must not open storage to record');}});assert.throws(()=>value.start(),{code:'free.invalid_state'});value.enter();const owner=value.start({configuration:{sound:false,instrument:'piano'}});assert.equal(value.observe('note_on',event(),owner).accepted,true);const saved=at(40).stop();assert.equal(saved.score_context,null);assert.equal(saved.capabilities.assessment,false);assert.equal(value.snapshot().saveStatus,'unsaved');assert.equal(saved.configuration[0].value,false);
});
test('stale owners cannot change a stopped or subsequent recording',async()=>{
 const library=await openPerformanceLibrary({factory:new IDBFactory(),name:'owners'});const {value,at}=session({openLibrary:()=>library});value.enter();const first=value.start();value.observe('note_on',event(),first);at(30).stop();await value.save();const second=at(40).start();assert.notEqual(first,second);assert.deepEqual(value.observe('note_on',event(50),first),{accepted:false,reason:'free.stale_owner'});assert.equal(value.observe('note_on',event(50),second).accepted,true);library.close();
});
test('leave preserves record ownership for delayed evidence while invalidating live audio ownership',()=>{
 const boundaries=[];const {value,at}=session({onBoundary:reason=>boundaries.push(reason)});value.enter();const owner=value.start();value.observe('note_on',event(),owner);const live=value.liveOwner();at(30).leave();assert.equal(value.snapshot().state,'paused');assert.equal(value.snapshot().entered,false);assert.equal(value.owner(),null);assert.equal(value.liveOwner(),null);assert.equal(value.observe('note_on',event(40),value.owner()).accepted,false);assert.equal(value.observe('note_off',event(25,{receivedWall:40}),owner).accepted,true);value.enter();const reentered=value.owner();assert.equal(owner,reentered);assert.notEqual(value.liveOwner(),live);const enteredLive=value.liveOwner();at(50).resume();assert.equal(value.owner(),reentered);assert.notEqual(value.liveOwner(),enteredLive);const data=at(60).stop();assert.deepEqual(data.segments,[{id:1,start_wall_ms:10,end_wall_ms:30},{id:2,start_wall_ms:50,end_wall_ms:60}]);assert.ok(boundaries.includes('free_leave'));
});
test('paused observations remain explicitly unassigned and new start cannot discard an unsaved draft',()=>{
 const {value,at}=session();value.enter();const owner=value.start();at(20).pause();assert.equal(value.observe('note_on',event(25),owner).accepted,true);const sealed=at(30).stop();assert.equal(sealed.observations.events.find(row=>row.kind==='note_on').segment_id,null);assert.throws(()=>at(40).start(),{code:'free.invalid_state'});sealed.observations.events.length=0;assert.notEqual(value.draft().observations.events.length,0);value.discardDraft();assert.equal(value.snapshot().state,'idle');at(50).start();
});
test('pending saves coalesce and a quota failure retains an exportable immutable stopped draft',async()=>{
 const gate=deferred();let calls=0;const {value,at}=session({openLibrary:async()=>({save(){calls++;return gate.promise;}})});value.enter();value.start();at(30).stop();const before=value.exportDraft();const saving=value.save({label:'first'});assert.equal(value.save({label:'second'}),saving);assert.equal(value.snapshot().saveStatus,'pending');await Promise.resolve();gate.reject(Object.assign(Error(),{code:'performance.quota'}));await assert.rejects(saving);assert.equal(calls,1);assert.equal(value.snapshot().saveStatus,'failed');assert.equal(value.exportDraft(),before);assert.throws(()=>value.start(),{code:'free.invalid_state'});
});
test('opening failures can retry, while committed saves stay saved if the later list fails',async()=>{
 let attempts=0;const {value,at}=session({openLibrary:async()=>{if(++attempts===1)throw Object.assign(Error(),{code:'performance.unavailable'});return {save:async()=>({key:'new',revision:1}),list:async()=>{throw Object.assign(Error(),{code:'performance.unavailable'});}};}});value.enter();value.start();at(20).stop();await assert.rejects(value.save());const saved=await value.save();assert.equal(saved.key,'new');assert.equal(value.snapshot().saveStatus,'saved');assert.equal(value.snapshot().selected.key,'new');assert.equal(at(30).start()!==null,true);
});
test('save, load, baseline, record import and atomic backup restore retain separate immutable copies',async()=>{
 const library=await openPerformanceLibrary({factory:new IDBFactory(),name:'retained'}),{value,at}=session({openLibrary:()=>library});value.enter();const owner=value.start();value.observe('note_on',event(),owner);at(40).stop();const first=await value.save({label:'First'});value.chooseBaseline();const exported=await value.exportRecord();const second=await value.importRecord(exported);assert.notEqual(first.key,second.key);const compare=value.comparison();assert.equal(compare.baseline_selection.key,first.key);assert.equal(compare.current_selection.key,second.key);assert.equal(compare.a.assessment,null);const backup=await value.exportBackup();const restored=await value.restoreBackup(backup);assert.equal(restored.length,2);assert.equal((await value.refresh()).length,4);const before=await value.exportBackup();const broken=JSON.parse(backup);broken.entries[1].record.score_context={id:'fake'};await assert.rejects(value.restoreBackup(JSON.stringify(broken)));assert.deepEqual(JSON.parse(await value.exportBackup()).entries,JSON.parse(before).entries);library.close();
});
test('a slow old load cannot replace the newer selection or mutate a current recording',async()=>{
 const a=deferred(),b=deferred(),{value}=session({openLibrary:async()=>({get:key=>key==='a'?a.promise:b.promise})});value.enter();value.start();const owner=value.owner(),first=value.load('a'),second=value.load('b');await Promise.resolve();b.resolve({key:'b',revision:1,record:record()});await second;a.resolve({key:'a',revision:1,record:record()});assert.equal(await first,null);assert.equal(value.snapshot().selected.key,'b');assert.equal(value.owner(),owner);assert.equal(value.snapshot().state,'recording');
});
test('a rejected full keyboard configuration pauses, emits a boundary and can recover explicitly',()=>{
 const boundaries=[],{value,at}=session({onBoundary:reason=>boundaries.push(reason)});value.enter();value.start();assert.throws(()=>at(20).configure('keyboard_configuration',{}),{code:'free.invalid_configuration'});assert.equal(value.snapshot().state,'paused');assert.equal(value.snapshot().error,'free.invalid_configuration');assert.ok(boundaries.includes('configuration_failed'));assert.throws(()=>at(25).resume(),{code:'free.keyboard_configuration_required'});value.configure('keyboard_configuration',{configuration_id:1,base_midi:60,transpose_semitones:0,duplicate_pitch_policy:'reject',mapping:[{code:'KeyA',offset:0,label:'A',row:'home'}]},25);at(30).resume();assert.equal(value.snapshot().state,'recording');
});
test('capture limit is visible and retains the first observation prefix',()=>{
 const {value,at}=session({recorderOptions:{evidenceLimit:2}});value.enter();const owner=value.start();value.observe('note_on',event(),owner);value.observe('note_on',event(25,{source:'second'}),owner);assert.equal(value.snapshot().truncated,true);const stopped=at(30).stop();assert.equal(stopped.observations.events.length,2);assert.equal(stopped.observations.events[1].midi,60);
});
test('sound-off preview never unlocks or constructs audio',async()=>{
 const p=preview();p.mute();assert.equal(await p.value.start(record()),false);assert.equal(p.calls.length,0);assert.equal(p.value.snapshot().status,'muted');assert.equal(p.time.size(),0);
});
test('preview uses fixed durations and explicit timbre, ends with owned voices silenced and never touches record',async()=>{
 const data=record(),before=structuredClone(data),p=preview();await p.value.start(data,{instrument:'guitar'});p.time.advance(300);assert.deepEqual(p.calls.filter(Array.isArray).map(row=>[row[1],row[2],row[4]]),[[60,160,'guitar'],[60,160,'guitar']]);assert.equal(p.value.snapshot().status,'finished');assert.equal(p.time.size(),0);assert.equal(p.stops.length,2);assert.deepEqual(data,before);
});
test('stop, mute or a newer preview reject delayed audio unlock continuations',async()=>{
 const first=deferred(),second=deferred();let count=0;const p=preview({audio:{unlock:()=>++count===1?first.promise:second.promise,play:()=>{throw Error('Old preview played');},stop:()=>{}}});const pending=p.value.start(record());p.value.stop();first.resolve();assert.equal(await pending,false);const next=p.value.start(record());p.mute();second.resolve();assert.equal(await next,false);assert.equal(p.value.snapshot().status,'muted');assert.equal(p.time.size(),0);
});
test('rapid record switching only plays the latest generation',async()=>{
 const first=deferred();let unlocks=0;const played=[],p=preview({audio:{unlock:()=>++unlocks===1?first.promise:Promise.resolve(),play:(...args)=>played.push(args),stop:()=>{}}});const old=p.value.start(record([20],{midi:60}));await p.value.start(record([20],{midi:72}));first.resolve();await old;p.time.advance(200);assert.deepEqual(played.map(row=>row[1]),[72]);
});
test('preview excludes paused and reordered onsets without manufacturing a sorted performance',async()=>{
 const r=new FreePracticeRecorder({id:'gaps',createdAt:date});r.start(10);r.observe('note_on',event(20));r.pause(30);r.observe('note_on',event(40,{source:'paused'}));r.resume(80);r.observe('note_on',event(100,{source:'last'}));r.observe('note_on',event(90,{source:'reordered',receivedWall:110}));const p=preview();await p.value.start(r.stop(120,date));assert.equal(p.value.snapshot().excluded,2);p.time.advance(70);assert.equal(p.calls.filter(Array.isArray).length,1);p.time.advance(30);assert.equal(p.calls.filter(Array.isArray).length,2);
});
test('dense bursts and stalled clocks stay bounded with visible skip counts',async()=>{
 const dense=preview();await dense.value.start(record(Array(100).fill(20)));assert.equal(dense.calls.filter(Array.isArray).length,FREE_PREVIEW_LIMITS.perTick);assert.equal(dense.value.snapshot().skipped,36);dense.value.stop();assert.equal(dense.time.size(),0);
 const stalled=preview();await stalled.value.start(record([20,100,200]));stalled.time.jump(1000);assert.equal(stalled.calls.filter(Array.isArray).length,1);assert.equal(stalled.value.snapshot().skipped,2);assert.equal(stalled.value.snapshot().status,'finished');
});
test('preview enforces its retained-tone and timeline window caps',async()=>{
 const p=preview();await p.value.start(record(Array.from({length:FREE_PREVIEW_LIMITS.tones+2},(_,i)=>20+i)));assert.equal(p.value.snapshot().planned,FREE_PREVIEW_LIMITS.tones);assert.equal(p.value.snapshot().excluded,2);p.value.stop();await p.value.start(record([20,20+FREE_PREVIEW_LIMITS.spanMs+1]));assert.equal(p.value.snapshot().planned,1);assert.equal(p.value.snapshot().excluded,1);p.value.stop();
});
test('a later audio failure terminates scheduling and preserves a readable failure state',async()=>{
 let calls=0;const p=preview({audio:{unlock:async()=>{},play:()=>{if(++calls===2)throw Error('audio failed');},stop:()=>{}}});await p.value.start(record());p.time.advance(100);assert.equal(p.value.snapshot().status,'failed');assert.equal(p.time.size(),0);
});

test('delayed same-record release after resume keeps its original segment without reviving old live ownership',()=>{
 const {value,at}=session();value.enter();const owner=value.start(),live=value.liveOwner();value.observe('note_on',event(20),owner);at(30).pause();at(50).resume();const currentLive=value.liveOwner();assert.notEqual(currentLive,live);assert.equal(value.owner(),owner);assert.equal(value.observe('note_on',event(51,{source:'new-contact'}),owner).accepted,true);assert.equal(value.observe('note_off',event(25,{receivedWall:55}),owner).accepted,true);assert.equal(value.liveOwner(),currentLive);const data=at(60).stop();const delayed=data.observations.events.find(row=>row.kind==='note_off');assert.equal(delayed.event_wall_ms,25);assert.equal(delayed.received_wall_ms,55);assert.equal(delayed.segment_id,1);assert.equal(data.observations.events.filter(row=>row.kind==='synthetic_release'&&row.reason==='free_stop').length,1);assert.equal(value.observe('note_off',event(56,{receivedWall:70}),owner).accepted,false);
});

test('stale cleanup ownership cannot release a newer free recording contact',async()=>{
 const library=await openPerformanceLibrary({factory:new IDBFactory(),name:'cleanup-ownership'});const {value,at}=session({openLibrary:()=>library});value.enter();const old=value.start();at(20).stop();await value.save();const current=at(30).start();value.observe('note_on',event(40,{source:'same-source'}),current);assert.equal(value.cleanup(45,'input_cleanup',{source:'same-source'},old),false);const data=at(50).stop();assert.equal(data.observations.events.filter(row=>row.kind==='synthetic_release'&&row.reason==='free_stop').length,1);library.close();
});

test('duplicate mapping announcements do not cancel live contacts or consume boundaries',()=>{
 const boundaries=[],{value,at}=session({onBoundary:reason=>boundaries.push(reason)}),config={configuration_id:1,base_midi:60,transpose_semitones:0,duplicate_pitch_policy:'reject',mapping:[{code:'KeyA',offset:0,label:'A',row:'home'}]};value.enter();value.start({configuration:{keyboard_configuration:config}});const live=value.liveOwner(),count=boundaries.length;assert.equal(at(20).configure('keyboard_configuration',config),false);assert.equal(value.liveOwner(),live);assert.equal(boundaries.length,count);
});
test('a view callback failure cannot report a committed transaction as failed',async()=>{
 const library=await openPerformanceLibrary({factory:new IDBFactory(),name:'view-fault'}),faults=[],{value,at}=session({openLibrary:()=>library,onChange:snapshot=>{if(snapshot.saveStatus==='saved')throw Error('view failed');},onViewError:error=>faults.push(error)});value.enter();value.start();at(20).stop();await value.save();assert.equal(value.snapshot().saveStatus,'saved');assert.equal((await library.list()).length,1);assert.ok(faults.length);library.close();
});
