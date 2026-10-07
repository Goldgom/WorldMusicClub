import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {lstatSync, readFileSync, writeFileSync} from 'node:fs';
import {join, resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {passivePngPixels} from './native-passive-capture-evidence.mjs';
const pngDimensions = bytes => { const {width, height} = passivePngPixels(bytes); return {width, height}; };
import {PITCH_MOD_CASES, PITCH_MOD_REPORTS, assertPitchModReport} from '../tests/pitch-mod-browser-proof.js';

const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
export function verifyPitchModPreview(directory, {sha, tree, serverSha256}) {
  const root = lstatSync(directory); assert.ok(root.isDirectory() && !root.isSymbolicLink());
  const read = (name, limit) => {
    assert.ok(/^[a-z0-9.-]+$/.test(name)); const path = join(directory, name), stat = lstatSync(path);
    assert.ok(stat.isFile() && !stat.isSymbolicLink() && stat.size > 0 && stat.size <= limit, `${name}: bounded ordinary evidence required`);
    const bytes = readFileSync(path); assert.equal(bytes.length, stat.size); return bytes;
  };
  const tap = read('tests.tap', 2 * 1024 * 1024), text = new TextDecoder('utf-8', {fatal: true}).decode(tap);
  assert.ok(!/^Bail out!/im.test(text));
  const rows = text.split('\n').filter(line => /^(?:not )?ok \d+ - /.test(line));
  assert.equal(rows.length, PITCH_MOD_CASES.length, 'Exactly the focused executed browser cases are required');
  for (const name of PITCH_MOD_CASES) {
    const found = rows.filter(line => line.replace(/^(?:not )?ok \d+ - /, '').split(/\s+#/)[0] === name);
    assert.ok(found.length === 1 && /^ok \d+ - /.test(found[0]) && !/\s+#\s*(?:SKIP|TODO)\b/i.test(found[0]), 'Executed passing pitch Mod case required: ' + name);
  }
  const record = (name, bytes) => ({name, bytes: bytes.length, sha256: digest(bytes)}), files = [record('tests.tap', tap)];
  for (const [index, name] of PITCH_MOD_REPORTS.entries()) {
    const bytes = read(name, 8 * 1024 * 1024), report = assertPitchModReport(JSON.parse(new TextDecoder('utf-8', {fatal: true}).decode(bytes)), index);
    assert.deepEqual(report.source, {sha, tree, server_sha256: serverSha256}, 'Exact clean source and Rust server binary must match independently');
    files.push(record(name, bytes));
    for (const shot of report.screenshots) {
      const png = read(shot.name, 8 * 1024 * 1024), actual = {...record(shot.name, png), ...pngDimensions(png)};
      assert.deepEqual(actual, shot, 'Retained screenshot bytes and viewport must match'); files.push(actual);
    }
  }
  return {version: 1, scope: 'Hosted actual Rust original canonical C4 projection, Chromium controls, independent keyboard transpose and actual AudioWorklet ledger/PCM; lifecycle fault is a delayed real Rust response', source: {sha, tree, server_sha256: serverSha256}, cases: PITCH_MOD_CASES, original_fixtures_only: true, physical_audio_verified: false, physical_midi_verified: false, windows_native_verified: false, accepted_package: false, files};
}
if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  const directory = resolve(process.argv[2] || 'pitch-mod-preview'), git = (...args) => execFileSync('git', args, {encoding: 'utf8'}).trim(), sha = git('rev-parse', 'HEAD');
  assert.equal(sha, process.env.WMH_SOURCE_SHA || process.env.GITHUB_SHA, 'Exact-source focused workflow required');
  assert.equal(git('status', '--porcelain', '--untracked-files=normal'), '', 'Independent verifier requires clean source');
  assert.ok(process.env.WMH_SERVER_BINARY, 'Exact-source server binary required');
  const manifest = verifyPitchModPreview(directory, {sha, tree: git('rev-parse', 'HEAD^{tree}'), serverSha256: digest(readFileSync(process.env.WMH_SERVER_BINARY))});
  writeFileSync(join(directory, 'worldmusichub-pitch-mod-manifest.json'), JSON.stringify(manifest, null, 2));
  console.log('Verified exact-source canonical pitch Mod, real controls and AudioWorklet ledger/PCM. Native Windows, physical MIDI and acoustic audio remain unverified.');
}
