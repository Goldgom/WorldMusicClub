import {addNativeProfileEvidence,assertNativeProfileEvidence} from './native-profile-evidence-fixtures.js';
// These synthetic unit fixtures exercise the production scheduler and transparent
// observation code, but use a simulated AudioContext and invented host reports.
// They are never evidence of a Windows run, native input, or physical audibility.
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile,mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {deflateSync} from 'node:zlib';
import {spawnSync} from 'node:child_process';
import {pitchBendAcceptanceFixtures,preparePitchBendFixtures} from '../scripts/prepare-pitch-bend-fixtures.mjs';
import {validatePitchBendRun,validatePitchBendRenderer,validatePitchBendInterruption,validatePitchPauseCutoff,validatePerformanceTakes,verifyNativePitchBendEvidence,PITCH_BEND_PHASES,PITCH_BEND_CHECKS,PITCH_BEND_REPORT_BYTES,PITCH_BEND_CLAIMS} from '../scripts/verify-native-pitch-bend-evidence.mjs';
import {createCleanPerformancePlayer} from '../web/clean-performance-player.js';
import {ReferenceAudioReceiver} from '../web/midi-reference-synth.js';
import {CompletePerformanceMixer} from '../web/clean-performance-controls.js';
import {storedZip} from './native-import-driver-fixtures.js';
import {digest} from './clean-song-package-fixtures.js';
const pack=pitchBendAcceptanceFixtures(),renderer=await readFile(new URL('../crates/desktop-shell/pitch-bend-acceptance.js',import.meta.url),'utf8');
const scope={structuredClone};vm.createContext(scope);vm.runInContext(renderer.split('(() => {')[0],scope);const observe=vm.runInContext('observePitchBendAudio',scope);
class Param{constructor(){this.value=0;}setValueAtTime(value){this.value=value;return this;}linearRampToValueAtTime(){return this;}}
class Node{constructor(context){this.context=context;this.gain=new Param();this.pan=new Param();this.frequency=new Param();this.Q=new Param();this.type='sine';}connect(node){assert.equal(node.context,this.context);return node;}disconnect(){this.context.cleanup?.();}start(){}stop(){this.context.cleanup?.();}}
class Audio{constructor(){this.currentTime=0;this.sampleRate=48000;this.state='running';}createGain(){return new Node(this);}createStereoPanner(){return new Node(this);}createOscillator(){return new Node(this);}createBufferSource(){const n=new Node(this);delete n.frequency;delete n.type;return n;}createBiquadFilter(){return new Node(this);}createConvolver(){return new Node(this);}createBuffer(channels,length){return{getChannelData:()=>new Float32Array(length)};}}
const copy=value=>JSON.parse(JSON.stringify(value)),cache=new Map();
async function simulatedRun(f,muted=null,interrupt=false) {
 const key=f.key+':'+muted+':'+interrupt;if(cache.has(key))return structuredClone(cache.get(key));
 const original=ReferenceAudioReceiver.prototype.schedule,probe=observe(ReferenceAudioReceiver,CompletePerformanceMixer,{AudioContext:Audio,performance}),context=new Audio(),output=context.createGain();
 let pending=new Map(),id=0;const timers={setTimeout:fn=>{pending.set(++id,fn);return id;},clearTimeout:id=>pending.delete(id)};
 const player=createCleanPerformancePlayer(f.reference,{contextFactory:()=>({context,output}),timers});
 const advance=until=>{while(context.currentTime<until){context.currentTime=Math.min(until,context.currentTime+.02);const callbacks=[...pending.values()];pending.clear();callbacks.forEach(fn=>fn());}};
 const snapshot=()=>copy(probe.snapshot());
 try{
  if(muted!==null)player.setTrackMuted(muted,true);
  await player.play({userGesture:true,acceptedPolicyId:f.reference.policy.id});advance(1.4);
  const liveCapture={before:snapshot()};advance(1.42);liveCapture.after=snapshot();
  if(interrupt==='navigation'){player.stop();const result=snapshot();cache.set(key,result);return structuredClone(result);}
  let interruption;
  if(interrupt){
   advance(interrupt==='lookahead'?3.96:3.1);interruption={playing:snapshot()};if(interrupt==='advancing-cleanup')context.cleanup=()=>{context.currentTime+=128/44100;};player.pause();delete context.cleanup;interruption.paused=snapshot();const pausedClock=interrupt==='lookahead'?'0:03.9 / 0:05.0':'0:03.0 / 0:05.0';interruption.pauseClock={before:pausedClock,after:pausedClock};
   advance(context.currentTime+.2);await player.play({userGesture:true,acceptedPolicyId:f.reference.policy.id});advance(context.currentTime+.1);interruption.resumed=snapshot();interruption.resumeClock=interrupt==='lookahead'?'0:03.9 / 0:05.0':'0:03.1 / 0:05.0';
  }
  advance(5.6);assert.equal(player.snapshot().state,'ended');
  if(interrupt){interruption.ended=snapshot();interruption.endClock='0:05.0 / 0:05.0';player.stop();interruption.stopped=snapshot();interruption.stopClock='0:00.0 / 0:05.0';}
  const result={mutedTracks:muted===null?[]:[muted],elapsedMs:5600,clock:'0:05.0 / 0:05.0',audio:snapshot(),liveCapture,...(interrupt?{interruption}:{})};cache.set(key,result);return structuredClone(result);
 }finally{probe.restore();assert.equal(ReferenceAudioReceiver.prototype.schedule,original);}
}
const empty=()=>({sourceStarts:0,oscillatorStarts:0,activeSources:0,pendingSources:0,sources:[],parameters:[],receiver:{schedules:[],retunes:[],silences:[]}});
// Disclosure text is the exact production DOM copy, not invented policy prose.
const uiSource=await readFile(new URL('../web/complete-performance-listening.js',import.meta.url),'utf8');
const disclosure=uiSource.match(/\$\('policy-pitch'\)\.textContent=text\('([^']*)','([^']*)'\)/);
assert.ok(disclosure);
const pitch=zh=>({hidden:false,text:disclosure[zh?2:1]});
const route=()=>({hidden:true,text:''});
function choice(f,accepted=false){return{preview:'performance',notation:'Notation unavailable · Practice targets and grades unavailable',policy:f.reference.policy.id,policyOpen:true,accepted,acceptDisabled:!f.reference.playable,policyLabel:'I select this reference sound and event playback policy',pitch:pitch(false),routing:route(),problems:{hidden:f.reference.playable,text:f.reference.playable?'':'unsupported_pitch_range'},playDisabled:!accepted||!f.reference.playable,listenDisabled:true,practiceDisabled:true,counts:{tracks:f.reference.trackCount,events:f.reference.eventCount,attacks:f.reference.voices.length},tracks:f.reference.tracks.map((t,index)=>({index,events:t.source_event_count,attacks:f.reference.voices.filter(v=>v.trackIndex===index).length,text:t.name,checked:false,disabled:!f.reference.playable||!t.independent})),audio:empty()};}
const chinese=()=>({coverage:'记谱不可用 · 练习目标与评分不可用',policy:'我选择此参考声音与事件播放策略',pitch:pitch(true),routing:route()});
async function report(phase='pitch-bend-seed'){
 const f=pack.fixtures.find(f=>f.name===(phase==='pitch-bend-seed'?'performance-pitch-default2-v2':'performance-pitch-proved12-v2')),blocked=pack.fixtures.find(f=>!f.reference.playable),full=await simulatedRun(f),interrupted=await simulatedRun(f,null,true),trusted=[];
 const r={version:1,phase,origin:'https://wmh.localhost',ok:true,stage:'complete',profileMarkerAbsent:true,checks:[...PITCH_BEND_CHECKS],errors:[],diagnostics:[{stage:'complete',elapsedMs:100}],inventory:pack.fixtures.map(f=>({key:f.key,library_format_version:2,revision:1,content_sha256:f.opened.clean_package.content_sha256,score_sha256:f.metadata.score.sha256,score_bytes:f.files.get('score.json').length,score_id:f.metadata.id,title:f.metadata.title,retained_source:null,clean_package:f.summary})),opened:pack.fixtures.map(f=>({key:f.key,...f.opened})),variants:[{key:f.key,beforeChoice:choice(f),afterChoice:choice(f,true),reloadChoice:choice(f),chineseChoice:chinese(),runs:[full,await simulatedRun(f,1)],liveCapture:full.liveCapture,referenceInput:{policyOpenBefore:true,policyOpenAfter:false,policyOpenRestored:true,focusedIdAfter:'complete-performance-policy-title',keyAction:23,reopenAction:24},interruption:interrupted.interruption,navigationAudio:await simulatedRun(f,null,'navigation')}],blocked:[{key:blocked.key,beforeChoice:choice(blocked),afterChoice:choice(blocked),chineseChoice:chinese()}],beforeTakeState:{captured:'1'},afterTakeState:{captured:'1'},requests:[],referenceRequestStart:0,imports:[],trusted,pickerObservations:[],responseObservations:[],actions:phase==='pitch-bend-seed'?40:33,files:{beforeTake:`${phase}-1.json`,afterTake:`${phase}-2.json`},transportAdmission:transport(),screenshots:{choice:12,playing:15,bounds:29}};
 const humanStart=phase==='pitch-bend-seed'?4:0;r.baselineScope={humanActionStart:humanStart,humanActionEnd:humanStart+3,readyAfterAction:humanStart+4};r.originalScoreSetup={kind:'scripted-menu',controls:['sound-button','start-listen'],previewId:'original-catalog-score',title:'Original catalog score'};
 for(const id of ['stage-title','complete-performance-policy-title'])for(const type of ['keydown','keyup'])trusted.push({trusted:true,id,type,code:'KeyR'});
 for(let count=0;count<2;count++)trusted.push({trusted:true,id:'complete-performance-policy-title',type:'click'});
 for(const checked of [true,false])trusted.push({trusted:true,id:'complete-performance-mute-1',type:'change',checked});trusted.push({trusted:true,id:'complete-performance-policy-accept',type:'change',checked:true});
 if(phase==='pitch-bend-seed'){
  const initial={screen:'library',previewId:r.originalScoreSetup.previewId,previewStatus:'ready',previewTitle:r.originalScoreSetup.title,stageTitle:'Your stage',resumeHidden:true,playDisabled:true,resultsDisabled:true,captured:'0',pass:'',revision:''};r.requests=[{path:'/api/library/import/preview'},{path:'/api/library/import/commit'}];r.referenceRequestStart=2;r.importSetup={before:initial,after:structuredClone(initial),actionStart:0,actionEnd:4,requestStart:0,requestEnd:2,audio:empty()};
  r.checks.push('chooser-preflight-all-songs-all-tracks-save','exact-complete-pack-export');r.imports=['preview','commit'].map((mode,i)=>({path:`/api/library/import/${mode}`,status:200,body:{source:{sha256:pack.manifest.sha256,bytes:pack.bytes.length,retained:i===1},items:pack.fixtures.map(f=>({status:i===0?'ready':'saved',playable:false,clean_package:f.summary}))}}));r.preflight=pack.fixtures.map(f=>({status:'ready',playable:false,coverage:f.score.coverage}));r.responseObservations=r.imports.map(row=>({path:row.path,status:200,state:'consumed'}));r.pickerObservations=[{sequence:1,filename:pack.filename,completed:true,gestures:gestures(),delegatedClicks:[{type:'click',trusted:false,id:'score-file',sequence:1}],changes:[{type:'change',trusted:true,id:'score-file',sequence:1,filename:pack.filename}]}];trusted.push({type:'change',trusted:true,id:'score-file',pickerSequence:1});r.files.package=`${phase}-3.zip`;r.screenshots.preflight=2;
 }else r.checks.push('fresh-process-rpn12-pitch-reconstruction');
 r.downloads=Object.values(r.files).map(file=>({file,complete:true,success:true}));return r;
}
function gestures(){const base={button:0,buttons:0,defaultPrevented:false,activation:{isActive:true,hasBeenActive:true},focus:{hasFocus:true,activeId:'import-button',visibility:'visible'},trigger:{id:'import-button',tag:'BUTTON',type:'submit',disabled:false,connected:true,inert:false},input:{id:'score-file',tag:'INPUT',type:'file',disabled:false,connected:true,inert:false,multiple:true},dialog:{id:'import-tools-dialog',open:true,modal:true}};return[['before-action',null,null],['pointerdown','import-button',true],['pointerup','import-button',true],['click','import-button',true],['click','score-file',false],['change','score-file',true]].map(([type,targetId,trusted])=>({...structuredClone(base),observedAtMs:1050,eventTimeMs:type==='before-action'?null:50,type,targetId,trusted}));}
function transport(){const state={passId:'1',captured:'1',cue:'paused',phase:'paused',hidden:false,openDialogs:[],positionMs:500,durationMs:32000};return{version:1,stage:'complete',omitted:0,rowBytes:1000,trustedPlayClicks:2,trustedKeyDowns:1,trustedKeyUps:1,current:state,rows:[{kind:'ready',state:{...state,positionMs:0,captured:'0'}},{kind:'transport',state:{...state,phase:'capturing',positionMs:200}},...['keydown','keyup'].map(type=>({kind:'event',state,event:{type,trusted:true,code:'KeyR',surface:'stage-title',repeat:false}}))]};}
function take(){const input={midi:60,velocity:90,at_ms:100};return{version:1,score_id:'original-authored-practice',practice_part:null,passes:[{id:1,capture_enabled:true,inputs:[input],captures:[{event_id:1,event_wall_ms:1100,received_wall_ms:1101,input}],assessment:null,timeline:{notes:[{id:'authored-note',midi:60,start_ms:0,duration_ms:1000}]}}],input_evidence:{version:1,truncated:false,omitted_observations:0,events:[{event_id:1,kind:'note_on',input_kind:'typing_keyboard',encoding:'key_down',midi:60,velocity:90,event_wall_ms:1100,received_wall_ms:1101,onset_capture:{pass_id:1,event_id:1}}]}};}
function png(){const crc=b=>{let c=0xffffffff;for(const v of b){c^=v;for(let i=0;i<8;i++)c=c>>>1^((c&1)?0xedb88320:0);}return(c^0xffffffff)>>>0;},chunk=(name,data)=>{const b=Buffer.alloc(data.length+12);b.writeUInt32BE(data.length);b.write(name,4);data.copy(b,8);b.writeUInt32BE(crc(b.subarray(4,-4)),b.length-4);return b;};const header=Buffer.alloc(13);header.writeUInt32BE(640);header.writeUInt32BE(360,4);header[8]=8;header[9]=2;const pixels=Buffer.alloc(1921*360);let value=17;for(let i=0;i<pixels.length;i++){value=(Math.imul(value,1664525)+1013904223)>>>0;pixels[i]=i%1921?value>>>24:0;}return Buffer.concat([Buffer.from('89504e470d0a1a0a','hex'),chunk('IHDR',header),chunk('IDAT',deflateSync(pixels)),chunk('IEND',Buffer.alloc(0))]);}
async function syntheticEvidence(t){const directory=await mkdtemp(join(tmpdir(),'wmh-performance-verifier-unit-'));t.after(()=>rm(directory,{recursive:true,force:true}));await preparePitchBendFixtures(join(directory,'fixtures'));await mkdir(join(directory,'downloads'));const save=async(name,value)=>writeFile(join(directory,name),JSON.stringify(value)),image=png(),reports={};const native={version:1,scenario:'pitch-bend',ok:true,profile_reused:false,source_sha:'1'.repeat(40),source_tree:'2'.repeat(40),executable_sha256:'3'.repeat(64),executable_bytes:80000,os:'Microsoft Windows test fixture',directory:join(directory,'Scores'),phases:[]};
 for(const [index,phase]of PITCH_BEND_PHASES.entries()){const r=await report(phase);r.directory=native.directory;reports[phase]=r;for(const kind of ['beforeTake','afterTake'])await save(`downloads/${r.files[kind]}`,take());if(r.files.package){const entries=pack.fixtures.flatMap(f=>[...f.files].map(([name,b])=>[`songs/${f.key}/${name}`,b]));entries.push(['manifest.json',JSON.stringify({format:'worldmusichub-song-pack',version:2,songs:pack.fixtures.map(f=>({folder:`songs/${f.key}`}))})]);await writeFile(join(directory,'downloads',r.files.package),storedZip(entries));}
 const host={phase,process_id:100+index,renderer_ok:true,normal_close:true,launched_new_process:true,profile_fresh:true,profile_reused:false,executable_tcp_listeners:0,renderer_origin:'https://wmh.localhost',actions:r.actions};native.phases.push(host);const referenceKeyAction=r.variants[0].referenceInput.keyAction;
 for(let n=1;n<=r.actions;n++){const kind=n===1&&index===0?'picker':n===r.baselineScope.humanActionStart+2||n===referenceKeyAction?'key-r':'click';await save(`action-${phase}-${n}.json`,{version:1,sequence:n,kind,x:10,y:20,width:1280,height:720,...(kind==='picker'?{file:pack.filename}:{})});await save(`result-${phase}-${n}.json`,{ok:true,client_click:{app_hwnd:1,foreground:1,actual:[10,20],requested:[10,20],viewport:[1280,720],hit_hwnd:1},...(kind==='picker'?{owned_dialog:{class:'#32770',hwnd:2,process_id:host.process_id,app_process_id:host.process_id,app_hwnd:1,root_owner_hwnd:1},picker_completion:{dialog_dismissed:true,app_enabled:true,owned_popup_visible:false}}:{})});}
 for(const n of Object.values(r.screenshots))await writeFile(join(directory,`native-action-${phase}-${n}.png`),image);await writeFile(join(directory,`native-${phase}.png`),image);await save(`renderer-${phase}.json`,r);}
 const rows=[],archive=async(path,b)=>{await mkdir(join(directory,'Scores',path.slice(0,path.lastIndexOf('/'))),{recursive:true});await writeFile(join(directory,'Scores',path),b);rows.push({path,bytes:b.length,sha256:digest(b)});};for(const area of ['clean-songs','clean-backups'])for(const f of pack.fixtures){await archive(`${area}/${f.key}/entry.json`,Buffer.from(JSON.stringify(reports[PITCH_BEND_PHASES[0]].inventory.find(e=>e.key===f.key))));for(const [name,b]of f.files)await archive(`${area}/${f.key}/package/${name}`,b);}for(const area of ['imports','import-backups'])await archive(`${area}/pack-${pack.manifest.sha256}/source.bin`,pack.bytes);for(const phase of PITCH_BEND_PHASES)await save(`snapshot-${phase}.json`,{version:1,files:rows});await addNativeProfileEvidence(native,save);await save('native-pitch-bend.json',native);return{directory,native,reports,save};}

