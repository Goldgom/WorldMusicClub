import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, webcrypto } from 'node:crypto';
import {
  loadMidiReference, createMidiReferencePlayer, exactMicrosecondsToSeconds,
  REFERENCE_RECEIVER_POLICY,
} from '../web/midi-reference-player.js';
import { PROGRAM_FAMILIES, REFERENCE_PERCUSSION } from '../web/midi-reference-synth.js';

const channel = (channel, kind, values) => ({ kind: 'channel', channel, message: { kind, ...values } });
const on = (tick, key = 60, velocity = 90, ch = 0) => ({ tick, kind: channel(ch, 'note_on', { key, velocity }) });
const off = (tick, key = 60, velocity = 27, ch = 0) => ({ tick, kind: channel(ch, 'note_off', { key, velocity }) });
const program = (tick, value, ch = 0) => ({ tick, kind: channel(ch, 'program_change', { program: value }) });
const meta = (tick, type, data = []) => ({ tick, kind: { kind: 'meta', meta_type: type, data } });
const tempo = (tick, value) => ({ tick, kind: { kind: 'tempo', microseconds_per_quarter: value } });
const vlq = number => { const result = [number & 127]; while ((number >>>= 7)) result.unshift((number & 127) | 128); return result; };
const u32 = value => [value >>> 24, value >>> 16 & 255, value >>> 8 & 255, value & 255];
function encode(kind) {
  if (kind.kind === 'channel') {
    const { channel: ch, message: m } = kind;
    if (m.kind === 'note_on') return [0x90 | ch, m.key, m.velocity];
    if (m.kind === 'note_off') return [0x80 | ch, m.key, m.velocity];
    if (m.kind === 'program_change') return [0xc0 | ch, m.program];
    if (m.kind === 'controller') return [0xb0 | ch, m.controller, m.value];
    if (m.kind === 'pitch_bend') return [0xe0 | ch, m.value & 127, m.value >> 7];
    if (m.kind === 'key_pressure') return [0xa0 | ch, m.key, m.pressure];
    if (m.kind === 'channel_pressure') return [0xd0 | ch, m.pressure];
  }
  if (kind.kind === 'meta') return [255, kind.meta_type, ...vlq(kind.data.length), ...kind.data];
  if (kind.kind === 'tempo') return [255, 81, 3, ...u32(kind.microseconds_per_quarter).slice(1)];
  if (kind.kind === 'time_signature') return [255, 88, 4, kind.numerator, kind.denominator_power, kind.clocks_per_click, kind.thirty_seconds_per_quarter];
  if (kind.kind === 'sys_ex' || kind.kind === 'escape') return [kind.kind === 'sys_ex' ? 240 : 247, ...vlq(kind.data.length), ...kind.data];
  throw new Error('Unknown test event');
}
// Original synthetic SMFs, written here together with explicit expected Rust
// records. The mock is a transport fixture, never a production MIDI parser.
function fixture(tracks, { diagnostics = [], clock = true, ppq = 100 } = {}) {
  const bytes = [77, 84, 104, 100, 0, 0, 0, 6, 0, tracks.length === 1 ? 0 : 1, 0, tracks.length, ppq >> 8, ppq & 255];
  const events = [];
  tracks.forEach((input, trackIndex) => {
    const rows = [...input];
    if (rows.at(-1)?.kind?.meta_type !== 47) rows.push(meta(rows.at(-1)?.tick ?? 0, 47));
    const encoded = []; let previous = 0;
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i], start = bytes.length + 8 + encoded.length, delta = row.tick - previous;
      encoded.push(...vlq(delta), ...encode(row.kind));
      events.push({ id: { track_index: trackIndex, event_index: i }, tick: row.tick, delta_ticks: delta,
        beat: { numerator: row.tick, denominator: ppq }, source_range: { start, end: bytes.length + 8 + encoded.length }, kind: row.kind });
      previous = row.tick;
    }
    bytes.push(77, 84, 114, 107, ...u32(encoded.length), ...encoded);
  });
  const originalBytes = Uint8Array.from(bytes), hash = createHash('sha256').update(originalBytes).digest('hex');
  events.sort((a, b) => a.tick - b.tick || a.id.track_index - b.id.track_index || a.id.event_index - b.id.event_index);
  let previous = 0, micros = 0n, tempoValue = 500000n;
  for (const event of events) {
    event.id.source_sha256 = hash;
    micros += BigInt(event.tick - previous) * tempoValue;
    event.relative_microseconds = clock ? { numerator: String(micros), denominator: ppq } : null;
    if (event.kind.kind === 'tempo') tempoValue = BigInt(event.kind.microseconds_per_quarter);
    previous = event.tick;
  }
  const timeline = { source_sha256: hash, format: tracks.length === 1 ? 0 : 1, track_count: tracks.length, ppq,
    end_tick: events.at(-1).tick, relative_clock_available: clock, events, diagnostics };
  const calls = [];
  const request = async (url, options) => { calls.push({ url, options }); return { ok: true, status: 200, json: async () => timeline }; };
  return { originalBytes, expectedSourceSha256: hash, crypto: webcrypto, request, calls, timeline };
}
const load = f => loadMidiReference(f);
class Param {
  constructor() { this.calls = []; }
  setValueAtTime(...args) { this.calls.push(['set', ...args]); }
  linearRampToValueAtTime(...args) { this.calls.push(['ramp', ...args]); }
}
class Node {
  constructor(context, type) {
    this.context = context; this.nodeType = type; this.gain = new Param(); this.frequency = new Param(); this.Q = new Param();
    this.connections = []; this.starts = []; this.stops = []; this.disconnected = false;
  }
  connect(node) { this.connections.push(node); return node; }
  disconnect() { this.disconnected = true; }
  start(at) { this.starts.push(at); }
  stop(at) { this.stops.push(at); }
}
class Audio {
  constructor() { this.currentTime = 0; this.state = 'suspended'; this.sampleRate = 48000; this.nodes = []; this.resumeCount = 0; }
  make(type) { const result = new Node(this, type); this.nodes.push(result); return result; }
  createGain() { return this.make('gain'); }
  createOscillator() { return this.make('oscillator'); }
  createBufferSource() { return this.make('noise'); }
  createBiquadFilter() { return this.make('filter'); }
  createBuffer(channels, length, sampleRate) { return { sampleRate, getChannelData: () => new Float32Array(length) }; }
  async resume() { this.resumeCount++; this.state = 'running'; }
}
class Timers {
  constructor() { this.pending = new Map(); this.all = []; this.next = 0; }
  setTimeout = callback => { const id = ++this.next; this.pending.set(id, callback); this.all.push(callback); return id; };
  clearTimeout = id => { this.pending.delete(id); };
  fire() { const pending = [...this.pending.values()]; this.pending.clear(); pending.forEach(callback => callback()); }
}
function harness(prepared, options = {}) {
  const context = new Audio(), output = context.createGain(), timers = new Timers(), acknowledgements = [], states = [];
  let factoryCalls = 0;
  const player = createMidiReferencePlayer(prepared, { contextFactory: () => { factoryCalls++; return { context, output }; },
    timers, onEvent: event => acknowledgements.push(event), onState: state => states.push(state), ...options });
  const play = () => player.play({ userGesture: true, acceptedPolicyId: REFERENCE_RECEIVER_POLICY.id });
  const advance = to => { while (context.currentTime + 0.02 < to) { context.currentTime += 0.02; timers.fire(); } context.currentTime = to; timers.fire(); };
  const sources = () => context.nodes.filter(node => node.nodeType === 'oscillator' || node.nodeType === 'noise');
  return { context, output, timers, acknowledgements, states, player, play, advance, sources, factoryCalls: () => factoryCalls };
}

