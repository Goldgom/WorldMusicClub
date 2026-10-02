# Native/UI163 integration and portable preparation

Status, 2026-10-02: source integration and packaging code are prepared locally.
**No successful native feature acceptance or native ZIP is claimed.**

The application base is frozen163 local
`0aca124d42a5ca188bfffa169bfd964c6196d259`, published equivalent
`2a930da560d803a1ba756b28dcd66d861a3ccb35`. The 41-file native delta runs from
accepted160 `f41421778a36e0988e54d4158c2c60e672231bd9` through picker identity
candidate `440e854ffeac969c58be0af9a1c9db628fad2345`, whose published equivalent
is `4f908bd409ac6c2714f127d0d313aa87d40700ee`. It applied without conflicts.
Tracked `web/`, `crates/score-core/`, package metadata and npm lockfile remain
byte-identical to frozen163. The three shared dispatcher functions are exact
extractions from frozen163 apart from public visibility.

[Native run 37019477445](https://github.com/Goldgom/WorldMusicHub/actions/runs/37019477445)
failed during seed acceptance after a successful owned filename operation.
Its full files/restart/keyboard/library acceptance has not passed. Integration
cannot inherit its earlier startup pass as full acceptance. The separate picker
repair must be reconciled and the complete combined source rerun before any
native artifact can be delivered.

## Authored package gate

The existing native acceptance workflow now prepares a distinct
`WorldMusicHub-Native-Windows-x64-commit-N.zip` only after all ordinary checks,
actual startup and four-process feature acceptance. It checks out complete
history at the exact workflow SHA, requests static C-runtime linkage, collects
Windows-target notices, then validates source SHA/tree/count and the exact EXE
against both startup and feature reports. All four normal-close/listener samples
must pass; the actual four downloaded files must still match their hashes.
The native manifest records the observed MIDI outcome and explicit false flags
for physical MIDI, audio/latency and clean-machine installation validation.

The ZIP includes the native EXE, native startup instructions, project license,
docs, schema, catalog sources/rights, engraving notices, Rust/standard-library/
Microsoft SDK loader notices, MPL source archives and bounded JSON evidence.
Every packaged file is inventoried; the build manifest, file list and ZIP have
SHA-256 checks. The Runtime is not bundled or installed. The resulting preview
requires an existing WebView2 Runtime and is unsigned.

After extraction the workflow launches the exact packaged EXE with both test
environment variables absent, uses its normal profile, waits for an enabled
listening control, captures its actual top-level window, samples its EXE-owned
TCP listeners and requests a normal close. No renderer initialization script,
test API, download redirection or test-profile override is active in that
process. A failure prevents package upload; bounded failure evidence remains.
That check is authored for hosted Windows, not run on this Linux executor.

The browser package workflow retains its format, names, count gate and startup
behavior. Its only native-delta change selects the Windows target for notices.
The native preview is an Actions artifact; GitHub Release uploads stay paused.

## Local validation

- Prepared offline OSMD 2.1.3 assets from existing locked dependencies
- 768 Node tests and both actual-file evidence verifier tests passed
- 296 Rust tests passed with the existing Rust 1.99.0 Linux toolchain and cache
- 45 Python tests passed, including six new native provenance/package regressions
- JavaScript syntax and workflow YAML parsed; shared API extraction matched
- Cargo formatting and Clippy passed for the full Linux workspace
- Ordinary HTTP engine and connection-lifetime smoke passed against the newly
  built server, including 198 asset requests over 18 bounded connections
- Windows-target notice preparation passed for 276 packages and five
  lockfile-verified MPL source archives; host-native notices must be regenerated
  during the Windows build

Linux checks do not compile the Windows-specific implementation, parse
PowerShell through its native parser, launch an app or validate UIA behavior.
No local GUI/browser/headless run, commit, push, dispatch, runtime install,
Release upload or resumed security probe belongs to this preparation.

The retained Microsoft SDK license and MPL text contain two original trailing
spaces; their notice bytes remain unchanged.
