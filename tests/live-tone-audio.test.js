import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {LiveToneCore, LIVE_TONE_PROTOCOL, LIVE_TONE_LIMITS as L, buildLiveToneTriangles} from '../web/live-tone-core.js';
import {LiveToneReceiver} from '../web/live-tone-receiver.js';

const rate = 48000, triangles = buildLiveToneTriangles(rate);
function coreHarness() {
  const events = [], core = new LiveToneCore(rate, {emit: message => events.push(message)});
  let requestId = 0, token = 0, frame = 0, generation = 1;
  const command = (type, data = {}, at = frame) => { const message = {type, generation, requestId: ++requestId, ...data}; core.handleMessage(message, at); return message; };
  command('initialize', {triangles});
  const render = (length = 128, start = frame) => { const output = new Float32Array(length); core.process([output], start); frame = start + length; return output; };
  const play = (data = {}) => command('play', {id: 'key', midi: 69, duration: null, delay: 0, timbre: 'piano', velocity: 127, token: ++token, atFrame: frame, ...data});
  const click = (data = {}) => command('click', {id: 'click', accent: false, delay: 0, level: .25, token: ++token, atFrame: frame, ...data});
  return {core, events, command, play, click, render, get frame() { return frame; }, get token() { return token; }, set generation(value) { generation = value; }};
}
function adapterHarness({autoCommands = true, autoReplies = true, module = async () => {}} = {}) {
  const graph = [], events = [], errors = [], timers = new Map(), listeners = new Set(), toCore = [], toMain = [], nodes = [];
  let timerId = 0, frame = 0;
  const context = {state: 'running', sampleRate: rate, currentTime: 0, audioWorklet: {addModule: module},
    addEventListener(type, fn) { listeners.add(fn); }, removeEventListener(type, fn) { listeners.delete(fn); },
    createGain() { graph.push('createGain'); return {gain: {value: 0, cancelScheduledValues() {}, setValueAtTime(value) { this.value = value; }}, connect() { graph.push('gain.connect'); }, disconnect() { graph.push('gain.disconnect'); }}; },
  };
  const output = {};
  const drainCore = () => { while (toCore.length) { const {node, message} = toCore.shift(); node.core.handleMessage(message, frame); } };
  const drainMain = () => { while (toMain.length) { const {node, message} = toMain.shift(); node.port.onmessage?.({data: message}); } };
  function nodeFactory(_context, name, options) {
    assert.equal(name, LIVE_TONE_PROTOCOL); assert.equal(options.numberOfInputs, 0); graph.push('createNode');
    const node = {port: {postMessage(message) { toCore.push({node, message}); if (autoCommands) queueMicrotask(drainCore); }, start() {}, close() { node.closed = true; }}, connect() { graph.push('node.connect'); }, disconnect() { graph.push('node.disconnect'); }};
    node.core = new LiveToneCore(rate, {emit: message => { toMain.push({node, message}); if (autoReplies) queueMicrotask(drainMain); }}); nodes.push(node); return node;
  }
  const options = {nodeFactory, onEvent: event => events.push(event), onError: err => errors.push(err), setTimer(fn) { const id = ++timerId; timers.set(id, fn); return id; }, clearTimer(id) { timers.delete(id); }};
  const create = () => LiveToneReceiver.create(context, output, options);
  const render = (length = 128, start = frame) => { const result = new Float32Array(length); nodes[0].core.process([result], start); frame = start + length; context.currentTime = frame / rate; return result; };
  const state = value => { context.state = value; for (const listener of [...listeners]) listener(); };
  const flush = async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); };
  return {context, output, options, create, graph, events, errors, timers, listeners, nodes, toCore, toMain, drainCore, drainMain, render, state, flush};
}
const rms = samples => Math.sqrt(samples.reduce((sum, value) => sum + value * value, 0) / samples.length);

