import {getAppI18n} from './app-locale.js';

const copy={
 'zh-CN':{
  title:'谱面保存位置',saveCurrent:'保存当前完整谱面',checking:'正在确认保存位置…',unknown:'保存位置尚未确认',native:'游戏的原生谱面文件夹',browser:'当前浏览器的 IndexedDB',browserHelp:'谱面只保存在当前浏览器和网址中；清理浏览器数据可能删除它们。备份通过浏览器下载，不代表已写入游戏文件夹。',nativeHelp:'完整谱面和保留的原始文件保存在下方目录，并保留一份同盘备份。换设备或磁盘损坏仍需独立导出的备份。',pathPending:'原生目录尚未读取，请刷新列表',rescan:'重新扫描谱面',backup:'导出全部谱面备份',choose:'更改谱面文件夹（尚未提供）',open:'打开文件夹（尚未提供）',planned:'当前版本尚未接入原生系统文件夹操作，旧目录不会被移动或删除。',count:n=>`已保存 ${n} 首谱面`,ready:'谱面列表已读取',reading:'正在读取已保存的谱面…',saving:t=>`正在保存“${t}”…`,saved:t=>`“${t}”已保存到游戏谱面文件夹`,browserSaved:t=>`“${t}”已保存在当前浏览器中`,duplicate:t=>`“${t}”的完整谱面已在列表中，没有重复创建副本`,conflict:t=>`“${t}”与已存谱面使用相同 ID，但内容不同；当前导入尚未保存`,failed:t=>`“${t}”尚未保存。当前谱面仍可使用，请重试，或使用当前谱面的 JSON 导出保留文件`,uncertain:t=>`“${t}”是否已保存尚未确认。请重新扫描；当前谱面仍可使用`,keepBoth:'保留两个版本',retry:'重试保存',details:'原始详情',listFailed:'未能读取谱面列表；先前显示的列表可能不是最新状态',issueTitle:'需要注意的保存问题',backupPrepared:'已准备完整备份',downloadRequested:'已请求下载备份；请在浏览器中确认文件已保存',backupFailed:'备份未能完成，请查看详情',busyBackup:'正在准备全部谱面备份…',backupWarning:'备份包含全部原始谱面、图片和附件；请只分享有意公开且有权分享的内容。',error:'保存操作未能完成'
 },
 en:{
  title:'Score storage',saveCurrent:'Save current complete score',checking:'Checking the storage location…',unknown:'Storage location is unconfirmed',native:'Native game score folder',browser:'IndexedDB in this browser',browserHelp:'Scores belong to this browser profile and origin. Clearing browser data may remove them. Backups are browser downloads, not writes to the native game folder.',nativeHelp:'Complete scores and retained original files are stored below, with a second copy on the same disk. Export an independent backup for another device or disk failure.',pathPending:'The native directory has not been read. Refresh the list.',rescan:'Rescan saved scores',backup:'Export all scores as backup',choose:'Change score folder (not available yet)',open:'Open folder (not available yet)',planned:'Native operating-system folder controls are not connected yet. The old directory is never moved or deleted.',count:n=>`${n} saved scores`,ready:'Saved-score list loaded',reading:'Reading saved scores…',saving:t=>`Saving “${t}”…`,saved:t=>`“${t}” was saved to the native game score folder`,browserSaved:t=>`“${t}” was saved in this browser`,duplicate:t=>`The complete score “${t}” is already saved; no duplicate copy was created`,conflict:t=>`“${t}” shares an ID with a saved score but has different content. This import is not saved yet.`,failed:t=>`“${t}” is not saved. The current score remains usable; retry or use its JSON export to keep a file.`,uncertain:t=>`Whether “${t}” was saved is unconfirmed. Rescan the library; the current score remains usable.`,keepBoth:'Keep both editions',retry:'Retry save',details:'Original details',listFailed:'The saved-score list could not be read. Previously shown entries may be out of date.',issueTitle:'Storage issues to review',backupPrepared:'Complete backup prepared',downloadRequested:'Backup download requested. Confirm that your browser saved the file.',backupFailed:'The backup could not be completed. See the details.',busyBackup:'Preparing the complete score backup…',backupWarning:'Backups include original scores, images and attachments. Share only content you intend to disclose and have the right to share.',error:'The storage operation could not be completed'
 }
};
function requestDownload(document,{text,filename}){
 const url=URL.createObjectURL(new Blob([text],{type:'application/json'}));
 const link=document.createElement('a');link.href=url;link.download=filename;link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
}

