import {validateSongMod, songModOptions} from './song-mod.js';

export const PART_INSTRUMENT_POLICY = 'wmc-part-instrument-policy-v1';
const admitted = new WeakSet();
const freeze = value => {
  for (const item of Object.values(value)) if (item && typeof item === 'object') freeze(item);
  return Object.freeze(value);
};

/** Runtime snapshot of the current Mod contract, not another score or saved
 * format. Instrument is a machine recipe; human input owns one shared group.
 * No pitch, source program, mute, visibility or target representative can
 * establish an individual human owner. The target planner keeps deduplication. */
export function createPartInstrumentPolicy(mod, binding = {}) {
  validateSongMod(mod, binding);
  const options = songModOptions(mod), humanPartIds = mod.config.parts.filter(part => part.performer === 'human').map(part => part.partId);
  const policy = freeze({
    policyId: PART_INSTRUMENT_POLICY,
    songId: mod.songId,
    sourceRevision: {...mod.sourceRevision},
    configFingerprint: mod.configFingerprint,
    human: {
      kind: humanPartIds.length === 0 ? 'none' : humanPartIds.length === 1 ? 'single-part' : 'shared-group',
      partIds: humanPartIds,
      instrument: 'current-shared-live-instrument',
      independentPartInstruments: false,
      independentPartInputs: false,
    },
    parts: mod.config.parts.map(part => ({
      partId: part.partId,
      performer: part.performer,
      storedMachineInstrument: part.instrument,
      sound: part.performer === 'human' ? 'current-shared-live-instrument' : part.instrument,
      playbackMuted: part.muted,
      visible: part.visible,
    })),
    machineInstrumentOverrides: options.instrumentOverrides,
  });
  admitted.add(policy);
  return policy;
}

/** Prepared consumer interface. A shared route may own several human parts;
 * it must not be narrowed to a part from the played key or a deduplicated note.
 * Per-device/channel and independent instrument routes are not implemented. */
export function resolvePartInstrumentInput(policy, request = {kind: 'shared'}) {
  if (!admitted.has(policy)) throw Object.assign(new TypeError('Create a source-bound part instrument policy first.'), {code: 'invalid_part_instrument_policy'});
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
  if (request.kind === 'part') {
    if (!policy.parts.some(part => part.partId === request.partId)) return blocked('unknown_source_part');
    if (!policy.human.partIds.includes(request.partId)) return blocked('part_is_machine');
    if (policy.human.kind === 'shared-group') return blocked('ambiguous_shared_human_input');
  }
  return freeze({status: 'ready', ownership: policy.human.kind, partIds: [...policy.human.partIds], instrument: policy.human.instrument});
}
