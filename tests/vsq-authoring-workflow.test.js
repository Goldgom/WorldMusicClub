import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {existsSync,mkdtempSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import test from 'node:test';
import vm from 'node:vm';

const root=fileURLToPath(new URL('../',import.meta.url));
const filename='.github/workflows/vsq-authoring-preview.yml';
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
const workflow=parsed.document,ids=['vsq-authoring-browser','vsq-authoring-windows'];
const runs=id=>workflow.jobs[id].steps.filter(step=>'run' in step).map(step=>step.run);

test('real PyYAML parses the entire document, preserves on, and returns only string run values',()=>{
 assert.deepEqual(workflow.on,{push:{branches:['preview/vsq-authoring']},workflow_dispatch:null});
 assert.deepEqual(workflow.permissions,{contents:'read'});
 assert.deepEqual(Object.keys(workflow.jobs),[...ids,'vsq-authoring-focused-summary']);
 for(const job of Object.values(workflow.jobs))for(const step of job.steps){
  if('run' in step){assert.equal(typeof step.run,'string');assert.ok(step.run.trim());}
 }
 const broken=source.replace('needs: [vsq-authoring-browser, vsq-authoring-windows]','needs: [vsq-authoring-browser, vsq-authoring-windows');
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
 const command='cargo build -p worldmusichub-desktop --example native_import_driver --locked';
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
  assert.equal(job['runs-on'],id==='vsq-authoring-browser'?'ubuntu-latest':'windows-latest');
  const checkout=steps.find(step=>step.uses?.startsWith('actions/checkout@'));
  assert.equal(checkout.with.ref,'${{ github.sha }}');assert.equal(checkout.with['fetch-depth'],0);
  assert.deepEqual(job.outputs,{
   source_sha:'${{ steps.vsq_authoring_source.outputs.source_sha }}',
   source_tree:'${{ steps.vsq_authoring_source.outputs.source_tree }}',run_id:'${{ github.run_id }}',
  });
  const indexOf=predicate=>{const index=steps.findIndex(predicate);assert.notEqual(index,-1);return index;};
  const setup=indexOf(step=>step.uses?.startsWith('actions/setup-python@'));
  const install=indexOf(step=>step.run==='python -m pip install PyYAML==6.0.3');
  const parser=indexOf(step=>step.run==='python scripts/check-authoring-workflow.py .github/workflows/vsq-authoring-preview.yml');
  const npm=indexOf(step=>step.run==='npm ci --ignore-scripts --omit=optional');
  assert.ok(setup<install&&install<parser&&parser<npm);
  for(const step of steps.filter(step=>step.run)){
   assert.equal(step.if,undefined);assert.equal(step['continue-on-error'],undefined);
  }
  const checked=steps.find(step=>step.id==='vsq_authoring_source');
  assert.equal(checked.shell,'bash');assert.match(checked.run,/test "\$\(git rev-parse HEAD\)" = "\$GITHUB_SHA"/);
  assert.match(checked.run,/source_tree=\$\(git rev-parse 'HEAD\^\{tree\}'\)/);
  for(const step of steps.filter(step=>step.uses))assert.match(step.uses,/@[a-f0-9]{40}$/);
 }
});

