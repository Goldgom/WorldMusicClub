/** Geometry and display helpers only. Rust remains the canonical musical clock. */
import {getAppI18n} from './app-locale.js';

export const PIANO_RANGES = Object.freeze({49: [36, 84], 61: [36, 96], 76: [28, 103], 88: [21, 108]});
export const BLACK_CLASSES = new Set([1, 3, 6, 8, 10]);
export const SHORTCUTS = Object.freeze({a: 0, w: 1, s: 2, e: 3, d: 4, f: 5, t: 6, g: 7, y: 8, h: 9, u: 10, j: 11, k: 12, o: 13, l: 14, p: 15, ';': 16});
const STEPS = ['C', 'D', 'E', 'F', 'G', 'A', 'B'];
const SEMITONES = {C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11};
export const beat = (value) => value.numerator / value.denominator;
export const midiName = (midi) => `${['C', 'C♯', 'D', 'D♯', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'A♯', 'B'][((midi % 12) + 12) % 12]}${Math.floor(midi / 12) - 1}`;
export const pitchMidi = (pitch) => pitch ? 12 * (pitch.octave + 1) + SEMITONES[pitch.step] + pitch.alter : null;
export const formatTime = (ms) => `${Math.floor(Math.max(0, ms) / 60000)}:${String(Math.floor(Math.max(0, ms) / 1000) % 60).padStart(2, '0')}`;
export function keyboardGeometry(count, lowest = null) {
  count = Number(count);
  if (!Number.isInteger(count) || count < 12 || count > 128) throw new Error('Keyboard count must be 12–128.');
  const low = lowest ?? (PIANO_RANGES[count]?.[0] ?? Math.max(0, 60 - Math.floor(count / 2)));
  const high = low + count - 1;
  if (!Number.isInteger(low) || low < 0 || high > 127) throw new Error('Keyboard range must stay inside MIDI 0–127.');
  let whiteIndex = 0;
  const keys = Array.from({length: count}, (_, i) => {
    const midi = i + low; const black = BLACK_CLASSES.has(midi % 12);
    return {midi, black, x: black ? whiteIndex - 0.31 : whiteIndex++, width: black ? 0.62 : 1};
  });
  const min = Math.min(0, keys[0].x); const max = Math.max(...keys.map(key => key.x + key.width));
  return keys.map(key => ({...key, x:(key.x - min)/(max - min), width:key.width/(max - min)}));
}
export function keyAt(score, atBeat) {
  let current = {fifths: 0, mode: 'major'};
  for (const key of score.keys) if (beat(key.at) <= atBeat) current = key; else break;
  return current;
}
export function keyTonic(key) {
  if (!key || !['major', 'minor'].includes(key.mode) || !Number.isInteger(key.fifths) || key.fifths < -7 || key.fifths > 7) return null;
  const tonics = key.mode === 'minor' ? ['Ab', 'Eb', 'Bb', 'F', 'C', 'G', 'D', 'A', 'E', 'B', 'F#', 'C#', 'G#', 'D#', 'A#'] : ['Cb', 'Gb', 'Db', 'Ab', 'Eb', 'Bb', 'F', 'C', 'G', 'D', 'A', 'E', 'B', 'F#', 'C#'];
  const name = tonics[key.fifths + 7];
  const signature = Object.fromEntries(STEPS.map(step => [step, 0]));
  const order = key.fifths > 0 ? ['F', 'C', 'G', 'D', 'A', 'E', 'B'] : ['B', 'E', 'A', 'D', 'G', 'C', 'F'];
  for (const step of order.slice(0, Math.abs(key.fifths))) signature[step] = Math.sign(key.fifths);
  return {step: name[0], name: name.replace('#', '♯').replace('b', '♭'), octave: 4, signature};
}
export function jianpu(pitch, key = null) {
  if (!pitch) return {number: '0', accidental: '', octave: 0};
  const tonic = keyTonic(key);
  const difference = tonic ? (pitch.octave - tonic.octave) * 7 + STEPS.indexOf(pitch.step) - STEPS.indexOf(tonic.step) : (pitch.octave - 4) * 7 + STEPS.indexOf(pitch.step);
  const alteration = pitch.alter - (tonic?.signature[pitch.step] || 0);
  return {number: String(((difference % 7) + 7) % 7 + 1), accidental: alteration > 0 ? '♯'.repeat(alteration) : alteration < 0 ? '♭'.repeat(-alteration) : '', octave: Math.floor(difference / 7)};
}
export function transposeTempo(score, bpm) {
  const copy = structuredClone(score);
  const original = copy.tempo[0]?.bpm || 120;
  copy.tempo = copy.tempo.map(t => ({...t, bpm: Math.round(t.bpm * bpm / original * 100) / 100}));
  return copy;
}
export function fretPositions(midi, maxFret = 12) {
  return [64, 59, 55, 50, 45, 40].flatMap((open, string) => {
    const fret = midi - open;
    return fret >= 0 && fret <= maxFret ? [{string, fret}] : [];
  });
}
export function scoreSummary(score,timeline=null) {
  let count=0,rests=0;for(const part of score.parts)for(const note of part.notes){if(note.pitch)count++;else rests++}
  return {count,rests,writtenCount:count+rests,playbackCount:timeline?.notes.length??null,parts:score.parts.length,measures:score.measures.length};
}
export function catalogOriginLabel(score){
  if(score.provenance.kind==='original_exercise')return 'Original exercise';
  if(score.provenance.kind==='public_domain_practice_arrangement')return 'Public-domain excerpt';
  if(score.provenance.kind==='curated_cc0_edition')return 'CC0 source edition';
  return 'Source edition';
}
export function escapeXml(value) {
  return String(value).replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;'}[c]));
}
/** Display extent includes declared silent measures; Rust still owns playback time. */
export function scoreEndBeat(score) {
  const measureEnd = score.measures.reduce((end, measure) => Math.max(end, beat(measure.at) + beat(measure.length)), 4);
  return score.parts.reduce((end, part) => part.notes.reduce((value, note) => Math.max(value, beat(note.at) + beat(note.duration)), end), measureEnd);
}
export function notationLayout(availableWidth) { const width=Math.max(240,Math.floor(availableWidth)); return {width,spanBeats:width>=960?16:width>=540?8:4}; }
export function notationPageCount(score, spanBeats = 16) { return Math.max(1, Math.ceil(scoreEndBeat(score) / spanBeats)); }
export function accidentalGlyph(alter) { if (!Number.isInteger(alter) || alter < -2 || alter > 2) throw new Error('Unsupported pitch alteration.'); return alter === 0 ? '♮' : alter > 0 ? '♯'.repeat(alter) : '♭'.repeat(-alter); }

