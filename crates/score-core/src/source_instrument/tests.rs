use super::*;

// Original mechanical MIDI fixtures. No melodies, private scores or captures.
fn smf(tracks: &[Vec<u8>]) -> Vec<u8> {
    let mut bytes = b"MThd\0\0\0\x06".to_vec();
    bytes.extend((if tracks.len() == 1 { 0u16 } else { 1 }).to_be_bytes());
    bytes.extend((tracks.len() as u16).to_be_bytes());
    bytes.extend(96u16.to_be_bytes());
    for track in tracks {
        bytes.extend(b"MTrk");
        bytes.extend((track.len() as u32).to_be_bytes());
        bytes.extend(track);
    }
    bytes
}
fn track(events: &[(u8, &[u8])]) -> Vec<u8> {
    let mut bytes = vec![];
    for (delta, event) in events {
        assert!(*delta < 128);
        bytes.push(*delta);
        bytes.extend(*event);
    }
    bytes.extend([0, 255, 47, 0]);
    bytes
}
fn canonical(tracks: &[Vec<u8>]) -> Score {
    crate::import_midi(&smf(tracks)).unwrap().0
}
fn basic(tracks: &[Vec<u8>]) -> basic_keys::CompleteBasicKeys {
    basic_keys::convert_midi(&smf(tracks), "Original mechanical instrument evidence").unwrap()
}
fn single_note() -> Vec<u8> {
    track(&[(0, &[0x90, 60, 80]), (96, &[0x80, 60, 0])])
}

#[test]
fn missing_program_stays_unknown_despite_piano_labels_and_renderer_defaults() {
    let mut score = canonical(&[track(&[
        (0, &[255, 3, 5, b'P', b'i', b'a', b'n', b'o']),
        (0, &[255, 4, 5, b'P', b'i', b'a', b'n', b'o']),
        (0, &[0x90, 60, 80]),
        (96, &[0x80, 60, 0]),
    ])]);
    score.parts[0].instrument = "Grand piano".into();
    let before = serde_json::to_vec(&score).unwrap();
    let d = describe_canonical_midi(&score).unwrap();
    assert_eq!(
        d.parts[0].selection_summary.status,
        SelectionStatus::Unknown
    );
    assert!(d.parts[0].selection_summary.observed_selections.is_empty());
    assert_eq!(
        d.parts[0]
            .selection_summary
            .attacks_without_declared_program,
        1
    );
    assert!(d.channels[0].selection_timeline.is_empty());
    assert_eq!(d.tracks[0].names.len(), 2);
    assert_eq!(d.tracks[0].names[1].role, NameRole::InstrumentName);
    assert_eq!(d.tracks[0].names[1].utf8.as_deref(), Some("Piano"));
    assert_eq!(d.instrument_namespace, InstrumentNamespace::Unknown);
    assert_eq!(
        d.original_bytes_verification,
        OriginalBytesVerification::VerifiedRetainedBytes
    );
    assert_eq!(serde_json::to_vec(&score).unwrap(), before);
}

#[test]
fn source_program_zero_is_numeric_and_explicit_unknown_banks_are_not_zero() {
    let score = canonical(&[track(&[
        (0, &[0xc0, 0]),
        (0, &[0x90, 60, 80]),
        (96, &[0x80, 60, 0]),
    ])]);
    let d = describe_canonical_midi(&score).unwrap();
    assert_eq!(d.parts[0].selection_summary.status, SelectionStatus::Known);
    assert_eq!(
        d.parts[0].selection_summary.observed_selections,
        vec![NumericSelection {
            program: 0,
            bank_most_significant: None,
            bank_least_significant: None,
        }]
    );
    assert_eq!(d.instrument_namespace, InstrumentNamespace::Unknown);
    assert_eq!(
        d.source_binding,
        practice_source::PracticeSource::from_canonical(&score)
            .unwrap()
            .receipt()
            .source_binding
    );
}

