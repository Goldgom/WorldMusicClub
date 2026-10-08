# Source development and accepted snapshots

## Android development build

Android now has a standalone offline WebView client, Rust JNI transport, private
native-library storage, system file dialogs, a local APK compiler and a manual
CI artifact workflow. ARM64 and x86_64 debug packages retain source identity and
dependency/music notices. See [Android setup and limits](../ANDROID.md).
These packages remain development builds until the exact source completes all
required acceptance gates; no accepted Windows snapshot is changed.

## Project rename

Current source is branded WorldMusicClub and hosted at [Goldgom/WorldMusicClub](https://github.com/Goldgom/WorldMusicClub). New browser/native portable packages, window titles and usage instructions use the new name. Existing storage, musical format identifiers, canonical producer metadata and historical release evidence retain their original identities; see [name compatibility](../BRAND_COMPATIBILITY.md). This rename does not accept or republish any historical Windows binary.

## After accepted 155

The [155 recovery](0.2.0-alpha.1-commit-155.md) passed exact-source acceptance.
The following source changes require their own hosted browser and native Windows
checks and are not in its ZIP:

- Free practice works independently of score availability, with optional live
  sound, explicit Start/Pause/Stop, immutable local saves, backups, imports and
  descriptive A/B records. Preview uses bounded fixed-length synthesized tones;
  it does not reconstruct the original performance audio or grade improvement.
- Four physical PC keyboard rows cover 47 chromatic notes by default. Settings
  support custom mappings and octave/semitone performance-input shifts. Mapping
  changes release old contacts and retain full configuration history without
  transposing the score. Hardware rollover remains a keyboard limitation.
- The shared display preference defaults to Chinese and offers English. Owned
  shell, settings, input, free-practice, results and source-library views redraw
  without changing musical state. [Remaining runtime localization](../I18N.md)
  is explicit; this is not yet an application-wide single-language claim.
- Guitar phrase planning can select an explicit exact written-beat range before
  solver budgets. Rust includes entering holds and full tails, inventories selected
  occurrences, and replans with only applicable retained locks. Repeated-score
  phrase selection is explicitly refused. This remains a bounded recommendation,
  not a claim of universal physical optimality or completed right-hand guidance.
- Delayed MIDI evidence is kept separate from newer live sound ownership. Unknown
  timing after route changes is retained in a separately exportable, bounded
  unassigned journal, never guessed into a newer performance.

## Historical changes after accepted 108

The [108 recovery snapshot](0.2.0-alpha.1-recovery.md) passed its exact-source Linux/Windows, browser, and native Windows package checks. It contains the 101–107 changes summarized below. Its files and the original 100 milestone remain immutable. Use a package's exact commit and `BUILD-INFO.json` to identify which features it includes.

## New source changes after 108

- Rust assessment adds exclusive timing-grade counts and exact simultaneous-onset completion statistics for a future result HUD. Partial chords remain incomplete; expected score order determines the longest complete-onset sequence. Extras affect accuracy separately, so this coverage statistic must not be called live combo or an error-free streak. Older exports without the fields remain readable as unavailable. This API addition does not change matching, scoring, or canonical music.
- A separate song lobby filters the bundled catalog and prepares a candidate without replacing the active score or recorded take. Listen/Practice explicitly activate it, with Rust compatibility checks and visible blocking range reasons. Selected score identity and Start controls stay anchored while detailed notices scroll.
- The landscape stage gives the falling notes and full configured keyboard the main area. Settings, imports, source files, results and saved scores open secondary panels. Returning to the lobby or opening a panel pauses playback; closing or resuming the view never starts audio automatically.
- The optional notation dock keeps professional engraving, pitch guide, jianpu, part/page controls and Rust measure following. Compact headers remove repeated display headings without changing musical data or exports. Short landscape windows place optional display controls in Help so the staff has visible space.
- The HUD distinguishes captured inputs from checked onset matching. It suppresses stale rates during playback, changed input revisions and delayed-input grace periods. Previous results remain labeled and do not claim sustain, release, perfect timing or live-combo evaluation.
- Results now shows the selected take's Rust grade counts and complete/longest expected-onset-group coverage with bilingual labels and checked/current revisions. Partial chords remain incomplete; extras affect accuracy separately. Stale, missing and no-target counters are explicitly unavailable, and existing boundary/clock-gap warnings remain. Node tests and registered real-Rust browser cases cover delayed corrections, legacy responses and responsive/theme behavior; hosted results must be checked for this exact source.
- Browser verification covers light/dark desktop scenes, narrow landscape and portrait layouts, modal/focus behavior, complete source export and preservation of paused takes. The suites report independently so one failure no longer hides the other browser results.

These post-108 changes require their own exact-head checks before release. They are not present in the accepted 108 ZIP. See the [interface behavior and validation boundaries](../GAME_UI.md) and [Chinese quickstart](../QUICKSTART.zh-CN.md) for the source tree's current navigation.

## Included in accepted 108

- Practice loops compare their boundaries with exact rational beats. A held note ending exactly at B no longer produces a floating-point crossing warning; tied continuations keep their original attack identity.
- Keyboard focus uses contrasting light and dark rings across themes, including multiline editors and the skip link. Unreadable preferences and failed saves have visible recovery/session-only messages, and invalid stored values cannot silently become latency offsets.
- The practice report can expand a per-pitch table with expected, matched, missed and extra attacks, plus timing error and signed early/late averages. Rust calculates these rows from the existing physical onset targets. Missed and extra pitches remain independent observations, small samples are labeled, and older responses without the breakdown remain readable.
- New MXL imports retain the complete original compressed archive and exact selected MusicXML in a versioned source envelope. Source downloads and JSON/library backups preserve their bytes; ancillary files remain archived rather than interpreted. An import that cannot fit the complete copy in the 8 MiB saved-score budget is refused explicitly. Existing XML-only records need the original MXL to gain its missing archive.
- Canonical JSON downloads use compact formatting when indentation alone would exceed the 8 MiB reimport limit. The app explains the formatting change and preserves every field and source string. Already-loaded oversized records remain exportable as full compact copies with an explicit reimport warning; musical and archival data are never stripped to make a file fit.
- Numbered-text export now explicitly recommends canonical JSON or a library backup for a complete archive. Generated MusicXML is musical interchange and does not retain all original source/history data. Deterministic roundtrip tests cover small original polyphonic and numbered-melody fixtures with exact timing and pitch spelling.

Physical MIDI/audio and assistive-technology results remain unverified. Earlier successful runs do not verify later source changes. Release, pedal, fingering and expressive-performance grading remain outside the current onset assessment.
