import {equivalentJson} from './adaptation-view.js';
import {fingeringUnavailable,BASIC_KEY_FINGERING_REASON,fingeringSource,currentFingeringSource,fingeringRequest,fingeringResponse} from './fingering-source.js';

const codedError=(code,message)=>Object.assign(new Error(message),{code});
const STATUSES=new Set(['ready','no_targets','infeasible_under_model','no_plan_found','search_limit','unavailable']);
const integer=(value,low,high)=>Number.isSafeInteger(value)&&value>=low&&value<=high;
/** Source-order normalization mirrors Rust; no new occurrence IDs or targets. */
export function guitarSelectedPartIds(context){
  if(context?.selected_part_ids===undefined)return null;
  const ids=context.selected_part_ids,parts=context.score?.parts||[];
  if(context.part_id!=null||!Array.isArray(ids)||!ids.length||new Set(ids).size!==ids.length
    ||ids.some(id=>typeof id!=='string'||!parts.some(part=>part.id===id))){
    throw codedError('guitar_selection_invalid','Choose a nonempty set of unique existing human parts, without a legacy part selection.');
  }
  const selected=new Set(ids);return parts.filter(part=>selected.has(part.id)).map(part=>part.id);
}
export function guitarSelectionKey(context){
  // Invalid inputs still invalidate a previous route before prepare reports them.
  let ids;try{ids=guitarSelectedPartIds(context);}catch{ids={invalid:context?.selected_part_ids};}
  return JSON.stringify([context?.part_id??null,ids]);
}
export function guitarSelectedNotes(context){
  const ids=guitarSelectedPartIds(context),selected=ids&&new Set(ids);
  return (context?.timeline?.notes||[]).filter(note=>selected?selected.has(note.part_id):context.part_id===null||note.part_id===context.part_id);
}
const selectedNotes=guitarSelectedNotes;
const normalizeLocks=locks=>locks.map(lock=>({source_note_id:lock.source_note_id,string:lock.string??null,fret:lock.fret??null,finger:lock.finger??null}));

const validBeat=beat=>beat&&integer(beat.numerator,0,1000000000)&&integer(beat.denominator,1,1000000);
export function validateGuitarPlanningScope(scope){
  if(!scope||scope.version!==1||!validBeat(scope.from)||!validBeat(scope.to)
    ||BigInt(scope.to.numerator)*BigInt(scope.from.denominator)<=BigInt(scope.from.numerator)*BigInt(scope.to.denominator)){
    const error=Error('Choose nonnegative exact quarter-note beats A and B, with B later than A.');error.code='guitar_phrase_invalid';throw error;
  }
  return {version:1,from:{...scope.from},to:{...scope.to}};
}
/** Inventory ownership is Rust-produced; JS never derives range membership from ms. */
function scopeNotes(inventory,context,scope,fail){
  const all=selectedNotes(context),byId=new Map(all.map(note=>[note.id,note]));
  if(!inventory||!equivalentJson(inventory.requested,scope)||inventory.full_occurrence_count!==all.length
    ||!integer(inventory.selected_occurrence_count,0,all.length)
    ||!Array.isArray(inventory.included_occurrence_ids)||!Array.isArray(inventory.entry_hold_occurrence_ids)
    ||inventory.included_occurrence_ids.length!==inventory.selected_occurrence_count
    ||new Set(inventory.included_occurrence_ids).size!==inventory.included_occurrence_ids.length
    ||new Set(inventory.entry_hold_occurrence_ids).size!==inventory.entry_hold_occurrence_ids.length
    ||inventory.included_occurrence_ids.some(id=>typeof id!=='string'||!byId.has(id))
    ||inventory.entry_hold_occurrence_ids.some(id=>!inventory.included_occurrence_ids.includes(id))
    ||!Number.isFinite(inventory.start_ms)||!Number.isFinite(inventory.end_ms)||inventory.start_ms<0||inventory.end_ms<=inventory.start_ms
    ||byId.size!==all.length)fail();
  return inventory.included_occurrence_ids.map(id=>byId.get(id));
}
export function validateGuitarScopeInventory(plan,context,scope,max_fret_span){
  const fail=()=>{throw codedError('guitar_response_invalid','The Rust guitar phrase inventory does not match this request.');};
  validateGuitarPlanningScope(scope);
  scopeNotes(plan?.planning_scope,context,scope,fail);
  if(plan.purpose!=='scope_inventory'||plan.status!=='unavailable'||plan.complete!==false||plan.assignments?.length!==0||plan.objective_cost!==null)fail();
  // Reuse the response envelope/identity checks, allowing only this preflight purpose.
  validateGuitarFingering(plan,context,{max_fret_span,locks:[],planning_scope:scope,scope_inventory:plan.planning_scope,inventory_only:true});
  return plan.planning_scope;
}

