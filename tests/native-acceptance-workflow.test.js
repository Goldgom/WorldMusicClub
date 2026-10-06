import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

const workflow = readFileSync(new URL('../.github/workflows/windows-desktop-acceptance.yml', import.meta.url), 'utf8');
const jobIds = ['bulk-import-browser', 'native-feature-acceptance'];
const mandatoryOutputs = {
  'bulk-import-browser': ['native_clean_profile_routing', 'management_pack_browser', 'management_catalog_browser', 'management_catalog_browser_verify', 'complete_practice_protocol', 'complete_practice_browser', 'canonical_practice_protocol', 'canonical_practice_browser_720', 'canonical_practice_browser_720_verify', 'canonical_practice_browser_640', 'canonical_practice_browser_640_verify'],
  'native-feature-acceptance': ['management_catalog_windows', 'management_catalog_windows_verify', 'complete_practice_windows', 'complete_practice_windows_verify', 'canonical_practice_windows', 'canonical_practice_windows_verify', 'build_diagnostics_windows', 'build_diagnostics_windows_verify', 'native_full_portable', 'native_full_upload', 'native_runtime_package', 'native_runtime_verify', 'native_runtime_startup', 'native_runtime_delivery', 'native_runtime_delivery_verify', 'native_runtime_upload', 'native_runtime_evidence'],
};
// These contracts intentionally inspect the workflow's literal job/step blocks;
// the behavioral cases execute its actual summary program, not a test copy.
function jobBlock(id) {
  const start = workflow.indexOf(`\n  ${id}:\n`);
  assert.notEqual(start, -1, `Missing job ${id}`);
  return workflow.slice(start + 1).split(/\n(?=  [\w-]+:\n)/)[0];
}
function steps(block) {
  return block.split(/\n(?=      - )/).slice(1);
}
const finalJob = jobBlock('acceptance-summary');
const program = finalJob.match(/          node <<'NODE'\n([\s\S]+?)\n          NODE(?:\n|$)/)?.[1]
  .split('\n').map(line => line.slice(10)).join('\n');
