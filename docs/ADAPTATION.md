# Reversible octave-copy contract

Status: Rust API with a user-facing preview/confirmation dialog. Whole-score or current-part scope, range diagnostics and restore are explicit actions; closing the dialog or changing score/profile/scope invalidates pending previews. The original arrangement remains unchanged until a copy is explicitly activated. Browser acceptance is tracked against the corresponding CI commit.

## Preview

`POST /api/adaptation/preview` accepts `{ score, operation: { part_id: null | string, octaves: integer }, profile }`. `profile` is the existing piano/guitar instrument profile. `null` selects every part; a part ID selects that entire part. A nonzero shift from −8 to +8 octaves is explicit. Any pitch outside MIDI 0–127 rejects the whole operation. A scope without pitched notes is refused.

The response contains `compilation`, `operation`, `changed_note_count`, `original_preserved`, `instrument_report` and `scored_mode_allowed`. The compilation holds the complete derivative and all parts. The instrument report/scored-mode check applies to the selected part or all parts, and must be recalculated if that selection or profile changes. An out-of-range or impossible-string arrangement can still be previewed/listened to/exported; it must not activate scored mode. Pitch compatibility is not validated guitar fingering, hand reach, sustained-note independence or release grading.

Every selected pitched note moves by exactly the same octave count. Spelling/accidentals, rational onset/duration, rests, velocity, voice/staff, ties, tempo/key/meter, navigation and all unselected parts remain unchanged. There is no independent pitch folding, dropping, simplifying or automatic search for a supposedly playable arrangement. Score ID/title mark the copy, while source-note IDs remain stable. Explicit confirmation is required in any future client before activating or saving it.

## Original retention and restore

The derivative's `source.format` is `octave-adaptation`. Its `source.content` is a versioned JSON envelope with the operation and full original canonical score, including its unchanged original source string, metadata and provenance. The original object passed to the API is not mutated. Rights are carried over as claims, not newly established permission to arrange a work.

The complete derivative must fit the existing 8 MiB JSON boundary. Large sources are refused rather than stripped. Nested adaptation is refused; restore the original before choosing another shift. The derivative's ID/title must also satisfy normal limits, so exceptionally long original names can require a shorter named copy first.

`POST /api/adaptation/restore` accepts the adapted score and returns the original compilation. The engine reconstructs the recorded transformation and compares the complete derivative, including its retention record. Later edits cause an explicit refusal instead of silently discarding them. Save/export later edits before recovering the original separately. This is a consistency check, not a cryptographic signature or proof that a third-party record is authentic.

Normal JSON export/library backups preserve the envelope. MusicXML/jianpu exports describe the derivative and are not a substitute for its reversible JSON package. The original remains available only when that package is retained. Roundtrip tests cover exact original source bytes, double accidentals, rests, selected parts, tied rational segments/repeats, range failures and the retention size bound.
