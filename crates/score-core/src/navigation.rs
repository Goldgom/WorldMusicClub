//! Display-only exact written-measure navigation. Never a replacement playback clock.
use crate::{Beat, Diagnostic, Score, TempoIndex};
use serde::Serialize;
use std::collections::BTreeSet;

const MAX_OCCURRENCES: usize = 100_000;
const MAX_REFERENCES: usize = 1_000_000;
const MAX_BYTES: usize = 16 * 1024 * 1024;
// Count serialized bytes without allocating a second, potentially oversized response buffer.
#[derive(Default)]
struct ResponseSize(usize);
impl std::io::Write for ResponseSize {
    fn write(&mut self, bytes: &[u8]) -> std::io::Result<usize> {
        if bytes.len() > MAX_BYTES.saturating_sub(self.0) {
            return Err(std::io::Error::other("Notation following response exceeds 16 MiB; use manual paging or a smaller score. No source events were removed"));
        }
        self.0 += bytes.len();
        Ok(bytes.len())
    }
    fn flush(&mut self) -> std::io::Result<()> {
        Ok(())
    }
}

#[derive(Clone, Debug, Serialize)]
pub struct MeasureOccurrence {
    pub id: String,
    pub source_measure_index: usize,
    pub measure_number: u32,
    pub source_from: Beat,
    pub source_to: Beat,
    pub start_ms: f64,
    pub end_ms: f64,
    pub repeat_region_index: Option<usize>,
    pub repeat_pass: Option<u8>,
    pub repeat_times: Option<u8>,
    /// All written note/rest onsets in this half-open source interval, including tied continuations.
    pub written_note_ids: Vec<String>,
    /// Written events whose onsets precede this interval and whose durations extend into it.
    pub continuing_note_ids: Vec<String>,
}
#[derive(Clone, Debug, Serialize)]
pub struct SoundingGroup {
    pub occurrence_id: String,
    pub part_id: String,
    /// Full tie chain from the compiled sounding occurrence, not new attacks per written segment.
    pub source_note_ids: Vec<String>,
    pub start_ms: f64,
    pub end_ms: f64,
}
#[derive(Clone, Debug, Serialize)]
pub struct NotationNavigation {
    pub version: u32,
    pub source_measure_count: usize,
    pub duration_ms: f64,
    pub occurrences: Vec<MeasureOccurrence>,
    pub sounding_groups: Vec<SoundingGroup>,
    pub diagnostics: Vec<Diagnostic>,
}
struct WrittenInterval {
    measure: usize,
    from: Beat,
    to: Beat,
    starts: Vec<String>,
    continues: Vec<String>,
}
fn count_references(count: &mut usize, added: usize) -> Result<(), String> {
    *count = count
        .checked_add(added)
        .ok_or("Notation reference count overflow")?;
    if *count > MAX_REFERENCES {
        return Err("Notation following exceeds 1,000,000 source references; use manual measure paging or a shorter score".into());
    }
    Ok(())
}

