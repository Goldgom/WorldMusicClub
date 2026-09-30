# Prototype API contract

All routes are same-origin loopback. JSON responses; errors use `{ "error": "message" }`.

- `GET /api/catalog` -> `Score[]`, bundled original exercises
- `POST /api/compile` with `Score` -> `{ score: Score, timeline: Timeline, diagnostics: Diagnostic[] }`
- `POST /api/assess` with `{ timeline: Timeline, inputs: InputEvent[], tolerance_ms: number }` -> `Assessment`
- `POST /api/import/musicxml` with raw XML -> compilation response above (subsequent milestone)

`Score`: `{ version:1, id, title, composer, provenance:{kind:"original_exercise", attribution, source_url:null, license:null}, parts:[{id,name,instrument:"piano"|"guitar", notes: Note[]}], tempo:[{at:Beat,bpm:number}], meters:[{at:Beat,numerator:4,denominator:4}], keys:[{at:Beat,fifths:0,mode:"major"}], measures:[{number:1,at:Beat,length:Beat}], repeats:[], source:null }`.

`Beat`: `{numerator: integer, denominator: positive integer}` measured in quarter notes. `Note`: `{id, at:Beat, duration:Beat, pitch:{step:"C", alter:0, octave:4}|null, voice:"1", staff:1, velocity:90, tie_start:false, tie_stop:false}`. Rest has null pitch.

`Timeline`: `{notes:[{id,part_id,source_note_id,midi:60,start_ms:0,duration_ms:500,voice:"1",staff:1}], duration_ms:number}`; tied continuations are merged for playback while retained in Score. `Diagnostic`: `{severity:"warning"|"error"|"info",code,message,note_id:null|string}`.

`InputEvent`: `{midi:60,at_ms:500,velocity:90}` (note-on only initial milestone).
`Assessment`: `{hits: [{note_id,midi,expected_ms,actual_ms,delta_ms,grade:"perfect"|"good"|"late"|"early"}], misses:[note id], extras:[InputEvent], accuracy_percent:number, mean_abs_error_ms:number|null}`.

The UI may derive note geometry and sounds, but canonical timing and performance matching come from Rust. Controls may scale the already-compiled time for practice playback. Submit scaled performance input times transformed back to the timeline clock for assessment (tolerance likewise scaled), or recompile a score with tempo changes.

Simple disjoint repeats expand into unique occurrence ids mapping to source_note_id. Nested repeats and note sustains crossing jump boundaries are rejected explicitly instead of silently playing incorrectly.

## Local image review

`POST /api/import/image` accepts raw PNG/JPEG (`image/png`, `image/jpeg`, or `application/octet-stream`). It returns `OmrReview` with image dimensions, staff geometry, candidate bounding boxes and tentative natural treble pitches. `requires_review` is always true; candidate `duration` and `accidental` are literally `unknown`. Confidence is an uncalibrated geometric score, not probability of musical accuracy. No playable Score is returned.

Limits: 8 MiB compressed image, 16 million pixels, 16,384 pixels per axis, 512 candidates. Supported initial input is a clean upright crop with one horizontal five-line staff and distinct filled noteheads. Other material returns explicit unsupported/review warnings or an error. The UI limits images to 5 MiB when embedding the original into exported score provenance, leaving room under the 8 MiB JSON-request cap.

## MusicXML

`POST /api/import/musicxml` accepts UTF-8 raw `application/xml` or `text/xml`; output matches `/api/compile` plus importer diagnostics. Limited score-partwise input preserves original XML and basic exact note/rhythm structure. Unsupported sound-affecting features are rejected rather than guessed. Visual/expressive source details outside the canonical model are retained in source content with explicit warnings. DTD and external entities are rejected.

## Compressed MusicXML

`POST /api/import/mxl` accepts raw MXL bytes as `application/zip`, `application/vnd.recordare.musicxml` or `application/octet-stream`. It reads the declared container rootfile in memory and then uses the same guarded MusicXML parser. Limits are 8 MiB compressed, 16 MiB declared total decompression, 128 archive entries and 64 KiB container XML. Unsafe paths, duplicate entries, symlinks, encryption, ZIP64 and split archives are rejected. The exact selected XML is retained; ancillary archive bytes are explicitly not retained.

## Instrument compatibility and loops

`POST /api/instrument-check`: `{timeline, profile}`. Piano profile: `{kind:"piano",key_count:61,lowest_midi:null}`; custom key count12–128 can specify a starting MIDI pitch. Guitar profile: `{kind:"guitar",tuning:[64,59,55,50,45,40],frets:12,capo:0}`. Returns low/high bounds, each target's playable status and fret candidates, plus range/string-conflict diagnostics. It never transposes/removes source notes. Fret numbers are relative to the capo; positions are advisory, not validated ergonomic fingerings.

`POST /api/practice-window`: `{score,from:Beat,to:Beat}`. Returns `start_ms`, `end_ms`, `target_note_ids`, `crossing_notes`, and diagnostics. Rust integrates tempo changes and selects onset targets in the half-open A/B range. Sustains crossing boundaries are explicitly flagged. Repeated-score written-beat windows are rejected until repeat-pass selection can make the range unambiguous.
