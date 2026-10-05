# Recoverable catalog acceptance evidence

This gate uses three deterministic, wholly ORIGINAL archives prepared by
`scripts/prepare-library-catalog-acceptance.mjs`. The legacy archive contributes
two playable editions and one retained, non-playable source. The shared archive
references the first legacy edition. The clean archive contributes one complete
edition with its authored cover, background and PV. Initialization must produce
three editions, three imported pack groups and four memberships.

`catalog-seed`, `catalog-restart` and `catalog-final` use distinct native
processes and one actual persisted browser profile. They must preserve the
renderer recovery pointer and a saved free recording across both restarts.
The selected shared legacy and clean editions move to Trash together, removing
three memberships while retaining one active edition. An actual committed reply
is lost; a deliberately mismatched operation lookup must not confirm it. The
next process reconciles the original operation, reimports the exact original
legacy and clean archives without escaping Trash, proves an undispatched restore
absent, and retries the identical restore request. The final process must report
three active editions, zero in Trash and all four original memberships.

The verifier rejects missing/reordered phases, absent source binding, source
files not contained in the reported Git commit, changed module hashes, a missing
independent executable/driver, unmatched host actions/results, synthetic click
observations, malformed PNGs, wrong 1280×720 Chinese layout, mutated request or
response bytes, changed operation ownership, and changed prior retained files.
Hosted Chromium additionally preserves every actual native dispatch and raw
response body outside the renderer report. Native Windows preserves the actual
owner profile records, foreground/hit/dialog ownership, process listener counts,
and bounded native route trace. The native trace is a rolling route trace, not a
complete independent response-body recorder.

The original pre-bootstrap snapshot has an exact, fixture-derived file allowlist.
All original scores, metadata, source payloads, import inventories, receipts,
backups and clean media remain byte-identical. Reimport may add exactly two
receipts and their two matching backups. Journal additions must form precisely
the bootstrap, Trash and restore generations. Both copies of every generation,
their manifest links, state hashes, native receipt previews and recorded API
state digests are verified. An unfinished journal stage is rejected.

The focused Node tests are verifier and transport contract tests. Their generated
PNG and in-memory API values are explicitly synthetic test inputs and do not
establish browser or Windows acceptance. The checked-in
`tests/fixtures/library-catalog/original-native-journal.json` contains bounded
ORIGINAL journal bytes emitted by the authorized prior-311 native driver at
source `0d696cfc732b1d333893b838c1d861ede1e82535`; it is only a replay fixture for
the journal validator. It is not evidence of a current-source build, rendered
browser, Windows window or physical audio run.

Only the hosted or native owner may produce a complete run. Run the verifier with
the independently selected binary and source identity, then retain
`library-catalog-proof.json` with the complete artifact directory. A passing
focused proof does not replace workspace tests, real-browser suites, packaging
checks, screenshot review or the exact-source Windows release gate.

## Preparation and admission

`npm run test:library-catalog-acceptance` runs the fixture, transport, verifier,
native-registration and navigation contracts without opening a browser, server,
native window or user library. The three new catalog contract suites are also
registered in `npm test`. The focused `library-management-preview.yml`
workflow now wires these contracts, the pack browsing hosted gate, the
three-phase catalog hosted gate and actual Windows `-Scenario library-catalog`. It checks out the triggering SHA
on both runners, builds each native binary there and retains the independent
binary with the original evidence. It does not publish or promote a release.

`npm run test:library-catalog-native` uses an already-built
`WMH_NATIVE_IMPORT_DRIVER` and a fresh ORIGINAL temporary library for the real
production adapter/app DOM. Set `WMH_CATALOG_REPORT` to retain its JSON evidence.
The shared renderer transport is used for real before/after-dispatch losses,
wrong-operation lookup and delayed old-query tests. This is socket-free stdio
and Node DOM evidence, with no rendered browser or Windows claim. When reusing
an explicitly approved earlier build, set `WMH_CATALOG_DRIVER_BUILD_SHA` to its
actual build commit and retain the independent production-module compatibility
record plus driver hashes before/after the run. Do not label that driver as a
newer build. The script does not invoke Cargo.

Only on the later authorized hosted runner, after its normal dependency/browser
setup and an exact-source native driver build, use:

