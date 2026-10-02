import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {runInNewContext} from 'node:vm';

const source=await readFile(new URL('../crates/desktop-shell/acceptance-wait.js',import.meta.url),'utf8');
const createWait=runInNewContext(`${source}\ncreateAcceptanceWait`,{AbortController,setTimeout,clearTimeout});
const never=()=>new Promise(()=>{});

test('acceptance deadline rejects a pending async condition and aborts its request',async()=>{
  let signal;
  await assert.rejects(createWait().until(value=>{signal=value;return never();},'native picker result 2',10),/Timed out: native picker result 2/);
  assert.equal(signal.aborted,true);
});

test('acceptance timeout remains an error if abort makes the condition finish',async()=>{
  await assert.rejects(createWait().until(signal=>new Promise(resolve=>signal.addEventListener('abort',()=>resolve(true))),'aborted condition',10),/Timed out: aborted condition/);
});

test('late false condition cannot start another poll after timeout',async()=>{
  let finish,calls=0;
  const pending=createWait().until(()=>{calls++;return new Promise(resolve=>{finish=resolve;});},'late condition',10);
  await assert.rejects(pending,/Timed out: late condition/);finish(false);
  await new Promise(resolve=>setImmediate(resolve));assert.equal(calls,1);
});

test('acceptance JSON deadline covers both fetch and a pending response body',async()=>{
  for(const fetch of [never,async()=>({ok:true,json:never})]) {
    await assert.rejects(createWait().json(fetch,'/__desktop_smoke/result/2',undefined,10),/Timed out: response \/__desktop_smoke\/result\/2/);
  }
});

test('completed conditions and JSON clear their deadline without aborting',async()=>{
  const active=new Set();let signal;
  const waits=createWait({setTimer:(callback,ms)=>{const timer=setTimeout(callback,ms);active.add(timer);return timer;},clearTimer:timer=>{active.delete(timer);clearTimeout(timer);}});
  await waits.until(async()=>true,'completed',100);
  const value=await waits.json(async(path,options)=>{signal=options.signal;assert.equal(path,'/result');return{ok:true,json:async()=>({ok:true})};},'/result',undefined,100);
  assert.equal(value.ok,true);assert.equal(signal.aborted,false);assert.equal(active.size,0);
});

test('condition failures and HTTP result errors reach the report unchanged',async()=>{
  await assert.rejects(createWait().until(async()=>{throw Error('condition failed');},'poll',100),/condition failed/);
  await assert.rejects(createWait().json(async()=>({ok:false,status:500,json:async()=>({error:'Invalid action result'})}),'/result',undefined,100),/\/result: Invalid action result/);
});

// The exact injected smoke is parsed here, but DOMContentLoaded is not fired:
// these are fixture/contract tests, not a WebView or playback substitute.
const {createHash,webcrypto}=await import('node:crypto');
const {default:Ajv2020}=await import('ajv/dist/2020.js');
const songSmokeSource=await readFile(new URL('../crates/desktop-shell/smoke.js',import.meta.url),'utf8');
const songSmoke=runInNewContext(`${songSmokeSource}\n({nativeSongApiFixture,checkNativeSongApi})`,{
  AbortController,TextEncoder,Uint8Array,setTimeout,clearTimeout,addEventListener:()=>{}
});
const originalMidi=Buffer.from('4d546864000000060000000100604d54726b0000001600ff510307a12000c005009924500189240c00ff2f00','hex');
const midiHash=createHash('sha256').update(originalMidi).digest('hex');
const jsonReply=(status,value)=>({status,text:async()=>JSON.stringify(value)});
function songReplies() {
  const checked={plan:{schema_version:1,revision:1,source_binding:{digest:'a'.repeat(64)}},
    human_targets:{timeline:{notes:[{source_note_id:'human-note'}]}},machine_timeline:{notes:[{source_note_id:'machine-note'}]},
    coverage:{human_target_count:1,machine_occurrence_count:1},scored_mode_allowed:true};
  const kinds=[{kind:'tempo',microseconds_per_quarter:500000},{kind:'channel',channel:0,message:{kind:'program_change',program:5}},
    {kind:'channel',channel:9,message:{kind:'note_on',key:36,velocity:80}},
    {kind:'channel',channel:9,message:{kind:'note_off',key:36,velocity:12}},{kind:'meta',meta_type:47,data:[]}];
  const ranges=[[22,29],[29,32],[32,36],[36,40],[40,44]];
  const raw={source_sha256:midiHash,format:0,track_count:1,ppq:96,end_tick:1,relative_clock_available:true,
    events:kinds.map((kind,index)=>({id:{source_sha256:midiHash,track_index:0,event_index:index},
      source_range:{start:ranges[index][0],end:ranges[index][1]},kind,tick:index<3?0:1,delta_ticks:index===3?1:0,beat:{numerator:index<3?0:1,denominator:index<3?1:96},
      relative_microseconds:index<3?{numerator:'0',denominator:1}:{numerator:'15625',denominator:3}})),
    diagnostics:[{code:'percussion_mapping_unresolved'}]};
  return [{status:200,value:checked},{status:200,value:structuredClone(checked)},
    {status:400,value:{error:'Source changed',code:'assistance_source_mismatch',source_note_ids:[]}},
    {status:200,value:raw},{status:400,value:{error:'MIDI channel 10 percussion is unsupported'}}];
}
function mockSongFetch(replies,calls=[]) {
  return async(path,options)=>{
    calls.push({path,options});const row=replies.shift();assert.ok(row,'No arbitrary fetch retry or extra operation');
    return jsonReply(row.status,row.value);
  };
}

