# Native pack grouping and duplicate review

This is the first read-only implementation slice. `POST /api/library/manage/query`
projects immutable physical editions into imported groups from retained originals
and all validated bounded import receipts. It does not create a durable catalog,
rename or remove memberships, delete songs, implement Trash, restore anything, or
change conversion. Those operations still require the later transaction and
recovery design. Browser storage is a separate store and has no implicit fallback.

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
  `source_reference_count` deduplicates `(archive identity, item path, edition)`.
  Retrying one source item does not manufacture duplicate songs.
- V1 receipts are unsigned historical evidence. `validated_receipts` means bounded
  schema/identity/path checks against verified songs and retained-source bytes;
  it is not cryptographic attestation of authorship or import history.
- Missing/invalid receipts, conflicting references and damaged originals produce
  Issues and leave unmatched songs Unfiled. A backup-only original appears as an
  unresolved source group; no primary source is silently recreated. No original,
  source backup, receipt or music payload is rewritten by this projection.

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

All later queries share advisory metadata across handles for that root, without
opening or hashing music assets or retained originals. Freshness explicitly says
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
- 32 MiB maximum receipt and 128 MiB aggregate receipt reads, including both copies
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