test('focused commands cover the original conversion and both real environments at the exact source',()=>{
 for(const id of ids){
  const commands=runs(id);
  for(const command of ['cargo test -p score-core clean_conversion --locked',
   'cargo test -p practice-server --test clean_draft_api --locked',
   'cargo test -p worldmusichub-desktop --test clean_conversion_draft --locked',
   'cargo test -p worldmusichub-desktop --lib acceptance:: --locked',
   'python -m unittest discover -s tests -p test_native_vsq_authoring_manifest.py',
   'node --test tests/song-authoring-model.test.js tests/frontend-song-authoring.test.js tests/vsq-authoring-acceptance.test.js tests/vsq-authoring-workflow.test.js'])assert.ok(commands.includes(command),command);
 }
 const browser=workflow.jobs['vsq-authoring-browser'].steps;
 assert.ok(runs('vsq-authoring-browser').includes('cargo build -p worldmusichub-desktop --example native_import_driver --locked'));
 const protocol=browser.find(step=>step.run==='node scripts/check-vsq-authoring-native.mjs');
 assert.equal(protocol.env.WMH_NATIVE_IMPORT_DRIVER,'${{ github.workspace }}/target/debug/examples/native_import_driver');
 assert.equal(protocol.env.WMH_VSQ_AUTHORING_REPORT,'${{ github.workspace }}/test-results/vsq-authoring/native-protocol/report.json');
 const hosted=browser.find(step=>step.run?.includes('node scripts/hosted-vsq-authoring-check.mjs'));
 assert.ok(browser.indexOf(protocol)<browser.indexOf(hosted));
 assert.deepEqual(hosted.run.trim().split('\n'),[[1280,720],[1280,900],[1920,1080]].map(([width,height])=>
  `WMH_VIEWPORT_WIDTH=${width} WMH_VIEWPORT_HEIGHT=${height} node scripts/hosted-vsq-authoring-check.mjs`));
 assert.equal(hosted.env.WMH_HOSTED_BROWSER,'1');assert.equal(hosted.env.WMH_SOURCE_SHA,'${{ github.sha }}');
 assert.equal(hosted.env.WMH_NATIVE_IMPORT_DRIVER,'${{ github.workspace }}/target/debug/examples/native_import_driver');
 const native=runs('vsq-authoring-windows');
 assert.ok(native.includes('cargo build -p worldmusichub-desktop --release --locked'));
 assert.ok(native.includes('./scripts/windows-desktop-acceptance.ps1 -Executable target/release/worldmusichub-desktop.exe -OutputDirectory desktop-vsq-authoring -Scenario vsq-authoring'));
 const verify=native.find(command=>command.startsWith('node scripts/verify-native-vsq-authoring-evidence.mjs --check desktop-vsq-authoring\n'));
 assert.ok(verify);assert.ok(verify.includes("python scripts/native-vsq-authoring-manifest.py desktop-vsq-authoring --executable target/release/worldmusichub-desktop.exe --commit '${{ github.sha }}' --tree (git rev-parse 'HEAD^{tree}')"));
 assert.equal((verify.match(/if \(\$LASTEXITCODE -ne 0\) \{ throw /g)||[]).length,2);
 const contract=native.find(command=>command.includes('./tests/windows-desktop-contract.ps1'));
 assert.ok(contract.includes('[System.Management.Automation.Language.Parser]::ParseFile'));
 assert.ok(native.indexOf(contract)<native.indexOf('cargo build -p worldmusichub-desktop --release --locked'));
});

test('artifact paths retain evidence, original fixtures and clean outputs without profiles or packages for release',()=>{
 for(const id of ids){
  const uploads=workflow.jobs[id].steps.filter(step=>step.uses?.startsWith('actions/upload-artifact@'));
  assert.equal(uploads.length,1);const upload=uploads[0];assert.equal(upload.if,'always()');
  const prefix=id==='vsq-authoring-browser'?'test-results/vsq-authoring/*':'desktop-vsq-authoring';
  assert.deepEqual(upload.with.path.trim().split('\n'),[
   '*.json','*.png','*.log','downloads/*.json','downloads/*.zip','fixtures/*',
   'Scores/clean-songs/**','Scores/clean-backups/**','Scores/imports/**','Scores/import-backups/**',
  ].map(suffix=>`${prefix}/${suffix}`));
  assert.ok(upload.with.name.endsWith('-${{ github.sha }}'));
 }
 assert.doesNotMatch(source,/native-release-manifest|gh release|contents: write|dist\/WorldMusic(?:Hub|Club)|current239|webview-profile|workflow_run|pull_request/);
});

const summary=workflow.jobs['vsq-authoring-focused-summary'];
const program=summary.steps[0].run.match(/^node <<'NODE'\n([\s\S]+)\nNODE\n?$/)?.[1];
assert.ok(program,'Test the actual workflow summary program');
const sha='a'.repeat(40),tree='b'.repeat(40),run='123456';
function passingNeeds(){return Object.fromEntries(ids.map(id=>[id,{result:'success',outputs:{source_sha:sha,source_tree:tree,run_id:run}}]));}
function checkSummary(needs,extraEnv={}){
 const directory=mkdtempSync(path.join(tmpdir(),'wmh-authoring-summary-'));
 try{
  const summaryPath=path.join(directory,'summary.md');
  const child=spawnSync(process.execPath,['-'],{input:program,encoding:'utf8',timeout:5000,
   env:{...process.env,VSQ_AUTHORING_NEEDS:JSON.stringify(needs),VSQ_AUTHORING_SHA:sha,
    VSQ_AUTHORING_RUN_ID:run,GITHUB_STEP_SUMMARY:summaryPath,...extraEnv},
  });
  assert.ifError(child.error);assert.equal(child.signal,null);
  return {...child,summary:readFileSync(summaryPath,'utf8')};
 }finally{rmSync(directory,{recursive:true,force:true});}
}

test('always-run summary requires both environments without claiming full acceptance',()=>{
 assert.deepEqual(summary.needs,ids);assert.equal(summary.if,'always()');assert.equal(summary['timeout-minutes'],5);
 assert.equal(summary.steps.length,1);assert.equal(summary.steps[0].if,undefined);
 assert.equal(summary.steps[0]['continue-on-error'],undefined);
 assert.deepEqual(summary.steps[0].env,{VSQ_AUTHORING_NEEDS:'${{ toJSON(needs) }}',
  VSQ_AUTHORING_SHA:'${{ github.sha }}',VSQ_AUTHORING_RUN_ID:'${{ github.run_id }}'});
 for(const browser of ['success','failure','cancelled','skipped'])for(const windows of ['success','failure','cancelled','skipped']){
  const needs=passingNeeds();needs[ids[0]].result=browser;needs[ids[1]].result=windows;
  const result=checkSummary(needs),passed=browser==='success'&&windows==='success';
  assert.equal(result.status,passed?0:1,`${browser}/${windows}: ${result.stderr}`);
  assert.ok(result.summary.includes(`Focused original VSQ authoring proof: ${passed?'PASS':'FAIL'}`));
  assert.ok(result.summary.includes(`vsq-authoring-browser: ${browser}`));assert.ok(result.summary.includes(`vsq-authoring-windows: ${windows}`));
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
 for(const extra of [{VSQ_AUTHORING_SHA:''},{VSQ_AUTHORING_RUN_ID:''}])assert.equal(checkSummary(passingNeeds(),extra).status,1);
});

const read=name=>readFileSync(path.join(root,name),'utf8');
const phases=['vsq-authoring-seed','vsq-authoring-restart'];
const rust=read('crates/desktop-shell/src/acceptance.rs');
const native=read('scripts/windows-desktop-acceptance.ps1');
const picker=read('scripts/windows-desktop-native.cs');
const profile=read('scripts/windows-desktop-profile.ps1');
const contract=read('tests/windows-desktop-contract.ps1');
const quoted=(text,pattern)=>[...text.matchAll(pattern)].map(match=>match[1]);

test('new phases agree across Rust, native orchestration and every fresh-profile registry',()=>{
 const rustPhases=Object.fromEntries([...rust.matchAll(/pub const (\w*PHASES): \[&str; \d+\] = \[([\s\S]*?)\];/g)]
  .map(([,key,value])=>[key,quoted(value,/"([^"]+)"/g)]));
 assert.deepEqual(rustPhases.VSQ_AUTHORING_PHASES,phases);
 const fresh=Object.entries(rustPhases).filter(([key])=>key!=='PHASES').flatMap(([,values])=>values);
 assert.deepEqual(quoted(profile.match(/\$fresh=@\(([^\n]+)\)/)[1],/'([^']+)'/g),fresh);
 assert.deepEqual(quoted(contract.match(/\$freshPhases=@\(([^\n]+)\)/)[1],/'([^']+)'/g),fresh);
 assert.match(native,/\$Scenario -eq 'vsq-authoring'\)\{@\('vsq-authoring-seed','vsq-authoring-restart'\)\}/);
 assert.ok(quoted(native.match(/\[ValidateSet\(([^\n]+?)\)\]/)[1],/'([^']+)'/g).includes('vsq-authoring'));
 for(const [,group]of native.matchAll(/\$Scenario -in @\(([^\n]+?)\)/g)){
  const values=quoted(group,/'([^']+)'/g);
  if(values.includes('authoring'))assert.ok(values.includes('vsq-authoring'),group);
 }
 for(const name of ['prepare-vsq-authoring-fixtures.mjs','native-vsq-authoring.json','verify-native-vsq-authoring-evidence.mjs'])assert.ok(native.includes(`'${name}'`));
 for(const check of ['Assert-AcceptanceProfileLaunch $OutputDirectory $phase','Assert-AcceptanceProfileEvidence $OutputDirectory $profileSelection $app.Id','Save-SongFolderSnapshot $phase','$app.CloseMainWindow()','$app.WaitForExit(10000)','$sequence -gt 64'])assert.ok(native.includes(check));
 assert.match(rust,/MAX_CLEAN_REPORT_BYTES: usize = 1024 \* 1024/);
 assert.match(rust,/\(1\.\.=64\)\.contains\(&sequence\)/);
 const final=read('.github/workflows/windows-desktop-acceptance.yml');assert.match(final,/hosted-vsq-authoring-check\.mjs/);assert.match(final,/-Scenario vsq-authoring/);assert.match(final,/--vsq-authoring desktop-vsq-authoring --basic-key desktop-basic-key/);
 assert.match(read('scripts/native-release-manifest.py'),/create.add_argument\('--vsq-authoring', required=True/);assert.match(read('scripts/native-release-manifest.py'),/_new_music.verify_packaged/);
});

test('new VSQ picker is one exact regular file with closed phase downloads and no new alias',()=>{
 const admitted=quoted(rust.match(/let fixture = \[([\s\S]*?)\]\s*\.contains\(&file\)/)[1],/"([^"]+)"/g);
 const files=quoted(picker.match(/Array\.IndexOf\(new\[\]\{([^}]+)\},name\)/)[1],/"([^"]+)"/g);
 const checked=quoted(contract.match(/\$fixed=@\(([^\n]+)\)/)[1],/'([^']+)'/g);
 for(const list of [admitted,files,checked])assert.equal(list.filter(name=>name==='authoring-original.vsq').length,1);
 assert.deepEqual([...checked].sort(),[...files].sort());
 assert.deepEqual(admitted.filter(name=>!files.includes(name)).sort(),['authoring-original-pair','bulk-multiple']);
 const pattern=[...picker.matchAll(/Regex\.IsMatch\(name,@"([^"]+)"/g)].map(row=>row[1]).find(value=>value.includes('vsq-authoring-seed'));
 assert.ok(pattern);
 const matcher=new RegExp(pattern.replace('\\A','^').replace('\\z','$(?![\\s\\S])'));
 for(const phase of phases){
  for(let sequence=1;sequence<=16;sequence++)for(const extension of ['zip','json'])assert.ok(matcher.test(`${phase}-${sequence}.${extension}`));
  for(const suffix of ['0.zip','17.zip','01.zip','001.json','+1.zip','-1.zip','1.ZIP','1.vsq','1.zip.extra','1.zip\n','1.json/'])assert.equal(matcher.test(`${phase}-${suffix}`),false,suffix);
 }
 for(const value of ['vsq-authoring-any-1.zip','vsq-authoring-seed-extra-1.zip','Vsq-authoring-seed-1.zip','../vsq-authoring-restart-1.json'])assert.equal(matcher.test(value),false,value);
 for(const check of ['missing VSQ authoring file cannot fall back to downloads','directory cannot replace VSQ authoring file','reparse point cannot replace VSQ authoring file'])assert.ok(contract.includes(check));
 assert.match(picker,/FileAttributes\.Directory\|FileAttributes\.ReparsePoint/);
 assert.match(rust,/fn vsq_authoring_picker_admits_only_the_exact_original_filename/);
});

