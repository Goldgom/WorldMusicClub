# Original basic-key rendition fixtures

Every fixture listed here is an actual socket-free Rust API/native dispatch
response for original mechanical MIDI test events. No private music, imported
song, third-party melody, source-path disclosure, or fabricated response is
included. The embedded canonical score/metadata strings are unchanged outputs
of the production converter. Fixture origin does not change the converter's
ordinary user-supplied/unverified source-rights classification.

## Sources and response generators

| Response fixture | Original source generator | MIDI bytes | MIDI SHA-256 |
| --- | --- | ---: | --- |
| `basic-key-rendition-native-open.json` | `crates/desktop-shell/tests/basic_keys_package.rs`: `midi()` and `basic_keys_preserve_every_source_event_part_and_attack_across_export_and_restart` | 117 | `e235772ee32066d50ba7978bf1054738ea0e6ee84b54d0ac3ff46250cc5fb930` |
| `basic-key-rendition-notation-follow.json` | Same Rust test file: inline SMF in `basic_notation_follow_uses_the_source_clock_for_silence_late_tempo_and_page_ties` | 73 | `f25a733da35a11801061071ba075e1082dc0a8148d8d4e184f4c8f0e81eb64ea` |
| `basic-key-rendition-notation-no-clock.json` | Same Rust test file: inline SMF in `conflicting_source_clock_keeps_notation_paused_and_labels_the_chosen_rendition_clock` | 68 | `de8f3ec0002ce49298f5bef62324fd7e45685553d392071391d1fe787e8d13e3` |
| `song-authoring/basic-key-rendition-runtime.json` | Original C/E/G source bytes retained as Base64 in `song-authoring/strict-request.json`; real API test `explicit_basic_key_drafts_preserve_default_and_vsq_routes_and_bind_pack_intent` in `crates/practice-server/tests/clean_draft_api.rs` | 68 | `fbcc09aef974b6cfaa0f9de2dc554f11f5052a09ad5933df1dd243da1ddcbbbc` |
| `basic-key-rendition-notation-page.json` | Same original117-byte `midi()`; native test `rendition_notation_is_opt_in_and_bound_to_saved_source_with_all_selected_targets` | 117 | `e235772ee32066d50ba7978bf1054738ea0e6ee84b54d0ac3ff46250cc5fb930` |
| `basic-key-rendition-notation-tail.json` | Inline original SMF in `rendition_native_pages_follow_synthetic_gates_across_fast_bars_and_terminal_tail`: isolated C/D/E gates, four4ms bars, explicit synthetic20ms onset/tail | 64 | `2a11bfb1e6d70ab2ab2d4474201a0d27024eac0d851c705e1d84b2cb29eb2305` |

The first four fixtures reuse the same source bytes as the earlier v1 captures.
Those earlier captures keep their original filenames and unavailable-audio
claims for legacy consumer tests. The new v2 files exercise compact target and
evidence transport, basic synthesized playback policy, and shared onset targets.

## Exact regeneration

From the repository root, using the repository's supported Rust toolchain and
an available Cargo target directory:

```sh
WMH_UPDATE_BASIC_KEYS_FIXTURE=1 cargo test -p worldmusichub-desktop --test basic_keys_package --locked --offline
WMH_UPDATE_BASIC_KEYS_FIXTURE=1 cargo test -p practice-server --test clean_draft_api explicit_basic_key_drafts_preserve_default_and_vsq_routes_and_bind_pack_intent --locked --offline
```

The native test command invokes `dispatch_with_library` inside isolated
temporary libraries; it starts no HTTP listener or GUI. The API test invokes
`practice_server::api_response` directly with the existing original request and
`intent: "basic_keys"`. Set `CARGO_TARGET_DIR`, `CARGO_BUILD_JOBS`, `CARGO_HOME`
and `RUSTUP_HOME` according to the local build environment, without changing
fixture inputs. Without the update variable, these tests compare actual Rust
responses against the committed captures.

The page fixture includes the opened package, legacy source-only page, full
three-target melodic page, and nonpitched percussion selector page. The tail
fixture includes four native page responses plus a position33ms follow request:
source end remains14ms while the explicitly synthetic receiver tail ends34ms.

These are deterministic protocol and identity fixtures. They do not establish
browser rendering, native-window, audible output, or physical-device acceptance.
