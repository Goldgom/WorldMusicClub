// Retained Windows proof from actual original clean sources and native adapters.
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {lstat, readFile, writeFile} from 'node:fs/promises';
import {join, resolve} from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {ASSISTANCE_SOURCE_FILES} from './verify-native-assistance-evidence.mjs';
import {PITCH_MOD_SOURCE_FILES} from './verify-native-pitch-mod-evidence.mjs';
import {buildDiagnosticsExecutableBinding, canonicalWindowsExecutablePath} from './build-diagnostics-evidence.mjs';
import {passivePngPixels} from './native-passive-capture-evidence.mjs';
import {validateOwnedPickerGestures} from './verify-native-vsq-song-evidence.mjs';
import {nativePitchSourcesFixture, PITCH_SOURCES_NATIVE_FIXTURE, PITCH_SOURCES_NATIVE_PHASES, PITCH_SOURCES_KINDS} from './native-pitch-sources-fixtures.mjs';
import {nativePitchSourceProjection, validateNativePitchSourceCase, validateNativeBasicPitchNotation} from './native-pitch-sources-proof.mjs';

const rootDefault=fileURLToPath(new URL('../',import.meta.url)),hash=bytes=>createHash('sha256').update(bytes).digest('hex'),positive=value=>Number.isSafeInteger(value)&&value>0;
const parse=bytes=>JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes).replace(/^\uFEFF/,''));
export const PITCH_SOURCES_CLAIMS=Object.freeze({native_window:true,complete_basic_fifo_percussion:true,semantic_vsq_explicit_choice:true,vsq_rational_zero_origin:true,pitch_plus_two_and_zero:true,actual_receiver_ledger_pcm:true,source_bound_no_input_assessment:true,native_notation_source_ids:true,original_clean_package_bytes_preserved:true,saved_plus_two_restart:true,saved_zero_restart:true,physical_audio:false,physical_midi:false,source_specific_trusted_hits:false,raw_vsq_import:false,original_singing_voice:false,full_acceptance:false,release_ready:false});
export const PITCH_SOURCES_SOURCE_FILES=Object.freeze([...new Set([...ASSISTANCE_SOURCE_FILES,...PITCH_MOD_SOURCE_FILES,
 '.github/workflows/native-pitch-sources.yml','scripts/native-pitch-sources-fixtures.mjs','scripts/native-pitch-sources-proof.mjs',
 'scripts/native-pitch-sources-renderer.js','scripts/native-pitch-sources-input.cs','scripts/native-pitch-sources-contract.ps1',
 'scripts/verify-native-pitch-sources.mjs','tests/native-pitch-sources-proof.test.js','tests/native-pitch-sources-evidence.test.js',
 'tests/fixtures/pitch-mod-handler-vectors.json',
])].sort());
export async function pitchSourcesSourceBinding(root=rootDefault){
 const git=(...args)=>execFileSync('git',args,{cwd:root,encoding:'utf8',maxBuffer:4*1024*1024}).trim();
 const source_sha=git('rev-parse','HEAD'),source_tree=git('rev-parse','HEAD^{tree}'),source_hashes={};assert.equal(git('status','--porcelain','--untracked-files=normal'),'','Source pitch proof needs a clean frozen tree');assert.ok(PITCH_SOURCES_SOURCE_FILES.length<=384);
 for(const name of PITCH_SOURCES_SOURCE_FILES){let path=root;for(const part of name.split('/')){path=join(path,part);assert.equal((await lstat(path)).isSymbolicLink(),false);}const stat=await lstat(path);assert.ok(stat.isFile()&&stat.size>0&&stat.size<=4*1024*1024);const bytes=await readFile(path);assert.deepEqual(bytes,execFileSync('git',['show',`${source_sha}:${name}`],{cwd:root,maxBuffer:4*1024*1024}));source_hashes[name]=hash(bytes);}
 return{source_sha,source_tree,source_hashes};
}

