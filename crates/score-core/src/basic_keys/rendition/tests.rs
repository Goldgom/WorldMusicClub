use super::*;

// Newly authored mechanical events, not a song or private-corpus excerpt.
fn track(events: &[(u8, &[u8])]) -> Vec<u8> {
    let mut result = vec![];
    for (delta, message) in events {
        result.push(*delta);
        result.extend(*message);
    }
    result.extend([0, 255, 47, 0]);
    result
}
fn source(tracks: &[Vec<u8>]) -> CompleteBasicKeys {
    source_with_ppq(tracks, 96)
}
fn source_with_ppq(tracks: &[Vec<u8>], ppq: u16) -> CompleteBasicKeys {
    let mut bytes = b"MThd\0\0\0\x06".to_vec();
    bytes.extend((if tracks.len() == 1 { 0_u16 } else { 1 }).to_be_bytes());
    bytes.extend((tracks.len() as u16).to_be_bytes());
    bytes.extend(ppq.to_be_bytes());
    for track in tracks {
        bytes.extend(b"MTrk");
        bytes.extend((track.len() as u32).to_be_bytes());
        bytes.extend(track);
    }
    convert_midi(&bytes, "Authored basic rendition event test").unwrap()
}

#[test]
fn lookahead_allocation_counts_rapid_nonoverlapping_voices_before_they_start() {
    let mut track = vec![];
    for _ in 0..129 {
        track.extend([1, 0x90, 60, 90, 1, 0x80, 60, 0]);
    }
    track.extend([0, 255, 47, 0]);
    let source = source_with_ppq(&[track], 2000);
    let view = compile_rendition(&source).unwrap();
    assert_eq!(view.rendition.coverage.maximum_simultaneous_voices, 1);
    assert_eq!(view.rendition.coverage.maximum_allocated_voices, 129);
    assert_eq!(view.rendition.policy.allocation_lookahead_ms, 100);
    assert_eq!(view.rendition.policy.voice_limit, 128);
    assert_eq!(view.rendition.policy.receiver_gate_tail_ms, 0);
    assert_eq!(view.rendition.coverage.synthetic_gates, 0);
}

#[test]
fn fractional_gate_end_precedes_an_equal_lookahead_allocation_exactly() {
    let source = source_with_ppq(
        &[track(&[
            (0, &[0x90, 60, 90]),
            (1, &[0x80, 60, 0]),
            (0, &[255, 81, 3, 1, 134, 160]),
            (3, &[0x90, 64, 90]),
            (1, &[0x80, 64, 0]),
        ])],
        3,
    );
    let view = compile_rendition(&source).unwrap();
    assert_eq!(view.rendition.notes[0].end.numerator, "500000");
    assert_eq!(view.rendition.notes[0].end.denominator, 3);
    assert_eq!(view.rendition.notes[1].start.numerator, "800000");
    assert_eq!(view.rendition.notes[1].start.denominator, 3);
    assert_eq!(view.rendition.coverage.maximum_simultaneous_voices, 1);
    assert_eq!(view.rendition.coverage.maximum_allocated_voices, 1);
}

#[test]
fn fifo_across_tracks_preserves_ambiguous_source_and_every_target() {
    let source = source(&[
        track(&[
            (0, &[0x90, 60, 90]),
            (2, &[0x90, 60, 91]),
            (4, &[0x80, 60, 0]),
        ]),
        track(&[(4, &[0x80, 60, 0]), (3, &[0x80, 60, 0])]),
    ]);
    let original = encode_json(&source).unwrap();
    assert_eq!(source.coverage.unresolved_ends, 2);
    let view = compile_rendition(&source).unwrap();
    let wire = serde_json::to_value(&view.rendition).unwrap();
    assert_eq!(
        wire["note_columns"],
        serde_json::to_value(RENDITION_NOTE_COLUMNS).unwrap()
    );
    assert_eq!(
        wire["notes"][0].as_array().unwrap().len(),
        RENDITION_NOTE_COLUMNS.len()
    );
    assert_eq!(wire["notes"][0][0], view.timeline.notes[0].id);
    assert_eq!(wire["notes"][0][1], serde_json::json!([0, 0]));
    assert_eq!(view.timeline.notes.len(), 2);
    assert_eq!(
        view.rendition.notes[0].release,
        Some(Coordinate { track: 1, event: 0 })
    );
    assert_eq!(
        view.rendition.notes[1].release,
        Some(Coordinate { track: 0, event: 2 })
    );
    assert_eq!(view.rendition.notes[0].source_end_tick, None);
    assert_eq!(view.rendition.notes[0].receiver_end_tick, 4);
    assert_eq!(view.rendition.coverage.unmatched_releases, 1);
    assert_eq!(view.rendition.coverage.maximum_simultaneous_voices, 2);
    assert_eq!(encode_json(&source).unwrap(), original);
    for (target, evidence) in view.timeline.notes.iter().zip(&view.rendition.notes) {
        assert_eq!(target.id, evidence.note_id);
        assert_eq!(target.source_note_ids, vec![evidence.note_id.clone()]);
        assert!(source_event_id(&source.source.sha256, evidence.attack).starts_with("midi:"));
    }
}

