import assert from 'node:assert/strict';
import {mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import test from 'node:test';

const root = new URL('../', import.meta.url);
const python = process.env.PYTHON || (process.platform === 'win32' ? 'python' : 'python3');
const parsed = spawnSync(python, ['scripts/check-authoring-workflow.py', '.github/workflows/check.yml', '--json'], {cwd: root, encoding: 'utf8'});
assert.equal(parsed.status, 0, parsed.stderr);
const workflow = JSON.parse(parsed.stdout);
const producers = ['frontend-checks', 'frontend-real'];
const browserGuard = "${{ !cancelled() && steps.browser_setup.outcome == 'success' }}";
const realGuard = "${{ !cancelled() && steps.browser_setup.outcome == 'success' && steps.rust_server.outcome == 'success' }}";
const patterns = ['worldmusichub-*.png', 'worldmusichub-omr-*.json', 'worldmusichub-live-*.json', 'worldmusichub-binding-*.json'];
const browserPaths = patterns.map(pattern => `/tmp/${pattern}`);
const source = '${{ github.sha }}';
const uploadAction = 'actions/upload-artifact@043fb46d1a93c77aae656e7c1c64a875d1fc6a0a';
const downloadAction = 'actions/download-artifact@70fc10c6e5e1ce46ad2ea6f2b72d43f7d47b13c3';
const step = (document, job, command) => document.jobs[job].steps.find(row => row.run === command);

function validateParserProvisioning(document) {
  const consumers = [];
  for (const [id, job] of Object.entries(document.jobs)) {
    const dependent = job.steps.filter(row => /\bnpm test\b|\bpython -m unittest discover\b|scripts\/check-authoring-workflow\.py/.test(row.run || ''));
    if (!dependent.length) continue;
    consumers.push(id);
    const python = job.steps.findIndex(row => row.uses?.startsWith('actions/setup-python@') && row.with?.['python-version'] === '3.12');
    const parser = job.steps.findIndex(row => row.run === 'python -m pip install PyYAML==6.0.3');
    assert.ok(python >= 0 && parser > python, `${id} needs the pinned parser in its selected Python`);
    for (const row of dependent) assert.ok(job.steps.indexOf(row) > parser, `${id} imports YAML before installing it`);
    for (const row of [job.steps[python], job.steps[parser]]) {
      assert.equal(row.if, undefined);
      assert.equal(row['continue-on-error'], undefined);
    }
  }
  assert.deepEqual(consumers.sort(), ['frontend-checks', 'rust']);
}

test('every Verify job importing the workflow parser installs pinned PyYAML before discovery or Node contracts', () => {
  validateParserProvisioning(workflow);
  for (const id of ['rust', 'frontend-checks']) {
    for (const mutate of [
      steps => steps.splice(steps.findIndex(row => row.run === 'python -m pip install PyYAML==6.0.3'), 1),
      steps => { steps.find(row => row.run === 'python -m pip install PyYAML==6.0.3').run = 'python -m pip install PyYAML'; },
      steps => { steps.find(row => row.run === 'python -m pip install PyYAML==6.0.3').if = 'false'; },
      steps => { steps.find(row => row.run === 'python -m pip install PyYAML==6.0.3')['continue-on-error'] = true; },
      steps => steps.push(...steps.splice(steps.findIndex(row => row.run === 'python -m pip install PyYAML==6.0.3'), 1)),
    ]) {
      const changed = structuredClone(workflow);
      mutate(changed.jobs[id].steps);
      assert.throws(() => validateParserProvisioning(changed), id);
    }
  }
});

test('both Rust platforms remain mandatory while a failed peer cannot cancel their evidence', () => {
  const rust = workflow.jobs.rust;
  assert.deepEqual(rust.strategy.matrix.os, ['ubuntu-latest', 'windows-latest']);
  assert.equal(rust.strategy['fail-fast'], false);
  assert.equal(rust['continue-on-error'], undefined);
  assert.equal(rust.if, undefined);
  for (const row of rust.steps) assert.equal(row['continue-on-error'], undefined);
  assert.equal(step(workflow, 'rust', "python -m unittest discover -s tests -p 'test_*.py'").if, undefined);
});

function validateParallelGate(document) {
  assert.deepEqual(document.on, {push: {branches: ['main', 'validation/**']}, pull_request: null, workflow_dispatch: null});
  assert.deepEqual(document.permissions, {contents: 'read'});
  for (const [id, job] of Object.entries(document.jobs)) {
    assert.equal(job['continue-on-error'], undefined);
    const checkout = job.steps.find(row => row.uses?.startsWith('actions/checkout@'));
    assert.equal(checkout?.with?.ref, source, `${id} must test the exact workflow source`);
    for (const row of job.steps) {
      assert.equal(row['continue-on-error'], undefined);
      if (row.uses) assert.match(row.uses, /@[a-f0-9]{40}$/);
    }
  }
  for (const id of producers) {
    const job = document.jobs[id];
    assert.equal(job.needs, undefined, 'Test producers must run independently');
    assert.equal(job.if, undefined);
    assert.equal(job['runs-on'], 'ubuntu-latest');
    assert.equal(job['timeout-minutes'], 30);
    assert.equal(job.steps.find(row => row.id === 'browser_setup')['timeout-minutes'], 10);
    assert.equal(job.steps.find(row => row.id === 'browser_setup').if, "${{ !cancelled() && steps.npm_dependencies.outcome == 'success' && steps.engraving_assets.outcome == 'success' }}");
    assert.ok(step(document, id, 'npm ci --ignore-scripts --omit=optional'));
    assert.ok(step(document, id, 'npm run prepare:engraving'));
  }
  const expected = {
    'frontend-checks': ['npm test', 'npm run test:browser'],
    'frontend-real': ['npm run test:full-app', 'npm run test:engraving-browser', 'npm run test:score-storage-hosted', 'node scripts/hosted-rhythm-check.mjs'],
  };
  const all = Object.values(document.jobs).flatMap(job => job.steps);
  for (const [id, commands] of Object.entries(expected)) {
    for (const command of commands) {
      assert.ok(step(document, id, command), command);
      assert.equal(all.filter(row => row.run === command).length, 1, `${command} must run exactly once`);
    }
  }
  assert.equal(step(document, 'frontend-checks', 'npm test').if, undefined);
  assert.equal(step(document, 'frontend-checks', 'npm run test:browser').if, browserGuard);
  const real = document.jobs['frontend-real'].steps;
  const build = real.find(row => row.id === 'rust_server');
  assert.equal(build.run, 'cargo build -p practice-server --locked');
  assert.equal(build.if, "${{ !cancelled() && steps.rust_toolchain.outcome == 'success' }}");
  for (const command of expected['frontend-real'].slice(0, 3)) {
    const row = step(document, 'frontend-real', command);
    assert.equal(row.if, realGuard);
    assert.ok(real.indexOf(row) > real.indexOf(build));
  }
  const storage = step(document, 'frontend-real', 'npm run test:score-storage-hosted');
  assert.equal(storage['timeout-minutes'], 5);
  assert.equal(storage.env.WMH_SOURCE_SHA, source);
  const rhythm = step(document, 'frontend-real', 'node scripts/hosted-rhythm-check.mjs');
  assert.equal(rhythm['timeout-minutes'], 10);
  assert.equal(rhythm.env.WMH_SOURCE_SHA, source);
  assert.equal(rhythm.if, "${{ !cancelled() && (contains(fromJSON('[\"integration/rhythm-ui\", \"dev/initial-prototype\", \"main\"]'), github.head_ref || github.ref_name) || startsWith(github.head_ref || github.ref_name, 'validation/')) && steps.browser_setup.outcome == 'success' && steps.rust_server.outcome == 'success' }}");
  const aggregate = document.jobs.frontend;
  assert.deepEqual(aggregate.needs, producers);
  assert.equal(aggregate.if, 'always()');
  assert.equal(aggregate['runs-on'], 'ubuntu-latest');
  assert.equal(aggregate['timeout-minutes'], 10);
  const gate = aggregate.steps.at(-1);
  assert.equal(gate.if, 'always()');
  assert.deepEqual(gate.env, {CHECKS_RESULT: '${{ needs.frontend-checks.result }}', REAL_RESULT: '${{ needs.frontend-real.result }}'});
  assert.deepEqual(gate.run.trim().split('\n'), ['test "$CHECKS_RESULT" = success', 'test "$REAL_RESULT" = success']);
}

test('Verify runs complete independent suites at one exact source and retains a fail-closed frontend aggregate', () => {
  validateParallelGate(workflow);
});

test('Verify rejects serialized work, lost tests, weaker failure checks and mismatched source', () => {
  for (const mutate of [
    doc => { doc.jobs['frontend-real'].needs = ['frontend-checks']; },
    doc => { doc.jobs['frontend-checks']['continue-on-error'] = true; },
    doc => { doc.jobs['frontend-real']['timeout-minutes'] = 60; },
    doc => { doc.jobs['frontend-real'].steps = doc.jobs['frontend-real'].steps.filter(row => row.run !== 'npm run test:engraving-browser'); },
    doc => { step(doc, 'frontend-real', 'npm run test:score-storage-hosted').if = 'success()'; },
    doc => { step(doc, 'frontend-real', 'node scripts/hosted-rhythm-check.mjs').env.WMH_SOURCE_SHA = '${{ github.event.pull_request.head.sha }}'; },
    doc => { doc.jobs['frontend-real'].steps[0].with.ref = 'main'; },
    doc => { doc.jobs.frontend.if = 'success()'; },
    doc => { doc.jobs.frontend.needs = ['frontend-real']; },
    doc => { doc.jobs.frontend.steps.at(-1).run = 'test "$REAL_RESULT" != failure'; },
  ]) {
    const changed = structuredClone(workflow);
    mutate(changed);
    assert.throws(() => validateParallelGate(changed));
  }
});

test('Verify preserves complete screenshot, storage and six bounded artifact contracts across same-run transfers', () => {
  const artifacts = Object.values(workflow.jobs).flatMap(job => job.steps).filter(row => row.uses === uploadAction);
  assert.equal(new Set(artifacts.map(row => row.with.name)).size, artifacts.length, 'Parallel uploads may not overwrite one another');
  const artifact = name => artifacts.find(row => row.with.name === name);
  const complete = artifact('browser-regression-screenshots');
  assert.deepEqual(complete.with.path.trim().split('\n'), [...browserPaths, '${{ runner.temp }}/worldmusichub-rhythm/']);
  assert.equal(artifact('score-storage-regression').with.path, '${{ runner.temp }}/worldmusichub-score-storage/');
  assert.equal(artifact('connection-lifetime-${{ matrix.os }}').with.path, '${{ runner.temp }}/wmh-connections.json');
  for (let index = 1; index <= 6; index++) {
    const part = String(index).padStart(2, '0');
    const row = artifact(`browser-evidence-part-${part}`);
    assert.equal(row.with.path, `\${{ runner.temp }}/worldmusichub-browser-parts/part-${part}/`);
    assert.equal(row.with['compression-level'], 0);
  }
  for (const row of artifacts) {
    assert.equal(row.if, 'always()');
    assert.equal(row.with['if-no-files-found'], 'ignore');
  }
  for (const [id, suffix] of [['frontend-checks', 'mocked'], ['frontend-real', 'real']]) {
    const transfer = artifact(`browser-evidence-inputs-${suffix}`);
    assert.deepEqual(transfer.with.path.trim().split('\n'), browserPaths);
    assert.equal(workflow.jobs[id].outputs.evidence_id, '${{ steps.browser_evidence.outputs.artifact-id }}');
    assert.equal(transfer.id, 'browser_evidence');
  }
  const aggregate = workflow.jobs.frontend.steps;
  const downloads = aggregate.filter(row => row.uses === downloadAction);
  assert.equal(downloads.length, 3);
  for (const [index, dependency, output, destination] of [
    [0, 'frontend-checks', 'evidence_id', 'worldmusichub-browser-inputs/mocked'],
    [1, 'frontend-real', 'evidence_id', 'worldmusichub-browser-inputs/real'],
    [2, 'frontend-real', 'rhythm_id', 'worldmusichub-rhythm'],
  ]) {
    const row = downloads[index];
    assert.equal(row.if, `\${{ always() && needs.${dependency}.outputs.${output} != '' }}`);
    assert.deepEqual(row.with, {
      'artifact-ids': `\${{ needs.${dependency}.outputs.${output} }}`,
      path: `\${{ runner.temp }}/${destination}`, 'digest-mismatch': 'error',
    });
  }
  const partition = aggregate.find(row => row.run?.includes('scripts/partition-browser-evidence.py'));
  assert.equal(partition.if, "${{ always() && steps.restore_browser_evidence.outcome == 'success' }}");
  assert.equal(partition.run, 'python3 scripts/partition-browser-evidence.py /tmp "${{ runner.temp }}/worldmusichub-rhythm" "${{ runner.temp }}/worldmusichub-browser-parts" --source-sha "${{ github.sha }}" --run-url "${{ github.server_url }}/${{ github.repository }}/actions/runs/${{ github.run_id }}"');
});

function evidenceFixture(t) {
  const directory = mkdtempSync(join(tmpdir(), 'wmh-workflow-evidence-'));
  t.after(() => rmSync(directory, {recursive: true, force: true}));
  const input = join(directory, 'inputs'), target = join(directory, 'tmp');
  mkdirSync(input); mkdirSync(target);
  const put = (producer, name, value) => {
    const dir = join(input, producer); mkdirSync(dir, {recursive: true});
    writeFileSync(join(dir, name), value);
  };
  const restore = workflow.jobs.frontend.steps.find(row => row.id === 'restore_browser_evidence');
  assert.equal(restore.if, 'always()');
  const code = restore.run.match(/^python3 - <<'PY'\n([\s\S]+)\nPY\n?$/)?.[1];
  assert.ok(code);
  const run = () => spawnSync(python, ['-c', code], {cwd: root, encoding: 'utf8', env: {...process.env, WMH_BROWSER_INPUTS: input, WMH_BROWSER_TEMP: target}});
  return {input, target, put, run};
}

test('Verify rejoins exact original browser bytes and retains whichever failed-run producers have evidence', t => {
  const fixture = evidenceFixture(t);
  const expected = new Map([
    ['worldmusichub-desktop.png', Buffer.from([0, 255, 17])],
    ['worldmusichub-live-report.json', Buffer.from('{"live":true}\n')],
    ['worldmusichub-omr-original.json', Buffer.from('{"original":true}\n')],
    ['worldmusichub-binding-report.json', Buffer.from('{"binding":true}\n')],
  ]);
  for (const [name, bytes] of expected) fixture.put(name.endsWith('.png') ? 'mocked' : 'real', name, bytes);
  const result = fixture.run();
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(readdirSync(fixture.target).sort(), [...expected.keys()].sort());
  for (const [name, bytes] of expected) assert.deepEqual(readFileSync(join(fixture.target, name)), bytes);
  const partial = evidenceFixture(t);
  partial.put('real', 'worldmusichub-live-failure.png', 'failure screenshot');
  assert.equal(partial.run().status, 0);
  assert.equal(readFileSync(join(partial.target, 'worldmusichub-live-failure.png'), 'utf8'), 'failure screenshot');
});

test('Verify cannot silently overwrite conflicting browser evidence or include unrelated files', t => {
  const fixture = evidenceFixture(t);
  fixture.put('mocked', 'worldmusichub-duplicate.png', 'mocked');
  fixture.put('real', 'worldmusichub-duplicate.png', 'real');
  assert.notEqual(fixture.run().status, 0);
  assert.equal(readFileSync(join(fixture.target, 'worldmusichub-duplicate.png'), 'utf8'), 'mocked');
  for (const name of ['credentials.json', 'worldmusichub-other.json', 'nested']) {
    const invalid = evidenceFixture(t);
    invalid.put('real', name, 'unrelated');
    assert.notEqual(invalid.run().status, 0, name);
    assert.deepEqual(readdirSync(invalid.target), []);
  }
});

const priorPreviewCases=['real free piano fills desktop','original grand staff and Jianpu follow','game menu and audible song preview','normal and free piano share','original falling bars visibly cross',...['1280 by 720','1920 by 1080','844 by 390','390 by 844'].map(size=>`real D768 lobby and compact performance fit ${size}`),'short-landscape following reveals','real guitar current and next six-note','real initial compact guide stays','real compact 88-key and custom extreme guides'];
const noticePreviewCase='real piano hands preserve merged ties';

function validateNoticePreview(document){
  const steps=document.jobs['ui-preview'].steps,run=steps.find(row=>row.run?.includes('tests/full-app-browser.test.js'));
  assert.ok(run);assert.equal(run.if,undefined);assert.equal(run['continue-on-error'],undefined);
  assert.match(run.run,/set -o pipefail/);assert.match(run.run,/\| tee ui-preview\/tests\.tap/);
  const pattern=run.run.match(/--test-name-pattern='([^']+)'/)?.[1];assert.ok(pattern);
  const selected=new RegExp(pattern);for(const name of [...priorPreviewCases,noticePreviewCase])assert.ok(selected.test(name),`Missing preview case: ${name}`);
  const verify=steps.find(row=>row.run==='node scripts/verify-ui-preview.mjs ui-preview');assert.ok(verify);assert.equal(verify.if,undefined);assert.equal(verify['continue-on-error'],undefined);
  const failure=steps.find(row=>row.with?.name==='game-ui-failures-${{ github.sha }}');assert.ok(failure);assert.equal(failure.if,'always()');
  assert.ok(failure.with.path.split('\n').includes('ui-preview/worldmusichub-live-piano-notice-layout.json'),'Retain paired notice geometry in the small failure artifact');
}

