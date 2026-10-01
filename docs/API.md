# Prototype API contract

All routes are same-origin loopback. JSON responses; errors use `{ "error": "message" }`.

- `GET /api/catalog` -> `Score[]`, legacy complete bundled scores and retained originals
- `GET /api/catalog/index` -> `{version:1,items:CatalogItem[]}`, lightweight metadata without notes/source archives
- `GET /api/catalog/score/<exact-id>` -> one unchanged canonical `Score`, or JSON404 for an unknown bundled ID
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

`POST /api/practice-window`: `{score,from:Beat,to:Beat}`. Returns `start_ms`, `end_ms`, `target_note_ids`, `crossing_notes`, and diagnostics. Rust selects onset targets in the half-open A/B range using exact rational written beats, then integrates tempo changes for playback milliseconds. Sustain checks use the complete written tie chain: a note ending exactly at a boundary is not a crossing note, and a tied continuation inside the range does not create another attack. B cannot exceed the exact written duration, including explicit rests and measures. Repeated-score written-beat windows are rejected until repeat-pass selection can make the range unambiguous.

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

### POST /api/metronome

Body: `{ score: Score, pulse?: "notated_unit" | "quarter" | "dotted_quarter" }`. The default is `notated_unit`, which uses the active time signature's denominator; 6/8 therefore produces six eighth-note subdivision clicks, not two inferred compound beats. Choose `dotted_quarter` explicitly for three-eighth groupings.

Returns `{ ticks, duration_ms, pulse, accent_policy, diagnostics }`. Each tick has a unique performance `id`, stable written `source_tick_id`, exact `source_at` beat, derived `start_ms`, `measure_number`, zero-based `unit_index` and `accent`. An accent marks a supplied written-measure boundary, not an inferred strong beat; pickups/partial measures receive an explicit warning. Repeat navigation and half-open boundary membership reuse the same Rust segments as notes. Tempo changes are integrated, and rests still contain clicks. The original score is never modified.

The map must contain contiguous measures covering the whole score. Duplicate signatures, meter changes inside a supplied measure and over 100,000 written or repeat-expanded clicks are explicitly refused. A failed optional metronome does not make ordinary score playback invalid. For an A–B window, retain ticks whose `start_ms` is in the same half-open performance range; do not invent a new pulse at the loop start or infer a different beat convention in JavaScript. The optional UI click track uses this Rust grid and the same transport/AudioContext as playback. It is off by default, has a separate level control, obeys global mute, and never enters performance inputs. More than 10 clicks/second (including an A–B join) or scheduling more than 100 ms late disables clicks with an explanation rather than silently thinning or replaying them. Preparation errors do not invalidate ordinary playback. The existing count-in is explicitly silent: four quarter-note beats at the displayed opening BPM, not an inferred local tempo or compound beat at A.


## Score-source directory and local import guidance

The frontend contains three fixed editorial source cards, not a searchable score catalog or download service. Filtering stays in the browser; following a source/rights link is explicit and opens the official page. No source file is fetched automatically and no directory selection changes score provenance.

The linked official references were checked on 2026-09-30:

