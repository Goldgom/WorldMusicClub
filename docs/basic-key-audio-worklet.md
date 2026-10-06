# Basic-key audio-thread receiver

The standalone receiver executes an already admitted Rust basic-key rendition
on the audio render sample clock. `BasicKeyAudioReceiver` does not interpret
MIDI, grade user input, own the UI transport, or change the existing rendition
policy. The integration chooses when this capability becomes available.

## Files and start handshake

- `web/basic-key-audio-plan.js`: exact rational gate-to-sample conversion,
  immutable plan construction/validation and bounded transferable buffers
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

The host builds and sorts a complete bounded plan, then transfers ownership of
typed buffers to the worklet. The message handler attaches constant-size views;
it does not parse JSON, sort notes, or allocate note-sized buffers. `process()`
initializes and validates fixed chunks, with at most 1024 rows per render
quantum. A fixed 128-entry end heap verifies overlap; a host-sorted coordinate
permutation is checked incrementally for complete, unique source identities.
The chunk size scales with sample rate and block size. With 128-frame blocks,
the maximum 65,536-note plan takes about one second of rendered time at normal
rates and about 2.05 seconds at 8 kHz, within the five-second lifecycle bound.

Preparation selects the remaining gates for a resume/seek and returns `ready`
only after all rows pass. The connected node runs behind one output gain held
at zero throughout preparation; its process output is also zero. Cancellation
discards partial validation and cannot produce a stale ready or attack.
`start` is a small generation/anchor command. Its anchor
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

Module loading and prepare, snapshot and audit acknowledgments have a
five-second lifecycle deadline. A start acknowledgment has a deadline at its existing audio anchor,
with no extended lookahead. A missing acknowledgment rejects with
`audio_command_timeout`, disconnects output, cancels the generation and clears
all pending deadlines. Receipt, cancellation and disposal clear the applicable
timers. These timers never trigger or schedule notes. A failed cancellation
post closes the disconnected receiver without masking the original device,
processor, or timeout error. Late success replies cannot resume playback.

## Bounds and sound

The plan contains at most 65,536 notes. Host canonical JSON validation retains
its 16 MiB bound; production transfer buffers independently fit within 16 MiB
(68 bytes per note, including scratch and ledger storage). These are explicit
admission limits, not a bound claimed for JavaScript heap overhead. The
processor owns exactly 128 reusable voice slots. It
preflights simultaneous sample-frame gates, releasing ends before attacks at
the same frame. A 129th overlapping gate fails before playback. Repeated MIDI
keys use independent slots; no voice stealing or silent dropping occurs.

The public immutable plan rows contain `noteId, eventId, startFrame, endFrame,
key, velocity, role`. Production transfers store source track/event coordinates
and numeric columns in typed buffers; stable IDs are reconstructed exactly for
bounded audit pages. The plan also retains the exact source SHA-256 and rendition policy ID.
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
deterministic xorshift noise sequence, generated per voice with a half-second
state reset and filtered by
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

The first terminal `ended` or `canceled` reply for a validated generation
transfers ownership of its existing bounded `ledger` buffers with
`Float64Array actualStarts` and `actualEnds`, indexed by the immutable plan rows.
There is no terminal note-sized allocation or copy. The adapter retains one
`lastCompletion` and serves bounded post-completion audit pages from that
authentic transferred ledger. A later cancel after ended has `ledger:null`;
the prior record is retained, not synthesized again. Cancellation before
validation completes also has no ledger and cannot have played an attack.
Records carry `sourceSha256`,
`planGeneration`, `anchorFrame`, `positionFrame`, `sampleRate`, `started`,
`ended`, `skipped`, and `active`. A canceled record's `generation` is the newer
cancellation token; `planGeneration` identifies the playback being canceled.
`onStopped` can report that record even after a newer generation has fenced
transport callbacks; it must be treated as completion evidence, never as
permission to alter a new transport. No per-attack messages are posted.

`dispose()` immediately zeros the output gate, rejects pending commands and
fences the generation. It retains the muted graph until its matching canceled
acknowledgment, then physically disconnects and closes the port. This avoids
mutating the browser graph while this processor is still running. Repeated
dispose calls and late transport replies cannot reopen the gate. Missing
acknowledgments or malformed lifecycle metadata and ledger shape cannot report
successful cancellation; an already failed/closed device or the one-second
cleanup deadline still forces bounded
disconnection. This cleanup timer does not schedule audio, and fallback cleanup
is not a verified completion ledger. Canonical and VSQ receivers inherit this
disposal sequence; ordinary stop/error cancellation retains immediate detach.
ACK admission examines a bounded set of fields and typed-array lengths, without
rescanning the score. Exact ledger gate values remain checked by the independent
proof validator. An earlier genuine stop ledger remains retained even when a
later disposal generation has already fenced transport callbacks.

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

