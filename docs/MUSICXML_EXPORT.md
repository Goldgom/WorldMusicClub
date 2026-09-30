# Canonical score → MusicXML

`score_core::export_musicxml(&Score) -> Result<ExportedMusicXml, String>` creates
self-contained MusicXML 4.0 `score-partwise` interchange. The loopback API exposes
this as `POST /api/export/musicxml` with a canonical `Score` JSON body.

The response contains:

- `xml`: UTF-8 XML, including its standard XML declaration
- `diagnostics`: generated-engraving and, when needed, inferred-rhythm / additional
  engraving-lane warnings
- `part_id_map`: canonical part IDs mapped to generated XML-safe IDs (`P1`, `P2`, …)
- `voice_id_map`: entries `{part_id, staff, voice, lane, xml_voice}`, preserving the
  canonical part/staff/voice and one-based overlap lane for each generated numeric
  MusicXML voice

This is generated notation, not recovery of the original engraving. Canonical
JSON remains authoritative. Export does not mutate the score, its note IDs,
voices, source, provenance, or playback compilation. Part/instrument/XML note IDs
are generated for safe interchange. Exported note IDs are
`N{part ordinal}_{original note ordinal}_{measure ordinal}`, with one-based
ordinals; notes spanning measures have one ID per segment. Consumers must use
`part_id_map` rather than assume canonical part IDs are legal XML IDs.

## Exact supported music

- Pitched concert notes with original pitch spelling, double accidentals, rests,
  original staff numbers and distinct voices (labels retained in `voice_id_map`)
- Simultaneous unique pitches as chords, with the longest chord tone first;
  backups and forwards retain polyphony and silent gaps without inventing rests
- Rational onset/duration, calculated with a checked least common multiple of
  reduced denominators; there is no timing quantization or float conversion
- All declared measures, starting at beat zero and contiguous in their supplied
  order; empty and trailing silent bars retain their exact lengths
- Pickups/partial/irregular bars marked `implicit="yes"` when their length differs
  from the active meter (also used when no meter is available)
- Cross-measure notes split into exact segments with both sounding `tie` and
  written `tied` marks; cross-measure rests split without ties
- Well-formed adjacent existing ties, including ties that need additional
  cross-measure segments
- Shared tempo, numeric meter and traditional key maps, including changes within
  measures and metadata located at the final boundary
- Disjoint, bar-aligned repeats with explicit forward/backward boundaries and
  repeat counts; adjacent repeat regions are supported
- MIDI attack velocity via MusicXML `note @dynamics`, expressed as a percentage
  of forte velocity 90. Six decimal places recover every integer velocity 0–127
  with nearest-integer MIDI conversion; the application importer tests all 128
  values. External players may interpret dynamics differently

An overlapping MIDI-style voice is deterministically split into explicit
engraving lanes. Each additional lane produces a diagnostic naming the canonical
part, staff, voice, and first affected note. Duplicate-pitch simultaneous notes
use separate lanes rather than ambiguous unison chords. Staff numbers and all
sounding pitches/times survive; the canonical score's voices are unchanged.
Explicit ties retain their assigned lane. A tie continuation that cannot fit
its lane is rejected with an instruction to assign distinct canonical voices.

Each distinct `(staff, original voice, overlap lane)` receives a unique positive
integer XML voice within its part. MusicXML itself allows text labels, but the
pinned OSMD renderer parses them with `parseInt`; raw labels such as `right`,
`left`, `1abc`, or `01` could otherwise merge independent voices. The explicit
`voice_id_map` retains original labels and a `musicxml_voice_ids` diagnostic
explains changes. Importing only the XML keeps numeric engraving labels; a
consumer needs the accompanying map to recover canonical labels. Part/staff
membership and separate sounding voices are never silently merged.

## Attribution and license notices

Provided `provenance.attribution` is copied verbatim as escaped identification
`<rights type="attribution">` text. A supplied `provenance.license` is copied as
`<rights type="license">`; `None` produces no license element. This preserves
notices for original, licensed, unknown, and user-imported material without
claiming that ownership, clearance, or the supplied license has been verified.
No license is inferred from a filename, source kind, or source URL. Canonical
bounds (8,192 attribution bytes, 256 license bytes), XML-character validation,
and the overall output-size bound apply.

