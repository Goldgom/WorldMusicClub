import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFile,writeFile,rm,symlink} from 'node:fs/promises';
import {dirname,join} from 'node:path';

// Synthetic host observations only: no profile, WebView or native process is
// created. Their purpose is to test the independent evidence consumers.
export async function addNativeProfileEvidence(native,save){
  for(const row of native.phases){
    row.profile_directory=join(dirname(native.directory),'webview-profiles',row.phase);
    row.profile_absent_before_launch=true;
    await save(`profile-${row.phase}.json`,{version:1,phase:row.phase,process_id:row.process_id,
      profile_directory:row.profile_directory,library_directory:native.directory,fresh_required:true,created_new:true});
  }
}

export async function assertNativeProfileEvidence({directory,native,save,verify,nativeFile}){
  const proof=await verify(directory),phases=native.phases.map(row=>row.phase),first=phases[0],second=phases[1];
  assert.deepEqual(proof.files.filter(row=>/^profile-.*\.json$/.test(row.path)).map(row=>row.path).sort(),phases.map(phase=>`profile-${phase}.json`).sort());
  for(const phase of phases){
    const path=`profile-${phase}.json`,bytes=await readFile(join(directory,path)),row=proof.files.find(row=>row.path===path);
    assert.equal(row.sha256,createHash('sha256').update(bytes).digest('hex'));assert.equal(row.bytes,bytes.length);
  }
  assert.ok(!proof.files.some(row=>row.path.startsWith('webview-profiles/')),'Profile contents must not enter the proof');
  const nativeChanges=[
    ['duplicate phase',value=>value.phases[1].phase=first],
    ['unknown phase',value=>value.phases[1].phase='other-restart'],
    ['duplicate process',value=>value.phases[1].process_id=value.phases[0].process_id],
    ['missing selected directory',value=>delete value.phases[0].profile_directory],
    ['reused directory',value=>value.phases[1].profile_directory=value.phases[0].profile_directory],
    ['wrong phase directory',value=>value.phases[0].profile_directory=value.phases[0].profile_directory.replace(first,second)],
    ['wrong root directory',value=>value.phases[0].profile_directory=join(dirname(native.directory),'other-root','webview-profiles',first)],
    ['relative directory',value=>value.phases[0].profile_directory=`webview-profiles/${first}`],
    ['parent directory alias',value=>value.phases[0].profile_directory+=`/../${first}`],
    ['current directory alias',value=>value.phases[0].profile_directory+=`/./${first}`],
    ['trailing directory separator',value=>value.phases[0].profile_directory+='/'],
    ['profile was reused',value=>value.phases[1].profile_reused=true],
    ['profile was not fresh',value=>value.phases[1].profile_fresh=false],
    ['profile already existed',value=>value.phases[1].profile_absent_before_launch=false],
    ['profile absence omitted',value=>delete value.phases[1].profile_absent_before_launch],
    ['profile absence truthy string',value=>value.phases[1].profile_absent_before_launch='true'],
    ['library root mismatch',value=>value.directory=join(dirname(native.directory),'another-root','Scores')],
    ['relative library root',value=>value.directory='relative/Scores'],
    ['library parent alias',value=>value.directory+='/../Scores'],
  ];
  for(const [label,change]of nativeChanges){
    const value=structuredClone(native);change(value);await save(nativeFile,value);
    await assert.rejects(verify(directory),undefined,label);await save(nativeFile,native);
  }
  // Every phase must supply its own host-authored, bounded ordinary record.
  for(const phase of phases){
    const path=`profile-${phase}.json`,bytes=await readFile(join(directory,path));await rm(join(directory,path));
    await assert.rejects(verify(directory),{code:'ENOENT'},`missing ${phase} host record`);await writeFile(join(directory,path),bytes);
  }
  const path=`profile-${first}.json`,original=JSON.parse(await readFile(join(directory,path),'utf8'));
  const hostChanges=[
    ['host version',value=>value.version=2],['host phase',value=>value.phase=second],
    ['host process',value=>value.process_id=native.phases[1].process_id],
    ['host profile',value=>value.profile_directory=native.phases[1].profile_directory],
    ['host library',value=>value.library_directory=join(dirname(native.directory),'other-root','Scores')],
    ['host fresh required',value=>value.fresh_required=false],['host created new',value=>value.created_new=false],
    ['host fresh flag omitted',value=>delete value.fresh_required],['host creation omitted',value=>delete value.created_new],
    ['host creation truthy string',value=>value.created_new='true'],
  ];
  for(const [label,change]of hostChanges){
    const value=structuredClone(original);change(value);await save(path,value);
    await assert.rejects(verify(directory),/Native .*profile/,label);await save(path,original);
  }
  await writeFile(join(directory,path),' '.repeat(16*1024+1));await assert.rejects(verify(directory),/bound/i);await save(path,original);
  if(process.platform!=='win32'){
    await rm(join(directory,path));await symlink(join(directory,`profile-${second}.json`),join(directory,path));
    await assert.rejects(verify(directory),/ordinary|bounded/i);await rm(join(directory,path));await save(path,original);
  }
}
