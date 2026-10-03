import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {WrittenCursorIndex, setupWrittenCursor} from '../web/written-cursor.js';
import {NotationNavigationIndex, basicNotationPage} from '../web/notation-follow.js';
import {fixture} from './frontend-fixtures.js';

const beat = numerator => ({numerator, denominator: 1});
function setup() {
  const score = structuredClone(fixture), base = score.parts[0].notes[0];
  score.measures = [0, 1].map(index => ({number: 7, at: beat(index * 2), length: beat(2)}));
  score.parts[0].notes = [
    {...structuredClone(base), id: 'tie-start', at: beat(0), duration: beat(2), tie_start: true},
    {...structuredClone(base), id: 'tie-stop', at: beat(2), duration: beat(2), tie_stop: true},
    {...structuredClone(base), id: 'short', at: beat(0), duration: beat(1), pitch: {step: 'D', alter: 0, octave: 4}},
    {...structuredClone(base), id: 'rest', at: beat(1), duration: beat(2), pitch: null, velocity: 0},
  ];
  score.repeats = [{from: beat(0), to: beat(4), times: 2}];
  const occurrences = [0, 1, 0, 1].map((sourceIndex, index) => ({id: `m-${index}`, source_measure_index: sourceIndex, measure_number: 7,
    source_from: beat(sourceIndex * 2), source_to: beat(sourceIndex * 2 + 2), start_ms: index * 1000, end_ms: (index + 1) * 1000,
    repeat_region_index: 0, repeat_pass: Math.floor(index / 2) + 1, repeat_times: 2,
    written_note_ids: sourceIndex ? ['tie-stop'] : ['tie-start', 'short', 'rest'], continuing_note_ids: sourceIndex ? ['rest'] : []}));
  const notes = [0, 1].flatMap(pass => [
    {id: `tie-${pass}`, part_id: 'piano', source_note_ids: ['tie-start', 'tie-stop'], start_ms: pass * 2000, duration_ms: 2000},
    {id: `short-${pass}`, part_id: 'piano', source_note_ids: ['short'], start_ms: pass * 2000, duration_ms: 500},
  ]);
  const timeline = {notes, duration_ms: 4000};
  const response = {version: 1, source_measure_count: 2, duration_ms: 4000, occurrences,
    sounding_groups: notes.map(n => ({occurrence_id: n.id, part_id: n.part_id, source_note_ids: n.source_note_ids, start_ms: n.start_ms, end_ms: n.start_ms + n.duration_ms})), diagnostics: []};
  const cursor = {version: 1, source_note_ids: ['short', 'tie-start', 'rest', 'tie-stop'], spans: []};
  for (let pass = 0; pass < 2; pass++) {
    const offset = pass * 2000, measure = pass * 2;
    for (const [source, occurrence, from, to] of [[1, measure, 0, 1000], [0, measure, 0, 500], [2, measure, 500, 1000], [3, measure + 1, 1000, 2000], [2, measure + 1, 1000, 1500]]) {
      cursor.spans.push({source_note_index: source, measure_occurrence_index: occurrence, start_ms: offset + from, end_ms: offset + to});
    }
  }
  return {score, timeline, response, cursor};
}
const make = data => new WrittenCursorIndex(data.cursor, new NotationNavigationIndex(data.response, data.score, data.timeline));
const ids = (index, at) => index.at(at).entries.map(e => e.sourceNoteId).sort();

test('written cursor marks only the current tie segment and retains chord/rest/repeat identities', () => {
  const data = setup(), before = structuredClone(data), index = make(data);
  assert.deepEqual(ids(index, 0), ['short', 'tie-start']);
  assert.deepEqual(ids(index, 500), ['rest', 'tie-start']);
  assert.deepEqual(ids(index, 1000), ['rest', 'tie-stop']);
  assert.deepEqual(ids(index, 1500), ['tie-stop']);
  assert.deepEqual(ids(index, 2000), ['short', 'tie-start']);
  assert.equal(index.at(2000).occurrence.repeat_pass, 2);
  assert.equal(index.at(1000).entries[0].sourceMeasureIndex, 1);
  for (const at of [-1, 4000, 5000, NaN, Infinity]) assert.deepEqual(index.at(at), {occurrence: null, entries: []});
  assert.deepEqual(data, before);
});

