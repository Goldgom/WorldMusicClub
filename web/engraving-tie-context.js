/** Resolve original tied-note context; never synthesize or rewrite a tie. */
const gcd = (a, b) => { while (b) { const rest = a % b; a = b; b = rest; } return a || 1n; };
const rational = value => [BigInt(value.numerator), BigInt(value.denominator)];
const add = (left, right) => [left[0] * right[1] + right[0] * left[1], left[1] * right[1]];
const fractionKey = value => { const divisor = gcd(value[0], value[1]); return `${value[0] / divisor}/${value[1] / divisor}`; };
const laneKey = segment => JSON.stringify([segment.xml_part_id, segment.staff, segment.xml_voice, segment.pitch?.step, segment.pitch?.alter, segment.pitch?.octave]);
const fail = () => { throw Object.assign(Error('A displayed tie requires unambiguous original context within the notation bounds.'), {projectionKey: 'tieContext'}); };

/** Input is the complete previously validated Rust segment map. */
export function resolveEngravingTieContext(validated, options, limits) {
  const starts = new Map(), ends = new Map(), selectedParts = new Set(options.partIds);
  const append = (map, key, segment) => { if (!map.has(key)) map.set(key, []); map.get(key).push(segment); };
  for (const segment of validated.segments) {
    if (!selectedParts.has(segment.xml_part_id) || !segment.pitch) continue;
    const lane = laneKey(segment), at = rational(segment.at), end = add(at, rational(segment.duration));
    append(starts, `${lane}:${fractionKey(at)}`, segment); append(ends, `${lane}:${fractionKey(end)}`, segment);
  }
  const adjacent = (segment, backwards) => {
    const at = rational(segment.at), time = backwards ? at : add(at, rational(segment.duration));
    const candidates = (backwards ? ends : starts).get(`${laneKey(segment)}:${fractionKey(time)}`)?.filter(other => backwards ? other.tie_start : other.tie_stop) || [];
    if (candidates.length !== 1) fail();
    return candidates[0];
  };
  let fromMeasure = options.fromMeasure, toMeasure = options.toMeasure;
  const chains = new Map(), covered = new Set();
  for (const segment of validated.segments) {
    if (covered.has(segment.xml_note_id) || !selectedParts.has(segment.xml_part_id) || segment.source_measure_index < options.fromMeasure - 1 || segment.source_measure_index >= options.toMeasure || !segment.tie_start && !segment.tie_stop) continue;
    let first = segment, steps = 0;
    while (first.tie_stop) { first = adjacent(first, true); if (++steps > validated.segments.length) fail(); }
    if (chains.has(first.xml_note_id)) continue;
    const chain = [first]; let next = first;
    while (next.tie_start) { next = adjacent(next, false); chain.push(next); if (chain.length > validated.segments.length) fail(); }
    if (chain.length < 2) fail();
    chains.set(first.xml_note_id, chain.map(note => note.xml_note_id));
    for (const note of chain) { covered.add(note.xml_note_id); fromMeasure = Math.min(fromMeasure, note.source_measure_index + 1); toMeasure = Math.max(toMeasure, note.source_measure_index + 1); }
    if (toMeasure - fromMeasure + 1 > limits.measuresPerView) fail();
  }
  return {fromMeasure, toMeasure, tieChains: [...chains.values()]};
}
