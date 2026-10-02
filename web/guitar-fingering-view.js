import {midiName} from './music.js';
import {getAppI18n} from './app-locale.js';
import {validateGuitarPlanningScope} from './guitar-fingering.js';

const assignmentIndexes=new WeakMap();
export function guitarAssignmentIndex(plan){
  if(plan?.status!=='ready')return new Map();
  if(!assignmentIndexes.has(plan))assignmentIndexes.set(plan,new Map(plan.assignments.map(choice=>[choice.occurrence_id,choice])));
  return assignmentIndexes.get(plan);
}
export const GUITAR_FINGERS=['0 · open / capo-open','1 · index','2 · middle','3 · ring','4 · little'];
export function guitarRowLabel(profile,row){
  const pitch=profile?.tuning?.[row-1];
  return `Row ${row}${Number.isInteger(pitch)?` (${midiName(pitch)} tuning${profile.capo?`; ${midiName(pitch+profile.capo)} capo-open`:''})`:''}`;
}
export function guitarChoiceLabel(choice,profile){
  return `${guitarRowLabel(profile,choice.string)} · fret ${choice.fret} · ${choice.finger?`finger ${GUITAR_FINGERS[choice.finger]}`:'open (finger 0)'}`;
}
export function guitarPickingLabel(choice){
  return {downstroke_suggestion:'Downstroke suggestion',upstroke_suggestion:'Upstroke suggestion',simultaneous_pluck_review:'Simultaneous pluck: review technique'}[choice.picking_hint]||'';
}
export function guitarPlanSummary(state,i18n=getAppI18n()){
  if(state.scopeDraft)return i18n.t('guitar.phrase.draft');
  if(state.plan?.status==='no_targets'&&state.plan.planning_scope)return i18n.t('guitar.phrase.noTargets');
  if(state.plan?.status==='ready'&&state.plan.planning_scope)return i18n.t('guitar.phrase.ready',{count:state.plan.assignments.length});
  if(!state.plan)return state.message;
  return {
    ready:`One whole-phrase route · ${state.plan.assignments.length} sounding occurrences`,
    no_targets:'No sounding notes in this selected part',
    infeasible_under_model:'Proven constraint conflict under this model · no complete route',
    no_plan_found:'No route found within retained search paths · another route may exist',
    search_limit:'Search budget reached · feasibility is unresolved',
    unavailable:'Planner limit or unavailable guidance · feasibility is unresolved',
  }[state.plan.status];
}