test('written cursor refuses incomplete, duplicated, stale, out-of-bounds or unknown-version mappings', () => {
  for (const mutate of [d => d.cursor = null, d => d.cursor.version = 2, d => d.cursor.source_note_ids.pop(),
    d => d.cursor.source_note_ids[0] = 'other', d => d.cursor.source_note_ids[0] = 'rest',
    d => d.cursor.spans.pop(), d => d.cursor.spans.push({...d.cursor.spans[0]}),
    d => d.cursor.spans[0].source_note_index = -1, d => d.cursor.spans[0].source_note_index = 1.5,
    d => d.cursor.spans[0].measure_occurrence_index = 99, d => d.cursor.spans[0].start_ms = 1,
    d => d.cursor.spans[0].end_ms = 999, d => d.cursor.spans[0].end_ms = NaN,
    d => d.cursor.spans[0].end_ms = 1001, d => d.cursor.spans[0].start_ms = -1]) {
    const data = setup(); mutate(data); assert.throws(() => make(data), /Written-note following/);
  }
});

test('span array order is not a timing contract and no per-frame tempo reconstruction is needed', () => {
  const data = setup(); data.cursor.spans.reverse(); const index = make(data);
  assert.deepEqual(ids(index, 500), ['rest', 'tie-start']);
  assert.deepEqual(ids(index, 3000), ['rest', 'tie-stop']);
  assert.deepEqual(ids(index, 3500), ['tie-stop']);
});

test('written identity lookup keeps exact Unicode IDs and separate same-pitch voices', () => {
  const data = setup();
  for (const [before, after] of [['short', 'é'], ['tie-start', 'e\u0301']]) {
    data.score.parts[0].notes.find(n => n.id === before).id = after;
    data.cursor.source_note_ids = data.cursor.source_note_ids.map(id => id === before ? after : id);
    for (const occurrence of data.response.occurrences) occurrence.written_note_ids = occurrence.written_note_ids.map(id => id === before ? after : id);
    for (const note of data.timeline.notes) note.source_note_ids = note.source_note_ids.map(id => id === before ? after : id);
    for (const group of data.response.sounding_groups) group.source_note_ids = group.source_note_ids.map(id => id === before ? after : id);
  }
  data.score.parts[0].notes.find(n => n.id === 'é').pitch = {step: 'C', alter: 0, octave: 4};
  const index = make(data);
  assert.deepEqual(ids(index, 0), ['e\u0301', 'é']);
  assert.deepEqual(ids(index, 750), ['e\u0301', 'rest']);
});

test('cursor preparation is lazy and cached without turning on page following or moving playback', async () => {
  const data = setup(), calls = [], statuses = [];
  const cursor = setupWrittenCursor({getContext: () => data, onStatus: value => statuses.push(value),
    api: (path, body, signal) => new Promise(resolve => calls.push({path, body, signal, resolve}))});
  assert.equal(calls.length, 0); assert.equal(cursor.at(0), null);
  const first = cursor.prepare(), second = cursor.prepare();
  assert.equal(first, second); assert.equal(calls.length, 1);
  assert.equal(calls[0].path, '/api/notation-navigation'); assert.equal(calls[0].body, data.score);
  calls[0].resolve({...data.response, written_cursor: data.cursor}); await first;
  assert.equal(cursor.state().status, 'ready'); assert.equal(cursor.at(1000).entries.length, 2);
  await cursor.prepare(); assert.equal(calls.length, 1);
  assert.equal(statuses.at(-1).status, 'ready');
  cursor.reset(); assert.equal(cursor.at(1000), null);
});

test('replaced score or cancelled cursor preparation cannot publish stale IDs', async () => {
  let data = setup(); const old = data, calls = [];
  const cursor = setupWrittenCursor({getContext: () => data, api: (_path, _body, signal) => new Promise(resolve => calls.push({signal, resolve}))});
  const first = cursor.prepare(); data = setup(); const second = cursor.prepare();
  assert.equal(calls[0].signal.aborted, true);
  calls[0].resolve({...old.response, written_cursor: old.cursor}); await first;
  assert.equal(cursor.at(0), null); assert.equal(cursor.state().status, 'loading');
  cursor.reset(); calls[1].resolve({...data.response, written_cursor: data.cursor}); await second;
  assert.equal(cursor.state().status, 'idle'); assert.equal(cursor.at(0), null);
});

test('unsupported cursor keeps static notation available and needs explicit retry', async () => {
  const data = setup(); let calls = 0;
  const cursor = setupWrittenCursor({getContext: () => data, api: async () => {
    calls++; return calls === 1 ? {...data.response, diagnostics: [{code: 'notation_written_cursor_unavailable', message: 'Complete cursor exceeds its limit.'}]} : {...data.response, written_cursor: data.cursor};
  }});
  await cursor.prepare(); assert.equal(cursor.state().status, 'unavailable');
  assert.match(cursor.state().message, /Complete cursor exceeds/); assert.equal(cursor.at(0), null);
  await cursor.prepare(); assert.equal(calls, 1);
  await cursor.prepare({retry: true}); assert.equal(calls, 2); assert.equal(cursor.state().status, 'ready');
});

