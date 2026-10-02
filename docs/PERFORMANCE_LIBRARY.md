# Free-performance persistence foundation

The free-practice screen connects this independent recording/storage model to PC, on-screen and explicitly connected MIDI input. It never constructs a Score, calls assessment, or changes the saved-score library. Optional synthesized feedback and a bounded fixed-tone preview are separate from capture. No crash-recovery promise is made for a recording that has not successfully stopped and saved.

## Integration contract

```js
import {FreePracticeRecorder} from '../web/free-practice-recorder.js';
import {openPerformanceLibrary, comparePerformances} from '../web/performance-library.js';

const recorder = new FreePracticeRecorder({
  id: crypto.randomUUID(),
  createdAt: new Date().toISOString(),
  onLimit: () => { /* Show retained-prefix / recording-full status. */ },
});
recorder.start(performance.now());
// Route real, normalized MIDI/PC/pointer observations independently of audio.
// recorder.observe('note_on' | 'note_off', observation);
const sealed = recorder.stop(performance.now(), new Date().toISOString());
const library = await openPerformanceLibrary();
const saved = await library.save(sealed, {label: 'Practice'});
// Only this fulfilled promise permits showing Saved.
const loaded = await library.get(saved.key); // { ...metadata, record }
const text = await library.exportRecord(saved.key);
```

Use the application's normalized event clock. `eventWall` may precede Start or a previously received event; `receivedWall` must be nondecreasing and at least `eventWall`. Boundary times cannot precede the latest receipt. Dates must be canonical UTC ISO millisecond strings. Calling Stop seals and deeply freezes the retained internal snapshot; returned snapshots are independent copies. Delayed callbacks after Stop are rejected under the explicit zero-grace policy.

Supported input kinds are `midi`, `typing_keyboard`, `on_screen_pointer`, `on_screen_keyboard`, plus explicit `pointer` and `accessible_keyboard` aliases. Input kind cannot silently change within an existing source/generation identity. Raw device strings and generation tokens stay inside the recorder; only bounded `source-N` / `generation-N` aliases reach a snapshot.

Pause and Resume retain half-open recording segments and real gaps. Paused/pre-start observations can be retained with explicit unassigned routing. Cleanup records synthetic releases separately from observed note-offs. No release pairing, played-note duration, sustain, fingering, or assessment is inferred. PC/UI velocity remains a configured UI value, not measured key pressure.

`cleanup(time, reason, {source?, prefix?, generationToken?})` accepts only source/generation scopes. MIDI channel filtering must use the already-scoped source prefix; passing a channel field is rejected rather than clearing unrelated input. Configuration supports sound, instrument, keyboard base MIDI, octave shift, semitone transpose, and a full `keyboard_configuration` archive as described below.

## Complete PC keyboard configuration

Call `recorder.configure('keyboard_configuration', keyboardInput.exportConfigurationData().current_configuration, wallTime)` immediately after Start, before enabling PC capture, and synchronously for each subsequent applied configuration before another musical callback can be admitted. Archive only the current five-field configuration, not the adapter's entire history:

```js
{
  configuration_id: 1,
  base_midi: 36,
  transpose_semitones: 0,
  duplicate_pitch_policy: 'reject', // or explicit_aliases
  mapping: [{code: 'KeyA', offset: 0, label: 'A', row: 'home'}],
}
```

The archive is deeply cloned/frozen when accepted. Later mutation of the adapter's export, a caller's object, or a returned recording cannot rewrite earlier mappings. Each binding must contain exactly code/offset/label/row. The shared physical-key validator enforces supported non-navigation physical codes, unique codes, integer offsets within −127…127, nonempty labels/rows of at most 24 JavaScript string units, base MIDI 0…127, transpose −127…127, and at least one in-range pitch. Repeated pitches require `explicit_aliases`; they never make duplicate physical codes valid. Unsupported fields, missing values/defaults, sparse arrays, accessors, nested history, and device identifiers are rejected.

