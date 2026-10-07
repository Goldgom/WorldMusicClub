$ErrorActionPreference='Stop'
# Contract-only: no application, GUI, input injection or user profile.
. (Join-Path $PSScriptRoot 'windows-desktop-profile.ps1')
function Assert-DirectMidiRejected([scriptblock]$Action) { $rejected=$false;try{& $Action}catch{$rejected=$true};if(-not $rejected){throw 'Expected direct MIDI contract rejection'} }
$directory=Join-Path ([IO.Path]::GetTempPath()) ('wmc-direct-midi-contract-'+[guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory $directory | Out-Null
try {
 $seed=Get-AcceptanceProfile $directory 'direct-midi-seed';$restart=Get-AcceptanceProfile $directory 'direct-midi-restart'
 if($seed.profile_directory -ceq $restart.profile_directory -or -not $seed.fresh_required -or -not $restart.fresh_required -or $seed.existing_required -or $restart.existing_required){throw 'Direct MIDI phases require separate fresh profiles'}
 foreach($phase in @('direct-midi-seed','direct-midi-restart')) {
  $selection=Assert-AcceptanceProfileLaunch $directory $phase
  New-Item -ItemType Directory $selection.profile_directory -Force | Out-Null
  Assert-DirectMidiRejected {Assert-AcceptanceProfileLaunch $directory $phase}
 }
 foreach($phase in @('direct-midi','direct-midi-seed-extra','DIRECT-MIDI-SEED','../direct-midi-restart',"direct-midi-seed`n")){Assert-DirectMidiRejected {Get-AcceptanceProfile $directory $phase}}
} finally {Remove-Item -LiteralPath $directory -Recurse -Force}
# Parse all registration sources even though this contract does not execute them.
foreach($file in @('windows-desktop-acceptance.ps1','windows-desktop-profile.ps1')) {
 $tokens=$null;$errors=$null
 [void][System.Management.Automation.Language.Parser]::ParseFile((Join-Path $PSScriptRoot $file),[ref]$tokens,[ref]$errors)
 if($errors.Count){throw "PowerShell parse errors: $file"}
}
Write-Output 'Closed direct MIDI fresh-profile contracts passed; no native application launched'
