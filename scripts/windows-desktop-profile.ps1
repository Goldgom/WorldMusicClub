# Process-owner-only path/evidence checks. Sourcing this file starts no app and
# performs no native calls, so the same helpers run in ordinary contract tests.
. (Join-Path $PSScriptRoot 'windows-desktop-evidence.ps1')
function Get-AcceptanceProfile([string]$Directory,[string]$Phase) {
  $shared=@('seed','restart','close-active','reopen')
  $fresh=@('build-diagnostics','folder-seed','folder-restart','folder-failure','bulk-seed','bulk-restart','bulk-failure','clean-seed','clean-restart','vsq-seed','vsq-restart','performance-seed','performance-controls','performance-restart','pitch-bend-seed','pitch-bend-restart','basic-key-seed','basic-key-restart','authoring-seed','authoring-restart','vsq-authoring-seed','vsq-authoring-restart','live-navigation-settings-keyup','live-navigation-settings-navigation','live-navigation-authoring-keyup','live-navigation-authoring-navigation')
  $complete=@('complete-practice-seed','complete-practice-restart')
  $canonical=@('canonical-practice-seed','canonical-practice-controls','canonical-practice-restart')
  $skin=@('skin-seed','skin-restart','skin-default-restart')
  $catalog=@('catalog-seed','catalog-restart','catalog-final')
  if($Phase -cnotin ($shared+$fresh+$catalog+$complete+$canonical+$skin)){throw "Unknown acceptance profile phase: $Phase"}
  if(-not [IO.Path]::IsPathFullyQualified($Directory)){throw 'Acceptance profile root must be absolute'}
  $root=Get-Item -LiteralPath $Directory -Force -ErrorAction Stop
  if(-not $root.PSIsContainer -or ($root.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0){throw "Acceptance profile root must be an ordinary directory: $Directory"}
  $skinPhase=$Phase -cin $skin
  $catalogPhase=$Phase -cin $catalog
  $completePhase=$Phase -cin $complete
  $canonicalPhase=$Phase -cin $canonical
  $freshRequired=$Phase -cin $fresh -or $Phase -ceq 'catalog-seed' -or $Phase -ceq 'complete-practice-seed' -or $Phase -ceq 'canonical-practice-seed' -or $Phase -ceq 'skin-seed'
  $profile=if($skinPhase){Join-Path (Join-Path $Directory 'webview-profiles') 'skin-seed'}elseif($catalogPhase){Join-Path $Directory 'webview-catalog-profile'}elseif($canonicalPhase){Join-Path (Join-Path $Directory 'webview-profiles') 'canonical-practice-seed'}elseif($completePhase){Join-Path (Join-Path $Directory 'webview-profiles') 'complete-practice-seed'}elseif($freshRequired){Join-Path (Join-Path $Directory 'webview-profiles') $Phase}else{Join-Path $Directory 'webview-profile'}
  return [ordered]@{phase=$Phase;profile_directory=$profile;fresh_required=$freshRequired;existing_required=(($skinPhase -and $Phase -cne 'skin-seed') -or ($catalogPhase -and $Phase -cne 'catalog-seed') -or ($completePhase -and $Phase -ceq 'complete-practice-restart') -or ($canonicalPhase -and $Phase -cne 'canonical-practice-seed'));library_directory=(Join-Path $Directory $(if($Phase -cin $shared){'score-library'}else{'Scores'}))}
}
function Get-AcceptancePathItem([string]$Path) {
  try { return Get-Item -LiteralPath $Path -Force -ErrorAction Stop }
  catch [System.Management.Automation.ItemNotFoundException] { return $null }
}
function Assert-AcceptanceProfileLaunch([string]$Directory,[string]$Phase) {
  $selection=Get-AcceptanceProfile $Directory $Phase
  if($selection.fresh_required -and $Phase -cne 'catalog-seed') {
    $parent=Get-AcceptancePathItem (Join-Path $Directory 'webview-profiles')
    if($null -ne $parent -and (-not $parent.PSIsContainer -or ($parent.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0)){throw "Fresh profile parent must be an ordinary directory: $($parent.FullName)"}
  }
  $existing=Get-AcceptancePathItem $selection.profile_directory
  $selection.profile_absent_before_launch=$null -eq $existing
  if($selection.fresh_required -and -not $selection.profile_absent_before_launch){throw "Fresh profile precondition failed for $Phase at $($selection.profile_directory): selected path already exists"}
  if($null -ne $existing -and (-not $existing.PSIsContainer -or ($existing.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0)){throw "Shared profile must be an ordinary directory: $($selection.profile_directory)"}
  if($selection.existing_required) {
    if($selection.profile_absent_before_launch){throw "Catalog restart requires its existing test-owned profile: $($selection.profile_directory)"}
    if($Phase -cin @('skin-restart','skin-default-restart')) {
      Assert-CatalogProfilePredecessor $Directory $selection 'skin-seed' $true
      if($Phase -ceq 'skin-default-restart'){Assert-CatalogProfilePredecessor $Directory $selection 'skin-restart' $false}
    }
    elseif($Phase -cin @('canonical-practice-controls','canonical-practice-restart')) {
      Assert-CatalogProfilePredecessor $Directory $selection 'canonical-practice-seed' $true
      if($Phase -ceq 'canonical-practice-restart'){Assert-CatalogProfilePredecessor $Directory $selection 'canonical-practice-controls' $false}
    }
    elseif($Phase -ceq 'complete-practice-restart'){Assert-CatalogProfilePredecessor $Directory $selection 'complete-practice-seed' $true}
    else {
      Assert-CatalogProfilePredecessor $Directory $selection 'catalog-seed' $true
      if($Phase -ceq 'catalog-final'){Assert-CatalogProfilePredecessor $Directory $selection 'catalog-restart' $false}
    }
  }
  # Do not create it here. The Rust host atomically reserves the exact same path
  # immediately before passing it to WebviewWindowBuilder.data_directory.
  return $selection
}
function Assert-CatalogProfilePredecessor([string]$Directory,$Selection,[string]$Phase,[bool]$Fresh) {
  $path=Join-Path $Directory "profile-$Phase.json"
  $file=Get-Item -LiteralPath $path -Force -ErrorAction Stop
  if($file.PSIsContainer -or ($file.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0 -or $file.Length -le 0 -or $file.Length -gt 8KB){throw "Invalid bounded catalog profile predecessor: $path"}
  $proof=Read-AcceptanceJsonSnapshot -Path $path -MaximumBytes 8KB
  if($proof.version -ne 1 -or $proof.phase -cne $Phase -or ($proof.process_id -isnot [long] -and $proof.process_id -isnot [int]) -or $proof.process_id -le 0 -or $proof.profile_directory -cne $Selection.profile_directory -or $proof.library_directory -cne $Selection.library_directory -or $proof.fresh_required -isnot [bool] -or $proof.fresh_required -cne $Fresh -or $proof.created_new -isnot [bool] -or $proof.created_new -cne $Fresh){throw "Catalog profile predecessor does not match this test-owned profile: $path"}
}
function Assert-AcceptanceProfileEvidence([string]$Directory,$Selection,[int]$ProcessId) {
  $path=Join-Path $Directory "profile-$($Selection.phase).json"
  $file=Get-Item -LiteralPath $path -Force -ErrorAction Stop
  if($file.PSIsContainer -or ($file.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0 -or $file.Length -le 0 -or $file.Length -gt 8KB){throw "Invalid bounded host profile evidence: $path"}
  $proof=Read-AcceptanceJsonSnapshot -Path $path -MaximumBytes 8KB
  $library=$Selection.library_directory
  if($proof.version -ne 1 -or $proof.phase -cne $Selection.phase -or $proof.process_id -ne $ProcessId -or $proof.profile_directory -cne $Selection.profile_directory -or $proof.library_directory -cne $library -or $proof.fresh_required -cne $Selection.fresh_required -or $proof.created_new -cne $Selection.profile_absent_before_launch){throw "Host profile selection/creation does not match phase, process, fresh precondition or Scores root: $path"}
  $profile=Get-Item -LiteralPath $Selection.profile_directory -Force -ErrorAction Stop
  if(-not $profile.PSIsContainer -or ($profile.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0){throw "Selected WebView profile was not created as an ordinary directory: $($Selection.profile_directory)"}
}
