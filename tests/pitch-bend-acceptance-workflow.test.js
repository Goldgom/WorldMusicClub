import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
const read=name=>readFile(new URL(`../${name}`,import.meta.url),'utf8');
const [workflow,hosted,native,rust,picker,renderer,performance,vsq,wait,reference]=await Promise.all([
 '.github/workflows/pitch-bend-preview.yml','scripts/hosted-pitch-bend-check.mjs','scripts/windows-desktop-acceptance.ps1',
 'crates/desktop-shell/src/acceptance.rs','scripts/windows-desktop-native.cs','crates/desktop-shell/pitch-bend-acceptance.js',
 'crates/desktop-shell/performance-song-acceptance.js','crates/desktop-shell/vsq-song-acceptance.js',
 'crates/desktop-shell/acceptance-wait.js','crates/desktop-shell/reference-acceptance.js',
].map(read));

// YAML plain scalars cannot contain a colon followed by whitespace. In
// particular, Rust module filters such as acceptance:: require quoting in
// an inline run value; source-text command checks alone cannot catch this.
function assertPlainRunScalars(text) {
 for(const line of text.split('\n')) {
  const value=line.match(/^\s*(?:-\s+)?run:\s+(.+)$/)?.[1];
  if(value&&!/^[|'"\[>{]/.test(value)) assert.doesNotMatch(value,/:\s/,`Quote the inline YAML run value: ${line.trim()}`);
 }
}
test('inline workflow run values reject YAML mapping delimiters in unquoted commands',()=>{
 for(const source of ['- run: cargo test --lib acceptance:: --locked','- run: echo status: ready']) assert.throws(()=>assertPlainRunScalars(source));
 for(const source of ['- run: "cargo test --lib acceptance:: --locked"',"- run: 'echo status: ready'",'- run: |\n    echo status: ready','- run: node tests/check.mjs']) assert.doesNotThrow(()=>assertPlainRunScalars(source));
 assertPlainRunScalars(workflow);
});

test('focused pitch workflow isolates preview source and requires both actual environments without publishing a candidate',()=>{
 assert.match(workflow,/branches: \['preview\/original-pitch-bend-acceptance'\]/);assert.match(workflow,/workflow_dispatch:/);
 assert.match(workflow,/needs: \[pitch-browser, pitch-windows\]/);assert.match(workflow,/BROWSER.*success/s);assert.match(workflow,/WINDOWS.*success/s);
 assert.equal((workflow.match(/ref: \$\{\{ github.sha \}\}/g)||[]).length,2);
 assert.match(workflow,/WMH_SOURCE_SHA: \$\{\{ github.sha \}\}/);
 for(const height of [720,900])assert.ok(workflow.includes(`WMH_VIEWPORT_HEIGHT=${height} node scripts/hosted-pitch-bend-check.mjs`));
 assert.match(workflow,/-Executable target\/release\/worldmusichub-desktop\.exe -OutputDirectory desktop-pitch-bend -Scenario pitch-bend/);
 assert.match(workflow,/verify-native-pitch-bend-evidence\.mjs --check desktop-pitch-bend/);
 assert.match(workflow,/native-pitch-bend-manifest\.py desktop-pitch-bend --executable target\/release\/worldmusichub-desktop\.exe --commit '\$\{\{ github.sha \}\}' --tree/);
 assert.doesNotMatch(workflow,/native-release-manifest|gh release|contents: write|dist\/WorldMusic(?:Hub|Club)|current233|webview-profile/);
 const artifactPaths=workflow.split('path: |').slice(1).map(s=>s.split('if-no-files-found')[0]);assert.equal(artifactPaths.length,2);
 for(const artifact of artifactPaths){assert.doesNotMatch(artifact,/\.\.\/|webview-profile/);for(const line of artifact.trim().split('\n'))assert.match(line.trim(),/^(?:test-results\/pitch-bend\/\*|desktop-pitch-bend)\/(?:\*\.(?:json|png|log)|(?:downloads|fixtures)\/\*|Scores\/(?:clean-songs|clean-backups|imports|import-backups)\/\*\*)$/);assert.match(artifact,/\/fixtures\/\*/);assert.match(artifact,/\/Scores\/clean-songs\/\*\*/);}
});

test('hosted acceptance cannot run locally or against a dirty/different source and retains strict source/take comparators',()=>{
 assert.match(hosted,/GITHUB_ACTIONS!=='true'\|\|process.env.WMH_HOSTED_BROWSER!=='1'/);
 assert.match(hosted,/git.*status.*--porcelain/s);assert.match(hosted,/assert.equal\(process.env.WMH_SOURCE_SHA,head/);
 assert.match(hosted,/validatePerformanceTakes\([^;]+renderer,fixture\)/);
 assert.match(hosted,/validatePerformanceExport/);assert.match(hosted,/assert.ok\(a.sequence<=75\)/);
 assert.doesNotMatch(hosted,/setInputFiles|setContent|addScriptTag|localhost:\d|127\.0\.0\.1/);
});

test('both process-owned pitch phases keep existing phases and report/action budgets unchanged',()=>{
 assert.match(rust,/pub const PERFORMANCE_PHASES: \[&str; 3\] = \[\s*"performance-seed",\s*"performance-controls",\s*"performance-restart",\s*\]/);
 assert.match(rust,/PITCH_BEND_PHASES: \[&str; 2\] = \["pitch-bend-seed", "pitch-bend-restart"\]/);
 assert.match(rust,/MAX_CLEAN_REPORT_BYTES: usize = 1024 \* 1024/);assert.match(rust,/1\.\.=action_limit\(phase\)/);
 assert.match(native,/\$Scenario -eq 'pitch-bend'\)\{@\('pitch-bend-seed','pitch-bend-restart'\)\}/);
 assert.match(native,/\$sequence -gt \$actionLimit/);assert.match(native,/Assert-AcceptanceProfileLaunch \$OutputDirectory \$phase/);
 assert.match(native,/Assert-AcceptanceProfileEvidence \$OutputDirectory \$profileSelection \$app.Id/);
 assert.doesNotMatch(native,/Rotate-SongFolderProfile|prior-profile/);
 assert.ok(picker.includes('"pitch-bend-authored-songs.zip"'));assert.ok(native.includes("'prepare-pitch-bend-fixtures.mjs'"));
});

test('pitch injection reuses helper prefixes with exactly one runner and preserves real delegated methods',()=>{
 for(const source of [vsq,performance,renderer])assert.equal(source.split('(() => {').length,2);
 const injected=[wait,reference,vsq.split('(() => {')[0],performance.split('(() => {')[0],renderer].join('\n');
 assert.doesNotThrow(()=>new vm.Script(injected));
 assert.equal((injected.match(/addEventListener\('DOMContentLoaded'/g)||[]).length,1);
 assert.match(renderer,/Reflect.apply\(original,this,args\)/);assert.match(renderer,/structuredClone\(r\)/);
 assert.match(renderer,/row.frequencies.length>=12/);assert.match(renderer,/sequence<75/);
 assert.match(renderer,/preparePerformanceBaseline\(\{phase:phase==='pitch-bend-seed'\?'performance-seed':'performance-restart'/);
 assert.match(renderer,/humanActionStart:sequence/);assert.doesNotMatch(renderer,/delete .*input_evidence|filter.*blur|\.passes\s*=/);
});

test('pitch native key action requires focus on the existing disclosure summary before queuing OS input',async()=>{
 // Execute the actual renderer action helper with a modeled focus owner. This
 // checks fail-closed admission, not trusted input or browser focus behavior.
 const start=renderer.indexOf(' async function native('),end=renderer.indexOf('\n const inventory=',start);
 assert.ok(start>=0&&end>start);const actionSource=renderer.slice(start,end);
 assert.match(renderer,/await native\('key-r',\$\('complete-performance-policy-title'\)\)/);
 assert.doesNotMatch(renderer,/native\('key-r',\$\('complete-performance-title'\)\)/);
 function harness(id,{focusable=true,loseFocus=false}={}){
  const actions=[],body={tagName:'BODY'},document={activeElement:body};let frames=0;
  const node={id,tagName:id==='stage-title'?'H1':'SUMMARY',disabled:false,scrollIntoView(){},focus(){if(focusable)document.activeElement=node;},getBoundingClientRect:()=>({x:20,y:30,width:100,height:40}),contains:()=>false};
  document.elementFromPoint=()=>node;
  const context={document,sequence:0,innerWidth:1280,innerHeight:720,assert:(ok,message)=>assert.ok(ok,message),frame:async()=>{if(++frames===2&&loseFocus)document.activeElement=body;},controls:{},json:async(path,action)=>{assert.equal(path,'/__desktop_smoke/action');actions.push(action);},fetcher:async()=>({status:200,ok:true,json:async()=>({ok:true})}),until:async predicate=>assert.equal(await predicate(),true)};
  return{node,actions,run:vm.runInNewContext(`${actionSource}\n native`,context)};
 }
 for(const id of ['stage-title','complete-performance-policy-title']){
  const good=harness(id);assert.equal(await good.run('key-r',good.node),1);assert.equal(good.actions.length,1);assert.equal(good.actions[0].kind,'key-r');
  for(const options of [{focusable:false},{loseFocus:true}]){const bad=harness(id,options);await assert.rejects(bad.run('key-r',bad.node),/did not receive focus \(active: BODY\)/);assert.deepEqual(bad.actions,[],'Focus failure must not dispatch an OS keyboard action');}
 }
 const screenshot=harness('complete-performance-title',{focusable:false});assert.equal(await screenshot.run('click',screenshot.node),1,'A heading remains a valid coordinate screenshot target');
});
