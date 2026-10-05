import {verifyNativeProfileEvidence} from './native-profile-evidence.mjs';
import {readFile,writeFile,readdir,lstat,rm} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';
import {inflateRawSync,inflateSync} from 'node:zlib';
import {bulkAcceptanceFixtures} from './prepare-bulk-import-fixtures.mjs';

export const BULK_IMPORT_PHASES=Object.freeze(['bulk-seed','bulk-restart','bulk-failure']);
export const BULK_IMPORT_CHECKS=Object.freeze({
  'bulk-seed':['actual-picker-legacy-pack-preflight','saved-playable-retained-nonplayable','duplicate-and-backup-no-new-songs','explicit-id-conflict-keep-both','original-export-unified-pack-roundtrip','cancelled-malformed-no-write','active-score-take-preserved'],
  'bulk-restart':['fresh-profile-native-inventory','saved-song-preview-audition','retained-originals-after-restart'],
  'bulk-failure':['blocked-native-import-actionable-no-fallback'],
});
const hash=value=>createHash('sha256').update(value).digest('hex');
const assert=(value,message)=>{if(!value)throw Error(message);};
const object=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const positive=value=>Number.isSafeInteger(value)&&value>0;
const digest=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value)&&value.length===64;
const equal=(a,b,message)=>assert(isDeepStrictEqual(a,b),message);
const sorted=rows=>[...rows].sort((a,b)=>a.path<b.path?-1:a.path>b.path?1:0);
const statuses=['ready','saved','duplicate','conflict','retained_nonplayable','error'];
const ENTRY_FIELDS=['library_format_version','revision','key','content_sha256','score_sha256','score_bytes','score_id','title','composer','label','saved_at_unix_ms','provenance','retained_source'];
const SEED_ROLES=['original','unified','beforeScore','beforeTake','afterScore','afterTake'];
let authoredScores;
const ordinaryPath=value=>typeof value==='string'&&value.length>0&&value.length<=1024&&!/[\\\0\r\n:]/.test(value)&&value.split('/').every(part=>part&&part!=='.'&&part!=='..');
function exactKeys(value,keys,message){assert(object(value)&&isDeepStrictEqual(Object.keys(value).sort(),[...keys].sort()),message);}
function recordedDirectory(value){
  assert(typeof value==='string'&&value.length>0&&!/[\r\n\0]/.test(value),'Native archive directory is invalid');
  const path=value.replaceAll('\\','/').replace(/\/+$/,'');
  assert((path.startsWith('/')||/^[A-Za-z]:\//.test(path))&&path.split('/').every(part=>part!=='.'&&part!=='..')&&path.endsWith('/Scores'),'Native archive directory must identify the absolute Scores root');
  return /^[A-Za-z]:\//.test(path)?path.toLowerCase():path;
}
async function readOrdinary(directory,path,limit=8*1024*1024){
  assert(ordinaryPath(path),'Unsafe evidence path');
  let current=directory;const parts=path.split('/');
  for(const [index,part]of parts.entries()){
    current=join(current,part);const stat=await lstat(current);
    assert(!stat.isSymbolicLink()&&(index===parts.length-1?stat.isFile():stat.isDirectory()),`Evidence path must be ordinary without links: ${path}`);
    if(index===parts.length-1)assert(stat.size>0&&stat.size<=limit,`Evidence size exceeds its bound: ${path}`);
  }
  const bytes=await readFile(current);assert(bytes.length>0&&bytes.length<=limit,`Evidence size exceeds its bound: ${path}`);return bytes;
}
async function names(directory){const stat=await lstat(directory);assert(stat.isDirectory()&&!stat.isSymbolicLink(),`Evidence directory must be ordinary without links: ${directory}`);return(await readdir(directory)).sort();}
function parse(bytes,path){try{return JSON.parse(bytes.toString('utf8'));}catch{throw Error(`Invalid evidence JSON: ${path}`);}}
function crc32(bytes){let crc=0xffffffff;for(const byte of bytes){crc^=byte;for(let bit=0;bit<8;bit++)crc=(crc>>>1)^((crc&1)?0xedb88320:0);}return(crc^0xffffffff)>>>0;}

// This is an evidence reader, not a general archive extractor. No archive path
// is ever written to disk. Bounds cover the small, newly authored fixture set.
export function readBulkEvidenceZip(bytes){
  assert(Buffer.isBuffer(bytes)&&bytes.length>=22&&bytes.length<=8*1024*1024,'Invalid bounded ZIP evidence');
  let end=-1;for(let offset=bytes.length-22;offset>=Math.max(0,bytes.length-65557);offset--)if(bytes.readUInt32LE(offset)===0x06054b50&&offset+22+bytes.readUInt16LE(offset+20)===bytes.length){end=offset;break;}
  assert(end>=0,'ZIP end record missing');
  const count=bytes.readUInt16LE(end+10),size=bytes.readUInt32LE(end+12),start=bytes.readUInt32LE(end+16);
  assert(bytes.readUInt16LE(end+4)===0&&bytes.readUInt16LE(end+6)===0&&bytes.readUInt16LE(end+8)===count&&count>0&&count<=64&&start+size===end,'ZIP directory is not bounded and single-disk');
  const entries=new Map(),regions=[];let cursor=start,total=0;
  for(let index=0;index<count;index++){
    assert(cursor+46<=end&&bytes.readUInt32LE(cursor)===0x02014b50,'ZIP central directory is truncated');
    const flags=bytes.readUInt16LE(cursor+8),method=bytes.readUInt16LE(cursor+10),crc=bytes.readUInt32LE(cursor+16),compressed=bytes.readUInt32LE(cursor+20),expanded=bytes.readUInt32LE(cursor+24),length=bytes.readUInt16LE(cursor+28),extra=bytes.readUInt16LE(cursor+30),comment=bytes.readUInt16LE(cursor+32),local=bytes.readUInt32LE(cursor+42);
    assert(length>0&&cursor+46+length+extra+comment<=end&&bytes.readUInt16LE(cursor+34)===0&&!(flags&~0x0808)&&[0,8].includes(method)&&compressed<=8*1024*1024&&expanded<=8*1024*1024,'Unsupported or oversized ZIP member');
    const rawName=bytes.subarray(cursor+46,cursor+46+length),name=rawName.toString('utf8');
    assert(Buffer.from(name).equals(rawName)&&ordinaryPath(name)&&!entries.has(name),'Unsafe or duplicate ZIP path');
    const unixMode=bytes.readUInt32LE(cursor+38)>>>16;assert((unixMode&0xf000)!==0xa000,'ZIP symlink member is forbidden');
    assert(local+30<=start&&bytes.readUInt32LE(local)===0x04034b50&&bytes.readUInt16LE(local+6)===flags&&bytes.readUInt16LE(local+8)===method,'ZIP local header differs from directory');
    const localLength=bytes.readUInt16LE(local+26),localExtra=bytes.readUInt16LE(local+28),dataStart=local+30+localLength+localExtra;
    assert(localLength===length&&dataStart+compressed<=start&&bytes.subarray(local+30,local+30+localLength).equals(rawName),'ZIP local name or payload differs from directory');
    let localCompressed=bytes.readUInt32LE(local+18),localExpanded=bytes.readUInt32LE(local+22);
    if(localCompressed===0xffffffff||localExpanded===0xffffffff){
      let extraCursor=local+30+localLength,zip64;while(extraCursor<dataStart){assert(extraCursor+4<=dataStart,'ZIP local extra truncated');const id=bytes.readUInt16LE(extraCursor),size=bytes.readUInt16LE(extraCursor+2);assert(extraCursor+4+size<=dataStart,'ZIP local extra length invalid');if(id===1){assert(!zip64,'ZIP local ZIP64 extra repeated');zip64=bytes.subarray(extraCursor+4,extraCursor+4+size);}extraCursor+=4+size;}
      assert(zip64&&zip64.length===16&&localCompressed===0xffffffff&&localExpanded===0xffffffff,'ZIP local ZIP64 sizes incomplete');const unpacked=zip64.readBigUInt64LE(0),packed=zip64.readBigUInt64LE(8);assert(unpacked===BigInt(expanded)&&packed===BigInt(compressed),'ZIP local ZIP64 sizes differ from directory');localExpanded=Number(unpacked);localCompressed=Number(packed);
    }
    if(!(flags&8))assert(bytes.readUInt32LE(local+14)===crc&&localCompressed===compressed&&localExpanded===expanded,'ZIP local checksum or size differs from directory');
    let regionEnd=dataStart+compressed;
    if(flags&8){const marker=bytes.readUInt32LE(regionEnd)===0x08074b50?4:0;assert(regionEnd+marker+12<=start&&bytes.readUInt32LE(regionEnd+marker)===crc&&bytes.readUInt32LE(regionEnd+marker+4)===compressed&&bytes.readUInt32LE(regionEnd+marker+8)===expanded,'ZIP data descriptor differs');regionEnd+=marker+12;}
    regions.push([local,regionEnd]);total+=expanded;assert(total<=16*1024*1024,'ZIP expansion exceeds evidence bound');
    const packed=bytes.subarray(dataStart,dataStart+compressed),payload=method===0?Buffer.from(packed):inflateRawSync(packed,{maxOutputLength:Math.max(1,expanded)});
    assert(payload.length===expanded&&crc32(payload)===crc,'ZIP member size or CRC mismatch');entries.set(name,payload);cursor+=46+length+extra+comment;
  }
  assert(cursor===end,'ZIP central directory has trailing data');regions.sort((a,b)=>a[0]-b[0]);let offset=0;
  for(const region of regions){assert(region[0]===offset,'ZIP members overlap or contain unlisted data');offset=region[1];}assert(offset===start,'ZIP local data differs from central directory');
  return entries;
}

function validatePng(bytes,phase){
  assert(bytes.length>=4096&&bytes.subarray(0,8).equals(Buffer.from('89504e470d0a1a0a','hex')),`Native ${phase} screenshot is not a nontrivial PNG`);
  let cursor=8,width,height,color,depth,sawEnd=false;const data=[];
  while(cursor<bytes.length){assert(cursor+12<=bytes.length,'PNG screenshot is truncated');const size=bytes.readUInt32BE(cursor),type=bytes.subarray(cursor+4,cursor+8).toString('ascii'),end=cursor+12+size;assert(end<=bytes.length&&crc32(bytes.subarray(cursor+4,end-4))===bytes.readUInt32BE(end-4),'PNG screenshot chunk CRC differs');
    if(cursor===8){assert(type==='IHDR'&&size===13,'PNG screenshot header missing');width=bytes.readUInt32BE(cursor+8);height=bytes.readUInt32BE(cursor+12);depth=bytes[cursor+16];color=bytes[cursor+17];assert(width>=640&&height>=360&&width<=4096&&height<=4096&&depth===8&&[2,6].includes(color)&&bytes[cursor+18]===0&&bytes[cursor+19]===0&&bytes[cursor+20]===0,'PNG screenshot dimensions or encoding unsupported');}
    else assert(type!=='IHDR','PNG screenshot has duplicate header');
    if(type==='IDAT')data.push(bytes.subarray(cursor+8,end-4));
    if(type==='IEND'){assert(size===0&&end===bytes.length,'PNG screenshot end differs');sawEnd=true;}
    cursor=end;
  }
  assert(sawEnd&&data.length>0,'PNG screenshot lacks image data');const scanline=1+width*(color===2?3:4),pixels=inflateSync(Buffer.concat(data),{maxOutputLength:scanline*height});
  assert(pixels.length===scanline*height,'PNG screenshot pixel size differs');for(let offset=0;offset<pixels.length;offset+=scanline)assert(pixels[offset]<=4,'PNG screenshot filter invalid');
  assert(new Set(pixels).size>16,'PNG screenshot has no meaningful image variation');return{width,height};
}

// Fixture-only canonical identity: validate the authored objects first, then
// reproduce their one known serde_json f64 spelling. Never normalize an
// arbitrary user's score or accept an arbitrary self-declared content digest.
export function bulkFixtureContentHash(score){
  authoredScores??=bulkAcceptanceFixtures().scores;assert(authoredScores.some(value=>isDeepStrictEqual(value,score)),'Unknown authored bulk score identity');
  const copy={...score,tempo:score.tempo};const raw=JSON.stringify(copy);
  assert(score.tempo.length===1&&score.tempo[0].bpm===30&&raw.match(/"bpm":30(?=[,}])/g)?.length===1,'Authored bulk tempo schema changed');
  return hash(raw.replace('"bpm":30','"bpm":30.0'));
}
function fixtureScoreBytes(fixtures){
  const original=readBulkEvidenceZip(fixtures.files.get('原创曲包_日本語.zip')),conflict=readBulkEvidenceZip(fixtures.files.get('bulk-conflict.zip'));
  return fixtures.scores.map(score=>{const bytes=[...original.values(),...conflict.values()].find(value=>{try{return isDeepStrictEqual(JSON.parse(value.toString()),score);}catch{return false;}});assert(bytes,'Authored canonical fixture missing');return{score,bytes,key:`song-${bulkFixtureContentHash(score)}`};});
}
function validateReport(row,sourceBytes,inventory){
  assert(object(row)&&Number.isInteger(row.status)&&row.status>=200&&row.status<=599&&typeof row.filename==='string'&&['preview','commit'].includes(row.mode)&&typeof row.keepBoth==='boolean'&&(row.index===null||(Number.isSafeInteger(row.index)&&row.index>=0)),'Native import observation invalid');
  const value=row.body;
  if(row.status>=400){assert(object(value)&&typeof value.code==='string'&&value.code.length>0&&typeof value.error==='string'&&value.error.length>0,'Native failed import lacks actionable error');return;}
  assert(row.status===200&&object(value)&&value.format==='worldmusichub-import-report'&&value.version===1&&value.mode===row.mode&&Array.isArray(value.items)&&value.items.length>0&&value.items.length<=64&&Array.isArray(value.warnings)&&value.warnings.every(warning=>typeof warning==='string'),'Native import report invalid');
  equal(value.source,{filename:row.filename,sha256:hash(sourceBytes),bytes:sourceBytes.length,retained:row.mode==='commit',archive_key:`pack-${hash(sourceBytes)}`},'Native import report source differs from exact selected bytes');
  assert(new Set(value.items.map(item=>item.index)).size===value.items.length,'Native import report repeats item indices');
  for(const [index,item]of value.items.entries()){
    assert(object(item)&&item.index===index&&typeof item.path==='string'&&typeof item.title==='string'&&statuses.includes(item.status)&&typeof item.playable==='boolean'&&typeof item.code==='string'&&item.code.length>0&&typeof item.message==='string'&&item.message.length>0,'Native import item invalid');
    if(['saved','duplicate','conflict'].includes(item.status)){assert(item.playable===true,'Native import playable result is inconsistent');if(item.entry)equal(item.entry,inventory.find(entry=>entry.key===item.entry.key),'Native import result entry differs from disk inventory');}
    if(['saved','duplicate'].includes(item.status))assert(item.entry,'Native import saved/duplicate result lacks native Entry');
    if(item.status==='retained_nonplayable')assert(item.playable===false&&!item.entry,'Retained unsupported source was treated as playable');
  }
  const summary=Object.fromEntries(statuses.map(status=>[status,value.items.filter(item=>item.status===status).length]));summary.total=value.items.length;equal(value.summary,summary,'Native import summary differs from individual outcomes');
  const entries=/\.(zip|wmhpack)$/i.test(row.filename)?readBulkEvidenceZip(sourceBytes):new Map([[row.filename,sourceBytes]]);
  equal(value.inventory,{files:sorted([...entries].map(([path,bytes])=>({path,bytes:bytes.length,sha256:hash(bytes)}))),expanded_bytes:[...entries.values()].reduce((sum,bytes)=>sum+bytes.length,0)},'Native import ZIP inventory differs from exact expanded bytes');
}
function counts(row,expected,message){assert(row.status===200,message);const actual=Object.fromEntries(statuses.map(status=>[status,row.body.items.filter(item=>item.status===status).length]));equal(actual,Object.fromEntries(statuses.map(status=>[status,expected[status]||0])),message);}

function validateTransportAndTake(transport,take,actions){
  assert(object(transport)&&transport.version===1&&transport.stage==='complete'&&transport.omitted===0&&positive(transport.rowBytes)&&transport.rowBytes<=24*1024&&Array.isArray(transport.rows)&&transport.rows.length>0&&transport.rows.length<=64,'Native transport admission incomplete');
  assert(transport.trustedPlayClicks===2&&transport.trustedKeyDowns===1&&transport.trustedKeyUps===1&&actions.filter(action=>action.kind==='key-r').length===1,'Native transport requires actual Play and typed key observations');
  const state=transport.current;assert(object(state)&&/^[1-9][0-9]*$/.test(state.passId)&&state.captured==='1'&&state.cue==='paused'&&state.phase!=='capturing'&&state.hidden===false&&isDeepStrictEqual(state.openDialogs,[]),'Native transport lost paused capture');
  assert(transport.rows.every(row=>object(row)&&Number.isFinite(row.elapsedMs)&&row.elapsedMs>=0&&object(row.state)),'Native transport rows invalid');
  const events=transport.rows.filter(row=>row.kind==='event').map(row=>row.event);assert(events.every(object),'Native transport events invalid');
  assert(events.filter(event=>event.trusted===true&&event.type==='click'&&event.control==='play-button').length===2,'Native transport lacks trusted Play clicks');
  for(const type of ['keydown','keyup'])assert(events.filter(event=>event.trusted===true&&event.type===type&&event.code==='KeyR'&&event.surface==='stage-title'&&!event.repeat).length===1,`Native transport lacks trusted ${type}`);
  const ready=transport.rows.find(row=>row.kind==='ready');assert(ready&&Number.isFinite(ready.state.positionMs)&&transport.rows.some(row=>row.state.phase==='capturing'&&row.state.passId===state.passId&&row.state.hidden===false&&isDeepStrictEqual(row.state.openDialogs,[])&&Number.isFinite(row.state.positionMs)&&row.state.positionMs>ready.state.positionMs&&row.state.positionMs<row.state.durationMs),'Native transport never advanced its visible scored pass');
  assert(object(take)&&take.version===1&&Array.isArray(take.passes)&&take.passes.length>0&&take.passes.every(pass=>positive(pass.id)&&Array.isArray(pass.inputs)&&Array.isArray(pass.captures))&&new Set(take.passes.map(pass=>pass.id)).size===take.passes.length,'Before take lacks scored passes');
  const evidence=take.input_evidence;assert(object(evidence)&&evidence.version===1&&Array.isArray(evidence.events)&&evidence.truncated===false&&evidence.omitted_observations===0,'Before take input evidence incomplete');
  const onsets=evidence.events.filter(event=>event?.kind==='note_on'&&event.input_kind==='typing_keyboard');assert(onsets.length===1,'Before take requires exactly one typed onset');
  const event=onsets[0],route=event.onset_capture;assert(positive(event.event_id)&&typeof event.source_id==='string'&&event.source_id.length>0&&event.encoding==='key_down'&&Number.isInteger(event.midi)&&event.midi>=0&&event.midi<=127&&Number.isInteger(event.velocity)&&event.velocity>0&&event.velocity<=127&&Number.isFinite(event.event_wall_ms)&&Number.isFinite(event.received_wall_ms)&&positive(route?.pass_id)&&positive(route?.event_id)&&String(route.pass_id)===state.passId,'Typed onset lacks valid admitted capture routing');
  const pass=take.passes.find(value=>value.id===route.pass_id),captures=pass?.captures.filter(value=>value.event_id===route.event_id);assert(pass?.capture_enabled===true&&captures.length===1,'Typed onset lacks unique scored capture');
  const capture=captures[0],input=capture.input;assert(object(input)&&input.midi===event.midi&&input.velocity===event.velocity&&Number.isFinite(input.at_ms)&&capture.event_wall_ms===event.event_wall_ms&&capture.received_wall_ms===event.received_wall_ms&&pass.inputs.some(value=>isDeepStrictEqual(value,input)),'Typed onset differs from actual scored input');
  const count=take.passes.reduce((sum,pass)=>sum+pass.inputs.length,0);assert(count>0,'Before take lacks positive scored input');return{typing_note_on_count:1,scored_input_count:count};
}

/** Same-renderer clock intervals supplement the independently verified owned picker. */
export function validateBulkChooserObservations(observations,actions){
 const choosers=actions.filter(action=>['picker','cancel-picker'].includes(action.kind));assert(Array.isArray(observations)&&observations.length===choosers.length,'Native chooser causality observations missing');
 let previousEnd=-Infinity;const blurs=[];
 for(const [index,row]of observations.entries()){
  exactKeys(row,['sequence','kind','started_wall_ms','finished_wall_ms','completed','blurs'],'Native chooser observation fields differ');const action=choosers[index];
  assert(row.sequence===action.sequence&&row.kind===action.kind&&row.completed===true&&Number.isFinite(row.started_wall_ms)&&Number.isFinite(row.finished_wall_ms)&&row.started_wall_ms>=0&&row.started_wall_ms>=previousEnd&&row.finished_wall_ms>=row.started_wall_ms,'Native chooser action interval invalid');
  assert(Array.isArray(row.blurs)&&row.blurs.length<=1,'Native chooser blur count invalid');
  for(const blur of row.blurs){exactKeys(blur,['trusted','started_wall_ms','finished_wall_ms'],'Native chooser blur fields differ');assert(blur.trusted===true&&Number.isFinite(blur.started_wall_ms)&&Number.isFinite(blur.finished_wall_ms)&&blur.started_wall_ms>=row.started_wall_ms&&blur.finished_wall_ms>=blur.started_wall_ms&&blur.finished_wall_ms<=row.finished_wall_ms,'Native chooser trusted blur dispatch invalid');blurs.push(blur)}
  previousEnd=row.finished_wall_ms;
 }
 return blurs;
}
export function validateBulkTakePreservation(before,after,observations,actions){
 assert(object(before)&&object(after)&&object(before.input_evidence)&&object(after.input_evidence),'Scored take evidence missing');
 const {input_evidence:prior,...priorScored}=before,{input_evidence:current,...currentScored}=after;
 equal(currentScored,priorScored,'Scored take changed during bulk import');
 const {events:prefix,...priorMetadata}=prior,{events:events,...currentMetadata}=current;equal(currentMetadata,priorMetadata,'Prior input evidence metadata changed during bulk import');
 assert(prior.truncated===false&&prior.omitted_observations===0&&Array.isArray(prefix)&&Array.isArray(events)&&events.length>=prefix.length,'Scored take input evidence was truncated');equal(events.slice(0,prefix.length),prefix,'Prior input evidence changed or reordered');
 const blurs=validateBulkChooserObservations(observations,actions),suffix=events.slice(prefix.length);assert(suffix.length===blurs.length,'Appended input evidence lacks matching native chooser causality');
 const onsets=prefix.filter(event=>event?.kind==='note_on'),onset=onsets[0];assert(onsets.length===1&&onset.input_kind==='typing_keyboard'&&prefix.some(event=>event.kind==='note_off'&&event.event_id>onset.event_id&&event.source_id===onset.source_id&&event.source_generation===onset.source_generation&&event.input_kind==='typing_keyboard'&&event.encoding==='key_up'&&event.onset_capture===null),'Native chooser began with an unreleased scored input');
 let previous=prefix.at(-1);assert(positive(previous?.event_id)&&Number.isFinite(previous.received_wall_ms),'Prior input evidence end invalid');
 // Application boundary time and evidence receipt time are separate clock reads.
 // Both must be causally inside the same observed trusted blur dispatch.
 for(const [index,event]of suffix.entries()){
  const blur=blurs[index],time=event.event_wall_ms,received=event.received_wall_ms;assert(Number.isFinite(time)&&Number.isFinite(received)&&time>=previous.received_wall_ms&&time>=blur.started_wall_ms&&received>=time&&received<=blur.finished_wall_ms,'Appended blur boundary clocks fall outside their trusted native chooser dispatch');
  equal(event,{event_id:previous.event_id+1,kind:'boundary',source_id:null,source_generation:null,input_kind:null,channel:null,midi:null,velocity:null,encoding:null,reason:'blur',event_wall_ms:time,received_wall_ms:received,timestamp_basis:'application_clock',raw_timestamp_ms:null,boundary_wall_ms:time,onset_capture:null},'Unexpected appended musical or boundary evidence');previous=event;
 }
 return {chooser_blur_boundary_count:suffix.length};
}

/** Re-derive evidence; synthetic test observations never constitute acceptance. */
export async function verifyNativeBulkImportEvidence(directory){
  const allNames=await names(directory),files=[],seen=new Set();
  async function bytes(path,limit){const result=await readOrdinary(directory,path,limit);if(!seen.has(path)){files.push({path,sha256:hash(result),bytes:result.length});seen.add(path);}return result;}
  async function json(path,limit){return parse(await bytes(path,limit),path);}
  const native=await json('native-bulk-import.json',1024*1024);
  assert(native.version===1&&native.ok===true&&native.scenario==='bulk-import'&&native.profile_reused===false,'Native bulk-import host report did not pass');
  for(const field of ['source_sha','source_tree'])assert(typeof native[field]==='string'&&/^[a-f0-9]{40}$/.test(native[field])&&native[field].length===40,`Invalid native ${field}`);
  assert(digest(native.executable_sha256)&&positive(native.executable_bytes),'Invalid native executable identity');
  assert(Array.isArray(native.phases)&&native.phases.length===3,'Three ordered native bulk processes required');equal(native.phases.map(value=>value?.phase),BULK_IMPORT_PHASES,'Native bulk phase order differs');
  await verifyNativeProfileEvidence(native,BULK_IMPORT_PHASES,json);
  const reports={},actionsByPhase={},screenshots={},archiveDirectory=recordedDirectory(native.directory);
  for(const phase of BULK_IMPORT_PHASES){
    const host=native.phases.find(value=>value.phase===phase);assert(host.renderer_ok===true&&host.normal_close===true&&host.renderer_origin==='https://wmh.localhost'&&host.executable_tcp_listeners===0&&positive(host.process_id)&&host.launched_new_process===true&&positive(host.actions)&&host.actions<=75&&host.profile_fresh===true&&host.profile_reused===false,`Native ${phase} process evidence incomplete`);
    const report=await json(`renderer-${phase}.json`,4*1024*1024);reports[phase]=report;
    assert(report.version===1&&report.ok===true&&report.phase===phase&&report.origin==='https://wmh.localhost'&&report.profileMarkerAbsent===true&&report.actions===host.actions,`Renderer ${phase} did not pass with matching native actions`);
    equal(report.openedScoreDatabases,[],`Renderer ${phase} opened browser score storage`);equal(report.errors,[],`Renderer ${phase} reported errors`);equal(recordedDirectory(report.directory),archiveDirectory,`Renderer ${phase} archive directory differs`);
    assert(Array.isArray(report.checks)&&new Set(report.checks).size===report.checks.length,`Renderer ${phase} checks invalid`);for(const check of BULK_IMPORT_CHECKS[phase])assert(report.checks.includes(check),`Missing native bulk check: ${check}`);
    assert(Array.isArray(report.importReports)&&report.importReports.length<=32,`Renderer ${phase} import observations invalid`);
    const expected=Array.from({length:host.actions},(_,index)=>[`action-${phase}-${index+1}.json`,`result-${phase}-${index+1}.json`]).flat().sort();equal(allNames.filter(name=>name.startsWith(`action-${phase}-`)||name.startsWith(`result-${phase}-`)).sort(),expected,`Native ${phase} action/result files must be bounded and sequential`);
    const actions=[];for(let sequence=1;sequence<=host.actions;sequence++){
      const action=await json(`action-${phase}-${sequence}.json`,16*1024),result=await json(`result-${phase}-${sequence}.json`,256*1024);
      assert(action.version===1&&action.sequence===sequence&&['click','key-r','picker','cancel-picker'].includes(action.kind)&&[action.x,action.y,action.width,action.height].every(Number.isFinite)&&action.width>0&&action.height>0&&action.x>=0&&action.x<action.width&&action.y>=0&&action.y<action.height,`Invalid native ${phase} action ${sequence}`);assert(result.ok===true,`Native ${phase} action ${sequence} failed`);
      if(['picker','cancel-picker'].includes(action.kind)){
        const owner=result.owned_dialog,completion=result.picker_completion;assert(object(owner)&&positive(owner.hwnd)&&owner.class==='#32770'&&owner.process_id===host.process_id&&owner.app_process_id===host.process_id&&positive(owner.app_hwnd)&&owner.root_owner_hwnd===owner.app_hwnd,`Native ${phase} picker is not owned by recorded app process`);
        assert(object(completion)&&completion.dialog_dismissed===true&&completion.app_enabled===true&&completion.owned_popup_visible===false,`Native ${phase} picker completion missing`);
        if(action.kind==='picker')assert(typeof action.file==='string'&&ordinaryPath(action.file)&&!action.file.includes('/'),`Native ${phase} picker fixture invalid`);else assert(!Object.hasOwn(action,'file'),`Native ${phase} canceled picker selected a file`);
      }actions.push(action);
    }actionsByPhase[phase]=actions;validateBulkChooserObservations(report.chooserObservations,actions);
    const checkpoints=phase==='bulk-seed'?['preflight','saved','history']:phase==='bulk-restart'?['history']:['failure'];exactKeys(report.screenshots,checkpoints,`Native ${phase} screenshot checkpoints missing`);assert(new Set(Object.values(report.screenshots)).size===checkpoints.length,'Native screenshot checkpoints must have distinct actions');for(const checkpoint of checkpoints){const sequence=report.screenshots[checkpoint];assert(positive(sequence)&&sequence<=host.actions&&actions[sequence-1].kind==='click',`Native ${phase} screenshot checkpoint does not reference actual click`);validatePng(await bytes(`native-action-${phase}-${sequence}.png`,25*1024*1024),`${phase} ${checkpoint}`);}
    screenshots[phase]=validatePng(await bytes(`native-${phase}.png`,25*1024*1024),phase);
  }
  const seed=reports['bulk-seed'],restart=reports['bulk-restart'],failure=reports['bulk-failure'],fixtures=bulkAcceptanceFixtures(),scores=fixtureScoreBytes(fixtures);
  equal(await json('fixtures/bulk-fixtures.json',64*1024),fixtures.manifest,'Generated fixture manifest differs from the authored source');
  for(const [name,expected]of fixtures.files)assert((await bytes(`fixtures/${name}`)).equals(expected),`Generated fixture differs from authored bytes: ${name}`);
  assert(Array.isArray(seed.inventory)&&seed.inventory.length===3&&new Set(seed.inventory.map(value=>value.key)).size===3,'Seed inventory needs three distinct saved editions');equal(restart.inventory,seed.inventory,'Restart changed native inventory');if(failure.inventory!==undefined)equal(failure.inventory,seed.inventory,'Failure changed native inventory');
  equal(seed.inventory.map(value=>value.key).sort(),scores.map(value=>value.key).sort(),'Native inventory differs from authored bulk score identities');
  const archiveRows=[],scorePayloads=new Map();
  await names(join(directory,'Scores'));
  for(const area of ['songs','backups']){
    equal(await names(join(directory,'Scores',area)),scores.map(value=>value.key).sort(),`Scores/${area} has missing or unlisted archives`);
    for(const fixture of scores){const prefix=`Scores/${area}/${fixture.key}`;equal(await names(join(directory,prefix)),['metadata.json','score.json','source.payload'],`${prefix} has missing or unlisted files`);
      const entry=await json(`${prefix}/metadata.json`,64*1024),raw=await bytes(`${prefix}/score.json`),source=await bytes(`${prefix}/source.payload`);assert(raw.equals(fixture.bytes),`${prefix}/score.json differs from exact authored bytes`);assert(source.equals(Buffer.from(fixture.score.source.content)),`${prefix} retained source differs`);
      exactKeys(entry,ENTRY_FIELDS,`${prefix} metadata fields differ from native Entry`);assert(entry.library_format_version===1&&entry.revision===1&&entry.key===fixture.key&&entry.content_sha256===fixture.key.slice(5)&&entry.score_sha256===hash(raw)&&entry.score_bytes===raw.length&&entry.score_id===fixture.score.id&&entry.title===fixture.score.title&&entry.composer===fixture.score.composer&&entry.label===fixture.score.title&&positive(entry.saved_at_unix_ms),`${prefix} metadata differs from exact score bytes`);
      equal(entry.provenance,fixture.score.provenance,'Native score lost provenance');equal(entry.retained_source,{format:fixture.score.source.format,filename:fixture.score.source.filename,bytes:source.length,sha256:hash(source)},'Native retained source descriptor differs');equal(entry,seed.inventory.find(value=>value.key===entry.key),'Native disk metadata differs from inventory');scorePayloads.set(entry.key,raw);
      for(const name of ['metadata.json','score.json','source.payload']){const row=files.find(value=>value.path===`${prefix}/${name}`);archiveRows.push({...row,path:row.path.slice(7)});if(area==='backups'){const primary=files.find(value=>value.path===`Scores/songs/${fixture.key}/${name}`);assert(row.sha256===primary.sha256&&row.bytes===primary.bytes,'Native score backup is not byte-identical');}}
    }
  }
  exactKeys(seed.files,SEED_ROLES,'Seed needs six distinct export roles');exactKeys(restart.files,['original'],'Restart needs retained original export');assert(new Set(Object.values(seed.files)).size===6,'Seed export filenames must be distinct');
  const downloads={};for(const [phase,roles]of [['bulk-seed',SEED_ROLES],['bulk-restart',['original']],['bulk-failure',[]]]){
    const report=reports[phase];assert(Array.isArray(report.downloads)&&report.downloads.length===roles.length,`Native ${phase} download count differs`);
    for(const role of roles){const name=report.files[role],extension=['original','unified'].includes(role)?'zip':'json';assert(typeof name==='string'&&new RegExp(`^${phase}-(?:[1-9]|1[0-6])\\.${extension}$`).test(name)&&!/[\r\n]/.test(name),'Invalid native download filename');const matches=report.downloads.filter(value=>value?.file===name);assert(matches.length===1&&matches[0].complete===true&&matches[0].success===true,`Missing successful native ${role} download`);downloads[`${phase}:${role}`]=await bytes(`downloads/${name}`,16*1024*1024);}
  }
  const original=fixtures.files.get('原创曲包_日本語.zip');for(const phase of ['bulk-seed','bulk-restart'])assert(downloads[`${phase}:original`].equals(original),`${phase} original export differs from exact authored ZIP bytes`);
  const unified=downloads['bulk-seed:unified'],zip=readBulkEvidenceZip(unified),manifest=parse(zip.get('manifest.json')||Buffer.alloc(0),'unified manifest');equal(manifest,{format:'worldmusichub-song-pack',version:1,songs:manifest.songs},'Unified ZIP manifest format invalid');assert(Array.isArray(manifest.songs)&&manifest.songs.length===3,'Unified ZIP must contain three saved editions');
  equal(manifest.songs.map(value=>value.folder).sort(),scores.map(value=>`songs/${value.key}`).sort(),'Unified ZIP manifest selection differs from native inventory');const members=['manifest.json'];
  for(const fixture of scores){const prefix=`songs/${fixture.key}`;members.push(`${prefix}/score.json`,`${prefix}/metadata.json`);assert(zip.get(`${prefix}/score.json`)?.equals(scorePayloads.get(fixture.key)),'Unified ZIP canonical score differs from exact native archive bytes');const metadata=parse(zip.get(`${prefix}/metadata.json`)||Buffer.alloc(0),'unified metadata');equal(metadata,{format:'worldmusichub-song',version:1,title:fixture.score.title,score:'score.json',sources:[],media:{},label:fixture.score.title},'Unified ZIP song metadata differs');}equal([...zip.keys()].sort(),members.sort(),'Unified ZIP contains unlisted or missing files');
  const takeValues=Object.fromEntries(['beforeScore','beforeTake','afterScore','afterTake'].map(role=>[role,parse(downloads[`bulk-seed:${role}`],role)]));equal(takeValues.beforeScore,takeValues.afterScore,'Canonical score changed during bulk import');const boundaryCounts=validateBulkTakePreservation(takeValues.beforeTake,takeValues.afterTake,seed.chooserObservations,actionsByPhase['bulk-seed']);assert(takeValues.beforeScore?.version===1&&typeof takeValues.beforeScore.id==='string'&&takeValues.beforeTake.score_id===takeValues.beforeScore.id,'Active score/take identity mismatch');const takeCounts=validateTransportAndTake(seed.transportAdmission,takeValues.beforeTake,actionsByPhase['bulk-seed']);
  const sourceFiles=new Map(fixtures.files);sourceFiles.set(seed.files.unified,unified);
  for(const phase of BULK_IMPORT_PHASES)for(const row of reports[phase].importReports){assert(sourceFiles.has(row.filename),'Native import filename is not an authored fixture or verified export');validateReport(row,sourceFiles.get(row.filename),seed.inventory);}
  const expectedPickers=['原创曲包_日本語.zip','原创曲包_日本語.zip','bulk-backup.json','bulk-multiple','bulk-conflict.zip',seed.files.unified,'bulk-malformed.zip'];equal(actionsByPhase['bulk-seed'].filter(value=>value.kind==='picker').map(value=>value.file),expectedPickers,'Seed actual picker sequence differs');assert(actionsByPhase['bulk-seed'].filter(value=>value.kind==='cancel-picker').length===1,'Seed requires one actual canceled picker');equal(actionsByPhase['bulk-restart'].filter(value=>['picker','cancel-picker'].includes(value.kind)),[],'Restart unexpectedly imported');equal(actionsByPhase['bulk-failure'].filter(value=>value.kind==='picker').map(value=>value.file),['bulk-failure.zip'],'Failure requires actual failure fixture picker');
  const observations=seed.importReports,shape=row=>[row.filename,row.mode,row.index,row.keepBoth];const expected=[];for(const filename of expectedPickers){if(filename==='bulk-multiple'){for(const mode of ['preview','commit'])for(const source of ['bulk-standard-a.json','bulk-standard-b.json'])expected.push([source,mode,null,false]);continue;}if(filename==='bulk-malformed.zip'){expected.push([filename,'preview',null,false]);continue;}expected.push([filename,'preview',null,false],[filename,'commit',null,false]);if(filename==='bulk-conflict.zip')expected.push([filename,'commit',0,true]);}equal(observations.map(shape),expected,'Seed import observations must prove ordered previews, commits and explicit per-item Keep both');
  counts(observations[0],{ready:2,retained_nonplayable:1},'Original preflight must validate two playable and one retained-only source');counts(observations[1],{saved:2,retained_nonplayable:1},'Original commit must save two songs and retain unsupported source');
  for(const index of [2,3])counts(observations[index],{duplicate:2,retained_nonplayable:1},'Repeat ZIP must deduplicate both playable songs');for(const index of [4,5])counts(observations[index],{duplicate:2},'Backup must deduplicate both songs');for(const index of [6,7,8,9])counts(observations[index],{duplicate:1},'Multiple-file chooser must deduplicate each selected source');for(const index of [10,11])counts(observations[index],{conflict:1},'Conflicting edition must require explicit Keep both');counts(observations[12],{saved:1},'Explicit per-item Keep both must save one edition');for(const index of [13,14])counts(observations[index],{duplicate:3},'Unified ZIP must reimport as three duplicates');assert(observations[15].status>=400&&observations[15].body.code==='pack_invalid','Malformed ZIP was not rejected before save');equal(restart.importReports,[],'Restart unexpectedly committed import');
  assert(failure.importReports.length===2,'Failure requires preview and failed native commit');equal(failure.importReports.map(shape),[['bulk-failure.zip','preview',null,false],['bulk-failure.zip','commit',null,false]],'Failure import observations differ');counts(failure.importReports[0],{ready:1},'Failure preflight must preserve usable selected file');const failed=failure.importReports[1],visible=failure.failure;assert(failed.status>=400&&['library_unsafe_path','library_io'].includes(failed.body.code)&&object(visible)&&visible.filename==='bulk-failure.zip'&&visible.code===failed.body.code&&visible.persistence==='not-saved'&&visible.retryVisible===true&&typeof visible.message==='string'&&visible.message.trim().length>0,'Failed native import lacks actionable visible retry and no-fallback outcome');
  assert(object(restart.audition)&&positive(restart.audition.sourceStarts)&&restart.audition.activeSources===0&&restart.audition.pendingSources===0,'Restart saved-song audition lacks positive cleaned-up audio');
  const committed=observations.filter(value=>value.mode==='commit'&&value.status===200),archiveKeys=[...new Set(committed.map(value=>value.body.source.archive_key))].sort();
  for(const area of ['imports','import-backups']){equal(await names(join(directory,'Scores',area)),archiveKeys,`Scores/${area} has missing or unlisted retained archives`);for(const key of archiveKeys){const prefix=`Scores/${area}/${key}`,members=await names(join(directory,prefix)),receipts=members.filter(name=>/^report-[0-9]{32}-[0-9]{20}\.json$/.test(name)),expectedReports=committed.filter(value=>value.body.source.archive_key===key);equal(members,[...receipts,'source.bin','source.json','inventory.json'].sort(),'Retained import archive contains unlisted files');assert(receipts.length===expectedReports.length,'Retained import receipts do not cover every native commit');const descriptor=await json(`${prefix}/source.json`,4096),payload=await bytes(`${prefix}/source.bin`),inventory=await json(`${prefix}/inventory.json`,1024*1024);equal(descriptor,expectedReports[0].body.source,'Retained import descriptor differs from native source');assert(payload.equals(sourceFiles.get(descriptor.filename)),'Retained import source differs from exact selected bytes');equal(inventory,expectedReports[0].body.inventory,'Retained import inventory differs from exact bytes');const pending=expectedReports.map(value=>value.body);for(const receipt of receipts){const value=await json(`${prefix}/${receipt}`,4*1024*1024),index=pending.findIndex(report=>isDeepStrictEqual(report,value));assert(index>=0,'Retained import receipt differs from native response');pending.splice(index,1);}for(const name of members){const row=files.find(value=>value.path===`${prefix}/${name}`);archiveRows.push({...row,path:row.path.slice(7)});if(area==='import-backups'){const primary=files.find(value=>value.path===`Scores/imports/${key}/${name}`);assert(primary&&row.sha256===primary.sha256&&row.bytes===primary.bytes,'Retained import backup is not byte-identical');}}}}
  for(const area of ['.staging','.import-staging'])equal(await names(join(directory,'Scores',area)),[],`Failure ${area} blocker must be restored to empty directory`);
  for(const phase of BULK_IMPORT_PHASES){const snapshot=await json(`snapshot-${phase}.json`,1024*1024);assert(snapshot.version===1&&Array.isArray(snapshot.files),'Native snapshot missing');equal(sorted(snapshot.files),sorted(archiveRows),`${phase} snapshot does not match exact unchanged archive bytes`);}
  return{version:1,ok:true,scenario:'bulk-import',source_sha:native.source_sha,source_tree:native.source_tree,executable_sha256:native.executable_sha256,executable_bytes:native.executable_bytes,native_report_sha256:files.find(value=>value.path==='native-bulk-import.json').sha256,renderer_sha256:Object.fromEntries(BULK_IMPORT_PHASES.map(phase=>[phase,files.find(value=>value.path===`renderer-${phase}.json`).sha256])),entry_count:3,retained_archive_count:archiveKeys.length,original_sha256:hash(original),unified_sha256:hash(unified),...takeCounts,...boundaryCounts,screenshots,files:sorted(files)};
}

async function main(){
  const args=process.argv.slice(2),check=args.includes('--check'),directories=args.filter(value=>value!=='--check');assert(directories.length<=1&&args.filter(value=>value==='--check').length<=1&&!directories.some(value=>value.startsWith('--')),'Usage: node scripts/verify-native-bulk-import-evidence.mjs [--check] [evidence-directory]');
  const directory=resolve(directories[0]||'bulk-import-acceptance'),output=join(directory,'native-bulk-import-files.json');if(!check)await rm(output,{force:true});const proof=await verifyNativeBulkImportEvidence(directory);
  if(check)equal(parse(await readOrdinary(directory,'native-bulk-import-files.json',4*1024*1024),'native-bulk-import-files.json'),proof,'Stored native bulk-import proof differs from verified reports and bytes');else await writeFile(output,JSON.stringify(proof,null,2)+'\n');
  console.log(`Verified three native bulk-import editions, exact originals/backups, fresh-profile restart, unchanged score/take and blocked-save recovery${check?'; stored proof matches':''}`);
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href)main().catch(error=>{console.error(error.message);process.exitCode=1;});
