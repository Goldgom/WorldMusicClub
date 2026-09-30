# WorldMusicHub

A local-first music practice and rhythm-game project with a Rust score engine.

## Intended foundation

- One versioned score model preserving exact note timing, spelling, voices, staves, ties, meter, keys and source provenance
- Derived staff notation, numbered jianpu and repeat-expanded performance views
- Piano and guitar practice; configurable keyboard ranges; playable exercises and falling-note guidance
- Optional MIDI input and explainable timing/pitch feedback
- Rich MusicXML interchange first; MIDI as a performance format; PDF/image recognition is a future assisted import, not a lossless promise

## Development

Install a current stable Rust toolchain from https://rust-lang.org/tools/install/. Run `cargo run -p practice-server` and open the loopback URL printed by the app. Tests: `cargo test --workspace`; browser tests and frontend setup will be documented as implemented.

The first shell is a portable Rust local server with a browser UI. It binds only to 127.0.0.1 and works without a cloud account. A native Windows wrapper can be added without moving music logic out of Rust.

## Distribution and rights

WorldMusicHub code is MIT-licensed. Score, audio and other assets retain their individually recorded rights; the code license does not relicense third-party music. Bundled practice exercises are newly authored for this project, with provenance recorded in their score metadata. Do not add unlicensed commercial arrangements. A composition, score engraving, arrangement and recording can have different rights.

## Release policy

Each meaningful implementation increment is committed. Every 50 project commits triggers a Windows build/release checkpoint. Windows artifacts must be produced and smoke-tested on Windows CI before being called verified; a Linux build is not Windows verification. See `docs/ROADMAP.md`.
