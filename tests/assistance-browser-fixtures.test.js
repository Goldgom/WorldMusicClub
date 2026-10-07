import test from 'node:test';
import assert from 'node:assert/strict';
import {assistanceBrowserFixtures, originalCrossScopeAssistanceScore} from './assistance-browser-fixtures.js';

test('browser acceptance uses the current Rust canonical, Basic and VSQ route fixtures', () => {
  const {canonical, basic, vsq, vsqOpened} = assistanceBrowserFixtures();
  assert.equal(canonical.compilation.score.provenance.kind, 'original_exercise');
  assert.equal(canonical.compilation.score.provenance.license, 'CC0-1.0');
  assert.equal(canonical.compilation.score.parts.length, 1);
  assert.deepEqual(canonical.automatic.checked.coverage.human_target_count, 1);
  assert.deepEqual(canonical.automatic.checked.coverage.machine_occurrence_count, 1);
  assert.equal(new Set(canonical.automatic.checked.source_ownership.map(note => note.part_id)).size, 1);
  assert.equal(basic.source.content_sha256, basic.opened.clean_package.content_sha256);
  assert.equal(vsq.source.content_sha256, vsqOpened.clean_package.content_sha256);
  assert.equal(vsq.narrow_scope.checked.scored_mode_allowed, false);
  assert.ok(vsq.narrow_scope.checked.exclusion_reasons.some(reason => reason.code === 'cross_scope_physical_group'));
  assert.equal(vsq.empty.checked.human_targets.target_count, 0);
});

test('original cross-scope browser input keeps the fixture immutable and forms an exact two-part unison', () => {
  const {canonical} = assistanceBrowserFixtures(), before = JSON.stringify(canonical);
  const score = originalCrossScopeAssistanceScore(canonical);
  assert.equal(JSON.stringify(canonical), before);
  assert.equal(score.parts.length, 2);
  assert.notEqual(score.parts[0].id, score.parts[1].id);
  const [a, b] = score.parts.map(part => part.notes[0]);
  assert.notEqual(a.id, b.id); assert.deepEqual(a.at, b.at); assert.deepEqual(a.pitch, b.pitch);
  assert.deepEqual(score.provenance, canonical.compilation.score.provenance);
});
