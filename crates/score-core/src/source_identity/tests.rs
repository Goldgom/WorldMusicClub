use super::*;
use serde_json::Value;
use std::path::Path;

fn json(value: &impl Serialize) -> Vec<u8> {
    serde_json::to_vec(value).unwrap()
}
fn rendition_snapshot(source: &basic_keys::CompleteBasicKeys) -> Vec<u8> {
    json(
        &basic_keys::compile_rendition(source)
            .map(|compiled| (compiled.timeline, compiled.rendition, compiled.diagnostics)),
    )
}
fn fixture(name: &str) -> basic_keys::CompleteBasicKeys {
    let path = Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("src/source_identity/fixtures")
        .join(format!("{name}.mid"));
    basic_keys::convert_midi(&std::fs::read(path).unwrap(), "Original mechanical fixture").unwrap()
}
fn vlq(mut value: u32) -> Vec<u8> {
    let mut bytes = vec![(value & 127) as u8];
    value >>= 7;
    while value != 0 {
        bytes.insert(0, ((value & 127) | 128) as u8);
        value >>= 7;
    }
    bytes
}
fn convert(tracks: &[Vec<(u32, Vec<u8>)>]) -> basic_keys::CompleteBasicKeys {
    let mut bytes = b"MThd\0\0\0\x06".to_vec();
    bytes.extend((if tracks.len() == 1 { 0u16 } else { 1u16 }).to_be_bytes());
    bytes.extend((tracks.len() as u16).to_be_bytes());
    bytes.extend(480u16.to_be_bytes());
    for events in tracks {
        let mut track = vec![];
        for (delta, event) in events {
            track.extend(vlq(*delta));
            track.extend(event);
        }
        track.extend([0, 255, 47, 0]);
        bytes.extend(b"MTrk");
        bytes.extend((track.len() as u32).to_be_bytes());
        bytes.extend(track);
    }
    basic_keys::convert_midi(&bytes, "Original synthetic test").unwrap()
}
fn gm(mode: u8) -> Vec<u8> {
    vec![240, 5, 126, 127, 9, mode, 247]
}
fn codes(disclosure: &SourceIdentityDisclosure, attack: usize) -> Vec<Reason> {
    disclosure.attacks[attack]
        .reason_indices
        .iter()
        .map(|i| disclosure.diagnostics[*i].code)
        .collect()
}

// The manifest contains authored expected outcomes, not an assertion that tests
// ran. Only a successful execution of this test establishes implementation evidence.
#[test]
fn authored_38_case_contract_matches_49_attack_snapshots() {
    let manifest: Value = serde_json::from_str(include_str!("fixtures/cases.json")).unwrap();
    let cases = manifest["cases"].as_array().unwrap();
    assert_eq!(cases.len(), 38);
    let root = Path::new(env!("CARGO_MANIFEST_DIR")).join("src/source_identity");
    let mut total = 0;
    for case in cases {
        let bytes = std::fs::read(root.join(case["file"].as_str().unwrap())).unwrap();
        assert_eq!(
            format!("{:x}", Sha256::digest(&bytes)),
            case["sha256"].as_str().unwrap()
        );
        let source = basic_keys::convert_midi(&bytes, "Original authored fixture").unwrap();
        let before = basic_keys::encode_json(&source).unwrap();
        let details = describe_basic(&source).unwrap();
        assert_eligibility_matches(&source, &details);
        let expected = case["attacks"].as_array().unwrap();
        assert_eq!(details.attacks.len(), expected.len(), "{}", case["id"]);
        for (attack, want) in details.attacks.iter().zip(expected) {
            let actual = serde_json::to_value(attack).unwrap();
            assert_eq!(
                actual["classification"], want["expected_classification"],
                "{}",
                case["id"]
            );
            assert_eq!(actual["attack_coordinate"]["track"], want["track"]);
            assert_eq!(actual["attack_coordinate"]["event"], want["event"]);
            assert_eq!(actual["tick"], want["tick"]);
            assert_eq!(actual["channel"], want["channel"]);
        }
        assert_eq!(basic_keys::encode_json(&source).unwrap(), before);
        assert_eq!(
            details.source_binding.domain,
            "wmc-basic-complete-wire-json"
        );
        assert_eq!(details.source_binding.serialization_revision, 1);
        assert_eq!(
            details.source_binding.digest,
            format!("{:x}", Sha256::digest(&before))
        );
        assert_eq!(
            details.original_midi_sha256,
            case["sha256"].as_str().unwrap()
        );
        total += details.attacks.len();
    }
    assert_eq!(total, 49);
}

