# Clean song packages v2 (implementation contract)

Status: bounded core implementation and native/runtime integration contract. This does not change canonical
Score v1, the accepted v1 pack reader, or existing native library folders.

## Deliverable

Each song folder has exactly `metadata.json`, `score.json`, and zero or more
explicitly declared runtime assets under `media/`. No source MIDI, archive,
`source.payload`, encoded original, debug report, executable skin, remote URL,
or undeclared file belongs in this deliverable. Private original inputs and
conversion audit records remain outside exported folders and are not deleted.
A ZIP is a transport for these folders, not an additional musical source.

The pack manifest is `{ "format": "worldmusichub-song-pack", "version": 2,
"songs": [{"folder":"songs/example"}] }`. A single clean song folder is also
valid without a pack manifest. Folder names do not become storage paths.

`metadata.json`:

```json
{
  "format": "worldmusichub-song",
  "version": 2,
  "id": "stable-song-id",
  "title": "Original authored example",
  "score": {"path":"score.json", "bytes":123, "sha256":"..."},
  "sources": [{"format":"midi", "bytes":123, "sha256":"..."}],
  "rights": {"status":"user_supplied_unverified", "attribution":"...", "license":null},
  "media": []
}
```

The metadata's source descriptors are evidence hashes, not filenames, locators,
encoded content, or license grants. Source format describes the input protocol;
an original authored MIDI fixture still uses `midi`, with authorship in rights.
The complete score, its ID/title, source evidence, coverage and media hashes are
validated together before becoming a playable entry. Missing optional media is
valid; missing declared media is not. No conversion may claim complete merely
because a playable excerpt exists.

## One complete score JSON

`score.json` is a versioned `worldmusichub-complete-score` envelope. Its
`notation` is an ordinary canonical Score v1 with `source: null`; it goes through
the existing Rust validation, compilation, instrument adaptation, and grading
engine. This is a view of the source's notes, not the complete expressive
performance. MIDI spelling, staff assignment, voices and measures remain
explicitly inferred. The independent `performance` layer carries the full,
normalized sequence and each source track, including silent conductor tracks.

The first bounded semantic profile is `wmh-semantic-midi1-v1`:

- Exact quarter-note rational positions; a positive, exact microseconds-per-
  quarter tempo sequence is the performance clock. No rounded imported duration
  or arbitrary note pairing. Ordered simultaneous commands retain original
  per-track order; ambiguous cross-track state changes block conversion.
- Parts identify playable musical lines. A source track is a container; a MIDI
  channel is a shared control route; neither is a staff, voice or instrument.
  Each part references its canonical part ID, originating track and channel.
  Staff and voice retain canonical identities. Instrument program/bank state
  belongs to a route and can change over the sequence.
- A performance note references its canonical note ID, part ID, release velocity,
  and the two exact original event coordinates that uniquely prove the attack
  and key release. Canonical note onset/duration/velocity/pitch remain the
  validated interval. Sustain is a separate control, never added to key duration.
- Other sequence entries are closed, typed musical commands: instrument program,
  bank select, volume, pan, expression, reverb/chorus send, key/channel pressure,
  explicit initial controller state, tempo, meter including metronome grouping,
  key signature, sequence number, named textual cues and track end. There is no
  generic MIDI byte payload, arbitrary controller object, unknown event dump or
  source offset/encoding field. Unknown semantics block complete conversion.
- Every original event coordinate occurs exactly once in the note evidence or
  normalized typed command sequence. Per-track counts and final track-end cues
  prove structural coverage, including tracks with no notes. Coverage counts are
  calculated by validation, not accepted as an unchecked success claim.
- Unsupported/malformed material remains an explicit conversion failure with
  privately retained originals and actionable reasons. A future reviewed
  semantic profile may support it; v2 does not silently coerce it.

