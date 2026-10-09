# Two-row background score and complete reader

## Display contract

- The piano background shows the current temporal score row and its next row.
  Following moves one row at a time. The final row retains its preceding row;
  a genuinely one-row score is not duplicated.
- Canonical staff rows come from OSMD's verified `MusicSystems`, including all
  staves of a grand staff, rest measures and source-bound measure fragments.
- Native independently admitted part pages are mounted in temporal row order.
  Each part's row uses OSMD's verified single-horizontal-system mode, so wrapping
  cannot silently turn a row into several skipped systems. Extremely wide rows
  retain readable glyphs and horizontal scrolling, with partial-visibility text.
- Native requests retain their existing per-request limits and identity checks.
  If dense admission reduces a page to one measure, a separate validated adjacent
  measure supplies the preview. At the end, that preview is the previous measure.
  Cue identities are normalized separately for each admitted page; a sustained ID
  does not highlight the wrong temporal copy.
- Basic pitch/Jianpu rows remain explicitly simplified references. Their existing
  32-beat/1,000-note drawing bounds use additional bounded batches, never omitted
  IDs. Unresolved/percussion source limitations remain explicit.
- Seek, repeats and A/B loopbacks select the row from the existing native written
  occurrence. No timing is inferred from scrolling. Paused resize can reflow and
  reveal, but cannot start audio, alter the take, or change source data.

## Responsive behavior

The row measure target is 1 below 600 CSS px, 2 below 1,000 px, and 4 above that.
Actual canonical engraving can use more systems for dense notation. The bounded
source page is retained until a new overlapping page is needed.

Two complete readable rows can exceed the old 100px lane budget. The lane expands
inside the existing vertically scrollable workspace; it is not a fixed panel over
keys or transport. Short Windows/Android landscape screens may require workspace
scrolling to reach the keyboard. The score toggle removes the extra height.
Horizontal overflow remains explicitly pannable; score ink is pointer-inert.
This intentionally replaces the earlier assertion that every score and piano
control must always fit simultaneously without scrolling.

## Complete score

The direct **Complete score / 完整乐谱** button opens an independent modal reader.
It browses all source parts, in bounded sequential windows, without waiting for
playback or following the current playhead. Scrolling near the end loads more;
there is also a keyboard-accessible Load more button. Back/Escape restores focus
and the existing follow preference. Reopening starts a fresh complete traversal.
Source replacement, close and display-mode changes cancel stale work.

All variable-height text and controls are inside the modal scroll surface. Only
its heading/Back control stays outside. This avoids clipping source explanations
or the score on short mobile/landscape screens.

Traversal and rendered coverage are separate: a failed section stays visible,
blocked parts are named, and reaching the source end never turns unsupported
staff content into a successful rendering claim. Canonical MusicXML still has
its existing adapter admission limits (including 512 source measures and 16
source parts). Native basic-key long scores use their native bounded notation API.
No unsupported source is relabeled as faithful notation.

## Validation

- New pure tests cover system/staff identity, fragment mapping, single-system
  admission, consecutive row windows, short/final retention, loop/backward seek,
  pause/resize geometry, long reference rows, cross-page sustained cues, complete
  first/middle/final traversal, every part, source/mode replacement, cancellation,
  modal focus/scroll restoration, unsupported sections and audio admission.
- Real Rust/OSMD browser cases are registered in `engraving-browser.test.js` and
  `full-app-browser.test.js`; screenshots/report include 1280x720, 844x390 and
  390x844 reader layouts. Existing above-keyboard checks use overlapping ranges
  and explicit scroll-flow behavior for short two-row stages.
- No genuine Rust golden fixture was edited. Mocked geometry is not visual proof.
- This executor has no Rust toolchain and cannot launch the required Chromium
  socket. Real browser/native Windows and Android acceptance are still required
  on the frozen source before release or visual acceptance. In particular verify
  dense native all-part rows, independently admitted adjacent pages, held notes,
  modal native-source notices at 480x320/320x568, and real touch/input reachability.
