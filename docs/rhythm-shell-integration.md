# Rhythm shell integration

This UI group was developed from accepted160 and is integrated onto accepted162 (`6fc72689cad2db23e4f4ebc8f23154a48bcca13a`). It brings the purple/mint rhythm prototype direction into the existing Rust-backed application. It is not the standalone prototype.

## Implemented flow

- The lobby has a music hero, the actual searchable catalog and compiled score preview, and a free-practice entry card
- That card moves the existing `start-free-practice` button with its original handler
- The stage has a free-practice link; the free screen can return to the retained score session
- The brand returns through the existing screen transition, preserving session state and pause/cleanup behavior instead of reloading the page
- Free recording controls, recording status, MIDI/PC input, save, export, record history and comparison remain the original application nodes and controllers
- Normal light/dark themes use the new palette. Explicit custom theme colors remain controlled by the existing appearance settings

All new copy is paired in `web/locales/rhythm-en.js`, `rhythm-zh-CN.js`, and `rhythm-schema.js`. The only central catalog changes are imports and spreads. Locale switching does not replace controls or authored text.

## Integration boundaries

`game-shell.js` initializes and updates the new `rhythm-shell.js` presentation layer. `index.html` includes `rhythm-shell.css` last. The new CSS is scoped to `.rhythm-shell`. It does not replace the musical engine, transport, MIDI/PC routing, score/source exports, notation follow, or instrument planners.

The module does not replace `.stage-heading` descendants or select every span in that heading. Existing keyboard stage metadata and accepted160 beginner controls retain their DOM identities. No beginner or native-shell files are changed.

The falling canvas reserves at least 100 CSS pixels, including compact landscape. The piano content can scroll internally when necessary. Compact guitar grid sizing remains inherited from accepted local160, with the existing 56-pixel minimum for fret labels and one complete string row. All six string rows remain available through the board scroll.

## Verification

`npm test` includes `tests/frontend-rhythm-shell.test.js`. Its real app DOM harness verifies:

- Record, navigate home, re-enter, resume, stop, save and export without recreating controls
- Stage → free → retained stage with identical scored and free record exports
- Chinese/English redraw while recording without sound, request, mapping or draft mutation
- Accepted160 beginner control identities, custom appearance, and unchanged source/take exports across repeated stage/free and locale transitions
- Scoped style rules, palette contrast, the 100-pixel falling field and retained compact fret minimum

## Validation and recovery history

