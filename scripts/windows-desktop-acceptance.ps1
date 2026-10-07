param(
  [Parameter(Mandatory=$true)][string]$Executable,
  [string]$OutputDirectory='desktop-acceptance',
  [ValidateSet('desktop','song-folder','bulk-import','clean-song','vsq-song','performance-song','pitch-bend','authoring','vsq-authoring','direct-midi','basic-key','complete-practice','canonical-practice','skin','library-catalog','live-tone-navigation','human-mod-timbre','build-diagnostics','assistance','pitch-mod','pitch-sources')][string]$Scenario='desktop'
)
$ErrorActionPreference='Stop'
$fixedLiveKeyScenario=$Scenario -cin @('live-tone-navigation','human-mod-timbre')
$Executable=(Resolve-Path $Executable).Path
$Repository=(Resolve-Path (Join-Path $PSScriptRoot '..')).Path
if (Test-Path $OutputDirectory) { throw 'Use a fresh acceptance directory for this exact executable' }
New-Item -ItemType Directory $OutputDirectory | Out-Null
$OutputDirectory=(Resolve-Path $OutputDirectory).Path
$Fixtures=Join-Path $OutputDirectory 'fixtures'
New-Item -ItemType Directory $Fixtures | Out-Null
$fixtureNames=if($Scenario -in @('bulk-import','clean-song','vsq-song','performance-song','pitch-bend','authoring','vsq-authoring','direct-midi','basic-key','complete-practice','canonical-practice','skin','library-catalog','live-tone-navigation','human-mod-timbre','build-diagnostics','assistance','pitch-mod','pitch-sources')){@()}elseif($Scenario -eq 'song-folder'){@('folder-original.json','folder-conflict.json')}else{@('original-duet.musicxml','original-duet.mxl','midi-original-ppq.mid','original-reference-overlap.mid','jianpu-original-steps.jianpu')}
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
if($Scenario -eq 'pitch-sources') {
  & node (Join-Path $PSScriptRoot 'native-pitch-sources-fixtures.mjs') $Fixtures
  if($LASTEXITCODE -ne 0){throw 'Original native source fixture generation failed'}
}
if($Scenario -eq 'pitch-mod') {
  & node (Join-Path $PSScriptRoot 'native-pitch-mod-fixtures.mjs') $Fixtures
  if($LASTEXITCODE -ne 0){throw 'Original pitch Mod fixture generation failed'}
}
if($Scenario -eq 'assistance') {
  & node (Join-Path $PSScriptRoot 'native-assistance-fixtures.mjs') $Fixtures
  if($LASTEXITCODE -ne 0){throw 'Original assistance fixture generation failed'}
}
if($Scenario -eq 'human-mod-timbre') {
  & node (Join-Path $PSScriptRoot 'prepare-human-mod-timbre-fixtures.mjs') $Fixtures
  if($LASTEXITCODE -ne 0){throw 'Original human Mod timbre fixture generation failed'}
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
if($Scenario -eq 'direct-midi') {
  & node (Join-Path $PSScriptRoot 'prepare-direct-midi-fixtures.mjs') $Fixtures
  if($LASTEXITCODE -ne 0){throw 'Original direct MIDI fixture generation failed'}
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
if($fixedLiveKeyScenario){Add-Type -Path @((Join-Path $PSScriptRoot 'windows-desktop-native.cs'),(Join-Path $PSScriptRoot 'windows-live-tone-navigation.cs'))}
else{Add-Type -Path (Join-Path $PSScriptRoot 'windows-desktop-native.cs')}
if($Scenario -eq 'assistance'){Add-Type -Path (Join-Path $PSScriptRoot 'native-assistance-input.cs')}
if($Scenario -eq 'pitch-sources'){Add-Type -Path (Join-Path $PSScriptRoot 'native-pitch-sources-input.cs')}
if($Scenario -eq 'pitch-mod'){Add-Type -Path (Join-Path $PSScriptRoot 'native-pitch-mod-input.cs')}
. (Join-Path $PSScriptRoot 'windows-desktop-profile.ps1')
. (Join-Path $PSScriptRoot 'windows-desktop-catalog-snapshot.ps1')
. (Join-Path $PSScriptRoot 'windows-desktop-geometry.ps1')
. (Join-Path $PSScriptRoot 'windows-build-diagnostics.ps1')
. (Join-Path $PSScriptRoot 'windows-picker-observation.ps1')
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
# This closed action observes an already-visible client. Unlike an ordinary
# click it must not refocus, move the pointer, request a redraw or wait for UI.
function Get-PassiveCaptureTarget($App,$Action) {
  $App.Refresh();$window=$App.MainWindowHandle;[uint32]$owner=0
  [void][NativeAcceptance]::GetWindowThreadProcessId($window,[ref]$owner)
  $client=New-Object NativeAcceptance+RECT;$origin=New-Object NativeAcceptance+POINT
  if(-not [NativeAcceptance]::GetClientRect($window,[ref]$client) -or -not [NativeAcceptance]::ClientToScreen($window,[ref]$origin)){throw 'Passive capture client geometry unavailable'}
  $foreground=[NativeAcceptance]::GetForegroundWindow();$root=[NativeAcceptance]::GetAncestor($window,2)
  $visible=[NativeAcceptance]::IsWindowVisible($window);$enabled=[NativeAcceptance]::IsWindowEnabled($window)
  $monitor=[NativeAcceptance]::MonitorFromWindow($window,2);$info=New-Object NativeAcceptance+MONITORINFO
  $info.Size=[Runtime.InteropServices.Marshal]::SizeOf([type][NativeAcceptance+MONITORINFO])
  if($monitor -eq [IntPtr]::Zero -or -not [NativeAcceptance]::GetMonitorInfo($monitor,[ref]$info)){throw 'Passive capture monitor geometry unavailable'}
  $work=$info.Work;$monitorCount=[NativeAcceptance]::GetSystemMetrics(80)
  $dpi=[NativeAcceptance]::GetDpiForWindow($window);$systemDpi=[NativeAcceptance]::GetDpiForSystem()
  $windowAwareness=[NativeAcceptance]::GetAwarenessFromDpiAwarenessContext([NativeAcceptance]::GetWindowDpiAwarenessContext($window))
  $callerAwareness=[NativeAcceptance]::GetAwarenessFromDpiAwarenessContext([NativeAcceptance]::GetThreadDpiAwarenessContext())
  [int]$scale=0;$scaleResult=[NativeAcceptance]::GetScaleFactorForMonitor($monitor,[ref]$scale)
  [NativeAcceptance]::ValidatePassiveCaptureScale($dpi,$systemDpi,$windowAwareness,$callerAwareness,$scaleResult,$scale,$Action.devicePixelRatio,$monitorCount,$info.Monitor)
  $box=[NativeAcceptance]::PassiveCaptureBounds($window,$root,$foreground,[uint32]$App.Id,$owner,$visible,$enabled,$client,$origin,$work,$Action.width,$Action.height)
  $above=@();$next=[NativeAcceptance]::GetWindow($window,3)
  while($next -ne [IntPtr]::Zero) {
    if($above.Count -ge 128){throw 'Passive capture window inventory exceeds 128'}
    $rectangle=New-Object NativeAcceptance+RECT
    if(-not [NativeAcceptance]::GetWindowRect($next,[ref]$rectangle)){throw 'Passive capture cannot verify a higher window'}
    $shown=[NativeAcceptance]::IsWindowVisible($next)
    [NativeAcceptance]::ValidatePassiveCaptureOverlay($box,$rectangle,$shown)
    $above+=,[ordered]@{hwnd=$next.ToInt64();visible=$shown;rect=@($rectangle.Left,$rectangle.Top,$rectangle.Right,$rectangle.Bottom)}
    $next=[NativeAcceptance]::GetWindow($next,3)
  }
  return [ordered]@{process_id=$App.Id;owner_process_id=$owner;hwnd=$window.ToInt64();root_hwnd=$root.ToInt64();foreground_hwnd=$foreground.ToInt64();visible=$visible;enabled=$enabled;client_rect=@($client.Left,$client.Top,$client.Right,$client.Bottom);client_origin=@($origin.X,$origin.Y);client_screen=@($box.Left,$box.Top,$box.Right,$box.Bottom);work_area=@($work.Left,$work.Top,$work.Right,$work.Bottom);viewport=@($Action.width,$Action.height);device_pixel_ratio=$Action.devicePixelRatio;window_dpi=$dpi;system_dpi=$systemDpi;window_awareness=$windowAwareness;caller_awareness=$callerAwareness;monitor_scale_percent=$scale;monitor_scale_hresult=$scaleResult;monitor_count=$monitorCount;monitor_rect=@($info.Monitor.Left,$info.Monitor.Top,$info.Monitor.Right,$info.Monitor.Bottom);windows_above=$above}
}
function Capture-PassiveClient($App,$Action) {
  if($Scenario -cne 'vsq-song' -or $env:WMH_DESKTOP_ACCEPTANCE_PHASE -cnotin @('vsq-seed','vsq-restart') -or $Action.kind -cne 'capture'){throw 'Passive capture requires its exact acceptance phase'}
  if($Action.sequence -lt 1 -or $Action.sequence -gt 80 -or $Action.x -le 0 -or $Action.x -ge $Action.width -or $Action.y -le 0 -or $Action.y -ge $Action.height){throw 'Passive capture target is invalid'}
  $timer=[Diagnostics.Stopwatch]::StartNew();$times=[ordered]@{started_ms=0}
  $before=Get-PassiveCaptureTarget $App $Action;$times.target_checked_ms=$timer.Elapsed.TotalMilliseconds
  $width=[int]$before.client_rect[2];$height=[int]$before.client_rect[3]
  $bitmap=[System.Drawing.Bitmap]::new($width,$height,[System.Drawing.Imaging.PixelFormat]::Format24bppRgb)
  try {
    $graphics=[System.Drawing.Graphics]::FromImage($bitmap)
    try {
      $times.copy_started_ms=$timer.Elapsed.TotalMilliseconds
      $graphics.CopyFromScreen([int]$before.client_screen[0],[int]$before.client_screen[1],0,0,[System.Drawing.Size]::new($width,$height),[System.Drawing.CopyPixelOperation]::SourceCopy)
      $times.copy_finished_ms=$timer.Elapsed.TotalMilliseconds
    } finally {$graphics.Dispose()}
    $after=Get-PassiveCaptureTarget $App $Action;$times.target_rechecked_ms=$timer.Elapsed.TotalMilliseconds
    if(($before | ConvertTo-Json -Depth 8 -Compress) -cne ($after | ConvertTo-Json -Depth 8 -Compress)){throw 'Passive capture ownership or geometry changed during pixel copy'}
    $lock=$bitmap.LockBits([System.Drawing.Rectangle]::new(0,0,$width,$height),[System.Drawing.Imaging.ImageLockMode]::ReadOnly,[System.Drawing.Imaging.PixelFormat]::Format24bppRgb)
    try {
      $pixels=[byte[]]::new($lock.Stride*$height)
      [Runtime.InteropServices.Marshal]::Copy($lock.Scan0,$pixels,0,$pixels.Length)
      $pixelStats=[NativeAcceptance]::ValidatePassiveCapturePixels($pixels,$width,$height,$lock.Stride)
    } finally {$bitmap.UnlockBits($lock)}
    $times.pixels_verified_ms=$timer.Elapsed.TotalMilliseconds
    $name="native-action-$($env:WMH_DESKTOP_ACCEPTANCE_PHASE)-$($Action.sequence).png";$path=Join-Path $OutputDirectory $name
    $stream=[IO.File]::Open($path,[IO.FileMode]::CreateNew,[IO.FileAccess]::Write,[IO.FileShare]::None)
    try {$bitmap.Save($stream,[System.Drawing.Imaging.ImageFormat]::Png)} finally {$stream.Dispose()}
    $times.png_saved_ms=$timer.Elapsed.TotalMilliseconds
    $file=Get-Item -LiteralPath $path -Force
    if($file.Length -le 0 -or $file.Length -gt 16MB -or ($file.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0){throw 'Passive capture PNG exceeds its ordinary file bound'}
    $hash=(Get-FileHash -LiteralPath $path -Algorithm SHA256).Hash.ToLowerInvariant();$times.finished_ms=$timer.Elapsed.TotalMilliseconds
    return [ordered]@{version=1;kind='foreground-client-pixels';method='CopyFromScreen';phase=$env:WMH_DESKTOP_ACCEPTANCE_PHASE;sequence=$Action.sequence;source_sha=$native.source_sha;source_tree=$native.source_tree;executable_sha256=$native.executable_sha256;before=$before;after=$after;input=[ordered]@{pointer_moved=$false;pointer_clicked=$false;focus_changed=$false;keyboard_sent=$false};file=$name;bytes=$file.Length;sha256=$hash;width=$width;height=$height;non_black_pixels=$pixelStats[0];different_pixels=$pixelStats[1];channel_min=$pixelStats[2];channel_max=$pixelStats[3];timings=$times}
  } finally {$bitmap.Dispose();$timer.Stop()}
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
function Click-PickerAction($Root,[IntPtr]$Dialog,$App,[hashtable]$Evidence,[int]$ControlId=1,$Observation=$null) {
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
  Record-PickerObservation $Observation 'picker-button-before-click' $App $Dialog $Evidence
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
  $submittedClock=[Diagnostics.Stopwatch]::StartNew()
  Record-PickerPoll $Observation 'picker-button-after-click' @{input_submitted=$true} 'input-submitted' $Evidence
  return $submittedClock
}
function Wait-PickerDismissal([IntPtr]$Dialog,$App,[hashtable]$Evidence,$Observation,[Diagnostics.Stopwatch]$SubmittedClock) {
  while($true) {
    $elapsed=$SubmittedClock.ElapsedMilliseconds
    if([NativeAcceptance]::PickerPollDecision($elapsed,5000,$false) -lt 0){
      Record-PickerPoll $Observation 'dismissal-poll' @{sampled=$false;operation_elapsed_ms=$elapsed;decision=-1} 'expired-before-sample' $Evidence
      throw 'Owned Windows picker did not dismiss within 5 seconds'
    }
    $exists=[NativeAcceptance]::IsWindow($Dialog);$visible=[NativeAcceptance]::IsWindowVisible($Dialog)
    $foreground=[NativeAcceptance]::GetForegroundWindow();[uint32]$process=0
    [void][NativeAcceptance]::GetWindowThreadProcessId($foreground,[ref]$process)
    $popup=$foreground -ne $App.MainWindowHandle -and $process -eq $App.Id -and [NativeAcceptance]::GetAncestor($foreground,3) -eq $App.MainWindowHandle -and [NativeAcceptance]::IsWindowVisible($foreground)
    $appForeground=$foreground -eq $App.MainWindowHandle;$appEnabled=[NativeAcceptance]::IsWindowEnabled($App.MainWindowHandle)
    $dismissed=[NativeAcceptance]::PickerDismissed($exists,$visible,$popup,$appForeground,$appEnabled)
    $elapsed=$SubmittedClock.ElapsedMilliseconds
    $decision=[NativeAcceptance]::PickerPollDecision($elapsed,5000,$dismissed)
    $Evidence.picker_completion=[ordered]@{dialog_exists=$exists;dialog_visible=$visible;foreground_hwnd=$foreground.ToInt64();owned_popup_visible=$popup;app_foreground=$appForeground;app_enabled=$appEnabled;dialog_dismissed=$dismissed;elapsed_ms=$elapsed;within_deadline=($decision -ge 0)}
    $state=[ordered]@{sampled=$true;dialog_hwnd=$Dialog.ToInt64();dialog_exists=$exists;dialog_visible=$visible;foreground_hwnd=$foreground.ToInt64();owned_popup_visible=$popup;app_foreground=$appForeground;app_enabled=$appEnabled;state_ready=$dismissed;operation_elapsed_ms=$elapsed;decision=$decision}
    $key="$exists|$visible|$foreground|$popup|$appForeground|$appEnabled|$decision"
    Record-PickerPoll $Observation 'dismissal-poll' $state $key $Evidence
    # Evaluate the timestamp of the completed native sample before accepting it.
    # No observation may make a newly seen, expired state count as success.
    if($decision -lt 0){throw 'Owned Windows picker did not dismiss within 5 seconds'}
    if($decision -eq 1){return}
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
  $observation=$null
  if($Action.kind -cin @('picker','cancel-picker')){
    try{$observation=New-PickerObservation $env:WMH_DESKTOP_ACCEPTANCE_PHASE $Action.sequence $native}
    catch{$Evidence.picker_observation_error=$_.Exception.Message}
  }
  try{
    Record-PickerObservation $observation 'action-start' $App ([IntPtr]::Zero) $Evidence
    Invoke-NativeAction $App $Action $Evidence $observation
    Record-PickerObservation $observation 'completed' $App ([IntPtr]::Zero) $Evidence
    Flush-PickerObservation $observation $Evidence
  }catch{
    $failure=$_
    if($null -ne $observation){$observation.report.error=$failure.Exception.Message}
    Flush-PickerObservation $observation $Evidence
    Record-PickerObservation $observation 'failed' $App ([IntPtr]::Zero) $Evidence
    Flush-PickerObservation $observation $Evidence
    throw $failure
  }
}
function Invoke-NativeAction($App,$Action,[hashtable]$Evidence,$Observation=$null) {
  if($Scenario -ceq 'direct-midi') {
    if($env:WMH_DESKTOP_ACCEPTANCE_PHASE -cnotin @('direct-midi-seed','direct-midi-restart')){throw 'Unknown direct MIDI phase'}
    if($Action.kind -cnotin @('click','picker')){throw 'Unknown closed direct MIDI action'}
    if($Action.kind -ceq 'picker' -and ($env:WMH_DESKTOP_ACCEPTANCE_PHASE -cne 'direct-midi-seed' -or $Action.file -cne 'original-direct-midi-boundary.mid')){throw 'Direct MIDI picker requires the exact original seed fixture'}
  }
  $sourcesNumeric=$Scenario -ceq 'pitch-sources' -and $Action.kind -ceq 'pitch-sources-shift-two'
  if($Scenario -ceq 'pitch-sources') {
    if($env:WMH_DESKTOP_ACCEPTANCE_PHASE -cnotin @('pitch-sources-seed','pitch-sources-restart','pitch-sources-zero','pitch-sources-zero-restart')){throw 'Unknown source pitch phase'}
    if($Action.kind -cnotin @('click','picker','select-first','select-second','select-last','pitch-sources-shift-two')){throw 'Unknown closed source pitch action'}
    if($sourcesNumeric){[NativePitchSourcesInput]::Validate($env:WMH_DESKTOP_ACCEPTANCE_PHASE,$Action.kind)}
    if($Action.kind -ceq 'picker' -and ($env:WMH_DESKTOP_ACCEPTANCE_PHASE -cne 'pitch-sources-seed' -or $Action.file -cne 'pitch-sources-original.wmhpack')){throw 'Source picker requires its exact original archive in seed'}
  }
  $pitchNumeric=$Scenario -ceq 'pitch-mod' -and $Action.kind -ceq 'pitch-mod-shift-two'
  if($Scenario -ceq 'pitch-mod') {
    if($env:WMH_DESKTOP_ACCEPTANCE_PHASE -cnotin @('pitch-mod-seed','pitch-mod-restart')){throw 'Unknown pitch Mod phase'}
    if($Action.kind -cnotin @('click','picker','select-first','select-second','select-last','pitch-mod-shift-two','pitch-mod-key-s')){throw 'Unknown closed pitch Mod action'}
    if($pitchNumeric){[NativePitchModInput]::Validate($env:WMH_DESKTOP_ACCEPTANCE_PHASE,$Action.kind)}
    if($Action.kind -ceq 'picker' -and ($env:WMH_DESKTOP_ACCEPTANCE_PHASE -cne 'pitch-mod-seed' -or $Action.file -cne 'pitch-mod-original-c4.json')){throw 'Pitch picker requires its exact seed fixture'}
    if($Action.kind -ceq 'pitch-mod-key-s' -and $env:WMH_DESKTOP_ACCEPTANCE_PHASE -cne 'pitch-mod-restart'){throw 'Fixed S requires pitch restart'}
  }
  $assistanceNumeric=$Scenario -ceq 'assistance' -and $Action.kind -cin @('assistance-onset','assistance-interval','assistance-held','assistance-span')
  if($Scenario -ceq 'assistance') {
    if($env:WMH_DESKTOP_ACCEPTANCE_PHASE -cnotin @('assistance-seed','assistance-restart','assistance-progression','assistance-off-restart')){throw 'Unknown assistance phase'}
    if($Action.kind -cnotin @('click','picker','select-first','select-second','select-last','assistance-onset','assistance-interval','assistance-held','assistance-span','assistance-key-c5')){throw 'Unknown closed assistance action'}
    if(($assistanceNumeric -or $Action.kind -ceq 'picker') -and $env:WMH_DESKTOP_ACCEPTANCE_PHASE -cne 'assistance-seed'){throw 'Only seed may import/edit assistance'}
    if($Action.kind -ceq 'picker' -and $Action.file -cne 'assistance-original-songs.zip'){throw 'Only original assistance fixture allowed'}
  }

  if($Scenario -ceq 'human-mod-timbre') {
    if($env:WMH_DESKTOP_ACCEPTANCE_PHASE -cnotin @('human-timbre-seed','human-timbre-migrate','human-timbre-restart')){throw 'Human timbre actions require an explicit human timbre phase'}
    if($Action.kind -cnotin @('click','picker','select-first','select-second','select-last','key-r','live-key-r-down','live-key-r-up')){throw 'Unknown closed human timbre action'}
    if($Action.kind -ceq 'picker' -and ($env:WMH_DESKTOP_ACCEPTANCE_PHASE -cne 'human-timbre-seed' -or $Action.file -cne 'human-mod-timbre-original.json')){throw 'Human timbre picker requires its exact original fixture in seed'}
  }
  if($Action.kind -ceq 'picker' -and $Action.file -ceq 'human-mod-timbre-original.json') {
    if($Scenario -cne 'human-mod-timbre' -or $env:WMH_DESKTOP_ACCEPTANCE_PHASE -cne 'human-timbre-seed'){throw 'Human timbre fixture requires its separate seed phase'}
  }
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
    if($Scenario -cne 'live-tone-navigation' -or $env:WMH_DESKTOP_ACCEPTANCE_PHASE -cnotin @('live-navigation-settings-keyup','live-navigation-settings-navigation','live-navigation-authoring-keyup','live-navigation-authoring-navigation')){throw 'Live-navigation fixture requires its separate scenario and phase'}
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
  if($Action.kind -ceq 'capture'){$Evidence.native_capture=Capture-PassiveClient $App $Action;return}
  if($Action.kind -cin @('live-key-r-down','live-key-r-up')) {
    if(-not $fixedLiveKeyScenario){throw 'Fixed R actions require an explicit native live-tone scenario'}
    $foreground=[NativeAcceptance]::GetForegroundWindow();$enabled=[NativeAcceptance]::IsWindowEnabled($window)
    $before=[NativeLiveToneNavigationKey]::Held;$heldMilliseconds=[NativeLiveToneNavigationKey]::HeldMilliseconds
    if($Action.kind -ceq 'live-key-r-down'){[NativeLiveToneNavigationKey]::Down($env:WMH_DESKTOP_ACCEPTANCE_PHASE,$window,$foreground,[uint32]$App.Id,$enabled)}
    else{[NativeLiveToneNavigationKey]::Up($env:WMH_DESKTOP_ACCEPTANCE_PHASE,$window,$foreground,[uint32]$App.Id,$enabled)}
    $Evidence.native_key=[ordered]@{app_hwnd=$window.ToInt64();foreground=$foreground.ToInt64();app_process_id=$App.Id;app_enabled=$enabled;code='KeyR';virtual_key=0x52;focus_reacquired=$false;pointer_clicked=$false;held_before=$before;held_after=[NativeLiveToneNavigationKey]::Held;held_ms=$heldMilliseconds}
    return
  }
  if($Action.kind -ceq 'pitch-mod-key-s') {
    if($Scenario -cne 'pitch-mod' -or $env:WMH_DESKTOP_ACCEPTANCE_PHASE -cne 'pitch-mod-restart'){throw 'Fixed S requires pitch restart'}
    $foreground=[NativeAcceptance]::GetForegroundWindow();$enabled=[NativeAcceptance]::IsWindowEnabled($window)
    if($foreground -ne $window -or -not $enabled){throw 'Prepared physical S foreground ownership lost'}
    $Evidence.native_key=[ordered]@{app_hwnd=$window.ToInt64();foreground=$foreground.ToInt64();app_process_id=$App.Id;app_enabled=$enabled;code='KeyS';virtual_key=0x53;hold_ms=40;focus_reacquired=$false;pointer_clicked=$false}
    [NativePitchModInput]::PlayS($env:WMH_DESKTOP_ACCEPTANCE_PHASE,[string]$Action.kind);return
  }
  if($Action.kind -ceq 'assistance-key-c5') {
    if($Scenario -cne 'assistance' -or $env:WMH_DESKTOP_ACCEPTANCE_PHASE -cnotin @('assistance-restart','assistance-progression')){throw 'Only the closed assistance human-take phases allow C5'}
    $foreground=[NativeAcceptance]::GetForegroundWindow();$enabled=[NativeAcceptance]::IsWindowEnabled($window)
    if($foreground -ne $window -or -not $enabled){throw 'Prepared assistance C5 ownership was lost'}
    $Evidence.native_key=[ordered]@{app_hwnd=$window.ToInt64();foreground=$foreground.ToInt64();app_process_id=$App.Id;app_enabled=$enabled;code='Digit2';virtual_key=0x32;hold_ms=40;focus_reacquired=$false;pointer_clicked=$false}
    [NativeAcceptance]::HeldPerformanceKey(0x32);return
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
  Record-PickerObservation $Observation 'client-before-click' $App ([IntPtr]::Zero) $Evidence
  if(-not [NativeAcceptance]::SetCursorPos($point.X,$point.Y) -or -not [NativeAcceptance]::GetCursorPos([ref]$actual)){throw 'Cannot observe actual native pointer position'}
  $hit=[NativeAcceptance]::WindowFromPoint($actual);$hitRoot=[NativeAcceptance]::GetAncestor($hit,2);$foreground=[NativeAcceptance]::GetForegroundWindow()
  $Evidence.client_click.actual=@($actual.X,$actual.Y);$Evidence.client_click.hit_hwnd=$hit.ToInt64();$Evidence.client_click.hit_root=$hitRoot.ToInt64();$Evidence.client_click.app_hwnd=$window.ToInt64();$Evidence.client_click.foreground=$foreground.ToInt64()
  [NativeAcceptance]::ValidateClientClick($work,$point,$actual,$window,$foreground,($hit -eq $window -or $hitRoot -eq $window -or [NativeAcceptance]::IsChild($window,$hit)))
  [NativeAcceptance]::ClickPositioned()
  $clientSubmittedClock=[Diagnostics.Stopwatch]::StartNew()
  Record-PickerPoll $Observation 'client-after-click' @{input_submitted=$true} 'input-submitted' $Evidence
  if($sourcesNumeric) {
    $Evidence.native_numeric=[ordered]@{app_hwnd=$window.ToInt64();foreground=[NativeAcceptance]::GetForegroundWindow().ToInt64();app_process_id=$App.Id;kind=$Action.kind;value='2';method='fixed_ctrl_a_digits_tab';completed=$false}
    if($Evidence.native_numeric.foreground -ne $window.ToInt64()){throw 'Source pitch numeric ownership lost'}
    [NativePitchSourcesInput]::Edit($env:WMH_DESKTOP_ACCEPTANCE_PHASE,$Action.kind);$Evidence.native_numeric.completed=$true;return
  }
  if($pitchNumeric) {
    $Evidence.native_numeric=[ordered]@{app_hwnd=$window.ToInt64();foreground=[NativeAcceptance]::GetForegroundWindow().ToInt64();app_process_id=$App.Id;kind=$Action.kind;value='2';method='fixed_ctrl_a_digits_tab';completed=$false}
    if($Evidence.native_numeric.foreground -ne $window.ToInt64()){throw 'Pitch numeric ownership was lost'}
    [NativePitchModInput]::Edit($env:WMH_DESKTOP_ACCEPTANCE_PHASE,$Action.kind);$Evidence.native_numeric.completed=$true;return
  }
  if($assistanceNumeric) {
    $Evidence.native_numeric=[ordered]@{app_hwnd=$window.ToInt64();foreground=[NativeAcceptance]::GetForegroundWindow().ToInt64();app_process_id=$App.Id;kind=$Action.kind;value=[NativeAssistanceInput]::Value($Action.kind);method='fixed_ctrl_a_digits_tab';completed=$false}
    if($Evidence.native_numeric.foreground -ne $window.ToInt64()){throw 'Assistance numeric ownership was lost'}
    [NativeAssistanceInput]::Edit($env:WMH_DESKTOP_ACCEPTANCE_PHASE,$Action.kind);$Evidence.native_numeric.completed=$true;return
  }
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
  $dialog=[IntPtr]::Zero
  while($true) {
    $elapsed=$clientSubmittedClock.ElapsedMilliseconds
    if([NativeAcceptance]::PickerPollDecision($elapsed,10000,$false) -lt 0){
      Record-PickerPoll $Observation 'discovery-poll' @{sampled=$false;operation_elapsed_ms=$elapsed;decision=-1} 'expired-before-sample' $Evidence
      break
    }
    $candidate=[NativeAcceptance]::GetForegroundWindow();$class=[System.Text.StringBuilder]::new(256)
    [void][NativeAcceptance]::GetClassName($candidate,$class,256)
    $owner=[NativeAcceptance]::GetAncestor($candidate,3);[uint32]$candidateProcess=0
    [void][NativeAcceptance]::GetWindowThreadProcessId($candidate,[ref]$candidateProcess)
    $ready=$class.ToString() -eq '#32770' -and $owner -eq $window
    $elapsed=$clientSubmittedClock.ElapsedMilliseconds
    $decision=[NativeAcceptance]::PickerPollDecision($elapsed,10000,$ready)
    $ownedClass=if($candidateProcess -eq $App.Id -and $owner -eq $window){$class.ToString()}else{$null}
    $state=[ordered]@{sampled=$true;foreground_hwnd=$candidate.ToInt64();foreground_process_id=$candidateProcess;foreground_root_owner_hwnd=$owner.ToInt64();owned_class=$ownedClass;state_ready=$ready;operation_elapsed_ms=$elapsed;decision=$decision}
    $key="$candidate|$candidateProcess|$owner|$ownedClass|$decision"
    Record-PickerPoll $Observation 'discovery-poll' $state $key $Evidence
    if($decision -lt 0){break}
    if($decision -eq 1){$dialog=$candidate;break}
    Start-Sleep -Milliseconds 100
  }
  if($dialog -eq [IntPtr]::Zero){throw 'No owned Windows file picker opened; no browser file-input substitution is allowed'}
  [uint32]$dialogProcess=0
  [void][NativeAcceptance]::GetWindowThreadProcessId($dialog,[ref]$dialogProcess)
  $Evidence.owned_dialog=[ordered]@{hwnd=$dialog.ToInt64();process_id=$dialogProcess;class=$class.ToString();root_owner_hwnd=[NativeAcceptance]::GetAncestor($dialog,3).ToInt64();app_hwnd=$window.ToInt64();app_process_id=$App.Id}
  try {
    if($dialogProcess -ne $App.Id){throw 'Windows picker process does not match its app owner'}
    Record-PickerObservation $Observation 'owned-dialog-found' $App $dialog $Evidence
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
      $submittedClock=Click-PickerAction $root $dialog $App $Evidence 2 $Observation
      Wait-PickerDismissal $dialog $App $Evidence $Observation $submittedClock;return
    }
    if($Scenario -ceq 'direct-midi' -and $Action.file -ceq 'original-direct-midi-boundary.mid') {
      $fixture=Get-Item -LiteralPath (Join-Path $Fixtures 'original-direct-midi-boundary.mid') -Force
      if($fixture.PSIsContainer -or ($fixture.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0){throw 'Direct MIDI fixture must be an ordinary file'}
      $path=$fixture.FullName
    } elseif($Scenario -ceq 'assistance' -and $Action.file -ceq 'assistance-original-songs.zip') {
      $fixture=Get-Item -LiteralPath (Join-Path $Fixtures 'assistance-original-songs.zip') -Force
      if($fixture.PSIsContainer -or ($fixture.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0){throw 'Assistance fixture must be an ordinary file'}
      $path=$fixture.FullName
    } elseif($Scenario -ceq 'pitch-sources' -and $Action.file -ceq 'pitch-sources-original.wmhpack') {
      $fixture=Get-Item -LiteralPath (Join-Path $Fixtures 'pitch-sources-original.wmhpack') -Force
      if($fixture.PSIsContainer -or ($fixture.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0){throw 'Source fixture must be an ordinary file'}
      $path=$fixture.FullName
    } elseif($Scenario -ceq 'pitch-mod' -and $Action.file -ceq 'pitch-mod-original-c4.json') {
      $fixture=Get-Item -LiteralPath (Join-Path $Fixtures 'pitch-mod-original-c4.json') -Force
      if($fixture.PSIsContainer -or ($fixture.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0){throw 'Pitch fixture must be an ordinary file'}
      $path=$fixture.FullName
    } else {$path=[NativeAcceptance]::ResolveFixturePath($Fixtures,$OutputDirectory,[string]$Action.file)}
    $root=[System.Windows.Automation.AutomationElement]::FromHandle($dialog)
    if($Scenario -ceq 'assistance' -and $env:WMH_DESKTOP_ACCEPTANCE_PHASE -ceq 'assistance-seed' -and $Action.kind -ceq 'picker' -and $Action.file -ceq 'assistance-original-songs.zip') {
      # Runs595/597 expose this host as UIA Pane without ValuePattern. Use
      # the existing fully verified native Edit route immediately; do not
      # spend a futile5s polling for a pattern this control does not expose.
      $Evidence.filename_selection_policy='closed-assistance-verified-native-first'
      Set-NativeFileName $root $dialog $App $path $Evidence
    } else {
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
    }
    Record-PickerObservation $Observation 'filename-ready' $App $dialog $Evidence
    Capture-Handle $dialog "owned-picker-before-open-$($env:WMH_DESKTOP_ACCEPTANCE_PHASE)-$($Action.sequence)"
    $submittedClock=Click-PickerAction $root $dialog $App $Evidence 1 $Observation
    Wait-PickerDismissal $dialog $App $Evidence $Observation $submittedClock
  } catch {
    $failure=$_.Exception.Message
    if($null -ne $Observation){$Observation.report.error=$failure}
    Flush-PickerObservation $Observation $Evidence
    Record-PickerObservation $Observation 'failure-capture-before' $App $dialog $Evidence
    Flush-PickerObservation $Observation $Evidence
    try {Capture-PickerFailure $dialog $App $Action $Evidence}
    catch {$Evidence.failure_capture_error=$_.Exception.Message}
    Record-PickerObservation $Observation 'failure-capture-after' $App $dialog $Evidence
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
  foreach($area in $(if($Scenario -in @('clean-song','vsq-song','performance-song','pitch-bend','authoring','vsq-authoring','direct-midi','basic-key','complete-practice','assistance','pitch-sources')){@('clean-songs','clean-backups','imports','import-backups')}elseif($Scenario -eq 'bulk-import'){@('songs','backups','imports','import-backups')}else{@('songs','backups')})) {
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
$nativeReportName=if($Scenario -eq 'direct-midi'){'native-direct-midi.json'}elseif($Scenario -eq 'pitch-sources'){'native-pitch-sources.json'}elseif($Scenario -eq 'pitch-mod'){'native-pitch-mod.json'}elseif($Scenario -eq 'assistance'){'native-assistance.json'}elseif($Scenario -eq 'human-mod-timbre'){'native-human-mod-timbre.json'}elseif($Scenario -eq 'build-diagnostics'){'native-build-diagnostics.json'}elseif($Scenario -eq 'live-tone-navigation'){'native-live-tone-navigation.json'}elseif($Scenario -eq 'library-catalog'){'native-library-catalog.json'}elseif($Scenario -eq 'skin'){'native-skin.json'}elseif($Scenario -eq 'canonical-practice'){'native-canonical-practice.json'}elseif($Scenario -eq 'complete-practice'){'native-complete-practice.json'}elseif($Scenario -eq 'basic-key'){'native-basic-key.json'}elseif($Scenario -eq 'vsq-authoring'){'native-vsq-authoring.json'}elseif($Scenario -eq 'authoring'){'native-song-authoring.json'}elseif($Scenario -eq 'pitch-bend'){'native-pitch-bend.json'}elseif($Scenario -eq 'performance-song'){'native-performance-song.json'}elseif($Scenario -eq 'vsq-song'){'native-vsq-song.json'}elseif($Scenario -eq 'clean-song'){'native-clean-song.json'}elseif($Scenario -eq 'bulk-import'){'native-bulk-import.json'}elseif($Scenario -eq 'song-folder'){'native-song-folder.json'}else{'native-acceptance.json'}
$phases=if($Scenario -eq 'direct-midi'){@('direct-midi-seed','direct-midi-restart')}elseif($Scenario -eq 'human-mod-timbre'){@('human-timbre-seed','human-timbre-migrate','human-timbre-restart')}elseif($Scenario -eq 'pitch-sources'){@('pitch-sources-seed','pitch-sources-restart','pitch-sources-zero','pitch-sources-zero-restart')}elseif($Scenario -eq 'pitch-mod'){@('pitch-mod-seed','pitch-mod-restart')}elseif($Scenario -eq 'assistance'){@('assistance-seed','assistance-restart','assistance-progression','assistance-off-restart')}elseif($Scenario -eq 'build-diagnostics'){@('build-diagnostics')}elseif($Scenario -eq 'live-tone-navigation'){@('live-navigation-settings-keyup','live-navigation-settings-navigation','live-navigation-authoring-keyup','live-navigation-authoring-navigation')}elseif($Scenario -eq 'library-catalog'){@('catalog-seed','catalog-restart','catalog-final')}elseif($Scenario -eq 'skin'){@('skin-seed','skin-restart','skin-default-restart')}elseif($Scenario -eq 'canonical-practice'){@('canonical-practice-seed','canonical-practice-controls','canonical-practice-restart')}elseif($Scenario -eq 'complete-practice'){@('complete-practice-seed','complete-practice-restart')}elseif($Scenario -eq 'basic-key'){@('basic-key-seed','basic-key-restart')}elseif($Scenario -eq 'vsq-authoring'){@('vsq-authoring-seed','vsq-authoring-restart')}elseif($Scenario -eq 'authoring'){@('authoring-seed','authoring-restart')}elseif($Scenario -eq 'pitch-bend'){@('pitch-bend-seed','pitch-bend-restart')}elseif($Scenario -eq 'performance-song'){@('performance-seed','performance-controls','performance-restart')}elseif($Scenario -eq 'vsq-song'){@('vsq-seed','vsq-restart')}elseif($Scenario -eq 'clean-song'){@('clean-seed','clean-restart')}elseif($Scenario -eq 'bulk-import'){@('bulk-seed','bulk-restart','bulk-failure')}elseif($Scenario -eq 'song-folder'){@('folder-seed','folder-restart','folder-failure')}else{@('seed','restart','close-active','reopen')}
if($Scenario -in @('song-folder','bulk-import','clean-song','vsq-song','performance-song','pitch-bend','authoring','vsq-authoring','direct-midi','basic-key','complete-practice','canonical-practice','skin','library-catalog','live-tone-navigation','human-mod-timbre','build-diagnostics','assistance','pitch-mod','pitch-sources')){$native.profile_reused=$false;$native.scenario=$Scenario;$native.directory=Join-Path $OutputDirectory 'Scores'}
try {
if($Scenario -eq 'direct-midi') {
  $bindingJson=& node (Join-Path $PSScriptRoot 'verify-native-direct-midi-evidence.mjs') --source-binding $Repository
  if($LASTEXITCODE -ne 0){throw 'Cannot bind direct MIDI to exact source'}
  $binding=ConvertFrom-Json -InputObject $bindingJson -AsHashtable
  if($binding.source_sha -cne $native.source_sha -or $binding.source_tree -cne $native.source_tree){throw 'Direct MIDI source changed'}
  $native.source_hashes=$binding.source_hashes;$native.executable_path=$Executable
}
if($Scenario -eq 'build-diagnostics') {
  $bindingJson=& node (Join-Path $PSScriptRoot 'verify-native-build-diagnostics.mjs') --source-binding $Repository
  if($LASTEXITCODE -ne 0){throw 'Cannot bind diagnostics to clean full-history source'}
  $binding=ConvertFrom-Json -InputObject $bindingJson -AsHashtable
  foreach($key in @('source_sha','source_tree')){if($binding[$key] -cne $native[$key]){throw 'Diagnostic source changed before launch'}}
  $native.source_commit_count=$binding.source_commit_count;$native.source_hashes=$binding.source_hashes
  $target=@(& rustc -vV | Where-Object {$_ -cmatch '^host: '})
  if($LASTEXITCODE -ne 0 -or $target.Count -ne 1){throw 'Cannot establish native compiler target'}
  $native.diagnostic_host=[ordered]@{launched_executable_path=$Executable;target=$target[0].Substring(6);arch=(Get-BuildDiagnosticsArchitecture $Executable);executable_before=(Get-BuildDiagnosticsExecutable $Executable)}
}
if($Scenario -in @('complete-practice','canonical-practice','human-mod-timbre','assistance','pitch-mod','pitch-sources')){$native.profile_reused=$true}
if($Scenario -eq 'pitch-sources') {
  $bindingJson=& node (Join-Path $PSScriptRoot 'verify-native-pitch-sources.mjs') --source-binding $Repository
  if($LASTEXITCODE -ne 0){throw 'Cannot bind native source pitch to exact source'}
  $binding=ConvertFrom-Json -InputObject $bindingJson -AsHashtable
  if($binding.source_sha -cne $native.source_sha -or $binding.source_tree -cne $native.source_tree){throw 'Native source pitch code changed'}
  $native.source_hashes=$binding.source_hashes;$native.executable_path=$Executable
}
if($Scenario -eq 'pitch-mod') {
  $bindingJson=& node (Join-Path $PSScriptRoot 'verify-native-pitch-mod-evidence.mjs') --source-binding $Repository
  if($LASTEXITCODE -ne 0){throw 'Cannot bind pitch Mod to exact source'}
  $binding=ConvertFrom-Json -InputObject $bindingJson -AsHashtable
  if($binding.source_sha -cne $native.source_sha -or $binding.source_tree -cne $native.source_tree){throw 'Pitch source changed'}
  $native.source_hashes=$binding.source_hashes;$native.executable_path=$Executable
}
if($Scenario -eq 'assistance') {
  $bindingJson=& node (Join-Path $PSScriptRoot 'verify-native-assistance-evidence.mjs') --source-binding $Repository
  if($LASTEXITCODE -ne 0){throw 'Cannot bind assistance to exact source'}
  $binding=ConvertFrom-Json -InputObject $bindingJson -AsHashtable
  if($binding.source_sha -cne $native.source_sha -or $binding.source_tree -cne $native.source_tree){throw 'Assistance source changed'}
  $native.source_hashes=$binding.source_hashes;$native.executable_path=$Executable
}
if($Scenario -eq 'skin') {
  $native.profile_reused=$true
  $skinBindingJson=& node (Join-Path $PSScriptRoot 'native-skin-source-evidence.mjs') $Repository
  if($LASTEXITCODE -ne 0){throw 'Cannot bind skin acceptance to its frozen source'}
  $skinBinding=ConvertFrom-Json -InputObject $skinBindingJson -AsHashtable
  if($skinBinding.source_sha -cne $native.source_sha -or $skinBinding.source_tree -cne $native.source_tree){throw 'Skin acceptance source changed before launch'}
  $native.source_hashes=$skinBinding.source_hashes
}
if($Scenario -eq 'human-mod-timbre') {
  $humanTimbreBindingJson=& node (Join-Path $PSScriptRoot 'verify-native-human-mod-timbre-evidence.mjs') --source-binding $Repository
  if($LASTEXITCODE -ne 0){throw 'Cannot bind native human timbre acceptance to its frozen source'}
  $humanTimbreBinding=ConvertFrom-Json -InputObject $humanTimbreBindingJson -AsHashtable
  if($humanTimbreBinding.source_sha -cne $native.source_sha -or $humanTimbreBinding.source_tree -cne $native.source_tree){throw 'Native human timbre source changed before launch'}
  $native.source_hashes=$humanTimbreBinding.source_hashes
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
  # The closed catalog retains Mod, skin, membership and diagnostic-view dependencies.
  if($sourceNames.Count -ne 57 -or @($sourceNames | Sort-Object -Unique).Count -ne 57){throw 'Catalog source allowlist must contain exactly 57 distinct modules'}
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
    if($Scenario -in @('song-folder','bulk-import','clean-song','vsq-song','performance-song','pitch-bend','authoring','vsq-authoring','direct-midi','basic-key','complete-practice','canonical-practice','skin','library-catalog','live-tone-navigation','human-mod-timbre','build-diagnostics','assistance','pitch-mod','pitch-sources')) {
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
    if($Scenario -eq 'build-diagnostics'){$native.diagnostic_host.capture_started_unix_ms=[DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()}
    $app=Start-Process -FilePath $Executable -PassThru -RedirectStandardError (Join-Path $OutputDirectory "stderr-$phase.log")
    $phaseStart=[DateTime]::UtcNow;$deadline=$phaseStart.AddSeconds(240);$sequence=1;$reportDeliveryWatch=$null
    $reportFile=Join-Path $OutputDirectory "renderer-$phase.json"
    $reportLimit=if($Scenario -eq 'bulk-import'){4MB}elseif($Scenario -in @('clean-song','vsq-song','performance-song','pitch-bend','authoring','vsq-authoring','direct-midi','basic-key','complete-practice','canonical-practice','skin','library-catalog','live-tone-navigation','human-mod-timbre','build-diagnostics','assistance','pitch-mod','pitch-sources')){1MB}else{64KB}
    while($null -eq ($report=Read-AcceptanceJsonSnapshot -Path $reportFile -MaximumBytes $reportLimit -AllowPending)) {
      if($fixedLiveKeyScenario -and [NativeLiveToneNavigationKey]::Held -and [NativeLiveToneNavigationKey]::HeldMilliseconds -gt 10000){throw 'Native test R exceeded its observed 10-second watchdog limit'}
      $app.Refresh();if($app.HasExited){throw "Process exited before $phase evidence: $($app.ExitCode); profile=$($profileSelection.profile_directory); see stderr-$phase.log"}
      if([DateTime]::UtcNow -ge $deadline){throw "Native $phase exceeded 240 seconds"}
      if($Scenario -in @('bulk-import','clean-song','vsq-song','performance-song','pitch-bend','authoring','vsq-authoring','direct-midi','basic-key','complete-practice','canonical-practice','skin','library-catalog','live-tone-navigation','human-mod-timbre','build-diagnostics','assistance','pitch-mod','pitch-sources')) {
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
        $actionLimit=if($Scenario -ceq 'pitch-sources'){128}elseif($phase -ceq 'build-diagnostics'){32}elseif($Scenario -ceq 'assistance'){96}elseif($phase -ceq 'seed'){72}elseif($phase -in @('vsq-seed','vsq-restart','basic-key-seed','basic-key-restart','authoring-seed','authoring-restart','vsq-authoring-seed','vsq-authoring-restart','canonical-practice-seed')){80}elseif($Scenario -in @('performance-song','pitch-bend','bulk-import','song-folder')){75}else{64}
        if($action.sequence -ne $sequence -or $sequence -gt $actionLimit){throw 'Out-of-order or over-limit native action'}
        $catalogReportedViewport=@($action.width,$action.height)
        if($Scenario -eq 'build-diagnostics' -and $sequence -eq 1) {
          $app.Refresh();$native.diagnostic_host.process_id=$app.Id;$native.diagnostic_host.process_image_path=$app.MainModule.FileName
          Save-Json (Get-BuildDiagnosticsLibrarySnapshot (Join-Path $OutputDirectory 'Scores')) (Join-Path $OutputDirectory 'snapshot-build-diagnostics-before.json')
          Save-Json $native (Join-Path $OutputDirectory $nativeReportName)
        }
        $result=@{ok=$false}
        try{Native-Action $app $action $result;if($action.kind -cne 'capture' -and $Scenario -in @('bulk-import','clean-song','vsq-song','performance-song','pitch-bend','authoring','vsq-authoring','direct-midi','basic-key','complete-practice','canonical-practice','skin','library-catalog','live-tone-navigation','human-mod-timbre','build-diagnostics','assistance','pitch-mod','pitch-sources') -and (-not $fixedLiveKeyScenario -or -not [NativeLiveToneNavigationKey]::Held)){Capture-Window $app "native-action-$phase-$sequence"};$result.ok=$true}catch{$result.error=$_.Exception.Message}
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
    if($fixedLiveKeyScenario -and [NativeLiveToneNavigationKey]::Held){throw 'Native live-navigation phase completed with a held test key'}
    if($Scenario -ceq 'library-catalog') {
      $catalogRendererGeometry=$report.geometry;$catalogReportedViewport=@($report.layout.width,$report.layout.height)
      # Preserve the first renderer failure; strict success capture must not mask it.
      if(-not $report.ok){throw "Native $phase failed: $($report.error)"}
    }
    Assert-AcceptanceProfileEvidence $OutputDirectory $profileSelection $app.Id
    Capture-Window $app "native-$phase"
    # One existing EXE-owned listener sample, not a network/security audit.
    $listeners=@(Get-NetTCPConnection -State Listen -ErrorAction Stop | Where-Object OwningProcess -eq $app.Id)
    if($Scenario -eq 'build-diagnostics') {
      if($app.MainModule.FileName -cne $native.diagnostic_host.process_image_path){throw 'Owned diagnostic process image changed'}
      $native.diagnostic_host.executable_after=Get-BuildDiagnosticsExecutable $Executable
      $native.diagnostic_host.executable_tcp_listeners=$listeners.Count
      $native.diagnostic_host.capture_finished_unix_ms=[DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
      Save-Json (Get-BuildDiagnosticsLibrarySnapshot (Join-Path $OutputDirectory 'Scores')) (Join-Path $OutputDirectory 'snapshot-build-diagnostics-after.json')
    }
    $item=[ordered]@{phase=$phase;process_id=$app.Id;renderer_ok=$report.ok;renderer_origin=$report.origin;actions=$sequence-1;elapsed_seconds=([DateTime]::UtcNow-$phaseStart).TotalSeconds;executable_tcp_listeners=$listeners.Count;normal_close=$false}
    if($fixedLiveKeyScenario){$item.live_key_held_at_close=[NativeLiveToneNavigationKey]::Held}
    $item.profile_directory=$profileSelection.profile_directory;$item.profile_absent_before_launch=$profileSelection.profile_absent_before_launch
    if($Scenario -in @('song-folder','bulk-import','clean-song','vsq-song','performance-song','pitch-bend','authoring','vsq-authoring','direct-midi','basic-key','complete-practice','canonical-practice','skin','library-catalog','live-tone-navigation','human-mod-timbre','build-diagnostics','assistance','pitch-mod','pitch-sources')){$item.launched_new_process=$true;$item.profile_fresh=$true;$item.profile_reused=$false}
    if($Scenario -in @('complete-practice','canonical-practice')){$item.profile_fresh=$profileSelection.fresh_required;$item.profile_reused=$profileSelection.existing_required}
    if($Scenario -in @('human-mod-timbre','assistance','pitch-mod','pitch-sources')){$item.profile_fresh=$profileSelection.fresh_required;$item.profile_reused=$profileSelection.existing_required}
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
    if($Scenario -in @('song-folder','bulk-import','clean-song','vsq-song','performance-song','pitch-bend','authoring','vsq-authoring','direct-midi','basic-key','complete-practice','canonical-practice','skin','library-catalog','live-tone-navigation','human-mod-timbre','build-diagnostics','assistance','pitch-mod','pitch-sources')){Save-SongFolderSnapshot $phase}
  }
  if($Scenario -in @('song-folder','bulk-import','clean-song','vsq-song','performance-song','pitch-bend','authoring','vsq-authoring','direct-midi','basic-key','complete-practice','canonical-practice','skin','library-catalog','live-tone-navigation','human-mod-timbre','build-diagnostics','assistance','pitch-mod','pitch-sources')) {
    # Restore only the test-owned blocker; no user folder or permissions change.
    if($blockedStage){Remove-Item -LiteralPath $blockedStagePath;Move-Item -LiteralPath $preservedStagePath -Destination $blockedStagePath;$blockedStage=$false}
    $native.ok=$true;Save-Json $native (Join-Path $OutputDirectory $nativeReportName)
    $verifier=if($Scenario -eq 'direct-midi'){'verify-native-direct-midi-evidence.mjs'}elseif($Scenario -eq 'pitch-sources'){'verify-native-pitch-sources.mjs'}elseif($Scenario -eq 'pitch-mod'){'verify-native-pitch-mod-evidence.mjs'}elseif($Scenario -eq 'assistance'){'verify-native-assistance-evidence.mjs'}elseif($Scenario -eq 'human-mod-timbre'){'verify-native-human-mod-timbre-evidence.mjs'}elseif($Scenario -eq 'build-diagnostics'){'verify-native-build-diagnostics.mjs'}elseif($Scenario -eq 'live-tone-navigation'){'verify-native-live-tone-navigation-evidence.mjs'}elseif($Scenario -eq 'library-catalog'){'verify-library-catalog-acceptance.mjs'}elseif($Scenario -eq 'skin'){'verify-native-skin-evidence.mjs'}elseif($Scenario -eq 'canonical-practice'){'verify-canonical-practice-evidence.mjs'}elseif($Scenario -eq 'complete-practice'){'verify-complete-practice-evidence.mjs'}elseif($Scenario -eq 'basic-key'){'verify-basic-key-evidence.mjs'}elseif($Scenario -eq 'vsq-authoring'){'verify-native-vsq-authoring-evidence.mjs'}elseif($Scenario -eq 'authoring'){'verify-native-song-authoring-evidence.mjs'}elseif($Scenario -eq 'pitch-bend'){'verify-native-pitch-bend-evidence.mjs'}elseif($Scenario -eq 'performance-song'){'verify-native-performance-song-evidence.mjs'}elseif($Scenario -eq 'vsq-song'){'verify-native-vsq-song-evidence.mjs'}elseif($Scenario -eq 'clean-song'){'verify-native-clean-song-evidence.mjs'}elseif($Scenario -eq 'bulk-import'){'verify-native-bulk-import-evidence.mjs'}else{'verify-native-song-folder-evidence.mjs'}
    if($Scenario -eq 'direct-midi') {
      $previousExecutable=$env:WMH_DIRECT_MIDI_EXECUTABLE
      try {$env:WMH_DIRECT_MIDI_EXECUTABLE=$Executable;& node (Join-Path $PSScriptRoot $verifier) $OutputDirectory;if($LASTEXITCODE -ne 0){throw 'Native direct MIDI verification failed'}}
      finally {$env:WMH_DIRECT_MIDI_EXECUTABLE=$previousExecutable}
    } elseif($Scenario -eq 'pitch-sources') {
      $previousExecutable=$env:WMH_PITCH_SOURCES_EXECUTABLE
      try {$env:WMH_PITCH_SOURCES_EXECUTABLE=$Executable;& node (Join-Path $PSScriptRoot $verifier) $OutputDirectory;if($LASTEXITCODE -ne 0){throw 'Native source pitch verification failed'}}
      finally {$env:WMH_PITCH_SOURCES_EXECUTABLE=$previousExecutable}
    } elseif($Scenario -eq 'pitch-mod') {
      $previousExecutable=$env:WMH_PITCH_MOD_EXECUTABLE
      try {$env:WMH_PITCH_MOD_EXECUTABLE=$Executable;& node (Join-Path $PSScriptRoot $verifier) $OutputDirectory;if($LASTEXITCODE -ne 0){throw 'Native pitch Mod verification failed'}}
      finally {$env:WMH_PITCH_MOD_EXECUTABLE=$previousExecutable}
    } elseif($Scenario -eq 'assistance') {
      $previousExecutable=$env:WMH_ASSISTANCE_EXECUTABLE
      try {$env:WMH_ASSISTANCE_EXECUTABLE=$Executable;& node (Join-Path $PSScriptRoot $verifier) $OutputDirectory;if($LASTEXITCODE -ne 0){throw 'Native assistance verification failed'}}
      finally {$env:WMH_ASSISTANCE_EXECUTABLE=$previousExecutable}
    } elseif($Scenario -eq 'build-diagnostics') {
      $previousDiagnosticExecutable=$env:WMH_BUILD_DIAGNOSTICS_EXECUTABLE
      try {
        $env:WMH_BUILD_DIAGNOSTICS_EXECUTABLE=$Executable
        & node (Join-Path $PSScriptRoot $verifier) $OutputDirectory
        if($LASTEXITCODE -ne 0){throw 'Native build diagnostics verification failed'}
      } finally {$env:WMH_BUILD_DIAGNOSTICS_EXECUTABLE=$previousDiagnosticExecutable}
    } elseif($Scenario -eq 'skin') {
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
    } elseif($Scenario -eq 'human-mod-timbre') {
      $previousHumanTimbreExecutable=$env:WMH_HUMAN_MOD_TIMBRE_EXECUTABLE
      try {
        $env:WMH_HUMAN_MOD_TIMBRE_EXECUTABLE=$Executable
        & node (Join-Path $PSScriptRoot $verifier) $OutputDirectory
        if($LASTEXITCODE -ne 0){throw 'Native human Mod timbre verification failed'}
      } finally {$env:WMH_HUMAN_MOD_TIMBRE_EXECUTABLE=$previousHumanTimbreExecutable}
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
    if($Scenario -eq 'pitch-sources'){Write-Output 'Focused native Basic FIFO/percussion and semantic VSQ pitch source, audio, no-input scoring and restart gates passed.'}
    elseif($Scenario -eq 'pitch-mod'){Write-Output 'Focused original canonical pitch Mod, trusted D4 mapping, source PCM and saved Mod process restart passed.'}
    elseif($Scenario -eq 'assistance'){Write-Output 'Focused original native assistance, trusted keyboard, source clocks and recipe restart gates passed.'}
    elseif($Scenario -eq 'human-mod-timbre'){Write-Output 'Native original human Mod timbre, trusted KeyR and same-profile migration/restart focused gates passed.'}
    elseif($Scenario -eq 'live-tone-navigation'){Write-Output 'Native finite-window live-gate silence, trusted KeyR navigation and unchanged original take/source focused gates passed.'}
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
  if($fixedLiveKeyScenario) {
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
  } elseif($null -ne $app -and -not $app.HasExited -and (-not $fixedLiveKeyScenario -or -not [NativeLiveToneNavigationKey]::Held)){try{Capture-Window $app "native-failure-$phase"}catch{}}
  $native.ok=$false;$native.error=$failure
  try {Save-Json $native (Join-Path $OutputDirectory $nativeReportName)} catch {[Console]::Error.WriteLine("Could not persist failure report: $($_.Exception.Message)")}
  throw $firstError
} finally {
  try {if($fixedLiveKeyScenario){[void][NativeLiveToneNavigationKey]::ReleaseIfHeld()}}
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
