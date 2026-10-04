import {addNativeProfileEvidence,assertNativeProfileEvidence} from './native-profile-evidence-fixtures.js';
import {verifyNativeProfileEvidence} from '../scripts/native-profile-evidence.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,rm,symlink} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {fileURLToPath} from 'node:url';
import {verifyNativeSongFolderEvidence,folderFixtureContentHash,SONG_FOLDER_PHASES,SONG_FOLDER_CHECKS} from '../scripts/verify-native-song-folder-evidence.mjs';

const hash=value=>createHash('sha256').update(value).digest('hex'),run=promisify(execFile);
const KEYS=['song-bb8051fad28349e6f49786f8a691421d297e81677abe984dbb340cb934ea1127','song-59713d099a383cc6736ab7c7b9f4822faf68b850b67a276a5b1fdf1694911f08'];
const script=fileURLToPath(new URL('../scripts/verify-native-song-folder-evidence.mjs',import.meta.url));
const clone=structuredClone;

// Independently authored observations only. These tests launch Node, never a
// GUI, WebView, browser, native executable or server, and never claim acceptance.
function take(){
  const input={midi:60,velocity:90,at_ms:150};
  return{version:1,score_id:'native-folder-original-exercise',passes:[{id:1,capture_enabled:true,inputs:[input],
    captures:[{event_id:1,event_wall_ms:1150,received_wall_ms:1151,input:{...input}}],
    assessment:{hits:[{note_id:'folder-c',input_index:0}],misses:[],extra_inputs:[]},clock_segments:[{wallStart:1000,wallEnd:1300,positionStart:0}]}],
    input_evidence:{version:1,truncated:false,omitted_observations:0,events:[{event_id:1,kind:'note_on',source_id:'keyboard-r',input_kind:'typing_keyboard',encoding:'key_down',midi:60,velocity:90,event_wall_ms:1150,received_wall_ms:1151,onset_capture:{pass_id:1,event_id:1}}]}};
}
function transport(){
  const state={passId:'1',captured:'1',cue:'paused',phase:'paused',hidden:false,openDialogs:[],positionMs:300,durationMs:8000};
  const event=(type,extra)=>({type,trusted:true,repeat:false,...extra});
  return{version:1,stage:'complete',omitted:0,rowBytes:3000,trustedPlayClicks:2,trustedKeyDowns:1,trustedKeyUps:1,current:state,rows:[
    {kind:'ready',elapsedMs:0,state:{...state,positionMs:0,captured:'0'}},
    {kind:'event',elapsedMs:10,state:{...state},event:event('click',{control:'play-button'})},
    {kind:'await-transport-start',elapsedMs:20,state:{...state,phase:'capturing',positionMs:100}},
    {kind:'event',elapsedMs:30,state:{...state},event:event('keydown',{code:'KeyR',surface:'stage-title'})},
    {kind:'event',elapsedMs:40,state:{...state},event:event('keyup',{code:'KeyR',surface:'stage-title'})},
    {kind:'event',elapsedMs:50,state:{...state},event:event('click',{control:'play-button'})},
  ]};
}
async function evidence(t){
  const directory=await mkdtemp(join(tmpdir(),'wmh-folder-verifier-'));t.after(()=>rm(directory,{recursive:true,force:true}));
  await mkdir(join(directory,'Scores','.staging'),{recursive:true});await mkdir(join(directory,'downloads'));
  const fixtures=await Promise.all(['original','conflict'].map(async(name,index)=>{
    const bytes=await readFile(new URL(`./fixtures/folder-${name}.json`,import.meta.url)),score=JSON.parse(bytes);
    const source=Buffer.from(score.source.content),key=KEYS[index];
    const entry={library_format_version:1,revision:1,key,content_sha256:key.slice(5),score_sha256:hash(bytes),score_bytes:bytes.length,
      score_id:score.id,title:score.title,composer:score.composer,label:score.title,saved_at_unix_ms:1700000000000+index,
      provenance:score.provenance,retained_source:{format:score.source.format,filename:score.source.filename,bytes:source.length,sha256:hash(source)}};
    return{bytes,score,source,key,entry};
  }));
  const snapshots=[];
  for(const area of ['songs','backups'])for(const f of fixtures){
    await mkdir(join(directory,'Scores',area,f.key),{recursive:true});
    for(const [name,bytes]of [['metadata.json',Buffer.from(JSON.stringify(f.entry,null,2))],['score.json',f.bytes],['source.payload',f.source]]){
      const path=`${area}/${f.key}/${name}`;await writeFile(join(directory,'Scores',path),bytes);snapshots.push({path,sha256:hash(bytes),bytes:bytes.length});
    }
  }
  const inventory=fixtures.map(f=>f.entry).sort((a,b)=>a.key.localeCompare(b.key));
  const phases=SONG_FOLDER_PHASES.map((phase,index)=>({phase,process_id:100+index,renderer_ok:true,renderer_origin:'https://wmh.localhost',normal_close:true,executable_tcp_listeners:0,
    launched_new_process:true,profile_fresh:true,profile_reused:false,actions:index===0?6:index===1?3:1}));
  const native={version:1,ok:true,source_sha:'1'.repeat(40),source_tree:'2'.repeat(40),executable_sha256:'3'.repeat(64),directory:join(directory,'Scores'),phases};
  const reports=Object.fromEntries(SONG_FOLDER_PHASES.map((phase,index)=>[phase,{version:1,ok:true,phase,origin:'https://wmh.localhost',profileMarkerAbsent:true,actions:phases[index].actions,
    checks:[...SONG_FOLDER_CHECKS[phase]],openedScoreDatabases:[],errors:[],saveResults:[],downloads:[]} ]));
  Object.assign(reports['folder-seed'],{inventory:clone(inventory),directory:native.directory,saveResults:[
    {status:200,code:null,key:KEYS[0],allowConflictingId:false},{status:409,code:'library_duplicate',key:KEYS[0],allowConflictingId:false},
    {status:409,code:'library_id_conflict',key:KEYS[0],allowConflictingId:false},{status:200,code:null,key:KEYS[1],allowConflictingId:true},
  ]});
  Object.assign(reports['folder-restart'],{inventory:clone(inventory),directory:native.directory,audition:{sourceStarts:2,activeSources:0,pendingSources:0},transportAdmission:transport(),files:{beforeScore:'folder-restart-1.json',beforeTake:'folder-restart-2.json',afterScore:'folder-restart-3.json',afterTake:'folder-restart-4.json'}});
  const restart=reports['folder-restart'];restart.downloads=Object.values(restart.files).map(file=>({file,complete:true,success:true}));
  Object.assign(reports['folder-failure'],{persistence:'not-saved',saveResults:[{status:422,code:'library_unsafe_path',key:null,allowConflictingId:false}]});
  const values={beforeScore:fixtures[0].score,afterScore:clone(fixtures[0].score),beforeTake:take(),afterTake:take()};
  async function saveJson(path,value){await writeFile(join(directory,path),JSON.stringify(value,null,2)+'\n');}
  async function writeReport(phase){await saveJson(`renderer-${phase}.json`,reports[phase]);}
  async function writeExport(role,value=values[role]){await saveJson(`downloads/${restart.files[role]}`,value);}
  const definitions={
    'folder-seed':[['picker','folder-original.json'],['picker','folder-original.json'],['picker','folder-conflict.json'],['click'],['cancel-picker'],['picker','malformed.json']],
    'folder-restart':[['click'],['key-r'],['click']],
    'folder-failure':[['picker','folder-original.json']],
  };
  for(const phase of SONG_FOLDER_PHASES){
    for(const [index,[kind,file]]of definitions[phase].entries()){
      const sequence=index+1,process=phases.find(row=>row.phase===phase).process_id;
      const action={version:1,sequence,kind,x:10,y:20,width:1024,height:768,...(file?{file}:{})};
      const result={ok:true,...(['picker','cancel-picker'].includes(kind)?{
        owned_dialog:{hwnd:2,class:'#32770',process_id:process,app_process_id:process,app_hwnd:1,root_owner_hwnd:1},
        picker_completion:{dialog_dismissed:true,app_enabled:true,owned_popup_visible:false},
      }:{})};
      await saveJson(`action-${phase}-${sequence}.json`,action);await saveJson(`result-${phase}-${sequence}.json`,result);
    }
    await saveJson(`snapshot-${phase}.json`,{version:1,files:snapshots});await writeReport(phase);
  }
  for(const role of Object.keys(values))await writeExport(role);
  await addNativeProfileEvidence(native,saveJson);await saveJson('native-song-folder.json',native);
  return{directory,native,reports,fixtures,snapshots,values,saveJson,writeReport,writeExport};
}

