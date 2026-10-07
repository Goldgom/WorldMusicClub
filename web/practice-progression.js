import {assertPitchModContext} from './pitch-mod-context.js';
import {createPracticeAssistanceController,PracticeAssistanceStore,assistanceRequest,validateAssistanceRecipe,assistancePreferenceKey} from './practice-assistance.js';
import {admitPracticeAssistance,assertPracticeAssistanceCurrent,assistanceEqual,normalizeAssistanceSelection,defaultAssistanceSettings} from './practice-assistance-receipt.js';
import {PROGRESSION_LAYERS,validateProgressionPlan,admitPracticeProgression,assertPracticeProgressionCurrent,exactFields} from './practice-progression-receipt.js';

export const PROGRESSION_STORAGE_PREFIX='worldmusichub.practice-progression.v1.';
const FORMAT='wmc-practice-progression-preference',copy=value=>structuredClone(value);
const fail=(code,message)=>{throw Object.assign(new Error(message),{code});};
const identity=assistancePreferenceKey;
function legacyPreferencePlan(plan){return Object.fromEntries(['mode','selection','settings','planner_revision','revision','selection_digest','receipt'].map(key=>[key,copy(plan[key])]));}
function legacyRecipe(context,plan){return {format:'wmc-practice-assistance-recipe',version:1,preference_key:identity(context),source:copy(context.source),selection:copy(plan.selection),mode:plan.mode,settings:copy(plan.settings),planner_revision:plan.planner_revision,revision:plan.revision,expected_selection_digest:plan.selection_digest};}
export function validateProgressionPreference(value,context){
  if(!exactFields(value,['format','version','preference_key','source','mode','plan'])||value.format!==FORMAT||value.version!==1||value.preference_key!==identity(context)||!assistanceEqual(value.source,context.source)||!['progression','original','automatic','off'].includes(value.mode))fail('progression_preference_invalid','Saved progression cannot be read safely. It has been preserved unchanged.');
  if(value.mode==='off'){if(value.plan!==null)fail('progression_preference_invalid','The Off marker cannot declare note ownership.');}
  else if(value.mode==='progression')validateProgressionPlan(value.plan);
  else{if(!exactFields(value.plan,['mode','selection','settings','planner_revision','revision','selection_digest','receipt']))fail('progression_preference_invalid','Saved Original or Automatic must contain a compact checked recipe.');validateAssistanceRecipe(legacyRecipe(context,value.plan),context);if(value.plan.mode!==(value.mode==='off'?'original':value.mode))fail('progression_preference_invalid','The saved exit does not match its checked assignment.');}
  return value;
}
/** One record write precedes the session commit; no tab-only save fallback.
 * The expected-byte check is optimistic: localStorage getItem/setItem does not
 * provide a cross-window compare-and-swap or transaction. */
