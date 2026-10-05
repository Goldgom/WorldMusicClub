import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import test from 'node:test';

const root = fileURLToPath(new URL('../', import.meta.url));
const python = process.env.PYTHON || (process.platform === 'win32' ? 'python' : 'python3');
const parsed = spawnSync(python, ['scripts/check-authoring-workflow.py', '.github/workflows/library-management-preview.yml', '--json'], {cwd: root, encoding: 'utf8', timeout: 10000});
assert.ifError(parsed.error);
assert.equal(parsed.status, 0, parsed.stderr);
const workflow = JSON.parse(parsed.stdout), jobIds = ['management-browser', 'management-windows'];
const step = (id, command) => workflow.jobs[id].steps.find(row => row.run?.includes(command));

test('management proof runs only on its named preview branch or explicit dispatch with exact frozen source', () => {
  assert.deepEqual(workflow.on, {push: {branches: ['preview/library-management']}, workflow_dispatch: null});
  assert.deepEqual(workflow.permissions, {contents: 'read'});
  for (const id of jobIds) {
    const job = workflow.jobs[id];
    assert.equal(job['runs-on'], id === 'management-browser' ? 'ubuntu-latest' : 'windows-latest');
    assert.equal(job.if, undefined); assert.equal(job['continue-on-error'], undefined);
    assert.ok(job['timeout-minutes'] > 0 && job['timeout-minutes'] <= 45);
    assert.deepEqual(job.steps.find(row => row.uses?.startsWith('actions/checkout@')).with, {ref: '${{ github.sha }}', 'fetch-depth': 0});
    for (const row of job.steps) {
      assert.equal(row['continue-on-error'], undefined);
      if (row.run && row.if) assert.match(row.if, /^\$\{\{ !cancelled\(\) && steps\.management_(browser_ready|catalog_browser)\.outcome == 'success' \}\}$/);
      if (row.uses) assert.match(row.uses, /@[a-f0-9]{40}$/);
    }
    assert.ok(step(id, 'npm run prepare:engraving'));
    assert.ok(step(id, 'python -m pip install PyYAML==6.0.3'));
    assert.ok(step(id, 'git rev-parse HEAD'));
    assert.ok(step(id, 'git status --porcelain --untracked-files=normal'));
  }
});

test('real browser gates use a freshly built driver and disjoint owned output roots before independent proof verification', () => {
  const id = 'management-browser', steps = workflow.jobs[id].steps;
  const build = step(id, 'cargo build -p worldmusichub-desktop --example native_import_driver --locked');
  assert.ok(build);
  const outputs = [];
  for (const command of ['npm run test:pack-management-hosted', 'npm run test:library-catalog-hosted']) {
    const run = step(id, command); assert.ok(run);
    assert.ok(steps.indexOf(build) < steps.indexOf(run));
    assert.equal(run.env.WMH_HOSTED_BROWSER, '1');
    assert.equal(run.env.WMH_SOURCE_SHA, '${{ github.sha }}');
    assert.equal(run.env.WMH_NATIVE_IMPORT_DRIVER, '${{ github.workspace }}/target/debug/examples/native_import_driver');
    assert.match(run.env.WMH_ARTIFACT_DIR, /^\$\{\{ runner.temp \}\}\/library-management-browser\/(packs|catalog)$/);
    assert.ok(run['timeout-minutes'] >= (command.includes('catalog') ? 13 : 4));
    outputs.push(run.env.WMH_ARTIFACT_DIR);
  }
  assert.equal(new Set(outputs).size, 2);
  assert.equal(step(id, 'npm run test:library-catalog-hosted').if, "${{ !cancelled() && steps.management_browser_ready.outcome == 'success' }}");
  const verify = step(id, 'verify-library-catalog-acceptance.mjs --check');
  assert.equal(verify.env.WMH_SOURCE_SHA, '${{ github.sha }}');
  assert.ok(verify.env.WMH_NATIVE_IMPORT_DRIVER);
  assert.match(verify.run, /WMH_SOURCE_TREE=.*git rev-parse 'HEAD\^\{tree\}'/);
});

test('Windows builds its actual EXE before the three-process shared-profile scenario and independently rechecks it', () => {
  const id = 'management-windows', steps = workflow.jobs[id].steps;
  const build = step(id, 'cargo build -p worldmusichub-desktop --release --locked');
  const run = step(id, '-Scenario library-catalog');
  assert.ok(build && run && steps.indexOf(build) < steps.indexOf(run));
  assert.equal(run.shell, 'pwsh'); assert.ok(run['timeout-minutes'] >= 13);
  assert.match(run.run, /-OutputDirectory "\$env:RUNNER_TEMP\/library-management-windows" -Scenario library-catalog/);
  assert.ok(step(id, './tests/windows-desktop-contract.ps1'));
  const verify = step(id, 'verify-library-catalog-acceptance.mjs --check');
  assert.equal(verify.env.WMH_SOURCE_SHA, '${{ github.sha }}');
  assert.equal(verify.env.WMH_LIBRARY_CATALOG_EXECUTABLE, '${{ github.workspace }}/target/release/worldmusichub-desktop.exe');
  assert.match(verify.run, /WMH_SOURCE_TREE=git rev-parse 'HEAD\^\{tree\}'/);
  assert.match(verify.run, /LASTEXITCODE -ne 0/);
});

test('failed runs retain evidence and exact binaries without browser profiles, while summary requires both gates', () => {
  for (const id of jobIds) {
    const artifact = workflow.jobs[id].steps.find(row => row.uses?.startsWith('actions/upload-artifact@'));
    assert.equal(artifact.if, 'always()');
    assert.equal(artifact.with['include-hidden-files'], true);
    assert.ok(artifact.with.name.includes('${{ github.sha }}'));
    assert.match(artifact.with.path, /!\$\{\{ runner.temp \}\}\/[^\n]*webview-catalog-profile\/\*\*/);
    assert.ok(artifact.with.path.includes(id.endsWith('browser') ? 'target/debug/examples/native_import_driver' : 'target/release/worldmusichub-desktop.exe'));
  }
  const summary = workflow.jobs['management-focused-summary'];
  assert.deepEqual(summary.needs, jobIds); assert.equal(summary.if, 'always()');
  assert.match(summary.steps[0].run, /test "\$BROWSER" = success/);
  assert.match(summary.steps[0].run, /test "\$WINDOWS" = success/);
  assert.match(summary.steps[0].run, /full release gates and visual review remain separate/);
});
