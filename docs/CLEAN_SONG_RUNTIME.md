# Complete-song frontend runtime

The ordinary native song library accepts a version 2 `clean_package` descriptor from `/api/library/load`. It uses the complete compiler's `runtime.compilation` for both preview and activation. The frontend does not reconstruct the semantic clock by recompiling rounded BPM. Rust remains responsible for canonical notation, validation, practice targets and grading.

## Admission and identity

A package is bound to `native:song-<content_sha256>`. Its descriptor carries exact `metadata_json`, exact complete `score_json`, normalized canonical notation, complete runtime and validated media descriptors. Canonical comparison ignores JSON property order and uses the normalized native score, because serde defaults can differ from optional fields omitted in portable JSON. The exact portable bytes remain owned by native storage and export.

Media is retrieved only by `/api/library/asset` with the loaded native key and an admitted opaque handle. MIME, byte count and SHA256 must match before a Blob URL is created. Portable paths never become URLs. URLs are revoked on replacement, navigation, page exit and decoding failure. Optional media failure leaves the notation and music available and displays an actionable localized message.

## Sound and timing

`wmh-procedural-reference-v1` is an explicitly declared reference rendition, not the original instruments, plugins or GM sound. The existing authored oscillator receiver supplies 16 program families. Every source program change retains its channel identity; held notes resumed after a later program change keep their onset program. Initial receiver defaults are program 0, volume 100, expression 127 and pan 64. Volume, expression and pan changes are scheduled by channel, with separate part lanes and mute gates. Release velocity is retained but does not change the reference envelope.

CC91 uses `wmh-reference-room-v1`: an authored deterministic stereo impulse of 1.2 seconds, at most 96 kHz, and wet gain at most 0.22. The immutable impulse is shared within one AudioContext while each part has independent dry, send, convolution and wet paths. Send zero gates wet output to zero. Pause, stop, error and replacement disconnect all voices and effect tails; no old callback can restart them. Reference playback is limited to 128 parts and 128 scheduled voices globally; exceeding a bound stops the rendition rather than dropping parts or stealing voices.

Nonzero banks, nonzero chorus and pressure commands block this renderer. Neutral bank/chorus zero and typed metadata are retained and supported. The first complete-score profile itself rejects other unsupported source semantics, including percussion, pedals, pitch bend and overlap. Recorded full mixes and stems, when present, are retained for export and are not layered over reference audio.

The app's existing Transport is the only song clock. Audio reads that clock, schedules a bounded lookahead against AudioContext time and stops on missed deadlines. Initial and resumed playback share a 50 ms admission boundary with the recorder. The background/PV uses the same song position, honors its offset and starts only after an explicit playback gesture. Video is muted by default. Loading a song or finishing a stale promise never grants playback permission.

## Parts, notation and transformations

Simplified staff, numbered notation and engraved notation initially show all parts. A clean practice session selects exactly one human part. That part is silent in machine playback; other parts can be toggled independently while paused. Machine sound has no connection to the recorder or input evidence. Changing the target or accompaniment selection resets the take.

The parts menu reports all source tracks, channels, source-event counts, program families and inferred notation. The range summary includes every note, the complete pitch range and the number outside the configured physical instrument. The 88-key action changes the actual piano configuration. It does not transpose, discard or silently claim that a smaller device can play the whole song.

Tempo, A–B loops, metronome and pitch-copy transformations are disabled for active complete songs until a matching full semantic runtime can be derived. No notation-only transformation silently leaves old accompaniment running. An independent import clears the former complete-song descriptor and media. Generic JSON backup/export cannot strip a complete package: use the existing complete song-pack export. Mixed legacy/complete pack selection is rejected.

## Stable controls

- `#clean-song-preview[data-package-id]`, `#clean-song-preview-status`, `#clean-song-rendition`, `#clean-song-tracks`
- `#preview-part`, ordinary `#start-listen`, `#start-practice`, `#play-button`, `#reset-button`
- `#song-parts-tools > #song-parts-summary`; opening the menu pauses playback
- `#clean-song-stage[data-package-id][data-renderer-state]`, `#clean-song-target`, `#clean-song-parts input[data-part-id]`
- `#song-complete-range-text`, `#song-use-piano-88`
- `#clean-song-cover`, `#clean-song-background`, `#clean-song-pv`, `#clean-song-media-status`
- Existing `#bulk-import-export-songs input[data-import-export-key]` and `#bulk-import-export-pack`

Target options and accompaniment inputs keep their DOM identity during playback updates, language changes, pause and selection changes within the same package. The rendered values and disabled state are updated in place.

## Validation

`npm run test:clean-song` uses the core-generated original authored fixture: three tracks, two independently performable parts, five notes, 25 source events, programs 0/24 and an exact 500000 → 400000 microsecond tempo change. Tests cover native descriptor/media integrity, renderer commands and cleanup, shared-clock resume, optional-media lifecycle and the actual app's ordinary library/listen/practice paths. They also cover selected-only target timelines, no machine captures, stable target controls and range/transform boundaries.

Node DOM and fake audio are not actual codec, native Windows or real-browser acceptance. The same-source hosted browser and Windows acceptance gates remain required. No user music is included in these fixtures.

This frontend was reconstructed after the task environment reset. Its code and validation are a new checkpoint; the earlier patch hash and pre-reset test results do not certify this recovered implementation.