test('original sine note renders the MIDI pitch, velocity curve, attack and decay with real PCM receipts', () => {
  const h = coreHarness(); h.play(); const output = h.render(rate);
  assert.equal(h.core.state, 'ready'); assert.equal(h.events.filter(e => e.type === 'started').length, 1);
  assert.ok(Math.abs(output[96] - .28 * .25 * Math.sin(2 * Math.PI * 440 * .002)) < 1e-7);
  let crossings = 0; for (let i = 12001; i < rate; i++) if (output[i - 1] <= 0 && output[i] > 0) crossings++;
  assert.ok(Math.abs(crossings / .75 - 440) < 2, `Measured ${crossings / .75} Hz`);
  assert.ok(Math.abs(rms(output.slice(12000, 24000)) - .28 * .4 / Math.sqrt(2)) < 1e-4);
  const snapshot = h.core.snapshot(h.frame); assert.equal(snapshot.voices[0].actualStartFrame, 0); assert.equal(snapshot.voices[0].firstNonzeroFrame, 1); assert.ok(snapshot.voices[0].pcmPeak > .2); assert.ok(snapshot.voices[0].pcmEnergy > 1);
  const quiet = coreHarness(); quiet.play({velocity: 63.5}); const quieter = quiet.render(rate);
  assert.ok(Math.abs(rms(quieter.slice(12000)) / rms(output.slice(12000)) - .5 ** 1.5) < 1e-7);
});

test('bandlimited guitar is an independent original triangle, with no above-Nyquist table harmonics', () => {
  const key = 108, base = key * L.triangleSize;
  const amplitude = harmonic => { let sum = 0; for (let i = 0; i < L.triangleSize; i++) sum += triangles[base + i] * Math.sin(2 * Math.PI * harmonic * i / L.triangleSize); return 2 * sum / L.triangleSize; };
  assert.ok(Math.abs(amplitude(1) - 8 / Math.PI ** 2) < 1e-6); assert.ok(Math.abs(amplitude(3) + 8 / (9 * Math.PI ** 2)) < 1e-6); assert.ok(Math.abs(amplitude(7)) < 1e-7);
  const guitar = coreHarness(); guitar.play({timbre: 'guitar'}); const wave = guitar.render(rate / 2);
  const piano = coreHarness(); piano.play(); const sine = piano.render(rate / 2);
  assert.ok(rms(wave) > .05); assert.ok(wave.some((sample, i) => Math.abs(sample - sine[i]) > .01));
});

test('release preserves the actual attack automation and adds a genuine 12 ms tail', () => {
  const h = coreHarness(); const note = h.play(); h.render(96); h.command('release', {id: 'key', token: note.token}); const tail = h.render(700);
  const start = .28 * .25 * Math.sin(2 * Math.PI * 440 * .002);
  assert.ok(Math.abs(tail[0] - start) < 1e-7); assert.ok(tail.slice(1, 576).some(v => v !== 0)); assert.ok(tail.slice(576).every(v => v === 0));
  const end = h.events.find(e => e.type === 'ended'); assert.equal(end.actualStartFrame, 0); assert.equal(end.actualEndFrame, 672); assert.equal(end.reason, 'release'); assert.ok(end.nonzeroSamples > 500); assert.ok(end.pcmEnergy > 0);
});

test('future release/stop/panic and zero-velocity retriggers never create a canceled onset', () => {
  for (const method of ['release', 'stop', 'silence']) {
    const h = coreHarness(); const note = h.play({atFrame: 1000, delay: 1000 / 48});
    h.command(method, method === 'silence' ? {} : {id: 'key', token: note.token}); assert.ok(h.render(2000).every(v => v === 0)); assert.equal(h.core.started, 0); assert.equal(h.events.find(e => e.type === 'ended').actualStartFrame, null);
  }
  const h = coreHarness(); h.play({atFrame: 1000, delay: 1000 / 48}); h.play({velocity: 0}); assert.ok(h.render(2000).every(v => v === 0)); assert.equal(h.core.activeNotes, 0);
});

test('scheduled duration has a 20 ms minimum and a 150 ms target tail', () => {
  const h = coreHarness(); h.play({duration: 1}); const output = h.render(9000);
  const end = h.events.find(e => e.type === 'ended'); assert.equal(end.actualEndFrame, 8160); assert.ok(output.slice(960, 1600).some(v => v !== 0)); assert.ok(output.slice(8160).every(v => v === 0)); assert.ok(rms(output.slice(960, 1600)) > rms(output.slice(6000, 8000)) * 100);
});

