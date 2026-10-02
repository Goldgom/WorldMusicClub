# Numbered pitch-guide layout

The reported Pianoforte / fixed-C screenshot (page 5/7, measures 9–10) showed
multiple digits, accidentals, octave dots, underlines and active-note colors at
the same coordinates. The old renderer used one baseline per part and mapped
every event at the same onset to the same x coordinate. It also reserved no
width for accidentals, duration dashes or closely spaced onsets.

The original score behind that screenshot is not available for an exact
reproduction. The regression exercises are original test data that cover the
observed collision mechanism; they are not a transcription of the screenshot.

## Layout contract

- The displayed part is unchanged by default. `partId` selects one literal
  source ID; `allParts: true` explicitly displays every part. A source part
  called `all` does not have special meaning.
- Part / source staff / source voice define separate labeled lanes. Lane names
  are source strings, including different names such as `1` and `01`.
- Exact rational onset equality defines a shared horizontal column. Equivalent
  fractions share a column, while close but distinct fractions do not merge.
- Simultaneous notes within a lane stack by descending pitch, followed by rests.
  Equal-pitch source events remain separately addressable. Chord rows use common
  baselines across the page, with room for every row's octave and rhythm marks.
- Adjacent columns reserve the complete digit, accidental and rhythm footprint
  plus a gap. Nominal beat spacing is a minimum; the result is not a linear time
  axis. Dense pages expand horizontally instead of shrinking the 25px digits.
- Accidentals occupy their own field to the left of the digit. Octave dots are
  vertical and go beyond any rhythm underlines; valid high/low pitches are not
  truncated to four dots.
- Integer durations through seven quarter notes use duration dashes. Binary
  subdivisions through 1/64 quarter note support up to three augmentation dots.
  Other durations use an explicit `[numerator/denominator q]` label. Every event
  retains its original rational onset/duration in attributes and a tooltip.
- `data-note-id` and `.score-note` remain the current-note highlighting contract.
  Highlighting multiple source events does not combine their glyphs or IDs.
- Pages still contain onsets in the half-open requested beat window. Notes
  starting on previous pages are not duplicated as invented new events. Page
  count now includes declared measure ends, so trailing empty measures remain
  reachable, including wholly silent declared pages.
- The existing first-1,000-events-per-displayed-part/page limit remains explicit.
  The warning wraps on narrow pages; the complete canonical score is unchanged.
- An optional `i18n` renderer option supplies text-only translations. All
  translated text and interpolated source strings pass through XML escaping.
  Omitting it preserves the existing English fallback behavior.

This remains a numbered pitch guide, not a complete engraving engine. It does
not claim universal readability for every score, engrave every tie/tuplet/phrase,
or reproduce the original source page. Display geometry never replaces Rust's
playback/scoring clock or rewrites canonical events. The simplified staff SVG
geometry is unchanged; only its explicit all-parts selection and display page
extent have been extended.

## Verification

`tests/frontend-numbered-layout.test.js` checks disjoint geometry budgets and
rendered SVG identity/markup using the headless DOM. It covers original dense
polyphony at mobile/tablet/desktop widths, separate voices and staffs, chords,
same-pitch unisons, equivalent and nearby onsets, mixed durations, rests,
accidentals, high/low octaves, page boundaries, silent measures, part selection,
current-note class updates, escaping, wrapping and the disclosed source cap.
Existing staff SVG fixtures also have byte-for-byte regression baselines.

`tests/numbered-layout-fixtures.js` exports `densePianoforte()` for hosted browser
tests. It produces a fresh canonical original score with 193 written events
(192 pitched events and one rest), and no extra package dependencies.

Actual browser font bounds, screenshot review, scroll behavior, dark/light
themes and integrated playback highlighting need hosted browser verification.
The DOM/math tests alone are not evidence that those visual checks passed.
Local GUI/browser launch was not used for this work.

## Integrated following and scope

All notation views share one explicit Follow playback preference, on initially.
Manual paging, part browsing or intentional notation scrolling pauses following
until the player resumes it. Hiding/reopening the score and switching display
modes preserve that choice and do not change the playback clock. The shared
validated Rust navigation response drives written-measure pages through rests
and repeats; the exact written cursor independently reports availability.

For a written measure longer than a basic page, the latest already-started
written span anchors the page even after its note ends. Sparse implicit gaps stay
on the last written event rather than pretending continuous beat interpolation.
All-parts or a single displayed part is separate from practice/scoring targets.
Dense simultaneous groups may exceed the available pane; the UI reports partial
visibility and preserves scrolling rather than shrinking or discarding events.
