// A focused Windows-native proof, never a substitute for full acceptance.
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {lstat, readFile, writeFile} from 'node:fs/promises';
import {join, resolve} from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {CANONICAL_PRACTICE_SOURCE_FILES} from './canonical-practice-source-evidence.mjs';
import {buildDiagnosticsExecutableBinding, canonicalWindowsExecutablePath} from './build-diagnostics-evidence.mjs';
import {verifyNativeProfileEvidence} from './native-profile-evidence.mjs';
import {validateOwnedFilePickers} from './verify-native-vsq-song-evidence.mjs';
import {validateCleanScreenshot} from './verify-native-clean-song-evidence.mjs';
import {directMidiFixtures, directMidiDigest as hash} from './prepare-direct-midi-fixtures.mjs';
import {validateDirectMidiImport, validateDirectMidiOpened, validateDirectMidiTake} from './direct-midi-proof.mjs';

export const DIRECT_MIDI_NATIVE_PHASES=Object.freeze(['direct-midi-seed','direct-midi-restart']);
export const DIRECT_MIDI_NATIVE_CLAIMS=Object.freeze({native_window:true,owned_windows_picker:true,automatic_saved_preview:true,default_start_complete_targets:true,fresh_process_and_profile_restart:true,exact_raw_export:true,physical_keyboard:false,physical_midi:false,physical_audio:false,audio_fidelity:false,private_music:false,full_acceptance:false,release_ready:false});
export const DIRECT_MIDI_NATIVE_SOURCE_FILES=Object.freeze([...new Set([...CANONICAL_PRACTICE_SOURCE_FILES,
 '.github/workflows/native-direct-midi.yml','scripts/prepare-direct-midi-fixtures.mjs','scripts/direct-midi-proof.mjs',
 'scripts/native-direct-midi-renderer.js','scripts/verify-native-direct-midi-evidence.mjs','scripts/native-direct-midi-contract.ps1','tests/native-direct-midi-evidence.test.js',
 'scripts/build-diagnostics-evidence.mjs','scripts/native-profile-evidence.mjs','web/direct-midi-import.js','web/bulk-import.js','web/bulk-import-view.js',
 'crates/desktop-shell/src/song_pack.rs','crates/desktop-shell/src/song_pack_storage.rs','crates/desktop-shell/src/clean_package.rs',
 'crates/score-core/src/basic_keys.rs','crates/practice-server/src/basic_keys_api.rs',
])].sort());
const rootDefault=fileURLToPath(new URL('../',import.meta.url)),positive=v=>Number.isSafeInteger(v)&&v>0;
const parse=bytes=>JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes).replace(/^\uFEFF/,''));
export async function directMidiNativeSourceBinding(root=rootDefault){
 const git=(...args)=>execFileSync('git',args,{cwd:root,encoding:'utf8',maxBuffer:4*1024*1024}).trim();
 assert.equal(git('status','--porcelain','--untracked-files=normal'),'','Native source must be clean and frozen');
 const source_sha=git('rev-parse','HEAD'),source_tree=git('rev-parse','HEAD^{tree}'),source_hashes={};assert.ok(DIRECT_MIDI_NATIVE_SOURCE_FILES.length<=160);
 for(const name of DIRECT_MIDI_NATIVE_SOURCE_FILES){let path=root;for(const part of name.split('/')){path=join(path,part);assert.equal((await lstat(path)).isSymbolicLink(),false);}const stat=await lstat(path);assert.ok(stat.isFile()&&stat.size>0&&stat.size<=4*1024*1024);const bytes=await readFile(path);assert.deepEqual(bytes,execFileSync('git',['show',`${source_sha}:${name}`],{cwd:root,maxBuffer:4*1024*1024}));source_hashes[name]=hash(bytes);}
 return{source_sha,source_tree,source_hashes};
}

