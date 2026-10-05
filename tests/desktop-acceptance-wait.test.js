import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {runInNewContext} from 'node:vm';
import {freePracticeApp,fixtureScoreServer} from './free-practice-app-fixtures.js';

const source=await readFile(new URL('../crates/desktop-shell/acceptance-wait.js',import.meta.url),'utf8');
const createWait=runInNewContext(`${source}\ncreateAcceptanceWait`,{AbortController,setTimeout,clearTimeout});
const createNavigation=runInNewContext(`${source}\ncreateAcceptanceNavigation`);
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

// Plain Node DOM tests of the exact injected navigation helper against the real
// app's menu handlers. Fixed geometry is only a readiness fixture, never native
// rendering, input, file chooser, recording, or Windows acceptance evidence.
async function menuFixture() {
  const app=await freePracticeApp({fetchResult:await fixtureScoreServer()}),clicks=[];
  const prototype=app.window.HTMLElement.prototype,original=Object.getOwnPropertyDescriptor(prototype,'getBoundingClientRect');
  Object.defineProperty(prototype,'getBoundingClientRect',{configurable:true,writable:true,value(){return {width:120,height:40};}});
  const wait=createWait(),menu=createNavigation({document:app.document,until:(condition,label)=>wait.until(condition,label,1000),click:id=>{clicks.push(id);app.$(id).click();}});
  return {app,menu,clicks,async close(){try{await app.close();}finally{if(original)Object.defineProperty(prototype,'getBoundingClientRect',original);else delete prototype.getBoundingClientRect;}}};
}

test('native menu admission rejects the preloaded hidden lobby and follows the real Single player control',async()=>{
  const f=await menuFixture();try {
    await f.app.until(()=>!f.app.$('start-listen').disabled);
    assert.equal(f.app.document.body.dataset.screen,'home');
    assert.equal(f.menu.ready('library','start-listen'),false,'An enabled hidden Listen button cannot admit startup');
    assert.equal(f.menu.ready('home','home-single-player'),true);
    const button=f.app.$('home-single-player');button.disabled=true;assert.equal(f.menu.ready('home','home-single-player'),false);button.disabled=false;
    const geometry=button.getBoundingClientRect;button.getBoundingClientRect=()=>({width:0,height:40});assert.equal(f.menu.ready('home','home-single-player'),false);button.getBoundingClientRect=geometry;
    f.app.$('home-settings').click();assert.equal(f.menu.ready('home','home-single-player'),false,'An open settings dialog blocks menu admission');f.app.$('settings-dialog').close();
    await f.menu.enterLibrary();assert.deepEqual(f.clicks,['home-single-player']);
    assert.equal(f.menu.ready('library','start-listen'),true);assert.equal(f.app.$('song-lobby').dataset.previewStatus,'ready');
  }finally{await f.close();}
});

test('native menu waits for actual catalog readiness after one entry click without retries',async()=>{
  const f=await menuFixture();try {
    await f.app.until(()=>!f.app.$('start-listen').disabled);
    f.app.$('start-listen').disabled=true;
    const pending=f.menu.enterLibrary();await f.app.until(()=>f.clicks.length===1);
    let settled=false;pending.then(()=>{settled=true;});await f.app.tick();assert.equal(settled,false);
    f.app.$('start-listen').disabled=false;await pending;
    assert.deepEqual(f.clicks,['home-single-player']);assert.equal(f.app.document.body.dataset.screen,'library');
  }finally{await f.close();}
});

