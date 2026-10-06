# WorldMusicClub Native for Windows

This is an unsigned, portable native-window preview for Windows x64. Extract
the entire `WorldMusicClub-Native-Windows-x64-commit-*.zip` and double-click
`WorldMusicClub-Native.exe`. It opens its own application window using embedded
UI, scores, notation assets and the Rust engine. There is no separate HTTP
server process or browser tab to keep open. Close the application window to exit.

Earlier WorldMusicHub-Native packages retain their original names. The rename preserves existing native libraries and settings; see [name and data compatibility](BRAND_COMPATIBILITY.md).

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
  full accessibility and clean-machine installation remain unverified. The
  native canonical and complete-practice gates do exercise trusted PC-keyboard
  input, scored takes, results and their existing export contracts using original
  test fixtures. Browser/WebView audio observations are bounded software checks;
  they do not establish physical audibility, MIDI-device behavior or latency

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

The Windows job builds and checks one exact source commit before creating the
native candidate ZIP. It requires actual native startup/offline notation, Windows file
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

The bounded pitch receiver additionally requires original C/E/G acceptance for
the declared two-semitone and proved twelve-semitone ranges, exact source-clock
frequency changes, pedal-held pause/resume, mute, unchanged human takes and
explicit unsupported-range rejection. The package includes its five exact
pitch evidence reports, bound to the same source/tree/executable. Its focused
scope and false audibility/release-readiness claims remain separate from full
checkpoint acceptance; see [the pitch proof contract](PITCH_BEND_ACCEPTANCE_SLICE.md).

The Windows and Linux browser jobs run independently. A native candidate can
therefore exist even when browser checks fail. The manifest explicitly records
`acceptance_scope: native-windows-only` and `acceptance_workflow_run_id`; these
do not claim full checkpoint acceptance. Before package delivery or main
promotion, require the successful `acceptance-summary` job in that exact
**Native Windows feature acceptance** run, the separate full **Verify
WorldMusicClub** workflow for the same source SHA, and the artifact checks above.
The summary requires both native and browser jobs to succeed with matching
source SHA/tree and run identity; failed, cancelled, skipped or missing jobs
cannot pass.

Keep `licenses`, `catalog`, `schema`, `docs` and `evidence` with the EXE when
redistributing. Rust notices include lockfile-verified MPL source archives,
Rust standard-library licenses and the Microsoft SDK loader notices. The
WebView2 Runtime has separate terms and is not included. Imported third-party
music retains its own rights; this package contains only the catalog's reviewed
sources and original exercise content.

The separate `WorldMusicClub-Windows-x64-*` browser package and its
`WorldMusicClub.exe` still use the local HTTP server described in `docs/WINDOWS.md`.
This Native package is a distinct preview. No installer, updater, signing or
GitHub Release publication is implied.
