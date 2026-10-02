# Native integration verification, accepted160, 2026-10-02

**Status: local source validation passed; hosted Windows feature acceptance is
pending. This is not native feature acceptance or a distributable release.**

Application base: accepted160 `f41421778a36e0988e54d4158c2c60e672231bd9`, tree
`194f9be3f94a3877a9010912dbd264dd5b8bb03b`; published equivalent
`389be86998dacaf2b199a71869735ae933149037`. The cumulative candidate was prepared
in an isolated detached worktree. It reuses the preserved accepted157 native
patch, SHA-256 `00969ab4d70d842f41b721dde6fe1257c3288455ea9cbd68d8ffa4b26b6fecc4`,
excluding the MIDI frontend/test change already accepted in159. It does not
include unaccepted161 development.

The historical bounded proof used local
`b960e7acd3eee9d0e882081b7b7837f6a4bb0cf0`, equivalent to remote
`0dd75e861eaec62ef0449703708a20e84fd5af0d`, and passed in
[run 36984703254](https://github.com/Goldgom/WorldMusicHub/actions/runs/36984703254).
That proof covers its own source only and does not accept this candidate.

No commit, push, workflow dispatch, Release upload, local GUI/browser/Playwright
launch, runtime installation, agreement acceptance or broader permission grant
was performed. Prior runtime security probes remain paused. Old worktrees and
the active application checkout were not edited.

| Completed local check | Result |
| --- | --- |
| Offline OSMD preparation | 2.1.3 and 18 component notices prepared from existing locked dependencies |
| `npm test` | 725 passed, zero failed |
| `node --test tests/desktop-evidence.test.js` | 2 passed; missing/altered actual files fail verification |
| `cargo test --workspace --all-targets --locked` | 296 passed, zero failed on Linux |
| `cargo clippy --workspace --all-targets --locked -- -D warnings` | Passed on Linux |
| `cargo fmt --all --check` | Passed |
| `python3 -m unittest discover -s tests -p 'test_*.py'` | 39 passed |
| Windows-target Rust notice generation | Passed for 276 packages and five Cargo.lock-verified MPL archives |
| Notice reproducibility | Two inventories matched across all 20 generated files, 4,295,326 bytes |
| Native JavaScript syntax, Tauri/notice JSON, workflow YAML | Passed |
| Baseline source comparison | All 151 tracked frontend and score-core files byte-identical to accepted160 |
| Shared Rust extraction comparison | `api`, `content_type_allowed`, `json_input_error` byte-identical apart from public visibility |
| Original dependency version comparison | All 64 original name/version pairs retained |
| Third-party source/license comparison | Every preserved native-patch license/manifest hash matches exactly |

Rust used the existing 1.99.0 Linux toolchain and offline Cargo cache. Windows
`cfg(windows)` code has not been compiled by these Linux checks. Native
PowerShell parsing is authored as a Windows workflow step, not claimed as a
local pass. Generated assets, build outputs, notice bundles and dependency
caches are excluded from the source patch.

The source review found a Windows file-picker race in the performance-backup
gate: the native action acknowledged the Open button before the WebView file
selection necessarily arrived. The gate now waits for the exact selected
backup filename before clicking Restore. JavaScript syntax validation passed;
the actual timing and native interaction still require hosted Windows evidence.

The preserved MPL license and Microsoft SDK license each contain one authentic
trailing space. Those bytes are intentionally unchanged; a full patch whitespace
check reports those two lines. Project-authored source is checked separately.

The shell keeps identifier `org.worldmusichub.desktop-proof`, custom origin
`https://wmh.localhost`, and the deny-all native permission callback. Its
Permissions-Policy allows the trusted app to attempt
`requestMIDIAccess({sysex:false})`; the installed WebView2 outcome is still
unknown. An empty-device API success will not establish physical MIDI support.

## Pending gates

1. The coordinator commits/integrates the reviewed candidate and runs
   `.github/workflows/windows-desktop-acceptance.yml` on that exact hosted SHA
2. Windows compiles its native implementation and runs startup smoke, owned
   file chooser, actual downloads, four-process profile restart, PC keys,
   minimize/restore, silent history/backup, dialog navigation and normal/active
   close. Independently verify the actual exported files and their hashes
3. Inspect all native screenshots, renderer/native reports and the explicit
   ordinary-MIDI result, including localized denial or unsupported status
4. After the next UI source is accepted separately, integrate it and repeat
   source-bound acceptance; this candidate deliberately stays on accepted160
5. Finish the product/hardware gates in [DESKTOP_INTEGRATION.md](DESKTOP_INTEGRATION.md):
   scored native takes and results, additional export formats, IME/held keys,
   physical MIDI, actual audio output/latency, accessibility and user window sizes
6. Complete runtime payload/terms and clean-machine offline installation gates
   in [DESKTOP_RUNTIME.md](DESKTOP_RUNTIME.md) before distributing a native package

The target-specific notice collection is complete for this locked Windows
source graph. It does not remove the known all-platform notice gap at
non-Windows `block2 0.6.2`. Bundling remains disabled; installer delivery,
signing, updates, release publication and full-product readiness remain pending.
