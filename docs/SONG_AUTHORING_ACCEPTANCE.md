# Original MIDI authoring focused acceptance

This harness is prepared on the isolated `83c4ca1dbe4ca9db1cb9fb49d215dc5744c42ede`
source / `356e972d21a42ed4ce53fdeaf533265976120dc9` tree, plus the acceptance-only
changes recorded in its commit. It does not change frozen pitch batch 239 or
declare a release accepted.

The finite source generator is `scripts/prepare-song-authoring-fixtures.mjs`.
Its original C/E/G inputs include a conductor, independent MIDI channels and
keys 24/100 outside the default 61-key range. The three complete files exercise
strict notation with nonzero bank selection, same-key overlap requiring the
event-only profile, and an
unsupported controller on an otherwise retained controller-only track. The
fixture provenance is CC0 original work; conversion metadata deliberately
retains the application's ordinary unverified-user-source rights description.
Nothing is copied from private music.

The only multi-file native picker alias is `authoring-original-pair`, resolving
to exactly `authoring-original-strict.mid` and `authoring-original-events.mid`.
The single blocked filename is `authoring-original-blocked.mid`. The Windows
helper keeps its process ownership, HWND identity, foreground, hit testing,
filename readback, regular-file/reparse and dismissal checks. The renderer
independently hashes actual selected File bytes and checks their names/count.

`preview/authoring-conversion` runs focused hosted Chromium and Windows jobs.
Both parse the complete workflow with pinned PyYAML before feature commands and
check that every `run` value is a string. Rust `acceptance::` filters are quoted
YAML scalars. Hosted checks cover 1280×720, 1280×900 and 1920×1080. They use real
Rust stdio and an actual browser chooser; Windows uses the real owned OS picker.
Each executes seed and fresh-process restart against one isolated native library.

The screen proof covers review without persistence, every source track, title
editing and content-fingerprint regeneration, explicit Save All, saved-song
browsing, exact duplicate detection, explicit Keep Both, rejected complete
inventory, and exact clean ZIP export. Candidate classification never establishes
sound support: the strict source imports with `playable: true` while the actual
reference receiver rejects its bank selection. The independent-event source
imports with `playable: false` for notation while its reference receiver can be
admitted. Actual runtime/receiver admission remains separate. The stdio
checker also probes invalid/stale title and changed-source fingerprints, export
reimport and unchanged source/metadata/score bytes.

All chooser operations finish before the compared human take. The original
exercise first demonstrates real navigation pause: the actual Start Listen
click must precede an advancing listen clock, then the actual Songs click must
leave the session paused with no held keys. Its bounded transport trace records
both trusted gestures and their ordered state changes. Start Listen already
starts playback; no extra Play toggle is used in this navigation check.
A new native Play/KeyR/Pause
take then establishes an exact baseline after navigation/input cleanup. Title,
authoring and settings keys run with sound explicitly enabled and must leave
that whole take unchanged, including
every input event, blur boundary, receipt clock and assessment. Transparent
audio observation must show zero newly scheduled sources and no auto-resume.

`verify-native-song-authoring-evidence.mjs` checks both renderer reports, finite
native actions, original file bytes, screenshots, primary/backup clean packages,
retained import ZIPs and process snapshots. The independent Python manifest
requires the exact source SHA, tree and executable SHA/length plus the strict
closed boolean claim set. Focused proof explicitly sets full acceptance,
release readiness, physical audibility and candidate-implies-playability false.

## Mandatory final gate wiring

The full `package.json` Node suite includes the authoring model/UI, original
fixture, native evidence, focused-workflow and final-gate contracts exactly once.
PyYAML 6.0.3 is an explicit QA-only dependency. Jobs that run this suite or can
select a parser-dependent test through quick development provision Python 3.12
and the pinned parser first, including frontend, native acceptance and legacy
Windows jobs. The parser is not a runtime dependency or bundled app asset.

`.github/workflows/windows-desktop-acceptance.yml` requires the real authoring
stdio check and all three hosted sizes before its browser job succeeds. Its
independent Windows job requires `-Scenario authoring`, then rechecks the source
SHA, tree, executable SHA/length, strict proof and focused manifest before
packaging. The existing pitch, VSQ, performance, other native and final summary
gates remain required. Failed or skipped jobs cannot establish acceptance.

Native package creation requires `--song-authoring desktop-authoring`.
`scripts/native-release-manifest.py` validates and copies exactly seven authoring
evidence files into the package:

- `native-song-authoring.json`
- `renderer-authoring-seed.json`
- `renderer-authoring-restart.json`
- `profile-authoring-seed.json`
- `profile-authoring-restart.json`
- `native-song-authoring-files.json`
- `song-authoring-manifest.json`

Directory and ZIP verification require that same allowlist, the closed exact
boolean claim set, and agreement between the package executable, source identity,
report hashes, proof hash, focused manifest and BUILD-INFO acceptance fields.
Each host profile record must prove atomic creation at its exact phase-specific
path, with a distinct process and the same `Scores` library root. Both records
are bound into the proof and focused manifest and rechecked inside the package.
Changing evidence while merely recomputing archive/file checksums is insufficient.
The larger original-fixture screenshots and storage archives remain separately
retained workflow evidence, not extra package evidence files.

## Still required before an accepted checkpoint

- Run both focused jobs on one clean, published exact source and inspect actual
  screenshots; local contract tests do not establish browser or Windows behavior
- Integrate any independently required native/profile repair without weakening
  existing assertions, then run the final combined source through full validation
- Run the full Rust workspace, Node, formatting/clippy, real-browser, every native
  scenario and extracted-package gates for that same final SHA/tree/EXE
- Require both the native/browser summary and separate full Verify workflow to
  pass for the exact packaged source before delivery or main promotion

This wiring does not itself run those gates, publish a package, change frozen
batch 239, or make a new source or executable accepted.

## Separate VSQ authoring route

The isolated [VSQ authoring slice](VSQ_AUTHORING_ACCEPTANCE.md) uses the same
screen's actual original-source chooser but has its own two native phases,
fixture/response oracles, proof, claims and focused workflow. It preserves muted
and note-free vocal parts, requires an explicit base-note instrumental choice,
and does not claim original vocal synthesis. It does not replace this MIDI
scenario or change the final gates described above.
