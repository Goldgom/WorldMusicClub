import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = path => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

test('all live PowerShell evidence readers use the shared bounded snapshot protocol', () => {
  const acceptance = read('scripts/windows-desktop-acceptance.ps1');
  const profile = read('scripts/windows-desktop-profile.ps1');
  const smoke = read('scripts/windows-desktop-smoke.ps1');
  for (const text of [acceptance, profile, smoke]) assert.doesNotMatch(text, /Get-Content/);
  assert.match(acceptance, /\. \(Join-Path \$PSScriptRoot 'windows-desktop-profile\.ps1'\)/);
  for (const text of [profile, smoke]) {
    assert.match(text, /\. \(Join-Path \$PSScriptRoot 'windows-desktop-evidence\.ps1'\)/);
  }
  for (const [name, limit] of [['traceFile', '512KB'], ['actionFile', '64KB'], ['reportFile', '\\$reportLimit']]) {
    assert.match(acceptance, new RegExp(`Read-AcceptanceJsonSnapshot -Path \\$${name} -MaximumBytes ${limit} -AllowPending`));
  }
  assert.match(profile, /Read-AcceptanceJsonSnapshot -Path \$path -MaximumBytes 8KB/);
  assert.match(smoke, /Read-AcceptanceJsonSnapshot -Path \$reportFile -MaximumBytes 64KB -AllowPending/);
  const reader = read('scripts/windows-desktop-evidence.ps1');
  assert.doesNotMatch(reader, /\$value -isnot \[pscustomobject\]/);
  assert.match(reader, /\$value\.GetType\(\)\.FullName -cne 'System\.Management\.Automation\.PSCustomObject'/);
});

test('the existing mandatory Windows helper gate executes real simultaneous file-handle contracts', () => {
  const contract = read('tests/windows-desktop-contract.ps1');
  assert.match(contract, /\. \(Join-Path \$PSScriptRoot 'windows-desktop-evidence-contract\.ps1'\)/);
  const workflow = read('.github/workflows/windows-desktop-acceptance.yml');
  const steps = workflow.split(/\n(?=      - )/);
  const gate = steps.find(step => step.includes('run: ./tests/windows-desktop-contract.ps1'));
  assert.ok(gate);
  assert.doesNotMatch(gate, /continue-on-error:|\n        if:/);
  const windows = read('tests/windows-desktop-evidence-contract.ps1');
  for (const evidence of ['trace-performance-seed.json', 'action-performance-seed-1.json', 'renderer-performance-seed.json', 'profile-performance-seed.json', 'renderer-report.json']) {
    assert.ok(windows.includes(`'${evidence}'`));
  }
  assert.doesNotMatch(windows, /Start-Sleep|Start-Process|Stop-Process/);
  assert.doesNotMatch(windows, /\[IO\.File\]::Move/);
  assert.match(windows, /& \$writer \$snapshotRoot \$name \$expected/);
  const driver = read('tests/native-evidence-publish.rs');
  assert.match(driver, /#\[path = "\.\.\/crates\/desktop-shell\/src\/acceptance_publication\.rs"\]/);
  assert.match(driver, /publication::atomic_json\(directory, name, &payload\)/);
  assert.match(read('crates/desktop-shell/src/acceptance.rs'), /pub use crate::acceptance_publication::atomic_json/);
  assert.match(read('crates/desktop-shell/src/acceptance_publication.rs'), /std::fs::rename\(temporary, directory\.join\(name\)\)/);
});

test('sharing repair preserves phase clocks, action ordering, source, profile and normal-close assertions', () => {
  const acceptance = read('scripts/windows-desktop-acceptance.ps1');
  for (const invariant of [
    '$deadline=$phaseStart.AddSeconds(240)', '$reportDeliveryWatch.ElapsedMilliseconds -gt 30000',
    "$_.event.stage -eq 'renderer-report-rejected'", "'renderer-report-failed'",
    "'reply-submitted' -and $_.event.status -ge 400", '$action.sequence -ne $sequence -or $sequence -gt $actionLimit',
    'source_sha=(git rev-parse HEAD)', "source_tree=(git rev-parse 'HEAD^{tree}')",
    'Assert-AcceptanceProfileLaunch $OutputDirectory $phase',
    'Assert-AcceptanceProfileEvidence $OutputDirectory $profileSelection $app.Id',
    '$app.CloseMainWindow() -or -not $app.WaitForExit(10000)', '$app.ExitCode -ne 0',
    "if($report.origin -ne 'https://wmh.localhost')", '$listeners.Count -ne 0',
  ]) assert.ok(acceptance.includes(invariant), invariant);
});
