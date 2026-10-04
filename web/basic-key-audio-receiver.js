import {BASIC_KEY_AUDIO_PROTOCOL, BASIC_KEY_AUDIO_LIMITS as LIMITS, BasicKeyAudioError, encodeBasicKeyAudioPlan, validateBasicKeyAudioPlan} from './basic-key-audio-plan.js';

export {BasicKeyAudioError, BASIC_KEY_AUDIO_LIMITS, buildBasicKeyAudioPlan} from './basic-key-audio-plan.js';
const modules = new WeakMap();
const error = (code, message, details = {}) => new BasicKeyAudioError(code, message, details);
const ACK_TIMEOUT_MS = 5000;
function loadModule(context, moduleUrl, {setTimer = (...args) => globalThis.setTimeout(...args), clearTimer = (...args) => globalThis.clearTimeout(...args)} = {}) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (reason) => { if (settled) return; settled = true; clearTimer(timer); if (reason) reject(reason); else resolve(); };
    const timer = setTimer(() => finish(error('audio_worklet_unavailable', 'The basic-key audio processor module did not load before its deadline.', {command: 'addModule', timeoutMs: ACK_TIMEOUT_MS})), ACK_TIMEOUT_MS);
    Promise.resolve().then(() => context.audioWorklet.addModule(moduleUrl)).then(() => finish(), reason => finish(error('audio_worklet_unavailable', 'The basic-key audio processor could not be loaded from this origin.', {cause: String(reason)})));
  });
}

/** Main-thread protocol adapter. The only timed command is the initial start;
 * after acceptance, the render sample clock owns the complete immutable plan.
 */
