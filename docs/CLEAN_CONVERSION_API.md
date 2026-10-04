# Built-in clean-song draft contract

This source capability prepares a whole MIDI song without writing to the native
library or changing the active song, take, recording or session. It reuses
`clean_song`, `clean_performance`, `midi_events` and the existing v2 song-package
schema. It is not a new score format or a release-acceptance claim.

## Prepare a draft

`POST /api/clean-song/draft`, `Content-Type: application/json`:

```json
{"source_base64":"<standard Base64 of the complete original MIDI>","source_name":"exercise.mid","title":"Exercise"}
```

The source is at most 5 MiB; the entire request is at most 8 MiB. The title is
nonblank, at most 1000 UTF-8 bytes and has no control characters; the source name
has the same rules with a 255-byte limit. Unknown or duplicate fields, invalid
Base64 and invalid presentation fields fail with HTTP 400. Source/request bounds
fail with HTTP 413. There are no selected-track or quantization options. The
first built-in slice supports MIDI only; it does not claim MusicXML/VSQ support.

The response contains `state`, `source` (format, original byte count and SHA-256),
`source_name`, `title`, `inventory`, `diagnostics`, `package` and `draft_sha256`.

- `strict_notation_candidate` (200): the entire strict semantic score validates
  and compiles, with inferred canonical notation and preserved source events
- `event_only_reference_candidate` (200): strict notation is unavailable; the
  entire independent typed-event profile validates and compiles without guessed
  note pairing, notation or scoring targets
- `rejected` (422): no complete supported conversion exists; `package` and
  `draft_sha256` are null, and no partial score or track subset is returned

Both successful states are conversion candidates. Existing runtime/receiver
admission must independently decide which practice/reference modes are available.
Neither state proves faithful sound, full synthesis, notation acceptance, scoring
acceptance or a particular device's available pitch range.

`inventory` is null only when the raw source parser fails. Otherwise it describes
every source track, including conductor and controller-only tracks, every channel
route and every source event count; it never filters to an instrument's range.
Its totals are `source_tracks`, `source_events`, `ppq`, `key_attacks` and
`key_releases`. `tracks` contains `source_index`, `track_id`, `name`,
`source_event_count`, `channels`, `key_attacks`, `key_releases`, `first_event_id`,
`last_event_id` and exact rational `end`. Each channel has `channel`,
`source_event_count`, `key_attacks`, `key_releases`. `parts` contains the chosen
profile's `id`, `track_id`, `channel`, `notation_available`; rejected conversions
have no derived parts. All source indexes/channels are zero-based. Track names
are bounded display summaries; complete authored text remains in the score.
The exact source hash and per-track event counts define all source event IDs
(`midi:<hash>:t<track>:e<event>`); score events retain their individual original
coordinates and exact rational clock, and typed events retain the full stable ID.

Each diagnostic has `code`, `message`, `source_event_id`, `track_index`, `action`.
The two nullable location fields are populated when the shared parser/converter
can attribute the failure to a source event; global semantic holds never guess a
track. Parser diagnostics use a fixed bounded vocabulary; conversion adds at most
the strict hold and the complete-profile rejection. No raw payload is embedded.

Successful `package` contains exactly `metadata_json` and `score_json` strings.
Consumers must preserve their UTF-8 bytes unchanged. Metadata uses the existing
closed schema and exact score byte length/hash, source evidence and unverified
user-supplied rights. IDs use `midi-clean-<full original SHA-256>`; titles do not
change source identity, but do change the content fingerprint. No filename,
original MIDI, Base64 source, audit, inventory or derived runtime is a clean file.

`draft_sha256` binds the exact metadata and score bytes: SHA-256 of the UTF-8
domain `worldmusichub-clean-draft-v1` followed by one NUL byte, then for metadata
and score in that order, an eight-byte big-endian byte length and those bytes.
It binds reviewed content, not authorization, authenticity or source rights.

## Generate the complete ZIP

`POST /api/clean-song/draft/pack` takes the same three fields plus the reviewed
`expected_draft_sha256`. Rust regenerates the whole draft with the same validators
and requires an exact fingerprint match; a changed source/title produces HTTP 409
with code `clean_draft_changed` and no ZIP. An unsupported source returns the
same rejected draft as above.

Success is JSON `{ "draft_sha256": "...", "filename": "...zip",
"zip_base64": "..." }`. Both endpoints enforce a complete encoded-response
limit of 16 MiB, returning HTTP 413 and no partial payload if exceeded. ZIP
generation uses the same writer as native clean-library export, preserving its
entry ordering, DEFLATE options and 128 MiB compressed, 2 GiB expanded and 4096
entry bounds. The result has `manifest.json` and one folder containing only the
exact `metadata.json` and `score.json`; this initial draft has no media.

For persistence, decode the ZIP unchanged and use the existing native
`/api/library/import/preview` then explicit `/api/library/import/commit` path.
Its authoritative package validator and atomic primary/backup storage remain the
storage boundary. Preview is not saving. Hosted callers can download the ZIP;
they must not claim a persistent native save. Keep original inputs separately
and never delete them because conversion succeeded. Close/title/source changes
must invalidate stale UI work and prevent older callbacks from saving a draft.
