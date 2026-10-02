# Complete MIDI reference listening in the Import flow

This isolated UI slice adds **Import → Complete MIDI reference listening** to the actual application. It depends on the song API cumulative patch and the original reference player/receiver patch; it is not a saved-score format, score importer, notation view, practice implementation, or completion of the unified song/difficulty feature.

## Source and playback boundary

- The selected file's complete original bytes are copied, SHA-256 bound, and posted to the live trusted `/api/midi/events` Rust adapter. The production UI accepts no event-JSON import.
- The in-session source retains the original filename and bytes. **Download complete original MIDI** emits the exact retained byte sequence. Closing the panel keeps that source in memory. Reloading or leaving the app does not persist it.
- Counts disclose all source tracks, events and positive NoteOn onsets, including overlapping identical keys. Per-track names are literal source text. Every source event remains in the prepared timeline even when an independent track is muted.
- Track mute is available only while stopped and only where the track has no shared channel. The player rejects ambiguous routing, unsupported receiver semantics and scheduling/voice-budget failures instead of silently dropping them.
- Playback requires selecting the displayed reference rendition and a real Play/Resume gesture. It uses the existing `Synth.context` and `Synth.output`. Opening/loading/policy selection does not construct or resume audio; enabling the shared sound preference does not automatically start reference playback.
- The explicit localized policy identifies the original oscillator/noise rendition, zero-based source program retention, FIFO independent onsets/releases, no inferred notation duration, and **WMH Reference Percussion v1** on channel index 9. Program 118 does not identify the source kit. Pausing/resuming uses the receiver's documented envelope reconstruction.

## Existing activity and interruptions

Opening the modal pauses existing score/free activity. It never replaces the selected score, its source/export, control nodes, edited setup fields or performance records. The reference controller has no capture/scoring callback.

A reference interval in the input routing history excludes human input stamped during listening, including delayed callbacks delivered after the modal closes. A genuinely delayed human observation stamped before listening retains its earlier score/free ownership and remains silent under the modal. It is not relabeled as reference playback. New assessments are not started while the modal is open; an already requested result is retained and settled after close.

The reference file chooser pauses and cancels voices **before** opening. A native bubbling file-input `cancel` event retains the old source and paused clock. Close/navigation/import stop playback. Blur/visibility/pagehide cancel reference voices without inventing a scored-input boundary. Shared sound-off cancels current and scheduled reference voices, including an asynchronous start still waiting on audio unlock. Starting controls render immediately so Pause/Stop remain usable during that wait.

Locale modules provide Chinese defaults and an explicit English alternative. Language updates retain source names, controls, checked values, muted tracks, clock and existing score/take identity. Diagnostics use retained machine identifiers with localized application explanations.

## Verification

`tests/frontend-reference-listening.test.js` uses LinkeDOM, the real controller/receiver, fake audio, and the actual app entry. It checks complete-byte requests/downloads, track/event/onset counts, policy gating, shared audio, pause/resume/stop, file chooser cancellation, runtime diagnostics, language identity, original score/take/draft preservation, MIDI/pointer exclusion, earlier human MIDI retention, delayed interval routing, deferred in-flight assessment results, stale file reads, and interrupted asynchronous audio starts.

`tests/reference-listening-fixture.js` is a newly authored tiny synthetic format-1 MIDI specification, unrelated to third-party music: 3 independent tracks, 26 events, 8 onsets, overlapping keys, channel 9/program 118, and 6 seconds. It includes the exact expected Rust output, including original source ranges and rational clocks.

`tests/reference-listening-browser-regression.js` is registered with the hosted full-app suite. It uses the actual Rust response and real browser audio, checks exact source download bytes, visible source programs, independent-track mix counts, transport/locale behavior, and an unchanged captured score/take. **Authored only in this slice; it must be run by the integrator's hosted CI. No local browser, headless process, GUI, or server was launched.**

Durable unified song-folder storage, one-song difficulty selection, assistance/practice integration and full user-source acceptance remain open. The current native165 recovery build is not modified by this isolated work.
