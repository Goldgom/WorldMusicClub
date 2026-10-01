import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture} from './frontend-fixtures.js';
import {prepareScoreDownload, SCORE_DOWNLOAD_LIMIT} from '../web/score-download.js';

test('small canonical downloads retain readable JSON and exact Unicode source contents', () => {
  const score = structuredClone(fixture);
  score.source = {format:'musicxml', filename:'original.musicxml', content:'\uFEFF<score>原谱 🎵\r\n</score>'};
  const before = structuredClone(score), result = prepareScoreDownload(score);
  assert.equal(result.formatting, 'indented');
  assert.equal(result.reimportable, true);
  assert.equal(result.text, JSON.stringify(score, null, 2));
  assert.equal(result.bytes, Buffer.byteLength(result.text));
  assert.deepEqual(JSON.parse(result.text), before);
  assert.deepEqual(score, before);
});

test('a long accepted score stays reimportable when indentation alone would exceed 8 MiB', () => {
  const score = structuredClone(fixture), original = score.parts[0].notes[0];
  score.parts[0].notes = Array.from({length:20_000}, (_, index) => ({...structuredClone(original), id:`long-${index}`, at:{numerator:index,denominator:1}}));
  score.measures = Array.from({length:5_000}, (_, index) => ({number:index+1,at:{numerator:index*4,denominator:1},length:{numerator:4,denominator:1}}));
  const compact = JSON.stringify(score);
  assert.ok(Buffer.byteLength(compact) < SCORE_DOWNLOAD_LIMIT);
  assert.ok(Buffer.byteLength(JSON.stringify(score, null, 2)) > SCORE_DOWNLOAD_LIMIT, 'The old unconditional pretty export could not be imported again');
  const result = prepareScoreDownload(score);
  assert.equal(result.formatting, 'compact');
  assert.equal(result.reimportable, true);
  assert.equal(result.text, compact);
  assert.ok(result.bytes <= SCORE_DOWNLOAD_LIMIT);
  assert.deepEqual(JSON.parse(result.text), score);
  assert.equal(score.parts[0].notes.length, 20_000);
});

test('an already-loaded oversized source stays exportable with an explicit reimport limitation', () => {
  const score = structuredClone(fixture);
  score.source = {format:'retained-text', filename:'original.txt', content:'x'.repeat(SCORE_DOWNLOAD_LIMIT)};
  const result = prepareScoreDownload(score);
  assert.equal(result.reimportable, false);
  assert.equal(result.formatting, 'compact');
  assert.ok(result.bytes > SCORE_DOWNLOAD_LIMIT);
  assert.deepEqual(JSON.parse(result.text), score);
  assert.equal(score.source.content.length, SCORE_DOWNLOAD_LIMIT);
  assert.equal(score.parts[0].notes.length, 2);
  assert.throws(() => prepareScoreDownload(undefined), /No canonical score/);
});