test('UI preview adds real notice dismissal without dropping the 13 existing cases or failure geometry',()=>{
  const parsed=spawnSync(python,['scripts/check-authoring-workflow.py','.github/workflows/ui-preview.yml','--json'],{cwd:root,encoding:'utf8'});
  assert.equal(parsed.status,0,parsed.stderr);const preview=JSON.parse(parsed.stdout);validateNoticePreview(preview);
  for(const name of ['original grand staff and Jianpu follow',noticePreviewCase]){
    const changed=structuredClone(preview),run=changed.jobs['ui-preview'].steps.find(row=>row.run?.includes('tests/full-app-browser.test.js'));run.run=run.run.replace(name,'unselected case');
    assert.throws(()=>validateNoticePreview(changed),/Missing preview case/);
  }
  const missing=structuredClone(preview),failure=missing.jobs['ui-preview'].steps.find(row=>row.with?.name==='game-ui-failures-${{ github.sha }}');
  failure.with.path=failure.with.path.replace('ui-preview/worldmusichub-live-piano-notice-layout.json','');assert.throws(()=>validateNoticePreview(missing),/Retain paired notice geometry/);
});

test('UI preview verification refuses the old passing subset or a skipped or failed notice case',t=>{
  const directory=mkdtempSync(join(tmpdir(),'wmh-notice-preview-contract-'));t.after(()=>rmSync(directory,{recursive:true,force:true}));
  const previous=priorPreviewCases.map((name,index)=>`ok ${index+1} - ${name}`).join('\n');
  for(const notice of ['',`ok 14 - ${noticePreviewCase} # SKIP test name does not match pattern`,`not ok 14 - ${noticePreviewCase}`]){
    writeFileSync(join(directory,'tests.tap'),previous+'\n'+notice+'\n');
    const checked=spawnSync(process.execPath,['scripts/verify-ui-preview.mjs',directory],{cwd:root,encoding:'utf8'});
    assert.notEqual(checked.status,0);assert.match(checked.stderr,/Missing executed passing preview case: real piano hands preserve merged ties/);
  }
});


