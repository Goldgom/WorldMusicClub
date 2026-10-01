//! Reviewed complete CC0 source editions, with retained original bytes and limits.
//! No network or converter is involved in startup or playback.
use crate::Score;

const SCHUBERT: &str =
    include_str!("../../../catalog/editions/cc0-schubert-wandrers-nachtlied-d768/score.json");

pub fn catalog() -> Vec<Score> {
    vec![serde_json::from_str(SCHUBERT).expect("committed reviewed edition must remain valid JSON")]
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
}
