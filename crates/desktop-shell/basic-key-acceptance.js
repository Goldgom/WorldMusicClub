/* Process-owned original basic-key receiver proof. Real app/native APIs, OS
 * chooser, transport and keyboard only. Observers forward real audio/fetch. */
function describeBasicKeyNativeTarget(node,bounds,hit) {
 const identity=element=>String(element?.id||element?.tagName||'none').slice(0,96);
 const coordinate=value=>Number.isFinite(value)?Math.round(value*100)/100:null;
 return JSON.stringify({target:identity(node),bounds:Object.fromEntries(['x','y','width','height'].map(key=>[key,coordinate(bounds[key])])),hit:identity(hit)});
}
function visibleBasicKeyPage(document,responses,partId='midi-t1-c1-r0') {
 const stage=document.getElementById('workspace'),text=document.getElementById('engraving-range').textContent,values=text.match(/\d+/g)?.map(Number)||[];
 if(stage.dataset.notationRenderStatus!=='ready'||values.length!==3)return null;
 const [from,to,total]=values;if(from<1||to<from||to>total)return null;
 for(let index=responses.length-1;index>=0;index--){const row=responses[index],p=row.response?.page,s=row.request?.settings;
  if(row.status===200&&p?.status==='ready'&&p.view_version===2&&p.part_id===partId&&s?.part_id===partId&&s.rendition_policy_id==='wmh-basic-key-rendition-fifo-v1'&&p.first_measure===from-1&&p.measure_count===to-from+1&&p.total_measures===total&&s.display_meter?.numerator===4&&s.display_meter?.denominator===4)return{requestIndex:index,page:p,range:{text,from,to,total}};
 }
 return null;
}
function observeBasicKeyFollowing(document){
 const rows=[];let pending,active=true,last='',overflow=false;const tick=()=>{if(!active)return;const cursor=document.getElementById('written-cursor-status'),ids=JSON.parse(cursor?.dataset.sourceNoteIds||'[]'),rails=[...document.querySelectorAll('#basic-rendition-events-list [aria-current="true"][data-note-id]')].map(n=>n.dataset.noteId),measure=cursor?.dataset.sourceMeasureIndex||'',renderer=document.getElementById('clean-song-stage').dataset.rendererState,signature=JSON.stringify([ids,rails,measure,renderer]);if(signature!==last){last=signature;if(rows.length<128)rows.push({position:Number(document.getElementById('progress').value),renderer,ids,rails,measure});else overflow=true;}pending=requestAnimationFrame(tick);};pending=requestAnimationFrame(tick);return{stop(){active=false;cancelAnimationFrame(pending);return{rows,overflow,stopped:true};}};
}
function runBasicKeyAcceptanceCleanup(report,actions){
 report.cleanupErrors=[];
 for(const [name,run]of actions)try{const result=run();if(result===false||result?.restored===false||result?.cleanupErrors?.length)throw Error(result?.cleanupErrors?.map(error=>error.message).join('; ')||'Observer restoration was incomplete');}catch(error){report.cleanupErrors.push({name,message:String(error?.message||error).slice(0,512)});}
 if(report.cleanupErrors.length){report.ok=false;report.error ||= 'Acceptance cleanup failed: '+report.cleanupErrors.map(error=>`${error.name}: ${error.message}`).join('; ');}
 return report.cleanupErrors;
}
async function observeBasicKeyEngraving(document) {
 // Preload the same pinned offline bundle used by the application, then observe
 // the real reader/model/render methods. No response, model or clock is replaced.
 if(!globalThis.opensheetmusicdisplay?.OpenSheetMusicDisplay)await new Promise((resolve,reject)=>{
  const script=document.createElement('script');script.src='/vendor/opensheetmusicdisplay.min.js';script.integrity='sha256-CZshJa7wVcpPqudZVwN0BJc/lFFUS1LZs6Cx94izNYE=';script.onload=resolve;script.onerror=()=>reject(Error('Pinned engraving bundle unavailable'));document.head.append(script);
 });
 const proto=globalThis.opensheetmusicdisplay.OpenSheetMusicDisplay.prototype,load=proto.load,render=proto.render;let renderer=null,xml=null;
 function observedLoad(value,...args){xml=value.cloneNode(true);return Reflect.apply(load,this,[value,...args]);}
 function observedRender(...args){const result=Reflect.apply(render,this,args);renderer=this;return result;}
 proto.load=observedLoad;proto.render=observedRender;
 const fraction=f=>({numerator:4*((f.WholeValue||0)*f.Denominator+f.Numerator),denominator:f.Denominator}),box=node=>{const b=node?.getBoundingClientRect();return{x:b?.x||0,y:b?.y||0,width:b?.width||0,height:b?.height||0,connected:node?.isConnected===true};};
 return{snapshot(){
  if(!renderer||!xml)throw Error('Actual renderer model unavailable');const measures=renderer.Sheet.SourceMeasures,notes=[];
  for(const measure of measures)for(const vertical of measure.VerticalSourceStaffEntryContainers)for(const staff of vertical.StaffEntries||[])for(const voice of staff?.VoiceEntries||[])for(const note of voice.Notes||[])if(note.PrintObject!==false&&!notes.includes(note))notes.push(note);
  if(notes.length>16||measures.length>8)throw Error('Original notation observation bound');
  const curves=new Set();for(const row of renderer.GraphicSheet.MeasureList)for(const measure of row||[])for(const staff of measure?.staffEntries||[])for(const tie of staff.GraphicalTies||[])curves.add(tie);
  return{measures:measures.length,notes:notes.map(note=>{const g=renderer.EngravingRules.GNote(note);return{measure:measures.indexOf(note.SourceMeasure),part:note.ParentStaff.ParentInstrument.IdString,staff:note.ParentStaff.ParentInstrument.Staves.indexOf(note.ParentStaff)+1,voice:String(note.ParentVoiceEntry.ParentVoice.VoiceId),at:fraction(note.getAbsoluteTimestamp()),measureAt:fraction(note.ParentVoiceEntry.Timestamp),duration:fraction(note.Length),pitch:note.isRest()?null:{step:{0:'C',2:'D',4:'E',5:'F',7:'G',9:'A',11:'B'}[note.Pitch.FundamentalNote],alter:note.Pitch.AccidentalHalfTones,octave:note.Pitch.Octave+3},tieMembers:(note.NoteTie?.Notes||[]).map(n=>notes.indexOf(n)),head:box(g?.getNoteheadSVGs?.()[g?.vfnoteIndex])};}),curves:[...curves].map(tie=>({from:notes.indexOf(tie.StartNote?.sourceNote),to:notes.indexOf(tie.EndNote?.sourceNote),...box(tie.SVGElement)})),xmlNotes:[...xml.querySelectorAll('note[id]')].map(note=>({id:note.getAttribute('id'),ties:[...note.children].filter(n=>n.localName==='tie').map(n=>n.getAttribute('type')).sort()}))};
 },restore(){if(proto.load===observedLoad)proto.load=load;if(proto.render===observedRender)proto.render=render;return proto.load===load&&proto.render===render;}};
}
/* Preserve every application request across bootstrap and selected-source work.
 * The two JSON observations read only values consumed by the application. */
