# Raw MIDI event core

`score_core::midi_events::parse_midi_events(bytes, expected_sha256)` inspects a
complete original Standard MIDI File without converting it into a `Score`.
The existing strict `import_midi` notation importer is unchanged. This module
does not implement application controls, audio output, assistance plans,
instrument assignment, notation rendering, or performance grading. The stateless
HTTP/native inspection route is documented in [API.md](API.md#song-assistance-and-raw-midi-inspection).

## Authority and identity

- The result owns an exact immutable copy of the original bytes. Use
  `original_bytes()` to retain or export that source; it is never regenerated
  from parsed records. Running status, delta encodings, text bytes, track
  boundaries, and all other original encodings remain intact
- SHA-256 is computed locally over the complete source. The optional expected
  digest must match the computed digest; a supplied identity is never trusted
- An event identity consists of source SHA-256, zero-based original track
  index, and zero-based event index. Every SMF event counts, including names,
  metadata, and EndOfTrack. Pitch does not determine identity
- Public records have private fields and shared getters. They implement
  `Serialize`, but not `Deserialize`. JSON is inspection output and omits the
  original binary. Persist original bytes and the expected digest, then reparse
  them to restore a trusted timeline; do not accept edited event JSON
- `source_range()` identifies each full original event encoding, including
  its delta VLQ. `encoded_event(id)` verifies source identity and returns that
  exact slice. Ranges for one track concatenate back to its full payload

The core uses the pinned `sha2 = "=0.10.9"` dependency also used by the
canonical assistance binding module.

## Event preservation and ordering

All seven channel-message classes retain their numeric values, including
release velocity, zero-velocity NoteOn, controllers, pressure, 14-bit bend, and
zero-based program/channel numbers. NoteOff remains an independent event.
Repeated same-pitch NoteOn events, unmatched releases, unclosed onsets, and
overlapping voices remain distinct. No duration or pairing is guessed.

Channel 10 remains channel index 9, with unchanged keys and programs. The core
does not reinterpret percussion as pitched piano notes, choose a drum kit, or
assume General MIDI. Bank/program routing and sound selection require a future
explicit consumer contract.

Tempo and meter expose their exact numeric fields. Other metadata exposes its
original type byte and payload bytes, including unknown/sequencer-specific
events and arbitrary text encodings. SysEx and F7 escape/continuation packets
retain their bytes independently. All such unsupported interpretation is
reported through bounded, aggregated diagnostics; events are not discarded.

Events are sorted by `(absolute_tick, original_track_index, original_event_index)`.
This preserves each track's source order. Same-channel events at equal ticks
in separate format-1 tracks produce `cross_track_channel_order`. This sort is
deterministic inspection order, not evidence of original hardware dispatch
order. Tracks are not assumed to be independent instruments or MIDI ports.

## Exact relative time

- Every event retains its original delta ticks, absolute tick, and a reduced
  `Beat` in exact quarter-note time (`tick / PPQ`)
- Relative microseconds use integer integration of SMF's 24-bit microseconds
  per quarter values, divided by PPQ. There is no BPM conversion, floating
  point, quantization, or per-segment rounding
- The standard 500,000-microseconds-per-quarter default applies before the
  first tempo. This is diagnosed and does not add a synthetic source event
- Same-track tempo events at an equal tick remain distinct; the last event
  governs the following interval. Identical cross-track tempo values are
  retained and give an exact clock
- Unequal tempo values at the same tick across tracks conservatively disable
  the entire derived relative clock. Zero tempo also disables it. All original
  events, ticks, and quarter-note times remain available, with explicit
  diagnostics; the parser does not choose a guessed ordering or substitute BPM
- Exact microsecond numerators serialize as decimal strings because valid
  values can exceed JavaScript's exact integer range. Denominators are positive
  integers no greater than PPQ
- SMPTE offset metadata is retained and diagnosed. The optional PPQ clock is
  explicitly relative to tick zero and does not apply absolute timecode offsets

An available relative clock does not mean events are safe or ready to play.
Controller, SysEx, device state, port mapping, sound selection, acoustic decay,
and grading semantics remain unresolved. Meter bytes never become inferred
bars, notes, or target durations.

## Accepted boundary

This core accepts plain format-0 and format-1 SMF with a six-byte header,
nonzero PPQ, exactly declared tracks, and a final EndOfTrack for every track.
Limits are 5 MiB source bytes, 128 tracks (exactly one for format 0), 250,000
total events, and an absolute tick of 1,000,000,000. Parsing is lazy and stops
at the event bound before collecting an oversized event vector. With these
bounds, exact integrated microsecond numerators fit in `u64`.

Format 2 independent sequences and SMPTE divisions are explicitly unsupported
for this single timeline. Wrapped/extended/unknown containers, truncation,
trailing bytes, invalid event framing, fixed-length metadata with an incorrect
length, missing EOT, and events after EOT are rejected with structured error
codes. No partial timeline is returned on failure. Callers retain responsibility
for keeping the original input when an import is unsupported.

Synthetic Rust tests cover multiple independent channels, overlaps and releases,
running status, encoding-sensitive source hashes, all message classes, opaque
metadata/SysEx, equal-tick ambiguity, exact tempo integration, clock refusal,
container failures, immutable-source recovery, JSON precision, and all bounds.
No private song source, melodies, or derivative fixtures are included.
