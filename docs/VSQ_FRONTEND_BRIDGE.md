# VSQ native-library consumer

This UI increment consumes the separately validated native VSQ package profile.
It does not provide whole-vocal synthesis or establish original voicebank,
timbre, expression, mixer acoustics or dispatch fidelity.

## Admission and explicit choice

- Library loading admits `wmh-vsq-clean-v1` with `runtime: null`. A saved or
  duplicate import with `playable: false` remains selectable only when its
  complete-package summary declares the blocked-vocal/explicit-practice
  capabilities and all eight required interpretation limits.
- The preview shows all authored tracks/parts and a Chinese/English choice.
  Listen and Practice remain disabled until the user chooses base-note
  instrumental practice. Full vocal mode is visibly unavailable.
- The choice makes only `POST /api/library/runtime` with the selected native
  key, `profile: "wmh-vsq-clean-v1"` and
  `choice: "base_notes_instrumental"`. It does not automatically start audio.
  The native response supplies `runtime`, `compilation`, and the explicit
  `reference_velocity: 90` constant.
- Choice/runtime state is never persisted. A library reload or process restart
  requires a new choice. Pause, transport Reset and target/accompaniment edits
  retain the interpretation choice for the current session. Failed requests can
  be retried; duplicate clicks coalesce; a stale result cannot replace a newer
  selection or a newer load of the same key.

## Exact storage and runtime boundaries

`metadata_json` and `score_json` are retained as the native-returned exact
strings. Parsed authoring objects are display-only and must never be
reserialized to save/export: VSQ coefficients, integers and rational fields can
exceed JavaScript's safe integer range. Complete-pack export submits native keys
and the native exporter owns exact metadata, score and media bytes. Legacy
notation-only saving and backup are unavailable for a selected complete song.

Runtime admission checks the native profile/source identity, all original part
and note IDs, singer event IDs, timeline source identities, note count, native
clock and explicit reference velocity. Scheduling and scoring consume the
native-derived compilation; the browser does not integrate the VSQ tempo map
or subtract PreMeasure. Unknown canonical keys stay unknown, including numbered
notation's explicit fixed-reference fallback.

The dedicated VSQ player uses named reference-piano/reference-guitar recipes
chosen through the existing instrument control. It never creates MIDI channel
or program fields and never treats source singer/voice program descriptors as
the reference route. Source Dynamics is retained, including zero; it neither
silences nor deletes notes. Native part audibility initializes reversible
accompaniment toggles. All authored parts remain available. Practice mutes the
selected human part in machine playback and grades only that target; machine
accompaniment never becomes input evidence.

## Deliberate limits and verification

Full vocal playback remains blocked. The UI preserves all eight native
interpretation limits. Reference mixing does not map source faders/pan/output
mode. Existing complete-song limits on tempo changes, loops, transposition and
notation-only copies still apply.

Written-note following consumes only the `wmh-vsq-practice-navigation-v1`
map bundled in the explicitly selected native runtime response. A separate
validator binds its exact package hash, source identity, runtime profile,
choice, origin, canonical score and every native sounding interval. Original
measure IDs and project beat positions remain unchanged. Native negative
PreMeasure measures are retained; display lookup starts at practice zero.
The native written extent may precede or exceed playback duration: an unmapped
source tail has no current written measure, and padding cannot extend playback
or following beyond its native end. Cursor segments must continuously cover
each original note's native interval. No BPM integration or origin offset is
calculated in JavaScript.

Ordinary-score navigation keeps its existing strict zero-to-duration bounds.
A missing, stale or incompatible VSQ map leaves static notation and practice
available, with following unavailable; it never falls back to generic canonical
navigation. A new load invalidates the previous map even for the same score.

`tests/vsq-clean-consumer.test.js` and `tests/vsq-navigation.test.js` use only
original synthetic native fixtures, an in-memory native protocol, DOM and fake
audio. They cover explicit admission,
an integer above 2^53, zero Dynamics, source-muted parts, original IDs, exact
native note boundaries, unknown keys, both locales, target-only scoring,
choice retry/races, load/process restart and clean export by key. Navigation
coverage includes part scopes, negative PreMeasure, exact note boundaries,
trailing gaps, both native end/padding arrangements, identity rejection and
stale responses. Existing MIDI package/player/media/import tests remain part of
`npm test`.

This increment has no browser, hosted, acoustic or Windows/native acceptance
claim. The original synthetic fixture files and native endpoint are supplied by
the companion native bridge.


## Coexistence with semantic MIDI navigation

Complete MIDI and explicitly chosen VSQ practice both retain the exact admitted compilation timeline in the application. MIDI admission shares its compilation object with the admitted runtime so the ordinary strict navigation identity check remains intact. The written-cursor adapter selects the native MIDI navigation map or the separate VSQ navigation profile, and neither complete-package path calls the generic BPM-based navigation endpoint.

Switching between package profiles invalidates cached navigation immediately. MIDI retains measure-only following only when a valid native measure map explicitly diagnoses the absence of optional written spans; malformed supplied spans remain blocked. VSQ keeps its separate native negative PreMeasure, source-declared tail, and written-padding bounds. These source and offline checks do not establish hosted-browser or Windows acceptance.
