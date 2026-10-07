# Automatic note assistance

This document describes the implementation contract. The application wires
checked ownership into Song Mod, scoring, playback, displays and take exports.
Acceptance requires the complete browser and native gates for the exact source;
focused tests alone do not establish release or physical-device acceptance.

## User-facing contract

Song Mod contains **Note assistance** with **Human note assignment** choices:

- **Original · every note in human parts** retains every selected target,
  including infeasible targets, provided the selection does not split a
  cross-scope physical group. Compatibility can still block scored practice.
- **Automatic · keyboard limits** chooses a deterministic subset of the human
  parts under the numeric limits below. It is available for Piano/keyboard only
  and requires at least one selected human part.

**Check assignment** prepares a checked result and displays human-target,
machine-occurrence and source-unit counts. **Apply Mod** commits the checked
assignment with its matching part selection. Checking and applying do not start
transport. **Cancel** discards the draft. **Restore original settings** restores
the Mod defaults and sets assistance to Original; it still needs Apply Mod.

**Turn off note assistance · use full-part practice** is a separate explicit
action. After Apply and any required reset acknowledgement, it returns to the
existing full-part target and audio admission path without requesting a checked
Original plan. This remains usable when a checked Original response exceeds its
size limit. A failed Check never turns assistance off automatically. Source notes,
part selection and the normal instrument compatibility checks are preserved.

The complete song remains the source. In practice, only checked human targets
are scored. Every remaining original occurrence belongs to the machine,
including assistance notes inside a part whose performer is Human. Subject to
the existing playback/mute controls, those notes use that part's saved
**Machine sound**; **Human live sound** remains separate. Machine playback never
counts as input. Ownership, playback mute and display visibility are separate:
hiding or muting a note does not make it a human target or remove it from the
source.

There is a compatibility boundary for existing users: untouched default
Original, with no active checked assignment and no saved assistance recipe,
keeps the existing part-based Mod path. Ordinary part, mix or display edits do
not silently opt into the new checked ownership rules. Choosing Automatic or
pressing Check assignment opts in. Checked Original and restored saved recipes
then use the complete-source validation described below.

**All machine · Listen** is intentional listening with an empty human union.
Checked Original accepts that empty union and retains complete machine
coverage. An assignment or loop with no human targets cannot create a scored
take or a fabricated grade. An infeasible Original assignment also blocks
scored practice; the user can change the assignment or choose Listen.

## Numeric limits and instrument profiles

Automatic uses `algorithm_id: "wmc-keyboard-assistance-v1"`. All numeric values
are integers; invalid values are rejected, never clamped.

| UI label | Field | Default | Accepted range |
| --- | --- | --- | --- |
| Maximum targets at one onset | `max_targets_per_onset` | 2 | 1–32 |
| Minimum onset interval (ms) | `min_onset_interval_ms` | 250 | 0–60,000 |
| Maximum simultaneously held keys | `max_simultaneous_keys` | 3 | 1–32 |
| Maximum held pitch span (semitones) | `max_held_span_semitones` | 7 | 0–127 |

These are explicit constraints, not named difficulty levels or a universal
musical skill scale. The planner examines the existing deterministic target
order (onset, pitch, representative ID), with exact rational gate comparisons
for onset spacing and held notes. Separate rules check instrument range,
target count at an onset, spacing between distinct accepted onsets, distinct
simultaneously held keys, and the total span from lowest to highest held pitch.
A gate ending exactly at the next onset is no longer held. This span is not a
per-hand reach measurement. Basic percussion-selector atoms stay machine-owned
under Automatic.

There is no melody-preservation, maximal-subset, global-optimum, hand/finger,
comfortable-reach or independent-release guarantee. A later conflict rejects
the entire connected source group, including its earlier and future repeats;
the planner does not backtrack to optimize a replacement arrangement. Exclusion
reasons identify the affected source IDs, with codes such as
`instrument_range`, `onset_target_limit`, `onset_density`,
`simultaneous_key_limit`, `held_span_limit`, `percussion_selector` and
`cross_scope_physical_group`.

The checked selection contains `selected_part_ids` and an instrument `profile`.
Part IDs must be unique existing parts, at most 128; Automatic and Explicit
require a nonempty selection. Original also permits an empty selection for
Listen. IDs are normalized into sorted order.

- Piano: `kind: "piano"`, `key_count` from 12–128 and `lowest_midi` as a MIDI
  pitch or `null`. The resulting highest pitch must be at most 127. UI presets
  are 49, 61, 76 and 88 keys; their default lowest pitches are respectively 36,
  36, 28 and 21. The UI also offers a custom range.
- Guitar: `kind: "guitar"`, `tuning` containing 1–12 MIDI pitches in string
  order, `frets` from 0–36, and `capo` from 0 through `frets`. Every open pitch
  plus the physical fret count must stay within MIDI 127. Original and Explicit
  accept this profile and retain its compatibility checks. Automatic returns
  `assistance_automatic_profile` for guitar.

