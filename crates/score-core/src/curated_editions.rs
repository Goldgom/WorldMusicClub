//! Reviewed complete CC0 source editions, with retained original bytes and limits.
//! No network or converter is involved in startup or playback.
use crate::Score;

const SCHUBERT: &str =
    include_str!("../../../catalog/editions/cc0-schubert-wandrers-nachtlied-d768/score.json");
const BEETHOVEN: &str =
    include_str!("../../../catalog/editions/cc0-beethoven-gottes-macht-op48-5/score.json");

pub fn catalog() -> Vec<Score> {
    [SCHUBERT, BEETHOVEN]
        .into_iter()
        .map(|source| {
            serde_json::from_str(source).expect("committed reviewed edition must remain valid JSON")
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn full_edition_retains_all_written_events_and_ties_without_claiming_expression() {
        let score = catalog().remove(0);
        crate::validate(&score).unwrap();
        assert_eq!(score.measures.len(), 14);
        assert_eq!(
            score.parts.iter().map(|p| p.notes.len()).sum::<usize>(),
            334
        );
        assert_eq!(
            score
                .parts
                .iter()
                .flat_map(|p| &p.notes)
                .filter(|n| n.pitch.is_none())
                .count(),
            10
        );
        let compiled = crate::compile(score.clone()).unwrap();
        assert_eq!(compiled.timeline.notes.len(), 321);
        assert!((compiled.timeline.duration_ms - 87272.72727272728).abs() < 0.000001);
        assert!(compiled
            .diagnostics
            .iter()
            .any(|d| d.code == "written_note_practice_edition"));
        assert!(compiled
            .diagnostics
            .iter()
            .any(|d| d.code == "cross_lane_tie"));
        assert!(!compiled
            .diagnostics
            .iter()
            .any(|d| ["orphan_tie", "broken_tie", "unclosed_tie"].contains(&d.code.as_str())));
        assert_eq!(score.provenance.kind, "curated_cc0_edition");
        assert_eq!(score.provenance.license.as_deref(), Some("CC0-1.0"));
        let source = score.source.unwrap();
        let retained: serde_json::Value = serde_json::from_str(&source.content).unwrap();
        assert_eq!(
            retained["provenance"]["evaluation"]["expressive_performance_equivalent"],
            false
        );
        assert!(retained["files"]["original.mscx"]["content"]
            .as_str()
            .unwrap()
            .contains("OpenScore"));
        assert!(retained["files"]["converter.musicxml"]["content"]
            .as_str()
            .unwrap()
            .contains("<!DOCTYPE"));
        assert!(!retained["files"]["import.musicxml"]["content"]
            .as_str()
            .unwrap()
            .contains("<!DOCTYPE"));
    }

    #[test]
    fn canonical_music_matches_the_retained_conversion_without_silent_adaptation() {
        let score = catalog().remove(0);
        let retained: serde_json::Value =
            serde_json::from_str(&score.source.as_ref().unwrap().content).unwrap();
        let (original, _) = crate::import_musicxml(
            retained["files"]["import.musicxml"]["content"]
                .as_str()
                .unwrap(),
        )
        .unwrap();
        let mut actual = serde_json::to_value(&score).unwrap();
        let mut expected = serde_json::to_value(&original).unwrap();
        for key in ["id", "provenance", "source", "format_metadata"] {
            actual.as_object_mut().unwrap().remove(key);
            expected.as_object_mut().unwrap().remove(key);
        }
        assert_eq!(actual, expected);
        let compiled = crate::compile(score).unwrap();
        let range = |part: &str| {
            let notes: Vec<_> = compiled
                .timeline
                .notes
                .iter()
                .filter(|n| n.part_id == part)
                .map(|n| n.midi)
                .collect();
            (*notes.iter().min().unwrap(), *notes.iter().max().unwrap())
        };
        assert_eq!(range("P1"), (65, 77));
        assert_eq!(range("P2"), (29, 65));
    }

    #[test]
    fn beethoven_preserves_every_imported_event_and_declares_source_limits() {
        let score = catalog().remove(1);
        let archive: serde_json::Value =
            serde_json::from_str(&score.source.as_ref().unwrap().content).unwrap();
        let (imported, _) = crate::import_musicxml(
            archive["files"]["import.musicxml"]["content"]
                .as_str()
                .unwrap(),
        )
        .unwrap();
        let mut actual = serde_json::to_value(&score).unwrap();
        let mut expected = serde_json::to_value(&imported).unwrap();
        for key in ["id", "provenance", "source"] {
            actual.as_object_mut().unwrap().remove(key);
            expected.as_object_mut().unwrap().remove(key);
        }
        assert_eq!(actual, expected);
        assert_eq!(score.measures.len(), 18);
        let written: Vec<_> = score.parts.iter().flat_map(|part| &part.notes).collect();
        assert_eq!(written.len(), 226);
        assert_eq!(
            written.iter().filter(|note| note.pitch.is_none()).count(),
            22
        );
        assert_eq!(written.iter().filter(|note| note.tie_start).count(), 6);
        assert_eq!(written.iter().filter(|note| note.tie_stop).count(), 6);
        assert_eq!(score.keys[0].mode, "unknown");
        assert_eq!(score.keys[0].fifths, 0);
        assert_eq!(score.tempo[0].bpm, 140.);
        let observations = score
            .source
            .as_ref()
            .unwrap()
            .import_diagnostics
            .as_ref()
            .unwrap();
        let imported_observations = imported
            .source
            .as_ref()
            .unwrap()
            .import_diagnostics
            .as_ref()
            .unwrap();
        assert_eq!(observations.len(), 12);
        assert_eq!(
            serde_json::to_value(&observations[..7]).unwrap(),
            serde_json::to_value(imported_observations).unwrap()
        );
        for code in [
            "written_note_practice_edition",
            "source_tempo_rounding",
            "source_key_default",
            "reference_performance_limits",
            "retained_source_layout",
        ] {
            assert!(observations.iter().any(|notice| notice.code == code));
        }
        let compilation = crate::compile(score.clone()).unwrap();
        assert_eq!(compilation.timeline.notes.len(), 198);
        assert!((compilation.timeline.duration_ms - 30857.14285714286).abs() < 1e-8);
        let mut compiled_ids: Vec<_> = compilation
            .timeline
            .notes
            .iter()
            .flat_map(|note| note.source_note_ids.iter())
            .collect();
        let mut written_ids: Vec<_> = written
            .iter()
            .filter(|note| note.pitch.is_some())
            .map(|note| &note.id)
            .collect();
        compiled_ids.sort();
        written_ids.sort();
        assert_eq!(compiled_ids, written_ids);
        assert!(!compilation.diagnostics.iter().any(|notice| [
            "orphan_tie",
            "broken_tie",
            "unclosed_tie"
        ]
        .contains(&notice.code.as_str())));
        let roundtrip: Score =
            serde_json::from_str(&serde_json::to_string(&score).unwrap()).unwrap();
        assert_eq!(
            serde_json::to_value(crate::compile(roundtrip).unwrap()).unwrap(),
            serde_json::to_value(compilation).unwrap()
        );
    }

    #[test]
    fn beethoven_physical_targets_keep_all_sources_and_block_unsuitable_ranges() {
        use crate::instruments::{analyze_instrument, InstrumentProfile};
        use crate::targets::plan_targets;
        let score = catalog().remove(1);
        let before = serde_json::to_value(&score).unwrap();
        let compiled = crate::compile(score.clone()).unwrap();
        for (keys, expected_playable, out_of_range) in
            [(61, false, 8), (76, true, 0), (88, true, 0)]
        {
            let profile = InstrumentProfile::Piano {
                key_count: keys,
                lowest_midi: None,
            };
            let report = analyze_instrument(&compiled.timeline, &profile).unwrap();
            assert_eq!(
                report
                    .note_options
                    .iter()
                    .filter(|note| !note.playable)
                    .count(),
                out_of_range
            );
            assert!(!report.changed_source_notes);
            let plan = plan_targets(&compiled.timeline, &profile).unwrap();
            assert_eq!(
                (plan.source_note_count, plan.target_count, plan.playable),
                (198, 168, expected_playable)
            );
            let mut actual: Vec<_> = plan
                .groups
                .iter()
                .flat_map(|group| group.source_note_ids.iter())
                .collect();
            let mut expected: Vec<_> = score
                .parts
                .iter()
                .flat_map(|part| &part.notes)
                .filter(|note| note.pitch.is_some())
                .map(|note| &note.id)
                .collect();
            actual.sort();
            expected.sort();
            assert_eq!(actual, expected);
        }
        let mut voice = compiled.timeline.clone();
        voice.notes.retain(|note| note.part_id == "P1");
        assert_eq!(voice.notes.len(), 30);
        for (frets, full_out, voice_out, voice_playable) in [(12, 30, 6, false), (15, 16, 0, true)]
        {
            let profile = InstrumentProfile::Guitar {
                tuning: vec![64, 59, 55, 50, 45, 40],
                frets,
                capo: 0,
            };
            let report = analyze_instrument(&compiled.timeline, &profile).unwrap();
            assert_eq!(
                report
                    .note_options
                    .iter()
                    .filter(|note| !note.playable)
                    .count(),
                full_out
            );
            let full_plan = plan_targets(&compiled.timeline, &profile).unwrap();
            assert!(!full_plan.playable);
            assert_eq!(full_plan.target_count, 198);
            assert!(full_plan
                .diagnostics
                .iter()
                .any(|notice| notice.code == "guitar_string_conflict"));
            let voice_report = analyze_instrument(&voice, &profile).unwrap();
            assert_eq!(
                voice_report
                    .note_options
                    .iter()
                    .filter(|note| !note.playable)
                    .count(),
                voice_out
            );
            let voice_plan = plan_targets(&voice, &profile).unwrap();
            assert_eq!(
                (
                    voice_plan.source_note_count,
                    voice_plan.target_count,
                    voice_plan.playable
                ),
                (30, 30, voice_playable)
            );
        }
        assert_eq!(serde_json::to_value(&score).unwrap(), before);
    }
}
