import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {BasicKeyAudioCore} from '../web/basic-key-audio-core.js';
import {BASIC_KEY_AUDIO_PROTOCOL, BASIC_KEY_AUDIO_LIMITS, basicKeyGateFrames, buildBasicKeyAudioPlan, validateBasicKeyAudioPlan, encodeBasicKeyAudioPlan, decodeBasicKeyAudioPlan, createBasicKeyAudioTransfer} from '../web/basic-key-audio-plan.js';
import {cleanErrorText} from '../web/clean-song-text.js';
import {BasicKeyAudioReceiver} from '../web/basic-key-audio-receiver.js';
import {basicKeySong} from './basic-key-rendition-fixtures.js';
import {basicKeyAudioHarness} from './basic-key-audio-harness.js';
import {DENSE_STREAM, denseDigest, originalDenseRenditionMidi, expectedDenseAttacks} from '../scripts/prepare-dense-rendition-fixture.mjs';

const hash = 'a'.repeat(64), sampleRate = 48000;
function lifecycleTimers() {
  let serial = 0;
  const pending = new Map();
  return {pending, setTimer(callback, delay) { const id = ++serial; pending.set(id, {callback, delay}); return id; }, clearTimer(id) { pending.delete(id); }, fire() { const [id, value] = pending.entries().next().value; pending.delete(id); value.callback(); }};
}
function plan(rows, {rate = sampleRate, duration = Math.max(0, ...rows.map(row => row[1]))} = {}) {
  return validateBasicKeyAudioPlan({protocol: BASIC_KEY_AUDIO_PROTOCOL, policyId: 'wmh-basic-key-rendition-fifo-v1', sourceSha256: hash, sampleRate: rate, durationFrames: duration, sourceNotes: rows.length, notes: rows.map((row, index) => [`midi-t1-e${index + 1}`, `midi:${hash}:t0:e${index}`, ...row])});
}
function transferWire(program) { return createBasicKeyAudioTransfer(program).wire; }
function finishCorePreparation(core, frame = 0) { while (core.state === 'preparing') { core.process([new Float32Array(128)], frame); frame += 128; } return frame; }
function coreRun(program, {anchor = 2400, position = 0, blockSize = 128, trace = []} = {}) {
  const messages = [], core = new BasicKeyAudioCore(program.sampleRate, {emit: message => messages.push(message), trace: event => trace.push(event)});
  core.handleMessage({type: 'prepare', generation: 1, wire: transferWire(program), positionFrame: position}, 0);
  let frame = finishCorePreparation(core); anchor += frame;
  assert.equal(core.state, 'ready'); core.handleMessage({type: 'start', generation: 1, anchorFrame: anchor}, frame); assert.equal(core.state, 'running');
  let nonzero = 0, last;
  while (core.state === 'running') { last = new Float32Array(blockSize); core.process([last], frame); nonzero += last.reduce((count, value) => count + (value !== 0), 0); frame += blockSize; }
  assert.equal(core.state, 'ended', JSON.stringify(messages));
  const silence = new Float32Array(blockSize).fill(1); core.process([silence], frame); assert.ok(silence.every(value => value === 0));
  return {core, trace, messages, nonzero, last, anchor, ledger: messages.at(-1).ledger};
}

test('native five-attack plan preserves identity, independent gates, percussion and exact sample timing', () => {
  const song = basicKeySong(), before = JSON.stringify(song), program = buildBasicKeyAudioPlan(song, {sampleRate});
  assert.equal(program.notes.length, 5); assert.equal(program.sourceSha256, song.score.source.sha256); assert.ok(Object.isFrozen(program.notes[0]));
  const result = coreRun(program);
  assert.equal(result.core.startedCount, 5); assert.equal(result.core.endedCount, 5); assert.ok(result.nonzero > 0);
  for (const [index, note] of program.notes.entries()) { assert.equal(result.ledger.actualStarts[index], result.anchor + note[2]); assert.equal(result.ledger.actualEnds[index], result.anchor + note[3]); }
  assert.equal(JSON.stringify(song), before);
  assert.equal(buildBasicKeyAudioPlan(song, {sampleRate, mutedParts: song.runtime.parts.map(part => part.id)}).notes.length, 0);
});

test('all 6144 original dense attacks and gate ends render exactly with no main-thread work after start', () => {
  const source = originalDenseRenditionMidi(), sourceSha256 = denseDigest(source), expected = expectedDenseAttacks(sourceSha256);
  const program = validateBasicKeyAudioPlan({protocol: BASIC_KEY_AUDIO_PROTOCOL, policyId: 'wmh-basic-key-rendition-fifo-v1', sourceSha256, sampleRate, durationFrames: DENSE_STREAM.durationMs * sampleRate / 1000, sourceNotes: expected.length, notes: expected.map(note => [note.id, note.eventId, note.startMs * sampleRate / 1000, (note.startMs + note.durationMs) * sampleRate / 1000, note.key, note.velocity, 0])});
  const {core, trace, messages, anchor, ledger} = coreRun(program);
  assert.equal(core.startedCount, 6144); assert.equal(core.endedCount, 6144); assert.equal(core.activeCount, 0); assert.equal(trace.length, 12288);
  for (const [index, note] of expected.entries()) { assert.equal(program.notes[index][0], note.id); assert.equal(program.notes[index][1], note.eventId); assert.equal(ledger.actualStarts[index], anchor + note.startMs * 48); assert.equal(ledger.actualEnds[index], anchor + (note.startMs + note.durationMs) * 48); }
  assert.deepEqual(messages.map(message => message.type), ['ready', 'started', 'ended'], 'No polling or per-onset message traffic is required');
  assert.equal(messages.at(-1).ledger.actualStarts.length, 6144);
  core.handleMessage({type: 'audit', generation: 1, offset: 6000, count: 256}, core.expectedFrame);
  assert.equal(messages.at(-1).type, 'audit_transferred');
});

