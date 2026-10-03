/** Three reviewed RPN 0 initializations. Every selector and repeated write is retained. */
export const INITIAL_SENSITIVITY12_KIND = 'initial_pitch_bend_sensitivity12';
const M = 'select_most_significant_zero', L = 'select_least_significant_zero';
const S = 'set_semitones12', C = 'set_cents_zero';
export const INITIAL_SENSITIVITY12_SEQUENCES = Object.freeze([
  Object.freeze([L, M, S, C]),
  Object.freeze([L, M, L, M, S, S, C, C]),
  Object.freeze([M, L, M, L, S, S, C, C]),
]);
const beforeKinds = new Set(['instrument_program', 'bank_select', 'volume', 'pan', 'expression', 'reverb_send', 'chorus_send']);
const integer = (n, lo, hi) => Number.isSafeInteger(n) && n >= lo && n <= hi;
const coordinate = origin => `${origin?.track}:${origin?.event}`;
const stable = value => JSON.stringify(value, (_, item) => item && !Array.isArray(item) && typeof item === 'object'
  ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b))) : item);
const exact = value => typeof value?.numerator === 'string' && Object.keys(value).sort().join(',') === 'denominator,numerator'
  && /^(0|[1-9][0-9]{0,19})$/.test(value.numerator)
  && integer(value.denominator, 1, 1000000) && BigInt(value.numerator) <= 18446744073709551615n;
const compareTime = (a, b) => {
  const left = BigInt(a.numerator) * BigInt(b.denominator), right = BigInt(b.numerator) * BigInt(a.denominator);
  return left < right ? -1 : left > right ? 1 : 0;
};
const order = (a, b) => compareTime(a.exact_microseconds, b.exact_microseconds)
  || a.origin.track - b.origin.track || a.origin.event - b.origin.event;
const matches = (steps, sequence) => steps.length === sequence.length && steps.every((step, index) => step === sequence[index]);
const beat = value => integer(value?.numerator, 0, 1000000000) && Object.keys(value).sort().join(',') === 'denominator,numerator'
  && integer(value.denominator, 1, 1000000) ? { numerator: String(value.numerator), denominator: value.denominator } : null;
function addBeats(left, right) {
  const n = BigInt(left.numerator) * BigInt(right.denominator) + BigInt(right.numerator) * BigInt(left.denominator);
  const d = BigInt(left.denominator) * BigInt(right.denominator);
  let a = n, b = d;
  while (b) [a, b] = [b, a % b];
  const result = { numerator: String(n / a), denominator: Number(d / a) };
  return exact(result) ? result : null;
}
/** Verify only native tempo anchors and initialization clocks; playback always
 * uses the original Rust runtime, never a JavaScript-derived replacement. */
function validSetupClocks(source, runtime) {
  let anchor = { numerator: '0', denominator: 1 }, elapsed = { numerator: '0', denominator: 1 }, tempo = 500000;
  for (let index = 0; index < source.length; index++) {
    const event = source[index], at = event.exact_microseconds, command = event.command;
    if (![INITIAL_SENSITIVITY12_KIND, 'tempo'].includes(command.kind)) continue;
    const delta = BigInt(at.numerator) * BigInt(anchor.denominator) - BigInt(anchor.numerator) * BigInt(at.denominator);
    const deltaDenominator = BigInt(at.denominator) * BigInt(anchor.denominator);
    const numerator = BigInt(elapsed.numerator) * deltaDenominator + delta * BigInt(tempo) * BigInt(elapsed.denominator);
    const denominator = BigInt(elapsed.denominator) * deltaDenominator, actual = runtime[index].exact_microseconds;
    if (delta < 0n || numerator * BigInt(actual.denominator) !== BigInt(actual.numerator) * denominator) return false;
    if (command.kind === 'tempo') {
      if (!integer(command.microseconds_per_quarter, 100000, 6000000)) return false;
      anchor = at; elapsed = actual; tempo = command.microseconds_per_quarter;
    }
  }
  return true;
}
const validEvent = event => exact(event.exact_microseconds)
  && integer(event.origin?.track, 0, 127) && integer(event.origin?.event, 0, 249999)
  && Object.keys(event.origin).sort().join(',') === 'event,track';