test('native song smoke uses a schema-valid original score and exact 44-byte five-event fixture',async()=>{
  const fixture=songSmoke.nativeSongApiFixture();
  const schema=JSON.parse(await readFile(new URL('../schema/worldmusichub-score-v1.schema.json',import.meta.url),'utf8'));
  const validate=new Ajv2020({strict:true,allErrors:true}).compile(schema);
  assert.equal(validate(fixture.score),true,JSON.stringify(validate.errors));
  assert.equal(fixture.score.provenance.kind,'original_exercise');
  assert.deepEqual(Buffer.from(fixture.midi),originalMidi);
  assert.equal(originalMidi.readUInt32BE(4),6);assert.equal(originalMidi.readUInt16BE(10),1);
  assert.equal(originalMidi.readUInt16BE(12),96);assert.equal(originalMidi.readUInt32BE(18),22);
  assert.deepEqual([...originalMidi.subarray(22,29)],[0,255,81,3,7,161,32]);
  assert.deepEqual([...originalMidi.subarray(32,40)],[0,153,36,80,1,137,36,12]);
  assert.deepEqual([...originalMidi.subarray(40)],[0,255,47,0]);
  assert.equal(500000n*3n,15625n*96n,'Independent exact PPQ conversion');
  assert.match(songSmokeSource,/report\.songApi = await checkNativeSongApi\(/,'Actual injected startup must require these route checks');
});

test('native song smoke sends complete ArrayBuffers and records only inspection/ownership evidence',async()=>{
  const calls=[],replies=songReplies();
  const report=await songSmoke.checkNativeSongApi({fetch:mockSongFetch(replies,calls),crypto:webcrypto});
  assert.deepEqual(calls.map(row=>row.path),['/api/assistance/create','/api/assistance/validate','/api/assistance/validate','/api/midi/events','/api/import/midi']);
  assert.equal(calls.length,5);assert.equal(replies.length,0);
  for(const row of calls.slice(3)) {
    assert.equal(Object.prototype.toString.call(row.options.body),'[object ArrayBuffer]');
    assert.deepEqual(Buffer.from(row.options.body),originalMidi);
    assert.equal(row.options.headers['Content-Type'],'audio/midi');
  }
  assert.equal(JSON.parse(calls[1].options.body).score.title,'Original native contract fixture');
  assert.equal(JSON.parse(calls[2].options.body).score.title,'Changed original fixture');
  assert.equal(report.source_sha256,midiHash);assert.equal(report.source_bytes,44);assert.equal(report.raw_events,5);
  assert.equal(report.exact_clock.numerator,'15625');assert.equal(report.exact_clock.denominator,3);
  assert.equal(report.playback_validated,false);assert.equal(report.scope,'engine-contract-only');
  assert.ok(calls.every(row=>!row.options.signal.aborted));
});

test('native song smoke fails on changed ownership, identity, event counts, clock types and permissive strict import',async()=>{
  const mutations=[
    [rows=>{rows[0].value.human_targets.timeline.notes[0].source_note_id='machine-note';},/human target ownership/],
    [rows=>{rows[2].status=200;},/expected 400/],
    [rows=>{delete rows[2].value.source_note_ids;},/structured error/],
    [rows=>{rows[3].value.source_sha256='0'.repeat(64);},/raw source identity/],
    [rows=>{rows[3].value.events.pop();},/all five events/],
    [rows=>{rows[3].value.events[3].id.event_index=0;},/source identity/],
    [rows=>{rows[3].value.events[3].relative_microseconds.numerator=15625;},/decimal-string rational clock/],
    [rows=>{rows[4].status=200;},/expected 400/]
  ];
  for(const [mutate,message] of mutations) {
    const replies=songReplies();mutate(replies);
    await assert.rejects(songSmoke.checkNativeSongApi({fetch:mockSongFetch(replies),crypto:webcrypto}),message);
  }
});

test('native song smoke bounds both pending fetch and response body with one reportable failure',async()=>{
  for(const pendingBody of [false,true]) {
    let signal,calls=0;
    const fetch=async(path,options)=>{calls++;signal=options.signal;return pendingBody?{status:200,text:never}:never();};
    await assert.rejects(songSmoke.checkNativeSongApi({fetch,crypto:webcrypto,milliseconds:10}),/timed out reading \/api\/assistance\/create/);
    assert.equal(signal.aborted,true);assert.equal(calls,1);
  }
  await assert.rejects(songSmoke.checkNativeSongApi({fetch:async()=>({status:200,text:async()=>' '.repeat(128*1024+1)}),crypto:webcrypto}),/response exceeds fixture evidence bound/);
});