test('synthetic production scheduler observes every original bend at exact native-derived clocks for both ranges',async()=>{
 for(const f of pack.fixtures.filter(f=>f.reference.playable)){
  assert.equal(f.reference.durationSeconds,5.00001);
  for(const muted of [null,1])validatePitchBendRun(await simulatedRun(f,muted),f);
  validatePitchBendInterruption((await simulatedRun(f,null,true)).interruption,f);
  const pendingFuture=(await simulatedRun(f,null,'lookahead')).interruption;validatePitchBendInterruption(pendingFuture,f);assert.ok(pendingFuture.paused.receiver.retunes.at(-1).at>pendingFuture.paused.receiver.silences[0].currentTime);assert.notEqual(pendingFuture.resumed.receiver.schedules[3].pitchSemitones,0,'Already-scheduled future center cannot leak into restored voice');
 }
});
test('pause cuts the real common output first while successive native cleanup calls advance four or more audio quanta',async()=>{
 for(const f of pack.fixtures.filter(f=>f.reference.playable)){
  const value=(await simulatedRun(f,null,'advancing-cleanup')).interruption;
  validatePitchBendInterruption(value,f);
  const audio=value.paused,cutoff=audio.cutoffs[0],master=audio.nodes.find(node=>node.id===cutoff.masterNodeId),cut=master.disconnects[0],silence=audio.receiver.silences[0];
  assert.ok(cut.completedTime-cutoff.currentTime<.01);
  assert.ok(Math.max(...audio.sources.map(source=>source.stops.at(-1)-silence.currentTime))>.01,'Regression must exceed the old changing-clock argument comparison');
  assert.ok(audio.sources.every(source=>source.stopCalls.at(-1).operation>cut.operation));
  assert.ok(silence.completedTime-cutoff.currentTime>.01,'The observed cleanup window must remain honest after output cutoff');
 }
});
test('pause evidence rejects wrong output, bypass routes, missing/duplicate cut, reconnection, late cutoff and incomplete or future source cancellation',async()=>{
 const f=pack.fixtures[1],good=(await simulatedRun(f,null,'advancing-cleanup')).interruption;
 const edits=[
  r=>{for(const name of ['playing','paused','resumed','ended','stopped'])for(const source of r[name].sources)source.nodeId=r[name].sources[0].nodeId;},
  r=>{const id=r.playing.receiver.schedules[0].outputNodeId;for(const name of ['paused','resumed','ended','stopped'])r[name].nodes.find(node=>node.id===id).disconnected=false;},
  r=>r.paused.sources[0].nodeId=r.paused.sources[1].nodeId,
  r=>r.paused.cutoffs[0].masterNodeId=r.paused.sources[0].nodeId,
  r=>r.paused.cutoffs[0].outputNodeId=r.paused.sources[0].nodeId,
  r=>{const a=r.paused,node=a.nodes.find(n=>n.id===a.sources[0].nodeId);node.connections[0].destination=a.cutoffs[0].outputNodeId;},
  r=>{const a=r.paused,node=a.nodes.find(n=>n.id===a.cutoffs[0].masterNodeId);node.disconnects=[];},
  r=>{const a=r.paused,node=a.nodes.find(n=>n.id===a.cutoffs[0].masterNodeId);node.disconnects.push({...node.disconnects[0]});},
  r=>{const a=r.paused,node=a.nodes.find(n=>n.id===a.cutoffs[0].masterNodeId);node.connections.push({...node.connections[0],operation:999});},
  r=>{const a=r.paused,node=a.nodes.find(n=>n.id===a.cutoffs[0].masterNodeId);node.disconnects[0].completedTime=a.cutoffs[0].currentTime+.011;},
  r=>{const a=r.paused,source=a.sources[0];source.stopCalls.pop();source.stops.pop();},
  r=>{const a=r.paused,source=a.sources[0];source.stopCalls.at(-1).when+=1;source.stops[source.stops.length-1]+=1;},
  r=>r.paused.sources[0].stopCalls.at(-1).silenceSequence+=1,
  r=>r.paused.sources[0].stopCalls.at(-1).success=false,
  r=>{const a=r.paused,node=a.nodes.find(n=>n.id===a.sources[0].nodeId);node.disconnected=false;},
  r=>r.paused.receiver.silences[0].completedMs=r.paused.cutoffs[0].elapsedMs+5000,
 ];
 for(const edit of edits){const bad=structuredClone(good);edit(bad);assert.throws(()=>validatePitchBendInterruption(bad,f));}
 const late=structuredClone(good.paused);late.cutoffs[0].currentTime-=.011;
 assert.throws(()=>validatePitchPauseCutoff(good.playing,late),/unchanged 10 ms/);
 const reconnect=structuredClone(good.paused),lane=reconnect.nodes.find(node=>node.id===good.playing.receiver.schedules[0].outputNodeId);
 const operations=reconnect.nodes.flatMap(node=>[...node.connections,...node.disconnects]).concat(reconnect.sources.flatMap(source=>source.stopCalls));
 lane.connections.push({...lane.connections[0],operation:Math.max(...operations.map(call=>call.operation))+1,currentTime:reconnect.receiver.silences[0].completedTime,completedTime:reconnect.receiver.silences[0].completedTime});
 assert.throws(()=>validatePitchPauseCutoff(good.playing,reconnect),/reconnected after cutoff/);
 const bypass=structuredClone(good.paused),sourceNode=bypass.nodes.find(node=>node.id===good.playing.sources[0].nodeId);
 sourceNode.connections.push({...sourceNode.connections[0],destination:bypass.cutoffs[0].masterNodeId});
 assert.throws(()=>validatePitchPauseCutoff(good.playing,bypass),/scheduled channel output/);
});
test('actual dry and wet output routes share the cut master and a wet bypass is rejected',()=>{
 const probe=observe(ReferenceAudioReceiver,CompletePerformanceMixer,{AudioContext:Audio,performance}),context=new Audio(),output=context.createGain();
 try{
  const mixer=new CompletePerformanceMixer(context,output,{reverbChannels:[0],end:10}),receiver=new ReferenceAudioReceiver(context,output,{maxVoices:128,ErrorType:Error});
  mixer.command({kind:'reverb_send',channel:0,value:127},.05);
  receiver.schedule({eventId:'authored-wet-route',channel:0,key:60,program:0,velocity:90},.05,10,{output:mixer.outputFor(0,.05),strictPitchRange:true});context.currentTime=1;
  const before=copy(probe.snapshot());mixer.close();receiver.silence();const after=copy(probe.snapshot());validatePitchPauseCutoff(before,after);
  const convolver=after.nodes.find(node=>node.kind==='createConvolver');assert.ok(convolver);
  const wet=after.nodes.find(node=>node.id===convolver.connections[0].destination);wet.connections[0].destination=after.cutoffs[0].outputNodeId;
  assert.throws(()=>validatePitchPauseCutoff(before,after),/bypassed/);
 }finally{probe.restore();}
});
test('actual oscillator observations reject frequency, raw scaling, source clock, duplicate loss, waveform and mute mutation',async()=>{
 const f=pack.fixtures[0],good=await simulatedRun(f);
 const edits=[r=>r.audio.sources[0].frequencies[1].value+=1,r=>r.audio.sources[0].frequencies[1].at+=.0000005,r=>r.audio.receiver.retunes[0].at+=.0000005,r=>r.audio.sources[0].frequencies[1].value*=2**((2/8192)/12),r=>r.audio.sources[0].frequencies[1].at+=.001,r=>r.audio.sources[0].frequencies.splice(7,1),r=>r.audio.receiver.retunes[0].semitones=2,r=>r.audio.receiver.retunes[0].at+=.01,r=>r.audio.sources[0].wave='square',r=>r.audio.sources[0].stops[0]-=.1,r=>r.audio.sources[0].disconnected=false,r=>r.audio.receiver.schedules[0].key=61,r=>r.mutedTracks=[1],r=>r.elapsedMs=5000,r=>r.audio.receiver.schedules[0].strictPitchRange=false,r=>r.audio.receiver.retunes[0].success=false];
 for(const edit of edits){const bad=structuredClone(good);edit(bad);assert.throws(()=>validatePitchBendRun(bad,f));}
});
test('resume reconstruction rejects future leakage, wrong held layer, changed pause position and incomplete cleanup',async()=>{
 const f=pack.fixtures[1],good=(await simulatedRun(f,null,true)).interruption;
 for(const edit of [r=>r.resumed.receiver.schedules[3].pitchSemitones=0,r=>r.resumed.sources[6].frequencies[0].value*=2,r=>r.resumed.receiver.schedules[3].start+=.1,r=>r.resumed.receiver.schedules[3].eventId='fabricated',r=>r.paused.receiver.silences[0].currentTime+=.1,r=>r.pauseClock.after='0:03.2 / 0:05.0',r=>r.ended.receiver.retunes.pop(),r=>r.stopped.sources[0].disconnected=false,r=>r.stopClock='0:05.0 / 0:05.0']){const bad=structuredClone(good);edit(bad);assert.throws(()=>validatePitchBendInterruption(bad,f));}
});
test('both renderer phases enforce exact source, phase selection, bilingual policy, before-audio bounds and unchanged human take',async()=>{
 for(const phase of PITCH_BEND_PHASES){const r=await report(phase);validatePitchBendRenderer(r);assert.ok(Buffer.byteLength(JSON.stringify(r))<PITCH_BEND_REPORT_BYTES);assert.ok(r.actions<=64);}
 const good=await report();
 const honestCleanup=structuredClone(good);for(const state of [honestCleanup.variants[0].reloadChoice,honestCleanup.blocked[0].beforeChoice,honestCleanup.blocked[0].afterChoice])state.audio.receiver.silences=[{sequence:1,currentTime:20,success:true}];validatePitchBendRenderer(honestCleanup);
 for(const edit of [r=>r.variants[0].key=pack.fixtures[1].key,r=>r.opened[0].clean_package.score_json+=' ',r=>r.inventory.pop(),r=>r.variants[0].runs.pop(),r=>r.variants[0].beforeChoice.accepted=true,r=>r.variants[0].beforeChoice.pitch.hidden=true,r=>r.variants[0].chineseChoice.pitch.text='弯音参考',r=>r.variants[0].beforeChoice.pitch.text=r.variants[0].beforeChoice.pitch.text.replace('not proof','proof'),r=>r.blocked=[],r=>r.blocked[0].afterChoice.acceptDisabled=false,r=>r.blocked[0].beforeChoice.problems.text='unsupported_bank_select',r=>r.blocked[0].afterChoice.audio.sourceStarts=1,r=>r.trusted[0].trusted=false,r=>r.checks.pop(),r=>r.beforeTakeState.captured='0',r=>r.baselineScope.humanActionStart=0,r=>r.importSetup.after.previewId='native:wrong',r=>r.pickerObservations[0].gestures[3].activation.isActive=false,r=>r.requests.push({path:'/api/library/fingering/piano'})]){const bad=structuredClone(good);edit(bad);assert.throws(()=>validatePitchBendRenderer(bad));}
 const before=take();validatePerformanceTakes(before,structuredClone(before),good,pack);
 for(const edit of [t=>t.score_id=pack.fixtures[0].score.id,t=>t.passes[0].assessment={score:100},t=>t.input_evidence.events[0].midi=62,t=>t.passes[0].inputs.push({midi:64,velocity:90,at_ms:200})]){const after=structuredClone(before);edit(after);assert.throws(()=>validatePerformanceTakes(before,after,good,pack));}
});
test('synthetic Windows-shaped evidence rechecks owned picker, exact storage/export and two fresh processes without claiming a real run',async t=>{
 const e=await syntheticEvidence(t),proof=await verifyNativePitchBendEvidence(e.directory);assert.deepEqual(proof.claims,PITCH_BEND_CLAIMS);assert.equal(proof.claims.actual_audibility,false);assert.equal(proof.claims.full_checkpoint_acceptance,false);assert.equal(proof.claims.release_ready,false);
 for(const edit of [n=>n.phases[1].process_id=n.phases[0].process_id,n=>n.phases[0].profile_fresh=false,n=>n.os='Linux synthetic']){const bad=structuredClone(e.native);edit(bad);await e.save('native-pitch-bend.json',bad);await assert.rejects(verifyNativePitchBendEvidence(e.directory));}await e.save('native-pitch-bend.json',e.native);
 const picker='result-pitch-bend-seed-1.json',good=JSON.parse(await readFile(join(e.directory,picker)));await e.save(picker,{...good,owned_dialog:{...good.owned_dialog,process_id:999}});await assert.rejects(verifyNativePitchBendEvidence(e.directory));await e.save(picker,good);
 const phase=PITCH_BEND_PHASES[0],badInput=structuredClone(e.reports[phase]);badInput.variants[0].referenceInput.keyAction=24;badInput.variants[0].referenceInput.reopenAction=25;validatePitchBendRenderer(badInput);await e.save(`renderer-${phase}.json`,badInput);await assert.rejects(verifyNativePitchBendEvidence(e.directory),'The renderer input sequence must name the actual OS key action');await e.save(`renderer-${phase}.json`,e.reports[phase]);
 const f=pack.fixtures[0],path=`Scores/clean-songs/${f.key}/package/score.json`,bytes=await readFile(join(e.directory,path));await writeFile(join(e.directory,path),Buffer.concat([bytes,Buffer.from(' ')]));await assert.rejects(verifyNativePitchBendEvidence(e.directory));await writeFile(join(e.directory,path),bytes);
 await writeFile(join(e.directory,`Scores/clean-songs/${f.key}/package/runtime.json`),'{}');await assert.rejects(verifyNativePitchBendEvidence(e.directory));
});

