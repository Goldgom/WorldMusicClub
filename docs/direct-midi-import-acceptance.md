# Direct raw MIDI import regression

These fixtures are newly authored, isolated MIDI events released under CC0-1.0.
They contain no private recording, uploaded source, borrowed tune, or transcription.
The fixture generator and independent expected gates are in
`scripts/prepare-direct-midi-fixtures.mjs`.

## Defect represented

The primary format-0, 384-PPQ specimen has four note attacks. At tick 192,
a second attack of channel 1/key 60 appears before the preceding release at the
same tick. Strict canonical notation must continue rejecting the ambiguous
pairing. Direct native import instead saves an independently verified complete
Basic Keys package, with its named FIFO interpretation and every original event.
Two later keys prove that admission/playback did not retain only an early excerpt.
The final release is at 2,000 ms.

Companions cover a genuine overlapping gate, a format-1 source with metadata-only
and empty tracks, a legal MIDI key outside an 88-key piano's range, a canonical
non-overlapping control, malformed data, and a truncated declared track.

## Evidence levels

- `node --test tests/direct-midi-fixtures.test.js tests/direct-midi-proof.test.js`
  verifies the independently scanned original fixture bytes and adversarial
  evidence checks. These are pure unit tests
- `WMH_NATIVE_IMPORT_DRIVER=<exact-source-driver> WMH_DIRECT_MIDI_REPORT=<report.json> node scripts/check-direct-midi-native.mjs`
  exercises production app handlers in the Node DOM harness, real Rust native
  dispatch over stdin, isolated native storage, duplicate admission, metadata and
  event retention, range diagnostics, malformed/truncated rejection, a fresh
  native process, and full target replay. It creates no listener or GUI. DOM and
  audio here are modeled and do not count as real-browser/native-window proof
- `node scripts/hosted-midi-direct-import-check.mjs` is restricted to authorized
  hosted GitHub Actions with `GITHUB_ACTIONS=true`, `WMH_HOSTED_BROWSER=1`,
  `WMH_SOURCE_SHA` equal to clean HEAD, and `WMH_NATIVE_IMPORT_DRIVER` set to its
  source-built driver. `WMH_SERVER_BINARY` defaults to
  `target/debug/practice-server`; `WMH_ARTIFACT_DIR` chooses output;
  `WMH_VIEWPORT_HEIGHT` is 720 or 900

The hosted runner serves actual embedded assets from the exact-source Rust server.
Only owned-main-frame API requests enter the real socket-free native driver.
It uses actual chooser, Start, Mod, results, history and download controls. It
checks the original raw request hashes, default direct Start, all four scored
source targets, separate all-machine real AudioWorklet/MessagePort gates and
nonzero output PCM, honest invalid-file errors, a new native process and new
browser profile, and byte-for-byte original download after restart.

Hosted output is `report.json`, bounded original fixtures, screenshots, exported
takes and the downloaded original. Claims distinguish native filesystem from a
Windows native window. Neither Node nor hosted Chromium establishes physical
audio output or physical MIDI-device behavior. A release still requires all
repository full tests and the exact-source Windows/native acceptance gates.

## Registration

Append the two new pure tests to `scripts/pure-test-files.json` without reordering
its historical prefix. Register the stdio runner after the exact-source native
driver build, and run the hosted runner only in the authorized hosted workflow.
Do not substitute mocked save responses, a prebuilt package picker, inferred
canonical notes, or a direct hidden state mutation for the raw picker path.
