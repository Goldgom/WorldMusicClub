/** Pure transport state; scheduling is driven by a single animation loop in app.js. */
export class Transport {
  constructor() { this.reset(); }
  reset() { this.position = 0; this.startedAt = null; this.running = false; this.cursor = 0; this.completed = false; this.hasStarted = false; }
  seek(position) { this.reset(); this.position = position; }
  time(now) { return this.running ? this.position + now - this.startedAt : this.position; }
  start(now, notes, countIn = 0) {
    if (this.running) return;
    if (this.completed) this.reset();
    if (!this.hasStarted) this.position -= Math.max(0, countIn);
    this.hasStarted = true;
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
  wrapLoop(now, notes, {start, end, countIn = 0}) {
    if (!this.running || this.time(now) < end) return {status:'pending'};
    if (![now,start,end,countIn].every(Number.isFinite) || end <= start || countIn < 0) throw new Error('Invalid loop clock range.');
    const boundaryWall = this.startedAt + end - this.position;
    const overshootMs = now - boundaryWall;
    const cycleMs = end - start + countIn;
    this.seek(start);
    // A missed complete pass is an interruption, never silently invented practice history.
    if (overshootMs >= cycleMs) return {status:'stalled',boundaryWall,overshootMs,skippedPasses:Math.floor(overshootMs/cycleMs)};
    this.start(boundaryWall,notes,countIn);
    return {status:'wrapped',boundaryWall,overshootMs,position:this.time(now)};
  }
  finish(duration) { this.position = duration; this.startedAt = null; this.running = false; this.completed = true; }
}

export class Synth {
  constructor() { this.context = null; this.voices = new Map(); this.releasingVoices = new Set(); this.clickVoices = new Map(); this.muted = false; this.output = null; this.droppedVoices = 0; }
  async unlock() {
    const Audio = globalThis.AudioContext || globalThis.webkitAudioContext;
    if (!Audio) throw new Error('Audio is unavailable in this browser. Try a current Chrome, Edge, Firefox or Safari.');
    this.context ||= new Audio();
    if (!this.output) {
      this.output = this.context.createGain(); this.output.gain.value = 0.7;
      if (this.context.createDynamicsCompressor) {
        const compressor = this.context.createDynamicsCompressor(); compressor.threshold.value = -12; compressor.knee.value = 15; compressor.ratio.value = 8; compressor.attack.value = 0.003; compressor.release.value = 0.15; this.output.connect(compressor); compressor.connect(this.context.destination);
      } else this.output.connect(this.context.destination);
    }
    if (this.context.state !== 'running') await this.context.resume();
  }
  play(id, midi, duration = null, delay = 0, timbre = 'piano', velocity = 90) {
    if (!this.context || this.context.state !== 'running' || this.muted) return;
    this.release(id);
    velocity = Number.isFinite(velocity) ? Math.max(0, Math.min(127, velocity)) : 90;
    if (velocity === 0) return;
    // Release tails count against the same budget; retire a tail before a held note.
    if (this.voices.size + this.releasingVoices.size >= 64) {
      this.cancelVoice(this.releasingVoices.values().next().value || this.voices.values().next().value);
      this.droppedVoices++;
    }
    const peak = 0.28 * (velocity / 127) ** 1.5;
    const start = this.context.currentTime + delay / 1000;
    const gain = this.context.createGain();
    const releaseGain = this.context.createGain();
    releaseGain.gain.value = 1;
    const oscillator = this.context.createOscillator();
    oscillator.type = timbre === 'guitar' ? 'triangle' : 'sine';
    oscillator.frequency.value = 440 * 2 ** ((midi - 69) / 12);
    gain.gain.setValueAtTime(0, start);
    gain.gain.linearRampToValueAtTime(peak, start + 0.008);
    gain.gain.exponentialRampToValueAtTime(Math.max(0.0001, peak * 0.4), start + 0.18);
    // A separate unity envelope preserves the instrument's attack/decay automation
    // when a human releases or retriggers a key, including during its attack.
    oscillator.connect(gain); gain.connect(releaseGain); releaseGain.connect(this.output);
    const voice = {id, oscillator, gain, releaseGain, start, stopAt: Infinity};
    this.voices.set(id, voice);
    oscillator.onended = () => this.disposeVoice(voice);
    oscillator.start(start);
    if (duration !== null) {
      const end = start + Math.max(20, duration) / 1000;
      gain.gain.setTargetAtTime(0.0001, end, 0.02);
      voice.stopAt = end + 0.15;
      oscillator.stop(voice.stopAt);
    }
  }
  click(id, accent = false, delay = 0, level = 0.25) {
    if (!Number.isFinite(level) || !Number.isFinite(delay)) throw new Error('Click level and scheduling delay must be finite.');
    if (!this.context || this.context.state !== 'running' || this.muted || level <= 0) return;
    if (this.clickVoices.size >= 8) throw new Error('The click preview exceeded its safe voice budget. Choose a coarser pulse.');
    const start=this.context.currentTime+Math.max(0,delay)/1000;
    const gain=this.context.createGain(),oscillator=this.context.createOscillator();
    oscillator.type='sine';oscillator.frequency.value=accent?1568:1046;
    gain.gain.setValueAtTime(0,start);gain.gain.linearRampToValueAtTime(Math.min(1,level)*0.22,start+0.002);gain.gain.exponentialRampToValueAtTime(0.0001,start+0.035);
    oscillator.connect(gain);gain.connect(this.output);const voice={oscillator,gain};this.clickVoices.set(id,voice);
    oscillator.onended=()=>{oscillator.disconnect();gain.disconnect();if(this.clickVoices.get(id)===voice)this.clickVoices.delete(id)};
    oscillator.start(start);oscillator.stop(start+0.045);
  }
  silenceClicks() {
    for(const voice of this.clickVoices.values()){const now=this.context.currentTime;voice.gain.gain.cancelScheduledValues(now);voice.gain.gain.setValueAtTime(0,now);try{voice.oscillator.stop(now)}catch{/* already ended */}}
    this.clickVoices.clear();
  }
  release(id) {
    const voice = this.voices.get(id);
    if (!voice) return;
    const now = this.context.currentTime;
    // A cancelled future onset must never sound. Already-ended voices also need
    // no tail while their onended callback is waiting for the main thread.
    if (now <= voice.start || now >= voice.stopAt) { this.cancelVoice(voice); return; }
    const end = Math.min(now + 0.012, voice.stopAt);
    voice.releaseGain.gain.setValueAtTime(1, now);
    voice.releaseGain.gain.linearRampToValueAtTime(0, end);
    voice.oscillator.stop(end);
    this.voices.delete(id);
    this.releasingVoices.add(voice);
  }
  disposeVoice(voice) {
    if (voice.disposed) return;
    voice.disposed = true;
    voice.oscillator.disconnect(); voice.gain.disconnect(); voice.releaseGain.disconnect();
    if (this.voices.get(voice.id) === voice) this.voices.delete(voice.id);
    this.releasingVoices.delete(voice);
  }
  cancelVoice(voice) {
    const now = this.context.currentTime;
    voice.gain.gain.cancelScheduledValues(now);
    voice.gain.gain.setValueAtTime(0, now);
    try { voice.oscillator.stop(now); } catch { /* Already ended. */ }
    this.disposeVoice(voice);
  }
  stop(id) {
    const voice = this.voices.get(id);
    if (voice) this.cancelVoice(voice);
    for (const tail of this.releasingVoices) if (tail.id === id) this.cancelVoice(tail);
  }
  silence() {
    for (const voice of [...this.voices.values(), ...this.releasingVoices]) this.cancelVoice(voice);
    this.silenceClicks();
  }
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
