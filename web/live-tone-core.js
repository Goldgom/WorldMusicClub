/** Original, bounded live-input synthesis. These voices have no score identity. */
export const LIVE_TONE_PROTOCOL = 'wmh-live-tone-v1';
export const LIVE_TONE_LIMITS = Object.freeze({maxNotes: 64, maxClicks: 8, maxPending: 128, maxReceipts: 256, maxIdLength: 256, maxToken: 0x7fffffff, maxFrame: 2 ** 48 - 1, maxDelayMs: 600000, maxDurationMs: 3600000, triangleSize: 1024});
const L = LIVE_TONE_LIMITS, TAU = 2 * Math.PI;
const integer = (value, min, max) => Number.isSafeInteger(value) && value >= min && value <= max;
export class LiveToneError extends Error {
  constructor(code, message, details = {}) { super(message); this.name = 'LiveToneError'; this.code = code; this.details = details; }
}
const reject = (code, message) => { throw new LiveToneError(code, message); };
export function liveToneSampleRate(rate) {
  if (!integer(rate, 8000, 384000)) reject('invalid_live_audio_rate', 'The live audio sample rate is unsupported.');
  return rate;
}
export function liveToneId(id) {
  if (typeof id !== 'string' || !id.length || id.length > L.maxIdLength || /[\u0000-\u001f]/.test(id)) reject('invalid_live_audio_command', 'Live audio requires a bounded nonempty string ID.');
  return id;
}
export function validateLiveTonePlay(id, midi, duration, delay, timbre, velocity, rate) {
  liveToneId(id);
  if (!integer(midi, 0, 127) || !Number.isFinite(velocity) || velocity < 0 || velocity > 127 || (timbre !== 'piano' && timbre !== 'guitar') || !Number.isFinite(delay) || delay < 0 || delay > L.maxDelayMs || (duration !== null && (!Number.isFinite(duration) || duration < 0 || duration > L.maxDurationMs))) reject('invalid_live_audio_command', 'Live note pitch, velocity, timbre, duration or delay is outside its supported bounds.');
  if (440 * 2 ** ((midi - 69) / 12) >= rate / 2) reject('unsupported_live_audio_pitch', 'The device sample rate cannot represent this MIDI key.');
}
export function validateLiveToneClick(id, accent, delay, level) {
  liveToneId(id);
  if (typeof accent !== 'boolean' || !Number.isFinite(delay) || delay < 0 || delay > L.maxDelayMs || !Number.isFinite(level) || level < 0 || level > 1) reject('invalid_live_audio_command', 'Click accent, level or delay is outside its supported bounds.');
}
/** Host-side preparation only. Odd Fourier partials are below Nyquist and the
 * table's representable harmonic limit. This is not native Oscillator parity. */
export function buildLiveToneTriangles(sampleRate) {
  liveToneSampleRate(sampleRate);
  const table = new Float32Array(128 * L.triangleSize);
  for (let key = 0; key < 128; key++) {
    const frequency = 440 * 2 ** ((key - 69) / 12);
    const last = Math.min(L.triangleSize / 2 - 1, Math.ceil(sampleRate / (2 * frequency)) - 1);
    for (let harmonic = 1; harmonic <= last; harmonic += 2) {
      const amplitude = 8 / Math.PI ** 2 * (harmonic % 4 === 1 ? 1 : -1) / harmonic ** 2;
      for (let index = 0; index < L.triangleSize; index++) table[key * L.triangleSize + index] += amplitude * Math.sin(TAU * harmonic * index / L.triangleSize);
    }
  }
  return table;
}
const commandFields = Object.freeze({
  initialize: ['triangles'], play: ['token', 'id', 'midi', 'duration', 'delay', 'timbre', 'velocity', 'atFrame'],
  click: ['token', 'id', 'accent', 'delay', 'level', 'atFrame'], release: ['id', 'token'], stop: ['id', 'token'],
  silenceClicks: [], silence: [], snapshot: [], suspend: [], resume: [], close: [],
});
function validateEnvelope(message) {
  if (!message || typeof message !== 'object' || Array.isArray(message) || !Object.hasOwn(commandFields, message.type) || !integer(message.generation, 1, L.maxToken) || !integer(message.requestId, 1, L.maxToken)) reject('invalid_live_audio_command', 'The live audio command envelope is invalid.');
  const allowed = commandFields[message.type];
  if (Object.keys(message).some(key => !['type', 'generation', 'requestId'].includes(key) && !allowed.includes(key))) reject('invalid_live_audio_command', 'The live audio command has an unknown field.');
}
const makeVoice = kind => ({kind, occupied: false, id: '', token: 0, generation: 0, midi: null, requestedStartFrame: 0, start: 0, actualStartFrame: null, actualEndFrame: null, releaseFrame: null, releaseEnd: 0, tailOrder: 0, end: Infinity, gate: Infinity, phase: 0, step: 0, peak: 0, sustain: 0, guitar: false, pcmPeak: 0, pcmEnergy: 0, nonzeroSamples: 0, renderedSamples: 0, firstNonzeroFrame: null, lastRenderedFrame: null, reason: 'duration'});

