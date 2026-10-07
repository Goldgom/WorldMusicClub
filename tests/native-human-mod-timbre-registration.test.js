import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {Script} from 'node:vm';

const root=new URL('../',import.meta.url),read=name=>readFileSync(new URL(name,root),'utf8');
const phases=['human-timbre-seed','human-timbre-migrate','human-timbre-restart'];
const rust=read('crates/desktop-shell/src/acceptance.rs'),host=read('scripts/windows-desktop-acceptance.ps1'),profile=read('scripts/windows-desktop-profile.ps1'),fixed=read('scripts/windows-live-tone-navigation.cs');

test('human timbre has one finite phase family, original seed picker and only existing fixed actions',()=>{
  for(const phase of phases){assert.ok(rust.includes(`"${phase}"`));assert.ok(host.includes(`'${phase}'`));assert.ok(profile.includes(`'${phase}'`));assert.ok(fixed.includes(`"${phase}"`));}
  assert.match(rust,/pub const HUMAN_MOD_TIMBRE_PHASES: \[&str; 3\]/);assert.match(rust,/\.chain\(HUMAN_MOD_TIMBRE_PHASES\)/);
  const dispatch=host.match(/^\$phases=(.+)$/m)?.[1];assert.ok(dispatch,'One closed phase dispatch required');
  assert.match(dispatch,/(?:^|else)if\(\$Scenario -eq 'human-mod-timbre'\)\{@\('human-timbre-seed','human-timbre-migrate','human-timbre-restart'\)\}/);
  assert.match(host,/if\(\$Action.kind -cnotin @\('click','picker','select-first','select-second','select-last','key-r','live-key-r-down','live-key-r-up'\)\)/);
  assert.match(rust,/human_timbre\s*&& !\(phase == "human-timbre-seed" && file == "human-mod-timbre-original.json"\)/);
  assert.match(rust,/human_timbre && value\["kind"\] == "select-second"/);
  assert.match(host,/\$Action.kind -ceq 'picker' -and \(\$env:WMH_DESKTOP_ACCEPTANCE_PHASE -cne 'human-timbre-seed' -or \$Action.file -cne 'human-mod-timbre-original.json'\)/);
  assert.match(host,/prepare-human-mod-timbre-fixtures.mjs/);assert.ok(read('scripts/windows-desktop-native.cs').includes('"human-mod-timbre-original.json"'));
  assert.match(rust,/fn human_timbre_registration_and_actions_are_closed_and_bounded/);
  assert.match(read('crates/desktop-shell/src/windows.rs'),/HUMAN_MOD_TIMBRE_PHASES.contains\(&acceptance.phase\)/);
});

test('human timbre composes passive observers and owned controls without starting other runners',()=>{
  const composition=rust.slice(rust.indexOf('if HUMAN_MOD_TIMBRE_PHASES.contains(&self.phase)'),rust.indexOf('if BUILD_DIAGNOSTICS_PHASES.contains(&self.phase)'));
  for(const name of ['human-mod-timbre-acceptance.js','reference-acceptance.js','live-tone-acceptance.js','vsq-song-acceptance.js','canonical-practice-acceptance.js','live-tone-navigation-acceptance.js'])assert.ok(composition.includes(name));
  assert.equal((composition.match(/\.split_once/g)||[]).length,3);
  const script=[read('crates/desktop-shell/acceptance-wait.js'),read('crates/desktop-shell/reference-acceptance.js'),read('crates/desktop-shell/live-tone-acceptance.js'),...['vsq-song','canonical-practice','live-tone-navigation'].map(name=>read(`crates/desktop-shell/${name}-acceptance.js`).split('(() => {')[0]),read('crates/desktop-shell/human-mod-timbre-acceptance.js')].join('\n');
  assert.doesNotThrow(()=>new Script(script));
  for(const name of ['vsq-song','canonical-practice','live-tone-navigation'])assert.ok(!script.includes(read(`crates/desktop-shell/${name}-acceptance.js`)));
});

