# WorldMusicClub architecture

## Trust and data flow

A Rust executable owns score parsing, validation, tempo integration, tie consolidation, repeat expansion and assessment. It serves embedded frontend assets on `127.0.0.1`, never on an external network interface. Host and Origin checks reject cross-site requests; no CORS permissions are granted. Imported scores and images are processed on the local computer. There is no upload to an OMR cloud service.

The UI owns rendering, input capture and Web Audio scheduling. The compiled Rust timeline is authoritative for expected note onset/duration. Input timestamps are captured on the local transport clock and submitted to Rust for deterministic matching. Future native shells can reuse the engine without rewriting musical logic.

## Three distinct representations

1. Original source: exact imported MusicXML or reviewable image data with provenance. Never claim a partial importer preserves a lossless notation roundtrip merely because the original file is retained.
2. Canonical score: versioned rational beat timing, spelled pitch, staves/voices/rests/ties, meter/key/tempo and bounded repeat regions.
3. Performance timeline: sounding notes with floating-point milliseconds, unique occurrence ids and links to source note ids. Tied notational events remain in the source score but produce a single sounding target.

Staff and jianpu views share the canonical score. A simplified renderer cannot display all MusicXML engraving semantics. Preserve unsupported source content and show diagnostic warnings instead of silently pretending completeness.

## Security and resource limits

- 8 MiB request body limit; image review limits may be lower in the UI to leave room for base64 source retention
- 128 parts; 100,000 canonical and repeat-expanded sounding notes; 200,000 performance events
- Finite positive timing and supported pitch validation
- Explicit rejection of complex repeat navigation rather than unbounded traversal
- Embedded static asset allowlist; no arbitrary filesystem read route
- No command execution derived from score content
- Order-preserving sparse assessment matching maximizes matched onsets before minimizing total timing error. Dense coincident buckets and complete ordered takes use exact fast paths; an explicit candidate-edge budget rejects pathological ambiguity rather than returning a guessed score

## Native Windows path

The first deliverable is a portable Rust `.exe` opening a local browser interface. It embeds the UI and needs no application account. A Tauri/native wrapper may follow; browser rendering is a deliberate first shell, not a claim of native widget rendering.

Windows CI compiles, runs Rust tests and starts the actual Windows executable. A build passing is distinct from testing real MIDI devices, audio latency, accessibility settings or visual rendering on a user's Windows computer.

## Rights and dependencies

Application code is MIT-licensed. Original exercise provenance is explicit. Third-party composition, edition, arrangement, recording and sound-bank rights must be tracked separately. Commercial-song metadata and legal acquisition links can be shown without bundling unlicensed note data.

The local image recognizer is intentionally narrow and requires review. An optional external OMR adapter may be added, but no AGPL engine is silently included in the MIT executable. Audiveris integration would require an explicit distribution/license design.

### Image-open preflight

Before `Image.decode()`, the browser reads PNG IHDR or a supported 8-bit JPEG frame header and checks the same 16,384-axis/16-million-pixel bounds used by the Rust recognizer. The original file must also be below 5 MiB. Animated PNG is explicitly unsupported; export a still frame. A newer file selection invalidates older asynchronous header reads and decodes before they can replace the current review. The browser still validates/decodes the image; metadata preflight is not a complete image parser or an independently verified resource guarantee.

Header layout references: [W3C PNG 3](https://www.w3.org/TR/png-3/#11IHDR) and the [libjpeg-turbo marker reader](https://github.com/libjpeg-turbo/libjpeg-turbo/blob/main/src/jdmarker.c). Original images remain local and their retained source is exported with the reviewed fragment.