function createBasicKeyRequestObserver(document,{onError}) {
 const evidence={version:1,rows:[],events:0,bootstrap:null,selection:null,restored:false},paths=[];
 const check=(value,message)=>{if(!value)throw Error(message);},tick=()=>++evidence.events;
 const preview=()=>{const lobby=document.getElementById('song-lobby');return{previewId:lobby.dataset.previewId,previewStatus:lobby.dataset.previewStatus,practiceDisabled:document.getElementById('start-practice').disabled};};
 let expectedKey=null,bodyBytes=0;
 const consumed=createVsqJsonObserver({maxRows:2,onError,onValue:value=>{const row=evidence.rows[value.requestIndex];check(new TextEncoder().encode(JSON.stringify(value.body)).length<=32768,'Bootstrap response bound');row.consumed=tick();row.response=value.path==='/api/compile'?{score:value.body.score}:value.body;}});
 function observe(path,options,promise){
  check(paths.length<160,'API bound');const body=options?.body;
  check(body===undefined||typeof body==='string'||body instanceof Blob,'Unsupported request evidence body');
  const requestBody=typeof body==='string'?body:null,bytes=requestBody===null?0:new TextEncoder().encode(requestBody).length;
  check(bytes<=65536&&(bodyBytes+=bytes)<=262144,'Request body evidence bound');
  const row={index:paths.length,path,method:options?.method||'GET',started:tick(),settled:null,status:null,scope:evidence.selection?'selected':'bootstrap',previewId:preview().previewId||'',requestBody,...(body instanceof Blob?{file:{name:body.name,size:body.size,type:body.type}}:{})};
  paths.push(path);evidence.rows.push(row);
  Reflect.apply(Promise.prototype.then,promise,[response=>{row.status=response.status;row.settled=tick();},error=>{row.error=String(error).slice(0,512);row.signalAborted=options?.signal?.aborted===true;row.settled=tick();}]);
  if(['/api/catalog/score/first-steps','/api/compile'].includes(path))consumed.observe(path,promise,row.index);
  return promise;
 }
 function select(event){
  const key=event.target?.closest?.('[data-library-key]')?.dataset.libraryKey;
  if(key!==`native:${expectedKey}`||evidence.selection)return;
  check(event.isTrusted===true,'Source selection must be a trusted catalog click');check(evidence.bootstrap,'Bootstrap readiness must precede source selection');
  evidence.selection={event:tick(),requestCount:paths.length,key:expectedKey,trusted:true,before:preview(),ready:null};
 }
 document.addEventListener('click',select,true);
 return{paths,evidence,observe,bootstrapReady(){
  const state=preview(),rows=evidence.rows,source=rows.find(row=>row.path==='/api/catalog/score/first-steps'),compile=rows.find(row=>row.path==='/api/compile');
  return state.previewId==='first-steps'&&state.previewStatus==='ready'&&!state.practiceDisabled&&source?.consumed&&compile?.consumed&&rows.every(row=>row.settled);
 },markBootstrap(){check(this.bootstrapReady(),'First Steps bootstrap incomplete');check(!evidence.bootstrap,'Duplicate bootstrap boundary');evidence.bootstrap={event:tick(),requestCount:paths.length,...preview()};},expectSelection(key){check(evidence.bootstrap&&!expectedKey,'Invalid basic source selection preparation');expectedKey=key;},markSelected(opened){
  const state=preview();check(evidence.selection&&!evidence.selection.ready&&state.previewId===`native:${expectedKey}`&&state.previewStatus==='ready'&&!state.practiceDisabled,'Selected basic source incomplete');
  evidence.selection.ready={event:tick(),requestCount:paths.length,...state,contentSha256:opened.clean_package.content_sha256,sourceSha256:opened.clean_package.runtime.source_sha256};
 },restore(){consumed.restore();document.removeEventListener('click',select,true);evidence.restored=true;}};
}

