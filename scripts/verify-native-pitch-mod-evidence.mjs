// Verify retained output of the actual Windows processes. Pure tests establish
// rejection behavior only, never the success of a native run.
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {lstat, readFile, writeFile} from 'node:fs/promises';
import {join, resolve} from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {isDeepStrictEqual} from 'node:util';
import {CANONICAL_PRACTICE_SOURCE_FILES} from './canonical-practice-source-evidence.mjs';
import {buildDiagnosticsExecutableBinding, canonicalWindowsExecutablePath} from './build-diagnostics-evidence.mjs';
import {passivePngPixels} from './native-passive-capture-evidence.mjs';
import {validateOwnedPickerGestures} from './verify-native-vsq-song-evidence.mjs';
import {PITCH_MOD_NATIVE_PHASES, PITCH_MOD_NATIVE_FIXTURE, nativePitchModFixture} from './native-pitch-mod-fixtures.mjs';
import {pitchConfig, assertC4Projection, assertPitchMachineAudio} from '../tests/pitch-mod-browser-proof.js';

const rootDefault=fileURLToPath(new URL('../',import.meta.url)),hash=bytes=>createHash('sha256').update(bytes).digest('hex'),positive=value=>Number.isSafeInteger(value)&&value>0;
const parse=bytes=>JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes).replace(/^\uFEFF/,''));
export const NATIVE_PITCH_MOD_CLAIMS=Object.freeze({native_window:true,canonical_projection:true,trusted_keyboard_mapping:true,literal_d4_keyboard:true,machine_d4_audio_ledger_pcm:true,check_does_not_play:true,saved_mod_process_restart:true,original_source_export:true,physical_audio:false,physical_midi:false,basic_native_runtime:false,vsq_native_runtime:false,full_acceptance:false,release_ready:false});
export const PITCH_MOD_SOURCE_FILES=Object.freeze([...new Set([...CANONICAL_PRACTICE_SOURCE_FILES,
 'crates/score-core/src/pitch_projection.rs','crates/score-core/src/pitch_projection/tests.rs','crates/score-core/src/source_identity.rs','crates/score-core/src/source_identity/eligibility.rs','crates/score-core/src/source_identity/tests.rs','crates/score-core/src/practice_source.rs',
 'crates/practice-server/src/pitch_mod_api.rs','crates/practice-server/tests/pitch_mod_api.rs',
 'crates/desktop-shell/src/native_pitch_mod.rs','crates/desktop-shell/tests/native_pitch_mod.rs','crates/desktop-shell/tests/support/pitch_mod_fixture.rs',
 'web/pitch-mod.js','web/pitch-mod-view.js','web/pitch-mod-context.js','web/basic-practice-admission.js','web/source-practice-eligibility.js','web/app-assistance.js',
 '.github/workflows/native-pitch-mod.yml','scripts/native-pitch-mod-fixtures.mjs','scripts/native-pitch-mod-input.cs',
 'scripts/native-pitch-mod-renderer.js','scripts/verify-native-pitch-mod-evidence.mjs','scripts/native-pitch-mod-contract.ps1',
 'tests/pitch-mod-browser-proof.js','tests/fixtures/pitch-mod-original-c4.json','tests/native-pitch-mod-evidence.test.js',
])].sort());
export async function pitchModSourceBinding(root=rootDefault){
 const git=(...args)=>execFileSync('git',args,{cwd:root,encoding:'utf8',maxBuffer:4*1024*1024}).trim();
 const source_sha=git('rev-parse','HEAD'),source_tree=git('rev-parse','HEAD^{tree}'),source_hashes={};
 assert.equal(git('status','--porcelain','--untracked-files=normal'),'','Pitch source must be clean and frozen');assert.ok(PITCH_MOD_SOURCE_FILES.length<320);
 for(const name of PITCH_MOD_SOURCE_FILES){let path=root;for(const part of name.split('/')){path=join(path,part);assert.equal((await lstat(path)).isSymbolicLink(),false);}const stat=await lstat(path);assert.ok(stat.isFile()&&stat.size>0&&stat.size<=4*1024*1024);const bytes=await readFile(path);assert.deepEqual(bytes,execFileSync('git',['show',`${source_sha}:${name}`],{cwd:root,maxBuffer:4*1024*1024}));source_hashes[name]=hash(bytes);}
 return{source_sha,source_tree,source_hashes};
}

