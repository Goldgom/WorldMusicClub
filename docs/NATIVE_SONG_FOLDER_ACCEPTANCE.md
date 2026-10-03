# Native song-folder acceptance

The persistent native score folder has a separate hosted Windows gate. The
existing four-process desktop acceptance remains required: its IndexedDB restart
and original typed-scoring, native download, and reference-listening proofs are
not filesystem evidence.

After building the exact source with the locked Windows toolchain, run:

```powershell
./scripts/windows-desktop-acceptance.ps1 -Executable target/release/worldmusichub-desktop.exe -OutputDirectory desktop-song-folder -Scenario song-folder
```

Use a fresh output directory. The process-owner smoke configuration selects only
`desktop-song-folder/Scores`; ordinary application folder resolution is unchanged.
Each of three independent EXE launches has a 240-second bound and at most 64
native actions. No renderer route accepts a filesystem path. Prior generated
WebView profiles are moved aside between launches; they are not deleted or
included in the evidence upload.

- `folder-seed` uses the actual owned Windows file chooser to import the newly
  authored original JSON fixture, waits for its save result, checks duplicate
  handling, imports the same-ID changed edition, explicitly chooses Keep both,
  and checks native cancellation and malformed import without another write
- `folder-restart` begins with an absent profile directory and renderer marker,
  reads the same disk entries, selects and auditions a saved row, activates it,
  records a real native keyboard input, and compares downloaded score and take
  exports across library, menu, and free-practice navigation
- `folder-failure` begins with another fresh profile. The host replaces only the
  isolated empty staging directory with a test-owned regular file. Import must
  remain usable while reporting not saved and exposing Retry. Opening the
  browser score database is forbidden in every phase. The host restores the
  test-owned staging directory afterward

The host snapshots all published archive files after each normal process close.
The independent Node verifier requires two exact canonical fixture files,
matching metadata and original source payloads, byte-identical primary and backup
copies, unchanged snapshots across all three launches, native picker ownership
and dismissal, completed actual downloads, and unchanged routed typed scoring.
The fixtures are newly authored CC0 exercises; no user songs are used.

`native-song-folder.json` binds the run to the source commit, tree and executable
hash. `native-song-folder-files.json` binds the independent proof to that host
report, all renderer reports and inspected bytes. The native package manifest
requires both, runs the verifier again in read-only `--check` mode, and includes
the five folder reports separately from legacy acceptance. The hosted workflow
retains the authored archive and download evidence, never WebView profiles.

Node, Rust and Python tests of these assertions are synthetic contract tests.
They do not establish a Windows UI pass, audible output or physical MIDI behavior.
A package is accepted only after the actual hosted Windows scenario and all
existing release gates pass for its exact source and executable.
