//! Coverage counters for an assessed snapshot. These are not a live game combo.
use crate::{Hit, Timeline};
use serde::{Deserialize, Serialize};
use std::collections::HashSet;

#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct GradeCounts {
    pub perfect: usize,
    pub good: usize,
    pub early: usize,
    pub late: usize,
    pub missed: usize,
    pub extra: usize,
}

#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct OnsetCompletion {
    /// Exact simultaneous groups in the submitted physical-target timeline.
    pub total: usize,
    /// Groups where every required attack matched, regardless of timing grade.
    pub complete: usize,
    /// Coverage in expected score order. Extras affect accuracy separately.
    pub longest_complete_sequence: usize,
}

pub(crate) fn grade_counts(hits: &[Hit], expected: usize, extras: usize) -> GradeCounts {
    let mut result = GradeCounts {
        missed: expected - hits.len(),
        extra: extras,
        ..GradeCounts::default()
    };
    for hit in hits {
        match hit.grade.as_str() {
            "perfect" => result.perfect += 1,
            "good" => result.good += 1,
            "early" => result.early += 1,
            "late" => result.late += 1,
            _ => unreachable!("The Rust matcher only emits the four documented grades"),
        }
    }
    result
}

pub(crate) fn onset_completion(timeline: &Timeline, matched: &HashSet<usize>) -> OnsetCompletion {
    let mut indices: Vec<_> = (0..timeline.notes.len()).collect();
    // Normalize signed zero for ordering; exact equality below also equates ±0.
    let time = |i: usize| {
        let value = timeline.notes[i].start_ms;
        if value == 0. {
            0.
        } else {
            value
        }
    };
    indices.sort_by(|a, b| time(*a).total_cmp(&time(*b)).then(a.cmp(b)));
    let mut result = OnsetCompletion::default();
    let mut run = 0;
    let mut first = 0;
    while first < indices.len() {
        let at = time(indices[first]);
        let mut end = first + 1;
        while end < indices.len() && time(indices[end]) == at {
            end += 1;
        }
        result.total += 1;
        // Indices preserve separate targets even when a caller supplied duplicate IDs.
        if indices[first..end].iter().all(|i| matched.contains(i)) {
            result.complete += 1;
            run += 1;
            result.longest_complete_sequence = result.longest_complete_sequence.max(run);
        } else {
            run = 0;
        }
        first = end;
    }
    result
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{assess, InputEvent};

    fn timeline(events: &[(u8, f64)]) -> Timeline {
        let template = crate::compile(crate::catalog().remove(0))
            .unwrap()
            .timeline
            .notes
            .remove(0);
        Timeline {
            notes: events
                .iter()
                .enumerate()
                .map(|(i, (midi, at))| {
                    let mut note = template.clone();
                    note.id = format!("target-{i}");
                    note.midi = *midi;
                    note.start_ms = *at;
                    note.duration_ms = 100.;
                    note
                })
                .collect(),
            duration_ms: 10000.,
        }
    }
    fn input(midi: u8, at_ms: f64) -> InputEvent {
        InputEvent {
            midi,
            at_ms,
            velocity: 90,
        }
    }

    #[test]
    fn exclusive_grade_boundaries_do_not_reuse_bias_counters() {
        let deltas = [
            -100., -65.001, -65., -25.001, -25., 0., 25., 25.001, 65., 65.001, 100.,
        ];
        let targets = timeline(
            &(0..deltas.len())
                .map(|i| (60 + i as u8, 1000.))
                .collect::<Vec<_>>(),
        );
        let inputs = deltas
            .iter()
            .enumerate()
            .map(|(i, delta)| input(60 + i as u8, 1000. + delta))
            .collect::<Vec<_>>();
        let result = assess(&targets, &inputs, 100.).unwrap();
        assert_eq!(
            result.grade_counts.unwrap(),
            GradeCounts {
                perfect: 3,
                good: 4,
                early: 2,
                late: 2,
                missed: 0,
                extra: 0
            }
        );
        assert_eq!(
            result.summary.early_hits, 4,
            "Bias counts include some good hits; grade counts do not"
        );
        assert_eq!(
            result.onset_completion.unwrap(),
            OnsetCompletion {
                total: 1,
                complete: 1,
                longest_complete_sequence: 1
            }
        );
    }

    #[test]
    fn partial_chords_reset_score_order_sequence_even_with_duplicate_ids() {
        let mut targets = timeline(&[(60, 0.), (62, 100.), (64, 100.), (65, 200.), (67, 300.)]);
        targets.notes[2].id = targets.notes[1].id.clone();
        let inputs = [
            input(60, 0.),
            input(62, 100.),
            input(65, 200.),
            input(67, 300.),
        ];
        let result = assess(&targets, &inputs, 10.).unwrap();
        assert_eq!(
            result.onset_completion.unwrap(),
            OnsetCompletion {
                total: 4,
                complete: 3,
                longest_complete_sequence: 2
            }
        );
        assert_eq!(result.grade_counts.unwrap().missed, 1);
    }

    #[test]
    fn early_late_crossings_and_unsorted_targets_keep_expected_order() {
        let targets = timeline(&[(64, 300.), (60, 100.), (62, 200.)]);
        let result = assess(&targets, &[input(64, 130.), input(60, 270.)], 180.).unwrap();
        assert_eq!(
            result.hits[0].midi, 64,
            "The later expected target was played first"
        );
        assert_eq!(
            result.onset_completion.unwrap(),
            OnsetCompletion {
                total: 3,
                complete: 2,
                longest_complete_sequence: 1
            }
        );
    }

    #[test]
    fn extras_change_accuracy_but_not_complete_onset_coverage() {
        let targets = timeline(&[(60, 100.), (64, 100.), (65, 300.)]);
        let mut inputs = vec![input(60, 100.), input(64, 100.), input(65, 300.)];
        let before = assess(&targets, &inputs, 10.).unwrap();
        inputs.extend([-20., 100., 200., 400.].map(|at| input(90, at)));
        inputs.push(InputEvent {
            midi: 60,
            at_ms: 500.,
            velocity: 0,
        });
        let after = assess(&targets, &inputs, 10.).unwrap();
        assert_eq!(before.onset_completion, after.onset_completion);
        assert!(after.accuracy_percent < before.accuracy_percent);
        assert_eq!(after.grade_counts.unwrap().extra, 4);
    }

    #[test]
    fn signed_zero_groups_but_neighboring_attacks_remain_distinct() {
        let targets = timeline(&[(60, -0.), (64, 0.), (60, 0.000_001)]);
        let result = assess(
            &targets,
            &[input(60, 0.), input(64, 0.), input(60, 0.000_001)],
            180.,
        )
        .unwrap();
        assert_eq!(
            result.onset_completion.unwrap(),
            OnsetCompletion {
                total: 2,
                complete: 2,
                longest_complete_sequence: 2
            }
        );
        assert_eq!(result.grade_counts.unwrap().perfect, 3);
    }

    #[test]
    fn empty_and_legacy_results_do_not_invent_completion() {
        for inputs in [vec![], vec![input(60, 0.)]] {
            let result = assess(&timeline(&[]), &inputs, 180.).unwrap();
            assert_eq!(result.onset_completion, Some(OnsetCompletion::default()));
            assert_eq!(result.grade_counts.as_ref().unwrap().extra, inputs.len());
            let mut old = serde_json::to_value(&result).unwrap();
            old.as_object_mut().unwrap().remove("grade_counts");
            old.as_object_mut().unwrap().remove("onset_completion");
            let loaded: crate::Assessment = serde_json::from_value(old).unwrap();
            assert!(loaded.grade_counts.is_none() && loaded.onset_completion.is_none());
        }
    }
}
