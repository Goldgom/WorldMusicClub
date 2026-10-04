# Host JSON is written to a closed sibling .tmp and atomically renamed. The
# published file is immutable for the lifetime of an open reader handle. Windows
# readers must share Delete as well as ReadWrite so publication and reads can
# overlap; Get-Content's sharing contract is insufficient during replacement.
function Read-AcceptanceJsonSnapshot {
  param(
    [Parameter(Mandatory=$true)][string]$Path,
    [Parameter(Mandatory=$true)][ValidateRange(1,4194304)][int]$MaximumBytes,
    [switch]$AllowPending
  )
  $stream=$null
  try {
    try {
      $stream=[IO.File]::Open($Path,[IO.FileMode]::Open,[IO.FileAccess]::Read,([IO.FileShare]::ReadWrite -bor [IO.FileShare]::Delete))
    } catch [IO.FileNotFoundException] {
      # Only an unpublished path is pending. Sharing/access errors, invalid
      # bytes and malformed published JSON must remain visible failures.
      if($AllowPending){return $null}
      throw
    }
    $length=$stream.Length
    if($length -le 0 -or $length -gt $MaximumBytes){throw "Invalid bounded acceptance JSON snapshot ($length bytes, limit $MaximumBytes): $Path"}
    $bytes=[byte[]]::new([int]$length)
    $offset=0
    while($offset -lt $bytes.Length) {
      $read=$stream.Read($bytes,$offset,$bytes.Length-$offset)
      if($read -eq 0){throw "Published acceptance JSON snapshot was truncated: $Path"}
      $offset+=$read
    }
    if($stream.ReadByte() -ne -1){throw "Published acceptance JSON snapshot grew while reading: $Path"}
    $text=[Text.UTF8Encoding]::new($false,$true).GetString($bytes)
    # Accept a UTF-8 BOM from PowerShell-generated contract fixtures too.
    if($text.Length -gt 0 -and $text[0] -eq [char]0xFEFF){$text=$text.Substring(1)}
    $value=ConvertFrom-Json -InputObject $text -NoEnumerate -ErrorAction Stop
    if($value -isnot [pscustomobject]){throw "Published acceptance JSON snapshot must be an object: $Path"}
    return $value
  } finally {
    if($null -ne $stream){$stream.Dispose()}
  }
}
