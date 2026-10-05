# Catalog product v1 wire examples

Check health.library_catalog_version === 1. GET /api/library/catalog/status returns uninitialized or ready.

For an uninitialized library: POST /api/library/catalog/initialize/preview with {}. Show preview.counts and retained-byte explanation. After explicit confirmation POST /api/library/catalog/initialize with {"library_id":"<response library_id>","preview": <unchanged preview>}. Keep this exact object if response is lost.

For an initialized library: POST /api/library/catalog/query with {"view":"active","search":"","limit":40,"cursor":null,"refresh":true}. Persist exact checked edition_ids across pages. Unmanaged rows cannot be checked for Trash.

POST /api/library/catalog/preview with {"library_id":"<response library_id>","action":"trash_songs","edition_ids":["legacy:song-<64hex>"],"trash_operation_id":null,"expected_generation":0,"catalog_digest":"<query catalog_digest>"}. Show response.summary plus retained zero-reclaimed bytes. Cancel discards this preview. Confirm sends POST /api/library/catalog/commit with {"library_id":"<response library_id>","preview":<unchanged response.preview>}.

On uncertain/lost response, retain the preview and POST /api/library/catalog/operation with {"library_id":"<response library_id>","operation_id":"<preview.request.operation_id>"}. A committed receipt is durable. An error is not proof of absence. A proven not_committed permits explicit same-preview retry, subject to current-generation checks.

Trash query changes view to "trash". Select rows with the same trashed_by operation. Restore preview changes action to "restore_songs", supplies selected edition_ids and that trash_operation_id, and uses latest query generation/digest. The same commit/status flow applies. Restored songs regain captured memberships without rewinding unrelated work.

All queryv1 import IDs remain unchanged. Catalog pack references explicitly include both collection_id and import_pack_id. Names and titles are literal text only.

Every response contains library_id. Bind persisted uncertain work to that identity. Mutating requests and operation lookups must include the identical library_id field. Initialization preview also embeds library_id. Operation lookup can reconcile initialization and returns kind=initialize plus seed_digest on success.

Sync new imports with POST /api/library/catalog/sync/preview and {"library_id":"<response library_id>","expected_generation":<current generation>,"catalog_digest":"<current digest>"}. Review and commit its exact preview using the same operation flow. Sync-only summary counters remaining_song_count and remaining_source_count identify further batches; each later batch requires another explicit review/confirmation.
