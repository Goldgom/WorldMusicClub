# Native live-tone navigation acceptance

This is a separate native scenario, `live-tone-navigation`, built on the
finite-window observer introduced by the hosted browser navigation checks.
It must not be inserted into the three canonical-practice phases: their
original C5 onset, 40 ms key action, host-delay, source-run, scoring and export
contracts remain unchanged.

The four closed phases are:

- `live-navigation-settings-keyup`
- `live-navigation-settings-navigation`
- `live-navigation-authoring-keyup`
- `live-navigation-authoring-navigation`

Each phase owns a fresh native process and WebView profile. All use one original
CC0 C4/E4 exercise lasting 64 seconds, with its exact embedded source text
retained. This leaves room for native control dispatch and analyser history
without accidentally reaching the source's natural end. It is unrelated to
the timed C5 scoring exercise.

The renderer reuses the canonical control helpers before their runner IIFE,
the ordinary owned picker and Mod controls, the actual canonical source
receiver, and the existing persistent live receiver observer. It does not edit
the canonical runner or replace the score, input event, playback clock,
AudioWorklet or application callbacks. Pointer targets are scrolled and
measured but never programmatically focused: while R is held, cancellation
must follow the actual trusted Windows pointer/focus transition.

The host contract adds two closed actions, `live-key-r-down` and
`live-key-r-up`. They operate only on KeyR/virtual key 0x52 in these four phases.
A host watchdog checks elapsed hold time against ten seconds between native
actions; this is not an absolute operating-system scheduling guarantee.
Synchronous screenshots are skipped while R is held, and failure handling
releases it before diagnostic capture, with idempotent finally cleanup.
The actions must verify the existing app foreground HWND and enabled state before
dispatch, with no focus reacquisition or pointer click. The renderer retains
prepared focus and clock snapshots and binds the original native key events
to the live token's exact DOM timestamps. Host failure/phase-exit handling must
release any held test key; a failed key-up result cannot count as completion.
The existing immediate `key-r` action remains suitable only for the blocked
off-stage key probe. Existing C5 and D-sharp actions must stay untouched.

Actual keyup must precede the first silent window in the keyup phases. In the
held phases, trusted navigation must cancel the native voice before the later
physical keyup. The same fixed live output-gate analyser, original native
token and destination path remain observed. The first established silence
boundary is sticky, windows have explicit lifetimes, exhaustion fails, and
finish reads fresh PCM after all exports. Intentional gaps between sealed
windows are not uninterrupted PCM coverage. The evidence makes no physical
speaker or listening claim.

The independent verifier re-reads the fixture, three exports per phase,
renderer reports, native action/result records, process/profile evidence and
trace files. Before/after take bytes must be identical; exported score JSON
and embedded source text must match the original fixture. Both observer
cleanup objects, actual foreground ownership, finite PCM/input evidence,
paused state, source tree and executable identity are checked separately.
Every native pointer result must have a positive hit root equal to the app
HWND, in addition to its foreground and renderer ownership checks. Ordinary
controls retain one owned trusted click. The Import picker alone retains the
exact ordered pair of its trusted `import-button` click and the production
handler's untrusted `score-file` click. That pair is bound to the original
file input, native picker action, owned dialog, trusted input/change events
and unchanged fixture bytes; no untrusted events are filtered out. A card's
descendant click keeps its raw target ID and separately records the active
dispatched control ID after the canonical identity/contains ownership check.
Role verification binds both to the requested control and its
complete owned click trace; navigation also binds the live observer timestamp.
The proof remains bounded to this native feature; it is not full checkpoint,
package, release-ready or continuous-audio acceptance.

Local Node/model tests can validate this protocol, dispatcher and adversarial
evidence. They cannot establish that a Windows GUI run happened. The optional `native-live-tone-navigation.yml` workflow runs the registered
scenario and independently checks its exact executable/source proof. Its
original JSON diagnostics survive failure and its artifact excludes WebView
profiles. An actual hosted Windows run is still required before claiming a
native pass; Node/model tests alone are not that evidence.
