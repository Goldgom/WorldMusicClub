import {compatibilityStatus} from './instrument-profile.js';
import {midiName,accidentalGlyph} from './music.js';

export function octaveOperation(scope,selectedPart,value) {
  const octaves=Number(value);
  if(String(value).trim()===''||!Number.isInteger(octaves)||octaves===0||octaves < -8||octaves>8)throw Error('Choose a nonzero whole-number shift from −8 to +8 octaves.');
  if(!['all','selected'].includes(scope)||scope==='selected'&&selectedPart===null)throw Error('Choose a specific Practice part before adapting that entire part.');
  return{part_id:scope==='selected'?selectedPart:null,octaves};
}
export function equivalentJson(a,b) {
  if(a===b)return true;if(a===null||b===null||typeof a!=='object'||typeof b!=='object'||Array.isArray(a)!==Array.isArray(b))return false;
  const keys=Object.keys(a);return keys.length===Object.keys(b).length&&keys.every(key=>Object.hasOwn(b,key)&&equivalentJson(a[key],b[key]));
}
/** This verifies a Rust-produced copy; it never manufactures a fallback arrangement. */
export function validateAdaptationPreview(result,original,operation) {
  const fail=()=>{throw Error('The preview does not preserve the requested complete score and original record. Keep the original and request a fresh Rust preview.');};
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
function pitchText(pitch){return pitch?`${pitch.step}${accidentalGlyph(pitch.alter)}${pitch.octave}`:'Rest'}

export function setupAdaptationView({api,getContext,onActivate,pausePlayback,notice}) {
  const $=id=>document.getElementById(id),dialog=document.createElement('dialog');dialog.id='adaptation-dialog';dialog.className='review-dialog adaptation-dialog';dialog.setAttribute('aria-labelledby','adaptation-title');
  dialog.innerHTML=`<div class="review-header"><div><span class="eyebrow">EXPLICIT OCTAVE COPY · 八度副本</span><h2 id="adaptation-title">Move the register. Keep the original.</h2></div><button id="adaptation-close" class="button ghost" aria-label="Close octave adaptation">✕</button></div><p id="adaptation-current-title" class="adaptation-current-title"></p>
    <p class="review-explanation session-replacement-note">Loading, opening or activating this score replaces the paused score and clears its in-memory take history. Export take data in Results first to keep it. Playback stays paused. 使用此乐谱会替换当前乐谱，请先导出需要保留的练习记录。</p><p class="review-explanation">This makes a reversible copy by moving every pitched note in the chosen scope by the same whole-octave amount. No pitch folding, note removal, simplified chords or guessed arrangement. It does not establish permission to adapt the work.</p>
    <div class="adaptation-controls"><label>Scope · 范围<select id="adaptation-scope"><option value="all">Whole score · 全谱</option><option value="selected">Current entire Practice part · 当前完整声部</option></select></label><label>Signed octave shift · 八度<input id="adaptation-octaves" type="number" min="-8" max="8" step="1" value="-1"></label><button id="adaptation-preview" class="button secondary">Preview with Rust · 预览</button></div><p id="adaptation-scope-note" class="review-explanation"></p><p class="review-explanation">A–B does not limit the transformation. The current instrument profile is checked only as a pitch-position candidate, not a certification of fingering, hand reach, sustain or musical suitability.</p>
    <div id="adaptation-status" class="notice" role="status" aria-live="polite"></div><div id="adaptation-result" hidden><h3 id="adaptation-result-title"></h3><p id="adaptation-result-summary"></p><p id="adaptation-instrument-summary"></p><ul id="adaptation-diagnostics"></ul><details><summary>Changed written-note sample · 改动示例</summary><ol id="adaptation-note-sample"></ol><p>At most 20 examples shown. The complete score and every original note remain in the reversible JSON package.</p></details></div>
    <section class="adaptation-archive"><h3>Keep the reversible JSON · 保留可恢复文件</h3><p>A valid reversible copy stores the complete original score and its original source. Export JSON or a library backup to retain this record. MusicXML and .jianpu alone do not retain the full restoration envelope. Saved library copies are never overwritten by activation or restoration.</p><p>Restore checks the complete current copy. If later edits make the record inconsistent, Rust refuses to discard them; save/export those edits first. This consistency check is not proof of a third-party record’s authenticity.</p><button id="adaptation-restore-preview" class="button secondary" hidden>Review preserved original · 恢复预览</button></section>
    <label class="review-confirm-label"><input id="adaptation-confirm" type="checkbox" disabled><span id="adaptation-confirm-label">I reviewed the scope, shift, original retention and instrument warnings. 我已核对范围、八度与适配提示。</span></label><div class="review-actions"><button id="adaptation-cancel" class="button secondary">Cancel · 取消</button><button id="adaptation-activate" class="button primary" disabled>Activate this copy · 使用副本</button></div>`;
  document.body.append(dialog);
  let controller=null,generation=0,prepared=null,activating=false;
  function status(message,error=false){$('adaptation-status').textContent=message;$('adaptation-status').classList.toggle('error',error)}
  function sameContext(snapshot){const current=getContext();return current.score===snapshot.score&&current.part===snapshot.part&&current.version===snapshot.version&&!current.dirty&&equivalentJson(current.profile,snapshot.profile)}
  function refreshContext(){
    const context=getContext(),adapted=context.score?.source?.format==='octave-adaptation';
    $('adaptation-button').disabled=!context.score;$('adaptation-active-note').hidden=!adapted;
    $('adaptation-current-title').textContent=context.score?.title||'No score is loaded';
    $('adaptation-scope').options[1].disabled=context.part===null;
    if(context.part===null&&$('adaptation-scope').value==='selected')$('adaptation-scope').value='all';
    const name=context.score?.parts.find(part=>part.id===context.part)?.name;
    $('adaptation-scope-note').textContent=context.part===null?'Practice part: all parts. Select one on the main page to enable an entire-part copy.':`Current Practice part: ${name||context.part}. Selected-part scope shifts this whole part, including notes outside A–B.`;
    $('adaptation-preview').disabled=!context.score||context.dirty||adapted||activating;
    $('adaptation-restore-preview').hidden=!adapted;$('adaptation-restore-preview').disabled=activating;
    if(context.dirty&&!prepared)status('Apply and validate the edited instrument settings before requesting a preview.',true);
    else if(adapted&&!prepared&&!activating)status('This score carries an octave-copy record. Review and validate its preserved original before choosing a different shift.');
  }
  function invalidate(message='The score, part, profile or draft changed. Request a fresh preview before confirming.'){
    generation++;controller?.abort();controller=null;prepared=null;activating=false;$('adaptation-result').hidden=true;$('adaptation-confirm').checked=false;$('adaptation-confirm').disabled=true;$('adaptation-activate').disabled=true;
    refreshContext();if(dialog.open)status(getContext().dirty?'Apply and validate the edited instrument settings before requesting a fresh preview.':message);
  }
  function close(){invalidate('Preview cancelled. The loaded score is unchanged.');dialog.close()}
  for(const id of ['adaptation-close','adaptation-cancel'])$(id).addEventListener('click',close);
  dialog.addEventListener('cancel',event=>{event.preventDefault();close()});
  $('adaptation-button').addEventListener('click',()=>{pausePlayback();invalidate();refreshContext();dialog.showModal();const context=getContext();if(!context.dirty&&context.score?.source?.format!=='octave-adaptation')status('Preview only. Nothing changes until you explicitly activate a reviewed copy.')});
  for(const id of ['adaptation-scope','adaptation-octaves'])$(id).addEventListener('input',()=>invalidate('The requested scope or octave shift changed. Generate a fresh preview.'));
  for(const id of ['instrument','key-count','practice-part','tempo','custom-key-count','custom-lowest','guitar-tuning','guitar-frets','guitar-capo','loop-from','loop-to','loop-enabled','score-file','score-image-file'])for(const event of ['input','change'])$(id).addEventListener(event,()=>{if(dialog.open)invalidate()});
  function showResult(snapshot,result,kind){
    prepared={snapshot,result,kind};const compilation=kind==='copy'?result.compilation:result;
    $('adaptation-result').hidden=false;$('adaptation-result-title').textContent=compilation.score.title;$('adaptation-diagnostics').replaceChildren();$('adaptation-note-sample').replaceChildren();
    $('adaptation-confirm').checked=false;$('adaptation-confirm').disabled=false;$('adaptation-activate').disabled=true;
    $('adaptation-activate').textContent=kind==='copy'?'Activate this copy · 使用副本':'Restore original now · 恢复原稿';
    $('adaptation-confirm-label').textContent=kind==='copy'?'I reviewed the whole-scope octave shift, original retention and instrument warnings. 我已核对八度与适配提示。':'I want to replace only the loaded copy with this checked original. Saved library copies stay unchanged. 我确认恢复原稿。';
    const diagnostics=[...(compilation.diagnostics||[]),...(kind==='copy'?result.instrument_report.diagnostics:[])];
    for(const diagnostic of [...new Map(diagnostics.map(item=>[`${item.code}:${item.message}`,item])).values()].slice(0,100)){const li=document.createElement('li');li.textContent=diagnostic.message;$('adaptation-diagnostics').append(li)}
    if(kind==='copy'){
      const operation=result.operation,scope=operation.part_id===null?'every part':snapshot.score.parts.find(part=>part.id===operation.part_id)?.name||operation.part_id;
      $('adaptation-result-summary').textContent=`${operation.octaves>0?'+':''}${operation.octaves} octaves · ${scope} · ${result.changed_note_count} written pitched notes changed. All notes, rests, timing and the complete original source are retained.`;
      const report=result.instrument_report,outside=report.note_options.filter(note=>!note.playable).length;
      $('adaptation-instrument-summary').textContent=`Profile pitch range ${midiName(report.lowest_midi)}–${midiName(report.highest_midi)} · ${outside} selected sounding events outside range. ${result.scored_mode_allowed?'Rust allows the previewed target scope for onset scoring.':'The previewed target scope is not allowed in scored mode.'} Activation recalculates the actual Practice part and instrument checks; this is not a guarantee that all parts are playable.`;
      let shown=0;for(let p=0;p<snapshot.score.parts.length;p++){const originalPart=snapshot.score.parts[p],copyPart=compilation.score.parts[p];if(operation.part_id!==null&&originalPart.id!==operation.part_id)continue;for(let n=0;n<originalPart.notes.length&&shown<20;n++){const original=originalPart.notes[n];if(!original.pitch)continue;const item=document.createElement('li');item.textContent=`${originalPart.name} · ${original.id}: ${pitchText(original.pitch)} → ${pitchText(copyPart.notes[n].pitch)}`;$('adaptation-note-sample').append(item);shown++}}
    }else{
      $('adaptation-result-summary').textContent='Rust verified that the current copy still matches its preservation record. The complete recorded original is ready to restore after your confirmation.';
      $('adaptation-instrument-summary').textContent='The original may not fit the current instrument. Fresh selected-target checks run after restoration; no saved library copy is changed.';
    }
    status(kind==='copy'?'Preview ready. The original loaded score has not changed.':'Original preview ready. Nothing has been restored yet.');
  }
  async function requestPreview(kind){
    invalidate();const snapshot=getContext();if(!snapshot.score||snapshot.dirty){refreshContext();return}
    const current=generation;controller=new AbortController();const signal=controller.signal;status(kind==='copy'?'Preparing an explicit octave copy with Rust…':'Checking the retained original and complete current copy…');
    try{
      let result;
      if(kind==='copy'){const operation=octaveOperation($('adaptation-scope').value,snapshot.part,$('adaptation-octaves').value);result=validateAdaptationPreview(await api('/api/adaptation/preview',{score:snapshot.score,operation,profile:snapshot.profile},signal),snapshot.score,operation)}
      else result=await api('/api/adaptation/restore',snapshot.score,signal);
      if(current!==generation||signal.aborted)return;if(!sameContext(snapshot)){invalidate();return}
      if(kind==='original'&&(!result?.score||!Array.isArray(result.timeline?.notes)))throw Error('The original response is incomplete. Keep the reversible JSON and retry.');
      showResult(snapshot,result,kind);
    }catch(error){if(current===generation&&!signal.aborted)status(error.message,true)}
    finally{if(current===generation)controller=null}
  }
  $('adaptation-preview').addEventListener('click',()=>requestPreview('copy'));
  $('adaptation-restore-preview').addEventListener('click',()=>requestPreview('original'));
  $('adaptation-confirm').addEventListener('change',()=>{if(activating&&!$('adaptation-confirm').checked){invalidate('Confirmation was withdrawn. The pending activation was cancelled.');return}$('adaptation-activate').disabled=!prepared||!$('adaptation-confirm').checked||activating});
  $('adaptation-activate').addEventListener('click',async()=>{
    if(!prepared||!$('adaptation-confirm').checked||activating)return;const review=prepared;
    if(!sameContext(review.snapshot)){invalidate();return}
    const current=++generation;controller=new AbortController();const signal=controller.signal;activating=true;refreshContext();$('adaptation-activate').disabled=true;
    const compilation=review.kind==='copy'?review.result.compilation:review.result;
    status('Loading the explicitly confirmed score and recalculating its actual target checks…');
    try{
      const loaded=await onActivate(compilation.score,signal,{practicePart:review.snapshot.part,diagnostics:compilation.diagnostics||[]});
      if(current!==generation||signal.aborted)return;
      if(loaded){controller=null;activating=false;close();notice(review.kind==='copy'?'Explicit octave copy loaded. Export JSON or a library backup to retain the complete original; saved copies were not overwritten.':'Preserved original restored as the loaded score. Saved library copies were not changed.')}
      else{invalidate();status('The confirmed score could not be loaded. Review the error, then request a fresh preview.',true);}
    }catch(error){if(current===generation&&!signal.aborted)status(error.message,true)}
    finally{if(current===generation){controller=null;activating=false;refreshContext();$('adaptation-activate').disabled=true}}
  });
  refreshContext();return{invalidate,scoreChanged(){refreshContext();if(dialog.open&&!activating)invalidate('The loaded score changed. Request a fresh preview for this score.')}};
}
