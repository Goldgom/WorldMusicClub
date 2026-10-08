import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {link, lstat, mkdir, mkdtemp, readFile, readdir, rm, symlink, truncate, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {dirname, join} from 'node:path';
import test from 'node:test';
import {BACKENDS, MANIFEST_NAME, MAX_BINARY_BYTES, STAGING_DIRECTORY, stageSourceIdentityBackends, verifyStagedBackends} from '../scripts/stage-source-identity-backends.mjs';

const root = new URL('../', import.meta.url);
const python = process.env.PYTHON || (process.platform === 'win32' ? 'python' : 'python3');
const parsed = spawnSync(python, ['scripts/check-authoring-workflow.py', '.github/workflows/check.yml', '--json'], {cwd: root, encoding: 'utf8'});
assert.equal(parsed.status, 0, parsed.stderr);
const workflow = JSON.parse(parsed.stdout);
const artifactName = 'source-identity-backends-linux-${{ github.sha }}';
const stageGuard = "${{ always() && matrix.height == 720 && steps.identity_native_driver.outcome == 'success' && steps.identity_server.outcome == 'success' }}";
const uploadGuard = stageGuard.replace(' }}', " && steps.identity_backend_diagnostics.outcome == 'success' }}");
const uploadAction = 'actions/upload-artifact@043fb46d1a93c77aae656e7c1c64a875d1fc6a0a';

function retentionContract(document) {
  const job = document.jobs['source-identity'], steps = job.steps;
  assert.deepEqual(job.strategy.matrix.height, [720, 900]);
  assert.equal(job.strategy['fail-fast'], false);
  assert.equal(job['runs-on'], 'ubuntu-latest');
  assert.equal(job.if, undefined);
  assert.equal(job['continue-on-error'], undefined);
  const checkout = steps.find(row => row.uses?.startsWith('actions/checkout@'));
  assert.equal(checkout.with.ref, '${{ github.sha }}');
  const beforeBuild = steps.find(row => row.name === 'Check clean exact source before identity backend builds');
  assert.deepEqual(beforeBuild.run.trim().split('\n'), [
    'test "$(git rev-parse HEAD)" = "$GITHUB_SHA"',
    'test -z "$(git status --porcelain --untracked-files=all)"',
  ]);
  assert.equal(beforeBuild.if, undefined);
  const builds = ['identity_native_driver', 'identity_server'].map((id, index) => {
    const row = steps.find(step => step.id === id);
    assert.equal(row.run, BACKENDS[index].build_command);
    assert.equal(row.if, undefined);
    assert.ok(steps.indexOf(row) > steps.indexOf(beforeBuild));
    assert.equal(steps.filter(step => step.run === row.run).length, 1, 'Reuse an existing build; do not add one');
    return row;
  });
  const acceptance = steps.find(row => row.run?.includes('node scripts/hosted-source-identity-check.mjs'));
  assert.equal(acceptance.if, undefined);
  assert.deepEqual(acceptance.run.trim().split('\n'), [
    'set -o pipefail',
    'test "$(git rev-parse HEAD)" = "$GITHUB_SHA"',
    'test -z "$(git status --porcelain --untracked-files=normal)"',
    'mkdir -p "$WMH_ARTIFACT_DIR"',
    'node scripts/hosted-source-identity-check.mjs | tee "$WMH_ARTIFACT_DIR/tests.log"',
  ]);
  assert.deepEqual(acceptance.env, {
    WMH_HOSTED_BROWSER: '1', WMH_SOURCE_SHA: '${{ github.sha }}', WMH_VIEWPORT_HEIGHT: '${{ matrix.height }}',
    WMH_NATIVE_IMPORT_DRIVER: '${{ github.workspace }}/target/debug/examples/native_import_driver',
    WMH_SERVER_BINARY: '${{ github.workspace }}/target/debug/practice-server',
    WMH_ARTIFACT_DIR: '${{ runner.temp }}/source-identity-${{ matrix.height }}',
  });
  const evidence = steps.find(row => row.with?.name === 'source-identity-${{ matrix.height }}-${{ github.sha }}');
  assert.equal(evidence.if, 'always()');
  assert.equal(evidence.uses, uploadAction);
  assert.deepEqual(evidence.with, {name: 'source-identity-${{ matrix.height }}-${{ github.sha }}', path: '${{ runner.temp }}/source-identity-${{ matrix.height }}/', 'if-no-files-found': 'ignore'});
  const allSteps = Object.values(document.jobs).flatMap(job => job.steps);
  const stages = allSteps.filter(row => row.run?.includes('stage-source-identity-backends.mjs'));
  assert.equal(stages.length, 1, 'Only one bounded staging step per Verify');
  const stage = stages[0];
  assert.equal(stage.id, 'identity_backend_diagnostics');
  assert.equal(stage.run, 'node scripts/stage-source-identity-backends.mjs');
  assert.equal(stage.if, stageGuard);
  assert.equal(stage['timeout-minutes'], 3);
  assert.equal(stage.env, undefined, 'Use the runner identity, not a custom source or output path');
  assert.ok(steps.indexOf(stage) > steps.indexOf(evidence));
  for (const build of builds) assert.ok(steps.indexOf(acceptance) > steps.indexOf(build));
  const uploads = allSteps.filter(row => row.with?.name === artifactName);
  assert.equal(uploads.length, 1, 'Only one diagnostic archive per Verify');
  const upload = uploads[0];
  assert.ok(steps.indexOf(upload) > steps.indexOf(stage));
  assert.equal(upload.if, uploadGuard);
  assert.equal(upload.uses, uploadAction);
  assert.deepEqual(upload.with, {
    name: artifactName,
    path: ['native_import_driver', 'practice-server', 'build-manifest.json'].map(name => '${{ runner.temp }}/source-identity-backends/' + name).join('\n') + '\n',
    'if-no-files-found': 'error', 'retention-days': 7, 'compression-level': 0,
  });
  for (const row of steps) {
    assert.equal(row['continue-on-error'], undefined, 'No ignored mandatory or diagnostic failures');
    assert.doesNotMatch(row.run || '', /\|\|\s*(true|:)|set \+e|curl|wget/);
  }
}

test('Verify retains one seven-day, explicitly allowlisted Linux diagnostic archive without weakening evidence', () => {
  retentionContract(workflow);
});

test('retention workflow rejects duplicate archives, failed-build fallbacks and acceptance weakening', () => {
  const find = (doc, id) => doc.jobs['source-identity'].steps.find(row => row.id === id);
  const upload = doc => doc.jobs['source-identity'].steps.find(row => row.with?.name === artifactName);
  for (const mutate of [
    doc => { find(doc, 'identity_backend_diagnostics').if = 'always()'; },
    doc => { find(doc, 'identity_backend_diagnostics').if = stageGuard.replace('720', '900'); },
    doc => { find(doc, 'identity_backend_diagnostics').if = stageGuard.replace(" && steps.identity_server.outcome == 'success'", ''); },
    doc => { find(doc, 'identity_backend_diagnostics').if = stageGuard.replace('always()', 'success()'); },
    doc => { upload(doc).if = stageGuard; },
    doc => { upload(doc).with.path = '${{ runner.temp }}/**'; },
    doc => { upload(doc).with['retention-days'] = 90; },
    doc => { upload(doc).with['include-hidden-files'] = true; },
    doc => { upload(doc).with['if-no-files-found'] = 'ignore'; },
    doc => { doc.jobs['source-identity'].steps.push(structuredClone(upload(doc))); },
    doc => { find(doc, 'identity_native_driver')['continue-on-error'] = true; },
    doc => { find(doc, 'identity_server').run += ' || true'; },
    doc => { doc.jobs['source-identity'].steps.find(row => row.run?.includes('hosted-source-identity-check.mjs')).run = 'true'; },
    doc => { doc.jobs['source-identity'].steps.find(row => row.with?.name === 'source-identity-${{ matrix.height }}-${{ github.sha }}').if = 'success()'; },
  ]) {
    const changed = structuredClone(workflow);
    mutate(changed);
    assert.throws(() => retentionContract(changed));
  }
});

function elfBytes(payload = 'synthetic test data; never executed') {
  const header = Buffer.alloc(64);
  Buffer.from([0x7f, 0x45, 0x4c, 0x46, 2, 1, 1]).copy(header);
  header.writeUInt16LE(3, 16);
  header.writeUInt16LE(62, 18);
  return Buffer.concat([header, Buffer.from(payload)]);
}

async function fixture(t) {
  const directory = await mkdtemp(join(tmpdir(), 'wmh-backend-retention-'));
  t.after(() => rm(directory, {recursive: true, force: true}));
  const workspace = join(directory, 'repo'), runnerTemp = join(directory, 'runner-temp');
  await mkdir(workspace); await mkdir(runnerTemp);
  const git = (...args) => {
    const result = spawnSync('git', args, {cwd: workspace, encoding: 'utf8'});
    assert.equal(result.status, 0, result.stderr);
    return result.stdout.trim();
  };
  git('init', '--quiet');
  await writeFile(join(workspace, '.gitignore'), '/target/\n');
  await writeFile(join(workspace, 'source.txt'), 'original synthetic source\n');
  git('add', '.');
  git('-c', 'user.name=Retention Test', '-c', 'user.email=retention-test@example.invalid', 'commit', '--quiet', '-m', 'Synthetic retention fixture');
  for (const [index, backend] of BACKENDS.entries()) {
    const target = join(workspace, backend.build_output);
    await mkdir(dirname(target), {recursive: true});
    await writeFile(target, elfBytes(`synthetic backend ${index}`));
  }
  return {workspace, runnerTemp, sourceSha: git('rev-parse', 'HEAD'), git, directory: join(runnerTemp, STAGING_DIRECTORY)};
}

const linuxOnly = {skip: process.platform !== 'linux' ? 'Linux-only retention helper' : false};

test('staging copies only two fixed build outputs and records independently verified bytes and hashes', linuxOnly, async t => {
  const input = await fixture(t);
  await writeFile(join(input.workspace, 'target/private-song.mid'), 'private input must not be retained');
  await mkdir(join(input.workspace, 'target/webview-catalog-profile'));
  await writeFile(join(input.runnerTemp, 'catalog-report.json'), 'reports must not be retained');
  const manifest = await stageSourceIdentityBackends(input);
  assert.deepEqual((await readdir(input.directory)).sort(), [MANIFEST_NAME, ...BACKENDS.map(file => file.path)].sort());
  assert.deepEqual(manifest.source, {sha: input.sourceSha, tree: input.git('rev-parse', 'HEAD^{tree}'), status: 'clean'});
  assert.equal(manifest.purpose, 'diagnostic-only; not acceptance evidence');
  assert.match(manifest.source_binding, /embedded binary source\/process identity is not checked/);
  for (const file of manifest.files) {
    const bytes = await readFile(join(input.workspace, file.build_output));
    assert.deepEqual(await readFile(join(input.directory, file.path)), bytes);
    assert.equal(file.bytes, bytes.length);
    assert.equal(file.sha256, createHash('sha256').update(bytes).digest('hex'));
  }
  assert.deepEqual(await verifyStagedBackends(input.directory, manifest.source), manifest);
});

test('retention streams realistic debug-binary sizes and has finite 512 MiB per-file bounds', linuxOnly, async t => {
  const input = await fixture(t);
  assert.equal(MAX_BINARY_BYTES, 512 * 1024 * 1024);
  // Sparse input exceeds the historical 158 MB driver without allocating it in RAM.
  const bytes = 160 * 1024 * 1024;
  await truncate(join(input.workspace, BACKENDS[0].build_output), bytes);
  const manifest = await stageSourceIdentityBackends(input);
  assert.equal(manifest.files[0].bytes, bytes);
  const hash = createHash('sha256').update(elfBytes('synthetic backend 0'));
  const zero = Buffer.alloc(1024 * 1024);
  let remaining = bytes - elfBytes('synthetic backend 0').length;
  while (remaining > 0) { const length = Math.min(remaining, zero.length); hash.update(zero.subarray(0, length)); remaining -= length; }
  assert.equal(manifest.files[0].sha256, hash.digest('hex'));
});

test('Cargo hardlinked public build outputs become independent staged copies', linuxOnly, async t => {
  const input = await fixture(t);
  for (const backend of BACKENDS) {
    const source = join(input.workspace, backend.build_output);
    await link(source, `${source}-cargo-hashed-output`);
    assert.equal((await lstat(source)).nlink, 2);
  }
  const manifest = await stageSourceIdentityBackends(input);
  for (const backend of BACKENDS) {
    const source = await lstat(join(input.workspace, backend.build_output));
    const staged = await lstat(join(input.directory, backend.path));
    assert.equal(staged.nlink, 1);
    assert.notEqual(staged.ino, source.ino);
  }
  assert.deepEqual(await verifyStagedBackends(input.directory, manifest.source), manifest);
});

test('staging rejects stale or dirty source and cannot mix into an existing artifact', linuxOnly, async t => {
  for (const mode of ['sha', 'tracked', 'staged', 'untracked', 'existing', 'inside-checkout']) await t.test(mode, async t => {
    const input = await fixture(t);
    if (mode === 'sha') input.sourceSha = '0'.repeat(40);
    if (mode === 'tracked' || mode === 'staged') await writeFile(join(input.workspace, 'source.txt'), 'changed');
    if (mode === 'staged') input.git('add', 'source.txt');
    if (mode === 'untracked') await writeFile(join(input.workspace, 'private-song.mid'), 'private');
    if (mode === 'existing') { await mkdir(input.directory); await writeFile(join(input.directory, 'private.json'), 'keep'); }
    if (mode === 'inside-checkout') input.runnerTemp = join(input.workspace, 'target');
    await assert.rejects(stageSourceIdentityBackends(input));
    if (mode === 'existing') assert.equal(await readFile(join(input.directory, 'private.json'), 'utf8'), 'keep');
    else await assert.rejects(lstat(input.directory), {code: 'ENOENT'});
  });
});

test('staging rejects links, missing outputs, non-ELF data and oversized files without partial archives', linuxOnly, async t => {
  for (const mode of ['missing', 'empty', 'directory', 'private-data', 'too-large', 'symlink-file', 'symlink-directory']) await t.test(mode, async t => {
    const input = await fixture(t), target = join(input.workspace, BACKENDS[0].build_output);
    if (['missing', 'symlink-file'].includes(mode)) await rm(target);
    if (mode === 'empty') await writeFile(target, '');
    if (mode === 'directory') { await rm(target); await mkdir(target); }
    if (mode === 'private-data') await writeFile(target, 'private song contents');
    if (mode === 'too-large') await truncate(target, MAX_BINARY_BYTES + 1);
    if (mode === 'symlink-file') await symlink(join(input.workspace, BACKENDS[1].build_output), target);
    if (mode === 'symlink-directory') { await rm(dirname(target), {recursive: true}); await symlink(input.runnerTemp, dirname(target)); }
    await assert.rejects(stageSourceIdentityBackends(input));
    await assert.rejects(lstat(input.directory), {code: 'ENOENT'});
  });
});

test('archive verification rejects tampered bytes, stale identity, extra files and relaxed manifests', linuxOnly, async t => {
  for (const mode of ['bytes', 'hash', 'size', 'source', 'tree', 'extra-key', 'extra-file', 'profile', 'manifest-symlink', 'manifest-size', 'staged-hardlink', 'path', 'build-output', 'build-command', 'duplicate', 'acceptance-claim']) await t.test(mode, async t => {
    const input = await fixture(t), manifest = await stageSourceIdentityBackends(input), expected = structuredClone(manifest.source);
    if (mode === 'bytes') await writeFile(join(input.directory, BACKENDS[0].path), elfBytes('different'));
    if (mode === 'hash') manifest.files[0].sha256 = '0'.repeat(64);
    if (mode === 'size') manifest.files[0].bytes++;
    if (mode === 'source') manifest.source.sha = '0'.repeat(40);
    if (mode === 'tree') manifest.source.tree = '0'.repeat(40);
    if (mode === 'extra-key') manifest.private_report = 'not permitted';
    if (mode === 'extra-file') await writeFile(join(input.directory, 'private-song.mid'), 'private');
    if (mode === 'profile') await mkdir(join(input.directory, 'webview-catalog-profile'));
    if (mode === 'staged-hardlink') await link(join(input.directory, BACKENDS[0].path), join(input.runnerTemp, 'outside-archive-hardlink'));
    if (mode === 'path') manifest.files[0].path = '../private-song.mid';
    if (mode === 'build-output') manifest.files[0].build_output = 'target/private-song.mid';
    if (mode === 'build-command') manifest.files[0].build_command += ' --release';
    if (mode === 'duplicate') manifest.files[1] = manifest.files[0];
    if (mode === 'acceptance-claim') manifest.purpose = 'acceptance passed';
    const manifestPath = join(input.directory, MANIFEST_NAME);
    if (mode === 'manifest-symlink') { await rm(manifestPath); await symlink(join(input.workspace, 'source.txt'), manifestPath); }
    else await writeFile(manifestPath, mode === 'manifest-size' ? ' '.repeat(16 * 1024 + 1) : JSON.stringify(manifest));
    await assert.rejects(verifyStagedBackends(input.directory, expected));
  });
});
