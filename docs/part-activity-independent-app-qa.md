# Recovered independent background activity QA

The previous unpublished QA commit was lost in a cloud reset. These files are newly reconstructed from retained conversation/tool evidence, not a restoration of the original Git objects.

Recovery base: `315db983` (public 677). The reconstructed 17-checkpoint boundary scenario was actually rerun with `ACTIVITY_BASELINE=1` on this base. It passed and produced the identical historical trace SHA-256:

`ffea0e56d96b20b84d6bec8fbfc76fa0a20583b2a9e151b2ffa524376b087b84`

The trace preserves complete exported passes, human capture timestamp, assessment/grades, ownership, targets and public source clock. Source onset of one MIDI note remains 0.125ms. Nominal 8kHz wall boundaries can lag by one sample due to existing binary64 rounding; exact-boundary expectations follow the actual source sample.

At this recovery checkpoint, reconstructed integration candidate tests have not yet run. No browser, Rust, native, CI or publication acceptance is claimed. Further executed evidence will be appended after the rebuilt candidate is available.

Reproduce baseline: `ACTIVITY_BASELINE=1 ACTIVITY_TRACE=/tmp/activity-baseline.json node --test tests/independent-part-activity-boundaries.test.js`.

On an integrated candidate, use `ACTIVITY_EXPECT_TRACE=/tmp/activity-baseline.json` to require an exact full-trace comparison. Repeat with `ACTIVITY_HIDE=1` for inline presentation suppression. The default test requires the actual strip and will not pass on the unintegrated base.