const NUMBERED_EVENT_LIMIT = 1000;
const NUMBERED_GAP = 14;
const NUMBERED_LIMIT_MESSAGE = 'Dense fragment: first 1,000 notation events shown; complete score retained for playback/export.';
const numberedText = (options, key, fallback, params = {}) => options.i18n?.t(key, params) ?? fallback;
// Use exact reduced onsets for grouping, not rounded pixel positions or floating
// point equality. The original, unreduced source rationals stay on every event.
function rationalKey(value) {
  let a = value.numerator, b = value.denominator;
  while (b) [a, b] = [b, a % b];
  return `${value.numerator / a}/${value.denominator / a}`;
}
function compareRationals(a, b) {
  const difference = BigInt(a.numerator) * BigInt(b.denominator) - BigInt(b.numerator) * BigInt(a.denominator);
  return difference < 0n ? -1 : difference > 0n ? 1 : 0;
}
function displayRational(value) {
  const [coefficient, exponent = '0'] = String(value).split('e');
  const decimals = coefficient.split('.')[1]?.length || 0;
  const power = Number(exponent) - decimals;
  return {numerator: Number(coefficient.replace('.', '')) * 10 ** Math.max(0, power), denominator: 10 ** Math.max(0, -power)};
}
function numberedLabelLines(value, width) {
  const characters = [...String(value)], count = Math.max(1, Math.floor((width - 28) / 12));
  return Array.from({length: Math.max(1, Math.ceil(characters.length / count))}, (_, index) => characters.slice(index * count, (index + 1) * count).join(''));
}
function numberedRhythm(duration) {
  const length = beat(duration);
  if (Number.isInteger(length) && length >= 1 && length <= 7) return {beams: 0, dots: 0, text: '–'.repeat(length - 1)};
  // Binary subdivisions through 1/64 quarter note, including up to three dots.
  // Other durations have an explicit rational label instead of a false glyph.
  for (let beams = 0; beams <= 6; beams++) for (let dots = 0; dots <= 3; dots++) {
    if (duration.numerator * 2 ** (beams + dots) === duration.denominator * (2 ** (dots + 1) - 1)) return {beams, dots, text: ''};
  }
  return {beams: 0, dots: 0, text: `[${duration.numerator}/${duration.denominator} q]`, exact: true};
}
function numberedGlyph(note, score, movable) {
  const pitch = jianpu(note.pitch, movable ? keyAt(score, beat(note.at)) : null);
  const rhythm = numberedRhythm(note.duration);
  const accidentalWidth = pitch.accidental.length * 16;
  const rhythmWidth = rhythm.text.length * (rhythm.exact ? 8 : 18);
  const top = pitch.octave > 0 ? -41 - (pitch.octave - 1) * 7 : -29;
  const beamBottom = rhythm.beams ? 6 + (rhythm.beams - 1) * 5 : 0;
  const bottom = pitch.octave < 0 ? Math.max(8, beamBottom + 8) + (Math.abs(pitch.octave) - 1) * 7 + 8 : Math.max(6, beamBottom + 2);
  return {pitch, rhythm, accidentalWidth, rhythmWidth, top, bottom,
    left: Math.max(12, accidentalWidth ? accidentalWidth + 16 : 12),
    right: Math.max(12, rhythm.dots ? 15 + rhythm.dots * 7 : 12, rhythmWidth ? 16 + rhythmWidth : 12)};
}

