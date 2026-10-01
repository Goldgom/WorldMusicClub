# Optional offline staff engraving

WorldMusicHub uses the open-source **OpenSheetMusicDisplay (OSMD) 2.1.3** renderer for its supported-score default staff view, with an explicit simplified pitch-guide fallback. OSMD uses VexFlow for professional staff layout. This is a presentation adapter: Rust remains authoritative for score validation, exact rational durations, repeat/tie timing, playback, input assessment and export. Jianpu remains the separate WorldMusicHub view. No OSMD paid player, transpose plugin, Jianpu plugin, audio service, remote score loader or hosted font is included.

An unbuilt checkout does **not** have the professional renderer available. Keep the clearly labelled basic pitch view usable when assets are absent, the score exceeds limits, or engraving fails. An OSMD preview is not a claim of lossless recovery of the uploaded notation: canonical exports infer rhythmic spelling/clefs and surface their own diagnostics.

## Build and distribution

The exact npm development dependency is `opensheetmusicdisplay: "2.1.3"`. Commit the npm lockfile. Build with:

```sh
npm ci --ignore-scripts --omit=optional
node scripts/prepare-engraving.mjs
node --test tests/engraving.test.js tests/engraving-assets.test.js
# After a Rust build and an available Playwright Chromium:
npm run test:engraving-browser
```

`--omit=optional` avoids the unused native GL dependency. OSMD itself must be a development dependency, not an optional dependency, for that command. The preparation script runs no downloads, installers, third-party code or lifecycle scripts. It checks the package version and the pre-reviewed bundle SHA-256 before copying. A changed package, unexpected license/dependency, missing notice, or changed bundle fails the build. Update the pin/hash only after a fresh API/security/license review.

The generated `web/vendor/` directory is a build output and must be ignored by Git. Ship these files together in the local/static release:

| Asset | Size with the reviewed lockfile | Purpose |
| --- | ---: | --- |
| `opensheetmusicdisplay.min.js` | 1,328,421 bytes | Self-contained UMD runtime, copied without modification |
| `opensheetmusicdisplay.min.js.LICENSE.txt` | 26,481 bytes | Aggregate licenses, authors and supplementary notices |
| `OSMD-LICENSE.txt` | 1,456 bytes | Original BSD-3-Clause license |
| `OSMD-AUTHORS.txt` | 614 bytes | Original OSMD contributor notice |
| `engraving-manifest.json` | Generated | SHA-256/size inventory and notice-component provenance |

The npm package references an adjacent `.LICENSE.txt` which it does not actually ship. Preparation reconstructs that distribution material from the root license/authors and the conservative, installed dependency closure: OSMD, VexFlow, JSZip, loglevel, typescript-collections, JSZip dependencies, and VexFlow type notices. It also carries pako's separate **zlib** source-header licenses and Gonville embedded-font provenance. JSZip is dual-licensed; this distribution elects its **MIT** option. Installed versions in the notice manifest identify the license-text sources, not a reconstructed webpack-module SBOM. Unused native GL/dev/build dependencies are not included in the web bundle or notices. Do not strip the bundle's license banner or redistribute the JS without its adjacent notice file. Link the aggregate notice file from the app's third-party/about area.

Reviewed bundle SHA-256: `099b2125aef055ca4faae75957037404973f9451544b52d9b3a0b1f788b33581`

Prepare before packaging the web directory or compiling a release that embeds assets. The static server must serve nested `/vendor/` files and `engraving.js` with the correct JS MIME type. No `<script>` change in the HTML is required: the adapter lazily loads the fixed sibling vendor path and validates it with SRI.

## Frontend contract

```js
import {renderEngravedStaff, disposeEngravedStaff} from './engraving.js';

// exported is Rust /api/export/musicxml's {xml, diagnostics, part_id_map} response.
// A canonical part ID is NOT the same as the generated MusicXML P1/P2 identifier.
const selectedXmlId = selectedCanonicalPartId
  ? exported.part_id_map[selectedCanonicalPartId] : null;
const rendered = await renderEngravedStaff(container, exported.xml, {
  dark: false,
  fromMeasure: 1,
  toMeasure: Math.min(32, numberOfExportedMeasures),
  partIds: selectedXmlId ? [selectedXmlId] : null,
  zoom: 1,
  responsive: true,
  onError: failure => showBasicViewWithReason(failure.message),
}, abortController.signal);
if (!rendered.ok && rendered.status !== 'cancelled') {
  showBasicViewWithReason(rendered.message);
}
// Switching notation views, closing the score, replacing the container, or unmounting:
disposeEngravedStaff(container); // or rendered.dispose(); both are idempotent
```

Only an **XML string** is accepted. URL strings, Blobs, MXL archives and arbitrary remote assets are rejected. Internally the validated XML is parsed into a `Document` and passed to `osmd.load(document)`, deliberately bypassing OSMD's automatic URL interpretation of short strings. Imported source is never inserted as HTML.

The promise resolves with `{ok, status, message, metadata, dispose, resize}`:

- `ready`: an actual SVG exists in the container
- `unavailable`: missing/failed vendor asset, wrong runtime version, or no XML parser
- `unsupported`: unsupported resources/features or a deliberate safety limit
- `invalid`: malformed XML, invalid part selection/options, or an invalid range
- `error`: OSMD load/render failed or produced no SVG
- `cancelled`: abort or a newer render superseded the request; do not overwrite the new view with fallback

Successful metadata is `{noteCount, measureCount, partIds, fromMeasure, toMeasure}`. `partIds` lists the XML IDs present in the input. `resize()` rerenders only when width changes, returning false after disposal or an error. `onError` is optional and is called on a later resize failure so the UI can restore its basic view. Initial failures are returned normally.

