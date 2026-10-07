import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdir, writeFile} from 'node:fs/promises';
import {join, resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {pitchModOriginal} from '../tests/pitch-mod-browser-proof.js';
export const PITCH_MOD_NATIVE_PHASES = Object.freeze(['pitch-mod-seed', 'pitch-mod-restart']);
export const PITCH_MOD_NATIVE_FIXTURE = 'pitch-mod-original-c4.json';
export function nativePitchModFixture() {
  const score = pitchModOriginal(), bytes = Buffer.from(JSON.stringify(score, null, 2) + '\n');
  return {score, bytes, manifest: {version: 1, filename: PITCH_MOD_NATIVE_FIXTURE, bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex'), rights: score.provenance}};
}
export async function prepareNativePitchModFixture(directory) {
  const fixture = nativePitchModFixture(); await mkdir(directory, {recursive: true});
  await writeFile(join(directory, PITCH_MOD_NATIVE_FIXTURE), fixture.bytes, {flag: 'wx'});
  await writeFile(join(directory, 'pitch-mod-fixtures.json'), JSON.stringify(fixture.manifest, null, 2) + '\n', {flag: 'wx'});
  return fixture.manifest;
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  assert.equal(process.argv.length, 3); console.log(JSON.stringify(await prepareNativePitchModFixture(resolve(process.argv[2]))));
}