export function validateNativePitchActions(report,host,actions,results){
 assert.ok(PITCH_MOD_NATIVE_PHASES.includes(report.phase));assert.ok(positive(report.actions)&&report.actions<=64);assert.equal(host.actions,report.actions);assert.equal(actions.length,report.actions);assert.equal(results.length,report.actions);
 const controls=new Map(report.controls.map(control=>[control.sequence,control]));assert.equal(controls.size,report.controls.length);let hwnd;
 for(const[index,action]of actions.entries()){
  const sequence=index+1,result=results[index],control=controls.get(sequence);assert.equal(action.version,1);assert.equal(action.sequence,sequence);assert.equal(result.ok,true,result.error);
  assert.deepEqual(Object.keys(action).sort(),['version','sequence','kind','x','y','width','height',...(action.kind==='picker'?['file']:[])].sort());
  for(const key of ['x','y','width','height'])assert.ok(Number.isFinite(action[key])&&action[key]>0&&action[key]<20000);assert.ok(action.x<action.width&&action.y<action.height);
  if(action.kind==='pitch-mod-key-s'){
   assert.equal(report.phase,'pitch-mod-restart');assert.equal(report.keyAction,sequence);assert.equal(control,undefined);
   assert.deepEqual(result.native_key,{app_hwnd:hwnd,foreground:hwnd,app_process_id:host.process_id,app_enabled:true,code:'KeyS',virtual_key:0x53,hold_ms:40,focus_reacquired:false,pointer_clicked:false});
   const events=report.trusted.filter(row=>row.sequence===sequence&&row.code==='KeyS');assert.deepEqual(events.map(row=>row.type),['keydown','keyup']);assert.ok(events.every(row=>row.trusted&&row.id==='stage-title'));
   assert.ok(events[0].position>=3850&&events[0].position<=4150,'Actual native key arrived inside D4 source onset');
   assert.deepEqual(report.inputPreparation.mapping,{code:'KeyS',midi:62,enabled:'true',base:60,offset:0});assert.equal(report.inputPreparation.focus,'stage-title');continue;
  }
  assert.ok(control);assert.equal(control.kind,action.kind);const{target,...request}=control.request;assert.deepEqual(request,action);
  assert.ok(control.samples.length>=2&&control.samples.length<=5);const last=control.samples.at(-1),prior=control.samples.at(-2);assert.equal(last.hitOwned,true);assert.equal(prior.hitOwned,true);assert.deepEqual(last.target,prior.target);assert.deepEqual(last.target,target);
  assert.equal(action.x,target.x+target.width/2);assert.equal(action.y,target.y+target.height/2);
  assert.ok(control.clicks.some(row=>row.sequence===sequence&&row.owned&&row.trusted));
  const hit=result.client_click;assert.ok(positive(hit.app_hwnd)&&positive(hit.hit_hwnd));hwnd??=hit.app_hwnd;assert.equal(hit.app_hwnd,hwnd);assert.equal(hit.foreground,hwnd);assert.equal(hit.hit_root,hwnd);assert.deepEqual(hit.viewport,[action.width,action.height]);
  const point=[hit.origin[0]+Math.floor(action.x*hit.client[2]/action.width),hit.origin[1]+Math.floor(action.y*hit.client[3]/action.height)];assert.deepEqual(hit.requested,point);assert.deepEqual(hit.actual,point);
  if(action.kind==='picker'){
   assert.equal(report.phase,'pitch-mod-seed');assert.equal(action.file,PITCH_MOD_NATIVE_FIXTURE);assert.equal(control.id,'import-button');
   const picker=report.pickerObservations.find(row=>row.sequence===sequence);assert.equal(picker.completed,true);assert.equal(picker.filename,PITCH_MOD_NATIVE_FIXTURE);validateOwnedPickerGestures(picker.gestures);assert.equal(result.owned_dialog.process_id,host.process_id);assert.equal(result.owned_dialog.root_owner_hwnd,hwnd);assert.equal(result.picker_completion.dialog_dismissed,true);
  }else if(action.kind==='pitch-mod-shift-two'){
   assert.equal(report.phase,'pitch-mod-seed');assert.equal(control.id,'song-mod-pitch-shift');assert.deepEqual(result.native_numeric,{app_hwnd:hwnd,foreground:hwnd,app_process_id:host.process_id,kind:action.kind,value:'2',method:'fixed_ctrl_a_digits_tab',completed:true});
   assert.ok(report.trusted.some(row=>row.sequence===sequence&&row.id===control.id&&row.type==='input'&&row.trusted&&row.value==='2'));
  }else assert.ok(['click','select-first','select-second','select-last'].includes(action.kind));
 }
 assert.equal(actions.filter(row=>row.kind==='picker').length,report.phase==='pitch-mod-seed'?1:0);
 assert.equal(actions.filter(row=>row.kind==='pitch-mod-key-s').length,report.phase==='pitch-mod-restart'?1:0);
 const required=report.phase==='pitch-mod-seed'?['song-mod-pitch-check','song-mod-apply','start-performance']:['configure-song-mod','song-mod-cancel','start-performance'];
 for(const id of required)assert.ok(report.controls.some(row=>row.id===id));
 return actions;
}

