/* Process-owned acceptance only. Observe real DOM, fetch and AudioContext;
 * never replace score storage, playback, transport clocks or keyboard events. */
function readVsqFollowingFrame(document) {
 const status=document.getElementById('written-cursor-status'),progress=document.getElementById('progress'),clock=globalThis.__wmhReadPlaybackClock(document);return {positionMs:clock.positionMs,transportPositionMs:clock.transportPositionMs,durationMs:clock.durationMs,clock,rangeValue:progress.value,ids:JSON.parse(status.dataset.sourceNoteIds||'[]'),measure:status.dataset.sourceMeasureIndex??'',renderer:document.getElementById('clean-song-stage').dataset.rendererState,cue:document.getElementById('stage-cue').dataset.cueState??null};
}
/* Native range facts and source-clock observations only. No value assignment,
 * synthesized input or application transport access is allowed in this probe. */
function readVsqSeekState(document) {
 const node=document.getElementById('progress'),help=document.getElementById('progress-help'),clock=globalThis.__wmhReadPlaybackClock(document);
 return{control:{id:node?.id??null,tag:node?.tagName??null,type:node?.type??null,min:node?.min??null,max:node?.max??null,step:node?.step??null,disabled:node?.disabled??null,connected:node?.isConnected??false,inert:node?.inert??false,label:node?.getAttribute('aria-label')??null,describedBy:node?.getAttribute('aria-describedby')??null,guidance:help?.textContent??null,value:node?.value??null},positionMs:clock.positionMs,transportPositionMs:clock.transportPositionMs,clock,renderer:document.getElementById('clean-song-stage').dataset.rendererState,captured:document.getElementById('hud-captured').textContent};
}
async function observeVsqTailSeek({document,endMs,lastNoteEndMs,native,until,frame,snapshot,events,evidence}) {
 const assert=(value,message)=>{if(!value)throw Error(message);};
 evidence.version=1;evidence.before=snapshot();evidence.eventStart=events.length;
 try{
  const control=evidence.before.control;
  assert(control.id==='progress'&&control.tag==='INPUT'&&control.type==='range'&&control.min==='0'&&Number(control.max)===endMs&&control.step==='any'&&control.disabled===false&&control.connected&&!control.inert,'Listen seek needs an enabled native range with exact source bounds');
  assert(evidence.before.positionMs===0,'Listen seek preflight did not start at source zero');
  evidence.pointerAction=await native('click',document.getElementById('progress'));
  await until(()=>{evidence.after=snapshot();return evidence.after.positionMs>lastNoteEndMs&&evidence.after.positionMs<endMs&&evidence.after.renderer==='paused';},'real seek into source tail');
  evidence.eventEnd=events.length;await frame();await frame();evidence.beforePlay=snapshot();
  assert(evidence.beforePlay.positionMs===evidence.after.positionMs&&evidence.beforePlay.renderer==='paused','Seeked source clock moved before explicit Play');
  for(const sample of [evidence.before,evidence.after,evidence.beforePlay]){
   const audio=sample.audio;
   assert(sample.captured==='0','Seek became score input');
   assert(audio.activeSources===0&&audio.pendingSources===0&&audio.worklet.activeReceivers===0&&audio.worklet.pendingReceivers===0,'Seek must stay silent until explicit Play');
   assert(audio.sourceStarts===evidence.before.audio.sourceStarts&&audio.oscillatorStarts===evidence.before.audio.oscillatorStarts&&audio.worklet.started===evidence.before.audio.worklet.started&&audio.worklet.receivers===evidence.before.audio.worklet.receivers,'Seek auto-started audio before explicit Play');
  }
 }catch(error){evidence.after=snapshot();evidence.eventEnd=events.length;throw Error(`VSQ real seek failed (before=${evidence.before.positionMs}ms, after=${evidence.after.positionMs}ms, control=${evidence.before.control.tag}/${evidence.before.control.type}): ${error}`);}
}
function createVsqFollowingObserver(document,{request=requestAnimationFrame,cancel=cancelAnimationFrame,maxRows=512}={}) {
 const rows=[];let active=true,frame;
 function tick(){if(!active)return;const status=document.getElementById('written-cursor-status');if(status?.dataset.status==='ready'&&document.body.dataset.screen==='stage'){
  const row=readVsqFollowingFrame(document);
  if(rows.length===0||JSON.stringify(row)!==JSON.stringify(rows.at(-1))){if(rows.length>=maxRows)throw Error('VSQ following observation exceeded 512 rows');rows.push(row);}
 }frame=request(tick);}frame=request(tick);return{rows,stop(){active=false;cancel(frame);}};
}
/* Score paint is intentionally pointer-inert. Observe its drawn viewport without
 * clicking hidden cursor diagnostics. Passive capture reads the current pixels
 * without changing focus, scrolling, pointer position or playback. */
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
 function observe(path,promise,requestIndex){
  if(stopped)return promise;if(rows.length>=maxRows){onError('VSQ JSON observation exceeds its finite response bound');return promise;}
  const row={path,status:null,state:'fetching',...(requestIndex===undefined?{}:{requestIndex})};rows.push(row);
  Reflect.apply(Promise.prototype.then,promise,[response=>{
   if(stopped)return;row.status=response.status;row.state='awaiting-consumption';
   try {
    const json=response.json,descriptor=Object.getOwnPropertyDescriptor(response,'json');
    const restore=()=>{if(response.json===observedJson){if(descriptor)Object.defineProperty(response,'json',descriptor);else delete response.json;}restores.delete(restore);};
    function observedJson(...args){
     let result;try{result=Reflect.apply(json,this,args);}catch(error){if(this===response)fail(row,'body-threw',error);throw error;}
     if(this===response){row.state='consuming';try{Reflect.apply(Promise.prototype.then,result,[value=>{if(!stopped){try{onValue({path,status:response.status,body:structuredClone(value),...(requestIndex===undefined?{}:{requestIndex})});row.state='consumed';}catch(error){fail(row,'observation-failed',error);}}restore();},error=>{fail(row,'body-rejected',error);restore();}]);}catch(error){fail(row,'observation-failed',error);restore();}}
     return result;
    }
    response.json=observedJson;restores.add(restore);
   }catch(error){fail(row,'observation-failed',error);}
  },error=>fail(row,'fetch-rejected',error)]);
  return promise;
 }
 return{observe,snapshot:()=>rows.map(row=>({...row})),restore(){stopped=true;for(const restore of [...restores])restore();}};
}
/* The original first part remains the only human owner. Guitar now identifies
 * that owner through an explicit selected union; it cannot fall back to All. */
function nativeVsqFingeringContext(admitted,settings,instrument) {
 const part='vsq-track-1',selection=settings?.selected_part_ids;
 if(instrument==='guitar'){
  if(settings?.part_id!==null||!Array.isArray(selection)||selection.length!==1||selection[0]!==part)throw Error('Native guitar fingering human selection changed');
 }else if(instrument!=='piano'||settings?.part_id!==part||selection!==undefined)throw Error('Native piano fingering part changed');
 return{score:admitted.compilation.score,timeline:admitted.compilation.timeline,cleanSong:admitted,part_id:settings.part_id,...(instrument==='guitar'?{selected_part_ids:[...selection]}:{}),profile:settings.profile};
}
/* Actual rendered identities only; no controller access, UI writes or solved
 * assignments. Rich guitar cards may be collapsed; the live route is separate. */
