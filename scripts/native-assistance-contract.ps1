# Pure syntax/closed-value/profile contracts; never sends native input or opens an app.
$ErrorActionPreference='Stop'
$root=(Resolve-Path (Join-Path $PSScriptRoot '..')).Path
foreach($name in @('scripts/windows-desktop-acceptance.ps1','scripts/windows-desktop-profile.ps1','scripts/native-assistance-contract.ps1')) {
  $tokens=$null;$errors=$null
  [void][System.Management.Automation.Language.Parser]::ParseFile((Join-Path $root $name),[ref]$tokens,[ref]$errors)
  if($errors.Count){$errors | Format-List;throw "PowerShell syntax errors: $name"}
}
Add-Type -Path (Join-Path $PSScriptRoot 'native-assistance-input.cs')
foreach($entry in @{ 'assistance-onset'='1';'assistance-interval'='100';'assistance-held'='2';'assistance-span'='7' }.GetEnumerator()) {
  if([NativeAssistanceInput]::Value($entry.Key) -cne $entry.Value){throw 'Closed assistance value differs'}
}
$rejected=$false
try{[void][NativeAssistanceInput]::Value('arbitrary')}catch{$rejected=$true}
if(-not $rejected){throw 'Unknown numeric action was accepted'}
. (Join-Path $PSScriptRoot 'windows-desktop-profile.ps1')
$directory=Join-Path ([IO.Path]::GetTempPath()) ('wmc-assistance-contract-'+[guid]::NewGuid().ToString('N'))
[void][IO.Directory]::CreateDirectory($directory)
try {
  $seed=Get-AcceptanceProfile $directory 'assistance-seed';$restart=Get-AcceptanceProfile $directory 'assistance-restart'
  if(-not $seed.fresh_required -or $seed.existing_required -or $restart.fresh_required -or -not $restart.existing_required -or $seed.profile_directory -cne $restart.profile_directory){throw 'Assistance profile continuity contract failed'}
  $rejected=$false
  try{[void](Assert-AcceptanceProfileLaunch $directory 'assistance-restart')}catch{$rejected=$true}
  if(-not $rejected){throw 'Restart silently manufactured its predecessor profile'}
}finally{Remove-Item -LiteralPath $directory -Recurse -Force}
Write-Output 'Pure assistance syntax, closed numeric values and profile contracts passed; no native run'
