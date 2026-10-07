import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, webcrypto } from 'node:crypto';
import {
  CleanPerformanceError, loadCleanPerformance, createCleanPerformancePlayer, performanceSeconds,
} from '../web/clean-performance-player.js';
import { REFERENCE_RECEIVER_POLICY } from '../web/midi-reference-player.js';
import { PROGRAM_FAMILIES, REFERENCE_PERCUSSION, ReferenceAudioReceiver } from '../web/midi-reference-synth.js';
import { ReferencePitchChannels, COMPLETE_PITCH_POLICY } from '../web/clean-performance-pitch.js';

const sha256 = value => createHash('sha256').update(value).digest('hex');
const exact = (numerator, denominator = 1) => ({ numerator: String(numerator), denominator });
const row = (micros, kind, values = {}) => ({ time: typeof micros === 'object' ? micros : exact(micros), command: { kind, ...values } });
const on = (micros, key = 60, velocity = 90, channel = 0) => row(micros, 'key_attack', { channel, key, velocity });
const off = (micros, key = 60, velocity = 27, channel = 0) => row(micros, 'key_release', { channel, key, velocity });
const program = (micros, value, channel = 0) => row(micros, 'instrument_program', { channel, program: value });
const compare = (a, b) => {
  const left = BigInt(a.numerator) * BigInt(b.denominator), right = BigInt(b.numerator) * BigInt(a.denominator);
  return left < right ? -1 : left > right ? 1 : 0;
};

// Authored transport fixtures, not a JS compiler or imported music. Source commands
// stay independent in both clean JSON and the mocked Rust response. The callback
// checks the exact clean bytes; separate Rust tests own compilation correctness.
function fixture(inputTracks) {
  const sourceHash = sha256('WMH original synthetic complete-performance receiver fixture v1');
  const events = [], tracks = [], parts = [];
  inputTracks.forEach((input, track) => {
    const rows = structuredClone(input);
    if (rows.at(-1)?.command.kind !== 'track_end') rows.push(row(rows.at(-1)?.time ?? exact(0), 'track_end'));
    const channels = new Set();
    rows.forEach(({ time, command }, event) => {
      if (command.channel !== undefined) channels.add(command.channel);
      if (['key_attack', 'key_release'].includes(command.kind)) command.part_id = `midi-t${track + 1}-c${command.channel + 1}`;
      events.push({ event_id: `midi:${sourceHash}:t${track}:e${event}`, exact_microseconds: time, origin: { track, event }, command });
    });
    const end = rows.at(-1).time;
    tracks.push({ id: `track-${track + 1}`, name: `Authored track ${track + 1}`, source_index: track,
      source_event_count: rows.length, end: { numerator: Number(end.numerator), denominator: end.denominator * 500000 } });
    for (const channel of channels) parts.push({ id: `midi-t${track + 1}-c${channel + 1}`, track_id: `track-${track + 1}`,
      channel, sound_identity: 'unspecified_midi_route' });
  });
  events.sort((a, b) => compare(a.exact_microseconds, b.exact_microseconds) || a.origin.track - b.origin.track || a.origin.event - b.origin.event);
  const unavailable = { status: 'unavailable', represented_attacks: 0, reason: 'not_derived_from_independent_events' };
  const coverage = { performance: { status: 'complete', source_tracks: tracks.length, source_events: events.length,
    represented_events: events.length, key_attacks: events.filter(e => e.command.kind === 'key_attack').length,
    key_releases: events.filter(e => e.command.kind === 'key_release').length }, notation: unavailable, targets: unavailable };
  const end = events.at(-1).exact_microseconds;
  const score = { format: 'worldmusichub-complete-score', version: 2, id: 'authored-receiver-fixture', title: 'Authored receiver fixture',
    source: { format: 'midi', sha256: sourceHash, bytes: 1 }, notation: null,
    performance: { profile: 'wmh-performance-midi1-v1', end: { numerator: Number(end.numerator), denominator: end.denominator * 500000 },
      tracks, parts, events: events.map(({ exact_microseconds: at, ...event }) => ({ ...event,
        at: { numerator: Number(at.numerator), denominator: at.denominator * 500000 } })) }, coverage };
  const scoreBytes = new TextEncoder().encode(JSON.stringify(score)), expectedScoreSha256 = sha256(scoreBytes);
  const runtime = { profile: score.performance.profile, score_id: score.id, score_sha256: expectedScoreSha256,
    source_sha256: sourceHash, tracks, parts, events, coverage, duration_microseconds: end };
  const calls = [];
  const compile = async bytes => { assert.deepEqual(bytes, scoreBytes); calls.push(bytes); return runtime; };
  return { scoreBytes, expectedScoreSha256, compile, crypto: webcrypto, score, runtime, calls };
}
const load = input => loadCleanPerformance(input);
const deviceName = (text = 'Authored receiver', micros = 0) => row(micros, 'text', { role: 'device_name', text });
const near = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-10, `${actual} != ${expected}`);

class Param {
  constructor() { this.calls = []; this.value = 0; }
  setValueAtTime(...args) { this.calls.push(['set', ...args]); }
  linearRampToValueAtTime(...args) { this.calls.push(['ramp', ...args]); }
}
class AudioNode {
  constructor(context, nodeType) {
    Object.assign(this, { context, nodeType, gain: new Param(), pan: new Param(), frequency: new Param(), Q: new Param(), connections: [], starts: [], stops: [], disconnected: false });
  }
  connect(node) { assert.equal(node.context, this.context); this.connections.push(node); return node; }
  disconnect() { this.disconnected = true; }
  start(at) { assert.ok(Number.isFinite(at)); this.starts.push(at); }
  stop(at) { assert.ok(Number.isFinite(at)); this.stops.push(at); }
}
class AudioContext {
  constructor() { Object.assign(this, { currentTime: 0, state: 'suspended', sampleRate: 48000, nodes: [], buffers: [], resumeCount: 0 }); }
  make(type) { const node = new AudioNode(this, type); this.nodes.push(node); return node; }
  createGain() { return this.make('gain'); }
  createOscillator() { return this.make('oscillator'); }
  createStereoPanner() { return this.make('panner'); }
  createConvolver() { return this.make('convolver'); }
  createBufferSource() { return this.make('noise'); }
  createBiquadFilter() { return this.make('filter'); }
  createBuffer(channels, length, sampleRate) {
    const data = Array.from({ length: channels }, () => new Float32Array(length));
    const buffer = { channels, length, sampleRate, getChannelData: channel => data[channel] };
    this.buffers.push(buffer); return buffer;
  }
  async resume() { this.resumeCount++; this.state = 'running'; }
}
class Timers {
  constructor() { this.pending = new Map(); this.all = []; this.next = 0; }
  setTimeout = (callback, delay) => { const id = ++this.next; this.pending.set(id, callback); this.all.push({ callback, delay }); return id; };
  clearTimeout = id => { this.pending.delete(id); };
  fire() { const callbacks = [...this.pending.values()]; this.pending.clear(); callbacks.forEach(callback => callback()); }
}
function harness(prepared, options = {}) {
  const context = new AudioContext(), output = context.createGain(), timers = new Timers(), acknowledgements = [], states = [];
  let factoryCalls = 0;
  const player = createCleanPerformancePlayer(prepared, { contextFactory: () => { factoryCalls++; return { context, output }; },
    timers, onEvent: event => acknowledgements.push(event), onState: state => states.push(state), ...options });
  const play = () => player.play({ userGesture: true, acceptedPolicyId: prepared.policy.id });
  const advance = to => {
    assert.ok(to >= context.currentTime);
    while (context.currentTime + 0.02 < to) { context.currentTime += 0.02; timers.fire(); }
    context.currentTime = to; timers.fire();
  };
  const sources = () => context.nodes.filter(n => ['oscillator', 'noise'].includes(n.nodeType));
  const envelopes = () => context.nodes.filter(n => n.nodeType === 'gain' && n.connections.includes(output));
  const silent = () => {
    assert.ok(context.nodes.slice(1).every(n => n.disconnected), 'every allocated receiver node disconnected');
    assert.ok(sources().every(n => n.onended == null), 'every source callback detached');
    assert.equal(timers.pending.size, 0);
  };
  return { context, output, timers, acknowledgements, states, player, play, advance, sources, envelopes, silent, factoryCalls: () => factoryCalls };
}
const accepted = { userGesture: true, acceptedPolicyId: REFERENCE_RECEIVER_POLICY.id };

test('the trusted adapter receives copied, hash-bound complete clean bytes and produces an immutable opaque handle', async () => {
  const f = fixture([[on(0), off(500000)]]), prepared = await load(f);
  assert.equal(f.calls.length, 1); assert.notEqual(f.calls[0], f.scoreBytes);
  assert.equal(prepared.scoreSha256, sha256(f.scoreBytes)); assert.equal(prepared.sourceSha256, f.runtime.source_sha256);
  assert.ok(Object.isFrozen(prepared.runtime.events[0].command));
  f.runtime.events[0].command.key = 99;
  assert.equal(prepared.runtime.events[0].command.key, 60);
  assert.throws(() => createCleanPerformancePlayer(structuredClone(prepared)), { code: 'trusted_compiler_required' });
  const bytesAsBuffer = fixture([[on(0), off(500000)]]);
  await load({ ...bytesAsBuffer, scoreBytes: bytesAsBuffer.scoreBytes.buffer });
  assert.notEqual(bytesAsBuffer.calls[0].buffer, bytesAsBuffer.scoreBytes.buffer);
});

test('untrusted bytes, hash mismatch and absent compilation fail before invoking the adapter', async () => {
  for (const scoreBytes of [undefined, {}, 'raw JSON', new Uint8Array(), new Uint8Array(16 * 1024 * 1024 + 1)]) {
    const f = fixture([[on(0), off(500000)]]);
    await assert.rejects(load({ ...f, scoreBytes }), CleanPerformanceError); assert.equal(f.calls.length, 0);
  }
  const f = fixture([[on(0), off(500000)]]);
  await assert.rejects(load({ ...f, expectedScoreSha256: '0'.repeat(64) }), { code: 'score_hash_mismatch' });
  await assert.rejects(load({ ...f, compile: undefined }), { code: 'trusted_compiler_required' });
  await assert.rejects(load({ ...f, crypto: {} }), { code: 'trusted_compiler_required' });
  assert.equal(f.calls.length, 0);
});

