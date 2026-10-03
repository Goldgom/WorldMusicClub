# Manual tone release

Manual piano/guitar input creates one instrument oscillator. It does not call
the opt-in metronome click synthesizer or the separate MIDI reference percussion
renderer. There is no additional per-key impact-sound layer to disable.

A genuine note-off or retrigger now applies a 12 ms linear fade to a separate
unity-gain node after the existing instrument envelope. This removes the
previous gain step at an ordinary release without changing the oscillator,
frequency, velocity curve, attack/decay, capture timestamp, or replacement note's
start time. Scheduled listening/replay duration envelopes are unchanged. The
manual fade never extends an already-scheduled oscillator stop.

`Synth.stop(id)` and `silence()` remain immediate cancellation operations.
Future onsets are cancelled without a fade. Stop also cancels retired voices
with the same ID; stale `onended` callbacks cannot remove a replacement. Active
and retiring voices share the original 64-voice budget, with old release tails
retired before a held voice at capacity. Capacity/panic cancellation can still
cut a waveform immediately by design.

The app's existing ownership/time checks still select which contacts can be
released. Cleanup includes retired manual sources after their visual key has
already been cleared, so blur, hidden-page, and MIDI panic handling can stop
these tails. Synthetic cleanup continues to use hard stop.

`tests/synth-release.test.js` samples an independent automation model and checks
continuity during attack, decay, sustain, and scheduled fade, exact zero at the
release end, future cancellation, stale callbacks, and the combined voice cap.
It is included by the existing frontend core suite. The free live-audio DOM
tests exercise ordinary/free release, immediate visual feedback, hidden cleanup,
timestamp-scoped MIDI panic, and synthetic cancellation. Existing exact hard
cleanup assertions remain in place.

These are Node model/DOM checks, not a real-browser audio rendering or listening
test. They establish the release/cancellation behavior; they do not establish
that it resolves a particular user's perceived sound or speaker limitation.
