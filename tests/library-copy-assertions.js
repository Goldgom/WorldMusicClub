import assert from 'node:assert/strict';
import {isDeepStrictEqual} from 'node:util';

export function assertAddedLibraryCopies(before, after, expected) {
  assert.equal(new Set(after.map(row => row.key)).size, after.length, 'Saved copies have distinct storage keys');
  for (const row of before) assert.deepEqual(after.find(copy => copy.key === row.key), row, 'Existing identities, metadata and exact sources remain unchanged');
  const added = after.filter(row => !before.some(copy => copy.key === row.key));
  assert.equal(added.length, expected.length, 'Every expected new copy is retained exactly once');
  const unmatched = [...expected];
  for (const {label, score} of added) {
    const index = unmatched.findIndex(entry => isDeepStrictEqual({label, score}, entry));
    assert.notEqual(index, -1, 'Each new copy must match a complete expected score and label, including exact source strings and ordered notes');
    unmatched.splice(index, 1);
  }
  assert.ok(added.every(row => row.revision === 1 && row.key !== row.score.id && row.score_id === row.score.id), 'New copy identities are independent of canonical score IDs');
  return added;
}
