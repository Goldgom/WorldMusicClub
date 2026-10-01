import {equivalentJson} from './adaptation-view.js';
import {keyboardGeometry} from './music.js';

const STATUSES=new Set(['ready','no_targets','infeasible_under_model','no_plan_found','search_limit','unavailable']);
const integer=(value,low,high)=>Number.isSafeInteger(value)&&value>=low&&value<=high;
const sourceIds=note=>note.source_note_ids?.length?note.source_note_ids:[note.source_note_id||note.id];
const sameSet=(values,wanted)=>Array.isArray(values)&&values.length===wanted.size&&new Set(values).size===values.length&&values.every(value=>wanted.has(value));
const selectedNotes=context=>context.timeline.notes.filter(note=>context.part_id===null||note.part_id===context.part_id);
export const PIANO_ANNOTATION_VERSION=1;
export const defaultPianoSettings=()=>({left_hand:{lowest_midi:0,highest_midi:127,max_span_semitones:12},right_hand:{lowest_midi:0,highest_midi:127,max_span_semitones:12},locks:[]});
export function pianoKeyboardRange(profile){const keys=keyboardGeometry(profile.key_count,profile.lowest_midi);return{low:keys[0].midi,high:keys.at(-1).midi};}

/** The editor uses written canonical notes, including tied segments, never guessed pitch identities. */
export function pianoSourceNotes(context){
  return(context?.score?.parts||[]).filter(part=>context.part_id===null||part.id===context.part_id).flatMap(part=>part.notes.filter(note=>note.pitch).map(note=>({id:note.id,partId:part.id,partName:part.name,note})));
}

export function validatePianoSettings(settings,context){
  if(!settings||!Array.isArray(settings.locks)||settings.locks.length>1000)throw Error('Use at most 1,000 source-note hand/finger locks.');
  for(const field of ['left_hand','right_hand']){
    const hand=settings[field];
    if(!hand||!integer(hand.lowest_midi,0,127)||!integer(hand.highest_midi,hand.lowest_midi,127)||!integer(hand.max_span_semitones,0,24))throw Error('Each hand needs MIDI limits from 0–127, lowest no higher than highest, and a reach from 0–24 semitones.');
  }
  const available=new Set(pianoSourceNotes(context).map(note=>note.id)),seen=new Set();
  for(const lock of settings.locks){
    if(!lock||!available.has(lock.source_note_id)||seen.has(lock.source_note_id)
      ||lock.hand!==null&&!['left','right'].includes(lock.hand)
      ||lock.finger!==null&&!integer(lock.finger,1,5)
      ||lock.hand===null&&lock.finger===null)throw Error('Choose a unique sounding source note in the selected part and a hand and/or finger from 1–5.');
    seen.add(lock.source_note_id);
  }
  return settings;
}