test('complete bytes are posted once and hash-bound; JSON, mismatches and copied prepared handles are refused', async () => {
  const f = fixture([[on(0), off(100)]]), prepared = await load(f);
  assert.equal(f.calls.length, 1); assert.equal(f.calls[0].url, '/api/midi/events');
  assert.deepEqual(f.calls[0].options.body, f.originalBytes);
  assert.notEqual(f.calls[0].options.body, f.originalBytes);
  assert.equal(f.calls[0].options.headers['Content-Type'], 'application/octet-stream');
  assert.ok(Object.isFrozen(prepared.timeline.events[0].kind.message));
  f.timeline.events[0].kind.message.key = 75;
  assert.equal(prepared.timeline.events[0].kind.message.key, 60);
  await assert.rejects(loadMidiReference({ ...f, originalBytes: {} }), { code: 'original_bytes_required' });
  await assert.rejects(loadMidiReference({ ...f, expectedSourceSha256: '0'.repeat(64) }), { code: 'source_hash_mismatch' });
  f.timeline.source_sha256 = '0'.repeat(64);
  await assert.rejects(load(f), { code: 'source_hash_mismatch' });
  assert.throws(() => createMidiReferencePlayer(structuredClone(prepared), {}), { code: 'live_rust_required' });
});

test('every original event has one ordered acknowledgement; FIFO layers preserve releases and programs', async () => {
  const f = fixture([[meta(0, 3, [65]), tempo(0, 500000), program(0, 24), on(0, 60, 91), on(20, 60, 72),
    program(30, 80), off(40, 60, 33), on(50, 60, 0), off(60, 60, 55), on(70, 62, 88), meta(100, 47)]]);
  const p = await load(f);
  assert.equal(p.eventCount, 11); assert.equal(p.acknowledgements.length, 11);
  assert.deepEqual(p.acknowledgements.map(a => a.event), p.timeline.events);
  assert.deepEqual(p.voices.map(v => [v.program, v.velocity, v.releaseVelocity, v.endReason]), [
    [24, 91, 33, 'note_off'], [24, 72, 0, 'note_on'], [80, 88, null, 'source_end_cleanup'],
  ]);
  assert.equal(p.acknowledgements[4].disposition, 'layered_onset');
  assert.equal(p.acknowledgements[8].disposition, 'unmatched_release');
  assert.equal(p.voices[0].releaseEventId, p.acknowledgements[6].eventId);
  assert.equal(p.voices[1].releaseEventId, p.acknowledgements[7].eventId);
  const h = harness(p); await h.play(); h.advance(0.56);
  assert.equal(h.player.snapshot().state, 'ended');
  assert.deepEqual(h.acknowledgements.map(a => a.eventId), p.acknowledgements.map(a => a.eventId));
  assert.ok(h.sources().every(source => source.disconnected));
  assert.equal(f.timeline.events[7].kind.message.kind, 'note_on');
});

