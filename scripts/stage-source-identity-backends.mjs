// Bounded CI diagnostics only. This never builds, downloads or executes a binary.
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {constants, createWriteStream} from 'node:fs';
import {lstat, mkdir, open, readdir, realpath, rm, writeFile} from 'node:fs/promises';
import {join, parse, resolve} from 'node:path';
import {Transform} from 'node:stream';
import {pipeline} from 'node:stream/promises';
import {fileURLToPath} from 'node:url';

export const STAGING_DIRECTORY = 'source-identity-backends';
export const MANIFEST_NAME = 'build-manifest.json';
// Debug builds have historically been 158/128 MB; leave realistic headroom,
// while bounding the archive to two files of at most 512 MiB each plus JSON.
export const MAX_BINARY_BYTES = 512 * 1024 * 1024;
const MAX_MANIFEST_BYTES = 16 * 1024;
export const BACKENDS = Object.freeze([
  Object.freeze({path: 'native_import_driver', build_output: 'target/debug/examples/native_import_driver', build_command: 'cargo build -p worldmusichub-desktop --example native_import_driver --locked'}),
  Object.freeze({path: 'practice-server', build_output: 'target/debug/practice-server', build_command: 'cargo build -p practice-server --locked'}),
]);
const PURPOSE = 'diagnostic-only; not acceptance evidence';
const BINDING = 'Clean checkout and successful workflow build steps; embedded binary source/process identity is not checked by this retention helper.';
const expectedNames = [...BACKENDS.map(file => file.path), MANIFEST_NAME].sort();

function exactKeys(value, keys, label) {
  assert.ok(value && typeof value === 'object' && !Array.isArray(value), label);
  assert.deepEqual(Object.keys(value).sort(), [...keys].sort(), `${label}: unexpected fields`);
}

async function noLinks(path) {
  const full = resolve(path), root = parse(full).root;
  let cursor = root;
  for (const component of full.slice(root.length).split(/[\\/]/).filter(Boolean)) {
    cursor = join(cursor, component);
    const stat = await lstat(cursor);
    assert.ok(!stat.isSymbolicLink(), `Symlink not allowed: ${cursor}`);
  }
  return full;
}

function checkoutIdentity(workspace, expectedSha) {
  assert.match(expectedSha, /^[a-f0-9]{40}$/, 'Expected an exact source commit SHA');
  const git = (...args) => execFileSync('git', args, {cwd: workspace, encoding: 'utf8', maxBuffer: 1024 * 1024}).trim();
  assert.equal(git('rev-parse', '--show-toplevel'), workspace, 'Expected repository root');
  assert.equal(git('rev-parse', 'HEAD'), expectedSha, 'Checkout SHA mismatch');
  assert.equal(git('status', '--porcelain', '--untracked-files=all'), '', 'Checkout must be clean');
  const tree = git('rev-parse', 'HEAD^{tree}');
  assert.match(tree, /^[a-f0-9]{40}$/);
  assert.equal(tree, git('rev-parse', `${expectedSha}^{tree}`), 'Checkout tree mismatch');
  return {sha: expectedSha, tree, status: 'clean'};
}

async function regularFile(path, maximum, allowBuildHardlinks = false) {
  await noLinks(path);
  assert.ok((await lstat(path)).isFile(), 'Expected a regular file');
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const stat = await handle.stat();
    assert.ok(stat.isFile() && (allowBuildHardlinks || stat.nlink === 1), 'Expected a regular file; staged files must be singly linked');
    assert.ok(stat.size > 0 && stat.size <= maximum, 'File size outside retention bounds');
    return {handle, stat};
  } catch (error) {
    await handle.close();
    throw error;
  }
}

async function inspectBinary(path, destination) {
  // Cargo may hardlink its fixed public build output to a hashed deps/examples
  // file. Always stream-copy inputs; independent staged files must have nlink=1.
  const {handle, stat} = await regularFile(path, MAX_BINARY_BYTES, Boolean(destination));
  try {
    const header = Buffer.alloc(20);
    const {bytesRead} = await handle.read(header, 0, header.length, 0);
    assert.ok(bytesRead === header.length && header.subarray(0, 7).equals(Buffer.from([0x7f, 0x45, 0x4c, 0x46, 2, 1, 1])) &&
      [2, 3].includes(header.readUInt16LE(16)) && header.readUInt16LE(18) === 62, 'Expected a Linux x86_64 ELF binary');
    const hash = createHash('sha256');
    let bytes = 0;
    const meter = new Transform({transform(chunk, encoding, callback) {
      bytes += chunk.length;
      if (bytes > MAX_BINARY_BYTES) return callback(new Error('Binary grew beyond retention bounds'));
      hash.update(chunk);
      callback(null, chunk);
    }});
    const input = handle.createReadStream({start: 0, autoClose: false, highWaterMark: 1024 * 1024});
    if (destination) {
      await pipeline(input, meter, createWriteStream(destination, {flags: 'wx', mode: 0o600}));
    } else {
      await pipeline(input, meter, async chunks => { for await (const chunk of chunks) void chunk; });
    }
    const after = await handle.stat();
    assert.equal(bytes, stat.size, 'Binary changed while being retained');
    for (const field of ['dev', 'ino', 'size', 'mtimeMs', 'ctimeMs', 'nlink']) assert.equal(after[field], stat[field], `Binary changed: ${field}`);
    return {bytes, sha256: hash.digest('hex')};
  } finally { await handle.close(); }
}

