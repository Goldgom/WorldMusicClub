# Canonical actual-application acceptance

The focused workflow `.github/workflows/canonical-practice-preview.yml` uses one self-authored CC0 four-part exercise as canonical JSON and equivalent MusicXML. It is separate from the earlier engine-only canonical PCM probe and from release promotion.

The shared renderer `crates/desktop-shell/canonical-practice-acceptance.js` runs in both hosted Chromium and the actual Windows app. It calls existing owned picker, pointer, select and Digit2 actions. Three closed numeric actions type only 2 into loop-from, 6 into loop-to and 90 into tempo in the canonical controls phase. They accept no text or key payload. The actual field type, focus, value, trusted input/change events and zero music capture are retained.

Three bounded phases keep each process below64 actions and1MiB renderer evidence:

- Seed: original JSON picker/persistence; multi, all and one human selections; independent accompaniment; one trusted human key with positive live-tone PCM; acknowledged rapid pause/resume/pause; natural end/replay; full score and take exports
- Controls: full Listen; A/B beats2–6; repeated silent count-in; partial native slider seek; tempo90 and explicit +1 semitone copy preserve the two-part human selection
- Restart: separate native process reopens exact stored JSON; imports equivalent MusicXML through the real picker; full Listen and legacy selected-part Listen; exact imported IDs, ties, source bytes and JSON exports

The verifier binds canonical source, compilation, selection and plan fingerprints to consumed Rust results. It checks every retained processor note gate, original tie IDs, real trusted MessagePort receipts, destination-connected source/live PCM, single human capture and zero machine inputs. Range ledgers retain used entries and verify all omitted capacity is the original unused zero-filled sentinel. Source files and disk backups are checked byte-for-byte. Windows proof also binds process, shared profile, native click/key ownership, measured screenshots and executable hash.

Native packaging retains the complete bound canonical proof once, under `evidence/canonical-practice/`, through the manifest adapter. Flattened copies of the same reports in `evidence/` are rejected even when their bytes match. Package inventory errors identify missing files, extra files or an extra directory; all source, executable, proof and retained-file hashes remain required.

Local `npm run test:canonical-practice-acceptance` is a contract gate. `npm run test:canonical-practice-native` requires an explicit source-built WMH_NATIVE_IMPORT_DRIVER and runs Rust stdin plus the production app/DSP under a DOM harness. Neither is browser, Windows, physical listening or full release acceptance. The hosted runner refuses execution outside authorized GitHub Actions and requires the exact clean source SHA. The workflow publishes no release and uses no user-provided music.

## Action-result timing diagnostics

`timing-canonical-practice.json` is a version-1 diagnostic sidecar, not a new
acceptance proof. The Windows host buffers at most 4,096 checkpoints in memory
and writes the file once after existing app cleanup, on success or failure.
The existing JSON artifact collectors retain it. It is deliberately absent from
the semantic proof/package file inventory. A missing sidecar, recording error,
omitted tail, or incomplete action does not change any acceptance decision.
An abruptly terminated host may leave no sidecar.

The header binds the source SHA/tree and EXE SHA256. Every event identifies its
phase, app PID, action sequence and kind. Checkpoints bracket the existing
native action, geometry measurement and geometry JSON write, PrintWindow plus
HDC cleanup, PNG encode/write, and result JSON serialization/write/rename.
`pointer-submitted` follows the existing picker clock anchor; `input-completed`
means the owned native action routine returned, not that the renderer consumed
its event. `result-temporary-written` means the temporary file was written;
`result-published` is observed only after the existing Move-Item returned.
Failure preserves the prefix, never inventing a completed marker. All action
and result payload schemas, capture/input calls, waits, count-in, windows and
scoring assertions remain unchanged. In-memory measurement still has a small
nonzero cost and is not a guarantee against scheduling delays.

The renderer's existing source-bound report has an additive `actionTiming`
field with its own version and `diagnostic_only` flag. It retains at most 80
action records, each with four checkpoints: action POST start/completion and
non-pending result headers/body receipt. Pending responses only increment a
saturating counter; they add no polling or clock reads. Each checkpoint samples
`performance.now()`, `Date.now()` and the clock already published in the
progress element's data attribute. It never calls or advances transport. A
missing or malformed published clock is represented by null. The diagnostic
field is ignored by admission/scoring checks and remains inside the existing
1,000,000-byte renderer report limit.

Use elapsed Stopwatch ticks divided by the sidecar's frequency for durations
within that PowerShell process. Renderer monotonic milliseconds have a separate
origin; the native protocol trace has another. Do not subtract these monotonic
values across processes. UTC and renderer `timeOrigin` can help correlate them,
but clocks can jump and sequential samples are not atomic or synchronized.
Source-clock values are the last rendered observation, not a fresh audio-thread
sample. Correlate records with the original action/result, trusted events,
protocol trace, geometry and PNG instead of treating timing as proof of an input
or its success. This instrumentation diagnoses a possible late barrier; it does
not assert that capture, publication, or any other root cause has been fixed.

Before the unchanged size assertion and again before success/failure report
publication, optional timing is fitted to the remaining envelope. If necessary,
newest diagnostic action records alone are dropped and `truncated: true` plus
`omitted_actions` disclose the loss. The earliest records are retained. When no
action record fits, a small versioned truncation marker is used; if even that
marker cannot fit, the optional `actionTiming` field is omitted entirely.
Mandatory evidence is never altered, and a mandatory report already at or over
1,000,000 bytes still fails the original bound. This work happens after the
timed actions, not in their scheduling path. The host sidecar is independent.
