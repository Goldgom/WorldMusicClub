import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {lstatSync, readFileSync, writeFileSync} from 'node:fs';
import {join, resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {inflateSync} from 'node:zlib';
import {PROGRESSION_CASES, PROGRESSION_REPORTS, assertProgressionReport} from '../tests/progression-browser-proof.js';

const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
function pngDimensions(bytes){
  assert.ok(bytes.length>=45&&bytes.subarray(0,8).equals(Buffer.from('89504e470d0a1a0a','hex')),'Expected retained PNG pixels');
  assert.equal(bytes.readUInt32BE(8),13);assert.equal(bytes.toString('ascii',12,16),'IHDR');
  const width=bytes.readUInt32BE(16),height=bytes.readUInt32BE(20),channels=bytes[25]===2?3:bytes[25]===6?4:0;
  assert.ok(width>0&&height>0&&width<=4096&&height<=4096&&width*height<=8*1024*1024,'Finite PNG pixel budget');
  assert.equal(bytes[24],8);assert.ok(channels);for(const offset of [26,27,28])assert.equal(bytes[offset],0);
  const chunks=[];let offset=8,ended=false;
  while(offset<bytes.length){assert.ok(offset+12<=bytes.length);const length=bytes.readUInt32BE(offset),type=bytes.toString('ascii',offset+4,offset+8);assert.ok(length<=bytes.length-offset-12);if(type==='IDAT')chunks.push(bytes.subarray(offset+8,offset+8+length));offset+=length+12;if(type==='IEND'){assert.equal(length,0);ended=true;break;}}
  assert.ok(ended&&chunks.length);assert.equal(offset,bytes.length);
  const stride=width*channels+1,raw=inflateSync(Buffer.concat(chunks),{maxOutputLength:stride*height});assert.equal(raw.length,stride*height);for(let y=0;y<height;y++)assert.ok(raw[y*stride]<=4);
  return{width,height};
}

export function verifyProgressionPreview(directory, {sha, tree, serverSha256}) {
  const root = lstatSync(directory); assert.ok(root.isDirectory() && !root.isSymbolicLink());
  const read = (name, limit) => {
    assert.ok(/^[a-z0-9.-]+$/.test(name)); const path = join(directory, name), stat = lstatSync(path);
    assert.ok(stat.isFile() && !stat.isSymbolicLink() && stat.size > 0 && stat.size <= limit, `${name}: bounded ordinary evidence required`);
    const bytes = readFileSync(path); assert.equal(bytes.length, stat.size); return bytes;
  };
  const tap = read('tests.tap', 2 * 1024 * 1024), text = new TextDecoder('utf-8', {fatal: true}).decode(tap);
  assert.ok(!/^Bail out!/im.test(text));
  const rows = text.split('\n').filter(line => /^(?:not )?ok \d+ - /.test(line));
  assert.equal(rows.length, PROGRESSION_CASES.length, 'Exactly the focused executed browser cases are required');
  for (const name of PROGRESSION_CASES) {
    const found = rows.filter(line => line.replace(/^(?:not )?ok \d+ - /, '').split(/\s+#/)[0] === name);
    assert.ok(found.length === 1 && /^ok \d+ - /.test(found[0]) && !/\s+#\s*(?:SKIP|TODO)\b/i.test(found[0]), 'Executed passing progression case required: ' + name);
  }
  const record = (name, bytes) => ({name, bytes: bytes.length, sha256: digest(bytes)}), files = [record('tests.tap', tap)];
  for (const [index, name] of PROGRESSION_REPORTS.entries()) {
    const bytes = read(name, 8 * 1024 * 1024), report = assertProgressionReport(JSON.parse(new TextDecoder('utf-8', {fatal: true}).decode(bytes)), index);
    assert.deepEqual(report.source, {sha, tree, server_sha256: serverSha256}, 'Exact clean source and Rust server binary must match independently');
    files.push(record(name, bytes));
    for (const shot of report.screenshots) {
      const png = read(shot.name, 8 * 1024 * 1024), actual = {...record(shot.name, png), ...pngDimensions(png)};
      assert.deepEqual(actual, shot, 'Retained screenshot bytes and viewport must match'); files.push(actual);
    }
  }
  return {version: 1, scope: 'Hosted actual Rust canonical source, Chromium controls, trusted pointer input and AudioWorklet output only; Original DTO limit is fault-injected on a tiny original source', source: {sha, tree, server_sha256: serverSha256}, cases: PROGRESSION_CASES, original_fixtures_only: true, physical_audio_verified: false, physical_midi_verified: false, windows_native_verified: false, accepted_package: false, files};
}
if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  const directory = resolve(process.argv[2] || 'progression-preview'), git = (...args) => execFileSync('git', args, {encoding: 'utf8'}).trim(), sha = git('rev-parse', 'HEAD');
  assert.equal(sha, process.env.WMH_SOURCE_SHA || process.env.GITHUB_SHA, 'Exact-source focused workflow required');
  assert.equal(git('status', '--porcelain', '--untracked-files=normal'), '', 'Independent verifier requires clean source');
  assert.ok(process.env.WMH_SERVER_BINARY, 'Exact-source server binary required');
  const manifest = verifyProgressionPreview(directory, {sha, tree: git('rev-parse', 'HEAD^{tree}'), serverSha256: digest(readFileSync(process.env.WMH_SERVER_BINARY))});
  writeFileSync(join(directory, 'worldmusichub-progression-manifest.json'), JSON.stringify(manifest, null, 2));
  console.log('Verified exact Rust hierarchy, visible controls, trusted human input, real worklet complement, reset and durable Off, with both viewport pixels. Native Windows and physical audio remain unverified.');
}