assert.ok(program, 'The tested inline summary program must be the workflow entry point');
const sha = 'a'.repeat(40), tree = 'b'.repeat(40), run = '123456';
function passingNeeds() {
  return Object.fromEntries(jobIds.map(id => [id, {
    result: 'success', outputs: { source_sha: sha, source_tree: tree, run_id: run,
      ...(id === 'native-feature-acceptance' ? {full_artifact_id: '201', runtime_artifact_id: '202', runtime_evidence_id: '203', full_sha256: 'e'.repeat(64), runtime_sha256: 'c'.repeat(64), delivery_sha256: 'd'.repeat(64)} : {}),
      ...Object.fromEntries(mandatoryOutputs[id].map(name => [name, 'success'])) },
  }]));
}
function check(needs, extraEnv = {}) {
  const directory = mkdtempSync(join(tmpdir(), 'wmh-acceptance-summary-'));
  const summaryPath = join(directory, 'summary.md');
  try {
    const child = spawnSync(process.execPath, ['-'], {
      input: program, encoding: 'utf8', timeout: 5000,
      env: { ...process.env, ACCEPTANCE_NEEDS: JSON.stringify(needs),
        ACCEPTANCE_SHA: sha, ACCEPTANCE_RUN_ID: run, ACCEPTANCE_REPOSITORY: 'example/original-fixture', GITHUB_STEP_SUMMARY: summaryPath, ...extraEnv },
    });
    assert.ifError(child.error);
    assert.equal(child.signal, null);
    return { status: child.status, summary: readFileSync(summaryPath, 'utf8'), stderr: child.stderr };
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

// Model the runner's default success() guard and the small conjunction grammar
// used by these gates. Read the actual step conditions; never launch acceptance.
function gateRuns(step, { failed = false, cancelled = false, outcomes = {} } = {}) {
  const raw = step.match(/^        if: (.+)$/m)?.[1] || 'success()';
  const condition = raw.replace(/^\$\{\{\s*|\s*\}\}$/g, '');
  if (!/\b(?:success|failure|always|cancelled)\(\)/.test(condition) && (failed || cancelled)) return false;
  const clauses = condition.split(/\s*&&\s*/).map(clause => {
    if (clause === 'success()') return !failed && !cancelled;
    if (clause === '!cancelled()') return !cancelled;
    if (clause === 'always()') return true;
    const prerequisite = clause.match(/^steps\.([a-z_][a-z_0-9]*)\.outcome == 'success'$/)?.[1];
    assert.ok(prerequisite, `Unsupported acceptance condition: ${clause}`);
    return outcomes[prerequisite] === 'success';
  });
  return clauses.every(Boolean);
}

const nativeScenarioOutputs = {
  desktop: 'desktop-acceptance', 'song-folder': 'desktop-song-folder', 'bulk-import': 'desktop-bulk-import',
  'clean-song': 'desktop-clean-song', 'vsq-song': 'desktop-vsq-song', 'performance-song': 'desktop-performance-song',
  'pitch-bend': 'desktop-pitch-bend', authoring: 'desktop-authoring', 'basic-key': 'desktop-basic-key',
  'complete-practice': 'desktop-complete-practice', 'canonical-practice': 'desktop-canonical-practice',
  'vsq-authoring': 'desktop-vsq-authoring', 'library-catalog': '$env:RUNNER_TEMP/library-management-windows',
  'build-diagnostics': 'desktop-build-diagnostics',
};
const nativeScenarioGuard = "${{ !cancelled() && steps.native_build.outcome == 'success' }}";
function assertIndependentNativeScenarios(block) {
  assert.match(block, /^    timeout-minutes: 60$/m);
  assert.doesNotMatch(block, /^    continue-on-error:/m);
  const jobSteps = steps(block), buildIndex = jobSteps.findIndex(step => step.includes('id: native_build\n'));
  assert.ok(buildIndex >= 0);
  assert.match(jobSteps[buildIndex], /run: cargo build -p worldmusichub-desktop --release --locked/);
  assert.doesNotMatch(jobSteps[buildIndex], /^        (?:if|continue-on-error):/m);
  assert.equal((block.match(/\bcargo build\b/g) || []).length, 1, 'All scenarios use one immutable build');
  const packageIndex = jobSteps.findIndex(step => step.includes('id: native_package\n'));
  const scenarios = jobSteps.flatMap((step, index) => {
    const command = step.match(/^\s+(?:run: )?\.\/scripts\/windows-desktop-acceptance\.ps1 (.+)$/m)?.[1];
    if (!command) return [];
    const args = command.match(/^-Executable (\S+) -OutputDirectory ("[^"]+"|\S+)(?: -Scenario ([\w-]+))?$/);
    assert.ok(args, 'Every scenario has an explicit executable and isolated output');
    const [, executable, output, scenario = 'desktop'] = args;
    assert.equal(executable, 'target/release/worldmusichub-desktop.exe');
    assert.ok(index > buildIndex && index < packageIndex, `${scenario} gates packaging`);
    assert.equal(step.match(/^        if: (.+)$/m)?.[1], nativeScenarioGuard);
    assert.match(step, /^        shell: pwsh$/m);
    assert.doesNotMatch(step, /^        continue-on-error:/m);
    return [{scenario, output: output.replace(/^"|"$/g, ''), step}];
  });
  assert.deepEqual(scenarios.map(row => row.scenario), Object.keys(nativeScenarioOutputs), 'No lost or duplicate native scenarios');
  const roots = scenarios.map(row => row.output.replaceAll('\\', '/').toLowerCase());
  for (const [index, root] of roots.entries()) {
    for (const other of roots.slice(index + 1)) {
      assert.ok(root !== other && !root.startsWith(`${other}/`) && !other.startsWith(`${root}/`), 'Scenario output, fixtures, data and profile roots cannot overlap');
    }
  }
  assert.deepEqual(Object.fromEntries(scenarios.map(({scenario, output}) => [scenario, output])), nativeScenarioOutputs);
  for (const step of [jobSteps[packageIndex], jobSteps.find(step => step.includes('Expand-Archive -Path')),
    jobSteps.find(step => step.includes('name: WorldMusicClub-Native-Candidate-'))]) {
    assert.ok(step);
    assert.doesNotMatch(step, /^        (?:if|continue-on-error):/m);
    assert.equal(gateRuns(step, {failed: true, outcomes: {native_build: 'success'}}), false);
  }
  return scenarios;
}

test('each isolated native scenario still runs after a failed peer and requires the exact successful build', () => {
  const scenarios = assertIndependentNativeScenarios(jobBlock(jobIds[1]));
  for (const {scenario, step} of scenarios) {
    assert.equal(gateRuns(step, {failed: true, outcomes: {native_build: 'success'}}), true, scenario);
    assert.equal(gateRuns(step, {cancelled: true, outcomes: {native_build: 'success'}}), false, scenario);
    for (const outcome of ['failure', 'cancelled', 'skipped', undefined]) {
      assert.equal(gateRuns(step, {failed: true, outcomes: {native_build: outcome}}), false, `${scenario}: ${outcome}`);
    }
  }
});

test('native independence contract rejects lost gates, shared folders, stale builds and weakened package admission', () => {
  const block = jobBlock(jobIds[1]), scenarios = assertIndependentNativeScenarios(block);
  const generic = scenarios[0].step;
  for (const mutant of [
    block.replace(generic, ''),
    block.replace('desktop-clean-song -Scenario', 'desktop-bulk-import -Scenario'),
    block.replace('desktop-clean-song -Scenario', 'desktop-bulk-import/nested -Scenario'),
    block.replace(generic, generic.replace('target/release/worldmusichub-desktop.exe', 'downloaded/stale.exe')),
    block.replace(generic, generic.replace(/^        if: .+\n/m, '')),
    block.replace(generic, generic.replace('!cancelled() && ', '')),
    block.replace(generic, generic.replace('!cancelled()', 'success()')),
    block.replace(generic, generic.replace(nativeScenarioGuard, '${{ !cancelled() }}')),
    block.replace(generic, generic.replace('        shell:', '        continue-on-error: true\n        shell:')),
    block.replace('    timeout-minutes: 60', '    timeout-minutes: 120'),
    block.replace('        id: native_package\n', `        id: native_package\n        if: ${nativeScenarioGuard}\n`),
    block.replace(generic, `      - run: cargo build -p worldmusichub-desktop --release --locked\n${generic}`),
  ]) assert.throws(() => assertIndependentNativeScenarios(mutant));
});

const independentGates = [
  { job: jobIds[0], basic: 'node scripts/hosted-basic-key-check.mjs',
    target: 'node scripts/hosted-vsq-authoring-check.mjs',
    prerequisites: { dense_native_driver: 'cargo build -p worldmusichub-desktop --example native_import_driver --locked',
      dense_browser_setup: 'npx playwright install --with-deps chromium' } },
  { job: jobIds[0], basic: 'node scripts/hosted-basic-key-check.mjs',
    target: 'node scripts/hosted-notation-scope-check.mjs',
    prerequisites: { notation_server: 'cargo build -p practice-server --locked',
      dense_browser_setup: 'npx playwright install --with-deps chromium' } },
  { job: jobIds[1], basic: '-Scenario basic-key', target: '-Scenario vsq-authoring',
    prerequisites: { native_build: 'cargo build -p worldmusichub-desktop --release --locked' } },
  ...['npm run test:pack-management-hosted', 'npm run test:library-catalog-hosted'].map(target => ({
    job: jobIds[0], basic: 'node scripts/hosted-basic-key-check.mjs', target,
    prerequisites: { notation_server: 'cargo build -p practice-server --locked',
      dense_native_driver: 'cargo build -p worldmusichub-desktop --example native_import_driver --locked',
      dense_browser_setup: 'npx playwright install --with-deps chromium' },
  })),
  { job: jobIds[1], basic: '-Scenario basic-key', target: '-Scenario library-catalog',
    prerequisites: { native_build: 'cargo build -p worldmusichub-desktop --release --locked' } },
];

test('a failed basic-key gate cannot suppress independent VSQ, twelve-part and management checks', () => {
  for (const { job, basic, target, prerequisites } of independentGates) {
    const jobSteps = steps(jobBlock(job)), basicIndex = jobSteps.findIndex(step => step.includes(basic));
    const targetIndex = jobSteps.findIndex(step => step.includes(target)), gate = jobSteps[targetIndex];
    assert.ok(basicIndex >= 0 && targetIndex > basicIndex, target);
    assert.doesNotMatch(jobSteps[basicIndex], /^        continue-on-error:/m);
    assert.doesNotMatch(gate, /^        continue-on-error:/m);
    const outcomes = Object.fromEntries(Object.keys(prerequisites).map(id => [id, 'success']));
    const actual = [...gate.matchAll(/steps\.([a-z_][a-z_0-9]*)\.outcome/g)].map(match => match[1]);
    assert.deepEqual(actual.sort(), Object.keys(prerequisites).sort(), `${target}: only real inputs`);
    for (const [id, command] of Object.entries(prerequisites)) {
      const index = jobSteps.findIndex(step => step.includes(`id: ${id}\n`));
      assert.ok(index >= 0 && index < basicIndex, `${id} is prepared before the failed basic-key gate`);
      assert.ok(jobSteps[index].includes(`run: ${command}`));
      assert.doesNotMatch(jobSteps[index], /^        (?:if|continue-on-error):/m);
    }
    assert.equal(gateRuns(gate, { outcomes }), true, target);
    assert.equal(gateRuns(gate, { failed: true, outcomes }), true, `${target}: keep collecting after failure`);
    assert.equal(gateRuns(gate, { cancelled: true, outcomes }), false, `${target}: respect cancellation`);
    for (const id of Object.keys(prerequisites)) {
      for (const outcome of ['failure', 'skipped', 'cancelled', undefined]) {
        assert.equal(gateRuns(gate, { failed: true, outcomes: { ...outcomes, [id]: outcome } }), false,
          `${target}: ${id}=${outcome} cannot run`);
      }
    }
    // These regressions would restore GitHub's implicit/explicit success guard.
    const withoutIf = gate.replace(/^        if: .+\n/m, '');
    const implicitSuccess = gate.replace('!cancelled() && ', '');
    const explicitSuccess = gate.replace('!cancelled()', 'success()');
    for (const mutant of [withoutIf, implicitSuccess, explicitSuccess]) {
      assert.equal(gateRuns(mutant, { failed: true, outcomes }), false);
    }
  }
});

test('later independent success cannot erase a failed basic gate or admit its native ZIP', () => {
  const nativeSteps = steps(jobBlock(jobIds[1]));
  const pack = nativeSteps.find(step => step.includes('id: native_package'));
  const extracted = nativeSteps.find(step => step.includes('Expand-Archive -Path'));
  const candidate = nativeSteps.find(step => step.includes('name: WorldMusicClub-Native-Candidate-'));
  for (const gate of [pack, extracted, candidate]) {
    assert.ok(gate);
    assert.doesNotMatch(gate, /^        (?:if|continue-on-error):/m);
    assert.equal(gateRuns(gate, { failed: true }), false, 'A later success does not reset job failure');
  }
  for (const scenario of ['basic-key', 'vsq-authoring']) {
    assert.ok(pack.includes(`--${scenario} desktop-${scenario}`), `${scenario}: exact-source manifest still required`);
  }
  for (const id of jobIds) {
    const needs = passingNeeds();
    needs[id].result = 'failure';
    const result = check(needs);
    assert.equal(result.status, 1);
    assert.ok(result.summary.includes(`${id}: failure (success required)`));
  }
});

test('browser and Windows jobs run independently and export their checked source identity', () => {
  for (const id of jobIds) {
    const block = jobBlock(id);
    assert.doesNotMatch(block, /^    (?:needs|if|continue-on-error):/m, `${id} must run independently`);
    assert.match(block, /ref: \$\{\{ github\.sha \}\}/);
    for (const field of ['source_sha', 'source_tree']) {
      assert.ok(block.includes(`${field}: \${{ steps.acceptance_source.outputs.${field} }}`));
    }
    assert.match(block, /^      run_id: \$\{\{ github\.run_id \}\}$/m);
    const source = steps(block).find(step => step.includes('id: acceptance_source'));
    assert.ok(source);
    assert.match(source, /test "\$\(git rev-parse HEAD\)" = "\$GITHUB_SHA"/);
    assert.match(source, /source_sha=\$\(git rev-parse HEAD\)/);
    assert.match(source, /source_tree=\$\(git rev-parse 'HEAD\^\{tree\}'\)/);
    assert.doesNotMatch(source, /\bif:|continue-on-error:/);
  }
  assert.match(jobBlock(jobIds[0]), /^    runs-on: ubuntu-latest$/m);
  assert.match(jobBlock(jobIds[1]), /^    runs-on: windows-latest$/m);
});

test('the bounded final gate always joins both jobs and cannot succeed by skipping its check', () => {
  const dependencies = finalJob.match(/^    needs: \[([^\]]+)\]$/m)?.[1].split(',').map(id => id.trim());
  assert.deepEqual(dependencies?.sort(), [...jobIds].sort());
  assert.match(finalJob, /^    if: \$\{\{ always\(\) \}\}$/m);
  assert.match(finalJob, /^    timeout-minutes: 5$/m);
  assert.equal(steps(finalJob).length, 1);
  assert.doesNotMatch(steps(finalJob)[0], /^        (?:if|continue-on-error):/m);
  assert.doesNotMatch(finalJob, /uses:|continue-on-error:|\|\|\s*true/);
  assert.match(finalJob, /ACCEPTANCE_NEEDS: \$\{\{ toJSON\(needs\) \}\}/);
  assert.match(finalJob, /ACCEPTANCE_SHA: \$\{\{ github\.sha \}\}/);
  assert.match(finalJob, /ACCEPTANCE_RUN_ID: \$\{\{ github\.run_id \}\}/);
});

test('only success/success passes; every failed, cancelled and skipped combination reports both results', () => {
  const outcomes = ['success', 'failure', 'cancelled', 'skipped'];
  for (const browser of outcomes) {
    for (const native of outcomes) {
      const needs = passingNeeds();
      needs[jobIds[0]].result = browser;
      needs[jobIds[1]].result = native;
      const { status, summary } = check(needs);
      const passed = browser === 'success' && native === 'success';
      assert.equal(status, passed ? 0 : 1, `${browser}/${native}`);
      assert.ok(summary.includes(`Native/browser acceptance: ${passed ? 'PASS' : 'FAIL'}`));
      assert.ok(summary.includes(`${jobIds[0]}: ${browser};`));
      assert.ok(summary.includes(`${jobIds[1]}: ${native};`));
      assert.ok(summary.includes('Verify WorldMusicClub'));
      assert.ok(summary.includes('before package delivery or main promotion'));
    }
  }
});

test('missing jobs/outputs and stale source, tree or run fail even with successful statuses', () => {
  for (const id of jobIds) {
    const missing = passingNeeds();
    delete missing[id];
    assert.equal(check(missing).status, 1, `${id} missing`);
    for (const [field, bad] of [['source_sha', 'c'.repeat(40)], ['source_tree', 'd'.repeat(40)], ['run_id', '654321']]) {
      for (const value of [bad, '']) {
        const needs = passingNeeds();
        needs[id].outputs[field] = value;
        assert.equal(check(needs).status, 1, `${id} ${field} ${value || 'missing'}`);
      }
    }
    const noOutputs = passingNeeds();
    delete noOutputs[id].outputs;
    assert.equal(check(noOutputs).status, 1, `${id} missing outputs`);
  }
  assert.equal(check(passingNeeds(), { ACCEPTANCE_SHA: '' }).status, 1);
  assert.equal(check(passingNeeds(), { ACCEPTANCE_RUN_ID: '' }).status, 1);
});

test('the exact-source summary requires every mandatory run and recheck even when both jobs report success', () => {
  for (const [id, names] of Object.entries(mandatoryOutputs)) {
    const block = jobBlock(id), jobSteps = steps(block);
    for (const name of names) {
      assert.ok(block.includes(`${name}: \${{ steps.${name}.outcome }}`), `${name}: export actual step outcome`);
      assert.equal(jobSteps.filter(step => step.includes(`id: ${name}\n`)).length, 1);
      for (const outcome of ['failure', 'cancelled', 'skipped', '', undefined]) {
        const needs = passingNeeds();
        needs[id].outputs[name] = outcome;
        const result = check(needs);
        assert.equal(result.status, 1, `${id}/${name}=${outcome || 'missing'}`);
        assert.ok(result.summary.includes(`${id}/${name}: ${outcome || 'missing'} (success required)`));
      }
    }
  }
});

test('catalog rechecks collect retained evidence after an unrelated failure but require their own successful scenario', () => {
  for (const [id, scenario, verifier] of [
    [jobIds[0], 'management_catalog_browser', 'management_catalog_browser_verify'],
    [jobIds[1], 'management_catalog_windows', 'management_catalog_windows_verify'],
  ]) {
    const jobSteps = steps(jobBlock(id));
    const scenarioIndex = jobSteps.findIndex(step => step.includes(`id: ${scenario}\n`));
    const verifyIndex = jobSteps.findIndex(step => step.includes(`id: ${verifier}\n`));
    const gate = jobSteps[verifyIndex];
    assert.ok(scenarioIndex >= 0 && verifyIndex > scenarioIndex);
    assert.doesNotMatch(gate, /^        continue-on-error:/m);
    assert.equal(gateRuns(gate, { failed: true, outcomes: { [scenario]: 'success' } }), true);
    assert.equal(gateRuns(gate, { cancelled: true, outcomes: { [scenario]: 'success' } }), false);
    for (const outcome of ['failure', 'skipped', 'cancelled', undefined]) {
      assert.equal(gateRuns(gate, { failed: true, outcomes: { [scenario]: outcome } }), false);
    }
  }
});

test('all real checks fail closed and failure evidence survives independently', () => {
  for (const id of jobIds) {
    for (const step of steps(jobBlock(id))) {
      if (step.includes('continue-on-error:')) {
        assert.match(step, /uses: actions\/cache\/(?:restore|save)@/);
      }
      if (step.includes('uses: actions/upload-artifact@') && !step.includes('name: WorldMusicClub-Native-Candidate-') && !step.includes('name: WorldMusicClub-Native-Runtime-Candidate-')) {
        assert.match(step, /^        if: always\(\)$/m);
      }
    }
  }
  const nativeSteps = steps(jobBlock(jobIds[1]));
  const packageIndex = nativeSteps.findIndex(step => step.includes('id: native_package'));
  const extractedIndex = nativeSteps.findIndex(step => step.includes('Expand-Archive -Path'));
  const candidateIndex = nativeSteps.findIndex(step => step.includes('name: WorldMusicClub-Native-Candidate-'));
  assert.ok(packageIndex > 0 && extractedIndex > packageIndex && candidateIndex > extractedIndex);
  for (const index of [packageIndex, extractedIndex, candidateIndex]) {
    assert.doesNotMatch(nativeSteps[index], /^        (?:if|continue-on-error):/m);
  }
  assert.match(nativeSteps[candidateIndex], /if-no-files-found: error/);
  assert.match(nativeSteps[packageIndex], /native-release-manifest\.py create/);
  assert.match(nativeSteps[packageIndex], /native-release-manifest\.py archive/);
  for (const scenario of ['song-folder', 'bulk-import', 'clean-song', 'vsq-song', 'performance-song', 'pitch-bend', 'authoring']) {
    const index = nativeSteps.findIndex(step => step.includes(`-Scenario ${scenario}`));
    assert.ok(index > 0 && index < packageIndex, `${scenario} gates packaging`);
    assert.doesNotMatch(nativeSteps[index], /^        continue-on-error:/m);
    assert.equal(gateRuns(nativeSteps[index], {failed: true, outcomes: {native_build: 'success'}}), true);
  }
});

test('complete performance uses the exact built driver, both viewport gates and the packaged Windows EXE', () => {
  const browserSteps = steps(jobBlock(jobIds[0]));
  const buildIndex = browserSteps.findIndex(step => step.includes('cargo build -p worldmusichub-desktop --example native_import_driver --locked'));
  const protocolIndex = browserSteps.findIndex(step => step.includes('run: node scripts/check-performance-song-native.mjs'));
  const hostedIndex = browserSteps.findIndex(step => step.includes('node scripts/hosted-performance-song-check.mjs'));
  assert.ok(buildIndex >= 0 && protocolIndex > buildIndex && hostedIndex > protocolIndex);
  assert.doesNotMatch(browserSteps[protocolIndex], /^        (?:if|continue-on-error):/m);
  for (const step of [browserSteps[protocolIndex], browserSteps[hostedIndex]]) {
    assert.match(step, /WMH_NATIVE_IMPORT_DRIVER: \$\{\{ github\.workspace \}\}\/target\/debug\/examples\/native_import_driver/);
    assert.doesNotMatch(step, /^        continue-on-error:/m);
  }
  assert.match(browserSteps[hostedIndex], /WMH_HOSTED_BROWSER: '1'/);
  assert.match(browserSteps[hostedIndex], /WMH_SOURCE_SHA: \$\{\{ github\.sha \}\}/);
  for (const height of [720, 900]) {
    assert.ok(browserSteps[hostedIndex].includes(`WMH_VIEWPORT_HEIGHT=${height} node scripts/hosted-performance-song-check.mjs`));
  }
  const nativeSteps = steps(jobBlock(jobIds[1]));
  const scenario = nativeSteps.find(step => step.includes('-Scenario performance-song'));
  assert.match(scenario, /-Executable target\/release\/worldmusichub-desktop\.exe -OutputDirectory desktop-performance-song -Scenario performance-song/);
  const pack = nativeSteps.find(step => step.includes('id: native_package'));
  assert.match(pack, /node scripts\/verify-native-performance-song-evidence\.mjs --check desktop-performance-song/);
  assert.match(pack, /if \(\$LASTEXITCODE -ne 0\) \{ throw 'Native complete performance exact-source proof failed' \}/);
  for (const guard of ["$performanceProof.source_sha -cne '${{ github.sha }}'", '$performanceProof.source_tree -cne $currentTree',
    '$performanceProof.executable_sha256 -cne $currentExe', '$performanceProof.executable_bytes -ne $currentExeBytes']) {
    assert.ok(pack.includes(guard), guard);
  }
  assert.match(pack, /\$currentExeBytes=\(Get-Item target\/release\/worldmusichub-desktop\.exe\)\.Length/);
  assert.ok(pack.indexOf('verify-native-performance-song-evidence.mjs --check') < pack.indexOf('Copy-Item target/release/worldmusichub-desktop.exe'));
  assert.match(pack, /native-release-manifest\.py create .* --performance-song desktop-performance-song/);
  const testCommand = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).scripts.test.split(/\s+/);
  for (const file of ['performance-song-fixtures.test.js', 'native-performance-song-evidence.test.js', 'vsq-fingering-evidence.test.js']) {
    assert.equal(testCommand.filter(token => token === `tests/${file}`).length, 1);
    assert.ok(nativeSteps.some(step => step.includes('run: node --test ') && step.includes(`tests/${file}`)));
  }
});

test('performance artifacts retain bounded authored evidence without uploading profile trees', () => {
  const suffixes = ['*.json', '*.png', 'downloads/*', 'fixtures/*', 'Scores/clean-songs/**',
    'Scores/clean-backups/**', 'Scores/imports/**', 'Scores/import-backups/**'];
  for (const [id, root, expected] of [
    [jobIds[0], 'test-results/performance-song/*/', suffixes],
    [jobIds[1], 'desktop-performance-song/', [...suffixes, '*.log']],
  ]) {
    const upload = steps(jobBlock(id)).find(step => step.includes('uses: actions/upload-artifact@') && step.includes(root));
    assert.ok(upload);
    assert.match(upload, /^        if: always\(\)$/m);
    const paths = [...upload.matchAll(/^            (.+)$/gm)].map(match => match[1]).filter(path => path.startsWith(root));
    assert.deepEqual(paths.sort(), expected.map(suffix => root + suffix).sort());
    assert.doesNotMatch(paths.join('\n'), /webview-profile|prior-profile|AppData|USERPROFILE/);
  }
  const ignore = readFileSync(new URL('../.gitignore', import.meta.url), 'utf8');
  assert.match(ignore, /^\/desktop-performance-song\/$/m);
  assert.doesNotMatch(ignore, /^\/desktop-\*\/?$/m);
});


test('pitch browser heights and actual Windows scenario are mandatory before the exact-source package gate', () => {
  const browserSteps = steps(jobBlock(jobIds[0]));
  const buildIndex = browserSteps.findIndex(step => step.includes('cargo build -p worldmusichub-desktop --example native_import_driver --locked'));
  const protocolIndex = browserSteps.findIndex(step => step.includes('run: node scripts/check-pitch-bend-native.mjs'));
  const hostedIndex = browserSteps.findIndex(step => step.includes('node scripts/hosted-pitch-bend-check.mjs'));
  assert.ok(buildIndex >= 0 && protocolIndex > buildIndex && hostedIndex > protocolIndex);
  assert.doesNotMatch(browserSteps[protocolIndex], /^        (?:if|continue-on-error):/m);
  for (const step of [browserSteps[protocolIndex], browserSteps[hostedIndex]]) {
    assert.match(step, /WMH_NATIVE_IMPORT_DRIVER: \$\{\{ github\.workspace \}\}\/target\/debug\/examples\/native_import_driver/);
    assert.doesNotMatch(step, /^        continue-on-error:/m);
  }
  assert.match(browserSteps[hostedIndex], /WMH_HOSTED_BROWSER: '1'/);
  assert.match(browserSteps[hostedIndex], /WMH_SOURCE_SHA: \$\{\{ github\.sha \}\}/);
  for (const height of [720, 900]) assert.ok(browserSteps[hostedIndex].includes(`WMH_VIEWPORT_HEIGHT=${height} node scripts/hosted-pitch-bend-check.mjs`));
  const nativeSteps = steps(jobBlock(jobIds[1]));
  const scenarioIndex = nativeSteps.findIndex(step => step.includes('-Scenario pitch-bend'));
  const packageIndex = nativeSteps.findIndex(step => step.includes('id: native_package'));
  assert.ok(scenarioIndex > 0 && scenarioIndex < packageIndex);
  assert.match(nativeSteps[scenarioIndex], /-Executable target\/release\/worldmusichub-desktop\.exe -OutputDirectory desktop-pitch-bend -Scenario pitch-bend/);
  assert.doesNotMatch(nativeSteps[scenarioIndex], /^        continue-on-error:/m);
  assert.equal(gateRuns(nativeSteps[scenarioIndex], {failed: true, outcomes: {native_build: 'success'}}), true);
  const pack = nativeSteps[packageIndex];
  assert.match(pack, /node scripts\/verify-native-pitch-bend-evidence\.mjs --check desktop-pitch-bend/);
  assert.match(pack, /if \(\$LASTEXITCODE -ne 0\) \{ throw 'Native pitch-bend exact-source proof failed' \}/);
  for (const guard of ["$pitchProof.source_sha -cne '${{ github.sha }}'", '$pitchProof.source_tree -cne $currentTree',
    '$pitchProof.executable_sha256 -cne $currentExe', '$pitchProof.executable_bytes -ne $currentExeBytes']) assert.ok(pack.includes(guard), guard);
  assert.match(pack, /python scripts\/native-pitch-bend-manifest\.py desktop-pitch-bend --executable target\/release\/worldmusichub-desktop\.exe --commit '\$\{\{ github.sha \}\}' --tree \$currentTree/);
  assert.match(pack, /if \(\$LASTEXITCODE -ne 0\) \{ throw 'Native pitch-bend focused manifest failed' \}/);
  for (const proof of ['verify-native-pitch-bend-evidence.mjs --check', 'native-pitch-bend-manifest.py desktop-pitch-bend']) assert.ok(pack.indexOf(proof) < pack.indexOf('Copy-Item target/release/worldmusichub-desktop.exe'));
  assert.match(pack, /native-release-manifest\.py create .* --pitch-bend desktop-pitch-bend/);
  const testCommand = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).scripts.test.split(/\s+/);
  for (const file of ['pitch-bend-import-baseline.test.js', 'native-pitch-bend-evidence.test.js', 'pitch-bend-acceptance-workflow.test.js']) {
    assert.equal(testCommand.filter(token => token === `tests/${file}`).length, 1);
    for (const jobSteps of [browserSteps, nativeSteps]) assert.ok(jobSteps.some(step => step.includes('run: node --test ') && step.includes(`tests/${file}`)));
  }
});

