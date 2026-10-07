import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync, mkdtempSync, rmSync, writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {pitchModOriginal, PITCH_MOD_CASES, assertC4Projection, assertPitchModReport, assertPitchMachineAudio} from './pitch-mod-browser-proof.js';
import {verifyPitchModPreview} from '../scripts/verify-pitch-mod-preview.mjs';

test('pitch acceptance uses only its seven self-authored C4 sources with independent human and machine IDs', () => {
  const score = pitchModOriginal();
  assert.equal(score.provenance.kind, 'original_exercise'); assert.equal(score.provenance.license, 'CC0-1.0');
  assert.deepEqual(score.parts.map(part => part.id), ['human', 'machine']);
  assert.deepEqual(score.parts.map(part => part.notes.map(note => note.at)), [
    [4, 8, 12].map(numerator => ({numerator, denominator: 1})),
    [0, 4, 8, 12].map(numerator => ({numerator, denominator: 1})),
  ]);
  for (const note of score.parts.flatMap(part => part.notes)) assert.deepEqual(note.pitch, {step: 'C', alter: 0, octave: 4});
});

test('pitch browser proof rejects a status-only report and fabricated missing Rust/audio evidence', () => {
  for (const report of [{ok: true}, {version: 1, ok: true, case: PITCH_MOD_CASES[0], source: {}}]) assert.throws(() => assertPitchModReport(report, 0));
  assert.throws(() => assertC4Projection({configuration: {format: 'wmc-pitch-mod', version: 1, semitones: 2}, compilation: {score: pitchModOriginal(), timeline: {notes: []}}, source_pitches: []}));
  assert.throws(() => assertPitchMachineAudio({runs: []}, {}));
});

test('retained pitch proof refuses missing or skipped hosted cases before trusting report claims', () => {
  const directory = mkdtempSync(join(tmpdir(), 'wmc-pitch-proof-rejection-'));
  try {
    for (const tap of ['', 'ok 1 - unrelated\n', PITCH_MOD_CASES.map((name, index) => `ok ${index + 1} - ${name} # SKIP never run`).join('\n')]) {
      writeFileSync(join(directory, 'tests.tap'), tap);
      assert.throws(() => verifyPitchModPreview(directory, {sha: 'a'.repeat(40), tree: 'b'.repeat(40), serverSha256: 'c'.repeat(64)}));
    }
  } finally { rmSync(directory, {recursive: true}); }
});

test('pitch browser lane is exact-source hosted only and retains actual server response pixels and PCM', () => {
  const read = name => readFileSync(new URL('../' + name, import.meta.url), 'utf8');
  const browser = read('tests/pitch-mod-app-browser.test.js'), workflow = read('.github/workflows/pitch-mod-preview.yml');
  for (const token of ["process.env.GITHUB_ACTIONS", 'await route.fetch()', 'route.fulfill({response: actual})', 'setInputFiles', 'canonicalPreviewAudioBootstrap', 'readCanonicalPreviewAudio', "page.keyboard.press('KeyS')", "keyboard-semitone-up", 'page.screenshot']) assert.ok(browser.includes(token), token);
  for (const forbidden of ['dispatchEvent(', 'force: true', 'page.setContent(', 'installLoopClockFixture']) assert.equal(browser.includes(forbidden), false, forbidden);
  for (const token of ["node-version: '22.23.3'", "toolchain: '1.99.0'", 'WMH_SOURCE_SHA: ${{ github.sha }}', 'tests/pitch-mod-app-browser.test.js', 'verify-pitch-mod-preview.mjs', 'if: always()']) assert.ok(workflow.includes(token), token);
  assert.equal(workflow.includes('releases:'), false); assert.equal(workflow.includes('branches: [main]'), false);
});
