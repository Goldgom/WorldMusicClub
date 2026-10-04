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

test('focused pitch workflow isolates preview source and requires both actual environments without publishing a candidate',()=>{
 assert.match(workflow,/branches: \['preview\/original-pitch-bend-acceptance'\]/);assert.match(workflow,/workflow_dispatch:/);
 assert.match(workflow,/needs: \[pitch-browser, pitch-windows\]/);assert.match(workflow,/BROWSER.*success/s);assert.match(workflow,/WINDOWS.*success/s);
 assert.equal((workflow.match(/ref: \$\{\{ github.sha \}\}/g)||[]).length,2);
 assert.match(workflow,/WMH_SOURCE_SHA: \$\{\{ github.sha \}\}/);
 for(const height of [720,900])assert.ok(workflow.includes(`WMH_VIEWPORT_HEIGHT=${height} node scripts/hosted-pitch-bend-check.mjs`));
 assert.match(workflow,/-Executable target\/release\/worldmusichub-desktop\.exe -OutputDirectory desktop-pitch-bend -Scenario pitch-bend/);
 assert.match(workflow,/verify-native-pitch-bend-evidence\.mjs --check desktop-pitch-bend/);
 assert.match(workflow,/native-pitch-bend-manifest\.py desktop-pitch-bend --executable target\/release\/worldmusichub-desktop\.exe --commit '\$\{\{ github.sha \}\}' --tree/);
 assert.doesNotMatch(workflow,/native-release-manifest|gh release|contents: write|dist\/WorldMusicHub|current233|webview-profile/);
 const artifactPaths=workflow.split('path: |').slice(1).map(s=>s.split('if-no-files-found')[0]);assert.equal(artifactPaths.length,2);
 for(const artifact of artifactPaths){assert.doesNotMatch(artifact,/\.\.\/|webview-profile/);for(const line of artifact.trim().split('\n'))assert.match(line.trim(),/^(?:test-results\/pitch-bend\/\*|desktop-pitch-bend)\/(?:\*\.(?:json|png|log)|(?:downloads|fixtures)\/\*|Scores\/(?:clean-songs|clean-backups|imports|import-backups)\/\*\*)$/);assert.match(artifact,/\/fixtures\/\*/);assert.match(artifact,/\/Scores\/clean-songs\/\*\*/);}
});

test('hosted acceptance cannot run locally or against a dirty/different source and retains strict source/take comparators',()=>{
 assert.match(hosted,/GITHUB_ACTIONS!=='true'\|\|process.env.WMH_HOSTED_BROWSER!=='1'/);
 assert.match(hosted,/git.*status.*--porcelain/s);assert.match(hosted,/assert.equal\(process.env.WMH_SOURCE_SHA,head/);
 assert.match(hosted,/validatePerformanceTakes\([^;]+renderer,fixture\)/);
 assert.match(hosted,/validatePerformanceExport/);assert.match(hosted,/assert.ok\(a.sequence<=64\)/);
 assert.doesNotMatch(hosted,/setInputFiles|setContent|addScriptTag|localhost:\d|127\.0\.0\.1/);
});

test('both process-owned pitch phases keep existing phases and report/action budgets unchanged',()=>{
 assert.match(rust,/pub const PERFORMANCE_PHASES: \[&str; 3\] = \[\s*"performance-seed",\s*"performance-controls",\s*"performance-restart",\s*\]/);
 assert.match(rust,/PITCH_BEND_PHASES: \[&str; 2\] = \["pitch-bend-seed", "pitch-bend-restart"\]/);
 assert.match(rust,/MAX_CLEAN_REPORT_BYTES: usize = 1024 \* 1024/);assert.match(rust,/1\.\.=64/);
 assert.match(native,/\$Scenario -eq 'pitch-bend'\)\{@\('pitch-bend-seed','pitch-bend-restart'\)\}/);
 assert.match(native,/\$sequence -gt 64/);assert.match(native,/Rotate-SongFolderProfile \$phase/);
 assert.ok(picker.includes('"pitch-bend-authored-songs.zip"'));assert.ok(native.includes("'prepare-pitch-bend-fixtures.mjs'"));
});

test('pitch injection reuses helper prefixes with exactly one runner and preserves real delegated methods',()=>{
 for(const source of [vsq,performance,renderer])assert.equal(source.split('(() => {').length,2);
 const injected=[wait,reference,vsq.split('(() => {')[0],performance.split('(() => {')[0],renderer].join('\n');
 assert.doesNotThrow(()=>new vm.Script(injected));
 assert.equal((injected.match(/addEventListener\('DOMContentLoaded'/g)||[]).length,1);
 assert.match(renderer,/Reflect.apply\(original,this,args\)/);assert.match(renderer,/structuredClone\(r\)/);
 assert.match(renderer,/row.frequencies.length>=12/);assert.match(renderer,/sequence<64/);
 assert.match(renderer,/preparePerformanceBaseline\(\{phase:phase==='pitch-bend-seed'\?'performance-seed':'performance-restart'/);
 assert.match(renderer,/humanActionStart:sequence/);assert.doesNotMatch(renderer,/delete .*input_evidence|filter.*blur|\.passes\s*=/);
});
