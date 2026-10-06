# Live input silence across navigation

The earlier authoring acceptance starts muted and observes legacy scheduled
sources. It proves input/take isolation for that setup, but cannot establish
that an already sounding persistent live AudioWorklet stops on navigation.
The active-accompaniment live-tone proof separately binds a human key, its
native token and positive PCM; it ends before these navigation boundaries.

`tests/live-tone-navigation-browser-regression.js` adds four original-score
cases to the existing full-app browser suite: physical keyup or still-held
navigation, each entering Settings or authoring through visible controls.
Each case starts unmuted, requires positive PCM for the actual trusted `KeyR`
token, and retains observation through entering the surface, typing a blocked
key and returning to the paused stage. Native terminal receipts distinguish
physical release from navigation/focus cancellation. The keyup cases must
finish a drained silent window before navigation, so navigation cleanup cannot
mask a broken release. Full exported takes,
physical event timestamps, paused position and original score bytes must stay
unchanged after the navigation baseline. Live play counts and canonical source
start counts cannot increase.

The reused passive observer adds one fixed analyser branch from the live
receiver's output gate during its original initialization. The analyser is not
connected to the destination. The product's persistent live receiver, gate and
normal destination path remain connected with positive gains; the observer does
not reconnect destination edges, close gates, send control messages, suppress
disposal or replace callback results. Canonical source receivers follow their
normal cancellation/disposal path, and their final node/gate connection counts,
pending commands and disposal state are checked independently. Each PCM block
also records whether the fixed analyser branch is still connected.

Silence means exact zero samples at that live output gate, with a running audio
context and a connected audible destination path. It is not an aggregate
destination recording or physical listening. The first silence window must
advance beyond both its observed boundary and the native terminal frame by the
16,384-sample analyser history plus 256 frames, then contain at least three zero
blocks over at least 100 ms. Its first qualifying block establishes one sticky
silence boundary. Every later observed block must be zero, including blocks
immediately after a new checkpoint; checkpoint changes never grant fresh drain
grace. Missing, frozen-clock, muted-path, disconnected-tap and stale blocks
cannot prove silence.

PCM coverage consists of explicit finite checkpoint windows. Each window is
observing, sealed or exhausted, and retains at most 64 samples with cadence
adjusted for low sample rates. Exhausting an unsealed window fails the
observation. A sealed window cannot certify a later time. A quiet result must
have a sample no more than 100 ms old in both observation and audio clocks;
sealing takes another real sample, and finish requires a fresh open final
window whose closing sample is read synchronously. The final window starts
after all take/source exports. The validator independently checks each closing
boundary, the sticky silence boundary, and the final sample's freshness.

The runner deliberately seals completed windows before unrelated UI/export
work, then starts another finite window. These gaps are not uninterrupted PCM
coverage. Trusted input, native voice receipts, play calls and source lifecycle
observation remain active across them, and the original silence boundary is
never reset. The reports identify this scope as `finite-checkpoint-windows`.

The Node adversaries and observer models validate this evidence contract,
including the 8 kHz history budget. They do not constitute real-browser evidence.
Authorized hosted `npm run test:full-app` execution is required for the four
cases. Reports are named `worldmusichub-live-silence-<route>-<release>.json` in
the suite's artifact directory. No product audio or scoring behavior changes
are part of this acceptance addition.

The hosted `ui-preview.yml` workflow also selects these four complete test
names alongside its previous 16 UI cases. Its provenance verifier requires
each exact passing TAP case, then re-reads all four retained JSON reports,
reruns the finite-window/input oracle, checks paused-state equality and both
observer cleanup contracts, and hashes those same bytes into the preview
manifest. Audio diagnostics are included in both always-uploaded artifacts,
including when the run fails. PCM evidence requires no synthetic screenshots.
The preview remains separate from full checkpoint and Windows acceptance.