/** Check Rust's complete physical/source correspondence, without planning in JavaScript. */
export function validatePianoFingering(plan,context,settings){
  const fail=()=>{throw Error('The piano recommendation does not match this complete score, selected part, keyboard, hand settings or locks. Request a fresh Rust plan; the original score is unchanged.');};
  const profile=context?.profile;
  if(!context?.score||!Array.isArray(context.timeline?.notes)||profile?.kind!=='piano'||profile.lowest_midi!==null&&!integer(profile.lowest_midi,0,127)||!integer(profile.key_count,12,128))fail();
  let range;try{range=pianoKeyboardRange(profile);}catch{fail();}
  const notes=selectedNotes(context),byId=new Map(notes.map(note=>[note.id,note]));
  if(byId.size!==notes.length)fail();
  const onsets=new Map([...new Set(notes.map(note=>note.start_ms))].sort((a,b)=>a-b).map((at,index)=>[at,index]));
  if(!plan||plan.version!==1||plan.algorithm!=='deterministic_piano_beam_v1'||!STATUSES.has(plan.status)
    ||plan.score_id!==context.score.id||plan.part_id!==context.part_id||!equivalentJson(plan.profile,profile)
    ||plan.changed_source_notes!==false||typeof plan.complete!=='boolean'||plan.source_occurrence_count!==notes.length
    ||!equivalentJson(plan.left_hand,settings.left_hand)||!equivalentJson(plan.right_hand,settings.right_hand)||!equivalentJson(plan.requested_locks,settings.locks)
    ||plan.beam_width!==64||plan.max_expansions!==2000000||!integer(plan.explored_choices,0,plan.max_expansions)||typeof plan.beam_pruned!=='boolean'
    ||!Array.isArray(plan.targets)||!Array.isArray(plan.assignments)||!Array.isArray(plan.diagnostics)||!Array.isArray(plan.issues)
    ||plan.diagnostics.some(item=>typeof item?.message!=='string'))fail();
  if(plan.status==='ready'){
    if(!plan.complete||!notes.length||plan.assignments.length!==plan.targets.length||!integer(plan.objective_cost,0,Number.MAX_SAFE_INTEGER))fail();
  }else if(plan.status==='no_targets'){
    if(!plan.complete||notes.length||plan.assignments.length||plan.objective_cost!==0)fail();
  }else if(plan.complete||plan.assignments.length||plan.objective_cost!==null)fail();
  // A size guard may stop before grouping; it is never reported as an empty successful phrase.
  if(plan.physical_target_count===null){
    if(plan.status!=='unavailable'||plan.targets.length||plan.assignments.length||!plan.diagnostics.length)fail();
    return plan;
  }
  if(!integer(plan.physical_target_count,0,notes.length)||plan.physical_target_count!==plan.targets.length)fail();
  const visited=new Set(),targets=new Map(),attacks=new Set();
  for(const target of plan.targets){
    if(!target||typeof target.target_id!=='string'||!target.target_id||targets.has(target.target_id)
      ||!Array.isArray(target.source_occurrence_ids)||!target.source_occurrence_ids.length
      ||!integer(target.midi,0,127)||!Number.isFinite(target.start_ms)||target.start_ms<0||!Number.isFinite(target.end_ms)||target.end_ms<=target.start_ms
      ||target.onset_index!==onsets.get(target.start_ms))fail();
    if(target.target_id!==target.source_occurrence_ids[0])fail();
    const attack=JSON.stringify([target.start_ms,target.midi]);if(attacks.has(attack))fail();attacks.add(attack);
    const sources=new Set(),parts=new Set();let end=target.start_ms;
    for(const id of target.source_occurrence_ids){
      const note=byId.get(id);
      if(!note||visited.has(id)||note.midi!==target.midi||note.start_ms!==target.start_ms)fail();
      visited.add(id);parts.add(note.part_id);sourceIds(note).forEach(id=>sources.add(id));end=Math.max(end,note.start_ms+note.duration_ms);
    }
    if(target.end_ms!==end||!sameSet(target.source_note_ids,sources)||!sameSet(target.part_ids,parts))fail();
    targets.set(target.target_id,target);
  }
  if(visited.size!==notes.length)fail();
  const assigned=new Set();
  for(const choice of plan.assignments){
    const target=targets.get(choice?.target_id);
    if(!target||assigned.has(choice.target_id)||!['left','right'].includes(choice.hand)||!integer(choice.finger,1,5))fail();
    for(const key of ['target_id','source_occurrence_ids','source_note_ids','part_ids','midi','start_ms','end_ms','onset_index'])if(!equivalentJson(choice[key],target[key]))fail();
    const hand=settings[`${choice.hand}_hand`];
    if(choice.midi<range.low||choice.midi>range.high||choice.midi<hand.lowest_midi||choice.midi>hand.highest_midi)fail();
    for(const lock of settings.locks.filter(lock=>choice.source_note_ids.includes(lock.source_note_id))){
      if(lock.hand!==null&&lock.hand!==choice.hand||lock.finger!==null&&lock.finger!==choice.finger)fail();
    }
    assigned.add(choice.target_id);
  }
  for(const issue of plan.issues){
    if(!issue||typeof issue.code!=='string'||typeof issue.message!=='string'||issue.onset_index!==null&&!integer(issue.onset_index,0,Math.max(0,onsets.size-1))
      ||!Array.isArray(issue.target_ids)||issue.target_ids.some(id=>!targets.has(id))
      ||!Array.isArray(issue.source_occurrence_ids)||issue.source_occurrence_ids.some(id=>!byId.has(id))
      ||!Array.isArray(issue.source_note_ids)||issue.source_note_ids.some(id=>!notes.some(note=>sourceIds(note).includes(id))))fail();
  }
  return plan;
}

export function pianoPlanMessage(plan){
  const prefix={ready:'Recommended under a bounded model; not a universal biomechanical optimum.',no_targets:'No sounding piano targets in this selection.',infeasible_under_model:'These constraints conflict under the declared piano model.',no_plan_found:'No complete recommendation found within the bounded search; this does not prove the music impossible.',search_limit:'Planning reached its search budget; this does not prove the music impossible.',unavailable:'A complete piano recommendation is unavailable.'}[plan.status];
  return `${prefix}${plan.issues.length?` Review ${plan.issues.length} affected-source issue(s) below.`:''} Full diagnostics and model details are available below.`;
}

