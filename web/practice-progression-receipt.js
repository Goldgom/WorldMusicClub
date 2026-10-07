import {admitPracticeAssistance,assertPracticeAssistanceCurrent,practiceAssistanceBinding,assistanceEqual,normalizeAssistanceSelection,validateAssistanceSource} from './practice-assistance-receipt.js';

export const PROGRESSION_FORMAT='wmc-practice-progression';
export const PROGRESSION_SCHEME='wmc-keyboard-three-layer-v1';
export const PROGRESSION_ALGORITHM='wmc-keyboard-progression-v1';
export const PROGRESSION_LAYERS=Object.freeze(['single','balanced','dense']);
const admitted=new WeakMap(),byAssistance=new WeakMap();
const fail=message=>{throw Object.assign(new TypeError(message),{code:'practice_progression_invalid'});};
export const exactFields=(value,names)=>Boolean(value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).length===names.length&&names.every(name=>Object.hasOwn(value,name)));
const hash=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
const count=value=>Number.isSafeInteger(value)&&value>=0&&value<=100000;
function freeze(value){if(value&&typeof value==='object'){for(const child of Object.values(value))freeze(child);Object.freeze(value);}return value;}
export function validateProgressionPlan(plan){
  if(!exactFields(plan,['format','schema_version','planner_revision','revision','algorithm_id','scheme_id','receipt','selection','selection_digest','scheme_digest','hierarchy_digest','layer','plan_digest'])||plan.format!==PROGRESSION_FORMAT||plan.schema_version!==1||plan.planner_revision!==1||plan.revision!==1||plan.algorithm_id!==PROGRESSION_ALGORITHM||plan.scheme_id!==PROGRESSION_SCHEME||!PROGRESSION_LAYERS.includes(plan.layer)||!['selection_digest','scheme_digest','hierarchy_digest','plan_digest'].every(key=>hash(plan[key])))fail('This progression uses an unsupported or incomplete source, scheme or revision proof.');
  normalizeAssistanceSelection(plan.selection);return plan;
}
/** Rust provides the hierarchy; browser summaries never authorize membership. */
export function admitPracticeProgression(response,binding){
  validateAssistanceSource(binding.source);const selection=normalizeAssistanceSelection(binding.selection),checked=response?.checked,plan=validateProgressionPlan(checked?.plan);
  if(!exactFields(response,['source','checked'])||!exactFields(checked,['plan','layers','assistance'])||!assistanceEqual(plan.selection,selection)||plan.layer!==binding.layer||binding.plan&&!assistanceEqual(plan,binding.plan))fail('The progression response does not match the requested source, layer or saved proof.');
  const assistance=admitPracticeAssistance({source:response.source,checked:checked.assistance},{...binding,selection,mode:'explicit',settings:null,revision:1,receipt:plan.receipt});
  if(!Array.isArray(checked.layers)||checked.layers.length!==3)fail('The complete three-stage summary is required.');
  let previous=null;
  for(const [index,summary] of checked.layers.entries()){
    if(!exactFields(summary,['layer','constraints','human_source_unit_count','human_occurrence_count','human_target_count','scored_mode_allowed','equals_previous_layer'])||summary.layer!==PROGRESSION_LAYERS[index]||!exactFields(summary.constraints,['max_targets_per_onset','min_onset_interval_ms','max_simultaneous_keys','max_held_span_semitones'])||!assistanceEqual(['max_targets_per_onset','min_onset_interval_ms','max_simultaneous_keys','max_held_span_semitones'].map(key=>summary.constraints[key]),[[1,500,1,0],[2,250,3,7],[4,125,6,12]][index])||!['human_source_unit_count','human_occurrence_count','human_target_count'].every(key=>count(summary[key]))||typeof summary.scored_mode_allowed!=='boolean'||typeof summary.equals_previous_layer!=='boolean'||!summary.human_target_count&&summary.scored_mode_allowed||index===0&&summary.equals_previous_layer)fail('A progression stage has an invalid summary.');
    if(previous&&(['human_source_unit_count','human_occurrence_count','human_target_count'].some(key=>summary[key]<previous[key])||summary.equals_previous_layer!==['human_source_unit_count','human_occurrence_count','human_target_count'].every(key=>summary[key]===previous[key])))fail('Progression summaries disagree with nested stages.');
    previous=summary;
  }
  const chosen=checked.layers.find(item=>item.layer===plan.layer);
  if(['human_source_unit_count','human_occurrence_count','human_target_count'].some(key=>chosen[key]!==assistance.coverage[key])||chosen.scored_mode_allowed!==assistance.scored_mode_allowed)fail('The selected stage and checked human targets disagree.');
  const result=Object.freeze({plan:freeze(structuredClone(plan)),layers:freeze(structuredClone(checked.layers)),assistance});
  admitted.set(result,{...practiceAssistanceBinding(assistance),layer:plan.layer,admissionKey:binding.admissionKey??null});byAssistance.set(assistance,result);return result;
}
export function assertPracticeProgressionCurrent(checked,binding){
  const saved=admitted.get(checked);if(!saved||saved.layer!==binding.layer||saved.admissionKey!==(binding.admissionKey??null)||binding.plan&&!assistanceEqual(binding.plan,checked.plan))fail('The checked progression is stale. Check this source, selection, rate and range again.');
  assertPracticeAssistanceCurrent(checked.assistance,{...binding,mode:'explicit',settings:null,revision:1,receipt:checked.plan.receipt});return checked;
}
export function progressionForAssistance(assistance){return byAssistance.get(assistance)||null;}
