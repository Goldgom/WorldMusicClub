# WorldMusicClub Native for Windows

This is an unsigned, portable native-window preview for Windows x64. Future
qualified builds offer two distributions of the same executable:

- **Runtime:** `WorldMusicClub-Native-Runtime-Windows-x64-commit-*.zip` is the
  usual download. It retains every runtime asset, catalog entry, schema,
  instruction, license, notice and required license source archive
- **Full:** `WorldMusicClub-Native-Windows-x64-commit-*.zip` keeps the complete
  original package, including its native evidence. Its existing
  `WorldMusicClub-Native-Candidate-*` artifact identity is unchanged

Extract the entire selected ZIP and double-click `WorldMusicClub-Native.exe`. It opens its own application window using embedded
UI, scores, notation assets and the Rust engine. There is no separate HTTP
server process or browser tab to keep open. Close the application window to exit.

Earlier WorldMusicHub-Native packages retain their original names. The rename preserves existing native libraries and settings; see [name and data compatibility](BRAND_COMPATIBILITY.md).

## Requirements and current limits

- Windows x64 with an installed Microsoft Edge WebView2 Runtime is required.
  The hosted check uses the Windows GitHub runner's existing Runtime. Its
  observed version/user-agent is recorded in the Full package evidence. Windows
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
  the Full package's `evidence/renderer-seed.json`. A ready API with zero inputs is not a physical
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
contains that final screenshot/report. The Runtime ZIP is independently
verified, extracted into a different fresh directory, and run through the same
ordinary startup check before its candidate upload. Its post-packaging delivery
record binds source/tree, workflow run, both ZIP hashes, the Full artifact ID,
EXE hash, complete extracted Runtime inventory and both final startup reports,
screenshots and logs. The ordinary startup check uses no acceptance hooks;
its origin binding comes from the same executable's independently revalidated
Full startup evidence at `https://wmh.localhost`, not a new direct origin
observation by UI Automation. This is a bounded product check, not a
network security audit or an assurance that every machine will run the app.

`BUILD-INFO.json` records the exact source SHA/tree, complete-history commit
count, target/toolchain, dependency lock hashes, observed MIDI outcome and every
packaged file's SHA-256. In Full, `SHA256.txt` covers those files and the build manifest.
In Runtime, the unchanged `BUILD-INFO.json` still describes Full and
`FULL-SHA256.txt` preserves Full's original checksums; use
`RUNTIME-MANIFEST.json` and `SHA256.txt` for Runtime's own inventory. Each ZIP
has a separate `.sha256` file. Runtime's manifest names the exact immutable
Full workflow artifact and inner ZIP hash. The locator is not an authenticity
proof or an automatic download instruction. Obtain Runtime's expected ZIP
digest and artifact/source identity from the trusted workflow record; its own
sidecar alone is not a trust root. These are integrity/provenance records,
not a digital signature. Check the exact workflow's successful conclusion and
native screenshots before relying on the preview.

The bounded pitch receiver additionally requires original C/E/G acceptance for
the declared two-semitone and proved twelve-semitone ranges, exact source-clock
frequency changes, pedal-held pause/resume, mute, unchanged human takes and
explicit unsupported-range rejection. The Full package includes its five exact
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
cannot pass. It additionally requires Full and Runtime uploads, independent
Runtime verification, both extracted startup checks and the retained delivery
record to succeed. A failed Runtime startup leaves no qualified Runtime
candidate, even if Full was already uploaded. Existing packages are unchanged;
this additive process only applies to future ordinary builds.

The workflow requests 90-day retention for both distributions and all its
native/browser raw evidence, including final Runtime startup proof. Repository
policy can shorten that period. Confirm actual availability and the separate
full Verify workflow's complete evidence before delivery. Offer Runtime only
while its exact Full package and all required checkpoint proof remain available.
An expired or inaccessible artifact is not an audit pass; do not replace its
proof with a new build or silently extend distribution beyond evidence retention.
For long-term delivery, retain the exact bytes at an approved durable location.

Keep the entire extracted distribution together when redistributing. Full
includes `evidence/`; Runtime intentionally keeps that namespace in the
separately retained Full package. No runtime dependency may live only under
`evidence/`. Every other file is retained, even when future assets enlarge the
Runtime ZIP; there is no size-driven pruning. See
the Runtime format and offline verification guide at
`docs/NATIVE_RUNTIME_PACKAGE_FORMAT.md` inside the extracted package.

Rust notices include lockfile-verified MPL source archives,
Rust standard-library licenses and the Microsoft SDK loader notices. The
WebView2 Runtime has separate terms and is not included. Imported third-party
music retains its own rights; this package contains only the catalog's reviewed
sources and original exercise content.

The separate `WorldMusicClub-Windows-x64-*` browser package and its
`WorldMusicClub.exe` still use the local HTTP server described in `docs/WINDOWS.md`.
This Native package is a distinct preview. No installer, updater, signing or
GitHub Release publication is implied.
