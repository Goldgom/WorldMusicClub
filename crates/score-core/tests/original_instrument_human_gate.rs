//! Newly authored mechanical MIDI fixtures, offered under CC0-1.0.
//! Unknown evidence stays compatible; only exact known-unsupported attacks gate
//! Human ownership. The complete source and reference rendition stay intact.
use score_core::{
    automatic_assistance::{self, AssistanceSelection, AutomaticSettings, PracticeAssistancePlan},
    basic_keys,
    instruments::InstrumentProfile,
    pitch_projection::PitchProjection,
    practice_progression::{self, ProgressionLayer},
    practice_source::PracticeSource,
    source_identity,
};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};

fn basic(events: &[u8]) -> basic_keys::CompleteBasicKeys {
    let mut track = events.to_vec();
    track.extend([0, 255, 47, 0]);
    let mut midi = b"MThd\0\0\0\x06\0\0\0\x01\0\x60MTrk".to_vec();
    midi.extend((track.len() as u32).to_be_bytes());
    midi.extend(track);
    basic_keys::convert_midi(&midi, "Original CC0 Human admission events").unwrap()
}
fn mixed() -> basic_keys::CompleteBasicKeys {
    basic(&[
        0, 240, 5, 126, 127, 9, 1, 247, // Explicit GM1, no inferred namespace.
        0, 192, 40, 0, 144, 60, 80, 96, 128, 60, 0, // Reviewed unsupported violin.
        0, 192, 0, 0, 144, 62, 80, 96, 128, 62, 0, // Reviewed supported piano.
        0, 192, 1, 0, 144, 64, 80, 96, 128, 64, 0, // Unreviewed, stays compatible.
    ])
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
fn permissive() -> AutomaticSettings {
    AutomaticSettings {
        max_targets_per_onset: 32,
        min_onset_interval_ms: 0,
        max_simultaneous_keys: 32,
        max_held_span_semitones: 127,
        ..Default::default()
    }
}
fn value(value: &impl serde::Serialize) -> Value {
    serde_json::to_value(value).unwrap()
}

#[test]
fn mixed_part_excludes_exact_original_attacks_and_preserves_complete_reference() {
    let score = mixed();
    let wire = basic_keys::encode_json(&score).unwrap();
    let rendition = basic_keys::compile_rendition(&score).unwrap();
    let source = PracticeSource::from_basic(&score).unwrap();
    let analysis = source_identity::analyze_basic_practice(&score).unwrap();
    assert_eq!(analysis.parts()[0].unresolved_count(), 1);
    let unsupported = analysis.known_unsupported_source_attack_ids();
    assert_eq!(unsupported.len(), 1);
    assert_eq!(value(source.timeline()), value(&rendition.timeline));
    let error = automatic_assistance::original(&source, &scope(&source)).unwrap_err();
    assert_eq!(error.code, "practice_original_instrument_unsupported");
    assert_eq!(error.source_ids.as_slice(), unsupported);
    assert!(automatic_assistance::create(&source, &scope(&source), unsupported).is_err());
    let allowed: Vec<_> = source
        .source_units()
        .iter()
        .filter(|unit| !unsupported.contains(&unit.source_id))
        .map(|unit| unit.source_id.clone())
        .collect();
    let explicit = automatic_assistance::create(&source, &scope(&source), &allowed).unwrap();
    assert_eq!(explicit.coverage.human_source_unit_count, 2);
    let mut forged_assignment = explicit.plan.clone();
    forged_assignment.human_source_ids.extend_from_slice(unsupported);
    assert_eq!(
        automatic_assistance::validate(&source, &forged_assignment).unwrap_err().code,
        "practice_original_instrument_unsupported"
    );
    let automatic = automatic_assistance::generate(&source, &scope(&source), &permissive()).unwrap();
    assert_eq!(automatic.plan.human_source_ids, explicit.plan.human_source_ids);
    assert_eq!(automatic.machine_occurrence_ids.as_slice(), unsupported);
    assert_eq!(automatic.exclusion_reasons[0].code, "original_instrument_unsupported");
    for layer in [ProgressionLayer::Single, ProgressionLayer::Balanced, ProgressionLayer::Dense] {
        let checked = practice_progression::generate(&source, &scope(&source), layer).unwrap();
        assert!(checked.assistance.plan.human_source_ids.iter().all(|id| !unsupported.contains(id)));
        practice_progression::validate(&source, &checked.plan).unwrap();
    }
    assert_eq!(basic_keys::encode_json(&score).unwrap(), wire);
    assert_eq!(value(&basic_keys::compile_rendition(&score).unwrap().rendition), value(&rendition.rendition));
    assert_eq!(source.timeline().notes.len(), 3);
}

#[test]
fn eligibility_receipt_has_its_own_binding_domain_and_rejects_missing_forged_or_stale_evidence() {
    let score = mixed();
    let source = PracticeSource::from_basic(&score).unwrap();
    let checked = automatic_assistance::generate(&source, &scope(&source), &permissive()).unwrap();
    let receipt = source.receipt().source_eligibility.as_ref().unwrap();
    assert_eq!(receipt.source_binding.domain, "wmc-basic-complete-wire-json");
    assert_eq!(receipt.source_binding.digest, format!("{:x}", Sha256::digest(basic_keys::encode_json(&score).unwrap())));
    assert_ne!(receipt.source_binding, source.receipt().source_binding);
    assert_ne!(receipt.fingerprint, receipt.source_binding.digest);
    assert_ne!(receipt.fingerprint, source.receipt().runtime_digest);
    for field in ["analysis_policy_id", "identity_table_revision", "product_policy_id", "eligibility_policy_id", "source_profile", "fingerprint"] {
        let mut forged = value(&checked.plan);
        forged["receipt"]["source_eligibility"][field] = json!("forged");
        let forged: PracticeAssistancePlan = serde_json::from_value(forged).unwrap();
        assert_eq!(automatic_assistance::validate(&source, &forged).unwrap_err().code, "assistance_source_mismatch");
    }
    let mut missing = value(&checked.plan);
    missing["receipt"].as_object_mut().unwrap().remove("source_eligibility");
    let missing: PracticeAssistancePlan = serde_json::from_value(missing).unwrap();
    assert!(automatic_assistance::validate(&source, &missing).is_err());
    let mut forged = checked.plan.clone();
    forged.receipt.source_eligibility.as_mut().unwrap().source_binding.digest = "0".repeat(64);
    assert!(automatic_assistance::validate(&source, &forged).is_err());
    let mut changed = score.clone();
    changed.notation.title.push_str(" changed");
    let changed = PracticeSource::from_basic(&changed).unwrap();
    assert!(automatic_assistance::validate(&changed, &checked.plan).is_err());
    let canonical = PracticeSource::from_canonical(&score_core::catalog().remove(0)).unwrap();
    assert!(value(canonical.receipt()).get("source_eligibility").is_none());
}

#[test]
fn unknown_identity_keeps_every_target_and_pitch_mod_cannot_erase_original_exclusions() {
    for score in [
        basic(&[0, 192, 40, 0, 144, 60, 80, 96, 128, 60, 0]),
        basic(&[0, 240, 5, 126, 127, 9, 1, 247, 0, 192, 1, 0, 144, 60, 80, 96, 128, 60, 0]),
    ] {
        let source = PracticeSource::from_basic(&score).unwrap();
        let checked = automatic_assistance::original(&source, &scope(&source)).unwrap();
        assert!(checked.all_selected_human);
        assert_eq!(checked.coverage.human_source_unit_count, score.performance.notes.len());
        assert_eq!(value(source.timeline()), value(&basic_keys::compile_rendition(&score).unwrap().timeline));
    }
    let score = mixed();
    let original = PracticeSource::from_basic(&score).unwrap();
    for semitones in [-12, -2, 0, 2, 12] {
        let projection = PitchProjection::from_basic(&score, semitones).unwrap();
        let projected = projection.source();
        assert_eq!(projected.receipt().source_eligibility, original.receipt().source_eligibility);
        assert!(automatic_assistance::original(projected, &scope(projected)).is_err());
        let checked = automatic_assistance::generate(projected, &scope(projected), &permissive()).unwrap();
        assert_eq!(checked.coverage.human_source_unit_count, 2);
        for (before, after) in original.timeline().notes.iter().zip(&projected.timeline().notes) {
            assert_eq!(i16::from(after.midi), i16::from(before.midi) + semitones);
            assert_eq!(before.id, after.id);
            assert_eq!(before.start_ms, after.start_ms);
            assert_eq!(before.duration_ms, after.duration_ms);
        }
    }
}

#[test]
fn automatic_and_progression_move_complete_unison_atoms_to_machine() {
    // Both orderings matter: unsupported cannot hide behind the physical
    // group's supported representative or become the representative itself.
    for programs in [[40, 0], [0, 40]] {
        let score = basic(&[
            0, 240, 5, 126, 127, 9, 1, 247,
            0, 192, programs[0], 0, 193, programs[1],
            0, 144, 60, 80, 0, 145, 60, 80,
            96, 128, 60, 0, 0, 129, 60, 0,
            0, 193, 0, 0, 145, 64, 80, 96, 129, 64, 0,
        ]);
        let source = PracticeSource::from_basic(&score).unwrap();
        let analysis = source_identity::analyze_basic_practice(&score).unwrap();
        assert_eq!(analysis.complete_attack_count(), 3);
        let original = automatic_assistance::original(&source, &scope(&source)).unwrap_err();
        assert_eq!(original.source_ids.as_slice(), analysis.known_unsupported_source_attack_ids());
        let checked = automatic_assistance::generate(&source, &scope(&source), &permissive()).unwrap();
        assert_eq!(checked.coverage.selected_source_unit_count, 3);
        assert_eq!(checked.coverage.selected_target_count, 2);
        assert_eq!(checked.coverage.human_source_unit_count, 1);
        assert_eq!(checked.coverage.machine_source_unit_count, 2);
        assert_eq!(checked.exclusion_reasons[0].source_ids.len(), 2);
        let progression = practice_progression::generate(&source, &scope(&source), ProgressionLayer::Dense).unwrap();
        assert_eq!(progression.assistance.plan.human_source_ids, checked.plan.human_source_ids);
    }
    let unknown = basic(&[
        0, 192, 40, 0, 193, 0,
        0, 144, 60, 80, 0, 145, 60, 80,
        96, 128, 60, 0, 0, 129, 60, 0,
    ]);
    let source = PracticeSource::from_basic(&unknown).unwrap();
    let original = automatic_assistance::original(&source, &scope(&source)).unwrap();
    assert!(original.all_selected_human);
    assert_eq!(original.coverage.human_source_unit_count, 2);
    assert_eq!(original.human_targets.target_count, 1);
    assert!(original.scored_mode_allowed);
}

#[test]
fn held_and_zero_length_attacks_keep_their_attack_time_program_identity() {
    let score = basic(&[
        0, 240, 5, 126, 127, 9, 1, 247,
        0, 192, 40, 0, 144, 60, 80, 0, 128, 60, 0,
        1, 144, 62, 80, 1, 192, 0,
        1, 144, 64, 80, 96, 128, 62, 0, 0, 128, 64, 0,
    ]);
    let source = PracticeSource::from_basic(&score).unwrap();
    let analysis = source_identity::analyze_basic_practice(&score).unwrap();
    assert_eq!(analysis.known_unsupported_source_attack_ids().len(), 2);
    let error = automatic_assistance::original(&source, &scope(&source)).unwrap_err();
    assert_eq!(error.source_ids.len(), 2);
    let checked = automatic_assistance::generate(&source, &scope(&source), &permissive()).unwrap();
    assert_eq!(checked.coverage.human_source_unit_count, 1);
    assert_eq!(checked.coverage.machine_occurrence_count, 2);
    assert_eq!(source.timeline().notes.len(), 3);
}