test('same-key retrigger retains independent tokens and release targets only the current token', () => {
  const h = coreHarness(), first = h.play(); h.render(480); const second = h.play(); assert.equal(h.core.activeNotes, 2);
  h.command('release', {id: 'key', token: first.token}); h.render(640);
  assert.equal(h.core.activeNotes, 1); assert.equal(h.core.snapshot(h.frame).voices[0].token, second.token);
  const end = h.events.find(e => e.type === 'ended'); assert.equal(end.token, first.token); assert.equal(end.reason, 'retrigger');
  h.command('stop', {id: 'key', token: second.token}); assert.equal(h.core.activeNotes, 0);
});

test('64-voice budget includes release tails and deterministically steals the oldest tail before held voices', () => {
  const h = coreHarness(); for (let i = 0; i < 64; i++) h.play({id: `key-${i}`}); h.render(128);
  h.command('release', {id: 'key-20', token: 21}); h.command('release', {id: 'key-3', token: 4});
  h.play({id: 'new-a'}); h.play({id: 'new-b'}); h.play({id: 'new-c'});
  assert.equal(h.core.activeNotes, 64); assert.equal(h.core.droppedVoices, 3);
  assert.deepEqual(h.events.filter(e => e.reason === 'stolen').map(e => e.id), ['key-20', 'key-3', 'key-0']);
  h.command('silence'); assert.equal(h.core.activeNotes, 0); assert.ok(h.render(128).every(v => v === 0));
});

test('clicks have a separate eight-voice budget, actual 45 ms ends, and targeted silence', () => {
  const h = coreHarness(); h.play(); h.click(); const first = h.render(2300);
  assert.ok(rms(first) > 0); const end = h.events.find(e => e.kind === 'click' && e.type === 'ended'); assert.equal(end.actualEndFrame, 2160); assert.ok(end.pcmPeak > .04);
  for (let i = 0; i < 8; i++) h.click({id: `tick-${i}`, atFrame: h.frame + 1000, delay: 1000 / 48});
  assert.equal(h.core.activeClicks, 8); h.command('silenceClicks'); assert.equal(h.core.activeClicks, 0); assert.equal(h.core.activeNotes, 1);
  const overflow = coreHarness(); for (let i = 0; i < 9; i++) overflow.click({id: `tick-${i}`}); assert.equal(overflow.core.state, 'error'); assert.equal(overflow.core.activeClicks, 0); assert.equal(overflow.events.at(-1).code, 'live_audio_click_limit');
});

for (const nextFrame of [64, 0, 256]) test(`active render clock discontinuity ${nextFrame} cancels all voices without invented timestamps`, () => {
  const h = coreHarness(); h.play(); h.click({atFrame: 1000, delay: 1000 / 48}); h.render(128);
  assert.ok(h.render(128, nextFrame).every(v => v === 0)); assert.equal(h.core.state, 'error'); assert.equal(h.core.activeNotes + h.core.activeClicks, 0);
  assert.equal(h.events.at(-1).code, 'live_audio_render_discontinuity'); assert.equal(h.events.at(-1).frame, nextFrame); assert.ok(h.render().every(v => v === 0));
});

test('suspension fences old generations and explicit resume reuses slots without reviving old sounds', () => {
  const h = coreHarness(); h.play(); h.render(); h.generation = 2; h.command('suspend');
  assert.equal(h.core.state, 'suspended'); h.render(128, 10000); assert.equal(h.core.started, 1);
  h.core.handleMessage({type: 'play', generation: 1, requestId: 100, token: 3, id: 'old', midi: 60, duration: null, delay: 0, timbre: 'piano', velocity: 90, atFrame: 10000}, 10000);
  assert.equal(h.events.at(-1).type, 'stale'); h.command('resume'); assert.ok(h.render().every(v => v === 0)); h.play(); assert.ok(h.render().some(v => v !== 0));
});

