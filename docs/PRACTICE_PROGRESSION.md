# Progressive keyboard practice

Progression is an independently versioned, deterministic hierarchy of human
targets over one complete, immutable practice source. It is a keyboard practice
prototype, not a skill grade, musical optimum, hand assignment, fingering plan,
or certificate that every independent key release is physically possible.

The three fixed layers are generated in this order: Dense from the complete
eligible source, Balanced from Dense's whole source/physical atoms, and Single
from Balanced's atoms. The returned summary order is Single, Balanced, Dense.
Thus `H(single) ⊆ H(balanced) ⊆ H(dense)`. Equal adjacent layers and empty layers
are valid. Empty human targets disable scored mode. A layer label never promises
that a particular source will produce more targets than its predecessor.
Generation still requires 1–128 existing selected parts. An empty part list is
invalid; a valid scope may nevertheless produce an empty layer because every
target is out of range, ineligible, or excluded by a physical group boundary.

| Layer | Targets per onset | Minimum onset interval | Simultaneous keys | Held span |
| --- | ---: | ---: | ---: | ---: |
| `single` | 1 | 500 ms | 1 | 0 semitones |
| `balanced` | 2 | 250 ms | 3 | 7 semitones |
| `dense` | 4 | 125 ms | 6 | 12 semitones |

All grouping and gates are derived from the complete source. No intermediate
reduced Score or PracticeSource is constructed. Ties, repeats, physical unisons,
cross-part groups, and full interpreted release gates cannot be split to meet a
layer's limits. Machine accompaniment remains the complement in that same full
source runtime. A cross-scope physical group remains wholly machine-owned.

## Independent contract

The core API is `score_core::practice_progression::{generate, validate}`. Its
proof identifies:

- format: `wmc-practice-progression`
- schema version, planner revision, immutable generation revision: `1`
- algorithm: `wmc-keyboard-progression-v1`
- scheme: `wmc-keyboard-three-layer-v1`

The existing `wmc-keyboard-assistance-v1` algorithm and assistance APIs retain
their meanings and response shapes. Three independent v1 settings do not prove
a nested hierarchy. Original remains the existing separately validated
`/api/practice-assistance/original` or `/api/library/assistance/original` exit.
It retains full selected targets and can be unscoreable or rejected if selection
splits a physical group. It is not a fourth progressive layer.

### Canonical source

POST `/api/practice-progression/generate`:

```json
{"score": "complete canonical Score object", "selection": {"selected_part_ids": ["piano"], "profile": {"kind": "piano", "key_count": 88, "lowest_midi": 21}}, "layer": "single"}
```

POST `/api/practice-progression/validate`:

```json
{"score": "complete current canonical Score object", "plan": "returned progression plan object"}
```

The strings above mark object positions, not accepted string values. The server
constructs `PracticeSource::from_canonical` afresh from the complete score.
The canonical millisecond runtime and exact source gates remain authoritative.
The returned source descriptor has `kind`, `source_binding`, `profile`, `choice`,
and `runtime_policy`; it never invents a saved package key or hash.

### Saved native source

POST `/api/library/progression/generate` accepts `{source, selection, layer}`;
POST `/api/library/progression/validate` accepts `{source, plan}`. `source` is:

```json
{"key": "song-<sha256>", "content_sha256": "<sha256>", "profile": "<saved source profile>", "choice": null, "runtime_policy": "<profile-specific policy>"}
```

Every descriptor field is required, including an explicit null choice where
appropriate. Basic uses its authoritative FIFO rendition and synthetic gate
policy, not notation fallback or renderer MIDI pairing. VSQ uses the explicit
`base_notes_instrumental` choice and its zero-origin runtime, not offset notation
time. Full-vocal or unsupported profiles cannot claim a compatible fallback.
Saved canonical and supported complete MIDI packages use the existing trusted
source loader under the same checks.

Each generate or validate reloads the exact persisted package snapshot. The
loader checks the entry identity, saved bytes, profile/choice/policy, active
edition and independent backup. The admitted saved-package hash is bound into
the trusted receipt only after those checks. A semantically irrelevant byte
change, such as added source whitespace, still invalidates that saved identity.
Neither endpoint writes source data or runtime sidecars.