test('subsample gates retain attacks and every exact rational boundary remains within one sample', () => {
  for (const rate of [44100, 48000, 96000]) {
    const start = {numerator: '1000001', denominator: 17}, end = {numerator: '1000002', denominator: 17};
    const frames = basicKeyGateFrames(start, end, rate);
    assert.ok(frames[1] > frames[0]);
    assert.ok(Math.abs(frames[0] - 1000001 * rate / 17000000) < 1);
    assert.ok(Math.abs(frames[1] - 1000002 * rate / 17000000) < 1);
  }
  const {core, nonzero} = coreRun(plan([[0, 1, 60, 100, 0], [1, 2, 60, 100, 0], [2, 3, 60, 100, 1]]));
  assert.equal(core.startedCount, 3); assert.equal(nonzero, 3, 'Even one-sample melodic and percussion gates have an audible sample');
});

test('exactly 128 independent repeated-key voices work; 129 fail before any playback', () => {
  const rows = Array.from({length: 128}, () => [0, 128, 60, 1, 0]);
  const {core} = coreRun(plan(rows)); assert.equal(core.startedCount, 128); assert.equal(core.endedCount, 128);
  assert.throws(() => plan([...rows, [0, 128, 60, 1, 0]]), {code: 'voice_budget_exceeded'});
  coreRun(plan([...rows, ...Array.from({length: 128}, () => [128, 256, 60, 1, 0])]), {blockSize: 127});
});

test('bounded plan rejects invalid identities, excessive bytes, sample rate and mutable input aliases', () => {
  const input = JSON.parse(encodeBasicKeyAudioPlan(plan([[0, 100, 60, 80, 0]]))), copy = validateBasicKeyAudioPlan(input);
  input.notes[0][4] = 61; assert.equal(copy.notes[0][4], 60);
  input.notes[0][1] = `midi:${'b'.repeat(64)}:t0:e0`; assert.throws(() => validateBasicKeyAudioPlan(input), {code: 'invalid_audio_plan'});
  assert.throws(() => decodeBasicKeyAudioPlan(' '.repeat(BASIC_KEY_AUDIO_LIMITS.maxBytes + 1)), {code: 'audio_plan_limit'});
  assert.throws(() => plan([[0, 10, 127, 80, 0]], {rate: 22050}), {code: 'unsupported_audio_sample_rate'});
  assert.throws(() => validateBasicKeyAudioPlan({...copy, sourceNotes: BASIC_KEY_AUDIO_LIMITS.maxNotes + 1}), {code: 'invalid_audio_plan'});
});

test('resume selects only remaining gates with fresh envelopes, stable IDs, and no old attacks', () => {
  const program = plan([[0, 1000, 60, 80, 0], [0, 100, 60, 80, 0], [500, 600, 64, 80, 0]]);
  const {core, ledger, anchor} = coreRun(program, {position: 250});
  assert.deepEqual([...ledger.actualStarts], [anchor, -1, anchor + 250]); assert.deepEqual([...ledger.actualEnds], [anchor + 750, -1, anchor + 350]); assert.equal(core.skippedCount, 1);
  const countIn = coreRun(plan([[0, 10, 60, 80, 0]]), {position: -200}); assert.equal(countIn.ledger.actualStarts[0], countIn.anchor + 200);
});

test('resume at 1034.6 ms excludes the ended 500–1000 ms gate despite a 50 ms future audio anchor', async () => {
  const h = basicKeyAudioHarness(), receiver = await BasicKeyAudioReceiver.create(h.context, h.output, {nodeFactory: h.nodeFactory});
  const program = plan([[24000, 48000, 60, 80, 0], [24000, 72000, 64, 80, 0]]);
  const ready = await receiver.prepare(program, {positionMs: 1034.6});
  assert.equal(ready.positionFrame, 49661); assert.equal(ready.skipped, 1); assert.equal(ready.eligibleNotes, 1);
  const started = await receiver.start({anchorTime: h.context.currentTime + .05});
  assert.equal(started.anchorFrame, 2528); assert.equal(started.positionMs, 49661 / 48);
  while (h.nodes[0].core.state === 'running') h.renderBlock(); h.deliverMain();
  const audit = await receiver.audit();
  assert.equal(audit.rows[0].actualStartFrame, -1); assert.equal(audit.rows[0].actualEndFrame, -1);
  assert.equal(audit.rows[1].eventId, program.notes[1][1]); assert.equal(audit.rows[1].actualStartFrame, started.anchorFrame);
  assert.equal(audit.rows[1].actualEndFrame, started.anchorFrame + 72000 - 49661); assert.equal(audit.rows[1].endFrame, 72000);
  assert.equal(audit.started, 1); receiver.dispose(); await Promise.resolve(); await Promise.resolve();
});

