import {equivalentJson} from './adaptation-view.js';

const STATUSES=new Set(['ready','no_targets','infeasible_under_model','no_plan_found','search_limit','unavailable']);
const integer=(value,low,high)=>Number.isSafeInteger(value)&&value>=low&&value<=high;
const selectedNotes=context=>context.timeline.notes.filter(note=>context.part_id===null||note.part_id===context.part_id);
const normalizeLocks=locks=>locks.map(lock=>({source_note_id:lock.source_note_id,string:lock.string??null,fret:lock.fret??null,finger:lock.finger??null}));

/** Validate complete identity/range/lock correspondence; never solve fingering in JS. */
export function validateGuitarFingering(plan,context,settings){
  const fail=()=>{throw Error('The guitar recommendation does not match this complete score, selected part, instrument or locks. Request a fresh Rust plan; the original score is unchanged.');};
  const profile=context.profile;
  if(!context.score||!Array.isArray(context.timeline?.notes)||profile?.kind!=='guitar'||!Array.isArray(profile.tuning))fail();
  const notes=selectedNotes(context),byId=new Map(notes.map(note=>[note.id,note]));
  if(byId.size!==notes.length)fail();
  const onsetCounts=new Map();for(const note of notes)onsetCounts.set(note.start_ms,(onsetCounts.get(note.start_ms)||0)+1);
  const onsetIndices=new Map([...onsetCounts.keys()].sort((a,b)=>a-b).map((at,index)=>[at,index]));
  if(!plan||plan.version!==1||plan.algorithm!=='deterministic_guitar_beam_v1'||!STATUSES.has(plan.status)
    ||plan.score_id!==context.score.id||plan.part_id!==context.part_id||!equivalentJson(plan.profile,profile)
    ||plan.changed_source_notes!==false||typeof plan.complete!=='boolean'||plan.source_occurrence_count!==notes.length
    ||plan.max_fret_span!==settings.max_fret_span||!equivalentJson(plan.requested_locks,normalizeLocks(settings.locks))
    ||plan.beam_width!==64||!integer(plan.explored_choices,0,2000000)||typeof plan.beam_pruned!=='boolean'
    ||!Array.isArray(plan.assignments)||!Array.isArray(plan.diagnostics))fail();
  if(plan.diagnostics.some(item=>!item||typeof item.code!=='string'||typeof item.message!=='string'||typeof item.severity!=='string'||item.note_id!==null&&typeof item.note_id!=='string'))fail();
  if(plan.status==='ready'){
    if(!plan.complete||!notes.length||plan.assignments.length!==notes.length||!integer(plan.objective_cost,0,Number.MAX_SAFE_INTEGER))fail();
  }else if(plan.status==='no_targets'){
    if(!plan.complete||notes.length||plan.assignments.length||plan.objective_cost!==0)fail();
  }else if(plan.complete||plan.assignments.length||plan.objective_cost!==null)fail();
  const seen=new Set();
  for(const choice of plan.assignments){
    const note=byId.get(choice.occurrence_id);
    if(!note||seen.has(choice.occurrence_id)||choice.part_id!==note.part_id||choice.midi!==note.midi
      ||choice.start_ms!==note.start_ms||choice.end_ms!==note.start_ms+note.duration_ms
      ||!equivalentJson(choice.source_note_ids,note.source_note_ids)
      ||!integer(choice.string,1,profile.tuning.length)||!integer(choice.fret,0,profile.frets-profile.capo)
      ||!integer(choice.finger,0,4)||(choice.finger===0)!==(choice.fret===0)
      ||profile.tuning[choice.string-1]+profile.capo+choice.fret!==note.midi
      ||!integer(choice.onset_index,0,notes.length-1)
      ||choice.onset_index!==onsetIndices.get(note.start_ms)
      ||!['downstroke_suggestion','upstroke_suggestion','simultaneous_pluck_review'].includes(choice.picking_hint))fail();
    if(choice.picking_hint!==(onsetCounts.get(note.start_ms)>1?'simultaneous_pluck_review':choice.onset_index%2?'upstroke_suggestion':'downstroke_suggestion'))fail();
    for(const lock of settings.locks.filter(lock=>choice.source_note_ids.includes(lock.source_note_id))){
      for(const key of ['string','fret','finger'])if(lock[key]!==null&&lock[key]!==undefined&&lock[key]!==choice[key])fail();
    }
    seen.add(choice.occurrence_id);
  }
  return plan;
}

