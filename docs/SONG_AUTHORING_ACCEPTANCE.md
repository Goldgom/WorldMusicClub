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
exercise first demonstrates real navigation pause. A new native Play/KeyR/Pause
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

## Still required before an accepted checkpoint

- Run both focused jobs on one clean, published exact source and inspect all
  actual screenshots; locally prepared scripts and synthetic verifier tests do
  not prove browser or Windows behavior
- Add the authoring unit/protocol suites to the aggregate full checkpoint and
  install the pinned YAML parser on each runner that executes workflow tests
- Wire both focused authoring jobs and their exact source proof into the full
  frozen-validation summary, retaining the existing browser/native/take/clock
  and package assertions
- Add the strict authoring manifest to release-manifest validation and package
  evidence assembly, requiring the same SHA/tree/EXE as every other accepted
  proof; reject missing, extra or changed claims and any unbound report bytes
- Run the full Rust workspace, Node, formatting/clippy, real-browser and Windows
  package gates for that final exact source before promotion or acceptance

No full-gate wiring, release, package publication or change to current acceptance
is performed by this focused harness preparation.
