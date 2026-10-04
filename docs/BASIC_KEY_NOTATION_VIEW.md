# Source-bound basic-key notation pages

`basic_keys::notation_page(&CompleteBasicKeys, &NotationRequest)` derives a
disposable, bounded canonical `Score` and MusicXML engraving from a validated
complete basic-key package. It does not modify or re-encode the persisted
package. The full source/event sequence and the practice timeline remain the
authorities; a notation page is a display subset, not a new song format.

The request identifies one existing part, a zero-based `first_measure`, and
`measure_count` from 1 to 32 (default 16). An optional `display_meter` is an
explicit layout choice when source meter is unavailable. Optional `position_ms`
asks the core to select the page containing that source-clock position; pages
are aligned to the requested measure count. Source-bound native consumers should
load by the saved package identity and hash, rather than POST an entire large
canonical score to the generic MusicXML endpoint.

## Source meter, key and tempo

Unambiguous source meter supplies exact measure intervals. A meter change within
a bar ends that bar at the exact change; source end truncates the final bar.
This is the established strict MIDI importer's measure-boundary convention.
The page builder skips preceding measures arithmetically instead of allocating
a complete global map, so distant and sparse pages remain bounded.

An absent or ambiguous initial source meter returns `display_meter_required`
with no invented staff or source 4/4 event. The caller can offer an explicit
display meter. Such a choice is labeled `chosen_display_meter` or
`source_with_chosen_initial_meter`; original events and timing remain unchanged.
For a conflicting or unconventional source map, a chosen display meter applies
only to the disposable layout. When source meter is usable, it remains in force.

Valid, unambiguous MIDI key-signature events are projected from the complete
event stream. The active key is carried to a page's start, and interior changes
retain exact offsets. Absent keys stay absent; no C-major event is inserted.
Conflicting or invalid key events remain source data and produce an explicit
diagnostic. Note spelling remains the basic profile's nominal MIDI-key spelling,
not an assertion that original enharmonic notation was recovered.

Source tempo changes keep their exact beat locations and derived BPM values.
When the source clock uses the SMF default before its first tempo, the view's
120 BPM mark is explicitly labeled `smf_default_presentation`. It is not added
to the source package. An ambiguous source clock produces a beat-based paused
view without an invented tempo mark or timeline. Source BPM outside the generic
playback compiler's range can still be engraved without clamping. The excerpt
export path validates display tempo independently from playback capability.

## Exact windows, identities and ties

`source_start` and `source_end` are exact original-source beats. The returned
Score and MusicXML note-map positions are relative to the page start. Printed
measure numbers retain their original one-based labels; returned
`measures[].source_measure_index` remains zero-based and source-global. A
MusicXML segment's own `source_measure_index` is local to the bounded page.

Every engraved note retains its canonical source note ID. A long note crossing
a page boundary is clipped to the exact visible interval and has a
`continuations` record containing its complete original interval. The dedicated
excerpt exporter writes incoming/outgoing ties at window boundaries, including
both ties when a note spans the entire page. These are proven source
continuations, not orphan canonical tie segments or fabricated release times.

Unresolved and instantaneous attacks are listed explicitly beside the page with
stable IDs, key numbers, exact source onsets and release status. They never gain
invented durations or grace notation. Coverage distinguishes source-wide and
selected-part counts, window attacks, and rendered positive keys. Channel-10
parts return `percussion_mapping_required` rather than pitched piano notation.

## Following and bounds

With an available source clock, the response includes `source_start_ms`,
`source_end_ms`, and per-page measure start/end milliseconds. The core evaluates
these from exact rational source-clock segments and converts to floating point
only at the UI boundary. A `position_ms` request uses a floating estimate only
to locate a candidate measure, then resolves its boundaries against exact-rational
clock evaluations. The UI does not reconstruct tempo arithmetic. A paused view
without a source clock has null millisecond fields; requesting timed following
in that state returns a clear error.

Responses contain at most one part, 32 measures and 2,048 relevant key records.
An overly dense page returns `page_limit`, exact counts, and a diagnostic asking
for fewer measures or another part. It returns no silently trimmed Score.
Existing MusicXML byte, rational-division, segment and lane bounds still apply;
unsupported engraving returns `rendering_unavailable` with the exact page and a
diagnostic so the caller can keep the controls available. Unknown source/part
identities and invalid requests remain errors. Empty and out-of-range pages use
`empty_page`. Display measure indices and printed labels retain canonical u32
bounds; larger source event timelines are never truncated to fit a view.

Original tests cover meter changes inside bars, carried and interior key changes,
exact unusual tempo, long-note boundary ties, missing and conflicting metadata,
explicit display choices, zero/unresolved attacks, 41,900-attack source paging,
density limits, and a distant page in a mathematical 8.192-trillion-measure map.


## Native transport and app behavior

`POST /api/library/basic-keys/notation` accepts a small object with `source`
(`key`, `content_sha256`, `profile`) and `settings` (`NotationRequest`). It loads
and validates the immutable saved package and checks both identities before
calling the core page helper. Renderer-supplied scores, timelines and paths are
rejected. The response repeats the binding as `source` and returns `page`.
Existing library transport bounds apply; the page path never reposts the full
canonical score through an ordinary 8 MiB API.

The app's **Open score** action opens a paused inspection view. A package without
a proved clock keeps `compilation: null`; no Timeline is manufactured for the
screen. Playback and assessment remain disabled. Reopening the same saved
identity keeps the paused take. Selecting a different score is an explicit
session navigation, as with the existing Start action.

The staff chooser lists every part and displays one bounded part/page. Missing
or ambiguous source meter requires an explicit display choice; a valid opening
source meter stays authoritative. Source/default tempo and key provenance are
labeled. Separate counts and source-ID lists disclose unresolved/instantaneous
attacks, percussion mapping limitations and page continuations. Page-limit and
rendering-unavailable results keep the controls visible so another part or
smaller page can be selected.

Shared Follow uses `position_ms` only when the current position leaves the
loaded page. The Rust response supplies source-clock measure boundaries;
JavaScript indexes the already-admitted timeline's source IDs for highlights.
It does not interpolate beats from BPM, including during leading silence or a
mid-measure tempo change. Source-global measure indices are translated to the
local page only for glyph mapping. Manual navigation retains the existing
suspend-and-resume Follow behavior. Optional rendering can lag playback; it
never changes the practice clock.

Complete-source MusicXML and single-part `.jianpu` text export remain explicitly
unavailable for this profile. The in-app numbered reference and complete song
pack export remain available. Nominal-key packages also report unsupported
hand/finger recommendations before issuing an API request. These capability
limits do not remove parts, events or supported key-practice targets.


The page adapter verifies each clipped interval against the immutable complete
source before admitting open boundary ties. Only the admitted, frozen page can
supply that context to the ordinary note-map and tie validators; copying a raw
identity object cannot relax their ordinary full-score checks. The pinned
MusicSheetReader is tested against every exact page note, retained XML tie flag,
and source-local clock. Page-edge continuation records remain visible even when
a tie extends beyond the loaded model; internal multi-segment tie membership
still requires the ordinary exact renderer proof.