/** Advisory state only: it does not write scores, take evidence, playback or hardware state. */
export function setupPianoFingering({api,getContext,onChange=()=>{}}){
  let score=null,timeline=null,part=null,key='',revision=0,generation=0,controller=null,pending=null,plan=null,phase='idle',message='Prepare a piano hand/finger recommendation.',draftDirty=false;
  let settings=defaultPianoSettings(),assignments=new Map(),occurrences=new Map();
  function value(){return{phase,message,plan,settings:structuredClone(settings),draftDirty,annotationVersion:PIANO_ANNOTATION_VERSION};}
  function publish(next,text){phase=next;message=text;onChange(value());}
  function invalidate(text='Piano guidance needs a fresh Rust plan.'){
    generation++;controller?.abort();controller=null;pending=null;plan=null;assignments=new Map();occurrences=new Map();publish('idle',text);
  }
  function synchronize(){
    const context=getContext(),currentScore=context?.score??null,currentTimeline=context?.timeline??null,currentPart=context?.part_id??null;
    const changed=currentScore!==score||currentTimeline!==timeline;
    const scopeChanged=currentScore!==score||currentPart!==part;
    const cleared=scopeChanged&&settings.locks.length>0;
    if(scopeChanged){settings={...settings,locks:[]};revision++;draftDirty=false;}
    score=currentScore;timeline=currentTimeline;part=currentPart;
    const next=JSON.stringify([part,context?.profile||null,context?.score?.tempo||null,context?.revision??null,Boolean(context?.dirty),revision,draftDirty]);
    if(changed||next!==key){key=next;invalidate(cleared?'Source-note locks were cleared for the changed score or selected part. Request a fresh plan.':undefined);}
    return context;
  }
  function setSettings(next){
    const context=synchronize();validatePianoSettings(next,context);
    settings=structuredClone(next);draftDirty=false;revision++;synchronize();
  }
  function prepare({retry=false}={}){
    const context=synchronize();
    if(!context?.score||!context.timeline||context.profile?.kind!=='piano'||context.dirty||draftDirty){
      if(phase!=='inactive')publish('inactive',draftDirty?'Apply or discard edited piano hand settings before planning.':context?.dirty?'Apply edited keyboard settings before planning.':'Choose Piano and a score to prepare hand/finger guidance.');
      return Promise.resolve(null);
    }
    if(plan&&!retry)return Promise.resolve(plan);
    if(pending)return pending;
    if(phase==='error'&&!retry)return Promise.resolve(null);
    if(retry&&plan)invalidate();
    const snapshot={score:structuredClone(context.score),timeline:structuredClone(context.timeline),part_id:context.part_id,profile:structuredClone(context.profile)};
    const requested=structuredClone(settings),target=context.score,targetTimeline=context.timeline,targetKey=key,current=++generation;
    controller=new AbortController();const signal=controller.signal;
    const isCurrent=()=>{const value=getContext();return current===generation&&!signal.aborted&&!draftDirty&&value?.score===target&&value.timeline===targetTimeline&&!value.dirty&&value.part_id===snapshot.part_id&&equivalentJson(value.profile,snapshot.profile)&&equivalentJson(value.score,snapshot.score)&&equivalentJson(value.timeline,snapshot.timeline);};
    pending=Promise.resolve().then(async()=>{
      if(!isCurrent())return null;
      try{
        const result=await api('/api/fingering/piano',{score:snapshot.score,part_id:snapshot.part_id,profile:snapshot.profile,...requested},signal);
        if(!isCurrent()||targetKey!==key)return null;
        validatePianoFingering(result,snapshot,requested);plan=result;
        assignments=new Map(plan.assignments.map(choice=>[choice.target_id,choice]));
        occurrences=new Map(plan.assignments.flatMap(choice=>choice.source_occurrence_ids.map(id=>[id,choice])));
        publish(result.status==='ready'?'ready':'unavailable',pianoPlanMessage(result));return plan;
      }catch(error){if(isCurrent())publish('error',`Piano guidance unavailable: ${error.message}`);return null;}
    }).finally(()=>{if(current===generation){pending=null;controller=null;}});
    publish('loading','Planning piano hands and fingers with Rust…');
    return pending;
  }
  return{prepare,setSettings,
    setDraftDirty(dirty=true){synchronize();if(draftDirty!==Boolean(dirty)){draftDirty=Boolean(dirty);revision++;synchronize();}},
    reset(){score=null;timeline=null;part=null;key='';settings=defaultPianoSettings();draftDirty=false;revision++;invalidate();},
    state(){synchronize();return value();},
    assignment(id){synchronize();return phase==='ready'?assignments.get(id)||occurrences.get(id)||null:null;},
  };
}
