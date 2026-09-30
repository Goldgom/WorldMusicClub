# WorldMusicHub numbered-notation text v1

`worldmusichub-jianpu-text-v1` is an **app-specific, monophonic plaintext input format**. It is not a standard interchange format and does not claim to read arbitrary Jianpu text, printed numbered scores, lyrics, or image/PDF notation. Import is entirely local and uses no network service.

Successful imports retain the original UTF-8 text byte-for-byte in `score.source.content`, with `score.source.format = "worldmusichub-jianpu-text-v1"`. The canonical score preserves exact rational timing, spelling, key, meter, tempo, and explicit rests. JSON serialization retains this source for later correction or re-import. The import does not establish ownership or grant a license: provenance is `user_import`, and the asset license remains unset.

## Original example

The following is a newly authored scale exercise, not a transcription of a song:

```text
format=worldmusichub-jianpu-text-v1
title=Small steps
composer=Your name
1=D4
mode=major
tempo=90
meter=4/4
1 2 3 0 |
4:1/2 5:1/2 6 7 1' |
1' - - - |
```

A single leading UTF-8 byte-order mark (BOM) from an editor is accepted as an encoding marker and remains preserved in `score.source.content`. A BOM inside a token or a repeated leading BOM is not silently removed.

All headers must precede the first music token. Put each header on its own line; whitespace around `=` is permitted. Header names and enum values are case-sensitive. Every header is optional, but duplicates, unknown headers, and empty values are errors.

| Header | Meaning |
| --- | --- |
| `format=worldmusichub-jianpu-text-v1` | Explicit dialect version; other values are rejected |
| `title=Small steps` | Unicode title, at most 1,000 UTF-8 bytes; default `Imported numbered notation` |
| `composer=Your name` | Unicode composer label, at most 1,024 UTF-8 bytes; default `Unknown` |
| `1=C4` | Degree-one tonic, with a required scientific-pitch octave; default C4 (MIDI 60) |
| `mode=major` | `major` or `minor`; default `major`; `minor` means the natural minor scale |
| `tempo=90` | Quarter-note beats per minute, 10–600; up to three decimal places; default 90 |
| `meter=4/4` | Numerator 1–64; denominator 1, 2, 4, 8, 16, 32, or 64; default 4/4 |

An import diagnostic explicitly lists omitted tonic, mode, tempo, and meter defaults. The tonic uses uppercase A–G, at most one ASCII `#` or `b`, and an octave from `-1` through `9`, for example `1=F#4` or `1=Bb3`. Its sounding pitch must also fit MIDI 0–127. Only major/minor keys with at most seven sharps or flats are supported; `1=D#4` with major mode, for example, must use an enharmonic tonic instead.

**Degree 1 is the tonic in both major and minor.** This differs from text conventions that use degree 6 for the minor tonic. For A natural minor, write `1=A4` and `mode=minor`; then `1 2 3 4 5 6 7` sounds A B C D E F G. Harmonic or melodic alterations must be explicit, for example `#7` for the raised seventh. Mid-score changes of key, mode, tempo, or meter are unsupported.

## Music tokens

Separate every token with whitespace. Line breaks have no musical meaning. `|` must be a separate token: write `1 2 |`, not `1 2|`.

```text
note = [# or b] degree [apostrophes OR commas] [:numerator/denominator] [.] 
rest = 0 [:numerator/denominator] [.] 
degree = 1 | 2 | 3 | 4 | 5 | 6 | 7
```

- `1`–`7` are scale degrees; an unmodified token lasts one **quarter-note beat**, independently of the meter denominator
- `0` is an explicit rest; it has the same duration options as a note, but no accidental or octave marks
- A prefix `#` raises the degree by one semitone; `b` lowers it by one semitone **relative to its pitch in the selected key**. In D major, `3` is F-sharp and `#3` is F-double-sharp. The canonical spelling is preserved
- Apostrophes after the degree raise octaves: `1'` is one octave above `1`, `1''` is two octaves above
- Commas lower octaves: `1,` is one octave below `1`. Do not mix commas and apostrophes in one token; at most ten marks are allowed, subject to MIDI limits
- `:n/d` overrides the duration in exact quarter-note beats: `1:1/2` is an eighth note, `1:2/1` is a half note, and `1:1/3 2:1/3 3:1/3` occupies exactly one beat. Both integers must be positive; decimals, zero, signs, omitted denominators, and exponent notation are errors
- One dot at the **very end** multiplies the token duration by 3/2: `1.` lasts 3/2 beats, `1':1/2.` lasts 3/4 beats, and `0:1/2.` is a dotted eighth rest. A dot always augments duration; it never marks an octave. Multiple dots are unsupported
- A standalone `-` extends the immediately preceding note or rest by exactly one quarter-note beat. Repeated hyphens add beats without a new attack; `1 - - -` creates one four-beat note. A hyphen can continue a note across a checked barline, for example `1 - - - | - - - - |`. It cannot begin the score or carry a duration suffix

