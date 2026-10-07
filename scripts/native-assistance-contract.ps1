# Pure syntax/closed-value/profile contracts; never sends native input or opens an app.
$ErrorActionPreference='Stop'
$root=(Resolve-Path (Join-Path $PSScriptRoot '..')).Path
foreach($name in @('scripts/windows-desktop-acceptance.ps1','scripts/windows-desktop-profile.ps1','scripts/native-assistance-contract.ps1')) {
  $tokens=$null;$errors=$null
  [void][System.Management.Automation.Language.Parser]::ParseFile((Join-Path $root $name),[ref]$tokens,[ref]$errors)
  if($errors.Count){$errors | Format-List;throw "PowerShell syntax errors: $name"}
}
Add-Type -Path @((Join-Path $PSScriptRoot 'native-assistance-input.cs'),(Join-Path $PSScriptRoot 'windows-desktop-native.cs'))
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

# Exercise the same pure identity guards used by Set-NativeFileName. No HWND
# lookup, text entry, mouse or keyboard method is called in these contracts.
function Assert-AssistanceRejected([scriptblock]$Operation) {
  $rejected=$false;try{[void](& $Operation)}catch{$rejected=$true}
  if(-not $rejected){throw 'Unsafe native filename identity was accepted'}
}
function New-AssistanceFileNameHost([int]$Window=42) {
  $value=[NativeFileNameHost]::new();$value.Window=[IntPtr]$Window
  $value.AutomationId='1148';$value.AutomationClass='ComboBoxEx32';$value.NativeClass='ComboBoxEx32';$value.NativeControlId=1148
  $value.AutomationProcess=71;$value.NativeProcess=71;$value.AutomationEnabled=$true;$value.InDialog=$true;$value.Enabled=$true;$value.Visible=$true
  return $value
}
$host1=New-AssistanceFileNameHost
if([NativeAcceptance]::SelectFileNameHost([NativeFileNameHost[]]@($host1),71) -ne [IntPtr]42){throw 'Valid native filename host rejected'}
$host2=New-AssistanceFileNameHost 43
Assert-AssistanceRejected {[NativeAcceptance]::SelectFileNameHost([NativeFileNameHost[]]@($host1,$host2),71)}
foreach($field in @('AutomationProcess','NativeProcess')) {
  $wrong=New-AssistanceFileNameHost;$wrong.$field=72
  Assert-AssistanceRejected {[NativeAcceptance]::SelectFileNameHost([NativeFileNameHost[]]@($wrong),71)}
}
function New-AssistanceFileNameTarget {
  $value=[NativeFileNameTarget]::new();$value.Dialog=[IntPtr]40;$value.AppWindow=[IntPtr]41;$value.RootOwner=[IntPtr]41;$value.Host=[IntPtr]42;$value.Edit=[IntPtr]43
  $value.AppProcess=71;$value.DialogProcess=71;$value.HostProcess=71;$value.EditProcess=71
  $value.HostControlId=1148;$value.HostClass='ComboBoxEx32';$value.EditClass='Edit';$value.HostInDialog=$true;$value.EditInHost=$true
  $value.HostEnabled=$true;$value.EditEnabled=$true;$value.EditVisible=$true;$value.EditReadOnly=$false
  return $value
}
[NativeAcceptance]::ValidateFileNameTarget((New-AssistanceFileNameTarget))
foreach($field in @('DialogProcess','HostProcess','EditProcess')) {
  $wrong=New-AssistanceFileNameTarget;$wrong.$field=72
  Assert-AssistanceRejected {[NativeAcceptance]::ValidateFileNameTarget($wrong)}
}
$wrong=New-AssistanceFileNameTarget;$wrong.RootOwner=[IntPtr]99
Assert-AssistanceRejected {[NativeAcceptance]::ValidateFileNameTarget($wrong)}
$wrong=New-AssistanceFileNameTarget;$wrong.EditReadOnly=$true
Assert-AssistanceRejected {[NativeAcceptance]::ValidateFileNameTarget($wrong)}
foreach($field in @('HostInDialog','EditInHost','HostEnabled','EditEnabled','EditVisible')) {
  $wrong=New-AssistanceFileNameTarget;$wrong.$field=$false
  Assert-AssistanceRejected {[NativeAcceptance]::ValidateFileNameTarget($wrong)}
}
[NativeAcceptance]::ValidateFileNameReadback('original-fixture.zip','original-fixture.zip',20)
Assert-AssistanceRejected {[NativeAcceptance]::ValidateFileNameReadback('original-fixture.zip','different-fixture.zip',20)}
Write-Output 'Pure assistance filename identity, writable-state and exact-readback contracts passed; no native input used'
