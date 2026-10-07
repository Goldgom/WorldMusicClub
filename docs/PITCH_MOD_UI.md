# Whole-song pitch Mod controls

The Mod dialog can prepare a whole-song shift from −12 to +12 semitones. Checking
the draft does not apply it. Apply installs the checked view; changing a stage
with recorded takes requires an explicit session restart. Restore pitch selects
zero and returns to the original pitches after Apply.

This changes the song's sounding pitches, notation, falling targets, machine
accompaniment and scoring together. The input keyboard's own transpose setting
is independent: a song shifted from C4 to D4 expects a real D4 input. Applying
another +2 to the input device produces E4, not a second correction of the song.
Selecting a wider on-screen range does not add keys to a physical instrument.

## Supported source paths

- Canonical JSON/MusicXML-derived scores use the canonical audio renderer.
- Basic Keys packages use their complete FIFO rendition, retaining its disclosed
  pairing policy and source diagnostics.
- VSQ packages use the base-note instrumental choice. This is not vocal synthesis.
- The older complete-performance renderer is not projected by this feature. Its
  original playback remains available; nonzero pitch shifting is not offered.

Explicit source percussion classification keeps percussion unchanged. Track
names and selected synthesis sounds do not determine percussion status. A
percussion-only source accepts the existing zero path; a nonzero request has no
pitched material to transpose and is rejected explicitly.

Programs, controllers and source event bytes remain unchanged. Keeping a MIDI
bend event is not a claim that Basic Keys or the VSQ instrumental renderer plays
that bend. The older bend-capable complete-performance path is outside this
projection feature.

## Source and receipt identity

Rust derives every effective pitch and the written interval. JavaScript joins
the checked results by source identity rather than independently adding a number
to pitches. Source note IDs, part IDs, occurrence identities and exact timing are
preserved. Original library files and score exports retain the original pitches.

Configuration is a closed object with `format: "wmc-pitch-mod"`, `version: 1` and
an integer `semitones`. Nonzero results carry a digest bound to the source receipt,
version, shift and written interval. Assistance, progressive assistance, audio and
fingering must use the matching effective receipt. A receipt from the original
pitch or another shift cannot be reused. Omitting the configuration or requesting
zero preserves the previous response shapes and bytes on the existing endpoints.
The dedicated pitch projection endpoint uses its new envelope even for zero,
with an unshifted view and null projection identity.

If any melodic pitch leaves MIDI 0–127, or a projection cannot meet its spelling
or resource constraints, the entire projection fails. Notes are not clipped or
discarded. Instrument range and playability are checked separately after a valid
projection. A valid MIDI pitch is not automatically playable on the chosen device.

## Preferences and interrupted work

A source-bound `wmc-pitch-mod-preference` version 1 sidecar stores the pitch
configuration, Mod choices and matching assistance preferences. Existing v1
assistance and progression records are not silently migrated. Draft checks use
detached preferences; one sidecar write commits the prepared choices.

The app rereads the expected stored value before committing. This detects an
observed conflicting edit, but browser localStorage does not provide a cross-tab
compare-and-swap transaction. A known missing or malformed pitch record is an
error, not permission to silently return to zero or revive an old recipe.

Projection, target admission, audio preparation, stale responses and storage
failures must leave the previously adopted source and takes intact. Closing a
draft invalidates its pending result. Changing the tempo of a canonical score
starts from the original score and checks a fresh projection; shifted pitches
must never become the next source score.

## Verification status

Original Rust-handler fixtures cover canonical, Basic Keys and VSQ projections,
zero compatibility, percussion, domain limits and receipt isolation. Pure DOM
tests exercise draft cancellation, failed storage and production target/audio
consumers. Hosted browser and native Windows checks are separate gates; their
success must be established for the final source SHA before release acceptance.
These tests do not establish physical MIDI-device latency or the user's audio
hardware behavior.
