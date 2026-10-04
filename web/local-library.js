/** Explicit, origin-local score snapshots. No network, automatic save or silent overwrite. */
export const LIBRARY_LIMITS=Object.freeze({scores:100,scoreBytes:8*1024*1024,totalBytes:32*1024*1024,backupBytes:40*1024*1024});
const encoder=new TextEncoder();
const size=text=>encoder.encode(text).byteLength;
export function libraryError(code,message,{params={},cause}={}){
 const error=new Error(message);error.code=code;error.params=params;if(cause!==undefined)error.cause=cause;return error;
}
function storageError(error){
 if(typeof error?.code==='string'&&error.code.startsWith('library_'))return error;
 return libraryError(error?.name==='QuotaExceededError'?'library_storage_full':'library_storage_unavailable',error?.name==='QuotaExceededError'?'Browser storage is full. Export a backup or remove a saved copy before trying again.':error?.message||'Local storage is unavailable. Keep an exported score file instead.',{cause:error});
}
function snapshot(score,label){
 if(!score||score.version!==1||typeof score.id!=='string'||typeof score.title!=='string'||typeof score.composer!=='string')throw libraryError('library_invalid_score','Save a Rust-validated canonical score, not an API response or performance timeline.');
 const raw=JSON.stringify(score),bytes=size(raw);
 if(bytes>LIBRARY_LIMITS.scoreBytes)throw libraryError('library_score_limit','This score exceeds the 8 MiB saved-score limit. Export it as a file instead.');
 if(label!==null&&(typeof label!=='string'||label.length>200))throw libraryError('library_label_limit','A saved-copy label must be at most 200 characters.');
 return {raw,bytes,label:label?.trim()||null,title:score.title,composer:score.composer,score_id:score.id};
}
function limits(rows,additions,removedBytes=0,removedCount=0){
 if(rows.length+additions.length-removedCount>LIBRARY_LIMITS.scores)throw libraryError('library_count_limit','The local library holds at most 100 saved copies. Export a backup before removing copies.');
 const total=rows.reduce((sum,row)=>sum+row.bytes,0)-removedBytes+additions.reduce((sum,row)=>sum+row.bytes,0);
 if(total>LIBRARY_LIMITS.totalBytes)throw libraryError('library_total_limit','The local library is limited to 32 MiB. Export a backup before removing copies.');
}
function parseBackup(text){
 if(typeof text!=='string'||size(text)>LIBRARY_LIMITS.backupBytes)throw libraryError('library_backup_limit','A library backup must be JSON smaller than 40 MiB.');
 let data;try{data=JSON.parse(text)}catch{throw libraryError('library_backup_json','This file is not valid library-backup JSON.');}
 if(data?.format!=='worldmusichub-library-backup'||data.version!==1||!Array.isArray(data.entries)||data.entries.length>LIBRARY_LIMITS.scores)throw libraryError('library_backup_format','Unsupported library backup format or more than 100 scores.');
 if(Object.keys(data).some(key=>!['format','version','exported_at','entries'].includes(key)))throw libraryError('library_backup_fields','Unknown backup fields require a compatible app version.');
 return data.entries.map((entry,index)=>{
  if(!entry||Object.keys(entry).some(key=>!['label','score'].includes(key)))throw libraryError('library_backup_entry',`Backup entry ${index+1} has unsupported metadata.`,{params:{count:index+1}});
  return snapshot(entry.score,entry.label??null);
 });
}

