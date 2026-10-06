# Read-only helpers for the one process owned by the diagnostic CI scenario.
# Dot-sourcing this file neither launches an application nor reads a clipboard.
function Get-BuildDiagnosticsExecutable([string]$Path) {
  $file=Get-Item -LiteralPath $Path -Force -ErrorAction Stop
  if($file.PSIsContainer -or ($file.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0 -or $file.Length -le 0 -or $file.Length -gt 256MB){throw 'Diagnostic executable must be an ordinary bounded file'}
  $bytes=$file.Length;$hash=(Get-FileHash -LiteralPath $file.FullName -Algorithm SHA256).Hash.ToLowerInvariant()
  $file.Refresh();if($file.Length -ne $bytes){throw 'Diagnostic executable changed during host hashing'}
  return [ordered]@{sha256=$hash;bytes=$bytes}
}
function Get-BuildDiagnosticsArchitecture([string]$Path) {
  $stream=[IO.File]::Open($Path,[IO.FileMode]::Open,[IO.FileAccess]::Read,[IO.FileShare]::Read)
  $reader=[IO.BinaryReader]::new($stream)
  try {
    if($reader.ReadUInt16() -ne 0x5a4d -or $stream.Length -lt 64){throw 'Diagnostic executable lacks an MZ header'}
    $stream.Position=0x3c;$offset=$reader.ReadUInt32()
    if($offset -lt 64 -or $offset -gt $stream.Length-6){throw 'Diagnostic PE offset is outside the executable'}
    $stream.Position=$offset;if($reader.ReadUInt32() -ne 0x4550){throw 'Diagnostic executable lacks a PE header'}
    switch($reader.ReadUInt16()) {0x8664{return 'x86_64'} 0xaa64{return 'aarch64'} 0x14c{return 'x86'} default{throw 'Unsupported diagnostic executable architecture'}}
  } finally {$reader.Dispose();$stream.Dispose()}
}
function Get-BuildDiagnosticsLibrarySnapshot([string]$Root) {
  $rootItem=Get-Item -LiteralPath $Root -Force -ErrorAction Stop
  if(-not $rootItem.PSIsContainer -or ($rootItem.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0){throw 'Diagnostic library must be an ordinary owned directory'}
  $rows=[Collections.Generic.List[object]]::new();$pending=[Collections.Generic.Queue[object]]::new();$pending.Enqueue(@{item=$rootItem;depth=0});$nodes=0;$total=0L
  while($pending.Count -gt 0) {
    $entry=$pending.Dequeue()
    foreach($item in $entry.item.EnumerateFileSystemInfos()) {
      $nodes++;if($nodes -gt 2048 -or ($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0){throw 'Linked or unbounded diagnostic library inventory'}
      $name=$item.FullName.Substring($Root.Length+1).Replace('\','/');if($name.Length -gt 512){throw 'Diagnostic library path bound'}
      if(($item.Attributes -band [IO.FileAttributes]::Directory) -ne 0) {if($entry.depth -ge 8){throw 'Diagnostic library depth bound'};$pending.Enqueue(@{item=$item;depth=$entry.depth+1});continue}
      # This process's own lock is not persistent library content.
      if($name -ceq '.library.lock'){continue}
      $total+=$item.Length;if($rows.Count -ge 512 -or $item.Length -gt 16MB -or $total -gt 32MB){throw 'Diagnostic library byte/file bound'}
      $bytes=$item.Length;$hash=(Get-FileHash -LiteralPath $item.FullName -Algorithm SHA256).Hash.ToLowerInvariant();$item.Refresh()
      if($item.Length -ne $bytes){throw 'Diagnostic library changed during snapshot'}
      $rows.Add([ordered]@{path=$name;bytes=$bytes;sha256=$hash})
    }
  }
  return [ordered]@{version=1;files=@($rows | Sort-Object { $_.path })}
}