test('verifies exact disk bytes, all backups, snapshots, native picker results and unchanged typed exports',async t=>{
  const f=await evidence(t),proof=await verifyNativeSongFolderEvidence(f.directory);
  assert.equal(proof.ok,true);assert.equal(proof.entry_count,2);assert.equal(proof.typing_note_on_count,1);assert.equal(proof.scored_input_count,1);
  assert.equal(proof.files.filter(row=>row.path.startsWith('Scores/')).length,12);
  assert.equal(proof.files.filter(row=>row.path.startsWith('downloads/')).length,4);
  assert.equal(proof.files.length,42);
  for(const row of proof.files){const bytes=await readFile(join(f.directory,row.path));assert.equal(row.sha256,hash(bytes));assert.equal(row.bytes,bytes.length);}
  assert.equal(proof.native_report_sha256,hash(await readFile(join(f.directory,'native-song-folder.json'))));
  for(const phase of SONG_FOLDER_PHASES)assert.equal(proof.renderer_sha256[phase],hash(await readFile(join(f.directory,`renderer-${phase}.json`))));
});

test('fixture identity encodes native Rust f64 and rejects implicit schema/default drift',async t=>{
  const f=await evidence(t);
  for(const [index,fixture]of f.fixtures.entries()){
    assert.equal(folderFixtureContentHash(fixture.score),KEYS[index].slice(5));
    assert.notEqual(hash(JSON.stringify(fixture.score)),KEYS[index].slice(5));
    const changed=clone(fixture.score);delete changed.parts[0].notes[0].tie_start;
    assert.throws(()=>folderFixtureContentHash(changed),/note schema/);
  }
});

