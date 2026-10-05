use super::*;

// Original mechanical fixtures; no source melodies or private source data.
fn vlq(mut value: u32) -> Vec<u8> {
    let mut bytes = vec![(value & 127) as u8];
    value >>= 7;
    while value > 0 {
        bytes.push((value as u8 & 127) | 128);
        value >>= 7;
    }
    bytes.reverse();
    bytes
}
fn smf(ppq: u16, tracks: &[Vec<(u32, Vec<u8>)>]) -> Vec<u8> {
    let mut bytes = b"MThd\0\0\0\x06".to_vec();
    bytes.extend((if tracks.len() == 1 { 0u16 } else { 1 }).to_be_bytes());
    bytes.extend((tracks.len() as u16).to_be_bytes());
    bytes.extend(ppq.to_be_bytes());
    for events in tracks {
        let mut body = vec![];
        let mut tick = 0;
        for (at, data) in events {
            body.extend(vlq(at - tick));
            body.extend(data);
            tick = *at;
        }
        body.extend([0, 255, 47, 0]);
        bytes.extend(b"MTrk");
        bytes.extend((body.len() as u32).to_be_bytes());
        bytes.extend(body);
    }
    bytes
}
fn request(score: &CompleteBasicKeys, first_measure: u32, measure_count: u16) -> NotationRequest {
    NotationRequest {
        part_id: score.performance.parts[0].id.clone(),
        rendition_policy_id: None,
        first_measure,
        measure_count,
        display_meter: None,
        position_ms: None,
    }
}
fn meter(n: u8, d: u8) -> Vec<u8> {
    vec![255, 88, 4, n, d, 24, 8]
}
fn tempo(us: u32) -> Vec<u8> {
    let b = us.to_be_bytes();
    vec![255, 81, 3, b[1], b[2], b[3]]
}
fn known_meter() -> CompleteBasicKeys {
    convert_midi(
        &smf(
            96,
            &[
                vec![
                    (0, meter(4, 2)),
                    (0, tempo(500001)),
                    (0, vec![255, 89, 2, 253, 0]),
                    (288, meter(3, 3)),
                    (384, tempo(600001)),
                    (384, vec![255, 89, 2, 2, 1]),
                    (576, vec![255, 1, 0]),
                ],
                vec![(0, vec![0x90, 60, 90]), (576, vec![0x80, 60, 0])],
            ],
        ),
        "Original exact display fixture",
    )
    .unwrap()
}

#[test]
fn immutable_source_pages_match_checked_pages_without_exposing_mutable_proofs() {
    let source = known_meter();
    let bytes = encode_json(&source).unwrap();
    let validated = ValidatedSource::decode_json(&bytes).unwrap();
    for policy in [None, Some(RENDITION_POLICY.to_owned())] {
        for first in 0..4 {
            let mut settings = request(&source, first, 1);
            settings.rendition_policy_id = policy.clone();
            let expected = serde_json::to_vec(&notation_page(&source, &settings).unwrap()).unwrap();
            for _ in 0..2 {
                assert_eq!(
                    serde_json::to_vec(&validated.notation_page(&settings).unwrap()).unwrap(),
                    expected
                );
            }
        }
    }
    let mut invalid = source.clone();
    invalid.coverage.key_attacks += 1;
    assert!(notation_page(&invalid, &request(&source, 0, 1)).is_err());
    assert!(compile_rendition(&invalid).is_err());
    let mut forged: serde_json::Value = serde_json::from_slice(&bytes).unwrap();
    forged["coverage"]["key_attacks"] = 999.into();
    assert!(ValidatedSource::decode_json(&serde_json::to_vec(&forged).unwrap()).is_err());
    let mut settings = request(&source, 0, 1);
    settings.rendition_policy_id = Some("unrecognized-policy".into());
    assert_eq!(
        validated.notation_page(&settings).unwrap_err(),
        notation_page(&source, &settings).unwrap_err()
    );
    settings.rendition_policy_id = Some(RENDITION_POLICY.into());
    for invalid_position in [-1., f64::INFINITY, f64::NAN] {
        settings.position_ms = Some(invalid_position);
        assert_eq!(
            validated.notation_page(&settings).unwrap_err(),
            notation_page(&source, &settings).unwrap_err()
        );
    }
}

