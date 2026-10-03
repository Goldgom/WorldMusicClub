# VSQ clean score profile v1

This adapter is separate from the frozen DSB301 decoder and from the semantic
MIDI clean-score profile. Its format is `worldmusichub-complete-score`, version
`1`, with the independent top-level profile `wmh-vsq-clean-v1`. A successful
conversion establishes structural preservation of the supported authoring and
named dispatch fields. It does **not** establish whole-vocal rendering,
voicebank availability, effective dispatch timing or acoustic equivalence.

The frozen source decoder remains `score_core::vsq::decode_vsq`. This adapter
uses it at conversion time, normalizes the engine dispatch, then removes the
controller arrays from its public authoring DTO. No low-level decoder change,
generic MIDI fallback, source payload, original text, archive, base64 encoding,
or opaque unknown-event variant is introduced.

## Public envelope and bindings

`VsqCompleteScore` contains:

- `format`, `version`, `profile`: explicit dispatch and compatibility identity
- `source`: `format: "vsq"`, original byte count and lower-case SHA-256 evidence
- `notation`: the existing canonical `Score`, with `source: null`
- `authoring`: controller-free authored project, including PPQ, complete tempo
  and meter origins, master and track ends, PreMeasure, mixer, singers, lyrics,
  phonetics, exact decimal values, vibrato envelopes and every supported curve
- `engine_dispatch`: the separately named `wmh-vocaloid2-named-dispatch-v1`
  profile, with all required interpretation limits
- `coverage`: separate counts in explicit units, recomputed by validation
- `capabilities` and `interpretation_limits`: mandatory blocked-vocal and
  explicitly chosen instrumental-practice capability declarations

`AuthoringProject` and `AuthoringTrack` preserve the frozen authored fields and
their identities. They have no controller-event property. Nested authored
structures reuse the closed frozen DTOs; unknown fields are rejected at every
object boundary. This is a semantic model, not text pasted into JSON.

`validate`, `decode_json` and `encode_json` are authoritative boundaries. They
check source identity across layers, all authored constraints, every named
engine binding and count, and exact equality with regenerated notation.
Part/note IDs, source tracks, singers, rational onset/duration, base pitch,
Dynamics, tempo and meter origins, measures, ties and all other derived musical
fields cannot be edited independently. Canonical validation also checks title
and producer metadata. A saved producer marker is preserved across compatible
reader-version changes; it is not rewritten to the current build's version.

The notation title is the user-provided title. Every authored note is projected,
including muted and unsoloed tracks. No filtered target-part view can stand in
for a complete score. The exact integer tempo map remains authoritative even
though canonical notation exposes approximate BPM for the existing score API.

Only `convert_vsq` sees original bytes and calculates verified source evidence.
Loading a JSON hash alone cannot prove that an external original is authentic.
Originals remain in private audit storage outside the delivered clean folder.

## Coverage units

The fixed coverage status is
`structurally_complete_authoring_and_named_dispatch`, and the notation status is
`all_authored_base_notes`. Neither is a rendering or acoustic-fidelity claim.

`coverage.project` counts `tracks`, `notes`, `singers`, `lyrics`, `vibratos`,
`envelope_points`, `curves`, `curve_points`, `tempo_changes` and `meter_changes`.
Depth and rate envelope points are counted separately from curve points.

`coverage.named_dispatch` counts `tracks`, `commands`, `parameter_fields` and
`source_controller_records_accounted`. A decoded command, a selected parameter
field and an original controller record are different units. A parameter pair
remains one parameter field; transport selectors and byte packing account for
multiple source records. These counts are never relabeled as MIDI
`represented_events`. Engine validation checks the exact controller-span
accounting and authored note/singer bindings without retaining controller arrays.

Engine parameters with unresolved unit semantics remain explicitly unscaled.
No effective cross-group delay is inferred. Every required authoring, engine
and clean-profile limitation must remain present, in its defined order.

## Runtime and timing

`compile_vocal(&score)` always returns a blocking error after validation. There
is no automatic instrumental fallback from that operation.

The caller must explicitly choose
`compile_practice(&score, PracticeChoice::BaseNotesInstrumental)`. This returns
`PracticeRuntime` with profile `wmh-vsq-base-note-practice-v1`. The player must
identify this mode as base-note instrumental practice. The practice instrument
is a separate user selection; VSQ singer `voice.program` remains a descriptor
and must never become a General MIDI program or instrument selection.

The Rust compiler integrates the complete integer microseconds-per-quarter
tempo sequence once, using a prefix sum and exact integer arithmetic. A note
spanning a tempo change integrates each affected segment. Exact microseconds
use a decimal-string `numerator` and positive integer `denominator`; floating
milliseconds are derived only at the scheduling boundary, retaining integer
and remainder separately until conversion.

