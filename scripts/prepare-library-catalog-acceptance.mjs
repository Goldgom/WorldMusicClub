// Bounded ORIGINAL inputs only. Preparing these files is not native/browser acceptance.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdir, readdir, writeFile} from 'node:fs/promises';
import {join, resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {authoredLegacyPack, storedZip} from '../tests/native-import-driver-fixtures.js';
import {authoredCleanPackage} from '../tests/clean-song-package-fixtures.js';

export const CATALOG_ACCEPTANCE_PHASES = Object.freeze(['catalog-seed', 'catalog-restart', 'catalog-final']);
export const CATALOG_ACCEPTANCE_FILENAMES = Object.freeze({legacy: 'catalog-original-legacy.zip', shared: 'catalog-original-shared.zip', clean: 'catalog-original-clean.zip'});
export const catalogSha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const fileDigest = (path, bytes) => ({path, bytes: bytes.length, sha256: catalogSha256(bytes)});
const counts = (active, trash, memberships) => ({managed_songs: 3, active_songs: active, trashed_songs: trash, packs: 3, memberships});

export function originalCatalogAcceptanceFixtures() {
  const authoredLegacy = authoredLegacyPack(), cleanFixture = authoredCleanPackage({long: false, media: true});
  const wrap = (role, bytes) => ({role, filename: CATALOG_ACCEPTANCE_FILENAMES[role], bytes: Buffer.from(bytes), sha256: catalogSha256(bytes), pack_id: `import-${catalogSha256(bytes)}`, archive_key: `pack-${catalogSha256(bytes)}`});
  const legacy = wrap('legacy', authoredLegacy.bytes);
  const shared = wrap('shared', storedZip([['same-original.json', JSON.stringify(authoredLegacy.scores[0])], ['original-note.txt', 'Original shared-pack note']]));
  const clean = wrap('clean', cleanFixture.bytes), inputs = [legacy, shared, clean];
  const spec = {
    filenames: {...CATALOG_ACCEPTANCE_FILENAMES},
    legacy_ids: authoredLegacy.scores.map(score => score.id),
    legacy_titles: authoredLegacy.scores.map(score => score.title),
    selected_score_ids: [authoredLegacy.scores[0].id, cleanFixture.metadata.id],
    retained_score_id: authoredLegacy.scores[1].id,
    clean_id: cleanFixture.metadata.id, clean_title: cleanFixture.metadata.title,
    clean_files: [...cleanFixture.files].map(([path, bytes]) => fileDigest(path, bytes)).sort((a, b) => a.path.localeCompare(b.path)),
    clean_media: cleanFixture.metadata.media.map(({id, role, path, bytes, sha256}) => ({id, role, path, bytes, sha256})),
    expected: {initial: counts(3, 0, 4), trashed: counts(1, 2, 1), restored: counts(3, 0, 4), selected_songs: 2, removed_memberships: 3, restored_memberships: 3, shared_songs: 1, retained_source_only: 1},
  };
  const manifest = {format: 'worldmusichub-original-catalog-acceptance', version: 1, generator: 'scripts/prepare-library-catalog-acceptance.mjs', rights: {status: 'original_authored', attribution: 'WorldMusicHub ORIGINAL acceptance exercises and generated media', license: 'CC0-1.0'}, private_music: false, phases: [...CATALOG_ACCEPTANCE_PHASES], inputs: inputs.map(({role, filename, bytes, sha256, pack_id, archive_key}) => ({role, filename, bytes: bytes.length, sha256, pack_id, archive_key})), spec};
  assert.equal(inputs.length, 3); assert.ok(inputs.reduce((sum, item) => sum + item.bytes.length, 0) < 1024 * 1024);
  return {legacy, shared, clean, cleanFixture, inputs, spec, manifest};
}

/** A fresh or empty destination is required; existing evidence is never overwritten. */
export async function prepareLibraryCatalogFixtures(directory) {
  await mkdir(directory, {recursive: true});
  assert.deepEqual(await readdir(directory), [], 'Catalog fixture output must be a fresh empty directory');
  const fixture = originalCatalogAcceptanceFixtures();
  for (const input of fixture.inputs) await writeFile(join(directory, input.filename), input.bytes, {flag: 'wx'});
  await writeFile(join(directory, 'catalog-fixtures.json'), JSON.stringify(fixture.manifest, null, 2) + '\n', {flag: 'wx'});
  return fixture.manifest;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  assert.equal(process.argv.length, 3, 'Usage: node scripts/prepare-library-catalog-acceptance.mjs <fresh-directory>');
  console.log(JSON.stringify(await prepareLibraryCatalogFixtures(resolve(process.argv[2]))));
}
