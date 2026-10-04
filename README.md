# WorldMusicHub

A local-first music practice and rhythm-game project with a Rust score engine.

[中文上手指南](docs/QUICKSTART.zh-CN.md) · [完整曲包格式](docs/SONG_PACKAGE_FORMAT.md) · [Accepted Windows recovery 155](docs/releases/0.2.0-alpha.1-commit-155.md) · [Newer source changes](docs/releases/unreleased.md)

## Current alpha

- One versioned score model preserving exact note timing, spelling, voices, staves, ties, meter, keys and source provenance
- Derived staff notation, numbered jianpu and repeat-expanded performance views
- Piano and guitar practice; configurable keyboard ranges; playable exercises and falling-note guidance
- Optional MIDI input and explainable timing/pitch feedback
- Independent free practice with optional sound, explicit recording saves, backups and descriptive A/B comparison
- Configurable 47-key PC input, separate performed-input transposition and a shared Chinese/English display preference
- Bounded MusicXML/MXL, MIDI and numbered-text import; a limited local printed-staff image aid with mandatory manual correction
- Offline staff engraving, local saved-score backups and exact monophonic numbered-text export

## Development

Install a current stable Rust toolchain from https://rust-lang.org/tools/install/. For the complete offline staff renderer, first run `npm ci --ignore-scripts --omit=optional` and `npm run prepare:engraving`, then `cargo run -p practice-server` and open the printed loopback URL. A Rust-only build keeps the basic pitch view, jianpu and practice engine available. Tests: `cargo test --workspace --all-targets` and `npm test`. See [engraving setup and verification](docs/ENGRAVING.md) and [canonical score v1](docs/SCORE_FORMAT.md).

The first shell is a portable Rust local server with a browser UI. It binds only to 127.0.0.1 and works without a cloud account. A native Windows wrapper can be added without moving music logic out of Rust.

The current source tree opens in a searchable song lobby and uses a landscape performance stage with falling notes, keyboard and optional notation. Settings, import, sources and results use secondary panels. Browsing previews preserves a paused take; starting another score is explicit. See [interface behavior](docs/GAME_UI.md). This redesign follows the accepted 108 snapshot and is not included in that older Windows ZIP.

For offline whole-corpus MIDI/VSQ conversion, run `cargo run -p score-core --bin clean-song-batch --locked -- INPUT_ROOT OUTPUT_RUN`. It creates clean two-file song folders plus separate per-song and batch reports, deduplicates exact sources, and continues through individual failures. See [batch conversion and independent reruns](docs/BATCH_CLEAN_CONVERSION.md).

Free practice and the expanded keyboard/language integration are newer source
features than the accepted 155 package. Runtime localization is still incremental;
the exact remaining surfaces are listed in [locale coverage](docs/I18N.md).

## Distribution and rights

WorldMusicHub code is MIT-licensed. Score, audio and other assets retain their individually recorded rights; the code license does not relicense third-party music. Bundled music includes newly authored exercises, two documented public-domain opening excerpts and one complete CC0 Schubert written-note practice edition with explicit expressive limitations, with provenance recorded in score metadata and [catalog rights](docs/CATALOG_RIGHTS.md). Do not add unlicensed commercial arrangements. A composition, score engraving, arrangement and recording can have different rights.

## Release policy

Each meaningful implementation increment is committed. Every 50 project commits triggers a Windows build/release checkpoint. Windows artifacts must be produced and smoke-tested on Windows CI before being called verified; a Linux build is not Windows verification. See `docs/ROADMAP.md`.

## Current product scope and image workflow

A limited local recognizer suggests note positions from one clean horizontal printed treble staff. You must correct and confirm every pitch and duration before it becomes playable. Handwritten music, complex notation and general PDFs are unsupported. The interface includes light/dark/system/custom themes. Saved-score copies are explicit and browser-local; export backups for durable records. See [current features and limits](docs/releases/0.2.0-alpha.1.md); the first alpha's historical guide remains in the releases folder.

## Windows builds

The [accepted 155 recovery](docs/releases/0.2.0-alpha.1-commit-155.md) includes notation-following and compact guitar display repairs, with exact source, ZIP checksum and native Windows evidence. The [published 119 preview](https://github.com/Goldgom/WorldMusicHub/releases/tag/v0.2.0-alpha.1-commit-119) remains a separate earlier build. Check `BUILD-INFO.json` to distinguish package contents from newer source features.

CI checks Rust on Linux and Windows. The Windows milestone workflow packages a portable executable at each 50-commit milestone, or when manually dispatched. See [Windows usage and verification boundaries](docs/WINDOWS.md). No Windows artifact has been verified merely because these workflow files exist.