#[test]
fn bank_commit_is_a_snapshot_and_carries_exact_source_coordinates() {
    let source = fixture("17_pending_bank_keeps_previous");
    let details = describe_basic(&source).unwrap();
    let selections: Vec<_> = details
        .attacks
        .iter()
        .map(|a| a.committed_selection.as_ref().unwrap())
        .collect();
    assert_eq!(selections[0].bank_lsb, Some(0));
    assert_eq!(selections[1].bank_lsb, Some(0));
    assert_eq!(selections[2].bank_lsb, Some(1));
    assert_eq!(selections[0].program_coordinate.event, 3);
    assert_eq!(selections[1].program_coordinate.event, 3);
    assert_eq!(selections[2].program_coordinate.event, 9);
    assert_eq!(selections[0].bank_lsb_coordinate.unwrap().event, 2);
    assert_eq!(selections[2].bank_lsb_coordinate.unwrap().event, 6);
    assert_eq!(selections[2].namespace_coordinate.unwrap().event, 0);
}

#[test]
fn mixed_part_counts_preserve_unsupported_identity_without_adaptation() {
    let details = describe_basic(&fixture("31_program_changes_per_attack")).unwrap();
    assert_eq!(details.parts.len(), 1);
    let part = &details.parts[0];
    assert!(part.mixed);
    assert_eq!(part.attack_count, 2);
    assert_eq!(part.supported_count, 1);
    assert_eq!(part.known_unsupported_count, 1);
    assert_eq!(part.unresolved_count, 0);
    assert_eq!(part.classification, Classification::Unresolved);
    assert_eq!(part.identity_counts.len(), 2);
    assert_eq!(details.attacks[1].label, Some("Violin"));
}

#[test]
fn metadata_only_route_blocks_all_identity_and_is_preserved() {
    let source = convert(&[
        vec![(0, gm(1)), (1, vec![192, 0]), (1, vec![144, 60, 64])],
        vec![(100, vec![255, 9, 3, 255, 0, 65]), (0, vec![255, 33, 1, 0])],
    ]);
    let details = describe_basic(&source).unwrap();
    assert_eq!(
        details.attacks[0].classification,
        Classification::Unresolved
    );
    assert!(codes(&details, 0).contains(&Reason::ExplicitRoutingOutOfScope));
    assert!(details.routes.iter().any(|r| r.source_route_index.is_none()
        && r.device_name_bytes.as_deref() == Some(&[255, 0, 65][..])
        && r.port == Some(0)
        && r.declaration_coordinates == [Coordinate { track: 1, event: 1 }]));
}

#[test]
fn channel_prefix_never_rewrites_channel_status() {
    let source = convert(&[vec![
        (0, gm(1)),
        (0, vec![255, 32, 1, 9]),
        (1, vec![192, 0]),
        (1, vec![144, 60, 64]),
    ]]);
    let details = describe_basic(&source).unwrap();
    assert_eq!(details.attacks[0].channel, 0);
    assert_eq!(details.attacks[0].classification, Classification::Supported);
}

