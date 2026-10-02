# WorldMusicHub: Chinese-first practice UI spike

This is an isolated, runnable DOM/CSS + Canvas2D interaction prototype. It is not a release, a replacement application, or a claim that the Rust engine/native shell/MIDI path has been integrated. The existing application repositories are not modified.

## What works

- A Chinese-first practice lobby, one original 32-note exercise, and a separate local free-practice entry
- A landscape practice scene with a synchronized numbered-score dock, current/next note, six-string fretboard, and one explicit fingering path
- Start, pause, resume, restart, score-note seeking, progress seeking, and 60–140 BPM tempo selection
- Number keys 1–7 and pointer/keyboard activation of fretboard positions; actual input count and a bounded recent-input view in free practice
- A synthesized guide tone and input preview; sound toggle, pause/blur cleanup, and separate audio lookahead and drawing loops
- Chinese/English catalog selection and dark/light themes, including dynamic labels, accessible names, notices, and page title
- Paused-session retention when navigating to the lobby and back; no automatic resume on returning or refocusing

The exercise and visual assets were composed/drawn specifically for this spike. No downloaded scores, fonts, music recordings, images, or external runtime dependencies are used. System fonts supply text and symbols. The full explicit guitar path is string 2 at frets 1, 3, 5, 6, 8, 10, and 12 for C4–B4. Other fingerings are not claimed to be equivalent recommendations.

## Run

Requires Node.js 22 or later. No package install is needed for the app or pure tests.

```sh
cd worldmusichub-ui-spike
npm test
npm start
```

The server listens only on `http://127.0.0.1:4173`. It serves an explicit allowlist of five app files, uses a restrictive CSP, and makes no network requests. There is no shell execution or upload API. Set `PORT` to change the loopback port.

Opening this app in a browser is a separate action: do not launch a browser in an environment where that action has been denied. The current workspace work used Node and DOM tests only.

## Local verification already performed

On 2026-10-02, the following passed against these source files:

- `npm test`: 13 pure model and catalog tests
- `test:dom`: 6 tests that mount the actual app, using the already installed `linkedom` 0.18.12 in the existing application checkout
- JavaScript syntax checks

To reproduce DOM tests using a normal dependency install on an authorized runner:

```sh
npm install --no-save --package-lock=false --ignore-scripts linkedom@0.18.12
npm run test:dom
```

Or reuse an already installed copy without installation:

```sh
WMH_LINKEDOM_MODULE=/absolute/path/to/linkedom/esm/index.js npm run test:dom
```

DOM tests do not create a browser, audio device, canvas rasterization, or GUI. They are not visual acceptance. Hosted screenshot tests are prepared but were not executed in this workspace.

## Authorized hosted browser and screenshot entry

The parent task coordinates this stage. Transfer this directory unchanged to the authorized remote CI workspace; do not publish it or write to GitHub just to run it without the parent's authorization. On that runner:

```sh
npm install --no-save --package-lock=false --ignore-scripts linkedom@0.18.12 playwright@1.63.0
npm test
npm run test:dom
npx playwright install --with-deps chromium
WMH_HOSTED_BROWSER=1 npm run test:hosted
```

The runner should have an installed Chinese system font, such as Noto Sans CJK, for faithful Chinese screenshots. Use the runner's established font image or supported package workflow. No font is bundled by this spike. Node module versions above match the packages already available in the existing workspace. A normal pinned dependency lock should be added if this spike is promoted into an application branch.

The hosted script starts/stops its own loopback server and tests:

1. Chinese dark lobby and guided stage at 1280×720, 1920×1080, 844×390, and 390×844
2. English light lobby and stage at 1280×720
3. Transport advancement, exact visible score seeking, paused lobby/resume retention, single current marker, full 78-position fretboard, and desktop/landscape simultaneous-layout bounds
4. Free-practice input capture through real keyboard events and restart cleanup
5. Runtime errors and console errors

It writes 11 PNG screenshots plus `artifacts/hosted/results.json`, including viewport geometry, browser version, and SHA-256 hashes of the exact app and test sources. Inspect screenshots after the run before claiming visual acceptance. The screenshots deliberately capture a reproducible paused note at beat 6; the same run separately proves live transport advancement. Reduced-motion rendering is exercised; this is not a smooth-motion performance benchmark.

A hosted job can use these steps with this directory as its working directory, then upload `artifacts/hosted/` as the CI artifact. No CI workflow or GitHub mutation has been performed here. Environment variable `WMH_HOSTED_BROWSER=1` is an execution guard, not authorization on its own.

## Integration boundaries

- `model.js`: small presentation/session stub with an injected monotonic clock. Replace it with checked Rust session snapshots; retain its transport view contract, not its clock as production authority
- `app.js`: semantic view/state wiring, input display, Canvas2D rendering, and prototype Web Audio. Split into session adapter, input adapter, stage renderer, and audio backend when integrating
- `locales.js`: identical Chinese/English key and parameter contracts. Map these into the existing application's established locale schema rather than starting a second production i18n system
- `styles.css` and `index.html`: shared visual tokens, lobby, score dock, instrument surface, and transport layout

The numbered-score dock is a simplified pitch/rhythm guide for this quarter-note original exercise. It is not engraved notation, a MusicXML renderer, or an OSMD replacement. Keep the production OSMD source binding and canonical score pipeline.

There is no grade, combo, accuracy percentage, persistence, MIDI connection, native shell, device latency measurement, or Rust assessment in this spike. Input counts do not imply successful hits. Inputs can sound before Start, but only inputs captured during the active practice clock count. Recent free-practice inputs are capped at 32 while total input count remains exact for this page. Inputs and sessions are in memory only; selecting a different practice mode starts a new session. Only language and theme preferences are stored locally.

The guitar fretboard is a compact visual/input aid. It is not a touch-first fingering surface, an 88-key piano view, or verified physical fingering instruction. Short landscape uses compact note/fret targets; real target-device usability and accessibility still require review. No performance, acoustic-latency, or Windows/WebView2 acceptance claim is made.
