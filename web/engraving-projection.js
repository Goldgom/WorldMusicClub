/** Bounded, disposable notation view. Never edit the Rust score, export or identity map. */
import {resolveEngravingTieContext} from './engraving-tie-context.js';
export const ENGRAVING_SOURCE_LIMITS = Object.freeze({notes: 8192, mapBytes: 4 * 1024 * 1024});
const children = (node, name) => Array.from(node?.children || []).filter(child => child.localName === name);
const one = (node, name) => children(node, name)[0];
const text = (node, name, fallback) => one(node, name)?.textContent.trim() || fallback;
const fail = (key = 'projection') => { throw Object.assign(Error('The exact notation projection is unsupported.'), {projectionKey: key}); };
const integer = value => { if (!/^\d+$/.test(String(value)) || !Number.isSafeInteger(Number(value))) fail(); return Number(value); };
const ticks = (fraction, divisions) => {
  const numerator = BigInt(fraction.numerator) * BigInt(divisions), denominator = BigInt(fraction.denominator);
  if (numerator <= 0n || denominator <= 0n || numerator % denominator || numerator / denominator > 1000000000n) fail();
  return Number(numerator / denominator);
};
const stateKey = node => `${node.localName}:${node.getAttribute('number') || ''}`;
const attributeOrder = ['divisions', 'key', 'time', 'staves', 'clef', 'staff-details', 'transpose', 'measure-style'];
const projectionProofs = new WeakMap();
const gcd = (a, b) => { while (b) [a, b] = [b, a % b]; return a; };
const rational = value => [BigInt(value.numerator), BigInt(value.denominator)];
const equal = (left, right) => left[0] * right[1] === right[0] * left[1];
const add = (left, right) => [left[0] * right[1] + right[0] * left[1], left[1] * right[1]];
const fractionKey = value => { const divisor = gcd(value[0], value[1]); return `${value[0] / divisor}/${value[1] / divisor}`; };
const modelFraction = value => {
  if (!value || ![value.WholeValue, value.Numerator, value.Denominator].every(Number.isSafeInteger) || value.WholeValue < 0 || value.Numerator < 0 || value.Denominator < 1) fail();
  return [4n * (BigInt(value.WholeValue) * BigInt(value.Denominator) + BigInt(value.Numerator)), BigInt(value.Denominator)];
};
const noteKey = (part, measure, staff, voice, at, length, pitch, printed) => JSON.stringify([part, measure, staff, voice, fractionKey(at), fractionKey(length), pitch, printed]);
const countKey = (map, key) => map.set(key, (map.get(key) || 0) + 1);

// Snapshot exact original + generated-rest tuples before third-party parsing.
// A public projection or mutable DOM alone cannot authorize a model repair.
function rememberProjection(projection, score) {
  const notes = new Map(), meters = [];
  for (const part of children(projection.document.documentElement, 'part')) {
    let divisions, meter;
    for (const [index, measure] of children(part, 'measure').entries()) {
      let cursor = 0, at = 0;
      for (const node of Array.from(measure.children)) {
        if (node.localName === 'attributes' && one(node, 'divisions')) divisions = integer(text(node, 'divisions'));
        if (node.localName === 'attributes' && one(node, 'time')) {
          const time = one(node, 'time');
          meter = one(time, 'beats') && one(time, 'beat-type') ? [integer(text(time, 'beats')), integer(text(time, 'beat-type'))] : null;
        }
        if (node.localName === 'backup') cursor -= integer(text(node, 'duration'));
        if (node.localName !== 'note') continue;
        const duration = integer(text(node, 'duration')), pitch = one(node, 'pitch');
        if (!one(node, 'chord')) { at = cursor; cursor += duration; }
        countKey(notes, noteKey(part.getAttribute('id'), index, integer(text(node, 'staff', '1')), text(node, 'voice', '1'), [BigInt(at), BigInt(divisions)], [BigInt(duration), BigInt(divisions)], pitch ? [text(pitch, 'step'), Number(text(pitch, 'alter', '0')), Number(text(pitch, 'octave'))] : null, node.getAttribute('print-object') !== 'no'));
      }
      // The pinned reader chooses the first largest active instrument meter,
      // retaining its unreduced source numerator and denominator.
      if (meter && (!meters[index] || meter[0] * meters[index][1] > meters[index][0] * meter[1])) meters[index] = [...meter];
    }
  }
  projectionProofs.set(projection, {score, notes, meters, measures: projection.sourceMeasureIndices.map(index => ({at: rational(score.measures[index].at), length: rational(score.measures[index].length)}))});
}

