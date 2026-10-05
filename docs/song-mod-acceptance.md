# Song Mod acceptance migration

The primary performance routes configure visible Mod controls, wait for Apply to
finish, and use Start Performance. All-machine means Listen; a source part's
human role alone controls scoring. Source inspection remains a separate visible
route for sources the performance renderer cannot play.

The native helper in `acceptance-wait.js` delegates to each scenario's existing
owned action mechanism. Hosted checks use real Playwright pointer, select and
checkbox actions. Neither helper invokes production controllers, changes score
state, dispatches synthetic input, or clicks the hidden legacy entry buttons.
Applying layout, display, or machine mute must preserve the paused clock and
human take. Performer and timbre edits explicitly restart their session.

Setup actions are outside the human performance window. The reference proof's
`humanActionStart` is recorded after Mod and count-in setup. Its scored window
still contains exactly Play, KeyR and Pause, with the same actual recorder and
trusted-event admission checks.

## Finite action budgets

Every action still uses the existing finite action vocabulary, exact fixture
allowlist, owned viewport/coordinates and payload limits. No arbitrary keys,
text, scripts or input values were added. Result polling and progress reports
use the same phase-specific count limit as action admission.

| Existing phases | Added visible paths above the former 64-action ceiling | Ceiling |
| --- | --- | --- |
| VSQ seed/restart | Up to 13: Listen setup 3, practice setup 3, target/mute dialog 3, fingering role reset 4 | 80 |
| Basic key seed | Up to 7: part-selection round trip 4, Listen setup 3 | 80 |
| Basic key restart | Up to 13: part round trip 4, notation Start/Reset 3, complete display Mod 2, human Start 4 | 80 |
| Authoring and VSQ authoring | Up to 14: original Mod/Start 5, scored Mod/settings setup 6, navigation or explicit Listen configuration 3 | 80 |
| Canonical seed | Up to 16: visible initial selection 4 and isolated timbre override/restore 12 | 80 |
| Performance, pitch bend, bulk import, song folder | At most 11: original visible Mod/Start 5 and scored Mod/settings setup 6 | 75 |
| All other phases | Existing ceiling retained | 64 |

The bounds have negative tests at the first excluded sequence. Generic and
unknown phases retain 64, and an invented `set-mod` action is rejected.

## Retained evidence

The canonical original fixture has an isolated reed override and a Restore
original settings path. Both complete their actual receiver ledgers. The source
and compilation fingerprints remain identical, the override has its declared
synthesis identity, and restoration returns the exact original frame plan and
selection fingerprint. Pure processor contracts independently compare exact
PCM bytes before override and after restore; those tests are not GUI evidence.

The original complete/solo, no-machine-input, source archive, JSON/MusicXML,
Basic and VSQ assertions remain in the independent evidence verifiers. Added
Mod receipts bind the source part, field, option, trusted event and native action
sequence. Hosted/native execution is still required before acceptance; local
syntax and pure contract tests alone do not establish a UI pass.
