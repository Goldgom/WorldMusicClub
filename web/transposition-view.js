import {getAppI18n} from './app-locale.js';
import {createReviewLocale,reviewError} from './review-locale.js';
import {equivalentJson} from './adaptation-view.js';
import {compatibilityStatus} from './instrument-profile.js';
import {pitchMidi,midiName,accidentalGlyph,keyTonic} from './music.js';

const FORMAT='semitone-transposition',STEPS=['C','D','E','F','G','A','B'];
const signed=value=>`${value>0?'+':''}${value}`;
export function semitoneOperation(value) {
  const semitones=Number(value);
  if(!['string','number'].includes(typeof value)||String(value).trim()===''||!Number.isInteger(semitones)||semitones===0||Math.abs(semitones)>127)throw reviewError("review.pitch.semitoneInvalid",'Choose a nonzero whole-number shift from −127 to +127 semitones.');
  return {semitones};
}
function retainedOriginal(copy) {
  if(copy?.source?.format!==FORMAT)throw reviewError("review.pitch.noSemitoneOriginal",'This score has no semitone-transposition original.');
  const envelope=JSON.parse(copy.source.content);
  if(envelope.version!==1||!equivalentJson(envelope,{version:1,operation:envelope.operation,original:envelope.original})||!equivalentJson(envelope.operation,semitoneOperation(envelope.operation?.semitones))||!envelope.original?.parts)throw reviewError("review.pitch.recordIncomplete",'The original record is incomplete or requires a newer app.');
  return envelope;
}
/** Verify the Rust result; this never selects a spelling or creates a local fallback. */
export function validateTranspositionPreview(result,original,operation,originalTimeline) {
  const fail=()=>{throw reviewError("review.pitch.semitonePreviewInvalid",'The preview does not preserve the complete score, exact semitone shift and original record. Keep the original and request a fresh Rust preview.');};
  try {
    if(!equivalentJson(operation,semitoneOperation(operation?.semitones))||['octave-adaptation',FORMAT,'external-omr-draft'].includes(original.source?.format))fail();
    if(!result?.compilation?.score||!Array.isArray(result.compilation.timeline?.notes)||!Array.isArray(result.compilation.diagnostics)||result.original_preserved!==true||typeof result.scored_mode_allowed!=='boolean'||!equivalentJson(result.operation,operation))fail();
    const copy=result.compilation.score,envelope=retainedOriginal(copy),interval=result.written_interval;
    if(!equivalentJson(envelope.original,original)||!equivalentJson(envelope.operation,operation)||!Number.isInteger(interval?.diatonic_steps)||!Number.isInteger(interval?.fifths_delta)||Math.abs(interval.fifths_delta)>42||((7*interval.fifths_delta-operation.semitones)%12+12)%12!==0||((4*interval.fifths_delta-interval.diatonic_steps)%7+7)%7!==0)fail();
    if(operation.semitones%12===0&&(interval.fifths_delta!==0||interval.diatonic_steps!==operation.semitones/12*7))fail();
    let changed=0;const sourcePitches=new Map();
    const parts=original.parts.map(part=>({...part,notes:part.notes.map(note=>{
      if(!note.pitch)return note;
      const originalIndex=STEPS.indexOf(note.pitch.step),position=note.pitch.octave*7+originalIndex+interval.diatonic_steps;
      if(originalIndex<0)fail();
      const octave=Math.floor(position/7),step=STEPS[(position%7+7)%7],midi=pitchMidi(note.pitch)+operation.semitones,alter=midi-pitchMidi({step,alter:0,octave});
      if(!Number.isInteger(midi)||midi<0||midi>127||!Number.isInteger(alter)||Math.abs(alter)>2)fail();
      changed++;sourcePitches.set(note.id,{part:part.id,midi});return {...note,pitch:{...note.pitch,step,alter,octave}};
    })}));
    const keys=original.keys.map(key=>{const fifths=key.fifths+interval.fifths_delta;if(!Number.isInteger(fifths)||Math.abs(fifths)>7)fail();return {...key,fifths}});
    if(!changed||changed!==result.changed_note_count||!equivalentJson(copy,{...original,id:`${original.id}:semitones:${signed(operation.semitones)}`,title:`${original.title} [${signed(operation.semitones)} semitones]`,parts,keys,source:copy.source}))fail();
    const warnings=copy.source.import_diagnostics,originalWarnings=original.source?.import_diagnostics||[];
    if(copy.source.filename!==null||!Array.isArray(warnings)||warnings.length!==originalWarnings.length+1||!equivalentJson(warnings.slice(0,-1),originalWarnings)||warnings.at(-1)?.code!=='explicit_semitone_transposition'||warnings.at(-1).severity!=='warning'||typeof warnings.at(-1).message!=='string')fail();
    const notes=result.compilation.timeline.notes;
    for(const note of notes){const ids=note.source_note_ids;if(!Array.isArray(ids)||!ids.length||!ids.includes(note.source_note_id)||ids.some(id=>sourcePitches.get(id)?.midi!==note.midi||sourcePitches.get(id)?.part!==note.part_id))fail()}
    if(!Array.isArray(originalTimeline?.notes))fail();
    const expectedTimeline={...originalTimeline,notes:originalTimeline.notes.map(note=>({...note,midi:note.midi+operation.semitones}))};
    const normalized=timeline=>({...timeline,notes:[...timeline.notes].sort((a,b)=>a.id<b.id?-1:a.id>b.id?1:0)});
    if(!equivalentJson(normalized(result.compilation.timeline),normalized(expectedTimeline)))fail();
    const byId=new Map(notes.map(note=>[note.id,note])),report=result.instrument_report,compatibility=compatibilityStatus(report,notes);
    if(compatibility.status==='error'||result.scored_mode_allowed&&compatibility.status!=='ready'||!Number.isInteger(report.lowest_midi)||!Number.isInteger(report.highest_midi)||report.lowest_midi<0||report.highest_midi>127||report.lowest_midi>report.highest_midi||report.note_options.some(option=>option.midi!==byId.get(option.note_id)?.midi))fail();
    return result;
  } catch {fail()}
}
export function validateTranspositionRestore(result,copy) {
  try {
    const envelope=retainedOriginal(copy);
    if(!equivalentJson(result?.score,envelope.original)||!Array.isArray(result.timeline?.notes)||!Array.isArray(result.diagnostics))throw Error();
    return result;
  } catch {throw reviewError("review.pitch.restoreInvalid",'The restoration preview does not match the complete recorded original. Keep the reversible JSON and request a fresh Rust check.')}
}
function pitchText(pitch){return `${pitch.step}${accidentalGlyph(pitch.alter)}${pitch.octave}`}
function rangeText(score,m){let low=128,high=-1;for(const part of score.parts)for(const note of part.notes)if(note.pitch){const midi=pitchMidi(note.pitch);low=Math.min(low,midi);high=Math.max(high,midi)}return high<0?m('review.pitch.noPitches'):`${midiName(low)}–${midiName(high)}`}

