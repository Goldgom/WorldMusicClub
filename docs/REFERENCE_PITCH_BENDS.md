# Bounded reference pitch bend

The event-only `wmh-performance-midi1-v1` profile preserves each original
`pitch_bend { channel, value }` command. `value` is an unsigned integer in
0–16383. Original event IDs, coordinates, rational beats and compiled native
microseconds remain unchanged, including repeated values and center commands.
Every channel containing a bend must have one owning source track. Existing
single/default logical-device resolution is required for reference listening.

This does not extend either strict notation importer. Even center-only bend
files remain held there. Event-only songs retain `notation: null`, no targets,
no fingering or scoring claims, and no receiver-derived note durations.

## Meaning and declared interpretation

The MIDI Association's [message summary](https://midi.org/summary-of-midi-1-0-messages)
defines the fourteen-bit value, LSB first, center 0x2000, and receiver-dependent
sensitivity. Its [message explanation](https://midi.org/about-midi-part-3midi-messages)
describes pitch bend as changing sounds already playing on the channel.
The [RPN table](https://midi.org/midi-1-0-control-change-messages) defines RPN 0's
semitone/cents components and null parameter selection. The official AMEI
[RP-015](https://amei.or.jp/midistandardcommittee/Recommended_Practice/e/rp15.pdf)
distinguishes reset of bend/selectors from the stored parameter values, which
remain unchanged. These primary references
were checked on 2026-10-03; they do not identify a source device's prior setup.

The explicitly selected `wmh-original-reference-fifo-pitch-v3` receiver uses:

- `value = LSB + 128 * MSB`, center 8192
- `displacement = (value - 8192) / 8192`
- `semitones = displacement * (range_semitones + range_cents / 100)`
- oscillator frequency `440 * 2^((original_key + semitones - 69) / 12)`, with
  each procedural harmonic retaining its declared frequency ratio

The uniform denominator is a declared receiver interpretation: value 0 reaches
the negative range, center gives exactly zero, and 16383 is one step below the
positive range. No positive-side renormalization or seven-bit truncation occurs.
Each command sets frequency at its exact native-derived playback time. There is
no invented interpolation between source events and no curve point is removed.
The original key in the event and receiver voice remains an integer and is never
replaced by a guessed keyboard note.

The reference receiver chooses an initial two-semitone, zero-cent range. This is
an explicit listening policy, not evidence that the original instrument used it.
Only the existing [proved initial twelve-semitone setup](INITIAL_MIDI_SENSITIVITY.md)
changes this range. All its selector and duplicate data writes remain separate
events. No new RPN ordering is added. Typed conversion still rejects CC6=24 and
the strict profile's separate six-step24 command; there is no fallback to two or
twelve when a source declares24. Other parameters, later/repeated setup groups,
NRPN, increment/decrement and unreviewed controllers remain held.

## Channel state, transport and sound bounds

`ReferencePitchChannels` keeps displacement, selected parameter and stored range
separate. It is shared by preparation and transport reconstruction; the existing
source/JSON grammars still determine which commands may reach it. Initial reset
centers displacement and nulls RPN selection while leaving the stored parameter
value intact. It does not delete held keys or reset program, bank, volume, pan or
reverb. The current profile only admits reset at zero before any key activity,
with the existing explicit sustain-zero successor. Reset with sensitivity setup
and all active/late resets remain held. Thus no active-key reset behavior is newly
claimed by this slice.

Pitch changes affect both still-key-held and pedal-held oscillators, including
all FIFO layers on the channel. Volume/expression/pan/reverb retain the existing
controlled reference policy and explicit defaults. Pause, Stop, end and failure
dispose every source and effect node. Resume rebuilds only commands strictly
before the resume position, restarts surviving FIFO/pedal gates at that pitch,
then applies events at the position in source order. Previously scheduled future
bends cannot leak through a pause. Stop clears channel state and returns to zero.
Arbitrary seek remains unsupported; a rejected seek does not alter transport.
Muting affects allocation only and retains the entire event/control ledger.

All bends on percussion channel index9, including center values, block the
receiver. No drum tuning is inferred. Every melodic oscillator must fit
20–18000 Hz throughout the entire declared range for its bend channel; this
conservative bound can hold a source even if its actual values use less range.
Non-bend channels are checked at their unchanged pitch. At audio allocation and
retuning, frequencies must also fit 45% of the actual device sample rate.
Unsupported ranges fail explicitly; this policy never clamps oscillator or
percussion-filter frequencies. Other bank/device/port/prefix/SysEx, chorus and
pressure restrictions remain intact. Typed retention alone is not playable sound.

The English/Chinese saved-song panel discloses the declared range, source timing,
unavailable notation, lack of original tuning/timbre/voice fidelity and no claim
of complete playability before policy acceptance.

## Verification and limits

Authored C/E/G synthetic tests cover every bend bit at the endpoints and center,
fractional clocks, duplicate commands, independent channels, all proved12 setup
forms, active/pedal-held layers, pause with already-scheduled future bends,
resume, Stop, seek rejection, mute ledgers, reset selector/value separation and
unsupported policies/ranges. Rust independently compares retained values,
coordinates and exact runtime clocks to the raw parser and tests clean reload.
Strict/legacy receivers keep their prior behavior.

These are source, unit, mocked-WebAudio and DOM checks. They do not establish
physical audibility, browser/native package acceptance or archive coverage gains.
Private source audits and any subsequent acceptance remain separate; private
music, titles and source bytes are never public fixtures.
