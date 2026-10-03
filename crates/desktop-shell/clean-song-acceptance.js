/* Exact process-owned clean-song Windows evidence. Ordinary launches never load
 * this script. Real chooser, input, AudioContext, native asset bytes and frames;
 * no FileList substitution, app state hooks, or synthesised input events. */
const CLEAN_ACCEPTANCE_REPORT_BYTES=1024*1024;
function validateCleanFixtureInventory(score,runtime){
 const p=score?.performance,c=score?.coverage;
 if(p?.tracks?.length!==3||p.parts?.length!==2||p.notes?.length!==30||p.events?.length!==14||c?.status!=='complete'||c.source_tracks!==3||c.source_events!==74||c.represented_events!==74||c.pitched_notes!==30||c.source_events!==p.events.length+2*p.notes.length||runtime?.events?.length!==14||runtime.notes?.length!==30||runtime.duration_ms!==32000)throw Error('Complete clean score/runtime inventory changed');
 return{tracks:3,parts:p.parts.map(part=>part.id),notes:30,events:14,source_events:74,duration_ms:32000};
}
async function postCleanAcceptanceReport({report,fetcher,waits}) {
 const send=value=>waits.json(fetcher,'/__desktop_smoke/report',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(value)},10000);
 let bytes=null;
 try{bytes=new TextEncoder().encode(JSON.stringify(report)).length;if(bytes>CLEAN_ACCEPTANCE_REPORT_BYTES)throw Error('Complete clean report exceeds its finite evidence limit');await send(report);return{delivered:true,bytes};}
 catch(error){const failure={version:1,phase:report.phase,ok:false,error:'Complete clean acceptance report could not be delivered',report_failure:{code:'clean_report_delivery_failed',received_bytes:bytes,limit_bytes:CLEAN_ACCEPTANCE_REPORT_BYTES,detail:String(error).slice(0,512)}};await send(failure);return{delivered:false,bytes};}
}
/* A task, rather than a microtask, ends observation after all native blur handlers. */
function createCleanChooserObserver({target,now=()=>performance.now(),defer=callback=>setTimeout(callback,0)}) {
 const records=[],pending=new WeakMap();let active=null;
 const observe=event=>{if(!active||event.target!==target)return;const row={trusted:event.isTrusted===true,started_wall_ms:now(),finished_wall_ms:null};active.blurs.push(row);pending.get(active).push(new Promise(resolve=>defer(()=>{row.finished_wall_ms=now();resolve();})));};
 target.addEventListener('blur',observe,true);
 return{records,begin(sequence,kind){if(active)throw Error('Overlapping native chooser observations');active={sequence,kind,started_wall_ms:now(),finished_wall_ms:null,completed:false,blurs:[]};records.push(active);pending.set(active,[]);},async end(sequence,completed){if(!active||active.sequence!==sequence)throw Error('Native chooser ownership changed');const row=active;active=null;await Promise.all(pending.get(row));row.finished_wall_ms=now();row.completed=completed;},stop(){target.removeEventListener('blur',observe,true);}};
}
/* Observe the app's exact Blob/URL pairs without creating URLs or fetching blob:
 * (native connect-src deliberately excludes it). Limits cover this small fixture,
 * including its ordinary downloads; overflow fails evidence, not the app call. */
