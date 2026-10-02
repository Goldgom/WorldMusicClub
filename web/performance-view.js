import {stageFeedbackView} from './hud-feedback.js';
import {keyTonic} from './music.js';
export const FIELD_COLORS=Object.freeze({background:'#142333',backgroundEnd:'#1d3b4b',natural:'#7be4ce',accidental:'#acb0f5',scheduled:'#f4ce78',noteText:'#112538'});

export function previewMusicMetadata(score){
  if(!score)return 'Musical details are available after score validation.';
  const key=score.keys.find(entry=>entry.at.numerator===0),tempo=score.tempo.find(entry=>entry.at.numerator===0),tonic=keyTonic(key);
  const keyLabel=tonic?`${tonic.name.replace('b','♭').replace('#','♯')} ${key.mode}`:key?`${key.fifths>0?`${key.fifths} sharps`:key.fifths<0?`${-key.fifths} flats`:'No sharps/flats'} · ${!key.mode||key.mode==='unknown'?'mode unspecified':key.mode}`:'Key unspecified';
  const changes=[];if(tempo&&score.tempo.some(entry=>entry.bpm!==tempo.bpm))changes.push('tempo');if(key&&score.keys.some(entry=>entry.fifths!==key.fifths||entry.mode!==key.mode))changes.push('key');
  return `Opening · 起始: ${keyLabel} · ${tempo?`${tempo.bpm} BPM`:'Tempo unspecified'} · ${score.parts.length} part${score.parts.length===1?'':'s'}${changes.length?` · Later ${changes.join(' / ')} changes`:''}`;
}

export function performanceCue(context){
  if(context.running)return context.position<context.segmentStart?{main:String(Math.ceil((context.segmentStart-context.position)/context.countInBeatMs)),detail:'Silent count-in · 预备拍'}:null;
  if(context.completed)return{main:context.mode==='practice'?'TAKE RECORDED':'LISTEN COMPLETE',detail:context.mode==='practice'?'Open Results to review this take · 查看结果':'Listen again or try Practice · 再听或练习'};
  return{main:context.hasStarted?'PAUSED':'READY',detail:context.hasStarted?'Press Play to continue · 播放以继续':'Press Play when you’re ready · 准备好后播放'};
}

