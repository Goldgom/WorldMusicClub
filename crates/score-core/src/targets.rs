//! Physical note-on targets are a derived view; the written and sounding score stays intact.
use crate::{
    instruments::{analyze_instrument, InstrumentProfile},
    Diagnostic, Timeline,
};
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};

#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct TargetGroup {
    pub target_id: String,
    pub source_occurrence_ids: Vec<String>,
    pub source_note_ids: Vec<String>,
    pub part_ids: Vec<String>,
}
#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct PracticeTargets {
    pub timeline: Timeline,
    pub groups: Vec<TargetGroup>,
    pub diagnostics: Vec<Diagnostic>,
    /// Number of sounding input events before physical grouping, not written tied segments.
    pub source_note_count: usize,
    pub target_count: usize,
    pub playable: bool,
}

pub fn plan_targets(
    timeline: &Timeline,
    profile: &InstrumentProfile,
) -> Result<PracticeTargets, String> {
    if timeline.notes.len() > 100_000
        || !timeline.duration_ms.is_finite()
        || timeline.duration_ms < 0.
    {
        return Err("Invalid target timeline size or duration".into());
    }
    let mut ids = HashSet::new();
    let mut references = 0_usize;
    for note in &timeline.notes {
        references = references.saturating_add(note.source_note_ids.len());
        if note.id.is_empty()
            || note.id.len() > 128
            || !ids.insert(&note.id)
            || note.source_note_id.len() > 128
            || note.part_id.is_empty()
            || note.part_id.len() > 128
            || note.voice.len() > 64
            || note
                .source_note_ids
                .iter()
                .any(|id| id.is_empty() || id.len() > 128)
            || references > 1_000_000
            || note.velocity > 127
            || !note.start_ms.is_finite()
            || !note.duration_ms.is_finite()
            || note.start_ms < 0.
            || note.duration_ms <= 0.
            || note.start_ms + note.duration_ms > timeline.duration_ms + 0.001
        {
            return Err(
                "Invalid physical target identifiers, source references or note timing".into(),
            );
        }
    }
    let report = analyze_instrument(timeline, profile)?;
    let playable = !timeline.notes.is_empty()
        && report.note_options.iter().all(|n| n.playable)
        && !report
            .diagnostics
            .iter()
            .any(|d| d.code == "guitar_string_conflict");
    let piano = matches!(profile, InstrumentProfile::Piano { .. });
    let mut ordered: Vec<_> = timeline.notes.iter().collect();
    ordered.sort_by(|a, b| {
        a.start_ms
            .total_cmp(&b.start_ms)
            .then(a.midi.cmp(&b.midi))
            .then(a.id.cmp(&b.id))
    });
    let mut notes: Vec<crate::TimedNote> = vec![];
    let mut groups: Vec<TargetGroup> = vec![];
    let mut keys = HashMap::new();
    for note in ordered {
        let key = (note.start_ms.max(0.).to_bits(), note.midi);
        let index = if piano { keys.get(&key).copied() } else { None };
        let sources = if note.source_note_ids.is_empty() {
            vec![if note.source_note_id.is_empty() {
                note.id.clone()
            } else {
                note.source_note_id.clone()
            }]
        } else {
            note.source_note_ids.clone()
        };
        if let Some(index) = index {
            let target: &mut crate::TimedNote = &mut notes[index];
            target.duration_ms = target.duration_ms.max(note.duration_ms);
            target.velocity = target.velocity.max(note.velocity);
            target.source_note_ids.extend(sources.iter().cloned());
            let group: &mut TargetGroup = &mut groups[index];
            group.source_occurrence_ids.push(note.id.clone());
            group.source_note_ids.extend(sources);
            group.part_ids.push(note.part_id.clone());
        } else {
            keys.insert(key, notes.len());
            let mut target = note.clone();
            target.source_note_ids = sources.clone();
            notes.push(target);
            groups.push(TargetGroup {
                target_id: note.id.clone(),
                source_occurrence_ids: vec![note.id.clone()],
                source_note_ids: sources,
                part_ids: vec![note.part_id.clone()],
            });
        }
    }
    for group in &mut groups {
        group.part_ids.sort();
        group.part_ids.dedup();
    }
    let mut diagnostics = report.diagnostics;
    let reduced = timeline.notes.len() - notes.len();
    if reduced > 0 {
        diagnostics.push(Diagnostic::warning("piano_unison_targets", format!("{reduced} exact simultaneous same-key events share a physical piano attack. Every source occurrence and tied segment remains mapped; playback and the original score are unchanged. Timing grades measure attacks only, not independent voice releases."), None));
    }
    if !piano {
        diagnostics.push(Diagnostic::warning("guitar_pitch_only_targets", "Guitar note-on targets retain separate source events. Pitch-only MIDI does not identify strings; fingering, sustain and same-pitch string identity need manual review.", None));
    }
    Ok(PracticeTargets {
        source_note_count: timeline.notes.len(),
        target_count: notes.len(),
        timeline: Timeline {
            notes,
            duration_ms: timeline.duration_ms,
        },
        groups,
        diagnostics,
        playable,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{catalog, compile, Beat, InputEvent, Repeat};
    fn piano() -> InstrumentProfile {
        InstrumentProfile::Piano {
            key_count: 88,
            lowest_midi: None,
        }
    }
    #[test]
    fn fractional_timeline_floats_survive_json_reposts_before_target_grouping() {
        let original =
            compile(crate::catalog_score("cc0-schubert-wandrers-nachtlied-d768").unwrap())
                .unwrap()
                .timeline;
        let bytes = serde_json::to_vec(&original).unwrap();
        let reposted: Timeline = serde_json::from_slice(&bytes).unwrap();
        assert_eq!(
            reposted.duration_ms.to_bits(),
            original.duration_ms.to_bits()
        );
        for (a, b) in original.notes.iter().zip(&reposted.notes) {
            assert_eq!(a.start_ms.to_bits(), b.start_ms.to_bits(), "start {}", a.id);
            assert_eq!(
                a.duration_ms.to_bits(),
                b.duration_ms.to_bits(),
                "duration {}",
                a.id
            );
        }
        let plan = plan_targets(&reposted, &piano()).unwrap();
        for (target, group) in plan.timeline.notes.iter().zip(plan.groups) {
            let sources: Vec<_> = original
                .notes
                .iter()
                .filter(|n| group.source_occurrence_ids.contains(&n.id))
                .collect();
            assert!(sources
                .iter()
                .all(|n| n.start_ms.to_bits() == target.start_ms.to_bits()));
            let longest = sources
                .iter()
                .map(|n| n.duration_ms)
                .fold(0.0_f64, f64::max);
            assert_eq!(longest.to_bits(), target.duration_ms.to_bits());
        }
    }
    fn unison() -> crate::Score {
        let mut score = catalog().remove(0);
        score.parts[0].notes.truncate(1);
        let mut part = score.parts[0].clone();
        part.id = "right".into();
        part.notes[0].id = "right-note".into();
        score.parts.push(part);
        score
    }
    #[test]
    fn exact_unison_requires_one_attack_but_retains_both_sources() {
        let c = compile(unison()).unwrap();
        let before = serde_json::to_value(&c.timeline).unwrap();
        let plan = plan_targets(&c.timeline, &piano()).unwrap();
        assert_eq!((plan.source_note_count, plan.target_count), (2, 1));
        assert_eq!(plan.groups[0].source_occurrence_ids.len(), 2);
        assert_eq!(plan.groups[0].source_note_ids.len(), 2);
        assert_eq!(plan.groups[0].part_ids.len(), 2);
        assert_eq!(before, serde_json::to_value(&c.timeline).unwrap());
        let note = &plan.timeline.notes[0];
        let grade = crate::assess(
            &plan.timeline,
            &[InputEvent {
                midi: note.midi,
                at_ms: note.start_ms,
                velocity: 90,
            }],
            180.,
        )
        .unwrap();
        assert_eq!(grade.hits.len(), 1);
        assert!(grade.misses.is_empty());
        assert_eq!(grade.pitch_breakdown.len(), 1);
        assert_eq!(grade.pitch_breakdown[0].expected, 1);
        assert_eq!(grade.pitch_breakdown[0].matched, 1);
        assert_eq!(grade.onset_completion.unwrap().total, 1);
        assert_eq!(grade.grade_counts.unwrap().perfect, 1);
    }
    #[test]
    fn rapid_rearticulations_are_never_merged_by_tolerance() {
        let mut score = unison();
        score.parts[1].notes[0].at = Beat::new(1, 1000);
        let plan = plan_targets(&compile(score).unwrap().timeline, &piano()).unwrap();
        assert_eq!(plan.target_count, 2);
        let inputs = plan
            .timeline
            .notes
            .iter()
            .map(|n| InputEvent {
                midi: n.midi,
                at_ms: n.start_ms,
                velocity: 90,
            })
            .collect::<Vec<_>>();
        let result = crate::assess(&plan.timeline, &inputs, 180.).unwrap();
        assert_eq!(
            result.onset_completion.unwrap().longest_complete_sequence,
            2
        );
    }
    #[test]
    fn part_selection_recomputes_groups_and_guitar_does_not_collapse_strings() {
        let c = compile(unison()).unwrap();
        let selected = Timeline {
            notes: c
                .timeline
                .notes
                .iter()
                .filter(|n| n.part_id == "right")
                .cloned()
                .collect(),
            duration_ms: c.timeline.duration_ms,
        };
        let plan = plan_targets(&selected, &piano()).unwrap();
        assert_eq!(plan.groups[0].source_note_ids, vec!["right-note"]);
        let guitar = InstrumentProfile::Guitar {
            tuning: vec![64, 59, 55, 50, 45, 40],
            frets: 24,
            capo: 0,
        };
        let guitar_plan = plan_targets(&c.timeline, &guitar).unwrap();
        assert_eq!(guitar_plan.target_count, 2);
        let note = &guitar_plan.timeline.notes[0];
        let result = crate::assess(
            &guitar_plan.timeline,
            &[InputEvent {
                midi: note.midi,
                at_ms: note.start_ms,
                velocity: 90,
            }],
            180.,
        )
        .unwrap();
        assert_eq!(
            result.onset_completion.unwrap().complete,
            0,
            "One pitch-only input cannot complete two retained guitar targets"
        );
    }
    #[test]
    fn tied_continuations_and_repeats_keep_all_source_ids_without_extra_attacks() {
        let mut score = unison();
        score.parts.truncate(1);
        let mut second = score.parts[0].notes[0].clone();
        second.id = "tie-tail".into();
        second.at = second.duration;
        second.tie_stop = true;
        score.parts[0].notes[0].tie_start = true;
        score.parts[0].notes.push(second);
        let c = compile(score.clone()).unwrap();
        let plan = plan_targets(&c.timeline, &piano()).unwrap();
        assert_eq!(plan.target_count, 1);
        assert_eq!(plan.groups[0].source_note_ids.len(), 2);
        score.repeats.push(Repeat {
            from: Beat::ZERO,
            to: Beat::new(4, 1),
            times: 2,
        });
        let repeated = plan_targets(&compile(score).unwrap().timeline, &piano()).unwrap();
        assert_eq!(repeated.target_count, 2);
        assert_ne!(repeated.groups[0].target_id, repeated.groups[1].target_id);
        assert_eq!(
            repeated.groups[0].source_note_ids,
            repeated.groups[1].source_note_ids
        );
        let inputs = repeated
            .timeline
            .notes
            .iter()
            .map(|note| InputEvent {
                midi: note.midi,
                at_ms: note.start_ms + 25.,
                velocity: 90,
            })
            .collect::<Vec<_>>();
        let grade = crate::assess(&repeated.timeline, &inputs, 180.).unwrap();
        assert_eq!(grade.pitch_breakdown.len(), 1);
        assert_eq!(grade.pitch_breakdown[0].expected, 2);
        assert_eq!(grade.pitch_breakdown[0].matched, 2);
        assert_eq!(grade.pitch_breakdown[0].timing_bias_ms, Some(25.));
        assert_eq!(grade.onset_completion.unwrap().longest_complete_sequence, 2);
        assert_eq!(grade.grade_counts.unwrap().perfect, 2);
    }
    #[test]
    fn out_of_range_stays_visible_and_disables_scored_plan() {
        let c = compile(unison()).unwrap();
        let plan = plan_targets(
            &c.timeline,
            &InstrumentProfile::Piano {
                key_count: 12,
                lowest_midi: Some(0),
            },
        )
        .unwrap();
        assert!(!plan.playable);
        assert_eq!(plan.target_count, 1);
        assert!(plan
            .diagnostics
            .iter()
            .any(|d| d.code == "instrument_range"));
    }
}
