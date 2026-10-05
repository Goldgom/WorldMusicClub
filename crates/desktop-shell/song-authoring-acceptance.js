/* Process-owned acceptance for the actual authoring screen. Observers forward
 * real browser methods and inspect delivered values; no app state, event,
 * parser, storage, player or clock is replaced. */
const AUTHORING_REPORT_BYTES=1024*1024;
async function postAuthoringAcceptanceReport({report,fetcher,waits}){
 const send=value=>waits.json(fetcher,'/__desktop_smoke/report',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(value)},10000);let bytes=null;
 try{bytes=new TextEncoder().encode(JSON.stringify(report)).length;if(bytes>AUTHORING_REPORT_BYTES)throw Error('Authoring report exceeds its finite evidence limit');await send(report);return{delivered:true,bytes};}
 catch(error){await send({version:1,phase:report.phase,ok:false,error:'Authoring acceptance report could not be delivered',report_failure:{code:'authoring_report_delivery_failed',received_bytes:bytes,limit_bytes:AUTHORING_REPORT_BYTES,detail:String(error).slice(0,512)}});return{delivered:false,bytes};}
}
function createAuthoringControlObserver(document,{now=()=>performance.now(),defer=fn=>setTimeout(fn,0),actionSequence=()=>null}={}) {
 const events=[],pickers=[],pending=[],remove=[];let owner=null;
 const view=document.defaultView;
 function blur(event){if(!owner||event.target!==view)return;const row=owner;if(row.blurs.length>=8)throw Error('Authoring blur observation bound exceeded');const item={trusted:event.isTrusted===true,started_wall_ms:now(),finished_wall_ms:null,state:null};row.blurs.push(item);row.pending.push(new Promise(resolve=>defer(()=>{item.finished_wall_ms=now();item.state={cue:document.getElementById('stage-cue')?.dataset.cueState,clock:globalThis.__wmhReadPlaybackClock(document).positionMs,pressed:document.querySelectorAll('.pressed').length};resolve();})));}
 view?.addEventListener('blur',blur,true);remove.push(()=>view?.removeEventListener('blur',blur,true));
 const digest=async bytes=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),n=>n.toString(16).padStart(2,'0')).join('');
 function observe(event){
  const input=event.target,id=input?.id||(input?.matches?.('#instrument-settings>summary')?'instrument-settings-summary':''),button=input?.closest?.('button'),role=button?.dataset?.authoringText||null;
  if(owner&&id==='authoring-files'&&event.type==='click'&&!event.isTrusted){
   owner.delegated.push({id,type:'click',trusted:false});return;
  }
  if(owner&&id==='authoring-files'&&event.type==='change'){
   const row=owner,files=Array.from(input.files||[]);row.changes.push({trusted:event.isTrusted===true,count:files.length,input:{id,type:input.type,multiple:input.multiple,disabled:input.disabled,connected:input.isConnected}});
   pending.push(Promise.all(files.map(async file=>({filename:file.name,bytes:file.size,sha256:await digest(await file.arrayBuffer())}))).then(values=>{row.files=values;}));
  }
  if(!id.startsWith('authoring-')&&!['home-song-authoring','settings-button','instrument-settings-summary','song-authoring-title','start-listen','play-button','stage-title','back-to-library','sound-button'].includes(id)&&!role)return;
  if(events.length>=256)throw Error('Authoring trusted event bound exceeded');
  events.push({sequence:actionSequence(),type:event.type,trusted:event.isTrusted===true,id,role,code:event.code||null,value:['input','change'].includes(event.type)&&typeof input.value==='string'?input.value:null});
 }
 for(const type of ['click','change','input','keydown','keyup']){document.addEventListener(type,observe,true);remove.push(()=>document.removeEventListener(type,observe,true));}
 return{events,pickers,begin(sequence,file){if(owner||pickers.length>=4)throw Error('Authoring picker ownership or finite count exceeded');owner={sequence,file,completed:false,started_wall_ms:now(),finished_wall_ms:null,blurs:[],pending:[],delegated:[],changes:[],files:[]};pickers.push(owner);},async end(sequence,completed){if(owner?.sequence!==sequence)throw Error('Authoring picker owner changed');const row=owner;owner=null;await Promise.all([...pending,...row.pending]);delete row.pending;row.finished_wall_ms=now();row.completed=completed;},async finish(){await Promise.all(pending);},restore(){owner=null;for(const fn of remove)fn();}};
}
async function prepareAuthoringNavigationPause({document,native,click,menu,until,snapshot}) {
 const $=id=>document.getElementById(id),trace=observeNativeReferenceTransport(document);
 let stage='listen-ready';
 try {
  await menu.waitScreen('library','start-listen','original catalog preview ready');
  const setup={kind:'native-listen-navigation',previewId:$('song-lobby').dataset.previewId,controls:[]};
  if($('sound-button').getAttribute('aria-pressed')!=='true'){click('sound-button');setup.controls.push('sound-button');}
  trace.changed('listen-ready',{checkpoint:true});
  // Start Listen already starts the real transport after compilation. A second
  // Play toggle would pause it, as the actual focused 243 run demonstrated.
  stage='listen-start';setup.listenAction=await native('click',$('start-listen'));setup.controls.push('start-listen');
  await until(()=>{const current=trace.changed('await-listen-start');return current.screen==='stage'&&current.mode==='listen'&&!current.playDisabled&&!current.hidden&&current.openDialogs.length===0&&current.positionMs>0&&current.positionMs<current.durationMs&&!['paused','complete','ready'].includes(current.cue);},'native Start Listen is running');
  trace.changed('listen-running',{checkpoint:true});setup.title=$('stage-title').textContent;const before=snapshot();
  stage='navigation-pause';setup.navigationAction=await native('click',$('back-to-library'));setup.controls.push('back-to-library');
  await until(()=>{trace.changed('await-navigation-pause');return document.body.dataset.screen==='library'&&$('stage-cue').dataset.cueState==='paused'&&document.querySelectorAll('.pressed').length===0;},'navigation genuinely paused');
  trace.changed('navigation-paused',{checkpoint:true});
  return{setup,before,after:snapshot(),admission:trace.snapshot('complete')};
 }catch(error){trace.changed('failed',{checkpoint:true});error.authoringNavigation=trace.snapshot(stage);throw error;}
 finally{trace.stop();}
}
(() => {
 const phase=globalThis.__WMH_ACCEPTANCE_PHASE__,$=id=>document.getElementById(id),assert=(ok,message)=>{if(!ok)throw Error(message);};
 const originalFetch=globalThis.fetch,fetcher=originalFetch.bind(globalThis),waits=createAcceptanceWait();
 const json=(path,body)=>waits.json(fetcher,path,body===undefined?undefined:{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)},10000);
 const controls=createAuthoringControlObserver(document,{actionSequence:()=>sequence}),report={version:1,phase,origin:location.origin,ok:false,stage:'initializing',checks:[],errors:[],requests:[],responses:[],trusted:controls.events,pickerObservations:controls.pickers,files:{},screenshots:{},drafts:[],saved:[],opened:[],isolation:{}};
 const observer=createVsqJsonObserver({maxRows:48,onValue:row=>report.responses.push(row),onError:error=>report.errors.push(error)});
 let sequence=0,probe=null,observing=true;
 globalThis.fetch=function(...args){const promise=Reflect.apply(originalFetch,this,args);if(observing)try{const route=String(args[0]);if(route.startsWith('/api/')){assert(report.requests.length<160,'Authoring request bound exceeded');let body=null;if(typeof args[1]?.body==='string'){const value=JSON.parse(args[1].body);body={...value};if(body.source_base64){body.source_base64_bytes=body.source_base64.length;delete body.source_base64;}}const index=report.requests.length;report.requests.push({path:route,body,actionSequence:sequence});if(['/api/clean-song/draft','/api/clean-song/draft/pack','/api/library/import/preview','/api/library/import/commit'].includes(route))observer.observe(route,promise,index);}}catch(error){report.errors.push(String(error));}return promise;};
 const until=(fn,label,ms=10000)=>waits.until(fn,`Authoring ${report.stage}: ${label}`,ms),frame=()=>new Promise(requestAnimationFrame),click=id=>{assert($(id)&&!$(id).disabled,`Unavailable ${id}`);$(id).click();};
 const closeDialogs=()=>{for(const dialog of document.querySelectorAll('dialog[open]'))dialog.close();},menu=createAcceptanceNavigation({document,until,click});
 const errors=event=>report.errors.push(String(event.message||event.reason));addEventListener('error',errors);addEventListener('unhandledrejection',errors);
 const checkpoint=value=>{report.stage=value;};
 async function native(kind,node,file){
  assert(node&&!node.disabled,'Authoring control unavailable');node.scrollIntoView({block:'center',inline:'center'});node.focus();await frame();await frame();
  if(kind==='key-r')assert(document.activeElement===node,'Authoring keyboard target did not receive focus');
  const b=node.getBoundingClientRect(),x=b.x+b.width/2,y=b.y+b.height/2,hit=document.elementFromPoint(x,y);
  assert(b.width>0&&b.height>0&&x>0&&x<innerWidth&&y>0&&y<innerHeight&&(hit===node||node.contains(hit)),'Authoring target is outside viewport or obscured');assert(sequence<64,'Authoring action count exceeded');
  const action={version:1,sequence:++sequence,kind,x,y,width:innerWidth,height:innerHeight,...(file?{file}:{})};if(kind==='picker')controls.begin(sequence,file);
  let success=false;try{await json('/__desktop_smoke/action',action);let result;await until(async signal=>{const response=await fetcher(`/__desktop_smoke/result/${sequence}`,{signal});if(response.status===404)return false;result=await response.json();assert(response.ok,result.error||'Authoring action failed');return true;},`native ${kind}`,15000);assert(result.ok,result.error||'Authoring native action failed');success=true;return sequence;}finally{if(kind==='picker')await controls.end(sequence,success);}
 }
 const rows=()=>[...document.querySelectorAll('[data-authoring-song]')],rowFor=name=>rows().find(row=>row.querySelector('.authoring-source')?.textContent.includes(name)),control=(row,name)=>row.querySelector(`[data-authoring-${name}]`);
 const review=()=>until(()=>$('song-authoring-screen').dataset.phase==='review','whole selection reviewed');
 const list=async()=>{const value=await json('/api/library/list');assert(value.storage==='native-filesystem'&&value.issues.length===0,'Native inventory incomplete');return value;};
 const snapshot=()=>({title:$('score-title').textContent,stage:$('stage-title').textContent,mode:$('session-mode').value,clock:globalThis.__wmhReadPlaybackClock(document).positionMs,captured:$('hud-captured').textContent,pass:document.querySelector('.performance-status').dataset.passId,revision:document.querySelector('.performance-status').dataset.revision,cue:$('stage-cue').dataset.cueState,soundMuted:$('sound-button').getAttribute('aria-pressed')==='true',pressed:document.querySelectorAll('.pressed').length});
 const screenRow=row=>({id:row.dataset.authoringSong,phase:row.dataset.phase,title:row.querySelector('input').value,classification:row.querySelector('.authoring-classification').textContent,help:row.querySelector('.authoring-classification').nextElementSibling.textContent,inventory:row.querySelector('.authoring-inventory').textContent,tracks:[...row.querySelectorAll('.authoring-track-list>li')].map(node=>node.textContent),saveVisible:!control(row,'save').hidden,exportVisible:!control(row,'export').hidden,keepBothVisible:!control(row,'keep-both').hidden});
 async function enterAuthoring(){if(document.body.dataset.screen==='library')await native('click',$('lobby-home'));await until(()=>document.body.dataset.screen==='home','home');await native('click',$('home-song-authoring'));await until(()=>document.body.dataset.screen==='authoring'&&!$('song-authoring-screen').hidden,'authoring visible');}
 async function choose(file){await native('picker',$('authoring-choose'),file);await review();}
 async function download(node){const before=(await json('/__desktop_smoke/state')).downloads.length;await native('click',node);let row;await until(async()=>{row=(await json('/__desktop_smoke/state')).downloads[before];return row?.complete;},'download complete');assert(row.success,'Authoring download failed');return row.file;}
 async function take(){closeDialogs();click('results-button');const file=await download($('export-takes'));closeDialogs();return file;}
 async function readOpened(){const library=await list();report.inventory=library.entries;report.directory=library.directory;report.opened=[];for(const entry of library.entries){const value=await json('/api/library/load',{key:entry.key});report.opened.push({key:entry.key,...value});}return library;}
 const silent=()=>{const value=probe.snapshot();assert(value.sourceStarts===0&&value.activeSources===0&&value.pendingSources===0,'Authoring allocated or scheduled audio');return value;};
 const latestDraft=name=>report.responses.filter(row=>row.path==='/api/clean-song/draft'&&row.body.source_name===name).at(-1)?.body;
 addEventListener('DOMContentLoaded',async()=>{
  try{await prepareNativePlaybackClock({document,until});
   assert(['authoring-seed','authoring-restart'].includes(phase),'Unknown authoring phase');assert(localStorage.getItem('wmh.authoring.acceptance.marker')===null,'Authoring requires a fresh browser profile');report.profileMarkerAbsent=true;localStorage.setItem('wmh.authoring.acceptance.marker',phase);
   await menu.enterLibrary();const {getAppI18n}=await import('/app-locale.js');getAppI18n(document).setLocale('en');assert((await json('/api/health')).network==='native-protocol-no-listener','Actual Rust protocol required');
   if(phase==='authoring-seed'){
    checkpoint('real-navigation-pause');const navigation=await prepareAuthoringNavigationPause({document,native,click,menu,until,snapshot});report.navigationSetup=navigation.setup;report.navigationBefore=navigation.before;report.navigationAfter=navigation.after;report.navigationAdmission=navigation.admission;
    probe=observeNativeReferenceAudio();checkpoint('whole-midi-pair');assert((await list()).entries.length===0,'Seed library must be empty');await enterAuthoring();await choose('authoring-original-pair');assert(rows().length===2&&rows().every(row=>row.dataset.phase==='ready'),'Both complete MIDI drafts must be ready');report.initialRows=rows().map(screenRow);report.drafts.push(...['authoring-original-strict.mid','authoring-original-events.mid'].map(latestDraft));assert((await list()).entries.length===0,'Draft preview wrote the library');
    for(const row of rows())await native('click',row.querySelector('.authoring-inventory>summary'));
    report.screenshots.inventory=await native('click',$('song-authoring-title'));
    const strict=rowFor('authoring-original-strict.mid'),before=latestDraft('authoring-original-strict.mid');await native('key-r',strict.querySelector('input'));assert(strict.dataset.phase==='edited'&&control(strict,'save').hidden,'Title edit left stale save available');report.titleChange={before:{title:before.title,source:before.source,draft_sha256:before.draft_sha256},edited:strict.querySelector('input').value};assert(report.titleChange.edited!==before.title,'Native title typing made no edit');await native('click',control(strict,'recheck'));await review();const after=latestDraft('authoring-original-strict.mid');report.titleChange.after={title:after.title,source:after.source,draft_sha256:after.draft_sha256};assert(after.draft_sha256!==before.draft_sha256&&after.source.sha256===before.source.sha256,'Title reprepare did not bind new exact content');
    checkpoint('explicit-atomic-save');report.saveAction=await native('click',$('authoring-save-all'));await review();assert(rows().every(row=>row.dataset.phase==='saved'),'Save All omitted a draft');report.saved=rows().map(screenRow);assert((await list()).entries.length===2,'Save All did not persist both songs');report.screenshots.saved=await native('click',$('song-authoring-title'));
    report.files.package=await download(control(strict,'export'));report.exportedDraft=after;
    await native('click',control(strict,'browse'));await until(()=>document.body.dataset.screen==='library'&&$('song-lobby').dataset.previewId.startsWith('native:')&&$('song-lobby').dataset.previewStatus==='ready','saved song browse');report.browse={id:$('song-lobby').dataset.previewId,status:$('song-lobby').dataset.previewStatus,title:$('preview-title').textContent,rendition:$('clean-song-rendition').textContent,listenDisabled:$('start-listen').disabled,practiceDisabled:$('start-practice').disabled};report.screenshots.library=await native('click',$('lobby-title'));
    await enterAuthoring();await native('click',control(strict,'recheck'));await review();assert(strict.dataset.phase==='duplicate','Exact reviewed bytes did not deduplicate');report.duplicate=screenRow(strict);assert((await list()).entries.length===2,'Duplicate changed inventory');await native('key-r',strict.querySelector('input'));await native('click',control(strict,'recheck'));await review();assert(strict.dataset.phase==='conflict','Changed title did not produce same-source conflict');report.conflict=screenRow(strict);report.keepBothAction=await native('click',control(strict,'keep-both'));await review();assert(strict.dataset.phase==='saved'&&(await list()).entries.length===3,'Explicit keep-both did not preserve both complete versions');report.keptDraft=latestDraft('authoring-original-strict.mid');
    checkpoint('blocked-complete-inventory');await choose('authoring-original-blocked.mid');assert(rows().length===1&&rows()[0].dataset.phase==='held','Unsupported controller was not held');report.blocked=screenRow(rows()[0]);report.blockedDraft=latestDraft('authoring-original-blocked.mid');await native('click',rows()[0].querySelector('.authoring-inventory>summary'));report.screenshots.blocked=await native('click',$('song-authoring-title'));assert((await list()).entries.length===3,'Blocked conversion saved a partial song');
    await choose('authoring-original-pair');assert(rows().length===2,'Final complete pair missing');report.finalReview=rows().map(screenRow);report.setupAudio=silent();probe.restore();probe=null;report.checks.push('actual-two-file-picker','whole-source-inventory','title-fingerprint-reprepare','explicit-atomic-save','duplicate-and-keep-both','blocked-controller-no-save','exact-clean-zip-export','navigation-pauses-before-baseline');
   }else{
    checkpoint('fresh-process-library');const library=await readOpened();assert(library.entries.length===3,'Fresh native process omitted complete songs');report.screenshots.library=await native('click',$('lobby-title'));report.checks.push('fresh-process-exact-library');
   }
   // Every owned chooser (and its real Windows blur) is complete before the
   // human take. Navigation legitimately pauses/relinquishes input first.
   checkpoint('paused-human-baseline');if(document.body.dataset.screen==='authoring')await native('click',$('authoring-library'));
   const original=document.querySelector('#catalog .catalog-item[data-score-id]');assert(original,'Original built-in exercise missing');await native('click',original);await until(()=>$('song-lobby').dataset.previewStatus==='ready'&&!$('start-listen').disabled,'original score ready');report.originalScoreSetup=await activatePerformanceOriginalScore({document,click,menu});report.baselineScope={humanActionStart:sequence,lastPickerAction:controls.pickers.at(-1)?.sequence??0};report.transportAdmission=await prepareNativeReferenceScoredTake({document,native,click,closeDialogs,until});report.baselineScope.humanActionEnd=sequence;report.soundEnabledAction=await native('click',$('sound-button'));assert($('sound-button').getAttribute('aria-pressed')==='false','Isolation must run with sound enabled');await menu.returnToLibrary();
   await enterAuthoring();report.files.beforeTake=await take();report.beforeTakeState=snapshot();report.baselineScope.readyAfterAction=sequence;report.baselineScope.readyAt=performance.now();report.baselineScope.requestStart=report.requests.length;probe=observeNativeReferenceAudio();
   checkpoint('typing-settings-input-isolation');report.isolation.authoringKey=await native('key-r',$('song-authoring-title'));report.isolation.settingsOpen=await native('click',$('settings-button'));report.isolation.settingsKey=await native('key-r',$('instrument-settings').querySelector('summary'));closeDialogs();
   if(phase==='authoring-seed'){const row=rowFor('authoring-original-strict.mid');report.isolation.titleKey=await native('key-r',row.querySelector('input'));assert(row.dataset.phase==='edited','Actual title typing did not invalidate the draft');report.isolation.recheck=await native('click',control(row,'recheck'));await review();const draft=latestDraft('authoring-original-strict.mid'),saved=[report.exportedDraft,report.keptDraft];const expected=saved.some(value=>value.package.metadata_json===draft.package.metadata_json&&value.package.score_json===draft.package.score_json)?'duplicate':'conflict';assert(row.dataset.phase===expected,'Edited source preview disagrees with exact previously saved bytes');report.isolation.draft=draft;report.isolation.row=screenRow(row);}
   report.isolation.audio=silent();report.afterTakeState=snapshot();assert(JSON.stringify(report.afterTakeState)===JSON.stringify(report.beforeTakeState),'Authoring or settings changed paused human take state');report.files.afterTake=await take();report.isolation.afterExportAudio=silent();probe.restore();probe=null;report.checks.push('paused-human-take-unchanged','authoring-settings-keys-no-audio','no-auto-resume');
   await readOpened();report.screenshots.isolation=await native('click',$('song-authoring-title'));report.layout={width:innerWidth,height:innerHeight,documentWidth:document.documentElement.scrollWidth,authoringWidth:$('song-authoring-screen').scrollWidth,authoringClientWidth:$('song-authoring-screen').clientWidth};assert(report.layout.documentWidth<=innerWidth+1&&report.layout.authoringWidth<=report.layout.authoringClientWidth+1,'Authoring screen has horizontal overflow');await controls.finish();report.responseObservations=observer.snapshot();assert(report.responseObservations.every(row=>row.state==='consumed'),'Missing consumed authoring response');report.actions=sequence;report.downloads=(await json('/__desktop_smoke/state')).downloads;assert(report.errors.length===0,report.errors.join('; '));report.stage='complete';report.ok=true;
  }catch(error){report.error=error.stack||String(error);if(error.nativeReferenceTransport)report.failedTransport=error.nativeReferenceTransport;if(error.authoringNavigation)report.failedNavigation=error.authoringNavigation;}
  finally{probe?.restore();report.actions=sequence;await controls.finish().catch(error=>report.errors.push(String(error)));observing=false;observer.restore();controls.restore();globalThis.fetch=originalFetch;removeEventListener('error',errors);removeEventListener('unhandledrejection',errors);await postAuthoringAcceptanceReport({report,fetcher,waits});}
 });
})();
