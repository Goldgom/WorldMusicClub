import {BASIC_KEY_AUDIO_LIMITS as LIMITS, BasicKeyAudioError, basicKeySampleRate, decodeBasicKeyAudioPlan} from './basic-key-audio-plan.js';

const integer = (value, min, max) => Number.isSafeInteger(value) && value >= min && value <= max;
const reject = (code, message) => { throw new BasicKeyAudioError(code, message); };
const TAU = 2 * Math.PI;

/** Shared by the actual AudioWorkletProcessor and the block-by-block tests.
 * No clock polling, DOM, timers, per-note nodes, or allocations in the sample
 * loop. Fixed voice slots are assigned to attacks, never to MIDI key numbers.
 */
export class BasicKeyAudioCore {
  constructor(sampleRate, {emit = () => {}, trace = null} = {}) {
    this.sampleRate = basicKeySampleRate(sampleRate); this.emit = emit; this.trace = trace;
    this.generation = 0; this.state = 'idle'; this.plan = null; this.planGeneration = 0;
    this.activeCount = 0; this.startedCount = 0; this.endedCount = 0; this.skippedCount = 0; this.cursor = 0;
    this.voiceSlots = Array.from({length: LIMITS.maxVoices}, () => ({note: -1, start: 0, end: 0, phase: 0, step: 0, peak: 0, drum: false, noiseIndex: 0, x1: 0, x2: 0, y1: 0, y2: 0}));
    this.activeSlots = new Uint8Array(LIMITS.maxVoices); this.freeSlots = new Uint8Array(LIMITS.maxVoices);
    this.resetSlots();
    this.noise = new Float32Array(Math.floor(sampleRate / 2));
    let random = 0x574d4801;
    for (let index = 0; index < this.noise.length; index++) { random ^= random << 13; random ^= random >>> 17; random ^= random << 5; this.noise[index] = (random >>> 0) / 2147483648 - 1; }
    // Web Audio bandpass, constant peak gain, at the disclosed 1500 Hz / Q=.7.
    const omega = TAU * 1500 / sampleRate, alpha = Math.sin(omega) / (2 * .7), divisor = 1 + alpha;
    this.b0 = alpha / divisor; this.a1 = -2 * Math.cos(omega) / divisor; this.a2 = (1 - alpha) / divisor;
  }
  resetSlots() { this.activeCount = 0; this.freeCount = LIMITS.maxVoices; for (let i = 0; i < LIMITS.maxVoices; i++) this.freeSlots[i] = LIMITS.maxVoices - 1 - i; }
  snapshot(frame) {
    return {generation: this.generation, planGeneration: this.planGeneration, state: this.state, sourceSha256: this.plan?.sourceSha256 ?? null, sampleRate: this.sampleRate, frame, anchorFrame: this.anchorFrame ?? null, positionFrame: this.positionFrame ?? null, durationFrames: this.plan?.durationFrames ?? 0, sourceNotes: this.plan?.sourceNotes ?? 0, notes: this.plan?.notes.length ?? 0, eligibleNotes: this.order?.length ?? 0, started: this.startedCount, ended: this.endedCount, skipped: this.skippedCount, active: this.activeCount};
  }
  completion(frame) {
    return {...this.snapshot(frame), ledger: this.plan && this.actualStarts ? {actualStarts: this.actualStarts.slice(), actualEnds: this.actualEnds.slice()} : null};
  }
  finishVoice(activeIndex, frame, reason) {
    const slot = this.activeSlots[activeIndex], voice = this.voiceSlots[slot];
    this.actualEnds[voice.note] = frame; this.endedCount++;
    if (this.trace) this.trace({type: 'end', index: voice.note, frame, reason, generation: this.planGeneration});
    this.freeSlots[this.freeCount++] = slot;
    this.activeSlots[activeIndex] = this.activeSlots[--this.activeCount];
  }
  silence(frame, reason) { while (this.activeCount) this.finishVoice(this.activeCount - 1, frame, reason); }
  fail(error, frame, requestId) {
    this.silence(frame, 'error'); this.state = 'error';
    this.emit({type: 'error', requestId, ...this.snapshot(frame), code: error.code || 'audio_processor_error', message: error.message || String(error)});
  }
  handleMessage(message, frame) {
    const requestId = message?.requestId;
    try {
      if (!integer(frame, 0, LIMITS.maxFrame) || !message || !integer(message.generation, 1, LIMITS.maxGeneration)) reject('invalid_audio_command', 'The audio command has an invalid generation or frame.');
      if (message.generation < this.generation) { this.emit({type: 'stale', generation: message.generation, requestId}); return; }
      if (message.type === 'prepare' || message.type === 'cancel') {
        if (message.generation <= this.generation) { this.emit({type: 'stale', generation: message.generation, requestId}); return; }
        this.silence(frame, 'cancel'); this.state = 'canceled';
        if (message.type === 'prepare' && this.plan) this.emit({type: 'canceled', reason: 'prepare_replaced', ...this.completion(frame)});
        this.generation = message.generation;
        if (message.type === 'cancel') { this.emit({type: 'canceled', requestId, reason: message.reason, ...this.completion(frame)}); return; }
        this.plan = null; this.planGeneration = this.generation; this.order = null;
        this.startedCount = 0; this.endedCount = 0; this.skippedCount = 0; this.cursor = 0;
        const plan = decodeBasicKeyAudioPlan(message.wire);
        if (plan.sampleRate !== this.sampleRate) reject('unsupported_audio_sample_rate', 'The prepared plan does not match this audio device sample rate.');
        if (!integer(message.positionFrame, -600 * this.sampleRate, plan.durationFrames)) reject('invalid_audio_command', 'The prepared source position exceeds the rendition or ten-minute count-in bound.');
        this.plan = plan; this.positionFrame = message.positionFrame; this.anchorFrame = null;
        const order = [];
        for (let index = 0; index < plan.notes.length; index++) if (plan.notes[index][3] > this.positionFrame) order.push(index); else this.skippedCount++;
        this.order = Uint32Array.from(order);
        this.actualStarts = new Float64Array(plan.notes.length); this.actualStarts.fill(-1);
        this.actualEnds = new Float64Array(plan.notes.length); this.actualEnds.fill(-1);
        this.steps = new Float64Array(plan.notes.length);
        for (let index = 0; index < plan.notes.length; index++) this.steps[index] = TAU * 440 * 2 ** ((plan.notes[index][4] - 69) / 12) / this.sampleRate;
        this.state = 'ready'; this.emit({type: 'ready', requestId, ...this.snapshot(frame)}); return;
      }
      if (message.generation !== this.generation) reject('invalid_audio_command', 'The audio generation was not prepared.');
      if (message.type === 'start') {
        if (this.state !== 'ready') reject('invalid_audio_command', 'Only a ready audio generation can start.');
        if (!integer(message.anchorFrame, frame + 1, Math.min(LIMITS.maxFrame, frame + Math.ceil(this.sampleRate * .1)))) reject('clean_late_start', 'The start anchor must be in the future and within the declared 100 ms lead.');
        if (!integer(message.anchorFrame + this.plan.durationFrames - this.positionFrame, 0, LIMITS.maxFrame)) reject('invalid_audio_command', 'The anchored rendition exceeds the exact audio frame range.');
        this.anchorFrame = message.anchorFrame; this.expectedFrame = null; this.state = 'running';
        this.emit({type: 'started', requestId, ...this.snapshot(frame)}); return;
      }
      if (message.type === 'snapshot') { this.emit({type: 'snapshot', requestId, ...this.snapshot(frame)}); return; }
      if (message.type === 'audit') {
        if (!this.plan || !integer(message.offset, 0, this.plan.notes.length) || !integer(message.count, 1, LIMITS.maxAuditRows)) reject('invalid_audio_command', 'The audit request exceeds its bounded page size.');
        const end = Math.min(this.plan.notes.length, message.offset + message.count), rows = [];
        for (let index = message.offset; index < end; index++) {
          const note = this.plan.notes[index];
          rows.push({index, noteId: note[0], eventId: note[1], startFrame: note[2], endFrame: note[3], actualStartFrame: this.actualStarts[index], actualEndFrame: this.actualEnds[index]});
        }
        this.emit({type: 'audit', requestId, ...this.snapshot(frame), offset: message.offset, nextOffset: end, rows}); return;
      }
      reject('invalid_audio_command', 'Unknown basic audio receiver command.');
    } catch (error) { this.fail(error, frame, requestId); }
  }
  attack(index, frame) {
    if (!this.freeCount) reject('voice_budget_exceeded', 'The audio renderer exhausted its 128 voice slots; no voice was stolen.');
    const slot = this.freeSlots[--this.freeCount], voice = this.voiceSlots[slot], note = this.plan.notes[index];
    voice.note = index; voice.start = frame; voice.end = this.anchorFrame + note[3] - this.positionFrame;
    voice.step = this.steps[index]; voice.phase = voice.step / 2; voice.peak = .08 * note[5] / 127; voice.drum = note[6] === 1;
    voice.noiseIndex = 0; voice.x1 = 0; voice.x2 = 0; voice.y1 = 0; voice.y2 = 0;
    this.activeSlots[this.activeCount++] = slot; this.actualStarts[index] = frame; this.startedCount++;
    if (this.trace) this.trace({type: 'start', index, frame, generation: this.planGeneration});
  }
  sample(voice, frame) {
    // Midpoint sampling gives even a one-sample gate a real attack sample.
    const length = voice.end - voice.start, age = frame - voice.start + .5;
    const attack = Math.min(.004 * this.sampleRate, length / 3), release = Math.min(.02 * this.sampleRate, length / 3);
    const sustainAt = voice.drum ? Math.min(.12 * this.sampleRate, length - release) : length - release;
    const sustain = voice.drum ? voice.peak * .12 : voice.peak;
    let level;
    if (age < attack) level = voice.peak * age / attack;
    else if (age < sustainAt) level = voice.peak + (sustain - voice.peak) * (age - attack) / (sustainAt - attack);
    else if (age < length - release) level = sustain;
    else level = sustain * (length - age) / release;
    let value;
    if (voice.drum) {
      const x = this.noise[voice.noiseIndex++]; if (voice.noiseIndex === this.noise.length) voice.noiseIndex = 0;
      value = this.b0 * (x - voice.x2) - this.a1 * voice.y1 - this.a2 * voice.y2;
      voice.x2 = voice.x1; voice.x1 = x; voice.y2 = voice.y1; voice.y1 = value;
    } else { value = Math.sin(voice.phase); voice.phase += voice.step; if (voice.phase >= TAU) voice.phase -= TAU; }
    return value * level;
  }
  process(channels, firstFrame) {
    for (const channel of channels) channel.fill(0);
    if (this.state !== 'running') return true;
    const length = channels[0]?.length ?? 0;
    try {
      if (!integer(firstFrame, 0, LIMITS.maxFrame) || !length || channels.some(channel => channel.length !== length)) reject('audio_processor_error', 'The audio render block is invalid.');
      if (this.expectedFrame !== null && firstFrame !== this.expectedFrame) reject('audio_render_discontinuity', 'The audio render sample clock was discontinuous.');
      this.expectedFrame = firstFrame + length;
      const sourceEnd = this.anchorFrame + this.plan.durationFrames - this.positionFrame;
      for (let offset = 0; offset < length; offset++) {
        const frame = firstFrame + offset;
        for (let index = this.activeCount - 1; index >= 0; index--) if (this.voiceSlots[this.activeSlots[index]].end <= frame) this.finishVoice(index, frame, 'gate');
        if (frame < this.anchorFrame) continue;
        while (this.cursor < this.order.length) {
          const index = this.order[this.cursor], onset = this.anchorFrame + Math.max(this.plan.notes[index][2], this.positionFrame) - this.positionFrame;
          if (onset > frame) break;
          if (onset < frame) reject('audio_render_discontinuity', 'The audio thread missed a prepared attack; playback stops without catch-up.');
          this.attack(index, frame); this.cursor++;
        }
        if (frame >= sourceEnd) {
          if (this.activeCount || this.cursor !== this.order.length) reject('audio_processor_error', 'Natural end disagrees with the complete gate plan.');
          this.state = 'ended'; this.emit({type: 'ended', ...this.completion(frame)}); break;
        }
        let sum = 0;
        for (let index = 0; index < this.activeCount; index++) sum += this.sample(this.voiceSlots[this.activeSlots[index]], frame);
        for (const channel of channels) channel[offset] = sum;
      }
    } catch (error) { for (const channel of channels) channel.fill(0); this.fail(error, firstFrame); }
    return true; // Keep an idle node available for explicit fresh generations.
  }
}
