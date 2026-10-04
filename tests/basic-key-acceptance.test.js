// These are verifier/fixture contracts, never evidence of a real UI or Windows run.
import test from 'node:test';
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
import {validateBasicKeyOpened,validateBasicKeyExport,validateBasicKeyRenderer,validateBasicKeyTakes,validateBasicKeySourceMeterDisclosure,verifyBasicKeyNativeEvidence} from '../scripts/verify-basic-key-evidence.mjs';
import {storedZip} from './native-import-driver-fixtures.js';
import {digest} from './clean-song-package-fixtures.js';
import {readBulkEvidenceZip} from '../scripts/verify-native-bulk-import-evidence.mjs';
import {addNativeProfileEvidence} from './native-profile-evidence-fixtures.js';
const fixture=basicKeyAcceptanceFixture();
function syntheticPickerGestures(){
 const state={button:0,buttons:0,defaultPrevented:false,activation:{isActive:true,hasBeenActive:true},focus:{hasFocus:true,activeId:'import-button',visibility:'visible'},trigger:{id:'import-button',tag:'BUTTON',type:'submit',disabled:false,connected:true,inert:false},input:{id:'score-file',tag:'INPUT',type:'file',disabled:false,connected:true,inert:false,multiple:true},dialog:{id:'import-tools-dialog',open:true,modal:true}};
 return[['before-action',null,null],['pointerdown','import-button',true],['pointerup','import-button',true],['click','import-button',true],['click','score-file',false],['change','score-file',true]].map(([type,targetId,trusted])=>({...structuredClone(state),observedAtMs:1050,eventTimeMs:type==='before-action'?null:50,type,targetId,trusted}));
}
function syntheticScreenshot(){const crc=b=>{let c=0xffffffff;for(const v of b){c^=v;for(let i=0;i<8;i++)c=c>>>1^((c&1)?0xedb88320:0);}return(c^0xffffffff)>>>0;},chunk=(name,data)=>{const b=Buffer.alloc(data.length+12);b.writeUInt32BE(data.length);b.write(name,4);data.copy(b,8);b.writeUInt32BE(crc(b.subarray(4,-4)),b.length-4);return b;};const header=Buffer.alloc(13);header.writeUInt32BE(640);header.writeUInt32BE(360,4);header[8]=8;header[9]=2;const pixels=Buffer.alloc(1921*360);let value=17;for(let i=0;i<pixels.length;i++){value=(Math.imul(value,1664525)+1013904223)>>>0;pixels[i]=i%1921?value>>>24:0;}return Buffer.concat([Buffer.from('89504e470d0a1a0a','hex'),chunk('IHDR',header),chunk('IDAT',deflateSync(pixels)),chunk('IEND',Buffer.alloc(0))]);}