test('independent canonical commands stay unchanged; FIFO gates, unmatched releases and cleanup exist only in the receiver', async () => {
  const f = fixture([[row(0, 'text', { role: 'track_name', text: 'Authored' }), program(0, 24), on(0, 60, 91), on(100000, 60, 72),
    program(150000, 80), off(200000, 60, 33), off(250000, 60, 0), off(300000, 60, 55), on(350000, 62, 88), row(500000, 'track_end')]]);
  const originalScore = JSON.parse(new TextDecoder().decode(f.scoreBytes)), originalRuntime = structuredClone(f.runtime);
  const p = await load(f);
  assert.equal(p.eventCount, 10); assert.equal(p.voices.length, 3);
  assert.deepEqual(p.voices.map(v => [v.program, v.velocity, v.releaseVelocity, v.endReason]), [
    [24, 91, 33, 'key_release'], [24, 72, 0, 'key_release'], [80, 88, null, 'source_end_cleanup'],
  ]);
  assert.equal(p.acknowledgements[3].disposition, 'layered_onset');
  assert.equal(p.acknowledgements[7].disposition, 'unmatched_release');
  assert.equal(p.voices[0].releaseEventId, p.runtime.events[5].event_id);
  assert.equal(p.voices[1].releaseEventId, p.runtime.events[6].event_id);
  assert.deepEqual(p.voices.map(v => [v.start.numerator, v.end.numerator]), [['0', '200000'], ['100000', '250000'], ['350000', '500000']]);
  for (const event of p.runtime.events) {
    assert.ok(!('duration' in event.command) && !('end' in event.command) && !('release_event_id' in event.command));
  }
  const h = harness(p); await h.play(); h.advance(0.6);
  assert.equal(h.player.snapshot().state, 'ended');
  assert.deepEqual(h.acknowledgements.map(a => a.eventId), p.runtime.events.map(e => e.event_id));
  assert.equal(h.sources().length, 6); assert.equal(h.envelopes().length, 3);
  for (const [index, voice] of p.voices.entries()) {
    for (const source of h.sources().slice(index * 2, index * 2 + 2)) {
      near(source.starts[0], 0.05 + performanceSeconds(voice.start)); near(source.stops[0], 0.05 + performanceSeconds(voice.end));
    }
  }
  h.silent(); assert.deepEqual(p.runtime, originalRuntime); assert.deepEqual(f.score, originalScore);
});

test('exact clocks retain rational values and deterministic cross-track order through the audio boundary', async () => {
  const numerator = 9007199254740993n, denominator = 32767000000n;
  assert.equal(performanceSeconds(exact(numerator, 32767)), Number(numerator / denominator) + Number(numerator % denominator) / Number(denominator));
  const f = fixture([[on(exact(500001, 3)), off(exact(1600009, 3))], [on(exact(500001, 3), 65, 90, 1), off(exact(1600009, 3), 65, 2, 1)]]);
  const p = await load(f), h = harness(p); await h.play(); h.advance(0.61);
  assert.deepEqual(h.acknowledgements.map(a => a.eventId), p.runtime.events.map(e => e.event_id));
  assert.deepEqual(h.acknowledgements.map(a => a.exactMicroseconds), p.runtime.events.map(e => e.exact_microseconds));
  assert.deepEqual(p.voices[0].start, exact(500001, 3)); assert.deepEqual(p.voices[0].end, exact(1600009, 3));
  assert.equal(h.sources().length, 4);
  h.sources().forEach(s => { near(s.starts[0], 0.05 + 500001 / 3000000); near(s.stops[0], 0.05 + 1600009 / 3000000); });
  h.silent();
});

function elevenTracks() {
  const tracks = Array.from({ length: 11 }, (_, channel) => [program(0, channel === 9 ? 118 : channel * 8, channel),
    on(0, 48 + channel, 90, channel), off(500000, 48 + channel, 19, channel)]);
  tracks[9] = [program(0, 118, 9), on(0, 85, 90, 9), off(150000, 85, 2, 9), on(150000, 86, 80, 9),
    off(300000, 86, 3, 9), on(300000, 87, 70, 9), off(500000, 87, 4, 9)];
  return tracks;
}

test('eleven tracks allocate every declared family and explicit percussion 85/86/87 recipes', async () => {
  const p = await load(fixture(elevenTracks())), h = harness(p);
  assert.equal(p.trackCount, 11); assert.ok(p.tracks.every(t => t.independent)); assert.equal(p.playable, true);
  assert.deepEqual(p.voices.filter(v => v.channel === 9).map(v => [v.key, v.program]), [[85, 118], [86, 118], [87, 118]]);
  assert.match(p.programs.find(p => p.channel === 9).reference, /kit unknown/);
  assert.deepEqual([85, 86, 87].map(key => REFERENCE_PERCUSSION[key]), [
    { name: 'Reference WMH low wood pulse', type: 'tone', frequency: 370 },
    { name: 'Reference WMH dry rim noise', type: 'noise', frequency: 1700 },
    { name: 'Reference WMH bright metal pulse', type: 'metal', frequency: 3900 },
  ]);
  await h.play(); h.advance(0.6);
  assert.equal(h.envelopes().length, 13); assert.equal(h.sources().length, 25);
  const startAt = time => h.sources().filter(s => Math.abs(s.starts[0] - time) < 1e-10);
  const dry = startAt(0.2), metal = startAt(0.35);
  assert.equal(dry.length, 1); assert.equal(dry[0].nodeType, 'noise'); assert.equal(dry[0].loop, true);
  assert.equal(dry[0].connections[0].nodeType, 'filter'); assert.deepEqual(dry[0].connections[0].frequency.calls[0], ['set', 1700, 0.2]);
  assert.deepEqual(metal.map(s => s.nodeType), ['oscillator', 'oscillator', 'noise']);
  assert.deepEqual(metal.slice(0, 2).map(s => s.type), ['square', 'sine']);
  near(metal[0].frequency.calls[0][1], 3900); near(metal[1].frequency.calls[0][1], 3900 * 1.43);
  const lowWood = startAt(0.05).find(s => s.frequency.calls[0]?.[1] === 370);
  assert.ok(lowWood); assert.equal(lowWood.type, 'sine');
  assert.equal(h.context.buffers.length, 1); assert.equal(dry[0].buffer, metal[2].buffer);
  assert.ok(h.context.buffers[0].getChannelData(0).some(value => value !== 0));
  assert.equal(h.acknowledgements.length, p.eventCount); h.silent();
});

test('each of all eleven track mutes suppresses its actual allocation while retaining every original event', async t => {
  const p = await load(fixture(elevenTracks()));
  for (let track = 0; track < 11; track++) await t.test(`mute track ${track + 1}`, async () => {
    const h = harness(p); assert.deepEqual(h.player.setTrackMuted(track, true).mutedTracks, [track]);
    await h.play(); assert.throws(() => h.player.setTrackMuted(track, false), { code: 'stop_required' }); h.advance(0.6);
    assert.equal(h.player.snapshot().state, 'ended'); assert.equal(h.envelopes().length, track === 9 ? 10 : 12);
    assert.equal(h.sources().length, track === 9 ? 20 : 23);
    assert.deepEqual(h.acknowledgements.map(a => a.eventId), p.runtime.events.map(e => e.event_id));
    assert.deepEqual(h.acknowledgements.filter(a => a.muted).map(a => a.eventId), p.runtime.events.filter(e => e.origin.track === track).map(e => e.event_id));
    if (track === 9) assert.equal(h.context.buffers.length, 0);
    else {
      const hz = 440 * 2 ** (((48 + track) - 69) / 12);
      assert.ok(!h.sources().some(s => s.frequency.calls[0]?.[1] === hz), 'muted track fundamental absent');
    }
    h.silent(); h.player.stop(); assert.deepEqual(h.player.setTrackMuted(track, false).mutedTracks, []);
  });
});

test('muting all tracks creates no voice nodes; shared routes and invalid mute/seek requests reject explicitly', async () => {
  const p = await load(fixture(elevenTracks())), h = harness(p);
  for (let track = 0; track < 11; track++) h.player.setTrackMuted(track, true);
  await h.play(); h.advance(0.6); assert.equal(h.context.nodes.length, 1); assert.equal(h.acknowledgements.length, p.eventCount);
  assert.ok(h.acknowledgements.every(e => e.muted)); h.silent(); h.player.stop();
  for (const [track, muted] of [[-1, true], [11, true], [0.5, true], [0, 1]]) assert.throws(() => h.player.setTrackMuted(track, muted), { code: 'invalid_track' });
  assert.throws(() => h.player.seek(0.2), { code: 'seek_unsupported' });
  const shared = await load(fixture([[on(0), off(200000)], [on(100000, 65), off(300000, 65)]]));
  assert.ok(shared.tracks.every(track => !track.independent));
  const player = harness(shared).player;
  assert.throws(() => player.setTrackMuted(0, true), { code: 'shared_channel_mute_unsupported' });
  assert.throws(() => player.setTrackMuted(1, true), { code: 'shared_channel_mute_unsupported' });
});

