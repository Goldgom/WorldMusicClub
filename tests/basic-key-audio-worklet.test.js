import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {BasicKeyAudioCore} from '../web/basic-key-audio-core.js';
import {BASIC_KEY_AUDIO_PROTOCOL, BASIC_KEY_AUDIO_LIMITS, basicKeyGateFrames, buildBasicKeyAudioPlan, validateBasicKeyAudioPlan, encodeBasicKeyAudioPlan, decodeBasicKeyAudioPlan} from '../web/basic-key-audio-plan.js';
import {BasicKeyAudioReceiver} from '../web/basic-key-audio-receiver.js';
import {basicKeySong} from './basic-key-rendition-fixtures.js';
import {basicKeyAudioHarness} from './basic-key-audio-harness.js';
import {DENSE_STREAM, denseDigest, originalDenseRenditionMidi, expectedDenseAttacks} from '../scripts/prepare-dense-rendition-fixture.mjs';

const hash = 'a'.repeat(64), sampleRate = 48000;
function plan(rows, {rate = sampleRate, duration = Math.max(0, ...rows.map(row => row[1]))} = {}) {
  return validateBasicKeyAudioPlan({protocol: BASIC_KEY_AUDIO_PROTOCOL, policyId: 'wmh-basic-key-rendition-fifo-v1', sourceSha256: hash, sampleRate: rate, durationFrames: duration, sourceNotes: rows.length, notes: rows.map((row, index) => [`midi-t1-e${index + 1}`, `midi:${hash}:t0:e${index}`, ...row])});
}
function coreRun(program, {anchor = 2400, position = 0, blockSize = 128, trace = []} = {}) {
  const messages = [], core = new BasicKeyAudioCore(program.sampleRate, {emit: message => messages.push(message), trace: event => trace.push(event)});
  core.handleMessage({type: 'prepare', generation: 1, wire: encodeBasicKeyAudioPlan(program), positionFrame: position}, 0);
  assert.equal(core.state, 'ready'); core.handleMessage({type: 'start', generation: 1, anchorFrame: anchor}, 0); assert.equal(core.state, 'running');
  let frame = 0, nonzero = 0, last;
  while (core.state === 'running') { last = new Float32Array(blockSize); core.process([last], frame); nonzero += last.reduce((count, value) => count + (value !== 0), 0); frame += blockSize; }
  assert.equal(core.state, 'ended', JSON.stringify(messages));
  const silence = new Float32Array(blockSize).fill(1); core.process([silence], frame); assert.ok(silence.every(value => value === 0));
  return {core, trace, messages, nonzero, last};
}

test('native five-attack plan preserves identity, independent gates, percussion and exact sample timing', () => {
  const song = basicKeySong(), before = JSON.stringify(song), program = buildBasicKeyAudioPlan(song, {sampleRate});
  assert.equal(program.notes.length, 5); assert.equal(program.sourceSha256, song.score.source.sha256); assert.ok(Object.isFrozen(program.notes[0]));
  const result = coreRun(program);
  assert.equal(result.core.startedCount, 5); assert.equal(result.core.endedCount, 5); assert.ok(result.nonzero > 0);
  for (const [index, note] of program.notes.entries()) { assert.equal(result.core.actualStarts[index], 2400 + note[2]); assert.equal(result.core.actualEnds[index], 2400 + note[3]); }
  assert.equal(JSON.stringify(song), before);
  assert.equal(buildBasicKeyAudioPlan(song, {sampleRate, mutedParts: song.runtime.parts.map(part => part.id)}).notes.length, 0);
});

