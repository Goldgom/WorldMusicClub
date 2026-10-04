# Complete performance profile

This additive profile now has a bounded native-package and saved-song listening
consumer. The existing wmh-semantic-midi1-v1 profile remains independent and
unchanged. `score_core::clean_performance` provides conversion, validation and
runtime compilation; the web receiver accepts clean bytes plus a trusted native
compiler response bound to their SHA-256. See CLEAN_PERFORMANCE_NATIVE_BRIDGE.md
for dispatch, null notation, package binding and remaining acceptance limits.

The outer clean package stays metadata.json, score.json and optional declared
media. Original MIDI, archive, encoded original, raw bytes, generic event dump,
runtime report and receiver-derived note pairs are forbidden. Source descriptors
are byte count and SHA evidence only, not license grants or original contents.

The score envelope is worldmusichub-complete-score version 2, with root id/title,
source, nullable notation, performance and coverage. The typed profile is
wmh-performance-midi1-v1. Consumers must discriminate both version and profile;
existing version 1 validation must never admit version 2 silently.

The first slice accepts null notation only, with separately calculated complete
performance data and unavailable notation/targets covering zero attacks. This
does not assert that no notes could be proved later. A future partial target
view must bind canonical notes to uniquely proved attack/release evidence while
retaining all eleven performance tracks in this same song, never a subset song.

Tracks include silent conductors, stable ID, original index/count and end beat.
Parts preserve track/channel routes, not inferred instruments, staffs or voices.
Independent key_attack/key_release commands preserve key, velocity, source
coordinate and exact quarter-note beat. Event IDs combine hash, track and index.
Zero-velocity note-on becomes a semantically equivalent release with velocity
zero. No original wire representation, guessed pairing or duration is stored.

The closed vocabulary includes named program/bank components, volume, pan,
expression, sustain, constrained initial controller reset, reverb/chorus send,
key/channel pressure, exact tempo, meter including
metronome grouping, key signature, sequence number, plain textual cues and final
track end. It also retains original14-bit `pitch_bend` commands on track-local
channels under the separate [bounded reference policy](REFERENCE_PITCH_BENDS.md).
Unknown controllers, unresolved routing, device/system messages, encoded
project blocks and undecodable text hold the entire conversion. No arbitrary
bytes, source ranges or hidden payload case is allowed. Simultaneous cross-track
channel commands remain held pending a reviewed commutativity rule.

Validation checks schema closure, bounds, every original source coordinate,
per-track and overall ordering, final EOT, all parts, exact clock integration and
calculated coverage. External source hashes are claims; conversion verifies the
original bytes privately. compile_performance accepts authoritative clean JSON
bytes and returns a hash-bound derived runtime with exact rational microseconds.

Renderer preparation explicitly selects wmh-original-reference-fifo-v1. Every
attack creates a layer; a release closes the oldest held layer on channel/key;
unmatched releases are acknowledged; held layers stop at global end. These are
receiver gates, never recovered source durations. Existing procedural program
families and WMH Reference Percussion v1 provide explicit mappings, including
85/86/87 substitutes. Source programs/keys remain intact; original kit/timbre is
unverified. The user must select the reference rendition explicitly.

A preserved command the receiver cannot apply blocks this renderer while
leaving the semantic package complete. Track muting gates allocated voices and
does not remove source events or shared state; shared-channel track mutes remain
unsupported. Tests must compare production ReferenceAudioReceiver scheduling,
fake source start/stop/cleanup, all event identities/times and every track mute.
Also cover pause/resume, cancellation, late scheduling and allocation failures.

The native consumer dispatcher matches `format` =
`worldmusichub-complete-score`, `version` = 2 and `performance.profile` =
`wmh-performance-midi1-v1`, then calls `decode_json` / `compile_performance`.
It never sends this envelope to the version-1 notation compiler, manufactures an
empty canonical score or uses reference gates for practice targets. The shared
metadata-v2 package path verifies source descriptor, root identity/title, exact
score-byte hash, assets, reimport and export. The native canonical payload is
explicitly null when notation is unavailable.