test('gesture and reference policy gate allocation, program changes affect only new voices, and envelopes fit receiver gates', async () => {
  const p = await load(fixture([[program(0, 0), on(0, 60, 127), program(50000, 80), on(50000, 62, 64), off(500000), off(500000, 62)]]));
  const h = harness(p); assert.equal(h.factoryCalls(), 0);
  await assert.rejects(h.player.play(), { code: 'user_gesture_required' });
  await assert.rejects(h.player.play({ userGesture: true }), { code: 'reference_policy_required' });
  await assert.rejects(h.player.play({ userGesture: true, acceptedPolicyId: 'unknown' }), { code: 'reference_policy_required' });
  assert.equal(h.factoryCalls(), 0); await h.play(); assert.equal(h.context.resumeCount, 1);
  assert.equal(h.factoryCalls(), 1); await h.play(); assert.equal(h.factoryCalls(), 1);
  assert.deepEqual(h.sources().map(s => s.type), ['triangle', 'sine', 'sawtooth', 'square']);
  assert.equal(PROGRAM_FAMILIES.length, 16);
  h.envelopes().forEach((envelope, index) => {
    const gateStart = 0.05 + index * 0.05;
    assert.deepEqual(envelope.gain.calls[0], ['set', 0, gateStart]);
    assert.equal(envelope.gain.calls[1][1], 0.08 * (index ? 64 : 127) / 127);
    assert.deepEqual(envelope.gain.calls.at(-1), ['ramp', 0, 0.55]);
    assert.ok(envelope.gain.calls.every(([, , time]) => time >= gateStart && time <= 0.55));
  });
  assert.equal(h.player.snapshot().positionSeconds, 0); assert.equal(h.player.snapshot().audioAnchorSeconds, 0.05);
  assert.equal(h.acknowledgements[0].scheduledAudioTime, 0.05);
  h.advance(0.08); near(h.player.snapshot().positionSeconds, 0.03); h.player.stop(); h.silent();
});

test('pause cancels active and future sources; resume reconstructs held gates with one anchor and replays only future events', async () => {
  const p = await load(fixture([[on(0), on(110000, 62), off(500000), off(550000, 62)]])), h = harness(p);
  await h.play(); h.advance(0.12); assert.equal(h.sources().length, 4);
  const oldSources = [...h.sources()], oldCallbacks = h.timers.all.map(t => t.callback), pause = h.player.pause();
  near(pause.positionSeconds, 0.07); assert.equal(pause.state, 'paused'); h.silent();
  assert.ok(oldSources.every(s => s.stops.at(-1) === 0.12));
  h.context.currentTime = 0.8; oldCallbacks.forEach(callback => callback()); assert.equal(h.sources().length, 4);
  await assert.rejects(h.player.play({ acceptedPolicyId: p.policy.id }), { code: 'user_gesture_required' });
  const acknowledgementsBefore = h.acknowledgements.length; await h.play();
  const fresh = h.sources().slice(4); assert.equal(fresh.length, 4);
  near(fresh[0].starts[0], 0.85); near(fresh[0].stops[0], 1.28); near(fresh[2].starts[0], 0.89);
  assert.deepEqual(h.acknowledgements.slice(acknowledgementsBefore).map(e => e.eventId), [p.runtime.events[1].event_id]);
  h.advance(1.35); assert.equal(h.player.snapshot().state, 'ended'); h.silent();
  await h.play(); near(h.sources().at(-1).starts[0], 1.4); h.player.stop(); h.silent();
});

test('resumed held voices use the same scheduled instant even while allocations advance the context clock', async () => {
  const h = harness(await load(fixture([[on(0), on(0, 62), off(500000), off(500000, 62)]])));
  await h.play(); h.advance(0.15); h.player.pause(); h.context.currentTime = 1;
  const oldCount = h.sources().length, createGain = h.context.createGain.bind(h.context);
  h.context.createGain = () => { h.context.currentTime += 0.002; return createGain(); };
  await h.play(); const fresh = h.sources().slice(oldCount); assert.equal(fresh.length, 4);
  fresh.forEach(source => { near(source.starts[0], 1.05); near(source.stops[0], 1.45); });
  h.player.stop(); h.silent();
});

test('track end does not terminate a shared-channel held gate or reset its program', async () => {
  const p = await load(fixture([
    [program(0, 80), on(0), row(100000, 'track_end')],
    [off(200000), on(300000, 65), row(500000, 'track_end')],
  ])), h = harness(p);
  assert.deepEqual(p.voices.map(v => [v.program, v.end.numerator, v.endReason]), [
    [80, '200000', 'key_release'], [80, '500000', 'source_end_cleanup'],
  ]);
  assert.equal(p.voices[0].releaseEventId, p.runtime.events.find(e => e.command.kind === 'key_release').event_id);
  await h.play(); h.advance(0.6);
  assert.deepEqual(h.sources().map(s => s.type), ['sawtooth', 'square', 'sawtooth', 'square']);
  near(h.sources()[0].stops[0], 0.25); near(h.sources()[2].stops[0], 0.55);
  assert.deepEqual(h.acknowledgements.map(a => a.eventId), p.runtime.events.map(e => e.event_id)); h.silent();
});

test('stop resets position, invalidates timers, and allows a new generation from zero', async () => {
  const h = harness(await load(fixture([[on(0), off(500000)]]))); await h.play();
  const oldGeneration = h.player.snapshot().generation, stale = h.timers.all[0].callback;
  h.player.stop(); h.silent(); h.context.currentTime = 8; stale();
  assert.equal(h.player.snapshot().state, 'stopped'); assert.equal(h.player.snapshot().positionSeconds, 0);
  assert.equal(h.sources().length, 2); await h.play();
  assert.ok(h.player.snapshot().generation > oldGeneration); near(h.sources().at(-1).starts[0], 8.05);
  h.player.stop(); h.silent();
});

test('stop or pause during asynchronous factory/resume prevents any stale allocation or state overwrite', async t => {
  const p = await load(fixture([[on(0), off(500000)]]));
  for (const action of ['stop', 'pause']) for (const stage of ['factory', 'resume']) await t.test(`${action} during ${stage}`, async () => {
    let resolve;
    const h = harness(p, stage === 'factory' ? { contextFactory: () => new Promise(r => { resolve = r; }) } : {});
    if (stage === 'resume') h.context.resume = () => new Promise(r => { resolve = () => { h.context.state = 'running'; r(); }; });
    const starting = h.play(); assert.equal(h.player.snapshot().state, 'starting');
    h.player[action]();
    if (stage === 'factory') resolve({ context: h.context, output: h.output }); else resolve();
    await starting; assert.equal(h.player.snapshot().state, action === 'stop' ? 'stopped' : 'paused');
    assert.equal(h.context.nodes.length, 1); h.silent();
  });
});

test('a cancelled asynchronous start cannot overwrite a newer playing generation even when it rejects', async () => {
  const p = await load(fixture([[on(0), off(500000)]]));
  let rejectOld, calls = 0, h;
  h = harness(p, { contextFactory: () => ++calls === 1 ? new Promise((resolve, reject) => { rejectOld = reject; }) : { context: h.context, output: h.output } });
  const oldPlay = h.play(); h.player.stop(); await h.play(); const newGeneration = h.player.snapshot().generation;
  rejectOld(new Error('late failure from cancelled factory')); await oldPlay;
  assert.equal(h.player.snapshot().state, 'playing'); assert.equal(h.player.snapshot().generation, newGeneration);
  assert.equal(h.player.snapshot().error, null); assert.equal(h.sources().length, 2);
  assert.equal(h.timers.pending.size, 1); h.advance(0.6); h.silent();
});

test('late scheduling and context interruption stop the generation without skipping events or surviving sound', async () => {
  const p = await load(fixture([[on(0), on(200000, 62), off(500000), off(500000, 62)]]));
  const late = harness(p); await late.play(); late.context.currentTime = 0.4; late.timers.fire();
  assert.equal(late.player.snapshot().state, 'error'); assert.equal(late.player.snapshot().error.code, 'late_scheduler');
  assert.equal(late.player.snapshot().error.detail.eventId, p.runtime.events[1].event_id);
  assert.deepEqual(late.acknowledgements.map(a => a.eventId), [p.runtime.events[0].event_id]);
  assert.equal(late.sources().length, 2); late.silent();
  await assert.rejects(late.play(), { code: 'stop_required' }); late.player.stop(); await late.play(); late.player.stop(); late.silent();
  const interrupted = harness(p); await interrupted.play(); interrupted.context.state = 'suspended'; interrupted.timers.fire();
  assert.equal(interrupted.player.snapshot().error.code, 'audio_context_interrupted'); interrupted.silent();
});

test('the voice budget stops rather than stealing or acknowledging an unallocated onset', async () => {
  const p = await load(fixture([[on(0), on(0, 62), off(500000), off(500000, 62)]])), h = harness(p, { maxVoices: 1 });
  await h.play(); assert.equal(h.player.snapshot().error.code, 'voice_budget_exceeded');
  assert.equal(h.player.snapshot().error.detail.eventId, p.runtime.events[1].event_id);
  assert.equal(h.sources().length, 2); assert.equal(h.envelopes().length, 1); assert.equal(h.acknowledgements.length, 1); h.silent();
});

test('expired voices are pruned so bounded allocation can continue through a long performance', async () => {
  const rows = [];
  for (let i = 0; i < 100; i++) rows.push(on(i * 300000, 60 + i % 4), off(i * 300000 + 100000, 60 + i % 4));
  const h = harness(await load(fixture([rows])), { maxVoices: 1 }); await h.play(); h.advance(30);
  assert.equal(h.player.snapshot().state, 'ended'); assert.equal(h.sources().length, 200); assert.equal(h.envelopes().length, 100); h.silent();
});

test('partial node, buffer and source-start failures clean every already allocated node', async t => {
  const cases = [
    { method: 'createGain', at: 1 }, { method: 'createGain', at: 2 }, { method: 'createOscillator', at: 2 },
    { method: 'createBufferSource', at: 1, drum: true }, { method: 'createBiquadFilter', at: 1, drum: true },
    { method: 'createBuffer', at: 1, drum: true }, { method: 'createOscillator', at: 1, start: true },
  ];
  for (const item of cases) await t.test(`${item.method} ${item.at}${item.start ? ' start' : ''}`, async () => {
    const h = harness(await load(fixture([[on(0, item.drum ? 86 : 60, 90, item.drum ? 9 : 0), off(500000, item.drum ? 86 : 60, 0, item.drum ? 9 : 0)]])));
    const original = h.context[item.method].bind(h.context); let allocations = 0;
    h.context[item.method] = (...args) => {
      if (++allocations === item.at) {
        if (item.start) { const node = original(...args); node.start = () => { throw new Error('authored start failure'); }; return node; }
        throw new Error('authored allocation failure');
      }
      return original(...args);
    };
    await h.play(); assert.equal(h.player.snapshot().state, 'error'); assert.equal(h.player.snapshot().error.code, 'audio_failure');
    assert.equal(h.acknowledgements.length, 0); h.silent();
  });
});