test('command replay is ignored, malformed/unknown commands fail safely, and receipt memory stays bounded', () => {
  const h = coreHarness(), message = h.play(); h.core.handleMessage(message, 0); assert.equal(h.core.activeNotes, 1); assert.equal(h.events.at(-1).type, 'stale');
  for (let i = 0; i < 300; i++) { h.play({id: 'repeat'}); h.command('stop', {id: 'repeat', token: h.token}); }
  assert.equal(h.core.receipts.length, 256); assert.equal(h.core.snapshot(h.frame).receipts.length, 256); assert.equal(h.core.notes.length, 64); assert.equal(h.core.clicks.length, 8);
  for (const bad of [null, [], {type: 'evil', generation: 1, requestId: 2}, {type: 'silence', generation: 1, requestId: 2, score: {}}, {type: 'play', generation: 1, requestId: 2, id: 'x', midi: 128}]) {
    const broken = coreHarness(); broken.core.handleMessage(bad, 0); assert.equal(broken.core.state, 'error'); assert.ok(broken.render().every(v => v === 0));
  }
});

test('idle processing produces silence with no quantum messages or new voice allocations', () => {
  const h = coreHarness(), notes = [...h.core.notes], clicks = [...h.core.clicks];
  for (let i = 0; i < 100; i++) assert.ok(h.render().every(v => v === 0));
  assert.deepEqual(h.events.map(e => e.type), ['ready']); assert.deepEqual(h.core.notes, notes); assert.deepEqual(h.core.clicks, clicks);
});

test('the production processor forwards only the actual browser currentFrame and remains connected while idle', () => {
  const source = readFileSync(new URL('../web/live-tone-audio-processor.js', import.meta.url), 'utf8').replace(/^import .*;\n/, '').replace('export class ', 'class ');
  let Registered; const emitted = [];
  const scope = {LiveToneCore, LIVE_TONE_PROTOCOL, sampleRate: rate, currentFrame: 321, AudioWorkletProcessor: class { constructor() { this.port = {postMessage: message => emitted.push(message)}; } }, registerProcessor(name, processor) { assert.equal(name, LIVE_TONE_PROTOCOL); Registered = processor; }};
  vm.runInNewContext(source, scope); const processor = new Registered();
  processor.port.onmessage({data: {type: 'initialize', generation: 1, requestId: 1, triangles}}); assert.equal(emitted[0].frame, 321);
  processor.port.onmessage({data: {type: 'play', generation: 1, requestId: 2, token: 1, id: 'manual', midi: 69, duration: null, delay: 0, timbre: 'piano', velocity: 90, atFrame: 321}});
  const output = new Float32Array(128); assert.equal(processor.process([], [[output]]), true); assert.equal(emitted.find(e => e.type === 'started').actualStartFrame, 321); assert.ok(output.some(v => v !== 0));
});

test('adapter create waits for ready, normal operations make no graph edits, and snapshot observes actual output', async () => {
  const h = adapterHarness(), receiver = await h.create(); assert.equal(receiver.state, 'ready'); assert.equal(receiver.outputGate.gain.value, 1); assert.equal(receiver.pending.size, 0);
  const graph = [...h.graph]; const token = receiver.play('manual:key', 69); await h.flush(); h.render(); await h.flush();
  const snapshot = await receiver.snapshot(); assert.equal(snapshot.activeNotes, 1); assert.equal(snapshot.voices[0].token, token); assert.ok(snapshot.voices[0].pcmEnergy > 0);
  receiver.release('manual:key'); receiver.click('tick'); await h.flush(); h.render(700); await h.flush();
  receiver.stop('manual:key'); receiver.silenceClicks(); receiver.silence(); await h.flush(); assert.deepEqual(h.graph, graph); assert.equal(receiver.pending.size, 0); assert.equal(h.timers.size, 0);
  assert.ok(h.events.some(e => e.type === 'ended' && e.kind === 'note' && e.nonzeroSamples > 0));
  receiver.dispose(); assert.equal(receiver.state, 'disposed'); assert.equal(h.graph.filter(e => e === 'node.disconnect').length, 1); assert.equal(h.listeners.size, 0);
});

