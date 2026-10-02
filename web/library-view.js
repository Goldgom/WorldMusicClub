import {openScoreLibrary, LIBRARY_LIMITS, libraryError} from './local-library.js';
import {prepareScoreDownload} from './score-download.js';
import {getAppI18n} from './app-locale.js';
import {localizeLibraryElements,localizedStatus,libraryIssue} from './library-locale.js';

export function librarySize(bytes,i18n=getAppI18n()) {
  const value=bytes<1024*1024?bytes/1024:bytes/(1024*1024);
  return `${i18n.formatNumber(value,{minimumFractionDigits:1,maximumFractionDigits:1})} ${bytes<1024*1024?'KiB':'MiB'}`;
}
export function scoreFilename(score) {
  return `${String(score.id || 'saved-score').replace(/[^\w.-]/g, '_').slice(0,120)}.json`;
}
function download(document,text,filename) {
  const url=URL.createObjectURL(new Blob([text],{type:'application/json'}));
  const link=document.createElement('a');link.href=url;link.download=filename;link.click();
  setTimeout(()=>URL.revokeObjectURL(url),1000);
}

/** Explicit local snapshots. Closing cancels score activation/validation, never a committed write. */
export function setupScoreLibrary({getScore,onLoad,validate,pausePlayback,notice,document=globalThis.document,i18n=getAppI18n(document),openLibrary=openScoreLibrary}) {
  const $=id=>document.getElementById(id),t=(key,params)=>i18n.t(key,params);
  const dialog=document.createElement('dialog');dialog.id='score-library';dialog.className='review-dialog score-library';
  dialog.setAttribute('aria-labelledby','library-title');dialog.style.overflowWrap='anywhere';
  dialog.innerHTML=`<div class="review-header"><div><span class="eyebrow" data-library-text="library.eyebrow"></span><h2 id="library-title" data-library-text="library.title"></h2></div><button id="library-close" class="button ghost" data-library-aria="library.closeAria">✕</button></div>
    <p class="review-explanation session-replacement-note" data-library-text="library.replacement"></p><p class="review-explanation" data-library-text="library.explanation"></p>
    <div class="library-origin"><strong data-library-text="library.backupWarning"></strong><p><span data-library-text="library.originBefore"></span> <span id="library-origin"></span>. <span data-library-text="library.originAfter"></span></p></div>
    <section class="library-save" data-library-aria="library.saveAria"><div><span class="eyebrow" data-library-text="library.current"></span><strong id="library-current-title"></strong></div><label for="library-label"><span data-library-text="library.label"></span><input id="library-label" type="text" maxlength="200" data-library-placeholder="library.placeholder"></label><button id="library-save-copy" class="button primary" data-library-action data-library-text="library.save"></button><p data-library-text="library.saveHelp"></p></section>
    <div id="library-status" class="notice" role="status" aria-live="polite"></div>
    <div class="library-list-heading"><h3><span data-library-text="library.saved"></span> <span id="library-count"></span></h3><button id="library-refresh" class="button ghost" data-library-action data-library-text="library.refresh"></button></div>
    <ul id="library-list" class="saved-score-list" data-library-aria="library.listAria"></ul><p id="library-empty" class="muted" data-library-text="library.empty"></p>
    <section id="library-delete-confirm" class="library-delete-confirm" aria-labelledby="library-delete-title" hidden><h3 id="library-delete-title" data-library-text="library.deleteTitle"></h3><p id="library-delete-name"></p><p data-library-text="library.deleteHelp"></p><div><button id="library-delete-cancel" class="button secondary" data-library-action data-library-text="library.keep"></button><button id="library-delete-submit" class="button secondary" data-library-action data-library-text="library.delete"></button></div></section>
    <section class="library-backups" data-library-aria="library.backupsAria"><h3 data-library-text="library.backupsTitle"></h3><p data-library-text="library.backupsHelp"></p><div><button id="library-export-backup" class="button secondary" data-library-action data-library-text="library.exportBackup"></button><button id="library-import-backup" class="button secondary" data-library-action data-library-text="library.restoreBackup"></button><input id="library-backup-file" type="file" accept="application/json,.json" hidden></div><p data-library-text="library.limits"></p></section>`;
  document.body.append(dialog);$('library-origin').textContent=document.defaultView?.location?.origin||globalThis.location?.origin||'';
  let libraryPromise=null,busy=false,controller=null,pendingDelete=null,view=0,refreshId=0,displayedScore=null,rows=[],rowViews=[];
  const getLibrary=()=>libraryPromise??=(openLibrary().catch(error=>{libraryPromise=null;throw error}));
  const statusView=localizedStatus($('library-status'),i18n),status=(key,params={},error=false)=>statusView.set(key,params,error);
  function controls(){for(const button of dialog.querySelectorAll('[data-library-action]'))button.disabled=busy;$('library-save-copy').disabled=busy||!getScore();$('library-label').disabled=busy;dialog.setAttribute('aria-busy',String(busy))}
  function render(){
    localizeLibraryElements(dialog,i18n);$('library-current-title').textContent=displayedScore?.title||t('library.noScore');
    $('library-count').textContent=t('library.count',{count:rows.length,size:librarySize(rows.reduce((sum,row)=>sum+row.bytes,0),i18n)});
    for(const {row,meta,open,exportOne,remove}of rowViews){
      meta.textContent=`${row.label?`${row.title} · `:''}${row.composer||t('library.composerUnknown')} · ${librarySize(row.bytes,i18n)} · ${i18n.formatDateTime(row.updated_at)}`;
      for(const [button,key]of [[open,'open'],[exportOne,'export'],[remove,'remove']])button.textContent=t(`library.${key}`);
      for(const [button,key]of [[open,'openAria'],[exportOne,'exportAria'],[remove,'deleteAria']])button.setAttribute('aria-label',t(`library.${key}`,{title:row.label||row.title}));
    }
    statusView.render();
  }
  function scoreChanged(){
    const current=getScore();if(current===displayedScore)return;displayedScore=current;
    $('library-current-title').textContent=current?.title||t('library.noScore');$('library-label').value='';controls();
    if(dialog.open)status(busy?'library.status.changedBusy':'library.status.changed');
  }
  function hideDelete(restoreFocus=false){const previous=pendingDelete;pendingDelete=null;$('library-delete-confirm').hidden=true;if(restoreFocus){const row=[...$('library-list').children].find(item=>item.dataset.libraryKey===previous?.key);(row?.querySelector('[data-library-delete]')||$('library-refresh')).focus()}}
  function close(){view++;controller?.abort();hideDelete();dialog.close()}
  $('library-close').addEventListener('click',close);
  dialog.addEventListener('cancel',event=>{event.preventDefault();close()});
  // Writes already started remain atomic even after closing. Their result is still reported.
  async function run(key,task){
    if(busy)return;
    busy=true;controller=new AbortController();const signal=controller.signal;status(key);controls();
    try{await task(signal)}
    catch(error){
      // Only the caller's cancellation may suppress its known cancellation error.
      if(!(signal.aborted&&(error?.name==='AbortError'||error?.code==='library_restore_aborted'))){
        const issue=libraryIssue(error);status(issue);if(!dialog.open)notice(statusView.message(issue),true);
      }
    }
    finally{busy=false;controller=null;controls()}
  }
  async function refresh(){
    const request=++refreshId,currentView=view,next=await(await getLibrary()).list();
    if(request!==refreshId||currentView!==view||!dialog.open)return;
    rows=next;rowViews=[];$('library-list').replaceChildren();$('library-empty').hidden=rows.length>0;
    for(const row of rows){
      const item=document.createElement('li');item.dataset.libraryKey=row.key;
      const info=document.createElement('div'),title=document.createElement('strong'),meta=document.createElement('p');
      title.textContent=row.label||row.title;info.append(title,meta);const actions=document.createElement('div');actions.className='saved-score-actions';
      const open=document.createElement('button');open.className='button secondary';open.dataset.libraryAction='';open.dataset.libraryOpen='';
      open.addEventListener('click',()=>run('library.status.opening',async signal=>{
        const saved=await(await getLibrary()).get(row.key);signal.throwIfAborted();
        if(!saved)throw libraryError('library_removed','This copy was removed in another tab. Refresh the saved-score list.');
        const loaded=await onLoad(saved.score,signal);signal.throwIfAborted();
        if(!loaded)throw libraryError('library_load_failed','This saved score could not be loaded. The previous score remains available; check the score error and export a backup before editing it.');
        close();notice(t('library.status.opened',{title:saved.label||saved.title}));
      }));
      const exportOne=document.createElement('button');exportOne.className='button ghost';exportOne.dataset.libraryAction='';exportOne.dataset.libraryExport='';
      exportOne.addEventListener('click',()=>run('library.status.exporting',async signal=>{
        const saved=await(await getLibrary()).get(row.key);signal.throwIfAborted();if(!saved)throw libraryError('library_removed','This saved copy was removed. Refresh the list.');
        const prepared=prepareScoreDownload(saved.score);download(document,prepared.text,scoreFilename(saved.score));
        status(prepared.reimportable===false?'library.status.downloadOversize':prepared.formatting==='compact'?'library.status.downloadCompact':'library.status.downloadReadable',{},prepared.reimportable===false);
      }));
      const remove=document.createElement('button');remove.className='button ghost';remove.dataset.libraryAction='';remove.dataset.libraryDelete='';
      remove.addEventListener('click',()=>{pendingDelete=row;$('library-delete-name').textContent=row.label||row.title;$('library-delete-confirm').hidden=false;$('library-delete-cancel').focus()});
      actions.append(open,exportOne,remove);item.append(info,actions);$('library-list').append(item);rowViews.push({row,meta,open,exportOne,remove});
    }
    render();controls();
  }
  $('library-button').addEventListener('click',()=>{
    pausePlayback();view++;hideDelete();displayedScore=getScore();$('library-current-title').textContent=displayedScore?.title||t('library.noScore');$('library-label').value='';dialog.showModal();controls();
    if(!busy)run('library.status.reading',async()=>{await refresh();status('library.status.ready')});
  });
  $('library-refresh').addEventListener('click',()=>run('library.status.refreshing',async()=>{hideDelete();await refresh();status('library.status.refreshed')}));
  $('library-save-copy').addEventListener('click',()=>{
    const current=getScore();if(!current)return;
    if(current!==displayedScore){scoreChanged();status('library.status.changedBeforeSave');return}
    const score=structuredClone(current),label=$('library-label').value.trim()||null;
    run('library.status.saving',async signal=>{
      const library=await getLibrary();signal.throwIfAborted();const saved=await library.save(score,{label}),params={title:saved.label||saved.title};
      if(dialog.open){await refresh();status('library.status.saved',params)}else notice(t('library.status.saved',params));
    });
  });
  $('library-delete-cancel').addEventListener('click',()=>hideDelete(true));
  $('library-delete-submit').addEventListener('click',()=>{
    const selected=pendingDelete;if(!selected)return;
    run('library.status.deleting',async signal=>{
      const library=await getLibrary();signal.throwIfAborted();const removed=await library.remove(selected.key,{expectedRevision:selected.revision});hideDelete();
      const key=removed?'library.status.deleted':'library.status.alreadyDeleted';
      if(dialog.open){await refresh();status(key)}else notice(t(key));
    });
  });
  $('library-export-backup').addEventListener('click',()=>run('library.status.preparingBackup',async signal=>{
    const text=await(await getLibrary()).exportBackup();signal.throwIfAborted();download(document,text,'worldmusichub-library-backup.json');status('library.status.backupExported');
  }));
  $('library-import-backup').addEventListener('click',()=>$('library-backup-file').click());
  $('library-backup-file').addEventListener('change',()=>{
    const file=$('library-backup-file').files[0];$('library-backup-file').value='';if(!file||busy)return;
    run('library.status.restoring',async signal=>{
      if(file.size>LIBRARY_LIMITS.backupBytes)throw libraryError('library_import_limit','Backup exceeds 40 MiB. Choose a smaller WorldMusicHub library-backup JSON file.');
      const text=await file.text();signal.throwIfAborted();let checked=0;
      const library=await getLibrary();signal.throwIfAborted();
      const restored=await library.restoreBackup(text,{validate:async score=>{signal.throwIfAborted();status('library.status.validating',{count:++checked});await validate(score,signal);signal.throwIfAborted();return true}}),params={count:restored.length};
      if(dialog.open){await refresh();status('library.status.restored',params)}else notice(t('library.status.restored',params));
    });
  });
  render();const unsubscribe=i18n.subscribe(render);
  return{close,scoreChanged,destroy(){unsubscribe();close();dialog.remove()}};
}
