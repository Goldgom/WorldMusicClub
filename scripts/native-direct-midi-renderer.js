/* Observe only the JSON promise the application consumes. A cloned fetch body
 * can abort after successful adoption; it is not authoritative product evidence. */
function createNativeDirectMidiRequestObserver({fetchOwner,onRequest,onError,readContext,includeOrdinary=()=>false,maxRows=40}) {
 const original=fetchOwner.fetch,rows=[],restores=new Set(),signals=new WeakMap();let stopped=false,nextSignal=0;
 const context=()=>structuredClone(readContext()),notify=error=>{try{onError(String(error?.message||error).slice(0,1024));}catch{}};
 const failure=(row,options,phase,error)=>{if(stopped)return;row.observation=phase;row.errorName=String(error?.name||'Error');row.error=String(error).slice(0,512);row.signalAborted=options?.signal?.aborted===true;row.settled=context();row.canceled=row.signalGeneration!==null&&row.signalAborted&&row.errorName==='AbortError'&&['fetch-rejected','body-rejected'].includes(phase);if(!row.canceled)notify(`${row.path} ${phase}: ${row.error}`);};
 function observedFetch(...args){
  const promise=Reflect.apply(original,this,args);
  try{
   const input=args[0],options=args[1]||{},path=typeof input==='string'?input:input.url;
   if(stopped||!['/api/import/midi','/api/library/import/preview','/api/library/import/commit','/api/library/load','/api/practice-targets','/api/assess'].includes(path))return promise;
   if(rows.length>=maxRows)throw Error('Bounded direct MIDI requests exceeded');
   const signal=options.signal;if(signal&&!signals.has(signal))signals.set(signal,++nextSignal);
   const row={path,request:typeof options.body==='string'?JSON.parse(options.body):null,status:null,response:null,observation:'fetching',signalGeneration:signal?signals.get(signal):null,signalAbortedAtStart:signal?.aborted===true,signalAborted:false,canceled:false,started:context(),settled:null};rows.push(row);onRequest(row);
   Reflect.apply(Promise.prototype.then,promise,[response=>{
    if(stopped)return;row.status=response.status;row.observation='awaiting-json';
    try{
     const json=response.json,descriptor=Object.getOwnPropertyDescriptor(response,'json');
     const restore=()=>{if(response.json===observedJson){if(descriptor)Object.defineProperty(response,'json',descriptor);else delete response.json;}restores.delete(restore);};
     function observedJson(...args){
      let result;try{result=Reflect.apply(json,this,args);}catch(error){if(this===response)failure(row,options,'body-threw',error);throw error;}
      if(this===response){row.observation='consuming';try{Reflect.apply(Promise.prototype.then,result,[value=>{try{if(!stopped){const copied=structuredClone(value);if(new TextEncoder().encode(JSON.stringify(copied)).length>256*1024)throw Error('Consumed direct MIDI response exceeds 256 KiB');row.response=copied;row.observation='consumed';row.signalAborted=signal?.aborted===true;row.settled=context();}}catch(error){failure(row,options,'observation-failed',error);}finally{restore();}},error=>{try{failure(row,options,'body-rejected',error);}finally{restore();}}]);}catch(error){failure(row,options,'observation-failed',error);restore();}}
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
/* Process-owner-only original MIDI acceptance. Every consequential UI action
 * uses the existing owned native broker. No FileList, source state or hit injection. */
(() => {
 const phase=globalThis.__WMH_ACCEPTANCE_PHASE__,$=id=>document.getElementById(id),assert=(value,message)=>{if(!value)throw Error(message);};
 const waits=createAcceptanceWait(),until=waits.until,fetcher=globalThis.fetch.bind(globalThis),frame=()=>new Promise(requestAnimationFrame);
 const report={version:1,scenario:'direct-midi',phase,origin:location.origin,ok:false,stage:'bootstrap',requests:[],errors:[],controls:[],screenshots:{},files:{}};
 let sequence=0,picker;
 const json=(path,body)=>waits.json(fetcher,path,body===undefined?undefined:{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)},10000);
 const requests=createNativeDirectMidiRequestObserver({fetchOwner:globalThis,onRequest:row=>report.requests.push(row),onError:error=>report.errors.push(error),readContext:()=>({sequence,screen:document.body?.dataset.screen||null,previewId:$('song-lobby')?.dataset.previewId||null})});
 const failed=event=>{if(report.errors.length<16)report.errors.push(String(event.message||event.reason).slice(0,1024));};
 addEventListener('error',failed);addEventListener('unhandledrejection',failed);
 async function native(kind,node,file){
  report.stage=`${kind}: ${node?.id||node?.tagName||'missing'}`;assert(sequence<64&&node?.isConnected&&!node.disabled,'Direct MIDI native target unavailable');
  await waitCanonicalPracticeControl({document,node,until,readClock:()=>__wmhReadPlaybackClock(document)});
  node.scrollIntoView({block:'center',inline:'center'});await frame();await frame();
  const control={sequence:sequence+1,id:node.id||null,kind,samples:[]};report.controls.push(control);
  await prepareCanonicalPracticeTarget({document,node,onSample:row=>control.samples.push(row)});
  const b=node.getBoundingClientRect(),action={version:1,sequence:++sequence,kind,x:b.x+b.width/2,y:b.y+b.height/2,width:innerWidth,height:innerHeight,...(file?{file}:{})};
  assert(action.x>0&&action.x<innerWidth&&action.y>0&&action.y<innerHeight,'Direct MIDI control outside viewport');
  control.request={...action,target:{x:b.x,y:b.y,width:b.width,height:b.height}};
  const pointer=observeCanonicalPracticeOwnedClick({document,node,sequence});control.clicks=pointer.events;
  try{
   if(kind==='picker')picker.beginPicker(sequence,file);
   await json('/__desktop_smoke/action',action);let result;
   await until(async()=>{const response=await fetcher(`/__desktop_smoke/result/${sequence}`);if(response.status===404)return false;result=await response.json();return true;},`native direct MIDI ${sequence}`);
   assert(result.ok,result.error||'Native action failed');await requireCanonicalPracticeOwnedClick({until,events:pointer.events,sequence,id:node.id,kind});return sequence;
  }finally{pointer.restore();}
 }
 const click=id=>native('click',typeof id==='string'?$(id):id);
 async function download(node,name){
  const before=(await json('/__desktop_smoke/state')).downloads.length;const action=await click(node);let row;
  await until(async()=>{row=(await json('/__desktop_smoke/state')).downloads[before];return row?.complete;},'complete native download');assert(row.success,'Download failed');report.files[name]=row.file;report.downloads??={};report.downloads[name]={action,...row};
 }
 const clock=()=>__wmhReadPlaybackClock(document);
 const preview=()=>({screen:document.body.dataset.screen,id:$('song-lobby').dataset.previewId,status:$('song-lobby').dataset.previewStatus,startDisabled:$('start-performance').disabled,bulkDialog:$('bulk-import-dialog').open,notice:$('notice').textContent,clock:clock()});
 addEventListener('DOMContentLoaded',async()=>{
  try{
   assert(['direct-midi-seed','direct-midi-restart'].includes(phase),'Unknown direct MIDI phase');await prepareNativePlaybackClock({document,until});
   picker=createVsqControlObserver(document,{readActionSequence:()=>sequence});
   report.buildIdentity=await json('/api/diagnostics/build');assert((await json('/api/health')).network==='native-protocol-no-listener','Native protocol required');
   assert(localStorage.getItem('wmh.direct-midi.acceptance')===null,'Fresh profile required');report.profileMarkerAbsent=true;localStorage.setItem('wmh.direct-midi.acceptance',phase);
   (await import('/app-locale.js')).getAppI18n(document).setLocale('en');
   await until(()=>$('home-single-player')&&!$('home-single-player').disabled,'visible home');await click('home-single-player');
   await until(()=>$('song-lobby').dataset.previewStatus==='ready'&&!$('configure-song-mod').disabled,'bootstrap library ready');
   report.initialInventory=await json('/api/library/list');
   if(phase==='direct-midi-seed'){
    assert(report.initialInventory.entries.length===0,'Seed requires empty owned library');await click('import-tools-button');
    const action=await native('picker',$('import-button'),'original-direct-midi-boundary.mid');let completed=false;
    try{await until(()=>$('song-lobby').dataset.previewId?.startsWith('native:song-')&&!$('start-performance').disabled&&report.requests.some(row=>row.path==='/api/library/import/commit'&&row.observation==='consumed'),'automatic raw MIDI saved preview');completed=true;}finally{picker.endPicker(action,completed);}
    report.pickerAction=action;
   }else{
    assert(report.initialInventory.entries.length===1,'Restart requires one persisted source');const key=report.initialInventory.entries[0].key;
    await until(()=>document.querySelector(`#catalog [data-library-key="native:${key}"]`),'saved source catalog row');
    await click(document.querySelector(`#catalog [data-library-key="native:${key}"]`));
    await until(()=>$('song-lobby').dataset.previewId===`native:${key}`&&!$('start-performance').disabled,'saved MIDI preview after fresh-process restart');
   }
   report.inventory=await json('/api/library/list');assert(report.inventory.entries.length===1&&report.inventory.issues.length===0,'Only one complete source');report.key=report.inventory.entries[0].key;
   report.opened=await json('/api/library/load',{key:report.key});report.preview=preview();assert(report.preview.id===`native:${report.key}`&&!report.preview.bulkDialog,'Saved source must be automatically selected without bulk review');
   assert(!report.preview.clock.running,'Import or selection started playback');report.screenshots.preview=await click('preview-title');
   // Ordinary Start, with the default full source part. No Mod repair first.
   report.startAction=await click('start-performance');
   await until(()=>document.body.dataset.screen==='stage'&&$('session-mode').value==='practice'&&['playing','ended'].includes($('clean-song-stage').dataset.rendererState),'default Start entered actual complete-key practice');
   await until(()=>clock().completed&&$('clean-song-stage').dataset.rendererState==='ended'&&report.requests.some(row=>row.path==='/api/assess'&&row.observation==='consumed'),'all source targets completed with zero input');
   report.ended={screen:document.body.dataset.screen,mode:$('session-mode').value,renderer:$('clean-song-stage').dataset.rendererState,clock:clock(),captured:$('hud-captured').textContent};
   report.screenshots.ended=await click('stage-title');
   await click('results-button');await until(()=>!$('export-takes').disabled,'take available');await download($('export-takes'),'take');await click($('results-dialog').querySelector('[data-close-panel]'));
   await click('back-to-library');await click('import-tools-button');await click('bulk-import-history-button');
   if(!$('bulk-import-history').open)await click($('bulk-import-history').querySelector('summary'));
   await until(()=>document.querySelector('[data-import-archive]'),'retained original row');
   const archives=[...document.querySelectorAll('[data-import-archive]')];assert(archives.length===1,'Exactly one original archive expected');report.archiveKey=archives[0].dataset.importArchive;await download(archives[0],'raw');
   await until(()=>requests.settled(),'all observed request bodies consumed');assert(report.errors.length===0,report.errors.join('; '));report.ok=true;report.stage='complete';
  }catch(error){report.error=String(error.stack||error);report.failurePreview=preview();}
  finally{
   report.actions=sequence;report.pickerObservations=picker?.pickers||[];report.trusted=picker?.trusted||[];picker?.restore();report.requestsRestored=requests.restore();removeEventListener('error',failed);removeEventListener('unhandledrejection',failed);
   const bytes=new TextEncoder().encode(JSON.stringify(report)).length;
   await json('/__desktop_smoke/report',bytes<=1024*1024?report:{version:1,scenario:'direct-midi',phase,ok:false,error:'Complete direct MIDI evidence exceeds 1 MiB',receivedBytes:bytes});
  }
 },{once:true});
})();