test('all 6144 original dense attacks and gate ends render exactly with no main-thread work after start', () => {
  const source = originalDenseRenditionMidi(), sourceSha256 = denseDigest(source), expected = expectedDenseAttacks(sourceSha256);
  const program = validateBasicKeyAudioPlan({protocol: BASIC_KEY_AUDIO_PROTOCOL, policyId: 'wmh-basic-key-rendition-fifo-v1', sourceSha256, sampleRate, durationFrames: DENSE_STREAM.durationMs * sampleRate / 1000, sourceNotes: expected.length, notes: expected.map(note => [note.id, note.eventId, note.startMs * sampleRate / 1000, (note.startMs + note.durationMs) * sampleRate / 1000, note.key, note.velocity, 0])});
  const {core, trace, messages} = coreRun(program);
  assert.equal(core.startedCount, 6144); assert.equal(core.endedCount, 6144); assert.equal(core.activeCount, 0); assert.equal(trace.length, 12288);
  for (const [index, note] of expected.entries()) { assert.equal(program.notes[index][0], note.id); assert.equal(program.notes[index][1], note.eventId); assert.equal(core.actualStarts[index], 2400 + note.startMs * 48); assert.equal(core.actualEnds[index], 2400 + (note.startMs + note.durationMs) * 48); }
  assert.deepEqual(messages.map(message => message.type), ['ready', 'started', 'ended'], 'No polling or per-onset message traffic is required');
  assert.equal(messages.at(-1).ledger.actualStarts.length, 6144);
  core.handleMessage({type: 'audit', generation: 1, offset: 6000, count: 256}, core.expectedFrame);
  assert.equal(messages.at(-1).rows.length, 144); assert.equal(messages.at(-1).rows.at(-1).eventId, expected.at(-1).eventId);
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
  const {core} = coreRun(program, {position: 250});
  assert.deepEqual([...core.actualStarts], [2400, -1, 2650]); assert.deepEqual([...core.actualEnds], [3150, -1, 2750]); assert.equal(core.skippedCount, 1);
  const countIn = coreRun(plan([[0, 10, 60, 80, 0]]), {position: -200}); assert.equal(countIn.core.actualStarts[0], 2600);
});

test('resume at 1034.6 ms excludes the ended 500–1000 ms gate despite a 50 ms future audio anchor', async () => {
  const h = basicKeyAudioHarness(), receiver = await BasicKeyAudioReceiver.create(h.context, h.output, {nodeFactory: h.nodeFactory});
  const program = plan([[24000, 48000, 60, 80, 0], [24000, 72000, 64, 80, 0]]);
  const ready = await receiver.prepare(program, {positionMs: 1034.6});
  assert.equal(ready.positionFrame, 49661); assert.equal(ready.skipped, 1); assert.equal(ready.eligibleNotes, 1);
  const started = await receiver.start({anchorTime: h.context.currentTime + .05});
  assert.equal(started.anchorFrame, 2400); assert.equal(started.positionMs, 49661 / 48);
  while (h.nodes[0].core.state === 'running') h.renderBlock(); h.deliverMain();
  const audit = await receiver.audit();
  assert.equal(audit.rows[0].actualStartFrame, -1); assert.equal(audit.rows[0].actualEndFrame, -1);
  assert.equal(audit.rows[1].eventId, program.notes[1][1]); assert.equal(audit.rows[1].actualStartFrame, 2400);
  assert.equal(audit.rows[1].actualEndFrame, 2400 + 72000 - 49661); assert.equal(audit.rows[1].endFrame, 72000);
  assert.equal(audit.started, 1); receiver.dispose(); await Promise.resolve(); await Promise.resolve();
});

test('cancellation fences stale starts and ready replies, and no generation automatically resumes', () => {
  const messages = [], core = new BasicKeyAudioCore(sampleRate, {emit: message => messages.push(message)}), program = plan([[0, 9000, 60, 80, 0], [5000, 7000, 61, 80, 0]]);
  core.handleMessage({type: 'prepare', generation: 1, positionFrame: 0, wire: encodeBasicKeyAudioPlan(program)}, 0);
  core.handleMessage({type: 'start', generation: 1, anchorFrame: 128}, 0);
  core.process([new Float32Array(256)], 0); assert.equal(core.activeCount, 1);
  core.handleMessage({type: 'cancel', generation: 2, reason: 'pause'}, 256); assert.equal(core.activeCount, 0);
  assert.equal(messages.at(-1).ledger.actualEnds[0], 256); assert.equal(messages.at(-1).planGeneration, 1);
  core.handleMessage({type: 'start', generation: 1, anchorFrame: 300}, 256); assert.equal(messages.at(-1).type, 'stale');
  const silence = new Float32Array(10000).fill(1); core.process([silence], 256); assert.ok(silence.every(value => value === 0)); assert.equal(core.startedCount, 1);
});