Configuration IDs are positive safe integers and must increase when a changed full archive is appended. Exact repeated announcements return false and do not consume a journal entry. Successful new archives return true, append the existing `configuration_change` cleanup boundary, and retain their wall-clock time in the same ordered configuration journal. A separate pause/resume is unnecessary when this synchronous archive admission happens before any input using the changed map. The journal does not infer which physical key produced an opaque recorded input source.

A rejected keyboard archive pauses an active recorder, retains the previous prefix, and blocks further typing-keyboard observations and Resume with `free.keyboard_configuration_required`. The original validation/count/byte error is thrown to the caller. If the supplied clock itself is invalid, PC admission is still blocked but no pause timestamp is invented; the controller must pause or stop using a valid current clock. Correcting the full archive (or explicitly restoring the last accepted configuration) clears the block but leaves the recorder paused; resume explicitly. When a new map cannot fit, Stop/Save the current prefix and start another recording. The UI must show the failure and must not silently continue admitting notes under a rejected mapping. MIDI and other unaffected input observations can still be retained as unassigned while paused, under the existing gap policy.

Configuration limits are 1,000 entries and a conservative 512 KiB UTF-8 aggregate budget across scalar and full-map entries. Oversized journals throw `free.configuration_byte_limit` and are rejected on import too. This budget, the 15 MiB observation budget, and the bounded segments/envelope together fit within the 16 MiB sealed record cap. Existing version-1 records containing only scalar settings remain valid and are not rewritten or backfilled with invented mappings.

## Immutable storage API

`openPerformanceLibrary({factory = indexedDB, name = 'worldmusichub.performances'})` opens independent IndexedDB version 1 with `metadata` and `records` stores. `worldmusichub.scores.v1` and its version are unchanged.

- `save(record, {label?})`: validate and append a new local copy; return metadata
- `list()`: metadata only, newest saved first
- `get(key)` / `load(key)`: validated metadata and complete independent record, or null
- `exportRecord(key)`: a strict single-record JSON string
- `importRecord(text, {label?})`: validate and append with a new local key
- `exportBackup()`: all complete saved records and labels in a performance-only backup
- `restoreBackup(text)`: validate everything before atomically appending all entries
- `close()`: explicitly release the database connection

Each save/import obtains a fresh local UUID and immutable local revision 1. Record ID and record revision remain the original recording provenance; exporting/reimporting does not falsely claim a new captured performance. Selecting a comparison baseline should keep the chosen local key/revision alongside the actual loaded record. A title or matching record ID alone is not proof of equal content.

There is no overwrite or delete API. Passing replacement/revision options to `save` is rejected. Writes use `add`, never `put`; an unexpected key collision aborts the entire transaction. Import never replaces, merges into, or deletes existing entries. Metadata and payload commit together, and promises resolve only on `transaction.oncomplete`. Request success alone is not a save acknowledgement. Quota, abort, blocked-open, closed-handle, incompatible-version, and malformed/corrupt-data failures are explicit; no reset/recovery deletion occurs. Connections close on `versionchange`.

Keep the sealed draft available after any failed save so the user can retry or export it. Successful storage is origin/profile-local and is not a cross-device backup. Use explicit export/import when changing browser profile, app origin, or loopback port. These modules neither upload recordings nor request persistent-storage permission.

## Format and bounds

The free format is `worldmusichub-free-performance`, version 1. Only stopped/sealed records with revision 1 are accepted. It retains exact receipt order, raw normalized-clock evidence, session-relative event/receipt offsets, opaque source mappings, segments, configuration boundaries, explicit omissions, capability limitations, and `score_context: null`.

Validation rejects unknown fields/versions, non-JSON objects, malformed dates/times, inconsistent offsets/routing/source mappings, invalid MIDI fields, missing stop evidence without disclosed truncation, fabricated budget counts, or invented score/assessment data. Validation does not sort, normalize, strip fields, pair releases, fill missing mappings, or repair imports. Keep unsupported original files available to the user.