test('slow observers or allocation cannot silently move a scheduled onset into the past', async () => {
  const p = await load(fixture([[on(0), on(0, 62), off(500000), off(500000, 62)]]));
  let h; h = harness(p, { onEvent: () => { h.context.currentTime = 0.1; } }); await h.play();
  assert.equal(h.player.snapshot().error.code, 'late_scheduler'); assert.equal(h.sources().length, 2); h.silent();
  const slow = harness(p), original = slow.context.createOscillator.bind(slow.context);
  slow.context.createOscillator = () => { slow.context.currentTime = 0.1; return original(); };
  await slow.play(); assert.equal(slow.player.snapshot().error.code, 'late_scheduler');
  assert.ok(slow.sources().every(source => source.starts.length === 0)); slow.silent();
});

test('callbacks may cancel immediately, including stop then throw, without reviving or overwriting the stopped generation', async () => {
  const p = await load(fixture([[on(0), on(0, 62), off(500000), off(500000, 62)]]));
  for (const throwAfter of [false, true]) {
    let h; h = harness(p, { onEvent: () => { h.player.stop(); if (throwAfter) throw new Error('authored observer failure'); } });
    await h.play(); assert.equal(h.player.snapshot().state, 'stopped'); assert.equal(h.player.snapshot().error, null);
    assert.equal(h.sources().length, 2); h.silent();
  }
});

test('every unsupported typed command blocks playback with original event identity before context creation', async () => {
  const commands = [
    ['bank_select', { component: 'most_significant', value: 1 }], ['chorus_send', { value: 1 }],
    ['key_pressure', { key: 60, pressure: 22 }], ['channel_pressure', { pressure: 33 }],
  ];
  for (const [kind, values] of commands) {
    const p = await load(fixture([[row(0, kind, { channel: 0, ...values }), on(0), off(500000)]]));
    assert.equal(p.playable, false, kind); assert.equal(p.acknowledgements.length, p.eventCount);
    assert.deepEqual(p.blockers.map(b => [b.code, b.eventId]), [[`unsupported_${kind}`, p.runtime.events[0].event_id]]);
    let called = false;
    assert.throws(() => createCleanPerformancePlayer(p, { contextFactory: () => { called = true; } }), { code: 'playback_blocked' });
    assert.equal(called, false);
  }
  const drum = await load(fixture([[on(0, 20, 90, 9), off(500000, 20, 0, 9)]]));
  assert.equal(drum.playable, false); assert.equal(drum.blockers[0].code, 'percussion_key_unmapped');
  assert.throws(() => harness(drum), { code: 'playback_blocked' });
  for (const kind of ['raw_midi', 'mystery']) {
    await assert.rejects(load(fixture([[row(0, kind), on(0), off(500000)]])), { code: 'unknown_semantics' });
  }
});

test('metadata is acknowledged in original order and zero receiver gates never fabricate a sound', async () => {
  const p = await load(fixture([[row(0, 'sequence_number', { number: null }), row(0, 'tempo', { microseconds_per_quarter: 500000 }),
    row(0, 'meter', { numerator: 4, denominator: 4, clocks_per_click: 24, thirty_seconds_per_quarter: 8 }),
    row(0, 'key_signature', { fifths: 0, mode: 'major' }), row(0, 'text', { role: 'marker', text: 'Authored fixture' }),
    on(0), off(0), row(100000, 'track_end')]])), h = harness(p);
  await h.play(); h.advance(0.2); assert.equal(h.sources().length, 0); assert.equal(h.context.nodes.length, 1);
  assert.equal(p.voices.length, 1); assert.equal(p.voices[0].releaseVelocity, 27);
  assert.deepEqual(h.acknowledgements.map(a => a.eventId), p.runtime.events.map(e => e.event_id)); h.silent();
});

test('compiler identity, coverage, route, order, clock, count and termination mutations reject', async t => {
  const edits = [
    ['profile', 'invalid_compiler_response', r => { r.profile = 'other'; }],
    ['score hash', 'invalid_compiler_response', r => { r.score_sha256 = '0'.repeat(64); }],
    ['source hash', 'invalid_compiler_response', r => { r.source_sha256 = 'bad'; }],
    ['coverage count', 'invalid_coverage', r => { r.coverage.performance.represented_events--; }],
    ['notation claim', 'invalid_coverage', r => { r.coverage.notation.status = 'complete'; }],
    ['target claim', 'invalid_coverage', r => { r.coverage.targets.represented_attacks = 1; }],
    ['track identity', 'invalid_track', r => { r.tracks[0].source_index = 1; }],
    ['part identity', 'invalid_part', r => { r.parts[0].id = 'other'; }],
    ['part sound claim', 'invalid_part', r => { r.parts[0].sound_identity = 'original_kit'; }],
    ['coordinate', 'invalid_event', r => { r.events[1].origin.event = 0; }],
    ['event identity', 'invalid_event', r => { r.events[0].event_id = 'other'; }],
    ['event order', 'invalid_event_order', r => { r.events[0].exact_microseconds = exact(600000); }],
    ['numeric clock', 'invalid_clock', r => { r.events[0].exact_microseconds.numerator = 0; }],
    ['clock overflow', 'invalid_clock', r => { r.events[0].exact_microseconds.numerator = '18446744073709551616'; }],
    ['clock denominator', 'invalid_clock', r => { r.events[0].exact_microseconds.denominator = 0; }],
    ['channel', 'invalid_channel', r => { r.events[0].command.channel = 1; }],
    ['zero attack velocity', 'invalid_key', r => { r.events[0].command.velocity = 0; }],
    ['release key', 'invalid_key', r => { r.events[1].command.key = 128; }],
    ['missing track end', 'incomplete_runtime', r => { r.events[2].command.kind = 'text'; }],
    ['track count', 'incomplete_runtime', r => { r.tracks[0].source_event_count++; }],
    ['attack count', 'incomplete_runtime', r => { r.coverage.performance.key_attacks++; }],
    ['release count', 'incomplete_runtime', r => { r.coverage.performance.key_releases++; }],
    ['end clock', 'incomplete_runtime', r => { r.duration_microseconds = exact(500001); }],
  ];
  for (const [name, code, edit] of edits) await t.test(name, async () => {
    const f = fixture([[on(0), off(500000)]]); edit(f.runtime); await assert.rejects(load(f), { code });
  });
  await assert.rejects(load(fixture([[on(0), off(86400000001)]])), { code: 'duration_limit' });
});

test('invalid scheduler bounds fail before any audio and malformed output/context failures remain explicit', async () => {
  const p = await load(fixture([[on(0), off(500000)]]));
  for (const options of [{ contextFactory: null }, { maxVoices: 0 }, { maxVoices: 129 }, { maxVoices: 1.5 },
    { lookaheadSeconds: 0 }, { lookaheadSeconds: 2 }, { pollMilliseconds: 0 }, { pollMilliseconds: 150 },
    { startLeadSeconds: 0 }, { startLeadSeconds: 0.2 }]) {
    assert.throws(() => harness(p, options), { code: 'invalid_scheduler_options' });
  }
  const context = new AudioContext(), otherContext = new AudioContext();
  for (const audio of [null, {}, { context, output: otherContext.createGain() }]) {
    const h = harness(p, { contextFactory: () => audio }); await h.play();
    assert.equal(h.player.snapshot().error.code, 'invalid_audio_output'); h.silent();
  }
  const h = harness(p); h.context.resume = async () => {};
  await h.player.play(accepted); assert.equal(h.player.snapshot().error.code, 'audio_context_interrupted'); h.silent();
});

const control = (micros, kind, value, channel = 0) => row(micros, kind, { channel, value });

test('sustain changes FIFO sound gates while every original independent release remains unchanged', async () => {
  const f = fixture([[control(0, 'sustain', 64), on(0), on(100000), off(200000), on(250000), off(300000),
    control(350000, 'sustain', 127), control(400000, 'sustain', 63), off(450000), off(460000), row(500000, 'track_end')]]);
  const before = JSON.stringify(f.runtime), p = await load(f), h = harness(p);
  assert.equal(p.policy.id, 'wmh-original-reference-fifo-controls-v2');
  assert.deepEqual(p.voices.map(v => [v.start.numerator, v.end.numerator, v.endReason]), [
    ['0', '400000', 'sustain_release'], ['100000', '400000', 'sustain_release'], ['250000', '450000', 'key_release'],
  ]);
  assert.deepEqual(p.voices.map(v => v.releaseEventId), [3, 5, 8].map(i => p.runtime.events[i].event_id));
  assert.equal(p.acknowledgements[9].disposition, 'unmatched_release');
  assert.equal(p.voices[0].sustainReleaseEventId, p.runtime.events[7].event_id);
  await assert.rejects(h.player.play(accepted), { code: 'reference_policy_required' });
  await h.play(); h.advance(0.6);
  assert.deepEqual(h.sources().map(n => n.stops[0]), [0.45, 0.45, 0.45, 0.45, 0.5, 0.5]);
  assert.deepEqual(h.acknowledgements.map(a => a.eventId), p.runtime.events.map(e => e.event_id));
  assert.equal(JSON.stringify(f.runtime), before); assert.equal(p.runtime.coverage.targets.represented_attacks, 0); h.silent();
});

test('pedal affects only its channel and held gates end at global end without invented key releases', async () => {
  const p = await load(fixture([[control(0, 'sustain', 127), on(0), off(100000), row(200000, 'track_end')],
    [on(0, 65, 90, 1), off(150000, 65, 0, 1), row(500000, 'track_end')]]));
  assert.equal(p.voices[0].end.numerator, '500000'); assert.equal(p.voices[0].endReason, 'source_end_cleanup');
  assert.equal(p.voices[0].releaseEventId, p.runtime.events.find(e => e.origin.track === 0 && e.command.kind === 'key_release').event_id);
  assert.equal(p.voices[1].end.numerator, '150000');
  const h = harness(p); await h.play(); h.advance(0.6); h.silent();
});

