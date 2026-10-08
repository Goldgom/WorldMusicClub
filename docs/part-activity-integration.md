# Reconstructed machine activity integration

This source was reconstructed after the local executor/filesystem was replaced. It is based on public677 commit315db983a3114c6fd5432a6dd3070c1807be7f73. It is not byte-identical recovery of unpublished prior commits; old test reports do not accept this source.

Canonical, Basic MIDI and VSQ renderer admission captures immutable source-bound occurrence gates. Canonical mapping follows occurrence indexes, not filtered row indexes. Human ownership and checked assistance govern which gates are machine-owned; no physical-key deduplication, instrument guessing, metadata fetching, scoring or eligibility changes occur. Per-frame calls reuse admitted snapshots with cheap identity/ownership checks. The display model uses sorted interval endpoints and half-open occupancy.

The stage reuses the existing final playbackPosition sample and captured canonical clock. Loop/take ordering, legacy clock reads and human-view clocks remain unchanged; activity adds no source-clock reads. The view owns no timers.

Paused/ended display is explicitly retired, not a valid current live receipt. Before intentional pause or completion cleanup, the stage may retain the admitted immutable snapshot. It can display only paused/ended with zero active gates, and only when source/runtime/ownership and app Mod/selection/pitch/generation still match, no renderer is running/preparing and no plan is active. Source selection, preparation and renderer error invalidate retirement revisions. Reset, canceled start, failure, a changed UI binding, another playback renderer or offstage transition clears the stage cache. Generic live plan/epoch guards remain unchanged and cannot use retired evidence to report playing.

Layout owns one explicit56px flow host after transport and outside human HUD/instrument surfaces. Piano viewport calculation includes its bottom edge. It is visible above1000px width and650px height, including1280×720 and1920×1080. It collapses at844×390,390×844 and960×640. No rendered geometry acceptance is claimed: existing key/notation/transport geometry and real browser/native measurements remain mandatory.

New reconstruction tests must be registered in the explicit pure inventory. Full Rust/browser/native/Windows acceptance has not run for this source. No publication is authorized.
