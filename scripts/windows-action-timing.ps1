# Diagnostic-only in-memory timestamps. No sleeps, native queries or per-action I/O.
function New-NativeActionTiming($Binding) {
  foreach($field in @('source_sha','source_tree','executable_sha256')) {
    $length=if($field -ceq 'executable_sha256'){64}else{40}
    if($Binding[$field] -cnotmatch "\A[0-9a-f]{$length}\z"){throw 'Invalid action timing source identity'}
  }
  return @{origin=[Diagnostics.Stopwatch]::GetTimestamp();current=$null;last_ticks=0;flushed=$false;report=[ordered]@{
    version=1;kind='native-action-timing';diagnostic_only=$true
    source_sha=$Binding.source_sha;source_tree=$Binding.source_tree;executable_sha256=$Binding.executable_sha256
    clock=[ordered]@{monotonic='elapsed Stopwatch ticks, one PowerShell process origin';frequency=[Diagnostics.Stopwatch]::Frequency;utc='Unix milliseconds; wall clock may jump; independent clocks are not synchronized'}
    max_events=4096;omitted_events=0;record_errors=0;events=[Collections.Generic.List[object]]::new()
  }}
}
function Start-NativeActionTiming($Timing,[string]$Phase,[int]$ProcessId,$Action) {
  if($null -eq $Timing){return}
  try {
    $Timing.current=$null
    $limit=if($Phase -ceq 'canonical-practice-seed'){80}elseif($Phase -cin @('canonical-practice-controls','canonical-practice-restart')){64}else{0}
    if($ProcessId -le 0 -or $Action.sequence -lt 1 -or $Action.sequence -gt $limit -or $Action.kind -cnotin @('click','picker','select-first','select-second','select-last','key-c5','canonical-range-start','canonical-range-end','canonical-tempo')){throw 'Invalid action timing target'}
    $Timing.current=[ordered]@{phase=$Phase;process_id=$ProcessId;sequence=$Action.sequence;kind=$Action.kind}
  } catch {$Timing.report.record_errors++}
}
function Add-NativeActionTiming($Timing,[string]$Stage,[long]$Ticks,[long]$UtcMs) {
  if($null -eq $Timing -or $null -eq $Timing.current){return}
  if($Stage -cnotin @('input-start','pointer-submitted','input-completed','input-or-capture-failed','capture-start','geometry-start','geometry-completed','geometry-write-start','geometry-write-completed','print-start','print-completed','png-start','png-completed','capture-completed','result-write-start','result-temporary-written','result-rename-start','result-published')){throw 'Unknown action timing checkpoint'}
  $elapsed=$Ticks-$Timing.origin
  if($elapsed -lt $Timing.last_ticks -or $UtcMs -lt 0){throw 'Invalid action timing clock'}
  $Timing.last_ticks=$elapsed
  if($Timing.report.events.Count -ge $Timing.report.max_events){$Timing.report.omitted_events++;return}
  $target=$Timing.current
  $Timing.report.events.Add([ordered]@{phase=$target.phase;process_id=$target.process_id;sequence=$target.sequence;kind=$target.kind;stage=$Stage;elapsed_ticks=$elapsed;utc_ms=$UtcMs})
}
function Record-NativeActionTiming($Timing,[string]$Stage) {
  if($null -eq $Timing -or $null -eq $Timing.current){return}
  try {Add-NativeActionTiming $Timing $Stage ([Diagnostics.Stopwatch]::GetTimestamp()) ([DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds())}
  catch {$Timing.report.record_errors++}
}
function Save-NativeActionTiming($Timing,[string]$Directory) {
  if($null -eq $Timing -or $Timing.flushed){return}
  # Called once after existing app cleanup, on success or failure. Timing data
  # never participates in result publication, acceptance or package admission.
  $Timing.flushed=$true;$Timing.current=$null
  $body=$Timing.report | ConvertTo-Json -Compress -Depth 8
  if([Text.Encoding]::UTF8.GetByteCount($body) -gt 1MB){throw 'Action timing diagnostics exceed 1 MiB'}
  $path=Join-Path $Directory 'timing-canonical-practice.json'
  [IO.File]::WriteAllText($path,$body,[Text.UTF8Encoding]::new($false))
}
