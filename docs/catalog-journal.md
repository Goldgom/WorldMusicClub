# Native catalog journal (isolated development slice)

`worldmusichub_desktop::catalog_journal` is a Rust host-only persistence API for
checked `catalog::Catalog` transitions. Nothing calls it from routes, scanners,
imports, the existing query v1, or the UI. It does not enable runtime deletion or
automatic migration. There are no payload, song, source-original, history, or
staging deletion operations, automatic expiry, or garbage collection.

## Host API and boundaries

- `initialize(library, verified_seed, bootstrap_id)` explicitly anchors a checked
  generation-zero seed. The host must verify physical inventory and issue and
  collision-check OS-random IDs. This module parses IDs; it does not generate
  transport-safe operation IDs or claim to verify payload availability.
- `load(library)` returns a verified current catalog, counts of recovered primary
  generations and preserved stages, or a visible error. `None` means neither
  catalog area exists. Incomplete staging alone is never a commit.
- Obtain a frozen preview with the loaded catalog's pure `preview` method.
  `commit(library, preview)` reacquires the existing native process/OS lock once,
  verifies the chain and preview, and publishes one whole snapshot. No public
  list/load/save method is recursively called under that lock.
- `lookup(library, transition_id)` resolves a durable transition receipt after a
  lost response, including after later work. Bootstrap is not a core receipt:
  resolve its result with the identical `initialize` call. Reinitialization with
  the identical seed/ID returns current state and never rewinds it.

The host-visible Rust module is hidden from generated API docs and has no wire
contract. It must remain disconnected from ordinary inventory and import until
migration, tombstone-aware scans/reimport, payload checks, native ID generation,
and a bounded versioned adapter have separate integration tests. The older query
v1 identity format is unchanged. Existing older binaries can still display
physically retained trashed songs; this slice supplies no downgrade guard.

## Persisted evidence and commit decision

Each immutable generation has canonical `state.json`, `receipt.json`, and
`manifest.json` in both `catalog/commits/<20-digit-generation>-<operation-id>` and
`catalog-backups/commits/<same-name>`. Matching `format.json` markers anchor the
initial manifest hash. Generation manifests bind storage version, generation,
operation ID, prior manifest hash, and state/receipt sizes and SHA-256 hashes.
Bootstrap has a distinct record; subsequent receipts must reproduce the exact
next core snapshot when reapplied to the previous verified snapshot. Independent
file writes create the two copies; neither is a link to the other.

Publication stages and flushes both complete copies, verifies their bytes, then
renames the backup into its immutable destination. That rename is the commit
decision. The backup parent is synced before publishing/syncing the primary. The
staging parent is also synced after renames. Any error after the backup rename is
`CommitUncertain`, including a parent-sync or response failure. A same-ID/same-body
retry returns its old receipt and the current state, preserving newer work.
Changed bodies conflict; modified frozen previews are rejected.

Before an operation's decision is present, failed publication returns
`NotCommitted`. A failure before a verified status lookup, including an external
process holding the native lock, is conservatively uncertain: a prior invocation
may already have committed. `NotCommitted` alone is not an automatic retry hint;
a recovery/capacity cause still blocks work until resolved. Never replace an
uncertain operation ID with a new ID to repeat a destructive-looking action.

The existing native Unix directory-sync helper is reused. On Windows it flushes
files but lacks a portable directory flush: process-interruption recovery is
supported; Windows power-loss directory durability is not claimed. Full native
Windows acceptance remains required.

## Restart and recovery

Under the same native lock, every load bounds the entire journal, validates all
backup generations from zero without gaps, reconciles all primary copies, and
reapplies every transition. A corrupt newest record, any primary/backup conflict,
a missing intermediate generation or decision backup, unsupported version,
malformed/unknown node, unsafe link/reparse node, or inconsistent state stops the
load. No old snapshot or empty seed is substituted.