#[test]
fn explicit_virtual_routes_are_distinct_but_default_is_shared() {
    let source = source(&[
        track(&[(0, &[0x90, 60, 90]), (5, &[0x80, 60, 0])]),
        track(&[
            (0, &[255, 33, 1, 0]),
            (1, &[0x90, 60, 90]),
            (6, &[0x80, 60, 0]),
        ]),
    ]);
    assert_eq!(source.coverage.unresolved_route_ends, 2);
    let view = compile_rendition(&source).unwrap();
    assert_ne!(view.rendition.notes[0].route, view.rendition.notes[1].route);
    assert_eq!(view.rendition.notes[0].receiver_end_tick, 5);
    assert_eq!(view.rendition.notes[1].receiver_end_tick, 7);
    assert!(view
        .rendition
        .notes
        .iter()
        .all(|n| n.source_end_tick.is_none()));
}

#[test]
fn zero_and_eof_gates_are_explicit_while_positive_gates_are_not_stretched() {
    let source = source(&[track(&[
        (0, &[0x90, 60, 90]),
        (0, &[0x80, 60, 0]),
        (0, &[0x90, 61, 90]),
        (1, &[0x80, 61, 0]),
        (0, &[0x90, 62, 90]),
    ])]);
    let view = compile_rendition(&source).unwrap();
    assert_eq!(view.timeline.notes[0].duration_ms, 20.0);
    assert!(view.timeline.notes[1].duration_ms < 20.0);
    assert_eq!(view.timeline.notes[2].duration_ms, 20.0);
    assert_eq!(view.rendition.notes[0].source_end_tick, Some(0));
    assert_eq!(view.rendition.notes[2].source_end_tick, None);
    assert_eq!(view.rendition.coverage.synthetic_gates, 2);
    assert_eq!(view.rendition.coverage.source_end_cleanups, 1);
    assert_eq!(
        view.rendition.notes[2].end_reason,
        RenditionEndReason::SourceEndCleanup
    );
    assert_eq!(
        view.timeline.duration_ms,
        view.rendition.source_duration_ms + 20.0
    );
    assert_eq!(
        view.rendition.notes[2].receiver_end_tick,
        source.performance.end_tick
    );
}

#[test]
fn channel_stop_controls_end_only_their_bus_channel_without_losing_releases() {
    let source = source(&[track(&[
        (0, &[0x90, 60, 90]),
        (0, &[0x90, 60, 91]),
        (0, &[0x91, 62, 90]),
        (1, &[0xb0, 64, 127]),
        (1, &[0xb0, 123, 0]),
        (1, &[0x80, 60, 0]),
        (1, &[0x81, 62, 0]),
        (0, &[0x90, 64, 90]),
        (1, &[0xb0, 120, 0]),
        (2, &[0xb0, 7, 0]),
        (2, &[0xb0, 11, 0]),
    ])]);
    let view = compile_rendition(&source).unwrap();
    assert_eq!(
        view.rendition.notes[0].end_reason,
        RenditionEndReason::AllNotesOff
    );
    assert_eq!(
        view.rendition.notes[1].end_reason,
        RenditionEndReason::AllNotesOff
    );
    assert_eq!(
        view.rendition.notes[2].end_reason,
        RenditionEndReason::FifoRelease
    );
    assert_eq!(
        view.rendition.notes[3].end_reason,
        RenditionEndReason::AllSoundOff
    );
    assert_eq!(view.rendition.coverage.control_ended_voices, 3);
    assert_eq!(view.rendition.coverage.source_end_cleanups, 0);
    assert_eq!(view.rendition.coverage.unmatched_releases, 1);
    assert_eq!(view.rendition.coverage.uninterpreted_controller_events, 3);
    assert_eq!(view.rendition.coverage.source_silence_controller_events, 4);
}

