# Original pitch-bend focused acceptance

This is an isolated future-feature acceptance route for the bounded
[reference pitch receiver](REFERENCE_PITCH_BENDS.md). It leaves the existing
three-phase performance fixtures, report contract, release claim set and current
acceptance workflow unchanged. Adding this route is not evidence that a real
browser or Windows executable has passed it.

## Original source and finite scope

`crates/desktop-shell/tests/support/pitch_acceptance_fixture.rs` authors all
new input bytes. `generate_pitch_acceptance_fixtures.rs` converts those bytes
through the production Rust MIDI converter and native save/load path. Committed
metadata identifies both paths and grants CC0-1.0 for the original test data. No
private song, title, MIDI file or audio is an input to these tests.

The pack has one conductor and one melodic track per song, 6 ticks per quarter,
500001 microseconds per quarter, and an exact 5000010-microsecond endpoint:

- Original C/E/G at keys 60/64/67, with the declared two-semitone receiver range
- The same original commands with the proved initial four-write twelve-semitone
  setup, preserving every selector/data event
- Original high C/E/G at 108/112/115 with that twelve-semitone setup, held by the
  explicit `unsupported_pitch_range` policy before audio allocation

Nine distinct source bend events retain values
`0, 1, 8191, 8192, 8193, 16383, 16383, 4096, 8192`. Their independent IDs,
coordinates, rational beat positions, native clocks and duplicate endpoint
commands stay in the saved score/runtime. C, E and G attacks and releases remain
integer source keys. Sustain holds every released layer until tick 54. The final
center command at tick 48 leaves a practical native pause interval after all keys
have released at tick 33. Frequency observations are limited to 12 per oscillator.

## Actual application route

`pitch-bend-seed` imports the complete original pack through the real chooser and
exercises the two-semitone song. `pitch-bend-restart` reopens the same native
library in a distinct process and fresh browser profile, then exercises the
proved twelve-semitone song. Both phases also select the range-negative song.
Each phase has a 64-action ceiling and 1 MiB report ceiling. The expected path is
at most 33 native actions for seed and 26 for restart, leaving explicit headroom.

The application is loaded without replacing its APIs, player, clocks, input or
source files. Existing navigation and trusted-control helpers are reused only
as observer prefixes. The native Windows path uses the same process-owned
`#32770` chooser, filename identity checks and OS actions; the hosted path uses
Chromium's real chooser and the exact-source Rust stdio driver. The finite new
filename is `pitch-bend-authored-songs.zip`.

Chooser import/save finishes before the scored human baseline begins. The real
picker's blur lifecycle remains honest. The existing complete take comparator
requires every before/after field to be equal, including input evidence and
assessment. The original canonical human take never uses the event-only song as
its scoring target. Native KeyR during reference listening must add no recorded
input. Reference operations must invoke no notation, fingering, runtime-target or
assessment endpoints.

The renderer observes the application's actual English/Chinese policy panels,
track controls, transport and saved runtime. Transparent bounded wrappers forward
unchanged calls to the production receiver and Web Audio. They record receiver
call order, original key/event identity, strict-range flag, oscillator waveforms,
frequency sets, source start/stop times and disconnections. They do not supply
expected audio or a second receiver. Captures are copied so later scheduling
cannot rewrite an earlier observation.

Full playback and a melody-muted playback must retain the original event ledger.
Pause must dispose current and future sound; resume must recreate all surviving
pedal-held voices at the source position and prior pitch, then apply subsequent
bends at their exact source times. The verifier derives that position from the
actual resumed start/end arguments and the unchanged native gate endpoint. The
pause comparison allows only a small device-clock observation tolerance; exact
scheduled event/frequency comparisons do not use that tolerance. End, Stop and
navigation dispose sources; Stop returns the visible source clock to zero and
reselection requires explicit policy again. Unsupported bounds cannot allocate
or start any source. No physical audibility or original-device tuning/timbre
fidelity is claimed.

## Running and promotion boundary

The isolated `Original pitch-bend focused acceptance` workflow runs on
`preview/original-pitch-bend-acceptance` pushes or explicit dispatch. It requires
both the real hosted browser route at 720/900-pixel heights and the real Windows
route. The hosted command refuses local execution, dirty source, missing exact
SHA or an unspecified driver. The Windows route binds every report, original
fixture, source/tree and executable hash. The standalone Python manifest
re-runs the Node proof and requires the exact same finite claim set. It does not
publish a package or confer final release acceptance.

Relevant bounded local checks are the Rust fixture regeneration/raw-parser test,
Rust acceptance host tests, exact-source stdio protocol check and Node app,
evidence and workflow tests. Synthetic verifier fixtures and modeled DOM/Web
Audio are explicitly test evidence, never a substitute for actual hosted or
Windows acceptance. No browser, server or GUI is needed for those local checks.

Before a pitch-enabled source is finally promoted or a package is labeled
accepted, the final accepted-source workflow and release/package manifest must
require this pitch proof for the exact same source/tree/executable, in addition
to the existing full gates. That final-gate integration is deliberately pending;
this standalone focused workflow cannot satisfy it by itself. Existing current
acceptance and release claim sets are preserved by this slice.
