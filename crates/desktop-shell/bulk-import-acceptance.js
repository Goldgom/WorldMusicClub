/* Bulk evidence is lossless within the same finite bound as its verifier. */
const BULK_ACCEPTANCE_REPORT_BYTES=4*1024*1024;
async function postBulkAcceptanceReport({report,fetcher,waits}) {
 const sequence=Number.isInteger(report.actions)&&report.actions>=0&&report.actions<=75?report.actions:0;
 const progress=stage=>waits.json(fetcher,'/__desktop_smoke/progress',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({version:1,stage,sequence})},2000).catch(()=>{});
 let bytes=null;
 try {
  const body=JSON.stringify(report);bytes=new TextEncoder().encode(body).length;
  if(bytes>BULK_ACCEPTANCE_REPORT_BYTES)throw Error('Complete bulk report exceeds its finite evidence limit');
  await progress('renderer-report-posting');
  await waits.json(fetcher,'/__desktop_smoke/report',{method:'POST',headers:{'Content-Type':'application/json'},body},10000);
  await progress('renderer-report-sent');return {delivered:true,bytes};
 } catch(error) {
  const failure={version:1,phase:report.phase,ok:false,error:'Complete bulk acceptance report could not be delivered',report_failure:{code:'bulk_report_delivery_failed',received_bytes:bytes,limit_bytes:BULK_ACCEPTANCE_REPORT_BYTES,detail:String(error).slice(0,512)}};
  let failureDelivered=false;
  try{await waits.json(fetcher,'/__desktop_smoke/report',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(failure)},10000);failureDelivered=true}catch{/* The independently persisted host/progress trace also fails the run. */}
  await progress('renderer-report-failed');return {delivered:false,failureDelivered,bytes};
 }
}

/* Observe only trusted chooser-induced blur dispatches; never generate input. */
function createBulkChooserObserver({target,now=()=>performance.now(),defer=callback=>setTimeout(callback,0)}) {
 const records=[],pending=new WeakMap();let active=null;
 // A queued task runs after all synchronous native blur handlers. Microtasks
 // may checkpoint between listeners, so they cannot bound the whole dispatch.
 const observe=event=>{if(!active||event.target!==target)return;const row={trusted:event.isTrusted===true,started_wall_ms:now(),finished_wall_ms:null};active.blurs.push(row);pending.get(active).push(new Promise(resolve=>defer(()=>{row.finished_wall_ms=now();resolve()})))};
 target.addEventListener('blur',observe,true);
 return {records,begin(sequence,kind){if(active)throw Error('Overlapping native chooser observations');active={sequence,kind,started_wall_ms:now(),finished_wall_ms:null,completed:false,blurs:[]};records.push(active);pending.set(active,[])},async end(sequence,completed){if(!active||active.sequence!==sequence)throw Error('Native chooser observation ownership changed');const record=active;active=null;await Promise.all(pending.get(record));record.finished_wall_ms=now();record.completed=completed},stop(){target.removeEventListener('blur',observe,true)}};
}

function observeBulkAuditionResponses(fetcher,{onError}){
  const rows=[],restores=new Set();let active=true,assessmentRequests=0;
  const observe=function(...args){
    const promise=Reflect.apply(fetcher,this,args),path=String(args[0]);
    if(path==='/api/assess')assessmentRequests++;
    if(!['/api/compile','/api/canonical-audio-profile'].includes(path))return promise;
    if(rows.length>=4){onError('Audition response observation bound');return promise;}
    const row={path,status:null,state:'fetching'};rows.push(row);
    promise.then(response=>{
      if(!active)return;row.status=response.status;row.state='awaiting-consumption';
      const original=response.json,descriptor=Object.getOwnPropertyDescriptor(response,'json');
      const restore=()=>{if(response.json===json){if(descriptor)Object.defineProperty(response,'json',descriptor);else delete response.json;}restores.delete(restore);};
      function json(...values){const result=Reflect.apply(original,this,values);if(this===response)result.then(body=>{if(active){row.body=structuredClone(body);row.state='consumed';}restore();},error=>{if(active){row.state='rejected';onError(String(error));}restore();});return result;}
      response.json=json;restores.add(restore);
    },error=>{if(active){row.state='rejected';onError(String(error));}});
    return promise;
  };
  return{fetch:observe,rows,assessmentRequests:()=>assessmentRequests,restore(){active=false;for(const restore of [...restores])restore();}};
}

/* Real Windows chooser + native protocol + isolated filesystem proof. No
 * injected FileList, replaced persistence, or app-state setters are used. */
