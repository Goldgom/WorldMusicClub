import {createHash} from 'node:crypto';
import {decodeBasicKeyRuntime} from '../web/basic-key-rendition.js';
import {assistanceEqual,normalizeAssistanceSelection,validateAssistanceSource} from '../web/practice-assistance-receipt.js';

const BASIC='wmh-basic-keys-midi1-v1';
const hash=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const fail=message=>{throw Object.assign(new Error(message),{code:'mock_practice_admission_invalid'});};
const fields=(value,keys)=>value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).length===keys.length&&keys.every(key=>Object.hasOwn(value,key));

/** Explicitly mocked protocol data for consumer tests. This does not run the
 * Rust GM analyzer, regenerate golden fixtures, or establish native acceptance.
 * The seed is exact original compact score JSON when a real fixture has it.
 * Separate test-only hash domains keep the wire binding and fingerprint apart. */
export function mockBasicEligibilityReceipt(originalScoreJson='synthetic consumer fixture without a source file'){
  return{revision:1,analysis_policy_id:'wmc-basic-explicit-gm-identity-v1',identity_table_revision:'wmc-reviewed-gm-subset-v1',product_policy_id:'wmc-provisional-piano-guitar-v1',eligibility_policy_id:'wmc-basic-known-unsupported-human-exclusion-v1',source_profile:BASIC,source_binding:{domain:'wmc-basic-complete-wire-json',serialization_revision:1,digest:hash(['mock-basic-wire-binding',originalScoreJson])},fingerprint:hash(['mock-basic-unresolved-eligibility',originalScoreJson])};
}
export function mockUnresolvedBasicSummary(runtime,receipt){
  const parts=runtime.parts.map(part=>({part_id:part.id,attack_count:part.attacks,supported_count:0,known_unsupported_count:0,unresolved_count:part.attacks}));
  const complete_attack_count=parts.reduce((count,part)=>count+part.attack_count,0);
  return{status:'available',receipt:structuredClone(receipt),complete_attack_count,known_unsupported_count:0,unresolved_count:complete_attack_count,parts};
}

/** Clone legacy original CC0 DTOs at a test loading boundary. All original
 * source bytes, clocks, pitches, gates and golden files remain untouched.
 * Only the newly required policy fields are mocked; the source fixture has no
 * explicit GM declaration, so every source attack remains unresolved here.
 * Existing fields (including deliberate malformed/unavailable cases) survive. */
export function withMockBasicEligibility(value){
  const copy=structuredClone(value),receipts=new Map();
  function collect(node){
    if(!node||typeof node!=='object')return;
    if(node.profile===BASIC&&typeof node.score_json==='string'&&node.content_sha256)receipts.set(node.content_sha256,mockBasicEligibilityReceipt(node.score_json));
    for(const child of Object.values(node))collect(child);
  }
  collect(copy);
  function visit(node,inherited){
    if(!node||typeof node!=='object')return;
    const key=node.profile===BASIC?node.content_sha256:node.source?.profile===BASIC?node.source.content_sha256:node.source_profile===BASIC?node.saved_package_sha256:null;
    const receipt=receipts.get(key)||inherited;
    if(node.source_profile===BASIC&&Object.hasOwn(node,'runtime_digest')&&!Object.hasOwn(node,'source_eligibility')){
      if(!receipt)fail('Mock Basic receipt enrichment needs its original compact source fixture.');
      node.source_eligibility=structuredClone(receipt);
    }
    if(/^wmh-basic-key-practice-v[12]$/.test(node.profile)&&Array.isArray(node.parts)&&receipt&&!Object.hasOwn(node,'source_eligibility'))node.source_eligibility=mockUnresolvedBasicSummary(node,receipt);
    for(const [name,child]of Object.entries(node))if(name!=='source_eligibility')visit(child,receipt);
  }
  visit(copy,receipts.size===1?[...receipts.values()][0]:undefined);
  return copy;
}

/** In-memory mock of the strict native route, for DOM/transport tests only.
 * This fixture is deliberately not a source-identity analyzer or acceptance
 * substitute. Checked optional plans must come from this server's prior mock
 * responses; arbitrary frontend timelines and handwritten plans are rejected. */
