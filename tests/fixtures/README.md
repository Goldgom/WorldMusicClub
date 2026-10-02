# MusicXML fixtures

These short fragments were newly authored as software tests for WorldMusicHub.
They are not excerpts or transcriptions of existing compositions and are released
under CC0-1.0. They test timing/import behavior, not MusicXML engraving fidelity.

- `original-duet.musicxml`: two instruments, an implicit pickup, different part
  divisions, chords, spelled accidentals, two voices/staves, rests, backup/forward,
  a tempo change inside a held note, ties, and later key/meter changes
- `original-repeat.musicxml`: a bounded, explicit three-pass repeat region
- `original-duet.mxl`: a deterministic stored/DEFLATE ZIP container holding the
  exact `original-duet.musicxml`, with a manifest and standard MXL MIME entry
- `original-duet-standard-header.musicxml`: the same original duet with a
  standard external-only 4.0 header, BOM, CRLF, multiline/tab whitespace and
  single-quoted identifiers; no musical edits
- `original-duet-standard-header.mxl`: deterministic ZIP containing that exact
  header-bearing XML at `scores/duet.musicxml`, with a manifest and MIME entry;
  all entries use the fixed 1980-01-01 timestamp

`midi-original-ppq.mid` is an original three-note synthetic parser fixture generated for WorldMusicHub, with exact PPQ timing and attack velocities. It contains no third-party song.

`original-reference-overlap.mid` is a new 208-byte original synthetic format-1 fixture generated from `tests/reference-listening-fixture.js`. Its three independent tracks contain 26 events and eight positive onsets, including overlapping identical keys and channel-index-9 program 118. It is used only by the complete-source reference listening acceptance checks and contains no third-party song.
