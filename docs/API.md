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

## MIDI import

`POST /api/import/midi` accepts raw `.mid`/`.midi` as `audio/midi`, `audio/x-midi` or `application/octet-stream` (5 MiB max). Type0/1 PPQ files preserve exact tick-derived onset/duration, tempo maps and attack velocity; pitch spelling, voices/staves and notation are explicitly inferred. Exact input bytes are retained as `source.format="midi-base64"`. Type2, SMPTE time division, ambiguous/unclosed notes and unsupported pedal/bend/percussion/tuning semantics produce actionable errors rather than guessed playback. Program/expression information retained only in source produces visible warnings.

## Explainable performance feedback

Assessment responses include `summary`: expected/matched counts, onset coverage, signed timing bias, timing standard deviation, early/late counts and diagnostic advice. Empty-target selections have zero coverage with a warning; small samples are labeled. A consistent timing offset includes a device-latency calibration caution rather than assigning it to playing skill. Accuracy, hits, misses, extras and mean absolute error remain available.

## Numbered-notation text

`POST /api/import/jianpu` accepts UTF-8 `text/plain` in the explicit WorldMusicHub v1 dialect, up to1MiB. It returns the compiled score and source/default diagnostics. This is not a claim to parse every jianpu typography convention. See [Jianpu text grammar](JIANPU_TEXT.md) for tonic/mode/tempo/meter headers, exact fractional durations, octave marks, rests, sustains and checked barlines. Unsupported lyrics/chords/polyphony and invalid notation are rejected explicitly. Original text is retained verbatim.

## Generated MusicXML export

`POST /api/export/musicxml` accepts a canonical Score and returns `{xml,diagnostics,part_id_map,voice_id_map}`. Export preserves supported musical timing using exact integer divisions, splits cross-bar holds with ties, maps overlapping voices explicitly, and retains supplied attribution/license notices. Safe `P1`/`P2` part IDs and positive numeric voice IDs map back to canonical labels for renderer compatibility. This generated interchange is not original engraving recovery; raw source bytes and provenance URLs never become XML markup or external resources. See [export limits](MUSICXML_EXPORT.md).

### Repeated-pitch alignment

Assessment preserves event order independently for each pitch. It first maximizes the number of valid onset matches, then minimizes total absolute timing error. It does not let a nearer later target steal a consistently late earlier attack. Coincident and complete ordered takes have exact fast paths; more than2million ambiguous candidate edges is an actionable error, not a silent greedy fallback. Timing tolerance never merges separate score attacks.

## Local transport limits

The executable uses Hyper HTTP/1 on `127.0.0.1` only, without HTTP keep-alive. It accepts at most 16 concurrent connections and two score-body/CPU operations, with a 32 KiB header buffer, 64 headers, a five-second header/body deadline, and a 30-second connection lifetime. Body content remains capped at 8 MiB. Busy processing returns 503; incomplete body reads may return 408. Import and score validation failures remain JSON 400 responses. Static assets and health checks do not wait for a long score computation.

The previous tiny_http transport was replaced because early request rejection could synchronously drain unread bodies. Existing functional smoke and engine tests pass for the replacement. Independent adversarial-resource verification remains incomplete. Functional tests are not a security certification.

### POST /api/practice-targets

Body: `{ "timeline": Timeline, "profile": InstrumentProfile }`, with the timeline already narrowed to the selected part and loop attacks. Returns `{ timeline, groups, diagnostics, source_note_count, target_count, playable }`.

The returned timeline contains physical note-on targets. For piano only, exact simultaneous events on the same MIDI key share one attack. Neighboring repeated notes are never grouped by a timing tolerance. Each `groups` entry maps `target_id` to all `source_occurrence_ids`, canonical `source_note_ids` (including tied segments), and `part_ids`. The canonical score and sounding/playback timeline remain unchanged. The target's display duration is the longest member duration; onset grading does not establish independent voice release or sustain correctness. The original `source_note_id` compatibility field still identifies the first tied segment, while `source_note_ids` retains the full chain.

Guitar retains distinct events and returns a pitch-only/string-identity warning. Empty, out-of-range or conflicting-string plans are not playable in scored mode. Listening and export remain available. A new part, loop, instrument range or tuning requires a fresh plan; never reuse a plan from a different selection.

### POST /api/export/jianpu

Body: canonical `Score`. Returns `{ text, diagnostics, note_map }` for the app-specific numbered-text v1 dialect. All source-note spellings and exact onsets/durations are roundtrip-verified. It explicitly rejects polyphonic/overlapping lanes, written ties, repeats, pickups/irregular measures and changing maps it cannot preserve. Gaps become mapped explicit rests; provenance is carried in whole-line comments. The canonical source is unchanged. Show diagnostics before downloading `.jianpu`; do not present this as a lossless replacement for JSON/MusicXML. See [numbered-text format](JIANPU_TEXT.md).
