# Initial MIDI pitch-bend sensitivity

The existing `wmh-semantic-midi1-v1` complete-score profile retains its narrowly
reviewed six-step initialization: RPN 0, pitch-bend sensitivity, 24 semitones and zero cents,
followed by RPN deselection. A separate pre-key-activity twelve-semitone grammar
is now admitted by both strict and typed performance profiles, as specified below.
These setup commands alone imply no active bend or tuning support. The separate
[event-only reference bend policy](REFERENCE_PITCH_BENDS.md) now permits retained
bends after the proved12 setup; strict notation still rejects every bend.

## Musical meaning and source evidence

The MIDI Association's [MIDI 1.0 Control Change table, Table 3a](https://midi.org/midi-1-0-control-change-messages)
defines RPN 0 as pitch-bend sensitivity with semitone and cent components, and the
127/127 selector as the null function that disables subsequent data entry until
another parameter is selected. Its [MIDI messages overview](https://midi.org/about-midi-part-3midi-messages)
describes parameter selection before data entry. These primary references were
checked on 2026-10-03. Sensitivity changes the scale of bend displacement; with
centered bend it does not transpose the note's key.

Each of the following events remains a separate typed command with its original
track/event coordinate and exact zero beat. The shared command kind is
`initial_pitch_bend_sensitivity`, with a channel and one closed `step`:

| Source operation | Named step |
| --- | --- |
| CC101 = 0, select parameter MSB | `select_most_significant_zero` |
| CC100 = 0, select parameter LSB | `select_least_significant_zero` |
| CC6 = 24, sensitivity semitones | `set_semitones24` |
| CC38 = 0, sensitivity cents | `set_cents_zero` |
| CC101 = 127, null selector MSB | `deselect_most_significant` |
| CC100 = 127, null selector LSB | `deselect_least_significant` |

The names encode the reviewed fixed values. There is no raw controller field,
parameter-number cache, opaque data payload, or free numeric sensitivity value.
All six source events count toward complete coverage and survive runtime export.

## Strict boundaries

Both the source importer and complete-score JSON validation require exactly one
complete group per affected channel, all at tick zero, with consecutive source
event coordinates and exact order. Every event on that channel must belong to one
source track. Only instrument programs may precede the group on the channel;
metadata may precede it but may not interrupt it. Groups in different channels
may occur in different tracks. Silent tracks keep their full setup and extent.

Interleaving, missing/repeated steps, any changed value, other parameters, late
setup, a note/control event before setup, split ownership and pitch bends are
rejected. The existing reset/sustain-off profile is unchanged and cannot be mixed
with this setup on the same channel. Unknown ordinary MIDI and VSQ dispatch keep
their prior strict behavior. Canonical notes retain source IDs, exact rational
onsets/durations and key-release targets; no source event is deleted to let the
notation importer pass.

## Reference renderer

The production `CleanSongPlayer` checks the named group and its source/runtime
binding before allocating audio. Each step updates explicit RPN selection or
sensitivity state. The two final selector steps deselect the parameter. The
renderer admits only its centered-bend state and evaluates the unchanged key with
zero displacement at the recorded sensitivity. It does not accept an arbitrary
controller as acknowledged-but-ignored, nor pretend to reproduce a source device.

The original synthetic four-track fixture includes two sounding parts and one
silent setup track, six retained steps per channel, fractional first onsets,
volume/pan, and a silent tail. Regenerate it with
`scripts/generate-clean-song-rpn-fixture.py <clean-song-convert executable>`.
The SMF is authored in memory and is never part of the fixture folder. Tests
cover malformed source/JSON groups, the closed schema, actual production scheduling
with fake audio, resume, practice muting and existing strict/VSQ regressions.
Fake-audio scheduling is not physical audibility, real-browser or native acceptance.
Private input proofs and generated private song folders remain outside the repository.

## Separate twelve-semitone initialization

Both `wmh-semantic-midi1-v1` and `wmh-performance-midi1-v1` support the separate
`initial_pitch_bend_sensitivity12 { channel, step }` command. Its closed steps are
`select_most_significant_zero` (CC101=0), `select_least_significant_zero` (CC100=0),
`set_semitones12` (CC6=12), and `set_cents_zero` (CC38=0). Exactly these three
source-contiguous sequences are reviewed:

- L, M, S, C
- L, M, L, M, S, S, C, C
- M, L, M, L, S, S, C, C

Here L/M are the least/most-significant zero selector steps, S sets12 semitones,
and C sets zero cents. Every duplicate is a separate authored event with its
original track/event coordinate, source event ID where the profile provides one,
and exact rational time. There is no deselection in these sequences: RPN0 stays
selected. No free numeric sensitivity or generic controller escape exists.

A channel has at most one complete reviewed group, on the sole source track that
owns all of its channel activity. Timing is nonnegative and monotone, and the
group must finish before the first key attack, release, or key pressure. Equal
times are allowed only in the original source event order. The setup need not
occur at tick zero; no source-specific tick values are hard-coded. Program,
bank, volume, pan, expression and reverb/chorus setup may precede the group.
Metadata and other-channel commands may occur outside it, but no event may
interrupt its consecutive source coordinates. Incomplete groups, changed values,
unsupported duplicates/order, later data entry, repeated groups, split owners,
interleaved commands fail. All pitch-bend messages (including centered ones)
still fail strict notation. The event-only profile admits them after completed
setup through its separate reference-only bend policy, never before/inside setup.
Reset/sustain initialization cannot be mixed with this group on the same channel;
reset-after-key-activity remains rejected by its existing contract.

The source importer and both authoritative clean-JSON validators apply the same
closed state machine. The strict six-step24 contract above is unchanged, and
that old command still is not part of the typed performance profile.

Both reference receivers initialize their own bend to center, apply every named
step at its exact runtime time, retain the selected RPN0 state and12-semitone,
zero-cent sensitivity, and assert the unchanged key at every attack. Pause/resume
reconstructs the same state. A silent setup track is retained. Nonzero banks
remain blocked by the procedural receiver; sensitivity support does not supply
a missing instrument map or reproduce an external device's prior state/timbre.
Typed success does not create notation or graded practice: strict note pairing,
full source coverage and normal instrument adaptation must independently pass.

Original synthetic tests use all three shapes, distinct routes and silent tracks,
unequal PPQs, arbitrary nonzero setup times, same-time source order, exact runtime
clocks, source/JSON mutations, scheduling, pause/resume and cleanup. They retain
the existing24 regressions. No private source bytes, titles or music enter the
repository or CI. Local tests are not browser, audible-device or native package
acceptance; archive coverage gains require a separate independent source audit.