export class LiveToneCore {
  constructor(sampleRate, {emit = () => {}} = {}) {
    this.sampleRate = liveToneSampleRate(sampleRate); this.emit = emit; this.state = 'uninitialized'; this.generation = 0; this.lastRequestId = 0; this.lastToken = 0; this.tailOrder = 0;
    this.notes = Array.from({length: L.maxNotes}, () => makeVoice('note')); this.clicks = Array.from({length: L.maxClicks}, () => makeVoice('click'));
    this.receipts = new Array(L.maxReceipts); this.receiptHead = 0; this.receiptCount = 0;
    this.started = 0; this.ended = 0; this.droppedVoices = 0; this.activeNotes = 0; this.activeClicks = 0; this.expectedFrame = null; this.previousBlockFrame = null;
    this.pcmPeak = 0; this.pcmEnergy = 0; this.nonzeroSamples = 0; this.renderedSamples = 0;
  }
  receipt(type, voice, frame, reason) {
    const event = {type, source: 'live-tone', generation: voice.generation, token: voice.token, kind: voice.kind, id: voice.id, midi: voice.midi, key: voice.midi, sampleRate: this.sampleRate, frame, requestedStartFrame: voice.requestedStartFrame, actualStartFrame: voice.actualStartFrame, actualEndFrame: voice.actualEndFrame, pcmPeak: voice.pcmPeak, pcmEnergy: voice.pcmEnergy, nonzeroSamples: voice.nonzeroSamples, renderedSamples: voice.renderedSamples, firstNonzeroFrame: voice.firstNonzeroFrame, lastRenderedFrame: voice.lastRenderedFrame, reason};
    this.receipts[this.receiptHead] = event; this.receiptHead = (this.receiptHead + 1) % L.maxReceipts; this.receiptCount = Math.min(L.maxReceipts, this.receiptCount + 1); this.emit(event);
  }
  voiceSnapshot(voice) {
    return {generation: voice.generation, token: voice.token, kind: voice.kind, id: voice.id, midi: voice.midi, key: voice.midi, requestedStartFrame: voice.requestedStartFrame, actualStartFrame: voice.actualStartFrame, releaseFrame: voice.releaseFrame, scheduledEndFrame: Number.isFinite(voice.end) ? voice.end : null, pcmPeak: voice.pcmPeak, pcmEnergy: voice.pcmEnergy, nonzeroSamples: voice.nonzeroSamples, renderedSamples: voice.renderedSamples, firstNonzeroFrame: voice.firstNonzeroFrame, lastRenderedFrame: voice.lastRenderedFrame};
  }
  snapshot(frame) {
    const receipts = [];
    for (let i = 0; i < this.receiptCount; i++) receipts.push(this.receipts[(this.receiptHead - this.receiptCount + i + L.maxReceipts) % L.maxReceipts]);
    return {source: 'live-tone', generation: this.generation, state: this.state, frame, sampleRate: this.sampleRate, started: this.started, ended: this.ended, droppedVoices: this.droppedVoices, activeNotes: this.activeNotes, activeClicks: this.activeClicks, pcmPeak: this.pcmPeak, pcmEnergy: this.pcmEnergy, nonzeroSamples: this.nonzeroSamples, renderedSamples: this.renderedSamples, voices: [...this.notes, ...this.clicks].filter(v => v.occupied).map(v => this.voiceSnapshot(v)), receipts};
  }
  finish(voice, frame, reason) {
    if (!voice.occupied) return;
    voice.actualEndFrame = frame; voice.occupied = false;
    if (voice.kind === 'note') this.activeNotes--; else this.activeClicks--;
    this.ended++; this.receipt('ended', voice, frame, reason); voice.id = '';
  }
  silence(frame, clicksOnly = false, reason = 'silence') {
    if (!clicksOnly) for (const voice of this.notes) this.finish(voice, frame, reason);
    for (const voice of this.clicks) this.finish(voice, frame, reason);
  }
  fail(reason, frame, requestId) {
    if (this.state === 'error' || this.state === 'closed') return;
    this.silence(frame, false, 'error'); this.state = 'error';
    this.emit({type: 'error', generation: this.generation, requestId, frame, code: reason.code || 'live_audio_processor_error', message: reason.message || 'The live audio processor failed.'});
  }
  releaseVoice(voice, frame, reason = 'release') {
    if (!voice.occupied || voice.releaseFrame !== null) return;
    if (voice.actualStartFrame === null || frame <= voice.start || frame >= voice.end) { this.finish(voice, frame, 'canceled'); return; }
    voice.releaseFrame = frame; voice.releaseEnd = Math.min(voice.end, frame + Math.ceil(.012 * this.sampleRate)); voice.end = voice.releaseEnd; voice.tailOrder = ++this.tailOrder; voice.reason = reason;
  }
  assign(voice, message, frame, kind) {
    // Reuse one of 72 preallocated slots; ownership is always a fresh token.
    voice.occupied = true; voice.id = message.id; voice.token = message.token; voice.generation = this.generation; voice.midi = kind === 'note' ? message.midi : null;
    voice.requestedStartFrame = message.atFrame; voice.start = Math.max(frame, message.atFrame); voice.actualStartFrame = null; voice.actualEndFrame = null;
    voice.releaseFrame = null; voice.releaseEnd = 0; voice.tailOrder = 0; voice.phase = 0; voice.guitar = message.timbre === 'guitar';
    voice.pcmPeak = 0; voice.pcmEnergy = 0; voice.nonzeroSamples = 0; voice.renderedSamples = 0; voice.firstNonzeroFrame = null; voice.lastRenderedFrame = null; voice.reason = 'duration';
    if (kind === 'note') {
      voice.step = 440 * 2 ** ((message.midi - 69) / 12) / this.sampleRate;
      voice.peak = .28 * (message.velocity / 127) ** 1.5; voice.sustain = Math.max(.0001, voice.peak * .4);
      voice.gate = message.duration === null ? Infinity : voice.start + Math.ceil(Math.max(20, message.duration) / 1000 * this.sampleRate);
      voice.end = voice.gate + Math.ceil(.15 * this.sampleRate); this.activeNotes++;
    } else {
      voice.step = (message.accent ? 1568 : 1046) / this.sampleRate; voice.peak = message.level * .22;
      voice.gate = Infinity; voice.end = voice.start + Math.ceil(.045 * this.sampleRate); this.activeClicks++;
    }
  }
  handleMessage(message, frame) {
    let requestId;
    try {
      requestId = message?.requestId;
      if (!integer(frame, 0, L.maxFrame)) reject('invalid_live_audio_command', 'The live audio command frame is invalid.');
      validateEnvelope(message);
      if (this.state === 'closed' || this.state === 'error') return;
      if (message.generation < this.generation || message.requestId <= this.lastRequestId) { this.emit({type: 'stale', generation: message.generation, requestId}); return; }
      if (message.type === 'initialize') {
        if (this.state !== 'uninitialized') reject('invalid_live_audio_command', 'The live audio receiver is already initialized.');
        this.generation = message.generation;
        if (!(message.triangles instanceof Float32Array) || message.triangles.length !== 128 * L.triangleSize) reject('invalid_live_audio_command', 'The live triangle bank has the wrong shape.');
        for (const value of message.triangles) if (!Number.isFinite(value) || Math.abs(value) > 1.001) reject('invalid_live_audio_command', 'The live triangle bank exceeds its finite unit bound.');
        this.triangles = message.triangles; this.state = 'ready'; this.lastRequestId = requestId;
        this.emit({type: 'ready', source: 'live-tone', generation: this.generation, requestId, frame, sampleRate: this.sampleRate}); return;
      }
      if (message.type === 'suspend' || message.type === 'close') {
        if (message.generation < this.generation) return;
        this.silence(frame, false, message.type); this.generation = message.generation;
        this.state = message.type === 'close' ? 'closed' : 'suspended'; this.lastRequestId = requestId;
        this.emit({type: 'ack', source: 'live-tone', generation: this.generation, requestId, command: message.type, frame}); return;
      }
      if (message.generation !== this.generation) reject('invalid_live_audio_command', 'The live audio generation was not prepared.');
      if (message.type === 'resume') {
        if (this.state !== 'suspended') reject('invalid_live_audio_command', 'Only suspended live audio can explicitly resume.');
        this.expectedFrame = null; this.previousBlockFrame = null; this.state = 'ready'; this.lastRequestId = requestId;
        this.emit({type: 'ack', source: 'live-tone', generation: this.generation, requestId, command: message.type, frame}); return;
      }
      if (this.state !== 'ready') reject('invalid_live_audio_command', 'The live audio receiver is not ready.');
      if (message.type === 'play' || message.type === 'click') {
        if (!integer(message.token, this.lastToken + 1, L.maxToken) || !integer(message.atFrame, 0, L.maxFrame - this.sampleRate * (L.maxDurationMs + 150) / 1000) || message.atFrame > frame + Math.ceil(L.maxDelayMs * this.sampleRate / 1000)) reject('invalid_live_audio_command', 'The live audio onset or voice token is invalid.');
        if (message.type === 'play') validateLiveTonePlay(message.id, message.midi, message.duration, message.delay, message.timbre, message.velocity, this.sampleRate);
        else validateLiveToneClick(message.id, message.accent, message.delay, message.level);
        this.lastToken = message.token;
        if (message.type === 'play') {
          for (const voice of this.notes) if (voice.occupied && voice.id === message.id && voice.releaseFrame === null) this.releaseVoice(voice, frame, 'retrigger');
          if (message.velocity > 0) {
            let slot = this.notes.find(v => !v.occupied);
            if (!slot) {
              for (const voice of this.notes) if (voice.releaseFrame !== null && (!slot || voice.tailOrder < slot.tailOrder)) slot = voice;
              if (!slot) for (const voice of this.notes) if (!slot || voice.token < slot.token) slot = voice;
              this.finish(slot, frame, 'stolen'); this.droppedVoices++;
            }
            this.assign(slot, message, frame, 'note');
          }
        } else {
          for (const voice of this.clicks) if (voice.occupied && voice.id === message.id) this.finish(voice, frame, 'replaced');
          if (message.level > 0) {
            const slot = this.clicks.find(v => !v.occupied);
            if (!slot) reject('live_audio_click_limit', 'The click preview exceeded its eight-voice budget.');
            this.assign(slot, message, frame, 'click');
          }
        }
      } else if (message.type === 'release' || message.type === 'stop') {
        liveToneId(message.id);
        if (!integer(message.token, 1, L.maxToken)) reject('invalid_live_audio_command', 'The live audio release token is invalid.');
        for (const voice of this.notes) if (voice.occupied && voice.id === message.id && (message.type === 'stop' ? voice.token <= message.token : voice.token === message.token)) {
          if (message.type === 'release') this.releaseVoice(voice, frame); else this.finish(voice, frame, 'stopped');
        }
      } else if (message.type === 'silence' || message.type === 'silenceClicks' || message.type === 'close') {
        this.silence(frame, message.type === 'silenceClicks', message.type);
        if (message.type === 'close') this.state = 'closed';
      }
      this.lastRequestId = requestId;
      if (message.type === 'snapshot') this.emit({type: 'snapshot', requestId, ...this.snapshot(frame)});
      else this.emit({type: 'ack', source: 'live-tone', generation: this.generation, requestId, command: message.type, frame});
    } catch (reason) { this.fail(reason, frame, integer(requestId, 1, L.maxToken) ? requestId : undefined); }
  }
  baseEnvelope(voice, age) {
    const seconds = age / this.sampleRate;
    if (voice.kind === 'click') {
      if (seconds < .002) return voice.peak * seconds / .002;
      return voice.peak * Math.exp(Math.log(.0001 / voice.peak) * Math.min(1, (seconds - .002) / .033));
    }
    if (seconds < .008) return voice.peak * seconds / .008;
    if (seconds < .18) return voice.peak * Math.exp(Math.log(voice.sustain / voice.peak) * (seconds - .008) / .172);
    return voice.sustain;
  }
  sample(voice, frame) {
    let envelope;
    if (frame >= voice.gate) envelope = .0001 + (this.baseEnvelope(voice, voice.gate - voice.start) - .0001) * Math.exp(-(frame - voice.gate) / (.02 * this.sampleRate));
    else envelope = this.baseEnvelope(voice, frame - voice.start);
    if (voice.releaseFrame !== null) envelope *= (voice.releaseEnd - frame) / (voice.releaseEnd - voice.releaseFrame);
    let wave;
    if (voice.guitar) {
      const at = voice.phase * L.triangleSize, index = Math.floor(at), fraction = at - index, base = voice.midi * L.triangleSize;
      const a = this.triangles[base + index], b = this.triangles[base + (index + 1) % L.triangleSize]; wave = a + (b - a) * fraction;
    } else wave = Math.sin(TAU * voice.phase);
    voice.phase += voice.step; if (voice.phase >= 1) voice.phase -= 1;
    const value = Math.fround(wave * envelope); voice.renderedSamples++; voice.lastRenderedFrame = frame;
    voice.pcmPeak = Math.max(voice.pcmPeak, Math.abs(value)); voice.pcmEnergy += value * value;
    if (value !== 0) { voice.nonzeroSamples++; if (voice.firstNonzeroFrame === null) voice.firstNonzeroFrame = frame; }
    return value;
  }
  process(channels, firstFrame) {
    for (const channel of channels) channel.fill(0);
    if (this.state !== 'ready') return true;
    const length = channels[0]?.length ?? 0;
    try {
      if (!integer(firstFrame, 0, L.maxFrame) || !length || channels.some(channel => channel.length !== length) || firstFrame + length > L.maxFrame) reject('live_audio_processor_error', 'The live audio render block is invalid.');
      if ((this.activeNotes || this.activeClicks) && this.expectedFrame !== null && firstFrame !== this.expectedFrame) reject('live_audio_render_discontinuity', 'The live audio sample clock was discontinuous; all live voices were canceled.');
      for (let offset = 0; offset < length; offset++) {
        const frame = firstFrame + offset; let sum = 0;
        for (let kind = 0; kind < 2; kind++) {
          const voices = kind === 0 ? this.notes : this.clicks;
          for (let index = 0; index < voices.length; index++) {
            const voice = voices[index]; if (!voice.occupied || frame < voice.start) continue;
            if (frame >= voice.end) { this.finish(voice, frame, voice.reason); continue; }
            if (voice.actualStartFrame === null) { voice.actualStartFrame = frame; this.started++; this.receipt('started', voice, frame, 'onset'); }
            sum += this.sample(voice, frame);
          }
        }
        const value = Math.fround(sum);
        for (const channel of channels) channel[offset] = value;
        this.renderedSamples++; this.pcmPeak = Math.max(this.pcmPeak, Math.abs(value)); this.pcmEnergy += value * value; if (value !== 0) this.nonzeroSamples++;
      }
      this.previousBlockFrame = firstFrame; this.expectedFrame = firstFrame + length;
    } catch (reason) { for (const channel of channels) channel.fill(0); this.fail(reason, firstFrame); }
    return true; // A connected silent node remains alive until explicit disposal.
  }
}
