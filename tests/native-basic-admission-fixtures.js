// Synthetic retained-evidence records only. Never native execution evidence,
// golden generation, source analysis, or a production proof fallback.
import {createHash} from 'node:crypto';
import {BASIC_ORIGINAL_SCOPE_DIAGNOSTIC,basicAdmissionSource,basicAdmissionTimeline} from '../scripts/basic-practice-admission-proof.mjs';
import {mockBasicEligibilityReceipt} from './basic-human-admission-fixtures.js';
export function mockNativeBasicAdmission(opened,selection,targets,{sourceDiagnostics=[]}={}){
 const source=basicAdmissionSource(opened),timeline=basicAdmissionTimeline(opened),selected=new Set(selection.selected_part_ids),humanNotes=timeline.notes.filter(note=>selected.has(note.part_id)),humans=humanNotes.map(note=>note.id).sort(),machines=timeline.notes.filter(note=>!selected.has(note.part_id)).map(note=>note.id),hash=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
 const receipt={source_binding:{domain:'wmc-basic-complete-serde-json',serialization_revision:1,digest:hash(['mock-proof-source',opened.clean_package.score_json])},saved_package_sha256:source.content_sha256,source_profile:source.profile,runtime_policy:source.runtime_policy,choice:null,runtime_digest:hash(['mock-proof-runtime',timeline]),source_eligibility:opened.clean_package.runtime.source_eligibility?.receipt||mockBasicEligibilityReceipt(opened.clean_package.score_json)};
 const plan={format:'wmc-practice-assistance',schema_version:1,planner_revision:1,revision:1,receipt,selection:structuredClone(selection),mode:'original',settings:null,human_source_ids:humans,selection_digest:hash(['mock-proof-selection',selection,humans])};
 const checked={plan,receipt,human_targets:structuredClone({...targets,diagnostics:targets.diagnostics||[]}),machine_occurrence_ids:machines,source_ownership:timeline.notes.map(note=>({source_id:note.id,part_id:note.part_id,owner:selected.has(note.part_id)?'human':'machine',in_selected_scope:selected.has(note.part_id)})),coverage:{source_unit_count:timeline.notes.length,selected_source_unit_count:humanNotes.length,human_source_unit_count:humanNotes.length,machine_source_unit_count:machines.length,occurrence_count:timeline.notes.length,human_occurrence_count:humanNotes.length,machine_occurrence_count:machines.length,selected_target_count:targets.target_count,human_target_count:targets.target_count,machine_selected_target_count:0},exclusion_reasons:[],all_selected_human:humanNotes.length>0,scored_mode_allowed:targets.playable&&targets.target_count>0,diagnostics:structuredClone([...sourceDiagnostics,BASIC_ORIGINAL_SCOPE_DIAGNOSTIC])};
 return{source,checked};
}

/** Explicit synthetic protocol adaptation, never a golden-file edit. Retains
 * all original assignment fields and all source warnings in their order. */
export function mockNativeOriginalPracticeResponse(assistanceResponse){
 const response=structuredClone(assistanceResponse),diagnostics=response.checked.diagnostics;
 if(diagnostics.at(-1)?.code!=='assistance_scope_limits')throw new Error('Expected the original assistance policy disclosure');
 diagnostics[diagnostics.length-1]=structuredClone(BASIC_ORIGINAL_SCOPE_DIAGNOSTIC);return response;
}
