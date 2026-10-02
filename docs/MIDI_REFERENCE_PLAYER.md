# Bounded raw-MIDI reference playback

This standalone module is a playback foundation. It is not wired into the app,
notation, human input, assessment, saved assistance plans, release packaging, or
an all-track graded exercise. No MIDI source, samples, soundfonts, or third-party
sound assets are included. All procedural timbre recipes and test SMFs are
original project code.

## Trusted source boundary

`loadMidiReference({ originalBytes, expectedSourceSha256, request, crypto })`
requires complete original `Uint8Array`/`ArrayBuffer` bytes and a lowercase
SHA-256. It privately copies and hashes all bytes, then posts that copy to the
fixed `/api/midi/events` route as `application/octet-stream`. The Rust response
hash and complete ordered event identities are checked. A non-success response
never becomes a partial timeline. The caller retains the original bytes for
export/reload; JSON is output-only.

The returned object is deeply frozen and registered as an opaque in-memory
handle. `createMidiReferencePlayer` rejects serialized, cloned, reconstructed or
edited event JSON. Reloading requires the original bytes and another live Rust
parse. `request` is a trusted application transport dependency, such as the
existing native adapter, and is not a user-configurable JSON provider. This is
an application trust boundary, not proof against compromised application code,
a malicious injected transport, or a compromised engine. Hashing the source
does not independently authenticate arbitrary event JSON. JavaScript never
parses MIDI or derives the tempo clock itself.

The expected contract is the prepared Rust raw event API documented in
`RAW_MIDI_EVENTS.md` and `API.md` in the separate song API work. This component
intentionally does not modify that route or the frozen native release.

## Admission and disclosed receiver policy

Always inspect `prepared.playable`, `prepared.blockers`, `prepared.programs`,
`prepared.tracks`, and `prepared.policy` before enabling playback. Display the
policy and obtain the user's reference-rendition selection before passing its
ID to `play`. This selection is an application responsibility; a string/boolean
flag is not browser proof of user consent or an actual activation event.

Admitted source events are positive/zero-velocity NoteOn, NoteOff,
ProgramChange, Tempo, TimeSignature, raw TrackName bytes (meta 3), and EOT
(meta 47). Controllers, pressure, pitch bend, other metadata, SysEx, escape,
port/channel-prefix routing, SMPTE offsets, unavailable/ambiguous clocks, and
same-channel equal-tick events across tracks explicitly block the whole
rendition. Unsupported percussion keys block it too. Nothing is silently
filtered to produce a partial playable result. TrackName text is retained as
bytes and must be safely decoded/escaped by any future UI.

Every raw event has one immutable `acknowledgements` entry in unchanged
`tick/track/event` order. This is interpretation accounting, not evidence of
physical sound. `voices` are a separate receiver interpretation, never
rewritten MIDI events, source note durations, notation, or human targets:

- Each positive onset creates another independent voice, including duplicate
  same-channel/key onsets. A release closes the oldest held onset on that
  channel/key (FIFO). Source IDs, key, attack/release velocity, and program
  values are retained. Unmatched releases are acknowledged without a voice
- A zero-velocity NoteOn retains its original kind and acts as a release under
  this selected policy. It does not become an edited NoteOff
- Programs affect new voices only. Existing voices keep their onset program.
  A channel without a program uses the declared reference program 0
- Track EOT does not clear channel state. A held voice without a release ends
  at the global source end as explicit receiver cleanup. A zero-length gate is
  acknowledged without synthesizing a nonzero artificial duration
- No sustain, channel mode, bank selection, tuning, port, or device semantics
  are guessed. The bounded policy is not a universal MIDI receiver

Sixteen original program families group the unchanged zero-based program by
`program >> 3`, using two simple oscillators. The exposed family names describe
reference colors, not authenticated source instruments. Release velocities are
retained but do not alter this reference envelope.

Channel index 9 uses **WMH Reference Percussion v1**, an explicit table of
original tone/noise recipes for keys 27–87. Other keys block admission. Keys
85, 86, 87 are declared **WMH low wood pulse**, **WMH dry rim noise**, and **WMH
bright metal pulse**. Program 118 is retained and shown as an unknown original
kit; it does not select a guessed kit or convert drums to piano. Choosing this
mapping is choosing a reference rendition. There is no General MIDI, original
sound, optimal mapping, or physical-fidelity claim.

## Playback contract

Create a player with an injected `contextFactory`, returning `{context, output}`.
It can reuse an existing `Synth.context` and `Synth.output` after the caller's
user-gesture unlock. There is no eager context creation and this module never
connects to a microphone, input capture, hits, score completion, or assessment.
Only nodes owned by this player are canceled/disconnected; it never closes or
suspends the shared context or disconnects the supplied output.

