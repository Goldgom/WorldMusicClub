/** Source-bound presentation fragments; production selects only the noncrossing class. */
import {resolveEngravingTieContext} from './engraving-tie-context.js';

const children = (node, name) => Array.from(node?.children || []).filter(child => !name || child.localName === name);
const one = (node, name) => children(node, name)[0];
const text = (node, name, fallback) => one(node, name)?.textContent.trim() || fallback;
const fail = (key = 'fragmentProjection') => { throw Object.assign(Error('Exact presentation fragments are unsupported.'), {projectionKey: key}); };
const integer = value => { const result = Number(value); if (!Number.isSafeInteger(result) || result < 0) fail(); return result; };
const rat = value => [BigInt(value.numerator), BigInt(value.denominator)];
const add = (a, b) => [a[0] * b[1] + b[0] * a[1], a[1] * b[1]];
const sub = (a, b) => [a[0] * b[1] - b[0] * a[1], a[1] * b[1]];
const equal = (a, b) => a[0] * b[1] === b[0] * a[1];
const compare = (a, b) => a[0] * b[1] - b[0] * a[1];
const gcd = (a, b) => { while (b) [a, b] = [b, a % b]; return a; };
const key = value => { const divisor = gcd(value[0], value[1]); return `${value[0] / divisor}/${value[1] / divisor}`; };
const publicFraction = value => { const divisor = gcd(value[0], value[1]); return Object.freeze({numerator: Number(value[0] / divisor), denominator: Number(value[1] / divisor)}); };
const ticks = (value, divisions) => {
  const numerator = value[0] * BigInt(divisions);
  if (value[1] <= 0n || numerator < 0n || numerator % value[1] || numerator / value[1] > 1000000000n) fail();
  return Number(numerator / value[1]);
};
const modelFraction = value => {
  if (!value || ![value.WholeValue, value.Numerator, value.Denominator].every(Number.isSafeInteger) || value.WholeValue < 0 || value.Numerator < 0 || value.Denominator < 1) fail();
  return [4n * (BigInt(value.WholeValue) * BigInt(value.Denominator) + BigInt(value.Numerator)), BigInt(value.Denominator)];
};
const attributeOrder = ['divisions', 'key', 'time', 'staves', 'clef', 'staff-details', 'transpose', 'measure-style'];
const stateKey = node => `${node.localName}:${node.getAttribute('number') || ''}`;
const proofs = new WeakMap();
const tuple = note => JSON.stringify([note.xml_part_id, note.fragment_index, note.staff, note.xml_voice, key(rat(note.fragment_at)), key(rat(note.duration)), note.pitch ? [note.pitch.step, note.pitch.alter, note.pitch.octave] : null, note.printed]);
const freeze = value => Object.freeze(value);
const childValue = (document, name, value) => { const node = document.createElement(name); node.textContent = String(value); return node; };
const serializeDocument = document => {
  const Serializer = document.defaultView?.XMLSerializer || globalThis.XMLSerializer;
  return Serializer ? new Serializer().serializeToString(document) : document.toString();
};
const serializeElement = node => { if (typeof node.outerHTML !== 'string') fail(); return node.outerHTML; };