test('mandatory pitch artifacts use exact original-only roots and omit every browser profile tree', () => {
  const suffixes = ['*.json', '*.png', 'downloads/*', 'fixtures/*', 'Scores/clean-songs/**',
    'Scores/clean-backups/**', 'Scores/imports/**', 'Scores/import-backups/**'];
  for (const [id, root, expected] of [
    [jobIds[0], 'test-results/pitch-bend/*/', suffixes],
    [jobIds[1], 'desktop-pitch-bend/', [...suffixes, '*.log']],
  ]) {
    const upload = steps(jobBlock(id)).find(step => step.includes('uses: actions/upload-artifact@') && step.includes(root));
    assert.ok(upload);assert.match(upload, /^        if: always\(\)$/m);
    const paths = [...upload.matchAll(/^            (.+)$/gm)].map(match => match[1]).filter(path => path.startsWith(root));
    assert.deepEqual(paths.sort(), expected.map(suffix => root + suffix).sort());
    assert.doesNotMatch(paths.join('\n'), /webview-profile|prior-profile|AppData|USERPROFILE/);
  }
});

test('all fresh native scenarios retain small profile proofs and exclude retained browser caches', () => {
  const nativeSteps = steps(jobBlock(jobIds[1]));
  const upload = nativeSteps.find(step => step.includes('uses: actions/upload-artifact@') && step.includes('desktop-song-folder/'));
  const paths = [...upload.matchAll(/^            (.+)$/gm)].map(match => match[1]);
  for (const scenario of ['song-folder', 'bulk-import', 'clean-song', 'vsq-song', 'performance-song', 'pitch-bend', 'authoring']) {
    const prefix = `desktop-${scenario}/`, own = paths.filter(path => path.startsWith(prefix));
    assert.ok(own.includes(`${prefix}*.json`), 'host profile JSON survives success and failure');
    assert.ok(own.length > 0);
    for (const path of own) assert.match(path.slice(prefix.length), /^(?:\*\.(?:json|png|log)|(?:downloads|fixtures)\/\*(?:\.(?:json|zip))?|Scores\/(?:songs|backups|clean-songs|clean-backups|imports|import-backups)\/(?:\*\/\*|\*\*))$/);
    assert.doesNotMatch(own.join('\n'), /webview-profile|prior-profile/);
  }
  const pack = nativeSteps.find(step => step.includes('id: native_package'));
  for (const phase of ['bulk', 'clean', 'vsq']) assert.ok(pack.includes(`/profile-${phase}-*.json`));
  const native = readFileSync(new URL('../scripts/windows-desktop-acceptance.ps1', import.meta.url), 'utf8');
  const windows = readFileSync(new URL('../crates/desktop-shell/src/windows.rs', import.meta.url), 'utf8');
  assert.match(windows, /acceptance\.prepare_webview_profile\(\)\?/);
  assert.match(windows, /builder = builder\.data_directory\(profile\)/);
  assert.match(native, /Assert-AcceptanceProfileLaunch \$OutputDirectory \$phase/);
  assert.match(native, /Assert-AcceptanceProfileEvidence \$OutputDirectory \$profileSelection \$app.Id/);
  assert.doesNotMatch(native, /Rotate-SongFolderProfile|prior-profile/);
  assert.match(native, /\$app\.WaitForExit\(10000\)/);
});