export function validateNativePitchSourcesActions(report,host,actions,results){
 assert.ok(PITCH_SOURCES_NATIVE_PHASES.includes(report.phase));assert.ok(positive(report.actions)&&report.actions<=128);assert.equal(host.actions,report.actions);assert.equal(actions.length,report.actions);assert.equal(results.length,report.actions);
 const controls=new Map(report.controls.map(control=>[control.sequence,control]));assert.equal(controls.size,report.controls.length);let hwnd;
 for(const[index,action]of actions.entries()){
  const sequence=index+1,result=results[index],control=controls.get(sequence);assert.equal(action.version,1);assert.equal(action.sequence,sequence);assert.equal(result.ok,true,result.error);
  assert.deepEqual(Object.keys(action).sort(),['version','sequence','kind','x','y','width','height',...(action.kind==='picker'?['file']:[])].sort());
  for(const key of ['x','y','width','height'])assert.ok(Number.isFinite(action[key])&&action[key]>0&&action[key]<20000);assert.ok(action.x<action.width&&action.y<action.height);
  assert.ok(control);assert.equal(control.kind,action.kind);const{target,...request}=control.request;assert.deepEqual(request,action);
  assert.ok(control.samples.length>=2&&control.samples.length<=5);const last=control.samples.at(-1),prior=control.samples.at(-2);assert.equal(last.hitOwned,true);assert.equal(prior.hitOwned,true);assert.deepEqual(last.target,prior.target);assert.deepEqual(last.target,target);
  assert.equal(action.x,target.x+target.width/2);assert.equal(action.y,target.y+target.height/2);
  assert.ok(control.clicks.some(row=>row.sequence===sequence&&row.owned&&row.trusted));
  const hit=result.client_click;assert.ok(positive(hit.app_hwnd)&&positive(hit.hit_hwnd));hwnd??=hit.app_hwnd;assert.equal(hit.app_hwnd,hwnd);assert.equal(hit.foreground,hwnd);assert.equal(hit.hit_root,hwnd);assert.deepEqual(hit.viewport,[action.width,action.height]);
  const point=[hit.origin[0]+Math.floor(action.x*hit.client[2]/action.width),hit.origin[1]+Math.floor(action.y*hit.client[3]/action.height)];assert.deepEqual(hit.requested,point);assert.deepEqual(hit.actual,point);
  if(action.kind==='picker'){
   assert.equal(report.phase,'pitch-sources-seed');assert.equal(action.file,PITCH_SOURCES_NATIVE_FIXTURE);assert.equal(control.id,'import-button');
   const picker=report.pickerObservations.find(row=>row.sequence===sequence);assert.equal(picker.completed,true);assert.equal(picker.filename,PITCH_SOURCES_NATIVE_FIXTURE);validateOwnedPickerGestures(picker.gestures);assert.equal(result.owned_dialog.process_id,host.process_id);assert.equal(result.owned_dialog.root_owner_hwnd,hwnd);assert.equal(result.picker_completion.dialog_dismissed,true);
  }else if(action.kind==='pitch-sources-shift-two'){
   assert.equal(report.phase,'pitch-sources-seed');assert.equal(control.id,'song-mod-pitch-shift');assert.deepEqual(result.native_numeric,{app_hwnd:hwnd,foreground:hwnd,app_process_id:host.process_id,kind:action.kind,value:'2',method:'fixed_ctrl_a_digits_tab',completed:true});
   assert.ok(report.trusted.some(row=>row.sequence===sequence&&row.id===control.id&&row.type==='input'&&row.trusted&&row.value==='2'));
  }else assert.ok(['click','select-first','select-second','select-last'].includes(action.kind));
 }
 assert.equal(actions.filter(row=>row.kind==='picker').length,report.phase==='pitch-sources-seed'?1:0);
 for(const id of ['song-mod-apply','start-performance'])assert.ok(report.controls.some(row=>row.id===id));
 if(['pitch-sources-seed','pitch-sources-zero'].includes(report.phase))assert.ok(report.controls.some(row=>row.id==='song-mod-pitch-check'));
 return actions;
}

