# Original native catalog wire fixture

`native-responses.json` is copied unchanged from the native integration test
`native_library::catalog_product::tests::mixed_shared_legacy_clean_trash_restore_restart_and_retained_media`.
It contains 24 exact native method/path/request/status/response records plus
named snapshots. `native-response-source-hashes.json` records the producing source
file hashes, byte count and SHA-256 of the fixture; the JavaScript test checks the
artifact identity before consuming it.

Generation command, in the producer's configured toolchain and target directory:

```sh
WMC_CATALOG_PRODUCT_CONTRACT_OUT=/absolute/owned/native-responses.json \
CARGO_BUILD_JOBS=2 CARGO_INCREMENTAL=0 \
cargo test -p worldmusichub-desktop --lib \
  native_library::catalog_product::tests::mixed_shared_legacy_clean_trash_restore_restart_and_retained_media \
  --locked --offline
```

The producer uses only newly authored C/D/E jianpu, generated one-note MIDI, an
original complete-song package and an inert wave header, in fresh test-owned
ORIGINAL roots with an outside sentinel. It does not call `open_default`, consume
private music or use a real user's library. IDs and timestamps are genuine native
outputs and may differ when regenerated.

The native test restores in a fresh subprocess. Its later same-ID restore replay
is captured unchanged. The JavaScript production-adapter/actual-app-DOM replay
proves consumer compatibility and renderer recovery ownership; it does not itself
launch a native process, server, GUI or browser. Native restart, full application
browser, Windows and exact-source acceptance remain separate verification layers.

Recorded artifact: 124452 bytes, SHA-256
`7ef800d249c9471a390b8187b7e135be00ff49e9e6034d0f37c1d5da3d0eb5c5`.