#[test]
fn source_meter_changes_midmeasure_build_exact_page_and_source_keys() {
    let source = known_meter();
    let before = encode_json(&source).unwrap();
    let page = notation_page(&source, &request(&source, 0, 3)).unwrap();
    assert_eq!(page.status, "ready");
    assert_eq!(page.total_measures, 3);
    assert_eq!(page.measure_count, 3);
    assert_eq!(page.meter_origin, "source");
    assert_eq!(page.tempo_origin, "source");
    assert_eq!(page.key_origin, "source");
    let view = page.score.as_ref().unwrap();
    assert!(view.measures[0].length.equivalent(Beat::new(3, 1)));
    assert!(view.measures[1].length.equivalent(Beat::new(3, 2)));
    assert!(view.measures[2].length.equivalent(Beat::new(3, 2)));
    assert_eq!(view.keys[0].fifths, -3);
    assert_eq!(view.keys[1].mode, "minor");
    assert_eq!(view.tempo[0].bpm, 60_000_000. / 500001.);
    assert_eq!(view.tempo[1].bpm, 60_000_000. / 600001.);
    let segments = &page
        .musicxml
        .as_ref()
        .unwrap()
        .note_id_map
        .as_ref()
        .unwrap()
        .segments;
    assert_eq!(segments.len(), 3);
    assert!(segments[0].tie_start);
    assert!(!segments[0].tie_stop);
    assert!(segments[1].tie_start && segments[1].tie_stop);
    assert!(segments[2].tie_stop);
    assert!(!segments[2].tie_start);
    assert_eq!(before, encode_json(&source).unwrap());
    assert!(source.notation.measures.is_empty());
    assert!(source.notation.keys.is_empty());
}

#[test]
fn long_note_page_edges_keep_ids_exact_spans_and_both_boundary_ties() {
    let source = known_meter();
    let page = notation_page(&source, &request(&source, 1, 1)).unwrap();
    assert_eq!(page.status, "ready");
    assert_eq!(page.next_measure, Some(2));
    assert!(page.source_start.unwrap().equivalent(Beat::new(3, 1)));
    assert!(page.source_end.unwrap().equivalent(Beat::new(9, 2)));
    let view = page.score.as_ref().unwrap();
    assert_eq!(view.parts.len(), 1);
    let note = &view.parts[0].notes[0];
    assert_eq!(note.id, source.performance.notes[0].note_id);
    assert!(note.at.equivalent(Beat::ZERO));
    assert!(note.duration.equivalent(Beat::new(3, 2)));
    assert_eq!(view.measures[0].number, 2);
    assert!(view.tempo[1].at.equivalent(Beat::new(1, 1)));
    assert_eq!(page.continuations.len(), 1);
    assert!(page.continuations[0].enters_page && page.continuations[0].leaves_page);
    assert!(page.continuations[0].source_end.equivalent(Beat::new(6, 1)));
    let segments = &page
        .musicxml
        .as_ref()
        .unwrap()
        .note_id_map
        .as_ref()
        .unwrap()
        .segments;
    assert_eq!(segments.len(), 1);
    assert!(segments[0].tie_start && segments[0].tie_stop);
    assert_eq!(segments[0].source_note_id, note.id);
}

#[test]
fn missing_meter_needs_choice_and_missing_key_is_never_invented() {
    let source = convert_midi(
        &smf(
            96,
            &[vec![(0, vec![0x90, 60, 90]), (96, vec![0x80, 60, 0])]],
        ),
        "Original unspecified fixture",
    )
    .unwrap();
    let mut settings = request(&source, 0, 1);
    let blocked = notation_page(&source, &settings).unwrap();
    assert_eq!(blocked.status, "display_meter_required");
    assert!(blocked.musicxml.is_none());
    settings.display_meter = Some(DisplayMeter {
        numerator: 3,
        denominator: 4,
    });
    let page = notation_page(&source, &settings).unwrap();
    assert_eq!(page.status, "ready");
    assert_eq!(page.meter_origin, "chosen_display_meter");
    assert_eq!(page.tempo_origin, "smf_default_presentation");
    assert_eq!(page.key_origin, "unspecified");
    let view = page.score.as_ref().unwrap();
    assert_eq!(view.meters[0].numerator, 3);
    assert!(view.keys.is_empty());
    assert_eq!(view.tempo[0].bpm, 120.);
    assert!(!page.musicxml.as_ref().unwrap().xml.contains("<key>"));
    assert!(source.notation.meters.is_empty());
    assert!(source.notation.tempo.is_empty());
}

