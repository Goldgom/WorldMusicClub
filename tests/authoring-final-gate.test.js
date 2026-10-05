import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
const root=new URL('../',import.meta.url),read=name=>readFileSync(new URL(name,root),'utf8');
function parsed(name){const result=spawnSync('python',['scripts/check-authoring-workflow.py',name,'--json'],{cwd:root,encoding:'utf8'});assert.equal(result.status,0,`${name}: ${result.stderr}`);return JSON.parse(result.stdout);}
const workflow=parsed('.github/workflows/windows-desktop-acceptance.yml');
const tests=['song-authoring-model','frontend-song-authoring','song-authoring-acceptance-fixtures','native-song-authoring-evidence','authoring-acceptance-workflow','authoring-final-gate'].map(name=>`tests/${name}.test.js`);
const step=(job,text)=>job.steps.find(value=>value.run?.includes(text));
function mandatory(value){assert.ok(value);assert.equal(value.if,undefined);assert.equal(value['continue-on-error'],undefined);}
function validateGate(document){
 const browser=document.jobs['bulk-import-browser'],native=document.jobs['native-feature-acceptance'];assert.ok(browser&&native);assert.equal(browser['runs-on'],'ubuntu-latest');assert.equal(native['runs-on'],'windows-latest');
 for(const job of [browser,native]){assert.equal(job.needs,undefined);assert.equal(job.if,undefined);assert.equal(job['continue-on-error'],undefined);assert.equal(job.outputs.source_sha,'${{ steps.acceptance_source.outputs.source_sha }}');assert.equal(job.outputs.source_tree,'${{ steps.acceptance_source.outputs.source_tree }}');assert.equal(job.outputs.run_id,'${{ github.run_id }}');for(const file of tests)assert.ok(job.steps.some(value=>value.run?.startsWith('node --test ')&&value.run.split(/\s+/).includes(file)),`Missing required ${file}`);}
 const build=step(browser,'cargo build -p worldmusichub-desktop --example native_import_driver --locked'),protocol=step(browser,'node scripts/check-song-authoring-native.mjs'),hosted=step(browser,'node scripts/hosted-song-authoring-check.mjs');for(const value of [build,protocol])mandatory(value);assert.equal(hosted.if,"${{ !cancelled() && steps.notation_server.outcome == 'success' && steps.dense_native_driver.outcome == 'success' && steps.dense_browser_setup.outcome == 'success' }}");assert.equal(hosted['continue-on-error'],undefined);assert.ok(browser.steps.indexOf(build)<browser.steps.indexOf(protocol)&&browser.steps.indexOf(protocol)<browser.steps.indexOf(hosted));
 for(const value of [protocol,hosted])assert.equal(value.env.WMH_NATIVE_IMPORT_DRIVER,'${{ github.workspace }}/target/debug/examples/native_import_driver');assert.equal(hosted.env.WMH_HOSTED_BROWSER,'1');assert.equal(hosted.env.WMH_SOURCE_SHA,'${{ github.sha }}');assert.equal(protocol.env.WMH_AUTHORING_REPORT,'${{ github.workspace }}/test-results/song-authoring/native-protocol/report.json');
 assert.deepEqual(hosted.run.trim().split('\n'),['WMH_VIEWPORT_WIDTH=1280 WMH_VIEWPORT_HEIGHT=720 node scripts/hosted-song-authoring-check.mjs','WMH_VIEWPORT_WIDTH=1280 WMH_VIEWPORT_HEIGHT=900 node scripts/hosted-song-authoring-check.mjs','WMH_VIEWPORT_WIDTH=1920 WMH_VIEWPORT_HEIGHT=1080 node scripts/hosted-song-authoring-check.mjs']);
 const scenario=step(native,'-Scenario authoring'),pack=native.steps.find(value=>value.id==='native_package');mandatory(scenario);mandatory(pack);assert.equal(scenario.run,'./scripts/windows-desktop-acceptance.ps1 -Executable target/release/worldmusichub-desktop.exe -OutputDirectory desktop-authoring -Scenario authoring');assert.ok(native.steps.indexOf(scenario)<native.steps.indexOf(pack));
 for(const previous of ['song-folder','bulk-import','clean-song','vsq-song','performance-song','pitch-bend']){const value=step(native,`-Scenario ${previous}`);mandatory(value);assert.ok(native.steps.indexOf(value)<native.steps.indexOf(pack));}
 for(const command of ['node scripts/verify-native-song-authoring-evidence.mjs --check desktop-authoring',"python scripts/native-song-authoring-manifest.py desktop-authoring --executable target/release/worldmusichub-desktop.exe --commit '${{ github.sha }}' --tree $currentTree"]){assert.ok(pack.run.includes(command));assert.ok(pack.run.indexOf(command)<pack.run.indexOf('Copy-Item target/release/worldmusichub-desktop.exe'));}
 for(const guard of ["$authoringProof.source_sha -cne '${{ github.sha }}'",'$authoringProof.source_tree -cne $currentTree','$authoringProof.executable_sha256 -cne $currentExe','$authoringProof.executable_bytes -ne $currentExeBytes'])assert.ok(pack.run.includes(guard),guard);
 for(const failure of ['Native song authoring exact-source proof failed','Native song authoring focused manifest failed'])assert.ok(pack.run.includes(`if ($LASTEXITCODE -ne 0) { throw '${failure}' }`));
 const create=pack.run.split('\n').find(line=>line.includes('native-release-manifest.py create '));assert.ok(create);for(const argument of ['--song-authoring desktop-authoring','--pitch-bend desktop-pitch-bend','--performance-song desktop-performance-song','--song-folder desktop-song-folder'])assert.ok(create.includes(argument));assert.doesNotMatch(pack.run,/desktop-authoring\/(?:\*|renderer-\*)/);
 assert.deepEqual(document.jobs['acceptance-summary'].needs,['bulk-import-browser','native-feature-acceptance']);return true;
}
test('full native gate parses as real YAML and requires authoring alongside every existing scenario',()=>{assert.equal(validateGate(workflow),true);});
test('removing any viewport, source/EXE binding, package argument, prerequisite or mandatory outcome fails the gate contract',()=>{
 for(const edit of [
  doc=>step(doc.jobs['bulk-import-browser'],'node scripts/hosted-song-authoring-check.mjs').if='false',
  doc=>step(doc.jobs['bulk-import-browser'],'node scripts/hosted-song-authoring-check.mjs').if=undefined,
  doc=>step(doc.jobs['bulk-import-browser'],'node scripts/hosted-song-authoring-check.mjs')['continue-on-error']=true,
  doc=>step(doc.jobs['bulk-import-browser'],'node scripts/hosted-song-authoring-check.mjs').run=step(doc.jobs['bulk-import-browser'],'node scripts/hosted-song-authoring-check.mjs').run.split('\n').filter(line=>!line.includes('1280 WMH_VIEWPORT_HEIGHT=720')).join('\n'),
  doc=>step(doc.jobs['bulk-import-browser'],'node scripts/hosted-song-authoring-check.mjs').run=step(doc.jobs['bulk-import-browser'],'node scripts/hosted-song-authoring-check.mjs').run.replace('1920','1280'),
  doc=>step(doc.jobs['bulk-import-browser'],'node scripts/hosted-song-authoring-check.mjs').env.WMH_SOURCE_SHA='stale',
  doc=>step(doc.jobs['bulk-import-browser'],'node scripts/check-song-authoring-native.mjs').env.WMH_NATIVE_IMPORT_DRIVER='other-driver',
  doc=>step(doc.jobs['native-feature-acceptance'],'-Scenario authoring').if='false',
  doc=>step(doc.jobs['native-feature-acceptance'],'-Scenario authoring')['continue-on-error']=true,
  doc=>doc.jobs['native-feature-acceptance'].steps.find(value=>value.id==='native_package').run=doc.jobs['native-feature-acceptance'].steps.find(value=>value.id==='native_package').run.replace('--song-authoring desktop-authoring',''),
  doc=>doc.jobs['native-feature-acceptance'].steps.find(value=>value.id==='native_package').run=doc.jobs['native-feature-acceptance'].steps.find(value=>value.id==='native_package').run.replace('$authoringProof.executable_sha256 -cne $currentExe','false'),
  doc=>doc.jobs['native-feature-acceptance'].steps=doc.jobs['native-feature-acceptance'].steps.filter(value=>!value.run?.includes('-Scenario pitch-bend')),
  doc=>doc.jobs['acceptance-summary'].needs=['native-feature-acceptance'],
 ]){const changed=structuredClone(workflow);edit(changed);assert.throws(()=>validateGate(changed));}
});
test('authoring unit and gate tests are mandatory once in the full suite',()=>{
 const command=JSON.parse(read('package.json')).scripts.test.split(/\s+/);for(const file of tests)assert.equal(command.filter(value=>value===file).length,1,file);
});
test('all CI paths selecting parser-dependent authoring tests provision pinned QA Python first',()=>{
 const consumers=[];
 for(const name of readdirSync(new URL('.github/workflows/',root)).filter(name=>/\.ya?ml$/.test(name))){const source=read(`.github/workflows/${name}`);if(!/npm test\b|npm run test:quick\b|tests\/authoring-(?:acceptance-workflow|final-gate)\.test\.js/.test(source))continue;const document=parsed(`.github/workflows/${name}`);
  for(const [id,job]of Object.entries(document.jobs)){const dependent=job.steps?.map((value,index)=>({value,index})).filter(({value})=>/\bnpm test\b|\bnpm run test:quick\b|tests\/authoring-(?:acceptance-workflow|final-gate)\.test\.js/.test(value.run||''))||[];if(!dependent.length)continue;consumers.push(`${name}/${id}`);const python=job.steps.findIndex(value=>value.uses?.startsWith('actions/setup-python@')&&value.with?.['python-version']==='3.12'),pip=job.steps.findIndex(value=>value.run==='python -m pip install PyYAML==6.0.3');assert.ok(python>=0&&pip>python,`${name}/${id}: missing explicit pinned QA parser`);for(const {index}of dependent)assert.ok(index>pip,`${name}/${id}: parser-dependent test preceded installation`);mandatory(job.steps[python]);mandatory(job.steps[pip]);}
 }
 for(const expected of ['check.yml/frontend-checks','quick-development.yml/quick','windows-release.yml/package','windows-desktop-proof.yml/native-desktop','windows-desktop-acceptance.yml/bulk-import-browser','windows-desktop-acceptance.yml/native-feature-acceptance','authoring-conversion-preview.yml/authoring-browser','authoring-conversion-preview.yml/authoring-windows'])assert.ok(consumers.includes(expected),expected);
 const packageJson=JSON.parse(read('package.json'));assert.equal(packageJson.dependencies?.PyYAML,undefined);assert.equal(packageJson.devDependencies?.PyYAML,undefined);
});
test('authoring artifacts retain only bounded original evidence and clean outputs',()=>{
 const suffixes=['*.json','*.png','*.log','downloads/*.json','downloads/*.zip','fixtures/*','Scores/clean-songs/**','Scores/clean-backups/**','Scores/imports/**','Scores/import-backups/**'];
 for(const [id,prefix]of [['bulk-import-browser','test-results/song-authoring/*/'],['native-feature-acceptance','desktop-authoring/']]){const upload=workflow.jobs[id].steps.find(value=>value.uses?.startsWith('actions/upload-artifact@')&&value.with.path.includes(prefix));assert.ok(upload);assert.equal(upload.if,'always()');const paths=upload.with.path.split('\n').filter(value=>value.startsWith(prefix));assert.deepEqual(paths.sort(),suffixes.map(suffix=>prefix+suffix).sort());assert.doesNotMatch(paths.join('\n'),/webview|profile|AppData|USERPROFILE|\.\.\//);}
 assert.match(read('.gitignore'),/^\/desktop-authoring\/$/m);assert.doesNotMatch(read('.gitignore'),/^\/desktop-\*\/?$/m);
});

import './check-workflow.test.js';
