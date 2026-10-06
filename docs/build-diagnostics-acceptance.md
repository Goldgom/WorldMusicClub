# Native build diagnostics acceptance

This change adds an implemented Windows gate and independent protocol tests.
It does not record an actual Windows run in this development environment.

## Source and trust boundary

The accepted starting point is commit
`8f59dd4067ad8a3da965e285c93d8f988f89a76f`, tree
`fc93808bf74649b2e698d3744151a24ce5834365`, Git commit count545. A later
feature commit reports its own actual Git SHA/tree/count; it never retains545
merely because it descends from that baseline. BUILD-INFO and release filenames
are not identity authorities.

The diagnostic endpoint reports the compiled Rust build. Its current-path file
hash is a cached disk snapshot, not a loaded memory image hash. Browser resource
identity remains unknown. Public tests use only original generated data. The
separate private154-file audit is not an input or public artifact.

## Implemented native gate

`build-diagnostics` is one new fresh-profile phase in the existing Windows host.
It uses the same immutable `native_build` EXE as every other native scenario.
Its Rust/host action limit is32; the exact accepted sequence is13 trusted clicks:

1. Open the existing Settings dialog
2. Explicitly Read the actual diagnostic endpoint
3. Copy the default summary
4. Select its actual visible text
5. Explicitly check the full-path option
6. Copy the path-inclusive summary
7. Select that actual visible text
8. Close Settings, clearing path consent
9. Reopen Settings without restoring path consent
10. Explicitly Refresh the same process snapshot
11. Copy the default summary again
12. Select its actual visible text
13. Close Settings

The injected acceptance observer forwards actual clipboard calls to the
platform unchanged and records their fulfilled/rejected outcome. It never
supplies fake clipboard success, adds permissions, or reads unrelated clipboard
contents. If clipboard access is unavailable, the product must show its real
fallback; a trusted Select action must focus the textarea and select all of its
actual text. The proof counts only observed fulfilled platform writes as copied;
when clipboard observation is unavailable that count is null. Every accepted
path still establishes actual selectable text. Default and reopened summaries
exclude the path; the explicitly checked summary includes it.

No read or clipboard call is allowed at bootstrap or on Settings open, refresh
never copies, and each observed write must belong to one of the three Copy
clicks. The retained response and visible fields are independently checked. The
second response must preserve the same hash, size, timestamp and cache scope.

The host records the selected EXE's SHA256/size before launch and after the run,
the actual owned process PID and MainModule image path, the executable PE
architecture, and the compiler target. It samples no other processes. The native
response must match those host facts and the independently retained EXE bytes.
It must also match full clean Git source SHA/tree/count. The existing full
native job already uses `fetch-depth:0`, which is retained. Shallow or dirty
source cannot pass this gate.

The host bounds and hashes its own fresh Scores directory before the first
click and after the last; the inventories must match exactly. Only the owned
process lock is excluded. The phase starts on the home screen without importing
music or starting audio. Its proof explicitly says `active_practice_audio:false`.
Existing full native live-tone/Settings acceptance and the three new
production-app DOM preservation tests retain responsibility for active-practice
pause, held-input cleanup, no resume and complete take/source preservation.

## Evidence and limits

`verify-native-build-diagnostics.mjs` verifies the original host/profile records,
all13 raw action/result pairs, trusted click ownership and stable target geometry,
the two real endpoint reads in the independent host trace, actual response and
visible identity, three full summary/selection records, unchanged host library
snapshots, and real PNGs at Read/default/path/reopened states. The verifier derives
its source binding directly from the frozen checkout and hashes the selected EXE
without running it.

Source files are bounded at4MiB each and the new scenario inventory at160.
Diagnostic response capture is bounded at32KiB, renderer reports at256KiB before
publication, native admission retains its existing1MiB family, and retained
proof files are limited to128 files/64MiB. Screenshots retain their existing
16MiB file limit. Profile/cache contents are not uploaded.