test('exact decimal timing preserves large numerator and tempo-change fractions until audio conversion', async () => {
  const numerator = 9007199254740993n, divisor = 32767000000n;
  assert.equal(exactMicrosecondsToSeconds({ numerator: String(numerator), denominator: 32767 }), Number(numerator / divisor) + Number(numerator % divisor) / Number(divisor));
  const f = fixture([[tempo(0, 500001), on(1), tempo(2, 600007), off(3)]], { ppq: 3 });
  const p = await load(f);
  assert.deepEqual(p.voices[0].start, { numerator: '500001', denominator: 3 });
  assert.deepEqual(p.voices[0].end, { numerator: '1600009', denominator: 3 });
  const h = harness(p); await h.play(); h.advance(0.6);
  assert.ok(Math.abs(h.sources()[0].starts[0] - (0.05 + 500001 / 3000000)) < 1e-12);
  assert.ok(Math.abs(h.sources()[0].stops[0] - (0.05 + 1600009 / 3000000)) < 1e-12);
  assert.deepEqual(p.timeline, f.timeline);
});

test('11 independent tracks, original channel programs and reference percussion 85–87 stay present', async () => {
  const tracks = Array.from({ length: 11 }, (_, ch) => [program(0, ch === 9 ? 118 : ch * 8, ch), on(0, ch === 9 ? 85 : 48 + ch, 90, ch), off(100, ch === 9 ? 85 : 48 + ch, 19, ch)]);
  tracks[9] = [program(0, 118, 9), on(0, 85, 90, 9), off(30, 85, 2, 9), on(30, 86, 80, 9), off(60, 86, 3, 9), on(60, 87, 70, 9), off(100, 87, 4, 9)];
  const p = await load(fixture(tracks));
  assert.equal(p.playable, true); assert.equal(p.trackCount, 11); assert.ok(p.tracks.every(t => t.independent));
  const drums = p.voices.filter(v => v.channel === 9);
  assert.deepEqual(drums.map(v => [v.key, v.program]), [[85, 118], [86, 118], [87, 118]]);
  assert.match(p.programs.find(v => v.channel === 9).reference, /kit unknown/);
  assert.equal(PROGRAM_FAMILIES.length, 16);
  assert.ok([85, 86, 87].every(key => REFERENCE_PERCUSSION[key].name.includes('WMH')));
  const h = harness(p); await h.play(); h.advance(0.56);
  assert.equal(h.acknowledgements.length, p.eventCount); assert.ok(h.context.nodes.some(node => node.nodeType === 'noise'));
});