function validOrderedEvents(events) {
  return events.every((event, index) => validEvent(event) && (index === 0 || order(events[index - 1], event) < 0));
}
/** Complete source events, including key activity and metadata. No reordering repairs input. */
export function validInitialSensitivity12Events(events) {
  const setup = events.filter(event => event.command?.kind === INITIAL_SENSITIVITY12_KIND);
  if (!setup.length) return true;
  if (!validOrderedEvents(events) || events.some(event => event.command?.kind === 'pitch_bend')) return false;
  const coordinates = new Set(), priorOrigins = new Map();
  for (const event of events) {
    if (coordinates.has(coordinate(event.origin)) || (priorOrigins.get(event.origin.track) ?? -1) >= event.origin.event) return false;
    coordinates.add(coordinate(event.origin)); priorOrigins.set(event.origin.track, event.origin.event);
  }
  for (const event of setup) {
    if (Object.keys(event.command).sort().join(',') !== 'channel,kind,step'
      || !integer(event.command.channel, 0, 15)) return false;
  }
  for (const channel of new Set(setup.map(event => event.command.channel))) {
    const activity = events.filter(event => event.command?.channel === channel);
    const start = activity.findIndex(event => event.command.kind === INITIAL_SENSITIVITY12_KIND);
    const group = activity.filter(event => event.command.kind === INITIAL_SENSITIVITY12_KIND), first = group[0];
    if (!INITIAL_SENSITIVITY12_SEQUENCES.some(sequence => matches(group.map(event => event.command.step), sequence))
      || activity.some(event => event.origin.track !== first.origin.track || event.command.kind === 'initial_controller_reset')
      || activity.slice(0, start).some(event => !beforeKinds.has(event.command.kind))
      || group.some((event, index) => activity[start + index] !== event || event.origin.event !== first.origin.event + index)) return false;
  }
  return true;
}
/** Strict songs split keys from commands; restore only their existing source coordinates. */
export function validInitialSensitivity12Song(song) {
  const runtime = song.runtime.events, source = song.score.performance.events;
  if (![...runtime, ...source].some(event => event.command.kind === INITIAL_SENSITIVITY12_KIND)) return true;
  if (runtime.length !== source.length || !validOrderedEvents(runtime)) return false;
  // The same ordering check works in source Beat units before the native clock.
  const sourceEvents = source.map(event => ({ ...event, exact_microseconds: beat(event.at) }));
  if (!validOrderedEvents(sourceEvents)) return false;
  for (let index = 0; index < runtime.length; index++) {
    const event = runtime[index], original = source[index];
    if (coordinate(event.origin) !== coordinate(original.origin)
      || stable(event.command) !== stable(original.command)) return false;
  }
  if (!validSetupClocks(sourceEvents, runtime)) return false;
  const sourceNotes = new Map(song.score.performance.notes.map(note => [note.note_id, note]));
  if (song.runtime.notes.some(note => coordinate(note.attack) !== coordinate(sourceNotes.get(note.note_id)?.attack)
    || coordinate(note.release) !== coordinate(sourceNotes.get(note.note_id)?.release))) return false;
  const writtenNotes = new Map(song.score.notation.parts.flatMap(part => part.notes.map(note => [note.id, { note, partId: part.id }])));
  const sourceParts = new Map(song.score.performance.parts.map(part => [part.id, part]));
  const sourceActivity = [...sourceEvents];
  for (const note of sourceNotes.values()) {
    const written = writtenNotes.get(note.note_id), part = sourceParts.get(note.part_id);
    if (!written || !part || !integer(part.channel, 0, 15) || written.partId !== note.part_id) return false;
    const start = beat(written.note.at), duration = beat(written.note.duration);
    if (!start || !duration || BigInt(duration.numerator) === 0n) return false;
    const end = addBeats(start, duration);
    if (!end) return false;
    sourceActivity.push(
      { origin: note.attack, exact_microseconds: start, command: { kind: 'key_attack', channel: part.channel } },
      { origin: note.release, exact_microseconds: end, command: { kind: 'key_release', channel: part.channel } },
    );
  }
  const notes = song.runtime.notes.flatMap(note => [
    { origin: note.attack, exact_microseconds: note.start_microseconds, at_ms: note.start_ms, command: { kind: 'key_attack', channel: note.channel } },
    { origin: note.release, exact_microseconds: note.end_microseconds, at_ms: note.end_ms, command: { kind: 'key_release', channel: note.channel } },
  ]);
  const events = [...runtime, ...notes];
  if (sourceActivity.some(event => !validEvent(event)) || events.some(event => !validEvent(event) || !Number.isFinite(event.at_ms)
    || Math.abs(event.at_ms - Number(event.exact_microseconds.numerator) / event.exact_microseconds.denominator / 1000) > Math.max(1e-7, Math.abs(event.at_ms) * 1e-12))) return false;
  return validInitialSensitivity12Events(events.sort(order)) && validInitialSensitivity12Events(sourceActivity.sort(order));
}
export const centeredPitchState = () => ({ pitch_bend: 0, sensitivity_semitones: 2, sensitivity_cents: 0,
  rpn_most_significant: 127, rpn_least_significant: 127 });
export function applyInitialSensitivity12(state, step) {
  const steps = [...(state.sensitivity12_steps ?? []), step];
  if (!INITIAL_SENSITIVITY12_SEQUENCES.some(sequence => steps.length <= sequence.length && steps.every((item, index) => item === sequence[index]))) {
    throw new Error('Invalid initial twelve-semitone pitch-bend sensitivity order');
  }
  if (step === M) state.rpn_most_significant = 0;
  else if (step === L) state.rpn_least_significant = 0;
  else if (step === S) state.sensitivity_semitones = 12;
  else if (step === C) state.sensitivity_cents = 0;
  state.sensitivity12_steps = steps;
}
export function unbentReferenceKey12(state, key) {
  if (state.pitch_bend !== 0 || (state.sensitivity12_steps !== undefined
    && (!INITIAL_SENSITIVITY12_SEQUENCES.some(sequence => matches(state.sensitivity12_steps, sequence))
      || state.sensitivity_semitones !== 12 || state.sensitivity_cents !== 0
      || state.rpn_most_significant !== 0 || state.rpn_least_significant !== 0))) throw new Error('Unsupported pitch-bend state');
  return key + state.pitch_bend * (state.sensitivity_semitones + state.sensitivity_cents / 100);
}
