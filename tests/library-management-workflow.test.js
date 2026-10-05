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

test('Python manifest checks install the locked Node evidence verifier dependencies on both Rust runners', () => {
  const parsed = spawnSync(python, ['scripts/check-authoring-workflow.py', '.github/workflows/check.yml', '--json'], {cwd: root, encoding: 'utf8', timeout: 10000});
  assert.equal(parsed.status, 0, parsed.stderr);
  const rust = JSON.parse(parsed.stdout).jobs.rust;
  assert.deepEqual(rust.strategy.matrix.os, ['ubuntu-latest', 'windows-latest']);
  function verify(steps) {
    const tests = steps.findIndex(row => row.run === "python -m unittest discover -s tests -p 'test_*.py'");
    const node = steps.findIndex(row => row.uses?.startsWith('actions/setup-node@') && row.with?.['node-version'] === '22');
    const dependencies = steps.findIndex(row => row.run === 'npm ci --ignore-scripts --omit=optional');
    assert.ok(node >= 0 && dependencies > node && tests > dependencies, 'The independent Node verifier needs installed locked dependencies before Python invokes it');
    for (const row of [steps[node], steps[dependencies]]) { assert.equal(row.if, undefined); assert.equal(row['continue-on-error'], undefined); }
  }
  verify(rust.steps);
  assert.throws(() => verify(rust.steps.filter(row => row.run !== 'npm ci --ignore-scripts --omit=optional')));
});

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

const fullParsed = spawnSync(python, ['scripts/check-authoring-workflow.py', '.github/workflows/windows-desktop-acceptance.yml', '--json'], {cwd: root, encoding: 'utf8', timeout: 10000});
assert.ifError(fullParsed.error);
assert.equal(fullParsed.status, 0, fullParsed.stderr);
const fullWorkflow = JSON.parse(fullParsed.stdout);

function fullManagementContract(document) {
  assert.deepEqual(document.on, {push: {branches: ['integration/native-desktop', 'validation/**']}, workflow_dispatch: null});
  assert.deepEqual(document.permissions, {contents: 'read'});
  const browser = document.jobs['bulk-import-browser'], native = document.jobs['native-feature-acceptance'];
  assert.ok(browser['timeout-minutes'] > 20 && browser['timeout-minutes'] <= 45);
  assert.ok(native['timeout-minutes'] > 45 && native['timeout-minutes'] <= 60);
  const browserReady = browser.steps.findIndex(row => row.id === 'dense_browser_setup');
  const driverReady = browser.steps.findIndex(row => row.id === 'dense_native_driver');
  const roots = [];
  for (const [id, command, folder, bound] of [
    ['management_pack_browser', 'test:pack-management-hosted', 'packs', 6],
    ['management_catalog_browser', 'test:library-catalog-hosted', 'catalog', 15],
  ]) {
    const run = browser.steps.find(row => row.id === id); assert.ok(run);
    assert.ok(browserReady >= 0 && driverReady >= 0 && browser.steps.indexOf(run) > Math.max(browserReady, driverReady));
    assert.equal(run.if, "${{ !cancelled() && steps.dense_native_driver.outcome == 'success' && steps.dense_browser_setup.outcome == 'success' }}");
    assert.equal(run['continue-on-error'], undefined);
    assert.equal(run['timeout-minutes'], bound);
    assert.equal(run.env.WMH_HOSTED_BROWSER, '1');
    assert.equal(run.env.WMH_SOURCE_SHA, '${{ github.sha }}');
    assert.equal(run.env.WMH_NATIVE_IMPORT_DRIVER, '${{ github.workspace }}/target/debug/examples/native_import_driver');
    assert.equal(run.env.WMH_ARTIFACT_DIR, `\${{ runner.temp }}/library-management-browser/${folder}`);
    assert.deepEqual(run.run.trim().split('\n'), ['test ! -e "$WMH_ARTIFACT_DIR"', `npm run ${command}`]);
    roots.push(run.env.WMH_ARTIFACT_DIR);
  }
  assert.equal(new Set(roots).size, 2, 'Pack and catalog evidence cannot share a root');
  const browserCheck = browser.steps.find(row => row.id === 'management_catalog_browser_verify');
  assert.ok(browserCheck);
  assert.equal(browserCheck.env.WMH_SOURCE_SHA, '${{ github.sha }}');
  assert.equal(browserCheck.env.WMH_NATIVE_IMPORT_DRIVER, '${{ github.workspace }}/target/debug/examples/native_import_driver');
  assert.match(browserCheck.run, /export WMH_SOURCE_TREE="\$\(git rev-parse 'HEAD\^\{tree\}'\)"/);
  assert.match(browserCheck.run, /verify-library-catalog-acceptance\.mjs --check "\$RUNNER_TEMP\/library-management-browser\/catalog"/);
  const scenario = native.steps.find(row => row.id === 'management_catalog_windows');
  const verify = native.steps.find(row => row.id === 'management_catalog_windows_verify');
  const pack = native.steps.find(row => row.id === 'native_package');
  assert.ok(scenario && verify && pack);
  assert.ok(native.steps.indexOf(scenario) < native.steps.indexOf(verify) && native.steps.indexOf(verify) < native.steps.indexOf(pack));
  assert.equal(scenario.if, "${{ !cancelled() && steps.native_build.outcome == 'success' }}");
  assert.equal(scenario['timeout-minutes'], 15);
  assert.equal(scenario.shell, 'pwsh');
  assert.match(scenario.run, /-Executable target\/release\/worldmusichub-desktop\.exe -OutputDirectory "\$env:RUNNER_TEMP\/library-management-windows" -Scenario library-catalog/);
  assert.match(scenario.run, /git rev-parse HEAD/);
  assert.match(scenario.run, /git status --porcelain --untracked-files=normal/);
  assert.equal(verify.env.WMH_SOURCE_SHA, '${{ github.sha }}');
  assert.equal(verify.env.WMH_LIBRARY_CATALOG_EXECUTABLE, '${{ github.workspace }}/target/release/worldmusichub-desktop.exe');
  assert.match(verify.run, /WMH_SOURCE_TREE=git rev-parse 'HEAD\^\{tree\}'/);
  assert.match(verify.run, /verify-library-catalog-acceptance\.mjs --check "\$env:RUNNER_TEMP\/library-management-windows"/);
  assert.match(verify.run, /if \(\$LASTEXITCODE -ne 0\) \{ throw 'Native catalog exact-source proof failed' \}/);
  assert.equal(pack.if, undefined); assert.equal(pack['continue-on-error'], undefined);
  assert.match(pack.run, /native-release-manifest\.py create [^\n]* --catalog-evidence "\$env:RUNNER_TEMP\/library-management-windows"/);
  assert.match(pack.run, /if \(\$LASTEXITCODE -ne 0\) \{ throw 'Native provenance\/acceptance inventory failed' \}/);
}

