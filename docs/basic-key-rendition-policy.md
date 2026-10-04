# Complete basic-key rendition v1

`wmh-basic-keys-midi1-v1` remains the immutable all-event source profile. The
`wmh-basic-key-practice-v2` runtime adds a disposable interpretation identified
as `wmh-basic-key-rendition-fifo-v1`. It is a basic synthesized audition and
note-on practice arrangement, not a claim of original instruments, drum kit,
acoustic pitch, physical routing, release ownership, or sustained sound.

## One timeline for audition and practice

`compilation.timeline.notes` contains exactly one positive receiver gate for
every source attack, in tick/track/event order. No MIDI key is dropped, folded,
transposed, or clamped. Its IDs are the existing stable source note IDs.
`rendition.notes` has the same order and cardinality; join by `note_id`. This
avoids duplicating the key/velocity/part/millisecond schedule in large responses.
Evidence is serialized as compact rows; `rendition.note_columns` declares the
exact thirteen columns. Coordinates are `[track,event]`, rational clocks are
`[decimal numerator string,denominator]`. Consumers must validate this versioned
column contract before decoding rows. Compactness preserves the existing large
source admission boundary without removing event evidence.

Each evidence record contains the original zero-based `attack` coordinate,
chosen `release` coordinate (or null), declared virtual route/channel, melodic
or percussion-selector role, exact interpreted `start`/`end` rational
microseconds, proved `source_end_tick` (or null), chosen `receiver_end_tick`,
unchanged `source_release_status`, `end_reason`, and `synthetic_gate` flag.
Combine an event coordinate with the root `source_sha256` using
`basic_keys::source_event_id` to recover its full source-bound event ID. The
source retains every original event, original start/end fact and uncertainty.

The same timeline supplies selected-part scoring and audio scheduling. Scoring
grades MIDI note-on timing and key only. It does not grade inferred release or
hold duration. Prefer a melodic part by default. Percussion selector practice
is explicit, with no inferred drum-kit mapping. Hardware range diagnostics do
not change the target set. Physical unison grouping retains every source ID.
Accompaniment is audio output and must never be submitted as user MIDI input.

## Deterministic interpretation

- Events run in `(tick, track index, event index)` order
- Every distinct Port/DeviceName declaration denotes its own virtual bus. The
  fully unspecified declaration denotes one shared default bus. These virtual
  buses make no claim about physical-device aliases. Tracks on the same bus
  share channel/key state
- Each positive NoteOn creates a separate voice. NoteOff and zero-velocity
  NoteOn release the oldest held voice on the same bus/channel/key (FIFO), even
  when attack and release are on different tracks
- CC120 AllSoundOff and CC123 AllNotesOff immediately end all held gates on
  their bus/channel, without sustain. Their source coordinates and distinct
  end reasons remain visible. Later unmatched note releases are retained
- A held voice left at global source end receives `source_end_cleanup`.
  Individual track EndOfTrack does not clear a shared channel
- Only a zero-time chosen gate gets a 20ms audition/target gate. This extension
  is flagged and can extend rendition duration past source end. Positive gates
  of any duration remain unchanged
- The clock starts at the SMF default 500000 microseconds per quarter. Positive
  tempo changes follow the declared event order; last positive tempo at a tick
  wins. Zero tempo events are retained and counted while the previous positive
  tempo continues. `source_clock_available=false` still distinguishes a source
  with no unambiguous original clock from this usable chosen clock

`source_duration_ms` means global source-end tick on the chosen clock;
`duration_ms` additionally includes any synthetic gate beyond that boundary.
Exact rational strings remain authoritative until the scheduling boundary.

## Basic sound, mixer and transport

Melodic keys use **WMH basic sine v1**, one neutral sine at each nominal MIDI
key frequency, with positive source attack velocity. Channel 10 uses **WMH
basic percussion pulse v1**, the same deterministic dry noise pulse centered
at 1500Hz for every selector 0–127. Key identities remain distinct. Unsupported
audio-device frequencies require an explicit diagnostic, never frequency
clamping or skipped voices.

All other controller/program/bank/bend/pressure/SysEx effects remain counted
source evidence and do not alter this arrangement. Source volume/expression
zero and channel-stop events are counted separately so the UI can disclose
source mixer state. Basic audition begins with all attack-owned parts audible.
Mute/solo filters voices after complete-source FIFO interpretation; a muted
track's release still closes another track's voice. Target selection and
accompaniment audibility are separate.

Stop, pause and seek cancel every active and scheduled voice. Resume can restart
the remaining chosen gates with fresh basic envelopes, using the same source
IDs and common transport clock. The receiver must preflight or fail explicitly
if its allocation limit cannot represent the requested rendition. It must not
steal or silently skip voices. `maximum_simultaneous_voices` counts exact gate
overlap, with ends before attacks at a shared boundary; a receiver's lookahead
allocation budget is an additional implementation limit. The shipped renderer
declares `allocation_lookahead_ms=100`, `voice_limit=128`, and
`receiver_gate_tail_ms=0`. `maximum_allocated_voices` counts the exact intervals
`[max(0,onset−100ms), gate end)` and drives import availability. Ends are released
before equal-time allocations. Rapid nonoverlapping notes can therefore exceed
allocation capacity even with a simultaneous-gate count of one.

## Reconciliation and bounds

Coverage verifies source attacks = derived voices = pre-grouping practice
targets. Every note release is either paired or listed as unmatched. Every
attack ends through a note release, an explicit channel stop, or global cleanup.
All source events are partitioned among attacks/releases, interpreted tempo,
routing/channel stops, metadata, and separately counted uninterpreted effects.

The native 31MiB response guard remains unchanged. Its conservative size proof
includes each target/evidence record and room for every release to be unmatched;
near the boundary, native admission runs the real compiler and measures the
response. An oversized response fails explicitly without trimming the source.
