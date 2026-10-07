import {ASSISTANCE_PLANNER_REVISION,assistanceEqual,admitPracticeAssistance,assertPracticeAssistanceCurrent,practiceAssistanceBinding,defaultAssistanceSettings,validateAssistanceBinding,validateAssistanceSource,validateAssistanceSelection,validateAssistanceSettings,normalizeAssistanceSelection} from './practice-assistance-receipt.js';
export {defaultAssistanceSettings,assertPracticeAssistanceCurrent,practiceAssistanceBinding};
export const ASSISTANCE_PREFERENCE_FORMAT='wmc-practice-assistance-recipe';
export const ASSISTANCE_PREFERENCE_VERSION=1;
export const ASSISTANCE_STORAGE_PREFIX='worldmusichub.practice-assistance.v1.';
const MAX_RECIPE_BYTES=64*1024;
const fail=(code,message)=>{throw Object.assign(new Error(message),{code});};
const copy=value=>structuredClone(value);
const fields=(value,names)=>value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).length===names.length&&names.every(name=>Object.hasOwn(value,name));
function preferenceKey(context){
  if(context?.source){const s=validateAssistanceSource(context.source);return JSON.stringify([s.key,s.content_sha256,s.profile,s.choice,s.runtime_policy]);}
  if(typeof context?.preferenceKey!=='string'||!context.preferenceKey||context.preferenceKey.length>2048)fail('assistance_preference_identity','Canonical preferences require a stable, source-revision-specific storage identity.');
  return context.preferenceKey;
}
export function validateAssistanceRecipe(recipe,context){
  if(!fields(recipe,['format','version','preference_key','source','selection','mode','settings','planner_revision','revision','expected_selection_digest'])||recipe.format!==ASSISTANCE_PREFERENCE_FORMAT||recipe.version!==ASSISTANCE_PREFERENCE_VERSION||recipe.planner_revision!==ASSISTANCE_PLANNER_REVISION||recipe.revision!==1||!['original','automatic'].includes(recipe.mode)||typeof recipe.expected_selection_digest!=='string'||!/^[a-f0-9]{64}$/.test(recipe.expected_selection_digest))fail('assistance_preference_invalid','Saved assistance uses an invalid or unsupported recipe. It has been preserved unchanged.');
  validateAssistanceSource(recipe.source);validateAssistanceSelection(recipe.selection);
  if(recipe.mode==='automatic'){validateAssistanceSettings(recipe.settings);if(recipe.selection.profile.kind!=='piano')fail('assistance_preference_invalid','Saved automatic assistance requires its original Piano profile.');}else if(recipe.settings!==null)fail('assistance_preference_invalid','Original mode cannot contain automatic settings.');
  if(context&&(recipe.preference_key!==preferenceKey(context)||!assistanceEqual(recipe.source,context.source)))fail('assistance_preference_mismatch','Saved assistance belongs to another source revision.');
  return recipe;
}
function recipeFrom(assistance,context){
  const p=assistance.plan;
  return validateAssistanceRecipe({format:ASSISTANCE_PREFERENCE_FORMAT,version:ASSISTANCE_PREFERENCE_VERSION,preference_key:preferenceKey(context),source:copy(context.source),selection:copy(p.selection),mode:p.mode,settings:copy(p.settings),planner_revision:p.planner_revision,revision:p.revision,expected_selection_digest:p.selection_digest},context);
}
/** Compact recipes only. A persisted recipe is never a usable ownership plan. */
export class PracticeAssistanceStore {
  constructor({storage}={}){this.storage=storage;}
  target(){return this.storage===undefined?globalThis.localStorage:this.storage;}
  key(context){return ASSISTANCE_STORAGE_PREFIX+encodeURIComponent(preferenceKey(context));}
  read(context){
    try{
      const storage=this.target();if(typeof storage?.getItem!=='function')return{status:'unavailable',recipe:null,raw:null};
      const raw=storage.getItem(this.key(context));if(raw===null)return{status:'default',recipe:null,raw:null};
      try{if(typeof raw!=='string'||raw.length>MAX_RECIPE_BYTES)fail('assistance_preference_invalid','Saved assistance exceeds the supported recipe size.');return{status:'saved',recipe:copy(validateAssistanceRecipe(JSON.parse(raw),context)),raw};}
      catch(error){return{status:'invalid',recipe:null,raw,error};}
    }catch(error){return{status:'unavailable',recipe:null,raw:null,error};}
  }
  save(context,recipe,{expectedRaw,replaceInvalid=false}={}){
    validateAssistanceRecipe(recipe,context);const current=this.read(context);
    if(current.status==='invalid'&&!replaceInvalid)fail('assistance_preference_replace_required','The incompatible saved preference is preserved. Explicitly confirm its replacement before applying.');
    if(expectedRaw!==undefined&&current.raw!==expectedRaw)fail('assistance_preference_changed','Saved assistance changed in another window. Reopen Mod before replacing it.');
    const raw=JSON.stringify(recipe);if(raw.length>MAX_RECIPE_BYTES)fail('assistance_preference_invalid','This complete recipe exceeds its storage budget.');
    try{const storage=this.target();if(typeof storage?.setItem!=='function')return{status:'unsaved',recipe:copy(recipe),raw:current.raw};storage.setItem(this.key(context),raw);return{status:'saved',recipe:copy(recipe),raw};}
    catch(error){return{status:'unsaved',recipe:copy(recipe),raw:current.raw,error};}
  }
}
function contextSnapshot(context){
  if(!context)return null;
  return{source:copy(context.source),selection:normalizeAssistanceSelection(context.selection),sourceToken:context.sourceToken,runtimeToken:context.runtimeToken,score:context.score,preferenceKey:context.preferenceKey,receipt:context.receipt};
}
function sameContext(a,b){if(a===null&&b===null)return true;return Boolean(a&&b&&assistanceEqual(a.source,b.source)&&assistanceEqual(a.selection,b.selection)&&a.sourceToken===b.sourceToken&&a.runtimeToken===b.runtimeToken&&a.score===b.score&&a.preferenceKey===b.preferenceKey&&assistanceEqual(a.receipt,b.receipt));}
function recipeBinding(context,recipe){return{source:context.source,selection:recipe.selection,mode:recipe.mode,settings:recipe.settings,revision:recipe.revision??1,sourceToken:context.sourceToken,runtimeToken:context.runtimeToken,...(context.receipt?{receipt:context.receipt}:{}),...(recipe.expected_selection_digest?{expected_selection_digest:recipe.expected_selection_digest}:{})};}
export function assistanceRequest(context,recipe){
  const binding=recipeBinding(context,recipe);validateAssistanceBinding(binding);
  const body=context.source?{source:copy(context.source)}:{score:context.score};
  body.selection=normalizeAssistanceSelection(recipe.selection);if(recipe.mode==='automatic')body.settings=copy(recipe.settings);
  return{path:`${context.source?'/api/library/assistance':'/api/practice-assistance'}/${recipe.mode==='automatic'?'generate':'original'}`,body,binding};
}
/** Transactional sidecar controller: no transport, scoring, audio or score writes. */
export function createPracticeAssistanceController({api,getContext,onChange=()=>{},store=new PracticeAssistanceStore()}={}){
  let captured=null,active=null,draft=null,prepared=null,phase='idle',error=null,persistence={status:'default',recipe:null,raw:null},epoch=0,pending=null,abort=null,notifyRunning=false;
  function value(){return{phase,error,active,draft:draft?copy(draft):null,prepared,persistence:{...persistence},blocked:['blocked','error'].includes(phase)&&!active,requiresReset:Boolean(draft&&(!active||!assistanceEqual(active.plan.selection,draft.selection)||active.plan.mode!==draft.mode||!assistanceEqual(active.plan.settings,draft.settings))),replaceInvalidRequired:persistence.status==='invalid'};}
  function notify(){if(notifyRunning)return;notifyRunning=true;try{onChange(value());}finally{notifyRunning=false;}}
  function invalidate(){epoch++;abort?.abort();abort=null;pending=null;prepared=null;}
  function synchronize(){
    let next;try{next=contextSnapshot(getContext());}catch(failure){next=null;if(captured){invalidate();captured=null;active=null;draft=null;}phase='blocked';error=failure;return null;}
    if(!sameContext(captured,next)){
      invalidate();captured=next;active=null;draft=null;phase='idle';error=null;persistence={status:'default',recipe:null,raw:null};
    }
    return captured;
  }
  async function request(context,recipe,current){
    if(current!==epoch||!abort)return null;
    const {path,body,binding}=assistanceRequest(context,recipe),signal=abort.signal;
    const response=await api(path,body,signal);
    if(current!==epoch||signal.aborted||!sameContext(context,contextSnapshot(getContext())))return null;
    return admitPracticeAssistance(response,binding);
  }
  function restore(){
    const context=synchronize();if(!context)return Promise.resolve(null);if(pending)return pending;if(active||phase==='default'||phase==='blocked'||phase==='error')return Promise.resolve(active);
    persistence=store.read(context);
    if(['invalid','unavailable'].includes(persistence.status)){phase='blocked';error=persistence.error||Object.assign(new Error('Saved assistance could not be read. Choose an explicit session assignment in Mod.'),{code:'assistance_storage_unavailable'});notify();return Promise.resolve(null);}
    if(!persistence.recipe){phase='default';notify();return Promise.resolve(null);}
    if(!assistanceEqual(normalizeAssistanceSelection(persistence.recipe.selection),context.selection)){phase='blocked';error=Object.assign(new Error('The saved assignment uses a different part or instrument selection. Reopen Mod to explicitly replace it.'),{code:'assistance_preference_selection'});notify();return Promise.resolve(null);}
    const current=++epoch;abort=new AbortController();phase='loading';error=null;
    pending=Promise.resolve().then(()=>request(context,persistence.recipe,current)).then(result=>{if(current!==epoch)return null;if(result){active=result;phase='ready';notify();}return result;}).catch(failure=>{if(current===epoch){phase='blocked';error=failure;notify();}return null;}).finally(()=>{if(current===epoch){pending=null;abort=null;}});notify();return pending;
  }
  function beginDraft(){
    const context=synchronize();if(!context)return null;invalidate();const stored=store.read(context);persistence=active&&persistence.status==='unsaved'&&stored.status!=='invalid'?{...persistence,raw:stored.raw}:stored;
    const recipe=active?.plan||persistence.recipe;
    draft={mode:recipe?.mode||'original',settings:recipe?.settings?copy(recipe.settings):null,selection:copy(context.selection),...(persistence.recipe&&!active?{expected_selection_digest:persistence.recipe.expected_selection_digest}:{})};phase='editing';error=null;notify();return value();
  }
  function setDraft(patch){
    const context=synchronize();if(!context||!draft)fail('assistance_no_draft','Open Mod before editing assistance.');
    const next={...draft,...copy(patch)};next.selection=normalizeAssistanceSelection(next.selection);
    if(!['original','automatic'].includes(next.mode))fail('assistance_mode_invalid','Choose Original or Automatic.');
    if(next.mode==='automatic')next.settings=next.settings||defaultAssistanceSettings();else next.settings=null;
    // Numeric editing may be temporarily incomplete; preparation validates it.
    if(assistanceEqual(next,draft))return value();delete next.expected_selection_digest;invalidate();draft=next;phase='editing';error=null;notify();return value();
  }
  function prepareDraft(){
    const context=synchronize();if(!context||!draft)return Promise.reject(Object.assign(new Error('Open Mod before preparing assistance.'),{code:'assistance_no_draft'}));
    if(pending)return pending;if(prepared)return Promise.resolve(prepared);
    const recipe=copy(draft),current=++epoch;abort=new AbortController();phase='preparing';error=null;
    pending=Promise.resolve().then(()=>request(context,recipe,current)).then(result=>{if(current!==epoch)return null;if(result){prepared=result;phase='prepared';notify();}return result;}).catch(failure=>{if(current===epoch){phase='error';error=failure;notify();}throw failure;}).finally(()=>{if(current===epoch){pending=null;abort=null;}});notify();return pending;
  }
  function cancelDraft(){synchronize();invalidate();draft=null;phase=active?'ready':persistence.recipe||persistence.status==='invalid'?'blocked':'default';error=null;notify();}
  function commitDraft({resetConfirmed=false,isCurrent=()=>true,replaceInvalid=false}={}){
    const context=synchronize();if(!context||!draft||!prepared||!isCurrent())fail('assistance_stale_draft','This assistance draft is no longer current.');
    const changed=value().requiresReset;if(changed&&!resetConfirmed)fail('assistance_reset_required','Changing human note ownership restarts the take. Confirm the reset before applying.');
    assertPracticeAssistanceCurrent(prepared,recipeBinding(context,draft));
    const recipe=recipeFrom(prepared,context),saved=store.save(context,recipe,{expectedRaw:persistence.raw,replaceInvalid});
    // The caller commits Mod and resets the take in this same synchronous turn.
    // Cache the new selection so the next context read can recognize that commit.
    captured={...captured,selection:copy(draft.selection)};active=prepared;persistence=saved;invalidate();draft=null;phase='ready';error=null;return active;
  }
  return{restore,beginDraft,setDraft,prepareDraft,cancelDraft,commitDraft,
    state(){synchronize();return value();},
    current(){const context=synchronize();if(!active||!context)return null;return assertPracticeAssistanceCurrent(active,recipeBinding(context,active.plan));},
    reset(){invalidate();captured=null;active=null;draft=null;phase='idle';error=null;persistence={status:'default',recipe:null,raw:null};notify();},
  };
}