test('gesture and explicit rendition selection gate lazy context allocation and resume', async () => {
  const h = harness(await load(fixture([[on(0), off(100)]])));
  assert.equal(h.context.nodes.length, 1); assert.equal(h.factoryCalls(), 0);
  await assert.rejects(h.player.play(), { code: 'user_gesture_required' });
  await assert.rejects(h.player.play({ userGesture: true }), { code: 'reference_policy_required' });
  assert.equal(h.factoryCalls(), 0); await h.play(); assert.equal(h.factoryCalls(), 1); assert.equal(h.context.resumeCount, 1);
  assert.equal(h.sources().length, 2); assert.ok(h.sources().every(s => s.starts[0] === 0.05 && s.stops[0] === 0.55));
  h.player.stop();
});

test('pause cancels active and future sources; resume reconstructs remaining held gates and later events', async () => {
  const p = await load(fixture([[on(0), on(22, 62), off(100), off(110, 62)]]));
  const h = harness(p); await h.play(); h.advance(0.12);
  assert.equal(h.sources().length, 4); const old = [...h.sources()], oldTimers = [...h.timers.all];
  const pause = h.player.pause(); assert.ok(Math.abs(pause.positionSeconds - 0.07) < 1e-12);
  assert.ok(old.every(s => s.disconnected && s.stops.at(-1) === 0.12));
  h.context.currentTime = 0.8; oldTimers.forEach(callback => callback()); assert.equal(h.sources().length, 4);
  await assert.rejects(h.player.play({ acceptedPolicyId: p.policy.id }), { code: 'user_gesture_required' });
  await h.play();
  const fresh = h.sources().slice(4); assert.equal(fresh.length, 4);
  assert.ok(Math.abs(fresh[0].starts[0] - 0.85) < 1e-12); assert.ok(Math.abs(fresh[0].stops[0] - 1.28) < 1e-12);
  assert.ok(Math.abs(fresh[2].starts[0] - 0.89) < 1e-12);
  h.advance(1.35); assert.equal(h.player.snapshot().state, 'ended');
  assert.ok(h.sources().every(s => s.disconnected));
});

test('stop resets, invalidates stale timers and cancels pending asynchronous context start', async () => {
  const p = await load(fixture([[on(0), off(100)]])), h = harness(p);
  await h.play(); const stale = h.timers.all[0]; h.player.stop(); h.context.currentTime = 8; stale();
  assert.equal(h.player.snapshot().state, 'stopped'); assert.equal(h.player.snapshot().positionSeconds, 0);
  assert.ok(h.sources().every(s => s.disconnected));
  await h.play(); assert.equal(h.sources().at(-1).starts[0], 8.05); h.player.stop();
  let resolve; const pending = harness(p, { contextFactory: () => new Promise(r => { resolve = r; }) });
  const starting = pending.play(); pending.player.stop(); resolve({ context: pending.context, output: pending.output }); await starting;
  assert.equal(pending.player.snapshot().state, 'stopped'); assert.equal(pending.sources().length, 0); assert.equal(pending.context.resumeCount, 0);
});

