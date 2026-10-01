import {midiName,pitchMidi} from './music.js';
import {pianoKeyboardRange,pianoSourceNotes,setupPianoFingering} from './piano-fingering.js';

export const PIANO_VISIBLE_TARGETS=8;
export const PIANO_LOOKAHEAD_MS=4000;
const seconds=ms=>(ms/1000).toFixed(3);
const countdown=ms=>`${Math.max(0,ms/1000).toFixed(1)}s`;
const handName=hand=>hand==='left'?'Left':'Right';

/** A finite readout of Rust recommendations; input/held-key state is never consulted. */
export function pianoGuidanceView({plan,position=0,segmentStart=0,segmentEnd=Infinity,running=false,hasStarted=false,completed=false}={}){
  if(plan?.status!=='ready'||!plan.complete)return{phase:'pending',state:'Hand/finger guidance pending',items:[],keyHints:[],additional:0};
  if(completed)return{phase:'complete',state:'Phrase complete · no upcoming fingers',items:[],keyHints:[],additional:0};
  const from=Math.max(position,segmentStart),to=Math.min(segmentEnd,position+PIANO_LOOKAHEAD_MS);
  const available=plan.assignments.filter(note=>note.start_ms<segmentEnd&&note.end_ms>from&&note.start_ms<=to);
  const current=available.filter(note=>note.start_ms<=position||note.start_ms<segmentStart);
  const upcoming=available.filter(note=>note.start_ms>position&&note.start_ms>=segmentStart);
  const count=Math.min(current.length,PIANO_VISIBLE_TARGETS-Math.min(6,upcoming.length));
  const visible=[...current.slice(0,count),...upcoming.slice(0,PIANO_VISIBLE_TARGETS-count)];
  const item=note=>{
    const active=position>=segmentStart&&note.start_ms<=position,continuing=!active&&note.start_ms<segmentStart;
    return{...note,pitch:midiName(note.midi),phase:active?'expected':continuing?'continuing':'upcoming',label:`${handName(note.hand)} ${note.finger}`,shortLabel:`${note.hand==='left'?'L':'R'}${note.finger}`,time:active?'Expected now':continuing?`Continues in ${countdown(segmentStart-position)}`:`In ${countdown(note.start_ms-position)}`};
  };
  const next=plan.assignments.find(note=>note.start_ms>=from&&note.start_ms<segmentEnd);
  const phase=!running&&hasStarted?'paused':position<segmentStart?'count-in':!hasStarted?'ready':current.length?'expected':'rest';
  const prefix={paused:'Paused',ready:'Recommended',expected:'Expected in score',rest:'Rest','count-in':'Count-in'}[phase];
  const state=next?`${prefix} · next in ${countdown(next.start_ms-position)}`:`${prefix} · no upcoming attacks`;
  // Every nearby key gets its nearest relevant recommendation, even when cards overflow.
  const keyHints=new Map();for(const note of [...current,...upcoming])if(!keyHints.has(note.midi))keyHints.set(note.midi,item(note));
  return{phase,state,items:visible.map(item),keyHints:[...keyHints.values()],additional:available.length-visible.length};
}