/** Display-only layout. Source events, exact times, voices and staff IDs are never merged or rewritten. */
export function numberedNotationLayout(score, options = {}) {
  const selected = options.allParts === true ? score.parts : options.partId ? score.parts.filter(part => part.id === options.partId) : score.parts.slice(0, 1);
  const startBeat = Math.max(0, options.startBeat || 0), spanBeats = Math.min(32, Math.max(4, options.spanBeats || 16));
  const endBeat = startBeat + spanBeats, viewportWidth = Math.max(240, options.width || Math.max(720, 90 + spanBeats * 72));
  const columns = new Map(), parts = [], movable = options.numberedMode === 'movable';
  const columnAt = at => {
    const key = rationalKey(at);
    if (!columns.has(key)) columns.set(key, {key, at, left: 12, right: 12, measures: [], keys: []});
    return columns.get(key);
  };
  for (const measure of score.measures) if (beat(measure.at) >= startBeat && beat(measure.at) < endBeat) {
    const column = columnAt(measure.at);
    column.measures.push(measure); column.right = Math.max(column.right, String(measure.number).length * 8);
  }
  if (movable) {
    const markers = [{...keyAt(score, startBeat), at: displayRational(startBeat)}, ...score.keys.filter(key => beat(key.at) > startBeat && beat(key.at) < endBeat)];
    for (const key of markers) {
      const tonic = keyTonic(key), reference = tonic ? `${tonic.name}${tonic.octave}` : '';
      const text = tonic ? numberedText(options, key.mode === 'minor' ? 'notation.tonicMinor' : 'notation.tonicMajor', `1 = ${reference} (${key.mode})`, {tonic: reference})
        : numberedText(options, 'notation.tonicUnknown', 'Unknown mode: fixed C reference');
      const column = columnAt(key.at);
      // The reference may be localized CJK text; reserve a full 12px character
      // cell rather than an ASCII-only width estimate.
      column.keys.push(text); column.right = Math.max(column.right, text.length * 12);
    }
  }
  let y = 14;
  for (const part of selected) {
    const visible = part.notes.filter(note => beat(note.at) >= startBeat && beat(note.at) < endBeat);
    const entries = visible.slice(0, NUMBERED_EVENT_LIMIT).map((note, sourceIndex) => {
      const glyph = numberedGlyph(note, score, movable), column = columnAt(note.at);
      column.left = Math.max(column.left, glyph.left); column.right = Math.max(column.right, glyph.right);
      return {note, sourceIndex, column, glyph};
    });
    const laneMap = new Map();
    for (const entry of entries) {
      const key = JSON.stringify([entry.note.staff, entry.note.voice]);
      if (!laneMap.has(key)) laneMap.set(key, {staff: entry.note.staff, voice: entry.note.voice, groups: new Map()});
      const lane = laneMap.get(key);
      if (!lane.groups.has(entry.column.key)) lane.groups.set(entry.column.key, []);
      lane.groups.get(entry.column.key).push(entry);
    }
    const lanes = [...laneMap.values()].sort((a, b) => a.staff - b.staff || (a.voice < b.voice ? -1 : a.voice > b.voice ? 1 : 0));
    const partLayout = {part, entries, lanes, truncated: visible.length > NUMBERED_EVENT_LIMIT, nameY: y + 12, nameLines: numberedLabelLines(part.name, viewportWidth)};
    y += partLayout.nameLines.length * 18 + 16;
    if (partLayout.truncated) {
      partLayout.warningY = y; partLayout.warningLines = numberedLabelLines(numberedText(options, 'notation.eventLimit', NUMBERED_LIMIT_MESSAGE), viewportWidth);
      y += partLayout.warningLines.length * 18 + 10;
    }
    for (const lane of lanes) {
      lane.labelY = y; lane.labelLines = numberedLabelLines(numberedText(options, 'notation.staffVoice', `Staff ${lane.staff} · Voice ${lane.voice}`, {staff: lane.staff, voice: lane.voice}), viewportWidth);
      y += lane.labelLines.length * 18 + 6; lane.top = y;
      const rows = [];
      for (const group of lane.groups.values()) {
        // Highest chord pitch first. Unisons and rests remain independent IDs.
        group.sort((a, b) => (pitchMidi(b.note.pitch) ?? -Infinity) - (pitchMidi(a.note.pitch) ?? -Infinity) || a.sourceIndex - b.sourceIndex);
        group.forEach((entry, index) => {
          rows[index] ??= {above: 0, below: 0};
          rows[index].above = Math.max(rows[index].above, -entry.glyph.top);
          rows[index].below = Math.max(rows[index].below, entry.glyph.bottom);
        });
      }
      for (const row of rows) { row.y = y + row.above; y = row.y + row.below + 12; }
      for (const group of lane.groups.values()) group.forEach((entry, index) => { entry.y = rows[index].y; });
      lane.bottom = y - 12; y = lane.bottom + 30;
    }
    if (movable) { partLayout.keyY = y; y += Math.max(1, ...[...columns.values()].map(column => column.keys.length)) * 18 + 6; }
    if (!entries.length) { partLayout.emptyY = y; partLayout.emptyTop = y + 28; partLayout.emptyBottom = y + 58; y += 76; }
    parts.push(partLayout); y += 12;
  }
  const orderedColumns = [...columns.values()].sort((a, b) => compareRationals(a.at, b.at));
  const spacing = (viewportWidth - 114) / spanBeats;
  let previous = null;
  for (const column of orderedColumns) {
    column.x = Math.max(72 + column.left, 90 + (beat(column.at) - startBeat) * spacing,
      previous ? previous.x + previous.right + NUMBERED_GAP + column.left : 0);
    previous = column;
  }
  const width = Math.max(viewportWidth, previous ? previous.x + previous.right + 24 : 0);
  for (const part of parts) for (const entry of part.entries) {
    entry.x = entry.column.x;
    entry.box = {left: entry.x - entry.glyph.left, right: entry.x + entry.glyph.right,
      top: entry.y + entry.glyph.top, bottom: entry.y + entry.glyph.bottom};
  }
  return {startBeat, endBeat, viewportWidth, width, height: Math.max(150, y), columns: orderedColumns, parts};
}

