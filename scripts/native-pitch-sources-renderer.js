/* Observe only the JSON promise the application consumes. A cloned fetch body
 * can abort after successful adoption; it is not authoritative product evidence. */
function createNativePitchSourcesRequestObserver({fetchOwner,onRequest,onError,readContext,includeOrdinary=()=>false,maxRows=96}) {
 const original=fetchOwner.fetch,rows=[],restores=new Set(),signals=new WeakMap();let stopped=false,nextSignal=0;
 const context=()=>structuredClone(readContext()),notify=error=>{try{onError(String(error?.message||error).slice(0,1024));}catch{}};
 const failure=(row,options,phase,error)=>{if(stopped)return;row.observation=phase;row.errorName=String(error?.name||'Error');row.error=String(error).slice(0,512);row.signalAborted=options?.signal?.aborted===true;row.settled=context();row.canceled=row.signalGeneration!==null&&row.signalAborted&&row.errorName==='AbortError'&&['fetch-rejected','body-rejected'].includes(phase);if(!row.canceled)notify(`${row.path} ${phase}: ${row.error}`);};
 function observedFetch(...args){
  const promise=Reflect.apply(original,this,args);
  try{
   const input=args[0],options=args[1]||{},path=typeof input==='string'?input:input.url;
   if(stopped||!['/api/library/pitch-mod/project','/api/library/runtime','/api/library/basic-keys/notation','/api/export/musicxml','/api/assess','/api/practice-targets'].includes(path))return promise;
   if(rows.length>=maxRows)throw Error('Bounded assistance requests exceeded');
   const signal=options.signal;if(signal&&!signals.has(signal))signals.set(signal,++nextSignal);
   const row={path,request:JSON.parse(options.body),status:null,response:null,observation:'fetching',signalGeneration:signal?signals.get(signal):null,signalAbortedAtStart:signal?.aborted===true,signalAborted:false,canceled:false,started:context(),settled:null};rows.push(row);onRequest(row);
   Reflect.apply(Promise.prototype.then,promise,[response=>{
    if(stopped)return;row.status=response.status;row.observation='awaiting-json';
    try{
     const json=response.json,descriptor=Object.getOwnPropertyDescriptor(response,'json');
     const restore=()=>{if(response.json===observedJson){if(descriptor)Object.defineProperty(response,'json',descriptor);else delete response.json;}restores.delete(restore);};
     function observedJson(...args){
      let result;try{result=Reflect.apply(json,this,args);}catch(error){if(this===response)failure(row,options,'body-threw',error);throw error;}
      if(this===response){row.observation='consuming';try{Reflect.apply(Promise.prototype.then,result,[value=>{try{if(!stopped){const copied=structuredClone(value);if(new TextEncoder().encode(JSON.stringify(copied)).length>256*1024)throw Error('Consumed assistance response exceeds 256 KiB');row.response=copied;row.observation='consumed';row.signalAborted=signal?.aborted===true;row.settled=context();}}catch(error){failure(row,options,'observation-failed',error);}finally{restore();}},error=>{try{failure(row,options,'body-rejected',error);}finally{restore();}}]);}catch(error){failure(row,options,'observation-failed',error);restore();}}
      return result;
     }
     response.json=observedJson;restores.add(restore);
    }catch(error){failure(row,options,'observation-failed',error);}
   },error=>failure(row,options,'fetch-rejected',error)]);
  }catch(error){notify(error);}
  return promise;
 }
 fetchOwner.fetch=observedFetch;
 return{settled:()=>rows.every(r=>['consumed','fetch-rejected','body-rejected','body-threw','observation-failed'].includes(r.observation)),restore(){stopped=true;for(const restore of [...restores])restore();if(fetchOwner.fetch===observedFetch)fetchOwner.fetch=original;return fetchOwner.fetch===original;}};
}
/* Complete saved Basic FIFO and VSQ semantic clean sources only. Source timing,
 * receiver plans, note identities and request results are never replaced. */
