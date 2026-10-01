//! Small, newly encoded practice arrangements of old public-domain melodies.
//!
//! The note fixtures and new practice arrangements in this module are dedicated
//! to the public domain under CC0-1.0. This does not relicense the historical
//! compositions, reference scans, recordings, or modern editions. See
//! `docs/CATALOG_RIGHTS.md` for sources, editorial changes, and jurisdiction limits.

use crate::{Beat, Key, Measure, Meter, Note, Part, Pitch, Provenance, Score, Source, Tempo};

const BEETHOVEN_SOURCE: &str = "https://www.beethoven.de/en/work/view/ag9iZWV0aG92ZW4tdml1cjNyEQsSBHdvcmsYgICA7NW57wkM/Symphony%20no.%209%20%26%2340%3BD%20minor%26%2341%3B%20op.%20125";
const MOZART_SOURCE: &str = "https://kv.mozarteum.at/de/work/zwolf-variationen-in-c-uber-4057";
const EDITION_NOTICE: &str = "WorldMusicHub newly encoded simple practice arrangement; not transcription of modern score. Underlying composition: public domain; new practice arrangement and encoding only: CC0-1.0. Limited practice excerpt, not a complete or critical edition. See docs/CATALOG_RIGHTS.md for editorial changes and jurisdiction-specific rights considerations.";