pub fn notation_navigation(score: Score) -> Result<NotationNavigation, String> {
    let compiled = crate::compile(score)?;
    let score = &compiled.score;
    let total = crate::written_duration(score);
    if score.measures.is_empty() {
        return Err("Notation following needs a complete ordered measure map; manual notation and playback remain available".into());
    }
    let mut cursor = Beat::ZERO;
    let mut boundaries = vec![cursor];
    for measure in &score.measures {
        if !measure.at.equivalent(cursor) {
            return Err("Notation following requires contiguous ordered measures starting at beat zero, as MusicXML export does; correct gaps, overlaps or out-of-order measures".into());
        }
        cursor = measure.at.checked_add(measure.length).expect("validated");
        boundaries.push(cursor);
    }
    if !cursor.equivalent(total) {
        return Err("The measure map does not cover the complete written score; following is unavailable without changing playback".into());
    }
    let segments = crate::navigation_segments(score, total)?;
    for repeat in &score.repeats {
        boundaries.extend([repeat.from, repeat.to]);
    }
    boundaries.sort_by(|a, b| a.compare(*b));
    boundaries.dedup_by(|a, b| a.equivalent(*b));
    if boundaries.len() > MAX_OCCURRENCES + 1 {
        return Err(
            "Notation following exceeds 100,000 written intervals; use manual paging".into(),
        );
    }
    let mut notes: Vec<_> = score.parts.iter().flat_map(|part| &part.notes).collect();
    notes.sort_by(|a, b| a.at.compare(b.at).then(a.id.cmp(&b.id)));
    let mut ends: Vec<_> = notes
        .iter()
        .enumerate()
        .map(|(index, note)| {
            (
                note.at.checked_add(note.duration).expect("validated"),
                index,
            )
        })
        .collect();
    ends.sort_by(|a, b| a.0.compare(b.0).then(a.1.cmp(&b.1)));
    let mut active = BTreeSet::<usize>::new();
    let (mut first_note, mut first_end, mut measure, mut references) = (0, 0, 0, 0);
    let mut written = Vec::with_capacity(boundaries.len() - 1);
    for pair in boundaries.windows(2) {
        let (from, to) = (pair[0], pair[1]);
        while score.measures[measure]
            .at
            .checked_add(score.measures[measure].length)
            .expect("validated")
            .compare(from)
            .is_le()
        {
            measure += 1;
        }
        while first_end < ends.len() && ends[first_end].0.compare(from).is_le() {
            active.remove(&ends[first_end].1);
            first_end += 1;
        }
        count_references(&mut references, active.len())?;
        let continues = active
            .iter()
            .map(|&index| notes[index].id.clone())
            .collect();
        let first = first_note;
        while first_note < notes.len() && notes[first_note].at.compare(to).is_lt() {
            active.insert(first_note);
            first_note += 1;
        }
        count_references(&mut references, first_note - first)?;
        let starts = notes[first..first_note]
            .iter()
            .map(|note| note.id.clone())
            .collect();
        written.push(WrittenInterval {
            measure,
            from,
            to,
            starts,
            continues,
        });
    }
    let tempo = TempoIndex::new(&score.tempo);
    let mut occurrences = vec![];
    let mut offset = 0.;
    references = 0;
    for segment in segments {
        let first =
            written.partition_point(|interval| interval.from.compare(segment.start).is_lt());
        let last = written.partition_point(|interval| interval.from.compare(segment.end).is_lt());
        if occurrences.len() + last - first > MAX_OCCURRENCES {
            return Err(
                "Repeat-expanded notation following exceeds 100,000 intervals; use manual paging"
                    .into(),
            );
        }
        let segment_start_ms = tempo.at(segment.start.value());
        for interval in &written[first..last] {
            count_references(
                &mut references,
                interval.starts.len() + interval.continues.len(),
            )?;
            let start_ms = offset + (tempo.at(interval.from.value()) - segment_start_ms);
            let end_ms = offset + (tempo.at(interval.to.value()) - segment_start_ms);
            if !start_ms.is_finite() || !end_ms.is_finite() || end_ms <= start_ms {
                return Err("Written intervals are too small for a reliable display clock at this score's duration; use manual notation paging".into());
            }
            occurrences.push(MeasureOccurrence {
                id: format!("measure-occurrence-{}", occurrences.len()),
                source_measure_index: interval.measure,
                measure_number: score.measures[interval.measure].number,
                source_from: interval.from,
                source_to: interval.to,
                start_ms,
                end_ms,
                repeat_region_index: segment.repeat_region_index,
                repeat_pass: segment.repeat_pass,
                repeat_times: segment.repeat_times,
                written_note_ids: interval.starts.clone(),
                continuing_note_ids: interval.continues.clone(),
            });
        }
        offset += tempo.at(segment.end.value()) - segment_start_ms;
    }
    let mut sounding_groups = Vec::with_capacity(compiled.timeline.notes.len());
    for note in &compiled.timeline.notes {
        count_references(&mut references, note.source_note_ids.len())?;
        sounding_groups.push(SoundingGroup {
            occurrence_id: note.id.clone(),
            part_id: note.part_id.clone(),
            source_note_ids: note.source_note_ids.clone(),
            start_ms: note.start_ms,
            end_ms: note.start_ms + note.duration_ms,
        });
    }
    let mut diagnostics = compiled.diagnostics;
    diagnostics.push(Diagnostic::warning("notation_following_scope", "Measure intervals are half-open full-performance navigation. Written anchors include rests and tied continuations; sounding groups retain compiled attack identities. Duplicate written measure labels are not ordinal positions. Manual paging and the Rust playback clock remain independent.", None));
    let output = NotationNavigation {
        version: 1,
        source_measure_count: score.measures.len(),
        duration_ms: compiled.timeline.duration_ms,
        occurrences,
        sounding_groups,
        diagnostics,
    };
    serde_json::to_writer(ResponseSize::default(), &output).map_err(|error| error.to_string())?;
    Ok(output)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{Measure, Note, Pitch, Repeat, Tempo};
    fn score() -> Score {
        let mut score = crate::catalog().remove(0);
        score.parts[0].notes.clear();
        score.tempo[0].bpm = 120.;
        score.measures = vec![
            Measure {
                number: 7,
                at: Beat::ZERO,
                length: Beat::new(4, 1),
            },
            Measure {
                number: 7,
                at: Beat::new(4, 1),
                length: Beat::new(4, 1),
            },
        ];
        score
    }
    fn note(id: &str, at: Beat, duration: Beat) -> Note {
        Note {
            id: id.into(),
            at,
            duration,
            pitch: Some(Pitch {
                step: "C".into(),
                alter: 0,
                octave: 4,
            }),
            voice: "1".into(),
            staff: 1,
            velocity: 90,
            tie_start: false,
            tie_stop: false,
        }
    }
    #[test]
    fn exact_tempo_intervals_include_silent_measures_and_duplicate_labels() {
        let mut score = score();
        score.tempo.push(Tempo {
            at: Beat::new(2, 1),
            bpm: 60.,
        });
        let result = notation_navigation(score).unwrap();
        assert_eq!(result.occurrences.len(), 2);
        assert_eq!(result.source_measure_count, 2);
        assert_eq!(result.duration_ms, 7000.);
        assert_eq!(
            result
                .occurrences
                .iter()
                .map(|o| (
                    o.source_measure_index,
                    o.measure_number,
                    o.start_ms,
                    o.end_ms
                ))
                .collect::<Vec<_>>(),
            vec![(0, 7, 0., 3000.), (1, 7, 3000., 7000.)]
        );
        assert!(result.sounding_groups.is_empty());
        assert!(result
            .occurrences
            .iter()
            .all(|o| o.written_note_ids.is_empty() && o.continuing_note_ids.is_empty()));
    }
    #[test]
    fn repeat_identity_uses_original_region_order_and_timing_matches_compile_and_clicks() {
        let mut score = score();
        score.parts[0].notes = vec![
            note("opening", Beat::ZERO, Beat::new(1, 1)),
            note("ending", Beat::new(4, 1), Beat::new(1, 1)),
        ];
        score.repeats = vec![
            Repeat {
                from: Beat::new(4, 1),
                to: Beat::new(8, 1),
                times: 3,
            },
            Repeat {
                from: Beat::ZERO,
                to: Beat::new(4, 1),
                times: 2,
            },
        ];
        score.measures[1].number = 42;
        let before = serde_json::to_value(&score).unwrap();
        let compiled = crate::compile(score.clone()).unwrap();
        let clicks =
            crate::metronome::metronome_grid(score.clone(), crate::metronome::PulseMode::Quarter)
                .unwrap();
        let result = notation_navigation(score.clone()).unwrap();
        assert_eq!(result.duration_ms, compiled.timeline.duration_ms);
        assert_eq!(result.duration_ms, clicks.duration_ms);
        assert_eq!(
            result
                .occurrences
                .iter()
                .map(|o| (
                    o.source_measure_index,
                    o.repeat_region_index,
                    o.repeat_pass,
                    o.repeat_times
                ))
                .collect::<Vec<_>>(),
            vec![
                (0, Some(1), Some(1), Some(2)),
                (0, Some(1), Some(2), Some(2)),
                (1, Some(0), Some(1), Some(3)),
                (1, Some(0), Some(2), Some(3)),
                (1, Some(0), Some(3), Some(3))
            ]
        );
        assert_eq!(
            result
                .sounding_groups
                .iter()
                .map(|g| g.occurrence_id.clone())
                .collect::<Vec<_>>(),
            compiled
                .timeline
                .notes
                .iter()
                .map(|n| n.id.clone())
                .collect::<Vec<_>>()
        );
        for pair in result.occurrences.windows(2) {
            assert_eq!(pair[0].end_ms, pair[1].start_ms);
        }
        assert_eq!(
            result.occurrences.last().unwrap().end_ms,
            result.duration_ms
        );
        assert!(
            result
                .occurrences
                .iter()
                .all(|o| !(o.start_ms <= result.duration_ms && result.duration_ms < o.end_ms)),
            "Full duration is outside every half-open interval"
        );
        assert_eq!(serde_json::to_value(&score).unwrap(), before);
        assert_eq!(
            serde_json::to_value(crate::compile(score).unwrap()).unwrap(),
            serde_json::to_value(&compiled).unwrap()
        );
    }
    #[test]
    fn rational_boundaries_keep_written_rests_distinct_from_sounding_ties() {
        let mut score = score();
        score.measures = vec![
            Measure {
                number: 0,
                at: Beat::ZERO,
                length: Beat::new(1, 3),
            },
            Measure {
                number: 19,
                at: Beat::new(2, 6),
                length: Beat::new(2, 3),
            },
        ];
        let mut start = note("tie-start", Beat::ZERO, Beat::new(1, 3));
        start.tie_start = true;
        let mut stop = note("tie-stop", Beat::new(2, 6), Beat::new(2, 3));
        stop.tie_stop = true;
        let mut rest = note("written-rest", Beat::new(1, 6), Beat::new(1, 3));
        rest.pitch = None;
        rest.velocity = 0;
        score.parts[0].notes = vec![stop, rest, start];
        let result = notation_navigation(score).unwrap();
        assert_eq!(
            result.occurrences[0].written_note_ids,
            vec!["tie-start", "written-rest"]
        );
        assert_eq!(result.occurrences[1].written_note_ids, vec!["tie-stop"]);
        assert_eq!(
            result.occurrences[1].continuing_note_ids,
            vec!["written-rest"]
        );
        assert_eq!(result.sounding_groups.len(), 1);
        assert_eq!(
            result.sounding_groups[0].source_note_ids,
            vec!["tie-start", "tie-stop"]
        );
        assert_eq!(result.sounding_groups[0].start_ms, 0.);
        assert_eq!(result.sounding_groups[0].end_ms, 500.);
        assert_eq!(result.occurrences[0].source_measure_index, 0);
        assert_eq!(result.occurrences[0].measure_number, 0);
    }
    #[test]
    fn long_written_notes_span_measures_without_becoming_repeated_attacks() {
        let mut score = score();
        score.parts[0].notes = vec![note("long", Beat::new(1, 1), Beat::new(6, 1))];
        let result = notation_navigation(score).unwrap();
        assert_eq!(result.occurrences[0].written_note_ids, vec!["long"]);
        assert!(result.occurrences[1].written_note_ids.is_empty());
        assert_eq!(result.occurrences[1].continuing_note_ids, vec!["long"]);
        assert_eq!(result.sounding_groups.len(), 1);
    }
    #[test]
    fn partial_measure_repeat_intervals_are_clipped_exactly_without_inventing_measures() {
        let mut score = score();
        score.parts[0].notes = vec![note("repeat-note", Beat::new(1, 1), Beat::new(1, 1))];
        score.repeats = vec![Repeat {
            from: Beat::new(1, 1),
            to: Beat::new(3, 1),
            times: 2,
        }];
        let result = notation_navigation(score).unwrap();
        assert_eq!(
            result
                .occurrences
                .iter()
                .map(|o| (
                    o.source_measure_index,
                    o.source_from.value(),
                    o.source_to.value(),
                    o.repeat_pass
                ))
                .collect::<Vec<_>>(),
            vec![
                (0, 0., 1., None),
                (0, 1., 3., Some(1)),
                (0, 1., 3., Some(2)),
                (0, 3., 4., None),
                (1, 4., 8., None)
            ]
        );
        assert_eq!(
            result
                .occurrences
                .iter()
                .map(|o| o.written_note_ids.len())
                .collect::<Vec<_>>(),
            vec![0, 1, 1, 0, 0]
        );
        assert_eq!(result.duration_ms, 5000.);
    }
    #[test]
    fn repeated_tie_groups_keep_one_attack_and_complete_written_anchors_per_pass() {
        let mut score = score();
        let mut start = note("tie-a", Beat::ZERO, Beat::new(4, 1));
        start.tie_start = true;
        let mut end = note("tie-b", Beat::new(4, 1), Beat::new(4, 1));
        end.tie_stop = true;
        score.parts[0].notes = vec![start, end];
        score.repeats = vec![Repeat {
            from: Beat::ZERO,
            to: Beat::new(8, 1),
            times: 2,
        }];
        let result = notation_navigation(score).unwrap();
        assert_eq!(
            result
                .occurrences
                .iter()
                .map(|o| o.written_note_ids.clone())
                .collect::<Vec<_>>(),
            vec![vec!["tie-a"], vec!["tie-b"], vec!["tie-a"], vec!["tie-b"]]
        );
        assert_eq!(result.sounding_groups.len(), 2);
        assert_ne!(
            result.sounding_groups[0].occurrence_id,
            result.sounding_groups[1].occurrence_id
        );
        assert!(result
            .sounding_groups
            .iter()
            .all(|g| g.source_note_ids == vec!["tie-a", "tie-b"]));
        assert_eq!(result.sounding_groups[1].start_ms, 4000.);
    }
    #[test]
    fn incomplete_or_unordered_measure_maps_fail_without_repairing_the_score() {
        for kind in 0..4 {
            let mut score = score();
            match kind {
                0 => score.measures.clear(),
                1 => score.measures.reverse(),
                2 => score.measures[1].at = Beat::new(5, 1),
                _ => score.parts[0]
                    .notes
                    .push(note("outside", Beat::new(8, 1), Beat::new(1, 1))),
            }
            let before = serde_json::to_value(&score).unwrap();
            assert!(notation_navigation(score.clone())
                .unwrap_err()
                .contains("measure"));
            assert_eq!(serde_json::to_value(score).unwrap(), before);
        }
    }
    #[test]
    fn repeated_written_anchor_order_is_stable_and_preserves_polyphonic_ids() {
        let mut score = score();
        score.parts[0].notes = vec![
            note("z", Beat::ZERO, Beat::new(1, 1)),
            note("a", Beat::ZERO, Beat::new(1, 1)),
        ];
        score.repeats.push(Repeat {
            from: Beat::ZERO,
            to: Beat::new(4, 1),
            times: 2,
        });
        let result = notation_navigation(score).unwrap();
        assert_eq!(result.occurrences[0].written_note_ids, vec!["a", "z"]);
        assert_eq!(result.occurrences[1].written_note_ids, vec!["a", "z"]);
        assert_eq!(
            result.sounding_groups.len(),
            4,
            "Navigation never groups physical unisons"
        );
    }
    #[test]
    fn expanded_interval_and_reference_limits_refuse_instead_of_truncating() {
        use std::io::Write;
        let mut size = ResponseSize(MAX_BYTES - 1);
        assert!(size
            .write_all(b"12")
            .unwrap_err()
            .to_string()
            .contains("16 MiB"));
        assert_eq!(size.0, MAX_BYTES - 1);
        let mut count = MAX_REFERENCES;
        assert!(count_references(&mut count, 1)
            .unwrap_err()
            .contains("references"));
        let mut score = score();
        score.measures = (0..50_001)
            .map(|index| Measure {
                number: index,
                at: Beat::new(index.into(), 1),
                length: Beat::new(1, 1),
            })
            .collect();
        score.repeats = vec![Repeat {
            from: Beat::ZERO,
            to: Beat::new(50_001, 1),
            times: 2,
        }];
        assert!(notation_navigation(score)
            .unwrap_err()
            .contains("100,000 intervals"));
    }
}