test('a synchronous request failure does not strand the explicit retry', async () => {
  const data = setup(); let calls = 0;
  const cursor = setupWrittenCursor({getContext: () => data, api: () => {
    if (++calls === 1) throw Error('Local request unavailable');
    return {...data.response, written_cursor: data.cursor};
  }});
  await cursor.prepare(); assert.equal(cursor.state().status, 'unavailable');
  await cursor.prepare({retry: true}); assert.equal(cursor.state().status, 'ready'); assert.equal(calls, 2);
});

function nativeSetup() {
  const data = setup();
  data.nativeRuntime = {compilation: {score: data.score, timeline: data.timeline, diagnostics: []},
    navigation: {...data.response, written_cursor: data.cursor}};
  return data;
}

test('actual authored fractional Rust runtime follows exactly while its ordinary BPM map is rejected', async () => {
  const fixture = JSON.parse(readFileSync(new URL('./fixtures/clean-midi-fractional-navigation.json', import.meta.url), 'utf8'));
  const runtime = fixture.runtime, {score, timeline} = runtime.compilation, before = JSON.stringify(runtime);
  assert.deepEqual(score, fixture.complete_score.notation);
  assert.throws(() => new NotationNavigationIndex(fixture.ordinary_navigation, score, timeline), {code: 'notation_followInvalid'});
  const data = {score, timeline, nativeRuntime: runtime};
  const cursor = setupWrittenCursor({getContext: () => data, api: () => assert.fail('Fractional MIDI must use its admitted native clock')});
  await cursor.prepare(); assert.equal(cursor.state().status, 'ready');
  for (const note of runtime.notes) {
    const written = cursor.at(note.start_ms);
    assert.deepEqual(written.entries.map(entry => entry.sourceNoteId), [note.note_id]);
    assert.equal(written.entries[0].startMs, note.start_ms); assert.equal(written.entries[0].endMs, note.end_ms);
    assert.deepEqual(cursor.pageAnchor(note.start_ms, note.part_id), written.entries[0].note.at);
    assert.equal(basicNotationPage(written.occurrence, written.entries, note.part_id, 4, cursor.pageAnchor(note.start_ms, note.part_id)), 0);
    assert.ok(!cursor.at(note.end_ms).entries.some(entry => entry.sourceNoteId === note.note_id));
  }
  assert.equal(JSON.stringify(runtime), before);
  data.nativeRuntime = {...runtime, navigation: fixture.ordinary_navigation};
  assert.equal(cursor.navigation(), null); await cursor.prepare(); assert.equal(cursor.state().status, 'unavailable');
});

test('bound native navigation uses the strict indexes without a score API request', async () => {
  const data = nativeSetup(), before = JSON.stringify(data);
  const cursor = setupWrittenCursor({getContext: () => data, api: () => assert.fail('Native timing must not be recompiled')});
  await cursor.prepare();
  assert.equal(cursor.state().status, 'ready');
  assert.ok(cursor.navigation() instanceof NotationNavigationIndex);
  assert.deepEqual(ids(await cursor.prepare(), 1000), ['rest', 'tie-stop']);
  assert.deepEqual(cursor.pageAnchor(1500, 'piano'), beat(2));
  assert.equal(JSON.stringify(data), before);
});

test('bounded native responses retain strict measure following when optional cursor absence is diagnosed', async () => {
  for (const omitted of [false, true]) {
    const data = nativeSetup(), response = data.nativeRuntime.navigation;
    response.written_cursor = null;
    if (omitted) delete response.written_cursor;
    response.diagnostics.push({code: 'notation_written_cursor_unavailable', message: 'Complete cursor exceeds its bound; measure following remains available.'});
    const cursor = setupWrittenCursor({getContext: () => data, api: () => assert.fail('Bounded native maps cannot fall back to BPM')});
    await cursor.prepare();
    assert.equal(cursor.state().status, 'unavailable'); assert.match(cursor.state().message, /exceeds its bound/);
    assert.ok(cursor.navigation() instanceof NotationNavigationIndex);
    assert.equal(cursor.navigation().at(1000).source_measure_index, 1);
    assert.equal(cursor.at(1000), null); assert.equal(cursor.pageAnchor(1000), null);
  }
});

