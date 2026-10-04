# Complete basic MIDI-key conversion

`wmh-basic-keys-midi1-v1` is a versioned profile of the existing
`worldmusichub-complete-score` version 1 envelope. It belongs inside the existing
`worldmusichub-song` package and pack family. It is not another top-level score
format. VSQ continues through the existing complete VSQ decoder and projection;
the generic basic-key converter refuses framed VSQ project text.

The core API is `basic_keys::convert_midi(bytes, title)`, `encode_json`,
`decode_json`, `validate`, and `compile_practice`. The public Rust result exposes
all derived attacks. Consumers must use the core decoder rather than treating
deserialized projections as trusted or reimplementing note ownership.

Authoring can explicitly request `intent: "basic_keys"` through the existing
conversion request, producing `basic_key_candidate` plus `basic_key_coverage`.
Omitting intent, or choosing `source_rendition`, preserves the established
strict-notation/reference conversion path. `prepare_basic_keys` is the core
entry point for the explicit choice. It uses the same VSQ-first recognition and
retains the existing VSQ profile rather than converting its carrier MIDI again.

## What the package retains

All source tracks and all MIDI channel, metadata, tempo, meter, SysEx and escape
events remain in their original track and event positions. Programs, banks,
controllers, pressure, bend, text bytes and packet boundaries are preserved even
when a renderer cannot interpret them. No track is discarded for an unsupported
instrument, effect or controller. Original MIDI/ZIP files and Base64 source
copies do not belong in the delivered package.

Each track contains compact event rows:

    [delta_ticks, [status, payload...], true?]

The third value is present only when channel status was omitted in the original
running-status encoding. A meta row's message is `[255, meta_type, data...]`;
length is derived from the payload. F0 and F7 rows retain the entire respective
packet payload. Channel status is explicit in the message array even when the
original used running status. VLQ byte encodings are normalized, so this is
lossless event content, not a claim of byte-identical original file recreation.
The original file SHA-256 and byte count remain provenance evidence, not proof
that an untrusted package was independently compared with an original.

Source coordinates are the track's `source_index` and the event-array index,
including every non-note event. The original source hash occurs once in the
envelope. Full stable event identity is `midi:<sha256>:t<track>:e<event>`.
Canonical note IDs use `midi-t<one-based-track>-e<one-based-event>` and are scoped
to that source envelope. Timing always retains exact ticks and PPQ. Core-derived
note positions include rational beats and optional exact rational microseconds;
numerators serialize as decimal strings to prevent JavaScript integer rounding.

The package stores the canonical positive-duration `Score` projection, plus the
complete event sequence. It omits duplicate `performance.notes` from the wire.
`decode_json` derives every attack again and checks the projection, routing,
coverage, clocks and identities against all event records before returning full
in-memory notes. This also retains zero-time, unresolved and percussion attacks
that cannot become ordinary positive-duration score notes. Do not use generic
Serde serialization in place of `encode_json` when saving a package.

## Ownership and duration proof

The profile explicitly defines total event order as tick, track index, then
event index. This is deterministic source ordering, not a claim about the order
in which original hardware dispatched simultaneous cross-track events. Tracks
sharing a logical route and channel are analyzed together. Channel Prefix
metadata never rewrites a channel-message status. Track-local Port and DeviceName
declarations take effect in source order, and their original bytes remain events.

For each logical route/channel/key, a positive note-on increases the held count;
note-off or velocity-zero note-on consumes one available attack. A release at
count zero is explicitly unmatched. Busy components end when the count returns
to zero. For an attack in a closed component, the possible release owners are
exactly every following release in that component. In an open final component,
every attack can also remain unreleased.

Consequently an end tick is asserted only when the first eligible and final
release ticks agree and the component closes. A single candidate is a unique
release. Multiple candidates at the same tick have equivalent end time but
ambiguous release identity. Differing ticks stay unresolved. A zero-tick interval
stays exactly zero; no grace note or positive duration is invented. Later attacks
can have determined ends even when earlier attacks in the same component do not.

This algorithm is linear after ordering, with compact first/last/count candidate
evidence rather than a quadratic list for every attack. The proof is constructive:
keep a chosen attack available until any later release in its component; before
that release the positive remaining count guarantees another owner. Count-zero
boundaries forbid ownership across components. Original tests compare against
exhaustive ownership enumeration over all attack/release words through length 10.
An independent proof check covered all 32,767 words through length 14.

