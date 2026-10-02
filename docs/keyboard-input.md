# PC keyboard performance input

`keyboard-input.js` is a pure controller. The application integrates its callbacks
and lifecycle listeners in `app.js`, with localized controls in
`keyboard-input-view.js`. Configuration changes do not open devices, start
playback, create audio, change a score, change score-transposition state, or
calculate assessment timing. Actual audio/recording routes remain app-owned.

## Default physical mapping

The wide preset covers 47 distinct consecutive notes, MIDI 36–82 (C2–A♯5),
using all 47 ordinary US alphanumeric and punctuation positions. Four rows run
chromatically left to right, then continue on the row above. This is a compact
range-first mapping, **not a piano-shaped white/black-key layout**. Moving upward
between rows does not always move by an octave.

| Physical row | Key positions, left to right | Default pitch range | Notes |
| --- | --- | --- | --- |
| Bottom | Z X C V B N M , . / | C2–A2 | 10 |
| Home | A S D F G H J K L ; ' | A♯2–G♯3 | 11 |
| Upper | Q W E R T Y U I O P [ ] \\ | A3–A4 | 13 |
| Number | ` 1 2 3 4 5 6 7 8 9 0 - = | A♯4–A♯5 | 13 |

`LEGACY_KEYBOARD_MAPPING` supplies the former 17-note piano-shaped arrangement
(A/W/S/E/…). Selecting it at base MIDI 60 produces C4–E5. Custom arrays can cover
physical letter, digit, punctuation, international and ordinary numeric-pad keys.

Bindings use `KeyboardEvent.code`. Labels describe US physical positions;
non-US printed keycaps and generated characters may differ. There is no automatic
keyboard-layout inference. Dead-key, IME and composition events are suppressed,
so the nominal 47-key coverage may be smaller on a particular OS layout. A user
can select a different mapping, use another physical layout, or use MIDI/on-screen
input. Browser-reserved positions may also fail to deliver events. The application
must disclose this rather than promise 47 simultaneous notes or universal access.

Hardware rollover is unknown. Missing key events cannot distinguish hardware
rollover, browser filtering, focus loss, or a note the player never attempted.
This module never reports a detected ghosting limit or a hardware diagnosis.

## Adapter contract

```js
import {createKeyboardInput, keyboardInputAllowed} from './keyboard-input.js';
const keyboard = createKeyboardInput({
  // Reuse existing application adapters; they own InputEvidence and the synth.
  pressNote,       // (source, midi, velocity, eventTimestamp, options)
  releaseNote,     // (source, eventTimestamp, options)
  releaseMatching, // (prefix, eventTimestamp, options)
  getContext: () => ({
    screen: shell.screen(),
    hidden: document.hidden,
    dialogOpen: Boolean(document.querySelector('dialog[open]')),
    settingsOpen: false, // set from the actual settings UI if not a dialog
  }),
  configuration: {baseMidi:36, transpose:0},
  onChange: snapshot => renderKeyboardControlsAndLabels(snapshot),
  onConfiguration: event => retainConfigurationForTakeExport(event),
});
```

Callbacks have the existing application argument shapes. `pressNote` receives
`inputKind: 'typing_keyboard'` and `encoding: 'key_down'`; explicit release receives
`encoding: 'key_up'`. Synth cleanup calls `releaseMatching('key:', timestamp,
{reason, inputKind:'typing_keyboard'})`, preserving MIDI and on-screen ownership.
The existing InputEvidence boundary aliases source keys during export. Raw keyboard
keyup does not intrinsically identify pitch: its callback does not add a `midi`
field or invent note durations, paired releases, or sustain judgement.

Use `keydown(event)` / `keyup(event)` instead of the old event.key handlers.
True means the module handled a note or a transposition shortcut. Do not send a
second unconditional `releaseNote('key:' + event.code)` from the old handler:
unknown typing and duplicate keyups must remain absent from musical evidence.
Keep the application's Space and accessible Enter/Space handlers separate,
using equivalent composition/editable gating. This module reserves those keys.

The app must wire:

- `compositionstart` → `compositionStart(event)` and `compositionend` →
  `compositionEnd()`
- Blur, pagehide, hidden-document transition, stage exit, opening settings/dialogs,
  entering an editable control, pause/reset and instrument/keyboard-surface changes
  → `contextChanged(reason, timestamp)` or `releaseAll(reason, timestamp)`
- Any explicit OS-label/layout refresh → `contextChanged('keyboard_layout_changed')`
  before refreshing labels (the physical code map itself remains stable)
- Mapping/base/offset controls → `configure(next, {reason,eventTime})`

The module does not broaden input capture: absent stage context is inert. Notes
are suppressed in inputs, textareas, selects, editable ancestors, links, settings,
dialogs, notices and nonmusical interactive controls. Stage musical buttons may
play letter-key notes. Transposition controls are stricter: arrows only work from
the stage body or an explicit performance surface; they never steal a focused
button/widget's navigation. Mark a focusable performance surface with
`data-keyboard-performance`, and put settings inside a blocked region such as
`data-keyboard-input="off"`. The existing `#keyboard` and `#fretboard` are known
performance surfaces. Composed event paths protect editable shadow descendants.

