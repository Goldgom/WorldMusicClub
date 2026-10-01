# Development after the accepted 108 recovery

The [108 recovery snapshot](0.2.0-alpha.1-recovery.md) passed its exact-source Linux/Windows, browser, and native Windows package checks. It contains the 101–107 changes summarized below. Its files and the original 100 milestone remain immutable. Use a package's exact commit and `BUILD-INFO.json` to identify which features it includes.

## New source changes after 108

- Rust assessment adds exclusive timing-grade counts and exact simultaneous-onset completion statistics for a future result HUD. Partial chords remain incomplete; expected score order determines the longest complete-onset sequence. Extras affect accuracy separately, so this coverage statistic must not be called live combo or an error-free streak. Older exports without the fields remain readable as unavailable. This API addition does not change matching, scoring, or canonical music.

These post-108 changes require their own exact-head checks before release. They are not present in the accepted 108 ZIP. The game-like landscape interface is being developed separately.

## Included in accepted 108

- Practice loops compare their boundaries with exact rational beats. A held note ending exactly at B no longer produces a floating-point crossing warning; tied continuations keep their original attack identity.
- Keyboard focus uses contrasting light and dark rings across themes, including multiline editors and the skip link. Unreadable preferences and failed saves have visible recovery/session-only messages, and invalid stored values cannot silently become latency offsets.
- The practice report can expand a per-pitch table with expected, matched, missed and extra attacks, plus timing error and signed early/late averages. Rust calculates these rows from the existing physical onset targets. Missed and extra pitches remain independent observations, small samples are labeled, and older responses without the breakdown remain readable.
- New MXL imports retain the complete original compressed archive and exact selected MusicXML in a versioned source envelope. Source downloads and JSON/library backups preserve their bytes; ancillary files remain archived rather than interpreted. An import that cannot fit the complete copy in the 8 MiB saved-score budget is refused explicitly. Existing XML-only records need the original MXL to gain its missing archive.
- Canonical JSON downloads use compact formatting when indentation alone would exceed the 8 MiB reimport limit. The app explains the formatting change and preserves every field and source string. Already-loaded oversized records remain exportable as full compact copies with an explicit reimport warning; musical and archival data are never stripped to make a file fit.
- Numbered-text export now explicitly recommends canonical JSON or a library backup for a complete archive. Generated MusicXML is musical interchange and does not retain all original source/history data. Deterministic roundtrip tests cover small original polyphonic and numbered-melody fixtures with exact timing and pitch spelling.

Physical MIDI/audio and assistive-technology results remain unverified. Earlier successful runs do not verify later source changes. Release, pedal, fingering and expressive-performance grading remain outside the current onset assessment.
