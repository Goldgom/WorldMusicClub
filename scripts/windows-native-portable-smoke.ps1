param(
  [Parameter(Mandatory=$true)][string]$Directory,
  [string]$OutputDirectory='desktop-portable'
)
$ErrorActionPreference='Stop'
$Directory=(Resolve-Path $Directory).Path
$Executable=Join-Path $Directory 'WorldMusicHub-Native.exe'
$info=Get-Content (Join-Path $Directory 'BUILD-INFO.json') -Raw | ConvertFrom-Json
if($info.name -cne 'WorldMusicHub-Native' -or $info.executable -cne 'WorldMusicHub-Native.exe'){throw 'Wrong native package identity'}
if((Get-FileHash $Executable -Algorithm SHA256).Hash.ToLowerInvariant() -cne $info.files.'WorldMusicHub-Native.exe'.sha256){throw 'Extracted EXE differs from accepted inventory'}
if($info.git_commit -cne (git rev-parse HEAD) -or $info.git_tree -cne (git rev-parse 'HEAD^{tree}') -or $info.commit_count -ne [int](git rev-list --count HEAD)){throw 'Extracted source provenance differs'}
if(Test-Path $OutputDirectory){throw 'Use fresh portable evidence directory'}
New-Item -ItemType Directory $OutputDirectory | Out-Null
$OutputDirectory=(Resolve-Path $OutputDirectory).Path
Add-Type -AssemblyName UIAutomationClient,UIAutomationTypes,System.Drawing
Add-Type @'
using System;
using System.Runtime.InteropServices;
public static class NativePortableSmoke {
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left, Top, Right, Bottom; }
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr window, out RECT rectangle);
  [DllImport("user32.dll")] public static extern bool PrintWindow(IntPtr window, IntPtr device, uint flags);
}
'@
# Exercise the actual normal startup path. No initialization script, redirected
# download hook, test API or WMH-selected WebView profile is active in this process.
$previousDirectory=$env:WMH_DESKTOP_SMOKE_DIR;$previousPhase=$env:WMH_DESKTOP_ACCEPTANCE_PHASE
$env:WMH_DESKTOP_SMOKE_DIR=$null;$env:WMH_DESKTOP_ACCEPTANCE_PHASE=$null
$app=$null
$report=[ordered]@{version=1;source_sha=$info.git_commit;source_tree=$info.git_tree;commit_count=$info.commit_count;executable_sha256=$info.files.'WorldMusicHub-Native.exe'.sha256;normal_startup=$true;test_hooks_enabled=$false;ok=$false;normal_close=$false;clean_machine_installation=$false}
try {
  $app=Start-Process -FilePath $Executable -WorkingDirectory $Directory -PassThru -RedirectStandardError (Join-Path $OutputDirectory 'normal-stderr.log')
  $deadline=[DateTime]::UtcNow.AddSeconds(60)
  $ready=$false
  while(-not $ready){
    $app.Refresh()
    if($app.HasExited){throw "Normal startup exited before ready: $($app.ExitCode)"}
    if([DateTime]::UtcNow -ge $deadline){throw 'Normal startup did not expose the enabled Single player home-menu control within 60 seconds'}
    if($app.MainWindowHandle -ne [IntPtr]::Zero){
      try{
        $root=[System.Windows.Automation.AutomationElement]::FromHandle($app.MainWindowHandle)
        $condition=[System.Windows.Automation.PropertyCondition]::new([System.Windows.Automation.AutomationElement]::ControlTypeProperty,[System.Windows.Automation.ControlType]::Button)
        foreach($button in $root.FindAll([System.Windows.Automation.TreeScope]::Descendants,$condition)){
          # Startup now exposes the home menu. Listen belongs to the hidden
          # library and cannot prove that the normal startup screen rendered.
          $name=($button.Current.Name -replace '\s+',' ').Trim()
          if($button.Current.IsEnabled -and -not $button.Current.IsOffscreen -and ($button.Current.AutomationId -ceq 'home-single-player' -or $name -in @('单人模式 选一首曲子，进入你的音乐舞台','Single player Choose a song. Make the stage yours.'))){
            $report.startup_control=[ordered]@{automation_id=$button.Current.AutomationId;name=$name;enabled=$true;offscreen=$false}
            $ready=$true;break
          }
        }
      }catch [System.Windows.Automation.ElementNotAvailableException]{
        # The startup tree can be replaced while WebView realizes its controls.
        # Retry only that transient within the same fixed deadline.
      }
    }
    if(-not $ready){Start-Sleep -Milliseconds 200}
  }
  $report.window_title=$app.MainWindowTitle
  if($app.MainWindowTitle -cne 'WorldMusicHub'){throw 'Unexpected normal native window title'}
  $rectangle=New-Object NativePortableSmoke+RECT
  if(-not [NativePortableSmoke]::GetWindowRect($app.MainWindowHandle,[ref]$rectangle)){throw 'Cannot measure normal window'}
  $width=$rectangle.Right-$rectangle.Left;$height=$rectangle.Bottom-$rectangle.Top
  $report.window_width=$width;$report.window_height=$height
  if($width -lt 640 -or $height -lt 480){throw 'Unexpected normal window size'}
  $bitmap=New-Object System.Drawing.Bitmap($width,$height)
  $graphics=[System.Drawing.Graphics]::FromImage($bitmap);$device=$graphics.GetHdc()
  try{if(-not [NativePortableSmoke]::PrintWindow($app.MainWindowHandle,$device,2)){throw 'Cannot capture normal native window'}}
  finally{$graphics.ReleaseHdc($device);$graphics.Dispose()}
  try{
    $bitmap.Save((Join-Path $OutputDirectory 'normal-native-window.png'),[System.Drawing.Imaging.ImageFormat]::Png)
    $colors=[System.Collections.Generic.HashSet[int]]::new()
    for($x=50;$x -lt $width-50;$x+=31){for($y=70;$y -lt $height-50;$y+=31){[void]$colors.Add($bitmap.GetPixel($x,$y).ToArgb())}}
    $report.sampled_client_colors=$colors.Count
    if($colors.Count -lt 8){throw 'Normal window lacks rendered content; inspect screenshot'}
  }finally{$bitmap.Dispose()}
  $listeners=@(Get-NetTCPConnection -State Listen -ErrorAction Stop | Where-Object OwningProcess -eq $app.Id)
  $report.executable_tcp_listeners=$listeners.Count
  if($listeners.Count -ne 0){throw 'Normal native executable unexpectedly opened a TCP listener'}
  if(-not $app.CloseMainWindow() -or -not $app.WaitForExit(10000)){throw 'Normal extracted window did not close within 10 seconds'}
  if($app.ExitCode -ne 0){throw "Normal extracted process exited with error $($app.ExitCode)"}
  $report.normal_close=$true;$report.ok=$true
  Write-Output 'Exact extracted native EXE started normally with enabled app controls, rendered its window, had no EXE listener and closed normally.'
}catch{$report.error=$_.Exception.Message;throw}
finally{
  $report | ConvertTo-Json -Depth 6 | Set-Content -Encoding utf8 (Join-Path $OutputDirectory 'normal-native-report.json')
  if($null -ne $app -and -not $app.HasExited){Stop-Process -Id $app.Id}
  $env:WMH_DESKTOP_SMOKE_DIR=$previousDirectory;$env:WMH_DESKTOP_ACCEPTANCE_PHASE=$previousPhase
}
