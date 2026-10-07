import {createHash} from 'node:crypto';
import {defaultAssistanceSettings} from '../web/practice-assistance-receipt.js';
const hash=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
export function assistanceContext({canonical=false,vsq=false}={}){
  const content='a'.repeat(64),source=canonical?null:{key:`song-${content}`,content_sha256:content,profile:vsq?'wmh-vsq-clean-v1':'wmh-basic-keys-midi1-v1',choice:vsq?'base_notes_instrumental':null,runtime_policy:vsq?'wmh-vsq-base-note-practice-v1':'wmh-basic-key-rendition-fifo-v1'};
  return{source,selection:{selected_part_ids:['piano'],profile:{kind:'piano',key_count:88,lowest_midi:21}},sourceToken:{},runtimeToken:{},...(canonical?{score:{id:'original-fixture',parts:[]},preferenceKey:'canonical-score-v1.'+'b'.repeat(64)}:{})};
}
export function assistanceBinding(context,options={}){return{...context,mode:'automatic',settings:defaultAssistanceSettings(),revision:1,...options};}
/** Original synthetic identifiers; fixture DTOs are not runtime source authority. */
export function assistanceResponse(context,{mode='automatic',settings=mode==='automatic'?defaultAssistanceSettings():null,selection=context.selection}={}){
  selection=structuredClone(selection);selection.selected_part_ids.sort();
  const domain=context.source?.profile==='wmh-basic-keys-midi1-v1'?'wmc-basic-complete-serde-json':context.source?.profile==='wmh-vsq-clean-v1'?'wmc-vsq-complete-serde-json':'wmc-canonical-score-serde-json';
  const receipt={source_binding:{domain,serialization_revision:1,digest:'b'.repeat(64)},saved_package_sha256:context.source?.content_sha256??null,source_profile:context.source?.profile??'wmc-canonical-score-v1',runtime_policy:context.source?.runtime_policy??'wmc-canonical-practice-v1',choice:context.source?.choice??null,runtime_digest:'c'.repeat(64)};
  const sources=[['a','piano'],['unison','piano'],['b','piano'],['bass','bass']],human=new Set(sources.filter(([id,part])=>selection.selected_part_ids.includes(part)&&(mode==='original'||id==='a'||id==='unison')).map(([id])=>id));
  const occurrences=[['a@1',['a','unison'],['a@1','unison@1'],'piano',60,0],['b@1',['b'],['b@1'],'piano',64,100],['bass@1',['bass'],['bass@1'],'bass',48,0],['a@2',['a','unison'],['a@2','unison@2'],'piano',60,500]];
  const retained=occurrences.filter(([,ids])=>human.has(ids[0]));
  const groups=retained.map(([target_id,source_note_ids,source_occurrence_ids,part])=>({target_id,source_note_ids,source_occurrence_ids,part_ids:[part]}));
  const notes=retained.map(([id,source_note_ids,,part_id,midi,start_ms])=>({id,source_note_id:source_note_ids[0],source_note_ids,part_id,midi,start_ms,duration_ms:100,velocity:90,voice:'1',staff:1}));
  const humanOccurrences=groups.reduce((sum,g)=>sum+g.source_occurrence_ids.length,0),machine_occurrence_ids=occurrences.filter(([,ids])=>!human.has(ids[0])).flatMap(([, ,ids])=>ids);
  const source_ownership=sources.map(([source_id,part_id])=>({source_id,part_id,owner:human.has(source_id)?'human':'machine',in_selected_scope:selection.selected_part_ids.includes(part_id)}));
  const selectedUnits=source_ownership.filter(s=>s.in_selected_scope).length,selectedTargets=occurrences.filter(([, , ,part])=>selection.selected_part_ids.includes(part)).length;
  const plan={format:'wmc-practice-assistance',schema_version:1,planner_revision:1,revision:1,receipt,selection,mode,settings,human_source_ids:[...human].sort(),selection_digest:''};plan.selection_digest=hash(plan);
  const checked={plan,receipt,human_targets:{timeline:{notes,duration_ms:600},groups,diagnostics:[],source_note_count:humanOccurrences,target_count:groups.length,playable:groups.length>0},machine_occurrence_ids,source_ownership,coverage:{source_unit_count:4,selected_source_unit_count:selectedUnits,human_source_unit_count:human.size,machine_source_unit_count:4-human.size,occurrence_count:6,human_occurrence_count:humanOccurrences,machine_occurrence_count:machine_occurrence_ids.length,selected_target_count:selectedTargets,human_target_count:groups.length,machine_selected_target_count:selectedTargets-groups.length},exclusion_reasons:source_ownership.filter(s=>s.in_selected_scope&&s.owner==='machine').map(s=>({source_ids:[s.source_id],code:'onset_density'})),all_selected_human:selectedUnits>0&&human.size===selectedUnits,scored_mode_allowed:groups.length>0,diagnostics:[]};
  return{source:structuredClone(context.source)??{kind:'canonical',source_binding:receipt.source_binding,profile:receipt.source_profile,choice:null,runtime_policy:receipt.runtime_policy},checked};
}
export function memoryStorage(){const values=new Map();return{values,getItem:key=>values.get(key)??null,setItem:(key,value)=>values.set(key,value)};}
export function deferred(){let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return{promise,resolve,reject};}