#[test]
fn malformed_legacy_program_is_never_clamped_or_repaired() {
    let source = convert(&[vec![
        (0, gm(1)),
        (0, vec![192, 128]),
        (1, vec![144, 60, 64]),
    ]]);
    let details = describe_basic(&source).unwrap();
    assert_eq!(
        details.attacks[0].classification,
        Classification::Unresolved
    );
    assert_eq!(
        details.attacks[0]
            .committed_selection
            .as_ref()
            .unwrap()
            .program,
        128
    );
    assert!(codes(&details, 0).contains(&Reason::InvalidProgram));
}

#[test]
fn exact_packet_boundary_is_required_and_taint_survives_reset() {
    for packet in [
        vec![240, 6, 126, 127, 9, 1, 247, 0],
        vec![240, 6, 0, 126, 127, 9, 1, 247],
        vec![247, 5, 126, 127, 9, 1, 247],
        vec![240, 4, 126, 127, 9, 1],
        vec![255, 127, 1, 0],
    ] {
        let source = convert(&[vec![
            (0, packet),
            (1, gm(1)),
            (1, vec![192, 0]),
            (1, vec![144, 60, 64]),
        ]]);
        let details = describe_basic(&source).unwrap();
        assert_eq!(
            details.attacks[0].classification,
            Classification::Unresolved
        );
        assert!(!details
            .epochs
            .last()
            .unwrap()
            .taint_reason_indices
            .is_empty());
    }
}

#[test]
fn unreviewed_programs_and_variations_stay_unresolved() {
    for program in [1, 5, 8, 26, 31, 127] {
        let source = convert(&[vec![
            (0, gm(1)),
            (1, vec![192, program]),
            (1, vec![144, 60, 64]),
        ]]);
        let details = describe_basic(&source).unwrap();
        assert!(codes(&details, 0).contains(&Reason::UnknownTuple));
        assert_eq!(details.attacks[0].identity_key, None);
    }
}

#[test]
fn invalid_projection_is_rejected_and_valid_wire_change_rebinds() {
    let source = fixture("04_gm1_piano");
    let original = describe_basic(&source).unwrap();
    let mut tampered = source.clone();
    tampered.performance.notes[0].note_id.push('x');
    assert_eq!(
        describe_basic(&tampered).unwrap_err().code,
        "invalid_basic_source"
    );
    tampered = source.clone();
    tampered.performance.tracks[0].events[2].1[1] = 61;
    assert_eq!(
        describe_basic(&tampered).unwrap_err().code,
        "invalid_basic_source"
    );
    let other = describe_basic(&fixture("07_gm1_violin")).unwrap();
    assert_ne!(original.source_binding.digest, other.source_binding.digest);
    let mut non_basic = source;
    non_basic.performance.profile = "unrecognized".into();
    assert_eq!(
        describe_basic(&non_basic).unwrap_err().code,
        "non_basic_profile"
    );
}

#[test]
fn original_hash_is_declared_provenance_and_not_an_original_byte_verification() {
    let mut source = fixture("04_gm1_piano");
    source.source.sha256 = "a".repeat(64);
    source.notation.id = format!("midi-basic-{}", source.source.sha256);
    let details = describe_basic(&source).unwrap();
    assert_eq!(
        details.original_bytes_verification,
        source_instrument::OriginalBytesVerification::DeclaredProvenanceOnly
    );
    assert_eq!(details.original_midi_sha256, "a".repeat(64));
}

#[test]
fn budget_error_is_complete_failure_and_leaves_source_and_rendition_unchanged() {
    let source = fixture("31_program_changes_per_attack");
    let wire = basic_keys::encode_json(&source).unwrap();
    let before = rendition_snapshot(&source);
    let numeric_before = json(&source_instrument::describe_basic(&source).unwrap());
    let details = describe_basic(&source).unwrap();
    assert_eq!(bounded(details, 1).unwrap_err().code, "analysis_limit");
    assert_eq!(basic_keys::encode_json(&source).unwrap(), wire);
    assert_eq!(rendition_snapshot(&source), before);
    assert_eq!(
        json(&source_instrument::describe_basic(&source).unwrap()),
        numeric_before
    );
}

