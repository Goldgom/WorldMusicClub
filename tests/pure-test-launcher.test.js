import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn, spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {EventEmitter, once} from 'node:events';
import {copyFileSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {readPureTestFiles, runPureTests} from '../scripts/run-pure-tests.mjs';

const launcher = new URL('../scripts/run-pure-tests.mjs', import.meta.url);
const inventoryPath = root => join(root, 'scripts/pure-test-files.json');
const writeInventory = (root, files) => writeFileSync(inventoryPath(root), JSON.stringify(files));

function fixture(t, sources = {'one': "import test from 'node:test'; test('passes', () => {});"}) {
  const root = mkdtempSync(join(tmpdir(), 'wmh pure launcher & '));
  t.after(() => rmSync(root, {recursive: true, force: true}));
  mkdirSync(join(root, 'scripts'));
  mkdirSync(join(root, 'tests'));
  copyFileSync(launcher, join(root, 'scripts/run-pure-tests.mjs'));
  writeFileSync(join(root, 'package.json'), '{"type":"module"}');
  const files = Object.entries(sources).map(([name, source]) => {
    const file = `tests/${name}.test.js`;
    writeFileSync(join(root, file), source);
    return file;
  });
  writeInventory(root, files);
  // Discovery would execute this sentinel and fail. It is never registered.
  writeFileSync(join(root, 'tests/unlisted-browser.test.js'), "throw new Error('Unlisted browser suite executed');");
  return {root, files};
}

function fixtureEnvironment() {
  const env = {...process.env, WMH_LAUNCHER_FIXTURE: 'inherited'};
  // The fixture starts an independent runner from inside this test worker.
  delete env.NODE_TEST_CONTEXT;
  return env;
}

function invoke(root, args = [], {direct = false} = {}) {
  return spawnSync(process.execPath, direct ? ['--test', ...args, ...readPureTestFiles(root)] : ['scripts/run-pure-tests.mjs', ...args], {
    cwd: root, encoding: 'utf8', timeout: 15_000, env: fixtureEnvironment(),
  });
}

test('the short npm launcher preserves every pre-migration test path in its original order', () => {
  const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  assert.equal(pkg.scripts.test, 'node scripts/run-pure-tests.mjs');
  assert.ok(pkg.scripts.test.length < 128, 'The Windows shell must never receive the expanded inventory');
  const files = readPureTestFiles();
  // 71976acc2 had 221 explicit files in an 8,476-character command. New suites
  // can be appended without dropping or reordering that reviewed inventory.
  assert.equal(createHash('sha256').update(JSON.stringify(files.slice(0, 221))).digest('hex'), 'd8c4147ebd41419d0155b280991302ae1d79b64136752161f146c923489b133f');
  assert.equal(files.filter(file => file === 'tests/pure-test-launcher.test.js').length, 1);
  assert.equal(new Set(files).size, files.length);
  assert.ok(['--test', ...files].join(' ').length > 8191);
});

test('the inventory rejects missing, duplicate, directory, empty and implicit paths before spawning', t => {
  const {root, files} = fixture(t);
  mkdirSync(join(root, 'tests/directory.test.js'));
  for (const invalid of [[], {}, null, [null], [42], [files[0], files[0]], ['tests/missing.test.js'], ['tests/directory.test.js'], ['tests/*.test.js'], ['tests/../one.test.js'], ['../tests/one.test.js'], ['--test'], ['tests']]) {
    writeInventory(root, invalid);
    let spawned = false;
    assert.throws(() => runPureTests({root, spawnChild: () => { spawned = true; }}));
    assert.equal(spawned, false);
  }
  writeFileSync(inventoryPath(root), '{broken');
  assert.throws(() => readPureTestFiles(root), SyntaxError);
});

function mockedRun(root, args = []) {
  const runtime = Object.assign(new EventEmitter(), {execPath: '/node with spaces/node', execArgv: ['--trace-warnings'], pid: 123, exitCode: undefined});
  const child = new EventEmitter(), forwarded = [], selfSignals = [], calls = [], errors = [];
  child.kill = signal => forwarded.push(signal);
  runtime.kill = (pid, signal) => selfSignals.push([pid, signal]);
  runtime.stderr = {write: text => errors.push(text)};
  runPureTests({root, args, runtime, spawnChild: (...call) => { calls.push(call); return child; }});
  return {runtime, child, forwarded, selfSignals, calls, errors};
}

test('one direct Node spawn receives the entire ordered list, inherited I/O and native flags', () => {
  const root = fileURLToPath(new URL('../', import.meta.url));
  const {calls, child} = mockedRun(root, ['--test-reporter=tap', '--test-name-pattern=selected']);
  assert.equal(calls.length, 1);
  assert.equal(calls[0][0], '/node with spaces/node');
  assert.deepEqual(calls[0][1], ['--trace-warnings', '--test', '--test-reporter=tap', '--test-name-pattern=selected', ...readPureTestFiles()]);
  assert.deepEqual(calls[0][2], {cwd: root, stdio: 'inherit', shell: false});
  child.emit('exit', 0, null);
});

test('runner exit codes, startup errors and signals cannot turn into a passing launcher', t => {
  const {root} = fixture(t);
  for (const code of [0, 1, 7, 23, null]) {
    const {runtime, child} = mockedRun(root);
    child.emit('exit', code, null);
    assert.equal(runtime.exitCode, code ?? 1);
    for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) assert.equal(runtime.listenerCount(signal), 0);
  }
  const failed = mockedRun(root);
  failed.child.emit('error', new Error('spawn ENOENT'));
  failed.child.emit('exit', 0, null);
  assert.equal(failed.runtime.exitCode, 1);
  assert.match(failed.errors.join(''), /Cannot run pure tests: spawn ENOENT/);
  for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
    assert.equal(failed.runtime.listenerCount(signal), 0);
    const {runtime, child, forwarded, selfSignals} = mockedRun(root);
    runtime.emit(signal);
    assert.deepEqual(forwarded, [signal]);
    child.emit('exit', null, signal);
    assert.deepEqual(selfSignals, [[123, signal]]);
    assert.equal(runtime.listenerCount(signal), 0, 'Restore the default handler before re-raising');
  }
});

