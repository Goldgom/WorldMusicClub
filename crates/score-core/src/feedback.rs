//! Explain deterministic assessment results without mistaking device latency for playing skill.
use crate::{Diagnostic, Hit, InputEvent, Timeline};
use serde::{Deserialize, Serialize};
/// Pitch-only onset statistics. These do not infer fingering or wrong-note substitutions.
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct PitchFeedback {
    pub midi: u8,
    pub expected: usize,
    pub matched: usize,
    pub missed: usize,
    pub extra: usize,
    pub mean_abs_error_ms: Option<f64>,
    pub timing_bias_ms: Option<f64>,
}

pub(crate) fn pitch_breakdown(
    timeline: &Timeline,
    hits: &[Hit],
    extras: &[InputEvent],
) -> Vec<PitchFeedback> {
    let mut rows: Vec<_> = (0..=127)
        .map(|midi| PitchFeedback {
            midi,
            expected: 0,
            matched: 0,
            missed: 0,
            extra: 0,
            mean_abs_error_ms: None,
            timing_bias_ms: None,
        })
        .collect();
    let mut signed_error = [0.; 128];
    let mut absolute_error = [0.; 128];
    for note in &timeline.notes {
        rows[note.midi as usize].expected += 1;
    }
    for hit in hits {
        let index = hit.midi as usize;
        rows[index].matched += 1;
        signed_error[index] += hit.delta_ms;
        absolute_error[index] += hit.delta_ms.abs();
    }
    for event in extras {
        rows[event.midi as usize].extra += 1;
    }
    for row in &mut rows {
        row.missed = row.expected - row.matched;
        if row.matched > 0 {
            row.mean_abs_error_ms = Some(absolute_error[row.midi as usize] / row.matched as f64);
            row.timing_bias_ms = Some(signed_error[row.midi as usize] / row.matched as f64);
        }
    }
    rows.retain(|row| row.expected > 0 || row.extra > 0);
    rows
}
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct PerformanceSummary {
    pub expected_notes: usize,
    pub matched_notes: usize,
    pub coverage_percent: f64,
    pub timing_bias_ms: Option<f64>,
    pub timing_stddev_ms: Option<f64>,
    pub early_hits: usize,
    pub late_hits: usize,
    pub advice: Vec<Diagnostic>,
}
pub fn summarize(
    hits: &[Hit],
    expected: usize,
    extras: usize,
    tolerance_ms: f64,
) -> PerformanceSummary {
    let bias = (!hits.is_empty())
        .then(|| hits.iter().map(|h| h.delta_ms).sum::<f64>() / hits.len() as f64);
    let deviation = bias.map(|mean| {
        (hits
            .iter()
            .map(|h| (h.delta_ms - mean).powi(2))
            .sum::<f64>()
            / hits.len() as f64)
            .sqrt()
    });
    let mut advice = vec![];
    if expected == 0 {
        advice.push(Diagnostic::warning("no_targets","This selection has no sounding onset targets. Choose a range containing notes before interpreting the score.",None));
    } else if hits.len() < expected && (expected - hits.len()) as f64 / expected as f64 >= 0.25 {
        advice.push(Diagnostic::warning("missed_targets","Several expected onsets were not matched. Try a slower tempo or a shorter loop, and check that your instrument range includes the selected part.",None));
    }
    if extras > 0 {
        advice.push(Diagnostic::warning("extra_onsets",format!("{extras} extra note-on events were unmatched. Compare the played pitches with the selected part; note-off events are not counted as extra notes."),None));
    }
    if hits.len() >= 5 {
        if let Some(value) = bias.filter(|v| v.abs() > tolerance_ms * 0.25) {
            advice.push(Diagnostic::warning("timing_bias",format!("Matched onsets average {:.0} ms {}. Check audio/MIDI latency calibration before treating this as a playing habit.",value.abs(),if value<0.{"early"}else{"late"}),None));
        }
        if deviation.is_some_and(|v| v > tolerance_ms * 0.35) {
            advice.push(Diagnostic::warning("variable_timing","Matched onset timing varies. Isolate a short phrase and reduce tempo before increasing speed.",None));
        }
    } else if !hits.is_empty() {
        advice.push(Diagnostic::warning("small_sample","Fewer than five matched onsets: timing averages are descriptive, not a reliable practice trend.",None));
    }
    PerformanceSummary {
        expected_notes: expected,
        matched_notes: hits.len(),
        coverage_percent: if expected == 0 {
            0.
        } else {
            100. * hits.len() as f64 / expected as f64
        },
        timing_bias_ms: bias,
        timing_stddev_ms: deviation,
        early_hits: hits
            .iter()
            .filter(|h| h.delta_ms < -tolerance_ms * 0.25)
            .count(),
        late_hits: hits
            .iter()
            .filter(|h| h.delta_ms > tolerance_ms * 0.25)
            .count(),
        advice,
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    fn hit(delta: f64) -> Hit {
        Hit {
            note_id: "n".into(),
            midi: 60,
            expected_ms: 100.,
            actual_ms: 100. + delta,
            delta_ms: delta,
            grade: "good".into(),
        }
    }
    #[test]
    fn bias_sign_and_variability_are_explained_with_calibration_caution() {
        let s = summarize(&vec![hit(-60.); 8], 8, 0, 180.);
        assert_eq!(s.timing_bias_ms, Some(-60.));
        assert_eq!(s.timing_stddev_ms, Some(0.));
        assert_eq!(s.early_hits, 8);
        assert!(s
            .advice
            .iter()
            .any(|d| d.code == "timing_bias" && d.message.contains("latency")));
    }
    #[test]
    fn small_or_empty_samples_do_not_imply_successful_practice() {
        let empty = summarize(&[], 0, 0, 180.);
        assert_eq!(empty.coverage_percent, 0.);
        assert_eq!(empty.timing_bias_ms, None);
        assert_eq!(empty.advice[0].code, "no_targets");
        let small = summarize(&[hit(80.)], 2, 1, 180.);
        assert!(small.advice.iter().any(|d| d.code == "small_sample"));
        assert!(!small.advice.iter().any(|d| d.code == "timing_bias"));
    }
    #[test]
    fn unstable_onsets_and_missing_pitches_produce_separate_advice() {
        let hits = (0..8)
            .map(|i| hit(if i % 2 == 0 { -100. } else { 100. }))
            .collect::<Vec<_>>();
        let s = summarize(&hits, 12, 2, 180.);
        assert_eq!(s.timing_bias_ms, Some(0.));
        assert_eq!(s.timing_stddev_ms, Some(100.));
        assert!(s.advice.iter().any(|d| d.code == "variable_timing"));
        assert!(s.advice.iter().any(|d| d.code == "missed_targets"));
        assert!(s.advice.iter().any(|d| d.code == "extra_onsets"));
    }
    #[test]
    fn pitch_rows_keep_missing_and_extra_attacks_separate_with_signed_timing() {
        let mut timeline = crate::compile(crate::catalog().remove(0)).unwrap().timeline;
        timeline.notes.truncate(4);
        for (index, (note, midi)) in timeline.notes.iter_mut().zip([60, 60, 62, 64]).enumerate() {
            note.midi = midi;
            note.start_ms = index as f64 * 500.;
        }
        let inputs = [
            (60, 20., 90),
            (60, 480., 90),
            (61, 1000., 90),
            (64, 1500., 0),
            (67, 2000., 90),
            (66, 1700., 0),
        ]
        .map(|(midi, at_ms, velocity)| InputEvent {
            midi,
            at_ms,
            velocity,
        });
        let result = crate::assess(&timeline, &inputs, 180.).unwrap();
        let rows = &result.pitch_breakdown;
        assert_eq!(
            rows.iter().map(|r| r.midi).collect::<Vec<_>>(),
            vec![60, 61, 62, 64, 67]
        );
        assert_eq!(
            (
                rows[0].expected,
                rows[0].matched,
                rows[0].missed,
                rows[0].extra
            ),
            (2, 2, 0, 0)
        );
        assert_eq!(rows[0].mean_abs_error_ms, Some(20.));
        assert_eq!(rows[0].timing_bias_ms, Some(0.));
        assert_eq!(
            (rows[1].expected, rows[1].extra),
            (0, 1),
            "An unexpected pitch is not an inferred substitution"
        );
        assert_eq!((rows[2].expected, rows[2].missed, rows[2].extra), (1, 1, 0));
        assert_eq!(rows[3].missed, 1, "A note-off cannot satisfy an onset");
        assert!(rows[1..]
            .iter()
            .all(|r| r.mean_abs_error_ms.is_none() && r.timing_bias_ms.is_none()));
        assert_eq!(
            rows.iter().map(|r| r.expected).sum::<usize>(),
            timeline.notes.len()
        );
        assert_eq!(
            rows.iter().map(|r| r.matched).sum::<usize>(),
            result.hits.len()
        );
        assert_eq!(
            rows.iter().map(|r| r.missed).sum::<usize>(),
            result.misses.len()
        );
        assert_eq!(
            rows.iter().map(|r| r.extra).sum::<usize>(),
            result.extras.len()
        );
    }
    #[test]
    fn extra_only_pitch_rows_and_older_assessment_exports_stay_explicit() {
        let timeline = Timeline {
            notes: vec![],
            duration_ms: 1000.,
        };
        let result = crate::assess(
            &timeline,
            &[InputEvent {
                midi: 72,
                at_ms: 100.,
                velocity: 90,
            }],
            180.,
        )
        .unwrap();
        assert_eq!(result.pitch_breakdown.len(), 1);
        let row = &result.pitch_breakdown[0];
        assert_eq!(
            (row.midi, row.expected, row.matched, row.missed, row.extra),
            (72, 0, 0, 0, 1)
        );
        assert_eq!(row.timing_bias_ms, None);
        let mut legacy = serde_json::to_value(&result).unwrap();
        legacy.as_object_mut().unwrap().remove("pitch_breakdown");
        let loaded: crate::Assessment = serde_json::from_value(legacy).unwrap();
        assert!(loaded.pitch_breakdown.is_empty());
        assert_eq!(loaded.extras.len(), 1);
    }
}