test('late starts and audio sample-clock discontinuities fail explicitly without catch-up', () => {
  const messages = [], core = new BasicKeyAudioCore(sampleRate, {emit: message => messages.push(message)}), wire = encodeBasicKeyAudioPlan(plan([[0, 1000, 60, 80, 0]]));
  core.handleMessage({type: 'prepare', generation: 1, positionFrame: 0, wire}, 128);
  core.handleMessage({type: 'start', generation: 1, anchorFrame: 127}, 128); assert.equal(messages.at(-1).code, 'clean_late_start'); assert.equal(core.startedCount, 0);
  core.handleMessage({type: 'prepare', generation: 2, positionFrame: 0, wire}, 128);
  core.handleMessage({type: 'start', generation: 2, anchorFrame: 256}, 128); core.process([new Float32Array(128)], 128); core.process([new Float32Array(128)], 384);
  assert.equal(messages.at(-1).code, 'audio_render_discontinuity'); assert.equal(core.startedCount, 0);
});

test('actual production processor wrapper delegates global currentFrame and output block size', () => {
  let Processor;
  class Base { constructor() { this.port = {messages: [], postMessage(message) { this.messages.push(message); }}; } }
  const realm = vm.createContext({AudioWorkletProcessor: Base, BasicKeyAudioCore, sampleRate, currentFrame: 0, registerProcessor(name, value) { assert.equal(name, BASIC_KEY_AUDIO_PROTOCOL); Processor = value; }});
  const source = readFileSync(new URL('../web/basic-key-audio-processor.js', import.meta.url), 'utf8').replace(/^import .*;\n/, '').replace('export class ', 'class ');
  vm.runInContext(source, realm); const processor = new Processor(), wire = encodeBasicKeyAudioPlan(plan([[0, 1, 60, 80, 0]]));
  processor.port.onmessage({data: {type: 'prepare', generation: 1, wire, positionFrame: 0}}); processor.port.onmessage({data: {type: 'start', generation: 1, anchorFrame: 128}});
  const first = new Float32Array(128); assert.equal(processor.process([], [[first]]), true); assert.ok(first.every(value => value === 0));
  realm.currentFrame = 128; const second = new Float32Array(64); processor.process([], [[second]]); assert.notEqual(second[0], 0); assert.ok(second.slice(1).every(value => value === 0)); assert.equal(processor.port.messages.at(-1).type, 'ended');
});

test('adapter prepares before a cheap anchored start and audio continues while main-thread messages stall', async () => {
  const h = basicKeyAudioHarness(), ended = [], receiver = await BasicKeyAudioReceiver.create(h.context, h.output, {nodeFactory: h.nodeFactory, onEnded: event => ended.push(event)});
  await receiver.prepare(plan([[0, 1000, 60, 80, 0], [1200, 1500, 64, 80, 0]]), {positionMs: .001});
  const started = await receiver.start({anchorTime: .05}); assert.equal(started.anchorFrame, 2400); assert.equal(started.positionMs, 0);
  for (let block = 0; block < 40; block++) h.renderBlock();
  assert.equal(h.nodes[0].core.startedCount, 2); assert.equal(h.nodes[0].core.endedCount, 2); assert.equal(ended.length, 0);
  h.deliverMain(); assert.equal(ended.length, 1); assert.equal(receiver.lastCompletion.ledger.actualStarts.length, 2);
  const audit = await receiver.audit(); assert.equal(audit.rows[1].actualStartFrame, 3600); receiver.dispose(); await Promise.resolve(); await Promise.resolve(); assert.equal(h.nodes[0].closed, true);
});