### Response and replay

Both source adapters return `{source, checked}`. `checked` contains exactly:

- `plan`: the independent progression proof
- `layers`: three compact summaries, each containing layer, fixed constraints,
  human source-unit/occurrence/target counts, scored-mode availability, and
  `equals_previous_layer` (false for Single)
- `assistance`: only the selected layer's complete checked Explicit assistance

The progression plan contains `format`, `schema_version`, `planner_revision`,
`revision`, `algorithm_id`, `scheme_id`, `receipt`, normalized `selection`,
`selection_digest`, `scheme_digest`, `hierarchy_digest`, `layer`, and
`plan_digest`. Selection identity includes source receipt and normalized part
scope/instrument profile. Scheme identity binds the fixed ordered constraints
and versioned algorithm. Hierarchy identity binds all ordered memberships under
that trusted source/selection/scheme. It is common to all three layer choices.
The final plan digest additionally binds the chosen layer and complete plan,
using an empty own digest field during hashing.

Clients retain the progression plan and send it through progressive validation.
The server rebuilds and independently checks the hierarchy, then compares the
complete expected plan. A v1 Explicit assistance plan alone proves no nesting.
After validation, consume only the newly returned assistance. Changing a saved
plan's layer, profile, selection, source receipt, version, scheme, or any digest
fails; regenerate to choose another layer. Digests bind deterministic content;
they are not signatures or permission tokens.

Requests never accept caller hierarchies, eligibility masks, human IDs, layer
summaries, checked assistance, cached compilations, or renderer timelines. The
strict request/proof types reject unknown fields. Unsupported versions and
stale source/proof claims return structured failures, without a checked result.

## Bounds and failure behavior

Both routes use existing 8 MiB request admission and POST-only routing. Native
routes also use the existing large-operation admission gate. Source limits and
the bounded selector/independent-verifier work budget remain in force. Complete
progression response envelopes have a 16 MiB ceiling, including source metadata
and summaries. Nothing is truncated into a successful partial hierarchy or
plan; failure returns only a structured error. There is no partial save.

Canonical malformed requests return HTTP 400 with
`practice_progression_invalid_request`; source failures use
`practice_progression_source`. Core failures preserve `progression_*` codes
(HTTP 422). Envelope overflow returns HTTP 413 `response_body_limit`.
Native malformed requests retain `library_invalid_request`; source checks
retain existing loader codes, core failures use
`library_progression_unavailable`, and envelope overflow is HTTP 413
`library_progression_response_limit`. Methods, origin, media type, and request
budget failures retain existing structured adapter conventions.

## Reproducible public vectors

These checked-in files come from the actual socket-free handlers and contain
only original exercises:

- `tests/fixtures/progression-canonical.json`: twelve original 125 ms attacks,
  producing 3/6/12 nested targets, the complete source/compilation/audio profile,
  Original response, and each progressive response
- `tests/fixtures/progression-native-basic.json`: the existing original FIFO
  package's exact bytes, including retained whitespace; complete-source
  overlapping releases, zero-duration synthetic gates, and percussion
- `tests/fixtures/progression-native-vsq.json`: the existing original semantic
  VSQ package; zero-origin clock, two-source physical unison, and empty
  cross-scope layers

Regenerate and verify them without launching a server or native GUI:

```sh
WMH_UPDATE_PROGRESSION_FIXTURES=1 cargo test -p practice-server --test practice_progression_api --locked
WMH_UPDATE_PROGRESSION_FIXTURES=1 cargo test -p worldmusichub-desktop --test native_progression --locked
```

Without that environment variable the tests compare the complete regenerated
fixture bytes. Native tests additionally reopen storage, revalidate against
reloaded sources, compare all source/export bytes, reject corruption in primary
and backup packages, and exercise stale or injected plans. UI fixtures must use
these handler outputs, not fabricated hierarchy proofs.