All tracks, including silent conductors, remain part of the single performance.
Muting is a receiver choice and never rewrites the package or drops events.
The reference policy must be accepted before playback. Unsupported receiver
commands must be reported as blockers; their presence cannot be advertised as
successful listening merely because typed conversion succeeded.

No fake-audio result proves physical sound, original fidelity, notation, grading,
or browser/native GUI acceptance. The bounded native and lobby integration
preserves null notation and requires an explicit supported reference receiver.
Only authored fixtures go into CI; provided music and conversion proof stay
private. The canonical piano/guitar practice stage is outside this null-notation
slice.

## Controlled reference extension

The additive controller slice preserves `sustain { channel, value }` for all
seven-bit CC64 values. It preserves an exact `initial_controller_reset { channel }`
for CC121 value zero only when the reset is at beat zero, no attack, release or
key-pressure event has preceded it on that channel, the entire channel belongs
to one source track, and the next channel event is same-track sustain value zero
at beat zero. Other-channel events and nonchannel metadata can intervene.
Repeated valid setup groups are allowed; resets after even a same-tick attack,
late resets, nonzero reset values and incomplete/interleaved groups remain held.
The field vocabulary is closed and authoritative JSON reload repeats the guard.

These commands never pair source notes. Every original key release keeps its
own ID, velocity and exact time. The explicitly selected
`wmh-original-reference-fifo-controls-v2` receiver interprets sustain values
64–127 as down and 0–63 as up. FIFO releases consume only still-key-held layers;
pedal-held layers continue until pedal-up or global end. Repeated attacks while
the pedal is down allocate new layers; unmatched releases remain acknowledged.
No receiver gate is serialized into score.json or passed to notation or grading.

This policy applies whenever the source includes one of the extended controls.
Control-free performances retain the existing v1 reference policy and sound.
The controlled policy uses channel-shared state, including across source tracks:

- Volume and expression multiply linearly as `(volume/127)*(expression/127)`,
  with declared reference defaults 100 and 127. They affect existing layers
  and future attacks, including layers held only by the sustain pedal.
- Pan uses StereoPanner's equal-power behavior; 0, 64 and 127 map exactly to
  -1, 0 and +1, with linear interpolation on each side of the center.
- Reverb send uses the existing original deterministic WMH Reference Room v1.
  This is a bounded procedural effect, not evidence of the original device.
  Its output has a scheduled downstream gate at the exact global end so tails
  stop even if the disposal poll runs late. Pause/Stop disconnect every tail.
- A valid initial reset restores expression 127 and sustain off. Program, bank,
  volume, pan and reverb remain. The required explicit sustain-zero event is
  still independently represented and acknowledged.
  The pitch state is centered and RPN selection becomes null, without changing
  stored parameter values; reset plus sensitivity setup remains unsupported.
- Both bank components must remain zero for this receiver. Program selects the
  existing procedural family only for new melodic voices. Any nonzero bank or
  chorus send, pressure, or unmapped percussion key blocks the entire renderer.
  Chorus zero explicitly selects no chorus. None of these rules identifies an
  original General MIDI bank, soundfont or drum kit.

The mixer schedules AudioParam changes at the same source-derived audio times as
the event acknowledgements. Muting suppresses voice allocation without removing
any channel control. Shared-channel track mute remains unavailable. Pause
cancels all scheduled sound and effect nodes; resume replays prior channel state
and restarts remaining FIFO/pedal-held gates, then processes events at and after
the resume position in their original order. A missed deadline or allocation
failure stops the whole rendition. The voice budget is still global across all
channels, including sustained layers.

The MIDI Association's [control-change table](https://midi.org/midi-1-0-control-change-messages)
names the CC7/10/11/64 controls and CC64 threshold. The gain law, reference room,
initial levels, envelopes and FIFO receiver policy above are explicit WorldMusicHub
rendition choices. General CC121 behavior remains out of scope; the Association's
[Reset All Controllers addendum](https://midi.org/response-to-reset-all-controllers)
is the required starting point for reviewing that future expansion.
