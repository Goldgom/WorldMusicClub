import {midiName} from './music.js';

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
export function guitarPlanSummary(state){
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
export function setupGuitarFingeringView({document,controller,getContext,onRefresh=()=>{}}){
  const $=id=>document.getElementById(id);
  let sourceScore=null,sourceTimeline=null,sourcePart=undefined,profileKey='',sources=[],lastState='',settingsKey='',selection='';
  const options={showAlternatives:false,showPicking:false};
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
    const nextSettings=JSON.stringify(state.settings);
    if(settingsKey!==nextSettings){
      settingsKey=nextSettings;$('guitar-max-span').value=String(state.settings.max_fret_span);selectedLock();
      const visible=new Set(sources.map(source=>source.id));
      $('guitar-lock-list').replaceChildren(...state.settings.locks.map(lock=>{const li=document.createElement('li');li.textContent=`${lock.source_note_id}: ${['string','fret','finger'].filter(field=>lock[field]!==null).map(field=>field==='string'?guitarRowLabel(profile,lock.string):`${field} ${lock[field]}`).join(' · ')}${visible.has(lock.source_note_id)?'':' (other part; inactive for this selection)'}`;const remove=document.createElement('button');remove.type='button';remove.className='button secondary compact';remove.textContent='Remove';remove.setAttribute('aria-label',`Remove guitar lock for ${lock.source_note_id}`);remove.addEventListener('click',()=>{const current=controller.state();applySettings({...current.settings,locks:current.settings.locks.filter(item=>item.source_note_id!==lock.source_note_id)});});li.append(' ',remove);return li;}));
      $('guitar-lock-count').textContent=`${state.settings.locks.length} session lock(s); ${state.settings.locks.filter(lock=>visible.has(lock.source_note_id)).length} apply to the selected part(s). Applied fret span: ${state.settings.max_fret_span}.`;
    }
    const signature=JSON.stringify([state.phase,state.message,state.plan]);
    if(signature!==lastState){
      lastState=signature;$('guitar-plan-status').textContent=guitarPlanSummary(state);$('guitar-planning').dataset.status=state.plan?.status||state.phase;
      $('guitar-plan-model').textContent=state.plan?`Rust ${state.plan.algorithm} · beam ${state.plan.beam_width} · ${state.plan.explored_choices.toLocaleString()} choices · ${state.plan.beam_pruned?'some paths pruned':'no beam pruning'}${state.plan.objective_cost===null?'':` · model cost ${state.plan.objective_cost}`}. Whole selected part(s), including outside an A–B loop; loop-wrap movement is not modeled.`:'Planning uses the complete selected part(s). Score, source retention and assessment are unchanged.';
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
    $('guitar-replan').disabled=!enabled||state.phase==='loading';
    $('guitar-lock-fields').disabled=!enabled||!sources.length;
    $('guitar-clear-locks').disabled=!enabled||!state.settings.locks.length;
    return state;
  }
  return{render,options:()=>({...options})};
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