#[test]
fn same_track_attack_before_opaque_boundary_keeps_its_snapshot() {
    let source = convert(&[vec![
        (0, gm(1)),
        (0, vec![192, 0]),
        (0, vec![144, 60, 64]),
        (0, vec![255, 127, 1, 0]),
        (0, vec![144, 61, 64]),
    ]]);
    let details = describe_basic(&source).unwrap();
    assert_eq!(details.attacks[0].classification, Classification::Supported);
    assert_eq!(
        details.attacks[1].classification,
        Classification::Unresolved
    );
}

#[test]
fn large_foreign_ties_do_not_enumerate_interleavings_or_forget_taint() {
    let mut tracks = vec![vec![
        (0, gm(1)),
        (1, vec![192, 0]),
        (1, vec![144, 60, 64]),
        (1, gm(1)),
        (1, vec![192, 0]),
        (1, vec![144, 61, 64]),
    ]];
    for _ in 1..128 {
        tracks.push(vec![(2, vec![192, 40])]);
    }
    let details = describe_basic(&convert(&tracks)).unwrap();
    assert_eq!(details.attacks.len(), 2);
    for i in 0..2 {
        assert_eq!(
            details.attacks[i].classification,
            Classification::Unresolved
        );
        assert!(codes(&details, i).contains(&Reason::CrossTrackOrderUncertain));
        assert!(details.attacks[i].committed_selection.is_none());
    }
    assert!(details.diagnostics.len() <= 2);
}

#[test]
fn opaque_diagnostics_are_interned_instead_of_quadratically_copied() {
    let mut events = vec![(0, gm(1)), (0, vec![192, 0])];
    for key in 0..100 {
        events.push((1, vec![240, 2, 125, 247]));
        events.push((1, vec![144, key, 64]));
    }
    let details = describe_basic(&convert(&[events])).unwrap();
    assert_eq!(details.attacks.len(), 100);
    assert_eq!(details.diagnostics.len(), 1);
    assert!(details.attacks.iter().all(|a| a.reason_indices == [0]));
}

#[test]
fn continuation_keeps_original_attack_identity_and_creates_no_new_snapshot() {
    let source = convert(&[vec![
        (0, gm(1)),
        (0, vec![192, 0]),
        (0, vec![144, 60, 64]),
        (1920, vec![192, 40]),
        (1920, vec![128, 60, 0]),
    ]]);
    let details = describe_basic(&source).unwrap();
    assert_eq!(details.attacks.len(), 1);
    assert_eq!(details.attacks[0].label, Some("Acoustic Grand Piano"));
    let page = basic_keys::notation_page(
        &source,
        &basic_keys::NotationRequest {
            part_id: source.performance.parts[0].id.clone(),
            rendition_policy_id: None,
            first_measure: 1,
            measure_count: 1,
            display_meter: Some(basic_keys::DisplayMeter {
                numerator: 4,
                denominator: 4,
            }),
            position_ms: None,
        },
    )
    .unwrap();
    let page_json = serde_json::to_value(page).unwrap();
    let serialized = page_json.to_string();
    assert!(serialized.contains(&details.attacks[0].note_id));
    assert_eq!(describe_basic(&source).unwrap().attacks.len(), 1);
}