export function setupTranspositionView({api,getContext,onActivate,pausePlayback,notice,document=globalThis.document,i18n=getAppI18n(document)}) {
  const $=id=>document.getElementById(id),dialog=document.createElement('dialog');dialog.id='transposition-dialog';dialog.className='review-dialog adaptation-dialog transposition-dialog';dialog.setAttribute('aria-labelledby','transposition-title');
  dialog.innerHTML=`<div class="review-header"><div><span class="eyebrow" data-review-i18n="review.pitch.semitoneEyebrow"></span><h2 id="transposition-title" data-review-i18n="review.pitch.semitoneTitle"></h2></div><button id="transposition-close" class="button ghost" data-review-i18n-aria-label="review.pitch.semitoneClose">✕</button></div><p id="transposition-current-title" class="adaptation-current-title"></p><p class="review-explanation session-replacement-note" data-review-i18n="review.pitch.semitoneReplacement"></p><p class="review-explanation" data-review-i18n="review.pitch.semitoneExplanation"></p>
    <div class="adaptation-controls"><label><span data-review-i18n="review.pitch.semitoneShift"></span><input id="transposition-semitones" type="number" min="-127" max="127" step="1" value="1"></label><button id="transposition-preview" class="button secondary" data-review-i18n="review.pitch.preview"></button></div><p class="review-explanation" data-review-i18n="review.pitch.semitoneRangeHelp"></p>
    <div id="transposition-status" class="notice" role="status" aria-live="polite"></div><div id="transposition-result" hidden><h3 id="transposition-result-title"></h3><p id="transposition-result-summary"></p><p id="transposition-range-summary"></p><p id="transposition-instrument-summary"></p><ul id="transposition-diagnostics"></ul><details><summary data-review-i18n="review.pitch.semitoneSample"></summary><ul id="transposition-key-sample"></ul><ol id="transposition-note-sample"></ol><p data-review-i18n="review.pitch.semitoneSampleLimit"></p></details></div>
    <section class="adaptation-archive"><h3 data-review-i18n="review.pitch.archiveTitle"></h3><p data-review-i18n="review.pitch.semitoneArchive"></p><p data-review-i18n="review.pitch.semitoneRestoreHelp"></p><button id="transposition-restore-preview" class="button secondary" hidden data-review-i18n="review.pitch.reviewOriginal"></button></section>
    <label class="review-confirm-label"><input id="transposition-confirm" type="checkbox" disabled><span id="transposition-confirm-label" data-review-i18n="review.pitch.semitoneConfirm"></span></label><div class="review-actions"><button id="transposition-cancel" class="button secondary" data-review-i18n="review.pitch.cancel"></button><button id="transposition-activate" class="button primary" disabled data-review-i18n="review.pitch.activate"></button></div>`;
  document.body.append(dialog);
  const locale=createReviewLocale(dialog,i18n),{m}=locale;
  const announce=message=>notice(()=>locale.render(message));
  function keySample(key){
    const node=document.createElement('span'),tonic=keyTonic(key),sign=key.fifths>0?'+':'';
    if(tonic)locale.text(node,m('review.pitch.key',{tonic:tonic.name,mode:m(`review.pitch.${key.mode}`),sign,fifths:key.fifths}));
    else{
      const label=document.createElement('span'),source=document.createElement('span');
      locale.text(label,m('review.pitch.unknownKey',{sign,fifths:key.fifths}));
      source.textContent=key.mode;node.append(label,document.createTextNode(' '),source);
    }
    return node;
  }
  let controller=null,generation=0,prepared=null,activating=false,busy=false;
  function status(message,error=false){locale.text($('transposition-status'),message);$('transposition-status').classList.toggle('error',error)}
  function capture(){const context=getContext();return {...context,identity:context.score,score:structuredClone(context.score),timeline:structuredClone(context.timeline),profile:structuredClone(context.profile)}}
  function sameContext(snapshot){const current=getContext();return current.score===snapshot.identity&&current.part===snapshot.part&&current.version===snapshot.version&&!current.dirty&&equivalentJson(current.score,snapshot.score)&&equivalentJson(current.timeline,snapshot.timeline)&&equivalentJson(current.profile,snapshot.profile)}
  function refreshContext(explain=false){
    const context=getContext(),format=context.score?.source?.format,adapted=format===FORMAT,octave=format==='octave-adaptation';
    $('transposition-button').disabled=!context.score;$('transposition-active-note').hidden=!adapted;
    locale.text($('transposition-current-title'),context.score?.title||m('review.pitch.noScore'));
    $('transposition-preview').disabled=!context.score||context.dirty||adapted||octave||busy||activating;
    $('transposition-restore-preview').hidden=!adapted;$('transposition-restore-preview').disabled=context.dirty||busy||activating;
    if(explain&&!prepared&&!busy&&!activating){
      if(context.dirty)status(m('review.pitch.dirty'),true);
      else if(octave)status(m('review.pitch.semitoneOctave'));
      else if(adapted)status(m('review.pitch.semitoneAdapted'));
    }
  }
  function invalidate(message=m('review.pitch.changed')){
    generation++;controller?.abort();controller=null;prepared=null;activating=false;busy=false;$('transposition-result').hidden=true;$('transposition-confirm').checked=false;$('transposition-confirm').disabled=true;$('transposition-activate').disabled=true;
    if(dialog.open)status(message);refreshContext(true);
  }
  function close(){invalidate(m('review.pitch.cancelled'));dialog.close()}
  for(const id of ['transposition-close','transposition-cancel'])$(id).addEventListener('click',close);
  dialog.addEventListener('cancel',event=>{event.preventDefault();close()});dialog.addEventListener('close',()=>{if(!dialog.open)invalidate(m('review.pitch.cancelled'))});
  $('transposition-button').addEventListener('click',()=>{pausePlayback();invalidate();dialog.showModal();status(m('review.pitch.previewOnly'));refreshContext(true)});
  $('transposition-semitones').addEventListener('input',()=>invalidate(m('review.pitch.semitoneChanged')));
  for(const id of ['instrument','key-count','practice-part','tempo','custom-key-count','custom-lowest','guitar-tuning','guitar-frets','guitar-capo','loop-from','loop-to','loop-enabled','score-file','score-image-file'])for(const event of ['input','change'])$(id)?.addEventListener(event,()=>{if(dialog.open)invalidate()});
  function showResult(snapshot,result,kind){
    prepared={snapshot,result,kind};const compilation=kind==='copy'?result.compilation:result;
    $('transposition-result').hidden=false;locale.text($('transposition-result-title'),compilation.score.title);
    for(const id of ['transposition-diagnostics','transposition-key-sample','transposition-note-sample'])$(id).replaceChildren();
    $('transposition-confirm').checked=false;$('transposition-confirm').disabled=false;$('transposition-activate').disabled=true;
    locale.text($('transposition-activate'),kind==='copy'?m('review.pitch.activate'):m('review.pitch.restore'));
    locale.text($('transposition-confirm-label'),kind==='copy'?m('review.pitch.semitoneConfirm'):m('review.pitch.semitoneConfirmRestore'));
    const diagnostics=[...compilation.diagnostics,...(kind==='copy'?result.instrument_report.diagnostics:[])];
    for(const diagnostic of [...new Map(diagnostics.map(item=>[`${item.code}:${item.message}`,item])).values()].slice(0,100)){const li=document.createElement('li');locale.text(li,locale.error({message:diagnostic.message}));$('transposition-diagnostics').append(li)}
    locale.text($('transposition-range-summary'),m('review.pitch.range',{before:rangeText(snapshot.score,m),after:rangeText(compilation.score,m)}));
    if(kind==='copy'){
      locale.text($('transposition-result-summary'),m('review.pitch.semitoneSummary',{shift:m('review.pitch.semitoneAmount',{sign:result.operation.semitones>0?'+':'',semitones:result.operation.semitones}),notes:result.changed_note_count,keys:compilation.score.keys.length}));
      const report=result.instrument_report,outside=report.note_options.filter(note=>!note.playable).length;
      locale.text($('transposition-instrument-summary'),m('review.pitch.semitoneInstrument',{low:midiName(report.lowest_midi),high:midiName(report.highest_midi),outside,admission:m(result.scored_mode_allowed?'review.pitch.semitoneAllowed':'review.pitch.semitoneBlocked')}));
      for(let k=0;k<Math.min(20,snapshot.score.keys.length);k++){
        const key=snapshot.score.keys[k],li=document.createElement('li'),at=document.createElement('span');
        locale.text(at,m('review.pitch.keyBeat',{numerator:key.at.numerator,denominator:key.at.denominator}));
        li.append(at,document.createTextNode(' '),keySample(key),document.createTextNode(' → '),keySample(compilation.score.keys[k]));$('transposition-key-sample').append(li);
      }
      if(!snapshot.score.keys.length){const li=document.createElement('li');locale.text(li,m('review.pitch.noKeys'));$('transposition-key-sample').append(li)}
      let shown=0;for(let p=0;p<snapshot.score.parts.length;p++)for(let n=0;n<snapshot.score.parts[p].notes.length&&shown<20;n++){const part=snapshot.score.parts[p],note=part.notes[n];if(!note.pitch)continue;const li=document.createElement('li');li.textContent=`${part.name} · ${note.id}: ${pitchText(note.pitch)} → ${pitchText(compilation.score.parts[p].notes[n].pitch)}`;$('transposition-note-sample').append(li);shown++}
    }else{
      locale.text($('transposition-result-summary'),m('review.pitch.semitoneOriginalSummary'));
      locale.text($('transposition-instrument-summary'),m('review.pitch.semitoneOriginalInstrument'));
    }
    status(kind==='copy'?m('review.pitch.previewReady'):m('review.pitch.originalReady'));
  }
  async function requestPreview(kind){
    const context=getContext(),format=context.score?.source?.format;
    if(!dialog.open||!context.score||context.dirty||busy||activating||kind==='copy'&&['octave-adaptation',FORMAT].includes(format)||kind==='original'&&format!==FORMAT)return;
    invalidate();const snapshot=capture(),current=generation;controller=new AbortController();const signal=controller.signal;busy=true;refreshContext();status(kind==='copy'?m('review.pitch.semitonePreparing'):m('review.pitch.restoring'));
    try{
      let result;
      if(kind==='copy'){const operation=semitoneOperation($('transposition-semitones').value);result=await api('/api/transposition/preview',{score:snapshot.score,operation,profile:snapshot.profile},signal);if(current!==generation||signal.aborted)return;validateTranspositionPreview(result,snapshot.score,operation,snapshot.timeline)}
      else{result=await api('/api/transposition/restore',snapshot.score,signal);if(current!==generation||signal.aborted)return;validateTranspositionRestore(result,snapshot.score)}
      if(!sameContext(snapshot)){invalidate();return}showResult(snapshot,result,kind);
    }catch(error){if(current===generation&&!signal.aborted)status(locale.error(error),true)}
    finally{if(current===generation){controller=null;busy=false;refreshContext()}}
  }
  $('transposition-preview').addEventListener('click',()=>requestPreview('copy'));
  $('transposition-restore-preview').addEventListener('click',()=>requestPreview('original'));
  $('transposition-confirm').addEventListener('change',()=>{if(activating&&!$('transposition-confirm').checked){invalidate(m('review.pitch.withdrawn'));return}$('transposition-activate').disabled=!prepared||!$('transposition-confirm').checked||activating});
  $('transposition-activate').addEventListener('click',async()=>{
    if(!dialog.open||!prepared||!$('transposition-confirm').checked||activating)return;const review=prepared;
    if(!sameContext(review.snapshot)){invalidate();return}
    const current=++generation;controller=new AbortController();const signal=controller.signal;activating=true;refreshContext();$('transposition-activate').disabled=true;
    const compilation=review.kind==='copy'?review.result.compilation:review.result;
    status(m('review.pitch.loading'));
    try{
      const loaded=await onActivate(compilation.score,signal,{practicePart:review.snapshot.part,diagnostics:compilation.diagnostics});
      if(current!==generation||signal.aborted)return;
      if(loaded){controller=null;activating=false;close();announce(review.kind==='copy'?m('review.pitch.semitoneLoaded'):m('review.pitch.originalLoaded'))}
      else{invalidate();status(m('review.pitch.loadFailed'),true)}
    }catch(error){if(current===generation&&!signal.aborted){invalidate();status(locale.error(error),true)}}
    finally{if(current===generation){controller=null;activating=false;refreshContext();$('transposition-activate').disabled=true}}
  });
  refreshContext(true);return {invalidate,destroy(){locale.destroy()},scoreChanged(){
    // The shared loader commits the score before awaiting its compatibility check.
    // At that boundary the review is finished; a later dialog cancellation must
    // not abort the committed score or claim that the old take remains loaded.
    if(activating&&prepared){
      const compilation=prepared.kind==='copy'?prepared.result.compilation:prepared.result;
      if(equivalentJson(getContext().score,compilation.score)){
        const kind=prepared.kind;controller=null;activating=false;close();
        announce(kind==='copy'?m('review.pitch.semitoneLoadedChecking'):m('review.pitch.originalLoadedChecking'));return;
      }
      invalidate(m('review.pitch.anotherLoaded'));return;
    }
    refreshContext();if(dialog.open)invalidate(m('review.pitch.loadedChanged'));
  }};
}