test('same-profile migration and restart require exact prior host records, with unchanged bounds and release protections',()=>{
  assert.match(profile,/\$humanTimbrePhase -and \$Phase -cne 'human-timbre-seed'/);
  assert.match(profile,/Assert-CatalogProfilePredecessor \$Directory \$selection 'human-timbre-seed' \$true/);
  assert.match(profile,/if\(\$Phase -ceq 'human-timbre-restart'\)\{Assert-CatalogProfilePredecessor \$Directory \$selection 'human-timbre-migrate' \$false\}/);
  assert.match(rust,/fn human_timbre_profile_requires_exact_migration_predecessors/);
  assert.doesNotMatch(profile,/Copy-Item|Move-Item|Remove-Item|New-Item/);
  for(const token of ['|| HUMAN_MOD_TIMBRE_PHASES.contains(&self.phase)','&& !HUMAN_MOD_TIMBRE_PHASES.contains(&self.phase)','|| HUMAN_MOD_TIMBRE_PHASES.contains(&run.phase)'])assert.ok(rust.includes(token));
  const limit=rust.slice(rust.indexOf('fn action_limit('),rust.indexOf('fn valid_progress('));assert.doesNotMatch(limit,/HUMAN_MOD_TIMBRE|human-timbre/);assert.match(limit,/else \{\s*64/);
  assert.match(host,/\$fixedLiveKeyScenario=\$Scenario -cin @\('live-tone-navigation','human-mod-timbre'\)/);
  assert.match(host,/\$fixedLiveKeyScenario -and \[NativeLiveToneNavigationKey\]::Held -and \[NativeLiveToneNavigationKey\]::HeldMilliseconds -gt 10000/);
  assert.match(host,/-not \$fixedLiveKeyScenario -or -not \[NativeLiveToneNavigationKey\]::Held/);
  assert.match(host,/try \{if\(\$fixedLiveKeyScenario\)\{\[void\]\[NativeLiveToneNavigationKey\]::ReleaseIfHeld\(\)\}\}/);
  assert.match(fixed,/priorPhase!=phase \|\| priorWindow!=window \|\| priorProcess!=process/);
  assert.doesNotMatch(fixed,/SetForegroundWindow|SetCursorPos|SendKeys|public static void \w+\(byte key/);
  assert.match(host,/WMH_HUMAN_MOD_TIMBRE_EXECUTABLE=\$Executable/);assert.match(host,/verify-native-human-mod-timbre-evidence.mjs'\) --source-binding \$Repository/);
});

test('optional native human timbre workflow builds and checks one exact SHA without release or profile publication',()=>{
  const python=process.env.PYTHON||(process.platform==='win32'?'python':'python3');
  const parsed=spawnSync(python,['scripts/check-authoring-workflow.py','.github/workflows/native-human-mod-timbre.yml','--json'],{cwd:root,encoding:'utf8'});assert.equal(parsed.status,0,parsed.stderr);
  const workflow=JSON.parse(parsed.stdout),job=workflow.jobs['native-human-timbre'];
  assert.deepEqual(workflow.on.push.branches,['preview/native-human-mod-timbre']);assert.ok(Object.hasOwn(workflow.on,'workflow_dispatch'));assert.equal(workflow.on.pull_request,undefined);assert.deepEqual(workflow.permissions,{contents:'read'});
  assert.equal(job['runs-on'],'windows-latest');for(const step of job.steps)assert.equal(step['continue-on-error'],undefined);
  assert.equal(job.steps.find(step=>step.uses?.startsWith('actions/checkout@')).with.ref,'${{ github.sha }}');
  const run=job.steps.find(step=>step.run?.includes('-Scenario human-mod-timbre'));assert.equal(run.if,undefined);assert.match(run.run,/git rev-parse HEAD/);assert.match(run.run,/git status --porcelain --untracked-files=normal/);
  const verify=job.steps.find(step=>step.run?.includes('verify-native-human-mod-timbre-evidence.mjs --check'));assert.equal(verify.if,undefined);assert.equal(verify.env.WMH_HUMAN_MOD_TIMBRE_EXECUTABLE,'${{ github.workspace }}/target/release/worldmusichub-desktop.exe');
  const artifacts=job.steps.filter(step=>step.uses?.startsWith('actions/upload-artifact@'));assert.equal(artifacts.length,2);assert.ok(artifacts.every(step=>step.if==='always()'));assert.ok(artifacts.some(step=>step.with.path.includes('!${{ runner.temp }}/human-mod-timbre-windows/webview-profiles/**')));
  assert.doesNotMatch(read('.github/workflows/native-human-mod-timbre.yml'),/gh release|native-release-manifest|softprops\/action-gh-release|windows-desktop-acceptance\.yml/);
});

const pwsh=spawnSync('pwsh',['-NoLogo','-NoProfile','-Command','$PSVersionTable.PSVersion.ToString()'],{encoding:'utf8'});
test('pure Windows-host contract rejects unowned R transitions and missing or forged migration predecessors',{skip:pwsh.error?.code==='ENOENT'?'PowerShell is unavailable in this executor':false},()=>{
  assert.equal(pwsh.status,0,pwsh.stderr);
  const script=String.raw`
$ErrorActionPreference='Stop'
foreach($script in @('scripts/windows-desktop-acceptance.ps1','scripts/windows-desktop-profile.ps1')) {
  $tokens=$null; $errors=$null
  [void][System.Management.Automation.Language.Parser]::ParseFile((Resolve-Path $script),[ref]$tokens,[ref]$errors)
  if($errors.Count){throw ($errors | Out-String)}
}
Add-Type -Path @((Resolve-Path 'scripts/windows-desktop-native.cs').Path,(Resolve-Path 'scripts/windows-live-tone-navigation.cs').Path)
. ./scripts/windows-desktop-profile.ps1
function Assert-True($Value,[string]$Message){if(-not $Value){throw $Message}}
function Assert-Throws([scriptblock]$Operation){$failed=$false;try{& $Operation | Out-Null}catch{$failed=$true};if(-not $failed){throw 'Expected a closed-contract rejection'}}
$phases=@('human-timbre-seed','human-timbre-migrate','human-timbre-restart')
foreach($phase in $phases){
  Assert-True ([NativeLiveToneNavigationKey]::IsPhase($phase)) 'Exact phase missing'
  Assert-True ([NativeLiveToneNavigationKey]::ValidateTransition($phase,'live-key-r-down',$false,$null,[IntPtr]::Zero,0,[IntPtr]42,[IntPtr]42,71,$true)) 'Owned down rejected'
  Assert-True (-not [NativeLiveToneNavigationKey]::ValidateTransition($phase,'live-key-r-up',$true,$phase,[IntPtr]42,71,[IntPtr]42,[IntPtr]42,71,$true)) 'Owned up rejected'
  Assert-Throws { [NativeLiveToneNavigationKey]::ValidateTransition($phase,'live-key-r-up',$true,'other',[IntPtr]42,71,[IntPtr]42,[IntPtr]42,71,$true) }
  Assert-Throws { [NativeLiveToneNavigationKey]::ValidateTransition($phase,'live-key-r-down',$false,$null,[IntPtr]::Zero,0,[IntPtr]42,[IntPtr]43,71,$true) }
  Assert-Throws { [NativeLiveToneNavigationKey]::ValidateTransition($phase,'arbitrary-key',$false,$null,[IntPtr]::Zero,0,[IntPtr]42,[IntPtr]42,71,$true) }
}
foreach($phase in @('human-timbre-final','human-timbre-controls','HUMAN-TIMBRE-SEED')){Assert-True (-not [NativeLiveToneNavigationKey]::IsPhase($phase)) 'Unexpected phase admitted'}
Assert-True (-not [NativeLiveToneNavigationKey]::Held) 'Pure validation changed key state'
Assert-True (-not [NativeLiveToneNavigationKey]::ReleaseIfHeld()) 'Idle cleanup sent a key'
$directory=Join-Path ([IO.Path]::GetTempPath()) ('wmh-human-profile-'+[guid]::NewGuid().ToString('N'))
[void][IO.Directory]::CreateDirectory($directory)
try {
  $seed=Assert-AcceptanceProfileLaunch $directory 'human-timbre-seed'
  Assert-True $seed.fresh_required 'Seed must be fresh'
  Assert-True (-not $seed.existing_required) 'Seed may not reuse a profile'
  Assert-Throws { Assert-AcceptanceProfileLaunch $directory 'human-timbre-migrate' }
  [void][IO.Directory]::CreateDirectory($seed.profile_directory)
  Assert-Throws { Assert-AcceptanceProfileLaunch $directory 'human-timbre-seed' }
  Assert-Throws { Assert-AcceptanceProfileLaunch $directory 'human-timbre-migrate' }
  foreach($phase in @('human-timbre-seed','human-timbre-migrate')) {
    $fresh=$phase -ceq 'human-timbre-seed'
    $proof=[ordered]@{version=1;phase=$phase;process_id=71;profile_directory=$seed.profile_directory;library_directory=$seed.library_directory;fresh_required=$fresh;created_new=$fresh}
    [IO.File]::WriteAllText((Join-Path $directory "profile-$phase.json"),($proof | ConvertTo-Json))
    if($fresh){Assert-Throws { Assert-AcceptanceProfileLaunch $directory 'human-timbre-restart' }}
  }
  foreach($phase in @('human-timbre-migrate','human-timbre-restart')) {
    $selection=Assert-AcceptanceProfileLaunch $directory $phase
    Assert-True ($selection.profile_directory -ceq $seed.profile_directory) 'Profile changed across processes'
    Assert-True ($selection.existing_required -and -not $selection.fresh_required) 'Restart did not require its existing profile'
  }
  $path=Join-Path $directory 'profile-human-timbre-migrate.json'
  $original=[IO.File]::ReadAllText($path)
  foreach($field in @('phase','process_id','profile_directory','library_directory','fresh_required','created_new')) {
    $forged=$original | ConvertFrom-Json -AsHashtable
    $forged[$field]=switch($field){'process_id'{0};'fresh_required'{$true};'created_new'{$true};default{'wrong'}}
    [IO.File]::WriteAllText($path,($forged | ConvertTo-Json))
    Assert-Throws { Assert-AcceptanceProfileLaunch $directory 'human-timbre-restart' }
  }
} finally {Remove-Item -LiteralPath $directory -Force -Recurse}
Write-Output 'Pure human timbre ownership and profile contracts passed; no native input or GUI was used.'
`;
  const checked=spawnSync('pwsh',['-NoLogo','-NoProfile','-Command',script],{cwd:root,encoding:'utf8',timeout:60000});assert.equal(checked.status,0,`${checked.stdout}\n${checked.stderr}`);
});
