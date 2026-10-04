# Notation scope and lane fitting

This is a presentation-only layer. It never changes the source score, audio
parts, mute/solo, accompaniment or the human performance target. A source part
is not a hand assignment. `current` requires an explicitly selected performance
part; an absent/combined target produces `choose_current_part`, never a first-part
fallback. `all` retains the complete part inventory and pages through bounded
groups; the interface shows the number actually rendered, not the requested
number.

## Renderer integration

`stage-notation-layout.js` owns the reusable controls and fitting. Renderers send
the following event on `#workspace` after a source, selected target, view page or
actual renderer result changes:

```js
stage.dispatchEvent(new CustomEvent('notationscopecontext', {detail: {
  parts,                       // complete source [{id, name}] inventory
  scope: 'current',             // 'current' | 'all' | 'part'
  practicePartId, selectedPartId,
  renderedPartIds,              // actual mounted notation/selector parts
  page, totalPages,             // one-based written page and page count
  firstPart: 0, maxParts: 4,     // part batch position, independent of music page
  status: 'ready'               // or partial/page_limit/pending/etc.
}}));
```

User changes emit `notationscopechange` with `{scope,partId,partIds,
selectedPartId,firstPart,status,totalParts}`. The app owns the requested display
scope independently of its performance target. User part-page navigation may
suspend notation following; an automatic update of a current performance part
must not silently switch back to `all` or a different source part.

`loadNotationPartBatch` takes the resolved source `partIds`, `firstPart`,
`maxParts` (default 4), `measureCount`, `maxTargets` (at most 2,048), a cancellation
signal and `requestPage(partId,{measureCount,signal})`. `requestPage` must return a
page already validated against its own saved source, policy and exact part ID.
The caller must preserve the common written source/position anchor across
retries. The result retains every individual page and its identity. Do not
fabricate a combined native page, score identity or tie authorization.

If the total record budget is exceeded, the helper retries all parts with half
the measure count. At one measure it returns `page_limit` and no accepted paint
pages. It never slices or drops records. The result includes both requested and
effective measure counts and exact part-page metadata. `onset_page` and
`percussion_selectors` are usable v2 views; `rendering_unavailable` is an explicit
partial format limitation, even when its complete fallback rail is visible.

## Fitting and scrolling

The measured paint may shrink to 75%, while respecting a minimum 18px Jianpu
font or 7px actual staff notehead. Smaller original glyphs may be enlarged.
Excess width/height is kept in the bounded lane's real scrollable containers.
The existing score arrow buttons pan these containers without making the paint
intercept piano input. The options popover is bounded to the lane height so it
cannot extend over the keyboard.

Scaling affects only paint children; responsive engraving's unscaled containing
width, mounted identities and following coordinates remain intact. Changes to
paint, lane geometry, browser zoom and viewport dimensions request fresh fitting
and invalidate cached following geometry. `#basic-rendition-events`, when present,
is moved into the lane with the original node/listeners and restored on guitar
view or teardown. Its height is reserved; its rows remain scrollable independently
of a closed score-options disclosure.

## Verification status and hosted evidence

The Node tests use a newly authored 12-part exercise to reproduce the prior
height clipping and check geometry policy, explicit scope, every part's
reachability, global record bounds, cancellation and source immutability. These
tests do not establish browser layout acceptance.

The screenshot driver is `scripts/hosted-notation-scope-check.mjs`. It refuses to
launch unless `GITHUB_ACTIONS=true`, `WMH_HOSTED_BROWSER=1`, and
`WMH_SOURCE_SHA` equals the exact checkout SHA. A prepared Rust practice-server
and pinned engraving assets are required. It writes `report.json`, `server.log`
and screenshots to `WMH_ARTIFACT_DIR` (default `test-results/notation-scope`).
`WMH_NOTATION_BASELINE=1` records the original clipping path with the same
original fixture; it is reproduction, not acceptance.

The final-mode driver checks actual staff/Jianpu paint, first and last part
pages, scroll access, selected/current part changes, browser zoom, 720/900/1080
landscape heights, a held note following through a one-bar page boundary and
unobstructed keyboard hit-testing. It requires the renderer integration above.
Additional native-v2 acceptance must exercise the real source-bound multi-part
pages, including selectors, unresolved/onset records and mute/solo independence.
No screenshot run has been performed locally. Do not call this UI accepted until
the hosted report passes and its actual screenshots have been inspected.
