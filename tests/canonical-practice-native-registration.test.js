import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';

const read=path=>readFileSync(new URL(`../${path}`,import.meta.url),'utf8');
const host=read('scripts/windows-desktop-acceptance.ps1');
const native=read('scripts/windows-desktop-native.cs');
const rust=read('crates/desktop-shell/src/acceptance.rs');
const profile=read('scripts/windows-desktop-profile.ps1');
const phases=['canonical-practice-seed','canonical-practice-controls','canonical-practice-restart'];

test('canonical native registration binds the exact fixture generator, ordered phases, verifier and executable',()=>{
  assert.match(host,/\[ValidateSet\([^\n]*'canonical-practice'/);
  assert.match(host,/if\(\$Scenario -eq 'canonical-practice'\) \{\s*& node \(Join-Path \$PSScriptRoot 'prepare-canonical-practice-fixtures.mjs'\) \$Fixtures/);
  assert.match(host,/elseif\(\$Scenario -eq 'canonical-practice'\)\{@\('canonical-practice-seed','canonical-practice-controls','canonical-practice-restart'\)\}/);
  assert.match(host,/elseif\(\$Scenario -eq 'canonical-practice'\)\{'native-canonical-practice.json'\}/);
  assert.match(host,/elseif\(\$Scenario -eq 'canonical-practice'\)\{'verify-canonical-practice-evidence.mjs'\}/);
  assert.match(host,/\$env:WMH_CANONICAL_PRACTICE_EXECUTABLE=\$Executable[\s\S]*?& node \(Join-Path \$PSScriptRoot \$verifier\) \$OutputDirectory[\s\S]*?finally \{\$env:WMH_CANONICAL_PRACTICE_EXECUTABLE=\$previousCanonicalExecutable\}/);
  assert.match(rust,/\.chain\(CANONICAL_PRACTICE_PHASES\)/);
  assert.match(rust,/if CANONICAL_PRACTICE_PHASES.contains\(&self.phase\) \{\s*include_str!\("\.\.\/canonical-practice-acceptance.js"\)/);
  for(const phase of phases)assert.ok(profile.includes(`'${phase}'`));
  assert.match(host,/\$sequence -gt 64/);
  assert.match(host,/\$reportLimit=[^\n]*'canonical-practice'[^\n]*\{1MB\}/);
});

test('canonical profiles retain one owned cache and require both exact predecessor proofs',()=>{
  assert.match(profile,/elseif\(\$canonicalPhase\)\{Join-Path \(Join-Path \$Directory 'webview-profiles'\) 'canonical-practice-seed'\}/);
  assert.match(profile,/\(\$canonicalPhase -and \$Phase -cne 'canonical-practice-seed'\)/);
  assert.match(profile,/Assert-CatalogProfilePredecessor \$Directory \$selection 'canonical-practice-seed' \$true/);
  assert.match(profile,/if\(\$Phase -ceq 'canonical-practice-restart'\)\{Assert-CatalogProfilePredecessor \$Directory \$selection 'canonical-practice-controls' \$false\}/);
  assert.match(host,/if\(\$Scenario -in @\('complete-practice','canonical-practice'\)\)\{\$item.profile_fresh=\$profileSelection.fresh_required;\$item.profile_reused=\$profileSelection.existing_required\}/);
  assert.doesNotMatch(profile,/Remove-Item|Copy-Item|Move-Item|New-Item/);
  assert.match(host,/-ClientOnly:\(\$Scenario -cin @\('library-catalog','complete-practice','canonical-practice'\)\)/);
  assert.match(read('crates/desktop-shell/src/windows.rs'),/CANONICAL_PRACTICE_PHASES.contains\(\s*&acceptance.phase,?\s*\)[\s\S]*?builder = builder.inner_size\(1280.0, 720.0\)/);
});

test('numeric native actions keep a closed phase/key mapping and an owned click before fixed keystrokes',()=>{
  const keys=native.slice(native.indexOf('public static byte[] CanonicalNumericKeys('),native.indexOf('public static void HeldPerformanceKey('));
  assert.match(keys,/if\(phase!="canonical-practice-controls"\)/);
  for(const [kind,virtualKeys] of [['canonical-range-start','0x32'],['canonical-range-end','0x36'],['canonical-tempo','0x39,0x30']])assert.ok(keys.includes(`case "${kind}": return new byte[]{${virtualKeys}};`));
  assert.equal((keys.match(/case "/g)||[]).length,3);
  assert.match(keys,/default: throw new InvalidOperationException/);
  assert.match(keys,/keybd_event\(0x11,controlScan,0,UIntPtr.Zero\);\s*try \{ Key\(0x41\); \}\s*finally \{ keybd_event\(0x11,controlScan,2,UIntPtr.Zero\); \}\s*foreach\(byte digit in digits\)Key\(digit\);\s*Key\(0x09\);/);
  assert.doesNotMatch(keys,/SendKeys|SendText|SetValue|Clipboard|Process.Start/);
  const action=host.slice(host.indexOf('function Native-Action('),host.indexOf('function Save-SongFolderSnapshot('));
  assert.ok(action.indexOf('::CanonicalNumericKeys(')<action.indexOf('::ClickPositioned()'));
  assert.ok(action.indexOf('::ValidateClientClick(')<action.indexOf('::ClickPositioned()'));
  assert.ok(action.indexOf('::ClickPositioned()')<action.indexOf('::CanonicalNumericEdit('));
  assert.match(action,/if\(\$foreground -ne \$window -or -not \$enabled\)\{throw 'Canonical numeric app foreground ownership was lost'\}/);
  assert.match(action,/method='fixed_ctrl_a_digits_tab';select_all_virtual_keys=@\(0x11,0x41\);digit_virtual_keys=@\(\$canonicalNumericKeys\);commit_virtual_key=0x09;pointer_clicked=\$true;completed=\$false/);
  assert.match(action,/\$Evidence.native_numeric.completed=\$true/);
  assert.match(rust,/if !valid_action_for_phase\(&value, self.phase\)/);
  assert.match(rust,/&& !\(phase == "canonical-practice-controls"/);
});

test('canonical picker names remain exact original fixtures and inputs match actual app controls',()=>{
  for(const name of ['canonical-practice-original.json','canonical-practice-original.musicxml']){
    assert.ok(native.includes(`"${name}"`));
    assert.ok(rust.includes(`"${name}"`));
    assert.ok(host.includes(`'${name}'`));
  }
  const document=read('web/index.html');
  for(const [id,type] of [['loop-from','text'],['loop-to','text'],['tempo','number']]){
    const matches=[...document.matchAll(new RegExp(`<input[^>]*id="${id}"[^>]*>`, 'g'))];
    assert.equal(matches.length,1,`${id} must identify one actual input`);
    assert.ok(matches[0][0].includes(`type="${type}"`));
  }
  const contract=read('tests/windows-desktop-contract.ps1');
  assert.match(contract,/CanonicalNumericKeys/);
  assert.match(contract,/canonical restart cannot skip controls evidence/);
  assert.match(contract,/canonical-practice-original.musicxml/);
});


test('canonical snapshots retain ordinary canonical archives and backups',()=>{
  const snapshot=host.slice(host.indexOf('function Save-SongFolderSnapshot('),host.indexOf('$previousDirectory='));
  const cleanScenarios=snapshot.match(/if\(\$Scenario -in @\(([^\n]+?)\)\)\{@\('clean-songs','clean-backups','imports','import-backups'\)\}/)[1];
  assert.ok(!cleanScenarios.includes("'canonical-practice'"));
  assert.match(snapshot,/elseif\(\$Scenario -eq 'bulk-import'\)\{@\('songs','backups','imports','import-backups'\)\}else\{@\('songs','backups'\)\}/);
});
