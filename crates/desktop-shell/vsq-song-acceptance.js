/* Process-owned acceptance only. Observe real DOM, fetch and AudioContext;
 * never replace score storage, playback, transport clocks or keyboard events. */
function readVsqFollowingFrame(document) {
 const status=document.getElementById('written-cursor-status'),progress=document.getElementById('progress');return {positionMs:Number(progress.value),durationMs:Number(progress.max),ids:JSON.parse(status.dataset.sourceNoteIds||'[]'),measure:status.dataset.sourceMeasureIndex??'',renderer:document.getElementById('clean-song-stage').dataset.rendererState,cue:document.getElementById('stage-cue').dataset.cueState??null};
}
function createVsqFollowingObserver(document,{request=requestAnimationFrame,cancel=cancelAnimationFrame,maxRows=512}={}) {
 const rows=[];let active=true,frame;
 function tick(){if(!active)return;const status=document.getElementById('written-cursor-status');if(status?.dataset.status==='ready'&&document.body.dataset.screen==='stage'){
  const row=readVsqFollowingFrame(document);
  if(rows.length===0||JSON.stringify(row)!==JSON.stringify(rows.at(-1))){if(rows.length>=maxRows)throw Error('VSQ following observation exceeded 512 rows');rows.push(row);}
 }frame=request(tick);}frame=request(tick);return{rows,stop(){active=false;cancel(frame);}};
}
/* Score paint is intentionally pointer-inert. Observe its drawn viewport without
 * clicking hidden cursor diagnostics; the foreground stage title captures the
 * screenshot through the same strict native hit test as every other action. */
function observeVsqFollowingSurface(document) {
 const surface=document.getElementById('notation-lane-overlay'),view=document.defaultView;
 if(!surface||surface.hidden)throw Error('VSQ following score paint is hidden');
 const {x,y,width,height}=surface.getBoundingClientRect(),style=view.getComputedStyle(surface),viewport={width:view.innerWidth,height:view.innerHeight};
 if(!(width>0&&height>0&&x+width/2>0&&x+width/2<viewport.width&&y+height/2>0&&y+height/2<viewport.height&&style.display!=='none'&&style.visibility==='visible'&&Number(style.opacity)>0))throw Error('VSQ following score paint is outside its visible viewport');
 const svgs=[...surface.querySelectorAll('svg')].filter(svg=>{const b=svg.getBoundingClientRect(),s=view.getComputedStyle(svg);return b.width>0&&b.height>0&&b.x<x+width&&b.x+b.width>x&&b.y<y+height&&b.y+b.height>y&&s.display!=='none'&&s.visibility==='visible'&&Number(s.opacity)>0;});
 if(!svgs.length)throw Error('VSQ following score paint has no visible notation SVG');
 return{id:surface.id,bounds:{x,y,width,height},viewport,visibleSvgCount:svgs.length};
}
/* Observe the JSON value delivered to the caller, not a competing cloned
 * response stream. Preview adoption may abort its old controller immediately
 * after the original JSON promise resolves. Every app promise/value is forwarded
 * unchanged; observation failures become evidence failures only. */
function createVsqJsonObserver({onValue,onError,maxRows=16}) {
 const rows=[],restores=new Set();let stopped=false;
 const fail=(row,phase,error)=>{if(stopped)return;row.state=phase;row.error=String(error).slice(0,512);onError(`${row.path} ${phase}: ${row.error}`);};
 function observe(path,promise){
  if(stopped)return promise;if(rows.length>=maxRows){onError('VSQ JSON observation exceeds its finite response bound');return promise;}
  const row={path,status:null,state:'fetching'};rows.push(row);
  Reflect.apply(Promise.prototype.then,promise,[response=>{
   if(stopped)return;row.status=response.status;row.state='awaiting-consumption';
   try {
    const json=response.json,descriptor=Object.getOwnPropertyDescriptor(response,'json');
    const restore=()=>{if(response.json===observedJson){if(descriptor)Object.defineProperty(response,'json',descriptor);else delete response.json;}restores.delete(restore);};
    function observedJson(...args){
     let result;try{result=Reflect.apply(json,this,args);}catch(error){if(this===response)fail(row,'body-threw',error);throw error;}
     if(this===response){row.state='consuming';try{Reflect.apply(Promise.prototype.then,result,[value=>{if(!stopped){try{onValue({path,status:response.status,body:structuredClone(value)});row.state='consumed';}catch(error){fail(row,'observation-failed',error);}}restore();},error=>{fail(row,'body-rejected',error);restore();}]);}catch(error){fail(row,'observation-failed',error);restore();}}
     return result;
    }
    response.json=observedJson;restores.add(restore);
   }catch(error){fail(row,'observation-failed',error);}
  },error=>fail(row,'fetch-rejected',error)]);
  return promise;
 }
 return{observe,snapshot:()=>rows.map(row=>({...row})),restore(){stopped=true;for(const restore of [...restores])restore();}};
}
/* The app deliberately calls hiddenInput.click() from the real Import control.
 * That one untrusted delegation is admitted only inside the owned picker action,
 * paired with exactly one trusted change for the approved original fixture. */
