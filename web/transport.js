/** Pure transport state; scheduling is driven by a single animation loop in app.js. */
export class Transport {
  constructor() { this.reset(); }
  reset() { this.position = 0; this.startedAt = null; this.running = false; this.cursor = 0; this.completed = false; this.hasStarted = false; }
  seek(position) { this.reset(); this.position = position; }
  // Scheduling, media and notation retain the signed audio admission lead.
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
  pause(now) {
    // Admission lead is not consumed source time and must not become a saved
    // rewind when an initial start or resume is interrupted before its anchor.
    if (this.running && now >= this.startedAt) this.position = this.time(now);
    this.startedAt = null; this.running = false;
  }
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
  constructor({liveToneFactory = (context, output, options) => import('./live-tone-receiver.js').then(({LiveToneReceiver}) => LiveToneReceiver.create(context, output, options)), onError = () => {}, onEvent = () => {}} = {}) {
    this.context = null; this.voices = new Map(); this.releasingVoices = new Set(); this.clickVoices = new Map(); this.muted = false; this.output = null; this.droppedVoices = 0;
    this.liveToneFactory = liveToneFactory; this.onError = onError; this.onEvent = onEvent;
    this.liveReceiver = null; this.livePreparation = null; this.liveRequired = false; this.liveError = null; this.disposed = false;
  }
  async unlock({live=true}={}) {
    const Audio = globalThis.AudioContext || globalThis.webkitAudioContext;
    if (!Audio && !this.context) throw new Error('Audio is unavailable in this browser. Try a current Chrome, Edge, Firefox or Safari.');
    if (this.disposed) throw new Error('The audio output is closed.');
    this.context ||= new Audio();
    if (live && this.liveError) throw this.liveError;
    if (this.liveRequired && this.context.state === 'closed') throw this.rememberLiveFailure(Object.assign(new Error('The audio device is closed; reopen the app before using sound again.'), {code: 'live_audio_closed'}));
    if (!this.output) {
      this.output = this.context.createGain(); this.output.gain.value = 0.7;
      if (this.context.createDynamicsCompressor) {
        const compressor = this.context.createDynamicsCompressor(); compressor.threshold.value = -12; compressor.knee.value = 15; compressor.ratio.value = 8; compressor.attack.value = 0.003; compressor.release.value = 0.15; this.output.connect(compressor); compressor.connect(this.context.destination);
      } else this.output.connect(this.context.destination);
    }
    if (this.context.state !== 'running') await this.context.resume();
    // A procedural machine-only source may reuse the device/output even when
    // the separate live receiver failed. Its terminal error is never cleared;
    // manual play and ordinary unlock still require the live receiver.
    if (!live) return;
    // Once selected, live input cannot fall back to graph-changing oscillators.
    // Waiting here also lets the app's contact token fence a key released while
    // the persistent receiver was still preparing or recovering its device.
    if (this.livePreparation) await this.livePreparation;
    if (this.liveError) throw this.liveError;
    if (this.liveResume) await this.liveResume;
    if (this.liveReceiver?.state === 'interrupted') await this.resumeLiveAudio();
  }
  async resumeLiveAudio() {
    if (this.liveResume) return this.liveResume;
    const pending = Promise.resolve().then(() => this.liveReceiver.resume());
    this.liveResume = pending;
    try { return await pending; } finally { if (this.liveResume === pending) this.liveResume = null; }
  }
  async prepareLiveAudio() {
    if (this.disposed) throw new Error('The audio output is closed.');
    if (this.liveError) throw this.liveError;
    if (this.livePreparation) return this.livePreparation;
    if (this.liveReceiver) {
      if (this.liveResume) await this.liveResume;
      if (this.liveReceiver.state === 'interrupted') await this.resumeLiveAudio();
      if (this.liveReceiver.state !== 'ready') throw Object.assign(new Error('The persistent live input receiver is not ready.'), {code: 'live_audio_unavailable'});
      return this.liveReceiver;
    }
    if (!this.context || this.context.state !== 'running' || !this.output) throw Object.assign(new Error('Unlock the audio device before preparing live input.'), {code: 'live_audio_unavailable'});
    // Retire every legacy connection before the source renderer builds a plan.
    // In particular, pending click onended callbacks must not disconnect later.
    this.silence(); this.liveRequired = true;
    const context = this.context, output = this.output;
    const pending = Promise.resolve().then(() => this.liveToneFactory(context, output, {
      onError: error => this.liveFailed(error),
      onEvent: event => this.liveEvent(event),
    })).then(receiver => {
      if (this.disposed || this.context !== context || this.output !== output) {
        receiver.dispose();
        throw Object.assign(new Error('Live input preparation was canceled.'), {code: 'live_audio_canceled'});
      }
      this.liveReceiver = receiver;
      return receiver;
    }).catch(error => { throw this.rememberLiveFailure(error); });
    this.livePreparation = pending;
    try { return await pending; } finally { if (this.livePreparation === pending) this.livePreparation = null; }
  }
  rememberLiveFailure(error) {
    if (error?.code === 'live_audio_interrupted' && this.context?.state === 'closed') error = Object.assign(new Error('The audio device is closed; reopen the app before using sound again.'), {code: 'live_audio_closed', cause: error});
    if (!this.disposed && error?.code !== 'live_audio_interrupted') this.liveError = error;
    return error;
  }
  liveFailed(error) {
    // Device suspension is recoverable only through an explicit user unlock.
    // Processor failures remain visible and may never switch to legacy audio.
    error = this.rememberLiveFailure(error);
    for (const voice of [...this.voices.values(), ...this.releasingVoices, ...this.clickVoices.values()]) voice.disposed = true;
    this.voices.clear(); this.releasingVoices.clear(); this.clickVoices.clear();
    this.onError(error);
  }
  liveEvent(event) {
    if (event.type === 'ended') {
      if (event.reason === 'stolen') this.droppedVoices++;
      for (const voice of [...this.voices.values(), ...this.releasingVoices, ...this.clickVoices.values()]) {
        if (voice.liveToken !== event.token) continue;
        voice.disposed = true;
        if (this.voices.get(voice.id) === voice) this.voices.delete(voice.id);
        if (this.clickVoices.get(voice.id) === voice) this.clickVoices.delete(voice.id);
        this.releasingVoices.delete(voice);
      }
    }
    this.onEvent(event);
  }
  play(id, midi, duration = null, delay = 0, timbre = 'piano', velocity = 90) {
    if (!this.context || this.context.state !== 'running' || this.muted) return;
    velocity = Number.isFinite(velocity) ? Math.max(0, Math.min(127, velocity)) : 90;
    if (this.liveRequired) {
      if (this.liveError) throw this.liveError;
      if (this.liveReceiver?.state !== 'ready') return;
      this.release(id);
      const liveToken = this.liveReceiver.play(id, midi, duration, delay, timbre, velocity);
      if (liveToken !== null) this.voices.set(id, {id, liveToken});
      return liveToken;
    }
    this.release(id);
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
    if (this.liveRequired) {
      if (this.liveError) throw this.liveError;
      if (this.liveReceiver?.state !== 'ready') return;
      const liveToken = this.liveReceiver.click(id, accent, Math.max(0, delay), Math.min(1, level));
      if (liveToken !== null) this.clickVoices.set(id, {id, liveToken});
      return liveToken;
    }
    const previous = this.clickVoices.get(id);
    if (previous) this.cancelClick(previous);
    if (this.clickVoices.size >= 8) throw new Error('The click preview exceeded its safe voice budget. Choose a coarser pulse.');
    const start=this.context.currentTime+Math.max(0,delay)/1000;
    const gain=this.context.createGain(),oscillator=this.context.createOscillator();
    oscillator.type='sine';oscillator.frequency.value=accent?1568:1046;
    gain.gain.setValueAtTime(0,start);gain.gain.linearRampToValueAtTime(Math.min(1,level)*0.22,start+0.002);gain.gain.exponentialRampToValueAtTime(0.0001,start+0.035);
    oscillator.connect(gain);gain.connect(this.output);const voice={id,oscillator,gain};this.clickVoices.set(id,voice);
    oscillator.onended=()=>this.disposeClick(voice);
    oscillator.start(start);oscillator.stop(start+0.045);
  }
  silenceClicks() {
    if (this.liveRequired) { if (this.liveReceiver?.state === 'ready') this.liveReceiver.silenceClicks(); for (const voice of this.clickVoices.values()) voice.disposed = true; this.clickVoices.clear(); return; }
    for(const voice of this.clickVoices.values()) this.cancelClick(voice);
    this.clickVoices.clear();
  }
  cancelClick(voice) {
    const now = this.context.currentTime;
    voice.gain.gain.cancelScheduledValues(now); voice.gain.gain.setValueAtTime(0, now);
    try { voice.oscillator.stop(now); } catch { /* Already ended. */ }
    this.disposeClick(voice);
  }
  disposeClick(voice) {
    if (voice.disposed) return;
    voice.disposed = true; voice.oscillator.disconnect(); voice.gain.disconnect();
    if (this.clickVoices.get(voice.id) === voice) this.clickVoices.delete(voice.id);
  }
  release(id) {
    const voice = this.voices.get(id);
    if (!voice) return;
    if (this.liveRequired) {
      if (this.liveReceiver?.state === 'ready') this.liveReceiver.release(id);
      this.voices.delete(id); this.releasingVoices.add(voice);
      return;
    }
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
    if (this.liveRequired) {
      if (this.liveReceiver?.state === 'ready') this.liveReceiver.stop(id);
      const voice = this.voices.get(id); if (voice) voice.disposed = true;
      this.voices.delete(id);
      for (const tail of this.releasingVoices) if (tail.id === id) { tail.disposed = true; this.releasingVoices.delete(tail); }
      return;
    }
    const voice = this.voices.get(id);
    if (voice) this.cancelVoice(voice);
    for (const tail of this.releasingVoices) if (tail.id === id) this.cancelVoice(tail);
  }
  silence() {
    if (this.liveRequired) {
      if (this.liveReceiver?.state === 'ready') this.liveReceiver.silence();
      for (const voice of [...this.voices.values(), ...this.releasingVoices, ...this.clickVoices.values()]) voice.disposed = true;
      this.voices.clear(); this.releasingVoices.clear(); this.clickVoices.clear();
      return;
    }
    for (const voice of [...this.voices.values(), ...this.releasingVoices]) this.cancelVoice(voice);
    this.silenceClicks();
  }
  dispose() {
    if (this.disposed) return;
    this.silence(); this.disposed = true; this.liveReceiver?.dispose();
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
