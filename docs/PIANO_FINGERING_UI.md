# Piano recommendation UI

The piano controls are advisory. They cannot write the canonical score, influence
practice admission, assess hands/fingers, send hardware commands or change held
input. Rust owns every plan. Ordinary scores use `/api/fingering/piano`; saved
complete songs use the [native package clock bridge](COMPLETE_SONG_FINGERING.md).

## Surfaces and semantics

- Instrument setup contains the two inclusive MIDI hand ranges and maximum reach
  in semitones (0–24). These are chosen constraints, not measurements of a player
  or physical keyboard. Existing keyboard size/range controls remain authoritative.
- An expandable source-note editor lists canonical sounding notes from the
  selected score/part, including written tie segments. Search and progressive
  options expose every source note without attaching thousands of options at once.
  Optional hand and finger locks apply immediately and request a new complete plan.
  Fingers are 1=thumb through 5=little; either field may remain automatic.
- The stage has a collapsed compact guidance strip below the keyboard. Expanding
  it reveals at most eight stable current/upcoming cards and explicit overflow,
  covering current holds plus the next four seconds. Current holds cannot consume
  every card and hide all next attacks. The list is keyboard-scrollable, does not
  announce countdowns live, and retains complete source/occurrence identities in
  accessible descriptions.
- Piano key buttons get pointer-free L/R finger text. These annotations never
  overwrite the expected/held classes, `aria-pressed`, playable name or input
  callbacks. Badges remain advisory even while the same pitch is physically held.
- Model infeasibility is distinct from failure to find a plan within the bounded
  search. Failed plans never display partial assignments. Diagnostic details show
  the exact affected sources, occurrences and targets, plus beam/choice counts.

## Annotation v1 compatibility

Source locks are scoped to the exact loaded canonical score object and selected
part. Any score recompilation, including tempo changes or transposition, or a
selected-part change clears source locks and invalidates the recommendation. The
UI explicitly discloses this session-only policy. Configured hand ranges/reach
remain in the current tab. No annotations are persisted in browser storage,
canonical score/source backups, library entries, or take exports.

Score/timeline replacement, tempo changes, selected part, keyboard profile,
profile-dirty state, hand edits and source locks invalidate immediately. Pending
requests are aborted and late responses are ignored. A complete snapshot is
checked before accepting a response. Integration must continue replacing score
and timeline objects for musical edits, as the existing app does; an optional
context `revision` supports other explicit in-place changes.

## App integration

The application loads `piano-fingering.css` after the existing stage stylesheet
and mounts the advisory controller after the performance shell. Integration:

```js
import {setupPianoFingeringView} from './piano-fingering-view.js';
// In the existing early optional-controller declarations:
let pianoFingering = null;
// After setupPerformanceView (the shell has already moved instrument-settings):
pianoFingering=setupPianoFingeringView({
  document,api,
  getContext:()=>({score:state.score,timeline:state.compiled?.timeline,
    part_id:state.practicePart,profile:currentProfile(),dirty:state.profileDirty}),
  onChange:()=>drawFrame(),openSettings:()=>shell.open('settings'),
});
```

At `drawFrame`, after the score `position`/`segmentStart`/`duration` are known
and before the `shell.screen()!=='stage'` return or guitar early return:

```js
pianoFingering?.render({position,segmentStart,
  segmentEnd:state.loop?.end_ms||duration,running:transport.running,
  hasStarted:transport.hasStarted,completed:transport.completed});
```

Rendering performs deduplicated lazy preparation and handles invalidation even
when the current instrument is guitar. Reentrant change callbacks are supported;
the pending promise is installed before publishing loading status. Existing
`lowest_midi:null` keyboard presets are accepted without changing API shape.

The npm aggregate includes `tests/piano-fingering.test.js` and
`tests/piano-fingering-view.test.js`. Frontend-only app/browser harnesses should return an honest
unavailable advisory response, using `unavailablePianoResult(request,timeline)`
from `tests/piano-fingering-fixtures.js`. Example mock route:

```js
else if(path==='/api/fingering/piano')
  result=unavailablePianoResult(body,compile(body.score).timeline);
```

It retains the selected occurrence count, reports `physical_target_count:null`,
empty targets/assignments, a fixture-specific diagnostic and matching constraints.
It does not fake a solver or affect established compile/admission mock behavior.

## Verification boundary

Node controller/DOM tests cover preset and custom profiles, exact source mapping,
ties/repeats/unisons, status semantics, locks, range drafts, stale/aborted replies,
retry/reentrant preparation, stable cards, finite overflow, held-input separation,
source search, text-only rendering, and compact CSS bounds. These tests do not
certify actual browser layout, physical MIDI, audio, or biomechanical suitability.
No local GUI was launched for this implementation.
