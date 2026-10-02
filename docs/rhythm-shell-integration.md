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

The matrix covers Chinese/English, light/dark, 1280×720, 1920×1080, 844×390 and 390×844. It exercises the actual Rust endpoint, piano/guitar, staff/Jianpu, follow controls, pointer/keyboard targets, transport/field/fret geometry, free-performance recording/downloads and retained-session navigation. Existing full-app tests remain the follow-timing gate.

Results record exact checkout/source/workflow commits, source ref, run URL, module/binary hashes, browser version, planned/completed cases and failures. Incremental evidence survives failures; interrupted status is not a pass.

## Next vertical slice, still unimplemented

1. **Readable notation above the keys:** place the existing generated-staff/Jianpu surface above the playable piano keys while retaining one set of notation controls, source identity, page following and transport. Design and verify short-landscape and portrait bounds, notehead/number readability, keyboard access, and the interaction with beginner note labels before changing placement. The current side dock remains; this shell does not complete the requested relocation.
2. **Selectable skins:** extend the existing appearance settings with named, accessible presets and persistence, retaining explicit custom colors and stable input/recording state. The purple/mint light/dark presentation in this patch is not a new skin picker.
3. **Song folders:** add app-connected, persisted song organization with explicit membership for catalog and imported items, search/filter behavior and recovery tests. Preserve original score/source IDs and bytes. The existing searchable catalog and source-directory controls are not claimed as a new song-folder feature.

These are separate acceptance targets for subsequent work. They must receive their own actual-app and authorized hosted evidence before being described as delivered.