(() => {
 const phase=globalThis.__WMH_ACCEPTANCE_PHASE__,$=id=>document.getElementById(id),assert=(value,message)=>{if(!value)throw Error(message);},waits=createAcceptanceWait(),fetcher=globalThis.fetch.bind(globalThis);
 const report={version:1,scenario:'pitch-sources',phase,origin:location.origin,ok:false,stage:'bootstrap',physicalAudio:false,physicalMidi:false,sourceSpecificTrustedHits:false,errors:[],requests:[],trusted:[],controls:[],files:{},cases:[],setup:[]};
 let sequence=0,receiver,picker,currentControl=null,currentCase=null;
 const frame=()=>new Promise(requestAnimationFrame),clock=()=>__wmhReadPlaybackClock(document),until=(fn,label,ms=15000)=>waits.until(()=>{receiver?.assertHealthy();return fn();},`${phase}: ${label}`,ms),json=(path,body)=>waits.json(fetcher,path,body===undefined?undefined:{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)},10000);
 const requests=createNativePitchSourcesRequestObserver({fetchOwner:globalThis,onRequest:row=>report.requests.push(row),onError:error=>report.errors.push(error),readContext:()=>({actionSequence:sequence,case:currentCase,screen:document.body?.dataset.screen||null,previewId:$('song-lobby')?.dataset.previewId||null})});
 const record=event=>{if(report.trusted.length>=1024)return;report.trusted.push({sequence,type:event.type,id:event.target?.id||null,owned:currentControl===event.target||Boolean(currentControl?.contains(event.target)),trusted:event.isTrusted===true,code:event.code||null,timeStamp:event.timeStamp,value:event.target?.value??null,position:clock().positionMs});};
 const failed=event=>{if(report.errors.length<16)report.errors.push(String(event.message||event.reason).slice(0,1024));};
 for(const type of ['click','input','change','keydown','keyup'])document.addEventListener(type,record,true);addEventListener('error',failed);addEventListener('unhandledrejection',failed);
 const storage=()=>Object.fromEntries(Object.keys(localStorage).filter(key=>key.startsWith('worldmusichub.pitch-mod.v1.')).sort().map(key=>[key,localStorage.getItem(key)]));
 const summary=where=>{const node=$('song-mod-'+where+'-summary');return{semitones:node.dataset.pitchModSemitones,digest:node.dataset.pitchModDigest,text:node.textContent};};
 const stopped=()=>({storage:storage(),clock:{positionMs:clock().positionMs,running:clock().running},sourceStarts:receiver.status().started});
 async function native(kind,node,file){
  report.stage=`${kind}: ${node?.id||node?.tagName||'missing'}`;assert(sequence<128&&node?.isConnected&&!node.disabled,'Source acceptance target unavailable');
  await waitCanonicalPracticeControl({document,node,until,readClock:clock});node.scrollIntoView({block:'center',inline:'center'});await frame();await frame();
  const control={sequence:sequence+1,id:node.id||null,kind,samples:[]};report.controls.push(control);await prepareCanonicalPracticeTarget({document,node,onSample:row=>control.samples.push(row)});
  const bounds=node.getBoundingClientRect(),action={version:1,sequence:++sequence,kind,x:bounds.x+bounds.width/2,y:bounds.y+bounds.height/2,width:innerWidth,height:innerHeight,...(file?{file}:{})};assert(action.x>0&&action.x<innerWidth&&action.y>0&&action.y<innerHeight,'Owned source target is outside viewport');
  control.request={...action,target:{x:bounds.x,y:bounds.y,width:bounds.width,height:bounds.height}};const pointer=observeCanonicalPracticeOwnedClick({document,node,sequence});control.clicks=pointer.events;currentControl=node;
  try{if(kind==='picker')picker.beginPicker(sequence,file);await json('/__desktop_smoke/action',action);let result;await until(async()=>{const response=await fetcher(`/__desktop_smoke/result/${sequence}`);if(response.status===404)return false;result=await response.json();return true;},`source native action ${sequence}`);control.result=result;assert(result.ok,result.error||'Native source action failed');await requireCanonicalPracticeOwnedClick({until,events:pointer.events,sequence,id:node.id,kind});return sequence;}finally{pointer.restore();currentControl=null;}
 }
 const click=id=>native('click',typeof id==='string'?$(id):id),close=id=>click($(id).querySelector('[data-close-panel]'));
 async function select(node,value){if(typeof node==='string')node=$(node);if(node.value===value)return;const index=[...node.options].findIndex(option=>option.value===value);assert(index===0||index===1||index===node.options.length-1,'Closed source selector position');await native(index===0?'select-first':index===1?'select-second':'select-last',node);assert(node.value===value,'Source native selected value differs');}
 async function apply(){await click('song-mod-apply');await until(()=>!$('song-mod-dialog').open,'saved source Mod applied');}
 async function choose(kind,row){
  if(document.body.dataset.screen==='stage')await click('back-to-library');
  await until(()=>document.querySelector(`#catalog [data-library-key="native:${row.key}"]`),'saved source catalog row');await click(document.querySelector(`#catalog [data-library-key="native:${row.key}"]`));
  if(kind==='vsq'){
   await until(()=>$('song-lobby').dataset.previewStatus==='choice','fresh explicit VSQ choice');
   const before={runtimeRequests:report.requests.filter(request=>request.path==='/api/library/runtime').length,activeReceivers:receiver.status().activeReceivers,pendingReceivers:receiver.status().pendingReceivers,startDisabled:$('start-performance').disabled,modDisabled:$('configure-song-mod').disabled};
   assert(before.startDisabled&&before.modDisabled&&before.activeReceivers===0&&before.pendingReceivers===0,'VSQ cannot inherit a runtime choice or start audio');
   const actionSequence=await click('vsq-choose-base-notes');await until(()=>!$('configure-song-mod').disabled&&!$('start-performance').disabled,'explicit VSQ native runtime selected');
   await until(()=>report.requests.some(request=>request.path==='/api/library/runtime'&&request.started.actionSequence===actionSequence&&request.observation==='consumed'),'consumed explicit VSQ choice');
   return{before,actionSequence,after:{runtimeRequests:report.requests.filter(request=>request.path==='/api/library/runtime').length},runtime:report.requests.find(request=>request.path==='/api/library/runtime'&&request.started.actionSequence===actionSequence)};
  }
  await until(()=>!$('configure-song-mod').disabled&&!$('start-performance').disabled,'complete Basic rendition selected');return null;
 }
 async function configure(kind,semitones,{human=false}={}){
  await click('configure-song-mod');await click('song-mod-all-machine');
  if(human)await select(document.querySelector(`[data-mod-performer="${kind==='basic'?'midi-t1-c1-r0':'vsq-track-1'}"]`),'human');
  await select('song-mod-layout','complete');if(!$('song-mod-show-others').checked)await click('song-mod-show-others');
  if(Number($('song-mod-pitch-shift').value)!==semitones){
   if(semitones===0)await click('song-mod-pitch-zero');else{assert(phase==='pitch-sources-seed'&&semitones===2,'Only seed prepares fixed +2');await native('pitch-sources-shift-two',$('song-mod-pitch-shift'));}
   const before=stopped();await click('song-mod-pitch-check');await until(()=>$('song-mod-pitch-status').dataset.pitchModStatus==='checked','source-bound Rust pitch checked');assert(JSON.stringify(stopped())===JSON.stringify(before),'Source Check changed clock, audio or saved sidecar');
  }
  await apply();assert(summary('preview').semitones===String(semitones),'Applied source pitch differs');
 }
 async function notation(kind){
  if($('notation-toggle').getAttribute('aria-expanded')!=='true')await click('notation-toggle');
  const tools=$('notation-tools');await until(()=>!tools.hidden,'visible Score options');if(!tools.open)await click(tools.querySelector('summary'));
  await click('engraved-button');
  await select('notation-scope','all');
  if(kind==='basic'){await until(()=>!$('engraving-basic-meter').closest('[hidden]'),'Basic meter control');await select('engraving-basic-meter','4/4');}
  await until(()=>['ready','empty_page','percussion_selectors','onset_page'].includes($('workspace').dataset.notationRenderStatus),'complete native notation ready');
  const staff={scope:$('workspace').dataset.notationScope,status:$('workspace').dataset.notationRenderStatus,renderedParts:JSON.parse($('workspace').dataset.renderedNotationParts||'[]'),sourceIds:[...new Set([...document.querySelectorAll('#engraved-staff [data-source-note-id]')].map(node=>node.dataset.sourceNoteId))].sort(),svgCount:document.querySelectorAll('#engraved-staff svg').length,selectors:[...document.querySelectorAll('#basic-rendition-events-list li')].map(node=>({id:node.dataset.noteId||node.dataset.sourceNoteId||null,text:node.textContent}))};
  if(tools.open)await click(tools.querySelector('summary'));const staffAction=await click('stage-title');
  if(!tools.open)await click(tools.querySelector('summary'));
  await click('jianpu-button');if(!$('jianpu-reference').closest('[hidden]'))await select('jianpu-reference','fixed');
  await select('notation-scope','all');await frame();await frame();
  const rows=[];for(let page=0;page<8;page++){rows.push(...[...document.querySelectorAll('#notation .score-note')].map(node=>({id:node.dataset.noteId,number:node.querySelector('.jianpu-note')?.textContent||null,accidental:node.querySelector('.accidental')?.textContent||'',text:node.textContent})));if($('notation-next').disabled)break;await click('notation-next');}
  if(tools.open)await click(tools.querySelector('summary'));const jianpuAction=await click('stage-title');return{staff,rows,pitchSummary:summary('stage'),screenshots:{staff:staffAction,jianpu:jianpuAction}};
 }
 async function run(kind,{human=false,name}){
  const from=receiver.count(),requestStart=report.requests.length;await click('start-performance');
  // These original sources may end during a host screenshot. Authentic start
  // and natural-end ledgers prove the run even when the UI is already ended.
  await until(()=>document.body.dataset.screen==='stage'&&(clock().running||clock().completed),'actual native source started');
  await until(()=>clock().completed&&receiver.quiet()&&canonicalPracticeCompletionReady(document),'native source natural end and assessment',15000);
  const observed=clock(),result={audio:{runs:receiver.snapshot().slice(from).filter(row=>row.started),status:receiver.status()},ended:{completed:observed.completed,phase:observed.phase,positionMs:observed.positionMs,durationMs:observed.durationMs,captured:$('hud-captured').textContent},assessmentRequests:report.requests.slice(requestStart).filter(row=>row.path==='/api/assess')};
  if(human){
   result.targetPart=kind==='basic'?'midi-t1-c1-r0':'vsq-track-1';result.targets=report.requests.findLast(row=>row.path==='/api/practice-targets'&&row.observation==='consumed'&&row.started.case===currentCase&&row.request.timeline.notes.every(note=>note.part_id===result.targetPart));result.assessment=result.assessmentRequests.at(-1);
   await click('results-button');await until(()=>!$('export-takes').disabled,'native source take export ready');const before=(await json('/__desktop_smoke/state')).downloads.length;await click('export-takes');let file;await until(async()=>{file=(await json('/__desktop_smoke/state')).downloads[before];return file?.complete;},'source take download');assert(file.success,'Source take export failed');result.takeFile=file.file;report.files[name]=file.file;await close('results-dialog');
  }
  result.notation=await notation(kind);return result;
 }
 async function exercise(kind,semitones,row){
  currentCase=`${kind}-${semitones}`;const requestStart=report.requests.length;
  const item={kind,semitones,sourceBefore:await json('/api/library/load',{key:row.key}),storageBefore:storage()};item.vsqChoice=await choose(kind,row);
  await configure(kind,semitones);item.applied=summary('preview');item.machine=await run(kind,{name:`${kind}-${semitones}-listen`});
  item.humanChoice=await choose(kind,row);await configure(kind,semitones,{human:true});item.human=await run(kind,{human:true,name:`${kind}-${semitones}-human`});
  item.sourceAfter=await json('/api/library/load',{key:row.key});item.storageAfter=storage();await until(()=>requests.settled(),'source consumed responses settled');
  const rows=report.requests.slice(requestStart);item.projectChecks=rows.filter(request=>request.path==='/api/library/pitch-mod/project'&&request.request.configuration.semitones===semitones);item.projection=item.projectChecks.at(-1)||null;item.notationRequests=rows.filter(request=>request.path==='/api/library/basic-keys/notation'&&request.request.source.key===row.key&&(request.request.pitch_mod?.semitones||0)===semitones);item.exportRequests=rows.filter(request=>request.path==='/api/export/musicxml');
  if(semitones===0){const original=item.sourceBefore.clean_package,source={key:row.key,content_sha256:original.content_sha256,profile:original.profile,choice:kind==='vsq'?'base_notes_instrumental':null,runtime_policy:kind==='vsq'?'wmh-vsq-base-note-practice-v1':'wmh-basic-key-rendition-fifo-v1'},request={source,configuration:{format:'wmc-pitch-mod',version:1,semitones:0}};item.readOnlyZeroProjection={scope:'read-only native zero API equivalence; not product adoption',request,response:await json('/api/library/pitch-mod/project',request),status:200};}
  report.cases.push(item);currentCase=null;
 }
 addEventListener('DOMContentLoaded',async()=>{
  try{
   assert(['pitch-sources-seed','pitch-sources-restart','pitch-sources-zero','pitch-sources-zero-restart'].includes(phase),'Unknown source pitch phase');await prepareNativePlaybackClock({document,until});receiver=await observeBasicKeyReceiver(document);picker=createVsqControlObserver(document,{readActionSequence:()=>sequence});
   report.buildIdentity=await json('/api/diagnostics/build');assert((await json('/api/health')).network==='native-protocol-no-listener','Actual native source protocol required');(await import('/app-locale.js')).getAppI18n(document).setLocale('en');await click('home-single-player');
   const set=(id,value,event)=>{$(id).value=String(value);$(id).dispatchEvent(new Event(event,{bubbles:true}));};set('key-count','custom','change');set('custom-key-count',88,'input');set('custom-lowest','A0','input');$('instrument-apply').click();$('count-in').checked=false;$('count-in').dispatchEvent(new Event('change',{bubbles:true}));$('metronome-enabled').checked=false;$('metronome-enabled').dispatchEvent(new Event('change',{bubbles:true}));report.setup.push({kind:'scripted-instrument-and-count-in-only',profile:{kind:'piano',key_count:88,lowest_midi:21},countIn:false,metronome:false});
   report.storageBefore=storage();
   if(phase==='pitch-sources-seed'){
    assert(Object.keys(report.storageBefore).length===0,'Original source seed needs an empty Mod namespace');await click('import-tools-button');const action=await native('picker',$('import-button'),'pitch-sources-original.wmhpack');let complete=false;try{await until(()=>$('bulk-import-dialog').open&&$('bulk-import-dialog').dataset.phase==='review'&&!$('bulk-import-save').disabled,'original complete source archive review');complete=true;}finally{picker.endPicker(action,complete);}await click('bulk-import-save');await until(async()=>(await json('/api/library/list')).entries.length===2,'both complete original sources saved');await click('bulk-import-done');if($('import-tools-dialog').open)await close('import-tools-dialog');
   }
   report.inventory=await json('/api/library/list');assert(report.inventory.entries.length===2&&report.inventory.issues.length===0,'Exactly two original sources required');const sources={};for(const row of report.inventory.entries){const loaded=await json('/api/library/load',{key:row.key});sources[loaded.clean_package.profile==='wmh-basic-keys-midi1-v1'?'basic':'vsq']=row;}assert(sources.basic&&sources.vsq,'Missing original source kind');
   for(const semitones of [['pitch-sources-seed','pitch-sources-restart'].includes(phase)?2:0])for(const kind of ['basic','vsq'])await exercise(kind,semitones,sources[kind]);
   report.storageAfter=storage();assert(report.errors.length===0,report.errors.join('; '));report.stage='complete';report.ok=true;
  }catch(error){report.error=String(error.stack||error);try{report.failedAudio={runs:receiver?.snapshot(),status:receiver?.status()};}catch{}}
  finally{report.actions=sequence;report.pickerObservations=picker?.pickers||[];report.requestsRestored=requests.restore();picker?.restore();for(const type of ['click','input','change','keydown','keyup'])document.removeEventListener(type,record,true);removeEventListener('error',failed);removeEventListener('unhandledrejection',failed);report.cleanup=receiver?.restore();const bytes=new TextEncoder().encode(JSON.stringify(report)).length;await json('/__desktop_smoke/report',bytes<1024*1024?report:{version:1,phase,scenario:'pitch-sources',ok:false,error:'Native source pitch evidence exceeds 1 MiB',receivedBytes:bytes});}
 },{once:true});
})();