/** Validate complete identity/range/lock correspondence; never solve fingering in JS. */
export function validateGuitarFingering(plan,context,settings){
  const fail=()=>{throw codedError('guitar_response_invalid','The guitar recommendation does not match this complete score, selected human parts, instrument or locks. Request a fresh Rust plan; the original score is unchanged.');};
  const profile=context.profile;
  let selection;try{selection=guitarSelectedPartIds(context);}catch{fail();}
  if(!context.score||!Array.isArray(context.timeline?.notes)||profile?.kind!=='guitar'||!Array.isArray(profile.tuning))fail();
  const notes=settings.planning_scope?scopeNotes(plan?.planning_scope,context,settings.planning_scope,fail):selectedNotes(context),byId=new Map(notes.map(note=>[note.id,note]));
  if(settings.planning_scope){
    if(!settings.scope_inventory||!equivalentJson(plan.planning_scope,settings.scope_inventory)
      ||plan.purpose!==(settings.inventory_only?'scope_inventory':'phrase_plan'))fail();
  }else if(plan?.planning_scope!=null||plan?.purpose!=null)fail();
  if(byId.size!==notes.length)fail();
  const onsetCounts=new Map();for(const note of notes)onsetCounts.set(note.start_ms,(onsetCounts.get(note.start_ms)||0)+1);
  const onsetIndices=new Map([...onsetCounts.keys()].sort((a,b)=>a-b).map((at,index)=>[at,index]));
  if(!plan||plan.version!==1||plan.algorithm!=='deterministic_guitar_beam_v1'||!STATUSES.has(plan.status)
    ||plan.score_id!==context.score.id||plan.part_id!==(selection===null?context.part_id:null)||!equivalentJson(plan.profile,profile)
    ||(selection===null?plan.selected_part_ids!==undefined:!equivalentJson(plan.selected_part_ids,selection))
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
  let score=null,timeline=null,cleanSong=null,key='',revision=0,generation=0,controller=null,pending=null,plan=null,assignments=new Map(),phase='idle',message='Select a guitar score to prepare a recommended phrase.';
  let messageCode='guitar_initial',errorDetails=null;
  let settings={max_fret_span:3,locks:[]},planningScope=null,scopeDraft=false,scopeInventory=null;
  function publish(next,text,code='guitar_'+next,details=null){phase=next;message=text;messageCode=code;errorDetails=details;onChange({phase,message,messageCode,errorDetails,plan,settings:structuredClone(settings),planningScope:structuredClone(planningScope),scopeDraft,scopeInventory:structuredClone(scopeInventory)});}
  function invalidate(){generation++;controller?.abort();controller=null;pending=null;plan=null;scopeInventory=null;assignments=new Map();publish('idle','Guitar recommendation needs a fresh Rust plan.','guitar_fresh');}
  function synchronize(){
    const context=getContext();
    const currentScore=context?.score??null,currentTimeline=context?.timeline??null,currentSong=context?.cleanSong??null;
    const changed=currentScore!==score||currentTimeline!==timeline||currentSong!==cleanSong;
    if(currentScore!==score||currentSong!==cleanSong){score=currentScore;settings={max_fret_span:3,locks:[]};planningScope=null;scopeDraft=false;revision++;}
    timeline=currentTimeline;cleanSong=currentSong;
    const next=JSON.stringify([guitarSelectionKey(context),context?.profile||null,Boolean(context?.dirty),revision,currentSong?.runtime?.choice??null]);
    if(changed||next!==key){key=next;invalidate();}
    return context;
  }
  function setSettings(next){
    if(!next||!integer(next.max_fret_span,0,12)||!Array.isArray(next.locks)||next.locks.length>1000)throw codedError('guitar_settings_invalid','Choose a fret span from 0–12 and at most 1,000 source-note locks.');
    const ids=new Set();
    for(const lock of next.locks){
      if(!lock||typeof lock.source_note_id!=='string'||!lock.source_note_id||ids.has(lock.source_note_id)
        ||['string','fret','finger'].every(field=>lock[field]===null||lock[field]===undefined)
        ||lock.string!==null&&lock.string!==undefined&&!integer(lock.string,1,12)
        ||lock.fret!==null&&lock.fret!==undefined&&!integer(lock.fret,0,36)
        ||lock.finger!==null&&lock.finger!==undefined&&!integer(lock.finger,0,4))throw codedError('guitar_lock_invalid','Each lock needs a unique source note and valid string/fret/finger constraints.');
      ids.add(lock.source_note_id);
    }
    const context=synchronize(),sources=new Set((context?.timeline?.notes||[]).flatMap(note=>note.source_note_ids||[]));
    if(next.locks.some(lock=>!sources.has(lock.source_note_id)))throw codedError('guitar_lock_source','Locks must name sounding source notes in this current score.');
    settings={max_fret_span:next.max_fret_span,locks:normalizeLocks(next.locks)};revision++;synchronize();
  }
  function prepare({retry=false}={}){
    const context=synchronize();
    if(fingeringUnavailable(context)){if(phase!=='unavailable')publish('unavailable',BASIC_KEY_FINGERING_REASON,'guitar_basic_keys');return Promise.resolve(null);}
    if(!context?.score||!context.timeline||context.profile?.kind!=='guitar'||context.dirty){
      if(phase!=='inactive')publish('inactive',context?.dirty?'Apply edited instrument settings before planning.':'Choose Guitar to prepare a recommended phrase.',context?.dirty?'guitar_dirty':'guitar_inactive');
      return Promise.resolve(null);
    }
    if(scopeDraft){if(phase!=='draft')publish('draft','Apply or revert the guitar phrase draft before planning.');return Promise.resolve(null);}
    if(plan)return Promise.resolve(plan);
    if(pending)return pending;
    if(phase==='error'&&!retry)return Promise.resolve(null);
    let source,selection;try{selection=guitarSelectedPartIds(context);source=fingeringSource(context);}catch(error){publish('error',`Guitar guidance unavailable: ${error.message}`,'guitar_error',{code:error.code,message:error.message});return Promise.resolve(null);}
    const snapshot={score:structuredClone(context.score),timeline:structuredClone(context.timeline),part_id:selection===null?context.part_id:null,...(selection===null?{}:{selected_part_ids:selection}),profile:structuredClone(context.profile)};
    const targetScope=structuredClone(planningScope);
    const sources=new Set(selectedNotes(context).flatMap(note=>note.source_note_ids));
    const selectionSettings=selection===null?{}:{selected_part_ids:selection};
    const requested={...selectionSettings,max_fret_span:settings.max_fret_span,locks:settings.locks.filter(lock=>sources.has(lock.source_note_id))};
    const target=context.score,targetTimeline=context.timeline,targetSong=context.cleanSong??null,targetKey=key,current=++generation;
    controller=new AbortController();const signal=controller.signal;
    const currentContext=()=>{const value=getContext();return current===generation&&!signal.aborted&&value?.score===target&&value.timeline===targetTimeline&&!value.dirty&&guitarSelectionKey(value)===guitarSelectionKey(snapshot)&&currentFingeringSource(value,targetSong,source)&&equivalentJson(value.profile,snapshot.profile)&&equivalentJson(value.score,snapshot.score)&&equivalentJson(value.timeline,snapshot.timeline);};
    // Assign the pending promise before notifications or API calls can reenter.
    pending=Promise.resolve().then(async()=>{
      try{
        if(!currentContext()||targetKey!==key)return null;
        if(targetScope){
          const request=fingeringRequest('guitar',snapshot,{...selectionSettings,max_fret_span:requested.max_fret_span,locks:[],planning_scope:targetScope,inventory_only:true},source),response=await api(request.path,request.body,signal);
          if(!currentContext()||targetKey!==key)return null;
          const inventory=fingeringResponse(response,source);
          scopeInventory=validateGuitarScopeInventory(inventory,snapshot,targetScope,requested.max_fret_span);
          const included=new Set(scopeInventory.included_occurrence_ids);
          const scopedSources=new Set(snapshot.timeline.notes.filter(note=>included.has(note.id)).flatMap(note=>note.source_note_ids));
          requested.locks=requested.locks.filter(lock=>scopedSources.has(lock.source_note_id));
          requested.planning_scope=targetScope;
        }
        const request=fingeringRequest('guitar',snapshot,requested,source),response=await api(request.path,request.body,signal);
        if(!currentContext()||targetKey!==key)return null;
        const result=fingeringResponse(response,source);
        validateGuitarFingering(result,snapshot,{...requested,...(targetScope?{scope_inventory:scopeInventory}:{})});plan=result;assignments=new Map(plan.assignments.map(choice=>[choice.occurrence_id,choice]));
        publish(result.status==='ready'?'ready':'unavailable',result.status==='ready'?'One recommended whole-phrase path under the declared model. Pitch-only MIDI does not verify fingers.':result.diagnostics.map(item=>item.message).join(' '));
        return plan;
      }catch(error){if(currentContext())publish('error',`Guitar guidance unavailable: ${error.message}`,'guitar_error',{code:error.code||'guitar_request_failed',message:error.message});return null;}
    }).finally(()=>{if(current===generation){pending=null;controller=null;}});
    publish('loading','Planning a complete guitar phrase with Rust…');
    return pending;
  }
  return{prepare,setSettings,
    editPlanningScope(){synchronize();if(!scopeDraft){scopeDraft=true;revision++;synchronize();}publish('draft','Apply or revert the guitar phrase draft before planning.');},
    setPlanningScope(scope){synchronize();const next=scope===null?null:validateGuitarPlanningScope(scope);planningScope=next;scopeDraft=false;revision++;synchronize();},
    revertPlanningScopeDraft(){synchronize();scopeDraft=false;revision++;synchronize();},
    reset(){score=null;timeline=null;cleanSong=null;key='';settings={max_fret_span:3,locks:[]};planningScope=null;scopeDraft=false;revision++;invalidate();},
    state(){synchronize();return{phase,message,messageCode,errorDetails,plan,settings:structuredClone(settings),planningScope:structuredClone(planningScope),scopeDraft,scopeInventory:structuredClone(scopeInventory)};},
    phase(){synchronize();return phase;},
    assignment(id){synchronize();return phase==='ready'?assignments.get(id)||null:null;},
  };
}
