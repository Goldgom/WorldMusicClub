// Original authored clean-package bytes from the committed Rust handler vectors.
// No raw MIDI/VSQ, singer, voicebank, private song, or derived response is imported.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {mkdir, writeFile} from 'node:fs/promises';
import {join, resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {storedZip} from '../tests/native-import-driver-fixtures.js';

export const PITCH_SOURCES_NATIVE_PHASES = Object.freeze(['pitch-sources-seed', 'pitch-sources-restart', 'pitch-sources-zero', 'pitch-sources-zero-restart']);
export const PITCH_SOURCES_NATIVE_FIXTURE = 'pitch-sources-original.wmhpack';
export const PITCH_SOURCES_KINDS = Object.freeze(['basic', 'vsq']);
export const PITCH_SOURCES_HUMAN_PARTS = Object.freeze({basic: 'midi-t1-c1-r0', vsq: 'vsq-track-1'});
const vectorsUrl = new URL('../tests/fixtures/pitch-mod-handler-vectors.json', import.meta.url);
const digest = value => createHash('sha256').update(value).digest('hex');

export function pitchSourcesVectors() {
  const document = JSON.parse(readFileSync(vectorsUrl, 'utf8'));
  assert.equal(document.generator, 'crates/desktop-shell/examples/generate_pitch_mod_fixtures.rs');
  return Object.fromEntries(PITCH_SOURCES_KINDS.map(kind => [kind, document.vectors[kind]]));
}

export function nativePitchSourcesFixture() {
  const vectors = pitchSourcesVectors(), files = new Map(), sources = {};
  for (const kind of PITCH_SOURCES_KINDS) {
    const vector = vectors[kind], opened = vector.original.opened, clean = opened.clean_package;
    const scoreBytes = Buffer.from(clean.score_json), metadataBytes = Buffer.from(clean.metadata_json);
    const metadata = JSON.parse(clean.metadata_json), score = JSON.parse(clean.score_json), folder = `songs/original-pitch-${kind}`;
    assert.equal(metadata.format, 'worldmusichub-song');
    assert.equal(metadata.version, 2);
    assert.equal(metadata.rights.status, 'original_authored');
    assert.equal(metadata.rights.license, 'CC0-1.0');
    assert.equal(metadata.score.path, 'score.json');
    assert.equal(metadata.score.bytes, scoreBytes.length);
    assert.equal(metadata.score.sha256, digest(scoreBytes));
    assert.deepEqual(metadata.media, []);
    assert.deepEqual(clean.media, []);
    assert.deepEqual(score, vector.original.score);
    assert.equal(score.notation.source, null);
    assert.deepEqual(metadata.sources, [score.source]);
    assert.equal(opened.entry.key, `song-${clean.content_sha256}`);
    assert.equal(vector.plus2.source.key, opened.entry.key);
    assert.equal(vector.zero.source.key, opened.entry.key);
    files.set(`${folder}/metadata.json`, metadataBytes);
    files.set(`${folder}/score.json`, scoreBytes);
    sources[kind] = {kind, folder, key: opened.entry.key, metadata, score, opened, vector,
      manifest: {kind, folder, key: opened.entry.key, content_sha256: clean.content_sha256,
        profile: clean.profile, source_sha256: score.source.sha256, rights: metadata.rights,
        semantic_clean_package: true, raw_source_bundled: false}};
  }
  files.set('manifest.json', Buffer.from(JSON.stringify({format: 'worldmusichub-song-pack', version: 2,
    songs: PITCH_SOURCES_KINDS.map(kind => ({folder: sources[kind].folder}))}) + '\n'));
  const bytes = storedZip([...files]);
  assert.ok(bytes.length > 0 && bytes.length <= 128 * 1024, 'Bounded original clean package required');
  const manifest = {version: 1, filename: PITCH_SOURCES_NATIVE_FIXTURE, bytes: bytes.length, sha256: digest(bytes),
    generator: 'tests/fixtures/pitch-mod-handler-vectors.json',
    vectors_sha256: digest(readFileSync(vectorsUrl)), sources: PITCH_SOURCES_KINDS.map(kind => sources[kind].manifest),
    files: [...files].map(([path, data]) => ({path, bytes: data.length, sha256: digest(data)}))};
  return {filename: PITCH_SOURCES_NATIVE_FIXTURE, bytes, files, sources, vectors, manifest};
}

export async function prepareNativePitchSourcesFixture(directory) {
  const fixture = nativePitchSourcesFixture();
  await mkdir(directory, {recursive: true});
  await writeFile(join(directory, fixture.filename), fixture.bytes, {flag: 'wx'});
  await writeFile(join(directory, 'pitch-sources-fixtures.json'), JSON.stringify(fixture.manifest, null, 2) + '\n', {flag: 'wx'});
  return fixture.manifest;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  assert.equal(process.argv.length, 3, 'Usage: node scripts/native-pitch-sources-fixtures.mjs <fresh-directory>');
  console.log(JSON.stringify(await prepareNativePitchSourcesFixture(resolve(process.argv[2]))));
}
