// Newly authored, bounded acceptance inputs. No user library or delivered music.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {mkdir, readFile, readdir, rename, writeFile} from 'node:fs/promises';
import {join, relative} from 'node:path';
import {fixture as scoreTemplate} from '../tests/frontend-fixtures.js';
import {storedZip} from '../tests/native-import-driver-fixtures.js';
import {authoredCleanPackage} from '../tests/clean-song-package-fixtures.js';
import {checkedManagementResponse, managementRequest} from '../web/library-management-contract.js';

export const PACK_MANAGEMENT_LIMITS = Object.freeze({songs: 45, packs: 6, page: 40, api: 180, actions: 100, inputBytes: 1024 * 1024, files: 512, libraryBytes: 8 * 1024 * 1024, runtimeMs: 240000});
export const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
/** Read ORIGINAL archive inventory in memory; never extract, with a hard subprocess deadline. */
export function inspectOriginalManagementZip(bytes) {
  assert.ok(Buffer.isBuffer(bytes) && bytes.length <= PACK_MANAGEMENT_LIMITS.libraryBytes);
  const script = 'import sys,io,zipfile,json,hashlib\nz=zipfile.ZipFile(io.BytesIO(sys.stdin.buffer.read()))\ninfos=z.infolist()\nassert len(infos)<=64 and len(infos)==len(set(i.filename for i in infos))\nassert sum(i.file_size for i in infos)<=8*1024*1024\nresult={}\nfor i in infos:\n assert not i.is_dir() and i.file_size<=2*1024*1024\n b=z.read(i)\n result[i.filename]={"bytes":len(b),"sha256":hashlib.sha256(b).hexdigest()}\nprint(json.dumps(result))\n';
  return JSON.parse(execFileSync(process.platform === 'win32' ? 'python' : 'python3', ['-c', script], {input: bytes, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'], maxBuffer: 128 * 1024, timeout: 5000}));
}
const serialize = value => Buffer.from(JSON.stringify(value, null, 2) + '\n');
function originalScore(id, title) {
  const score = structuredClone(scoreTemplate);
  Object.assign(score, {id: `original-management-${id}`, title, composer: 'ORIGINAL acceptance exercise', provenance: {kind: 'original_exercise', attribution: 'WorldMusicClub ORIGINAL pack-management acceptance', source_url: null, license: 'CC0-1.0'}, source: {format: 'original-acceptance-text', filename: '原创保留原文.txt', content: '\uFEFFORIGINAL test-only two-note exercise\r\nNo private music.\r\n'}});
  score.tempo[0].bpm = 30;
  return score;
}
function input(role, filename, bytes, scores = []) {
  bytes = Buffer.from(bytes);
  return {role, filename, bytes, scores, sha256: sha256(bytes), pack_id: `import-${sha256(bytes)}`, archive_key: `pack-${sha256(bytes)}`};
}
export function originalPackManagementFixtures() {
  const shared = originalScore('shared', '原创共享练习 <仅文本>'), standalone = originalScore('retry', '原创单曲改名重试'), backupOnly = originalScore('backup', '原创备份虚拟条目'), unresolved = originalScore('unresolved', '原创待确认归属');
  const primaryScores = [shared, ...Array.from({length: 40}, (_, index) => originalScore(`page-${String(index + 1).padStart(2, '0')}`, `原创分页练习 ${String(index + 1).padStart(2, '0')}`))];
  const primary = input('primary', '原创曲包_日本語 空格.zip', storedZip(primaryScores.map((score, index) => [`原创/深层 目录/练习 ${index + 1}/乐谱.wmhscore.json`, serialize(score)])), primaryScores);
  const backup = input('backup', '原创备份 一键导入.json', serialize({format: 'worldmusichub-library-backup', version: 1, entries: [shared, backupOnly].map(score => ({label: null, score}))}), [shared, backupOnly]);
  const solo = input('standalone', '原创单曲 空格.json', serialize(standalone), [standalone]);
  const missingReceipt = input('unresolved', '原创待确认.json', serialize(unresolved), [unresolved]);
  const retained = Buffer.from('ORIGINAL unsupported MIDI bytes; retained without interpretation\r\n');
  const metadata = {format: 'private-complete-midi-source-folder', version: 1, title: 'ORIGINAL 仅保留源文件', source_files: [{path: 'source/original.mid', bytes: retained.length, sha256: sha256(retained)}], imports: {canonical_score: null, canonical_error: 'ORIGINAL source-only acceptance; no playable notation'}};
  const sourceOnly = input('source-only', '原创仅源文件.zip', storedZip([['原创源文件/song/metadata.json', serialize(metadata)], ['原创源文件/song/source/original.mid', retained]]));
  // Existing repository fixture is newly authored and Rust-converted, with media omitted.
  const cleanFixture = authoredCleanPackage({long: false, media: false});
  const clean = input('clean', cleanFixture.filename, cleanFixture.bytes);
  const initial = [primary, backup, solo, missingReceipt, sourceOnly, clean];
  const retries = [{...solo, filename: '同字节重试_日本語.json'}, {...backup, filename: '同字节备份 重试.json'}];
  const expectedSongs = [...primaryScores, standalone, backupOnly, unresolved].map(score => ({id: score.id, title: score.title, kind: 'legacy'}));
  expectedSongs.push({id: cleanFixture.metadata.id, title: cleanFixture.metadata.title, kind: 'clean'});
  assert.equal(expectedSongs.length, PACK_MANAGEMENT_LIMITS.songs);
  assert.ok(initial.reduce((sum, item) => sum + item.bytes.length, 0) < PACK_MANAGEMENT_LIMITS.inputBytes);
  return {initial, retries, primary, backup, standalone: solo, unresolved: missingReceipt, sourceOnly, clean, cleanFixture, shared, backupOnly, expectedSongs};
}
export function fixtureManifest(fixture) {
  return {version: 1, provenance: 'ORIGINAL test-only exercises and repository ORIGINAL clean fixture', private_music: false, expected_songs: fixture.expectedSongs.length, expected_packs: fixture.initial.length, inputs: [...fixture.initial, ...fixture.retries].map(({role, filename, bytes, sha256: digest, pack_id}) => ({role, filename, bytes: bytes.length, sha256: digest, pack_id}))};
}
export async function writeOriginalFixtures(directory, fixture) {
  await mkdir(directory, {recursive: true});
  for (const value of [...fixture.initial, ...fixture.retries]) await writeFile(join(directory, value.filename), value.bytes, {flag: 'wx'});
  await writeFile(join(directory, 'manifest.json'), serialize(fixtureManifest(fixture)), {flag: 'wx'});
}
export function requireHostedPackManagement(env, head, status) {
  assert.equal(env.GITHUB_ACTIONS, 'true', 'Pack-management acceptance requires an authorized hosted Actions runner');
  assert.equal(env.WMH_HOSTED_BROWSER, '1', 'Pack-management acceptance requires explicit hosted browser authorization');
  assert.match(head, /^[a-f0-9]{40}$/);
  assert.equal(env.WMH_SOURCE_SHA, head, 'Hosted source must match the explicitly selected exact commit');
  assert.equal(status.trim(), '', 'Hosted source must be clean');
  assert.ok(env.WMH_NATIVE_IMPORT_DRIVER, 'An already-built exact-source native_import_driver is required');
}
/** Move only receipt copies from a fresh marked fixture root. Originals are retained. */
export async function moveOriginalReceiptsAside(directory, archiveKey) {
  assert.match(archiveKey, /^pack-[a-f0-9]{64}$/);
  assert.equal(await readFile(join(directory, 'ORIGINAL-ACCEPTANCE-ROOT'), 'utf8'), 'pack-management-original-only-v1\n');
  const library = join(directory, 'Scores'), aside = join(directory, 'receipt-recovery-fixture');
  await mkdir(aside);
  const moved = [];
  for (const area of ['imports', 'import-backups']) {
    const source = join(library, area, archiveKey), entries = await readdir(source, {withFileTypes: true});
    const receipts = entries.filter(entry => entry.name.startsWith('report-'));
    assert.ok(receipts.length > 0 && receipts.length <= 4, 'Bounded original receipt copies required');
    for (const entry of receipts) {
      assert.equal(entry.isFile(), true, 'Receipt fixture must be a regular file');
      const from = join(source, entry.name), to = join(aside, `${area}-${entry.name}`), bytes = await readFile(from);
      await rename(from, to);
      assert.equal(sha256(await readFile(to)), sha256(bytes));
      moved.push({from: relative(directory, from), to: relative(directory, to), bytes: bytes.length, sha256: sha256(bytes)});
    }
  }
  return moved;
}
/** Byte inventory, including receipt backups, without inspecting any other library. */
export async function originalLibraryInventory(directory) {
  const rows = []; let bytes = 0;
  async function visit(folder) {
    for (const entry of (await readdir(folder, {withFileTypes: true})).sort((a, b) => a.name.localeCompare(b.name))) {
      const filename = join(folder, entry.name);
      assert.equal(entry.isSymbolicLink(), false, 'No linked files in ORIGINAL library fixture');
      if (entry.isDirectory()) await visit(filename);
      else {
        assert.equal(entry.isFile(), true); assert.ok(rows.length < PACK_MANAGEMENT_LIMITS.files);
        const value = await readFile(filename); bytes += value.length; assert.ok(bytes < PACK_MANAGEMENT_LIMITS.libraryBytes);
        rows.push({path: relative(directory, filename).replaceAll('\\', '/'), bytes: value.length, sha256: sha256(value)});
      }
    }
  }
  await visit(directory); return rows;
}
/** Assert the full native query outcome; input bytes and membership IDs are independent of rendering. */
export function assertOriginalManagementInventory(fixture, {packs, songs, duplicates, issues}, sourceOnlyReport) {
  for (const [view, response] of Object.entries({packs, songs, duplicates, issues})) checkedManagementResponse(response, managementRequest({view, limit: 100}));
  assert.equal(packs.total, PACK_MANAGEMENT_LIMITS.packs); assert.equal(packs.rows.length, packs.total);
  assert.equal(songs.total, PACK_MANAGEMENT_LIMITS.songs); assert.equal(songs.rows.length, songs.total);
  assert.deepEqual(songs.rows.map(row => `${row.storage_kind}:${row.score_id}`).sort(), fixture.expectedSongs.map(row => `${row.kind}:${row.id}`).sort());
  assert.equal(new Set(songs.rows.map(row => row.edition_id)).size, songs.total);
  const expected = new Map(fixture.initial.map(value => [value.pack_id, value]));
  assert.deepEqual(packs.rows.map(row => row.pack_id).sort(), [...expected.keys()].sort());
  for (const row of packs.rows) {
    const value = expected.get(row.pack_id); assert.equal(row.name, value.filename); assert.equal(row.source_bytes, value.bytes.length);
    assert.equal(row.provenance, value.role === 'unresolved' ? 'unresolved' : 'validated_receipts');
    assert.equal(row.song_count, value.role === 'unresolved' ? 0 : value.role === 'clean' ? 1 : value.scores.length);
    assert.equal(row.receipt_count, value.role === 'unresolved' ? 0 : ['standalone', 'backup'].includes(value.role) ? 2 : 1);
  }
  const byId = new Map(songs.rows.map(row => [row.score_id, row]));
  for (const row of songs.rows) {
    assert.equal(row.title, fixture.expectedSongs.find(song => song.id === row.score_id && song.kind === row.storage_kind).title);
    const memberships = fixture.initial.filter(value => !['unresolved', 'source-only'].includes(value.role) && (value.role === 'clean' ? row.storage_kind === 'clean' : value.scores.some(score => score.id === row.score_id))).map(value => value.pack_id).sort();
    assert.deepEqual([...row.pack_ids].sort(), memberships);
    assert.equal(row.source_reference_count, memberships.length, 'Renamed retries must not invent logical source items');
  }
  assert.equal(byId.get(fixture.standalone.scores[0].id).receipt_reference_count, 2);
  assert.equal(byId.get(fixture.backupOnly.id).receipt_reference_count, 2);
  assert.equal(byId.get(fixture.shared.id).receipt_reference_count, 3);
  assert.equal(packs.summary.shared_songs, 1); assert.equal(packs.summary.unfiled_songs, 1);
  assert.equal(duplicates.total, 1); assert.equal(duplicates.rows.length, 1);
  assert.equal(duplicates.rows[0].kind, 'exact_content'); assert.equal(duplicates.rows[0].evidence_type, 'shared_edition');
  assert.equal(duplicates.rows[0].edition_count, 1); assert.equal(duplicates.rows[0].reference_count, 2);
  assert.equal(duplicates.rows[0].editions[0].score_id, fixture.shared.id);
  const retained = sourceOnlyReport.items.filter(item => item.status === 'retained_nonplayable');
  assert.equal(retained.length, 1);
  assert.equal(packs.rows.find(row => row.pack_id === fixture.sourceOnly.pack_id).retained_only_count, retained.length);
  for (const item of retained) assert.ok(issues.rows.some(row => row.archive_key === fixture.sourceOnly.archive_key && row.code === item.code && row.message.includes(item.path) && row.message.includes(item.message)), 'Source-only issues must retain the real importer path, code and message');
  assert.ok(issues.rows.some(row => row.archive_key === fixture.unresolved.archive_key), 'Unresolved pack needs an original source diagnostic');
  return {songs: songs.total, packs: packs.total, shared: 1, unfiled: 1, exact_content_groups: 1};
}

export function assertSelectedLegacyExport(inventory, song, receipts) {
  const entry = receipts.flatMap(receipt => receipt.items).find(item => item.entry?.key === song.key)?.entry;
  assert.ok(entry, 'Selected edition must have a real import receipt');
  const folder = `songs/${song.key}`;
  assert.deepEqual(Object.keys(inventory).sort(), ['manifest.json', `${folder}/metadata.json`, `${folder}/score.json`].sort());
  assert.equal(inventory[`${folder}/score.json`].sha256, entry.score_sha256, 'Selected export must preserve the exact stored canonical score bytes');
  assert.equal(inventory[`${folder}/score.json`].bytes, entry.score_bytes);
}

/** Browser-side read predicate. Results exposes actual recorder assessment/grace state. */
export function practiceBaselineReady(document = globalThis.document) {
  const summary = document.getElementById('result-summary'), assess = document.getElementById('assess-button'), retry = document.getElementById('retry-assessments'), feedback = document.getElementById('feedback-results');
  return Boolean(summary && ['assessed', 'review'].includes(summary.dataset.phase) && /^\d+$/.test(summary.dataset.passId) && /^\d+$/.test(summary.dataset.revision) && summary.dataset.revision === summary.dataset.assessedRevision && assess && !assess.disabled && retry?.hidden && feedback && !feedback.hidden);
}
export function assertSettledPracticeExport(value) {
  assert.ok(Array.isArray(value?.passes) && value.passes.length > 0, 'A real recorded practice pass is required');
  for (const pass of value.passes) {
    assert.equal(pass.pending, false, 'Practice baseline still has pending assessment/grace work');
    assert.equal(pass.error, null, 'Practice baseline assessment failed');
    assert.equal(pass.manual_deadline_wall_ms, null, 'Practice baseline still has an assessment deadline');
    assert.equal(pass.assessed_revision, pass.revision, 'Practice baseline does not own the current input revision');
    assert.ok(pass.assessment && typeof pass.assessment === 'object', 'Practice baseline has no completed assessment');
    assert.ok(pass.clock_segments.length > 0 && pass.clock_segments.every(segment => segment.wallEnd !== null), 'Practice baseline must be paused');
  }
  assert.ok(value.passes.some(pass => pass.inputs.length > 0), 'Actual pointer practice input required');
  return value.passes.map(pass => ({id: pass.id, revision: pass.revision, assessed_revision: pass.assessed_revision, pending: pass.pending, inputs: pass.inputs.length}));
}