export function validatePitchSourceNotation(item){
 const projected=nativePitchSourceProjection(item.kind,item.semitones),parts=projected.compilation.score.parts.map(part=>part.id).sort();
 if(item.kind==='basic')validateNativeBasicPitchNotation(item.notationRequests.filter(row=>row.observation==='consumed'),item.semitones);
 for(const run of [item.machine,item.human]){
  const view=run.notation;assert.equal(view.pitchSummary.semitones,String(item.semitones));assert.equal(view.pitchSummary.digest,projected.identity?.digest||'');
  assert.equal(view.staff.scope,'all');assert.equal(view.staff.status,'ready');assert.deepEqual(view.staff.renderedParts.sort(),parts);assert.ok(view.staff.svgCount>0);
  assert.ok(positive(view.screenshots.staff)&&positive(view.screenshots.jianpu)&&view.screenshots.staff<view.screenshots.jianpu);
  assert.ok(Array.isArray(view.rows)&&view.rows.length<=32);assert.equal(new Set(view.rows.map(row=>row.id)).size,view.rows.length);
  if(item.kind==='vsq'){
   const notes=projected.compilation.score.parts.flatMap(part=>part.notes),ids=notes.map(note=>note.id).sort();assert.deepEqual(view.staff.sourceIds,ids);
   assert.deepEqual(view.rows.map(row=>row.id).sort(),ids);
   // These actual handler vectors spell original D-sharp4 and effective F4.
   for(const row of view.rows){assert.equal(row.number,item.semitones?'4':'2');assert.equal(row.accidental,item.semitones?'':'♯');}
   assert.ok(item.exportRequests.some(row=>row.observation==='consumed'&&row.status===200&&JSON.stringify(row.request)===JSON.stringify(projected.compilation.score)),'VSQ staff must consume the effective Rust score');
  }else{
   const melodic=projected.compilation.timeline.notes.filter(note=>note.part_id==='midi-t1-c1-r0');
   assert.deepEqual(view.staff.sourceIds,melodic.filter(note=>note.duration_ms>20).map(note=>note.id).sort(),'FIFO positive gates retain their source glyph IDs');
   assert.ok(view.rows.some(row=>row.id==='midi-t1-e3'&&row.number===(item.semitones?'2':'1')));
   assert.ok(view.rows.some(row=>row.id==='midi-t1-e4'&&row.number===(item.semitones?'2':'1')));
   // Synthetic onsets and percussion remain explicit native page selectors;
   // they are not silently reinterpreted as ordinary pitched staff durations.
   const pages=item.notationRequests.filter(row=>row.observation==='consumed'&&row.request.settings.display_meter?.numerator===4).map(row=>row.response.page);
   assert.ok(pages.some(page=>page.onsets?.some(note=>note.note_id==='midi-t1-e7'&&note.key===(item.semitones?66:64))));
   assert.ok(pages.some(page=>page.selectors?.some(note=>note.note_id==='midi-t1-e9'&&note.key===35)));
   assert.ok(view.staff.selectors.some(row=>row.id==='midi-t1-e7'&&row.text.includes(`MIDI key ${item.semitones?66:64}`)&&row.text.includes('20 ms onset marker')));
   assert.ok(view.staff.selectors.some(row=>row.id==='midi-t1-e9'&&row.text.includes('Percussion selector 35')));
  }
 }
}

