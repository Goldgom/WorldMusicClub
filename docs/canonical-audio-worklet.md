# Canonical compiled audio: first whole-song slice

This is a source-preserving audio-thread reference interpretation for canonical
JSON/MusicXML scores. It is not an original recording, General MIDI, a soundfont,
voice synthesis, or exact rational-microsecond rendition. Every sounding note is
a sine with the compiler's MIDI pitch and velocity and the common zero-tail
attack/release envelope. A zero-velocity source stays a silent, ledgered gate.
The user must accept `wmh-canonical-sine-ms-v1` before preparing it.

This slice does not change app.js, the notation/follow implementation, instrument
checks, physical target grouping, input dispatch, scoring, feedback, or recorder.
It must not replace existing Solo loops, tempo copies, transposition or recorder
passes until their integration is separately complete. A loop/range option is
explicitly rejected; there is no Synth/rAF fallback.

## Rust evidence and host admission

POST `/api/canonical-audio-profile` takes a canonical Score and calls the existing
`score_core::compile`. Legacy `Compilation` and its goldens are unchanged. The
response has `profile`, `policy_id`, `source_fingerprint`, `compiled_fingerprint`,
`duration_ms`, `part_ids`, `source_note_ids`, `source_references`, `occurrences`.
Every occurrence retains its original opaque UTF-8 `id`, numeric `part_index`,
numeric `source_indices` (including all tied/repeated written segments), `midi`,
`velocity`, `start_ms`, `duration_ms`. Empty and rest-only parts remain in the part
table. Written rests remain in the source-note table.

The full-score fingerprint is deliberately NOT the original file's SHA-256.
It hashes normalized `Compilation.score`, including retained source content and
metadata. The compiled fingerprint hashes the profile without its own fingerprint
field. Their versioned domains and deterministic typed encoding are documented
in `canonical_audio.rs`. They use SHA-256, typed tags, u32 little-endian lengths,
UTF-8 scalar strings, finite binary64 little-endian numbers (-0 becomes +0), and
objects sorted by UTF-8 key bytes. No delimiter-joined IDs or JSON whitespace or
property-order assumptions enter the binding. The JS implementation does not
require TextEncoder or WebCrypto in AudioWorkletGlobalScope.

`buildCanonicalAudioPlan(compilation, profile, options)` verifies both fingerprints
and an exact join against the entire original compiler timeline. Pass the source
Compilation, never a physical-target-deduped or human-filtered timeline. Practice
requires an explicit one/many/all human selection; Listen has no human parts.
Equivalent reordered human sets canonicalize to source order. Every machine
occurrence keeps its independent voice even for same-key cross-part unisons.
All-human playback has zero machine gates and the entire source duration.

A positive Rust binary64 millisecond interval is converted at the sample boundary
by flooring its start and ceiling its end. Unrepresentable positive intervals are
rejected. Every representable positive subframe gate includes at least one sample.
The clock duration is the maximum of the ceil-converted full source duration and
ALL source occurrence ends, including human parts. It never shrinks with selection.
Tempo or pitch copies must receive fresh compiler evidence; original data is never
mutated. The plan fingerprint binds source/compiled/selection fingerprints,
policy, sample rate, full clock, all cardinalities and every machine frame gate.

## Worklet and lifecycle contract

`CanonicalPlayer.select(compilation, profile)` cancels the old receiver.
`prepare({context, output, mode, practiceSelection, acceptedPolicyId,
resumePositionMs})` validates and transfers the full immutable plan before start.
`startPrepared({anchorTime})` requests a future anchor within 100 ms; its default
lead is 50 ms. A negative initial source position provides a count-in to source
zero. `sourcePositionMs()` follows the AudioContext/processor anchor, not drawing.
A new preparation at positive source A is a seek: crossing notes restart with
remaining gate lengths. It is not continuity-preserving pause.

`pause()` is acknowledged at the audio quantum boundary. Existing voices retain
phase, envelope age and identity while the processor emits zero. `resume()` shifts
the source anchor and held gate boundaries by one future acknowledged anchor;
held PCM resumes at the next unrendered source sample. The host must await these
acknowledgements before admitting the corresponding transport/recorder change.
Late start/resume acknowledgements close output and cancel, never catch up.
`stop()`, replacement and device interruption fence generations and disconnect
output. Device restart requires a new explicit preparation.