test('cancellation fences stale starts and ready replies, and no generation automatically resumes', () => {
  const messages = [], core = new BasicKeyAudioCore(sampleRate, {emit: message => messages.push(message)}), program = plan([[0, 9000, 60, 80, 0], [5000, 7000, 61, 80, 0]]);
  core.handleMessage({type: 'prepare', generation: 1, positionFrame: 0, wire: transferWire(program)}, 0);
  finishCorePreparation(core); core.handleMessage({type: 'start', generation: 1, anchorFrame: 256}, 128);
  core.process([new Float32Array(256)], 128); assert.equal(core.activeCount, 1);
  core.handleMessage({type: 'cancel', generation: 2, reason: 'pause'}, 384); assert.equal(core.activeCount, 0);
  assert.equal(messages.at(-1).ledger.actualEnds[0], 384); assert.equal(messages.at(-1).planGeneration, 1);
  core.handleMessage({type: 'start', generation: 1, anchorFrame: 500}, 384); assert.equal(messages.at(-1).type, 'stale');
  const silence = new Float32Array(10000).fill(1); core.process([silence], 384); assert.ok(silence.every(value => value === 0)); assert.equal(core.startedCount, 1);
});

test('late starts and audio sample-clock discontinuities fail explicitly without catch-up', () => {
  const messages = [], core = new BasicKeyAudioCore(sampleRate, {emit: message => messages.push(message)}), wire = transferWire(plan([[0, 1000, 60, 80, 0]]));
  core.handleMessage({type: 'prepare', generation: 1, positionFrame: 0, wire}, 128);
  finishCorePreparation(core, 128); core.handleMessage({type: 'start', generation: 1, anchorFrame: 255}, 256); assert.equal(messages.at(-1).code, 'clean_late_start'); assert.equal(core.startedCount, 0);
  core.handleMessage({type: 'prepare', generation: 2, positionFrame: 0, wire}, 256); finishCorePreparation(core, 256);
  core.handleMessage({type: 'start', generation: 2, anchorFrame: 512}, 384); core.process([new Float32Array(128)], 384); core.process([new Float32Array(128)], 640);
  assert.equal(messages.at(-1).code, 'audio_render_discontinuity'); assert.equal(core.startedCount, 0);
});

test('actual production processor wrapper delegates global currentFrame and output block size', () => {
  let Processor;
  class Base { constructor() { this.port = {messages: [], postMessage(message) { this.messages.push(message); }}; } }
  const realm = vm.createContext({AudioWorkletProcessor: Base, BasicKeyAudioCore, sampleRate, currentFrame: 0, registerProcessor(name, value) { assert.equal(name, BASIC_KEY_AUDIO_PROTOCOL); Processor = value; }});
  const source = readFileSync(new URL('../web/basic-key-audio-processor.js', import.meta.url), 'utf8').replace(/^import .*;\n/, '').replace('export class ', 'class ');
  vm.runInContext(source, realm); const processor = new Processor(), wire = transferWire(plan([[0, 1, 60, 80, 0]]));
  processor.port.onmessage({data: {type: 'prepare', generation: 1, wire, positionFrame: 0}});
  const first = new Float32Array(128); assert.equal(processor.process([], [[first]]), true); assert.ok(first.every(value => value === 0));
  realm.currentFrame = 128; processor.port.onmessage({data: {type: 'start', generation: 1, anchorFrame: 256}}); processor.process([], [[first]]);
  realm.currentFrame = 256; const second = new Float32Array(64); processor.process([], [[second]]); assert.notEqual(second[0], 0); assert.ok(second.slice(1).every(value => value === 0)); assert.equal(processor.port.messages.at(-1).type, 'ended');
});

test('adapter prepares before a cheap anchored start and audio continues while main-thread messages stall', async () => {
  const h = basicKeyAudioHarness(), ended = [], receiver = await BasicKeyAudioReceiver.create(h.context, h.output, {nodeFactory: h.nodeFactory, onEnded: event => ended.push(event)});
  await receiver.prepare(plan([[0, 1000, 60, 80, 0], [1200, 1500, 64, 80, 0]]), {positionMs: .001});
  const started = await receiver.start({anchorTime: h.context.currentTime + .05}); assert.equal(started.anchorFrame, 2528); assert.equal(started.positionMs, 0);
  for (let block = 0; block < 40; block++) h.renderBlock();
  assert.equal(h.nodes[0].core.startedCount, 2); assert.equal(h.nodes[0].core.endedCount, 2); assert.equal(ended.length, 0);
  h.deliverMain(); assert.equal(ended.length, 1); assert.equal(receiver.lastCompletion.ledger.actualStarts.length, 2);
  const audit = await receiver.audit(); assert.equal(audit.rows[1].actualStartFrame, started.anchorFrame + 1200); receiver.dispose(); await Promise.resolve(); await Promise.resolve(); assert.equal(h.nodes[0].closed, true);
});