#[test]
fn program_changes_and_pending_bank_selectors_retain_exact_source_order() {
    let score = canonical(&[track(&[
        (0, &[0xb0, 0, 2]),
        (0, &[0xb0, 32, 3]),
        (0, &[0xc0, 24]),
        (1, &[0x90, 60, 80]),
        (1, &[0x80, 60, 0]),
        (0, &[0xb0, 0, 4]), // Pending bank alone does not select a new patch.
        (1, &[0x90, 64, 80]),
        (1, &[0x80, 64, 0]),
        (0, &[0xc0, 25]),
        (1, &[0x90, 67, 80]),
        (1, &[0x80, 67, 0]),
    ])]);
    let d = describe_canonical_midi(&score).unwrap();
    let part = &d.parts[0];
    assert_eq!(part.selection_summary.status, SelectionStatus::Changes);
    assert_eq!(part.source_attack_count, 3);
    assert_eq!(part.notated_note_count, 3);
    assert_eq!(
        (
            part.key_range.as_ref().unwrap().lowest,
            part.key_range.as_ref().unwrap().highest
        ),
        (60, 67)
    );
    assert_eq!(
        part.selection_summary.observed_selections,
        vec![
            NumericSelection {
                program: 24,
                bank_most_significant: Some(2),
                bank_least_significant: Some(3)
            },
            NumericSelection {
                program: 25,
                bank_most_significant: Some(4),
                bank_least_significant: Some(3)
            },
        ]
    );
    let timeline = &d.channels[0].selection_timeline;
    assert_eq!(timeline.len(), 5);
    assert_eq!(timeline[4].at.origin, Coordinate { track: 0, event: 8 });
    assert_eq!(timeline[4].at.tick, 4);
    assert!(timeline[4].at.beat.equivalent(Beat::new(1, 24)));
    assert!(timeline[4].at.event_id.ends_with(":t0:e8"));
    assert_eq!(part.first_attack.as_ref().unwrap().origin.event, 3);
    assert_eq!(part.last_attack.as_ref().unwrap().origin.event, 9);
}

#[test]
fn a_later_program_does_not_retroactively_name_prior_attacks() {
    let score = canonical(&[track(&[
        (0, &[0x90, 60, 80]),
        (1, &[0x80, 60, 0]),
        (1, &[0xc0, 9]),
        (1, &[0x90, 61, 80]),
        (1, &[0x80, 61, 0]),
    ])]);
    let d = describe_canonical_midi(&score).unwrap();
    assert_eq!(d.parts[0].selection_summary.status, SelectionStatus::Mixed);
    assert_eq!(
        d.parts[0]
            .selection_summary
            .attacks_without_declared_program,
        1
    );
}

#[test]
fn controller_only_track_contributes_to_every_shared_logical_channel() {
    let score = canonical(&[
        track(&[(0, &[0xc0, 31]), (3, &[0xc0, 42])]),
        track(&[
            (1, &[0x90, 60, 80]),
            (1, &[0x80, 60, 0]),
            (2, &[0x90, 62, 80]),
            (1, &[0x80, 62, 0]),
        ]),
        track(&[(2, &[0x90, 72, 80]), (1, &[0x80, 72, 0])]),
    ]);
    let d = describe_canonical_midi(&score).unwrap();
    assert_eq!(d.parts.len(), 2);
    assert_eq!(d.channels.len(), 1);
    assert_eq!(d.channels[0].selection_timeline.len(), 2);
    assert!(d.channels[0]
        .selection_timeline
        .iter()
        .all(|e| e.at.origin.track == 0));
    assert_eq!(d.parts[0].channel_id, d.parts[1].channel_id);
    assert_eq!(
        d.parts[0].selection_summary.status,
        SelectionStatus::Changes
    );
    assert_eq!(d.parts[1].selection_summary.status, SelectionStatus::Known);
    assert_eq!(
        d.parts[1].selection_summary.observed_selections[0].program,
        31
    );
}

#[test]
fn cross_track_same_tick_selection_never_uses_track_sort_as_execution_order() {
    let score = canonical(&[
        track(&[(0, &[0xc0, 12])]),
        track(&[(0, &[0x90, 60, 80]), (1, &[0x80, 60, 0])]),
    ]);
    let d = describe_canonical_midi(&score).unwrap();
    assert_eq!(d.channels[0].ambiguous_ticks, vec![0]);
    assert_eq!(
        d.parts[0].selection_summary.status,
        SelectionStatus::Ambiguous
    );
    assert_eq!(
        d.parts[0]
            .selection_summary
            .attacks_with_ambiguous_selection,
        1
    );
    assert!(d.parts[0].selection_summary.observed_selections.is_empty());
}

