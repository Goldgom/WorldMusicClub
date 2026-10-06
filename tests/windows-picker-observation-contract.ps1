# Pure recording/serialization regressions; no window creation or native call.
. (Join-Path $PSScriptRoot '../scripts/windows-picker-observation.ps1')
$binding=@{source_sha=('a'*40);source_tree=('b'*40);executable_sha256=('c'*64)}
$observation=New-PickerObservation 'bulk-seed' 17 $binding
$original=Get-Content -LiteralPath (Join-Path $PSScriptRoot 'fixtures/native-picker/original564.json') -Raw | ConvertFrom-Json
$completion=$original.bulk.result.picker_completion
Assert-True (-not [NativeAcceptance]::PickerDismissed($completion.dialog_exists,$completion.dialog_visible,$completion.owned_popup_visible,$completion.app_foreground,$completion.app_enabled)) 'original 564 visible same-dialog failure remains a failure'
Assert-True ($original.bulk.result.owned_dialog.hwnd -eq $completion.foreground_hwnd) 'original close failure retained its exact foreground dialog'
$state=[ordered]@{dialog=$original.bulk.result.owned_dialog;completion=$completion}
Assert-True (Add-PickerObservation $observation 'dismissal-poll' $state 5033 10000) 'first original close-state sample retained'
for($i=1;$i -le 120;$i++){Assert-True (-not (Add-PickerObservation $observation 'dismissal-poll' $state (5033+$i) (10000+$i))) 'unchanged polls coalesce without removing original state'}
Assert-True ($observation.report.events.Count -eq 1 -and $observation.report.samples -eq 121 -and $observation.report.last_elapsed_ms -eq 5153) 'coalesced observations keep sample count and last time'
$hidden=[ordered]@{dialog_visible=$false;app_enabled=$true}
Assert-True (Add-PickerObservation $observation 'failure-capture-after' $hidden 5200 9000) 'later hidden dialog observed without converting earlier timeout to success; wall clock need not be monotonic'
Assert-True ($observation.report.events[0].elapsed_ms -eq 5033 -and $observation.report.events[1].utc_ms -eq 9000) 'first failure and separate clock values preserved'
Assert-Rejected {Add-PickerObservation $observation 'dismissal-poll' $hidden 5199 9001} 'action monotonic time cannot move backwards'
for($i=0;$i -lt 70;$i++){[void](Add-PickerObservation $observation 'discovery-poll' @{foreground_hwnd=$i} (5300+$i) (10100+$i))}
Assert-True ($observation.report.events.Count -eq 64 -and $observation.report.omitted_transitions -eq 8 -and $observation.report.events[63].state.foreground_hwnd -eq 69) 'bounded first 63 transitions and newest tail with explicit omission count'
Assert-True ($observation.report.events[0].state.completion.elapsed_ms -eq 5033) 'bounded recorder does not discard original timeout'
$observation.report.error=$original.bulk.result.error
Assert-True (Add-PickerObservation $observation 'failed' @{app_enabled=$true} 5500 10300) 'late app recovery remains diagnostic with original error retained'
$temporary=Join-Path ([IO.Path]::GetTempPath()) ('wmh picker observation '+[guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory $temporary | Out-Null
try{
  $previousOutputDirectory=$OutputDirectory;$OutputDirectory=$temporary
  $poll=New-PickerObservation 'seed' 35 $binding;$pollErrors=@{}
  Record-PickerPoll $poll 'discovery-poll' @{sampled=$true;decision=-1;operation_elapsed_ms=10050} 'expired' $pollErrors
  Assert-True ($poll.report.events.Count -eq 1 -and $pollErrors.Count -eq 0) 'late decision stored in bounded memory without native observation'
  $badPollErrors=@{}
  Record-PickerPoll $poll 'discovery-poll' @{sampled=$true} '' $badPollErrors
  Assert-True ($poll.report.events.Count -eq 1 -and $badPollErrors.ContainsKey('picker_observation_error')) 'a missing poll key cannot fall back to JSON serialization'
  Assert-True (@(Get-ChildItem -LiteralPath $temporary).Count -eq 0) 'poll recording does not publish any file'
  Flush-PickerObservation $poll $pollErrors
  Assert-True ((Test-Path -LiteralPath (Join-Path $temporary 'picker-observation-seed-35.json')) -and $pollErrors.Count -eq 0) 'explicit post-decision flush publishes completed memory'
  $OutputDirectory=$previousOutputDirectory
  Save-PickerObservation $observation $temporary
  $path=Join-Path $temporary 'picker-observation-bulk-seed-17.json'
  $saved=Get-Content -LiteralPath $path -Raw | ConvertFrom-Json
  Assert-True ($saved.diagnostic_only -eq $true -and $saved.sequence -eq 17 -and $saved.error -ceq $original.bulk.result.error -and $saved.events.Count -eq 64) 'separate bounded JSON retains failed action identity'
  Assert-True ((Get-Item -LiteralPath $path).Length -lt 128KB -and -not (Test-Path -LiteralPath "$path.tmp")) 'complete bounded file published independently of 4 KiB action result'
  $bytes=[IO.File]::ReadAllText($path)
  $observation.report.extra='x'*131072
  Assert-Rejected {Save-PickerObservation $observation $temporary} 'oversized observation refuses overwrite'
  Assert-True ([IO.File]::ReadAllText($path) -ceq $bytes) 'last valid snapshot survives oversized candidate'
}finally{$OutputDirectory=$previousOutputDirectory;Remove-Item -LiteralPath $temporary -Force -Recurse}
foreach($phase in @('../seed','seed/extra',"seed`n",'')){Assert-Rejected {New-PickerObservation $phase 35 $binding} 'unsafe phase cannot select a path'}
foreach($sequence in @(0,81)){Assert-Rejected {New-PickerObservation 'seed' $sequence $binding} 'out-of-bound action sequence'}

# These call the actual production decision helper with the review counterexamples.
Assert-True ([NativeAcceptance]::PickerPollDecision(9950,10000,$false) -eq 0) 'opening enters at 9.95 seconds while no dialog is ready'
Assert-True ([NativeAcceptance]::PickerPollDecision(10050,10000,$true) -eq -1) 'dialog first seen after a 100ms delayed observation cannot pass at 10.05 seconds'
Assert-True ([NativeAcceptance]::PickerPollDecision(5100,5000,$true) -eq -1) 'first dismissal sample after five seconds cannot pass even when already closed'
foreach($budget in @(5000,10000)){
  Assert-True ([NativeAcceptance]::PickerPollDecision(($budget-1),$budget,$true) -eq 1) 'ready sample strictly within original budget can pass'
  Assert-True ([NativeAcceptance]::PickerPollDecision($budget,$budget,$true) -eq -1) 'exact deadline is expired before success'
  Assert-True ([NativeAcceptance]::PickerPollDecision(($budget+100),$budget,$false) -eq -1) 'late unready sample also fails'
}
Assert-Rejected {[NativeAcceptance]::PickerPollDecision(-1,5000,$true)} 'negative native elapsed time'
Assert-Rejected {[NativeAcceptance]::PickerPollDecision(1,5001,$true)} 'only unchanged opening and dismissal budgets are valid'
Assert-True ($null -eq [NativeAcceptance]::PickerObservationStopReason(255,24)) 'enumeration still within both independent bounds'
Assert-True ([NativeAcceptance]::PickerObservationStopReason(256,0) -ceq 'visit-limit') 'unrelated windows cannot exceed total callback cap'
Assert-True ([NativeAcceptance]::PickerObservationStopReason(1,25) -ceq 'time-limit') 'one delayed callback is explicitly incomplete'
Assert-True ([NativeAcceptance]::PickerObservationStopReason(1,200) -ceq 'time-limit') 'late native callback never reports complete inventory'
