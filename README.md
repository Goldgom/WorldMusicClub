# WorldMusicHub

A Rust-backed music-practice and rhythm-game project.

## Product direction

- Preserve note-level musical structure and timing in a versioned score model
- Import MusicXML/MXL and MIDI, with assisted staff-image/fragment recognition and an explicit correction step
- Display staff notation and numbered notation (jianpu)
- Offer piano and guitar practice, configurable piano ranges such as 61 keys, and transparent instrument-range adaptation
- Synchronize score playback, a virtual instrument and falling-note practice
- Optionally use MIDI input for timing/pitch assessment, calibration and practice diagnostics
- Provide light, dark, system and custom themes with a clean, accessible interface

## Development status

Initial development is in progress. This document describes the intended scope, not a claim that all features are implemented or verified.

Changes will be recorded in meaningful, incremental commits. A Windows release build is planned at each 50-commit milestone, with reproducible tests and explicit platform-verification limits.

## Music and asset rights

Code and music assets have separate licensing requirements. Built-in note data will use original exercises, verified public-domain editions or appropriately licensed sources, with provenance and attribution. Noncommercial use does not automatically permit redistribution of a composition, arrangement or recording. User-imported scores stay local by default and must not be committed to this repository.

Requested commercial-song examples may initially contain metadata, official source links and local-import entry points until score redistribution permission is established.