// Focus work precedes the timing gate. The timed key action may only verify it;
// refocusing, scrolling or clicking there would consume the original hit window.
function assertBasicKeyInputFocus(document,node){
 if(!node||node.id!=='stage-title'||document.body.dataset.screen!=='stage'||document.hidden||!document.hasFocus()||document.activeElement!==node||document.querySelector('dialog[open]'))throw Error('Prepared C5 performance focus was lost');
}
function assertBasicKeyFollowFocus(document,node){
 if(!node||node.id!=='engraving-follow'||node.type!=='checkbox'||node.disabled||node.checked||document.activeElement!==node||!document.hasFocus()||document.hidden||document.querySelector('dialog[open]'))throw Error('Prepared Follow checkbox focus was lost');
}
async function enableBasicKeyFollowing(document,{native,frame,until,trusted}){
 const node=document.getElementById('engraving-follow');if(node.checked)return null;
 // Native dispatch may be delayed while engraving changes the layout. Use the
 // focused checkbox's normal keyboard activation, never a stale pointer point.
 node.scrollIntoView({block:'center',inline:'center'});node.focus({preventScroll:true});await frame();await frame();assertBasicKeyFollowFocus(document,node);
 const before=trusted.length,sequence=await native('toggle-follow',node);
 await until(()=>node.checked&&trusted.slice(before).some(event=>event.id==='engraving-follow'&&event.type==='change'&&event.trusted===true&&event.checked===true),'trusted Follow checkbox activation',3000);
 return{sequence,before:false,after:node.checked,trustedChange:true};
}
async function prepareBasicKeyInputFocus(document,node,frame){
 node.scrollIntoView({block:'center',inline:'center'});node.focus();await frame();await frame();assertBasicKeyInputFocus(document,node);
}