test('adapter canceled prepare and start promises reject; delayed successes never resume transport', async () => {
  const h = basicKeyAudioHarness({autoMessages: false}), started = [], receiver = await BasicKeyAudioReceiver.create(h.context, h.output, {nodeFactory: h.nodeFactory, onStarted: event => started.push(event)});
  const preparing = receiver.prepare(plan([[0, 500, 60, 80, 0]])); const rejection = assert.rejects(preparing, {code: 'audio_canceled'}); receiver.stop(); await rejection;
  h.deliverCore(); h.deliverMain(); assert.equal(receiver.state, 'canceled'); assert.equal(h.nodes[0].core.state, 'canceled'); assert.equal(receiver.prepareInFlight, null);
  const again = receiver.prepare(plan([[0, 500, 60, 80, 0]])); h.deliverCore(); h.deliverMain(); await again;
  const starting = receiver.start({anchorTime: .05}), startRejection = assert.rejects(starting, {code: 'audio_canceled'}); receiver.seek(100); await startRejection;
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
  const preparing = receiver.prepare(plan([[0, 10000, 60, 80, 0]])); h.deliverCore(); h.deliverMain(); await preparing;
  const starting = receiver.start({anchorTime: .05}), rejected = assert.rejects(starting, {code: 'clean_late_start'}); h.deliverCore();
  for (let index = 0; index < 20; index++) h.renderBlock();
  h.deliverMain(); await rejected; assert.equal(started.length, 0); assert.equal(receiver.connected, false); assert.equal(errors[0].code, 'clean_late_start');
  h.deliverCore(); h.deliverMain(); assert.equal(h.nodes[0].core.activeCount, 0); receiver.dispose(); h.deliverCore(); h.deliverMain();
});

test('disposing an active receiver immediately detaches and reports its actual cancellation ledger asynchronously', async () => {
  const h = basicKeyAudioHarness(), stopped = [], receiver = await BasicKeyAudioReceiver.create(h.context, h.output, {nodeFactory: h.nodeFactory, onStopped: value => stopped.push(value)});
  await receiver.prepare(plan([[0, 10000, 60, 80, 0], [5000, 6000, 64, 80, 0]])); await receiver.start({anchorTime: .001});
  h.renderBlock(); assert.equal(h.nodes[0].core.activeCount, 1); receiver.dispose(); assert.equal(receiver.connected, false); assert.equal(h.nodes[0].closed, false);
  await Promise.resolve(); await Promise.resolve(); assert.equal(h.nodes[0].closed, true); assert.equal(stopped.length, 1);
  assert.equal(stopped[0].planGeneration, 1); assert.equal(stopped[0].generation, 2); assert.deepEqual([...stopped[0].ledger.actualStarts], [48, -1]); assert.deepEqual([...stopped[0].ledger.actualEnds], [128, -1]);
});

test('invalid prepare silences the previous plan; bounded generations never wrap or restart it', () => {
  const messages = [], core = new BasicKeyAudioCore(sampleRate, {emit: value => messages.push(value)}), wire = encodeBasicKeyAudioPlan(plan([[0, 1000, 60, 80, 0]]));
  core.handleMessage({type: 'prepare', generation: 1, wire, positionFrame: 0}, 0); core.handleMessage({type: 'start', generation: 1, anchorFrame: 64}, 0); core.process([new Float32Array(128)], 0);
  core.handleMessage({type: 'prepare', generation: 2, wire: '{}', positionFrame: 0}, 128); assert.equal(core.activeCount, 0); assert.equal(core.state, 'error'); assert.equal(messages.at(-2).ledger.actualEnds[0], 128);
  core.handleMessage({type: 'start', generation: 1, anchorFrame: 200}, 128); assert.equal(messages.at(-1).type, 'stale');
  core.handleMessage({type: 'prepare', generation: BASIC_KEY_AUDIO_LIMITS.maxGeneration, wire, positionFrame: 0}, 128); assert.equal(core.state, 'ready');
  core.handleMessage({type: 'prepare', generation: BASIC_KEY_AUDIO_LIMITS.maxGeneration + 1, wire, positionFrame: 0}, 128); assert.equal(core.state, 'error'); assert.equal(messages.at(-1).code, 'invalid_audio_command');
});

test('the same percussion recipe is deterministic across selectors and block shapes', () => {
  function audio(key, blocks) {
    const core = new BasicKeyAudioCore(sampleRate), wire = encodeBasicKeyAudioPlan(plan([[0, 800, key, 80, 1]])), samples = [];
    core.handleMessage({type: 'prepare', generation: 1, wire, positionFrame: 0}, 0); core.handleMessage({type: 'start', generation: 1, anchorFrame: 128}, 0);
    let frame = 0;
    while (frame < 1024) { const length = Math.min(blocks, 1024 - frame), output = new Float32Array(length); core.process([output], frame); samples.push(...output); frame += length; }
    return samples;
  }
  assert.deepEqual(audio(0, 128), audio(127, 37));
});
