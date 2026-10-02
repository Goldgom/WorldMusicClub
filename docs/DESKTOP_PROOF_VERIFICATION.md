# Desktop proof verification, 2026-10-02

Status: isolated source proof ready for native Windows CI; native acceptance
has **not** run.

Baseline: `8e3cb1954a882a79b1cecfaf5fcd9f9bca95ab2b`.
Branch: `diagnostic/native-windows-shell`.
Host checks used Rust 1.99.0 and Node 24.19.0 on Linux. The Windows workflow
uses Rust 1.99.0 and Node 22.

| Check | Result | What it establishes |
|---|---|---|
| `npm ci --ignore-scripts --omit=optional` | Passed | Locked frontend dependencies installed without lifecycle scripts |
| `npm run prepare:engraving` | Passed | Existing hash-checked OSMD 2.1.3 bundle plus 18 component notices prepared |
| `npm test` | 620 passed, 0 failed | Existing frontend regression suite |
| `cargo test --workspace --all-targets --locked` | 295 passed, 0 failed | Shared engine/server tests plus native protocol admission and exact-response tests |
| `cargo clippy --workspace --all-targets --locked -- -D warnings` | Passed | Strict host lint; Windows-gated source is not compiled by this check |
| `cargo fmt --all --check` | Passed | Rust formatting, including parsed Windows module |
| `node --check crates/desktop-shell/smoke.js` | Passed | Diagnostic JS syntax |
| Configuration checks | Passed | Tauri JSON and workflow YAML parse; capabilities empty and workflow read-only |
| `git diff --check` | Passed | No whitespace errors |
| Baseline comparison | Passed | Tracked UI and score-core unchanged; extracted Rust operation function byte-identical |
| Lockfile comparison | Passed | Every original dependency name/version pair retained |
| Windows dependency fetch | Passed | Pinned Windows registry dependencies available for source/API inspection |
| Windows MSVC compile | Not run | Requires authorized native Windows CI |
| Native startup and actual HWND screenshot | Not run | Requires authorized native Windows CI |
| Native MIDI/audio/latency, accessibility, install | Not run | Outside this bounded shell proof |

The original icon's SHA-256 is
`2fe0219a3a66ae2738a3698532c8297c1320a7a961f73213523fcf33fec24dc5`.
It can be regenerated from `scripts/prepare-desktop-icon.py`.

No Linux native GUI/browser was launched. No source push, GitHub mutation,
Release, new account, credential, external data transmission or app permission
was performed. The active checkout and `verify-156` were not modified.

Next action: the coordinator reviews and publishes this isolated branch if
already authorized, then reads the native workflow outcome for that exact SHA.
The proof passes only with a native report showing successful real WebView
startup/engine/assets, zero executable listeners, normal close, and a visually
inspected screenshot. The workflow retains failure evidence and does not
upload the executable or WebView profile.

See [DESKTOP_PROOF.md](DESKTOP_PROOF.md) for commands, security limits and the
remaining packaging/architecture gates.
