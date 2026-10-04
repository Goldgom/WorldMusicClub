# Basic-key audio-thread receiver

The standalone receiver executes an already admitted Rust basic-key rendition
on the audio render sample clock. `BasicKeyAudioReceiver` does not interpret
MIDI, grade user input, own the UI transport, or change the existing rendition
policy. The integration chooses when this capability becomes available.

## Files and start handshake

- `web/basic-key-audio-plan.js`: exact rational gate-to-sample conversion,
  immutable plan construction/validation and bounded wire encoding
- `web/basic-key-audio-core.js`: the production renderer and message protocol
- `web/basic-key-audio-processor.js`: the actual AudioWorklet wrapper; it passes
  the AudioWorkletGlobalScope sample rate and `currentFrame` to that core
- `web/basic-key-audio-receiver.js`: asynchronous main-thread adapter

```js
const plan = buildBasicKeyAudioPlan(song, {
  sampleRate: context.sampleRate, mode, targetPart, mutedParts, soloParts,
});
const receiver = await BasicKeyAudioReceiver.create(context, output, {
  onError, onStarted, onEnded, onStopped,
});
await receiver.prepare(plan, {positionMs});
const started = await receiver.start({anchorTime: context.currentTime + .05});
```

Preparation installs and validates the complete bounded plan on the worklet,
selects the remaining gates for a resume/seek, and returns `ready`. No audio is
emitted by a ready plan. `start` is a small generation/anchor command. Its anchor
is `ceil(anchorTime * sampleRate)`, must be in the future, and may be no more
than the existing 100 ms policy lead away when received. No note is scheduled
by main-thread timers after this command.

The promise resolves on the processor's `started` acknowledgment, only if the
main thread receives it before the anchor. A late command or acknowledgment is
an explicit `clean_late_start` error with cancellation, never a shifted anchor,
catch-up, or dropped attack. A caller must also fence its own pending async
workflow against selection, stop, navigation, or seek before starting its
transport and recorder. The shared origin is the returned `anchorFrame` /
`sampleRate`, and the source position is `positionFrame` /
`sampleRate`. `positionMs` in the acknowledgment is exactly the quantized frame
position converted back to milliseconds. Count-in positions down to negative
ten minutes are supported. Human MIDI/audio input remains outside this receiver.

## Bounds and sound

The plan contains at most 65,536 notes and at most 16 MiB of ASCII JSON wire
data. These are explicit admission limits, not a bound claimed for JavaScript
heap overhead. The processor owns exactly 128 reusable voice slots. It
preflights simultaneous sample-frame gates, releasing ends before attacks at
the same frame. A 129th overlapping gate fails before playback. Repeated MIDI
keys use independent slots; no voice stealing or silent dropping occurs.

Compact rows contain `noteId, eventId, startFrame, endFrame, key, velocity,
role`. The plan also retains the exact source SHA-256 and rendition policy ID.
Original source events, rational gates and provenance stay in the caller's
admitted song. The builder joins native gates by stable ID and applies
mute/solo/practice selection only after the native FIFO interpretation.

Exact rational attacks are floored to a frame and exact gate ends are ceiled.
Each boundary differs from the native time by less than one sample. Every
positive gate therefore receives at least one sample, even when shorter than
one sample. Sample-lattice overlap is separately checked against 128 voices;
rounding is never hidden by dropping a voice. A source-level exact overlap
budget and the prior 100 ms allocation budget remain unchanged evidence.

Melodic output is one sine at the nominal key frequency, with the existing
velocity gain and bounded attack/release envelope. Percussion is the existing
deterministic xorshift noise sequence, looped at half a second and filtered by
a 1500 Hz, Q=.7 bandpass with its dry-pulse envelope. The sample is evaluated at
the midpoint of each gate sample so one-sample attacks are represented.
This is the disclosed basic sound, not a bit-for-bit Web Audio oscillator or
filter equivalence claim. There are no samples, original timbre claims, pitch
clamps, new dependencies, SharedArrayBuffers, or security-header changes.

## Cancellation and evidence

`stop`, `pause`, `reset`, and `seek(positionMs)` immediately disconnect output,
reject pending promises and advance the monotonically increasing generation.
They send cancellation to the audio thread. `seek` records the position and
never resumes; a fresh explicit prepare/start is required. Generations cannot
wrap past 2,147,483,647; create a fresh receiver if this limit is reached.
Old success messages cannot restart transport. A suspended, interrupted, or
closed context cancels playback and requires explicit preparation after the
device resumes. A processor error requires a newly created receiver.

Natural end zeroes output at the planned source end and reports `ended`.
`snapshot()` returns counters. `audit({offset, count})` returns at most 256 rows
with original note/event IDs, planned frame bounds, and actual start/end frames.
Skipped already-ended resume gates have actual frames `-1`. These methods do
not drive rendering.

`ended` and `canceled` replies contain one bounded `ledger` with
`Float64Array actualStarts` and `actualEnds`, indexed by the immutable plan rows.
The adapter retains one `lastCompletion`. Records carry `sourceSha256`,
`planGeneration`, `anchorFrame`, `positionFrame`, `sampleRate`, `started`,
`ended`, `skipped`, and `active`. A canceled record's `generation` is the newer
cancellation token; `planGeneration` identifies the playback being canceled.
`onStopped` can report that record even after a newer generation has fenced
transport callbacks; it must be treated as completion evidence, never as
permission to alter a new transport. No per-attack messages are posted.

`dispose()` disconnects immediately and leaves the port alive long enough for
the cancellation ledger. It closes on that acknowledgment, on an already
failed/closed device, or after a one-second cleanup grace period. This cleanup
timer does not schedule any audio. An acknowledgment lost to a closed/failed
audio device is not a verified completion ledger.

## Verification scope

Run `node --test tests/basic-key-audio-worklet.test.js`. Tests drive the actual
exported renderer block by block, execute the production wrapper in a VM with
an emulated AudioWorkletGlobalScope, and use a real-core MessagePort harness.
They include all 6,144 attacks and gates in the original CC0 dense fixture,
independent repeated keys, sub-sample gates, cancellation, resume, variable
render-block sizes, late commands and device-state transitions.

These are pure/VM tests. Actual browser AudioWorklet loading, native WebView2
custom-origin module loading, device behavior, audio graph output, performance,
and coexistence with low-latency human input still require real acceptance.
Unsupported platforms return `audio_worklet_unavailable`; they do not silently
fall back to the main-thread timer scheduler.

The implementation follows the render-thread and sample-clock model described
by the [Web Audio specification](https://www.w3.org/TR/webaudio/) and
[MDN AudioWorklet guide](https://developer.mozilla.org/en-US/docs/Web/API/Web_Audio_API/Using_AudioWorklet).