/** Presentation only. The app still owns all timing, sound and recorder state. */
export function setupPerformanceView({getContext}) {
  const $=id=>document.getElementById(id),header=document.querySelector('.shell-header'),nav=header.querySelector('nav'),hud=document.querySelector('.stage-hud'),play=document.querySelector('.play-panel');
  document.body.classList.add('performance-layout');
  const preview=document.querySelector('.song-preview'),copy=preview.querySelector('.preview-copy'),identity=document.createElement('div'),identityText=document.createElement('div'),musicMeta=document.createElement('p');identity.className='preview-identity';identityText.className='preview-identity-text';musicMeta.id='preview-music-meta';identityText.append(copy.querySelector('.eyebrow'),$('preview-title'),$('preview-meta'),musicMeta);identity.append(preview.querySelector('.preview-art'),identityText);preview.prepend(identity);
  const controls=document.createElement('div');controls.className='preview-footer';controls.append($('preview-gate'),document.querySelector('.preview-actions'));
  const details=document.createElement('details');details.className='preview-session-help';const summary=document.createElement('summary');summary.textContent='Starting or replacing a take · 使用说明';details.append(summary,document.querySelector('.preview-footnote'));copy.append(details);preview.append(controls);
  const settings=$('settings-dialog').querySelector('.shell-dialog-content'),inputTools=document.createElement('div');inputTools.className='performance-input-settings';inputTools.append($('midi-button'),document.querySelector('.count-in-label'),document.querySelector('.keyboard-footer'));settings.prepend(inputTools);
  document.querySelector('.transport').append($('sound-button'));
  const notation=document.querySelector('#notation-dock .notation-panel'),notationHeading=notation.querySelector('.section-heading'),help=document.createElement('details');help.className='dock-help';help.innerHTML='<summary>Help &amp; notation limits · 读谱说明</summary>';
  help.append($('basic-notation-note'),$('engraving-follow-help'));const helpRow=document.createElement('div');helpRow.className='dock-help-row';helpRow.append(help);notationHeading.after(helpRow);
  const warnings=document.createElement('button');warnings.id='dock-warning-count';warnings.className='button ghost compact';warnings.textContent='Notation notices';notationHeading.append(warnings);
  helpRow.append(warnings);
  $('engraved-button').textContent='Staff · 五线谱';$('engraved-button').setAttribute('aria-label','Engraved staff · 五线谱');$('staff-button').textContent='Pitch guide · 音高';$('staff-button').setAttribute('aria-label','Simplified pitch guide · 音高参考');$('staff-button').title='Simplified pitch guide: rhythm, voices, ties and key signatures are not fully engraved.';
  $('engraving-part').closest('label').firstChild.textContent='Part · 声部 ';$('engraving-page-size').closest('label').firstChild.textContent='Per page · 每页 ';
  const displayOptions=document.createElement('div');displayOptions.className='notation-display-options';displayOptions.setAttribute('role','group');displayOptions.setAttribute('aria-label','Engraved staff display options');displayOptions.append($('engraving-part').closest('label'),$('engraving-page-size').closest('label'));
  const engravingControls=notation.querySelector('.engraving-controls'),pageControls=notation.querySelector('.engraving-pages'),followingControls=notation.querySelector('.engraving-follow-controls');
  const followingLabel=$('engraving-follow').closest('label');followingLabel.lastChild.textContent=' Follow playback';
  const shortLandscape=window.matchMedia?.('(max-height:600px) and (min-width:651px)');
  function arrangeNotationTools(){const compact=Boolean(shortLandscape?.matches);notation.classList.toggle('short-notation',compact);if(compact){help.insertBefore(displayOptions,help.children[1]);followingControls.prepend(pageControls);}else{engravingControls.prepend(displayOptions);engravingControls.append(pageControls);}}
  shortLandscape?.addEventListener('change',arrangeNotationTools);arrangeNotationTools();
  warnings.addEventListener('click',()=>{const fallback=$('engraving-fallback');if(!fallback.hidden){fallback.setAttribute('tabindex','-1');fallback.focus();fallback.scrollIntoView({block:'nearest'});return;}const details=notation.querySelector('.engraving-warnings');details.open=true;details.querySelector('summary').focus({preventScroll:true});details.scrollIntoView({block:'nearest'});});
  const status=document.createElement('div');status.className='performance-status';status.innerHTML='<div class="onset-counter"><span id="hud-captured">0</span><small>captured · 已记录</small></div><div class="performance-status-copy"><strong id="hud-label">Ready</strong><p id="hud-message"></p></div><div id="hud-result" hidden><strong id="hud-accuracy">—</strong><small>Onset match rate · 命中率</small></div>';
  const description=$('practice-hint');description.className='performance-hint';status.append(description);
  play.querySelector('.section-heading').replaceWith(status);
  const piano=$('piano-stage');piano.classList.add('performance-piano');const overlay=document.createElement('div');overlay.className='performance-overlay';overlay.innerHTML='<div id="stage-cue" aria-live="off" hidden><strong id="stage-cue-main"></strong><span id="stage-cue-detail"></span></div><div class="keyboard-pan"><button id="keyboard-pan-left" class="button secondary" aria-label="Show lower keyboard pitches">←</button><span id="keyboard-range-context"></span><button id="keyboard-pan-right" class="button secondary" aria-label="Show higher keyboard pitches">→</button></div>';
  const field=document.createElement('div');field.className='performance-field';piano.before(field);field.append(overlay,piano,$('guitar-stage'));const pan=overlay.querySelector('.keyboard-pan');play.insertBefore(pan,document.querySelector('.transport'));const scroll=$('piano-scroll');for(const[id,direction]of[['keyboard-pan-left',-1],['keyboard-pan-right',1]])$(id).addEventListener('click',()=>{scroll.scrollBy({left:direction*scroll.clientWidth*.65,behavior:'auto'});updateRange()});
  let lastFeedback='',lastCue='',lastRange='';
  function updateRange(){
    const context=getContext(),keys=context.geometry||[],wide=scroll.scrollWidth>scroll.clientWidth+1;
    const signature=JSON.stringify([keys.length,context.rangeLabel,context.instrument,wide,scroll.scrollLeft,scroll.clientWidth,scroll.scrollWidth]);if(signature===lastRange)return;lastRange=signature;
    pan.hidden=!wide||context.instrument==='guitar';$('keyboard-pan-left').hidden=!wide;$('keyboard-pan-right').hidden=!wide;$('keyboard-pan-left').disabled=scroll.scrollLeft<=1;$('keyboard-pan-right').disabled=scroll.scrollLeft+scroll.clientWidth>=scroll.scrollWidth-1;
    $('keyboard-range-context').textContent=keys.length?`${keys.length} keys · ${context.rangeLabel||''}${wide?' · scroll or use arrows to explore':''}`:'';
  }
  scroll.addEventListener('scroll',updateRange,{passive:true});window.addEventListener('resize',updateRange);
  function renderFeedback(context){const pass=context.recorder?.active;const view=stageFeedbackView({mode:context.mode,pass,now:context.now,running:context.running,latencyMs:context.recorder?.latencyMs,toleranceMs:context.recorder?.toleranceMs,interrupted:context.recorder?.interruptions.some(gap=>gap.from_wall_ms===pass?.closedWall)}),signature=JSON.stringify(view);if(signature===lastFeedback)return;lastFeedback=signature;$('hud-captured').textContent=String(view.captured);$('hud-label').textContent=view.label;$('hud-message').textContent=({listen:'Listen to the score, then try Practice.',ready:'Play your part, then open Results to check this take.',capturing:'Notes captured so far. Timing feedback follows assessment.',grace:'Waiting for delayed input before showing a checked snapshot.',pending:'Open Results to check this take or inspect pending work.',error:'Your notes are retained. Retry the check in Results.',assessed:'Checked onset match rate. Timing grades remain separate.',review:'Provisional result. Review the pass-boundary notes in Results.',empty:'Choose a part or range containing notes.'})[view.phase]||view.message;status.setAttribute('role','group');status.setAttribute('aria-label','Active take snapshot');status.setAttribute('aria-description',view.message);status.dataset.phase=view.phase;status.dataset.passId=String(view.passId??'');status.dataset.revision=String(view.revision??'');$('hud-result').hidden=view.accuracy===null;$('hud-accuracy').textContent=view.accuracy||'—';}
  function update(){
    const context=getContext();if(play.dataset.instrument!==context.instrument)play.dataset.instrument=context.instrument||'piano';renderFeedback(context);const cue=performanceCue(context),signature=JSON.stringify(cue);
    if(signature!==lastCue){lastCue=signature;$('stage-cue').hidden=!cue;$('stage-cue-main').textContent=cue?.main||'';$('stage-cue-detail').textContent=cue?.detail||'';}updateRange();
  }
  function screenChanged(screen){if(screen==='stage'){hud.append(nav);header.hidden=true;}else{header.append(nav);header.hidden=false;}update();}
  screenChanged(document.body.dataset.screen);
  return{update,screenChanged};
}
