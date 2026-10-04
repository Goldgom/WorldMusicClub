# WorldMusicClub on Windows

New browser packages use `WorldMusicClub-Windows-x64-*.zip` and `WorldMusicClub.exe`. Older WorldMusicHub packages retain their original filenames; use the executable actually included in that ZIP. See [name and data compatibility](BRAND_COMPATIBILITY.md).

中文用户可阅读安装包内的 `docs/QUICKSTART.zh-CN.md`。

The initial distribution targets Windows 10/11 x64 and is a portable Rust executable with its UI embedded inside it. The Windows build requests static C-runtime linkage to reduce separate runtime-installation requirements.

1. Extract the entire ZIP to a normal folder.
2. Double-click `WorldMusicClub.exe`.
3. It opens your default browser at `http://127.0.0.1:7878`.
4. Keep the console window open while practicing. Close it to stop the app.

Use `WorldMusicClub.exe --version` to report the application version without opening a browser or starting a server; `--help`/`-h` shows startup options. Unknown options, missing/invalid ports and duplicate `--port` values exit with code 2 instead of silently starting an unexpected instance.

If port 7878 is in use, run `WorldMusicClub.exe --port 7879`. `--no-open` disables automatically opening a browser. The app only listens on loopback; no account or network service is required for exercises and score imports. The interface is browser-rendered, rather than a fully native Windows widget interface.

## Trust and verification

Early builds are unsigned. They may trigger reputation warnings. Do not bypass a browser or operating-system security warning blindly. Review the official repository, workflow and SHA256 artifact; signing is a future distribution step.

CI tests the Rust engine and actually starts the Windows executable, requests its health endpoint and verifies embedded UI delivery. This is not a substitute for physical MIDI hardware, speaker latency, Web MIDI permissions or a Windows visual/audio acceptance test.

Every 50 meaningful development-branch commits is a release-build milestone. A manually triggered workflow can produce an earlier preview build. Artifacts are available in the corresponding GitHub Actions run. A milestone is not verified until that exact workflow passes.

## Distribution notices

Keep the `licenses` and `catalog` folders with redistributed ZIP packages. The catalog contains separately licensed CC0 score sources/provenance and explicit expressive limitations. It includes offline engraving notices, the locked Cargo dependency inventory, and the Rust standard-library copyright/license collection from the exact build toolchain. The conservative inventory includes build-time and target-specific packages and does not imply that every listed component is linked into the executable. The code license does not relicense imported songs, score images, or third-party assets.

Build preparation uses `python scripts/prepare-rust-notices.py` after `cargo fetch --locked`. It reads installed official registry packages, verifies version-pinned upstream fallback notices where crates omit them, and fails on unknown license expressions or missing notices. Zune image components use their Zlib option. Generated notices stay out of Git and are recreated for each release.

## Exact build provenance and ZIP checks

`BUILD-INFO.json` records the development-branch commit SHA/tree, complete-history commit count, target, application/schema versions, toolchain, lockfile hashes and every packaged file's SHA-256. Each curated edition also records canonical-score, retained-source and license digests. `SHA256.txt` uses portable relative filenames; the download also includes a checksum for the ZIP itself. These checks identify bytes and provenance, not a digital signature or antivirus verdict.

The milestone workflow checks out the exact SHA measured by its counting job, builds and runs the Windows x64 executable, exercises the real browser UI, creates the ZIP, verifies its complete inventory, then starts the extracted executable from its portable folder and compares its embedded offline renderer against the pinned bundle checksum. It also compares the actual executable's version/schema and every embedded curated source envelope with the separately packaged edition and license. A successfully skipped count gate is not a verified release. GitHub release/tag publication is a separate step tied to the same verified SHA.

## Explicit recovery builds

A milestone artifact remains tied to its original commit and is never replaced with different source under the same SHA. A later trusted development-branch push can explicitly request a recovery build with one commit-message trailer, `Windows-Recovery-For: 50` (or the applicable preceding multiple of 50). The gate accepts it only after that milestone and before the next one; malformed, duplicate, future and wrong-interval trailers fail. Ordinary intervening commits do not start a package build. No commit text is evaluated as shell code.

Recovery ZIP/artifact names include both the actual source count and `recovery-for-50`; `BUILD-INFO.json` keeps the actual SHA/tree/count plus a separate `recovery_for` field. It is a new build, not a claim of binary equivalence or a rewritten test result for the original milestone. The normal 50/100/150 cadence is unchanged.