Runtime carries both the original project coordinates and practice origin:

- `project_ppq`, `premeasure_bars`, `practice_origin_tick`, and exact
  `practice_origin_project_microseconds`
- every note's original `project_start_tick` and `project_end_tick`
- practice-relative exact `start_microseconds` and `end_microseconds`, plus
  boundary `start_ms` and `end_ms`
- `project_end_tick` and practice-relative end time, including declared source
  ends; these boundaries do not prove an acoustic tail

PreMeasure is subtracted only for the explicit practice clock. Canonical
notation and authoring keep project tick zero. Practice scheduling is bounded
to 24 hours; a longer stored project remains data but cannot produce a runtime.

Each runtime note retains `note_id`, `authored_note_id`, `part_id`,
`source_track_index`, `singer_event_id`, `key` and `dynamics`. There is no MIDI
channel or GM-program routing field. Parts retain singer descriptors and their
complete per-track mixer objects. Master fader, pan, mute and output mode also
survive. `audible` flags reflect master mute, track mute and solo selection;
all notes remain in the DTO so reference-listening selection is reversible.
Fader gain, pan scaling and output-mode acoustics are not inferred.

Mandatory limitations disclose that PIT/PBS, vibrato, expression curves, lyrics,
phonetics, engine dispatch timing and acoustic tails are not synthesized by
base-note practice. Structural completeness cannot remove those limitations.

## Offline package converter

After integration into `score-core`, invoke:

```text
cargo run -p score-core --example convert_vsq_clean -- INPUT.vsq OUTPUT_DIR
```

The output directory must not exist. The converter validates everything before
claiming it with exclusive `create_dir`, then writes `score.json` with
`create_new` and `metadata.json` last. Both files are synced. It never replaces
an existing directory or file and never deletes original input. An interrupted
write can leave a newly created incomplete directory for inspection; readers
must reject a missing, malformed or hash-mismatched metadata/score pair.

Successful output contains exactly:

```text
OUTPUT_DIR/metadata.json
OUTPUT_DIR/score.json
```

Metadata follows the clean song v2 shape: `format: "worldmusichub-song"`,
`version: 2`, notation-bound ID/title, the exact score path/byte count/SHA-256,
source-evidence descriptors, rights, and `media: []`. The adapter asserts
`user_supplied_unverified` rights and no license grant. Media is optional; this
bounded converter produces none. A future asset-producing extension must use
the separate validated clean package media contract.

`package_metadata(score, score_bytes)` decodes the exact supplied bytes and
checks they describe that score before calculating the file hash. Metadata
hashes bind exact serialized bytes, not just an equivalent in-memory model.

## Native and JavaScript integration contract

The public API and DTOs are provided here; native package import/export,
storage, asset handling, and JavaScript playback integration are separate
acceptance work. This adapter does not imply those paths are integrated.

Readers must dispatch by the explicit VSQ `profile`, keep VSQ coverage units
separate, call the Rust clean decoder before accepting the envelope, and bind
metadata ID/title/source evidence and exact file hash. A MIDI-specific reader
must reject the VSQ profile rather than force it through MIDI coverage or
channel routing. Unknown profiles fail closed.

A native load operation should retain the full validated `VsqCompleteScore`
and expose its capabilities. Only an explicit base-note-practice user choice
may call the Rust runtime compiler. JavaScript consumes its boundary DTO; it
does not reconstruct tempo integration, singer binding, or source coverage.
Full-vocal playback remains blocked independently of successful conversion.

Native persistence/export must retain exact validated JSON bytes or the Rust
model. Authored exact-decimal coefficients can exceed JavaScript's safe integer
range, so parsing and reserializing the full authoring envelope through ordinary
JavaScript `Number` values is not a lossless storage route. Runtime exact-time
numerators are strings specifically to avoid this issue at the browser boundary.

The schema at `schemas/vsq-complete-score-v1.schema.json` describes the closed
JSON structure and references the existing canonical score schema. Schema
checking alone cannot establish cross-field identities, coverage counts,
rational timing equality or playback permission. Rust validation is required.

## Validation status and acceptance

The original synthetic unit cases cover authoring/dispatch round trips,
unknown fields, forged notation and coverage, removed limitations, exact
tempo-spanning timing, PreMeasure, mute/solo retention, metadata hashes,
producer-version compatibility, and the runtime scheduling bound. No supplied
song content is included in source or CI fixtures.

These files were reconstructed after an execution-workspace replacement. They
must be compiled, formatted, tested and independently compared against private
originals after repository restoration. No post-recovery compilation, browser,
server, headless, GUI or native acceptance is claimed by this document.