#[test]
fn ambiguous_source_metadata_stays_explicit_and_zero_unresolved_remain_visible() {
    let source = convert_midi(
        &smf(
            96,
            &[
                vec![
                    (0, meter(4, 2)),
                    (0, tempo(500000)),
                    (0, vec![255, 89, 2, 1, 0]),
                    (96, vec![255, 1, 0]),
                ],
                vec![
                    (0, meter(3, 2)),
                    (0, tempo(600000)),
                    (0, vec![255, 89, 2, 2, 0]),
                    (0, vec![0x90, 60, 90]),
                    (0, vec![0x80, 60, 0]),
                    (1, vec![0x90, 61, 90]),
                ],
            ],
        ),
        "Original ambiguous fixture",
    )
    .unwrap();
    let mut settings = request(&source, 0, 1);
    assert_eq!(
        notation_page(&source, &settings).unwrap().status,
        "display_meter_required"
    );
    settings.display_meter = Some(DisplayMeter {
        numerator: 4,
        denominator: 4,
    });
    let page = notation_page(&source, &settings).unwrap();
    assert_eq!(page.status, "ready");
    assert_eq!(page.tempo_origin, "unavailable");
    assert_eq!(page.key_origin, "ambiguous_or_invalid");
    assert!(page.score.as_ref().unwrap().tempo.is_empty());
    assert!(page.score.as_ref().unwrap().keys.is_empty());
    assert_eq!(page.unresolved.len(), 1);
    assert_eq!(page.instantaneous.len(), 1);
    assert_eq!(page.coverage.rendered_positive_keys, 0);
    assert_eq!(page.coverage.part_attacks, 2);
    assert!(!page
        .musicxml
        .as_ref()
        .unwrap()
        .xml
        .contains("<sound tempo="));
}

#[test]
fn exact_out_of_playback_range_tempo_is_not_clamped_for_engraving() {
    let source = convert_midi(
        &smf(
            7,
            &[vec![
                (0, meter(3, 3)),
                (0, tempo(1)),
                (1, vec![0x90, 60, 90]),
                (2, vec![0x80, 60, 0]),
                (21, vec![255, 1, 0]),
            ]],
        ),
        "Original fast clock fixture",
    )
    .unwrap();
    let page = notation_page(&source, &request(&source, 0, 2)).unwrap();
    assert_eq!(page.status, "ready");
    let view = page.score.as_ref().unwrap();
    assert_eq!(view.tempo[0].bpm, 60_000_000.);
    assert!(view.parts[0].notes[0].at.equivalent(Beat::new(1, 7)));
    assert!(view.parts[0].notes[0].duration.equivalent(Beat::new(1, 7)));
}

