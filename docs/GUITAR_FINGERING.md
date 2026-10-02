# Advisory whole-phrase guitar fingering

`POST /api/fingering/guitar` accepts `{score, part_id, profile, max_fret_span, locks}`.
The full canonical score is compiled by Rust. `part_id:null` plans all parts;
an existing part ID explicitly selects that part. The profile is the existing
`{kind:"guitar", tuning:[40,45,50,55,59,64], frets:12, capo:0}` shape.
`max_fret_span` defaults to 3 and bounds highest minus lowest held fretted position;
0–12 is supported. It is a chosen model constraint, not a measured hand size.
The player automatically requests a complete plan when a guitar score is active.
The default cards and fretboard show the single selected string/fret/left-finger
route. The route is advisory and cannot change practice admission or score data.

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
`InstrumentReport`. The API example above is low-to-high: row 1 is low E (conventionally the sixth
guitar string) and row 6 is high E. The web default is instead high-to-low
`[64,59,55,50,45,40]`, so its row 1 is high E. Both are valid. The player labels
every row with its actual tuning pitch; it does not infer conventional string
numbering from an arbitrary tuning array. `fret` is
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

## Player controls and lifecycle

The guitar stage has a concise live status and expandable **Edit route,
source-note locks & limits** controls. Each current/upcoming occurrence card
includes its selected tuning row, tuning pitch, capo-relative fret and left-hand
finger. The complete chosen route covers the selected part(s), even outside an
A–B playback loop; movement across the artificial loop wrap is not modeled.
Only currently sounding chosen positions highlight on the fretboard. Finger
badges and source identities distinguish recommendations from pitch input.

All pitch-compatible positions are an explicit optional overlay with dashed
outlines, separate from the solid chosen positions. A second independent toggle
shows the right-hand picking heuristics on cards. Neither option enters score,
assessment, canonical timing or the Rust objective. Pressed-input colors indicate
pitch only and cannot establish which string or finger was actually played.

The source-note editor supports partial row, fret and/or finger locks. Its labels
include exact source ID, pitch and part. At most 200 matching options are rendered;
filtering by an exact ID makes any source accessible without dropping score data.
Form fields are drafts until **Apply lock & replan**. Removing one lock, clearing
all locks, or applying a fret span requests a fresh complete plan. Bounds errors
leave the prior applied settings unchanged and are announced explicitly.
Diagnostics show the reported occurrence/source IDs and onset seconds, including
simultaneous or still-held source IDs as review context. A failed bounded search
is never labeled as proof of impossibility, and no failed/partial plan displays
assignments.

Annotation policy version 1 is deliberately **session-only**. Locks and span are
retained only while that exact loaded score object remains current in the tab.
A new import, score load, tempo compilation, semitone copy, or restoration clears
annotations and requests a fresh route. There is no implicit browser persistence
or unversioned import/export; score, library and take exports omit annotations.
Switching parts retains session locks, but only locks naming sources sounding in
the selected part(s) enter that request. Inactive locks are labeled as such.
Profile changes retain locks, invalidate the recommendation and may expose
incompatible old constraints that the player can remove.

The controller scopes every cached response to the exact canonical score and
compiled timeline references, selected part, profile, dirty-setup state and
settings revision. Callers replace score/timeline objects on recompilation; they
must not mutate an accepted compiled score in place. Requests additionally
compare complete snapshots before acceptance. Profile edits hide the route before
application. Pending requests are aborted on invalidation and outdated successes
or failures cannot overwrite newer state. Repeated requests and reentrant loading
callbacks share one promise. Network/validation errors require an explicit retry;
editing constraints is an explicit replan. The browser validates response version,
algorithm, complete occurrence count, source IDs, timing, tuning/capo positions,
requested locks and the empty-assignment contract before displaying guidance.

Node regressions cover controller races, source-lock editing, safe row labeling,
part filtering, status distinctions, tied/repeated/unison identities, optional
views, source search bounds and score immutability. Real Rust/browser acceptance
covers the integrated route and unchanged take/score exports. A mocked browser
server explicitly returns unavailable guidance rather than pretending to solve
fingering in JavaScript.

## Complete live current/next shapes

The live route now separates every current score hold from the complete next
onset group. A compact matrix displays each configured tuning row, the chosen
fret/finger, and explicit Now/Next and Hold/Release/New labels. These are score
instructions, not detected hand positions or measured releases. One through
12 tuning rows remain represented in bands of at most six columns. Detailed
cards and exact source mappings remain available in the tuning/source details;
only additional later attacks are bounded by the lookahead/card budget.

Merged physical targets may contain sources with different release times. Each
recommended source assignment is filtered by its own Rust end time; a longer
unison does not falsely extend another source's fingering. Multiple assignments
at the same displayed position retain their occurrence/source IDs in the marker.
The optional full-board alternatives remain separate from solid current and
dashed next-route cues. Fret-range changes are factual display summaries, not a
new JavaScript ergonomic planner. Picking suggestions remain a limited onset-
parity heuristic; chord technique, rest-aware picking and string changes are not
optimized by that hint.

The original whole-score planning limit and session-only annotation scope still
apply. A dedicated short-phrase planning selection and stronger bounded-search
quality evidence remain open; this live display change does not complete every
guitar requirement.