test('adapter canceled prepare and start promises reject; delayed successes never resume transport', async () => {
  const h = basicKeyAudioHarness({autoMessages: false}), started = [], receiver = await BasicKeyAudioReceiver.create(h.context, h.output, {nodeFactory: h.nodeFactory, onStarted: event => started.push(event)});
  const preparing = receiver.prepare(plan([[0, 500, 60, 80, 0]])); const rejection = assert.rejects(preparing, {code: 'audio_canceled'}); receiver.stop(); await rejection;
  h.deliverCore(); h.deliverMain(); assert.equal(receiver.state, 'canceled'); assert.equal(h.nodes[0].core.state, 'canceled'); assert.equal(receiver.prepareInFlight, null);
  const again = receiver.prepare(plan([[0, 500, 60, 80, 0]])); h.deliverCore(); h.finishPreparation(); h.deliverMain(); await again;
  const starting = receiver.start({anchorTime: h.context.currentTime + .05}), startRejection = assert.rejects(starting, {code: 'audio_canceled'}); receiver.seek(100); await startRejection;
  h.deliverCore(); h.deliverMain(); assert.equal(started.length, 0); assert.equal(receiver.connected, false); assert.equal(h.nodes[0].core.state, 'canceled'); receiver.dispose(); h.deliverCore(); h.deliverMain();
});

test('device interruption cancels and stays stopped after resume; unsupported worklet has no timer fallback', async () => {
  const h = basicKeyAudioHarness(), errors = [], receiver = await BasicKeyAudioReceiver.create(h.context, h.output, {nodeFactory: h.nodeFactory, onError: event => errors.push(event)});
  await receiver.prepare(plan([[0, 500, 60, 80, 0]])); await receiver.start(); h.setState('suspended'); assert.equal(errors[0].code, 'clean_clock_unavailable'); assert.equal(receiver.connected, false);
  h.setState('running'); assert.equal(receiver.state, 'error'); await Promise.resolve(); assert.equal(h.nodes[0].core.state, 'canceled'); receiver.dispose(); await Promise.resolve(); await Promise.resolve();
  await assert.rejects(BasicKeyAudioReceiver.create({state: 'running'}, {}), {code: 'audio_worklet_unavailable'});
});

test('a delayed start acknowledgement fails the promise before transport can report success', async () => {
  const h = basicKeyAudioHarness({autoMessages: false}), errors = [], started = [], receiver = await BasicKeyAudioReceiver.create(h.context, h.output, {nodeFactory: h.nodeFactory, onError: value => errors.push(value), onStarted: value => started.push(value)});
  const preparing = receiver.prepare(plan([[0, 10000, 60, 80, 0]])); h.deliverCore(); h.finishPreparation(); h.deliverMain(); await preparing;
  const starting = receiver.start({anchorTime: h.context.currentTime + .05}), rejected = assert.rejects(starting, {code: 'clean_late_start'}); h.deliverCore();
  for (let index = 0; index < 20; index++) h.renderBlock();
  h.deliverMain(); await rejected; assert.equal(started.length, 0); assert.equal(receiver.connected, false); assert.equal(errors[0].code, 'clean_late_start');
  h.deliverCore(); h.deliverMain(); assert.equal(h.nodes[0].core.activeCount, 0); receiver.dispose(); h.deliverCore(); h.deliverMain();
});

test('disposing an active receiver immediately detaches and reports its actual cancellation ledger asynchronously', async () => {
  const h = basicKeyAudioHarness(), stopped = [], receiver = await BasicKeyAudioReceiver.create(h.context, h.output, {nodeFactory: h.nodeFactory, onStopped: value => stopped.push(value)});
  await receiver.prepare(plan([[0, 10000, 60, 80, 0], [5000, 6000, 64, 80, 0]])); await receiver.start({anchorTime: h.context.currentTime + .001});
  h.renderBlock(); assert.equal(h.nodes[0].core.activeCount, 1); receiver.dispose(); assert.equal(receiver.connected, false); assert.equal(h.nodes[0].closed, false);
  await Promise.resolve(); await Promise.resolve(); assert.equal(h.nodes[0].closed, true); assert.equal(stopped.length, 1);
  assert.equal(stopped[0].planGeneration, 1); assert.equal(stopped[0].generation, 2); assert.deepEqual([...stopped[0].ledger.actualStarts], [176, -1]); assert.deepEqual([...stopped[0].ledger.actualEnds], [256, -1]);
});

test('invalid prepare silences the previous plan; bounded generations never wrap or restart it', () => {
  const messages = [], core = new BasicKeyAudioCore(sampleRate, {emit: value => messages.push(value)}), wire = transferWire(plan([[0, 1000, 60, 80, 0]]));
  core.handleMessage({type: 'prepare', generation: 1, wire, positionFrame: 0}, 0); finishCorePreparation(core); core.handleMessage({type: 'start', generation: 1, anchorFrame: 192}, 128); core.process([new Float32Array(128)], 128);
  core.handleMessage({type: 'prepare', generation: 2, wire: '{}', positionFrame: 0}, 256); assert.equal(core.activeCount, 0); assert.equal(core.state, 'error'); assert.equal(messages.at(-2).ledger.actualEnds[0], 256);
  core.handleMessage({type: 'start', generation: 1, anchorFrame: 400}, 256); assert.equal(messages.at(-1).type, 'stale');
  core.handleMessage({type: 'prepare', generation: BASIC_KEY_AUDIO_LIMITS.maxGeneration, wire, positionFrame: 0}, 256); finishCorePreparation(core, 256); assert.equal(core.state, 'ready');
  core.handleMessage({type: 'prepare', generation: BASIC_KEY_AUDIO_LIMITS.maxGeneration + 1, wire, positionFrame: 0}, 384); assert.equal(core.state, 'error'); assert.equal(messages.at(-1).code, 'invalid_audio_command');
});