export function mockBasicPracticeAdmission(body,opened,{projection,checkedResponses=[]}={}){
  if(!fields(body,body?.plan===undefined?['source','pitch_mod','selection']:['source','pitch_mod','selection','plan']))fail('Unexpected practice-admission request fields.');
  validateAssistanceSource(body.source);
  const descriptor=opened?.clean_package,source=body.source;
  if(source.profile!==BASIC||!descriptor||descriptor.profile!==BASIC||source.content_sha256!==descriptor.content_sha256||source.key!==`song-${descriptor.content_sha256}`)fail('Practice admission needs the exact saved Basic fixture.');
  const config=body.pitch_mod;
  if(!fields(config,['format','version','semitones'])||config.format!=='wmc-pitch-mod'||config.version!==1||!Number.isInteger(config.semitones)||Math.abs(config.semitones)>12)fail('Practice admission needs an explicit supported pitch configuration.');
  const selection=normalizeAssistanceSelection(body.selection);
  if(!assistanceEqual(selection,body.selection))fail('Practice admission expects normalized part selection.');
  const runtime=withMockBasicEligibility(opened).clean_package.runtime;
  if(runtime.source_eligibility?.status!=='available')fail('Mock source eligibility is unavailable.');
  if(runtime.profile!=='wmh-basic-key-practice-v2')fail('The legacy mock runtime has no complete current Human authority.');
  if(selection.selected_part_ids.some(part=>!runtime.parts.some(row=>row.id===part)))fail('The requested part is outside the complete source.');
  if(config.semitones!==0&&(!projection||!assistanceEqual(projection.source,source)||!assistanceEqual(projection.configuration,config)))fail('Shifted admission needs a previously supplied mock native projection.');
  if(body.plan!==undefined){
    const previous=checkedResponses.find(response=>assistanceEqual(response.source,source)&&assistanceEqual(response.checked?.plan,body.plan)&&assistanceEqual(response.checked.plan.selection,selection)&&assistanceEqual(response.checked.receipt.source_eligibility,runtime.source_eligibility.receipt)&&assistanceEqual(response.pitch_mod,config.semitones===0?undefined:projection.identity));
    if(!previous)fail('The optional plan has no matching explicitly checked fixture response.');
    return structuredClone(previous);
  }
  if(runtime.source_eligibility.known_unsupported_count!==0)fail('This unresolved-only mock must not authorize known unsupported source attacks.');
  const compilation=config.semitones===0?decodeBasicKeyRuntime(runtime,fail).compilation:projection.compilation;
  if(compilation.timeline.notes.length!==descriptor.coverage.key_attacks)fail('The mock runtime does not retain every original source attack.');
  const timeline=compilation.timeline,selected=new Set(selection.selected_part_ids),humanNotes=timeline.notes.filter(note=>selected.has(note.part_id));
  const groupNotes=notes=>{
    if(selection.profile.kind!=='piano')return notes.map(note=>[note]);
    const result=new Map();
    for(const note of notes){const key=JSON.stringify([note.start_ms,note.midi]);if(!result.has(key))result.set(key,[]);result.get(key).push(note);}
    return[...result.values()].sort((a,b)=>a[0].start_ms-b[0].start_ms||a[0].midi-b[0].midi).map(notes=>notes.sort((a,b)=>a.id<b.id?-1:a.id>b.id?1:0));
  };
  if(groupNotes(timeline.notes).some(group=>group.some(note=>selected.has(note.part_id))&&group.some(note=>!selected.has(note.part_id))))fail('This unresolved-only mock does not synthesize cross-scope exclusion results.');
  const grouped=groupNotes(humanNotes),groups=grouped.map(notes=>({target_id:notes[0].id,source_occurrence_ids:notes.map(note=>note.id),source_note_ids:[...new Set(notes.flatMap(note=>note.source_note_ids))].sort(),part_ids:[...new Set(notes.map(note=>note.part_id))].sort()}));
  const targets=grouped.map((notes,index)=>({...notes[0],source_note_ids:groups[index].source_note_ids,duration_ms:Math.max(...notes.map(note=>note.duration_ms)),velocity:Math.max(...notes.map(note=>note.velocity))}));
  const receipt=config.semitones===0?{source_binding:{domain:'wmc-basic-complete-serde-json',serialization_revision:1,digest:hash(['mock-basic-serde-binding',descriptor.score_json])},saved_package_sha256:source.content_sha256,source_profile:BASIC,runtime_policy:source.runtime_policy,choice:null,runtime_digest:hash(['mock-basic-runtime',timeline]),source_eligibility:runtime.source_eligibility.receipt}:projection.receipt;
  const humans=humanNotes.map(note=>note.id).sort(),machine_occurrence_ids=timeline.notes.filter(note=>!selected.has(note.part_id)).map(note=>note.id),source_ownership=timeline.notes.map(note=>({source_id:note.id,part_id:note.part_id,owner:selected.has(note.part_id)?'human':'machine',in_selected_scope:selected.has(note.part_id)}));
  const plan={format:'wmc-practice-assistance',schema_version:1,planner_revision:1,revision:1,receipt,selection,mode:'original',settings:null,human_source_ids:humans,selection_digest:hash(['mock-original-basic-selection',receipt,selection,humans])};
  const checked={plan,receipt,human_targets:{timeline:{notes:targets,duration_ms:timeline.duration_ms},groups,diagnostics:[],source_note_count:humanNotes.length,target_count:targets.length,playable:targets.length>0},machine_occurrence_ids,source_ownership,coverage:{source_unit_count:timeline.notes.length,selected_source_unit_count:humanNotes.length,human_source_unit_count:humanNotes.length,machine_source_unit_count:machine_occurrence_ids.length,occurrence_count:timeline.notes.length,human_occurrence_count:humanNotes.length,machine_occurrence_count:machine_occurrence_ids.length,selected_target_count:groups.length,human_target_count:groups.length,machine_selected_target_count:0},exclusion_reasons:[],all_selected_human:humanNotes.length>0,scored_mode_allowed:targets.length>0,diagnostics:[]};
  return{source:structuredClone(source),checked,...(config.semitones===0?{}:{pitch_mod:structuredClone(projection.identity)})};
}
