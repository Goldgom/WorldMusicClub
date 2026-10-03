# Song folders and bulk import, version 1

The native desktop app accepts one or several standard score files, existing
`worldmusichub-library-backup` version 1 JSON backups, native score backups, and
ordinary ZIP song packs. A ZIP is selected directly: users do not need to choose
an inner JSON file. The browser/loopback app still has its existing browser
library and backup workflow; these filesystem pack routes are native-only.

A song remains the existing Rust `Score`, with its existing `version` and schema
revision. This document defines its container, not another notation or playback
format. Import does not relax MIDI, canonical validation, performance, or timing
guards. Raw event JSON is archival data, never a substitute for a validated Score.

## Unified folder layout

```text
manifest.json
songs/<song-folder>/metadata.json
songs/<song-folder>/score.json
songs/<song-folder>/source/original.mid       (optional)
songs/<song-folder>/media/cover.png           (optional)
songs/<song-folder>/media/background.jpg      (optional)
songs/<song-folder>/media/pv.mp4              (optional)
```

ZIP the contents of this folder, or include a single enclosing directory. Song
folder names are relative logical identifiers; they never become native storage
paths. Folder selection is not yet exposed by the app picker.

`manifest.json`:

```json
{"format":"worldmusichub-song-pack","version":1,"songs":[{"folder":"songs/example"}]}
```

`metadata.json`:

```json
{
  "format":"worldmusichub-song",
  "version":1,
  "title":"Original exercise",
  "label":"My edition",
  "score":"score.json",
  "sources":[{"path":"source/original.mid","bytes":123,"sha256":"<64 lowercase hex>"}],
  "media":{"cover":"media/cover.png","background":"media/background.jpg","pv":"media/pv.mp4"}
}
```

`score.json` is the complete existing canonical Score JSON. The importer preserves
its exact UTF-8 bytes, validates it in Rust, and preserves any canonical source
payload. Title/ID/provenance for a playable item come from that validated Score;
folder metadata cannot change the music. `score: null` describes a retained,
nonplayable source-only item. Sources and media are optional; supplied paths must
resolve inside that song folder. Supplied source sizes and SHA-256 hashes must
match. A mismatch blocks playability and is reported while retaining the original.
Media keys are `cover`, `background`, `pv`, or `audio`; null means absent. Media is
retained as inert original data, not executed or automatically played.

Archives without a pack manifest can contain these song folders directly. The
importer also recognizes the previously delivered
`private-complete-midi-source-folder` metadata, canonical `*.wmhscore.json`, and
compatible JSON backups. Legacy source folders without a canonical score remain
visible, retained and nonplayable, including their truthful original diagnostic.
Generic ZIPs can contain MIDI, MusicXML, MXL, jianpu and canonical JSON inputs.
Duplicate canonical content is reported rather than saved twice. A separately
convertible source with the same base filename as a canonical file is an explicit
alternate-source conflict; filename similarity does not prove equivalence. Select
that row and explicitly keep both to save its independently validated edition. Nested ZIPs and
unrecognized audit/event JSON remain in the retained original; they are not
recursively interpreted. The report contains a complete file inventory with byte
counts and hashes. A root `META-INF/container.xml` identifies an MXL and invokes
the existing strict MXL importer; mixing it with song metadata is rejected as
ambiguous. Renaming an arbitrary ZIP to MXL does not grant different permissions.

## Protocol and review

- `POST /api/library/import/preview`: raw file bytes; validates without retaining
  or saving anything
- `POST /api/library/import/commit`: same raw bytes; retains the original, then
  saves each valid canonical song atomically with its independent native backup
- `GET /api/library/imports`: retained-original history and last receipt per source;
  at most ten rows per page, followed by `?cursor=<next_cursor>` when supplied
- `POST /api/library/import/report`: JSON `{"archive_key":"pack-<sha256>"}`;
  retrieves the complete latest receipt including the full hashed file inventory
- `POST /api/library/import/export`: JSON `{"archive_key":"pack-<sha256>"}`;
  downloads exact original bytes, including all source files and media
- `POST /api/library/pack/export`: JSON `{"keys":["song-<sha256>"]}`;
  creates a unified version 1 ZIP from selected canonical native records, retaining
  exact score JSON and labels. Embedded canonical source payloads stay in that JSON

The Windows host dispatches pack work with its existing asynchronous responder
and blocking-worker pool, outside the native UI thread. A separate one-request
pack permit prevents large request bodies from queueing; a second compute slot
remains available for ordinary API work and assets bypass the queue. Real Windows
large-import responsiveness must still be verified in hosted native acceptance.

Raw import requests use `x-wmh-filename: encodeURIComponent(filename)`.
`x-wmh-conflict` is `skip` by default or explicit `keep-both`.
Optional `x-wmh-item-index` selects a single zero-based report row to save.
The whole source is retained even when only one row is selected. An unselected
valid row remains ready. Do not abort or claim cancellation after commit is sent;
wait for its result, then cancel between files. A lost response means persistence
is unknown: refresh inventory/history before retrying. Retry is safe through
content deduplication and does not overwrite existing editions.