test('adapter explicit resume reuses graph, automatic running stays silent, and stale callbacks cannot end newer voices', async () => {
  const h = adapterHarness(), receiver = await h.create(), graph = [...h.graph]; const old = receiver.play('key', 69); await h.flush(); h.render(); await h.flush();
  const oldEvent = h.events[0], generation = receiver.generation; h.state('suspended'); await h.flush(); assert.equal(receiver.state, 'interrupted'); assert.equal(receiver.outputGate.gain.value, 0); assert.equal(h.nodes[0].core.activeNotes, 0);
  h.state('running'); h.render(); await h.flush(); assert.equal(receiver.state, 'interrupted'); assert.throws(() => receiver.play('key', 69), {code: 'live_audio_unavailable'});
  await receiver.resume(); assert.equal(receiver.state, 'ready'); assert.ok(receiver.generation > generation); assert.deepEqual(h.graph, graph);
  const fresh = receiver.play('key', 69); await h.flush(); receiver.receive({...oldEvent, type: 'ended', token: old}); assert.equal(receiver.notes.get('key'), fresh); h.render(); await h.flush(); assert.ok(h.events.some(e => e.token === fresh)); receiver.dispose();
});

test('bounded pending commands fail closed and reject an unanswered snapshot without unbounded bookkeeping', async () => {
  const h = adapterHarness(), receiver = await h.create(); h.nodes[0].port.postMessage = message => h.toCore.push({node: h.nodes[0], message});
  const snapshot = receiver.snapshot(); for (let i = 1; i < L.maxPending; i++) receiver.play(`key-${i}`, 60);
  assert.equal(receiver.pending.size, L.maxPending); assert.ok(receiver.notes.size <= 64);
  assert.throws(() => receiver.play('overflow', 60), {code: 'live_audio_command_limit'}); await assert.rejects(snapshot, {code: 'live_audio_command_limit'}); assert.equal(receiver.pending.size, 0); assert.equal(receiver.outputGate.gain.value, 0); assert.equal(receiver.state, 'error'); assert.equal(h.timers.size, 0); receiver.dispose();
});

test('invalid arguments do not post commands or change sound, zero velocity is silent, and click bookkeeping stays bounded', async () => {
  const h = adapterHarness(), receiver = await h.create();
  for (const args of [['', 60], ['x', -1], ['x', 128], ['x', 60, NaN], ['x', 60, null, Infinity], ['x', 60, null, -1], ['x', 60, null, 0, 'bogus'], ['x', 60, null, 0, 'piano', NaN], ['x'.repeat(257), 60]]) assert.throws(() => receiver.play(...args));
  assert.equal(receiver.pending.size, 0); assert.equal(receiver.play('zero', 69, null, 0, 'piano', 0), null); await h.flush(); assert.ok(h.render().every(v => v === 0));
  for (let i = 0; i < 8; i++) receiver.click(`c${i}`, false, 1000); assert.throws(() => receiver.click('overflow'), {code: 'live_audio_click_limit'}); await h.flush(); assert.equal(receiver.clicks.size, 8); receiver.dispose();
});

test('startup refusal, ready timeout, error causality and disposal reject late replies without fallback', async () => {
  await assert.rejects(LiveToneReceiver.create({state: 'running', sampleRate: rate}, {}), {code: 'live_audio_worklet_unavailable'});
  const h = adapterHarness({autoReplies: false}), created = h.create(); await h.flush(); await h.flush(); await h.flush();
  assert.equal(h.nodes.length, 1); assert.equal(h.nodes[0].core.state, 'ready'); let finished = false; created.then(() => { finished = true; }, () => {}); await h.flush(); assert.equal(finished, false);
  const timer = [...h.timers.values()][0]; timer(); await assert.rejects(created, {code: 'live_audio_command_timeout'}); assert.equal(h.nodes[0].closed, true); h.drainMain(); assert.equal(finished, false);
  const good = adapterHarness(), receiver = await good.create(); const snapshot = receiver.snapshot(); receiver.dispose(); await assert.rejects(snapshot, {code: 'live_audio_disposed'}); await good.flush(); assert.equal(receiver.state, 'disposed');
});

