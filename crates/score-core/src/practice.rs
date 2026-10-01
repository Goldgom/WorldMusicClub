//! Canonical loop boundaries and target selection derived from the Rust musical clock.
use crate::{compile, Beat, Diagnostic, Score, TempoIndex};
use serde::{Deserialize, Serialize};
use std::{cmp::Ordering, collections::HashMap};
#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct PracticeWindow {
    pub start_ms: f64,
    pub end_ms: f64,
    pub target_note_ids: Vec<String>,
    pub crossing_notes: usize,
    pub diagnostics: Vec<Diagnostic>,
}
pub fn practice_window(score: &Score, from: Beat, to: Beat) -> Result<PracticeWindow, String> {
    if !from.valid()
        || !to.valid()
        || from.numerator < 0
        || to.compare(from) != std::cmp::Ordering::Greater
    {
        return Err("Practice range requires nonnegative A and B later than A, in rational quarter-note beats".into());
    }
    if !score.repeats.is_empty() {
        return Err("Written-beat loops are ambiguous in repeated scores; choose a linear score until repeat-pass selection is available".into());
    }
    let compiled = compile(score.clone())?;
    let tempo = TempoIndex::new(&score.tempo);
    let start_ms = tempo.at(from.value());
    let end_ms = tempo.at(to.value());
    if to.compare(crate::written_duration(score)) == Ordering::Greater {
        return Err("Practice range extends past the end of the score".into());
    }
    // The compiled source IDs identify each complete tie chain. Compare its
    // written endpoints exactly; reconstructing an end from rounded milliseconds
    // can turn a note ending at B into a false crossing-sustain warning.
    let written: HashMap<_, _> = score
        .parts
        .iter()
        .flat_map(|part| &part.notes)
        .map(|note| {
            (
                note.id.as_str(),
                (
                    note.at,
                    note.at.checked_add(note.duration).expect("validated"),
                ),
            )
        })
        .collect();
    let mut target_note_ids = vec![];
    let mut crossing_notes = 0;
    for note in &compiled.timeline.notes {
        let start = written[note.source_note_id.as_str()].0;
        let end = written[note
            .source_note_ids
            .last()
            .expect("compiled source ID")
            .as_str()]
        .1;
        if start.compare(from) != Ordering::Less && start.compare(to) == Ordering::Less {
            target_note_ids.push(note.id.clone());
        }
        if [from, to].iter().any(|boundary| {
            start.compare(*boundary) == Ordering::Less
                && end.compare(*boundary) == Ordering::Greater
        }) {
            crossing_notes += 1;
        }
    }
    let mut diagnostics = vec![];
    if crossing_notes > 0 {
        diagnostics.push(Diagnostic::warning("practice_crossing_sustain",format!("{crossing_notes} held notes cross a loop boundary. Listening may resume/clamp their sound; scoring targets only onsets inside the selected range."),None));
    }
    Ok(PracticeWindow {
        start_ms,
        end_ms,
        target_note_ids,
        crossing_notes,
        diagnostics,
    })
}
#[cfg(test)]
mod tests {
    use super::*;
    use crate::{catalog, Repeat, Tempo};
    #[test]
    fn window_respects_tempo_changes_and_half_open_targets() {
        let mut s = catalog().remove(0);
        s.tempo = vec![
            Tempo {
                at: Beat::ZERO,
                bpm: 120.,
            },
            Tempo {
                at: Beat::new(2, 1),
                bpm: 60.,
            },
        ];
        let w = practice_window(&s, Beat::new(1, 1), Beat::new(4, 1)).unwrap();
        assert_eq!(w.start_ms, 500.);
        assert_eq!(w.end_ms, 3000.);
        assert_eq!(w.target_note_ids, vec!["scale-1", "scale-2", "scale-3"]);
    }
    #[test]
    fn invalid_or_ambiguous_windows_are_actionable_errors() {
        let mut s = catalog().remove(0);
        assert!(practice_window(&s, Beat::ZERO, Beat::new(17, 1)).is_err());
        assert!(practice_window(&s, Beat::new(2, 1), Beat::new(1, 1)).is_err());
        s.repeats.push(Repeat {
            from: Beat::ZERO,
            to: Beat::new(4, 1),
            times: 2,
        });
        assert!(practice_window(&s, Beat::ZERO, Beat::new(4, 1))
            .unwrap_err()
            .contains("ambiguous"));
    }
    #[test]
    fn crossing_sustain_is_preserved_with_visible_warning() {
        let mut s = catalog().remove(0);
        s.parts[0].notes[0].duration = Beat::new(2, 1);
        let w = practice_window(&s, Beat::new(1, 1), Beat::new(4, 1)).unwrap();
        assert_eq!(w.crossing_notes, 1);
        assert!(!w.target_note_ids.contains(&"scale-0".to_string()));
        assert_eq!(w.diagnostics[0].code, "practice_crossing_sustain");
    }
    #[test]
    fn exact_held_note_end_does_not_cross_a_loop_boundary() {
        let mut s = catalog().remove(0);
        s.tempo[0].bpm = 38.5;
        s.parts[0].notes.truncate(1);
        s.parts[0].notes[0].at = Beat::new(3, 1);
        s.parts[0].notes[0].duration = Beat::new(22, 1);
        s.measures.clear();
        let w = practice_window(&s, Beat::new(3, 1), Beat::new(25, 1)).unwrap();
        assert_eq!(w.target_note_ids, vec!["scale-0"]);
        assert_eq!(w.crossing_notes, 0);
        assert!(w.diagnostics.is_empty());
    }
    #[test]
    fn loop_end_cannot_extend_beyond_the_exact_written_duration() {
        let mut s = catalog().remove(0);
        s.tempo[0].bpm = 120.;
        let end = crate::written_duration(&s);
        let after_end = end.checked_add(Beat::new(1, 1_000_000)).unwrap();
        assert!(practice_window(&s, Beat::ZERO, end).is_ok());
        assert!(practice_window(&s, Beat::ZERO, after_end)
            .unwrap_err()
            .contains("past the end"));
    }
    #[test]
    fn tied_sustain_uses_the_final_written_segment_and_equivalent_rationals() {
        let mut s = catalog().remove(0);
        s.parts[0].notes.truncate(2);
        s.parts[0].notes[0].duration = Beat::new(1, 3);
        s.parts[0].notes[0].tie_start = true;
        s.parts[0].notes[1].at = Beat::new(2, 6);
        s.parts[0].notes[1].duration = Beat::new(2, 3);
        s.parts[0].notes[1].pitch = s.parts[0].notes[0].pitch.clone();
        s.parts[0].notes[1].tie_stop = true;
        let original = serde_json::to_value(&s).unwrap();
        let partial = practice_window(&s, Beat::new(1, 3), Beat::new(3, 3)).unwrap();
        assert!(
            partial.target_note_ids.is_empty(),
            "A tied continuation is not an attack"
        );
        assert_eq!(partial.crossing_notes, 1);
        let full = practice_window(&s, Beat::ZERO, Beat::new(2, 2)).unwrap();
        assert_eq!(full.target_note_ids, vec!["scale-0"]);
        assert_eq!(full.crossing_notes, 0);
        assert_eq!(serde_json::to_value(&s).unwrap(), original);
    }
}
