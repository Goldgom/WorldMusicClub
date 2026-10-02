import {retainedSourceArchive,inspectRetainedSourceFile,sourceArchiveError} from './source-archive.js';
import {librarySize} from './library-view.js';
import {getAppI18n} from './app-locale.js';
import {localizeLibraryElements,localizedStatus,libraryIssue} from './library-locale.js';
import schema from './locales/library-schema.js';

export function sourceCheckSummary(file,result,i18n=getAppI18n()){
 const t=key=>i18n.t(`sourceArchive.${key}`);
 const hash=t(result.checksumMatches===false?'hashMismatch':result.checksumMatches===true?'hashMatches':!result.sha256?'hashUnavailable':'hashUndeclared');
 const size=t(result.sizeMatches===false?'sizeMismatch':result.sizeMatches===true?'sizeMatches':'sizeUndeclared');
 return{hash,size,mismatch:result.checksumMatches===false||result.sizeMatches===false,declaredHash:file.declaredSha256||t('notSupplied'),computedHash:result.sha256||t('unavailable'),declaredBytes:file.declaredBytes===null?t('notSupplied'):i18n.formatNumber(file.declaredBytes),computedBytes:i18n.formatNumber(result.bytes.length)};
}
/** Files stay inert. A digest completion can only prepare a current, explicitly selected download. */
export function setupSourceArchiveView({getContext,pausePlayback,inspectFile=inspectRetainedSourceFile,document=globalThis.document,window=document.defaultView,i18n=getAppI18n(document)}){
 const $=id=>document.getElementById(id),t=(key,params)=>i18n.t(key,params),dialog=document.createElement('dialog');dialog.id='source-archive-dialog';dialog.className='review-dialog source-archive-dialog';dialog.setAttribute('aria-labelledby','source-archive-title');dialog.style.overflowWrap='anywhere';
 dialog.innerHTML=`<div class="review-header"><div><span class="eyebrow" data-library-text="sourceArchive.eyebrow"></span><h2 id="source-archive-title" data-library-text="sourceArchive.title"></h2><p id="source-archive-score"></p></div><button id="source-archive-close" class="button ghost" data-library-aria="sourceArchive.closeAria">✕</button></div><p class="review-explanation" data-library-text="sourceArchive.explanation"></p><p class="review-explanation" data-library-text="sourceArchive.hashHelp"></p><div id="source-archive-status" class="notice" role="status" aria-live="polite"></div><ul id="source-archive-warnings" class="source-archive-warnings"></ul><div class="source-archive-heading"><h3 data-library-text="sourceArchive.files"></h3><button id="source-archive-refresh" class="button secondary" data-library-text="sourceArchive.refresh"></button></div><ul id="source-archive-files" class="source-archive-files"></ul><section id="source-archive-inspection" hidden><h3 id="source-archive-selected"></h3><p id="source-archive-role"></p><p id="source-archive-note"></p><dl class="source-file-check"><div><dt data-library-text="sourceArchive.declaredHash"></dt><dd id="source-declared-hash"></dd></div><div><dt data-library-text="sourceArchive.computedHash"></dt><dd id="source-computed-hash"></dd></div><div><dt data-library-text="sourceArchive.declaredBytes"></dt><dd id="source-declared-bytes"></dd></div><div><dt data-library-text="sourceArchive.computedBytes"></dt><dd id="source-computed-bytes"></dd></div></dl><p id="source-hash-status"></p><p id="source-size-status"></p><p id="source-mismatch-note" class="notice error" hidden data-library-text="sourceArchive.mismatchHelp"></p><button id="source-archive-download" class="button primary" disabled></button></section><div class="review-actions"><button id="source-archive-done" class="button secondary" data-library-text="sourceArchive.close"></button></div>`;
 document.body.append(dialog);let snapshot=null,files=[],prepared=null,generation=0,pending=null,fileViews=[],warningViews=[];
 const statusView=localizedStatus($('source-archive-status'),i18n),status=(key,params={},error=false)=>statusView.set(key,params,error);
 const sameContext=()=>{const current=getContext();return snapshot&&current.score===snapshot.score&&current.version===snapshot.version};
 function controls(){for(const button of $('source-archive-files').querySelectorAll('button'))button.disabled=Boolean(pending)||!sameContext();$('source-archive-download').disabled=Boolean(pending)||!prepared||!sameContext();dialog.setAttribute('aria-busy',String(Boolean(pending)));$('source-files-button').disabled=!getContext().score}
 function fileText(file,field){const key=`sourceArchive.${field}.${file[`${field}Code`]}`;return Object.hasOwn(schema,key)?t(key,field==='note'?file.noteParams:{}):file[field]||''}
 function render(){
  localizeLibraryElements(dialog,i18n);$('source-archive-score').textContent=snapshot?.score?.title||t('sourceArchive.noScore');
  for(const {file,role,note,button}of fileViews){role.textContent=fileText(file,'role');note.textContent=fileText(file,'note');button.textContent=t('sourceArchive.inspect');button.setAttribute('aria-label',t('sourceArchive.inspectAria',{filename:file.filename}))}
  for(const view of warningViews)view.render();
  const summary=prepared?sourceCheckSummary(prepared.file,prepared.result,i18n):null;
  if(prepared){
   const {file,result}=prepared;$('source-archive-selected').textContent=result.filename;$('source-archive-role').textContent=fileText(file,'role');$('source-archive-note').textContent=fileText(file,'note');
   for(const[id,value]of [['source-declared-hash',summary.declaredHash],['source-computed-hash',summary.computedHash],['source-declared-bytes',summary.declaredBytes],['source-computed-bytes',`${summary.computedBytes} (${librarySize(result.bytes.length,i18n)})`]])$(id).textContent=value;
   $('source-hash-status').textContent=summary.hash;$('source-size-status').textContent=summary.size;$('source-mismatch-note').hidden=!summary.mismatch;
  }
  $('source-archive-download').textContent=t(summary?.mismatch?'sourceArchive.downloadMismatch':'sourceArchive.download');statusView.render();
 }
 function invalidate(key){generation++;prepared=null;$('source-archive-inspection').hidden=true;controls();if(dialog.open)status(key)}
 function close(){invalidate('sourceArchive.status.closed');snapshot=null;files=[];fileViews=[];$('source-archive-files').replaceChildren();dialog.close();controls()}
 function refresh(){
  generation++;prepared=null;$('source-archive-inspection').hidden=true;snapshot=getContext();files=[];fileViews=[];warningViews=[];$('source-archive-files').replaceChildren();$('source-archive-warnings').replaceChildren();
  if(!snapshot.score){status('sourceArchive.status.noScore');render();controls();return}
  try{
   const archive=retainedSourceArchive(snapshot.score);files=archive.files;
   for(const[index,warning]of archive.warnings.entries()){
    const li=document.createElement('li'),warningView=localizedStatus(li,i18n),descriptor=archive.warningDetails?.[index],key=`sourceArchive.warning.${descriptor?.code}`,issue=descriptor?.cause?libraryIssue(descriptor.cause):null;
    warningView.set(Object.hasOwn(schema,key)?{key,reasons:issue?[{key:issue.key,params:issue.params}]:[],details:issue?.details,codes:issue?.codes}:{key:'library.error.external',details:warning});warningViews.push(warningView);$('source-archive-warnings').append(li);
   }
   for(const[fileIndex,file]of files.entries()){
    const row=document.createElement('li'),info=document.createElement('div'),title=document.createElement('strong'),role=document.createElement('p'),note=document.createElement('p'),button=document.createElement('button');title.textContent=file.filename;info.append(title,role,note);button.className='button secondary';button.dataset.sourceFileIndex=String(fileIndex);button.addEventListener('click',()=>inspect(file));row.append(info,button);$('source-archive-files').append(row);fileViews.push({file,role,note,button});
   }
   status(pending?'sourceArchive.status.pendingCancelled':files.length?'sourceArchive.status.ready':'sourceArchive.status.empty');
  }catch(error){status({...libraryIssue(error),contextKey:'sourceArchive.status.archiveFailed'})}
  render();controls();
 }
 async function inspect(file){
  if(pending||!dialog.open)return;if(!sameContext()){invalidate('sourceArchive.status.refreshBeforeInspect');return}
  const request={generation:++generation};pending=request;prepared=null;$('source-archive-inspection').hidden=true;controls();status('sourceArchive.status.inspecting',{filename:file.filename});
  try{
   const result=await inspectFile(file);if(request.generation!==generation||!dialog.open)return;
   if(!sameContext()){invalidate('sourceArchive.status.changedDuringInspect');return}
   if(result.filename!==file.filename||result.mime!=='application/octet-stream'||!(result.bytes instanceof Uint8Array))throw sourceArchiveError('source_inspector_data','The inspector returned unexpected file data. Keep the full score JSON and retry.');
   prepared={file,result};const summary=sourceCheckSummary(file,result,i18n);render();$('source-archive-inspection').hidden=false;status(summary.mismatch?'sourceArchive.status.mismatch':'sourceArchive.status.inspected',{},summary.mismatch);
  }catch(error){if(request.generation===generation&&dialog.open)status({...libraryIssue(error),contextKey:'sourceArchive.status.inspectFailed'})}
  finally{if(pending===request)pending=null;controls();if(request.generation!==generation&&dialog.open&&sameContext()&&files.length)status('sourceArchive.status.cancelled')}
 }
 $('source-archive-download').addEventListener('click',()=>{
  if(pending||!prepared||!dialog.open)return;if(!sameContext()){invalidate('sourceArchive.status.changedBeforeDownload');return}
  const{file,result}=prepared,url=URL.createObjectURL(new Blob([result.bytes],{type:result.mime})),link=document.createElement('a');link.href=url;link.download=result.filename;link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);status('sourceArchive.status.downloaded',{filename:file.filename});
 });
 for(const id of ['source-archive-close','source-archive-done'])$(id).addEventListener('click',close);
 dialog.addEventListener('cancel',event=>{event.preventDefault();close()});$('source-archive-refresh').addEventListener('click',refresh);$('source-files-button').addEventListener('click',()=>{pausePlayback();if(!dialog.open)dialog.showModal();refresh()});
 const pagehide=()=>{if(dialog.open)close()};window?.addEventListener('pagehide',pagehide);render();controls();const unsubscribe=i18n.subscribe(render);
 return{scoreChanged(){controls();if(dialog.open&&!sameContext())invalidate('sourceArchive.status.scoreChanged')},close,destroy(){unsubscribe();window?.removeEventListener('pagehide',pagehide);close();dialog.remove()}};
}