A serializer must reject `notation.source` rather than accidentally shipping its
content. Public v2 import is an authoritative schema path, unlike the archival
raw-MIDI inspection JSON API, which remains read-only and nonauthoritative.

## Sound and part selection

The user chooses a performance target part and practice instrument independently.
Other parts have individual accompaniment enable/disable controls. The full
source's normalized sequence remains immutable. A derived playable target or
notation filter never deletes the other parts. Shared route state is replayed
for every affected part, while muting gates the part's voices, not the shared
state commands. If a renderer cannot implement a required command, full-sequence
playback is explicitly unavailable; it must not fall back silently to a global
synthetic tone. A declared procedural reference rendition can be offered with
its exact capability profile and sound limitations.

Instrument identities carry origin and confidence: numeric MIDI programs do not
prove General MIDI sound-set identity. The app distinguishes source designation,
chosen practice instrument, and available renderer voice. Coverage of musical
data, notation, and a particular renderer are separate results. Release velocity,
pressure, bank/effect commands and per-part identity survive even when a specific
renderer reports them unsupported. Conversion completion never means original
acoustic fidelity.

## Runtime assets

Each media descriptor has `id`, `role`, `path`, `mime`, `bytes`, `sha256`, and
`rights` (same rights object shape). Roles are `cover`, `background`, `pv`,
`full_mix`, or `stem`. Stem descriptors additionally name one or more existing
part IDs; a full mix cannot claim per-instrument muting. Timed assets carry
`offset_ms`, an integer in [-86400000,86400000], defining asset time zero on the
song clock. Cover/background must not carry a clock offset or part binding.

Allowlisted v2 media: PNG/JPEG/WebP images; MP4/WebM video; WAV/MP3/Ogg audio.
No SVG, HTML, CSS, JavaScript, executable, external fetch, URL or data URI.
Relative paths use forward slashes, start `media/`, contain only safe portable
segments, never hidden/dot/parent/absolute/drive paths, and are unique under ASCII
case folding. MIME, extension, magic/container signature, size and SHA-256 must
agree. Images are at most 16 MiB each; timed assets at most 64 MiB each; each
song at most 128 MiB and 32 assets. Existing pack-wide limits still apply.

Load image/video/audio through validated native asset handles bound to one
library entry and its immutable asset hash. Cover populates the song library;
background and PV populate the active song. PV defaults muted. Explicit audio
mode is score rendition, stems, or full mix: a full mix is never layered on top
of synthesized accompaniment by accident. The song generation token and one
transport clock govern loads, playback, pause, resume, selection changes,
navigation and disposal. Stale decode/play promises cannot resurrect an old song.
URLs/handles are revoked or dropped on disposal; no audio context before a user
play gesture. Missing optional asset yields the ordinary visual fallback.

## Native atomic lifecycle and compatibility

A dedicated versioned package storage path stages both JSONs and every declared
asset, validates hashes and bounds, writes final metadata last, syncs files and
folder, then atomically renames a complete package. Primary and backup copies
must each be complete before an entry is listed. Interrupted stages stay hidden;
recovery is hash-verified and never overwrites user content. Stable content
identity covers normalized metadata, exact score bytes and every asset hash.

An index contains only verified complete folder references and can be rebuilt
on restart. API responses return the canonical notation view plus the complete
package descriptor/performance view and opaque asset handles. Existing v1 entries
continue through the old route. No destructive migration or automatic rewriting
of old scores is allowed. Clean v2 export includes the exact two JSONs and all
declared assets, with a newly validated manifest; existing retained-archive
export remains a distinct private recovery operation.

## Small vertical slice and verification gate

1. Convert a wholly authored multi-track fixture through the same converter
   intended for provided sources, proving every track/event and stripping source.
2. Validate exact clean-folder inventory, hashes, note correspondence and media.
3. Persist/import atomically, reopen/reindex, load unchanged package identity.
4. Display cover and background; play a muted PV on the transport clock; select
   either target part and mute the other while state remains independent.
