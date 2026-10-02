import {getAppI18n} from './app-locale.js';
import {localizeStatic} from './locale-view.js';
import {stageFeedbackView} from './hud-feedback.js';
import {keyTonic} from './music.js';
export const FIELD_COLORS=Object.freeze({background:'#142333',backgroundEnd:'#1d3b4b',natural:'#7be4ce',accidental:'#acb0f5',scheduled:'#f4ce78',noteText:'#112538'});

export function previewMusicMetadata(score,i18n=getAppI18n()){
  const t=(key,params)=>i18n.t(key,params);
  if(!score)return t('performance.metadataUnavailable');
  const key=score.keys.find(entry=>entry.at.numerator===0),tempo=score.tempo.find(entry=>entry.at.numerator===0),tonic=keyTonic(key);
  const mode=!key?.mode||key.mode==='unknown'?t('performance.modeUnspecified'):['major','minor'].includes(key.mode)?t(`performance.${key.mode}`):key.mode;
  const accidental=key?(key.fifths>0?t('performance.sharps',{count:key.fifths}):key.fifths<0?t('performance.flats',{count:-key.fifths}):t('performance.noAccidentals')):'';
  const keyLabel=tonic?t('performance.keyMode',{tonic:tonic.name.replace('b','♭').replace('#','♯'),mode}):key?t('performance.keyMode',{tonic:accidental,mode}):t('performance.keyUnspecified');
  const tempoChanges=tempo&&score.tempo.some(entry=>entry.bpm!==tempo.bpm),keyChanges=key&&score.keys.some(entry=>entry.fifths!==key.fifths||entry.mode!==key.mode);
  const opening=t('performance.opening',{key:keyLabel,tempo:tempo?t('performance.tempo',{bpm:i18n.formatNumber(tempo.bpm)}):t('performance.tempoUnspecified'),parts:t('performance.parts',{count:score.parts.length})});
  return tempoChanges||keyChanges?t('performance.withChanges',{opening,changes:t(`performance.change.${tempoChanges&&keyChanges?'both':tempoChanges?'tempo':'key'}`)}):opening;
}

export function performanceCue(context,i18n=getAppI18n()){
  const t=key=>i18n.t(key);
  if(context.running)return context.position<context.segmentStart?{main:i18n.formatNumber(Math.ceil((context.segmentStart-context.position)/context.countInBeatMs)),detail:t('performance.silentCountIn')}:null;
  if(context.completed)return{main:t(context.mode==='practice'?'performance.takeRecorded':'performance.listenComplete'),detail:t(context.mode==='practice'?'performance.openResults':'performance.listenAgain')};
  return{main:t(context.hasStarted?'performance.paused':'performance.ready'),detail:t(context.hasStarted?'performance.playContinue':'performance.playReady')};
}