test('real Node fixtures preserve independent workers, flags, inherited environment and failure status', t => {
  const source = name => `import test from 'node:test'; import assert from 'node:assert/strict';
    assert.equal(globalThis.fixtureWorker, undefined); globalThis.fixtureWorker = '${name}';
    test('selected ${name}', () => { assert.equal(process.env.WMH_LAUNCHER_FIXTURE, 'inherited'); console.log('WORKER_PID=' + process.pid); });
    test('deliberate failure ${name}', () => { assert.fail('Expected fixture failure'); });`;
  const {root} = fixture(t, {one: source('one'), two: source('two')});
  const args = ['--test-reporter=tap', '--test-name-pattern=selected'];
  for (const direct of [false, true]) {
    const passed = invoke(root, args, {direct});
    assert.ifError(passed.error);
    assert.equal(passed.status, 0, passed.stdout + passed.stderr);
    assert.equal(passed.signal, null);
    const pids = [...passed.stdout.matchAll(/WORKER_PID=(\d+)/g)].map(match => match[1]);
    assert.equal(pids.length, 2);
    assert.equal(new Set(pids).size, 2, 'Each file must use its own native Node test process');
    assert.doesNotMatch(passed.stdout + passed.stderr, /Unlisted browser suite executed/);
    const failed = invoke(root, ['--test-reporter=tap'], {direct});
    assert.ifError(failed.error);
    assert.equal(failed.status, 1, failed.stdout + failed.stderr);
    assert.match(failed.stdout, /Expected fixture failure/);
  }
  writeInventory(root, ['tests/missing.test.js']);
  const missing = invoke(root);
  assert.equal(missing.status, 1);
  assert.match(missing.stderr, /Cannot run pure tests:.*ENOENT/);
});

test('an actual spawn failure exits unsuccessfully', async t => {
  const {root} = fixture(t);
  const entry = join(root, 'spawn-error.mjs');
  writeFileSync(entry, `import {spawn} from 'node:child_process'; import {runPureTests} from './scripts/run-pure-tests.mjs';
    runPureTests({spawnChild: (_command, args, options) => spawn(${JSON.stringify(join(root, 'missing-node'))}, args, options)});`);
  const child = spawn(process.execPath, [entry], {cwd: root, env: fixtureEnvironment(), stdio: ['ignore', 'pipe', 'pipe']});
  let stderr = '';
  child.stderr.on('data', chunk => { stderr += chunk; });
  const [code, signal] = await once(child, 'close');
  assert.equal(code, 1);
  assert.equal(signal, null);
  assert.match(stderr, /Cannot run pure tests:.*ENOENT/);
});

test('a real signalled Node runner has the same outcome through the launcher', t => {
  const {root} = fixture(t, {one: "import test from 'node:test'; test('terminate the fixture runner', () => process.kill(process.ppid, 'SIGTERM'));"});
  const direct = invoke(root, [], {direct: true});
  const wrapped = invoke(root);
  assert.ifError(direct.error);
  assert.ifError(wrapped.error);
  assert.notEqual(direct.status, 0, 'The native runner must terminate unsuccessfully');
  assert.deepEqual({status: wrapped.status, signal: wrapped.signal}, {status: direct.status, signal: direct.signal});
});
