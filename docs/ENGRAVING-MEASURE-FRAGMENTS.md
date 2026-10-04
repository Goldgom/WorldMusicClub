# Exact internal-key presentation fragments

The production adapter admits the noncrossing class only for a fully validated
version-2 native rendition page. Ordinary imported/caller-made identity objects
keep the conservative fallback. The private native-admission record and the
pre-parser projection inventory both bind the same original source Document and
immutable score/identity snapshots. Graphical acceptance remains distinct from
reader/model proof; do not claim pixel acceptance from Node tests alone.

## Admitted scope

Admit only internal key changes for which no canonical written note or rest
crosses a cut. The boundary must match a canonical key event exactly. Divisions
remain on a positive integer grid at most 2,048; all existing document, note,
element and depth budgets remain in force. A changed meter/clef/grid inside a
measure, numbered/staff-specific keys, missing canonical key events, unsupported
cursor positions and excess fragments are refused. No source-specific names or
positions are part of admission.

For this class, every original XML note ID, canonical source-note ID, note
duration, pitch and original tie flag remains one-to-one. Only the note's local
position inside a disposable display fragment changes. No canonical measures or
notes are created, rewritten or renumbered. Generated silence is nonprinting and
has no source identity.

`createEngravingMeasureFragments` returns a distinct
`source-bound-measure-fragments-v1` contract. `sourceMeasureIndices` still lists
original loaded source measures once each. `measureFragments` is a separate
ordered model table with these fields:

- `fragment_index`: ordinal in this disposable renderer input
- `source_measure_index` and `source_measure_number`: original identities
- `source_offset`, `at` and `length`: exact rational quarter beats
- `starts_source_measure`, `ends_source_measure` and `displayed`: provenance and draw scope
- `suppress_measure_number`: original pickup or a presentation continuation

For example, source measure 7 covering quarter beats `[0, 4)` with a key change
at 2 becomes two presentation intervals `[0, 2)` and `[2, 4)`. Both retain source
measure 7; the second has `source_offset = 2`. Its key instruction is at local
time 0 of that second interval, which is still exact source time 2. An internal
boundary receives `bar-style = none`; it is not presented as a new musical bar.
The canonical score continues to contain one source measure.

`noteFragments` records the exact note-to-source relation. In the default
noncrossing class, `xml_note_id === source_xml_note_id`, each source segment has
exactly one record, and its original note element is retained. Model matching
uses `fragment_at`; source matching uses `source_measure_at`, equal to
`source_offset + fragment_at`. This offset addition is exact rational arithmetic,
not a geometric or nearest-note lookup.

## Model evidence and integration boundary

`validateEngravingMeasureFragments` independently checks the complete real OSMD
model before layout: every fragment duration and absolute timestamp, source
label, implicit-XML flag, internal `none` barline, effective key on every staff,
every pitched/rest tuple including generated padding, exact note cardinality and
ordered real `NoteTie` membership. It checks complete canonical key-event
coverage against XML and keeps private immutable source/document snapshots.
Changed source data, keys, clocks, note positions, projection IDs, missing ties
and fabricated projection objects are refused. Integer-only rational checks
remain mandatory; the model proof does not accept a float approximation.

The production integration uses three explicit boundaries:

1. `engraving.js`: choose the fragment constructor only for an eligible internal
   key failure and a successful private native-admission check, run the shared
   immutable inventory/strict clock proof and the fragment key proof, and draw the requested
   fragment index range. Keep public source-measure metadata in original source
   coordinates. Expose a distinct model-fragment table/count if diagnostics need
   it; a model count is not a source measure count. Existing raw projection
   fallback remains available when any fragment proof fails.
2. `matchEngravingModel`: resolve model SourceMeasure objects through
   `measureFragments[localIndex].source_measure_index` and add the associated
   exact `source_offset` to model note onset before constructing the existing
   source tuple. The original segment table, source-note ID selectors, unique
   glyph binding, and original tie-chain IDs can remain intact for the default
   noncrossing class. Do not reinterpret `sourceMeasureIndices` as fragment
   ordinals silently. `engravingProjectionModelCoordinates` exposes exact
   coordinates only for an unchanged private projection capability. Source-aware
   tie validation uses this same matcher.
3. Before graphical layout, apply the source-label policy. The pinned reader
   otherwise classifies a short first fragment as a pickup and can suppress its
   original label. `prepareEngravingFragmentLabels` first runs the complete model
   proof, then enables original XML numbers and marks only genuine source
   pickups and continuation fragments as implicit for layout. It changes no
   duration, timestamp, original XML label or note. This policy still needs real
   graphical acceptance.

Application playback and `engraved-view.js` remain unchanged. Public source
measure range/count metadata stays in original coordinates;
`metadata.modelMeasureFragments` separately exposes model-fragment coordinates.
The source-current-note selector continues to use original segment IDs and source
measure ordinals.

The existing source-bound incoming-page tie repair runs through the production
matcher. A page needing both that repair and fragmentation needs an explicit
ordering contract: first prove notes/keys/clocks, then restore only admitted page
ties, then verify complete ties before layout. The adapter verifies the final fragment keys and labels only after source-bound
tie reconstruction and strict tie membership checks. Fragment clocks use the same
private exact inventory and pinned denominator-expansion recovery as ordinary
projections. No guard is skipped.

## Sustained-note boundary

The production constructor returns an explicit fallback when a complete canonical
pitched interval crosses a key cut, even if an existing written split happens to
meet that cut. It also refuses any written note/rest segment that would need
splitting. There is no production option to enable source-note splitting. All
retained source note elements keep their original contents and chord order.

An earlier isolated prototype demonstrated exact tied pieces for a sustained
original note. Enabling that broader class would require one source segment to
own multiple independently verified model/glyph pieces while one active canonical
note selects all applicable pieces. That larger mapping change is outside this
production path.

## Original regressions and hosted acceptance

Run `node --test tests/engraving-measure-fragments.test.js`. The original
two-part/two-staff fixture contains an F before an exact key change, an F-sharp
after it, and a later source measure. It tests 7/4 and 2-quarter positions,
selected parts and source pages, duplicate printed labels, original note-element
preservation, exact source offsets and all-staff key state. A separate original
held C crosses the cut and is refused; a second negative case has already-written
tied pieces meeting that cut and is still refused by the full canonical interval. Negative cases
cover wrong/missing keys, altered clocks/onsets, changed source and
projection IDs, forged objects, and budgets.

The original native fixture is generated by
`scripts/generate-internal-key-fixture.py` using a socket-free native driver and
a disposable temporary library. It records the driver source SHA and binary
SHA-256. Its noncrossing case has G-major, D-major and B-flat-major signatures,
with four isolated authored notes and changes at exact 1 and 7/4-quarter offsets.
Its held-note case exercises refusal. No private music is included.

The scene in `tests/engraving-browser.test.js` must pass on the authorized hosted
runner. It verifies:

- Old and new key-signature glyphs belong at the two exact fragment positions,
  with the before/after notes retaining their canonical written pitches
- No internal visible barline or extra source-measure number is drawn; the
  original source number remains available once at the original bar start
- Every original source-note ID still owns exactly one visible indexed glyph,
  including current-note highlighting before/after the key
- Following into and out of the original measure, selected-part views, page
  boundaries, resize and theme rebuild preserve those identities and labels
- Source JSON/XML and playback clocks remain unchanged

Only Node stdio/pinned-reader checks and socket-free original native fixture
capture were performed during implementation. No local browser, server or
graphical renderer was launched. The authored hosted SVG scene is not evidence of
a passing hosted run; record exact-source hosted results separately.
