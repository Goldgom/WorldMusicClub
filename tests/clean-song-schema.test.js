import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import Ajv2020 from 'ajv/dist/2020.js';
const read = path => readFileSync(new URL(path, import.meta.url));
const json = path => JSON.parse(read(path));
const ajv = new Ajv2020({ strict: true, allErrors: true });
ajv.addSchema(json('../schema/worldmusichub-score-v1.schema.json'));
const validate = ajv.compile(json('../schema/worldmusichub-complete-score-v1.schema.json'));
const fixture = json('./fixtures/clean-song-v2/score.json');
const runtime = json('./fixtures/clean-song-v2-runtime.json');
test('authored all-track fixture is structurally valid and metadata binds exact score bytes', () => {
  assert.equal(validate(fixture), true, ajv.errorsText(validate.errors));
  const metadata = json('./fixtures/clean-song-v2/metadata.json');
  const bytes = read('./fixtures/clean-song-v2/score.json');
  assert.equal(metadata.score.bytes, bytes.length);
  assert.equal(metadata.score.sha256, createHash('sha256').update(bytes).digest('hex'));
  assert.deepEqual(metadata.sources, [fixture.source]);
  assert.deepEqual(metadata.media, []);
  assert.equal(fixture.performance.tracks.length, 3);
  assert.equal(fixture.notation.parts.length, 2);
  assert.equal(fixture.notation.source, null);
});
test('raw source content, unknown command payloads, invalid performance numbers and newer profiles fail', () => {
  for (const change of [
    f => { f.notation.source = { format: 'midi-base64', content: 'TVRoZA==' }; },
    f => { f.performance.events[0].command.data = [1, 2, 3]; },
    f => { f.performance.events[0].command = { kind: 'unknown', data: [1] }; },
    f => { f.performance.parts[0].channel = 9; },
    f => { f.performance.notes[0].release_velocity = 128; },
    f => { f.performance.profile = 'future-semantic-profile'; },
  ]) {
    const changed = structuredClone(fixture); change(changed);
    assert.equal(validate(changed), false, 'unsupported structure must not be accepted');
  }
});
test('runtime fixture preserves every complete-source event identity and exact duration', () => {
  const coordinates = new Set(runtime.events.map(event => `${event.origin.track}:${event.origin.event}`));
  for (const note of runtime.notes) {
    coordinates.add(`${note.attack.track}:${note.attack.event}`);
    coordinates.add(`${note.release.track}:${note.release.event}`);
    const canonical = runtime.compilation.timeline.notes.find(n => n.id === note.note_id);
    assert.equal(canonical.start_ms, note.start_ms);
    assert.equal(canonical.duration_ms, note.end_ms - note.start_ms);
  }
  assert.equal(coordinates.size, 25);
  assert.equal(runtime.duration_ms, 1800);
  assert.deepEqual(runtime.duration_microseconds, { numerator: '1800000', denominator: 1 });
});
test('long authored interaction fixture has continuing two-part music for 32 seconds', () => {
  const long = json('./fixtures/clean-song-v2-long/score.json');
  const playback = json('./fixtures/clean-song-v2-long-runtime.json');
  const metadata = json('./fixtures/clean-song-v2-long/metadata.json');
  const bytes = read('./fixtures/clean-song-v2-long/score.json');
  assert.equal(validate(long), true, ajv.errorsText(validate.errors));
  assert.equal(metadata.score.sha256, createHash('sha256').update(bytes).digest('hex'));
  assert.equal(metadata.score.bytes, bytes.length);
  assert.equal(long.coverage.source_tracks, 3);
  assert.equal(long.coverage.pitched_notes, 30);
  assert.equal(playback.duration_ms, 32000);
  for (const part of long.performance.parts) {
    assert.ok(playback.notes.some(note => note.part_id === part.id && note.start_ms < 1000));
    assert.ok(playback.notes.some(note => note.part_id === part.id && note.start_ms > 28000));
  }
});