test('host process continuity, ordered phases, fresh profiles and renderer success fail closed',async t=>{
  const f=await evidence(t),original=clone(f.native);
  const edits=[value=>value.ok='true',value=>value.source_sha+='\n',value=>value.phases.reverse(),value=>value.phases[1].launched_new_process=false,
    value=>value.phases[1].profile_fresh=false,value=>value.phases[1].profile_reused=true,value=>value.phases[2].normal_close=false,value=>value.phases[0].executable_tcp_listeners=1,value=>value.phases[0].actions=65];
  for(const edit of edits){const value=clone(original);edit(value);await f.saveJson('native-song-folder.json',value);await assert.rejects(verifyNativeSongFolderEvidence(f.directory),/Native|native/);}
  await f.saveJson('native-song-folder.json',original);
  for(const edit of [value=>value.ok=false,value=>value.origin='http://localhost',value=>value.actions++,value=>value.profileMarkerAbsent=false,value=>value.openedScoreDatabases=['worldmusichub.scores.v1'],value=>value.errors=['script error'],value=>value.checks=[]]){
    const value=clone(f.reports['folder-restart']);edit(value);await f.saveJson('renderer-folder-restart.json',value);await assert.rejects(verifyNativeSongFolderEvidence(f.directory),/Renderer|Missing native/);
  }
});

