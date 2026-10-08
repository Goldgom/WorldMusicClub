import {BASIC_KEY_AUDIO_PROTOCOL, BASIC_KEY_AUDIO_LIMITS as LIMITS, BasicKeyAudioError, createBasicKeyAudioTransfer, validateBasicKeyAudioPlan} from './basic-key-audio-plan.js';
import {MAX_AUDIO_START_LEAD_SECONDS} from './audio-start-lead.js';

export {BasicKeyAudioError, BASIC_KEY_AUDIO_LIMITS, buildBasicKeyAudioPlan} from './basic-key-audio-plan.js';
const modules = new WeakMap();
const error = (code, message, details = {}) => new BasicKeyAudioError(code, message, details);
const ACK_TIMEOUT_MS = 5000;
const diagnosticText = value => String(value ?? '').slice(0, 1024);
const integer = (value, min, max) => Number.isSafeInteger(value) && value >= min && value <= max;
const MAX_BLOCK_LENGTH = 0xffffffff, MAX_BLOCK_END = LIMITS.maxFrame + MAX_BLOCK_LENGTH;
const frameDiagnostic = value => integer(value, 0, LIMITS.maxFrame);
const ERROR_CONTEXT_FIELDS = Object.freeze({
  generation: value => integer(value, 1, LIMITS.maxGeneration), planGeneration: value => integer(value, 0, LIMITS.maxGeneration),
  sourceSha256: value => typeof value === 'string' && value.length === 64 && /^[a-f0-9]{64}$/.test(value),
  policyId: value => value === 'wmh-basic-key-rendition-fifo-v1' || value === 'wmh-vsq-base-note-reference-v1',
  identityKind: value => value === 'midi-source-coordinate' || value === 'vsq-authored-note',
  sampleRate: value => integer(value, 8000, 384000), frame: frameDiagnostic,
  anchorFrame: value => value === null || frameDiagnostic(value), positionFrame: value => integer(value, -600 * 384000, LIMITS.maxFrame),
});
const DISCONTINUITY_FIELDS = Object.freeze({
  discontinuityKind: value => value === 'block-frame' || value === 'missed-attack',
  expectedFrame: value => integer(value, 0, MAX_BLOCK_END), actualFrame: frameDiagnostic,
  previousBlockFrame: value => value === null || frameDiagnostic(value), previousBlockLength: value => integer(value, 0, MAX_BLOCK_LENGTH),
  blockLength: value => integer(value, 1, MAX_BLOCK_LENGTH), frameDelta: value => integer(value, -MAX_BLOCK_END, MAX_BLOCK_END),
  successfulBlocks: value => integer(value, 0, LIMITS.maxFrame), missedAttackIndex: value => integer(value, 0, LIMITS.maxNotes - 1),
});
function processorErrorDetails(message) {
  const details = {};
  // Never spread processor input: only fixed scalar fields cross into errors.
  // Even unreadable diagnostic properties must not hide the original failure.
  function copy(source, fields) {
    if (!source || typeof source !== 'object' || Array.isArray(source)) return;
    for (const [key, validate] of Object.entries(fields)) {
      try { const value = source[key]; if (Object.hasOwn(source, key) && validate(value)) details[key] = value; } catch { /* Diagnostics are optional. */ }
    }
  }
  copy(message, ERROR_CONTEXT_FIELDS);
  if (message.code === 'audio_render_discontinuity') {
    try { copy(message.details, DISCONTINUITY_FIELDS); } catch { /* Preserve the original processor failure. */ }
  }
  return details;
}
function startupError(context, moduleUrl, phase, message, reason, options = {}, extra = {}) {
  const details = {phase, moduleUrl, isSecureContext: typeof globalThis.isSecureContext === 'boolean' ? globalThis.isSecureContext : null, hasAudioWorklet: Boolean(context?.audioWorklet), addModuleType: typeof context?.audioWorklet?.addModule, audioWorkletNodeType: typeof globalThis.AudioWorkletNode, usesNodeFactory: typeof options.nodeFactory === 'function', contextState: context?.state ?? null, sampleRate: context?.sampleRate ?? null, ...extra};
  if (reason !== undefined) Object.assign(details, {causeName: diagnosticText(reason?.name || typeof reason), causeMessage: diagnosticText(reason?.message ?? reason), cause: diagnosticText(reason)});
  const failure = error('audio_worklet_unavailable', message, details);
  if (reason !== undefined) failure.cause = reason;
  return failure;
}
function loadModule(context, moduleUrl, options = {}) {
  const {setTimer = (...args) => globalThis.setTimeout(...args), clearTimer = (...args) => globalThis.clearTimeout(...args)} = options;
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (reason) => { if (settled) return; settled = true; clearTimer(timer); if (reason) reject(reason); else resolve(); };
    const timer = setTimer(() => finish(startupError(context, moduleUrl, 'module-load', 'The basic-key audio processor module did not load before its deadline.', undefined, options, {command: 'addModule', timeoutMs: ACK_TIMEOUT_MS, outcome: 'timeout'})), ACK_TIMEOUT_MS);
    Promise.resolve().then(() => context.audioWorklet.addModule(moduleUrl)).then(() => finish(), reason => finish(startupError(context, moduleUrl, 'module-load', 'The basic-key audio processor could not be loaded from this origin.', reason, options, {command: 'addModule', outcome: 'rejected'})));
  });
}

