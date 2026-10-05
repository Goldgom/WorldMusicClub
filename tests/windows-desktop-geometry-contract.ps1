# Pure failure composition only. No native measurement or screenshot API is called.
. (Join-Path $PSScriptRoot '../scripts/windows-desktop-geometry.ps1')
$first='Original renderer viewport failure'
$failure=New-NativeFailureDiagnostics 'catalog-seed' $first {throw 'original fixture geometry error'} {throw 'original fixture capture error'}
Assert-True ($failure.first_error -ceq $first -and $failure.accepted -eq $false) 'renderer error survives both diagnostic failures'
Assert-True ($failure.errors.Count -eq 2 -and $null -eq $failure.capture -and $null -eq $failure.geometry) 'diagnostic errors are retained separately without invented geometry or PNG'
$failure=New-NativeFailureDiagnostics 'catalog-seed' $first {@{client_rect=@(0,0,1024,689)}} {@{kind='diagnostic-only';accepted=$false;width=1024;height=689;resized=$false}}
Assert-True ($failure.first_error -ceq $first -and $failure.errors.Count -eq 0 -and $failure.capture.width -eq 1024 -and $failure.capture.height -eq 689 -and $failure.capture.resized -eq $false) 'actual-size diagnostic metadata never becomes acceptance or hides first failure'

# Reproduce the real 48/24/10-action run: the five 625x480 dialog captures
# (seed 1/3/5, restart 4/6) must not inflate the 85 app-client captures.
$manifests=[ordered]@{screenshots=@();diagnostic_screenshots=@()}
foreach($phase in @('catalog-seed','catalog-restart','catalog-final')) {
  $count=@{'catalog-seed'=48;'catalog-restart'=24;'catalog-final'=10}[$phase]
  foreach($sequence in 1..$count) {
    $name="native-action-$phase-$sequence"
    $association=Get-CatalogCaptureAssociation $name $phase -ClientOnly -GeometryFile "geometry-$name.json"
    $manifests[$association.manifest]+=,@{file="$name.png";metadata=$association.metadata}
  }
  $name="native-$phase"
  $association=Get-CatalogCaptureAssociation $name $phase -ClientOnly -GeometryFile "geometry-$name.json"
  $manifests[$association.manifest]+=,@{file="$name.png";metadata=$association.metadata}
}
foreach($case in @(@{phase='catalog-seed';actions=@(1,3,5)},@{phase='catalog-restart';actions=@(4,6)})) {
  foreach($sequence in $case.actions) {
    $name="owned-picker-before-open-$($case.phase)-$sequence"
    $association=Get-CatalogCaptureAssociation $name $case.phase
    $manifests[$association.manifest]+=,@{file="$name.png";width=625;height=480;metadata=$association.metadata}
    Assert-True ($association.manifest -ceq 'diagnostic_screenshots' -and $association.metadata.accepted -eq $false -and $association.metadata.kind -ceq 'diagnostic-only') 'picker PNG is explicitly diagnostic'
    Assert-True (-not $association.metadata.Contains('geometry_file') -and $association.metadata.action -eq $sequence) 'picker diagnostic binds its action without borrowing app geometry'
  }
}
Assert-True ($manifests.screenshots.Count -eq 85 -and $manifests.diagnostic_screenshots.Count -eq 5) 'all 85 formal captures and all five original diagnostics remain separately retained'
foreach($kind in @('picker-failure','popup-failure')) {
  $association=Get-CatalogCaptureAssociation "owned-$kind-catalog-seed-1" 'catalog-seed'
  Assert-True ($association.manifest -ceq 'diagnostic_screenshots' -and $association.metadata.capture -ceq $kind) 'failure dialog evidence is retained only as diagnostics'
}
Assert-Rejected { Get-CatalogCaptureAssociation 'owned-picker-before-open-catalog-seed-1' 'catalog-seed' -ClientOnly -GeometryFile 'geometry-native-action-catalog-seed-1.json' } 'dialog cannot claim formal client coverage'
Assert-Rejected { Get-CatalogCaptureAssociation 'owned-picker-before-open-catalog-seed-1' 'catalog-seed' -GeometryFile 'geometry-native-action-catalog-seed-1.json' } 'dialog cannot inherit stale app geometry'
Assert-Rejected { Get-CatalogCaptureAssociation 'native-action-catalog-seed-1' 'catalog-seed' } 'formal app capture cannot be demoted to a dialog diagnostic'
Assert-Rejected { Get-CatalogCaptureAssociation 'native-action-catalog-seed-1' 'catalog-seed' -ClientOnly -GeometryFile 'geometry-native-action-catalog-seed-2.json' } 'formal client must retain its own geometry'
foreach($name in @('owned-picker-before-open-catalog-restart-1','owned-picker-before-open-catalog-seed-0','owned-picker-before-open-catalog-seed-01','owned-picker-before-open-catalog-seed-65','Owned-picker-before-open-catalog-seed-1',"owned-picker-before-open-catalog-seed-1`n",'../owned-picker-before-open-catalog-seed-1','native-failure-catalog-seed')) {
  Assert-Rejected { Get-CatalogCaptureAssociation $name 'catalog-seed' } 'only exact phase-bound diagnostic names are allowed'
}
Assert-Rejected { Get-CatalogCaptureAssociation 'native-complete-practice-seed' 'complete-practice-seed' -ClientOnly } 'shared complete-practice captures cannot enter the catalog manifests'