(() => {
 const phase=globalThis.__WMH_ACCEPTANCE_PHASE__,$=id=>document.getElementById(id),assert=(value,message)=>{if(!value)throw Error(message)};
 const originalFetch=globalThis.fetch.bind(globalThis),waits=createAcceptanceWait(),until=waits.until,json=(path,options)=>waits.json(originalFetch,path,options),delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
 const importReports=[],openedScoreDatabases=[],errors=[],screenshots={},chooserObserver=createBulkChooserObserver({target:globalThis});let sequence=0;
 const open=IDBFactory.prototype.open;IDBFactory.prototype.open=function(name,...args){if(String(name)==='worldmusichub.scores.v1')openedScoreDatabases.push(String(name));return open.call(this,name,...args)};
 globalThis.fetch=(...args)=>{
  const path=String(args[0]),promise=originalFetch(...args);
  if(['/api/library/import/preview','/api/library/import/commit'].includes(path))promise.then(response=>response.clone().json().then(body=>{const headers=args[1]?.headers||{};importReports.push({status:response.status,filename:decodeURIComponent(headers['x-wmh-filename']||''),mode:path.endsWith('preview')?'preview':'commit',index:headers['x-wmh-item-index']===undefined?null:Number(headers['x-wmh-item-index']),keepBoth:headers['x-wmh-conflict']==='keep-both',body})}).catch(error=>errors.push(String(error)))).catch(()=>{});
  return promise;
 };
 addEventListener('error',event=>errors.push(String(event.message)));addEventListener('unhandledrejection',event=>errors.push(String(event.reason)));
 const click=id=>{assert($(id)&&!$(id).disabled,`Unavailable control ${id}`);$(id).click()},closeDialogs=()=>{for(const dialog of document.querySelectorAll('dialog[open]'))dialog.close()},menu=createAcceptanceNavigation({document,until,click});
 async function native(kind,node,file){
  assert(node&&!node.disabled,'Native bulk control unavailable');node.scrollIntoView({block:'center',inline:'center'});node.focus();await delay(150);const bounds=node.getBoundingClientRect();assert(bounds.width>0&&bounds.height>0,'Native bulk target invisible');assert(sequence<75,'Bulk phase exceeded native action bound');
  const action={version:1,sequence:++sequence,kind,x:bounds.x+bounds.width/2,y:bounds.y+bounds.height/2,width:innerWidth,height:innerHeight,...(file?{file}:{})};
  const chooser=['picker','cancel-picker'].includes(kind);let completed=false;if(chooser)chooserObserver.begin(sequence,kind);
  const pickerObservation=phase==='bulk-seed'&&chooser?createNativePickerObservation({document,fetcher:originalFetch,sequence,node}):null;
  try{await json('/__desktop_smoke/action',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(action)});let result;await until(async signal=>{const response=await originalFetch(`/__desktop_smoke/result/${sequence}`,{signal});if(response.status===404)return false;result=await response.json();assert(response.ok,result.error||'Native bulk action failed');return true},`native bulk ${kind} ${sequence}`);assert(result.ok,result.error||'Native bulk action failed');completed=true;return sequence}finally{pickerObservation?.stop();if(chooser)await chooserObserver.end(sequence,completed)}
 }
 const inventory=()=>json('/api/library/list'),reviewReady=()=>$('bulk-import-dialog')?.open&&$('bulk-import-dialog').dataset.phase==='review';
 const rows=()=>[...document.querySelectorAll('#bulk-import-groups .bulk-import-song')],count=status=>rows().filter(row=>row.dataset.status===status).length;
 async function choose(file,{failed=false,cancel=false}={}){
  closeDialogs();click('import-tools-button');let event;const observed=value=>{event=value.type},before=importReports.length;
  $('score-file').addEventListener('change',observed,{once:true,capture:true});$('score-file').addEventListener('cancel',observed,{once:true});
  try{await native(cancel?'cancel-picker':'picker',$('import-button'),cancel?undefined:file);await until(()=>event,'real bulk file chooser event');if(cancel){assert(event==='cancel'&&importReports.length===before,'Canceled chooser imported a file');return}await until(()=>reviewReady()&&importReports.length>before,'native bulk preflight result');assert(importReports.at(-1).mode==='preview','Selected pack did not use preflight');if(failed)assert(document.querySelector('[data-import-file][data-phase="failed"]'),'Malformed pack lacks failed result');else assert(rows().length>0,'No per-song import report')}
  finally{$('score-file').removeEventListener('change',observed,true);$('score-file').removeEventListener('cancel',observed)}
 }
 async function save(){const before=importReports.length;await native('click',$('bulk-import-save'));await until(()=>reviewReady()&&importReports.length>before&&importReports.at(-1).mode==='commit','atomic native batch save complete')}
 async function downloadNode(node){const before=(await json('/__desktop_smoke/state')).downloads.length;await native('click',node);let row;await until(async()=>{row=(await json('/__desktop_smoke/state')).downloads[before];return row?.complete},'native complete pack download');assert(row.success,'Native pack download failed');return row.file}
 async function exportSession(id,menuButton){closeDialogs();click(menuButton);const file=await downloadNode($(id));closeDialogs();return file}
 async function history(){closeDialogs();click('import-tools-button');click('bulk-import-history-button');$('bulk-import-history').open=true;await until(()=>document.querySelector('[data-import-archive]'),'retained original visible');return[...document.querySelectorAll('#bulk-import-history-list li')].find(row=>row.querySelector(':scope > span')?.textContent==='原创曲包_日本語.zip')?.querySelector('[data-import-archive]')}
 const stableSession=()=>({title:$('score-title').textContent,stage:$('stage-title').textContent,pass:document.querySelector('.performance-status')?.dataset.passId,revision:document.querySelector('.performance-status')?.dataset.revision,captured:$('hud-captured').textContent,position:globalThis.__wmhReadPlaybackClock(document).positionMs});
 addEventListener('DOMContentLoaded',async()=>{
  const report={version:1,phase,ok:false,origin:location.origin,checks:[],importReports,openedScoreDatabases,errors,screenshots,chooserObservations:chooserObserver.records,files:{}};
  try{await prepareNativePlaybackClock({document,until});
   assert(localStorage.getItem('wmh.bulk.acceptance.marker')===null,'Bulk scenario requires a fresh WebView profile');report.profileMarkerAbsent=true;localStorage.setItem('wmh.bulk.acceptance.marker',phase);
   await menu.enterLibrary();const {getAppI18n}=await import('/app-locale.js');getAppI18n(document).setLocale('en');assert((await json('/api/health')).network==='native-protocol-no-listener','Bulk proof requires native protocol');
   if(phase==='bulk-seed'){
    assert((await inventory()).entries.length===0,'Bulk seed requires empty isolated Scores');await createAcceptanceSongMod({document,native,until}).start('none');await menu.waitScreen('stage','play-button','initial score active');report.transportAdmission=await prepareNativeReferenceScoredTake({document,native,click,closeDialogs,until});
    report.files.beforeScore=await exportSession('export-button','score-tools-button');report.files.beforeTake=await exportSession('export-takes','results-button');const before=JSON.stringify(stableSession());await menu.returnToLibrary();
    await choose('原创曲包_日本語.zip');assert(count('ready')===2&&count('retained_nonplayable')===1,'Legacy pack preflight classification is wrong');assert((await inventory()).entries.length===0,'Preflight wrote songs');screenshots.preflight=await native('click',$('bulk-import-title'));report.checks.push('actual-picker-legacy-pack-preflight');
    await save();assert(count('saved')===2&&count('retained_nonplayable')===1,'Playable and retained-only results were mixed');assert(rows().find(row=>row.dataset.status==='retained_nonplayable').querySelector('[data-import-browse]').hidden,'Unsupported events can be selected as a score');screenshots.saved=await native('click',$('bulk-import-title'));report.checks.push('saved-playable-retained-nonplayable');
    await choose('原创曲包_日本語.zip');await save();assert(count('duplicate')===2&&(await inventory()).entries.length===2,'Duplicate ZIP created extra songs');await choose('bulk-backup.json');await save();assert(count('duplicate')===2&&(await inventory()).entries.length===2,'Legacy backup created extra songs');await choose('bulk-multiple');assert(document.querySelectorAll('[data-import-file]').length===2,'Windows chooser did not return multiple files');await save();assert(count('duplicate')===2&&(await inventory()).entries.length===2,'Multiple-file chooser duplicated songs');report.checks.push('duplicate-and-backup-no-new-songs');
    await choose('bulk-conflict.zip');assert(count('conflict')===1,'Changed edition did not expose ID conflict');await save();assert(count('conflict')===1&&(await inventory()).entries.length===2,'Default policy silently saved conflicting edition');const attempts=importReports.length;await native('click',document.querySelector('[data-import-keep-both]:not([hidden])'));await until(()=>reviewReady()&&importReports.length>attempts&&count('saved')===1,'explicit per-song Keep both');assert((await inventory()).entries.length===3,'Explicit edition was not saved');report.checks.push('explicit-id-conflict-keep-both');
    const original=await history();assert(original,'Legacy original history row missing');report.files.original=await downloadNode(original);await native('click',$('bulk-import-export-all'));report.files.unified=await downloadNode($('bulk-import-export-pack'));
    await choose(report.files.unified);await save();assert(count('duplicate')===3&&(await inventory()).entries.length===3,'Unified exported pack failed duplicate round trip');report.checks.push('original-export-unified-pack-roundtrip');
    const stable=JSON.stringify((await inventory()).entries);await choose(undefined,{cancel:true});await choose('bulk-malformed.zip',{failed:true});assert(!document.querySelector('[data-import-retry]').hidden,'Malformed archive has no retry action');assert(JSON.stringify((await inventory()).entries)===stable,'Canceled or malformed pack changed inventory');report.checks.push('cancelled-malformed-no-write');
    closeDialogs();assert(JSON.stringify(stableSession())===before,'Batch imports changed active source or take');report.files.afterScore=await exportSession('export-button','score-tools-button');report.files.afterTake=await exportSession('export-takes','results-button');report.checks.push('active-score-take-preserved');
    const saved=await inventory();report.inventory=saved.entries;report.directory=saved.directory;await history();screenshots.history=await native('click',$('bulk-import-title'));
   }else if(phase==='bulk-restart'){
    const saved=await inventory();report.inventory=saved.entries;report.directory=saved.directory;assert(saved.entries.length===3,'Fresh profile lost native songs');report.checks.push('fresh-profile-native-inventory');
    const entry=saved.entries.find(row=>row.title==='原创批量练习一'),key=`native:${entry?.key}`;assert(entry,'Authored original missing');
    const {CanonicalAudioReceiver}=await import('/canonical-audio-receiver.js'),receiver=await observeBasicKeyReceiver(document,{Receiver:CanonicalAudioReceiver,readStartFrame:n=>n[1],readEndFrame:n=>n[2]});
    const audition=report.audition={version:1,trusted:[]},button=$('lobby-preview-play');
    const previousFetch=globalThis.fetch,responses=observeBulkAuditionResponses(previousFetch,{onError:error=>errors.push(error)});globalThis.fetch=responses.fetch;audition.responses=responses.rows;
    const snapshot=()=>({screen:document.body.dataset.screen,previewId:$('song-lobby').dataset.previewId,status:$('lobby-preview-status').dataset.state,positionMs:Number($('lobby-preview-progress').value),durationMs:Number($('lobby-preview-progress').max),captured:$('hud-captured').textContent,grades:Object.fromEntries(['hud-accuracy','accuracy','hits','misses','timing'].map(id=>[id,$(id)?.textContent||''])),assessments:responses.assessmentRequests()});
    const trusted=event=>{assert(audition.trusted.length<2,'Audition pointer bound');audition.trusted.push({type:event.type,id:event.currentTarget.id,trusted:event.isTrusted===true,actionSequence:sequence});};button.addEventListener('click',trusted,true);
    const compact=record=>{const value=structuredClone(record);if(value.ledgerLayout==='range-pass-major'){value.ledgerCapacity=value.ledger.actualStarts.length;value.unusedLedgerSentinel=0;value.unusedLedgerEmpty=value.ledger.actualStarts.slice(value.recordCount).every(frame=>frame===0)&&value.ledger.actualEnds.slice(value.recordCount).every(frame=>frame===0);value.ledger.actualStarts=value.ledger.actualStarts.slice(0,value.recordCount);value.ledger.actualEnds=value.ledger.actualEnds.slice(0,value.recordCount);value.passFrames=Array.from(value.passFrames||[]).slice(0,value.passCount);}value.pauseSpans=Array.from(value.pauseSpans||[]);return value;};
    let auditionFailure;
    try{
      await until(()=>$('catalog').querySelector(`[data-library-key="${key}"]`),'saved row listed');
      await native('click',$('catalog').querySelector(`[data-library-key="${key}"]`));
      await until(()=>$('song-lobby').dataset.previewId===key&&$('song-lobby').dataset.previewStatus==='ready'&&!$('lobby-preview-play').disabled,'saved canonical preview ready');
      audition.before=snapshot();audition.playAction=sequence+1;await native('click',button);
      await until(()=>{receiver.assertHealthy();const run=receiver.snapshot()[0],state=receiver.status();return $('lobby-preview-status').dataset.state==='playing'&&Number($('lobby-preview-progress').value)>250&&state.started===1&&state.activeReceivers===1&&state.pendingReceivers===0&&run?.pcm.blocks.some(block=>block.audioTime>=run.started.anchorTime&&block.peak>1e-6&&block.rms>1e-8);},'saved canonical audition actual PCM and advancing source clock');
      audition.playing=snapshot();audition.playingAudio=receiver.status();audition.stopAction=sequence+1;await native('click',button);
      await until(()=>{receiver.assertHealthy();return $('lobby-preview-status').dataset.state==='stopped'&&receiver.settledSince(0)&&receiver.quiet();},'saved canonical audition canceled frame ledger and disconnected receiver');audition.stopped=snapshot();
      await until(()=>responses.rows.some(row=>row.path==='/api/compile'&&row.state==='consumed'&&row.status===200&&row.body.score?.id===entry.score_id&&row.body.score?.title===entry.title)&&responses.rows.some(row=>row.path==='/api/canonical-audio-profile'&&row.state==='consumed'&&row.status===200&&row.body.source_fingerprint===receiver.snapshot()[0].plan.sourceFingerprint),'consumed saved-score compilation and audio profile');
      audition.compilation=responses.rows.find(row=>row.path==='/api/compile'&&row.state==='consumed').body;
      audition.profile=responses.rows.find(row=>row.path==='/api/canonical-audio-profile'&&row.state==='consumed').body;
      assert(audition.stopped.captured===audition.before.captured&&JSON.stringify(audition.stopped.grades)===JSON.stringify(audition.before.grades)&&audition.stopped.assessments===audition.before.assessments,'Lobby audition changed scored input or results');
    }catch(error){auditionFailure=error;audition.error=String(error);}finally{
      button.removeEventListener('click',trusted,true);
      responses.restore();if(globalThis.fetch===responses.fetch)globalThis.fetch=previousFetch;audition.fetchRestored=globalThis.fetch===previousFetch;
      try{audition.audio=receiver.snapshot().map(row=>({...row,terminals:row.terminals.map(terminal=>({...terminal,record:compact(terminal.record)})),rawTerminals:row.rawTerminals.map(terminal=>({...terminal,record:compact(terminal.record)}))}));audition.finalAudio=receiver.status();}catch(error){audition.observationError=String(error);auditionFailure??=error;}
      try{audition.cleanup=receiver.restore();assert(audition.cleanup.restored&&!audition.cleanup.errors.length&&!audition.cleanup.cleanupErrors.length&&!audition.cleanup.overflow,'Audition observer cleanup failed');}catch(error){audition.cleanupError=String(error);auditionFailure??=error;}
    }
    if(auditionFailure)throw auditionFailure;
    report.checks.push('saved-song-preview-audition');
    const original=await history();assert(original,'Original ZIP missing after restart');report.files.original=await downloadNode(original);report.history=await json('/api/library/imports');assert(report.history.imports.some(row=>row.filename==='原创曲包_日本語.zip'&&row.report?.items.some(item=>item.status==='retained_nonplayable'&&!item.playable)),'Retained unsupported events disappeared after restart');report.checks.push('retained-originals-after-restart');screenshots.history=await native('click',$('bulk-import-title'));
   }else if(phase==='bulk-failure'){
    report.directory=(await inventory()).directory;await choose('bulk-failure.zip');await save();const group=document.querySelector('[data-import-file]');assert(['failed','uncertain'].includes(group.dataset.phase),'Blocked write claimed success');report.failure={filename:'bulk-failure.zip',phase:group.dataset.phase,code:importReports.at(-1).body.code,persistence:group.dataset.phase==='uncertain'?'unknown':'not-saved',retryVisible:!group.querySelector('[data-import-retry]').hidden,message:group.textContent};assert(report.failure.retryVisible&&count('saved')===0,'Blocked import has no actionable unsaved result');report.checks.push('blocked-native-import-actionable-no-fallback');screenshots.failure=await native('click',$('bulk-import-title'));
   }else throw Error('Unknown native bulk phase');
   assert(openedScoreDatabases.length===0,'Bulk import opened fallback browser score storage');assert(errors.length===0,errors.join('; '));report.actions=sequence;report.downloads=(await json('/__desktop_smoke/state')).downloads;report.ok=true;
  }catch(error){report.error=String(error);if(error.nativeReferenceTransport)report.transportAdmission=error.nativeReferenceTransport}
  chooserObserver.stop();await postBulkAcceptanceReport({report,fetcher:originalFetch,waits});
 },{once:true});
})();
