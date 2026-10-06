import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {LIVE_TONE_NAVIGATION_PHASES} from '../scripts/prepare-live-tone-navigation-fixtures.mjs';
import {LIVE_TONE_NAVIGATION_SOURCE_FILES,LIVE_TONE_NAVIGATION_SOURCE_LIMIT} from '../scripts/verify-native-live-tone-navigation-evidence.mjs';
import {CANONICAL_PRACTICE_SOURCE_FILES} from '../scripts/canonical-practice-source-evidence.mjs';

const root=new URL('../',import.meta.url),read=path=>readFileSync(new URL(path,root),'utf8');
const rust=read('crates/desktop-shell/src/acceptance.rs'),host=read('scripts/windows-desktop-acceptance.ps1'),native=read('scripts/windows-desktop-native.cs'),fixed=read('scripts/windows-live-tone-navigation.cs'),profile=read('scripts/windows-desktop-profile.ps1');

test('native live-navigation registration selects only its new runner, fresh phase family, fixed R actions and fixture',()=>{
  for(const phase of LIVE_TONE_NAVIGATION_PHASES){assert.ok(rust.includes(`"${phase}"`));assert.ok(host.includes(`'${phase}'`));assert.ok(profile.includes(`'${phase}'`));assert.ok(fixed.includes(`"${phase}"`));}
  assert.match(rust,/\.chain\(LIVE_TONE_NAVIGATION_PHASES\)/);assert.match(rust,/if LIVE_TONE_NAVIGATION_PHASES.contains\(&self.phase\)[\s\S]*?canonical_helpers[\s\S]*?live-tone-navigation-acceptance.js/);
  for(const token of ['|| LIVE_TONE_NAVIGATION_PHASES.contains(&self.phase)','&& !LIVE_TONE_NAVIGATION_PHASES.contains(&self.phase)','|| LIVE_TONE_NAVIGATION_PHASES.contains(&run.phase)'])assert.ok(rust.includes(token));
  assert.match(rust,/if live_navigation && file != "live-tone-navigation-original.json"/);assert.match(rust,/live_navigation[\s\S]*\["live-key-r-down", "live-key-r-up"\]/);
  assert.match(read('crates/desktop-shell/src/windows.rs'),/LIVE_TONE_NAVIGATION_PHASES.contains\(&acceptance.phase\)/);
  assert.match(host,/prepare-live-tone-navigation-fixtures.mjs/);assert.match(host,/--source-binding \$Repository/);assert.match(host,/native-live-tone-navigation.json/);assert.match(host,/WMH_LIVE_TONE_NAVIGATION_EXECUTABLE=\$Executable/);
  assert.match(host,/live-navigation phase completed with a held test key/);assert.match(host,/live_key_held_at_close=\[NativeLiveToneNavigationKey\]::Held/);assert.ok(native.includes('"live-tone-navigation-original.json"'));
});