Bare ↑ / ↓ changes **performance-input pitch** by ±12 semitones; ← / → changes
it by ±1. Ctrl/Meta/Alt combinations, Shift-arrow selection and repeat events are
left alone. Changing input pitch does not change the score or canonical targets.
Do not auto-start playback or unlock audio from a configuration callback.

## Configuration, ownership and model

`configure` validates the complete next configuration before releasing notes.
Invalid updates throw `KeyboardConfigurationError` with a stable `.code` and
leave both current notes and configuration unchanged. Duplicate physical codes
are always rejected. Duplicate pitches require explicit
`allowDuplicatePitches:true`; `snapshot().pitchAliases` exposes those aliases.
Each physical contact owns a unique controller/contact source under the `key:`
prefix, so releasing one alias cannot silence another. A released contact's delayed
audio-unlock promise cannot be admitted by a newer same-pitch contact or replacement
controller. Treat callback sources as opaque; do not rebuild them from event.code.

Base MIDI is 0–127; transpose and relative offsets are integers −127…+127.
Out-of-range bindings are disabled, **never clamped** into a different pitch.
At least one binding must remain in MIDI 0–127. The model distinguishes the
nominal key count, playable key count, unique playable note count and disabled key
count. Each binding has `requestedMidi`, actual `midi` (null if disabled), `note`,
`row`, `label`, `enabled` and `held`. Row ranges and the overall active range
include only playable notes. Settings should show both range and disabled count.

`transposeBy(integer, timestamp)` changes only the input offset. Impossible
transposition calls throw a typed error; the keyboard shortcut handler consumes
an at-limit arrow without changing the configuration. UI buttons can use the
error code for localized feedback. The optional initial legacy configuration is
`{mapping:LEGACY_KEYBOARD_MAPPING,baseMidi:60}`.

Held contacts preserve their original sources through modifier, mapping, layout
and focus changes. Cleanup synthesizes scoped boundaries before new configuration
is published. Later raw keyups still reach InputEvidence. Repeat events cannot
restart a cleaned-up note. A new non-repeat keydown after blur is a fresh contact,
even if its previous keyup occurred outside the document; no missing note-off is
fabricated. This avoids requiring an extra keypress after returning to the app.

## Reproducible records

`onConfiguration` receives the initial configuration and every actual change,
including its complete code/offset/label/row map, base pitch, semitone offset,
duplicate-pitch policy, reason, configuration ID, normalized event and receipt
times, and timestamp basis. These records describe input configuration only.
No nonmusical typed text, device IDs or serial numbers are observed. Explicit
custom binding labels are retained as configuration data.

`exportConfigurationData()` supplies a bounded receipt-order history, initial
and current configuration, omission count and a visible truncation flag. Its
scope is the controller lifetime, which may begin before a practice pass; keep
this distinct from InputEvidence's practice-session capture window. Include it
as a separate `keyboard_input_configuration` section in take export or retain
configuration events through the app's recorder adapter. Do not overwrite
canonical note-on assessment fields, silently omit truncation, or claim historical
reproducibility beyond retained configuration records. The default history limit
is 512 and never evicts earlier evidence; callbacks still receive later changes.

## Verification

`node --test tests/keyboard-input.test.js` uses pure Node and linkedom. It verifies
all default positions, row boundaries, alternate/custom maps, explicit aliases,
MIDI boundaries, control guards, composition, physical-code release ownership,
lifecycle cleanup, configuration history, and existing InputEvidence interaction.
The view tests in `tests/frontend-keyboard-input-view.test.js` cover mapped piano
labels, custom/legacy settings, invalid settings, explicit aliases, MIDI clipping,
locale/draft preservation and bounded-history warnings.
`tests/frontend-app-dom.test.js` checks actual controller routing, actual performed
pitch in take evidence, unchanged score targets, keyboard configuration export,
focus/IME/hidden cleanup, and the silent-input audio-unlock boundary. These are
Node/linkedom checks; real-browser layout and hardware usability are separate.
No browser or GUI launch is part of these tests.


## Application controls

The stage footer shows the current input range, instrument display range, mapping
rows and octave/semitone controls. Matching physical labels appear on each piano
key, including explicit same-pitch aliases. Settings contains the preset selector,
base MIDI pitch, semitone offset and JSON mapping editor. The wide preset resets
to MIDI 36 with zero offset; the optional legacy preset resets to MIDI 60.

The editor uses the same `[{code,offset,label,row}]` map as the controller. Invalid
JSON, duplicate physical codes and disallowed duplicate pitches leave both
configuration and held contacts unchanged. Locale/held-state refreshes preserve
unfinished editor content and manual setting drafts.

The app marks the stage heading and keyboard/fretboard surfaces as performance
focus targets. Arrows over focused widgets remain ordinary navigation. Enter/Space
on on-screen musical buttons is separately gated against IME and hidden/dialog
contexts. Settings, page lifecycle and physical input configuration changes
release controller-owned contacts; the existing all-input pause boundary is
retained without manufacturing an extra duplicate keyboard boundary.

A muted physical key still enters the existing evidence route and visual held
state but never calls `synth.unlock()`. Turning sound back on does not re-trigger
a held contact. Take JSON includes `keyboard_input_configuration`, explicitly
scoped to the controller lifetime rather than the current scored practice pass.