There is one melody part, voice 1, staff 1. Pitched notes receive velocity 90, rests velocity 0, and the default practice instrument is piano. The format has no expression or instrument directives.

## Measures and barlines

Measures start at beat zero and are inferred from the meter. Each standalone `|` is an optional assertion that the current musical time is an exact measure boundary. Missing barlines do not change time; a marker after multiple complete measures is valid. A leading barline, duplicate barline, or barline at a fractional measure position is an error with its line/token location and exact beat position.

**Pickup/anacrusis measures are unsupported in v1.** In particular, `pickup=` is rejected. Use MusicXML when a pickup must be represented accurately. Do not silently reinterpret a short opening as a pickup.

A final incomplete measure is allowed **without a closing barline**. It remains its exact written length and produces a diagnostic; the importer does not add rests. Notes may span inferred measure boundaries and remain a single sustained canonical note. Barline assertions are not repeats, phrase endings, or tie markers.

## Limits and unsupported notation

- Input at most 1 MiB of UTF-8; no byte-order mark or control characters except tab, CR, and LF
- At most 100,000 notes/rests and 100,000 inferred measures; generated identifiers remain under 128 bytes
- Note tokens use ASCII and are at most 128 bytes. Title and composer may use Unicode; ordinary whitespace, including Unicode whitespace, can separate tokens
- Written duration numerator at most 1,000,000,000 and denominator at most 1,000,000. Reduced durations, onsets, and all accumulated time must also fit those rational limits; a very small fraction combined with another incompatible denominator can exceed the limit
- Every pitch must be MIDI 0–127 and spellable with no more than a double sharp or flat

Unsupported tokens and directives are **errors, never discarded annotations**. This includes lyrics, chords, multiple voices, repeat signs, slurs/ties other than the documented duration extension, grace notes, ornaments, dynamics, numeric velocity directives, underlines, octave dots, Unicode accidental symbols, comments, and other Jianpu dialects. `123` is not three notes; write `1 2 3`. Use MusicXML for richer supported score structure, or manually translate into this exact dialect after reviewing the original.

The retained original source is authoritative for text fidelity. The canonical score and staff/numbered views are a musical interpretation of this explicitly bounded input format; visual engraving is not a lossless reproduction of a printed score.

## Export and source comments

The app can export a canonical **single monophonic lane** to this dialect through `/api/export/jianpu`. Every exported note/rest has an explicit rational `:n/d` duration. Exact gaps and trailing measure time become explicit rests, rather than shifting later notes. The exporter reimports the result and verifies every mapped source note's spelling, onset and duration before returning it.

The format now permits a whole-line comment beginning with `;` (after optional leading whitespace). It is ignored musically and retained with the full source text. Inline comments are not supported. Exported attribution, license and source URL are written as comments; this records supplied provenance and is not a verification of rights. Comments cannot set headers or introduce notes.

Text v1 cannot preserve multiple parts/voices/staves, chords, overlapping notes, written ties, repeats, pickups, irregular measures, mid-score changes or tempo values finer than three decimal places. The exporter refuses those cases explicitly; it does not silently flatten them. It also refuses notes requiring more than one semitone of alteration relative to a degree in the selected key. Canonical source, IDs, expressive velocity, instrument configuration and engraving are not stored in this simple musical dialect. Keep `.wmhscore.json` or MusicXML as the full archive. The API returns `diagnostics` and a `note_map` linking each text token to its canonical note ID, or `null` for an added gap rest.

A manually reviewed single-melody image fragment can therefore become editable numbered text, with all manually confirmed pitched notes retained. A complex score should remain in the richer format and use the separate multi-voice numbered display until a broader text dialect is designed.
