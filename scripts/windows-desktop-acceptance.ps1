param(
  [Parameter(Mandatory=$true)][string]$Executable,
  [string]$OutputDirectory='desktop-acceptance',
  [ValidateSet('desktop','song-folder','bulk-import','clean-song','vsq-song','performance-song','pitch-bend','authoring','vsq-authoring','basic-key','complete-practice','canonical-practice','skin','library-catalog','live-tone-navigation')][string]$Scenario='desktop'
)
$ErrorActionPreference='Stop'
$Executable=(Resolve-Path $Executable).Path
$Repository=(Resolve-Path (Join-Path $PSScriptRoot '..')).Path
if (Test-Path $OutputDirectory) { throw 'Use a fresh acceptance directory for this exact executable' }
New-Item -ItemType Directory $OutputDirectory | Out-Null
$OutputDirectory=(Resolve-Path $OutputDirectory).Path
$Fixtures=Join-Path $OutputDirectory 'fixtures'
New-Item -ItemType Directory $Fixtures | Out-Null
$fixtureNames=if($Scenario -in @('bulk-import','clean-song','vsq-song','performance-song','pitch-bend','authoring','vsq-authoring','basic-key','complete-practice','canonical-practice','skin','library-catalog','live-tone-navigation')){@()}elseif($Scenario -eq 'song-folder'){@('folder-original.json','folder-conflict.json')}else{@('original-duet.musicxml','original-duet.mxl','midi-original-ppq.mid','original-reference-overlap.mid','jianpu-original-steps.jianpu')}
foreach($name in $fixtureNames) {
  Copy-Item (Join-Path $Repository "tests/fixtures/$name") (Join-Path $Fixtures $name)
}
if($Scenario -eq 'skin') {
  & node (Join-Path $PSScriptRoot 'prepare-native-skin-fixtures.mjs') $Fixtures
  if($LASTEXITCODE -ne 0){throw 'Original skin fixture generation failed'}
}
if($Scenario -eq 'library-catalog') {
  & node (Join-Path $PSScriptRoot 'prepare-library-catalog-acceptance.mjs') $Fixtures
  if($LASTEXITCODE -ne 0){throw 'Original library-catalog fixture generation failed'}
}
if($Scenario -eq 'bulk-import') {
  & node (Join-Path $PSScriptRoot 'prepare-bulk-import-fixtures.mjs') $Fixtures
  if($LASTEXITCODE -ne 0){throw 'Original bulk-import fixture generation failed'}
}
if($Scenario -eq 'vsq-authoring') {
  & node (Join-Path $PSScriptRoot 'prepare-vsq-authoring-fixtures.mjs') $Fixtures
  if($LASTEXITCODE -ne 0){throw 'Original VSQ-authoring fixture generation failed'}
}
if($Scenario -eq 'live-tone-navigation') {
  & node (Join-Path $PSScriptRoot 'prepare-live-tone-navigation-fixtures.mjs') $Fixtures
  if($LASTEXITCODE -ne 0){throw 'Original native live-navigation fixture generation failed'}
}
if($Scenario -eq 'canonical-practice') {
  & node (Join-Path $PSScriptRoot 'prepare-canonical-practice-fixtures.mjs') $Fixtures
  if($LASTEXITCODE -ne 0){throw 'Original canonical-practice fixture generation failed'}
}
if($Scenario -eq 'complete-practice') {
  & node (Join-Path $PSScriptRoot 'prepare-complete-practice-fixtures.mjs') $Fixtures
  if($LASTEXITCODE -ne 0){throw 'Original complete-practice fixture generation failed'}
}
if($Scenario -eq 'basic-key') {
  & node (Join-Path $PSScriptRoot 'prepare-basic-key-fixtures.mjs') $Fixtures
  if($LASTEXITCODE -ne 0){throw 'Original basic-key fixture generation failed'}
}
if($Scenario -eq 'authoring') {
  & node (Join-Path $PSScriptRoot 'prepare-song-authoring-fixtures.mjs') $Fixtures
  if($LASTEXITCODE -ne 0){throw 'Original song-authoring fixture generation failed'}
}
if($Scenario -eq 'pitch-bend') {
  & node (Join-Path $PSScriptRoot 'prepare-pitch-bend-fixtures.mjs') $Fixtures
  if($LASTEXITCODE -ne 0){throw 'Original pitch-bend fixture generation failed'}
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
if($Scenario -ceq 'live-tone-navigation'){Add-Type -Path @((Join-Path $PSScriptRoot 'windows-desktop-native.cs'),(Join-Path $PSScriptRoot 'windows-live-tone-navigation.cs'))}
else{Add-Type -Path (Join-Path $PSScriptRoot 'windows-desktop-native.cs')}
. (Join-Path $PSScriptRoot 'windows-desktop-profile.ps1')
. (Join-Path $PSScriptRoot 'windows-desktop-catalog-snapshot.ps1')
. (Join-Path $PSScriptRoot 'windows-desktop-geometry.ps1')
$catalogRendererGeometry=$null;$catalogReportedViewport=$null;$catalogCaptureGeometryFile=$null
function Save-Json($Value,[string]$Path) {
  $temporary="$Path.tmp"
  $Value | ConvertTo-Json -Depth 16 | Set-Content -Encoding utf8 $temporary
  Move-Item -Force $temporary $Path
}
function Capture-Handle([IntPtr]$Handle,[string]$Name,[switch]$ClientOnly,[string]$GeometryFile) {
  $rectangle=New-Object NativeAcceptance+RECT;$printFlags=2
  if($ClientOnly) {
    if($Scenario -cnotin @('library-catalog','complete-practice','canonical-practice')){throw 'Client-only acceptance capture requires a measured scenario'}
    if(-not [NativeAcceptance]::GetClientRect($Handle,[ref]$rectangle)){throw 'Cannot read catalog native client bounds'}
    if(($rectangle.Right-$rectangle.Left) -le 0 -or ($rectangle.Bottom-$rectangle.Top) -le 0 -or ($rectangle.Right-$rectangle.Left) -gt 8192 -or ($rectangle.Bottom-$rectangle.Top) -gt 8192 -or [int64]($rectangle.Right-$rectangle.Left)*($rectangle.Bottom-$rectangle.Top) -gt 16777216){throw 'Catalog actual client pixels exceed the finite capture bound'}
    # PW_CLIENTONLY | PW_RENDERFULLCONTENT. Keep the actual client pixels;
    # never resize or synthesize an image to satisfy the acceptance dimensions.
    $printFlags=3
  } elseif(-not [NativeAcceptance]::GetWindowRect($Handle,[ref]$rectangle)) { throw 'Cannot read native window bounds' }
  $bitmap=New-Object System.Drawing.Bitmap(($rectangle.Right-$rectangle.Left),($rectangle.Bottom-$rectangle.Top))
  $graphics=[System.Drawing.Graphics]::FromImage($bitmap);$device=$graphics.GetHdc()
  try { if(-not [NativeAcceptance]::PrintWindow($Handle,$device,$printFlags)){throw 'Native screenshot failed'} }
  finally { $graphics.ReleaseHdc($device);$graphics.Dispose() }
  try {
    $bitmap.Save((Join-Path $OutputDirectory "$Name.png"),[System.Drawing.Imaging.ImageFormat]::Png)
    if($Scenario -eq 'library-catalog') {
      $capture=Get-Item -LiteralPath (Join-Path $OutputDirectory "$Name.png") -Force
      if($capture.Length -le 0 -or $capture.Length -gt 16MB -or ($capture.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0){throw 'Catalog screenshot must be a bounded ordinary PNG'}
      $association=Get-CatalogCaptureAssociation $Name $env:WMH_DESKTOP_ACCEPTANCE_PHASE -ClientOnly:$ClientOnly -GeometryFile $GeometryFile
      $row=[ordered]@{file="$Name.png";bytes=$capture.Length;sha256=(Get-FileHash -LiteralPath $capture.FullName -Algorithm SHA256).Hash.ToLowerInvariant();width=$bitmap.Width;height=$bitmap.Height}
      foreach($key in $association.metadata.Keys){$row[$key]=$association.metadata[$key]}
      $native[$association.manifest]+=,$row
    }
  }
  finally { $bitmap.Dispose() }
}
function Capture-Window($App,[string]$Name) {
  if($Scenario -cin @('library-catalog','complete-practice','canonical-practice')) {
    $script:catalogCaptureGeometryFile="geometry-$Name.json"
    $geometry=Get-NativeWindowGeometry $App $env:WMH_DESKTOP_ACCEPTANCE_PHASE $Name $catalogRendererGeometry $catalogReportedViewport
    Save-Json $geometry (Join-Path $OutputDirectory $catalogCaptureGeometryFile)
  }
  Capture-Handle $App.MainWindowHandle $Name -ClientOnly:($Scenario -cin @('library-catalog','complete-practice','canonical-practice')) -GeometryFile $catalogCaptureGeometryFile
}
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
  if($Action.kind -ceq 'picker' -and $Action.file -cin @('skin-original-score.json','skin-original.json','checker.png')) {
    if($Scenario -cne 'skin' -or $env:WMH_DESKTOP_ACCEPTANCE_PHASE -cne 'skin-seed'){throw 'Skin fixtures require the skin seed phase'}
  }
  $canonicalNumericKeys=$null
  if($Action.kind -cin @('canonical-range-start','canonical-range-end','canonical-tempo')) {
    if($Scenario -cne 'canonical-practice'){throw 'Canonical numeric edits require the canonical scenario'}
    $canonicalNumericKeys=[NativeAcceptance]::CanonicalNumericKeys($env:WMH_DESKTOP_ACCEPTANCE_PHASE,[string]$Action.kind)
  }
  if($Action.kind -ceq 'picker' -and $Action.file -cin @('canonical-practice-original.json','canonical-practice-original.musicxml')) {
    if($Scenario -cne 'canonical-practice' -or $env:WMH_DESKTOP_ACCEPTANCE_PHASE -cnotin @('canonical-practice-seed','canonical-practice-controls','canonical-practice-restart')){throw 'Canonical fixtures require the canonical scenario and phase'}
  }
  if($Action.kind -ceq 'picker' -and $Action.file -ceq 'live-tone-navigation-original.json') {
    if($Scenario -cne 'live-tone-navigation' -or -not [NativeLiveToneNavigationKey]::IsPhase($env:WMH_DESKTOP_ACCEPTANCE_PHASE)){throw 'Live-navigation fixture requires its separate scenario and phase'}
  }
  if($Action.kind -ceq 'catalog-snapshot-before') {
    if($Scenario -cne 'library-catalog' -or $env:WMH_DESKTOP_ACCEPTANCE_PHASE -cne 'catalog-seed'){throw 'Catalog snapshot requires the catalog seed phase'}
    $snapshot=Join-Path $OutputDirectory 'snapshot-catalog-before.json'
    if(Test-Path -LiteralPath $snapshot){throw 'Catalog before snapshot already exists'}
    Save-Json (Get-CatalogAcceptanceSnapshot (Join-Path $OutputDirectory 'Scores') -BeforeBootstrap) $snapshot
    $Evidence.snapshot='snapshot-catalog-before.json'
    return
  }
  $App.Refresh();$window=$App.MainWindowHandle
  if($window -eq [IntPtr]::Zero){throw 'Application window disappeared'}
  if($Action.kind -cin @('live-key-r-down','live-key-r-up')) {
    if($Scenario -cne 'live-tone-navigation'){throw 'Fixed R actions require the live-navigation scenario'}
    $foreground=[NativeAcceptance]::GetForegroundWindow();$enabled=[NativeAcceptance]::IsWindowEnabled($window)
    $before=[NativeLiveToneNavigationKey]::Held;$heldMilliseconds=[NativeLiveToneNavigationKey]::HeldMilliseconds
    if($Action.kind -ceq 'live-key-r-down'){[NativeLiveToneNavigationKey]::Down($env:WMH_DESKTOP_ACCEPTANCE_PHASE,$window,$foreground,[uint32]$App.Id,$enabled)}
    else{[NativeLiveToneNavigationKey]::Up($env:WMH_DESKTOP_ACCEPTANCE_PHASE,$window,$foreground,[uint32]$App.Id,$enabled)}
    $Evidence.native_key=[ordered]@{app_hwnd=$window.ToInt64();foreground=$foreground.ToInt64();app_process_id=$App.Id;app_enabled=$enabled;code='KeyR';virtual_key=0x52;focus_reacquired=$false;pointer_clicked=$false;held_before=$before;held_after=[NativeLiveToneNavigationKey]::Held;held_ms=$heldMilliseconds}
    return
  }
  if($Action.kind -eq 'key-c5') {
    # Play already acquired the owned foreground window; the renderer prepared
    # stage focus before its timing gate. Fail if ownership changed, never spend
    # the source onset window reacquiring it or clicking the stage again.
    $foreground=[NativeAcceptance]::GetForegroundWindow();$enabled=[NativeAcceptance]::IsWindowEnabled($window)
    if($foreground -ne $window -or -not $enabled){throw 'Prepared C5 app foreground ownership was lost'}
    $Evidence.native_key=[ordered]@{app_hwnd=$window.ToInt64();foreground=$foreground.ToInt64();app_process_id=$App.Id;app_enabled=$enabled;code='Digit2';virtual_key=0x32;hold_ms=40;focus_reacquired=$false;pointer_clicked=$false}
    [NativeAcceptance]::HeldPerformanceKey(0x32);return
  }
  if($Action.kind -eq 'toggle-follow') {
    # The renderer owns focus on the actual Follow checkbox. Space uses its
    # native activation behavior even if asynchronous engraving moves it.
    $foreground=[NativeAcceptance]::GetForegroundWindow();$enabled=[NativeAcceptance]::IsWindowEnabled($window)
    if($foreground -ne $window -or -not $enabled){throw 'Prepared Follow app foreground ownership was lost'}
    $Evidence.native_key=[ordered]@{app_hwnd=$window.ToInt64();foreground=$foreground.ToInt64();app_process_id=$App.Id;app_enabled=$enabled;code='Space';virtual_key=0x20;focus_reacquired=$false;pointer_clicked=$false}
    [NativeAcceptance]::Key(0x20);return
  }
  if($Action.kind -eq 'key-ds4') {
    # Closed VSQ source key: the count-in must prepare stage focus beforehand.
    # Never click or reacquire foreground ownership inside the onset window.
    $foreground=[NativeAcceptance]::GetForegroundWindow();$enabled=[NativeAcceptance]::IsWindowEnabled($window)
    if($foreground -ne $window -or -not $enabled){throw 'Prepared VSQ D#4 app foreground ownership was lost'}
    $Evidence.native_key=[ordered]@{app_hwnd=$window.ToInt64();foreground=$foreground.ToInt64();app_process_id=$App.Id;app_enabled=$enabled;code='KeyU';virtual_key=0x55;hold_ms=40;focus_reacquired=$false;pointer_clicked=$false}
    [NativeAcceptance]::HeldPerformanceKey(0x55);return
  }
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
  if($null -ne $canonicalNumericKeys) {
    $foreground=[NativeAcceptance]::GetForegroundWindow();$enabled=[NativeAcceptance]::IsWindowEnabled($window)
    if($foreground -ne $window -or -not $enabled){throw 'Canonical numeric app foreground ownership was lost'}
    $Evidence.native_numeric=[ordered]@{app_hwnd=$window.ToInt64();foreground=$foreground.ToInt64();app_process_id=$App.Id;app_enabled=$enabled;kind=$Action.kind;method='fixed_ctrl_a_digits_tab';select_all_virtual_keys=@(0x11,0x41);digit_virtual_keys=@($canonicalNumericKeys);commit_virtual_key=0x09;pointer_clicked=$true;completed=$false}
    [NativeAcceptance]::CanonicalNumericEdit($env:WMH_DESKTOP_ACCEPTANCE_PHASE,[string]$Action.kind)
    $Evidence.native_numeric.completed=$true
    return
  }
  if($Action.kind -eq 'select-first'){[NativeAcceptance]::Key(0x24);[NativeAcceptance]::Key(0x0D);return}
  if($Action.kind -eq 'select-second'){[NativeAcceptance]::Key(0x24);[NativeAcceptance]::Key(0x28);[NativeAcceptance]::Key(0x0D);return}
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
  if($Scenario -eq 'library-catalog') {
    Save-Json (Get-CatalogAcceptanceSnapshot $root) (Join-Path $OutputDirectory "snapshot-$Phase.json")
    return
  }
  foreach($area in $(if($Scenario -in @('clean-song','vsq-song','performance-song','pitch-bend','authoring','vsq-authoring','basic-key','complete-practice')){@('clean-songs','clean-backups','imports','import-backups')}elseif($Scenario -eq 'bulk-import'){@('songs','backups','imports','import-backups')}else{@('songs','backups')})) {
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
$previousDirectory=$env:WMH_DESKTOP_SMOKE_DIR;$previousPhase=$env:WMH_DESKTOP_ACCEPTANCE_PHASE
$env:WMH_DESKTOP_SMOKE_DIR=$OutputDirectory
$native=[ordered]@{version=1;source_sha=(git rev-parse HEAD);source_tree=(git rev-parse 'HEAD^{tree}');executable_sha256=(Get-FileHash $Executable -Algorithm SHA256).Hash.ToLower();executable_bytes=(Get-Item $Executable).Length;os=[System.Environment]::OSVersion.VersionString;profile_reused=$true;phases=@();ok=$false}
$app=$null;$blockedStage=$false;$blockedStagePath=$null;$preservedStagePath=$null;$profileSelection=$null
$nativeReportName=if($Scenario -eq 'live-tone-navigation'){'native-live-tone-navigation.json'}elseif($Scenario -eq 'library-catalog'){'native-library-catalog.json'}elseif($Scenario -eq 'skin'){'native-skin.json'}elseif($Scenario -eq 'canonical-practice'){'native-canonical-practice.json'}elseif($Scenario -eq 'complete-practice'){'native-complete-practice.json'}elseif($Scenario -eq 'basic-key'){'native-basic-key.json'}elseif($Scenario -eq 'vsq-authoring'){'native-vsq-authoring.json'}elseif($Scenario -eq 'authoring'){'native-song-authoring.json'}elseif($Scenario -eq 'pitch-bend'){'native-pitch-bend.json'}elseif($Scenario -eq 'performance-song'){'native-performance-song.json'}elseif($Scenario -eq 'vsq-song'){'native-vsq-song.json'}elseif($Scenario -eq 'clean-song'){'native-clean-song.json'}elseif($Scenario -eq 'bulk-import'){'native-bulk-import.json'}elseif($Scenario -eq 'song-folder'){'native-song-folder.json'}else{'native-acceptance.json'}
$phases=if($Scenario -eq 'live-tone-navigation'){@('live-navigation-settings-keyup','live-navigation-settings-navigation','live-navigation-authoring-keyup','live-navigation-authoring-navigation')}elseif($Scenario -eq 'library-catalog'){@('catalog-seed','catalog-restart','catalog-final')}elseif($Scenario -eq 'skin'){@('skin-seed','skin-restart','skin-default-restart')}elseif($Scenario -eq 'canonical-practice'){@('canonical-practice-seed','canonical-practice-controls','canonical-practice-restart')}elseif($Scenario -eq 'complete-practice'){@('complete-practice-seed','complete-practice-restart')}elseif($Scenario -eq 'basic-key'){@('basic-key-seed','basic-key-restart')}elseif($Scenario -eq 'vsq-authoring'){@('vsq-authoring-seed','vsq-authoring-restart')}elseif($Scenario -eq 'authoring'){@('authoring-seed','authoring-restart')}elseif($Scenario -eq 'pitch-bend'){@('pitch-bend-seed','pitch-bend-restart')}elseif($Scenario -eq 'performance-song'){@('performance-seed','performance-controls','performance-restart')}elseif($Scenario -eq 'vsq-song'){@('vsq-seed','vsq-restart')}elseif($Scenario -eq 'clean-song'){@('clean-seed','clean-restart')}elseif($Scenario -eq 'bulk-import'){@('bulk-seed','bulk-restart','bulk-failure')}elseif($Scenario -eq 'song-folder'){@('folder-seed','folder-restart','folder-failure')}else{@('seed','restart','close-active','reopen')}
if($Scenario -in @('song-folder','bulk-import','clean-song','vsq-song','performance-song','pitch-bend','authoring','vsq-authoring','basic-key','complete-practice','canonical-practice','skin','library-catalog','live-tone-navigation')){$native.profile_reused=$false;$native.scenario=$Scenario;$native.directory=Join-Path $OutputDirectory 'Scores'}
try {
if($Scenario -in @('complete-practice','canonical-practice')){$native.profile_reused=$true}
if($Scenario -eq 'skin') {
  $native.profile_reused=$true
  $skinBindingJson=& node (Join-Path $PSScriptRoot 'native-skin-source-evidence.mjs') $Repository
  if($LASTEXITCODE -ne 0){throw 'Cannot bind skin acceptance to its frozen source'}
  $skinBinding=ConvertFrom-Json -InputObject $skinBindingJson -AsHashtable
  if($skinBinding.source_sha -cne $native.source_sha -or $skinBinding.source_tree -cne $native.source_tree){throw 'Skin acceptance source changed before launch'}
  $native.source_hashes=$skinBinding.source_hashes
}
if($Scenario -eq 'live-tone-navigation') {
  $liveBindingJson=& node (Join-Path $PSScriptRoot 'verify-native-live-tone-navigation-evidence.mjs') --source-binding $Repository
  if($LASTEXITCODE -ne 0){throw 'Cannot bind native live-navigation acceptance to its frozen source'}
  $liveBinding=ConvertFrom-Json -InputObject $liveBindingJson -AsHashtable
  if($liveBinding.source_sha -cne $native.source_sha -or $liveBinding.source_tree -cne $native.source_tree){throw 'Native live-navigation source changed before launch'}
  $native.source_hashes=$liveBinding.source_hashes
}
if($Scenario -eq 'canonical-practice') {
  $canonicalBindingJson=& node (Join-Path $PSScriptRoot 'canonical-practice-source-evidence.mjs') $Repository
  if($LASTEXITCODE -ne 0){throw 'Cannot bind canonical acceptance to its frozen source'}
  $canonicalBinding=ConvertFrom-Json -InputObject $canonicalBindingJson -AsHashtable
  if($canonicalBinding.source_sha -cne $native.source_sha -or $canonicalBinding.source_tree -cne $native.source_tree){throw 'Canonical acceptance source changed before launch'}
  $native.source_hashes=$canonicalBinding.source_hashes
}
if($Scenario -eq 'library-catalog') {
  $native.profile_reused=$true;$native.screenshots=@();$native.diagnostic_screenshots=@();$native.requested_viewport=[ordered]@{width=1280;height=720};$native.minimum_viewport=[ordered]@{width=900;height=640}
  $sourceNames=& node --input-type=module -e 'import {pathToFileURL} from "node:url"; const module=await import(pathToFileURL(process.argv[2])); console.log(JSON.stringify(module.CATALOG_SOURCE_FILES));' -- catalog-source-list (Join-Path $PSScriptRoot 'verify-library-catalog-acceptance.mjs')
  if($LASTEXITCODE -ne 0){throw 'Cannot read catalog acceptance source allowlist'}
  $sourceNames=ConvertFrom-Json -InputObject $sourceNames
  # The closed catalog inventory includes Mod, skin and membership-verifier dependencies.
  if($sourceNames.Count -ne 52 -or @($sourceNames | Sort-Object -Unique).Count -ne 52){throw 'Catalog source allowlist must contain exactly 52 distinct modules'}
  $native.source_hashes=[ordered]@{}
  foreach($name in $sourceNames) {
    if($name -cnotmatch '^[A-Za-z0-9_.-]+(/[A-Za-z0-9_.-]+)+$' -or $name.Split('/') -contains '..'){throw 'Catalog source allowlist contains an unsafe path'}
    $sourceFile=Get-Item -LiteralPath (Join-Path $Repository $name) -Force -ErrorAction Stop
    if($sourceFile.PSIsContainer -or ($sourceFile.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0 -or $sourceFile.Length -gt 4MB){throw 'Catalog source module must be a bounded ordinary file'}
    $native.source_hashes[$name]=(Get-FileHash -LiteralPath $sourceFile.FullName -Algorithm SHA256).Hash.ToLowerInvariant()
  }
  $native.run_id=[guid]::NewGuid().ToString('D')
  $config=[ordered]@{version=1;viewport_contract=[ordered]@{kind='native-work-area';requested=$native.requested_viewport;minimum=$native.minimum_viewport};run_id=$native.run_id;source_binding=[ordered]@{source_sha=$native.source_sha;source_tree=$native.source_tree;source_hashes=$native.source_hashes};fixture=(Read-AcceptanceJsonSnapshot -Path (Join-Path $Fixtures 'catalog-fixtures.json') -MaximumBytes 128KB)}
  $configPath=Join-Path $OutputDirectory 'catalog-config.json'
  Save-Json $config $configPath
  if((Get-Item -LiteralPath $configPath).Length -gt 128KB){throw 'Catalog configuration exceeds 128 KiB'}
  $native.config_sha256=(Get-FileHash -LiteralPath $configPath -Algorithm SHA256).Hash.ToLowerInvariant()
}
  foreach($phase in $phases) {
    $profileSelection=Get-AcceptanceProfile $OutputDirectory $phase
    $native.profile_launch=$profileSelection
    Save-Json $native (Join-Path $OutputDirectory $nativeReportName)
    $profileSelection=Assert-AcceptanceProfileLaunch $OutputDirectory $phase
    $native.profile_launch=$profileSelection
    Save-Json $native (Join-Path $OutputDirectory $nativeReportName)
    if($Scenario -in @('song-folder','bulk-import','clean-song','vsq-song','performance-song','pitch-bend','authoring','vsq-authoring','basic-key','complete-practice','canonical-practice','skin','library-catalog','live-tone-navigation')) {
      if($phase -in @('folder-failure','bulk-failure')) {
        $stageName=if($phase -eq 'bulk-failure'){'.import-staging'}else{'.staging'}
        $stage=Join-Path $OutputDirectory "Scores/$stageName"
        $blockedStagePath=$stage;$preservedStagePath=Join-Path $OutputDirectory "Scores/$stageName-preserved"
        if(-not (Test-Path -LiteralPath $stage -PathType Container) -or @(Get-ChildItem -LiteralPath $stage -Force).Count -ne 0){throw 'Failure injection requires our empty isolated staging directory'}
        Move-Item -LiteralPath $stage -Destination $preservedStagePath
        $blockedStage=$true;[IO.File]::WriteAllText($stage,'Isolated acceptance write blocker')
      }
    }
    $catalogRendererGeometry=$null;$catalogReportedViewport=$null;$report=$null
    $env:WMH_DESKTOP_ACCEPTANCE_PHASE=$phase
    $app=Start-Process -FilePath $Executable -PassThru -RedirectStandardError (Join-Path $OutputDirectory "stderr-$phase.log")
    $phaseStart=[DateTime]::UtcNow;$deadline=$phaseStart.AddSeconds(240);$sequence=1;$reportDeliveryWatch=$null
    $reportFile=Join-Path $OutputDirectory "renderer-$phase.json"
    $reportLimit=if($Scenario -eq 'bulk-import'){4MB}elseif($Scenario -in @('clean-song','vsq-song','performance-song','pitch-bend','authoring','vsq-authoring','basic-key','complete-practice','canonical-practice','skin','library-catalog','live-tone-navigation')){1MB}else{64KB}
    while($null -eq ($report=Read-AcceptanceJsonSnapshot -Path $reportFile -MaximumBytes $reportLimit -AllowPending)) {
      if($Scenario -ceq 'live-tone-navigation' -and [NativeLiveToneNavigationKey]::Held -and [NativeLiveToneNavigationKey]::HeldMilliseconds -gt 10000){throw 'Native test R exceeded its observed 10-second watchdog limit'}
      $app.Refresh();if($app.HasExited){throw "Process exited before $phase evidence: $($app.ExitCode); profile=$($profileSelection.profile_directory); see stderr-$phase.log"}
      if([DateTime]::UtcNow -ge $deadline){throw "Native $phase exceeded 240 seconds"}
      if($Scenario -in @('bulk-import','clean-song','vsq-song','performance-song','pitch-bend','authoring','vsq-authoring','basic-key','complete-practice','canonical-practice','skin','library-catalog','live-tone-navigation')) {
        $traceFile=Join-Path $OutputDirectory "trace-$phase.json"
        $trace=Read-AcceptanceJsonSnapshot -Path $traceFile -MaximumBytes 512KB -AllowPending
        if($null -ne $trace) {
          $rejected=@($trace.events | Where-Object { $_.event.stage -eq 'renderer-report-rejected' -or $_.event.checkpoint.stage -eq 'renderer-report-failed' -or ($_.event.path -eq '/__desktop_smoke/report' -and $_.event.stage -eq 'reply-submitted' -and $_.event.status -ge 400) })
          if($rejected.Count -gt 0){$last=$rejected[-1].event;throw "Native $phase report delivery failed; see trace-$phase.json (status=$($last.status), code=$($last.code))"}
          $posting=@($trace.events | Where-Object { $_.event.path -eq '/__desktop_smoke/report' -and $_.event.stage -eq 'received' })
          if($posting.Count -gt 0 -and $null -eq $reportDeliveryWatch){$reportDeliveryWatch=[Diagnostics.Stopwatch]::StartNew()}
          if($null -ne $reportDeliveryWatch -and $reportDeliveryWatch.ElapsedMilliseconds -gt 30000){throw "Native $phase report delivery did not finish within 30 seconds; see trace-$phase.json"}
        }
      }
      $actionFile=Join-Path $OutputDirectory "action-$phase-$sequence.json"
      $action=Read-AcceptanceJsonSnapshot -Path $actionFile -MaximumBytes 64KB -AllowPending
      if($null -ne $action) {
        $actionLimit=if($phase -ceq 'seed'){72}elseif($phase -in @('vsq-seed','vsq-restart','basic-key-seed','basic-key-restart','authoring-seed','authoring-restart','vsq-authoring-seed','vsq-authoring-restart','canonical-practice-seed')){80}elseif($Scenario -in @('performance-song','pitch-bend','bulk-import','song-folder')){75}else{64}
        if($action.sequence -ne $sequence -or $sequence -gt $actionLimit){throw 'Out-of-order or over-limit native action'}
        $catalogReportedViewport=@($action.width,$action.height)
        $result=@{ok=$false}
        try{Native-Action $app $action $result;if($Scenario -in @('bulk-import','clean-song','vsq-song','performance-song','pitch-bend','authoring','vsq-authoring','basic-key','complete-practice','canonical-practice','skin','library-catalog','live-tone-navigation') -and ($Scenario -cne 'live-tone-navigation' -or -not [NativeLiveToneNavigationKey]::Held)){Capture-Window $app "native-action-$phase-$sequence"};$result.ok=$true}catch{$result.error=$_.Exception.Message}
        Save-Json $result (Join-Path $OutputDirectory "result-$phase-$sequence.json")
        # A native modal can suspend the renderer, including its result poll.
        # Fail here after preserving the real action error instead of waiting
        # for the renderer to consume it and hiding it behind the phase limit.
        if(-not $result.ok){throw "Native $phase action $sequence ($($action.kind)) failed: $($result.error)"}
        $sequence++
      }
      Start-Sleep -Milliseconds 100
    }
    $app.Refresh()
    if($Scenario -ceq 'live-tone-navigation' -and [NativeLiveToneNavigationKey]::Held){throw 'Native live-navigation phase completed with a held test key'}
    if($Scenario -ceq 'library-catalog') {
      $catalogRendererGeometry=$report.geometry;$catalogReportedViewport=@($report.layout.width,$report.layout.height)
      # Preserve the first renderer failure; strict success capture must not mask it.
      if(-not $report.ok){throw "Native $phase failed: $($report.error)"}
    }
    Assert-AcceptanceProfileEvidence $OutputDirectory $profileSelection $app.Id
    Capture-Window $app "native-$phase"
    # One existing EXE-owned listener sample, not a network/security audit.
    $listeners=@(Get-NetTCPConnection -State Listen -ErrorAction Stop | Where-Object OwningProcess -eq $app.Id)
    $item=[ordered]@{phase=$phase;process_id=$app.Id;renderer_ok=$report.ok;renderer_origin=$report.origin;actions=$sequence-1;elapsed_seconds=([DateTime]::UtcNow-$phaseStart).TotalSeconds;executable_tcp_listeners=$listeners.Count;normal_close=$false}
    if($Scenario -ceq 'live-tone-navigation'){$item.live_key_held_at_close=[NativeLiveToneNavigationKey]::Held}
    $item.profile_directory=$profileSelection.profile_directory;$item.profile_absent_before_launch=$profileSelection.profile_absent_before_launch
    if($Scenario -in @('song-folder','bulk-import','clean-song','vsq-song','performance-song','pitch-bend','authoring','vsq-authoring','basic-key','complete-practice','canonical-practice','skin','library-catalog','live-tone-navigation')){$item.launched_new_process=$true;$item.profile_fresh=$true;$item.profile_reused=$false}
    if($Scenario -in @('complete-practice','canonical-practice')){$item.profile_fresh=$profileSelection.fresh_required;$item.profile_reused=$profileSelection.existing_required}
    if($Scenario -eq 'skin'){$item.profile_fresh=$profileSelection.fresh_required;$item.profile_reused=$profileSelection.existing_required}
    if($Scenario -eq 'library-catalog'){$item.profile_fresh=$profileSelection.fresh_required;$item.profile_reused=$profileSelection.existing_required;$item.geometry_file=$catalogCaptureGeometryFile}
    $native.phases+=,$item;Save-Json $native (Join-Path $OutputDirectory $nativeReportName)
    if(-not $report.ok){throw "Native $phase failed: $($report.error)"}
    if($report.origin -ne 'https://wmh.localhost'){throw 'Origin/profile continuity changed'}
    if($listeners.Count -ne 0){throw 'Native EXE unexpectedly opened a TCP listener'}
    $closeStart=[DateTime]::UtcNow
    if(-not $app.CloseMainWindow() -or -not $app.WaitForExit(10000)){throw "Normal close timed out during $phase"}
    if($app.ExitCode -ne 0){throw "Normal close failed during $phase : $($app.ExitCode)"}
    $item.normal_close=$true;$item.close_seconds=([DateTime]::UtcNow-$closeStart).TotalSeconds
    Save-Json $native (Join-Path $OutputDirectory $nativeReportName);$app=$null
    if($Scenario -in @('song-folder','bulk-import','clean-song','vsq-song','performance-song','pitch-bend','authoring','vsq-authoring','basic-key','complete-practice','canonical-practice','skin','library-catalog','live-tone-navigation')){Save-SongFolderSnapshot $phase}
  }
  if($Scenario -in @('song-folder','bulk-import','clean-song','vsq-song','performance-song','pitch-bend','authoring','vsq-authoring','basic-key','complete-practice','canonical-practice','skin','library-catalog','live-tone-navigation')) {
    # Restore only the test-owned blocker; no user folder or permissions change.
    if($blockedStage){Remove-Item -LiteralPath $blockedStagePath;Move-Item -LiteralPath $preservedStagePath -Destination $blockedStagePath;$blockedStage=$false}
    $native.ok=$true;Save-Json $native (Join-Path $OutputDirectory $nativeReportName)
    $verifier=if($Scenario -eq 'live-tone-navigation'){'verify-native-live-tone-navigation-evidence.mjs'}elseif($Scenario -eq 'library-catalog'){'verify-library-catalog-acceptance.mjs'}elseif($Scenario -eq 'skin'){'verify-native-skin-evidence.mjs'}elseif($Scenario -eq 'canonical-practice'){'verify-canonical-practice-evidence.mjs'}elseif($Scenario -eq 'complete-practice'){'verify-complete-practice-evidence.mjs'}elseif($Scenario -eq 'basic-key'){'verify-basic-key-evidence.mjs'}elseif($Scenario -eq 'vsq-authoring'){'verify-native-vsq-authoring-evidence.mjs'}elseif($Scenario -eq 'authoring'){'verify-native-song-authoring-evidence.mjs'}elseif($Scenario -eq 'pitch-bend'){'verify-native-pitch-bend-evidence.mjs'}elseif($Scenario -eq 'performance-song'){'verify-native-performance-song-evidence.mjs'}elseif($Scenario -eq 'vsq-song'){'verify-native-vsq-song-evidence.mjs'}elseif($Scenario -eq 'clean-song'){'verify-native-clean-song-evidence.mjs'}elseif($Scenario -eq 'bulk-import'){'verify-native-bulk-import-evidence.mjs'}else{'verify-native-song-folder-evidence.mjs'}
    if($Scenario -eq 'skin') {
      $previousSkinExecutable=$env:WMH_SKIN_EXECUTABLE
      try {
        $env:WMH_SKIN_EXECUTABLE=$Executable
        & node (Join-Path $PSScriptRoot $verifier) $OutputDirectory
        if($LASTEXITCODE -ne 0){throw 'Native skin persistence verification failed'}
      } finally {$env:WMH_SKIN_EXECUTABLE=$previousSkinExecutable}
    } elseif($Scenario -eq 'library-catalog') {
      $previousSourceSha=$env:WMH_SOURCE_SHA;$previousSourceTree=$env:WMH_SOURCE_TREE;$previousCatalogExecutable=$env:WMH_LIBRARY_CATALOG_EXECUTABLE
      try {
        $env:WMH_SOURCE_SHA=$native.source_sha;$env:WMH_SOURCE_TREE=$native.source_tree;$env:WMH_LIBRARY_CATALOG_EXECUTABLE=$Executable
        & node (Join-Path $PSScriptRoot $verifier) $OutputDirectory
        if($LASTEXITCODE -ne 0){throw 'Native library-catalog verification failed'}
      } finally {$env:WMH_SOURCE_SHA=$previousSourceSha;$env:WMH_SOURCE_TREE=$previousSourceTree;$env:WMH_LIBRARY_CATALOG_EXECUTABLE=$previousCatalogExecutable}
    } elseif($Scenario -eq 'live-tone-navigation') {
      $previousLiveExecutable=$env:WMH_LIVE_TONE_NAVIGATION_EXECUTABLE
      try {
        $env:WMH_LIVE_TONE_NAVIGATION_EXECUTABLE=$Executable
        & node (Join-Path $PSScriptRoot $verifier) $OutputDirectory
        if($LASTEXITCODE -ne 0){throw 'Native live-navigation verification failed'}
      } finally {$env:WMH_LIVE_TONE_NAVIGATION_EXECUTABLE=$previousLiveExecutable}
    } elseif($Scenario -eq 'canonical-practice') {
      $previousCanonicalExecutable=$env:WMH_CANONICAL_PRACTICE_EXECUTABLE
      try {
        $env:WMH_CANONICAL_PRACTICE_EXECUTABLE=$Executable
        & node (Join-Path $PSScriptRoot $verifier) $OutputDirectory
        if($LASTEXITCODE -ne 0){throw 'Native canonical-practice verification failed'}
      } finally {$env:WMH_CANONICAL_PRACTICE_EXECUTABLE=$previousCanonicalExecutable}
    } else {
      & node (Join-Path $PSScriptRoot $verifier) $OutputDirectory
      if($LASTEXITCODE -ne 0){throw 'Native song-folder disk/backup/profile verification failed'}
    }
    if($Scenario -eq 'live-tone-navigation'){Write-Output 'Native finite-window live-gate silence, trusted KeyR navigation and unchanged original take/source focused gates passed.'}
    elseif($Scenario -eq 'skin'){Write-Output 'Native original skin selection/default restarts and source/take preservation focused gates passed.'}
    elseif($Scenario -eq 'library-catalog'){Write-Output 'Native original catalog recovery, same-profile persistence, trusted controls and retained archive focused gates passed.'}
    elseif($Scenario -eq 'canonical-practice'){Write-Output 'Native original canonical practice, trusted controls and same-profile restart focused gates passed.'}
    elseif($Scenario -eq 'pitch-bend'){Write-Output 'Original pitch-bend source/receiver, unchanged human take and fresh-process focused gates passed.'}
    elseif($Scenario -eq 'vsq-authoring'){Write-Output 'Native original VSQ authoring, exact package export and fresh-process restart focused gates passed.'}
    elseif($Scenario -eq 'authoring'){Write-Output 'Native original source authoring, trusted title edits, exact package export and fresh-process restart gates passed.'}
    elseif($Scenario -eq 'performance-song'){Write-Output 'Native complete performance explicit-choice, independent controls, exact export and fresh-process restart gates passed.'}
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
  $firstError=$_;$failure=$firstError.Exception.Message
  $native.failure_details=[ordered]@{phase=$phase;profile_directory=$profileSelection.profile_directory;exception_type=$_.Exception.GetType().FullName;hresult=$_.Exception.HResult;error_id=$_.FullyQualifiedErrorId;category=[string]$_.CategoryInfo;position=$_.InvocationInfo.PositionMessage}
  # Release the owned test key before any synchronous diagnostic capture.
  # The polling watchdog is an observation bound, not an OS scheduling promise.
  if($Scenario -ceq 'live-tone-navigation') {
    try{$native.failure_details.live_key_released_before_diagnostics=[NativeLiveToneNavigationKey]::ReleaseIfHeld()}
    catch{$native.failure_details.live_key_cleanup_error=$_.Exception.Message}
  }
  if($Scenario -ceq 'library-catalog') {
    $native.failure_details.renderer_error=$report.error;$native.failure_details.renderer_layout=$report.layout;$native.failure_details.renderer_geometry=$report.geometry
    $diagnostics=New-NativeFailureDiagnostics $phase $failure {
      if($null -eq $app -or $app.HasExited){throw 'No live owned app remains for failure geometry'}
      Get-NativeWindowGeometry $app $phase 'failure' $report.geometry $catalogReportedViewport
    } {
      if($null -eq $app -or $app.HasExited){throw 'No live owned app remains for failure capture'}
      Capture-NativeFailurePixels $app $OutputDirectory "native-failure-$phase-raw"
    }
    $native.failure_details.diagnostic_file="diagnostic-$phase.json"
    try {Save-Json $diagnostics (Join-Path $OutputDirectory "diagnostic-$phase.json")} catch {$native.failure_details.diagnostic_write_error=$_.Exception.Message}
  } elseif($null -ne $app -and -not $app.HasExited -and ($Scenario -cne 'live-tone-navigation' -or -not [NativeLiveToneNavigationKey]::Held)){try{Capture-Window $app "native-failure-$phase"}catch{}}
  $native.ok=$false;$native.error=$failure
  try {Save-Json $native (Join-Path $OutputDirectory $nativeReportName)} catch {[Console]::Error.WriteLine("Could not persist failure report: $($_.Exception.Message)")}
  throw $firstError
} finally {
  try {if($Scenario -ceq 'live-tone-navigation'){[void][NativeLiveToneNavigationKey]::ReleaseIfHeld()}}
  finally {
    if($null -ne $app -and -not $app.HasExited){Stop-Process -Id $app.Id}
    if($blockedStage) {
      $stage=$blockedStagePath
      if(Test-Path -LiteralPath $stage -PathType Leaf){Remove-Item -LiteralPath $stage}
      if(-not (Test-Path -LiteralPath $stage)){Move-Item -LiteralPath $preservedStagePath -Destination $stage}
    }
    $env:WMH_DESKTOP_SMOKE_DIR=$previousDirectory;$env:WMH_DESKTOP_ACCEPTANCE_PHASE=$previousPhase
  }
}