/** UI consumes Rust assignments and source identities; it never chooses positions. */
export function setupGuitarFingeringView({document,controller,getContext,onRefresh=()=>{},i18n=getAppI18n(document)}){
  const $=id=>document.getElementById(id);
  let sourceScore=null,sourceTimeline=null,sourcePart=undefined,profileKey='',sources=[],lastState='',settingsKey='',selection='';
  const options={showAlternatives:false,showPicking:false};
  const phraseText=[],phraseForm=document.createElement('form'),phraseFields=document.createElement('fieldset');
  phraseForm.id='guitar-phrase-form';phraseFields.id='guitar-phrase-fields';phraseForm.append(phraseFields);
  const labelText=(node,key)=>{phraseText.push([node,key]);return node;};
  phraseFields.append(labelText(document.createElement('legend'),'guitar.phrase.title'));
  function phraseInput(id,key,tag='input'){
    const label=document.createElement('label'),span=labelText(document.createElement('span'),key),input=document.createElement(tag);
    input.id=id;if(tag==='input'){input.type='text';input.autocomplete='off';input.setAttribute('aria-describedby','guitar-phrase-help');}
    label.append(span,input);phraseFields.append(label);return input;
  }
  const phraseMode=phraseInput('guitar-phrase-mode','guitar.phrase.mode','select');
  for(const[value,key]of [['whole','guitar.phrase.whole'],['explicit','guitar.phrase.explicit']]){const option=document.createElement('option');option.value=value;phraseMode.append(labelText(option,key));}
  const phraseFrom=phraseInput('guitar-phrase-from','guitar.phrase.from'),phraseTo=phraseInput('guitar-phrase-to','guitar.phrase.to');
  for(const[id,key,type]of [['guitar-phrase-apply','guitar.phrase.apply','submit'],['guitar-phrase-revert','guitar.phrase.revert','button']]){const button=document.createElement('button');button.id=id;button.type=type;button.className='button secondary compact';phraseFields.append(labelText(button,key));}
  const phraseHelp=document.createElement('p');phraseHelp.id='guitar-phrase-help';phraseFields.append(labelText(phraseHelp,'guitar.phrase.help'));
  const phraseStatus=document.createElement('p');phraseStatus.id='guitar-phrase-status';phraseStatus.setAttribute('role','status');phraseStatus.setAttribute('aria-live','polite');phraseFields.append(phraseStatus);
  $('guitar-plan-controls').insertBefore(phraseForm,$('guitar-annotation-scope'));
  let phraseAppliedKey='',phraseError='';
  const beatText=beat=>beat.denominator===1?String(beat.numerator):`${beat.numerator}/${beat.denominator}`;
  const parseBeat=text=>{const match=/^(\d+)(?:\/(\d+))?$/.exec(text.trim());return match?{numerator:Number(match[1]),denominator:Number(match[2]||1)}:null;};
  const editPhrase=()=>{phraseError='';controller.editPlanningScope();onRefresh();};
  phraseMode.addEventListener('change',editPhrase);phraseFrom.addEventListener('input',editPhrase);phraseTo.addEventListener('input',editPhrase);
  phraseForm.addEventListener('submit',event=>{
    event.preventDefault();phraseError='';
    try{
      if(phraseMode.value==='explicit'&&getContext()?.score?.repeats?.length){phraseError='guitar.phrase.repeats';render();return;}
      const scope=phraseMode.value==='whole'?null:validateGuitarPlanningScope({version:1,from:parseBeat(phraseFrom.value),to:parseBeat(phraseTo.value)});
      controller.setPlanningScope(scope);replan();
    }catch{phraseError='guitar.phrase.invalid';render();}
  });
  $('guitar-phrase-revert').addEventListener('click',()=>{phraseError='';phraseAppliedKey='';controller.revertPlanningScopeDraft();replan();});
  function message(text){$('guitar-lock-message').textContent=text;}
  function populate(select,values){select.replaceChildren(...values.map(([value,text])=>{const option=document.createElement('option');option.value=String(value);option.textContent=text;return option;}));}
  function selectedLock(){
    const lock=controller.state().settings.locks.find(item=>item.source_note_id===$('guitar-lock-source').value);
    for(const field of ['string','fret','finger'])$('guitar-lock-'+field).value=lock?.[field]===null||lock?.[field]===undefined?'':String(lock[field]);
  }
  function filterSources(){
    const filter=$('guitar-source-filter').value.toLocaleLowerCase(),previous=$('guitar-lock-source').value||selection;
    const matches=sources.filter(source=>source.label.toLocaleLowerCase().includes(filter)).sort((a,b)=>Number(b.id.toLocaleLowerCase()===filter)-Number(a.id.toLocaleLowerCase()===filter)),shown=matches.slice(0,200);
    populate($('guitar-lock-source'),shown.map(source=>[source.id,source.label]));
    if(shown.some(source=>source.id===previous))$('guitar-lock-source').value=previous;
    selection=$('guitar-lock-source').value;
    $('guitar-source-count').textContent=`${shown.length} of ${matches.length} matching source notes shown${matches.length>200?'; filter by exact source ID to find another note':''}. A lock applies to every repeat and the complete tie chain.`;
    selectedLock();
  }
  function replan(){
    message('');controller.prepare({retry:true}).then(onRefresh);onRefresh();
  }
  function applySettings(next){
    try{controller.setSettings(next);replan();return true;}catch(error){message(error.message);return false;}
  }
  $('guitar-source-filter').addEventListener('input',filterSources);
  $('guitar-lock-source').addEventListener('change',()=>{selection=$('guitar-lock-source').value;selectedLock();message('Fields below are a draft until Apply lock & replan.');});
  $('guitar-lock-form').addEventListener('submit',event=>{
    event.preventDefault();const id=$('guitar-lock-source').value;
    if(!sources.some(source=>source.id===id)){message('Choose a sounding source note from the selected part.');return;}
    const lock={source_note_id:id};
    for(const field of ['string','fret','finger']){const value=$('guitar-lock-'+field).value;lock[field]=value===''?null:Number(value);}
    if(['string','fret','finger'].every(field=>lock[field]===null)){message('Choose at least one string row, fret or finger, or remove this lock.');return;}
    const state=controller.state();applySettings({...state.settings,locks:[...state.settings.locks.filter(item=>item.source_note_id!==id),lock]});
  });
  $('guitar-remove-lock').addEventListener('click',()=>{const state=controller.state(),id=$('guitar-lock-source').value;applySettings({...state.settings,locks:state.settings.locks.filter(lock=>lock.source_note_id!==id)});selectedLock();});
  $('guitar-clear-locks').addEventListener('click',()=>{const state=controller.state();applySettings({...state.settings,locks:[]});selectedLock();});
  $('guitar-replan').addEventListener('click',()=>{
    const text=$('guitar-max-span').value,span=Number(text);
    if(text.trim()===''||!Number.isInteger(span)||span<0||span>12){message('Choose a whole-number fret span from 0 to 12. The currently applied span is unchanged.');return;}
    const state=controller.state();applySettings({...state.settings,max_fret_span:span});
  });
  for(const[id,key]of [['guitar-show-alternatives','showAlternatives'],['guitar-show-picking','showPicking']])$(id).addEventListener('change',()=>{options[key]=$(id).checked;onRefresh();});
  function render(){
    const state=controller.state(),context=getContext(),profile=context?.profile;
    const nextProfile=JSON.stringify(profile),changedScore=sourceScore!==context?.score;
    for(const[node,key]of phraseText)node.textContent=i18n.t(key);
    const appliedKey=JSON.stringify(state.planningScope??null);
    if(changedScore){phraseAppliedKey='';phraseError='';}
    if(!state.scopeDraft&&phraseAppliedKey!==appliedKey){
      phraseAppliedKey=appliedKey;phraseMode.value=state.planningScope?'explicit':'whole';
      phraseFrom.value=state.planningScope?beatText(state.planningScope.from):'0';phraseTo.value=state.planningScope?beatText(state.planningScope.to):'4';
    }
    const repeated=Boolean(context?.score?.repeats?.length);
    phraseMode.querySelector('option[value="explicit"]').disabled=repeated;
    phraseFrom.disabled=phraseTo.disabled=phraseMode.value!=='explicit'||repeated;
    const inventory=state.scopeInventory||state.plan?.planning_scope;
    const scopeText=state.planningScope?{from:beatText(state.planningScope.from),to:beatText(state.planningScope.to)}:null;
    phraseStatus.textContent=phraseError?i18n.t(phraseError):state.scopeDraft?i18n.t('guitar.phrase.draft'):inventory?i18n.t('guitar.phrase.inventory',{
      ...scopeText,selected:inventory.selected_occurrence_count,total:inventory.full_occurrence_count,holds:inventory.entry_hold_occurrence_ids.length,
      start:i18n.formatDuration(inventory.start_ms,{fractionDigits:3}),end:i18n.formatDuration(inventory.end_ms,{fractionDigits:3})
    }):scopeText?i18n.t('guitar.phrase.pending',scopeText):i18n.t(repeated?'guitar.phrase.repeats':'guitar.phrase.wholeHelp');
    if(changedScore||sourceTimeline!==context?.timeline||sourcePart!==context?.part_id||profileKey!==nextProfile){
      sourceScore=context?.score;sourceTimeline=context?.timeline;sourcePart=context?.part_id;profileKey=nextProfile;settingsKey='';
      const byId=new Map();
      for(const note of context?.timeline?.notes||[]){if(context.part_id!==null&&note.part_id!==context.part_id)continue;for(const id of note.source_note_ids||[]){if(!byId.has(id))byId.set(id,{id,label:`${id} · ${midiName(note.midi)} · ${context.score?.parts.find(part=>part.id===note.part_id)?.name||note.part_id}`});}}
      sources=[...byId.values()];
      populate($('guitar-lock-string'),[['','Any row'],...(profile?.tuning||[]).map((_,index)=>[index+1,guitarRowLabel(profile,index+1)])]);
      populate($('guitar-lock-fret'),[['','Any fret'],...Array.from({length:Math.max(0,(profile?.frets||0)-(profile?.capo||0))+1},(_,index)=>[index,index===0?'0 · open / capo-open':String(index)])]);
      populate($('guitar-lock-finger'),[['','Any finger'],...GUITAR_FINGERS.map((name,index)=>[index,name])]);
      if(changedScore){$('guitar-source-filter').value='';selection='';settingsKey='';message('');}
      filterSources();
    }
    const nextSettings=JSON.stringify([state.settings,inventory,state.planningScope,i18n.revision]);
    if(settingsKey!==nextSettings){
      settingsKey=nextSettings;$('guitar-max-span').value=String(state.settings.max_fret_span);selectedLock();
      const included=inventory?new Set(inventory.included_occurrence_ids):null;
      const visible=new Set(sources.map(source=>source.id));
      const active=included?new Set((context?.timeline?.notes||[]).filter(note=>included.has(note.id)).flatMap(note=>note.source_note_ids)):visible;
      const lockSuffix=id=>!visible.has(id)?' (other part; inactive for this selection)':state.planningScope&&!inventory?i18n.t('guitar.phrase.pendingLock'):!active.has(id)?i18n.t('guitar.phrase.inactiveLock'):'';
      $('guitar-lock-list').replaceChildren(...state.settings.locks.map(lock=>{const li=document.createElement('li');li.textContent=`${lock.source_note_id}: ${['string','fret','finger'].filter(field=>lock[field]!==null).map(field=>field==='string'?guitarRowLabel(profile,lock.string):`${field} ${lock[field]}`).join(' · ')}${lockSuffix(lock.source_note_id)}`;const remove=document.createElement('button');remove.type='button';remove.className='button secondary compact';remove.textContent='Remove';remove.setAttribute('aria-label',`Remove guitar lock for ${lock.source_note_id}`);remove.addEventListener('click',()=>{const current=controller.state();applySettings({...current.settings,locks:current.settings.locks.filter(item=>item.source_note_id!==lock.source_note_id)});});li.append(' ',remove);return li;}));
      $('guitar-lock-count').textContent=state.planningScope?(inventory?i18n.t('guitar.phrase.locks',{total:state.settings.locks.length,active:state.settings.locks.filter(lock=>active.has(lock.source_note_id)).length}):i18n.t('guitar.phrase.locksPending',{total:state.settings.locks.length})):`${state.settings.locks.length} session lock(s); ${state.settings.locks.filter(lock=>visible.has(lock.source_note_id)).length} apply to the selected part(s). Applied fret span: ${state.settings.max_fret_span}.`;
    }
    const signature=JSON.stringify([state.phase,state.message,state.plan,state.scopeDraft,i18n.revision]);
    if(signature!==lastState){
      lastState=signature;$('guitar-plan-status').textContent=guitarPlanSummary(state,i18n);$('guitar-planning').dataset.status=state.plan?.status||state.phase;
      $('guitar-plan-model').textContent=state.plan?`Rust ${state.plan.algorithm} · beam ${state.plan.beam_width} · ${state.plan.explored_choices.toLocaleString()} choices · ${state.plan.beam_pruned?'some paths pruned':'no beam pruning'}${state.plan.objective_cost===null?'':` · model cost ${state.plan.objective_cost}`}. ${i18n.t(state.plan.planning_scope?'guitar.phrase.help':'guitar.phrase.wholeHelp')}`:i18n.t(state.planningScope||state.scopeDraft?'guitar.phrase.help':'guitar.phrase.wholeHelp');
      $('guitar-plan-diagnostics').replaceChildren(...(state.plan?.diagnostics||[]).map(diagnostic=>{
        const li=document.createElement('li');let identity='';
        if(diagnostic.note_id){
          const note=context.timeline?.notes.find(note=>note.id===diagnostic.note_id);
          if(note){
            const simultaneous=context.timeline.notes.filter(other=>(context.part_id===null||other.part_id===context.part_id)&&other.start_ms<=note.start_ms&&other.start_ms+other.duration_ms>note.start_ms);
            const sourceIds=[...new Set(simultaneous.flatMap(other=>other.source_note_ids||[]))];
            identity=` Occurrence ${note.id}; source notes ${(note.source_note_ids||[]).join(', ')}; onset ${(note.start_ms/1000).toFixed(3)}s. Simultaneous/held source context for review: ${sourceIds.join(', ')}.`;
          }else identity=` Source/occurrence ID: ${diagnostic.note_id}.`;
        }
        li.textContent=`${diagnostic.message}${identity}`;return li;
      }));
    }
    const enabled=Boolean(context?.score&&context?.timeline&&profile?.kind==='guitar'&&!context.dirty);
    phraseFields.disabled=!enabled;$('guitar-phrase-revert').disabled=!state.scopeDraft;$('guitar-phrase-apply').disabled=!enabled;
    $('guitar-replan').disabled=!enabled||state.phase==='loading'||state.scopeDraft;
    $('guitar-lock-fields').disabled=!enabled||!sources.length;
    $('guitar-clear-locks').disabled=!enabled||!state.settings.locks.length;
    return state;
  }
  const unsubscribe=i18n.subscribe(()=>render());
  return{render,options:()=>({...options}),destroy:()=>{unsubscribe();phraseForm.remove();}};
}