export function validateDirectMidiNativeActions(report,host,actions,results,fixture=directMidiFixtures().boundary){
 assert.ok(DIRECT_MIDI_NATIVE_PHASES.includes(report.phase));assert.ok(positive(report.actions)&&report.actions<=64);assert.equal(host.actions,report.actions);assert.equal(actions.length,report.actions);assert.equal(results.length,report.actions);assert.equal(report.controls.length,report.actions);
 let hwnd;
 for(const[index,action]of actions.entries()){
  const sequence=index+1,control=report.controls[index],result=results[index];assert.equal(control.sequence,sequence);assert.equal(action.version,1);assert.equal(action.sequence,sequence);assert.equal(result.ok,true,result.error);assert.equal(control.kind,action.kind);assert.ok(['click','picker'].includes(action.kind));
  assert.deepEqual(Object.keys(action).sort(),['version','sequence','kind','x','y','width','height',...(action.kind==='picker'?['file']:[])].sort());
  for(const key of ['x','y','width','height'])assert.ok(Number.isFinite(action[key])&&action[key]>0&&action[key]<20000);assert.ok(action.x<action.width&&action.y<action.height);
  const{target,...request}=control.request;assert.deepEqual(request,action);assert.ok(control.samples.length>=2&&control.samples.length<=5);const [prior,last]=control.samples.slice(-2);assert.equal(last.hitOwned,true);assert.equal(prior.hitOwned,true);assert.deepEqual(last.target,prior.target);assert.deepEqual(last.target,target);assert.equal(last.width,action.width);assert.equal(last.height,action.height);assert.equal(action.x,target.x+target.width/2);assert.equal(action.y,target.y+target.height/2);
  assert.ok(control.clicks.some(row=>row.sequence===sequence&&row.owned&&row.trusted&&row.id===control.id),'Trusted original control hit missing');
  const hit=result.client_click;assert.ok(positive(hit.app_hwnd)&&positive(hit.hit_hwnd));hwnd??=hit.app_hwnd;assert.equal(hit.app_hwnd,hwnd);assert.equal(hit.foreground,hwnd);assert.equal(hit.hit_root,hwnd);assert.deepEqual(hit.viewport,[action.width,action.height]);
  assert.deepEqual(hit.client.slice(0,2),[0,0]);const point=[hit.origin[0]+Math.floor(action.x*hit.client[2]/action.width),hit.origin[1]+Math.floor(action.y*hit.client[3]/action.height)];assert.deepEqual(hit.requested,point);assert.deepEqual(hit.actual,point);
  if(action.kind==='picker'){
   assert.equal(report.phase,'direct-midi-seed');assert.equal(action.file,fixture.filename);assert.equal(control.id,'import-button');assert.equal(report.pickerAction,sequence);
   const owned=result.owned_dialog;assert.equal(owned.process_id,host.process_id);assert.equal(owned.app_process_id,host.process_id);assert.equal(owned.root_owner_hwnd,hwnd);assert.equal(owned.app_hwnd,hwnd);assert.equal(owned.class,'#32770');assert.equal(result.picker_completion.dialog_dismissed,true);assert.equal(result.picker_completion.app_enabled,true);assert.equal(result.picker_completion.owned_popup_visible,false);
  }
 }
 assert.deepEqual(actions.filter(row=>row.kind==='picker').map(row=>row.file),report.phase==='direct-midi-seed'?[fixture.filename]:[]);
 validateOwnedFilePickers(report.pickerObservations,report.trusted.filter(row=>row.id==='score-file'||row.pickerSequence!==undefined),report.phase==='direct-midi-seed'?[fixture.filename]:[]);
 assert.deepEqual(report.pickerObservations.map(row=>row.sequence),actions.filter(row=>row.kind==='picker').map(row=>row.sequence));
 assert.equal(report.controls[report.startAction-1]?.id,'start-performance');assert.equal(actions[report.startAction-1]?.kind,'click');assert.ok(report.trusted.some(row=>row.id==='start-performance'&&row.type==='click'&&row.trusted&&row.actionSequence===report.startAction));
 for(const forbidden of ['bulk-import-save','configure-song-mod','song-mod-all-human','song-mod-apply'])assert.ok(!report.controls.some(row=>row.id===forbidden),'Direct Start must need no package or Mod repair');
 for(const name of ['take','raw']){const download=report.downloads[name];assert.ok(positive(download.action)&&download.action<=report.actions);assert.equal(actions[download.action-1].kind,'click');assert.equal(download.file,report.files[name]);assert.equal(download.complete,true);assert.equal(download.success,true);}
 assert.equal(report.controls[report.downloads.take.action-1].id,'export-takes');
 return actions;
}
export function validateDirectMidiNativeRequests(report,fixture=directMidiFixtures().boundary){
 assert.ok(Array.isArray(report.requests)&&report.requests.length>0&&report.requests.length<=40);
 for(const row of report.requests){assert.equal(row.observation,'consumed');assert.ok(Number.isSafeInteger(row.started.sequence)&&row.started.sequence>=0&&row.started.sequence<=report.actions);assert.ok(row.settled.sequence>=row.started.sequence&&row.settled.sequence<=report.actions);assert.equal(row.canceled,false);}
 const imports=report.requests.filter(row=>['/api/import/midi','/api/library/import/preview','/api/library/import/commit'].includes(row.path));
 if(report.phase==='direct-midi-seed'){
  assert.deepEqual(imports.map(row=>[row.path,row.status]),[['/api/import/midi',400],['/api/library/import/preview',200],['/api/library/import/commit',200]]);assert.equal(typeof imports[0].response.error,'string');assert.ok(imports[0].response.error.length>0);
  for(const row of imports){assert.equal(row.started.sequence,report.pickerAction);assert.equal(row.settled.sequence,report.pickerAction);}
  validateDirectMidiImport(imports[1].response,fixture,{mode:'preview',status:'ready'});validateDirectMidiImport(imports[2].response,fixture);assert.equal(imports[2].response.items[0].entry.key,report.key);assert.equal(imports[2].response.source.archive_key,report.archiveKey);
 }else assert.deepEqual(imports,[],'Restart must load saved data without another import');
 const loads=report.requests.filter(row=>row.path==='/api/library/load');assert.ok(loads.length>=1);const load=loads.findLast(row=>row.request?.key===report.key);assert.ok(load);assert.equal(load.status,200);assert.deepEqual(load.response,report.opened);assert.ok(load.settled.sequence<report.startAction);
 const assessments=report.requests.filter(row=>row.path==='/api/assess');assert.equal(assessments.length,1);const assessment=assessments[0];assert.equal(assessment.status,200);assert.deepEqual(assessment.request.inputs,[]);assert.deepEqual(assessment.request.timeline.notes.map(note=>note.id),fixture.expectedNotes.map(note=>note.id));assert.equal(assessment.response.accuracy_percent,0);assert.deepEqual(assessment.response.hits,[]);assert.deepEqual(assessment.response.extras,[]);assert.equal(assessment.response.misses.length,4);assert.equal(assessment.started.sequence,report.startAction);
 const plans=report.requests.filter(row=>row.path==='/api/practice-targets'&&row.request?.timeline?.notes?.some(note=>note.id===fixture.expectedNotes[0].id));assert.ok(plans.length>0);for(const row of plans){assert.equal(row.status,200);assert.equal(row.response.source_note_count,4);assert.equal(row.response.target_count,4);assert.deepEqual(row.request.timeline.notes.map(note=>note.id),fixture.expectedNotes.map(note=>note.id));assert.deepEqual(row.response.timeline.notes.map(note=>note.id),fixture.expectedNotes.map(note=>note.id));}
 return assessment;
}
export function validateDirectMidiNativeRenderer(report,fixture=directMidiFixtures().boundary){
 assert.equal(report.version,1);assert.equal(report.scenario,'direct-midi');assert.ok(DIRECT_MIDI_NATIVE_PHASES.includes(report.phase));assert.equal(report.ok,true,report.error);assert.equal(report.error,undefined);assert.equal(report.origin,'https://wmh.localhost');assert.equal(report.profileMarkerAbsent,true);assert.equal(report.requestsRestored,true);assert.deepEqual(report.errors,[]);
 validateDirectMidiOpened(report.opened,fixture);assert.equal(report.key,report.opened.entry.key);assert.deepEqual(report.inventory.entries.map(row=>row.key),[report.key]);assert.deepEqual(report.inventory.issues,[]);assert.equal(report.initialInventory.entries.length,report.phase==='direct-midi-seed'?0:1);
 assert.equal(report.preview.id,`native:${report.key}`);assert.equal(report.preview.status,'ready');assert.equal(report.preview.screen,'library');assert.equal(report.preview.startDisabled,false);assert.equal(report.preview.bulkDialog,false);assert.equal(report.preview.clock.running,false);
 if(report.phase==='direct-midi-seed')assert.match(report.preview.notice,/Complete MIDI source saved.*FIFO/);
 assert.equal(report.ended.screen,'stage');assert.equal(report.ended.mode,'practice');assert.equal(report.ended.renderer,'ended');assert.equal(report.ended.clock.completed,true);assert.equal(report.ended.clock.running,false);assert.equal(report.ended.clock.positionMs,2000);assert.equal(report.ended.captured,'0');
 assert.deepEqual(Object.keys(report.files).sort(),['raw','take']);assert.deepEqual(Object.keys(report.screenshots).sort(),['ended','preview']);assert.match(report.archiveKey,/^pack-[a-f0-9]{64}$/);validateDirectMidiNativeRequests(report,fixture);return report;
}

