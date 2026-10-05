import {syntheticSongModControls} from './song-mod-control-evidence-fixtures.js';
import {readPlaybackClock} from '../web/playback-clock-view.js';
import {evidenceClockNode,setEvidencePlaybackClock} from './playback-clock-evidence-fixtures.js';
import {syntheticOwnedPickerGestures as syntheticPickerGestures,syntheticOwnedFilePicker} from './owned-file-picker-fixtures.js';
import {syntheticLiveToneEvidence,liveToneCleanup} from './live-tone-evidence-fixtures.js';
// These are verifier/fixture contracts, never evidence of a real UI or Windows run.
import test from 'node:test';
import {syntheticAudioThreadRun,syntheticAudioThreadStatus} from './audio-thread-proof-fixtures.js';
import {validateAudioThreadStatus} from '../scripts/audio-thread-rendition-proof.mjs';
import {syntheticBasicKeyNotationEvidence} from './basic-key-notation-evidence-fixtures.js';
import {validateBasicKeyNotationEvidence,validateBasicKeyNotationResponse} from '../scripts/basic-key-notation-proof.mjs';
import assert from 'node:assert/strict';
import {readFile,mkdir,writeFile,mkdtemp,rm} from 'node:fs/promises';
import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import {deflateSync} from 'node:zlib';
import {tmpdir} from 'node:os';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import vm from 'node:vm';
import {parseHTML} from 'linkedom';
import {basicKeyNativeRendition,expectedBasicKeySchedules,validateBasicKeyListening,validateBasicKeySchedules,BASIC_KEY_HUMAN_PART,BASIC_KEY_HUMAN_CODE} from '../scripts/basic-key-rendition-proof.mjs';
import {basicKeyAcceptanceFixture,originalBasicKeyMidi,prepareBasicKeyFixtures,BASIC_KEY_FILES,BASIC_KEY_PHASES} from '../scripts/prepare-basic-key-fixtures.mjs';
import {validateBasicKeyOpened,validateBasicKeyExport,validateBasicKeyRequests,validateBasicKeyRenderer,validateBasicKeyTakes,validateBasicKeySourceMeterDisclosure,validateBasicKeyInputPreparation,validateBasicKeyNativeKey,validateBasicKeyNativeFollow,verifyBasicKeyNativeEvidence} from '../scripts/verify-basic-key-evidence.mjs';
import {storedZip} from './native-import-driver-fixtures.js';
import {digest} from './clean-song-package-fixtures.js';
import {readBulkEvidenceZip} from '../scripts/verify-native-bulk-import-evidence.mjs';
import {addNativeProfileEvidence} from './native-profile-evidence-fixtures.js';
const fixture=basicKeyAcceptanceFixture();
function syntheticScreenshot(){const crc=b=>{let c=0xffffffff;for(const v of b){c^=v;for(let i=0;i<8;i++)c=c>>>1^((c&1)?0xedb88320:0);}return(c^0xffffffff)>>>0;},chunk=(name,data)=>{const b=Buffer.alloc(data.length+12);b.writeUInt32BE(data.length);b.write(name,4);data.copy(b,8);b.writeUInt32BE(crc(b.subarray(4,-4)),b.length-4);return b;};const header=Buffer.alloc(13);header.writeUInt32BE(640);header.writeUInt32BE(360,4);header[8]=8;header[9]=2;const pixels=Buffer.alloc(1921*360);let value=17;for(let i=0;i<pixels.length;i++){value=(Math.imul(value,1664525)+1013904223)>>>0;pixels[i]=i%1921?value>>>24:0;}return Buffer.concat([Buffer.from('89504e470d0a1a0a','hex'),chunk('IHDR',header),chunk('IDAT',deflateSync(pixels)),chunk('IEND',Buffer.alloc(0))]);}

