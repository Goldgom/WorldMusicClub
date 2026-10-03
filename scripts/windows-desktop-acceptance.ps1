param(
  [Parameter(Mandatory=$true)][string]$Executable,
  [string]$OutputDirectory='desktop-acceptance',
  [ValidateSet('desktop','song-folder','bulk-import','clean-song','vsq-song','performance-song')][string]$Scenario='desktop'
)
$ErrorActionPreference='Stop'
$Executable=(Resolve-Path $Executable).Path
$Repository=(Resolve-Path (Join-Path $PSScriptRoot '..')).Path
if (Test-Path $OutputDirectory) { throw 'Use a fresh acceptance directory for this exact executable' }
New-Item -ItemType Directory $OutputDirectory | Out-Null
$OutputDirectory=(Resolve-Path $OutputDirectory).Path
$Fixtures=Join-Path $OutputDirectory 'fixtures'
New-Item -ItemType Directory $Fixtures | Out-Null
$fixtureNames=if($Scenario -in @('bulk-import','clean-song','vsq-song','performance-song')){@()}elseif($Scenario -eq 'song-folder'){@('folder-original.json','folder-conflict.json')}else{@('original-duet.musicxml','original-duet.mxl','midi-original-ppq.mid','original-reference-overlap.mid','jianpu-original-steps.jianpu')}
foreach($name in $fixtureNames) {
  Copy-Item (Join-Path $Repository "tests/fixtures/$name") (Join-Path $Fixtures $name)
}
if($Scenario -eq 'bulk-import') {
  & node (Join-Path $PSScriptRoot 'prepare-bulk-import-fixtures.mjs') $Fixtures
  if($LASTEXITCODE -ne 0){throw 'Original bulk-import fixture generation failed'}
}
if($Scenario -eq 'performance-song') {
  & node (Join-Path $PSScriptRoot 'prepare-performance-song-fixtures.mjs') $Fixtures
  if($LASTEXITCODE -ne 0){throw 'Original performance fixture generation failed'}
}
if($Scenario -eq 'vsq-song') {
  & node (Join-Path $PSScriptRoot 'prepare-vsq-song-fixtures.mjs') $Fixtures
  if($LASTEXITCODE -ne 0){throw 'Original VSQ fixture generation failed'}
}
if($Scenario -eq 'clean-song') {
  & node (Join-Path $PSScriptRoot 'prepare-clean-song-fixtures.mjs') $Fixtures
  if($LASTEXITCODE -ne 0){throw 'Original clean-song fixture generation failed'}
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
  $Evidence.filename_host_candidates=@();$nativeHosts=@()
  # ID 1148 can occur on several descendants. Inventory their identities and
  # require one native ComboBoxEx32 HWND, rather than one raw UIA ID match.
  if($hosts.Count -gt 8){throw 'Windows filename host inventory exceeds eight candidates'}
  foreach($hostControl in $hosts) {
    $current=$hostControl.Current;$candidateWindow=[IntPtr]$current.NativeWindowHandle
    [uint32]$candidateProcess=0;[void][NativeAcceptance]::GetWindowThreadProcessId($candidateWindow,[ref]$candidateProcess)
    $candidateClass=[System.Text.StringBuilder]::new(256);[void][NativeAcceptance]::GetClassName($candidateWindow,$candidateClass,256)
    $candidate=[NativeFileNameHost]::new()
    $candidate.Window=$candidateWindow;$candidate.AutomationId=$current.AutomationId;$candidate.AutomationClass=$current.ClassName
    $candidate.AutomationProcess=$current.ProcessId;$candidate.AutomationEnabled=$current.IsEnabled
    $candidate.NativeProcess=$candidateProcess;$candidate.NativeClass=$candidateClass.ToString();$candidate.NativeControlId=[NativeAcceptance]::GetDlgCtrlID($candidateWindow)
    $candidate.InDialog=[NativeAcceptance]::IsChild($Dialog,$candidateWindow);$candidate.Enabled=[NativeAcceptance]::IsWindowEnabled($candidateWindow);$candidate.Visible=[NativeAcceptance]::IsWindowVisible($candidateWindow)
    $nativeHosts+=,$candidate
    $Evidence.filename_host_candidates+=,[ordered]@{id=$current.AutomationId;class=$current.ClassName;control_type=$current.ControlType.ProgrammaticName;process_id=$current.ProcessId;enabled=$current.IsEnabled;hwnd=$candidateWindow.ToInt64();native_class=$candidate.NativeClass;native_control_id=$candidate.NativeControlId;native_process_id=$candidateProcess;dialog_descendant=$candidate.InDialog;native_enabled=$candidate.Enabled;native_visible=$candidate.Visible}
  }
  $hostWindow=[NativeAcceptance]::SelectFileNameHost([NativeFileNameHost[]]$nativeHosts,[uint32]$App.Id)
  $Evidence.filename_host=[ordered]@{hwnd=$hostWindow.ToInt64();selection='unique_UIA_and_native_ComboBoxEx32_handle'}
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
function Get-PickerButtonCandidate($Element,[IntPtr]$Dialog) {
  $current=$Element.Current;$handle=[IntPtr]$current.NativeWindowHandle
  [uint32]$process=0;[void][NativeAcceptance]::GetWindowThreadProcessId($handle,[ref]$process)
  $class=[System.Text.StringBuilder]::new(256);[void][NativeAcceptance]::GetClassName($handle,$class,256)
  $candidate=[NativePickerButton]::new()
  $candidate.Window=$handle;$candidate.AutomationId=$current.AutomationId;$candidate.IsButton=$current.ControlType -eq [System.Windows.Automation.ControlType]::Button
  $candidate.AutomationControlType=$current.ControlType.ProgrammaticName
  $candidate.AutomationProcess=$current.ProcessId;$candidate.AutomationEnabled=$current.IsEnabled
  $candidate.NativeProcess=$process;$candidate.NativeClass=$class.ToString();$candidate.NativeControlId=[NativeAcceptance]::GetDlgCtrlID($handle)
  $candidate.InDialog=[NativeAcceptance]::IsChild($Dialog,$handle);$candidate.Enabled=[NativeAcceptance]::IsWindowEnabled($handle);$candidate.Visible=[NativeAcceptance]::IsWindowVisible($handle)
  return $candidate
}
function Click-PickerAction($Root,[IntPtr]$Dialog,$App,[hashtable]$Evidence,[int]$ControlId=1) {
  if($ControlId -notin @(1,2)){throw 'Only native Open or Cancel is supported'}
  $prefix=if($ControlId -eq 1){'open_button'}else{'cancel_button'}
  $condition=[System.Windows.Automation.PropertyCondition]::new([System.Windows.Automation.AutomationElement]::AutomationIdProperty,[string]$ControlId)
  $buttons=@($Root.FindAll([System.Windows.Automation.TreeScope]::Descendants,$condition))
  $Evidence[$prefix+'_candidate_count']=$buttons.Count;$candidates=@()
  if($buttons.Count -gt 8){throw 'Open button inventory exceeds eight candidates'}
  foreach($button in $buttons){$candidates+=,(Get-PickerButtonCandidate $button $Dialog)}
  try {$handle=[NativeAcceptance]::SelectPickerActionButton([NativePickerButton[]]$candidates,[uint32]$App.Id,$ControlId)}
  catch {$Evidence[$prefix+'_candidates']=@($candidates | ForEach-Object {[ordered]@{hwnd=$_.Window.ToInt64();id=$_.AutomationId;is_button=$_.IsButton;uia_control_type=$_.AutomationControlType;class=$_.NativeClass;control_id=$_.NativeControlId;process_id=$_.NativeProcess;uia_process_id=$_.AutomationProcess;uia_enabled=$_.AutomationEnabled;enabled=$_.Enabled;visible=$_.Visible;dialog_descendant=$_.InDialog}});throw}
  [void][NativeAcceptance]::SetForegroundWindow($Dialog);Start-Sleep -Milliseconds 100
  # Re-read the live control and require its screen center to hit that exact
  # button (or a native child), rather than trusting a stale UIA rectangle.
  $live=Get-PickerButtonCandidate ([System.Windows.Automation.AutomationElement]::FromHandle($handle)) $Dialog
  if([NativeAcceptance]::SelectPickerActionButton([NativePickerButton[]]@($live),[uint32]$App.Id,$ControlId) -ne $handle){throw 'Open button native handle changed during verification'}
  $dialogBounds=New-Object NativeAcceptance+RECT;$buttonBounds=New-Object NativeAcceptance+RECT
  if(-not [NativeAcceptance]::GetWindowRect($Dialog,[ref]$dialogBounds) -or -not [NativeAcceptance]::GetWindowRect($handle,[ref]$buttonBounds)){throw 'Cannot read owned picker/button bounds'}
  $point=[NativeAcceptance]::PickerClickPoint($dialogBounds,$buttonBounds)
  $hit=[NativeAcceptance]::WindowFromPoint($point);[uint32]$hitProcess=0
  [void][NativeAcceptance]::GetWindowThreadProcessId($hit,[ref]$hitProcess)
  [uint32]$dialogProcess=0;[void][NativeAcceptance]::GetWindowThreadProcessId($Dialog,[ref]$dialogProcess)
  [NativeAcceptance]::ValidatePickerClick($Dialog,$App.MainWindowHandle,[NativeAcceptance]::GetAncestor($Dialog,3),[NativeAcceptance]::GetForegroundWindow(),[uint32]$App.Id,$dialogProcess,($hitProcess -eq $App.Id -and ($hit -eq $handle -or [NativeAcceptance]::IsChild($handle,$hit))))
  $Evidence[$prefix]=[ordered]@{hwnd=$handle.ToInt64();class=$live.NativeClass;uia_control_type=$live.AutomationControlType;control_id=$live.NativeControlId;process_id=$live.NativeProcess;enabled=$live.Enabled;visible=$live.Visible;dialog_descendant=$live.InDialog;bounds=@($buttonBounds.Left,$buttonBounds.Top,$buttonBounds.Right,$buttonBounds.Bottom);hit_hwnd=$hit.ToInt64();point=@($point.X,$point.Y);method='verified_native_mouse_click'}
  [NativeAcceptance]::Click($point.X,$point.Y)
}
function Wait-PickerDismissal([IntPtr]$Dialog,$App,[hashtable]$Evidence) {
  $started=[DateTime]::UtcNow;$deadline=$started.AddSeconds(5)
  while($true) {
    $exists=[NativeAcceptance]::IsWindow($Dialog);$visible=[NativeAcceptance]::IsWindowVisible($Dialog)
    $foreground=[NativeAcceptance]::GetForegroundWindow();[uint32]$process=0
    [void][NativeAcceptance]::GetWindowThreadProcessId($foreground,[ref]$process)
    $popup=$foreground -ne $App.MainWindowHandle -and $process -eq $App.Id -and [NativeAcceptance]::GetAncestor($foreground,3) -eq $App.MainWindowHandle -and [NativeAcceptance]::IsWindowVisible($foreground)
    $appForeground=$foreground -eq $App.MainWindowHandle;$appEnabled=[NativeAcceptance]::IsWindowEnabled($App.MainWindowHandle)
    $dismissed=[NativeAcceptance]::PickerDismissed($exists,$visible,$popup,$appForeground,$appEnabled)
    $Evidence.picker_completion=[ordered]@{dialog_exists=$exists;dialog_visible=$visible;foreground_hwnd=$foreground.ToInt64();owned_popup_visible=$popup;app_foreground=$appForeground;app_enabled=$appEnabled;dialog_dismissed=$dismissed;elapsed_ms=[int]([DateTime]::UtcNow-$started).TotalMilliseconds}
    if($dismissed){return}
    if([DateTime]::UtcNow -ge $deadline){throw 'Owned Windows picker did not dismiss within 5 seconds'}
    Start-Sleep -Milliseconds 100
  }
}
function Capture-PickerFailure([IntPtr]$Dialog,$App,$Action,[hashtable]$Evidence) {
  $suffix="$($env:WMH_DESKTOP_ACCEPTANCE_PHASE)-$($Action.sequence)"
  try {
    [uint32]$process=0;[void][NativeAcceptance]::GetWindowThreadProcessId($Dialog,[ref]$process)
    if([NativeAcceptance]::IsWindow($Dialog) -and $process -eq $App.Id -and [NativeAcceptance]::GetAncestor($Dialog,3) -eq $App.MainWindowHandle){Capture-Handle $Dialog "owned-picker-failure-$suffix"}
  } catch {$Evidence.dialog_screenshot_error=$_.Exception.Message}
  try {
    $popup=[NativeAcceptance]::GetForegroundWindow();[uint32]$process=0
    [void][NativeAcceptance]::GetWindowThreadProcessId($popup,[ref]$process)
    if($popup -ne $Dialog -and $popup -ne $App.MainWindowHandle -and $process -eq $App.Id -and [NativeAcceptance]::GetAncestor($popup,3) -eq $App.MainWindowHandle -and [NativeAcceptance]::IsWindowVisible($popup)) {
      $class=[System.Text.StringBuilder]::new(256);[void][NativeAcceptance]::GetClassName($popup,$class,256)
      $Evidence.owned_popup=[ordered]@{hwnd=$popup.ToInt64();process_id=$process;class=$class.ToString();root_owner_hwnd=$App.MainWindowHandle.ToInt64();text=[NativeAcceptance]::ReadControlText($popup)}
      Capture-Handle $popup "owned-popup-failure-$suffix"
    }
  } catch {$Evidence.popup_capture_error=$_.Exception.Message}
  # Read only the previously verified filename edit, its parent and its host.
  # The text cap is 256 characters and each read has a 1000-ms native bound.
  if($Evidence.filename_native_edit) {
    $edit=[IntPtr]$Evidence.filename_native_edit.hwnd;$Evidence.filename_failure_text=@()
    foreach($handle in (@($edit,[NativeAcceptance]::GetParent($edit),[IntPtr]$Evidence.filename_host.hwnd) | Select-Object -Unique)) {
      try {
        [uint32]$process=0;[void][NativeAcceptance]::GetWindowThreadProcessId($handle,[ref]$process)
        if($process -eq $App.Id -and [NativeAcceptance]::IsChild($Dialog,$handle)) {
          $class=[System.Text.StringBuilder]::new(256);[void][NativeAcceptance]::GetClassName($handle,$class,256)
          $Evidence.filename_failure_text+=,[ordered]@{hwnd=$handle.ToInt64();class=$class.ToString();control_id=[NativeAcceptance]::GetDlgCtrlID($handle);text=[NativeAcceptance]::ReadControlText($handle)}
        }
      } catch {$Evidence.filename_readback_error=$_.Exception.Message}
    }
  }
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
  $point=[NativeAcceptance]::ClientClickPoint($rectangle,$origin,$Action.x,$Action.y,$Action.width,$Action.height)
  $work=[NativeAcceptance]::WorkArea($window);$actual=[NativeAcceptance+POINT]::new()
  $Evidence.client_click=[ordered]@{client=@($rectangle.Left,$rectangle.Top,$rectangle.Right,$rectangle.Bottom);origin=@($origin.X,$origin.Y);viewport=@($Action.width,$Action.height);requested=@($point.X,$point.Y);work_area=@($work.Left,$work.Top,$work.Right,$work.Bottom)}
  if(-not [NativeAcceptance]::SetCursorPos($point.X,$point.Y) -or -not [NativeAcceptance]::GetCursorPos([ref]$actual)){throw 'Cannot observe actual native pointer position'}
  $hit=[NativeAcceptance]::WindowFromPoint($actual);$hitRoot=[NativeAcceptance]::GetAncestor($hit,2);$foreground=[NativeAcceptance]::GetForegroundWindow()
  $Evidence.client_click.actual=@($actual.X,$actual.Y);$Evidence.client_click.hit_hwnd=$hit.ToInt64();$Evidence.client_click.hit_root=$hitRoot.ToInt64();$Evidence.client_click.app_hwnd=$window.ToInt64();$Evidence.client_click.foreground=$foreground.ToInt64()
  [NativeAcceptance]::ValidateClientClick($work,$point,$actual,$window,$foreground,($hit -eq $window -or $hitRoot -eq $window -or [NativeAcceptance]::IsChild($window,$hit)))
  [NativeAcceptance]::ClickPositioned()
  if($Action.kind -eq 'select-last'){[NativeAcceptance]::Key(0x23);[NativeAcceptance]::Key(0x0D);return}
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
  try {
    if($dialogProcess -ne $App.Id){throw 'Windows picker process does not match its app owner'}
    if($Action.kind -eq 'cancel-picker'){
      # A foreground HWND can exist before its controls are shown. Do not send
      # Escape into that construction gap or mistake hidden-before-show for close.
      $readyDeadline=[DateTime]::UtcNow.AddSeconds(5);$ready=$false
      while([DateTime]::UtcNow -lt $readyDeadline){
        $root=[System.Windows.Automation.AutomationElement]::FromHandle($dialog)
        $condition=[System.Windows.Automation.PropertyCondition]::new([System.Windows.Automation.AutomationElement]::AutomationIdProperty,'2')
        $buttons=@($root.FindAll([System.Windows.Automation.TreeScope]::Descendants,$condition))
        if($buttons.Count -gt 8){throw 'Cancel button inventory exceeds eight candidates'}
        $candidates=@();foreach($button in $buttons){$candidates+=,(Get-PickerButtonCandidate $button $dialog)}
        $visible=[NativeAcceptance]::IsWindowVisible($dialog);$enabled=[NativeAcceptance]::IsWindowEnabled($dialog)
        $Evidence.cancel_readiness=[ordered]@{dialog_visible=$visible;dialog_enabled=$enabled;candidates=$buttons.Count;ready=$false}
        $Evidence.cancel_readiness.controls=@($candidates | ForEach-Object {[ordered]@{hwnd=$_.Window.ToInt64();id=$_.AutomationId;class=$_.NativeClass;control_id=$_.NativeControlId;process_id=$_.NativeProcess;uia_process_id=$_.AutomationProcess;uia_enabled=$_.AutomationEnabled;enabled=$_.Enabled;visible=$_.Visible;dialog_descendant=$_.InDialog}})
        if($visible -and $enabled){
          try{[void][NativeAcceptance]::SelectPickerActionButton([NativePickerButton[]]$candidates,[uint32]$App.Id,2);$ready=$true}catch{$Evidence.cancel_readiness.last_unready=$_.Exception.Message}
        }
        if($ready){$Evidence.cancel_readiness.ready=$true;break}
        Start-Sleep -Milliseconds 100
      }
      if(-not $ready){throw 'Owned Windows Cancel button was not ready within 5 seconds'}
      Click-PickerAction $root $dialog $App $Evidence 2
      Wait-PickerDismissal $dialog $App $Evidence;return
    }
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
    Capture-Handle $dialog "owned-picker-before-open-$($env:WMH_DESKTOP_ACCEPTANCE_PHASE)-$($Action.sequence)"
    Click-PickerAction $root $dialog $App $Evidence 1
    Wait-PickerDismissal $dialog $App $Evidence
  } catch {
    $failure=$_.Exception.Message
    try {Capture-PickerFailure $dialog $App $Action $Evidence}
    catch {$Evidence.failure_capture_error=$_.Exception.Message}
    throw $failure
  }
}
# Disk inventory is read by the Windows process owner, independently of the
# renderer API. Only these newly generated fixture archives are ever inspected.
function Save-SongFolderSnapshot([string]$Phase) {
  $root=Join-Path $OutputDirectory 'Scores';$rows=@()
  foreach($area in $(if($Scenario -in @('clean-song','vsq-song','performance-song')){@('clean-songs','clean-backups','imports','import-backups')}elseif($Scenario -eq 'bulk-import'){@('songs','backups','imports','import-backups')}else{@('songs','backups')})) {
    $directory=Join-Path $root $area
    if(-not (Test-Path -LiteralPath $directory -PathType Container)){throw 'Isolated score archive directory is missing'}
    foreach($file in (Get-ChildItem -LiteralPath $directory -Recurse -Force | Sort-Object FullName)) {
      if(($file.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0){throw 'Reparse points cannot be acceptance artifacts'}
      if(-not $file.PSIsContainer) {
        $relative=$file.FullName.Substring($root.Length+1).Replace('\','/')
        $rows+=,[ordered]@{path=$relative;sha256=(Get-FileHash -LiteralPath $file.FullName -Algorithm SHA256).Hash.ToLower();bytes=$file.Length}
      }
    }
  }
  Save-Json @{version=1;files=$rows} (Join-Path $OutputDirectory "snapshot-$Phase.json")
}
function Rotate-SongFolderProfile([string]$Phase) {
  $profile=Join-Path $OutputDirectory 'webview-profile'
  if(Test-Path -LiteralPath $profile) {
    $preserved=Join-Path $OutputDirectory "prior-profile-$Phase"
    $deadline=[DateTime]::UtcNow.AddSeconds(10)
    while($true) {
      try { Move-Item -LiteralPath $profile -Destination $preserved -ErrorAction Stop;break }
      catch { if([DateTime]::UtcNow -ge $deadline){throw 'Previous WebView profile could not be isolated after normal EXE close'};Start-Sleep -Milliseconds 200 }
    }
  }
  if(Test-Path -LiteralPath $profile){throw 'Fresh profile precondition failed'}
}
$previousDirectory=$env:WMH_DESKTOP_SMOKE_DIR;$previousPhase=$env:WMH_DESKTOP_ACCEPTANCE_PHASE
$env:WMH_DESKTOP_SMOKE_DIR=$OutputDirectory
$native=[ordered]@{version=1;source_sha=(git rev-parse HEAD);source_tree=(git rev-parse 'HEAD^{tree}');executable_sha256=(Get-FileHash $Executable -Algorithm SHA256).Hash.ToLower();executable_bytes=(Get-Item $Executable).Length;os=[System.Environment]::OSVersion.VersionString;profile_reused=$true;phases=@();ok=$false}
$app=$null;$blockedStage=$false;$blockedStagePath=$null;$preservedStagePath=$null
$nativeReportName=if($Scenario -eq 'performance-song'){'native-performance-song.json'}elseif($Scenario -eq 'vsq-song'){'native-vsq-song.json'}elseif($Scenario -eq 'clean-song'){'native-clean-song.json'}elseif($Scenario -eq 'bulk-import'){'native-bulk-import.json'}elseif($Scenario -eq 'song-folder'){'native-song-folder.json'}else{'native-acceptance.json'}
$phases=if($Scenario -eq 'performance-song'){@('performance-seed','performance-controls','performance-restart')}elseif($Scenario -eq 'vsq-song'){@('vsq-seed','vsq-restart')}elseif($Scenario -eq 'clean-song'){@('clean-seed','clean-restart')}elseif($Scenario -eq 'bulk-import'){@('bulk-seed','bulk-restart','bulk-failure')}elseif($Scenario -eq 'song-folder'){@('folder-seed','folder-restart','folder-failure')}else{@('seed','restart','close-active','reopen')}
if($Scenario -in @('song-folder','bulk-import','clean-song','vsq-song','performance-song')){$native.profile_reused=$false;$native.scenario=$Scenario;$native.directory=Join-Path $OutputDirectory 'Scores'}
try {
  foreach($phase in $phases) {
    if($Scenario -in @('song-folder','bulk-import','clean-song','vsq-song','performance-song')) {
      Rotate-SongFolderProfile $phase
      if($phase -in @('folder-failure','bulk-failure')) {
        $stageName=if($phase -eq 'bulk-failure'){'.import-staging'}else{'.staging'}
        $stage=Join-Path $OutputDirectory "Scores/$stageName"
        $blockedStagePath=$stage;$preservedStagePath=Join-Path $OutputDirectory "Scores/$stageName-preserved"
        if(-not (Test-Path -LiteralPath $stage -PathType Container) -or @(Get-ChildItem -LiteralPath $stage -Force).Count -ne 0){throw 'Failure injection requires our empty isolated staging directory'}
        Move-Item -LiteralPath $stage -Destination $preservedStagePath
        $blockedStage=$true;[IO.File]::WriteAllText($stage,'Isolated acceptance write blocker')
      }
    }
    $env:WMH_DESKTOP_ACCEPTANCE_PHASE=$phase
    $app=Start-Process -FilePath $Executable -PassThru -RedirectStandardError (Join-Path $OutputDirectory "stderr-$phase.log")
    $phaseStart=[DateTime]::UtcNow;$deadline=$phaseStart.AddSeconds(240);$sequence=1;$reportDeliveryWatch=$null
    $reportFile=Join-Path $OutputDirectory "renderer-$phase.json"
    while(-not (Test-Path $reportFile)) {
      $app.Refresh();if($app.HasExited){throw "Process exited before $phase evidence: $($app.ExitCode)"}
      if([DateTime]::UtcNow -ge $deadline){throw "Native $phase exceeded 240 seconds"}
      if($Scenario -in @('bulk-import','clean-song','vsq-song','performance-song')) {
        $traceFile=Join-Path $OutputDirectory "trace-$phase.json"
        if(Test-Path $traceFile) {
          if((Get-Item -LiteralPath $traceFile).Length -gt 512KB){throw "Native $phase trace exceeds its bounded diagnostic size"}
          $trace=Get-Content -Raw $traceFile | ConvertFrom-Json
          $rejected=@($trace.events | Where-Object { $_.event.stage -eq 'renderer-report-rejected' -or $_.event.checkpoint.stage -eq 'renderer-report-failed' -or ($_.event.path -eq '/__desktop_smoke/report' -and $_.event.stage -eq 'reply-submitted' -and $_.event.status -ge 400) })
          if($rejected.Count -gt 0){$last=$rejected[-1].event;throw "Native $phase report delivery failed; see trace-$phase.json (status=$($last.status), code=$($last.code))"}
          $posting=@($trace.events | Where-Object { $_.event.path -eq '/__desktop_smoke/report' -and $_.event.stage -eq 'received' })
          if($posting.Count -gt 0 -and $null -eq $reportDeliveryWatch){$reportDeliveryWatch=[Diagnostics.Stopwatch]::StartNew()}
          if($null -ne $reportDeliveryWatch -and $reportDeliveryWatch.ElapsedMilliseconds -gt 30000){throw "Native $phase report delivery did not finish within 30 seconds; see trace-$phase.json"}
        }
      }
      $actionFile=Join-Path $OutputDirectory "action-$phase-$sequence.json"
      if(Test-Path $actionFile) {
        $action=Get-Content -Raw $actionFile | ConvertFrom-Json
        if($action.sequence -ne $sequence -or $sequence -gt 64){throw 'Out-of-order or over-limit native action'}
        $result=@{ok=$false}
        try{Native-Action $app $action $result;if($Scenario -in @('bulk-import','clean-song','vsq-song','performance-song')){Capture-Window $app "native-action-$phase-$sequence"};$result.ok=$true}catch{$result.error=$_.Exception.Message}
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
    if($Scenario -in @('song-folder','bulk-import','clean-song','vsq-song','performance-song')){$item.launched_new_process=$true;$item.profile_fresh=$true;$item.profile_reused=$false}
    $native.phases+=,$item;Save-Json $native (Join-Path $OutputDirectory $nativeReportName)
    if(-not $report.ok){throw "Native $phase failed: $($report.error)"}
    if($report.origin -ne 'https://wmh.localhost'){throw 'Origin/profile continuity changed'}
    if($listeners.Count -ne 0){throw 'Native EXE unexpectedly opened a TCP listener'}
    $closeStart=[DateTime]::UtcNow
    if(-not $app.CloseMainWindow() -or -not $app.WaitForExit(10000)){throw "Normal close timed out during $phase"}
    if($app.ExitCode -ne 0){throw "Normal close failed during $phase : $($app.ExitCode)"}
    $item.normal_close=$true;$item.close_seconds=([DateTime]::UtcNow-$closeStart).TotalSeconds
    Save-Json $native (Join-Path $OutputDirectory $nativeReportName);$app=$null
    if($Scenario -in @('song-folder','bulk-import','clean-song','vsq-song','performance-song')){Save-SongFolderSnapshot $phase}
  }
  if($Scenario -in @('song-folder','bulk-import','clean-song','vsq-song','performance-song')) {
    # Restore only the test-owned blocker; no user folder or permissions change.
    if($blockedStage){Remove-Item -LiteralPath $blockedStagePath;Move-Item -LiteralPath $preservedStagePath -Destination $blockedStagePath;$blockedStage=$false}
    $native.ok=$true;Save-Json $native (Join-Path $OutputDirectory $nativeReportName)
    $verifier=if($Scenario -eq 'performance-song'){'verify-native-performance-song-evidence.mjs'}elseif($Scenario -eq 'vsq-song'){'verify-native-vsq-song-evidence.mjs'}elseif($Scenario -eq 'clean-song'){'verify-native-clean-song-evidence.mjs'}elseif($Scenario -eq 'bulk-import'){'verify-native-bulk-import-evidence.mjs'}else{'verify-native-song-folder-evidence.mjs'}
    & node (Join-Path $PSScriptRoot $verifier) $OutputDirectory
    if($LASTEXITCODE -ne 0){throw 'Native song-folder disk/backup/profile verification failed'}
    if($Scenario -eq 'performance-song'){Write-Output 'Native complete performance explicit-choice, independent controls, exact export and fresh-process restart gates passed.'}
    elseif($Scenario -eq 'vsq-song'){Write-Output 'Native VSQ explicit-choice, reference scheduling, exact following, input separation, export and restart gates passed.'}
    elseif($Scenario -eq 'clean-song'){Write-Output 'Native complete clean song, decoded media, exact export/reimport and new-process persistence gates passed.'}
    else {Write-Output 'Native disk archives, clean-profile restart, saved selection/audition, navigation and isolated failed save gates passed.'}
  } else {
    & node (Join-Path $PSScriptRoot 'verify-desktop-evidence.mjs') $OutputDirectory
    if($LASTEXITCODE -ne 0){throw 'Actual downloaded-file verification failed'}
    & node (Join-Path $PSScriptRoot 'verify-reference-native-evidence.mjs') $OutputDirectory
    if($LASTEXITCODE -ne 0){throw 'Actual native reference source/score/take verification failed'}
    $native.ok=$true;Save-Json $native (Join-Path $OutputDirectory $nativeReportName)
    Write-Output 'Native file import/export, exact backups, same-profile restart, keyboard/free/history, navigation and normal/active close gates passed.'
  }
} catch {
  $failure=$_.Exception.Message
  if($null -ne $app -and -not $app.HasExited){try{Capture-Window $app "native-failure-$phase"}catch{}}
  $native.ok=$false;$native.error=$failure;Save-Json $native (Join-Path $OutputDirectory $nativeReportName);throw
} finally {
  if($null -ne $app -and -not $app.HasExited){Stop-Process -Id $app.Id}
  if($blockedStage) {
    $stage=$blockedStagePath
    if(Test-Path -LiteralPath $stage -PathType Leaf){Remove-Item -LiteralPath $stage}
    if(-not (Test-Path -LiteralPath $stage)){Move-Item -LiteralPath $preservedStagePath -Destination $stage}
  }
  $env:WMH_DESKTOP_SMOKE_DIR=$previousDirectory;$env:WMH_DESKTOP_ACCEPTANCE_PHASE=$previousPhase
}
