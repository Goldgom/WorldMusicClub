import {spawn} from 'node:child_process';
import {readFileSync, statSync} from 'node:fs';
import {resolve} from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';

const repositoryRoot = fileURLToPath(new URL('../', import.meta.url));

// Keep this explicit inventory: automatic discovery also selects browser suites.
export function readPureTestFiles(root = repositoryRoot) {
  const files = JSON.parse(readFileSync(resolve(root, 'scripts/pure-test-files.json'), 'utf8'));
  if (!Array.isArray(files) || files.length === 0) throw new Error('Pure test inventory must be a nonempty array');
  const seen = new Set();
  for (const file of files) {
    if (typeof file !== 'string' || !/^tests\/[a-z0-9-]+\.test\.js$/.test(file)) {
      throw new Error(`Invalid explicit pure test path: ${JSON.stringify(file)}`);
    }
    if (seen.has(file)) throw new Error(`Duplicate pure test path: ${file}`);
    seen.add(file);
    if (!statSync(resolve(root, file)).isFile()) throw new Error(`Pure test path is not a file: ${file}`);
  }
  return files;
}

export function runPureTests({root = repositoryRoot, args = process.argv.slice(2), runtime = process, spawnChild = spawn} = {}) {
  const files = readPureTestFiles(root);
  // npm's Windows shell sees only this short launcher. The long, ordered file
  // list goes directly to Node, retaining its normal isolated --test runner.
  const child = spawnChild(runtime.execPath, [...runtime.execArgv, '--test', ...args, ...files], {
    cwd: root, stdio: 'inherit', shell: false,
  });
  const handlers = new Map(['SIGINT', 'SIGTERM', 'SIGHUP'].map(signal => [signal, () => child.kill(signal)]));
  let failed = false;
  const cleanup = () => {
    for (const [signal, handler] of handlers) runtime.removeListener(signal, handler);
  };
  for (const [signal, handler] of handlers) runtime.on(signal, handler);
  child.once('error', error => {
    failed = true;
    cleanup();
    runtime.stderr.write(`Cannot run pure tests: ${error.message}\n`);
    runtime.exitCode = 1;
  });
  child.once('exit', (code, signal) => {
    cleanup();
    if (failed) return;
    if (signal) runtime.kill(runtime.pid, signal);
    else runtime.exitCode = code ?? 1;
  });
  return child;
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  try {
    runPureTests();
  } catch (error) {
    console.error(`Cannot run pure tests: ${error.message}`);
    process.exitCode = 1;
  }
}