#[test]
fn repeated_metadata_ports_use_interned_names_including_alternating_ports() {
    // Repeated full-name map comparisons would process ~10 GiB here despite
    // only 256 KiB of name bytes in the input. Port lookups must use compact IDs.
    let name = vec![b'A'; 256 * 1024];
    let mut declaration = vec![255, 9];
    declaration.extend(vlq(name.len() as u32));
    declaration.extend(&name);
    let mut metadata = vec![(0, declaration)];
    for index in 0..40_000 {
        metadata.push((0, vec![255, 33, 1, (index % 2) as u8]));
    }
    let source = convert(&[
        vec![(0, gm(1)), (1, vec![192, 0]), (1, vec![144, 60, 64])],
        metadata,
    ]);
    let details = describe_basic(&source).unwrap();
    assert_eq!(
        details.attacks[0].classification,
        Classification::Unresolved
    );
    assert_eq!(
        details
            .routes
            .iter()
            .map(|r| r.declaration_coordinates.len())
            .sum::<usize>(),
        40_001
    );
    assert_eq!(
        details
            .routes
            .iter()
            .filter(|r| r.device_name_bytes.as_ref() == Some(&name))
            .count(),
        3
    );
}

fn assert_eligibility_matches(
    source: &basic_keys::CompleteBasicKeys,
    disclosure: &SourceIdentityDisclosure,
) -> SourcePracticeEligibility {
    let result = analyze_basic_practice(source).unwrap();
    assert_eq!(result.revision(), 1);
    assert_eq!(result.analysis_policy_id(), disclosure.analysis_policy_id);
    assert_eq!(
        result.identity_table_revision(),
        disclosure.identity_table_revision
    );
    assert_eq!(result.product_policy_id(), disclosure.product_policy_id);
    assert_eq!(
        result.eligibility_policy_id(),
        PRACTICE_ELIGIBILITY_POLICY_ID
    );
    assert_eq!(result.source_profile(), disclosure.source_profile);
    assert_eq!(result.source_binding(), &disclosure.source_binding);
    assert_eq!(
        result.complete_attack_count(),
        source.performance.notes.len()
    );
    assert_eq!(result.complete_attack_count(), disclosure.attacks.len());
    let expected_ids: Vec<_> = disclosure
        .attacks
        .iter()
        .filter(|attack| attack.classification == Classification::KnownUnsupported)
        .map(|attack| attack.note_id.clone())
        .collect();
    assert_eq!(result.known_unsupported_source_attack_ids(), expected_ids);
    assert_eq!(result.parts().len(), disclosure.parts.len());
    for (actual, expected) in result.parts().iter().zip(&disclosure.parts) {
        assert_eq!(actual.part_id(), expected.part_id);
        assert_eq!(actual.attack_count(), expected.attack_count);
        assert_eq!(actual.supported_count(), expected.supported_count);
        assert_eq!(
            actual.known_unsupported_count(),
            expected.known_unsupported_count
        );
        assert_eq!(actual.unresolved_count(), expected.unresolved_count);
    }
    result
}

// Newly authored mechanical MIDI event sequences below are original fixtures
// offered under CC0-1.0, not songs or private MIDI-derived transcriptions.
#[test]
fn eligibility_excludes_only_known_unsupported_attacks_in_a_mixed_part() {
    let source = convert(&[vec![
        (0, gm(1)),
        (0, vec![192, 40]),
        (1, vec![144, 60, 64]),
        (1, vec![128, 60, 0]),
        (0, vec![192, 0]),
        (1, vec![144, 62, 64]),
        (1, vec![128, 62, 0]),
        (0, vec![192, 1]),
        (1, vec![144, 64, 64]),
        (1, vec![128, 64, 0]),
    ]]);
    let wire = basic_keys::encode_json(&source).unwrap();
    let rendition = rendition_snapshot(&source);
    let disclosure = describe_basic(&source).unwrap();
    let result = assert_eligibility_matches(&source, &disclosure);
    assert_eq!(
        disclosure.parts[0].classification,
        Classification::Unresolved
    );
    assert_eq!(result.parts().len(), 1);
    let part = &result.parts()[0];
    assert_eq!(part.attack_count(), 3);
    assert_eq!(part.supported_count(), 1);
    assert_eq!(part.known_unsupported_count(), 1);
    assert_eq!(part.unresolved_count(), 1);
    assert_eq!(
        result.known_unsupported_source_attack_ids(),
        &[source.performance.notes[0].note_id.clone()]
    );
    assert_eq!(basic_keys::encode_json(&source).unwrap(), wire);
    assert_eq!(rendition_snapshot(&source), rendition);
}

