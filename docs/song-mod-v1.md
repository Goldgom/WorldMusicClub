# Song Mod v1

This section preserves the original v1 contract and parity vector. Current browser
human sound support and persistence are specified in **Compatible browser v2 extension** below.

Song Mods are user-owned sidecars. They do not replace any canonical, MIDI, VSQ, raw-source, skin or notation schema. They contain no executable scripts, accounts, multiplayer routes or user assets.

The selected-song action strip has one **Start performance / 开始演奏** action and a **Mod** entry. Apply saves the draft without starting playback. Cancel discards it, including while compatibility checks are pending. The in-stage Mod entry pauses before editing; changing performers or sound policy restarts that session and clears its in-memory takes, with an explicit warning. Display and playback mute changes preserve the paused source position, target plan and takes; mute rebuilds only the machine audio plan on the next Play. In-stage Play/Pause, Replay, Reset and seek controls remain.

## Contract

The closed envelope is `{format:"wmc-song-mod",version:1,songId,sourceRevision,configFingerprint,config}`. `sourceRevision` is `{kind,value}`, with a lowercase 64-character SHA-256 `value`:

- `canonical-score-v1`: existing `wmh-canonical-score-v1` normalized-score fingerprint
- `clean-package-sha256`: admitted complete-song package content SHA-256
- `clean-score-sha256`: exact clean-score byte SHA-256, used by the separate Rust/Unity bridge

`config` has `layout` (`complete` or `solo`), `showOtherParts` (boolean), and `parts` in complete canonical source order. Each part is `{partId,performer,instrument,muted,visible}`. Performer is `human` or `machine`; instrument is `source`, `sine`, `triangle` or `reed`; mute and visibility are independent booleans. `solo` and show-other-parts affect human-practice presentation only. The per-part visible setting applies to both practice and Listen.

Fingerprint bytes are UTF-8 of `wmc-song-mod-config-v1\n` followed by compact standard JSON for `[layout,showOtherParts,parts.map(p=>[p.partId,p.performer,p.instrument,p.muted,p.visible])]`. Unicode remains unescaped except JSON-required escaping. Hash those bytes with SHA-256 and encode lowercase hex. A parity vector is checked by JavaScript and the Rust/Unity prototype:

```
{"layout":"complete","showOtherParts":true,"parts":[{"partId":"midi-t2-c1","performer":"human","instrument":"source","muted":false,"visible":true},{"partId":"midi-t3-c2","performer":"machine","instrument":"source","muted":false,"visible":true}]}
configFingerprint: d532e0a13635c824c646d08f27ad62ecfdf13bc6d4fcc310637bb2fd6e32a366
```

Browser persistence is versioned and keyed by song ID plus typed source revision. Existing explicit choices reopen; incompatible source revisions never reuse a Mod. Storage errors keep choices in the current tab and disclose that they were not saved. Restore original settings resets this Mod to its initial assignment/layout with source sound, no playback mute and every part visible. It does not alter unrelated preferences. Falling-note labels keep their existing saved preference and default off.

## Actual support

| Renderer/profile | Roles, playback mute, display | Per-part machine sound | Source/default behavior |
| --- | --- | --- | --- |
| Canonical compiled audio v1 | Supported | sine / triangle / reed in canonical AudioWorklet | Existing sine PCM, profile, source fingerprints, ties/repeats and gates |
| Basic MIDI key rendition v2 / FIFO v1 | Supported | sine / triangle / reed in BasicKey AudioWorklet | Existing melodic sine and percussion pulse, exact admitted gates |
| Chosen VSQ base-note runtime | Supported | sine / triangle / reed in VSQ AudioWorklet | Existing chosen piano/guitar reference recipe and fixed reference velocity |
| Existing procedural clean source profile | Supported through its already admitted reference renderer | Disabled with a reason | Existing source renderer only; an override can never fall back to it |
| Unsupported complete profiles | Only available admitted target/display capabilities | Disabled with a reason | No new sound fallback |
| Human live input | Shared existing physical input and target profile | Per-part machine sound is disabled while human is selected | Existing shared live instrument; no invented per-part device routing |