#[test]
fn basic_names_keep_bytes_prefix_scope_and_metadata_only_routing() {
    let score = basic(&[track(&[
        (0, &[255, 0x21, 1, 7]),
        (0, &[255, 9, 1, b'A']),
        (0, &[255, 0x20, 1, 2]),
        (0, &[255, 4, 2, 0xff, 0xfe]),
        (0, &[0xc2, 8]),
        (0, &[255, 8, 1, b'X']),
        (0, &[0x92, 60, 80]),
        (1, &[0x82, 60, 0]),
        (0, &[255, 9, 1, b'B']),
        (0, &[255, 8, 1, b'Y']),
    ])]);
    let d = describe_basic(&score).unwrap();
    let names = &d.tracks[0].names;
    assert_eq!(names.len(), 3);
    assert_eq!(names[0].bytes, [0xff, 0xfe]);
    assert!(names[0].utf8.is_none());
    assert_eq!(names[0].channel_prefix, Some(2));
    assert_eq!(names[0].source_route_index, Some(0));
    assert_eq!(
        names[0].port_declaration,
        Some(Coordinate { track: 0, event: 0 })
    );
    assert_eq!(
        names[0].device_name_declaration,
        Some(Coordinate { track: 0, event: 1 })
    );
    assert_eq!(names[1].channel_prefix, None);
    assert_eq!(names[2].source_route_index, None);
    assert_eq!(
        names[2].device_name_declaration,
        Some(Coordinate { track: 0, event: 8 })
    );
    assert_eq!(d.routes[0].declaration.port, Some(7));
    assert_eq!(d.channels[0].channel, 2);
}

#[test]
fn explicit_routes_separate_numeric_declarations_without_proving_devices() {
    let score = basic(&[
        track(&[
            (0, &[255, 0x21, 1, 1]),
            (0, &[0xc0, 7]),
            (0, &[0x90, 60, 80]),
            (1, &[0x80, 60, 0]),
        ]),
        track(&[
            (0, &[255, 0x21, 1, 2]),
            (0, &[0xc0, 8]),
            (0, &[0x90, 64, 80]),
            (1, &[0x80, 64, 0]),
        ]),
    ]);
    let d = describe_basic(&score).unwrap();
    assert_eq!(d.routes.len(), 2);
    assert_eq!(d.channels.len(), 2);
    assert_ne!(d.parts[0].channel_id, d.parts[1].channel_id);
    assert_eq!(
        d.parts[0].selection_summary.observed_selections[0].program,
        7
    );
    assert_eq!(
        d.parts[1].selection_summary.observed_selections[0].program,
        8
    );
    assert_eq!(
        d.original_bytes_verification,
        OriginalBytesVerification::DeclaredProvenanceOnly
    );
}

#[test]
fn basic_attack_statistics_include_zero_length_open_and_percussion_keys() {
    let score = basic(&[track(&[
        (0, &[0x99, 36, 80]),
        (0, &[0x89, 36, 0]),
        (1, &[0x99, 42, 80]),
        (1, &[0x89, 42, 0]),
        (1, &[0x99, 49, 80]),
    ])]);
    let d = describe_basic(&score).unwrap();
    assert_eq!(d.parts[0].source_attack_count, 3);
    assert_eq!(d.parts[0].notated_note_count, 1);
    assert_eq!(d.channels[0].channel, 9);
    let range = d.parts[0].key_range.as_ref().unwrap();
    assert_eq!((range.lowest, range.highest), (36, 49));
    assert_eq!(
        d.parts[0].selection_summary.status,
        SelectionStatus::Unknown
    );
    assert_eq!(d.instrument_namespace, InstrumentNamespace::Unknown);
}