/** Main-thread protocol adapter. The only timed command is the initial start;
 * after acceptance, the render sample clock owns the complete immutable plan.
 */
export class BasicKeyAudioReceiver {
  static async create(context, output, options = {}) {
    const nodeFactory = options.nodeFactory || ((...args) => new globalThis.AudioWorkletNode(...args));
    const moduleUrl = String(options.moduleUrl || new URL('./basic-key-audio-processor.js', import.meta.url));
    if (typeof context?.audioWorklet?.addModule !== 'function' || (!options.nodeFactory && typeof globalThis.AudioWorkletNode !== 'function')) throw startupError(context, moduleUrl, 'capability', 'Complete basic-key playback requires AudioWorklet support on this origin.', undefined, options);
    if (context.state !== 'running' || !output) throw error('clean_audio_unavailable', 'Unlock the audio device with a user gesture before preparing playback.');
    if (!modules.has(context)) modules.set(context, new Map());
    const cache = modules.get(context);
    if (!cache.has(moduleUrl)) cache.set(moduleUrl, loadModule(context, moduleUrl, options).catch(reason => { cache.delete(moduleUrl); throw reason; }));
    let interrupted = false;
    const loadingStateListener = () => { if (context.state !== 'running') interrupted = true; };
    context.addEventListener?.('statechange', loadingStateListener);
    try { await cache.get(moduleUrl); } finally { context.removeEventListener?.('statechange', loadingStateListener); }
    if (interrupted || context.state !== 'running') throw error('clean_audio_unavailable', 'The audio device stopped during processor preparation; explicitly retry after unlocking it.');
    let node;
    try { node = nodeFactory(context, this.processorProtocol || BASIC_KEY_AUDIO_PROTOCOL, {numberOfInputs: 0, numberOfOutputs: 1, outputChannelCount: [1], channelCount: 1}); }
    catch (reason) { throw startupError(context, moduleUrl, 'node-construction', 'The basic-key audio processor could not be created.', reason, options); }
    try { return new this(context, output, node, options); }
    catch (reason) {
      try { node.disconnect(); } catch { /* Preserve the initialization failure. */ }
      try { node.port.close?.(); } catch { /* Preserve the initialization failure. */ }
      throw startupError(context, moduleUrl, 'receiver-initialization', 'The basic-key audio receiver could not initialize its output.', reason, options);
    }
  }
  constructor(context, output, node, {onError = () => {}, onEnded = () => {}, onStarted = () => {}, onStopped = () => {}, setTimer = (...args) => globalThis.setTimeout(...args), clearTimer = (...args) => globalThis.clearTimeout(...args)} = {}) {
    Object.assign(this, {context, output, node, onError, onEnded, onStarted, onStopped, setTimer, clearTimer});
    this.outputGate = context.createGain();
    try {
      this.outputGate.gain.value = 0; this.outputGate.connect(output);
      this.generation = 0; this.requestId = 0; this.pending = new Map(); this.timbreBindings = new Map(); this.state = 'idle'; this.connected = false; this.disposed = false; this.broken = false; this.plan = null; this.lastCompletion = null;
      this.node.port.onmessage = event => this.receive(event.data);
      this.node.port.onmessageerror = () => this.fail(error('audio_processor_error', 'The audio receiver received an unreadable processor message.'));
      this.node.onprocessorerror = () => { this.broken = true; this.fail(error('audio_processor_error', 'The audio processor failed; create a new receiver before retrying.')); };
      this.stateListener = () => {
        if (this.context.state !== 'running' && ['preparing', 'ready', 'starting', 'running', 'pausing', 'paused', 'resuming'].includes(this.state)) this.fail(error('clean_clock_unavailable', 'The audio device stopped; playback was canceled and will not automatically resume.'));
      };
      this.context.addEventListener?.('statechange', this.stateListener);
      this.node.port.start?.();
    } catch (reason) {
      try { this.outputGate.disconnect(); } catch { /* Preserve the original initialization failure. */ }
      try { context.removeEventListener?.('statechange', this.stateListener); } catch { /* Preserve the original initialization failure. */ }
      throw reason;
    }
  }
  nextGeneration() {
    if (this.generation >= LIMITS.maxGeneration) throw error('audio_generation_limit', 'The audio receiver generation limit was reached; create a new receiver.');
    return ++this.generation;
  }
  requireOpen() { if (this.disposed || this.disposing || this.broken) throw error('audio_receiver_closed', 'The audio receiver is closed or failed.'); }
  rejectPending(reason) { const commands = [...this.pending.values()]; this.pending.clear(); for (const pending of commands) { try { this.clearTimer(pending.timer); } catch { /* A late deadline is fenced by the cleared pending map. */ } pending.reject(reason); } }
  takePending(requestId) { const pending = this.pending.get(requestId); if (pending) { this.clearTimer(pending.timer); this.pending.delete(requestId); } return pending; }
  timbreCommandBinding() {
    const binding = this.timbreBindings.get(this.planGeneration);
    return binding ? {expectedTimbreProfile: binding.timbreProfile, expectedTimbreFingerprint: binding.timbreFingerprint, ...(binding.assistanceFingerprint ? {expectedAssistanceFingerprint: binding.assistanceFingerprint, expectedAssistancePlanFingerprint: binding.assistancePlanFingerprint} : {})} : {};
  }
  mute() { this.outputGate.gain.cancelScheduledValues(this.context.currentTime); this.outputGate.gain.setValueAtTime(0, this.context.currentTime); }
  detach() { this.mute(); if (this.connected) { try { this.node.disconnect(); } finally { this.connected = false; } } }
  request(type, payload = {}, transfer = []) {
    if (this.pending.size >= 32 || this.requestId >= LIMITS.maxGeneration) return Promise.reject(error('audio_command_limit', 'The audio command bound was reached.'));
    const requestId = ++this.requestId, generation = this.generation;
    return new Promise((resolve, reject) => {
      const pending = {resolve, reject, generation, type, timer: null}; this.pending.set(requestId, pending);
      // These are acknowledgment/lifecycle deadlines, never audio scheduling.
      // A start cannot await an acknowledgment past its existing audio anchor.
      const timeoutMs = (type === 'start' || type === 'resume') ? Math.max(1, Math.ceil((payload.anchorFrame / this.context.sampleRate - this.context.currentTime) * 1000)) : type === 'prepare' ? (this.prepareTimeoutMs || ACK_TIMEOUT_MS) : ACK_TIMEOUT_MS;
      pending.timer = this.setTimer(() => {
        if (this.pending.get(requestId) !== pending) return;
        this.fail(error('audio_command_timeout', `The audio processor did not acknowledge ${type} before its deadline.`, {command: type, generation, timeoutMs}));
      }, timeoutMs);
      try { this.node.port.postMessage({type, generation, requestId, ...payload}, transfer); }
      catch (reason) { this.fail(error('audio_processor_error', 'The audio command could not be delivered.', {command: type, cause: String(reason)})); }
    });
  }
  async prepare(input, {positionMs = 0} = {}) {
    this.requireOpen();
    if (this.context.state !== 'running') throw error('clean_audio_unavailable', 'The audio device must be running before preparing a plan.');
    if (this.prepareInFlight) throw error('audio_prepare_pending', 'The previous audio preparation has not been acknowledged yet.');
    const plan = validateBasicKeyAudioPlan(input), positionFrame = Math.round(positionMs * plan.sampleRate / 1000);
    if (plan.sampleRate !== this.context.sampleRate || !Number.isFinite(positionMs) || !Number.isSafeInteger(positionFrame) || positionFrame < -600 * plan.sampleRate || positionFrame > plan.durationFrames) throw error('invalid_audio_plan', 'The audio plan sample rate or source position does not match this device.');
    const packed = createBasicKeyAudioTransfer(plan);
    this.detach(); this.rejectPending(error('audio_canceled', 'A new audio preparation canceled the previous generation.'));
    this.nextGeneration(); this.planGeneration = this.generation; this.plan = plan; this.positionFrame = positionFrame; this.state = 'preparing'; this.prepareInFlight = this.generation;
    // Retain scalars independently of the transferred envelope so stripping
    // every optional wire field cannot downgrade an override into source sound.
    this.timbreBindings.set(this.planGeneration, Object.freeze({timbreProfile: packed.wire.timbreProfile ?? null, timbreFingerprint: packed.wire.timbreFingerprint ?? null, assistanceFingerprint: packed.wire.assistanceFingerprint ?? null, assistancePlanFingerprint: packed.wire.assistancePlanFingerprint ?? null, sourceSha256: plan.sourceSha256, policyId: plan.policyId, identityKind: plan.identityKind ?? 'midi-source-coordinate', sampleRate: plan.sampleRate}));
    while (this.timbreBindings.size > 2) this.timbreBindings.delete(this.timbreBindings.keys().next().value);
    this.node.connect(this.outputGate); this.connected = true;
    return this.request('prepare', {wire: packed.wire, positionFrame, ...this.timbreCommandBinding()}, packed.transfer);
  }
  start({anchorTime = this.context.currentTime + .05} = {}) {
    this.requireOpen();
    if (this.state !== 'ready' || this.context.state !== 'running') return Promise.reject(error('clean_audio_unavailable', 'Only a ready plan and running audio device can start.'));
    const anchorFrame = Math.ceil(anchorTime * this.context.sampleRate), now = Math.floor(this.context.currentTime * this.context.sampleRate);
    if (!Number.isSafeInteger(anchorFrame) || anchorFrame <= now || anchorFrame - now > Math.ceil(this.context.sampleRate * MAX_AUDIO_START_LEAD_SECONDS)) return Promise.reject(error('clean_late_start', 'The audio start anchor must be in the future and within the bounded 500 ms acknowledgement window.'));
    if (!this.connected) { this.node.connect(this.outputGate); this.connected = true; }
    this.outputGate.gain.setValueAtTime(1, anchorFrame / this.context.sampleRate);
    this.state = 'starting';
    return this.request('start', {anchorFrame, ...this.timbreCommandBinding()});
  }
  cancel(reason = 'stop', {reportFailure = true, deferDisconnect = false} = {}) {
    if (this.disposed || this.disposing) return;
    if (deferDisconnect) { this.disposeFromError = this.state === 'error'; this.disposeNeedsLedger = ['ready', 'starting', 'running', 'pausing', 'paused', 'resuming'].includes(this.state); this.disposing = true; }
    let failure;
    try { if (deferDisconnect) this.mute(); else this.detach(); } catch (cause) { failure = error('audio_processor_error', 'The audio output could not be silenced.', {cause: String(cause)}); }
    this.rejectPending(error('audio_canceled', 'Playback was canceled; a fresh explicit preparation is required.'));
    this.state = 'canceled';
    try { this.nextGeneration(); this.node.port.postMessage({type: 'cancel', generation: this.generation, reason}); }
    catch (cause) { failure ||= error('audio_processor_error', 'Audio cancellation could not be delivered; the disconnected receiver is closed.', {cause: String(cause)}); }
    if (failure) { this.broken = true; this.state = 'error'; this.closePort({reportFailure: false}); if (reportFailure) this.onError(failure); }
    return failure;
  }
  stop() { this.cancel('stop'); }
  pause() { this.cancel('pause'); }
  reset() { this.cancel('reset'); }
  seek(positionMs) { if (!Number.isFinite(positionMs)) throw error('invalid_audio_command', 'A finite seek position is required.'); this.cancel('seek'); this.seekPositionMs = positionMs; }
  snapshot() { this.requireOpen(); return this.request('snapshot'); }
  completionAudit(offset, count) {
    const completion = this.lastCompletion;
    if (!Number.isSafeInteger(offset) || offset < 0 || offset > this.plan.notes.length || !Number.isSafeInteger(count) || count < 1 || count > LIMITS.maxAuditRows || !completion?.ledger || completion.planGeneration !== this.planGeneration) throw error('invalid_audio_command', 'The completion audit request is invalid.');
    const end = Math.min(this.plan.notes.length, offset + count), rows = [];
    for (let index = offset; index < end; index++) { const note = this.plan.notes[index]; rows.push({index, noteId: note[0], eventId: note[1], startFrame: note[2], endFrame: note[3], actualStartFrame: completion.ledger.actualStarts[index], actualEndFrame: completion.ledger.actualEnds[index]}); }
    return {...completion, type: 'audit', ledger: undefined, offset, nextOffset: end, rows};
  }
  audit({offset = 0, count = LIMITS.maxAuditRows} = {}) { this.requireOpen(); if (this.lastCompletion?.ledger && this.lastCompletion.planGeneration === this.planGeneration) return Promise.resolve(this.completionAudit(offset, count)); return this.request('audit', {offset, count}); }
  disposalAckMatches(message) {
    const plan = this.plan, ledger = message.ledger, length = plan?.rangeMode ? plan.recordCapacity : plan?.notes.length ?? 0;
    if (message.generation !== this.generation || message.planGeneration !== (this.planGeneration ?? 0) || message.reason !== 'dispose' || message.state !== 'canceled' || message.active !== 0 || message.sampleRate !== this.context.sampleRate || !frameDiagnostic(message.frame)
      || message.notes !== (plan?.notes.length ?? 0) || message.sourceNotes !== (plan?.sourceNotes ?? 0) || message.durationFrames !== (plan?.durationFrames ?? 0)
      || !integer(message.started, 0, length) || message.ended !== message.started || !integer(message.skipped, 0, message.notes)) return false;
    if (ledger === null) return !this.disposeNeedsLedger || this.lastCompletion?.planGeneration === message.planGeneration;
    // Constant-size lifecycle validation only. The independent evidence oracle
    // checks every sample gate; cleanup does not rescan a complete score.
    return Boolean(ledger && [ledger.actualStarts, ledger.actualEnds].every(rows => Object.prototype.toString.call(rows) === '[object Float64Array]' && rows.length === length));
  }
  fail(reason) { this.rejectPending(reason); if (this.disposing) { this.broken = true; this.closePort({reportFailure: false}); } else this.cancel('error', {reportFailure: false}); this.state = 'error'; this.onError(reason); }
  receive(message) {
    if (this.disposed || !message || !Number.isSafeInteger(message.generation)) return;
    // Disposal completion and earlier terminal evidence are separate: a real
    // stop ledger may be followed by a ledger-less dispose ACK on the port.
    const disposalAck = this.disposing && message.type === 'canceled' && this.disposalAckMatches(message);
    const replacedTerminal = message.reason === 'prepare_replaced' && message.generation === message.planGeneration;
    if (this.disposing && message.type === 'canceled' && !disposalAck && (message.generation >= this.generation || message.generation <= message.planGeneration && !replacedTerminal || !message.ledger)) {
      if (this.disposeFromError && message.generation === this.generation) this.closePort({reportFailure: false});
      return;
    }
    if (['ready', 'error', 'stale'].includes(message.type) && message.generation === this.prepareInFlight) this.prepareInFlight = null;
    if (message.type === 'canceled' && message.generation > this.prepareInFlight) this.prepareInFlight = null;
    if (this.timbreBindings.size && ['ready', 'started', 'snapshot', 'audit', 'audit_transferred', 'ended', 'canceled'].includes(message.type) && (message.type !== 'canceled' || message.ledger || this.disposing)) {
      const binding = this.timbreBindings.get(message.planGeneration);
      if (binding && ((message.assistanceFingerprint ?? null) !== binding.assistanceFingerprint || (message.assistancePlanFingerprint ?? null) !== binding.assistancePlanFingerprint)) {
        this.fail(error('audio_assistance_fingerprint', 'The audio acknowledgement belongs to another assistance ownership selection.')); return;
      }
      if (message.generation === this.generation && message.type !== 'canceled' && message.planGeneration !== this.planGeneration || binding && ((message.timbreProfile ?? null) !== binding.timbreProfile || (message.timbreFingerprint ?? null) !== binding.timbreFingerprint || ['sourceSha256', 'policyId', 'identityKind', 'sampleRate'].some(key => message[key] !== binding[key]))) {
        if (message.type === 'canceled' && (this.state === 'error' || this.disposing)) { if (this.disposing && this.disposeFromError && message.generation === this.generation) this.closePort({reportFailure: false}); return; }
        this.fail(error('audio_timbre_fingerprint', 'The audio acknowledgement belongs to another source or synthetic color selection.')); return;
      }
      if (!binding && message.ledger) return;
    }
    if (['ended', 'canceled'].includes(message.type) && message.ledger && message.planGeneration >= (this.lastCompletion?.planGeneration ?? 0)) {
      // One bounded terminal ledger is retained even if a later cancellation
      // has already fenced transport callbacks. Its generation is explicit.
      this.lastCompletion = Object.freeze({...message, anchorTime: message.anchorFrame / message.sampleRate, positionMs: message.positionFrame * 1000 / message.sampleRate});
      if (message.type === 'canceled') this.onStopped(this.lastCompletion);
    }
    if (this.disposing && disposalAck) { this.closePort(); return; }
    if (message.generation !== this.generation) return;
    if (this.disposing && message.type !== 'error') return;
    const pending = this.pending.get(message.requestId);
    if (message.type === 'audit_transferred' && pending) {
      try { const result = this.completionAudit(message.offset, message.count); this.takePending(message.requestId); pending.resolve(result); }
      catch (reason) { this.takePending(message.requestId); pending.reject(reason); }
      return;
    }
    if (message.type === 'error') { const reason = error(message.code, message.message, processorErrorDetails(message)); this.fail(reason); return; }
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
    // A synchronous disconnect takes the browser's graph lock while the core
    // can still be running. Mute/fence now; mutate that graph only after the
    // matching cancel ACK, or after the existing bounded cleanup deadline.
    this.cancel('dispose', {deferDisconnect: true}); if (this.disposed) return; this.state = 'disposed';
    if (this.broken || this.context.state === 'closed') this.closePort();
    // Lifecycle cleanup only, never note scheduling. A stopped/suspended audio
    // thread may never acknowledge; retain no dead port beyond this grace time.
    else try { this.disposeTimer = this.setTimer(() => this.closePort(), 1000); }
    catch (cause) { this.fail(error('audio_processor_error', 'The audio disposal deadline could not be armed.', {cause: String(cause)})); }
  }
  closePort({reportFailure = true} = {}) {
    if (this.disposed) return;
    this.disposed = true; this.disposing = false;
    this.rejectPending(error('audio_receiver_closed', 'The audio receiver is closed.'));
    let failure;
    const cleanup = run => { try { run(); } catch (cause) { failure ||= error('audio_processor_error', 'The disposed audio receiver could not finish cleanup.', {cause: String(cause)}); } };
    cleanup(() => this.context.removeEventListener?.('statechange', this.stateListener));
    cleanup(() => { if (this.connected) { try { this.node.disconnect(); } finally { this.connected = false; } } });
    cleanup(() => this.outputGate.disconnect());
    if (this.disposeTimer !== undefined) cleanup(() => this.clearTimer(this.disposeTimer));
    this.node.port.onmessage = null; this.node.port.onmessageerror = null; this.node.onprocessorerror = null; cleanup(() => this.node.port.close?.());
    if (failure && reportFailure) this.onError(failure);
  }
}
