import {BASIC_KEY_AUDIO_LIMITS as LIMITS, BASIC_KEY_TIMBRE_PROFILE, BASIC_KEY_SYNTHETIC_INSTRUMENTS, BasicKeyAudioError, basicKeySampleRate, openBasicKeyAudioTransfer, VSQ_AUDIO_IDENTITY, VSQ_TRIANGLE_SIZE, audioTransferIdentity, compareAudioTransferIdentity, basicKeyTimbreHasher, hashBasicKeyTimbreRow, basicKeyAssistanceHasher, hashBasicKeyAssistanceRow} from './basic-key-audio-plan.js';

import {MAX_AUDIO_START_LEAD_SECONDS} from './audio-start-lead.js';
const integer = (value, min, max) => Number.isSafeInteger(value) && value >= min && value <= max;
const reject = (code, message, details) => { throw new BasicKeyAudioError(code, message, details); };
const TAU = 2 * Math.PI;
// Finite synthetic colors only, with no sample assets or acoustic models.
const TRIANGLE = Object.freeze([0, 1, 0, -1 / 9, 0, 1 / 25, 0, -1 / 49, 0, 1 / 81]);
const REED = Object.freeze([0, 1, .55, .4, .2, .15, .1, .08, .05, .03]);
function validateTimbreCommand(message, plan) {
  if (message.expectedAssistanceFingerprint !== undefined || message.expectedAssistancePlanFingerprint !== undefined) {
    if (message.expectedAssistanceFingerprint !== (plan.assistanceFingerprint ?? null) || message.expectedAssistancePlanFingerprint !== (plan.assistancePlanFingerprint ?? null)) reject('audio_assistance_fingerprint', 'The prepared ownership identity differs from the requested assistance selection.');
  }
  // The host's independent command binding must survive removal of the
  // optional wire extension. ACKs also carry the actual validated identity.
  if (message.expectedTimbreProfile === undefined && message.expectedTimbreFingerprint === undefined) return;
  if (message.expectedTimbreProfile !== (plan.timbreProfile ?? null) || message.expectedTimbreFingerprint !== (plan.timbreFingerprint ?? null)) reject('audio_timbre_fingerprint', 'The prepared synthetic color identity differs from the requested selection.');
}

/** Shared by the actual AudioWorkletProcessor and the block-by-block tests.
 * No clock polling, DOM, timers, per-note nodes, or allocations in the sample
 * loop. Fixed voice slots are assigned to attacks, never to MIDI key numbers.
 */