export async function verifyNativePitchSources(directory,{sourceRoot=rootDefault,sourceBinding,executable=process.env.WMH_PITCH_SOURCES_EXECUTABLE}={}){
 const files=new Map();let total=0;
 async function read(name,limit=1024*1024){assert.ok(typeof name==='string'&&!/[\\:\0\r\n]/.test(name)&&name.split('/').every(part=>part&&part!=='.'&&part!=='..'&&!part.startsWith('webview-')));let path=directory;for(const part of name.split('/')){path=join(path,part);assert.equal((await lstat(path)).isSymbolicLink(),false);}const stat=await lstat(path);assert.ok(stat.isFile()&&stat.size>0&&stat.size<=limit);const bytes=await readFile(path);if(!files.has(name)){total+=bytes.length;assert.ok(total<96*1024*1024);files.set(name,{path:name,bytes:bytes.length,sha256:hash(bytes)});}return bytes;}
 const json=async(name,limit)=>parse(await read(name,limit));const native=await json('native-pitch-sources.json'),binding=sourceBinding||await pitchSourcesSourceBinding(sourceRoot);
 assert.equal(native.version,1);assert.equal(native.scenario,'pitch-sources');assert.equal(native.ok,true,native.error);assert.equal(native.profile_reused,true);for(const key of ['source_sha','source_tree','source_hashes'])assert.deepEqual(native[key],binding[key]);assert.ok(executable);const exe=await buildDiagnosticsExecutableBinding(executable);assert.equal(exe.sha256,native.executable_sha256);assert.equal(exe.bytes,native.executable_bytes);
 assert.deepEqual(native.phases.map(row=>row.phase),PITCH_SOURCES_NATIVE_PHASES);assert.equal(new Set(native.phases.map(row=>row.process_id)).size,4);
 const fixture=nativePitchSourcesFixture();assert.deepEqual(await read(`fixtures/${PITCH_SOURCES_NATIVE_FIXTURE}`),fixture.bytes);assert.deepEqual(await json('fixtures/pitch-sources-fixtures.json'),fixture.manifest);
 const profile=native.phases[0].profile_directory,library=native.directory.replaceAll('\\','/');assert.ok(/^(?:[A-Za-z]:\/|\/)/.test(library)&&library.endsWith('/Scores')&&!library.split('/').some(part=>part==='.'||part==='..'));assert.equal(profile.replaceAll('\\','/'),library.slice(0,-7)+'/webview-profiles/pitch-sources-seed');
 const reports=[];
 for(const[index,host]of native.phases.entries()){
  assert.ok(positive(host.process_id));for(const key of ['renderer_ok','normal_close','launched_new_process'])assert.equal(host[key],true);assert.equal(host.renderer_origin,'https://wmh.localhost');assert.equal(host.executable_tcp_listeners,0);assert.equal(host.profile_directory,profile);assert.equal(host.profile_fresh,index===0);assert.equal(host.profile_reused,index!==0);assert.equal(host.profile_absent_before_launch,index===0);
  const owned=await json(`profile-${host.phase}.json`,16384);assert.equal(owned.process_id,host.process_id);assert.equal(owned.phase,host.phase);assert.equal(owned.profile_directory,profile);assert.equal(owned.library_directory,native.directory);assert.equal(owned.created_new,index===0);assert.equal(owned.fresh_required,index===0);
  const report=await json(`renderer-${host.phase}.json`);assert.equal(report.version,1);assert.equal(report.phase,host.phase);assert.equal(report.scenario,'pitch-sources');assert.equal(report.ok,true,report.error);assert.equal(report.stage,'complete');assert.equal(report.origin,'https://wmh.localhost');assert.equal(report.physicalAudio,false);assert.equal(report.physicalMidi,false);assert.equal(report.sourceSpecificTrustedHits,false);assert.deepEqual(report.errors,[]);assert.equal(report.requestsRestored,true);assert.equal(report.cleanup.restored,true);assert.equal(report.cleanup.overflow,false);assert.deepEqual(report.cleanup.errors,[]);assert.deepEqual(report.cleanup.cleanupErrors,[]);
  const identity=report.buildIdentity;assert.equal(identity.compiled.source_sha,binding.source_sha);assert.equal(identity.compiled.source_tree,binding.source_tree);assert.equal(identity.compiled.source_status,'clean');assert.equal(identity.native.process_id,host.process_id);assert.equal(identity.native.transport,'native-protocol-no-listener');assert.equal(identity.native.os,'windows');assert.equal(identity.native.executable_hash_status,'ok');assert.equal(identity.native.executable_sha256,exe.sha256);assert.equal(identity.native.executable_bytes,exe.bytes);assert.equal(canonicalWindowsExecutablePath(identity.native.executable_path),canonicalWindowsExecutablePath(native.executable_path));
  assert.deepEqual(report.cases.map(item=>[item.kind,item.semitones]),PITCH_SOURCES_KINDS.map(kind=>[kind,index<2?2:0]));assert.equal(Object.keys(report.files).length,2);
  for(const item of report.cases){
   validateNativePitchSourceCase(item);validatePitchSourceNotation(item);
   const file=item.human.takeFile;assert.equal(report.files[`${item.kind}-${item.semitones}-human`],file);assert.match(file,new RegExp(`^${host.phase}-(?:[1-9]|1[0-6])\\.json$`));const take=await json(`downloads/${file}`),projected=nativePitchSourceProjection(item.kind,item.semitones);assert.equal(take.passes.length,1);const pass=take.passes[0];assert.deepEqual(pass.inputs,[]);assert.deepEqual(pass.captures,[]);assert.deepEqual(pass.timeline,item.human.targets.response.timeline);assert.deepEqual(pass.assessment,item.human.assessment.response);assert.deepEqual(take.target_plan,item.human.targets.response);assert.equal(pass.pending,false);assert.equal(pass.revision,pass.assessed_revision);assert.equal(take.practice_assistance,null);assert.equal(take.practice_progression,null);
   assert.deepEqual(take.practice_selection,{kind:'parts',part_ids:[item.human.targetPart]});assert.deepEqual(take.song_mod.config.parts.filter(part=>part.performer==='human').map(part=>part.partId),[item.human.targetPart]);
   if(item.semitones){assert.deepEqual(take.pitch_mod,projected.identity);assert.deepEqual(pass.interpretation.pitch_mod,projected.identity);}else{assert.equal(take.pitch_mod,undefined);assert.equal(pass.interpretation.pitch_mod,undefined);}
   assert.deepEqual(pass.interpretation.source_revision,{songId:fixture.sources[item.kind].score.notation.id,sourceRevision:{kind:'clean-package-sha256',value:projected.source.content_sha256}});
   for(const run of [item.machine,item.human])for(const sequence of Object.values(run.notation.screenshots))passivePngPixels(await read(`native-action-${host.phase}-${sequence}.png`,16*1024*1024));
  }
  const actions=[],results=[];for(let n=1;n<=report.actions;n++){actions.push(await json(`action-${host.phase}-${n}.json`,65536));results.push(await json(`result-${host.phase}-${n}.json`,65536));}validateNativePitchSourcesActions(report,host,actions,results);passivePngPixels(await read(`native-${host.phase}.png`,16*1024*1024));
  assert.equal(Object.keys(report.storageAfter).length,2);for(const raw of Object.values(report.storageAfter)){const value=JSON.parse(raw);assert.equal(value.configuration.semitones,index<2?2:0);}
  if(index===0)assert.deepEqual(report.storageBefore,{});else assert.deepEqual(report.storageBefore,reports[index-1].storageAfter);
  if(index===1||index===3)assert.deepEqual(report.storageAfter,report.storageBefore,'Restarts must restore exactly the saved pitch+roles bytes');reports.push(report);
 }
 const snapshots=await Promise.all(PITCH_SOURCES_NATIVE_PHASES.map(phase=>json(`snapshot-${phase}.json`)));for(const snapshot of snapshots.slice(1))assert.deepEqual(snapshot,snapshots[0],'Native original package disk bytes changed during Mod or restart');
 for(const kind of PITCH_SOURCES_KINDS){const source=fixture.sources[kind];for(const name of ['metadata.json','score.json']){const bytes=fixture.files.get(`${source.folder}/${name}`),path=`clean-songs/${source.key}/package/${name}`,row=snapshots[0].files.find(row=>row.path===path);assert.ok(row);assert.equal(row.bytes,bytes.length);assert.equal(row.sha256,hash(bytes));assert.deepEqual(await read(`Scores/${path}`),bytes);}}
 return{version:1,ok:true,scenario:'pitch-sources',...binding,executable_sha256:exe.sha256,executable_bytes:exe.bytes,phases:PITCH_SOURCES_NATIVE_PHASES,claims:PITCH_SOURCES_CLAIMS,files:[...files.values()].sort((a,b)=>a.path.localeCompare(b.path))};
}
async function main(){const args=process.argv.slice(2);if(args[0]==='--source-binding'){console.log(JSON.stringify(await pitchSourcesSourceBinding(args[1]?resolve(args[1]):rootDefault)));return;}const check=args.includes('--check'),names=args.filter(arg=>arg!=='--check');assert.equal(names.length,1);const directory=resolve(names[0]),value=await verifyNativePitchSources(directory),path=join(directory,'native-pitch-sources-files.json');if(check)assert.deepEqual(parse(await readFile(path)),value);else await writeFile(path,JSON.stringify(value,null,2)+'\n');console.log('Verified native Basic/semantic VSQ source pitch evidence; no source-specific trusted-hit, physical audio/MIDI, raw VSQ/singing or full acceptance claim');}
if(process.argv[1]&&pathToFileURL(resolve(process.argv[1])).href===import.meta.url)await main();
