/** FF09 is a logical destination. This bounded receiver chooses one explicit
 * mapping; it never infers the source device, its bank, or its acoustic identity. */
export const LOGICAL_DEVICE_ROUTE_BLOCKER = 'unresolved_logical_device_route';
export const LOGICAL_DEVICE_POLICY = 'single_named_device_to_procedural_receiver';
export const LOGICAL_DEVICE_POLICY_SUFFIX = ':single-named-device-v1';
export const isDeviceName = command => command?.kind === 'text' && command.role === 'device_name';
const otherRoutes = new Set(['device_name', 'port', 'midi_port', 'port_prefix', 'channel_prefix', 'midi_channel_prefix', 'sysex', 'sys_ex', 'system_exclusive', 'sysex_escape', 'escape']);
export const isUnsupportedRouteCommand = command => otherRoutes.has(command?.kind)
  || (command?.kind === 'text' && otherRoutes.has(command.role) && command.role !== 'device_name');
const integer = (n, lo, hi) => Number.isSafeInteger(n) && n >= lo && n <= hi;
const stable = value => JSON.stringify(value, (_, item) => item && !Array.isArray(item) && typeof item === 'object'
  ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b))) : item);
const coord = origin => `${origin?.track}:${origin?.event}`;
const validOrigin = (origin, tracks) => origin && Object.keys(origin).sort().join(',') === 'event,track'
  && integer(origin.track, 0, tracks - 1) && integer(origin.event, 0, 249999);
function fraction(value, exact = false) {
  if (!value || Object.keys(value).sort().join(',') !== 'denominator,numerator' || !integer(value.denominator, 1, 1000000)) return null;
  if (exact ? typeof value.numerator !== 'string' || !/^(0|[1-9][0-9]{0,19})$/.test(value.numerator)
    : !integer(value.numerator, 0, 1000000000)) return null;
  const numerator = BigInt(value.numerator);
  return numerator <= 18446744073709551615n ? [numerator, BigInt(value.denominator)] : null;
}
const compare = (a, b) => a[0] * b[1] < b[0] * a[1] ? -1 : a[0] * b[1] > b[0] * a[1] ? 1 : 0;
const add = (a, b) => [a[0] * b[1] + b[0] * a[1], a[1] * b[1]];
const order = (a, b) => compare(a.beat, b.beat) || a.origin.track - b.origin.track || a.origin.event - b.origin.event;
const unresolved = reason => ({ logical_device_mapping: null, blocker: LOGICAL_DEVICE_ROUTE_BLOCKER, reason });
const unchanged = () => ({ logical_device_mapping: null, blocker: null, reason: null });

/** Bind retained source coordinates, commands and native timing before resolving
 * a name. Strict notes are expanded only for validation, never for scheduling. */