export class BasicKeyAudioCore {
  constructor(sampleRate, {emit = () => {}, trace = null, profile = null} = {}) {
    this.profile = profile; this.limits = profile?.limits || LIMITS;
    this.sampleRate = basicKeySampleRate(sampleRate); this.emit = emit; this.trace = trace;
    this.generation = 0; this.state = 'idle'; this.plan = null; this.planGeneration = 0;
    this.activeCount = 0; this.startedCount = 0; this.endedCount = 0; this.skippedCount = 0; this.cursor = 0;
    this.previousBlockFrame = null; this.previousBlockLength = 0; this.successfulBlocks = 0;
    this.voiceSlots = Array.from({length: this.limits.maxVoices}, () => ({note: -1, start: 0, end: 0, phase: 0, step: 0, peak: 0, drum: false, timbre: 0, timbreHarmonicLimit: 1, timbreHarmonicScale: 1, vsqRatio: 0, harmonicPhase: 0, triangleOffset: 0, noiseIndex: 0, noiseState: 0x574d4801, x1: 0, x2: 0, y1: 0, y2: 0}));
    this.activeSlots = new Uint8Array(this.limits.maxVoices); this.freeSlots = new Uint8Array(this.limits.maxVoices);
    this.endHeap = new Float64Array(this.limits.maxVoices); this.heapLength = 0; this.eligibleCount = 0; this.validated = false;
    this.resetSlots();
    this.noiseLength = Math.floor(sampleRate / 2);
    // Web Audio bandpass, constant peak gain, at the disclosed 1500 Hz / Q=.7.
    const omega = TAU * 1500 / sampleRate, alpha = Math.sin(omega) / (2 * .7), divisor = 1 + alpha;
    this.b0 = alpha / divisor; this.a1 = -2 * Math.cos(omega) / divisor; this.a2 = (1 - alpha) / divisor;
  }
  resetSlots() { this.activeCount = 0; this.freeCount = this.limits.maxVoices; for (let i = 0; i < this.limits.maxVoices; i++) this.freeSlots[i] = this.limits.maxVoices - 1 - i; }
  snapshot(frame) {
    return {generation: this.generation, planGeneration: this.planGeneration, state: this.state, sourceSha256: this.plan?.sourceSha256 ?? null, policyId: this.plan?.policyId ?? null, identityKind: this.plan?.identityKind ?? 'midi-source-coordinate', ...(this.plan?.timbreProfile ? {timbreProfile: this.plan.timbreProfile, timbreFingerprint: this.plan.timbreFingerprint} : {}), ...(this.plan?.assistanceFingerprint ? {assistanceFingerprint: this.plan.assistanceFingerprint, assistancePlanFingerprint: this.plan.assistancePlanFingerprint} : {}), sampleRate: this.sampleRate, frame, anchorFrame: this.anchorFrame ?? null, positionFrame: this.positionFrame ?? null, durationFrames: this.plan?.durationFrames ?? 0, sourceNotes: this.plan?.sourceNotes ?? 0, notes: this.plan?.count ?? 0, eligibleNotes: this.eligibleCount, started: this.startedCount, ended: this.endedCount, skipped: this.skippedCount, active: this.activeCount};
  }
  emitCompletion(type, frame, extra = {}) {
    const ledger = this.validated && this.actualStarts ? {actualStarts: this.actualStarts, actualEnds: this.actualEnds} : null;
    const transfer = ledger ? [this.actualStarts.buffer, this.actualEnds.buffer] : [];
    this.actualStarts = null; this.actualEnds = null;
    this.emit({type, ...extra, ...this.snapshot(frame), ledger}, transfer);
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
    this.emit({type: 'error', requestId, ...this.snapshot(frame), code: error.code || 'audio_processor_error', message: error.message || String(error), details: error.details});
  }
  discontinuity(discontinuityKind, expectedFrame, actualFrame, blockLength, missedAttackIndex) {
    // Allocate diagnostics only at failure. Running blocks retain three scalar
    // history fields, without per-quantum messages or an expanding trace.
    // For missed attacks, expected/actual refer to the onset/rendered sample;
    // for block-frame failures, they refer to the next/current block start.
    const details = {discontinuityKind, expectedFrame, actualFrame, previousBlockFrame: this.previousBlockFrame, previousBlockLength: this.previousBlockLength, blockLength, frameDelta: actualFrame - expectedFrame, successfulBlocks: this.successfulBlocks};
    if (discontinuityKind === 'missed-attack') details.missedAttackIndex = missedAttackIndex;
    reject('audio_render_discontinuity', discontinuityKind === 'block-frame' ? 'The audio render sample clock was discontinuous.' : 'The audio thread missed a prepared attack; playback stops without catch-up.', details);
  }
  handleMessage(message, frame) {
    const requestId = message?.requestId;
    try {
      if (!integer(frame, 0, this.limits.maxFrame) || !message || !integer(message.generation, 1, this.limits.maxGeneration)) reject('invalid_audio_command', 'The audio command has an invalid generation or frame.');
      if (message.generation < this.generation) { this.emit({type: 'stale', generation: message.generation, requestId}); return; }
      if (message.type === 'prepare' || message.type === 'cancel') {
        if (message.generation <= this.generation) { this.emit({type: 'stale', generation: message.generation, requestId}); return; }
        this.silence(frame, 'cancel'); this.state = 'canceled';
        if (message.type === 'prepare' && this.plan) this.emitCompletion('canceled', frame, {reason: 'prepare_replaced'});
        this.generation = message.generation;
        if (message.type === 'cancel') { this.emitCompletion('canceled', frame, {requestId, reason: message.reason}); return; }
        this.plan = null; this.planGeneration = this.generation; this.order = null;
        this.startedCount = 0; this.endedCount = 0; this.skippedCount = 0; this.cursor = 0; this.eligibleCount = 0; this.validated = false;
        const plan = (this.profile?.openTransfer || openBasicKeyAudioTransfer)(message.wire, this.sampleRate);
        validateTimbreCommand(message, plan);
        if (!integer(message.positionFrame, -600 * this.sampleRate, plan.durationFrames)) reject('invalid_audio_command', 'The prepared source position exceeds the rendition or ten-minute count-in bound.');
        this.profile?.validatePosition?.(plan, message.positionFrame);
        this.profileValidation = this.profile?.beginValidation?.(plan);
        this.timbreValidation = plan.timbreProfile === BASIC_KEY_TIMBRE_PROFILE ? basicKeyTimbreHasher(plan) : null;
        this.assistanceValidation = plan.assistanceFingerprint ? basicKeyAssistanceHasher(plan) : null;
        this.plan = plan; this.positionFrame = message.positionFrame; this.anchorFrame = null;
        this.order = plan.playOrder; this.actualStarts = plan.actualStarts; this.actualEnds = plan.actualEnds; this.steps = plan.steps;
        this.preparePhase = plan.triangles ? -1 : 0; this.prepareCursor = 0; this.prepareRequestId = requestId; this.heapLength = 0;
        this.state = 'preparing'; return;
      }
      if (message.generation !== this.generation) reject('invalid_audio_command', 'The audio generation was not prepared.');
      if (message.type === 'start') {
        if (this.state !== 'ready') reject('invalid_audio_command', 'Only a ready audio generation can start.');
        validateTimbreCommand(message, this.plan);
        if (!integer(message.anchorFrame, frame + 1, Math.min(this.limits.maxFrame, frame + Math.ceil(this.sampleRate * MAX_AUDIO_START_LEAD_SECONDS)))) reject('clean_late_start', 'The start anchor must be in the future and within the bounded 500 ms acknowledgement window.');
        if (!integer(message.anchorFrame + this.plan.durationFrames - this.positionFrame, 0, this.limits.maxFrame)) reject('invalid_audio_command', 'The anchored rendition exceeds the exact audio frame range.');
        this.anchorFrame = message.anchorFrame; this.expectedFrame = null; this.state = 'running';
        this.previousBlockFrame = null; this.previousBlockLength = 0; this.successfulBlocks = 0;
        this.emit({type: 'started', requestId, ...this.snapshot(frame)}); return;
      }
      if (message.type === 'snapshot') { this.emit({type: 'snapshot', requestId, ...this.snapshot(frame)}); return; }
      if (message.type === 'audit') {
        if (!this.validated || !this.plan || !integer(message.offset, 0, this.plan.count) || !integer(message.count, 1, this.limits.maxAuditRows)) reject('invalid_audio_command', 'The audit request exceeds its bounded page size.');
        if (!this.actualStarts) { this.emit({type: 'audit_transferred', requestId, ...this.snapshot(frame), offset: message.offset, count: message.count}); return; }
        const end = Math.min(this.plan.count, message.offset + message.count), rows = [];
        for (let index = message.offset; index < end; index++) {
          const p = this.plan;
          rows.push({index, ...(this.profile?.identity || audioTransferIdentity)(p, index), startFrame: p.starts[index], endFrame: p.ends[index], actualStartFrame: this.actualStarts[index], actualEndFrame: this.actualEnds[index]});
        }
        this.emit({type: 'audit', requestId, ...this.snapshot(frame), offset: message.offset, nextOffset: end, rows}); return;
      }
      reject('invalid_audio_command', 'Unknown basic audio receiver command.');
    } catch (error) { this.fail(error, frame, requestId); }
  }
  prepareChunk(frame, blockLength) {
    const p = this.plan;
    // At most 1024 rows per quantum; scale with rate/block size so the full
    // two-pass maximum MIDI plan completes in about one second at normal rates
    // (about 2.05 s at 8 kHz/128-frame quanta because this cap binds). VSQ's
    // bounded waveform validation adds at most the same amount of work. Heap
    // removals per chunk are bounded by its pushes plus the initial 128 ends.
    const bound = Math.min(this.profile?.prepareMaxRows || 1024, Math.max(1, Math.ceil(2 * this.limits.maxNotes * blockLength / this.sampleRate)));
    let worked = 0;
    while (worked < bound && this.state === 'preparing') {
      if (this.preparePhase === -1) {
        if (this.prepareCursor === p.triangles.length) { this.preparePhase = 0; this.prepareCursor = 0; continue; }
        const value = p.triangles[this.prepareCursor++]; worked++;
        if (!Number.isFinite(value) || Math.abs(value) > 1.001) reject('invalid_audio_plan', 'A procedural triangle table exceeds its finite unit-amplitude bound.');
        continue;
      }
      const phaseLength = this.preparePhase === 0 ? Math.max(p.count, this.profile?.scratchCount?.(p) || 0) : p.count;
      if (this.prepareCursor === phaseLength) {
        if (this.preparePhase === 0) { this.preparePhase = 1; this.prepareCursor = 0; continue; }
        this.profile?.finishValidation?.(p, this.profileValidation);
        if (this.timbreValidation && this.timbreValidation.hex() !== p.timbreFingerprint) reject('audio_timbre_fingerprint', 'Transferred synthetic colors do not match their prepared source gates.');
        if (this.assistanceValidation && this.assistanceValidation.hex() !== p.assistancePlanFingerprint) reject('audio_assistance_fingerprint', 'Transferred machine gates do not match their prepared assistance ownership.');
        this.validated = true; this.state = 'ready'; this.emit({type: 'ready', requestId: this.prepareRequestId, ...this.snapshot(frame + blockLength)}); break;
      }
      const index = this.prepareCursor++; worked++;
      if (this.preparePhase === 0) { if (index < p.count) { p.seen[index] = 0; this.actualStarts[index] = -1; this.actualEnds[index] = -1; } this.profile?.initializeScratch?.(p, index); continue; }
      const start = p.starts[index], end = p.ends[index], key = p.keys[index], velocity = p.velocities[index], role = p.roles[index];
      const vsq = p.identityKind === VSQ_AUDIO_IDENTITY;
      const digits = p.authoredIdDigits?.[index];
      const validIdentity = this.profile ? this.profile.validIdentity(p, index) : vsq ? p.sourceTracks[index] > 0 && (digits === 4 || digits === 8) && p.authoredIds[index] < 10 ** digits : integer(p.tracks[index], 0, Number.MAX_SAFE_INTEGER - 1) && integer(p.events[index], 0, Number.MAX_SAFE_INTEGER - 1);
      if (!integer(start, 0, p.durationFrames) || !integer(end, start + 1, p.durationFrames) || index > 0 && start < p.starts[index - 1] || !validIdentity || key > 127 || velocity < (this.profile?.allowZeroVelocity ? 0 : 1) || velocity > 127 || (vsq ? velocity !== 90 || role < 2 || role > 3 : role > 1)) reject('invalid_audio_plan', 'A transferred audio gate is invalid or out of order.');
      this.profile?.validateRow?.(p, index, this.profileValidation);
      const timbre = p.timbreProfile === BASIC_KEY_TIMBRE_PROFILE ? p.timbres[index] : 0;
      if (!integer(timbre, 0, BASIC_KEY_SYNTHETIC_INSTRUMENTS.length)) reject('invalid_audio_plan', 'A transferred synthetic color is unsupported.');
      if (this.timbreValidation) hashBasicKeyTimbreRow(this.timbreValidation, p, index);
      if (this.assistanceValidation) hashBasicKeyAssistanceRow(this.assistanceValidation, p, index);
      const frequency = 440 * 2 ** ((key - 69) / 12);
      if ((timbre || role !== 1) && frequency * (vsq && !timbre ? role : 1) > this.sampleRate * .45) reject('unsupported_audio_sample_rate', 'The audio device cannot represent every retained key and declared harmonic without clamping.');
      this.steps[index] = TAU * frequency / this.sampleRate;
      const ordered = p.idOrder[index];
      if (ordered >= p.count || p.seen[ordered]) reject('invalid_audio_plan', 'The source-coordinate permutation is not complete and unique.');
      p.seen[ordered] = 1;
      if (index > 0 && (this.profile?.compareIdentity || compareAudioTransferIdentity)(p, p.idOrder[index - 1], ordered) >= 0) reject('invalid_audio_plan', 'Stable source coordinates are duplicated or out of order.');
      if (this.profile?.audibleGate?.(p, index) === false) { this.skippedCount++; continue; }
      while (this.heapLength && this.endHeap[0] <= start) {
        const tail = this.endHeap[--this.heapLength]; let at = 0;
        while (at * 2 + 1 < this.heapLength) { let child = at * 2 + 1; if (child + 1 < this.heapLength && this.endHeap[child + 1] < this.endHeap[child]) child++; if (this.endHeap[child] >= tail) break; this.endHeap[at] = this.endHeap[child]; at = child; }
        this.endHeap[at] = tail;
      }
      if (this.heapLength >= this.limits.maxVoices) reject('voice_budget_exceeded', 'The sample-frame gates exceed 128 simultaneous voices; no voice is stolen.');
      let at = this.heapLength++;
      while (at > 0) { const parent = (at - 1) >> 1; if (this.endHeap[parent] <= end) break; this.endHeap[at] = this.endHeap[parent]; at = parent; }
      this.endHeap[at] = end;
      if (this.profile?.eligibleGate ? this.profile.eligibleGate(p, index, this.positionFrame) : end > this.positionFrame) this.order[this.eligibleCount++] = index; else this.skippedCount++;
    }
    this.lastPrepareWork = worked;
  }
  attack(index, frame) {
    if (!this.freeCount) reject('voice_budget_exceeded', 'The audio renderer exhausted its 128 voice slots; no voice was stolen.');
    const slot = this.freeSlots[--this.freeCount], voice = this.voiceSlots[slot], plan = this.plan;
    voice.note = index; voice.start = frame; voice.end = this.anchorFrame + plan.ends[index] - this.positionFrame;
    voice.step = this.steps[index]; voice.phase = voice.step / 2; voice.peak = .08 * plan.velocities[index] / 127; voice.drum = plan.roles[index] === 1;
    voice.timbre = plan.timbreProfile === BASIC_KEY_TIMBRE_PROFILE ? plan.timbres[index] : 0;
    if (voice.timbre > 1) {
      const harmonics = voice.timbre === 2 ? TRIANGLE : REED;
      voice.timbreHarmonicLimit = Math.min(9, Math.ceil(Math.PI / voice.step) - 1);
      let amplitude = 0; for (let h = 1; h <= voice.timbreHarmonicLimit; h++) amplitude += Math.abs(harmonics[h]);
      voice.timbreHarmonicScale = 1 / amplitude;
    }
    voice.vsqRatio = plan.roles[index] >= 2 ? plan.roles[index] : 0; voice.harmonicPhase = voice.phase * voice.vsqRatio; voice.triangleOffset = plan.keys[index] * VSQ_TRIANGLE_SIZE;
    voice.noiseIndex = 0; voice.noiseState = 0x574d4801; voice.x1 = 0; voice.x2 = 0; voice.y1 = 0; voice.y2 = 0;
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
    if (voice.timbre) {
      if (voice.timbre === 1) value = Math.sin(voice.phase);
      else {
        const harmonics = voice.timbre === 2 ? TRIANGLE : REED; value = 0;
        // The recurrence bounds expensive trigonometry to one sine/cosine per
        // sample, even at 128 simultaneous voices and nine retained harmonics.
        const twiceCos = 2 * Math.cos(voice.phase); let previous = 0, sine = Math.sin(voice.phase);
        for (let h = 1; h <= voice.timbreHarmonicLimit; h++) { value += harmonics[h] * sine; const next = twiceCos * sine - previous; previous = sine; sine = next; }
        value *= voice.timbreHarmonicScale;
      }
      voice.phase += voice.step; if (voice.phase >= TAU) voice.phase -= TAU;
    } else if (voice.drum) {
      let random = voice.noiseState; random ^= random << 13; random ^= random >>> 17; random ^= random << 5;
      const x = Math.fround((random >>> 0) / 2147483648 - 1); voice.noiseState = random;
      if (++voice.noiseIndex === this.noiseLength) { voice.noiseIndex = 0; voice.noiseState = 0x574d4801; }
      value = this.b0 * (x - voice.x2) - this.a1 * voice.y1 - this.a2 * voice.y2;
      voice.x2 = voice.x1; voice.x1 = x; voice.y2 = voice.y1; voice.y1 = value;
    } else {
      if (voice.vsqRatio) {
        const at = voice.phase / TAU * VSQ_TRIANGLE_SIZE, index = Math.floor(at), fraction = at - index, table = this.plan.triangles, base = voice.triangleOffset;
        const triangle = table[base + index] + (table[base + (index + 1) % VSQ_TRIANGLE_SIZE] - table[base + index]) * fraction;
        value = .8 * triangle + .2 * Math.sin(voice.harmonicPhase);
        voice.harmonicPhase += voice.step * voice.vsqRatio; if (voice.harmonicPhase >= TAU) voice.harmonicPhase -= TAU;
      } else value = Math.sin(voice.phase);
      voice.phase += voice.step; if (voice.phase >= TAU) voice.phase -= TAU;
    }
    return value * level;
  }
  process(channels, firstFrame) {
    for (const channel of channels) channel.fill(0);
    if (this.state !== 'running' && this.state !== 'preparing') return true;
    const length = channels[0]?.length ?? 0;
    try {
      if (!integer(firstFrame, 0, this.limits.maxFrame) || !length || channels.some(channel => channel.length !== length)) reject('audio_processor_error', 'The audio render block is invalid.');
      if (this.state === 'preparing') { this.prepareChunk(firstFrame, length); return true; }
      if (this.expectedFrame !== null && firstFrame !== this.expectedFrame) this.discontinuity('block-frame', this.expectedFrame, firstFrame, length);
      this.expectedFrame = firstFrame + length;
      const sourceEnd = this.anchorFrame + this.plan.durationFrames - this.positionFrame;
      for (let offset = 0; offset < length; offset++) {
        const frame = firstFrame + offset;
        for (let index = this.activeCount - 1; index >= 0; index--) if (this.voiceSlots[this.activeSlots[index]].end <= frame) this.finishVoice(index, frame, 'gate');
        if (frame < this.anchorFrame) continue;
        while (this.cursor < this.eligibleCount) {
          const index = this.order[this.cursor], onset = this.anchorFrame + Math.max(this.plan.starts[index], this.positionFrame) - this.positionFrame;
          if (onset > frame) break;
          if (onset < frame) this.discontinuity('missed-attack', onset, frame, length, index);
          this.attack(index, frame); this.cursor++;
        }
        if (frame >= sourceEnd) {
          if (this.activeCount || this.cursor !== this.eligibleCount) reject('audio_processor_error', 'Natural end disagrees with the complete gate plan.');
          this.state = 'ended'; this.emitCompletion('ended', frame); break;
        }
        let sum = 0;
        for (let index = 0; index < this.activeCount; index++) sum += this.sample(this.voiceSlots[this.activeSlots[index]], frame);
        for (const channel of channels) channel[offset] = sum;
      }
      this.previousBlockFrame = firstFrame; this.previousBlockLength = length;
      this.successfulBlocks = Math.min(this.limits.maxFrame, this.successfulBlocks + 1);
    } catch (error) { for (const channel of channels) channel.fill(0); this.fail(error, firstFrame, this.state === 'preparing' ? this.prepareRequestId : undefined); }
    return true; // Keep an idle node available for explicit fresh generations.
  }
}
