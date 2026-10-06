import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {Script} from 'node:vm';
const read=name=>readFileSync(new URL(`../${name}`,import.meta.url),'utf8');
const host=read('scripts/windows-desktop-acceptance.ps1'),rust=read('crates/desktop-shell/src/acceptance.rs'),profile=read('scripts/windows-desktop-profile.ps1'),native=read('scripts/windows-desktop-native.cs');

test('skin registration reuses the existing Windows host with fixed three-phase order, fixture generator and independent executable verifier',()=>{
  assert.match(host,/\[ValidateSet\([^\n]*'skin'/);
  assert.match(host,/if\(\$Scenario -eq 'skin'\) \{\s*& node \(Join-Path \$PSScriptRoot 'prepare-native-skin-fixtures.mjs'\) \$Fixtures/);
  assert.match(host,/elseif\(\$Scenario -eq 'skin'\)\{@\('skin-seed','skin-restart','skin-default-restart'\)\}/);
  assert.match(host,/elseif\(\$Scenario -eq 'skin'\)\{'native-skin.json'\}/);
  assert.match(host,/elseif\(\$Scenario -eq 'skin'\)\{'verify-native-skin-evidence.mjs'\}/);
  assert.match(host,/\$env:WMH_SKIN_EXECUTABLE=\$Executable[\s\S]*?& node \(Join-Path \$PSScriptRoot \$verifier\) \$OutputDirectory[\s\S]*?finally \{\$env:WMH_SKIN_EXECUTABLE=\$previousSkinExecutable\}/);
  assert.match(host,/native-skin-source-evidence.mjs/);assert.match(host,/\$native.source_hashes=\$skinBinding.source_hashes/);
  assert.match(host,/\$reportLimit=[^\n]*'skin'[^\n]*\{1MB\}/);
  assert.ok(rust.includes('|| SKIN_PHASES.contains(&run.phase)'), 'Renderer report admission must use the same 1 MiB phase family');
  assert.match(host,/if\(\$Scenario -eq 'skin'\)\{\$item.profile_fresh=\$profileSelection.fresh_required;\$item.profile_reused=\$profileSelection.existing_required\}/);
});
test('optional skin workflow uses only its frozen preview branch or dispatch and excludes owned profiles',()=>{
  const workflow=read('.github/workflows/native-skin.yml');
  assert.match(workflow,/workflow_dispatch:/);assert.match(workflow,/push:\n    branches: \['preview\/native-skin'\]/);assert.doesNotMatch(workflow,/\bpull_request:|continue-on-error|gh release|permissions:\s*contents:\s*write/);
  const yaml=workflow.indexOf('python -m pip install PyYAML==6.0.3'),nodeChecks=workflow.indexOf('node --test tests/native-skin-acceptance.test.js');
  assert.ok(workflow.indexOf('uses: actions/setup-python@')>=0&&workflow.indexOf('uses: actions/setup-python@')<yaml&&yaml<nodeChecks,'Declared YAML validation dependency must be installed before the Node workflow checks');
  assert.equal((workflow.match(/cargo build -p worldmusichub-desktop --release --locked/g)||[]).length,1);
  assert.match(workflow,/windows-desktop-acceptance.ps1 -Executable target\/release\/worldmusichub-desktop.exe[^\n]*-Scenario skin/);
  assert.match(workflow,/WMH_SKIN_EXECUTABLE: \$\{\{ github.workspace \}\}\/target\/release\/worldmusichub-desktop.exe/);
  assert.match(workflow,/verify-native-skin-evidence.mjs --check/);assert.match(workflow,/!\$\{\{ runner.temp \}\}\/native-skin-windows\/webview-profiles\/\*\*/);
  assert.match(workflow,/if: always\(\)/);assert.match(workflow,/git rev-parse HEAD/);assert.match(workflow,/git status --porcelain/);
});
test('skin renderer composition includes existing read-only observers and geometry helpers without starting their runners',()=>{
  assert.match(rust,/pub const SKIN_PHASES: \[&str; 3\] = \["skin-seed", "skin-restart", "skin-default-restart"\]/);
  assert.match(rust,/\.chain\(SKIN_PHASES\)/);assert.match(rust,/if SKIN_PHASES.contains\(&self.phase\) \{\s*&skin/);
  const prefix=rust.slice(rust.indexOf('let skin ='),rust.indexOf('let performance ='));
  for(const name of ['vsq-song-acceptance.js','canonical-practice-acceptance.js','skin-acceptance.js'])assert.ok(prefix.includes(name));
  assert.equal((prefix.match(/\.split_once/g)||[]).length,2);
  const script=[read('crates/desktop-shell/acceptance-wait.js'),read('crates/desktop-shell/reference-acceptance.js'),read('crates/desktop-shell/live-tone-acceptance.js'),read('crates/desktop-shell/vsq-song-acceptance.js').split('(() => {')[0],read('crates/desktop-shell/canonical-practice-acceptance.js').split('(() => {')[0],read('crates/desktop-shell/skin-acceptance.js')].join('\n');
  assert.doesNotThrow(()=>new Script(script));assert.equal((script.match(/report.stage='skin-round'/g)||[]).length,1);
  assert.match(read('crates/desktop-shell/src/windows.rs'),/if worldmusichub_desktop::acceptance::SKIN_PHASES.contains\(&acceptance.phase\) \{\s*builder = builder.inner_size\(1280.0, 720.0\)/);
});
test('skin profile reuse is gated by both exact predecessors and never copies browser storage',()=>{
  assert.match(profile,/if\(\$skinPhase\)\{Join-Path \(Join-Path \$Directory 'webview-profiles'\) 'skin-seed'\}/);
  assert.match(profile,/\(\$skinPhase -and \$Phase -cne 'skin-seed'\)/);
  assert.match(profile,/Assert-CatalogProfilePredecessor \$Directory \$selection 'skin-seed' \$true/);
  assert.match(profile,/if\(\$Phase -ceq 'skin-default-restart'\)\{Assert-CatalogProfilePredecessor \$Directory \$selection 'skin-restart' \$false\}/);
  assert.match(rust,/let skin_restart = SKIN_PHASES.contains\(&self.phase\) && self.phase != "skin-seed"/);
  assert.match(rust,/if skin_restart \{\s*self.require_catalog_profile_evidence\("skin-seed", true\)\?;\s*if self.phase == "skin-default-restart" \{\s*self.require_catalog_profile_evidence\("skin-restart", false\)\?;/);
  assert.doesNotMatch(profile,/Copy-Item|Move-Item|Remove-Item|New-Item/);
  assert.match(read('tests/windows-skin-profile-contract.ps1'),/skin final cannot skip reset predecessor/);
});
test('native skin pickers admit exactly three original filenames in the seed phase',()=>{
  for(const name of ['skin-original-score.json','skin-original.json','checker.png']){assert.ok(rust.includes(`"${name}"`));assert.ok(native.includes(`"${name}"`));assert.ok(host.includes(`'${name}'`));}
  assert.match(rust,/phase == "skin-seed"\s*&& \[\s*"skin-original-score.json",\s*"skin-original.json",\s*"checker.png",?\s*\]\s*.contains\(&file\)/);
  assert.match(host,/if\(\$Scenario -cne 'skin' -or \$env:WMH_DESKTOP_ACCEPTANCE_PHASE -cne 'skin-seed'\)\{throw/);
  assert.match(rust,/SKIN_PHASES.contains\(&phase\)\s*&& !\["click", "picker", "key-r", "select-first", "select-last"\]/);
  assert.match(rust,/fn skin_profiles_and_actions_keep_exact_restart_and_picker_boundaries/);
});