test('volume, expression, stereo pan and room send automate all active channel layers at exact source times', async () => {
  const p = await load(fixture([[control(0, 'volume', 80), control(0, 'expression', 64), control(0, 'pan', 0),
    control(0, 'reverb_send', 32), on(0), control(100000, 'volume', 127), control(200000, 'expression', 0),
    control(300000, 'pan', 127), control(350000, 'reverb_send', 0), off(500000)]])), h = harness(p);
  await h.play(); h.advance(0.6);
  const pan = h.context.nodes.find(n => n.nodeType === 'panner');
  const channelGain = h.context.nodes.find(n => n.connections.includes(pan));
  const lastAt = (param, at) => param.calls.filter(c => Math.abs(c[2] - at) < 1e-9).at(-1)[1];
  near(lastAt(channelGain.gain, 0.05), 80 / 127 * 64 / 127);
  near(lastAt(channelGain.gain, 0.15), 64 / 127); near(lastAt(channelGain.gain, 0.25), 0);
  near(lastAt(pan.pan, 0.05), -1); near(lastAt(pan.pan, 0.35), 1);
  const convolver = h.context.nodes.find(n => n.nodeType === 'convolver');
  const send = h.context.nodes.find(n => n.connections.includes(convolver));
  near(lastAt(send.gain, 0.05), 32 / 127); near(lastAt(send.gain, 0.4), 0);
  assert.equal(convolver.buffer, null, 'effect tail cleared at global end');
  assert.deepEqual(h.acknowledgements.map(a => a.exactMicroseconds), p.runtime.events.map(e => e.exact_microseconds)); h.silent();
});

test('repeated initial resets reset expression only while preserving bank, program, mix and every event', async () => {
  const p = await load(fixture([[row(0, 'bank_select', { channel: 0, component: 'most_significant', value: 0 }),
    row(0, 'bank_select', { channel: 0, component: 'least_significant', value: 0 }), program(0, 80),
    control(0, 'volume', 83), control(0, 'pan', 23), control(0, 'reverb_send', 48), control(0, 'expression', 14),
    row(0, 'initial_controller_reset', { channel: 0 }), control(0, 'sustain', 0), control(0, 'expression', 47),
    row(0, 'initial_controller_reset', { channel: 0 }), control(0, 'sustain', 0), control(0, 'chorus_send', 0), on(0), off(300000)]])), h = harness(p);
  assert.equal(p.voices[0].program, 80); await h.play(); h.advance(0.4);
  const pan = h.context.nodes.find(n => n.nodeType === 'panner'), gain = h.context.nodes.find(n => n.connections.includes(pan));
  near(gain.gain.calls[0][1], 83 / 127); near(pan.pan.calls[0][1], (23 - 64) / 64);
  assert.ok(h.context.nodes.some(n => n.nodeType === 'convolver'));
  assert.equal(h.acknowledgements.length, p.eventCount); h.silent();
});

test('pause and resume rebuild channel state and restart pedal-held gates without replaying their release', async () => {
  const p = await load(fixture([[control(0, 'volume', 91), control(0, 'pan', 127), control(0, 'sustain', 127),
    control(0, 'reverb_send', 48), on(0), off(100000), control(250000, 'expression', 64), control(500000, 'sustain', 0), row(600000, 'track_end')]])), h = harness(p);
  await h.play(); h.advance(0.25); h.player.pause(); near(h.player.snapshot().positionSeconds, 0.2); h.silent();
  const oldNodes = h.context.nodes.length, oldSourceCount = h.sources().length;
  await h.play();
  const pan = h.context.nodes.slice(oldNodes).find(n => n.nodeType === 'panner');
  const gain = h.context.nodes.slice(oldNodes).find(n => n.connections.includes(pan));
  near(gain.gain.calls[0][1], 91 / 127); near(pan.pan.calls[0][1], 1);
  assert.equal(h.sources().length, oldSourceCount + 2); near(h.sources().at(-1).starts[0], 0.3); near(h.sources().at(-1).stops[0], 0.6);
  h.advance(0.8); assert.equal(h.player.snapshot().state, 'ended');
  assert.equal(h.acknowledgements.filter(a => a.disposition === 'release_fifo_sustained').length, 1);
  h.silent();
});

test('every controlled source track can mute its voices while retaining exact controls and all event acknowledgements', async () => {
  const tracks = Array.from({ length: 3 }, (_, ch) => [control(0, 'volume', 60 + ch, ch), control(0, 'pan', 32 * ch, ch),
    control(0, 'sustain', 127, ch), on(0, 60 + ch, 90, ch), off(100000, 60 + ch, 0, ch), control(300000, 'sustain', 0, ch), row(400000, 'track_end')]);
  const p = await load(fixture(tracks));
  for (let track = 0; track < 3; track++) {
    const h = harness(p); h.player.setTrackMuted(track, true); await h.play(); h.advance(0.5);
    assert.equal(h.sources().length, 4); assert.equal(h.acknowledgements.length, p.eventCount);
    assert.ok(h.acknowledgements.filter(a => a.sourceTrackIndex === track).every(a => a.muted)); h.silent();
  }
  const h = harness(p); for (let track = 0; track < 3; track++) h.player.setTrackMuted(track, true);
  await h.play(); h.advance(0.5); assert.equal(h.context.nodes.length, 1); assert.equal(h.acknowledgements.length, p.eventCount); h.silent();
});

test('shared-channel controls affect voices from every owning track and cannot be independently muted', async () => {
  const p = await load(fixture([[control(0, 'sustain', 127), control(50000, 'volume', 41), row(600000, 'track_end')],
    [on(10000), off(100000), control(400000, 'sustain', 0), row(600000, 'track_end')]])), h = harness(p);
  assert.equal(p.voices[0].end.numerator, '400000'); assert.throws(() => h.player.setTrackMuted(0, true), { code: 'shared_channel_mute_unsupported' });
  await h.play(); h.advance(0.7);
  const pan = h.context.nodes.find(n => n.nodeType === 'panner'), gain = h.context.nodes.find(n => n.connections.includes(pan));
  near(gain.gain.calls.at(-1)[1], 41 / 127); assert.equal(h.acknowledgements.length, p.eventCount); h.silent();
});

test('malformed controls and initial reset sequences fail closed before any audio', async () => {
  for (const kind of ['volume', 'expression', 'pan', 'reverb_send', 'sustain', 'chorus_send']) {
    for (const value of [-1, 128, 1.5, null]) await assert.rejects(load(fixture([[control(0, kind, value), on(0), off(100000)]])), { code: 'invalid_control' });
  }
  const reset = () => row(0, 'initial_controller_reset', { channel: 0 });
  for (const tracks of [
    [[reset(), on(0), off(100000)]], [[reset(), control(0, 'sustain', 1), on(0), off(100000)]],
    [[on(0), reset(), control(0, 'sustain', 0), off(100000)]],
    [[row(1, 'initial_controller_reset', { channel: 0 }), control(1, 'sustain', 0), on(2), off(100000)]],
    [[reset(), control(0, 'sustain', 0), row(200000, 'track_end')], [on(10000), off(100000)]],
  ]) await assert.rejects(load(fixture(tracks)), { code: 'invalid_initial_reset' });
});

test('controlled mixer and room allocation failures disconnect partial nodes and stop all sources', async () => {
  const p = await load(fixture([[control(0, 'reverb_send', 48), on(0), off(500000)]]));
  for (const method of ['createStereoPanner', 'createConvolver', 'createBuffer']) {
    const h = harness(p); h.context[method] = () => { throw Error(`authored ${method} failure`); };
    await h.play(); assert.equal(h.player.snapshot().state, 'error'); assert.equal(h.player.snapshot().error.code, 'audio_failure'); h.silent();
  }
  const h = harness(p); await h.play(); h.player.stop(); h.silent();
  const count = h.sources().length; h.timers.all.forEach(t => t.callback()); assert.equal(h.sources().length, count); h.silent();
});

test('pause disconnects its shared dry/wet master before slow cleanup and still cancels sources if mixer cleanup throws', async () => {
  const p = await load(fixture([[control(0, 'reverb_send', 127), on(0), on(0, 64), off(500000), off(500000, 64)]]));
  for (const fails of [false, true]) {
    const h = harness(p); await h.play(); h.advance(0.1);
    const master = h.context.nodes.find(node => node !== h.output && node.connections.includes(h.output)), calls = []; let failOnce = fails;
    for (const node of h.context.nodes.slice(1)) {
      const disconnect = node.disconnect.bind(node);
      node.disconnect = () => {
        calls.push({kind: 'disconnect', node, at: h.context.currentTime});
        if (failOnce && node === master) { failOnce = false; throw Error('authored mixer disconnect failure'); }
        disconnect(); h.context.currentTime += 128 / 44100;
      };
    }
    for (const node of h.sources()) {
      const stop = node.stop.bind(node);
      node.stop = at => { calls.push({kind: 'stop', node, at}); stop(at); h.context.currentTime += 128 / 44100; };
    }
    if (fails) assert.throws(() => h.player.pause(), /authored mixer disconnect failure/);
    else { const paused = h.player.pause(); near(paused.positionSeconds, 0.05); h.silent(); }
    assert.equal(calls[0].kind, 'disconnect'); assert.equal(calls[0].node, master);
    assert.ok(h.sources().every(source => source.disconnected && source.stops.length === 2));
    assert.ok(h.sources().at(-1).stops.at(-1) - calls[0].at > .01, 'Native cleanup clock must actually advance');
    assert.equal(h.output.disconnected, false, 'Other shared synth output remains connected');
    assert.equal(h.timers.pending.size, 0);
    if (fails) { h.player.stop(); h.silent(); }
  }
});

