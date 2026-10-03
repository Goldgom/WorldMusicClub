# Native VSQ clean package bridge

This bounded native adapter admits the independent top-level score profile
`wmh-vsq-clean-v1` in clean v2 song folders. The closed VSQ Rust decoder validates
all bindings before storage. A profile-less envelope still uses the existing
semantic MIDI decoder; any unknown top-level profile fails closed. Clean native
score JSON remains bounded to 16 MiB, within the existing 32 MiB response cap.

Both `metadata.json` and `score.json` are kept as exact validated UTF-8 bytes in
the primary and independent backup. Native restart, recovery, pack export, and
reimport preserve both files exactly, including whitespace and integers beyond
JavaScript's safe numeric range. The authoring JSON must not be parsed and
reserialized by a renderer as a storage route. Native package keys and checksums
are the authority. Canonical `loaded.score_json` is a separate notation view;
its original note IDs, track parts and singer voice IDs are retained. An empty
`keys` array means source key unknown, never an inferred C major claim.

## Admission and open descriptors

Import items expose `clean_package`, the same bounded summary available on saved
entries. A VSQ item can be `ready` or `saved` while `playable` is false: storage
admission does not implicitly choose a playback interpretation. It must remain
visible and selectable so the user can choose limited instrumental practice.

VSQ summary and open descriptors include:

- `profile: "wmh-vsq-clean-v1"`
- `capabilities.whole_vocal_rendering: "blocked"`
- `capabilities.instrumental_practice: "requires_explicit_base_note_choice"`
- the eight mandatory `interpretation_limits` from the core profile

The open descriptor has exact `metadata_json` and `score_json` strings and
`runtime: null`. Opening, importing, listing, exporting, recovering or restarting
never compiles the instrumental practice runtime or persists a prior choice.
Existing MIDI open/runtime behavior and stored summary shapes remain compatible.

## Explicit runtime endpoint

`POST /api/library/runtime` accepts only:

```json
{"key":"song-<native content hash>","profile":"wmh-vsq-clean-v1","choice":"base_notes_instrumental"}
```

The native adapter reopens and validates the complete saved package and backup,
checks the independent profile, then calls Rust `compile_practice_with_compilation`
(which requires the same explicit choice as `compile_practice`). It returns:

```text
{ runtime: PracticeRuntime, compilation: Compilation, reference_velocity: 90 }
```

`runtime` has profile `wmh-vsq-base-note-practice-v1` and retains authored project
coordinates, exact rational microseconds, singer descriptors, track/mixer
semantics, all notes and interpretation limits. It contains no invented MIDI
channel or program routing. The player chooses its practice instrument separately.

`compilation.score` is the unchanged native notation. Its timeline uses native
runtime start/end milliseconds directly, with original note/source IDs, part IDs,
singer voice IDs and all tracks, including muted or unsoloed tracks. Selection of
a human target part filters this timeline without replacing source identities.
Timeline and reference playback velocity 90 are an explicit practice constant;
authored Dynamics is still preserved in the source and runtime and never causes
a note to disappear. Neither expression curves nor singer program numbers choose
practice loudness or General MIDI instruments.

`choice: "full_vocal"` returns HTTP 422 with code
`library_vocal_unsupported`, and never silently chooses base notes. Missing or
unknown choices are invalid requests; a mismatched/unknown profile returns 422
`library_runtime_profile`. The runtime operation shares the native large-operation
admission gate and response size bound. No choice is retained for a later load.

## Verification boundary

Original synthetic backend tests cover exact bytes, wide integers, independent
profile dispatch, explicit selection, unknown keys, native grading identities,
Dynamics 0, all-track retention, forged payload rejection, corruption, restart,
backup recovery, export and reimport. Browser behavior and Windows packaging
acceptance remain separate checks for the combined frontend/native source.

## Display-only written navigation

An explicit practice response also contains `navigation` (or `null` with
`navigation_unavailable: {code, message}`). It is a VSQ-only extension of the
existing version-1 navigation shape, branded
`profile: "wmh-vsq-practice-navigation-v1"`. It binds `content_sha256` to the
complete native package, `source_sha256` to the source/runtime, and includes
`runtime_profile`, explicit `choice`, and `practice_origin_tick`.

Every original written measure remains in original source order, including empty
PreMeasure intervals. Their `start_ms`/`end_ms` are signed practice-relative
clocks, so the first begins at `clock_start_ms` before zero. `written_end_ms` is
the end of the last original notation measure. `duration_ms` remains the selected
runtime end. These three bounds can differ: source-declared tail time has no
invented written measure, and a final written measure can extend past playback.
Following uses half-open playback time; any time beyond the actual written extent
has no written occurrence. No source beat, measure, key, note or timing map is
changed, cropped or synthesized to make the bounds agree.

The existing core navigation path supplies validated exact source membership and
its occurrence/reference limits. The VSQ adapter replaces every occurrence and
written-cursor clock using integer PPQ ticks and the complete integer tempo map,
subtracting PreMeasure before converting to milliseconds. Each source note's
full interval must agree with the native selected runtime. Sounding groups use
original native target IDs and timing. Empty measures and gaps remain explicit;
there is no renderer BPM reconstruction or floating offset correction.

Ordinary navigation retains its original zero-based/full-written-score contract.
The VSQ consumer must explicitly validate the branded package/runtime bindings
before accepting signed premeasure bounds or a separate written extent. The
original 100,000 occurrence, 1,000,000 reference, 4 MiB cursor and 16 MiB navigation
limits remain. The adapter rechecks size limits after re-clocking. Unsupported or
oversized navigation falls back to honest manual paging without blocking valid
practice or changing source data; the native 32 MiB total response cap also applies.

Advisory hands/fingers and guitar plans use the same native compilation through
the [complete-song fingering bridge](COMPLETE_SONG_FINGERING.md).
