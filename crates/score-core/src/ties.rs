//! Exact adjacent tie lookup without quadratic cross-voice searches.
use crate::{Beat, Note};
use std::collections::{HashMap, HashSet};
type Lane = (String, u8, u8);
type EndKey = (u8, i64, i64);
fn end_key(midi: u8, at: Beat) -> EndKey {
    let divisor = crate::gcd(at.numerator.unsigned_abs() as u128, at.denominator as u128) as i64;
    (midi, at.numerator / divisor, at.denominator / divisor)
}
#[derive(Default)]
pub(crate) struct TieTracker {
    by_lane: HashMap<Lane, (usize, Beat)>,
    by_end: HashMap<EndKey, HashSet<Lane>>,
}
pub(crate) struct TieMatch {
    pub index: usize,
    pub end: Beat,
    pub cross_lane: bool,
}
impl TieTracker {
    fn remove(&mut self, lane: &Lane) -> Option<(usize, Beat)> {
        let entry = self.by_lane.remove(lane)?;
        let key = end_key(lane.2, entry.1);
        if let Some(lanes) = self.by_end.get_mut(&key) {
            lanes.remove(lane);
            if lanes.is_empty() {
                self.by_end.remove(&key);
            }
        }
        Some(entry)
    }
    pub fn take(&mut self, note: &Note, midi: u8) -> Result<Option<TieMatch>, String> {
        let lane = (note.voice.clone(), note.staff, midi);
        if let Some((index, end)) = self.remove(&lane) {
            return Ok(Some(TieMatch {
                index,
                end,
                cross_lane: false,
            }));
        }
        let Some(lanes) = self.by_end.get(&end_key(midi, note.at)) else {
            return Ok(None);
        };
        if lanes.len() != 1 {
            return Err(format!("Ambiguous cross-voice/staff tie continuation for note {}; identify the intended tied voice explicitly", note.id));
        }
        let lane = lanes
            .iter()
            .next()
            .expect("nonempty active end bucket")
            .clone();
        let (index, end) = self
            .remove(&lane)
            .expect("active tie indexes remain consistent");
        Ok(Some(TieMatch {
            index,
            end,
            cross_lane: true,
        }))
    }
    pub fn start(&mut self, note: &Note, midi: u8, index: usize, end: Beat) -> Result<(), String> {
        let lane = (note.voice.clone(), note.staff, midi);
        if self.by_lane.contains_key(&lane) {
            return Err(format!("Ambiguous overlapping tie starts for note {}; use distinct voices or correct the ties", note.id));
        }
        self.by_lane.insert(lane.clone(), (index, end));
        self.by_end
            .entry(end_key(midi, end))
            .or_default()
            .insert(lane);
        Ok(())
    }
    pub fn unresolved(&self) -> Vec<usize> {
        self.by_lane.values().map(|(index, _)| *index).collect()
    }
}

#[cfg(test)]
mod tests {
    use crate::{catalog, compile, Beat};
    fn tied_score() -> crate::Score {
        let mut score = catalog().remove(0);
        score.parts[0].notes.truncate(2);
        score.parts[0].notes[0].tie_start = true;
        score.parts[0].notes[1].tie_stop = true;
        score.parts[0].notes[1].pitch = score.parts[0].notes[0].pitch.clone();
        score
    }
    #[test]
    fn unique_adjacent_ties_cross_voices_and_staves_without_changing_written_notes() {
        let mut score = tied_score();
        score.parts[0].notes[1].voice = "2".into();
        score.parts[0].notes[1].staff = 2;
        let original = serde_json::to_value(&score).unwrap();
        let compiled = compile(score).unwrap();
        assert_eq!(serde_json::to_value(&compiled.score).unwrap(), original);
        assert_eq!(compiled.timeline.notes.len(), 1);
        assert_eq!(compiled.timeline.notes[0].source_note_ids.len(), 2);
        assert!(compiled
            .diagnostics
            .iter()
            .any(|d| d.code == "cross_lane_tie"));
        assert!(!compiled
            .diagnostics
            .iter()
            .any(|d| d.code == "orphan_tie" || d.code == "unclosed_tie"));
    }
    #[test]
    fn equivalent_rational_endpoints_link_but_gaps_never_do() {
        let mut score = tied_score();
        score.parts[0].notes[0].duration = Beat::new(1, 3);
        score.parts[0].notes[1].at = Beat::new(2, 6);
        score.parts[0].notes[1].voice = "2".into();
        assert_eq!(compile(score.clone()).unwrap().timeline.notes.len(), 1);
        score.parts[0].notes[1].at = Beat::new(1, 2);
        assert_eq!(compile(score).unwrap().timeline.notes.len(), 2);
    }
    #[test]
    fn ambiguous_cross_voice_candidates_are_refused() {
        let mut score = tied_score();
        let mut other = score.parts[0].notes[0].clone();
        other.id = "other-start".into();
        other.voice = "2".into();
        score.parts[0].notes.push(other);
        score.parts[0].notes[1].voice = "3".into();
        assert!(compile(score)
            .unwrap_err()
            .contains("Ambiguous cross-voice/staff"));
    }
    #[test]
    fn same_lane_identity_has_priority_and_plain_repeated_notes_do_not_merge() {
        let mut score = tied_score();
        let mut other = score.parts[0].notes[0].clone();
        other.id = "other-start".into();
        other.voice = "2".into();
        score.parts[0].notes.push(other);
        assert_eq!(compile(score).unwrap().timeline.notes.len(), 2);
        let mut plain = tied_score();
        plain.parts[0].notes[0].tie_start = false;
        plain.parts[0].notes[1].tie_stop = false;
        plain.parts[0].notes[1].voice = "2".into();
        assert_eq!(compile(plain).unwrap().timeline.notes.len(), 2);
    }
}
