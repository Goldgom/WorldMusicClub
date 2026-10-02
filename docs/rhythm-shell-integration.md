# Rhythm shell integration

This bounded UI group starts from accepted local160 (`f41421778a36e0988e54d4158c2c60e672231bd9`). It brings the purple/mint rhythm prototype direction into the existing Rust-backed application. It is not the standalone prototype.

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

## Validation state on 2026-10-02

- The focused real-app DOM suite passes 8/8 checks. The DOM harness uses the production application/controllers and fixture API responses; it does not execute Rust or a browser layout engine.
- The final aggregate `npm test` passes **733/733** tests with zero failures, skips or cancellations. The coordinator also ran `cargo test --workspace --all-targets --locked --offline` (292 passed), `cargo fmt --all --check` and strict clippy on this exact candidate.
- `node --check scripts/hosted-rhythm-check.mjs` and `git diff --check` pass.
- No Rust source, music timing, MIDI routing, score, engraving, or native-shell source was changed. Protected tracked files were hashed before and after this review.
- The frozen UI candidate was run in [hosted verification 37005768172](https://github.com/Goldgom/WorldMusicHub/actions/runs/37005768172) on remote commit `0bf973f3ac4dee2e1c8fa23efcd763a0549b4f65`, tree `f4a433a0e984930409713cd771b46d2116f2025a` (local equivalent `da6be512c71c8139c65bcc6597dc4ab4db144abb`). It passed 730 Node, 98 mocked-browser, 16 engraving, and the standalone rhythm checks; the existing real-app suite passed 76/81. All five failures were compact title clicks intercepted by the beginner guide at 844×390.
- This follow-on separates the compact title and guide into actual grid cells, reserves at least 64px for the title, and preserves the existing subtitle/keyboard-status row. The checkbox, full label, help and keyboard semantics remain active. No existing browser test was relaxed.
- The new hosted geometry/pointer and conditional cue-visibility checks are **authored, not run on this follow-on**. They inspect title/guide separation and actual center-point hits, then use normal title and label clicks, held/released note input, help clicks and checkbox Space activation in both compact locales, with the notation dock closed and open.
- A second pre-existing overlap is addressed only in presentation: `performance-view.js` marks the current cue state and clears it during active playback; scoped rhythm CSS hides the redundant paused piano overlay only with reduced motion. The localized transport pause status/Play button and canvas reduced-motion explanation remain. Ready, resumed count-in and completion states retain their original text and visibility; ordinary motion and guitar cues are unchanged. The hosted check asserts the paused rule, ordinary-motion visibility, localized visible/accessible transport, and retained ready/guitar cues.
- No local browser, native window, real server, installation, or runtime probe was launched during this review. Physical MIDI devices and acoustic latency are outside this UI group.

## Hosted verification contract

`scripts/hosted-rhythm-check.mjs` requires the authorized GitHub Actions runner and the source branch `integration/rhythm-ui`. It is excluded from `npm test`. A local browser launch remains explicitly denied; the hosted flag is not permission to run this script locally.

The existing `.github/workflows/check.yml` adds only this integration branch to its push trigger. Its branch-gated rhythm step follows the existing actual-app and engraving suites, reuses their locked npm dependencies, prepared renderer assets, Chromium installation and built Rust server, and preserves every existing gate and pinned action. It has no publish permission, release step, or new broadly permissive workflow. A failed prepared suite does not suppress another prepared suite's evidence, and any failure still fails the job.

The authored hosted matrix covers Chinese and English, light and dark, and 1280×720, 1920×1080, 844×390 and 390×844 views. It exercises the actual Rust compile endpoint, piano and guitar views, generated staff and Jianpu, retained follow controls, transport/falling-field/fret-row geometry, real free-performance recording and JSON downloads, and retained-session navigation. It does not claim that checking the follow control alone proves follow timing; the existing full-app suite remains the timing gate.

Each run records the exact checkout commit (including a PR merge commit when applicable), source head commit and ref, workflow commit/run URL, module hashes, browser version, planned/completed cases and failures. `results.json` is updated incrementally, with failure screenshots and server output retained when available. The existing always-run artifact upload includes that directory, even when a suite fails. An interrupted run may have `status: running`; it must not be counted as passed.

## Next vertical slice, still unimplemented

1. **Readable notation above the keys:** place the existing generated-staff/Jianpu surface above the playable piano keys while retaining one set of notation controls, source identity, page following and transport. Design and verify short-landscape and portrait bounds, notehead/number readability, keyboard access, and the interaction with beginner note labels before changing placement. The current side dock remains; this shell does not complete the requested relocation.
2. **Selectable skins:** extend the existing appearance settings with named, accessible presets and persistence, retaining explicit custom colors and stable input/recording state. The purple/mint light/dark presentation in this patch is not a new skin picker.
3. **Song folders:** add app-connected, persisted song organization with explicit membership for catalog and imported items, search/filter behavior and recovery tests. Preserve original score/source IDs and bytes. The existing searchable catalog and source-directory controls are not claimed as a new song-folder feature.

These are separate acceptance targets for subsequent work. They must receive their own actual-app and authorized hosted evidence before being described as delivered.
