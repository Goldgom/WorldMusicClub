# Pure diagnostic bookkeeping and existing JSON publication. No native UI calls.
. (Join-Path $PSScriptRoot '../scripts/windows-action-timing.ps1')
$binding=@{source_sha=('a'*40);source_tree=('b'*40);executable_sha256=('c'*64)}
$timing=New-NativeActionTiming $binding
Start-NativeActionTiming $timing 'canonical-practice-seed' 42 @{sequence=18;kind='click'}
Add-NativeActionTiming $timing 'input-start' ($timing.origin+10) 1000
Add-NativeActionTiming $timing 'input-completed' ($timing.origin+20) 900
Assert-True ($timing.report.events.Count -eq 2 -and $timing.report.events[1].utc_ms -eq 900) 'wall clock changes are retained without changing monotonic ordering'
Assert-True ($timing.report.events[0].phase -ceq 'canonical-practice-seed' -and $timing.report.events[0].process_id -eq 42 -and $timing.report.events[0].sequence -eq 18) 'each checkpoint binds its actual phase process and action'
Assert-True ($timing.report.source_sha -ceq $binding.source_sha -and $timing.report.executable_sha256 -ceq $binding.executable_sha256 -and $timing.report.diagnostic_only) 'source/EXE identity and diagnostic-only status are explicit'
Assert-Rejected {Add-NativeActionTiming $timing 'capture-start' ($timing.origin+19) 1001} 'out-of-order monotonic sample is not silently repaired'
Assert-Rejected {Add-NativeActionTiming $timing 'invented-stage' ($timing.origin+21) 1001} 'checkpoint vocabulary is closed'
$errors=$timing.report.record_errors
Record-NativeActionTiming $timing 'invented-stage'
Assert-True ($timing.report.record_errors -eq $errors+1 -and $timing.report.events.Count -eq 2) 'recording failure is diagnostic and does not throw into the action'
for($i=0;$i -lt 4100;$i++){Add-NativeActionTiming $timing 'capture-start' ($timing.origin+30+$i) 1002}
Assert-True ($timing.report.events.Count -eq 4096 -and $timing.report.omitted_events -eq 6) 'bounded first checkpoints retain explicit omission count'
Assert-True ($timing.report.events[0].elapsed_ticks -eq 10) 'overflow preserves earliest observations'
Start-NativeActionTiming $timing 'canonical-practice-restart' 43 @{sequence=65;kind='click'}
Assert-True ($null -eq $timing.current -and $timing.report.record_errors -eq $errors+2) 'invalid target clears the preceding action association'
foreach($bad in @(@{source_sha='x';source_tree=('b'*40);executable_sha256=('c'*64)},@{source_sha=('a'*40);source_tree=('b'*40);executable_sha256=''})) {Assert-Rejected {New-NativeActionTiming $bad} 'invalid source identities cannot masquerade as diagnostic binding'}

$temporary=Join-Path ([IO.Path]::GetTempPath()) ('wmh action timing '+[guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory $temporary | Out-Null
try {
  $hostSource=Join-Path $PSScriptRoot '../scripts/windows-desktop-acceptance.ps1'
  $tokens=$null;$parseErrors=$null;$ast=[Management.Automation.Language.Parser]::ParseFile($hostSource,[ref]$tokens,[ref]$parseErrors)
  Assert-True ($parseErrors.Count -eq 0) 'actual host script parses with timing calls'
  $save=$ast.Find({param($node) $node -is [Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -ceq 'Save-Json'},$true)
  Invoke-Expression $save.Extent.Text
  $actionTiming=New-NativeActionTiming $binding
  Start-NativeActionTiming $actionTiming 'canonical-practice-seed' 42 @{sequence=18;kind='click'}
  Record-NativeActionTiming $actionTiming 'input-start'
  Assert-True (@(Get-ChildItem -LiteralPath $temporary).Count -eq 0) 'checkpoint recording performs no file I/O'
  $result=@{ok=$false;error='Original action failure'};$path=Join-Path $temporary 'result-canonical-practice-seed-18.json'
  Save-Json $result $path -ObserveResultPublication
  $saved=Get-Content -Raw -LiteralPath $path | ConvertFrom-Json
  Assert-True ($saved.ok -eq $false -and $saved.error -ceq 'Original action failure' -and @($saved.PSObject.Properties).Count -eq 2) 'diagnostics preserve result shape and failure'
  Assert-True (($actionTiming.report.events.stage -join ',') -ceq 'input-start,result-write-start,result-temporary-written,result-rename-start,result-published') 'actual temporary-file and rename operations retain ordered checkpoints'
  Assert-True (-not (Test-Path -LiteralPath "$path.tmp")) 'existing atomic publication completes before success checkpoint'
  Save-NativeActionTiming $actionTiming $temporary
  $diagnostic=Join-Path $temporary 'timing-canonical-practice.json';$bytes=[IO.File]::ReadAllText($diagnostic)
  $actionTiming.report.extra='must not rewrite'
  Save-NativeActionTiming $actionTiming $temporary
  Assert-True ([IO.File]::ReadAllText($diagnostic) -ceq $bytes) 'one cleanup flush cannot overwrite original diagnostics'
  $savedTiming=$bytes | ConvertFrom-Json
  Assert-True ($savedTiming.events.Count -eq 5 -and $savedTiming.version -eq 1 -and $savedTiming.diagnostic_only) 'sidecar is explicitly versioned diagnostic data'
  $actionTiming=New-NativeActionTiming $binding
  Start-NativeActionTiming $actionTiming 'canonical-practice-seed' 42 @{sequence=19;kind='key-c5'}
  Assert-Rejected {Save-Json $result (Join-Path $temporary 'missing/result.json') -ObserveResultPublication} 'original publication error still propagates'
  Assert-True (($actionTiming.report.events.stage -join ',') -ceq 'result-write-start') 'incomplete publication never gets a fabricated completed marker'
} finally {Remove-Item -LiteralPath $temporary -Force -Recurse}
