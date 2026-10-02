# Native Windows shell proof

This isolated spike starts from committed application source
`8e3cb1954a882a79b1cecfaf5fcd9f9bca95ab2b`. It does not include the active
checkout's uncommitted locale work. Every tracked `web/` file is unchanged.
It is a packaging and transport experiment, not the requested visual rebuild
or an accepted release.

## What the executable does

`worldmusichub-desktop.exe` creates a normal, closable Windows application
window using pinned Tauri **2.12.1** and WebView2. The original HTML, CSS,
JavaScript, score catalog and prepared local OSMD **2.1.3** bundle are compiled
into the application through the existing validated asset builder. The default
entry point does not launch a browser, start `practice-server`, bind a TCP port,
or display a console window.

The current UI's relative `fetch` calls and raw imports use an asynchronous
`wmh` custom protocol. Wry maps it to `https://wmh.localhost` inside Windows
WebView2; this name is an intercepted resource origin, not a localhost HTTP
server. The shared Rust operation dispatcher was moved mechanically from
`practice-server/src/main.rs` into that package's library. Both adapters call
that same implementation, including its validation, diagnostics and errors.
The score engine and UI were not rewritten.

Only embedded resources and the existing finite set of score operations are
available. No Tauri command handler, global frontend Tauri API, shell,
filesystem, HTTP, updater or dialog plugin is installed. Capabilities are empty.
External navigation/popups and new browser permissions are denied; MIDI is
therefore unavailable in this proof. Reference-site links are intentionally
blocked until a reviewed external-link flow exists. Existing local file-input
and browser download behavior still need actual Windows acceptance testing.

Requests accept only the exact app origin, GET/POST and no query string. Bodies
are limited to 8 MiB, JSON responses to 32 MiB, admitted engine requests to 16,
and concurrent computations to two. Waiting for a computation slot expires
after two seconds. Static assets bypass the engine queue. Computations run off
the UI thread. CSP denies external resources, subframes and form submission.
The HTTP development adapter retains its loopback-only restrictions.

**Boundary limitation:** Wry/WebView2 materializes a protocol body before this
Rust handler sees it. The 8 MiB check bounds accepted engine work, not all
possible WebView/IPC allocation. A page can abort fetch and ignore stale replies;
this does not cancel already running Rust CPU work. A production bridge needs
explicit typed operations, earlier admission and cancellation/session ownership.
This compatibility adapter is intentionally a bounded migration step.

The app uses a separate WebView profile/origin from the old browser app. Existing
browser-local scores and settings do not migrate automatically. Normal app
storage persists in the app's profile; smoke tests use a fresh evidence-local
profile and never upload that profile.

## Reproduce the bounded Windows proof

Use a native Windows x64 MSVC environment with Visual Studio C++ build tools,
Node 22, Rust **1.99.0** and an already-installed WebView2 runtime. The desktop
crate declares MSRV 1.90; this proof pins its CI toolchain to the actually tested
host version, rather than claiming that every locked dependency passes on 1.90.
The shared engine packages retain their existing Rust requirement. No runtime
installer or license acceptance is automated.

From the repository root:

```powershell
npm ci --ignore-scripts --omit=optional
npm run prepare:engraving
cargo fmt --all --check
cargo test --workspace --all-targets --locked
cargo clippy --workspace --all-targets --locked -- -D warnings
cargo build -p worldmusichub-desktop --release --locked
./scripts/windows-desktop-smoke.ps1 -Executable target/release/worldmusichub-desktop.exe -OutputDirectory desktop-evidence
```

Normal launch is simply:

```powershell
./target/release/worldmusichub-desktop.exe
```

The native workflow is `.github/workflows/windows-desktop-proof.yml`. It runs
only for a push to `diagnostic/native-windows-shell` or manual dispatch, uses
read-only repository permissions, checks out the exact triggering SHA, and has
a 45-minute job limit. The coordinating agent owns publication and CI dispatch;
this worker made no GitHub changes.

The smoke launches the release executable, bounds startup to 60 seconds, and
runs a small script inside that actual WebView only when the process owner sets
`WMH_DESKTOP_SMOKE_DIR`. It opens a catalog preview, mutes sound, enters the
original stage, requires locally rendered OSMD SVG, calls Rust compile and a raw
MusicXML error path, then captures the actual native HWND with Windows
`PrintWindow`. It records executable SHA-256/size, source SHA, UI/engine results,
window dimensions, sampled image color diversity, user agent and listener count.
Normal window close must exit successfully within ten seconds.

The only diagnostic write accepts at most 16 KiB of JSON at a fixed report
endpoint, only while that process-owned smoke option is set. It cannot choose a
path. Evidence artifacts contain JSON/PNG only. No debug network port is opened.

A successful script still needs visual inspection of `native-window.png`.
A non-uniform image is not a legibility, accessibility or design acceptance test.
A build failure, absent WebView2 runtime or unusable CI desktop is a failed gate,
not permission to substitute a browser screenshot or Linux run.

## Evidence and stopping condition

Local validation uses Linux only for the shared Rust service, transport rules
and existing frontend regression tests. It does not compile the `cfg(windows)`
implementation or execute a native GUI. No Linux GUI/browser launch was attempted.
See the accompanying verification report for exact completed commands/results.

The next gate is one authorized native Windows CI run at the final source SHA,
followed by inspecting its report and screenshot. Failures should be fixed in
this isolated branch and rerun at the new SHA. Stop the proof when native
startup, engine/asset smoke, no-listener and normal-close evidence pass, or when
an actual platform/authorization blocker prevents them.

No installer, portable runtime folder, signed binary or GitHub Release is
created here. CI does not upload the executable: the expanded Tauri dependency
notice inventory and Microsoft runtime distribution terms must be reviewed
before distributing it. The existing release workflow and 50-commit milestones
remain unchanged. Building an app-only EXE does not bundle the WebView2 runtime.

## What this does and does not decide

The proof tests whether existing visual and musical behavior can run in a real
Windows app with the Rust engine directly available and no server lifecycle.
It preserves DOM accessibility and offline OSMD while keeping the engine in
Rust. The costs are a WebView2 prerequisite, a new storage profile, native
packaging dependencies and a compatibility protocol that still needs refinement.

It does not measure physical MIDI, Web Audio output latency, native audio,
renderer-stall resistance, accessibility, installer reliability, update policy,
signing reputation or memory advantage over Electron. The existing JavaScript
transport/Web Audio scheduler remains in use. Native MIDI, clock/session
ownership, native persistence and the coherent UI redesign remain separate
acceptance work from the architecture assessment.

## Official references checked

- [Tauri asynchronous custom protocols](https://docs.rs/tauri/latest/tauri/struct.Builder.html#method.register_asynchronous_uri_scheme_protocol)
- [WebView window navigation and permissions](https://docs.rs/tauri/latest/tauri/webview/struct.WebviewWindowBuilder.html)
- [Tauri current ecosystem releases](https://v2.tauri.app/release/)
- [Windows distribution options and WebView2 prerequisite](https://v2.tauri.app/distribute/windows-installer/)

Exact API signatures and Windows protocol mapping were also checked in the
registry sources for tauri 2.12.1, tauri-build 2.7.1 and wry 0.57.0. The small
proof application icon is original MIT-licensed code-generated artwork;
`scripts/prepare-desktop-icon.py` reproduces it.
