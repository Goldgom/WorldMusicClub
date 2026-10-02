# Beginner numbered key labels

`web/beginner-notes.js` is an independent display module. Its opt-in decorator
adds 1–7, accidentals and stacked octave dots to existing enabled keys without
replacing keys, their labels, controls or input listeners. It does not send input,
change a score, transpose a note, run a clock, record events or alter assessment.

## Pitch convention

- Fixed mode uses `1 = C4` (MIDI 60), with C D E F G A B numbered 1–7. Anonymous
  black keys use sharp spellings: ♯1, ♯2, ♯4, ♯5, ♯6.
- Movable mode accepts the active `{fifths, mode}` key supported by `keyTonic`.
  It exactly follows `music.js` `jianpu`: the written tonic in octave 4 is 1,
  and accidentals are changes relative to that key signature. In minor, the minor
  tonic is 1, not 6; the natural-minor signature is retained. A minor therefore
  maps A4 B4 C5 D5 E5 F5 G5 to 1–7 without accidentals.
- MIDI keys do not identify their score spelling. The deterministic policy first
  chooses a note already in the signature, then the smallest alteration from a
  signature note, preferring a raised degree when two notes are equally near.
  The key's label can therefore differ from an enharmonic score note. For example,
  anonymous F4 in G major is E♯4, shown as ♯6 with a lower-octave dot. It does not
  claim to infer the composer's spelling. Display `beginner.spellingPolicy` in help.
- Octaves are diatonic relative to the written tonic, not simply MIDI-octave
  subtraction. C♭4 (MIDI 59) is un-dotted 1 in C-flat major. B♯3 (MIDI 60) is 7
  with a lower dot in C-sharp major. Negative written octaves are supported:
  MIDI 0 can be B♯-2 in A-sharp minor, requiring six lower dots.
- Movable mode without a key reports `missing-key` and explicitly uses fixed C4.
  Unsupported modes/signatures report `unsupported-key` and the same fallback.
  Free practice has no implicit score key: pass `key: null` and display the
  returned `reference` text. Do not use `keyAt`'s implicit C-major default to
  conceal the absence of a free-practice score.

## Pure API

`resolveBeginnerContext({numberedMode: 'fixed' | 'movable', key})` returns frozen
display context, including effective mode, fallback reason and reference MIDI.
`beginnerNoteLabel(actualSoundedMidi, options)` accepts each integer MIDI 0–127,
rejects invalid MIDI instead of clamping, and returns a frozen label containing
`number`, `accidental`, signed `octave`, `aboveDots`, `belowDots`, selected `pitch`
and `pitchName`. `pitchMidi(label.pitch)` always reproduces the input MIDI.

`beginnerReferenceText(context, i18n)` gives the explicit reference/fallback text.
`beginnerNoteDescription(label, i18n)` names the degree, octave, reference and
actual sounding pitch without relying on a screen reader pronouncing dots.

## View integration contract

`beginner-schema.js`, `beginner-en.js` and `beginner-zh-CN.js` are registered
with the shared i18n schema and catalogs. `web/beginner-view.js` owns stable
Chinese/English controls beside the stage transport and above the free-practice keys.
On short landscape screens the same stage controls move into the existing title
line, independent of the keyboard toolbar that lives in Settings. Compact help
contains the complete reference and mode choice; opening it does not reserve
another permanent playfield row.
The guide starts off for each session. Both toggles share one display preference;
both reference selectors share the existing fixed/movable `numberedMode` with
the numbered-notation selector. The reference choice lives in the guide help
details to keep the playing strip compact. Responsive moves retain the same
control and key nodes, including held input and open help state.

```js
const labels = setupBeginnerNoteLabels({root: keyboard, i18n});
const display = labels.render({
  enabled: beginnerEnabled,
  numberedMode,
  ...beginnerScoreKey(score, writtenCursor.at(position)),
});
reference.textContent = display.reference;
```

