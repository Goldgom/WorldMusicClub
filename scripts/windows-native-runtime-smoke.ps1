param(
  [Parameter(Mandatory=$true)][string]$Archive,
  [Parameter(Mandatory=$true)][string]$ExpectedSha256,
  [Parameter(Mandatory=$true)][string]$ExpectedFullSha256,
  [Parameter(Mandatory=$true)][string]$Destination,
  [Parameter(Mandatory=$true)][string]$OutputDirectory,
  [Parameter(Mandatory=$true)][string]$Commit,
  [Parameter(Mandatory=$true)][string]$Tree,
  [Parameter(Mandatory=$true)][string]$RunId,
  [Parameter(Mandatory=$true)][string]$Repository,
  [Parameter(Mandatory=$true)][string]$FullArtifactId
)
$ErrorActionPreference='Stop'
# The trusted hash is the current producer step's output, not a downloaded
# sidecar. Verification fails before extracting or launching any executable.
python (Join-Path $PSScriptRoot 'native-runtime-delivery.py') extract --archive $Archive --expected-sha256 $ExpectedSha256 --expected-full-sha256 $ExpectedFullSha256 --destination $Destination --commit $Commit --tree $Tree --run-id $RunId --repository $Repository --full-artifact-id $FullArtifactId
if ($LASTEXITCODE -ne 0) { throw 'Runtime identity, inventory or extraction verification failed' }
# Exercise the unchanged ordinary startup consumer in a fresh extracted root.
# It checks the bound EXE, visible enabled home control, actual window pixels,
# no EXE TCP listener and normal close, with acceptance hooks cleared.
& (Join-Path $PSScriptRoot 'windows-native-portable-smoke.ps1') -Directory (Join-Path $Destination 'WorldMusicClub-Native') -OutputDirectory $OutputDirectory