Frozen source `5d347046e23f9fd7c8334d921ea85cdf2215ca98` passed [hosted run 37016198454](https://github.com/Goldgom/WorldMusicHub/actions/runs/37016198454): 734 Node tests, 98 mocked browser checks, 81 actual Rust-backed application checks, 16 actual engraving checks, the six-case rhythm screen matrix and Rust checks on Linux and Windows. Downloaded evidence contains exact source/module/binary hashes and actual screenshots. Physical MIDI and acoustic latency are not covered.

Run 37005768172 exposed compact title clicks intercepted by the beginner guide; run 37010958792 exposed six pixels of canvas clipping in the extreme-key guide case. Separate grid cells and reduced compact navigation/transport padding correct these defects. Existing 34px button targets, 100px canvas, 104px extreme keybed and all original assertions remain. Scoped reduced-motion piano CSS hides only the redundant central paused cue; localized transport state, Play button and canvas explanation remain visible.

This source group is combined with accepted162's bounded imported-score engraving, full tie context and source identity checks. The combined snapshot requires its own Linux and Windows browser/package runs before delivery; the earlier branch result is not combined acceptance.

## Hosted verification contract

`scripts/hosted-rhythm-check.mjs` requires GitHub Actions, the explicit hosted flag and project source branch `integration/rhythm-ui`, `dev/initial-prototype` or `main`. It is excluded from `npm test`; local browser execution remains unauthorized.

General verification runs rhythm checks alongside existing actual-app and engraving checks. The Windows package workflow runs the same matrix against the exact release executable before packaging, retaining screenshots, JSON and logs. Existing gates and pinned actions remain. No Release publication or write permissions are added.

The matrix covers Chinese/English, light/dark, 1280×720, 1920×1080, 1033×403, 844×390 and 390×844. It exercises the actual Rust endpoint, piano/guitar, staff/Jianpu, follow controls, pointer/keyboard targets, transport/field/fret geometry, free-performance recording/downloads and retained-session navigation. Existing full-app tests remain the follow-timing gate.

Results record exact checkout/source/workflow commits, source ref, run URL, module/binary hashes, browser version, planned/completed cases and failures. Incremental evidence survives failures; interrupted status is not a pass.

## Above-key notation candidate

The above-key UI integration retains the original `notation-dock` and puts it
in reading order before the play panel. When actual viewport space permits, it
uses an opaque full-width row inside the game stage above the playable keyboard.
Staff, basic pitch guide and Jianpu remain the original renderers and controls.
Optional staff display settings use the existing Help disclosure, while page
controls and the full Follow status remain outside it. The renderer still owns
exact source-note following and manual-page suspension.

The first desktop piano entry (width over 650px, height at least 700px) opens
the score automatically. An explicit visibility toggle is retained for the rest
of the session, including library/free-stage round trips. The primary 1280×720
and 1920×1080 acceptance cases require above-key placement rather than a side
column. Compact transport/input padding preserves full controls while recovering
the laptop score budget; transport buttons retain their 38px targets.

`stage-notation-layout.js` budgets the actual HUD, notices, transport, key height,
beginner row, pan controls and fingering guidance. It reserves a 100px falling
canvas, the complete original keys and strike line, and scrollbar space before
allocating a 240–360px score band (at least 300px in portrait). The canvas, strike
and keys retain one horizontal scrolling surface. The score never covers that
surface. No glyph scale is reduced to make the layout fit.

This is a candidate, not hosted visual acceptance. At 1033×403 and 844×390, the
required instrument and control space leaves insufficient room for a readable
band. The existing side layout remains there. Smaller portrait or a large open
guide/notice can also retain the previous fallback instead of forcing clipping.
At a compact portrait fallback the same native score toggle returns to the
playable piano; the hosted regression verifies that keyboard-operated switch.

A synchronous candidate-layout measurement includes controls hidden by the old
portrait layout and the exact localized wide-range pan label. Rejected probes
restore scroll positions and controller-owned text before returning. This avoids
feedback loops caused by measuring a hidden control as zero height. A focused
setting moved into Help opens that disclosure before focus is restored.

Pure Node/DOM coverage verifies budget boundaries, resize coalescing, stable
control identities, preserved Follow choice and disposal. Threshold regressions
cover guidance, wrapped beginner/pan controls and static status with a practice
gate; repeated observer frames must settle with no further height changes. Hosted tests retain
viewport, clipping, key access, canvas minimum and paused-take checks; placement
checks distinguish the top band from the compact side fallback. The new original
two-staff fixture adds actual page following into measures 9–12 and staff/Jianpu
round trips, paused practice-take preservation, held key contacts through resize
and notation switches, and a separate staff/Jianpu screenshot at every size.
The grand-staff case uses Practice so a real recorded pass exists before exporting
its take; source notes and all 12 written measures remain identical on export.
These browser assertions and screenshots require an authorized hosted run; no
browser, GUI, headless runner or server was launched locally.

Integration base: `90c206b7c776d7d324b335644c8adaba880a75de` (local174).
Local validation: `npm test` passed 795/795 Node/DOM tests; the focused notation
following, numbered layout and runtime locale suites passed 37/37. JS syntax and
`git diff --check` passed. Rust source, native package code and workflow files are
unchanged; Rust/binary and real-browser acceptance belong to the merged hosted run.

Expected new browser evidence under `WMH_ARTIFACT_DIR` (the full-app runner uses
the OS temporary directory if unset):

- `worldmusichub-above-keyboard.json`: original source, exact two-voice cues,
  all viewport geometry, manual-follow behavior and held-contact result
- `worldmusichub-above-keyboard-1280x720-staff.png` and `-jianpu.png`
- `worldmusichub-above-keyboard-1920x1080-staff.png` and `-jianpu.png`
- Equivalent staff/Jianpu PNGs for `1033x403`, `844x390`, `390x844`

The hosted rhythm runner additionally writes `desktop-zh-dark-staff.png`,
`desktop-zh-dark-jianpu.png`, `desktop-en-light-staff.png`,
`desktop-en-light-jianpu.png`, `wide-zh-dark-staff.png`, and
`wide-zh-dark-jianpu.png`, plus matching `*-notation-geometry.json` files
and its provenance/results JSON under its configured artifact directory.
The default standalone hosted directory is `test-results/rhythm-shell`.

## Next vertical slices, still unimplemented

1. **Selectable skins:** extend the existing appearance settings with named, accessible presets and persistence, retaining explicit custom colors and stable input/recording state. The purple/mint light/dark presentation in this patch is not a new skin picker.
2. **Song folders:** add app-connected, persisted song organization with explicit membership for catalog and imported items, search/filter behavior and recovery tests. Preserve original score/source IDs and bytes. The existing searchable catalog and source-directory controls are not claimed as a new song-folder feature.

These are separate acceptance targets for subsequent work. They must receive their own actual-app and authorized hosted evidence before being described as delivered.
