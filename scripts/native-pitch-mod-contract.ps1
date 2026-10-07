$ErrorActionPreference='Stop'
# Contract-only. No GUI, key injection, server, native process or user profile.
Add-Type -Path (Join-Path $PSScriptRoot 'native-pitch-mod-input.cs')
. (Join-Path $PSScriptRoot 'windows-desktop-profile.ps1')
function Assert-PitchRejected([scriptblock]$Action) { $rejected=$false;try{& $Action}catch{$rejected=$true};if(-not $rejected){throw 'Expected pitch contract rejection'} }
[NativePitchModInput]::Validate('pitch-mod-seed','pitch-mod-shift-two')
foreach($phase in @('pitch-mod-restart','seed','assistance-seed','canonical-practice-controls','')) { Assert-PitchRejected {[NativePitchModInput]::Validate($phase,'pitch-mod-shift-two')} }
foreach($kind in @('2','pitch-mod-key-s','arbitrary','')) { Assert-PitchRejected {[NativePitchModInput]::Validate('pitch-mod-seed',$kind)} }
$directory=Join-Path ([IO.Path]::GetTempPath()) ('wmc-pitch-contract-'+[guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory $directory | Out-Null
try {
 $seed=Get-AcceptanceProfile $directory 'pitch-mod-seed';$restart=Get-AcceptanceProfile $directory 'pitch-mod-restart'
 if($seed.profile_directory -cne $restart.profile_directory -or -not $seed.fresh_required -or $seed.existing_required -or $restart.fresh_required -or -not $restart.existing_required){throw 'Pitch profile reuse contract changed'}
 Assert-AcceptanceProfileLaunch $directory 'pitch-mod-seed' | Out-Null
 Assert-PitchRejected {Assert-AcceptanceProfileLaunch $directory 'pitch-mod-restart'}
 New-Item -ItemType Directory $seed.profile_directory | Out-Null
 Assert-PitchRejected {Assert-AcceptanceProfileLaunch $directory 'pitch-mod-seed'}
 Assert-PitchRejected {Assert-AcceptanceProfileLaunch $directory 'pitch-mod-restart'}
} finally {Remove-Item -LiteralPath $directory -Recurse -Force}
Write-Output 'Closed pitch input and saved-profile contracts passed; no native input used'
