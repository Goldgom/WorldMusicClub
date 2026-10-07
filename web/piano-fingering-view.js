import {fingeringUnavailable,fingeringUnavailableReason} from './fingering-source.js';
import {getAppI18n} from './app-locale.js';
import {midiName,pitchMidi} from './music.js';
import {pianoKeyboardRange,pianoSourceNotes,setupPianoFingering} from './piano-fingering.js';

export const PIANO_VISIBLE_TARGETS=8;
export const PIANO_LOOKAHEAD_MS=4000;
const seconds=(ms,i18n)=>i18n.formatNumber(ms/1000,{minimumFractionDigits:3,maximumFractionDigits:3});
const countdown=(ms,i18n)=>i18n.formatNumber(Math.max(0,ms/1000),{minimumFractionDigits:1,maximumFractionDigits:1});
const handName=(hand,i18n)=>i18n.t('piano.runtime.'+(hand==='left'?'left':'right'));

/** A finite readout of Rust recommendations; input/held-key state is never consulted. */
export function pianoGuidanceView({plan,position=0,segmentStart=0,segmentEnd=Infinity,running=false,hasStarted=false,completed=false,i18n=getAppI18n()}={}){
  const t=(key,params)=>i18n.t('piano.runtime.'+key,params);
  if(plan?.status!=='ready'||!plan.complete)return{phase:'pending',state:t('pending'),items:[],keyHints:[],additional:0};
  if(completed)return{phase:'complete',state:t('complete'),items:[],keyHints:[],additional:0};
  const from=Math.max(position,segmentStart),to=Math.min(segmentEnd,position+PIANO_LOOKAHEAD_MS);
  const available=plan.assignments.filter(note=>note.start_ms<segmentEnd&&note.end_ms>from&&note.start_ms<=to);
  const current=available.filter(note=>note.start_ms<=position||note.start_ms<segmentStart);
  const upcoming=available.filter(note=>note.start_ms>position&&note.start_ms>=segmentStart);
  const count=Math.min(current.length,PIANO_VISIBLE_TARGETS-Math.min(6,upcoming.length));
  const visible=[...current.slice(0,count),...upcoming.slice(0,PIANO_VISIBLE_TARGETS-count)];
  const item=note=>{
    const active=position>=segmentStart&&note.start_ms<=position,continuing=!active&&note.start_ms<segmentStart;
    return{...note,pitch:midiName(note.midi),phase:active?'expected':continuing?'continuing':'upcoming',label:t('label',{hand:handName(note.hand,i18n),finger:note.finger}),shortLabel:`${t(note.hand==='left'?'leftShort':'rightShort')}${i18n.formatNumber(note.finger)}`,time:active?t('expectedNow'):i18n.t(continuing?'instrument.continues':'instrument.in',{seconds:countdown((continuing?segmentStart:note.start_ms)-position,i18n)})};
  };
  const next=plan.assignments.find(note=>note.start_ms>=from&&note.start_ms<segmentEnd);
  const phase=!running&&hasStarted?'paused':position<segmentStart?'count-in':!hasStarted?'ready':current.length?'expected':'rest';
  const prefix=t(phase);
  const state=next?t('next',{phase:prefix,seconds:countdown(next.start_ms-position,i18n)}):t('noNext',{phase:prefix});
  // Every nearby key gets its nearest relevant recommendation, even when cards overflow.
  const keyHints=new Map();for(const note of [...current,...upcoming])if(!keyHints.has(note.midi))keyHints.set(note.midi,item(note));
  return{phase,state,items:visible.map(item),keyHints:[...keyHints.values()],additional:available.length-visible.length};
}