/** Presentation only. The app still owns all timing, sound and recorder state. */
export function setupPerformanceView({getContext,i18n=getAppI18n()}) {
  const $=id=>document.getElementById(id),header=document.querySelector('.shell-header'),nav=header.querySelector('nav'),hud=document.querySelector('.stage-hud'),play=document.querySelector('.play-panel');
  document.body.classList.add('performance-layout');
  const preview=document.querySelector('.song-preview'),copy=preview.querySelector('.preview-copy'),identity=document.createElement('div'),identityText=document.createElement('div'),musicMeta=document.createElement('p');identity.className='preview-identity';identityText.className='preview-identity-text';musicMeta.id='preview-music-meta';identityText.append(copy.querySelector('.eyebrow'),$('preview-title'),$('preview-meta'),musicMeta);identity.append(preview.querySelector('.preview-art'),identityText);preview.prepend(identity);
  const controls=document.createElement('div');controls.className='preview-footer';controls.append($('preview-gate'),document.querySelector('.preview-actions'));
  const details=document.createElement('details');details.className='preview-session-help';const summary=document.createElement('summary');summary.setAttribute('data-i18n','performance.startHelp');summary.textContent=i18n.t('performance.startHelp');details.append(summary,document.querySelector('.preview-footnote'));copy.append(details);preview.append(controls);
  const settings=$('settings-dialog').querySelector('.shell-dialog-content'),inputTools=document.createElement('div');inputTools.className='performance-input-settings';inputTools.append($('midi-button'),document.querySelector('.count-in-label'));const keyboardFooter=document.querySelector('.keyboard-footer');if(!keyboardFooter.classList.contains('keyboard-input-footer'))inputTools.append(keyboardFooter);settings.prepend(inputTools);
  document.querySelector('.transport').append($('sound-button'));
  // The compact footer keeps both controls and their complete localized names.
  const routeControls=$('guitar-plan-controls'),routeSummary=routeControls.querySelector('summary'),sourceSummary=document.querySelector('.guitar-details summary');
  for(const[control,key]of[[routeSummary,'performance.guitarRouteShort'],[sourceSummary,'performance.guitarSourcesShort']]){
    const fullKey=control.getAttribute('data-i18n');
    if(fullKey){control.setAttribute('data-i18n-aria-label',fullKey);control.setAttribute('data-i18n-title',fullKey);control.setAttribute('aria-label',i18n.t(fullKey));control.title=i18n.t(fullKey);}
    control.setAttribute('data-i18n',key);control.textContent=i18n.t(key);
  }
  routeSummary.after($('guitar-plan-status'));
  const notation=document.querySelector('#notation-dock .notation-panel'),notationHeading=notation.querySelector('.section-heading'),help=document.createElement('details');help.className='dock-help';help.innerHTML='<summary data-i18n="performance.notationHelp">读谱说明与限制</summary>';
  help.append($('basic-notation-note'),$('engraving-follow-help'));const helpRow=document.createElement('div');helpRow.className='dock-help-row';helpRow.append(help);notationHeading.after(helpRow);
  const warnings=document.createElement('button');warnings.id='dock-warning-count';warnings.className='button ghost compact';warnings.setAttribute('data-i18n','performance.notationNotices');warnings.textContent=i18n.t('performance.notationNotices');notationHeading.append(warnings);
  helpRow.append(warnings);
  function label(element,key,attribute){element.setAttribute(attribute?`data-i18n-${attribute}`:'data-i18n',key);}
  label($('engraved-button'),'performance.staff');label($('engraved-button'),'ui.engraved-button','aria-label');
  label($('staff-button'),'performance.pitchGuide');label($('staff-button'),'ui.staff-button','aria-label');label($('staff-button'),'performance.pitchGuideTitle','title');
  label($('engraving-part').closest('label'),'performance.part');label($('engraving-page-size').closest('label'),'performance.perPage');
  const displayOptions=document.createElement('div');displayOptions.className='notation-display-options';displayOptions.setAttribute('role','group');label(displayOptions,'performance.displayOptions','aria-label');displayOptions.append($('engraving-part').closest('label'),$('engraving-page-size').closest('label'));
  const engravingControls=notation.querySelector('.engraving-controls'),pageControls=notation.querySelector('.engraving-pages'),followingControls=notation.querySelector('.engraving-follow-controls');
  const followingLabel=$('engraving-follow').closest('label');label(followingLabel,'follow.label');
  const shortLandscape=window.matchMedia?.('(max-height:600px) and (min-width:651px)');
  function arrangeNotationTools(){const compact=Boolean(shortLandscape?.matches);notation.classList.toggle('short-notation',compact);if(compact){help.insertBefore(displayOptions,help.children[1]);followingControls.prepend(pageControls);}else{engravingControls.prepend(displayOptions);engravingControls.append(pageControls);}}
  shortLandscape?.addEventListener('change',arrangeNotationTools);arrangeNotationTools();
  warnings.addEventListener('click',()=>{const fallback=$('engraving-fallback');if(!fallback.hidden){fallback.setAttribute('tabindex','-1');fallback.focus();fallback.scrollIntoView({block:'nearest'});return;}const details=notation.querySelector('.engraving-warnings');details.open=true;details.querySelector('summary').focus({preventScroll:true});details.scrollIntoView({block:'nearest'});});
  const status=document.createElement('div');status.className='performance-status';status.innerHTML='<div class="onset-counter"><span id="hud-captured">0</span><small data-i18n="performance.captured">已记录</small></div><div class="performance-status-copy"><strong id="hud-label"></strong><p id="hud-message"></p></div><div id="hud-result" hidden><strong id="hud-accuracy">—</strong><small data-i18n="performance.onsetMatchRate">起音命中率</small></div>';
  const description=$('practice-hint');description.className='performance-hint';status.append(description);
  play.querySelector('.section-heading').replaceWith(status);
  const piano=$('piano-stage');piano.classList.add('performance-piano');const overlay=document.createElement('div');overlay.className='performance-overlay';overlay.innerHTML='<div id="stage-cue" aria-live="off" hidden><strong id="stage-cue-main"></strong><span id="stage-cue-detail"></span></div><div class="keyboard-pan"><button id="keyboard-pan-left" class="button secondary" data-i18n-aria-label="performance.panLower" aria-label="显示更低的琴键音高">←</button><span id="keyboard-range-context"></span><button id="keyboard-pan-right" class="button secondary" data-i18n-aria-label="performance.panHigher" aria-label="显示更高的琴键音高">→</button></div>';
  const field=document.createElement('div');field.className='performance-field';piano.before(field);field.append(overlay,piano,$('guitar-stage'));const pan=overlay.querySelector('.keyboard-pan');play.insertBefore(pan,document.querySelector('.transport'));const scroll=$('piano-scroll');for(const[id,direction]of[['keyboard-pan-left',-1],['keyboard-pan-right',1]])$(id).addEventListener('click',()=>{scroll.scrollBy({left:direction*scroll.clientWidth*.65,behavior:'auto'});updateRange()});
  let lastFeedback='',lastCue='',lastRange='';
  function updateRange(){
    const context=getContext(),keys=context.geometry||[],wide=scroll.scrollWidth>scroll.clientWidth+1;
    const signature=JSON.stringify([i18n.revision,keys.length,context.rangeLabel,context.instrument,wide,scroll.scrollLeft,scroll.clientWidth,scroll.scrollWidth]);if(signature===lastRange)return;lastRange=signature;
    pan.hidden=!wide||context.instrument==='guitar';$('keyboard-pan-left').hidden=!wide;$('keyboard-pan-right').hidden=!wide;$('keyboard-pan-left').disabled=scroll.scrollLeft<=1;$('keyboard-pan-right').disabled=scroll.scrollLeft+scroll.clientWidth>=scroll.scrollWidth-1;
    $('keyboard-range-context').textContent=keys.length?i18n.t(wide?'performance.rangeWide':'performance.range',{count:keys.length,range:context.rangeLabel||''}):'';
  }
  scroll.addEventListener('scroll',updateRange,{passive:true});window.addEventListener('resize',updateRange);
  function renderFeedback(context){
    const pass=context.recorder?.active;
    const view=stageFeedbackView({mode:context.mode,pass,now:context.now,running:context.running,latencyMs:context.recorder?.latencyMs,toleranceMs:context.recorder?.toleranceMs,interrupted:context.recorder?.interruptions.some(gap=>gap.from_wall_ms===pass?.closedWall)});
    const signature=JSON.stringify([i18n.revision,view]);if(signature===lastFeedback)return;lastFeedback=signature;
    const phases=['listen','ready','capturing','grace','pending','error','assessed','review','empty'],phase=phases.includes(view.phase)?view.phase:'ready';
    const summaryUnavailable=['assessed','review'].includes(phase)&&!view.grades&&!view.onsets;
    const label=i18n.t(`performance.hud.${phase}.label`),message=i18n.t(summaryUnavailable?'performance.hud.unavailable.message':`performance.hud.${phase}.message`);
    $('hud-captured').textContent=i18n.formatNumber(view.captured);
    $('hud-label').textContent=view.passId==null?label:i18n.t('performance.hud.takeLabel',{id:String(view.passId),label});
    $('hud-message').textContent=message;
    status.setAttribute('role','group');status.setAttribute('aria-label',i18n.t('performance.snapshot'));
    status.setAttribute('aria-description',!summaryUnavailable&&['assessed','review'].includes(phase)?i18n.t('performance.hud.assessed.description'):message);
    status.dataset.phase=view.phase;status.dataset.passId=String(view.passId??'');status.dataset.revision=String(view.revision??'');
    $('hud-result').hidden=view.accuracy===null;$('hud-accuracy').textContent=view.accuracy||'—';
  }
  function update(){
    const context=getContext();if(play.dataset.instrument!==context.instrument)play.dataset.instrument=context.instrument||'piano';renderFeedback(context);const cue=performanceCue(context,i18n),signature=JSON.stringify([i18n.revision,cue]);
    if(signature!==lastCue){lastCue=signature;$('stage-cue').hidden=!cue;$('stage-cue-main').textContent=cue?.main||'';$('stage-cue-detail').textContent=cue?.detail||'';}updateRange();
  }
  function screenChanged(screen){if(screen==='stage'){hud.append(nav);header.hidden=true;}else{header.append(nav);header.hidden=false;}update();}
  const refreshLocale=()=>{localizeStatic(document,i18n);update();};
  localizeStatic(document,i18n);screenChanged(document.body.dataset.screen);
  const unsubscribe=i18n.subscribe(refreshLocale);
  return{update,screenChanged,destroy(){unsubscribe();window.removeEventListener('resize',updateRange);scroll.removeEventListener('scroll',updateRange);shortLandscape?.removeEventListener('change',arrangeNotationTools);}};
}
