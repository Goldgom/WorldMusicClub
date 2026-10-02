param(
  [Parameter(Mandatory=$true)][string]$Executable,
  [string]$OutputDirectory='desktop-acceptance'
)
$ErrorActionPreference='Stop'
$Executable=(Resolve-Path $Executable).Path
$Repository=(Resolve-Path (Join-Path $PSScriptRoot '..')).Path
if (Test-Path $OutputDirectory) { throw 'Use a fresh acceptance directory for this exact executable' }
New-Item -ItemType Directory $OutputDirectory | Out-Null
$OutputDirectory=(Resolve-Path $OutputDirectory).Path
$Fixtures=Join-Path $OutputDirectory 'fixtures'
New-Item -ItemType Directory $Fixtures | Out-Null
foreach($name in @('original-duet.musicxml','original-duet.mxl','midi-original-ppq.mid','jianpu-original-steps.jianpu')) {
  Copy-Item (Join-Path $Repository "tests/fixtures/$name") (Join-Path $Fixtures $name)
}
Set-Content -NoNewline -Encoding utf8 (Join-Path $Fixtures 'malformed.json') '{invalid canonical score'
Add-Type -AssemblyName UIAutomationClient,UIAutomationTypes,System.Drawing
Add-Type -Path (Join-Path $PSScriptRoot 'windows-desktop-native.cs')
function Save-Json($Value,[string]$Path) {
  $temporary="$Path.tmp"
  $Value | ConvertTo-Json -Depth 16 | Set-Content -Encoding utf8 $temporary
  Move-Item -Force $temporary $Path
}
function Capture-Handle([IntPtr]$Handle,[string]$Name) {
  $rectangle=New-Object NativeAcceptance+RECT
  if (-not [NativeAcceptance]::GetWindowRect($Handle,[ref]$rectangle)) { throw 'Cannot read native window bounds' }
  $bitmap=New-Object System.Drawing.Bitmap(($rectangle.Right-$rectangle.Left),($rectangle.Bottom-$rectangle.Top))
  $graphics=[System.Drawing.Graphics]::FromImage($bitmap);$device=$graphics.GetHdc()
  try { if(-not [NativeAcceptance]::PrintWindow($Handle,$device,2)){throw 'Native screenshot failed'} }
  finally { $graphics.ReleaseHdc($device);$graphics.Dispose() }
  try { $bitmap.Save((Join-Path $OutputDirectory "$Name.png"),[System.Drawing.Imaging.ImageFormat]::Png) }
  finally { $bitmap.Dispose() }
}
function Capture-Window($App,[string]$Name) { Capture-Handle $App.MainWindowHandle $Name }
function Find-Control($Root,[string]$Id) {
  $condition=[System.Windows.Automation.PropertyCondition]::new([System.Windows.Automation.AutomationElement]::AutomationIdProperty,$Id)
  return $Root.FindFirst([System.Windows.Automation.TreeScope]::Descendants,$condition)
}
function Find-FileNameEntry($Root,[hashtable]$Evidence) {
  # The common dialog's filename host can be a ComboBox, while its editable
  # descendant has a different AutomationId on different Windows versions.
  # Wait for the realized editable control; do not assume child ID 1001.
  $deadline=[DateTime]::UtcNow.AddSeconds(5)
  $editCondition=[System.Windows.Automation.PropertyCondition]::new([System.Windows.Automation.AutomationElement]::ControlTypeProperty,[System.Windows.Automation.ControlType]::Edit)
  while([DateTime]::UtcNow -lt $deadline) {
    $hostControl=Find-Control $Root '1148'
    $Evidence.filename_host_found=$null -ne $hostControl
    $Evidence.filename_candidates=@()
    if($null -ne $hostControl) {
      $edits=@($hostControl.FindAll([System.Windows.Automation.TreeScope]::Descendants,$editCondition))
      $candidates=@($hostControl)+$edits
      $Evidence.filename_candidate_count=$candidates.Count
      $writableEdits=@();$writableHost=$null
      foreach($candidate in ($candidates | Select-Object -First 8)) {
        $pattern=$null
        $available=$candidate.TryGetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern,[ref]$pattern)
        $details=[ordered]@{id=$candidate.Current.AutomationId;class=$candidate.Current.ClassName;control_type=$candidate.Current.ControlType.ProgrammaticName;enabled=$candidate.Current.IsEnabled;value_pattern=$available;read_only=$null}
        if($available) {
          $value=[System.Windows.Automation.ValuePattern]$pattern
          $details.read_only=$value.Current.IsReadOnly
          if($candidate.Current.IsEnabled -and -not $value.Current.IsReadOnly) {
            $entry=[pscustomobject]@{Element=$candidate;Pattern=$value}
            if($candidate -eq $hostControl){$writableHost=$entry}
            else{$writableEdits+=,$entry}
          }
        }
        $Evidence.filename_candidates+=,$details
      }
      # Descendants are considered only inside the verified filename host,
      # never arbitrary edit fields elsewhere in the dialog (such as Search).
      if($candidates.Count -gt 8){throw 'Windows filename host has more than eight candidate controls; refusing ambiguous input'}
      if($writableEdits.Count -eq 1){return $writableEdits[0]}
      if($edits.Count -eq 0 -and $null -ne $writableHost -and $hostControl.Current.ControlType -in @([System.Windows.Automation.ControlType]::Edit,[System.Windows.Automation.ControlType]::ComboBox)){return $writableHost}
    }
    Start-Sleep -Milliseconds 100
  }
  throw 'Windows filename host 1148 has no unique writable filename control after 5 seconds; see filename_candidates in this action result'
}
function Set-NativeFileName($Root,[IntPtr]$Dialog,$App,[string]$Path,[hashtable]$Evidence) {
  # The observed Windows ComboBoxEx32 exposes no UIA Edit or ValuePattern.
  # Get its own native Edit HWND instead; never choose another dialog edit.
  $condition=[System.Windows.Automation.PropertyCondition]::new([System.Windows.Automation.AutomationElement]::AutomationIdProperty,'1148')
  $hosts=@($Root.FindAll([System.Windows.Automation.TreeScope]::Descendants,$condition))
  $Evidence.filename_host_count=$hosts.Count
  if($hosts.Count -ne 1){throw 'Windows filename host 1148 is missing or ambiguous'}
  $hostControl=$hosts[0];$hostWindow=[IntPtr]$hostControl.Current.NativeWindowHandle
  $Evidence.filename_host=[ordered]@{id=$hostControl.Current.AutomationId;class=$hostControl.Current.ClassName;control_type=$hostControl.Current.ControlType.ProgrammaticName;enabled=$hostControl.Current.IsEnabled;hwnd=$hostWindow.ToInt64();value_pattern=$hostControl.GetCurrentPropertyValue([System.Windows.Automation.AutomationElement]::IsValuePatternAvailableProperty)}
  [uint32]$hostProcess=0;[void][NativeAcceptance]::GetWindowThreadProcessId($hostWindow,[ref]$hostProcess)
  $class=[System.Text.StringBuilder]::new(256);[void][NativeAcceptance]::GetClassName($hostWindow,$class,256)
  if($hostWindow -eq [IntPtr]::Zero -or $class.ToString() -cne 'ComboBoxEx32' -or [NativeAcceptance]::GetDlgCtrlID($hostWindow) -ne 1148 -or -not [NativeAcceptance]::IsChild($Dialog,$hostWindow) -or $hostProcess -ne $App.Id -or -not [NativeAcceptance]::IsWindowEnabled($hostWindow)) {
    throw 'Filename host native class, control ID, dialog ancestry, process or enabled state does not match'
  }
  $edit=[NativeAcceptance]::FileNameEdit($hostWindow)
  [uint32]$editProcess=0;[void][NativeAcceptance]::GetWindowThreadProcessId($edit,[ref]$editProcess)
  $editClass=[System.Text.StringBuilder]::new(256);[void][NativeAcceptance]::GetClassName($edit,$editClass,256)
  $readOnly=([NativeAcceptance]::GetWindowStyle($edit,-16) -band 0x0800) -ne 0
  $Evidence.filename_native_edit=[ordered]@{hwnd=$edit.ToInt64();process_id=$editProcess;class=$editClass.ToString();control_id=[NativeAcceptance]::GetDlgCtrlID($edit);host_descendant=[NativeAcceptance]::IsChild($hostWindow,$edit);enabled=[NativeAcceptance]::IsWindowEnabled($edit);visible=[NativeAcceptance]::IsWindowVisible($edit);read_only=$readOnly;entry_method='WM_SETTEXT';exact_readback=$false}
  [uint32]$dialogProcess=0;[void][NativeAcceptance]::GetWindowThreadProcessId($Dialog,[ref]$dialogProcess)
  $target=[NativeFileNameTarget]::new()
  $target.Dialog=$Dialog;$target.AppWindow=$App.MainWindowHandle;$target.RootOwner=[NativeAcceptance]::GetAncestor($Dialog,3)
  $target.Host=$hostWindow;$target.Edit=$edit;$target.AppProcess=$App.Id;$target.DialogProcess=$dialogProcess;$target.HostProcess=$hostProcess;$target.EditProcess=$editProcess
  $target.HostControlId=[NativeAcceptance]::GetDlgCtrlID($hostWindow);$target.HostClass=$class.ToString();$target.EditClass=$editClass.ToString()
  $target.HostInDialog=[NativeAcceptance]::IsChild($Dialog,$hostWindow);$target.EditInHost=$Evidence.filename_native_edit.host_descendant
  $target.HostEnabled=[NativeAcceptance]::IsWindowEnabled($hostWindow);$target.EditEnabled=$Evidence.filename_native_edit.enabled;$target.EditVisible=$Evidence.filename_native_edit.visible;$target.EditReadOnly=$readOnly
  [NativeAcceptance]::ValidateFileNameTarget($target)
  [NativeAcceptance]::SetFileName($edit,$Path)
  $Evidence.filename_native_edit.exact_readback=$true
  $Evidence.filename_entry_method='native_ComboBoxEx32_edit'
}
function Native-Action($App,$Action,[hashtable]$Evidence) {
  $App.Refresh();$window=$App.MainWindowHandle
  if($window -eq [IntPtr]::Zero){throw 'Application window disappeared'}
  [NativeAcceptance]::SetForegroundWindow($window) | Out-Null
  Start-Sleep -Milliseconds 150
  if([NativeAcceptance]::GetForegroundWindow() -ne $window){throw 'Application did not receive foreground ownership'}
  if($Action.kind -eq 'escape') {[NativeAcceptance]::Key(0x1B);return}
  if($Action.kind -eq 'minimize-restore') {
    [NativeAcceptance]::ShowWindow($window,6) | Out-Null;Start-Sleep -Milliseconds 350
    [NativeAcceptance]::ShowWindow($window,9) | Out-Null
    [NativeAcceptance]::SetForegroundWindow($window) | Out-Null;Start-Sleep -Milliseconds 350;return
  }
  $rectangle=New-Object NativeAcceptance+RECT;$origin=New-Object NativeAcceptance+POINT
  if(-not [NativeAcceptance]::GetClientRect($window,[ref]$rectangle) -or -not [NativeAcceptance]::ClientToScreen($window,[ref]$origin)){throw 'Cannot map browser content to native client coordinates'}
  $x=$origin.X+[int]($Action.x*($rectangle.Right-$rectangle.Left)/$Action.width)
  $y=$origin.Y+[int]($Action.y*($rectangle.Bottom-$rectangle.Top)/$Action.height)
  [NativeAcceptance]::Click($x,$y)
  if($Action.kind -eq 'key-r'){[NativeAcceptance]::Key(0x52);return}
  if($Action.kind -eq 'click'){return}
  if($Action.kind -notin @('picker','cancel-picker')){throw 'Unknown acceptance action'}
  $deadline=[DateTime]::UtcNow.AddSeconds(10);$dialog=[IntPtr]::Zero
  while([DateTime]::UtcNow -lt $deadline) {
    $candidate=[NativeAcceptance]::GetForegroundWindow();$class=[System.Text.StringBuilder]::new(256)
    [void][NativeAcceptance]::GetClassName($candidate,$class,256)
    if($class.ToString() -eq '#32770' -and [NativeAcceptance]::GetAncestor($candidate,3) -eq $window){$dialog=$candidate;break}
    Start-Sleep -Milliseconds 100
  }
  if($dialog -eq [IntPtr]::Zero){throw 'No owned Windows file picker opened; no browser file-input substitution is allowed'}
  [uint32]$dialogProcess=0
  [void][NativeAcceptance]::GetWindowThreadProcessId($dialog,[ref]$dialogProcess)
  $Evidence.owned_dialog=[ordered]@{hwnd=$dialog.ToInt64();process_id=$dialogProcess;class=$class.ToString();root_owner_hwnd=[NativeAcceptance]::GetAncestor($dialog,3).ToInt64();app_hwnd=$window.ToInt64();app_process_id=$App.Id}
  if($Action.kind -eq 'cancel-picker'){[NativeAcceptance]::Key(0x1B);return}
  try {
    $path=[NativeAcceptance]::ResolveFixturePath($Fixtures,$OutputDirectory,[string]$Action.file)
    $root=[System.Windows.Automation.AutomationElement]::FromHandle($dialog)
    $entry=$null
    try { $entry=Find-FileNameEntry $root $Evidence }
    catch {
      $Evidence.uia_entry_unavailable=$_.Exception.Message
      Set-NativeFileName $root $dialog $App $path $Evidence
    }
    if($null -ne $entry) {
      $entry.Pattern.SetValue($path)
      if($entry.Pattern.Current.Value -cne $path){throw 'Windows filename control did not retain the selected fixture path'}
      $Evidence.filename_entry_method='UIA_ValuePattern'
    }
    $open=Find-Control $root '1'
    if($null -eq $open){throw 'Windows Open button is missing'}
    ([System.Windows.Automation.InvokePattern]$open.GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern)).Invoke()
  } catch {
    $failure=$_.Exception.Message
    try { Capture-Handle $dialog "owned-picker-failure-$($env:WMH_DESKTOP_ACCEPTANCE_PHASE)-$($Action.sequence)" }
    catch { $Evidence.dialog_screenshot_error=$_.Exception.Message }
    throw $failure
  }
}
$previousDirectory=$env:WMH_DESKTOP_SMOKE_DIR;$previousPhase=$env:WMH_DESKTOP_ACCEPTANCE_PHASE
$env:WMH_DESKTOP_SMOKE_DIR=$OutputDirectory
$native=[ordered]@{version=1;source_sha=(git rev-parse HEAD);source_tree=(git rev-parse 'HEAD^{tree}');executable_sha256=(Get-FileHash $Executable -Algorithm SHA256).Hash.ToLower();executable_bytes=(Get-Item $Executable).Length;os=[System.Environment]::OSVersion.VersionString;profile_reused=$true;phases=@();ok=$false}
$app=$null
try {
  foreach($phase in @('seed','restart','close-active','reopen')) {
    $env:WMH_DESKTOP_ACCEPTANCE_PHASE=$phase
    $app=Start-Process -FilePath $Executable -PassThru -RedirectStandardError (Join-Path $OutputDirectory "stderr-$phase.log")
    $phaseStart=[DateTime]::UtcNow;$deadline=$phaseStart.AddSeconds(240);$sequence=1
    $reportFile=Join-Path $OutputDirectory "renderer-$phase.json"
    while(-not (Test-Path $reportFile)) {
      $app.Refresh();if($app.HasExited){throw "Process exited before $phase evidence: $($app.ExitCode)"}
      if([DateTime]::UtcNow -ge $deadline){throw "Native $phase exceeded 240 seconds"}
      $actionFile=Join-Path $OutputDirectory "action-$phase-$sequence.json"
      if(Test-Path $actionFile) {
        $action=Get-Content -Raw $actionFile | ConvertFrom-Json
        if($action.sequence -ne $sequence){throw 'Out-of-order native action'}
        $result=@{ok=$false}
        try{Native-Action $app $action $result;$result.ok=$true}catch{$result.error=$_.Exception.Message}
        Save-Json $result (Join-Path $OutputDirectory "result-$phase-$sequence.json")
        # A native modal can suspend the renderer, including its result poll.
        # Fail here after preserving the real action error instead of waiting
        # for the renderer to consume it and hiding it behind the phase limit.
        if(-not $result.ok){throw "Native $phase action $sequence ($($action.kind)) failed: $($result.error)"}
        $sequence++
      }
      Start-Sleep -Milliseconds 100
    }
    $report=Get-Content -Raw $reportFile | ConvertFrom-Json;$app.Refresh()
    Capture-Window $app "native-$phase"
    # One existing EXE-owned listener sample, not a network/security audit.
    $listeners=@(Get-NetTCPConnection -State Listen -ErrorAction Stop | Where-Object OwningProcess -eq $app.Id)
    $item=[ordered]@{phase=$phase;process_id=$app.Id;renderer_ok=$report.ok;renderer_origin=$report.origin;actions=$sequence-1;elapsed_seconds=([DateTime]::UtcNow-$phaseStart).TotalSeconds;executable_tcp_listeners=$listeners.Count;normal_close=$false}
    $native.phases+=,$item;Save-Json $native (Join-Path $OutputDirectory 'native-acceptance.json')
    if(-not $report.ok){throw "Native $phase failed: $($report.error)"}
    if($report.origin -ne 'https://wmh.localhost'){throw 'Origin/profile continuity changed'}
    if($listeners.Count -ne 0){throw 'Native EXE unexpectedly opened a TCP listener'}
    $closeStart=[DateTime]::UtcNow
    if(-not $app.CloseMainWindow() -or -not $app.WaitForExit(10000)){throw "Normal close timed out during $phase"}
    if($app.ExitCode -ne 0){throw "Normal close failed during $phase : $($app.ExitCode)"}
    $item.normal_close=$true;$item.close_seconds=([DateTime]::UtcNow-$closeStart).TotalSeconds
    Save-Json $native (Join-Path $OutputDirectory 'native-acceptance.json');$app=$null
  }
  & node (Join-Path $PSScriptRoot 'verify-desktop-evidence.mjs') $OutputDirectory
  if($LASTEXITCODE -ne 0){throw 'Actual downloaded-file verification failed'}
  $native.ok=$true;Save-Json $native (Join-Path $OutputDirectory 'native-acceptance.json')
  Write-Output 'Native file import/export, exact backups, same-profile restart, keyboard/free/history, navigation and normal/active close gates passed.'
} catch {
  $failure=$_.Exception.Message
  if($null -ne $app -and -not $app.HasExited){try{Capture-Window $app "native-failure-$phase"}catch{}}
  $native.error=$failure;Save-Json $native (Join-Path $OutputDirectory 'native-acceptance.json');throw
} finally {
  if($null -ne $app -and -not $app.HasExited){Stop-Process -Id $app.Id}
  $env:WMH_DESKTOP_SMOKE_DIR=$previousDirectory;$env:WMH_DESKTOP_ACCEPTANCE_PHASE=$previousPhase
}
