# Canonical song assistance core

`score_core::assistance` assigns explicit human/machine ownership to a saved
canonical `Score`. It does not import raw MIDI, author difficulty levels, infer
hands from tracks, or rewrite the song. Source binding uses pinned RustCrypto
`sha2 = "=0.10.9"` (MIT OR Apache-2.0); it introduces no service.

## API contract

- `create_assistance_plan(&score, &part_ids, &profile, &human_source_note_ids)`
  creates checked revision 1. Part scope is explicit and nonempty. The human list
  contains written pitched source IDs, not repeat occurrence IDs.
- Persist `checked.plan` alongside the exact unchanged saved score. On reload or
  selection edits, use `validate_assistance_plan(&score, &saved_plan)`. Never trust
  a saved derived timeline, target list, playability flag, or coverage count.
- `schema_version` and `planner_revision` must match this implementation. A saved
  `revision` must be positive; storage owns comparing/incrementing that revision
  to prevent stale updates. This stateless module cannot check storage history.
- `source_binding` contains `algorithm = "sha256"`,
  `serialization = "worldmusichub-score-serde-json"`, `serialization_revision = 1`
  and a 64-character lowercase digest. SHA-256 covers the exact bytes returned by
  Rust `serde_json::to_vec(&Score)`, including every canonical field and retained
  original source. It does not hash a title, subset, JavaScript serialization or
  RFC 8785 projection. Unknown binding formats/revisions and malformed digests
  fail explicitly. The source score ID is also checked.
- The source is stored once outside the plan. On validation Rust regenerates the
  complete serialized bytes and digest; score or retained source changes invalidate
  the old binding. Serialized source is bounded to 8 MiB and never truncated.
  This is content integrity, **not authenticity**: a hash is not a signature and
  cannot establish who authored or approved a score or plan.
- Selection list ordering is normalized for deterministic output. Duplicate,
  absent, rest, outside-scope, malformed and partial-group IDs are rejected.
  Error `code` values are stable localization keys; messages are explanatory.

### Persistence and transport size

This is a bounded core API, not a multi-level file format. The stateless
HTTP/native creation and validation routes are documented in
[API.md](API.md#song-assistance-and-raw-midi-inspection).
It limits scope to 128 parts, human selection to 100,000 IDs, each identifier to
128 bytes, and serialized source to 8 MiB. That source limit does **not**
guarantee an entire `{score, plan}` request fits the existing
server's 8,388,608-byte body limit (`practice-server/src/main.rs`, `MAX_BODY`).
The API must still enforce the total request limit, including IDs and metadata.

Measured with the checked full-human plans for bundled complete editions:

| Edition | Score bytes | Plan bytes | `{score, plan}` bytes |
| --- | ---: | ---: | ---: |
| Schubert D768 | 532,794 | 11,904 | 544,716 |
| Beethoven Op. 48 No. 5 | 488,872 | 7,620 | 496,510 |

A generated 15,000-note original fixture with 1 MiB retained source produces a
4,357,500-byte score, a 259,278-byte full-human plan and a 4,616,796-byte combined
request. The plan contains no retained musical source. These fixtures contain no
private music. Size tests cover both this large original fixture and the bundled
complete editions.

Integration should retain one saved song in a versioned song envelope, with
authored levels containing only their ID selections, metadata and compact binding
to that same song. Do not embed a complete source score separately for every level.
The present core validates a single active plan and does not implement the saved
song envelope or authored level system.

## Ownership and playback

The existing `compile` function supplies complete tied source IDs and all repeat
occurrences. The existing `plan_targets` engine supplies physical groups in the
selected parts. Every segment of a compiled tie and every member of an exact
selected piano unison must share one owner. Selecting a written ID selects every
repeat of that ID. Partial groups fail; they are never automatically expanded.
Unresolved or ambiguous current ties also fail. Historical import observations
remain diagnostic metadata rather than evidence of a new current tie failure.

Outside-selected parts always remain machine accompaniment. Physical grouping is
scoped exactly as in the existing part-selection target engine: an outside part
can sound the same piano key at the same time as a selected human target. It still
does not belong in assessment. Guitar events retain separate targets.

`machine_timeline` contains the original canonical sounding occurrences assigned
to the machine, with their original IDs, source references, timing, velocity and
duration. It is not reduced to physical piano groups. Its duration, and the human
timeline duration, remain the complete song duration including rests and trailing
measures. Source timing, pitches, notation, order and retained source are unchanged.

`source_ownership` gives every written pitched note an explicit owner and scope
flag for both color and non-color UI labels. `selected_target_groups` gives the
owned physical groups. Coverage separates written notes, sounding occurrences
and physical targets rather than treating those different counts as equivalent.

## Human-only assessment and feasibility

Only `checked.human_targets.timeline` is an assessment target timeline. Pass only
real human device input into assessment; machine playback must never be turned
into synthetic input. Application integration is responsible for that routing.
The module itself does not assess, emit MIDI, or synthesize input.

An empty human selection preserves the complete machine playback and returns zero
human assessment targets with `scored_mode_allowed = false`. Full human selection
uses exactly the same targets as the existing target engine for that scope.
`all_selected_human` describes ownership, not feasibility.

`scored_mode_allowed` uses existing human-target feasibility. Infeasible human
notes are retained, with range/string-conflict diagnostics and scoring disabled.
`full_scope_playable` and `full_scope_diagnostics` separately describe the complete
selected scope, so an assisted subset can pass even if full human ownership cannot.
These checks cover instrument range and exact-onset string allocation; they do not
certify hand reach, sustained overlaps, fingering, or whole-ensemble playability.

## Verification

Original exercise fixtures cover machine-only playback, all-human parity with
existing targets and grades, nearby machine attacks unable to steal human input,
complete cross-voice/staff ties, exact and near unisons, repeated written IDs,
outside-scope accompaniment, content mismatch, versions/revisions/IDs, ranges,
guitar string conflicts, unresolved/ambiguous ties, and unchanged source content.
Further tests verify standard SHA-256 known answers, an independently computed
frozen canonical-score digest, source-size bounds, compact large-score plans,
binding format rejection, retained historical tie observations, rest-only scope,
and identical checked output for selection-order permutations.
