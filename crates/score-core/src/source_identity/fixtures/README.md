# Original GM identity fixtures

The 38 MIDI files and cases.json were newly authored as mechanical source-event
examples, not songs or copied transcriptions. Fixture bytes and case descriptions
are offered under CC0-1.0. Each manifest SHA-256 binds one complete SMF.

The manifest records expected outcomes, not passed results. The Rust test module
executes its 49 attack assertions and checks source bindings when run. Rust tests,
compilation, formatting and acceptance have not been run in the recovery workspace
because its Rust toolchain is unavailable. Do not interpret the authored manifest
as validation evidence.

The source-identity API is Basic-only and informational. Unknown identity does not
change existing raw MIDI-key practice; known unsupported instruments do not grant
adaptation. No application, renderer, policy gate, canonical importer, runtime,
Mod, scoring, or native persistence integration is included.
