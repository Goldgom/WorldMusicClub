// The only supported absolute origin is zero. The rate identity stays explicit;
// playback remains relative PPQ time, with no external timecode synchronization.
const fields = ['frame_rate', 'hours', 'minutes', 'seconds', 'frames', 'fractional_frames'];
const rates = new Set(['fps24', 'fps25', 'drop_frame30', 'fps30']);
export function isZeroSmpteOffset(command) {
  const t = command?.timecode;
  return command?.kind === 'smpte_offset' && Object.keys(command).length === 2 &&
    t && Object.keys(t).length === fields.length && fields.every(f => Object.hasOwn(t, f)) &&
    rates.has(t.frame_rate) && fields.slice(1).every(f => t[f] === 0);
}
export function hasValidZeroSmpteOffsets(runtime) {
  let seen = false;
  for (const event of runtime.events) {
    if (event.command.kind === 'smpte_offset') {
      if (!isZeroSmpteOffset(event.command) || seen || event.origin.track !== 0 ||
          event.at_ms !== 0 || event.exact_microseconds?.numerator !== '0' ||
          !Number.isSafeInteger(event.exact_microseconds?.denominator) ||
          event.exact_microseconds.denominator < 1 || event.exact_microseconds.denominator > 1000000 ||
          runtime.events.some(other => other.origin.track === 0 && other.command.channel !== undefined && other.origin.event < event.origin.event) || runtime.notes.some(note =>
            [note.attack, note.release].some(origin => origin.track === 0 && origin.event < event.origin.event))) return false;
      seen = true;
    }
  }
  return true;
}
