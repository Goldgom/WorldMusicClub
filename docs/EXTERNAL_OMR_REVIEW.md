# Optional external OMR draft and confirmation API

This bridge imports files produced separately by a locally installed Audiveris 5.11.0. It does not install or launch an engine, accept executable paths/arguments, upload images, or provide automatic image conversion. The app provides an explicit external-output review dialog with an optional original-image preview, paged note/rest editor, tempo/key editing and a complete-score JSON fallback. Direct image-to-engine job orchestration is still pending. The engine remains optional with separate AGPL licensing; the app stays MIT.

## Prepare an explicitly unreviewed draft

`POST /api/omr/audiveris-draft` accepts JSON:

    { "engine_version": "5.11.0", "output_format": "musicxml" | "mxl", "output_content": "..." }

Content is the complete UTF-8 XML string or standard base64 of the complete MXL file. Optional `original_image: { format: "png" | "jpeg", filename: null | string, base64: string }` attaches the original image bytes. The same bounded decoder validates PNG/JPEG and the 16-million-pixel cap; a filename is retained as a label, never used as a filesystem path. The bridge requires the supported software-version declaration; that declaration is not proof that a file is authentic. Only the exact known ProxyMusic 4.0.3 external header documented in [engine evaluation](OMR_ENGINE_REVIEW.md) may be removed from the parsed copy, and that normalization is visible. No other DTD acceptance or external resolution is enabled. Generic MusicXML/MXL import protections are unchanged. MXL uses the same bounded in-memory reader without filesystem extraction.

The result is `{ score, requires_review: true, confidence: null, normalizations, diagnostics }`, deliberately without a playback timeline. Source format `external-omr-draft` is reserved for this unreviewed state. Compilation/practice and octave adaptation refuse such a draft. It can be displayed or edited by a review client, but must not silently replace the current playable score. Unknown confidence must stay unknown.

## Confirm the edited canonical score

`POST /api/omr/confirm` accepts `{ score, confirmation }`. All confirmation fields must be freshly true after comparison against the original image:

- `notes_and_rests`
- `rhythm_and_voices`
- `ties_and_navigation`
- `key_and_meter`
- `tempo`
- `source_rights`

The full canonical score may contain explicit corrections to pitches, rests, rational timing, voices/staves, ties and maps. Normal Rust musical validation still applies; invalid timing or ties fail instead of being repaired silently. The review UI invalidates its checkboxes after an edit or source replacement, exposes the source warnings, and requires new confirmation before activating the returned compilation. Checkboxes record user attestations, not independently verified accuracy or legal clearance.

The retained draft record is revalidated, then source format becomes `external-omr-reviewed` and the confirmation categories are stored. Original engine output remains byte-exact, including the whole compressed MXL when supplied. Import warnings are labeled as applying **before manual correction**, so a missing-tempo warning is not incorrectly presented as the edited current tempo. The reviewed result is still subject to normal instrument/physical-target checks.

The complete retained score must fit 8 MiB; sources are never stripped to fit. The JSON backup preserves the engine output and review record. An explicitly attached original image is retained byte-for-byte in that JSON package; if none is supplied, keep it separately. A richer image-overlay correction interface and direct engine job orchestration are still pending. MusicXML/jianpu exports do not replace that complete backup. This first bridge does not claim broad automatic or out-of-box OMR completion.

## Original-fixture acceptance evidence

The actual Audiveris outputs from the two original high-DPI fixtures were passed through this API as complete MXL files. Both stayed unplayable/unadaptable before review. Explicit fixture corrections fixed the melody's tempo/key metadata and the duet's tempo/key maps, two misplaced note onsets and voice assignments. After those known corrections, all compared written/sounding/timing/map metrics matched ground truth; the original MXL bytes were retained exactly. This proves the correction/retention path for these fixtures, not improved automatic recognition or unknown-score accuracy.

`tests/fixtures/audiveris-original-*.musicxml` are those original-score recognition outputs with only private source-path labels replaced and an explanatory XML comment added. They deliberately retain musical errors. The full original engine files/hashes remain distinct in the evaluation report. They contain no commercial score or redistributed scanned edition.