export async function verifyStagedBackends(directory, expectedSource) {
  await noLinks(directory);
  assert.deepEqual((await readdir(directory)).sort(), expectedNames, 'Unexpected diagnostic archive contents');
  const {handle} = await regularFile(join(directory, MANIFEST_NAME), MAX_MANIFEST_BYTES);
  let manifest;
  try { manifest = JSON.parse(await handle.readFile('utf8')); }
  finally { await handle.close(); }
  exactKeys(manifest, ['schema_version', 'purpose', 'source_binding', 'source', 'platform', 'files'], 'manifest');
  assert.equal(manifest.schema_version, 1);
  assert.equal(manifest.purpose, PURPOSE);
  assert.equal(manifest.source_binding, BINDING);
  assert.equal(manifest.platform, 'linux-x86_64');
  exactKeys(manifest.source, ['sha', 'tree', 'status'], 'source');
  for (const field of ['sha', 'tree']) assert.match(manifest.source[field], /^[a-f0-9]{40}$/);
  assert.equal(manifest.source.status, 'clean');
  assert.deepEqual(manifest.source, expectedSource, 'Diagnostic source mismatch');
  assert.ok(Array.isArray(manifest.files) && manifest.files.length === BACKENDS.length, 'Expected exactly two backends');
  for (const [index, backend] of BACKENDS.entries()) {
    const file = manifest.files[index];
    exactKeys(file, ['path', 'build_output', 'build_command', 'bytes', 'sha256'], 'file');
    for (const field of Object.keys(backend)) assert.equal(file[field], backend[field], 'Backend allowlist mismatch');
    assert.ok(Number.isSafeInteger(file.bytes) && file.bytes > 0 && file.bytes <= MAX_BINARY_BYTES);
    assert.match(file.sha256, /^[a-f0-9]{64}$/);
    assert.deepEqual(await inspectBinary(join(directory, backend.path)), {bytes: file.bytes, sha256: file.sha256}, 'Retained binary digest/size mismatch');
  }
  return manifest;
}

export async function stageSourceIdentityBackends({workspace, runnerTemp, sourceSha}) {
  workspace = await noLinks(workspace);
  runnerTemp = await noLinks(runnerTemp);
  assert.equal(await realpath(workspace), workspace);
  assert.equal(await realpath(runnerTemp), runnerTemp);
  assert.ok(runnerTemp !== workspace && !runnerTemp.startsWith(`${workspace}/`), 'Diagnostics must be outside the checkout');
  const source = checkoutIdentity(workspace, sourceSha);
  const directory = join(runnerTemp, STAGING_DIRECTORY);
  // Never reuse a directory that could contain reports, profiles or private inputs.
  await mkdir(directory, {mode: 0o700});
  try {
    const files = [];
    for (const backend of BACKENDS) files.push({...backend, ...await inspectBinary(join(workspace, backend.build_output), join(directory, backend.path))});
    assert.deepEqual(checkoutIdentity(workspace, sourceSha), source, 'Source changed during diagnostic retention');
    const manifest = {schema_version: 1, purpose: PURPOSE, source_binding: BINDING, source, platform: 'linux-x86_64', files};
    await writeFile(join(directory, MANIFEST_NAME), `${JSON.stringify(manifest, null, 2)}\n`, {flag: 'wx', mode: 0o600});
    await verifyStagedBackends(directory, source);
    return manifest;
  } catch (error) {
    await rm(directory, {recursive: true, force: true});
    throw error;
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  assert.equal(process.argv.length, 2, 'This helper accepts no custom file paths or commands');
  assert.equal(process.platform, 'linux', 'Linux runner required');
  assert.equal(process.arch, 'x64', 'x86_64 runner required');
  const {GITHUB_WORKSPACE: workspace, RUNNER_TEMP: runnerTemp, GITHUB_SHA: sourceSha} = process.env;
  assert.ok(workspace && runnerTemp && sourceSha, 'Missing GitHub runner identity');
  await stageSourceIdentityBackends({workspace, runnerTemp, sourceSha});
  console.log('Retained two exact-checkout backend diagnostics with byte counts and SHA-256; this is not acceptance evidence.');
}
