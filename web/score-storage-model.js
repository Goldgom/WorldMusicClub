import {openScoreStorage} from './native-score-storage.js';

const importKinds=new Set(['file-import','jianpu-import','confirmed-image-import','confirmed-omr-import']);
const tickets=new WeakMap();
/** One ticket per user import attempt; never create this in compileScore(). */
export function createImportPersistenceTicket(kind){
 if(!importKinds.has(kind))throw new TypeError('Only explicit source imports may request automatic persistence.');
 const ticket=Object.freeze({kind});tickets.set(ticket,kind);return ticket;
}
const failure=error=>({code:error?.code||'library_storage_unavailable',message:error?.message||'Storage is unavailable.',persistence:error?.persistence||'not-saved'});

/** Persistence owns no active score, playback, editor state, or navigation. */
export class ScoreStorageModel{
 constructor({openStorage=openScoreStorage,onObserverError=error=>globalThis.reportError?.(error)}={}){
  this.openStorage=openStorage;this.onObserverError=onObserverError;this.adapter=null;this.opening=null;this.listeners=new Set();this.readVersion=0;this.importWrites=new WeakMap();this.saveTail=Promise.resolve();this.pendingSave=null;this.queuedSaves=0;this.destroyed=false;
  this.state={phase:'idle',kind:null,storage:null,directory:null,origin:null,entries:[],issues:[],error:null,reading:false,saving:false,exporting:false,saveResult:null,capabilities:{rescan:false,backup:false,chooseDirectory:false,openFolder:false}};
 }
 snapshot(){return structuredClone(this.state)}
 subscribe(listener){this.listeners.add(listener);return()=>this.listeners.delete(listener)}
 publish(patch){if(this.destroyed)return;Object.assign(this.state,patch);for(const listener of this.listeners){try{listener(this.snapshot())}catch(error){try{this.onObserverError(error)}catch{/* A broken observer cannot change a committed save's outcome. */}}}}
 async storage(){
  if(this.destroyed)throw new Error('The storage model is closed.');
  if(this.adapter)return this.adapter;
  if(!this.opening)this.opening=Promise.resolve().then(()=>this.openStorage()).then(adapter=>{if(this.destroyed){adapter.close();throw new Error('The storage model is closed.')}this.adapter=adapter;this.publish(adapter.info);return adapter}).finally(()=>{this.opening=null});
  return this.opening;
 }
 async start(){return this.rescan()}
 async rescan(){
  const version=++this.readVersion;this.publish({reading:true,phase:this.adapter?'ready':'loading',error:null});
  try{const inventory=await(await this.storage()).list();if(this.destroyed)return false;if(version!==this.readVersion){if(!this.state.directory&&inventory.directory)this.publish({directory:inventory.directory});return false}this.publish({...inventory,reading:false,phase:'ready',error:null});return true}
  catch(error){if(version===this.readVersion)this.publish({reading:false,phase:this.adapter?'ready':'error',error:failure(error)});return false}
 }
 upsert(row){if(!row)return;const entries=this.state.entries.filter(entry=>entry.libraryKey!==row.libraryKey);entries.push(row);entries.sort((a,b)=>a.libraryKey.localeCompare(b.libraryKey));this.publish({entries})}
 save(score,options={}){
  let captured;try{captured=structuredClone(score)}catch(error){return Promise.resolve({status:'failed',...failure(error)})}
  if(this.destroyed)return Promise.resolve({status:'skipped'});
  this.queuedSaves++;this.publish({saving:true});
  const operation=async()=>{
   if(this.destroyed){this.queuedSaves--;return{status:'skipped'}}
   this.publish({saving:true,error:null,saveResult:{status:'saving',title:captured?.title||'',persistence:'pending'}});
   const pending={score:captured,options:{...options}};this.pendingSave=pending;
   try{
    const saved=await(await this.storage()).save(captured,options);this.readVersion++;this.upsert(saved);
    const result={status:'saved',entry:saved,title:captured.title,persistence:'saved'};this.pendingSave=null;this.publish({saveResult:result,reading:false,phase:'ready'});return result;
   }catch(error){
    const status=error.code==='library_duplicate'?'duplicate':error.code==='library_id_conflict'?'conflict':error.persistence==='unknown'?'uncertain':'failed';
    if(status==='duplicate'&&error.existing){this.readVersion++;this.upsert(error.existing);this.pendingSave=null}
    const result={...failure(error),status,title:captured?.title||'',existing:error.existing,persistence:status==='duplicate'?'saved':error.persistence||'not-saved'};
    this.publish({saveResult:result,...(status==='duplicate'?{reading:false}:{})});return result;
   }finally{this.queuedSaves--;this.publish({saving:this.queuedSaves>0})}
  };
  const result=this.saveTail.then(operation,operation);this.saveTail=result.catch(()=>{});return result;
 }
 persistImported(ticket,score,{activated=false,signal,scoreJson}={}){
  if(!tickets.has(ticket)||!activated||signal?.aborted)return Promise.resolve({status:'skipped'});
  if(this.importWrites.has(ticket))return this.importWrites.get(ticket);
  const result=this.save(score,{scoreJson});this.importWrites.set(ticket,result);return result;
 }
 keepBoth(){if(this.state.saving||this.state.saveResult?.status!=='conflict'||!this.pendingSave)return Promise.resolve({status:'skipped'});return this.save(this.pendingSave.score,{...this.pendingSave.options,allowConflictingId:true})}
 retrySave(){if(this.state.saving||!['failed','uncertain'].includes(this.state.saveResult?.status)||!this.pendingSave)return Promise.resolve({status:'skipped'});return this.save(this.pendingSave.score,this.pendingSave.options)}
 async load(libraryKey,options){return(await this.storage()).load(libraryKey,options)}
 async exportBackup(options){this.publish({exporting:true,error:null});try{return await(await this.storage()).exportBackup(options)}catch(error){this.publish({error:failure(error)});throw error}finally{this.publish({exporting:false})}}
 destroy(){this.destroyed=true;this.readVersion++;this.listeners.clear();this.adapter?.close()}
}

/** Distinct saved editions sharing a score.id remain distinct selectable rows. */
export function buildSongList(catalog,entries,{catalogIdentity=item=>`catalog:${encodeURIComponent(item.id)}`}={}){
 return[...catalog.map(item=>({selectionKey:catalogIdentity(item),source:'catalog',title:item.title,composer:item.composer,scoreId:item.id,catalog:item})),...entries.map(item=>({selectionKey:item.libraryKey,source:'saved',title:item.label||item.title,composer:item.composer,scoreId:item.score_id,libraryKey:item.libraryKey,saved:item}))];
}
export function filterSongList(items,query='',source='all'){
 const terms=String(query).normalize('NFKC').toLocaleLowerCase().trim().split(/\s+/).filter(Boolean);
 return items.filter(item=>(source==='all'||item.source===source)&&terms.every(term=>`${item.title} ${item.composer||''}`.normalize('NFKC').toLocaleLowerCase().includes(term)));
}
export async function loadSongListItem(item,{model,loadCatalog,signal}){
 if(item.source==='saved')return(await model.load(item.libraryKey,{signal})).score;
 if(item.source==='catalog')return loadCatalog(item.catalog,signal);
 throw new TypeError('Unknown song-list row.');
}
