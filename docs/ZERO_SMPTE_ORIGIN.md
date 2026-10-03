# Zero SMPTE origins in complete clean songs

Both complete profiles retain an SMF SMPTE Offset as a named `smpte_offset`
command containing `timecode`: `frame_rate`, `hours`, `minutes`, `seconds`,
`frames`, and `fractional_frames`. These fields describe an absolute timecode
origin, not a tempo or a generic byte payload. Its original source coordinate
counts as one represented event. It remains present in the compiled runtime.

This increment admits only a single, zero-valued absolute origin on source
track zero at tick zero, before any channel message in that track. Format 0
and format 1 remain PPQ-only. A silent conductor is not discarded. All other
tracks, extents, commands and source coordinates retain their existing checks.
There is no cross-track ordering claim for other tracks' tick-zero events.

The hour octet is decoded as reserved bit, two rate-identity bits and five hour
bits. The retained rate values are `fps24`, `fps25`, `drop_frame30` and `fps30`.
Consequently an hour octet of `0x60` is a zero-hour, 30-frame non-drop origin,
not a 96-hour offset. `drop_frame30` identifies the SMF 30-frame drop-frame
code; it must not be interpreted as a 30-Hz non-drop clock. This implementation
performs no nonzero drop-frame arithmetic.

Length, reserved bit and time-field bounds are checked on original unmasked
bytes. Any nonzero hour, minute, second, frame or hundredth-frame component is
held. Duplicate equal offsets are held too; duplicate conflicting rates, late
offsets, offsets after track-zero channel commands, and offsets outside the
first track are not silently resolved. SMPTE divisions remain unsupported.
JSON reload applies the same zero-value and placement contract. The JSON
schema describes the named shape and zero fields; Rust enforces source-wide
placement and coverage.

Exact relative runtime time continues to come exclusively from PPQ ticks and
the tempo map. The zero origin requires no shift. This does not synchronize
external devices or infer original instrument behavior. Both reference
receivers explicitly recognize and validate the zero origin. Typed receiver
acknowledgements identify it as `zero_timecode_origin`. Unsupported routing,
device messages and controller semantics remain held. Canonical conversion
still requires unambiguous note pairing; typed conversion still claims no
notation or practice targets. The 16 MiB serialized-score limit is unchanged.

## References and evidence

- MIDI Association: [Standard MIDI Files specification](https://midi.org/standard-midi-files-specification), RP-001 v1.0, SMF meta event `FF 54`
- MIDI Association clarification: [SMPTE Offset Meta Event](https://midi.org/community/midi-specifications/smpte-offset-meta-event-smf), administrator reply describing the reserved bit, rate bits and hour count
- [The Complete MIDI 1.0 Detailed Specification](https://people.carleton.edu/~jellinge/cs312_w2020/pdf/_complete_midiSpec1_0.pdf), official MMA document mirrored by Carleton, MIDI Time Code and Standard MIDI Files sections

Tests use newly authored events. They check all four identities in both SMF
formats, every event coordinate, exact rational clocks, source-free round
trips, reload tampering, strict note ambiguity and receiver/schema guards.
Private source inventories belong outside this repository. Passing tests or
structural conversion alone does not establish browser/native acceptance,
reference-renderer eligibility, physical sound or a proven practice target.
