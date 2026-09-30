/** Pure transport state; scheduling is driven by a single animation loop in app.js. */
export class Transport {
  constructor() { this.reset(); }
  reset() { this.position = 0; this.startedAt = null; this.running = false; this.cursor = 0; this.completed = false; }
  time(now) { return this.running ? this.position + now - this.startedAt : this.position; }
  start(now, notes, countIn = 0) {
    if (this.running) return;
    if (this.completed) this.reset();
    if (this.position === 0) this.position = -Math.max(0, countIn);
    this.cursor = notes.findIndex(n => n.start_ms + n.duration_ms > this.position);
    if (this.cursor < 0) this.cursor = notes.length;
    this.startedAt = now;
    this.running = true;
  }
  pause(now) { this.position = this.time(now); this.startedAt = null; this.running = false; }
  due(now, notes, lookAhead = 100) {
    if (!this.running) return [];
    const position = this.time(now);
    const due = [];
    while (this.cursor < notes.length && notes[this.cursor].start_ms <= position + lookAhead) {
      const note = notes[this.cursor++];
      const end = note.start_ms + note.duration_ms;
      if (end > position) due.push({...note, delay_ms: Math.max(0, note.start_ms - position), remaining_ms: end - Math.max(position, note.start_ms)});
    }
    return due;
  }
  finish(duration) { this.position = duration; this.startedAt = null; this.running = false; this.completed = true; }
}

export class Synth {
  constructor() { this.context = null; this.voices = new Map(); this.muted = false; }
  async unlock() {
    const Audio = globalThis.AudioContext || globalThis.webkitAudioContext;
    if (!Audio) throw new Error('Audio is unavailable in this browser. Try a current Chrome, Edge, Firefox or Safari.');
    this.context ||= new Audio();
    if (this.context.state !== 'running') await this.context.resume();
  }
  play(id, midi, duration = null, delay = 0, timbre = 'piano') {
    if (!this.context || this.context.state !== 'running' || this.muted) return;
    this.stop(id);
    const start = this.context.currentTime + delay / 1000;
    const gain = this.context.createGain();
    const oscillator = this.context.createOscillator();
    oscillator.type = timbre === 'guitar' ? 'triangle' : 'sine';
    oscillator.frequency.value = 440 * 2 ** ((midi - 69) / 12);
    gain.gain.setValueAtTime(0, start);
    gain.gain.linearRampToValueAtTime(0.2, start + 0.008);
    gain.gain.exponentialRampToValueAtTime(0.08, start + 0.18);
    oscillator.connect(gain); gain.connect(this.context.destination);
    const voice = {oscillator, gain, start};
    this.voices.set(id, voice);
    oscillator.onended = () => { oscillator.disconnect(); gain.disconnect(); if (this.voices.get(id) === voice) this.voices.delete(id); };
    oscillator.start(start);
    if (duration !== null) {
      const end = start + Math.max(20, duration) / 1000;
      gain.gain.setTargetAtTime(0.0001, end, 0.02);
      oscillator.stop(end + 0.15);
    }
  }
  stop(id) {
    const voice = this.voices.get(id);
    if (!voice) return;
    const now = this.context.currentTime;
    voice.gain.gain.cancelScheduledValues(now);
    voice.gain.gain.setValueAtTime(0, now);
    try { voice.oscillator.stop(now); } catch { /* Already ended. */ }
    this.voices.delete(id);
  }
  silence() { for (const id of [...this.voices.keys()]) this.stop(id); }
}

/** Window queries avoid scanning a long score on every animation frame. */
export class TimelineIndex {
  constructor(notes) {
    this.notes = notes;
    let end = -Infinity;
    this.maxEnds = notes.map(note => (end = Math.max(end, note.start_ms + note.duration_ms)));
  }
  range(from, to = from) {
    let low = 0, high = this.notes.length;
    while (low < high) { const mid = (low + high) >>> 1; if (this.maxEnds[mid] <= from) low = mid + 1; else high = mid; }
    const first = low;
    low = first; high = this.notes.length;
    while (low < high) { const mid = (low + high) >>> 1; if (this.notes[mid].start_ms <= to) low = mid + 1; else high = mid; }
    return this.notes.slice(first, low).filter(note => note.start_ms + note.duration_ms > from);
  }
}