test('the same percussion recipe is deterministic across selectors and block shapes', () => {
  function audio(key, blocks) {
    const core = new BasicKeyAudioCore(sampleRate), wire = transferWire(plan([[0, 800, key, 80, 1]])), samples = [];
    core.handleMessage({type: 'prepare', generation: 1, wire, positionFrame: 0}, 0); let frame = finishCorePreparation(core); assert.equal(core.state, 'ready'); core.handleMessage({type: 'start', generation: 1, anchorFrame: 256}, frame);
    while (frame < 1152) { const length = Math.min(blocks, 1152 - frame), output = new Float32Array(length); core.process([output], frame); samples.push(...output); frame += length; }
    assert.ok(samples.some(value => value !== 0));
    return samples;
  }
  assert.deepEqual(audio(0, 128), audio(127, 37));
});

test('lost prepare acknowledgment times out, clears deadlines and fences a later ready reply', async () => {
  const h = basicKeyAudioHarness({autoMessages: false}), timers = lifecycleTimers(), errors = [], receiver = await BasicKeyAudioReceiver.create(h.context, h.output, {nodeFactory: h.nodeFactory, ...timers, onError: value => errors.push(value)});
  const preparing = receiver.prepare(plan([[0, 500, 60, 80, 0]])), rejected = assert.rejects(preparing, {code: 'audio_command_timeout'});
  h.deliverCore(); assert.equal([...timers.pending.values()][0].delay, 5000); timers.fire(); await rejected;
  assert.equal(timers.pending.size, 0); assert.equal(receiver.pending.size, 0); assert.equal(receiver.state, 'error'); assert.equal(errors[0].details.command, 'prepare');
  h.deliverMain(); assert.equal(receiver.state, 'error'); h.deliverCore(); h.deliverMain(); assert.equal(h.nodes[0].core.state, 'canceled');
  receiver.dispose(); h.deliverCore(); h.deliverMain(); assert.equal(timers.pending.size, 0);
});

test('lost start acknowledgment expires at its unchanged anchor and never restarts after a stale reply', async () => {
  const h = basicKeyAudioHarness({autoMessages: false}), timers = lifecycleTimers(), started = [], receiver = await BasicKeyAudioReceiver.create(h.context, h.output, {nodeFactory: h.nodeFactory, ...timers, onStarted: value => started.push(value)});
  const preparing = receiver.prepare(plan([[0, 10000, 60, 80, 0]])); h.deliverCore(); h.finishPreparation(); h.deliverMain(); await preparing; assert.equal(timers.pending.size, 0);
  const starting = receiver.start({anchorTime: h.context.currentTime + .05}), rejected = assert.rejects(starting, {code: 'audio_command_timeout'}); assert.equal([...timers.pending.values()][0].delay, 50);
  h.deliverCore(); timers.fire(); await rejected; assert.equal(receiver.connected, false); assert.equal(timers.pending.size, 0);
  h.deliverMain(); assert.equal(started.length, 0); assert.equal(receiver.state, 'error'); h.deliverCore(); h.deliverMain();
  h.renderBlock(6000); assert.equal(h.nodes[0].core.startedCount, 0); receiver.dispose(); h.deliverCore(); h.deliverMain();
});

for (const command of ['audit', 'snapshot']) test(`lost ${command} acknowledgment explicitly cancels active output and clears pending timers`, async () => {
  const h = basicKeyAudioHarness({autoMessages: false}), timers = lifecycleTimers(), errors = [], receiver = await BasicKeyAudioReceiver.create(h.context, h.output, {nodeFactory: h.nodeFactory, ...timers, onError: value => errors.push(value)});
  const preparing = receiver.prepare(plan([[0, 10000, 60, 80, 0]])); h.deliverCore(); h.finishPreparation(); h.deliverMain(); await preparing;
  const starting = receiver.start({anchorTime: h.context.currentTime + .001}); h.deliverCore(); h.deliverMain(); await starting; assert.equal(timers.pending.size, 0);
  h.renderBlock(); assert.equal(h.nodes[0].core.activeCount, 1);
  const request = receiver[command](), rejected = assert.rejects(request, {code: 'audio_command_timeout'}); h.deliverCore(); timers.fire(); await rejected;
  assert.equal(receiver.connected, false); assert.equal(receiver.pending.size, 0); assert.equal(timers.pending.size, 0); assert.equal(errors[0].details.command, command);
  h.deliverMain(); assert.equal(receiver.state, 'error'); h.deliverCore(); h.deliverMain(); assert.equal(h.nodes[0].core.activeCount, 0);
  receiver.dispose(); h.deliverCore(); h.deliverMain();
});