#[test]
fn uninterpreted_sysex_is_disclosed_without_claiming_general_midi_sound() {
    let score = basic(&[track(&[
        (0, &[0xf0, 5, 0x7e, 0x7f, 0x09, 0x01, 0xf7]),
        (0, &[0xc0, 0]),
        (0, &[0x90, 60, 80]),
        (1, &[0x80, 60, 0]),
    ])]);
    let d = describe_basic(&score).unwrap();
    assert_eq!(d.uninterpreted_sound_events.len(), 1);
    assert_eq!(d.uninterpreted_sound_events[0].origin.event, 0);
    assert_eq!(
        d.parts[0].selection_summary.status,
        SelectionStatus::Ambiguous
    );
    assert_eq!(d.instrument_namespace, InstrumentNamespace::Unknown);
}

#[test]
fn invalid_basic_program_byte_is_not_a_valid_patch_or_default_zero() {
    let score = basic(&[track(&[
        (0, &[0xc0, 200]),
        (0, &[0x90, 60, 80]),
        (1, &[0x80, 60, 0]),
    ])]);
    let d = describe_basic(&score).unwrap();
    assert!(matches!(
        d.channels[0].selection_timeline[0].declaration,
        SelectionDeclaration::InvalidProgram { byte: 200 }
    ));
    assert_eq!(
        d.parts[0].selection_summary.status,
        SelectionStatus::Ambiguous
    );
    assert!(d.parts[0].selection_summary.observed_selections.is_empty());
}

#[test]
fn original_projection_checks_reject_pitch_tempo_navigation_and_source_edits() {
    let score = canonical(&[single_note()]);
    let mut changed = score.clone();
    changed.parts[0].notes[0].pitch.as_mut().unwrap().octave += 1;
    assert_eq!(
        describe_canonical_midi(&changed).unwrap_err().code,
        "source_projection_mismatch"
    );
    let mut changed = score.clone();
    changed.tempo[0].bpm += 1.0;
    assert_eq!(
        describe_canonical_midi(&changed).unwrap_err().code,
        "source_projection_mismatch"
    );
    let mut changed = score.clone();
    changed.repeats.push(crate::Repeat {
        from: Beat::ZERO,
        to: Beat::new(1, 1),
        times: 2,
    });
    assert!(describe_canonical_midi(&changed).is_err());
    let mut changed = score.clone();
    changed.parts[0].notes[0].id.push_str("-forged");
    assert_eq!(
        describe_canonical_midi(&changed).unwrap_err().code,
        "source_projection_mismatch"
    );
    let mut changed = score.clone();
    changed.source.as_mut().unwrap().format = "musicxml".into();
    assert_eq!(
        describe_canonical_midi(&changed).unwrap_err().code,
        "unsupported_source_profile"
    );
    changed.source = None;
    assert_eq!(
        describe_canonical_midi(&changed).unwrap_err().code,
        "unsupported_source_profile"
    );
}

#[test]
fn basic_revalidation_rejects_forged_projection_and_preserves_source_and_binding() {
    let score = basic(&[single_note()]);
    let before = basic_keys::encode_json(&score).unwrap();
    let a = describe_basic(&score).unwrap();
    let b = describe_basic(&basic_keys::decode_json(&before).unwrap()).unwrap();
    assert_eq!(
        serde_json::to_value(&a).unwrap(),
        serde_json::to_value(&b).unwrap()
    );
    assert_eq!(basic_keys::encode_json(&score).unwrap(), before);
    assert_eq!(
        a.source_binding.digest,
        format!("{:x}", Sha256::digest(&before))
    );
    let mut changed = score.clone();
    changed.performance.notes[0].key += 1;
    assert_eq!(
        describe_basic(&changed).unwrap_err().code,
        "invalid_basic_source"
    );
    let mut changed = score.clone();
    changed.performance.parts[0].channel = 5;
    assert_eq!(
        describe_basic(&changed).unwrap_err().code,
        "invalid_basic_source"
    );
    // A changed provenance claim is never treated as byte verification or a
    // reusable binding for the old complete package.
    let mut changed = score.clone();
    changed.source.sha256 = "a".repeat(64);
    changed.notation.id = format!("midi-basic-{}", changed.source.sha256);
    let changed = describe_basic(&changed).unwrap();
    assert_eq!(
        changed.original_bytes_verification,
        OriginalBytesVerification::DeclaredProvenanceOnly
    );
    assert_ne!(a.source_binding, changed.source_binding);
    assert_ne!(a.parts[0].id, changed.parts[0].id);
}