Bounds are 100 records, 16 MiB per sealed JSON record, 64 MiB total payload, 80 MiB backup input, 100,000 observations, 1,000 segments, and 1,000 configuration entries within a 512 KiB aggregate configuration budget. Labels are at most 200 JavaScript string units. All storage/import byte limits use UTF-8 bytes, not character count.

The recorder uses a conservative 15 MiB observation-plus-source admission budget, reserving room for the bounded envelope/segments/configuration. The earliest count/byte bound stops admitting evidence, retains the existing prefix, and reports `omission_reason`, omitted count and first omitted receipt. `estimated_retained_bytes` is recomputed during import validation. This conservative budget can fill before the exact JSON reaches 16 MiB. It ensures the retained sealed prefix remains savable; it does not promise browser quota. The UI must visibly surface that capture is full and omissions exist.

## Descriptive comparison only

`describePerformance(record)` and `comparePerformances(a, b)` validate their input and produce bounded descriptions:

- Retained event counts and onset pitch/input-kind distributions
- Musical-observation routing counts, including pre-start and paused/unassigned observations
- Inter-onset intervals only between adjacent receipt-order onsets in the same recording segment
- Explicit exclusions for reordered timestamps, unassigned observations and crossed boundaries
- Preserved pause gaps and omission summaries

Event order is never sorted to manufacture a timing sequence. Output has no accuracy, duration/sustain, fingering, correctness, or improvement grade. A/B results do not align performances and do not feed events back into recording, MIDI hardware, synthesis, or assessment. The separate preview reproduces only eligible recorded onset pitches as fixed 160 ms synthesized tones. It preserves pause gaps, is bounded to two minutes and 4,096 onsets, and reports exclusions. It does not reconstruct original audio, note duration, pedals or expression.

## Verification

Run `node --test tests/free-practice-recorder.test.js tests/performance-library.test.js tests/input-evidence.test.js tests/local-library.test.js` for this foundation and legacy isolation. Include `tests/keyboard-input.test.js` when changing full mapping archives. Tests use the existing `fake-indexeddb` dependency. They cover immutable copies, version/mapping/time validation, observed-versus-synthetic evidence, byte/count caps, total-budget enforcement, concurrent connections, transaction aborts and quota failures, atomic import, version-change closure, and descriptive comparison boundaries.


## Application input ownership and unknown timing

A performed-input keyboard offset never transposes the score. Full applied mapping
archives are retained at Start and each change. Leaving Free practice preserves a
paused scored take, and preview playback never routes back into either recorder.
Muted capture and muted scored Start/Play do not create or resume an AudioContext.

Input routing uses normalized event time and bounded session intervals. Older
same-source MIDI observations remain in receipt-order evidence but cannot replace
a newer live contact, reopen sound after its observed release, or cancel a newer
recording. CC120/123 cleanup is scoped to its event-time route, channel prefix and
contacts no newer than the controller event. Free-v1 records only the application's
receipt-side cleanup boundary and synthetic cancellation, not a raw physical CC
timestamp or pedal performance. A bounded prefix cutoff also prevents pre-panic
callbacks from reopening live sound; expiry conservatively suppresses older live
callbacks without removing their raw note observations. None of this bookkeeping
claims paired releases or evaluated note durations.

After a route change, MIDI observations with missing or invalid timestamps have no
provable recording ownership. A separate page-lifetime journal retains receipt
clock evidence, numeric raw timestamps when available, reason, note/channel/velocity,
encoding, and opaque source/generation aliases. Event time, segment and record IDs
remain null. These observations do not enter performances, scoring or sound.
Free and MIDI Settings show retained/omitted counts and an explicit JSON export.
The journal caps at 4,096 observations or 1 MiB, keeps the retained prefix, and
reports later omissions. It is not included in performance JSON/backups and is lost
when the page closes unless explicitly exported. No port reopen or handler rotation
is treated as proof that delayed messages have been flushed.
