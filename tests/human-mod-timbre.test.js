import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {
  SongModStore, createSongMod, defaultSongMod, normalizeSongMod,
  songModChanges, songModConfigFingerprint, songModIdentity, songModOptions,
  validateSongMod, SONG_MOD_STORAGE_PREFIX, SONG_MOD_LEGACY_STORAGE_PREFIX,
} from '../web/song-mod.js';
import {
  createPartInstrumentPolicy, resolvePartInstrumentInput,
  assertPartInstrumentPolicyCurrent,
} from '../web/part-instrument-policy.js';
import {LiveToneCore, buildLiveToneTriangles} from '../web/live-tone-core.js';
import {fixture} from './frontend-fixtures.js';

const rate = 48000, triangles = buildLiveToneTriangles(rate);
const invalidMod = {code: 'invalid_song_mod'};
function context() {
  const score = structuredClone(fixture);
  score.parts.push({...structuredClone(score.parts[0]), id: 'second', name: 'Second'});
  return {score, compiled: {timeline: {notes: []}}, practiceSelection: {kind: 'all'}, mode: 'practice'};
}
function makeMod(value, instruments, overrides = {}) {
  const base = defaultSongMod(value), config = structuredClone(base.config);
  for (const [index, part] of config.parts.entries()) Object.assign(part, {liveInstrument: instruments[index]}, overrides);
  return createSongMod(base, config);
}
function binding(value, mod, performanceInstrument = 'piano', mode = 'practice') {
  return {mod, identity: songModIdentity(value), parts: value.score.parts, performanceInstrument, mode};
}
function memoryStorage() {
  const values = new Map(), writes = [];
  return {values, writes, storage: {
    getItem: key => values.get(key) ?? null,
    setItem(key, value) { writes.push({key, value}); values.set(key, value); },
  }};
}
function oldFingerprint(config) {
  const tuple = [config.layout, config.showOtherParts, config.parts.map(part => [part.partId, part.performer, part.instrument, part.muted, part.visible])];
  return createHash('sha256').update('wmc-song-mod-config-v1\n' + JSON.stringify(tuple)).digest('hex');
}
function legacyMod(value) {
  const mod = structuredClone(defaultSongMod(value));
  mod.version = 1;
  for (const part of mod.config.parts) delete part.liveInstrument;
  mod.configFingerprint = oldFingerprint(mod.config);
  return mod;
}
/** Feed the admitted route's instrument into the production DSP exactly once.
 * This is policy/DSP coverage; frontend input wiring has its own tests. */
function renderResolved(route) {
  assert.equal(route.status, 'ready');
  const events = [], core = new LiveToneCore(rate, {emit: event => events.push(event)});
  core.handleMessage({type: 'initialize', generation: 1, requestId: 1, triangles}, 0);
  core.handleMessage({type: 'play', generation: 1, requestId: 2, token: 1, id: 'shared-physical-key', midi: 69, duration: 320, delay: 0, timbre: route.instrument, velocity: 100, atFrame: 0}, 0);
  const pcm = new Float32Array(rate / 2);
  for (let frame = 0; frame < pcm.length; frame += 128) core.process([pcm.subarray(frame, Math.min(frame + 128, pcm.length))], frame);
  assert.equal(core.state, 'ready');
  assert.equal(core.activeNotes, 0);
  return {pcm, events, snapshot: core.snapshot(pcm.length)};
}
const pcmBytes = pcm => Buffer.from(pcm.buffer, pcm.byteOffset, pcm.byteLength);

for (const performanceInstrument of ['piano', 'guitar']) test(`follow keeps exact pre-Mod ${performanceInstrument} PCM`, () => {
  const value = context(), mod = makeMod(value, ['follow', 'follow']), current = binding(value, mod, performanceInstrument);
  const policy = createPartInstrumentPolicy(mod, current), route = resolvePartInstrumentInput(policy, {kind: 'shared'}, current);
  assert.equal(policy.human.status, 'ready');
  assert.equal(route.instrument, performanceInstrument);
  const actual = renderResolved(route), previous = renderResolved({status: 'ready', instrument: performanceInstrument});
  assert.deepEqual(pcmBytes(actual.pcm), pcmBytes(previous.pcm));
  assert.deepEqual(actual.snapshot, previous.snapshot);
});

