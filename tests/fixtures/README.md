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
