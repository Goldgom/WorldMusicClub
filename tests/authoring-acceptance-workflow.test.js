import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {existsSync,mkdtempSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import test from 'node:test';

const root=fileURLToPath(new URL('../',import.meta.url));
const filename='.github/workflows/authoring-conversion-preview.yml';
const source=readFileSync(path.join(root,filename),'utf8');
const python=process.env.PYTHON||(process.platform==='win32'?'python':'python3');
function parse(text=source){
 const child=spawnSync(python,['scripts/check-authoring-workflow.py','-','--json'],{
  cwd:root,input:text,encoding:'utf8',timeout:10000,
 });
 assert.ifError(child.error);assert.equal(child.signal,null);
 return {...child,document:child.status===0?JSON.parse(child.stdout):null};
}
const parsed=parse();
assert.equal(parsed.status,0,`Complete workflow must parse with PyYAML: ${parsed.stderr}`);
const workflow=parsed.document,ids=['authoring-browser','authoring-windows'];
const runs=id=>workflow.jobs[id].steps.filter(step=>'run' in step).map(step=>step.run);

test('real PyYAML parses the entire document, preserves on, and returns only string run values',()=>{
 assert.deepEqual(workflow.on,{push:{branches:['preview/authoring-conversion']},workflow_dispatch:null});
 assert.deepEqual(workflow.permissions,{contents:'read'});
 assert.deepEqual(Object.keys(workflow.jobs),[...ids,'authoring-focused-summary']);
 for(const job of Object.values(workflow.jobs))for(const step of job.steps){
  if('run' in step){assert.equal(typeof step.run,'string');assert.ok(step.run.trim());}
 }
 const broken=source.replace('needs: [authoring-browser, authoring-windows]','needs: [authoring-browser, authoring-windows');
 const result=parse(broken);assert.notEqual(result.status,0,'Malformed YAML outside run must also fail');
 assert.match(result.stderr,/Invalid authoring workflow:/);
});

test('unquoted Rust acceptance:: fails actual YAML parsing before any workflow command can run',()=>{
 const quoted='"cargo test -p worldmusichub-desktop --lib acceptance:: --locked"';
 assert.ok(source.includes(quoted));
 const broken=source.replace(quoted,'cargo test -p worldmusichub-desktop --lib acceptance:: --locked');
 const result=parse(broken);assert.notEqual(result.status,0);
 assert.match(result.stderr,/mapping values are not allowed/);
 for(const command of [quoted,"'cargo test -p worldmusichub-desktop --lib acceptance:: --locked'",'|\n          echo status: ready']){
  assert.equal(parse(source.replace(quoted,command)).status,0,command);
 }
});

test('checker rejects non-string run nodes and duplicate keys instead of executing or coercing them',()=>{
 const command='node scripts/check-song-authoring-native.mjs';
 for(const value of ['null','false','17','[]','{command: echo wrong}']){
  const result=parse(source.replace(`run: ${command}`,`run: ${value}`));
  assert.notEqual(result.status,0,value);assert.match(result.stderr,/run must be a nonempty string/);
 }
 const duplicate=parse(source.replace(`run: ${command}`,`run: ${command}\n        run: echo hidden`));
 assert.notEqual(duplicate.status,0);assert.match(duplicate.stderr,/Duplicate workflow mapping key/);
 const directory=mkdtempSync(path.join(tmpdir(),'wmh-authoring-yaml-'));
 try{
  const marker=path.join(directory,'must-not-exist');
  const shellCommand=`node -e "require('node:fs').writeFileSync(${JSON.stringify(marker)},'wrong')"`;
  const result=parse(source.replace(`run: ${command}`,`run: ${JSON.stringify(shellCommand)}`));
  assert.equal(result.status,0,result.stderr);assert.equal(existsSync(marker),false);
 }finally{rmSync(directory,{recursive:true,force:true});}
});

test('independent environments check exact source and parse YAML before authoring feature commands',()=>{
 for(const id of ids){
  const job=workflow.jobs[id],steps=job.steps;
  assert.equal(job.needs,undefined);assert.equal(job.if,undefined);assert.equal(job['continue-on-error'],undefined);
  assert.equal(job['runs-on'],id==='authoring-browser'?'ubuntu-latest':'windows-latest');
  const checkout=steps.find(step=>step.uses?.startsWith('actions/checkout@'));
  assert.equal(checkout.with.ref,'${{ github.sha }}');assert.equal(checkout.with['fetch-depth'],0);
  assert.deepEqual(job.outputs,{
   source_sha:'${{ steps.authoring_source.outputs.source_sha }}',
   source_tree:'${{ steps.authoring_source.outputs.source_tree }}',run_id:'${{ github.run_id }}',
  });
  const indexOf=predicate=>{const index=steps.findIndex(predicate);assert.notEqual(index,-1);return index;};
  const setup=indexOf(step=>step.uses?.startsWith('actions/setup-python@'));
  const install=indexOf(step=>step.run==='python -m pip install PyYAML==6.0.3');
  const parser=indexOf(step=>step.run==='python scripts/check-authoring-workflow.py');
  const npm=indexOf(step=>step.run==='npm ci --ignore-scripts --omit=optional');
  assert.ok(setup<install&&install<parser&&parser<npm);
  for(const step of steps.filter(step=>step.run)){
   assert.equal(step.if,undefined);assert.equal(step['continue-on-error'],undefined);
  }
  const checked=steps.find(step=>step.id==='authoring_source');
  assert.equal(checked.shell,'bash');assert.match(checked.run,/test "\$\(git rev-parse HEAD\)" = "\$GITHUB_SHA"/);
  assert.match(checked.run,/source_tree=\$\(git rev-parse 'HEAD\^\{tree\}'\)/);
  for(const step of steps.filter(step=>step.uses))assert.match(step.uses,/@[a-f0-9]{40}$/);
 }
});

test('focused commands cover conversion, authoring model, fixtures, evidence and both real environments',()=>{
 for(const id of ids){
  const commands=runs(id);
  for(const command of ['cargo test -p score-core clean_conversion --locked',
   'cargo test -p practice-server clean_draft --locked',
   'cargo test -p worldmusichub-desktop --lib acceptance:: --locked'])assert.ok(commands.includes(command),command);
  assert.ok(commands.includes('node --test tests/song-authoring-model.test.js tests/frontend-song-authoring.test.js tests/song-authoring-acceptance-fixtures.test.js tests/native-song-authoring-evidence.test.js tests/authoring-acceptance-workflow.test.js'));
 }
 const browser=workflow.jobs['authoring-browser'].steps;
 assert.ok(runs('authoring-browser').includes('cargo build -p worldmusichub-desktop --example native_import_driver --locked'));
 const driver=browser.find(step=>step.run==='node scripts/check-song-authoring-native.mjs');
 assert.equal(driver.env.WMH_NATIVE_IMPORT_DRIVER,'${{ github.workspace }}/target/debug/examples/native_import_driver');
 assert.equal(driver.env.WMH_AUTHORING_REPORT,'${{ github.workspace }}/test-results/song-authoring/native-protocol/report.json');
 const hosted=browser.find(step=>step.run?.includes('node scripts/hosted-song-authoring-check.mjs'));
 assert.deepEqual(hosted.run.trim().split('\n'),[[1280,720],[1280,900],[1920,1080]].map(([width,height])=>
  `WMH_VIEWPORT_WIDTH=${width} WMH_VIEWPORT_HEIGHT=${height} node scripts/hosted-song-authoring-check.mjs`));
 assert.equal(hosted.env.WMH_HOSTED_BROWSER,'1');assert.equal(hosted.env.WMH_SOURCE_SHA,'${{ github.sha }}');
 assert.equal(hosted.env.WMH_NATIVE_IMPORT_DRIVER,driver.env.WMH_NATIVE_IMPORT_DRIVER);
 const native=runs('authoring-windows');
 assert.ok(native.includes('cargo build -p worldmusichub-desktop --release --locked'));
 assert.ok(native.includes('./scripts/windows-desktop-acceptance.ps1 -Executable target/release/worldmusichub-desktop.exe -OutputDirectory desktop-authoring -Scenario authoring'));
 const verify=native.find(command=>command.startsWith('node scripts/verify-native-song-authoring-evidence.mjs --check desktop-authoring\n'));
 assert.ok(verify);assert.match(verify,/native-song-authoring-manifest\.py desktop-authoring --executable target\/release\/worldmusichub-desktop\.exe --commit '\$\{\{ github.sha \}\}' --tree \(git rev-parse 'HEAD\^\{tree\}'\)/);
 assert.equal((verify.match(/if \(\$LASTEXITCODE -ne 0\) \{ throw /g)||[]).length,2);
});

test('artifact paths retain evidence, original fixtures and clean outputs without profiles or packages for release',()=>{
 for(const id of ids){
  const uploads=workflow.jobs[id].steps.filter(step=>step.uses?.startsWith('actions/upload-artifact@'));
  assert.equal(uploads.length,1);const upload=uploads[0];assert.equal(upload.if,'always()');
  const prefix=id==='authoring-browser'?'test-results/song-authoring/*':'desktop-authoring';
  assert.deepEqual(upload.with.path.trim().split('\n'),[
   '*.json','*.png','*.log','downloads/*.json','downloads/*.zip','fixtures/*',
   'Scores/clean-songs/**','Scores/clean-backups/**','Scores/imports/**','Scores/import-backups/**',
  ].map(suffix=>`${prefix}/${suffix}`));
  assert.ok(upload.with.name.endsWith('-${{ github.sha }}'));
 }
 assert.doesNotMatch(source,/native-release-manifest|gh release|contents: write|dist\/WorldMusicHub|current239|webview-profile|workflow_run|pull_request/);
});

const summary=workflow.jobs['authoring-focused-summary'];
const program=summary.steps[0].run.match(/^node <<'NODE'\n([\s\S]+)\nNODE\n?$/)?.[1];
assert.ok(program,'Test the actual workflow summary program');
const sha='a'.repeat(40),tree='b'.repeat(40),run='123456';
function passingNeeds(){return Object.fromEntries(ids.map(id=>[id,{result:'success',outputs:{source_sha:sha,source_tree:tree,run_id:run}}]));}
function checkSummary(needs,extraEnv={}){
 const directory=mkdtempSync(path.join(tmpdir(),'wmh-authoring-summary-'));
 try{
  const summaryPath=path.join(directory,'summary.md');
  const child=spawnSync(process.execPath,['-'],{input:program,encoding:'utf8',timeout:5000,
   env:{...process.env,AUTHORING_NEEDS:JSON.stringify(needs),AUTHORING_SHA:sha,
    AUTHORING_RUN_ID:run,GITHUB_STEP_SUMMARY:summaryPath,...extraEnv},
  });
  assert.ifError(child.error);assert.equal(child.signal,null);
  return {...child,summary:readFileSync(summaryPath,'utf8')};
 }finally{rmSync(directory,{recursive:true,force:true});}
}

test('always-run summary requires both environments without claiming full acceptance',()=>{
 assert.deepEqual(summary.needs,ids);assert.equal(summary.if,'always()');assert.equal(summary['timeout-minutes'],5);
 assert.equal(summary.steps.length,1);assert.equal(summary.steps[0].if,undefined);
 assert.equal(summary.steps[0]['continue-on-error'],undefined);
 assert.deepEqual(summary.steps[0].env,{AUTHORING_NEEDS:'${{ toJSON(needs) }}',
  AUTHORING_SHA:'${{ github.sha }}',AUTHORING_RUN_ID:'${{ github.run_id }}'});
 for(const browser of ['success','failure','cancelled','skipped'])for(const windows of ['success','failure','cancelled','skipped']){
  const needs=passingNeeds();needs[ids[0]].result=browser;needs[ids[1]].result=windows;
  const result=checkSummary(needs),passed=browser==='success'&&windows==='success';
  assert.equal(result.status,passed?0:1,`${browser}/${windows}: ${result.stderr}`);
  assert.ok(result.summary.includes(`Focused original authoring proof: ${passed?'PASS':'FAIL'}`));
  assert.ok(result.summary.includes(`authoring-browser: ${browser}`));assert.ok(result.summary.includes(`authoring-windows: ${windows}`));
  assert.match(result.summary,/full accepted-source\/package gates remain separate/);
  assert.match(result.summary,/No package is published or accepted/);
 }
});

test('successful jobs cannot pass with missing, stale or different source identities',()=>{
 for(const id of ids)for(const mutate of [needs=>delete needs[id],needs=>delete needs[id].outputs,
  needs=>needs[id].outputs.source_sha='c'.repeat(40),needs=>needs[id].outputs.source_tree='c'.repeat(40),
  needs=>needs[id].outputs.source_tree='',needs=>needs[id].outputs.run_id='654321']){
  const needs=passingNeeds();mutate(needs);const result=checkSummary(needs);assert.equal(result.status,1,result.stderr);
 }
 for(const extra of [{AUTHORING_SHA:''},{AUTHORING_RUN_ID:''}])assert.equal(checkSummary(passingNeeds(),extra).status,1);
});
