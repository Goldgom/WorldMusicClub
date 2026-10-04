import {isBasicKeysSong,isBasicKeysSummary,BASIC_KEYS_PROFILE,prepareCleanSong,prepareVsqPractice,preparePerformanceSong,isVsqSong,isPerformanceSong,isPerformanceSummary,VSQ_PROFILE,PERFORMANCE_PROFILE} from './clean-song-package.js';
import {openScoreLibrary,LIBRARY_LIMITS,libraryError} from './local-library.js';

const bytes=value=>new TextEncoder().encode(value).byteLength;
const nativeKey=/^song-[0-9a-f]{64}$/;
const assetReadQueueLimit=32;
function issue(code,message,{status=0,existing,persistence='not-saved',cause}={}){
 const error=libraryError(code,message,{cause});Object.assign(error,{status,existing,persistence});return error;
}
function snapshot(score){
 let raw;try{raw=JSON.stringify(score)}catch(cause){throw issue('library_invalid_score','The complete canonical score cannot be serialized.',{cause})}
 if(!raw||!score||score.version!==1||typeof score.id!=='string'||!Array.isArray(score.parts))throw issue('library_invalid_score','A complete canonical score is required.');
 if(bytes(raw)>LIBRARY_LIMITS.scoreBytes)throw issue('library_score_limit','Complete canonical JSON exceeds 8 MiB; no source was discarded.');
 return{raw,score:JSON.parse(raw)};
}
function parseScore(raw){
 if(typeof raw!=='string'||bytes(raw)>LIBRARY_LIMITS.scoreBytes)throw issue('library_invalid_response','The native library returned an invalid canonical payload.');
 try{return snapshot(JSON.parse(raw)).score}catch(cause){throw issue('library_invalid_response','The native library returned invalid canonical JSON.',{cause})}
}
function entry(kind,row){
 if(!row||typeof row.key!=='string'||!row.key||typeof row.title!=='string'||typeof row.score_id!=='string'||(kind==='native'&&!nativeKey.test(row.key)))throw issue('library_invalid_response','The library returned an invalid saved-score identity.');
 if(kind==='native'&&(!Number.isSafeInteger(row.saved_at_unix_ms)||row.saved_at_unix_ms<0||!Number.isFinite(new Date(row.saved_at_unix_ms).getTime())||!Number.isSafeInteger(row.score_bytes)||row.score_bytes<0||row.score_bytes>((isPerformanceSummary(row.clean_package)||isBasicKeysSummary(row.clean_package))?16*1024*1024:LIBRARY_LIMITS.scoreBytes)))throw issue('library_invalid_response','The native archive returned invalid size or timestamp metadata.');
 const metadata={...row};delete metadata.score;
 return{...metadata,libraryKey:`${kind}:${row.key}`,storageKey:row.key,storageKind:kind,bytes:kind==='native'?row.score_bytes:row.bytes,updated_at:kind==='native'?new Date(row.saved_at_unix_ms).toISOString():row.updated_at};
}
function rawKey(kind,key){
 const prefix=`${kind}:`;
 if(typeof key!=='string'||!key.startsWith(prefix)||!key.slice(prefix.length)||(kind==='native'&&!nativeKey.test(key.slice(prefix.length))))throw issue('library_invalid_key','Choose a saved copy from this storage library.');
 return key.slice(prefix.length);
}