test('native free-practice routing goes through the visible home entry and Exit returns to the real library',async()=>{
  const f=await menuFixture();try {
    await f.menu.enterLibrary();
    // Mute before the real stage handler so this Node menu test never unlocks audio.
    f.app.$('sound-button').click();await f.app.click('start-listen');
    await f.app.until(()=>f.app.document.body.dataset.screen==='stage'&&!f.app.$('start-listen').disabled);f.app.$('reset-button').click();
    const stageTitle=f.app.$('stage-title').textContent,entry=f.app.$('start-free-practice');
    f.clicks.length=0;await f.menu.enterFree();
    assert.deepEqual(f.clicks,['back-to-library','lobby-home','start-free-practice']);
    assert.equal(f.menu.ready('free','free-start'),true);assert.equal(f.app.$('start-free-practice'),entry);
    await f.menu.exitFree();assert.equal(f.app.document.body.dataset.screen,'library');assert.equal(f.menu.ready('home','start-free-practice'),false);
    f.clicks.length=0;await f.menu.enterFree();assert.deepEqual(f.clicks,['lobby-home','start-free-practice']);await f.menu.exitFree();
    assert.equal(f.app.$('stage-title').textContent,stageTitle);assert.equal(f.app.$('resume-session').hidden,false);
    assert.deepEqual(f.app.audio(),{contexts:0,unlocks:0});assert.equal(f.app.midiRequests(),0);
  }finally{await f.close();}
});

test('native navigation fails within its deadline if the menu click does not transition screens',async()=>{
  const f=await menuFixture();try {
    await f.app.until(()=>!f.app.$('start-listen').disabled);
    const clicks=[],wait=createWait(),menu=createNavigation({document:f.app.document,until:(condition,label)=>wait.until(condition,label,20),click:id=>clicks.push(id)});
    await assert.rejects(menu.enterLibrary(),/Timed out: visible native single-player catalog preview/);
    assert.deepEqual(clicks,['home-single-player']);assert.equal(f.app.document.body.dataset.screen,'home');
  }finally{await f.close();}
});

test('explicit free-draft inspection readiness reenters without requiring or starting a new recording',async()=>{
  const f=await menuFixture();try {
    await f.menu.enterLibrary();await f.menu.enterFree();await f.app.click('free-start');
    f.app.emit(f.app.$('free-practice-title'),'keydown',{code:'KeyR',key:'r'});f.app.emit(f.app.$('free-practice-title'),'keyup',{code:'KeyR',key:'r'});
    await f.app.click('free-stop');const before=await f.app.exported('free-export-draft');assert.equal(f.app.$('free-start').disabled,true);
    await f.menu.exitFree();f.clicks.length=0;await f.menu.enterFree({readyControl:'free-exit'});
    assert.deepEqual(f.clicks,['lobby-home','start-free-practice']);assert.equal(f.menu.ready('free','free-exit'),true);assert.equal(f.app.$('free-start').disabled,true);
    assert.deepEqual(await f.app.exported('free-export-draft'),before);
    await assert.rejects(f.menu.enterFree({readyControl:'free-save'}),/Unsupported free-practice acceptance readiness control/);
  }finally{await f.close();}
});

test('native free entry waits for operation readiness and Exit rejects an incorrect home destination',async()=>{
  const f=await menuFixture();try {
    const clicks=[],wait=createWait(),menu=createNavigation({document:f.app.document,until:(condition,label)=>wait.until(condition,label,1000),click:id=>{
      clicks.push(id);f.app.$(id).click();if(id==='start-free-practice')f.app.$('free-practice-screen').setAttribute('aria-busy','true');
    }});
    const pending=menu.enterFree();await f.app.until(()=>clicks.length===1);let settled=false;pending.then(()=>{settled=true;});
    await f.app.tick();assert.equal(settled,false);f.app.$('free-practice-screen').setAttribute('aria-busy','false');await pending;
    assert.deepEqual(clicks,['start-free-practice']);
    const wrongExit=createNavigation({document:f.app.document,until:(condition,label)=>wait.until(condition,label,20),click:id=>{
      assert.equal(id,'free-exit');f.app.document.querySelector('#shell-brand .brand').click();
    }});
    await assert.rejects(wrongExit.exitFree(),/Timed out: free-practice exit returned to library/);
    assert.equal(f.app.document.body.dataset.screen,'home','Home is deliberately distinct from the required library return');
  }finally{await f.close();}
});