function readVsqFingeringState(document,instrument) {
 const $=id=>document.getElementById(id),parse=(node,key)=>JSON.parse(node.dataset[key]||'[]');
 if(instrument==='piano')return{hidden:$('piano-fingering-guidance').hidden,phase:$('piano-fingering-guidance').dataset.phase,cards:[...document.querySelectorAll('#piano-guidance-items .piano-finger-target')].map(node=>({targetId:node.dataset.targetId,sourceIds:parse(node,'sourceIds'),occurrenceIds:parse(node,'occurrenceIds'),hand:node.dataset.hand,label:node.querySelector('.piano-finger-finger').textContent,time:node.querySelector('.piano-finger-time').textContent,title:node.title}))};
 return{hidden:$('guitar-stage').hidden,status:$('guitar-planning').dataset.status,statusText:$('guitar-plan-status').textContent,choices:[...document.querySelectorAll('#guitar-live-route .guitar-live-choice')].flatMap(node=>parse(node,'assignments')),cards:[...document.querySelectorAll('#guitar-guidance-items .guitar-target')].map(node=>({targetId:node.dataset.targetId,startMs:Number(node.dataset.startMs),durationMs:Number(node.dataset.durationMs),sourceIds:parse(node,'sourceIds'),occurrenceIds:parse(node,'occurrenceIds'),route:parse(node,'route')})),recommended:document.querySelectorAll('#fretboard [data-recommended="true"]').length};
}
/* The app deliberately calls hiddenInput.click() from the real Import control.
 * That one untrusted delegation is admitted only inside the owned picker action,
 * paired with one trusted input then change for the approved original fixture. */
function readVsqPickerGesture(document,event=null) {
 const button=document.getElementById?.('import-button'),input=document.getElementById?.('score-file'),dialog=button?.closest?.('dialog'),activation=document.defaultView?.navigator?.userActivation;
 const clock=document.defaultView?.performance,observedAtMs=clock?clock.timeOrigin+clock.now():null;
 const control=node=>node?{id:node.id,tag:node.tagName,type:node.type,disabled:Boolean(node.disabled),connected:Boolean(node.isConnected),inert:Boolean(node.inert)}:null;
 return{observedAtMs,eventTimeMs:event?.timeStamp??null,type:event?.type??'before-action',targetId:event?.target?.id||event?.target?.closest?.('#import-button')?.id||null,trusted:event?event.isTrusted===true:null,button:event?.button??null,buttons:event?.buttons??null,defaultPrevented:event?.defaultPrevented===true,activation:{isActive:activation?.isActive??null,hasBeenActive:activation?.hasBeenActive??null},focus:{hasFocus:document.hasFocus?.()??null,activeId:document.activeElement?.id??null,visibility:document.visibilityState??null},trigger:control(button),input:{...control(input),multiple:input?.multiple??null},dialog:dialog?{id:dialog.id,open:dialog.open,modal:dialog.matches(':modal')}:null};
}
function createVsqControlObserver(document,{readActionSequence=()=>null}={}) {
 const trusted=[],pickers=[],listeners=[];let active=null,activeInput=null;
 function observe(event){
  const trigger=event.target?.closest?.('#import-button'),fingering=event.target?.closest?.('#piano-fingering-replan,#piano-source-hand,#piano-source-finger,#instrument,#guitar-lock-finger,#guitar-lock-fret,#guitar-apply-lock,#guitar-clear-locks'),id=trigger?'import-button':fingering?.id||event.target?.id,part=event.target?.closest?.('.song-mod-part')?.dataset?.partId||event.target?.dataset?.partId||event.target?.dataset?.soloPartId,modField=['performer','instrument','mute','visible'].find(field=>event.target?.hasAttribute?.(`data-mod-${field}`))||null,isFile=id==='score-file'||(activeInput!==null&&event.target===activeInput);
  if(active&&((id==='import-button'&&['pointerdown','pointerup','click'].includes(event.type))||(isFile&&['click','input','change'].includes(event.type)))){if(active.gestures.length>=8)throw Error('VSQ picker gesture bound exceeded');active.gestures.push(readVsqPickerGesture(document,event));}
  if(['pointerdown','pointerup'].includes(event.type)&&id!=='progress')return;
  if(!isFile&&!['vsq-choose-base-notes','play-button','stage-title','bulk-import-save','score-file','import-button','progress','configure-song-mod','edit-song-mod','song-mod-all-human','song-mod-all-machine','song-mod-apply','song-mod-cancel','song-mod-restore','song-mod-layout','song-mod-show-others','start-performance'].includes(id)&&!fingering&&!part)return;
  const row={type:event.type,trusted:event.isTrusted===true,id:id||null,part:part||null,modField,actionSequence:readActionSequence(),code:event.code||null,value:event.target?.value||null,checked:typeof event.target?.checked==='boolean'?event.target.checked:null};
  if(id==='progress')Object.assign(row,{button:event.button??null,eventTimeMs:event.timeStamp??null,observedAtMs:document.defaultView?.performance?.now()??null,observedSequence:trusted.length,actionSequence:readActionSequence()});
  if(isFile){
   const originalControl=Boolean(active&&event.target===activeInput&&activeInput===document.getElementById?.('score-file'));
   if(active&&event.type==='click'&&event.isTrusted===false){if(active.delegatedClicks.length>=1)throw Error('VSQ picker has repeated hidden-input delegation');active.delegatedClicks.push({type:'click',trusted:false,id,sequence:active.sequence,originalControl});return;}
   Object.assign(row,{pickerSequence:active?.sequence??null,originalControl,filename:event.target.files?.[0]?.name??null,fileCount:event.target.files?.length??null,eventTimeMs:Number.isFinite(event.timeStamp)?event.timeStamp:null});
   if(active&&['input','change'].includes(event.type)){const rows=event.type==='input'?active.inputs:active.changes;if(rows.length>=1)throw Error(`VSQ picker has repeated file ${event.type} events`);rows.push({type:event.type,trusted:event.isTrusted===true,id,sequence:active.sequence,originalControl,filename:row.filename,fileCount:row.fileCount,eventTimeMs:row.eventTimeMs});}
  }
  if(trusted.length>=256)throw Error('VSQ event observation bound exceeded');trusted.push(row);
 }
 for(const type of ['pointerdown','pointerup','click','input','change','keydown','keyup']){document.addEventListener(type,observe,true);listeners.push(()=>document.removeEventListener(type,observe,true));}
 return{trusted,pickers,beginPicker(sequence,filename){if(active||pickers.length>=8)throw Error('VSQ picker observation ownership/bound invalid');activeInput=document.getElementById?.('score-file')??null;active={sequence,filename,completed:false,delegatedClicks:[],inputs:[],changes:[],gestures:[readVsqPickerGesture(document)]};pickers.push(active);},endPicker(sequence,completed){if(!active||active.sequence!==sequence)throw Error('VSQ picker observation ownership changed');active.completed=completed;active=null;activeInput=null;},restore(){active=null;activeInput=null;for(const remove of listeners)remove();}};
}
function closeVsqAudioObservers(report,probe,receiver,live) {
 const failed=error=>{report.ok=false;report.errors.push(`VSQ audio observation cleanup: ${String(error).slice(0,512)}`);};
 try{if(probe)report.finalAudio={...probe.snapshot(),worklet:receiver?.status()??null};}catch(error){failed(error);}
 try{if(live){if(!report.ok)report.liveToneFailure=live.failureEvidence();report.liveToneCleanup=live.restore();if(!report.liveToneCleanup.restored||report.liveToneCleanup.errors.length)failed('Live-tone observation failed or cleanup incomplete');}}catch(error){failed(error);}
 try{probe?.restore();}catch(error){failed(error);}
 try{report.receiverCleanup=receiver?.restore()??{restored:false,overflow:false,errors:[],cleanupErrors:[{name:'initialization',message:'Receiver observer unavailable'}]};if(!report.receiverCleanup.restored||report.receiverCleanup.cleanupErrors.length||report.receiverCleanup.errors.length)failed('Receiver observation failed or cleanup incomplete');}catch(error){failed(error);}
}
function assertVsqInputFocus(document,node) {
 if(!node||node.id!=='stage-title'||document.body.dataset.screen!=='stage'||document.hidden||!document.hasFocus()||document.activeElement!==node||document.querySelector('dialog[open]'))throw Error('Prepared VSQ D#4 performance focus was lost');
}
async function prepareVsqInputFocus(document,node,frame) {
 node.scrollIntoView({block:'center',inline:'center'});node.focus();await frame();await frame();assertVsqInputFocus(document,node);
}
function waitVsqSourceOnset({read,bounded,request=requestAnimationFrame,cancel=cancelAnimationFrame}){
 // Read the real UI on its next frame. A second 100 ms polling interval here
 // would consume the existing source-zero scoring window before OS dispatch.
 return bounded(signal=>new Promise((resolve,reject)=>{
  let pending=null,settled=false;
  const finish=(error,value)=>{if(settled)return;settled=true;if(pending!==null)cancel(pending);signal.removeEventListener('abort',aborted);error?reject(error):resolve(value);};
  const aborted=()=>finish(Error('VSQ source-zero wait was canceled'));
  const tick=()=>{pending=null;if(signal.aborted){aborted();return;}try{const state=read();if(state.phase==='capturing'&&state.position>0&&state.cue!=='countdown'){if(state.position>=120)throw Error('VSQ source onset window missed before the physical key');finish(null,state);return;}pending=request(tick);}catch(error){finish(error);}};
  signal.addEventListener('abort',aborted,{once:true});tick();
 }),'VSQ source-zero capture opens',5000);
}
// Read the original element itself, never a replacement found by its ID.
function readVsqControlState(document,node,point=null) {
 const b=node.getBoundingClientRect(),view=document.defaultView,clock=globalThis.__wmhReadPlaybackClock(document),hit=document.elementFromPoint(point?.x??b.x+b.width/2,point?.y??b.y+b.height/2);
 return{target:{x:b.x,y:b.y,width:b.width,height:b.height},width:view.innerWidth,height:view.innerHeight,connected:Boolean(node.isConnected),disabled:Boolean(node.disabled),identity:!node.id||document.getElementById(node.id)===node,hitId:hit?.id||null,hitOwned:hit===node||node.contains(hit),screen:document.body.dataset.screen,playDisabled:Boolean(document.getElementById('play-button')?.disabled),scoreState:document.getElementById('workspace')?.dataset.scoreState??null,practiceGateHidden:document.getElementById('practice-gate')?.hidden??null,feedbackPhase:document.querySelector('.performance-status')?.dataset.phase??null,clock:{positionMs:clock.positionMs,running:clock.running,completed:clock.completed,phase:clock.phase}};
}
/* Admission belongs to the start of a real pointer gesture. Range input can
 * pause/seek and repaint before its final click; retain that later state too. */
