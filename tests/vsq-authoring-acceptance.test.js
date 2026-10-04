// Real captured Rust responses and original input only. Mutations below test
// rejection contracts; they never create passing native or GUI evidence.
import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {deflateSync} from 'node:zlib';
import {readFile,mkdtemp,readdir,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {VSQ_AUTHORING_FIXTURE_FILENAME,vsqAuthoringFixture,validateVsqAuthoringDraft} from '../scripts/prepare-vsq-authoring-fixtures.mjs';
import {assertVsqAuthoringZip,validateVsqAuthoringOpened,validateVsqAuthoringRuntime} from '../scripts/check-vsq-authoring-native.mjs';
import {authoringDraftFingerprint} from '../scripts/song-authoring-fixture-contract.mjs';
import {storedZip} from './native-import-driver-fixtures.js';
import {validateVsqAuthoringPicker,validateVsqAuthoringIsolation,validateVsqAuthoringViewport,validateVsqAuthoringNativeScreenshot} from '../scripts/verify-native-vsq-authoring-evidence.mjs';

const digest=value=>createHash('sha256').update(value).digest('hex');
const read=name=>readFile(new URL(`./fixtures/song-authoring/${name}`,import.meta.url));
const fixture=vsqAuthoringFixture();
const sourceSha256='d5e5e6969c86cd8cf5fd9e729caf0496b25788762b257547dcdfb5ed5dd76a2d';

// Independent finite SMF boundary reader: counts every original event and
// rejoins DM packets as bytes, without parsing or reconstructing a VSQ score.
function sourceTracks(bytes){
  assert.equal(bytes.toString('ascii',0,4),'MThd');assert.equal(bytes.readUInt32BE(4),6);
  assert.equal(bytes.readUInt16BE(8),1);assert.equal(bytes.readUInt16BE(12),480);
  const tracks=[];let at=14;
  for(let index=0;index<bytes.readUInt16BE(10);index++){
    assert.equal(bytes.toString('ascii',at,at+4),'MTrk');const end=at+8+bytes.readUInt32BE(at+4);at+=8;
    let tick=0,runningStatus=null;const events=[];
    const vlq=()=>{let value=0,count=0,byte;do{assert.ok(at<end&&count++<4);byte=bytes[at++];value=value*128+(byte&127);}while(byte&128);return value;};
    while(at<end){
      tick+=vlq();let status=bytes[at++];if(status<128){at--;assert.ok(runningStatus);status=runningStatus;}
      if(status===255){const kind=bytes[at++],length=vlq(),payload=bytes.subarray(at,at+length);at+=length;events.push({tick,status,kind,payload});}
      else{assert.equal(status,0xb0,'Only the original named controller dispatch is expected');runningStatus=status;const payload=bytes.subarray(at,at+2);at+=2;events.push({tick,status,payload});}
      assert.ok(at<=end);
    }
    assert.equal(events.at(-1).kind,47);assert.equal(events.at(-1).tick,4000);tracks.push(events);
  }
  assert.equal(at,bytes.length);return tracks;
}

test('VSQ authoring source is the exact original whole project with all raw events and DM bytes',async()=>{
  const original=JSON.parse(await read('vsq-request.json'));
  assert.equal(VSQ_AUTHORING_FIXTURE_FILENAME,'authoring-original.vsq');assert.equal(fixture.filename,VSQ_AUTHORING_FIXTURE_FILENAME);
  assert.deepEqual(fixture.bytes,Buffer.from(original.source_base64,'base64'));
  assert.equal(fixture.request.source_base64,original.source_base64);
  assert.equal(fixture.request.source_name,fixture.filename);assert.equal(fixture.request.title,'authoring-original');
  assert.equal(fixture.bytes.length,2827);assert.equal(digest(fixture.bytes),sourceSha256);assert.equal(fixture.manifest.sha256,sourceSha256);
  const tracks=sourceTracks(fixture.bytes);assert.equal(tracks.length,4);assert.deepEqual(tracks.map(t=>t.length),[4,66,66,16]);assert.equal(tracks.flat().length,152);
  assert.equal(tracks.flat().filter(e=>e.status===0xb0).length,131);
  assert.equal(tracks[0][0].payload.toString(),'Original conductor');assert.equal(tracks[0][1].kind,81);assert.equal(tracks[0][1].payload.readUIntBE(0,3),500001);
  const projects=tracks.slice(1).map((events,index)=>{
    assert.equal(events[0].payload.toString(),`Container ${index+1}`);
    const packets=events.filter(e=>e.status===255&&e.kind===1).map((e,packet)=>{assert.equal(e.payload.toString('ascii',0,8),`DM:${String(packet).padStart(4,'0')}:`);return e.payload.subarray(8);});
    assert.equal(packets.length,index===2?3:4);return Buffer.concat(packets);
  });
  for(const project of projects){assert.match(project.toString('latin1'),/^\[Common\]\nVersion=DSB301\n/);assert.match(project.toString('latin1'),/\[Reso1FreqBPList\]\n1920=255/);}
  assert.match(projects[0].toString('latin1'),/Tracks=3\nFeder0=4\nPanpot0=-9\nMute0=0\nSolo0=1\nFeder1=0\nPanpot1=0\nMute1=1/);
  for(const project of projects.slice(0,2)){assert.ok(project.includes(Buffer.from([0x82,0xa0])));assert.match(project.toString('latin1'),/9007199254740993,31,0/);assert.match(project.toString('latin1'),/Length=801/);}
  assert.equal(projects[2].includes(Buffer.from('Type=Anote')),false);
});

test('captured golden byte hashes and request normalization are bound to real native provenance',async()=>{
  const provenance=JSON.parse(await read('acceptance-vsq-provenance.json'));
  assert.match(provenance.generator,/real native_import_driver stdio/);
  assert.match(provenance.generator,/no browser, server, GUI or audio/);
  assert.match(provenance.basis_sha,/^[0-9a-f]{40}$/);assert.match(provenance.driver_sha256,/^[0-9a-f]{64}$/);
  assert.equal(provenance.request_source,'tests/fixtures/song-authoring/vsq-request.json');
  assert.equal(provenance.request_sha256,digest(await read('vsq-request.json')));
  assert.deepEqual(provenance.request,{source_name:fixture.request.source_name,title:fixture.request.title});assert.equal(provenance.key,fixture.key);
  assert.deepEqual(provenance.files.map(f=>f.path).sort(),['acceptance-vsq-draft.json','acceptance-vsq-opened.json','acceptance-vsq-runtime.json']);
  for(const entry of provenance.files){const bytes=await read(entry.path);assert.equal(bytes.length,entry.bytes);assert.equal(digest(bytes),entry.sha256);}
  assert.deepEqual(fixture.draft,JSON.parse(await read('acceptance-vsq-draft.json')));
  assert.deepEqual(fixture.opened,JSON.parse(await read('acceptance-vsq-opened.json')));
  assert.deepEqual(fixture.runtime,JSON.parse(await read('acceptance-vsq-runtime.json')));
  validateVsqAuthoringDraft(fixture.draft,fixture);validateVsqAuthoringOpened(fixture.opened,fixture);validateVsqAuthoringRuntime(fixture.runtime,fixture);
});

test('fixture preserves full project, exact integer token and runtime choice boundary',()=>{
  const draft=fixture.draft,score=JSON.parse(draft.package.score_json),metadata=JSON.parse(draft.package.metadata_json);
  assert.equal(draft.state,'vsq_authoring_candidate');assert.equal(draft.inventory.source_tracks,4);assert.equal(draft.inventory.source_events,152);
  assert.equal(draft.inventory.parts.length,3);assert.equal(draft.inventory.parts[1].vsq.mute,true);assert.equal(draft.inventory.parts[2].vsq.notes,0);
  assert.equal(score.authoring.tracks.length,3);assert.equal(score.authoring.tracks[2].notes.length,0);assert.equal(score.engine_dispatch.tracks.length,3);
  assert.equal(score.engine_dispatch.source_controller_events,131);assert.equal(score.coverage.project.notes,2);assert.equal(score.coverage.project.curves,9);
  assert.equal(metadata.score.bytes,Buffer.byteLength(draft.package.score_json));assert.equal(metadata.score.sha256,digest(draft.package.score_json));
  assert.equal(draft.draft_sha256,authoringDraftFingerprint(draft.package));
  assert.equal(metadata.rights.status,'user_supplied_unverified','The importer must not invent a rights grant');
  assert.equal((draft.package.score_json.match(/"coefficient": 9007199254740993/g)||[]).length,2);
  assert.equal(draft.package.score_json.includes('9007199254740992'),false);
  assert.equal(Object.hasOwn(draft,'runtime'),false);assert.equal(fixture.opened.clean_package.runtime,null);
  assert.deepEqual(fixture.runtime.runtime.parts.map(p=>p.audible),[true,false,false]);assert.deepEqual(fixture.runtime.runtime.notes.map(n=>n.audible),[true,false]);
  assert.deepEqual(fixture.runtime.runtime.notes.map(n=>n.end_microseconds),[{numerator:'133500267',denominator:160},{numerator:'133500267',denominator:160}]);
  const changed=vsqAuthoringFixture();changed.bytes[0]=0;changed.draft.inventory.parts.pop();changed.runtime.runtime.notes[1].audible=true;
  assert.deepEqual(vsqAuthoringFixture().bytes,fixture.bytes);assert.deepEqual(vsqAuthoringFixture().draft,fixture.draft);assert.deepEqual(vsqAuthoringFixture().runtime,fixture.runtime);
});

test('fixture writer emits only original VSQ and manifest and refuses overwrites',async()=>{
  const directory=await mkdtemp(join(tmpdir(),'vsq-authoring-fixture-test-'));
  const run=()=>spawnSync(process.execPath,['scripts/prepare-vsq-authoring-fixtures.mjs',directory],{cwd:new URL('../',import.meta.url),encoding:'utf8',timeout:10000});
  try{
    const first=run();assert.equal(first.status,0,first.stderr);
    assert.deepEqual((await readdir(directory)).sort(),['authoring-original.vsq','vsq-authoring-fixtures.json']);
    assert.deepEqual(await readFile(join(directory,fixture.filename)),fixture.bytes);
    const manifest=JSON.parse(await readFile(join(directory,'vsq-authoring-fixtures.json')));
    assert.equal(manifest.version,1);assert.equal(manifest.generator,'scripts/prepare-vsq-authoring-fixtures.mjs');assert.equal(manifest.rights.status,'original_authored');assert.equal(manifest.rights.license,'CC0-1.0');assert.deepEqual(manifest.fixtures,[fixture.manifest]);
    const sentinel=Buffer.from('preserve existing original');await writeFile(join(directory,fixture.filename),sentinel);
    const second=run();assert.notEqual(second.status,0);assert.match(second.stderr,/EEXIST/);assert.deepEqual(await readFile(join(directory,fixture.filename)),sentinel);
  }finally{await rm(directory,{recursive:true,force:true});}
});

function rebind(draft){
  const metadata=JSON.parse(draft.package.metadata_json);metadata.score.bytes=Buffer.byteLength(draft.package.score_json);metadata.score.sha256=digest(draft.package.score_json);
  draft.package.metadata_json=JSON.stringify(metadata);draft.draft_sha256=authoringDraftFingerprint(draft.package);
}
test('draft verifier rejects lost conductor, muted or note-free parts, false coverage and rounded source integers',()=>{
  const mutations=[
    d=>d.inventory.tracks.shift(),d=>d.inventory.source_events--,d=>d.inventory.parts.splice(1,1),d=>d.inventory.parts.pop(),
    d=>d.inventory.parts[1].vsq.mute=false,d=>d.source.sha256='0'.repeat(64),d=>d.draft_sha256='0'.repeat(64),
    d=>d.title='Unreviewed title',d=>d.runtime={},d=>d.package.score_json+='\n',
  ];
  for(const edit of mutations){const bad=structuredClone(fixture.draft);edit(bad);assert.throws(()=>validateVsqAuthoringDraft(bad,fixture));}
  const replacements=[
    ['9007199254740993','9007199254740992'],['"note_number": 60','"note_number": 61'],
    ['"length_ticks": 801','"length_ticks": 800'],['"microseconds_per_quarter": 500001','"microseconds_per_quarter": 500000'],
    ['"solo": true','"solo": false'],['"mute": true','"mute": false'],
    ['"source_controller_events": 131','"source_controller_events": 130'],['"Original vocal 3"','"Lost note-free part"'],
    ['"source_controller_records_accounted": 131','"source_controller_records_accounted": 130'],
  ];
  for(const [before,after]of replacements){const bad=structuredClone(fixture.draft);assert.ok(bad.package.score_json.includes(before));bad.package.score_json=bad.package.score_json.replace(before,after);rebind(bad);assert.throws(()=>validateVsqAuthoringDraft(bad,fixture));}
});

test('opened and runtime verifiers reject implied choice, missing parts, altered audibility and approximate timing',()=>{
  for(const edit of [o=>o.clean_package.runtime=fixture.runtime.runtime,o=>o.clean_package.score_json+=' ',o=>o.clean_package.metadata_json+=' ',o=>o.clean_package.score_json=o.clean_package.score_json.replaceAll('9007199254740993','9007199254740992'),o=>o.clean_package.capabilities.whole_vocal_rendering='supported',o=>delete o.score_json,o=>o.runtime=fixture.runtime.runtime]){
    const bad=structuredClone(fixture.opened);edit(bad);assert.throws(()=>validateVsqAuthoringOpened(bad,fixture));
  }
  for(const edit of [r=>r.runtime.choice='full_vocal',r=>r.runtime.parts.pop(),r=>r.runtime.notes.pop(),r=>r.runtime.notes[1].audible=true,r=>r.runtime.notes[0].end_microseconds.numerator='133500266',r=>r.runtime.parts[1].mix.mute=false,r=>r.runtime.source_sha256='0'.repeat(64),r=>r.compilation.score.parts.pop(),r=>r.navigation=null]){
    const bad=structuredClone(fixture.runtime);edit(bad);assert.throws(()=>validateVsqAuthoringRuntime(bad,fixture));
  }
});

test('ZIP verification rejects source extras, missing files and even whitespace changes to captured clean bytes',()=>{
  const folder=`songs/vsq-${sourceSha256}`,entries=[['manifest.json',JSON.stringify({format:'worldmusichub-song-pack',version:2,songs:[{folder}]})],[`${folder}/metadata.json`,fixture.draft.package.metadata_json],[`${folder}/score.json`,fixture.draft.package.score_json]];
  assert.equal(assertVsqAuthoringZip(storedZip(entries),fixture).length,3);
  for(const bad of [entries.slice(0,2),[...entries,['source.vsq',fixture.bytes]],entries.map(([name,value])=>[name,name.endsWith('score.json')?`${value}\n`:value]),entries.map(([name,value])=>[name,name.endsWith('metadata.json')?`${value} `:value])])assert.throws(()=>assertVsqAuthoringZip(storedZip(bad),fixture));
  for(const edit of [m=>m.source_base64=fixture.request.source_base64,m=>m.songs[0].runtime=fixture.runtime]){const manifest=JSON.parse(entries[0][1]);edit(manifest);assert.throws(()=>assertVsqAuthoringZip(storedZip([['manifest.json',JSON.stringify(manifest)],...entries.slice(1)]),fixture));}
});

test('stdio check fails closed without an explicit driver and never claims GUI or final acceptance',async()=>{
  const env={...process.env};delete env.WMH_NATIVE_IMPORT_DRIVER;delete env.WMH_VSQ_AUTHORING_REPORT;
  const result=spawnSync(process.execPath,['scripts/check-vsq-authoring-native.mjs'],{cwd:new URL('../',import.meta.url),env,encoding:'utf8',timeout:10000});
  assert.equal(result.status,1);assert.match(result.stderr,/exact-source native_import_driver/);assert.equal(result.stdout,'');
  const source=await readFile(new URL('../scripts/check-vsq-authoring-native.mjs',import.meta.url),'utf8');
  assert.match(source,/startVsqNativeDriver/);assert.match(source,/scope:'real-native-stdio'/);assert.match(source,/full_checkpoint_acceptance:false/);
  assert.equal(/createServer|playwright|launchBrowser|cargo\s+(?:run|build)/.test(source),false);
});

// Finite verifier-contract fragments only. These deliberately omit the native
// report, screenshot, transport and archive evidence required for acceptance.
function pickerFragment(){
  return{phase:'vsq-authoring-seed',pickerObservations:[{sequence:5,file:fixture.filename,completed:true,started_wall_ms:10,finished_wall_ms:20,
    files:[{filename:fixture.filename,bytes:fixture.bytes.length,sha256:fixture.manifest.sha256}],
    delegated:[{id:'authoring-files',type:'click',trusted:false}],
    changes:[{trusted:true,count:1,input:{id:'authoring-files',type:'file',multiple:true,disabled:false,connected:true}}],
    blurs:[{trusted:true,started_wall_ms:12,finished_wall_ms:13,state:{cue:'paused',clock:'100',pressed:0}}]}],
    trusted:[{sequence:5,type:'click',trusted:true,id:'authoring-choose',role:'choose',code:null,value:null},{sequence:5,type:'change',trusted:true,id:'authoring-files',role:null,code:null,value:''}]};
}
function isolationFragment(phase='vsq-authoring-seed'){
  const report=pickerFragment();report.phase=phase;if(phase==='vsq-authoring-restart'){report.pickerObservations=[];report.trusted=[];}
  report.actions=30;report.baselineScope={humanActionStart:8,humanActionEnd:11,lastPickerAction:phase==='vsq-authoring-seed'?5:0,readyAfterAction:15,readyAt:30,requestStart:0};
  report.soundEnabledAction=12;report.beforeTakeState={title:'Original exercise',stage:'Original exercise',mode:'practice',clock:'130',captured:'1',pass:'2',revision:'1',cue:'paused',soundMuted:false,pressed:0};report.afterTakeState=structuredClone(report.beforeTakeState);
  const quiet=()=>({sourceStarts:0,oscillatorStarts:0,activeSources:0,pendingSources:0});
  report.isolation={authoringKey:18,settingsOpen:19,settingsKey:20,audio:quiet(),afterExportAudio:quiet(),requestEnd:phase==='vsq-authoring-seed'?1:0};
  report.requests=phase==='vsq-authoring-seed'?[{path:'/api/library/import/commit',actionSequence:16}]:[];
  if(phase==='vsq-authoring-seed')report.saveAction=16;
  report.originalScoreSetup={kind:'scripted-menu',previewId:'original-built-in'};
  for(const [id,sequence]of [['stage-title',10],['song-authoring-title',18],['instrument-settings-summary',20]])for(const type of ['keydown','keyup'])report.trusted.push({id,sequence,type,code:'KeyR',trusted:true});
  report.trusted.push({id:'sound-button',sequence:12,type:'click',trusted:true},{id:'settings-button',sequence:19,type:'click',trusted:true});
  return report;
}
test('VSQ picker verifier requires original file, owned input and visible trusted trigger in the same action',()=>{
  validateVsqAuthoringPicker(pickerFragment(),fixture);
  for(const edit of [
    r=>r.pickerObservations[0].files[0].sha256='0'.repeat(64),
    r=>r.pickerObservations[0].files[0].bytes--,
    r=>r.pickerObservations[0].files.push({...r.pickerObservations[0].files[0]}),
    r=>r.pickerObservations[0].completed=false,
    r=>r.pickerObservations[0].changes[0].trusted=false,
    r=>r.pickerObservations[0].changes[0].input.connected=false,
    r=>r.pickerObservations[0].delegated=[],
    r=>r.pickerObservations[0].blurs[0].state.cue='ready',
    r=>r.pickerObservations[0].blurs[0].finished_wall_ms=21,
    r=>r.trusted=r.trusted.filter(e=>e.id!=='authoring-choose'),
    r=>r.trusted.find(e=>e.id==='authoring-choose').trusted=false,
    r=>r.trusted.find(e=>e.id==='authoring-choose').sequence=4,
  ]){const bad=pickerFragment();edit(bad);assert.throws(()=>validateVsqAuthoringPicker(bad,fixture));}
  validateVsqAuthoringPicker({phase:'vsq-authoring-restart',pickerObservations:[],trusted:[]},fixture);
  const restart=pickerFragment();restart.phase='vsq-authoring-restart';assert.throws(()=>validateVsqAuthoringPicker(restart,fixture));
});
test('VSQ isolation verifier binds native key and sound/settings clicks to the compared action window',()=>{
  for(const phase of ['vsq-authoring-seed','vsq-authoring-restart']){
    validateVsqAuthoringIsolation(isolationFragment(phase));
    for(const edit of [
      r=>r.afterTakeState.pass='3',r=>r.afterTakeState.clock='131',r=>r.beforeTakeState.soundMuted=true,
      r=>r.isolation.audio.oscillatorStarts=1,r=>r.isolation.afterExportAudio.pendingSources=1,
      r=>r.baselineScope.humanActionEnd++,r=>r.baselineScope.lastPickerAction=9,
      r=>{r.requests.push({path:'/api/library/runtime',actionSequence:19});r.isolation.requestEnd=r.requests.length;},
      r=>{r.requests.push({path:'/api/assess',actionSequence:19});r.isolation.requestEnd=r.requests.length;},
      r=>r.trusted.find(e=>e.id==='stage-title'&&e.type==='keydown').sequence=9,
      r=>r.trusted.find(e=>e.id==='song-authoring-title'&&e.type==='keyup').sequence=17,
      r=>r.trusted.find(e=>e.id==='instrument-settings-summary'&&e.type==='keydown').sequence=18,
      r=>r.trusted=r.trusted.filter(e=>e.id!=='settings-button'),
      r=>r.trusted.find(e=>e.id==='settings-button').trusted=false,
      r=>r.trusted.find(e=>e.id==='sound-button').sequence=13,
    ]){const bad=isolationFragment(phase);edit(bad);assert.throws(()=>validateVsqAuthoringIsolation(bad));}
  }
  const extraCommit=isolationFragment('vsq-authoring-restart');extraCommit.requests=[{path:'/api/library/import/commit',actionSequence:16}];extraCommit.isolation.requestEnd=1;assert.throws(()=>validateVsqAuthoringIsolation(extraCommit));
  const staleCommit=isolationFragment();staleCommit.requests[0].actionSequence=15;assert.throws(()=>validateVsqAuthoringIsolation(staleCommit));
});

// Geometry fragments verify admission rules only, never real Windows pixels.
function nativeViewportFragment({width=1024,height=689,scale=1,left=0}={}){
 const report={phase:'vsq-authoring-seed',origin:'https://wmh.localhost',actions:2,layout:{width,height,documentWidth:width},reviewLayout:{width,height},followingSurface:{viewport:{width,height}}};
 const host={phase:report.phase,process_id:3556,renderer_origin:report.origin,renderer_ok:true,actions:report.actions},actions=[1,2].map(sequence=>({version:1,sequence,kind:'click',x:21.25+sequence,y:60.5+sequence,width,height}));
 const client=[0,0,Math.round(width*scale),Math.round(height*scale)],origin=[left,31],work_area=[left,0,left+client[2],31+client[3]];
 const results=actions.map(action=>{const requested=[left+Math.floor(action.x*client[2]/width),31+Math.floor(action.y*client[3]/height)];return{ok:true,client_click:{client:[...client],origin:[...origin],work_area:[...work_area],viewport:[width,height],requested:[...requested],actual:[...requested],app_hwnd:123,hit_hwnd:456,hit_root:123,foreground:123}};});
 return{report,native:{host,actions,results}};
}
test('native VSQ viewport comes from every measured Win32 action while hosted sizes stay strict',()=>{
 for(const options of [{},{width:1100,height:800},{width:900,height:640},{width:1280,height:900},{scale:1.5,left:-1536}]){
  const {report,native}=nativeViewportFragment(options),viewport=validateVsqAuthoringViewport(report,native);assert.equal(viewport.width,report.layout.width);assert.deepEqual(viewport.clientSize,{width:native.results[0].client_click.client[2],height:native.results[0].client_click.client[3]});
  report.phase='vsq-authoring-restart';native.host.phase=report.phase;delete report.reviewLayout;validateVsqAuthoringViewport(report,native);
 }
 for(const mutate of [
  r=>r.report.layout.width++,r=>r.report.layout.height++,r=>r.report.layout.documentWidth+=2,r=>r.report.reviewLayout.height++,r=>r.report.followingSurface.viewport.width++,
  r=>r.native.host.phase='vsq-authoring-restart',r=>r.native.host.process_id=0,r=>r.native.host.renderer_origin='https://other.invalid',r=>r.native.host.renderer_ok=false,r=>r.native.host.actions++,
  r=>r.native.actions.pop(),r=>r.native.results.pop(),r=>r.native.actions[0].sequence=2,r=>r.native.actions[0].width++,r=>r.native.actions[0].x=-1,
  r=>r.native.results[0].ok=false,r=>r.native.results[0].client_click.client[2]--,r=>r.native.results[0].client_click.client[0]=1,
  r=>r.native.results[0].client_click.origin[0]++,r=>r.native.results[0].client_click.work_area[2]--,r=>r.native.results[0].client_click.work_area[0]=NaN,
  r=>r.native.results[0].client_click.requested[0]++,r=>r.native.results[0].client_click.actual[1]++,r=>r.native.results[0].client_click.viewport[0]++,
  r=>r.native.results[0].client_click.foreground=999,r=>r.native.results[0].client_click.hit_root=999,
  r=>{const c=r.native.results[1].client_click;c.app_hwnd=c.hit_root=c.foreground=999;},
  r=>{r.native.actions[0].kind='picker';r.native.results[0].owned_dialog={app_hwnd:123,process_id:999,app_process_id:999};},
 ]){const fragment=nativeViewportFragment();mutate(fragment);assert.throws(()=>validateVsqAuthoringViewport(fragment.report,fragment.native));}
 for(const dimensions of [{width:899,height:689},{width:1024,height:639},{width:1281,height:900},{width:1280,height:901}]){const {report,native}=nativeViewportFragment(dimensions);assert.throws(()=>validateVsqAuthoringViewport(report,native),/shell bounds/);}
 for(const [width,height]of [[1280,720],[1280,900],[1920,1080]])validateVsqAuthoringViewport({layout:{width,height,documentWidth:width}});
 assert.throws(()=>validateVsqAuthoringViewport(nativeViewportFragment().report),/Hosted viewport/);
});
function syntheticNativeWindow(width,height){
 const crc=bytes=>{let value=0xffffffff;for(const byte of bytes){value^=byte;for(let bit=0;bit<8;bit++)value=value>>>1^((value&1)?0xedb88320:0);}return(value^0xffffffff)>>>0;};
 const chunk=(name,data)=>{const bytes=Buffer.alloc(data.length+12);bytes.writeUInt32BE(data.length);bytes.write(name,4);data.copy(bytes,8);bytes.writeUInt32BE(crc(bytes.subarray(4,-4)),bytes.length-4);return bytes;};
 const header=Buffer.alloc(13);header.writeUInt32BE(width);header.writeUInt32BE(height,4);header[8]=8;header[9]=2;
 const pixels=Buffer.alloc((width*3+1)*height);let value=17;for(let i=0;i<pixels.length;i++){value=(Math.imul(value,1664525)+1013904223)>>>0;pixels[i]=i%(width*3+1)?value>>>24:0;}
 return Buffer.concat([Buffer.from('89504e470d0a1a0a','hex'),chunk('IHDR',header),chunk('IDAT',deflateSync(pixels)),chunk('IEND',Buffer.alloc(0))]);
}
test('native VSQ screenshots must contain the real client and share the phase window dimensions',()=>{
 const {report,native}=nativeViewportFragment(),viewport=validateVsqAuthoringViewport(report,native),image=syntheticNativeWindow(1024,720),pixels=validateVsqAuthoringNativeScreenshot(image,viewport);
 assert.deepEqual(pixels,{width:1024,height:720});validateVsqAuthoringNativeScreenshot(image,viewport,pixels);
 assert.throws(()=>validateVsqAuthoringNativeScreenshot(syntheticNativeWindow(1023,720),viewport),/measured native client/);
 assert.throws(()=>validateVsqAuthoringNativeScreenshot(syntheticNativeWindow(1024,688),viewport),/measured native client/);
 assert.throws(()=>validateVsqAuthoringNativeScreenshot(syntheticNativeWindow(1280,900),viewport,pixels),/same native window/);
 const altered=Buffer.from(image);altered[20]^=1;assert.throws(()=>validateVsqAuthoringNativeScreenshot(altered,viewport));
});
test('native and hosted VSQ callers retain source, exact requested viewport and mandatory screenshot gates',async()=>{
 const native=await readFile(new URL('../scripts/verify-native-vsq-authoring-evidence.mjs',import.meta.url),'utf8'),hosted=await readFile(new URL('../scripts/hosted-vsq-authoring-check.mjs',import.meta.url),'utf8'),windows=await readFile(new URL('../crates/desktop-shell/src/windows.rs',import.meta.url),'utf8');
 assert.match(native,/assert\.equal\(native\.ok,true\)/);assert.match(native,/\['source_sha','source_tree'\]/);assert.match(native,/verifyNativeProfileEvidence\(native,VSQ_AUTHORING_PHASES,json\)/);
 assert.ok(native.indexOf('results.push(result)')<native.indexOf('validateVsqAuthoringRenderer(report,fixture,nativeEvidence)'));
 assert.match(native,/validateVsqAuthoringNativeScreenshot\(await read\(`native-action-/);assert.match(native,/validateVsqAuthoringNativeScreenshot\(await read\(`native-\$\{host\.phase\}\.png/);
 assert.match(hosted,/validateVsqAuthoringRenderer\(renderer\);assert\.deepEqual\(\{width:renderer\.layout\.width,height:renderer\.layout\.height\},\{width,height\}\)/);
 assert.match(windows,/\.inner_size\(1280\.0, 900\.0\)/);assert.match(windows,/\.min_inner_size\(900\.0, 640\.0\)/);assert.match(windows,/\.prevent_overflow\(\)/);
});