test('native action evidence requires bounded ordering and actual picker process ownership/completion',async t=>{
  const f=await evidence(t),path='result-folder-seed-1.json',original=JSON.parse(await readFile(join(f.directory,path),'utf8'));
  for(const edit of [value=>value.ok=false,value=>delete value.owned_dialog,value=>value.owned_dialog.process_id=999,value=>value.owned_dialog.root_owner_hwnd=999,value=>value.picker_completion.dialog_dismissed=false,value=>value.picker_completion.owned_popup_visible=true]){
    const value=clone(original);edit(value);await f.saveJson(path,value);await assert.rejects(verifyNativeSongFolderEvidence(f.directory),/Native folder-seed/);
  }
  await f.saveJson(path,original);await f.saveJson('action-folder-seed-7.json',{version:1,sequence:7,kind:'click'});
  await assert.rejects(verifyNativeSongFolderEvidence(f.directory),/bounded and sequential/);
  await rm(join(f.directory,'action-folder-seed-7.json'));
  const action=JSON.parse(await readFile(join(f.directory,'action-folder-seed-3.json'),'utf8'));action.file='../../outside.json';
  await f.saveJson('action-folder-seed-3.json',action);await assert.rejects(verifyNativeSongFolderEvidence(f.directory),/picker fixture is unexpected/);
});

test('archive score formatting, retained payload, metadata and backup bytes cannot be substituted',async t=>{
  const f=await evidence(t),key=KEYS[0];
  const paths=[`Scores/songs/${key}/score.json`,`Scores/songs/${key}/source.payload`,`Scores/backups/${key}/metadata.json`];
  for(const path of paths){
    const original=await readFile(join(f.directory,path));
    if(path.endsWith('/score.json'))await writeFile(join(f.directory,path),JSON.stringify(JSON.parse(original)));
    else if(path.endsWith('/source.payload'))await writeFile(join(f.directory,path),original.toString().replaceAll('\r\n','\n'));
    else await writeFile(join(f.directory,path),Buffer.concat([original,Buffer.from('\n')]));
    await assert.rejects(verifyNativeSongFolderEvidence(f.directory),/exact authored fixture bytes|exact retained source|byte-identical/);
    await writeFile(join(f.directory,path),original);
  }
  const metadataPath=`Scores/songs/${key}/metadata.json`,metadata=JSON.parse(await readFile(join(f.directory,metadataPath),'utf8'));metadata.score_sha256='0'.repeat(64);
  await f.saveJson(metadataPath,metadata);await assert.rejects(verifyNativeSongFolderEvidence(f.directory),/metadata does not describe/);
});

test('inventory, snapshots, unlisted directories and unrestored failure blocker reject false immutability',async t=>{
  const f=await evidence(t);
  f.reports['folder-restart'].directory=join(f.directory,'other','Scores');await f.writeReport('folder-restart');await assert.rejects(verifyNativeSongFolderEvidence(f.directory),/archive directory differs/);
  f.reports['folder-restart'].directory=f.native.directory;await f.writeReport('folder-restart');
  f.reports['folder-restart'].inventory[0].label+='changed';await f.writeReport('folder-restart');await assert.rejects(verifyNativeSongFolderEvidence(f.directory),/restart changed native inventory/);
  f.reports['folder-restart'].inventory=clone(f.reports['folder-seed'].inventory);await f.writeReport('folder-restart');
  const rows=clone(f.snapshots);rows[0].sha256='0'.repeat(64);await f.saveJson('snapshot-folder-failure.json',{version:1,files:rows});
  await assert.rejects(verifyNativeSongFolderEvidence(f.directory),/snapshot does not match exact unchanged archive bytes/);
  await f.saveJson('snapshot-folder-failure.json',{version:1,files:f.snapshots});
  await mkdir(join(f.directory,'Scores','songs','unlisted'));await assert.rejects(verifyNativeSongFolderEvidence(f.directory),/unlisted directories/);await rm(join(f.directory,'Scores','songs','unlisted'),{recursive:true});
  await rm(join(f.directory,'Scores','.staging'),{recursive:true});await writeFile(join(f.directory,'Scores','.staging'),'blocked');
  await assert.rejects(verifyNativeSongFolderEvidence(f.directory),/directory must be ordinary/);
});

