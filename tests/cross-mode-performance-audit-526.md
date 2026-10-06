# Cross-mode performance audit of public526

Base: `1db03b10e165346d8bfc0b42de995d559491d312`. The audit found and fixed one shared transport-clock defect. `web/transport.js` is the only changed production file.

The initial clock-read clamp was superseded after integrated validation exposed early PV/source-follow behavior. See `cross-mode-performance-anchor-followup-533.md` for the corrected pause-only boundary and its media verification limits. The retained 526 JSON evidence records that earlier candidate, not full acceptance.

## Fixed: early Resume → Pause rewound Basic and VSQ

Pause a Basic MIDI or VSQ performance, resume, then pause within the 50 ms audio admission lead. The transport subtracts the remaining lead from the saved source position even though resumed source audio has not elapsed. The recorder retains the original resume position, leaving the paused clock and recorder out of agreement. Canonical JSON/MusicXML correctly retain the held position.

This is reproduced by `cross-mode-performance-resume.test.js` through actual `web/app.js`, Mod, player and DSP-core paths, and independently by `cross-mode-performance-native.mjs` with freshly built Rust native dispatch:

| Native source | Before rapid Resume/Pause | After | Result |
|---|---:|---:|---|
| Canonical JSON | 70 ms | 70 ms | Preserved |
| Basic MIDI | 69.875 ms | 19.875 ms | Rewinds 50 ms |
| MusicXML import | 70 ms | 70 ms | Preserved |
| VSQ base-note interpretation | 70 ms | 20 ms | Rewinds 50 ms |
| Return to canonical JSON | 70 ms | 70 ms | Preserved |

The narrower DOM regression observed 150 → 100 ms for both affected profiles. `Transport.time()` added `now - startedAt` even while the accepted anchor remained in the future. Canonical has its own held source-clock handling.

The corrected fix keeps signed initial/resumed clock reads and prevents `Transport.pause()` from saving the unelapsed admission lead as a source rewind. It preserves the stored source position, including an explicit negative count-in, without changing scheduling reads or accepted recorder anchors. The 526 native rerun preserved Basic at 69.875 ms and VSQ at 70 ms; JSON/MusicXML remained at 70 ms. Exact historical before/after output and transport hashes are retained in `cross-mode-performance-audit-evidence-526.json`. Initial start, positive/fractional resume, repeated Pause, post-anchor time, count-in, nonzero loop wrapping, seek and replay are covered by the corrected clock regression.

## Verified supported behavior

- One running app cycles canonical → Basic → explicitly admitted VSQ → canonical through the public Start/Mod controls. Every source restores its own role/mute/display choices. New sources begin with clean take/input/capture history. Only the human part receives targets and user input; machine playback adds no inputs or captures.
- Display-only edits render the current source's expected visible notation parts without changing machine gate ownership, targets or paused human take. Subsequent mute edits remove only that machine part's gates while preserving targets and the take. These changes were tested independently.
- All-machine means Listen and creates no human take. All-human keeps nonempty physical targets with zero machine accompaniment gates. Pause/resume retains one pass after the resume anchor has elapsed. Explicit Reset uses the existing behavior of clearing in-memory take history.
- Canonical and VSQ count-in share the accepted audio/recorder source position. Ordinary resume does not repeat count-in. Canonical A/B advances passes on the audio clock; a display-only Mod edit retains the loop, and switching profiles does not inherit it.
- The fresh native run cycles JSON → Basic → MusicXML → VSQ → JSON, using original repository fixtures and actual Rust import, compilation, target, instrument and runtime APIs. MusicXML retains its exact supplied source text. Rust +2 semitone preview, confirmed activation and exact-original restore preserve compatible Mod choices and bind them to the derived revision. Activation resets old take history. Basic/VSQ complete source bytes remain unchanged.

## Explicit restrictions and remaining verification

| Capability | Canonical JSON/MusicXML | Basic MIDI rendition | VSQ base notes |
|---|---|---|---|
| Start/Mod, human/machine, display, mute | Verified | Verified | Verified after explicit choice |
| Count-in | Verified | Explicitly disabled | Verified |
| A/B and tempo controls | Enabled; A/B exercised | Explicitly disabled | Explicitly disabled |
| Whole-score transpose | Native +2 and restore verified | Explicitly disabled | Explicitly disabled |
| Original vocal rendering | Not applicable | Not applicable | Explicitly unavailable |
| Resume/Pause before future anchor | Preserves position | Fixed and verified | Fixed and verified |

No browser/server/GUI, physical audio device, private score or external CI/release was used. DOM and native stdio results do not establish native clicks, visual layout, hosted audio, Windows packaging or physical output. Live-silence PCM navigation proof belongs to the separate audio workstream. This is focused regression evidence, not full acceptance.

## Reproduction

The transition, transport, clock and resume suites pass with the fix. The retained resume regression fails Basic/VSQ on the audited base:

```sh
node --test tests/cross-mode-performance-clock.test.js tests/cross-mode-performance-transition.test.js tests/cross-mode-performance-transport.test.js tests/cross-mode-performance-resume.test.js
```

Affected existing transport/input, canonical-session, Basic, VSQ, Mod, clock-view and live-audio suites also pass. The existing signed-count-in seek test now explicitly checks the count-in checkbox in LinkeDOM, which does not initialize that property from the HTML attribute; it uses 1e-9 ms float tolerance while retaining exact before/at/after-zero note-identity assertions. The complete seek suite passed after that fixture correction.

Build the socket-free driver from the audited source, then run the native matrix. The script completes the source/transpose checks, prints per-profile evidence and exits nonzero if any source rewinds:

```sh
cargo build -p worldmusichub-desktop --example native_import_driver --locked --offline -j2
WMH_NATIVE_IMPORT_DRIVER="$PWD/target/debug/examples/native_import_driver" node tests/cross-mode-performance-native.mjs
```

Audit driver SHA-256: `3803140ee4ab5360ce390e04943e794509a4d5d15320397585e4792d1c28481c`. The audit build used debug information and incremental compilation disabled to limit disk use.
