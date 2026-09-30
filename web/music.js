/** Geometry and display helpers only. Rust remains the canonical musical clock. */
export const PIANO_RANGES = Object.freeze({49: [36, 84], 61: [36, 96], 76: [28, 103], 88: [21, 108]});
export const BLACK_CLASSES = new Set([1, 3, 6, 8, 10]);
export const SHORTCUTS = Object.freeze({a: 0, w: 1, s: 2, e: 3, d: 4, f: 5, t: 6, g: 7, y: 8, h: 9, u: 10, j: 11, k: 12, o: 13, l: 14, p: 15, ';': 16});
const STEPS = ['C', 'D', 'E', 'F', 'G', 'A', 'B'];
const SEMITONES = {C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11};
export const beat = (value) => value.numerator / value.denominator;
export const midiName = (midi) => `${['C', 'C♯', 'D', 'D♯', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'A♯', 'B'][((midi % 12) + 12) % 12]}${Math.floor(midi / 12) - 1}`;
export const pitchMidi = (pitch) => pitch ? 12 * (pitch.octave + 1) + SEMITONES[pitch.step] + pitch.alter : null;
export const formatTime = (ms) => `${Math.floor(Math.max(0, ms) / 60000)}:${String(Math.floor(Math.max(0, ms) / 1000) % 60).padStart(2, '0')}`;
export function keyboardGeometry(count) {
  const [low, high] = PIANO_RANGES[count] || PIANO_RANGES[61];
  const whites = Array.from({length: high - low + 1}, (_, i) => i + low).filter(n => !BLACK_CLASSES.has(n % 12));
  const width = 1 / whites.length;
  let whiteIndex = 0;
  return Array.from({length: high - low + 1}, (_, i) => {
    const midi = i + low;
    const black = BLACK_CLASSES.has(midi % 12);
    const x = black ? (whiteIndex - 0.31) * width : whiteIndex++ * width;
    return {midi, black, x, width: width * (black ? 0.62 : 1)};
  });
}
export function jianpu(pitch) {
  if (!pitch) return {number: '0', accidental: '', octave: 0};
  return {number: String(STEPS.indexOf(pitch.step) + 1), accidental: pitch.alter > 0 ? '♯'.repeat(pitch.alter) : pitch.alter < 0 ? '♭'.repeat(-pitch.alter) : '', octave: pitch.octave - 4};
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
export function scoreSummary(score) {
  const notes = score.parts.flatMap(part => part.notes).filter(n => n.pitch);
  return {count: notes.length, parts: score.parts.length, measures: score.measures.length};
}
export function escapeXml(value) {
  return String(value).replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;'}[c]));
}
/** A deliberately basic fixed-C pitch view. Unsupported engraving is disclosed in the UI. */
export function scoreEndBeat(score) { return score.parts.reduce((end, part) => part.notes.reduce((value, note) => Math.max(value, beat(note.at) + beat(note.duration)), end), 4); }
export function notationPageCount(score, spanBeats = 16) { return Math.max(1, Math.ceil(scoreEndBeat(score) / spanBeats)); }
export function renderNotation(score, mode = 'staff', options = {}) {
  const parts = options.partId ? score.parts.filter(part => part.id === options.partId) : score.parts.slice(0, 1);
  const startBeat = Math.max(0, options.startBeat || 0);
  const spanBeats = Math.min(32, Math.max(4, options.spanBeats || 16));
  const endBeat = startBeat + spanBeats;
  const width = Math.max(720, 90 + spanBeats * 72);
  const height = mode === 'staff' ? Math.max(170, parts.length * 140 + 30) : Math.max(125, parts.length * 105 + 30);
  const x = t => 72 + (t - startBeat) * 72;
  const shapes = [];
  parts.forEach((part, index) => {
    const top = 38 + index * (mode === 'staff' ? 140 : 105);
    shapes.push(`<text x="14" y="${top - 16}" class="part-name">${escapeXml(part.name)}</text>`);
    if (mode === 'staff') {
      for (let line = 0; line < 5; line++) shapes.push(`<line x1="14" y1="${top + line * 12}" x2="${width - 16}" y2="${top + line * 12}" class="staff-line"/>`);
      shapes.push(`<text x="23" y="${top + 46}" class="clef">𝄞</text>`);
    }
    score.measures.filter(measure => beat(measure.at) >= startBeat && beat(measure.at) < endBeat).forEach(measure => {
      shapes.push(`<line x1="${x(beat(measure.at))}" y1="${top - 5}" x2="${x(beat(measure.at))}" y2="${top + 53}" class="bar-line"/><text x="${x(beat(measure.at)) + 5}" y="${top - 10}" class="measure-number">${measure.number}</text>`);
    });
    part.notes.filter(note => beat(note.at) >= startBeat && beat(note.at) < endBeat).slice(0, 1000).forEach(note => {
      const nx = x(beat(note.at)) + 18;
      const data = `data-note-id="${escapeXml(note.id)}" class="score-note"`;
      if (mode === 'jianpu') {
        const pitch = jianpu(note.pitch);
        const y = top + 26;
        const dots = '•'.repeat(Math.min(4, Math.abs(pitch.octave)));
        shapes.push(`<g ${data}><text x="${nx}" y="${y}" class="jianpu-note" text-anchor="middle">${pitch.accidental}${pitch.number}</text>`);
        if (dots) shapes.push(`<text x="${nx}" y="${pitch.octave > 0 ? y - 28 : y + 16}" class="octave-dots" text-anchor="middle">${dots}</text>`);
        const length = beat(note.duration);
        const beams = length < 0.5 ? 2 : length < 1 ? 1 : 0;
        for (let b = 0; b < beams; b++) shapes.push(`<line x1="${nx - 9}" y1="${y + 6 + b * 5}" x2="${nx + 9}" y2="${y + 6 + b * 5}" class="note-line"/>`);
        if (length > 1) shapes.push(`<text x="${nx + 23}" y="${y}" class="duration-dash">${'–'.repeat(Math.min(6, Math.floor(length) - 1))}</text>`);
        shapes.push('</g>');
      } else if (!note.pitch) {
        shapes.push(`<g ${data}><text x="${nx}" y="${top + 32}" class="rest">𝄽</text></g>`);
      } else {
        const diatonic = (note.pitch.octave - 4) * 7 + STEPS.indexOf(note.pitch.step);
        const ny = top + 60 - diatonic * 6;
        shapes.push(`<g ${data}>`);
        if (ny >= top + 60) for (let ly = top + 60; ly <= ny; ly += 12) shapes.push(`<line x1="${nx - 12}" y1="${ly}" x2="${nx + 12}" y2="${ly}" class="note-line"/>`);
        if (ny <= top - 12) for (let ly = top - 12; ly >= ny; ly -= 12) shapes.push(`<line x1="${nx - 12}" y1="${ly}" x2="${nx + 12}" y2="${ly}" class="note-line"/>`);
        const length = beat(note.duration);
        shapes.push(`<ellipse cx="${nx}" cy="${ny}" rx="8" ry="5.5" transform="rotate(-18 ${nx} ${ny})" class="note-head${length >= 2 ? ' open-head' : ''}"/>`);
        if (length < 4) shapes.push(`<line x1="${nx + 7}" y1="${ny}" x2="${nx + 7}" y2="${ny - 31}" class="note-line"/>`);
        if (length < 1) shapes.push(`<path d="M${nx + 7} ${ny - 31}q18 7 8 18" class="note-flag"/>`);
        if (note.pitch.alter) shapes.push(`<text x="${nx - 23}" y="${ny + 6}" class="accidental">${note.pitch.alter > 0 ? '♯' : '♭'}</text>`);
        shapes.push('</g>');
      }
    });
  });
  if (parts.some(part => part.notes.filter(note => beat(note.at) >= startBeat && beat(note.at) < endBeat).length > 1000)) shapes.push('<text x="14" y="16" class="part-name">Dense fragment: first 1,000 notation events shown; complete score retained for playback/export.</text>');
  return `<svg xmlns="http://www.w3.org/2000/svg" role="img" aria-label="${mode === 'staff' ? 'Basic treble staff pitch view' : 'Fixed C numbered pitch view'}" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}">${shapes.join('')}</svg>`;
}
