# Canonical actual-application acceptance

The focused workflow `.github/workflows/canonical-practice-preview.yml` uses one self-authored CC0 four-part exercise as canonical JSON and equivalent MusicXML. It is separate from the earlier engine-only canonical PCM probe and from release promotion.

The shared renderer `crates/desktop-shell/canonical-practice-acceptance.js` runs in both hosted Chromium and the actual Windows app. It calls existing owned picker, pointer, select and Digit2 actions. Three closed numeric actions type only 2 into loop-from, 6 into loop-to and 90 into tempo in the canonical controls phase. They accept no text or key payload. The actual field type, focus, value, trusted input/change events and zero music capture are retained.

Three bounded phases keep each process below64 actions and1MiB renderer evidence:

- Seed: original JSON picker/persistence; multi, all and one human selections; independent accompaniment; one trusted human key with positive live-tone PCM; acknowledged rapid pause/resume/pause; natural end/replay; full score and take exports
- Controls: full Listen; A/B beats2–6; repeated silent count-in; partial native slider seek; tempo90 and explicit +1 semitone copy preserve the two-part human selection
- Restart: separate native process reopens exact stored JSON; imports equivalent MusicXML through the real picker; full Listen and legacy selected-part Listen; exact imported IDs, ties, source bytes and JSON exports

The verifier binds canonical source, compilation, selection and plan fingerprints to consumed Rust results. It checks every retained processor note gate, original tie IDs, real trusted MessagePort receipts, destination-connected source/live PCM, single human capture and zero machine inputs. Range ledgers retain used entries and verify all omitted capacity is the original unused zero-filled sentinel. Source files and disk backups are checked byte-for-byte. Windows proof also binds process, shared profile, native click/key ownership, measured screenshots and executable hash.

Native packaging retains the complete bound canonical proof once, under `evidence/canonical-practice/`, through the manifest adapter. Flattened copies of the same reports in `evidence/` are rejected even when their bytes match. Package inventory errors identify missing files, extra files or an extra directory; all source, executable, proof and retained-file hashes remain required.

Local `npm run test:canonical-practice-acceptance` is a contract gate. `npm run test:canonical-practice-native` requires an explicit source-built WMH_NATIVE_IMPORT_DRIVER and runs Rust stdin plus the production app/DSP under a DOM harness. Neither is browser, Windows, physical listening or full release acceptance. The hosted runner refuses execution outside authorized GitHub Actions and requires the exact clean source SHA. The workflow publishes no release and uses no user-provided music.
