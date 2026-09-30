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
