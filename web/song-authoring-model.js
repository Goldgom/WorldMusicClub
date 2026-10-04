import {createBulkImportTransport,isImportOutcomeUnconfirmed} from './bulk-import.js';

export const AUTHORING_LIMITS=Object.freeze({files:10,fileBytes:5*1024*1024,totalBytes:20*1024*1024});
const issue=(code,message,persistence='not-saved')=>Object.assign(new Error(message),{code,persistence});
const failure=error=>({code:error?.code||'authoring_failed',message:error?.message||String(error),persistence:error?.persistence||'not-saved'});
const validCount=value=>Number.isSafeInteger(value)&&value>=0;
const utf8=value=>new TextEncoder().encode(value).byteLength;
const safeTitle=value=>typeof value==='string'&&Boolean(value.trim())&&!/[\u0000-\u001f\u007f-\u009f]/u.test(value)&&utf8(value.trim())<=1000;
const supported=new Set(['strict_notation_candidate','event_only_reference_candidate','rejected']);
const stale=(signal)=>signal?.throwIfAborted();

/** Only the Rust envelope is interpreted. Raw metadata and score strings are opaque. */
export function checkAuthoringDraft(value,{sourceName,title}={}){
 if(!supported.has(value?.state)||value.source_name!==sourceName||value.title!==title||value.source?.format!=='midi'||!validCount(value.source.bytes)||!/^[a-f0-9]{64}$/.test(value.source.sha256)||!Array.isArray(value.diagnostics)||value.diagnostics.some(row=>typeof row.code!=='string'||typeof row.message!=='string'||typeof row.action!=='string'))throw issue('authoring_invalid_response','The conversion report is incomplete.');
 const inventory=value.inventory;
 if(inventory!==null){
  if(!inventory||!validCount(inventory.source_tracks)||!validCount(inventory.source_events)||!Array.isArray(inventory.tracks)||inventory.tracks.length!==inventory.source_tracks||!validCount(inventory.key_attacks)||!validCount(inventory.key_releases)||!Array.isArray(inventory.parts))throw issue('authoring_invalid_response','The complete source inventory is missing.');
  const tracks=new Set();
  for(const row of inventory.tracks){
   if(!validCount(row.source_index)||tracks.has(row.source_index)||typeof row.track_id!=='string'||typeof row.name!=='string'||!validCount(row.source_event_count)||!validCount(row.key_attacks)||!validCount(row.key_releases)||!Array.isArray(row.channels)||row.channels.some(channel=>!validCount(channel.channel)||channel.channel>15||!validCount(channel.source_event_count)||!validCount(channel.key_attacks)||!validCount(channel.key_releases)))throw issue('authoring_invalid_response','A source track is missing or malformed.');
   tracks.add(row.source_index);
  }
  for(const part of inventory.parts)if(typeof part.id!=='string'||typeof part.track_id!=='string'||!validCount(part.channel)||part.channel>15||typeof part.notation_available!=='boolean')throw issue('authoring_invalid_response','A converted part is malformed.');
  if(inventory.tracks.reduce((sum,row)=>sum+row.source_event_count,0)!==inventory.source_events||inventory.tracks.reduce((sum,row)=>sum+row.key_attacks,0)!==inventory.key_attacks||inventory.tracks.reduce((sum,row)=>sum+row.key_releases,0)!==inventory.key_releases)throw issue('authoring_invalid_response','The source totals do not match the complete track inventory.');
 }
 if(value.state==='rejected'){if(value.draft_sha256!==null||value.package!==null)throw issue('authoring_invalid_response','A held conversion cannot expose a save package.');}
 else if(!/^[a-f0-9]{64}$/.test(value.draft_sha256)||!inventory||typeof value.package?.metadata_json!=='string'||!value.package.metadata_json.length||typeof value.package?.score_json!=='string'||!value.package.score_json.length)throw issue('authoring_invalid_response','The complete clean package is missing.');
 return value;
}

