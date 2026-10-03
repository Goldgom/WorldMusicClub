# Ordered initial MIDI tempos

The strict MIDI importer and complete-score JSON validator support differing
`FF 51` declarations at source tick zero when every such declaration belongs to
one source track. They preserve stored event order. Canonical notation displays
one effective initial tempo: the final declaration governs every following
positive-time interval until the next tempo change.

## Source semantics

The MIDI Association's [SMF specification index](https://midi.org/standard-midi-files-specification)
identifies RP-001 v1.0. The MMA-authored *Standard MIDI Files 1.0*, within the
[Complete MIDI 1.0 Detailed Specification, version 96.1, third edition](https://www.freqsound.com/SIRA/MIDI%20Specification.pdf),
was checked at SMF pages 3, 6, 8, 9 and 14 (PDF pages 132, 135, 137, 138 and 143).
It defines tracks as sequential streams, delta times as delays before events,
zero deltas for simultaneous events, Set Tempo as a tempo change, and elapsed
time through a running calculation across tempo changes.

The derived rule here is to process that stored sequence without reordering it.
At tick zero, the elapsed interval between declarations is zero, so only the
last value contributes to the following positive interval. A note attack between
declarations is still at exact time zero; it does not lock the earlier tempo for
the note's full duration. Held notes integrate all later changes.

The specification's same-time metadata paragraph permits arbitrary stored
ordering. This implementation does not invent a metadata-type priority or
normalize source order. It does not infer ordering across separate tracks.

## Preservation and limits

- Ordinary MIDI import retains the complete original bytes and adds
  `midi_initial_tempo_projection` when initial values differ
- Complete clean conversion retains every original tempo as its own typed
  command, with its original beat, track/event coordinate and runtime event ID
- The notation map alone projects those declarations to the final effective
  initial value. Authoritative JSON load revalidates that value and every
  command's source coverage and order; runtime compilation emits the same
  diagnostic code with a complete-performance preservation explanation
- Identical initial values on multiple tracks retain existing support. Any
  differing values spanning multiple tracks remain unsupported by this profile,
  including an earlier difference followed by an equal last value. Proving
  additional cross-track partial orders is outside this increment
- Differing simultaneous tempos after tick zero still fail strict conversion.
  Meter/key conflict handling, note pairing, routing, controls, tempo ranges,
  resource bounds and reference sound policy are unchanged

The native exact clock already processes retained same-track tempo commands in
order. It remains the authority for note endpoints, event times and navigation;
no JavaScript clock or BPM-rounding substitute was added. The separate complete
event-only profile is unchanged. Neither coverage nor tempo handling establishes
original timbre or recovered sheet notation.

## Verification

Original synthetic Rust cases cover format 0/1, identical and differing initial
values, an earlier differing value that returns to the original value, attacks
before/between/after declarations, fractional later changes within held notes,
source-byte retention, every retained command/ID/time, clean JSON reload and
tampering. Separate cases retain cross-track, later-tempo, meter and key holds.
Private corpus evidence remains outside the repository and public fixtures.
These checks are local implementation evidence; application and native package
acceptance are separate.

The known projection diagnostic is localized in the existing preview notices,
score details and ordinary MIDI import notice. Chinese/English changes redraw
that explanation without changing the stored engine diagnostic, source evidence
or commands. DOM tests exercise each boundary; unrelated original diagnostics
retain their existing display behavior.
