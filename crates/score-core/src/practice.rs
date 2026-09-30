//! Canonical loop boundaries and target selection derived from the Rust musical clock.
use crate::{compile, Beat, Diagnostic, Score, TempoIndex};
use serde::{Deserialize, Serialize};
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
    if end_ms > compiled.timeline.duration_ms + 0.001 {
        return Err("Practice range extends past the end of the score".into());
    }
    let target_note_ids = compiled
        .timeline
        .notes
        .iter()
        .filter(|n| n.start_ms >= start_ms && n.start_ms < end_ms)
        .map(|n| n.id.clone())
        .collect();
    let crossing_notes = compiled
        .timeline
        .notes
        .iter()
        .filter(|n| {
            (n.start_ms < start_ms && n.start_ms + n.duration_ms > start_ms)
                || (n.start_ms < end_ms && n.start_ms + n.duration_ms > end_ms)
        })
        .count();
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
}
