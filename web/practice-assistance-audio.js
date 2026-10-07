import {assertPracticeAssistanceCurrent} from './practice-assistance-receipt.js';
import {canonicalFingerprint} from './canonical-audio-fingerprint.js';

const fail = message => {throw Object.assign(new TypeError(message), {code: 'stale_practice_assistance'});};
const masks = new WeakMap();

// An all-machine Mod has an explicit empty union. It is a Listen boundary,
// never an implicit request to turn a missing human selection into All.
export const emptyAssistedListen = (assistance, mode, selection) => assistance != null && mode === 'listen' && assistance.plan?.selection?.selected_part_ids?.length === 0 && selection?.kind === 'parts' && Array.isArray(selection.part_ids) && selection.part_ids.length === 0;

/** A callback supplies the live application binding after each asynchronous
 * preparation boundary. Tokens refer to the complete admitted source/runtime. */
export function assertAssistanceAudioCurrent(assistance, assistanceContext, sourceToken, runtimeToken) {
  if (assistance == null) return null;
  const binding = typeof assistanceContext === 'function' ? assistanceContext() : assistanceContext;
  if (!binding || binding.sourceToken !== sourceToken || binding.runtimeToken !== runtimeToken) fail('Assistance belongs to another complete source or runtime.');
  if (binding.expected_selection_digest !== assistance.plan?.selection_digest) fail('Audio needs the current assistance selection digest, including explicit note choices.');
  return assertPracticeAssistanceCurrent(assistance, binding);
}

/** Join checked ownership to already interpreted gates. Never filter source
 * events, regenerate targets, or synthesize from deduplicated physical groups. */
export function assistanceAudioMask(assistance, assistanceContext, {sourceToken, runtimeToken, sourceProfile, runtimePolicy, choice = null, savedPackageSha256, partIds, notes}) {
  if(assistance==null)return null;
  const binding=typeof assistanceContext==='function'?assistanceContext():assistanceContext;
  const checked = assertAssistanceAudioCurrent(assistance, binding, sourceToken, runtimeToken);
  if (!checked) return null;
  const {plan, receipt} = checked;
  // The branded pitch context has already proved its effective receipt above.
  // The renderer still uses the original synthesis and interpretation policy.
  const sourceReceipt=binding.pitchMod?.identity.original_receipt||receipt;
  if (sourceReceipt.source_profile !== sourceProfile || sourceReceipt.runtime_policy !== runtimePolicy || sourceReceipt.choice !== choice || savedPackageSha256 !== undefined && sourceReceipt.saved_package_sha256 !== savedPackageSha256) fail('Assistance uses another native source profile, package, choice or interpretation policy.');
  const selected = new Set(partIds);
  if (selected.size !== plan.selection.selected_part_ids.length || plan.selection.selected_part_ids.some(id => !selected.has(id))) fail('Assistance no longer matches the selected human part union.');
  const cached = masks.get(checked);
  if (cached?.notes === notes) return cached.mask;
  const machine = new Set(checked.machine_occurrence_ids), human = new Set(), ownership = new Map(), seen = new Set(), physicalOwners = new Map();
  if (machine.size !== checked.machine_occurrence_ids.length) fail('Assistance repeats a machine occurrence.');
  for (const group of checked.human_targets.groups) for (const id of group.source_occurrence_ids) {
    if (human.has(id) || machine.has(id)) fail('Assistance duplicates an occurrence or assigns two owners.');
    human.add(id);
  }
  for (const unit of checked.source_ownership) {
    if (ownership.has(unit.source_id)) fail('Assistance repeats a source unit.');
    ownership.set(unit.source_id, unit);
  }
  for (const note of notes) {
    if (seen.has(note.id) || human.has(note.id) === machine.has(note.id)) fail('Every original source occurrence must have exactly one checked owner.');
    seen.add(note.id);
    const owner = human.has(note.id) ? 'human' : 'machine';
    if (owner === 'human' && !selected.has(note.part_id)) fail('A human occurrence lies outside the selected parts.');
    if (plan.selection.profile.kind === 'piano') {
      const physicalKey = `${note.start_ms}:${note.midi}`, previous = physicalOwners.get(physicalKey);
      if (previous !== undefined && previous !== owner) fail('An exact keyboard unison must retain one owner across its original parts.');
      physicalOwners.set(physicalKey, owner);
    }
    if (!Array.isArray(note.source_note_ids) || !note.source_note_ids.length) fail('A source occurrence has no retained source references.');
    for (const id of note.source_note_ids) {
      const unit = ownership.get(id);
      if (!unit || unit.part_id !== note.part_id || unit.owner !== owner || unit.in_selected_scope !== selected.has(note.part_id)) fail('The checked source ownership does not match the original occurrence references.');
    }
  }
  if (seen.size !== human.size + machine.size || checked.coverage.occurrence_count !== seen.size || checked.coverage.human_occurrence_count !== human.size || checked.coverage.machine_occurrence_count !== machine.size) fail('Assistance does not cover the complete interpreted source.');
  const fingerprint = canonicalFingerprint('wmc-assistance-audio-ownership-v1', {receipt, revision: plan.revision, planner_revision: plan.planner_revision, selection: plan.selection, mode: plan.mode, settings: plan.settings, selection_digest: plan.selection_digest});
  const mask = Object.freeze({isMachine: id => {if (!seen.has(id)) fail('A sounding gate has no checked occurrence mapping.'); return machine.has(id);}, fingerprint});
  // Native package arrays are deeply frozen at admission. Mutable canonical
  // compilation objects still receive the complete join on every build.
  if (Object.isFrozen(notes) && notes.every(Object.isFrozen)) masks.set(checked, {notes, mask});
  return mask;
}
