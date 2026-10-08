import {createPartActivityView} from './part-activity-view.js';
import {getAppI18n} from './app-locale.js';
import {localizeStatic} from './locale-view.js';
import {stageFeedbackView} from './hud-feedback.js';
import {keyTonic} from './music.js';
import {setupStageNotationLayout} from './stage-notation-layout.js';
import {mountPianoStage,createPianoToolbar,updatePianoToolbarTitles,renderPianoRails,observePianoNoticeBudget} from './piano-stage-view.js';
import {createPianoBudgetUpdate} from './piano-layout-budget.js';
import {observePianoViewportBudget} from './piano-viewport-budget.js';
export const FIELD_COLORS=Object.freeze({background:'#142333',backgroundEnd:'#1d3b4b',natural:'#7be4ce',accidental:'#acb0f5',scheduled:'#f4ce78',noteText:'#112538'});

/** Presentation changes only. Unchanged attributes can still invalidate style
 * on a dense SVG page, so never rewrite them for another playback frame. */
export function updateWrittenNoteHighlights(root,sourceNoteIds){
  const activeIds=new Set(sourceNoteIds);
  for(const node of root.querySelectorAll('.score-note')){
    const active=activeIds.has(node.dataset.noteId)&&!['machine','unavailable'].includes(node.dataset.practiceRole)&&!node.classList.contains('practice-machine-hidden'),text=String(active);
    if(node.classList.contains('active')!==active)node.classList.toggle('active',active);
    if(node.getAttribute('aria-current')!==text)node.setAttribute('aria-current',text);
  }
}

/** Keep every falling note. Dense scenes spend decoration only on currently
 * sounding notes; future notes retain their shape, outline, color and labels. */
export function fallingNoteShadow(note,position,count,reducedMotion){
  return !reducedMotion&&(count<=128||(note.start_ms<=position&&note.start_ms+note.duration_ms>position))?6:0;
}

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

/** The status bar owns real space outside the music. Keep the last visible
 * height while Free is open so both piano modes retain the same lane budget. */
export function observePianoStatusBudget({document,status,window=document.defaultView}){
  const update=createPianoBudgetUpdate({document,window,property:'--piano-status-space',measure(){
    if(!status.isConnected||!document.getElementById('workspace')?.classList.contains('piano-workspace'))return;
    const box=status.getBoundingClientRect?.();
    if(!box?.width||!box.height)return;
    return `${Math.ceil(box.height)}px`;
  }});
  const observer=window.ResizeObserver?new window.ResizeObserver(update.schedule):null;
  observer?.observe(status);window.addEventListener('resize',update.schedule);update.schedule();
  return()=>{observer?.disconnect();window.removeEventListener('resize',update.schedule);update.dispose();};
}