test('duplicate/conflict/Keep both native responses and failed-save no-fallback outcome are mandatory',async t=>{
  const f=await evidence(t),seed=clone(f.reports['folder-seed']),failure=clone(f.reports['folder-failure']);
  for(const edit of [value=>value.saveResults[1].status=200,value=>value.saveResults[2].code='library_duplicate',value=>value.saveResults[3].allowConflictingId=false,value=>value.saveResults.pop()]){
    const value=clone(seed);edit(value);await f.saveJson('renderer-folder-seed.json',value);await assert.rejects(verifyNativeSongFolderEvidence(f.directory),/Seed native save responses/);
  }
  await f.saveJson('renderer-folder-seed.json',seed);
  for(const edit of [value=>value.persistence='saved',value=>value.saveResults[0].status=200,value=>value.saveResults[0].code='library_duplicate',value=>value.saveResults[0].key=KEYS[0]]){
    const value=clone(failure);edit(value);await f.saveJson('renderer-folder-failure.json',value);await assert.rejects(verifyNativeSongFolderEvidence(f.directory),/explicit unsaved storage failure/);
  }
});

test('transport claims cannot replace trusted observations, genuine routed captures, or positive audio',async t=>{
  const f=await evidence(t),restart=clone(f.reports['folder-restart']);
  for(const edit of [value=>value.audition.sourceStarts=0,value=>value.audition.pendingSources=1,value=>value.transportAdmission.stage='transport-start',
    value=>value.transportAdmission.omitted=1,value=>value.transportAdmission.rows[1].event.trusted=false,value=>value.transportAdmission.rows[2].state.positionMs=0,
    value=>value.transportAdmission.rows[3].event.code='KeyC']){
    const value=clone(restart);edit(value);await f.saveJson('renderer-folder-restart.json',value);await assert.rejects(verifyNativeSongFolderEvidence(f.directory),/audition|Native transport/);
  }
  await f.saveJson('renderer-folder-restart.json',restart);
  for(const edit of [value=>value.passes[0].inputs=[],value=>value.input_evidence.truncated=true,value=>value.input_evidence.events[0].onset_capture.pass_id=2,
    value=>value.passes[0].captures[0].input.midi=61,value=>value.passes[0].captures.push(clone(value.passes[0].captures[0]))]){
    const value=clone(f.values.beforeTake);edit(value);await f.writeExport('beforeTake',value);await f.writeExport('afterTake',value);
    await assert.rejects(verifyNativeSongFolderEvidence(f.directory),/Before take|Typing keyboard/);
  }
});

test('score and take roles need distinct successful downloads and exact unchanged content',async t=>{
  const f=await evidence(t),restart=clone(f.reports['folder-restart']);
  for(const edit of [value=>value.files.beforeScore='../outside.json',value=>value.files.afterTake=value.files.beforeTake,value=>value.downloads[0].success=false]){
    const value=clone(restart);edit(value);await f.saveJson('renderer-folder-restart.json',value);await assert.rejects(verifyNativeSongFolderEvidence(f.directory),/filename|distinct|download/);
  }
  await f.saveJson('renderer-folder-restart.json',restart);
  const score=clone(f.values.afterScore);score.source.content+='\n';await f.writeExport('afterScore',score);await assert.rejects(verifyNativeSongFolderEvidence(f.directory),/Canonical score changed/);await f.writeExport('afterScore');
  const value=clone(f.values.afterTake);value.passes[0].assessment.hits=[];await f.writeExport('afterTake',value);await assert.rejects(verifyNativeSongFolderEvidence(f.directory),/Scored take changed/);
});