// The exact injected smoke is parsed here, but DOMContentLoaded is not fired:
// these are fixture/contract tests, not a WebView or playback substitute.
const {createHash,webcrypto}=await import('node:crypto');
const {default:Ajv2020}=await import('ajv/dist/2020.js');
const songSmokeSource=await readFile(new URL('../crates/desktop-shell/smoke.js',import.meta.url),'utf8');
const songSmoke=runInNewContext(`${songSmokeSource}\n({nativeSongApiFixture,checkNativeSongApi,nativeSmokeControlReady,enterNativeSmokeLibrary})`,{
  AbortController,TextEncoder,Uint8Array,setTimeout,clearTimeout,addEventListener:()=>{}
});

test('startup smoke enters the actual visible Single player menu before catalog and stage work',async()=>{
  const f=await menuFixture();try {
    await f.app.until(()=>!f.app.$('start-listen').disabled);
    assert.equal(songSmoke.nativeSmokeControlReady(f.app.document,'library','song-lobby','start-listen'),false);
    const calls=[],wait=createWait();
    const report=await songSmoke.enterNativeSmokeLibrary({document:f.app.document,waitFor:(condition,label)=>{calls.push(label);return wait.until(condition,label,1000);}});
    assert.equal(report.entry,'home-single-player');assert.equal(report.destination,'library');assert.equal(report.catalogPreviewReady,true);
    assert.equal(f.app.document.body.dataset.screen,'library');assert.equal(songSmoke.nativeSmokeControlReady(f.app.document,'library','song-lobby','start-listen'),true);
    assert.deepEqual(calls,['visible app home menu','unchanged app catalog','visible app single-player catalog preview']);
    assert.match(songSmokeSource,/report\.homeMenu = await enterNativeSmokeLibrary\(/,'The injected startup invokes this checked menu path');
  }finally{await f.close();}
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

const bulkSource=await readFile(new URL('../crates/desktop-shell/bulk-import-acceptance.js',import.meta.url),'utf8');
const bulkHelpers=runInNewContext(`${bulkSource.slice(0,bulkSource.indexOf('(() => {'))}\n({postBulkAcceptanceReport,createBulkChooserObserver,BULK_ACCEPTANCE_REPORT_BYTES})`,{TextEncoder,setTimeout,WeakMap,Promise});
const bulkReply=(status=200)=>({ok:status>=200&&status<300,status,json:async()=>status<400?{}:{error:'Authored report rejection'}});
const fastBulkWait=()=>createWait({setTimer:(callback,ms)=>setTimeout(callback,Math.min(ms,15)),clearTimer:clearTimeout});

test('all bulk phases deliver the entire UTF-8 report above 64 KiB without dropping observations',async()=>{
 for(const phase of ['bulk-seed','bulk-restart','bulk-failure']){
  const report={version:1,phase,ok:true,actions:29,importReports:[{complete:'Original 中文 日本語 '.repeat(6000)}]},calls=[];
  const result=await bulkHelpers.postBulkAcceptanceReport({report,waits:fastBulkWait(),fetcher:async(path,options)=>{calls.push({path,options});return bulkReply()}});
  assert.equal(result.delivered,true);assert.equal(result.bytes,Buffer.byteLength(JSON.stringify(report)));assert.ok(result.bytes>64*1024&&result.bytes<bulkHelpers.BULK_ACCEPTANCE_REPORT_BYTES);const posted=calls.filter(row=>row.path==='/__desktop_smoke/report');assert.equal(posted.length,1);assert.equal(posted[0].options.body,JSON.stringify(report));assert.deepEqual(JSON.parse(posted[0].options.body),report);assert.deepEqual(calls.filter(row=>row.path.endsWith('/progress')).map(row=>JSON.parse(row.options.body).stage),['renderer-report-posting','renderer-report-sent']);
 }
});

test('bulk report rejection, lost transport and unreadable or pending body get one bounded failed fallback',async()=>{
 for(const fail of ['400','500','throw','body-error','fetch-pending','body-pending']){
  const report={version:1,phase:'bulk-seed',ok:true,actions:29,importReports:[{exact:'retained observation'}]},calls=[];let reports=0;
  const result=await bulkHelpers.postBulkAcceptanceReport({report,waits:fastBulkWait(),fetcher:async(path,options)=>{calls.push({path,options});if(path.endsWith('/report')&&++reports===1){if(fail==='throw')throw Error('Connection lost');if(fail==='fetch-pending')return never();if(fail==='body-pending')return{ok:true,json:never};if(fail==='body-error')return{ok:true,json:async()=>{throw Error('Unreadable response')}};return bulkReply(Number(fail))}return bulkReply()}});
  assert.equal(result.delivered,false,fail);assert.equal(result.failureDelivered,true,fail);const posted=calls.filter(row=>row.path.endsWith('/report'));assert.equal(posted.length,2,fail);assert.equal(posted[0].options.body,JSON.stringify(report));const failure=JSON.parse(posted[1].options.body);assert.equal(failure.ok,false);assert.equal(failure.phase,'bulk-seed');if(['400','500'].includes(fail))assert.equal(failure.report_failure.detail,'Error: /__desktop_smoke/report: Authored report rejection');assert.equal(failure.report_failure.received_bytes,Buffer.byteLength(JSON.stringify(report)));assert.ok(Buffer.byteLength(posted[1].options.body)<2048);assert.equal(JSON.parse(calls.at(-1).options.body).stage,'renderer-report-failed');assert.equal(report.ok,true,'The complete original report object is retained for diagnosis');
 }
});

test('bulk report serialization, byte limit and failed fallback remain explicit and finite',async()=>{
 const circular={version:1,phase:'bulk-seed',ok:true};circular.self=circular;
 const oversized={version:1,phase:'bulk-restart',ok:true,source:'界'.repeat(1500000)};assert.ok(JSON.stringify(oversized).length<4*1024*1024);
 for(const report of [circular,oversized]){const calls=[];const result=await bulkHelpers.postBulkAcceptanceReport({report,waits:fastBulkWait(),fetcher:async(path,options)=>{calls.push({path,options});return bulkReply(path.endsWith('/report')?500:200)}});assert.equal(result.delivered,false);assert.equal(result.failureDelivered,false);const posted=calls.filter(row=>row.path.endsWith('/report'));assert.equal(posted.length,1);const failure=JSON.parse(posted[0].options.body);assert.equal(failure.ok,false);assert.ok(Buffer.byteLength(posted[0].options.body)<2048);assert.equal(failure.report_failure.limit_bytes,4*1024*1024);assert.equal(JSON.parse(calls.at(-1).options.body).stage,'renderer-report-failed')}
});

test('passive native chooser observation brackets synchronous blur handlers with the same clock and accepts no blur',async()=>{
 let listener,clock=10;const tasks=[],target={addEventListener(type,callback,capture){assert.equal(type,'blur');assert.equal(capture,true);listener=callback},removeEventListener(type,callback,capture){assert.equal(type,'blur');assert.equal(callback,listener);assert.equal(capture,true);listener=null}};
 const observer=bulkHelpers.createBulkChooserObserver({target,now:()=>clock,defer:callback=>tasks.push(callback)});observer.begin(7,'picker');clock=11;listener({isTrusted:true,target:{}});assert.equal(observer.records[0].blurs.length,0,'Descendant focus blur is not a window blur');listener({isTrusted:true,target});clock=12;const actualBoundary=clock;let settled=false;const done=observer.end(7,true).then(()=>{settled=true});await Promise.resolve();assert.equal(settled,false,'Ending the action awaits the task after synchronous app handlers');clock=13;tasks.shift()();await done;const record=observer.records[0];assert.equal(record.completed,true);assert.ok(record.blurs[0].started_wall_ms<=actualBoundary&&record.blurs[0].finished_wall_ms>=actualBoundary);assert.equal(record.blurs[0].trusted,true);clock=20;observer.begin(8,'cancel-picker');clock=21;await observer.end(8,true);assert.equal(observer.records[1].blurs.length,0);observer.stop();assert.equal(listener,null);
});