The version 1 report has `source`, `inventory`, `items`, `summary`, and `warnings`.
Source fields are `filename`, `bytes`, `sha256`, `archive_key`, and `retained`.
Each item has `index`, `path`, `title`, `status`, `code`, `message`, and `playable`.
`entry` is the existing native Entry for saved or already-saved content.
Statuses are `ready`, `saved`, `duplicate`, `conflict`, `retained_nonplayable`, or
`error`; all six counts plus `total` appear in the summary. In preview,
`retained_nonplayable` is a classification, not a persistence claim: always check
`source.retained`. A source-only item never gets a Score key or an open/play action.
Conflicts do not overwrite. Explicit keep-both saves a distinct immutable edition.

The history response is
`{format:"worldmusichub-import-history",version:1,imports:[...],issues:[...],next_cursor:null}`.
Each import has `archive_key`, `filename`, `bytes`, `sha256`, and `report` (null if
interrupted before receipt publication). History omits `report.inventory.files`
and adds an `inventory_files` count; use the report endpoint for the complete list.
Each page targets a 16 MiB budget (one larger bounded row can occupy a page).
Canonical song saves can finish before
the final receipt; `library_commit_uncertain` means refresh before retrying.

## Bounds and native retention

Only the two raw pack routes allow a 128 MiB body. ZIPs allow 4,096 entries,
64 MiB per expanded file, and 2 GiB expanded in total. The central-directory limits
are checked before ZIP-library allocation. Every file then passes a streamed
64 KiB-buffer size, CRC and SHA-256 check before any save. The importer never
holds the whole expanded archive in memory or extracts user-controlled paths.
Only selected bounded score/metadata candidates are decoded. At most 1,024 song
rows and 128 MiB aggregate canonical JSON can be planned per import.

Canonical scores and ordinary score imports remain limited to 8 MiB. Existing
JSON backup inputs allow 40 MiB; this does not raise the individual score limit.
Song metadata parsing allows 256 KiB per file and 8 MiB aggregate across at most
1,025 descriptors. Reserved malformed metadata never falls through to plain-score
import. A future pack version is preserved as a nonplayable original. Standard ZIP stored/DEFLATE entries are
supported; encrypted, split/central-ZIP64, overlapping, unsafe, case-ambiguous, symlink and
special-file archives are rejected before any save. UnicodePath and ZIP64 extra
fields cannot override the preflight inventory. Bounded 16-byte local ZIP64 size
placeholders used by streaming ZIP writers are accepted only when both sizes
exactly match the ordinary central directory; no central override or ZIP64 offset
is accepted. Parsed counts and actual expansion
are checked again. Malformed or unsupported
bounded score sources in a valid container remain retained and nonplayable.

Native canonical storage allows 1,024 songs and 256 MiB canonical JSON, with
4,096 children per native storage area. Browser library/compatible browser-backup
limits remain unchanged at 100 scores; use unified ZIP export for larger native
selections. Unified export is capped at 128 MiB canonical payload and ZIP bytes.

`imports/pack-<sha256>/source.bin` stores the exact input. `source.json` records
identity and `inventory.json` records every expanded file. Independent copies live
under `import-backups/`; staging happens under `.import-staging/`. All names are
generated by the native host. Receipts are append-only, atomically published JSON.
Retention is bounded to 128 originals and 1 GiB compressed originals, plus their
independent backups. Each source directory allows 1,024 children, including its
source files and at most 1,020 receipts; a receipt is at most 32 MiB, with a conservative report budget checked before
any save. All retention files, including backup copies, receipts and interrupted
stages, share a 3 GiB aggregate cap. Staging scans are limited to 256 folders and
leftovers appear as history issues. Capacity is reserved for receipts before song
saves and checked again for publication. Existing files
are never silently removed to fit. Corruption is reported, never overwritten;
export checks the full original hash. Reimport restores a missing primary from
the same verified original while preserving a damaged primary for inspection.

## Verification

`cargo test -p worldmusichub-desktop --test song_pack` uses only original synthetic
content, covering legacy structures, mixed outcomes, selected commits, exact
retention/export/restart, source/media checks, limits, CRC and unsafe ZIPs.
`native_import_driver` is a socket-free stdin/stdout protocol harness for the same
native adapter. Its storage root is an explicit process argument, never renderer
input. Private delivery validation must remain outside repository fixtures and
published hosted test data.

Machine-readable container schemas: `schema/worldmusichub-song-folder-v1.schema.json`
and `schema/worldmusichub-song-pack-v1.schema.json`. They accompany the existing
canonical `schema/worldmusichub-score-v1.schema.json`; Rust remains authoritative
for semantic and byte-level validation.