function readPart(part, score) {
  const state = new Map(), measures = [], writtenKeys = [];
  let divisions;
  for (const [index, measure] of children(part, 'measure').entries()) {
    let cursor = 0;
    const initial = new Map(state), keys = [], directions = [];
    for (const node of children(measure)) {
      if (node.localName === 'attributes') {
        if (one(node, 'divisions')) {
          if (cursor !== 0) fail();
          divisions = integer(text(node, 'divisions'));
        }
        for (const attribute of children(node)) {
          if (cursor !== 0 && attribute.localName !== 'key') fail();
          if (attribute.localName === 'key') {
            const fifths = Number(text(attribute, 'fifths')), mode = text(attribute, 'mode', 'major');
            if (!Number.isSafeInteger(fifths) || fifths < -7 || fifths > 7 || !['major','minor'].includes(mode) || attribute.hasAttribute('number')) fail();
            const at = add(rat(score.measures[index].at), [BigInt(cursor), BigInt(divisions)]);
            const canonical = score.keys?.filter(event => compare(rat(event.at), at) <= 0n).at(-1);
            if (!canonical || canonical.fifths !== fifths || canonical.mode !== mode || (cursor && !equal(rat(canonical.at), at))) fail('fragmentKeyIdentity');
            writtenKeys.push({at, fifths, mode});
            keys.push({at: cursor, node: attribute, fifths, mode});
          }
          state.set(stateKey(attribute), attribute);
          if (!cursor) initial.set(stateKey(attribute), attribute);
        }
      } else if (node.localName === 'note') {
        if (!one(node, 'chord')) cursor += integer(text(node, 'duration'));
      } else if (node.localName === 'forward') cursor += integer(text(node, 'duration'));
      else if (node.localName === 'backup') cursor -= integer(text(node, 'duration'));
      else if (node.localName === 'direction') {
        const offset = Number(text(node, 'offset', '0'));
        if (!Number.isSafeInteger(offset)) fail();
        directions.push({at: cursor + offset, node});
      } else if (!['barline', 'print'].includes(node.localName)) fail();
      if (!divisions || divisions > 2048 || cursor < 0) fail();
    }
    const length = ticks(rat(score.measures[index].length), divisions);
    if (cursor !== length || keys.some(event => event.at >= length) || directions.some(event => event.at < 0 || event.at >= length)) fail();
    measures.push({node: measure, initial, keys, directions, divisions, length});
  }
  const end = add(rat(score.measures.at(-1).at), rat(score.measures.at(-1).length));
  for (const canonical of score.keys || []) if (compare(rat(canonical.at), rat(score.measures[0].at)) >= 0n && compare(rat(canonical.at), end) < 0n &&
      !writtenKeys.some(event => equal(event.at, rat(canonical.at)) && event.fifths === canonical.fifths && event.mode === canonical.mode)) fail('fragmentKeyIdentity');
  return measures;
}

/**
 * Caller supplies the complete validated canonical export.
 * Original measure/segment identities remain authoritative. Fragment indices
 * describe only this disposable engraving document, never new source measures.
 */
