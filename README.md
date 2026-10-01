# WorldMusicHub

A local-first music practice and rhythm-game project with a Rust score engine.

[中文上手指南](docs/QUICKSTART.zh-CN.md) · [Alpha features and limits](docs/releases/0.1.0-alpha.1.md)

## Current alpha

- One versioned score model preserving exact note timing, spelling, voices, staves, ties, meter, keys and source provenance
- Derived staff notation, numbered jianpu and repeat-expanded performance views
- Piano and guitar practice; configurable keyboard ranges; playable exercises and falling-note guidance
- Optional MIDI input and explainable timing/pitch feedback
- Bounded MusicXML/MXL, MIDI and numbered-text import; a limited local printed-staff image aid with mandatory manual correction
- Offline staff engraving, local saved-score backups and exact monophonic numbered-text export

## Development

Install a current stable Rust toolchain from https://rust-lang.org/tools/install/. For the complete offline staff renderer, first run `npm ci --ignore-scripts --omit=optional` and `npm run prepare:engraving`, then `cargo run -p practice-server` and open the printed loopback URL. A Rust-only build keeps the basic pitch view, jianpu and practice engine available. Tests: `cargo test --workspace --all-targets` and `npm test`. See [engraving setup and verification](docs/ENGRAVING.md) and [canonical score v1](docs/SCORE_FORMAT.md).

The first shell is a portable Rust local server with a browser UI. It binds only to 127.0.0.1 and works without a cloud account. A native Windows wrapper can be added without moving music logic out of Rust.

## Distribution and rights

WorldMusicHub code is MIT-licensed. Score, audio and other assets retain their individually recorded rights; the code license does not relicense third-party music. Bundled music includes newly authored exercises, two documented public-domain opening excerpts and one complete CC0 Schubert written-note practice edition with explicit expressive limitations, with provenance recorded in score metadata and [catalog rights](docs/CATALOG_RIGHTS.md). Do not add unlicensed commercial arrangements. A composition, score engraving, arrangement and recording can have different rights.

## Release policy

Each meaningful implementation increment is committed. Every 50 project commits triggers a Windows build/release checkpoint. Windows artifacts must be produced and smoke-tested on Windows CI before being called verified; a Linux build is not Windows verification. See `docs/ROADMAP.md`.

## Current product scope and image workflow

A limited local recognizer suggests note positions from one clean horizontal printed treble staff. You must correct and confirm every pitch and duration before it becomes playable. Handwritten music, complex notation and general PDFs are unsupported. The interface includes light/dark/system/custom themes. Saved-score copies are explicit and browser-local; export backups for durable records. See [the first alpha's features and limits](docs/releases/0.1.0-alpha.1.md).

## Windows builds

CI checks Rust on Linux and Windows. The Windows milestone workflow packages a portable executable at each 50-commit milestone, or when manually dispatched. See [Windows usage and verification boundaries](docs/WINDOWS.md). No Windows artifact has been verified merely because these workflow files exist.