- [OpenScore/Lieder](https://github.com/OpenScore/Lieder): CC0 corpus editions, primarily MSCX source with documented export/conversion routes; MSCX/MSCZ are not direct app inputs
- [Mutopia](https://www.mutopiaproject.org/) and its [license guide](https://www.mutopiaproject.org/legal.html): PDF/MIDI/LilyPond, with per-piece rights and attribution checks
- [IMSLP](https://imslp.org/wiki/Main_Page) and its [copyright guide](https://imslp.org/wiki/IMSLP:Copyright_Made_Simple): exact edition and jurisdiction matter; a PDF requires a separate reviewed image/OMR workflow

Unsupported PDF, MuseScore-source, LilyPond and image files selected through score import receive format-specific guidance before file contents are read. The app does not install converters, turn PDF into playable music, guarantee source availability or verify legal clearance. Users keep the original file, exact edition URL, rights notice and conversion history, then inspect import diagnostics and musical content before practice.


## Explicit reversible octave copies

`POST /api/adaptation/preview` accepts `{score, operation:{part_id:null|string,octaves:integer},profile}` and returns a complete compilation plus changed written-note count, original-retention flag and instrument diagnostics. Preview is stateless. The frontend requires a fresh context-matched preview and explicit confirmation before activation; whole-score and current entire-part scope never mean only the current A–B window. Normal selected-target checks run again after activation.

`POST /api/adaptation/restore` accepts the complete adapted Score and returns its original compilation only if the current derivative still matches the retained transformation. The UI previews that checked original and requires a separate explicit restore confirmation. Activation/restoration does not overwrite saved library copies. Preserve the complete JSON or a library backup for reversibility; MusicXML/.jianpu alone omit the envelope. See [the exact adaptation contract](ADAPTATION.md).


## Optional external OMR review UI

The image-review and source-guide workflows can open a separate local Audiveris 5.11.0 output-review dialog. It reads explicitly selected XML/MXL and an optional matching PNG/JPEG; it never installs/executes the engine or downloads/uploads source material to an external service. See [the gated bridge contract](EXTERNAL_OMR_REVIEW.md).

The UI keeps the original retention record outside editable JSON, shows unknown confidence and every warning through pagination, and preserves all canonical parts, voices, staves, ties, maps and repeats. Structured note and tempo/key fields are paged at 20 entries; Advanced JSON edits the complete canonical structure without a source field. Replacements, edits and cancellation clear pending confirmations. All six review categories are required before `/api/omr/confirm`, then the reviewed result uses the normal activation and fresh instrument-target checks. The current playable score is unchanged during draft preparation. Full JSON/library backups preserve raw engine output and an explicitly attached original image; interchange exports alone do not.

## Default notation presentation

Supported scores open in the packaged offline engraved staff view. An explicit Simplified pitch guide or Jianpu selection is kept for later scores in the same session. Export/renderer limitations or failures keep a persistent visible explanation beside the simplified fallback; they are not treated as successful engraving. A new score or explicit engraved-view request can retry. The static staff remains display-only, with bounded measure paging; source-measure following is optional and uses the dedicated Rust navigation contract below. Playback and scoring continue to use the unchanged Rust timeline.

## Optional notation-navigation contract

`POST /api/notation-navigation` accepts the complete canonical Score and returns a display-only full-performance map. It compiles the unchanged score and reuses the engine's exact repeat-navigation segments. It never changes notes, scoring targets, audio scheduling or the current playback clock.

Response fields: `version:1`, `source_measure_count`, `duration_ms`, `occurrences`, `sounding_groups`, and `diagnostics`. Each occurrence contains a unique `id`, zero-based `source_measure_index` into the **original ordered measure array**, the unchanged printed `measure_number`, exact rational `source_from`/`source_to`, and performance-clock `start_ms`/`end_ms`. Both source and performance intervals are half-open. At the exact full duration no interval is active. Printed measure labels may repeat, start at zero or be nonsequential; they are never used as array ordinals. A pickup is simply its declared short measure.

`repeat_region_index` is the unchanged input repeat-array index; `repeat_pass` is one-based and `repeat_times` is the region's declared count. All three are null outside repeats. A repeat boundary inside a written measure splits its navigation interval without inventing a new measure. Such a score may still be unsupported by the separate MusicXML exporter; navigation success does not guarantee engravability.

`written_note_ids` includes every written note/rest whose onset belongs to the interval, including explicit tie continuations. `continuing_note_ids` contains written events that began earlier and still extend into its start. Membership uses exact rational comparison, not floating tolerances. `sounding_groups` contains the compiled `occurrence_id`, `part_id`, complete tied `source_note_ids`, `start_ms` and `end_ms`. A written continuation is not a new attack; unison voices are not grouped by this display route.

Following requires contiguous, ordered measures from beat zero covering the complete score, as the exporter does; it does not sort, repair or invent measures. Limits are 100,000 intervals, 1,000,000 total source references and a 16 MiB response. Failure disables optional following only; manual notation and playback remain available. Existing written A–B loops remain limited to linear scores and reject repeats until explicit pass selection is supported.

The frontend following checkbox is off initially and after score replacement. Enabling it prepares/caches one navigation map for the current immutable score, validates IDs against the current compilation and uses binary interval lookup. Only a change of source measure **page** requests a new local engraving; automatic page turns never pause, seek or reschedule audio. Count-in and the exact full duration have no active interval. Repeats show their original region and one-based pass labels. Manual measure/part/page-size navigation, leaving the engraved view or pagehide suspends following. Preparation/cancellation errors leave manual notation and playback usable. Page rendering can lag the audio clock; individual engraved-note highlighting is not claimed.

## On-demand bundled catalog

`CatalogItem` includes `id`, `title`, `composer`, complete `provenance`, `written_event_count` (pitched note segments plus rests), `pitched_note_count`, `rest_count`, `opening_bpm` and `part_count`. These are written-data counts, not tie/repeat-expanded playback targets. The index transfers no notes, retained original source, image or MIDI archive. The server caches its fixed built-in scores and metadata immutably; requesting an individual score does not mutate an edition or bypass normal compilation/instrument checks.

The score endpoint uses an exact catalog ID, not a filesystem path or external URL. Current bundled identifiers are portable lowercase ASCII labels. Unknown IDs return JSON404; legacy `GET /api/catalog` remains available for existing clients. A client should fetch the index, load one selected score, reject stale selection responses, and keep any session cache bounded. Loading errors should leave the previous score usable rather than partially replacing it.

## Floating-point transport fidelity

Canonical beats remain exact rational numbers. Derived timeline milliseconds are finite IEEE 754 `f64` values and must survive JSON serialization/deserialization bit-for-bit before a client reposts them for instrument checks or target grouping. The locked `serde_json` dependency enables its `float_roundtrip` feature. Tests exercise the complete 38.5 BPM D768 timeline and exact target timing after reposting; no epsilon was added to the frontend's attack/source correspondence validator to hide transport changes. This preserves numeric values, not arbitrary formatting of JSON decimal text, and does not turn floating-point milliseconds into the canonical storage format.

The frontend starts with the lightweight index and fetches one complete score when it is selected. It does not request the legacy full archive list for startup. Metadata counts distinguish all written events from pitched segments and rests; every activated score still goes through normal Rust compilation and instrument/target validation.

A session-only LRU cache holds at most three canonical score snapshots and 16 MiB of serialized score data, with 8 MiB per score. Each read returns an independent copy, so tempo edits never modify a cached original. A fresh index read clears the cache. New catalog selections, local imports and saved-score loads cancel older catalog work; the shared load intent is checked again after compilation. Failed loading keeps the previous score available, and metadata retry remains available after local import. This temporary cache is separate from explicit saved-library copies and backups.
