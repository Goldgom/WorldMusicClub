# WorldMusicHub Native for Windows

This is an unsigned, portable native-window preview for Windows x64. Extract
the entire `WorldMusicHub-Native-Windows-x64-commit-*.zip` and double-click
`WorldMusicHub-Native.exe`. It opens its own application window using embedded
UI, scores, notation assets and the Rust engine. There is no separate HTTP
server process or browser tab to keep open. Close the application window to exit.

## Requirements and current limits

- Windows x64 with an installed Microsoft Edge WebView2 Runtime is required.
  The hosted check uses the Windows GitHub runner's existing Runtime. Its
  observed version/user-agent is recorded in the packaged evidence. Windows
  10/11 are intended targets; clean-machine installation and every supported
  Windows version have not been validated
- The ZIP does **not** bundle or install the WebView2 Runtime. Edge browser
  installation alone does not establish this prerequisite. Use Microsoft's
  [official Runtime page](https://developer.microsoft.com/en-us/microsoft-edge/webview2/)
  if needed. Runtime installation, its terms and clean-machine offline setup
  are separate from this portable preview. An already configured machine can
  use the embedded exercises and imports offline
- The build requests static C-runtime linkage. It remains unsigned and may
  prompt Windows reputation warnings. Verify the source and checksums; do not
  bypass security warnings blindly
- Native permission requests are currently denied. The ordinary MIDI API's
  actual hosted outcome appears in `BUILD-INFO.json` and
  `evidence/renderer-seed.json`. A ready API with zero inputs is not a physical
  MIDI-device test; a denied or unavailable outcome is not MIDI support
- Physical MIDI, audio output/latency, audible replay, IME/keyboard rollover,
  full accessibility and clean-machine installation are not validated by the
  silent native acceptance suite. Native scored-take/results and additional
  export formats remain beyond its canonical-score/free-recording coverage

## Saved music and migration

The native profile is stored by Windows/WebView2 outside this portable folder.
Moving the EXE is not a backup of saved scores, performances or settings.
Explicitly save a score or stopped performance and export the corresponding
backup. Unsaved active drafts are not promised to survive a close or crash.

The browser edition and native edition use separate profiles. To migrate,
export the score-library backup and the separate performance-library backup
from the browser edition, restore each through its matching native panel, and
check the saved records before removing any originals. There is no automatic
migration. Keep the stable application identity `org.worldmusichub.desktop-proof`
and origin `https://wmh.localhost` when upgrading; these historical names identify
the current native storage profile.

## What the artifact verifies

The workflow builds and checks one exact source commit before creating the
native ZIP. It requires actual native startup/offline notation, Windows file
imports, real export files and backups, four-process profile continuity,
PC-keyboard free-recording boundaries, navigation and normal/active close.
After extraction it starts the exact packaged EXE without test hooks, waits
for enabled app controls, captures the real window, samples that EXE's TCP
listeners and closes the window normally. The separate workflow evidence
contains that final screenshot/report. This is a bounded product check, not a
network security audit or an assurance that every machine will run the app.

`BUILD-INFO.json` records the exact source SHA/tree, complete-history commit
count, target/toolchain, dependency lock hashes, observed MIDI outcome and every
packaged file's SHA-256. `SHA256.txt` covers those files and the build manifest;
the ZIP has a separate `.sha256` file. These are integrity/provenance records,
not a digital signature. Check the exact workflow's successful conclusion and
native screenshots before relying on the preview.

Keep `licenses`, `catalog`, `schema`, `docs` and `evidence` with the EXE when
redistributing. Rust notices include lockfile-verified MPL source archives,
Rust standard-library licenses and the Microsoft SDK loader notices. The
WebView2 Runtime has separate terms and is not included. Imported third-party
music retains its own rights; this package contains only the catalog's reviewed
sources and original exercise content.

The separate `WorldMusicHub-Windows-x64-*` browser package and its
`WorldMusicHub.exe` still use the local HTTP server described in `docs/WINDOWS.md`.
This Native package is a distinct preview. No installer, updater, signing or
GitHub Release publication is implied.
