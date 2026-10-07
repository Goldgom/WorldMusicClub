# Whole-song pitch Mod

Pitch Mod is a disposable Rust-derived view of a complete original song. It is
independent of input-device transpose, Basic timbre selection, and saved source
exports. The supported shift is an integer from -12 through +12 semitones.

## Configuration and source boundary

The separate configuration is strict JSON:

```json
{"format":"wmc-pitch-mod","version":1,"semitones":2}
```

It does not contain pitches, notation, playback events, a runtime receipt or an
assistance plan. Unsupported versions, fields, nonintegers and shifts outside
the range are rejected. Existing Mod configuration schemas are not migrated.

POST `/api/pitch-mod/project` accepts exactly `{score, configuration}`. `score`
is the complete original canonical source. POST
`/api/library/pitch-mod/project` accepts exactly `{source, configuration}`.
Native `source` is the existing assistance base descriptor:

```json
{
  "key":"song-<exact saved content sha256>",
  "content_sha256":"<exact saved content sha256>",
  "profile":"wmc-canonical-score-v1",
  "choice":null,
  "runtime_policy":"wmc-canonical-practice-v1"
}
```

For Basic, semantic MIDI and VSQ, the descriptor must name that original
profile and original runtime policy. VSQ requires the explicit
`base_notes_instrumental` choice. A missing choice is not explicit null. The
adapter checks the key, exact primary bytes, active edition and complete-package
backup before decoding the source. It never trusts a renderer's effective notes,
cached runtime, content claim or filesystem path. Every operation reloads this
original snapshot, so a late source/edition change fails instead of applying a
projection to stale data. No pitch runtime is written to the source library.

## Projection output

Successful projection output contains `source`, `configuration`, `identity`,
`receipt`, `source_pitches` and `compilation`. Canonical sources also return the
effective `audio_profile`; native Basic, semantic MIDI and VSQ return their
typed `runtime`. VSQ includes `reference_velocity` and its original exact-clock
navigation when available. No profile is inferred from a partial timeline.

`source` always describes the original. Nonzero `identity` binds the operation
version, semitone shift, deterministic written interval and original practice
receipt. `receipt` describes the effective runtime and has
`runtime_policy = "wmc-pitch-mod-v1"`. Its runtime digest differs from the
original. The source binding, saved-package digest, original profile and choice
remain unchanged. A cache must include the full effective identity and effective
receipt; source ID alone is insufficient.

Rust supplies every effective pitch. `source_pitches` joins original source IDs
to original/effective MIDI values and explicit percussion semantics. JavaScript
may join these IDs but must not calculate another shift. `compilation` supplies
the effective written score and the same complete timeline used by targets.
Canonical audio is independently compiled from that effective notation and
fingerprinted. Native audio changes only authoritative note keys. Basic compact
rendition rows contain no keys: their complete-source FIFO ownership, exact
gates, releases and policy evidence remain byte-identical; the compact target
timeline contains the effective keys. Basic part ranges are recomputed from
the Rust pitch inventory. VSQ preserves the explicit practice zero origin.

Every original ID, tie/repeat relationship, rational clock, velocity, program,
controller, lyric and source event remains intact. Explicit channel/role
percussion is unshifted. A pitched note outside MIDI 0–127 rejects the whole
operation with `pitch_mod_midi_range`; there is no clipping or partial output.
That failure is separate from later playable instrument-range diagnostics.

## Assistance, progression, notation and fingering

Existing canonical `/api/practice-assistance/*` and
`/api/practice-progression/*` request shapes accept an optional `pitch_mod`
configuration beside the original `score`. Native assistance and progression
accept it beside the original `source`. They reload and project before planning
or validating. A nonzero response is `{source, checked, pitch_mod}`, where the
last value is the complete issued projection identity and `checked.receipt` is
the effective receipt. A plan from zero, another shift, another source, another
interpretation or another version fails validation. These endpoints do not
accept the client's proposed effective receipt as source.

Native `/api/library/basic-keys/notation` accepts optional `pitch_mod` beside
the original `{source, settings}`. Rust validates the complete original Basic
source, creates the requested bounded page, then applies the same global
written interval to its notation, MusicXML and every pitch-bearing page record.
A nonzero response adds `pitch_mod` identity and `receipt` beside `source/page`.
An explicit source-only inspection omits the configuration.

Canonical `/api/pitch-mod/fingering/piano` and `/guitar` accept
`{score, configuration, settings}`, where settings contain the existing planner
fields except `score`. The adapter rejects a score or timeline inside settings
and supplies the trusted effective fingering source itself. The response is
`{source, pitch_mod, receipt, plan}`. Native existing fingering paths accept
optional `pitch_mod` beside `{source, settings}` and add those two proof fields
only when nonzero. Basic full-song fingering remains unavailable because its
receiver interpretation does not establish the existing planner's exact source
contract. Plans and locks must be discarded/recomputed after pitch/source/profile
changes; an unshifted cached fingering result is not effective-pitch evidence.

## Zero, cancellation and bounds

Zero has no projection identity and uses the original receipt, notation and
timeline. Existing assistance/progression/notation/fingering endpoints retain
their prior response bytes for missing or zero configuration. Explicitly
requesting an unsupported configuration version with zero still fails.

Projection requests are read-only. The UI may prepare a candidate, then apply it
only if the source and request generation still match. Cancel/Close or a newer
request discards the candidate and must leave the active view/configuration
unchanged. Turning the Mod off restores the original view and invalidates the
effective assistance/fingering caches. A separate explicit UI configuration save
may persist the sidecar; source JSON, backups, and exported packages stay exact.

New stateless requests share the existing 8 MiB admission and 16 MiB complete
response budgets. Native requests use 8 MiB and complete responses use 32 MiB;
native progression retains its existing 16 MiB response limit. Core source,
occurrence, serialization and spelling budgets still apply. Exceeding a budget
fails the whole request; no notes, IDs, proof fields or source events are trimmed.
Routes require POST, the existing same-origin boundary and JSON content type.

## Reproduction

`cargo test -p practice-server --test pitch_mod_api --locked` exercises the
stateless C4→D4, audio/notation, strict-input, MIDI-domain and stale-proof paths.
`cargo test -p worldmusichub-desktop --test native_pitch_mod --locked` exercises
actual socket-free native handlers, exact source/disk preservation, Basic FIFO
and percussion, VSQ clocks, native pages, identity rejection and fixture parity.

To reproduce the public original handler vectors:

```sh
cargo run -p worldmusichub-desktop --example generate_pitch_mod_fixtures --locked -- tests/fixtures/pitch-mod-handler-vectors.json
```

The generator builds newly authored canonical C4 and Basic FIFO/percussion
sources plus the existing original VSQ test fixture, saves them through native
storage, then captures actual production handlers. It does not fabricate
derived expected output. These focused checks are not full workspace,
real-browser or Windows package acceptance.