test('one failed picker cannot hide later independent song browser evidence', () => {
  const jobSteps=steps(jobBlock(jobIds[0]));
  const predecessor=jobSteps.findIndex(step=>step.includes('npm run test:bulk-import-hosted'));
  const inputs={notation_server:'success',dense_native_driver:'success',dense_browser_setup:'success'};
  for(const name of ['vsq-song','performance-song','pitch-bend','song-authoring','basic-key']) {
    const index=jobSteps.findIndex(step=>step.includes(`node scripts/hosted-${name}-check.mjs`)),gate=jobSteps[index];
    assert.ok(index>predecessor);assert.doesNotMatch(gate,/^        continue-on-error:/m);
    assert.deepEqual([...gate.matchAll(/steps\.([a-z_][a-z_0-9]*)\.outcome/g)].map(row=>row[1]).sort(),Object.keys(inputs).sort());
    assert.equal(gateRuns(gate,{failed:true,outcomes:inputs}),true);
    assert.equal(gateRuns(gate,{cancelled:true,outcomes:inputs}),false);
    for(const key of Object.keys(inputs))for(const outcome of ['failure','skipped','cancelled',undefined])
      assert.equal(gateRuns(gate,{failed:true,outcomes:{...inputs,[key]:outcome}}),false);
    for(const mutation of [gate.replace(/^        if: .+\n/m,''),gate.replace('!cancelled()','success()')])
      assert.equal(gateRuns(mutation,{failed:true,outcomes:inputs}),false);
  }
  const failed=passingNeeds();failed['bulk-import-browser'].result='failure';
  const result=check(failed);assert.notEqual(result.status,0);
});

