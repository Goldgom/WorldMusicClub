# Canonical format and producer compatibility

The per-note preservation promise requires refusal when a reader does not understand a file. A compatibility error does not mean that the original score is corrupted or that notes were removed.

## Versions have separate meanings

- `Score.version` is the major **musical model** contract. It remains 1. Changes that reinterpret musical fields, remove semantics, or require different playback meaning need an explicit model-version change and a tested, non-destructive migration.
- Schema revision 2 adds nonmusical `source.import_diagnostics` and optional `format_metadata`. The updated reader supports revisions 1–2 and legacy files with no revision/producer stamp. Earlier development files with recognized revision 2 fields but no stamp also remain readable.
- `format_metadata` contains `schema_revision`, `producer` and `producer_version`. New canonical records created/imported by this development series identify WorldMusicHub 0.2.0-alpha.1. It is **claimed origin metadata**, not musical authorship, rights, authenticity or a full editing history. The compiler does not overwrite or invent it for an existing record; reversible copies retain it and keep their operation/original separately.
- Application version, schema revision, Git commit count and release provenance are separate. Windows BUILD-INFO carries the exact build/commit/toolchain. Every 50-commit release cadence is unchanged.

## Alpha 54 and newer development files

The accepted milestone 50 recovery build at actual commit 54 is WorldMusicHub 0.1.0-alpha.1. Its strict reader predates these optional fields and may reject JSON written by the newer development branch. That historical binary cannot be patched retroactively. Keep the original file and open it with a newer compatible build; do not strip warning/producer fields to force loading. The next regular Windows milestone is 100.

The new reader reports unknown fields as potentially newer score metadata or an incompatible file, instead of describing them as corrupted notes. A future declared schema revision or musical-model version also gives an explicit compatibility error. Rejected input is never rewritten by parsing. Syntax errors are still reported separately as invalid JSON.

## Save, edit, migrate

Legacy notes/rests, pitches/spelling, exact beat fractions, voices/staves, ties, maps and original sources remain unchanged when read. New metadata is optional. Full canonical JSON and library backups carry retained observations and source records; MusicXML/jianpu exports are not complete substitutes for all application metadata.

Source-envelope versions are separate from the musical model. New MXL imports can use `source.format="worldmusichub-mxl-archive-v1"` to retain the complete archive and selected XML. The canonical source remains an opaque string, so an older compatible reader can preserve it without understanding its nested download entries. An unknown envelope version must remain downloadable whole rather than being guessed or normalized. Older MXL records containing only XML are left unchanged; missing archive bytes require the original input.

A future migration must preserve the original file/source alongside its derivative, declare every transformation or unsupported feature, test per-note/source identity and exact timing, and require an explicit choice where musical interpretation is needed. Unknown semantic fields must never be removed merely to pass validation. No irreversible in-place migration is performed by this alpha.

Producer strings are bounded descriptive claims supplied by a file. Never use them as proof of rights, trust, correctness or permission to execute anything. No timestamp, account identity, machine identifier or external credential is added to a canonical score.
