# Local saved-score library

The main song list and successful explicit imports now use the storage selected
by the Rust health contract: the desktop's [native score folder](NATIVE_SCORE_LIBRARY.md)
or browser IndexedDB in the loopback web app. Settings shows the actual backend,
save outcomes, rescan and backup. On native, **Legacy browser archives** still
opens the original browser-profile library described below, with no automatic
migration or deletion. Its saved-copy and backup messages refer only to that
browser archive, not the native folder.

Saving is explicit. Opening/importing a score does not automatically put the file in the library. A saved copy retains the complete canonical score and its original-source payload; the library does not change source rights or make files public.

Storage uses IndexedDB in the current browser profile and exact origin. `http://127.0.0.1:7878`, another port, another browser and a private/incognito window each have separate storage. Clearing browser data, storage eviction, or ending a private browsing session can remove copies. Export JSON scores or a library backup for durable records. There is no account, cloud synchronization, tracking upload, automatic storage-permission escalation or access to arbitrary local folders.

## Limits and revisions

- At most 100 saved copies, 8 MiB per canonical score and 32 MiB of score JSON in total
- A new saved copy gets an independent key; matching `score.id` values never silently overwrite another copy
- Replacing/deleting an existing saved copy requires the last observed revision, preventing an older tab from overwriting a newer edit
- Metadata and complete score JSON are written in one transaction; storage quota failures never report a successful save
- The storage module checks its envelope/size. Rust compilation remains the authority when opening or restoring a score

## Backups

`worldmusichub-library-backup` version 1 is UTF-8 JSON with `exported_at` and `entries`, each containing a label and complete canonical score. The import cap is 40 MiB, including JSON syntax. Every score must pass Rust validation before one atomic append transaction. Restoration creates new copies; it does not replace or delete the current library. A validation error, count cap or quota failure must be shown and leaves existing copies intact.

A backup can contain private score images or source files, because preserving those sources is intentional. Share it only if you mean to share every included source and have the necessary rights. Exported backup files are ordinary local downloads, outside browser storage.

## Developer verification

`tests/local-library.test.js` uses the official `fake-indexeddb` package only as a development-test dependency. It tests complete source preservation, metadata-only listing, separate copies, concurrent revision conflicts, atomic restoration, count limits and storage failures. Real browser integration and persistence across reloads require the app's browser CI, not just these in-memory tests.

The implementation follows the asynchronous transaction contract described in [MDN's IndexedDB guide](https://developer.mozilla.org/en-US/docs/Web/API/IndexedDB_API/Using_IndexedDB). Writes resolve on transaction completion, not an individual request's success event.

## Complete source editions

A saved complete CC0 edition is an immutable copy of the entire canonical score, not just its displayed page or playable part. Its note/rest arrays, producer metadata, source-only warnings, exact original MSCX/XML bytes, separately identified compatible import copy, reference MIDI and asset-license text remain in the saved JSON/source envelope. Choosing voice-only practice, a different keyboard size or a later displayed measure must not trim those archived contents.

A focused IndexedDB regression uses the actual 334-event D768 edition, checks save/backup/restore equality and rechecks every retained file's SHA-256 after restoration. A real browser/Rust acceptance run is still required for the UI path; a storage-model test alone does not certify browser persistence or the user's device. Generated MusicXML or numbered text is an interchange view, not a substitute for the JSON source archive.
