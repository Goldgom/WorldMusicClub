# Process-owner-only path/evidence checks. Sourcing this file starts no app and
# performs no native calls, so the same helpers run in ordinary contract tests.
function Get-AcceptanceProfile([string]$Directory,[string]$Phase) {
  $shared=@('seed','restart','close-active','reopen')
  $fresh=@('folder-seed','folder-restart','folder-failure','bulk-seed','bulk-restart','bulk-failure','clean-seed','clean-restart','vsq-seed','vsq-restart','performance-seed','performance-controls','performance-restart','pitch-bend-seed','pitch-bend-restart','authoring-seed','authoring-restart')
  if($Phase -cnotin ($shared+$fresh)){throw "Unknown acceptance profile phase: $Phase"}
  if(-not [IO.Path]::IsPathFullyQualified($Directory)){throw 'Acceptance profile root must be absolute'}
  $root=Get-Item -LiteralPath $Directory -Force -ErrorAction Stop
  if(-not $root.PSIsContainer -or ($root.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0){throw "Acceptance profile root must be an ordinary directory: $Directory"}
  $freshRequired=$Phase -cin $fresh
  $profile=if($freshRequired){Join-Path (Join-Path $Directory 'webview-profiles') $Phase}else{Join-Path $Directory 'webview-profile'}
  return [ordered]@{phase=$Phase;profile_directory=$profile;fresh_required=$freshRequired}
}
function Get-AcceptancePathItem([string]$Path) {
  try { return Get-Item -LiteralPath $Path -Force -ErrorAction Stop }
  catch [System.Management.Automation.ItemNotFoundException] { return $null }
}
function Assert-AcceptanceProfileLaunch([string]$Directory,[string]$Phase) {
  $selection=Get-AcceptanceProfile $Directory $Phase
  if($selection.fresh_required) {
    $parent=Get-AcceptancePathItem (Join-Path $Directory 'webview-profiles')
    if($null -ne $parent -and (-not $parent.PSIsContainer -or ($parent.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0)){throw "Fresh profile parent must be an ordinary directory: $($parent.FullName)"}
  }
  $existing=Get-AcceptancePathItem $selection.profile_directory
  $selection.profile_absent_before_launch=$null -eq $existing
  if($selection.fresh_required -and -not $selection.profile_absent_before_launch){throw "Fresh profile precondition failed for $Phase at $($selection.profile_directory): selected path already exists"}
  if($null -ne $existing -and (-not $existing.PSIsContainer -or ($existing.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0)){throw "Shared profile must be an ordinary directory: $($selection.profile_directory)"}
  # Do not create it here. The Rust host atomically reserves the exact same path
  # immediately before passing it to WebviewWindowBuilder.data_directory.
  return $selection
}
function Assert-AcceptanceProfileEvidence([string]$Directory,$Selection,[int]$ProcessId) {
  $path=Join-Path $Directory "profile-$($Selection.phase).json"
  $file=Get-Item -LiteralPath $path -Force -ErrorAction Stop
  if($file.PSIsContainer -or ($file.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0 -or $file.Length -le 0 -or $file.Length -gt 8KB){throw "Invalid bounded host profile evidence: $path"}
  $proof=Get-Content -LiteralPath $path -Raw | ConvertFrom-Json
  $library=Join-Path $Directory $(if($Selection.fresh_required){'Scores'}else{'score-library'})
  if($proof.version -ne 1 -or $proof.phase -cne $Selection.phase -or $proof.process_id -ne $ProcessId -or $proof.profile_directory -cne $Selection.profile_directory -or $proof.library_directory -cne $library -or $proof.fresh_required -cne $Selection.fresh_required -or $proof.created_new -cne $Selection.profile_absent_before_launch){throw "Host profile selection/creation does not match phase, process, fresh precondition or Scores root: $path"}
  $profile=Get-Item -LiteralPath $Selection.profile_directory -Force -ErrorAction Stop
  if(-not $profile.PSIsContainer -or ($profile.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0){throw "Selected WebView profile was not created as an ordinary directory: $($Selection.profile_directory)"}
}
