import {equivalentJson} from './adaptation-view.js';
import {compatibilityStatus} from './instrument-profile.js';
import {pitchMidi,midiName,accidentalGlyph,keyTonic} from './music.js';

const FORMAT='semitone-transposition',STEPS=['C','D','E','F','G','A','B'];
const signed=value=>`${value>0?'+':''}${value}`;
export function semitoneOperation(value) {
  const semitones=Number(value);
  if(!['string','number'].includes(typeof value)||String(value).trim()===''||!Number.isInteger(semitones)||semitones===0||Math.abs(semitones)>127)throw Error('Choose a nonzero whole-number shift from −127 to +127 semitones.');
  return {semitones};
}
function retainedOriginal(copy) {
  if(copy?.source?.format!==FORMAT)throw Error('This score has no semitone-transposition original.');
  const envelope=JSON.parse(copy.source.content);
  if(envelope.version!==1||!equivalentJson(envelope,{version:1,operation:envelope.operation,original:envelope.original})||!equivalentJson(envelope.operation,semitoneOperation(envelope.operation?.semitones))||!envelope.original?.parts)throw Error('The original record is incomplete or requires a newer app.');
  return envelope;
}
/** Verify the Rust result; this never selects a spelling or creates a local fallback. */
export function validateTranspositionPreview(result,original,operation,originalTimeline) {
  const fail=()=>{throw Error('The preview does not preserve the complete score, exact semitone shift and original record. Keep the original and request a fresh Rust preview.');};
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
  } catch {throw Error('The restoration preview does not match the complete recorded original. Keep the reversible JSON and request a fresh Rust check.')}
}
function pitchText(pitch){return `${pitch.step}${accidentalGlyph(pitch.alter)}${pitch.octave}`}
function rangeText(score){let low=128,high=-1;for(const part of score.parts)for(const note of part.notes)if(note.pitch){const midi=pitchMidi(note.pitch);low=Math.min(low,midi);high=Math.max(high,midi)}return high<0?'No pitched notes':`${midiName(low)}–${midiName(high)}`}
function keyText(key){const tonic=keyTonic(key);return `${tonic?`${tonic.name} ${key.mode}`:`${key.mode} mode`} (${signed(key.fifths)} fifths)`}

