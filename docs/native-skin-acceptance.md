# Native skin persistence preparation

This is a bounded Windows acceptance scenario, not a record of a completed
Windows run. Node tests cover contracts and the production app DOM driver only.
The existing desktop acceptance host supplies all real Windows pointer events,
file dialogs, screenshots, normal process closes and profile ownership records.

After registration, run the frozen executable with:

```powershell
./scripts/windows-desktop-acceptance.ps1 -Executable <exact-built-exe> -Scenario skin -OutputDirectory <fresh-owned-directory>
```

The focused `native-skin.yml` workflow builds and verifies the same three
phases, retaining failure evidence and the executable while excluding profiles.
The workflow runs only on the dedicated `preview/native-skin` branch or an explicit
dispatch. Merely preparing these files does not produce native acceptance evidence.

The three ordered phases use one test-owned profile at
`webview-profiles/skin-seed`. Only the first launch may create it. Each subsequent
launch requires the original host profile record; the final launch additionally
requires the reset phase's host record. All three processes must close normally.

1. `skin-seed` imports the original score through the existing score picker,
   starts its public Human/Machine Mod configuration, captures one real KeyR
   input and pauses. It imports the original skin manifest and procedural PNG
   through Settings' public file controls and exercises “Use selected skin”.
2. `skin-restart` reads the imported selection and exact stored manifest/PNG
   before any skin change. “Reset to built-in appearance” must retain the slot.
3. `skin-default-restart` must restore default appearance with that exact imported
   slot still available, without importing or selecting a replacement.

Each phase exports the source and entire paused take before and after the skin
round, with Settings closed before opening sibling export panels. Source and all
musical take fields must be identical. Seed retains exactly one complete,
source-null blur boundary for each of its two owned native file dialogs. Each
boundary must have a continuous event ID and an application-clock timestamp
strictly inside that picker’s trusted click-to-input interval; the entire earlier evidence
prefix is unchanged. The two restart phases require full take equality.
Read-only observations also require unchanged stage geometry, key
nodes, paused clock, captured count and theme choice. Independent disk snapshots
retain the exact original source payload (including BOM/CRLF), canonical score,
metadata and backups throughout. The generator reuses
`tests/skin-browser-fixture.js`; it creates input artwork, never screenshots.

The verifier binds the frozen source tree and module hashes, independently reads
the actual executable's bytes, verifies trusted control/file gestures, host
profile identities, native picker results, raw screenshots and exported files,
then writes `native-skin-proof.json`. No profile contents are copied into the
evidence artifact. A copied storage state, fresh restart profile, forced process
close, changed manifest/PNG, source rewrite, resumed clock, lost take, an unrelated
blur boundary or any missing/extra native-picker boundary fails. Raw click traces
retain the score picker’s hidden-input delegation and the two exact seed Mod
select activations, including their trusted input/change and Enter-key receipts.

This scenario does not establish physical audibility, manual keyboard/MIDI device
coverage, continuous audio silence, full visual acceptance, full repository
acceptance, or release readiness. Those remain separate existing gates. Do not
publish, dispatch CI, label the Windows package accepted or promote this source
based only on these local Node tests.