function createCleanMediaBlobObserver({urls=URL,BlobType=Blob,maxUrls=64,maxBlobBytes=1024*1024,maxRetainedBytes=8*1024*1024}={}) {
 for(const limit of [maxUrls,maxBlobBytes,maxRetainedBytes])if(!Number.isSafeInteger(limit)||limit<=0)throw Error('Invalid clean Blob observation bound');
 const create=urls.createObjectURL,revoke=urls.revokeObjectURL,size=Object.getOwnPropertyDescriptor(BlobType.prototype,'size').get,read=BlobType.prototype.arrayBuffer,records=new Map();let count=0,retainedBytes=0,failure=null,stopped=false;
 const fail=message=>{failure??=message;},assertHealthy=()=>{if(stopped||failure)throw Error(failure||'Clean Blob observation stopped');};
 function observedCreate(...args){
  const url=Reflect.apply(create,this,args);if(failure)return url;
  try{
   if(++count>maxUrls)throw Error('Clean Blob URL observation bound exceeded');
   if(typeof url!=='string'||!url.startsWith('blob:')||url.length>2048||records.has(url))throw Error('Clean Blob URL identity is invalid');
   const bytes=Reflect.apply(size,args[0],[]);
   if(!Number.isSafeInteger(bytes)||bytes<=0||bytes>maxBlobBytes)throw Error('Clean Blob byte observation bound exceeded');
   if(retainedBytes+bytes>maxRetainedBytes)throw Error('Clean retained Blob observation bound exceeded');
   records.set(url,{blob:args[0],bytes});retainedBytes+=bytes;
  }catch(error){fail(String(error));}
  return url;
 }
 function observedRevoke(...args){const result=Reflect.apply(revoke,this,args);if(typeof args[0]!=='string'){fail('Clean Blob revocation identity is not a string');return result;}const record=records.get(args[0]);if(record){retainedBytes-=record.bytes;records.delete(args[0]);}return result;}
 urls.createObjectURL=observedCreate;urls.revokeObjectURL=observedRevoke;
 return{assertHealthy,async readBytes(node,source){
  assertHealthy();const record=records.get(source);
  const check=()=>{assertHealthy();if(typeof source!=='string'||!source.startsWith('blob:')||!record||records.get(source)!==record||node.currentSrc!==source)throw Error('Clean media Blob is missing, revoked or no longer current');};
  check();const bytes=await Reflect.apply(read,record.blob,[]);check();if(bytes.byteLength!==record.bytes)throw Error('Clean media Blob byte length changed');return bytes;
 },restore(){if(urls.createObjectURL===observedCreate)urls.createObjectURL=create;if(urls.revokeObjectURL===observedRevoke)urls.revokeObjectURL=revoke;records.clear();retainedBytes=0;stopped=true;}};
}
function createCleanNavigationObserver(){
 let scoreId=null,requests=0,failure=null;
 return{select(id){if(typeof id!=='string'||!id||id.length>256||scoreId!==null)throw Error('Clean navigation score identity is invalid');scoreId=id;},observe(path,options){
  if(scoreId===null||path!=='/api/notation-navigation')return;
  try{const body=options?.body;if(typeof body!=='string'||body.length>1024*1024)throw Error('Clean navigation request observation bound exceeded');if(JSON.parse(body)?.id===scoreId)requests=Math.min(requests+1,65);}catch(error){failure??=String(error);}
 },ready(status){if(failure)throw Error(failure);if(scoreId===null||status!=='ready'||requests!==0)throw Error('Clean written following is not ready or requested ordinary notation navigation');return{status,ordinaryNavigationRequests:requests};}};
}
/* Observe status/error metadata only; successful asset bytes stay unread here. */
function createCleanAssetRequestObserver({now=()=>performance.now(),maxRows=32}={}) {
 if(!Number.isSafeInteger(maxRows)||maxRows<1||maxRows>64)throw Error('Invalid clean asset observation bound');
 const rows=[],started=now(),text=value=>String(value??'').slice(0,512);let sequence=0,omitted=0,stopped=false;
 return{observe(path,options,promise){
  if(stopped||path!=='/api/library/asset')return promise;
  const row={sequence:++sequence,startedMs:Math.max(0,now()-started),finishedMs:null,handle:null,status:null,outcome:'pending',errorCode:null,error:null,errorRead:null};
  try{if(typeof options?.body!=='string'||options.body.length>4096)throw Error('Unbounded asset request identity');const handle=JSON.parse(options.body)?.handle;if(typeof handle!=='string'||handle.length>128)throw Error('Invalid asset request handle');row.handle=handle;}catch(error){row.observationError=text(error);}
  if(rows.length===maxRows){rows.shift();omitted++;}rows.push(row);
  try{Reflect.apply(Promise.prototype.then,promise,[response=>{if(stopped)return;row.finishedMs=Math.max(0,now()-started);row.status=response.status;row.outcome=response.ok?'response-ok':'response-failed';
   if(!response.ok){row.errorRead='pending';try{Promise.resolve(response.clone().json()).then(value=>{if(!stopped){row.errorCode=typeof value?.code==='string'?value.code.slice(0,128):null;row.error=typeof value?.error==='string'?text(value.error):null;row.errorRead='parsed';}},error=>{if(!stopped){row.errorRead='unreadable';row.observationError=text(error);}});}catch(error){row.errorRead='unreadable';row.observationError=text(error);}}
  },error=>{if(!stopped){row.finishedMs=Math.max(0,now()-started);row.outcome='fetch-rejected';row.error=text(error?.message??error);row.errorCode=text(error?.name);}}]);}catch(error){row.observationError=text(error);}
  return promise;
 },snapshot(){return JSON.parse(JSON.stringify({rows,omitted,requests:sequence}));},stop(){stopped=true;}};
}
/* Passive observation of the one application-owned video. Forward every play
 * call unchanged; neither readiness events nor observation authorize playback. */