test('adapter duplicate lifecycle receipts cannot double-report or retire a retriggered token', async () => {
  const h = adapterHarness(), receiver = await h.create(); receiver.play('key', 69); await h.flush(); h.render(); await h.flush();
  const first = h.events[0]; receiver.receive(first); assert.equal(h.events.length, 1);
  const fresh = receiver.play('key', 70); await h.flush(); h.render(700); await h.flush();
  const end = h.events.find(e => e.type === 'ended' && e.token === first.token); assert.ok(end); const count = h.events.length;
  receiver.receive(end); receiver.receive(first); assert.equal(h.events.length, count); assert.equal(receiver.notes.get('key'), fresh); assert.ok(receiver.lifecycle.size <= L.maxReceipts); receiver.dispose();
});

test('adapter rejects mismatched acknowledgements and malformed PCM receipts with the original request cause', async () => {
  const h = adapterHarness(), receiver = await h.create(); receiver.play('key', 69); await h.flush(); h.render(); await h.flush();
  receiver.receive({...h.events[0], pcmPeak: Infinity}); assert.equal(receiver.state, 'error'); assert.equal(h.errors.at(-1).code, 'live_audio_protocol_error'); assert.equal(receiver.outputGate.gain.value, 0); receiver.dispose();
  const other = adapterHarness(), next = await other.create(); other.nodes[0].port.postMessage = () => {};
  const waiting = next.snapshot(); const [requestId] = next.pending.keys();
  next.receive({type: 'ack', source: 'live-tone', command: 'play', generation: next.generation, requestId, frame: 0});
  await assert.rejects(waiting, {code: 'live_audio_protocol_error'}); assert.equal(next.pending.size, 0); next.dispose();
});

test('bounded host metadata eviction cannot strand a still-held DSP voice while ended replies are delayed', async () => {
  const h = adapterHarness(), receiver = await h.create(); receiver.play('held', 69); await h.flush(); h.render(); await h.flush();
  // Pause delivery to the host while transient voices naturally retire. The
  // DSP still owns the long-held first key; the host reaches its 64-ID bound.
  const receive = h.nodes[0].port.onmessage; h.nodes[0].port.onmessage = () => {};
  for (let i = 0; i < 64; i++) { receiver.play(`short-${i}`, 60, 20); await h.flush(); h.render(9000); await h.flush(); }
  assert.equal(receiver.notes.has('held'), false); assert.ok(h.nodes[0].core.snapshot(0).voices.some(v => v.id === 'held'));
  receiver.release('held'); await h.flush(); h.render(700); await h.flush(); assert.equal(h.nodes[0].core.activeNotes, 0);
  h.nodes[0].port.onmessage = receive; receiver.dispose();
});

test('fractional underflow and positive subnormal note/click levels stay finite through decay and all tails', () => {
  for (const value of [Number.MIN_VALUE, 1e-320, 1e-210, 1e-200]) {
    for (const scheduled of [false, true]) {
      const h = coreHarness(); const note = h.play({velocity: value, duration: scheduled ? 20 : null});
      const output = h.render(12000); assert.ok(output.every(Number.isFinite), `finite note PCM at velocity ${value}`);
      if (.28 * (value / 127) ** 1.5 === 0) assert.ok(output.every(v => v === 0), 'a computed zero peak stays silent even during the scheduled target tail');
      if (!scheduled) { h.command('release', {id: 'key', token: note.token}); assert.ok(h.render(700).every(Number.isFinite)); }
      const ended = h.events.find(e => e.type === 'ended'); assert.ok(Number.isFinite(ended.pcmPeak)); assert.ok(Number.isFinite(ended.pcmEnergy));
    }
    const click = coreHarness(); click.click({level: value}); const output = click.render(2400);
    assert.ok(output.every(Number.isFinite), `finite click PCM at level ${value}`);
    if (value * .22 === 0) assert.ok(output.every(v => v === 0));
    const ended = click.events.find(e => e.type === 'ended'); assert.ok(Number.isFinite(ended.pcmPeak)); assert.ok(Number.isFinite(ended.pcmEnergy));
  }
});
