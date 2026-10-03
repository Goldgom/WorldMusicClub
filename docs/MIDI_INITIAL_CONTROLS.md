# Bounded MIDI initialization for canonical practice scores

The canonical MIDI importer recognizes one ordered pair per channel:

1. Reset All Controllers (CC121), value 0, at tick 0
2. Sustain/damper off (CC64), value 0, at tick 0

The pair must precede every note-on/off, pressure, pitch bend and other controller
message on that channel. Program changes may precede the pair or follow the
complete pair; a program between its two messages is rejected. Metadata may
occur between the messages, with its original time and bytes retained. All
channel messages for an initialized channel must belong to one source track
across the complete input. An independent channel may already contain notes.

This is a declared initial state for a canonical key-event practice score: no
held keys, centered pitch and sustain off. It is not general pedal, channel-mode,
GM sound or external-device emulation. In particular, Reset All Controllers is
not treated as a program/bank/volume/pan reset. Existing explicit source-only
program and expressive-controller diagnostics continue to apply.

A retained `midi_initial_controls` warning accompanies the complete pair and
survives score JSON export, compile and library roundtrips. The importer reads
the unchanged original MIDI and preserves its entire base64 source, original
track/event-derived note IDs, pitches, note-on velocities, rational starts and
key-release durations. Programs and note-off velocities remain in that source
with their existing disclosures. It neither rewrites the input nor reduces it
to a selected melody.

Nonzero values, incomplete/repeated/reversed pairs, nonzero ticks, prior channel
state and shared-track channel ownership are rejected. Channel-prefix metadata
also blocks the new initialization case; this does not broaden the older
importer's metadata behavior. Existing routing, SMPTE, SysEx, unknown events,
bend, percussion, later pedal/reset, ambiguous overlap, zero-duration and
unmatched/unclosed-release blockers remain. Tempo, key and meter conflict checks
are unchanged. The raw MIDI reference receiver is unchanged and can still reject
an input that the canonical key-event importer admits.

On reimport, recognized legacy version 1 ZIP folders with an explicit
`imports.canonical_score: null` may retry exactly one declared original MIDI,
with mandatory matching size and SHA-256 and no supplied canonical score.
Successful complete parsing adds explicit derivation provenance to preflight,
commit and retained history; failures remain source-only with current and
historical diagnostics. Exact existing scores deduplicate, new complete scores
save once, and receipts append without changing original archives, metadata or
prior records. See [the container contract](SONG_PACK_FORMAT.md) for ambiguity,
version and parsing bounds. This does not grant new raw reference audio support.

## Semantic sources

- [MIDI Association controller assignments](https://midi.org/midi-1-0-control-change-messages)
  identifies CC64 as damper/sustain, values 0–63 off, and CC121 as Reset All
  Controllers with value 0
- [MIDI Association RP-015 landing page](https://midi.org/response-to-reset-all-controllers)
  identifies the recommended practice defining a consistent reset response
- [Yamaha CS6x/S80 Data List, section 3-2-2](https://usa.yamaha.com/files/download/other_assets/3/318083/CS6xE2.PDF)
  documents centered pitch and sustain off for reset, while leaving program,
  bank, volume and pan unchanged

These sources support the narrow initial state; they do not justify treating
arbitrary controller messages as inert or claiming acoustic equivalence.
