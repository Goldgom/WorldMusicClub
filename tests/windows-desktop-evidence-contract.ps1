# Called by windows-desktop-contract.ps1. Real file handles only; no app, window,
# sleep, probabilistic race, retry loop, or altered evidence from a native run.
Add-Type @'
using System;
using System.ComponentModel;
using System.Runtime.InteropServices;
using Microsoft.Win32.SafeHandles;
public static class NativeSnapshotContract {
  [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)]
  private static extern SafeFileHandle CreateFileW(string path, uint access, uint share, IntPtr security, uint creation, uint flags, IntPtr template);
  public static SafeFileHandle HoldReplacementAccess(string path) {
    // DELETE access reproduces the sharing requirement of atomic replacement,
    // without marking/deleting the path or changing any of its bytes.
    var handle=CreateFileW(path,0x00010000,7,IntPtr.Zero,3,0,IntPtr.Zero);
    if(handle.IsInvalid) { int error=Marshal.GetLastWin32Error();handle.Dispose();throw new Win32Exception(error); }
    return handle;
  }
}
'@
function Assert-SharingRejected([scriptblock]$Operation,[string]$Label) {
  try { & $Operation } catch {
    $failure=$_.Exception
    while($null -ne $failure.InnerException){$failure=$failure.InnerException}
    Assert-True (($failure.HResult -band 0xffff) -eq 32) "$Label is a Windows sharing violation"
    return
  }
  throw "Contract unexpectedly accepted: $Label"
}
$snapshotRoot=Join-Path ([IO.Path]::GetTempPath()) ('wmh snapshot 拼谱 '+[guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory $snapshotRoot | Out-Null
$replacement=$null;$staging=$null;$oldReader=$null;$exclusive=$null
try {
  $writer=Join-Path $snapshotRoot 'native-evidence-publish.exe'
  & rustc --edition=2021 (Join-Path $PSScriptRoot 'native-evidence-publish.rs') -o $writer
  if($LASTEXITCODE -ne 0){throw 'Could not compile the exact Rust evidence writer'}
  # All live host evidence kinds use this protocol, including the failure site.
  foreach($name in @('trace-performance-seed.json','action-performance-seed-1.json','renderer-performance-seed.json','profile-performance-seed.json','renderer-report.json')) {
    $snapshot=Join-Path $snapshotRoot $name;$temporary="$snapshot.tmp"
    Assert-True ($null -eq (Read-AcceptanceJsonSnapshot -Path $snapshot -MaximumBytes 512KB -AllowPending)) 'missing snapshot is pending only when allowed'
    Assert-Rejected { Read-AcceptanceJsonSnapshot -Path $snapshot -MaximumBytes 512KB } 'required final snapshot cannot be pending'
    [IO.File]::WriteAllText($snapshot,'{"version":1,"marker":"complete old 拼谱"}')
    $replacement=[NativeSnapshotContract]::HoldReplacementAccess($snapshot)
    Assert-SharingRejected { Get-Content -LiteralPath $snapshot -Raw -ErrorAction Stop } 'legacy Get-Content during held replacement access'
    Assert-True ((Read-AcceptanceJsonSnapshot -Path $snapshot -MaximumBytes 512KB).marker -ceq 'complete old 拼谱') 'actual reader succeeds while replacement access remains held'
    $oldReader=[IO.File]::Open($snapshot,[IO.FileMode]::Open,[IO.FileAccess]::Read,([IO.FileShare]::ReadWrite -bor [IO.FileShare]::Delete))
    $staging=[IO.File]::Open($temporary,[IO.FileMode]::CreateNew,[IO.FileAccess]::Write,[IO.FileShare]::None)
    $partial=[Text.Encoding]::UTF8.GetBytes('{"version":2,"marker":')
    $staging.Write($partial,0,$partial.Length);$staging.Flush()
    Assert-True ((Read-AcceptanceJsonSnapshot -Path $snapshot -MaximumBytes 512KB).version -eq 1) 'partial staging bytes never become published evidence'
    $tail=[Text.Encoding]::UTF8.GetBytes('"complete new 日本語"}')
    $staging.Write($tail,0,$tail.Length);$staging.Dispose();$staging=$null
    # File.Move is not equivalent to Rust std::fs::rename on Windows. Call the
    # production writer, including its actual platform implementation, instead.
    $expected=Join-Path $snapshotRoot 'expected-payload.json'
    [IO.File]::WriteAllText($expected,'{"version":2,"marker":"complete new 日本語"}')
    & $writer $snapshotRoot $name $expected
    if($LASTEXITCODE -ne 0){throw 'The production Rust writer failed while snapshot handles remained open'}
    Assert-True ((Read-AcceptanceJsonSnapshot -Path $snapshot -MaximumBytes 512KB).marker -ceq 'complete new 日本語') 'replacement publishes the whole new snapshot while old handles remain open'
    $oldText=[IO.StreamReader]::new($oldReader,[Text.Encoding]::UTF8,$true,1024,$true)
    try { Assert-True (($oldText.ReadToEnd() | ConvertFrom-Json).marker -ceq 'complete old 拼谱') 'an already-open reader retains a complete old snapshot' }
    finally { $oldText.Dispose() }
    $oldReader.Dispose();$oldReader=$null;$replacement.Dispose();$replacement=$null
    Assert-True (-not (Test-Path -LiteralPath $temporary)) 'published staging path is consumed'
  }
  $snapshot=Join-Path $snapshotRoot 'invalid.json'
  foreach($text in @('','{','null','[]','[{}]','[{"x":1},{"x":2}]','false','"string"')) {
    [IO.File]::WriteAllText($snapshot,$text)
    Assert-Rejected { Read-AcceptanceJsonSnapshot -Path $snapshot -MaximumBytes 512KB -AllowPending } "published malformed/non-object snapshot cannot be classified as pending: <$text>"
  }
  [IO.File]::WriteAllText($snapshot,' {"values":[{},null,1],"enabled":false} ')
  $nested=Read-AcceptanceJsonSnapshot -Path $snapshot -MaximumBytes 512KB
  Assert-True ($nested.values.Count -eq 3 -and $nested.enabled -eq $false) 'valid root object keeps nested arrays, null and scalar properties'
  [IO.File]::WriteAllBytes($snapshot,[byte[]]@(123,34,120,34,58,34,255,34,125))
  Assert-Rejected { Read-AcceptanceJsonSnapshot -Path $snapshot -MaximumBytes 512KB -AllowPending } 'invalid UTF-8 is a hard failure'
  [IO.File]::WriteAllText($snapshot,'{"value":"bounded"}')
  $bytes=(Get-Item -LiteralPath $snapshot).Length
  Assert-True ((Read-AcceptanceJsonSnapshot -Path $snapshot -MaximumBytes $bytes).value -ceq 'bounded') 'exact byte limit is accepted'
  Assert-Rejected { Read-AcceptanceJsonSnapshot -Path $snapshot -MaximumBytes ($bytes-1) -AllowPending } 'one byte over the bound fails without retry'
  $exclusive=[IO.File]::Open($snapshot,[IO.FileMode]::Open,[IO.FileAccess]::ReadWrite,[IO.FileShare]::None)
  Assert-SharingRejected { Read-AcceptanceJsonSnapshot -Path $snapshot -MaximumBytes 512KB -AllowPending } 'unrelated exclusive lock is a failure, not pending'
  $exclusive.Dispose();$exclusive=$null
  Assert-Rejected { Read-AcceptanceJsonSnapshot -Path $snapshotRoot -MaximumBytes 512KB -AllowPending } 'a directory is not unpublished JSON'
  Assert-Rejected { Read-AcceptanceJsonSnapshot -Path (Join-Path $snapshotRoot 'missing-parent/file.json') -MaximumBytes 512KB -AllowPending } 'missing parent is not a pending publication'
} finally {
  foreach($handle in @($exclusive,$staging,$oldReader,$replacement)){if($null -ne $handle){$handle.Dispose()}}
  Remove-Item -LiteralPath $snapshotRoot -Recurse -Force
}
