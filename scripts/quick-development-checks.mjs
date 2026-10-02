import {execFileSync,spawnSync} from 'node:child_process';
import {existsSync,readdirSync,writeFileSync} from 'node:fs';
import {basename,resolve} from 'node:path';

// Fast feedback for an unfinished development batch. This is deliberately not
// browser, Windows, native-package or main-promotion acceptance.
const root=resolve(import.meta.dirname,'..');
const supplied=process.env.WMH_QUICK_BASE;
let base=/^[a-f0-9]{40}$/i.test(supplied||'')&&!/^0+$/.test(supplied)?supplied:'HEAD^';
try{execFileSync('git',['rev-parse','--verify',base],{cwd:root,stdio:'pipe'});}catch{base='HEAD^';}
const changed=execFileSync('git',['diff','--name-only',base,'HEAD'],{cwd:root,encoding:'utf8'}).trim().split('\n').filter(Boolean);
const tests=readdirSync(resolve(root,'tests')).filter(name=>name.endsWith('.test.js')&&!name.includes('browser')).map(name=>'tests/'+name);
const selected=new Set([
  'tests/frontend-core.test.js','tests/score-schema.test.js','tests/keyboard-input.test.js',
  'tests/free-practice-recorder.test.js','tests/midi-binding.test.js','tests/i18n.test.js',
]);
const appChecks=['frontend-app-dom','frontend-free-practice-app','frontend-reference-listening','frontend-performance-view','frontend-rhythm-shell','frontend-game-shell','frontend-difficulty-app','frontend-free-piano-stage','frontend-game-lobby'];
for(const file of changed){
  if(tests.includes(file))selected.add(file);
  if(file.startsWith('web/')){
    const stem=basename(file).replace(/\.(?:js|css)$/,'');
    for(const test of tests)if(basename(test).includes(stem))selected.add(test);
    if(['app.js','game-shell.js','rhythm-shell.js'].includes(basename(file)))for(const name of appChecks){const test='tests/'+name+'.test.js';if(existsSync(resolve(root,test)))selected.add(test);}
  }
}
const checks=[...selected].filter(path=>existsSync(resolve(root,path))).sort();
const syntax=changed.filter(path=>path.endsWith('.js')&&/^(web|tests|scripts)\//.test(path)&&existsSync(resolve(root,path)));
const report={kind:'quick-development-only',base,head:execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim(),changed,syntax,tests:checks,deferred:['full npm suite','real browser and screenshots','Windows Rust/native input','package, extracted startup and provenance'],accepted:false};
console.log(JSON.stringify(report,null,2));
for(const path of syntax){const result=spawnSync(process.execPath,['--check',path],{cwd:root,stdio:'inherit'});if(result.status!==0)process.exit(result.status||1);}
const result=spawnSync(process.execPath,['--test',...checks],{cwd:root,stdio:'inherit'});
report.quick_tests_passed=result.status===0;
if(process.env.WMH_QUICK_REPORT)writeFileSync(process.env.WMH_QUICK_REPORT,JSON.stringify(report,null,2));
if(result.status!==0)process.exit(result.status||1);
console.log('Quick development checks passed. Full checkpoint acceptance is still required.');