export class PracticeProgressionStore {
  constructor({storage}={}){this.storage=storage;this.known=new Set();}
  target(){return this.storage===undefined?globalThis.localStorage:this.storage;}
  key(context){return PROGRESSION_STORAGE_PREFIX+encodeURIComponent(identity(context));}
  read(context){
    let raw=null;
    try{const storage=this.target();if(typeof storage?.getItem!=='function')throw Error('Storage is unavailable');raw=storage.getItem(this.key(context));if(raw===null)return{status:this.known.has(this.key(context))?'unavailable':'default',recipe:null,raw};this.known.add(this.key(context));if(typeof raw!=='string'||raw.length>128*1024)throw Error('Saved progression exceeds the preference budget');return{status:'saved',recipe:copy(validateProgressionPreference(JSON.parse(raw),context)),raw};}
    catch(error){return{status:raw===null?'unavailable':'invalid',recipe:null,raw,error};}
  }
  save(context,recipe,{expectedRaw,replaceInvalid=false}={}){
    validateProgressionPreference(recipe,context);const current=this.read(context);
    if(current.status==='unavailable')fail('progression_storage_unavailable','The saved progression cannot be read. The current assignment is unchanged.');
    if(current.status==='invalid'&&!replaceInvalid)fail('progression_replace_required','Confirm replacing the incompatible progression preference.');
    if(current.raw!==expectedRaw)fail('progression_preference_changed','Saved progression changed in another window. Reopen Mod before applying.');
    const raw=JSON.stringify(recipe);if(raw.length>128*1024)fail('progression_preference_invalid','This preference exceeds the storage budget.');
    try{this.target().setItem(this.key(context),raw);}catch{fail('progression_save_failed','The progression could not be saved. The current assignment and takes are unchanged.');}
    this.known.add(this.key(context));return{status:'saved',recipe:copy(recipe),raw};
  }
}
const snapshot=context=>{if(!context)return null;if(context.pitchMod)assertPitchModContext(context.pitchMod,context.source,context);return{...context,source:copy(context.source),selection:normalizeAssistanceSelection(context.selection),receipt:copy(context.receipt),admissionKey:context.admissionKey??null};};
const same=(a,b)=>a===null&&b===null||Boolean(a&&b&&assistanceEqual(a.source,b.source)&&assistanceEqual(a.selection,b.selection)&&a.sourceToken===b.sourceToken&&a.runtimeToken===b.runtimeToken&&a.score===b.score&&a.preferenceKey===b.preferenceKey&&a.pitchMod===b.pitchMod&&a.admissionKey===b.admissionKey&&assistanceEqual(a.receipt,b.receipt));
/** The v1 controller remains authoritative until an explicit progression choice.
 * A v2 preference subsequently owns a validated stage or an explicit exit; v1
 * saved bytes are never migrated, rewritten or resurrected behind that choice. */
