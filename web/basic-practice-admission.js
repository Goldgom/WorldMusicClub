import {isBasicKeysSong} from './clean-song-package.js';
import {appAssistanceContext} from './app-assistance.js';
import {songModIdentity} from './song-mod.js';
import {admitPracticeAssistance,assertPracticeAssistanceCurrent,practiceAssistanceBinding,assistanceEqual,normalizeAssistanceSelection} from './practice-assistance-receipt.js';
import {validateTargetPlan} from './physical-targets.js';
import {validSourceEligibilityReceipt,sourceEligibilitySummary} from './source-practice-eligibility.js';

const admitted=new WeakMap();
const fail=message=>{throw Object.assign(new TypeError(message),{code:'basic_practice_admission_invalid',basicPractice:true});};
function freeze(value){if(value&&typeof value==='object'){for(const child of Object.values(value))freeze(child);Object.freeze(value);}return value;}
/** Request authority comes exclusively from the saved-source native loader.
 * The full current timeline is retained locally only to check the response. */
export function createBasicPracticeAdmissionBinding(value,{selection,profile,assistance=null,intentToken,sessionToken}={}){
  if(!isBasicKeysSong(value?.cleanSong)||!value.compiled||value.compiled!==value.cleanSong.compilation||value.score!==value.compiled.score||intentToken==null||sessionToken==null)fail('The current saved Basic source, runtime and admission intent are required.');
  const context=appAssistanceContext({...value,songMod:null,mod:null,practiceSelection:selection},profile,songModIdentity(value));
  if(!context?.source||!selection||!Array.isArray(selection.part_ids))fail('Choose the actual Human parts before checking this saved source.');
  const selected=normalizeAssistanceSelection({selected_part_ids:selection.part_ids,profile});
  const mode=assistance?.plan.mode??'original',settings=assistance?.plan.settings??null;
  const binding={source:structuredClone(context.source),selection:selected,mode,settings:structuredClone(settings),revision:assistance?.plan.revision??1,sourceToken:context.sourceToken,runtimeToken:context.runtimeToken,...(context.pitchMod?{pitchMod:context.pitchMod,receipt:context.receipt}:{}),...(assistance?{expected_selection_digest:assistance.plan.selection_digest}:{}),compiled:value.compiled,score:value.score,intentToken,sessionToken,assistance};
  if(assistance)assertPracticeAssistanceCurrent(assistance,binding);
  return binding;
}
/** Keep network serialization outside input/capture/scoring hot paths. */
export function createBasicPracticeAdmissionRequest(value,options){
  const binding=createBasicPracticeAdmissionBinding(value,options);
  const body={source:structuredClone(binding.source),pitch_mod:binding.pitchMod?structuredClone(binding.pitchMod.configuration):{format:'wmc-pitch-mod',version:1,semitones:0},selection:structuredClone(binding.selection),...(binding.assistance?{plan:structuredClone(binding.assistance.plan)}:{})};
  return{path:'/api/library/practice-admission',body,binding};
}
function sameBinding(a,b){
  return a.sourceToken===b.sourceToken&&a.runtimeToken===b.runtimeToken&&a.compiled===b.compiled&&a.score===b.score&&a.intentToken===b.intentToken&&a.sessionToken===b.sessionToken&&a.assistance===b.assistance&&a.pitchMod===b.pitchMod&&assistanceEqual(a.source,b.source)&&assistanceEqual(a.selection,b.selection)&&a.mode===b.mode&&assistanceEqual(a.settings,b.settings)&&a.revision===b.revision&&a.expected_selection_digest===b.expected_selection_digest&&assistanceEqual(a.receipt,b.receipt);
}
export function admitBasicPractice(response,binding){
  if(!binding||!validSourceEligibilityReceipt(response?.checked?.receipt?.source_eligibility))fail('Original-source Human eligibility could not be verified. Listen remains available.');
  let checked;
  try{checked=admitPracticeAssistance(response,binding);}catch(error){fail(error.message);}
  const original=binding.sourceToken.originalSong||binding.sourceToken;
  const summary=sourceEligibilitySummary(original.runtime,original.score.performance.parts);
  if(summary&&!assistanceEqual(summary.receipt,checked.receipt.source_eligibility))fail('The Human receipt belongs to a different original eligibility analysis.');
  const notes=binding.compiled.timeline.notes,units=new Map(notes.map(note=>[note.id,note]));
  if(checked.coverage.source_unit_count!==original.coverage.key_attacks||units.size!==notes.length||checked.source_ownership.length!==notes.length||checked.source_ownership.some(unit=>units.get(unit.source_id)?.part_id!==unit.part_id)||checked.coverage.occurrence_count!==notes.length)fail('The Human receipt does not cover every unchanged source attack.');
  const human=new Set(checked.plan.human_source_ids),sourceTimeline={...binding.compiled.timeline,notes:notes.filter(note=>human.has(note.id))};
  try{validateTargetPlan(checked.human_targets,sourceTimeline);}catch(error){fail(error.message);}
  if(binding.assistance&&!assistanceEqual(checked,binding.assistance))fail('Native admission changed the explicitly selected note assignment.');
  const admission=Object.freeze({checked});
  admitted.set(admission,{...binding,source:freeze(structuredClone(binding.source)),selection:freeze(structuredClone(binding.selection)),settings:freeze(structuredClone(binding.settings))});
  return admission;
}
export function assertBasicPracticeCurrent(admission,binding){
  const saved=admitted.get(admission);
  if(!saved||!sameBinding(saved,binding))fail('The Human admission is missing or stale. Recheck this selection before practicing.');
  try{assertPracticeAssistanceCurrent(admission.checked,binding);if(binding.assistance)assertPracticeAssistanceCurrent(binding.assistance,practiceAssistanceBinding(binding.assistance));}catch(error){fail(error.message);}
  return admission;
}