test('complete-practice stays mandatory in normal validation, package source binding and final summary', () => {
  const browser = steps(jobBlock(jobIds[0])), native = steps(jobBlock(jobIds[1]));
  const protocol = browser.find(step => step.includes('id: complete_practice_protocol\n'));
  const hosted = browser.find(step => step.includes('id: complete_practice_browser\n'));
  const windows = native.find(step => step.includes('id: complete_practice_windows\n'));
  const verify = native.find(step => step.includes('id: complete_practice_windows_verify\n'));
  const pack = native.find(step => step.includes('id: native_package\n'));
  for (const [step, prerequisites] of [[protocol, {dense_native_driver: 'success', complete_practice_converter: 'success'}], [hosted, {notation_server: 'success', dense_native_driver: 'success', dense_browser_setup: 'success'}], [windows, {native_build: 'success'}], [verify, {complete_practice_windows: 'success'}]]) {
    assert.ok(step); assert.doesNotMatch(step, /continue-on-error/);
    assert.equal(gateRuns(step, {failed: true, outcomes: prerequisites}), true, 'Unrelated earlier failure must not hide this isolated evidence');
    assert.equal(gateRuns(step, {cancelled: true, outcomes: prerequisites}), false);
    for (const prerequisite of Object.keys(prerequisites)) for (const outcome of ['failure', 'cancelled', 'skipped', undefined]) assert.equal(gateRuns(step, {outcomes: {...prerequisites, [prerequisite]: outcome}}), false);
  }
  assert.match(protocol, /WMH_SOURCE_SHA: \$\{\{ github.sha \}\}/); assert.match(protocol, /check-complete-practice-native.mjs/);
  for (const size of ['WMH_VIEWPORT_WIDTH=1280 WMH_VIEWPORT_HEIGHT=720', 'WMH_VIEWPORT_WIDTH=960 WMH_VIEWPORT_HEIGHT=640']) assert.ok(hosted.includes(`${size} node scripts/hosted-complete-practice-check.mjs`));
  assert.match(windows, /-OutputDirectory desktop-complete-practice -Scenario complete-practice/);
  assert.match(verify, /WMH_SOURCE_SHA: \$\{\{ github.sha \}\}/); assert.match(verify, /WMH_SOURCE_TREE=.*HEAD\^\{tree\}/); assert.match(verify, /WMH_COMPLETE_PRACTICE_EXECUTABLE:.*target\/release\/worldmusichub-desktop.exe/); assert.match(verify, /verify-complete-practice-evidence.mjs --check desktop-complete-practice/);
  assert.ok(native.indexOf(windows) < native.indexOf(verify) && native.indexOf(verify) < native.indexOf(pack));
  assert.ok(pack.indexOf('verify-complete-practice-evidence.mjs --check desktop-complete-practice') < pack.indexOf('native-release-manifest.py create'));
  assert.match(pack, /WMH_COMPLETE_PRACTICE_EXECUTABLE=\(Resolve-Path 'target\/release\/worldmusichub-desktop.exe'\).Path/);
  assert.match(pack, /Copy-Item desktop-complete-practice\/native-complete-practice.json,desktop-complete-practice\/complete-practice-proof.json/);
  assert.equal(gateRuns(pack, {failed: true}), false); assert.doesNotMatch(pack, /^        (?:if|continue-on-error):/m);
  for (const [jobSteps, paths] of [[browser, ['test-results/complete-practice/*/*.json', 'test-results/complete-practice/*/*.png', 'test-results/complete-practice/*/downloads/*.json']], [native, ['desktop-complete-practice/*.json', 'desktop-complete-practice/*.png', 'desktop-complete-practice/downloads/*.json']]]) {
    const artifact = jobSteps.find(step => paths.every(path => step.includes(path)));
    assert.ok(artifact); assert.match(artifact, /^        if: always\(\)$/m); assert.match(artifact, /actions\/upload-artifact@/);
  }
  const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  assert.equal(pkg.scripts.test.split(/\s+/).filter(file => file === 'tests/complete-practice-acceptance.test.js').length, 1);
  const quick = readFileSync(new URL('../scripts/quick-development-checks.mjs', import.meta.url), 'utf8');
  assert.match(quick, /real browser and screenshots/); assert.match(quick, /Windows Rust\/native input/); assert.match(quick, /accepted:false/);
});