### Parts, pages, responsiveness and playback

- `partIds` is `null`/omitted for all parts, or a nonempty unique list of **MusicXML** IDs. Parts are hidden through OSMD `Instrument.Visible`; XML and Rust scoring data are unchanged
- `fromMeasure`/`toMeasure` are inclusive **one-based source ordinals**, counting an initial pickup. They are not printed MusicXML measure labels or quarter-note beats. The pinned adapter resets OSMD's pickup-number correction and sets source indexes explicitly
- Omitted range defaults to the first 32 measures, or 32 starting at `fromMeasure`. No request is silently clamped: explicitly exceeding the score or requesting over 64 measures returns a reason
- This is an endless-height, width-responsive engraving of a measure window, not print-paper pagination. The caller owns Previous/Next controls and their labels. Never reuse basic-view beat windows as measure indexes
- `zoom` is 0.5–2. Container width is bounded to 320–4096 px. Optional `width` fixes that width and disables automatic observation. Narrower viewports should permit horizontal scrolling
- `autoResize` and OSMD cursor/following are disabled. A single adapter-owned `ResizeObserver` coalesces width changes. It and pending animation frames are disconnected on replacement/disposal; no global resize listener is registered
- Render calls supersede earlier calls for the same container. The adapter checks generation/cancellation after asynchronous work and never lets late loads overwrite a newer view. The caller must also guard its own earlier asynchronous Rust export requests before calling this adapter
- The adapter renders a static measure window and does not use OSMD playback, cursor synchronization or per-note hit highlighting. The application can explicitly follow Rust source-measure/repeat occurrences by changing that window at page boundaries; manual navigation suspends following. This does not reschedule audio or trigger a full render on each animation frame. Practice timing remains Rust-derived

## Safety and bounded support

Preflight checks the entire document, including hidden parts and measures outside the displayed window. Limits: 8 MiB UTF-8 XML, 2,000 note/rest elements, 50,000 XML elements, nesting depth 32, 16 parts, 512 measures per part and 64 displayed measures per call. Text/attributes and numerical layout inputs are also bounded. Up to 8 staves per part, divisions up to 1,000,000, and tuplet ratios up to 128 are accepted; more unusual exact exports can still be downloaded but may require the basic view. Tuplet/resource-limit rejection must be shown explicitly.

DTD/entity declarations, processing instructions other than the XML declaration, active attributes, links/images/foreign namespaces and unrecognized elements are rejected. Ordinary score-partwise notes, rests, chords, multiple voices/staves, ties, clefs, key/time signatures and standard directions go through the real OSMD engine; no pitch-only drawing is presented as staff engraving. The pinned OSMD reader applies `parseInt` to `<voice>` values. The adapter rejects non-positive-integer voice IDs explicitly rather than allowing string labels to merge; the Rust exporter supplies deterministic integer lane IDs and `voice_id_map` metadata while preserving canonical voice labels. Preflight is a safety/shape gate, not a second score validator. Always obtain this XML from the canonical Rust exporter and show its diagnostics.

OSMD's layout is synchronous once called, so abort cannot interrupt a render already executing on the JS main thread. Caps bound input complexity but are not a time/memory guarantee. Slicing a measure range does not bypass the full-score cap. Use a smaller exported score or the basic view for large inputs; do not disable caps to make a large score appear supported.

The adapter requests only its bundled same-origin JS. It needs no remote `connect-src`, CDN, font URL or `unsafe-eval`. Current server policy (`script-src 'self'`, existing `style-src 'self' 'unsafe-inline'`) is sufficient. Keep `object-src 'none'` and `base-uri 'none'`. OSMD/VexFlow glyphs are inline paths; text uses local/system fonts. Do not add a URL-loading fallback on a bundle error.

## Verification and source references

`tests/engraving.test.js` uses small DOM/OSMD doubles to cover preflight caps, malicious resource inputs, part/range options, missing assets, retry/deduplication, cancellation, out-of-order resolution, responsive cleanup and renderer errors. These tests **do not verify actual glyph rendering or browser layout**. `tests/engraving-assets.test.js` verifies the real pinned npm bundle, checksums and generated notices without running it.

Real browser CI must prepare the vendor assets, render the Rust-exported original fixtures, assert SVG staff paths/measure content, exercise multi-voice/two-staff/tie/key/time cases, initial pickups and paging, change themes/width, and verify that network requests stay local. Local browser execution was blocked in the implementation environment and was not retried through an alternate route. Hosted real-browser acceptance later passed on the exact [commit91 workflow](https://github.com/Goldgom/WorldMusicHub/actions/runs/36811215258), including complete D768 multi-staff SVG, both pages, light/dark display, range gates and source-aware following. These hosted checks are distinct from local browser execution or physical MIDI/audio acceptance.

Primary sources consulted 2026-09-30:

- [Official npm registry metadata](https://registry.npmjs.org/opensheetmusicdisplay/2.1.3) and the installed 2.1.3 package's declarations/source bundle
- [OSMD API](https://opensheetmusicdisplay.github.io/classdoc/classes/OpenSheetMusicDisplay.html) and [render options](https://opensheetmusicdisplay.github.io/classdoc/interfaces/IOSMDOptions.html)
- [Official getting-started guide](https://github.com/opensheetmusicdisplay/opensheetmusicdisplay/wiki/Getting-Started)
- [OSMD source and license](https://github.com/opensheetmusicdisplay/opensheetmusicdisplay)
- License files in the installed VexFlow, JSZip, pako and other named dependency packages are copied by preparation rather than paraphrased
