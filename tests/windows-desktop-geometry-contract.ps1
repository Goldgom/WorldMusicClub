# Pure failure composition only. No native measurement or screenshot API is called.
. (Join-Path $PSScriptRoot '../scripts/windows-desktop-geometry.ps1')
$first='Original renderer viewport failure'
$failure=New-NativeFailureDiagnostics 'catalog-seed' $first {throw 'original fixture geometry error'} {throw 'original fixture capture error'}
Assert-True ($failure.first_error -ceq $first -and $failure.accepted -eq $false) 'renderer error survives both diagnostic failures'
Assert-True ($failure.errors.Count -eq 2 -and $null -eq $failure.capture -and $null -eq $failure.geometry) 'diagnostic errors are retained separately without invented geometry or PNG'
$failure=New-NativeFailureDiagnostics 'catalog-seed' $first {@{client_rect=@(0,0,1024,689)}} {@{kind='diagnostic-only';accepted=$false;width=1024;height=689;resized=$false}}
Assert-True ($failure.first_error -ceq $first -and $failure.errors.Count -eq 0 -and $failure.capture.width -eq 1024 -and $failure.capture.height -eq 689 -and $failure.capture.resized -eq $false) 'actual-size diagnostic metadata never becomes acceptance or hides first failure'
