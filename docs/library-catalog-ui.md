# Recoverable song management UI

The existing native management dialog offers **Manage user packs and Trash** only
when health advertises `library_catalog_version: 1`. Its catalog v1 adapter is
separate from query v1: existing imported groups and duplicate evidence keep their
strict `import-*` identities. Catalog references carry a typed kind, collection ID and nullable imported-group
ID. Custom packs never use fabricated import IDs. No browser-store fallback is
exposed. The create/rename/add controls additionally require the corresponding
explicit native supported_operations capabilities. Unfiltered query requests omit
the new optional collection_id field, preserving old-host v1 request compatibility.

The user-pack view lists imported and custom packs, including empty custom packs.
Only custom packs are rename/add destinations; source groups remain read-only.
Filtering opens exact active members, with separate active, available and shared
counts. Missing payloads remain counted but unselectable. Every combined read
checks the library, generation, digest and snapshot across all pack pages before
enabling controls; partial or inconsistent reads clear actionable rows.

Create, rename and add each require their own preview and explicit confirmation.
Creation and later addition are separate transactions, so cancelling addition can
leave an empty pack. The preview names the exact target, including all-noop adds,
and distinguishes changed names, new memberships and already-present memberships.
A 256 UTF-8 byte name bound is enforced by the host and adapter. Changing a name
or target cancels an earlier preview. Selected export uses the existing separate
legacy-score and clean-song formats, preserving their original scope. No move,
unlink, pack Trash, cascade, permanent deletion or historical Undo is exposed.

Opening the panel reads status. A never-managed library needs a separately
reviewed initialization with exact native operation ID, inventory/seed digests,
counts and retained-byte disclosure. Canceling any preview sends no write.
New imported editions are visible but unselectable until **Review new imports for
management** previews and explicitly commits the verified native inventory delta.
Sync preserves existing tombstones and removed memberships. Native previews bound
each batch; any remaining edition/source counts are displayed in both languages.
Each later batch needs its own new review and explicit confirmation.

Song selection uses the complete `legacy:song-*` or `clean:song-*` edition ID,
including hidden selected rows across pages. Search, view changes, refresh and
invalidation clear selection. New rows never join an earlier selection. The
frozen preview lists every exact title/ID, selected/changed counts, removed and
restored memberships, shared editions, every affected pack and retained payload
and source bytes. It always discloses zero reclaimed bytes. Restore selects songs
from one original removal operation; other groups remain disabled until selection
is cleared. Missing retained payloads stay unselectable.

## Write ownership and recovery

Before either initialization or a transition is sent, the renderer writes and
reads back a bounded local recovery record containing the exact native preview,
operation ID and native library ID. Storage errors prevent submission. The record
is a recovery pointer, not proof of a native commit. One latest record per library
is retained, up to 16 libraries and 512 KiB total. Only confirmed terminal records
may be displaced at capacity; pending records are never silently evicted.

After submission, closing the panel/dialog or page does not abort the native
write. The same operation's late result remains owned and persisted. A transport,
parse, foreign-origin, mismatched-identity or outcome-less admission error is
uncertain. It cannot generate a replacement ID, silently retry or claim failure.
Reopen/restart reads the same per-library record and calls operation lookup.
Errors are not proof of absence. A verified receipt proves saved effects, even if
metadata refresh subsequently fails. An uncommitted lookup enables an explicit
same-preview retry only while the original generation/digest remains current.
After proven absence, the user may explicitly finish that failed review and make
a fresh selection; ambiguous work cannot be dismissed this way.

Read previews and exports have a different lifetime. Closing, navigation,
invalidation and newer reads cancel their renderer ownership and discard late
responses. They cannot resurrect a dismissed preview or download an old export.

## Session boundaries

The app callback only rescans saved inventory. It does not replace the storage
adapter, revoke admitted media, select a different song, reload current content,
start transport, replace practice takes, or touch free-recording storage. Pending
assessment retains its original pass and may complete normally after removal.
Visible list changes do not reactivate a trashed song or select another song.
Saving a still-admitted legacy score in Trash returns `catalog_in_trash` without
a duplicate entry, so it cannot reappear in the active saved-song list. Explicit
restore makes the same save a normal duplicate again. ZIP reimports continue to
record physical duplicate receipts while preserving the original Trash state.

The current native Basic complete song requires later pages from the saved source.
Its exact clean edition remains selectable for membership addition and export,
but its global Trash action is blocked while it is loaded for
Listen, Practice or inspection, including while paused in the library. Ownership
matches the actual storage adapter that admitted the object and its complete
storage-qualified key, not the title or score ID. Choose and explicitly open
another song before reviewing this edition for Trash. This guard never switches
songs, stops audio or clears takes. Legacy current-song behavior and selected
restore stay unchanged. A stale selection/preview is checked again before native
submission and before a proven-absent retry; no item is silently dropped from a
frozen operation.

A saved browsing preview can become stale through another native process.
Inventory refresh marks a missing candidate unavailable without replacing the
admitted session. New Start or Open-score actions also recheck the exact native
edition before compilation/admission. Returning to an existing session does not
reload or clear it. External removal can still make a later native page fail;
the UI reports that failure and never bypasses the native Trash check. The new
admission check deliberately uses the existing full native load endpoint, so
large complete songs may add startup work; no cheaper disposition endpoint or
new cache semantics are introduced.