export function createAuthoringTransport({fetcher=globalThis.fetch,origin=globalThis.location?.origin}={}){
 const requests=new WeakMap();
 let expected;try{expected=new URL(origin).origin}catch{throw issue('authoring_environment','The local app origin could not be verified.');}
 if(expected==='null')throw issue('authoring_environment','The local app origin could not be verified.');
 async function request(path,body,{signal}={}){
  stale(signal);let response;
  try{response=await fetcher(path,{method:'POST',body:JSON.stringify(body),headers:{'Content-Type':'application/json'},signal,credentials:'same-origin',redirect:'error',cache:'no-store'});}catch(error){if(error?.name==='AbortError')throw error;throw issue('authoring_transport','The conversion service could not be reached.');}
  stale(signal);
  if(response.redirected||(response.url&&new URL(response.url,origin).origin!==expected))throw issue('authoring_environment','The conversion response left the local app.');
  let value;try{value=await response.json();}catch{throw issue('authoring_invalid_response','The conversion service returned an unreadable report.');}
  stale(signal);
  if(!response.ok&&!(response.status===422&&value?.state==='rejected'))throw issue(value?.code||'authoring_failed',value?.error||'The conversion could not finish.');
  return value;
 }
 return{
  async draft(file,{title,signal}={}){
   const bytes=new Uint8Array(await file.arrayBuffer());stale(signal);
   if(bytes.length!==file.size)throw issue('authoring_source_changed','The file changed while reading. Select the complete original again.');
   let binary='';for(let offset=0;offset<bytes.length;offset+=32768)binary+=String.fromCharCode(...bytes.subarray(offset,offset+32768));
   const input={source_base64:btoa(binary),source_name:file.name,title};
   const value=checkAuthoringDraft(await request('/api/clean-song/draft',input,{signal}),{sourceName:file.name,title});
   requests.set(value,input);return value;
  },
  async pack(draft,{signal}={}){
   const input=requests.get(draft);if(!input||!draft.package)throw issue('authoring_invalid_response','Select the complete MIDI again to prepare a package.');
   const value=await request('/api/clean-song/draft/pack',{...input,expected_draft_sha256:draft.draft_sha256},{signal});
   if(value?.draft_sha256!==draft.draft_sha256||typeof value.zip_base64!=='string'||!value.zip_base64.length||value.zip_base64.length>16*1024*1024||!/^[A-Za-z0-9+/]*={0,2}$/.test(value.zip_base64))throw issue('authoring_invalid_response','The generated package does not match the reviewed conversion.');
   let data;try{data=Uint8Array.from(atob(value.zip_base64),character=>character.charCodeAt(0));}catch{throw issue('authoring_invalid_response','The complete package bytes are invalid.');}
   if(data.length<4||data[0]!==80||data[1]!==75||data[2]!==3||data[3]!==4)throw issue('authoring_invalid_response','The complete package is not a ZIP.');
   return new Blob([data],{type:'application/zip'});
  }
 };
}