#[test]
fn large_source_and_distant_pages_are_bounded_without_prefix_measure_allocation() {
    let mut events = vec![(0, meter(4, 2))];
    for i in 0..41_900 {
        events.push((i * 2, vec![0x90, 60, 90]));
        events.push((i * 2 + 1, vec![0x80, 60, 0]));
    }
    let source = convert_midi(&smf(96, &[events]), "Original large display fixture").unwrap();
    let page = notation_page(&source, &request(&source, 100, 1)).unwrap();
    assert_eq!(page.status, "ready");
    assert!(page.score.as_ref().unwrap().parts[0].notes.len() <= 192);
    assert!(serde_json::to_vec(&page).unwrap().len() < 256 * 1024);
    assert_eq!(page.coverage.source_attacks, 41_900);
    assert_eq!(source.coverage.key_attacks, 41_900);
    let mut sparse = vec![
        (0, meter(1, 15)),
        (0, vec![0x90, 60, 90]),
        (1, vec![0x80, 60, 0]),
    ];
    for tick in [
        200_000_000,
        400_000_000,
        600_000_000,
        800_000_000,
        1_000_000_000,
    ] {
        sparse.push((tick, vec![255, 1, 0]));
    }
    let distant = convert_midi(&smf(1, &[sparse]), "Original sparse distant fixture").unwrap();
    let page = notation_page(&distant, &request(&distant, 800_000_000, 1)).unwrap();
    assert_eq!(page.total_measures, 8_192_000_000_000);
    assert_eq!(page.measure_count, 1);
    assert_eq!(page.status, "ready");
    assert_eq!(page.score.as_ref().unwrap().measures[0].number, 800_000_001);
}

#[test]
fn dense_page_limit_is_explicit_and_recoverable_not_a_trimmed_score() {
    let mut events = vec![(0, meter(4, 2))];
    for i in 0..2050 {
        events.push((i * 2, vec![0x90, 60, 90]));
        events.push((i * 2 + 1, vec![0x80, 60, 0]));
    }
    let source = convert_midi(&smf(32767, &[events]), "Original dense display fixture").unwrap();
    let page = notation_page(&source, &request(&source, 0, 1)).unwrap();
    assert_eq!(page.status, "page_limit");
    assert!(page.score.is_none());
    assert!(page.musicxml.is_none());
    assert_eq!(page.coverage.window_attacks, 2050);
    assert_eq!(source.coverage.key_attacks, 2050);
}

#[test]
fn following_uses_source_clock_at_exact_changed_meter_and_tempo_boundaries() {
    let source = known_meter();
    let mut settings = request(&source, 0, 1);
    for (ms, index, start, end) in [
        (0., 0, 0., 1500.003),
        (1500.003, 1, 1500.003, 2300.0045),
        (2300.0045, 2, 2300.0045, 3200.006),
        (9000., 2, 2300.0045, 3200.006),
    ] {
        settings.position_ms = Some(ms);
        let page = notation_page(&source, &settings).unwrap();
        assert_eq!(page.status, "ready");
        assert_eq!(page.first_measure, index);
        assert_eq!(page.measures.len(), 1);
        assert_eq!(page.measures[0].source_measure_index, index);
        assert!((page.source_start_ms.unwrap() - start).abs() < 1e-9);
        assert!((page.source_end_ms.unwrap() - end).abs() < 1e-9);
        assert_eq!(page.measures[0].start_ms, page.source_start_ms);
        assert_eq!(page.measures[0].end_ms, page.source_end_ms);
    }
    settings.position_ms = Some(f64::NAN);
    assert!(notation_page(&source, &settings).is_err());
    settings.position_ms = Some(-1.);
    assert!(notation_page(&source, &settings).is_err());
}

#[test]
fn terminal_unresolved_and_instantaneous_attacks_are_listed_on_last_page() {
    let source = convert_midi(
        &smf(
            96,
            &[vec![
                (0, meter(4, 2)),
                (0, vec![0x90, 60, 90]),
                (96, vec![0x80, 60, 0]),
                (96, vec![0x90, 61, 90]),
                (96, vec![0x80, 61, 0]),
                (96, vec![0x90, 62, 90]),
            ]],
        ),
        "Original terminal attacks",
    )
    .unwrap();
    let page = notation_page(&source, &request(&source, 0, 1)).unwrap();
    assert_eq!(page.status, "ready");
    assert_eq!(page.coverage.window_attacks, 3);
    assert_eq!(page.coverage.rendered_positive_keys, 1);
    assert_eq!(page.unresolved.len(), 1);
    assert_eq!(page.instantaneous.len(), 1);
    assert!(page.unresolved[0]
        .source_at
        .equivalent(page.source_end.unwrap()));
    assert!(page.instantaneous[0]
        .source_at
        .equivalent(page.source_end.unwrap()));
}

