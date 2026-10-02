# Supplemental native reference-listening acceptance

This supplement layers over the separately reviewed complete MIDI reference UI. It changes only process-owner acceptance code, the finite original fixture allowlist, downloaded-byte verification, and package evidence gates. It does not change production UI, API, player, storage, difficulty controls, workflow YAML, or dependency-cache keys. The workspace/artifact directory number does not assign a source commit count.

## Hosted execution

Use the existing hosted Windows native acceptance workflow against the reviewed UI plus this supplement. Its ordinary sequence builds the actual native executable, runs:

```
./scripts/windows-desktop-acceptance.ps1 -Executable target/release/worldmusichub-desktop.exe -OutputDirectory desktop-acceptance
```

and packages only after all native gates succeed. Do not run the script locally in the restricted research environment. No GUI, browser, headless process, native runner, or server was launched while authoring this supplement.

The startup smoke and all four feature-acceptance phases start at the actual home menu, activate `#home-single-player`, and wait for a visible, enabled library preview. An enabled Listen control inside the hidden library is not readiness. Stage entry also waits for preview activation to finish before Reset. The normal extracted-EXE check uses the visible, enabled Single player home control in Windows UI Automation; it does not wait for the hidden library's Listen button.

Free-practice acceptance follows Stage → Library → Main menu → the original `#start-free-practice` control (or Library → Main menu on restart). It waits for the visible, enabled recorder controls and a cleared operation-busy state, then preserves all existing actual Windows keyboard/recording checks. `#free-exit` must return to the library before retained-stage/reference work continues. These navigation waits use existing bounded deadlines and add no native action or download requests. The matching ordinary Node contracts exercise the real app menu handlers with a DOM fixture; they are not native acceptance evidence.

The injected `reference-acceptance.js` executes in the existing seed phase after the original four-file/library/free-record checks. It first captures one actual Windows typing-keyboard onset in a paused scored take. It opens the real Import entry and uses the existing native common-file-picker route with the exact allowlisted `original-reference-overlap.mid` file. No `setInputFiles`, synthetic change event, patched fetch, fake audio, or generated event JSON supplies that native selection.

The 208-byte original fixture is materialized directly from the original synthetic specification in `tests/reference-listening-fixture.js`: three tracks, 26 events, eight positive onsets, overlapping identical keys, and channel index 9/program 118. Pure tests verify the static fixture is byte-exact to that specification. It contains no third-party music.

## What must pass

- Visible total/per-track counts and source program 118 match the real Rust response and exact fixture SHA-256
- Explicit reference policy and the shared global sound setting gate playback; loading/policy/sound selection start no source
- Actual native Play/Pause/Resume/Stop/Close controls operate the real reference player
- An actual native canceled chooser retains the source and paused clock and leaves no active/scheduled source
- A complete all-track run starts exactly fourteen oscillators; a completed independent-track-muted pass starts exactly the expected ten oscillators, retaining all source counts
- Global sound-off and Close leave no active or scheduled oscillator/buffer sources; enabling sound starts nothing automatically
- The native typing key inside the listener does not enter the paused score take
- Live locale switching preserves controls/source/paused clock; original score and typed take exports remain exactly equal before/after

Audio observation wraps existing AudioContext node creation and forwards every real `start`, `stop`, and `disconnect`. It records source timing and distinguishes pending/active/canceled voices. It is neither an audio mock nor evidence of speaker output, physical MIDI, latency, or acoustic fidelity.

## Evidence and bounds

The seed phase adds 30 native actions and five exports to the existing 31 actions/four exports: **61 actions and nine downloads**. The established 64-action and 16-download limits are unchanged. The only new allowlisted filename is the exact original fixture; path traversal and extra suffixes remain rejected.

The original `downloaded-files.json` retains its required **exactly four** entries. `verify-reference-native-evidence.mjs` separately verifies the five reference files: original MIDI, before/after canonical score, and before/after scored take. The native download callback's `seed-N.json` filename also applies to the binary MIDI payload; verification compares bytes rather than the extension. Typed evidence must match its positive capture/input by event and pass identity, with no truncated/omitted observations. Changed inputs, assessments, clock segments or other take content fail equality.

A separate `native-reference-files.json` records byte/content hashes and the exact `renderer-seed.json` hash. The acceptance script requires this verification before native acceptance can become successful. The package source/tree/executable gate then independently rechecks this proof in read-only mode, requires all reference UI and cleanup checks, and copies it into the package inventory. Missing, stale, altered or incorrectly routed proof fails closed. The existing four-file gate is unchanged.

Node/pure Rust/Python contract results are ordinary tests only. Actual hosted Windows reference UI acceptance and downloaded artifacts remain pending until the integrator runs this exact cumulative source.