/** Mount after the shell, which moves instrument-settings into its settings dialog. */
export function setupPianoFingeringView({document,api,getContext,onChange=()=>{},openSettings=()=>{},i18n=getAppI18n(document)}){
  const t=(key,params)=>i18n.t('piano.runtime.'+key,params);
  const copy=key=>`<span data-piano-text="${key}"></span>`;
  const raw=error=>`${i18n.t('instrument.originalLabel')}${error.code?' ['+error.code+']':''}: ${error.message||''}`;
  const $=id=>document.getElementById(id),settingsRoot=document.createElement('section'),stageRoot=document.createElement('details');
  settingsRoot.id='piano-fingering-settings';settingsRoot.className='piano-fingering-settings';settingsRoot.setAttribute('aria-labelledby','piano-fingering-title');
  settingsRoot.innerHTML=`<h3 id="piano-fingering-title">${copy('title')}</h3>
    <p id="piano-fingering-keyboard"></p>
    <p>${copy('constraintsHelp')}</p>
    <div class="piano-hand-settings">${['left','right'].map(hand=>`<fieldset><legend>${copy(hand+'Hand')}</legend><label>${copy('low')}<input id="piano-${hand}-low" type="number" min="0" max="127" step="1" value="0"></label><label>${copy('high')}<input id="piano-${hand}-high" type="number" min="0" max="127" step="1" value="127"></label><label>${copy('reach')}<input id="piano-${hand}-reach" type="number" min="0" max="24" step="1" value="12"></label></fieldset>`).join('')}</div>
    <div class="piano-fingering-actions"><button id="piano-fingering-replan" type="button" class="button secondary">${copy('apply')}</button><button id="piano-fingering-discard" type="button" class="button secondary">${copy('discard')}</button></div>
    <p id="piano-fingering-status" role="status" aria-live="polite"></p>
    <details class="piano-lock-editor"><summary>${copy('lockSummary')}</summary><p id="piano-fingering-session">${copy('session')}</p>
      <label>${copy('findSource')}<input id="piano-source-search" type="search" autocomplete="off"></label><label>${copy('source')}<select id="piano-source-note"></select></label><p id="piano-source-count"></p><button id="piano-source-more" type="button" class="button secondary" hidden>${copy('more')}</button>
      <div class="piano-lock-fields"><label>${copy('hand')}<select id="piano-source-hand"><option value="" data-piano-text="automatic"></option><option value="left" data-piano-text="left"></option><option value="right" data-piano-text="right"></option></select></label><label>${copy('finger')}<select id="piano-source-finger"><option value="" data-piano-text="automatic"></option>${[1,2,3,4,5].map(finger=>`<option value="${finger}">${finger}</option>`).join('')}</select></label><button id="piano-lock-remove" type="button" class="button secondary">${copy('removeLock')}</button><button id="piano-lock-clear" type="button" class="button secondary">${copy('clearLocks')}</button></div>
      <p>${copy('lockHelp')}</p><ul id="piano-source-locks"></ul>
    </details>
    <details><summary>${copy('modelTitle')}</summary><p>${copy('modelHelp')}</p><p id="piano-fingering-search"></p><ul id="piano-fingering-issues"></ul><ul id="piano-fingering-diagnostics"></ul></details>`;
  stageRoot.id='piano-fingering-guidance';stageRoot.setAttribute('aria-live','off');stageRoot.setAttribute('aria-label',t('stageLabel'));
  stageRoot.innerHTML=`<summary>${copy('stageTitle')} · <span id="piano-guidance-state"></span></summary><div class="piano-guidance-body"><ol id="piano-guidance-items" tabindex="0"></ol><p id="piano-guidance-overflow" hidden></p><p class="piano-guidance-help">${copy('stageHelp')} · <button id="piano-guidance-settings" type="button">${copy('edit')}</button></p></div>`;
  $('instrument-settings').append(settingsRoot);$('piano-stage').append(stageRoot);
  let guide,scopeScore=null,scopePart=null,sourceOptions=[],sourceLimit=100,sourceSignature='',stateSignature='',cards=new Map(),lastPlayback={},rendering=false,statusError=null;
  const fieldMap={lowest_midi:'low',highest_midi:'high',max_span_semitones:'reach'};
  function writeFields(settings){for(const hand of ['left','right'])for(const[field,suffix]of Object.entries(fieldMap))$(`piano-${hand}-${suffix}`).value=String(settings[`${hand}_hand`][field]);}
  function readFields(settings){const next=structuredClone(settings);for(const hand of ['left','right'])for(const[field,suffix]of Object.entries(fieldMap)){const raw=$(`piano-${hand}-${suffix}`).value;next[`${hand}_hand`][field]=raw.trim()===''?NaN:Number(raw);}return next;}
  function loadLock(){const lock=guide.state().settings.locks.find(lock=>lock.source_note_id===$('piano-source-note').value);$('piano-source-hand').value=lock?.hand||'';$('piano-source-finger').value=lock?.finger?String(lock.finger):'';}
  function renderSources(context,force=false,localeOnly=false){
    if(context?.score!==scopeScore||context?.part_id!==scopePart){scopeScore=context?.score;scopePart=context?.part_id;sourceOptions=pianoSourceNotes(context);sourceLimit=100;sourceSignature='';$('piano-source-search').value='';force=true;}
    const query=$('piano-source-search').value.toLocaleLowerCase();
    const unavailable=fingeringUnavailable(context),signature=JSON.stringify([query,sourceLimit,scopePart,sourceOptions.length,unavailable]);if(!force&&!localeOnly&&signature===sourceSignature)return;sourceSignature=signature;
    const matching=sourceOptions.filter(source=>`${source.id} ${source.partName} ${midiName(pitchMidi(source.note.pitch))}`.toLocaleLowerCase().includes(query));
    if(!localeOnly){
    const previous=$('piano-source-note').value;
    $('piano-source-note').replaceChildren(...matching.slice(0,sourceLimit).map(source=>{const option=document.createElement('option');option.value=source.id;option.textContent=`${source.partName} · ${midiName(pitchMidi(source.note.pitch))} · ${source.id}`;return option;}));
    if(matching.slice(0,sourceLimit).some(source=>source.id===previous))$('piano-source-note').value=previous;else $('piano-source-note').value=matching[0]?.id||'';
    }
    $('piano-source-count').textContent=t('sourceCount',{shown:Math.min(sourceLimit,matching.length),total:matching.length,sources:sourceOptions.length});
    $('piano-source-more').hidden=sourceLimit>=matching.length;
    for(const id of ['piano-source-note','piano-source-hand','piano-source-finger','piano-lock-remove'])$(id).disabled=unavailable||!matching.length;
    if(!localeOnly)loadLock();
  }
  function renderState({localeOnly=false}={}){
    if(!guide||rendering)return;rendering=true;
    try{
      const context=getContext(),state=guide.state(),unavailable=fingeringUnavailableReason(context),active=context?.profile?.kind==='piano';settingsRoot.hidden=!active;stageRoot.hidden=!active;
      const scopeChanged=context?.score!==scopeScore||context?.part_id!==scopePart;if(scopeChanged){statusError=null;writeFields(state.settings);}
      for(const node of document.querySelectorAll('[data-piano-text]'))node.textContent=t(node.getAttribute('data-piano-text'));
      stageRoot.setAttribute('aria-label',t('stageLabel'));$('piano-guidance-items').setAttribute('aria-label',t('stageItems'));
      renderSources(context,false,localeOnly);
      if(unavailable)statusError=null;
      const signature=JSON.stringify([state.phase,state.messageCode,state.errorDetails,state.plan,state.settings,state.draftDirty,context?.profile,Boolean(context?.score),Boolean(context?.dirty),statusError&&{code:statusError.code,message:statusError.message},i18n.revision]);
      if(signature!==stateSignature){
        stateSignature=signature;$('piano-fingering-status').textContent=statusError?errorText(statusError):state.plan?planText(state.plan):t('message.'+(state.messageCode||'piano_fresh'));$('piano-fingering-status').dataset.phase=state.phase;
        const profile=context?.profile,range=profile?.kind==='piano'?pianoKeyboardRange(profile):null;$('piano-fingering-keyboard').textContent=range?t('keyboard',{count:profile.key_count,low:midiName(range.low),high:midiName(range.high)}):t('choosePiano');
        $('piano-fingering-replan').disabled=Boolean(unavailable)||!context?.score||Boolean(context?.dirty)||state.phase==='loading';$('piano-fingering-discard').disabled=!state.draftDirty;
        $('piano-lock-clear').disabled=Boolean(unavailable)||!state.settings.locks.length;
        $('piano-source-locks').replaceChildren(...state.settings.locks.map(lock=>{const li=document.createElement('li');li.textContent=t('lock',{source:lock.source_note_id,hand:lock.hand?handName(lock.hand,i18n):t('automaticHand'),finger:lock.finger?i18n.t('instrument.finger',{finger:lock.finger}):t('automaticFinger')});return li;}));
        const plan=state.plan;$('piano-fingering-search').textContent=plan?t('search',{version:plan.version,algorithm:plan.algorithm,sources:plan.source_occurrence_count,targets:plan.physical_target_count===null?i18n.t('instrument.unknown'):i18n.formatNumber(plan.physical_target_count),beam:plan.beam_width,choices:plan.explored_choices,maximum:plan.max_expansions,pruning:t(plan.beam_pruned?'pruned':'notPruned'),cost:plan.objective_cost===null?i18n.t('instrument.unresolved'):i18n.formatNumber(plan.objective_cost),complete:t(plan.complete?'completeModel':'noPartial')}):t('fresh');
        $('piano-fingering-issues').replaceChildren(...(plan?.issues||[]).map(issue=>{const li=document.createElement('li');li.textContent=raw(issue)+' '+t('issue',{sources:issue.source_note_ids.join(', ')||t('wholeSelection'),occurrences:issue.source_occurrence_ids.join(', ')||t('notGrouped'),targets:issue.target_ids.join(', ')||t('notGrouped')});return li;}));
        $('piano-fingering-diagnostics').replaceChildren(...(state.errorDetails?[state.errorDetails]:(plan?.diagnostics||[])).map(item=>{const li=document.createElement('li');li.textContent=raw(item)+(item.note_id?' '+t('diagnosticSource',{source:item.note_id}):'');return li;}));
      }
    }finally{rendering=false;}
  }
  function planText(plan){return t('status.'+plan.status)+(plan.issues.length?' '+t('issuesCount',{count:plan.issues.length}):'')+' '+t('detailsBelow');}
  function errorText(error){return error.code&&['piano_locks_invalid','piano_hand_invalid','piano_lock_invalid','piano_apply_draft','piano_choose_source','piano_response_invalid'].includes(error.code)?t('error.'+error.code):i18n.t('instrument.error')+' '+raw(error);}
  function showError(error){statusError=error;renderState();}
  const viewError=code=>({code});
  guide=setupPianoFingering({api,getContext,onChange:()=>{renderState();renderGuidance(lastPlayback);onChange();}});
  function editLock(remove=false){
    try{
      statusError=null;const state=guide.state();if(state.draftDirty)throw viewError('piano_apply_draft');
      const source_note_id=$('piano-source-note').value,hand=$('piano-source-hand').value||null,finger=$('piano-source-finger').value?Number($('piano-source-finger').value):null;
      if(!source_note_id)throw viewError('piano_choose_source');
      const locks=state.settings.locks.filter(lock=>lock.source_note_id!==source_note_id);if(!remove&&(hand!==null||finger!==null))locks.push({source_note_id,hand,finger});
      guide.setSettings({...state.settings,locks});loadLock();guide.prepare({retry:true});
    }catch(error){loadLock();showError(error);}
  }
  for(const hand of ['left','right'])for(const suffix of Object.values(fieldMap))$(`piano-${hand}-${suffix}`).addEventListener('input',()=>{statusError=null;guide.setDraftDirty();});
  $('piano-fingering-replan').addEventListener('click',()=>{try{statusError=null;guide.setSettings(readFields(guide.state().settings));guide.prepare({retry:true});}catch(error){showError(error);}});
  $('piano-fingering-discard').addEventListener('click',()=>{statusError=null;writeFields(guide.state().settings);guide.setDraftDirty(false);guide.prepare({retry:true});});
  $('piano-source-search').addEventListener('input',()=>{sourceLimit=100;renderSources(getContext());});
  $('piano-source-more').addEventListener('click',()=>{sourceLimit+=100;renderSources(getContext());});
  $('piano-source-note').addEventListener('change',loadLock);
  for(const id of ['piano-source-hand','piano-source-finger'])$(id).addEventListener('change',()=>editLock());
  $('piano-lock-remove').addEventListener('click',()=>editLock(true));
  $('piano-lock-clear').addEventListener('click',()=>{const state=guide.state();if(state.draftDirty){showError(viewError('piano_apply_draft'));return;}statusError=null;guide.setSettings({...state.settings,locks:[]});loadLock();guide.prepare({retry:true});});
  $('piano-guidance-settings').addEventListener('click',()=>{openSettings();$('instrument-settings').open=true;$('piano-fingering-replan').focus();});
  function renderGuidance(playback){
    if(!guide)return;const state=guide.state(),active=getContext()?.profile?.kind==='piano',view=pianoGuidanceView({...playback,i18n,plan:active&&state.phase==='ready'?state.plan:null});
    stageRoot.dataset.phase=state.phase;$('piano-guidance-state').textContent=state.phase==='ready'?view.state:state.phase==='loading'?t('planning'):state.phase==='unavailable'&&!state.plan?t('message.'+state.messageCode):state.draftDirty?t('draftStage'):state.phase==='unavailable'?t('unavailableStage',{status:t('status.'+state.plan.status)}):t(state.phase==='error'?'retryStage':'freshStage');
    const nextCards=new Map();
    for(const item of view.items){
      let card=cards.get(item.target_id);if(!card){card=document.createElement('li');card.className='piano-finger-target';for(const name of ['pitch','finger','time']){const span=document.createElement(name==='finger'?'strong':'span');span.className=`piano-finger-${name}`;card.append(span);}}
      card.dataset.targetId=item.target_id;card.dataset.sourceIds=JSON.stringify(item.source_note_ids);card.dataset.occurrenceIds=JSON.stringify(item.source_occurrence_ids);card.dataset.phase=item.phase;card.dataset.hand=item.hand;
      card.querySelector('.piano-finger-pitch').textContent=item.pitch;card.querySelector('.piano-finger-finger').textContent=item.label;card.querySelector('.piano-finger-time').textContent=item.time;
      card.title=t('cardDescription',{pitch:item.pitch,hand:handName(item.hand,i18n),finger:item.finger,start:seconds(item.start_ms,i18n),end:seconds(item.end_ms,i18n),sources:item.source_note_ids.join(', '),occurrences:item.source_occurrence_ids.join(', '),parts:item.part_ids.join(', ')});card.setAttribute('aria-label',t('cardLabel',{pitch:item.pitch,label:item.label,time:item.time}));card.setAttribute('aria-description',card.title);nextCards.set(item.target_id,card);
    }
    for(const[id,card]of cards)if(!nextCards.has(id))card.remove();let previous=null;const list=$('piano-guidance-items');for(const card of nextCards.values()){const next=previous?previous.nextElementSibling:list.firstElementChild;if(card!==next)list.insertBefore(card,next);previous=card;}cards=nextCards;
    $('piano-guidance-overflow').hidden=!view.additional;$('piano-guidance-overflow').textContent=view.additional?t('overflow',{count:view.additional}):'';
    const hints=new Map(view.keyHints.map(item=>[item.midi,item]));
    for(const key of document.querySelectorAll('#keyboard .piano-key')){
      const hint=hints.get(Number(key.dataset.midi));let badge=key.querySelector('.piano-finger-label');
      if(!hint){badge?.remove();if(key.hasAttribute('data-finger-guidance')){key.removeAttribute('data-finger-guidance');key.removeAttribute('aria-description');}continue;}
      if(!badge){badge=document.createElement('span');badge.className='piano-finger-label';badge.setAttribute('aria-hidden','true');key.append(badge);}
      badge.textContent=hint.shortLabel;badge.dataset.phase=hint.phase;badge.dataset.hand=hint.hand;key.dataset.fingerGuidance=hint.phase;
      key.setAttribute('aria-description',t('keyDescription',{time:hint.time,hand:handName(hint.hand,i18n),finger:hint.finger}));
    }
    return view;
  }
  renderState();
  const unsubscribe=i18n.subscribe(()=>{renderState({localeOnly:true});renderGuidance(lastPlayback);});
  return{destroy:unsubscribe,controller:guide,
    render(playback={}){lastPlayback=playback;renderState();const view=renderGuidance(playback);if(getContext()?.profile?.kind==='piano')guide.prepare();return view;},
    prepare:options=>guide.prepare(options),state:()=>guide.state(),
  };
}
