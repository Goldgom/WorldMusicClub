# Native score storage app integration

The native library modules are integrated with UI189, retaining its shared piano
stage and idle free-input audio behavior. This change includes the native Rust
library API, frontend adapter, startup song inventory, explicit import/save hooks
and storage/settings UI. The separate Windows song-folder gate is additive to
the existing desktop acceptance scenarios and is required by native packaging.

## Modules

- `web/native-score-storage.js`: `openScoreStorage()` verifies same-origin
  `/api/health`, then returns a native or browser adapter with `info`, `list`,
  `save`, `load`, `exportBackup`, and `close`
- `web/score-storage-model.js`: `ScoreStorageModel`, explicit one-import tickets,
  stale-list guards, conflict/retry state, and left-song-list identity/load helpers
- `web/score-storage-view.js` and `.css`: connected Chinese/English settings and
  persistence status section; includes actual native path or explicit browser
  storage, rescan, backup, original failure details and disabled future OS controls
- `describePersistenceResult()` is a localized app-notice helper. Use it outside
  settings so an import save failure is visible even when settings are closed

The view responds to the existing app i18n object's `locale` and `subscribe`,
without changing the global locale catalog while other UI work is active. No
module executes on import, creates a server, reads arbitrary filesystem paths,
launches a shell, changes the active score, or acquires MIDI permissions.

## Adapter contract

Only a successful Rust health response with `name:"WorldMusicHub"`,
`engine:"rust"`, `score_format_version:1` and an exact known `network` value
selects storage:

| Health network | Adapter | Meaning |
| --- | --- | --- |
| `native-protocol-no-listener` | `native` | Native filesystem library API |
| `loopback-only` | `browser` | Existing origin-local IndexedDB library |

Requests use relative same-origin routes, `credentials:"same-origin"` and
`redirect:"error"`; foreign/redirected responses are rejected. Health errors,
unknown contracts and native operation failures never silently choose IndexedDB.
Native initialization failures remain visible and can be retried through rescan.

`list()` returns `{kind,storage,origin,directory,capabilities,entries,issues}`.
Each row includes `libraryKey`, `storageKey`, `storageKind`, canonical `score_id`,
title/label/composer and byte/timestamp metadata. `libraryKey` is the native
content key or IndexedDB copy key prefixed by the backend kind; never substitute
the canonical score id. Two editions with the same `score_id` stay separate.

`save(score,{label,allowConflictingId,signal,scoreJson})` captures the complete canonical
object synchronously, asks Rust to validate it, and saves that snapshot without
replacing it with a compiled practice projection. `validateScore` injection must
return `true` after Rust validation or a compilation containing `score` and
`timeline.notes`; absent injection, the adapter calls `/api/compile` itself.
Signal cancellation before validation/save prevents the save. Once a native
write starts, closing a view does not abort its commit response.

Errors preserve server codes and the normalized existing-entry identity for
duplicates/conflicts. A lost save response or malformed success response is
`persistence:"unknown"`; the UI must rescan before claiming the save did not
happen. Confirmed failures are `not-saved`. Native save body escaping participates
in the existing 8 MiB transport cap; no retained attachment is removed to fit it.

`load(libraryKey,{signal})` returns `{entry,score,score_json?}` after Rust
validation. It does not activate the score or save another copy.

`exportBackup({libraryKeys?,signal})` returns `{text,filename,storage}`. Native
exports are converted into the existing `worldmusichub-library-backup` version 1
schema: `{format,version,exported_at,entries:[{label,score}]}`. This retains every
canonical field and original source/envelope string and is restorable through
the current browser backup reader. The common backup schema stores score objects,
so original outer JSON whitespace is not an export guarantee; native `score.json`
and the raw native export endpoint continue retaining exact submitted bytes.
There is no new competing backup schema or silent partial bulk restore.

## Connected app hooks

- App startup creates one `ScoreStorageModel`, mounts the settings section and
  lobby inventory status, and calls `start()`. The app never adopts or saves a
  score merely because it was inventoried
- `score-file` creates one ticket per chosen file. Both canonical JSON and
  importer routes persist only after successful `compileScore` activation and
  a still-current import intent. Native canonical JSON imports pass the original
  `file.text()` as `scoreJson`; the adapter verifies it matches the accepted
  original object and submits those exact bytes
- A completed explicit Jianpu text import gets a `jianpu-import` ticket. Confirmed
  image/OMR activation uses separate `importReviewedScore` wrappers. The general
  compiler and `importCanonicalScore` stay neutral because saved copies,
  transposition and adaptation reuse them
- The app keeps a successful imported score usable while its save completes.
  Every persistence result remains in settings. Only a result still owned by
  the same source, import intent, preview and navigation may update the current
  selection or notice. A late save cannot replace a newer error or source;
  Retry and Keep both retain their original source ownership. A failure does
  not roll back activation, silently write to another backend, or restart audio
