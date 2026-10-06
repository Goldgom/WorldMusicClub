# Acceptance-only metadata. These helpers do not acquire focus, send input,
# inspect window text, retry an action, or change its success/failure decision.
function New-PickerObservation([string]$Phase,[int]$Sequence,$Binding) {
  if($Phase -cnotmatch '\A[a-z]+(?:-[a-z]+)*\z' -or $Sequence -lt 1 -or $Sequence -gt 80){throw 'Invalid picker observation identity'}
  return @{watch=[Diagnostics.Stopwatch]::StartNew();last=$null;report=[ordered]@{
    version=1;kind='native-picker-observation';diagnostic_only=$true;phase=$Phase;sequence=$Sequence
    source_sha=$Binding.source_sha;source_tree=$Binding.source_tree;executable_sha256=$Binding.executable_sha256
    clock=[ordered]@{elapsed='action-local Stopwatch milliseconds';utc='Unix milliseconds on the Windows host; compare trace utc_ms, not independent elapsed_ms origins'}
    samples=0;omitted_transitions=0;events=[Collections.Generic.List[object]]::new()
  }}
}
function Add-PickerObservation($Observation,[string]$Stage,$State,[long]$ElapsedMs,[long]$UtcMs,[string]$StateKey=$null) {
  if($null -eq $Observation){return $false}
  if($ElapsedMs -lt 0 -or $UtcMs -lt 0 -or $Stage -cnotmatch '\A[a-z]+(?:-[a-z]+)*\z'){throw 'Invalid picker observation sample'}
  $report=$Observation.report
  if($report.samples -gt 0 -and $ElapsedMs -lt $report.last_elapsed_ms){throw 'Picker observation monotonic clock moved backward'}
  $report.samples++;$report.last_elapsed_ms=$ElapsedMs;$report.last_utc_ms=$UtcMs
  $signature=if($null -ne $StateKey -and $StateKey.Length -gt 0){$Stage+'|'+$StateKey}else{[ordered]@{stage=$Stage;state=$State} | ConvertTo-Json -Compress -Depth 12}
  if($Observation.last -ceq $signature){return $false}
  $Observation.last=$signature
  $row=[ordered]@{stage=$Stage;elapsed_ms=$ElapsedMs;utc_ms=$UtcMs;state=$State}
  # Keep the first 63 transitions and the latest state, explicitly counting any
  # overwritten tail. Unchanged polling samples do not crowd out opening/Open.
  if($report.events.Count -lt 64){$report.events.Add($row)}
  else{$report.events[63]=$row;$report.omitted_transitions++}
  return $true
}
function Get-PickerObservationWindow([IntPtr]$Window,[IntPtr]$AppWindow,[uint32]$AppProcess) {
  [uint32]$ownerProcess=0;[void][NativeAcceptance]::GetWindowThreadProcessId($Window,[ref]$ownerProcess)
  $owner=[NativeAcceptance]::GetAncestor($Window,3)
  $row=[ordered]@{hwnd=$Window.ToInt64();process_id=$ownerProcess;root_owner_hwnd=$owner.ToInt64();exists=[NativeAcceptance]::IsWindow($Window);owned_identity=($ownerProcess -eq $AppProcess -and $owner -eq $AppWindow)}
  # A previously owned HWND may be destroyed/reused between samples. Record
  # that identity change, without inspecting an unrelated replacement window.
  if($row.owned_identity){
    $class=[Text.StringBuilder]::new(256);[void][NativeAcceptance]::GetClassName($Window,$class,256)
    $row.class=$class.ToString();$row.visible=[NativeAcceptance]::IsWindowVisible($Window);$row.enabled=[NativeAcceptance]::IsWindowEnabled($Window)
  }
  return $row
}
function Get-PickerObservationState($App,[IntPtr]$Dialog) {
  $window=$App.MainWindowHandle;$foreground=[NativeAcceptance]::GetForegroundWindow();[uint32]$foregroundProcess=0
  [void][NativeAcceptance]::GetWindowThreadProcessId($foreground,[ref]$foregroundProcess)
  $inventory=[NativeAcceptance]::OwnedPickerObservationWindows($window,[uint32]$App.Id)
  $owned=@($inventory.Windows | ForEach-Object {Get-PickerObservationWindow $_ $window ([uint32]$App.Id)})
  $dialogState=$null
  # A destroyed/reused HWND is recorded as such, never queried for window text.
  if($Dialog -ne [IntPtr]::Zero){$dialogState=Get-PickerObservationWindow $Dialog $window ([uint32]$App.Id)}
  $cursor=[NativeAcceptance+POINT]::new();$cursorState=$null
  if([NativeAcceptance]::GetCursorPos([ref]$cursor)){$cursorState=@($cursor.X,$cursor.Y)}
  return [ordered]@{app_hwnd=$window.ToInt64();app_process_id=$App.Id;app_exists=[NativeAcceptance]::IsWindow($window);app_enabled=[NativeAcceptance]::IsWindowEnabled($window);foreground_hwnd=$foreground.ToInt64();foreground_process_id=$foregroundProcess;foreground_root_owner_hwnd=[NativeAcceptance]::GetAncestor($foreground,3).ToInt64();dialog=$dialogState;owned_windows=$owned;inventory=[ordered]@{complete=$inventory.Complete;visited=$inventory.Visited;elapsed_ms=$inventory.ElapsedMilliseconds;stop_reason=$inventory.StopReason;visit_limit=256;time_limit_ms=25;owned_limit=8};cursor=$cursorState}
}
function Save-PickerObservation($Observation,[string]$OutputDirectory) {
  $body=$Observation.report | ConvertTo-Json -Compress -Depth 16
  if([Text.Encoding]::UTF8.GetByteCount($body) -gt 128KB){throw 'Picker observation exceeds 128 KiB'}
  $path=Join-Path $OutputDirectory "picker-observation-$($Observation.report.phase)-$($Observation.report.sequence).json"
  $temporary="$path.tmp";[IO.File]::WriteAllText($temporary,$body,[Text.UTF8Encoding]::new($false));Move-Item -Force $temporary $path
}
function Record-PickerPoll($Observation,[string]$Stage,$State,[string]$StateKey,[hashtable]$Evidence) {
  if($null -eq $Observation){return}
  if([string]::IsNullOrEmpty($StateKey)){$Evidence.picker_observation_error='Poll observation requires a precomputed state key';return}
  # Only the already-read decision sample enters bounded memory. No native
  # query, enumeration, JSON conversion or filesystem I/O occurs in polling.
  try{[void](Add-PickerObservation $Observation $Stage $State $Observation.watch.ElapsedMilliseconds ([DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()) $StateKey)}
  catch{$Evidence.picker_observation_error=$_.Exception.Message}
}
function Flush-PickerObservation($Observation,[hashtable]$Evidence) {
  if($null -eq $Observation){return}
  try{Save-PickerObservation $Observation $OutputDirectory}
  catch{$Evidence.picker_observation_error=$_.Exception.Message}
}
function Record-PickerObservation($Observation,[string]$Stage,$App,[IntPtr]$Dialog,[hashtable]$Evidence) {
  if($null -eq $Observation){return}
  # Full snapshots are outside polling and before final live pointer checks.
  # Persist only once the native action has a decision, before failure capture
  # if necessary; diagnostic latency cannot admit an expired native state.
  try {
    $elapsed=$Observation.watch.ElapsedMilliseconds;$utc=[DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
    try{$state=Get-PickerObservationState $App $Dialog}
    catch{$state=[ordered]@{observation_error=$_.Exception.Message}}
    $state.observation_duration_ms=$Observation.watch.ElapsedMilliseconds-$elapsed
    [void](Add-PickerObservation $Observation $Stage $state $elapsed $utc)
  } catch {$Evidence.picker_observation_error=$_.Exception.Message}
}
