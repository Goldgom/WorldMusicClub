# Ordinary contract tests: compile the real helper and exercise only pure
# validation/path functions. No window creation, UIA, or native messages run.
$ErrorActionPreference='Stop'
Add-Type -Path (Join-Path $PSScriptRoot '../scripts/windows-desktop-native.cs')
. (Join-Path $PSScriptRoot '../scripts/windows-desktop-profile.ps1')
$script:checks=0
function Assert-True([bool]$Value,[string]$Label) {
  if(-not $Value){throw "Contract failed: $Label"}
  $script:checks++
}
function Assert-Rejected([scriptblock]$Operation,[string]$Label) {
  try { & $Operation } catch { $script:checks++;return }
  throw "Contract unexpectedly accepted: $Label"
}
. (Join-Path $PSScriptRoot 'windows-desktop-evidence-contract.ps1')
. (Join-Path $PSScriptRoot 'windows-desktop-geometry-contract.ps1')
. (Join-Path $PSScriptRoot 'windows-picker-observation-contract.ps1')
. (Join-Path $PSScriptRoot 'windows-passive-capture-contract.ps1')
. (Join-Path $PSScriptRoot 'windows-skin-profile-contract.ps1')
# Exercise the actual lifecycle helper using owned temporary paths, including
# a retained earlier cache with an open handle. No WebView or GUI is launched.
$profileRoot=Join-Path ([IO.Path]::GetTempPath()) ('wmh profile 拼谱 '+[guid]::NewGuid().ToString('N'))
$heldProfile=$null
New-Item -ItemType Directory $profileRoot | Out-Null
try {
  $freshPhases=@('direct-midi-seed','direct-midi-restart','folder-seed','folder-restart','folder-failure','bulk-seed','bulk-restart','bulk-failure','clean-seed','clean-restart','vsq-seed','vsq-restart','performance-seed','performance-controls','performance-restart','pitch-bend-seed','pitch-bend-restart','basic-key-seed','basic-key-restart','authoring-seed','authoring-restart','vsq-authoring-seed','vsq-authoring-restart','live-navigation-settings-keyup','live-navigation-settings-navigation','live-navigation-authoring-keyup','live-navigation-authoring-navigation','build-diagnostics')
  New-Item -ItemType Directory (Join-Path $profileRoot 'Scores') | Out-Null
  $score=Join-Path $profileRoot 'Scores/original.bin';[IO.File]::WriteAllText($score,'native score bytes')
  $profiles=@()
  foreach($phase in $freshPhases) {
    $selection=Assert-AcceptanceProfileLaunch $profileRoot $phase
    $expected=Join-Path (Join-Path $profileRoot 'webview-profiles') $phase
    Assert-True ($selection.profile_directory -ceq $expected -and $selection.profile_absent_before_launch -eq $true -and $selection.fresh_required -eq $true) "exact fresh path for $phase"
    Assert-True (-not (Test-Path -LiteralPath $expected)) 'PowerShell does not create the host-owned profile'
    New-Item -ItemType Directory $expected -Force | Out-Null
    Assert-Rejected { Assert-AcceptanceProfileLaunch $profileRoot $phase } 'even an empty existing profile fails freshness'
    $proof=[ordered]@{version=1;phase=$phase;process_id=42;profile_directory=$expected;library_directory=(Join-Path $profileRoot 'Scores');fresh_required=$true;created_new=$true}
    $proofPath=Join-Path $profileRoot "profile-$phase.json"
    $proof | ConvertTo-Json | Set-Content -LiteralPath $proofPath -Encoding utf8
    Assert-AcceptanceProfileEvidence $profileRoot $selection 42;$script:checks++
    foreach($case in @(@{field='phase';value='other'},@{field='process_id';value=43},@{field='profile_directory';value=(Join-Path $profileRoot 'webview-profile')},@{field='library_directory';value=(Join-Path $expected 'Scores')},@{field='fresh_required';value=$false},@{field='created_new';value=$false})) {
      $original=$proof[$case.field];$proof[$case.field]=$case.value
      $proof | ConvertTo-Json | Set-Content -LiteralPath $proofPath -Encoding utf8
      Assert-Rejected { Assert-AcceptanceProfileEvidence $profileRoot $selection 42 } "host profile evidence $($case.field)"
      $proof[$case.field]=$original
    }
    Remove-Item -LiteralPath $proofPath
    Assert-Rejected { Assert-AcceptanceProfileEvidence $profileRoot $selection 42 } 'missing host creation proof'
    $marker=Join-Path $expected 'retained-cache';[IO.File]::WriteAllText($marker,$phase)
    if($null -eq $heldProfile){$heldProfile=[IO.File]::Open($marker,[IO.FileMode]::Open,[IO.FileAccess]::Read,[IO.FileShare]::None)}
    $profiles+=,$expected
    Assert-True ([IO.File]::ReadAllText($score) -ceq 'native score bytes') 'native Scores bytes stay unchanged'
  }
  Assert-True (@($profiles | Select-Object -Unique).Count -eq $freshPhases.Count) 'every fresh phase selects a distinct cache'
  $heldProfile.Dispose();$heldProfile=$null
  foreach($profile in $profiles){Assert-True ([IO.File]::ReadAllText((Join-Path $profile 'retained-cache')) -ceq (Split-Path $profile -Leaf)) 'prior cache remains in its original directory'}
  foreach($phase in @('seed','restart','close-active','reopen')) {
    $selection=Assert-AcceptanceProfileLaunch $profileRoot $phase
    Assert-True ($selection.profile_directory -ceq (Join-Path $profileRoot 'webview-profile') -and -not $selection.fresh_required) 'desktop phases intentionally share the original path'
    if($phase -eq 'seed'){New-Item -ItemType Directory $selection.profile_directory | Out-Null}
    else{Assert-True (-not $selection.profile_absent_before_launch) 'desktop restart reuses its existing profile'}
  }
  $assistancePhases=@('assistance-seed','assistance-restart','assistance-progression','assistance-off-restart')
  Assert-Rejected { Assert-AcceptanceProfileLaunch $profileRoot $assistancePhases[1] } 'assistance restart requires its exact seed profile'
  $assistanceSeed=Assert-AcceptanceProfileLaunch $profileRoot $assistancePhases[0]
  Assert-True ($assistanceSeed.fresh_required -and -not $assistanceSeed.existing_required -and $assistanceSeed.profile_absent_before_launch) 'assistance seed requires an absent profile'
  New-Item -ItemType Directory $assistanceSeed.profile_directory | Out-Null
  Assert-Rejected { Assert-AcceptanceProfileLaunch $profileRoot $assistancePhases[0] } 'assistance seed cannot reuse an existing profile'
  Assert-Rejected { Assert-AcceptanceProfileLaunch $profileRoot $assistancePhases[1] } 'assistance restart rejects a cache without native seed proof'
  $assistanceMarker=Join-Path $assistanceSeed.profile_directory 'retained-assistance-recipe';[IO.File]::WriteAllText($assistanceMarker,'original source-bound recipe')
  $assistanceProof=[ordered]@{version=1;phase=$assistancePhases[0];process_id=42;profile_directory=$assistanceSeed.profile_directory;library_directory=$assistanceSeed.library_directory;fresh_required=$true;created_new=$true}
  $assistancePath=Join-Path $profileRoot 'profile-assistance-seed.json'
  $assistanceProof | ConvertTo-Json | Set-Content -LiteralPath $assistancePath -Encoding utf8
  $assistanceRestart=Assert-AcceptanceProfileLaunch $profileRoot $assistancePhases[1]
  Assert-True ($assistanceRestart.profile_directory -ceq $assistanceSeed.profile_directory -and $assistanceRestart.existing_required -and -not $assistanceRestart.fresh_required -and -not $assistanceRestart.profile_absent_before_launch) 'assistance restart retains the exact existing seed cache'
  foreach($case in @(@{field='phase';value='canonical-practice-seed'},@{field='process_id';value=0},@{field='profile_directory';value=(Join-Path $profileRoot 'other-profile')},@{field='library_directory';value=(Join-Path $profileRoot 'other-Scores')},@{field='fresh_required';value=$false},@{field='created_new';value=$false})) {
    $old=$assistanceProof[$case.field];$assistanceProof[$case.field]=$case.value
    $assistanceProof | ConvertTo-Json | Set-Content -LiteralPath $assistancePath -Encoding utf8
    Assert-Rejected { Assert-AcceptanceProfileLaunch $profileRoot $assistancePhases[1] } "assistance predecessor must match exact $($case.field)"
    $assistanceProof[$case.field]=$old
  }
  $assistanceProof | ConvertTo-Json | Set-Content -LiteralPath $assistancePath -Encoding utf8
  foreach($index in 2..3) {
    $phase=$assistancePhases[$index]
    Assert-Rejected { Assert-AcceptanceProfileLaunch $profileRoot $phase } 'progression needs every earlier native process profile proof'
    $previous=$assistancePhases[$index-1]
    $proof=[ordered]@{version=1;phase=$previous;process_id=(42+$index);profile_directory=$assistanceSeed.profile_directory;library_directory=$assistanceSeed.library_directory;fresh_required=$false;created_new=$false}
    $proofPath=Join-Path $profileRoot "profile-$previous.json"
    $proof | ConvertTo-Json | Set-Content -LiteralPath $proofPath -Encoding utf8
    $selected=Assert-AcceptanceProfileLaunch $profileRoot $phase
    Assert-True ($selected.profile_directory -ceq $assistanceSeed.profile_directory -and $selected.existing_required -and -not $selected.fresh_required) 'progression and Off restart retain the same original profile'
    $proof.created_new=$true;$proof | ConvertTo-Json | Set-Content -LiteralPath $proofPath -Encoding utf8
    Assert-Rejected { Assert-AcceptanceProfileLaunch $profileRoot $phase } 'an intermediate process cannot claim a newly created profile'
    $proof.created_new=$false;$proof | ConvertTo-Json | Set-Content -LiteralPath $proofPath -Encoding utf8
  }
  Remove-Item -LiteralPath $assistancePath
  foreach($phase in $assistancePhases[1..3]){Assert-Rejected { Assert-AcceptanceProfileLaunch $profileRoot $phase } 'all later phases require the retained original seed proof'}
  Assert-Rejected { Assert-AcceptanceProfileLaunch $profileRoot $assistancePhases[1] } 'assistance restart rejects missing predecessor proof'
  Assert-True ([IO.File]::ReadAllText($assistanceMarker) -ceq 'original source-bound recipe') 'assistance validation preserves existing cache bytes'
  foreach($phase in @('assistance','assistance-controls','ASSISTANCE-SEED',"assistance-seed`n")){Assert-Rejected { Get-AcceptanceProfile $profileRoot $phase } 'only the four exact assistance phases are supported'}
  $pitchModPhases=@('pitch-mod-seed','pitch-mod-restart')
  Assert-Rejected { Assert-AcceptanceProfileLaunch $profileRoot $pitchModPhases[1] } 'pitch restart requires its original profile'
  $pitchModSeed=Assert-AcceptanceProfileLaunch $profileRoot $pitchModPhases[0]
  Assert-True ($pitchModSeed.fresh_required -and -not $pitchModSeed.existing_required) 'pitch seed reserves a fresh profile'
  New-Item -ItemType Directory $pitchModSeed.profile_directory | Out-Null
  Assert-Rejected { Assert-AcceptanceProfileLaunch $profileRoot $pitchModPhases[0] } 'pitch seed cannot reuse the cache'
  Assert-Rejected { Assert-AcceptanceProfileLaunch $profileRoot $pitchModPhases[1] } 'pitch restart requires predecessor evidence'
  $pitchModProof=[ordered]@{version=1;phase=$pitchModPhases[0];process_id=42;profile_directory=$pitchModSeed.profile_directory;library_directory=$pitchModSeed.library_directory;fresh_required=$true;created_new=$true}
  $pitchModPath=Join-Path $profileRoot 'profile-pitch-mod-seed.json'
  $pitchModProof | ConvertTo-Json | Set-Content -LiteralPath $pitchModPath -Encoding utf8
  $pitchModRestart=Assert-AcceptanceProfileLaunch $profileRoot $pitchModPhases[1]
  Assert-True ($pitchModRestart.profile_directory -ceq $pitchModSeed.profile_directory -and $pitchModRestart.existing_required -and -not $pitchModRestart.fresh_required) 'pitch restart retains the saved Mod profile'
  foreach($case in @(@{field='phase';value='assistance-seed'},@{field='process_id';value=0},@{field='profile_directory';value=(Join-Path $profileRoot 'other-profile')},@{field='library_directory';value=(Join-Path $profileRoot 'other-Scores')},@{field='fresh_required';value=$false},@{field='created_new';value=$false})) {
    $old=$pitchModProof[$case.field];$pitchModProof[$case.field]=$case.value
    $pitchModProof | ConvertTo-Json | Set-Content -LiteralPath $pitchModPath -Encoding utf8
    Assert-Rejected { Assert-AcceptanceProfileLaunch $profileRoot $pitchModPhases[1] } "pitch predecessor must match exact $($case.field)"
    $pitchModProof[$case.field]=$old
  }
  Remove-Item -LiteralPath $pitchModPath
  Assert-Rejected { Assert-AcceptanceProfileLaunch $profileRoot $pitchModPhases[1] } 'pitch restart rejects removed predecessor evidence'
  $pitchSourcesPhases=@('pitch-sources-seed','pitch-sources-restart','pitch-sources-zero','pitch-sources-zero-restart')
  foreach($phase in $pitchSourcesPhases[1..3]){Assert-Rejected {Assert-AcceptanceProfileLaunch $profileRoot $phase} 'source pitch restart requires original profile and ordered evidence'}
  $pitchSourcesSeed=Assert-AcceptanceProfileLaunch $profileRoot $pitchSourcesPhases[0]
  Assert-True ($pitchSourcesSeed.fresh_required -and -not $pitchSourcesSeed.existing_required) 'source seed reserves a fresh profile'
  New-Item -ItemType Directory $pitchSourcesSeed.profile_directory | Out-Null
  Assert-Rejected {Assert-AcceptanceProfileLaunch $profileRoot $pitchSourcesPhases[0]} 'source seed cannot reuse its cache'
  foreach($index in 1..3) {
    $phase=$pitchSourcesPhases[$index]
    Assert-Rejected {Assert-AcceptanceProfileLaunch $profileRoot $phase} 'every source phase requires preceding process proof'
    $previous=$pitchSourcesPhases[$index-1]
    $proof=[ordered]@{version=1;phase=$previous;process_id=(72+$index);profile_directory=$pitchSourcesSeed.profile_directory;library_directory=$pitchSourcesSeed.library_directory;fresh_required=($index -eq 1);created_new=($index -eq 1)}
    $proofPath=Join-Path $profileRoot "profile-$previous.json"
    $proof | ConvertTo-Json | Set-Content -LiteralPath $proofPath -Encoding utf8
    $selected=Assert-AcceptanceProfileLaunch $profileRoot $phase
    Assert-True ($selected.profile_directory -ceq $pitchSourcesSeed.profile_directory -and $selected.existing_required -and -not $selected.fresh_required) 'source phases reuse exactly their original profile'
    $old=$proof.profile_directory;$proof.profile_directory=Join-Path $profileRoot 'wrong-source-profile'
    $proof | ConvertTo-Json | Set-Content -LiteralPath $proofPath -Encoding utf8
    Assert-Rejected {Assert-AcceptanceProfileLaunch $profileRoot $phase} 'source predecessor cannot identify another profile'
    $proof.profile_directory=$old;$proof | ConvertTo-Json | Set-Content -LiteralPath $proofPath -Encoding utf8
  }
  Remove-Item -LiteralPath (Join-Path $profileRoot 'profile-pitch-sources-seed.json')
  foreach($phase in $pitchSourcesPhases[1..3]){Assert-Rejected {Assert-AcceptanceProfileLaunch $profileRoot $phase} 'later source phases keep requiring the original seed proof'}
  $completePhases=@('complete-practice-seed','complete-practice-restart')
  Assert-Rejected { Assert-AcceptanceProfileLaunch $profileRoot $completePhases[1] } 'complete restart needs its seed profile'
  $completeSeed=Assert-AcceptanceProfileLaunch $profileRoot $completePhases[0]
  Assert-True $completeSeed.fresh_required 'complete seed reserves a fresh owned cache'
  New-Item -ItemType Directory $completeSeed.profile_directory | Out-Null
  $completeProof=[ordered]@{version=1;phase=$completePhases[0];process_id=42;profile_directory=$completeSeed.profile_directory;library_directory=$completeSeed.library_directory;fresh_required=$true;created_new=$true}
  $completeProof | ConvertTo-Json | Set-Content -Encoding utf8 (Join-Path $profileRoot 'profile-complete-practice-seed.json')
  $completeRestart=Assert-AcceptanceProfileLaunch $profileRoot $completePhases[1]
  Assert-True ($completeRestart.profile_directory -ceq $completeSeed.profile_directory -and $completeRestart.existing_required -and -not $completeRestart.fresh_required -and -not $completeRestart.profile_absent_before_launch) 'complete restart retains its exact seed cache'
  Remove-Item -LiteralPath (Join-Path $profileRoot 'profile-complete-practice-seed.json')
  Assert-Rejected { Assert-AcceptanceProfileLaunch $profileRoot $completePhases[1] } 'complete restart rejects a cache without seed ownership proof'
  $canonicalPhases=@('canonical-practice-seed','canonical-practice-controls','canonical-practice-restart')
  foreach($phase in $canonicalPhases[1..2]){Assert-Rejected { Assert-AcceptanceProfileLaunch $profileRoot $phase } "canonical successor needs its seed profile: $phase"}
  $canonicalSeed=Assert-AcceptanceProfileLaunch $profileRoot $canonicalPhases[0]
  Assert-True ($canonicalSeed.profile_directory -ceq (Join-Path (Join-Path $profileRoot 'webview-profiles') 'canonical-practice-seed') -and $canonicalSeed.fresh_required) 'canonical seed uses its exact fresh owned profile'
  New-Item -ItemType Directory $canonicalSeed.profile_directory | Out-Null
  Assert-Rejected { Assert-AcceptanceProfileLaunch $profileRoot $canonicalPhases[0] } 'canonical seed cannot reuse an existing cache'
  $canonicalMarker=Join-Path $canonicalSeed.profile_directory 'retained-canonical-cache'
  [IO.File]::WriteAllText($canonicalMarker,'preserve preferences')
  $canonicalSeedProof=[ordered]@{version=1;phase=$canonicalPhases[0];process_id=42;profile_directory=$canonicalSeed.profile_directory;library_directory=$canonicalSeed.library_directory;fresh_required=$true;created_new=$true}
  $canonicalSeedPath=Join-Path $profileRoot 'profile-canonical-practice-seed.json'
  $canonicalSeedProof | ConvertTo-Json | Set-Content -Encoding utf8 $canonicalSeedPath
  $canonicalControls=Assert-AcceptanceProfileLaunch $profileRoot $canonicalPhases[1]
  Assert-True ($canonicalControls.profile_directory -ceq $canonicalSeed.profile_directory -and $canonicalControls.existing_required -and -not $canonicalControls.fresh_required -and -not $canonicalControls.profile_absent_before_launch) 'canonical controls reuse the exact seed cache'
  Assert-Rejected { Assert-AcceptanceProfileLaunch $profileRoot $canonicalPhases[2] } 'canonical restart cannot skip controls evidence'
  $canonicalControlsProof=[ordered]@{version=1;phase=$canonicalPhases[1];process_id=43;profile_directory=$canonicalSeed.profile_directory;library_directory=$canonicalSeed.library_directory;fresh_required=$false;created_new=$false}
  $canonicalControlsPath=Join-Path $profileRoot 'profile-canonical-practice-controls.json'
  $canonicalControlsProof | ConvertTo-Json | Set-Content -Encoding utf8 $canonicalControlsPath
  $canonicalRestart=Assert-AcceptanceProfileLaunch $profileRoot $canonicalPhases[2]
  Assert-True ($canonicalRestart.profile_directory -ceq $canonicalSeed.profile_directory -and $canonicalRestart.existing_required -and -not $canonicalRestart.fresh_required -and -not $canonicalRestart.profile_absent_before_launch) 'canonical restart retains its exact seed/controls cache'
  foreach($entry in @(@{proof=$canonicalSeedProof;path=$canonicalSeedPath},@{proof=$canonicalControlsProof;path=$canonicalControlsPath})) {
    foreach($case in @(@{field='phase';value='complete-practice-seed'},@{field='process_id';value=0},@{field='profile_directory';value=(Join-Path $profileRoot 'other-profile')},@{field='library_directory';value=(Join-Path $profileRoot 'other-Scores')},@{field='fresh_required';value=(-not $entry.proof.fresh_required)},@{field='created_new';value=(-not $entry.proof.created_new)})) {
      $old=$entry.proof[$case.field];$entry.proof[$case.field]=$case.value
      $entry.proof | ConvertTo-Json | Set-Content -Encoding utf8 $entry.path
      Assert-Rejected { Assert-AcceptanceProfileLaunch $profileRoot $canonicalPhases[2] } "canonical predecessor must match exact $($case.field)"
      $entry.proof[$case.field]=$old
    }
    Remove-Item -LiteralPath $entry.path
    Assert-Rejected { Assert-AcceptanceProfileLaunch $profileRoot $canonicalPhases[2] } 'canonical restart rejects missing predecessor proof'
    $entry.proof | ConvertTo-Json | Set-Content -Encoding utf8 $entry.path
  }
  Assert-True ([IO.File]::ReadAllText($canonicalMarker) -ceq 'preserve preferences') 'canonical validation leaves cache bytes intact'
  foreach($phase in @('','VSQ-seed','vsq-any','../vsq-seed','vsq-seed/extra','vsq-seed\extra',"vsq-seed`n")){Assert-Rejected { Get-AcceptanceProfile $profileRoot $phase } 'unknown phase cannot select a path'}
  Assert-Rejected { Get-AcceptanceProfile 'relative-root' 'vsq-seed' } 'relative acceptance root'
  $fileRoot=Join-Path $profileRoot 'file-root';[IO.File]::WriteAllText($fileRoot,'not a directory')
  Assert-Rejected { Get-AcceptanceProfile $fileRoot 'vsq-seed' } 'non-directory acceptance root'
} finally {
  if($null -ne $heldProfile){$heldProfile.Dispose()}
  Remove-Item -LiteralPath $profileRoot -Recurse -Force
}
# Closed numeric plans are pure to inspect. Never emit their native keystrokes
# in these contract tests; the measured foreground click belongs to the GUI run.
foreach($phase in @('canonical-practice-controls')) {
  foreach($case in @(@{kind='canonical-range-start';keys=@(0x32)},@{kind='canonical-range-end';keys=@(0x36)},@{kind='canonical-tempo';keys=@(0x39,0x30)})) {
    $keys=[NativeAcceptance]::CanonicalNumericKeys($phase,$case.kind)
    Assert-True (($keys -join ',') -ceq ($case.keys -join ',')) "closed canonical virtual keys: $phase/$($case.kind)"
  }
  foreach($kind in @('canonical-transpose','canonical-range-start2','canonical-tempo90','CANONICAL-TEMPO',"canonical-tempo`n",'click','2','90','')) {
    Assert-Rejected { [NativeAcceptance]::CanonicalNumericKeys($phase,$kind) } "unknown canonical numeric kind: $kind"
  }
}
foreach($phase in @('seed','complete-practice-seed','catalog-seed','canonical-practice-seed','canonical-practice-restart','canonical-practice-any','CANONICAL-PRACTICE-SEED',"canonical-practice-seed`n",'')) {
  foreach($kind in @('canonical-range-start','canonical-range-end','canonical-tempo')) {
    Assert-Rejected { [NativeAcceptance]::CanonicalNumericKeys($phase,$kind) } "numeric edit forbidden outside canonical controls: $phase/$kind"
  }
}
function New-ValidHost {
  $candidate=[NativeFileNameHost]::new()
  $candidate.Window=[IntPtr]102;$candidate.AutomationProcess=42;$candidate.NativeProcess=42
  $candidate.AutomationId='1148';$candidate.AutomationClass='ComboBoxEx32';$candidate.NativeClass='ComboBoxEx32';$candidate.NativeControlId=1148
  $candidate.AutomationEnabled=$true;$candidate.InDialog=$true;$candidate.Enabled=$true;$candidate.Visible=$true
  return $candidate
}
$validHost=New-ValidHost
# Reproduce three descendant ID matches without assuming the two unrecorded
# classes from the hosted failure. These fixtures exercise class/handle scope.
$nestedCombo=New-ValidHost;$nestedCombo.Window=[IntPtr]103;$nestedCombo.AutomationClass='ComboBox';$nestedCombo.NativeClass='ComboBox'
$nestedEdit=New-ValidHost;$nestedEdit.Window=[IntPtr]104;$nestedEdit.AutomationClass='Edit';$nestedEdit.NativeClass='Edit'
Assert-True ([NativeAcceptance]::SelectFileNameHost([NativeFileNameHost[]]@($validHost,$nestedCombo,$nestedEdit),42) -eq [IntPtr]102) 'duplicate IDs with host first'
Assert-True ([NativeAcceptance]::SelectFileNameHost([NativeFileNameHost[]]@($nestedCombo,$validHost,$nestedEdit),42) -eq [IntPtr]102) 'duplicate IDs with host in middle'
Assert-True ([NativeAcceptance]::SelectFileNameHost([NativeFileNameHost[]]@($nestedEdit,$nestedCombo,$validHost),42) -eq [IntPtr]102) 'duplicate IDs with host last'
Assert-True ([NativeAcceptance]::SelectFileNameHost([NativeFileNameHost[]]@($validHost,(New-ValidHost)),42) -eq [IntPtr]102) 'repeated UIA references to the same verified HWND'
$otherHost=New-ValidHost;$otherHost.Window=[IntPtr]105
Assert-Rejected { [NativeAcceptance]::SelectFileNameHost([NativeFileNameHost[]]@($validHost,$otherHost),42) } 'two distinct verified hosts'
Assert-Rejected { [NativeAcceptance]::SelectFileNameHost([NativeFileNameHost[]]@($otherHost,$validHost),42) } 'two distinct verified hosts in reverse order'
Assert-Rejected { [NativeAcceptance]::SelectFileNameHost([NativeFileNameHost[]]@($nestedCombo,$nestedEdit),42) } 'only nonhost duplicate IDs'
Assert-Rejected { [NativeAcceptance]::SelectFileNameHost($null,42) } 'missing host inventory'
Assert-Rejected { [NativeAcceptance]::SelectFileNameHost([NativeFileNameHost[]]@(),42) } 'empty host inventory'
Assert-Rejected { [NativeAcceptance]::SelectFileNameHost([NativeFileNameHost[]]@($null),42) } 'null host candidate'
Assert-Rejected { [NativeAcceptance]::SelectFileNameHost([NativeFileNameHost[]](@($validHost)*9),42) } 'host inventory exceeds bound even with one HWND'
Assert-Rejected { [NativeAcceptance]::SelectFileNameHost([NativeFileNameHost[]]@($validHost),0) } 'missing app process for host selection'
$hostCases=@(
  @{field='Window';value=[IntPtr]::Zero},@{field='AutomationId';value='1001'},
  @{field='AutomationClass';value='ComboBox'},@{field='NativeClass';value='ComboBox'},
  @{field='NativeControlId';value=1001},@{field='AutomationProcess';value=[uint32]43},
  @{field='NativeProcess';value=[uint32]43},@{field='AutomationEnabled';value=$false},
  @{field='InDialog';value=$false},@{field='Enabled';value=$false},
  @{field='Visible';value=$false}
)
foreach($case in $hostCases) {
  $candidate=New-ValidHost;$candidate.($case.field)=$case.value
  Assert-Rejected { [NativeAcceptance]::SelectFileNameHost([NativeFileNameHost[]]@($candidate),42) } "host identity $($case.field)"
}
function New-ValidOpenButton {
  $button=[NativePickerButton]::new()
  $button.Window=[IntPtr]104;$button.AutomationId='1';$button.IsButton=$true
  $button.AutomationProcess=42;$button.NativeProcess=42;$button.NativeClass='Button';$button.NativeControlId=1
  $button.AutomationEnabled=$true;$button.InDialog=$true;$button.Enabled=$true;$button.Visible=$true
  return $button
}
$openButton=New-ValidOpenButton;$otherControl=New-ValidOpenButton;$otherControl.Window=[IntPtr]105;$otherControl.IsButton=$false;$otherControl.NativeClass='Static'
Assert-True ([NativeAcceptance]::SelectPickerOpenButton([NativePickerButton[]]@($otherControl,$openButton),42) -eq [IntPtr]104) 'Open resolves by complete identity rather than first ID match'
Assert-True ([NativeAcceptance]::SelectPickerOpenButton([NativePickerButton[]]@($openButton,(New-ValidOpenButton)),42) -eq [IntPtr]104) 'Open duplicate UIA references to one native button'
$secondOpen=New-ValidOpenButton;$secondOpen.Window=[IntPtr]106
Assert-Rejected { [NativeAcceptance]::SelectPickerOpenButton([NativePickerButton[]]@($openButton,$secondOpen),42) } 'two verified Open buttons'
Assert-Rejected { [NativeAcceptance]::SelectPickerOpenButton([NativePickerButton[]](@($openButton)*9),42) } 'oversized Open inventory'
Assert-Rejected { [NativeAcceptance]::SelectPickerOpenButton([NativePickerButton[]]@(),42) } 'missing Open button'
# Hosted source 165 observed a virtual ID 1 and a fully verified native Button;
# both had IsButton=false. Its exact UIA type was not recorded, so do not guess.
$observedOpen=New-ValidOpenButton;$observedOpen.Window=[IntPtr]66092;$observedOpen.AutomationProcess=7284;$observedOpen.NativeProcess=7284;$observedOpen.IsButton=$false
$virtualOpen=New-ValidOpenButton;$virtualOpen.Window=[IntPtr]::Zero;$virtualOpen.AutomationProcess=7284;$virtualOpen.NativeProcess=0;$virtualOpen.NativeClass='';$virtualOpen.NativeControlId=0
$virtualOpen.IsButton=$false;$virtualOpen.Enabled=$false;$virtualOpen.Visible=$false;$virtualOpen.InDialog=$false
Assert-True ([NativeAcceptance]::SelectPickerOpenButton([NativePickerButton[]]@($virtualOpen,$observedOpen),7284) -eq [IntPtr]66092) 'observed non-Button UIA type with exact native Open identity'
Assert-True ([NativeAcceptance]::SelectPickerOpenButton([NativePickerButton[]]@($observedOpen,$virtualOpen),7284) -eq [IntPtr]66092) 'observed native Open identity is independent of candidate order'
Assert-Rejected { [NativeAcceptance]::SelectPickerOpenButton([NativePickerButton[]]@($virtualOpen),7284) } 'virtual ID 1 cannot replace the native Open button'
$ambiguousOpen=New-ValidOpenButton;$ambiguousOpen.Window=[IntPtr]66094;$ambiguousOpen.AutomationProcess=7284;$ambiguousOpen.NativeProcess=7284;$ambiguousOpen.IsButton=$false
Assert-Rejected { [NativeAcceptance]::SelectPickerOpenButton([NativePickerButton[]]@($observedOpen,$ambiguousOpen),7284) } 'two native Open buttons remain ambiguous with non-Button UIA types'
foreach($case in @(
  @{field='Window';value=[IntPtr]::Zero},@{field='AutomationId';value='2'},
  @{field='AutomationProcess';value=[uint32]43},@{field='NativeProcess';value=[uint32]43},
  @{field='NativeClass';value='Static'},@{field='NativeControlId';value=2},
  @{field='AutomationEnabled';value=$false},@{field='InDialog';value=$false},
  @{field='Enabled';value=$false},@{field='Visible';value=$false}
)) {
  $button=New-ValidOpenButton;$button.($case.field)=$case.value
  Assert-Rejected { [NativeAcceptance]::SelectPickerOpenButton([NativePickerButton[]]@($button),42) } "Open identity $($case.field)"
}
# Cancellation must resolve the actual ready native ID 2 button, not merely a
# newly allocated foreground dialog or an Open control with the same label.
$cancel=New-ValidOpenButton;$cancel.Window=[IntPtr]202;$cancel.AutomationId='2';$cancel.NativeControlId=2
Assert-True ([NativeAcceptance]::SelectPickerActionButton([NativePickerButton[]]@($openButton,$cancel),42,2) -eq [IntPtr]202) 'Cancel resolves independently of Open'
Assert-Rejected { [NativeAcceptance]::SelectPickerActionButton([NativePickerButton[]]@($openButton),42,2) } 'Open is not Cancel'
$unshown=New-ValidOpenButton;$unshown.AutomationId='2';$unshown.NativeControlId=2;$unshown.Visible=$false
Assert-Rejected { [NativeAcceptance]::SelectPickerActionButton([NativePickerButton[]]@($unshown),42,2) } 'allocated but unshown Cancel is not ready'
$disabled=New-ValidOpenButton;$disabled.AutomationId='2';$disabled.NativeControlId=2;$disabled.Enabled=$false
Assert-Rejected { [NativeAcceptance]::SelectPickerActionButton([NativePickerButton[]]@($disabled),42,2) } 'disabled Cancel is not ready'
$secondCancel=New-ValidOpenButton;$secondCancel.Window=[IntPtr]203;$secondCancel.AutomationId='2';$secondCancel.NativeControlId=2
Assert-Rejected { [NativeAcceptance]::SelectPickerActionButton([NativePickerButton[]]@($cancel,$secondCancel),42,2) } 'ambiguous Cancel is not clicked'
Assert-Rejected { [NativeAcceptance]::SelectPickerActionButton([NativePickerButton[]]@($cancel),42,3) } 'unsupported native action ID'
function New-Rectangle([int]$Left,[int]$Top,[int]$Right,[int]$Bottom) {
  $bounds=[NativeAcceptance+RECT]::new();$bounds.Left=$Left;$bounds.Top=$Top;$bounds.Right=$Right;$bounds.Bottom=$Bottom;return $bounds
}
# Screen mapping is a separate boundary from OS mouse dispatch. A clipped
# pointer can hit the taskbar while the app still renders a valid PrintWindow.
$client=New-Rectangle 0 0 1000 700
$origin=[NativeAcceptance+POINT]::new();$origin.X=20;$origin.Y=31
$mapped=[NativeAcceptance]::ClientClickPoint($client,$origin,147.5,650.5,1000,700)
Assert-True ($mapped.X -eq 167 -and $mapped.Y -eq 681) 'viewport point maps to visible screen coordinates'
$work=New-Rectangle 0 0 1024 728
[NativeAcceptance]::ValidateClientClick($work,$mapped,$mapped,[IntPtr]100,[IntPtr]100,$true);$script:checks++
$offscreen=[NativeAcceptance+POINT]::new();$offscreen.X=167;$offscreen.Y=780
Assert-Rejected { [NativeAcceptance]::ValidateClientClick($work,$offscreen,$offscreen,[IntPtr]100,[IntPtr]100,$true) } 'rendered window bottom outside work area is not clickable'
$clipped=[NativeAcceptance+POINT]::new();$clipped.X=$mapped.X;$clipped.Y=680
Assert-Rejected { [NativeAcceptance]::ValidateClientClick($work,$mapped,$clipped,[IntPtr]100,[IntPtr]100,$true) } 'SetCursorPos success with different readback is rejected'
Assert-Rejected { [NativeAcceptance]::ValidateClientClick($work,$mapped,$mapped,[IntPtr]100,[IntPtr]100,$false) } 'taskbar or other app at target is rejected'
Assert-Rejected { [NativeAcceptance]::ValidateClientClick($work,$mapped,$mapped,[IntPtr]100,[IntPtr]999,$true) } 'focus ownership changed before click'
Assert-Rejected { [NativeAcceptance]::ClientClickPoint($client,$origin,1000,5,1000,700) } 'right viewport boundary is excluded'
Assert-Rejected { [NativeAcceptance]::ClientClickPoint($client,$origin,5,700,1000,700) } 'bottom viewport boundary is excluded'
Assert-Rejected { [NativeAcceptance]::ClientClickPoint($client,$origin,-1,5,1000,700) } 'negative viewport target'
Assert-Rejected { [NativeAcceptance]::ClientClickPoint($client,$origin,5,5,0,700) } 'zero viewport extent'
Assert-Rejected { [NativeAcceptance]::ClientClickPoint($client,$origin,[double]::NaN,5,1000,700) } 'nonfinite viewport target'
$negativeOrigin=[NativeAcceptance+POINT]::new();$negativeOrigin.X=-1920;$negativeOrigin.Y=-200
$negative=[NativeAcceptance]::ClientClickPoint($client,$negativeOrigin,999.9,699.9,1000,700)
Assert-True ($negative.X -eq -921 -and $negative.Y -eq 499) 'secondary monitor and fractional point remain inside client'
[NativeAcceptance]::ValidateClientClick((New-Rectangle -1920 -200 0 880),$negative,$negative,[IntPtr]100,[IntPtr]100,$true);$script:checks++
$dialogBounds=New-Rectangle 100 100 800 600;$buttonBounds=New-Rectangle 610 520 700 560
$point=[NativeAcceptance]::PickerClickPoint($dialogBounds,$buttonBounds)
Assert-True ($point.X -eq 655 -and $point.Y -eq 540) 'Open native screen center'
$negativePoint=[NativeAcceptance]::PickerClickPoint((New-Rectangle -10 -10 10 10),(New-Rectangle -3 -3 -2 -2))
Assert-True ($negativePoint.X -eq -3 -and $negativePoint.Y -eq -3) 'negative monitor coordinates stay inside one-pixel bounds'
foreach($bounds in @((New-Rectangle 610 520 610 560),(New-Rectangle 610 520 700 520),(New-Rectangle 99 520 700 560),(New-Rectangle 610 99 700 560),(New-Rectangle 610 520 801 560),(New-Rectangle 610 520 700 601))) {
  Assert-Rejected { [NativeAcceptance]::PickerClickPoint($dialogBounds,$bounds) } 'empty or escaped Open bounds'
}
[NativeAcceptance]::ValidatePickerClick([IntPtr]101,[IntPtr]100,[IntPtr]100,[IntPtr]101,42,42,$true);$script:checks++
Assert-Rejected { [NativeAcceptance]::ValidatePickerClick([IntPtr]::Zero,[IntPtr]100,[IntPtr]100,[IntPtr]101,42,42,$true) } 'missing click dialog'
Assert-Rejected { [NativeAcceptance]::ValidatePickerClick([IntPtr]101,[IntPtr]100,[IntPtr]999,[IntPtr]101,42,42,$true) } 'foreign click owner'
Assert-Rejected { [NativeAcceptance]::ValidatePickerClick([IntPtr]101,[IntPtr]100,[IntPtr]100,[IntPtr]999,42,42,$true) } 'another foreground window'
Assert-Rejected { [NativeAcceptance]::ValidatePickerClick([IntPtr]101,[IntPtr]100,[IntPtr]100,[IntPtr]101,42,43,$true) } 'foreign dialog process'
Assert-Rejected { [NativeAcceptance]::ValidatePickerClick([IntPtr]101,[IntPtr]100,[IntPtr]100,[IntPtr]101,42,42,$false) } 'Open point obscured by another control'
Assert-True (-not [NativeAcceptance]::PickerDismissed($true,$true,$false,$true,$true)) 'Invoke or click return does not dismiss a visible chooser'
Assert-True (-not [NativeAcceptance]::PickerDismissed($false,$false,$true,$true,$true)) 'replacement owned popup is not completion'
Assert-True ([NativeAcceptance]::PickerDismissed($false,$false,$false,$true,$true)) 'destroyed chooser with no replacement modal'
Assert-True ([NativeAcceptance]::PickerDismissed($true,$false,$false,$true,$true)) 'hidden chooser with no replacement modal'
Assert-True (-not [NativeAcceptance]::PickerDismissed($true,$false,$false,$false,$true)) 'hidden chooser retaining foreground is not completion'
Assert-True (-not [NativeAcceptance]::PickerDismissed($false,$false,$false,$true,$false)) 'disabled app owner is not ready after chooser hides'
function New-ValidTarget {
  $target=[NativeFileNameTarget]::new()
  $target.Dialog=[IntPtr]101;$target.AppWindow=[IntPtr]100;$target.RootOwner=[IntPtr]100
  $target.Host=[IntPtr]102;$target.Edit=[IntPtr]103
  $target.AppProcess=42;$target.DialogProcess=42;$target.HostProcess=42;$target.EditProcess=42
  $target.HostControlId=1148;$target.HostClass='ComboBoxEx32';$target.EditClass='Edit'
  $target.HostInDialog=$true;$target.EditInHost=$true;$target.HostEnabled=$true
  $target.EditEnabled=$true;$target.EditVisible=$true;$target.EditReadOnly=$false
  return $target
}
[NativeAcceptance]::ValidateFileNameTarget((New-ValidTarget));$script:checks++
Assert-Rejected { [NativeAcceptance]::ValidateFileNameTarget($null) } 'missing target'
$cases=@(
  @{field='Dialog';value=[IntPtr]::Zero},@{field='AppWindow';value=[IntPtr]::Zero},
  @{field='Host';value=[IntPtr]::Zero},@{field='Edit';value=[IntPtr]::Zero},
  @{field='Edit';value=[IntPtr]102},@{field='RootOwner';value=[IntPtr]999},
  @{field='AppProcess';value=[uint32]0},@{field='DialogProcess';value=[uint32]43},
  @{field='HostProcess';value=[uint32]43},@{field='EditProcess';value=[uint32]43},
  @{field='HostControlId';value=1001},@{field='HostClass';value='ComboBox'},
  @{field='EditClass';value='SearchBox'},@{field='HostInDialog';value=$false},
  @{field='EditInHost';value=$false},@{field='HostEnabled';value=$false},
  @{field='EditEnabled';value=$false},@{field='EditVisible';value=$false},
  @{field='EditReadOnly';value=$true}
)
foreach($case in $cases) {
  $target=New-ValidTarget;$target.($case.field)=$case.value
  Assert-Rejected { [NativeAcceptance]::ValidateFileNameTarget($target) } $case.field
}
$temporary=Join-Path ([System.IO.Path]::GetTempPath()) ('wmh picker 拼谱 '+[guid]::NewGuid().ToString('N'))
try {
  $fixtures=Join-Path $temporary 'fixtures';$downloads=Join-Path $temporary 'downloads'
  New-Item -ItemType Directory $fixtures,$downloads | Out-Null
  $fixed=@('original-duet.musicxml','original-duet.mxl','midi-original-ppq.mid','original-reference-overlap.mid','jianpu-original-steps.jianpu','malformed.json','folder-original.json','folder-conflict.json','原创曲包_日本語.zip','bulk-conflict.zip','bulk-backup.json','bulk-failure.zip','bulk-malformed.zip','bulk-standard-a.json','bulk-standard-b.json','clean-authored-song.zip','vsq-authored-song.zip','performance-authored-songs.zip','pitch-bend-authored-songs.zip','authoring-original-strict.mid','authoring-original-events.mid','authoring-original-blocked.mid','authoring-original.vsq','complete-practice-original.zip','canonical-practice-original.json','canonical-practice-original.musicxml','basic-key-original.zip','basic-key-invalid-profile.zip','basic-key-forged-coverage.zip','catalog-original-legacy.zip','catalog-original-shared.zip','catalog-original-clean.zip','live-tone-navigation-original.json','human-mod-timbre-original.json','skin-original-score.json','skin-original.json','checker.png')
  foreach($name in $fixed) {
    $expected=Join-Path $fixtures $name;[System.IO.File]::WriteAllText($expected,'fixture')
    Assert-True ([NativeAcceptance]::ResolveFixturePath($fixtures,$temporary,$name) -ceq $expected) "fixed path $name"
  }
  $multiple=[NativeAcceptance]::ResolveFixturePath($fixtures,$temporary,'bulk-multiple')
  Assert-True ($multiple -ceq ('"'+(Join-Path $fixtures 'bulk-standard-a.json')+'" "'+(Join-Path $fixtures 'bulk-standard-b.json')+'"')) 'Finite native multi-file selection'
  foreach($phase in @('bulk-seed','bulk-restart','bulk-failure','clean-seed','clean-restart','vsq-seed','vsq-restart')) {
    foreach($sequence in 1..16) {
      $name="$phase-$sequence.zip";$expected=Join-Path $downloads $name;[System.IO.File]::WriteAllText($expected,'authored ZIP fixture')
      Assert-True ([NativeAcceptance]::ResolveFixturePath($fixtures,$temporary,$name) -ceq $expected) "bulk download $name"
    }
  }
  $authoringPair=[NativeAcceptance]::ResolveFixturePath($fixtures,$temporary,'authoring-original-pair')
  $expectedPair='"'+(Join-Path $fixtures 'authoring-original-strict.mid')+'" "'+(Join-Path $fixtures 'authoring-original-events.mid')+'"'
  Assert-True ($authoringPair -ceq $expectedPair) 'authoring pair resolves exactly strict then events, without blocked or arbitrary files'
  foreach($phase in @('authoring-seed','authoring-restart','vsq-authoring-seed','vsq-authoring-restart','basic-key-seed','basic-key-restart')) {
    foreach($sequence in 1..16) {
      foreach($extension in @('zip','json')) {
        $name="$phase-$sequence.$extension";$expected=Join-Path $downloads $name
        [System.IO.File]::WriteAllText($expected,'original authoring download fixture')
        Assert-True ([NativeAcceptance]::ResolveFixturePath($fixtures,$temporary,$name) -ceq $expected) "authoring download $name"
      }
    }
    foreach($suffix in @('0.zip','17.zip','01.zip','001.json','+1.zip','-1.zip','1.ZIP','1.mid','1.zip.extra',"1.zip`n")) {
      Assert-Rejected { [NativeAcceptance]::ResolveFixturePath($fixtures,$temporary,"$phase-$suffix") } "noncanonical authoring download $phase-$suffix"
    }
  }
  foreach($name in @('authoring','authoring-pair','authoring-multiple','authoring-original','authoring-original-pair.extra','authoring-original-pair.mid','authoring-original-blocked-pair','authoring-any-1.zip','authoring-seed-extra-1.zip','authoring-restart-extra-1.json','Authoring-seed-1.zip','authoring-seed-1.zip/','authoring-restart-1.json/')) {
    Assert-Rejected { [NativeAcceptance]::ResolveFixturePath($fixtures,$temporary,$name) } "unapproved authoring alias $name"
  }
  foreach($name in @('authoring-original-pair','authoring-original-strict.mid','authoring-original-events.mid','authoring-original-blocked.mid','complete-practice-original.zip','canonical-practice-original.json','canonical-practice-original.musicxml','basic-key-original.zip','basic-key-invalid-profile.zip','basic-key-forged-coverage.zip')) {
    foreach($invalid in @("../$name","..\$name","fixtures/$name","fixtures\$name",($name+'.extra'),($name+"`n"),($name+"`0"),$name.ToUpperInvariant(),(Join-Path $fixtures $name))) {
      Assert-Rejected { [NativeAcceptance]::ResolveFixturePath($fixtures,$temporary,$invalid) } "unapproved authoring path $invalid"
    }
  }
  $linkTarget=Join-Path $temporary 'original-link-target.mid'
  [System.IO.File]::WriteAllText($linkTarget,'original reparse contract fixture')
  foreach($name in @('authoring-original-strict.mid','authoring-original-events.mid','authoring-original-blocked.mid','complete-practice-original.zip','canonical-practice-original.json','canonical-practice-original.musicxml','basic-key-original.zip','basic-key-invalid-profile.zip','basic-key-forged-coverage.zip')) {
    $path=Join-Path $fixtures $name
    [System.IO.File]::WriteAllText((Join-Path $downloads $name),'outside the fixture root')
    Assert-True ([NativeAcceptance]::ResolveFixturePath($fixtures,$temporary,$name) -ceq $path) "authoring fixture remains rooted $name"
    [System.IO.File]::Delete($path)
    Assert-Rejected { [NativeAcceptance]::ResolveFixturePath($fixtures,$temporary,$name) } "missing authoring file cannot fall back to downloads $name"
    if($name -cin @('authoring-original-strict.mid','authoring-original-events.mid')) {
      Assert-Rejected { [NativeAcceptance]::ResolveFixturePath($fixtures,$temporary,'authoring-original-pair') } "pair requires both original regular files: missing $name"
    }
    else {
      Assert-True ([NativeAcceptance]::ResolveFixturePath($fixtures,$temporary,'authoring-original-pair') -ceq $expectedPair) "unrelated fixture does not alter the exact authoring pair: $name"
    }
    New-Item -ItemType Directory $path | Out-Null
    Assert-Rejected { [NativeAcceptance]::ResolveFixturePath($fixtures,$temporary,$name) } "directory cannot replace authoring file $name"
    if($name -cin @('authoring-original-strict.mid','authoring-original-events.mid')) {
      Assert-Rejected { [NativeAcceptance]::ResolveFixturePath($fixtures,$temporary,'authoring-original-pair') } "pair rejects directory $name"
    }
    else {
      Assert-True ([NativeAcceptance]::ResolveFixturePath($fixtures,$temporary,'authoring-original-pair') -ceq $expectedPair) "unrelated fixture does not alter the exact authoring pair: $name"
    }
    [System.IO.Directory]::Delete($path)
    New-Item -ItemType SymbolicLink -Path $path -Target $linkTarget | Out-Null
    Assert-True (((Get-Item -LiteralPath $path).Attributes -band [System.IO.FileAttributes]::ReparsePoint) -ne 0) "contract creates actual reparse file $name"
    Assert-Rejected { [NativeAcceptance]::ResolveFixturePath($fixtures,$temporary,$name) } "reparse point cannot replace authoring file $name"
    if($name -cin @('authoring-original-strict.mid','authoring-original-events.mid')) {
      Assert-Rejected { [NativeAcceptance]::ResolveFixturePath($fixtures,$temporary,'authoring-original-pair') } "pair rejects reparse file $name"
    }
    else {
      Assert-True ([NativeAcceptance]::ResolveFixturePath($fixtures,$temporary,'authoring-original-pair') -ceq $expectedPair) "unrelated fixture does not alter the exact authoring pair: $name"
    }
    [System.IO.File]::Delete($path)
    [System.IO.File]::WriteAllText($path,'original restored fixture')
  }
  Assert-True ([NativeAcceptance]::ResolveFixturePath($fixtures,$temporary,'authoring-original-pair') -ceq $expectedPair) 'authoring pair recovers only when both exact regular files exist'
  # The VSQ authoring scenario has one exact original file and no new alias.
  foreach($name in @('authoring-original.vsq')) {
    foreach($invalid in @("../$name","..\$name","fixtures/$name","fixtures\$name",($name+'.extra'),($name+"`n"),($name+"`0"),$name.ToUpperInvariant(),(Join-Path $fixtures $name),'authoring-original-vsq-pair','vsq-authoring-original.vsq')) {
      Assert-Rejected { [NativeAcceptance]::ResolveFixturePath($fixtures,$temporary,$invalid) } "unapproved VSQ authoring path $invalid"
    }
    $path=Join-Path $fixtures $name
    [System.IO.File]::WriteAllText((Join-Path $downloads $name),'outside the fixture root')
    Assert-True ([NativeAcceptance]::ResolveFixturePath($fixtures,$temporary,$name) -ceq $path) 'VSQ authoring fixture remains rooted'
    [System.IO.File]::Delete($path)
    Assert-Rejected { [NativeAcceptance]::ResolveFixturePath($fixtures,$temporary,$name) } 'missing VSQ authoring file cannot fall back to downloads'
    New-Item -ItemType Directory $path | Out-Null
    Assert-Rejected { [NativeAcceptance]::ResolveFixturePath($fixtures,$temporary,$name) } 'directory cannot replace VSQ authoring file'
    [System.IO.Directory]::Delete($path)
    New-Item -ItemType SymbolicLink -Path $path -Target $linkTarget | Out-Null
    Assert-True (((Get-Item -LiteralPath $path).Attributes -band [System.IO.FileAttributes]::ReparsePoint) -ne 0) 'contract creates actual VSQ authoring reparse file'
    Assert-Rejected { [NativeAcceptance]::ResolveFixturePath($fixtures,$temporary,$name) } 'reparse point cannot replace VSQ authoring file'
    [System.IO.File]::Delete($path)
    [System.IO.File]::WriteAllText($path,'original restored VSQ fixture')
  }
  foreach($name in @('vsq-authoring-any-1.zip','vsq-authoring-seed-extra-1.zip','vsq-authoring-restart-extra-1.json','Vsq-authoring-seed-1.zip','vsq-authoring-seed-1.zip/','vsq-authoring-restart-1.json/')) {
    Assert-Rejected { [NativeAcceptance]::ResolveFixturePath($fixtures,$temporary,$name) } "unapproved VSQ authoring download $name"
  }
  foreach($phase in @('seed','restart','close-active','reopen')) {
    foreach($sequence in 1..16) {
      $name="$phase-$sequence.json";$expected=Join-Path $downloads $name
      [System.IO.File]::WriteAllText($expected,'{}')
      Assert-True ([NativeAcceptance]::ResolveFixturePath($fixtures,$temporary,$name) -ceq $expected) "download path $name"
    }
  }
  foreach($name in @('vsq-seed-17.zip','vsq-restart-0.zip','../vsq-authored-song.zip','clean-seed-17.zip','clean-restart-0.zip','clean-any-1.zip','../clean-authored-song.zip','bulk-seed-17.zip','bulk-restart-0.zip','bulk-any-1.zip','../bulk-conflict.zip','bulk-multiple.extra','bulk-standard-a.json.extra','../folder-original.json','folder-original.json.extra','folder-restart-1.json','../original-duet.mxl','../original-reference-overlap.mid','original-reference-overlap.mid.extra','fixtures/original-duet.mxl','C:\Windows\win.ini','seed-0.json','seed-17.json','seed-01.json','Seed-1.json','other-1.json','seed-1.json.extra',"seed-1.json`n",'',"original-duet.mxl`0")) {
    Assert-Rejected { [NativeAcceptance]::ResolveFixturePath($fixtures,$temporary,$name) } "unapproved name $name"
  }
  foreach($name in @('../pitch-bend-authored-songs.zip','..\pitch-bend-authored-songs.zip','fixtures/pitch-bend-authored-songs.zip','Pitch-bend-authored-songs.zip','pitch-bend-authored-songs.zip.extra',"pitch-bend-authored-songs.zip`n")) {
    Assert-Rejected { [NativeAcceptance]::ResolveFixturePath($fixtures,$temporary,$name) } "unapproved pitch-bend path $name"
  }
  # Reproduce the real performance-seed action 5 filename through the exact C#
  # resolver compiled above. Only that original fixture name is admitted.
  foreach($name in @('../performance-authored-songs.zip','..\performance-authored-songs.zip','fixtures/performance-authored-songs.zip','Performance-authored-songs.zip','performance-authored-song.zip','performance-authored-songs.json','performance-authored-songs.zip.extra',"performance-authored-songs.zip`n",(Join-Path $fixtures 'performance-authored-songs.zip'))) {
    Assert-Rejected { [NativeAcceptance]::ResolveFixturePath($fixtures,$temporary,$name) } "unapproved performance path $name"
  }
  $performancePath=Join-Path $fixtures 'performance-authored-songs.zip'
  [System.IO.File]::WriteAllText((Join-Path $downloads 'performance-authored-songs.zip'),'outside the fixture root')
  Assert-True ([NativeAcceptance]::ResolveFixturePath($fixtures,$temporary,'performance-authored-songs.zip') -ceq $performancePath) 'performance fixture resolves only in its fixture root'
  [System.IO.File]::Delete($performancePath)
  Assert-Rejected { [NativeAcceptance]::ResolveFixturePath($fixtures,$temporary,'performance-authored-songs.zip') } 'missing performance fixture cannot fall back to downloads'
  New-Item -ItemType Directory $performancePath | Out-Null
  Assert-Rejected { [NativeAcceptance]::ResolveFixturePath($fixtures,$temporary,'performance-authored-songs.zip') } 'directory cannot replace the performance fixture'
  [System.IO.File]::Delete((Join-Path $fixtures 'malformed.json'))
  Assert-Rejected { [NativeAcceptance]::ResolveFixturePath($fixtures,$temporary,'malformed.json') } 'missing approved fixture'
  New-Item -ItemType Directory (Join-Path $fixtures 'malformed.json') | Out-Null
  Assert-Rejected { [NativeAcceptance]::ResolveFixturePath($fixtures,$temporary,'malformed.json') } 'directory in place of fixture'
  Assert-Rejected { [NativeAcceptance]::ValidateFileNameText('') } 'empty text'
  Assert-Rejected { [NativeAcceptance]::ValidateFileNameText("file`0name") } 'NUL text'
  Assert-Rejected { [NativeAcceptance]::ValidateFileNameText(('x'*32768)) } 'oversized text'
  [NativeAcceptance]::ValidateFileNameText('C:\fixture path\拼谱.musicxml');$script:checks++
  [NativeAcceptance]::ValidateFileNameReadback('approved','approved',8);$script:checks++
  Assert-Rejected { [NativeAcceptance]::ValidateFileNameReadback('approved','approve',7) } 'truncated readback'
  Assert-Rejected { [NativeAcceptance]::ValidateFileNameReadback('approved','approvedX',9) } 'readback with an extra suffix'
  Assert-Rejected { [NativeAcceptance]::ValidateFileNameReadback('approved','Approved',8) } 'case-altered readback'
  Assert-Rejected { [NativeAcceptance]::ValidateFileNameReadback('approved','approved',9) } 'inconsistent readback length'
} finally {
  if(Test-Path $temporary){Remove-Item -LiteralPath $temporary -Recurse -Force}
}
. (Join-Path $PSScriptRoot 'windows-catalog-contract.ps1')
Write-Output "$script:checks native picker identity, completion, catalog profile/snapshot and fixture-path contract checks passed without GUI or native calls."

. (Join-Path $PSScriptRoot '../scripts/native-pitch-sources-contract.ps1')

. (Join-Path $PSScriptRoot '../scripts/native-direct-midi-contract.ps1')
