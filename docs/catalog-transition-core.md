# Catalog transition core (development slice)

`worldmusichub_desktop::catalog` is an in-memory, versioned graph and transition
engine. It is not a storage implementation and does not enable deletion in the
application. There are no filesystem calls, library scans, routes, migrations,
list filtering changes, or UI actions in this module.

The host supplies a verified seed with the existing `legacy:song-<sha256>` and
`clean:song-<sha256>` edition identities. Payloads, original source archives,
source-origin mappings and per-song source evidence remain immutable. Imported
packs can include source-only archives. Names and score titles never identify a
song. The host must generate and collision-check random collection and operation
IDs; parsing the opaque ID syntax here is not secure ID generation.

## Pure API

1. Construct `Catalog::from_seed` from a verified physical inventory, or parse a
   bounded snapshot with `Catalog::from_json`. Snapshot validation checks graph
   references, revisions, tombstones, captured metadata and receipt history.
   It does not authenticate persisted bytes or independently verify a payload.
2. Supply a `Request` with an exact generation, host-issued operation ID/time and
   one typed action. JSON request decoding rejects unknown fields, duplicate
   fields, malformed IDs, unknown versions and oversized bodies. Every selection
   is an explicit identity list with duplicate IDs rejected.
3. `preview` returns deterministic effects, body/snapshot digests and the next
   generation. It validates the complete candidate graph and size limits first.
4. `apply` rederives and compares the entire preview. It returns a new `Catalog`
   and an in-memory `Receipt`; it never mutates the input. The host must atomically
   and durably publish the entire snapshot before claiming committed success.
5. Repeating an operation ID and the same typed request body returns its original
   preview/receipt, including after snapshot serialization and reloading. It
   keeps the current state, including later work. Reusing the ID with a changed
   body fails. Editing a returned preview fails; a changed generation fails.

The eight actions are create/rename pack, add/move/remove membership, Trash songs,
Trash pack, and Restore. An optional pack cascade names exact exclusive song IDs;
shared songs or nonmembers reject the whole action. No-op transitions also get a
new generation and receipt so their IDs cannot later acquire a different meaning.
Selection order is part of the typed body; it also supplies append order for new
memberships. Effects and graph serialization use stable ordering.

## Restore semantics

Trash keeps entities in the graph with operation-owned tombstones and captures
before metadata and removed edges. The operation record retains each item's
restoration status. Restore names one Trash record plus explicit entities and/or
captured edge IDs. It considers edges incident to entities actually reactivated
in this transaction. Selecting an already-restored entity is a no-op; explicit
edge IDs can retry dependencies that were blocked earlier. Dependencies that remain
trashed appear in the preview and stay unresolved. They never reactivate silently.

Restore ownership markers must match receipt effects in both directions, so
clearing a resolved marker in a snapshot is rejected. An already present edge
retains its newer order, timestamp and revision. A missing
edge regains its captured order/timestamp with a new revision. Equal positions
are allowed; readers must break ties by the membership identity. Once resolved,
a historical restore cannot reinsert a subsequently removed edge. An older entity
restore cannot undo a later independent Trash action. Pack names and unrelated
work are never rewound. Logical Trash leaves physical bytes retained; effect
byte fields cover the entire host-supplied inventory and `reclaimed_bytes` is zero.

## Bounds and pending host integration

The graph allows 1,024 songs, 256 packs, 16,384 active memberships, 1,024 sources,
16,384 source evidence records, 4,096 receipts/Trash records, 65,536 captured edges,
and 16 MiB serialized state. Requests are capped at 256 KiB and 1,024 explicitly
selected items. Each action may add/remove at most 1,024 edges in total, so a move
that adds and removes an edge uses two of that budget. Restore considers at most
1,024 captured edges. Capacity failure preserves the old state; nothing is pruned.

The existing read-only query v1 uses `import-<sha256>` pack IDs and its frontend
validates that identity format. New `collection-<id>` records cannot be inserted
into that response unchanged. Future integration needs an explicit migration and
versioned adapter, preserving the source-origin map between retained archives,
read-only groups and editable collections; this slice changes neither consumer.

Before any deletion control is enabled, the host still needs the reviewed atomic
backup-first persistence/recovery protocol, integrity chain, native library lock,
secure ID generation, verified payload availability/integrity, durable operation
lookup, tombstone-aware inventory/reimport, migration, and bounded transport.
The host must distinguish a never-managed library from a damaged managed one and
must never reseed/reset a managed catalog from song folders. A snapshot accepted
by this core is structurally valid, not authenticated storage evidence. These
prerequisites need authored failure-injection and restart tests. Logical Trash
also does not change the existing old-binary downgrade limitation.

Focused invariant tests use only authored in-memory metadata. Serialization
round trips verify rehydration, not filesystem durability or process recovery.
Full workspace/browser/Windows acceptance remains required before promotion.
