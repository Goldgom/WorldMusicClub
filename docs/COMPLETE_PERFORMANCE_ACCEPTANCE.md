# Complete typed-performance acceptance

These gates use only reproducible, newly authored fixtures. They prepare evidence
for hosted Chromium and the real Windows application; passing ordinary Node or
Rust contracts does not establish browser, Windows, audibility, or original
instrument fidelity acceptance.

## Original fixtures and exact identity

`generate_performance_acceptance_fixtures` creates two separate complete scores
and exact native-open fixtures through Rust NativeLibrary. Both use a 500001 µs
quarter and finish at exactly 5000010 µs. The overlap fixture retains all eleven
tracks, twenty attacks, independent releases and percussion. The controllers
fixture retains reset, bank-zero, volume, expression, pan and sustain commands.
Its key releases remain at their original coordinates/times; the explicitly
selected controls-v2 receiver holds sound gates until 4000008 µs. No note duration
or practice target is inferred. These additions do not modify earlier fixtures.

`prepare-performance-song-fixtures.mjs` checks the generated hashes/native
responses, prepares the production receiver's expectations from exact clean
bytes, and writes `performance-authored-songs.zip` plus its fixture manifest.
The combined pack contains only the standard v2 pack manifest and two
metadata/score pairs. Only those fixture filenames are admitted by the native
acceptance action route.

## Three bounded phases

- `performance-seed`: real file chooser, consumed Rust preflight with both songs
  and all tracks, native save, explicit reference policy, complete playback and
  each of the eleven independent track mutes, then exact pair export
- `performance-controls`: a fresh process/profile loads the controller fixture,
  observes real Web Audio volume/expression/pan changes and later sustain gates,
  tests both track mutes, pause/stop and navigation cleanup
- `performance-restart`: another fresh process/profile reloads both unchanged
  packages and requires a fresh explicit policy for each

Each phase first captures one real keyboard input in an original canonical
exercise. Exact before/after take exports must match throughout reference
listening, including inputs, captures and grading. The typed packages retain
JSON-null canonical notation, disabled ordinary Listen/Practice entry points,
and no scoring/fingering/runtime derivation requests. Independent native API
negative probes establish that even exact saved identities cannot request
piano/guitar fingering or VSQ base-note interpretation for these profiles.

The existing 64-action and 1 MiB report bounds are retained. The seed phase's
worst-case budget is 64 actions. Every action scrolls, focuses and hit-tests its
real target. The renderer records actual trusted events; the one untrusted
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

- `node --test tests/performance-song-fixtures.test.js tests/native-performance-song-evidence.test.js`
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
with the actual built `WorldMusicHub.exe`, fresh evidence directory and ordinary
Windows input helpers. It never substitutes the stdio driver for the EXE.
The standalone verifier is `verify-native-performance-song-evidence.mjs`, with
`--check` to re-derive and compare its existing file manifest. It verifies native
picker ownership, screenshots, distinct processes, exact saved primary/backup
bytes, fixture ZIP retention, export and restart snapshots. Host metadata binds
source SHA/tree and EXE SHA/size; final workflow wiring must compare those with
the independently built source/EXE before publishing evidence.

Workflow invocations, the exact `/desktop-performance-song/` output ignore and
final cross-scenario release/evidence binding are deliberately left for the
integration owner. Existing VSQ gates and workflow files are unchanged.
