# Read-only measurements of the already owned app window. No desktop/DPI changes.
function Get-NativeWindowGeometry($App,[string]$Phase,[string]$Stage,$Renderer=$null,$ReportedViewport=$null) {
  $App.Refresh();$window=$App.MainWindowHandle
  if($window -eq [IntPtr]::Zero -or -not [NativeAcceptance]::IsWindow($window)){throw 'No current owned app window for geometry'}
  [uint32]$owner=0;[void][NativeAcceptance]::GetWindowThreadProcessId($window,[ref]$owner)
  $root=[NativeAcceptance]::GetAncestor($window,2)
  if($owner -ne $App.Id -or $root -ne $window){throw 'Geometry handle does not belong to the current top-level app process'}
  $client=New-Object NativeAcceptance+RECT;$outer=New-Object NativeAcceptance+RECT;$origin=New-Object NativeAcceptance+POINT
  if(-not [NativeAcceptance]::GetClientRect($window,[ref]$client)){throw 'Cannot measure actual client rectangle'}
  if(-not [NativeAcceptance]::GetWindowRect($window,[ref]$outer)){throw 'Cannot measure actual window rectangle'}
  if(-not [NativeAcceptance]::ClientToScreen($window,[ref]$origin)){throw 'Cannot measure client origin'}
  $monitor=[NativeAcceptance]::MonitorFromWindow($window,2);$info=New-Object NativeAcceptance+MONITORINFO
  $info.Size=[Runtime.InteropServices.Marshal]::SizeOf([type][NativeAcceptance+MONITORINFO])
  if($monitor -eq [IntPtr]::Zero -or -not [NativeAcceptance]::GetMonitorInfo($monitor,[ref]$info)){throw 'Cannot measure app monitor and work area'}
  $foreground=[NativeAcceptance]::GetForegroundWindow()
  $dpi=[NativeAcceptance]::GetDpiForWindow($window)
  $windowAwareness=[NativeAcceptance]::GetAwarenessFromDpiAwarenessContext([NativeAcceptance]::GetWindowDpiAwarenessContext($window))
  $callerAwareness=[NativeAcceptance]::GetAwarenessFromDpiAwarenessContext([NativeAcceptance]::GetThreadDpiAwarenessContext())
  [int]$scale=0;$scaleResult=[NativeAcceptance]::GetScaleFactorForMonitor($monitor,[ref]$scale)
  $extended=New-Object NativeAcceptance+RECT;$extendedResult=[NativeAcceptance]::DwmGetWindowAttribute($window,9,[ref]$extended,[uint32][Runtime.InteropServices.Marshal]::SizeOf([type][NativeAcceptance+RECT]))
  return [ordered]@{
    version=1;kind='native-window-geometry';phase=$Phase;stage=$Stage;process_id=$App.Id;owner_process_id=$owner
    hwnd=$window.ToInt64();root_hwnd=$root.ToInt64();foreground_hwnd=$foreground.ToInt64()
    coordinate_space='Win32 caller context, independently checked against renderer DPR and PNG pixels'
    client_rect=@($client.Left,$client.Top,$client.Right,$client.Bottom);client_origin=@($origin.X,$origin.Y)
    window_rect=@($outer.Left,$outer.Top,$outer.Right,$outer.Bottom)
    extended_frame_rect=$(if($extendedResult -eq 0){@($extended.Left,$extended.Top,$extended.Right,$extended.Bottom)}else{$null})
    extended_frame_hresult=$extendedResult;monitor_handle=$monitor.ToInt64();monitor_rect=@($info.Monitor.Left,$info.Monitor.Top,$info.Monitor.Right,$info.Monitor.Bottom)
    work_area=@($info.Work.Left,$info.Work.Top,$info.Work.Right,$info.Work.Bottom)
    window_dpi=$dpi;window_awareness=$windowAwareness;caller_awareness=$callerAwareness
    monitor_dpi=$(if($windowAwareness -eq 2 -and $dpi -gt 0){$dpi}else{$null});monitor_dpi_source='GetDpiForWindow only when the target window is per-monitor aware'
    monitor_scale_percent=$(if($scaleResult -eq 0){$scale}else{$null});monitor_scale_hresult=$scaleResult
    renderer=$Renderer;reported_viewport=$ReportedViewport
  }
}