test('cancellation delivery failure cannot mask the original device error or leave pending promises', async () => {
  const h = basicKeyAudioHarness({autoMessages: false}), timers = lifecycleTimers(), errors = [], receiver = await BasicKeyAudioReceiver.create(h.context, h.output, {nodeFactory: h.nodeFactory, ...timers, onError: value => errors.push(value)});
  const preparing = receiver.prepare(plan([[0, 500, 60, 80, 0]])), rejected = assert.rejects(preparing, {code: 'clean_clock_unavailable'});
  h.nodes[0].port.postMessage = () => { throw new Error('Closed port'); };
  assert.doesNotThrow(() => h.setState('suspended')); await rejected;
  assert.equal(errors.length, 1); assert.equal(errors[0].code, 'clean_clock_unavailable'); assert.equal(receiver.pending.size, 0); assert.equal(timers.pending.size, 0); assert.equal(receiver.disposed, true);
  h.setState('running'); assert.equal(receiver.state, 'error'); h.deliverCore(); h.deliverMain(); assert.equal(receiver.state, 'error');
});

test('failed command and failed cancellation delivery report once and clear every deadline', async () => {
  const h = basicKeyAudioHarness({autoMessages: false}), timers = lifecycleTimers(), errors = [], receiver = await BasicKeyAudioReceiver.create(h.context, h.output, {nodeFactory: h.nodeFactory, ...timers, onError: value => errors.push(value)});
  h.nodes[0].port.postMessage = () => { throw new Error('Broken port'); };
  await assert.rejects(receiver.prepare(plan([[0, 500, 60, 80, 0]])), {code: 'audio_processor_error'});
  assert.equal(errors.length, 1); assert.equal(errors[0].details.command, 'prepare'); assert.equal(timers.pending.size, 0); assert.equal(receiver.pending.size, 0); assert.equal(receiver.disposed, true);
});

test('manual stop rejects a pending request even when its cancellation post throws', async () => {
  const h = basicKeyAudioHarness({autoMessages: false}), timers = lifecycleTimers(), errors = [], receiver = await BasicKeyAudioReceiver.create(h.context, h.output, {nodeFactory: h.nodeFactory, ...timers, onError: value => errors.push(value)});
  const preparing = receiver.prepare(plan([[0, 500, 60, 80, 0]])), rejected = assert.rejects(preparing, {code: 'audio_canceled'});
  h.nodes[0].port.postMessage = () => { throw new Error('Closed port'); };
  assert.doesNotThrow(() => receiver.stop()); await rejected;
  assert.equal(errors.length, 1); assert.equal(errors[0].code, 'audio_processor_error'); assert.equal(timers.pending.size, 0); assert.equal(receiver.pending.size, 0); assert.equal(receiver.connected, false);
});

test('a module load that never resolves has a bounded lifecycle deadline before any audio node exists', async () => {
  const h = basicKeyAudioHarness(), timers = lifecycleTimers(); let lateResolve;
  h.context.audioWorklet.addModule = () => new Promise(resolve => { lateResolve = resolve; });
  const creating = BasicKeyAudioReceiver.create(h.context, h.output, {nodeFactory: h.nodeFactory, ...timers}), rejected = assert.rejects(creating, {code: 'audio_worklet_unavailable'});
  await Promise.resolve(); assert.equal([...timers.pending.values()][0].delay, 5000); timers.fire(); await rejected;
  assert.equal(timers.pending.size, 0); assert.equal(h.nodes.length, 0); lateResolve(); await Promise.resolve(); await Promise.resolve(); assert.equal(h.nodes.length, 0);
});

test('maximum plan preparation is silent and bounded per quantum without render-thread JSON, sort or buffer copies', () => {
  const count = BASIC_KEY_AUDIO_LIMITS.maxNotes;
  for (const rate of [8000, 48000, 384000]) {
    const program = plan(Array.from({length: count}, (_, index) => [index * 2, index * 2 + 1, 60, 80, 0]), {rate, duration: count * 2});
    const packed = createBasicKeyAudioTransfer(program), wire = structuredClone(packed.wire, {transfer: packed.transfer});
    assert.ok(packed.transfer.every(buffer => buffer.byteLength === 0), 'Ownership was transferred away from the host');
    const messages = [], core = new BasicKeyAudioCore(rate, {emit: value => messages.push(value)}), startsBuffer = wire.buffers.starts, ledgerBuffer = wire.buffers.actualStarts;
    const parse = JSON.parse, sort = Array.prototype.sort;
    let frame = 0, maximumWork = 0, sounded = false;
    try {
      JSON.parse = () => { throw Error('Render-thread JSON is forbidden'); }; Array.prototype.sort = () => { throw Error('Render-thread sorting is forbidden'); };
      core.handleMessage({type: 'prepare', generation: 1, wire, positionFrame: 0}, frame);
      assert.equal(core.state, 'preparing'); assert.equal(messages.length, 0); assert.equal(core.prepareCursor, 0);
      while (core.state === 'preparing') { const output = new Float32Array(128); core.process([output], frame); sounded ||= output.some(value => value !== 0); maximumWork = Math.max(maximumWork, core.lastPrepareWork); frame += 128; }
    } finally { JSON.parse = parse; Array.prototype.sort = sort; }
    assert.equal(core.state, 'ready'); assert.equal(sounded, false); assert.equal(core.startedCount, 0); assert.ok(maximumWork <= 1024); assert.ok(frame / rate < 2.1);
    assert.equal(core.plan.starts.buffer, startsBuffer); assert.equal(core.actualStarts.buffer, ledgerBuffer); assert.deepEqual(messages.map(value => value.type), ['ready']);
    let transferred;
    core.emit = (value, transfer) => { transferred = {value, transfer}; };
    core.handleMessage({type: 'cancel', generation: 2}, frame);
    assert.equal(transferred.value.ledger.actualStarts.buffer, ledgerBuffer); assert.equal(transferred.transfer[0], ledgerBuffer, 'Terminal ledger transfers the existing buffer without slicing/copying'); assert.equal(core.actualStarts, null);
  }
});