```sh
GITHUB_ACTIONS=true WMH_HOSTED_BROWSER=1 \
WMH_SOURCE_SHA="$GITHUB_SHA" \
WMH_NATIVE_IMPORT_DRIVER=/absolute/path/to/native_import_driver \
WMH_ARTIFACT_DIR="$RUNNER_TEMP/catalog-original-new-run" \
npm run test:library-catalog-hosted
```

The output directory must be absent. Its parent is created when necessary.
The source must be clean and equal to the selected SHA. Chromium launches a new
process per phase with one dedicated `webview-catalog-profile` directory; the
host never copies localStorage or injects a saved recovery record. Original
picker files must arrive through the real `FileChooser` event on the existing
`score-file` input. Actual native response bytes are forwarded over stdio, with
no listener. Foreign-origin requests fail the run. Every phase is limited to
64 host actions, 128 renderer API records, 256 host dispatch records, a 1 MiB
renderer report and 240 seconds. The focused workflow also imposes a finite
enclosing step/job timeout for browser/process cleanup. Keep normal engraving
assets prepared through the existing workflow before launching.

On the separately authorized Windows acceptance runner, select the new scenario
with an exact-source packaged EXE and a fresh output directory:

```powershell
./scripts/windows-desktop-acceptance.ps1 `
  -Executable C:\acceptance\WorldMusicClub.exe `
  -OutputDirectory C:\acceptance\catalog-original-new-run `
  -Scenario library-catalog
```

The host uses actual Windows controls, foreground/hit ownership and owned native
file dialogs. Only these catalog phases request a 1280×720 client area. The
screenshots contain the actual client pixels; a different DPI/client size fails
rather than silently resizing the image. Picker diagnostics retain whole-dialog
captures. All other scenarios keep their existing window/profile behavior.
The catalog seed reserves a new profile; both restart phases require the same
existing ordinary profile and matching earlier process records. The renderer
also checks its real persisted run marker and exact recovery record before
opening management.

The process-owner configuration binds the source commit/tree/module hashes,
fixture manifest and fresh run ID. Before initialization, the renderer requests
one read-only host snapshot and waits for its acknowledgement. Native output is
`native-library-catalog.json`; hosted output is `report.json`. Both save matching
renderer/action/result/profile/snapshot evidence and actual screenshot hashes.
The host invokes `verify-library-catalog-acceptance.mjs` against the independently
selected binary; failure leaves the run unaccepted. Rust/PowerShell execution
and actual windows must be verified at that later checkpoint, even when local
Node contracts and prior-runtime stdio checks pass.

## First actual-window run

The integration owner must first map and publish the preserved source history,
then point the dedicated `preview/library-management` branch at that exact frozen
commit. Its push triggers **Original library-management focused acceptance**
without putting unaccepted source on main. Explicit `workflow_dispatch` remains
available after workflow registration; no other push branch triggers this gate.
Both jobs must finish successfully; skipped or canceled jobs do not pass. The hosted job needs locked Node dependencies, the pinned Rust toolchain,
prepared engraving assets, Python and Playwright Chromium. The Windows job needs
the same source/assets, its freshly built EXE, an interactive hosted desktop and
working WebView2. It parses the native scripts and runs the profile/snapshot
contracts before opening the first window. Each actual catalog run receives an
absent directory under runner temp and retains one new profile over three actual
processes. No user library path is accepted.

The Chinese route is **曲库 → 曲包与查重 → 移入回收站与恢复**. Opening either panel
only reads metadata/status. First use requires **核对初始化** and a separate
confirmation; cancel sends no catalog write. Each Trash/restore selection gets
its own exact impact preview and confirmation. The hosted/native scripts exercise
these controls through the shared application UI. A successful run must preserve
the source archives, clean media, practice/free-recording data and shared references
identified by the verifier, and its actual 1280×720 Chinese screenshots still need
visual review. Membership move/remove and pack removal remain open API/UI work.

Artifacts include the exact native driver or EXE, reports, screenshots and the
newly authored fixture library. Browser/WebView profile directories are excluded.
The first Windows run must also verify 100% DPI and sufficient monitor work area
for the required 1280×720 physical client and CSS viewport. Screenshots must not
be resized to hide a mismatch. The historical prior-311 fixture provenance above
remains replay evidence only; only a new complete run proves this source's
actual-window behavior.