The sound names are **Synthetic sine**, **Soft triangle synthesis**, and **Reed synthesis**. They are finite basic additive recipes, not acoustic instruments, GM patches, vocal banks or original mixer reproduction. Harmonics at or above Nyquist are omitted; an unrepresentable fundamental rejects the entire plan. Source never auto-converts percussion. Only an explicit percussion override selects a pitched synthetic color at the retained MIDI key while preserving the percussion gate/envelope. It does not change drum selectors into new human piano targets.

The optional sound buffer is bound to the exact source/gate/selection plan and validated in the audio thread before it acknowledges readiness. Default source paths retain pre-change PCM hashes. No oscillator scheduling or sound fallback runs in main-thread UI callbacks.

## Ownership and timing

The Mod's human set is passed into the existing target planner, notation classification, falling-note classification, audio exclusion, recorder and scoring paths. Machine notes never enter the human take or receive hit feedback. All machine means Listen and produces no human take. All human is valid and produces zero machine accompaniment gates, retaining the complete source clock. Existing physical target deduplication still merges same-key inputs and retains every source owner. A hidden representative does not hide a deduplicated physical note when another owning human part remains visible.

Mute only controls source playback and does not remove human targets. Display only controls presentation and does not remove sound or targets. Human live sound remains the shared live-instrument control, disclosed in each human row.

A part's `instrument` remains its saved **machine** recipe when the performer changes to Human. That dormant recipe is retained in the versioned Mod and shown in the disabled selector, but it is excluded from accompaniment options and renderer capability checks. Switching the part back to Machine reactivates the exact saved recipe and checks whether the renderer supports it. A dormant human recipe cannot add a synthesis identity to another part's source plan or force an unsupported machine renderer. The portable v1 envelope, fingerprint preimage and Rust/Unity parity vector are unchanged.

Only performer or sound-policy Mod changes use the existing reset boundary. Display and playback mute changes preserve takes. All Mod changes retain canonical A/B range and tempo settings. Tempo/transposition still use existing Rust derivation and instrument/fingering regeneration; a derived canonical score receives its own source revision with the same compatible Mod choices. Complete-song tempo/transpose/loop restrictions remain explicit until matching complete performance derivation exists. Count-in, source gate timing, loop/pass ledgers, paused oscillator phases and replay admission remain governed by the current audio-thread paths.

## Prepared part-instrument routing interface

`web/part-instrument-policy.js` provides an immutable runtime snapshot with policy ID `wmc-part-instrument-policy-v1`. `createPartInstrumentPolicy(mod, {identity, parts})` validates the existing Mod binding and retains its song ID, typed source revision and configuration fingerprint. It names each part's current performer, effective sound and stored machine recipe, and exposes the human set as `none`, `single-part` or `shared-group`. Playback mute and visibility never remove human members. This is a view of the same source and Mod, not another persisted format or a transformed score.

`resolvePartInstrumentInput(policy, {kind:'shared'})` returns the complete current human group. `{kind:'part', partId}` resolves only when that source part is the sole human part; it explicitly blocks individual routing when multiple human parts share input. Listen, unknown parts, machine parts and unsupported device/channel, pitch or independent instrument requests produce blocked results. A physical target's representative note cannot choose an individual owner; the existing target planner still owns deduplication and keeps every source owner.

The dialog consumes this descriptor to explain the current input scope. The resolver is a tested prepared interface for later input consumers; it does not add device assignment, multiple live instruments, multiplayer or new acoustic instruments. A future consumer must rebuild the snapshot after Mod/source changes and match its source revision and configuration fingerprint to the active session before routing. Source programs, banks and program-change events remain in the unchanged score/package and are still governed by the admitted source renderer; they do not imply a live input instrument or device route. Existing transposition, playable-range checks and scoring remain owned by their current derivation and target paths.

