# Advisory whole-phrase guitar fingering

`POST /api/fingering/guitar` accepts `{score, part_id, profile, max_fret_span, locks}`.
The full canonical score is compiled by Rust. `part_id:null` plans all parts;
an existing part ID explicitly selects that part. The profile is the existing
`{kind:"guitar", tuning:[40,45,50,55,59,64], frets:12, capo:0}` shape.
`max_fret_span` defaults to 3 and bounds highest minus lowest held fretted position;
0–12 is supported. It is a chosen model constraint, not a measured hand size.
The planner currently has a core/API implementation; its player-facing controls
and recommended fretboard path are a separate integration step.

The result recommends one complete path under an explicit model. It is not a
global or biomechanical optimum, a claim of safe technique, or a performance
assessment. Canonical notes, sources, timestamps and existing scored-mode gates
are unchanged. Existing import/compile and range diagnostics remain in the
response. A successful guidance response must never bypass a practice range gate.

## Preserved identities and timing

Every selected sounding occurrence gets one assignment containing its exact
`occurrence_id`, complete tied `source_note_ids`, part, MIDI pitch, start/end
milliseconds, onset index and recommended string/fret/finger. Separate unison
voices require separate strings. A tie chain has one held assignment; its written
continuations are retained as source IDs and do not become new plucks. Every repeat
occurrence is retained. Rests are implicit gaps in the sounding phrase.

Held-string and finger occupancy uses exact rational written boundaries plus the
original repeat-segment order. It does not use floating tolerances or parse
generated occurrence IDs. A note ending exactly at the next onset releases its
string/finger for that onset. Milliseconds remain the unchanged Rust playback
clock and inform the movement cost; there is no second tempo engine. Unsupported
display-clock resolution produces an explicit error rather than merged onsets.

`string` is the one-based row in the supplied tuning array, matching
`InstrumentReport`. In the standard low-to-high array, row 1 is low E (conventionally
the sixth guitar string), and row 6 is high E. A UI must label that relationship
explicitly rather than call tuning row 1 the conventional first string. `fret` is
relative to the capo. Finger 0 means an open/capo-open string; 1–4 mean index,
middle, ring and little finger. Pitch-only MIDI cannot identify the actual row
or finger used.

## Model and deterministic objective

The search reserves each sounding string until the full written end. Four
fretting fingers are available. A finger holds one fret at a time; lower-numbered
fingers cannot be above higher-numbered fingers in this model. Multiple strings
may share a finger at the same fret as a simple barre. A barre cannot span a held
open or lower-fretted string; higher-fretted notes may sound above it. All held
fretted notes obey the configured fret span. Open strings do not consume a finger.

At each onset, search considers compatible positions and finger assignments for
the whole simultaneous group and carries held notes into later groups. It keeps
up to 64 distinct future states, preferring the lowest accumulated model cost.
Equivalent future states retain their cheaper path. Candidate enumeration and
equal-cost selection are deterministic.

Cost units are heuristic, not probabilities or measured physical difficulty:

- A hand anchor is the median of `fret - finger + 1`, clamped to at least 1;
  open-only positions retain the preceding anchor
- Anchor movement costs 100 per fret, multiplied by
  `1 + floor(1000 / (elapsed_onset_ms + 50))`; the first onset uses 1000 ms
- Distance from the anchor's four-fret finger positions costs 10 per fret
- Held fret span squared costs 3 per unit; each newly fretted note costs 3
- Extra held notes sharing a fretting finger cost 20 each
- Movement from the previous group's last tuning row to the next group's first
  row costs 8 per row

This lets a later required string change alter an earlier recommendation. The
regression phrase E4 held across G4 on a five-fret standard guitar must choose
B-string fret 5 for E4, preserving high E for G4 at fret 3. Taking the initially
cheaper open E would block the second note.

Single-note picking hints alternate down/up by onset index. Chords receive
`simultaneous_pluck_review`; this does not silently arpeggiate the score. These
hints are separate, simple suggestions, not optimized right-hand technique.
Bends, slides, harmonics, thumb fretting, detailed muting, decay, substitution
during a hold, and other physical techniques are outside the model.

## Locks, limits and incomplete results

A lock names one canonical `source_note_id` and at least one of `string`, `fret`,
or `finger`; omitted/null fields stay free. It applies to every repeat occurrence
and the complete sounding tie chain containing that source. Duplicate or unknown
selected source IDs are rejected. Contradictory locks on tied segments produce
an infeasible result. Change/remove locks and submit again to replan; the score
itself is never edited. `requested_locks` echoes the request, including when no
complete plan is available; it does not claim unsuccessful locks were applied.

Version 1 uses `deterministic_guitar_beam_v1`, at most 1,000 sounding occurrences,
16,384 tied-source references, 64 retained states and 2,000,000 candidate-choice
expansions. Responses are limited to 8 MiB without truncating source IDs or
warnings. The output records
`explored_choices`, `beam_pruned`, `objective_cost`, profile and reach setting.

- `ready`: a complete recommendation under the stated model
- `no_targets`: the selected score has no sounding targets; no fingering exists
- `infeasible_under_model`: no position/path satisfies the declared constraints
- `no_plan_found`: retained paths failed after pruning; another path may exist
- `search_limit` or `unavailable`: the bounded planner cannot finish this request

Every incomplete response has `complete:false`, no assignments and a diagnostic
identifying the relevant onset/occurrence or limit. It never presents an initial
fragment as a complete phrase. Listening, source retention, export and existing
assessment remain available according to their own contracts. Changing weights,
finger semantics or search semantics requires a new algorithm identifier.