An unspecified destination can alias an explicitly declared one. A channel/key
active on different potentially aliasing route declarations needs an additional
proof even when its per-declaration pairing looked unique. If every involved
declared route/key stream closes and has no orphan releases, every possible
route-partition assignment is also valid in the fully merged channel/key stream:
each release still consumes a preceding attack, no attack is reused, and all
attacks close. The fully merged assignments can be a strict superset, which is
safe for this proof. When this superset has one end tick, that endpoint is marked
`route_invariant_release_time`; release identity remains unspecified. The
first/last/count candidate fields are absent/zero for this proof, because an
overapproximating merged set must not be mislabeled as exact release identities.

Otherwise these attacks remain `unresolved_route_ownership`. Orphan releases or
open declared-route streams disable the sufficient-condition proof entirely;
merging such streams can change which releases are consumed and would invalidate
the subset argument. Original tests exhaustively enumerate both partitions and
all ownership choices for balanced two-route words through length six, plus
explicit orphan/open counterexamples. Explicit distinct declarations remain
distinct logical routes. No physical-device alias or sound mapping is invented.

Intervals describe explicit key messages. Sustain, AllNotesOff, AllSoundOff,
retrigger effects, envelopes and reverb remain rendition semantics. An inferred
key-message end is not an acoustic sound end.

## Timing, pitch and capabilities

The SMF default 500,000 microseconds per quarter may supply the initial relative
clock; `smf_default_tempo_used` declares that provenance. No fake original tempo
event is inserted into `Score.tempo` or the source records. Conflicting cross-track
tempos or zero tempo leave the relative clock unavailable while exact tick/beat
key observations remain. Missing, conflicting or unconventional meter is explicit;
no bars, key signature or meter are guessed. Source tempo can fall outside the
generic playback compiler's BPM limits.

Pitches in this projection spell nominal MIDI key numbers. They do not establish
acoustic pitch or instrument identity. Channel 10 is explicitly labeled
`channel10_key_number_percussion_unresolved`; it is never silently made piano.
All positive determined keys can appear in the inspection projection, including
these key numbers. `projected_melodic_targets` counts positive determined non-10
keys separately from `notation_notes`.

`compile_practice` retains the complete projection and every part in its
compilation score, while its target timeline contains only positive determined
non-channel-10 keys. It derives milliseconds from exact source-clock rationals,
not a BPM round trip. If the clock is unavailable it returns `None`, without
rejecting the package. The current helper does not expose onset-only targets for
unresolved or zero-time attacks. This is a declared practice subset; coverage
reports its exact count. Source-sound/reference playback requires an explicit
receiver mapping and is not admitted by this profile.

## Explicit compatibility and source defects

The established strict MIDI importer is unchanged. The basic profile's separate
event decoder additionally supports two bounded, explicitly reported situations:

- Legacy running status across metadata reuses the last channel status only at a
  data-only event position. It retains source omission flags and counts these
  events. SysEx/escape clears this compatibility context. No value changes
- A high-bit byte in an explicit one-byte program-change data slot is retained as
  an invalid program value. Fixed status arity determines the slot; the entire
  remaining track must frame correctly without skipped bytes or resynchronizing.
  The invalid value is never masked, clamped or treated as a valid sound program.
  `invalid_program_events` requires source-defect review while surrounding valid
  notes remain available

High-bit note/controller payloads, truncated or overflowing lengths, malformed
fixed metadata, missing EndOfTrack, trailing events, unsupported containers,
format 2 and SMPTE divisions still return explicit source/format errors. These
are current boundaries, not a claim that all possible MIDI dialects are supported.

## Limits and validation

The ordinary input decoder retains the existing 5 MiB, 128-track, 250,000-event
and 1,000,000,000-tick bounds. Normalized validation records have their own 16 MiB
bound because explicit statuses can exceed original running-status size. Package
encoding stays under the native 16 MiB score limit; exceeding a bound returns an
explicit error and never trims notes or events. A 41,900-attack original stress
fixture encodes to 10,629,760 bytes including its canonical projection.

The profile schema is
`schema/worldmusichub-basic-keys-midi1-v1.schema.json`. It references canonical
Score components but allows profile-specific empty tempo/parts and unrestricted
positive source BPM. Structural schema validation is insufficient: core decoding
recomputes all derived claims. General `Score` playback validation must not be
used to reject this inspection projection merely because tempo, duration or
instrument capabilities are unavailable.