test('native R state and cleanup are closed, bounded and independent of existing C5 and paired-key behavior',()=>{
  assert.match(fixed,/if\(!IsPhase\(phase\)\)/);assert.match(fixed,/foreground!=window/);assert.match(fixed,/priorPhase!=phase \|\| priorWindow!=window \|\| priorProcess!=process/);
  assert.match(fixed,/held=true;ownerPhase=phase;ownerWindow=window;ownerProcess=process;heldClock=/);assert.match(fixed,/keybd_event\(0x52,[^\n]*,0,UIntPtr.Zero\)/);assert.match(fixed,/keybd_event\(0x52,[^\n]*,2,UIntPtr.Zero\)/);
  assert.match(fixed,/if\(!held\)return false/);assert.doesNotMatch(fixed,/SetForegroundWindow|SetCursorPos|ClickPositioned|SendKeys|public static void \w+\(byte key/);
  const action=host.slice(host.indexOf('function Native-Action('),host.indexOf('function Save-SongFolderSnapshot('));assert.ok(action.indexOf("'live-key-r-down'")<action.indexOf('::SetForegroundWindow('));
  assert.match(host,/HeldMilliseconds -gt 10000/);assert.match(host,/try \{if\(\$fixedLiveKeyScenario\)\{\[void\]\[NativeLiveToneNavigationKey\]::ReleaseIfHeld\(\)\}\}\s*finally \{\s*if\(\$null -ne \$app/);
  assert.match(host,/-not \$fixedLiveKeyScenario -or -not \[NativeLiveToneNavigationKey\]::Held\)\)\{Capture-Window \$app "native-action-/,'Synchronous action captures must be skipped while the new test key is held');
  const failure=host.slice(host.indexOf('  $firstError=$_;$failure='),host.lastIndexOf('} finally {'));
  assert.ok(failure.indexOf('::ReleaseIfHeld()')>=0&&failure.indexOf('::ReleaseIfHeld()')<failure.indexOf('Capture-Window $app "native-failure-'),'Owned R must be released before failure screenshots');
  assert.match(failure,/-not \$fixedLiveKeyScenario -or -not \[NativeLiveToneNavigationKey\]::Held/,'A failed release must not lead into blocking capture');
  assert.match(host,/Start-Sleep -Milliseconds 100\s*\}/,'The original bounded host polling cadence stays intact');
  const c5=action.slice(action.indexOf("if($Action.kind -eq 'key-c5')"),action.indexOf("if($Action.kind -eq 'toggle-follow')"));assert.match(c5,/Prepared C5 app foreground ownership was lost/);assert.match(c5,/hold_ms=40;focus_reacquired=\$false;pointer_clicked=\$false/);assert.match(c5,/HeldPerformanceKey\(0x32\)/);assert.doesNotMatch(c5,/SetForegroundWindow|ClickPositioned|LiveToneNavigation/);
  const held=native.slice(native.indexOf('public static void HeldPerformanceKey('),native.indexOf('public static void Click('));assert.match(held,/if\(key!=0x32 && key!=0x55\)/);assert.match(held,/Thread.Sleep\(40\)/);assert.match(held,/finally \{ keybd_event\(key,scan,2,UIntPtr.Zero\); \}/);assert.doesNotMatch(held,/0x52/);
  assert.match(host,/if\(\$Action.kind -eq 'key-r'\)\{\[NativeAcceptance\]::Key\(0x52\);return\}/);
});

test('the native source inventory includes the complete current runtime binding within the explicitly expanded diagnostic capacity',()=>{
  assert.ok(LIVE_TONE_NAVIGATION_SOURCE_FILES.length<=LIVE_TONE_NAVIGATION_SOURCE_LIMIT);assert.equal(new Set(LIVE_TONE_NAVIGATION_SOURCE_FILES).size,LIVE_TONE_NAVIGATION_SOURCE_FILES.length);
  for(const path of CANONICAL_PRACTICE_SOURCE_FILES)assert.ok(LIVE_TONE_NAVIGATION_SOURCE_FILES.includes(path),`Missing inherited runtime module: ${path}`);
  for(const path of ['scripts/windows-live-tone-navigation.cs','.github/workflows/native-live-tone-navigation.yml','crates/desktop-shell/live-tone-navigation-acceptance.js','tests/live-tone-navigation-proof.js'])assert.ok(LIVE_TONE_NAVIGATION_SOURCE_FILES.includes(path));
  const scripts=JSON.parse(read('package.json')).scripts;for(const name of ['native-live-tone-navigation-renderer','native-live-tone-navigation-evidence','native-live-tone-navigation-registration']){assert.ok(scripts.test.includes(`tests/${name}.test.js`));assert.ok(scripts['test:native-live-navigation'].includes(`tests/${name}.test.js`));}
});

test('the optional native workflow builds and rechecks one exact source without package promotion, retaining failed diagnostics',()=>{
  const python=process.env.PYTHON||(process.platform==='win32'?'python':'python3'),parsed=spawnSync(python,['scripts/check-authoring-workflow.py','.github/workflows/native-live-tone-navigation.yml','--json'],{cwd:root,encoding:'utf8'});assert.equal(parsed.status,0,parsed.stderr);
  const workflow=JSON.parse(parsed.stdout);assert.deepEqual(workflow.on.push.branches,['preview/native-live-tone-navigation']);assert.ok(Object.hasOwn(workflow.on,'workflow_dispatch'));assert.equal(workflow.on.pull_request,undefined);assert.deepEqual(workflow.permissions,{contents:'read'});
  const job=workflow.jobs['native-live-navigation'];assert.equal(job['runs-on'],'windows-latest');assert.equal(job['timeout-minutes'],35);for(const step of job.steps)assert.equal(step['continue-on-error'],undefined);
  const checkout=job.steps.find(step=>step.uses?.startsWith('actions/checkout@'));assert.equal(checkout.with.ref,'${{ github.sha }}');const run=job.steps.find(step=>step.run?.includes('-Scenario live-tone-navigation'));assert.ok(run);assert.equal(run.if,undefined);assert.match(run.run,/git rev-parse HEAD/);assert.match(run.run,/git status --porcelain --untracked-files=normal/);
  const verify=job.steps.find(step=>step.run?.includes('verify-native-live-tone-navigation-evidence.mjs --check'));assert.ok(verify);assert.equal(verify.if,undefined);assert.match(verify.env.WMH_LIVE_TONE_NAVIGATION_EXECUTABLE,/target\/release\/worldmusichub-desktop.exe$/);
  const artifacts=job.steps.filter(step=>step.uses?.startsWith('actions/upload-artifact@'));assert.equal(artifacts.length,2);assert.ok(artifacts.every(step=>step.if==='always()'));assert.ok(artifacts.some(step=>step.with.path.includes('!${{ runner.temp }}/live-tone-navigation-windows/webview-profiles/**')));
  assert.doesNotMatch(read('.github/workflows/native-live-tone-navigation.yml'),/native-release-manifest|gh release|softprops\/action-gh-release|windows-desktop-acceptance\.yml/);
});
