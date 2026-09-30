# Original local OMR fixtures

These images are deterministic original geometric test data created for this project, covered by the repository's MIT license. No published score, scan, font, or external artwork was copied.

Run `python3 tests/fixtures/omr-generate-fixtures.py` to regenerate the three PNGs byte-for-byte using the Python standard library. The scale uses a single five-line staff at y = 70, 82, 94, 106, 118, spacing 12 pixels, and eight filled ellipse heads with attached stems at x = 100, 160, …, 520. Under an explicitly unverified treble-clef/natural-key assumption, the centers map to E4–E5. The fixture deliberately does not supply a clef, meter, key signature or rhythmic semantics. The other images exercise multiple-staff refusal and hollow-head rejection.

These fixtures establish that the local algorithm processes actual pixels. They are not evidence of accuracy on arbitrary printed scores, PDFs, handwriting, phone photos, chords, or engravings. Every result needs manual review. Unit tests also transcode the original fixture to JPEG and construct blank/transparent, malformed, and oversized-header cases.
