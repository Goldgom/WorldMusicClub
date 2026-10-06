import {validateSongMod, songModOptions} from './song-mod.js';

export const PART_INSTRUMENT_POLICY = 'wmc-part-instrument-policy-v2';
const admitted = new WeakSet();
const freeze = value => {
  for (const item of Object.values(value)) if (item && typeof item === 'object') freeze(item);
  return Object.freeze(value);
};
const invalid = (message, code = 'invalid_part_instrument_policy') => {throw Object.assign(new TypeError(message), {code});};

/** The physical profile still owns targets and range. Only the existing live
 * AudioWorklet recipe changes. No note, pitch, or device selects a part owner. */
export function createPartInstrumentPolicy(mod, binding = {}) {
  validateSongMod(mod, binding);
  const options = songModOptions(mod), performanceInstrument = binding.performanceInstrument ?? 'piano', mode = binding.mode ?? options.mode;
  if (!['piano', 'guitar'].includes(performanceInstrument) || !['practice', 'listen'].includes(mode)) invalid('Unsupported live performance context.');
  const parts = mod.config.parts.map(part => ({
    partId: part.partId,
    performer: part.performer,
    storedMachineInstrument: part.instrument,
    liveInstrument: part.liveInstrument ?? 'follow',
    sound: part.performer === 'human' ? ((part.liveInstrument ?? 'follow') === 'follow' ? performanceInstrument : part.liveInstrument) : part.instrument,
    playbackMuted: part.muted,
    visible: part.visible,
  }));
  const humans = parts.filter(part => part.performer === 'human'), sounds = new Set(humans.map(part => part.sound));
  const policy = freeze({
    policyId: PART_INSTRUMENT_POLICY,
    songId: mod.songId,
    sourceRevision: {...mod.sourceRevision},
    configFingerprint: mod.configFingerprint,
    performanceInstrument,
    mode,
    human: {
      kind: humans.length === 0 ? 'none' : humans.length === 1 ? 'single-part' : 'shared-group',
      status: !humans.length ? 'none' : sounds.size > 1 ? 'conflict' : 'ready',
      partIds: humans.map(part => part.partId),
      instrument: sounds.size === 1 ? humans[0].sound : null,
      conflictingPartIds: sounds.size > 1 ? humans.map(part => part.partId) : [],
      independentPartInstruments: false,
      independentPartInputs: false,
    },
    parts,
    machineInstrumentOverrides: options.instrumentOverrides,
  });
  admitted.add(policy);
  return policy;
}

/** Require the active source, Mod, performance profile and mode after any await.
 * A structurally similar descriptor or a previous default resolution is stale. */
export function assertPartInstrumentPolicyCurrent(policy, {mod, ...binding} = {}) {
  if (!admitted.has(policy)) invalid('Create a source-bound part instrument policy first.');
  let current;
  try { current = createPartInstrumentPolicy(mod, binding); }
  catch { invalid('The live sound policy no longer matches this source or configuration.', 'stale_part_instrument_policy'); }
  if (JSON.stringify(current) !== JSON.stringify(policy)) invalid('The live sound policy no longer matches this source, mode or performance instrument.', 'stale_part_instrument_policy');
  return policy;
}

export function partInstrumentPolicyIssue(policy, parts = [], locale = 'en') {
  if (policy.human.status !== 'conflict') return '';
  const names = new Map(parts.map((part, index) => [part.id, `${locale === 'en' ? 'Part' : '声部'} ${index + 1} · ${part.name || part.id}`]));
  const list = policy.human.conflictingPartIds.map(id => `${names.get(id) || id} (${policy.parts.find(part => part.partId === id).sound})`).join(', ');
  return locale === 'en' ? `Conflicting human sounds: ${list}. One shared input needs one live sound. Choose a common sound or use Unify human sounds.` : `真人音色冲突：${list}。共用输入只能使用一种现场音色。请设置相同音色，或使用“统一真人音色”。`;
}
export function assertPartInstrumentPolicyReady(policy, parts = [], locale = 'en') {
  if (!admitted.has(policy)) invalid('Create a source-bound part instrument policy first.');
  const issue = partInstrumentPolicyIssue(policy, parts, locale);
  if (issue) invalid(issue, 'conflicting_human_live_instruments');
  return policy;
}

/** One shared route carries every human owner, with one resolved live recipe.
 * A caller must revalidate its captured policy against current state after await. */
export function resolvePartInstrumentInput(policy, request = {kind: 'shared'}, currentBinding) {
  if (!admitted.has(policy)) invalid('Create a source-bound part instrument policy first.');
  if (currentBinding) assertPartInstrumentPolicyCurrent(policy, currentBinding);
  const blocked = reason => freeze({status: 'blocked', reason, partIds: []});
  if (!request || typeof request !== 'object' || Array.isArray(request)
    || ![Object.prototype, null].includes(Object.getPrototypeOf(request))) return blocked('unsupported_input_route');
  const kind = Object.getOwnPropertyDescriptor(request, 'kind')?.value;
  const fields = kind === 'shared' ? ['kind'] : kind === 'part' ? ['kind', 'partId'] : [];
  if (!fields.length || Reflect.ownKeys(request).length !== fields.length || fields.some(key => {
    const field = Object.getOwnPropertyDescriptor(request, key);
    return !field?.enumerable || !Object.hasOwn(field, 'value');
  })) return blocked('unsupported_input_route');
  if (!policy.human.partIds.length) return blocked('no_human_parts');
  if (policy.mode !== 'practice') return blocked('not_practice_mode');
  if (policy.human.status === 'conflict') return blocked('conflicting_human_live_instruments');
  if (request.kind === 'part') {
    if (!policy.parts.some(part => part.partId === request.partId)) return blocked('unknown_source_part');
    if (!policy.human.partIds.includes(request.partId)) return blocked('part_is_machine');
    if (policy.human.kind === 'shared-group') return blocked('ambiguous_shared_human_input');
  }
  return freeze({status: 'ready', ownership: policy.human.kind, partIds: [...policy.human.partIds], instrument: policy.human.instrument});
}
