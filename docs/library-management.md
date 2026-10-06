# Native library browsing

The song library's **Packs and duplicates / 曲包与查重** entry opens a metadata-only native library browser. This slice provides pack groups, all immutable song editions, unfiled editions, duplicate evidence, source/import issues and explicit selected exports. On native builds with `library_catalog_version: 1`, a separate **Organize packs and recover songs / 整理曲包与乐曲恢复** panel adds explicit initialization, verified new-import sync, exact selected song removal to Trash and selected restore. See [catalog UI and recovery](library-catalog-ui.md). Imported source groups remain read-only. The catalog panel supports creating and renaming custom packs, adding selected active songs, and filtering selected exports by custom pack. Moving or removing pack members and deleting packs remain unexposed.

## Identity and evidence

- Packs with only an independently verified source backup or no valid complete receipt have `provenance: unresolved`. They remain visible beside verified groups, with an explicit unresolved-membership explanation and access to their issues. No song membership is inferred from those sources.
- Imported pack groups use `import-<source SHA-256>` and verified receipt references. They are read-only projections, not editable collections.
- Song rows use `legacy:song-<SHA-256>` or `clean:song-<SHA-256>` as the edition identity. A song shared between packs appears once in All songs, with separate pack references. Sources retained without a usable imported edition appear in Source and import issues, not as selectable songs.
- Exact-content evidence uses format-specific content identity. It does not assert byte equality between uploaded ZIP archives. One stored edition referenced by multiple packs or distinct source items is labeled as reusing the same edition; it is not reported as reclaimable storage.
- Same-ID groups contain different editions with the same source score ID. Title-only groups use Unicode lowercasing and collapsed whitespace without Unicode normalization. Neither category decides that songs should be merged.
- Source-only items, failed imports and conflicts remain separate from stored song memberships. The original technical messages are available as literal text under details.

## Query and freshness

The adapter requires a native health response with `library_management_query_version: 1`. Missing capability, an older native build, or a browser environment produces a localized unavailable state. It does not silently switch native operations to IndexedDB.

The native endpoint is `POST /api/library/manage/query`. The renderer sends explicit views, filters, a 40-row limit and the server's opaque cursor. All requests stay on the app origin. Every successful response must identify the read-only native contract, a snapshot ID, verification time, counts and valid storage-qualified row identities.

Opening and Refresh request a verified scan. Search runs only on form submission, not on each keystroke. Filtering and paging reuse cached native metadata. The displayed verification time is a snapshot timestamp, not a promise of live filesystem monitoring. Import completion and known saved-inventory changes mark the view stale; an import racing a query cannot clear that warning. Stale or failed views cannot select or export songs until a successful explicit refresh.

Rows are capped at 40 per page. Duplicate edition details and pack membership references render lazily in batches of 20. Responses can contain fewer rows than the requested limit when the native response byte limit requires it; paging follows `next_cursor` rather than estimating offsets. Oversized duplicate results direct the user to All songs or a narrower search.

## Selection and export

Selection is exact by edition ID, persists across pages within a view and shows the count outside the current page. Users can select the current page, clear all selection or clear hidden selection. A view/filter change or refresh clears selection; newly appearing rows are never added implicitly. Switching the interface language preserves selection.

Legacy scores and complete clean packages have separate export buttons and explicit selected counts. Each button captures exactly its named format's selected editions and uses the existing native pack export contract. A failed export retains selection. Closing the dialog, changing views or filters, known inventory changes and destruction cancel its owned read-only export. Late results cannot download into a newer dialog session or replace its status. The native export may finish its already-admitted read after cancellation, but that abandoned response is discarded. These exports are not backups of membership history, Trash, practice takes or standalone free-performance recordings.

## Session boundaries and accessibility

The management model/view receives no score load, compile, preview, transport, recorder or free-recording callbacks. Opening it, inspecting evidence, refreshing metadata or exporting a selection cannot activate or start a song. Browsing preserves the independent library preview, current score and practice takes. Free-performance storage remains separate.

The UI uses native buttons, labeled checkboxes, a mixed-state page checkbox, a search form and a native modal dialog. Close and Escape cancel owned reads, discard late results and restore focus to the opener. Counts/status/errors are localized in Simplified Chinese and English; filenames, titles and original diagnostic text are inserted as text, never markup.

## Development verification

`npm run test:library-management` runs original in-memory fixtures through the adapter, pure model and actual app DOM. Coverage includes native capability gates, strict responses, shared editions, source-only issues, duplicate categories, cursor paging, explicit search, bounded nested detail rendering, hidden selection, split exports, Chinese/English parity, close/reopen races, stale reads, refresh errors, and byte-equivalent paused practice/free-recording preservation.

Checked-in samples emitted by the original-fixture Rust integration test also pass unchanged through the JavaScript adapter and app DOM.

These Node tests do not launch an HTTP server, browser or native GUI. They do not use the real user library. They are development evidence, not visual or Windows acceptance. Release promotion still requires the repository's full Rust/JS, formatting/clippy, real-browser and exact-source native/Windows acceptance gates after the native query and UI commits are integrated.