test('pitch key proof rejects body targets, extra or incomplete pairs and a policy left collapsed',async()=>{
 for(const phase of PITCH_BEND_PHASES){
  const good=await report(phase);validatePitchBendRenderer(good);
  const pair=r=>r.trusted.filter(row=>row.id==='complete-performance-policy-title'&&row.code==='KeyR');
  const changes=[r=>{for(const row of pair(r))row.id=null;},r=>{for(const row of pair(r))row.id='complete-performance-title';},r=>{pair(r)[0].trusted=false;},r=>{pair(r)[0].code='KeyE';},r=>r.trusted.splice(r.trusted.indexOf(pair(r)[1]),1),r=>r.trusted.push(structuredClone(pair(r)[0])),r=>r.trusted.push({trusted:true,id:null,type:'keydown',code:'KeyR'}),r=>r.variants[0].referenceInput.policyOpenBefore=false,r=>r.variants[0].referenceInput.policyOpenAfter=true,r=>r.variants[0].referenceInput.policyOpenRestored=false,r=>r.variants[0].referenceInput.focusedIdAfter=null,r=>r.variants[0].referenceInput.reopenAction++,r=>r.variants[0].reloadChoice.policyOpen=false,r=>r.blocked[0].beforeChoice.policyOpen=false];
  for(const change of changes){const bad=structuredClone(good);change(bad);assert.throws(()=>validatePitchBendRenderer(bad));}
  const missingClick=structuredClone(good);missingClick.trusted.splice(missingClick.trusted.findIndex(row=>row.id==='complete-performance-policy-title'&&row.type==='click'),1);assert.throws(()=>validatePitchBendRenderer(missingClick));
 }
});
test('standalone Python source/EXE verifier accepts exact Node claims and rejects additions, omissions, loose booleans and byte changes',async t=>{
 const e=await syntheticEvidence(t),executable=join(e.directory,'synthetic-executable.bin'),bytes=Buffer.from('Synthetic contract bytes: not an executable');await writeFile(executable,bytes);e.native.executable_sha256=digest(bytes);e.native.executable_bytes=bytes.length;await e.save('native-pitch-bend.json',e.native);
 const proof=await verifyNativePitchBendEvidence(e.directory);await e.save('native-pitch-bend-files.json',proof);
 const run=()=>spawnSync(process.platform==='win32'?'python':'python3',['scripts/native-pitch-bend-manifest.py',e.directory,'--executable',executable,'--commit',e.native.source_sha,'--tree',e.native.source_tree],{cwd:new URL('../',import.meta.url),encoding:'utf8',timeout:45000});
 const good=run();assert.ifError(good.error);assert.equal(good.status,0,good.stderr);const manifest=JSON.parse(good.stdout);assert.equal(manifest.native_pitch_bend_validated,true);assert.deepEqual(manifest.native_pitch_bend_claims,proof.claims);assert.deepEqual(JSON.parse(await readFile(join(e.directory,'pitch-bend-manifest.json'))),manifest);
 assert.deepEqual(Object.keys(manifest.native_pitch_bend_reports_sha256).sort(),['native-pitch-bend.json',...PITCH_BEND_PHASES.flatMap(phase=>[`renderer-${phase}.json`,`profile-${phase}.json`])].sort());
 for(const edit of [p=>p.claims.extra=true,p=>delete p.claims.raw_14bit_source_clock_pitch_events,p=>p.claims.actual_audibility=true,p=>p.claims.native_file_picker=1,p=>p.source_tree='4'.repeat(40),p=>p.executable_bytes++]){const bad=structuredClone(proof);edit(bad);await e.save('native-pitch-bend-files.json',bad);const result=run();assert.equal(result.status,1);assert.match(result.stderr,/ValueError/);}await e.save('native-pitch-bend-files.json',proof);
 await writeFile(executable,Buffer.concat([bytes,Buffer.from('changed')]));assert.equal(run().status,1);
});