#[test]
fn eligibility_keeps_zero_length_and_held_attack_identity_across_program_changes() {
    let source = convert(&[vec![
        (0, gm(1)),
        (0, vec![192, 40]),
        (1, vec![144, 60, 64]),
        (0, vec![128, 60, 0]),
        (1, vec![144, 62, 64]),
        (1, vec![192, 0]),
        (1, vec![144, 64, 64]),
        (1, vec![128, 62, 0]),
        (0, vec![128, 64, 0]),
    ]]);
    assert_eq!(source.coverage.zero_length_attacks, 1);
    assert_eq!(source.notation.parts[0].notes.len(), 2);
    let result = assert_eligibility_matches(&source, &describe_basic(&source).unwrap());
    assert_eq!(result.complete_attack_count(), 3);
    assert_eq!(
        result.known_unsupported_source_attack_ids(),
        &[
            source.performance.notes[0].note_id.clone(),
            source.performance.notes[1].note_id.clone(),
        ]
    );
    // The zero-length attack has no notation projection, but remains excluded.
    assert!(!source.notation.parts[0]
        .notes
        .iter()
        .any(|note| note.id == result.known_unsupported_source_attack_ids()[0]));
}

#[test]
fn eligibility_preserves_raw_compatibility_for_no_gm_unreviewed_and_routing() {
    for name in [
        "01_no_gm_program",
        "14_unknown_variant",
        "25_port_zero_out_of_scope",
        "26_device_name_out_of_scope",
        "28_foreign_program_attack_tie",
        "29_foreign_reset_attack_tie",
    ] {
        let source = fixture(name);
        let before = basic_keys::encode_json(&source).unwrap();
        let result = assert_eligibility_matches(&source, &describe_basic(&source).unwrap());
        assert!(
            result.known_unsupported_source_attack_ids().is_empty(),
            "{name}"
        );
        assert!(result.complete_attack_count() > 0);
        assert_eq!(basic_keys::encode_json(&source).unwrap(), before);
    }
    for program in [1, 5, 8, 26, 31, 127] {
        let source = convert(&[vec![
            (0, gm(1)),
            (1, vec![192, program]),
            (1, vec![144, 60, 64]),
        ]]);
        let result = analyze_basic_practice(&source).unwrap();
        assert!(result.known_unsupported_source_attack_ids().is_empty());
        assert_eq!(result.parts()[0].unresolved_count(), 1);
    }
}

#[test]
fn eligibility_failure_is_unavailable_and_never_partial_or_empty_success() {
    let source = fixture("31_program_changes_per_attack");
    let mut invalid = source.clone();
    invalid.performance.notes[1].note_id.push('x');
    assert_eq!(
        analyze_basic_practice(&invalid).unwrap_err().code(),
        "invalid_basic_source"
    );
    invalid = source.clone();
    invalid.performance.notes.pop();
    assert_eq!(
        analyze_basic_practice(&invalid).unwrap_err().code(),
        "invalid_basic_source"
    );
    invalid = source.clone();
    invalid.performance.profile = "unrecognized".into();
    assert_eq!(
        analyze_basic_practice(&invalid).unwrap_err().code(),
        "non_basic_profile"
    );
    let result = analyze_basic_practice(&source).unwrap();
    assert_eq!(result.complete_attack_count(), 2);
    assert_eq!(result.known_unsupported_source_attack_ids().len(), 1);
    let other = analyze_basic_practice(&fixture("07_gm1_violin")).unwrap();
    assert_ne!(result.source_binding(), other.source_binding());
}

