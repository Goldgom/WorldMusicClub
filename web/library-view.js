import {openScoreLibrary, LIBRARY_LIMITS} from './local-library.js';

export function librarySize(bytes) {
  return bytes < 1024 * 1024 ? `${(bytes / 1024).toFixed(1)} KiB` : `${(bytes / (1024 * 1024)).toFixed(1)} MiB`;
}
export function scoreFilename(score) {
  return `${String(score.id || 'saved-score').replace(/[^\w.-]/g, '_').slice(0,120)}.json`;
}
function download(text, filename) {
  const url=URL.createObjectURL(new Blob([text],{type:'application/json'}));
  const link=document.createElement('a');link.href=url;link.download=filename;link.click();
  setTimeout(()=>URL.revokeObjectURL(url),1000);
}

/** Explicit local snapshots. Closing cancels score activation/validation, never a committed write. */
export function setupScoreLibrary({getScore, onLoad, validate, pausePlayback, notice}) {
  const $=id=>document.getElementById(id);
  const dialog=document.createElement('dialog');dialog.id='score-library';dialog.className='review-dialog score-library';
  dialog.setAttribute('aria-labelledby','library-title');
  dialog.innerHTML=`<div class="review-header"><div><span class="eyebrow">SAVED ON THIS BROWSER · 本地收藏</span><h2 id="library-title">Your scores, close at hand.</h2></div><button id="library-close" class="button ghost" aria-label="Close saved scores">✕</button></div>
    <p class="review-explanation">Saved copies include the complete score and original source. Nothing is uploaded. Saving is always explicit; opening a file does not save it.</p>
    <div class="library-origin"><strong>Browser storage is not a permanent backup · 请另存备份</strong><p>This browser profile and origin only: <span id="library-origin"></span>. Another browser, profile, port or private window has a separate library. Clearing browser data or storage eviction can remove these copies.</p></div>
    <section class="library-save" aria-label="Save current score"><div><span class="eyebrow">CURRENT SCORE · 当前乐谱</span><strong id="library-current-title"></strong></div><label for="library-label">Copy label · 备注 (optional)<input id="library-label" type="text" maxlength="200" placeholder="For tomorrow’s practice"></label><button id="library-save-copy" class="button primary" data-library-action>Save new copy · 收藏</button><p>A new copy never replaces an existing one. Playback settings and take history are not included.</p></section>
    <div id="library-status" class="notice" role="status" aria-live="polite"></div>
    <div class="library-list-heading"><h3>Saved copies · 已收藏 <span id="library-count">0 / 100</span></h3><button id="library-refresh" class="button ghost" data-library-action>Refresh · 刷新</button></div>
    <ul id="library-list" class="saved-score-list" aria-label="Saved score copies"></ul><p id="library-empty" class="muted">No saved copies yet. Open a score, then save it here.</p>
    <section id="library-delete-confirm" class="library-delete-confirm" aria-labelledby="library-delete-title" hidden><h3 id="library-delete-title">Delete this saved copy?</h3><p id="library-delete-name"></p><p>This removes only this browser’s saved copy. Current practice and exported files stay available. Export a backup first if you need to keep it.</p><div><button id="library-delete-cancel" class="button secondary" data-library-action>Keep copy · 保留</button><button id="library-delete-submit" class="button secondary" data-library-action>Delete copy · 删除</button></div></section>
    <section class="library-backups" aria-label="Library backups"><h3>A file you can keep · 备份文件</h3><p>Backups include every saved source file or image. Share them only when you intend to share all included material and have the necessary rights. Restore validates every score with the local Rust engine, then adds new copies atomically.</p><div><button id="library-export-backup" class="button secondary" data-library-action>Export backup · 导出备份</button><button id="library-import-backup" class="button secondary" data-library-action>Restore backup · 恢复备份</button><input id="library-backup-file" type="file" accept="application/json,.json" hidden></div><p>Limits: 100 copies · 8 MiB per score · 32 MiB total · 40 MiB backup file</p></section>`;
  document.body.append(dialog);$('library-origin').textContent=location.origin;
  let libraryPromise=null,busy=false,controller=null,pendingDelete=null,view=0,refreshId=0,displayedScore=null;
  const getLibrary=()=>libraryPromise??=(openScoreLibrary().catch(error=>{libraryPromise=null;throw error}));
  function status(message,error=false){$('library-status').textContent=message;$('library-status').classList.toggle('error',error)}
  function controls(){for(const button of dialog.querySelectorAll('[data-library-action]'))button.disabled=busy;$('library-save-copy').disabled=busy||!getScore();$('library-label').disabled=busy;dialog.setAttribute('aria-busy',String(busy))}
  function scoreChanged(){
    const current=getScore();if(current===displayedScore)return;displayedScore=current;
    $('library-current-title').textContent=current?.title||'No score is open';$('library-label').value='';controls();
    if(dialog.open)status(busy?'Current score changed. A save already in progress keeps its earlier snapshot; review the displayed score before another save.':'Current score changed. Review the displayed title and add a new label before saving.');
  }
  function hideDelete(restoreFocus=false){const previous=pendingDelete;pendingDelete=null;$('library-delete-confirm').hidden=true;if(restoreFocus){const row=[...$('library-list').children].find(item=>item.dataset.libraryKey===previous?.key);(row?.querySelector('[data-library-delete]')||$('library-refresh')).focus()}}
  function close(){view++;controller?.abort();hideDelete();dialog.close()}
  $('library-close').addEventListener('click',close);
  dialog.addEventListener('cancel',event=>{event.preventDefault();close()});
  // Writes already started remain atomic even after closing. Their result is still reported.
  async function run(message,task){
    if(busy)return;
    busy=true;controller=new AbortController();const signal=controller.signal;status(message);controls();
    try{await task(signal)}
    catch(error){if(!signal.aborted||error.name!=='AbortError'&&!/was not restored:.*abort/i.test(error.message)){status(error.message,true);if(!dialog.open)notice(error.message,true)}}
    finally{busy=false;controller=null;controls()}
  }
  async function refresh(){
    const request=++refreshId,currentView=view;
    const rows=await(await getLibrary()).list();
    if(request!==refreshId||currentView!==view||!dialog.open)return;
    $('library-list').replaceChildren();$('library-count').textContent=`${rows.length} / 100 · ${librarySize(rows.reduce((sum,row)=>sum+row.bytes,0))}`;$('library-empty').hidden=rows.length>0;
    for(const row of rows){
      const item=document.createElement('li');item.dataset.libraryKey=row.key;
      const info=document.createElement('div'),title=document.createElement('strong'),meta=document.createElement('p');
      title.textContent=row.label||row.title;meta.textContent=`${row.label?`${row.title} · `:''}${row.composer||'Composer unspecified'} · ${librarySize(row.bytes)} · ${new Date(row.updated_at).toLocaleString()}`;
      info.append(title,meta);const actions=document.createElement('div');actions.className='saved-score-actions';
      const open=document.createElement('button');open.textContent='Open · 打开';open.className='button secondary';open.dataset.libraryAction='';open.dataset.libraryOpen='';open.setAttribute('aria-label',`Open saved copy ${row.label||row.title}`);
      open.addEventListener('click',()=>run('Reading the saved copy and validating it with Rust…',async signal=>{
        const saved=await(await getLibrary()).get(row.key);signal.throwIfAborted();
        if(!saved)throw Error('This copy was removed in another tab. Refresh the saved-score list.');
        const loaded=await onLoad(saved.score,signal);signal.throwIfAborted();
        if(!loaded)throw Error('This saved score could not be loaded. The previous score remains available; check the score error and export a backup before editing it.');
        close();notice(`Opened saved copy “${saved.label||saved.title}”. The saved copy remains unchanged.`);
      }));
      const exportOne=document.createElement('button');exportOne.textContent='Export';exportOne.className='button ghost';exportOne.dataset.libraryAction='';exportOne.dataset.libraryExport='';exportOne.setAttribute('aria-label',`Export saved copy ${row.label||row.title}`);
      exportOne.addEventListener('click',()=>run('Reading a complete score file…',async signal=>{const saved=await(await getLibrary()).get(row.key);signal.throwIfAborted();if(!saved)throw Error('This saved copy was removed. Refresh the list.');download(JSON.stringify(saved.score,null,2),scoreFilename(saved.score));status('Score file exported, including its original source.')}));
      const remove=document.createElement('button');remove.textContent='Delete';remove.className='button ghost';remove.dataset.libraryAction='';remove.dataset.libraryDelete='';remove.setAttribute('aria-label',`Delete saved copy ${row.label||row.title}`);
      remove.addEventListener('click',()=>{pendingDelete=row;$('library-delete-name').textContent=row.label||row.title;$('library-delete-confirm').hidden=false;$('library-delete-cancel').focus()});
      actions.append(open,exportOne,remove);item.append(info,actions);$('library-list').append(item);
    }
    controls();
  }
  $('library-button').addEventListener('click',()=>{
    pausePlayback();view++;hideDelete();displayedScore=getScore();$('library-current-title').textContent=displayedScore?.title||'No score is open';$('library-label').value='';dialog.showModal();controls();
    if(!busy)run('Reading your saved copies…',async()=>{await refresh();status('Ready. Only the copies listed here are saved in this browser.')});
  });
  $('library-refresh').addEventListener('click',()=>run('Refreshing saved copies…',async()=>{hideDelete();await refresh();status('List refreshed. Each operation checks for changes made in other tabs.')}));
  $('library-save-copy').addEventListener('click',()=>{
    const current=getScore();if(!current)return;
    if(current!==displayedScore){scoreChanged();status('The current score changed before saving. Review the displayed title, then choose Save new copy again.');return}
    const score=structuredClone(current),label=$('library-label').value.trim()||null;
    run('Saving a complete score copy…',async signal=>{
      const library=await getLibrary();signal.throwIfAborted();const saved=await library.save(score,{label});
      const message=`Saved “${saved.label||saved.title}” in this browser. Export a backup to keep a durable copy.`;
      if(dialog.open){await refresh();status(message)}else notice(message);
    });
  });
  $('library-delete-cancel').addEventListener('click',()=>hideDelete(true));
  $('library-delete-submit').addEventListener('click',()=>{
    const selected=pendingDelete;if(!selected)return;
    run('Removing the confirmed saved copy…',async signal=>{
      const library=await getLibrary();signal.throwIfAborted();const removed=await library.remove(selected.key,{expectedRevision:selected.revision});hideDelete();
      const message=removed?'Saved copy deleted. Current practice and exported files are unchanged.':'This copy was already removed in another tab.';
      if(dialog.open){await refresh();status(message)}else notice(message);
    });
  });
  $('library-export-backup').addEventListener('click',()=>run('Preparing a complete local backup…',async signal=>{
    const text=await(await getLibrary()).exportBackup();signal.throwIfAborted();download(text,'worldmusichub-library-backup.json');status('Backup exported. Keep this file somewhere safe; it includes all saved original sources.');
  }));
  $('library-import-backup').addEventListener('click',()=>$('library-backup-file').click());
  $('library-backup-file').addEventListener('change',()=>{
    const file=$('library-backup-file').files[0];$('library-backup-file').value='';if(!file||busy)return;
    run('Reading and validating the backup before any copies are added…',async signal=>{
      if(file.size>LIBRARY_LIMITS.backupBytes)throw Error('Backup exceeds 40 MiB. Choose a smaller WorldMusicHub library-backup JSON file.');
      const text=await file.text();signal.throwIfAborted();let checked=0;
      const library=await getLibrary();signal.throwIfAborted();
      const rows=await library.restoreBackup(text,{validate:async score=>{signal.throwIfAborted();status(`Validating backup score ${++checked} with the local Rust engine…`);await validate(score,signal);signal.throwIfAborted();return true}});
      const message=`Restored ${rows.length} new copies. Existing copies were preserved; open a restored copy when ready.`;
      if(dialog.open){await refresh();status(message)}else notice(message);
    });
  });
  return{close,scoreChanged};
}
