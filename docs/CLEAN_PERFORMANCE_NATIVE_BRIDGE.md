# Complete performance consumer bridge

This additive development slice connects `wmh-performance-midi1-v1` to the
existing metadata-v2 CLEAN song folder and native library. It is not a Windows
or browser acceptance claim. Strict MIDI v1 and VSQ remain independent profiles.

## Dispatch and absence of notation

The native package parser matches the format, score version and profile together:

- complete-score v1 with performance profile `wmh-semantic-midi1-v1`: existing
  strict notation plus complete performance
- complete-score v1 with root profile `wmh-vsq-clean-v1`: existing explicit VSQ
  base-note choice
- complete-score v2 with performance profile `wmh-performance-midi1-v1`: complete
  independent commands, unavailable notation and unavailable practice targets

The last path calls `clean_performance::decode_json` and `compile_performance`
on exact clean bytes. The library load response's `score_json` is JSON null.
`clean_package.score_json` retains the original complete JSON string and
`clean_package.runtime` is the separate Rust-compiled response bound to its
SHA-256. No empty `Score`, receiver-derived note pairs, or grading timeline is
created. The saved summary reports `notation_available: false` and exact coverage.

For indexing, a notation-free entry's score byte count/hash refer to its complete
score bytes. Its ID/title come from the validated complete root, its composer is
unknown, and its provenance is the package's declared rights evidence. This is
not a license verification. Existing notation profiles retain their old indexing.

## Storage and assets

The metadata format/version stay `worldmusichub-song`/2. ID, title, exact score
byte count/hash, source format/byte count/hash, exact inventory and media hashes
must agree. Stem bindings use the complete performance route IDs, including
routes that have no notation. Original MIDI, encoded originals and unlisted
files remain forbidden inside a CLEAN folder. Export keeps exact original clean
JSON and declared asset bytes, including formatting.

The existing transaction, process/OS locks, primary/independent-backup writes,
recovery, immutable IDs, capacity checks, symlink rejection and asset handles are
shared. No limits or storage locking rules are expanded. The existing 16 MiB
complete JSON, 128 MiB package and bounded native response checks still apply.

## Listening contract

The frontend verifies the separate runtime's profile, score/source hashes,
identity, tracks, parts, coverage and every event against the native-loaded clean
package. WebCrypto checks exact score bytes before admitting the opaque receiver
handle. Ordinary canonical compilation is skipped for this explicit profile.

The existing saved-song lobby and game shell display all source tracks, all
attacks and unavailable notation/targets. Listening requires an explicit choice
of `wmh-original-reference-fifo-v1`. Overlapping attacks allocate layers and
releases close the oldest held channel/key layer. These are reference sound
gates, never source durations or practice targets. Procedural programs and the
listed percussion substitutions do not claim original timbre.

Every preserved command must be supported by the production receiver before any
reference listening or track muting is enabled. The separately selected controls-v2 policy supports channel volume, pan,
expression, sustain and the declared procedural room send, plus constrained
initial reset, bank zero and chorus zero. Nonzero bank/chorus and pressure remain
structural data and block the receiver. See CLEAN_PERFORMANCE_PROFILE.md for
exact state, gate and compatibility rules. Track muting changes voices only; events remain intact. Shared
channel routes cannot be independently muted. Recorded mixes/stems are retained
for export; this slice uses reference synthesis only.

This slice listens in the existing preview shell. The canonical piano/guitar
stage, notation lanes, Practice and grading remain unavailable for this profile.
No placeholder targets are sent to that stage. Navigation or a newer selection
stops playback and revokes its interpretation choice; it never resumes itself.

## Verification boundaries

`generate_performance_fixture` produces only newly authored eleven-track test
material, including a silent conductor, overlapping attacks, independent
releases and a declared reference percussion substitute. The native tests cover
import, explicit null notation, restart, exact byte export/reimport, media,
backup recovery and rejected profile/identity/source/inventory mutations.
Frontend tests cover native admission, receiver blockers and lifecycle/UI
behavior. Existing strict and VSQ regressions remain required.

Fake audio tests establish scheduling and cleanup, not physical sound, original
fidelity or packaged/native GUI acceptance. User-provided music and source proofs
must stay outside the repository and public CI.
