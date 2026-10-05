# Native pack grouping and duplicate review

`POST /api/library/manage/query` remains a read-only metadata projection of
immutable physical editions and retained import evidence. The separate
[catalog product API](catalog-product.md) now handles explicit initialization,
selected-song Trash/restore and synchronization; query v1 itself performs no
catalog transitions and keeps its original `import-*` wire identities.

Before initialization, validated receipts project imported memberships as before.
After initialization, active catalog edges govern the returned song memberships;
source archives map those edges back to import IDs. Trashed editions are excluded,
and a new physical edition awaiting explicit synchronization remains active and
unfiled with a `catalog_unmanaged_entry` issue. Re-reading receipts cannot resurrect
removed memberships. Source-only and unresolved evidence remains in Issues.

The native health response advertises `library_management_query_version: 1`.
Requests require the existing same-origin native protocol and JSON content type.
The route joins the existing native large-operation admission queue. The complete
request/response contract and row examples are in
[`library-management-query-contract.json`](library-management-query-contract.json).

## Identity and evidence

- An edition is `legacy:<song key>` or `clean:<song key>`. Its content digest keeps
  the existing format-specific meaning. Names, labels, source paths, and score IDs
  never become filesystem paths or edition identities.
- One imported group is `import-<validated retained archive SHA-256>`. Same-byte
  imports with renamed input files reuse the original descriptor's display name.
  Archive identities are distinct from song identities and editable collections.
- A group edge requires a `saved` or `duplicate` item in a committed V1 receipt
  whose full archived Entry matches a currently verified physical edition.
  `conflict.entry`, `ready`, `error` and `retained_nonplayable` never create edges.
  A valid stored clean performance/VSQ edition can have `playable: false` in its
  import receipt; it still belongs to its group and retains its profile label.
- Every recognized complete receipt in both copies participates. Independent
  identical copies count once. A single complete copy is usable with an explicit
  issue; disagreeing copies or invalid metadata do not contribute. Saved retries
  are unioned, so a later partial receipt cannot erase an earlier successful edge.
- `receipt_reference_count` counts accepted historical receipt items.
  `source_reference_count` deduplicates `(archive identity, logical source item,
  edition)`. Standalone and MXL inputs each have one logical item, independent of
  upload filename; a standalone library-backup item uses its original entry index.
  ZIP members use exact inner paths, and nested library-backup entries add their
  verified entry index. Real distinct ZIP paths are never collapsed by title.
  Renaming or retrying the same uploaded bytes does not manufacture duplicates.
- V1 receipts are unsigned historical evidence. `validated_receipts` means bounded
  schema/identity/path checks against verified songs and retained-source bytes;
  it is not cryptographic attestation of authorship or import history.
- Missing/invalid receipts, conflicting references and damaged originals produce
  Issues and leave unmatched songs Unfiled. A backup-only original appears as an
  unresolved source group; no primary source is silently recreated. No original,
  source backup, receipt or music payload is rewritten by this projection.
- Import receipts follow the actual importer grammar. ZIP paths may contain
  Unicode, spaces and more than eight components while retaining traversal,
  absolute-path, backslash, drive-letter, control-character and length checks.
  Standalone filenames are inert 1–1024-byte upload labels, not paths. A backup's
  virtual `#entries/N` must name a real entry in its retained backup envelope.
  MXL receipts may identify the uploaded container instead of an inner member.
  Clean-package asset path rules are unchanged. No input is reconverted to infer
  what a historical importer saved.
- Every unlinked source-only item produces an Issue with the latest bounded
  original diagnostic code and message plus its displayed item path. It remains
  absent from song memberships. Later error/conflict/source-only diagnostics also
  remain visible when an older successful receipt proves an existing membership;
  they do not erase that link. A routine duplicate or unselected ready retry does
  not manufacture a failure. Diagnostic codes are limited to 256 bytes and
  messages to 8192 bytes; out-of-bounds receipts are rejected, not clipped silently.

Duplicate categories are independent review hints and can overlap:

| Kind | Evidence | Meaning |
| --- | --- | --- |
| `exact_content` | `shared_edition` | One stored edition referenced by several imported groups |
| `exact_content` | `repeated_source_item` | One stored edition referenced by several distinct items in a source |
| `exact_content` | `multiple_editions` | More than one edition with the same format-qualified content identity |
| `same_id` | `distinct_editions` | Different immutable editions with an identical score ID |
| `same_title` | `distinct_editions` | Different editions with a Unicode-lowercased, whitespace-collapsed title |

Title comparison is deliberately conservative: no NFC/NFKC normalization, accent
removal, locale collation or fuzzy/audio matching is claimed. Similar-title groups
never imply equivalence. Shared or repeated references do not imply redundant disk
copies or reclaimable bytes. No query result authorizes or performs a merge.

## Snapshot freshness, bounds and recovery

The first query or `refresh: true` acquires the existing library lock once and
calls already-locked helpers. It runs the unchanged authoritative song scan,
verifies retained-source hashes, and reads all receipts. The scan retains its
existing behavior of recovering a missing primary song from its verified backup;
there are no new explicit catalog/song mutations. Recovery issues remain visible.
There is no nested public `list`, `load`, or history call under that lock.

