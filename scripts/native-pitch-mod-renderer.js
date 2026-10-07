/* Observe only the JSON promise the application consumes. A cloned fetch body
 * can abort after successful adoption; it is not authoritative product evidence. */
function createNativePitchRequestObserver({fetchOwner,onRequest,onError,readContext,includeOrdinary=()=>false,maxRows=40}) {
 const original=fetchOwner.fetch,rows=[],restores=new Set(),signals=new WeakMap();let stopped=false,nextSignal=0;
 const context=()=>structuredClone(readContext()),notify=error=>{try{onError(String(error?.message||error).slice(0,1024));}catch{}};
 const failure=(row,options,phase,error)=>{if(stopped)return;row.observation=phase;row.errorName=String(error?.name||'Error');row.error=String(error).slice(0,512);row.signalAborted=options?.signal?.aborted===true;row.settled=context();row.canceled=row.signalGeneration!==null&&row.signalAborted&&row.errorName==='AbortError'&&['fetch-rejected','body-rejected'].includes(phase);if(!row.canceled)notify(`${row.path} ${phase}: ${row.error}`);};
 function observedFetch(...args){
  const promise=Reflect.apply(original,this,args);
  try{
   const input=args[0],options=args[1]||{},path=typeof input==='string'?input:input.url;
   if(stopped||!['/api/pitch-mod/project','/api/assess','/api/practice-targets','/api/library/save'].includes(path))return promise;
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
/* Runs only when the native process explicitly selects its closed pitch phase.
 * Source DTOs are the actual Rust responses consumed by the product. */
(() => {
 const phase=globalThis.__WMH_ACCEPTANCE_PHASE__,$=id=>document.getElementById(id),assert=(value,message)=>{if(!value)throw Error(message);},waits=createAcceptanceWait(),fetcher=globalThis.fetch.bind(globalThis);
 const report={version:1,scenario:'pitch-mod',phase,origin:location.origin,ok:false,stage:'bootstrap',physicalAudio:false,physicalMidi:false,errors:[],requests:[],trusted:[],controls:[],files:{},checkpoints:[],setup:[]};
 let sequence=0,receiver,picker,currentControl=null;
 const frame=()=>new Promise(requestAnimationFrame),clock=()=>__wmhReadPlaybackClock(document),until=(fn,label,ms=15000)=>waits.until(()=>{receiver?.assertHealthy();return fn();},`${phase}: ${label}`,ms),json=(path,body)=>waits.json(fetcher,path,body===undefined?undefined:{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)},10000);
 const requests=createNativePitchRequestObserver({fetchOwner:globalThis,onRequest:row=>report.requests.push(row),onError:error=>report.errors.push(error),readContext:()=>({actionSequence:sequence,screen:document.body?.dataset.screen||null,previewId:$('song-lobby')?.dataset.previewId||null})});
 const record=event=>{if(report.trusted.length>=256)return;report.trusted.push({sequence,type:event.type,id:event.target?.id||null,owned:currentControl===event.target||Boolean(currentControl?.contains(event.target)),trusted:event.isTrusted===true,code:event.code||null,timeStamp:event.timeStamp,value:event.target?.value??null,position:clock().positionMs});};
 const failed=event=>{if(report.errors.length<16)report.errors.push(String(event.message||event.reason).slice(0,1024));};
 for(const type of ['click','input','change','keydown','keyup'])document.addEventListener(type,record,true);addEventListener('error',failed);addEventListener('unhandledrejection',failed);
 const storage=()=>Object.fromEntries(Object.keys(localStorage).filter(key=>key.startsWith('worldmusichub.pitch-mod.v1.')).sort().map(key=>[key,localStorage.getItem(key)]));
 const stopped=()=>({storage:storage(),clock:{positionMs:clock().positionMs,running:clock().running},audioStarted:receiver.status().started});
 const summary=where=>{const node=$('song-mod-'+where+'-summary');return{text:node.textContent,semitones:node.dataset.pitchModSemitones,digest:node.dataset.pitchModDigest};};
 function mapping(){const node=document.querySelector('#keyboard-map [data-code="KeyS"]');return{code:node?.dataset.code,midi:Number(node?.dataset.noteMidi),enabled:node?.dataset.enabled,base:Number($('keyboard-base-midi').value),offset:Number($('keyboard-input-offset').value)};}
 async function native(kind,node,file){
  report.stage=`${kind}: ${node?.id||node?.tagName||'missing'}`;assert(sequence<64&&node?.isConnected&&!node.disabled,'Pitch native target unavailable');const key=kind==='pitch-mod-key-s';let control;
  if(key){assert(document.hasFocus()&&!document.hidden&&document.activeElement===node&&node.id==='stage-title'&&!document.querySelector('dialog[open]'),'Prepared physical S focus changed');}
  else{await waitCanonicalPracticeControl({document,node,until,readClock:clock});node.scrollIntoView({block:'center',inline:'center'});await frame();await frame();control={sequence:sequence+1,id:node.id||null,kind,samples:[]};report.controls.push(control);await prepareCanonicalPracticeTarget({document,node,onSample:row=>control.samples.push(row)});}
  const b=node.getBoundingClientRect(),action={version:1,sequence:++sequence,kind,x:b.x+b.width/2,y:b.y+b.height/2,width:innerWidth,height:innerHeight,...(file?{file}:{})};assert(action.x>0&&action.x<innerWidth&&action.y>0&&action.y<innerHeight,'Native pitch target outside viewport');
  if(control)control.request={...action,target:{x:b.x,y:b.y,width:b.width,height:b.height}};const pointer=control&&observeCanonicalPracticeOwnedClick({document,node,sequence});if(control)control.clicks=pointer.events;currentControl=node;
  try{if(kind==='picker')picker.beginPicker(sequence,file);await json('/__desktop_smoke/action',action);let result;await until(async()=>{const response=await fetcher(`/__desktop_smoke/result/${sequence}`);if(response.status===404)return false;result=await response.json();return true;},`native pitch action ${sequence}`);if(control)control.result=result;assert(result.ok,result.error||'Native action failed');if(control)await requireCanonicalPracticeOwnedClick({until,events:pointer.events,sequence,id:node.id,kind});return sequence;}finally{pointer?.restore();currentControl=null;}
 }
 const click=id=>native('click',typeof id==='string'?$(id):id),close=id=>click($(id).querySelector('[data-close-panel]'));
 async function select(node,value){if(typeof node==='string')node=$(node);if(node.value===value)return;const index=[...node.options].findIndex(option=>option.value===value);assert(index===0||index===1||index===node.options.length-1,'Closed native selector');await native(index===0?'select-first':index===1?'select-second':'select-last',node);assert(node.value===value,'Actual selected value differs');}
 async function download(id,name,panel){await click(panel+'-button');await until(()=>!$(id).disabled,'export available');const before=(await json('/__desktop_smoke/state')).downloads.length;await click(id);let row;await until(async()=>{row=(await json('/__desktop_smoke/state')).downloads[before];return row?.complete;},'native download');assert(row.success,'Download failed');report.files[name]=row.file;await close(panel+'-dialog');}
 async function seed(){
  await click('import-tools-button');const action=await native('picker',$('import-button'),'pitch-mod-original-c4.json');let complete=false;
  try{await until(()=>document.querySelector('.score-storage-status')?.dataset.persistence==='saved'&&report.requests.some(row=>row.path==='/api/library/save'&&row.observation==='consumed'),'original canonical source saved');complete=true;}finally{picker.endPicker(action,complete);}await close('import-tools-dialog');
 }
 addEventListener('DOMContentLoaded',async()=>{
  try{
   assert(['pitch-mod-seed','pitch-mod-restart'].includes(phase),'Unknown native pitch phase');
   await prepareNativePlaybackClock({document,until});const{CanonicalAudioReceiver}=await import('/canonical-audio-receiver.js');receiver=await observeBasicKeyReceiver(document,{Receiver:CanonicalAudioReceiver,readStartFrame:note=>note[1],readEndFrame:note=>note[2],readSampleOffsetFrames:canonicalPracticeSampleOffsetFrames});picker=createVsqControlObserver(document,{readActionSequence:()=>sequence});
   report.buildIdentity=await json('/api/diagnostics/build');assert((await json('/api/health')).network==='native-protocol-no-listener','Native transport required');(await import('/app-locale.js')).getAppI18n(document).setLocale('en');await click('home-single-player');
   // Disclosed instrument/count-in setup only; pitch and keyboard mapping below
   // use actual owned controls, never synthetic musical input or source state.
   const set=(id,value,event)=>{$(id).value=String(value);$(id).dispatchEvent(new Event(event,{bubbles:true}));};set('key-count',88,'change');$('count-in').checked=false;$('count-in').dispatchEvent(new Event('change',{bubbles:true}));$('metronome-enabled').checked=false;$('metronome-enabled').dispatchEvent(new Event('change',{bubbles:true}));report.setup.push({kind:'scripted-instrument-and-count-in-only',keyCount:88,countIn:false,metronome:false});
   await click('settings-button');await select('keyboard-preset','legacy');report.mapping=mapping();assert(report.mapping.midi===62&&report.mapping.offset===0&&report.mapping.base===60&&report.mapping.enabled==='true','Actual legacy S mapping must read D4');await close('settings-dialog');
   report.storageBefore=storage();if(phase==='pitch-mod-seed'){assert(Object.keys(report.storageBefore).length===0,'Seed requires empty Mod sidecar');await seed();}
   report.inventory=await json('/api/library/list');assert(report.inventory.entries.length===1&&report.inventory.issues.length===0,'Only one authored native score');report.key=report.inventory.entries[0].key;report.sourceBefore=await json('/api/library/load',{key:report.key});
   await until(()=>document.querySelector(`#catalog [data-library-key="native:${report.key}"]`),'saved original catalog row');await click(document.querySelector(`#catalog [data-library-key="native:${report.key}"]`));await until(()=>!$('configure-song-mod').disabled&&!$('start-performance').disabled,'current original projection restored');
   if(phase==='pitch-mod-seed'){
    await click('configure-song-mod');await click('song-mod-all-machine');await select(document.querySelector('[data-mod-performer="human"]'),'human');await select('song-mod-layout','complete');if(!$('song-mod-show-others').checked)await click('song-mod-show-others');
    await native('pitch-mod-shift-two',$('song-mod-pitch-shift'));assert($('song-mod-pitch-shift').value==='2','Actual +2 draft readback');report.beforeCheck=stopped();report.checkAction=await click('song-mod-pitch-check');await until(()=>$('song-mod-pitch-status').dataset.pitchModStatus==='checked','real Rust pitch Check');report.afterCheck=stopped();assert(JSON.stringify(report.beforeCheck)===JSON.stringify(report.afterCheck),'Check changed playback or sidecar');
    report.applyAction=await click('song-mod-apply');await until(()=>!$('song-mod-dialog').open,'atomic pitch apply');
   }else{
    await until(()=>$('song-mod-preview-summary').dataset.pitchModSemitones==='2','saved pitch revalidated after process restart');await click('configure-song-mod');assert($('song-mod-pitch-shift').value==='2','Restored draft must remain +2');await click('song-mod-cancel');
   }
   report.applied=summary('preview');report.storageApplied=storage();assert(report.applied.semitones==='2'&&report.applied.digest,'Effective D4 identity missing');
   await click('start-performance');await until(()=>document.body.dataset.screen==='stage'&&clock().running,'actual canonical source playback');
   if(phase==='pitch-mod-restart'){
    $('stage-title').focus({preventScroll:true});await frame();await frame();report.inputPreparation={mapping:mapping(),clock:clock(),focus:document.activeElement.id};assert(report.inputPreparation.mapping.midi===62&&report.inputPreparation.clock.positionMs<3700,'D4 input prepared too late');
    await until(()=>clock().positionMs>=3890,'physical D4 onset');assert(clock().positionMs<4110,'Physical D4 window missed');report.keyAction=await native('pitch-mod-key-s',$('stage-title'));
   }
   await until(()=>clock().completed&&receiver.quiet()&&canonicalPracticeCompletionReady(document),'actual complete source and assessment',15000);
   report.audio={runs:compactCanonicalPracticeAudio(receiver.snapshot()),status:receiver.status()};report.stageSummary=summary('stage');
   await download('export-takes','take','results');await download('export-button','original','score-tools');
   report.sourceAfter=await json('/api/library/load',{key:report.key});report.storageAfter=storage();await until(()=>requests.settled(),'consumed request evidence');assert(report.errors.length===0,report.errors.join('; '));report.stage='complete';report.ok=true;
  }catch(error){report.error=String(error.stack||error);try{report.failedAudio={runs:receiver?.snapshot(),status:receiver?.status()};}catch{}}
  finally{report.actions=sequence;report.pickerObservations=picker?.pickers||[];report.requestsRestored=requests.restore();picker?.restore();for(const type of ['click','input','change','keydown','keyup'])document.removeEventListener(type,record,true);removeEventListener('error',failed);removeEventListener('unhandledrejection',failed);report.cleanup=receiver?.restore();const bytes=new TextEncoder().encode(JSON.stringify(report)).length;await json('/__desktop_smoke/report',bytes<1024*1024?report:{version:1,phase,scenario:'pitch-mod',ok:false,error:'Pitch evidence exceeds 1 MiB',receivedBytes:bytes});}
 },{once:true});
})();
