# Android and source-bound score integration

This integration retains both exact histories: Android main
`a416530449a1720d627523278e3351ba77f4700c` (nine user commits after
`e44dfc266a8ae9f0a83810ed9cc8722fed023f67`) and source identity, Basic Human
admission, adjacent temporal rows and complete reader checkpoint
`e75fb5fa2e7fa39c9f839f05cc357d30e4279978`.

## Shared behavior

- Android remains Java/WebView, JNI and the shared Rust request dispatcher.
  This is not a Unity port. Windows shell features remain enabled by default;
  Android retains its existing `default-features = false` dependency.
- Row mode keeps full-size SVG paint while Android's explicit SVG width/height
  fitting keeps measured and painted bounds aligned. CSS zoom is not restored.
- Current and adjacent native pages are published as one source-owned pair.
  Parsing, validation and publication respect the audio startup admission gate.
- Complete-reader parsing, native validation, retained-row repaint, event and
  coverage publication also respect audio admission. Close or source replacement
  aborts queued work; already returned renderers remain owned for disposal.
- Platform anchor lead remains 250 ms on Android and 50 ms elsewhere. Existing
  sample-clock authority, bounded acknowledgement, bridge/header limits and
  legacy WebView layout fixes remain unchanged.
- The combined Worklet closure contains 17 modules, including
  `audio-start-lead.js` and `source-practice-eligibility.js`. Source/evidence
  verification keeps an explicit 32-module bound and existing byte bounds.
- New shared web assets are recursively embedded by the Rust server build.
  Rebuild the Android library/APK to include them; no downloaded web runtime is
  substituted.

## Acceptance still required

Pure Node and Python checks are not native or package acceptance. Before any
promotion, follow `AGENTS.md` on the exact final commit: Rust workspace tests,
formatting/clippy, real-browser suites, Windows/native acceptance, Android build
and actual device/WebView checks.

On Android verify dense two-row geometry and note bounds, short-screen complete
reader scrolling, final-row retention, source replacement, close/reopen, and
seek/start/pause/resume with pending notation responses. Include event-only and
unsupported pages, import/export dialogs, and saved-source Human admission.
Aborting a JavaScript waiter does not cancel already-running JNI work; late
responses must not publish to a replaced source.

Original genuine Rust fixture and golden bytes were preserved. The pending
Basic Human/native golden regeneration and exact-source acceptance described in
`BASIC_HUMAN_ADMISSION.md` still apply; do not hand-edit generated evidence or
claim a successful APK build establishes those gates.
