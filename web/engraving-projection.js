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
    return {ok: true, document, sourceMeasureIndices, displayedSourceMeasureIndices, drawFromIndex: options.fromMeasure - context.fromMeasure, drawToIndex: options.toMeasure - context.fromMeasure, tieChains: context.tieChains, partIds: [...options.partIds], noteCount, paddingNoteCount};
  } catch (error) { return {ok: false, key: error.projectionKey || 'projection'}; }
}

/** Check the pinned reader before it allocates graphical layout for this view. */
export function validateEngravingProjectionModel(sheet, projection, score, limits) {
  try {
    const measures = sheet?.SourceMeasures, instruments = sheet?.Instruments;
    if (!Array.isArray(measures) || measures.length !== projection.sourceMeasureIndices.length ||
        !Array.isArray(instruments) || instruments.length !== projection.partIds.length ||
        instruments.some(instrument => !projection.partIds.includes(instrument.IdString))) fail();
    const fraction = value => {
      if (!value || ![value.WholeValue, value.Numerator, value.Denominator].every(Number.isSafeInteger) || value.WholeValue < 0 || value.Numerator < 0 || value.Denominator < 1) fail();
      return [4n * (BigInt(value.WholeValue) * BigInt(value.Denominator) + BigInt(value.Numerator)), BigInt(value.Denominator)];
    };
    const equal = (left, right) => left[0] * right[1] === right[0] * left[1];
    const rational = value => [BigInt(value.numerator), BigInt(value.denominator)];
    const base = rational(score.measures[projection.sourceMeasureIndices[0]].at), notes = new Set();
    for (const [index, measure] of measures.entries()) {
      const source = score.measures[projection.sourceMeasureIndices[index]], at = rational(source.at);
      if (!equal(fraction(measure.Duration), rational(source.length)) || !equal(fraction(measure.AbsoluteTimestamp), [at[0] * base[1] - base[0] * at[1], at[1] * base[1]])) fail();
      for (const container of measure.VerticalSourceStaffEntryContainers || []) for (const entry of container.StaffEntries || []) for (const voice of entry?.VoiceEntries || []) for (const note of voice.Notes || []) {
        notes.add(note); if (notes.size > limits.notes) fail('notes');
      }
    }
    if (notes.size !== projection.noteCount) fail();
    return {ok: true};
  } catch (error) { return {ok: false, key: error.projectionKey || 'projection'}; }
}
