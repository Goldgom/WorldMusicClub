# WorldMusicHub on Windows

The initial distribution is a portable Rust executable with its UI embedded inside it.

1. Extract the entire ZIP to a normal folder.
2. Double-click `WorldMusicHub.exe`.
3. It opens your default browser at `http://127.0.0.1:7878`.
4. Keep the console window open while practicing. Close it to stop the app.

If port 7878 is in use, run `WorldMusicHub.exe --port 7879`. `--no-open` disables automatically opening a browser. The app only listens on loopback; no account or network service is required for exercises and score imports. The interface is browser-rendered, rather than a fully native Windows widget interface.

## Trust and verification

Early builds are unsigned. They may trigger reputation warnings. Do not bypass a browser or operating-system security warning blindly. Review the official repository, workflow and SHA256 artifact; signing is a future distribution step.

CI tests the Rust engine and actually starts the Windows executable, requests its health endpoint and verifies embedded UI delivery. This is not a substitute for physical MIDI hardware, speaker latency, Web MIDI permissions or a Windows visual/audio acceptance test.

Every 50 meaningful development-branch commits is a release-build milestone. A manually triggered workflow can produce an earlier preview build. Artifacts are available in the corresponding GitHub Actions run. A milestone is not verified until that exact workflow passes.

## Distribution notices

Keep the `licenses` folder with redistributed ZIP packages. It includes offline engraving notices, the locked Cargo dependency inventory, and the Rust standard-library copyright/license collection from the exact build toolchain. The conservative inventory includes build-time and target-specific packages and does not imply that every listed component is linked into the executable. The code license does not relicense imported songs, score images, or third-party assets.

Build preparation uses `python scripts/prepare-rust-notices.py` after `cargo fetch --locked`. It reads installed official registry packages, verifies version-pinned upstream fallback notices where crates omit them, and fails on unknown license expressions or missing notices. Zune image components use their Zlib option. Generated notices stay out of Git and are recreated for each release.