The processor receives numeric occurrence indices only. Original IDs and source
reference tables remain in the immutable host mapping. Audits join those indices
back to opaque IDs. The complete terminal ledger carries actual starts/ends,
initial/current anchors, generation, fingerprints and bounded pause spans. Open
paused cancellation has a span ending in -1. At most the current and previous
host plan mappings and one terminal ledger are retained. Audits page at 256 rows.

The common Basic/VSQ DSP and prepared scheduling implementation accepts an
explicit canonical profile hook. Its existing default identity validators, 65,536
Basic note limit, source-coordinate/rational-microsecond checks, sound recipes and
behavior stay unchanged. Canonical plans cannot pass their wire validator.

## Bounds and actual capacity

- Core source notes and expanded occurrences: 100,000 each; source references:
  1,000,000; parts: 128; IDs: 128 UTF-8 bytes
- Existing HTTP/native request body: 8 MiB. The dedicated API enforces this even
  through its direct Rust entry point. A theoretical 100k-note core score may be
  too large for this transport. It is explicitly held; inspect/export remain valid
- Profile response: 32 MiB (also fits the native 32 MiB response ceiling)
- Fingerprint encoding: 64 MiB and 64 nested levels; a request may hit this bound
  before its count bound
- Numeric transferred storage: 56 bytes per machine occurrence, 5.6 MB at 100k;
  hard wire bound 16 MiB, plus fixed 128 voice slots and 64 KiB pause-span storage
- Simultaneous sample-frame voices: 128, including quantization overlap; admission
  rejects the whole plan instead of stealing/truncating voices
- Audio sample rates: integer 8,000–384,000 Hz; pitches above the disclosed 0.45
  Nyquist guard reject the machine plan; sample-frame bound: 2^48
- Pause spans: 4,096 per generation; further pause fails visibly; no ledger drops
- One outstanding prepare per receiver, at most 32 pending commands, 30-second
  canonical prepare deadline; other lifecycle deadlines use the shared receiver

A prepare message attaches a fixed number of transferred buffers and computes a
constant-sized header hash. It does no full-score parse/sort/copy. Preparation runs
in two passes (scratch initialization, gate/hash/permutation/voice validation),
with at most 256 work items per quantum. No gate starts before the final ready
acknowledgement. Full 100k preparation takes 782 quanta at 128-frame blocks/48kHz.
This is an algorithmic work bound, not evidence of meeting a device deadline.
Cancel/replace is admitted between quanta, immediately fencing the old generation.

A development run on 2026-10-05 measured 100k transfer attachment at ~0.095 ms and
maximum prepare quantum at ~1.85 ms. These Node measurements are not portable
realtime guarantees. A host stress process retaining input/evidence/mapping for
100k occurrences plus 1m references reached ~392 MiB RSS. A separate direct Rust
test process, without compiler memory and with sequential capacity tests, reached
~372 MiB RSS. These are measured process peaks, not wire size or a promise of low
memory. Browser/native capacity and simultaneous trusted live-input audio require
separate hosted/device evidence before release admission.

## Verification and remaining boundary

`npm run test:canonical-audio` covers the actual production processor class in an
emulated worklet global, host fingerprint/profile join, source clock, zero-machine
plans, UTF-8 IDs, ties/repeats, same-key parts, subframe audio, generation fencing,
source/selection/rate tamper, full-source stalls, and receiver lifecycle. A paused
held-note run becomes sample-for-sample equal to uninterrupted PCM after removing
the silent pause interval. Capacity models are labelled algorithm evidence.
Rust tests compile original 100k-note scores and 1m tie/repeat references, and
reject the immediate over-limit cases without mutating source.

The committed original fixture is reproducible, without a server or user library:

```
cargo run -p score-core --example canonical_audio_evidence --locked \
  < tests/fixtures/canonical-audio-source.json
```

A/B clipping, nonzero-A count-in, audio-thread loop pass clocks/ledgers, and
Recorder pass integration are a separate next increment. They must reuse this
processor's full plan, source indices and continuous sample clock, with an
explicit boundary articulation policy. The app must preserve existing Solo
behavior while that work is incomplete. Exact hosted and native PCM/ledger,
render-stall stress and trusted-input isolation are still the final acceptance
gate; none was run in this local, non-GUI/non-server slice.