/** Reuse this for an app notice even when the settings panel is closed. */
export function describePersistenceResult(result,{kind,locale='zh-CN'}={}){
 const t=copy[locale==='en'?'en':'zh-CN'],title=result?.title||'';
 if(result?.status==='saved')return kind==='native'?t.saved(title):t.browserSaved(title);
 return typeof t[result?.status]==='function'?t[result.status](title):t.error;
}

/** Always-visible inventory status in the song browser, including read failures. */
export function setupScoreStorageLobbyStatus({model,host,onConfigure,document=globalThis.document,i18n=getAppI18n(document)}){
 const row=document.createElement('div');row.className='score-storage-lobby-status';
 const status=document.createElement('p');status.id='saved-library-status';status.setAttribute('role','status');status.setAttribute('aria-live','polite');
 const button=document.createElement('button');button.type='button';button.className='button ghost compact';button.addEventListener('click',onConfigure);row.append(status,button);host.append(row);
 let state=model.snapshot();
 const render=()=>{const t=copy[i18n.locale==='en'?'en':'zh-CN'];button.textContent=t.title;status.textContent=state.error?t.listFailed:state.reading?t.reading:state.issues.length?`${t.count(state.entries.length)} · ${t.issueTitle}`:state.kind?`${state.kind==='native'?t.native:t.browser} · ${t.count(state.entries.length)}`:t.checking;row.dataset.storage=state.storage||'unconfirmed';row.dataset.error=String(Boolean(state.error||state.issues.length));};
 const unsubscribe=model.subscribe(next=>{state=next;render()}),unlocale=i18n.subscribe(render);render();
 return{destroy(){unsubscribe();unlocale();row.remove()}};
}