export async function verifyNativePitchModEvidence(directory,{sourceRoot=rootDefault,sourceBinding,executable=process.env.WMH_PITCH_MOD_EXECUTABLE}={}){
 const files=new Map();let total=0;
 async function read(name,limit=1024*1024){assert.ok(typeof name==='string'&&!/[\\:\0\r\n]/.test(name)&&name.split('/').every(part=>part&&part!=='.'&&part!=='..'&&!part.startsWith('webview-')));let path=directory;for(const part of name.split('/')){path=join(path,part);assert.equal((await lstat(path)).isSymbolicLink(),false);}const stat=await lstat(path);assert.ok(stat.isFile()&&stat.size>0&&stat.size<=limit);const bytes=await readFile(path);if(!files.has(name)){total+=bytes.length;assert.ok(total<64*1024*1024);files.set(name,{path:name,bytes:bytes.length,sha256:hash(bytes)});}return bytes;}
 const json=async(name,limit)=>parse(await read(name,limit));
 const native=await json('native-pitch-mod.json'),binding=sourceBinding||await pitchModSourceBinding(sourceRoot);assert.equal(native.version,1);assert.equal(native.scenario,'pitch-mod');assert.equal(native.ok,true,native.error);assert.equal(native.profile_reused,true);
 for(const key of ['source_sha','source_tree','source_hashes'])assert.deepEqual(native[key],binding[key]);assert.ok(executable);const exe=await buildDiagnosticsExecutableBinding(executable);assert.equal(exe.sha256,native.executable_sha256);assert.equal(exe.bytes,native.executable_bytes);
 assert.deepEqual(native.phases.map(row=>row.phase),PITCH_MOD_NATIVE_PHASES);assert.equal(new Set(native.phases.map(row=>row.process_id)).size,2);
 const fixture=nativePitchModFixture();assert.deepEqual(await read(`fixtures/${PITCH_MOD_NATIVE_FIXTURE}`),fixture.bytes);assert.deepEqual(await json('fixtures/pitch-mod-fixtures.json'),fixture.manifest);
 const profile=native.phases[0].profile_directory,library=native.directory.replaceAll('\\','/');assert.ok(/^(?:[A-Za-z]:\/|\/)/.test(library)&&library.endsWith('/Scores')&&!library.split('/').some(part=>part==='.'||part==='..'));assert.equal(profile.replaceAll('\\','/'),library.slice(0,-7)+'/webview-profiles/pitch-mod-seed');
 const reports=[];
 for(const[index,host]of native.phases.entries()){
  assert.ok(positive(host.process_id));for(const key of ['renderer_ok','normal_close','launched_new_process'])assert.equal(host[key],true);assert.equal(host.renderer_origin,'https://wmh.localhost');assert.equal(host.executable_tcp_listeners,0);assert.equal(host.profile_directory,profile);assert.equal(host.profile_fresh,index===0);assert.equal(host.profile_reused,index!==0);assert.equal(host.profile_absent_before_launch,index===0);
  const owned=await json(`profile-${host.phase}.json`,16384);assert.equal(owned.process_id,host.process_id);assert.equal(owned.phase,host.phase);assert.equal(owned.profile_directory,profile);assert.equal(owned.library_directory,native.directory);assert.equal(owned.created_new,index===0);assert.equal(owned.fresh_required,index===0);
  const report=await json(`renderer-${host.phase}.json`);assert.equal(report.version,1);assert.equal(report.phase,host.phase);assert.equal(report.scenario,'pitch-mod');assert.equal(report.ok,true,report.error);assert.equal(report.stage,'complete');assert.equal(report.origin,'https://wmh.localhost');assert.equal(report.physicalAudio,false);assert.equal(report.physicalMidi,false);assert.deepEqual(report.errors,[]);assert.equal(report.requestsRestored,true);assert.equal(report.cleanup.restored,true);assert.equal(report.cleanup.overflow,false);assert.deepEqual(report.cleanup.errors,[]);assert.deepEqual(report.cleanup.cleanupErrors,[]);
  const identity=report.buildIdentity;assert.equal(identity.compiled.source_sha,binding.source_sha);assert.equal(identity.compiled.source_tree,binding.source_tree);assert.equal(identity.compiled.source_status,'clean');assert.equal(identity.native.process_id,host.process_id);assert.equal(identity.native.transport,'native-protocol-no-listener');assert.equal(identity.native.os,'windows');assert.equal(identity.native.executable_hash_status,'ok');assert.equal(identity.native.executable_sha256,exe.sha256);assert.equal(identity.native.executable_bytes,exe.bytes);assert.equal(canonicalWindowsExecutablePath(identity.native.executable_path),canonicalWindowsExecutablePath(native.executable_path));
  assert.deepEqual(report.mapping,{code:'KeyS',midi:62,enabled:'true',base:60,offset:0});assert.deepEqual(report.sourceBefore,report.sourceAfter);
  assert.deepEqual(Object.keys(report.files).sort(),['original','take']);
  const values={};for(const[name,file]of Object.entries(report.files)){assert.match(file,new RegExp(`^${host.phase}-(?:[1-9]|1[0-6])\\.json$`));values[name]=await json(`downloads/${file}`);}
  assert.deepEqual(values.original,fixture.score);const take=values.take,pass=take.passes[0];assert.equal(take.passes.length,1);assert.deepEqual(pass.timeline.notes.map(note=>[note.id,note.midi]),[['human-c4-1',62],['human-c4-2',62],['human-c4-3',62]]);assert.deepEqual(pass.inputs.map(input=>input.midi),index?[62]:[]);assert.deepEqual(pass.assessment.hits.map(hit=>hit.note_id),index?['human-c4-2']:[]);assert.deepEqual(pass.assessment.extras,[]);assert.equal(pass.assessment.misses.length,index?2:3);
  const projections=report.requests.filter(row=>row.path==='/api/pitch-mod/project');assert.ok(projections.length>=1&&projections.length<=4);
  for(const row of projections){assert.equal(row.status,200);assert.equal(row.observation,'consumed');assert.deepEqual(row.request,{score:fixture.score,configuration:pitchConfig(2)});assertC4Projection(row.response);assert.equal(row.response.identity.digest,report.applied.digest);}
  assert.deepEqual(take.pitch_mod,projections.at(-1).response.identity);assert.deepEqual(pass.interpretation.pitch_mod,take.pitch_mod);
  if(index){const events=take.input_evidence.events.filter(row=>row.kind==='note_on');assert.equal(events.length,1);assert.equal(events[0].midi,62);assert.equal(events[0].input_kind,'typing_keyboard');const down=report.trusted.find(row=>row.sequence===report.keyAction&&row.type==='keydown'&&row.code==='KeyS');assert.equal(events[0].raw_timestamp_ms,down.timeStamp);assert.equal(pass.captures.length,1);assert.deepEqual(pass.captures[0].input,pass.inputs[0]);}
  assert.equal(report.applied.semitones,'2');assert.equal(report.stageSummary.semitones,report.applied.semitones);assert.equal(report.stageSummary.digest,report.applied.digest);assertPitchMachineAudio(report.audio,projections.at(-1).response);
  assert.ok(report.requests.some(row=>row.path==='/api/assess'&&row.status===200&&row.observation==='consumed'&&isDeepStrictEqual(row.request.timeline,pass.timeline)&&isDeepStrictEqual(row.request.inputs,pass.inputs)&&isDeepStrictEqual(row.response,pass.assessment)));
  if(index===0){assert.deepEqual(report.beforeCheck,report.afterCheck);assert.deepEqual(report.storageBefore,{});assert.equal(report.beforeCheck.audioStarted,0);assert.equal(report.beforeCheck.clock.running,false);assert.ok(projections.some(row=>row.started.actionSequence===report.checkAction));}
  assert.deepEqual(report.storageAfter,report.storageApplied);assert.equal(Object.keys(report.storageAfter).length,1);const preference=JSON.parse(Object.values(report.storageAfter)[0]);assert.deepEqual(preference.configuration,pitchConfig(2));
  const actions=[],results=[];for(let n=1;n<=report.actions;n++){actions.push(await json(`action-${host.phase}-${n}.json`,65536));results.push(await json(`result-${host.phase}-${n}.json`,65536));}
  validateNativePitchActions(report,host,actions,results);passivePngPixels(await read(`native-${host.phase}.png`,16*1024*1024));
  for(const control of report.controls.filter(row=>['song-mod-pitch-check','song-mod-apply','start-performance'].includes(row.id)))passivePngPixels(await read(`native-action-${host.phase}-${control.sequence}.png`,16*1024*1024));
  if(report.keyAction)passivePngPixels(await read(`native-action-${host.phase}-${report.keyAction}.png`,16*1024*1024));reports.push(report);
 }
 assert.deepEqual(reports[1].storageBefore,reports[0].storageAfter);assert.deepEqual(reports[1].storageAfter,reports[0].storageAfter);assert.deepEqual(reports[1].sourceBefore,reports[0].sourceAfter);
 assert.deepEqual(await json('snapshot-pitch-mod-seed.json'),await json('snapshot-pitch-mod-restart.json'),'Native source library bytes survive Mod and process restart');
 return{version:1,ok:true,scenario:'pitch-mod',...binding,executable_sha256:exe.sha256,executable_bytes:exe.bytes,phases:PITCH_MOD_NATIVE_PHASES,claims:NATIVE_PITCH_MOD_CLAIMS,files:[...files.values()].sort((a,b)=>a.path.localeCompare(b.path))};
}
async function main(){const args=process.argv.slice(2);if(args[0]==='--source-binding'){console.log(JSON.stringify(await pitchModSourceBinding(args[1]?resolve(args[1]):rootDefault)));return;}const check=args.includes('--check'),names=args.filter(arg=>arg!=='--check');assert.equal(names.length,1);const directory=resolve(names[0]),value=await verifyNativePitchModEvidence(directory),path=join(directory,'native-pitch-mod-files.json');if(check)assert.deepEqual(parse(await readFile(path)),value);else await writeFile(path,JSON.stringify(value,null,2)+'\n');console.log('Verified focused canonical pitch Mod Windows evidence; no Basic/VSQ native, physical audio/MIDI or full acceptance claim');}
if(process.argv[1]&&pathToFileURL(resolve(process.argv[1])).href===import.meta.url)await main();
