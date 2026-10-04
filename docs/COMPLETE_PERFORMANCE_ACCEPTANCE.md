# Complete typed-performance acceptance

These gates use only reproducible, newly authored fixtures. They prepare evidence
for hosted Chromium and the real Windows application; passing ordinary Node or
Rust contracts does not establish browser, Windows, audibility, or original
instrument fidelity acceptance.

## Original fixtures and exact identity

`generate_performance_acceptance_fixtures` creates four separate complete scores
and exact native-open fixtures through Rust NativeLibrary. All use a 500001 µs
quarter and finish at exactly 5000010 µs. The overlap fixture retains all eleven
tracks, twenty attacks, independent releases and percussion. The controllers
fixture retains reset, bank-zero, volume, expression, pan and sustain commands.
Its key releases remain at their original coordinates/times; the explicitly
selected controls-v2 receiver holds sound gates until 4000008 µs. No note duration
or practice target is inferred. These additions do not modify earlier fixtures.

The two added fixtures come only from the literal deterministic generator in
`crates/desktop-shell/tests/support/performance_acceptance_fixture.rs`.
The invented destination is
`WMH Authored Receiver A`; the only new keys are C/E/G (60/64/67). Eight RPN12
writes retain the exact L/M/L/M/12/12/0/0 order at ticks 1–8, including repeated
messages. Attacks at ticks 9/15/21 and releases at 33/39/45 keep their original
keys, identities and fractional native clocks. Pitch bend stays centered. The
bank-negative MIDI differs by exactly one bank-select byte (0 → 1); its complete
commands are retained, but it is never counted as reference-audible. No private
music, device names, source events or source/media payloads are used.

The Rust fixture contract regenerates and compares every committed score,
metadata and native-open byte. Node checks additionally bind source commands,
repeated setup coordinates, centered sensitivity, original key/time values,
explicit named policy, and missing/unnamed-policy or bank rejection before audio
context creation. Renderer verification requires the exact English and Chinese
route disclosure and mapping-policy labels. Both previous unnamed fixtures and
all their overlap, percussion, sustain and independent-mute cases are retained.

`prepare-performance-song-fixtures.mjs` checks the generated hashes/native
responses, prepares the production receiver's expectations from exact clean
bytes, and writes `performance-authored-songs.zip` plus its fixture manifest.
The combined pack contains only the standard v2 pack manifest and four
metadata/score pairs (three reference-audible, one explicitly bank-blocked). The
existing ZIP filename remains the sole performance import fixture admitted by
the native acceptance action route.

## Three bounded phases

- `performance-seed`: real file chooser, consumed Rust preflight with all four songs
  and all tracks, native save, explicit reference policy, complete playback and
  each of the eleven independent track mutes, then exact four-package export
- `performance-controls`: a fresh process/profile loads the controller fixture,
  observes real Web Audio volume/expression/pan changes and later sustain gates,
  tests both track mutes, pause/stop and navigation cleanup. It also runs the new
  named C/E/G fixture, then selects the bank-negative sibling and verifies disabled
  policy/play controls, an explicit bank diagnostic and zero audio source starts
- `performance-restart`: another fresh process/profile reloads all four unchanged
  packages, requires a fresh explicit policy for each of the three reference-audible
  entries, and rechecks the bank-negative sibling without playing it

The seed phase first completes its owned native picker, preflight and save,
checking that import leaves the original catalog preview unchanged and starts
no audio, score, input capture or grading. It then captures one real keyboard
input in the original canonical exercise, as do the two later phases. The
report records the completed import action scope before the trusted human
transport proof. Real picker focus boundaries remain intact; they precede
the baseline. Exact before/after take exports must match throughout reference
listening, including inputs, captures and grading. The typed packages retain
JSON-null canonical notation, disabled ordinary Listen/Practice entry points,
and no scoring/fingering/runtime derivation requests. Independent native API
negative probes establish that even exact saved identities cannot request
piano/guitar fingering or VSQ base-note interpretation for these profiles.

The existing 64-action and 1 MiB report bounds are retained. The seed phase's
worst-case budget stays at 64 actions; controls is at most 50 and restart at most
47. The new reference requires three five-second full/mute runs in controls and
one in restart. Existing 120-second hosted and 240-second native phase deadlines
remain unchanged. Audio/source (128), parameter (256), request (128), trusted-event
(256) and diagnostic (64) bounds also remain unchanged. Synthetic Node report
size checks are supplemental; real hosted/native reports must still fit 1 MiB.
Every action scrolls, focuses and hit-tests its real target. The renderer records actual trusted events; the one untrusted
hidden file-input delegation is allowed only within its owned real picker
chain. Shared robust chooser and console helpers remain unchanged.

## What audio evidence establishes

Observers forward calls to the real AudioContext without replacing the player,
clock, input, storage or API. Per-pass evidence retains actual source onset and
first scheduled stop, oscillator pitch/waveform, mixer parameter automation and
disconnect state. Verification compares every unmuted source against the
production receiver's declared interpretation, including original key-release
identity versus the distinct later sustain-release gate. Cancellation evidence
requires no active or pending sources. None of this proves physical sound or
original timbre.

## Execution and verification

Ordinary, local-safe contracts:

- `node --test tests/performance-song-fixtures.test.js tests/native-performance-song-evidence.test.js tests/performance-import-baseline.test.js`
- `cargo test -p worldmusichub-desktop --test performance_acceptance_fixtures --locked`
- `cargo test -p worldmusichub-desktop --lib acceptance --locked`
- Build `native_import_driver` from the exact candidate source, then set
  `WMH_NATIVE_IMPORT_DRIVER` and run `node scripts/check-performance-song-native.mjs`

The hosted runner is `scripts/hosted-performance-song-check.mjs`. It refuses
execution unless `GITHUB_ACTIONS=true` and `WMH_HOSTED_BROWSER=1`; it also requires
`WMH_SOURCE_SHA` to equal HEAD and an exact-source `WMH_NATIVE_IMPORT_DRIVER`.
Run separate evidence directories for 1280×720 and 1280×900 with
`WMH_VIEWPORT_HEIGHT`. Requests go through the real Rust stdio driver; browser
assets are routed in the isolated context without a listening server.

Windows uses the shared `windows-desktop-acceptance.ps1 -Scenario performance-song`
with the actual built `WorldMusicClub.exe`, fresh evidence directory and ordinary
Windows input helpers. It never substitutes the stdio driver for the EXE.
The standalone verifier is `verify-native-performance-song-evidence.mjs`, with
`--check` to re-derive and compare its existing file manifest. It verifies native
picker ownership, screenshots, distinct processes, exact saved primary/backup
bytes, fixture ZIP retention, export and restart snapshots. Host metadata binds
source SHA/tree and EXE SHA/size. The native workflow compares those with the
independently built source and packaged EXE before creating the candidate.

The native feature workflow runs the protocol checks, both hosted viewports and
the Windows scenario. It preserves scoped evidence after either success or
failure and ignores only the generated `/desktop-performance-song/` root.
Package creation rechecks the complete proof and includes hashes for all five
required performance reports. Existing VSQ gates remain required. The separate
full Verify workflow and both independent native-workflow jobs must pass for the
same source before acceptance; a native candidate alone is not an accepted build.
