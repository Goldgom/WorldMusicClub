# Keyboard assistance presets

Preset catalog revision 1 provides reusable numeric configurations for the
existing `wmc-keyboard-assistance-v1` planner. These are density and held-span
settings for explicitly chosen keyboard/Piano parts. They are not universal
musical difficulty grades, authored arrangements, hand assignments, fingering
advice, or proof that a passage is comfortable to play.

## Exact settings

Every preset includes `algorithm_id: "wmc-keyboard-assistance-v1"` and these
four integer settings:

| Stable ID | Targets per onset (`max_targets_per_onset`) | Minimum onset interval, ms (`min_onset_interval_ms`) | Simultaneous keys (`max_simultaneous_keys`) | Held span, semitones (`max_held_span_semitones`) |
| --- | ---: | ---: | ---: | ---: |
| `single` | 1 | 500 | 1 | 0 |
| `balanced` | 2 | 250 | 3 | 7 |
| `dense` | 4 | 125 | 6 | 12 |

- **Single** requests at most one target per onset and one held key at a time,
  with a 500 ms minimum between distinct retained onsets. A single held key has
  zero pitch span. Successive notes can still jump widely.
- **Balanced** exactly preserves the existing automatic default: two targets at
  an onset, 250 ms spacing, three simultaneous keys and a seven-semitone held
  span. It does not change the application's default Original mode.
- **Dense** permits four targets at an onset, 125 ms spacing, six simultaneous
  keys and a twelve-semitone held span. These settings provide a concrete option
  for more density; they do not guarantee more retained targets for every song.

The target/key limits are maxima, not quotas. Minimum onset spacing is measured
in milliseconds against the trusted source clock, not score beats or a skill
rating. Held span applies across simultaneously held selected pitches, not the
distance between successive non-overlapping notes. Rust still owns exact source
interpretation, atomic ownership, note selection and receipt generation.

Loosening these limits does **not** promise that the resulting human targets
contain the targets from another preset. Retaining an additional earlier note
can change which later notes meet spacing or held-key constraints. Ties, repeat
occurrences and grouped source units also retain their existing atomic ownership
rules. Each result must be prepared and checked independently for the actual
source, selected parts and instrument profile.

## JavaScript API

The existing `web/practice-assistance-receipt.js` exports:

- `ASSISTANCE_PRESET_REVISION = 1`: the numeric catalog's revision, separate from
  plan schema, planner revision and saved recipe versions
- `assistancePresets()`: fresh array of fresh `{id, settings}` objects in the
  stable order `single`, `balanced`, `dense`
- `assistancePresetSettings(id)`: fresh settings for an exact supported ID;
  unknown IDs, including `custom`, throw `TypeError` with
  `code: "practice_assistance_invalid"`
- `assistancePresetId(settings)`: exact structural match to a complete current
  preset, or `"custom"`; field order does not matter, but field names, numeric
  types, algorithm ID and values must match

Matching is descriptive. It never rounds, clamps, fills missing values, changes
settings, applies a draft, issues a request or writes storage. Incomplete or
invalid numeric edits return `custom`; this is not validation approval. Existing
`validateAssistanceSettings` and native preparation still reject invalid input.
`Custom` is a derived label, not another preset or a saved selection.

Every returned settings object is independent and editable. Changing a returned
array, entry or settings object cannot alter the catalog, later callers, or the
automatic defaults. Localized display labels belong to the existing view's
locale data, separate from stable IDs and numeric settings.

## Compatibility and explicit application

Default Original, assistance Off, custom numeric editing and the existing
prepare/reset/Apply/Cancel workflow keep their current meaning. Selecting a
configuration only supplies numeric values to the explicit draft. Application
still requires the existing checked plan and explicit reset confirmation.
Opening controls or recognizing a matching saved configuration does not apply a
preset. Automatic guitar assistance remains unsupported.

Existing saved recipes continue to carry their exact numeric settings. No
`preset_id` or `preset_revision` is added to requests, checked plans or recipes;
the current closed schemas continue to reject unsupported extra fields. A saved
recipe that happens to match Balanced can display that label without changing
its bytes, source binding, selection digest, planner revision or restore path.
Other valid numeric recipes display Custom and remain usable unchanged.

The catalog revision documents these specific numeric choices. A future catalog
change must be deliberate and revisioned; it must not reinterpret or silently
migrate existing numeric recipes. Unknown recipe/planner versions remain blocked
and preserved even if their settings happen to match a current preset.

## Verification

Run `node --test tests/practice-assistance-presets.test.js` for the pure catalog
and compatibility checks. They pin revision 1 settings, verify defensive copies,
exercise exact matching and invalid/custom input, preserve default Original,
and restore prior numeric recipes without writes or weakening version fences.
Synthetic receipt fixtures verify the JavaScript persistence contract; they do
not certify musical selection. Actual selection remains a Rust planner concern.
Browser and packaged native acceptance remain separate checkpoint requirements.