test('late timer, voice budget and interrupted audio stop with diagnostics and no surviving sources', async () => {
  const p = await load(fixture([[on(0), on(40, 62), off(100), off(100, 62)]]));
  const late = harness(p); await late.play(); late.context.currentTime = 0.4; late.timers.fire();
  assert.equal(late.player.snapshot().error.code, 'late_scheduler'); assert.ok(late.sources().every(s => s.disconnected));
  await assert.rejects(late.play(), { code: 'stop_required' });
  const budget = harness(await load(fixture([[on(0), on(0, 62), off(100), off(100, 62)]])), { maxVoices: 1 });
  await budget.play(); assert.equal(budget.player.snapshot().error.code, 'voice_budget_exceeded'); assert.ok(budget.sources().every(s => s.disconnected));
  const interrupted = harness(p); await interrupted.play(); interrupted.context.state = 'suspended'; interrupted.timers.fire();
  assert.equal(interrupted.player.snapshot().error.code, 'audio_context_interrupted'); assert.ok(interrupted.sources().every(s => s.disconnected));
});

test('mute keeps all event accounting; shared channel mute, live mute and arbitrary seek fail explicitly', async () => {
  const p = await load(fixture([[on(0), off(100)], [on(0, 65, 90, 1), off(100, 65, 0, 1)]]));
  const h = harness(p); h.player.setTrackMuted(0, true); await h.play();
  assert.equal(h.sources().length, 2); assert.throws(() => h.player.setTrackMuted(1, true), { code: 'stop_required' });
  h.advance(0.56); assert.equal(h.acknowledgements.length, p.eventCount);
  assert.ok(h.acknowledgements.filter(a => a.muted).length === 3);
  assert.throws(() => h.player.seek(0.1), { code: 'seek_unsupported' });
  const shared = await load(fixture([[on(0), off(50)], [on(20, 62), off(90, 62)]]));
  assert.equal(shared.playable, true); assert.equal(shared.tracks[0].independent, false);
  const sharedPlayer = harness(shared).player;
  assert.throws(() => sharedPlayer.setTrackMuted(0, true), { code: 'shared_channel_mute_unsupported' });
});

test('unsupported state is blocked before any audio: controllers, pressure, bend, SysEx, escape, ports, metadata, clock, drums and cross-track order', async () => {
  const kinds = [channel(0, 'controller', { controller: 64, value: 127 }), channel(0, 'pitch_bend', { value: 8192 }),
    channel(0, 'channel_pressure', { pressure: 22 }), channel(0, 'key_pressure', { key: 60, pressure: 50 }),
    { kind: 'sys_ex', data: [1, 247] }, { kind: 'escape', data: [1] }, { kind: 'meta', meta_type: 33, data: [0] }, { kind: 'meta', meta_type: 1, data: [65] }];
  for (const kind of kinds) {
    const p = await load(fixture([[{ tick: 0, kind }, on(0), off(100)]]));
    assert.equal(p.playable, false, kind.kind); assert.equal(p.acknowledgements.length, p.eventCount);
    assert.throws(() => harness(p), { code: 'playback_blocked' });
  }
  const unavailable = await load(fixture([[on(0), off(100)]], { clock: false }));
  assert.ok(unavailable.blockers.some(b => b.code === 'clock_unavailable'));
  const drum = await load(fixture([[on(0, 20, 90, 9), off(100, 20, 0, 9)]]));
  assert.ok(drum.blockers.some(b => b.code === 'percussion_key_unmapped'));
  const order = await load(fixture([[on(0), off(100)], [on(0, 62), off(100, 62)]]));
  assert.ok(order.blockers.some(b => b.code === 'cross_track_channel_order'));
  const diagnostic = await load(fixture([[on(0), off(100)]], { diagnostics: [{ code: 'smpte_offset_uninterpreted', message: 'Offset unsupported' }] }));
  assert.equal(diagnostic.playable, false);
});

test('zero-length receiver gates still acknowledge both separate source events without scheduling an artificial sound', async () => {
  const p = await load(fixture([[on(0), off(0), meta(10, 47)]])), h = harness(p);
  await h.play(); h.advance(0.12);
  assert.equal(h.sources().length, 0); assert.equal(h.acknowledgements.length, 3);
  assert.equal(p.voices.length, 1); assert.equal(p.voices[0].releaseVelocity, 27);
});