export function inspectLogicalDeviceRoute(score, runtime, { strict = false } = {}) {
  const performance = score?.performance, source = performance?.events, rendered = runtime?.events;
  const lists = [source, rendered].filter(Array.isArray);
  if (lists.some(events => events.some(event => isUnsupportedRouteCommand(event.command)))) return unresolved('unsupported_route_command');
  if (!lists.some(events => events.some(event => isDeviceName(event.command)))) return unchanged();
  if (!Array.isArray(source) || !Array.isArray(rendered) || source.length !== rendered.length || !integer(source.length, 1, 250000)
    || !Array.isArray(performance.tracks) || !integer(performance.tracks.length, 1, 128)
    || !Array.isArray(performance.parts) || performance.parts.length > 2048 || !/^[a-f0-9]{64}$/.test(score.source?.sha256 || '')) return unresolved('source_runtime_binding');
  const tracks = performance.tracks, records = [], parts = new Map();
  if (tracks.some((track, index) => track.source_index !== index || track.id !== `track-${index + 1}` || !integer(track.source_event_count, 1, 250000))) return unresolved('source_runtime_binding');
  if (!strict && (stable(runtime.tracks) !== stable(tracks) || stable(runtime.parts) !== stable(performance.parts)
    || runtime.source_sha256 !== score.source.sha256)) return unresolved('source_runtime_binding');
  for (const part of performance.parts) {
    const track = tracks.findIndex(item => item.id === part.track_id);
    if (track < 0 || !integer(part.channel, 0, 15) || parts.has(part.id)) return unresolved('source_runtime_binding');
    parts.set(part.id, { ...part, track });
  }
  const append = (original, event, command = original.command) => {
    const beat = original.beat ?? fraction(original.at), time = fraction(event.exact_microseconds, true);
    if (!beat || !time || !validOrigin(original.origin, tracks.length) || coord(original.origin) !== coord(event.origin)
      || !validOrigin(event.origin, tracks.length) || (strict && (!Number.isFinite(event.at_ms)
        || Math.abs(event.at_ms - Number(time[0]) / Number(time[1]) / 1000) > Math.max(1e-7, Math.abs(event.at_ms) * 1e-12)))) return false;
    records.push({ origin: original.origin, command, beat, time }); return true;
  };
  for (let index = 0; index < source.length; index++) {
    const original = source[index], event = rendered[index];
    const identity = `midi:${score.source.sha256}:t${original.origin?.track}:e${original.origin?.event}`;
    if (stable(original.command) !== stable(event.command) || event.event_id !== identity
      || (!strict && original.event_id !== identity) || !append(original, event)) return unresolved('source_runtime_binding');
  }
  // Source and runtime event arrays must already agree in exact musical order.
  if (records.some((record, index) => index && (order(records[index - 1], record) >= 0
    || compare(records[index - 1].time, record.time) > 0))) return unresolved('source_runtime_binding');
  if (strict) {
    if (!Array.isArray(performance.notes) || !Array.isArray(runtime.notes) || performance.notes.length !== runtime.notes.length
      || source.length + performance.notes.length * 2 > 250000 || !Array.isArray(score.notation?.parts)) return unresolved('source_runtime_binding');
    const nativeNotes = new Map(runtime.notes.map(note => [note.note_id, note]));
    const written = new Map(score.notation.parts.flatMap(part => part.notes.map(note => [note.id, { note, part: part.id }])));
    if (nativeNotes.size !== runtime.notes.length) return unresolved('source_runtime_binding');
    for (const original of performance.notes) {
      const event = nativeNotes.get(original.note_id), notation = written.get(original.note_id), part = parts.get(original.part_id);
      const start = fraction(notation?.note.at), duration = fraction(notation?.note.duration);
      if (!event || !notation || !part || !start || !duration || duration[0] === 0n || notation.part !== part.id
        || event.part_id !== part.id || event.track_id !== part.track_id || event.channel !== part.channel
        || original.attack?.track !== part.track || original.release?.track !== part.track
        || event.event_id !== `midi:${score.source.sha256}:t${original.attack.track}:e${original.attack.event}`) return unresolved('source_runtime_binding');
      for (const [position, kind, beat, exact, ms] of [['attack', 'key_attack', start, 'start_microseconds', 'start_ms'], ['release', 'key_release', add(start, duration), 'end_microseconds', 'end_ms']]) {
        if (!append({ origin: original[position], beat }, { origin: event[position], exact_microseconds: event[exact], at_ms: event[ms] }, { kind, channel: part.channel })) return unresolved('source_runtime_binding');
      }
    }
    records.sort(order);
  }
  const counts = Array(tracks.length).fill(0), names = Array(tracks.length).fill(null), activity = Array(tracks.length).fill(false);
  const before = Array(tracks.length).fill(false), channelOwner = new Map();
  let name = null, anchor = [0n, 1n], elapsed = [0n, 1n], tempo = 500000n;
  for (const record of records) {
    const { origin, command, beat, time } = record, track = origin.track;
    if (origin.event !== counts[track]++) return unresolved('source_runtime_binding');
    const delta = [beat[0] * anchor[1] - anchor[0] * beat[1], beat[1] * anchor[1]];
    if (delta[0] < 0n || compare(add(elapsed, [delta[0] * tempo, delta[1]]), time) !== 0) return unresolved('source_runtime_binding');
    if (command.kind === 'tempo') {
      if (!integer(command.microseconds_per_quarter, strict ? 100000 : 1, strict ? 6000000 : 0xffffff)) return unresolved('source_runtime_binding');
      anchor = beat; elapsed = time; tempo = BigInt(command.microseconds_per_quarter);
    }
    if (isDeviceName(command)) {
      if (Object.keys(command).sort().join(',') !== 'kind,role,text' || typeof command.text !== 'string'
        || /^\p{White_Space}*$/u.test(command.text) || /[\p{Cc}\uD800-\uDFFF]/u.test(command.text)
        || new TextEncoder().encode(command.text).length > 4096
        || command.text.split('\n').some(line => line.replace(/^\p{White_Space}*/u, '').startsWith('DM:'))
        || /[A-Za-z0-9+/=]{257}/u.test(command.text)) return unresolved('empty_or_invalid_name');
      if (names[track] !== null) return unresolved('duplicate_name');
      if (beat[0] !== 0n || time[0] !== 0n || before[track]) return unresolved('late_name');
      if (name !== null && name !== command.text) return unresolved('multiple_names');
      names[track] = name = command.text;
    }
    if (command.kind === 'text' && command.role === 'program_name') before[track] = true;
    if (command.channel !== undefined) {
      if (!integer(command.channel, 0, 15)) return unresolved('source_runtime_binding');
      activity[track] = before[track] = true;
      if (channelOwner.has(command.channel) && channelOwner.get(command.channel) !== track) return unresolved('shared_channel');
      channelOwner.set(command.channel, track);
    }
  }
  if (counts.some((count, index) => count !== tracks[index].source_event_count)) return unresolved('source_runtime_binding');
  if (activity.some((active, index) => active && names[index] === null)) return unresolved('mixed_named_default_routes');
  return { logical_device_mapping: { device_name: name, receiver: 'wmh-procedural-reference-v1', policy: LOGICAL_DEVICE_POLICY }, blocker: null, reason: null };
}

export function withLogicalDevicePolicy(policy, mapping) {
  return mapping ? { ...policy, id: policy.id + LOGICAL_DEVICE_POLICY_SUFFIX, logical_device_mapping: mapping } : policy;
}
