# Original song-authoring contract fixtures

These are original C/E/G MIDI exercises and exact JSON returned by the Rust
`practice_server::api_response` draft route. They contain no third-party score,
audio, private input, filesystem path or source-container attachment.

Generated from the built-in conversion API on 2026-10-04 without starting
a server. `strict` uses the complete
strict semantic profile; `event-only` contains independent events requiring
the event-preserving profile; `rejected` includes unsupported controller 2.
Every request carries the complete original MIDI as Base64 and every response
preserves the exact Rust metadata/score strings. These fixtures test the actual
API envelope and localized UI interpretation, not native persistence or browser
acceptance. Rust's own tests independently cover reprepare/ZIP/native roundtrip.
