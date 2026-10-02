# Music Practice engineering

This project is separate from TokenBird. Keep changes inside this repository.

- Rust owns canonical score validation, performance timing, instrument adaptation diagnostics and scoring.
- Preserve original score sources and exact rational musical time. Never silently discard unsupported import features or claim PDF/image recognition is lossless.
- Only bundle original exercises or assets with verified compatible licenses and provenance.
- Code is MIT-licensed; keep third-party score/audio rights separate.
- Use meaningful tested incremental commits. Every 50 project commits is a Windows release milestone; do not split or fabricate commits to reach it.
- Development batches may use compilation, formatting and affected fast tests for intermediate commits, as explicitly requested on 2026-10-02. `npm run test:quick` reports deferred checks and is not acceptance.
- At each cohesive checkpoint, run the full `cargo test --workspace --all-targets --locked`, `npm test`, formatting/clippy, real-browser suites and Windows/native package acceptance before promoting that exact source to main or labeling a package accepted. Use a frozen `validation/**` branch or explicit full workflow dispatch. Never report quick-only or skipped checks as full success.
- Bind the prototype server to loopback only. Never enable shell execution from user content or remote connections.
- Do not commit secrets, build outputs, caches or dependencies. No publish/push without parent coordination.
