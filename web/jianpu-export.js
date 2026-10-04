import {isBasicKeysSong} from './clean-song-package.js';
import {getAppI18n} from './app-locale.js';
import {createReviewLocale, reviewError} from './review-locale.js';
/** Rust supplies every token; this guard only checks complete canonical note identity coverage. */
export function validateJianpuExport(result, score) {
  const fail=()=>{throw reviewError('review.export.invalid','The numbered-text export is incomplete. Keep the JSON or MusicXML archive and try again with a compatible server.');};
  if(!result||typeof result.text!=='string'||!result.text.trim()||new TextEncoder().encode(result.text).byteLength>1024*1024||!Array.isArray(result.diagnostics)||!Array.isArray(result.note_map)||result.note_map.length>100000)fail();
  const expected=new Set(score.parts.flatMap(part=>part.notes.map(note=>note.id))),seen=new Set();let gaps=0;
  for(const id of result.note_map){if(id===null){gaps++;continue}if(typeof id!=='string'||!expected.has(id)||seen.has(id))fail();seen.add(id)}
  if(seen.size!==expected.size)fail();
  return{sourceNotes:seen.size,gapRests:gaps};
}
export function setupJianpuExport({getScore,getCleanSong=()=>null,pausePlayback,api,document=globalThis.document,i18n=getAppI18n(document)}) {
  const $=id=>document.getElementById(id);
  const dialog=document.createElement('dialog');dialog.id='jianpu-export';dialog.className='review-dialog jianpu-export';dialog.setAttribute('aria-labelledby','jianpu-export-title');
  dialog.innerHTML=`<div class="review-header"><div><span class="eyebrow"><span data-review-i18n="review.export.eyebrow"></span></span><h2 id="jianpu-export-title"><span data-review-i18n="review.export.title"></span></h2></div><button id="jianpu-export-close" class="button ghost" aria-label="" data-review-i18n-aria-label="review.export.closeAria">✕</button></div>
    <p class="review-explanation"><span data-review-i18n="review.export.explanation"></span></p>
    <div id="jianpu-export-status" class="notice" role="status" aria-live="polite"></div>
    <ul id="jianpu-export-diagnostics" class="review-warnings"></ul>
    <p class="review-explanation"><span data-review-i18n="review.export.archive"></span></p>
    <label for="jianpu-export-text"><span data-review-i18n="review.export.text"></span></label><textarea id="jianpu-export-text" readonly rows="12" spellcheck="false"></textarea>
    <details class="jianpu-export-mapping"><summary id="jianpu-export-map-summary"><span data-review-i18n="review.export.mapping"></span></summary><ol id="jianpu-export-map"></ol><p id="jianpu-export-map-limit"></p></details>
    <div class="review-actions"><button id="jianpu-export-cancel" class="button secondary"><span data-review-i18n="review.export.cancel"></span></button><button id="jianpu-export-download" class="button primary" disabled><span data-review-i18n="review.export.download"></span></button></div>`;
  document.body.append(dialog);
  const locale=createReviewLocale(dialog,i18n),{m}=locale;
  const display=(id,message)=>locale.text($(id),message);
  let generation=0,controller=null,prepared=null;
  function close(){generation++;controller?.abort();controller=null;prepared=null;$('jianpu-export-download').disabled=true;dialog.close()}
  for(const id of ['jianpu-export-close','jianpu-export-cancel'])$(id).addEventListener('click',close);
  dialog.addEventListener('cancel',event=>{event.preventDefault();close()});
  $('export-jianpu').addEventListener('click',async()=>{
    const score=getScore();if(!score||isBasicKeysSong(getCleanSong()))return;
    pausePlayback();controller?.abort();controller=new AbortController();const current=++generation;const signal=controller.signal;prepared=null;
    $('jianpu-export-text').value='';$('jianpu-export-map').replaceChildren();$('jianpu-export-diagnostics').replaceChildren();display('jianpu-export-map-summary',m('review.export.mappingPending'));display('jianpu-export-map-limit','');$('jianpu-export-download').disabled=true;$('jianpu-export-status').classList.remove('error');display('jianpu-export-status',m('review.export.pending'));dialog.showModal();
    try{
      const result=await api('/api/export/jianpu',score,signal);
      if(current!==generation||signal.aborted)return;
      if(getScore()!==score){display('jianpu-export-status',m('review.export.changed'));return}
      const counts=validateJianpuExport(result,score);prepared={score,result};
      $('jianpu-export-text').value=result.text;
      display('jianpu-export-status',m('review.export.ready',{notes:counts.sourceNotes,gaps:counts.gapRests}));
      for(const diagnostic of result.diagnostics){const li=document.createElement('li');locale.text(li,locale.error({message:diagnostic.message}));$('jianpu-export-diagnostics').append(li)}
      display('jianpu-export-map-summary',m('review.export.mappingCount',{count:result.note_map.length}));
      for(const id of result.note_map.slice(0,100)){const li=document.createElement('li');locale.text(li,id===null?m('review.export.gap'):m('review.export.source',{id}));$('jianpu-export-map').append(li)}
      display('jianpu-export-map-limit',m(result.note_map.length>100?'review.export.mappingLimited':'review.export.mappingComplete'));
      $('jianpu-export-download').disabled=false;
    }catch(error){if(current!==generation||signal.aborted)return;$('jianpu-export-status').classList.add('error');display('jianpu-export-status',m('review.export.failed',{detail:locale.error(error)}))}
    finally{if(current===generation)controller=null}
  });
  $('jianpu-export-download').addEventListener('click',()=>{
    if(!prepared)return;
    if(getScore()!==prepared.score){prepared=null;$('jianpu-export-download').disabled=true;display('jianpu-export-status',m('review.export.changedCurrent'));return}
    const filename=`${prepared.score.id.replace(/[^\w.-]/g,'_').slice(0,120)}.jianpu`;
    const url=URL.createObjectURL(new Blob([prepared.result.text],{type:'text/plain;charset=utf-8'}));const link=document.createElement('a');link.href=url;link.download=filename;link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
    display('jianpu-export-status',m('review.export.downloaded'));
  });
  return{close,destroy(){close();locale.destroy();dialog.remove()}};
}