export async function verifyNativeDirectMidiEvidence(directory,{sourceRoot=rootDefault,sourceBinding,executable=process.env.WMH_DIRECT_MIDI_EXECUTABLE}={}){
 const files=new Map();let total=0;
 async function read(name,limit=1024*1024){assert.ok(typeof name==='string'&&name.length<=1024&&!/[\\:\0\r\n]/.test(name)&&name.split('/').every(part=>part&&part!=='.'&&part!=='..'&&!part.toLowerCase().startsWith('webview-')));let path=directory;for(const part of name.split('/')){path=join(path,part);assert.equal((await lstat(path)).isSymbolicLink(),false);}const stat=await lstat(path);assert.ok(stat.isFile()&&stat.size>0&&stat.size<=limit);const bytes=await readFile(path);if(!files.has(name)){total+=bytes.length;assert.ok(files.size<1024&&total<=96*1024*1024);files.set(name,{path:name,bytes:bytes.length,sha256:hash(bytes)});}return bytes;}
 const json=async(name,limit)=>parse(await read(name,limit)),native=await json('native-direct-midi.json'),binding=sourceBinding||await directMidiNativeSourceBinding(sourceRoot),fixture=directMidiFixtures().boundary;
 assert.equal(native.version,1);assert.equal(native.scenario,'direct-midi');assert.equal(native.ok,true,native.error);assert.equal(native.profile_reused,false);for(const key of ['source_sha','source_tree','source_hashes'])assert.deepEqual(native[key],binding[key]);assert.ok(executable,'Independent actual executable required');const exe=await buildDiagnosticsExecutableBinding(executable);assert.equal(native.executable_sha256,exe.sha256);assert.equal(native.executable_bytes,exe.bytes);
 await verifyNativeProfileEvidence(native,DIRECT_MIDI_NATIVE_PHASES,json);assert.deepEqual(await read(`fixtures/${fixture.filename}`),fixture.bytes);assert.deepEqual((await json('fixtures/direct-midi-fixtures.json')).boundary,fixture.manifest);
 const reports=[];let seedSnapshot;
 for(const phase of DIRECT_MIDI_NATIVE_PHASES){
  const report=validateDirectMidiNativeRenderer(await json(`renderer-${phase}.json`),fixture),host=native.phases.find(row=>row.phase===phase);reports.push(report);assert.equal(host.renderer_ok,true);assert.equal(host.normal_close,true);assert.equal(host.launched_new_process,true);assert.equal(host.renderer_origin,report.origin);assert.equal(host.executable_tcp_listeners,0);
  const identity=report.buildIdentity;assert.equal(identity.compiled.source_sha,binding.source_sha);assert.equal(identity.compiled.source_tree,binding.source_tree);assert.equal(identity.compiled.source_status,'clean');assert.equal(identity.native.process_id,host.process_id);assert.equal(identity.native.transport,'native-protocol-no-listener');assert.equal(identity.native.os,'windows');assert.equal(identity.native.executable_hash_status,'ok');assert.equal(identity.native.executable_sha256,exe.sha256);assert.equal(identity.native.executable_bytes,exe.bytes);assert.equal(canonicalWindowsExecutablePath(identity.native.executable_path),canonicalWindowsExecutablePath(native.executable_path));
  const actions=[],results=[];for(let n=1;n<=report.actions;n++){actions.push(await json(`action-${phase}-${n}.json`));results.push(await json(`result-${phase}-${n}.json`));}validateDirectMidiNativeActions(report,host,actions,results,fixture);
  for(const sequence of Object.values(report.screenshots)){assert.ok(positive(sequence)&&sequence<=report.actions);assert.equal(actions[sequence-1].kind,'click');validateCleanScreenshot(await read(`native-action-${phase}-${sequence}.png`,16*1024*1024));}validateCleanScreenshot(await read(`native-${phase}.png`,16*1024*1024));
  assert.equal(report.files.take,`${phase}-1.json`);assert.equal(report.files.raw,`${phase}-2.mid`);const take=validateDirectMidiTake(await json(`downloads/${report.files.take}`),fixture),assessment=validateDirectMidiNativeRequests(report,fixture);assert.equal(take.passes.length,1);assert.deepEqual(take.passes[0].assessment,assessment.response);assert.deepEqual(take.passes[0].timeline,assessment.request.timeline);assert.equal(take.passes[0].interpretation.source_sha256,fixture.manifest.sha256);assert.equal(take.passes[0].interpretation.package_content_sha256,report.opened.clean_package.content_sha256);assert.deepEqual(await read(`downloads/${report.files.raw}`),fixture.bytes);
  const snapshot=await json(`snapshot-${phase}.json`);assert.equal(snapshot.version,1);assert.ok(snapshot.files.length>0&&snapshot.files.length<=32);for(const row of snapshot.files){const bytes=await read(`Scores/${row.path}`);assert.equal(bytes.length,row.bytes);assert.equal(hash(bytes),row.sha256);}if(seedSnapshot)assert.deepEqual(snapshot,seedSnapshot,'Saved raw/package bytes changed after restart');else seedSnapshot=snapshot;
  for(const area of ['imports','import-backups']){const path=`${area}/${report.archiveKey}/source.bin`;assert.deepEqual(await read(`Scores/${path}`),fixture.bytes);assert.ok(snapshot.files.some(row=>row.path===path&&row.sha256===fixture.manifest.sha256&&row.bytes===fixture.bytes.length));}
  for(const area of ['clean-songs','clean-backups'])for(const[name,value]of [['metadata.json',report.opened.clean_package.metadata_json],['score.json',report.opened.clean_package.score_json]])assert.deepEqual(await read(`Scores/${area}/${report.key}/package/${name}`),Buffer.from(value));
 }
 assert.deepEqual(reports[1].opened,reports[0].opened);assert.equal(reports[1].archiveKey,reports[0].archiveKey);
 return{version:1,ok:true,source_sha:binding.source_sha,source_tree:binding.source_tree,source_hashes:binding.source_hashes,executable_sha256:exe.sha256,executable_bytes:exe.bytes,fixture:fixture.manifest,claims:DIRECT_MIDI_NATIVE_CLAIMS,files:[...files.values()]};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
 if(process.argv[2]==='--source-binding'){console.log(JSON.stringify(await directMidiNativeSourceBinding(resolve(process.argv[3]||rootDefault))));}
 else{const check=process.argv[2]==='--check',directory=resolve(process.argv[check?3:2]),proof=await verifyNativeDirectMidiEvidence(directory),path=join(directory,'direct-midi-proof.json');if(check)assert.deepEqual(parse(await readFile(path)),proof);else await writeFile(path,JSON.stringify(proof,null,2)+'\n');console.log(JSON.stringify({ok:proof.ok,source_sha:proof.source_sha,files:proof.files.length}));}
}