function createCleanPlaybackObserver({video,readAudio,readPosition,readRenderer,readMediaStatus,style=node=>getComputedStyle(node),now=()=>performance.now(),maxRows=48,maxBytes=24*1024}) {
 if(!Number.isSafeInteger(maxRows)||maxRows<1||maxRows>64||!Number.isSafeInteger(maxBytes)||maxBytes<2||maxBytes>24*1024)throw Error('Invalid clean playback observation bound');
 const original=video.play,descriptor=Object.getOwnPropertyDescriptor(video,'play'),started=now(),encoder=new TextEncoder(),rows=[],events=['loadstart','loadedmetadata','loadeddata','canplay','canplaythrough','play','playing','waiting','stalled','suspend','seeking','seeked','pause','ended','emptied','abort','error'];
 let stopped=false,frameStarted=false,frameCount=0,lastFrame=null,callback=null,rowBytes=2,omitted=0,observationError=null;
 const counts={playAttempts:0,playResolved:0,playRejected:0,playThrew:0},mediaEvents={},text=value=>String(value??'').slice(0,512),number=value=>Number.isFinite(value)?value:value===Infinity?'Infinity':value===-Infinity?'-Infinity':null;
 const errorDetails=error=>({name:text(error?.name),message:text(error?.message??error)});
 function videoState(){return{currentSrcPresent:Boolean(video.currentSrc),currentSrcIsBlob:typeof video.currentSrc==='string'&&video.currentSrc.startsWith('blob:'),srcPresent:Boolean(video.getAttribute('src')),srcIsBlob:typeof video.src==='string'&&video.src.startsWith('blob:'),readyState:number(video.readyState),networkState:number(video.networkState),duration:number(video.duration),currentTime:number(video.currentTime),paused:video.paused,ended:video.ended,muted:video.muted,hidden:video.hidden,display:text(style(video).display),width:number(video.videoWidth),height:number(video.videoHeight),error:video.error?{code:number(video.error.code),message:text(video.error.message)}:null};}
 function append(kind,detail={}){if(stopped)return;try{
  const row={elapsedMs:Math.max(0,now()-started),kind,...detail,video:videoState()},bytes=encoder.encode(JSON.stringify(row)).length+1;
  while(rows.length&&(rows.length>=maxRows||rowBytes+bytes>maxBytes)){rowBytes-=encoder.encode(JSON.stringify(rows.shift())).length+1;omitted++;}
  if(rowBytes+bytes<=maxBytes){rows.push(row);rowBytes+=bytes;}else omitted++;
 }catch(error){observationError??=text(error);}}
 function observedPlay(...args){
  const owned=this===video&&!stopped,attempt=owned?++counts.playAttempts:null;if(owned)append('play-attempt',{attempt});
  let result;try{result=Reflect.apply(original,this,args);}catch(error){if(owned){counts.playThrew++;try{append('play-threw',{attempt,error:errorDetails(error)});}catch{observationError??='Unreadable play exception';}}throw error;}
  if(owned){try{Reflect.apply(Promise.prototype.then,result,[()=>{if(!stopped){counts.playResolved++;append('play-resolved',{attempt});}},error=>{if(!stopped){counts.playRejected++;try{append('play-rejected',{attempt,error:errorDetails(error)});}catch{observationError??='Unreadable play rejection';}}}]);}catch{append('play-returned-without-native-promise',{attempt});}}
  return result;
 }
 const onEvent=event=>{if(!stopped&&event.target===video){const elapsedMs=Math.max(0,now()-started),entry=mediaEvents[event.type]??={count:0,firstMs:elapsedMs,lastMs:elapsedMs};entry.count++;entry.lastMs=elapsedMs;append('media-event',{event:text(event.type),trusted:event.isTrusted===true});}};
 video.play=observedPlay;for(const name of events)video.addEventListener(name,onEvent,true);append('begin');
 function state(){const audio=readAudio();return{audio:audio?{sourceStarts:audio.sourceStarts,oscillatorStarts:audio.oscillatorStarts,activeSources:audio.activeSources,pendingSources:audio.pendingSources}:null,positionMs:number(readPosition()),rendererState:text(readRenderer()),mediaStatus:text(readMediaStatus()),video:videoState(),videoFrames:{count:frameCount,last:lastFrame?{...lastFrame}:null}};}
 return{state,startFrames(){
  if(frameStarted)throw Error('Clean video frame observation already started');if(typeof video.requestVideoFrameCallback!=='function')throw Error('WebView2 video frame callbacks unavailable');frameStarted=true;
  const onFrame=(_,metadata)=>{if(stopped||frameCount>=16)return;frameCount++;lastFrame={mediaTime:metadata.mediaTime,presentedFrames:metadata.presentedFrames,width:metadata.width,height:metadata.height};if(frameCount<16)callback=video.requestVideoFrameCallback(onFrame);};callback=video.requestVideoFrameCallback(onFrame);
 },snapshot(){return{current:state(),trace:{rows:rows.slice(),rowBytes,omitted,...counts,mediaEvents:Object.fromEntries(Object.entries(mediaEvents).map(([name,value])=>[name,{...value}])),observationError}};},restore(){
  stopped=true;if(callback!==null)video.cancelVideoFrameCallback(callback);for(const name of events)video.removeEventListener(name,onEvent,true);
  if(video.play===observedPlay){if(descriptor)Object.defineProperty(video,'play',descriptor);else delete video.play;}
 }};
}
function cleanPlaybackAdmission(state){return{audio:state.audio?.sourceStarts>0&&state.positionMs>300&&state.rendererState==='playing',video:state.videoFrames.count>=2&&state.videoFrames.last?.mediaTime>0};}
async function awaitCleanPlaybackAdmission({observer,until,evidence,now=()=>performance.now(),milliseconds=25000}) {
 const deadline=now()+milliseconds;let audioAdmission,videoPresentation;
 evidence.stage='audio-admission';await until(()=>{const state=observer.state();if(!cleanPlaybackAdmission(state).audio)return false;audioAdmission=state;return true;},'actual clean audio scheduling and advancing renderer clock',milliseconds);evidence.audioAdmission=audioAdmission;
 evidence.stage='video-presentation';await until(()=>{const state=observer.state(),admitted=cleanPlaybackAdmission(state);if(!admitted.audio||!admitted.video)return false;videoPresentation=state;return true;},'actual clean decoded PV frame presentation',Math.max(0,deadline-now()));evidence.videoPresentation=videoPresentation;
}
/* Capture before restoring either probe, on success and every thrown failure.
 * A secondary observation/cleanup error must not replace the original failure. */