test('a scheduled downstream gate cuts reference room tails at exact global end even before a delayed cleanup poll', async () => {
  const p = await load(fixture([[control(0, 'reverb_send', 127), on(0), off(50000), row(111111, 'track_end')]])), h = harness(p);
  await h.play();
  const master = h.context.nodes.find(n => n !== h.output && n.connections.includes(h.output));
  assert.deepEqual(master.gain.calls, [['set', 1, 0.05], ['set', 0, 0.05 + 0.111111]]);
  const convolver = h.context.nodes.find(n => n.nodeType === 'convolver');
  const wet = h.context.nodes.find(n => convolver.connections.includes(n));
  assert.ok(wet.connections.includes(master), 'the scheduled cutoff is downstream of convolution');
  h.advance(0.08); // Admit the end marker before deliberately delaying its disposal poll.
  h.context.currentTime = 1; h.timers.fire(); assert.equal(h.player.snapshot().state, 'ended'); h.silent();
});

test('zero SMPTE origin retains all four rate identities and exact unchanged scheduling', async () => {
  for (const frame_rate of ['fps24', 'fps25', 'drop_frame30', 'fps30']) {
    const timecode = { frame_rate, hours: 0, minutes: 0, seconds: 0, frames: 0, fractional_frames: 0 };
    const prepared = await load(fixture([[row(0, 'smpte_offset', { timecode }), program(0, 0), on(exact(500001, 3)), off(500001)]]));
    assert.equal(prepared.playable, true);
    assert.equal(prepared.acknowledgements[0].disposition, 'zero_timecode_origin');
    assert.deepEqual(prepared.acknowledgements[0].event.command.timecode, timecode);
    assert.deepEqual(prepared.voices[0].start, exact(500001, 3));
    assert.deepEqual(prepared.voices[0].end, exact(500001));
  }
});
test('receiver refuses unreviewed nonzero, malformed, repeated and misplaced origins', async () => {
  const timecode = { frame_rate: 'fps30', hours: 0, minutes: 0, seconds: 0, frames: 0, fractional_frames: 0 };
  for (const field of ['hours', 'minutes', 'seconds', 'frames', 'fractional_frames']) {
    await assert.rejects(load(fixture([[row(0, 'smpte_offset', { timecode: { ...timecode, [field]: 1 } }), on(1), off(2)]])), e => e.code === 'invalid_smpte_offset');
  }
  const zero = () => row(0, 'smpte_offset', { timecode });
  for (const tracks of [
    [[zero(), zero(), on(1), off(2)]],
    [[program(0, 0), zero(), on(1), off(2)]],
    [[row(1, 'smpte_offset', { timecode }), on(2), off(3)]],
    [[row(0, 'text', { role: 'text', text: 'Original' })], [zero(), on(1), off(2)]],
    [[row(0, 'smpte_offset', { timecode: { ...timecode, frame_rate: 'unknown' } }), on(1), off(2)]],
    [[row(0, 'smpte_offset', { timecode: { ...timecode, payload: [96,0,0,0,0] } }), on(1), off(2)]],
  ]) await assert.rejects(load(fixture(tracks)), e => e.code === 'invalid_smpte_offset');
});

const sensitivity12Kind = 'initial_pitch_bend_sensitivity12';
const select12Msb = 'select_most_significant_zero', select12Lsb = 'select_least_significant_zero';
const semitones12 = 'set_semitones12', cents12 = 'set_cents_zero';
const sensitivity12Sequences = [
  [select12Lsb, select12Msb, semitones12, cents12],
  [select12Lsb, select12Msb, select12Lsb, select12Msb, semitones12, semitones12, cents12, cents12],
  [select12Msb, select12Lsb, select12Msb, select12Lsb, semitones12, semitones12, cents12, cents12],
];
const sensitivity12Rows = (steps = sensitivity12Sequences[0], channel = 0) => steps.map((step, index) =>
  row(exact((index + 1) * 100000, 3), sensitivity12Kind, { channel, step }));

test('all reviewed twelve-semitone sequences retain every exact acknowledgement, repeated write, route and original key', async () => {
  const tracks = sensitivity12Sequences.map((steps, channel) => [
    program(0, 24 * channel, channel), row(0, 'bank_select', { channel, component: 'most_significant', value: 0 }),
    control(0, 'volume', 96, channel), control(0, 'pan', 64, channel), control(0, 'expression', 100, channel),
    control(0, 'reverb_send', 0, channel), control(0, 'chorus_send', 0, channel), ...sensitivity12Rows(steps, channel),
    ...(channel === 2 ? [] : [on(exact(800000, 3), 60 + channel, 90, channel), off(1000000, 60 + channel, 27, channel)]), row(1100000, 'track_end'),
  ]);
  tracks.push([row(0, 'text', { role: 'track_name', text: 'Authored silent conductor' }), row(1100000, 'track_end')]);
  const f = fixture(tracks), before = JSON.stringify(f.runtime), p = await load(f), scheduled = [];
  assert.equal(p.playable, true); assert.equal(p.trackCount, 4); assert.equal(p.voices.length, 2);
  for (let channel = 0; channel < 3; channel++) {
    assert.deepEqual(p.pitchStates[channel], { pitch_bend: 0, sensitivity_semitones: 12, sensitivity_cents: 0,
      rpn_most_significant: 0, rpn_least_significant: 0, sensitivity12_steps: sensitivity12Sequences[channel] });
  }
  assert.equal(p.acknowledgements.filter(ack => ack.disposition === sensitivity12Kind).length, 20);
  const original = ReferenceAudioReceiver.prototype.schedule;
  ReferenceAudioReceiver.prototype.schedule = function(voice, ...args) { scheduled.push({ key: voice.key, eventId: voice.eventId }); return original.call(this, voice, ...args); };
  try {
    const h = harness(p); await h.play(); h.advance(1.2);
    assert.equal(h.player.snapshot().state, 'ended');
    assert.deepEqual(h.acknowledgements.map(a => a.eventId), f.runtime.events.map(e => e.event_id));
    assert.deepEqual(h.acknowledgements.map(a => a.exactMicroseconds), f.runtime.events.map(e => e.exact_microseconds));
    for (const ack of h.acknowledgements) near(ack.scheduledAudioTime, 0.05 + performanceSeconds(ack.exactMicroseconds));
    assert.deepEqual(scheduled, f.runtime.events.filter(e => e.command.kind === 'key_attack').map(e => ({ key: e.command.key, eventId: e.event_id })));
    assert.equal(JSON.stringify(f.runtime), before); h.silent();
    for (let track = 0; track < 4; track++) {
      scheduled.length = 0; const muted = harness(p); muted.player.setTrackMuted(track, true); await muted.play(); muted.advance(1.2);
      assert.equal(muted.acknowledgements.length, p.eventCount);
      assert.deepEqual(scheduled, p.voices.filter(voice => voice.trackIndex !== track).map(voice => ({ key: voice.key, eventId: voice.eventId }))); muted.silent();
    }
  } finally { ReferenceAudioReceiver.prototype.schedule = original; }
});

test('pause mid-initialization and resume rebuilds the exact prefix before sounding unchanged keys', async () => {
  const p = await load(fixture([[...sensitivity12Rows(sensitivity12Sequences[1]), on(exact(800000, 3)), off(1000000)]])), h = harness(p);
  await h.play(); h.advance(0.2); h.player.pause(); h.silent();
  await h.play(); h.advance(1.3); assert.equal(h.player.snapshot().state, 'ended'); h.silent();
  assert.deepEqual(new Set(h.acknowledgements.map(ack => ack.eventId)), new Set(p.runtime.events.map(event => event.event_id)));
  h.player.stop(); await h.play(); h.advance(2.5); assert.equal(h.player.snapshot().state, 'ended'); h.silent();
});

test('twelve-semitone initialization retains nonzero bank semantics and blocks procedural playback', async () => {
  const p = await load(fixture([[row(0, 'bank_select', { channel: 0, component: 'least_significant', value: 1 }),
    ...sensitivity12Rows(), on(200000), off(400000)]]));
  assert.equal(p.playable, false); assert.deepEqual(p.blockers.map(b => b.code), ['unsupported_bank_select']);
  assert.equal(p.acknowledgements.filter(ack => ack.disposition === sensitivity12Kind).length, 4);
  assert.throws(() => harness(p), { code: 'playback_blocked' });
});

test('twelve-semitone initialization rejects every unreviewed ordering, repeat, interruption and prior key activity', async t => {
  const group = () => sensitivity12Rows(), ending = () => [on(400000), off(500000)];
  const edits = [
    ['truncated group', () => [group().slice(0, -1)]],
    ['unreviewed short MSB-first group', () => [sensitivity12Rows([select12Msb, select12Lsb, semitones12, cents12])]],
    ['twenty-four semitones', () => [sensitivity12Rows([select12Lsb, select12Msb, 'set_semitones24', cents12])]],
    ['deselection', () => [sensitivity12Rows([select12Lsb, select12Msb, semitones12, 'deselect_least_significant'])]],
    ['repeated whole group', () => [sensitivity12Rows([...sensitivity12Sequences[0], ...sensitivity12Sequences[0]])]],
    ['metadata inside group', () => { const rows = group(); rows.splice(2, 0, row(70000, 'text', { role: 'text', text: 'interruption' })); return [rows]; }],
    ['control inside group', () => { const rows = group(); rows.splice(2, 0, control(70000, 'volume', 90)); return [rows]; }],
    ['other channel inside group', () => { const rows = group(); rows.splice(2, 0, program(70000, 0, 1)); return [rows]; }],
    ['sustain before group', () => [[control(0, 'sustain', 0), ...group()]]],
    ['reset before group', () => [[row(0, 'initial_controller_reset', { channel: 0 }), control(0, 'sustain', 0), ...group()]]],
    ['zero-time reset after complete group', () => [[...group().map(event => ({...event, time: exact(0)})), row(0, 'initial_controller_reset', {channel: 0}), control(0, 'sustain', 0)]]],
    ['pressure before group', () => [[row(0, 'key_pressure', { channel: 0, key: 60, pressure: 0 }), ...group()]]],
    ['attack before group', () => [[on(0), ...group()]]],
    ['release before group', () => [[off(0), ...group()]]],
    ['attack midway', () => { const rows = group(); rows.splice(2, 0, on(70000)); return [rows]; }],
    ['shared channel later', () => [group(), [program(300000, 0), row(500000, 'track_end')]]],
    ['bend before group', () => [[row(0, 'pitch_bend', { channel: 0, value: 0 }), ...group()]]],
  ];
  for (const [name, build] of edits) await t.test(name, async () => {
    const tracks = build(); tracks[0].push(...ending());
    await assert.rejects(load(fixture(tracks)), { code: 'invalid_initial_sensitivity12' });
  });
});

