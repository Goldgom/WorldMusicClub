# Background-part strip acceptance contract and recovery status

This development batch is separate from frozen instrument-information validation.
The previous unpublished local history was lost when its workspace was replaced.
The present implementation is reconstructed new history from public source
`315db983a3114c6fd5432a6dd3070c1807be7f73`; it is not a restoration of old commit
hashes or evidence that the old candidate ran. No private music or screenshots.

## Registered browser path

`tests/part-activity-browser-regression.js` registers
`real machine activity follows admitted source gates without human input or display coupling`
in the full-app browser suite. Its original CC0 mechanical MIDI has a human line,
a gapped machine line and an out-of-keyboard-range machine line. Long bilingual
names exercise clipping. Tempo and exact gate boundaries are authored in source.

The case submits the actual MIDI to the actual Rust import endpoint. Evidence
retains original source bytes and exact response bytes as base64, byte lengths,
SHA-256 values, parsed response and unchanged retained source payload. Pure
negative tests reject substituted bytes, response hashes and retained sources.
Only the imported score's displayed title changes in the UI import fixture; the
unmodified Rust response remains separately retained. No plan, receiver receipt,
clock, ownership, input event or activity row is fabricated.

The browser case requires:
- Actual source receiver plans/ACKs and independent known source gate interiors
  for playing and silent. `playing` is not a claim about physical speakers.
- Real Mod mute with a changed admitted audio plan, and committed pause.
- Hide-other-parts, solo and per-part display changes that leave admitted source
  notes, ownership and mix unchanged; visibility is independent from audio.
- Enter/Space/Home/End/arrows at paging edges, correct disabled controls, retained
  navigation focus and visible focus geometry; exported take is byte-equivalent
  before/after navigation. A real human pointer capture is a positive control.
- No machine source part in human target/capture plans.
- Real reset, source-position A/B wrap, persisted reload, natural end and distinct
  replacement source admission; no stale previous-source row.
- Exact source commit/tree and server-byte SHA-256 recorded in its report, with
  the full frozen-source workflow retaining its independent build/source gates.

## Geometry

1280×720 and1920×1080 require a visible fixed56px flow host. 844×390 and390×844
require safe collapse with no occupied strip height. Record DOMRects, transport
hit tests, screenshots and actual viewport/DPR. Reject horizontal and vertical
document overflow, overlaps, offscreen transport and hidden playable surfaces.
Compare human key dimensions to the same-viewport no-strip state; the optional
strip may not silently shrink accepted key geometry. The product breakpoint is
width>1000 and height>650;960×640 also collapses in existing native coverage.

The strip contains no canvas, notes, keys or per-note animation. Its root has
aria-live off and keyboard-input off; only its page counter is politely live.
Contrast, screen-reader behavior and actual clipped focus still need sensory
review. DOM rectangles alone do not prove these.

## Mandatory Windows path

Extend the already-mandatory complete-practice scenario and its independently
invoked verifier. Preserve every original seed/restart, source/EXE, trusted input,
PCM, profile and old geometry gate. Missing new strip evidence must fail rather
than be treated as a legacy passing report. Existing all-human cases do not
prove machine rows. Existing complete-practice contains genuine mixed Basic
parts; a genuine mixed VSQ subcase selects the second track as human and the
first as machine. The original VSQ source has a gate then a real running rest.

The recovery adds running playing/silent, paused, ended and muted evidence only
from actual source plans, receiver receipts, published source clocks and real
Mod controls. A retired paused/end display admission is distinct from a live
renderer admission. Save the genuine admitted receipt before stopping and bind
retired rendered rows to it and unchanged source/runtime identities; never
pretend the stopped player's live facade is ready. Reset/reapply/source changes
must hide stale rows. Running captures must retain gate/rest timing across the
actual screenshot action and fail if they miss the required window.

Keep `validateCompleteGeometry`'s900–1280×640–720 bounds unchanged. The separate
strip geometry contract may cover1920×1080 in pure tests, but that is not a real
large Windows capture. No workflow breadth or runner protocol is changed here.
Native keyboard paging is not implemented by the current trusted native action
protocol; do not label select controls or synthetic events as native paging.

Every required native phase/checkpoint remains bound to the exact source/tree,
EXE hash, PID/HWND, owned action sequences, original fixtures, unchanged receiver
plan, trusted input, exported takes, finite PCM, measured client/DPR/work area,
PNG dimensions and fresh/reused profile sequence. Missing/skipped phases, stale
source or EXE, substituted screenshots and incomplete artifact lists must fail.

## Execution and remaining work

Only source reconstruction, syntax checks and pure tests have run. No local
browser launch, Windows execution, Rust build, CI dispatch, upload or publication.
A pure verifier passing is not real-browser/native or package acceptance. Future
execution requires the complete frozen-source workflow with no skipped gates.

Remaining rendered matrix:128-row cap and edge behavior, guitar and notation
on/off, percussion, genuine human-part machine subset, FreePractice/offstage,
metadata laziness, contrast and real screen-reader review. The current browser
case has two machine rows and cannot establish128-row rendering. Actual1920
Windows capture and native keyboard paging remain explicit gaps. Unit/model
coverage is not a substitute. Differential app QA separately owns the no-extra-
clock and input invariants: passive audio observers themselves can read clocks,
so do not use their presence as a claim of zero extra application clock reads.
