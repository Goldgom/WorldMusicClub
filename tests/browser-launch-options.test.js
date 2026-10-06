import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {chromiumLaunchOptions} from './browser-launch-options.js';

// Deterministic launch configuration checks only; no browser or server starts.
for (const timeout of [30_000, 180_000]) {
  test(`managed Chromium remains the default with a ${timeout} ms launch bound`, () => {
    for (const env of [{}, {PLAYWRIGHT_CHROMIUM_EXECUTABLE: ''}]) {
      assert.deepEqual(chromiumLaunchOptions({timeout, env}), {
        headless: true,
        timeout,
        args: ['--no-sandbox', '--disable-dev-shm-usage'],
      });
    }
  });

  test(`explicit Chromium override preserves the ${timeout} ms launch bound and arguments`, () => {
    const executablePath = '/opt/custom browser/chromium';
    assert.deepEqual(chromiumLaunchOptions({timeout, env: {PLAYWRIGHT_CHROMIUM_EXECUTABLE: executablePath}}), {
      executablePath,
      headless: true,
      timeout,
      args: ['--no-sandbox', '--disable-dev-shm-usage'],
    });
  });
}

test('launch configuration rejects unbounded and invalid timeouts', () => {
  for (const timeout of [undefined, 0, -1, Infinity, NaN, '30000']) {
    assert.throws(() => chromiumLaunchOptions({timeout, env: {}}), RangeError);
  }
});

test('browser callers inherit only an explicit process environment executable override', t => {
  const previous = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE;
  t.after(() => {
    if (previous === undefined) delete process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE;
    else process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE = previous;
  });
  delete process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE;
  assert.equal(Object.hasOwn(chromiumLaunchOptions({timeout: 30_000}), 'executablePath'), false);
  process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE = '';
  assert.equal(Object.hasOwn(chromiumLaunchOptions({timeout: 30_000}), 'executablePath'), false);
  const executablePath = '/opt/custom browser/chromium';
  process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE = executablePath;
  assert.equal(chromiumLaunchOptions({timeout: 30_000}).executablePath, executablePath);
});

test('all browser bootstraps use managed selection while preserving their startup budgets', () => {
  for (const [filename, options] of [
    ['full-app-browser.test.js', '{timeout: 30_000}'],
    ['frontend-browser.test.js', '{timeout: 180_000}'],
    ['engraving-browser.test.js', '{timeout: 30_000}'],
  ]) {
    const source = readFileSync(new URL(filename, import.meta.url), 'utf8');
    assert.ok(source.includes("import {chromiumLaunchOptions} from './browser-launch-options.js';"), filename);
    assert.ok(source.includes(`chromium.launch(chromiumLaunchOptions(${options}))`), filename);
    assert.doesNotMatch(source, /\/usr\/bin\/(?:chromium|google-chrome)|PLAYWRIGHT_CHROMIUM_EXECUTABLE/, filename);
  }
  const {scripts} = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  const registered = scripts.test.split(/\s+/).filter(argument => argument.endsWith('.test.js'));
  assert.equal(registered.filter(filename => filename === 'tests/browser-launch-options.test.js').length, 1);
  assert.equal(new Set(registered).size, registered.length, 'npm test must not register duplicate suites');
});