/** Mount after the shell, which moves instrument-settings into its settings dialog. */
export function setupPianoFingeringView({document,api,getContext,onChange=()=>{},openSettings=()=>{}}){
  const $=id=>document.getElementById(id),settingsRoot=document.createElement('section'),stageRoot=document.createElement('details');
  settingsRoot.id='piano-fingering-settings';settingsRoot.className='piano-fingering-settings';settingsRoot.setAttribute('aria-labelledby','piano-fingering-title');
  settingsRoot.innerHTML=`<h3 id="piano-fingering-title">Piano hands &amp; fingers · 钢琴指法</h3>
    <p id="piano-fingering-keyboard"></p>
    <p>Configured constraints, not measured hand reach or verified hardware. Fingers: 1 thumb, 2 index, 3 middle, 4 ring, 5 little finger.</p>
    <div class="piano-hand-settings">${['left','right'].map(hand=>`<fieldset><legend>${handName(hand)} hand</legend><label>Lowest MIDI key<input id="piano-${hand}-low" type="number" min="0" max="127" step="1" value="0"></label><label>Highest MIDI key<input id="piano-${hand}-high" type="number" min="0" max="127" step="1" value="127"></label><label>Maximum reach (semitones)<input id="piano-${hand}-reach" type="number" min="0" max="24" step="1" value="12"></label></fieldset>`).join('')}</div>
    <div class="piano-fingering-actions"><button id="piano-fingering-replan" type="button" class="button secondary">Apply hand settings &amp; replan</button><button id="piano-fingering-discard" type="button" class="button secondary">Discard hand edits</button></div>
    <p id="piano-fingering-status" role="status" aria-live="polite"></p>
    <details class="piano-lock-editor"><summary>Assign a source note to a hand or finger</summary><p id="piano-fingering-session">Session annotations v1. Source locks apply to every repeated occurrence and all tied/merged targets containing that written note. They clear on score recompilation or selected-part changes; hand settings remain. Nothing is saved to the score, library, take export or hardware.</p>
      <label>Find source note (ID, part or pitch)<input id="piano-source-search" type="search" autocomplete="off"></label><label>Canonical source note<select id="piano-source-note"></select></label><p id="piano-source-count"></p><button id="piano-source-more" type="button" class="button secondary" hidden>Show more matching source notes</button>
      <div class="piano-lock-fields"><label>Hand<select id="piano-source-hand"><option value="">Automatic</option><option value="left">Left</option><option value="right">Right</option></select></label><label>Finger<select id="piano-source-finger"><option value="">Automatic</option>${[1,2,3,4,5].map(finger=>`<option value="${finger}">${finger}</option>`).join('')}</select></label><button id="piano-lock-remove" type="button" class="button secondary">Remove selected lock</button><button id="piano-lock-clear" type="button" class="button secondary">Clear all source locks</button></div>
      <p>Hand/finger changes apply immediately and request a new plan. Automatic for both removes a lock. Choose a source note before editing; no source identity is inferred from played MIDI.</p><ul id="piano-source-locks"></ul>
    </details>
    <details><summary>Recommendation model, limits &amp; affected sources</summary><p>One deterministic bounded recommendation for the whole selected phrase. The model considers two hands, key range, simultaneous notes, configured reach, active holds and finger occupancy. It allows hand crossing; it does not model pedal or finger substitution. Movement preferences are not a universal biomechanical optimum. Expected keys, held input and this recommendation are separate; MIDI pitch alone cannot verify hands or fingers.</p><p id="piano-fingering-search"></p><ul id="piano-fingering-issues"></ul><ul id="piano-fingering-diagnostics"></ul></details>`;
  stageRoot.id='piano-fingering-guidance';stageRoot.setAttribute('aria-live','off');stageRoot.setAttribute('aria-label','Recommended piano hands and fingers, separate from expected and held keys');
  stageRoot.innerHTML='<summary>Hands &amp; fingers · <span id="piano-guidance-state">Preparing</span></summary><div class="piano-guidance-body"><ol id="piano-guidance-items" tabindex="0" aria-label="Current and next four seconds of recommended fingers"></ol><p id="piano-guidance-overflow" hidden></p><p class="piano-guidance-help">L / R = recommended hand · 1–5 = finger · expected and held colors stay separate · <button id="piano-guidance-settings" type="button">Edit constraints</button></p></div>';
  $('instrument-settings').append(settingsRoot);$('piano-stage').append(stageRoot);
  let guide,scopeScore=null,scopePart=null,sourceOptions=[],sourceLimit=100,sourceSignature='',stateSignature='',cards=new Map(),lastPlayback={},rendering=false;
  const fieldMap={lowest_midi:'low',highest_midi:'high',max_span_semitones:'reach'};
  function writeFields(settings){for(const hand of ['left','right'])for(const[field,suffix]of Object.entries(fieldMap))$(`piano-${hand}-${suffix}`).value=String(settings[`${hand}_hand`][field]);}
  function readFields(settings){const next=structuredClone(settings);for(const hand of ['left','right'])for(const[field,suffix]of Object.entries(fieldMap)){const raw=$(`piano-${hand}-${suffix}`).value;next[`${hand}_hand`][field]=raw.trim()===''?NaN:Number(raw);}return next;}
  function loadLock(){const lock=guide.state().settings.locks.find(lock=>lock.source_note_id===$('piano-source-note').value);$('piano-source-hand').value=lock?.hand||'';$('piano-source-finger').value=lock?.finger?String(lock.finger):'';}
  function renderSources(context,force=false){
    if(context?.score!==scopeScore||context?.part_id!==scopePart){scopeScore=context?.score;scopePart=context?.part_id;sourceOptions=pianoSourceNotes(context);sourceLimit=100;sourceSignature='';$('piano-source-search').value='';force=true;}
    const query=$('piano-source-search').value.toLocaleLowerCase();
    const signature=JSON.stringify([query,sourceLimit,scopePart,sourceOptions.length]);if(!force&&signature===sourceSignature)return;sourceSignature=signature;
    const matching=sourceOptions.filter(source=>`${source.id} ${source.partName} ${midiName(pitchMidi(source.note.pitch))}`.toLocaleLowerCase().includes(query));
    const previous=$('piano-source-note').value;
    $('piano-source-note').replaceChildren(...matching.slice(0,sourceLimit).map(source=>{const option=document.createElement('option');option.value=source.id;option.textContent=`${source.partName} · ${midiName(pitchMidi(source.note.pitch))} · ${source.id}`;return option;}));
    if(matching.slice(0,sourceLimit).some(source=>source.id===previous))$('piano-source-note').value=previous;else $('piano-source-note').value=matching[0]?.id||'';
    $('piano-source-count').textContent=`${Math.min(sourceLimit,matching.length)} of ${matching.length} matching written notes shown; ${sourceOptions.length} sounding source notes in the selection. Search by exact ID to find any note.`;
    $('piano-source-more').hidden=sourceLimit>=matching.length;
    for(const id of ['piano-source-note','piano-source-hand','piano-source-finger','piano-lock-remove'])$(id).disabled=!matching.length;
    loadLock();
  }
  function renderState(){
    if(!guide||rendering)return;rendering=true;
    try{
      const context=getContext(),state=guide.state(),active=context?.profile?.kind==='piano';settingsRoot.hidden=!active;stageRoot.hidden=!active;
      const scopeChanged=context?.score!==scopeScore||context?.part_id!==scopePart;if(scopeChanged)writeFields(state.settings);
      renderSources(context);
      const signature=JSON.stringify([state.phase,state.message,state.settings,state.draftDirty,context?.profile,Boolean(context?.score),Boolean(context?.dirty)]);
      if(signature!==stateSignature){
        stateSignature=signature;$('piano-fingering-status').textContent=state.message;$('piano-fingering-status').dataset.phase=state.phase;
        const profile=context?.profile,range=profile?.kind==='piano'?pianoKeyboardRange(profile):null;$('piano-fingering-keyboard').textContent=range?`Uses configured keyboard: ${profile.key_count} keys, ${midiName(range.low)}–${midiName(range.high)}. Change keyboard size/range in Instrument setup.`:'Choose Piano to plan hand guidance.';
        $('piano-fingering-replan').disabled=!context?.score||Boolean(context?.dirty)||state.phase==='loading';$('piano-fingering-discard').disabled=!state.draftDirty;
        $('piano-lock-clear').disabled=!state.settings.locks.length;
        $('piano-source-locks').replaceChildren(...state.settings.locks.map(lock=>{const li=document.createElement('li');li.textContent=`${lock.source_note_id}: ${lock.hand?handName(lock.hand):'Automatic hand'}, ${lock.finger?`finger ${lock.finger}`:'automatic finger'}`;return li;}));
        const plan=state.plan;$('piano-fingering-search').textContent=plan?`Plan v${plan.version}; ${plan.algorithm}. ${plan.source_occurrence_count} source occurrences; ${plan.physical_target_count??'unknown'} physical targets. Beam ${plan.beam_width}; ${plan.explored_choices} of ${plan.max_expansions} allowed choices explored; ${plan.beam_pruned?'beam pruned':'beam not pruned'}. Heuristic cost: ${plan.objective_cost??'unresolved'} (not a performance grade). ${plan.complete?'Complete under this model.':'No partial finger route is displayed.'}`:'A fresh Rust plan is required.';
        $('piano-fingering-issues').replaceChildren(...(plan?.issues||[]).map(issue=>{const li=document.createElement('li');li.textContent=`${issue.message} Source notes: ${issue.source_note_ids.join(', ')||'whole selection'}. Occurrences: ${issue.source_occurrence_ids.join(', ')||'not grouped'}. Targets: ${issue.target_ids.join(', ')||'not grouped'}.`;return li;}));
        $('piano-fingering-diagnostics').replaceChildren(...(plan?.diagnostics||[]).map(item=>{const li=document.createElement('li');li.textContent=`${item.message}${item.note_id?` Source note: ${item.note_id}.`:''}`;return li;}));
      }
    }finally{rendering=false;}
  }
  guide=setupPianoFingering({api,getContext,onChange:()=>{renderState();renderGuidance(lastPlayback);onChange();}});
  function editLock(remove=false){
    try{
      const state=guide.state();if(state.draftDirty)throw Error('Apply or discard hand-range edits before changing source locks.');
      const source_note_id=$('piano-source-note').value,hand=$('piano-source-hand').value||null,finger=$('piano-source-finger').value?Number($('piano-source-finger').value):null;
      if(!source_note_id)throw Error('Choose a canonical source note first.');
      const locks=state.settings.locks.filter(lock=>lock.source_note_id!==source_note_id);if(!remove&&(hand!==null||finger!==null))locks.push({source_note_id,hand,finger});
      guide.setSettings({...state.settings,locks});loadLock();guide.prepare({retry:true});
    }catch(error){loadLock();$('piano-fingering-status').textContent=error.message;}
  }
  for(const hand of ['left','right'])for(const suffix of Object.values(fieldMap))$(`piano-${hand}-${suffix}`).addEventListener('input',()=>guide.setDraftDirty());
  $('piano-fingering-replan').addEventListener('click',()=>{try{guide.setSettings(readFields(guide.state().settings));guide.prepare({retry:true});}catch(error){$('piano-fingering-status').textContent=error.message;}});
  $('piano-fingering-discard').addEventListener('click',()=>{writeFields(guide.state().settings);guide.setDraftDirty(false);guide.prepare({retry:true});});
  $('piano-source-search').addEventListener('input',()=>{sourceLimit=100;renderSources(getContext());});
  $('piano-source-more').addEventListener('click',()=>{sourceLimit+=100;renderSources(getContext());});
  $('piano-source-note').addEventListener('change',loadLock);
  for(const id of ['piano-source-hand','piano-source-finger'])$(id).addEventListener('change',()=>editLock());
  $('piano-lock-remove').addEventListener('click',()=>editLock(true));
  $('piano-lock-clear').addEventListener('click',()=>{const state=guide.state();if(state.draftDirty){$('piano-fingering-status').textContent='Apply or discard hand-range edits before changing source locks.';return;}guide.setSettings({...state.settings,locks:[]});loadLock();guide.prepare({retry:true});});
  $('piano-guidance-settings').addEventListener('click',()=>{openSettings();$('instrument-settings').open=true;$('piano-fingering-replan').focus();});
  function renderGuidance(playback){
    if(!guide)return;const state=guide.state(),active=getContext()?.profile?.kind==='piano',view=pianoGuidanceView({...playback,plan:active&&state.phase==='ready'?state.plan:null});
    stageRoot.dataset.phase=state.phase;$('piano-guidance-state').textContent=state.phase==='ready'?view.state:state.phase==='loading'?'Planning…':state.draftDirty?'Settings edited · replan':state.phase==='unavailable'?`${state.plan?.status?.replaceAll('_',' ')||'Unavailable'} · see settings`:state.phase==='error'?'Unavailable · retry in settings':'Fresh plan needed';
    const nextCards=new Map();
    for(const item of view.items){
      let card=cards.get(item.target_id);if(!card){card=document.createElement('li');card.className='piano-finger-target';for(const name of ['pitch','finger','time']){const span=document.createElement(name==='finger'?'strong':'span');span.className=`piano-finger-${name}`;card.append(span);}}
      card.dataset.targetId=item.target_id;card.dataset.sourceIds=JSON.stringify(item.source_note_ids);card.dataset.occurrenceIds=JSON.stringify(item.source_occurrence_ids);card.dataset.phase=item.phase;card.dataset.hand=item.hand;
      card.querySelector('.piano-finger-pitch').textContent=item.pitch;card.querySelector('.piano-finger-finger').textContent=item.label;card.querySelector('.piano-finger-time').textContent=item.time;
      card.title=`${item.pitch}, recommended ${handName(item.hand).toLowerCase()} hand finger ${item.finger}. Onset ${seconds(item.start_ms)}s, end ${seconds(item.end_ms)}s. Source notes: ${item.source_note_ids.join(', ')}. Occurrences: ${item.source_occurrence_ids.join(', ')}. Parts: ${item.part_ids.join(', ')}. This does not verify a held key or finger.`;card.setAttribute('aria-label',`${item.pitch}, ${item.label}, ${item.time}`);card.setAttribute('aria-description',card.title);nextCards.set(item.target_id,card);
    }
    for(const[id,card]of cards)if(!nextCards.has(id))card.remove();let previous=null;const list=$('piano-guidance-items');for(const card of nextCards.values()){const next=previous?previous.nextElementSibling:list.firstElementChild;if(card!==next)list.insertBefore(card,next);previous=card;}cards=nextCards;
    $('piano-guidance-overflow').hidden=!view.additional;$('piano-guidance-overflow').textContent=view.additional?`+${view.additional} more expected/upcoming targets. Every target and source remains in the plan.`:'';
    const hints=new Map(view.keyHints.map(item=>[item.midi,item]));
    for(const key of document.querySelectorAll('#keyboard .piano-key')){
      const hint=hints.get(Number(key.dataset.midi));let badge=key.querySelector('.piano-finger-label');
      if(!hint){badge?.remove();if(key.hasAttribute('data-finger-guidance')){key.removeAttribute('data-finger-guidance');key.removeAttribute('aria-description');}continue;}
      if(!badge){badge=document.createElement('span');badge.className='piano-finger-label';badge.setAttribute('aria-hidden','true');key.append(badge);}
      badge.textContent=hint.shortLabel;badge.dataset.phase=hint.phase;badge.dataset.hand=hint.hand;key.dataset.fingerGuidance=hint.phase;
      key.setAttribute('aria-description',`${hint.time}: recommended ${handName(hint.hand).toLowerCase()} hand, finger ${hint.finger}. Guidance does not verify held input.`);
    }
    return view;
  }
  renderState();
  return{controller:guide,
    render(playback={}){lastPlayback=playback;renderState();const view=renderGuidance(playback);if(getContext()?.profile?.kind==='piano')guide.prepare();return view;},
    prepare:options=>guide.prepare(options),state:()=>guide.state(),
  };
}