/** Draft ownership is separate from playback, the canonical score, and recorded takes. */
export class SongAuthoringModel{
 constructor({transport,imports,getStorageKind=async()=> 'browser',onCommitted=async()=>{},onObserverError=error=>globalThis.reportError?.(error)}={}){
  this.transport=transport||createAuthoringTransport();this.imports=imports||createBulkImportTransport();this.getStorageKind=getStorageKind;this.onCommitted=onCommitted;this.onObserverError=onObserverError;
  this.listeners=new Set();this.sources=new Map();this.artifacts=new Map();this.generation=0;this.sequence=0;this.controller=null;this.pendingWrites=0;this.destroyed=false;
  this.state={phase:'idle',kind:null,rows:[],error:null,refreshError:null};
 }
 snapshot(){return structuredClone({...this.state,pendingWrites:this.pendingWrites});}
 subscribe(listener){this.listeners.add(listener);return()=>this.listeners.delete(listener);}
 publish(patch={}){if(this.destroyed)return;Object.assign(this.state,patch);for(const listener of this.listeners)try{listener(this.snapshot());}catch(error){this.onObserverError(error);}}
 current(generation,signal){return !this.destroyed&&generation===this.generation&&!signal?.aborted;}
 get busy(){return this.pendingWrites>0||['converting','saving'].includes(this.state.phase);}
 async select(input){
  if(this.pendingWrites){this.publish({error:failure(issue('authoring_busy','A native save is still completing.'))});return false;}
  const files=Array.from(input||[]);if(!files.length)return false;
  this.cancel();this.sources.clear();this.artifacts.clear();this.state.rows=[];
  if(files.length>AUTHORING_LIMITS.files||files.some(file=>!validCount(file.size))||files.reduce((sum,file)=>sum+file.size,0)>AUTHORING_LIMITS.totalBytes){this.publish({phase:'review',error:failure(issue('authoring_selection_limit','Select at most 10 files totaling 20 MiB. The entire selection was refused.'))});return false;}
  this.state.rows=files.map(file=>{const id=String(++this.sequence);this.sources.set(id,file);return{id,name:file.name,bytes:file.size,title:String(file.name).replace(/\.(mid|midi)$/i,'')||'MIDI',phase:'queued',draft:null,result:null,error:null,downloaded:false};});
  return this.convert(this.state.rows.map(row=>row.id));
 }
 async convert(ids){
  if(this.busy)return false;
  const generation=++this.generation;this.controller=new AbortController();const signal=this.controller.signal;
  this.publish({phase:'converting',error:null,refreshError:null});
  try{
   const kind=await this.getStorageKind();if(!this.current(generation,signal))return false;
   if(!['native','browser'].includes(kind))throw issue('authoring_environment','The storage environment is unconfirmed.');
   this.publish({kind});
   for(const id of ids){
    if(!this.current(generation,signal))return false;
    const row=this.state.rows.find(item=>item.id===id),file=this.sources.get(id);if(!row||!file)continue;
    row.phase='converting';row.error=null;row.draft=null;row.result=null;row.reportSource=null;row.downloaded=false;this.artifacts.delete(id);this.publish();
    try{
     if(!/\.(mid|midi)$/i.test(file.name))throw issue('authoring_format','Choose a standard .mid or .midi file.');
     if(!file.size||file.size>AUTHORING_LIMITS.fileBytes)throw issue('authoring_file_limit','Each complete MIDI file must be nonempty and at most 5 MiB.');
     if(!safeTitle(row.title)||utf8(file.name)>255||/[\u0000-\u001f\u007f-\u009f]/u.test(file.name))throw issue('authoring_title','Use a nonempty title and filename without control characters.');
     const title=row.title.trim(),draft=await this.transport.draft(file,{title,signal});if(!this.current(generation,signal))return false;
     row.title=title;row.draft=draft;
     if(draft.state==='rejected'){row.phase='held';this.publish();continue;}
     const blob=await this.transport.pack(draft,{signal});if(!this.current(generation,signal))return false;
     const pack=new Blob([blob],{type:'application/zip'});Object.defineProperty(pack,'name',{value:`song-${draft.source.sha256.slice(0,16)}.wmhpack`});
     this.artifacts.set(id,pack);
     if(kind==='native'){
      const report=await this.imports.preview(pack,{signal});if(!this.current(generation,signal))return false;
      row.result=this.singleResult(report);row.reportSource=report.source;
      row.phase=this.resultPhase(row.result);
     }else row.phase='ready';
    }catch(error){if(!this.current(generation,signal))return false;row.error=failure(error);row.phase='failed';}
    this.publish();
   }
   if(this.current(generation,signal))this.publish({phase:'review'});return true;
  }catch(error){if(!this.current(generation,signal))return false;this.publish({phase:'review',error:failure(error)});return false;}
 }
 singleResult(report,committed=false){if(report?.items?.length!==1)throw issue(committed?'library_commit_uncertain':'authoring_invalid_response','The clean package report must contain exactly one complete song.',committed?'unknown':'not-saved');return report.items[0];}
 resultPhase(result){return isImportOutcomeUnconfirmed(result)?'uncertain':({ready:'ready',saved:'saved',duplicate:'duplicate',conflict:'conflict',retained_nonplayable:'held',error:'failed'}[result.status]||'held');}
 editTitle(id,title){
  if(this.busy)return false;const row=this.state.rows.find(item=>item.id===id);if(!row)return false;
  this.generation++;row.title=title;row.phase='edited';row.draft=null;row.result=null;row.error=null;row.downloaded=false;this.artifacts.delete(id);this.publish();return true;
 }
 retry(id){return this.convert([id]);}
 cancel(){
  this.generation++;this.controller?.abort();
  for(const row of this.state.rows){if(row.phase==='saving'){row.phase='uncertain';row.error=failure(issue('library_commit_uncertain','A save was sent. Rescan or retry the same package to confirm the result.','unknown'));}else if(['queued','converting'].includes(row.phase))row.phase='cancelled';}
  if(['saving','converting'].includes(this.state.phase))this.publish({phase:'cancelled'});
 }
 async save(id,{keepBoth=false}={}){
  if(this.busy||this.state.kind!=='native')return false;
  const selected=this.state.rows.filter(row=>(id===undefined?row.phase==='ready':row.id===id)&&this.artifacts.has(row.id)&&row.reportSource&&row.result&&row.draft?.state!=='rejected'&&['ready','conflict','uncertain','failed'].includes(row.phase));
  if(!selected.length||selected.some(row=>row.phase==='conflict'&&!keepBoth))return false;
  const generation=++this.generation;this.publish({phase:'saving',error:null,refreshError:null});
  for(const row of selected){
   if(!this.current(generation))break;
   row.phase='saving';row.error=null;this.pendingWrites++;this.publish();
   try{
    const report=await this.imports.commit(this.artifacts.get(row.id),{sha256:row.reportSource?.sha256,...(keepBoth?{keepBoth:true,index:row.result?.index}:{})});
    if(this.current(generation)){row.result=this.singleResult(report,true);row.reportSource=report.source;row.phase=this.resultPhase(row.result);}
   }catch(error){if(this.current(generation)){row.error=failure(error);row.phase=row.error.persistence==='unknown'?'uncertain':'failed';}}
   finally{
    // A native write may have completed even after leaving. Refresh inventory only;
    // never activate a song, navigate, revive a discarded draft or accept stale status.
    try{await this.onCommitted();}catch{if(this.current(generation))this.state.refreshError=failure(issue('authoring_refresh','The saved-song list could not refresh. Rescan it.'));}
    this.pendingWrites--;this.publish();
   }
  }
  if(this.current(generation))this.publish({phase:'review'});return true;
 }
 async refresh(){const generation=this.generation;try{await this.onCommitted();if(this.current(generation))this.publish({refreshError:null});return true;}catch(error){if(this.current(generation))this.publish({refreshError:failure(issue('authoring_refresh',error?.message||'The song library could not refresh.'))});return false;}}
 async export(id){
  const row=this.state.rows.find(item=>item.id===id);if(!row||this.busy||row.phase==='held'||!this.artifacts.has(id))return null;
  const generation=this.generation;
  const blob=row.result?.entry&&['saved','duplicate'].includes(row.phase)?await this.imports.exportPack([{...row.result.entry,storageKind:'native',storageKey:row.result.entry.key,clean_package:row.result.clean_package||row.result.entry.clean_package}]):this.artifacts.get(id);
  return this.current(generation)?{blob,filename:`song-${row.draft.source.sha256.slice(0,16)}.wmhpack`,id,generation}:null;
 }
 exported({id,generation}){if(this.current(generation)){const row=this.state.rows.find(item=>item.id===id);if(row){row.downloaded=true;this.publish();}}}
 downloadFailed(id,error){const row=this.state.rows.find(item=>item.id===id);if(row){row.error=failure(issue('authoring_download',error?.message||'The complete package could not download.'));this.publish();}}
 destroy(){this.cancel();this.destroyed=true;this.listeners.clear();this.sources.clear();this.artifacts.clear();}
}