#[test]
fn disclosure_budget_is_explicit_unavailability_without_source_changes() {
    let score = basic(&[single_note()]);
    let before = basic_keys::encode_json(&score).unwrap();
    let d = describe_basic(&score).unwrap();
    assert_eq!(bounded(d, 1).unwrap_err().code, "source_disclosure_limit");
    assert_eq!(before, basic_keys::encode_json(&score).unwrap());
    assert!(basic_keys::compile_rendition(&score).is_ok());
    let mut canonical = canonical(&[single_note()]);
    canonical.source.as_mut().unwrap().content =
        "A".repeat(crate::midi_events::MAX_SOURCE_BYTES.div_ceil(3) * 4 + 4);
    assert_eq!(
        describe_canonical_midi(&canonical).unwrap_err().code,
        "source_disclosure_limit"
    );
}

#[test]
fn many_parts_share_one_timeline_without_copying_controller_declarations() {
    let mut tracks = vec![track(&[(0, &[0xc0, 23]), (0, &[0xb0, 0, 1])])];
    for index in 0..64 {
        tracks.push(track(&[(1, &[0x90, index, 80]), (1, &[0x80, index, 0])]));
    }
    let score = basic(&tracks);
    let d = describe_basic(&score).unwrap();
    assert_eq!(d.parts.len(), 65); // Includes the honestly empty controller part.
    assert_eq!(d.channels.len(), 1);
    assert_eq!(d.channels[0].selection_timeline.len(), 2);
    assert_eq!(
        d.parts.iter().map(|p| p.source_attack_count).sum::<usize>(),
        64
    );
    assert!(d.parts.iter().all(|p| p.channel_id == d.channels[0].id));
}

#[test]
fn later_program_resolves_prior_program_order_without_inventing_bank_values() {
    let score = canonical(&[
        track(&[(0, &[0xc0, 1]), (1, &[0xc0, 3])]),
        track(&[(0, &[0xc0, 2]), (2, &[0x90, 60, 80]), (1, &[0x80, 60, 0])]),
    ]);
    let d = describe_canonical_midi(&score).unwrap();
    let summary = &d.parts[0].selection_summary;
    assert_eq!(summary.status, SelectionStatus::Known);
    assert_eq!(summary.attacks_with_ambiguous_selection, 0);
    assert_eq!(
        summary.observed_selections,
        vec![NumericSelection {
            program: 3,
            bank_most_significant: None,
            bank_least_significant: None,
        }]
    );
    assert_eq!(d.channels[0].ambiguous_ticks, vec![0]);
}

#[test]
fn foreign_pending_bank_at_an_attack_does_not_change_the_latched_program() {
    let score = canonical(&[
        track(&[(0, &[0xc0, 7]), (1, &[0x90, 60, 80]), (1, &[0x80, 60, 0])]),
        track(&[(1, &[0xb0, 0, 4]), (0, &[0xb0, 32, 5])]),
    ]);
    let d = describe_canonical_midi(&score).unwrap();
    assert_eq!(d.parts[0].selection_summary.status, SelectionStatus::Known);
    assert_eq!(
        d.parts[0].selection_summary.observed_selections,
        vec![NumericSelection {
            program: 7,
            bank_most_significant: None,
            bank_least_significant: None,
        }]
    );
    assert!(d.channels[0].ambiguous_ticks.is_empty());
}

#[test]
fn each_tracks_proven_same_tick_prefix_is_preserved_for_its_own_attack() {
    let score = canonical(&[
        track(&[(0, &[0xc0, 7]), (0, &[0x90, 60, 80]), (1, &[0x80, 60, 0])]),
        track(&[(0, &[0x90, 64, 80]), (1, &[0x80, 64, 0])]),
    ]);
    let d = describe_canonical_midi(&score).unwrap();
    assert_eq!(d.parts[0].selection_summary.status, SelectionStatus::Known);
    assert_eq!(
        d.parts[0].selection_summary.observed_selections[0].program,
        7
    );
    assert_eq!(
        d.parts[1].selection_summary.status,
        SelectionStatus::Ambiguous
    );
    assert_eq!(
        d.parts[1]
            .selection_summary
            .attacks_with_ambiguous_selection,
        1
    );
}

