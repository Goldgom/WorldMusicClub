# Ordinary contract tests: compile the real helper and exercise only pure
# validation/path functions. No window creation, UIA, or native messages run.
$ErrorActionPreference='Stop'
Add-Type -Path (Join-Path $PSScriptRoot '../scripts/windows-desktop-native.cs')
$script:checks=0
function Assert-True([bool]$Value,[string]$Label) {
  if(-not $Value){throw "Contract failed: $Label"}
  $script:checks++
}
function Assert-Rejected([scriptblock]$Operation,[string]$Label) {
  try { & $Operation } catch { $script:checks++;return }
  throw "Contract unexpectedly accepted: $Label"
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
foreach($case in @(
  @{field='Window';value=[IntPtr]::Zero},@{field='AutomationId';value='2'},@{field='IsButton';value=$false},
  @{field='AutomationProcess';value=[uint32]43},@{field='NativeProcess';value=[uint32]43},
  @{field='NativeClass';value='Static'},@{field='NativeControlId';value=2},
  @{field='AutomationEnabled';value=$false},@{field='InDialog';value=$false},
  @{field='Enabled';value=$false},@{field='Visible';value=$false}
)) {
  $button=New-ValidOpenButton;$button.($case.field)=$case.value
  Assert-Rejected { [NativeAcceptance]::SelectPickerOpenButton([NativePickerButton[]]@($button),42) } "Open identity $($case.field)"
}
function New-Rectangle([int]$Left,[int]$Top,[int]$Right,[int]$Bottom) {
  $bounds=[NativeAcceptance+RECT]::new();$bounds.Left=$Left;$bounds.Top=$Top;$bounds.Right=$Right;$bounds.Bottom=$Bottom;return $bounds
}
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
Assert-True (-not [NativeAcceptance]::PickerDismissed($true,$true,$false)) 'Invoke or click return does not dismiss a visible chooser'
Assert-True (-not [NativeAcceptance]::PickerDismissed($false,$false,$true)) 'replacement owned popup is not completion'
Assert-True ([NativeAcceptance]::PickerDismissed($false,$false,$false)) 'destroyed chooser with no replacement modal'
Assert-True ([NativeAcceptance]::PickerDismissed($true,$false,$false)) 'hidden chooser with no replacement modal'
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
  $fixed=@('original-duet.musicxml','original-duet.mxl','midi-original-ppq.mid','jianpu-original-steps.jianpu','malformed.json')
  foreach($name in $fixed) {
    $expected=Join-Path $fixtures $name;[System.IO.File]::WriteAllText($expected,'fixture')
    Assert-True ([NativeAcceptance]::ResolveFixturePath($fixtures,$temporary,$name) -ceq $expected) "fixed path $name"
  }
  foreach($phase in @('seed','restart','close-active','reopen')) {
    foreach($sequence in 1..16) {
      $name="$phase-$sequence.json";$expected=Join-Path $downloads $name
      [System.IO.File]::WriteAllText($expected,'{}')
      Assert-True ([NativeAcceptance]::ResolveFixturePath($fixtures,$temporary,$name) -ceq $expected) "download path $name"
    }
  }
  foreach($name in @('../original-duet.mxl','fixtures/original-duet.mxl','C:\Windows\win.ini','seed-0.json','seed-17.json','seed-01.json','Seed-1.json','other-1.json','seed-1.json.extra',"seed-1.json`n",'',"original-duet.mxl`0")) {
    Assert-Rejected { [NativeAcceptance]::ResolveFixturePath($fixtures,$temporary,$name) } "unapproved name $name"
  }
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
Write-Output "$script:checks native picker identity, completion and fixture-path contract checks passed without GUI or native calls."