#[test]
fn leading_silence_late_tempo_and_part_selection_keep_source_positions() {
    let source = convert_midi(
        &smf(
            96,
            &[
                vec![
                    (0, meter(4, 2)),
                    (480, tempo(600000)),
                    (1056, vec![255, 1, 0]),
                ],
                vec![(960, vec![0x90, 60, 90]), (1056, vec![0x80, 60, 0])],
                vec![(960, vec![0x91, 64, 90]), (1056, vec![0x81, 64, 0])],
            ],
        ),
        "Original leading silence and part choice",
    )
    .unwrap();
    let mut settings = request(&source, 0, 1);
    settings.part_id = source.performance.parts[1].id.clone();
    settings.position_ms = Some(2000.);
    let silent = notation_page(&source, &settings).unwrap();
    assert_eq!(silent.status, "ready");
    assert_eq!(silent.first_measure, 1);
    assert_eq!(silent.source_start_ms, Some(2000.));
    assert_eq!(silent.source_end_ms, Some(4300.));
    assert_eq!(silent.tempo_origin, "smf_default_presentation");
    assert_eq!(silent.score.as_ref().unwrap().tempo.len(), 2);
    assert!(silent.score.as_ref().unwrap().parts[0].notes.is_empty());
    settings.position_ms = Some(5500.);
    let sounding = notation_page(&source, &settings).unwrap();
    assert_eq!(sounding.first_measure, 2);
    assert_eq!(sounding.source_start_ms, Some(4300.));
    assert_eq!(sounding.source_end_ms, Some(6100.));
    assert_eq!(sounding.source_duration_ms, Some(6100.));
    assert_eq!(sounding.tempo_origin, "source");
    let part = &sounding.score.as_ref().unwrap().parts[0];
    assert_eq!(part.id, settings.part_id);
    assert_eq!(part.notes.len(), 1);
    assert_eq!(part.notes[0].pitch.as_ref().unwrap().midi(), Some(64));
    assert!(part.notes[0].at.equivalent(Beat::new(2, 1)));
    assert_eq!(sounding.coverage.source_attacks, 2);
    assert_eq!(sounding.coverage.part_attacks, 1);
}

fn rendition_request(source: &CompleteBasicKeys, first: u32, count: u16) -> NotationRequest {
    let mut settings = request(source, first, count);
    settings.rendition_policy_id = Some(super::rendition::RENDITION_POLICY.into());
    settings
}

#[test]
fn rendition_page_keeps_fifo_cleanup_channel_stop_and_synthetic_targets_source_bound() {
    let source = convert_midi(
        &smf(
            96,
            &[vec![
                (0, meter(4, 2)),
                (0, vec![0x90, 60, 90]),
                (24, vec![0x90, 60, 70]),
                (96, vec![0x80, 60, 0]),
                (144, vec![0x80, 60, 0]),
                (144, vec![0x90, 62, 80]),
                (160, vec![0xb0, 123, 0]),
                (160, vec![0x90, 64, 80]),
                (192, vec![0x90, 65, 80]),
                (192, vec![0x80, 65, 0]),
            ]],
        ),
        "Original rendition coverage fixture",
    )
    .unwrap();
    let before = encode_json(&source).unwrap();
    let settings = rendition_request(&source, 0, 1);
    let page = notation_page(&source, &settings).unwrap();
    let compiled = super::rendition::compile_rendition(&source).unwrap();
    assert_eq!(page.view_version, 2);
    assert_eq!(page.status, "ready");
    assert_eq!(page.rendition_policy_id, settings.rendition_policy_id);
    assert_eq!(page.source_sha256, source.source.sha256);
    assert_eq!(page.interpreted_notes.len(), compiled.timeline.notes.len());
    assert_eq!(page.score.as_ref().unwrap().parts[0].notes.len(), 4);
    assert_eq!(page.onsets.len(), 1);
    assert!(page.unresolved.is_empty() && page.instantaneous.is_empty());
    for ((shown, evidence), timed) in page
        .interpreted_notes
        .iter()
        .zip(&compiled.rendition.notes)
        .zip(&compiled.timeline.notes)
    {
        assert_eq!(shown.note_id, timed.id);
        assert_eq!(shown.start_ms, timed.start_ms);
        assert_eq!(shown.end_ms, timed.start_ms + timed.duration_ms);
        assert_eq!(shown.start_exact, evidence.start);
        assert_eq!(shown.end_exact, evidence.end);
        assert_eq!(shown.source_end_tick, evidence.source_end_tick);
        assert_eq!(shown.receiver_end_tick, evidence.receiver_end_tick);
        assert_eq!(shown.source_release_status, evidence.source_release_status);
    }
    assert_eq!(
        page.interpreted_notes[2].end_reason,
        super::rendition::RenditionEndReason::AllNotesOff
    );
    assert_eq!(
        page.interpreted_notes[3].end_reason,
        super::rendition::RenditionEndReason::SourceEndCleanup
    );
    assert_eq!(page.interpreted_notes[4].display_kind, "synthetic_onset");
    assert_eq!(page.source_duration_ms, Some(1000.));
    assert_eq!(page.rendition_duration_ms, Some(1020.));
    assert_eq!(page.follow_end_ms, Some(1020.));
    assert_eq!(page.measures[0].end_ms, Some(1000.));
    assert_eq!(page.measures[0].follow_end_ms, Some(1020.));
    assert_eq!(before, encode_json(&source).unwrap());
    let legacy = notation_page(&source, &request(&source, 0, 1)).unwrap();
    assert_eq!(legacy.view_version, 1);
    assert!(legacy.interpreted_notes.is_empty());
    assert!(serde_json::to_value(legacy)
        .unwrap()
        .get("rendition_policy_id")
        .is_none());
}