export class BasicKeyAudioReceiver {
  static async create(context, output, options = {}) {
    const nodeFactory = options.nodeFactory || ((...args) => new globalThis.AudioWorkletNode(...args));
    if (!context?.audioWorklet?.addModule || (!options.nodeFactory && typeof globalThis.AudioWorkletNode !== 'function')) throw error('audio_worklet_unavailable', 'Complete basic-key playback requires AudioWorklet support on this origin.');
    if (context.state !== 'running' || !output) throw error('clean_audio_unavailable', 'Unlock the audio device with a user gesture before preparing playback.');
    const moduleUrl = String(options.moduleUrl || new URL('./basic-key-audio-processor.js', import.meta.url));
    if (!modules.has(context)) modules.set(context, new Map());
    const cache = modules.get(context);
    if (!cache.has(moduleUrl)) cache.set(moduleUrl, loadModule(context, moduleUrl, options).catch(reason => { cache.delete(moduleUrl); throw reason; }));
    await cache.get(moduleUrl);
    if (context.state !== 'running') throw error('clean_audio_unavailable', 'The audio device stopped during processor preparation.');
    let node;
    try { node = nodeFactory(context, BASIC_KEY_AUDIO_PROTOCOL, {numberOfInputs: 0, numberOfOutputs: 1, outputChannelCount: [1], channelCount: 1}); }
    catch (reason) { throw error('audio_worklet_unavailable', 'The basic-key audio processor could not be created.', {cause: String(reason)}); }
    return new BasicKeyAudioReceiver(context, output, node, options);
  }
  constructor(context, output, node, {onError = () => {}, onEnded = () => {}, onStarted = () => {}, onStopped = () => {}, setTimer = (...args) => globalThis.setTimeout(...args), clearTimer = (...args) => globalThis.clearTimeout(...args)} = {}) {
    Object.assign(this, {context, output, node, onError, onEnded, onStarted, onStopped, setTimer, clearTimer});
    this.generation = 0; this.requestId = 0; this.pending = new Map(); this.state = 'idle'; this.connected = false; this.disposed = false; this.broken = false; this.plan = null; this.lastCompletion = null;
    this.node.port.onmessage = event => this.receive(event.data);
    this.node.port.onmessageerror = () => this.fail(error('audio_processor_error', 'The audio receiver received an unreadable processor message.'));
    this.node.onprocessorerror = () => { this.broken = true; this.fail(error('audio_processor_error', 'The audio processor failed; create a new receiver before retrying.')); };
    this.stateListener = () => {
      if (this.context.state !== 'running' && ['preparing', 'ready', 'starting', 'running'].includes(this.state)) this.fail(error('clean_clock_unavailable', 'The audio device stopped; playback was canceled and will not automatically resume.'));
    };
    this.context.addEventListener?.('statechange', this.stateListener);
    this.node.port.start?.();
  }
  nextGeneration() {
    if (this.generation >= LIMITS.maxGeneration) throw error('audio_generation_limit', 'The audio receiver generation limit was reached; create a new receiver.');
    return ++this.generation;
  }
  requireOpen() { if (this.disposed || this.disposing || this.broken) throw error('audio_receiver_closed', 'The audio receiver is closed or failed.'); }
  rejectPending(reason) { for (const pending of this.pending.values()) { this.clearTimer(pending.timer); pending.reject(reason); } this.pending.clear(); }
  takePending(requestId) { const pending = this.pending.get(requestId); if (pending) { this.clearTimer(pending.timer); this.pending.delete(requestId); } return pending; }
  detach() { if (this.connected) { try { this.node.disconnect(); } finally { this.connected = false; } } }
  request(type, payload = {}) {
    if (this.pending.size >= 32 || this.requestId >= LIMITS.maxGeneration) return Promise.reject(error('audio_command_limit', 'The audio command bound was reached.'));
    const requestId = ++this.requestId, generation = this.generation;
    return new Promise((resolve, reject) => {
      const pending = {resolve, reject, generation, type, timer: null}; this.pending.set(requestId, pending);
      // These are acknowledgment/lifecycle deadlines, never audio scheduling.
      // A start cannot await an acknowledgment past its existing audio anchor.
      const timeoutMs = type === 'start' ? Math.max(1, Math.ceil((payload.anchorFrame / this.context.sampleRate - this.context.currentTime) * 1000)) : ACK_TIMEOUT_MS;
      pending.timer = this.setTimer(() => {
        if (this.pending.get(requestId) !== pending) return;
        this.fail(error('audio_command_timeout', `The audio processor did not acknowledge ${type} before its deadline.`, {command: type, generation, timeoutMs}));
      }, timeoutMs);
      try { this.node.port.postMessage({type, generation, requestId, ...payload}); }
      catch (reason) { this.fail(error('audio_processor_error', 'The audio command could not be delivered.', {command: type, cause: String(reason)})); }
    });
  }
  async prepare(input, {positionMs = 0} = {}) {
    this.requireOpen();
    if (this.context.state !== 'running') throw error('clean_audio_unavailable', 'The audio device must be running before preparing a plan.');
    if (this.prepareInFlight) throw error('audio_prepare_pending', 'The previous audio preparation has not been acknowledged yet.');
    const plan = validateBasicKeyAudioPlan(input), positionFrame = Math.round(positionMs * plan.sampleRate / 1000);
    if (plan.sampleRate !== this.context.sampleRate || !Number.isFinite(positionMs) || !Number.isSafeInteger(positionFrame) || positionFrame < -600 * plan.sampleRate || positionFrame > plan.durationFrames) throw error('invalid_audio_plan', 'The audio plan sample rate or source position does not match this device.');
    const wire = encodeBasicKeyAudioPlan(plan);
    this.detach(); this.rejectPending(error('audio_canceled', 'A new audio preparation canceled the previous generation.'));
    this.nextGeneration(); this.plan = plan; this.positionFrame = positionFrame; this.state = 'preparing'; this.prepareInFlight = this.generation;
    return this.request('prepare', {wire, positionFrame});
  }
  start({anchorTime = this.context.currentTime + .05} = {}) {
    this.requireOpen();
    if (this.state !== 'ready' || this.context.state !== 'running') return Promise.reject(error('clean_audio_unavailable', 'Only a ready plan and running audio device can start.'));
    const anchorFrame = Math.ceil(anchorTime * this.context.sampleRate), now = Math.floor(this.context.currentTime * this.context.sampleRate);
    if (!Number.isSafeInteger(anchorFrame) || anchorFrame <= now || anchorFrame - now > Math.ceil(this.context.sampleRate * .1)) return Promise.reject(error('clean_late_start', 'The audio start anchor must be in the future and within the declared 100 ms lead.'));
    if (!this.connected) { this.node.connect(this.output); this.connected = true; }
    this.state = 'starting';
    return this.request('start', {anchorFrame});
  }
  cancel(reason = 'stop', {reportFailure = true} = {}) {
    if (this.disposed) return;
    let failure;
    try { this.detach(); } catch (cause) { failure = error('audio_processor_error', 'The audio output could not be detached.', {cause: String(cause)}); }
    this.rejectPending(error('audio_canceled', 'Playback was canceled; a fresh explicit preparation is required.'));
    this.state = 'canceled';
    try { this.nextGeneration(); this.node.port.postMessage({type: 'cancel', generation: this.generation, reason}); }
    catch (cause) { failure ||= error('audio_processor_error', 'Audio cancellation could not be delivered; the disconnected receiver is closed.', {cause: String(cause)}); }
    if (failure) { this.broken = true; this.state = 'error'; this.closePort(); if (reportFailure) this.onError(failure); }
    return failure;
  }
  stop() { this.cancel('stop'); }
  pause() { this.cancel('pause'); }
  reset() { this.cancel('reset'); }
  seek(positionMs) { if (!Number.isFinite(positionMs)) throw error('invalid_audio_command', 'A finite seek position is required.'); this.cancel('seek'); this.seekPositionMs = positionMs; }
  snapshot() { this.requireOpen(); return this.request('snapshot'); }
  audit({offset = 0, count = LIMITS.maxAuditRows} = {}) { this.requireOpen(); return this.request('audit', {offset, count}); }
  fail(reason) { this.rejectPending(reason); this.cancel('error', {reportFailure: false}); this.state = 'error'; this.onError(reason); }
  receive(message) {
    if (this.disposed || !message || !Number.isSafeInteger(message.generation)) return;
    if (['ready', 'error', 'stale'].includes(message.type) && message.generation === this.prepareInFlight) this.prepareInFlight = null;
    if (message.type === 'canceled' && message.generation > this.prepareInFlight) this.prepareInFlight = null;
    if (['ended', 'canceled'].includes(message.type) && message.ledger && message.planGeneration >= (this.lastCompletion?.planGeneration ?? 0)) {
      // One bounded terminal ledger is retained even if a later cancellation
      // has already fenced transport callbacks. Its generation is explicit.
      this.lastCompletion = Object.freeze({...message, anchorTime: message.anchorFrame / message.sampleRate, positionMs: message.positionFrame * 1000 / message.sampleRate});
      if (message.type === 'canceled') this.onStopped(this.lastCompletion);
    }
    if (this.disposing && message.type === 'canceled' && message.generation === this.generation) { this.closePort(); return; }
    if (message.generation !== this.generation) return;
    const pending = this.pending.get(message.requestId);
    if (message.type === 'error') { const reason = error(message.code, message.message); this.fail(reason); return; }
    if (message.type === 'ready') this.state = 'ready';
    if (message.type === 'started') {
      if (this.context.state !== 'running' || this.context.currentTime * this.context.sampleRate >= message.anchorFrame) { this.fail(error('clean_late_start', 'The start acknowledgement arrived after its audio anchor; playback was canceled without catching up.')); return; }
      this.state = 'running';
      message = {...message, anchorTime: message.anchorFrame / message.sampleRate, positionMs: message.positionFrame * 1000 / message.sampleRate};
    }
    if (pending) { this.takePending(message.requestId); pending.resolve(message); }
    if (message.type === 'started') this.onStarted(message);
    if (message.type === 'ended') { this.state = 'ended'; this.onEnded(this.lastCompletion); }
  }
  dispose() {
    if (this.disposed || this.disposing) return;
    this.cancel('dispose'); if (this.disposed) return; this.disposing = true; this.state = 'disposed';
    this.context.removeEventListener?.('statechange', this.stateListener);
    if (this.broken || this.context.state === 'closed') this.closePort();
    // Lifecycle cleanup only, never note scheduling. A stopped/suspended audio
    // thread may never acknowledge; retain no dead port beyond this grace time.
    else this.disposeTimer = this.setTimer(() => this.closePort(), 1000);
  }
  closePort() {
    if (this.disposed) return;
    this.disposed = true; this.disposing = false;
    this.rejectPending(error('audio_receiver_closed', 'The audio receiver is closed.'));
    this.context.removeEventListener?.('statechange', this.stateListener);
    if (this.disposeTimer !== undefined) this.clearTimer(this.disposeTimer);
    this.node.port.onmessage = null; this.node.port.onmessageerror = null; this.node.onprocessorerror = null; this.node.port.close?.();
  }
}