test('final release gate independently consumes real Node pitch proof and keeps focused scope under its feature prefix',async t=>{
 // Every file is synthetic. The real Node proof and both Python consumers run;
 // no verifier is mocked and no Windows program, GUI or browser is launched.
 const e=await syntheticEvidence(t),executable=join(e.directory,'synthetic-executable.bin'),bytes=Buffer.from('Original synthetic final-gate bytes; not an executable');
 await writeFile(executable,bytes);e.native.executable_sha256=digest(bytes);e.native.executable_bytes=bytes.length;await e.save('native-pitch-bend.json',e.native);
 const proof=await verifyNativePitchBendEvidence(e.directory);await e.save('native-pitch-bend-files.json',proof);
 const python=process.platform==='win32'?'python':'python3',options={cwd:new URL('../',import.meta.url),encoding:'utf8',timeout:45000};
 const prepared=spawnSync(python,['scripts/native-pitch-bend-manifest.py',e.directory,'--executable',executable,'--commit',e.native.source_sha,'--tree',e.native.source_tree],options);assert.ifError(prepared.error);assert.equal(prepared.status,0,prepared.stderr);
 const manifest=JSON.parse(prepared.stdout),script=`import importlib.util,json,sys\nfrom pathlib import Path\nspec=importlib.util.spec_from_file_location('native_release',Path('scripts/native-release-manifest.py'))\nmodule=importlib.util.module_from_spec(spec)\nspec.loader.exec_module(module)\ndirectory,executable,commit,tree=sys.argv[1:]\naccepted=module.accepted_pitch_bend_evidence(directory,executable,commit,tree)\nmodule.verify_pitch_bend_inventory(['evidence/'+name for name in module.PITCH_BEND_EVIDENCE])\nread=lambda name:Path(executable).read_bytes() if name==module.EXE else (Path(directory)/Path(name).name).read_bytes()\nmodule.verify_packaged_pitch_bend_evidence(read,{'git_commit':commit,'git_tree':tree,'acceptance':accepted})\nprint(json.dumps(accepted))\n`;
 const run=()=>spawnSync(python,['-c',script,e.directory,executable,e.native.source_sha,e.native.source_tree],options);
 const good=run();assert.ifError(good.error);assert.equal(good.status,0,good.stderr);const accepted=JSON.parse(good.stdout);
 assert.ok(Object.keys(accepted).every(key=>key.startsWith('native_pitch_bend_')));assert.equal(accepted.native_pitch_bend_validated,true);assert.deepEqual(accepted.native_pitch_bend_claims,PITCH_BEND_CLAIMS);
 assert.equal(accepted.native_pitch_bend_scope,'original-pitch-bend-focused-evidence-only');assert.equal(accepted.native_pitch_bend_full_checkpoint_acceptance,false);assert.equal(accepted.native_pitch_bend_release_ready,false);
 assert.equal(accepted.native_pitch_bend_manifest_sha256,digest(await readFile(join(e.directory,'pitch-bend-manifest.json'))));
 for(const edit of [m=>m.release_ready=true,m=>m.release_ready=0,m=>m.native_pitch_bend_claims.actual_audibility=true,m=>m.native_pitch_bend_claims.extra=true,m=>delete m.native_pitch_bend_claims.default2_and_proved12_ranges,m=>m.source_tree='4'.repeat(40)]){const bad=structuredClone(manifest);edit(bad);await e.save('pitch-bend-manifest.json',bad);const result=run();assert.equal(result.status,1);assert.match(result.stderr,/ValueError/);}
 await e.save('pitch-bend-manifest.json',manifest);await writeFile(executable,Buffer.concat([bytes,Buffer.from('changed')]));assert.equal(run().status,1);
});

test('pitch-bend requires distinct phase profiles and matching fresh host records in the hashed proof',async t=>{
 const f=await syntheticEvidence(t);await assertNativeProfileEvidence({directory:f.directory,native:f.native,save:f.save,verify:verifyNativePitchBendEvidence,nativeFile:'native-pitch-bend.json'});
});
