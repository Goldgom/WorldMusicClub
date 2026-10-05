# Bounded, process-owner-only inspection of the isolated original fixture library.
# Sourcing this helper starts no application and performs no native calls.
function Get-CatalogAcceptanceSnapshot([string]$Root,[switch]$BeforeBootstrap) {
  if(-not [IO.Path]::IsPathFullyQualified($Root)){throw 'Catalog snapshot root must be absolute'}
  $rootItem=Get-Item -LiteralPath $Root -Force -ErrorAction Stop
  if(-not $rootItem.PSIsContainer -or ($rootItem.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0){throw 'Catalog snapshot root must be an ordinary directory'}
  $rows=[Collections.Generic.List[object]]::new()
  $pending=[Collections.Generic.Queue[object]]::new()
  $nodes=0;$totalBytes=0L
  $payloadAreas=@('songs','backups','clean-songs','clean-backups','imports','import-backups')
  $catalogAreas=@('catalog','catalog-backups','.catalog-staging')
  foreach($area in ($payloadAreas+$catalogAreas)) {
    $path=Join-Path $Root $area
    $item=Get-AcceptancePathItem $path
    if($null -eq $item) {
      if($BeforeBootstrap -and $area -cin $catalogAreas){continue}
      throw "Catalog snapshot area is missing: $area"
    }
    if(-not $item.PSIsContainer -or ($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0){throw "Catalog snapshot area must be an ordinary directory: $area"}
  }
  $pending.Enqueue(@{item=$rootItem;depth=0})
  while($pending.Count -gt 0) {
    $entry=$pending.Dequeue()
    # Enumerate only one already checked directory at a time. Reparse points are
    # rejected before descent; no recursive filesystem traversal follows links.
    foreach($item in $entry.item.EnumerateFileSystemInfos()) {
      $nodes++
      if($nodes -gt 2048){throw 'Catalog snapshot exceeds 2048 nodes'}
      if(($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0){throw 'Reparse points cannot be catalog acceptance artifacts'}
      $relative=$item.FullName.Substring($Root.Length+1).Replace('\','/')
      if($relative.Length -gt 512){throw 'Catalog snapshot path exceeds 512 characters'}
      # The product's process lock is not durable catalog or payload evidence.
      if($relative -ceq '.library.lock' -and ($item.Attributes -band [IO.FileAttributes]::Directory) -eq 0){continue}
      if(($item.Attributes -band [IO.FileAttributes]::Directory) -ne 0) {
        if($entry.depth -ge 8){throw 'Catalog snapshot exceeds eight nested directory levels'}
        $pending.Enqueue(@{item=$item;depth=$entry.depth+1})
        continue
      }
      if($rows.Count -ge 512){throw 'Catalog snapshot exceeds 512 files'}
      if($item.Length -gt 16MB){throw 'Catalog snapshot file exceeds 16 MiB'}
      $stream=[IO.File]::Open($item.FullName,[IO.FileMode]::Open,[IO.FileAccess]::Read,[IO.FileShare]::Read)
      $hash=[Security.Cryptography.SHA256]::Create();$bytes=0L
      try {
        $buffer=New-Object byte[] 65536
        while(($count=$stream.Read($buffer,0,$buffer.Length)) -gt 0) {
          $bytes+=$count;$totalBytes+=$count
          if($bytes -gt 16MB -or $totalBytes -gt 32MB){throw 'Catalog snapshot exceeds its file or aggregate byte bound'}
          [void]$hash.TransformBlock($buffer,0,$count,$buffer,0)
        }
        [void]$hash.TransformFinalBlock([byte[]]::new(0),0,0)
        if($bytes -ne $item.Length){throw 'Catalog snapshot file changed during read'}
        $digest=[BitConverter]::ToString($hash.Hash).Replace('-','').ToLowerInvariant()
      } finally {$hash.Dispose();$stream.Dispose()}
      $rows.Add([ordered]@{path=$relative;sha256=$digest;bytes=$bytes})
    }
  }
  return [ordered]@{version=1;files=@($rows | Sort-Object { $_.path })}
}