All later queries first verify the managed journal head under the native gate,
then share advisory metadata across handles for that root when its manifest is
unchanged, without opening or hashing music assets or retained originals. Freshness explicitly says
`advisory_snapshot`, `song_integrity: verified_at_snapshot`,
`change_detection: explicit_refresh`, and includes the verification timestamp.
Refresh after imports or external changes. The authoritative list/load/export
paths continue to revalidate payloads; cached metadata never makes a damaged song
loadable. A failed refresh discards the old cache instead of serving it as fresh.
This slice does not implement a filesystem watcher or automatic expiry.

A stable SHA-256 of the ordered projection binds cursors to the snapshot, exact
filters and requested limit. Different filters reject the cursor with 400;
a changed snapshot rejects it with 409 `library_snapshot_stale`. Restarting with
identical evidence yields the same snapshot. No process-global filesystem path or
payload is returned in query rows.

Bounds fail closed without changing the library or publishing a partial snapshot:

- 4 KiB request, 256 UTF-8 byte search, page limit 1–100 (default 40)
- 128 retained archive identities; existing 1024-file per-archive bounds
- 1024 verified editions; 16,384 memberships/logical source references
- 32 MiB maximum receipt; 128 MiB aggregate receipt, retained-inventory and ZIP backup-envelope metadata reads, including both receipt copies
- 2 GiB aggregate original-source verification across both copies
- 4096 projection issues, 32 MiB serialized snapshot
- 4 MiB response page, including a 16 KiB envelope reserve

Nested edition and pack lists count toward these byte limits. A page can contain
fewer rows than requested and provides `next_cursor` for every unreturned row.
No nested membership or edition list is silently truncated. A single oversized
row returns 413 `library_query_limit`; use All songs with the matching ID/title
and page through the editions. Oversized histories require a later bounded
streaming/index design; this slice does not discard receipts to fit its cache.

## Validation scope

`crates/desktop-shell/tests/pack_groups.rs` uses newly authored canonical exercises,
a newly generated complete-performance MIDI/package, and fresh test-owned roots.
Each root has an outside-library sentinel. It covers selected retry unions, shared
editions, repeated source items, conflict exclusion, distinct ID/title groups,
clean profile identity, cached reads versus authoritative corruption checks,
cursor/filter freshness, missing/disagreeing/single-copy receipts, malformed
identity/path/version/unknown fields, source-only groups, read bounds, symlinks and
native admission. Existing native-library/import regressions remain applicable.

Focused tests and lint are development evidence only. Full workspace Rust/JS,
real-browser, Windows/native exact-source acceptance, and performance measurements
at the documented limits remain checkpoint work before release promotion.

Focused validation for this implementation passed:

- `cargo test -p worldmusichub-desktop --lib native_library::pack_groups::tests --locked --offline`: 2 unit tests
- `cargo test -p worldmusichub-desktop --test pack_groups --test song_pack --test native_library --locked --offline`: 14 + 26 + 15 integration tests
- `cargo clippy -p worldmusichub-desktop --lib --test pack_groups --test native_library --test song_pack --locked --offline -- -D warnings`
- `cargo fmt --all --check` and `git diff --check`

The query contract sample test can emit only its newly authored responses when
`WMC_PACK_GROUP_CONTRACT_OUT` names an explicit developer-owned output file. This
supports frontend validation against real Rust responses without a browser,
server, default-library access or private fixture.

### Receipt compatibility correction

The follow-up correctness checks passed 18 pack-group tests and the 26 existing
importer regressions, plus scoped clippy and formatting. The new producer-to-query
matrix imports actual authored inputs before querying: standalone canonical JSON,
inert display filenames, MIDI, MusicXML, MXL, jianpu, browser-library backup JSON,
native backup JSON, Unicode/space and deep-path ordinary ZIPs, zipped backups,
unified V1 packs, clean canonical/VSQ/basic-key packages, raw unsupported VSQ, and
source-only ZIPs. A separate authored complete-performance test covers that clean
profile. Each family is retried under a different upload filename. Invalid virtual
indices and forged outer/member paths remain excluded. Owned historical receipt
mutations test a newer converter failure following an older successful import.

The recovery fixture is produced by
`crates/desktop-shell/tests/pack_groups.rs::query_recovery_contract_samples_keep_unresolved_sources_visible`:

```
WMC_PACK_GROUP_RECOVERY_CONTRACT_OUT=/absolute/developer-owned/recovery-responses.json \
cargo test -p worldmusichub-desktop --test pack_groups \
  query_recovery_contract_samples_keep_unresolved_sources_visible --locked --offline
```

It emits unchanged native responses for Packs, Songs, Duplicates and Issues, plus
actual pack-filtered source-only/unresolved Issue and empty Song pages. The fixture
uses only `score()`, `pack()` and `source_only_archive()` in the same test source:
new C/D/E jianpu notes, inert authored text and deliberately invalid authored MIDI
bytes in fresh temporary libraries. No user's source, title, filename or library
is an input. Snapshot timestamps are real and may differ between regenerations;
check the recorded artifact SHA-256 alongside the generating source revision.
