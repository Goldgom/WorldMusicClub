# Playback anchor follow-up

Integration base: `3697efd6d38c90ffec1ac7005fea78d22f641cdd`.

The first 526 fix clamped all pre-anchor clock reads. Integrated tests exposed that this removed the initial signed 50 ms lead used by PV admission and VSQ notation. Holding resumed reads also changes the legacy clean-song scheduler, which uses the signed projection to place source oscillators at the future anchor.

The corrected product change is limited to `Transport.pause()`: before the accepted start anchor, it keeps the existing stored source position; at or after the anchor, it saves the ordinary elapsed source position. Repeated Pause stays idempotent. `Transport.time()` again has its original signed behavior for initial start, resume, seek, count-in, media and notation. No app, media, renderer, recorder or scoring policy was changed.

## Evidence

- The two unchanged original initial-PV tests in `frontend-clean-song-app.test.js` and the unchanged signed `-50 ms` native-VSQ guard pass.
- The corrected clock regressions require signed initial and resumed lead-in, but prevent any pre-anchor Pause from saving that lead as source elapsed time. Nonzero/fractional seek, count-in, repeated Pause, exact loop wrapping and completed replay retain their original timing.
- Canonical, Basic and VSQ rapid Resume/Pause retain the saved 150 ms position. A pre-anchor key after the existing prior-segment tolerance expires adds no input; a key 10 ms after the accepted resume anchor is captured at 160 ms. Recorder segments keep the actual future accepted wall time.
- The source-follow seek test now covers both initial admission without count-in and an explicit count-in. It retains its before/at/after-zero note-identity checks.
- The JSON/MusicXML/Basic/VSQ native API matrix and Rust transpose/restore pass with the corrected application code and the reused 526 source-built stdio driver. This reuses unchanged native APIs; it is not a newly packaged 533 binary.
- A production-app media observation with the existing original clean-song fixture resumes at wall 1210 ms. New source oscillators remain scheduled at audio 260 ms, corresponding to accepted wall 1260 ms; the recorder starts at 1260 ms with source position 150 ms. Source-follow keeps the pre-anchor signed projection of 100 ms, and an immediate Pause restores the stored 150 ms position.

## Media boundary

That same observation records `PV.play()` at wall 1210 ms, before the resumed source anchor at 1260 ms. The existing media path permits playback when its projected position is nonnegative. This transport-only change does not make resumed PV wait for the anchor and does not establish physical video/audio synchronization. A separate app/media admission change would be needed to enforce that stronger behavior. No rendered video frames, browser, GUI or physical audio device were tested.

The retained 526 before/after JSON describes the earlier candidate and remains historical evidence. The integration lead owns full same-source npm/native/hosted/Windows acceptance; these are focused local checks.
