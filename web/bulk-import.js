/** Import jobs retain File objects; canonical scores stay in the existing Rust/storage path. */
export const BULK_IMPORT_LIMITS=Object.freeze({files:100,fileBytes:8*1024*1024,backupBytes:40*1024*1024,zipBytes:128*1024*1024,totalBytes:512*1024*1024,items:10000});
const statuses=new Set(['ready','saved','duplicate','conflict','retained_nonplayable','error']);
const nativeKey=/^song-[0-9a-f]{64}$/;
const issue=(code,message,persistence='not-saved')=>Object.assign(new Error(message),{code,persistence});
const failure=error=>({code:error?.code||'pack_request_failed',message:error?.message||String(error),persistence:error?.persistence||'not-saved'});
const isZip=name=>/\.(zip|wmhpack)$/i.test(name);
export const isImportOutcomeUnconfirmed=item=>item?.status==='error'&&item.code==='library_commit_uncertain';
export function isImportEnvelope(value){return ['worldmusichub-library-backup','worldmusichub-native-score-backup','worldmusichub-song-pack'].includes(value?.format)}
function checkFile(file){
 const limit=isZip(file.name)?BULK_IMPORT_LIMITS.zipBytes:/\.json$/i.test(file.name)?BULK_IMPORT_LIMITS.backupBytes:BULK_IMPORT_LIMITS.fileBytes;
 if(!Number.isSafeInteger(file.size)||file.size<1)throw issue('pack_empty_file','The selected file is empty or unreadable.');
 if(file.size>limit)throw issue('pack_file_limit',`This file exceeds the ${limit/(1024*1024)} MiB import limit. The original has not been changed.`);
}

function checkedReport(value,{mode,filename,sha256}={}){
 if(value?.format!=='worldmusichub-import-report'||value.version!==1||value.mode!==mode||value.source?.filename!==filename||!Number.isSafeInteger(value.source?.bytes)||value.source.bytes<0||!/^[0-9a-f]{64}$/.test(value.source?.sha256)||!Array.isArray(value.items)||value.items.length>BULK_IMPORT_LIMITS.items||!Array.isArray(value.warnings)||value.warnings.some(item=>typeof item!=='string'))throw issue('pack_invalid_response','The importer returned an incomplete report.',mode==='commit'?'unknown':'not-saved');
 if(sha256&&value.source.sha256!==sha256)throw issue('pack_source_changed','The saved report does not match the source that was reviewed.','unknown');
 const indices=new Set();
 for(const item of value.items){
  if(!Number.isSafeInteger(item.index)||item.index<0||indices.has(item.index)||typeof item.path!=='string'||typeof item.title!=='string'||!statuses.has(item.status)||typeof item.playable!=='boolean'||typeof item.code!=='string'||typeof item.message!=='string'||(['saved','duplicate'].includes(item.status)&&(!item.playable||!nativeKey.test(item.entry?.key))))throw issue('pack_invalid_response','The importer returned an invalid song result.',mode==='commit'?'unknown':'not-saved');
  indices.add(item.index);
 }
 return value;
}

