# Human Mod timbre acceptance

This is a bounded acceptance sequence for the browser Mod v2 extension. It is
separate from product implementation and does not enable the Unity prototype.
The authored fixture contains two parts, `human-one` and `human-two`, each owning
C4 at 0/1 and E4 at 63/1. The existing fixed KeyR input plays C4. Four source notes
must remain visible to the source contract. The default Piano performance profile
deduplicates them to two physical targets. The Guitar performance profile retains
four separate source events and its existing pitch-only/manual-review diagnostics;
one pitch-only input cannot complete both retained same-pitch guitar targets.

`prepare-human-mod-timbre-fixtures.mjs` deterministically derives this new original
exercise from the repository's original navigation exercise generator. It writes
accurate original-author provenance, a BOM/CRLF-bearing explanatory source string,
and a SHA-256 manifest. No user song, third-party score, synthetic label attached
to imported material, acoustic samples or new synthesis recipe is involved.

## Hosted browser

Build the ordinary real Rust test server, then run the registered case:

```
cargo build -p practice-server --locked
node --test --test-name-pattern='real human Mod timbres' tests/full-app-browser.test.js
node scripts/verify-human-mod-timbre-hosted.mjs <artifacts>/worldmusichub-human-mod-timbre.json
```

The case uses visible Mod, instrument, Results and navigation controls. Each
Start or Play action is explicit and is followed by the original advancing-clock
wait. An early ready/preparing clock never triggers a second Play toggle that
could cancel the owned admission. The only
storage write outside those controls seeds a validated v1 sidecar belonging to
this original fixture before a document reload; it is reported explicitly. It
checks v1 read/Cancel without a v2 write, conflicting human choices, explicit
Unify, guitar and piano output, same-key ownership, complete take preservation
through Cancel, mode/default revalidation, and persisted v2 reopen with unchanged
legacy bytes. It writes the finite JSON report and a conflict screenshot.

## Native Windows

The optional `native-human-mod-timbre.yml` workflow builds the exact workflow SHA
and executes:

```
powershell -File scripts/windows-desktop-acceptance.ps1 -Executable target/release/worldmusichub-desktop.exe -OutputDirectory <fresh-directory> -Scenario human-mod-timbre
node scripts/verify-native-human-mod-timbre-evidence.mjs --check <fresh-directory>
```

The verifier requires `WMH_HUMAN_MOD_TIMBRE_EXECUTABLE` to identify the independently
built executable. The host sets it for its initial verification; the workflow
sets it for the independent repeat. Source hashes include the complete existing
canonical/live path plus this acceptance family and stay within the 160-file cap.
The verifier checks ordinary, bounded, nonlinked files and records their exact
byte hashes. WebView profile contents are never retained in artifacts.

There are exactly three distinct native processes in one ordered sequence:

1. `human-timbre-seed`: import only the original fixture through the owned Windows
   picker and seed its validated legacy v1 sidecar
2. `human-timbre-migrate`: reopen that profile, verify v1 read/Cancel, use actual
   human selectors and Unify, record guitar and piano takes, prove Cancel preserves
   exported take bytes, and save v2 Follow preferences
3. `human-timbre-restart`: reopen the actual saved v2 sidecar, retain dormant machine
   recipes and the original v1 bytes, change mode and the performance instrument,
   verify named default-resolution conflicts, and explicitly unify to Follow before
   recording guitar output

The native renderer reuses the existing owned-click geometry and fixed-R dispatcher.
Only the seed phase admits the exact fixture filename. Select-first, select-second
and select-last are the existing closed host actions; no arbitrary keyboard or
script execution endpoint is added. Each phase retains the existing 64-action cap
and 10-second held-key watchdog. Restart requires its predecessor profile records.

## Evidence boundaries

The passive live observer is unchanged. Both hosted and native samples pass the
same original-fixture validator. Its frozen compilation in
`tests/fixtures/human-mod-timbre-compilation.json` was produced by the existing
socket-free Rust `canonical_audio_evidence` example from the exact generator
bytes. Its input SHA-256 and complete score are checked before use, and the actual
application's `/api/compile` response must equal it. The existing
`validateTargetPlan` checks the whole target plan against that compilation,
including each occurrence, representative ID/part/voice/staff/velocity, source
owners, duration and clock. The same oracle file also contains exact target plans
produced through the existing socket-free native `/api/practice-targets` endpoint
for default Piano (61 keys) and Guitar (standard tuning, 12 frets, capo 0). The
complete plan and diagnostics must match the actual performance profile, regardless
of whether the live recipe is piano or guitar. This is not a general allowance for
four targets or an alteration to production grouping/scoring. Every sample also requires its full source-bound v2
Mod and the actual performance control used to resolve Follow.

Released windows require the original receiver/node/gate/destination/generation,
connected audible path and 16384-sample tap in every block. Their sequences and
wall/audio clocks must stay ordered inside sealed, bounded windows; the original
terminal controls FFT drain, and both seal and finish require a fresh final
sample. Sampling gaps are permitted: this proves finite observations, not
continuous audio coverage.

Native action verification retains the stable owned pre-click rectangle and the
host's actual pointer/window ownership. A successful navigation or dialog action
may truthfully hide/remove its target and produce an empty post-dispatch rectangle;
the report retains that rectangle without replacing it with the pre-click bounds.

 Every sounded case requires one original
trusted keydown/up pair, one receiver call, one actual native started/ended token,
a connected nonmuted output path, positive analyser PCM overlapping that token,
and a finite drained silence window. A separate transport observer and the take's
input evidence retain the exact original DOM timestamps. One captured input must
be assessed once, as either a hit or an extra; the test never alters timestamps to
force a grade. Piano unison groups retain both owners; Guitar keeps each original owner in its
separate source-event group. Every case still has exactly one recorded input, one
assessment event and one live voice.

The expected recipe is checked by replaying the existing production `LiveToneCore`
offline with the observed sample rate, MIDI key, velocity and actual frames. For
an ordinary held-key release, its frame is the actual terminal frame minus the
existing 12 ms release tail. Aggregate PCM peak/energy allow only a small numeric
tolerance, integer frame/count accounting is exact, and the opposite recipe must
fail the same comparison. This offline arithmetic checks observed receipts; it
never sends input or schedules audio in the application.

Pure tests intentionally use synthetic evidence to reject tampering. They are
contract checks and cannot establish native/browser provenance, physical speaker
output, continuous PCM coverage, package acceptance or release readiness. Actual
hosted and Windows execution must pass on the final integrated source before those
narrow runtime claims can be made.

Local preparation checks:

```
npm run test:human-mod-timbre-proof
cargo test -p worldmusichub-desktop --lib acceptance --locked
cargo fmt --all --check
```
