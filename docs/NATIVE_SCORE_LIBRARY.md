# Native score library contract, version 1

The Windows desktop host now exposes an explicit native filesystem library at
`%LOCALAPPDATA%\WorldMusicHub\Scores`. This is separate from the existing browser
IndexedDB library. A successfully validated and activated explicit source import now requests one
automatic save of the complete accepted source. Catalog browsing, saved-score
preview/start, transposition, adaptation, tempo edits and unsubmitted editor
drafts never trigger automatic saves. Settings also offers an explicit
“Save current complete score” action. Listing also recovers a
missing primary folder when its complete verified backup is available.

The Rust module has portable application-data defaults for future native hosts
(`~/Library/Application Support/WorldMusicHub/Scores` on macOS,
`$XDG_DATA_HOME/WorldMusicHub/Scores` or `~/.local/share/WorldMusicHub/Scores` on
Linux). The current graphical native host is Windows only. Failure to resolve
an absolute application-data directory is visible; there is no fallback to the
current directory, installation directory, browser profile or a temporary folder.

## Folder contract

```text
Scores/
  .library.lock
  .staging/<native-generated-stage>/
  songs/song-<64 lowercase SHA-256 digits>/
    metadata.json
    score.json
    source.payload             # only when canonical score.source is present
  backups/song-<same digest>/
    metadata.json
    score.json
    source.payload
```

`score.json` is the exact UTF-8 canonical JSON supplied by the caller, including
whitespace and the complete retained source. Rust parses and compiles it using
the existing `score-core::Score` engine before saving; unknown fields and
unsupported score/schema versions fail instead of being stripped. Persistence
does not introduce another notation format, change notes, re-quantize rational
time, trim voices or copy a practice projection over the original.

`source.payload` is an exact UTF-8 byte copy of `score.source.content`. Binary
assets remain encoded exactly as they already are in the canonical source
envelope. Unknown envelopes are retained intact. No external source URL is
downloaded, no archive member is extracted, and no skin, script or executable is
run. The source's supplied filename is metadata only, even if it contains path
separators or an executable extension. Provenance and asset-license claims are
preserved; storage does not verify rights or authenticity.

Metadata version and immutable archive revision are both 1. Metadata records
the exact score byte count/SHA-256, retained-source byte count/SHA-256, supplied
source filename/format, title, composer, score id, label, provenance and save
time. `content_sha256` hashes the engine's deterministic serialization of the
validated canonical score. This treats whitespace/key-order-only variations as
duplicates while retaining the first saved JSON bytes. The complete source,
provenance and all canonical metadata participate in content identity.

## Native protocol endpoints

These routes exist only on the bounded native `wmh` protocol. The HTTP practice
server remains stateless and does not gain filesystem access. The stateless
desktop dispatch entry point returns `library_unavailable`; the Windows host
supplies the native library only for these routes. The usual same-origin,
main-webview, admission and queue limits apply. No body accepts a path or chooses
a storage directory. Unknown request fields are rejected.

| Method and route | Request | Successful response |
| --- | --- | --- |
| `GET /api/library/list` | Empty body | `{storage:"native-filesystem", library_format_version:1, directory, entries:[Entry], issues:[Issue]}` |
| `POST /api/library/save` | `{score_json:string, label?:string, allow_conflicting_id?:boolean}` | `Entry` |
| `POST /api/library/load` | `{key:string}` | `{entry:Entry, score_json:string}` |
| `POST /api/library/export` | `{key:string}` | `{format:"worldmusichub-native-score-backup", version:1, entry:Entry, score_json:string}` |

All successful responses use status 200. POST requires `application/json`;
an optional MIME parameter is accepted. The save body deliberately contains a
JSON string rather than an engine result so its complete bytes can be preserved.
The entire encoded request must fit the existing 8 MiB native transport limit,
including escaping. Canonical JSON is also capped at 8 MiB. A large source that
fits an import cap may therefore be too large to save through this endpoint;
failure is explicit and no attachment is discarded.

`Entry.key` is `song-` followed by exactly 64 lowercase hexadecimal digits. A
library is limited to 100 songs and 32 MiB of canonical JSON; independent backup
and source copies require additional disk space, up to roughly four times the
canonical budget. Directory scans stop at 256 children per area. Metadata files
are capped at 64 KiB, individual source payloads at 8 MiB, and encoded responses
at 32 MiB. Labels must contain 1–1024 UTF-8 bytes.

There is no replacement/delete endpoint in v1. Identical content returns a
duplicate warning with the existing entry. Different content sharing a score id
returns an id-conflict warning. After an explicit user choice, the caller may
retry with `allow_conflicting_id:true`; this preserves both distinct folders and
does not overwrite either. It does not bypass identical-content duplicates.

An exported backup contains the entire canonical JSON and provenance. Restore
to a library by explicitly passing its `score_json` through the same save route;
normal validation, duplication and capacity checks still apply. The response is
backup data, not a claim that the browser completed a download. Bulk backup,
bulk restore and automatic migration from IndexedDB are separate UI work.

## Write ordering and recovery