/** A mountable settings/status section. No app, game-shell, playback or MIDI IO. */
export function setupScoreStorageView({model,host,document=globalThis.document,i18n=getAppI18n(document),download=payload=>requestDownload(document,payload),getScore=null,onSaveStart=()=>null,onSaveResult=()=>{}}){
 if(!host)throw new TypeError('A settings/status host is required.');
 const element=(tag,className)=>{const node=document.createElement(tag);if(className)node.className=className;return node};
 const section=element('section','score-storage-settings');section.dataset.scoreStorage='';
 const heading=element('h3'),location=element('strong'),path=element('p','score-storage-path'),help=element('p','muted'),count=element('p'),status=element('p','score-storage-status');status.setAttribute('role','status');status.setAttribute('aria-live','polite');
 const actions=element('div','score-storage-actions'),buttons={};
 for(const name of ['saveCurrent','rescan','backup','retry','keepBoth','choose','open']){const button=element('button','button secondary');button.type='button';button.dataset.storageAction=name;buttons[name]=button;actions.append(button)}
 const planned=element('p','muted'),warning=element('p','muted'),issues=element('ul','score-storage-issues'),detail=element('details','score-storage-detail'),summary=element('summary'),original=element('p');detail.append(summary,original);
 section.append(heading,location,path,help,count,status,actions,planned,warning,issues,detail);host.append(section);
 let state=model.snapshot(),destroyed=false,backupState=null,backupError=null,lastSave=JSON.stringify(state.saveResult);
 const words=()=>copy[i18n.locale==='en'?'en':'zh-CN'];
 function render(){
  if(destroyed)return;const t=words(),busy=state.saving||state.reading||state.exporting;
  heading.textContent=t.title;location.textContent=state.kind==='native'?t.native:state.kind==='browser'?t.browser:state.phase==='loading'?t.checking:t.unknown;
  path.textContent=state.kind==='native'?(state.directory||t.pathPending):state.kind==='browser'?(state.origin||''):'';
  help.textContent=state.kind==='native'?t.nativeHelp:state.kind==='browser'?t.browserHelp:'';count.textContent=t.count(state.entries.length);
  for(const [name,button]of Object.entries(buttons)){button.textContent=t[name];button.disabled=busy;button.title=''}
  buttons.saveCurrent.hidden=typeof getScore!=='function';buttons.saveCurrent.disabled=busy||!getScore?.();
  buttons.choose.disabled=true;buttons.open.disabled=true;buttons.choose.title=t.planned;buttons.open.title=t.planned;
  buttons.backup.disabled=busy||state.phase!=='ready'||!state.entries.length||!state.capabilities.backup;
  const result=state.saveResult;buttons.retry.hidden=!['failed','uncertain'].includes(result?.status);buttons.keepBoth.hidden=result?.status!=='conflict';
  planned.textContent=t.planned;warning.textContent=t.backupWarning;summary.textContent=t.details;
  let message=t.ready;
  if(state.phase==='idle'||state.phase==='loading')message=t.checking;
  if(state.reading)message=t.reading;
  if(result)message=describePersistenceResult(result,{kind:state.kind,locale:i18n.locale});
  if(state.error)message=t.listFailed;
  if(backupState)message=t[backupState];
  if(state.exporting)message=t.busyBackup;
  status.textContent=message;status.dataset.persistence=result?.persistence||'unknown';section.setAttribute('aria-busy',String(busy));
  const error=backupError||state.error||(['failed','uncertain','conflict','duplicate'].includes(result?.status)?result:null);
  detail.hidden=!error;original.textContent=error?`${error.message||''}${error.code?` (${error.code})`:''}`:'';
  const signature=JSON.stringify([i18n.locale,state.issues]);
  if(issues.dataset.signature!==signature){issues.replaceChildren();issues.dataset.signature=signature;for(const issue of state.issues){const item=element('li');item.textContent=`${issue.message||''} (${issue.code||'library_issue'})`;issues.append(item)}}
  issues.hidden=!state.issues.length;issues.setAttribute('aria-label',t.issueTitle);
 }
 // Capture app ownership synchronously, before the model queues or publishes.
 // Each completion receives its own context rather than the latest UI state.
 const report=(action,operation)=>{if(destroyed||state.saving)return;const context=onSaveStart(action);void operation().then(result=>{if(!destroyed&&result.status!=='skipped')onSaveResult(result,context)})};
 buttons.saveCurrent.addEventListener('click',()=>{const score=getScore?.();if(!score||state.saving)return;backupState=null;backupError=null;report('saveCurrent',()=>model.save(score))});
 buttons.rescan.addEventListener('click',()=>{backupState=null;backupError=null;void model.rescan()});
 buttons.retry.addEventListener('click',()=>{backupState=null;backupError=null;report('retry',()=>model.retrySave())});
 buttons.keepBoth.addEventListener('click',()=>{backupState=null;backupError=null;report('keepBoth',()=>model.keepBoth())});
 buttons.backup.addEventListener('click',async()=>{
  if(state.exporting||destroyed)return;backupState=null;backupError=null;
  try{const prepared=await model.exportBackup();if(destroyed)return;await download(prepared);if(destroyed)return;backupState='downloadRequested'}
  catch(error){if(destroyed)return;backupState='backupFailed';backupError={message:error.message,code:error.code}}
  render();
 });
 const unsubscribe=model.subscribe(next=>{const signature=JSON.stringify(next.saveResult);if(signature!==lastSave){backupState=null;backupError=null;lastSave=signature}state=next;render()}),unlocale=i18n.subscribe(render);render();
 return{element:section,render,destroy(){destroyed=true;unsubscribe();unlocale();section.remove()}};
}