5. Export/reimport the full package and verify both JSONs and every asset hash.
6. Repeat with no media, and with interrupted saves, corrupt/missing media,
   undeclared/raw files, unsafe paths, unknown semantic events and late callbacks.

Original authored fixtures only in the repository/CI. Provided songs stay private.
Focused Rust/Node/DOM checks can validate the implementation; real-browser and
Windows/native acceptance remain explicitly outstanding if the environment does
not permit them. A package count must distinguish complete conversions, blocked
sources, duplicates and source-only private audit records.

## Implemented core API and first profile limits

`score_core::clean_song` exports `convert_midi(&[u8])`, `validate(&CompleteScore)`,
`encode_json`, `decode_json`, and `compile_complete`. Direct typed JSON parsing
rejects unknown and duplicate fields; do not parse through a generic JSON object
first. The 16 MiB score limit is additional to the original MIDI's 5 MiB,
128-track, 250,000-event and 100,000-note bounds. The source descriptor inside the
score has only format, byte length and SHA-256. These are claims when reading an
external package; conversion verifies them against the original private input.

The authored fixture is `tests/fixtures/clean-song-v2/`: three tracks (one
conductor), two independent pitched parts, five notes, 25 original events,
programs 0/24, channel volume/pan, release velocities, and an exact tempo change.
The separate `tests/fixtures/clean-song-v2-runtime.json` is test evidence, not a
file delivered inside the clean song folder. Its duration is 1,800 ms.

`compile_complete` returns canonical `compilation`, plus source-identity-preserving
`events` and `notes`, with exact rational microseconds (decimal-string numerator,
integer denominator) and scheduling-boundary milliseconds. Its canonical timeline
uses these same times, so practice and accompaniment share the performance clock.
Events have `event_id`, `at_ms`, `exact_microseconds`, `origin`, and `command`.
Notes have `event_id`, `note_id`, `part_id`, `track_id`, `channel`, `start_ms`,
`end_ms`, `start_microseconds`, `end_microseconds`, `key`, `velocity`,
`release_velocity`, `attack`, and `release`. Duration includes silent track ends.
The MIDI fixture uses no repeat unfolding, ties, duration guessing or source bytes.

The command-line example `clean-song-convert` reads untouched MIDI on stdin and
writes the one complete score JSON. `--runtime` instead emits the derived runtime.
`--validate-runtime` reads clean score JSON, validates it, and derives the same
runtime after reload. Errors exit nonzero and never emit a partial score.

Current profile restrictions are deliberate and testable: percussion, ambiguous
same-key overlap, cross-track releases, same-channel simultaneous cross-track
commands, unresolved routing, active pedals, bend, unknown metadata, SysEx and
encoded project text are blocked. Text must be valid UTF-8, bounded, plain cues;
VSQ `DM:` project blocks require a separate explicit semantic profile. Complete
conversion is not claimed for these sources. Controller initialization supports
only the existing importer-proven reset/sustain-off pair at zero, before other
control/note state; a preceding program remains intact. Program/volume/pan are not
reset by this command. Inferred staff/voice identities live in canonical notation.

Future profiles may include performance-only percussion/voices with no pitched
notation target. That requires explicit notation/target coverage, not fake piano
notes or permanently forcing every performance part into this first profile.
VSQ must use a typed project profile preserving its lyrics, singer changes and
expression curves; putting its original project block in a text cue is forbidden.

The separate 32-second interaction fixture is `tests/fixtures/clean-song-v2-long/`
with runtime test evidence beside the folder. It has three tracks, two parts,
30 notes and 74 source events, and can be recreated by
`scripts/generate-clean-song-long-fixture.py <clean-song-convert executable>`.
This script authors its input in memory, invokes the same production converter,
and compares the original and reloaded runtime byte-for-byte before saving.
Optional runtime-media tests may add authored assets and metadata descriptors
without changing the musical score or its private-source hash.