function opened(){return basicKeyNativeRendition().open;}
function transport(){const state={passId:'1',captured:'1',cue:'paused',phase:'paused',hidden:false,openDialogs:[],positionMs:900,durationMs:12000};return{version:1,stage:'complete',omitted:0,rowBytes:3000,trustedPlayClicks:2,trustedKeyDowns:1,trustedKeyUps:1,current:state,rows:[{kind:'ready',elapsedMs:0,state:{...state,positionMs:0,captured:'0'}},{kind:'transport',elapsedMs:20,state:{...state,phase:'capturing',positionMs:200}},{kind:'event',elapsedMs:30,state,event:{type:'keydown',trusted:true,code:'Digit2',surface:'stage-title',repeat:false}},{kind:'event',elapsedMs:40,state,event:{type:'keyup',trusted:true,code:'Digit2',surface:'stage-title',repeat:false}}]};}
function schedules(){return expectedBasicKeySchedules(opened().clean_package.runtime).map((row,i)=>({...row,start:1+i,end:1+i+row.gateMs/1000,voiceStart:1+i,voiceEnd:1+i+row.gateMs/1000,returnedVoice:true,preserveFrequency:true,wave:'sine',singleTone:true,percussionType:row.role==='percussion_selector'?'noise':null,percussionFrequency:row.role==='percussion_selector'?1500:null,timbre:row.role==='percussion_selector'?'WMH basic percussion pulse':'WMH basic sine'}));}
function listening(){const paused={wallMs:100,position:750,captured:'0',assessments:0,scheduled:3,audio:{activeSources:0,pendingSources:0,sourceStarts:3,oscillatorStarts:2}};return{version:1,before:{captured:'0',assessments:0},paused,afterPause:{...paused,wallMs:200},ended:{...paused,position:12020,renderer:'ended',audio:{activeSources:0,pendingSources:0,sourceStarts:6,oscillatorStarts:5}},schedules:schedules(),takeState:{historyHidden:true,passOptions:[''],exportDisabled:true,assessmentDisabled:true},following:{stopped:true,overflow:false,rows:opened().clean_package.runtime.compilation.timeline.notes.map(n=>({position:n[4]+1,renderer:'playing',ids:[n[0]],rails:['midi-t1-e4','midi-t3-e1'].includes(n[0])?[]:[n[0]],measure:'0'}))},replayEnd:{position:12020,renderer:'ended',captured:'0',assessments:0,audio:{activeSources:0,pendingSources:0,sourceStarts:11}}};}
function allParts(){const f={scope:'all',status:'ready',rendered:['midi-t1-c1-r0','midi-t2-c10-r0','midi-t3-c1-r0'],human:'midi-t1-c1-r0',mix:['midi-t1-c1-r0','midi-t2-c10-r0','midi-t3-c1-r0'].map(id=>({id,checked:true})),parts:[{id:'midi-t1-c1-r0',visible:true},{id:'midi-t3-c1-r0',visible:true}],rows:[{id:'midi-t2-e1',part:'midi-t2-c10-r0',visible:true}],glyphs:[{visible:true}],bounds:{visible:true},coverage:'显示 3 / 3 个声部',scrollTop:0,scrollHeight:500,clientHeight:300};return{frames:[structuredClone(f),{...structuredClone(f),scrollTop:100}],after:structuredClone(f),responses:basicKeyNativeRendition().pages};}
function sourceMeterDisclosure(){
 const surface=(id,text)=>({id,text,visible:true,bounds:{x:750,y:180,width:300,height:40}});
 return{locale:'zh-CN',viewport:{width:1280,height:720},choice:{label:surface('engraving-basic-meter-label','来源拍号未确定时使用的显示拍号'),control:{...surface('engraving-basic-meter','使用来源拍号'),value:'source',disabled:false},provenance:surface('engraving-basic-provenance','基础解释 v1；原始源记谱保持不变。')},status:surface('engraving-status','来源没有明确的起始拍号。此选择不会添加来源拍号事件，也不会改变练习时序。')};
}
function renderer(phase){const o=opened(),key=`song-${o.clean_package.content_sha256}`,preview={tracks:fixture.score.performance.tracks.map(t=>`${t.name} · ${t.events.length} retained events · 保留 ${t.events.length} 个事件`),parts:[{disabled:false},{disabled:false},{disabled:false}],listenDisabled:false,practiceDisabled:false,audio:{sourceStarts:0}};return{version:1,phase,ok:true,origin:'https://wmh.localhost',profileMarkerAbsent:true,errors:[],key,opened:o,inventory:[{key}],previews:{en:{...preview,coverage:'18 source events retained · 5 attacks: 3 positive determined, 1 instantaneous, 1 unresolved',rendition:'Basic interpretation v1 retains all 5 note onsets with default synthesized sounds'},'zh-CN':{...preview,coverage:'18 个源事件 · 5 次按键：3 个已确定正时长、1 个瞬时、1 个结束未确定',rendition:'基础解释 v1 包含全部 5 次起音与默认合成声音'}},stageState:{target:BASIC_KEY_HUMAN_PART,notationPart:BASIC_KEY_HUMAN_PART,countInDisabled:true,tempo:'120',range:'35～72 · 5 个可练目标',partCheckboxes:[{id:'midi-t1-c1-r0',disabled:false,checked:true},{id:'midi-t2-c10-r0',disabled:false,checked:true},{id:BASIC_KEY_HUMAN_PART,disabled:true,checked:false}]},noInput:{captured:'0',soundMuted:false,audio:{sourceStarts:2}},humanAudio:{sourceStarts:5},completePractice:{schedules:schedules().filter(n=>n.key!==72),ended:{position:12020,captured:'1',assessments:2,audio:{activeSources:0,pendingSources:0}}},receiverCleanup:{restored:true,overflow:false},fetchRestored:true,engravingRestored:true,currentPartView:{scope:'current',status:'ready',rendered:[BASIC_KEY_HUMAN_PART],noteIds:['midi-t3-e1'],glyphs:[{visible:true}]},accompaniment:schedules().filter(n=>n.key!==72),requests:[],layout:{width:1280,height:720,documentWidth:1280},trusted:[{type:'click',id:'start-listen',trusted:true},{type:'change',id:'preview-part',trusted:true},{type:'keydown',code:'Digit2',trusted:true},...['open-score','engraving-basic-meter','engraving-page-size','progress','jianpu-button'].map(id=>({id,type:id==='progress'?'input':id.startsWith('engraving-')?'change':'click',trusted:true}))],negative:[{file:BASIC_KEY_FILES.profile,ready:0,statuses:[{status:'retained_nonplayable',playable:false,code:'pack_source_only',message:'Invalid complete profile; inspect source'}],text:'Invalid complete profile; inspect source',inventory:0},{file:BASIC_KEY_FILES.coverage,ready:0,statuses:[{status:'retained_nonplayable',playable:false,code:'pack_source_only',message:'Invalid complete profile; inspect source'}],text:'Invalid complete profile; inspect source · Forged coverage; re-create the complete package',inventory:0}],imports:[{body:{summary:{saved:1}}}],actions:7,allParts:allParts(),sourceMeterDisclosure:sourceMeterDisclosure(),pickerObservations:phase==='basic-key-seed'?[BASIC_KEY_FILES.profile,BASIC_KEY_FILES.coverage,BASIC_KEY_FILES.valid].map((filename,index)=>({sequence:index+1,filename,completed:true,gestures:syntheticPickerGestures(),changes:[{filename,trusted:true}]})):[],screenshots:Object.fromEntries(['english','chinese','track0','track1','track2','track3','track4',...(phase==='basic-key-seed'?[BASIC_KEY_FILES.profile,BASIC_KEY_FILES.coverage,'listen-paused','listen-end','listen-empty-results','all-parts','all-scroll-0']:['stage','human','meter-choice','meter-status',...['first','crossed','numbered','end','reset'].map(n=>`notation-${n}`)])].map(role=>[role,7])),assessmentRequests:[{inputs:[{midi:72}],timeline:{notes:[{id:'midi-t3-e1'}]}}],assessmentResponses:[{status:200,body:{hits:[{note_id:'midi-t3-e1',midi:72,expected_ms:500,actual_ms:500,delta_ms:0,grade:'perfect'}],misses:[],extras:[]}}],transportAdmission:transport(),...(phase==='basic-key-restart'?{notation:syntheticBasicKeyNotationEvidence(),practiceAssessmentStart:1,assessmentRequests:[syntheticBasicKeyNotationEvidence().naturalAssessment.request,{inputs:[{midi:72}],timeline:{notes:[{id:'midi-t3-e1'}]}}],assessmentResponses:[syntheticBasicKeyNotationEvidence().naturalAssessment.response,{status:200,body:{hits:[{note_id:'midi-t3-e1',midi:72,expected_ms:500,actual_ms:500,delta_ms:0,grade:'perfect'}],misses:[],extras:[]}}]}:{}),listening:listening(),files:phase==='basic-key-seed'?{package:`${phase}-3.zip`}:{machineTake:`${phase}-1.json`,humanTake:`${phase}-2.json`}};}
function take(human){const input={midi:72,velocity:90,at_ms:500},id=fixture.score.notation.id;return{version:1,score_id:id,practice_part:BASIC_KEY_HUMAN_PART,passes:[{id:1,capture_enabled:true,interpretation:{policy_id:'wmh-basic-key-rendition-fifo-v1',runtime_profile:'wmh-basic-key-practice-v2',source_sha256:fixture.manifest.source.sha256,package_content_sha256:fixture.manifest.package.content_sha256,practice_part:BASIC_KEY_HUMAN_PART,source_target_ids:['midi-t3-e1'],policy:opened().clean_package.runtime.rendition.policy},timeline:{notes:[{id:'midi-t3-e1',midi:72}]},inputs:human?[input]:[],captures:human?[{event_id:1,event_wall_ms:1100,received_wall_ms:1101,input}]:[],assessment:human?{hits:[{note_id:'midi-t3-e1',midi:72,expected_ms:500,actual_ms:500,delta_ms:0,grade:'perfect'}],misses:[],extras:[]}:null}],input_evidence:{version:1,truncated:false,omitted_observations:0,events:human?[{event_id:1,kind:'note_on',source_id:'keyboard-digit2',input_kind:'typing_keyboard',encoding:'key_down',midi:72,velocity:90,event_wall_ms:1100,received_wall_ms:1101,onset_capture:{pass_id:1,event_id:1}},{event_id:2,kind:'note_off',encoding:'key_up'}]:[]}};}
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
test('export proof compares exact files including whitespace and refuses extra source payload',()=>{const key='song-test';validateBasicKeyExport(exported(key),fixture,key);const changed=new Map(readBulkEvidenceZip(exported(key)));changed.set(`songs/${key}/score.json`,Buffer.concat([fixture.files.get('score.json'),Buffer.from('\n')]));assert.throws(()=>validateBasicKeyExport(storedZip([...changed]),fixture,key));changed.set(`songs/${key}/source.mid`,fixture.source);assert.throws(()=>validateBasicKeyExport(storedZip([...changed]),fixture,key));});
async function evidence(t){const directory=await mkdtemp(join(tmpdir(),'wmh-basic-gate-'));t.after(()=>rm(directory,{recursive:true,force:true}));await prepareBasicKeyFixtures(join(directory,'fixtures'));await mkdir(join(directory,'downloads'));const save=async(p,v)=>{const full=join(directory,p);await mkdir(join(full,'..'),{recursive:true});await writeFile(full,typeof v==='object'&&!Buffer.isBuffer(v)?JSON.stringify(v):v);};const executable=join(directory,'test-exe.bin'),exe=Buffer.from('Original verifier fixture; this is not an executable');await save('test-exe.bin',exe);const sourceSha='a'.repeat(40),sourceTree='b'.repeat(40),native={version:1,ok:true,scenario:'basic-key',profile_reused:false,source_sha:sourceSha,source_tree:sourceTree,executable_sha256:digest(exe),executable_bytes:exe.length,directory:join(directory,'Scores'),phases:[]};return{directory,save,native,sourceSha,sourceTree,executable};}
test('native proof re-reads exact artifacts and rejects changed score bytes or missing screenshots',async t=>{
 const f=await evidence(t),rows=[],png=syntheticScreenshot();
 for(const [index,phase]of BASIC_KEY_PHASES.entries()){
  const r=renderer(phase),actions=[...(phase==='basic-key-seed'?[BASIC_KEY_FILES.profile,BASIC_KEY_FILES.coverage,BASIC_KEY_FILES.valid].map(file=>({kind:'picker',file})):[]),{kind:'select-last'},{kind:'select-first'},{kind:'select-second'},...(phase==='basic-key-restart'?[{kind:'select-second'}]:[]),...(phase==='basic-key-restart'?[{kind:'key-c5'}]:[]),{kind:'click'}];r.actions=actions.length;for(const k of Object.keys(r.screenshots))r.screenshots[k]=actions.length;
  const host={phase,process_id:100+index,profile_fresh:true,profile_reused:false,renderer_ok:true,normal_close:true,executable_tcp_listeners:0,actions:r.actions,renderer_origin:r.origin};f.native.phases.push(host);
  for(const [i,a]of actions.entries()){await f.save(`action-${phase}-${i+1}.json`,{version:1,sequence:i+1,x:10,y:20,width:1280,height:720,...a});await f.save(`result-${phase}-${i+1}.json`,{ok:true,client_click:{app_hwnd:1},...(a.kind==='picker'?{owned_dialog:{app_process_id:host.process_id},picker_completion:{dialog_dismissed:true,app_enabled:true,owned_popup_visible:false}}:{})});}
  await f.save(`native-action-${phase}-${actions.length}.png`,png);await f.save(`native-${phase}.png`,png);await f.save(`renderer-${phase}.json`,r);if(phase==='basic-key-restart'){await f.save(`downloads/${r.files.machineTake}`,take(false));await f.save(`downloads/${r.files.humanTake}`,take(true));}if(phase==='basic-key-seed'){await f.save(`downloads/${r.files.package}`,exported(r.key));}
  for(const area of ['clean-songs','clean-backups'])for(const[path,bytes]of fixture.files){const name=`${area}/${r.key}/package/${path}`;await f.save(`Scores/${name}`,bytes);if(index===0)rows.push({path:name,bytes:bytes.length,sha256:digest(bytes)});}await f.save(`snapshot-${phase}.json`,{version:1,files:rows});
 }
 await addNativeProfileEvidence(f.native,f.save);await f.save('native-basic-key.json',f.native);const proof=await verifyBasicKeyNativeEvidence(f.directory,{sourceSha:f.sourceSha,sourceTree:f.sourceTree,executable:f.executable});assert.equal(proof.ok,true);assert.equal(proof.claims.full_acceptance,false);
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
  v=>v.frames.first.model.notes[0].duration.numerator=3,v=>v.frames.crossed.model.notes[1].tieMembers=[1],
  v=>v.frames.crossed.model.curves[0].from=1,v=>v.frames.reset.model.xmlNotes[1].ties=[],v=>v.frames.numbered.numbered=[],
  v=>v.frames.crossed.ids=[],v=>v.frames.crossed.cues[0].measure='2',v=>v.frames.first.heads=0,
  v=>v.frames.end.pageFirst=2,v=>v.frames.reset.position=12000,v=>v.frames.crossed.audio.sourceStarts=0,
  v=>v.frames.first.assessments=1,v=>v.inspection.position=1,v=>v.frames.numbered.overlay=false,
 ]){const value=structuredClone(e);mutate(value);assert.throws(()=>validateBasicKeyNotationEvidence(value));}
 const r=renderer('basic-key-restart');validateBasicKeyRenderer(r);delete r.notation;assert.throws(()=>validateBasicKeyRenderer(r));
});
test('notation interactions remain real native controls and retain finite original-source bounds',async()=>{
 const source=await readFile(new URL('../crates/desktop-shell/basic-key-acceptance.js',import.meta.url),'utf8');
 assert.match(source,/observeBasicKeyEngraving/);assert.match(source,/Reflect.apply\(load,this/);assert.match(source,/Reflect.apply\(render,this/);
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
  const context=vm.createContext({report:{screenshots:{},files:{}},receiver:{snapshot:()=>[]},accompanimentStart:0,$:id=>({'song-parts-tools':parts,'song-parts-summary':summary,'song-complete-range-text':range})[id],assert:(value,message)=>assert.ok(value,message),native:async(kind,node)=>{
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
 for(const mutate of [e=>e.schedules.pop(),e=>e.schedules[1].key=36,e=>e.schedules[1].velocity=90,e=>e.schedules[1].percussionFrequency=1200,e=>e.schedules[0].eventId='unknown',e=>e.afterPause.position++,e=>e.afterPause.scheduled++,e=>e.paused.audio.pendingSources=1,e=>e.ended.position=12000,e=>e.ended.captured='1',e=>e.ended.assessments=1,e=>e.following.rows.pop(),e=>e.following.rows[1].rails=[]]){const e=listening();mutate(e);assert.throws(()=>validateBasicKeyListening(e,runtime));}
 assert.throws(()=>validateBasicKeySchedules(schedules(),runtime,{targetPart:BASIC_KEY_HUMAN_PART}));
 const changed=listening();changed.takeState.passOptions.push('1');assert.throws(()=>validateBasicKeyListening(changed,runtime));
});
test('one real human-hit proof requires exact selected targets, original interpretation and input causality',()=>{
 const r=renderer('basic-key-seed');validateBasicKeyTakes(take(false),take(true),r);
 for(const mutate of [v=>v.passes[0].interpretation.policy_id='other',v=>v.passes[0].interpretation.source_target_ids=['midi-t1-e4'],v=>v.passes[0].inputs[0].midi=60,v=>v.passes[0].timeline.notes.push({id:'midi-t1-e4',midi:60}),v=>v.passes[0].assessment.hits=[],v=>v.input_evidence.events[0].input_kind='machine']){const human=take(true);mutate(human);assert.throws(()=>validateBasicKeyTakes(take(false),human,r));}
});
test('receiver observer preserves actual schedule calls and restores its original prototype',async()=>{
 const source=await readFile(new URL('../crates/desktop-shell/basic-key-acceptance.js',import.meta.url),'utf8'),begin=source.indexOf('async function observeBasicKeyReceiver('),end=source.indexOf('async function observeBasicKeyEngraving(',begin),calls=[];
 class Receiver{schedule(...args){calls.push({receiver:this,args});return this.voice;}}const original=Receiver.prototype.schedule,voice={start:3,end:4},receiver=new Receiver();receiver.voice=voice;
 const context=vm.createContext({testModule:{ReferenceAudioReceiver:Receiver},structuredClone});vm.runInContext(source.slice(begin,end).replace("await import('/midi-reference-synth.js')",'testModule')+';globalThis.observe=observeBasicKeyReceiver;',context);
 const observer=await context.observe({getElementById:()=>({value:500})}),note={eventId:'original-id',key:72,referenceTimbre:{name:'WMH basic sine'}},options={preserveFrequency:true};assert.equal(receiver.schedule(note,3,4,options),voice);assert.equal(calls[0].receiver,receiver);assert.deepEqual(calls[0].args,[note,3,4,options]);assert.equal(observer.snapshot()[0].eventId,'original-id');assert.deepEqual({...observer.restore()},{restored:true,overflow:false});assert.equal(Receiver.prototype.schedule,original);
});
test('C5 is one closed real-key action while the native action budget and shared KeyR defaults remain intact',async()=>{
 const ps=await readFile(new URL('../scripts/windows-desktop-acceptance.ps1',import.meta.url),'utf8'),host=await readFile(new URL('../scripts/hosted-basic-key-check.mjs',import.meta.url),'utf8'),rust=await readFile(new URL('../crates/desktop-shell/src/acceptance.rs',import.meta.url),'utf8'),runner=await readFile(new URL('../crates/desktop-shell/basic-key-acceptance.js',import.meta.url),'utf8');
 assert.match(ps,/kind -eq 'key-c5'\)\{\[NativeAcceptance\]::Key\(0x32\)/);assert.match(host,/kind==='key-c5'\)await page.keyboard.press\('Digit2'\)/);assert.match(rust,/"key-c5"/);assert.match(runner,/assert\(sequence<64/);assert.match(runner,/observeNativeReferenceTransport\(document,\{keyCode:'Digit2'\}\)/);assert.doesNotMatch(runner,/dispatchEvent|transport\.seek|progress'\)\.value\s*=/);
});
test('following observer records transport transitions without inventing clocks or extending short gates',async()=>{
 const source=await readFile(new URL('../crates/desktop-shell/basic-key-acceptance.js',import.meta.url),'utf8'),begin=source.indexOf('function observeBasicKeyFollowing('),end=source.indexOf('async function observeBasicKeyReceiver(',begin),queue=[],cancelled=[];
 const cursor={dataset:{sourceNoteIds:'["midi-t2-e1"]',sourceMeasureIndex:'0'}},progress={value:0},stage={dataset:{rendererState:'ready'}},document={getElementById:id=>({'written-cursor-status':cursor,progress,'clean-song-stage':stage})[id],querySelectorAll:()=>[{dataset:{noteId:'midi-t2-e1'}}]};
 const context=vm.createContext({requestAnimationFrame:callback=>(queue.push(callback),queue.length),cancelAnimationFrame:id=>cancelled.push(id)});vm.runInContext(source.slice(begin,end)+';globalThis.observe=observeBasicKeyFollowing;',context);const observer=context.observe(document);
 queue.shift()();stage.dataset.rendererState='playing';progress.value=1;queue.shift()();cursor.dataset.sourceNoteIds='[]';progress.value=250;queue.shift()();const result=observer.stop();assert.equal(result.stopped,true);assert.equal(result.overflow,false);assert.equal(cancelled.length,1);assert.deepEqual(Array.from(result.rows,row=>[row.position,row.renderer]),[[0,'ready'],[1,'playing'],[250,'playing']]);assert.equal(progress.value,250);assert.equal(cursor.dataset.sourceNoteIds,'[]');
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
  assert.equal(run[0].if,name==='windows-desktop-acceptance.yml'?"${{ !cancelled() && steps.notation_server.outcome == 'success' && steps.dense_browser_setup.outcome == 'success' }}":undefined);
  assert.notEqual(run[0]['continue-on-error'],true);assert.deepEqual(run[0].env,{WMH_HOSTED_BROWSER:'1',WMH_SOURCE_SHA:'${{ github.sha }}',WMH_SERVER_BINARY:'${{ github.workspace }}/target/debug/practice-server'});
  assert.ok(steps.findIndex(step=>step.run==='cargo build -p practice-server --locked')<steps.indexOf(run[0]));
  const upload=steps.find(step=>step.with?.name==='notation-scope-browser-${{ github.sha }}');assert.equal(upload.if,'always()');assert.deepEqual(upload.with.path.trim().split('\n'),['test-results/notation-scope/report.json','test-results/notation-scope/*.png','test-results/notation-scope/server.log']);
 }
 const path=fileURLToPath(new URL('../scripts/hosted-notation-scope-check.mjs',import.meta.url)),denied=spawnSync(process.execPath,[path],{encoding:'utf8',env:{...process.env,GITHUB_ACTIONS:'false',WMH_HOSTED_BROWSER:'0'}});assert.equal(denied.status,1);assert.match(denied.stderr,/require the authorized hosted Actions runner/);
 const source=await readFile(path,'utf8');assert.match(source,/source_tree/);assert.match(source,/server_sha256/);assert.match(source,/sha256:digest\(bytes\)/);assert.match(source,/source_measure_index===1/);assert.match(source,/continuing_note_ids.includes\('original-held-12'\)/);assert.doesNotMatch(source,/progress[^\n]*>=\.05/);assert.match(source,/new Set\(batches.flatMap\(batch=>batch.renderedIds\)\).size,12/);
});