Only after the entire chain validates are missing primary generations repaired.
A complete staged copy may be reused only when its canonical bytes match the
committed backup exactly. Every reused file and its directory are flushed again
before rename. Unmatched and incomplete stages remain untouched and counted.
Otherwise a new primary stage is reserved, written, flushed and renamed. Reuse
lets an interrupted two-copy publication recover even at its admitted quota,
without needing a third complete snapshot. Staging alone can never establish a
commit decision.

Hash chains provide consistency evidence, not cryptographic authentication against
an attacker who can replace the entire journal. Losing both copies of an entire
latest tail and every independent trace of it cannot be detected by this format;
external filesystem backup remains outside this slice.

## Explicit bootstrap interruption cases

- Both markers are valid and match the exact seed/ID, with both commit areas empty:
  identical `initialize` can resume. It repeats marker, directory and root flushes
  before publication, even if the earlier call stopped before its first root sync.
- A committed backup exists and both markers match: identical initialization or
  load validates the chain and repairs a missing primary.
- One marker only, partial markers, missing markers in either existing catalog
  area, conflicting markers, or existing commits without markers: visible recovery
  error. A primary generation without its backup also requires recovery.
  No automatic reseed or marker repair is attempted. A known backup
  decision retains an uncertain outcome. These cases need a future explicit
  recovery/export tool or informed manual recovery from retained evidence.
- Empty catalog areas with missing markers are also evidence of interrupted or
  damaged management, not permission to recreate an empty catalog.

## Bounds and authored checks

The core's 16 MiB snapshot and graph bounds remain unchanged. The journal limits
all primary, backup, marker and staging bytes together to 256 MiB, with at most
4,096 committed generations, 8,192 generation copies/stages combined, and 32,776
managed nodes. Each receipt file is capped at 16 MiB; manifests/markers at 4 KiB.
Fixed-depth enumeration validates exact node shapes and file-size metadata before
reading. Sparse files count by their logical size. Capacity failures precede any
new generation publication, and history/stages are never deleted to make room.
Full snapshots retain receipt history, so byte capacity can be reached far before
the generation count. This is deliberately not a responsive browsing claim.

Native tests use only authored metadata, retained dummy payload/source bytes and
fresh owned temporary roots with an outside sentinel. Private failure hooks cover
partial file writes, before/after file and stage sync, both marker publications,
root sync, before/after backup and primary publication, and the lost-response
boundary. Each bulk failure case runs a fresh executable for recovery and checks
whole old/new batches and exact idempotency. Additional cases cover durable
Restore, new work after old receipts, external-process locks, corrupt hashes and
recomputed-but-unrelated snapshots, chain gaps, version/identity conflicts,
unsafe nodes, incomplete stages, sparse quotas and recovery at full quota.

The opt-in `maximum_inventory_snapshot_growth_and_replay_measurement` test uses
1,024 songs, 256 packs and all 16,384 allowed memberships. Its five full generations
measure storage growth and verified replay on the current development container;
it is not a full maximum-16-MiB or maximum-history benchmark or a latency SLA.
Focused development tests do not replace full workspace, frontend, browser or
Windows/native acceptance on the exact frozen source.

Measured on 2026-10-04 in the cached normal unoptimized test profile (two Cargo
build jobs, incremental disabled): seed 3,388,188 bytes; generation-four snapshot
3,392,015 bytes; five generations including independent backups 33,913,136 bytes.
Initialization plus four small pack renames took 41,368 ms; a complete verified
five-generation replay took 10,794 ms. The authored measurement passed with exact
state equality and unchanged retained payloads/sentinel. This is a development
container observation, not a hardware-independent benchmark or release target.
It demonstrates that repeated full-chain validation must not become a browsing
or per-keystroke path. A separately reviewed checkpoint/cache and runtime
integration design is needed before promising responsive management at these
bounds. No performance-driven weakening of receipt/state verification was made.
