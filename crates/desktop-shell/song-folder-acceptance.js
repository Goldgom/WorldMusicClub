/* Process-owner Windows proof for disk archives. No app state setters, mocked
 * transport, injected picker files, or IDB replacement are used. */
function observeFolderAuditionResponses(fetcher,{onError}){
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
(() => {
  const phase=globalThis.__WMH_ACCEPTANCE_PHASE__,$=id=>document.getElementById(id);
  const assert=(value,message)=>{if(!value)throw Error(message);};
  const originalFetch=globalThis.fetch.bind(globalThis),waits=createAcceptanceWait(),until=waits.until;
  const json=(path,options)=>waits.json(originalFetch,path,options);
  const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
  const requests=[],saveResults=[],errors=[],openedScoreDatabases=[];let sequence=0;
  // Observe, forward unchanged, and fail if the app ever opens its browser score
  // database. Performance history may still legitimately use another database.
  const originalOpen=IDBFactory.prototype.open;
  IDBFactory.prototype.open=function(name,...args){if(String(name)==='worldmusichub.scores.v1')openedScoreDatabases.push(String(name));return originalOpen.call(this,name,...args);};
  globalThis.fetch=(...args)=>{
    const path=String(args[0]),result=originalFetch(...args);
    if(path.startsWith('/api/'))result.then(response=>response.clone().json().then(body=>{
      requests.push({path,status:response.status,body});
      if(path==='/api/library/save')saveResults.push({status:response.status,code:body.code||null,key:body.key||body.existing?.key||null,allowConflictingId:JSON.parse(args[1]?.body||'{}').allow_conflicting_id===true});
    }).catch(error=>errors.push(String(error)))).catch(error=>errors.push(String(error)));
    return result;
  };
  addEventListener('error',event=>errors.push(String(event.message)));
  addEventListener('unhandledrejection',event=>errors.push(String(event.reason)));
  const click=id=>{assert($(id)&&!$(id).disabled,`Unavailable control ${id}`);$(id).click();};
  const closeDialogs=()=>{for(const dialog of document.querySelectorAll('dialog[open]'))dialog.close();};
  const menu=createAcceptanceNavigation({document,until,click});
  const storage=()=>document.querySelector('[data-score-storage]');
  const status=()=>storage()?.querySelector('.score-storage-status');
  const storageAction=name=>storage()?.querySelector(`[data-storage-action="${name}"]`);
  async function native(kind,node,file){
    assert(node&&!node.disabled,'Native control unavailable');node.scrollIntoView({block:'center',inline:'center'});node.focus();await delay(150);
    const bounds=node.getBoundingClientRect();assert(bounds.width>0&&bounds.height>0,'Native target invisible');
    assert(sequence<75,'Dedicated folder process exceeded 75 native actions');
    const action={version:1,sequence:++sequence,kind,x:bounds.x+bounds.width/2,y:bounds.y+bounds.height/2,width:innerWidth,height:innerHeight,...(file?{file}:{})};
    await json('/__desktop_smoke/action',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(action)});
    let result;await until(async signal=>{const response=await originalFetch(`/__desktop_smoke/result/${sequence}`,{signal});if(response.status===404)return false;result=await response.json();assert(response.ok,result.error||'Native result failure');return true;},`folder native ${kind} ${sequence}`);
    assert(result.ok,result.error||'Native action failed');return sequence;
  }
  async function importFile(file,{cancel=false,malformed=false}={}){
    closeDialogs();click('import-tools-button');const before=saveResults.length,title=$('score-title').textContent;let event;
    const observed=value=>{event=value.type;};$('score-file').addEventListener('change',observed,{once:true,capture:true});$('score-file').addEventListener('cancel',observed,{once:true});
    try{
      await native(cancel?'cancel-picker':'picker',$('import-button'),cancel?undefined:file);await until(()=>event,'actual file chooser event');
      if(cancel){assert(event==='cancel','Chooser did not cancel');assert($('score-title').textContent===title,'Canceled import changed score');}
      else if(malformed){await until(()=>$('notice-message').textContent.includes(file),'malformed import notice');assert($('score-title').textContent===title,'Malformed import changed score');}
      else {await until(()=>saveResults.length===before+1&&storage()?.getAttribute('aria-busy')==='false','native save response and completed persistence UI');}
      if(cancel||malformed){assert(saveResults.length===before,'Canceled or malformed import attempted a save');}
    }finally{$('score-file').removeEventListener('change',observed,true);$('score-file').removeEventListener('cancel',observed);closeDialogs();}
  }
  async function inventory(){const result=await json('/api/library/list');assert(result.storage==='native-filesystem'&&result.issues.length===0,'Native inventory missing or corrupt');return result;}
  async function download(id){const before=(await json('/__desktop_smoke/state')).downloads.length;await native('click',$(id));let row;await until(async()=>{row=(await json('/__desktop_smoke/state')).downloads[before];return row?.complete;},`folder ${id} download`);assert(row.success,'Native download failed');return row.file;}
  async function exportScore(){closeDialogs();click('score-tools-button');const file=await download('export-button');closeDialogs();return file;}
  async function exportTake(){closeDialogs();click('results-button');const file=await download('export-takes');closeDialogs();return file;}
  async function selectSaved(entry){
    const key=`native:${entry.key}`;await until(()=>$('catalog').querySelector(`[data-library-key="${key}"]`),'saved row listed');
    await native('click',$('catalog').querySelector(`[data-library-key="${key}"]`));
    await until(()=>$('song-lobby').dataset.previewId===key&&$('song-lobby').dataset.previewStatus==='ready'&&!$('configure-song-mod').disabled,'saved row Rust preview ready');
  }
  addEventListener('DOMContentLoaded',async()=>{
    const report={version:1,phase,ok:false,origin:location.origin,checks:[],saveResults,openedScoreDatabases,errors};
    try{
      assert(localStorage.getItem('wmh.folder.acceptance.marker')===null,'Folder scenario requires a fresh WebView profile');
      report.profileMarkerAbsent=true;localStorage.setItem('wmh.folder.acceptance.marker',phase);
      await menu.enterLibrary();
      const {getAppI18n}=await import('/app-locale.js');getAppI18n(document).setLocale('en');
      assert((await json('/api/health')).network==='native-protocol-no-listener','Not native protocol');
      if(phase==='folder-seed'){
        assert((await inventory()).entries.length===0,'Folder acceptance needs empty isolated Scores');
        await importFile('folder-original.json');assert(saveResults[0].status===200&&status().dataset.persistence==='saved','Import was not saved to disk');
        report.checks.push('actual-picker-import-await-save');
        await importFile('folder-original.json');assert(saveResults[1].code==='library_duplicate','Repeat import did not detect duplicate');
        await importFile('folder-conflict.json');assert(saveResults[2].code==='library_id_conflict'&&status().dataset.persistence==='not-saved','Changed edition silently overwrote same ID');
        click('settings-button');await native('click',storageAction('keepBoth'));
        await until(()=>saveResults.length===4&&storage().getAttribute('aria-busy')==='false','explicit Keep both committed');closeDialogs();
        assert(saveResults[3].status===200&&saveResults[3].allowConflictingId,'Keep both did not create edition');
        report.checks.push('disk-save-duplicate-id-conflict-keep-both');
        const before=JSON.stringify((await inventory()).entries);
        await importFile(undefined,{cancel:true});await importFile('malformed.json',{malformed:true});
        assert(JSON.stringify((await inventory()).entries)===before,'Interrupted import changed disk inventory');
        report.checks.push('canceled-malformed-no-write');
        const current=await inventory();report.inventory=current.entries;report.directory=current.directory;
        assert(report.inventory.length===2,'Expected two distinct disk editions');
      }else if(phase==='folder-restart'){
        const current=await inventory();report.inventory=current.entries;report.directory=current.directory;
        assert(current.entries.length===2,'Clean-profile EXE restart did not recover two disk entries');
        report.checks.push('clean-profile-disk-reload');
        const entry=current.entries.find(row=>row.title==='Folder acceptance original');assert(entry,'Original edition missing');
        const {CanonicalAudioReceiver}=await import('/canonical-audio-receiver.js'),receiver=await observeBasicKeyReceiver(document,{Receiver:CanonicalAudioReceiver,readStartFrame:n=>n[1],readEndFrame:n=>n[2]});
        const audition=report.audition={version:1,trusted:[]},button=$('lobby-preview-play');
        const previousFetch=globalThis.fetch,responses=observeFolderAuditionResponses(previousFetch,{onError:error=>errors.push(error)});globalThis.fetch=responses.fetch;audition.responses=responses.rows;
        const snapshot=()=>({screen:document.body.dataset.screen,previewId:$('song-lobby').dataset.previewId,status:$('lobby-preview-status').dataset.state,positionMs:Number($('lobby-preview-progress').value),durationMs:Number($('lobby-preview-progress').max),captured:$('hud-captured').textContent,grades:Object.fromEntries(['hud-accuracy','accuracy','hits','misses','timing'].map(id=>[id,$(id)?.textContent||''])),assessments:responses.assessmentRequests()});
        const trusted=event=>{assert(audition.trusted.length<2,'Audition pointer bound');audition.trusted.push({type:event.type,id:event.currentTarget.id,trusted:event.isTrusted===true,actionSequence:sequence});};button.addEventListener('click',trusted,true);
        const compact=record=>{const value=structuredClone(record);if(value.ledgerLayout==='range-pass-major'){value.ledgerCapacity=value.ledger.actualStarts.length;value.unusedLedgerSentinel=0;value.unusedLedgerEmpty=value.ledger.actualStarts.slice(value.recordCount).every(frame=>frame===0)&&value.ledger.actualEnds.slice(value.recordCount).every(frame=>frame===0);value.ledger.actualStarts=value.ledger.actualStarts.slice(0,value.recordCount);value.ledger.actualEnds=value.ledger.actualEnds.slice(0,value.recordCount);value.passFrames=Array.from(value.passFrames||[]).slice(0,value.passCount);}value.pauseSpans=Array.from(value.pauseSpans||[]);return value;};
        let auditionFailure;
        try{
          await selectSaved(entry);
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
        await createAcceptanceSongMod({document,native,until}).start('none');await menu.waitScreen('stage','play-button','saved score activated');
        assert($('score-title').textContent===entry.title,'Wrong saved score activated');report.checks.push('saved-row-select-audition-activate');
        report.transportAdmission=await prepareNativeReferenceScoredTake({document,native,click,closeDialogs,until});
        report.files={beforeScore:await exportScore(),beforeTake:await exportTake()};
        await menu.returnToLibrary();await selectSaved(current.entries.find(row=>row.key!==entry.key));
        await menu.enterFree();await menu.exitFree();click('lobby-home');await menu.waitScreen('home','home-single-player','returned home');click('home-single-player');
        await menu.waitScreen('library','resume-session','retained session available');click('resume-session');await menu.waitScreen('stage','play-button','retained stage resumed');
        report.files.afterScore=await exportScore();report.files.afterTake=await exportTake();
        assert(saveResults.length===0,'Selecting, auditioning or navigating saved scores created disk copies');
        report.checks.push('menu-free-library-preserves-score-take');
      }else if(phase==='folder-failure'){
        await importFile('folder-original.json');
        assert(saveResults.length===1&&saveResults[0].status>=400,'Isolated blocked storage unexpectedly saved');
        report.persistence=status().dataset.persistence;assert(report.persistence==='not-saved','Failed write claimed saved or silently fell back');
        assert($('score-title').textContent==='Folder acceptance original'&&!$('export-button').disabled,'Failed save discarded the usable imported score');
        assert(!storageAction('retry').hidden,'Failed save needs a visible retry action');
        report.checks.push('failed-native-save-no-browser-fallback');
      }else throw Error('Unknown folder scenario');
      assert(openedScoreDatabases.length===0,'Native song workflow opened fallback IndexedDB');
      assert(errors.length===0,errors.join('; '));report.actions=sequence;report.downloads=(await json('/__desktop_smoke/state')).downloads;report.ok=true;
    }catch(error){report.error=String(error);if(error.nativeReferenceTransport)report.transportAdmission=error.nativeReferenceTransport;}
    assert(new TextEncoder().encode(JSON.stringify(report)).length<=64*1024,'Folder report exceeds its 64 KiB evidence envelope');
    await json('/__desktop_smoke/report',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(report)});
  },{once:true});
})();
