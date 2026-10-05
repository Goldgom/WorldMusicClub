# Song Mod v1

Song Mods are user-owned sidecars. They do not replace any canonical, MIDI, VSQ, raw-source, skin or notation schema. They contain no executable scripts, accounts, multiplayer routes or user assets.

The selected-song action strip has one **Start performance / 开始演奏** action and a **Mod** entry. Apply saves the draft without starting playback. Cancel discards it, including while compatibility checks are pending. The in-stage Mod entry pauses before editing; applying restarts that session and clears its in-memory takes, with an explicit warning. In-stage Play/Pause, Replay, Reset and seek controls remain.

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
| Legacy/unsupported complete profiles | Only available admitted target/display capabilities | Disabled with a reason | No new main-thread or silent sound fallback |
| Human live input | Shared existing physical input and target profile | Per-part machine sound is disabled while human is selected | Existing shared live instrument; no invented per-part device routing |

The sound names are **Synthetic sine**, **Soft triangle synthesis**, and **Reed synthesis**. They are finite basic additive recipes, not acoustic instruments, GM patches, vocal banks or original mixer reproduction. Harmonics at or above Nyquist are omitted; an unrepresentable fundamental rejects the entire plan. Source never auto-converts percussion. Only an explicit percussion override selects a pitched synthetic color at the retained MIDI key while preserving the percussion gate/envelope. It does not change drum selectors into new human piano targets.

The optional sound buffer is bound to the exact source/gate/selection plan and validated in the audio thread before it acknowledges readiness. Default source paths retain pre-change PCM hashes. No oscillator scheduling or sound fallback runs in main-thread UI callbacks.

## Ownership and timing

The Mod's human set is passed into the existing target planner, notation classification, falling-note classification, audio exclusion, recorder and scoring paths. Machine notes never enter the human take or receive hit feedback. All machine means Listen and produces no human take. All human is valid and produces zero machine accompaniment gates, retaining the complete source clock. Existing physical target deduplication still merges same-key inputs and retains every source owner. A hidden representative does not hide a deduplicated physical note when another owning human part remains visible.

Mute only controls source playback and does not remove human targets. Display only controls presentation and does not remove sound or targets. Human live sound remains the shared live-instrument control, disclosed in each human row.

Mod Apply uses the existing reset boundary and retains canonical A/B range and tempo settings. Tempo/transposition still use existing Rust derivation and instrument/fingering regeneration; a derived canonical score receives its own source revision with the same compatible Mod choices. Complete-song tempo/transpose/loop restrictions remain explicit until matching complete performance derivation exists. Count-in, source gate timing, loop/pass ledgers, paused oscillator phases and replay admission remain governed by the current audio-thread paths.

## Verification boundary

Node tests exercise production DSP cores and production app code against in-memory native APIs and DOM/audio fixtures. They prove PCM differences with identical actual gate ledgers, source PCM restoration, per-part selection, tamper rejection, all-human/all-machine ownership, storage recovery, cancellation/navigation and repeated actions. They are not browser rendering, real audio-device or Windows package acceptance. Hosted original-fixture UI and Windows validation remain separate gates before promotion.
