import {LIVE_TONE_PROTOCOL, LIVE_TONE_LIMITS as L, LiveToneError, liveToneSampleRate, liveToneId, validateLiveTonePlay, validateLiveToneClick, buildLiveToneTriangles} from './live-tone-core.js';
export {LIVE_TONE_PROTOCOL, LIVE_TONE_LIMITS, LiveToneError} from './live-tone-core.js';

const modules = new WeakMap(), ACK_TIMEOUT_MS = 5000;
let sourceGeneration = 0;
const error = (code, message, details = {}) => new LiveToneError(code, message, details);
const integer = (value, min, max) => Number.isSafeInteger(value) && value >= min && value <= max;
const validFrame = value => integer(value, 0, L.maxFrame);
const validId = value => typeof value === 'string' && value.length > 0 && value.length <= L.maxIdLength && !/[\u0000-\u001f]/.test(value);
const finiteNonnegative = value => Number.isFinite(value) && value >= 0;
const receiptReasons = new Set(['onset', 'duration', 'release', 'retrigger', 'canceled', 'stolen', 'replaced', 'stopped', 'silence', 'silenceClicks', 'suspend', 'close', 'error']);
function validPcm(message) {
  return finiteNonnegative(message.pcmPeak) && finiteNonnegative(message.pcmEnergy) && integer(message.renderedSamples, 0, L.maxFrame) && integer(message.nonzeroSamples, 0, message.renderedSamples) && (message.firstNonzeroFrame === null ? message.nonzeroSamples === 0 : validFrame(message.firstNonzeroFrame) && message.nonzeroSamples > 0) && (message.lastRenderedFrame === null ? message.renderedSamples === 0 : validFrame(message.lastRenderedFrame) && message.renderedSamples > 0);
}
function validVoice(message) {
  return message && integer(message.generation, 1, L.maxToken) && integer(message.token, 1, L.maxToken) && validId(message.id) && (message.kind === 'note' ? integer(message.midi, 0, 127) && message.key === message.midi : message.kind === 'click' && message.midi === null && message.key === null) && validFrame(message.requestedStartFrame) && (message.actualStartFrame === null || validFrame(message.actualStartFrame)) && validPcm(message);
}
function validReceipt(message, sampleRate) {
  return validVoice(message) && message.source === 'live-tone' && message.sampleRate === sampleRate && validFrame(message.frame) && receiptReasons.has(message.reason) && (message.type === 'started' ? message.actualStartFrame === message.frame && message.actualEndFrame === null : message.type === 'ended' && message.actualEndFrame === message.frame);
}
function validSnapshot(message, sampleRate) {
  return message.source === 'live-tone' && message.sampleRate === sampleRate && message.state === 'ready' && validFrame(message.frame) && ['started', 'ended', 'droppedVoices', 'nonzeroSamples', 'renderedSamples'].every(key => integer(message[key], 0, L.maxFrame)) && finiteNonnegative(message.pcmPeak) && finiteNonnegative(message.pcmEnergy) && integer(message.activeNotes, 0, L.maxNotes) && integer(message.activeClicks, 0, L.maxClicks) && Array.isArray(message.voices) && message.voices.length === message.activeNotes + message.activeClicks && message.voices.every(validVoice) && Array.isArray(message.receipts) && message.receipts.length <= L.maxReceipts && message.receipts.every(receipt => validReceipt(receipt, sampleRate));
}
const clockFrame = context => {
  const frame = Math.ceil(context.currentTime * context.sampleRate);
  if (!integer(frame, 0, L.maxFrame)) throw error('invalid_live_audio_clock', 'The live audio context has an invalid clock.');
  return frame;
};
function startupError(context, moduleUrl, phase, cause) {
  const details = {phase, moduleUrl, contextState: context?.state ?? null, sampleRate: context?.sampleRate ?? null, hasAudioWorklet: typeof context?.audioWorklet?.addModule === 'function', causeName: String(cause?.name ?? '').slice(0, 128), causeMessage: String(cause?.message ?? cause ?? '').slice(0, 1024)};
  return error('live_audio_worklet_unavailable', 'Persistent live input requires a working AudioWorklet on this origin.', details);
}
function deadline(work, setTimer, clearTimer, makeError) {
  return new Promise((resolve, reject) => {
    let done = false;
    const finish = (failure, result) => { if (done) return; done = true; clearTimer(timer); if (failure) reject(failure); else resolve(result); };
    const timer = setTimer(() => finish(makeError()), ACK_TIMEOUT_MS);
    Promise.resolve().then(work).then(result => finish(null, result), failure => finish(failure));
  });
}
/** One graph allocation at creation. Every sound/control operation is a bounded
 * message; suspension only closes the already-connected scalar output gate. */