/** Relative, same-origin requests only. A failed native write never opens IDB. */
export async function openScoreStorage({fetcher=globalThis.fetch,origin=globalThis.location?.origin,openBrowserLibrary=openScoreLibrary,validateScore,now=()=>new Date().toISOString()}={}){
 if(typeof fetcher!=='function'||typeof origin!=='string'||origin==='null')throw issue('library_environment_unknown','The app storage environment could not be verified.');
 let expectedOrigin;try{expectedOrigin=new URL(origin).origin}catch{throw issue('library_environment_unknown','The app origin is invalid.')}
 async function request(path,{body,signal,writing=false}={}){
  let response;
  try{response=await fetcher(path,{method:body===undefined?'GET':'POST',headers:body===undefined?undefined:{'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body),signal,credentials:'same-origin',redirect:'error',cache:'no-store'})}
  catch(cause){if(cause?.name==='AbortError'&&!writing)throw cause;throw issue(writing?'library_commit_uncertain':'library_transport',writing?'The save response was lost. Refresh to confirm whether this score was saved.':'The local app could not be reached.',{persistence:writing?'unknown':'not-saved',cause})}
  if(response.redirected||(response.url&&new URL(response.url,origin).origin!==expectedOrigin))throw issue('library_environment_unknown','A library response left the app origin.',{persistence:writing?'unknown':'not-saved'});
  let value;try{value=await response.json()}catch(cause){throw issue('library_invalid_response','The app returned an unreadable storage response.',{persistence:writing?'unknown':'not-saved',cause})}
  if(!response.ok)throw issue(typeof value?.code==='string'?value.code:'library_request_failed',typeof value?.error==='string'?value.error:'The storage operation failed.',{status:response.status,existing:value?.existing,persistence:value?.code==='library_commit_uncertain'?'unknown':'not-saved'});
  return value;
 }
 const health=await request('/api/health');
 if(health?.name!=='WorldMusicHub'||health.engine!=='rust'||health.score_format_version!==1||!['native-protocol-no-listener','loopback-only'].includes(health.network))throw issue('library_environment_unknown','The Rust app health contract did not identify a supported storage environment.');
 const kind=health.network==='native-protocol-no-listener'?'native':'browser';
 const browser=kind==='browser'?await openBrowserLibrary():null;
 const allowedAssets=new Map(),assetReads=[];
 let assetReadActive=false,closed=false;
 const validate=async(score,signal)=>{
  signal?.throwIfAborted();const result=validateScore?await validateScore(structuredClone(score),signal):await request('/api/compile',{body:score,signal});signal?.throwIfAborted();
  if(result!==true&&(!result?.score||!Array.isArray(result?.timeline?.notes)))throw issue('library_validation_required','Rust validation did not confirm this complete canonical score.');
 };
 const info=Object.freeze({kind,storage:kind==='native'?'native-filesystem':'indexeddb',origin:expectedOrigin,capabilities:Object.freeze({rescan:true,backup:true,chooseDirectory:false,openFolder:false})});
 async function list({signal}={}){
  if(kind==='browser'){const rows=await browser.list();signal?.throwIfAborted();return{...info,directory:null,entries:rows.map(row=>entry(kind,row)),issues:[]}}
  const value=await request('/api/library/list',{signal});
  if(value?.storage!=='native-filesystem'||value.library_format_version!==1||typeof value.directory!=='string'||!value.directory||!Array.isArray(value.entries)||!Array.isArray(value.issues)||value.issues.some(item=>!item||typeof item.code!=='string'||typeof item.message!=='string'))throw issue('library_invalid_response','The native inventory response is incomplete.');
  const entries=value.entries.map(row=>entry(kind,row));if(new Set(entries.map(row=>row.libraryKey)).size!==entries.length)throw issue('library_invalid_response','The native inventory repeats a saved-copy identity.');
  return{...info,directory:value.directory,entries,issues:value.issues};
 }
 async function save(score,{label=null,allowConflictingId=false,signal,scoreJson}={}){
  // Capture before the first await; a later edit cannot alter the saved import.
  const captured=snapshot(score);
  if(scoreJson!==undefined){
   if(typeof scoreJson!=='string'||bytes(scoreJson)>LIBRARY_LIMITS.scoreBytes)throw issue('library_score_limit','The original canonical JSON exceeds 8 MiB.');
   let original;try{original=JSON.parse(scoreJson)}catch(cause){throw issue('library_invalid_score','The original canonical JSON is invalid.',{cause})}
   if(JSON.stringify(original)!==captured.raw)throw issue('library_invalid_score','Original canonical JSON does not match the accepted import.');
   captured.raw=scoreJson;
  }
  await validate(captured.score,signal);signal?.throwIfAborted();
  if(kind==='browser')return entry(kind,await browser.save(captured.score,{label}));
  const body={score_json:captured.raw,allow_conflicting_id:allowConflictingId};if(label!==null)body.label=label;
  if(bytes(JSON.stringify(body))>LIBRARY_LIMITS.scoreBytes)throw issue('library_request_limit','The complete save request exceeds 8 MiB including source escaping; no source was discarded.');
  // Do not abort an in-flight filesystem commit when a dialog closes.
  try{return entry(kind,await request('/api/library/save',{body,writing:true}))}
  catch(error){
   try{if(error.existing)error.existing=entry(kind,error.existing);if(['library_duplicate','library_id_conflict'].includes(error.code)&&!error.existing)throw issue('library_invalid_response','The existing archive identity was missing from a conflict response.')}
   catch(invalid){invalid.persistence='unknown';throw invalid}
   if(error.code==='library_invalid_response')error.persistence='unknown';throw error;
  }
 }
 async function load(key,{signal}={}){
  const storageKey=rawKey(kind,key);let saved;
  if(kind==='browser'){
   const row=await browser.get(storageKey);signal?.throwIfAborted();if(!row)throw issue('library_not_found','This saved copy no longer exists.');
   saved={entry:entry(kind,row),score:snapshot(row.score).score};
  }else{
   const value=await request('/api/library/load',{body:{key:storageKey},signal});
   const performance=value?.clean_package?.profile===PERFORMANCE_PROFILE,basicKeys=value?.clean_package?.profile===BASIC_KEYS_PROFILE;
   if(basicKeys&&(value.score_json!==null||!isBasicKeysSummary(value.entry?.clean_package)))throw issue('library_invalid_response','A basic-key package must use its complete embedded notation projection.');
   if(performance&&(value.score_json!==null||!isPerformanceSummary(value.entry?.clean_package)))throw issue('library_invalid_response','A complete performance must explicitly declare unavailable notation.');
   saved={entry:entry(kind,value?.entry),score:performance||basicKeys?null:parseScore(value?.score_json),score_json:value.score_json};
   if(value.clean_package)saved.cleanSong=performance?await preparePerformanceSong(key,value.clean_package,saved.score):prepareCleanSong(key,value.clean_package,saved.score);
   if(basicKeys)saved.score=saved.cleanSong.notation;
   if(saved.entry.storageKey!==storageKey)throw issue('library_invalid_response','The loaded archive does not match the selected library key.');
  }
  if(!isBasicKeysSong(saved.cleanSong)&&!isVsqSong(saved.cleanSong)&&!isPerformanceSong(saved.cleanSong))await validate(saved.score,signal);
  signal?.throwIfAborted();
  if(kind==='native'&&!closed){if(saved.cleanSong)allowedAssets.set(key,saved.cleanSong);else allowedAssets.delete(key);}
  return saved;
 }
 async function chooseVsqPractice(song,{signal}={}){
  if(kind!=='native'||!isVsqSong(song)||song.runtime!==null||allowedAssets.get(song.libraryKey)!==song)throw issue('library_runtime_choice','Choose practice for the currently loaded VSQ package.');
  const value=await request('/api/library/runtime',{body:{key:rawKey(kind,song.libraryKey),profile:VSQ_PROFILE,choice:'base_notes_instrumental'},signal});
  signal?.throwIfAborted();if(allowedAssets.get(song.libraryKey)!==song)throw issue('library_runtime_choice','The VSQ package was reloaded; make the choice for the new load.');return prepareVsqPractice(song,value);
 }
 async function exportBackup({libraryKeys,signal}={}){
  if(kind==='browser'&&libraryKeys===undefined){const text=await browser.exportBackup();signal?.throwIfAborted();return{text,filename:'worldmusichub-library-backup.json',storage:info.storage}}
  const inventory=await list({signal});const selected=libraryKeys===undefined?inventory.entries:libraryKeys.map(key=>{const found=inventory.entries.find(row=>row.libraryKey===key);if(!found)throw issue('library_not_found','A selected saved copy is missing.');return found});
  if(selected.some(row=>row.clean_package))throw issue('clean_pack_export_required','Use complete song-pack export to preserve performance and media.');
  if(selected.length>LIBRARY_LIMITS.scores)throw issue('library_count_limit','A compatible library backup may contain at most 100 scores.');
  if(new Set(selected.map(row=>row.libraryKey)).size!==selected.length)throw issue('library_invalid_key','Backup selection contains duplicate library keys.');
  const entries=[];let total=0;
  for(const row of selected){
   signal?.throwIfAborted();let score;
   if(kind==='native'){
    const value=await request('/api/library/export',{body:{key:row.storageKey},signal});
    if(value?.format!=='worldmusichub-native-score-backup'||value.version!==1||value.entry?.key!==row.storageKey)throw issue('library_invalid_response','The native export does not match the selected archive.');
    score=parseScore(value.score_json);
   }else score=(await load(row.libraryKey,{signal})).score;
   const item={label:row.label??null,score};total+=bytes(JSON.stringify(item));if(total>LIBRARY_LIMITS.backupBytes)throw issue('library_export_limit','Complete backup exceeds 40 MiB; export fewer saved copies.');entries.push(item);
  }
  const text=JSON.stringify({format:'worldmusichub-library-backup',version:1,exported_at:now(),entries});
  if(bytes(text)>LIBRARY_LIMITS.backupBytes)throw issue('library_export_limit','Complete backup exceeds 40 MiB; no partial backup was prepared.');
  return{text,filename:'worldmusichub-library-backup.json',storage:info.storage};
 }
 function checkAssetRead({key,handle,asset,signal}){
  signal?.throwIfAborted();
  if(closed)throw issue('library_storage_closed','The local library is closed.');
  const current=allowedAssets.get(key)?.media.find(item=>item.handle===handle);
  if(kind!=='native'||!asset||!current||current.sha256!==asset.sha256||current.bytes!==asset.bytes||current.mime!==asset.mime)throw issue('clean_asset_identity','Choose an asset belonging to the loaded package.');
 }
 async function readAsset(job){
  checkAssetRead(job);const {storageKey,handle,asset}=job;
  // Windows admits one large native operation. Keep ownership through the full
  // response, even after caller cancellation: aborting fetch can return before
  // the native request releases its permit and make the next read fail as busy.
  const response=await fetcher('/api/library/asset',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({key:storageKey,handle}),credentials:'same-origin',redirect:'error',cache:'no-store'});
  const buffer=await response.arrayBuffer();checkAssetRead(job);
  if(!response.ok||response.redirected||(response.url&&new URL(response.url,origin).origin!==expectedOrigin))throw issue('clean_asset_read','The validated media could not be read.');
  const mime=response.headers?.get('content-type')?.split(';')[0];if(mime!==asset.mime)throw issue('clean_asset_type','The media type does not match its package.');
  if(buffer.byteLength!==asset.bytes)throw issue('clean_asset_size','The media size does not match its package.');
  const digest=await globalThis.crypto.subtle.digest('SHA-256',buffer),actual=[...new Uint8Array(digest)].map(value=>value.toString(16).padStart(2,'0')).join('');
  if(actual!==asset.sha256)throw issue('clean_asset_hash','The media content does not match its package.');
  checkAssetRead(job);return new Blob([buffer],{type:asset.mime});
 }
 async function drainAssetReads(){
  if(assetReadActive||!assetReads.length)return;
  assetReadActive=true;const job=assetReads.shift();job.detach();
  try{job.resolve(await readAsset(job))}catch(error){job.reject(error)}
  finally{assetReadActive=false;void drainAssetReads()}
 }
 async function loadAsset(key,handle,{signal}={}){
  const job={key,handle,signal,storageKey:rawKey(kind,key),asset:allowedAssets.get(key)?.media.find(item=>item.handle===handle)};
  checkAssetRead(job);
  if(assetReads.length>=assetReadQueueLimit)throw issue('clean_asset_queue_limit','Too many media reads are waiting.');
  return new Promise((resolve,reject)=>{
   const abort=()=>{const index=assetReads.indexOf(job);if(index<0)return;assetReads.splice(index,1);job.detach();reject(signal.reason);};
   Object.assign(job,{resolve,reject,detach:()=>signal?.removeEventListener('abort',abort)});
   signal?.addEventListener('abort',abort,{once:true});assetReads.push(job);void drainAssetReads();
  });
 }
 function close(){
  closed=true;allowedAssets.clear();
  for(const job of assetReads.splice(0)){job.detach();job.reject(issue('library_storage_closed','The local library is closed.'));}
  browser?.close();
 }
 return{info,list,save,load,loadAsset,chooseVsqPractice,exportBackup,close};
}