Joint guitar fingering uses the exact selected human-part union through
`selected_part_ids`, with one shared physical instrument. That existing
bounded recommendation does not make Automatic a guitar planner or claim a
global optimum. Current piano/guitar fingering planners cover whole selected
parts: guidance is disabled while ownership is pending or any selected source
unit is machine-owned (`all_selected_human` is false). Basic nominal-key
sources remain ineligible for hand/finger guidance even in Original. Restoring
Original can re-enable guidance only when its other source and profile checks
also pass.

## Complete-source ownership and identity

Rust constructs ownership from a trusted, complete interpretation before any
filtering. Tied segments and every repeated occurrence of a source unit share
an owner. Complete physical target groups connect those units transitively.
For keyboard targets, exact simultaneous same-key occurrences share one
physical attack even across parts, while retaining all source references.

These groups are built from the **full source**, not just selected parts. If a
connected group crosses selected and unselected parts:

- Automatic assigns the entire group to the machine and reports
  `cross_scope_physical_group`
- Checked Original rejects it with `assistance_cross_scope_physical_group`
- Explicit rejects any attempt to assign its selected portion to the human;
  leaving the complete group with the machine is allowed

Explicit also rejects a partial selection of any other connected group with
`assistance_partial_atom`. Including all relevant parts can remove a
cross-scope conflict. Explicit is a checked API mode, not a third choice in the
current Song Mod UI.

The plan format is `wmc-practice-assistance`; `schema_version`,
`planner_revision` and immutable plan `revision` are currently 1. The plan
stores its receipt, normalized selection, mode, optional automatic settings,
`human_source_ids` and `selection_digest`. Checked output includes
`human_targets`, `machine_occurrence_ids`, `source_ownership`, coverage,
exclusion reasons, `all_selected_human` and `scored_mode_allowed`.

Human and machine form a disjoint, complete partition of admitted occurrences
and sounding source units. Source-unit, occurrence and physical-target counts
are intentionally different: ties, repeats and keyboard unisons can change
their relationships. Machine audio filters the already interpreted complete
runtime by occurrence ID; it never plays a deduplicated target timeline. In
particular, Basic note-on/off events are paired by the complete FIFO
interpreter before ownership is applied. Filtering raw note-ons would change
release assignments and is forbidden. Source bytes, pitches, exact clocks,
source/occurrence IDs and existing target representatives remain intact.

The receipt binds source serialization identity, any verified saved-package
SHA-256, source profile, runtime policy, explicit interpretation choice and
runtime digest. The admitted profile/policy pairs are:

| Source profile | Runtime policy | Explicit choice |
| --- | --- | --- |
| `wmc-canonical-score-v1` | `wmc-canonical-practice-v1` | `null` |
| `wmh-basic-keys-midi1-v1` | `wmh-basic-key-rendition-fifo-v1` | `null` |
| `wmh-vsq-clean-v1` | `wmh-vsq-base-note-practice-v1` | `base_notes_instrumental` |
| `wmh-semantic-midi1-v1` | `wmh-semantic-midi1-v1` | `null` |

These are source/API admission capabilities, not blanket UI playback support.
The current Mod commit also requires a renderer with checked machine-audio
support (`audioThread`): canonical, admitted Basic rendition or VSQ practice.
The complete semantic MIDI renderer does not have that capability and rejects
checked assistance, even though its source can be checked through the API.
Its ordinary unassisted Original path remains available under existing rules.

Canonical requests use `/api/practice-assistance/{original,generate,create,validate}`.
Saved native requests use `/api/library/assistance/{original,generate,create,validate}`;
the adapter reloads and verifies saved bytes before constructing a source.
Browser timelines, cached compilations and caller-supplied checked results are
not substitutes for that source. Validation recomputes the result and rejects
stale or altered plans, source/profile/choice mismatches and unsupported
versions. Source limits remain 100,000 units and 100,000 occurrences; automatic
selection is bounded to 5,000,000 work units and checked responses to 16 MiB.
Exceeding a bound returns an error, never a truncated successful plan.

Fingerprints stream the same compact Rust `serde_json` bytes into SHA-256,
stopping at the byte budget without allocating a complete serialization buffer.
Canonical, VSQ and semantic sources, runtime fingerprints and selection plans
retain a 32 MiB serialization budget. Basic's saved compact package is limited
to 16 MiB, but its source fingerprint also includes the complete `performance.notes`
array reconstructed by the validated decoder. Those derived records therefore
have a separate bounded allowance: at most 100,000 records, each at most 1,024
serialized bytes. The Basic fingerprint budget adds only the actual serialized
size of that array and its field delimiter to the 16 MiB compact budget; unused
record allowance cannot hide oversized source metadata. The absolute bound is
16 MiB + 100,000 × 1,025 + 10 bytes, independent of the runtime and response limits.
All source fields and exact runtime gates remain in their original fingerprints.
Serialization domains/revision 1, plan/recipe versions and existing digest values
are unchanged; saved assignments still require strict source and runtime matching.