async function retainCleanPlaybackEvidence({report,observer,restoreAudio,run}) {
 const evidence=report.playbackEvidence={version:1,stage:'media-load'};let failed=false,failure,result;
 try{result=await run(evidence);}catch(error){failed=true;failure=error;evidence.error=String(error).slice(0,512);}
 const retainError=error=>{evidence.observationError??=String(error).slice(0,512);if(!failed){failed=true;failure=error;}};
 try{evidence.final=observer.snapshot();}catch(error){retainError(error);}
 try{observer.restore();}catch(error){retainError(error);}try{restoreAudio();}catch(error){retainError(error);}
 evidence.status=failed?'failed':'passed';if(failed)throw failure;return result;
}
(() => {
 const phase=globalThis.__WMH_ACCEPTANCE_PHASE__,$=id=>document.getElementById(id),assert=(value,message)=>{if(!value)throw Error(message);};
 const fetcher=globalThis.fetch.bind(globalThis),waits=createAcceptanceWait(),until=waits.until,json=(path,options)=>waits.json(fetcher,path,options);
 const stable=value=>Array.isArray(value)?value.map(stable):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().map(key=>[key,stable(value[key])])):value;
 const frame=()=>new Promise(resolve=>requestAnimationFrame(resolve)),hash=async bytes=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),n=>n.toString(16).padStart(2,'0')).join('');
 const importReports=[],openedScoreDatabases=[],errors=[],trusted=[],chooser=createCleanChooserObserver({target:globalThis}),mediaBlobs=createCleanMediaBlobObserver(),navigation=createCleanNavigationObserver(),assetRequests=createCleanAssetRequestObserver();let sequence=0;
 const open=IDBFactory.prototype.open;IDBFactory.prototype.open=function(name,...args){if(String(name)==='worldmusichub.scores.v1')openedScoreDatabases.push(String(name));return open.call(this,name,...args);};
 globalThis.fetch=(...args)=>{const path=String(args[0]),promise=fetcher(...args);navigation.observe(path,args[1]);assetRequests.observe(path,args[1],promise);if(['/api/library/import/preview','/api/library/import/commit'].includes(path))promise.then(response=>response.clone().json().then(body=>{assert(importReports.length<8,'Clean import report bound exceeded');importReports.push({status:response.status,filename:decodeURIComponent(args[1]?.headers?.['x-wmh-filename']||''),mode:path.endsWith('preview')?'preview':'commit',body});}).catch(error=>errors.push(String(error)))).catch(()=>{});return promise;};
 addEventListener('error',event=>errors.push(String(event.message)));addEventListener('unhandledrejection',event=>errors.push(String(event.reason)));
 for(const type of ['click','change','keydown','keyup'])document.addEventListener(type,event=>{const id=event.target?.id,part=event.target?.dataset?.partId;if(!['play-button','clean-song-target','stage-title','bulk-import-save'].includes(id)&&!part)return;if(trusted.length>=128){errors.push('Native clean event observation bound exceeded');return;}trusted.push({type,trusted:event.isTrusted===true,id:id||null,part:part||null,code:event.code||null,value:event.target?.value||null,checked:typeof event.target?.checked==='boolean'?event.target.checked:null});},true);
 const click=id=>{assert($(id)&&!$(id).disabled,`Unavailable clean control ${id}`);$(id).click();},closeDialogs=()=>{for(const dialog of document.querySelectorAll('dialog[open]'))dialog.close();},menu=createAcceptanceNavigation({document,until,click});
 async function native(kind,node,file){
  assert(node&&!node.disabled,'Native clean control unavailable');node.scrollIntoView({block:'center',inline:'center'});node.focus();await frame();await frame();const bounds=node.getBoundingClientRect();assert(bounds.width>0&&bounds.height>0,'Native clean target invisible');assert(sequence<64,'Clean phase exceeds 64 native actions');
  const action={version:1,sequence:++sequence,kind,x:bounds.x+bounds.width/2,y:bounds.y+bounds.height/2,width:innerWidth,height:innerHeight,...(file?{file}:{})};const isChooser=kind==='picker';let completed=false;if(isChooser)chooser.begin(sequence,kind);
  try{await json('/__desktop_smoke/action',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(action)});let result;await until(async signal=>{const response=await fetcher(`/__desktop_smoke/result/${sequence}`,{signal});if(response.status===404)return false;result=await response.json();assert(response.ok,result.error||'Native clean result failed');return true;},`native clean ${kind} ${sequence}`);assert(result.ok,result.error||'Native clean action failed');completed=true;return sequence;}finally{if(isChooser)await chooser.end(sequence,completed);}
 }
 async function inventory(){const value=await json('/api/library/list');assert(value.storage==='native-filesystem'&&value.issues.length===0,'Clean native inventory is incomplete');return value;}
 const ready=()=>$('bulk-import-dialog')?.open&&$('bulk-import-dialog').dataset.phase==='review';
 async function choose(file){closeDialogs();click('import-tools-button');let event;const observed=value=>{event=value.type;},before=importReports.length;$('score-file').addEventListener('change',observed,{once:true,capture:true});try{await native('picker',$('import-button'),file);await until(()=>event==='change'&&ready()&&importReports.length>before,'actual clean chooser preflight');assert(importReports.at(-1).mode==='preview','Clean import bypassed preflight');}finally{$('score-file').removeEventListener('change',observed,true);}}
 async function save(){const before=importReports.length;await native('click',$('bulk-import-save'));await until(()=>ready()&&importReports.length>before&&importReports.at(-1).mode==='commit','clean package save response');}
 async function download(node){const before=(await json('/__desktop_smoke/state')).downloads.length;await native('click',node);let row;await until(async()=>{row=(await json('/__desktop_smoke/state')).downloads[before];return row?.complete;},'complete clean native download');assert(row.success,'Native clean download failed');return row.file;}
 async function take(){closeDialogs();click('results-button');const file=await download($('export-takes'));closeDialogs();return file;}
 async function observeMedia(node,role){
  await until(()=>node&&!node.hidden&&node.currentSrc&&getComputedStyle(node).display!=='none'&&(role==='pv'?node.readyState>=2&&node.videoWidth>0:node.complete&&node.naturalWidth>0),`decoded ${role}`);
  const width=role==='pv'?node.videoWidth:node.naturalWidth,height=role==='pv'?node.videoHeight:node.naturalHeight,bounds=node.getBoundingClientRect();assert(bounds.width>0&&bounds.height>0,`${role} has no drawn bounds`);if(role==='cover')assert(document.elementFromPoint(bounds.x+bounds.width/2,bounds.y+bounds.height/2)===node,'Cover is obscured by another painted element');
  const source=node.currentSrc,canvas=document.createElement('canvas');canvas.width=width;canvas.height=height;const context=canvas.getContext('2d',{willReadFrequently:true});context.drawImage(node,0,0);const pixels=context.getImageData(0,0,width,height).data;assert(new Set(pixels).size>16,`${role} decoded blank pixels`);const bytes=await mediaBlobs.readBytes(node,source);return{role,width,height,drawnWidth:bounds.width,drawnHeight:bounds.height,bytes:bytes.byteLength,sha256:await hash(bytes),pixels_sha256:await hash(pixels),unique_pixel_values:new Set(pixels).size,visible:true,...(role==='pv'?{muted:node.muted,paused:node.paused,currentTime:node.currentTime,readyState:node.readyState}: {})};
 }
 function grades(){return Object.fromEntries(['hud-accuracy','accuracy','hits','misses','timing','result-grade-perfect','result-grade-good','result-grade-early','result-grade-late','result-grade-missed','result-grade-extra'].map(id=>[id,$(id)?.textContent||'']));}
 async function activate(entry,report){
  navigation.select(entry.score_id);
  const key=`native:${entry.key}`;await until(()=>$('catalog').querySelector(`[data-library-key="${key}"]`),'ordinary clean library row');await native('click',$('catalog').querySelector(`[data-library-key="${key}"]`));await until(()=>$('song-lobby').dataset.previewId===key&&$('song-lobby').dataset.previewStatus==='ready'&&!$('start-practice').disabled,'ordinary clean preview ready');
  report.media={cover:await observeMedia($('clean-song-cover'),'cover')};report.screenshots.cover=await native('click',$('clean-song-preview-status'));
  const load=await json('/api/library/load',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({key:entry.key})}),p=load.clean_package,score=JSON.parse(p.score_json);
  assert(p.version===2,'Wrong clean package version');const counts=validateCleanFixtureInventory(score,p.runtime);
  report.package={key:entry.key,content_sha256:p.content_sha256,metadata_sha256:await hash(new TextEncoder().encode(p.metadata_json)),score_sha256:await hash(new TextEncoder().encode(p.score_json)),runtime_sha256:await hash(new TextEncoder().encode(JSON.stringify(stable(p.runtime)))),...counts,media:p.media};
  const video=$('clean-song-pv');let probe=null;const playback=createCleanPlaybackObserver({video,readAudio:()=>probe?.snapshot(),readPosition:()=>Number($('progress').value),readRenderer:()=>$('clean-song-stage').dataset.rendererState,readMediaStatus:()=>$('clean-song-media-status').textContent});
  await retainCleanPlaybackEvidence({report,observer:playback,restoreAudio:()=>probe?.restore(),run:async evidence=>{
  await native('click',$('start-practice'));await menu.waitScreen('stage','play-button','clean practice active');await until(()=>!$('play-button').disabled,'clean practice instrument ready');assert($('clean-song-stage').dataset.packageId,'Clean stage was not activated');report.media.background=await observeMedia($('clean-song-background'),'background');
  if($('notation-toggle').getAttribute('aria-expanded')!=='true')await native('click',$('notation-toggle'));await until(()=>$('written-cursor-status')?.dataset.status==='ready','clean written following ready');report.following=navigation.ready($('written-cursor-status').dataset.status);
  await native('click',$('song-parts-summary'));await until(()=>$('song-parts-tools').open,'clean parts panel open');const first=$('clean-song-target').value;
  await native('select-last',$('clean-song-target'));await until(()=>$('clean-song-target').value!==first&&!$('play-button').disabled&&$('written-cursor-status')?.dataset.status==='ready','actual target selection and written following');report.following=navigation.ready($('written-cursor-status').dataset.status);const target=$('clean-song-target').value,parts=[...document.querySelectorAll('#clean-song-parts input[data-part-id]')],human=parts.find(node=>node.dataset.partId===target),other=parts.find(node=>node.dataset.partId!==target);assert(human.disabled&&!human.checked&&other.checked&&!other.disabled,'Human target machine gate is wrong');
  await native('click',other);await until(()=>!document.querySelector(`#clean-song-parts input[data-part-id="${other.dataset.partId}"]`).checked,'other part muted');await native('click',document.querySelector(`#clean-song-parts input[data-part-id="${other.dataset.partId}"]`));await until(()=>document.querySelector(`#clean-song-parts input[data-part-id="${other.dataset.partId}"]`).checked,'other part restored');report.controls={initialTarget:first,target,other:other.dataset.partId,humanDisabled:true,humanMachineEnabled:false,otherRestored:true};report.screenshots.parts=await native('click',$('clean-song-stage-status'));await native('click',$('song-parts-summary'));
  closeDialogs();click('settings-button');if($('count-in').checked)await native('click',$('count-in'));closeDialogs();assert($('sound-button').getAttribute('aria-pressed')!=='true','Clean native sound starts muted');
  // An actual Reset establishes a fresh song clock before the two-second PV.
  await native('click',$('reset-button'));await until(()=>Number($('progress').value)===0&&!$('play-button').disabled,'clean clock reset before media proof');
  probe=observeNativeReferenceAudio();playback.startFrames();evidence.stage='native-play';evidence.beforePlay=playback.state();
   report.machineBefore={captured:$('hud-captured').textContent,grades:grades()};await native('click',$('play-button'));await awaitCleanPlaybackAdmission({observer:playback,until,evidence});evidence.stage='decoded-drawn-pv';report.media.pv=await observeMedia(video,'pv');report.videoFrames=playback.state().videoFrames;report.screenshots.playing=await native('click',$('stage-title'));report.machinePlaying={captured:$('hud-captured').textContent,grades:grades(),positionMs:Number($('progress').value),audio:probe.snapshot()};
   assert(report.machinePlaying.captured==='0'&&JSON.stringify(report.machinePlaying.grades)===JSON.stringify(report.machineBefore.grades),'Machine accompaniment changed captured inputs or grade');evidence.stage='machine-pause';await native('click',$('play-button'));await until(()=>$('stage-cue').dataset.cueState==='paused'&&probe.snapshot().activeSources===0&&probe.snapshot().pendingSources===0&&video.paused,'clean machine pause cleanup');report.audioStopped=probe.snapshot();report.files.machineTake=await take();
   if(phase==='clean-seed'){
    evidence.stage='native-human-input';
    const trace=observeNativeReferenceTransport(document);try{trace.changed('ready',{checkpoint:true});const position=Number($('progress').value);await native('click',$('play-button'));await until(()=>trace.counts().trustedPlayClicks===1&&trace.state().phase==='capturing'&&Number($('progress').value)>position,'clean input pass resumed');await native('key-r',$('stage-title'));await until(()=>trace.counts().trustedKeyDowns===1&&trace.counts().trustedKeyUps===1&&$('hud-captured').textContent==='1','one trusted native clean input');await native('click',$('play-button'));await until(()=>trace.counts().trustedPlayClicks===2&&$('stage-cue').dataset.cueState==='paused','clean typed pass paused');report.transportAdmission=trace.snapshot('complete');}finally{trace.stop();}report.files.humanTake=await take();
   }
   evidence.stage='complete';
  }});
  report.checks.push('ordinary-library-complete-clean-song','decoded-drawn-cover-background-pv','native-target-and-other-part-controls','machine-accompaniment-no-input-or-grade');
 }
 addEventListener('DOMContentLoaded',async()=>{
  const report={version:1,phase,ok:false,origin:location.origin,checks:[],errors,importReports,openedScoreDatabases,trusted,chooserObservations:chooser.records,screenshots:{},files:{}};
  try{
   assert(localStorage.getItem('wmh.clean.acceptance.marker')===null,'Clean scenario requires a fresh WebView profile');report.profileMarkerAbsent=true;localStorage.setItem('wmh.clean.acceptance.marker',phase);await menu.enterLibrary();const {getAppI18n}=await import('/app-locale.js');getAppI18n(document).setLocale('en');assert((await json('/api/health')).network==='native-protocol-no-listener','Clean acceptance requires native protocol');
   if(phase==='clean-seed'){assert((await inventory()).entries.length===0,'Clean seed requires empty native Scores');await choose('clean-authored-song.zip');assert(importReports.at(-1).body.items.length===1&&importReports.at(-1).body.items[0].status==='ready'&&(await inventory()).entries.length===0,'Clean preflight wrote or lost song');report.screenshots.preflight=await native('click',$('bulk-import-title'));await save();assert(importReports.at(-1).body.items[0].status==='saved','Complete clean package was not saved');await native('click',$('bulk-import-done'));report.checks.push('actual-picker-clean-preflight-save');}
   else assert(phase==='clean-restart','Unknown clean phase');
   const saved=await inventory();assert(saved.entries.length===1&&saved.entries[0].clean_package?.version===2,'Fresh native inventory requires exactly one complete clean song');report.inventory=saved.entries;report.directory=saved.directory;await activate(saved.entries[0],report);
   if(phase==='clean-seed'){
    await menu.returnToLibrary();closeDialogs();click('import-tools-button');click('bulk-import-history-button');const history=$('bulk-import-history');if(!history.open)await native('click',history.querySelector('summary'));await until(()=>document.querySelector('#bulk-import-export-songs input[data-import-export-key]'),'clean export row');await native('click',$('bulk-import-export-all'));report.files.package=await download($('bulk-import-export-pack'));report.reimportAfterSequence=sequence;await choose(report.files.package);await save();assert(importReports.at(-1).body.items[0].status==='duplicate'&&(await inventory()).entries.length===1,'Complete clean export did not round trip as one exact duplicate');await native('click',$('bulk-import-done'));report.files.afterReimportTake=await take();report.checks.push('complete-clean-export-reimport','trusted-native-input-causality');
   }else report.checks.push('fresh-process-exact-assets-and-music');
   assert(openedScoreDatabases.length===0,'Native clean workflow opened browser song storage');assert(errors.length===0,errors.join('; '));report.actions=sequence;report.downloads=(await json('/__desktop_smoke/state')).downloads;mediaBlobs.assertHealthy();report.following=navigation.ready(report.following.status);report.ok=true;
  }catch(error){report.error=String(error);if(error.nativeReferenceTransport)report.transportAdmission=error.nativeReferenceTransport;}
  report.assetRequests=assetRequests.snapshot();assetRequests.stop();chooser.stop();mediaBlobs.restore();await postCleanAcceptanceReport({report,fetcher,waits});
 },{once:true});
})();