/** The complete original XML and manifest MUST be validated before calling this. */
export function createEngravingProjection(source, validated, options, limits) {
  try {
    if (!validated.ok) fail();
    const context = resolveEngravingTieContext(validated, options, limits);
    const document = source.cloneNode(true), root = document.documentElement;
    const selected = new Set(options.partIds), sourceMeasureIndices = Array.from({length: context.toMeasure - context.fromMeasure + 1}, (_, index) => context.fromMeasure - 1 + index);
    const displayedSourceMeasureIndices = Array.from({length: options.toMeasure - options.fromMeasure + 1}, (_, index) => options.fromMeasure - 1 + index);
    for (const part of children(root, 'part')) if (!selected.has(part.getAttribute('id'))) part.remove();
    for (const part of children(one(root, 'part-list'), 'score-part')) if (!selected.has(part.getAttribute('id'))) part.remove();
    let noteCount = 0, paddingNoteCount = 0;
    const countNote = () => { if (++noteCount > limits.notes) fail('notes'); };
    for (const part of children(root, 'part')) {
      const measures = children(part, 'measure'), inherited = new Map();
      for (const measure of measures.slice(0, context.fromMeasure - 1)) for (const attributes of children(measure, 'attributes')) for (const attribute of Array.from(attributes.children)) inherited.set(stateKey(attribute), attribute);
      for (const [index, measure] of measures.entries()) if (!sourceMeasureIndices.includes(index)) measure.remove();
      const retained = children(part, 'measure');
      if (retained.length !== sourceMeasureIndices.length) fail();
      if (inherited.size) {
        // The pinned reader may retain the first clef when two initial
        // attributes elements disagree. Merge effective initial state once,
        // letting the selected measure's own changes override inheritance.
        for (const node of Array.from(retained[0].children)) {
          if (['note', 'forward', 'backup'].includes(node.localName)) break;
          if (node.localName !== 'attributes') continue;
          for (const attribute of Array.from(node.children)) inherited.set(stateKey(attribute), attribute);
          node.remove();
        }
        const attributes = document.createElement('attributes');
        for (const name of attributeOrder) for (const value of inherited.values()) if (value.localName === name) attributes.appendChild(value.cloneNode(true));
        retained[0].insertBefore(attributes, retained[0].firstChild);
      }
      const usedVoices = new Set(validated.segments.filter(segment => segment.xml_part_id === part.getAttribute('id')).map(segment => segment.xml_voice));
      let paddingVoice = 1; while (usedVoices.has(String(paddingVoice)) && paddingVoice <= 2000) paddingVoice++;
      if (paddingVoice > 2000) fail();
      let divisions;
      for (const [localIndex, measure] of retained.entries()) {
        const nodes = Array.from(measure.children), initial = nodes.find(node => node.localName === 'attributes' && one(node, 'divisions'));
        if (initial) divisions = integer(text(initial, 'divisions'));
        if (!divisions || divisions > 1000000) fail();
        // Rust emits one exact grid. A mid-measure grid change is never guessed.
        if (nodes.some(node => node.localName === 'attributes' && one(node, 'divisions') && integer(text(node, 'divisions')) !== divisions)) fail();
        const length = ticks(validated.score.measures[sourceMeasureIndices[localIndex]].length, divisions);
        const addPadding = (amount, voice, staff, before) => {
          // Long gaps use bounded whole-note pieces. A residual retains its exact
          // duration/divisions; no type/tuplet spelling or rounding is introduced.
          // VexFlowConverter.durations has a strict >1e-4 whole-note floor.
          if (amount > 0 && amount * 10000 <= 4 * divisions) fail('exactRhythm');
          while (amount > 0) {
            let duration = Math.min(amount, 4 * divisions);
            // Avoid leaving an otherwise unrenderable residual after a whole
            // note: redistribute exact integer ticks into two safe pieces.
            if (amount > duration && (amount - duration) * 10000 <= 4 * divisions) duration = Math.floor(duration / 2);
            if (duration * 10000 <= 4 * divisions) fail('exactRhythm');
            countNote(); paddingNoteCount++;
            const rest = document.createElement('note'); rest.setAttribute('print-object', 'no'); rest.setAttribute('print-spacing', 'yes');
            rest.appendChild(document.createElement('rest'));
            for (const [name, value] of [['duration', duration], ['voice', voice], ['staff', staff]]) { const node = document.createElement(name); node.textContent = String(value); rest.appendChild(node); }
            measure.insertBefore(rest, before); amount -= duration;
          }
        };
        // Each backup delimits a Rust engraving lane. Look ahead to its first
        // explicit identity so leading silence belongs to the correct staff/voice.
        const blocks = [[]];
        for (const node of nodes) { blocks.at(-1).push(node); if (node.localName === 'backup') blocks.push([]); }
        let cursor = 0;
        for (const block of blocks) {
          const identified = block.find(node => (node.localName === 'note' || node.localName === 'forward') && one(node, 'voice'));
          const voice = text(identified, 'voice', String(paddingVoice)), staff = text(identified, 'staff', '1');
          for (const node of block) {
            // OSMD hoists interior key/time changes to the measure start.
            // Preserve the source and decline this view instead of moving them.
            if (node.localName === 'attributes' && cursor !== 0) fail();
            if (node.localName === 'note') {
              countNote();
              if (text(node, 'voice', voice) !== voice || text(node, 'staff', staff) !== staff) fail();
              if (!one(node, 'chord')) cursor += integer(text(node, 'duration'));
            } else if (node.localName === 'forward') {
              const duration = integer(text(node, 'duration'));
              if (text(node, 'voice', voice) !== voice || text(node, 'staff', staff) !== staff) fail();
              addPadding(duration, voice, staff, node); node.remove(); cursor += duration;
            } else if (node.localName === 'backup') {
              const duration = integer(text(node, 'duration'));
              // Canonical lane switches return to the beginning. Other cursor
              // programs need a separate faithful projection, not reinterpretation.
              if (duration !== cursor) fail();
              addPadding(length - cursor, voice, staff, node);
              one(node, 'duration').textContent = String(length); cursor = 0;
            }
            if (cursor > length) fail();
          }
          if (!block.some(node => node.localName === 'backup')) addPadding(length - cursor, voice, staff, null);
        }
      }
    }
    const elements = [];
    const visit = (node, depth) => { if (depth > limits.depth) fail('depth'); if (elements.push(node) > limits.elements) fail('elements'); for (const child of Array.from(node.children || [])) visit(child, depth + 1); };
    visit(root, 1);
    const Serializer = source.defaultView?.XMLSerializer || globalThis.XMLSerializer;
    const xml = Serializer ? new Serializer().serializeToString(document) : document.toString();
    if (typeof xml !== 'string' || !xml.trimStart().startsWith('<')) fail();
    if (new TextEncoder().encode(xml).byteLength > limits.xmlBytes) fail('xmlLimit');
    const projection = {ok: true, document, sourceMeasureIndices, displayedSourceMeasureIndices, drawFromIndex: options.fromMeasure - context.fromMeasure, drawToIndex: options.toMeasure - context.fromMeasure, tieChains: context.tieChains, partIds: [...options.partIds], noteCount, paddingNoteCount};
    rememberProjection(projection, validated.score);
    return projection;
  } catch (error) { return {ok: false, key: error.projectionKey || 'projection'}; }
}