On reimport, these notices survive in the exact retained XML source. The limited
importer still assigns its generic user-import provenance rather than treating
external rights text as verified permission. The original canonical provenance
is unchanged by export. Source URLs and raw retained sources are never copied.

## Inferred display and honest limits

The canonical model does not store clefs, original note types, beaming, layout,
lyrics, fingering, articulation or visual tuplet groups. Generated treble/bass
clefs are inferred from each staff's register, always in concert pitch, with no
implicit octave transposition for guitar. Standard/dotted durations get standard
note types; other exact durations use `time-modification` ratios and a diagnostic.
Unquantized MIDI may therefore render as complicated tuplets. The exporter does
not pretend that this is an expertly edited notation edition.

The generated XML does not include original XML, retained images, MIDI bytes,
source filenames, provenance URLs, DTDs, linked assets, stylesheet instructions,
or network references. Consumers may allow the ordinary XML declaration; other
processing instructions and external references remain forbidden. Titles,
composers, part/instrument names, attribution and license notices are XML-escaped. Voice labels are validated
and retained in the response map. Forbidden XML 1.0
characters in emitted text are rejected. Original identifiers are not used as
XML IDs. Importing generated XML creates new canonical/source identifiers.

The application importer treats generated clefs as source-only notation and may
emit its usual limited-import, source-only-clef, exact-tuplet, repeat, and
sound-tempo-authority diagnostics. These do not indicate lost canonical timing.
Rendering-library limits can be smaller than export limits and must be surfaced
separately. Rendering is not the authority for playback timing.

Actionable export errors cover:

- Missing, gapped, overlapping or unordered measure maps; notes or metadata past
  the final measure
- Conflicting duplicate signature events, unsupported key modes, blank
  part/instrument names, or blank/padded voice labels
- Orphan/non-adjacent/unclosed/ambiguous ties, overlapping/nested repeats,
  non-bar-aligned repeat boundaries, or sounding notes/ties crossing repeat jumps
- Exact divisions or tuplet-ratio terms over 1,000,000; measure duration over
  1,000,000,000 division units; checked-arithmetic failure
- More than 100,000 post-split note/rest segments, 256 engraving lanes per part,
  500,000 generated musical events, or 8 MiB generated XML

Canonical validation's part/note/metadata and rational-size limits also apply.
Limits are checked before unbounded expansion and during writing. A failure does
not return truncated XML or silently approximated music.

## Verification

The Rust tests round-trip output through `import_musicxml` and `compile`, compare
sounding pitches, onsets, durations, velocities, staff/part assignments and total
playback length, and verify the input remains byte-for-byte unchanged under JSON
serialization. Coverage includes the original duet, repeat and MIDI fixtures,
Unicode/escaping, rights-notice retention without license inference, two hands,
chords, cross-bar notes/rests, ties, intra-note tempo,
mid-measure signatures, pickups, partial/empty measures, overlap lanes, all MIDI
velocities, numeric voice collision prevention, exact tuplets, unsupported inputs
and resource guards.

Run:

```sh
cargo test -p score-core musicxml_export
cargo clippy -p score-core --all-targets -- -D warnings
```

Interchange structure follows the primary MusicXML 4.0 specification:

- [Note ordering, ties, velocity percentages](https://www.w3.org/2021/06/musicxml40/musicxml-reference/elements/note/)
- [Duration and the musical cursor](https://www.w3.org/2021/06/musicxml40/musicxml-reference/elements/duration/)
- [Mid-measure attributes and element ordering](https://www.w3.org/2021/06/musicxml40/musicxml-reference/elements/attributes/)
- [Exact time-modification ratios](https://www.w3.org/2021/06/musicxml40/musicxml-reference/elements/time-modification/)
- [Official MusicXML schema](https://www.w3.org/2021/06/musicxml40/listings/musicxml.xsd/)

- [Rights notices and extensible notice types](https://www.w3.org/2021/06/musicxml40/musicxml-reference/elements/rights/)