export function createEngravingMeasureFragments(source, validated, options, limits) {
  try {
    if (!validated.ok) fail();
    const context = resolveEngravingTieContext(validated, options, limits), score = validated.score;
    const document = source.cloneNode(true), root = document.documentElement, selected = new Set(options.partIds);
    for (const part of children(root, 'part')) if (!selected.has(part.getAttribute('id'))) part.remove();
    for (const part of children(one(root, 'part-list'), 'score-part')) if (!selected.has(part.getAttribute('id'))) part.remove();
    const parts = children(root, 'part'), models = new Map(parts.map(part => [part.getAttribute('id'), readPart(part, score)]));
    const measureFragments = [], noteFragments = [], expected = [], coverage = new Map(), sourceMeasureIndices = [];
    for (let sourceIndex = context.fromMeasure - 1; sourceIndex < context.toMeasure; sourceIndex++) {
      sourceMeasureIndices.push(sourceIndex);
      const cuts = new Map([['0/1', [0n, 1n]], [key(rat(score.measures[sourceIndex].length)), rat(score.measures[sourceIndex].length)]]);
      for (const model of models.values()) for (const event of model[sourceIndex].keys) cuts.set(key([BigInt(event.at), BigInt(model[sourceIndex].divisions)]), [BigInt(event.at), BigInt(model[sourceIndex].divisions)]);
      const sorted = [...cuts.values()].sort((a, b) => Number(compare(a, b)));
      for (const cut of sorted.slice(1, -1)) {
        const at = add(rat(score.measures[sourceIndex].at), cut);
        for (const part of score.parts) if (selected.has(validated.partIdMap[part.id]) && part.notes.some(note => note.pitch && compare(rat(note.at), at) < 0n && compare(add(rat(note.at), rat(note.duration)), at) > 0n)) fail('fragmentSustainedNote');
      }
      const sourceImplicit = models.values().next().value[sourceIndex].node.getAttribute('implicit') === 'yes';
      if ([...models.values()].some(model => (model[sourceIndex].node.getAttribute('implicit') === 'yes') !== sourceImplicit)) fail();
      for (let index = 0; index + 1 < sorted.length; index++) measureFragments.push(freeze({fragment_index: measureFragments.length, source_measure_index: sourceIndex, source_measure_number: score.measures[sourceIndex].number,
        source_offset: publicFraction(sorted[index]), at: publicFraction(add(rat(score.measures[sourceIndex].at), sorted[index])), length: publicFraction(sub(sorted[index + 1], sorted[index])),
        starts_source_measure: index === 0, ends_source_measure: index === sorted.length - 2, suppress_measure_number: sourceImplicit || index !== 0, displayed: sourceIndex >= options.fromMeasure - 1 && sourceIndex < options.toMeasure}));
    }
    if (measureFragments.length === sourceMeasureIndices.length) fail('fragmentNotNeeded');
    if (measureFragments.length > limits.measuresPerView) fail('fragmentBudget');
    let noteCount = 0, paddingNoteCount = 0;
    const count = () => { if (++noteCount > limits.notes) fail('notes'); };
    for (const part of parts) {
      const partId = part.getAttribute('id'), model = models.get(partId), emitted = new Map();
      const originalNotes = children(part, 'measure').flatMap(measure => children(measure, 'note'));
      const originals = new Map(originalNotes.map(note => [note.getAttribute('id'), note])), originalOrder = new Map(originalNotes.map((note,index) => [note.getAttribute('id'),index]));
      for (const measure of children(part, 'measure')) measure.remove();
      for (const fragment of measureFragments) {
        const original = model[fragment.source_measure_index], divisions = original.divisions, start = ticks(rat(fragment.source_offset), divisions), length = ticks(rat(fragment.length), divisions), end = start + length;
        const measure = original.node.cloneNode(false); measure.setAttribute('number', String(fragment.source_measure_number));
        if (!fragment.starts_source_measure) measure.setAttribute('implicit', 'yes');
        part.appendChild(measure);
        const state = new Map(original.initial);
        for (const event of original.keys) if (event.at <= start) state.set(stateKey(event.node), event.node);
        const attributes = document.createElement('attributes');
        for (const name of attributeOrder) for (const [id, value] of state) if (value.localName === name && emitted.get(id) !== serializeElement(value)) { attributes.appendChild(value.cloneNode(true)); emitted.set(id, serializeElement(value)); }
        if (attributes.children.length) measure.appendChild(attributes);
        if (fragment.starts_source_measure) for (const node of children(original.node)) if (node.localName === 'print' || node.localName === 'barline' && node.getAttribute('location') === 'left') measure.appendChild(node.cloneNode(true));
        for (const direction of original.directions) if (direction.at >= start && direction.at < end) {
          const node = direction.node.cloneNode(true); for (const offset of children(node, 'offset')) offset.remove();
          node.appendChild(childValue(document, 'offset', direction.at - start)); measure.appendChild(node);
        }
        const segments = validated.segments.filter(segment => segment.xml_part_id === partId && segment.source_measure_index === fragment.source_measure_index);
        const lanes = new Map();
        for (const segment of segments) {
          const at = ticks(rat(segment.measure_at), divisions), duration = ticks(rat(segment.duration), divisions);
          if (at >= end || at + duration <= start) continue;
          if (at < start || at + duration > end) fail('fragmentSustainedNote');
          const lane = `${segment.staff}/${segment.xml_voice}`;
          if (!lanes.has(lane)) lanes.set(lane, []);
          lanes.get(lane).push({segment, at, duration});
        }
        if (!lanes.size) lanes.set('1/1', []);
        for (const [laneIndex, [lane, pieces]] of [...lanes.entries()].entries()) {
          const [staff, voice] = lane.split('/');
          if (laneIndex) { const backup = document.createElement('backup'); backup.appendChild(childValue(document, 'duration', length)); measure.appendChild(backup); }
          let cursor = 0, previousAt = -1;
          const padding = amount => {
            while (amount > 0) {
              const duration = Math.min(amount, 4 * divisions); if (duration * 10000 <= 4 * divisions) fail('fragmentRhythm');
              const rest = document.createElement('note'); rest.setAttribute('print-object', 'no'); rest.setAttribute('print-spacing', 'yes'); rest.appendChild(document.createElement('rest'));
              for (const [name, value] of [['duration', duration], ['voice', voice], ['staff', staff]]) rest.appendChild(childValue(document, name, value));
              measure.appendChild(rest); count(); paddingNoteCount++;
              expected.push(freeze({xml_part_id: partId, fragment_index: fragment.fragment_index, staff: Number(staff), xml_voice: voice, fragment_at: publicFraction([BigInt(cursor), BigInt(divisions)]), duration: publicFraction([BigInt(duration), BigInt(divisions)]), pitch: null, printed: false}));
              cursor += duration; amount -= duration;
            }
          };
          pieces.sort((a, b) => a.at - b.at || originalOrder.get(a.segment.xml_note_id) - originalOrder.get(b.segment.xml_note_id));
          for (const piece of pieces) {
            const segment = piece.segment, relative = piece.at - start, chord = previousAt === relative;
            if (relative > cursor) padding(relative - cursor);
            if (relative < cursor && !chord) fail();
            if (chord && !segment.pitch) fail();
            const note = originals.get(segment.xml_note_id)?.cloneNode(true); if (!note) fail();
            const displayId = segment.xml_note_id;
            if (chord !== segment.chord || piece.duration !== ticks(rat(segment.duration), divisions)) fail();
            const descriptor = freeze({xml_note_id: displayId, source_xml_note_id: segment.xml_note_id, source_note_id: segment.source_note_id, xml_part_id: partId, fragment_index: fragment.fragment_index,
              source_measure_index: segment.source_measure_index, source_measure_number: segment.measure_number, staff: segment.staff, xml_voice: segment.xml_voice,
              source_measure_at: publicFraction([BigInt(piece.at), BigInt(divisions)]), fragment_at: publicFraction([BigInt(relative), BigInt(divisions)]), at: publicFraction(add(rat(score.measures[segment.source_measure_index].at), [BigInt(piece.at), BigInt(divisions)])),
              duration: publicFraction([BigInt(piece.duration), BigInt(divisions)]), pitch: segment.pitch ? freeze({...segment.pitch}) : null,
              tie_start: segment.tie_start, tie_stop: segment.tie_stop, chord, printed: true});
            noteFragments.push(descriptor); expected.push(descriptor); if (!coverage.has(segment.xml_note_id)) coverage.set(segment.xml_note_id, []); coverage.get(segment.xml_note_id).push(descriptor);
            measure.appendChild(note); count(); if (!chord) cursor = relative + piece.duration; previousAt = relative;
          }
          padding(length - cursor);
        }
        if (fragment.ends_source_measure) { for (const barline of children(original.node, 'barline')) if (barline.getAttribute('location') !== 'left') measure.appendChild(barline.cloneNode(true)); }
        else { const barline = document.createElement('barline'); barline.setAttribute('location', 'right'); barline.appendChild(childValue(document, 'bar-style', 'none')); measure.appendChild(barline); }
      }
    }
    const retained = validated.segments.filter(segment => selected.has(segment.xml_part_id) && sourceMeasureIndices.includes(segment.source_measure_index));
    for (const segment of retained) {
      let next = rat(segment.at);
      for (const piece of coverage.get(segment.xml_note_id) || []) { if (!equal(next, rat(piece.at))) fail(); next = add(next, rat(piece.duration)); }
      if (!equal(next, add(rat(segment.at), rat(segment.duration)))) fail();
    }
    const tieChains = context.tieChains.map(chain => freeze(chain.flatMap(id => (coverage.get(id) || []).map(piece => piece.xml_note_id))));
    let elements = 0;
    const visit = (node, depth) => { if (++elements > limits.elements || depth > limits.depth) fail('fragmentBudget'); for (const child of children(node)) visit(child, depth + 1); }; visit(root, 1);
    const serialized = serializeDocument(document);
    if (typeof serialized !== 'string' || !serialized.trimStart().startsWith('<') || new TextEncoder().encode(serialized).byteLength > limits.xmlBytes) fail('fragmentBudget');
    const displayedFragmentIndices = freeze(measureFragments.filter(fragment => fragment.displayed).map(fragment => fragment.fragment_index));
    const projection = freeze({ok: true, kind: 'source-bound-measure-fragments-v1', document, partIds: freeze(parts.map(part => part.getAttribute('id'))), sourceMeasureIndices: freeze(sourceMeasureIndices),
      measureFragments: freeze(measureFragments), noteFragments: freeze(noteFragments), displayedFragmentIndices,
      displayedSourceMeasureIndices: freeze(sourceMeasureIndices.filter(index => index >= options.fromMeasure - 1 && index < options.toMeasure)),
      drawFromIndex: displayedFragmentIndices[0], drawToIndex: displayedFragmentIndices.at(-1), tieChains: freeze(tieChains), noteCount, paddingNoteCount});
    const keys = parts.map(part => {
      const model = models.get(part.getAttribute('id'));
      return measureFragments.map(fragment => {
        const original = model[fragment.source_measure_index], state = new Map(original.initial), at = ticks(rat(fragment.source_offset), original.divisions);
        for (const event of original.keys) if (event.at <= at) state.set(stateKey(event.node), event.node);
        const value=state.get('key:');return {fifths:Number(text(value,'fifths','0')),mode:text(value,'mode','major')==='minor'?1:0};
      });
    });
    proofs.set(projection, {score, sourceSnapshot: JSON.stringify(score), documentSnapshot: serialized, expected, keys}); return projection;
  } catch (error) { return {ok: false, key: error.projectionKey || 'fragmentProjection'}; }
}

