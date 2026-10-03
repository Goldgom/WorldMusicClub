import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

const workflow = readFileSync(new URL('../.github/workflows/windows-desktop-acceptance.yml', import.meta.url), 'utf8');
const jobIds = ['bulk-import-browser', 'native-feature-acceptance'];
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
    result: 'success', outputs: { source_sha: sha, source_tree: tree, run_id: run },
  }]));
}
function check(needs, extraEnv = {}) {
  const directory = mkdtempSync(join(tmpdir(), 'wmh-acceptance-summary-'));
  const summaryPath = join(directory, 'summary.md');
  try {
    const child = spawnSync(process.execPath, ['-'], {
      input: program, encoding: 'utf8', timeout: 5000,
      env: { ...process.env, ACCEPTANCE_NEEDS: JSON.stringify(needs),
        ACCEPTANCE_SHA: sha, ACCEPTANCE_RUN_ID: run, GITHUB_STEP_SUMMARY: summaryPath, ...extraEnv },
    });
    assert.ifError(child.error);
    assert.equal(child.signal, null);
    return { status: child.status, summary: readFileSync(summaryPath, 'utf8'), stderr: child.stderr };
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

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
      assert.ok(summary.includes('Verify WorldMusicHub'));
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

test('all real checks fail closed and failure evidence survives independently', () => {
  for (const id of jobIds) {
    for (const step of steps(jobBlock(id))) {
      if (step.includes('continue-on-error:')) {
        assert.match(step, /uses: actions\/cache\/(?:restore|save)@/);
      }
      if (step.includes('uses: actions/upload-artifact@') && !step.includes('name: WorldMusicHub-Native-Candidate-')) {
        assert.match(step, /^        if: always\(\)$/m);
      }
    }
  }
  const nativeSteps = steps(jobBlock(jobIds[1]));
  const packageIndex = nativeSteps.findIndex(step => step.includes('id: native_package'));
  const extractedIndex = nativeSteps.findIndex(step => step.includes('Expand-Archive -Path'));
  const candidateIndex = nativeSteps.findIndex(step => step.includes('name: WorldMusicHub-Native-Candidate-'));
  assert.ok(packageIndex > 0 && extractedIndex > packageIndex && candidateIndex > extractedIndex);
  for (const index of [packageIndex, extractedIndex, candidateIndex]) {
    assert.doesNotMatch(nativeSteps[index], /^        (?:if|continue-on-error):/m);
  }
  assert.match(nativeSteps[candidateIndex], /if-no-files-found: error/);
  assert.match(nativeSteps[packageIndex], /native-release-manifest\.py create/);
  assert.match(nativeSteps[packageIndex], /native-release-manifest\.py archive/);
  for (const scenario of ['song-folder', 'bulk-import', 'clean-song', 'vsq-song', 'performance-song']) {
    const index = nativeSteps.findIndex(step => step.includes(`-Scenario ${scenario}`));
    assert.ok(index > 0 && index < packageIndex, `${scenario} gates packaging`);
    assert.doesNotMatch(nativeSteps[index], /^        (?:if|continue-on-error):/m);
  }
});

test('complete performance uses the exact built driver, both viewport gates and the packaged Windows EXE', () => {
  const browserSteps = steps(jobBlock(jobIds[0]));
  const buildIndex = browserSteps.findIndex(step => step.includes('cargo build -p worldmusichub-desktop --example native_import_driver --locked'));
  const protocolIndex = browserSteps.findIndex(step => step.includes('run: node scripts/check-performance-song-native.mjs'));
  const hostedIndex = browserSteps.findIndex(step => step.includes('node scripts/hosted-performance-song-check.mjs'));
  assert.ok(buildIndex >= 0 && protocolIndex > buildIndex && hostedIndex > protocolIndex);
  for (const step of [browserSteps[protocolIndex], browserSteps[hostedIndex]]) {
    assert.match(step, /WMH_NATIVE_IMPORT_DRIVER: \$\{\{ github\.workspace \}\}\/target\/debug\/examples\/native_import_driver/);
    assert.doesNotMatch(step, /^        (?:if|continue-on-error):/m);
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
