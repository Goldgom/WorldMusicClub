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
import {basicKeyAcceptanceFixture,originalBasicKeyMidi,prepareBasicKeyFixtures,BASIC_KEY_FILES,BASIC_KEY_PHASES} from '../scripts/prepare-basic-key-fixtures.mjs';
import {validateBasicKeyOpened,validateBasicKeyExport,validateBasicKeyRenderer,validateBasicKeySourceMeterDisclosure,verifyBasicKeyNativeEvidence} from '../scripts/verify-basic-key-evidence.mjs';
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

function opened(){const value=JSON.parse(readFileSync(new URL('./fixtures/basic-keys-native-open.json',import.meta.url)));const p=value.clean_package;p.score_json=fixture.files.get('score.json').toString();p.metadata_json=fixture.files.get('metadata.json').toString();p.coverage=fixture.score.coverage;p.content_sha256=fixture.manifest.package.content_sha256;p.runtime.source_sha256=fixture.manifest.source.sha256;p.runtime.compilation.timeline.duration_ms=12000;p.runtime.compilation.timeline.notes[0].duration_ms=12000;return value;}
function transport(){const state={passId:'1',captured:'1',cue:'paused',phase:'paused',hidden:false,openDialogs:[],positionMs:900,durationMs:12000};return{version:1,stage:'complete',omitted:0,rowBytes:3000,trustedPlayClicks:2,trustedKeyDowns:1,trustedKeyUps:1,current:state,rows:[{kind:'ready',elapsedMs:0,state:{...state,positionMs:0,captured:'0'}},{kind:'transport',elapsedMs:20,state:{...state,phase:'capturing',positionMs:200}},{kind:'event',elapsedMs:30,state,event:{type:'keydown',trusted:true,code:'KeyR',surface:'stage-title',repeat:false}},{kind:'event',elapsedMs:40,state,event:{type:'keyup',trusted:true,code:'KeyR',surface:'stage-title',repeat:false}}]};}
function sourceMeterDisclosure(){
 const surface=(id,text)=>({id,text,visible:true,bounds:{x:750,y:180,width:300,height:40}});
 return{locale:'zh-CN',viewport:{width:1280,height:720},choice:{label:surface('engraving-basic-meter-label','来源拍号未确定时使用的显示拍号'),control:{...surface('engraving-basic-meter','使用来源拍号'),value:'source',disabled:false},provenance:surface('engraving-basic-provenance','MIDI 按键视图；来源的实际音高和鼓键映射仍未确定。')},status:surface('engraving-status','来源没有明确的起始拍号。此选择不会添加来源拍号事件，也不会改变练习时序。')};
}
function renderer(phase){const o=opened(),key=`song-${o.clean_package.content_sha256}`,preview={tracks:fixture.score.performance.tracks.map(t=>`${t.name} · ${t.events.length} retained events · 保留 ${t.events.length} 个事件`),parts:[{disabled:false},{disabled:true},{disabled:false}],listenDisabled:true,practiceDisabled:false,audio:{sourceStarts:0}};return{version:1,phase,ok:true,origin:'https://wmh.localhost',profileMarkerAbsent:true,errors:[],key,opened:o,inventory:[{key}],previews:{en:{...preview,coverage:'18 source events retained · 5 attacks: 3 positive determined, 1 instantaneous, 1 unresolved',rendition:'Reference audio unavailable'},'zh-CN':{...preview,coverage:'18 个源事件 · 5 次按键：3 个已确定正时长、1 个瞬时、1 个结束未确定',rendition:'参考音频不可用'}},stageState:{target:'midi-t1-c1-r0',notationPart:'',countInDisabled:true,tempo:'120',range:'35～72 · 2 个可练目标',partCheckboxes:Array.from({length:3},()=>({disabled:true}))},noInput:{captured:'0',soundMuted:false,audio:{sourceStarts:0}},humanAudio:{sourceStarts:0},requests:[],layout:{width:1280,height:720,documentWidth:1280},trusted:[{type:'change',id:'preview-part',trusted:true},{type:'keydown',code:'KeyR',trusted:true},...['open-score','engraving-basic-meter','engraving-page-size','progress','jianpu-button'].map(id=>({id,type:id==='progress'?'input':id.startsWith('engraving-')?'change':'click',trusted:true}))],negative:[{file:BASIC_KEY_FILES.profile,ready:0,statuses:[{status:'retained_nonplayable',playable:false,code:'pack_source_only',message:'Invalid complete profile; inspect source'}],text:'Invalid complete profile; inspect source',inventory:0},{file:BASIC_KEY_FILES.coverage,ready:0,statuses:[{status:'retained_nonplayable',playable:false,code:'pack_source_only',message:'Invalid complete profile; inspect source'}],text:'Invalid complete profile; inspect source · Forged coverage; re-create the complete package',inventory:0}],imports:[{body:{summary:{saved:1}}}],actions:7,sourceMeterDisclosure:sourceMeterDisclosure(),pickerObservations:phase==='basic-key-seed'?[BASIC_KEY_FILES.profile,BASIC_KEY_FILES.coverage,BASIC_KEY_FILES.valid].map((filename,index)=>({sequence:index+1,filename,completed:true,gestures:syntheticPickerGestures(),changes:[{filename,trusted:true}]})):[],screenshots:Object.fromEntries(['english','chinese','track0','track1','track2','track3','track4','stage','human','meter-choice','meter-status',...(phase==='basic-key-seed'?[BASIC_KEY_FILES.profile,BASIC_KEY_FILES.coverage]:['first','crossed','numbered','end','reset'].map(n=>`notation-${n}`))].map(role=>[role,7])),assessmentRequests:[{inputs:[{midi:60}],timeline:{notes:[{id:'midi-t1-e4'}]}}],assessmentResponses:[{status:200,body:{hits:[],misses:['midi-t1-e4'],extras:[0]}}],transportAdmission:transport(),...(phase==='basic-key-restart'?{notation:syntheticBasicKeyNotationEvidence(),practiceAssessmentStart:1,assessmentRequests:[syntheticBasicKeyNotationEvidence().naturalAssessment.request,{inputs:[{midi:60}],timeline:{notes:[{id:'midi-t1-e4'}]}}],assessmentResponses:[syntheticBasicKeyNotationEvidence().naturalAssessment.response,{status:200,body:{hits:[],misses:['midi-t1-e4'],extras:[0]}}]}:{}),files:{machineTake:`${phase}-1.json`,humanTake:`${phase}-2.json`,...(phase==='basic-key-seed'?{package:`${phase}-3.zip`}:{})}};}
function take(human){const input={midi:60,velocity:90,at_ms:100},id=fixture.score.notation.id;return{version:1,score_id:id,practice_part:'midi-t1-c1-r0',passes:[{id:1,capture_enabled:true,timeline:{notes:[{id:'midi-t1-e4',midi:60}]},inputs:human?[input]:[],captures:human?[{event_id:1,event_wall_ms:1100,received_wall_ms:1101,input}]:[],assessment:human?{hits:[],misses:['midi-t1-e4'],extras:[0]}:null}],input_evidence:{version:1,truncated:false,omitted_observations:0,events:human?[{event_id:1,kind:'note_on',source_id:'keyboard-r',input_kind:'typing_keyboard',encoding:'key_down',midi:60,velocity:90,event_wall_ms:1100,received_wall_ms:1101,onset_capture:{pass_id:1,event_id:1}},{event_id:2,kind:'note_off',encoding:'key_up'}]:[]}};}
function exported(key){return storedZip([...fixture.files].map(([name,b])=>[`songs/${key}/${name}`,b]).concat([['manifest.json',JSON.stringify({format:'worldmusichub-song-pack',version:2,songs:[{folder:`songs/${key}`} ]})]]));}
test('original basic-key fixture retains unsupported records, all tracks and source hash',()=>{assert.equal(digest(originalBasicKeyMidi()),'7e5fea609420469fc4178cb8f1d740c80a3f07d0833632794aa0cd68375e5315');assert.equal(fixture.source.length,130);assert.deepEqual(fixture.score.performance.tracks.map(t=>t.events.length),[9,3,3,2,1]);assert.deepEqual(fixture.score.performance.tracks[0].events.slice(0,3),[[0,[176,0,7]],[0,[192,42]],[0,[176,74,91]]]);assert.deepEqual(fixture.score.notation.meters,[]);assert.deepEqual(fixture.score.notation.tempo,[]);assert.equal(fixture.score.coverage.projected_melodic_targets,2);assert.equal(fixture.score.coverage.key_attacks,5);assert.equal(fixture.score.coverage.zero_length_attacks,1);assert.equal(fixture.score.coverage.unresolved_ends,1);assert.deepEqual([...readBulkEvidenceZip(fixture.bytes).keys()].sort(),['manifest.json','songs/original-basic-key/metadata.json','songs/original-basic-key/score.json']);assert.equal(fixture.manifest.rights.license,'CC0-1.0');});
test('negative fixtures have valid outer score hashes and fail actual profile/coverage semantics',()=>{for(const[id,bytes]of Object.entries(fixture.variants)){const files=readBulkEvidenceZip(bytes),meta=JSON.parse(files.get('songs/original-basic-key/metadata.json')),scoreBytes=files.get('songs/original-basic-key/score.json'),score=JSON.parse(scoreBytes);assert.equal(meta.score.sha256,digest(scoreBytes));assert.equal(meta.score.bytes,scoreBytes.length);assert.equal(score.source.sha256,fixture.score.source.sha256);if(id==='profile')assert.notEqual(score.performance.profile,fixture.score.performance.profile);else assert.equal(score.coverage.represented_events,fixture.score.coverage.represented_events-1);}});
test('receiver proof rejects lost sources, fabricated targets and absent honest UI evidence',()=>{validateBasicKeyOpened(opened());for(const mutate of [o=>o.clean_package.content_sha256='0'.repeat(64),o=>o.clean_package.score_json+=' ',o=>o.clean_package.runtime.parts.pop(),o=>o.clean_package.runtime.compilation.timeline.notes.push({id:'drum',midi:35,duration_ms:250}),o=>o.clean_package.runtime.reference_audio='available']){const value=opened();mutate(value);assert.throws(()=>validateBasicKeyOpened(value));}const r=renderer('basic-key-seed');validateBasicKeyRenderer(r);for(const mutate of [v=>v.previews['zh-CN'].tracks.pop(),v=>v.previews.en.parts[1].disabled=false,v=>v.sourceMeterDisclosure.status.text='4/4',v=>v.noInput.audio.sourceStarts=1,v=>v.trusted[0].trusted=false,v=>v.negative[0].statuses[0].playable=true,v=>v.inventory=[],v=>v.layout.documentWidth=2000]){const value=structuredClone(r);mutate(value);assert.throws(()=>validateBasicKeyRenderer(value));}});
test('incomplete renderer failure reports expose the causal error and stage before later evidence gates',()=>{
 for(const phase of BASIC_KEY_PHASES){
  const failure={version:1,phase,ok:false,stage:'trusted-keyboard-score',actions:0,screenshots:{},error:'Error: original diagnostic sentinel\n    at originalFixture'};
  assert.throws(()=>validateBasicKeyRenderer(failure),error=>{
   assert.match(error.message,new RegExp(`Basic-key ${phase} failed at trusted-keyboard-score`));
   assert.ok(error.message.includes(failure.error));
   assert.doesNotMatch(error.message,/deep-equal|screenshots|pickerObservations/);return true;
  });
  const successful=renderer(phase);delete successful.screenshots.human;
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
  const r=renderer(phase),actions=[...(phase==='basic-key-seed'?[BASIC_KEY_FILES.profile,BASIC_KEY_FILES.coverage,BASIC_KEY_FILES.valid].map(file=>({kind:'picker',file})):[]),{kind:'select-last'},{kind:'select-first'},...(phase==='basic-key-restart'?[{kind:'select-second'},{kind:'select-second'}]:[]),{kind:'key-r'},{kind:'click'}];r.actions=actions.length;for(const k of Object.keys(r.screenshots))r.screenshots[k]=actions.length;
  const host={phase,process_id:100+index,profile_fresh:true,profile_reused:false,renderer_ok:true,normal_close:true,executable_tcp_listeners:0,actions:r.actions,renderer_origin:r.origin};f.native.phases.push(host);
  for(const [i,a]of actions.entries()){await f.save(`action-${phase}-${i+1}.json`,{version:1,sequence:i+1,x:10,y:20,width:1280,height:720,...a});await f.save(`result-${phase}-${i+1}.json`,{ok:true,client_click:{app_hwnd:1},...(a.kind==='picker'?{owned_dialog:{app_process_id:host.process_id},picker_completion:{dialog_dismissed:true,app_enabled:true,owned_popup_visible:false}}:{})});}
  await f.save(`native-action-${phase}-${actions.length}.png`,png);await f.save(`native-${phase}.png`,png);await f.save(`renderer-${phase}.json`,r);await f.save(`downloads/${r.files.machineTake}`,take(false));await f.save(`downloads/${r.files.humanTake}`,take(true));if(phase==='basic-key-seed')await f.save(`downloads/${r.files.package}`,exported(r.key));
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
  v=>v.responses[2].response.page.continuations[0].source_end.numerator=8,v=>v.responses[3].response.page.unresolved=[],
  v=>v.frames.first.model.notes[0].duration.numerator=3,v=>v.frames.crossed.model.notes[1].tieMembers=[1],
  v=>v.frames.crossed.model.curves[0].from=1,v=>v.frames.reset.model.xmlNotes[1].ties=[],v=>v.frames.numbered.numbered=[],
  v=>v.frames.crossed.ids=[],v=>v.frames.crossed.cues[0].measure='2',v=>v.frames.first.heads=0,
  v=>v.frames.end.pageFirst=2,v=>v.frames.reset.position=12000,v=>v.frames.first.audio.sourceStarts=1,
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
 const row=syntheticBasicKeyNotationEvidence().responses[1];validateBasicKeyNotationResponse(row);row.request.settings.measure_count=32;assert.throws(()=>validateBasicKeyNotationResponse(row));
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
 const start=source.indexOf("if(!$('song-parts-tools').open)"),end=source.indexOf('\n  // Muting user monitoring',start);assert.ok(start>0&&end>start);
 for(const initiallyOpen of [false,true]){
  const parts={id:'song-parts-tools',open:initiallyOpen},summary={id:'song-parts-summary'},range={id:'song-complete-range-text'},events=[];
  const context=vm.createContext({report:{screenshots:{},files:{}},$:id=>({'song-parts-tools':parts,'song-parts-summary':summary,'song-complete-range-text':range})[id],assert:(value,message)=>assert.ok(value,message),native:async(kind,node)=>{
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
test('source-meter inspection uses existing visible controls before the explicit view-meter choice',async()=>{
 const source=await readFile(new URL('../crates/desktop-shell/basic-key-acceptance.js',import.meta.url),'utf8');
 assert.doesNotMatch(source,/score-key/);assert.match(source,/captureSourceMeterDisclosure\(false\);\n  await native\('select-second',\$\('engraving-page-size'\)\)/);
 const start=source.indexOf(' async function captureSourceMeterDisclosure('),end=source.indexOf(' async function notationInspection(',start);assert.ok(start>0&&end>start);
 const body=source.slice(start,end);
 for(const closeAfter of [false,true]){
  const events=[],tools={id:'notation-tools',open:false},summary={id:'notation-summary'},nodes={};tools.querySelector=()=>summary;
  for(const[id,text]of [['engraving-basic-provenance','MIDI 按键视图'],['engraving-basic-meter-label','来源拍号未确定时使用的显示拍号'],['engraving-basic-meter','使用来源拍号'],['engraving-status','来源没有明确的起始拍号'],['engraving-basic-controls','']])nodes[id]={id,textContent:text,value:id==='engraving-basic-meter'?'source':'',disabled:false,hidden:false,getBoundingClientRect:()=>({x:750,y:180,width:300,height:40}),getClientRects:()=>[{}],contains:()=>true};
  nodes['notation-tools']=tools;
  const context=vm.createContext({report:{screenshots:{}},$:id=>nodes[id],document:{elementFromPoint:()=>nodes['engraving-basic-provenance']},innerWidth:1280,innerHeight:720,getComputedStyle:()=>({display:'block',visibility:'visible'}),assert:(value,message)=>assert.ok(value,message),until:async(fn)=>assert.ok(fn()),native:async(kind,node)=>{assert.equal(kind,'click');events.push(node.id);if(node===summary)tools.open=!tools.open;else assert.equal(tools.open,true);return events.length;}});
  await vm.runInContext(body+`;captureSourceMeterDisclosure(${closeAfter});`,context);
  assert.deepEqual(events,['notation-summary','engraving-basic-provenance','engraving-status',...(closeAfter?['notation-summary']:[])]);assert.equal(tools.open,!closeAfter);
  assert.equal(context.report.sourceMeterDisclosure.choice.control.value,'source');assert.equal(context.report.sourceMeterDisclosure.status.visible,true);
 }
});
