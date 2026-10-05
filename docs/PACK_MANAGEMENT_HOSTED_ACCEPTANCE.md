# ORIGINAL pack-management acceptance preparation

This is a separate acceptance entry point for the read-only native library management UI. It is intentionally **not registered in package.json, a workflow, the existing 303 gate, or a release promotion rule**. The integrator can register it at a later authorized checkpoint. Nothing here publishes a build or dispatches CI.

Local fixture/contract tests and syntax checks do not establish that native API or browser acceptance passed. A passing native stdio report establishes its actual API/filesystem cases only. A later hosted run must produce its own real browser screenshots and report; neither script supplies sample or mock screenshots. Windows native-window acceptance remains a separate required gate.

## Inputs and scope

`scripts/pack-management-acceptance-fixtures.mjs` creates deterministic ORIGINAL data under a fresh test-owned root:

- One Unicode ZIP containing 41 newly authored, two-note canonical exercises in nested paths with spaces
- One backup JSON containing two virtual `filename#entries/index` items, including one edition shared with the ZIP
- One standalone score, followed by an identical-byte import under a different Unicode filename
- A renamed identical-byte backup retry, which must not turn its existing items into extra duplicate sources
- One standalone original whose two receipt copies are moved aside after import to exercise honest unresolved provenance and an unfiled edition
- One source-only ZIP with newly authored invalid MIDI bytes and original diagnostic text
- The repository's existing ORIGINAL, Rust-converted clean-v2 exercise without media, for explicit complete-package export

The result is six source groups and 45 immutable song editions. The shared edition has two logical source references; the two renamed retries only increase receipt references. Source-only and unresolved packs have no fabricated members. Missing-receipt recovery only renames the new test fixture's receipt files after checking an ownership marker; both source copies and all song bytes remain retained. No real library path is an input to either script.

The management UI remains read-only groups plus explicit selected exports. Deletion, membership editing, rename, restore, permanent stores and Trash are outside this acceptance slice and remain open work.

## Local preparation checks

After the repository's existing Node dependencies are available:

```sh
node --test tests/pack-management-acceptance.test.js
node --check scripts/check-pack-management-native.mjs
node --check scripts/hosted-pack-management-check.mjs
```

These tests verify deterministic fixture bytes, source provenance, Unicode ZIP inventory, byte-identical retries, admission guards, receipt-move isolation, full byte-inventory comparisons, and adversarial mutations of a clearly labeled in-memory protocol oracle. They also revalidate existing Rust-emitted recovery samples against the renderer contract. They start no browser, native driver, listener, HTTP server or Cargo process. The hosted-entry guard is exercised only with authorization variables deliberately absent.

## Independent native stdio preflight

First obtain an already-built immutable `native_import_driver` from the declared product source. Building it is the integrator's separately coordinated step; this script never invokes Cargo. For example, with a driver built from the product freeze `98de7cb29b553c1402bb438dfa0c0afc384a4cb7`:

```sh
WMH_SOURCE_SHA=98de7cb29b553c1402bb438dfa0c0afc384a4cb7 \
WMH_NATIVE_IMPORT_DRIVER=/absolute/path/to/immutable/native_import_driver \
WMH_ARTIFACT_DIR=/absolute/test-owned/output/pack-management-native \
node scripts/check-pack-management-native.mjs
```

The preflight checks that tracked `Cargo.toml`, `Cargo.lock`, `crates/` and `web/` match the declared driver source. This permits an acceptance-only scripts/tests/docs commit on top of that product source. It records the product SHA/tree, current harness HEAD, whether the harness is dirty, driver SHA-256 and exact harness file hashes. The build job remains responsible for binding that driver binary to its declared source; a supplied path or SHA variable alone cannot prove a build's provenance. Prefer a clean committed harness for reviewable evidence.

The script performs real native preview/commit calls, source-byte exports, renamed retries, query views and pack filters, 40+5 paging, search, both explicit single-edition exports, export-byte checks, preview of the exported selections, and fresh-process reopening. It compares every retained library file before and after queries/exports. All API responses and their hashes are recorded; no JSON response is mocked or rewritten. It opens no network port, browser, GUI or native window.

## Later authorized hosted browser run

Only after the applicable hosted CI/browser authorization and exact-source driver build are in place, run on the authorized GitHub Actions runner:

```sh
GITHUB_ACTIONS=true \
WMH_HOSTED_BROWSER=1 \
WMH_SOURCE_SHA="$GITHUB_SHA" \
WMH_NATIVE_IMPORT_DRIVER=/absolute/path/to/exact-source/native_import_driver \
WMH_ARTIFACT_DIR="$RUNNER_TEMP/pack-management-hosted" \
node scripts/hosted-pack-management-check.mjs
```

The checked-out source must be clean and equal to `WMH_SOURCE_SHA`. Install the existing locked Node dependencies and Playwright Chromium, and prepare any repository-required local engraving assets through the normal workflow. The runner must have Python for the bounded in-memory ZIP inventory helper. Do not set authorization variables on a local machine to bypass a local browser restriction.

The hosted script opens Chromium at **1280×720, Simplified Chinese**. Requests to the app origin are forwarded to the real native stdio driver; static assets come from the checkout. It opens no HTTP server and blocks foreign network requests. Audio observation wraps the real browser methods; it does not replace playback or clocks. It makes no claim about physical audibility or Windows native-window behavior.

The planned browser assertions cover:

1. Actual multiple-file picker preflight/save, Unicode filenames and nested ZIP paths, backup virtual items and same-byte renamed retries
2. Pack membership, all editions, unfiled editions, true shared-content evidence, empty same-ID/title categories, and source-only/unresolved issues
3. A 40-row first page and five-row second page using one snapshot; explicit search; selection hidden on another page and clearing that selection
4. Explicit selection of one legacy and one clean edition, separate exports with exact selected keys, and preserved complete export inventory/content hashes
5. Escape, close/reopen, selection reset, opener focus and explicit refresh
6. Byte-equivalent active score, paused practice take, saved free recording and unsaved free draft; unchanged preview/transport/audio counters; no score IndexedDB fallback
7. No non-management API requests during browsing/exports, unchanged native library bytes, and fresh native process plus fresh browser-profile reopening

Real screenshots are captured by `page.screenshot`, then checked as decoded PNGs with exact 1280×720 dimensions and recorded hashes. Screenshots include packs, paging/hidden selection, explicit search, unfiled, duplicate evidence, source issues, selected exports, preserved recordings, and fresh-process reopening. They are created only by an actual hosted run, never by preparation tests. Screenshots support later visual review; automated geometry assertions do not replace that review.

## Bounds and evidence

Both entry points create a unique `original-run-*` directory under the specified artifact directory. They retain the fixture manifest, actual API response bytes with SHA-256, selected exports, before/after library inventories, and `report.json`; `latest-run.json` points to the completed or failed run. Hosted reports also contain actions and real screenshot hashes. Failed assertions leave `ok: false` and the original error rather than fabricating a partial pass.

Bounds are 45 songs, six packs, less than 1 MiB of authored inputs, 180 API requests, 100 declared UI actions, 512 inventoried files, 8 MiB of inventoried library content, 15-second native/request/UI waits and a four-minute execution deadline. ZIP inspection subprocesses have a five-second deadline. Driver shutdown has a three-second bound; hosted cleanup waits at most five seconds per context/browser/driver and reports timeout failures. When registering the future CI job, also give the entire process a six-minute job limit as a last-resort process cleanup bound. Outputs are test-owned and left for normal artifact collection/cleanup; neither script accepts an existing user library or exposes destructive management actions.