export function createProgressiveAssistanceController({api,getContext,onChange=()=>{},store=new PracticeAssistanceStore(),progressionStore=new PracticeProgressionStore(),...legacyOptions}={}){
  const legacy=createPracticeAssistanceController({api,getContext,onChange,...legacyOptions,store});
  let captured=null,owned=false,active=null,progression=null,draft=null,prepared=null,preparedProgression=null,phase='idle',error=null,persistence={status:'default',recipe:null,raw:null},epoch=0,pending=null,abort=null,baseline=undefined;
  function invalidate(){epoch++;abort?.abort();abort=null;pending=null;prepared=null;preparedProgression=null;}
  function notify(){onChange(value());}
  function synchronize(){
    let next;try{next=snapshot(getContext());}catch(failure){invalidate();captured=null;owned=true;active=progression=draft=null;phase='blocked';error=failure;return null;}
    if(!same(next,captured)){invalidate();captured=next;owned=false;active=progression=draft=null;phase='idle';error=null;baseline=undefined;persistence={status:'default',recipe:null,raw:null};legacy.reset();}
    return captured;
  }
  function value(){if(!owned)return {...legacy.state(),supportsProgression:true,progression:null,preparedProgression:null};return{phase,error,active,draft:draft?copy(draft):null,prepared,progression,preparedProgression,persistence:{...persistence,recipe:persistence.status==='off'?null:persistence.recipe},supportsProgression:true,blocked:['blocked','error'].includes(phase)&&!active,requiresReset:Boolean(draft),replaceInvalidRequired:persistence.status==='invalid'};}
  function takeOwnership(){
    if(owned)return;const old=legacy.state();active=legacy.current();persistence=progressionStore.read(captured);baseline=persistence.status==='default'?old.persistence.raw:undefined;draft=old.draft?copy(old.draft):{mode:'original',settings:null,selection:copy(captured.selection)};owned=true;phase='editing';error=null;
  }
  async function request(context,recipe,current,{saved=false}={}){
    if(current!==epoch||!abort)return null;
    const signal=abort.signal,selection=normalizeAssistanceSelection(recipe.selection||recipe.plan?.selection||context.selection);let path,body,binding,result;
    if(recipe.mode==='progression'){
      const proof=saved?recipe.plan:recipe.expectedPlan;
      binding={...context,selection,layer:recipe.layer||proof.layer,...(proof?{plan:proof}:{})};
      path=`${context.source?'/api/library/progression':'/api/practice-progression'}/${proof?'validate':'generate'}`;
      body={...(context.source?{source:copy(context.source)}:{score:context.score}),...(proof?{plan:copy(proof)}:{selection,layer:binding.layer}),...(context.pitchMod?{pitch_mod:copy(context.pitchMod.configuration)}:{})};
    }else{
      const plan=recipe.plan,mode=recipe.mode;
      const legacyDraft={mode,selection,settings:mode==='automatic'?recipe.settings||plan?.settings||defaultAssistanceSettings():null,...(saved&&plan?{expected_selection_digest:plan.selection_digest}:{})};
      ({path,body,binding}=assistanceRequest(context,legacyDraft));if(saved&&plan)binding.receipt=plan.receipt;
    }
    const response=await api(path,body,signal);
    if(current!==epoch||signal.aborted||!same(context,snapshot(getContext())))return null;
    if(recipe.mode==='progression'){const wrapper=admitPracticeProgression(response,binding);result={assistance:wrapper.assistance,progression:wrapper};}
    else result={assistance:admitPracticeAssistance(response,binding),progression:null};
    return result;
  }
  function restore(){
    const context=synchronize();if(!context)return Promise.resolve(null);if(pending)return pending;
    if(owned&&phase!=='idle')return Promise.resolve(active);
    persistence=progressionStore.read(context);
    if(persistence.status==='default'||persistence.status==='unavailable'&&!progressionStore.known.has(progressionStore.key(context)))return legacy.restore();
    owned=true;
    if(['invalid','unavailable'].includes(persistence.status)){phase='blocked';error=persistence.error||new Error('The saved progression is unavailable.');notify();return Promise.resolve(null);}
    const recipe=persistence.recipe;
    if(recipe.mode==='off'){phase='off';persistence={...persistence,status:'off'};notify();return Promise.resolve(null);}
    if(!assistanceEqual(normalizeAssistanceSelection(recipe.plan.selection),context.selection)){phase='blocked';error=new Error('Saved progression uses another part or profile selection. Check an explicit replacement in Mod.');notify();return Promise.resolve(null);}
    const current=++epoch;abort=new AbortController();phase='loading';
    pending=Promise.resolve().then(()=>request(context,recipe,current,{saved:true})).then(result=>{if(current!==epoch||!result)return null;active=recipe.mode==='off'?null:result.assistance;progression=result.progression;phase=recipe.mode==='off'?'off':'ready';if(phase==='off')persistence={...persistence,status:'off'};notify();return active;}).catch(failure=>{if(current===epoch){phase='blocked';error=failure;notify();}return null;}).finally(()=>{if(current===epoch){pending=null;abort=null;}});notify();return pending;
  }
  function beginDraft(){
    const context=synchronize();if(!context)return null;
    const stored=progressionStore.read(context);if(!owned&&(stored.status==='default'||stored.status==='unavailable'&&!progressionStore.known.has(progressionStore.key(context))))return legacy.beginDraft();
    if(!owned){legacy.beginDraft();takeOwnership();}
    invalidate();persistence=stored.recipe?.mode==='off'?{...stored,status:'off'}:stored;const recipe=stored.recipe;
    const mode=progression?'progression':active?.plan.mode||recipe?.mode||'original';
    draft={mode:mode==='off'?'original':mode,selection:copy(context.selection),settings:active?.plan.settings||recipe?.plan?.settings||null,layer:progression?.plan.layer||recipe?.plan?.layer||'single',...(recipe?.mode==='progression'&&!active&&assistanceEqual(normalizeAssistanceSelection(recipe.plan.selection),context.selection)?{expectedPlan:copy(recipe.plan)}:{})};phase='editing';error=null;notify();return value();
  }
  function setDraft(patch){
    const context=synchronize();if(!context)fail('progression_no_draft','Open Mod before editing.');
    if(!owned&&patch.mode!=='progression')return legacy.setDraft(patch);
    takeOwnership();if(!draft)fail('progression_no_draft','Open Mod before editing.');
    const next={...draft,...copy(patch)};next.selection=normalizeAssistanceSelection(next.selection);next.layer=next.layer||'single';
    if(!['progression','original','automatic'].includes(next.mode)||!PROGRESSION_LAYERS.includes(next.layer))fail('progression_layer_invalid','Choose a supported assistance stage.');
    if(next.mode==='automatic')next.settings=next.settings||defaultAssistanceSettings();else next.settings=null;
    if(assistanceEqual(next,draft))return value();delete next.expectedPlan;invalidate();draft=next;phase='editing';error=null;notify();return value();
  }
  function prepareDraft(){
    const context=synchronize();if(!owned)return legacy.prepareDraft();
    if(!context||!draft)return Promise.reject(new Error('This progression draft is no longer current.'));
    if(pending)return pending;if(prepared)return Promise.resolve(prepared);
    const recipe=copy(draft),current=++epoch;abort=new AbortController();phase='preparing';error=null;
    pending=Promise.resolve().then(()=>request(context,recipe,current)).then(result=>{if(current!==epoch||!result)return null;prepared=result.assistance;preparedProgression=result.progression;phase='prepared';notify();return prepared;}).catch(failure=>{if(current===epoch){phase='error';error=failure;notify();}throw failure;}).finally(()=>{if(current===epoch){pending=null;abort=null;}});notify();return pending;
  }
  function cancelDraft(){synchronize();if(!owned)return legacy.cancelDraft();invalidate();draft=null;if(persistence.status==='default'||persistence.status==='unavailable'&&captured&&!progressionStore.known.has(progressionStore.key(captured))){owned=false;active=progression=null;baseline=undefined;return legacy.cancelDraft();}phase=active?'ready':persistence.recipe&&persistence.recipe.mode!=='off'||['invalid','unavailable'].includes(persistence.status)?'blocked':persistence.recipe?.mode==='off'?'off':'default';error=null;notify();}
  function commitDraft({resetConfirmed=false,isCurrent=()=>true,replaceInvalid=false,off=false}={}){
    const context=synchronize();if(!owned)return legacy[off?'disableDraft':'commitDraft']({resetConfirmed,isCurrent,replaceInvalid});
    if(!context||!draft||!off&&!prepared||!isCurrent())fail('progression_stale_draft','Check this progression draft again before applying.');
    if(!resetConfirmed)fail('progression_reset_required','Confirm that changing assistance restarts the take.');
    const mode=off?'off':draft.mode;
    if(!off){const binding={...context,selection:draft.selection,mode:prepared.plan.mode,settings:prepared.plan.settings,revision:1};assertPracticeAssistanceCurrent(prepared,binding);if(mode==='progression')assertPracticeProgressionCurrent(preparedProgression,{...binding,layer:draft.layer});}
    if(baseline!==undefined&&store.read(context).raw!==baseline)fail('progression_preference_changed','The previous saved assignment changed. Reopen Mod before applying.');
    const recipe={format:FORMAT,version:1,preference_key:identity(context),source:copy(context.source),mode,plan:off?null:mode==='progression'?copy(preparedProgression.plan):legacyPreferencePlan(prepared.plan)};
    const saved=progressionStore.save(context,recipe,{expectedRaw:persistence.raw,replaceInvalid});
    // Nothing fallible follows the single preference write.
    captured={...captured,selection:copy(draft.selection)};active=off?null:prepared;progression=off?null:preparedProgression;persistence=off?{...saved,status:'off'}:saved;baseline=undefined;invalidate();draft=null;phase=off?'off':'ready';error=null;return active;
  }
  return{restore,beginDraft,setDraft,prepareDraft,cancelDraft,commitDraft,disableDraft:options=>commitDraft({...options,off:true}),
    state(){synchronize();return value();},
    current(){const context=synchronize();if(!owned)return legacy.current();if(!active||!context)return null;const binding={...context,selection:context.selection,mode:active.plan.mode,settings:active.plan.settings,revision:1};if(progression)assertPracticeProgressionCurrent(progression,{...binding,layer:progression.plan.layer});return assertPracticeAssistanceCurrent(active,binding);},
    reset(){invalidate();captured=null;owned=false;active=progression=draft=null;phase='idle';error=null;baseline=undefined;legacy.reset();},
  };
}