test('source identity/order/truncation and unsafe exact numeric numerators are rejected', async () => {
  const edits = [
    f => { f.timeline.events[0].id.source_sha256 = '0'.repeat(64); },
    f => { f.timeline.events[1].id.event_index = 0; },
    f => { f.timeline.events[0].relative_microseconds.numerator = 0; },
    f => { f.timeline.events.pop(); },
    f => { f.timeline.events[1].tick = 1001; },
    f => { f.timeline.events[1].relative_microseconds.numerator = '18446744073709551616'; },
  ];
  for (const edit of edits) { const f = fixture([[on(0), off(100)]]); edit(f); await assert.rejects(load(f)); }
});

test('original 10,669-event, 11-channel fixture accounts for every event without changing source records', async () => {
  const tracks = Array.from({ length: 11 }, (_, ch) => {
    const rows = [meta(0, 3, [84, 48 + ch]), program(0, ch === 9 ? 118 : ch * 8, ch)];
    if (ch === 0) rows.push(tempo(0, 500000), { tick: 0, kind: { kind: 'time_signature', numerator: 4, denominator_power: 2, clocks_per_click: 24, thirty_seconds_per_quarter: 8 } });
    for (let i = 0; i < (ch < 4 ? 484 : 483); i++) {
      const key = ch === 9 ? 85 + i % 3 : 48 + ch;
      rows.push(on(i * 10, key, 64 + i % 50, ch), off(i * 10 + 8, key, i % 40, ch));
    }
    return rows;
  });
  const f = fixture(tracks), p = await load(f);
  assert.equal(p.eventCount, 10669); assert.equal(p.voices.length, 5317); assert.equal(p.playable, true);
  const h = harness(p); await h.play(); h.advance(p.durationSeconds + 0.1);
  assert.equal(h.player.snapshot().state, 'ended'); assert.equal(h.acknowledgements.length, 10669);
  assert.deepEqual(h.acknowledgements.map(e => e.eventId), p.acknowledgements.map(e => e.eventId));
  assert.deepEqual(p.timeline, f.timeline); assert.ok(h.sources().every(source => source.disconnected));
});

test('program families and source velocity shape only new voices, and callbacks can cancel safely', async () => {
  const p = await load(fixture([[program(0, 0), on(0, 60, 127), program(10, 80), on(10, 62, 64), off(100), off(100, 62)]]));
  const h = harness(p); await h.play();
  assert.deepEqual(h.sources().map(s => s.type), ['triangle', 'sine', 'sawtooth', 'square']);
  const envelopes = h.context.nodes.filter(n => n.nodeType === 'gain' && n.gain.calls.some(c => c[0] === 'ramp'));
  assert.equal(envelopes[0].gain.calls.find(c => c[0] === 'ramp')[1], 0.08);
  assert.equal(envelopes[1].gain.calls.find(c => c[0] === 'ramp')[1], 0.08 * 64 / 127);
  h.player.stop();
  let cancelPlayer;
  const cancel = harness(p, { onEvent: () => cancelPlayer.stop() }); cancelPlayer = cancel.player;
  await cancel.play(); assert.equal(cancel.player.snapshot().state, 'stopped'); assert.equal(cancel.timers.pending.size, 0);
  assert.ok(cancel.sources().every(source => source.disconnected));
});

test('stop during an in-flight context resume and partial node failure leaves no active generation', async () => {
  const p = await load(fixture([[on(0), off(100)]])), h = harness(p);
  let finishResume;
  h.context.resume = () => new Promise(resolve => { finishResume = () => { h.context.state = 'running'; resolve(); }; });
  const playing = h.play(); h.player.stop(); finishResume(); await playing;
  assert.equal(h.player.snapshot().state, 'stopped'); assert.equal(h.sources().length, 0);
  const partial = harness(p); let allocations = 0;
  const original = partial.context.createOscillator.bind(partial.context);
  partial.context.createOscillator = () => { if (++allocations === 2) throw new Error('fake resource failure'); return original(); };
  await partial.play(); assert.equal(partial.player.snapshot().error.code, 'audio_failure');
  assert.ok(partial.context.nodes.slice(1).every(node => node.disconnected));
});