At exact545, canonical/live/skin inventories had114/125/121 distinct modules,
and catalog had51. Adding both new Rust modules, both JavaScript modules and
one stylesheet produces119/130/126 and catalog54 respectively. Every old binding
remains. Only live-navigation's source capacity changes128→160, with a comment
explaining the five added runtime dependencies and mutation tests proving that
missing, extra, duplicate and over-bound modules fail. Canonical and its Python
adapter keep128. Catalog host/tests explicitly require54. The new diagnostic
scenario has its own exact union containing its host/renderer/verifier/tests.
Later Human branches must remeasure their own inventories and retain their
additional bindings; these exact545 counts are not a universal branch cap.

## Full workflow preservation

The native workflow adds `build_diagnostics_windows` and its independent verifier
before native packaging. Both outcomes are mandatory in the existing final
summary. Failure, cancellation, skips, missing outputs or mismatched source/run
cannot promote a candidate. The package step additionally compares the proof's
source/tree/count/hash against the exact to-be-packaged EXE and current Git.
All old browser/native scenarios, result outputs, full/runtime startup and
archive gates remain. Diagnostic evidence is retained in the existing native
artifact; it is not silently inserted into the release ZIP or presented as a
replacement for full package acceptance.

The workflow also emits `build-diagnostics-windows-diagnostics-${sha}` after the
phase and its independent recheck, using the existing bounded collector's
explicit `build-diagnostics` mode. The small artifact preserves the original
root JSON and PNG bytes, including all available action/result pairs, screenshots,
profile-creation proof and snapshot files. A source-bound SHA-256 inventory
records the named Scores directories' presence and empty state without copying
their contents. The collector never traverses WebView profiles or arbitrary
directories. Payload and inventory together are limited to 23 MiB; an oversized
subset fails instead of omitting or transforming evidence. Failed or skipped
phases can still emit partial diagnostics, whose inventory explicitly denies
full acceptance. All original producer, recheck, transfer and final gates remain
mandatory, and the full artifact stays unchanged.

The existing21-case `native-clean-profile-routing.test.js` is now a mandatory
step immediately after the exact `native_import_driver` build, using that
executable through `WMH_NATIVE_IMPORT_DRIVER`. No duplicate compatibility matrix
or no-driver skip is introduced. The Rust companion compatibility test remains
covered by the full workspace/all-targets suite.

The explicit `npm test` list includes:

- `tests/build-diagnostics-evidence.test.js`
- `tests/frontend-build-diagnostics-preservation.test.js`
- `tests/native-build-diagnostics-evidence.test.js`
- `tests/native-build-diagnostics-registration.test.js`

The UI owner's tests remain separately registered. The diagnostics phase also
adds a Rust registration test for one fresh profile, click-only action admission,
its32-action boundary, and rejection of other phases/file-bearing actions.

## Verification status

Passed locally:57 distinct focused Node source/workflow/native protocol tests,
three production-app Settings DOM/DSP preservation cases, JavaScript syntax and
workflow YAML validation. Those DOM tests use the actual production view and
shell with simulated native/audio transport. They do not prove browser or
Windows behavior. Rust registration compilation and formatting also passed in
the integrated candidate. Actual PowerShell parsing on Windows, browser
acceptance, the new native phase, and the complete
accepted-source package workflow must still run on the final frozen integration
source before a release or acceptance claim.

## Combined feature and diagnostic inventory

The integration of the preserved feature chain with accepted diagnostics retains
121 canonical, 132 live-navigation, 128 skin, 55 catalog, 132 diagnostic and 133
human-timbre source bindings. Human timbre uses an explicit 160-file capacity so
the complete diagnostic runtime stays bound; the historical checkpoint counts
above remain unchanged. Native diagnostic reports, images and logs cross the
parallel job boundary as unchanged bytes, without WebView profiles or library
contents. The package join reruns the strict diagnostic verifier against the
restored executable and the same frozen source before creating a candidate.
