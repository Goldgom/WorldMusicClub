//! Explain deterministic assessment results without mistaking device latency for playing skill.
use crate::{Diagnostic, Hit};
use serde::{Deserialize, Serialize};
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
}
