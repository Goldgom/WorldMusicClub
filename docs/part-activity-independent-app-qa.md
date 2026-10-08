# Recovered independent background activity QA

The previous unpublished QA commit was lost in a cloud reset. These files are newly reconstructed from retained conversation/tool evidence, not a restoration of the original Git objects.

Recovery base: `315db983` (public 677). The reconstructed 17-checkpoint boundary scenario was actually rerun with `ACTIVITY_BASELINE=1` on this base. It passed and produced the identical historical trace SHA-256:

`ffea0e56d96b20b84d6bec8fbfc76fa0a20583b2a9e151b2ffa524376b087b84`

The trace preserves complete exported passes, human capture timestamp, assessment/grades, ownership, targets and public source clock. Source onset of one MIDI note remains 0.125ms. Nominal 8kHz wall boundaries can lag by one sample due to existing binary64 rounding; exact-boundary expectations follow the actual source sample.

At this recovery checkpoint, reconstructed integration candidate tests have not yet run. No browser, Rust, native, CI or publication acceptance is claimed. Further executed evidence will be appended after the rebuilt candidate is available.

Reproduce baseline: `ACTIVITY_BASELINE=1 ACTIVITY_TRACE=/tmp/activity-baseline.json node --test tests/independent-part-activity-boundaries.test.js`.

On an integrated candidate, use `ACTIVITY_EXPECT_TRACE=/tmp/activity-baseline.json` to require an exact full-trace comparison. Repeat with `ACTIVITY_HIDE=1` for inline presentation suppression. The default test requires the actual strip and will not pass on the unintegrated base.

## Reconstructed candidate execution

Candidate product: `a99e07ba95373bf55699425c6557a8d70491354d` (cherry-picked to QA as `c5c0b17`, with the same product bytes and independent boundary registration preserved). All 15 independent tests passed together after reconstruction:

`node --test tests/independent-part-activity-*.test.js`

The seven independent test files are now registered in the mandatory pure inventory, including the boundary test registered by the first recovery commit. No skip or existence guard is used for missing product code.

Executed coverage:

- Production partial-assistance machine subset, immutable human targets and score export, no machine input capture, shown/hidden display isolation.
- Four ordinary running-frame source-clock samples, matching the pre-integration app. The optional strip introduces no fifth sample; no claim of globally one sample.
- Actual Mod complete/solo/hide-other-parts/per-part-hidden/mute/unmute. Hidden and muted remain distinct, human targets unchanged.
- Pager-owned Enter cannot release held human Space; unmatched original Space release bubbles through existing cleanup; musical focusout and focus transfer leave no stuck owner. This replaces the old blanket-keyup expectation with the rebuilt view's explicit key ownership contract.
- Canonical delayed Replay admission/cancellation, ended state, future anchor, fresh current renderer, acknowledged pause and Reset. Source inspection confirms completed-take Replay uses the existing canonical session with a fresh admitted plan, not another player. The previous completed take remains unchanged. Other reference/Free renderers are outside the live strip scope.
- Actual production Basic and VSQ pause/ended display retirement, new admission/future resume anchor, fresh Replay, unchanged prior take, and source replacement. Paused/ended labels survive intentional stop only as retired nonplaying evidence; new source or admission cannot use them as live activity.
- Basic/VSQ exact device-frame-to-millisecond gates, half-open intervals and 100 cached reads with protected source-array traversal APIs. Changed epoch fails closed.
- Production stage controller source replacement, stop, failed admission, cancelled asynchronous preparation and offstage/Free/Listen/solo eligibility.
- Source/CSS contract: static isolated 56px host, viewport budget includes its bottom edge, visible at 1920x1080 and 1280x720, collapsed at 844x390 and 390x844. These are source/DOM checks, not rendered geometry proof.

The candidate's full 17-checkpoint trace matched the freshly executed baseline byte-for-byte, including MIDI onset at 0.125ms and full capture/grades/ownership. Runtime trace files are diagnostic outputs, not committed product assets.

## Remaining evidence boundaries

No local browser retry or Rust build was run. Real browser/native acceptance is being prepared separately; screenshots, font metrics, zoom, physical audio and exact-source full acceptance remain unverified by this report. Independent app-level tempo/transposition exercise was not newly added. Do not reinterpret a focused local pass as complete project acceptance.

Final recovery checks: baseline, integrated visible, and integrated inline-hidden traces all passed exact comparison and shared the SHA-256 above. All 18 existing tests in `canonical-first-take-clock.test.js`, `frontend-canonical-replay.test.js`, and `cross-mode-performance-resume.test.js` were also rerun and passed. The mandatory inventory validator found all seven independent files exactly once.
