# Pure ownership/state contracts. This script never sends a key or opens a GUI.
$ErrorActionPreference='Stop'
$Root=Split-Path $PSScriptRoot -Parent
Add-Type -Path @((Join-Path $Root 'scripts/windows-desktop-native.cs'),(Join-Path $Root 'scripts/windows-live-tone-navigation.cs'))
. (Join-Path $Root 'scripts/windows-desktop-profile.ps1')
function Assert-True($Value,[string]$Message){if(-not $Value){throw $Message}}
function Assert-Throws([scriptblock]$Operation,[string]$Message){$thrown=$false;try{& $Operation | Out-Null}catch{$thrown=$true};if(-not $thrown){throw $Message}}
$phases=@('live-navigation-settings-keyup','live-navigation-settings-navigation','live-navigation-authoring-keyup','live-navigation-authoring-navigation')
foreach($phase in $phases){
  Assert-True ([NativeLiveToneNavigationKey]::IsPhase($phase)) 'Missing exact live-navigation phase'
  $down=[NativeLiveToneNavigationKey]::ValidateTransition($phase,'live-key-r-down',$false,$null,[IntPtr]::Zero,0,[IntPtr]42,[IntPtr]42,71,$true)
  Assert-True $down 'A valid closed down transition must become held'
  $up=[NativeLiveToneNavigationKey]::ValidateTransition($phase,'live-key-r-up',$true,$phase,[IntPtr]42,71,[IntPtr]42,[IntPtr]42,71,$true)
  Assert-True (-not $up) 'A matched up transition must become released'
  foreach($invalid in @(
    { [NativeLiveToneNavigationKey]::ValidateTransition($phase,'live-key-r-down',$true,$phase,[IntPtr]42,71,[IntPtr]42,[IntPtr]42,71,$true) },
    { [NativeLiveToneNavigationKey]::ValidateTransition($phase,'live-key-r-up',$false,$phase,[IntPtr]42,71,[IntPtr]42,[IntPtr]42,71,$true) },
    { [NativeLiveToneNavigationKey]::ValidateTransition($phase,'live-key-r-up',$true,'other',[IntPtr]42,71,[IntPtr]42,[IntPtr]42,71,$true) },
    { [NativeLiveToneNavigationKey]::ValidateTransition($phase,'live-key-r-up',$true,$phase,[IntPtr]43,71,[IntPtr]42,[IntPtr]42,71,$true) },
    { [NativeLiveToneNavigationKey]::ValidateTransition($phase,'live-key-r-up',$true,$phase,[IntPtr]42,72,[IntPtr]42,[IntPtr]42,71,$true) },
    { [NativeLiveToneNavigationKey]::ValidateTransition($phase,'live-key-r-down',$false,$null,[IntPtr]::Zero,0,[IntPtr]42,[IntPtr]43,71,$true) },
    { [NativeLiveToneNavigationKey]::ValidateTransition($phase,'live-key-r-down',$false,$null,[IntPtr]::Zero,0,[IntPtr]42,[IntPtr]42,0,$true) },
    { [NativeLiveToneNavigationKey]::ValidateTransition($phase,'live-key-r-down',$false,$null,[IntPtr]::Zero,0,[IntPtr]42,[IntPtr]42,71,$false) },
    { [NativeLiveToneNavigationKey]::ValidateTransition($phase,'key-c5',$false,$null,[IntPtr]::Zero,0,[IntPtr]42,[IntPtr]42,71,$true) }
  )){Assert-Throws $invalid 'Invalid native R transition was admitted'}
}
Assert-Throws { [NativeLiveToneNavigationKey]::ValidateTransition('canonical-practice-seed','live-key-r-down',$false,$null,[IntPtr]::Zero,0,[IntPtr]42,[IntPtr]42,71,$true) } 'Canonical actions must not enter the new held-key state'
Assert-True (-not [NativeLiveToneNavigationKey]::Held) 'Pure validation must not change native key state'
Assert-True ([NativeLiveToneNavigationKey]::HeldMilliseconds -eq 0) 'An idle key has no held timer'
Assert-True (-not [NativeLiveToneNavigationKey]::ReleaseIfHeld()) 'Idle cleanup must not send any native key'
$directory=Join-Path ([IO.Path]::GetTempPath()) ('wmh-live-profile-'+[guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $directory | Out-Null
try{
  foreach($phase in $phases){$profile=Get-AcceptanceProfile $directory $phase;Assert-True $profile.fresh_required 'Every live-navigation phase needs a fresh profile';Assert-True (-not $profile.existing_required) 'Native live-navigation cannot reuse a previous profile';Assert-True ($profile.profile_directory -ceq (Join-Path (Join-Path $directory 'webview-profiles') $phase)) 'Wrong closed native profile';Assert-True ($profile.library_directory -ceq (Join-Path $directory 'Scores')) 'Wrong original Scores owner'}
}finally{Remove-Item -LiteralPath $directory -Force -Recurse}
Write-Output 'Pure fixed-R ownership, transition and fresh-profile contracts passed; no keys or GUI were used.'