/** All requests are same-origin. A commit is never aborted once sent. */
export function createBulkImportTransport({fetcher=globalThis.fetch,origin=globalThis.location?.origin}={}){
 let expected;try{expected=new URL(origin).origin}catch{throw issue('pack_environment_unknown','The local app origin could not be verified.')}
 if(expected==='null')throw issue('pack_environment_unknown','The local app origin could not be verified.');
 async function request(path,{body,headers,signal,commit=false,raw=false}={}){
  let response;
  try{response=await fetcher(path,{method:body===undefined?'GET':'POST',body,headers,signal:commit?undefined:signal,credentials:'same-origin',redirect:'error',cache:'no-store'})}
  catch(error){if(!commit&&error?.name==='AbortError')throw error;throw issue(commit?'library_commit_uncertain':'pack_transport',commit?'The save response was lost. Refresh the saved-song list and retry this same source to confirm its result.':'The local importer could not be reached.',commit?'unknown':'not-saved')}
  if(response.redirected||(response.url&&new URL(response.url,origin).origin!==expected))throw issue('pack_environment_unknown','The importer response left the local app origin.',commit?'unknown':'not-saved');
  if(raw&&response.ok)return response.blob();
  let value;try{value=await response.json()}catch{throw issue('pack_invalid_response','The importer returned an unreadable response.',commit?'unknown':'not-saved')}
  if(!response.ok)throw issue(value?.code||'pack_request_failed',value?.error||'The import request failed.',value?.code==='library_commit_uncertain'?'unknown':'not-saved');
  return value;
 }
 async function send(file,mode,{signal,keepBoth=false,index,sha256}={}){
  const headers={'Content-Type':'application/octet-stream','x-wmh-filename':encodeURIComponent(file.name),'x-wmh-conflict':keepBoth?'keep-both':'skip'};
  if(index!==undefined)headers['x-wmh-item-index']=String(index);
  const value=await request(`/api/library/import/${mode}`,{body:file,headers,signal,commit:mode==='commit'});
  return checkedReport(value,{mode,filename:file.name,sha256});
 }
 return{
  preview:(file,options)=>send(file,'preview',options),commit:(file,options)=>send(file,'commit',options),
  async history({signal,cursor}={}){if(cursor!==undefined&&!/^\d+$/.test(String(cursor)))throw issue('pack_invalid_cursor','Choose a valid history page.');const value=await request('/api/library/imports'+(cursor===undefined?'':`?cursor=${encodeURIComponent(cursor)}`),{signal});if(value?.format!=='worldmusichub-import-history'||value.version!==1||!Array.isArray(value.imports)||!Array.isArray(value.issues)||(value.next_cursor!=null&&!/^\d+$/.test(value.next_cursor)))throw issue('pack_invalid_response','Import history could not be read.');return value},
  async original(receipt){if(typeof receipt?.archive_key!=='string'||!receipt.archive_key)throw issue('pack_invalid_archive','Choose a retained original from import history.');return request('/api/library/import/export',{body:JSON.stringify({archive_key:receipt.archive_key}),headers:{'Content-Type':'application/json'},raw:true})},
  async exportPack(entries){const keys=entries.filter(entry=>entry.storageKind==='native').map(entry=>entry.storageKey);if(!keys.length||keys.length>1024||keys.some(key=>!nativeKey.test(key))||new Set(keys).size!==keys.length)throw issue('pack_invalid_selection','Choose between 1 and 1024 saved native editions.');return request('/api/library/pack/export',{body:JSON.stringify({keys}),headers:{'Content-Type':'application/json'},raw:true})}
 };
}