/** Presentation only. The app still owns all timing, sound and recorder state. */
export function setupPerformanceView({getContext,i18n=getAppI18n()}) {
  let viewportBudget=null;
  const $=id=>document.getElementById(id),header=document.querySelector('.shell-header'),nav=header.querySelector('nav'),hud=document.querySelector('.stage-hud'),play=document.querySelector('.play-panel');
  document.body.classList.add('performance-layout');
  const stopNoticeBudget=observePianoNoticeBudget({document});
  const preview=document.querySelector('.song-preview'),copy=preview.querySelector('.preview-copy'),identity=document.createElement('div'),identityText=document.createElement('div'),musicMeta=document.createElement('p');identity.className='preview-identity';identityText.className='preview-identity-text';musicMeta.id='preview-music-meta';identityText.append(copy.querySelector('.eyebrow'),$('preview-title'),$('preview-meta'),musicMeta);identity.append(preview.querySelector('.preview-art'),identityText);preview.prepend(identity);
  const controls=document.createElement('div');controls.className='preview-footer';controls.append($('preview-gate'),document.querySelector('.preview-actions'));
  const details=document.createElement('details');details.className='preview-session-help';const summary=document.createElement('summary');summary.setAttribute('data-i18n','performance.startHelp');summary.textContent=i18n.t('performance.startHelp');details.append(summary,document.querySelector('.preview-footnote'));copy.append(details);preview.append(controls);
  const settings=$('settings-dialog').querySelector('.shell-dialog-content'),inputTools=document.createElement('div');inputTools.className='performance-input-settings';inputTools.append($('midi-button'),document.querySelector('.count-in-label'));const keyboardFooter=document.querySelector('.keyboard-footer');if(!keyboardFooter.classList.contains('keyboard-input-footer'))inputTools.append(keyboardFooter);settings.prepend(inputTools);
  document.querySelector('.transport').append($('sound-button'));
  document.querySelector('.transport').classList.add('piano-transport');
  $('workspace').classList.add('piano-workspace');hud.classList.add('piano-workspace-heading');
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
  const compactPiano=window.matchMedia?.('(max-height:800px) and (min-width:651px)'),portraitPiano=window.matchMedia?.('(max-width:650px)');
  function arrangeNotationTools(){
    const above=$('workspace').classList.contains('notation-on-lanes'),compact=Boolean(shortLandscape?.matches)||above,focused=document.activeElement;
    notation.classList.toggle('short-notation',compact);
    if(compact){
      if(displayOptions.parentElement!==help)help.insertBefore(displayOptions,help.children[1]);
      if(pageControls.parentElement!==followingControls)followingControls.prepend(pageControls);
    }else{
      if(displayOptions.parentElement!==engravingControls)engravingControls.prepend(displayOptions);
      if(pageControls.parentElement!==engravingControls)engravingControls.append(pageControls);
    }
    const engravingStatus=$('engraving-status');
    if(above){if(engravingStatus.parentElement!==help)help.append(engravingStatus);}
    else if(engravingStatus.previousElementSibling!==engravingControls)engravingControls.after(engravingStatus);
    if(focused&&help.contains(focused)&&focused!==help.querySelector('summary'))help.open=true;
    if(focused&&document.activeElement!==focused&&notation.contains(focused))focused.focus({preventScroll:true});
  }
  shortLandscape?.addEventListener('change',arrangeNotationTools);arrangeNotationTools();
  warnings.addEventListener('click',()=>{const fallback=$('engraving-fallback');if(!fallback.hidden){fallback.setAttribute('tabindex','-1');fallback.focus();fallback.scrollIntoView({block:'nearest'});return;}const details=notation.querySelector('.engraving-warnings');details.open=true;details.querySelector('summary').focus({preventScroll:true});details.scrollIntoView({block:'nearest'});});
  const status=document.createElement('div');status.className='performance-status';status.innerHTML='<div class="onset-counter"><span id="hud-captured">0</span><small data-i18n="performance.captured">已记录</small></div><div class="performance-status-copy"><strong id="hud-label"></strong><p id="hud-message"></p></div><div id="hud-result" hidden><strong id="hud-accuracy">—</strong><small data-i18n="performance.onsetMatchRate">起音命中率</small></div>';
  const description=$('practice-hint');description.className='performance-hint';status.append(description);
  play.querySelector('.section-heading').replaceWith(status);
  const piano=$('piano-stage');piano.classList.add('performance-piano');const overlay=document.createElement('div');overlay.className='performance-overlay';overlay.innerHTML='<div id="stage-cue" aria-live="off" hidden><strong id="stage-cue-main"></strong><span id="stage-cue-detail"></span></div><div class="keyboard-pan"><button id="keyboard-pan-left" class="button secondary" data-i18n-aria-label="performance.panLower" aria-label="显示更低的琴键音高">←</button><span id="keyboard-range-context"></span><button id="keyboard-pan-right" class="button secondary" data-i18n-aria-label="performance.panHigher" aria-label="显示更高的琴键音高">→</button></div>';
  const field=document.createElement('div');field.className='performance-field';piano.before(field);field.append(overlay,piano,$('guitar-stage'));const pan=overlay.querySelector('.keyboard-pan');play.insertBefore(pan,document.querySelector('.transport'));const scroll=$('piano-scroll');for(const[id,direction]of[['keyboard-pan-left',-1],['keyboard-pan-right',1]])$(id).addEventListener('click',()=>{scroll.scrollBy({left:direction*scroll.clientWidth*.65,behavior:'auto'});updateRange()});
  const activityHost=document.createElement('div');activityHost.className='part-activity-host';activityHost.hidden=true;play.append(activityHost);
  const activityView=createPartActivityView({document,parent:activityHost,i18n});
  function updateActivity(snapshot,context){activityView.update(snapshot,context);const hide=activityView.root.hidden;if(activityHost.hidden!==hide){activityHost.hidden=hide;viewportBudget?.refresh();}}
  const transport=document.querySelector('.transport'),panHome=document.createComment('Piano pan controls home');pan.before(panHome);
  const cue=$('stage-cue'),cueHome=document.createComment('Guitar transport cue home');cue.before(cueHome);
  let pianoGuidance=null,guidanceHome=null;
  function arrangePianoAuxiliary(){
    const pianoMode=play.dataset.instrument!=='guitar',compact=Boolean(compactPiano?.matches)&&pianoMode,dockGuidance=pianoMode&&(compact||Boolean(portraitPiano?.matches)),focused=document.activeElement;
    if(play.dataset.instrument!=='guitar'){if(cue.parentElement!==status)status.append(cue);}
    else if(cue.previousSibling!==cueHome)cueHome.after(cue);
    transport.classList.toggle('piano-compact-transport',compact);
    if(compact){if(pan.parentElement!==transport)transport.append(pan);}
    else if(pan.previousSibling!==panHome)panHome.after(pan);
    if(dockGuidance){if(pianoGuidance&&pianoGuidance.parentElement!==transport)transport.append(pianoGuidance);}
    else if(pianoGuidance&&pianoGuidance.previousSibling!==guidanceHome)guidanceHome.after(pianoGuidance);
    if(focused&&document.activeElement!==focused&&(pan.contains(focused)||pianoGuidance?.contains(focused)))focused.focus({preventScroll:true});
  }
  function setPianoGuidance(node){pianoGuidance=node;piano.after(node);guidanceHome=document.createComment('Piano fingering guidance home');node.before(guidanceHome);arrangePianoAuxiliary();}
  compactPiano?.addEventListener('change',arrangePianoAuxiliary);portraitPiano?.addEventListener('change',arrangePianoAuxiliary);arrangePianoAuxiliary();
  const pianoPresentation=mountPianoStage({document,stage:piano,scroll,surface:$('piano-surface'),keyboard:$('keyboard'),canvas:$('falling-notes')});
  renderPianoRails({document,rails:pianoPresentation.rails,geometry:getContext().geometry||[]});
  const pianoTitle=document.createElement('h2');pianoTitle.setAttribute('data-i18n','free.pianoTitle');pianoTitle.textContent=i18n.t('free.pianoTitle');
  const pianoActions=document.createElement('div');
  for(const [id,key,target]of [['piano-connect-midi','free.connectMidi','midi-button'],['piano-keyboard-settings','keyboard.configure','keyboard-open-settings']]){const button=document.createElement('button');button.type='button';button.id=id;button.className='button secondary';button.setAttribute('data-i18n',key);button.textContent=i18n.t(key);button.addEventListener('click',()=>$(target)?.click());pianoActions.append(button);}
  pianoActions.append($('sound-button'));piano.prepend(createPianoToolbar({document,title:pianoTitle,actions:pianoActions}));
  const rangeText=(context,wide)=>context.geometry?.length?i18n.t(wide?'performance.rangeWide':'performance.range',{count:context.geometry.length,range:context.rangeLabel||''}):'';
  const notationLayout=setupStageNotationLayout({document,i18n,onChange(){arrangeNotationTools();$('workspace').dispatchEvent(new window.Event('notationlayoutchange'));}});
  let lastFeedback='',lastCue='',lastRange='';
  function updateRange(){
    const context=getContext(),keys=context.geometry||[],wide=scroll.scrollWidth>scroll.clientWidth+1;
    const signature=JSON.stringify([i18n.revision,keys.length,context.rangeLabel,context.instrument,wide,scroll.scrollLeft,scroll.clientWidth,scroll.scrollWidth]);if(signature===lastRange)return;lastRange=signature;
    pan.hidden=!wide||context.instrument==='guitar';$('keyboard-pan-left').hidden=!wide;$('keyboard-pan-right').hidden=!wide;$('keyboard-pan-left').disabled=scroll.scrollLeft<=1;$('keyboard-pan-right').disabled=scroll.scrollLeft+scroll.clientWidth>=scroll.scrollWidth-1;
    const label=rangeText(context,wide);$('keyboard-range-context').textContent=label;$('keyboard-range-context').title=label;
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
    const context=getContext();if(play.dataset.instrument!==(context.instrument||'piano')){play.dataset.instrument=context.instrument||'piano';$('workspace').classList.toggle('piano-workspace',context.instrument!=='guitar');const sound=$('sound-button'),soundHost=context.instrument==='guitar'?document.querySelector('.transport'):pianoActions;if(sound.parentElement!==soundHost)soundHost.append(sound);arrangePianoAuxiliary();notationLayout.refresh();}renderFeedback(context);const cue=performanceCue(context,i18n);
    const cueState=!cue?null:context.running?'countdown':context.completed?'complete':context.hasStarted?'paused':'ready',signature=JSON.stringify([i18n.revision,cue,cueState]);
    if(signature!==lastCue){lastCue=signature;const node=$('stage-cue');node.hidden=!cue;if(cueState)node.dataset.cueState=cueState;else node.removeAttribute('data-cue-state');$('stage-cue-main').textContent=cue?.main||'';$('stage-cue-detail').textContent=cue?.detail||'';}updateRange();updatePianoToolbarTitles(pianoActions);
  }
  function screenChanged(screen){if(screen!=='stage')updateActivity(null,{});if(screen==='stage'){hud.append(nav);header.hidden=true;}else if(screen==='free'){$('free-practice-screen').querySelector('.free-practice-heading').append(nav);header.hidden=true;}else{header.append(nav);header.hidden=false;}update();notationLayout.refresh();viewportBudget?.refresh();}
  const refreshLocale=()=>{localizeStatic(document,i18n);update();notationLayout.refresh();};
  localizeStatic(document,i18n);screenChanged(document.body.dataset.screen);
  const unsubscribe=i18n.subscribe(refreshLocale);
  const stopStatusBudget=observePianoStatusBudget({document,status});
  viewportBudget=observePianoViewportBudget({document});
  return{update,updateActivity,screenChanged,setPianoGuidance,destroy(){activityView.destroy();activityHost.remove();viewportBudget.destroy();stopStatusBudget();stopNoticeBudget();unsubscribe();notationLayout.destroy();window.removeEventListener('resize',updateRange);scroll.removeEventListener('scroll',updateRange);shortLandscape?.removeEventListener('change',arrangeNotationTools);compactPiano?.removeEventListener('change',arrangePianoAuxiliary);portraitPiano?.removeEventListener('change',arrangePianoAuxiliary);cueHome.after(cue);cueHome.remove();panHome.after(pan);if(pianoGuidance)guidanceHome.after(pianoGuidance);panHome.remove();guidanceHome?.remove();transport.classList.remove('piano-compact-transport');}};
}