#[test]
fn rendition_follow_uses_last_positive_tempo_and_holds_zero_without_source_clock_claim() {
    let source = convert_midi(
        &smf(
            96,
            &[
                vec![
                    (0, meter(1, 2)),
                    (0, tempo(500000)),
                    (96, tempo(1000000)),
                    (288, vec![255, 1, 0]),
                ],
                vec![
                    (0, tempo(600000)),
                    (0, vec![0x90, 60, 90]),
                    (96, tempo(0)),
                    (288, vec![0x80, 60, 0]),
                ],
            ],
        ),
        "Original chosen clock fixture",
    )
    .unwrap();
    assert!(!source.performance.timing.relative_clock_available);
    let mut settings = rendition_request(&source, 0, 1);
    for (ms, index, from, to) in [
        (0., 0, 0., 600.),
        (600., 1, 600., 1600.),
        (1600., 2, 1600., 2600.),
    ] {
        settings.position_ms = Some(ms);
        let page = notation_page(&source, &settings).unwrap();
        assert_eq!(page.status, "ready");
        assert_eq!(page.first_measure, index);
        assert_eq!(page.source_clock_available, Some(false));
        assert_eq!(page.tempo_origin, "chosen_rendition_clock");
        assert_eq!(page.source_start_ms, Some(from));
        assert_eq!(page.source_end_ms, Some(to));
        assert_eq!(page.interpreted_notes.len(), 1);
        assert_eq!(page.interpreted_notes[0].start_exact.numerator, "0");
        assert_eq!(page.interpreted_notes[0].end_exact.numerator, "2600000");
        assert_eq!(
            page.score.as_ref().unwrap().parts[0].notes[0].id,
            source.performance.notes[0].note_id
        );
    }
}

