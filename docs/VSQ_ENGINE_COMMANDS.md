# Named VOCALOID2 dispatch

The independent `vsq_engine` profile consumes protocol selection and byte packing
into nine closed command variants: note, voice bank, voice program, pitch bend,
dynamics, vibrato rate/depth, voice parameter and pitch-bend sensitivity. It
serializes no selector array, generic parameter blob or raw message payload.

Each command retains source dispatch tick, source event range and only explicitly
present transport identity/delay. Every field and its order must be consumed.
Unknown groups, fields, extra components, interrupted groups and unsupported
continuation packets hold conversion. Typed revalidation checks exact source
values and coordinates when the original controller inspection model is still
available. Imports without originals contain evidence claims, not authentication.

Note commands are bound to authored notes by source track, note order and checked
musical/phonetic fields. Engine millisecond duration remains distinct from exact
authored tick duration. Missing phonetic adjustments remain absent; zero is
explicit. Vibrato database/type and duration/delay values remain independent,
including combinations whose sum is 128. Intonation parameters stay unscaled,
especially where reference sources disagree about the first-note d1 unit.

Voice program describes VOCALOID voice selection, not GM instrumentation.
Omitted transport settings are not replaced with defaults or guessed inherited
state. Legacy resonance value 255 is retained with unknown interpretation; it is
not clamped, converted to -1 or called disabled.

Controller-record count, logical parameter-field count and named-command count
are distinct coverage units. No count is mislabeled as MIDI represented_events.
Source coordinates are provenance. The full vocal renderer remains blocked;
explicit base-note instrument practice is a separate derived capability.

References:

- [Original author's NRPN table](https://w.atwiki.jp/boare/pages/102.html)
- [Immutable parameter definitions](https://github.com/cadencii/cadencii/blob/911affa7a0d5962beb6fb0af557300f2719a6e6c/src/cadencii.vsq/NRPN.cs)
- [Original transport writer](https://github.com/cadencii/cadencii/blob/911affa7a0d5962beb6fb0af557300f2719a6e6c/src/cadencii.vsq/VsqNrpn.cs)
- [Original note generator](https://github.com/cadencii/cadencii/blob/911affa7a0d5962beb6fb0af557300f2719a6e6c/src/cadencii.vsq/VsqFile.cs)
- [Domino implementer's observations](https://mimikopi.nomaki.jp/domino/vocaloid2/manual/index.html)

The source definitions establish 50:5a as accent and 55:00 as engine identity.
They do not establish a normative Yamaha rounding or cross-group inheritance
contract. No downloaded source implementation was executed or copied here.
