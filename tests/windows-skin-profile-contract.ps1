# Pure profile/path helpers only. This does not launch Windows or a browser.
$skinRoot=Join-Path ([IO.Path]::GetTempPath()) ('wmh skin contract '+[guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory $skinRoot | Out-Null
try {
  foreach($phase in @('skin-restart','skin-default-restart')){Assert-Rejected { Assert-AcceptanceProfileLaunch $skinRoot $phase } 'skin successor needs its seed profile'}
  $seed=Assert-AcceptanceProfileLaunch $skinRoot 'skin-seed'
  Assert-True ($seed.fresh_required -and $seed.profile_absent_before_launch -and $seed.profile_directory -ceq (Join-Path (Join-Path $skinRoot 'webview-profiles') 'skin-seed')) 'skin seed is exact and absent'
  New-Item -ItemType Directory $seed.profile_directory -Force | Out-Null
  Assert-Rejected { Assert-AcceptanceProfileLaunch $skinRoot 'skin-seed' } 'skin seed cannot reuse its cache'
  $seedProof=[ordered]@{version=1;phase='skin-seed';process_id=42;profile_directory=$seed.profile_directory;library_directory=$seed.library_directory;fresh_required=$true;created_new=$true}
  $seedProof | ConvertTo-Json | Set-Content -Encoding utf8 (Join-Path $skinRoot 'profile-skin-seed.json')
  $restart=Assert-AcceptanceProfileLaunch $skinRoot 'skin-restart'
  Assert-True ($restart.profile_directory -ceq $seed.profile_directory -and $restart.existing_required -and -not $restart.fresh_required -and -not $restart.profile_absent_before_launch) 'skin selection reopen retains original cache'
  Assert-Rejected { Assert-AcceptanceProfileLaunch $skinRoot 'skin-default-restart' } 'skin final cannot skip reset predecessor'
  $resetProof=[ordered]@{version=1;phase='skin-restart';process_id=43;profile_directory=$seed.profile_directory;library_directory=$seed.library_directory;fresh_required=$false;created_new=$false}
  $resetPath=Join-Path $skinRoot 'profile-skin-restart.json'
  $resetProof | ConvertTo-Json | Set-Content -Encoding utf8 $resetPath
  $last=Assert-AcceptanceProfileLaunch $skinRoot 'skin-default-restart'
  Assert-True ($last.profile_directory -ceq $seed.profile_directory -and $last.existing_required -and -not $last.profile_absent_before_launch) 'skin reset reopen retains original cache'
  foreach($case in @(@{field='phase';value='skin-seed'},@{field='process_id';value=0},@{field='profile_directory';value=(Join-Path $skinRoot 'other')},@{field='library_directory';value=(Join-Path $skinRoot 'OtherScores')},@{field='fresh_required';value=$true},@{field='created_new';value=$true})) {
    $old=$resetProof[$case.field];$resetProof[$case.field]=$case.value
    $resetProof | ConvertTo-Json | Set-Content -Encoding utf8 $resetPath
    Assert-Rejected { Assert-AcceptanceProfileLaunch $skinRoot 'skin-default-restart' } "skin reset predecessor rejects $($case.field)"
    $resetProof[$case.field]=$old
  }
} finally { Remove-Item -LiteralPath $skinRoot -Recurse -Force }