export function setupTranspositionView({api,getContext,onActivate,pausePlayback,notice}) {
  const $=id=>document.getElementById(id),dialog=document.createElement('dialog');dialog.id='transposition-dialog';dialog.className='review-dialog adaptation-dialog transposition-dialog';dialog.setAttribute('aria-labelledby','transposition-title');
  dialog.innerHTML=`<div class="review-header"><div><span class="eyebrow">MANUAL SEMITONE COPY · 手动移调副本</span><h2 id="transposition-title">Transpose the score · 全谱移调</h2></div><button id="transposition-close" class="button ghost" aria-label="Close semitone transposition · 关闭移调">✕</button></div><p id="transposition-current-title" class="adaptation-current-title"></p>
    <p class="review-explanation session-replacement-note">Activating a copy or restoring its original replaces the paused score and clears its in-memory take history. Export take data in Results first to keep it. Playback stays paused. 使用副本或恢复原稿会替换当前乐谱，请先导出需要保留的练习记录。</p><p class="review-explanation">Every pitched note and key signature moves by one consistent written interval. This changes the displayed and sounding pitches for the whole score, including all parts and notes outside A–B. It sends no MIDI hardware transpose command. 全谱所有声部统一移调，不改变硬件设置。</p>
    <div class="adaptation-controls"><label>Signed semitone shift · 半音<input id="transposition-semitones" type="number" min="-127" max="127" step="1" value="1"></label><button id="transposition-preview" class="button secondary">Preview with Rust · 预览</button></div><p class="review-explanation">Positive raises pitch; negative lowers it. Rust refuses a shift that exceeds MIDI 0–127 or requires inconsistent spelling. Range checks do not certify fingering, hand reach, sustain or permission to adapt the work.</p>
    <div id="transposition-status" class="notice" role="status" aria-live="polite"></div><div id="transposition-result" hidden><h3 id="transposition-result-title"></h3><p id="transposition-result-summary"></p><p id="transposition-range-summary"></p><p id="transposition-instrument-summary"></p><ul id="transposition-diagnostics"></ul><details><summary>Key signatures and written-note examples · 调号与音符示例</summary><ul id="transposition-key-sample"></ul><ol id="transposition-note-sample"></ol><p>At most 20 signatures and 20 notes shown. The full score and complete original remain in the JSON package.</p></details></div>
    <section class="adaptation-archive"><h3>Keep the reversible JSON · 保留可恢复文件</h3><p>Export JSON or a library backup to retain the complete original and its exact source. MusicXML and .jianpu alone do not retain the full restoration record. Saved library copies are never overwritten.</p><p>Restore checks the complete current copy. Later edits require saving/exporting first if Rust refuses restoration. This consistency check does not prove third-party authenticity. Restore an existing octave or semitone copy before requesting another pitch copy.</p><button id="transposition-restore-preview" class="button secondary" hidden>Review preserved original · 恢复预览</button></section>
    <label class="review-confirm-label"><input id="transposition-confirm" type="checkbox" disabled><span id="transposition-confirm-label">I reviewed the whole-score shift, original retention and warnings. 我已核对全谱移调、原稿保留与提示。</span></label><div class="review-actions"><button id="transposition-cancel" class="button secondary">Cancel · 取消</button><button id="transposition-activate" class="button primary" disabled>Activate this copy · 使用副本</button></div>`;
  document.body.append(dialog);
  let controller=null,generation=0,prepared=null,activating=false,busy=false;
  function status(message,error=false){$('transposition-status').textContent=message;$('transposition-status').classList.toggle('error',error)}
  function capture(){const context=getContext();return {...context,identity:context.score,score:structuredClone(context.score),timeline:structuredClone(context.timeline),profile:structuredClone(context.profile)}}
  function sameContext(snapshot){const current=getContext();return current.score===snapshot.identity&&current.part===snapshot.part&&current.version===snapshot.version&&!current.dirty&&equivalentJson(current.score,snapshot.score)&&equivalentJson(current.timeline,snapshot.timeline)&&equivalentJson(current.profile,snapshot.profile)}
  function refreshContext(explain=false){
    const context=getContext(),format=context.score?.source?.format,adapted=format===FORMAT,octave=format==='octave-adaptation';
    $('transposition-button').disabled=!context.score;$('transposition-active-note').hidden=!adapted;
    $('transposition-current-title').textContent=context.score?.title||'No score is loaded';
    $('transposition-preview').disabled=!context.score||context.dirty||adapted||octave||busy||activating;
    $('transposition-restore-preview').hidden=!adapted;$('transposition-restore-preview').disabled=context.dirty||busy||activating;
    if(explain&&!prepared&&!busy&&!activating){
      if(context.dirty)status('Apply and validate the edited instrument settings before requesting a preview.',true);
      else if(octave)status('This is an octave copy. Use Preview octave copy to review and restore its original first. 当前为八度副本，请先恢复原稿。');
      else if(adapted)status('This is a semitone copy. Review and restore its preserved original before choosing another shift. 当前为移调副本，请先恢复原稿。');
    }
  }
  function invalidate(message='The score, part, profile or draft changed. Request a fresh preview before confirming.'){
    generation++;controller?.abort();controller=null;prepared=null;activating=false;busy=false;$('transposition-result').hidden=true;$('transposition-confirm').checked=false;$('transposition-confirm').disabled=true;$('transposition-activate').disabled=true;
    if(dialog.open)status(message);refreshContext(true);
  }
  function close(){invalidate('Preview cancelled. The loaded score is unchanged.');dialog.close()}
  for(const id of ['transposition-close','transposition-cancel'])$(id).addEventListener('click',close);
  dialog.addEventListener('cancel',event=>{event.preventDefault();close()});dialog.addEventListener('close',()=>{if(!dialog.open)invalidate('Preview cancelled. The loaded score is unchanged.')});
  $('transposition-button').addEventListener('click',()=>{pausePlayback();invalidate();dialog.showModal();status('Preview only. Nothing changes until you explicitly activate a reviewed copy.');refreshContext(true)});
  $('transposition-semitones').addEventListener('input',()=>invalidate('The requested semitone shift changed. Generate a fresh preview.'));
  for(const id of ['instrument','key-count','practice-part','tempo','custom-key-count','custom-lowest','guitar-tuning','guitar-frets','guitar-capo','loop-from','loop-to','loop-enabled','score-file','score-image-file'])for(const event of ['input','change'])$(id)?.addEventListener(event,()=>{if(dialog.open)invalidate()});
  function showResult(snapshot,result,kind){
    prepared={snapshot,result,kind};const compilation=kind==='copy'?result.compilation:result;
    $('transposition-result').hidden=false;$('transposition-result-title').textContent=compilation.score.title;
    for(const id of ['transposition-diagnostics','transposition-key-sample','transposition-note-sample'])$(id).replaceChildren();
    $('transposition-confirm').checked=false;$('transposition-confirm').disabled=false;$('transposition-activate').disabled=true;
    $('transposition-activate').textContent=kind==='copy'?'Activate this copy · 使用副本':'Restore original now · 恢复原稿';
    $('transposition-confirm-label').textContent=kind==='copy'?'I reviewed the whole-score shift, original retention and warnings. 我已核对全谱移调、原稿保留与提示。':'I want to replace only the loaded copy with this complete checked original. 我确认恢复完整原稿。';
    const diagnostics=[...compilation.diagnostics,...(kind==='copy'?result.instrument_report.diagnostics:[])];
    for(const diagnostic of [...new Map(diagnostics.map(item=>[`${item.code}:${item.message}`,item])).values()].slice(0,100)){const li=document.createElement('li');li.textContent=diagnostic.message;$('transposition-diagnostics').append(li)}
    $('transposition-range-summary').textContent=`Written pitch range · 书写音域: ${rangeText(snapshot.score)} → ${rangeText(compilation.score)}.`;
    if(kind==='copy'){
      $('transposition-result-summary').textContent=`${signed(result.operation.semitones)} semitones · whole score / 全谱 · ${result.changed_note_count} written pitched notes changed · ${compilation.score.keys.length} key signatures retained and shifted. Rests, timing, voices, ties and the complete original source are retained.`;
      const report=result.instrument_report,outside=report.note_options.filter(note=>!note.playable).length;
      $('transposition-instrument-summary').textContent=`Profile pitch range ${midiName(report.lowest_midi)}–${midiName(report.highest_midi)} · ${outside} sounding events outside range. ${result.scored_mode_allowed?'Rust allows the whole-score preview for onset scoring.':'The whole-score preview is not allowed in scored mode.'} Activation rechecks your actual Practice part and instrument.`;
      for(let k=0;k<Math.min(20,snapshot.score.keys.length);k++){const key=snapshot.score.keys[k],li=document.createElement('li');li.textContent=`Beat ${key.at.numerator}/${key.at.denominator}: ${keyText(key)} → ${keyText(compilation.score.keys[k])}`;$('transposition-key-sample').append(li)}
      if(!snapshot.score.keys.length){const li=document.createElement('li');li.textContent='No key signatures in the original; none invented. 原稿无调号，不自动添加。';$('transposition-key-sample').append(li)}
      let shown=0;for(let p=0;p<snapshot.score.parts.length;p++)for(let n=0;n<snapshot.score.parts[p].notes.length&&shown<20;n++){const part=snapshot.score.parts[p],note=part.notes[n];if(!note.pitch)continue;const li=document.createElement('li');li.textContent=`${part.name} · ${note.id}: ${pitchText(note.pitch)} → ${pitchText(compilation.score.parts[p].notes[n].pitch)}`;$('transposition-note-sample').append(li);shown++}
    }else{
      $('transposition-result-summary').textContent='Rust checked the complete current copy. This preview exactly matches its complete recorded original, including the retained source. Nothing has been restored yet.';
      $('transposition-instrument-summary').textContent='The original may not fit the current instrument. Fresh selected-target checks run after restoration. Saved library copies stay unchanged.';
    }
    status(kind==='copy'?'Preview ready. The original loaded score has not changed.':'Original preview ready. Nothing has been restored yet.');
  }
  async function requestPreview(kind){
    const context=getContext(),format=context.score?.source?.format;
    if(!dialog.open||!context.score||context.dirty||busy||activating||kind==='copy'&&['octave-adaptation',FORMAT].includes(format)||kind==='original'&&format!==FORMAT)return;
    invalidate();const snapshot=capture(),current=generation;controller=new AbortController();const signal=controller.signal;busy=true;refreshContext();status(kind==='copy'?'Preparing a whole-score semitone copy with Rust…':'Checking the retained original and complete current copy…');
    try{
      let result;
      if(kind==='copy'){const operation=semitoneOperation($('transposition-semitones').value);result=await api('/api/transposition/preview',{score:snapshot.score,operation,profile:snapshot.profile},signal);if(current!==generation||signal.aborted)return;validateTranspositionPreview(result,snapshot.score,operation,snapshot.timeline)}
      else{result=await api('/api/transposition/restore',snapshot.score,signal);if(current!==generation||signal.aborted)return;validateTranspositionRestore(result,snapshot.score)}
      if(!sameContext(snapshot)){invalidate();return}showResult(snapshot,result,kind);
    }catch(error){if(current===generation&&!signal.aborted)status(error.message,true)}
    finally{if(current===generation){controller=null;busy=false;refreshContext()}}
  }
  $('transposition-preview').addEventListener('click',()=>requestPreview('copy'));
  $('transposition-restore-preview').addEventListener('click',()=>requestPreview('original'));
  $('transposition-confirm').addEventListener('change',()=>{if(activating&&!$('transposition-confirm').checked){invalidate('Confirmation was withdrawn. The pending activation was cancelled.');return}$('transposition-activate').disabled=!prepared||!$('transposition-confirm').checked||activating});
  $('transposition-activate').addEventListener('click',async()=>{
    if(!dialog.open||!prepared||!$('transposition-confirm').checked||activating)return;const review=prepared;
    if(!sameContext(review.snapshot)){invalidate();return}
    const current=++generation;controller=new AbortController();const signal=controller.signal;activating=true;refreshContext();$('transposition-activate').disabled=true;
    const compilation=review.kind==='copy'?review.result.compilation:review.result;
    status('Loading the explicitly confirmed score and recalculating its actual target checks…');
    try{
      const loaded=await onActivate(compilation.score,signal,{practicePart:review.snapshot.part,diagnostics:compilation.diagnostics});
      if(current!==generation||signal.aborted)return;
      if(loaded){controller=null;activating=false;close();notice(review.kind==='copy'?'Explicit semitone copy loaded. Export JSON or a library backup to retain the complete original.':'Preserved original restored as the loaded score. Saved library copies were not changed.')}
      else{invalidate();status('The confirmed score could not be loaded. Review the error, then request a fresh preview.',true)}
    }catch(error){if(current===generation&&!signal.aborted){invalidate();status(error.message,true)}}
    finally{if(current===generation){controller=null;activating=false;refreshContext();$('transposition-activate').disabled=true}}
  });
  refreshContext(true);return {invalidate,scoreChanged(){
    // The shared loader commits the score before awaiting its compatibility check.
    // At that boundary the review is finished; a later dialog cancellation must
    // not abort the committed score or claim that the old take remains loaded.
    if(activating&&prepared){
      const compilation=prepared.kind==='copy'?prepared.result.compilation:prepared.result;
      if(equivalentJson(getContext().score,compilation.score)){
        const kind=prepared.kind;controller=null;activating=false;close();
        notice(kind==='copy'?'Explicit semitone copy loaded. Instrument checks are updating. Export JSON or a library backup to retain the complete original.':'Preserved original restored. Instrument checks are updating. Saved library copies were not changed.');return;
      }
      invalidate('Another score was loaded. Request a fresh preview for this score.');return;
    }
    refreshContext();if(dialog.open)invalidate('The loaded score changed. Request a fresh preview for this score.');
  }};
}
