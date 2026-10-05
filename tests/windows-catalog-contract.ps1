# Included by windows-desktop-contract.ps1. Pure file/profile/allowlist tests only.
. (Join-Path $PSScriptRoot '../scripts/windows-desktop-catalog-snapshot.ps1')
$catalogRoot=Join-Path ([IO.Path]::GetTempPath()) ('wmh catalog contract '+[guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory $catalogRoot | Out-Null
try {
  foreach($phase in @('catalog-restart','catalog-final')) {
    Assert-Rejected { Assert-AcceptanceProfileLaunch $catalogRoot $phase } 'catalog restart cannot create a missing profile'
  }
  $selection=Assert-AcceptanceProfileLaunch $catalogRoot 'catalog-seed'
  $profile=Join-Path $catalogRoot 'webview-catalog-profile'
  Assert-True ($selection.profile_directory -ceq $profile -and $selection.fresh_required -and -not $selection.existing_required -and $selection.profile_absent_before_launch) 'catalog seed selects an absent dedicated profile'
  Assert-True (-not (Test-Path -LiteralPath $profile)) 'catalog host alone reserves the profile'
  New-Item -ItemType Directory $profile | Out-Null
  Assert-Rejected { Assert-AcceptanceProfileLaunch $catalogRoot 'catalog-seed' } 'catalog seed rejects an existing empty profile'
  Assert-Rejected { Assert-AcceptanceProfileLaunch $catalogRoot 'catalog-restart' } 'catalog restart requires seed ownership evidence'
  $proof=[ordered]@{version=1;phase='catalog-seed';process_id=42;profile_directory=$profile;library_directory=(Join-Path $catalogRoot 'Scores');fresh_required=$true;created_new=$true}
  $proofPath=Join-Path $catalogRoot 'profile-catalog-seed.json'
  $proof | ConvertTo-Json | Set-Content -LiteralPath $proofPath -Encoding utf8
  Assert-AcceptanceProfileEvidence $catalogRoot $selection 42;$script:checks++
  foreach($case in @(@{field='phase';value='seed'},@{field='process_id';value=$true},@{field='profile_directory';value=(Join-Path $catalogRoot 'webview-profile')},@{field='library_directory';value=(Join-Path $catalogRoot 'score-library')},@{field='fresh_required';value=$false},@{field='created_new';value=$false})) {
    $original=$proof[$case.field];$proof[$case.field]=$case.value
    $proof | ConvertTo-Json | Set-Content -LiteralPath $proofPath -Encoding utf8
    Assert-Rejected { Assert-AcceptanceProfileLaunch $catalogRoot 'catalog-restart' } "catalog predecessor rejects $($case.field)"
    $proof[$case.field]=$original
  }
  $proof | ConvertTo-Json | Set-Content -LiteralPath $proofPath -Encoding utf8
  $marker=Join-Path $profile 'retained-browser-data';[IO.File]::WriteAllText($marker,'unchanged')
  $restart=Assert-AcceptanceProfileLaunch $catalogRoot 'catalog-restart'
  Assert-True ($restart.profile_directory -ceq $profile -and -not $restart.fresh_required -and $restart.existing_required -and -not $restart.profile_absent_before_launch) 'catalog restart must reuse matching existing profile'
  Assert-Rejected { Assert-AcceptanceProfileLaunch $catalogRoot 'catalog-final' } 'catalog final requires restart evidence'
  $proof.phase='catalog-restart';$proof.process_id=43;$proof.fresh_required=$false;$proof.created_new=$false
  $proof | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $catalogRoot 'profile-catalog-restart.json') -Encoding utf8
  Assert-AcceptanceProfileEvidence $catalogRoot $restart 43;$script:checks++
  $final=Assert-AcceptanceProfileLaunch $catalogRoot 'catalog-final'
  Assert-True ($final.profile_directory -ceq $profile -and $final.existing_required -and -not $final.profile_absent_before_launch) 'catalog final preserves original browser profile'
  Assert-True ([IO.File]::ReadAllText($marker) -ceq 'unchanged') 'profile helpers never fabricate browser storage'
  $renamed=Join-Path $catalogRoot 'retained-original-profile';Move-Item -LiteralPath $profile -Destination $renamed
  Assert-Rejected { Assert-AcceptanceProfileLaunch $catalogRoot 'catalog-restart' } 'deleted profile is never recreated by restart'
  New-Item -ItemType SymbolicLink -Path $profile -Target $renamed | Out-Null
  Assert-Rejected { Assert-AcceptanceProfileLaunch $catalogRoot 'catalog-restart' } 'linked catalog profile is rejected'
  Remove-Item -LiteralPath $profile
  Move-Item -LiteralPath $renamed -Destination $profile
  $linkedProof=Join-Path $catalogRoot 'linked-seed-proof.json';Move-Item -LiteralPath $proofPath -Destination $linkedProof
  New-Item -ItemType SymbolicLink -Path $proofPath -Target $linkedProof | Out-Null
  Assert-Rejected { Assert-AcceptanceProfileLaunch $catalogRoot 'catalog-restart' } 'linked predecessor evidence is rejected'
  Remove-Item -LiteralPath $proofPath
  Move-Item -LiteralPath $linkedProof -Destination $proofPath

  $scores=Join-Path $catalogRoot 'Scores'
  foreach($area in @('songs','backups','clean-songs','clean-backups','imports','import-backups')) {New-Item -ItemType Directory (Join-Path $scores $area) -Force | Out-Null}
  [IO.File]::WriteAllText((Join-Path $scores '.library.lock'),'')
  [IO.File]::WriteAllText((Join-Path $scores 'songs/original.json'),'original')
  $before=Get-CatalogAcceptanceSnapshot $scores -BeforeBootstrap
  Assert-True ($before.version -eq 1 -and $before.files.Count -eq 1) 'before bootstrap snapshot includes payload and excludes only root lock'
  Assert-True ($before.files[0].path -ceq 'songs/original.json' -and $before.files[0].bytes -eq 8 -and $before.files[0].sha256 -ceq (Get-FileHash -LiteralPath (Join-Path $scores 'songs/original.json')).Hash.ToLowerInvariant()) 'snapshot records exact file bytes and SHA256'
  Assert-Rejected { Get-CatalogAcceptanceSnapshot $scores } 'post bootstrap snapshot requires catalog areas'
  foreach($area in @('catalog','catalog-backups','.catalog-staging')) {New-Item -ItemType Directory (Join-Path $scores $area) | Out-Null}
  [IO.File]::WriteAllText((Join-Path $scores 'catalog/state.json'),'{}')
  $after=Get-CatalogAcceptanceSnapshot $scores
  Assert-True ($after.files.Count -eq 2 -and @($after.files | Where-Object path -CEQ 'catalog/state.json').Count -eq 1) 'post bootstrap snapshot includes catalog state'
  $outside=Join-Path $catalogRoot 'outside';New-Item -ItemType Directory $outside | Out-Null
  [IO.File]::WriteAllText((Join-Path $outside 'not-an-artifact'),'outside')
  $linked=Join-Path $scores 'catalog/linked'
  New-Item -ItemType SymbolicLink -Path $linked -Target $outside | Out-Null
  Assert-Rejected { Get-CatalogAcceptanceSnapshot $scores } 'snapshot rejects linked directory before descent'
  Remove-Item -LiteralPath $linked
  $oversized=Join-Path $scores 'imports/oversized';$stream=[IO.File]::Create($oversized)
  try {$stream.SetLength(16MB+1)} finally {$stream.Dispose()}
  Assert-Rejected { Get-CatalogAcceptanceSnapshot $scores } 'snapshot rejects files above 16 MiB'
  Remove-Item -LiteralPath $oversized
  $many=Join-Path $scores 'imports/many';New-Item -ItemType Directory $many | Out-Null
  foreach($number in 1..513){[IO.File]::WriteAllText((Join-Path $many "$number.json"),'')}
  Assert-Rejected { Get-CatalogAcceptanceSnapshot $scores } 'snapshot rejects more than 512 files'
  Remove-Item -LiteralPath $many -Recurse -Force

  $fixtures=Join-Path $catalogRoot 'fixtures';$downloads=Join-Path $catalogRoot 'downloads'
  New-Item -ItemType Directory $fixtures,$downloads | Out-Null
  foreach($name in @('catalog-original-legacy.zip','catalog-original-shared.zip','catalog-original-clean.zip')) {
    $path=Join-Path $fixtures $name;[IO.File]::WriteAllText($path,'original')
    Assert-True ([NativeAcceptance]::ResolveFixturePath($fixtures,$catalogRoot,$name) -ceq $path) 'catalog picker resolves the exact original fixture'
    foreach($invalid in @("../$name","..\$name","fixtures/$name",($name+'.extra'),($name+"`n"),$name.ToUpperInvariant(),$path)) {
      Assert-Rejected { [NativeAcceptance]::ResolveFixturePath($fixtures,$catalogRoot,$invalid) } 'catalog fixture aliases are rejected'
    }
    Remove-Item -LiteralPath $path
    [IO.File]::WriteAllText((Join-Path $downloads $name),'unapproved fallback')
    Assert-Rejected { [NativeAcceptance]::ResolveFixturePath($fixtures,$catalogRoot,$name) } 'missing catalog fixture cannot use downloads fallback'
  }
  foreach($phase in @('catalog-seed','catalog-restart','catalog-final')) {
    foreach($suffix in @('1.zip','16.json')) {
      $name="$phase-$suffix";$path=Join-Path $downloads $name;[IO.File]::WriteAllText($path,'download')
      Assert-True ([NativeAcceptance]::ResolveFixturePath($fixtures,$catalogRoot,$name) -ceq $path) 'catalog generated download is finite and exact'
    }
    foreach($suffix in @('0.zip','17.zip','01.zip','1.wmhpack',"1.zip`n")) {
      Assert-Rejected { [NativeAcceptance]::ResolveFixturePath($fixtures,$catalogRoot,"$phase-$suffix") } 'noncanonical catalog download name is rejected'
    }
  }
} finally {Remove-Item -LiteralPath $catalogRoot -Recurse -Force}