#[test]
fn program_overwrite_does_not_clear_conflicting_pending_banks_but_bank_overwrite_does() {
    let score = canonical(&[
        track(&[
            (0, &[0xb0, 0, 1]),
            (1, &[0xc0, 3]),
            (1, &[0x90, 60, 80]),
            (1, &[0x80, 60, 0]),
            (0, &[0xb0, 0, 9]),
            (0, &[0xc0, 3]),
            (1, &[0x90, 64, 80]),
            (1, &[0x80, 64, 0]),
        ]),
        track(&[(0, &[0xb0, 0, 2])]),
    ]);
    let d = describe_canonical_midi(&score).unwrap();
    let summary = &d.parts[0].selection_summary;
    assert_eq!(summary.attacks_with_ambiguous_selection, 1);
    assert_eq!(
        summary.observed_selections,
        vec![NumericSelection {
            program: 3,
            bank_most_significant: Some(9),
            bank_least_significant: None,
        }]
    );
}

#[test]
fn same_track_system_event_does_not_retroactively_taint_a_proven_prior_attack() {
    for system in [
        &[0xf0, 2, 0x7d, 0xf7][..],
        &[0xf7, 1, 0x01][..],
        &[255, 0x7f, 1, 0x01][..],
    ] {
        let score = basic(&[track(&[
            (0, &[0xc0, 7]),
            (1, &[0x90, 60, 80]),
            (0, system),
            (1, &[0x80, 60, 0]),
            (1, &[0x90, 64, 80]),
            (1, &[0x80, 64, 0]),
        ])]);
        let d = describe_basic(&score).unwrap();
        let summary = &d.parts[0].selection_summary;
        assert_eq!(summary.attacks_with_ambiguous_selection, 1);
        assert_eq!(summary.observed_selections[0].program, 7);
        assert_eq!(d.uninterpreted_sound_events[0].origin.event, 2);
        assert_eq!(d.parts[0].first_attack.as_ref().unwrap().origin.event, 1);
    }
}

#[test]
fn same_tick_system_boundary_remains_uncertain_before_own_attack_or_on_other_tracks() {
    let score = basic(&[track(&[
        (0, &[0xc0, 7]),
        (1, &[0xf0, 2, 0x7d, 0xf7]),
        (0, &[0x90, 60, 80]),
        (1, &[0x80, 60, 0]),
    ])]);
    assert_eq!(
        describe_basic(&score).unwrap().parts[0]
            .selection_summary
            .status,
        SelectionStatus::Ambiguous
    );
    let score = basic(&[
        track(&[(0, &[0xc0, 7]), (1, &[0x90, 60, 80]), (1, &[0x80, 60, 0])]),
        track(&[(1, &[0xf0, 2, 0x7d, 0xf7])]),
    ]);
    assert_eq!(
        describe_basic(&score).unwrap().parts[0]
            .selection_summary
            .status,
        SelectionStatus::Ambiguous
    );
}

#[test]
fn invalid_raw_channel_prefix_has_explicit_unknown_scope_and_is_never_clamped() {
    let score = basic(&[track(&[
        (0, &[255, 0x20, 1, 31]),
        (0, &[255, 4, 1, b'X']),
        (0, &[0x90, 60, 80]),
        (0, &[255, 8, 1, b'Y']),
        (1, &[0x80, 60, 0]),
    ])]);
    let d = describe_basic(&score).unwrap();
    assert!(matches!(
        d.tracks[0].routing_events[0].declaration,
        RoutingDeclaration::InvalidChannelPrefix { byte: 31 }
    ));
    let names = &d.tracks[0].names;
    assert_eq!(
        names[0].channel_prefix_scope,
        ChannelPrefixScope::InvalidDeclaration
    );
    assert_eq!(names[0].channel_prefix, None);
    assert_eq!(
        names[0].channel_prefix_declaration,
        Some(Coordinate { track: 0, event: 0 })
    );
    assert_eq!(names[1].channel_prefix_scope, ChannelPrefixScope::Unscoped);
    assert_eq!(names[1].channel_prefix_declaration, None);
    assert_eq!(d.channels[0].channel, 0);
}