#[test]
fn eligibility_is_independent_of_both_optional_disclosure_limits() {
    // A metadata-only route's repeated copied name can exhaust either optional
    // evidence budget without making complete source eligibility unavailable.
    for (name_bytes, ports, message) in [
        (128 * 1024, 90, "Complete informational output"),
        (512 * 1024, 70, "Route evidence"),
    ] {
        let mut declaration = vec![255, 9];
        declaration.extend(vlq(name_bytes));
        declaration.extend(vec![b'A'; name_bytes as usize]);
        let mut metadata = vec![(0, declaration)];
        for port in 0..ports {
            metadata.push((0, vec![255, 33, 1, port]));
        }
        let source = convert(&[
            vec![(0, gm(1)), (1, vec![192, 40]), (1, vec![144, 60, 64])],
            metadata,
        ]);
        let before = basic_keys::encode_json(&source).unwrap();
        let failure = describe_basic(&source).unwrap_err();
        assert_eq!(failure.code(), "analysis_limit");
        assert!(failure.message().starts_with(message));
        let result = analyze_basic_practice(&source).unwrap();
        assert_eq!(result.complete_attack_count(), 1);
        assert!(result.known_unsupported_source_attack_ids().is_empty());
        assert_eq!(result.parts()[0].unresolved_count(), 1);
        assert_eq!(
            result.source_binding().digest,
            format!("{:x}", Sha256::digest(&before))
        );
        assert_eq!(basic_keys::encode_json(&source).unwrap(), before);
    }
    let source = fixture("07_gm1_violin");
    assert_eq!(
        bounded(describe_basic(&source).unwrap(), 1)
            .unwrap_err()
            .code(),
        "analysis_limit"
    );
    assert_eq!(
        analyze_basic_practice(&source)
            .unwrap()
            .known_unsupported_source_attack_ids()
            .len(),
        1
    );
}

#[test]
fn eligibility_is_complete_at_the_admitted_event_bound() {
    // Original synthetic CC0 event sequence. Unreleased attacks are still
    // source attacks; avoid notation projection to exercise the full event cap.
    let count = crate::midi_events::MAX_EVENTS - 3; // GM On, program, EndOfTrack.
    let mut events = Vec::with_capacity(count + 2);
    events.push((0, gm(1)));
    events.push((0, vec![192, 40]));
    for _ in 0..count {
        events.push((0, vec![144, 60, 64]));
    }
    let source = convert(&[events]);
    assert_eq!(
        source.coverage.source_events,
        crate::midi_events::MAX_EVENTS
    );
    let result = analyze_basic_practice(&source).unwrap();
    assert_eq!(result.complete_attack_count(), count);
    assert_eq!(result.known_unsupported_source_attack_ids().len(), count);
    assert_eq!(result.parts().len(), 1);
    assert_eq!(result.parts()[0].known_unsupported_count(), count);
    // Exactly one short generated ID per excluded source attack, without any
    // size cap that would silently drop IDs or reuse the disclosure envelope.
    for (actual, expected) in result
        .known_unsupported_source_attack_ids()
        .iter()
        .zip(&source.performance.notes)
    {
        assert_eq!(actual, &expected.note_id);
        assert!(actual.len() <= "midi-t128-e250000".len());
    }
    assert_eq!(result.parts()[0].attack_count(), count);
}

#[test]
fn eligibility_preserves_complete_counts_for_parts_without_attacks() {
    let source = convert(&[vec![
        (0, gm(1)),
        (0, vec![192, 0]),
        (0, vec![193, 40]),
        (1, vec![145, 60, 64]),
    ]]);
    let result = assert_eligibility_matches(&source, &describe_basic(&source).unwrap());
    assert_eq!(result.parts().len(), 2);
    assert_eq!(result.parts()[0].attack_count(), 0);
    assert_eq!(result.parts()[0].known_unsupported_count(), 0);
    assert_eq!(result.parts()[1].attack_count(), 1);
    assert_eq!(result.parts()[1].known_unsupported_count(), 1);
}