test('VSQ injection uses the existing helper prefixes and starts only its own runner',()=>{
 const bases=['vsq-song-acceptance.js','performance-song-acceptance.js','song-authoring-acceptance.js'].map(name=>read(`crates/desktop-shell/${name}`));
 const renderer=read('crates/desktop-shell/vsq-authoring-acceptance.js');
 for(const item of [...bases,renderer])assert.equal(item.split('(() => {').length,2);
 const injected=[read('crates/desktop-shell/acceptance-wait.js'),read('crates/desktop-shell/reference-acceptance.js'),...bases.map(item=>item.split('(() => {')[0]),renderer].join('\n');
 assert.doesNotThrow(()=>new vm.Script(injected));
 assert.equal((injected.match(/addEventListener\('DOMContentLoaded'/g)||[]).length,1);
 assert.match(rust,/let \(authoring_helpers, _\)\s*=\s*include_str!\("\.\.\/song-authoring-acceptance\.js"\)/);
 assert.match(rust,/include_str!\("\.\.\/vsq-authoring-acceptance\.js"\)/);
 assert.doesNotMatch(renderer,/native\('(?:type|type-text|key-a|key-hold|escape|select-last|minimize-restore|cancel-picker)'/);
});

test('hosted VSQ route binds the actual phase and native action inventory before admitting evidence',()=>{
 const hosted=read('scripts/hosted-vsq-authoring-check.mjs');
 const checks=["renderer.phase,phase","renderer.actions,host.actions.length","renderer.pickerObservations.map(row=>({sequence:row.sequence,file:row.file}))","host.actions.filter(row=>row.kind==='picker').map(row=>({sequence:row.sequence,file:row.file}))"];
 for(const check of checks)assert.ok(hosted.includes(check),check);
 assert.ok(hosted.indexOf('assert.equal(renderer.phase,phase)')<hosted.indexOf('validateVsqAuthoringRenderer(renderer,undefined,undefined,origin)'));
 assert.ok(hosted.indexOf("process.env.GITHUB_ACTIONS!=='true'")<hosted.indexOf("await import('playwright')"));
 assert.match(hosted,/assert\.equal\(alias,VSQ_AUTHORING_FIXTURE_FILENAME/);
 assert.match(hosted,/for\(const index of \[2,3,4\]\)/);
 assert.match(hosted,/driver=startVsqNativeDriver\(\{binary,directory:path\.join\(output,'Scores'\),cwd:root\}\)/);
 assert.match(hosted,/context=await browser\.newContext/);
 assert.match(hosted,/await bounded\(driver\.close\(\),`\$\{phase\} close`\)/);
 assert.doesNotMatch(hosted,/setInputFiles|dispatchEvent|createServer|listen\(/);
});


test('authoring observes the shared real audio thread and awaits its exact ledger before restoring observers',()=>{
 const renderer=read('crates/desktop-shell/vsq-authoring-acceptance.js'),verifier=read('scripts/verify-native-vsq-authoring-evidence.mjs');
 assert.equal((renderer.match(/await observeBasicKeyReceiver\(document\)/g)||[]).length,2);
 assert.ok(renderer.indexOf('receiver=await observeBasicKeyReceiver(document)')<renderer.indexOf("checkpoint('original-vsq-file-review')"));
 assert.match(renderer,/worklet:receiver\.status\(\)/);assert.match(renderer,/receiver\.quiet\(\)/);
 assert.match(renderer,/report\.listenThread=receiver\.snapshot\(\)\.slice\(beforeListen\)/);
 assert.ok(renderer.indexOf("await silence('reference receiver disposal')")<renderer.indexOf('report.listenThread=receiver.snapshot()'));
 assert.match(renderer,/report\.reviewReceiverCleanup=restoreReceiver\(\)/);assert.match(renderer,/report\.receiverCleanup=restoreReceiver\(\)/);
 assert.doesNotMatch(renderer,/audio\(\)\.sourceStarts>report\.audioBeforePlay|createOscillator|new AudioWorkletNode|postMessage\(|setTimeout\(/);
 assert.match(verifier,/validateVsqAudioThreadRuns\(report\.listenThread,fixture\.runtime,\{mode:'listen',instrument:'piano'\}\)/);
 assert.match(verifier,/validateVsqAuthoringAudio\(report,fixture\)/);assert.match(verifier,/validateRendererOrigin\(expectedOrigin\)/);
});

test('hosted authoring serves shipped Worklet assets from the exact-source server and admits only owned native API calls',()=>{
 const hosted=read('scripts/hosted-vsq-authoring-check.mjs');
 assert.match(hosted,/startHostedAssetServer\(\{root,sourceSha:head,binary:/);
 assert.match(hosted,/origin=assetServer\.origin;report\.origin=origin/);
 assert.match(hosted,/createHostedNativeBridge\(\{origin,getOwnedPage:\(\)=>page\}\)/);
 assert.match(hosted,/context\.route\(url=>url\.origin===origin&&\(url\.pathname\.startsWith\('\/api\/'\)\|\|url\.pathname\.startsWith\('\/__desktop_smoke\/'\)\)/);
 assert.match(hosted,/nativeBridge\.run\(request,async headers=>/);
 assert.match(hosted,/method:request\.method\(\),headers,body:request\.postDataBuffer/);
 assert.ok(hosted.indexOf('nativeBridge.stopAdmission();await context.close();context=null;await nativeBridge.drain()')<hosted.indexOf('host.ok=true'));
 assert.match(hosted,/validateHostedAssetEvidence\(report\.asset_server,\{origin,sourceSha:head\}\)/);
 assert.match(hosted,/\['asset-server',\(\)=>assetServer\?\.close\(\)\]/);
 assert.doesNotMatch(hosted,/path\.resolve\(root,'web'|route\.fulfill\([^\n]*readFile|request\.headers\(\)|addModule|blob:|data:text\/javascript/);
});