test('evidence symlinks are rejected even when the target bytes are valid',{skip:process.platform==='win32'?'Windows symlink creation requires separate privilege':false},async t=>{
  const f=await evidence(t),source=join(f.directory,'Scores','songs',KEYS[0],'score.json'),backup=join(f.directory,'Scores','backups',KEYS[0],'score.json');
  await rm(backup);await symlink(source,backup);await assert.rejects(verifyNativeSongFolderEvidence(f.directory),/ordinary without links/);
});

test('CLI writes a rederived proof; --check preserves bytes, rejects tampering, and failed generation removes stale success',async t=>{
  const f=await evidence(t),output=join(f.directory,'native-song-folder-files.json');
  const {stdout}=await run(process.execPath,[script,f.directory]);assert.match(stdout,/Verified two native song archives/);
  const proof=JSON.parse(await readFile(output,'utf8')),stored=Buffer.from(JSON.stringify(proof)+'\n\n');await writeFile(output,stored);
  for(const args of [['--check',f.directory],[f.directory,'--check']]){const result=await run(process.execPath,[script,...args]);assert.match(result.stdout,/stored proof matches/);assert.deepEqual(await readFile(output),stored);}
  const hostPath=join(f.directory,'profile-folder-restart.json'),hostBytes=await readFile(hostPath);await writeFile(hostPath,Buffer.concat([hostBytes,Buffer.from('\n')]));
  await assert.rejects(run(process.execPath,[script,'--check',f.directory]),error=>error.code===1&&/Stored native song-folder proof differs/.test(error.stderr));await writeFile(hostPath,hostBytes);
  const changed=clone(proof);changed.typing_note_on_count=99;await writeFile(output,JSON.stringify(changed));
  await assert.rejects(run(process.execPath,[script,'--check',f.directory]),error=>error.code===1&&/Stored native song-folder proof differs/.test(error.stderr));
  assert.deepEqual(JSON.parse(await readFile(output,'utf8')),changed);
  await writeFile(join(f.directory,'Scores','songs',KEYS[0],'source.payload'),'corrupted');
  await assert.rejects(run(process.execPath,[script,f.directory]),error=>error.code===1&&/exact retained source/.test(error.stderr));
  await assert.rejects(readFile(output),{code:'ENOENT'});
});

test('song-folder requires distinct phase profiles and matching fresh host records in the hashed proof',async t=>{
 const f=await evidence(t);await assertNativeProfileEvidence({directory:f.directory,native:f.native,save:f.saveJson,verify:verifyNativeSongFolderEvidence,nativeFile:'native-song-folder.json'});
});

test('profile evidence verifies recorded Windows paths after artifact relocation without accepting path aliases',async()=>{
 const phases=['folder-seed','folder-restart','folder-failure'],root='C:\\hosted runner\\native-folder',native={directory:`${root}\\Scores`,phases:phases.map((phase,index)=>({phase,process_id:100+index,profile_directory:`${root}\\webview-profiles\\${phase}`,profile_fresh:true,profile_reused:false,profile_absent_before_launch:true}))};
 const records=Object.fromEntries(native.phases.map(row=>[`profile-${row.phase}.json`,{version:1,phase:row.phase,process_id:row.process_id,profile_directory:row.profile_directory,library_directory:native.directory,fresh_required:true,created_new:true}])),reads=[];
 const read=async(path,limit)=>{reads.push(path);assert.equal(limit,16*1024);return records[path];};
 await verifyNativeProfileEvidence(native,phases,read);assert.deepEqual(reads,phases.map(phase=>`profile-${phase}.json`));
 for(const path of ['C:relative\\Scores','C:\\root\\..\\native-folder\\Scores','C:\\root\\.\\Scores','C:\\root\\\\Scores','C:\\root\\Scores\\','relative\\Scores']){
  await assert.rejects(verifyNativeProfileEvidence({...native,directory:path},phases,read),/absolute without aliases/);
 }
 records['profile-folder-seed.json'].profile_directory=native.phases[0].profile_directory.replaceAll('\\','/');
 await assert.rejects(verifyNativeProfileEvidence(native,phases,read),/host directory differs/);
});