const guitarNotationPreviewCase='real short-landscape guitar keeps a complete labelled row and transport beside notation';
test('UI preview executes original compact guitar render completion and keeps its pending, first-paint and clipping evidence',()=>{
  const parsed=spawnSync(python,['scripts/check-authoring-workflow.py','.github/workflows/ui-preview.yml','--json'],{cwd:root,encoding:'utf8'});
  assert.equal(parsed.status,0,parsed.stderr);const preview=JSON.parse(parsed.stdout);validateNoticePreview(preview);
  const steps=preview.jobs['ui-preview'].steps,run=steps.find(row=>row.run?.includes('tests/full-app-browser.test.js'));
  const pattern=run.run.match(/--test-name-pattern='([^']+)'/)?.[1];assert.ok(new RegExp(pattern).test(guitarNotationPreviewCase));
  const retained=steps.find(row=>row.with?.name==='game-ui-failures-${{ github.sha }}').with.path.split('\n');
  for(const name of ['worldmusichub-live-guitar-render-*.json','worldmusichub-live-guitar-render-*.png','worldmusichub-live-simultaneous-844x390-guitar*.json','worldmusichub-live-simultaneous-844x390-guitar*.png'])assert.ok(retained.includes('ui-preview/'+name),`Missing first-paint failure evidence: ${name}`);
});