## Applying, restoring and displaying an assignment

The UI saves a compact `wmc-practice-assistance-recipe` version 1, not a usable
ownership snapshot. It records the source-specific preference key, source,
selection, mode, settings, planner revision, immutable revision and expected
selection digest. Reopening regenerates and admits a fresh result from the
current source. Async results are fenced by the actual source/runtime objects,
selection and request generation; an old result cannot become active after a
source, instrument or part change.

Stage ownership changes restart the session and clear in-memory takes. Changes
involving checked assistance or explicit Off require reset acknowledgement when
a stage has takes or an active/saved assignment; export takes first. Ordinary
untouched Original Mod edits retain their existing warning and Apply flow.
Fallible target and audio preparation happens before the synchronous ownership/Mod
commit. Check or admission failures leave the applied assignment intact.

Incompatible saved preferences remain preserved until the user explicitly
confirms replacement. A preference changed in another window must be reopened
before replacement. Storage failure is reported as tab-only, retaining the
prior stored value; the current app retains that unsaved recipe within the tab.
If storage is unavailable from first use and no assistance preference is known,
Original full-part practice remains available for this tab with a visible
unsaved-preference warning. Known saved, invalid or previously checked assignments
never silently fall back when access or bytes are lost. Explicit checked
assignments still require validation and disclose save failure. Take exports
include a checked plan/receipt and human-target/machine-occurrence identity
snapshot, with per-pass interpretation records, so a later assignment cannot
silently relabel an earlier take.

Explicit Off replaces the recipe at the same source key with a closed four-field
`wmc-practice-assistance-off` version-1 marker: `format`, `version`,
`preference_key` and `source`. It is validated against the current source and
remains distinct from a missing or invalid preference. The expected stored bytes
are compared before the write; this detects observed conflicts but is not a
cross-tab transaction guarantee. A failed or conflicting Off write leaves the
applied Automatic assignment and its takes intact and reports the failure.

Changing the library preference affects the next Start. Resuming an existing
session keeps its pinned assignment, even after library Off or recipe edits. A
new Start uses the new preference and a new matching take. Explicit stage Off
resets that stage only after target/audio preparation and persistence succeed.

**Stage view** offers **Complete ensemble** and **Human parts only**, alongside
**Show machine accompaniment**. Falling notes, Jianpu and individually mapped
basic note groups can hide exact machine groups while preserving their source
and audio ownership. Human and machine roles also have visible shape/stripe
cues. Expected-note and scoring cues follow human targets only.

Native engraved staff notation has a deliberate limitation: individually
proved noteheads may share stems, flags, beams or accidentals with human notes.
When machine display is hidden, this view retains the full source notation
and machine-role cues, and explains that the full staff remains visible to
preserve shared musical strokes. It does not promise isolated machine-note
removal from that shared engraving.

The existing source-specific playback restrictions still apply. This feature
does not certify physical MIDI hardware, original instruments, General MIDI
fidelity, voicebanks or mixer acoustics. It changes ownership of admitted
practice occurrences, not the fidelity or completeness of an import.

## Focused verification

The diagnostic wording is generated into three fixtures through socket-free
Rust integration tests, using API handlers and the native dispatcher directly:

```sh
WMH_UPDATE_ASSISTANCE_FIXTURES=1 cargo test --locked -p practice-server --test practice_assistance_api -p worldmusichub-desktop --test native_assistance
cargo test --locked -p practice-server --test practice_assistance_api -p worldmusichub-desktop --test native_assistance
cargo fmt --all --check
```

For this increment, both runs passed all 3 canonical API and 6 native
dispatcher tests. A structural comparison against the parent source found
only the intended `assistance_scope_limits` diagnostic-message changes:
4 in `assistance-canonical.json`, 3 in `assistance-native-basic.json`, and 4 in
`assistance-native-vsq.json`. Every other JSON value, including source,
receipt, ownership, target and timing identity, was unchanged. No planner
algorithm changed.

See the implementation in
[`automatic_assistance.rs`](../crates/score-core/src/automatic_assistance.rs),
[`practice_source.rs`](../crates/score-core/src/practice_source.rs),
[`practice-assistance.js`](../web/practice-assistance.js),
[`practice-assistance-view.js`](../web/practice-assistance-view.js), and
[`app-assistance.js`](../web/app-assistance.js). Full workspace, browser and
Windows acceptance remain separate checkpoint requirements in `AGENTS.md`.