/** Score/profile-scoped advisory cache. No playback, input or score mutation hooks. */
export function setupGuitarFingering({api,getContext,onChange=()=>{}}){
  let score=null,timeline=null,key='',revision=0,generation=0,controller=null,pending=null,plan=null,assignments=new Map(),phase='idle',message='Select a guitar score to prepare a recommended phrase.';
  let settings={max_fret_span:3,locks:[]};
  function publish(next,text){phase=next;message=text;onChange({phase,message,plan,settings:structuredClone(settings)});}
  function invalidate(){generation++;controller?.abort();controller=null;pending=null;plan=null;assignments=new Map();publish('idle','Guitar recommendation needs a fresh Rust plan.');}
  function synchronize(){
    const context=getContext();
    const currentScore=context?.score??null,currentTimeline=context?.timeline??null;
    const changed=currentScore!==score||currentTimeline!==timeline;
    if(currentScore!==score){score=currentScore;settings={max_fret_span:3,locks:[]};revision++;}
    timeline=currentTimeline;
    const next=JSON.stringify([context?.part_id??null,context?.profile||null,Boolean(context?.dirty),revision]);
    if(changed||next!==key){key=next;invalidate();}
    return context;
  }
  function setSettings(next){
    if(!next||!integer(next.max_fret_span,0,12)||!Array.isArray(next.locks)||next.locks.length>1000)throw Error('Choose a fret span from 0–12 and at most 1,000 source-note locks.');
    const ids=new Set();
    for(const lock of next.locks){
      if(!lock||typeof lock.source_note_id!=='string'||!lock.source_note_id||ids.has(lock.source_note_id)
        ||['string','fret','finger'].every(field=>lock[field]===null||lock[field]===undefined)
        ||lock.string!==null&&lock.string!==undefined&&!integer(lock.string,1,12)
        ||lock.fret!==null&&lock.fret!==undefined&&!integer(lock.fret,0,36)
        ||lock.finger!==null&&lock.finger!==undefined&&!integer(lock.finger,0,4))throw Error('Each lock needs a unique source note and valid string/fret/finger constraints.');
      ids.add(lock.source_note_id);
    }
    const context=synchronize(),sources=new Set((context?.timeline?.notes||[]).flatMap(note=>note.source_note_ids||[]));
    if(next.locks.some(lock=>!sources.has(lock.source_note_id)))throw Error('Locks must name sounding source notes in this current score.');
    settings={max_fret_span:next.max_fret_span,locks:normalizeLocks(next.locks)};revision++;synchronize();
  }
  function prepare({retry=false}={}){
    const context=synchronize();
    if(!context?.score||!context.timeline||context.profile?.kind!=='guitar'||context.dirty){
      if(phase!=='inactive')publish('inactive',context?.dirty?'Apply edited instrument settings before planning.':'Choose Guitar to prepare a recommended phrase.');
      return Promise.resolve(null);
    }
    if(plan)return Promise.resolve(plan);
    if(pending)return pending;
    if(phase==='error'&&!retry)return Promise.resolve(null);
    const snapshot={score:structuredClone(context.score),timeline:structuredClone(context.timeline),part_id:context.part_id,profile:structuredClone(context.profile)};
    const sources=new Set(selectedNotes(context).flatMap(note=>note.source_note_ids));
    const requested={max_fret_span:settings.max_fret_span,locks:settings.locks.filter(lock=>sources.has(lock.source_note_id))};
    const target=context.score,targetTimeline=context.timeline,targetKey=key,current=++generation;
    controller=new AbortController();const signal=controller.signal;
    const currentContext=()=>{const value=getContext();return current===generation&&!signal.aborted&&value?.score===target&&value.timeline===targetTimeline&&!value.dirty&&value.part_id===snapshot.part_id&&equivalentJson(value.profile,snapshot.profile)&&equivalentJson(value.score,snapshot.score)&&equivalentJson(value.timeline,snapshot.timeline);};
    // Assign the pending promise before notifications or API calls can reenter.
    pending=Promise.resolve().then(async()=>{
      try{
        if(!currentContext()||targetKey!==key)return null;
        const result=await api('/api/fingering/guitar',{score:snapshot.score,part_id:snapshot.part_id,profile:snapshot.profile,...requested},signal);
        if(!currentContext()||targetKey!==key)return null;
        validateGuitarFingering(result,snapshot,requested);plan=result;assignments=new Map(plan.assignments.map(choice=>[choice.occurrence_id,choice]));
        publish(result.status==='ready'?'ready':'unavailable',result.status==='ready'?'One recommended whole-phrase path under the declared model. Pitch-only MIDI does not verify fingers.':result.diagnostics.map(item=>item.message).join(' '));
        return plan;
      }catch(error){if(currentContext())publish('error',`Guitar guidance unavailable: ${error.message}`);return null;}
    }).finally(()=>{if(current===generation){pending=null;controller=null;}});
    publish('loading','Planning a complete guitar phrase with Rust…');
    return pending;
  }
  return{prepare,setSettings,
    reset(){score=null;timeline=null;key='';settings={max_fret_span:3,locks:[]};revision++;invalidate();},
    state(){synchronize();return{phase,message,plan,settings:structuredClone(settings)};},
    phase(){synchronize();return phase;},
    assignment(id){synchronize();return phase==='ready'?assignments.get(id)||null:null;},
  };
}
