// Original exercise composed for this prototype. No third-party score data.
export const DEGREES = Object.freeze([
  { degree: 1, pitch: 60, name: 'C4', solfege: 'Do', string: 2, fret: 1 },
  { degree: 2, pitch: 62, name: 'D4', solfege: 'Re', string: 2, fret: 3 },
  { degree: 3, pitch: 64, name: 'E4', solfege: 'Mi', string: 2, fret: 5 },
  { degree: 4, pitch: 65, name: 'F4', solfege: 'Fa', string: 2, fret: 6 },
  { degree: 5, pitch: 67, name: 'G4', solfege: 'Sol', string: 2, fret: 8 },
  { degree: 6, pitch: 69, name: 'A4', solfege: 'La', string: 2, fret: 10 },
  { degree: 7, pitch: 71, name: 'B4', solfege: 'Si', string: 2, fret: 12 },
].map(Object.freeze));
const melody = [1, 2, 3, 5, 3, 2, 1, 2, 3, 4, 5, 6, 5, 3, 2, 1, 1, 3, 5, 7, 6, 5, 4, 3, 2, 4, 6, 5, 3, 2, 1, 1];
export const EXERCISE = Object.freeze(melody.map((degree, index) => Object.freeze({
  ...DEGREES[degree - 1], id: `original-${index + 1}`, beat: index, duration: 0.82, measure: Math.floor(index / 4) + 1,
})));
export const TOTAL_BEATS = 32;
export const OPEN_STRINGS = Object.freeze([64, 59, 55, 50, 45, 40]);
export function pitchName(pitch) {
  return `${['C', 'C♯', 'D', 'D♯', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'A♯', 'B'][pitch % 12]}${Math.floor(pitch / 12) - 1}`;
}
export function formatTime(seconds) {
  const safe = Math.max(0, Math.floor(seconds));
  return `${Math.floor(safe / 60)}:${String(safe % 60).padStart(2, '0')}`;
}

// A presentation-only clock; production must replace this with session snapshots.
export class PracticeModel {
  constructor(now = () => performance.now()) {
    this.now = now;
    this.mode = 'guided';
    this.status = 'ready';
    this.bpm = 96;
    this.anchor = this.now();
    this.offset = 0;
    this.inputs = [];
    this.inputCount = 0;
  }
  position() {
    const elapsed = this.status === 'playing' ? Math.max(0, this.now() - this.anchor) / 1000 : 0;
    return this.mode === 'guided' ? Math.min(TOTAL_BEATS, this.offset + elapsed * this.bpm / 60) : this.offset + elapsed;
  }
  snapshot() {
    const position = this.position();
    if (this.mode === 'guided' && position >= TOTAL_BEATS && this.status === 'playing') {
      this.offset = TOTAL_BEATS;
      this.status = 'finished';
    }
    const index = this.mode === 'guided' ? Math.min(EXERCISE.length - 1, Math.floor(position)) : -1;
    return {
      mode: this.mode, status: this.status, position, bpm: this.bpm,
      note: index >= 0 ? EXERCISE[index] : null,
      index, measure: index >= 0 ? EXERCISE[index].measure : null,
      progress: this.mode === 'guided' ? position / TOTAL_BEATS : 0,
      seconds: this.mode === 'guided' ? position * 60 / this.bpm : position,
      durationSeconds: this.mode === 'guided' ? TOTAL_BEATS * 60 / this.bpm : null,
      inputCount: this.inputCount,
    };
  }
  play() {
    this.snapshot();
    if (this.status === 'playing') return;
    if (this.status === 'finished') this.reset();
    this.anchor = this.now();
    this.status = 'playing';
  }
  pause() {
    const snapshot = this.snapshot();
    this.offset = snapshot.position;
    if (this.status === 'playing') this.status = 'paused';
  }
  reset(mode = this.mode) {
    this.mode = mode === 'free' ? 'free' : 'guided';
    this.status = 'ready';
    this.offset = 0;
    this.anchor = this.now();
    this.inputs = [];
    this.inputCount = 0;
  }
  seek(beat) {
    if (this.mode !== 'guided' || !Number.isFinite(beat)) return;
    this.offset = Math.min(TOTAL_BEATS, Math.max(0, beat));
    this.anchor = this.now();
    if (this.offset >= TOTAL_BEATS) this.status = 'finished';
    else if (this.status === 'finished') this.status = 'paused';
  }
  setTempo(bpm) {
    if (!Number.isFinite(bpm)) return;
    this.offset = this.position();
    this.anchor = this.now();
    this.bpm = Math.min(140, Math.max(60, Math.round(bpm)));
  }
  input(pitch, source) {
    this.snapshot();
    if (!Number.isInteger(pitch) || pitch < 0 || pitch > 127 || this.status !== 'playing') return false;
    this.inputCount++;
    this.inputs.push({ pitch, source, position: this.position() });
    // Explicitly a bounded recent-input view, not a persistent take or assessment.
    if (this.inputs.length > 32) this.inputs.shift();
    return true;
  }
}
