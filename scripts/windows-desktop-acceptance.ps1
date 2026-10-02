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
Add-Type @'
using System;
using System.Runtime.InteropServices;
using System.Text;
public static class NativeAcceptance {
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left,Top,Right,Bottom; }
  [StructLayout(LayoutKind.Sequential)] public struct POINT { public int X,Y; }
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h,out RECT r);
  [DllImport("user32.dll")] public static extern bool GetClientRect(IntPtr h,out RECT r);
  [DllImport("user32.dll")] public static extern bool ClientToScreen(IntPtr h,ref POINT p);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern IntPtr GetAncestor(IntPtr h,uint flags);
  [DllImport("user32.dll",CharSet=CharSet.Unicode)] public static extern int GetClassName(IntPtr h,StringBuilder text,int length);
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int x,int y);
  [DllImport("user32.dll")] public static extern void mouse_event(uint flags,uint x,uint y,uint data,UIntPtr extra);
  [DllImport("user32.dll")] public static extern void keybd_event(byte key,byte scan,uint flags,UIntPtr extra);
  [DllImport("user32.dll")] public static extern uint MapVirtualKey(uint key,uint mode);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h,int command);
  [DllImport("user32.dll")] public static extern bool PrintWindow(IntPtr h,IntPtr device,uint flags);
  public static void Key(byte key) { byte scan=(byte)MapVirtualKey(key,0); keybd_event(key,scan,0,UIntPtr.Zero); keybd_event(key,scan,2,UIntPtr.Zero); }
  public static void Click(int x,int y) { SetCursorPos(x,y); mouse_event(2,0,0,0,UIntPtr.Zero); mouse_event(4,0,0,0,UIntPtr.Zero); }
}
'@
function Save-Json($Value,[string]$Path) {
  $temporary="$Path.tmp"
  $Value | ConvertTo-Json -Depth 16 | Set-Content -Encoding utf8 $temporary
  Move-Item -Force $temporary $Path
}
function Capture-Window($App,[string]$Name) {
  $rectangle=New-Object NativeAcceptance+RECT
  if (-not [NativeAcceptance]::GetWindowRect($App.MainWindowHandle,[ref]$rectangle)) { throw 'Cannot read native window bounds' }
  $bitmap=New-Object System.Drawing.Bitmap(($rectangle.Right-$rectangle.Left),($rectangle.Bottom-$rectangle.Top))
  $graphics=[System.Drawing.Graphics]::FromImage($bitmap);$device=$graphics.GetHdc()
  try { if(-not [NativeAcceptance]::PrintWindow($App.MainWindowHandle,$device,2)){throw 'Native screenshot failed'} }
  finally { $graphics.ReleaseHdc($device);$graphics.Dispose() }
  try { $bitmap.Save((Join-Path $OutputDirectory "$Name.png"),[System.Drawing.Imaging.ImageFormat]::Png) }
  finally { $bitmap.Dispose() }
}
function Find-Control($Root,[string]$Id) {
  $condition=[System.Windows.Automation.PropertyCondition]::new([System.Windows.Automation.AutomationElement]::AutomationIdProperty,$Id)
  return $Root.FindFirst([System.Windows.Automation.TreeScope]::Descendants,$condition)
}
function Native-Action($App,$Action) {
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
  if($Action.kind -eq 'cancel-picker'){[NativeAcceptance]::Key(0x1B);return}
  $name=[string]$Action.file
  if($name -match '^(seed|restart|close-active|reopen)-(?:[1-9]|1[0-6])\.json$'){$path=Join-Path (Join-Path $OutputDirectory 'downloads') $name}
  elseif($name -in @('original-duet.musicxml','original-duet.mxl','midi-original-ppq.mid','jianpu-original-steps.jianpu','malformed.json')){$path=Join-Path $Fixtures $name}
  else{throw 'File is outside the finite acceptance fixture list'}
  $path=(Resolve-Path $path).Path
  $root=[System.Windows.Automation.AutomationElement]::FromHandle($dialog)
  $filename=Find-Control $root '1148'
  if($null -eq $filename){throw 'Windows file-name control (1148) is missing'}
  $pattern=$null
  if(-not $filename.TryGetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern,[ref]$pattern)) {
    $filename=Find-Control $filename '1001'
    if($null -eq $filename -or -not $filename.TryGetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern,[ref]$pattern)){throw 'Windows file-name control is not editable'}
  }
  ([System.Windows.Automation.ValuePattern]$pattern).SetValue($path)
  $open=Find-Control $root '1'
  if($null -eq $open){throw 'Windows Open button is missing'}
  ([System.Windows.Automation.InvokePattern]$open.GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern)).Invoke()
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
        try{Native-Action $app $action;$result.ok=$true}catch{$result.error=$_.Exception.Message}
        Save-Json $result (Join-Path $OutputDirectory "result-$phase-$sequence.json");$sequence++
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