/**
 * OSMD 2.1.3 checkFractionsForEquivalence expands a short 1/3 whole-note
 * duration by 4/3 to match a 4/4 denominator, yielding 1.3333333333333333/4.
 * Recover only that documented reader operation, after every model note/rest
 * agrees exactly with the private projection snapshot. Never infer a rational
 * from a float, alter a note, or permit a tolerance in the strict model guard.
 */
export function restoreSourceBoundProjectionFractions(sheet, projection, score, limits) {
  try {
    if (validateEngravingProjectionModel(sheet, projection, score, limits).ok) return {ok: true};
    const proof = projectionProofs.get(projection), measures = sheet?.SourceMeasures, instruments = sheet?.Instruments;
    if (!proof || proof.score !== score || !Array.isArray(measures) || measures.length !== proof.measures.length ||
        !Array.isArray(instruments) || instruments.length !== projection.partIds.length ||
        instruments.some(instrument => !projection.partIds.includes(instrument.IdString))) fail();
    const notes = new Set(), actual = new Map(), ends = measures.map(() => new Map());
    for (const [index, measure] of measures.entries()) for (const container of measure.VerticalSourceStaffEntryContainers || []) for (const entry of container.StaffEntries || []) for (const voice of entry?.VoiceEntries || []) for (const note of voice.Notes || []) {
      if (notes.has(note)) continue;
      notes.add(note); if (notes.size > limits.notes) fail('notes');
      const staff = note.ParentStaff, instrument = staff?.ParentInstrument, staffIndex = instrument?.Staves?.indexOf(staff), pitch = note.isRest() ? null : note.Pitch;
      if (note.SourceMeasure !== measure || note.ParentVoiceEntry !== voice || !instruments.includes(instrument) || !Number.isSafeInteger(staffIndex) || staffIndex < 0 ||
          (pitch && (pitch.constructor.OctaveXmlDifference !== 3 || ![0, 2, 4, 5, 7, 9, 11].includes(pitch.FundamentalNote)))) fail();
      const at = modelFraction(voice.Timestamp), length = modelFraction(note.Length), end = add(at, length), last = ends[index].get(instrument.IdString);
      if (!last || end[0] * last[1] > last[0] * end[1]) ends[index].set(instrument.IdString, end);
      countKey(actual, noteKey(instrument.IdString, index, staffIndex + 1, String(voice.ParentVoice.VoiceId), at, length,
        pitch ? [['C', 'D', 'E', 'F', 'G', 'A', 'B'][[0, 2, 4, 5, 7, 9, 11].indexOf(pitch.FundamentalNote)], pitch.AccidentalHalfTones, pitch.Octave + 3] : null, note.PrintObject === true));
    }
    if (notes.size !== projection.noteCount || actual.size !== proof.notes.size || [...actual].some(([key, count]) => proof.notes.get(key) !== count)) fail();
    const Fraction = measures[0]?.Duration?.constructor;
    if (typeof Fraction !== 'function' || Fraction.maximumAllowedNumber !== 46340) fail();
    const exact = quarter => {
      let numerator = quarter[0], denominator = quarter[1] * 4n;
      const divisor = gcd(numerator, denominator); numerator /= divisor; denominator /= divisor;
      const whole = numerator / denominator; numerator %= denominator;
      if (numerator < 0n || numerator > 46340n || denominator > 46340n || whole > BigInt(Number.MAX_SAFE_INTEGER)) fail();
      return new Fraction(Number(numerator), Number(denominator), Number(whole), false);
    };
    const sameRaw = (left, right) => ['WholeValue', 'Numerator', 'Denominator', 'RealValue'].every(key => Object.is(left[key], right[key]));
    const pending = [], base = proof.measures[0].at;
    let readerClock = new Fraction(0, 1), clockRepair = false;
    for (const [index, measure] of measures.entries()) {
      const source = proof.measures[index], current = score.measures[projection.sourceMeasureIndices[index]], duration = measure.Duration, timestamp = measure.AbsoluteTimestamp;
      if (!current || !equal(source.at, rational(current.at)) || !equal(source.length, rational(current.length)) ||
          instruments.some(instrument => !equal(ends[index].get(instrument.IdString) || [0n, 1n], source.length)) ||
          duration.constructor !== Fraction || timestamp.constructor !== Fraction) fail();
      const expected = exact(source.length), expectedAt = exact([source.at[0] * base[1] - base[0] * source.at[1], source.at[1] * base[1]]);
      let durationExact = false, timestampExact = false;
      try { durationExact = equal(modelFraction(duration), source.length); } catch { /* Only the pinned expansion below can recover this. */ }
      try { timestampExact = equal(modelFraction(timestamp), modelFraction(expectedAt)); } catch { /* Verify the complete original reader clock below. */ }
      if (!timestampExact) {
        if (!clockRepair || !sameRaw(timestamp, readerClock)) fail();
        pending.push([measure, 'AbsoluteTimestamp', expectedAt]);
      }
      if (!durationExact) {
        const meter = measure.ActiveTimeSignature, expanded = expected.clone();
        modelFraction(meter); // No floating or malformed meter can authorize repair.
        if (!proof.meters[index] || meter.WholeValue !== 0 || meter.Numerator !== proof.meters[index][0] || meter.Denominator !== proof.meters[index][1]) fail();
        if (!expected.lt(meter) || meter.Denominator <= expected.Denominator) fail();
        expanded.expand(meter.Denominator / expected.Denominator);
        if (Number.isSafeInteger(expanded.Numerator) || !sameRaw(duration, expanded)) fail();
        pending.push([measure, 'Duration', expected]); clockRepair = true;
      }
      readerClock.Add(duration);
    }
    // All checks precede writes; a mismatched later bar cannot leave a partial repair.
    for (const [measure, field, value] of pending) measure[field] = value;
    return {ok: true};
  } catch (error) { return {ok: false, key: error.projectionKey || 'projection'}; }
}

