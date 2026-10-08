/** Native policy receipt validation only. Never classify instruments in JavaScript.
 * Summary counts support fresh defaults and explanations, never authorization. */
export const BASIC_SOURCE_PROFILE='wmh-basic-keys-midi1-v1';
const fields=(value,names)=>Boolean(value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).length===names.length&&names.every(name=>Object.hasOwn(value,name)));
const hash=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
const count=value=>Number.isSafeInteger(value)&&value>=0&&value<=100000;
export function validSourceEligibilityReceipt(value){
  return fields(value,['revision','analysis_policy_id','identity_table_revision','product_policy_id','eligibility_policy_id','source_profile','source_binding','fingerprint'])&&value.revision===1&&value.analysis_policy_id==='wmc-basic-explicit-gm-identity-v1'&&value.identity_table_revision==='wmc-reviewed-gm-subset-v1'&&value.product_policy_id==='wmc-provisional-piano-guitar-v1'&&value.eligibility_policy_id==='wmc-basic-known-unsupported-human-exclusion-v1'&&value.source_profile===BASIC_SOURCE_PROFILE&&fields(value.source_binding,['domain','serialization_revision','digest'])&&value.source_binding.domain==='wmc-basic-complete-wire-json'&&value.source_binding.serialization_revision===1&&hash(value.source_binding.digest)&&hash(value.fingerprint);
}
/** Basic always needs the new receipt. Other source contracts remain unchanged. */
export function runtimeReceiptFields(receipt,profile){
  const names=['source_binding','saved_package_sha256','source_profile','runtime_policy','choice','runtime_digest'];
  if(profile===BASIC_SOURCE_PROFILE)names.push('source_eligibility');
  return fields(receipt,names)&&(profile!==BASIC_SOURCE_PROFILE||validSourceEligibilityReceipt(receipt.source_eligibility));
}
export function sourceEligibilitySummary(runtime,parts){
  const summary=runtime?.source_eligibility;
  if(!fields(summary,['status','receipt','complete_attack_count','known_unsupported_count','unresolved_count','parts'])||summary.status!=='available'||!validSourceEligibilityReceipt(summary.receipt)||![summary.complete_attack_count,summary.known_unsupported_count,summary.unresolved_count].every(count)||!Array.isArray(parts)||!Array.isArray(summary.parts)||summary.parts.length!==parts.length)return null;
  const keys=['part_id','attack_count','supported_count','known_unsupported_count','unresolved_count'];
  if(summary.parts.some((part,index)=>!fields(part,keys)||part.part_id!==(parts[index].id??parts[index].part_id)||keys.slice(1).some(key=>!count(part[key]))||part.attack_count!==part.supported_count+part.known_unsupported_count+part.unresolved_count))return null;
  if(summary.complete_attack_count!==summary.parts.reduce((n,p)=>n+p.attack_count,0)||summary.known_unsupported_count!==summary.parts.reduce((n,p)=>n+p.known_unsupported_count,0)||summary.unresolved_count!==summary.parts.reduce((n,p)=>n+p.unresolved_count,0))return null;
  return summary;
}
