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

The compact corner icon enters or exits browser fullscreen for the entire document, keeping the lobby, stage, notation and body-level dialogs together. Its bilingual accessible name follows the browser's actual fullscreen state; native Enter/Space activate the focused control, and Escape remains the browser's exit gesture. Escape also cancels pending entry intent without preventing the browser or dialog's normal key handling. There is no letter shortcut, keyboard/orientation lock or automatic entry. Unsupported or refused requests leave the app usable and show a brief message. An eight-second pending timeout cancels entry intent; a late entry is exited, including when a modal is open as the request finishes. The app does not issue overlapping entry requests while an expired browser request remains unresolved.

Fullscreen changes do not start, reset or resume playback, unlock audio, change scores or alter take recording. Existing real blur/hidden events still pause and release sounds. Existing resize handlers and the engraving ResizeObserver redraw at the available size, with reduced-motion preferences unchanged. Fullscreen availability depends on the browser and host policy; this control does not change either policy or OS window settings.

The compact performance view puts the stage title and tool navigation in one desktop HUD row. MIDI, count-in and typing-octave settings live in Settings; Sound remains on transport. Wide keyboards keep their complete configured range and expose explicit lower/higher-pitch pan controls when needed. Portrait phones and short landscape windows use a full-width notation view with transport still visible, returning to the keyboard when the score is closed.

The lobby anchors the selected title, composer, abstract artwork and opening key/tempo/part metadata above its scrollable details. Metadata comes from the validated canonical score: an unknown mode stays unspecified, and later tempo/key changes are labeled. It does not infer difficulty or a tonal mode from the key signature. Changing preview identity resets the detail scroll and collapses source notices; readiness updates for the same candidate do not move the reader.

The blocking instrument reason and Start buttons stay together in a fixed footer while source notices and import/replacement guidance remain available in the detail area. The compact song list keeps the selected edition clearly marked. Narrow landscape layouts bound the stage grid and wrap tool labels so controls remain reachable without a scrolling performance page.

The dock uses the adapter's explicit `compactHeader: true` layout option to suppress duplicate title, subtitle and composer headings and reduce its blank top margin. Standalone adapter calls keep their headers and margins by default. This option does not modify the canonical score, MusicXML export, part selection, measure range or note content. Current measure/range/following state remains visible; longer explanations are expandable and the notice-count button opens detailed warnings or the current rendering error. Short landscape windows move part/page-size choices into that expandable area and keep page arrows, range and following in a visible row, leaving space for the music.

## In-play feedback

Captured-note counts describe actual received inputs. They are not a successful-hit count. The HUD only shows an onset match rate from a checked Rust assessment of the same active pass and input revision. It hides previous values during playback, assessment work, changed input revisions, and the positive-latency-plus-tolerance tail after ordinary pauses as well as end/manual-check grace periods.

Results remain labeled **Previous check** because very late timestamps can revise them. Boundary or clock-gap ambiguity is explicitly provisional. A 100% onset match rate can contain late notes that are still within tolerance; it does not mean perfect timing. Complete-onset summaries, when inspected, mean every physical target in that expected group matched within the window, not that the player's chord attacks arrived simultaneously. No-target responses never display a success rate.

The Results dialog presents the selected take's supplied Rust **Perfect / Good / Early / Late / Missed / Extra** counts with bilingual labels. Its checked/current input revisions stay visible. The counters use the same freshness gate as the HUD: recording, delayed-input grace, pending revisions and failed checks show unavailable values until that revision has been checked. A new timestamp updates the selected take without changing the pass picker; boundary and clock-gap warnings remain provisional.

**Complete groups** counts exact expected simultaneous physical-target groups in which every target matched within tolerance. A partial chord is incomplete. **Longest complete sequence** follows expected score order; extra inputs affect accuracy separately and do not interrupt this coverage count. Neither number demonstrates simultaneous chord playing, perfect timing, sustain, release, pedal or an error-free streak. The expandable bilingual explanation stays associated with the counters for assistive technology. Older responses missing either optional summary leave that section explicitly unavailable; empty targets never become a successful take. No grade counts are reconstructed in JavaScript.

Countdown and paused cues use the existing transport state. Pausing during count-in remains Paused, even at a negative musical position; a reset returns to Ready. They do not restart or infer musical timing.

Session advancement and delayed assessment continue separately from hidden-stage painting. Lane guides are evenly spaced visual guides, not inferred beats or barlines. No JavaScript note matcher, invented combo, or successful-hit animation is introduced by the shell.

## Validation boundaries

The shell has pure preview cancellation/admission tests and Node DOM integration for actual module initialization, control relocation, explicit activation, Back/Resume and stale compatibility after a profile edit. `linkedom` 0.18.12 is pinned as a test-only DOM parser from the official npm registry (`WebReflection/linkedom`); it supplies no browser engine, real audio, network automation or visual validation.

The existing mocked browser and actual Rust-backed browser suites navigate the visible shell controls. Added real-score acceptance covers D768 at 1280×720, 1920×1080, 844×390 and 390×844, with clean and expanded-notice lobby screenshots, stage/notation screenshots and measured geometry. Desktop cases also capture actual dark-theme views and compare complete paused-take exports across preview changes. A real assessment case checks HUD pass identity and the delayed-input tail. Real layout, keyboard focus, downloads and audio lifecycle still require their hosted browser run. A local Node DOM pass is not a browser or visual acceptance claim.

Fullscreen coverage includes Node request races/refusals and mocked browser checks for modal focus, Escape cancellation, ordinary keyboard activation and exact paused exports. Registered real-Rust cases use the actual Fullscreen API and native dialogs at 1280×720 and 844×390, inspect notation and guitar-row geometry, and preserve every take field except genuine observed blur/hidden evidence boundaries. Their actual hosted run is required for browser acceptance. A headless API exit validates browser state reconciliation, not physical Escape, OS window behavior or audio hardware.

Results regression coverage includes Node presentation/DOM and actual app wiring, plus registered hosted tests through the real recorder and Rust assessment. Deliberately delayed synthetic keyboard timestamps make partial-chord, late-grade, extra-input and corrected-revision assertions deterministic; this does not claim physical MIDI timing validation. The hosted suite also checks Results at desktop/landscape/portrait widths, dark theme, complete score export and isolated browser rendering of real Rust empty/legacy-compatible responses. These cases require their exact-source hosted run before visual acceptance.

This redesign follows the immutable recovery108 baseline. It does not change that release artifact.