test('failed packaging still retains original desktop downloads without profile directories', () => {
  const upload = steps(jobBlock('native-feature-acceptance')).find(step => step.includes('name: native-feature-evidence-'));
  assert.ok(upload); assert.equal(gateRuns(upload, {failed: true}), true);
  const paths = [...upload.matchAll(/^            (.+)$/gm)].map(match => match[1]).filter(path => path.startsWith('desktop-acceptance/'));
  assert.deepEqual(paths, ['desktop-acceptance/*.json', 'desktop-acceptance/*.png', 'desktop-acceptance/*.log', 'desktop-acceptance/downloads/*']);
  assert.doesNotMatch(paths.join('\n'), /webview|profile|\*\*/);
});


test('canonical Rust and both actual browser sizes have independent mandatory execution and strict proof gates', () => {
  const browser = steps(jobBlock(jobIds[0]));
  const find = id => browser.find(step => step.includes(`id: ${id}\n`));
  const protocol = find('canonical_practice_protocol');
  assert.equal(browser.indexOf(protocol), browser.indexOf(find('complete_practice_protocol')) + 1);
  assert.match(protocol, /run: node scripts\/check-canonical-practice-native\.mjs/);
  assert.match(protocol, /WMH_CANONICAL_PRACTICE_REPORT: \$\{\{ github\.workspace \}\}\/test-results\/canonical-practice\/native-protocol\/report\.json/);
  const build = browser.find(step => step.includes('id: dense_native_driver\n'));
  const server = browser.find(step => step.includes('id: notation_server\n'));
  const setup = browser.find(step => step.includes('id: dense_browser_setup\n'));
  assert.ok(browser.indexOf(build) < browser.indexOf(protocol));
  assert.equal(browser.filter(step => step.includes('cargo build -p worldmusichub-desktop --example native_import_driver --locked')).length, 1);
  assert.equal(browser.filter(step => step.includes('cargo build -p practice-server --locked')).length, 1);
  const gates = [[protocol, {dense_native_driver: 'success'}, 3]];
  let previous = find('complete_practice_browser');
  for (const [width, height] of [[1280, 720], [960, 640]]) {
    const id = `canonical_practice_browser_${height}`, hosted = find(id), verify = find(`${id}_verify`);
    assert.ok(browser.indexOf(previous) < browser.indexOf(hosted));
    for (const prerequisite of [build, server, setup]) assert.ok(browser.indexOf(prerequisite) < browser.indexOf(hosted));
    assert.ok(browser.indexOf(hosted) < browser.indexOf(verify));
    previous = verify;
    gates.push([hosted, {notation_server: 'success', dense_native_driver: 'success', dense_browser_setup: 'success'}, 8], [verify, {[id]: 'success'}, 2]);
    assert.match(hosted, /WMH_HOSTED_BROWSER: '1'/);
    assert.ok(hosted.includes(`WMH_VIEWPORT_WIDTH: '${width}'`));
    assert.ok(hosted.includes(`WMH_VIEWPORT_HEIGHT: '${height}'`));
    assert.match(hosted, /WMH_SERVER_BINARY: \$\{\{ github\.workspace \}\}\/target\/debug\/practice-server/);
    assert.match(hosted, /test ! -e "\$WMH_ARTIFACT_DIR"/);
    assert.match(hosted, /node scripts\/hosted-canonical-practice-check\.mjs/);
    for (const step of [hosted, verify]) assert.ok(step.includes(`WMH_ARTIFACT_DIR: \${{ github.workspace }}/test-results/canonical-practice/${height}\n`));
    const create = 'node scripts/verify-canonical-practice-evidence.mjs "$WMH_ARTIFACT_DIR"';
    const check = 'node scripts/verify-canonical-practice-evidence.mjs --check "$WMH_ARTIFACT_DIR"';
    assert.ok(verify.includes(create) && verify.indexOf(check) > verify.indexOf(create), 'Create proof first, then check retained proof without rewriting it');
  }
  for (const [step, prerequisites, minutes] of gates) {
    assert.ok(step);
    assert.match(step, /WMH_SOURCE_SHA: \$\{\{ github\.sha \}\}/);
    assert.match(step, /WMH_SOURCE_TREE: \$\{\{ steps\.acceptance_source\.outputs\.source_tree \}\}/);
    assert.match(step, /WMH_NATIVE_IMPORT_DRIVER: \$\{\{ github\.workspace \}\}\/target\/debug\/examples\/native_import_driver/);
    assert.ok(step.includes(`timeout-minutes: ${minutes}\n`));
    assert.doesNotMatch(step, /continue-on-error/);
    assert.deepEqual([...step.matchAll(/steps\.([a-z_][a-z_0-9]*)\.outcome/g)].map(row => row[1]).sort(), Object.keys(prerequisites).sort());
    assert.equal(gateRuns(step, {failed: true, outcomes: prerequisites}), true);
    assert.equal(gateRuns(step, {cancelled: true, outcomes: prerequisites}), false);
    for (const id of Object.keys(prerequisites)) for (const outcome of ['failure', 'skipped', 'cancelled', undefined]) {
      assert.equal(gateRuns(step, {outcomes: {...prerequisites, [id]: outcome}}), false);
    }
  }
  assert.match(jobBlock(jobIds[0]), /^    timeout-minutes: 45$/m);
  assert.match(jobBlock(jobIds[1]), /^    timeout-minutes: 60$/m);
});