1. Validate the full canonical score and acquire an OS file lock. Other instances
   receive `library_busy`; process termination releases the OS lock automatically
2. Rebuild inventory from published folders, detecting duplicates/conflicts
3. Write complete primary and backup stages using exclusive file creation; sync
   every file. Metadata is written last
4. Atomically rename the backup stage into `backups/<key>`, then the primary
   stage into `songs/<key>`. Existing destinations are never intentionally replaced
5. Return success only after both publications finish

Unix builds also sync the stage and destination directories. Windows does not
have a portable directory flush in this implementation: complete files are
synced, but this is process-interruption recovery, not a guarantee against sudden
power loss, device failure or filesystem failure. The same-disk backup protects
against an interrupted save or missing primary folder, not loss of that disk.
An independently exported copy is still valuable.

There is no authoritative index file. Each list validates bounded metadata,
canonical bytes, content identity and retained-source checksums from the song
folders. A complete backup with a missing primary is re-staged and recovered;
the response reports `library_recovered_backup`. A damaged existing primary,
unsupported archive, linked path, invalid backup or missing backup is reported
in `issues`. Damaged originals are preserved and are never silently replaced.
Incomplete stages remain excluded and are reported; they are not auto-deleted.

Failure after backup publication can leave a recoverable committed backup.
`library_commit_uncertain` explicitly tells the caller to refresh and confirm
the inventory before claiming failure or retrying a save. A later list may
complete recovery. Other valid entries remain available when one entry is bad.

Path checks reject symlinks and Windows reparse points in library directories
and files. Names are fixed or derived from validated hashes. These checks and
the OS lock protect against renderer path injection and accidental cooperative
concurrent writes. They do not claim to defeat a malicious local process racing
filesystem operations with the same OS account's permissions.

## Stable failures and list issues

Errors have `{code,error,existing?}`; `existing` is present for duplicate/id
conflicts. No successful response is returned for a failed write.

| HTTP status | Error codes |
| --- | --- |
| 400 | `library_invalid_request`, `library_invalid_score`, `library_invalid_label`, `library_invalid_key`, `library_unsafe_path` (invalid host-supplied root) |
| 403 | `forbidden_origin` |
| 404 | `library_not_found`, `library_unknown_route` |
| 405 | `library_method_not_allowed`, `method_not_allowed` |
| 409 | `library_duplicate`, `library_id_conflict`, `library_path_conflict` |
| 413 | `library_request_limit`, `library_score_limit`, `library_capacity`, `library_directory_limit`, `library_response_limit` |
| 415 | `unsupported_content_type` |
| 422 | `library_corrupt_entry`, `library_unsupported_version`, `library_unsafe_path` (on-disk path) |
| 500 | `library_io`, `library_clock`, `library_commit_uncertain`, `engine_operation_failed` |
| 503 | `library_unavailable`, `library_directory_unavailable`, `library_busy`, `library_stage_conflict`, `engine_busy` |

List `issues` have `{key:null|string, code, message}`. In addition to entry
validation failures above, issue codes are `library_unrecognized_entry`,
`library_unrecognized_backup`, `library_backup_invalid`,
`library_backup_missing`, `library_recovered_backup`, `library_recovery_failed`
and `library_incomplete_stages`. The UI must display issues rather than silently
presenting an empty library as if every saved song had disappeared.

## Verification and integration boundary

`crates/desktop-shell/tests/native_library.rs` uses only original authored
fixtures and test-owned temporary directories. It checks exact JSON and source
bytes, rational timing preservation, a separate-process restart, complete
source-envelope export/restore, duplicates/conflicts, directory reconstruction,
interrupted publication recovery, corrupted primary/backup handling, count and
payload limits, OS lock contention, visible storage failures, protocol path and
origin rejection, and Unix symlink/dangling-link rejection.

The app integration is now connected: startup inventories the selected backend,
explicit successful imports persist once, saved entries join the left song list
by their independent storage key, and loaded entries use the existing isolated
preview/audition path. Settings displays the actual path, current-score save,
rescan, backup, conflicts, failures and original technical details. A lobby
status also reports unreadable inventory. Raw canonical JSON file imports retain
the original JSON text when submitted to the native API; importer-produced
canonical scores keep their complete source envelopes.

The older browser archive remains explicitly labeled and is never automatically
migrated or cleared. Native failures do not fall back to it. A save failure does
not undo the usable score or reset the active take. A lost commit response stays
uncertain until an inventory check or duplicate-safe explicit retry resolves it.

The existing process-owned `WMH_DESKTOP_SMOKE_DIR` now places any native library
used by a smoke run under `<evidence>/score-library`; normal runs still use OS
application data. This does not expose a path argument to the renderer and does
not change the acceptance harness itself.

Directory choosing/open-folder controls remain disabled pending proper OS
integration. A future directory change must leave the old directory intact.
Linux direct-function/temporary-directory tests and Node DOM tests are not
Windows WebView acceptance. Real Windows folder behavior, visual layout and
package restart validation remain required before claiming the user's native
installation is accepted. See [frontend integration and hosted regression](NATIVE_SCORE_STORAGE_FRONTEND.md).