test('explicit piano and guitar policies produce different real PCM with identical MIDI, time and ownership', () => {
  const value = context(), source = JSON.stringify(value), results = {};
  for (const instrument of ['piano', 'guitar']) {
    const mod = makeMod(value, [instrument, instrument], {instrument: 'reed', muted: true, visible: false});
    const current = binding(value, mod, instrument === 'piano' ? 'guitar' : 'piano');
    const policy = createPartInstrumentPolicy(mod, current), route = resolvePartInstrumentInput(policy, {kind: 'shared'}, current);
    assert.equal(policy.human.instrument, instrument);
    assert.equal(route.instrument, instrument);
    assert.deepEqual(route.partIds, value.score.parts.map(part => part.id));
    assert.deepEqual(policy.machineInstrumentOverrides, {});
    assert.deepEqual(songModOptions(mod).instrumentOverrides, {});
    results[instrument] = renderResolved(route);
    const {snapshot, events} = results[instrument], started = events.filter(event => event.type === 'started'), ended = events.filter(event => event.type === 'ended');
    assert.equal(snapshot.started, 1, 'A shared key creates one voice for all human owners');
    assert.equal(snapshot.ended, 1);
    assert.equal(snapshot.droppedVoices, 0);
    assert.equal(started.length, 1);
    assert.equal(ended.length, 1);
    assert.equal(started[0].midi, 69);
    assert.equal(started[0].actualStartFrame, 0);
    assert.equal(ended[0].actualEndFrame, 22560);
    assert.ok(ended[0].pcmEnergy > 1);
    assert.ok(ended[0].nonzeroSamples > 20000);
  }
  assert.ok(results.piano.pcm.some((sample, index) => Math.abs(sample - results.guitar.pcm[index]) > .01));
  assert.notDeepEqual(pcmBytes(results.piano.pcm), pcmBytes(results.guitar.pcm));
  assert.equal(JSON.stringify(value), source, 'Source notes, timing and selection remain unchanged');
});

test('matching explicit and follow human owners share one resolved voice without choosing a representative part', () => {
  const value = context(), mod = makeMod(value, ['follow', 'guitar']), current = binding(value, mod, 'guitar');
  const policy = createPartInstrumentPolicy(mod, current), route = resolvePartInstrumentInput(policy, {kind: 'shared'}, current);
  assert.equal(policy.human.kind, 'shared-group');
  assert.equal(policy.human.status, 'ready');
  assert.deepEqual(policy.human.conflictingPartIds, []);
  assert.equal(route.ownership, 'shared-group');
  assert.deepEqual(route.partIds, ['piano', 'second']);
  assert.equal(route.instrument, 'guitar');
  assert.equal(renderResolved(route).snapshot.started, 1);
  assert.equal(resolvePartInstrumentInput(policy, {kind: 'part', partId: 'piano'}, current).reason, 'ambiguous_shared_human_input');
  assert.equal(resolvePartInstrumentInput(policy, {kind: 'shared', partId: 'piano'}, current).status, 'blocked');
});

test('incompatible human choices block the shared route even when one owner is muted and hidden', () => {
  const value = context(), mod = makeMod(value, ['piano', 'guitar']);
  const config = structuredClone(mod.config); config.parts[1].muted = true; config.parts[1].visible = false;
  const changed = createSongMod(mod, config), current = binding(value, changed), policy = createPartInstrumentPolicy(changed, current);
  assert.equal(policy.human.status, 'conflict');
  assert.equal(policy.human.instrument, null);
  assert.deepEqual(policy.human.conflictingPartIds, ['piano', 'second']);
  const route = resolvePartInstrumentInput(policy, {kind: 'shared'}, current);
  assert.equal(route.status, 'blocked');
  assert.equal(route.reason, 'conflicting_human_live_instruments');
  assert.deepEqual(route.partIds, []);
});

test('machine live choices are dormant, and return only when that part becomes human', () => {
  const value = context(), base = makeMod(value, ['piano', 'guitar']), config = structuredClone(base.config);
  Object.assign(config.parts[1], {performer: 'machine', instrument: 'reed'});
  const machine = createSongMod(base, config), policy = createPartInstrumentPolicy(machine, binding(value, machine));
  assert.equal(policy.human.status, 'ready');
  assert.equal(policy.human.instrument, 'piano');
  assert.deepEqual(policy.human.partIds, ['piano']);
  assert.deepEqual(policy.machineInstrumentOverrides, {second: 'reed'});
  assert.equal(machine.config.parts[1].liveInstrument, 'guitar');
  config.parts[1].performer = 'human';
  const human = createSongMod(base, config), resumed = createPartInstrumentPolicy(human, binding(value, human));
  assert.equal(resumed.human.status, 'conflict');
  assert.deepEqual(resumed.machineInstrumentOverrides, {});
  assert.equal(human.config.parts[1].instrument, 'reed');
});

