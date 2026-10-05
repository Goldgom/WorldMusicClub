/** Explicit human ownership, independent of audible mix and visible notation.
 * A missing selection never means All. Canonical source order makes exports
 * stable when a dialog selects the same parts in a different order. */
export function resolvePracticeSelection(parts, selection) {
  const fail = () => { throw Object.assign(new TypeError('Choose all parts or a non-empty set of existing human parts.'), {code:'clean_target_required'}); };
  if (!Array.isArray(parts)) fail();
  const ids = parts.map(part => typeof part === 'string' ? part : part?.id);
  if (!ids.length || ids.some(id => typeof id !== 'string' || !id) || new Set(ids).size !== ids.length) fail();
  if (!selection || !['all','parts'].includes(selection.kind)) fail();
  if (selection.kind === 'all') {
    if (selection.part_ids !== undefined && (!Array.isArray(selection.part_ids) || selection.part_ids.length !== ids.length || new Set(selection.part_ids).size !== ids.length || selection.part_ids.some(id => !ids.includes(id)))) fail();
    return {kind:'all',part_ids:[...ids]};
  }
  const requested = selection.part_ids;
  if (!Array.isArray(requested) || !requested.length || new Set(requested).size !== requested.length || requested.some(id => !ids.includes(id))) fail();
  return {kind:'parts',part_ids:ids.filter(id => requested.includes(id))};
}

/** Legacy callers may explicitly select one part. Null is never an implicit
 * request for complete human performance in a clean-song renderer. */
export function humanPracticePartIds(parts, {mode='practice',practiceSelection, targetPart=null}={}) {
  if (mode !== 'practice') return new Set();
  const selection = practiceSelection === undefined ? {kind:'parts',part_ids:[targetPart]} : practiceSelection;
  return new Set(resolvePracticeSelection(parts,selection).part_ids);
}
