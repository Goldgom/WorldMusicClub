# Advisory whole-phrase piano hand and fingering guidance

`POST /api/fingering/piano` accepts:

```json
{
  "score": "the complete canonical score object",
  "part_id": null,
  "profile": {"kind":"piano", "key_count":88, "lowest_midi":null},
  "left_hand": {"lowest_midi":0, "highest_midi":127, "max_span_semitones":12},
  "right_hand": {"lowest_midi":0, "highest_midi":127, "max_span_semitones":12},
  "locks": [{"source_note_id":"canonical-note-id", "hand":"left", "finger":3}]
}
```

`part_id:null` selects all parts; an existing part ID selects that part explicitly.
The keyboard profile uses the existing instrument-analysis ranges. Hand profiles
are inclusive MIDI ranges, intersected with that keyboard range; each missing
hand profile defaults to MIDI 0–127 and a 12-semitone maximum held span. A reach
of 0–24 semitones is accepted as a user-selected model constraint, not a measured
hand size, safety recommendation or assertion that every allowed interval is
comfortable. A hand can move anywhere inside its range after releasing keys.

The response is a deterministic recommendation within disclosed constraints,
objective and search limits. It is not a global or biomechanical optimum. It does
not alter canonical notes, sources, compilation, physical practice targets,
notation, playback or assessment. A ready plan cannot bypass existing keyboard
range gates. Pitch-only MIDI does not verify the played hand or finger.

## Source identity, merged targets and exact holds

`source_occurrence_count` counts selected compiled sounding occurrences, including
repeats and separate unison voices. `physical_target_count` counts exact same-key,
same-onset groups. It is `null` only when input limits prevent exact grouping;
this must be displayed as unavailable, not zero.

`targets` contains every selected physical target within the input limits, even
when the search fails. Each target carries:

- `target_id`: the same representative occurrence as `/api/practice-targets`
- `source_occurrence_ids`: every unmerged compiled occurrence in the group
- `source_note_ids`: all canonical written IDs, including complete tied segments
- `part_ids`: the sorted unique originating parts
- `midi`, unchanged compiled `start_ms`, longest written `end_ms`, and zero-based
  performance `onset_index`

A successful `assignments` array repeats these fields and adds `hand` (`left` or
`right`) and `finger` (1 thumb, 2 index, 3 middle, 4 ring, 5 little). It covers every
physical target exactly once, and its source references cover every selected
sounding occurrence exactly once. Exact simultaneous same-key voices share one
hand/finger and are held until the longest source end. Their identities and
independent written durations remain in the unchanged score; this model cannot
assess independent unison releases.

Occupancy uses exact rational written time and original repeat-segment order,
shared with the guitar planner. No epsilon, millisecond quantization or parsing
of generated occurrence IDs decides simultaneous attacks or held releases.
Equivalent fractions release together. Repeat occurrences remain distinct. A tie
chain is one held attack carrying all tied source IDs, not new attacks for tie
continuations. Unsupported floating display-clock resolution is an explicit
error, never a reason to merge distinct written attacks.

The target ordering agrees with `/api/practice-targets` on supported display
clocks: onset, pitch, then representative occurrence ID. Only source IDs and the
Rust-derived occurrence map establish identity; pitch alone does not.

## Declared physical model

Each hand has five fingers. A finger can hold one key at a time. Active right-hand
finger numbers increase with pitch; active left-hand finger numbers decrease.
Every pair of active keys in a hand must obey its configured semitone reach.
All active holds constrain later onsets until their exact release. Released
fingers are free for a new attack at that same exact time.

Hand crossings and overlapping hand ranges are permitted, without modeling hand
collisions or proving a crossing practical. A staff is only a soft suggestion:
staff 2 and higher suggest left, staff 1 suggests right, and the search may choose
either hand. Manual locks take precedence over these suggestions. A score without
a grand-staff layout therefore need not be manually rewritten first.

Pedal, finger substitution while held, thumb-under movement during active holds,
black-key physical geometry, independent unison releases and individual technique
are outside the model. A later attack on an already held physical key is an
explicit conflict even if the other hand is free: preserving the complete earlier
hold and reattacking the same key is impossible in this no-pedal/no-substitution
model. This is an arrangement/model diagnostic, not a claim the passage is
unplayable by a pianist using other techniques.