## Verification boundary

Node tests exercise production DSP cores and production app code against in-memory native APIs and DOM/audio fixtures. They prove PCM differences with identical actual gate ledgers, source PCM restoration, per-part selection, tamper rejection, all-human/all-machine ownership, storage recovery, cancellation/navigation and repeated actions. They are not browser rendering, real audio-device or Windows package acceptance. Hosted original-fixture UI and Windows validation remain separate gates before promotion.

## Compatible browser v2 extension

The browser now writes Mod version 2. The preceding version 1 contract and its
SHA-256 parity vector remain supported unchanged; the separate Rust/Unity
prototype remains version 1 and has not been extended or enabled.

Version 2 adds exactly one required field to each part: `liveInstrument`, with
closed values `follow`, `piano`, or `guitar`. `instrument` continues to store the
machine recipe independently. Selecting Human keeps that machine recipe dormant;
selecting Machine keeps the human live preference dormant. No dormant value
changes another part's active recipe or creates a voice.

The v2 fingerprint preimage is UTF-8 `wmc-song-mod-config-v2\n` followed by compact
JSON for `[layout,showOtherParts,parts.map(p=>[p.partId,p.performer,p.instrument,p.liveInstrument,p.muted,p.visible])]`.
Both versions reject unknown fields, missing required fields, wrong versions,
invalid enumerations, source/order mismatches and corrupt fingerprints. Migration
first validates v1, then sets every `liveInstrument` to `follow` in a v2 copy.
The constructor accepts a complete legacy-shaped configuration for normalization,
but rejects mixed legacy/v2 part shapes. Loading uses the v2 storage prefix
`worldmusichub.song-mod.v2.` and checks the existing v1 key only when the v2 key is
absent. Reading/canceling never writes storage. Successful Apply writes v2 while
leaving the original v1 bytes in their old key; failed storage writes retain the
current tab's usable choices and disclose the failure. An invalid save cannot
replace either the admitted in-memory Mod or a saved copy.

Human selectors offer **Follow current performance instrument**, **Piano-style
basic synthesis (sine)** and **Guitar-style basic synthesis (triangle)**. These
reuse exactly the two existing live AudioWorklet recipes; they do not add acoustic
samples, GM patches, instruments, devices or a main-thread oscillator fallback.
Follow resolves against the existing performance instrument control. The Mod does
not rewrite that shared preference, so Free practice keeps its existing sound.
The performance profile still determines input geometry, playable range, target
adaptation and scoring even when the live recipe differs.

A single human part uses its resolved live recipe. Multiple human parts must
resolve to the same recipe because they share one physical input. Mute and
visibility do not remove a human owner from that check. Conflicts list the
involved parts and effective sounds, disable Apply and Start/Play, and preserve
all choices. **Unify human sounds** explicitly names its destination and affected
human parts before changing only the draft; Apply remains necessary. No automatic
unification or pitch/representative-based owner selection is performed.

`wmc-part-instrument-policy-v2` snapshots include mode, current performance
instrument, exact source binding and configuration fingerprint. Follow is resolved
freshly at admission and before live routing. Captured policies are revalidated
after asynchronous live preparation, preventing old defaults, modes or Mods from
playing a late voice. A single physical same-key event still reaches the existing
recorder once and the live worklet once with every target owner retained.

Human live-sound edits use the existing explicit take-reset warning and reset
boundary. Cancel preserves the applied Mod and takes; opening the editor pauses
and releases held sound. Restart, navigation, changed performance instrument,
input cleanup and late-unlock fencing retain their existing cancellation paths.
Machine DSP, score sources, source clocks, target planning and recording/scoring
algorithms are unchanged. Node coverage includes real production live PCM,
source-plan equality across canonical/Basic/VSQ, migration, conflicts, stale
policies and interrupted UI flows. Browser/device/native acceptance remains a
separate checkpoint.
