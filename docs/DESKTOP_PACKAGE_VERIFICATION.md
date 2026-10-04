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
`WorldMusicClub-Native-Windows-x64-commit-N.zip` only after all ordinary checks,
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

## Native166 packaging failure and generated schema correction

[Run 37033260358](https://github.com/Goldgom/WorldMusicHub/actions/runs/37033260358)
at published source `d773035a5c49df1c6b1974217a78313b20b43a03` (local equivalent
`3c845473189f149090e8ec8ec7395ab9751b24aa`) passed startup and all four native
feature phases, including actual files, backups, restarts and normal close.
Packaging then failed with `Native packaging requires clean source`; the old
error omitted the dirty paths. No native ZIP or extracted-package pass resulted.

The locked `tauri-build 2.7.1` calls its ACL/schema writers during `try_build`.
`tauri-utils 2.10.1` places their output in the crate's `gen/schemas`, outside
Cargo's ignored `target` directory. Local execution of those actual writers
against clean166 produced exactly these untracked paths:

- `crates/desktop-shell/gen/schemas/acl-manifests.json`
- `crates/desktop-shell/gen/schemas/capabilities.json`
- `crates/desktop-shell/gen/schemas/desktop-schema.json`
- `crates/desktop-shell/gen/schemas/windows-schema.json`

Reproduction used an external Rust harness with `tauri-build = "=2.7.1"` and
`tauri_build::try_build(tauri_build::Attributes::default())`, built with
`cargo build --offline`. Run it from `crates/desktop-shell` with
`CARGO_CFG_TARGET_OS=windows`, `TARGET=x86_64-pc-windows-msvc`,
`HOST=x86_64-unknown-linux-gnu`, `PROFILE=debug`, `DEP_TAURI_DEV=true` and
`OUT_DIR` pointing to an existing external `target/debug/build/repro/out`.
The upstream writers emit the four files before the Windows resource step
stops on this Linux host. `git status --porcelain --untracked-files=all` then
lists those paths, and the unmodified `source_metadata(HEAD, 166)` reproduces
the same clean-source failure. This exercises real metadata generation, not
a Windows application build or GUI test.

The correction ignores only those four derived files. Unknown adjacent files,
source capabilities, and staged or unstaged source edits still fail the same
gate. Failures now include the full porcelain path list and preserve its status
columns. A temporary-repository regression checks these cases with real Git;
the Windows-host guard remains mandatory. The next exact-source hosted run
must still pass package inventory, ZIP verification and extracted startup.

The following Windows run, 37036259658 at source
`40154fb540f0706f1792f88f69880f603e2edc9c`, caught a portability error in
that new temporary-repository regression before the GUI stages: Git for
Windows rejects the `nul` device as `core.excludesFile`. The fixture now uses
an actual empty file inside its temporary `.git` directory, preserving the
same global-ignore isolation and all source-cleanliness assertions. No app,
permission, package gate or workflow assertion is relaxed by this correction.

## Native168 UTF-8 metadata recovery

Native168 passed startup and all four feature phases, including the corrected
clean-source check. Its manifest then failed reading the UTF-8 Rust source
through Windows' default cp1252 decoder (`UnicodeDecodeError`, byte `0x9d`).
Both repository text inputs, `Cargo.toml` and `crates/score-core/src/lib.rs`,
now select strict UTF-8. Git and tool metadata output also selects UTF-8.

The full native packaging audit found that JSON reads already use UTF-8-SIG
(including PowerShell BOMs), JSON/checksum writes specify UTF-8, and byte
`.encode()`/`.decode()` calls use Python's platform-independent UTF-8 default.
Native filesystem paths use `Path`; ZIP names use POSIX separators. The real
catalog paths are relative and have no Windows drive or reserved component.
Tests include spaces and non-ASCII directory, payload and archive names and
verify that exported ZIP names retain forward slashes and exact UTF-8 bytes.

The new successful metadata/CLI regression keeps real repository source,
lockfiles, catalog, licenses, file decoding, hashes and ZIP operations. It
forces unspecified text I/O to cp1252 and confirms both source files fail
without an explicit encoding, then completes `create`, `archive` and `verify`
with all metadata fields and checksum bytes checked. Only host/tool responses
and native application evidence/PE fixtures are synthetic; no actual Windows
application acceptance is claimed by this test. A separate Windows-only test
uses a real temporary Git repository, Unicode source paths and the installed
MSVC/Rust/Node tools to exercise successful `source_metadata` without simulated
host/tool responses. That test must pass on hosted Windows; it is skipped on
Linux. Existing wrong-source, dirty-source, wrong-host and package-tampering
rejections remain in force.
