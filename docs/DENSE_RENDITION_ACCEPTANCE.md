# Continuous audio during dense native page rendering

This acceptance case is original arithmetic test data released under CC0-1.0.
It contains no private music or borrowed composition. The generator is
`scripts/prepare-dense-rendition-fixture.mjs`; its 49,380-byte MIDI SHA-256 is
`1732e837773757a00212a03374e9111a4e0f4662d920f45461ffb64f46247ba7`.

The MIDI is format 1, PPQ 96, with five tracks. Track 1 contains tempo 120 BPM,
4/4 meter, C-major key, then End of Track at tick 9,216. Each musical track
(2–5) begins with its track name as event 1 and program 0 as event 2. Its
1,536 on/off pairs begin at events 3/4. Attack `i` has absolute tick `6*i`,
and its release is three ticks later. Each track ends at tick 9,216.
The stable one-based source contract therefore gives attack IDs
`midi-t{2..5}-e{3+2*i}`. Expected IDs come from this generation sequence,
not from substituting values returned by native conversion. The independent
Node test decodes every generated event and checks all 6,144 expected attacks.
The four velocities are 72, 76, 80 and 84; pitches repeat an eight-key arithmetic
pattern with a distinct base per part. All 12,304 events are retained.

There are 24 bars, 48 seconds, and three actual native eight-bar pages. Each
page has 512 attacks per part, or exactly the existing 2,048-target All budget.
The original gates last 15.625 ms and recur every 31.25 ms. Independent interval
counting includes the existing 100 ms allocation lookahead: at most 16 voices
are allocated or active, below the unchanged 128 limit.

CI prepares the original MIDI through the actual Rust draft/pack/import/load
APIs, then checks all twelve native part/page responses. It stores the original
MIDI, complete clean ZIP, response files and SHA-256 inventory as CI artifacts.
No megabyte response fixture is committed to Git. A local socket-free preparation
with the immutable 0125bb3 driver verified all source IDs, key/velocity pairs,
gates, page clocks and the 48-second duration; that preparation is not graphical
or continuous-audio acceptance.

The hosted runner uses a fresh Chinese 1280×720 browser profile and the workflow's
exact-source native stdio driver. It opens the score while paused, loads the first
actual staff page, chooses Listen, All and Follow through visible controls, and
then plays through both real page boundaries to natural End. It requires every
native source ID to own an actual scheduled Web Audio voice, every page's 2,048
IDs to own mounted notation, zero audio errors or unexpected pauses, a running
monotonic AudioContext clock, exact native gates, complete final node cleanup,
and an empty Listen result with no captures or assessments. Input actions stay
within 64. It does not infer physical audibility from scheduling.

Read-only observers forward original calls, receivers, arguments, returns and
errors, and restore their hooks. They record actual synchronous OSMD load,
updateGraphic and render spans; load Promise completion; pump intervals and
execution spans; AudioContext times/states; the original event ID and lateSeconds
when supplied by an error; scheduled start/end times; native batch request and
admission time; and available browser long-task entries. Elapsed stream time runs from the first
running pump to the first observed natural End. Observer overhead is
included in these elapsed times. Disconnected audio nodes release their observer
references immediately. A 200 ms rendering call remains 200 ms in the report.
No lookahead, clock, deadline, gate, source, mix or grading behavior is changed;
there is no deliberate busy wait or artificial sleep to manufacture a stall.

The focused basic-key and full Windows acceptance workflows run this hosted
step whenever their driver and browser prerequisites succeed, even if a sibling
UI check failed. Failure still fails the browser job. The existing independent
Windows job and same-source overall acceptance summary remain mandatory.
Native packages retain their native-only candidate scope. The separate
`dense-rendition-browser-<SHA>` artifact contains only original source/evidence,
including failure metrics and PNGs. Real hosted execution and image review are
required before claiming this scheduling boundary passed.