## VSQ instrumental plan extension

`buildVsqAudioPlan` in `web/vsq-audio-plan.js` admits the already-selected
`wmh-vsq-base-note-practice-v1` native runtime. The same processor, receiver,
gate scheduler, generation fences, anchor handshake, terminal ledger and audit
methods handle it. Its policy is `wmh-vsq-base-note-reference-v1` and its explicit
`identityKind` is `vsq-authored-note`. Basic MIDI plans retain strict MIDI
source-coordinate validation; a VSQ identity never passes that branch.

VSQ rows retain `vsq-t{source_track_index}-ID#{digits}` and source-bound
`vsq:{sha256}:t{source_track_index}:ID#{digits}`. The transfer uses separate
`sourceTracks` (Uint16), `authoredIds` (Uint32) and `authoredIdDigits` (Uint8)
columns. Four- and eight-digit authored IDs remain distinct and reconstruct
exactly, including leading zeroes. Equal-onset playback order remains native
EventList order; the separate sorted identity permutation only detects duplicates.
Audits and completion records expose the policy and identity kind.

Native `start_microseconds`, `end_microseconds`, and the native project
`end_microseconds` alone determine sample boundaries, with the existing exact
floor/ceil conversion. The builder verifies native millisecond projections by
the same quotient/remainder conversion as Rust. No notation recompilation,
source-byte rewrite, inferred tempo, or substitute scoring target is involved.
Mix filters exclude only explicit muted/unsoloed parts and the selected human
part in practice. Full Listen retains the source-muted authored notes, as before.
`sourceNotes` and the full project end survive mix filtering, including a fully
silent selected mix. Source vocal Dynamics remain descriptors; velocity stays 90.

Roles 2 and 3 retain the existing VSQ piano/guitar instrumental recipes:
0.8 triangle fundamental plus 0.2 sine at twice/three times the key frequency,
with the existing 0.08 × velocity/127 level and gate attack/release envelope.
The host builds 128 band-limited triangle tables of 1,024 float samples each,
using only odd harmonics below Nyquist and below the table's 512-bin limit.
The audio core linearly interpolates that fixed table and evaluates one sine;
there are no per-sample harmonic loops, new timbre choices, samples, or vocals.
High partials above these limits are omitted. This bounded procedural waveform
is not a bit-for-bit reproduction of browser OscillatorNode implementations.
The selected fundamental and explicit sine harmonic must fit below 0.45 times
the device sample rate. Unlike the old receiver's silent frequency clamp, an
unsupported device/recipe returns `unsupported_audio_sample_rate` before start.

VSQ has the same 65,536-note, 16 MiB JSON/wire and 128 simultaneous sample-gate
bounds. Transfer columns use 59 bytes per note plus a fixed 512 KiB waveform
buffer (under 4.2 MiB at the note bound). These are serialized/buffer limits,
not a JavaScript heap-overhead promise. Waveform validation shares the existing
1,024-item maximum per quantum; worst-case preparation is about two seconds
at normal rates, or 4.2 seconds at 8 kHz, within the five-second lifecycle bound.
There is no additional main-thread note lookahead or second scheduler. The old
100 ms window's future-node allocation count is replaced by actual simultaneous
sample-gate admission, since future notes no longer allocate AudioNodes.

`tests/vsq-audio-worklet.test.js` uses only the existing original synthetic VSQ
fixture and generated gates. It proves native rational/sample traceability,
identity width, mix/source/end counts, held/expired resume gates, negative
count-in, recipes, corrupt transfer rejection and the complete bounds. Actual
VSQ browser/native package and private-corpus acceptance remain separate gates.

`VsqPracticePlayer` now specializes only plan construction and inherits the
existing `BasicKeyPlayer` preparation/cancellation lifecycle. The application
prepares a negative count-in source position before start, then uses the
accepted quantized source position and audio anchor for both its transport and
practice recorder; it does not subtract count-in twice or repeat it on resume.
Natural completion waits for the audio core's terminal state. Missing worklet
support blocks sound explicitly while preserving optional silent practice.
The VSQ consumer tests render the production core behind a simulated port and
cover delayed ACKs, interruptions during preparation, device state, count-in,
real human input isolation, full end/restart and source-byte preservation.