test('the full acceptance gate reuses original management scenarios with fresh roots and exact packaged source checks', () => {
  fullManagementContract(fullWorkflow);
});

test('removing management prerequisites, source binding, fresh storage or package evidence breaks the full gate contract', () => {
  const browserStep = (doc, id) => doc.jobs['bulk-import-browser'].steps.find(row => row.id === id);
  const nativeStep = (doc, id) => doc.jobs['native-feature-acceptance'].steps.find(row => row.id === id);
  for (const edit of [
    doc => { browserStep(doc, 'management_pack_browser').if = undefined; },
    doc => { browserStep(doc, 'management_catalog_browser').if = "${{ !cancelled() && steps.management_pack_browser.outcome == 'success' }}"; },
    doc => { browserStep(doc, 'management_catalog_browser').env.WMH_ARTIFACT_DIR = browserStep(doc, 'management_pack_browser').env.WMH_ARTIFACT_DIR; },
    doc => { browserStep(doc, 'management_pack_browser').run = 'npm run test:pack-management-hosted'; },
    doc => { browserStep(doc, 'management_catalog_browser_verify').env.WMH_SOURCE_SHA = 'stale'; },
    doc => { nativeStep(doc, 'management_catalog_windows').run = nativeStep(doc, 'management_catalog_windows').run.replace('target/release/worldmusichub-desktop.exe', 'previous-package.exe'); },
    doc => { nativeStep(doc, 'management_catalog_windows_verify').run = nativeStep(doc, 'management_catalog_windows_verify').run.replace(' --check ', ' '); },
    doc => { nativeStep(doc, 'native_package').run = nativeStep(doc, 'native_package').run.replace(' --catalog-evidence "$env:RUNNER_TEMP/library-management-windows"', ''); },
  ]) {
    const changed = structuredClone(fullWorkflow); edit(changed);
    assert.throws(() => fullManagementContract(changed));
  }
});

test('full management uploads preserve failed original evidence and hidden journal staging while excluding profiles', () => {
  for (const [id, name, paths] of [
    ['bulk-import-browser', 'library-management-browser', [
      '${{ runner.temp }}/library-management-browser/**',
      '!${{ runner.temp }}/library-management-browser/**/webview-catalog-profile/**',
      'target/debug/examples/native_import_driver',
    ]],
    ['native-feature-acceptance', 'library-management-windows', [
      '${{ runner.temp }}/library-management-windows/**',
      '!${{ runner.temp }}/library-management-windows/webview-catalog-profile/**',
      'target/release/worldmusichub-desktop.exe',
    ]],
  ]) {
    const upload = fullWorkflow.jobs[id].steps.find(row => row.with?.name === `${name}-\${{ github.sha }}`);
    assert.ok(upload);
    assert.match(upload.uses, /^actions\/upload-artifact@[a-f0-9]{40}$/);
    assert.equal(upload.if, 'always()');
    assert.equal(upload.with['include-hidden-files'], true);
    assert.equal(upload.with['if-no-files-found'], 'warn');
    assert.deepEqual(upload.with.path.trim().split('\n'), paths);
  }
});


test('focused and full Native Linux gates run the original current-Basic Rust/DOM proof and retain its report',()=>{
  const full=spawnSync(python,['scripts/check-authoring-workflow.py','.github/workflows/windows-desktop-acceptance.yml','--json'],{cwd:root,encoding:'utf8',timeout:10000});assert.equal(full.status,0,full.stderr);
  for(const [job,report] of [[workflow.jobs['management-browser'],'${{ runner.temp }}/library-management-native/current-basic.json'],[JSON.parse(full.stdout).jobs['bulk-import-browser'],'${{ runner.temp }}/library-management-browser/current-basic-native.json']]){
    const steps=job.steps,run=steps.find(row=>row.run?.includes('npm run test:current-basic-catalog-native'));assert.ok(run);
    assert.equal(run.env.WMH_CURRENT_BASIC_REPORT,report);assert.equal(run.env.WMH_CATALOG_DRIVER_BUILD_SHA,'${{ github.sha }}');
    assert.equal(run.env.WMH_NATIVE_IMPORT_DRIVER,'${{ github.workspace }}/target/debug/examples/native_import_driver');
    const build=steps.findIndex(row=>row.run==='cargo build -p worldmusichub-desktop --example native_import_driver --locked');assert.ok(build>=0&&build<steps.indexOf(run));
    const root=report.slice(0,report.lastIndexOf('/'));
    assert.ok(steps.some(row=>row.if==='always()'&&row.uses?.startsWith('actions/upload-artifact@')&&row.with.path.includes(root+'/**')));
  }
});