export function openScoreLibrary({factory=globalThis.indexedDB,name='worldmusichub.scores.v1'}={}){
 return new Promise((resolve,reject)=>{
  if(!factory){reject(libraryError('library_storage_unsupported','This browser does not provide local score storage. Export score files instead.'));return;}
  let request,settled=false;
  try{request=factory.open(name,1)}catch(error){reject(storageError(error));return;}
  request.onupgradeneeded=()=>{
   if(settled){request.transaction.abort();return;}
   const db=request.result;
   if(!db.objectStoreNames.contains('metadata'))db.createObjectStore('metadata',{keyPath:'key'});
   if(!db.objectStoreNames.contains('scores'))db.createObjectStore('scores',{keyPath:'key'});
  };
  request.onerror=()=>{settled=true;reject(storageError(request.error));};
  request.onblocked=()=>{settled=true;reject(libraryError('library_storage_blocked','Another WorldMusicClub tab is holding an older library open. Close it and try again.'));};
  request.onsuccess=()=>{
   if(settled){request.result.close();return;}
   settled=true;resolve(new ScoreLibrary(request.result));
  };
 });
}
class ScoreLibrary{
 constructor(db){this.db=db;this.closed=false;db.onversionchange=()=>this.close();}
 close(){this.closed=true;this.db.close();}
 operation(mode,start){
  if(this.closed)return Promise.reject(libraryError('library_storage_closed','The local library was closed or upgraded in another tab. Reload before saving.'));
  return new Promise((resolve,reject)=>{
   let tx,result,failure;
   try{tx=this.db.transaction(['metadata','scores'],mode)}catch(error){reject(storageError(error));return;}
   const abort=error=>{failure=error;try{tx.abort()}catch{reject(storageError(error))}};
   tx.oncomplete=()=>resolve(result);
   tx.onabort=()=>reject(storageError(failure||tx.error));
   tx.onerror=()=>{failure ||= tx.error;};
   try{start(tx,value=>{result=value},abort)}catch(error){abort(error)}
  });
 }
 list(){return this.operation('readonly',(tx,done)=>{const request=tx.objectStore('metadata').getAll();request.onsuccess=()=>done(request.result.sort((a,b)=>b.updated_at.localeCompare(a.updated_at)||a.key.localeCompare(b.key)));});}
 get(key){
  return this.operation('readonly',(tx,done,abort)=>{
   const meta=tx.objectStore('metadata').get(key),payload=tx.objectStore('scores').get(key);
   let metadata,stored,read=0;
   const finish=()=>{if(++read!==2)return;try{if(!metadata&&!stored){done(null);return;}if(!metadata||!stored)throw libraryError('library_copy_incomplete','The saved copy is incomplete. Restore it from an exported backup.');done({...metadata,score:JSON.parse(stored.raw)});}catch(error){abort(error)}};
   meta.onsuccess=()=>{metadata=meta.result;finish()};payload.onsuccess=()=>{stored=payload.result;finish()};
  });
 }
 save(score,{key=null,expectedRevision=null,label=null}={}){
  let item;try{item=snapshot(score,label)}catch(error){return Promise.reject(error)}
  return this.operation('readwrite',(tx,done,abort)=>{
   const store=tx.objectStore('metadata'),request=store.getAll();
   request.onsuccess=()=>{try{
    const existing=key===null?null:request.result.find(row=>row.key===key);
    if(key!==null&&(!existing||existing.revision!==expectedRevision))throw libraryError('library_save_revision','This saved copy changed in another tab or was removed. Reload it, or save a new copy.');
    limits(request.result,[item],existing?.bytes||0,existing?1:0);
    const id=existing?.key||globalThis.crypto.randomUUID(),now=new Date().toISOString();
    const {raw,...fields}=item;
    const metadata={...fields,key:id,created_at:existing?.created_at||now,updated_at:now,revision:(existing?.revision||0)+1};
    store[existing?'put':'add'](metadata);tx.objectStore('scores')[existing?'put':'add']({key:id,raw});done(metadata);
   }catch(error){abort(error)}};
  });
 }
 remove(key,{expectedRevision=null}={}){
  return this.operation('readwrite',(tx,done,abort)=>{
   const store=tx.objectStore('metadata'),request=store.get(key);
   request.onsuccess=()=>{try{
    if(!request.result){done(false);return;}
    if(request.result.revision!==expectedRevision)throw libraryError('library_delete_revision','This saved copy changed in another tab. Refresh the list before deleting.');
    store.delete(key);tx.objectStore('scores').delete(key);done(true);
   }catch(error){abort(error)}};
  });
 }
 exportBackup(){
  return this.operation('readonly',(tx,done,abort)=>{
   const meta=tx.objectStore('metadata').getAll(),scores=tx.objectStore('scores').getAll();let rows,payloads,read=0;
   const finish=()=>{if(++read!==2)return;try{
    const byKey=new Map(payloads.map(item=>[item.key,item.raw]));
    const entries=rows.map(row=>{const raw=byKey.get(row.key);if(!raw)throw libraryError('library_copy_missing','A saved score is missing. Export individual readable copies before repairing the library.');return{label:row.label,score:JSON.parse(raw)}});
    const text=JSON.stringify({format:'worldmusichub-library-backup',version:1,exported_at:new Date().toISOString(),entries});
    if(size(text)>LIBRARY_LIMITS.backupBytes)throw libraryError('library_export_limit','Backup exceeds 40 MiB. Export individual score files instead.');done(text);
   }catch(error){abort(error)}};
   meta.onsuccess=()=>{rows=meta.result;finish()};scores.onsuccess=()=>{payloads=scores.result;finish()};
  });
 }
 async restoreBackup(text,{validate}={}){
  if(typeof validate!=='function')throw libraryError('library_validation_required','Every backup score must be checked by the Rust engine before restoration.');
  const items=parseBackup(text);limits([],items);
  for(let index=0;index<items.length;index++){
   try{if(await validate(JSON.parse(items[index].raw))!==true)throw libraryError('library_validation_unconfirmed','Rust validation did not confirm this score.');}
   catch(error){throw libraryError(error?.name==='AbortError'?'library_restore_aborted':'library_restore_score',`Backup score ${index+1} was not restored: ${error.message}`,{params:{count:index+1},cause:error})}
  }
  return this.operation('readwrite',(tx,done,abort)=>{
   const store=tx.objectStore('metadata'),request=store.getAll();
   request.onsuccess=()=>{try{
    limits(request.result,items);
    const now=new Date().toISOString(),rows=[];
    for(const item of items){const {raw,...fields}=item,key=globalThis.crypto.randomUUID();const metadata={...fields,key,created_at:now,updated_at:now,revision:1};store.add(metadata);tx.objectStore('scores').add({key,raw});rows.push(metadata);}
    done(rows);
   }catch(error){abort(error)}};
  });
 }
}