#[test]
fn chosen_tempo_clock_is_exact_and_does_not_relabel_conflicting_source_clock() {
    let source = source(&[
        track(&[
            (0, &[255, 81, 3, 7, 161, 32]),
            (0, &[0x90, 60, 90]),
            (48, &[255, 81, 3, 0, 0, 0]),
            (48, &[0x80, 60, 0]),
        ]),
        track(&[(0, &[255, 81, 3, 6, 26, 128])]),
    ]);
    assert!(!source.performance.timing.relative_clock_available);
    let view = compile_rendition(&source).unwrap();
    assert!(!view.rendition.source_clock_available);
    assert_eq!(view.timeline.notes[0].duration_ms, 400.0);
    assert_eq!(view.rendition.notes[0].end.numerator, "400000");
    assert_eq!(view.rendition.notes[0].end.denominator, 1);
    assert_eq!(view.rendition.coverage.zero_tempo_events, 1);
    assert!(source.performance.notes[0]
        .start
        .relative_microseconds
        .is_none());
}

#[test]
fn all_128_selectors_and_melodic_keys_survive_without_range_clamps() {
    let mut track = vec![];
    for channel in [0, 9] {
        for key in 0..=127 {
            track.extend([0, 0x90 | channel, key, 90]);
        }
    }
    track.extend([1, 0xb0, 123, 0, 0, 0xb9, 123, 0, 0, 255, 47, 0]);
    let source = source(&[track]);
    let view = compile_rendition(&source).unwrap();
    assert_eq!(view.timeline.notes.len(), 256);
    assert_eq!(view.rendition.coverage.maximum_simultaneous_voices, 256);
    assert_eq!(view.rendition.coverage.melodic_targets, 128);
    assert_eq!(view.rendition.coverage.percussion_selectors, 128);
    assert_eq!(view.timeline.notes[0].midi, 0);
    assert_eq!(view.timeline.notes[127].midi, 127);
    assert_eq!(
        view.rendition.notes[128].role,
        RenditionRole::PercussionSelector
    );
    let profile = crate::instruments::InstrumentProfile::Piano {
        key_count: 128,
        lowest_midi: Some(0),
    };
    let plan = crate::targets::plan_targets(&view.timeline, &profile).unwrap();
    assert_eq!(plan.source_note_count, 256);
    assert_eq!(plan.target_count, 128);
    assert!(plan.groups.iter().all(|g| g.source_note_ids.len() == 2));
    let restricted = crate::targets::plan_targets(
        &view.timeline,
        &crate::instruments::InstrumentProfile::Piano {
            key_count: 88,
            lowest_midi: None,
        },
    )
    .unwrap();
    assert!(!restricted.playable);
    assert_eq!(restricted.source_note_count, 256);
}

#[test]
fn control_disposition_and_every_non_note_event_reconcile() {
    let source = source(&[track(&[
        (0, &[0xb0, 0, 1]),
        (0, &[0xc0, 99]),
        (0, &[0xe0, 0, 64]),
        (0, &[0xa0, 60, 50]),
        (0, &[0xd0, 50]),
        (0, &[0xf0, 3, 0x7d, 1, 0xf7]),
        (0, &[0xf7, 2, 1, 2]),
        (0, &[255, 88, 4, 4, 2, 24, 8]),
        (0, &[0x90, 60, 90]),
        (1, &[0x90, 60, 0]),
    ])]);
    let view = compile_rendition(&source).unwrap();
    let coverage = view.rendition.coverage;
    assert_eq!(coverage.source_events, 11);
    assert_eq!(coverage.source_attacks, coverage.derived_voices);
    assert_eq!(coverage.derived_voices, coverage.practice_targets);
    assert_eq!(coverage.uninterpreted_controller_events, 1);
    assert_eq!(coverage.uninterpreted_program_events, 1);
    assert_eq!(coverage.uninterpreted_pressure_events, 2);
    assert_eq!(coverage.uninterpreted_pitch_bend_events, 1);
    assert_eq!(coverage.uninterpreted_sysex_events, 2);
    assert_eq!(coverage.metadata_events, 2);
}
