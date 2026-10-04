# Complete rendition notation and following

The v2 basic-key player, selected human targets, staff view, numbered view, and target markers use the same admitted compilation IDs and native rendition policy. Source-only inspection remains an explicit separate choice. Original source and canonical package bytes are retained unchanged.

## Scope and real rendered parts

The stage receives `notationscopecontext` and emits `notationscopechange` through the scope controls. Current follows the selected human part; All is a collection of bounded part pages, with at most four parts mounted at once. A new Practice score with a human part defaults to Current; a new Listen score defaults to All. An explicit display choice survives a mode change and never changes the human target or output mute/solo.

Basic-key parts each retain their own admitted page, MusicXML, identity, note map and boundary-tie authorization. The UI stacks independent renderer instances instead of synthesizing a combined score. Each renderer receives only its own target IDs. The displayed cursor is the union of the independently validated pages at the common native time. Percussion remains a non-pitched selector marker. Synthetic gates are labeled onset markers. A native page that has no written intervals skips pitched engraving and retains its native measure clock, so leading silence does not stop automatic following.

Ordinary canonical scores use the same scope inventory and four-part collection in both staff and numbered views. Part-page controls make every source part reachable.

## Bounded prefetch and late results

Only the current native batch and one next native batch are retained. As soon as the current batch is admitted and mounted, the next batch begins loading. Its first measure comes from Rust's `next_measure`; the browser does not reconstruct a tempo clock. The earliest available prefetch gives slow native exports the full current-page time window, rather than waiting for a fixed sub-second threshold. Native batch elapsed time is exposed for hosted latency measurement.

The key includes source identity, runtime and rendition policy, requested scope/parts, part-page position, native first measure, effective bounded measure count, display meter, position query and source-only choice. Source, scope, meter, display policy and hidden-surface changes abort obsolete work. A response that completes after playback has passed its window is rejected as current and replaced with a native position request. Current paint stays visible while waiting, but stale active IDs and cursor labels are cleared. An explicit pending status remains visible until a matching page arrives. There is no claim that every native export can finish before every boundary.

Leaving for Free cancels the speculative batch and clears visible scope status. Returning restores the accepted view or loads it again without starting playback. Free input and recordings retain their separate ownership.

## Read-only acceptance selectors

- `#workspace.dataset.notationScope`: current, all, or part
- `#workspace.dataset.renderedNotationParts`: JSON array of mounted source part IDs
- `#workspace.dataset.notationRenderStatus`: pending, ready, partial, hidden, error, or explicit choice/limit state
- `#workspace.dataset.notationLoadMs`: measured native batch request time
- `#workspace.dataset.notationPrefetch`: none, pending, or ready
- `#engraved-staff .notation-part-render[data-notation-part-id]`: independently admitted native staff/marker part mounts
- `#notation section[data-notation-part-id]`: native numbered part mounts
- `#basic-rendition-events-list [data-note-id][data-part-id][data-role][data-display-kind]`: explicit interpreted markers; active rows have `.active` and `aria-current="true"`
- `#written-cursor-status.dataset.sourceNoteIds`: JSON union of current IDs from the displayed native collection

## Regression fixtures

The added late-initial-meter and quiet-window JSON fixtures contain original authored MIDI hex, the pinned native driver hash, saved native open response, and actual notation request/response pairs. The late meter is at beat 1/48; the initial display grid is explicitly 4/4 while a user's later Source choice remains respected. The quiet fixture is 43 bytes, has eight silent measures, and one C4 at the ninth measure. Neither fixture contains imported private music.

The multi-part and prefetch tests use Node DOM/audio stubs and actual native fixture responses. Hosted graphical fit, scroll, SVG and real Web Audio acceptance remain separate checks. This increment depends on the helper scope/fit commit and the final compact v2 native fixtures already integrated by the parent.