function createVsqControlObserver(document) {
 const trusted=[],pickers=[],listeners=[];let active=null;
 function observe(event){
  const id=event.target?.id,part=event.target?.dataset?.partId;
  if(!['vsq-choose-base-notes','play-button','clean-song-target','stage-title','bulk-import-save','score-file'].includes(id)&&!part)return;
  const row={type:event.type,trusted:event.isTrusted===true,id:id||null,part:part||null,code:event.code||null,value:event.target?.value||null,checked:typeof event.target?.checked==='boolean'?event.target.checked:null};
  if(id==='score-file'&&active){
   if(event.type==='click'&&event.isTrusted===false){if(active.delegatedClicks.length>=1)throw Error('VSQ picker has repeated hidden-input delegation');active.delegatedClicks.push({type:'click',trusted:false,id,sequence:active.sequence});return;}
   if(event.type==='change'){if(active.changes.length>=1)throw Error('VSQ picker has repeated file changes');active.changes.push({type:'change',trusted:event.isTrusted===true,id,sequence:active.sequence,filename:event.target.files?.[0]?.name??null});row.pickerSequence=active.sequence;}
  }
  if(trusted.length>=128)throw Error('VSQ event observation bound exceeded');trusted.push(row);
 }
 for(const type of ['click','change','keydown','keyup']){document.addEventListener(type,observe,true);listeners.push(()=>document.removeEventListener(type,observe,true));}
 return{trusted,pickers,beginPicker(sequence,filename){if(active||pickers.length>=8)throw Error('VSQ picker observation ownership/bound invalid');active={sequence,filename,completed:false,delegatedClicks:[],changes:[]};pickers.push(active);},endPicker(sequence,completed){if(!active||active.sequence!==sequence)throw Error('VSQ picker observation ownership changed');active.completed=completed;active=null;},restore(){active=null;for(const remove of listeners)remove();}};
}
(() => {
 const phase=globalThis.__WMH_ACCEPTANCE_PHASE__,$=id=>document.getElementById(id),assert=(v,m)=>{if(!v)throw Error(m);};
 const originalFetch=globalThis.fetch,fetcher=originalFetch.bind(globalThis),waits=createAcceptanceWait(),json=(path,body)=>waits.json(fetcher,path,body===undefined?undefined:{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)},10000);
 const controls=createVsqControlObserver(document);
 const report={version:1,phase,origin:location.origin,ok:false,stage:'initialization',checks:[],errors:[],requests:[],imports:[],runtimeResponses:[],trusted:controls.trusted,pickerObservations:controls.pickers,files:{},screenshots:{},diagnostics:[]};
 let sequence=0,probe,follow,requestObservationActive=true;
 const checkpoint=stage=>{report.stage=stage;assert(report.diagnostics.length<48,'VSQ diagnostic stage bound exceeded');report.diagnostics.push({stage,elapsedMs:performance.now()});};
 const until=(condition,label,ms=10000)=>waits.until(condition,`VSQ ${report.stage}: ${label}`,ms);
 const closeDialogs=()=>{for(const d of document.querySelectorAll('dialog[open]'))d.close();};
 const click=id=>{assert($(id)&&!$(id).disabled,`Unavailable control ${id}`);$(id).click();};
 const menu=createAcceptanceNavigation({document,until,click});
 const frame=()=>new Promise(requestAnimationFrame);
 const responses=createVsqJsonObserver({onValue:row=>{const list=row.path==='/api/library/runtime'?report.runtimeResponses:report.imports;assert(list.length<8,'VSQ response observation bound exceeded');list.push(row);},onError:message=>report.errors.push(message)});
 const observedFetch=function(...args){const promise=Reflect.apply(originalFetch,this,args);if(!requestObservationActive)return promise;try{const route=String(args[0]);if(route.startsWith('/api/')){
  assert(report.requests.length<128,'VSQ API observation exceeded 128 requests');let body=null;if(typeof args[1]?.body==='string')body=JSON.parse(args[1].body);report.requests.push({path:route,body});
  if(['/api/library/import/preview','/api/library/import/commit','/api/library/runtime'].includes(route))responses.observe(route,promise);
 }}catch(error){report.errors.push(`VSQ request observation: ${String(error).slice(0,512)}`);}return promise;};globalThis.fetch=observedFetch;
 const onError=event=>report.errors.push(String(event.message)),onRejection=event=>report.errors.push(String(event.reason));addEventListener('error',onError);addEventListener('unhandledrejection',onRejection);
 async function native(kind,node,file){assert(node&&!node.disabled,'VSQ native control unavailable');node.scrollIntoView({block:'center',inline:'center'});node.focus();await frame();await frame();const b=node.getBoundingClientRect();assert(b.width>0&&b.height>0,'VSQ target is not visible');const x=b.x+b.width/2,y=b.y+b.height/2,hit=document.elementFromPoint(x,y);assert(x>0&&x<innerWidth&&y>0&&y<innerHeight,`VSQ control ${node.id||node.tagName} remains outside viewport after scrolling`);assert(hit===node||node.contains(hit),`VSQ control ${node.id||node.tagName} is obscured after scrolling`);assert(sequence<64,'VSQ action count exceeded');const action={version:1,sequence:++sequence,kind,x:b.x+b.width/2,y:b.y+b.height/2,width:innerWidth,height:innerHeight,...(file?{file}:{})};const picker=kind==='picker';let completed=false;if(picker)controls.beginPicker(sequence,file);try{await json('/__desktop_smoke/action',action);let result;await until(async signal=>{const response=await fetcher(`/__desktop_smoke/result/${sequence}`,{signal});if(response.status===404)return false;result=await response.json();assert(response.ok,result.error||'VSQ action result failed');return true;},`native ${kind} #${sequence}`,15000);assert(result.ok,result.error||'VSQ native action failed');completed=true;return sequence;}finally{if(picker&&!completed)controls.endPicker(sequence,false);}}
 const inventory=async()=>{const value=await json('/api/library/list');assert(value.storage==='native-filesystem'&&value.issues.length===0,'VSQ native inventory incomplete');return value;};
 const ready=()=>$('bulk-import-dialog').open&&$('bulk-import-dialog').dataset.phase==='review';
 async function choose(file){closeDialogs();click('import-tools-button');const before=report.imports.length;let pickerSequence,completed=false;try{pickerSequence=await native('picker',$('import-button'),file);await until(()=>ready()&&report.imports.length>before,'chooser preflight response');assert(report.imports.at(-1).path.endsWith('/preview'),'VSQ chooser bypassed preflight');completed=true;}finally{if(pickerSequence)controls.endPicker(pickerSequence,completed);}}
 async function save(){const before=report.imports.length;await native('click',$('bulk-import-save'));await until(()=>ready()&&report.imports.length>before&&report.imports.at(-1).path.endsWith('/commit'),'save response');}
 async function download(node){const before=(await json('/__desktop_smoke/state')).downloads.length;await native('click',node);let row;await until(async()=>{row=(await json('/__desktop_smoke/state')).downloads[before];return row?.complete;},'download completion');assert(row.success,'VSQ download failed');return row.file;}
 async function take(){closeDialogs();click('results-button');const file=await download($('export-takes'));closeDialogs();return file;}
 const audio=()=>probe.snapshot();
 async function silence(label){await until(()=>audio().activeSources===0&&audio().pendingSources===0,label,5000);return audio();}
 function choiceState(){return{preview:$('song-lobby').dataset.previewStatus,listenDisabled:$('start-listen').disabled,practiceDisabled:$('start-practice').disabled,fullVocalDisabled:$('vsq-full-vocal').disabled,fullVocalVisible:!$('vsq-full-vocal').hidden&&$('vsq-full-vocal').getBoundingClientRect().width>0,choiceVisible:!$('vsq-choose-base-notes').hidden,limits:$('vsq-interpretation-limits').children.length,tracks:[...$('clean-song-tracks').children].map(n=>n.textContent),audio:audio(),runtimeRequests:report.runtimeResponses.length};}
 async function select(entry){await until(()=>$('catalog').querySelector(`[data-library-key="native:${entry.key}"]`),'stored nonplayable song row');await native('click',$('catalog').querySelector(`[data-library-key="native:${entry.key}"]`));await until(()=>$('song-lobby').dataset.previewStatus==='choice','explicit interpretation choice');const state=choiceState();assert(state.listenDisabled&&state.practiceDisabled&&state.fullVocalDisabled&&state.fullVocalVisible&&state.choiceVisible&&state.limits===8&&state.tracks.length===2,'VSQ choice UI incomplete');return state;}
 async function start(mode){await native('click',$(`start-${mode}`));await until(()=>document.body.dataset.screen==='stage'&&!$('play-button').disabled,`${mode} stage admission`);}
 async function reset(){await native('click',$('reset-button'));await until(()=>Number($('progress').value)===0&&!$('play-button').disabled,'transport reset');}
 addEventListener('DOMContentLoaded',async()=>{
  try {
   assert(['vsq-seed','vsq-restart'].includes(phase),'Unknown VSQ phase');assert(localStorage.getItem('wmh.vsq.acceptance.marker')===null,'VSQ needs a fresh browser profile');report.profileMarkerAbsent=true;localStorage.setItem('wmh.vsq.acceptance.marker',phase);
   await menu.enterLibrary();const {getAppI18n}=await import('/app-locale.js');getAppI18n(document).setLocale('en');assert((await json('/api/health')).network==='native-protocol-no-listener','VSQ requires actual native protocol');probe=observeNativeReferenceAudio();
   if(phase==='vsq-seed'){
    checkpoint('chooser-preflight');assert((await inventory()).entries.length===0,'VSQ seed requires empty Scores');await choose('vsq-authored-song.zip');const preflight=report.imports.at(-1).body,item=preflight.items[0];assert(preflight.summary.ready===1&&item.playable===false&&item.clean_package?.coverage?.project?.tracks===2&&item.clean_package.coverage.project.notes===2,'VSQ preflight omitted tracks or granted playback');assert((await inventory()).entries.length===0,'VSQ preflight wrote storage');report.preflight={status:item.status,playable:item.playable,coverage:item.clean_package.coverage};report.screenshots.preflight=await native('click',$('bulk-import-title'));
    checkpoint('save-package');await save();assert(report.imports.at(-1).body.summary.saved===1&&report.imports.at(-1).body.items[0].playable===false,'VSQ save failed or implicitly granted playback');await native('click',$('bulk-import-done'));report.checks.push('chooser-preflight-all-tracks-save');
   }
   checkpoint('select-explicit-choice');const list=await inventory();assert(list.entries.length===1,'VSQ native library must contain one song');const entry=list.entries[0];report.inventory=list.entries;report.directory=list.directory;report.beforeChoice=await select(entry);assert(report.beforeChoice.audio.sourceStarts===0&&report.runtimeResponses.length===0,'Selecting VSQ started audio/runtime');report.opened=await json('/api/library/load',{key:entry.key});assert(report.opened.clean_package.runtime===null,'VSQ open compiled implicit runtime');report.screenshots.choice=await native('click',$('clean-song-preview-status'));getAppI18n(document).setLocale('zh-CN');report.chineseChoice={button:$('vsq-choose-base-notes').textContent,vocal:$('vsq-full-vocal').textContent,description:$('vsq-practice-description').textContent,limits:[...$('vsq-interpretation-limits').children].map(n=>n.textContent)};assert(report.chineseChoice.button.includes('基础音符器乐练习')&&report.chineseChoice.vocal.includes('不可用')&&report.chineseChoice.limits.length===8,'Chinese VSQ choice or limits missing');report.screenshots.choiceZh=await native('click',$('clean-song-preview-status'));getAppI18n(document).setLocale('en');
   await native('click',$('vsq-choose-base-notes'));await until(()=>{assert(report.errors.length===0,report.errors.join('; '));return report.runtimeResponses.length===1;},'application consumed explicit base-note response');await until(()=>$('song-lobby').dataset.previewStatus==='ready'&&!$('start-listen').disabled&&!$('start-practice').disabled,'ready choice UI after consumed response');report.afterChoice=choiceState();assert(report.afterChoice.audio.sourceStarts===0,'VSQ explicit choice auto-started audio');report.checks.push('stored-nonplayable-explicit-choice-no-autoaudio');
   const runtime=report.runtimeResponses[0].body;assert(runtime.reference_velocity===90&&runtime.runtime.notes.every(n=>n.dynamics===0),'VSQ native reference inventory changed');assert(runtime.navigation.profile==='wmh-vsq-practice-navigation-v1','VSQ native following absent');
   closeDialogs();click('settings-button');if($('count-in').checked)await native('click',$('count-in'));closeDialogs();
   checkpoint('listen-setup');await start('listen');await reset();if($('notation-toggle').getAttribute('aria-expanded')!=='true')await native('click',$('notation-toggle'));await until(()=>$('written-cursor-status').dataset.status==='ready','native following admission');
   checkpoint('listen-native-following');follow=createVsqFollowingObserver(document);const beforeListen=audio().sourceStarts;await native('click',$('play-button'));await until(()=>audio().sourceStarts>beforeListen&&Number($('progress').value)>0,'real reference source scheduling',5000);report.listenAudio=audio();report.followingCapture={before:{frame:readVsqFollowingFrame(document),audio:audio()}};report.screenshots.following=await native('click',$('stage-title'));report.followingCapture.after={frame:readVsqFollowingFrame(document),audio:audio()};report.followingSurface=observeVsqFollowingSurface(document);for(const sample of Object.values(report.followingCapture))assert(sample.frame.renderer==='playing'&&sample.frame.positionMs>0&&sample.frame.ids.length>0&&sample.audio.activeSources>0,'VSQ following screenshot missed the live native-note interval');await until(()=>Number($('progress').value)>=runtime.runtime.end_ms,'native playback end',7000);follow.stop();report.following=follow.rows;follow=null;report.listenStopped=await silence('listen completion source cleanup');report.checks.push('listen-real-reference-native-following');
   checkpoint('pause-cleanup');await reset();await native('click',$('play-button'));await until(()=>Number($('progress').value)>0,'pause pass started',5000);await native('click',$('play-button'));await until(()=>$('clean-song-stage').dataset.rendererState==='paused','paused renderer',5000);report.pauseAudio=await silence('pause source cleanup');const paused=Number($('progress').value);await frame();await frame();report.pauseClock={before:paused,after:Number($('progress').value)};assert(report.pauseClock.before===report.pauseClock.after,'Paused clock moved');await menu.returnToLibrary();report.navigationAudio=await silence('navigation source cleanup');report.checks.push('pause-navigation-cleanup');
   checkpoint('practice-part-controls');await start('practice');await reset();if(!$('song-parts-tools').open)await native('click',$('song-parts-summary'));const initial=$('clean-song-target').value;await native('select-last',$('clean-song-target'));await until(()=>$('clean-song-target').value!==initial&&!$('play-button').disabled,'human target selection');const target=$('clean-song-target').value,parts=[...document.querySelectorAll('#clean-song-parts input')],human=parts.find(n=>n.dataset.partId===target),other=parts.find(n=>n.dataset.partId!==target);assert(human.disabled&&!human.checked&&other.checked&&!other.disabled,'VSQ human and accompaniment separation failed');await native('click',other);await until(()=>!document.querySelector(`[data-part-id="${other.dataset.partId}"]`).checked,'accompaniment mute');await native('click',document.querySelector(`[data-part-id="${other.dataset.partId}"]`));report.controls={initial,target,other:other.dataset.partId,humanDisabled:human.disabled,humanMachineEnabled:human.checked,otherRestored:document.querySelector(`[data-part-id="${other.dataset.partId}"]`).checked};report.screenshots.parts=await native('click',$('clean-song-stage-status'));await native('click',$('song-parts-summary'));
   checkpoint('machine-input-separation');await reset();const beforeMachine=audio().sourceStarts;await native('click',$('play-button'));await until(()=>audio().sourceStarts>beforeMachine&&Number($('progress').value)>0,'machine accompaniment scheduled',5000);report.machinePlaying={captured:$('hud-captured').textContent,audio:audio(),positionMs:Number($('progress').value)};assert(report.machinePlaying.captured==='0','Accompaniment became input');await native('click',$('play-button'));await until(()=>$('clean-song-stage').dataset.rendererState==='paused','machine-only pass paused',5000);report.machineStopped=await silence('machine pause cleanup');report.files.machineTake=await take();report.checks.push('human-target-machine-input-separation');
   if(phase==='vsq-seed'){
    checkpoint('trusted-human-input');await reset();const trace=observeNativeReferenceTransport(document);try{trace.changed('ready',{checkpoint:true});await native('click',$('play-button'));await until(()=>trace.counts().trustedPlayClicks===1&&trace.state().phase==='capturing'&&Number($('progress').value)>0,'trusted practice start',5000);await native('key-r',$('stage-title'));await until(()=>trace.counts().trustedKeyDowns===1&&trace.counts().trustedKeyUps===1&&$('hud-captured').textContent==='1','trusted input capture',5000);await native('click',$('play-button'));await until(()=>trace.counts().trustedPlayClicks===2&&$('stage-cue').dataset.cueState==='paused','trusted practice pause',5000);report.transportAdmission=trace.snapshot('complete');}finally{trace.stop();}report.files.humanTake=await take();report.checks.push('trusted-human-input');
    checkpoint('exact-package-export');await menu.returnToLibrary();closeDialogs();click('import-tools-button');click('bulk-import-history-button');if(!$('bulk-import-history').open)await native('click',$('bulk-import-history').querySelector('summary'));await until(()=>document.querySelector('#bulk-import-export-songs input'),'VSQ export selection');await native('click',$('bulk-import-export-all'));report.files.package=await download($('bulk-import-export-pack'));await native('click',$('bulk-import-done'));report.checks.push('complete-package-export');
   }else await menu.returnToLibrary();
   checkpoint('reload-choice-reset');const beforeReload=report.runtimeResponses.length;report.reloadChoice=await select(entry);assert(report.reloadChoice.runtimeRequests===beforeReload&&report.reloadChoice.audio.activeSources===0&&report.reloadChoice.audio.pendingSources===0,'Reload retained or auto-compiled interpretation');const reopened=await json('/api/library/load',{key:entry.key});assert(reopened.clean_package.runtime===null,'Reload runtime choice persisted');report.checks.push('reload-requires-choice');
   assert(report.requests.filter(r=>r.path==='/api/notation-navigation'&&r.body?.id===entry.score_id).length===0,'VSQ used generic BPM navigation');assert(report.runtimeResponses.length===1,'VSQ choice count changed');assert(report.errors.length===0,report.errors.join('; '));report.actions=sequence;report.downloads=(await json('/__desktop_smoke/state')).downloads;checkpoint('complete');report.ok=true;
  } catch(error){report.error=String(error);report.failureStage=report.stage;}
  finally{follow?.stop();if(probe){report.finalAudio=audio();probe.restore();}report.responseObservations=responses.snapshot();responses.restore();controls.restore();requestObservationActive=false;removeEventListener('error',onError);removeEventListener('unhandledrejection',onRejection);if(globalThis.fetch===observedFetch)globalThis.fetch=originalFetch;}
  try{assert(new TextEncoder().encode(JSON.stringify(report)).length<=1024*1024,'VSQ report exceeds 1 MiB');await json('/__desktop_smoke/report',report);}catch(error){await json('/__desktop_smoke/report',{version:1,phase,ok:false,error:'VSQ report delivery failed',failureStage:report.stage,detail:String(error).slice(0,512)});}
 },{once:true});
})();
