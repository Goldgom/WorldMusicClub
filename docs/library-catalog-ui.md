# Recoverable song management UI

The existing native management dialog offers **Remove and restore songs** only
when health advertises `library_catalog_version: 1`. Its catalog v1 adapter is
separate from query v1: existing imported groups and duplicate evidence keep their
strict `import-*` identities. Catalog references explicitly show both collection
and imported-group IDs. No browser-store fallback or pack mutation is exposed.

Opening the panel reads status. A never-managed library needs a separately
reviewed initialization with exact native operation ID, inventory/seed digests,
counts and retained-byte disclosure. Canceling any preview sends no write.
New imported editions are visible but unselectable until **Review new imports for
management** previews and explicitly commits the verified native inventory delta.
Sync preserves existing tombstones and removed memberships.

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
