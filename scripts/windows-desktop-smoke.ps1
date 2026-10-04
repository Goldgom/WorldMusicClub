param(
  [Parameter(Mandatory = $true)][string]$Executable,
  [string]$OutputDirectory = 'desktop-evidence'
)
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'windows-desktop-evidence.ps1')
$Executable = (Resolve-Path $Executable).Path
New-Item -ItemType Directory -Force $OutputDirectory | Out-Null
$OutputDirectory = (Resolve-Path $OutputDirectory).Path
if (Test-Path (Join-Path $OutputDirectory 'renderer-report.json')) { throw 'Use a fresh evidence directory for each exact executable' }
Add-Type -AssemblyName System.Drawing
Add-Type @'
using System;
using System.Runtime.InteropServices;
public static class NativeDesktopSmoke {
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left, Top, Right, Bottom; }
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr window, out RECT rectangle);
  [DllImport("user32.dll")] public static extern bool PrintWindow(IntPtr window, IntPtr device, uint flags);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr window);
}
'@
$previousDirectory = $env:WMH_DESKTOP_SMOKE_DIR
$env:WMH_DESKTOP_SMOKE_DIR = $OutputDirectory
$app = $null
try {
  $app = Start-Process -FilePath $Executable -PassThru -RedirectStandardError (Join-Path $OutputDirectory 'native-stderr.log')
  $reportFile = Join-Path $OutputDirectory 'renderer-report.json'
  $deadline = [DateTime]::UtcNow.AddSeconds(60)
  while ($null -eq ($report=Read-AcceptanceJsonSnapshot -Path $reportFile -MaximumBytes 64KB -AllowPending)) {
    $app.Refresh()
    if ($app.HasExited) { throw "Native process exited before renderer evidence: $($app.ExitCode)" }
    if ([DateTime]::UtcNow -ge $deadline) { throw 'Native WebView did not report within 60 seconds' }
    Start-Sleep -Milliseconds 200
  }
  # The report write and protocol response finish before screenshot capture.
  $app.Refresh()
  if ($app.MainWindowHandle -eq [IntPtr]::Zero) { throw 'No native top-level application window' }
  $rectangle = New-Object NativeDesktopSmoke+RECT
  if (-not [NativeDesktopSmoke]::GetWindowRect($app.MainWindowHandle,[ref]$rectangle)) { throw 'Cannot measure native window' }
  [NativeDesktopSmoke]::SetForegroundWindow($app.MainWindowHandle) | Out-Null
  $width = $rectangle.Right - $rectangle.Left
  $height = $rectangle.Bottom - $rectangle.Top
  if ($width -lt 640 -or $height -lt 480) { throw 'Native window is unexpectedly small' }
  $bitmap = New-Object System.Drawing.Bitmap($width,$height)
  $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
  $device = $graphics.GetHdc()
  try {
    if (-not [NativeDesktopSmoke]::PrintWindow($app.MainWindowHandle,$device,2)) { throw 'Windows could not capture the actual application window' }
  } finally { $graphics.ReleaseHdc($device) }
  $graphics.Dispose()
  $bitmap.Save((Join-Path $OutputDirectory 'native-window.png'),[System.Drawing.Imaging.ImageFormat]::Png)
  $colors = [System.Collections.Generic.HashSet[int]]::new()
  for ($x = 50; $x -lt $width - 50; $x += 31) {
    for ($y = 70; $y -lt $height - 50; $y += 31) { [void]$colors.Add($bitmap.GetPixel($x,$y).ToArgb()) }
  }
  $bitmap.Dispose()
  $listeners = @(Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue | Where-Object OwningProcess -eq $app.Id)
  $native = [ordered]@{
    source_sha = (git rev-parse HEAD)
    executable_sha256 = (Get-FileHash $Executable -Algorithm SHA256).Hash.ToLower()
    executable_bytes = (Get-Item $Executable).Length
    native_process_id = $app.Id
    window_title = $app.MainWindowTitle
    window_width = $width
    window_height = $height
    sampled_client_colors = $colors.Count
    executable_tcp_listeners = $listeners.Count
    renderer_ok = $report.ok
    renderer_origin = $report.origin
    os = [System.Environment]::OSVersion.VersionString
    normal_close = $false
  }
  $native | ConvertTo-Json -Depth 4 | Set-Content -Encoding utf8 (Join-Path $OutputDirectory 'native-report.json')
  if (-not $report.ok) { throw "Actual WebView smoke failed: $($report.error)" }
  if ($report.origin -ne 'https://wmh.localhost') { throw 'Unexpected persistent app origin' }
  if ($colors.Count -lt 8) { throw 'Window capture lacks sufficient rendered content; inspect PNG' }
  if ($listeners.Count -ne 0) { throw 'Native executable unexpectedly opened a TCP listener' }
  if (-not $app.CloseMainWindow() -or -not $app.WaitForExit(10000)) { throw 'Normal native window close did not stop the app within 10 seconds' }
  if ($app.ExitCode -ne 0) { throw "Native app closed with error $($app.ExitCode)" }
  $native.normal_close = $true
  $native | ConvertTo-Json -Depth 4 | Set-Content -Encoding utf8 (Join-Path $OutputDirectory 'native-report.json')
  Write-Output 'Native Windows process, exact UI, offline notation, Rust compile/import, no listener and normal close passed.'
} finally {
  if ($null -ne $app -and -not $app.HasExited) { Stop-Process -Id $app.Id }
  $env:WMH_DESKTOP_SMOKE_DIR = $previousDirectory
}
