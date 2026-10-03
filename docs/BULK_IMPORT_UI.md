# Packs and batch import

In the native Windows application, use **Import scores or packs** and select a ZIP pack, a library backup, or several score files. The existing picker supports multiple selections. A recognized backup or legacy envelope opens the import review automatically; no extraction of inner JSON files is required.

Review runs before any write. Each entry shows whether it is playable, already saved, a conflicting edition, unsupported, or invalid. **Save scores and complete originals** retains the complete input, then saves playable scores using the existing native song library. Unsupported events remain explicitly nonplayable and are available in the retained original; they never appear as playable library songs.

An ID conflict does not replace an existing edition. **Keep both editions of this song** resolves only the selected row. Retry sends the same original again and uses native deduplication. If a save response is lost, the result remains unconfirmed until a rescan or explicit retry establishes the result.

**Stop remaining imports** finishes the current atomic file request, then stops before the next file. Closing the screen requests the same stop. Already committed songs and original files remain saved. Batch completion updates the left library without selecting a song, replacing the active score or take, restarting audio, or navigating back from a newer screen. The ordinary single-score import path keeps its existing activation behavior.

**Review imported packs** reopens retained original history after restart. Recovery notices identify the affected archive and remain visible across history pages. Each original can be exported byte for byte. To use **Export score-only pack**, select saved editions in the checkbox list; nothing is selected automatically. A selection is limited to 1024 songs and 128 MiB of score data, and the final archive has its own 128 MiB limit. If a selection is too large, choose fewer songs and retry. Complete score JSON, labels, and embedded sources are exported into a directly reimportable ZIP. Cover art, backgrounds, PVs, and other separate attachments remain in their retained original packs; use **Export complete original** for those complete bytes. The selected-score ZIP does not include those separate media files.

The picker allows at most 100 files totaling 512 MiB. The native backend separately enforces archive, expansion, entry, canonical-score, and retained-storage limits. ZIP inputs are limited to 128 MiB, recognized JSON backups to 40 MiB, and ordinary scores to 8 MiB. Browser-only mode explains that this native pack workflow requires the Windows application.

## Verification

`npm run test:bulk-import` covers the queue, actual application DOM, source/active-take separation, nonplayable results, conflicts, immutable originals, cancellation, stale completion, retries, localized controls, and native-only behavior.

After building `cargo build -p worldmusichub-desktop --example native_import_driver --locked`, set `WMH_NATIVE_IMPORT_DRIVER` to that executable and run `npm run test:bulk-import-native`. This uses the real native Rust backend through stdin and the application DOM without starting a browser or network listener. It is not a native-window acceptance substitute.

The Native Windows feature acceptance workflow also runs the guarded hosted browser script. Its real file chooser drives a real native backend, records screenshots for review and saved results, compares exported original bytes, and restarts both backend and browser profile. The workflow then runs isolated `bulk-seed`, `bulk-restart`, and `bulk-failure` Windows phases with actual owned OS file choosers and a new WebView profile per process. The independent verifier checks source/executable identity, action ownership, downloads, exact original and score archive bytes, independent backups, fresh-process persistence, and unchanged old files after a test-owned staging failure.

All fixtures are newly authored synthetic music and directory envelopes. Private delivered melody/source files are never used in hosted evidence. A local Node pass does not constitute hosted-browser, native-window, screenshot, or packaged-release acceptance.
