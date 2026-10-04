# Original song-authoring contract fixtures

These are original C/E/G MIDI exercises and exact JSON returned by the Rust
`practice_server::api_response` draft route. They contain no third-party score,
audio, private input, filesystem path or source-container attachment.

Generated from the built-in conversion API on 2026-10-04 without starting
a server. `strict` uses the complete
strict semantic profile; `event-only` contains independent events requiring
the event-preserving profile; `rejected` includes unsupported controller 2.
Every request carries the complete original MIDI as Base64 and every response
preserves the exact Rust metadata/score strings. These fixtures test the actual
API envelope and localized UI interpretation, not native persistence or browser
acceptance. Rust's own tests independently cover reprepare/ZIP/native roundtrip.

## Finite original authoring acceptance sources

`scripts/prepare-song-authoring-fixtures.mjs` generates exactly three new original
MIDI files and a manifest. `authoring-original-pair` selects strict and event-only
files; the blocked source is separate. These exercises are CC0-1.0, with no
third-party music or private inputs. All have a complete conductor and two note
tracks, C/E/G pitch classes, and pitches 24 and 100 outside a 61-key device range.
The strict fixture includes a nonzero bank on a used channel. Rust can preserve
its complete notation while the actual reference receiver rejects the bank.
The event-only fixture has overlapping same-key attacks and independent releases.
The rejected fixture adds a complete controller-only track with controller 2.

`acceptance-*-response.json` contains the unchanged response body bytes captured
from the real socket-free native driver for these generated MIDI files. Hashes,
the source basis commit/tree and driver identity are in
`acceptance-provenance.json`. The capture build included uncommitted acceptance
harness changes over that basis; production conversion files were unchanged.
It is not an exact clean-base executable or final clean-commit acceptance claim.
The API correctly continues to mark input rights as user-supplied and unverified;
fixture provenance does not alter or manufacture package metadata.

Run `node --test tests/song-authoring-acceptance-fixtures.test.js` for source and
adversarial verifier checks. With an exact-source driver, run
`WMH_NATIVE_IMPORT_DRIVER=<driver> node scripts/check-song-authoring-native.mjs`
for actual draft/pack, read-only preview, commit, duplicate, retitle conflict,
explicit keep-both, fresh-process restart, exact export and fresh-library import.
This is native stdio evidence, not browser, native-window or physical-audio
acceptance. Neither conversion state nor import's `playable` flag establishes
receiver sound or instrument-range acceptance.

## Original opened-package regression capture

`acceptance-events-opened.json` retains the event-only opened record from the
actual original-fixture hosted seed in run 37172374342. Its adjacent provenance
file binds the source tree, driver, artifact, renderer report and fixture hashes.
Only the outer JSON was reserialized; the embedded metadata and score strings
are unchanged. This is unit-test input from a run whose post-renderer verifier
failed, not a replacement acceptance report or evidence of restart/Windows.

For this historical capture, Rust `Summary` carries `notation_available: false`
and the recorded `OpenPackage` does not carry that boolean. Current native opens
also expose notation availability and coverage. Tests require the actual
summary false, explicit null normalized/canonical notation, unavailable notation
and target coverage, and the matching native receiver identity.

## Explicit basic-key authoring intent

`basic-key-response.json` and `basic-key-runtime.json` are exact socket-free Rust
API captures for `strict-request.json` with `intent: "basic_keys"`. They reuse the
same original C/E/G source rather than introducing another music fixture. The
response preserves every source event in the compact basic-key profile; the
runtime admits only positive determined melodic MIDI keys and declares source
rendition unresolved and reference audio unavailable.

The Rust API regression in `crates/practice-server/tests/clean_draft_api.rs`
verifies both captures and proves that changing the conversion intent invalidates
an earlier package fingerprint. Set `WMH_UPDATE_BASIC_KEYS_FIXTURE=1` only when
regenerating these original fixtures. This is API/consumer test input, not a claim
of browser, native-window or physical-instrument acceptance.