/** Check the pinned reader before it allocates graphical layout for this view. */
export function validateEngravingProjectionModel(sheet, projection, score, limits) {
  try {
    const measures = sheet?.SourceMeasures, instruments = sheet?.Instruments;
    if (!Array.isArray(measures) || measures.length !== projection.sourceMeasureIndices.length ||
        !Array.isArray(instruments) || instruments.length !== projection.partIds.length ||
        instruments.some(instrument => !projection.partIds.includes(instrument.IdString))) fail();
    const base = rational(score.measures[projection.sourceMeasureIndices[0]].at), notes = new Set();
    for (const [index, measure] of measures.entries()) {
      const source = score.measures[projection.sourceMeasureIndices[index]], at = rational(source.at);
      if (!equal(modelFraction(measure.Duration), rational(source.length)) || !equal(modelFraction(measure.AbsoluteTimestamp), [at[0] * base[1] - base[0] * at[1], at[1] * base[1]])) fail();
      for (const container of measure.VerticalSourceStaffEntryContainers || []) for (const entry of container.StaffEntries || []) for (const voice of entry?.VoiceEntries || []) for (const note of voice.Notes || []) {
        notes.add(note); if (notes.size > limits.notes) fail('notes');
      }
    }
    if (notes.size !== projection.noteCount) fail();
    return {ok: true};
  } catch (error) { return {ok: false, key: error.projectionKey || 'projection'}; }
}
