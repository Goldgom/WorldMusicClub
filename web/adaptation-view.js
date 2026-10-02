import {getAppI18n} from './app-locale.js';
import {createReviewLocale,reviewError} from './review-locale.js';
import {compatibilityStatus} from './instrument-profile.js';
import {midiName,accidentalGlyph} from './music.js';

export function octaveOperation(scope,selectedPart,value) {
  const octaves=Number(value);
  if(String(value).trim()===''||!Number.isInteger(octaves)||octaves===0||octaves < -8||octaves>8)throw reviewError("review.pitch.octaveInvalid",'Choose a nonzero whole-number shift from −8 to +8 octaves.');
  if(!['all','selected'].includes(scope)||scope==='selected'&&selectedPart===null)throw reviewError("review.pitch.partInvalid",'Choose a specific Practice part before adapting that entire part.');
  return{part_id:scope==='selected'?selectedPart:null,octaves};
}
export function equivalentJson(a,b) {
  if(a===b)return true;if(a===null||b===null||typeof a!=='object'||typeof b!=='object'||Array.isArray(a)!==Array.isArray(b))return false;
  const keys=Object.keys(a);return keys.length===Object.keys(b).length&&keys.every(key=>Object.hasOwn(b,key)&&equivalentJson(a[key],b[key]));
}
/** This verifies a Rust-produced copy; it never manufactures a fallback arrangement. */
export function validateAdaptationPreview(result,original,operation) {
  const fail=()=>{throw reviewError("review.pitch.octavePreviewInvalid",'The preview does not preserve the requested complete score and original record. Keep the original and request a fresh Rust preview.');};
  if(!result?.compilation?.score||!Array.isArray(result.compilation.timeline?.notes)||!Array.isArray(result.compilation.diagnostics)||result.original_preserved!==true||typeof result.scored_mode_allowed!=='boolean'||!equivalentJson(result.operation,operation))fail();
  const copy=result.compilation.score;let envelope;
  try{if(copy.source?.format!=='octave-adaptation')fail();envelope=JSON.parse(copy.source.content)}catch{fail()}
  if(envelope.version!==1||!equivalentJson(envelope.operation,operation)||!equivalentJson(envelope.original,original))fail();
  let changed=0;
  const expectedParts=original.parts.map(part=>({...part,notes:part.notes.map(note=>{
    if(!note.pitch||operation.part_id!==null&&operation.part_id!==part.id)return note;
    changed++;return{...note,pitch:{...note.pitch,octave:note.pitch.octave+operation.octaves}};
  })}));
  if(!changed||changed!==result.changed_note_count||!equivalentJson(copy,{...original,id:copy.id,title:copy.title,source:copy.source,parts:expectedParts}))fail();
  const selected=result.compilation.timeline.notes.filter(note=>operation.part_id===null||note.part_id===operation.part_id);
  const compatibility=compatibilityStatus(result.instrument_report,selected);
  if(compatibility.status==='error'||result.scored_mode_allowed&&compatibility.status!=='ready')fail();
  return result;
}
function pitchText(pitch){return `${pitch.step}${accidentalGlyph(pitch.alter)}${pitch.octave}`}