(() => {
 const phase=globalThis.__WMH_ACCEPTANCE_PHASE__,$=id=>document.getElementById(id),assert=(v,m)=>{if(!v)throw Error(m);},fetchOriginal=globalThis.fetch,fetcher=fetchOriginal.bind(globalThis),waits=createAcceptanceWait();
 const json=(path,body)=>waits.json(fetcher,path,body===undefined?undefined:{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)},10000),until=(fn,label,ms=10000)=>waits.until(signal=>{receiver?.assertHealthy();return fn(signal);},`Basic-key ${report.stage}: ${label}`,ms),frame=()=>new Promise(requestAnimationFrame);
 const report={version:1,phase,origin:location.origin,ok:false,stage:'initializing',errors:[],requests:[],imports:[],assessmentRequests:[],assessmentResponses:[],negative:[],trusted:[],previews:{},files:{},screenshots:{}};let sequence=0,probe,engravingObserver,receiver;
 const notationRequests=[],notationResponses=[],notationObservers=[];report.notationCancellations=[];
 function observeNotation(promise,request,signal){assert(notationRequests.length<48,'Notation request bound');const requestIndex=notationRequests.length;notationRequests.push(request);const observer=createVsqJsonObserver({maxRows:1,onValue:row=>notationResponses.push({request,response:row.body,status:row.status}),onError:error=>{if(signal?.aborted&&/AbortError/.test(error))report.notationCancellations.push({requestIndex,signalAborted:true,error});else report.errors.push(error);}});notationObservers.push(observer);observer.observe('/api/library/basic-keys/notation',promise,requestIndex);}
 const requestObserver=createBasicKeyRequestObserver(document,{onError:e=>report.errors.push(e)});report.requests=requestObserver.paths;report.requestEvidence=requestObserver.evidence;
 const controls=createVsqControlObserver(document),responses=createVsqJsonObserver({maxRows:8,onValue:row=>(row.path==='/api/assess'?report.assessmentResponses:report.imports).push(row),onError:e=>report.errors.push(e)});
 const onError=e=>report.errors.push(String(e.message||e.reason));addEventListener('error',onError);addEventListener('unhandledrejection',onError);
 const control=e=>{if(['preview-part','start-listen','notation-scope','notation-scope-part','notation-toggle','start-practice','play-button','stage-title','open-score','engraving-basic-meter','engraving-page-size','engraving-follow','progress','jianpu-button','reset-button'].includes(e.target?.id)||['KeyR','Digit2'].includes(e.code)){assert(report.trusted.length<128,'Input evidence bound');report.trusted.push({type:e.type,id:e.target?.id,code:e.code||null,trusted:e.isTrusted===true,value:e.target?.value||null,checked:typeof e.target?.checked==='boolean'?e.target.checked:null,actionSequence:sequence});}};
 for(const type of ['click','change','input','keydown','keyup'])document.addEventListener(type,control,true);
 globalThis.fetch=function(...args){const result=Reflect.apply(fetchOriginal,this,args),path=String(args[0]);if(path.startsWith('/api/')){requestObserver.observe(path,args[1],result);if(['/api/library/import/preview','/api/library/import/commit','/api/assess'].includes(path))responses.observe(path,result);if(path==='/api/assess')report.assessmentRequests.push(JSON.parse(args[1].body));if(path==='/api/library/basic-keys/notation'){observeNotation(result,JSON.parse(args[1].body),args[1].signal);}}return result;};
 const click=id=>{assert($(id)&&!$(id).disabled,`Unavailable ${id}`);$(id).click();},closeDialogs=()=>{for(const d of document.querySelectorAll('dialog[open]'))d.close();},menu=createAcceptanceNavigation({document,until,click});
 async function native(kind,node,file){assert(node&&!node.disabled,'Native target unavailable');if(kind==='key-c5')assertBasicKeyInputFocus(document,node);else if(kind==='toggle-follow')assertBasicKeyFollowFocus(document,node);else{node.scrollIntoView({block:'center',inline:'center'});node.focus();await frame();await frame();}const b=node.getBoundingClientRect(),x=b.x+b.width/2,y=b.y+b.height/2,hit=document.elementFromPoint(x,y);assert(b.width>0&&b.height>0&&x>0&&x<innerWidth&&y>0&&y<innerHeight&&(hit===node||node.contains(hit)),`Native target obscured/outside viewport: ${describeBasicKeyNativeTarget(node,b,hit)}`);assert(sequence<64,'Native action bound');const action={version:1,sequence:++sequence,kind,x,y,width:innerWidth,height:innerHeight,...(file?{file}:{})};if(kind==='picker')controls.beginPicker(sequence,file);let success=false;try{await json('/__desktop_smoke/action',action);let r;await until(async signal=>{const response=await fetcher(`/__desktop_smoke/result/${sequence}`,{signal});if(response.status===404)return false;r=await response.json();assert(response.ok,r.error);return true;},`native ${kind}`,15000);assert(r.ok,r.error);success=true;return sequence;}finally{if(kind==='picker'&&!success)controls.endPicker(sequence,false);}}
 const inventory=async()=>{const x=await json('/api/library/list');assert(x.storage==='native-filesystem'&&x.issues.length===0,'Native inventory unavailable');return x;};
 async function choose(file){closeDialogs();click('import-tools-button');const before=report.imports.length,n=await native('picker',$('import-button'),file);let success=false;try{await until(()=>report.imports.length>before&&$('bulk-import-dialog').dataset.phase==='review','complete preflight');success=true;}finally{controls.endPicker(n,success);}}
 async function download(node){const before=(await json('/__desktop_smoke/state')).downloads.length;await native('click',node);let row;await until(async()=>{row=(await json('/__desktop_smoke/state')).downloads[before];return row?.complete;},'download');assert(row.success,'Download failed');return row.file;}
 async function take(){closeDialogs();click('results-button');const file=await download($('export-takes'));closeDialogs();return file;}
 const audio=()=>({...probe.snapshot(),worklet:receiver.status()}),preview=()=>({coverage:$('clean-song-preview-status').textContent,rendition:$('clean-song-rendition').textContent,tracks:[...$('clean-song-tracks').children].map(n=>n.textContent),parts:[...$('preview-part').options].map(o=>({id:o.value,disabled:o.disabled,text:o.textContent})),listenDisabled:$('start-listen').disabled,practiceDisabled:$('start-practice').disabled,audio:audio()});
 const playbackSnapshot=()=>({wallMs:performance.now(),position:Number($('progress').value),renderer:$('clean-song-stage').dataset.rendererState,captured:$('hud-captured').textContent,assessments:report.assessmentRequests.length,audio:audio(),scheduled:receiver.count()});
 async function completeListen(){
  report.stage='complete-basic-listen';const start=receiver.count(),e=report.listening={version:2,before:{captured:$('hud-captured').textContent,assessments:report.assessmentRequests.length}};
  await native('click',$('start-listen'));await until(()=>Number($('progress').value)>=700&&$('clean-song-stage').dataset.rendererState==='playing','complete Listen advancing');
  await native('click',$('play-button'));await until(()=>$('clean-song-stage').dataset.rendererState==='paused'&&receiver.settledSince(start)&&receiver.quiet(),'Listen paused with processor ledger');e.paused=playbackSnapshot();
  report.screenshots['listen-paused']=await native('click',$('stage-title'));await native('click',$('results-button'));report.screenshots['listen-empty-results']=await native('click',$('results-dialog').querySelector('h2'));e.takeState={historyHidden:$('take-history').hidden,passOptions:[...$('feedback-pass').options].map(o=>o.value),exportDisabled:$('export-takes').disabled,assessmentDisabled:$('assess-button').disabled};await native('click',$('results-dialog').querySelector('[data-close-panel]'));await inspectAllParts();e.afterPause=playbackSnapshot();
  await native('click',$('play-button'));await until(()=>Number($('progress').value)===12020&&$('clean-song-stage').dataset.rendererState==='ended'&&audio().activeSources===0&&audio().pendingSources===0&&receiver.settledSince(start)&&receiver.quiet(),'complete Listen natural end and receiver cleanup',20000);
  e.ended=playbackSnapshot();e.audioThread=receiver.snapshot().slice(start);report.screenshots['listen-end']=await native('click',$('stage-title'));
  // Replay from the already painted All view to observe even short source gates.
  await native('click',$('reset-button'));await until(()=>Number($('progress').value)===0&&JSON.parse($('workspace').dataset.renderedNotationParts||'[]').length===3,'all-part view ready at original start');
  const replayStart=receiver.count(),following=observeBasicKeyFollowing(document);try{await native('click',$('play-button'));await until(()=>Number($('progress').value)===12020&&$('clean-song-stage').dataset.rendererState==='ended'&&audio().activeSources===0&&audio().pendingSources===0&&receiver.settledSince(replayStart)&&receiver.quiet(),'all-part source IDs through natural End',20000);e.replayEnd=playbackSnapshot();e.replayAudioThread=receiver.snapshot().slice(replayStart);}finally{e.following=following.stop();}

  await menu.returnToLibrary();await native('click',document.querySelector(`#catalog [data-library-key="native:${report.key}"]`));await until(()=>!$('start-practice').disabled,'selected source ready after Listen');
 }
 async function notationControls(open){if($('notation-toggle').getAttribute('aria-expanded')!=='true')await native('click',$('notation-toggle'));await until(()=>!$('notation-tools').hidden,'notation controls visible');const tools=$('notation-tools');if(tools.open!==open)await native('click',tools.querySelector('summary'));}
 function scopeFrame(){
  const overlay=$('notation-lane-overlay'),bounds=overlay.getBoundingClientRect(),box=node=>{const b=node.getBoundingClientRect();return{x:b.x,y:b.y,width:b.width,height:b.height,visible:b.width>0&&b.height>0&&b.x<bounds.right&&b.x+b.width>bounds.x&&b.y<bounds.bottom&&b.y+b.height>bounds.y};};
  return{scope:$('notation-scope').value,status:$('workspace').dataset.notationRenderStatus,rendered:JSON.parse($('workspace').dataset.renderedNotationParts||'[]'),human:$('clean-song-target').value,noteIds:[...($('jianpu-button').getAttribute('aria-pressed')==='true'?$('notation'):$('engraved-staff')).querySelectorAll('[data-note-id]')].map(n=>n.dataset.noteId),mix:[...document.querySelectorAll('#clean-song-parts input')].map(n=>({id:n.dataset.partId,checked:n.checked})),parts:[...($('jianpu-button').getAttribute('aria-pressed')==='true'?$('notation'):$('engraved-staff')).querySelectorAll('[data-notation-part-id]')].map(n=>({id:n.dataset.notationPartId,...box(n)})),rows:[...$('basic-rendition-events-list').querySelectorAll('[data-note-id]')].map(n=>({id:n.dataset.noteId,part:n.dataset.partId,role:n.dataset.role,...box(n)})),glyphs:[...($('jianpu-button').getAttribute('aria-pressed')==='true'?$('notation'):$('engraved-staff')).querySelectorAll($('jianpu-button').getAttribute('aria-pressed')==='true'?'.score-note':'.vf-notehead')].map(box),scrollTop:overlay.scrollTop,scrollHeight:overlay.scrollHeight,clientHeight:overlay.clientHeight,fit:overlay.dataset.notationFit,coverage:$('notation-scope-summary').textContent,viewport:{width:innerWidth,height:innerHeight},bounds:box(overlay)};
 }
 async function inspectAllParts(){
  await notationControls(true);if($('notation-scope').value!=='all')await native('select-second',$('notation-scope'));
  await until(()=>JSON.parse($('workspace').dataset.renderedNotationParts||'[]').length===3&&$('workspace').dataset.notationRenderStatus==='ready','all three original parts painted');await notationControls(false);
  const e=report.allParts={frames:[],responses:[]};report.screenshots['all-parts']=await native('click',$('stage-title'));e.frames.push(scopeFrame());
  for(let page=0;page<3;page++){
   const seen=new Set(e.frames.flatMap(f=>[...f.parts.filter(p=>p.visible).map(p=>p.id),...f.rows.filter(n=>n.visible).map(n=>n.part)]));if(seen.size===3&&page>0)break;
   await notationControls(true);await native('click',$('notation-pan-down'));await notationControls(false);report.screenshots[`all-scroll-${page}`]=await native('click',$('stage-title'));e.frames.push(scopeFrame());
  }
  e.responses=structuredClone(notationResponses);e.after=scopeFrame();
 }
 async function captureSourceMeterDisclosure(closeAfter=true){
  const tools=$('notation-tools');if($('notation-toggle').getAttribute('aria-expanded')!=='true')await native('click',$('notation-toggle'));
  await until(()=>!tools.hidden&&!$('notation-dock').hidden,'notation surface open');
  if(!tools.open)await native('click',tools.querySelector('summary'));
  await until(()=>!$('engraving-basic-controls').hidden,'source-meter controls');if($('engraving-basic-meter').value!=='source')await native('select-first',$('engraving-basic-meter'));
  await until(()=>$('engraving-status').textContent.includes('来源没有明确的起始拍号'),'visible source-meter disclosure');
  const observe=(node,readOnly=false)=>{const b=node.getBoundingClientRect(),x=b.x+b.width/2,y=b.y+b.height/2,hit=document.elementFromPoint(x,y),style=getComputedStyle(node);let exposed=true;for(let parent=node;parent;parent=parent.parentElement)if(parent.hidden||parent.tagName==='DETAILS'&&!parent.open&&!parent.querySelector('summary')?.contains(node))exposed=false;return{id:node.id,text:node.textContent,bounds:{x:b.x,y:b.y,width:b.width,height:b.height},visible:exposed&&node.getClientRects().length>0&&style.display!=='none'&&style.visibility==='visible'&&b.width>0&&b.height>0&&x>0&&x<innerWidth&&y>0&&y<innerHeight&&(hit===node||node.contains(hit)||readOnly&&style.pointerEvents==='none'&&hit?.contains(node))};};
  report.screenshots['meter-choice']=await native('click',$('engraving-basic-provenance'));
  const choice={label:observe($('engraving-basic-meter-label')),control:{...observe($('engraving-basic-meter')),value:$('engraving-basic-meter').value,disabled:$('engraving-basic-meter').disabled},provenance:observe($('engraving-basic-provenance'))};
  assert(Object.values(choice).every(node=>node.visible),'Source-meter choice must be visibly readable');
  const statusNode=$('engraving-status'),help=statusNode.closest('details');assert(help?.classList.contains('dock-help'),'Source-meter status needs its existing help disclosure');
  if(!help.open)await native('click',help.querySelector('summary'));
  statusNode.scrollIntoView({block:'center',inline:'center'});
  report.screenshots['meter-status']=await native('click',$('stage-title'));
  const status=observe(statusNode,true);assert(status.visible,'Source-meter status must be visibly readable');
  report.sourceMeterDisclosure={locale:'zh-CN',viewport:{width:innerWidth,height:innerHeight},choice,status};
  if(closeAfter){await native('select-second',$('engraving-basic-meter'));await until(()=>notationResponses.at(-1)?.response.page.status==='ready','explicit display meter restored');await native('click',tools.querySelector('summary'));assert(!tools.open,'Notation controls must close before practice controls');}
 }
 async function notationInspection(){
  const notationAudioStart=receiver.count();
  report.stage='source-bound-notation';engravingObserver=await observeBasicKeyEngraving(document);
  const e=report.notation={version:1,locale:'zh-CN',responses:notationResponses,frames:{},followActivations:[]};
  const enableFollow=async()=>{const receipt=await enableBasicKeyFollowing(document,{native,frame,until,trusted:report.trusted});if(receipt)e.followActivations.push(receipt);};
  await native('click',$('open-score'));await until(()=>$('workspace').dataset.scoreState==='inspection'&&notationResponses.at(-1)?.response.page.view_version===2,'paused complete interpreted page');
  await captureSourceMeterDisclosure(false);
  e.inspection={scoreState:$('workspace').dataset.scoreState,position:Number($('progress').value),captured:$('hud-captured').textContent,audio:audio(),assessments:report.assessmentRequests.length,soundMuted:$('sound-button').getAttribute('aria-pressed')==='true',status:$('engraving-status').textContent,meter:$('engraving-basic-meter').value};
  await native('select-second',$('engraving-page-size'));await until(()=>$('engraving-page-size').value==='2'&&notationResponses.at(-1)?.request.settings.measure_count===2&&notationResponses.at(-1)?.response.page.status==='display_meter_required','two-bar view');
  await native('select-second',$('engraving-basic-meter'));await until(()=>notationResponses.at(-1)?.response.page.status==='ready'&&$('workspace').dataset.notationRenderStatus==='ready'&&$('engraved-staff').querySelector('.vf-notehead'),'actual two-bar staff');
  assert(!$('engraving-follow').checked,'Display choice must suspend Follow');await enableFollow();
  const visiblePage=()=>visibleBasicKeyPage(document,notationResponses);
  const focus=()=>JSON.parse($('written-cursor-status').dataset.sourceNoteIds||'[]').includes('midi-t1-e4');
  async function capture(name,staff=true){if($('notation-tools').open)await native('click',$('notation-tools').querySelector('summary'));report.screenshots[`notation-${name}`]=await native('click',$('stage-title'));await frame();await frame();const root=$('engraved-staff'),cursor=$('written-cursor-status'),visible=visiblePage();assert(visible,'Visible range must match an admitted native source page');e.frames[name]={scope:scopeFrame(),surface:observeVsqFollowingSurface(document),requestIndex:visible.requestIndex,visibleRange:visible.range,pageFirst:visible.page.first_measure,position:Number($('progress').value),cue:$('stage-cue').dataset.cueState,ids:JSON.parse(cursor.dataset.sourceNoteIds||'[]'),measure:cursor.dataset.sourceMeasureIndex,follow:$('engraving-follow').checked,meter:$('engraving-basic-meter').value,audio:audio(),captured:$('hud-captured').textContent,assessments:report.assessmentRequests.length,overlay:!$('notation-lane-overlay').hidden&&$('workspace').classList.contains('notation-on-lanes'),fallbackHidden:$('engraving-fallback').hidden,attacks:$('engraving-basic-attack-list').textContent+' '+$('basic-rendition-events-list').textContent,selected:$('jianpu-button').getAttribute('aria-pressed')==='true'?'jianpu':'staff',svg:root.querySelectorAll('svg').length,paths:root.querySelectorAll('svg path').length,heads:root.querySelectorAll('.vf-notehead').length,tieCurves:root.querySelectorAll('.vf-stavetie path').length,cues:[...root.querySelectorAll('.engraving-expected-cue:not([hidden])')].map(n=>({id:n.dataset.sourceNoteId,measure:n.dataset.sourceMeasureIndex})),numbered:[...$('notation').querySelectorAll('.score-note'),...$('basic-rendition-events-list').querySelectorAll('.score-note')].map(n=>({id:n.dataset.noteId,width:n.getBoundingClientRect().width,height:n.getBoundingClientRect().height})),...(staff?{model:engravingObserver.snapshot()}:{})};}
  await until(()=>visiblePage()?.page.first_measure===0&&focus()&&$('engraved-staff').querySelector('.engraving-expected-cue:not([hidden])'),'initial exact source focus');await capture('first');
  await native('click',$('play-button'));await until(()=>Number($('progress').value)>=4100&&visiblePage()?.page.first_measure===2&&$('engraved-staff').querySelector('.engraving-expected-cue:not([hidden])'),'real clock crosses source page',10000);await native('click',$('play-button'));await capture('crossed');
  await native('click',$('play-button'));await until(()=>Number($('progress').value)===12020&&visiblePage()?.page.first_measure===4&&report.assessmentResponses.length===1&&$('engraved-staff').querySelector('.vf-notehead'),'natural End and actual empty-input practice assessment',20000);await capture('end');
  e.naturalAssessment={request:report.assessmentRequests[0],response:report.assessmentResponses[0],accuracy:$('accuracy').textContent};
  await native('click',$('reset-button'));await until(()=>Number($('progress').value)===0&&visiblePage()?.page.first_measure===0&&focus()&&$('engraved-staff').querySelector('.engraving-expected-cue:not([hidden])'),'restart source page');await capture('reset');
  if(!$('notation-tools').open)await native('click',$('notation-tools').querySelector('summary'));await native('click',$('jianpu-button'));await native('select-second',$('notation-scope'));await until(()=>$('jianpu-button').getAttribute('aria-pressed')==='true'&&$('notation').querySelector('[data-note-id="midi-t1-e4"]')&&JSON.parse($('workspace').dataset.renderedNotationParts||'[]').length===3&&$('workspace').dataset.notationRenderStatus==='ready','actual all-part numbered source identities');await enableFollow();await capture('numbered',false);
  await notationControls(true);await native('select-first',$('notation-scope'));await until(()=>$('notation-scope').value==='current'&&JSON.parse($('workspace').dataset.renderedNotationParts||'[]').length===1,'Current part restored');await notationControls(false);
  await until(()=>receiver.settledSince(notationAudioStart)&&receiver.quiet(),'notation processor ledger');e.audioThread=receiver.snapshot().slice(notationAudioStart);e.responses=structuredClone(notationResponses);e.finalAudio=audio();e.finalAssessments=report.assessmentRequests.length;report.practiceAssessmentStart=report.assessmentResponses.length;report.engravingRestored=engravingObserver.restore();engravingObserver=null;
  await menu.returnToLibrary();await native('click',document.querySelector(`#catalog [data-library-key="native:${report.key}"]`));await until(()=>!$('start-practice').disabled&&$('preview-part').value==='midi-t1-c1-r0','practice remains available after inspection');
 }
 addEventListener('DOMContentLoaded',async()=>{try{
  assert(['basic-key-seed','basic-key-restart'].includes(phase),'Invalid phase');assert(localStorage.getItem('wmh.basic-key.acceptance')===null,'Fresh profile required');report.profileMarkerAbsent=true;localStorage.setItem('wmh.basic-key.acceptance',phase);await menu.enterLibrary();const {getAppI18n}=await import('/app-locale.js'),i18n=getAppI18n(document);i18n.setLocale('en');assert((await json('/api/health')).network==='native-protocol-no-listener','Actual Rust required');probe=observeNativeReferenceAudio();receiver=await observeBasicKeyReceiver(document);
  await until(()=>requestObserver.bootstrapReady(),'completed original First Steps bootstrap');requestObserver.markBootstrap();
  if(phase==='basic-key-seed'){
   assert((await inventory()).entries.length===0,'Seed requires empty library');
   for(const file of ['basic-key-invalid-profile.zip','basic-key-forged-coverage.zip']){report.stage='negative-preflight';await choose(file);const latest=report.imports.at(-1);for(const detail of document.querySelectorAll('#bulk-import-groups details'))if(!detail.open)await native('click',detail.querySelector('summary'));report.negative.push({file,ready:latest.body.summary.ready,statuses:latest.body.items.map(i=>({status:i.status,playable:i.playable,code:i.code,message:i.message})),text:$('bulk-import-groups').textContent,inventory:(await inventory()).entries.length});report.screenshots[file]=await native('click',$('bulk-import-title'));await native('click',$('bulk-import-done'));}
   report.stage='original-clean-package';await choose('basic-key-original.zip');assert(report.imports.at(-1).body.summary.ready===1,'Whole original package not ready');const before=report.imports.length;await native('click',$('bulk-import-save'));await until(()=>report.imports.length>before&&report.imports.at(-1).path.endsWith('/commit'),'saved');assert(report.imports.at(-1).body.summary.saved===1,'Package save failed');await native('click',$('bulk-import-done'));
  }
  report.stage='all-part-inspection';const list=await inventory();assert(list.entries.length===1,'Exact inventory needs one song');report.inventory=list.entries;report.directory=list.directory;report.key=list.entries[0].key;report.opened=await json('/api/library/load',{key:report.key});await until(()=>document.querySelector(`#catalog [data-library-key="native:${report.key}"]`),'saved catalog row');requestObserver.expectSelection(report.key);await native('click',document.querySelector(`#catalog [data-library-key="native:${report.key}"]`));await until(()=>$('song-lobby').dataset.previewId===`native:${report.key}`&&$('song-lobby').dataset.previewStatus==='ready'&&!$('start-practice').disabled,'basic keys ready');requestObserver.markSelected(report.opened);
  report.previews.en=preview();report.screenshots.english=await native('click',$('clean-song-preview-status'));i18n.setLocale('zh-CN');report.previews['zh-CN']=preview();report.screenshots.chinese=await native('click',$('clean-song-preview-status'));for(const [index,row]of [...$('clean-song-tracks').children].entries())report.screenshots[`track${index}`]=await native('click',row);
  // Move between real options so the selected melodic part is trusted input.
  await native('select-last',$('preview-part'));await until(()=>$('preview-part').value==='midi-t3-c1-r0'&&!$('start-practice').disabled,'second melodic selection');await native('select-first',$('preview-part'));await until(()=>$('preview-part').value==='midi-t1-c1-r0'&&!$('start-practice').disabled,'first melodic selection');
  if($('sound-button').getAttribute('aria-pressed')==='true')await native('click',$('sound-button'));
  if(phase==='basic-key-seed')await completeListen();
  if(phase==='basic-key-restart')await notationInspection();
  if(phase==='basic-key-restart'){
  await native('select-last',$('preview-part'));await until(()=>$('preview-part').value==='midi-t3-c1-r0'&&!$('start-practice').disabled,'C5 human part ready');
  const accompanimentStart=receiver.count();
  report.stage='real-practice-no-machine-input';await native('click',$('start-practice'));await until(()=>document.body.dataset.screen==='stage'&&$('clean-song-stage').dataset.rendererState==='playing'&&Number($('progress').value)>0,'real practice clock');report.noInput={captured:$('hud-captured').textContent,soundMuted:$('sound-button').getAttribute('aria-pressed')==='true',audio:audio()};await native('click',$('play-button'));await until(()=>$('stage-cue').dataset.cueState==='paused','paused');
  await until(()=>$('notation-scope').value==='current'&&JSON.stringify(JSON.parse($('workspace').dataset.renderedNotationParts||'[]'))==='[\"midi-t3-c1-r0\"]'&&$('workspace').dataset.notationRenderStatus==='ready','Current human part painted');
  report.currentPartView=scopeFrame();report.stageState={target:$('clean-song-target').value,notationPart:$('notation-part').value,countInDisabled:$('count-in').disabled,range:$('song-complete-range-text').textContent,tempo:$('tempo').value,partCheckboxes:[...document.querySelectorAll('#clean-song-parts input')].map(n=>({id:n.dataset.partId,disabled:n.disabled,checked:n.checked}))};if(!$('song-parts-tools').open)await native('click',$('song-parts-summary'));report.screenshots.stage=await native('click',$('song-complete-range-text'));await native('click',$('song-parts-summary'));assert(!$('song-parts-tools').open,'Part inventory must close before stage controls');report.files.machineTake=await take();await until(()=>receiver.settledSince(accompanimentStart)&&receiver.quiet(),'machine-free canceled processor ledger');report.accompaniment=receiver.snapshot().slice(accompanimentStart);
  // One trusted C5 key onset is scored while the other parts remain audible.
  await native('click',$('reset-button'));await until(()=>Number($('progress').value)===0&&!$('play-button').disabled,'reset');
  const humanSoundStart=receiver.count();report.stage='trusted-keyboard-score';const trace=observeNativeReferenceTransport(document,{keyCode:'Digit2'});try{trace.changed('ready',{checkpoint:true});const playAction=await native('click',$('play-button'));await until(()=>trace.counts().trustedPlayClicks===1&&trace.state().phase==='capturing'&&Number($('progress').value)>0,'trusted capture start');await prepareBasicKeyInputFocus(document,$('stage-title'),frame);trace.changed('key-focus-ready',{checkpoint:true});report.keyPreparation={playAction,readyWallMs:performance.now(),readyPositionMs:Number($('progress').value),focused:document.hasFocus(),activeElement:document.activeElement.id};await until(()=>Number($('progress').value)>=350,'C5 source onset approaching');assert(Number($('progress').value)<650,'Real input window missed before OS key action');assert(document.querySelector('#keyboard [data-midi="72"] .key-shortcut')?.textContent==='2','Visible C5 mapping must be Digit2');report.keyPreparation.dispatchWallMs=performance.now();report.keyPreparation.dispatchPositionMs=Number($('progress').value);report.keyPreparation.keyAction=await native('key-c5',$('stage-title'));await until(()=>trace.counts().trustedKeyDowns===1&&trace.counts().trustedKeyUps===1&&$('hud-captured').textContent==='1','single trusted onset');await native('click',$('play-button'));await until(()=>trace.counts().trustedPlayClicks===2&&$('stage-cue').dataset.cueState==='paused','trusted pause');report.transportAdmission=trace.snapshot('complete');}finally{trace.stop();}await native('click',$('play-button'));await until(()=>Number($('progress').value)===12020&&report.assessmentResponses.length===(report.practiceAssessmentStart||0)+1&&!$('feedback-results').hidden&&audio().activeSources===0&&audio().pendingSources===0&&receiver.settledSince(humanSoundStart)&&receiver.quiet(),'complete accompaniment and actual selected-part assessment',20000);report.humanAudio=audio();report.completePractice={ended:playbackSnapshot(),accuracy:$('accuracy').textContent,audioThread:receiver.snapshot().slice(humanSoundStart)};report.files.humanTake=await take();report.screenshots.human=await native('click',$('stage-title'));
  }
  if(phase==='basic-key-restart')await menu.returnToLibrary();
  assert(document.body.dataset.screen==='library','Both completed phase paths must return to the song library before export');
  if(phase==='basic-key-seed'){closeDialogs();click('import-tools-button');click('bulk-import-history-button');if(!$('bulk-import-history').open)await native('click',$('bulk-import-history').querySelector('summary'));await until(()=>document.querySelector('#bulk-import-export-songs input'),'complete export selector');await native('click',$('bulk-import-export-all'));report.files.package=await download($('bulk-import-export-pack'));await native('click',$('bulk-import-done'));}
  report.layout={width:innerWidth,height:innerHeight,documentWidth:document.documentElement.scrollWidth};report.pickerObservations=controls.pickers;report.downloads=(await json('/__desktop_smoke/state')).downloads;await until(()=>report.requestEvidence.rows.every(row=>row.settled),'completed application request evidence');report.stage='complete';report.ok=true;
 }catch(e){report.uiFailure={notice:$('notice')?.textContent||'',rendition:$('clean-song-stage-status')?.textContent||'',notation:$('engraving-status')?.textContent||'',renderer:$('clean-song-stage')?.dataset.rendererState||null,position:Number($('progress')?.value)||0};report.error=(e.stack||String(e))+'\nProduction UI: '+JSON.stringify(report.uiFailure);}finally{report.actions=sequence;runBasicKeyAcceptanceCleanup(report,[
  ['failure-evidence',()=>{if(!report.ok&&receiver)report.audioThreadFailure={runs:receiver.snapshot(),status:receiver.status()};}],
  ['receiver',()=>report.receiverCleanup=receiver?.restore()],['audio-probe',()=>probe?.restore()],['engraving',()=>{if(engravingObserver)return report.engravingRestored=engravingObserver.restore();}],
  ...notationObservers.map((observer,index)=>[`notation-${index}`,()=>observer.restore()]),['responses',()=>responses.restore()],['controls',()=>controls.restore()],['requests',()=>requestObserver.restore()],
  ...['click','change','input','keydown','keyup'].map(type=>[`input-${type}`,()=>document.removeEventListener(type,control,true)]),
  ['fetch',()=>{globalThis.fetch=fetchOriginal;return report.fetchRestored=globalThis.fetch===fetchOriginal;}],['error-listener',()=>removeEventListener('error',onError)],['rejection-listener',()=>removeEventListener('unhandledrejection',onError)]
 ]);assert(new TextEncoder().encode(JSON.stringify(report)).length<=1024*1024,'Report bound');await json('/__desktop_smoke/report',report);}});
})();
