//! Explicit subdivision clicks on the same exact written/repeat navigation as playback.
use crate::{Beat, Diagnostic, Score, TempoIndex};
use serde::{Deserialize, Serialize};
const MAX_CLICKS: usize = 100_000;

#[derive(Clone, Copy, Debug, Default, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum PulseMode {
    #[default]
    NotatedUnit,
    Quarter,
    DottedQuarter,
}
#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct Click {
    pub id: String,
    pub source_tick_id: String,
    pub source_at: Beat,
    pub start_ms: f64,
    pub measure_number: u32,
    pub unit_index: u32,
    /// A written measure boundary, not inferred metric stress (especially for pickups).
    pub accent: bool,
}
#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct MetronomeGrid {
    pub ticks: Vec<Click>,
    pub duration_ms: f64,
    pub pulse: PulseMode,
    pub accent_policy: String,
    pub diagnostics: Vec<Diagnostic>,
}

pub fn metronome_grid(score: Score, pulse: PulseMode) -> Result<MetronomeGrid, String> {
    let compiled = crate::compile(score)?;
    let duration_ms = compiled.timeline.duration_ms;
    let score = compiled.score;
    let mut diagnostics = compiled.diagnostics;
    drop(compiled.timeline);
    let total = crate::written_duration(&score);
    if score.measures.is_empty() {
        return Err("Metronome requires an explicit complete measure map; normal score playback remains available".into());
    }
    let mut measures: Vec<_> = score.measures.iter().collect();
    measures.sort_by(|a, b| a.at.compare(b.at));
    let mut cursor = Beat::ZERO;
    for measure in &measures {
        if !measure.at.equivalent(cursor) {
            return Err("Metronome requires contiguous non-overlapping written measures; correct the measure map without changing note timing".into());
        }
        cursor = measure.at.checked_add(measure.length).expect("validated");
    }
    if !cursor.equivalent(total) {
        return Err("Metronome measure map does not cover the complete score".into());
    }
    let mut meters: Vec<_> = score.meters.iter().collect();
    meters.sort_by(|a, b| a.at.compare(b.at));
    if meters
        .windows(2)
        .any(|pair| pair[0].at.equivalent(pair[1].at))
    {
        return Err(
            "Metronome cannot choose between duplicate time signatures at the same beat".into(),
        );
    }
    if pulse == PulseMode::NotatedUnit
        && !meters.first().is_some_and(|m| m.at.equivalent(Beat::ZERO))
    {
        return Err("Notated-unit clicks require a time signature at beat zero; choose explicit quarter-note clicks instead".into());
    }
    for meter in &meters {
        if meter.at.compare(total).is_lt()
            && measures
                .binary_search_by(|m| m.at.compare(meter.at))
                .is_err()
        {
            return Err("A time-signature change inside a measure has an ambiguous click phase; correct the measure map first".into());
        }
    }
    let tempo = TempoIndex::new(&score.tempo);
    let mut written = vec![];
    let mut irregular = false;
    let mut compound = false;
    for (measure_index, measure) in measures.iter().enumerate() {
        let meter_index = meters.partition_point(|m| m.at.compare(measure.at).is_le());
        let meter = meter_index.checked_sub(1).map(|index| meters[index]);
        let unit = match pulse {
            PulseMode::Quarter => Beat::new(1, 1),
            PulseMode::DottedQuarter => Beat::new(3, 2),
            PulseMode::NotatedUnit => {
                Beat::new(4, i64::from(meter.expect("initial signature").denominator))
            }
        };
        if let Some(meter) = meter {
            let nominal = Beat::new(i64::from(meter.numerator) * 4, i64::from(meter.denominator));
            irregular |= !measure.length.equivalent(nominal);
            compound |= meter.denominator == 8 && meter.numerator >= 6 && meter.numerator % 3 == 0;
        }
        let numerator = measure.length.numerator as i128 * unit.denominator as i128;
        let denominator = measure.length.denominator as i128 * unit.numerator as i128;
        let count = (numerator + denominator - 1) / denominator;
        if count > MAX_CLICKS.saturating_sub(written.len()) as i128 {
            return Err("Metronome exceeds 100,000 subdivision clicks; use a shorter score or coarser pulse".into());
        }
        let mut at = measure.at;
        for unit_index in 0..count as u32 {
            let source_tick_id = format!("measure-{}-unit-{unit_index}", measure_index + 1);
            written.push(Click {
                id: source_tick_id.clone(),
                source_tick_id,
                source_at: at,
                start_ms: tempo.at(at.value()),
                measure_number: measure.number,
                unit_index,
                accent: unit_index == 0,
            });
            if unit_index + 1 < count as u32 {
                at = at.checked_add(unit).ok_or(
                    "Click positions exceed exact rational limits; choose a coarser subdivision",
                )?;
            }
        }
    }
    if irregular {
        diagnostics.push(Diagnostic::warning("metronome_irregular_measures","Some written measures are shorter/longer than the active meter, such as pickups or fragments. Clicks restart at written boundaries; accents identify those boundaries, not inferred strong beats.",None));
    }
    if compound {
        diagnostics.push(Diagnostic::warning("metronome_compound_policy","The selected pulse is explicit: notated-unit mode clicks each eighth in 6/8-like meters, whereas dotted-quarter mode groups three eighths. No beat convention or tempo unit was silently changed.",None));
    }
    let mut ticks = vec![];
    let mut offset = 0.;
    for segment in crate::navigation_segments(&score, total)? {
        let (start, end) = (segment.start, segment.end);
        let first = written.partition_point(|tick| tick.source_at.compare(start).is_lt());
        let last = written.partition_point(|tick| tick.source_at.compare(end).is_lt());
        if ticks.len() + last - first > MAX_CLICKS {
            return Err("Repeat-expanded metronome exceeds 100,000 clicks; use a shorter score or coarser pulse".into());
        }
        let start_ms = tempo.at(start.value());
        for source in &written[first..last] {
            let mut tick = source.clone();
            tick.id = format!("click-occurrence-{}", ticks.len());
            tick.start_ms = offset + source.start_ms - start_ms;
            ticks.push(tick);
        }
        offset += tempo.at(end.value()) - start_ms;
    }
    Ok(MetronomeGrid {
        ticks,
        duration_ms,
        pulse,
        accent_policy: "written_measure_boundary".into(),
        diagnostics,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{Measure, Meter, Repeat, Tempo};
    fn score() -> Score {
        let mut s = crate::catalog().remove(0);
        s.parts[0].notes.truncate(1);
        s.tempo[0].bpm = 120.;
        s
    }
    #[test]
    fn quarter_grid_integrates_changes_and_preserves_the_original_score() {
        let mut s = score();
        s.tempo.push(Tempo {
            at: Beat::new(1, 1),
            bpm: 60.,
        });
        let before = serde_json::to_value(&s).unwrap();
        let grid = metronome_grid(s.clone(), PulseMode::Quarter).unwrap();
        assert_eq!(grid.ticks.len(), 16);
        assert_eq!(
            grid.ticks
                .iter()
                .take(3)
                .map(|t| t.start_ms)
                .collect::<Vec<_>>(),
            vec![0., 500., 1500.]
        );
        assert_eq!(before, serde_json::to_value(&s).unwrap());
    }
    #[test]
    fn compound_subdivision_is_explicit_and_never_assumed() {
        let mut s = score();
        s.meters[0] = Meter {
            at: Beat::ZERO,
            numerator: 6,
            denominator: 8,
        };
        s.measures = vec![
            Measure {
                number: 1,
                at: Beat::ZERO,
                length: Beat::new(3, 1),
            },
            Measure {
                number: 2,
                at: Beat::new(3, 1),
                length: Beat::new(3, 1),
            },
        ];
        let eighths = metronome_grid(s.clone(), PulseMode::NotatedUnit).unwrap();
        assert_eq!(eighths.ticks.len(), 12);
        assert_eq!(eighths.ticks[1].start_ms, 250.);
        let dotted = metronome_grid(s, PulseMode::DottedQuarter).unwrap();
        assert_eq!(dotted.ticks.len(), 4);
        assert_eq!(dotted.ticks[1].start_ms, 750.);
        assert!(dotted
            .diagnostics
            .iter()
            .any(|d| d.code == "metronome_compound_policy"));
    }
    #[test]
    fn meter_change_at_a_written_boundary_changes_denominator_pulses() {
        let mut s = score();
        s.measures = vec![
            Measure {
                number: 1,
                at: Beat::ZERO,
                length: Beat::new(4, 1),
            },
            Measure {
                number: 2,
                at: Beat::new(4, 1),
                length: Beat::new(3, 2),
            },
        ];
        s.meters.push(Meter {
            at: Beat::new(4, 1),
            numerator: 3,
            denominator: 8,
        });
        let g = metronome_grid(s, PulseMode::NotatedUnit).unwrap();
        assert_eq!(g.ticks.len(), 7);
        assert!(g.ticks[5].source_at.equivalent(Beat::new(9, 2)));
        assert_eq!(g.ticks.iter().filter(|t| t.accent).count(), 2);
    }
    #[test]
    fn pickups_keep_written_positions_and_explain_boundary_accents() {
        let mut s = score();
        s.measures = vec![
            Measure {
                number: 0,
                at: Beat::ZERO,
                length: Beat::new(1, 1),
            },
            Measure {
                number: 1,
                at: Beat::new(1, 1),
                length: Beat::new(4, 1),
            },
        ];
        let g = metronome_grid(s, PulseMode::Quarter).unwrap();
        assert_eq!(g.ticks.len(), 5);
        assert!(g.ticks[1].source_at.equivalent(Beat::new(1, 1)));
        assert!(g
            .diagnostics
            .iter()
            .any(|d| d.code == "metronome_irregular_measures"));
    }
    #[test]
    fn repeat_membership_uses_the_same_exact_half_open_navigation_as_notes() {
        let mut s = score();
        s.parts[0].notes[0].pitch = None;
        s.measures.truncate(1);
        s.repeats.push(Repeat {
            from: Beat::new(1, 2),
            to: Beat::new(3, 2),
            times: 2,
        });
        let g = metronome_grid(s, PulseMode::Quarter).unwrap();
        assert_eq!(
            g.ticks.iter().map(|t| t.start_ms).collect::<Vec<_>>(),
            vec![0., 500., 1000., 1500., 2000.]
        );
        assert_eq!(g.ticks[1].source_tick_id, g.ticks[2].source_tick_id);
        assert_ne!(g.ticks[1].id, g.ticks[2].id);
        assert_eq!(g.duration_ms, 2500.);
    }
    #[test]
    fn incomplete_maps_and_oversized_grids_fail_without_silent_truncation() {
        let mut s = score();
        s.measures[0].at = Beat::new(1, 1);
        assert!(metronome_grid(s, PulseMode::Quarter)
            .unwrap_err()
            .contains("contiguous"));
        let mut s = score();
        s.meters.push(Meter {
            at: Beat::new(2, 1),
            numerator: 3,
            denominator: 4,
        });
        assert!(metronome_grid(s, PulseMode::NotatedUnit)
            .unwrap_err()
            .contains("inside a measure"));
        let mut s = score();
        s.measures = vec![Measure {
            number: 1,
            at: Beat::ZERO,
            length: Beat::new(100_001, 1),
        }];
        assert!(metronome_grid(s, PulseMode::Quarter)
            .unwrap_err()
            .contains("100,000"));
    }
}