test('no human owners yields no live instrument or admitted input', () => {
  const value = context(), mod = makeMod(value, ['piano', 'guitar'], {performer: 'machine'});
  const policy = createPartInstrumentPolicy(mod, {...binding(value, mod), mode: 'listen'});
  assert.equal(policy.human.status, 'none');
  assert.equal(policy.human.instrument, null);
  assert.deepEqual(policy.human.partIds, []);
  assert.deepEqual(policy.human.conflictingPartIds, []);
  assert.equal(resolvePartInstrumentInput(policy).reason, 'no_human_parts');
});

test('Listen mode blocks human live input without changing saved ownership or instrument choices', () => {
  const value = context(), mod = makeMod(value, ['guitar', 'guitar']), source = JSON.stringify(mod);
  const current = binding(value, mod, 'piano', 'listen'), policy = createPartInstrumentPolicy(mod, current);
  assert.deepEqual(policy.human.partIds, ['piano', 'second']);
  assert.equal(policy.human.instrument, 'guitar');
  assert.equal(resolvePartInstrumentInput(policy, {kind: 'shared'}, current).reason, 'not_practice_mode');
  assert.equal(JSON.stringify(mod), source);
});

test('unsupported performance profiles and modes cannot be admitted as a live policy', () => {
  const value = context(), mod = makeMod(value, ['follow', 'follow']);
  for (const current of [
    binding(value, mod, 'reed'),
    binding(value, mod, 'source'),
    binding(value, mod, 'piano', 'record'),
  ]) assert.throws(() => createPartInstrumentPolicy(mod, current), {code: 'invalid_part_instrument_policy'});
});

test('policy binding rejects changed config, source revision, ordered parts, default instrument and mode', () => {
  const value = context(), mod = makeMod(value, ['follow', 'follow']), current = binding(value, mod);
  const policy = createPartInstrumentPolicy(mod, current);
  assert.doesNotThrow(() => assertPartInstrumentPolicyCurrent(policy, current));
  assert.equal(resolvePartInstrumentInput(policy, {kind: 'shared'}, structuredClone(current)).status, 'ready');
  const config = structuredClone(mod.config); config.parts[0].visible = false;
  const cases = [
    {...current, mod: createSongMod(mod, config)},
    {...current, identity: {...current.identity, songId: 'another-song'}},
    {...current, identity: {...current.identity, sourceRevision: {...current.identity.sourceRevision, value: '0'.repeat(64)}}},
    {...current, parts: [...current.parts].reverse()},
    {...current, parts: current.parts.slice(0, 1)},
    {...current, performanceInstrument: 'guitar'},
    {...current, mode: 'listen'},
  ];
  for (const stale of cases) {
    assert.throws(() => assertPartInstrumentPolicyCurrent(policy, stale), {code: 'stale_part_instrument_policy'});
    assert.throws(() => resolvePartInstrumentInput(policy, {kind: 'shared'}, stale), {code: 'stale_part_instrument_policy'});
  }
  const tampered = structuredClone(mod); tampered.config.parts[0].liveInstrument = 'guitar';
  assert.throws(() => assertPartInstrumentPolicyCurrent(policy, {...current, mod: tampered}));
  assert.equal(resolvePartInstrumentInput(policy, {kind: 'shared'}, current).status, 'ready', 'Rejected current bindings do not mutate the admitted snapshot');
});

test('live policy remains immutable and cannot be cloned into an admitted input route', () => {
  const value = context(), mod = makeMod(value, ['follow', 'follow']);
  const policy = createPartInstrumentPolicy(mod, binding(value, mod));
  assert.throws(() => { policy.human.instrument = 'guitar'; }, TypeError);
  assert.throws(() => policy.human.partIds.pop(), TypeError);
  assert.throws(() => policy.human.conflictingPartIds.push('invented'), TypeError);
  assert.throws(() => resolvePartInstrumentInput(structuredClone(policy)), {code: 'invalid_part_instrument_policy'});
});

