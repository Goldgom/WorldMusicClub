//! Original mechanical fixtures for the UI's keyboard configurations. These
//! exercise the trusted planner, not a JavaScript imitation of its selector.
use score_core::{
    assistance::NoteOwner,
    automatic_assistance::{
        self, AssistanceSelection, AutomaticSettings, CheckedPracticeAssistance,
    },
    instruments::InstrumentProfile,
    practice_source::PracticeSource,
    Beat, Note, Part, Pitch, Provenance, Repeat, Score, Tempo,
};
use serde::Serialize;
use std::collections::{BTreeMap, BTreeSet};

fn profiles() -> [(&'static str, AutomaticSettings); 3] {
    // Deliberately explicit: balanced preserves the released default. These
    // settings are configurations, not nested selections or skill grades.
    [
        ("single", 1, 500, 1, 0),
        ("balanced", 2, 250, 3, 7),
        ("dense", 4, 125, 6, 12),
    ]
    .map(|(name, targets, interval, keys, span)| {
        (
            name,
            AutomaticSettings {
                algorithm_id: automatic_assistance::ALGORITHM_ID.into(),
                max_targets_per_onset: targets,
                min_onset_interval_ms: interval,
                max_simultaneous_keys: keys,
                max_held_span_semitones: span,
            },
        )
    })
}

fn note(id: &str, at: Beat, duration: Beat, midi: u8) -> Note {
    let (step, alter) = [
        ("C", 0),
        ("C", 1),
        ("D", 0),
        ("D", 1),
        ("E", 0),
        ("F", 0),
        ("F", 1),
        ("G", 0),
        ("G", 1),
        ("A", 0),
        ("A", 1),
        ("B", 0),
    ][usize::from(midi % 12)];
    Note {
        id: id.into(),
        at,
        duration,
        pitch: Some(Pitch {
            step: step.into(),
            alter,
            octave: (midi / 12) as i8 - 1,
        }),
        voice: "1".into(),
        staff: 1,
        velocity: 90,
        tie_start: false,
        tie_stop: false,
    }
}

fn ms(value: u32) -> Beat {
    Beat::new(i64::from(value), 500)
}

fn score(notes: Vec<Note>) -> Score {
    Score {
        format_metadata: None,
        version: 1,
        id: "original-preset-contract".into(),
        title: "Original preset contract fixture".into(),
        composer: "Mechanical test".into(),
        provenance: Provenance {
            kind: "original_exercise".into(),
            attribution: "Original mechanical fixture; no song transcription".into(),
            source_url: None,
            license: Some("CC0-1.0".into()),
        },
        parts: vec![Part {
            id: "selected".into(),
            name: "Selected".into(),
            instrument: "piano".into(),
            notes,
        }],
        tempo: vec![Tempo {
            at: Beat::ZERO,
            bpm: 120.0,
        }],
        meters: vec![],
        keys: vec![],
        measures: vec![],
        repeats: vec![],
        source: None,
    }
}

fn scope(source: &PracticeSource) -> AssistanceSelection {
    AssistanceSelection {
        selected_part_ids: source.part_ids().to_vec(),
        profile: InstrumentProfile::Piano {
            key_count: 88,
            lowest_midi: Some(21),
        },
    }
}

fn json(value: &impl Serialize) -> serde_json::Value {
    serde_json::to_value(value).unwrap()
}

fn ids(values: &[String]) -> BTreeSet<&str> {
    values.iter().map(String::as_str).collect()
}

/// Reconstruct coverage from the complete source and real output references.
/// Do not mistake grouped physical attacks for deleted source occurrences.
fn assert_partition(source: &PracticeSource, checked: &CheckedPracticeAssistance) {
    let original: BTreeMap<_, _> = source
        .timeline()
        .notes
        .iter()
        .map(|n| (n.id.as_str(), n))
        .collect();
    assert_eq!(original.len(), source.timeline().notes.len());
    let machines = ids(&checked.machine_occurrence_ids);
    assert_eq!(machines.len(), checked.machine_occurrence_ids.len());
    let mut humans = BTreeSet::new();
    let owners: BTreeMap<_, _> = checked
        .source_ownership
        .iter()
        .map(|u| (u.source_id.as_str(), u))
        .collect();
    assert_eq!(owners.len(), source.source_units().len());
    assert_eq!(owners.len(), checked.source_ownership.len());
    let human_units = ids(&checked.plan.human_source_ids);
    let selected = ids(&checked.plan.selection.selected_part_ids);
    for unit in source.source_units() {
        let owner = owners[unit.source_id.as_str()];
        assert_eq!(owner.part_id, unit.part_id);
        assert_eq!(
            owner.in_selected_scope,
            selected.contains(unit.part_id.as_str())
        );
        assert_eq!(
            owner.owner == NoteOwner::Human,
            human_units.contains(unit.source_id.as_str())
        );
        if owner.owner == NoteOwner::Human {
            assert!(owner.in_selected_scope);
        }
    }
    for (group, target) in checked
        .human_targets
        .groups
        .iter()
        .zip(&checked.human_targets.timeline.notes)
    {
        let members: Vec<_> = group
            .source_occurrence_ids
            .iter()
            .map(|id| original[id.as_str()])
            .collect();
        assert!(!members.is_empty());
        assert_eq!(group.target_id, target.id);
        assert_eq!(target.id, members[0].id);
        let mut source_ids = vec![];
        let mut part_ids = BTreeSet::new();
        for member in &members {
            assert!(
                humans.insert(member.id.as_str()),
                "duplicate human occurrence"
            );
            assert!(!machines.contains(member.id.as_str()));
            assert_eq!(member.midi, target.midi);
            assert_eq!(member.start_ms.to_bits(), target.start_ms.to_bits());
            source_ids.extend(member.source_note_ids.iter().cloned());
            part_ids.insert(member.part_id.as_str());
        }
        assert_eq!(group.source_note_ids, source_ids);
        assert_eq!(
            group
                .part_ids
                .iter()
                .map(String::as_str)
                .collect::<BTreeSet<_>>(),
            part_ids
        );
        // The physical target keeps the original representative, extending only
        // to the longest source gate and highest source velocity in this unison.
        let mut expected = members[0].clone();
        expected.duration_ms = members.iter().map(|n| n.duration_ms).fold(0.0, f64::max);
        expected.velocity = members.iter().map(|n| n.velocity).max().unwrap();
        expected.source_note_ids = source_ids;
        assert_eq!(json(target), json(&expected));
    }
    assert_eq!(
        humans.union(&machines).copied().collect::<BTreeSet<_>>(),
        original.keys().copied().collect()
    );
    for occurrence in original.values() {
        let human = humans.contains(occurrence.id.as_str());
        assert!(occurrence
            .source_note_ids
            .iter()
            .all(|id| human_units.contains(id.as_str()) == human));
        // Every exact simultaneous same-key event has one owner, including
        // unselected parts and ties that join otherwise separate source IDs.
        for other in original.values().filter(|other| {
            other.midi == occurrence.midi
                && other.start_ms.to_bits() == occurrence.start_ms.to_bits()
        }) {
            assert_eq!(humans.contains(other.id.as_str()), human);
        }
    }
    let coverage = &checked.coverage;
    assert_eq!(coverage.source_unit_count, owners.len());
    assert_eq!(
        coverage.selected_source_unit_count,
        owners.values().filter(|u| u.in_selected_scope).count()
    );
    assert_eq!(coverage.human_source_unit_count, human_units.len());
    assert_eq!(
        coverage.machine_source_unit_count,
        owners.len() - human_units.len()
    );
    assert_eq!(coverage.occurrence_count, original.len());
    assert_eq!(coverage.human_occurrence_count, humans.len());
    assert_eq!(coverage.machine_occurrence_count, machines.len());
    assert_eq!(
        coverage.human_target_count,
        checked.human_targets.groups.len()
    );
    assert_eq!(
        checked.human_targets.groups.len(),
        checked.human_targets.timeline.notes.len()
    );
    assert_eq!(checked.human_targets.source_note_count, humans.len());
    assert_eq!(
        checked.human_targets.target_count,
        coverage.human_target_count
    );
    assert_eq!(
        coverage.selected_target_count,
        coverage.human_target_count + coverage.machine_selected_target_count
    );
    assert_eq!(
        checked.human_targets.timeline.duration_ms.to_bits(),
        source.timeline().duration_ms.to_bits()
    );
    assert_eq!(&checked.receipt, source.receipt());
    assert_eq!(
        json(checked),
        json(&automatic_assistance::validate(source, &checked.plan).unwrap())
    );
}

fn assert_limits(checked: &CheckedPracticeAssistance, settings: &AutomaticSettings) {
    let notes = &checked.human_targets.timeline.notes;
    let mut previous = None;
    for note in notes {
        let at_onset = notes
            .iter()
            .filter(|n| n.start_ms.to_bits() == note.start_ms.to_bits())
            .count();
        assert!(at_onset <= usize::from(settings.max_targets_per_onset));
        if let Some(prior) = previous {
            if note.start_ms != prior {
                assert!(note.start_ms - prior >= f64::from(settings.min_onset_interval_ms));
            }
        }
        previous = Some(note.start_ms);
        let keys: BTreeSet<_> = notes
            .iter()
            .filter(|n| n.start_ms <= note.start_ms && n.start_ms + n.duration_ms > note.start_ms)
            .map(|n| n.midi)
            .collect();
        assert!(keys.len() <= usize::from(settings.max_simultaneous_keys));
        assert!(keys.last().unwrap() - keys.first().unwrap() <= settings.max_held_span_semitones);
    }
}

#[test]
fn every_profile_preserves_fractional_ties_repeats_unisons_and_complete_source() {
    let mut first = note("tie-start", Beat::ZERO, Beat::new(1, 3), 60);
    first.tie_start = true;
    let mut continuation = note("tie-end", Beat::new(1, 3), Beat::new(2, 3), 60);
    continuation.tie_stop = true;
    let mut unison = note("unison", Beat::ZERO, Beat::new(1, 2), 60);
    unison.voice = "2".into();
    unison.velocity = 101;
    let mut fixture = score(vec![
        first,
        continuation,
        unison,
        note("third", Beat::ZERO, Beat::new(1, 1), 64),
        note("fifth", Beat::ZERO, Beat::new(1, 1), 67),
        note("octave", Beat::ZERO, Beat::new(1, 1), 72),
        note("after-release", Beat::new(1, 1), Beat::new(1, 3), 76),
    ]);
    fixture.measures.push(score_core::Measure {
        number: 1,
        at: Beat::ZERO,
        length: Beat::new(2, 1),
    });
    fixture.repeats.push(Repeat {
        from: Beat::ZERO,
        to: Beat::new(2, 1),
        times: 3,
    });
    let before = json(&fixture);
    let source = PracticeSource::from_canonical(&fixture).unwrap();
    let native_before = json(source.timeline());
    for (name, settings) in profiles() {
        let checked = automatic_assistance::generate(&source, &scope(&source), &settings).unwrap();
        assert_partition(&source, &checked);
        assert_limits(&checked, &settings);
        let expected_per_visit = match name {
            "single" => 2,
            "balanced" => 3,
            "dense" => 5,
            _ => unreachable!(),
        };
        assert_eq!(
            checked.coverage.human_target_count,
            expected_per_visit * 3,
            "{name}"
        );
        assert_eq!(checked.coverage.occurrence_count, 18);
        assert_eq!(checked.coverage.source_unit_count, 7);
        for group in checked
            .human_targets
            .groups
            .iter()
            .filter(|g| g.source_note_ids.contains(&"tie-start".into()))
        {
            assert_eq!(
                ids(&group.source_note_ids),
                BTreeSet::from(["tie-start", "tie-end", "unison"])
            );
            assert_eq!(group.source_occurrence_ids.len(), 2);
        }
        assert!(checked.scored_mode_allowed);
        assert_eq!(json(&fixture), before);
        assert_eq!(json(source.timeline()), native_before);
    }
}

#[test]
fn rejecting_a_tied_unison_keeps_all_written_ids_and_repeats_on_machine() {
    for (name, settings) in profiles() {
        let interval = settings.min_onset_interval_ms;
        let mut first = note("tie-start", ms(interval / 2), ms(50), 72);
        first.tie_start = true;
        let mut continuation = note("tie-end", ms(interval / 2 + 50), ms(50), 72);
        continuation.tie_stop = true;
        let mut unison = note("unison", ms(interval / 2), ms(75), 72);
        unison.voice = "2".into();
        let mut fixture = score(vec![
            note("opening", Beat::ZERO, ms(5), 60),
            first,
            continuation,
            unison,
            note("later", ms(2 * interval), ms(5), 84),
        ]);
        fixture.measures.push(score_core::Measure {
            number: 1,
            at: Beat::ZERO,
            length: ms(4 * interval),
        });
        fixture.repeats.push(Repeat {
            from: Beat::ZERO,
            to: ms(4 * interval),
            times: 3,
        });
        let source = PracticeSource::from_canonical(&fixture).unwrap();
        let before = json(source.timeline());
        let checked = automatic_assistance::generate(&source, &scope(&source), &settings).unwrap();
        assert_eq!(
            checked.plan.human_source_ids,
            ["later", "opening"],
            "{name}"
        );
        assert_eq!(checked.coverage.human_target_count, 6);
        assert_eq!(checked.coverage.machine_occurrence_count, 6);
        assert_eq!(checked.coverage.machine_source_unit_count, 3);
        assert_eq!(checked.exclusion_reasons.len(), 1);
        assert_eq!(checked.exclusion_reasons[0].code, "onset_density");
        assert_eq!(
            checked.exclusion_reasons[0].source_ids,
            ["tie-end", "tie-start", "unison"]
        );
        assert_partition(&source, &checked);
        assert_limits(&checked, &settings);
        assert_eq!(json(source.timeline()), before);
    }
}

#[test]
fn profile_onset_caps_select_real_attacks_and_keep_the_rest_for_machine_playback() {
    let fixture = score(
        (0..7)
            .map(|key| note(&format!("key-{key}"), Beat::ZERO, ms(1000), 60 + key))
            .collect(),
    );
    let source = PracticeSource::from_canonical(&fixture).unwrap();
    for (name, settings) in profiles() {
        let checked = automatic_assistance::generate(&source, &scope(&source), &settings).unwrap();
        let count = usize::from(settings.max_targets_per_onset);
        assert_eq!(
            checked
                .human_targets
                .timeline
                .notes
                .iter()
                .map(|n| n.midi)
                .collect::<Vec<_>>(),
            (60..60 + count as u8).collect::<Vec<_>>(),
            "{name}"
        );
        assert_eq!(checked.machine_occurrence_ids.len(), 7 - count);
        assert!(checked
            .exclusion_reasons
            .iter()
            .all(|r| r.code == "onset_target_limit"));
        assert_partition(&source, &checked);
        assert_limits(&checked, &settings);
    }
}

#[test]
fn exact_spacing_accepts_the_boundary_and_rejects_half_a_microsecond_before_it() {
    for (name, settings) in profiles() {
        let interval = i64::from(settings.min_onset_interval_ms);
        let fixture = score(vec![
            note("first", Beat::ZERO, Beat::new(1, 1_000_000), 60),
            note(
                "too-early",
                Beat::new(interval * 2000 - 1, 1_000_000),
                Beat::new(1, 1_000_000),
                61,
            ),
            note(
                "exact-boundary",
                ms(settings.min_onset_interval_ms),
                Beat::new(1, 1_000_000),
                62,
            ),
        ]);
        let source = PracticeSource::from_canonical(&fixture).unwrap();
        let before = json(source.timeline());
        let checked = automatic_assistance::generate(&source, &scope(&source), &settings).unwrap();
        assert_eq!(
            checked.plan.human_source_ids,
            ["exact-boundary", "first"],
            "{name}"
        );
        assert_eq!(checked.machine_occurrence_ids, ["too-early"]);
        assert_eq!(checked.exclusion_reasons[0].code, "onset_density");
        assert_partition(&source, &checked);
        assert_limits(&checked, &settings);
        assert_eq!(json(source.timeline()), before);
    }
}

#[test]
fn held_keys_limit_separate_onsets_and_release_exactly_at_the_next_attack() {
    for (name, settings) in profiles() {
        let initial = settings.max_targets_per_onset;
        let remaining = settings.max_simultaneous_keys - initial;
        let at = settings.min_onset_interval_ms;
        let mut notes: Vec<_> = (0..initial)
            .map(|key| note(&format!("initial-{key}"), Beat::ZERO, ms(5000), 60 + key))
            .collect();
        notes.extend((0..=remaining).map(|key| {
            note(
                &format!("later-{key}"),
                ms(at),
                ms(5000 - at),
                60 + initial + key,
            )
        }));
        notes.push(note("released-jump", ms(5000), ms(100), 96));
        let source = PracticeSource::from_canonical(&score(notes)).unwrap();
        let checked = automatic_assistance::generate(&source, &scope(&source), &settings).unwrap();
        assert_eq!(
            checked.coverage.human_target_count,
            usize::from(settings.max_simultaneous_keys) + 1,
            "{name}"
        );
        assert_eq!(
            checked.machine_occurrence_ids,
            [format!("later-{remaining}")]
        );
        assert_eq!(checked.exclusion_reasons[0].code, "simultaneous_key_limit");
        assert!(checked
            .plan
            .human_source_ids
            .contains(&"released-jump".into()));
        assert_partition(&source, &checked);
        assert_limits(&checked, &settings);
    }
}

#[test]
fn held_span_checks_sustained_previous_onsets_without_claiming_independent_holds() {
    for (name, settings) in profiles() {
        let interval = settings.min_onset_interval_ms;
        let span = settings.max_held_span_semitones;
        let source = PracticeSource::from_canonical(&score(vec![
            note("held", Beat::ZERO, ms(2500), 60),
            note("at-span", ms(interval), ms(2500 - interval), 60 + span),
            note("beyond-span", ms(2 * interval), ms(100), 61 + span),
        ]))
        .unwrap();
        let checked = automatic_assistance::generate(&source, &scope(&source), &settings).unwrap();
        assert_eq!(checked.plan.human_source_ids, ["at-span", "held"], "{name}");
        assert_eq!(checked.machine_occurrence_ids, ["beyond-span"]);
        assert_eq!(
            checked.exclusion_reasons[0].code,
            if name == "single" {
                "simultaneous_key_limit"
            } else {
                "held_span_limit"
            }
        );
        if name == "single" {
            assert!(checked
                .human_targets
                .diagnostics
                .iter()
                .any(|d| d.code == "piano_overlapping_key_gates"));
        }
        assert_partition(&source, &checked);
        assert_limits(&checked, &settings);
    }
}

#[test]
fn every_profile_keeps_cross_scope_unisons_on_machine_and_forbids_zero_human_scoring() {
    let mut fixture = score(vec![note("selected-unison", Beat::ZERO, ms(1000), 60)]);
    fixture.parts.push(Part {
        id: "accompaniment".into(),
        name: "Accompaniment".into(),
        instrument: "piano".into(),
        notes: vec![note("outside-unison", Beat::ZERO, ms(1500), 60)],
    });
    let source = PracticeSource::from_canonical(&fixture).unwrap();
    let mut selection = scope(&source);
    selection.selected_part_ids = vec!["selected".into()];
    for (name, settings) in profiles() {
        let checked = automatic_assistance::generate(&source, &selection, &settings).unwrap();
        assert_eq!(checked.coverage.human_target_count, 0, "{name}");
        assert_eq!(checked.coverage.machine_occurrence_count, 2);
        assert!(checked.human_targets.timeline.notes.is_empty());
        assert!(
            !checked.scored_mode_allowed
                && !checked.human_targets.playable
                && !checked.all_selected_human
        );
        assert_eq!(
            checked.exclusion_reasons[0].code,
            "cross_scope_physical_group"
        );
        assert_eq!(
            checked.exclusion_reasons[0].source_ids,
            ["outside-unison", "selected-unison"]
        );
        assert_partition(&source, &checked);
    }
}

#[test]
fn range_exclusions_preserve_exact_boundary_keys_and_machine_only_sources() {
    for (name, settings) in profiles() {
        for only_outside in [false, true] {
            let mut notes = vec![
                note("below", Beat::ZERO, ms(100), 59),
                note("above", ms(2000), ms(100), 72),
            ];
            if !only_outside {
                notes.extend([
                    note("lowest", ms(500), ms(100), 60),
                    note("highest", ms(1000), ms(100), 71),
                ]);
            }
            let source = PracticeSource::from_canonical(&score(notes)).unwrap();
            let selection = AssistanceSelection {
                selected_part_ids: source.part_ids().to_vec(),
                profile: InstrumentProfile::Piano {
                    key_count: 12,
                    lowest_midi: Some(60),
                },
            };
            let checked = automatic_assistance::generate(&source, &selection, &settings).unwrap();
            assert_eq!(
                checked.plan.human_source_ids,
                if only_outside {
                    vec![]
                } else {
                    vec!["highest", "lowest"]
                },
                "{name}"
            );
            assert_eq!(checked.machine_occurrence_ids, ["above", "below"]);
            assert!(checked
                .exclusion_reasons
                .iter()
                .all(|r| r.code == "instrument_range"));
            assert_eq!(checked.scored_mode_allowed, !only_outside);
            assert_partition(&source, &checked);
            assert_limits(&checked, &settings);
        }
    }
}

#[test]
fn looser_profiles_can_replace_and_reduce_human_choices_instead_of_forming_a_hierarchy() {
    let configs = profiles();
    for pair in configs.windows(2) {
        let (strict_name, strict) = &pair[0];
        let (loose_name, loose) = &pair[1];
        let interval = strict.min_onset_interval_ms;
        let source = PracticeSource::from_canonical(&score(vec![
            note("opening", Beat::ZERO, ms(5), 60),
            note(
                "newly-accepted-hold",
                ms(interval / 2),
                ms(4 * interval),
                60,
            ),
            note("later-1", ms(interval), ms(5), 84),
            note("later-2", ms(2 * interval), ms(5), 84),
            note("later-3", ms(3 * interval), ms(5), 84),
        ]))
        .unwrap();
        let strict_plan = automatic_assistance::generate(&source, &scope(&source), strict).unwrap();
        let loose_plan = automatic_assistance::generate(&source, &scope(&source), loose).unwrap();
        assert_eq!(
            strict_plan.plan.human_source_ids,
            ["later-1", "later-2", "later-3", "opening"],
            "{strict_name}"
        );
        assert_eq!(strict_plan.exclusion_reasons[0].code, "onset_density");
        assert_eq!(
            loose_plan.plan.human_source_ids,
            ["newly-accepted-hold", "opening"],
            "{loose_name}"
        );
        assert!(loose_plan
            .exclusion_reasons
            .iter()
            .all(|r| r.code == "held_span_limit"));
        assert_eq!(strict_plan.coverage.human_target_count, 4);
        assert_eq!(loose_plan.coverage.human_target_count, 2);
        assert!(!ids(&strict_plan.plan.human_source_ids)
            .is_subset(&ids(&loose_plan.plan.human_source_ids)));
        assert!(!ids(&loose_plan.plan.human_source_ids)
            .is_subset(&ids(&strict_plan.plan.human_source_ids)));
        for (checked, settings) in [(&strict_plan, strict), (&loose_plan, loose)] {
            assert_partition(&source, checked);
            assert_limits(checked, settings);
        }
    }
}