test('canonical Windows proof binds the built EXE and source before both package copy and required manifest inclusion', () => {
  const native = steps(jobBlock(jobIds[1]));
  const windows = native.find(step => step.includes('id: canonical_practice_windows\n'));
  const verify = native.find(step => step.includes('id: canonical_practice_windows_verify\n'));
  const pack = native.find(step => step.includes('id: native_package\n'));
  for (const [step, prerequisites, minutes] of [[windows, {native_build: 'success'}, 14], [verify, {canonical_practice_windows: 'success'}, 2]]) {
    assert.ok(step);
    assert.match(step, /WMH_SOURCE_SHA: \$\{\{ github\.sha \}\}/);
    assert.match(step, /WMH_CANONICAL_PRACTICE_EXECUTABLE: \$\{\{ github\.workspace \}\}\/target\/release\/worldmusichub-desktop\.exe/);
    assert.ok(step.includes(`timeout-minutes: ${minutes}\n`));
    assert.doesNotMatch(step, /continue-on-error/);
    assert.equal(gateRuns(step, {failed: true, outcomes: prerequisites}), true);
    assert.equal(gateRuns(step, {cancelled: true, outcomes: prerequisites}), false);
    for (const id of Object.keys(prerequisites)) for (const outcome of ['failure', 'skipped', 'cancelled', undefined]) {
      assert.equal(gateRuns(step, {outcomes: {...prerequisites, [id]: outcome}}), false);
    }
  }
  assert.match(windows, /WMH_SOURCE_TREE: \$\{\{ steps\.acceptance_source\.outputs\.source_tree \}\}/);
  assert.match(windows, /git status --porcelain --untracked-files=normal/);
  assert.match(windows, /-Executable target\/release\/worldmusichub-desktop\.exe -OutputDirectory desktop-canonical-practice -Scenario canonical-practice/);
  assert.match(verify, /WMH_SOURCE_TREE=\(git rev-parse 'HEAD\^\{tree\}'\)\.Trim\(\)/);
  const command = 'node scripts/verify-canonical-practice-evidence.mjs --check desktop-canonical-practice';
  assert.ok(verify.includes(command));
  assert.match(verify, /if \(\$LASTEXITCODE -ne 0\) \{ throw 'Canonical-practice exact-source proof failed' \}/);
  assert.ok(native.indexOf(windows) < native.indexOf(verify) && native.indexOf(verify) < native.indexOf(pack));
  const checked = pack.indexOf(command);
  for (const binding of ["$env:WMH_SOURCE_SHA='\${{ github.sha }}'", '$env:WMH_SOURCE_TREE=$currentTree',
    "$env:WMH_CANONICAL_PRACTICE_EXECUTABLE=(Resolve-Path 'target/release/worldmusichub-desktop.exe').Path"]) {
    assert.ok(pack.indexOf(binding) >= 0 && checked > pack.indexOf(binding), binding);
  }
  assert.ok(checked >= 0 && checked < pack.indexOf('Copy-Item target/release/worldmusichub-desktop.exe'));
  assert.ok(checked < pack.indexOf('native-release-manifest.py create'));
  assert.match(pack, /if \(\$LASTEXITCODE -ne 0\) \{ throw 'Canonical-practice evidence does not match exact packaged source and executable' \}/);
  assert.match(pack, /native-release-manifest\.py create .* --canonical-practice desktop-canonical-practice(?: |$)/);
  // The manifest adapter retains the whole bound inventory under
  // evidence/canonical-practice/. Flat copies are forbidden report aliases.
  assert.doesNotMatch(pack, /Copy-Item[^\n]*desktop-canonical-practice\//);
  assert.doesNotMatch(pack, /^        (?:if|continue-on-error):/m);
  assert.equal(gateRuns(pack, {failed: true}), false);
});

test('canonical evidence uploads preserve original proof and score bytes after failure without profile directories', () => {
  const suffixes = ['*.json', '*.png', '*.log', 'downloads/*', 'fixtures/*', 'Scores/songs/**', 'Scores/backups/**'];
  for (const [id, name, root, executable] of [
    [jobIds[0], 'canonical-practice-browser', 'test-results/canonical-practice/*/', 'target/debug/examples/native_import_driver'],
    [jobIds[1], 'canonical-practice-windows', 'desktop-canonical-practice/', 'target/release/worldmusichub-desktop.exe'],
  ]) {
    const upload = steps(jobBlock(id)).find(step => step.includes(`name: ${name}-\${{ github.sha }}`));
    assert.ok(upload); assert.match(upload, /uses: actions\/upload-artifact@/);
    assert.equal(gateRuns(upload, {failed: true}), true);
    assert.equal(gateRuns(upload, {cancelled: true}), true);
    const paths = [...upload.matchAll(/^            (.+)$/gm)].map(row => row[1]);
    assert.deepEqual(paths.sort(), [...suffixes.map(suffix => root + suffix), executable].sort());
    assert.doesNotMatch(paths.join('\n'), /webview-profile|prior-profile|AppData|USERPROFILE/);
  }
  const ignore = readFileSync(new URL('../.gitignore', import.meta.url), 'utf8');
  assert.match(ignore, /^\/desktop-canonical-practice\/$/m);
  assert.doesNotMatch(ignore, /^\/desktop-\*\/?$/m);
});


test('Basic-key Windows diagnostics keep the full evidence and every existing scenario gate',()=>{
  const block=jobBlock('native-feature-acceptance'),jobSteps=steps(block);
  const upload=jobSteps.find(step=>step.includes('name: basic-key-windows-diagnostics-${{ github.sha }}'));
  assert.ok(upload);assert.match(upload,/if: always\(\)/);assert.match(upload,/if-no-files-found: error/);
  const collect=jobSteps[jobSteps.indexOf(upload)-1];
  assert.match(collect,/if: always\(\)/);
  assert.match(collect,/python scripts\/collect-basic-key-diagnostics\.py\s+desktop-basic-key "\$\{\{ runner\.temp \}\}\/basic-key-windows-diagnostics"\s+--source-sha "\$\{\{ github\.sha \}\}"/);
  const full=jobSteps.find(step=>step.includes('name: native-feature-evidence-${{ github.sha }}'));
  assert.match(full,/desktop-basic-key\/\*\.json/);assert.match(full,/desktop-basic-key\/\*\.png/);
  assert.ok(jobSteps.indexOf(full)<jobSteps.indexOf(collect));
  assertIndependentNativeScenarios(block);
});


test('runtime delivery identity is required even when every producer says success', () => {
  for (const key of ['full_artifact_id', 'runtime_artifact_id', 'runtime_evidence_id', 'full_sha256', 'runtime_sha256', 'delivery_sha256']) {
    for (const value of [undefined, '', 'not-an-identity']) {
      const needs = passingNeeds();
      needs['native-feature-acceptance'].outputs[key] = value;
      assert.equal(check(needs).status, 1, `${key}=${value}`);
    }
  }
  const needs = passingNeeds();
  needs['native-feature-acceptance'].outputs.runtime_artifact_id = needs['native-feature-acceptance'].outputs.full_artifact_id;
  assert.equal(check(needs).status, 1);
  assert.equal(check(passingNeeds(), {ACCEPTANCE_REPOSITORY: 'invalid'}).status, 1);
  const result = check(passingNeeds());
  assert.equal(result.status, 0);
  assert.match(result.summary, /https:\/\/github.com\/example\/original-fixture\/actions\/runs\/123456\/artifacts\/202/);
  assert.match(result.summary, /runtime_sha256: c{64}/);
  assert.match(result.summary, /separate full Verify WorldMusicClub workflow must also succeed/);
});