export function setupAdaptationView({api,getContext,onActivate,pausePlayback,notice,document=globalThis.document,i18n=getAppI18n(document)}) {
  const $=id=>document.getElementById(id),dialog=document.createElement('dialog');dialog.id='adaptation-dialog';dialog.className='review-dialog adaptation-dialog';dialog.setAttribute('aria-labelledby','adaptation-title');
  dialog.innerHTML=`<div class="review-header"><div><span class="eyebrow" data-review-i18n="review.pitch.octaveEyebrow"></span><h2 id="adaptation-title" data-review-i18n="review.pitch.octaveTitle"></h2></div><button id="adaptation-close" class="button ghost" data-review-i18n-aria-label="review.pitch.octaveClose">✕</button></div><p id="adaptation-current-title" class="adaptation-current-title"></p><p class="review-explanation session-replacement-note" data-review-i18n="review.pitch.octaveReplacement"></p><p class="review-explanation" data-review-i18n="review.pitch.octaveExplanation"></p>
    <div class="adaptation-controls"><label><span data-review-i18n="review.pitch.scope"></span><select id="adaptation-scope"><option value="all" data-review-i18n="review.pitch.scopeAll"></option><option value="selected" data-review-i18n="review.pitch.scopeSelected"></option></select></label><label><span data-review-i18n="review.pitch.octaveShift"></span><input id="adaptation-octaves" type="number" min="-8" max="8" step="1" value="-1"></label><button id="adaptation-preview" class="button secondary" data-review-i18n="review.pitch.preview"></button></div><p id="adaptation-scope-note" class="review-explanation"></p><p class="review-explanation" data-review-i18n="review.pitch.octaveRangeHelp"></p>
    <div id="adaptation-status" class="notice" role="status" aria-live="polite"></div><div id="adaptation-result" hidden><h3 id="adaptation-result-title"></h3><p id="adaptation-result-summary"></p><p id="adaptation-instrument-summary"></p><ul id="adaptation-diagnostics"></ul><details><summary data-review-i18n="review.pitch.octaveSample"></summary><ol id="adaptation-note-sample"></ol><p data-review-i18n="review.pitch.octaveSampleLimit"></p></details></div>
    <section class="adaptation-archive"><h3 data-review-i18n="review.pitch.archiveTitle"></h3><p data-review-i18n="review.pitch.octaveArchive"></p><p data-review-i18n="review.pitch.octaveRestoreHelp"></p><button id="adaptation-restore-preview" class="button secondary" hidden data-review-i18n="review.pitch.reviewOriginal"></button></section>
    <label class="review-confirm-label"><input id="adaptation-confirm" type="checkbox" disabled><span id="adaptation-confirm-label" data-review-i18n="review.pitch.octaveConfirmInitial"></span></label><div class="review-actions"><button id="adaptation-cancel" class="button secondary" data-review-i18n="review.pitch.cancel"></button><button id="adaptation-activate" class="button primary" disabled data-review-i18n="review.pitch.activate"></button></div>`;
  document.body.append(dialog);
  const locale=createReviewLocale(dialog,i18n),{m}=locale;
  const announce=message=>notice(()=>locale.render(message));
  // Source names use their own literal nodes, with no translation parameter limit.
  const scopeNote=document.createElement('span'),scopeName=document.createElement('span');
  $('adaptation-scope-note').append(scopeNote,document.createTextNode(' '),scopeName);
  const summary=document.createElement('span'),scopeResult=document.createElement('span'),scopeLabel=document.createElement('span'),scopeValue=document.createElement('span');
  scopeResult.append(document.createTextNode(' '),scopeLabel,document.createTextNode(' '),scopeValue);
  $('adaptation-result-summary').append(summary,scopeResult);
  locale.text(scopeLabel,m('review.pitch.scopeResult'));
  let controller=null,generation=0,prepared=null,activating=false;
  function status(message,error=false){locale.text($('adaptation-status'),message);$('adaptation-status').classList.toggle('error',error)}
  function sameContext(snapshot){const current=getContext();return current.score===snapshot.score&&current.part===snapshot.part&&current.version===snapshot.version&&!current.dirty&&equivalentJson(current.profile,snapshot.profile)}
  function refreshContext(){
    const context=getContext(),adapted=context.score?.source?.format==='octave-adaptation',transposed=context.score?.source?.format==='semitone-transposition';
    $('adaptation-button').disabled=!context.score;$('adaptation-active-note').hidden=!adapted;
    locale.text($('adaptation-current-title'),context.score?.title||m('review.pitch.noScore'));
    $('adaptation-scope').options[1].disabled=context.part===null;
    if(context.part===null&&$('adaptation-scope').value==='selected')$('adaptation-scope').value='all';
    const name=context.score?.parts.find(part=>part.id===context.part)?.name;
    locale.text(scopeNote,m(context.part===null?'review.pitch.scopeNoteAll':'review.pitch.scopeNoteSelected'));
    scopeName.textContent=context.part===null?'':name||context.part;
    $('adaptation-preview').disabled=!context.score||context.dirty||adapted||transposed||activating;
    $('adaptation-restore-preview').hidden=!adapted;$('adaptation-restore-preview').disabled=activating;
    if(context.dirty&&!prepared)status(m('review.pitch.dirty'),true);
    else if(transposed&&!prepared&&!activating)status(m('review.pitch.octaveTransposed'));
    else if(adapted&&!prepared&&!activating)status(m('review.pitch.octaveAdapted'));
  }
  function invalidate(message=m('review.pitch.changed')){
    generation++;controller?.abort();controller=null;prepared=null;activating=false;$('adaptation-result').hidden=true;$('adaptation-confirm').checked=false;$('adaptation-confirm').disabled=true;$('adaptation-activate').disabled=true;
    refreshContext();if(dialog.open)status(getContext().dirty?m('review.pitch.dirtyFresh'):message);
  }
  function close(){invalidate(m('review.pitch.cancelled'));dialog.close()}
  for(const id of ['adaptation-close','adaptation-cancel'])$(id).addEventListener('click',close);
  dialog.addEventListener('cancel',event=>{event.preventDefault();close()});
  $('adaptation-button').addEventListener('click',()=>{pausePlayback();invalidate();refreshContext();dialog.showModal();const context=getContext();if(!context.dirty&&!['octave-adaptation','semitone-transposition'].includes(context.score?.source?.format))status(m('review.pitch.previewOnly'))});
  for(const id of ['adaptation-scope','adaptation-octaves'])$(id).addEventListener('input',()=>invalidate(m('review.pitch.octaveChanged')));
  for(const id of ['instrument','key-count','practice-part','tempo','custom-key-count','custom-lowest','guitar-tuning','guitar-frets','guitar-capo','loop-from','loop-to','loop-enabled','score-file','score-image-file'])for(const event of ['input','change'])$(id).addEventListener(event,()=>{if(dialog.open)invalidate()});
  function showResult(snapshot,result,kind){
    prepared={snapshot,result,kind};const compilation=kind==='copy'?result.compilation:result;
    $('adaptation-result').hidden=false;locale.text($('adaptation-result-title'),compilation.score.title);$('adaptation-diagnostics').replaceChildren();$('adaptation-note-sample').replaceChildren();
    $('adaptation-confirm').checked=false;$('adaptation-confirm').disabled=false;$('adaptation-activate').disabled=true;
    locale.text($('adaptation-activate'),kind==='copy'?m('review.pitch.activate'):m('review.pitch.restore'));
    locale.text($('adaptation-confirm-label'),kind==='copy'?m('review.pitch.octaveConfirm'):m('review.pitch.octaveConfirmRestore'));
    const diagnostics=[...(compilation.diagnostics||[]),...(kind==='copy'?result.instrument_report.diagnostics:[])];
    for(const diagnostic of [...new Map(diagnostics.map(item=>[`${item.code}:${item.message}`,item])).values()].slice(0,100)){const li=document.createElement('li');locale.text(li,locale.error({message:diagnostic.message}));$('adaptation-diagnostics').append(li)}
    if(kind==='copy'){
      const operation=result.operation,scope=operation.part_id===null?m('review.pitch.everyPart'):snapshot.score.parts.find(part=>part.id===operation.part_id)?.name||operation.part_id;
      scopeResult.hidden=false;locale.text(scopeValue,scope);
      locale.text(summary,m('review.pitch.octaveSummary',{shift:m('review.pitch.octaveAmount',{sign:operation.octaves>0?'+':'',octaves:operation.octaves}),notes:result.changed_note_count}));
      const report=result.instrument_report,outside=report.note_options.filter(note=>!note.playable).length;
      locale.text($('adaptation-instrument-summary'),m('review.pitch.octaveInstrument',{low:midiName(report.lowest_midi),high:midiName(report.highest_midi),outside,admission:m(result.scored_mode_allowed?'review.pitch.octaveAllowed':'review.pitch.octaveBlocked')}));
      let shown=0;for(let p=0;p<snapshot.score.parts.length;p++){const originalPart=snapshot.score.parts[p],copyPart=compilation.score.parts[p];if(operation.part_id!==null&&originalPart.id!==operation.part_id)continue;for(let n=0;n<originalPart.notes.length&&shown<20;n++){const original=originalPart.notes[n];if(!original.pitch)continue;const item=document.createElement('li');item.textContent=`${originalPart.name} · ${original.id}: ${pitchText(original.pitch)} → ${pitchText(copyPart.notes[n].pitch)}`;$('adaptation-note-sample').append(item);shown++}}
    }else{
      scopeResult.hidden=true;locale.text(summary,m('review.pitch.octaveOriginalSummary'));
      locale.text($('adaptation-instrument-summary'),m('review.pitch.octaveOriginalInstrument'));
    }
    status(kind==='copy'?m('review.pitch.previewReady'):m('review.pitch.originalReady'));
  }
  async function requestPreview(kind){
    invalidate();const snapshot=getContext();if(!snapshot.score||snapshot.dirty||kind==='copy'&&snapshot.score.source?.format==='semitone-transposition'){refreshContext();return}
    const current=generation;controller=new AbortController();const signal=controller.signal;status(kind==='copy'?m('review.pitch.octavePreparing'):m('review.pitch.restoring'));
    try{
      let result;
      if(kind==='copy'){const operation=octaveOperation($('adaptation-scope').value,snapshot.part,$('adaptation-octaves').value);result=validateAdaptationPreview(await api('/api/adaptation/preview',{score:snapshot.score,operation,profile:snapshot.profile},signal),snapshot.score,operation)}
      else result=await api('/api/adaptation/restore',snapshot.score,signal);
      if(current!==generation||signal.aborted)return;if(!sameContext(snapshot)){invalidate();return}
      if(kind==='original'&&(!result?.score||!Array.isArray(result.timeline?.notes)))throw reviewError('review.pitch.originalIncomplete','The original response is incomplete. Keep the reversible JSON and retry.');
      showResult(snapshot,result,kind);
    }catch(error){if(current===generation&&!signal.aborted)status(locale.error(error),true)}
    finally{if(current===generation)controller=null}
  }
  $('adaptation-preview').addEventListener('click',()=>requestPreview('copy'));
  $('adaptation-restore-preview').addEventListener('click',()=>requestPreview('original'));
  $('adaptation-confirm').addEventListener('change',()=>{if(activating&&!$('adaptation-confirm').checked){invalidate(m('review.pitch.withdrawn'));return}$('adaptation-activate').disabled=!prepared||!$('adaptation-confirm').checked||activating});
  $('adaptation-activate').addEventListener('click',async()=>{
    if(!prepared||!$('adaptation-confirm').checked||activating)return;const review=prepared;
    if(!sameContext(review.snapshot)){invalidate();return}
    const current=++generation;controller=new AbortController();const signal=controller.signal;activating=true;refreshContext();$('adaptation-activate').disabled=true;
    const compilation=review.kind==='copy'?review.result.compilation:review.result;
    status(m('review.pitch.loading'));
    try{
      const loaded=await onActivate(compilation.score,signal,{practicePart:review.snapshot.part,diagnostics:compilation.diagnostics||[]});
      if(current!==generation||signal.aborted)return;
      if(loaded){controller=null;activating=false;close();announce(review.kind==='copy'?m('review.pitch.octaveLoaded'):m('review.pitch.originalLoaded'))}
      else{invalidate();status(m('review.pitch.loadFailed'),true);}
    }catch(error){if(current===generation&&!signal.aborted)status(locale.error(error),true)}
    finally{if(current===generation){controller=null;activating=false;refreshContext();$('adaptation-activate').disabled=true}}
  });
  refreshContext();return{invalidate,destroy(){locale.destroy()},scoreChanged(){refreshContext();if(dialog.open&&!activating)invalidate(m('review.pitch.loadedChanged'))}};
}
