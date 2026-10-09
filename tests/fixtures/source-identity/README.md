# Source-identity import-contract fixtures

All MIDI here is an original mechanical note-60 example, not user music or a
copied transcription. These fixture bytes and descriptions are CC0-1.0.

`01_no_gm_program_basic_controller.mid` is a separate 41-byte fixture, SHA-256
`6ae97dc2d8b301fe7a77b4c127f2d2593f0020c81af91344c41ea0f58ede7633`.
It derives from the existing public CC0
`crates/score-core/src/source_identity/fixtures/01_no_gm_program.mid`
(SHA-256 `bde38b620853111b6c27314c02146db83c7cef8eb52cc45dc1b1ff0d87ffa871`)
by inserting only delta-zero channel-1 controller 74 value 64 immediately after
Program Change and updating the SMF track length. All original event bytes and
musical times remain unchanged. The independent scanner checks all events and
original note pitch, velocity, start and duration. The additional event shifts
later source-event coordinates, which are derived from the new source itself.

The strict canonical importer rejects controller 74. The complete Basic fallback
retains it without claiming to reproduce its sound effect. It does not declare
General MIDI or select a bank/program, so the expected identity remains
unresolved with `missing_gm_declaration`. This is an expected contract, not an
executed analyzer result. The fixture has its own filename, source digest and
Basic package identity. The original 37-byte no-GM fixture remains unchanged and
must still import canonically; its browser case must not request Basic identity.

`*.commit.json` are exact response bytes from the real public-730 hosted native
import commits, bound by `import-contract.provenance.json`. They demonstrate the
actual canonical versus Basic response shapes that exposed the proof bug. The
hosted run failed before any source-identity UI case executed. These regression
inputs are never substituted for fresh native responses in the hosted proof and
are not evidence that the repaired UI, identity analyzer, or fresh source passed.

A historical `c105a7375b4c5f977b457853c62fa48bb964b056` driver independently
confirmed the original fixture's canonical import, controller 74's canonical
rejection, and explicit Basic conversion retaining the new fixture's five exact
events. It predates raw-MIDI Basic fallback and the identity API; that probe is
not current-source import, analyzer, browser or acceptance evidence. Fresh hosted
CI must verify the visible picker routes the new fixture to Basic and executes
all four Basic cases plus the separate canonical negative case at both heights.
