# Native desktop integration and acceptance

## Source boundary

This integration starts from accepted application snapshot
accepted160 `f41421778a36e0988e54d4158c2c60e672231bd9`, tree
`194f9be3f94a3877a9010912dbd264dd5b8bb03b` (published equivalent
`389be86998dacaf2b199a71869735ae933149037`). It reuses the bounded native shell
from local proof `b960e7acd3eee9d0e882081b7b7837f6a4bb0cf0`, whose tree matched
hosted proof source `0dd75e861eaec62ef0449703708a20e84fd5af0d`.
[Proof run 36984703254](https://github.com/Goldgom/WorldMusicHub/actions/runs/36984703254)
passed native startup, offline OSMD, Rust compile/import, the single EXE listener
sample and normal close. That result does **not** accept this new integration.

All tracked `web/` and `crates/score-core/` files remain byte-identical to
accepted160. The coordinated MIDI notice callback and its regression were
already accepted in159, so this cumulative native patch does not replace them.
The original operation dispatcher is mechanically shared by
`practice-server` and the native custom-protocol adapter. Canonical score/source
bytes, exact rational time, Rust scoring, JS transport and audio behavior have
not been redesigned by this shell. The next UI snapshot must be integrated and
rerun separately at its own source SHA.

The visible product/window name is WorldMusicHub. The persisted identifier is
still `org.worldmusichub.desktop-proof`, and the intercepted origin is still
`https://wmh.localhost`. Despite the historical identifier spelling, do not
rename it casually: it identifies an existing local profile. Normal launch
uses Tauri's stable profile selection; CI redirects that same WebView storage
to one process-owner-selected temporary test profile and reuses it across four
processes. The normal production profile location is not redirected or deleted.

## Offline application and files

A normal `worldmusichub-desktop.exe` launch creates its own Windows window and
uses embedded UI/catalog/OSMD resources and the in-process Rust dispatcher. It
starts no HTTP server and does not open the default browser. The default shell
has no Tauri command, shell, filesystem, dialog, updater or HTTP plugin. Existing
HTML file inputs open the Windows file chooser; existing Blob exports are
handled by WebView2 downloads. Normal downloads retain WebView2's destination
behavior; the acceptance-only hook redirects them to a fixed evidence folder.
No score-origin path is treated as an OS command or arbitrary filesystem path.

Saved scores and performances remain separate IndexedDB databases. Explicit
Save commits a local snapshot; Stop alone does not promise crash recovery.
A browser installation uses a different origin/profile, so migration is manual:
export the score-library backup and separate performance backup in the browser,
then restore each in its matching native app panel. Keep the original backups
until the native saved records have been checked. No automatic migration or
native database implementation is claimed.

Runtime redistribution/notices are described in [DESKTOP_RUNTIME.md](DESKTOP_RUNTIME.md).
The bundler remains disabled; an app-only EXE does not contain WebView2.

## Authored hosted acceptance

Run `.github/workflows/windows-desktop-acceptance.yml` on a reviewed, exact source
SHA. The coordinator owns push/dispatch. It runs ordinary Node/Rust checks,
compiles the Windows implementation, then runs:

```powershell
./scripts/windows-desktop-acceptance.ps1 -Executable target/release/worldmusichub-desktop.exe -OutputDirectory desktop-acceptance
```

The harness uses the actual native HWND, Windows input and owned Windows file
chooser controls. It does not launch Playwright, open a remote debug port, use a
browser file-input substitution, or drive the local development machine's GUI.
Its script runs only when the process owner sets both
`WMH_DESKTOP_SMOKE_DIR` and a known `WMH_DESKTOP_ACCEPTANCE_PHASE`.
Without those settings the acceptance API/script/download redirection is absent.

The phases share one test profile:

1. **Seed:** load the catalog, stage and local engraved SVG; explicitly attempt
   non-SysEx MIDI and record the actual API result; select real MusicXML, MXL,
   MIDI-file and jianpu fixtures using the OS picker; save a canonical source;
   download/reselect its actual JSON file and compare the whole canonical object;
   repeat picker cancellation, reject malformed JSON, export/restore the actual
   score backup; repeat settings/score/results/import dialogs with native Escape
   and library/stage navigation; record three native PC-keyboard onsets across
   pause/resume and minimize/restore; Stop/Save, load saved history, export the
   sealed performance and separate backup, and restore that actual backup.
2. **Restart:** after normal close, launch the same EXE/profile. Require exact
   content hashes of all saved canonical scores and sealed performances, record
   counts and selected locale. Open a saved score and history through app controls.
3. **Close-active:** launch the same profile, verify persistence, start another
   silent free recording and send a PC key, then close the actual native window.
4. **Reopen:** launch again and require the previously explicitly saved records
   and settings unchanged. The unsaved active draft is not promised to survive.

Each phase has a 240-second bound and normal close a ten-second bound. Native
reports include executable/source provenance, process ID, one EXE-owned TCP
listener sample, timings and native screenshots. JSON output lists only fixed
fixture/action identities. Real download success is independently checked by
reading the actual saved files in `verify-desktop-evidence.mjs`, parsing them,
validating sealed recordings and comparing canonical content hashes. A Blob
click, DOM assertion or download-finished event alone cannot satisfy that gate.

The workflow first runs the inherited startup smoke with its 60-second startup
and ten-second close bounds, using a separate fresh profile. Failure artifacts
contain only bounded JSON/PNG/log evidence. The workflow never uploads the EXE,
WebView profile, installer or a GitHub Release. Inspect the screenshots and all
four renderer reports; a green job is not a complete visual/accessibility review.

## Ordinary MIDI scope and unresolved support

The old proof blocked MIDI twice: `midi=()` in Permissions-Policy and a deny-all
WebView permission callback. This integration changes only the trusted app
response directive to `midi=(self)`. `requestMIDIAccess({sysex:false})` remains
unchanged, and every native permission request is still denied. There is no
persistent permission grant, generic `Other` allow, SysEx allow, network MIDI,
new device adapter, or MIDI driver installation.

Microsoft documents MIDI SysEx permission in its
[WebView2 permission enumeration](https://learn.microsoft.com/en-us/dotnet/api/microsoft.web.webview2.core.corewebview2permissionkind).
The current [WebView2 differences list](https://learn.microsoft.com/en-us/microsoft-edge/webview2/concepts/browser-features)
does not list Web MIDI as unavailable; it is inaccurate to infer universal
WebView2 lack of MIDI support. However, Chromium
[requires permission for ordinary MIDI too](https://developer.chrome.com/blog/web-midi-permission-prompt).
The locked Wry 0.57.0 implementation maps
`COREWEBVIEW2_PERMISSION_KIND_MIDI_SYSTEM_EXCLUSIVE_MESSAGES` to
`PermissionKind::Midi` and unknown native kinds to `Other`. Allowing either enum
indiscriminately would not be a narrow ordinary-MIDI implementation.

The hosted test records API availability, explicit connect outcome, input count
without device identities if ready, and error type if denied. Denied/unsupported
states must show the app's English and Chinese localized status and retry notice.
A successful empty-device access result proves only API admission. A denial
keeps ordinary MIDI unaccepted and must be reported exactly; this group does not
work around it with a broader grant or speculative adapter.

## Remaining acceptance gates

- Run all authored Windows feature gates on the final integrated source and
  inspect actual screenshots. Linux checks do not compile `cfg(windows)` or prove
  a native file picker, download, focus, persistence or close result
- Integrate the next accepted UI separately; repeat the same exact-source suite
- Native scored take/history/results end-to-end, generated MusicXML/jianpu export,
  oversized picker imports and interrupted/stale native engine work remain
  separate from the covered canonical/free-record paths
- Native keyboard IME/layout/rollover, sustained held-note cleanup across close,
  accessibility and actual user-scale window sizes need Windows acceptance beyond
  the three synthetic OS-key events and minimize boundary
- Physical MIDI enumeration/selection/hotplug/reconnect, real device timestamps,
  release cleanup and latency need their own supported API and hardware result
- Audio output/latency, replay audibility and native scheduling remain untested;
  this acceptance is intentionally silent
- Complete Windows dependency notice inventory and runtime redistribution terms,
  build an approved package, and verify on a clean Windows machine with/without
  WebView2 before calling an installer or portable package distributable
- Signing, updates and release delivery remain separate; no full-product or
  release-readiness claim follows from this integration

The existing asynchronous adapter limits are unchanged: the WebView may allocate
a request body before Rust admission; aborting a frontend fetch does not cancel
already running Rust work. This work does not resume the separate security audit.
