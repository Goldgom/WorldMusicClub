# Native catalog and user packs

The native host advertises `library_catalog_version: 1`. The bounded product API
is separate from read-only query v1; its full wire contract is in
[catalog-product-contract.json](catalog-product-contract.json). No browser-store
fallback, pack move/unlink/cascade, permanent deletion, cleanup, or source rewrite
is exposed. Custom user packs support separately reviewed create, rename and
add-selected-edition operations. Imported source groups remain read-only.

The host advertises `create_pack`, `rename_pack` and `add_memberships` through
`supported_operations`; renderers must check these capabilities. Pack query uses
`view: packs`, includes empty packs, and shares its snapshot with song queries.
`collection_id` filters active songs or the captured memberships of trashed songs.
Each pack has a typed `kind` and an explicit nullable `import_pack_id`: a custom
pack never acquires an invented import identity. Active counts include retained
unavailable editions; available counts include only verified physical editions.
Shared counts include memberships in other source or custom packs. Existing
import-group projections continue to describe source evidence, not user filing.

Create names and renamed names are bounded to 256 UTF-8 bytes, nonblank, and free
of control characters. Create allocates a collision-checked random collection ID.
Add uses exact active managed edition IDs, at most 1024 per reviewed transaction,
and verifies payload availability again at commit. Existing memberships produce
explicit already-present noops and retain their position, time and revision.
Create followed by add is two transactions; a cancelled add leaves the empty pack.
No membership move/removal, pack Trash, cascade or historical Undo is exposed.

These actions already exist in the v1 core, so existing persisted catalogs need
no migration and historical receipts retain their exact bytes and digests.
Older native hosts do not advertise these controls. Older renderers may reject
custom references with a null import identity and fail closed; use a newer app
instead of resetting or reseeding a catalog. This is preservation compatibility,
not a promise of full organization support in an older application.

Initialization is an explicit reviewed operation. Its preview verifies physical
legacy and clean editions, retained originals, and complete historical receipts.
Only proved saved/duplicate edges seed the graph. Shared editions retain every
proved membership; unsupported and unresolved sources stay in the existing Issues
view, never as invented songs. Random 128-bit IDs come from the operating system
(`/dev/urandom` or Windows BCryptGenRandom) and are collision-checked against the
loaded graph and reserved genesis operation. Names and paths never select files.

The initialize preview binds the library identity, seed inventory digest, complete
seed digest, random source-to-collection mapping, counts and verified retained
bytes. Commit reconstructs the identical verified seed. A same-ID retry checks the
original genesis, returns current state and does not rewind later work. A fully
marked precommit interruption can resume through the same checked journal API.
Missing/partial/conflicting markers or corrupt history return actionable recovery
errors; there is no reset or reseed path. External or older-binary inventory changes
that invalidate a pending bootstrap require recovery with all evidence preserved.

Ordinary previews require the exact selected edition IDs, current generation and
catalog digest. The host supplies the operation ID/time. Preview effects expose
selected/changed song counts, affected imported packs, shared-song impact and
removed/restored edges. The commit receives the frozen core preview unchanged and
rechecks both the current journal and required physical editions under the native
lock. Lost responses are reconciled by operation ID, including genesis. A failed
lookup or admission error is not evidence of absence. The renderer must retain the
same ID and preview until a committed receipt or proved not-committed result is
resolved. An uncertain outcome never authorizes generating a replacement operation.

Trash changes only the pure catalog graph and backup-first journal. The physical
inventory remains the source of deduplication and capacity checks. Active list and
new load/inspection requests apply catalog tombstones; already admitted clean media
continues to load by its prior handle. Reimporting the same bytes remains a physical
duplicate and cannot reactivate the edition. Sources, backups, old receipts and
practice data remain untouched. Byte totals captured at initialization or adoption count present verified score,
media, legacy source payload, and original-source copies, excluding metadata and
staging; missing copies contribute zero and corrupt present payload copies block a
mutation. They are retained catalog accounting, not a live disk-space meter. No bytes are reclaimed.

New imports initially remain active with an explicit pending catalog-sync issue.
The separate Sync preview appends only freshly verified identities through the
same pure transition/journal mechanism, followed by the ordinary commit/lookup
flow. It does not replace existing entities, tombstones, membership removals or
histories. Source rescans cannot reattach an existing song from an old receipt.
Sync uses explicitly reviewed batches of at most 32 new source groups, 32 new songs
and 1024 memberships. Songs wait for all proved source dependencies to be admitted.
The response reports remaining song/source counts; later batches require a fresh
preview and confirmation. After synchronization, new songs can be selected for
Trash and restore normally.

The existing `manage/query` v1 continues to return only `import-*` pack IDs. Its
active memberships are mapped from catalog source origins; catalog routes return
explicit `collection_id` and `import_pack_id` fields. Both caches contain advisory
metadata only. Every query verifies the journal head under the native lock, and a
changed head invalidates the cached projection. Physical/evidence refresh remains
explicit; cached metadata never makes a mutation or damaged payload authoritative.
Cursors bind the snapshot and exact filters/limit. Pages are bounded to 100 rows
and 4 MiB, with no silently truncated nested lists.

The journal still verifies its full chain on reads and writes. Large histories may
be slow; this slice makes no responsiveness or Windows power-loss durability
claim. Old binaries do not understand logical Trash and can display retained songs.
Full repository/native/Windows acceptance is required before release promotion.

## Development evidence

The final focused development checks pass: 35 pure catalog tests, 11 native product
cases (including subprocess restart/lock probes), 18 existing pack-group cases,
15 native-library cases, and 26 importer cases. Scoped desktop library/integration
Clippy passes with warnings denied. Formatting and diff whitespace checks pass.
The broader desktop library run passed 91 cases with the opt-in maximum-size
measurement ignored before the final review corrections; affected final behavior
was then rechecked by the focused suites above. This is not full release acceptance.

Original fixtures cover mixed legacy/clean editions, shared source packs,
source-only and backup-only issues, intact admitted media, unchanged original
hashes, bootstrap marker retry, corrupt source/journal blocking, stale/edited plans,
changed-body and same-ID retries, uncertain external lock responses, cursor
binding, long/inert upload labels, and explicit synchronization across 40 sources
and 1200 memberships. The 40-source case first admits 32 sources without prematurely
adopting dependent songs, then adds 8 sources plus 25 songs, then the last 5 songs.
All 1200 edges remain present before a selected-song Trash transition.

The native response fixture is produced only from the authored test with:

```
WMC_CATALOG_PRODUCT_CONTRACT_OUT=/absolute/owned/native-responses.json \
CARGO_BUILD_JOBS=2 CARGO_INCREMENTAL=0 \
cargo test -p worldmusichub-desktop --lib \
  native_library::catalog_product::tests::mixed_shared_legacy_clean_trash_restore_restart_and_retained_media \
  --locked --offline
```

It includes unchanged request/response pairs and a genuine same-ID Restore replay
after a new process committed the restoration. Timestamps and random IDs change
between regenerations; retain its SHA-256 and source hashes with renderer evidence.
No GUI, browser, HTTP listener, default library or user corpus is used by these tests.

The combined backend/renderer tree additionally passed all 95 desktop library
tests (one opt-in measurement ignored), the 94 integration tests listed above,
and all 1,753 ordinary Node tests. The live socket-free production-adapter/DOM
check is documented in [library-catalog-ui.md](library-catalog-ui.md). It adds
end-to-end transport-loss and fresh-process recovery evidence without broadening
the supported operation scope or claiming browser/Windows release acceptance.