test('v2 fingerprints bind explicit live choice while preserving the exact v1 native golden vector', () => {
  const config = {layout: 'complete', showOtherParts: true, parts: [
    {partId: 'midi-t2-c1', performer: 'human', instrument: 'source', muted: false, visible: true},
    {partId: 'midi-t3-c2', performer: 'machine', instrument: 'source', muted: false, visible: true},
  ]};
  const original = JSON.stringify(config), expected = 'd532e0a13635c824c646d08f27ad62ecfdf13bc6d4fcc310637bb2fd6e32a366';
  assert.equal(oldFingerprint(config), expected);
  assert.equal(songModConfigFingerprint(config, 1), expected);
  assert.equal(songModConfigFingerprint(config), expected);
  const v2 = createSongMod(songModIdentity(context()), config);
  assert.equal(v2.version, 2);
  assert.deepEqual(v2.config.parts.map(part => part.liveInstrument), ['follow', 'follow']);
  assert.notEqual(v2.configFingerprint, expected);
  const tuple = [v2.config.layout, v2.config.showOtherParts, v2.config.parts.map(part => [part.partId, part.performer, part.instrument, part.liveInstrument, part.muted, part.visible])];
  assert.equal(v2.configFingerprint, createHash('sha256').update('wmc-song-mod-config-v2\n' + JSON.stringify(tuple)).digest('hex'));
  const explicit = structuredClone(v2.config); explicit.parts[0].liveInstrument = 'piano';
  assert.notEqual(createSongMod(v2, explicit).configFingerprint, v2.configFingerprint);
  assert.equal(JSON.stringify(config), original);
});

test('mixed v1/v2 drafts are rejected instead of silently repairing a malformed v2 configuration', () => {
  const value = context(), legacy = legacyMod(value), config = structuredClone(legacy.config);
  config.parts[0].liveInstrument = 'guitar';
  const before = JSON.stringify(config);
  assert.throws(() => createSongMod(legacy, config), invalidMod);
  assert.equal(JSON.stringify(config), before);
});

test('normalization validates v1 first and leaves legacy bytes and source content unchanged', () => {
  const value = context(), source = JSON.stringify(value), v1 = legacyMod(value), raw = JSON.stringify(v1, null, 2), current = binding(value, v1);
  assert.equal(validateSongMod(v1, current), v1);
  const v2 = normalizeSongMod(v1, current);
  assert.equal(v2.version, 2);
  assert.deepEqual(v2.config.parts.map(part => part.liveInstrument), ['follow', 'follow']);
  const stripped = structuredClone(v2.config); for (const part of stripped.parts) delete part.liveInstrument;
  assert.deepEqual(stripped, v1.config);
  assert.deepEqual(v2.sourceRevision, v1.sourceRevision);
  assert.equal(JSON.stringify(v1, null, 2), raw);
  assert.equal(JSON.stringify(value), source);
  const forged = structuredClone(v1); forged.config.parts[0].instrument = 'reed';
  assert.throws(() => normalizeSongMod(forged, current), invalidMod);
  const unknown = structuredClone(v1); unknown.config.parts[0].liveInstrument = 'guitar';
  assert.throws(() => normalizeSongMod(unknown, current), invalidMod);
});

test('legacy storage loads as v2 without writing, and explicit saves preserve the original v1 raw record', () => {
  const value = context(), v1 = legacyMod(value), {storage, values, writes} = memoryStorage();
  const store = new SongModStore({storage}), identity = songModIdentity(value);
  const legacyKey = store.key(identity, SONG_MOD_LEGACY_STORAGE_PREFIX), key = store.key(identity);
  assert.ok(legacyKey.startsWith('worldmusichub.song-mod.v1.'));
  assert.ok(key.startsWith('worldmusichub.song-mod.v2.'));
  assert.equal(SONG_MOD_STORAGE_PREFIX, 'worldmusichub.song-mod.v2.');
  const raw = '\n' + JSON.stringify(v1, null, 2) + '\n'; values.set(legacyKey, raw);
  const loaded = store.read(value);
  assert.equal(loaded.status, 'saved');
  assert.equal(loaded.mod.version, 2);
  assert.equal(loaded.explicit, true);
  assert.equal(writes.length, 0);
  assert.equal(values.get(legacyKey), raw);
  assert.equal(values.has(key), false);
  const config = structuredClone(loaded.mod.config); config.parts[0].liveInstrument = 'guitar';
  const changed = createSongMod(loaded.mod, config);
  assert.equal(store.save(value, changed).status, 'saved');
  assert.equal(writes.length, 1);
  assert.equal(writes[0].key, key);
  assert.equal(JSON.parse(values.get(key)).version, 2);
  assert.equal(values.get(legacyKey), raw);
  assert.deepEqual(new SongModStore({storage}).read(value).mod, changed);
});