function opened(){return basicKeyNativeRendition().open;}
function transport(){const state={passId:'1',captured:'1',cue:'paused',phase:'paused',hidden:false,openDialogs:[],positionMs:900,durationMs:12000};return{version:1,stage:'complete',omitted:0,rowBytes:3000,trustedPlayClicks:2,trustedKeyDowns:1,trustedKeyUps:1,current:state,rows:[{kind:'ready',elapsedMs:0,state:{...state,positionMs:0,captured:'0'}},{kind:'transport',elapsedMs:20,state:{...state,phase:'capturing',positionMs:200}},{kind:'key-focus-ready',elapsedMs:25,state:{...state,phase:'capturing',positionMs:300,focused:true,activeElement:'stage-title'}},{kind:'event',elapsedMs:30,state:{...state,phase:'capturing',focused:true,activeElement:'stage-title'},event:{type:'keydown',trusted:true,code:'Digit2',surface:'stage-title',repeat:false,eventTime:1100}},{kind:'event',elapsedMs:40,state,event:{type:'keyup',trusted:true,code:'Digit2',surface:'stage-title',repeat:false,eventTime:1140}}]};}
function schedules({targetPart=null,...options}={}){const runtime=opened().clean_package.runtime;return[syntheticAudioThreadRun(expectedBasicKeySchedules(runtime).filter(note=>note.part!==targetPart),{sourceSha256:runtime.source_sha256,durationMs:12020,sourceNotes:5,...options})];}
function listening(){const paused={wallMs:100,position:750,captured:'0',assessments:0,scheduled:1,audio:{activeSources:0,pendingSources:0,sourceStarts:0,oscillatorStarts:0,worklet:syntheticAudioThreadStatus({completed:0})}};return{version:2,before:{captured:'0',assessments:0},paused,afterPause:{...paused,wallMs:200},ended:{...paused,position:12020,renderer:'ended'},audioThread:[...schedules({cancelMs:750}),...schedules({positionMs:750,receiverId:2})],takeState:{historyHidden:true,passOptions:[''],exportDisabled:true,assessmentDisabled:true},following:{stopped:true,overflow:false,rows:opened().clean_package.runtime.compilation.timeline.notes.map(n=>({position:n[4]+1,renderer:'playing',ids:[n[0]],rails:['midi-t1-e4','midi-t3-e1'].includes(n[0])?[]:[n[0]],measure:'0'}))},replayAudioThread:schedules({receiverId:3}),replayEnd:{position:12020,renderer:'ended',captured:'0',assessments:0,audio:{activeSources:0,pendingSources:0,sourceStarts:0,worklet:syntheticAudioThreadStatus()}}};}
function allParts(){const f={scope:'all',status:'ready',rendered:['midi-t1-c1-r0','midi-t2-c10-r0','midi-t3-c1-r0'],human:'midi-t1-c1-r0',mix:['midi-t1-c1-r0','midi-t2-c10-r0','midi-t3-c1-r0'].map(id=>({id,checked:true})),parts:[{id:'midi-t1-c1-r0',visible:true},{id:'midi-t3-c1-r0',visible:true}],rows:[{id:'midi-t2-e1',part:'midi-t2-c10-r0',visible:true}],glyphs:[{visible:true}],bounds:{visible:true},coverage:'显示 3 / 3 个声部',scrollTop:0,scrollHeight:500,clientHeight:300};return{frames:[structuredClone(f),{...structuredClone(f),scrollTop:100}],after:structuredClone(f),responses:basicKeyNativeRendition().pages};}
function sourceMeterDisclosure(){
 const surface=(id,text)=>({id,text,visible:true,bounds:{x:750,y:180,width:300,height:40}});
 return{locale:'zh-CN',viewport:{width:1280,height:720},choice:{label:surface('engraving-basic-meter-label','来源拍号未确定时使用的显示拍号'),control:{...surface('engraving-basic-meter','使用来源拍号'),value:'source',disabled:false},provenance:surface('engraving-basic-provenance','基础解释 v1；原始源记谱保持不变。')},status:surface('engraving-status','来源没有明确的起始拍号。此选择不会添加来源拍号事件，也不会改变练习时序。')};
}
function originalFirstSteps(){const score=JSON.parse(JSON.parse(readFileSync(new URL('fixtures/first-steps-transposed-v1.json',import.meta.url),'utf8')).source.content).original;score.source=null;return score;}
function firstStepsBootstrapRequest(){return JSON.parse(readFileSync(new URL('fixtures/first-steps-bootstrap-request.json',import.meta.url),'utf8'));}
function addRequestEvidence(r){
 const e={version:1,rows:[],events:0,bootstrap:null,selection:null,restored:true},tick=()=>++e.events;
 const add=(path,body,response)=>{const row={index:e.rows.length,path,method:body===undefined?'GET':'POST',started:tick(),settled:tick(),status:200,scope:e.selection?'selected':'bootstrap',previewId:e.selection?`native:${r.key}`:'first-steps',requestBody:body===undefined?null:JSON.stringify(body)};if(response!==undefined){row.consumed=tick();row.response=response;}e.rows.push(row);return row;};
 add('/api/catalog/index');add('/api/health');add('/api/catalog/score/first-steps',undefined,originalFirstSteps());add('/api/library/list');add('/api/compile',originalFirstSteps(),{score:originalFirstSteps()});
 for(const path of ['/api/practice-targets','/api/instrument-check'])add(path,firstStepsBootstrapRequest());
 const before={previewId:'first-steps',previewStatus:'ready',practiceDisabled:false};e.bootstrap={event:tick(),requestCount:e.rows.length,...before};e.selection={event:tick(),requestCount:e.rows.length,key:r.key,trusted:true,before,ready:null};
 add('/api/library/load',{key:r.key});e.selection.ready={event:tick(),requestCount:e.rows.length,previewId:`native:${r.key}`,previewStatus:'ready',practiceDisabled:false,contentSha256:r.opened.clean_package.content_sha256,sourceSha256:r.opened.clean_package.runtime.source_sha256};
 for(const request of r.assessmentRequests)add('/api/assess',request);
 r.requests=e.rows.map(row=>row.path);r.requestEvidence=e;return r;
}
function renderer(phase){const o=opened(),key=`song-${o.clean_package.content_sha256}`,preview={tracks:fixture.score.performance.tracks.map(t=>`${t.name} · ${t.events.length} retained events · 保留 ${t.events.length} 个事件`),parts:[{disabled:false},{disabled:false},{disabled:false}],startDisabled:false,modDisabled:false,audio:{sourceStarts:0}};const r={version:1,phase,ok:true,cleanupErrors:[],origin:'https://wmh.localhost',profileMarkerAbsent:true,errors:[],key,opened:o,inventory:[{key}],previews:{en:{...preview,coverage:'18 source events retained · 5 attacks: 3 positive determined, 1 instantaneous, 1 unresolved',rendition:'Basic interpretation v1 retains all 5 note onsets with default synthesized sounds'},'zh-CN':{...preview,coverage:'18 个源事件 · 5 次按键：3 个已确定正时长、1 个瞬时、1 个结束未确定',rendition:'基础解释 v1 包含全部 5 次起音与默认合成声音'}},stageState:{target:BASIC_KEY_HUMAN_PART,notationPart:BASIC_KEY_HUMAN_PART,countInDisabled:true,tempo:'120',range:'35～72 · 5 个可练目标',partCheckboxes:[{id:'midi-t1-c1-r0',disabled:false,checked:true},{id:'midi-t2-c10-r0',disabled:false,checked:true},{id:BASIC_KEY_HUMAN_PART,disabled:true,checked:false}]},noInput:{captured:'0',soundMuted:false,audio:{sourceStarts:0,worklet:syntheticAudioThreadStatus({activeReceivers:1})}},humanAudio:{sourceStarts:0},humanLiveAudio:syntheticLiveToneEvidence(),liveToneCleanup:{...liveToneCleanup},completePractice:{accuracy:'100%',audioThread:schedules({targetPart:BASIC_KEY_HUMAN_PART}),ended:{position:12020,captured:'1',assessments:2,audio:{activeSources:0,pendingSources:0,worklet:syntheticAudioThreadStatus()}}},receiverCleanup:{restored:true,overflow:false,errors:[],cleanupErrors:[]},fetchRestored:true,engravingRestored:true,currentPartView:{scope:'current',status:'ready',rendered:[BASIC_KEY_HUMAN_PART],noteIds:['midi-t3-e1'],glyphs:[{visible:true}]},accompaniment:schedules({targetPart:BASIC_KEY_HUMAN_PART,cancelMs:750}),requests:[],layout:{width:1280,height:720,documentWidth:1280},trusted:[{type:'change',id:'engraving-follow',trusted:true,checked:true,actionSequence:6},{type:'keydown',code:'Digit2',trusted:true},...['start-performance','engraving-basic-meter','engraving-page-size','progress','jianpu-button'].map(id=>({id,type:id==='progress'?'input':id.startsWith('engraving-')?'change':'click',trusted:true}))],negative:[{file:BASIC_KEY_FILES.profile,ready:0,statuses:[{status:'retained_nonplayable',playable:false,code:'pack_source_only',message:'Invalid complete profile; inspect source'}],text:'Invalid complete profile; inspect source',inventory:0},{file:BASIC_KEY_FILES.coverage,ready:0,statuses:[{status:'retained_nonplayable',playable:false,code:'pack_source_only',message:'Invalid complete profile; inspect source'}],text:'Invalid complete profile; inspect source · Forged coverage; re-create the complete package',inventory:0}],imports:[{body:{summary:{saved:1}}}],actions:7,allParts:allParts(),sourceMeterDisclosure:sourceMeterDisclosure(),pickerObservations:phase==='basic-key-seed'?[BASIC_KEY_FILES.profile,BASIC_KEY_FILES.coverage,BASIC_KEY_FILES.valid].map((filename,index)=>syntheticOwnedFilePicker(filename,index+1).observation):[],screenshots:Object.fromEntries(['english','chinese','track0','track1','track2','track3','track4',...(phase==='basic-key-seed'?[BASIC_KEY_FILES.profile,BASIC_KEY_FILES.coverage,'listen-paused','listen-end','listen-empty-results','all-parts','all-scroll-0']:['stage','human','meter-choice','meter-status',...['first','crossed','numbered','end','reset'].map(n=>`notation-${n}`)])].map(role=>[role,7])),assessmentRequests:[{inputs:[{midi:72,velocity:90,at_ms:500}],tolerance_ms:180,timeline:{notes:[{id:'midi-t3-e1'}]}}],assessmentResponses:[{status:200,body:{accuracy_percent:100,hits:[{note_id:'midi-t3-e1',midi:72,expected_ms:500,actual_ms:500,delta_ms:0,grade:'perfect'}],misses:[],extras:[]}}],transportAdmission:transport(),keyPreparation:{playAction:4,keyAction:5,readyWallMs:25,readyPositionMs:300,dispatchWallMs:29,dispatchPositionMs:350,focused:true,activeElement:'stage-title'},...(phase==='basic-key-restart'?{notation:syntheticBasicKeyNotationEvidence(),practiceAssessmentStart:1,assessmentRequests:[syntheticBasicKeyNotationEvidence().naturalAssessment.request,{inputs:[{midi:72,velocity:90,at_ms:500}],tolerance_ms:180,timeline:{notes:[{id:'midi-t3-e1'}]}}],assessmentResponses:[syntheticBasicKeyNotationEvidence().naturalAssessment.response,{status:200,body:{accuracy_percent:100,hits:[{note_id:'midi-t3-e1',midi:72,expected_ms:500,actual_ms:500,delta_ms:0,grade:'perfect'}],misses:[],extras:[]}}]}:{}),listening:listening(),files:phase==='basic-key-seed'?{package:`${phase}-3.zip`}:{machineTake:`${phase}-1.json`,humanTake:`${phase}-2.json`}};if(phase==='basic-key-seed'){r.assessmentRequests=[];r.assessmentResponses=[];}r.pickerFileEvents=r.pickerObservations.flatMap(row=>syntheticOwnedFilePicker(row.filename,row.sequence).events);const mod=syntheticSongModControls({first:'midi-t1-c1-r0',target:BASIC_KEY_HUMAN_PART,start:8});r.modActions=mod.modActions;r.trusted.push(...mod.trusted);r.actions=mod.actions;return addRequestEvidence(r);}
function take(human){const input={midi:72,velocity:90,at_ms:500},id=fixture.score.notation.id;return{version:1,score_id:id,practice_part:BASIC_KEY_HUMAN_PART,passes:[{id:1,capture_enabled:true,interpretation:{policy_id:'wmh-basic-key-rendition-fifo-v1',runtime_profile:'wmh-basic-key-practice-v2',source_sha256:fixture.manifest.source.sha256,package_content_sha256:fixture.manifest.package.content_sha256,practice_part:BASIC_KEY_HUMAN_PART,source_target_ids:['midi-t3-e1'],policy:opened().clean_package.runtime.rendition.policy},timeline:{notes:[{id:'midi-t3-e1',midi:72}]},inputs:human?[input]:[],captures:human?[{event_id:1,event_wall_ms:1100,received_wall_ms:1101,input}]:[],assessment:human?{accuracy_percent:100,hits:[{note_id:'midi-t3-e1',midi:72,expected_ms:500,actual_ms:500,delta_ms:0,grade:'perfect'}],misses:[],extras:[]}:null}],input_evidence:{version:1,truncated:false,omitted_observations:0,events:human?[{event_id:1,kind:'note_on',source_id:'source-1',raw_timestamp_ms:1100,timestamp_basis:'event_monotonic',input_kind:'typing_keyboard',encoding:'key_down',midi:72,velocity:90,event_wall_ms:1100,received_wall_ms:1101,onset_capture:{pass_id:1,event_id:1}},{event_id:2,kind:'note_off',encoding:'key_up'}]:[]}};}
function exported(key){return storedZip([...fixture.files].map(([name,b])=>[`songs/${key}/${name}`,b]).concat([['manifest.json',JSON.stringify({format:'worldmusichub-song-pack',version:2,songs:[{folder:`songs/${key}`} ]})]]));}
test('original basic-key fixture retains unsupported records, all tracks and source hash',()=>{assert.equal(digest(originalBasicKeyMidi()),'7e5fea609420469fc4178cb8f1d740c80a3f07d0833632794aa0cd68375e5315');assert.equal(fixture.source.length,130);assert.deepEqual(fixture.score.performance.tracks.map(t=>t.events.length),[9,3,3,2,1]);assert.deepEqual(fixture.score.performance.tracks[0].events.slice(0,3),[[0,[176,0,7]],[0,[192,42]],[0,[176,74,91]]]);assert.deepEqual(fixture.score.notation.meters,[]);assert.deepEqual(fixture.score.notation.tempo,[]);assert.equal(fixture.score.coverage.projected_melodic_targets,2);assert.equal(fixture.score.coverage.key_attacks,5);assert.equal(fixture.score.coverage.zero_length_attacks,1);assert.equal(fixture.score.coverage.unresolved_ends,1);assert.deepEqual([...readBulkEvidenceZip(fixture.bytes).keys()].sort(),['manifest.json','songs/original-basic-key/metadata.json','songs/original-basic-key/score.json']);assert.equal(fixture.manifest.rights.license,'CC0-1.0');});
test('negative fixtures have valid outer score hashes and fail actual profile/coverage semantics',()=>{for(const[id,bytes]of Object.entries(fixture.variants)){const files=readBulkEvidenceZip(bytes),meta=JSON.parse(files.get('songs/original-basic-key/metadata.json')),scoreBytes=files.get('songs/original-basic-key/score.json'),score=JSON.parse(scoreBytes);assert.equal(meta.score.sha256,digest(scoreBytes));assert.equal(meta.score.bytes,scoreBytes.length);assert.equal(score.source.sha256,fixture.score.source.sha256);if(id==='profile')assert.notEqual(score.performance.profile,fixture.score.performance.profile);else assert.equal(score.coverage.represented_events,fixture.score.coverage.represented_events-1);}});
test('receiver proof rejects lost sources, fabricated targets and absent honest UI evidence',()=>{validateBasicKeyOpened(opened());for(const mutate of [o=>o.clean_package.content_sha256='0'.repeat(64),o=>o.clean_package.score_json+=' ',o=>o.clean_package.runtime.parts.pop(),o=>o.clean_package.runtime.compilation.timeline.notes.push({id:'drum',midi:35,duration_ms:250}),o=>o.clean_package.runtime.reference_audio='available']){const value=opened();mutate(value);assert.throws(()=>validateBasicKeyOpened(value));}const r=renderer('basic-key-seed');validateBasicKeyRenderer(r);for(const mutate of [v=>v.previews['zh-CN'].tracks.pop(),v=>v.previews.en.parts[1].disabled=true,v=>v.trusted[1].trusted=false,v=>v.negative[0].statuses[0].playable=true,v=>v.inventory=[],v=>v.layout.documentWidth=2000]){const value=structuredClone(r);mutate(value);assert.throws(()=>validateBasicKeyRenderer(value));}});
test('incomplete renderer failure reports expose the causal error and stage before later evidence gates',()=>{
 for(const phase of BASIC_KEY_PHASES){
  const failure={version:1,phase,ok:false,stage:'trusted-keyboard-score',actions:0,screenshots:{},error:'Error: original diagnostic sentinel\n    at originalFixture'};
  assert.throws(()=>validateBasicKeyRenderer(failure),error=>{
   assert.match(error.message,new RegExp(`Basic-key ${phase} failed at trusted-keyboard-score`));
   assert.ok(error.message.includes(failure.error));
   assert.doesNotMatch(error.message,/deep-equal|screenshots|pickerObservations/);return true;
  });
  const successful=renderer(phase);delete successful.screenshots[phase==='basic-key-seed'?'listen-end':'human'];
  assert.throws(()=>validateBasicKeyRenderer(successful),/deep-equal/);
 }
});
test('small browser diagnostic artifacts are additive and contain only reports and the failure image',()=>{
 for(const[name,job,fullName]of [['basic-key-preview.yml','basic-key-browser','basic-key-browser-'],['windows-desktop-acceptance.yml','bulk-import-browser','bulk-import-browser-']]){
  const parsed=spawnSync('python3',['scripts/check-authoring-workflow.py','--json',fileURLToPath(new URL(`../.github/workflows/${name}`,import.meta.url))],{encoding:'utf8'});
  assert.equal(parsed.status,0,parsed.stderr);const steps=JSON.parse(parsed.stdout).jobs[job].steps;
  const diagnostics=steps.filter(s=>s.with?.name==='basic-key-browser-diagnostics-${{ github.sha }}');assert.equal(diagnostics.length,1);
  const diagnostic=diagnostics[0];assert.equal(diagnostic.if,'always()');assert.match(diagnostic.uses,/^actions\/upload-artifact@043fb46d1a93c77aae656e7c1c64a875d1fc6a0a/);
  assert.deepEqual(diagnostic.with.path.trim().split('\n'),['test-results/basic-key/*/report.json','test-results/basic-key/*/renderer-basic-key-*.json','test-results/basic-key/*/browser-basic-key-failure.png']);
  const full=steps.find(s=>s.with?.name===fullName+'${{ github.sha }}');assert.ok(full);assert.equal(full.if,'always()');assert.ok(steps.indexOf(diagnostic)<steps.indexOf(full));
  assert.ok(full.with.path.includes(name==='basic-key-preview.yml'?'test-results/basic-key/*/Scores/clean-backups/**':'test-results/basic-key/**'));
 }
});
test('request proof retains startup compile and forbids late, wrong-source and incomplete boundaries in both phases',()=>{
 for(const phase of BASIC_KEY_PHASES){
  const baseline=renderer(phase);validateBasicKeyRequests(baseline);validateBasicKeyRenderer(baseline);
  for(const mutate of [
   r=>delete r.requestEvidence,r=>r.requests=[],r=>r.requestEvidence.rows.splice(4,1),r=>r.requests.splice(4,1),
   r=>{r.requests.splice(4,1);r.requestEvidence.rows.splice(4,1);r.requestEvidence.rows.forEach((row,index)=>row.index=index);},
   r=>r.requestEvidence.bootstrap=null,r=>r.requestEvidence.bootstrap.previewStatus='loading',r=>r.requestEvidence.bootstrap.practiceDisabled=true,
   r=>r.requestEvidence.selection=null,r=>r.requestEvidence.selection.trusted=false,r=>r.requestEvidence.selection.requestCount++,r=>r.requestEvidence.selection.event++,
   r=>r.requestEvidence.selection.before.previewId=`native:${r.key}`,r=>r.requestEvidence.selection.key='wrong-source',r=>r.requestEvidence.selection.ready=null,
   r=>r.requestEvidence.selection.ready.previewId='first-steps',r=>r.requestEvidence.selection.ready.contentSha256='0'.repeat(64),r=>r.requestEvidence.selection.ready.sourceSha256='0'.repeat(64),
   r=>r.requestEvidence.rows[4].requestBody=JSON.stringify({...originalFirstSteps(),id:'another-score'}),
   r=>{const score=originalFirstSteps();score.parts[0].notes[0].pitch.step='D';r.requestEvidence.rows[4].requestBody=JSON.stringify(score);r.requestEvidence.rows[2].response=score;r.requestEvidence.rows[4].response={score};},
   r=>r.requestEvidence.rows[4].requestBody=JSON.stringify(fixture.score),r=>delete r.requestEvidence.rows[2].response,r=>delete r.requestEvidence.rows[4].consumed,
   r=>r.requestEvidence.rows[4].settled=r.requestEvidence.selection.event,r=>r.requestEvidence.rows[4].scope='selected',
   r=>r.requestEvidence.rows[7].requestBody=JSON.stringify({key:'wrong-source'}),r=>r.requestEvidence.rows[7].status=500,
   r=>{const row=r.requestEvidence.rows[7];row.path='/api/library/runtime';r.requests[7]=row.path;},
  ]){const value=structuredClone(baseline);mutate(value);assert.throws(()=>validateBasicKeyRequests(value));}
  for(const path of ['/api/compile','/api/compile?fallback=1','/api/library/runtime','/api/library/runtime?fallback=1']){
   const r=structuredClone(baseline),e=r.requestEvidence;e.rows.push({...structuredClone(e.rows[4]),index:e.rows.length,path,started:++e.events,settled:++e.events,consumed:++e.events,scope:'selected',previewId:`native:${r.key}`});r.requests.push(path);assert.throws(()=>validateBasicKeyRequests(r));
  }
  assert.deepEqual(baseline.requests.slice(0,7),['/api/catalog/index','/api/health','/api/catalog/score/first-steps','/api/library/list','/api/compile','/api/practice-targets','/api/instrument-check']);
 }
 const restart=renderer('basic-key-restart'),machine=take(false),human=take(true),before=structuredClone({machine,human,requests:restart.assessmentRequests,notation:restart.notation});
 validateBasicKeyRenderer(restart);validateBasicKeyTakes(machine,human,restart);assert.deepEqual({machine,human,requests:restart.assessmentRequests,notation:restart.notation},before);
 restart.requestEvidence.rows.at(-1).requestBody=JSON.stringify({inputs:[]});assert.throws(()=>validateBasicKeyRequests(restart),/Every assessment/);
});
test('bootstrap checks bind the actual Rust Timeline shape to every original source note',()=>{
 const request=firstStepsBootstrapRequest();assert.deepEqual(Object.keys(request.timeline).sort(),['duration_ms','notes']);assert.equal(request.timeline.notes.length,15);assert.ok(!Object.hasOwn(request.timeline,'score_id'));
 for(const phase of BASIC_KEY_PHASES){
  const original=renderer(phase);validateBasicKeyRenderer(original);
  for(const mutate of [
   v=>v.timeline={score_id:'first-steps'},v=>v.timeline.score_id='first-steps',v=>delete v.timeline.duration_ms,
   v=>v.timeline.notes.pop(),v=>v.timeline.notes.push({...v.timeline.notes[0]}),v=>v.timeline.notes.reverse(),
   v=>v.timeline.notes[0].id='other-source',v=>v.timeline.notes[0].part_id='other-part',v=>v.timeline.notes[0].source_note_id='other-source',v=>v.timeline.notes[0].source_note_ids=[],
   v=>v.timeline.notes[0].midi++,v=>v.timeline.notes[0].velocity--,v=>v.timeline.notes[0].staff++,v=>v.timeline.notes[0].voice='2',
   v=>v.timeline.notes[0].start_ms++,v=>v.timeline.notes[0].duration_ms++,v=>v.timeline.duration_ms++,v=>v.timeline.notes[0].start_ms=null,
   v=>v.profile.key_count=88,v=>delete v.profile,
  ]){
   const changed=structuredClone(original),body=firstStepsBootstrapRequest();mutate(body);
   for(const row of changed.requestEvidence.rows.filter(row=>['/api/practice-targets','/api/instrument-check'].includes(row.path)))row.requestBody=JSON.stringify(body);
   assert.throws(()=>validateBasicKeyRequests(changed));
  }
  const mismatched=structuredClone(original),row=mismatched.requestEvidence.rows[6],body=JSON.parse(row.requestBody);body.timeline.notes[0].duration_ms+=1e-9;row.requestBody=JSON.stringify(body);
  assert.throws(()=>validateBasicKeyRequests(mismatched),/Both bootstrap checks/);
 }
});
test('request observer forwards real promises, waits for consumed bootstrap and records the trusted source boundary',async()=>{
 const source=await readFile(new URL('../crates/desktop-shell/basic-key-acceptance.js',import.meta.url),'utf8'),shared=await readFile(new URL('../crates/desktop-shell/vsq-song-acceptance.js',import.meta.url),'utf8');
 const lobby={dataset:{previewId:'first-steps',previewStatus:'ready'}},practice={disabled:true},handlers=new Map(),errors=[];
 const document={getElementById:id=>id==='song-lobby'?lobby:practice,addEventListener:(type,fn,capture)=>{assert.equal(capture,true);handlers.set(type,fn);},removeEventListener:(type,fn,capture)=>{assert.equal(handlers.get(type),fn);assert.equal(capture,true);handlers.delete(type);}};
 const context=vm.createContext({structuredClone,TextEncoder,Blob});
 vm.runInContext(shared.slice(shared.indexOf('function createVsqJsonObserver('),shared.indexOf('/* Actual rendered identities'))+source.slice(source.indexOf('function createBasicKeyRequestObserver('),source.indexOf('(() => {'))+';globalThis.create=createBasicKeyRequestObserver;',context);
 const observer=context.create(document,{onError:error=>errors.push(error)}),body=originalFirstSteps();
 async function request(path,value,responseBody,{consume=true}={}){
  const options=value===undefined?{}:{method:'POST',body:JSON.stringify(value)},returned=Promise.resolve(responseBody),calls=[];
  const response={status:200,json(...args){calls.push({receiver:this,args});return returned;}},json=response.json,promise=Promise.resolve(response);
  assert.equal(observer.observe(path,options,promise),promise);await promise;
  if(responseBody!==undefined&&consume){assert.equal(response.json('unchanged-argument'),returned);assert.equal(await returned,responseBody);await Promise.resolve();assert.equal(response.json,json);assert.equal(calls[0].receiver,response);assert.deepEqual(calls[0].args,['unchanged-argument']);}
  return response;
 }
 await request('/api/catalog/index');await request('/api/health');await request('/api/catalog/score/first-steps',undefined,body);
 await request('/api/library/list');const compile=await request('/api/compile',body,{score:body},{consume:false});
 practice.disabled=false;assert.equal(Boolean(observer.bootstrapReady()),false);assert.throws(()=>observer.markBootstrap(),/incomplete/);
 await compile.json();await Promise.resolve();practice.disabled=true;assert.equal(Boolean(observer.bootstrapReady()),false);
 await request('/api/practice-targets',firstStepsBootstrapRequest());await request('/api/instrument-check',firstStepsBootstrapRequest());practice.disabled=false;
 assert.equal(Boolean(observer.bootstrapReady()),true);observer.markBootstrap();assert.throws(()=>observer.markBootstrap(),/Duplicate/);
 const r=renderer('basic-key-seed');observer.expectSelection(r.key);
 const event=trusted=>({isTrusted:trusted,target:{closest:()=>({dataset:{libraryKey:`native:${r.key}`}})}});
 assert.throws(()=>handlers.get('click')(event(false)),/trusted/);assert.equal(observer.evidence.selection,null);
 handlers.get('click')(event(true));assert.equal(observer.evidence.selection.requestCount,7);assert.throws(()=>observer.markSelected(r.opened),/incomplete/);
 lobby.dataset.previewId=`native:${r.key}`;await request('/api/library/load',{key:r.key});observer.markSelected(r.opened);assert.throws(()=>observer.markSelected(r.opened),/incomplete/);
 const boundary=JSON.stringify(observer.evidence.selection);handlers.get('click')(event(true));assert.equal(JSON.stringify(observer.evidence.selection),boundary);
 observer.restore();assert.equal(handlers.size,0);assert.deepEqual(errors,[]);r.requests=[...observer.paths];r.requestEvidence=JSON.parse(JSON.stringify(observer.evidence));validateBasicKeyRequests(r);
 assert.equal(r.requestEvidence.rows[4].requestBody,JSON.stringify(body));assert.equal(r.requestEvidence.rows[7].scope,'selected');
 const runner=source.slice(source.indexOf("addEventListener('DOMContentLoaded'"));assert.ok(runner.indexOf('requestObserver.markBootstrap()')<runner.indexOf("if(phase==='basic-key-seed')"));assert.match(runner,/requestObserver\.expectSelection\(report\.key\);await native\('click'/);assert.match(runner,/completed application request evidence/);
});
test('export proof compares exact files including whitespace and refuses extra source payload',()=>{const key='song-test';validateBasicKeyExport(exported(key),fixture,key);const changed=new Map(readBulkEvidenceZip(exported(key)));changed.set(`songs/${key}/score.json`,Buffer.concat([fixture.files.get('score.json'),Buffer.from('\n')]));assert.throws(()=>validateBasicKeyExport(storedZip([...changed]),fixture,key));changed.set(`songs/${key}/source.mid`,fixture.source);assert.throws(()=>validateBasicKeyExport(storedZip([...changed]),fixture,key));});
async function evidence(t){const directory=await mkdtemp(join(tmpdir(),'wmh-basic-gate-'));t.after(()=>rm(directory,{recursive:true,force:true}));await prepareBasicKeyFixtures(join(directory,'fixtures'));await mkdir(join(directory,'downloads'));const save=async(p,v)=>{const full=join(directory,p);await mkdir(join(full,'..'),{recursive:true});await writeFile(full,typeof v==='object'&&!Buffer.isBuffer(v)?JSON.stringify(v):v);};const executable=join(directory,'test-exe.bin'),exe=Buffer.from('Original verifier fixture; this is not an executable');await save('test-exe.bin',exe);const sourceSha='a'.repeat(40),sourceTree='b'.repeat(40),native={version:1,ok:true,scenario:'basic-key',profile_reused:false,source_sha:sourceSha,source_tree:sourceTree,executable_sha256:digest(exe),executable_bytes:exe.length,directory:join(directory,'Scores'),phases:[]};return{directory,save,native,sourceSha,sourceTree,executable};}
test('native proof re-reads exact artifacts and rejects changed score bytes or missing screenshots',async t=>{
 const f=await evidence(t),rows=[],png=syntheticScreenshot();
 for(const [index,phase]of BASIC_KEY_PHASES.entries()){
  const r=renderer(phase),actions=[...(phase==='basic-key-seed'?[BASIC_KEY_FILES.profile,BASIC_KEY_FILES.coverage,BASIC_KEY_FILES.valid].map(file=>({kind:'picker',file})):[]),{kind:'select-last'},{kind:'select-first'},{kind:'select-second'},...(phase==='basic-key-restart'?[{kind:'click'}]:[]),...(phase==='basic-key-restart'?[{kind:'key-c5'},{kind:'toggle-follow'}]:[]),{kind:'click'},...r.modActions.map(row=>({kind:row.kind}))];r.actions=actions.length;for(const k of Object.keys(r.screenshots))r.screenshots[k]=actions.length;
  const host={phase,process_id:100+index,profile_fresh:true,profile_reused:false,renderer_ok:true,normal_close:true,executable_tcp_listeners:0,actions:r.actions,renderer_origin:r.origin};f.native.phases.push(host);
  for(const [i,a]of actions.entries()){await f.save(`action-${phase}-${i+1}.json`,{version:1,sequence:i+1,x:10,y:20,width:1280,height:720,...a});await f.save(`result-${phase}-${i+1}.json`,{ok:true,...(['key-c5','toggle-follow'].includes(a.kind)?{native_key:{app_hwnd:1,foreground:1,app_process_id:host.process_id,app_enabled:true,code:a.kind==='key-c5'?'Digit2':'Space',virtual_key:a.kind==='key-c5'?50:32,...(a.kind==='key-c5'?{hold_ms:40}:{}),focus_reacquired:false,pointer_clicked:false}}:{client_click:{app_hwnd:1,foreground:1}}),...(a.kind==='picker'?{owned_dialog:{app_process_id:host.process_id},picker_completion:{dialog_dismissed:true,app_enabled:true,owned_popup_visible:false}}:{})});}
  await f.save(`native-action-${phase}-${actions.length}.png`,png);await f.save(`native-${phase}.png`,png);await f.save(`renderer-${phase}.json`,r);if(phase==='basic-key-restart'){await f.save(`downloads/${r.files.machineTake}`,take(false));await f.save(`downloads/${r.files.humanTake}`,take(true));}if(phase==='basic-key-seed'){await f.save(`downloads/${r.files.package}`,exported(r.key));}
  for(const area of ['clean-songs','clean-backups'])for(const[path,bytes]of fixture.files){const name=`${area}/${r.key}/package/${path}`;await f.save(`Scores/${name}`,bytes);if(index===0)rows.push({path:name,bytes:bytes.length,sha256:digest(bytes)});}await f.save(`snapshot-${phase}.json`,{version:1,files:rows});
 }
 await addNativeProfileEvidence(f.native,f.save);await f.save('native-basic-key.json',f.native);const proof=await verifyBasicKeyNativeEvidence(f.directory,{sourceSha:f.sourceSha,sourceTree:f.sourceTree,executable:f.executable});assert.equal(proof.ok,true);assert.equal(proof.claims.full_acceptance,false);
 const seedPath='renderer-basic-key-seed.json',original=JSON.parse(await readFile(join(f.directory,seedPath),'utf8')),wrong=structuredClone(original);for(const row of wrong.pickerObservations){row.sequence+=10;for(const event of [...row.delegatedClicks,...row.inputs,...row.changes])event.sequence+=10;}for(const event of wrong.pickerFileEvents)event.pickerSequence+=10;await f.save(seedPath,wrong);await assert.rejects(verifyBasicKeyNativeEvidence(f.directory),/actual owned picker action/);await f.save(seedPath,original);
 const path=`Scores/clean-backups/${renderer('basic-key-seed').key}/package/score.json`;await f.save(path,Buffer.concat([fixture.files.get('score.json'),Buffer.from(' ')]));await assert.rejects(verifyBasicKeyNativeEvidence(f.directory));await f.save(path,fixture.files.get('score.json'));await rm(join(f.directory,'native-basic-key-restart.png'));await assert.rejects(verifyBasicKeyNativeEvidence(f.directory),/ENOENT/);
});
test('source/executable gate rejects a different commit, tree and executable before trusting renderer rows',async t=>{const f=await evidence(t);await f.save('native-basic-key.json',f.native);for(const options of [{sourceSha:'c'.repeat(40)},{sourceTree:'d'.repeat(40)}])await assert.rejects(verifyBasicKeyNativeEvidence(f.directory,options),/strictly equal/);await f.save('test-exe.bin','changed executable');await assert.rejects(verifyBasicKeyNativeEvidence(f.directory,{executable:f.executable}),/strictly equal/);});
test('preview and full workflows keep real browser/Windows and exact artifact checks mandatory',async()=>{for(const name of ['basic-key-preview.yml','windows-desktop-acceptance.yml']){const path=new URL(`../.github/workflows/${name}`,import.meta.url),parsed=spawnSync('python3',['scripts/check-authoring-workflow.py',fileURLToPath(path)],{encoding:'utf8'});assert.equal(parsed.status,0,parsed.stderr);const text=await readFile(path,'utf8');assert.match(text,/WMH_VIEWPORT_HEIGHT=720 node scripts\/hosted-basic-key-check\.mjs/);assert.match(text,/-Scenario basic-key/);assert.match(text,/verify-basic-key-evidence\.mjs --check desktop-basic-key/);assert.match(text,/WMH_SOURCE_SHA/);assert.match(text,/WMH_BASIC_KEY_EXECUTABLE/);assert.ok(!/continue-on-error:[^\n]*true[^]*basic-key/.test(text.slice(text.indexOf('Native original basic-key'))));}const host=await readFile(new URL('../scripts/hosted-basic-key-check.mjs',import.meta.url),'utf8');assert.match(host,/GITHUB_ACTIONS/);assert.match(host,/WMH_SOURCE_SHA,head/);assert.match(host,/driver_sha256=digest/);assert.match(host,/chromium.launch/);assert.match(host,/validateBasicKeyTakes/);assert.match(host,/validateBasicKeyExport/);assert.match(host,/new Set\(report.phases.map/);});

test('notation gate rejects substituted source pages, clocks, ties, missing real glyphs and automatic grades',()=>{
 const e=syntheticBasicKeyNotationEvidence();validateBasicKeyNotationEvidence(e);
 for(const mutate of [
  v=>v.responses[1].request.source.content_sha256='0'.repeat(64),v=>v.responses[1].response.page.source_sha256='0'.repeat(64),
  v=>v.responses[1].response.page.source_end_ms++,v=>v.responses[1].response.page.musicxml.note_id_map.segments[1].tie_stop=false,
  v=>v.responses[2].response.page.continuations[0].source_end.numerator=8,v=>v.responses[3].response.page.onsets=[],
  v=>delete v.frames.first.model.ownership,v=>v.frames.first.model.ownership.rendererId=0,v=>v.frames.first.model.ownership.svgNodes[0]=0,v=>v.frames.first.model.ownership.xmlNoteIds[0]='unrelated-source',
  v=>v.frames.first.model.notes[0].pitch.step='D',v=>v.frames.first.model.notes[0].duration.numerator=3,v=>v.frames.crossed.model.notes[1].tieMembers=[1],
  v=>v.frames.crossed.model.curves[0].from=1,v=>v.frames.reset.model.xmlNotes[1].ties=[],v=>v.frames.numbered.numbered=[],
  v=>v.frames.crossed.ids=[],v=>v.frames.crossed.cues[0].measure='2',v=>v.frames.first.heads=0,
  v=>v.frames.end.pageFirst=2,v=>v.frames.reset.position=12000,v=>v.frames.crossed.audio.worklet.started=0,
  v=>v.frames.first.assessments=1,v=>v.inspection.position=1,v=>v.frames.numbered.overlay=false,
 ]){const value=structuredClone(e);mutate(value);assert.throws(()=>validateBasicKeyNotationEvidence(value));}
 const r=renderer('basic-key-restart');validateBasicKeyRenderer(r);delete r.notation;assert.throws(()=>validateBasicKeyRenderer(r));
});
test('notation interactions remain real native controls and retain finite original-source bounds',async()=>{
 const source=await readFile(new URL('../crates/desktop-shell/basic-key-acceptance.js',import.meta.url),'utf8');
 assert.match(source,/observeBasicKeyEngraving/);assert.match(source,/createEngravingOwnershipObserver/);assert.match(source,/Reflect.apply\(original,this,args\)/);
 assert.match(source,/native\('select-second',\$\('engraving-basic-meter'\)\)/);assert.match(source,/natural End and actual empty-input practice assessment/);
 assert.doesNotMatch(source,/dispatchEvent|transport\.seek|state\.notation|progress'\)\.value\s*=/);
 for(const name of ['scripts/hosted-basic-key-check.mjs','scripts/windows-desktop-acceptance.ps1','crates/desktop-shell/src/acceptance.rs']){const text=await readFile(new URL('../'+name,import.meta.url),'utf8');assert.ok(text.includes('select-second'));assert.ok(!text.includes('seek-end'));}
 const row=syntheticBasicKeyNotationEvidence().responses[1];validateBasicKeyNotationResponse(row);row.request.settings.rendition_policy_id='wrong-policy';assert.throws(()=>validateBasicKeyNotationResponse(row));
});
test('renderer observer forwards real reader/render receiver, arguments and return values unchanged',async()=>{
 const source=await readFile(new URL('../crates/desktop-shell/basic-key-acceptance.js',import.meta.url),'utf8'),calls=[],loaded=Promise.resolve('real reader'),rendered={actual:true};
 class Renderer{load(...args){calls.push({receiver:this,args});return loaded;}render(...args){calls.push({receiver:this,args});return rendered;}}
 const originalLoad=Renderer.prototype.load,originalRender=Renderer.prototype.render,context=vm.createContext({opensheetmusicdisplay:{OpenSheetMusicDisplay:Renderer}});
 vm.runInContext(source.slice(0,source.indexOf('\n(() => {'))+'\nglobalThis.observe=observeBasicKeyEngraving;',context);
 const observer=await context.observe({}),reader=new Renderer(),document={cloneNode:()=>({retained:true})},options={original:true};
 assert.equal(reader.load(document,options),loaded);assert.equal(reader.render(options),rendered);assert.equal(calls[0].receiver,reader);assert.deepEqual(calls[0].args,[document,options]);assert.equal(calls[1].receiver,reader);assert.deepEqual(calls[1].args,[options]);
 observer.restore();assert.equal(Renderer.prototype.load,originalLoad);assert.equal(Renderer.prototype.render,originalRender);
});

test('stage inventory closes through its visible native summary before take export and sound controls',async()=>{
 const source=await readFile(new URL('../crates/desktop-shell/basic-key-acceptance.js',import.meta.url),'utf8');
 const start=source.indexOf("if(!$('song-parts-tools').open)"),end=source.indexOf('\n  // One trusted C5',start);assert.ok(start>0&&end>start);
 for(const initiallyOpen of [false,true]){
  const parts={id:'song-parts-tools',open:initiallyOpen},summary={id:'song-parts-summary'},range={id:'song-complete-range-text'},events=[];
  const context=vm.createContext({report:{screenshots:{},files:{}},receiver:{snapshot:()=>[],settledSince:()=>true,quiet:()=>true},until:async predicate=>assert.ok(predicate()),accompanimentStart:0,$:id=>({'song-parts-tools':parts,'song-parts-summary':summary,'song-complete-range-text':range})[id],assert:(value,message)=>assert.ok(value,message),native:async(kind,node)=>{
   assert.equal(kind,'click');events.push(node.id);
   if(node===summary)parts.open=!parts.open;else{assert.equal(node,range);assert.equal(parts.open,true);}return events.length;
  },take:async()=>{assert.equal(parts.open,false);events.push('take');return 'original-take.json';}});
  await vm.runInContext('(async()=>{'+source.slice(start,end)+'})()',context);
  assert.deepEqual(events,[...(!initiallyOpen?['song-parts-summary']:[]),'song-complete-range-text','song-parts-summary','take']);
  assert.equal(context.report.files.machineTake,'original-take.json');assert.equal(parts.open,false);
 }
});
test('native target failures retain the exact visibility guard and report only bounded target geometry',async()=>{
 const source=await readFile(new URL('../crates/desktop-shell/basic-key-acceptance.js',import.meta.url),'utf8'),context=vm.createContext({});
 vm.runInContext(source.slice(0,source.indexOf('\n(() => {'))+'\nglobalThis.describe=describeBasicKeyNativeTarget;',context);
 const message=context.describe({id:'sound-button',value:'never copy input',textContent:'never copy labels'},{x:812.12345,y:64.6789,width:70,height:38},{id:'song-parts-tools',value:'never copy values'});
 assert.deepEqual(JSON.parse(message),{target:'sound-button',bounds:{x:812.12,y:64.68,width:70,height:38},hit:'song-parts-tools'});
 assert.doesNotMatch(message,/never copy/);assert.equal(JSON.parse(context.describe({id:'x'.repeat(500)},{x:NaN,y:Infinity,width:1,height:2},null)).target.length,96);
 assert.match(source,/assert\(b\.width>0&&b\.height>0&&x>0&&x<innerWidth&&y>0&&y<innerHeight&&\(hit===node\|\|node\.contains\(hit\)\),`Native target obscured\/outside viewport: \$\{describeBasicKeyNativeTarget\(node,b,hit\)\}`\)/);
});

test('source-meter proof requires the actual visible disclosure and does not treat chosen layout as source meter',()=>{
 validateBasicKeySourceMeterDisclosure(sourceMeterDisclosure());
 for(const mutate of [e=>e.choice.label.visible=false,e=>e.choice.control.bounds.width=0,e=>e.status.bounds.y=800,e=>e.choice.control.value='4/4',e=>e.choice.control.disabled=true,e=>e.status.text='4/4',e=>e.status.text='来源没有明确的起始拍号。',e=>e.choice.provenance.id='score-key']){
  const value=sourceMeterDisclosure();mutate(value);assert.throws(()=>validateBasicKeySourceMeterDisclosure(value));
 }
});
test('source-meter inspection opens collapsed notation and help before a neutral status capture',async()=>{
 const source=await readFile(new URL('../crates/desktop-shell/basic-key-acceptance.js',import.meta.url),'utf8');
 assert.doesNotMatch(source,/score-key/);assert.match(source,/captureSourceMeterDisclosure\(false\);[^]*?await native\('select-second',\$\('engraving-page-size'\)\)/);
 const start=source.indexOf(' async function captureSourceMeterDisclosure('),end=source.indexOf(' async function notationInspection(',start);assert.ok(start>0&&end>start);
 const body=source.slice(start,end);assert.doesNotMatch(body,/native\('click',\$\('engraving-status'\)\)/);
 for(const notationOpen of [false,true])for(const closeAfter of [false,true])for(const pointerEvents of ['auto','none']){
  const {document}=parseHTML('<html><body><button id="notation-toggle"></button><h1 id="stage-title"></h1><details id="notation-tools"><summary id="notation-summary"></summary><aside id="notation-dock"><details class="dock-help"><summary id="help-summary"></summary><select id="engraving-page-size"></select><p id="engraving-status">来源没有明确的起始拍号</p></details><div id="engraving-basic-controls"><span id="engraving-basic-meter-label">来源拍号未确定时使用的显示拍号</span><select id="engraving-basic-meter"><option selected value="source">使用来源拍号</option></select><p id="engraving-basic-provenance">MIDI 按键视图</p></div></aside></details></body></html>');
  const $=id=>document.getElementById(id),tools=$('notation-tools'),dock=$('notation-dock'),help=document.querySelector('.dock-help'),events=[];
  for(const details of [tools,help])Object.defineProperty(details,'open',{get(){return this.hasAttribute('open');},set(value){this.toggleAttribute('open',value);}});
  tools.hidden=dock.hidden=!notationOpen;$('notation-toggle').setAttribute('aria-expanded',String(notationOpen));
  const isExposed=node=>{for(let parent=node;parent;parent=parent.parentElement)if(parent.hidden||parent.tagName==='DETAILS'&&!parent.open&&!parent.querySelector('summary').contains(node))return false;return true;};
  const surfaces=['engraving-basic-meter-label','engraving-basic-meter','engraving-basic-provenance','engraving-status'].map($);
  for(const[i,node]of surfaces.entries()){node.getBoundingClientRect=()=>({x:750,y:180+i*60,width:200,height:40});node.getClientRects=()=>isExposed(node)?[{}]:[];node.scrollIntoView=()=>{assert.ok(isExposed(node),'Reading cannot scroll a closed disclosure into visibility');};}
  $('engraving-basic-meter').disabled=false;
  const context=vm.createContext({report:{screenshots:{}},notationResponses:[{response:{page:{status:'ready'}}}],$,document:{elementFromPoint:(x,y)=>{const node=surfaces.find(n=>n.getBoundingClientRect().y+20===y);if(!node||!isExposed(node))return document.body;return node.id==='engraving-status'&&pointerEvents==='none'?help:node;}},innerWidth:1280,innerHeight:720,getComputedStyle:node=>({display:'block',visibility:'visible',pointerEvents:node.id==='engraving-status'?pointerEvents:'auto'}),assert:(value,message)=>assert.ok(value,message),until:async(fn)=>assert.ok(fn()),native:async(kind,node)=>{
   assert.ok(['click','select-second'].includes(kind));if(kind==='select-second'){assert.equal(node.id,'engraving-basic-meter');events.push('choose-display-meter');return events.length;}assert.notEqual(node.id,'engraving-status');assert.ok(isExposed(node),'Every native input target must be visibly exposed');events.push(node.id);
   if(node===$('notation-toggle')){tools.hidden=dock.hidden=false;node.setAttribute('aria-expanded','true');}
   else if(node===$('notation-summary'))tools.open=!tools.open;else if(node===$('help-summary'))help.open=!help.open;
   return events.length;
  }});
  await vm.runInContext(body+`;captureSourceMeterDisclosure(${closeAfter});`,context);
  assert.deepEqual(events,[...(!notationOpen?['notation-toggle']:[]),'notation-summary','engraving-basic-provenance','help-summary','stage-title',...(closeAfter?['choose-display-meter','notation-summary']:[])]);
  assert.equal(tools.open,!closeAfter);assert.equal(help.open,true,'Page-size controls remain available for the explicit view choice');assert.equal(context.report.sourceMeterDisclosure.choice.control.value,'source');assert.equal(context.report.sourceMeterDisclosure.status.visible,true);
 }
});

test('retained original v2 oracle binds exact source bytes, native pages and generator provenance',async()=>{
 const bytes=await readFile(new URL('./fixtures/basic-key-acceptance/rendition-native.json',import.meta.url)),proof=JSON.parse(await readFile(new URL('./fixtures/basic-key-acceptance/rendition-provenance.json',import.meta.url),'utf8'));
 assert.equal(digest(bytes),proof.output_sha256);assert.equal(proof.source_midi_bytes,130);assert.equal(proof.source_midi_sha256,fixture.manifest.source.sha256);assert.equal(proof.package_sha256,fixture.manifest.package.sha256);assert.match(proof.source,/^[a-f0-9]{40}$/);assert.match(proof.source_tree,/^[a-f0-9]{40}$/);assert.equal(proof.binary_sha256,'42556f9dcbe0874cd09118de823b1354940a99735e15c65607cb9bed483a0a84');
 const capture=JSON.parse(bytes);validateBasicKeyOpened(capture.open);assert.equal(capture.pages.length,17);for(const row of capture.pages)validateBasicKeyNotationResponse(row);
 assert.deepEqual(capture.open.clean_package.runtime.compilation.timeline.notes.map(n=>[n[0],n[4],n[5]]),[['midi-t1-e4',0,12000],['midi-t2-e1',0,250],['midi-t3-e1',500,500],['midi-t1-e6',12000,20],['midi-t1-e8',12000,20]]);
});
test('complete Listen evidence rejects lost voices, premature End, moving pause clocks and machine input',()=>{
 const runtime=opened().clean_package.runtime;validateBasicKeyListening(listening(),runtime);
 for(const mutate of [e=>e.audioThread.pop(),e=>e.audioThread[0].plan.notes[1][4]=36,e=>e.audioThread[0].plan.notes[1][5]=90,e=>e.audioThread[0].plan.notes[1][6]=0,e=>e.audioThread[0].plan.notes[0][1]='unknown',e=>e.afterPause.position++,e=>e.afterPause.scheduled++,e=>e.paused.audio.pendingSources=1,e=>e.ended.position=12000,e=>e.ended.captured='1',e=>e.ended.assessments=1,e=>e.following.rows.pop(),e=>e.following.rows[1].rails=[]]){const e=listening();mutate(e);assert.throws(()=>validateBasicKeyListening(e,runtime));}
 assert.throws(()=>validateBasicKeySchedules(schedules(),runtime,{targetPart:BASIC_KEY_HUMAN_PART}));
 const changed=listening();changed.takeState.passOptions.push('1');assert.throws(()=>validateBasicKeyListening(changed,runtime));
});
test('one real human-hit proof requires exact selected targets, original interpretation and input causality',()=>{
 const r=renderer('basic-key-restart');validateBasicKeyTakes(take(false),take(true),r);
 for(const mutate of [v=>v.passes[0].interpretation.policy_id='other',v=>v.passes[0].interpretation.source_target_ids=['midi-t1-e4'],v=>v.passes[0].inputs[0].midi=60,v=>v.passes[0].timeline.notes.push({id:'midi-t1-e4',midi:60}),v=>v.passes[0].assessment.hits=[],v=>v.input_evidence.events[0].input_kind='machine']){const human=take(true);mutate(human);assert.throws(()=>validateBasicKeyTakes(take(false),human,r));}
});
test('C5 is one closed real-key action while the native action budget and shared KeyR defaults remain intact',async()=>{
 const ps=await readFile(new URL('../scripts/windows-desktop-acceptance.ps1',import.meta.url),'utf8'),host=await readFile(new URL('../scripts/hosted-basic-key-check.mjs',import.meta.url),'utf8'),rust=await readFile(new URL('../crates/desktop-shell/src/acceptance.rs',import.meta.url),'utf8'),runner=await readFile(new URL('../crates/desktop-shell/basic-key-acceptance.js',import.meta.url),'utf8');
 const keyBranch=ps.slice(ps.indexOf("if($Action.kind -eq 'key-c5')"),ps.indexOf('  [NativeAcceptance]::SetForegroundWindow($window) | Out-Null',ps.indexOf("if($Action.kind -eq 'key-c5')")));assert.match(keyBranch,/GetForegroundWindow/);assert.match(keyBranch,/IsWindowEnabled/);assert.match(keyBranch,/\[NativeAcceptance\]::HeldPerformanceKey\(0x32\);return/);assert.doesNotMatch(keyBranch,/Start-Sleep|SetForegroundWindow|ClickPositioned/);assert.match(host,/else if\(a.kind==='key-c5'\)\{[^\n]+page.keyboard.press\('Digit2',\{delay:40\}\)/);assert.match(rust,/"key-c5"/);assert.match(runner,/assert\(sequence<80/);assert.match(runner,/observeNativeReferenceTransport\(document,\{keyCode:'Digit2'\}\)/);assert.doesNotMatch(runner,/dispatchEvent|transport\.seek|progress'\)\.value\s*=/);
});
test('timed C5 dispatch verifies prepared focus without scrolling, refocusing or waiting for frames',async()=>{
 const source=await readFile(new URL('../crates/desktop-shell/basic-key-acceptance.js',import.meta.url),'utf8'),events=[];
 const node={id:'stage-title',disabled:false,scrollIntoView(){events.push('scroll');},focus(){events.push('focus');document.activeElement=this;},getBoundingClientRect:()=>({x:10,y:10,width:100,height:20}),contains:()=>false};
 const document={body:{dataset:{screen:'stage'}},hidden:false,activeElement:null,hasFocus:()=>true,querySelector:()=>null,elementFromPoint:()=>node};
 const context=vm.createContext({document,innerWidth:1280,innerHeight:720,assert:(value,message)=>assert.ok(value,message),frame:async()=>{events.push('frame');},controls:{},describeBasicKeyNativeTarget:()=>'',json:async(path,action)=>{events.push({path,action});},fetcher:async()=>({status:200,ok:true,json:async()=>({ok:true})}),until:async predicate=>assert.equal(await predicate(),true)});
 const helpers=source.slice(source.indexOf('function assertBasicKeyInputFocus('),source.indexOf('\n(() => {'));
 const native=source.slice(source.indexOf(' async function native('),source.indexOf(' const mod=',source.indexOf(' async function native(')));
 vm.runInContext(helpers+'\nlet sequence=0;'+native+'\nglobalThis.prepare=prepareBasicKeyInputFocus;globalThis.dispatch=native;',context);
 await context.prepare(document,node,context.frame);assert.deepEqual(events,['scroll','focus','frame','frame']);events.length=0;
 assert.equal(await context.dispatch('key-c5',node),1);assert.equal(events.length,1);assert.equal(events[0].path,'/__desktop_smoke/action');assert.equal(events[0].action.kind,'key-c5');
 for(const change of [()=>{document.activeElement={id:'play-button'};},()=>{document.hidden=true;},()=>{document.hasFocus=()=>false;},()=>{document.querySelector=()=>({open:true});},()=>{document.body.dataset.screen='library';}]){
  document.activeElement=node;document.hidden=false;document.hasFocus=()=>true;document.querySelector=()=>null;document.body.dataset.screen='stage';events.length=0;change();await assert.rejects(context.dispatch('key-c5',node),/focus was lost/);assert.deepEqual(events,[]);
 }
 const score=source.slice(source.indexOf("report.stage='trusted-keyboard-score'"));
 assert.ok(score.indexOf('prepareBasicKeyInputFocus')<score.indexOf("'C5 source onset approaching'"));
 assert.ok(score.indexOf("'C5 source onset approaching'")<score.indexOf("native('key-c5'"));
});
test('C5 proof rejects missing preparation, intervening clicks and native foreground reacquisition',()=>{
 const r=renderer('basic-key-restart');validateBasicKeyInputPreparation(r);
 for(const mutate of [v=>delete v.keyPreparation,v=>v.keyPreparation.keyAction++,v=>v.keyPreparation.readyWallMs=100,v=>v.keyPreparation.dispatchPositionMs=700,v=>v.transportAdmission.rows[2].state.focused=false,v=>v.transportAdmission.rows.splice(3,0,{kind:'event',state:v.transportAdmission.rows[2].state,event:{type:'click'}}),v=>v.transportAdmission.rows[3].event.trusted=false]){const changed=structuredClone(r);mutate(changed);assert.throws(()=>validateBasicKeyInputPreparation(changed));}
 const result={ok:true,native_key:{app_hwnd:262506,foreground:262506,app_process_id:100,app_enabled:true,code:'Digit2',virtual_key:50,hold_ms:40,focus_reacquired:false,pointer_clicked:false}};validateBasicKeyNativeKey(result,{process_id:100});
 for(const mutate of [v=>v.client_click={app_hwnd:262506},v=>v.native_key.foreground=1,v=>v.native_key.app_process_id++,v=>v.native_key.app_enabled=false,v=>v.native_key.focus_reacquired=true,v=>v.native_key.pointer_clicked=true,v=>v.native_key.virtual_key=82]){const changed=structuredClone(result);mutate(changed);assert.throws(()=>validateBasicKeyNativeKey(changed,{process_id:100}));}
});
test('following observer records transport transitions without inventing clocks or extending short gates',async()=>{
 const source=await readFile(new URL('../crates/desktop-shell/basic-key-acceptance.js',import.meta.url),'utf8'),begin=source.indexOf('function observeBasicKeyFollowing('),end=source.indexOf('function runBasicKeyAcceptanceCleanup(',begin),queue=[],cancelled=[];
 const cursor={dataset:{sourceNoteIds:'["midi-t2-e1"]',sourceMeasureIndex:'0'}},progress=evidenceClockNode(0),stage={dataset:{rendererState:'ready'}},document={getElementById:id=>({'written-cursor-status':cursor,progress,'clean-song-stage':stage})[id],querySelectorAll:()=>[{dataset:{noteId:'midi-t2-e1'}}]};
 const context=vm.createContext({__wmhReadPlaybackClock:readPlaybackClock,requestAnimationFrame:callback=>(queue.push(callback),queue.length),cancelAnimationFrame:id=>cancelled.push(id)});vm.runInContext(source.slice(begin,end)+';globalThis.observe=observeBasicKeyFollowing;',context);const observer=context.observe(document);
 queue.shift()();stage.dataset.rendererState='playing';setEvidencePlaybackClock(progress,1,{running:true});queue.shift()();cursor.dataset.sourceNoteIds='[]';setEvidencePlaybackClock(progress,250,{running:true});queue.shift()();const result=observer.stop();assert.equal(result.stopped,true);assert.equal(result.overflow,false);assert.equal(cancelled.length,1);assert.deepEqual(Array.from(result.rows,row=>[row.position,row.renderer]),[[0,'ready'],[1,'playing'],[250,'playing']]);assert.equal(progress.value,'250');assert.equal(cursor.dataset.sourceNoteIds,'[]');
});

test('visible page identity ignores future prefetch and independent other-part completions',async()=>{
 const source=await readFile(new URL('../crates/desktop-shell/basic-key-acceptance.js',import.meta.url),'utf8'),context=vm.createContext({});
 vm.runInContext(source.slice(0,source.indexOf('\n(() => {'))+'\nglobalThis.visible=visibleBasicKeyPage;',context);
 const all=basicKeyNativeRendition().pages,rows=[0,2,4].map(first=>structuredClone(all.find(row=>row.request.settings.part_id==='midi-t1-c1-r0'&&row.request.settings.first_measure===first&&row.request.settings.measure_count===2&&row.request.settings.display_meter&&row.request.settings.position_ms===undefined)));
 rows.push(structuredClone(all.find(row=>row.request.settings.part_id==='midi-t3-c1-r0'&&row.request.settings.first_measure===0&&row.request.settings.measure_count===2&&row.request.settings.display_meter)));
 const nodes={workspace:{dataset:{notationRenderStatus:'ready'}},'engraving-range':{textContent:'第 1–2 小节，共 6 小节'}},document={getElementById:id=>nodes[id]};
 assert.equal(context.visible(document,rows).requestIndex,0);assert.equal(context.visible(document,rows).page,rows[0].response.page);
 nodes['engraving-range'].textContent='Measures 3–4 / 6';assert.equal(context.visible(document,rows).requestIndex,1);
 nodes.workspace.dataset.notationRenderStatus='pending';assert.equal(context.visible(document,rows),null);nodes.workspace.dataset.notationRenderStatus='ready';
 nodes['engraving-range'].textContent='第 5–6 小节，共 6 小节';assert.equal(context.visible(document,rows).requestIndex,2);
 rows[2].request.settings.display_meter={numerator:3,denominator:4};assert.equal(context.visible(document,rows),null);
 const evidence=syntheticBasicKeyNotationEvidence();for(const row of evidence.responses)if(row.response.page.status==='ready'){row.request.settings.first_measure=row.response.page.first_measure;delete row.request.settings.position_ms;row.response.page.resolved_position_ms=null;}
 validateBasicKeyNotationEvidence(evidence);evidence.frames.crossed.visibleRange.from=1;assert.throws(()=>validateBasicKeyNotationEvidence(evidence));
});

test('focused and full gates require the real twelve-part hosted app and retain exact separate artifacts',async()=>{
 for(const[name,job]of [['basic-key-preview.yml','basic-key-browser'],['windows-desktop-acceptance.yml','bulk-import-browser']]){
  const parsed=spawnSync('python3',['scripts/check-authoring-workflow.py','--json',fileURLToPath(new URL(`../.github/workflows/${name}`,import.meta.url))],{encoding:'utf8'});assert.equal(parsed.status,0,parsed.stderr);const steps=JSON.parse(parsed.stdout).jobs[job].steps;
  const run=steps.filter(step=>step.run==='node scripts/hosted-notation-scope-check.mjs');assert.equal(run.length,1);
  assert.equal(run[0].if,"${{ !cancelled() && steps.notation_server.outcome == 'success' && steps.dense_browser_setup.outcome == 'success' }}");
  assert.notEqual(run[0]['continue-on-error'],true);assert.deepEqual(run[0].env,{WMH_HOSTED_BROWSER:'1',WMH_SOURCE_SHA:'${{ github.sha }}',WMH_SERVER_BINARY:'${{ github.workspace }}/target/debug/practice-server'});
  assert.ok(steps.findIndex(step=>step.run==='cargo build -p practice-server --locked')<steps.indexOf(run[0]));
  const upload=steps.find(step=>step.with?.name==='notation-scope-browser-${{ github.sha }}');assert.equal(upload.if,'always()');assert.deepEqual(upload.with.path.trim().split('\n'),['test-results/notation-scope/report.json','test-results/notation-scope/*.png','test-results/notation-scope/server.log']);
 }
 const path=fileURLToPath(new URL('../scripts/hosted-notation-scope-check.mjs',import.meta.url)),denied=spawnSync(process.execPath,[path],{encoding:'utf8',env:{...process.env,GITHUB_ACTIONS:'false',WMH_HOSTED_BROWSER:'0'}});assert.equal(denied.status,1);assert.match(denied.stderr,/require the authorized hosted Actions runner/);
 const source=await readFile(path,'utf8');assert.match(source,/source_tree/);assert.match(source,/server_sha256/);assert.match(source,/sha256:digest\(bytes\)/);assert.match(source,/source_measure_index===1/);assert.match(source,/continuing_note_ids.includes\('original-held-12'\)/);assert.doesNotMatch(source,/progress[^\n]*>=\.05/);assert.match(source,/new Set\(batches.flatMap\(batch=>batch.renderedIds\)\).size,12/);
});

test('hosted one-bar setup opens the page-size disclosure through its summary and preserves Follow access',async()=>{
 const source=await readFile(new URL('../scripts/hosted-notation-scope-check.mjs',import.meta.url),'utf8'),begin=source.indexOf('async function selectVisibleNotationPageSize('),end=source.indexOf('const settle=',begin);
 assert.ok(begin>=0&&end>begin);
 for(const initiallyOpen of [false,true]){
  let open=initiallyOpen;const calls=[];
  const summary={first(){return this;},async click(){calls.push(open?'close':'open');open=!open;}},details={async count(){return 1;},async evaluate(read){return read({open});},locator(selector){assert.equal(selector,'summary');return summary;}};
  const control={locator(selector){assert.equal(selector,'xpath=ancestor::details[1]');return details;},async waitFor(options){assert.deepEqual({...options},{state:'visible'});assert.equal(open,true);calls.push('visible');},async selectOption(value){assert.equal(open,true);assert.equal(value,'1');calls.push('select');}};
  const page={locator(selector){assert.equal(selector,'#engraving-page-size');return control;}};
  const context=vm.createContext({assert,page});vm.runInContext(source.slice(begin,end)+';globalThis.select=selectVisibleNotationPageSize;',context);await context.select('1');
  assert.equal(open,initiallyOpen);assert.deepEqual(calls,initiallyOpen?['visible','select']:['open','visible','select','close']);
 }
 assert.match(source,/await selectVisibleNotationPageSize\('1'\);await waitPaint\(\[score\.parts\[11\]\.id\],'staff'\);await page\.locator\('#engraving-follow'\)\.check\(\)/);
 assert.doesNotMatch(source.slice(begin,end),/force\s*:|\.open\s*=|\.hidden\s*=/);
});

for(const outcome of ['resolve','reject','throw'])test(`static receiver create ${outcome} is observed before prepare without changing arguments, this, result or error`,async()=>{
 const source=await readFile(new URL('../crates/desktop-shell/reference-acceptance.js',import.meta.url),'utf8'),begin=source.indexOf('async function observeBasicKeyReceiver('),end=source.indexOf('// End shared audio-thread observer.',begin),realm=vm.createContext({structuredClone,Float32Array});vm.runInContext(source.slice(begin,end)+';globalThis.observe=observeBasicKeyReceiver;',realm);
 const failure=Object.assign(new Error('Original module failure'),{name:'BasicKeyAudioError',code:'audio_worklet_unavailable',details:{phase:'module-load',causeName:'AbortError',causeMessage:'Original import rejection',moduleUrl:'https://wmh.localhost/basic-key-audio-processor.js',isSecureContext:true,hasAudioWorklet:true,addModuleType:'function',contextState:'running',discontinuityKind:'block-frame',expectedFrame:512,actualFrame:768,previousBlockFrame:384,previousBlockLength:128,blockLength:128,frameDelta:256,successfulBlocks:4,generation:1,planGeneration:1}}),value={originalReceiver:true},calls=[],context={state:'running',currentTime:0,audioWorklet:{addModule(){}}},output={},options={moduleUrl:'exact-module'},promise=outcome==='reject'?Promise.reject(failure):Promise.resolve(value);
 class Receiver{static create(...args){calls.push({owner:this,args});if(outcome==='throw')throw failure;return promise;}prepare(){}start(){}}
 const original=Receiver.create,root={isSecureContext:true,AudioWorkletNode:class{},performance},document={getElementById:()=>({textContent:'Visible product startup details'})},observer=await realm.observe(document,{Receiver,root}),owner={staticReceiver:true};
 if(outcome==='throw')assert.throws(()=>Receiver.create.call(owner,context,output,options),error=>error===failure);else{const result=Receiver.create.call(owner,context,output,options);assert.equal(result,promise);if(outcome==='reject')await assert.rejects(result,error=>error===failure);else assert.equal(await result,value);}
 assert.equal(calls.length,1);assert.equal(calls[0].owner,owner);assert.deepEqual(calls[0].args,[context,output,options]);const status=observer.status();assert.equal(status.receivers,0);assert.equal(status.initializations.length,1);assert.equal(status.initializations[0].isSecureContext,true);assert.equal(status.initializations[0].settled,true);assert.equal(status.initializations[0].ok,outcome==='resolve');
 if(outcome==='resolve'){assert.deepEqual([...status.errors],[]);assert.doesNotThrow(()=>observer.assertHealthy());}else{assert.equal(status.errors[0].details.phase,'module-load');assert.equal(status.errors[0].details.expectedFrame,512);assert.equal(status.errors[0].details.actualFrame,768);assert.equal(status.errors[0].details.frameDelta,256);assert.equal(status.errors[0].details.discontinuityKind,'block-frame');assert.equal(status.errors[0].details.causeMessage,'Original import rejection');assert.throws(()=>observer.assertHealthy(),error=>/Original import rejection/.test(error.message)&&/Visible product startup details/.test(error.message));}
 const cleanup=observer.restore();assert.equal(cleanup.restored,true);assert.equal(Receiver.create,original);
});

test('restoring the startup observer fences late diagnostics without canceling the original create promise',async()=>{
 const source=await readFile(new URL('../crates/desktop-shell/reference-acceptance.js',import.meta.url),'utf8'),begin=source.indexOf('async function observeBasicKeyReceiver('),end=source.indexOf('// End shared audio-thread observer.',begin),realm=vm.createContext({structuredClone,Float32Array});vm.runInContext(source.slice(begin,end)+';globalThis.observe=observeBasicKeyReceiver;',realm);
 let reject;const promise=new Promise((_,no)=>{reject=no;});class Receiver{static create(){return promise;}prepare(){}start(){}}const original=Receiver.create,observer=await realm.observe({},{Receiver,root:{performance}});
 assert.equal(Receiver.create({state:'running'},{}),promise);assert.equal(observer.status().initializations[0].settled,false);assert.equal(observer.restore().restored,true);assert.equal(Receiver.create,original);const failure=new Error('Original delayed rejection');reject(failure);await assert.rejects(promise,error=>error===failure);assert.equal(observer.status().initializations[0].settled,false);assert.deepEqual([...observer.status().errors],[]);
});

test('startup observation failure cannot suppress the original static create operation',async()=>{
 const source=await readFile(new URL('../crates/desktop-shell/reference-acceptance.js',import.meta.url),'utf8'),begin=source.indexOf('async function observeBasicKeyReceiver('),end=source.indexOf('// End shared audio-thread observer.',begin),realm=vm.createContext({structuredClone,Float32Array});vm.runInContext(source.slice(begin,end)+';globalThis.observe=observeBasicKeyReceiver;',realm);
 let calls=0;const result=Promise.resolve('unchanged');class Receiver{static create(){calls++;return result;}prepare(){}start(){}}const original=Receiver.create,observer=await realm.observe({},{Receiver,root:{performance:{now(){throw Error('Diagnostic clock failed');}}}});
 assert.equal(Receiver.create(),result);assert.equal(await result,'unchanged');assert.equal(calls,1);assert.match(observer.status().errors[0].message,/Diagnostic clock failed/);assert.equal(observer.restore().restored,true);assert.equal(Receiver.create,original);
});

test('actual-adapter observer preserves promises and callbacks, restores graph methods, and labels mock messages untrusted',async()=>{
 const source=await readFile(new URL('../crates/desktop-shell/reference-acceptance.js',import.meta.url),'utf8'),begin=source.indexOf('async function observeBasicKeyReceiver('),end=source.indexOf('// End shared audio-thread observer.',begin),realm=vm.createContext({structuredClone,Float32Array});vm.runInContext(source.slice(begin,end)+';globalThis.observe=observeBasicKeyReceiver;',realm);
 const original=schedules()[0],calls=[],frames=new Map();let handle=0;
 class AudioNode extends EventTarget{constructor(context){super();this.context=context;}connect(...args){calls.push(['connect',this,args]);return args[0];}disconnect(...args){calls.push(['disconnect',this,args]);return 'disconnected';}}
 class AudioDestinationNode extends AudioNode{}class GainNode extends AudioNode{gain={value:.7};}class AnalyserNode extends AudioNode{getFloatTimeDomainData(values){values.fill(.02);}}
 class AudioWorkletNode extends AudioNode{numberOfInputs=0;numberOfOutputs=1;port=new EventTarget();}
 const context={sampleRate:48000,currentTime:128/48000,state:'running',addEventListener(){},removeEventListener(){},createAnalyser(){return new AnalyserNode(this);}};context.destination=new AudioDestinationNode(context);
 const root={AudioNode,AudioWorkletNode,performance,requestAnimationFrame:callback=>(frames.set(++handle,callback),handle),cancelAnimationFrame:value=>frames.delete(value)},callbackResult={preserved:true};
 class Receiver{constructor(){this.context=context;this.node=new AudioWorkletNode(context);this.output=new GainNode(context);this.output.connect(context.destination);this.outputGate=new GainNode(context);this.pending=new Map();this.onEnded=function(record){calls.push(['ended',this,record]);return callbackResult;};this.onStopped=()=>{};this.onError=()=>{};this.state='idle';this.connected=false;}
  prepare(plan,options){calls.push(['prepare',this,plan,options]);this.plan=plan;this.generation=1;this.positionFrame=0;this.state='ready';return this.preparePromise=Promise.resolve(original.prepared);}
  start(options){calls.push(['start',this,options]);this.node.connect(this.output);this.connected=true;this.state='running';return this.startPromise=Promise.resolve(original.started);}}
 const originals=[Receiver.prototype.prepare,Receiver.prototype.start,AudioNode.prototype.connect,AudioNode.prototype.disconnect],observer=await realm.observe({}, {Receiver,root}),receiver=new Receiver(),ended=receiver.onEnded,options={positionMs:0},startOptions={anchorTime:.05};
 const ready=receiver.prepare(original.plan,options);assert.equal(ready,receiver.preparePromise);await ready;const started=receiver.start(startOptions);assert.equal(started,receiver.startPromise);await started;
 for(const value of [original.prepared,original.started])receiver.node.port.dispatchEvent(new MessageEvent('message',{data:value}));
 const record={...original.terminals[0].record,ledger:{actualStarts:Float64Array.from(original.terminals[0].record.ledger.actualStarts),actualEnds:Float64Array.from(original.terminals[0].record.ledger.actualEnds)}};
 assert.equal(receiver.onEnded(record),callbackResult);receiver.node.port.dispatchEvent(new MessageEvent('message',{data:record}));receiver.state='ended';assert.equal(observer.status().activeReceivers,1);assert.equal(observer.quiet(),false,'Ended does not mean disconnected');receiver.connected=false;assert.equal(observer.quiet(),false,'The observed node connection remains authoritative');receiver.node.disconnect();receiver.state='disposed';receiver.disposed=true;receiver.disposing=false;receiver.pending.set(9,{type:'start'});assert.equal(observer.quiet(),false,'Disposal cannot hide a pending start');receiver.pending.clear();assert.equal(observer.quiet(),true);
 const run=observer.snapshot()[0];assert.deepEqual([...run.rawTerminals[0].record.ledger.actualStarts],Array.from(record.ledger.actualStarts));record.ledger.actualStarts[0]++;assert.notEqual(observer.snapshot()[0].rawTerminals[0].record.ledger.actualStarts[0],record.ledger.actualStarts[0],'Raw receipt is an independent retained copy');assert.equal(run.terminals[0].ledgerType,'Float64Array');assert.equal(run.messages.every(row=>row.isTrusted===false&&row.portMatches===true),true);assert.equal(observer.settledSince(0),true);
 assert.throws(()=>validateBasicKeySchedules([run],opened().clean_package.runtime),/native MessagePort events/,'A mocked node can never establish real processor acceptance');
 assert.equal(calls.find(row=>row[0]==='prepare')[1],receiver);assert.equal(calls.find(row=>row[0]==='prepare')[2],original.plan);assert.equal(calls.find(row=>row[0]==='prepare')[3],options);assert.equal(calls.find(row=>row[0]==='start')[2],startOptions);assert.equal(calls.find(row=>row[0]==='ended')[1],receiver);
 for(let i=0;i<40;i++){receiver.node.connect(context.destination);receiver.node.disconnect(context.destination);}const graph=observer.status().graphHistory;assert.equal(graph.events.length,64);assert.ok(graph.omitted>0);assert.equal(graph.total,graph.omitted+graph.events.length);assert.equal(graph.events.at(-1).sequence,graph.total);assert.ok(graph.total>=3);assert.ok(graph.events.some(row=>row.kind==='connect'&&row.nodeType==='AudioWorkletNode'));assert.ok(graph.events.some(row=>row.kind==='disconnect'&&row.nodeType==='AudioWorkletNode'));assert.ok(graph.events.every(row=>Number.isFinite(row.wallMs)&&row.audioTime===context.currentTime));
 const cleanup=observer.restore();assert.equal(cleanup.restored,true);assert.equal(cleanup.overflow,false);assert.deepEqual([...cleanup.errors],[]);assert.equal(receiver.onEnded,ended);assert.deepEqual([Receiver.prototype.prepare,Receiver.prototype.start,AudioNode.prototype.connect,AudioNode.prototype.disconnect],originals);assert.equal(frames.size,0);
 const failing=await realm.observe({}, {Receiver,root}),next=new Receiver(),nextError=next.onError;await next.prepare(original.plan,options);await next.start(startOptions);next.onError(Error('original product failure'));
 const cleanupCalls=[];root.cancelAnimationFrame=()=>{cleanupCalls.push('frame');throw Error('frame cleanup failure');};next.node.port.removeEventListener=()=>{cleanupCalls.push('port');throw Error('port cleanup failure');};next.node.removeEventListener=()=>{cleanupCalls.push('processor');throw Error('processor cleanup failure');};next.output.disconnect=()=>{cleanupCalls.push('tap-input');throw Error('tap cleanup failure');};context.removeEventListener=()=>{cleanupCalls.push('context');throw Error('context cleanup failure');};
 const failed=failing.restore();assert.equal(failed.restored,false);assert.equal(failed.errors[0].message,'original product failure');assert.deepEqual(cleanupCalls,['frame','port','port','processor','tap-input','context']);assert.equal(failed.cleanupErrors.length,6);assert.deepEqual([Receiver.prototype.prepare,Receiver.prototype.start,AudioNode.prototype.connect,AudioNode.prototype.disconnect],originals,'Every independent prototype restoration still ran');assert.equal(next.onError,nextError);
});


test('quiet worklet evidence rejects connected, undisposed and pending owned nodes even with zero summary counters',()=>{
 const good=syntheticAudioThreadStatus();validateAudioThreadStatus(good,{quiet:true});
 for(const mutate of [row=>row.connected=true,row=>row.nodeConnections=1,row=>row.gateConnections=1,row=>row.disposed=false,row=>row.disposing=true,row=>row.pendingCommands=1,row=>row.pendingStarts=1]){const status=structuredClone(good);mutate(status.ownedNodes[0]);assert.throws(()=>validateAudioThreadStatus(status,{quiet:true}));const runs=schedules();mutate(runs[0].lifecycle);assert.throws(()=>validateBasicKeySchedules(runs,opened().clean_package.runtime));}
});
test('terminal callback proof binds complete frame arrays and counters to the retained trusted native payload',()=>{
 const good=schedules();validateBasicKeySchedules(good,opened().clean_package.runtime);
 for(const mutate of [raw=>raw.record.ledger.actualStarts[0]++,raw=>raw.record.ledger.actualEnds[1]++,raw=>raw.record.started++,raw=>raw.record.sourceSha256='0'.repeat(64),raw=>raw.isTrusted=false,raw=>raw.portMatches=false,raw=>raw.ledgerType='Array']){const runs=structuredClone(good);mutate(runs[0].rawTerminals[0]);assert.throws(()=>validateBasicKeySchedules(runs,opened().clean_package.runtime));}
 const missing=structuredClone(good);missing[0].rawTerminals=[];assert.throws(()=>validateBasicKeySchedules(missing,opened().clean_package.runtime));
});
test('acceptance cleanup attempts every restoration and preserves the original product failure',async()=>{
 const source=await readFile(new URL('../crates/desktop-shell/basic-key-acceptance.js',import.meta.url),'utf8'),begin=source.indexOf('function runBasicKeyAcceptanceCleanup('),end=source.indexOf('async function observeBasicKeyEngraving(',begin),realm=vm.createContext({});vm.runInContext(source.slice(begin,end)+';globalThis.cleanup=runBasicKeyAcceptanceCleanup;',realm);
 const calls=[],report={ok:false,error:'original audio processor failure'};realm.cleanup(report,[['first',()=>{calls.push('first');throw Error('restore failed');}],['second',()=>{calls.push('second');return{restored:false,cleanupErrors:[{message:'tap removal failed'}]};}],['third',()=>calls.push('third')]]);
 assert.deepEqual(calls,['first','second','third']);assert.equal(report.error,'original audio processor failure');assert.equal(report.cleanupErrors.length,2);assert.equal(report.ok,false);
 const successful={ok:true};realm.cleanup(successful,[['failed',()=>false],['still-runs',()=>calls.push('last')]]);assert.equal(successful.ok,false);assert.match(successful.error,/Acceptance cleanup failed/);assert.equal(calls.at(-1),'last');
});

test('hosted origin is explicit while Windows/native verification remains exact HTTPS',()=>{
 const original=renderer('basic-key-seed'),hosted=structuredClone(original),origin='http://127.0.0.1:43210';hosted.origin=origin;
 validateBasicKeyRenderer(original);assert.throws(()=>validateBasicKeyRenderer(hosted));validateBasicKeyRenderer(hosted,undefined,{expectedOrigin:origin});
 for(const unexpected of ['https://foreign.example','http://localhost:43210','http://127.0.0.1:43211'])assert.throws(()=>validateBasicKeyRenderer(hosted,undefined,{expectedOrigin:unexpected}));
 assert.throws(()=>validateBasicKeyRenderer(original,undefined,{expectedOrigin:origin}));
});

test('Follow activation uses actual focused keyboard input and requires a trusted checked change',async()=>{
 const source=await readFile(new URL('../crates/desktop-shell/basic-key-acceptance.js',import.meta.url),'utf8'),begin=source.indexOf('function assertBasicKeyFollowFocus('),end=source.indexOf('async function prepareBasicKeyInputFocus(',begin),realm=vm.createContext({});
 vm.runInContext(source.slice(begin,end)+';globalThis.enable=enableBasicKeyFollowing;globalThis.guard=assertBasicKeyFollowFocus;',realm);
 for(const outcome of ['trusted','missed','untrusted','lost-focus','already-enabled']){
  const trusted=[],calls=[];let active=null;
  const node={id:'engraving-follow',type:'checkbox',disabled:false,checked:outcome==='already-enabled',scrollIntoView(){calls.push('scroll');},focus(options){assert.equal(options.preventScroll,true);active=node;}};
  const document={getElementById:()=>node,get activeElement(){return active;},hasFocus:()=>true,hidden:false,querySelector:()=>null};
  const options={trusted,frame:async()=>{},native:async(kind,target)=>{assert.equal(kind,'toggle-follow');assert.equal(target,node);calls.push('native');if(outcome==='lost-focus'){active=null;realm.guard(document,node);}if(outcome==='trusted'||outcome==='untrusted'){node.checked=true;trusted.push({id:node.id,type:'change',trusted:outcome==='trusted',checked:true});}return 19;},until:async(predicate,label,timeout)=>{assert.equal(timeout,3000);assert.match(label,/trusted Follow/);assert.equal(predicate(),true,'Missing real Follow activation');}};
  if(['missed','untrusted','lost-focus'].includes(outcome))await assert.rejects(realm.enable(document,options));
  else{const result=await realm.enable(document,options);if(outcome==='trusted')assert.deepEqual(JSON.parse(JSON.stringify(result)),{sequence:19,before:false,after:true,trustedChange:true});else{assert.equal(result,null);assert.deepEqual(calls,[]);}}
 }
 const base={id:'engraving-follow',type:'checkbox',disabled:false,checked:false},document={activeElement:base,hasFocus:()=>true,hidden:false,querySelector:()=>null};
 for(const mutate of [n=>n.id='other',n=>n.type='button',n=>n.disabled=true,n=>n.checked=true]){const n={...base};mutate(n);assert.throws(()=>realm.guard({...document,activeElement:n},n));}
 for(const override of [{activeElement:null},{hidden:true},{hasFocus:()=>false},{querySelector:()=>({open:true})}])assert.throws(()=>realm.guard({...document,...override},base));
 assert.doesNotMatch(source.slice(begin,end),/\.checked\s*=(?!=)|dispatchEvent|\.click\(/,'Setup must not synthesize a successful checkbox change');
});

test('Follow proof rejects a missed or untrusted activation before page-clock evidence can pass',()=>{
 const original=syntheticBasicKeyNotationEvidence();validateBasicKeyNotationEvidence(original);
 for(const mutate of [e=>e.followActivations=[],e=>e.followActivations[0].trustedChange=false,e=>e.followActivations[0].after=false,e=>e.followActivations[0].before=true,e=>e.followActivations[0].sequence=0,e=>e.followActivations.push({...e.followActivations[0]}),e=>e.followActivations.push({...e.followActivations[0],sequence:1})]){const e=structuredClone(original);mutate(e);assert.throws(()=>validateBasicKeyNotationEvidence(e));}
});


test('Follow native result binds exact Space to the owned app without pointer clicks or focus reacquisition',()=>{
 const result={ok:true,native_key:{app_hwnd:262506,foreground:262506,app_process_id:100,app_enabled:true,code:'Space',virtual_key:32,focus_reacquired:false,pointer_clicked:false}};validateBasicKeyNativeFollow(result,{process_id:100});
 for(const mutate of [v=>v.client_click={},v=>v.native_key.foreground=1,v=>v.native_key.app_process_id++,v=>v.native_key.app_enabled=false,v=>v.native_key.focus_reacquired=true,v=>v.native_key.pointer_clicked=true,v=>v.native_key.virtual_key=50,v=>v.native_key.code='Digit2']){const changed=structuredClone(result);mutate(changed);assert.throws(()=>validateBasicKeyNativeFollow(changed,{process_id:100}));}
 const original=renderer('basic-key-restart');validateBasicKeyRenderer(original);
 for(const mutate of [r=>r.trusted=r.trusted.filter(e=>e.id!=='engraving-follow'),r=>r.trusted.find(e=>e.id==='engraving-follow').checked=false,r=>r.trusted.find(e=>e.id==='engraving-follow').trusted=false,r=>r.trusted.find(e=>e.id==='engraving-follow').actionSequence++,r=>r.notation.followActivations[0].sequence=r.actions+1]){const r=structuredClone(original);mutate(r);assert.throws(()=>validateBasicKeyRenderer(r));}
});

import "./engraving-ownership-observer.test.js";

test('native toolbar observation rejects collapsed labels, overlapping actions and unbounded summary rows',async()=>{
 const source=await readFile(new URL('../crates/desktop-shell/basic-key-acceptance.js',import.meta.url),'utf8'),start=source.indexOf('function observeBasicKeyToolbar('),end=source.indexOf('function visibleBasicKeyPage(',start),observe=vm.runInNewContext(source.slice(start,end)+'\nobserveBasicKeyToolbar');
 const fixture=height=>{const element=(id,x,y,width,h=40)=>({id,clientWidth:width,scrollWidth:width,closest:()=>null,getClientRects:()=>[{}],getBoundingClientRect:()=>({x,y,width,height:h})}),buttons=[element('back-to-library',18,12,70),element('library-button',750,12,110),element('settings-button',870,12,55),element('edit-complete-practice',18,58,175)],hud=element('stage-hud',18,12,1244,86),title=element('stage-title',100,12,300,26),summary=element('complete-practice-summary',210,65,1000,18),style={whiteSpace:'nowrap',textOverflow:'ellipsis'};hud.querySelectorAll=()=>buttons;return{buttons,hud,title,summary,style,document:{defaultView:{innerWidth:1280,innerHeight:height,getComputedStyle:()=>style},querySelector:()=>hud,getElementById:id=>id==='stage-title'?title:summary}};};
 for(const height of [720,960,681]){const f=fixture(height),result=observe(f.document);assert.equal(result.viewport.height,height);assert.equal(result.buttons.length,4);assert.equal(result.summary.whiteSpace,'nowrap');}
 for(const mutate of [f=>f.buttons[1].getBoundingClientRect=()=>({x:750,y:12,width:12,height:140}),f=>f.hud.getBoundingClientRect=()=>({x:18,y:12,width:1244,height:150}),f=>f.title.getBoundingClientRect=()=>({x:100,y:12,width:70,height:26}),f=>f.buttons[2].getBoundingClientRect=()=>({x:800,y:12,width:100,height:40}),f=>f.buttons[1].scrollWidth=150,f=>f.style.whiteSpace='normal']){const f=fixture(720);mutate(f);assert.throws(()=>observe(f.document),/Stage toolbar layout/);}
 assert.match(source,/e\.frames\[name\]=\{toolbar:observeBasicKeyToolbar\(document\)/);
});

test('all-part numbered acceptance applies a complete Mod display after solo playback and reset',async()=>{
 const source=await readFile(new URL('../crates/desktop-shell/basic-key-acceptance.js',import.meta.url),'utf8'),start=source.indexOf("await capture('reset');"),end=source.indexOf("await capture('numbered',false);",start),sequence=source.slice(start,end);
 assert.match(sequence,/mod\.configure\(\['midi-t1-c1-r0'\],\{layout:'complete',showOthers:true\}\)[^]*?dataset\.scoreState==='session'[^]*?!\$\('notation-scope'\)\.disabled[^]*?native\('click',\$\('jianpu-button'\)\)/);
 assert.match(sequence,/dataset\.renderedNotationParts\|\|'\[\]'\)\.length===3/);
 assert.doesNotMatch(sequence,/\.value\s*=(?!=)|timeout|20000|30000/);
});