- `buildSongList` joins catalog metadata and saved inventory. Bundled rows retain
  their existing IDs for compatibility; saved rows use `native:<content-key>` or
  `browser:<copy-key>` in `data-song-key` and `data-library-key`. Matching canonical
  score ids never merge two stored editions
- Saved-row loading runs through `preview.select` and `loadSongListItem`, which
  leaves the active score/takes untouched. `ScorePreview.adopt` now accepts an
  optional browse identity, preserving the saved-copy key when explicitly
  starting that preview. Late saved loads and late catalog startup results
  cannot replace a newer selection
- Settings provides current-score save, rescan and complete backup. Unsupported
  native directory choosing/opening remains disabled. The left list exposes
  inventory read failures without requiring the user to open settings first
- The old archive button is **Legacy browser archives** on native. Its original
  browser-profile semantics and truthful browser save/download messages remain.
  There is no automatic migration, delete or replacement. In browser mode the
  same IndexedDB library is used, and closing its management dialog refreshes
  the left list

The CSS is linked in `index.html`. The existing recursive embedded-asset build
includes all new modules/styles for both adapters; a direct native transport test
verifies their same-origin availability and CSS reference. The HTTP server does
not gain native filesystem routes. The native host uses the existing
process-owned smoke directory for isolated test archives when configured.

## Status, cancellation and settings boundaries

The model serializes save jobs, captures source snapshots before awaiting, and
invalidates stale list responses after confirmed saves. A read failure retains
last-known entries with an error instead of presenting a misleading empty list.
It owns no active score, playback, editor or navigation state; a save failure
cannot roll back a successful import. Failed/uncertain imports explicitly direct
the user to retry or use the current score's JSON export. An all-library backup
does not claim to include an import that failed to save.

The view localizes status while preserving literal titles, paths and original
failure details. Language switches do not issue IO or recreate buttons. Backup
creation requires an explicit click; a view destroyed while export is pending
does not trigger a late download. Success says “download requested”, not that a
file definitely reached disk. Native backup contents include original assets.

Directory choice and open-folder controls are visibly disabled/planned. Rescan
and backup work through the existing storage API. This patch has no arbitrary
path argument, directory-change operation, shell command or deletion/migration.
Any later directory picker must use proper native OS interaction and leave the
old folder intact.

The once-only guarantee is per accepted import ticket in this running app.
Tickets are weakly held. It is not a distributed exactly-once claim across
process crashes: after restart, native content identity and explicit duplicate
responses reconcile previously completed writes.

## Registered checks and remaining acceptance

`npm run test:score-storage` runs the adapter/model/view tests and the actual-app
Node DOM suite. They are also registered in `npm test`. Existing local-library,
locale, audition and independent-recording tests remain applicable. Node tests
use authored fixtures, mocked same-origin fetch, `fake-indexeddb`, `linkedom` and
mock audio; they launch no browser/server and read no user application directory.

The direct Rust tests cover archive fidelity, separate-process restart, conflict,
recovery, corruption, locks, path/size limits and embedded storage assets, only in
test-owned temporary directories. The new app DOM suite covers actual imports,
raw JSON preservation, stable same-ID editions, fresh-app inventory, saved
activation/audition, retained score/take evidence, failure/retry without IndexedDB
fallback, uncertain commits, invalid imports and stale/cancelled selection.

`npm run test:score-storage-hosted` is registered in the full frontend workflow
for an authorized GitHub Actions browser runner. It refuses ordinary local
execution. It requires `GITHUB_ACTIONS=true`, `WMH_HOSTED_BROWSER=1`, and
`WMH_SOURCE_SHA` matching the checked-out commit. Optional `WMH_SERVER_BINARY`
and `WMH_ARTIFACT_DIR` identify the already-built Rust server and evidence folder.
The workflow retains its source-bound report and screenshots as the separate
`score-storage-regression` artifact even on failure. Its step is:

```yaml
- name: Check score storage and native UI failure contract
  env:
    WMH_HOSTED_BROWSER: '1'
    WMH_SOURCE_SHA: ${{ github.sha }}
    WMH_ARTIFACT_DIR: ${{ runner.temp }}/worldmusichub-score-storage
  run: npm run test:score-storage-hosted
```

This step uses the default checkout of `github.sha`; an explicit PR-head
checkout must instead pass that exact checked-out commit. Run it after the
exact-source Rust server build and hosted Chromium setup;
upload the evidence directory even on failure. It checks real Rust/browser
import, reload and backup, then a separately labeled mocked native failure
contract with no browser-storage fallback. Its report records source hashes and
explicitly sets `native_filesystem_acceptance:false`. It is not a substitute for
Windows native app-data behavior, real WebView restart, layout/accessibility or
package provenance acceptance. The separate Windows gate and exact-byte folder
verifier are described in [native song-folder acceptance](NATIVE_SONG_FOLDER_ACCEPTANCE.md).
All those checks must pass on the final frozen source before acceptance; Node
DOM tests and portable Rust tests alone are not native package acceptance.