test('UI preview refuses the previous subset and skipped or failed compact guitar completion',t=>{
  const directory=mkdtempSync(join(tmpdir(),'wmh-guitar-preview-contract-'));t.after(()=>rmSync(directory,{recursive:true,force:true}));
  const previous=[...priorPreviewCases,noticePreviewCase].map((name,index)=>`ok ${index+1} - ${name}`).join('\n');
  for(const guitar of ['',`ok 15 - ${guitarNotationPreviewCase} # SKIP test name does not match pattern`,`not ok 15 - ${guitarNotationPreviewCase}`]){
    writeFileSync(join(directory,'tests.tap'),previous+'\n'+guitar+'\n');
    const checked=spawnSync(process.execPath,['scripts/verify-ui-preview.mjs',directory],{cwd:root,encoding:'utf8'});
    assert.notEqual(checked.status,0);assert.match(checked.stderr,/Missing executed passing preview case: real short-landscape guitar/);
  }
});

const homeHoverPreviewCase='real home menu keeps its hitbox stable at the hover boundary';
test('UI preview adds a real home boundary case while preserving all previous cases and its failure evidence',()=>{
  const parsed=spawnSync(python,['scripts/check-authoring-workflow.py','.github/workflows/ui-preview.yml','--json'],{cwd:root,encoding:'utf8'});
  assert.equal(parsed.status,0,parsed.stderr);const preview=JSON.parse(parsed.stdout);validateNoticePreview(preview);
  const steps=preview.jobs['ui-preview'].steps,run=steps.find(row=>row.run?.includes('tests/full-app-browser.test.js'));
  const pattern=run.run.match(/--test-name-pattern='([^']+)'/)?.[1];
  for(const name of [...priorPreviewCases,noticePreviewCase,guitarNotationPreviewCase,homeHoverPreviewCase])assert.ok(new RegExp(pattern).test(name),name);
  const retained=steps.find(row=>row.with?.name==='game-ui-failures-${{ github.sha }}').with.path.split('\n');
  for(const name of ['worldmusichub-home-hover-boundary*.json','worldmusichub-home-hover-boundary*.png'])assert.ok(retained.includes('ui-preview/'+name));
});

test('UI preview refuses the previous subset and skipped or failed home boundary coverage',t=>{
  const directory=mkdtempSync(join(tmpdir(),'wmh-home-hover-contract-'));t.after(()=>rmSync(directory,{recursive:true,force:true}));
  const previous=[...priorPreviewCases,noticePreviewCase,guitarNotationPreviewCase].map((name,index)=>`ok ${index+1} - ${name}`).join('\n');
  for(const hover of ['',`ok 16 - ${homeHoverPreviewCase} # SKIP test name does not match pattern`,`not ok 16 - ${homeHoverPreviewCase}`]){
    writeFileSync(join(directory,'tests.tap'),previous+'\n'+hover+'\n');
    const checked=spawnSync(process.execPath,['scripts/verify-ui-preview.mjs',directory],{cwd:root,encoding:'utf8'});
    assert.notEqual(checked.status,0);assert.match(checked.stderr,/Missing executed passing preview case: real home menu keeps its hitbox stable/);
  }
});
