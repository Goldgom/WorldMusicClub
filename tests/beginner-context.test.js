import test from 'node:test';
import assert from 'node:assert/strict';
import {beginnerScoreKey} from '../web/beginner-view.js';
import {resolveBeginnerContext} from '../web/beginner-notes.js';

const rational = (numerator, denominator = 1) => ({numerator, denominator});
const key = (numerator, fifths, mode = 'major', denominator = 1) => ({at: rational(numerator, denominator), fifths, mode});
const written = (from, to, denominator = 1) => ({occurrence: {source_from: rational(from, denominator), source_to: rational(to, denominator)}, entries: []});

test('a constant explicit score key is provable without a running cursor, but missing keys stay explicit', () => {
  const score = {keys: [key(0, -3, 'minor'), key(4, -3, 'minor')]};
  const before = structuredClone(score);
  assert.deepEqual(beginnerScoreKey(score), {key: score.keys[0], keyStatus: 'known'});
  assert.deepEqual(beginnerScoreKey(null), {key: null, keyStatus: 'missing'});
  assert.deepEqual(beginnerScoreKey({keys: []}), {key: null, keyStatus: 'missing'});
  assert.deepEqual(score, before);
});

test('Rust half-open source occurrences resolve boundary changes and repeat returns exactly', () => {
  const score = {keys: [key(0, 0), key(4, 2), key(8, -1)]};
  assert.equal(beginnerScoreKey(score, written(0, 4)).key, score.keys[0]);
  assert.equal(beginnerScoreKey(score, written(4, 8)).key, score.keys[1]);
  assert.equal(beginnerScoreKey(score, written(8, 12)).key, score.keys[2]);
  assert.equal(beginnerScoreKey(score, written(0, 4)).key, score.keys[0], 'Repeats use source position, not elapsed order');
  assert.deepEqual(beginnerScoreKey(score), {key: null, keyStatus: 'unresolved'});
});

test('interior rational key changes remain unresolved even with a plausible sounding note or page anchor', () => {
  const score = {keys: [key(0, 0), key(1, 2, 'major', 3), key(8, -1)]};
  const cursor = {...written(0, 4), pageAnchor: rational(2), entries: [{note: {at: rational(2)}, startMs: 800}]};
  const context = beginnerScoreKey(score, cursor);
  assert.deepEqual(context, {key: null, keyStatus: 'unresolved'});
  assert.equal(resolveBeginnerContext({numberedMode: 'movable', ...context}).fallback, 'unresolved-key');
  assert.equal(beginnerScoreKey(score, written(1, 12, 3)).key, score.keys[1], 'An exact rational change at source_from belongs to this occurrence');
  assert.equal(beginnerScoreKey(score, written(0, 1, 3)).key, score.keys[0], 'A change at source_to belongs to the next occurrence');
});

test('late first declarations and unsupported keys cannot silently become a claimed C-major score key', () => {
  const late = {keys: [key(4, 2)]};
  assert.deepEqual(beginnerScoreKey(late, written(0, 4)), {key: null, keyStatus: 'missing'});
  const unsupported = {keys: [key(0, 0, 'dorian')]};
  const context = resolveBeginnerContext({numberedMode: 'movable', ...beginnerScoreKey(unsupported)});
  assert.equal(context.fallback, 'unsupported-key');
  assert.equal(context.referenceMidi, 60);
});