function renderNumberedNotation(score, options) {
  const layout = numberedNotationLayout(score, options), shapes = [];
  const text = (x, y, value, className, extra = '') => `<text x="${x}" y="${y}" class="${className}" ${extra}>${escapeXml(value)}</text>`;
  const label = (lines, y, className) => lines.forEach((line, index) => shapes.push(text(14, y + index * 18, line, className)));
  for (const part of layout.parts) {
    label(part.nameLines, part.nameY, 'part-name');
    if (part.truncated) shapes.push(`<g class="numbered-limit" aria-label="${escapeXml(numberedText(options, 'notation.eventLimit', NUMBERED_LIMIT_MESSAGE))}">`);
    if (part.truncated) { label(part.warningLines, part.warningY, 'part-name'); shapes.push('</g>'); }
    if (part.emptyY) shapes.push(text(14, part.emptyY, numberedText(options, 'notation.empty', 'No note onsets in this page.'), 'part-name'));
    if (part.emptyY) for (const column of layout.columns) for (const measure of column.measures) {
      const x = column.x - column.left - 6;
      shapes.push(`<line x1="${x}" y1="${part.emptyTop}" x2="${x}" y2="${part.emptyBottom}" class="bar-line"/>`, text(x + 2, part.emptyTop - 6, measure.number, 'measure-number'));
    }
    for (const lane of part.lanes) {
      label(lane.labelLines, lane.labelY, 'part-name numbered-lane-label');
      for (const column of layout.columns) for (const measure of column.measures) {
        const x = column.x - column.left - 6;
        shapes.push(`<line x1="${x}" y1="${lane.top - 4}" x2="${x}" y2="${lane.bottom + 4}" class="bar-line"/>`, text(x + 2, lane.top - 9, measure.number, 'measure-number'));
      }
    }
    if (part.keyY) for (const column of layout.columns) column.keys.forEach((key, index) => shapes.push(text(column.x, part.keyY + index * 18, key, 'tonic-reference')));
    for (const entry of part.entries) {
      const {note, x, y, glyph, box} = entry, {pitch, rhythm} = glyph;
      shapes.push(`<g data-note-id="${escapeXml(note.id)}" data-staff="${escapeXml(note.staff)}" data-voice="${escapeXml(note.voice)}" data-at="${escapeXml(note.at.numerator)}/${escapeXml(note.at.denominator)}" data-duration="${escapeXml(note.duration.numerator)}/${escapeXml(note.duration.denominator)}" data-layout-box="${box.left} ${box.top} ${box.right} ${box.bottom}" class="score-note">`);
      const onset = `${note.at.numerator}/${note.at.denominator}`, duration = `${note.duration.numerator}/${note.duration.denominator}`;
      shapes.push(`<title>${escapeXml(numberedText(options, 'notation.noteDetail', `${note.id}: staff ${note.staff}, voice ${note.voice}; onset ${onset}, duration ${duration} quarter notes`,
        {id: note.id, staff: note.staff, voice: note.voice, onset, duration}))}</title>`);
      shapes.push(text(x, y, pitch.number, 'jianpu-note', 'text-anchor="middle" textLength="16" lengthAdjust="spacingAndGlyphs" style="font-size:25px;stroke:none"'));
      if (pitch.accidental) shapes.push(text(x - 13, y, pitch.accidental, 'accidental', `text-anchor="end" textLength="${glyph.accidentalWidth}" lengthAdjust="spacingAndGlyphs" style="font-size:20px;stroke:none"`));
      for (let b = 0; b < rhythm.beams; b++) shapes.push(`<line x1="${x - 9}" y1="${y + 6 + b * 5}" x2="${x + 9}" y2="${y + 6 + b * 5}" class="note-line"/>`);
      for (let d = 0; d < rhythm.dots; d++) shapes.push(text(x + 16 + d * 7, y, '•', 'octave-dots', 'textLength="6" lengthAdjust="spacingAndGlyphs" style="font-size:12px;stroke:none;letter-spacing:0"'));
      const bottomDot = Math.max(8, rhythm.beams ? 6 + (rhythm.beams - 1) * 5 + 8 : 8);
      for (let d = 0; d < Math.abs(pitch.octave); d++) {
        const dy = pitch.octave > 0 ? -31 - d * 7 : bottomDot + d * 7;
        shapes.push(text(x, y + dy + 4, '•', 'octave-dots', 'text-anchor="middle" textLength="6" lengthAdjust="spacingAndGlyphs" style="font-size:12px;stroke:none;letter-spacing:0"'));
      }
      if (rhythm.text) shapes.push(text(x + 16, y, rhythm.text, 'duration-dash', `textLength="${glyph.rhythmWidth}" lengthAdjust="spacingAndGlyphs" style="font-size:${rhythm.exact ? 12 : 22}px;stroke:none"`));
      shapes.push('</g>');
    }
  }
  const accessibleLabel = options.numberedMode === 'movable' ? numberedText(options, 'notation.ariaMovable', 'Movable tonic numbered pitch view') : numberedText(options, 'notation.ariaFixed', 'Fixed C numbered pitch view');
  const description = numberedText(options, 'notation.description', 'Numbered pitch guide: separate staff and voice lanes; simultaneous notes stack vertically. Dense pages scroll horizontally. Spacing is adjusted for readability, not a linear time scale. Exact durations are retained on each note.');
  // Keep the normal font size when density needs horizontal scrolling. The
  // generic staff SVG max-width rule must not scale dense numbered pages down.
  return `<svg xmlns="http://www.w3.org/2000/svg" role="img" aria-label="${escapeXml(accessibleLabel)}" viewBox="0 0 ${layout.width} ${layout.height}" width="${layout.width}" height="${layout.height}" style="max-width:none;height:auto"><desc>${escapeXml(description)}</desc>${shapes.join('')}</svg>`;
}
function staffPitchY(pitch) {
  return 60 - ((pitch.octave - 4) * 7 + STEPS.indexOf(pitch.step)) * 6;
}