The app refreshes after keyboard creation/remapping, toggle changes, score
replacement/transposition, and active score key changes. The piano and fretboard
use actual sounded `data-midi`; the PC-map cells use their already-transposed
`data-note-midi`; free keys always have no score-key context. Display-only controls
do not release held PC contacts or alter exports. Label refreshes reuse nodes and
do not focus controls. Existing physical instrument/mapping changes retain their
own input cleanup rules.

`beginnerScoreKey` uses exact rational Rust-written occurrence ranges. A constant
explicit key at the beginning is provable without a cursor. With changing keys,
a complete cursor occurrence resolves a key only if no actual change lies inside
that half-open source range. Boundary changes and repeat returns follow the Rust
source position. An interior key change remains explicitly unresolved for that
occurrence, even if a sounding note or page anchor appears to suggest a key.
No JS tempo, beat interpolation, or note clock is introduced. Missing cursors for
changing-key scores use `keyStatus: "unresolved"` and a truthful fixed-C message.
Unsupported signatures/modes and absent score keys retain their distinct fallbacks.

For a separate view, call `render` after keyboard creation/remapping, toggle
changes, score replacement/transposition, and active score key changes. The context must come from
the currently displayed/transposed score at the current written score position;
repeat-aware written positioning remains the owning view's responsibility. The
decorator subscribes to locale changes only for its own glyph descriptions. The
owning view must also redraw toggle/help/reference text using the same service.

By default `[data-midi]` is the selector and its integer attribute is the **actual
sounded MIDI**. Existing stage piano keys and free-practice bindings already use
this value. Do not add the input transpose again. If an input-map view holds raw
untransposed MIDI, supply `getMidi(key)` which computes its final sounded value
once. Input transpose changes those sounded labels; score transpose/key changes
change the reference context separately. MIDI outside 0–127 and disabled keys
have no guide. The display does not enable or silently clamp them.

The decorator preserves existing `aria-label`, `aria-description`, pressed state,
class names and descendant identities. It adds its own hidden description ID to
`aria-describedby` while retaining other owners' IDs. The visual glyph is
`aria-hidden` and pointer-free. Disabling/disposal removes only owned nodes and
the owned ID. Repeated renders reuse glyph and description nodes; replaced keys
and replaced contents are reconciled on the next render. No mutation observer,
global event handler or browser import-time side effect is installed.

Position `.beginner-note-label` in owning view CSS and ensure the existing generic
key `span` rules do not override its three rows. The dot rows have controlled
inline stacking styles; the outer label must have adequate room for low/high
register dots. Scope optional CSS to `.beginner-note-label`,
`.beginner-note-above`, `.beginner-note-tone` and `.beginner-note-below`. Preserve
computer shortcut labels and do not overlay finger guidance or input targets.

`dispose()` unsubscribes and cleans up idempotently. A disposed decorator cannot
restart. The helper starts disabled; the integrated view owns the session-only toggle.

## Verification and boundaries

Run `node --test tests/beginner-notes.test.js tests/beginner-context.test.js tests/frontend-beginner-app.test.js`. These tests are registered in `npm test`. The tests verify all 128 MIDI pitches in all 30 supported
major/minor signatures, independent degree/octave reconstruction, fixed black
keys, negative/enharmonic octaves, source/key immutability, explicit fallback,
transposition/key changes, locale schema parity, safe literal text, stable DOM
identities/listeners, accessible-description ownership and cleanup.

The module and Linkedom tests do not establish visual layout, real browser focus,
screen-reader behavior or physical MIDI behavior. No browser/GUI was launched.
The full-app hosted browser suite also registers `tests/beginner-browser-regression.js`
for real focus, supported viewports, Rust source transposition, cursor contexts,
free-practice remapping and exports. This regression is registered for hosted CI;
local browser execution is not permitted in this environment. CSS fit and browser
behavior remain unverified until that hosted run succeeds.
