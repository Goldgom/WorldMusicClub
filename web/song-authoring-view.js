import {SongAuthoringModel} from './song-authoring-model.js';
import {AUTHORING_ERRORS,AUTHORING_DIAGNOSTICS,authoringText} from './song-authoring-locale.js';
import {getAppI18n} from './app-locale.js';

/** A persistent screen with draft-only controls; no audio or score-controller hooks. */
export function setupSongAuthoringView({document=globalThis.document,i18n=getAppI18n(document),model,getStorageKind,onCommitted,onHome=()=>{},onLibrary=()=>{},onBrowse=()=>{},download=downloadPackage}={}){
 const queue=model||new SongAuthoringModel({getStorageKind,onCommitted}),make=(tag,className)=>{const node=document.createElement(tag);if(className)node.className=className;return node;};
 const screen=make('section','song-authoring-screen');screen.id='song-authoring-screen';screen.hidden=true;screen.setAttribute('role','main');screen.setAttribute('aria-labelledby','song-authoring-title');
 screen.innerHTML='<header class="authoring-heading"><div><span class="eyebrow" data-authoring-text="eyebrow"></span><h1 id="song-authoring-title" tabindex="-1" data-authoring-text="title"></h1></div><div class="authoring-actions"><button id="authoring-home" class="button secondary" data-authoring-text="home"></button><button id="authoring-library" class="button secondary" data-authoring-text="library"></button></div></header><p class="authoring-intro" data-authoring-text="intro"></p><section class="authoring-controls" aria-labelledby="authoring-picker-label"><h2 id="authoring-picker-label" data-authoring-text="choose"></h2><p data-authoring-text="limits"></p><div class="authoring-actions"><button id="authoring-choose" type="button" class="button primary" data-authoring-text="choose"></button><input id="authoring-files" type="file" accept=".mid,.midi,audio/midi,audio/x-midi" multiple hidden><button id="authoring-save-all" type="button" class="button secondary" data-authoring-text="saveAll"></button><button id="authoring-cancel" type="button" class="button secondary" data-authoring-text="cancel"></button><button id="authoring-rescan" type="button" class="button ghost" data-authoring-text="rescan"></button></div><p data-authoring-text="noSave"></p><p id="authoring-storage"></p><p id="authoring-status" role="status" aria-live="polite"></p><div id="authoring-error" role="alert" hidden></div><div id="authoring-refresh-error" role="alert" hidden></div></section><div id="authoring-songs"></div><p class="authoring-scope" data-authoring-text="scope"></p>';
 document.querySelector('.app-shell').append(screen);
 const $=id=>document.getElementById(id),rows=new Map();let state=queue.snapshot(),active=false,destroyed=false;
 const text=(key,params)=>authoringText(i18n.locale,key,params);
 function button(key,handler,className='secondary'){const node=make('button',`button ${className}`);node.type='button';node.dataset.authoringText=key;node.addEventListener('click',handler);return node;}
 function problem(node,error){
  node.hidden=!error;const signature=JSON.stringify(error);if(node.dataset.problem!==signature){node.dataset.problem=signature;node.replaceChildren();if(error){const summary=make('p'),details=make('details'),label=make('summary'),original=make('p');summary.dataset.authoringError=error.code||'';label.dataset.authoringText='originalDetails';original.textContent=`${error.message||''}${error.code?` (${error.code})`:''}`;details.append(label,original);node.append(summary,details);}}
  if(error)node.querySelector('[data-authoring-error]').textContent=text(AUTHORING_ERRORS[error.code]||'error');
 }
 function buildRow(row){
  const section=make('article','authoring-song');section.dataset.authoringSong=row.id;
  const heading=make('h2'),source=make('p','authoring-source'),phase=make('p','authoring-phase'),classification=make('strong','authoring-classification'),help=make('p'),editor=make('label','authoring-title-editor'),titleLabel=make('span'),input=make('input'),titleHelp=make('p','authoring-title-help');
  phase.setAttribute('role','status');titleLabel.dataset.authoringText='titleLabel';input.type='text';input.maxLength=1000;input.id=`authoring-title-${row.id}`;input.setAttribute('aria-describedby',`authoring-title-help-${row.id}`);titleHelp.id=`authoring-title-help-${row.id}`;titleHelp.dataset.authoringText='titleHelp';editor.append(titleLabel,input);input.addEventListener('input',()=>queue.editTitle(row.id,input.value));
  const actions=make('div','authoring-actions'),recheck=button('recheck',()=>void queue.retry(row.id)),save=button('save',()=>void queue.save(row.id),'primary'),keep=button('keepBoth',()=>void queue.save(row.id,{keepBoth:true})),retrySave=button('retrySave',()=>void queue.save(row.id)),exportButton=button('export',()=>void exportRow(row.id)),browse=button('browse',()=>{const selected=state.rows.find(item=>item.id===row.id);if(selected?.result?.entry&&['saved','duplicate'].includes(selected.phase))onBrowse(`native:${selected.result.entry.key}`);});
  recheck.dataset.authoringRecheck=row.id;save.dataset.authoringSave=row.id;keep.dataset.authoringKeepBoth=row.id;retrySave.dataset.authoringRetrySave=row.id;exportButton.dataset.authoringExport=row.id;browse.dataset.authoringBrowse=row.id;actions.append(recheck,save,keep,retrySave,exportButton,browse);
  const inventory=make('details','authoring-inventory'),inventoryLabel=make('summary'),inventoryBody=make('div'),notes=make('details','authoring-notes'),notesLabel=make('summary'),notesBody=make('div'),error=make('div','authoring-problem'),uncertain=make('p','authoring-uncertain'),downloaded=make('p','authoring-download');
  inventoryLabel.dataset.authoringText='inventory';notesLabel.dataset.authoringText='diagnostics';uncertain.dataset.authoringText='uncertainHelp';downloaded.dataset.authoringText='downloaded';error.setAttribute('role','alert');inventory.append(inventoryLabel,inventoryBody);notes.append(notesLabel,notesBody);
  section.append(heading,source,phase,classification,help,editor,titleHelp,actions,uncertain,error,downloaded,inventory,notes);$('authoring-songs').append(section);
  const item={section,heading,source,phase,classification,help,input,recheck,save,keep,retrySave,exportButton,browse,inventory,inventoryBody,notesBody,error,uncertain,downloaded,signature:null};rows.set(row.id,item);return item;
 }
 function inventoryContent(target,draft){
  target.replaceChildren();if(!draft?.inventory){const empty=make('p');empty.textContent=text('noInventory');target.append(empty);return;}
  const inventory=draft.inventory,total=make('p','authoring-totals');total.textContent=text('totals',{tracks:inventory.source_tracks,events:inventory.source_events,parts:inventory.parts.length,attacks:inventory.key_attacks,releases:inventory.key_releases});target.append(total);
  const list=make('ol','authoring-track-list');
  for(const track of inventory.tracks){
   const node=make('li'),name=make('strong'),counts=make('p'),channels=make('ul');name.textContent=`${text('track',{index:track.source_index+1})}${track.name?` · ${track.name}`:''}`;counts.textContent=text('trackCounts',{events:track.source_event_count,attacks:track.key_attacks,releases:track.key_releases});node.append(name,counts);
   for(const channel of track.channels){const line=make('li');line.textContent=text('channel',{index:channel.channel+1,events:channel.source_event_count,attacks:channel.key_attacks,releases:channel.key_releases});channels.append(line);}
   if(!track.channels.length){const line=make('li');line.textContent=text('noChannels');channels.append(line);}
   for(const part of inventory.parts.filter(part=>part.track_id===track.track_id)){const line=make('li');line.textContent=`${text('part',{id:part.id,channel:part.channel+1})} · ${text(part.notation_available?'notation':'eventOnly')}`;channels.append(line);}
   node.append(channels);list.append(node);
  }
  const checksum=make('p','authoring-checksum');checksum.textContent=text('fingerprint',{hash:draft.source.sha256});target.append(list,checksum);
 }
 function notesContent(target,row){
  target.replaceChildren();const diagnostics=row.draft?.diagnostics||[],intro=make('p');intro.textContent=text(diagnostics.length?'genericDiagnostic':'noDiagnostics');target.append(intro);
  if(diagnostics.length){const notes=make('ul','authoring-diagnostic-list');for(const note of diagnostics){const item=make('li'),message=make('p');message.textContent=text(AUTHORING_DIAGNOSTICS[note.code]||'genericDiagnostic');item.append(message);if(Number.isSafeInteger(note.track_index)&&note.track_index>=0){const location=make('p');location.textContent=text('diagnosticTrack',{index:note.track_index+1});item.append(location);}notes.append(item);}target.append(notes);}
  if(row.result&&['retained_nonplayable','error'].includes(row.result.status)){const held=make('p');held.textContent=text('nativeHeld');target.append(held);}
  if(diagnostics.length||row.result?.message){const original=make('details'),label=make('summary'),list=make('ul');label.dataset.authoringText='originalDetails';original.append(label,list);for(const note of diagnostics){const line=make('li');line.textContent=`${note.code}: ${note.message}${note.action?` · ${note.action}`:''}${note.source_event_id?` · ${text('sourceEvent',{id:note.source_event_id})}`:''}`;list.append(line);}if(row.result?.message){const line=make('li');line.textContent=`${row.result.code}: ${row.result.message}`;list.append(line);}target.append(original);}
 }
 function render(){
  if(destroyed)return;screen.dataset.phase=state.phase;const busy=state.phase==='converting'||state.pendingWrites>0||state.phase==='saving';
  $('authoring-status').textContent=text(state.phase);$('authoring-storage').textContent=text(state.kind||'unknown');$('authoring-choose').disabled=state.pendingWrites>0;$('authoring-files').disabled=state.pendingWrites>0;
  $('authoring-save-all').hidden=state.kind!=='native';$('authoring-save-all').disabled=busy||!state.rows.some(row=>row.phase==='ready');$('authoring-cancel').disabled=!busy;$('authoring-rescan').hidden=state.kind!=='native';$('authoring-rescan').disabled=state.pendingWrites>0;
  problem($('authoring-error'),state.error);problem($('authoring-refresh-error'),state.refreshError);
  const ids=new Set(state.rows.map(row=>row.id));for(const [id,item]of rows)if(!ids.has(id)){item.section.remove();rows.delete(id);}
  for(const row of state.rows){
   const item=rows.get(row.id)||buildRow(row);item.section.dataset.phase=row.phase;item.heading.textContent=row.title;item.source.textContent=text('source',{name:row.name,bytes:row.bytes});item.phase.textContent=text(row.phase==='ready'&&state.kind==='browser'?'exportReady':row.phase);item.classification.hidden=!row.draft;item.classification.textContent=row.draft?text(row.draft.state):'';
   item.help.hidden=!row.draft;item.help.textContent=row.draft?text(row.draft.state==='strict_notation_candidate'?'strictHelp':row.draft.state==='event_only_reference_candidate'?'eventHelp':'heldHelp'):'';
   if(item.input.value!==row.title)item.input.value=row.title;item.input.disabled=busy;item.recheck.disabled=busy;item.recheck.hidden=['converting','queued'].includes(row.phase);
   item.save.hidden=state.kind!=='native'||row.phase!=='ready';item.save.disabled=busy;item.keep.hidden=state.kind!=='native'||row.phase!=='conflict';item.keep.disabled=busy;item.retrySave.hidden=state.kind!=='native'||!['uncertain','failed'].includes(row.phase)||!row.reportSource||!queue.artifacts.has(row.id);item.retrySave.disabled=busy;
   item.exportButton.hidden=!queue.artifacts.has(row.id)||row.phase==='held';item.exportButton.disabled=busy;item.browse.hidden=!row.result?.entry||!['saved','duplicate'].includes(row.phase);item.browse.disabled=busy;item.uncertain.hidden=row.phase!=='uncertain';item.downloaded.hidden=!row.downloaded;problem(item.error,row.error);
   const signature=JSON.stringify([i18n.locale,row.draft?.draft_sha256,row.draft?.state,row.result]);if(item.signature!==signature){item.signature=signature;inventoryContent(item.inventoryBody,row.draft);notesContent(item.notesBody,row);}
   item.inventory.hidden=!row.draft;
  }
  for(const node of screen.querySelectorAll('[data-authoring-text]'))node.textContent=text(node.dataset.authoringText);
 }
 async function exportRow(id){
  const generation=queue.generation;try{const result=await queue.export(id);if(!result||destroyed||!active||generation!==queue.generation)return;await download(document,result.blob,result.filename);if(!destroyed&&active)queue.exported(result);}catch(error){if(!destroyed&&active&&generation===queue.generation)queue.downloadFailed(id,error);}
 }
 $('authoring-home').addEventListener('click',onHome);$('authoring-library').addEventListener('click',onLibrary);$('authoring-choose').addEventListener('click',()=>$('authoring-files').click());
 $('authoring-files').addEventListener('change',()=>{const files=Array.from($('authoring-files').files||[]);$('authoring-files').value='';void queue.select(files);});
 $('authoring-save-all').addEventListener('click',()=>void queue.save());$('authoring-cancel').addEventListener('click',()=>queue.cancel());$('authoring-rescan').addEventListener('click',()=>void queue.refresh());
 const unsubscribe=queue.subscribe(value=>{state=value;render();}),localeUnsubscribe=i18n.subscribe(render);render();
 return{model:queue,screen,screenChanged(next){if(active&&next!=='authoring')queue.cancel();active=next==='authoring';screen.hidden=!active;},destroy(){if(destroyed)return;queue.destroy();destroyed=true;unsubscribe();localeUnsubscribe();screen.remove();}};
}
function downloadPackage(document,blob,filename){const url=URL.createObjectURL(blob),link=document.createElement('a');link.href=url;link.download=filename;link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