test('a cursor-unavailable diagnostic cannot admit a malformed supplied cursor or invalid measure map', async () => {
  for (const mutate of [
    d => d.nativeRuntime.navigation.written_cursor.source_note_ids[0] = 'other',
    d => d.nativeRuntime.navigation.written_cursor.spans[0].end_ms -= 1e-10,
    d => d.nativeRuntime.navigation.written_cursor = false,
    d => {d.nativeRuntime.navigation.written_cursor = null; d.nativeRuntime.navigation.sounding_groups[0].end_ms += 1e-10;},
  ]) {
    const data = nativeSetup();
    data.nativeRuntime.navigation.diagnostics.push({code: 'notation_written_cursor_unavailable', message: 'Cursor omitted.'});
    mutate(data);
    const cursor = setupWrittenCursor({getContext: () => data, api: () => assert.fail('Invalid native maps cannot fall back')});
    await cursor.prepare();
    assert.equal(cursor.state().status, 'unavailable'); assert.equal(cursor.navigation(), null); assert.equal(cursor.at(0), null);
  }
});

test('native navigation rejects missing maps, stale identity and exact clock/ID mismatches without fallback', async () => {
  for (const mutate of [
    d => delete d.nativeRuntime.navigation, d => d.nativeRuntime.navigation = null,
    d => d.nativeRuntime.compilation.score = structuredClone(d.score),
    d => d.nativeRuntime.compilation.timeline = structuredClone(d.timeline),
    d => d.nativeRuntime.navigation.duration_ms += 1e-10,
    d => d.nativeRuntime.navigation.sounding_groups[0].end_ms += 1e-10,
    d => d.nativeRuntime.navigation.sounding_groups[0].source_note_ids = ['other'],
    d => d.nativeRuntime.navigation.occurrences[0].written_note_ids = ['other'],
    d => d.nativeRuntime.navigation.written_cursor.source_note_ids[0] = 'other',
    d => d.nativeRuntime.navigation.written_cursor.spans[0].end_ms -= 1e-10,
    d => d.nativeRuntime.navigation.written_cursor = null,
  ]) {
    const data = nativeSetup(); mutate(data);
    const cursor = setupWrittenCursor({getContext: () => data, api: () => assert.fail('Invalid native maps cannot use the legacy API')});
    await cursor.prepare();
    assert.equal(cursor.state().status, 'unavailable');
    assert.equal(cursor.navigation(), null); assert.equal(cursor.at(0), null); assert.equal(cursor.pageAnchor(0), null);
    await cursor.prepare({retry: true}); assert.equal(cursor.state().status, 'unavailable');
  }
});

test('native source, timeline and map replacement invalidate every cached read immediately', async () => {
  for (const replace of [
    d => ({...d, score: structuredClone(d.score)}),
    d => ({...d, timeline: structuredClone(d.timeline)}),
    d => ({...d, nativeRuntime: {...d.nativeRuntime, navigation: null}}),
    d => {d.nativeRuntime.navigation = null; return d;},
    () => ({score: null, timeline: null}),
  ]) {
    let data = nativeSetup();
    const cursor = setupWrittenCursor({getContext: () => data, api: () => assert.fail('A replaced native map cannot fall back')});
    await cursor.prepare(); assert.equal(cursor.state().status, 'ready');
    data = replace(data);
    assert.equal(cursor.navigation(), null); assert.equal(cursor.at(0), null); assert.equal(cursor.pageAnchor(0), null);
    await cursor.prepare();
    assert.equal(cursor.state().status, data.score ? 'unavailable' : 'idle');
  }
});

test('late legacy replies and queued native preparation cannot cross a score replacement or clear', async () => {
  let data = setup(); const old = data, calls = [];
  const cursor = setupWrittenCursor({getContext: () => data, api: (path, score, signal) => new Promise(resolve => calls.push({path, score, signal, resolve}))});
  const legacy = cursor.prepare(); data = nativeSetup();
  await cursor.prepare(); assert.equal(cursor.state().status, 'ready'); assert.equal(calls[0].signal.aborted, true);
  const current = cursor.navigation(); calls[0].resolve({...old.response, written_cursor: old.cursor}); await legacy;
  assert.equal(cursor.navigation(), current); assert.equal(calls.length, 1);
  cursor.reset(); const native = cursor.prepare(); data = {score: null, timeline: null}; await cursor.prepare(); await native;
  assert.equal(cursor.state().status, 'idle'); assert.equal(cursor.navigation(), null); assert.equal(cursor.at(0), null);
  data = setup(); const ordinary = cursor.prepare();
  assert.equal(calls[1].path, '/api/notation-navigation'); assert.equal(calls[1].score, data.score);
  calls[1].resolve({...data.response, written_cursor: data.cursor}); await ordinary;
  assert.equal(cursor.state().status, 'ready'); assert.equal(calls.length, 2);
});