test('malformed twelve-semitone runtime payloads, source coordinates and exact clocks fail before audio', async t => {
  const edits = [
    ['extra payload', r => r.events[0].command.value = 12],
    ['unknown step', r => r.events[0].command.step = 'set_semitones13'],
    ['missing step', r => delete r.events[0].command.step],
    ['bad channel', r => r.events[0].command.channel = 16],
    ['source gap', r => r.events[1].origin.event++],
    ['extra source field', r => r.events[0].origin.raw = 0],
    ['source duplicate', r => r.events[1].origin = { ...r.events[0].origin }],
    ['wrong track', r => r.events[1].origin.track = 1],
    ['numeric clock', r => r.events[0].exact_microseconds.numerator = 1],
    ['negative clock', r => r.events[0].exact_microseconds.numerator = '-1'],
    ['overflow clock', r => r.events[0].exact_microseconds.numerator = '18446744073709551616'],
    ['invalid denominator', r => r.events[0].exact_microseconds.denominator = 0],
    ['extra clock field', r => r.events[0].exact_microseconds.raw = 0],
    ['regressive exact time', r => r.events[1].exact_microseconds = exact(1, 3)],
    ['reordered events', r => [r.events[0], r.events[1]] = [r.events[1], r.events[0]]],
  ];
  for (const [name, edit] of edits) await t.test(name, async () => {
    const f = fixture([[...sensitivity12Rows(), on(200000), off(400000)]]); edit(f.runtime);
    await assert.rejects(load(f), { code: 'invalid_initial_sensitivity12' });
  });
});

test('single logical device mapping preserves exact events, chooses an explicit policy and acknowledges FF09 as routing', async () => {
  const name = 'Authored <device> 音源  ';
  const f = fixture([
    [row(0, 'tempo', { microseconds_per_quarter: 500000 }), row(500000, 'track_end')],
    [deviceName(name), row(0, 'text', { role: 'program_name', text: 'Authored program' }), row(0, 'bank_select', { channel: 0, component: 'most_significant', value: 0 }), program(0, 24), on(0), off(500000)],
    [deviceName(name), program(0, 48, 1), on(0, 65, 90, 1), off(500000, 65, 27, 1)],
  ]);
  const before = structuredClone(f.runtime), prepared = await load(f);
  assert.equal(prepared.playable, true);
  assert.deepEqual(prepared.logical_device_mapping, { device_name: name, receiver: 'wmh-procedural-reference-v1', policy: 'single_named_device_to_procedural_receiver' });
  assert.equal(prepared.policy.logical_device_mapping, prepared.logical_device_mapping);
  assert.match(prepared.policy.id, /:single-named-device-v1$/);
  assert.deepEqual(prepared.runtime, before);
  assert.deepEqual(prepared.acknowledgements.filter(ack => ack.disposition === 'logical_device_mapping').map(ack => ack.event.command.text), [name, name]);
  const h = harness(prepared);
  await assert.rejects(h.player.play({ userGesture: true, acceptedPolicyId: prepared.policy.id.replace(':single-named-device-v1', '') }), { code: 'reference_policy_required' });
  assert.equal(h.factoryCalls(), 0);
  await h.play(); h.advance(.7);
  assert.deepEqual(h.acknowledgements.map(ack => [ack.eventId, ack.exactMicroseconds, ack.disposition]), prepared.acknowledgements.map(ack => [ack.eventId, ack.event.exact_microseconds, ack.disposition]));
  assert.deepEqual(prepared.voices.map(voice => voice.key), [60, 65]);
  assert.equal(h.player.snapshot().state, 'ended');
});

test('unresolved named routes retain complete events but block the actual typed receiver before audio', async t => {
  const named = [deviceName(), on(0), off(500000)], conductor = [row(0, 'tempo', { microseconds_per_quarter: 500000 }), row(500000, 'track_end')];
  const cases = [
    ['empty', [[deviceName(''), on(0), off(500000)]]],
    ['whitespace', [[deviceName(' \t\n'), on(0), off(500000)]]],
    ['duplicate identical', [[deviceName(), deviceName(), on(0), off(500000)]]],
    ['changed destination', [[deviceName(), deviceName('Other authored device'), on(0), off(500000)]]],
    ['mixed default track', [named, [on(0, 65, 90, 1), off(500000, 65, 0, 1)]]],
    ['different track name', [named, [deviceName('Other authored device'), on(0, 65, 90, 1), off(500000, 65, 0, 1)]]],
    ['late time', [[deviceName('Authored receiver', 1), on(1), off(500000)]]],
    ['after program', [[program(0, 0), deviceName(), on(0), off(500000)]]],
    ['after bank', [[row(0, 'bank_select', { channel: 0, component: 'most_significant', value: 0 }), deviceName(), on(0), off(500000)]]],
    ['after ProgramName', [[row(0, 'text', { role: 'program_name', text: 'Authored program' }), deviceName(), on(0), off(500000)]]],
    ['shared channel', [named, [deviceName(), on(0, 65), off(500000, 65)]]],
    ['control-only default track', [named, [program(0, 24, 1), row(500000, 'track_end')]]],
    ['conflicting conductor', [[deviceName('Other authored device'), ...conductor], named]],
    ['duplicate conductor', [[deviceName(), deviceName(), ...conductor], named]],
    ['late conductor', [[row(0, 'text', { role: 'program_name', text: 'Authored program' }), deviceName(), ...conductor], named]],
  ];
  for (const [label, rows] of cases) await t.test(label, async () => {
    const f = fixture(rows), before = structuredClone(f.runtime), prepared = await load(f);
    assert.equal(prepared.playable, false); assert.equal(prepared.logical_device_mapping, null);
    assert.ok(prepared.blockers.some(blocker => blocker.code === 'unresolved_logical_device_route'));
    assert.deepEqual(prepared.runtime, before);
    assert.ok(prepared.acknowledgements.filter(ack => ack.event.command.role === 'device_name').every(ack => ack.disposition === 'blocked'));
    let calls = 0;
    assert.throws(() => createCleanPerformancePlayer(prepared, { contextFactory: () => { calls++; } }), { code: 'playback_blocked' });
    assert.equal(calls, 0);
  });
});

test('typed routing binds source name, source beat and runtime time even when compiler identity remains valid', async () => {
  for (const edit of [
    f => { f.runtime.events[0].command = { kind: 'text', role: 'device_name', text: 'Changed authored device' }; },
    f => { f.runtime.events[0].command = { kind: 'text', role: 'track_name', text: 'Authored receiver' }; },
    f => { f.runtime.events[0].exact_microseconds = exact(1); },
  ]) {
    const f = fixture([[deviceName(), on(100), off(500000)]]); edit(f);
    const prepared = await load(f);
    assert.equal(prepared.playable, false); assert.equal(prepared.logical_device_route_reason, 'source_runtime_binding');
    assert.equal(prepared.runtime.events.length, f.runtime.events.length);
  }
  const f = fixture([[deviceName(), on(100), off(500000)]]), score = structuredClone(f.score);
  score.performance.events[0].at = { numerator: 1, denominator: 500000 };
  const scoreBytes = new TextEncoder().encode(JSON.stringify(score)), expectedScoreSha256 = sha256(scoreBytes);
  f.runtime.score_sha256 = expectedScoreSha256;
  const prepared = await load({ scoreBytes, expectedScoreSha256, compile: async () => f.runtime, crypto: webcrypto });
  assert.equal(prepared.playable, false); assert.equal(prepared.logical_device_route_reason, 'source_runtime_binding');
});

test('named routing keeps bank restrictions and no-name behavior, and rejects runtime ports, prefixes and SysEx', async () => {
  const unchanged = await load(fixture([[on(0), off(500000)], [on(0, 65), off(500000, 65)]]));
  assert.equal(unchanged.playable, true); assert.equal(unchanged.logical_device_mapping, null);
  assert.equal(unchanged.policy, REFERENCE_RECEIVER_POLICY);
  const bank = await load(fixture([[deviceName(), row(0, 'bank_select', { channel: 0, component: 'most_significant', value: 1 }), on(0), off(500000)]]));
  assert.equal(bank.playable, false); assert.ok(bank.logical_device_mapping);
  assert.deepEqual(bank.blockers.map(blocker => blocker.code), ['unsupported_bank_select']);
  for (const route of [row(0, 'midi_port', { port: 0 }), row(0, 'channel_prefix', { channel: 0 }), row(0, 'sysex', { data: [] }), row(0, 'sys_ex', { data: [] }), row(0, 'text', { role: 'midi_port', text: '0' })]) {
    const prepared = await load(fixture([[route, on(0), off(500000)]]));
    assert.equal(prepared.playable, false); assert.equal(prepared.acknowledgements[0].disposition, 'blocked');
    assert.ok(prepared.blockers.some(blocker => blocker.code === 'unresolved_logical_device_route'));
  }
});

test('typed named routing retains the full native MIDI tempo range and exact native clocks', async () => {
  for (const tempo of [1, 99999, 100000, 6000000, 6000001, 0xffffff]) {
    const f = fixture([[deviceName(), row(0, 'tempo', { microseconds_per_quarter: tempo }), on(0), off(500000)]]);
    const score = structuredClone(f.score), runtime = structuredClone(f.runtime);
    for (const event of runtime.events) if (event.exact_microseconds.numerator === '500000') event.exact_microseconds = exact(tempo);
    runtime.duration_microseconds = exact(tempo);
    const scoreBytes = new TextEncoder().encode(JSON.stringify(score)), expectedScoreSha256 = sha256(scoreBytes);
    runtime.score_sha256 = expectedScoreSha256;
    const prepared = await load({ scoreBytes, expectedScoreSha256, compile: async () => runtime, crypto: webcrypto });
    assert.equal(prepared.playable, true, `tempo ${tempo}`);
    assert.deepEqual(prepared.voices[0].end, exact(tempo));
  }
});