/** Independent exact real-reader proof. It does not relax the production guard. */
export function validateEngravingMeasureFragments(sheet, projection, score, limits) {
  try {
    const proof = proofs.get(projection), measures = sheet?.SourceMeasures, instruments = sheet?.Instruments;
    if (!proof || proof.score !== score || proof.sourceSnapshot !== JSON.stringify(score) || proof.documentSnapshot !== serializeDocument(projection.document) || !Array.isArray(measures) || measures.length !== projection.measureFragments.length || !Array.isArray(instruments) || instruments.length !== projection.partIds.length) fail();
    const actual = new Map(), seen = new Set(), byId = new Map(), matches = [];
    const base = rat(projection.measureFragments[0].at), activeKeys = instruments.map(instrument => instrument.Staves.map(() => null));
    for (const [index, measure] of measures.entries()) {
      const fragment = projection.measureFragments[index];
      if (!equal(modelFraction(measure.Duration), rat(fragment.length)) || !equal(modelFraction(measure.AbsoluteTimestamp), sub(rat(fragment.at), base)) || measure.MeasureNumberXML !== fragment.source_measure_number || measure.ImplicitMeasureFromXml !== fragment.suppress_measure_number) fail();
      if (!fragment.ends_source_measure && measure.endingBarStyleXml !== 'none') fail();
      for (const [partIndex, instrument] of instruments.entries()) {
        if (instrument.IdString !== projection.partIds[partIndex]) fail();
        const staffIndex = sheet.getGlobalStaffIndexOfFirstStaff(instrument);
        for (let staff = 0; staff < instrument.Staves.length; staff++) {
          const instructions = measure.FirstInstructionsStaffEntries[staffIndex + staff]?.Instructions || [];
          for (const instruction of instructions) if (typeof instruction.Key === 'number') activeKeys[partIndex][staff] = {fifths:instruction.Key,mode:instruction.Mode};
          if (activeKeys[partIndex][staff]?.fifths !== proof.keys[partIndex][index].fifths || activeKeys[partIndex][staff]?.mode !== proof.keys[partIndex][index].mode) fail('fragmentKeyIdentity');
        }
      }
      for (const container of measure.VerticalSourceStaffEntryContainers || []) for (const entry of container.StaffEntries || []) for (const voice of entry?.VoiceEntries || []) for (const note of voice.Notes || []) {
        if (seen.has(note)) continue; seen.add(note); if (seen.size > limits.notes) fail('notes');
        const staff = note.ParentStaff, instrument = staff?.ParentInstrument, pitch = note.isRest() ? null : note.Pitch;
        if (note.SourceMeasure !== measure || note.ParentVoiceEntry !== voice || !instruments.includes(instrument) || pitch && pitch.constructor.OctaveXmlDifference !== 3) fail();
        const value = {xml_part_id: instrument.IdString, fragment_index: index, staff: instrument.Staves.indexOf(staff) + 1, xml_voice: String(voice.ParentVoice.VoiceId),
          fragment_at: publicFraction(modelFraction(voice.Timestamp)), duration: publicFraction(modelFraction(note.Length)), printed: note.PrintObject === true,
          pitch: pitch ? {step: ['C', 'D', 'E', 'F', 'G', 'A', 'B'][[0, 2, 4, 5, 7, 9, 11].indexOf(pitch.FundamentalNote)], alter: pitch.AccidentalHalfTones, octave: pitch.Octave + 3} : null};
        const identity = tuple(value); if (!actual.has(identity)) actual.set(identity, []); actual.get(identity).push(note);
      }
    }
    if (seen.size !== projection.noteCount) fail();
    for (const expected of proof.expected) {
      const notes = actual.get(tuple(expected)); if (notes?.length !== 1) fail('fragmentNoteIdentity');
      actual.delete(tuple(expected));
      if (expected.printed) { byId.set(expected.xml_note_id, notes[0]); matches.push({fragment: expected, note: notes[0]}); }
    }
    if (actual.size) fail();
    for (const chain of projection.tieChains) {
      const notes = chain.map(id => byId.get(id)), tie = notes[0]?.NoteTie;
      if (!tie || tie.Notes?.length !== notes.length || notes.some((note, index) => note?.NoteTie !== tie || tie.Notes[index] !== note)) fail('fragmentTieIdentity');
    }
    return {ok: true, matches};
  } catch (error) { return {ok: false, key: error.projectionKey || 'fragmentProjection'}; }
}

/** Layout-only numbering policy, after the complete fragment model proof. */
export function prepareEngravingFragmentLabels(sheet, projection, score, limits) {
  const checked = validateEngravingMeasureFragments(sheet, projection, score, limits);
  if (!checked.ok) return checked;
  // OSMD infers a short first fragment as a pickup, which otherwise hides the
  // original source label. Only original pickups and continuation fragments
  // suppress labels. Duration, timestamps, XML labels and notes never change.
  sheet.Rules.UseXMLMeasureNumbers = true;
  sheet.Rules.RenderMeasureNumbersForImplicitMeasures = false;
  for (const [index, measure] of sheet.SourceMeasures.entries()) measure.ImplicitMeasure = projection.measureFragments[index].suppress_measure_number;
  return {ok: true};
}