// Reserve the complete painted note, including the upward stem/flag and the
// accidental's font descent. A fixed-height SVG clips bass notes even when its
// containing panel has space. This remains a treble pitch guide, not a hand or
// clef inference, and only the current bounded page contributes to its height.
function basicStaffParts(parts, startBeat, endBeat) {
  let cursor = 0;
  const rows = parts.map(part => {
    const visible = part.notes.filter(note => beat(note.at) >= startBeat && beat(note.at) < endBeat);
    const notes = visible.slice(0, 1000);
    let above = 0, below = 53;
    for (const note of notes) if (note.pitch) {
      const y = staffPitchY(note.pitch), length = beat(note.duration);
      above = Math.min(above, y - (length < 1 ? 33 : length < 4 ? 32 : 20));
      below = Math.max(below, y + 14);
    }
    const nameY = cursor + 22;
    const top = Math.max(cursor + 38, cursor + 32 - above);
    cursor = Math.max(cursor + 140, top + below + 8);
    return {part, notes, top, nameY, truncated: visible.length > 1000};
  });
  return {rows, height: Math.max(170, cursor + 30)};
}

export function renderNotation(score, mode = 'staff', options = {}) {
  if (mode === 'jianpu') return renderNumberedNotation(score, options);
  const i18n = options.i18n ?? getAppI18n(options.document);
  const parts = options.allParts === true ? score.parts : options.partId ? score.parts.filter(part => part.id === options.partId) : score.parts.slice(0, 1);
  const startBeat = Math.max(0, options.startBeat || 0);
  const spanBeats = Math.min(32, Math.max(4, options.spanBeats || 16));
  const endBeat = startBeat + spanBeats;
  const width = Math.max(240, options.width || Math.max(720, 90 + spanBeats * 72));
  const layout = basicStaffParts(parts, startBeat, endBeat);
  const height = layout.height;
  // The note anchor is 18px after its time column. Keep room beyond it for
  // flags, ledger strokes and the 28px rest font, including a little padding.
  // Only tighten pages that need it, using one scale for all parts and bars;
  // clamping individual anchors would merge distinct near-edge onsets.
  let spacing = (width - 96) / spanBeats;
  for (const row of layout.rows) for (const note of row.notes) {
    const offset = beat(note.at) - startBeat;
    if (offset > 0) spacing = Math.min(spacing, (width - 90 - 36) / offset);
  }
  const x = t => 72 + (t - startBeat) * spacing;
  const shapes = [];
  layout.rows.forEach(({part, notes, top, nameY}) => {
    shapes.push(`<text x="14" y="${nameY}" class="part-name">${escapeXml(part.name)}</text>`);
    if (mode === 'staff') {
      for (let line = 0; line < 5; line++) shapes.push(`<line x1="14" y1="${top + line * 12}" x2="${width - 16}" y2="${top + line * 12}" class="staff-line"/>`);
      shapes.push(`<text x="23" y="${top + 46}" class="clef">𝄞</text>`);
    }
    score.measures.filter(measure => beat(measure.at) >= startBeat && beat(measure.at) < endBeat).forEach(measure => {
      shapes.push(`<line x1="${x(beat(measure.at))}" y1="${top - 5}" x2="${x(beat(measure.at))}" y2="${top + 53}" class="bar-line"/><text x="${x(beat(measure.at)) + 5}" y="${top - 10}" class="measure-number">${measure.number}</text>`);
    });
    notes.forEach(note => {
      const nx = x(beat(note.at)) + 18;
      const data = `data-note-id="${escapeXml(note.id)}" class="score-note"`;
      if (!note.pitch) {
        shapes.push(`<g ${data}><text x="${nx}" y="${top + 32}" class="rest">𝄽</text></g>`);
      } else {
        const ny = top + staffPitchY(note.pitch);
        shapes.push(`<g ${data}>`);
        if (ny >= top + 60) for (let ly = top + 60; ly <= ny; ly += 12) shapes.push(`<line x1="${nx - 12}" y1="${ly}" x2="${nx + 12}" y2="${ly}" class="note-line"/>`);
        if (ny <= top - 12) for (let ly = top - 12; ly >= ny; ly -= 12) shapes.push(`<line x1="${nx - 12}" y1="${ly}" x2="${nx + 12}" y2="${ly}" class="note-line"/>`);
        const length = beat(note.duration);
        shapes.push(`<ellipse cx="${nx}" cy="${ny}" rx="8" ry="5.5" transform="rotate(-18 ${nx} ${ny})" class="note-head${length >= 2 ? ' open-head' : ''}"/>`);
        if (length < 4) shapes.push(`<line x1="${nx + 7}" y1="${ny}" x2="${nx + 7}" y2="${ny - 31}" class="note-line"/>`);
        if (length < 1) shapes.push(`<path d="M${nx + 7} ${ny - 31}q18 7 8 18" class="note-flag"/>`);
        shapes.push(`<text x="${nx - (Math.abs(note.pitch.alter) === 2 ? 32 : 23)}" y="${ny + 6}" class="accidental">${accidentalGlyph(note.pitch.alter)}</text>`);
        shapes.push('</g>');
      }
    });
  });
  if (layout.rows.some(row => row.truncated)) shapes.push(`<text x="14" y="16" class="part-name">${escapeXml(i18n.t('notation.eventLimit'))}</text>`);
  const accessibleLabel = i18n.t(mode === 'staff' ? 'notation.basicStaffAria' : options.numberedMode === 'movable' ? 'notation.ariaMovable' : 'notation.ariaFixed');
  return `<svg xmlns="http://www.w3.org/2000/svg" role="img" aria-label="${escapeXml(accessibleLabel)}" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}">${shapes.join('')}</svg>`;
}