#[test]
fn rendition_zero_span_and_fractional_zero_gates_have_onsets_without_fabricated_duration() {
    // 20ms / 16,777,213us requires a denominator above the canonical limit.
    let source = convert_midi(
        &smf(
            7,
            &[vec![
                (0, tempo(16_777_213)),
                (0, vec![0x90, 60, 90]),
                (0, vec![0x80, 60, 0]),
            ]],
        ),
        "Original zero-span fixture",
    )
    .unwrap();
    let mut settings = rendition_request(&source, 0, 1);
    assert_eq!(
        notation_page(&source, &settings).unwrap().status,
        "display_meter_required"
    );
    settings.display_meter = Some(DisplayMeter {
        numerator: 4,
        denominator: 4,
    });
    settings.position_ms = Some(15.);
    let page = notation_page(&source, &settings).unwrap();
    assert_eq!(page.status, "onset_page");
    assert!(page.score.is_none() && page.musicxml.is_none());
    assert_eq!(page.onsets.len(), 1);
    assert_eq!(page.interpreted_notes.len(), 1);
    assert_eq!(
        page.interpreted_notes[0].note_id,
        source.performance.notes[0].note_id
    );
    assert_eq!(page.interpreted_notes[0].receiver_end_tick, 0);
    assert_eq!(page.interpreted_notes[0].end_exact.numerator, "20000");
    assert_eq!(page.source_end_ms, Some(0.));
    assert_eq!(page.follow_end_ms, Some(20.));
    assert_eq!(page.resolved_position_ms, Some(15.));
    assert_eq!(page.measures.len(), 1);
}

#[test]
fn rendition_synthetic_gate_continues_across_fast_bars_with_stable_onset_id() {
    let source = convert_midi(
        &smf(
            96,
            &[vec![
                (0, meter(1, 2)),
                (0, tempo(1000)),
                (0, vec![0x90, 60, 90]),
                (0, vec![0x80, 60, 0]),
                (384, vec![255, 1, 0]),
            ]],
        ),
        "Original synthetic continuation fixture",
    )
    .unwrap();
    let mut settings = rendition_request(&source, 0, 1);
    settings.position_ms = Some(2.5);
    let page = notation_page(&source, &settings).unwrap();
    assert_eq!(page.first_measure, 2);
    assert_eq!(page.coverage.window_attacks, 0);
    assert_eq!(page.onsets.len(), 1);
    assert_eq!(page.interpreted_notes[0].start_ms, 0.);
    assert_eq!(page.interpreted_notes[0].end_ms, 20.);
    settings.position_ms = Some(19.);
    let tail = notation_page(&source, &settings).unwrap();
    assert_eq!(tail.first_measure, 3);
    assert_eq!(tail.source_end_ms, Some(4.));
    assert_eq!(tail.follow_end_ms, Some(20.));
    assert_eq!(tail.onsets[0].note_id, page.onsets[0].note_id);
}

#[test]
fn rendition_percussion_pages_are_selector_targets_without_pitched_staff() {
    let source = convert_midi(
        &smf(
            96,
            &[vec![
                (0, meter(4, 2)),
                (0, vec![0x99, 0, 90]),
                (96, vec![0x89, 0, 0]),
                (96, vec![0x99, 127, 90]),
            ]],
        ),
        "Original percussion selector fixture",
    )
    .unwrap();
    let page = notation_page(&source, &rendition_request(&source, 0, 1)).unwrap();
    assert_eq!(page.status, "percussion_selectors");
    assert!(page.score.is_none() && page.musicxml.is_none());
    assert_eq!(
        page.selectors
            .iter()
            .map(|item| item.key)
            .collect::<Vec<_>>(),
        vec![0, 127]
    );
    assert!(page.interpreted_notes.iter().all(|note| note.role
        == super::rendition::RenditionRole::PercussionSelector
        && note.display_kind == "percussion_selector"));
    assert!(page.onsets.is_empty());
    assert_eq!(page.coverage.rendered_positive_keys, 0);
}

#[test]
fn rendition_notation_rejects_unknown_policy_and_never_trims_dense_targets() {
    let mut events = vec![(0, meter(4, 2))];
    for _ in 0..2049 {
        events.push((0, vec![0x90, 60, 90]));
    }
    let source = convert_midi(&smf(96, &[events]), "Original dense onset fixture").unwrap();
    let mut settings = rendition_request(&source, 0, 1);
    let page = notation_page(&source, &settings).unwrap();
    assert_eq!(page.status, "page_limit");
    assert_eq!(page.coverage.window_attacks, 2049);
    assert!(page.interpreted_notes.is_empty() && page.onsets.is_empty());
    assert!(page.score.is_none() && page.musicxml.is_none());
    settings.rendition_policy_id = Some("unknown-policy".into());
    assert!(notation_page(&source, &settings)
        .unwrap_err()
        .contains("Unknown"));
}
