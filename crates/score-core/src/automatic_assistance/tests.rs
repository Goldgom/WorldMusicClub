use super::*;
use crate::{
    basic_keys, practice_source::PracticeSource, vsq_clean, Beat, Note, Pitch, Repeat, Score,
};
fn piano() -> InstrumentProfile {
    InstrumentProfile::Piano {
        key_count: 88,
        lowest_midi: Some(21),
    }
}
fn scope(source: &PracticeSource) -> AssistanceSelection {
    AssistanceSelection {
        selected_part_ids: source.part_ids().to_vec(),
        profile: piano(),
    }
}
fn note(id: &str, at: Beat, duration: Beat, midi: u8) -> Note {
    let names = [
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
    ];
    let (step, alter) = names[usize::from(midi % 12)];
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
fn score(notes: Vec<Note>) -> Score {
    let mut score = crate::catalog().remove(0);
    score.id = "original-assistance-mechanical-fixture".into();
    score.parts.truncate(1);
    score.parts[0].id = "piano".into();
    score.parts[0].notes = notes;
    score.measures.clear();
    score.repeats.clear();
    score.source = None;
    score.tempo = vec![crate::Tempo {
        at: Beat::ZERO,
        bpm: 120.0,
    }];
    score
}
fn basic(events: &[u8]) -> basic_keys::CompleteBasicKeys {
    let mut bytes = b"MThd\0\0\0\x06\0\0\0\x01\0\x60MTrk".to_vec();
    let mut events = events.to_vec();
    events.extend([0, 255, 47, 0]);
    bytes.extend((events.len() as u32).to_be_bytes());
    bytes.extend(events);
    basic_keys::convert_midi(&bytes, "Original automatic assistance mechanical events").unwrap()
}
fn json(value: &impl Serialize) -> serde_json::Value {
    serde_json::to_value(value).unwrap()
}
fn permissive() -> AutomaticSettings {
    AutomaticSettings {
        max_targets_per_onset: 32,
        min_onset_interval_ms: 0,
        max_simultaneous_keys: 32,
        max_held_span_semitones: 127,
        ..Default::default()
    }
}

#[test]
fn basic_partitions_only_after_complete_fifo_and_preserves_source_bytes() {
    let original = basic(&[
        0, 0x90, 60, 90, 2, 0x90, 60, 91, 2, 0x80, 60, 0, 2, 0x80, 60, 0,
    ]);
    let bytes = basic_keys::encode_json(&original).unwrap();
    let full = basic_keys::compile_rendition(&original).unwrap();
    let source = PracticeSource::from_basic(&original).unwrap();
    assert_eq!(json(source.timeline()), json(&full.timeline));
    let first = full.timeline.notes[0].id.clone();
    let second = full.timeline.notes[1].id.clone();
    let checked = create(&source, &scope(&source), std::slice::from_ref(&first)).unwrap();
    assert_eq!(checked.machine_occurrence_ids, vec![second.clone()]);
    assert_eq!(checked.human_targets.timeline.notes[0].id, first);
    let machine = source
        .timeline()
        .notes
        .iter()
        .find(|n| n.id == second)
        .unwrap();
    assert_eq!(machine.start_ms + machine.duration_ms, 31.25);
    assert_eq!(full.rendition.notes[1].release.as_ref().unwrap().event, 3);
    assert_eq!(checked.coverage.human_source_unit_count, 1);
    assert!(checked
        .source_ownership
        .iter()
        .all(|u| u.part_id == full.timeline.notes[0].part_id));
    assert_eq!(basic_keys::encode_json(&original).unwrap(), bytes);
    assert_eq!(
        json(&validate(&source, &checked.plan).unwrap()),
        json(&checked)
    );
}
#[test]
fn basic_zero_gate_remains_interpreter_owned_and_all_stop_events_are_retained() {
    let original = basic(&[
        0, 0x90, 60, 90, 0, 0x80, 60, 0, 1, 0x90, 64, 90, 1, 0xb0, 123, 0,
    ]);
    let bytes = basic_keys::encode_json(&original).unwrap();
    let full = basic_keys::compile_rendition(&original).unwrap();
    assert!(full.rendition.notes[0].synthetic_gate);
    let source = PracticeSource::from_basic(&original).unwrap();
    let checked = original_mode(&source);
    assert_eq!(
        json(&checked.human_targets.timeline),
        json(
            &crate::targets::plan_targets(&full.timeline, &piano())
                .unwrap()
                .timeline
        )
    );
    assert_eq!(source.timeline().notes[0].duration_ms, 20.0);
    assert_eq!(basic_keys::encode_json(&original).unwrap(), bytes);
}
fn original_mode(source: &PracticeSource) -> CheckedPracticeAssistance {
    original(source, &scope(source)).unwrap()
}
#[test]
fn vsq_native_zero_clock_does_not_use_canonical_two_second_origin() {
    let original = vsq_clean::decode_json(include_bytes!(
        "../../../../tests/fixtures/vsq-clean-v1/score.json"
    ))
    .unwrap();
    let bytes = vsq_clean::encode_json(&original).unwrap();
    let source =
        PracticeSource::from_vsq(&original, vsq_clean::PracticeChoice::BaseNotesInstrumental)
            .unwrap();
    let checked = original_mode(&source);
    assert_eq!(checked.human_targets.timeline.notes[0].start_ms, 0.0);
    assert_eq!(
        crate::compile(original.notation.clone())
            .unwrap()
            .timeline
            .notes[0]
            .start_ms,
        2000.0
    );
    assert_eq!(
        source.receipt().choice,
        Some(vsq_clean::PracticeChoice::BaseNotesInstrumental)
    );
    assert_eq!(
        source.receipt().runtime_policy,
        "wmh-vsq-base-note-practice-v1"
    );
    assert_eq!(vsq_clean::encode_json(&original).unwrap(), bytes);
    assert_eq!(
        json(&validate(&source, &checked.plan).unwrap()),
        json(&checked)
    );
}
#[test]
fn semantic_native_source_uses_complete_exact_runtime() {
    let original = crate::clean_song::decode_json(include_bytes!(
        "../../../../tests/fixtures/clean-song-v2/score.json"
    ))
    .unwrap();
    let runtime = crate::clean_song::compile_complete(&original).unwrap();
    let source = PracticeSource::from_complete_midi(&original).unwrap();
    assert_eq!(json(source.timeline()), json(&runtime.compilation.timeline));
    assert_eq!(
        original_mode(&source).coverage.occurrence_count,
        runtime.notes.len()
    );
}
#[test]
fn tied_repeated_unison_atoms_keep_all_ids_and_existing_representatives() {
    let mut first = note("a", Beat::ZERO, Beat::new(1, 1), 60);
    first.tie_start = true;
    let mut continuation = note("b", Beat::new(1, 1), Beat::new(1, 1), 60);
    continuation.tie_stop = true;
    let mut score = score(vec![
        first,
        continuation,
        note("c", Beat::ZERO, Beat::new(1, 1), 60),
    ]);
    score.repeats = vec![Repeat {
        from: Beat::ZERO,
        to: Beat::new(2, 1),
        times: 3,
    }];
    let source = PracticeSource::from_canonical(&score).unwrap();
    let full = original_mode(&source);
    assert_eq!(full.coverage.source_unit_count, 3);
    assert_eq!(full.coverage.occurrence_count, 6);
    assert_eq!(full.coverage.human_target_count, 3);
    assert!(full
        .human_targets
        .groups
        .iter()
        .all(|g| g.source_note_ids == vec!["a", "b", "c"]));
    let expected = plan_targets(source.timeline(), &piano()).unwrap();
    assert_eq!(json(&full.human_targets), json(&expected));
    assert_eq!(
        create(&source, &scope(&source), &["a".into(), "b".into()])
            .unwrap_err()
            .code,
        "assistance_partial_atom"
    );
    let selected = generate(&source, &scope(&source), &permissive()).unwrap();
    assert_eq!(json(&selected.human_targets), json(&expected));
    assert_eq!(selected.plan.human_source_ids, vec!["a", "b", "c"]);
}
#[test]
fn ties_and_selected_cross_part_unisons_close_transitively() {
    let mut first = note("a", Beat::ZERO, Beat::new(1, 1), 60);
    first.tie_start = true;
    let mut second = note("b", Beat::new(1, 1), Beat::new(1, 1), 60);
    second.tie_stop = true;
    let mut score = score(vec![first, second]);
    let mut other = score.parts[0].clone();
    other.id = "other".into();
    other.notes = vec![note("c", Beat::ZERO, Beat::new(2, 1), 60)];
    score.parts.push(other);
    let source = PracticeSource::from_canonical(&score).unwrap();
    assert_eq!(
        create(&source, &scope(&source), &["c".into()])
            .unwrap_err()
            .source_ids,
        vec!["a", "b", "c"]
    );
    let mut selection = scope(&source);
    selection.selected_part_ids = vec!["piano".into()];
    assert_eq!(
        original(&source, &selection).unwrap_err().code,
        "assistance_cross_scope_physical_group"
    );
    assert_eq!(
        create(&source, &selection, &["a".into(), "b".into()])
            .unwrap_err()
            .code,
        "assistance_cross_scope_physical_group"
    );
    let one = generate(&source, &selection, &permissive()).unwrap();
    assert!(one.plan.human_source_ids.is_empty());
    assert_eq!(one.machine_occurrence_ids, vec!["a", "c"]);
    assert_eq!(one.coverage.selected_source_unit_count, 2);
    assert_eq!(one.exclusion_reasons[0].source_ids, vec!["a", "b", "c"]);
    assert_eq!(one.exclusion_reasons[0].code, "cross_scope_physical_group");
    assert!(!one.scored_mode_allowed);
}
#[test]
fn exact_density_and_boundary_release_do_not_use_tolerance() {
    let source = PracticeSource::from_canonical(&score(vec![
        note("a", Beat::ZERO, Beat::new(1, 2), 60),
        note("b", Beat::new(1, 2), Beat::new(1, 2), 72),
        note("c", Beat::new(999999, 1000000), Beat::new(1, 1000000), 74),
    ]))
    .unwrap();
    let settings = AutomaticSettings {
        max_targets_per_onset: 1,
        min_onset_interval_ms: 250,
        max_simultaneous_keys: 1,
        max_held_span_semitones: 0,
        ..Default::default()
    };
    let checked = generate(&source, &scope(&source), &settings).unwrap();
    assert_eq!(checked.plan.human_source_ids, vec!["a", "b"]);
    assert_eq!(checked.exclusion_reasons[0].code, "onset_density");
    assert_eq!(checked.machine_occurrence_ids, vec!["c"]);
}
#[test]
fn held_span_counts_prior_gates_even_at_different_onsets() {
    let source = PracticeSource::from_canonical(&score(vec![
        note("a", Beat::ZERO, Beat::new(4, 1), 60),
        note("b", Beat::new(1, 1), Beat::new(1, 1), 72),
        note("c", Beat::new(2, 1), Beat::new(1, 1), 64),
    ]))
    .unwrap();
    let checked = generate(&source, &scope(&source), &AutomaticSettings::default()).unwrap();
    assert_eq!(checked.plan.human_source_ids, vec!["a", "c"]);
    assert_eq!(checked.exclusion_reasons[0].code, "held_span_limit");
}
#[test]
fn chord_count_and_simultaneous_key_count_are_separate() {
    let source = PracticeSource::from_canonical(&score(vec![
        note("a", Beat::ZERO, Beat::new(4, 1), 60),
        note("b", Beat::ZERO, Beat::new(4, 1), 64),
        note("c", Beat::ZERO, Beat::new(4, 1), 67),
        note("d", Beat::new(1, 1), Beat::new(1, 1), 62),
    ]))
    .unwrap();
    let checked = generate(
        &source,
        &scope(&source),
        &AutomaticSettings {
            max_simultaneous_keys: 2,
            ..Default::default()
        },
    )
    .unwrap();
    assert_eq!(checked.plan.human_source_ids, vec!["a", "b"]);
    assert_eq!(
        checked
            .exclusion_reasons
            .iter()
            .map(|r| r.code.as_str())
            .collect::<Vec<_>>(),
        vec!["onset_target_limit", "simultaneous_key_limit"]
    );
}
#[test]
fn late_repeat_conflict_rejects_every_occurrence_of_atom() {
    // At the second visit the long C gate from an earlier segment is impossible:
    // navigation boundary holds are intentionally rejected by source admission.
    // This fixture instead closes a tie/unison atom spanning distinct onsets.
    let mut score = score(vec![
        note("a", Beat::ZERO, Beat::new(1, 1), 60),
        note("b", Beat::new(1, 1), Beat::new(1, 1), 72),
    ]);
    score.repeats = vec![Repeat {
        from: Beat::ZERO,
        to: Beat::new(2, 1),
        times: 3,
    }];
    let source = PracticeSource::from_canonical(&score).unwrap();
    let checked = generate(
        &source,
        &scope(&source),
        &AutomaticSettings {
            min_onset_interval_ms: 750,
            ..Default::default()
        },
    )
    .unwrap();
    assert_eq!(checked.plan.human_source_ids, vec!["a"]);
    assert_eq!(checked.coverage.machine_occurrence_count, 3);
    assert!(checked.machine_occurrence_ids.iter().all(|id| source
        .timeline()
        .notes
        .iter()
        .any(|n| n.id == *id && n.source_note_ids == vec!["b"])));
}
#[test]
fn original_keeps_unplayable_notes_and_automatic_discloses_range_removal() {
    let source = PracticeSource::from_canonical(&score(vec![
        note("a", Beat::ZERO, Beat::new(1, 1), 0),
        note("b", Beat::new(1, 1), Beat::new(1, 1), 60),
    ]))
    .unwrap();
    let full = original_mode(&source);
    assert!(full.all_selected_human && !full.scored_mode_allowed);
    assert_eq!(full.coverage.human_source_unit_count, 2);
    assert!(full.machine_occurrence_ids.is_empty());
    let auto = generate(&source, &scope(&source), &permissive()).unwrap();
    assert_eq!(auto.plan.human_source_ids, vec!["b"]);
    assert_eq!(auto.exclusion_reasons[0].code, "instrument_range");
}
#[test]
fn deterministic_order_independent_source_selection_and_no_source_mutation() {
    let mut score = score(vec![note("a", Beat::ZERO, Beat::new(1, 1), 60)]);
    let mut part = score.parts[0].clone();
    part.id = "other".into();
    part.notes[0].id = "b".into();
    score.parts.push(part);
    let bytes = serde_json::to_vec(&score).unwrap();
    let source = PracticeSource::from_canonical(&score).unwrap();
    let mut selection = scope(&source);
    let a = generate(&source, &selection, &permissive()).unwrap();
    selection.selected_part_ids.reverse();
    let b = generate(&source, &selection, &permissive()).unwrap();
    assert_eq!(json(&a), json(&b));
    assert_eq!(serde_json::to_vec(&score).unwrap(), bytes);
    assert_eq!(json(&validate(&source, &a.plan).unwrap()), json(&a));
}
#[test]
fn changed_source_choice_policy_scope_profile_revision_and_plan_are_rejected() {
    let original = score(vec![
        note("a", Beat::ZERO, Beat::new(1, 1), 60),
        note("b", Beat::new(1, 1), Beat::new(1, 1), 64),
    ]);
    let source = PracticeSource::from_canonical(&original)
        .unwrap()
        .with_verified_saved_binding(&"a".repeat(64))
        .unwrap();
    let saved = generate(&source, &scope(&source), &permissive())
        .unwrap()
        .plan;
    let mut edited = original.clone();
    edited.parts[0].notes[0].velocity = 91;
    let foreign = PracticeSource::from_canonical(&edited)
        .unwrap()
        .with_verified_saved_binding(&"a".repeat(64))
        .unwrap();
    assert_eq!(
        validate(&foreign, &saved).unwrap_err().code,
        "assistance_source_mismatch"
    );
    let foreign = PracticeSource::from_canonical(&original)
        .unwrap()
        .with_verified_saved_binding(&"b".repeat(64))
        .unwrap();
    assert_eq!(
        validate(&foreign, &saved).unwrap_err().code,
        "assistance_source_mismatch"
    );
    for changed in [
        "policy",
        "choice",
        "revision",
        "profile",
        "human",
        "digest",
        "algorithm",
    ] {
        let mut plan = saved.clone();
        match changed {
            "policy" => plan.receipt.runtime_policy = "foreign".into(),
            "choice" => {
                plan.receipt.choice = Some(vsq_clean::PracticeChoice::BaseNotesInstrumental)
            }
            "revision" => plan.revision += 1,
            "profile" => {
                plan.selection.profile = InstrumentProfile::Piano {
                    key_count: 61,
                    lowest_midi: Some(36),
                }
            }
            "human" => {
                plan.human_source_ids.pop();
            }
            "digest" => plan.selection_digest = "0".repeat(64),
            "algorithm" => plan.settings.as_mut().unwrap().algorithm_id = "future".into(),
            _ => unreachable!(),
        }
        assert!(validate(&source, &plan).is_err(), "{changed}");
    }
    let mut plan = saved;
    plan.selection.selected_part_ids.push("absent".into());
    assert_eq!(
        validate(&source, &plan).unwrap_err().code,
        "assistance_unknown_part"
    );
}
#[test]
fn invalid_settings_never_clamp_and_guitar_automatic_is_explicitly_unavailable() {
    let source =
        PracticeSource::from_canonical(&score(vec![note("a", Beat::ZERO, Beat::new(1, 1), 60)]))
            .unwrap();
    for settings in [
        AutomaticSettings {
            max_targets_per_onset: 0,
            ..Default::default()
        },
        AutomaticSettings {
            max_simultaneous_keys: 33,
            ..Default::default()
        },
        AutomaticSettings {
            min_onset_interval_ms: 60001,
            ..Default::default()
        },
        AutomaticSettings {
            max_held_span_semitones: 128,
            ..Default::default()
        },
    ] {
        assert_eq!(
            generate(&source, &scope(&source), &settings)
                .unwrap_err()
                .code,
            "assistance_settings"
        );
    }
    let selection = AssistanceSelection {
        selected_part_ids: vec!["piano".into()],
        profile: InstrumentProfile::Guitar {
            tuning: vec![40, 45, 50, 55, 59, 64],
            frets: 20,
            capo: 0,
        },
    };
    assert_eq!(
        generate(&source, &selection, &permissive())
            .unwrap_err()
            .code,
        "assistance_automatic_profile"
    );
    assert!(original(&source, &selection).unwrap().all_selected_human);
}
#[test]
fn work_limit_is_failure_without_truncated_success() {
    let notes = (0..3300)
        .map(|i| note(&format!("n{i}"), Beat::new(i, 1000), Beat::new(10, 1), 60))
        .collect();
    let source = PracticeSource::from_canonical(&score(notes)).unwrap();
    assert_eq!(
        generate(&source, &scope(&source), &permissive())
            .unwrap_err()
            .code,
        "assistance_work_limit"
    );
    assert_eq!(source.timeline().notes.len(), 3300);
}
#[test]
fn all_machine_plan_has_complete_coverage_and_no_scoring_targets() {
    let source = PracticeSource::from_canonical(&score(vec![
        note("a", Beat::ZERO, Beat::new(1, 1), 60),
        note("b", Beat::new(1, 1), Beat::new(1, 1), 64),
    ]))
    .unwrap();
    let checked = create(&source, &scope(&source), &[]).unwrap();
    assert_eq!(checked.machine_occurrence_ids, vec!["a", "b"]);
    assert_eq!(checked.coverage.machine_source_unit_count, 2);
    assert!(!checked.scored_mode_allowed);
    assert_eq!(
        checked.human_targets.timeline.duration_ms,
        source.timeline().duration_ms
    );
    assert!(json(&checked).get("machine_timeline").is_none());
}

#[test]
fn original_empty_part_union_is_complete_machine_listening() {
    let source = PracticeSource::from_canonical(&score(vec![
        note("a", Beat::ZERO, Beat::new(1, 1), 60),
        note("b", Beat::new(1, 1), Beat::new(1, 1), 64),
    ]))
    .unwrap();
    let selection = AssistanceSelection {
        selected_part_ids: vec![],
        profile: piano(),
    };
    let checked = original(&source, &selection).unwrap();
    assert_eq!(checked.machine_occurrence_ids, vec!["a", "b"]);
    assert_eq!(checked.coverage.selected_source_unit_count, 0);
    assert_eq!(checked.coverage.human_occurrence_count, 0);
    assert_eq!(checked.coverage.machine_source_unit_count, 2);
    assert!(!checked.scored_mode_allowed && !checked.all_selected_human);
    assert!(checked
        .source_ownership
        .iter()
        .all(|u| !u.in_selected_scope && u.owner == NoteOwner::Machine));
    assert_eq!(
        json(&validate(&source, &checked.plan).unwrap()),
        json(&checked)
    );
    assert_eq!(
        generate(&source, &selection, &permissive())
            .unwrap_err()
            .code,
        "assistance_selection_limit"
    );
}

#[test]
fn automatic_keyboard_keeps_percussion_machine_without_changing_original_or_explicit() {
    let complete = basic(&[
        0, 0x90, 60, 90, 0, 0x99, 60, 95, 24, 0x80, 60, 0, 0, 0x89, 60, 0,
    ]);
    let source = PracticeSource::from_basic(&complete).unwrap();
    let checked = generate(&source, &scope(&source), &permissive()).unwrap();
    // Exact selected physical groups are atomic: a same-key percussion selector
    // also keeps its melodic unison machine-owned, rather than splitting it.
    assert_eq!(checked.coverage.machine_source_unit_count, 2);
    assert_eq!(checked.exclusion_reasons[0].code, "percussion_selector");
    assert_eq!(checked.exclusion_reasons[0].source_ids.len(), 2);
    let full = original_mode(&source);
    assert!(full.all_selected_human);
    assert_eq!(full.coverage.human_source_unit_count, 2);
    assert!(
        create(&source, &scope(&source), &full.plan.human_source_ids)
            .unwrap()
            .all_selected_human
    );
}

#[test]
fn complete_wire_budget_rejects_instead_of_truncating_ids() {
    let notes = (0..20_000)
        .map(|i| {
            note(
                &format!("n{i:05}{}", "x".repeat(110)),
                Beat::new(i, 1),
                Beat::new(1, 1),
                60,
            )
        })
        .collect();
    let source = PracticeSource::from_canonical(&score(notes)).unwrap();
    assert_eq!(source.source_units().len(), 20_000);
    assert_eq!(
        original_mode_error(&source).code,
        "assistance_response_limit"
    );
    assert_eq!(source.timeline().notes.len(), 20_000);
}
fn original_mode_error(source: &PracticeSource) -> PracticeAssistanceError {
    original(source, &scope(source)).unwrap_err()
}