test('incremental preparation cancellation and replacement never emit stale ready or unvalidated output', () => {
  const program = plan(Array.from({length: 1000}, (_, index) => [index * 2, index * 2 + 1, 60, 80, 0])), messages = [], core = new BasicKeyAudioCore(sampleRate, {emit: value => messages.push(value)});
  core.handleMessage({type: 'prepare', generation: 1, wire: transferWire(program), positionFrame: 0}, 0); core.process([new Float32Array(128)], 0);
  assert.equal(core.state, 'preparing'); assert.ok(core.prepareCursor > 0); core.handleMessage({type: 'cancel', generation: 2}, 128);
  const silence = new Float32Array(128).fill(1); core.process([silence], 128); assert.ok(silence.every(value => value === 0)); assert.equal(messages.some(value => value.type === 'ready'), false); assert.equal(messages.at(-1).ledger, null);
  core.handleMessage({type: 'prepare', generation: 3, wire: transferWire(plan([[0, 1, 60, 80, 0]])), positionFrame: 0}, 256); finishCorePreparation(core, 256);
  assert.deepEqual(messages.filter(value => value.type === 'ready').map(value => value.generation), [3]); assert.equal(core.startedCount, 0);
});

test('audio-thread incremental validation rejects corrupt identities, permutation, gates, and aliased buffers before ready', () => {
  const program = plan(Array.from({length: 130}, (_, index) => [index * 2, index * 2 + 1, 60, 80, 0]), {duration: 1000});
  const edits = [
    wire => { new Float64Array(wire.buffers.events)[1] = 0; },
    wire => { new Uint32Array(wire.buffers.idOrder)[1] = 0; },
    wire => { new Float64Array(wire.buffers.ends)[5] = -1; },
    wire => { new Uint8Array(wire.buffers.roles)[5] = 2; },
    wire => { wire.buffers.ends = wire.buffers.starts; },
    wire => { const starts = new Float64Array(wire.buffers.starts), ends = new Float64Array(wire.buffers.ends); for (let index = 0; index < 129; index++) { starts[index] = 0; ends[index] = 1000; } },
  ];
  for (const edit of edits) {
    const wire = transferWire(program); edit(wire); const messages = [], core = new BasicKeyAudioCore(sampleRate, {emit: value => messages.push(value)});
    core.handleMessage({type: 'prepare', generation: 1, wire, positionFrame: 0}, 0); finishCorePreparation(core);
    assert.equal(core.state, 'error'); assert.equal(messages.some(value => value.type === 'ready'), false); assert.equal(core.startedCount, 0); assert.ok(['invalid_audio_plan', 'voice_budget_exceeded'].includes(messages.at(-1).code));
  }
});

test('preparation connects a zero-output gate and a terminal ledger leaves the actual renderer by transfer', async () => {
  const h = basicKeyAudioHarness({autoMessages: false}), receiver = await BasicKeyAudioReceiver.create(h.context, h.output, {nodeFactory: h.nodeFactory});
  const preparing = receiver.prepare(plan([[0, 1, 60, 80, 0]])); assert.equal(receiver.connected, true); assert.equal(receiver.outputGate.gain.value, 0);
  h.deliverCore(); const buffer = h.nodes[0].core.actualStarts.buffer; h.finishPreparation(); h.deliverMain(); await preparing;
  const starting = receiver.start({anchorTime: h.context.currentTime + .001}); h.deliverCore(); h.deliverMain(); const started = await starting;
  h.renderBlock(); assert.equal(buffer.byteLength, 0, 'MessagePort transfer detaches the renderer ledger buffer'); h.deliverMain();
  assert.equal(receiver.lastCompletion.ledger.actualStarts[0], started.anchorFrame); const audit = await receiver.audit(); assert.equal(audit.rows[0].actualStartFrame, started.anchorFrame);
  receiver.dispose(); h.deliverCore(); h.deliverMain();
});

test('a context that suspends and resumes during module loading does not automatically admit a receiver', async () => {
  const h = basicKeyAudioHarness(); let resolveModule;
  h.context.audioWorklet.addModule = () => new Promise(resolve => { resolveModule = resolve; });
  const creating = BasicKeyAudioReceiver.create(h.context, h.output, {nodeFactory: h.nodeFactory}), rejected = assert.rejects(creating, {code: 'clean_audio_unavailable'});
  await Promise.resolve(); h.setState('suspended'); h.setState('running'); resolveModule(); await rejected;
  assert.equal(h.nodes.length, 0);
});


