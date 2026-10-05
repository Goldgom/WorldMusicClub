# Persistent live input audio

`LiveToneReceiver` is separate from the immutable complete-song source plan. Its
IDs are live input/click IDs, never source note coordinates, recorder events or
scoring writes. The source renderer's frame discontinuity gate is unchanged.

## Lifetime and API

`await LiveToneReceiver.create(context, output, {onError, onEvent})` requires a
running AudioContext and AudioWorklet support. It loads
`live-tone-audio-processor.js`, creates one mono `wmh-live-tone-v1` node and one
output gain, connects both once, transfers the prepared triangle bank, waits for
a matching ready receipt, then opens the gain. There is no unsupported-browser
fallback. Module loading and acknowledgement deadlines are five seconds.

The synchronous methods are `play(id, midi, duration = null, delay = 0,
timbre = 'piano', velocity = 90)`, `release(id)`, `stop(id)`,
`click(id, accent = false, delay = 0, level = .25)`, `silenceClicks()` and
`silence()`. Times are milliseconds. `play`/`click` return a unique voice token,
or null for zero velocity/level. Every sound/control operation uses a message;
none allocates or connects/disconnects a Web Audio node. `snapshot()` returns a
Promise for a bounded processor observation. `dispose()` cancels ownership and
is the only post-creation graph teardown.

A context interruption immediately closes the existing gain, advances generation,
cancels old commands and voices, and enters `interrupted`. Merely returning the
context to `running` cannot restart sound. An explicit `await resume()` requires
a running context and a matching processor acknowledgement before it opens the
same gain/node. Processor errors and command/protocol failures are terminal.

## Sound and bounds

Piano is sine; guitar uses an original 128-key, 1024-sample periodic triangle bank
built on the host before readiness. Fourier odd partials are bounded by Nyquist
and table resolution. No waveform/phase identity with native OscillatorNode is
claimed. MIDI keys are integers 0–127 and must be below the device Nyquist limit.
Peak gain is `.28 * (velocity / 127) ** 1.5`: 8 ms linear attack, exponential
decay ending at 180 ms at 40% peak (floor .0001), and a separate 12 ms human
release multiplier. Scheduled notes last at least 20 ms, followed by a 150 ms
exponential target tail with a 20 ms time constant. Future canceled onsets stay
silent. Zero velocity releases/retriggers without creating a new voice.

There are 64 preallocated note slots including human release tails. The oldest
release tail is stolen first, otherwise the oldest held token. Eight independent
click slots use 1046/1568 Hz sine, 2 ms attack, 35 ms decay and 45 ms total duration.
IDs are nonempty bounded strings of at most 256 characters. Delays are 0–600,000
ms and explicit durations are 0–3,600,000 ms. Receiver bookkeeping is bounded by
128 outstanding commands, 64 current note IDs, eight click IDs, and 256 receipts
and recent lifecycle tokens. The DSP keeps the same fixed voice/receipt bounds.

## Observations and clock

The processor receives only browser `currentFrame` and `sampleRate`. Live onset
requests that arrive after their requested frame begin at the actual available
render frame; both requested and actual frames are disclosed. No substitute
source clock is created. An active render gap, repetition or backward block
cancels the live renderer without catching up; it never changes the companion
complete-song renderer's policy. Idle rendering remains connected and silent.

`onEvent` receives `started` and `ended` records with `source: 'live-tone'`,
`generation`, unique `token`, `kind` (`note`/`click`), `id`, `midi`, `key`,
`sampleRate`, `frame`, `requestedStartFrame`, `actualStartFrame`, `actualEndFrame`,
`pcmPeak`, `pcmEnergy`, `nonzeroSamples`, `renderedSamples`,
`firstNonzeroFrame`, `lastRenderedFrame`, and `reason`. Canceled future notes have
null actual start and zero PCM. Start receipts precede their first sample and
therefore have zero PCM. End receipts include measured per-voice float samples.
Snapshot active rows report the same accumulated PCM while a key remains held;
its last 256 receipts and at most 72 active rows are complete within those bounds.
These are internal pre-mix PCM observations, not proof of physical speaker output.

The original DSP, production processor shell and receiver adapter have focused
coverage in `node --test tests/live-tone-audio.test.js`. Native browser/source
coexistence and complete application/package acceptance remain separate gates.
