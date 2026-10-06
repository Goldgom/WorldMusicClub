// Actual Windows evidence is mandatory for this gate. Node contracts are not acceptance.
import assert from 'node:assert/strict';
import {lstat,readFile,writeFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {nativeSkinFixture,NATIVE_SKIN_PHASES,NATIVE_SKIN_FILES} from './prepare-native-skin-fixtures.mjs';
import {nativeSkinSourceBinding} from './native-skin-source-evidence.mjs';
import {sha256} from '../tests/skin-browser-fixture.js';
import {validateOwnedFilePickers} from './verify-native-vsq-song-evidence.mjs';
import {validateCleanScreenshot} from './verify-native-clean-song-evidence.mjs';
import {uniqueCanonicalEvidenceFiles} from './canonical-practice-source-evidence.mjs';

const origin='https://wmh.localhost',plain=value=>JSON.parse(JSON.stringify(value));
const positive=value=>Number.isSafeInteger(value)&&value>0;
function integerTuple(value,length,label){assert.ok(Array.isArray(value)&&value.length===length&&value.every(Number.isSafeInteger),`${label} must contain ${length} finite integer coordinates`);return value;}
// Match the production native host's foreground/hit, picker ownership and
// dismissal predicates, then bind every action to one phase-owned HWND.
export function validateNativeSkinHostAction(action,result,host,appWindow=null){
  assert.equal(action.version,1);assert.ok(positive(action.sequence)&&action.sequence<=64);assert.ok(positive(host.process_id));
  assert.ok(['click','picker','key-r','select-first','select-last'].includes(action.kind));
  assert.ok([action.x,action.y,action.width,action.height].every(Number.isFinite)&&action.width>0&&action.width<20000&&action.height>0&&action.height<20000&&action.x>0&&action.x<action.width&&action.y>0&&action.y<action.height);
  assert.equal(result.ok,true);const c=result.client_click;assert.ok(c,'Native click evidence is missing');
  for(const name of ['app_hwnd','foreground','hit_hwnd','hit_root'])assert.ok(positive(c[name]),`Missing positive native ${name}`);
  if(appWindow!==null){assert.ok(positive(appWindow));assert.equal(c.app_hwnd,appWindow,'Native app window changed within the same process');}
  assert.equal(c.foreground,c.app_hwnd);assert.equal(c.hit_root,c.app_hwnd);
  integerTuple(c.actual,2,'Actual native point');integerTuple(c.requested,2,'Requested native point');assert.deepEqual(c.actual,c.requested);
  assert.deepEqual(c.viewport,[action.width,action.height]);const [left,top,right,bottom]=integerTuple(c.client,4,'Native client bounds'),[ox,oy]=integerTuple(c.origin,2,'Native client origin');
  assert.ok(right>left&&bottom>top);assert.deepEqual(c.requested,[ox+Math.floor(action.x*(right-left)/action.width),oy+Math.floor(action.y*(bottom-top)/action.height)],'Native point must map the actual renderer target using the host floor rule');
  const [wl,wt,wr,wb]=integerTuple(c.work_area,4,'Native monitor bounds');assert.ok(wr>wl&&wb>wt&&c.actual[0]>=wl&&c.actual[0]<wr&&c.actual[1]>=wt&&c.actual[1]<wb);
  if(action.kind==='picker'){
    const o=result.owned_dialog,p=result.picker_completion;assert.ok(o&&p,'Owned picker and dismissal records required');
    assert.equal(o.class,'#32770');assert.ok(positive(o.hwnd)&&o.hwnd!==c.app_hwnd);assert.equal(o.process_id,host.process_id);assert.equal(o.app_process_id,host.process_id);
    assert.equal(o.app_hwnd,c.app_hwnd);assert.equal(o.root_owner_hwnd,c.app_hwnd);
    assert.equal(p.dialog_dismissed,true);assert.equal(p.app_enabled,true);assert.equal(p.owned_popup_visible,false);assert.equal(p.app_foreground,true);assert.equal(p.foreground_hwnd,c.app_hwnd);
    assert.equal(typeof p.dialog_exists,'boolean');assert.equal(p.dialog_visible,false);assert.ok(Number.isSafeInteger(p.elapsed_ms)&&p.elapsed_ms>=0&&p.elapsed_ms<=10000);
    assert.ok(['native_ComboBoxEx32_edit','UIA_ValuePattern'].includes(result.filename_entry_method));
    if(result.filename_entry_method==='native_ComboBoxEx32_edit'){
      const edit=result.filename_native_edit;assert.ok(edit&&positive(edit.hwnd));assert.equal(edit.process_id,host.process_id);assert.equal(edit.class,'Edit');
      for(const key of ['host_descendant','enabled','visible','exact_readback'])assert.equal(edit[key],true);assert.equal(edit.read_only,false);assert.equal(edit.entry_method,'WM_SETTEXT');
    }
  }
  return c.app_hwnd;
}
// Keep the full document click trace. Native Windows observes one legitimate
// import-button -> hidden score-file delegation; detached export anchors do not
// bubble through document. No other secondary or untrusted click is admitted.
export function validateNativeSkinControlClicks(row,pickerObservations=[]){
  assert.ok(Array.isArray(row.clicks));const first=row.clicks[0];assert.ok(first&&(first.id===null||typeof first.id==='string'));
  assert.deepEqual(first,{sequence:row.sequence,id:first.id,owned:true,trusted:true},'Primary click must be the trusted owned target');
  if(row.kind==='picker'&&row.id==='import-button'){
    assert.equal(row.request.file,NATIVE_SKIN_FILES.score);const picker=pickerObservations.find(p=>p.sequence===row.sequence);
    assert.ok(picker&&picker.filename===NATIVE_SKIN_FILES.score&&picker.completed===true,'Hidden input forwarding must bind the completed original score picker');
    assert.deepEqual(picker.delegatedClicks,[{type:'click',trusted:false,id:'score-file',sequence:row.sequence,originalControl:true}]);
    assert.deepEqual(row.clicks,[{sequence:row.sequence,id:'import-button',owned:true,trusted:true},{sequence:row.sequence,id:'score-file',owned:false,trusted:false}]);
  }else assert.equal(row.clicks.length,1,'Only the original score picker may forward a document click');
}
export function validateNativeSkinRecord(record,selected){
  const f=nativeSkinFixture();
  assert.deepEqual(record,{version:1,selected,manifest:f.skin.json.toString(),resources:[['assets/checker.png',Array.from(f.skin.png)]]},'Committed selection and exact manifest/PNG must survive the same profile');
}
function settings(value,selected,{empty=false}={}){
  assert.equal(value.selected,selected);assert.equal(value.choice,selected);assert.equal(value.busy,'false');
  assert.equal(value.active,selected==='imported'?nativeSkinFixture().skin.manifest.id:null);assert.equal(value.importedDisabled,empty);
}
export function validateNativeSkinProfiles(native,profiles){
  assert.equal(native.profile_reused,true);assert.deepEqual(native.phases.map(row=>row.phase),NATIVE_SKIN_PHASES);
  assert.equal(new Set(native.phases.map(row=>row.process_id)).size,3,'Every round must use a distinct Windows process');
  assert.match(native.directory,/^(?:[A-Za-z]:[\\/]|\/)(?!\/)/);assert.match(native.directory,/[\\/]Scores$/);
  const expected=native.directory.replaceAll('\\','/').replace(/\/Scores$/,'')+'/webview-profiles/skin-seed';
  assert.ok(expected.split('/').every(part=>!['.','..'].includes(part)),'Aliased profile path');
  for(const [i,row]of native.phases.entries()){
    const profile=profiles[i];assert.ok(Number.isSafeInteger(row.process_id)&&row.process_id>0);
    assert.equal(row.launched_new_process,true);assert.equal(row.normal_close,true);assert.equal(row.renderer_ok,true);assert.equal(row.renderer_origin,origin);
    assert.equal(row.executable_tcp_listeners,0);assert.equal(row.profile_directory.replaceAll('\\','/'),expected);
    assert.equal(row.profile_absent_before_launch,i===0);assert.equal(row.profile_fresh,i===0);assert.equal(row.profile_reused,i>0);
    assert.deepEqual(profile,{version:1,phase:row.phase,process_id:row.process_id,profile_directory:row.profile_directory,library_directory:native.directory,fresh_required:i===0,created_new:i===0});
  }
}
export function validateNativeSkinPicker(row,id,filename){
  assert.equal(row.id,id);assert.equal(row.filename,filename);assert.ok(Number.isSafeInteger(row.sequence)&&row.sequence>0&&row.sequence<=64);
  assert.deepEqual(row.events.map(e=>e.type),['pointerdown','pointerup','click','input','change']);
  for(const e of row.events)assert.deepEqual(e,{type:e.type,trusted:true,sequence:row.sequence,id,tag:'INPUT',typeAttribute:'file',disabled:false,connected:true,multiple:false,dialog:'settings-dialog',modal:true,filename:['input','change'].includes(e.type)?filename:null,fileCount:['input','change'].includes(e.type)?1:null});
}
export function validateNativeSkinRenderer(report){
  assert.equal(report.version,1);assert.equal(report.ok,true,report.error);assert.equal(report.stage,'complete');assert.equal(report.origin,origin);
  assert.ok(NATIVE_SKIN_PHASES.includes(report.phase));assert.equal(report.originalFixturesOnly,true);assert.equal(report.physicalAudio,false);
  assert.deepEqual(report.errors,[]);assert.equal(report.fetchRestored,true);assert.ok(Number.isSafeInteger(report.actions)&&report.actions>0&&report.actions<=64);
  assert.equal(report.controlActions.length,report.actions);assert.match(report.key,/^song-[a-f0-9]{64}$/);
  const f=nativeSkinFixture(),round=report.round;assert.equal(report.opened.score_json,f.files.get(NATIVE_SKIN_FILES.score).toString());
  assert.equal(report.inventory.entries.length,1);assert.equal(report.inventory.entries[0].key,report.key);
  assert.deepEqual(report.skinRequests,[],'Skin, reset and export must not recompile, save or assess the source');
  const initial=report.phase==='skin-restart'?'imported':'default',final=report.phase==='skin-seed'?'imported':'default';
  settings(round.initial,initial,{empty:report.phase==='skin-seed'});settings(round.final,final);
  if(report.phase==='skin-seed')assert.equal(round.storedInitial,null);else validateNativeSkinRecord(round.storedInitial,initial);
  validateNativeSkinRecord(round.storedFinal,final);assert.deepEqual(round.after,round.before,'Skin controls must preserve exact paused stage, input, theme and geometry');
  const b=round.before;assert.equal(b.screen,'stage');assert.equal(b.clock.phase,'paused');assert.equal(b.clock.running,false);assert.equal(b.clock.available,true);assert.equal(b.clock.durationMs,64000);
  assert.ok(b.clock.positionMs>0&&b.clock.positionMs<64000);assert.equal(b.captured,'1');assert.equal(b.sameKeyNodes,true);
  assert.equal(round.initial.theme,b.theme);assert.equal(round.final.theme,b.theme);
  const g=b.geometry;assert.ok(g.viewport.width>=900&&g.viewport.width<=1280&&g.viewport.height>=640&&g.viewport.height<=720);
  assert.ok(g.keys.length>=49);assert.equal(new Set(g.keys.map(k=>k.midi)).size,g.keys.length);
  for(const key of ['canvas','keyboard','transport']){const r=g[key];for(const n of Object.values(r))assert.ok(Number.isFinite(n));assert.ok(r.width>0&&r.height>0&&r.x>=-1&&r.y>=-1&&r.x+r.width<=g.viewport.width+1&&r.y+r.height<=g.viewport.height+1);}
  const seed=report.phase==='skin-seed';validateOwnedFilePickers(report.pickerObservations,report.pickerFileEvents,seed?[NATIVE_SKIN_FILES.score]:[]);
  assert.equal(report.skinPickers.length,seed?2:0);
  if(seed){validateNativeSkinPicker(report.skinPickers[0],'skin-manifest',NATIVE_SKIN_FILES.manifest);validateNativeSkinPicker(report.skinPickers[1],'skin-image',NATIVE_SKIN_FILES.image);assert.ok(report.skinPickers[0].sequence<report.skinPickers[1].sequence);}
  for(const [i,row]of report.controlActions.entries()){
    assert.equal(row.sequence,i+1);assert.equal(row.request.sequence,row.sequence);assert.equal(row.kind,row.request.kind);assert.equal(row.disabled,false);
    assert.ok(row.samples.length>=2&&row.samples.length<=5);assert.equal(row.samples.at(-1).hitOwned,true);
    validateNativeSkinControlClicks(row,report.pickerObservations);
    const target=row.samples.at(-1).target;assert.equal(row.request.x,target.x+target.width/2);assert.equal(row.request.y,target.y+target.height/2);
  }
  const controls=report.controlActions.filter(row=>['skin-import','skin-use','skin-reset','skin-manifest','skin-image'].includes(row.id));
  assert.deepEqual(controls.map(row=>[row.kind,row.id]),seed?[['picker','skin-manifest'],['picker','skin-image'],['click','skin-import'],['click','skin-use']]:report.phase==='skin-restart'?[['click','skin-reset']]:[]);
  for(const control of controls)assert.ok(report.trusted.some(e=>e.sequence===control.sequence&&e.id===control.id&&e.type==='click'&&e.trusted));
  const keyEvents=report.trusted.filter(e=>e.code==='KeyR');assert.deepEqual(keyEvents.map(e=>[e.type,e.id,e.trusted]),[['keydown','stage-title',true],['keyup','stage-title',true]]);
  const keyActions=report.controlActions.filter(row=>row.kind==='key-r');assert.equal(keyActions.length,1);
  for(const event of keyEvents){assert.equal(event.sequence,keyActions[0].sequence);assert.equal(event.repeat,false);assert.ok(Number.isFinite(event.eventTime)&&event.eventTime>=0);}
  assert.ok(keyEvents[1].eventTime>=keyEvents[0].eventTime);
  assert.deepEqual(Object.keys(round.files).sort(),['scoreAfter','scoreBefore','takeAfter','takeBefore']);assert.equal(new Set(Object.values(round.files)).size,4);
  return report;
}
export function validateNativeSkinExports(files,report){
  const score=nativeSkinFixture().score;assert.deepEqual(files.scoreBefore,score);assert.deepEqual(files.scoreAfter,score);
  assert.deepEqual(files.takeAfter,files.takeBefore,'Skin changes must preserve the full paused take');
  const take=files.takeBefore;assert.equal(take.score_id,score.id);assert.deepEqual(take.practice_selection,{kind:'parts',part_ids:['human']});assert.equal(take.view_configuration.practice_layout,'complete');
  assert.equal(take.passes.length,1);assert.equal(take.passes[0].inputs.length,1);assert.equal(take.passes[0].inputs[0].midi,60);
  const events=take.input_evidence.events,on=events.filter(e=>e.kind==='note_on'),off=events.filter(e=>e.kind==='note_off');
  assert.equal(on.length,1);assert.equal(off.length,1);assert.equal(on[0].encoding,'key_down');assert.equal(off[0].encoding,'key_up');assert.equal(off[0].source_id,on[0].source_id);
  assert.equal(events.some(e=>e.kind==='synthetic_release'),false);
  if(report){const keys=report.trusted.filter(e=>e.code==='KeyR');assert.equal(on[0].raw_timestamp_ms,keys[0].eventTime);assert.equal(off[0].raw_timestamp_ms,keys[1].eventTime);}
  return files;
}
export async function verifyNativeSkinEvidence(directory,{sourceRoot,sourceSha,sourceTree,executable}={}){
  const binding=await nativeSkinSourceBinding(sourceRoot);if(sourceSha)assert.equal(binding.source_sha,sourceSha);if(sourceTree)assert.equal(binding.source_tree,sourceTree);
  const root=await lstat(directory);assert.ok(root.isDirectory()&&!root.isSymbolicLink());const files=[];let total=0;
  async function read(name,limit=1024*1024){
    assert.ok(typeof name==='string'&&!/[\\:\0\r\n]/.test(name)&&name.split('/').every(part=>part&&!['.','..'].includes(part)&&!part.startsWith('webview-')));
    let path=directory;for(const part of name.split('/')){path=join(path,part);assert.equal((await lstat(path)).isSymbolicLink(),false);}
    const stat=await lstat(path);assert.ok(stat.isFile()&&stat.size>0&&stat.size<=limit,`Unbounded evidence ${name}`);const bytes=await readFile(path);assert.equal(bytes.length,stat.size);
    total+=bytes.length;assert.ok(total<=128*1024*1024);files.push({path:name,bytes:bytes.length,sha256:sha256(bytes)});return bytes;
  }
  const json=async(name,limit)=>JSON.parse((await read(name,limit)).toString().replace(/^\uFEFF/,''));
  const native=await json('native-skin.json');assert.equal(native.ok,true,native.error);assert.equal(native.scenario,'skin');
  for(const key of ['source_sha','source_tree','source_hashes'])assert.deepEqual(native[key],binding[key],`Frozen skin ${key} changed`);
  assert.ok(executable,'Independent native executable required');const stat=await lstat(executable);assert.ok(stat.isFile()&&!stat.isSymbolicLink()&&stat.size>0&&stat.size<256*1024*1024);
  const binary=await readFile(executable);assert.equal(native.executable_sha256,sha256(binary));assert.equal(native.executable_bytes,binary.length);
  const profiles=await Promise.all(NATIVE_SKIN_PHASES.map(phase=>json(`profile-${phase}.json`,8192)));validateNativeSkinProfiles(native,profiles);
  const fixture=nativeSkinFixture();assert.deepEqual(await json('fixtures/native-skin-fixtures.json'),plain(fixture.manifest));for(const[name,bytes]of fixture.files)assert.deepEqual(await read(`fixtures/${name}`),bytes);
  let key=null,snapshotBefore=null;
  for(const [i,phase]of NATIVE_SKIN_PHASES.entries()){
    const r=validateNativeSkinRenderer(await json(`renderer-${phase}.json`));assert.equal(r.phase,phase);if(key)assert.equal(r.key,key);key=r.key;assert.equal(native.phases[i].actions,r.actions);
    const actions=[];let appWindow=null;
    for(let n=1;n<=r.actions;n++){
      const action=await json(`action-${phase}-${n}.json`,64*1024),result=await json(`result-${phase}-${n}.json`,64*1024);actions.push(action);
      assert.deepEqual(action,r.controlActions[n-1].request);appWindow=validateNativeSkinHostAction(action,result,native.phases[i],appWindow);
      validateCleanScreenshot(await read(`native-action-${phase}-${n}.png`,16*1024*1024));
    }
    assert.deepEqual(actions.filter(a=>a.kind==='picker').map(a=>[a.sequence,a.file]),[...r.pickerObservations,...r.skinPickers].sort((a,b)=>a.sequence-b.sequence).map(p=>[p.sequence,p.filename]));
    const exports={};for(const[name,file]of Object.entries(r.round.files)){assert.match(file,new RegExp(`^${phase}-(?:[1-9]|1[0-6])\\.json$`));exports[name]=await json(`downloads/${file}`);}validateNativeSkinExports(exports,r);
    const snapshot=await json(`snapshot-${phase}.json`);assert.equal(snapshot.version,1);
    const expected=['songs','backups'].flatMap(area=>['metadata.json','score.json','source.payload'].map(name=>`${area}/${key}/${name}`));assert.deepEqual(snapshot.files.map(row=>row.path).sort(),expected.sort());
    if(snapshotBefore)assert.deepEqual(snapshot,snapshotBefore,'Skin rounds changed source archive or backup bytes');snapshotBefore=snapshot;
    for(const row of snapshot.files){const bytes=await read(`Scores/${row.path}`);assert.equal(bytes.length,row.bytes);assert.equal(sha256(bytes),row.sha256);}
    for(const area of ['songs','backups']){assert.deepEqual(await read(`Scores/${area}/${key}/score.json`),fixture.files.get(NATIVE_SKIN_FILES.score));assert.equal((await read(`Scores/${area}/${key}/source.payload`)).toString(),fixture.score.source.content);assert.deepEqual(await json(`Scores/${area}/${key}/metadata.json`),r.opened.entry);}
    validateCleanScreenshot(await read(`native-${phase}.png`,16*1024*1024));await json(`trace-${phase}.json`);
  }
  return{version:1,ok:true,scenario:'skin',...binding,executable_sha256:sha256(binary),executable_bytes:binary.length,phases:[...NATIVE_SKIN_PHASES],
    claims:{actual_app:true,native_window:true,same_profile_restart:true,selected_restart:true,default_restart:true,exact_manifest_and_png:true,original_source_and_take_preserved:true,physical_audio:false,manual_device:false,private_music:false,full_acceptance:false},files:uniqueCanonicalEvidenceFiles(files)};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
  const check=process.argv[2]==='--check',directory=resolve(process.argv[check?3:2]);const proof=await verifyNativeSkinEvidence(directory,{sourceSha:process.env.WMH_SOURCE_SHA,sourceTree:process.env.WMH_SOURCE_TREE,executable:process.env.WMH_SKIN_EXECUTABLE});
  if(check)assert.deepEqual(JSON.parse(await readFile(join(directory,'native-skin-proof.json'),'utf8')),proof);else await writeFile(join(directory,'native-skin-proof.json'),JSON.stringify(proof,null,2)+'\n');
  console.log(JSON.stringify({ok:true,source_sha:proof.source_sha,files:proof.files.length}));
}
