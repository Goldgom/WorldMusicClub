# Music Practice engineering

This project is separate from TokenBird. Keep changes inside this repository.

- Rust owns canonical score validation, performance timing, instrument adaptation diagnostics and scoring.
- Preserve original score sources and exact rational musical time. Never silently discard unsupported import features or claim PDF/image recognition is lossless.
- Only bundle original exercises or assets with verified compatible licenses and provenance.
- Code is MIT-licensed; keep third-party score/audio rights separate.
- Use meaningful tested incremental commits. Every 50 project commits is a Windows release milestone; do not split or fabricate commits to reach it.
- Run `cargo test --workspace` and `npm test` before committing affected changes. Use `cargo fmt --all --check` and `cargo clippy --workspace --all-targets -- -D warnings` when installed.
- Bind the prototype server to loopback only. Never enable shell execution from user content or remote connections.
- Do not commit secrets, build outputs, caches or dependencies. No publish/push without parent coordination.
