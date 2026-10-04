import {verifyNativeProfileEvidence} from './native-profile-evidence.mjs';
import {readFile,writeFile,readdir,lstat,rm} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';

export const SONG_FOLDER_PHASES=Object.freeze(['folder-seed','folder-restart','folder-failure']);
export const SONG_FOLDER_CHECKS=Object.freeze({
  'folder-seed':['actual-picker-import-await-save','disk-save-duplicate-id-conflict-keep-both','canceled-malformed-no-write'],
  'folder-restart':['clean-profile-disk-reload','saved-row-select-audition-activate','menu-free-library-preserves-score-take'],
  'folder-failure':['failed-native-save-no-browser-fallback'],
});
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const assert=(value,message)=>{if(!value)throw Error(message);};
const object=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const positive=value=>Number.isSafeInteger(value)&&value>0;
const digest=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value)&&value.length===64;
const equal=(a,b,message)=>assert(isDeepStrictEqual(a,b),message);
const sorted=rows=>[...rows].sort((a,b)=>a.path<b.path?-1:a.path>b.path?1:0);
const FILE_NAMES=['metadata.json','score.json','source.payload'];
const TAKE_ROLES=['beforeScore','beforeTake','afterScore','afterTake'];
const ENTRY_FIELDS=['library_format_version','revision','key','content_sha256','score_sha256','score_bytes','score_id','title','composer','label','saved_at_unix_ms','provenance','retained_source'];
function exactKeys(value,keys,message){assert(object(value)&&isDeepStrictEqual(Object.keys(value).sort(),[...keys].sort()),message);}
function recordedDirectory(value){
  assert(typeof value==='string'&&value.length>0&&!/[\r\n\0]/.test(value),'Native archive directory is invalid');
  const path=value.replaceAll('\\','/').replace(/\/+$/,'');
  assert((path.startsWith('/')||/^[A-Za-z]:\//.test(path))&&path.split('/').every(part=>part!=='.'&&part!=='..')&&path.endsWith('/Scores'),'Native archive directory must identify the absolute Scores root');
  return /^[A-Za-z]:\//.test(path)?path.toLowerCase():path;
}

// This encoder is deliberately restricted to the two authored fixtures. Their
// fields match the Rust Score serialization order, including defaults. The only
// numeric representation difference is Tempo.bpm (Rust f64 emits 60.0). Reject
// schema drift instead of pretending to implement arbitrary serde serialization.
export function folderFixtureContentHash(score){
  const fields=['version','id','title','composer','provenance','parts','tempo','meters','keys','measures','repeats','source'];
  equal(Object.keys(score),fields,'Folder fixture must retain its declared Rust Score field order');
  equal(Object.keys(score.provenance),['kind','attribution','source_url','license'],'Folder fixture provenance schema changed');
  equal(Object.keys(score.source),['format','filename','content'],'Folder fixture source schema changed');
  for(const part of score.parts){
    equal(Object.keys(part),['id','name','instrument','notes'],'Folder fixture part schema changed');
    for(const note of part.notes){
      equal(Object.keys(note),['id','at','duration','pitch','voice','staff','velocity','tie_start','tie_stop'],'Folder fixture note schema changed');
      assert(typeof note.tie_start==='boolean'&&typeof note.tie_stop==='boolean','Folder fixture tie defaults must be explicit');
      equal(Object.keys(note.pitch),['step','alter','octave'],'Folder fixture pitch schema changed');
      for(const beat of [note.at,note.duration])equal(Object.keys(beat),['numerator','denominator'],'Folder fixture beat schema changed');
    }
  }
  for(const [name,keys]of Object.entries({tempo:['at','bpm'],meters:['at','numerator','denominator'],keys:['at','fifths','mode'],measures:['number','at','length']})){
    assert(Array.isArray(score[name]),`Folder fixture ${name} must be an array`);
    for(const row of score[name]){
      equal(Object.keys(row),keys,`Folder fixture ${name} schema changed`);
      equal(Object.keys(row.at),['numerator','denominator'],'Folder fixture beat schema changed');
      if(row.length)equal(Object.keys(row.length),['numerator','denominator'],'Folder fixture measure length schema changed');
    }
  }
  assert(score.repeats.length===0&&score.tempo.length===1&&score.tempo[0].bpm===60,'Folder fixture canonical encoder requires its authored 60 BPM exercise');
  const values=fields.map(name=>`${JSON.stringify(name)}:${name==='tempo'?`[{"at":${JSON.stringify(score.tempo[0].at)},"bpm":60.0}]`:JSON.stringify(score[name])}`);
  return hash(`{${values.join(',')}}`);
}

async function readOrdinary(directory,path,limit=8*1024*1024){
  assert(typeof path==='string'&&path.length>0&&!path.includes('\\')&&!path.includes('\0')&&path.split('/').every(part=>part&&part!=='.'&&part!=='..'),'Unsafe evidence path');
  const segments=path.split('/');let current=directory;
  for(let index=0;index<segments.length;index++){
    current=join(current,segments[index]);const stat=await lstat(current);
    assert(!stat.isSymbolicLink()&&(index===segments.length-1?stat.isFile():stat.isDirectory()),`Evidence path must be ordinary without links: ${path}`);
    if(index===segments.length-1)assert(stat.size>0&&stat.size<=limit,`Evidence size exceeds its bound: ${path}`);
  }
  const bytes=await readFile(current);assert(bytes.length>0&&bytes.length<=limit,`Evidence size exceeds its bound: ${path}`);return bytes;
}
async function directoryNames(path){const stat=await lstat(path);assert(stat.isDirectory()&&!stat.isSymbolicLink(),`Evidence directory must be ordinary without links: ${path}`);return(await readdir(path)).sort();}
function parse(bytes,path){try{return JSON.parse(bytes.toString('utf8'));}catch{throw Error(`Invalid evidence JSON: ${path}`);}}

function validateTake(take,transport){
  assert(object(take)&&take.version===1&&Array.isArray(take.passes)&&take.passes.length>0,'Before take is not a scored take export');
  assert(take.passes.every(pass=>object(pass)&&positive(pass.id)&&Array.isArray(pass.inputs)&&Array.isArray(pass.captures)),'Before take has invalid scored passes');
  assert(new Set(take.passes.map(pass=>pass.id)).size===take.passes.length,'Before take has duplicate pass identities');
  const inputCount=take.passes.reduce((sum,pass)=>sum+pass.inputs.length,0);
  assert(inputCount>0,'Before take requires positive scored input');
  const evidence=take.input_evidence;
  assert(object(evidence)&&evidence.version===1&&Array.isArray(evidence.events)&&evidence.truncated===false&&evidence.omitted_observations===0,'Before take input evidence is incomplete');
  const onsets=evidence.events.filter(event=>object(event)&&event.kind==='note_on'&&event.input_kind==='typing_keyboard');
  assert(onsets.length===1,'Before take requires exactly one actual typing keyboard onset');
  const routed=new Set();
  for(const event of onsets){
    assert(positive(event.event_id)&&typeof event.source_id==='string'&&event.source_id.length>0&&event.encoding==='key_down'&&
      Number.isInteger(event.midi)&&event.midi>=0&&event.midi<=127&&Number.isInteger(event.velocity)&&event.velocity>0&&event.velocity<=127&&
      Number.isFinite(event.event_wall_ms)&&Number.isFinite(event.received_wall_ms),'Before take contains invalid typed onset evidence');
    const route=event.onset_capture;
    assert(object(route)&&positive(route.pass_id)&&positive(route.event_id),'Typing keyboard onset lacks scored capture routing');
    assert(String(route.pass_id)===transport.current.passId,'Typing keyboard onset differs from admitted native pass');
    const pass=take.passes.find(row=>row.id===route.pass_id);
    assert(pass?.capture_enabled===true,'Typing keyboard onset routes to a missing or disabled pass');
    const captures=pass.captures.filter(row=>row?.event_id===route.event_id);
    assert(captures.length===1,'Typing keyboard onset routes to a missing or ambiguous capture');
    const capture=captures[0],input=capture.input;
    assert(object(input)&&input.midi===event.midi&&input.velocity===event.velocity&&Number.isFinite(input.at_ms)&&
      capture.event_wall_ms===event.event_wall_ms&&capture.received_wall_ms===event.received_wall_ms&&pass.inputs.some(row=>isDeepStrictEqual(row,input)),
    'Typing keyboard onset does not match its scored input and capture');
    const key=`${route.pass_id}:${route.event_id}`;assert(!routed.has(key),'Typing keyboard onsets share a capture');routed.add(key);
  }
  return{typing_note_on_count:onsets.length,scored_input_count:inputCount};
}

function validateTransport(value){
  assert(object(value)&&value.version===1&&value.stage==='complete'&&value.omitted===0&&positive(value.rowBytes)&&value.rowBytes<=24*1024&&
    Array.isArray(value.rows)&&value.rows.length>0&&value.rows.length<=64,'Native transport admission is incomplete');
  assert(value.trustedPlayClicks===2&&value.trustedKeyDowns===1&&value.trustedKeyUps===1,'Native transport requires actual Play and typed key events');
  const state=value.current;
  assert(object(state)&&typeof state.passId==='string'&&/^[1-9][0-9]*$/.test(state.passId)&&state.captured==='1'&&state.cue==='paused'&&state.phase!=='capturing'&&
    state.hidden===false&&Array.isArray(state.openDialogs)&&state.openDialogs.length===0,'Native transport did not retain its paused captured pass');
  assert(value.rows.every(row=>object(row)&&Number.isFinite(row.elapsedMs)&&row.elapsedMs>=0&&object(row.state)),'Native transport rows are invalid');
  const events=value.rows.filter(row=>row.kind==='event').map(row=>row.event);
  assert(events.every(object),'Native transport event observations are invalid');
  assert(events.filter(event=>event.trusted===true&&event.type==='click'&&event.control==='play-button').length===2,'Native transport is missing trusted Play observations');
  for(const type of ['keydown','keyup'])assert(events.filter(event=>event.trusted===true&&event.type===type&&event.code==='KeyR'&&event.surface==='stage-title'&&!event.repeat).length===1,`Native transport is missing trusted ${type}`);
  const ready=value.rows.find(row=>row.kind==='ready');
  assert(ready&&Number.isFinite(ready.state.positionMs)&&value.rows.some(row=>row.state.phase==='capturing'&&row.state.passId===state.passId&&
    row.state.hidden===false&&row.state.openDialogs?.length===0&&Number.isFinite(row.state.positionMs)&&row.state.positionMs>ready.state.positionMs&&row.state.positionMs<row.state.durationMs),
  'Native transport never admitted an advancing visible scored pass');
}

/** Re-derive a hosted Windows folder proof from reports, OS action results,
 * exact archive bytes, immutable snapshots, and downloaded score/take payloads.
 * Calling this on synthetic test observations is never Windows acceptance. */
export async function verifyNativeSongFolderEvidence(directory){
  await directoryNames(directory);const files=[];
  async function bytes(path,limit){const value=await readOrdinary(directory,path,limit);files.push({path,sha256:hash(value),bytes:value.length});return value;}
  async function json(path,limit){return parse(await bytes(path,limit),path);}
  const nativeBytes=await readOrdinary(directory,'native-song-folder.json',1024*1024),native=parse(nativeBytes,'native-song-folder.json');
  assert(native.version===1&&native.ok===true,'Native song-folder host report did not pass');
  for(const field of ['source_sha','source_tree'])assert(typeof native[field]==='string'&&/^[a-f0-9]{40}$/.test(native[field])&&native[field].length===40,`Invalid native ${field}`);
  assert(digest(native.executable_sha256),'Invalid native executable SHA-256');
  assert(Array.isArray(native.phases)&&native.phases.length===3,'Three ordered native folder processes are required');
  equal(native.phases.map(row=>row?.phase),SONG_FOLDER_PHASES,'Native folder phase order differs');
  await verifyNativeProfileEvidence(native,SONG_FOLDER_PHASES,json);
  const reports={},rendererHashes={},allNames=await readdir(directory),actionsByPhase={};
  for(const phase of SONG_FOLDER_PHASES){
    const host=native.phases.find(row=>row.phase===phase);
    assert(host.renderer_ok===true&&host.normal_close===true&&host.renderer_origin==='https://wmh.localhost'&&host.executable_tcp_listeners===0&&
      positive(host.process_id)&&host.launched_new_process===true&&positive(host.actions)&&host.actions<=64,`Native ${phase} process evidence is incomplete`);
    assert(host.profile_fresh===true&&host.profile_reused===false,`Native ${phase} requires a fresh profile`);
    const reportBytes=await readOrdinary(directory,`renderer-${phase}.json`,2*1024*1024),report=parse(reportBytes,phase);reports[phase]=report;rendererHashes[phase]=hash(reportBytes);
    assert(report.version===1&&report.ok===true&&report.phase===phase&&report.origin==='https://wmh.localhost'&&report.profileMarkerAbsent===true&&report.actions===host.actions,`Renderer ${phase} did not pass with matching native actions`);
    equal(report.openedScoreDatabases,[],`Renderer ${phase} opened the browser score database`);equal(report.errors,[],`Renderer ${phase} reported errors`);
    assert(Array.isArray(report.checks)&&new Set(report.checks).size===report.checks.length,`Renderer ${phase} checks must be unique`);
    for(const check of SONG_FOLDER_CHECKS[phase])assert(report.checks.includes(check),`Missing native folder check: ${check}`);
    const actionNames=allNames.filter(name=>name.startsWith(`action-${phase}-`)||name.startsWith(`result-${phase}-`));
    equal(actionNames.sort(),Array.from({length:host.actions},(_,index)=>[`action-${phase}-${index+1}.json`,`result-${phase}-${index+1}.json`]).flat().sort(),`Native ${phase} action/result files must be bounded and sequential`);
    const actions=[];
    for(let sequence=1;sequence<=host.actions;sequence++){
      const action=await json(`action-${phase}-${sequence}.json`,16*1024),result=await json(`result-${phase}-${sequence}.json`,256*1024);
      assert(action.version===1&&action.sequence===sequence&&['click','key-r','picker','cancel-picker'].includes(action.kind)&&
        [action.x,action.y,action.width,action.height].every(Number.isFinite)&&action.width>0&&action.height>0&&action.x>=0&&action.x<action.width&&action.y>=0&&action.y<action.height,
      `Invalid native ${phase} action ${sequence}`);
      assert(result.ok===true,`Native ${phase} action ${sequence} failed`);
      if(['picker','cancel-picker'].includes(action.kind)){
        const owner=result.owned_dialog,completion=result.picker_completion;
        assert(object(owner)&&positive(owner.hwnd)&&owner.class==='#32770'&&owner.process_id===host.process_id&&owner.app_process_id===host.process_id&&
          positive(owner.app_hwnd)&&owner.root_owner_hwnd===owner.app_hwnd,`Native ${phase} picker is not owned by the recorded app process`);
        assert(object(completion)&&completion.dialog_dismissed===true&&completion.app_enabled===true&&completion.owned_popup_visible===false,`Native ${phase} picker was not dismissed`);
        if(action.kind==='picker')assert(['folder-original.json','folder-conflict.json','malformed.json'].includes(action.file),`Native ${phase} picker fixture is unexpected`);
        else assert(!Object.hasOwn(action,'file'),`Native ${phase} canceled picker must not select a file`);
      }
      actions.push(action);
    }
    actionsByPhase[phase]=actions;
  }
  const seed=reports['folder-seed'],restart=reports['folder-restart'],failure=reports['folder-failure'];
  const archiveDirectory=recordedDirectory(native.directory);
  equal(recordedDirectory(seed.directory),archiveDirectory,'Seed renderer archive directory differs from native Scores root');
  equal(recordedDirectory(restart.directory),archiveDirectory,'Restart renderer archive directory differs from native Scores root');
  const seedPickers=actionsByPhase['folder-seed'].filter(row=>row.kind==='picker').map(row=>row.file);
  equal(seedPickers,['folder-original.json','folder-original.json','folder-conflict.json','malformed.json'],'Seed requires actual original, duplicate, conflicting and malformed picker actions');
  assert(actionsByPhase['folder-seed'].filter(row=>row.kind==='cancel-picker').length===1,'Seed requires one actual canceled picker');
  equal(actionsByPhase['folder-failure'].filter(row=>row.kind==='picker').map(row=>row.file),['folder-original.json'],'Failure requires the actual original picker');
  assert(actionsByPhase['folder-restart'].filter(row=>row.kind==='key-r').length===1,'Restart requires one actual native typed key action');
  assert(Array.isArray(seed.inventory)&&seed.inventory.length===2,'Seed inventory requires exactly two disk editions');
  equal(restart.inventory,seed.inventory,'Clean-profile restart changed native inventory');
  assert(new Set(seed.inventory.map(row=>row.key)).size===2,'Native inventory keys must be distinct');
  const fixtures=[];
  for(const name of ['folder-original.json','folder-conflict.json']){
    const fixtureBytes=await readFile(new URL(`../tests/fixtures/${name}`,import.meta.url)),score=parse(fixtureBytes,name),contentHash=folderFixtureContentHash(score);
    fixtures.push({name,bytes:fixtureBytes,score,key:`song-${contentHash}`,contentHash});
  }
  equal([...seed.inventory.map(row=>row.key)].sort(),fixtures.map(row=>row.key).sort(),'Native inventory content identities differ from authored exercises');
  const archiveRows=[];
  for(const area of ['songs','backups']){
    equal(await directoryNames(join(directory,'Scores',area)),fixtures.map(row=>row.key).sort(),`Scores/${area} has missing or unlisted directories`);
    for(const fixture of fixtures){
      const prefix=`Scores/${area}/${fixture.key}`;
      equal(await directoryNames(join(directory,prefix)),FILE_NAMES,`${prefix} has missing or unlisted files`);
      const metadata=await json(`${prefix}/metadata.json`,64*1024),scoreBytes=await bytes(`${prefix}/score.json`),sourceBytes=await bytes(`${prefix}/source.payload`);
      assert(scoreBytes.equals(fixture.bytes),`${prefix}/score.json differs from exact authored fixture bytes`);
      assert(sourceBytes.equals(Buffer.from(fixture.score.source.content,'utf8')),`${prefix}/source.payload differs from exact retained source`);
      exactKeys(metadata,ENTRY_FIELDS,`${prefix} metadata fields differ from native Entry`);
      assert(metadata.library_format_version===1&&metadata.revision===1&&metadata.key===fixture.key&&metadata.content_sha256===fixture.contentHash&&
        metadata.score_sha256===hash(scoreBytes)&&metadata.score_bytes===scoreBytes.length&&metadata.score_id===fixture.score.id&&
        metadata.title===fixture.score.title&&metadata.composer===fixture.score.composer&&metadata.label===fixture.score.title&&positive(metadata.saved_at_unix_ms),`${prefix} metadata does not describe exact score bytes`);
      equal(metadata.provenance,fixture.score.provenance,`${prefix} metadata lost provenance`);
      equal(metadata.retained_source,{format:fixture.score.source.format,filename:fixture.score.source.filename,bytes:sourceBytes.length,sha256:hash(sourceBytes)},`${prefix} retained source descriptor differs`);
      equal(metadata,seed.inventory.find(row=>row.key===fixture.key),`${prefix} metadata differs from renderer inventory`);
      for(const name of FILE_NAMES){
        const row=files.find(row=>row.path===`${prefix}/${name}`);archiveRows.push({path:row.path.slice('Scores/'.length),sha256:row.sha256,bytes:row.bytes});
        if(area==='backups'){
          const primary=files.find(row=>row.path===`Scores/songs/${fixture.key}/${name}`);
          assert(row.sha256===primary.sha256&&row.bytes===primary.bytes,`Backup ${fixture.key}/${name} is not byte-identical to primary`);
        }
      }
    }
  }
  equal(await directoryNames(join(directory,'Scores','.staging')),[],'Failure staging blocker must be restored to an empty directory');
  const archives=sorted(archiveRows);
  for(const phase of SONG_FOLDER_PHASES){
    const snapshot=await json(`snapshot-${phase}.json`,64*1024);
    assert(object(snapshot)&&snapshot.version===1&&Array.isArray(snapshot.files),'Native folder snapshot files are missing');
    equal(sorted(snapshot.files),archives,`${phase} snapshot does not match exact unchanged archive bytes`);
  }
  const [original,conflict]=fixtures;
  equal(seed.saveResults,[
    {status:200,code:null,key:original.key,allowConflictingId:false},
    {status:409,code:'library_duplicate',key:original.key,allowConflictingId:false},
    {status:409,code:'library_id_conflict',key:original.key,allowConflictingId:false},
    {status:200,code:null,key:conflict.key,allowConflictingId:true},
  ],'Seed native save responses do not prove duplicate, conflict and explicit Keep both');
  equal(restart.saveResults,[],'Restart selection or navigation unexpectedly saved a score');
  assert(Array.isArray(failure.saveResults)&&failure.saveResults.length===1,'Failure requires exactly one native save response');
  const failed=failure.saveResults[0];
  assert(Number.isInteger(failed.status)&&failed.status>=400&&failed.status<=599&&failed.code==='library_unsafe_path'&&failed.key===null&&failed.allowConflictingId===false&&failure.persistence==='not-saved','Failed native save did not retain an explicit unsaved storage failure');
  assert(object(restart.audition)&&positive(restart.audition.sourceStarts)&&restart.audition.activeSources===0&&restart.audition.pendingSources===0,'Saved-score audition did not start and clean up audio');
  validateTransport(restart.transportAdmission);
  exactKeys(restart.files,TAKE_ROLES,'Restart requires four score/take export roles');
  assert(new Set(Object.values(restart.files)).size===4,'Restart export paths must be distinct');
  assert(Array.isArray(restart.downloads)&&restart.downloads.length===4,'Restart requires four native download completions');
  const values={};
  for(const role of TAKE_ROLES){
    const filename=restart.files[role];
    assert(typeof filename==='string'&&/^folder-restart-(?:[1-9]|1[0-6])\.json$/.test(filename)&&!/[\r\n]/.test(filename),`Invalid restart export filename for ${role}`);
    const downloads=restart.downloads.filter(row=>row?.file===filename);
    assert(downloads.length===1&&downloads[0].complete===true&&downloads[0].success===true,`Missing successful native download for ${role}`);
    values[role]=await json(`downloads/${filename}`,80*1024*1024);
  }
  equal(values.beforeScore,original.score,'Restart beforeScore differs from original canonical fixture');
  equal(values.afterScore,values.beforeScore,'Canonical score changed during saved library/free navigation');
  const counts=validateTake(values.beforeTake,restart.transportAdmission);
  equal(values.afterTake,values.beforeTake,'Scored take changed during saved library/free navigation');
  return{version:1,ok:true,native_report_sha256:hash(nativeBytes),renderer_sha256:rendererHashes,source_sha:native.source_sha,source_tree:native.source_tree,
    executable_sha256:native.executable_sha256,entry_count:2,...counts,files:sorted(files)};
}

async function main(){
  const args=process.argv.slice(2),check=args.includes('--check'),directories=args.filter(value=>value!=='--check');
  assert(directories.length<=1&&args.filter(value=>value==='--check').length<=1&&!directories.some(value=>value.startsWith('--')),
    'Usage: node scripts/verify-native-song-folder-evidence.mjs [--check] [evidence-directory]');
  const directory=resolve(directories[0]||'song-folder-acceptance'),output=join(directory,'native-song-folder-files.json');
  if(!check)await rm(output,{force:true});
  const proof=await verifyNativeSongFolderEvidence(directory);
  if(check){const stored=parse(await readOrdinary(directory,'native-song-folder-files.json',2*1024*1024),'native-song-folder-files.json');equal(stored,proof,'Stored native song-folder proof differs from verified reports and bytes');}
  else await writeFile(output,JSON.stringify(proof,null,2)+'\n');
  console.log(`Verified two native song archives, exact backups, fresh-profile restart and non-destructive failed save${check?'; stored proof matches':''}`);
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href)main().catch(error=>{console.error(error.message);process.exitCode=1;});
