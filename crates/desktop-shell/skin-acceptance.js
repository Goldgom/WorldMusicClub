/* Native Settings persistence only. The host owns every pointer/key/file action.
 * No injected storage writes, source replacements, transport calls or audio claims. */
function nativeSkinSettings(document){
  const $=id=>document.getElementById(id);
  return{selected:$('skin-settings').dataset.selected,choice:$('skin-choice').value,active:document.documentElement.dataset.skin??null,
    importedDisabled:Boolean($('skin-choice').querySelector('[value="imported"]').disabled),busy:$('skin-settings').getAttribute('aria-busy'),
    theme:globalThis.localStorage.getItem('worldmusichub.theme'),status:$('skin-status').textContent};
}
async function readNativeSkinRecord(factory=globalThis.indexedDB){
  // Read the committed production record. Never create a replacement database.
  return new Promise((resolve,reject)=>{
    const request=factory.open('worldmusicclub.skins.v1',1);let failed=false;
    request.onupgradeneeded=()=>{failed=true;request.transaction.abort();reject(Error('Skin database was absent after Settings became ready'));};
    request.onerror=()=>reject(request.error);
    request.onsuccess=()=>{
      const db=request.result;if(failed){db.close();return;}
      let tx,read;try{tx=db.transaction('settings','readonly');read=tx.objectStore('settings').get('choice');}catch(error){db.close();reject(error);return;}
      tx.onabort=()=>{db.close();reject(tx.error||Error('Skin read aborted'));};
      tx.oncomplete=()=>{db.close();const value=read.result;resolve(value?{...value,resources:value.resources.map(([path,bytes])=>[path,Array.from(bytes)])}:null);};
    };
  });
}
// A native input[type=file] is already the public trigger. Unlike score import,
// there is no hidden delegated click. Record actual owned input/change events.
function observeNativeSkinPicker(document,node,sequence,filename){
  const events=[],types=['pointerdown','pointerup','click','input','change'];let overflow=false;
  const observe=event=>{
    if(event.target!==node)return;
    if(events.length===8){overflow=true;return;}
    events.push({type:event.type,trusted:event.isTrusted===true,sequence,id:node.id,tag:node.tagName,typeAttribute:node.type,
      disabled:Boolean(node.disabled),connected:Boolean(node.isConnected),multiple:Boolean(node.multiple),
      dialog:node.closest('dialog')?.id??null,modal:Boolean(node.closest('dialog')?.matches(':modal')),
      filename:['input','change'].includes(event.type)?node.files?.[0]?.name??null:null,
      fileCount:['input','change'].includes(event.type)?node.files?.length??null:null});
  };
  for(const type of types)document.addEventListener(type,observe,true);
  return{row:{sequence,id:node.id,filename,events},finish(){for(const type of types)document.removeEventListener(type,observe,true);if(overflow)throw Error('Skin picker event bound');}};
}
// Export panels are siblings of Settings. Close the actual modal before opening
// either panel, and reopen it only after their trusted close controls complete.
async function driveNativeSkinRound({phase,document,native,until,readStored=readNativeSkinRecord,readSettings=()=>nativeSkinSettings(document),boundary,download,settle}){
  const $=id=>document.getElementById(id),click=id=>native('click',typeof id==='string'?$(id):id);
  const idle=()=>until(()=>$('skin-settings').getAttribute('aria-busy')==='false','skin transaction committed');
  const close=async()=>{if($('settings-dialog').open)await click($('settings-dialog').querySelector('[data-close-panel]'));};
  const open=async()=>{if(!$('settings-dialog').open)await click('settings-button');await idle();};
  if(!['skin-seed','skin-restart','skin-default-restart'].includes(phase))throw Error('Unknown native skin phase');
  await close();const files={scoreBefore:await download('score'),takeBefore:await download('take')};await settle();const before=boundary();
  await open();const initial=readSettings(),storedInitial=await readStored();
  if(phase==='skin-seed'){
    await native('picker',$('skin-manifest'),'skin-original.json');await native('picker',$('skin-image'),'checker.png');
    await click('skin-import');await idle();
    // Import selects its committed slot. Exercise the explicit public Use action.
    await click('skin-use');await idle();
  }else if(phase==='skin-restart'){await click('skin-reset');await idle();}
  const final=readSettings(),storedFinal=await readStored();
  await close();await settle();const after=boundary();files.scoreAfter=await download('score');files.takeAfter=await download('take');
  await open();return{initial,storedInitial,final,storedFinal,before,after,files};
}
(() => {
  const phase=globalThis.__WMH_ACCEPTANCE_PHASE__,$=id=>document.getElementById(id),waits=createAcceptanceWait(),fetcher=globalThis.fetch.bind(globalThis),originalFetch=globalThis.fetch;
  const report={version:1,phase,origin:location.origin,ok:false,stage:'bootstrap',originalFixturesOnly:true,physicalAudio:false,errors:[],requests:[],trusted:[],controlActions:[],skinPickers:[]};
  const assert=(value,message)=>{if(!value)throw Error(message);},until=(predicate,label)=>waits.until(predicate,`${phase}: ${label}`,15000),frame=()=>new Promise(requestAnimationFrame);
  const json=(path,body)=>waits.json(fetcher,path,body===undefined?undefined:{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)},10000);
  let sequence=0,scoreControls,activePicker=null,restored=false;
  function observedFetch(...args){const result=Reflect.apply(originalFetch,this,args),path=String(args[0]);if(path.startsWith('/api/')){assert(report.requests.length<128,'Skin request bound');report.requests.push({path,sequence});}return result;}globalThis.fetch=observedFetch;
  const observe=event=>{if(!['click','input','change','keydown','keyup'].includes(event.type)||event.target?.id==='score-file'||event.target?.tagName==='A')return;assert(report.trusted.length<192,'Skin event bound');report.trusted.push({sequence,id:event.target?.id||null,type:event.type,trusted:event.isTrusted===true,code:event.code||null,eventTime:event.timeStamp,repeat:Boolean(event.repeat)});};
  async function native(kind,node,file){
    assert(node,'Native skin target missing');await waitCanonicalPracticeControl({document,node,until,readClock:()=>__wmhReadPlaybackClock(document)});
    node.scrollIntoView({block:'center',inline:'center'});node.focus();await frame();await frame();
    const row={sequence:sequence+1,id:node.id||null,kind,samples:[]};await prepareCanonicalPracticeTarget({document,node,onSample:value=>row.samples.push(value)});
    const b=node.getBoundingClientRect(),request={version:1,sequence:++sequence,kind,x:b.x+b.width/2,y:b.y+b.height/2,width:innerWidth,height:innerHeight,...(file?{file}:{})};
    assert(sequence<=64,'Skin native action bound');row.request=request;row.disabled=Boolean(node.disabled);report.controlActions.push(row);
    const clicks=observeCanonicalPracticeOwnedClick({document,node,sequence});row.clicks=clicks.events;
    const skinPicker=kind==='picker'&&['skin-manifest','skin-image'].includes(node.id)?observeNativeSkinPicker(document,node,sequence,file):null;
    if(skinPicker)report.skinPickers.push(skinPicker.row);
    if(kind==='picker'&&node.id==='import-button'){scoreControls.beginPicker(sequence,file);activePicker=sequence;}
    try{
      await json('/__desktop_smoke/action',request);let result;await until(async()=>{const response=await fetcher(`/__desktop_smoke/result/${sequence}`);if(response.status===404)return false;result=await response.json();return true;},'owned native action');assert(result.ok,result.error);
      await requireCanonicalPracticeOwnedClick({until,events:clicks.events,sequence,id:node.id,kind});
      if(skinPicker)await until(()=>skinPicker.row.events.filter(e=>e.type==='change').length===1,'owned skin file change');
    }finally{clicks.restore();skinPicker?.finish();}
    return sequence;
  }
  const click=id=>native('click',typeof id==='string'?$(id):id),mod=createAcceptanceSongMod({document,native,until});
  async function download(kind){
    assert(!document.querySelector('dialog[open]'),'Download requires closed Settings and sibling panels');
    const score=kind==='score',dialog=score?'score-tools-dialog':'results-dialog',button=score?'export-button':'export-takes';
    await click(score?'score-tools-button':'results-button');await until(()=>!$(button).disabled,'export ready');
    const before=(await json('/__desktop_smoke/state')).downloads.length;await click(button);let row;
    await until(async()=>{row=(await json('/__desktop_smoke/state')).downloads[before];return row?.complete;},'native download');assert(row.success,'Native export failed');
    await click($(dialog).querySelector('[data-close-panel]'));return row.file;
  }
  const keyNodes=[];
  const boundary=()=>{
    const rect=node=>{const r=node.getBoundingClientRect();return{x:r.x,y:r.y,width:r.width,height:r.height};},keys=[...document.querySelectorAll('#keyboard .piano-key')];
    if(!keyNodes.length)keyNodes.push(...keys);
    return{screen:document.body.dataset.screen,clock:__wmhReadPlaybackClock(document),captured:$('hud-captured').textContent,
      sameKeyNodes:keys.length===keyNodes.length&&keys.every((node,i)=>node===keyNodes[i]),theme:localStorage.getItem('worldmusichub.theme'),
      geometry:{viewport:{width:innerWidth,height:innerHeight},canvas:rect($('falling-notes')),keyboard:rect($('keyboard')),transport:rect(document.querySelector('.transport')),keys:keys.map(node=>({midi:node.dataset.midi,rect:rect(node)}))}};
  };
  const settle=async()=>{await document.fonts.ready;await frame();await frame();await prepareCanonicalPracticeTarget({document,node:$('stage-title')});};
  function cleanup(){if(restored)return;restored=true;report.pickerObservations=scoreControls?.pickers||[];report.pickerFileEvents=scoreControls?.trusted.filter(e=>e.id==='score-file'||e.pickerSequence!==undefined)||[];scoreControls?.restore();if(globalThis.fetch===observedFetch)globalThis.fetch=originalFetch;report.fetchRestored=globalThis.fetch===originalFetch;for(const type of ['click','input','change','keydown','keyup'])document.removeEventListener(type,observe,true);}
  addEventListener('DOMContentLoaded',async()=>{try{
    for(const type of ['click','input','change','keydown','keyup'])document.addEventListener(type,observe,true);scoreControls=createVsqControlObserver(document,{readActionSequence:()=>sequence});
    await prepareNativePlaybackClock({document,until});assert((await json('/api/health')).network==='native-protocol-no-listener','Actual native protocol required');
    await click('home-single-player');await until(()=>$('song-lobby').dataset.previewStatus==='ready','library ready');
    if(phase==='skin-seed'){
      await click('import-tools-button');await native('picker',$('import-button'),'skin-original-score.json');
      await until(()=>document.querySelector('.score-storage-status')?.dataset.persistence==='saved','original score persisted');scoreControls.endPicker(activePicker,true);activePicker=null;
      await click($('import-tools-dialog').querySelector('[data-close-panel]'));
    }
    const inventory=await json('/api/library/list');assert(inventory.entries.length===1,'One test-owned original score required');report.key=inventory.entries[0].key;report.opened=await json('/api/library/load',{key:report.key});
    let row;await until(()=>row=document.querySelector(`#catalog [data-library-key="native:${report.key}"]`),'saved score row');await click(row);await until(()=>$('song-lobby').dataset.previewId===`native:${report.key}`&&$('song-lobby').dataset.previewStatus==='ready','original preview');
    await mod.start(['human'],{layout:'complete'});await until(()=>__wmhReadPlaybackClock(document).running&&__wmhReadPlaybackClock(document).positionMs>0,'practice started');
    await native('key-r',$('stage-title'));await until(()=>$('hud-captured').textContent==='1','one original human input');await click('play-button');
    await until(()=>__wmhReadPlaybackClock(document).phase==='paused'&&!$('play-button').disabled&&document.querySelector('.performance-status')?.dataset.phase!=='grace','paused take settled');
    report.stage='skin-round';const requestStart=report.requests.length;
    report.round=await driveNativeSkinRound({phase,document,native,until,boundary,download,settle});report.skinRequests=report.requests.slice(requestStart);
    report.inventory=await json('/api/library/list');report.actions=sequence;report.modActions=mod.history;cleanup();report.stage='complete';report.ok=true;
  }catch(error){report.error=String(error.stack||error);report.actions=sequence;try{cleanup();}catch(failure){report.errors.push(String(failure));}}
  await json('/__desktop_smoke/report',report);
  },{once:true});
})();