test('startup capability diagnostics retain the real secure-context state before creating a node',async()=>{
 const h=basicKeyAudioHarness(),descriptor=Object.getOwnPropertyDescriptor(globalThis,'isSecureContext');delete h.context.audioWorklet;Object.defineProperty(globalThis,'isSecureContext',{configurable:true,value:false});
 try{await assert.rejects(BasicKeyAudioReceiver.create(h.context,h.output,{nodeFactory:h.nodeFactory}),failure=>{assert.equal(failure.code,'audio_worklet_unavailable');assert.equal(failure.details.phase,'capability');assert.equal(failure.details.isSecureContext,false);assert.equal(failure.details.hasAudioWorklet,false);assert.equal(failure.details.addModuleType,'undefined');assert.equal(failure.details.contextState,'running');assert.match(failure.details.moduleUrl,/basic-key-audio-processor\.js$/);assert.match(cleanErrorText('en',failure),/requires AudioWorklet/);return true;});assert.equal(h.nodes.length,0);assert.equal(h.context.loaded.length,0);}finally{if(descriptor)Object.defineProperty(globalThis,'isSecureContext',descriptor);else delete globalThis.isSecureContext;}
});

for(const synchronous of [false,true])test(`module loading preserves the original ${synchronous?'thrown':'rejected'} error and accurate localized phase`,async()=>{
 const h=basicKeyAudioHarness(),timers=lifecycleTimers(),original=Object.assign(new Error('Original module loader detail <retained>'),{name:'AbortError'}),moduleUrl='https://wmh.localhost/basic-key-audio-processor.js';let owner,args;
 h.context.audioWorklet.addModule=function(...values){owner=this;args=values;if(synchronous)throw original;return Promise.reject(original);};
 await assert.rejects(BasicKeyAudioReceiver.create(h.context,h.output,{nodeFactory:h.nodeFactory,moduleUrl,...timers}),failure=>{assert.equal(failure.cause,original);assert.equal(failure.details.phase,'module-load');assert.equal(failure.details.outcome,'rejected');assert.equal(failure.details.causeName,'AbortError');assert.equal(failure.details.causeMessage,original.message);assert.equal(failure.details.moduleUrl,moduleUrl);assert.equal(failure.details.hasAudioWorklet,true);assert.equal(failure.details.addModuleType,'function');for(const locale of ['en','zh-CN']){const text=cleanErrorText(locale,failure);assert.ok(text.includes(original.message));assert.ok(text.includes(moduleUrl));assert.doesNotMatch(text,/requires AudioWorklet|需要浏览器支持 AudioWorklet/);}return true;});
 assert.equal(owner,h.context.audioWorklet);assert.deepEqual(args,[moduleUrl]);assert.equal(h.nodes.length,0);assert.equal(timers.pending.size,0);
});

test('module timeout is distinguished from missing browser capabilities without extending its deadline',async()=>{
 const h=basicKeyAudioHarness(),timers=lifecycleTimers();h.context.audioWorklet.addModule=()=>new Promise(()=>{});
 const creating=BasicKeyAudioReceiver.create(h.context,h.output,{nodeFactory:h.nodeFactory,...timers}),rejected=assert.rejects(creating,failure=>{assert.equal(failure.details.phase,'module-load');assert.equal(failure.details.outcome,'timeout');assert.equal(failure.details.timeoutMs,5000);assert.equal(failure.details.hasAudioWorklet,true);assert.match(cleanErrorText('en',failure),/5000 ms/);assert.doesNotMatch(cleanErrorText('zh-CN',failure),/需要浏览器支持/);return true;});await Promise.resolve();assert.equal([...timers.pending.values()][0].delay,5000);timers.fire();await rejected;assert.equal(timers.pending.size,0);assert.equal(h.nodes.length,0);
});

test('processor construction failure preserves its exact cause and original constructor arguments',async()=>{
 const h=basicKeyAudioHarness(),timers=lifecycleTimers(),original=Object.assign(new Error('Processor registration was missing'),{name:'NotSupportedError'});let values;
 await assert.rejects(BasicKeyAudioReceiver.create(h.context,h.output,{...timers,nodeFactory(...args){values=args;throw original;}}),failure=>{assert.equal(failure.details.phase,'node-construction');assert.equal(failure.cause,original);assert.equal(failure.details.causeName,'NotSupportedError');assert.ok(cleanErrorText('zh-CN',failure).includes(original.message));return true;});assert.equal(values[0],h.context);assert.equal(values[1],BASIC_KEY_AUDIO_PROTOCOL);assert.deepEqual(values[2],{numberOfInputs:0,numberOfOutputs:1,outputChannelCount:[1],channelCount:1});assert.equal(timers.pending.size,0);assert.equal(h.nodes.length,0);
});

test('receiver initialization failure releases the partial graph and port while retaining the original cause',async()=>{
 const h=basicKeyAudioHarness(),original=new Error('Output connection failed');let disconnected=0;
 h.context.createGain=()=>({gain:{value:0},connect(){throw original;},disconnect(){disconnected++;}});
 await assert.rejects(BasicKeyAudioReceiver.create(h.context,h.output,{nodeFactory:h.nodeFactory}),failure=>{assert.equal(failure.details.phase,'receiver-initialization');assert.equal(failure.cause,original);return true;});assert.equal(disconnected,1);assert.equal(h.nodes[0].connected,false);assert.equal(h.nodes[0].closed,true);
});
