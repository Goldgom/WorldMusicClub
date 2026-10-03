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
  $fixed=@('original-duet.musicxml','original-duet.mxl','midi-original-ppq.mid','original-reference-overlap.mid','jianpu-original-steps.jianpu','malformed.json','folder-original.json','folder-conflict.json')
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
  foreach($name in @('../folder-original.json','folder-original.json.extra','folder-restart-1.json','../original-duet.mxl','../original-reference-overlap.mid','original-reference-overlap.mid.extra','fixtures/original-duet.mxl','C:\Windows\win.ini','seed-0.json','seed-17.json','seed-01.json','Seed-1.json','other-1.json','seed-1.json.extra',"seed-1.json`n",'',"original-duet.mxl`0")) {
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
