//! Exact occupancy order for advisory fingering. Playback still uses Compilation.
use crate::{Beat, Compilation, TimedNote};
use std::cmp::Ordering;
use std::collections::HashMap;

#[derive(Clone, Copy, Debug)]
pub(crate) struct Moment {
    pub segment: usize,
    pub at: Beat,
}
impl PartialEq for Moment {
    fn eq(&self, other: &Self) -> bool {
        self.segment == other.segment && self.at.equivalent(other.at)
    }
}
impl Eq for Moment {}
impl PartialOrd for Moment {
    fn partial_cmp(&self, other: &Self) -> Option<Ordering> {
        Some(self.cmp(other))
    }
}
impl Ord for Moment {
    fn cmp(&self, other: &Self) -> Ordering {
        self.segment
            .cmp(&other.segment)
            .then(self.at.compare(other.at))
    }
}

#[derive(Clone, Debug)]
pub(crate) struct ExactNote {
    pub note: TimedNote,
    pub start: Moment,
    pub end: Moment,
}

/// Resolve compiled repeat occurrences through their complete source IDs. No
/// occurrence-ID parsing, float epsilon, quantization or tied rearticulation.
pub(crate) fn exact_notes(
    compiled: &Compilation,
    part: Option<&str>,
) -> Result<Vec<ExactNote>, String> {
    if part.is_some_and(|id| !compiled.score.parts.iter().any(|p| p.id == id)) {
        return Err("Choose an existing part for fingering guidance".into());
    }
    let source: HashMap<_, _> = compiled
        .score
        .parts
        .iter()
        .flat_map(|p| &p.notes)
        .map(|n| (n.id.as_str(), n))
        .collect();
    let mut groups: HashMap<&str, Vec<&TimedNote>> = HashMap::new();
    for note in &compiled.timeline.notes {
        if part.is_some_and(|id| note.part_id != id) {
            continue;
        }
        let first = note
            .source_note_ids
            .first()
            .ok_or("Fingering requires complete compiled source IDs")?;
        groups.entry(first).or_default().push(note);
    }
    for notes in groups.values() {
        if notes
            .windows(2)
            .any(|pair| pair[1].start_ms <= pair[0].start_ms)
        {
            return Err("Repeated occurrences are too close for a reliable fingering display clock; score playback is unchanged".into());
        }
    }
    let mut ordered: Vec<_> = groups.keys().copied().collect();
    ordered.sort_by(|a, b| source[a].at.compare(source[b].at).then(a.cmp(b)));
    let segments =
        crate::navigation_segments(&compiled.score, crate::written_duration(&compiled.score))?;
    let mut used = HashMap::<&str, usize>::new();
    let mut output = vec![];
    for (segment_index, segment) in segments.iter().enumerate() {
        let first = ordered.partition_point(|id| source[id].at.compare(segment.start).is_lt());
        let last = ordered.partition_point(|id| source[id].at.compare(segment.end).is_lt());
        for id in &ordered[first..last] {
            let position = used.entry(id).or_default();
            let note = *groups[id]
                .get(*position)
                .ok_or("Compiled fingering occurrences do not match repeat navigation")?;
            *position += 1;
            let first_note = source[note.source_note_ids.first().expect("checked").as_str()];
            let last_note = source[note.source_note_ids.last().expect("checked").as_str()];
            let end = last_note
                .at
                .checked_add(last_note.duration)
                .expect("compiled score");
            if end.compare(segment.end).is_gt() {
                return Err("A held note crosses a fingering navigation boundary; keep the score and review the phrase".into());
            }
            output.push(ExactNote {
                note: note.clone(),
                start: Moment {
                    segment: segment_index,
                    at: first_note.at,
                },
                end: Moment {
                    segment: segment_index,
                    at: end,
                },
            });
        }
    }
    if groups
        .iter()
        .any(|(id, notes)| used.get(id).copied().unwrap_or(0) != notes.len())
    {
        return Err("Fingering must preserve every selected compiled occurrence".into());
    }
    output.sort_by(|a, b| {
        a.start
            .cmp(&b.start)
            .then(a.note.midi.cmp(&b.note.midi))
            .then(a.note.id.cmp(&b.note.id))
    });
    if output
        .windows(2)
        .any(|pair| pair[0].start < pair[1].start && pair[1].note.start_ms <= pair[0].note.start_ms)
    {
        return Err("Distinct written onsets exceed the reliable fingering display-clock resolution; no onset was merged or removed".into());
    }
    Ok(output)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn rational_adjacent_occupancy_has_no_float_tolerance() {
        let a = Moment {
            segment: 0,
            at: Beat::new(1, 3),
        };
        assert_eq!(
            a,
            Moment {
                segment: 0,
                at: Beat::new(2, 6)
            }
        );
        assert!(
            a < Moment {
                segment: 0,
                at: Beat::new(333334, 1000000)
            }
        );
        assert!(
            Moment {
                segment: 0,
                at: Beat::new(100, 1)
            } < Moment {
                segment: 1,
                at: Beat::ZERO
            }
        );
    }
    #[test]
    fn complete_edition_ties_and_selected_parts_keep_all_compiled_identities() {
        let original = crate::catalog_score("cc0-beethoven-gottes-macht-op48-5").unwrap();
        let compiled = crate::compile(original.clone()).unwrap();
        for part in std::iter::once(None).chain(original.parts.iter().map(|p| Some(p.id.as_str())))
        {
            let result = exact_notes(&compiled, part).unwrap();
            let mut expected: Vec<_> = compiled
                .timeline
                .notes
                .iter()
                .filter(|n| part.is_none_or(|p| n.part_id == p))
                .map(|n| n.id.clone())
                .collect();
            let mut actual: Vec<_> = result.iter().map(|n| n.note.id.clone()).collect();
            expected.sort();
            actual.sort();
            assert_eq!(actual, expected);
            assert!(result.iter().all(|n| n.end > n.start));
        }
        assert_eq!(
            serde_json::to_value(&compiled.score).unwrap(),
            serde_json::to_value(original).unwrap()
        );
        assert!(exact_notes(&compiled, Some("missing")).is_err());
    }
    #[test]
    fn repeat_passes_are_separate_occupancy_segments_without_new_tie_attacks() {
        let mut score = crate::catalog().remove(0);
        score.repeats = vec![crate::Repeat {
            from: Beat::ZERO,
            to: Beat::new(16, 1),
            times: 3,
        }];
        let compiled = crate::compile(score).unwrap();
        let result = exact_notes(&compiled, None).unwrap();
        assert_eq!(result.len(), 45);
        for segment in 0..3 {
            assert_eq!(
                result.iter().filter(|n| n.start.segment == segment).count(),
                15
            );
        }
        assert!(result.windows(2).all(|pair| pair[0].start <= pair[1].start));
        assert!(result.windows(2).any(
            |pair| pair[0].end.segment != pair[1].start.segment && pair[0].end < pair[1].start
        ));
    }
}