function requireVsqPointerDown(control) {
 const assert=(value,message)=>{if(!value)throw Error(`VSQ pointerdown admission: ${message}`);},rows=control.pointerDown,request=control.request;
 assert(rows.length===1,'exactly one real pointerdown required');const event=rows[0],state=event.state;
 assert(event.order===0&&event.sequence===request.sequence&&event.trusted&&event.owned,'first trusted event must hit the original control');
 assert(event.button===0&&event.buttons===1&&event.isPrimary&&event.pointerType==='mouse'&&Number.isSafeInteger(event.pointerId)&&event.pointerId>=0,'primary mouse pointer metadata required');
 assert(state.connected&&!state.disabled&&state.identity&&state.hitOwned,'original control changed before pointerdown');
 assert(JSON.stringify(state.target)===JSON.stringify(request.target)&&state.width===request.width&&state.height===request.height,'requested geometry changed before pointerdown');
 const {clientX:x,clientY:y}=event,b=state.target;
 assert(Number.isFinite(x)&&Number.isFinite(y)&&Math.abs(x-request.x)<=1&&Math.abs(y-request.y)<=1&&x>=b.x&&x<b.x+b.width&&y>=b.y&&y<b.y+b.height,'actual pointerdown missed requested center');
 if(Object.hasOwn(control.samples.at(-1),'committed')&&state.clock.completed)assert(!state.playDisabled&&['listen','assessed','review','empty'].includes(state.feedbackPhase),'completed stage was not ready at pointerdown');
}
(() => {
 const phase=globalThis.__WMH_ACCEPTANCE_PHASE__,$=id=>document.getElementById(id),assert=(v,m)=>{if(!v)throw Error(m);};
 const originalFetch=globalThis.fetch,fetcher=originalFetch.bind(globalThis),waits=createAcceptanceWait(),json=(path,body,milliseconds=10000)=>waits.json(fetcher,path,body===undefined?undefined:{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)},milliseconds);
 let sequence=0;
 const controls=createVsqControlObserver(document,{readActionSequence:()=>sequence});
 const report={version:1,phase,origin:location.origin,ok:false,stage:'initialization',checks:[],errors:[],requests:[],imports:[],runtimeResponses:[],assessmentRequests:[],assessmentResponses:[],trusted:controls.trusted,pickerObservations:controls.pickers,files:{},screenshots:{},diagnostics:[],controlActions:[],fingering:{version:1,responses:[],observations:[],samples:[],actions:[],stale:null}};
 let probe,receiver,live,follow,requestObservationActive=true,fingeringObservationActive=false;
 const checkpoint=stage=>{report.stage=stage;assert(report.diagnostics.length<48,'VSQ diagnostic stage bound exceeded');report.diagnostics.push({stage,elapsedMs:performance.now()});};
 const until=(condition,label,ms=10000)=>waits.until(signal=>{receiver?.assertHealthy();live?.assertHealthy();return condition(signal);},`VSQ ${report.stage}: ${label}`,ms);
 const closeDialogs=()=>{for(const d of document.querySelectorAll('dialog[open]'))d.close();};
 const click=id=>{assert($(id)&&!$(id).disabled,`Unavailable control ${id}`);$(id).click();};
 const menu=createAcceptanceNavigation({document,until,click});
 const frame=()=>new Promise(requestAnimationFrame);
 const responses=createVsqJsonObserver({onValue:row=>{const list=row.path==='/api/library/runtime'?report.runtimeResponses:report.imports;assert(list.length<8,'VSQ response observation bound exceeded');list.push(row);},onError:message=>report.errors.push(message)});
 const assessments=createVsqJsonObserver({maxRows:4,onValue:row=>report.assessmentResponses.push(row),onError:message=>report.errors.push(message)});
 const fingeringResponses=createVsqJsonObserver({maxRows:12,onValue:row=>report.fingering.responses.push(row),onError:message=>report.errors.push(message)});
 const observedFetch=function(...args){const promise=Reflect.apply(originalFetch,this,args);if(!requestObservationActive)return promise;try{const route=String(args[0]);if(route.startsWith('/api/')){
  assert(report.requests.length<128,'VSQ API observation exceeded 128 requests');let body=null;if(typeof args[1]?.body==='string')body=JSON.parse(args[1].body);const requestIndex=report.requests.length;report.requests.push({path:route,body});
  if(route==='/api/assess'){report.assessmentRequests.push(body);assessments.observe(route,promise,requestIndex);}
  if(['/api/library/import/preview','/api/library/import/commit','/api/library/runtime'].includes(route))responses.observe(route,promise);
  if(fingeringObservationActive&&['/api/library/fingering/piano','/api/library/fingering/guitar'].includes(route))fingeringResponses.observe(route,promise,requestIndex);
 }}catch(error){report.errors.push(`VSQ request observation: ${String(error).slice(0,512)}`);}return promise;};globalThis.fetch=observedFetch;
 const onError=event=>report.errors.push(String(event.message)),onRejection=event=>report.errors.push(String(event.reason));addEventListener('error',onError);addEventListener('unhandledrejection',onRejection);
 async function native(kind,node,file){
  assert(node,'VSQ native control unavailable');const pointer=kind!=='capture'&&kind!=='key-ds4',deadline=pointer?performance.now()+15000:null;let control,observer,removeDispatch,removeDown,pickerStarted=false,completed=false,actionSequence,firstError;
  const remaining=()=>{const milliseconds=deadline-performance.now();assert(milliseconds>0,'VSQ owned control exceeded its original 15000ms action budget');return milliseconds;};
  const controlUntil=(condition,label,milliseconds=10000)=>until(signal=>{remaining();return condition(signal);},label,Math.min(milliseconds,remaining()));
  try{
   if(kind==='capture'){
    assert(!node.disabled,'VSQ passive surface unavailable');assert(globalThis.devicePixelRatio===1&&(!globalThis.visualViewport||globalThis.visualViewport.scale===1),'Passive capture requires unit renderer scale');assert(node.id==='notation-lane-overlay'&&!document.hidden&&document.hasFocus()&&!document.querySelector('dialog[open]'),'Passive capture requires the visible focused stage');observeVsqFollowingSurface(document);
   }else if(kind==='key-ds4')assertVsqInputFocus(document,node);
   else{
    assert(report.controlActions.length<80,'VSQ owned control evidence bound exceeded');control={sequence:sequence+1,kind,id:node.id||null,before:readVsqControlState(document,node),samples:[],pointerDown:[],dispatch:[]};report.controlActions.push(control);
    assert(control.before.identity,'VSQ original control was replaced');
    control.readiness=await waitCanonicalPracticeControl({document,node,until:controlUntil,readClock:()=>globalThis.__wmhReadPlaybackClock(document)});
    node.scrollIntoView({block:'center',inline:'center'});node.focus();await waits.bounded(async()=>{await frame();await frame();},'VSQ control preparation frames',remaining());
    await waits.bounded(()=>prepareCanonicalPracticeTarget({document,node,onSample:value=>control.samples.push(value)}),'VSQ committed control layout',remaining());
   }
   const b=node.getBoundingClientRect(),x=b.x+b.width/2,y=b.y+b.height/2,hit=document.elementFromPoint(x,y);
   assert(b.width>0&&b.height>0,'VSQ target is not visible');assert(x>0&&x<innerWidth&&y>0&&y<innerHeight,`VSQ control ${node.id||node.tagName} remains outside viewport after scrolling`);
   if(kind!=='capture')assert(hit===node||node.contains(hit),`VSQ control ${node.id||node.tagName} is obscured after scrolling`);
   assert(sequence<80,'VSQ action count exceeded');
   if(pointer){control.preDispatch=readVsqControlState(document,node);assert(control.preDispatch.connected&&!control.preDispatch.disabled&&control.preDispatch.identity&&control.preDispatch.hitOwned,'VSQ original control changed before dispatch');assert(JSON.stringify(control.preDispatch.target)===JSON.stringify(control.samples.at(-1).target),'VSQ control moved after its stable layout sample');}
   const action={version:1,sequence:++sequence,kind,x,y,width:innerWidth,height:innerHeight,...(file?{file}:{}),...(kind==='capture'?{devicePixelRatio:globalThis.devicePixelRatio}:{})};actionSequence=sequence;
   if(control){
    control.request={...action,target:{x:b.x,y:b.y,width:b.width,height:b.height}};observer=observeCanonicalPracticeOwnedClick({document,node,sequence});control.clicks=observer.events;
    let eventOrder=0;
    const record=event=>{
     const order=eventOrder++,down=event.type==='pointerdown',rows=down?control.pointerDown:control.dispatch;
     if(rows.length<(down?2:5))rows.push({sequence:actionSequence,id:event.target?.id||null,owned:event.target===node||node.contains(event.target),trusted:event.isTrusted===true,clientX:event.clientX,clientY:event.clientY,order,...(down?{button:event.button,buttons:event.buttons,isPrimary:event.isPrimary,pointerId:event.pointerId,pointerType:event.pointerType,control:{id:node.id||null,tag:node.tagName,type:node.type||null}}:{}),state:readVsqControlState(document,node,{x:event.clientX,y:event.clientY})});
    };
    document.addEventListener('pointerdown',record,true);removeDown=()=>document.removeEventListener('pointerdown',record,true);
    document.addEventListener('click',record,true);removeDispatch=()=>document.removeEventListener('click',record,true);
   }
   if(kind==='picker'){controls.beginPicker(sequence,file);pickerStarted=true;}
   await json('/__desktop_smoke/action',action,pointer?Math.min(10000,remaining()):10000);let result;
   await (pointer?controlUntil:until)(async signal=>{const response=await fetcher(`/__desktop_smoke/result/${actionSequence}`,{signal});if(response.status===404)return false;result=await response.json();assert(response.ok,result.error||'VSQ action result failed');return true;},`native ${kind} #${actionSequence}`,15000);
   assert(result.ok,result.error||'VSQ native action failed');
   if(control){control.afterDispatch=readVsqControlState(document,node);requireVsqPointerDown(control);await requireCanonicalPracticeOwnedClick({until:async(condition,label)=>{remaining();assert(await condition(),`VSQ ${label}: no trusted owned click received before host completion`);},events:observer.events,sequence:actionSequence,id:node.id,kind});}
   completed=true;return actionSequence;
  }catch(error){firstError=error;if(control)control.error=String(error).slice(0,512);throw error;}
  finally{
   const cleanupErrors=[],attempt=(name,operation)=>{try{operation();}catch(error){cleanupErrors.push({name,error:String(error).slice(0,512)});}};
   if(control&&!control.afterDispatch)attempt('after-dispatch-snapshot',()=>{control.afterDispatch=readVsqControlState(document,node);});
   attempt('owned-click-observer',()=>observer?.restore());attempt('pointerdown-observer',()=>removeDown?.());attempt('dispatch-observer',()=>removeDispatch?.());
   if(pickerStarted&&!completed)attempt('owned-picker',()=>controls.endPicker(actionSequence,false));
   if(cleanupErrors.length){if(control)control.cleanupErrors=cleanupErrors;if(!firstError)throw Error(`VSQ control observation cleanup failed: ${JSON.stringify(cleanupErrors)}`);}
  }
 }
 const mod=createAcceptanceSongMod({document,native,until});
 const inventory=async()=>{const value=await json('/api/library/list');assert(value.storage==='native-filesystem'&&value.issues.length===0,'VSQ native inventory incomplete');return value;};
 const ready=()=>$('bulk-import-dialog').open&&$('bulk-import-dialog').dataset.phase==='review';
 async function choose(file){closeDialogs();click('import-tools-button');const before=report.imports.length;let pickerSequence,completed=false;try{pickerSequence=await native('picker',$('import-button'),file);await until(()=>ready()&&report.imports.length>before,'chooser preflight response');assert(report.imports.at(-1).path.endsWith('/preview'),'VSQ chooser bypassed preflight');completed=true;}finally{if(pickerSequence)controls.endPicker(pickerSequence,completed);}}
 async function save(){const before=report.imports.length;await native('click',$('bulk-import-save'));await until(()=>ready()&&report.imports.length>before&&report.imports.at(-1).path.endsWith('/commit'),'save response');}
 async function download(node){const before=(await json('/__desktop_smoke/state')).downloads.length;await native('click',node);let row;await until(async()=>{row=(await json('/__desktop_smoke/state')).downloads[before];return row?.complete;},'download completion');assert(row.success,'VSQ download failed');return row.file;}
 async function take(){closeDialogs();click('results-button');const file=await download($('export-takes'));closeDialogs();return file;}
 const audio=()=>({...probe.snapshot(),worklet:receiver.status()});
 async function silence(label){await until(()=>audio().activeSources===0&&audio().pendingSources===0&&receiver.quiet(),label,5000);return audio();}
 function choiceState(){return{preview:$('song-lobby').dataset.previewStatus,startDisabled:$('start-performance').disabled,modDisabled:$('configure-song-mod').disabled,fullVocalDisabled:$('vsq-full-vocal').disabled,fullVocalVisible:!$('vsq-full-vocal').hidden&&$('vsq-full-vocal').getBoundingClientRect().width>0,choiceVisible:!$('vsq-choose-base-notes').hidden,limits:$('vsq-interpretation-limits').children.length,tracks:[...$('clean-song-tracks').children].map(n=>n.textContent),audio:audio(),runtimeRequests:report.runtimeResponses.length};}
 async function select(entry){await until(()=>$('catalog').querySelector(`[data-library-key="native:${entry.key}"]`),'stored nonplayable song row');await native('click',$('catalog').querySelector(`[data-library-key="native:${entry.key}"]`));await until(()=>$('song-lobby').dataset.previewStatus==='choice','explicit interpretation choice');const state=choiceState();assert(state.startDisabled&&state.modDisabled&&state.fullVocalDisabled&&state.fullVocalVisible&&state.choiceVisible&&state.limits===8&&state.tracks.length===2,'VSQ choice UI incomplete');return state;}
 async function start(mode){
  const started=receiver.status().started;await mod.start(mode==='listen'?'none':['vsq-track-1'],{layout:'solo',muted:{'vsq-track-1':false,'vsq-track-2':false}});
  // A start ACK admits a future anchor. Reset only after the source clock and
  // playing status are published, so the initial cue cannot move its target.
  await until(()=>{const audio=receiver.status(),clock=globalThis.__wmhReadPlaybackClock(document);return document.body.dataset.screen==='stage'&&!$('play-button').disabled&&$('clean-song-stage').dataset.rendererState==='playing'&&clock.phase==='playing'&&clock.positionMs>0&&audio.started===started+1&&audio.pendingReceivers===0&&audio.ownedNodes.some(node=>node.state==='running'&&node.connected&&!node.disposed&&!node.disposing&&node.pendingCommands===0&&node.pendingStarts===0);},`${mode} audio-thread stage admission`,10000);
 }
 async function reset(){await native('click',$('reset-button'));await until(()=>globalThis.__wmhReadPlaybackClock(document).positionMs===0&&!$('play-button').disabled,'transport reset');}
 addEventListener('DOMContentLoaded',async()=>{
  try {await prepareNativePlaybackClock({document,until});
   assert(['vsq-seed','vsq-restart'].includes(phase),'Unknown VSQ phase');assert(localStorage.getItem('wmh.vsq.acceptance.marker')===null,'VSQ needs a fresh browser profile');report.profileMarkerAbsent=true;localStorage.setItem('wmh.vsq.acceptance.marker',phase);
   await menu.enterLibrary();const {getAppI18n}=await import('/app-locale.js');getAppI18n(document).setLocale('en');assert((await json('/api/health')).network==='native-protocol-no-listener','VSQ requires actual native protocol');probe=observeNativeReferenceAudio();receiver=await observeBasicKeyReceiver(document);live=await observeLiveToneAudio(document,{keyCode:'KeyU',midi:63,readSource:()=>receiver.status()});
   if(phase==='vsq-seed'){
    checkpoint('chooser-preflight');assert((await inventory()).entries.length===0,'VSQ seed requires empty Scores');await choose('vsq-authored-song.zip');const preflight=report.imports.at(-1).body,item=preflight.items[0];assert(preflight.summary.ready===1&&item.playable===false&&item.clean_package?.coverage?.project?.tracks===2&&item.clean_package.coverage.project.notes===2,'VSQ preflight omitted tracks or granted playback');assert((await inventory()).entries.length===0,'VSQ preflight wrote storage');report.preflight={status:item.status,playable:item.playable,coverage:item.clean_package.coverage};report.screenshots.preflight=await native('click',$('bulk-import-title'));
    checkpoint('save-package');await save();assert(report.imports.at(-1).body.summary.saved===1&&report.imports.at(-1).body.items[0].playable===false,'VSQ save failed or implicitly granted playback');await native('click',$('bulk-import-done'));report.checks.push('chooser-preflight-all-tracks-save');
   }
   checkpoint('select-explicit-choice');const list=await inventory();assert(list.entries.length===1,'VSQ native library must contain one song');const entry=list.entries[0];report.inventory=list.entries;report.directory=list.directory;report.beforeChoice=await select(entry);assert(report.beforeChoice.audio.sourceStarts===0&&report.runtimeResponses.length===0,'Selecting VSQ started audio/runtime');report.opened=await json('/api/library/load',{key:entry.key});assert(report.opened.clean_package.runtime===null,'VSQ open compiled implicit runtime');report.screenshots.choice=await native('click',$('clean-song-preview-status'));getAppI18n(document).setLocale('zh-CN');report.chineseChoice={button:$('vsq-choose-base-notes').textContent,vocal:$('vsq-full-vocal').textContent,description:$('vsq-practice-description').textContent,limits:[...$('vsq-interpretation-limits').children].map(n=>n.textContent)};assert(report.chineseChoice.button.includes('基础音符器乐练习')&&report.chineseChoice.vocal.includes('不可用')&&report.chineseChoice.limits.length===8,'Chinese VSQ choice or limits missing');report.screenshots.choiceZh=await native('click',$('clean-song-preview-status'));getAppI18n(document).setLocale('en');
   await native('click',$('vsq-choose-base-notes'));await until(()=>{assert(report.errors.length===0,report.errors.join('; '));return report.runtimeResponses.length===1;},'application consumed explicit base-note response');await until(()=>$('song-lobby').dataset.previewStatus==='ready'&&!$('start-performance').disabled&&!$('configure-song-mod').disabled,'ready choice UI after consumed response');report.afterChoice=choiceState();assert(report.afterChoice.audio.sourceStarts===0,'VSQ explicit choice auto-started audio');report.checks.push('stored-nonplayable-explicit-choice-no-autoaudio');
   const runtime=report.runtimeResponses[0].body;assert(runtime.reference_velocity===90&&runtime.runtime.notes.every(n=>n.dynamics===0),'VSQ native reference inventory changed');assert(runtime.navigation.profile==='wmh-vsq-practice-navigation-v1','VSQ native following absent');
   closeDialogs();click('settings-button');if($('count-in').checked)await native('click',$('count-in'));closeDialogs();
   checkpoint('listen-setup');await start('listen');await reset();if($('notation-toggle').getAttribute('aria-expanded')!=='true')await native('click',$('notation-toggle'));await until(()=>$('written-cursor-status').dataset.status==='ready','native following admission');
   checkpoint('listen-native-following');follow=createVsqFollowingObserver(document);const beforeListen=receiver.count();await native('click',$('play-button'));await until(()=>receiver.status().started>beforeListen&&globalThis.__wmhReadPlaybackClock(document).positionMs>0,'real audio-thread reference scheduling',5000);report.listenAudio=audio();report.followingCapture={before:{frame:readVsqFollowingFrame(document),audio:audio()}};report.screenshots.following=await native('capture',$('notation-lane-overlay'));report.followingCapture.after={frame:readVsqFollowingFrame(document),audio:audio()};report.followingSurface=observeVsqFollowingSurface(document);for(const sample of Object.values(report.followingCapture))assert(sample.frame.renderer==='playing'&&sample.frame.positionMs>0&&sample.frame.ids.length>0&&sample.audio.worklet.activeReceivers>0,'VSQ following screenshot missed the live native-note interval');await until(()=>nativePlaybackEnded(runtime.runtime.end_ms),'native playback end',7000);follow.stop();report.following=follow.rows;follow=null;report.listenStopped=await silence('listen completion source cleanup');report.listenThread=receiver.snapshot().slice(beforeListen);report.checks.push('listen-real-reference-native-following');
   checkpoint('pause-cleanup');await reset();const beforePause=receiver.count();await native('click',$('play-button'));await until(()=>globalThis.__wmhReadPlaybackClock(document).positionMs>0,'pause pass started',5000);await native('click',$('play-button'));await until(()=>$('clean-song-stage').dataset.rendererState==='paused','paused renderer',5000);report.pauseAudio=await silence('pause source cleanup');const paused=globalThis.__wmhReadPlaybackClock(document).positionMs;await frame();await frame();report.pauseClock={before:paused,after:globalThis.__wmhReadPlaybackClock(document).positionMs};report.pauseThread=receiver.snapshot().slice(beforePause);assert(report.pauseClock.before===report.pauseClock.after,'Paused clock moved');if(phase==='vsq-restart'){
    await native('click',$('play-button'));await until(()=>nativePlaybackEnded(runtime.runtime.end_ms),'resumed native end',7000);await silence('resumed receiver cleanup');report.resumeThread=receiver.snapshot().slice(beforePause);
    checkpoint('listen-seek-tail');await reset();const seekSnapshot=()=>({...readVsqSeekState(document),audio:audio()});report.seek={};
    await observeVsqTailSeek({document,endMs:runtime.runtime.end_ms,lastNoteEndMs:Math.max(...runtime.runtime.notes.map(note=>note.end_ms)),native,until,frame,snapshot:seekSnapshot,events:report.trusted,evidence:report.seek});
    report.seekPositionMs=report.seek.beforePlay.positionMs;const beforeSeek=receiver.count();report.seek.playEventStart=report.trusted.length;report.seek.playAction=await native('click',$('play-button'));report.seek.playEventEnd=report.trusted.length;await until(()=>nativePlaybackEnded(runtime.runtime.end_ms)&&$('clean-song-stage').dataset.rendererState==='ended','seeked native end',7000);await silence('seeked receiver cleanup');report.seek.completed=seekSnapshot();report.seekThread=receiver.snapshot().slice(beforeSeek);
    await reset();await mod.configure([],{muted:{'vsq-track-2':true}});const beforeSolo=receiver.count();await native('click',$('play-button'));await until(()=>nativePlaybackEnded(runtime.runtime.end_ms),'solo native end',7000);await silence('solo receiver cleanup');report.soloThread=receiver.snapshot().slice(beforeSolo);await mod.configure([],{muted:{'vsq-track-2':false}});
   }
   await menu.returnToLibrary();report.navigationAudio=await silence('navigation source cleanup');report.checks.push('pause-navigation-cleanup');
   checkpoint('practice-part-controls');await start('practice');await reset();report.practiceSeek=readVsqSeekState(document);assert(report.practiceSeek.control.disabled===true&&report.practiceSeek.control.describedBy?.split(/\s+/).includes('progress-help')&&report.practiceSeek.control.guidance?.trim(),'Practice seek must be disabled with explicit guidance');
   const initial='vsq-track-1',target='vsq-track-2',other=initial;assert($('clean-song-target').value===initial,'Initial VSQ Mod human part differs');await mod.configure([target],{layout:'solo',muted:{[other]:true}});await until(()=>$('clean-song-target').value===target&&!$('play-button').disabled,'Mod human target selection');const human=document.querySelector(`#clean-song-parts input[data-part-id="${target}"]`),machine=document.querySelector(`#clean-song-parts input[data-part-id="${other}"]`);assert(human.disabled&&!human.checked&&!machine.checked&&!machine.disabled,'VSQ human and muted accompaniment separation failed');
   if(phase==='vsq-restart'){const beforeMuted=receiver.count();report.mutedAdmission={before:{count:beforeMuted,started:receiver.status().started,frame:readVsqFollowingFrame(document)}};await native('click',$('play-button'));await until(()=>{report.mutedAdmission.after={count:receiver.count(),started:receiver.status().started,frame:readVsqFollowingFrame(document)};return report.mutedAdmission.after.started>beforeMuted&&report.mutedAdmission.after.frame.positionMs>0;},'zero-voice muted plan started');assert($('hud-captured').textContent==='0','Muted machine became input');await native('click',$('play-button'));await silence('muted receiver cleanup');report.mutedThread=receiver.snapshot().slice(beforeMuted);}
   await mod.open();await mod.choose([target],{muted:{[other]:false}});report.screenshots.parts=await native('click',$('song-mod-title'));await mod.apply();assert(machine.checked,'VSQ Mod accompaniment restore did not apply');report.controls={initial,target,other,humanDisabled:human.disabled,humanMachineEnabled:human.checked,otherRestored:machine.checked};
   checkpoint('machine-input-separation');await reset();const beforeMachine=receiver.count();await native('click',$('play-button'));await until(()=>receiver.status().started>beforeMachine&&globalThis.__wmhReadPlaybackClock(document).positionMs>0,'machine audio-thread accompaniment scheduled',5000);report.machinePlaying={captured:$('hud-captured').textContent,audio:audio(),positionMs:globalThis.__wmhReadPlaybackClock(document).positionMs};assert(report.machinePlaying.captured==='0','Accompaniment became input');await native('click',$('play-button'));await until(()=>$('clean-song-stage').dataset.rendererState==='paused','machine-only pass paused',5000);report.machineStopped=await silence('machine pause cleanup');report.machineThread=receiver.snapshot().slice(beforeMachine);report.files.machineTake=await take();report.checks.push('human-target-machine-input-separation');
   if(phase==='vsq-seed'){
    checkpoint('trusted-human-input');await reset();closeDialogs();click('settings-button');assert(!$('count-in').disabled,'VSQ count-in must remain available');if(!$('count-in').checked)await native('click',$('count-in'));closeDialogs();
    const beforeHuman=receiver.count(),trace=observeNativeReferenceTransport(document,{keyCode:'KeyU'});
    try{
     trace.changed('ready',{checkpoint:true});const playAction=await native('click',$('play-button'));await until(()=>trace.counts().trustedPlayClicks===1&&receiver.status().started>beforeHuman&&$('stage-cue').dataset.cueState==='countdown','accepted VSQ count-in',5000);
     await prepareVsqInputFocus(document,$('stage-title'),frame);assert($('stage-cue').dataset.cueState==='countdown','VSQ count-in ended before input focus was prepared');trace.changed('key-focus-ready',{checkpoint:true});live.begin();
     report.keyPreparation={playAction,timeOrigin:performance.timeOrigin,readyWallMs:performance.now(),readyPositionMs:globalThis.__wmhReadPlaybackClock(document).positionMs,readyCue:$('stage-cue').dataset.cueState,focused:document.hasFocus(),activeElement:document.activeElement.id,countInMs:4*60000/Number($('tempo').value)};
     await waitVsqSourceOnset({bounded:waits.bounded,read:()=>{receiver.assertHealthy();assertVsqInputFocus(document,$('stage-title'));return{phase:trace.state().phase,position:globalThis.__wmhReadPlaybackClock(document).positionMs,cue:$('stage-cue').dataset.cueState};}});assert(globalThis.__wmhReadPlaybackClock(document).positionMs<120,'VSQ source onset window missed before the physical key');
     const mapping=document.querySelector('#keyboard [data-midi="63"] .key-shortcut')?.textContent;assert(mapping==='U','Visible VSQ D#4 mapping must be KeyU');report.keyPreparation.mapping=mapping;report.keyPreparation.dispatchWallMs=performance.now();report.keyPreparation.dispatchPositionMs=globalThis.__wmhReadPlaybackClock(document).positionMs;report.keyPreparation.keyAction=await native('key-ds4',$('stage-title'));
     await until(()=>trace.counts().trustedKeyDowns===1&&trace.counts().trustedKeyUps===1&&$('hud-captured').textContent==='1','one trusted VSQ onset',5000);await until(()=>live.settled(),'trusted D#4 token PCM and fixed live output');report.humanLiveAudio=live.finish();await native('click',$('play-button'));await until(()=>trace.counts().trustedPlayClicks===2&&$('stage-cue').dataset.cueState==='paused','trusted practice pause',5000);report.transportAdmission=trace.snapshot('complete');
    }finally{trace.stop();}
    await silence('human pause cleanup');await native('click',$('play-button'));await until(()=>nativePlaybackEnded(runtime.runtime.end_ms)&&report.assessmentResponses.length===1&&!$('feedback-results').hidden,'VSQ actual selected-part assessment',10000);await silence('complete human receiver cleanup');report.humanThread=receiver.snapshot().slice(beforeHuman);report.completePractice={accuracy:$('accuracy').textContent,positionMs:globalThis.__wmhReadPlaybackClock(document).positionMs,captured:$('hud-captured').textContent,clock:globalThis.__wmhReadPlaybackClock(document)};report.files.humanTake=await take();report.checks.push('trusted-human-input');
    checkpoint('exact-package-export');await menu.returnToLibrary();closeDialogs();click('import-tools-button');click('bulk-import-history-button');if(!$('bulk-import-history').open)await native('click',$('bulk-import-history').querySelector('summary'));await until(()=>document.querySelector('#bulk-import-export-songs input'),'VSQ export selection');await native('click',$('bulk-import-export-all'));report.files.package=await download($('bulk-import-export-pack'));await native('click',$('bulk-import-done'));report.checks.push('complete-package-export');
   }else await menu.returnToLibrary();
   checkpoint('native-fingering-setup');await start('practice');await reset();await until(()=>$('piano-fingering-guidance').dataset.phase==='ready','initial native piano guidance');assert($('clean-song-target').value==='vsq-track-1','Fingering fixture needs its original first part');
   if(!$('piano-fingering-guidance').open)await native('click',$('piano-fingering-guidance').querySelector('summary'));
   await native('click',$('piano-guidance-settings'));await until(()=>$('settings-dialog').open,'piano settings visible');const editor=document.querySelector('#piano-fingering-settings .piano-lock-editor');if(!editor.open)await native('click',editor.querySelector('summary'));
   const [{prepareCleanSong,prepareVsqPractice},{fingeringSource,fingeringResponse},{validatePianoFingering},{validateGuitarFingering}]=await Promise.all([import('/clean-song-package.js'),import('/fingering-source.js'),import('/piano-fingering.js'),import('/guitar-fingering.js')]);
   const admitted=prepareVsqPractice(prepareCleanSong(`native:${entry.key}`,report.opened.clean_package,JSON.parse(report.opened.score_json)),runtime);
   const context=(settings,instrument)=>nativeVsqFingeringContext(admitted,settings,instrument);
   async function guidanceAction(kind,id){const control=$(id),before=report.requests.length,n=await native(kind,control);report.fingering.actions.push({sequence:n,kind,id,value:control.value||null});return before;}
   async function guidanceResponse(from,instrument,status){let row;await until(()=>{assert(report.errors.length===0,report.errors.join('; '));row=report.fingering.responses.filter(row=>row.requestIndex>=from&&row.path===`/api/library/fingering/${instrument}`).at(-1);return row&&$(instrument==='piano'?'piano-fingering-guidance':'guitar-planning').dataset[instrument==='piano'?'phase':'status']===(status==='ready'?'ready':status);},`${instrument} ${status} consumed response and rendered state`);assert(row.status===200,'Native fingering route failed');const request=report.requests[row.requestIndex],ctx=context(request.body.settings,instrument),plan=fingeringResponse(row.body,fingeringSource(ctx));(instrument==='piano'?validatePianoFingering:validateGuitarFingering)(plan,ctx,request.body.settings);assert(plan.status===status,`Original fixture ${instrument} expected ${status}; received ${plan.status}`);await frame();await frame();return row;}
   function guidanceSample(label,instrument,row){report.fingering.samples.push({label,requestIndex:row.requestIndex,instrument,positionMs:globalThis.__wmhReadPlaybackClock(document).positionMs,partId:$('clean-song-target').value,dom:readVsqFingeringState(document,instrument)});}
   fingeringObservationActive=true;
   let from=await guidanceAction('click','piano-fingering-replan'),row=await guidanceResponse(from,'piano','ready');guidanceSample('piano-base','piano',row);
   checkpoint('native-piano-lock');from=await guidanceAction('select-last','piano-source-hand');await guidanceResponse(from,'piano','ready');from=await guidanceAction('select-last','piano-source-finger');row=await guidanceResponse(from,'piano','ready');assert($('piano-source-hand').value==='right'&&$('piano-source-finger').value==='5','Native piano lock controls changed');
   await native('click',document.querySelector('#settings-dialog [data-close-panel="settings"]'));report.screenshots.pianoFingering=await native('click',$('piano-guidance-items'));guidanceSample('piano-lock','piano',row);
   checkpoint('native-guitar-lock');await native('click',$('settings-button'));from=await guidanceAction('select-last','instrument');row=await guidanceResponse(from,'guitar','ready');await native('click',document.querySelector('#settings-dialog [data-close-panel="settings"]'));guidanceSample('guitar-base','guitar',row);
   report.fingering.stale={instrument:$('instrument').value,pianoHidden:$('piano-fingering-guidance').hidden,pianoPhase:$('piano-fingering-guidance').dataset.phase,pianoCards:$('piano-guidance-items').children.length,pianoBadges:document.querySelectorAll('#keyboard .piano-finger-label,#keyboard [data-finger-guidance]').length};assert(report.fingering.stale.pianoHidden&&report.fingering.stale.pianoPhase!=='ready'&&report.fingering.stale.pianoCards===0&&report.fingering.stale.pianoBadges===0,'Changed instrument retained stale piano guidance');
   if(!$('guitar-plan-controls').open)await native('click',$('guitar-plan-controls').querySelector('summary'));await guidanceAction('select-last','guitar-lock-finger');from=await guidanceAction('click','guitar-apply-lock');row=await guidanceResponse(from,'guitar','ready');report.screenshots.guitarFingering=await native('click',$('guitar-live-route'));guidanceSample('guitar-lock','guitar',row);
   checkpoint('native-guitar-infeasible');await guidanceAction('select-last','guitar-lock-fret');from=await guidanceAction('click','guitar-apply-lock');row=await guidanceResponse(from,'guitar','infeasible_under_model');report.screenshots.guitarInfeasible=await native('click',$('guitar-plan-status'));guidanceSample('guitar-infeasible','guitar',row);
   from=await guidanceAction('click','guitar-clear-locks');row=await guidanceResponse(from,'guitar','ready');guidanceSample('guitar-restored','guitar',row);fingeringObservationActive=false;report.checks.push('native-fingering-clock-locks-infeasible-stale');if(phase==='vsq-restart'){const beforeGuitar=receiver.count();await native('click',$('play-button'));await until(()=>receiver.status().started>beforeGuitar&&globalThis.__wmhReadPlaybackClock(document).positionMs>0,'guitar recipe started');assert($('hud-captured').textContent==='0','Guitar reference became input');await native('click',$('play-button'));await silence('guitar receiver cleanup');report.guitarThread=receiver.snapshot().slice(beforeGuitar);}await menu.returnToLibrary();
   checkpoint('reload-choice-reset');const beforeReload=report.runtimeResponses.length;report.reloadChoice=await select(entry);assert(report.reloadChoice.runtimeRequests===beforeReload&&report.reloadChoice.audio.activeSources===0&&report.reloadChoice.audio.pendingSources===0,'Reload retained or auto-compiled interpretation');const reopened=await json('/api/library/load',{key:entry.key});assert(reopened.clean_package.runtime===null,'Reload runtime choice persisted');report.checks.push('reload-requires-choice');
   assert(report.requests.filter(r=>r.path==='/api/notation-navigation'&&r.body?.id===entry.score_id).length===0,'VSQ used generic BPM navigation');assert(report.runtimeResponses.length===1,'VSQ choice count changed');assert(report.errors.length===0,report.errors.join('; '));report.actions=sequence;report.modActions=mod.history;report.downloads=(await json('/__desktop_smoke/state')).downloads;checkpoint('complete');report.ok=true;
  } catch(error){report.error=String(error);report.failureStage=report.stage;}
  finally{report.assessmentObservations=assessments.snapshot();assessments.restore();report.fingering.observations=fingeringResponses.snapshot();fingeringResponses.restore();fingeringObservationActive=false;follow?.stop();closeVsqAudioObservers(report,probe,receiver,live);report.responseObservations=responses.snapshot();responses.restore();controls.restore();requestObservationActive=false;removeEventListener('error',onError);removeEventListener('unhandledrejection',onRejection);if(globalThis.fetch===observedFetch)globalThis.fetch=originalFetch;}
  try{assert(new TextEncoder().encode(JSON.stringify(report)).length<=1024*1024,'VSQ report exceeds 1 MiB');await json('/__desktop_smoke/report',report);}catch(error){await json('/__desktop_smoke/report',{version:1,phase,ok:false,error:'VSQ report delivery failed',failureStage:report.stage,detail:String(error).slice(0,512)});}
 },{once:true});
})();
