$ErrorActionPreference='Stop'
# Pure profile/input contract. Never invokes Edit or launches any app.
Add-Type -Path (Join-Path $PSScriptRoot 'native-pitch-sources-input.cs')
. (Join-Path $PSScriptRoot 'windows-desktop-profile.ps1')
function Assert-SourcePitchRejected([scriptblock]$Action) { $rejected=$false;try{& $Action}catch{$rejected=$true};if(-not $rejected){throw 'Expected source pitch rejection'} }
[NativePitchSourcesInput]::Validate('pitch-sources-seed','pitch-sources-shift-two')
foreach($phase in @('pitch-sources-restart','pitch-sources-zero','pitch-sources-zero-restart','pitch-mod-seed','seed','')) { Assert-SourcePitchRejected {[NativePitchSourcesInput]::Validate($phase,'pitch-sources-shift-two')} }
foreach($kind in @('2','pitch-mod-shift-two','arbitrary','')) { Assert-SourcePitchRejected {[NativePitchSourcesInput]::Validate('pitch-sources-seed',$kind)} }
$directory=Join-Path ([IO.Path]::GetTempPath()) ('wmc-pitch-sources-contract-'+[guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory $directory | Out-Null
try {
 $seed=Get-AcceptanceProfile $directory 'pitch-sources-seed'
 if(-not $seed.fresh_required -or $seed.existing_required){throw 'Original sources seed must be fresh'}
 Assert-AcceptanceProfileLaunch $directory 'pitch-sources-seed' | Out-Null
 foreach($phase in @('pitch-sources-restart','pitch-sources-zero','pitch-sources-zero-restart')) {
  $next=Get-AcceptanceProfile $directory $phase
  if($next.profile_directory -cne $seed.profile_directory -or $next.fresh_required -or -not $next.existing_required){throw 'Source phase must reuse the exact seed profile'}
  Assert-SourcePitchRejected {Assert-AcceptanceProfileLaunch $directory $phase}
 }
} finally {Remove-Item -LiteralPath $directory -Recurse -Force}
Write-Output 'Source pitch closed input and exact profile contracts passed; no native input used'
