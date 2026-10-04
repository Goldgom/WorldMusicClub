# Original pitch-bend focused acceptance

This is an original-source acceptance route for the bounded
[reference pitch receiver](REFERENCE_PITCH_BENDS.md). The existing three-phase
performance fixtures, report contract and claims remain intact. The final
checkpoint additionally requires this independent pitch proof before packaging.
Wiring the route is not evidence that a real browser or Windows executable has
passed it.

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
at most 34 native actions for seed and 27 for restart, leaving explicit headroom.

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

The human key pair targets the focusable stage title; the reference key pair
targets the existing policy disclosure summary inside the input-disabled panel.
The renderer checks actual focus before requesting either OS key action, and the
verifier requires one trusted down/up pair on each exact surface. Clicking the
summary closes its disclosure; a subsequent real click reopens it. The report
binds both action sequences and retains the open/closed/restored states. Later
choice, reload and unsupported-bound evidence must show the expanded policy.
This is a harness targeting correction:
the first real 720-pixel preview clicked the nonfocusable reference heading, so
its trusted pair correctly reached the body and left the human take unchanged,
but failed the asserted target identity. Those failed artifacts remain failed;
the correction adds no production focus behavior and accepts no body-targeted
pair. Only a new exact-source browser and Windows run can establish acceptance.

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

The final `windows-desktop-acceptance.yml` workflow also runs both real browser
heights and the Windows `pitch-bend` scenario as required steps. Its native
packaging step checks the pitch proof before copying the executable, matches the
source SHA/tree and exact executable hash/length, and derives the independent
focused manifest. `native-release-manifest.py create` requires `--pitch-bend`;
there is no missing-proof fallback. It independently calls
`accepted_pitch_bend_evidence`, requires the existing focused manifest to match,
and copies exactly the native report, both renderer reports, proof and focused
manifest only after every evidence gate passes.

The package inventory binds those five files and keeps pitch acceptance fields
under the `native_pitch_bend_` prefix. The focused scope's
`full_checkpoint_acceptance: false` and `release_ready: false` remain scoped to
that proof; they do not replace checkpoint acceptance fields. Package creation
and archive verification reject missing or extra pitch evidence, altered claims,
and source/tree/executable or report-hash mismatches, including alterations with
regenerated ZIP checksums. Existing acceptance gates and claim sets remain
required. Final delivery still requires the complete accepted-source workflow
summary and the separate full verification workflow; focused preview success
alone cannot satisfy those requirements.