test('saving a validated legacy Mod creates only a v2 record and never mutates its caller', () => {
  const value = context(), {storage, values, writes} = memoryStorage(), store = new SongModStore({storage});
  const v1 = legacyMod(value), before = JSON.stringify(v1), saved = store.save(value, v1);
  assert.equal(saved.status, 'saved');
  assert.equal(saved.mod.version, 2);
  assert.equal(writes.length, 1);
  assert.ok(writes[0].key.startsWith(SONG_MOD_STORAGE_PREFIX));
  assert.equal(values.size, 1);
  assert.equal(JSON.parse(writes[0].value).version, 2);
  assert.equal(JSON.stringify(v1), before);
});

test('a valid v2 record takes precedence over v1; corrupt v2 never silently reactivates a legacy choice', () => {
  const value = context(), {storage, values, writes} = memoryStorage(), store = new SongModStore({storage}), identity = songModIdentity(value);
  const legacyKey = store.key(identity, SONG_MOD_LEGACY_STORAGE_PREFIX), key = store.key(identity);
  const oldRaw = JSON.stringify(legacyMod(value)), saved = makeMod(value, ['guitar', 'guitar']);
  values.set(legacyKey, oldRaw); values.set(key, JSON.stringify(saved));
  assert.deepEqual(new SongModStore({storage}).read(value).mod, saved);
  values.set(key, '{invalid');
  const invalid = new SongModStore({storage}).read(value);
  assert.equal(invalid.status, 'unavailable');
  assert.deepEqual(invalid.mod, invalid.original);
  assert.equal(values.get(key), '{invalid');
  assert.equal(values.get(legacyKey), oldRaw);
  assert.equal(writes.length, 0);
});

test('closed v2 live schema rejects invalid values, omissions and unknown fields before saving', () => {
  const value = context(), {storage, values, writes} = memoryStorage(), store = new SongModStore({storage});
  const good = makeMod(value, ['guitar', 'guitar']); store.save(value, good);
  const before = [...values], edits = [
    mod => { mod.config.parts[0].liveInstrument = 'source'; },
    mod => { mod.config.parts[0].liveInstrument = 'reed'; },
    mod => { mod.config.parts[0].liveInstrument = null; },
    mod => { delete mod.config.parts[0].liveInstrument; },
    mod => { mod.config.parts[0].independentInput = true; },
    mod => { mod.config.parts[0].instrument = 'guitar'; },
    mod => { mod.config.parts[0].liveInstrument = 'piano'; },
    mod => { mod.config.parts[0].partId = 'unbound'; },
    mod => { mod.version = 1; },
    mod => { mod.config.extra = true; },
  ];
  for (const edit of edits) {
    const invalid = structuredClone(good); edit(invalid);
    assert.throws(() => validateSongMod(invalid, binding(value, invalid)), invalidMod);
    assert.throws(() => store.save(value, invalid), invalidMod);
    assert.deepEqual([...values], before);
    assert.deepEqual(store.read(value).mod, good);
  }
  assert.equal(writes.length, 1, 'No malformed Mod reaches storage');
});

test('live timbre edits reset the current take; migration to follow alone preserves its synthesis policy', () => {
  const value = context(), v1 = legacyMod(value), normalized = normalizeSongMod(v1), changed = makeMod(value, ['guitar', 'follow']);
  assert.equal(songModChanges(v1, normalized).requiresReset, false);
  assert.equal(songModChanges(normalized, changed).instruments, true);
  assert.equal(songModChanges(normalized, changed).requiresReset, true);
  const config = structuredClone(changed.config); config.parts[0].muted = true; config.parts[0].visible = false;
  assert.equal(songModChanges(changed, createSongMod(changed, config)).requiresReset, false);
});


test('an empty persisted v2 record is invalid and cannot reactivate legacy choices', () => {
  const value=context(), old=legacyMod(value), saved=memoryStorage(), store=new SongModStore({storage:saved.storage});
  const identity=songModIdentity(value);
  saved.values.set(store.key(identity,SONG_MOD_LEGACY_STORAGE_PREFIX),JSON.stringify(old));
  saved.values.set(store.key(identity),'');
  assert.equal(store.read(value).status,'unavailable');
  assert.equal(saved.writes.length,0);
  assert.equal(saved.values.get(store.key(identity)),'');
});