/** One chosen row/fret per source occurrence, never a pitch-to-position solver.
 * `nextNotes` is the complete strictly-next attack group from guitarGuidanceView.
 * Retained assignments join the next shape only when their score end is later.
 */
export function highlightGuitarRoute(document,{notes=[],nextNotes=[],groups=new Map(),plan=null,position=null,nextOnsetMs=nextNotes[0]?.start_ms??null,showAlternatives=false}){
  const assignments=guitarAssignmentIndex(plan),chosen=new Map(),next=new Map(),pitches=new Set(notes.map(note=>note.midi));
  const add=(map,choice)=>{const key=`${choice.string-1}:${choice.fret}`;if(!map.has(key))map.set(key,[]);if(!map.get(key).some(other=>other.occurrence_id===choice.occurrence_id))map.get(key).push(choice);};
  const currentChoices=[];
  for(const note of notes)for(const id of groups.get(note.id)?.source_occurrence_ids||[note.id]){
    const choice=assignments.get(id);if(choice&&(!Number.isFinite(position)||choice.end_ms>position)){add(chosen,choice);currentChoices.push(choice);}
  }
  for(const note of nextNotes)for(const id of groups.get(note.id)?.source_occurrence_ids||[note.id]){const choice=assignments.get(id);if(choice)add(next,choice);}
  if(nextOnsetMs!==null)for(const choice of currentChoices)if(choice.end_ms>nextOnsetMs)add(next,choice);
  for(const button of document.querySelectorAll('#fretboard .fret-button')){
    const key=`${button.dataset.string}:${button.dataset.fret}`,choices=chosen.get(key)||[],nextChoices=next.get(key)||[];
    button.classList.toggle('playing',choices.length>0);button.classList.toggle('route-next',nextChoices.length>0);
    button.classList.toggle('pitch-option',showAlternatives&&pitches.has(Number(button.dataset.midi))&&!choices.length&&!nextChoices.length);
    const setData=(name,value)=>{if(button.dataset[name]!==value)button.dataset[name]=value;};
    const ids=[...new Set(choices.flatMap(choice=>choice.source_note_ids))],nextIds=[...new Set(nextChoices.flatMap(choice=>choice.source_note_ids))];
    setData('recommended',String(choices.length>0));setData('nextRecommended',String(nextChoices.length>0));
    setData('sourceIds',JSON.stringify(ids));setData('occurrenceIds',JSON.stringify(choices.map(choice=>choice.occurrence_id)));setData('fingers',[...new Set(choices.map(choice=>choice.finger))].join(','));
    setData('nextSourceIds',JSON.stringify(nextIds));setData('nextOccurrenceIds',JSON.stringify(nextChoices.map(choice=>choice.occurrence_id)));setData('nextFingers',[...new Set(nextChoices.map(choice=>choice.finger))].join(','));
    setData('routeLabel',[choices.length?`Now ${button.dataset.fingers}`:'',nextChoices.length?`Next ${button.dataset.nextFingers}`:''].filter(Boolean).join(' · '));
    const descriptions=[];
    if(choices.length)descriptions.push(`Recommended now: ${choices.map(choice=>guitarChoiceLabel(choice,plan.profile)).join('; ')}. Sources ${ids.join(', ')}.`);
    if(nextChoices.length)descriptions.push(`Recommended next shape: ${nextChoices.map(choice=>`${guitarChoiceLabel(choice,plan.profile)} (${choices.some(current=>current.occurrence_id===choice.occurrence_id)?'hold, no new attack':'new attack'})`).join('; ')}. Sources ${nextIds.join(', ')}.`);
    const description=descriptions.length?`${descriptions.join(' ')} Pitch input does not verify this string or finger.`:null;
    if(button.getAttribute('aria-description')!==description){if(description)button.setAttribute('aria-description',description);else button.removeAttribute('aria-description');}
  }
}