export class LiveToneReceiver {
  static async create(context, output, options = {}) {
    const moduleUrl = String(options.moduleUrl || new URL('./live-tone-audio-processor.js', import.meta.url));
    if (typeof context?.audioWorklet?.addModule !== 'function' || (!options.nodeFactory && typeof globalThis.AudioWorkletNode !== 'function')) throw startupError(context, moduleUrl, 'capability');
    liveToneSampleRate(context.sampleRate);
    if (context.state !== 'running' || !output) throw error('live_audio_unavailable', 'Unlock the audio device before preparing live input.');
    const setTimer = options.setTimer || ((...args) => globalThis.setTimeout(...args)), clearTimer = options.clearTimer || (timer => globalThis.clearTimeout(timer));
    if (!modules.has(context)) modules.set(context, new Map());
    const cache = modules.get(context);
    if (!cache.has(moduleUrl)) cache.set(moduleUrl, deadline(() => context.audioWorklet.addModule(moduleUrl), setTimer, clearTimer, () => startupError(context, moduleUrl, 'module-timeout')).catch(reason => { cache.delete(moduleUrl); throw startupError(context, moduleUrl, 'module-load', reason); }));
    let interrupted = false;
    const stateListener = () => { if (context.state !== 'running') interrupted = true; };
    context.addEventListener?.('statechange', stateListener);
    try { await cache.get(moduleUrl); } finally { context.removeEventListener?.('statechange', stateListener); }
    if (interrupted || context.state !== 'running') throw error('live_audio_interrupted', 'The audio device stopped while live input was preparing.');
    const triangles = buildLiveToneTriangles(context.sampleRate);
    const factory = options.nodeFactory || ((...args) => new globalThis.AudioWorkletNode(...args));
    let receiver, node;
    try {
      node = factory(context, LIVE_TONE_PROTOCOL, {numberOfInputs: 0, numberOfOutputs: 1, outputChannelCount: [1], channelCount: 1});
      receiver = new LiveToneReceiver(context, output, node, {...options, setTimer, clearTimer});
      await receiver.request('initialize', {triangles}, [triangles.buffer]);
      if (receiver.state !== 'initializing' || context.state !== 'running') throw error('live_audio_interrupted', 'Live input initialization was interrupted.');
      receiver.state = 'ready'; receiver.openGate(); return receiver;
    } catch (reason) {
      if (receiver) receiver.dispose();
      else if (node) { try { node.disconnect(); } catch { /* Preserve startup cause. */ } try { node.port.close?.(); } catch { /* Preserve startup cause. */ } }
      if (reason instanceof LiveToneError) throw reason;
      throw startupError(context, moduleUrl, 'node-initialization', reason);
    }
  }
  constructor(context, output, node, {onError = () => {}, onEvent = () => {}, setTimer = (...args) => globalThis.setTimeout(...args), clearTimer = timer => globalThis.clearTimeout(timer)} = {}) {
    if (sourceGeneration >= L.maxToken) throw error('live_audio_generation_limit', 'The live audio source generation limit was reached.');
    Object.assign(this, {context, output, node, onError, onEvent, setTimer, clearTimer});
    this.generation = ++sourceGeneration; this.requestId = 0; this.token = 0; this.state = 'initializing'; this.disposed = false; this.pending = new Map(); this.notes = new Map(); this.clicks = new Map(); this.events = []; this.lifecycle = new Map(); this.resumePromise = null;
    this.outputGate = context.createGain(); this.outputGate.gain.value = 0;
    this.stateListener = () => { if (context.state !== 'running') this.interrupt(); };
    try {
      this.node.port.onmessage = event => this.receive(event.data);
      this.node.port.onmessageerror = () => this.fail(error('live_audio_processor_error', 'A live audio processor message could not be read.'));
      this.node.onprocessorerror = () => this.fail(error('live_audio_processor_error', 'The persistent live audio processor failed.'));
      this.outputGate.connect(output); this.node.connect(this.outputGate);
      context.addEventListener?.('statechange', this.stateListener); this.node.port.start?.();
    } catch (reason) { try { this.outputGate.disconnect(); } catch { /* Preserve startup cause. */ } context.removeEventListener?.('statechange', this.stateListener); throw reason; }
  }
  closeGate() { this.outputGate.gain.cancelScheduledValues(this.context.currentTime); this.outputGate.gain.setValueAtTime(0, this.context.currentTime); }
  openGate() { this.outputGate.gain.setValueAtTime(1, this.context.currentTime); }
  requireReady() {
    if (this.disposed || this.state !== 'ready' || this.context.state !== 'running') throw error('live_audio_unavailable', 'Live input is not ready; explicitly unlock and prepare it.');
  }
  takePending(requestId) {
    const pending = this.pending.get(requestId); if (!pending) return null;
    this.pending.delete(requestId); this.clearTimer(pending.timer); return pending;
  }
  rejectPending(reason) {
    for (const [requestId] of this.pending) this.takePending(requestId).reject?.(reason);
  }
  send(type, payload = {}, transfer = [], wait = false) {
    if (this.pending.size >= L.maxPending || this.requestId >= L.maxToken) {
      const reason = error('live_audio_command_limit', 'The bounded live audio command queue is full.'); this.fail(reason); throw reason;
    }
    const requestId = ++this.requestId, generation = this.generation;
    let resolve, reject;
    const promise = wait ? new Promise((a, b) => { resolve = a; reject = b; }) : null;
    const pending = {type, generation, resolve, reject, timer: null}; this.pending.set(requestId, pending);
    pending.timer = this.setTimer(() => {
      if (this.pending.get(requestId) === pending) this.fail(error('live_audio_command_timeout', `The live processor did not acknowledge ${type}.`, {command: type, generation, requestId}));
    }, ACK_TIMEOUT_MS);
    try { this.node.port.postMessage({type, generation, requestId, ...payload}, transfer); }
    catch (cause) { this.fail(error('live_audio_processor_error', 'The live audio command could not be delivered.', {command: type, causeMessage: String(cause).slice(0, 1024)})); if (!wait) throw cause; }
    return wait ? promise : requestId;
  }
  request(type, payload = {}, transfer = []) { return this.send(type, payload, transfer, true); }
  nextToken() { if (this.token >= L.maxToken) throw error('live_audio_token_limit', 'The live audio voice token limit was reached.'); return ++this.token; }
  play(id, midi, duration = null, delay = 0, timbre = 'piano', velocity = 90) {
    this.requireReady(); validateLiveTonePlay(id, midi, duration, delay, timbre, velocity, this.context.sampleRate);
    const token = this.nextToken(), atFrame = clockFrame(this.context) + Math.ceil(delay * this.context.sampleRate / 1000);
    this.send('play', {token, id, midi, duration, delay, timbre, velocity, atFrame});
    this.notes.delete(id);
    if (velocity === 0) return null;
    if (this.notes.size >= L.maxNotes) this.notes.delete(this.notes.keys().next().value);
    this.notes.set(id, token); return token;
  }
  release(id) {
    liveToneId(id); if (this.disposed || this.state !== 'ready') return null;
    const token = this.notes.get(id); if (!token) return null;
    this.notes.delete(id); return this.send('release', {id, token});
  }
  stop(id) {
    liveToneId(id); if (this.disposed || this.state !== 'ready' || !this.token) return null;
    this.notes.delete(id); return this.send('stop', {id, token: this.token});
  }
  click(id, accent = false, delay = 0, level = .25) {
    this.requireReady(); validateLiveToneClick(id, accent, delay, level);
    if (level > 0 && this.clicks.size >= L.maxClicks && !this.clicks.has(id)) throw error('live_audio_click_limit', 'The click preview exceeded its eight-voice budget.');
    const token = this.nextToken(), atFrame = clockFrame(this.context) + Math.ceil(delay * this.context.sampleRate / 1000);
    this.send('click', {token, id, accent, delay, level, atFrame}); this.clicks.delete(id);
    if (level === 0) return null;
    this.clicks.set(id, token); return token;
  }
  silenceClicks() { if (this.disposed || this.state !== 'ready') return null; this.clicks.clear(); return this.send('silenceClicks'); }
  silence() { if (this.disposed || this.state !== 'ready') return null; this.notes.clear(); this.clicks.clear(); return this.send('silence'); }
  snapshot() { this.requireReady(); return this.request('snapshot'); }
  controlWithoutPending(type) {
    if (this.requestId >= L.maxToken || this.generation >= L.maxToken || sourceGeneration >= L.maxToken) throw error('live_audio_generation_limit', 'The live audio control generation limit was reached.');
    this.generation = Math.max(this.generation + 1, ++sourceGeneration); sourceGeneration = this.generation;
    this.node.port.postMessage({type, generation: this.generation, requestId: ++this.requestId});
  }
  interrupt() {
    if (this.disposed || ['interrupted', 'error', 'disposed'].includes(this.state)) return;
    const reason = error('live_audio_interrupted', 'The audio device stopped; live voices were canceled and require an explicit unlock.');
    this.state = 'interrupted'; this.closeGate(); this.notes.clear(); this.clicks.clear(); this.lifecycle.clear(); this.rejectPending(reason);
    try { this.controlWithoutPending('suspend'); } catch (cause) { this.fail(error('live_audio_processor_error', 'Live audio suspension could not be delivered.', {causeMessage: String(cause).slice(0, 1024)})); return; }
    this.onError(reason);
  }
  async resume() {
    if (this.state === 'ready') { this.requireReady(); return this; }
    if (this.resumePromise) return this.resumePromise;
    if (this.disposed || this.state !== 'interrupted' || this.context.state !== 'running') throw error('live_audio_unavailable', 'Only an explicitly unlocked interrupted receiver can resume.');
    this.state = 'resuming'; const generation = this.generation;
    this.resumePromise = this.request('resume').then(() => {
      if (this.disposed || this.generation !== generation || this.state !== 'resuming' || this.context.state !== 'running') throw error('live_audio_interrupted', 'Live audio resume was interrupted.');
      this.state = 'ready'; this.openGate(); return this;
    }).finally(() => { this.resumePromise = null; });
    return this.resumePromise;
  }
  fail(reason) {
    if (this.disposed || this.state === 'error') return;
    this.state = 'error'; this.closeGate(); this.notes.clear(); this.clicks.clear(); this.rejectPending(reason);
    try { this.controlWithoutPending('close'); } catch { /* The static gate already suppresses failed delivery. */ }
    this.onError(reason);
  }
  receive(message) {
    if (this.disposed || !message || typeof message !== 'object' || message.generation !== this.generation) return;
    if (message.type === 'error') { this.fail(error(typeof message.code === 'string' ? message.code.slice(0, 128) : 'live_audio_processor_error', typeof message.message === 'string' ? message.message.slice(0, 1024) : 'The live audio processor failed.', {generation: message.generation, requestId: message.requestId, frame: message.frame})); return; }
    if (message.type === 'started' || message.type === 'ended') {
      if (this.state !== 'ready') return;
      if (!validReceipt(message, this.context.sampleRate) || message.token > this.token) { this.fail(error('live_audio_protocol_error', 'The live audio event receipt is invalid.')); return; }
      const prior = this.lifecycle.get(message.token) || 0, bit = message.type === 'started' ? 1 : 2;
      if (prior & bit || prior & 2) return;
      this.lifecycle.set(message.token, prior | bit);
      if (this.lifecycle.size > L.maxReceipts) this.lifecycle.delete(this.lifecycle.keys().next().value);
      this.events.push(message); if (this.events.length > L.maxReceipts) this.events.shift();
      if (message.type === 'ended') { const map = message.kind === 'note' ? this.notes : this.clicks; if (map.get(message.id) === message.token) map.delete(message.id); }
      this.onEvent(message); return;
    }
    const pending = this.pending.get(message.requestId); if (!pending || pending.generation !== this.generation) return;
    if (!(message.type === 'ready' && pending.type === 'initialize' || message.type === 'snapshot' && pending.type === 'snapshot' || message.type === 'ack' && message.command === pending.type)) { this.fail(error('live_audio_protocol_error', 'The live audio acknowledgement did not match its command.')); return; }
    if (message.source !== 'live-tone' || !validFrame(message.frame) || message.type === 'ready' && message.sampleRate !== this.context.sampleRate || message.type === 'snapshot' && !validSnapshot(message, this.context.sampleRate)) { this.fail(error('live_audio_protocol_error', 'The live audio acknowledgement data is invalid.')); return; }
    this.takePending(message.requestId); pending.resolve?.(message);
  }
  dispose() {
    if (this.disposed) return;
    this.closeGate(); this.rejectPending(error('live_audio_disposed', 'The live audio receiver was disposed.'));
    try { this.controlWithoutPending('close'); } catch { /* Disposal disconnects the static graph below. */ }
    this.disposed = true; this.state = 'disposed'; this.notes.clear(); this.clicks.clear(); this.lifecycle.clear();
    this.context.removeEventListener?.('statechange', this.stateListener);
    this.node.port.onmessage = null; this.node.port.onmessageerror = null; this.node.onprocessorerror = null;
    try { this.node.disconnect(); } finally { this.outputGate.disconnect(); this.node.port.close?.(); }
  }
}
