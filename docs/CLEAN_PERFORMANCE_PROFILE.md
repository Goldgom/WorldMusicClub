# Complete performance profile

This additive profile now has a bounded native-package and saved-song listening
consumer. The existing wmh-semantic-midi1-v1 profile remains independent and
unchanged. `score_core::clean_performance` provides conversion, validation and
runtime compilation; the web receiver accepts clean bytes plus a trusted native
compiler response bound to their SHA-256. See CLEAN_PERFORMANCE_NATIVE_BRIDGE.md
for dispatch, null notation, package binding and remaining acceptance limits.

The outer clean package stays metadata.json, score.json and optional declared
media. Original MIDI, archive, encoded original, raw bytes, generic event dump,
runtime report and receiver-derived note pairs are forbidden. Source descriptors
are byte count and SHA evidence only, not license grants or original contents.

The score envelope is worldmusichub-complete-score version 2, with root id/title,
source, nullable notation, performance and coverage. The typed profile is
wmh-performance-midi1-v1. Consumers must discriminate both version and profile;
existing version 1 validation must never admit version 2 silently.

The first slice accepts null notation only, with separately calculated complete
performance data and unavailable notation/targets covering zero attacks. This
does not assert that no notes could be proved later. A future partial target
view must bind canonical notes to uniquely proved attack/release evidence while
retaining all eleven performance tracks in this same song, never a subset song.

Tracks include silent conductors, stable ID, original index/count and end beat.
Parts preserve track/channel routes, not inferred instruments, staffs or voices.
Independent key_attack/key_release commands preserve key, velocity, source
coordinate and exact quarter-note beat. Event IDs combine hash, track and index.
Zero-velocity note-on becomes a semantically equivalent release with velocity
zero. No original wire representation, guessed pairing or duration is stored.

The closed vocabulary includes named program/bank components, volume, pan,
expression, reverb/chorus send, key/channel pressure, exact tempo, meter including
metronome grouping, key signature, sequence number, plain textual cues and final
track end. Unknown controllers, bend, routing, device/system messages, encoded
project blocks and undecodable text hold the entire conversion. No arbitrary
bytes, source ranges or hidden payload case is allowed. Simultaneous cross-track
channel commands remain held pending a reviewed commutativity rule.

Validation checks schema closure, bounds, every original source coordinate,
per-track and overall ordering, final EOT, all parts, exact clock integration and
calculated coverage. External source hashes are claims; conversion verifies the
original bytes privately. compile_performance accepts authoritative clean JSON
bytes and returns a hash-bound derived runtime with exact rational microseconds.

Renderer preparation explicitly selects wmh-original-reference-fifo-v1. Every
attack creates a layer; a release closes the oldest held layer on channel/key;
unmatched releases are acknowledged; held layers stop at global end. These are
receiver gates, never recovered source durations. Existing procedural program
families and WMH Reference Percussion v1 provide explicit mappings, including
85/86/87 substitutes. Source programs/keys remain intact; original kit/timbre is
unverified. The user must select the reference rendition explicitly.

A preserved command the receiver cannot apply blocks this renderer while
leaving the semantic package complete. Track muting gates allocated voices and
does not remove source events or shared state; shared-channel track mutes remain
unsupported. Tests must compare production ReferenceAudioReceiver scheduling,
fake source start/stop/cleanup, all event identities/times and every track mute.
Also cover pause/resume, cancellation, late scheduling and allocation failures.

The native consumer dispatcher matches `format` =
`worldmusichub-complete-score`, `version` = 2 and `performance.profile` =
`wmh-performance-midi1-v1`, then calls `decode_json` / `compile_performance`.
It never sends this envelope to the version-1 notation compiler, manufactures an
empty canonical score or uses reference gates for practice targets. The shared
metadata-v2 package path verifies source descriptor, root identity/title, exact
score-byte hash, assets, reimport and export. The native canonical payload is
explicitly null when notation is unavailable.

All tracks, including silent conductors, remain part of the single performance.
Muting is a receiver choice and never rewrites the package or drops events.
The reference policy must be accepted before playback. Unsupported receiver
commands must be reported as blockers; their presence cannot be advertised as
successful listening merely because typed conversion succeeded.

No fake-audio result proves physical sound, original fidelity, notation, grading,
or browser/native GUI acceptance. The bounded native and lobby integration
preserves null notation and requires an explicit supported reference receiver.
Only authored fixtures go into CI; provided music and conversion proof stay
private. The canonical piano/guitar practice stage is outside this null-notation
slice.