## Deterministic objective and bounded whole-phrase search

Version 1 uses `deterministic_piano_beam_v1`, at most 1,000 sounding occurrences,
16,384 tied-source references, 64 retained future states, and 2,000,000 candidate
position checks. Responses have an 8 MiB limit with an explicit error rather
than truncation. `beam_width`, `max_expansions`, `explored_choices`, `beam_pruned`
and `objective_cost` disclose the work performed. Requesting a larger search
budget is not supported by client-supplied fields.

At each onset, the search considers both hands and fingers 1–5, filtered by ranges
and canonical source locks. It assigns the whole simultaneous group while
preserving active holds. The 64 cheapest distinct future states are retained;
equivalent states keep their cheaper path. Equal-cost candidate order is stable.
Finger positions, per-hand anchor and that hand's last attack time all contribute
to future-state identity. No successful prefix is returned as a complete phrase.

Costs are heuristics, not physical difficulty measurements:

- Finger offsets from a thumb anchor are `[0,2,4,5,7]` semitones, mirrored for the
  left hand. The anchor is the upper median implied by that hand's active keys
- When a hand attacks, anchor movement costs 12 per semitone multiplied by
  `1 + floor(1000 / (elapsed_hand_onset_ms + 50))`. Its first use has no movement
  cost. The elapsed time uses the original compiled tempo map, including rests
- That attacking hand's active implied-anchor deviations cost 2 per semitone;
  its held pitch span costs the square of the semitone span
- Each newly attacked source occurrence assigned against its staff suggestion
  costs 8; merged voices can contribute competing soft suggestions
- A left-hand attack above MIDI 64, or right-hand attack below MIDI 56, costs 2
  per semitone beyond that boundary
- A thumb attack on a black key costs 5

Future requirements can therefore change earlier choices. The test phrase holds
C4 while D4 must be played with the right thumb. The complete plan uses the left
hand for C4, although planning C4 alone prefers the right hand. Beam pruning can
still miss a valid or lower-cost route; no global-optimality claim is made.

## Editable locks, failures and compatibility

A lock names one selected sounding canonical `source_note_id` and a hand and/or
finger. Missing/null constraint fields stay free. Every repeated occurrence and
the entire tie chain containing that written segment inherit the lock. All locks
on merged unison voices must agree with the single physical assignment. Unknown,
duplicate, rest-only or unselected source IDs are rejected; conflicting locks on
valid merged/tied sources produce an explicit infeasible result. `requested_locks`
echoes the request without claiming failed locks were applied.

`issues` supplies a code, explanation, zero-based `onset_index` when known, and
exact affected `target_ids`, `source_occurrence_ids` and `source_note_ids`.
Compilation warnings and planner model/objective diagnostics remain separate
from the structured issues.

- `ready`: a complete recommendation under this model
- `no_targets`: no selected sounding targets; complete with no assignments
- `infeasible_under_model`: a proven range/lock/held-key/capacity conflict, or all
  paths violate constraints before any beam pruning
- `no_plan_found`: retained paths failed after pruning; a discarded path might work
- `search_limit`: bounded candidate checks ran out; feasibility is unresolved
- `unavailable`: input limits prevent planning; no partial target map is returned

Every incomplete result has `complete:false`, `objective_cost:null` and no
assignments. Targets remain complete on bounded search failures. For over-limit
requests the source count is retained, the physical count is unknown and an
explicit limit explanation accompanies empty arrays. No musical event is deleted.

Canonical music contains no hand/finger annotations. Frontend annotation storage
must use an explicit versioned compatibility record outside the canonical score,
validate source IDs against the exact score and selected part, and treat storage
failure as session-only rather than losing the edits. Replan when the score,
transposition, part selection, instrument range, hand configuration, tempo or locks
change; never display an earlier result as current. Locks are user preferences;
recommendations are derived output. Changes to weights, finger semantics or search
semantics require a new algorithm identifier.