test('named route labels apply identical UTF-8 bounds and reject controls without changing exact valid names', async () => {
  const invalid=['Route\0A','Route\nA','Route\tA','Route\rA','Route\x7fA','Route\u0085A','\u00a0\u2003','A'.repeat(4097),'é'.repeat(2049),'Route\ud800A','A'.repeat(257),'DM: literal route','\u2003DM: literal route'];
  for(const name of invalid){
    const f=fixture([[deviceName(name),on(0),off(500000)]]), prepared=await load(f);
    assert.equal(prepared.playable,false);assert.equal(prepared.logical_device_route_reason,'empty_or_invalid_name');
    assert.equal(prepared.runtime.events[0].command.text,name);
  }
  for(const name of ['  Studio A  ','  studio a  ','A'.repeat(256),'A '.repeat(2048),'é'.repeat(2048),'🎹'.repeat(1024)]){
    const prepared=await load(fixture([[deviceName(name),on(0),off(500000)]]));
    assert.equal(prepared.playable,true);assert.equal(prepared.logical_device_mapping.device_name,name);
  }
});

const bend = (time, value, channel = 0) => row(time, 'pitch_bend', { channel, value });
const frequency = (key, offset = 0) => 440 * 2 ** ((key + offset - 69) / 12);
function pitchCalls(source, expected) {
  assert.equal(source.frequency.calls.length, expected.length);
  source.frequency.calls.forEach(([kind, value, time], index) => {
    assert.equal(kind, 'set'); near(value, expected[index][0]); near(time, expected[index][1]);
  });
}

test('retained bend changes retune active and pedal-held C/E layers at native times without moving source keys', async () => {
  const f = fixture([[on(0), bend(100000, 12288), on(200000, 64), control(250000, 'sustain', 127),
    off(300000), bend(400000, 0), off(450000, 64), bend(500000, 8192), control(600000, 'sustain', 0),
    bend(700000, 16383), row(800000, 'track_end')]]);
  const before = JSON.stringify(f.runtime), p = await load(f), h = harness(p);
  assert.equal(p.policy.id, COMPLETE_PITCH_POLICY.id); assert.equal(p.playable, true);
  assert.deepEqual(p.voices.map(v => v.key), [60, 64]);
  await assert.rejects(h.player.play({ userGesture: true, acceptedPolicyId: REFERENCE_RECEIVER_POLICY.id }), { code: 'reference_policy_required' });
  assert.equal(h.factoryCalls(), 0);
  await h.play(); h.advance(0.9);
  pitchCalls(h.sources()[0], [[frequency(60), .05], [frequency(60, 1), .15], [frequency(60, -2), .45], [frequency(60), .55]]);
  pitchCalls(h.sources()[2], [[frequency(64, 1), .25], [frequency(64, -2), .45], [frequency(64), .55]]);
  pitchCalls(h.sources()[1], h.sources()[0].frequency.calls.map(([, value, time]) => [value * 2, time]));
  assert.ok(h.sources().every(source => source.stops[0] === .65));
  assert.deepEqual(h.acknowledgements.map(a => a.eventId), p.runtime.events.map(e => e.event_id));
  assert.deepEqual(h.acknowledgements.map(a => a.exactMicroseconds), p.runtime.events.map(e => e.exact_microseconds));
  assert.equal(JSON.stringify(f.runtime), before); assert.equal(f.score.notation, null); h.silent();
});

test('full 14-bit precision and asymmetric positive endpoint use uniform range normalization, including repeated commands', async () => {
  const values = [0, 1, 8191, 8192, 8193, 16383, 16383];
  const f = fixture([[on(0, 67), ...values.map((value, index) => bend(exact(500001 + index * 300000, 3), value)), off(1000000, 67)]]);
  const p = await load(f), h = harness(p); await h.play(); h.advance(1.1);
  pitchCalls(h.sources()[0], [[frequency(67), .05], ...values.map((value, index) =>
    [frequency(67, (value - 8192) / 8192 * 2), .05 + (500001 + index * 300000) / 3000000])]);
  assert.equal(h.acknowledgements.filter(a => a.disposition === 'pitch_bend').length, values.length);
  assert.ok(frequency(67, (16383 - 8192) / 8192 * 2) < frequency(67, 2)); h.silent();
});

test('all proved twelve-semitone groups scale bends and resume pedal-held voices from past state, excluding scheduled future bends', async () => {
  for (const sequence of sensitivity12Sequences) {
    const p = await load(fixture([[...sensitivity12Rows(sequence), on(300000), bend(350000, 12288),
      control(360000, 'sustain', 127), off(370000), bend(500000, 0), control(700000, 'sustain', 0), row(800000, 'track_end')]]));
    const h = harness(p); await h.play(); h.advance(.46);
    near(h.sources()[0].frequency.calls.at(-1)[1], frequency(60, -12)); // Future lookahead.
    const before = h.player.snapshot(); assert.throws(() => h.player.seek(.2), { code: 'seek_unsupported' });
    assert.deepEqual(h.player.snapshot(), before);
    h.player.pause(); near(h.player.snapshot().positionSeconds, .41); h.silent();
    const count = h.sources().length; await h.play();
    near(h.sources()[count].frequency.calls[0][1], frequency(60, 6));
    near(h.sources()[count].starts[0], .51);
    h.advance(.95); assert.equal(h.player.snapshot().state, 'ended'); h.silent();
    pitchCalls(h.sources()[count], [[frequency(60, 6), .51], [frequency(60, -12), .60]]);
    h.player.stop(); const prior = h.sources().length; await h.play(); h.advance(1.4);
    near(h.sources()[prior].frequency.calls[0][1], frequency(60)); h.player.stop(); h.silent();
  }
});

test('initial reset centers bend and nulls selectors while stored sensitivity is a separate state value', async () => {
  const states = new ReferencePitchChannels();
  for (const step of sensitivity12Sequences[0]) states.command({ kind: sensitivity12Kind, channel: 0, step });
  states.command({ kind: 'pitch_bend', channel: 0, value: 16383 });
  states.command({ kind: 'initial_controller_reset', channel: 0 });
  assert.equal(states.offset(0), 0); assert.equal(states.range(0), 12);
  assert.equal(states.channels[0].rpn_most_significant, 127); assert.equal(states.channels[0].rpn_least_significant, 127);
  // Public validation still holds reset + RPN setup, and every active/late reset.
  const p = await load(fixture([[bend(0, 16383), row(0, 'initial_controller_reset', { channel: 0 }),
    control(0, 'sustain', 0), on(0), bend(100000, 0), off(200000)]])), h = harness(p);
  await h.play(); h.advance(.3);
  pitchCalls(h.sources()[0], [[frequency(60), .05], [frequency(60, -2), .15]]); h.silent();
  await assert.rejects(load(fixture([[on(0), bend(0, 8192), row(0, 'initial_controller_reset', { channel: 0 }), control(0, 'sustain', 0), off(200000)]])), { code: 'invalid_initial_reset' });
});

test('track mute retains every bend and setup acknowledgement under the named-route policy', async () => {
  const p = await load(fixture([[deviceName(), on(0), bend(100000, 16383), off(500000)],
    [deviceName(), ...sensitivity12Rows(sensitivity12Sequences[1], 1).map((event, index) => ({ ...event, time: exact((index + 1) * 10000) })),
      on(300000, 64, 90, 1), bend(350000, 0, 1), off(500000, 64, 0, 1)]]));
  assert.equal(p.playable, true); assert.ok(p.logical_device_mapping);
  for (let track = 0; track < 2; track++) {
    const h = harness(p); h.player.setTrackMuted(track, true); await h.play(); h.advance(.6);
    assert.equal(h.sources().length, 2);
    assert.deepEqual(h.acknowledgements.map(a => a.eventId), p.runtime.events.map(e => e.event_id));
    h.silent();
  }
});

test('malformed bend, unsupported range, percussion, RPN24 and shared ownership never silently select a fallback', async () => {
  for (const value of [-1, 16384, .5, '8192', null, undefined]) {
    await assert.rejects(load(fixture([[bend(0, value), on(0), off(500000)]])), { code: 'invalid_pitch_bend' });
  }
  const extra = fixture([[bend(0, 8192), on(0), off(500000)]]); extra.runtime.events[0].command.raw = [0, 64];
  await assert.rejects(load(extra), { code: 'invalid_pitch_bend' });
  await assert.rejects(load(fixture([[bend(0, 8192), row(500000, 'track_end')], [on(100000), off(500000)]])), { code: 'invalid_pitch_bend_route' });
  for (const [input, code] of [
    [[bend(0, 8192, 9), on(0, 60, 90, 9), off(500000, 60, 0, 9)], 'unsupported_percussion_bend'],
    [[bend(0, 8192), on(0, 0), off(500000, 0)], 'unsupported_pitch_range'],
    [[bend(0, 8192), on(0, 127), off(500000, 127)], 'unsupported_pitch_range'],
    [[row(0, 'bank_select', { channel: 0, component: 'most_significant', value: 1 }), bend(0, 8192), on(0), off(500000)], 'unsupported_bank_select'],
  ]) {
    const p = await load(fixture([input])); assert.equal(p.playable, false); assert.ok(p.blockers.some(b => b.code === code));
    assert.equal(p.acknowledgements.length, p.eventCount); assert.throws(() => harness(p), { code: 'playback_blocked' });
  }
  await assert.rejects(load(fixture([[row(0, 'initial_pitch_bend_sensitivity', { channel: 0, step: 'set_semitones24' }), bend(0, 8192), on(0), off(500000)]])), { code: 'unknown_semantics' });
  const p = await load(fixture([[bend(0, 16383), on(0, 67), off(500000, 67)]])), h = harness(p);
  h.context.sampleRate = 1000; await h.play(); assert.equal(h.player.snapshot().error.code, 'unsupported_pitch_range'); h.silent();
});