function Capture-NativeFailurePixels($App,[string]$Directory,[string]$Name) {
  # Failure diagnostics never enter the accepted screenshot list. Preserve the
  # measured client bitmap without scaling, even below the acceptance minimum.
  $App.Refresh();$window=$App.MainWindowHandle;[uint32]$owner=0
  [void][NativeAcceptance]::GetWindowThreadProcessId($window,[ref]$owner)
  if($window -eq [IntPtr]::Zero -or $owner -ne $App.Id -or [NativeAcceptance]::GetAncestor($window,2) -ne $window){throw 'Failure capture is not the current owned app window'}
  $rectangle=New-Object NativeAcceptance+RECT
  if(-not [NativeAcceptance]::GetClientRect($window,[ref]$rectangle)){throw 'Cannot measure failure client bounds'}
  $width=$rectangle.Right-$rectangle.Left;$height=$rectangle.Bottom-$rectangle.Top
  if($width -le 0 -or $height -le 0 -or $width -gt 8192 -or $height -gt 8192 -or [int64]$width*$height -gt 16777216){throw 'Failure capture exceeds its finite actual-pixel bound'}
  $bitmap=New-Object System.Drawing.Bitmap($width,$height)
  try {
    $graphics=[System.Drawing.Graphics]::FromImage($bitmap);$device=$graphics.GetHdc()
    try {if(-not [NativeAcceptance]::PrintWindow($window,$device,3)){throw 'Actual owned failure pixels could not be captured'}}
    finally {$graphics.ReleaseHdc($device);$graphics.Dispose()}
    $path=Join-Path $Directory "$Name.png";$bitmap.Save($path,[System.Drawing.Imaging.ImageFormat]::Png)
    $file=Get-Item -LiteralPath $path -Force
    if($file.Length -le 0 -or $file.Length -gt 16MB -or ($file.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0){throw 'Failure PNG must be an ordinary bounded file'}
    return [ordered]@{kind='diagnostic-only';accepted=$false;file="$Name.png";bytes=$file.Length;sha256=(Get-FileHash -LiteralPath $path -Algorithm SHA256).Hash.ToLowerInvariant();width=$bitmap.Width;height=$bitmap.Height;resized=$false}
  } finally {$bitmap.Dispose()}
}

function New-NativeFailureDiagnostics([string]$Phase,[string]$FirstError,[scriptblock]$Measure,[scriptblock]$Capture) {
  $result=[ordered]@{version=1;kind='diagnostic-only';accepted=$false;phase=$Phase;first_error=$FirstError;errors=@();geometry=$null;capture=$null}
  try {$result.geometry=& $Measure} catch {$result.errors+=,"geometry: $($_.Exception.Message)"}
  try {$result.capture=& $Capture} catch {$result.errors+=,"capture: $($_.Exception.Message)"}
  return $result
}

# Classify catalog capture metadata before registering it. Full owned-dialog
# diagnostics cannot satisfy client action/phase coverage or borrow app geometry.
function Get-CatalogCaptureAssociation([string]$Name,[string]$Phase,[switch]$ClientOnly,[string]$GeometryFile) {
  if($Phase -cnotin @('catalog-seed','catalog-restart','catalog-final')){throw 'Unknown catalog capture phase'}
  $sequence='([1-9]|[1-5][0-9]|6[0-4])'
  if($ClientOnly) {
    $metadata=[ordered]@{phase=$Phase;locale='zh-CN';geometry_file=$GeometryFile}
    if($Name -cmatch "\Anative-action-$Phase-$sequence\z"){$metadata.action=[int]$Matches[1]}
    elseif($Name -cne "native-$Phase"){throw 'Catalog client capture must name its exact action or phase'}
    if($GeometryFile -cne "geometry-$Name.json"){throw 'Catalog client capture must bind its own geometry'}
    return @{manifest='screenshots';metadata=$metadata}
  }
  if($GeometryFile){throw 'Catalog dialog diagnostic cannot borrow app geometry'}
  if($Name -cnotmatch "\Aowned-(picker-before-open|picker-failure|popup-failure)-$Phase-$sequence\z"){throw 'Unknown catalog dialog diagnostic'}
  return @{manifest='diagnostic_screenshots';metadata=[ordered]@{kind='diagnostic-only';accepted=$false;phase=$Phase;capture=$Matches[1];action=[int]$Matches[2]}}
}