// Each tuple is (diatonic step, duration numerator, duration denominator),
// measured in quarter-note beats. All notes are natural pitches in octave 4.
// Written here for this project, not imported from a modern score or MIDI file.
type FixtureNote = (&'static str, i64, i64);

// First eight bars of the initial low-string theme in the finale of Op. 125,
// transposed from D major to C major and moved into a beginner-friendly octave.
// The initial half notes and dotted-quarter/eighth cadences are intentional.
const ODE_TO_JOY: &[FixtureNote] = &[
    ("E", 2, 1),
    ("F", 1, 1),
    ("G", 1, 1),
    ("G", 1, 1),
    ("F", 1, 1),
    ("E", 1, 1),
    ("D", 1, 1),
    ("C", 2, 1),
    ("D", 1, 1),
    ("E", 1, 1),
    ("E", 3, 2),
    ("D", 1, 2),
    ("D", 2, 1),
    ("E", 2, 1),
    ("F", 1, 1),
    ("G", 1, 1),
    ("G", 1, 1),
    ("F", 1, 1),
    ("E", 1, 1),
    ("D", 1, 1),
    ("C", 2, 1),
    ("D", 1, 1),
    ("E", 1, 1),
    ("D", 3, 2),
    ("C", 1, 2),
    ("C", 2, 1),
];

// Opening eight bars of the traditional French tune, also familiar as the
// Twinkle melody. This reduction coalesces the repeated G in bar 4 and removes
// the short E ornament in bar 7 of the historical Mozart theme (see rights doc).
const AH_VOUS_DIRAI_JE_MAMAN: &[FixtureNote] = &[
    ("C", 1, 1),
    ("C", 1, 1),
    ("G", 1, 1),
    ("G", 1, 1),
    ("A", 1, 1),
    ("A", 1, 1),
    ("G", 2, 1),
    ("F", 1, 1),
    ("F", 1, 1),
    ("E", 1, 1),
    ("E", 1, 1),
    ("D", 1, 1),
    ("D", 1, 1),
    ("C", 2, 1),
];

struct Arrangement {
    id: &'static str,
    title: &'static str,
    composer: &'static str,
    historical_credit: &'static str,
    source_url: &'static str,
    editorial_changes: &'static str,
    beats_per_measure: u16,
    bpm: f64,
    fixture: &'static [FixtureNote],
}

/// Playable public-domain melody excerpts with independently licensed encodings.
/// This function performs no network reads and bundles no third-party assets.
pub fn catalog() -> Vec<Score> {
    [
        Arrangement {
            id: "pd-ode-to-joy-opening",
            title: "欢乐颂 · Ode to Joy (opening practice excerpt)",
            composer: "Ludwig van Beethoven",
            historical_credit: "Ludwig van Beethoven, Symphony No. 9 in D minor, Op. 125, finale theme; completed February 1824, first score published 1826.",
            source_url: BEETHOVEN_SOURCE,
            editorial_changes: "First eight bars of the initial low-string theme only; transposed D major to C major, octave 4, one melodic line without orchestration or lyrics. Practice meter 4/4 and quarter-note tempo 90 replace the original cut time and tempo; melodic durations retained.",
            beats_per_measure: 4,
            bpm: 90.0,
            fixture: ODE_TO_JOY,
        },
        Arrangement {
            id: "pd-ah-vous-dirai-je-maman-opening",
            title: "小星星旋律 · Ah! vous dirai-je, maman (opening practice excerpt)",
            composer: "Traditional French melody (anonymous); theme used by W. A. Mozart",
            historical_credit: "Anonymous traditional French melody, documented in Wolfgang Amadeus Mozart's Twelve Variations, K. 265/300e (Vienna, 1781-1782; first publication 1785). Mozart is the composer of the variations, not the credited originator of this traditional tune.",
            source_url: MOZART_SOURCE,
            editorial_changes: "First eight bars of the tune only, in C major, octave 4, melody alone without accompaniment, repeats or lyrics. Bar 4's repeated G notes become one half note; bar 7's D/E ornamental figure becomes two D quarter notes. Quarter-note tempo 80 is a new practice choice.",
            beats_per_measure: 2,
            bpm: 80.0,
            fixture: AH_VOUS_DIRAI_JE_MAMAN,
        },
    ]
    .into_iter()
    .map(arrange)
    .collect()
}

fn arrange(arrangement: Arrangement) -> Score {
    let mut at = Beat::ZERO;
    let notes: Vec<Note> = arrangement
        .fixture
        .iter()
        .enumerate()
        .map(|(index, &(step, numerator, denominator))| {
            let duration = Beat::new(numerator, denominator);
            let note = Note {
                id: format!("{}-n{}", arrangement.id, index + 1),
                at,
                duration,
                pitch: Some(Pitch {
                    step: step.into(),
                    alter: 0,
                    octave: 4,
                }),
                voice: "1".into(),
                staff: 1,
                velocity: 80,
                tie_start: false,
                tie_stop: false,
            };
            at = at.checked_add(duration).expect("bounded catalog fixture");
            note
        })
        .collect();
    let attribution = format!(
        "{} {} {}",
        arrangement.historical_credit, EDITION_NOTICE, arrangement.editorial_changes
    );
    // Retain the exact newly authored input, including rational durations. This
    // source is a project fixture, never a claim to preserve the reference scan.
    let source = Source {
        import_diagnostics: None,
        format: "worldmusichub-practice-fixture-json".into(),
        filename: Some(format!("{}.json", arrangement.id)),
        content: serde_json::json!({
            "version": 1,
            "id": arrangement.id,
            "edition_license": "CC0-1.0",
            "historical_credit": arrangement.historical_credit,
            "underlying_composition_status": "public domain; see docs/CATALOG_RIGHTS.md",
            "reference_url": arrangement.source_url,
            "editorial_changes": arrangement.editorial_changes,
            "pitch_octave": 4,
            "pitch_alter": 0,
            "meter": [arrangement.beats_per_measure, 4],
            "quarter_note_bpm": arrangement.bpm,
            "note_fields": ["step", "duration_quarter_numerator", "duration_quarter_denominator"],
            "notes": arrangement.fixture,
        })
        .to_string(),
    };
    Score {
        version: 1,
        id: arrangement.id.into(),
        title: arrangement.title.into(),
        composer: arrangement.composer.into(),
        provenance: Provenance {
            kind: "public_domain_practice_arrangement".into(),
            attribution,
            source_url: Some(arrangement.source_url.into()),
            // Applies only to the new arrangement/encoding, as attribution says.
            license: Some("CC0-1.0".into()),
        },
        parts: vec![Part {
            id: "melody".into(),
            name: "Practice melody".into(),
            instrument: "piano".into(),
            notes,
        }],
        tempo: vec![Tempo {
            at: Beat::ZERO,
            bpm: arrangement.bpm,
        }],
        meters: vec![Meter {
            at: Beat::ZERO,
            numerator: arrangement.beats_per_measure,
            denominator: 4,
        }],
        keys: vec![Key {
            at: Beat::ZERO,
            fifths: 0,
            mode: "major".into(),
        }],
        measures: (0..8)
            .map(|index| Measure {
                number: index + 1,
                at: Beat::new(
                    i64::from(index) * i64::from(arrangement.beats_per_measure),
                    1,
                ),
                length: Beat::new(i64::from(arrangement.beats_per_measure), 1),
            })
            .collect(),
        repeats: vec![],
        source: Some(source),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashSet;

    #[test]
    fn excerpts_validate_compile_and_have_expected_spans_and_ranges() {
        let expected = [(26, 32, 60, 67), (14, 16, 60, 69)];
        let scores = catalog();
        assert_eq!(scores.len(), expected.len());
        for (score, (count, beats, lowest, highest)) in scores.into_iter().zip(expected) {
            crate::validate(&score).unwrap();
            assert_eq!(score.parts.len(), 1);
            assert_eq!(score.parts[0].notes.len(), count);
            assert_eq!(score.measures.len(), 8);
            let mut cursor = Beat::ZERO;
            for note in &score.parts[0].notes {
                assert!(note.at.equivalent(cursor));
                cursor = cursor.checked_add(note.duration).unwrap();
            }
            assert!(cursor.equivalent(Beat::new(beats, 1)));
            let bpm = score.tempo[0].bpm;
            let compiled = crate::compile(score).unwrap();
            assert!(compiled.diagnostics.is_empty());
            assert_eq!(compiled.timeline.notes.len(), count);
            assert_eq!(
                compiled.timeline.notes.iter().map(|n| n.midi).min(),
                Some(lowest)
            );
            assert_eq!(
                compiled.timeline.notes.iter().map(|n| n.midi).max(),
                Some(highest)
            );
            assert!((compiled.timeline.duration_ms - beats as f64 * 60_000.0 / bpm).abs() < 0.001);
        }
    }

    #[test]
    fn catalog_ids_and_note_ids_are_stable_and_unique() {
        let scores = catalog();
        assert_eq!(scores[0].id, "pd-ode-to-joy-opening");
        assert_eq!(scores[1].id, "pd-ah-vous-dirai-je-maman-opening");
        let mut ids = HashSet::new();
        for score in &scores {
            assert!(ids.insert(score.id.as_str()));
            for note in &score.parts[0].notes {
                assert!(ids.insert(note.id.as_str()));
            }
        }
    }

    #[test]
    fn attribution_distinguishes_old_composition_and_new_encoding() {
        for (score, (creator, date, url)) in catalog().iter().zip([
            ("Ludwig van Beethoven", "1824", BEETHOVEN_SOURCE),
            (
                "Anonymous traditional French melody",
                "1781-1782",
                MOZART_SOURCE,
            ),
        ]) {
            assert_eq!(score.provenance.kind, "public_domain_practice_arrangement");
            assert_eq!(score.provenance.license.as_deref(), Some("CC0-1.0"));
            assert_eq!(score.provenance.source_url.as_deref(), Some(url));
            for required in [creator, date, EDITION_NOTICE] {
                assert!(score.provenance.attribution.contains(required));
            }
            assert!(score.title.contains("opening practice excerpt"));
        }
    }

    #[test]
    fn retained_project_fixture_preserves_every_pitch_and_rational_duration() {
        for score in catalog() {
            let source = score.source.as_ref().unwrap();
            assert_eq!(source.format, "worldmusichub-practice-fixture-json");
            let fixture: serde_json::Value = serde_json::from_str(&source.content).unwrap();
            assert_eq!(fixture["edition_license"], "CC0-1.0");
            assert_eq!(fixture["id"], score.id);
            let inputs = fixture["notes"].as_array().unwrap();
            assert_eq!(inputs.len(), score.parts[0].notes.len());
            for (input, note) in inputs.iter().zip(&score.parts[0].notes) {
                assert_eq!(input[0], note.pitch.as_ref().unwrap().step);
                assert_eq!(input[1], note.duration.numerator);
                assert_eq!(input[2], note.duration.denominator);
            }
        }
    }

    #[test]
    fn ode_cadences_keep_exact_dotted_quarter_and_eighth_durations() {
        let score = catalog().remove(0);
        for index in [10, 23] {
            assert!(score.parts[0].notes[index]
                .duration
                .equivalent(Beat::new(3, 2)));
            assert!(score.parts[0].notes[index + 1]
                .duration
                .equivalent(Beat::new(1, 2)));
            assert!(score.parts[0].notes[index + 2]
                .duration
                .equivalent(Beat::new(2, 1)));
        }
    }
}