test('lookahead acknowledgement exposes source/audio time and does not report an early elapsed position', async () => {
  const p = await load(fixture([[on(0), off(100)]])), h = harness(p);
  await h.play(); const scheduled = h.acknowledgements[0], snapshot = h.player.snapshot();
  assert.equal(scheduled.scheduledAudioTime, 0.05);
  assert.deepEqual(scheduled.sourceRelativeMicroseconds, p.timeline.events[0].relative_microseconds);
  assert.equal(scheduled.sourceTick, 0); assert.equal(scheduled.sourceTrackIndex, 0);
  assert.equal(snapshot.currentAudioTimeSeconds, 0); assert.equal(snapshot.audioAnchorSeconds, 0.05);
  assert.equal(snapshot.waitingForLead, true); assert.equal(snapshot.positionSeconds, 0);
  h.advance(0.08); assert.equal(h.player.snapshot().waitingForLead, false);
  assert.ok(Math.abs(h.player.snapshot().positionSeconds - 0.03) < 1e-12);
  h.player.stop();
});

test('downstream node allocation failures also disconnect their newly created upstream sources', async () => {
  const cases = [
    { rows: [on(0), off(100)], method: 'createGain', failingCall: 2 },
    { rows: [on(0, 86, 90, 9), off(100, 86, 0, 9)], method: 'createBiquadFilter', failingCall: 1 },
  ];
  for (const item of cases) {
    const h = harness(await load(fixture([item.rows]))), original = h.context[item.method].bind(h.context);
    let calls = 0;
    h.context[item.method] = () => { if (++calls === item.failingCall) throw new Error('fake downstream failure'); return original(); };
    await h.play(); assert.equal(h.player.snapshot().error.code, 'audio_failure');
    assert.ok(h.context.nodes.slice(1).every(node => node.disconnected));
  }
});

test('a slow observer or node allocation cannot silently schedule later onsets in the past', async () => {
  const p = await load(fixture([[on(0), on(0, 62), off(100), off(100, 62)]]));
  let observed;
  const slow = harness(p, { onEvent: () => { observed.context.currentTime = 0.1; } }); observed = slow;
  await slow.play(); assert.equal(slow.player.snapshot().error.code, 'late_scheduler');
  assert.ok(slow.sources().every(source => source.disconnected));
  const allocation = harness(p), original = allocation.context.createOscillator.bind(allocation.context);
  allocation.context.createOscillator = () => { allocation.context.currentTime = 0.1; return original(); };
  await allocation.play(); assert.equal(allocation.player.snapshot().error.code, 'late_scheduler');
  assert.ok(allocation.sources().every(source => source.disconnected && source.starts.length === 0));
});

test('an observer that stops and throws cannot overwrite the newer stopped generation', async () => {
  const p = await load(fixture([[on(0), off(100)]]));
  let stopped;
  const h = harness(p, { onEvent: () => { stopped.player.stop(); throw new Error('observer failure after stop'); } }); stopped = h;
  await h.play(); assert.equal(h.player.snapshot().state, 'stopped'); assert.equal(h.player.snapshot().error, null);
  assert.ok(h.sources().every(source => source.disconnected)); assert.equal(h.timers.pending.size, 0);
});

test('resumed simultaneous held voices share one anchor even while audio allocation advances the clock', async () => {
  const p = await load(fixture([[on(0), on(0, 62), off(100), off(100, 62)]])), h = harness(p);
  await h.play(); h.advance(0.15); h.player.pause(); h.context.currentTime = 1;
  const oldCount = h.sources().length, createGain = h.context.createGain.bind(h.context);
  h.context.createGain = () => { h.context.currentTime += 0.002; return createGain(); };
  await h.play();
  const fresh = h.sources().slice(oldCount);
  assert.equal(fresh.length, 4); assert.ok(fresh.every(source => source.starts[0] === fresh[0].starts[0]));
  assert.ok(Math.abs(fresh[0].starts[0] - 1.05) < 1e-12);
  assert.ok(fresh.every(source => Math.abs(source.stops[0] - 1.45) < 1e-12));
  h.player.stop();
});