```js
const prepared = await loadMidiReference({
  originalBytes: retainedMidiBytes,
  expectedSourceSha256: retainedSourceHash,
  request: trustedRustRequest,
});
// Show prepared.policy + programs; block when prepared.playable is false.
const player = createMidiReferencePlayer(prepared, {
  contextFactory: async () => {
    await synth.unlock(); // invoked only from the play gesture below
    return { context: synth.context, output: synth.output };
  },
  onState: state => showReferencePlaybackState(state),
});
// Inside the user-selected reference-rendition Play/Resume button handler:
await player.play({
  userGesture: true,
  acceptedPolicyId: prepared.policy.id,
});
```

Browser autoplay requirements still apply. `play` returns the current snapshot;
startup/audio/scheduling failure sets `state: 'error'` with a diagnostic. Bad
API arguments or missing gesture/policy selection throw `MidiReferenceError`.
A caller must inspect the returned state rather than assume a resolved promise
means sound began. `onState`/`onEvent` should be synchronous observers.

The exact decimal numerator is converted using BigInt quotient/remainder,
never `Number(numerator)` before division. Original rational values remain
untouched. The final audio projection is binary64 seconds, with a 50 ms lead,
150 ms horizon and 20 ms timer by default. Source events retain their order;
separate close events can lie within one physical audio sample. Web Audio and
OS/device latency are not a physical-output timing guarantee.

Each onset schedules its reference envelope and stop at the receiver gate end
on the AudioContext clock. The source release event remains separately
acknowledged. The oscillator/noise envelope is an explicit rendition property,
not a deduction of original acoustic decay. `onEvent` means an event has been
scheduled/acknowledged for the supplied generation; it does not mean it has
already sounded or been measured. The callback includes the exact source time,
source tick/track and scheduled AudioContext time. `snapshot()` exposes current
audio time, the source-zero audio anchor, clamped source position and
`waitingForLead`; key highlighting must follow elapsed audio time, not the
lookahead callback. Sources may be allocated before their future start and
remain allocated until their scheduled stop. `ended` means source time has
elapsed and the local nodes were cleaned up, not measured acoustic completion.

Pause immediately cancels all active and future sources. Resume requires
another caller-provided gesture and restarts voices held at the pause position
with fresh reference envelopes for the remaining receiver gate. This includes
percussion. Already-ended gates are not restarted. Source records stay intact;
future schedule callbacks may be reissued under a new generation. The
immutable source acknowledgement list remains one entry per raw event.

Stop cancels sources/timers and resets to zero. Generation checks make pending
factory/resume promises and old timer callbacks inert. A suspended/closed
context or late scheduling deadline stops with a diagnostic; no skipping,
voice stealing or catch-up occurs. Notes are limited to 128 simultaneous
allocated reference voices (including lookahead sources), and the supplied
smaller `maxVoices` is honored. Exhaustion cancels the whole rendition and
reports `voice_budget_exceeded`. This allocation limit can be stricter than
musical gate overlap in dense passages. Every source is canceled on failure,
including partially constructed voices. Duration is bounded to 24 hours.

Track mute is available only while stopped and for tracks whose MIDI channels
are not shared with any other track. All events/programs remain in the
accounting and mute is reported in schedule callbacks. Shared-channel mute
fails explicitly. Arbitrary seek is unsupported and reports `seek_unsupported`;
stop is the supported restart operation.

## Validation and remaining integration

Run `node --test tests/midi-reference-player.test.js`. The original fixtures
exercise complete-source hash checking, non-authoritative JSON rejection,
every-event accounting, FIFO overlap/duplicate/unmatched releases, program
changes, zero-velocity release, exact tempo fractions/large integer conversion,
11 independent tracks and a complete original 10,669-event synthetic stream,
declared drum 85–87, gesture gating, pause/resume,
canceled future voices and late callbacks, stop/reset, mute limits, voice
budget, interrupted contexts, unsupported events and malformed responses.
Tests inject a fake Rust transport and fake AudioContext/clock; they do not
claim to validate a live engine, actual browser rendering, loudness, listening
quality, or user-song playback. Hosted WebAudio and listening checks, source
API integration, UI disclosure/localization, and all-track assistance grading
remain later work.

Web Audio API scheduling, stop replacement and context resume semantics were
checked against the primary [W3C Web Audio specification](https://www.w3.org/TR/webaudio/),
particularly AudioScheduledSourceNode, AudioParam and AudioContext. Stop and
disconnect intentionally prevent future scheduled nodes from sounding after
cancellation without changing shared context state.