/** Queue ownership never touches active scores, takes, playback, or preview selection. */
export class BulkImportQueue{
 constructor({transport,getStorageKind=async()=> 'native',onCommitted=async()=>{},onObserverError=error=>globalThis.reportError?.(error)}={}){
  this.transport=transport||createBulkImportTransport();this.getStorageKind=getStorageKind;this.onCommitted=onCommitted;this.onObserverError=onObserverError;this.listeners=new Set();this.files=new Map();this.generation=0;this.sequence=0;this.controller=null;this.running=null;this.stopRequested=false;this.destroyed=false;
  this.state={phase:'idle',groups:[],error:null,current:null,cancelRequested:false};
 }
 snapshot(){return structuredClone(this.state)}
 subscribe(listener){this.listeners.add(listener);return()=>this.listeners.delete(listener)}
 publish(patch={}){if(this.destroyed)return;Object.assign(this.state,patch);for(const listener of this.listeners){try{listener(this.snapshot())}catch(error){this.onObserverError(error)}}}
 get committing(){return ['committing','cancelling'].includes(this.state.phase)}
 async select(input){
  if(this.committing){this.publish({error:failure(issue('pack_busy','Wait for the current file to finish, or cancel the remaining queue before choosing other files.'))});return false}
  const files=Array.from(input||[]);if(!files.length)return false;
  this.controller?.abort();const generation=++this.generation;this.controller=new AbortController();const signal=this.controller.signal;this.stopRequested=false;this.files.clear();
  if(files.length>BULK_IMPORT_LIMITS.files||files.reduce((sum,file)=>sum+(Number.isSafeInteger(file.size)?file.size:BULK_IMPORT_LIMITS.totalBytes),0)>BULK_IMPORT_LIMITS.totalBytes){this.publish({phase:'review',groups:[],error:failure(issue('pack_selection_limit','Choose up to 100 files totaling at most 512 MiB. Nothing was imported.')),current:null,cancelRequested:false});return false}
  const groups=files.map(file=>{const id=String(++this.sequence);this.files.set(id,file);return{id,name:file.name,bytes:file.size,phase:'queued',report:null,error:null,complete:false}});
  this.publish({phase:'preflighting',groups,error:null,current:null,cancelRequested:false});
  try{
   if(await this.getStorageKind()!=='native')throw issue('pack_native_required','Batch and pack import is available in the native Windows app. Open the same files there.');
   for(const group of groups){
    if(generation!==this.generation||signal.aborted)return false;
    const file=this.files.get(group.id);
    group.phase='preflighting';this.publish({current:group.id});
    try{
     checkFile(file);
     const report=await this.transport.preview(file,{signal});if(generation!==this.generation||signal.aborted)return false;
     group.report=report;group.phase='ready';
    }catch(error){if(generation!==this.generation||signal.aborted)return false;group.phase='failed';group.error=failure(error)}
    this.publish();
   }
   if(generation===this.generation)this.publish({phase:'review',current:null});return true;
  }catch(error){if(generation!==this.generation||signal.aborted)return false;this.publish({phase:'review',error:failure(error),current:null});return false}
 }
 cancel(){
  if(this.committing){this.stopRequested=true;this.publish({phase:'cancelling',cancelRequested:true});return}
  if(this.state.phase==='preflighting'){this.controller?.abort();this.generation++;for(const group of this.state.groups)if(['queued','preflighting'].includes(group.phase))group.phase='cancelled';this.publish({phase:'cancelled',current:null,cancelRequested:true})}
 }
 async run(tasks){
  if(this.destroyed||this.committing||this.state.phase==='preflighting'||!tasks.length)return false;
  this.stopRequested=false;this.publish({phase:'committing',error:null,cancelRequested:false});
  try{
   for(const task of tasks){
    if(this.stopRequested||this.destroyed)break;
    const group=this.state.groups.find(item=>item.id===task.id),file=this.files.get(task.id);if(!group||!file||!group.report)continue;
    group.phase='committing';group.error=null;this.publish({current:group.id});
    try{
     const report=await this.transport.commit(file,{keepBoth:task.keepBoth,index:task.index,sha256:group.report.source.sha256});
     if(task.index!==undefined){
      const selected=report.items.find(item=>item.index===task.index);if(!selected)throw issue('pack_invalid_response','The selected song was absent from the commit report.','unknown');
      group.report={...report,items:group.report.items.map(item=>item.index===task.index?selected:item)};
     }else{group.report=report}
     const unconfirmed=group.report.items.some(isImportOutcomeUnconfirmed);
     group.complete=!unconfirmed&&(task.index===undefined||group.complete||group.report.items.every(item=>item.status!=='ready'));
     group.phase=unconfirmed?'uncertain':group.complete?'complete':'ready';
    }catch(error){group.error=failure(error);group.phase=group.error.persistence==='unknown'?'uncertain':'failed';if(group.phase==='uncertain')group.complete=false}
    // Even an uncertain response may have committed. Inventory read is safe and
    // never claims that cancellation undid an atomic native write.
    try{await this.onCommitted()}catch(error){this.publish({error:failure(issue('pack_inventory_refresh','Import results are retained, but the saved-song list could not be refreshed.'))})}
    this.publish();
   }
  }finally{this.publish({phase:this.stopRequested?'cancelled':'review',current:null})}
  return true;
 }
 commit(){return this.run(this.state.groups.filter(group=>group.report&&!group.complete).map(group=>({id:group.id})))}
 retry(id){const group=this.state.groups.find(item=>item.id===id);if(!group?.report)return this.retryPreview(id);return this.run([{id}])}
 commitItem(id,index,{keepBoth=false}={}){const group=this.state.groups.find(item=>item.id===id),item=group?.report?.items.find(item=>item.index===index);if(!item||!(keepBoth?item.status==='conflict':item.status==='error'))return Promise.resolve(false);return this.run([{id,index,keepBoth}])}
 async retryPreview(id){
  if(this.committing||this.state.phase==='preflighting')return false;
  const group=this.state.groups.find(item=>item.id===id),file=this.files.get(id);if(!group||!file)return false;
  const generation=this.generation;this.controller=new AbortController();const signal=this.controller.signal;group.phase='preflighting';group.error=null;this.publish({phase:'preflighting',current:id,cancelRequested:false});
  try{checkFile(file);if(await this.getStorageKind()!=='native')throw issue('pack_native_required','Batch import requires the native Windows app.');const report=await this.transport.preview(file,{signal});if(generation!==this.generation||signal.aborted)return false;group.report=report;group.phase='ready'}
  catch(error){if(generation!==this.generation||signal.aborted)return false;group.error=failure(error);group.phase='failed'}
  this.publish({phase:'review',current:null});return true;
 }
 destroy(){this.cancel();this.destroyed=true;this.generation++;this.listeners.clear()}
}

export function summarizeImport(groups){
 const summary={files:groups.length,ready:0,saved:0,duplicate:0,conflict:0,retained_nonplayable:0,error:0,retained:0,unconfirmed:0,unconfirmedItems:0};
 for(const group of groups){if(group.report?.source.retained)summary.retained++;if(group.phase==='uncertain'||group.report?.items.some(isImportOutcomeUnconfirmed))summary.unconfirmed++;for(const item of group.report?.items||[])if(isImportOutcomeUnconfirmed(item))summary.unconfirmedItems++;else summary[item.status]++;if(group.error&&group.error.persistence!=='unknown')summary.error++}
 return summary;
}