## Development checks

`npm run test:library-management` includes the catalog adapter, operation-store,
model and actual-app-DOM tests. Original in-memory libraries cover first-use
review/cancel/error, mixed formats/shared packs, exact preview/stale conflicts,
late reads, lost responses, wrong-operation errors, close/reopen and restart
reconciliation, same-ID retry, selected restore, explicit sync, bilingual copy,
paused sessions, legitimate pending assessment and already admitted media.

These Node checks are development evidence. They do not launch a browser, HTTP
server, native GUI or access a private user library. Exact-source Rust/native,
real-browser, Windows and full checkpoint acceptance remain separate gates.

## Actual native wire evidence

`tests/fixtures/library-catalog/native-responses.json` preserves 24 exact native
request/response records and named snapshots from the backend's original-fixture
integration test. The adjacent source-hash manifest records the producing files
and artifact SHA-256. `native-library-catalog-wire.test.js` verifies that hash,
passes all recorded responses unchanged through the production adapter, and runs
the real app DOM through initialization, mixed-format/shared-pack Trash, a lost
response, app restart with same-ID reconciliation, selected restore, and sync.
All mutating request objects must exactly match the recorded native request.
Only documented defaults are expanded for read queries.

The restore response is a native same-ID replay after a real subprocess restore
in the producer test. DOM transport replays those actual outputs; it does not
launch a native executable or independently prove process recovery. The original
backend restart tests and renderer replay tests are distinct evidence layers.

## Live socket-free native integration

`npm run test:library-catalog-native` runs the production app modules in the Node
DOM fixture against a freshly built `native_import_driver`. Every API reply comes
from the real Rust dispatcher over bounded stdin/stdout. It creates a fresh owned
temporary library, uses only original legacy/clean/media fixtures, checks an
outside sentinel, and removes that fixture library afterward.

```sh
cargo build -p worldmusichub-desktop --example native_import_driver --locked
WMH_NATIVE_IMPORT_DRIVER=/absolute/target/debug/examples/native_import_driver \
WMH_CATALOG_REPORT=/absolute/output/catalog-native.json \
npm run test:library-catalog-native
```

The check covers initialization review/cancel/confirm, exact mixed selection with
shared memberships, a transport failure after actual durable Trash, a fresh Rust
process and renderer recovering the original operation ID, selected restoration,
and explicit adoption after a new import. A separate failure before native
dispatch proves the uncommitted lookup and explicit retry of the identical saved
preview. Exact reimports stay deduplicated and cannot escape Trash. Hashes verify
all pre-existing source/payload/backup/history/media files; the production media
adapter can still read a previously admitted asset after the song is trashed.
The current lobby identity and mocked audio remain untouched. A second process
restart checks the final state and retained files. Reports include source and
driver hashes, fixture hashes, and actual catalog request/response records.

This check exercises a Node DOM and mocked audio, not a rendered browser or a
native window. It does not prove physical playback, Windows packaging or crash
durability on Windows. Full workspace/all-targets and browser/Windows release
acceptance remain required before promotion. Product scope and capacity limits
remain those in [catalog-product.md](catalog-product.md) and
[catalog-transition-core.md](catalog-transition-core.md).

## Current Basic session regression

`npm run test:current-basic-catalog-native` uses the existing authored Basic MIDI
package and an original legacy pack in a fresh owned temporary library. Supply
`WMH_NATIVE_IMPORT_DRIVER`, its actual `WMH_CATALOG_DRIVER_BUILD_SHA`, and optional
`WMH_CURRENT_BASIC_REPORT`. The real Rust dispatcher, production adapter and app
DOM exercise paused practice, safe selection with disabled global Trash, a later
successful native page, explicit switching to another song, Trash/restore, and
normal practice/preview part changes, custom display meter and source/rendition
view changes retaining the same protection, plus separate native processes
removing a preview before Start and before rescan.
Retained physical file hashes and serialized current takes are checked. Node
audio/DOM fixtures do not establish physical audio, browser or Windows acceptance.

For the later actual-window check, import the ORIGINAL
`basic-key-original.zip`, start Practice, pause, choose a two-measure notation
window, then use **曲库 → 曲包与查重 → 移入回收站与恢复**. The current edition must
remain selectable for Add/export while the global Trash button is disabled, with
the explanation to open another song before Trash. Close the dialog, use
**返回演奏**, and advance to a new page. After explicitly opening another song,
the first edition may be selected for a fresh reviewed Trash operation. Retain
the original take export and source hashes; do not use a real user library.

## User-pack native development check

`node scripts/check-user-pack-catalog-native.mjs` uses the same exact-source
`WMH_NATIVE_IMPORT_DRIVER` and optional `WMH_USER_PACK_REPORT` output path. It
checks cancelled creation, visible empty packs, rename, exact mixed-edition add,
a lost reply after real commit, fresh-process operation reconciliation, duplicate
add noops, filtered selected exports, partial pack-list failure and unchanged
original/source/backup/media hashes. It also compares the admitted score and
serialized takes before and after organization in the same process. This remains
Node DOM development evidence; actual hosted and Windows acceptance is separate.
