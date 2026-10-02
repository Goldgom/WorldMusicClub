# Native Windows runtime and redistribution preparation

Status, 2026-10-02: **notice preparation is verified locally for the locked
Windows x64 dependency graph; a native installer and clean-machine offline
installation have not been verified.** This document does not authorize a
Release or change the existing browser-app release workflow.

The desktop proof still has `bundle.active: false`, identifier
`org.worldmusichub.desktop-proof`, and application origin
`https://wmh.localhost`. Preserve the identifier and origin when moving to an
installer: changing them can change the application's storage/profile identity.
The current app-only EXE embeds the UI and score assets, but does not contain a
WebView2 Runtime. See [DESKTOP_PROOF.md](DESKTOP_PROOF.md) for the native proof
and [WINDOWS.md](WINDOWS.md) for the separate browser/server distribution.

## Proposed offline installation route

For the first installable Windows x64 build, prepare an **Evergreen Standalone
Installer** route. Microsoft documents it for offline installation and supports
per-user and per-machine deployment. Detect an existing Runtime before setup;
having Edge installed is not the same prerequisite. Evergreen subsequently
updates when the machine's policy and connectivity allow it. A disconnected
machine needs an explicit runtime servicing plan.
([Microsoft distribution guidance](https://learn.microsoft.com/en-us/microsoft-edge/webview2/concepts/distribution))

Tauri's corresponding future bundle setting is
`bundle.windows.webviewInstallMode.type: "offlineInstaller"`. An embedded
bootstrapper still downloads the Runtime and does not satisfy clean-machine
offline installation. Keep bundling disabled until the package and runtime
terms have been reviewed and the acceptance gate below is ready.
([Tauri Windows installer options](https://v2.tauri.app/distribute/windows-installer/#webview2-installation-options))

A Fixed Version Runtime is an alternative for a future portable folder with
strict runtime-version control. It requires shipping the runtime files,
selecting their path, and maintaining updates in application releases.
Microsoft also documents Windows 10 unpackaged-app permissions and a network
path limitation. It needs its own deployment test; copying an app EXE alone
does not establish this mode.
([Microsoft Fixed Version guidance](https://learn.microsoft.com/en-us/microsoft-edge/webview2/concepts/distribution#the-fixed-version-runtime-distribution-mode))

No Runtime installer/CAB has been downloaded, executed or bundled by this
preparation. No Runtime download agreement has been accepted. Before adding a
specific Runtime payload, retain its Microsoft download URL, version,
architecture, SHA-256, signature verification result, associated runtime
license and third-party notices. Review the actual terms offered for that
payload; the SDK loader license below does not license the Runtime.
([Official Microsoft Runtime downloads](https://developer.microsoft.com/en-us/microsoft-edge/webview2/))

## Reproduce the Windows notice inventory

Use Python 3.11 or later, the exact build Rust toolchain with `rust-docs`, and
the committed Cargo lockfile. Run this on the native Windows x64 build host
before packaging:

```powershell
cargo fetch --locked --target x86_64-pc-windows-msvc
python -m unittest discover -s tests -p 'test_*.py'
python scripts/prepare-rust-notices.py --target x86_64-pc-windows-msvc --output dist/licenses/rust
```

The fetch is a separate preparation step against official locked registry
packages. The generator uses `cargo metadata --locked --offline`, reads local
package/cache bytes, and executes no dependency code or network downloads.
Use a fresh output directory for each build. Redistribute the entire generated
directory, including `sources/` and `licenses/`, alongside the separate
engraving and score-catalog notices.

The generated manifest is format 2 and records its target, Cargo.lock hash,
exact Rust toolchain, package notice hashes, fallback provenance, vendor loader
identity, and source archive hashes. Its 276 current entries include the three
workspace packages plus 273 dependencies, including build dependencies. It is
a conservative target inventory, not a claim that all entries are linked into
the EXE. A Linux preparation run verifies inventory mechanics only; regenerate
the standard-library collection using the actual Windows release toolchain.

Omitting `--target` preserves the all-target inventory behavior. That expanded
417-package graph currently fails closed at `block2 0.6.2`, whose published
crate has no complete license notice. Other non-Windows notice gaps remain.
The upstream objc2 licensing overview is not a substitute for full notice
texts or an Apple SDK distribution review. Do not remove this failure or label
the all-target inventory complete. Both native acceptance and the existing `windows-release.yml` now explicitly
select their actual `x86_64-pc-windows-msvc` inventory. This source-only workflow
adjustment avoids claiming that unshipped platforms have complete notices; no
legacy release was dispatched by this preparation.

## License and source material included

- The collector recognizes both `LICENSE` and `LICENCE`, declared license files,
  and nested notices. This retains the locked plist license, regex-syntax
  Unicode notice, and tracing-core spin attribution that a top-level-only scan
  missed. Unknown expressions and missing notices still stop preparation.
- The missing defmt-parser and WebView2 Rust-wrapper notices are copied from
  the exact upstream commits recorded by their published crates. File SHA-256,
  upstream Git blob SHA, commit, and exact package version are retained in
  `third_party/rust/manifest.json`. Their MIT option is selected explicitly.
  The existing midly and zune fallbacks are preserved; dunce 1.0.5 uses its
  published CC0 option.
- The five MPL-2.0 packages are cssparser 0.37.0, cssparser-macros 0.7.1,
  dtoa-short 0.3.5, option-ext 0.2.0 and selectors 0.38.0. Their original `.crate`
  source archives are copied from the Cargo cache into `sources/` only after
  matching Cargo.lock checksums. Notices identify the local source files and
  official registry URLs. selectors declares MPL-2.0 in its metadata and source
  headers but omits a full license text; its fallback is the unchanged canonical
  MPL text from the locked cssparser package, with that provenance retained.
  The generated collection preserves the MPL source rights and notices;
  modification of a covered package requires revisiting the source bundle.
  ([MPL distribution responsibilities](https://www.mozilla.org/MPL/2.0/#responsibilities))

## Microsoft SDK loader is separate from the Runtime

The locked `webview2-com-sys 0.39.1` crate includes Microsoft's native loader
files. Its MSVC path links `WebView2LoaderStatic.lib`; the Rust wrapper's MIT
notice alone does not describe that vendor code. Microsoft documents static
or architecture-matched dynamic loader distribution separately from the
Runtime prerequisite.
([Microsoft files-to-ship guidance](https://learn.microsoft.com/en-us/microsoft-edge/webview2/concepts/distribution#files-to-ship-with-the-app))

All nine loader files (DLL, import library and static library, across x86, x64
and ARM64) were compared byte-for-byte with Microsoft's official
`Microsoft.Web.WebView2 1.0.3800.47` NuGet archive. Only the unaltered SDK
`LICENSE.txt` and `NOTICE.txt` are committed as supplemental notices. The
generator rechecks the crate's loader bytes and those notice hashes. The
manifest labels the SDK loader BSD-3-Clause separately from the Rust wrapper.

Source: [Microsoft's SDK package](https://www.nuget.org/packages/Microsoft.Web.WebView2/1.0.3800.47)
and [official versioned package archive](https://api.nuget.org/v3-flatcontainer/microsoft.web.webview2/1.0.3800.47/microsoft.web.webview2.1.0.3800.47.nupkg).

| Reviewed item | SHA-256 |
| --- | --- |
| Official SDK archive | `56c9f26bdd07916a2d1949fb58a5c7e434dfa1173577dca879206050c4e718db` |
| x64 `WebView2LoaderStatic.lib` | `89c6b872783b8f6c3cedbff618adb42082d455c615453ae10cfc753f1e8f25d8` |
| SDK `LICENSE.txt` | `0af8f1b807512aae39c2ac1aa4d0cae65cabecb6fd554b8439a5162a0d6eca55` |
| SDK `NOTICE.txt` | `106423785c5b7eba0a8e61d1837f2132e9c828e20ad530f565d981c1df60dd90` |

This check establishes provenance and retained notice material. It does not
claim that a native release executable was built, signed, installed or tested.

## Completed checks and remaining packaging gate

On Linux with Rust 1.99.0, the Windows-target generator passed for 276 packages,
five lockfile-verified MPL archives and the installed Rust standard-library
notices. All 39 Python tests passed, including nine collector tests covering
nested/declared notices, exact fallback versions, changed notice/library/source
bytes and license selection. The full-target generator was also run and
failed at the explicit non-Windows blocker above. No local GUI, browser or
Playwright test was run for this preparation.

Before publishing an offline installer, record evidence from the exact source
SHA and intended supported Windows x64 versions:

1. Build with the native MSVC toolchain, resolve all link/runtime prerequisites,
   and record executable, installer, dependency and runtime hashes. Regenerate
   notices from that host and verify the complete package inventory.
2. On a clean machine without the WebView2 Runtime, disconnect networking and
   install from the prepared offline package. Confirm the chosen per-user or
   per-machine behavior and handle refusal/cancellation without a partial app.
3. Launch the actual desktop window, inspect its captured native screenshot,
   and pass the engine/assets, import/export, profile persistence, no-listener
   and normal-close checks defined by the native acceptance workflow. Repeat
   from a fresh profile and after restart.
4. Test the package on a machine with an existing compatible Runtime; record
   the minimum Runtime version actually exercised. Verify upgrade and uninstall
   behavior without unexpectedly discarding user scores or settings.
5. Complete the separate runtime-terms, signing/publication and support-policy
   decisions. Offline installation success is not evidence for physical MIDI,
   audio latency, accessibility or every supported machine configuration.

Until those gates pass, describe the result as a native shell with prepared
Windows notices and a runtime prerequisite, not an accepted offline installer.
