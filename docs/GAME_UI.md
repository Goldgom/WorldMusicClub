# Song lobby and performance stage

The application opens in a song lobby. Search uses title/composer text and the explicit edition origin. Selecting a bundled card prepares a separate candidate with the local Rust compiler and instrument checks. It does not replace the current score, clear an existing take, or start audio.

**Listen** and **Practice** explicitly start a new session. Practice remains unavailable while the candidate is pending, out of range, unverified, or incompatible with the chosen instrument. Activation uses the normal canonical load path and checks the actual selected targets again. Listen does not remove unavailable notes or adapt their pitches.

**Songs** pauses playback and releases held/scheduled sounds before returning to the lobby. **Resume session** returns to the existing stage, still paused. Press Play to continue. Browsing and searching do not clear its recorded inputs or completed results.

Importing a valid local score, opening a saved copy, or activating a reviewed/adapted score remains an explicit replacement action. These actions replace the paused score and clear its in-memory take history. Their panels disclose this before activation. Export take data from Results first when it needs to be retained. Saved library copies and exported backups remain independent.

## Secondary tools

- Settings contains instrument/range, part, tempo, mode, loop, latency, metronome and appearance controls
- Score contains canonical exports, provenance, source limitations and retained-file inspection/downloads
- Import contains local file import, source-finding guidance and the existing review workflows
- Results contains assessed passes and take-data export
- Saved scores retains explicit Save/Open/Delete and backup/restore

Opening a secondary panel pauses playback. Closing it never starts playback automatically. Native modal focus stays inside the panel. The skip link targets the visible lobby or stage heading. Computer piano shortcuts only operate on the stage, outside modal/text controls; Space keeps normal button activation. Genuine delayed MIDI timestamps can still be retained in their previous pass buffer after pausing, without sounding new notes in a panel or lobby.

The optional notation dock starts with the existing engraved staff preference and exposes the explicitly named simplified pitch guide when engraving is unavailable. Hidden notation does not create an SVG. Reopening it requests the actual visible width. Following remains an opt-in display function using Rust measure occurrences; closing the dock suspends it.

Session advancement and delayed assessment continue separately from hidden-stage painting. Lane guides are evenly spaced visual guides, not inferred beats or barlines. No JavaScript note matcher, invented combo, or successful-hit animation is introduced by the shell.

## Validation boundaries

The shell has pure preview cancellation/admission tests and Node DOM integration for actual module initialization, control relocation, explicit activation, Back/Resume and stale compatibility after a profile edit. `linkedom` 0.18.12 is pinned as a test-only DOM parser from the official npm registry (`WebReflection/linkedom`); it supplies no browser engine, real audio, network automation or visual validation.

The existing mocked browser and actual Rust-backed browser suites navigate the visible shell controls. Real layout, keyboard focus, downloads, audio lifecycle, 1280×720 landscape and mobile behavior still require their hosted browser run. A local Node DOM pass is not a browser or visual acceptance claim.

This redesign follows the immutable recovery108 baseline. It does not change that release artifact.
