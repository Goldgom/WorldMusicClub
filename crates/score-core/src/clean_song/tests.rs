use super::*;

// Original three-track, two-part exercises. No provided/private melody is used.
fn vlq(mut n: u32) -> Vec<u8> {
    let mut out = vec![(n & 127) as u8];
    while {
        n >>= 7;
        n != 0
    } {
        out.push(((n & 127) | 128) as u8);
    }
    out.reverse();
    out
}
fn track(events: &[(u32, &[u8])]) -> Vec<u8> {
    events
        .iter()
        .flat_map(|(delta, message)| {
            let mut e = vlq(*delta);
            e.extend_from_slice(message);
            e
        })
        .collect()
}
fn smf(tracks: Vec<Vec<u8>>) -> Vec<u8> {
    let mut out = b"MThd\0\0\0\x06\0\x01".to_vec();
    out.extend_from_slice(&(tracks.len() as u16).to_be_bytes());
    out.extend_from_slice(&480u16.to_be_bytes());
    for t in tracks {
        out.extend_from_slice(b"MTrk");
        out.extend_from_slice(&(t.len() as u32).to_be_bytes());
        out.extend(t);
    }
    out
}
fn authored() -> Vec<u8> {
    smf(vec![
        track(&[
            (0, b"\xff\x03\x0dClean Fixture"),
            (0, &[0xff, 0x51, 3, 7, 0xa1, 0x20]),
            (0, &[0xff, 0x58, 4, 4, 2, 24, 8]),
            (960, &[0xff, 0x51, 3, 6, 0x1a, 0x80]),
            (960, &[0xff, 0x2f, 0]),
        ]),
        track(&[
            (0, b"\xff\x03\x04Keys"),
            (0, &[0xc0, 0]),
            (0, &[0xb0, 7, 100]),
            (0, &[0xb0, 10, 32]),
            (0, &[0x90, 60, 88]),
            (480, &[0x80, 60, 12]),
            (0, &[0x90, 64, 80]),
            (480, &[0x80, 64, 0]),
            (0, &[0x90, 67, 90]),
            (960, &[0x80, 67, 4]),
            (0, &[0xff, 0x2f, 0]),
        ]),
        track(&[
            (0, b"\xff\x03\x06Plucks"),
            (0, &[0xc1, 24]),
            (0, &[0xb1, 7, 90]),
            (0, &[0xb1, 10, 96]),
            (0, &[0x91, 48, 76]),
            (960, &[0x81, 48, 6]),
            (0, &[0x91, 55, 82]),
            (960, &[0x81, 55, 0]),
            (0, &[0xff, 0x2f, 0]),
        ]),
    ])
}
#[test]
fn complete_authored_sequence_round_trips_without_original_payload() {
    let bytes = authored();
    let clean = convert_midi(&bytes).unwrap();
    assert_eq!(clean.coverage.source_tracks, 3);
    assert_eq!(clean.performance.parts.len(), 2);
    assert_eq!(clean.coverage.pitched_notes, 5);
    assert_eq!(clean.coverage.source_events, 25);
    assert_eq!(clean.coverage.represented_events, 25);
    assert!(clean.notation.source.is_none());
    assert_eq!(clean.performance.notes[0].release_velocity, 12);
    let encoded = encode_json(&clean).unwrap();
    let decoded = decode_json(&encoded).unwrap();
    assert_eq!(encode_json(&decoded).unwrap(), encoded);
    let text = String::from_utf8(encoded).unwrap();
    assert!(!text.contains("midi-base64"));
    assert!(!text.contains("source_range"));
    assert!(!text.contains("\\\"data\\\""));
    assert_eq!(
        crate::compile(decoded.notation)
            .unwrap()
            .timeline
            .notes
            .len(),
        5
    );
}
#[test]
fn tampering_with_track_note_or_tempo_coverage_is_rejected() {
    let clean = convert_midi(&authored()).unwrap();
    let mut missing = clean.clone();
    missing.performance.events.remove(0);
    assert!(validate(&missing).is_err());
    let mut missing = clean.clone();
    missing.performance.notes.pop();
    assert!(validate(&missing).is_err());
    let mut wrong = clean.clone();
    wrong.performance.notes[0].release.track = 2;
    assert!(validate(&wrong).is_err());
    let mut wrong = clean.clone();
    wrong.notation.tempo[0].bpm = 100.;
    assert!(validate(&wrong).is_err());
    let mut wrong = clean.clone();
    wrong.coverage.source_events -= 1;
    assert!(validate(&wrong).is_err());
    let mut wrong = clean.clone();
    wrong.performance.tracks.pop();
    assert!(validate(&wrong).is_err());
    let mut wrong = clean.clone();
    wrong.notation.parts[0].notes[1].at = Beat::ZERO;
    assert!(validate(&wrong).is_err());
}

// New independent synthetic source. The note may precede, interrupt, or follow
// the zero-time declarations. No positive interval elapses between them.
fn initial_tempo_exercise(values: &[u32], attack_position: usize) -> Vec<u8> {
    let mut events = Vec::new();
    for position in 0..=values.len() {
        if position == attack_position {
            events.push((0, vec![0x90, 61, 87]));
        }
        if let Some(value) = values.get(position) {
            let bytes = value.to_be_bytes();
            events.push((0, vec![255, 81, 3, bytes[1], bytes[2], bytes[3]]));
        }
    }
    // A later ordinary change divides the held note at exactly one third beat.
    events.extend([
        (160, vec![255, 81, 3, 9, 39, 199]), // 600007 us / quarter
        (320, vec![0x80, 61, 19]),
        (480, vec![255, 47, 0]),
    ]);
    smf(vec![track(
        &events
            .iter()
            .map(|(d, e)| (*d, e.as_slice()))
            .collect::<Vec<_>>(),
    )])
}

#[test]
fn ordered_initial_tempos_preserve_all_declarations_notes_and_exact_clock() {
    use base64::{engine::general_purpose::STANDARD, Engine};
    for values in [
        vec![400_001, 400_001],
        vec![500_003, 400_001],
        vec![400_001, 500_003, 400_001],
    ] {
        for attack_position in [0, 1, values.len()] {
            for format in [0, 1] {
                let mut bytes = initial_tempo_exercise(&values, attack_position);
                bytes[9] = format;
                let (canonical, warnings) = crate::import_midi(&bytes).unwrap();
                assert_eq!(
                    STANDARD
                        .decode(&canonical.source.as_ref().unwrap().content)
                        .unwrap(),
                    bytes
                );
                let changed = values.iter().any(|v| *v != values[0]);
                assert_eq!(
                    warnings
                        .iter()
                        .any(|d| d.code == "midi_initial_tempo_projection"),
                    changed
                );
                let clean = convert_midi(&bytes).unwrap();
                assert_eq!(clean.notation.tempo.len(), 2);
                assert_eq!(clean.notation.tempo[0].bpm, 60_000_000.0 / 400_001.0);
                assert_eq!(clean.coverage.source_events, values.len() + 4);
                assert_eq!(clean.coverage.represented_events, values.len() + 4);
                assert_eq!(
                    clean.performance.notes[0].attack.event as usize,
                    attack_position
                );
                let encoded = encode_json(&clean).unwrap();
                let reloaded = decode_json(&encoded).unwrap();
                assert_eq!(encoded, encode_json(&reloaded).unwrap());
                let runtime = compile_complete(&reloaded).unwrap();
                assert_eq!(runtime.notes.len(), 1);
                assert_eq!(runtime.notes[0].key, 61);
                assert_eq!(runtime.notes[0].velocity, 87);
                assert_eq!(runtime.notes[0].release_velocity, 19);
                assert_eq!(runtime.notes[0].start_microseconds.numerator, "0");
                assert_eq!(runtime.notes[0].end_microseconds.numerator, "1600015");
                assert_eq!(runtime.notes[0].end_microseconds.denominator, 3);
                assert_eq!(runtime.duration_microseconds.numerator, "3400036");
                assert_eq!(runtime.duration_microseconds.denominator, 3);
                assert_eq!(
                    runtime
                        .compilation
                        .diagnostics
                        .iter()
                        .any(|d| d.code == "midi_initial_tempo_projection"),
                    changed
                );
                let source = crate::midi_events::parse_midi_events(&bytes, None).unwrap();
                for event in &runtime.events {
                    let raw = &source.events()[event.origin.event as usize];
                    assert_eq!(
                        event.event_id,
                        format!("midi:{}:t0:e{}", clean.source.sha256, event.origin.event)
                    );
                    assert_eq!(
                        event.exact_microseconds.numerator,
                        raw.relative_microseconds().unwrap().numerator().to_string()
                    );
                    assert_eq!(
                        event.exact_microseconds.denominator,
                        raw.relative_microseconds().unwrap().denominator() as u64
                    );
                }
                let retained: Vec<_> = runtime
                    .events
                    .iter()
                    .filter_map(|e| match e.command {
                        Command::Tempo {
                            microseconds_per_quarter,
                        } if e.at_ms == 0. => Some(microseconds_per_quarter),
                        _ => None,
                    })
                    .collect();
                assert_eq!(retained, values);
            }
        }
    }
}

#[test]
fn initial_tempo_projection_is_revalidated_on_authoritative_json_load() {
    let clean = convert_midi(&initial_tempo_exercise(&[500_003, 400_001], 1)).unwrap();
    let mut wrong = clean.clone();
    wrong.notation.tempo[0].bpm = 60_000_000.0 / 500_003.0;
    assert!(validate(&wrong).unwrap_err().contains("Canonical tempo"));
    let mut wrong = clean.clone();
    wrong.performance.events.remove(0);
    assert!(validate(&wrong).is_err());
    let mut wrong = clean.clone();
    wrong.performance.events.swap(0, 1);
    assert!(validate(&wrong).unwrap_err().contains("order"));
    let mut wrong = clean.clone();
    wrong.performance.events[1].at = Beat::new(1, 480);
    assert!(validate(&wrong).is_err());
}

#[test]
fn equal_cross_track_initial_tempos_work_but_any_differing_value_is_held() {
    let a: &[u8] = &[255, 81, 3, 7, 161, 32];
    let b: &[u8] = &[255, 81, 3, 7, 161, 33];
    let make = |values: [&[u8]; 3]| {
        smf(vec![
            track(&[(0, values[0]), (0, values[1]), (480, &[255, 47, 0])]),
            track(&[
                (0, values[2]),
                (0, &[0x90, 60, 90]),
                (480, &[0x80, 60, 0]),
                (0, &[255, 47, 0]),
            ]),
        ])
    };
    let clean = convert_midi(&make([a, a, a])).unwrap();
    assert_eq!(
        clean
            .performance
            .events
            .iter()
            .filter(|e| matches!(e.command, Command::Tempo { .. }))
            .count(),
        3
    );
    assert_eq!(clean.notation.tempo.len(), 1);
    for values in [[b, a, a], [a, b, a], [a, a, b]] {
        let bytes = make(values);
        assert!(crate::import_midi(&bytes)
            .unwrap_err()
            .contains("cross-track tempo"));
        assert!(convert_midi(&bytes)
            .unwrap_err()
            .contains("cross-track tempo"));
    }
    // The same final value cannot hide a different earlier declaration on JSON load.
    for index in [0, 1, 2] {
        let mut wrong = clean.clone();
        wrong.performance.events[index].command = Command::Tempo {
            microseconds_per_quarter: 500_001,
        };
        assert!(validate(&wrong).unwrap_err().contains("cross-track tempo"));
        assert!(decode_json(&serde_json::to_vec(&wrong).unwrap())
            .unwrap_err()
            .contains("cross-track tempo"));
    }
}

#[test]
fn initial_tempo_change_does_not_relax_later_tempo_meter_or_key_conflicts() {
    for (first, second, delta, diagnostic) in [
        (
            vec![255, 81, 3, 7, 161, 32],
            vec![255, 81, 3, 7, 161, 33],
            120,
            "tempo",
        ),
        (
            vec![255, 88, 4, 4, 2, 24, 8],
            vec![255, 88, 4, 3, 2, 24, 8],
            0,
            "time signature",
        ),
        (
            vec![255, 89, 2, 0, 0],
            vec![255, 89, 2, 1, 0],
            0,
            "key signature",
        ),
    ] {
        let bytes = smf(vec![track(&[
            (delta, &first),
            (0, &second),
            (0, &[0x90, 60, 90]),
            (480, &[0x80, 60, 0]),
            (0, &[255, 47, 0]),
        ])]);
        assert!(convert_midi(&bytes)
            .unwrap_err()
            .contains(&format!("Conflicting MIDI {diagnostic}")));
    }
    // Later identical tempos still work; a clean-JSON mutation must not enable later changes.
    let bytes = smf(vec![track(&[
        (0, &[0x90, 60, 90]),
        (120, &[255, 81, 3, 7, 161, 32]),
        (0, &[255, 81, 3, 7, 161, 32]),
        (360, &[0x80, 60, 0]),
        (0, &[255, 47, 0]),
    ])]);
    let mut clean = convert_midi(&bytes).unwrap();
    clean.performance.events[0].command = Command::Tempo {
        microseconds_per_quarter: 500_001,
    };
    assert!(validate(&clean)
        .unwrap_err()
        .contains("simultaneous tempos"));
}
#[test]
fn refuses_unknown_semantics_instead_of_exporting_partial_music() {
    let percussion = smf(vec![track(&[
        (0, &[0x99, 36, 90]),
        (480, &[0x89, 36, 0]),
        (0, &[0xff, 47, 0]),
    ])]);
    assert!(convert_midi(&percussion)
        .unwrap_err()
        .contains("percussion"));
    let overlap = smf(vec![track(&[
        (0, &[0x90, 60, 90]),
        (120, &[0x90, 60, 80]),
        (120, &[0x80, 60, 0]),
        (120, &[0x80, 60, 0]),
        (0, &[0xff, 47, 0]),
    ])]);
    assert!(convert_midi(&overlap).unwrap_err().contains("overlapping"));
    let text = smf(vec![track(&[
        (0, b"\xff\x01\x08DM:0000:"),
        (0, &[0x90, 60, 90]),
        (480, &[0x80, 60, 0]),
        (0, &[0xff, 47, 0]),
    ])]);
    assert!(convert_midi(&text).unwrap_err().contains("textual cue"));
    let invalid_text = smf(vec![track(&[
        (0, &[0xff, 1, 1, 0xff]),
        (0, &[0x90, 60, 90]),
        (480, &[0x80, 60, 0]),
        (0, &[0xff, 47, 0]),
    ])]);
    assert!(convert_midi(&invalid_text)
        .unwrap_err()
        .contains("encoding"));
}
#[test]
fn source_content_duplicate_fields_and_unrecognized_data_are_rejected() {
    let mut clean = convert_midi(&authored()).unwrap();
    clean.notation.source = Some(crate::Source {
        import_diagnostics: None,
        format: "midi-base64".into(),
        filename: None,
        content: "TVRoZA==".into(),
    });
    assert!(validate(&clean).is_err());
    let encoded =
        String::from_utf8(encode_json(&convert_midi(&authored()).unwrap()).unwrap()).unwrap();
    let duplicate = encoded.replacen("\"version\": 1", "\"version\": 1, \"version\": 1", 1);
    assert!(decode_json(duplicate.as_bytes()).is_err());
    let unknown = encoded.replacen("\"source\": {", "\"unknown\": {}, \"source\": {", 1);
    assert!(decode_json(unknown.as_bytes()).is_err());
}
#[test]
fn known_initial_state_is_kept_and_later_resets_are_rejected() {
    let initialized = smf(vec![track(&[
        (0, &[0xb0, 121, 0]),
        (0, &[0xb0, 64, 0]),
        (0, &[0xc0, 8]),
        (0, &[0x90, 60, 90]),
        (480, &[0x80, 60, 0]),
        (0, &[0xff, 47, 0]),
    ])]);
    let clean = convert_midi(&initialized).unwrap();
    assert_eq!(clean.coverage.source_events, 6);
    assert!(matches!(
        clean.performance.events[0].command,
        Command::InitialControllerReset { channel: 0 }
    ));
    let mut wrong = clean;
    wrong.performance.events.swap(0, 1);
    assert!(validate(&wrong).is_err());
}

#[test]
fn exact_semantic_clock_drives_both_reference_and_practice() {
    let clean = convert_midi(&authored()).unwrap();
    let runtime = compile_complete(&clean).unwrap();
    assert_eq!(runtime.duration_ms, 1800.0);
    assert_eq!(runtime.duration_microseconds.numerator, "1800000");
    assert_eq!(runtime.duration_microseconds.denominator, 1);
    for note in &runtime.notes {
        let compiled = runtime
            .compilation
            .timeline
            .notes
            .iter()
            .find(|n| n.source_note_id == note.note_id)
            .unwrap();
        assert_eq!(compiled.start_ms, note.start_ms);
        assert_eq!(compiled.duration_ms, note.end_ms - note.start_ms);
        assert!(note
            .event_id
            .ends_with(&format!(":t{}:e{}", note.attack.track, note.attack.event)));
    }
    assert_eq!(
        runtime.events.len() + runtime.notes.len() * 2,
        clean.coverage.represented_events
    );
}
#[test]
fn exact_fractional_tempo_crossing_is_not_rounded_through_bpm() {
    let source = smf(vec![track(&[
        (0, &[0xff, 0x51, 3, 7, 0xa1, 0x21]),
        (1, &[0x90, 60, 90]),
        (1, &[0xff, 0x51, 3, 6, 0x1a, 0x81]),
        (1, &[0x80, 60, 0]),
        (0, &[0xff, 47, 0]),
    ])]);
    let runtime = compile_complete(&convert_midi(&source).unwrap()).unwrap();
    assert_eq!(runtime.notes[0].start_microseconds.numerator, "166667");
    assert_eq!(runtime.notes[0].start_microseconds.denominator, 160);
    assert_eq!(runtime.duration_microseconds.numerator, "1400003");
    assert_eq!(runtime.duration_microseconds.denominator, 480);
    assert!(runtime.navigation.is_some());
}

#[test]
fn clean_navigation_uses_the_exact_clock_instead_of_recompiled_bpm() {
    // New original C4/E4/G4 exercise, PPQ 96 and 333333 us per quarter.
    // The third onset differs by one binary64 step after a BPM round trip.
    let mut source = smf(vec![track(&[
        (0, &[0xff, 0x51, 3, 5, 0x16, 0x15]),
        (1, &[0x90, 60, 80]),
        (1, &[0x80, 60, 0]),
        (1, &[0x90, 64, 80]),
        (1, &[0x80, 64, 0]),
        (1, &[0x90, 67, 80]),
        (1, &[0x80, 67, 0]),
        (0, &[0xff, 47, 0]),
    ])]);
    source[12..14].copy_from_slice(&96u16.to_be_bytes());
    let score = convert_midi(&source).unwrap();
    let runtime = compile_complete(&score).unwrap();
    let ordinary = crate::navigation::notation_navigation(score.notation.clone()).unwrap();
    let navigation = runtime.navigation.as_ref().unwrap();
    assert_eq!(runtime.notes[2].start_ms, 17.36109375);
    assert_ne!(
        ordinary.sounding_groups[2].start_ms,
        runtime.notes[2].start_ms
    );
    assert_eq!(
        navigation.sounding_groups[2].start_ms,
        runtime.notes[2].start_ms
    );
    assert_eq!(
        navigation.written_cursor.as_ref().unwrap().spans[2].start_ms,
        runtime.notes[2].start_ms
    );
    assert_eq!(navigation.duration_ms, runtime.duration_ms);
    assert_eq!(
        navigation.occurrences.last().unwrap().end_ms,
        runtime.duration_ms
    );
}

#[test]
fn clean_navigation_keeps_multiple_tempo_changes_cross_measure_notes_and_silent_tail() {
    // Entirely original fractional exercise. One endpoint intentionally cannot
    // be reconstructed bit-for-bit as start + (end - start).
    let source = smf(vec![track(&[
        (0, &[0xff, 0x51, 3, 7, 0xa1, 0x21]),
        (1, &[0x90, 60, 90]),
        (1, &[0xff, 0x51, 3, 6, 0x1a, 0x81]),
        (0, &[0x90, 64, 80]),
        (1, &[0x80, 60, 0]),
        (15, &[0x80, 64, 0]),
        (223, &[0x90, 60, 88]),
        (240, &[0xff, 0x51, 3, 9, 0x27, 0xc7]),
        (479, &[0x80, 60, 0]),
        (1, &[0x90, 67, 92]),
        (40, &[0xff, 0x51, 3, 5, 0x16, 0x19]),
        (3000, &[0x80, 67, 0]),
        (1759, &[0xff, 0x51, 3, 10, 0x2c, 0x2b]),
        (1441, &[0xff, 47, 0]),
    ])]);
    let score = convert_midi(&source).unwrap();
    let before = encode_json(&score).unwrap();
    let runtime = compile_complete(&score).unwrap();
    let navigation = runtime.navigation.as_ref().unwrap();
    let ordinary = crate::navigation::notation_navigation(score.notation.clone()).unwrap();
    let milliseconds = |beat: Beat| {
        let scaled = beat.numerator as u64 * 480;
        assert_eq!(scaled % beat.denominator as u64, 0);
        let tick = scaled / beat.denominator as u64;
        let changes = [
            (0, 500001),
            (2, 400001),
            (481, 600007),
            (1001, 333337),
            (5760, 666667),
            (7201, 0),
        ];
        let numerator: u64 = changes
            .windows(2)
            .map(|pair| tick.min(pair[1].0).saturating_sub(pair[0].0) * pair[0].1)
            .sum();
        (numerator / 480000) as f64 + (numerator % 480000) as f64 / 480000.0
    };
    assert_eq!(navigation.occurrences.len(), 4);
    assert_eq!(navigation.duration_ms, milliseconds(score.performance.end));
    for (occurrence, original) in navigation.occurrences.iter().zip(&ordinary.occurrences) {
        assert_eq!(occurrence.start_ms, milliseconds(occurrence.source_from));
        assert_eq!(occurrence.end_ms, milliseconds(occurrence.source_to));
        assert_eq!(occurrence.written_note_ids, original.written_note_ids);
        assert_eq!(occurrence.continuing_note_ids, original.continuing_note_ids);
    }
    for pair in navigation.occurrences.windows(2) {
        assert_eq!(pair[0].end_ms, pair[1].start_ms);
    }
    let tail = navigation.occurrences.last().unwrap();
    assert!(tail.written_note_ids.is_empty() && tail.continuing_note_ids.is_empty());
    assert_eq!(tail.end_ms, runtime.duration_ms);
    assert!(runtime
        .notes
        .iter()
        .all(|note| note.end_ms < runtime.duration_ms));
    let cursor = navigation.written_cursor.as_ref().unwrap();
    let canonical: BTreeMap<_, _> = score
        .notation
        .parts
        .iter()
        .flat_map(|part| part.notes.iter().map(|note| (note.id.as_str(), note)))
        .collect();
    assert_eq!(
        cursor.spans.len(),
        ordinary.written_cursor.as_ref().unwrap().spans.len()
    );
    for span in &cursor.spans {
        let note = canonical[cursor.source_note_ids[span.source_note_index].as_str()];
        let occurrence = &navigation.occurrences[span.measure_occurrence_index];
        let end = note.at.checked_add(note.duration).unwrap();
        assert_eq!(
            span.start_ms,
            milliseconds(note.at).max(occurrence.start_ms)
        );
        assert_eq!(span.end_ms, milliseconds(end).min(occurrence.end_ms));
    }
    for (group, compiled) in navigation
        .sounding_groups
        .iter()
        .zip(&runtime.compilation.timeline.notes)
    {
        assert_eq!(group.occurrence_id, compiled.id);
        assert_eq!(group.part_id, compiled.part_id);
        assert_eq!(group.source_note_ids, compiled.source_note_ids);
        assert_eq!(group.start_ms, compiled.start_ms);
        assert_eq!(group.end_ms, compiled.start_ms + compiled.duration_ms);
    }
    let separate_end = &runtime.notes[1];
    assert_eq!(separate_end.end_ms, milliseconds(Beat::new(18, 480)));
    assert_ne!(separate_end.end_ms, navigation.sounding_groups[1].end_ms);
    assert_eq!(encode_json(&score).unwrap(), before);
}

#[test]
fn mismatched_or_missing_written_extent_disables_only_clean_navigation() {
    let source = smf(vec![track(&[
        (0, &[0x90, 60, 90]),
        (480, &[0x80, 60, 0]),
        (960, &[0xff, 47, 0]),
    ])]);
    let score = convert_midi(&source).unwrap();
    let expected = compile_complete(&score).unwrap();
    // A shorter measure map still covers every written note, but must not
    // silently discard the two-beat semantic track tail.
    for length in [None, Some(Beat::new(8, 1)), Some(Beat::new(1, 1))] {
        let mut score = score.clone();
        if let Some(length) = length {
            score.notation.measures.last_mut().unwrap().length = length;
        } else {
            score.notation.measures.clear();
        }
        let before = encode_json(&score).unwrap();
        let actual = compile_complete(&score).unwrap();
        assert!(actual.navigation.is_none());
        assert!(actual
            .compilation
            .diagnostics
            .iter()
            .any(|d| d.code == "clean_song_navigation_unavailable"));
        assert_eq!(actual.duration_ms, expected.duration_ms);
        assert_eq!(
            serde_json::to_value(actual.notes).unwrap(),
            serde_json::to_value(&expected.notes).unwrap()
        );
        assert_eq!(
            serde_json::to_value(actual.events).unwrap(),
            serde_json::to_value(&expected.events).unwrap()
        );
        assert_eq!(
            serde_json::to_value(actual.compilation.timeline).unwrap(),
            serde_json::to_value(&expected.compilation.timeline).unwrap()
        );
        assert_eq!(encode_json(&score).unwrap(), before);
    }
}

#[test]
fn initial_reset_does_not_erase_a_preceding_program() {
    let source = smf(vec![track(&[
        (0, &[0xc0, 24]),
        (0, &[0xb0, 121, 0]),
        (0, &[0xb0, 64, 0]),
        (0, &[0x90, 60, 90]),
        (480, &[0x80, 60, 0]),
        (0, &[0xff, 47, 0]),
    ])]);
    let clean = convert_midi(&source).unwrap();
    assert!(matches!(
        clean.performance.events[0].command,
        Command::InstrumentProgram { program: 24, .. }
    ));
    let decoded = decode_json(&encode_json(&clean).unwrap()).unwrap();
    compile_complete(&decoded).unwrap();
}
#[test]
fn checked_in_fixture_matches_the_same_converter_and_runtime() {
    let score = convert_midi(&authored()).unwrap();
    assert_eq!(
        encode_json(&score).unwrap(),
        include_bytes!("../../../../tests/fixtures/clean-song-v2/score.json")
    );
    let runtime = serde_json::to_vec_pretty(&compile_complete(&score).unwrap()).unwrap();
    assert_eq!(
        runtime,
        include_bytes!("../../../../tests/fixtures/clean-song-v2-runtime.json")
    );
}

fn sensitivity_messages() -> Vec<(u32, Vec<u8>)> {
    [(101, 0), (100, 0), (6, 24), (38, 0), (101, 127), (100, 127)]
        .into_iter()
        .map(|(controller, value)| (0, vec![0xb0, controller, value]))
        .collect()
}
fn sensitivity_source(mut prefix: Vec<(u32, Vec<u8>)>) -> Vec<u8> {
    prefix.extend([
        (0, vec![0xc0, 24]),
        (1, vec![0x90, 60, 80]),
        (480, vec![0x80, 60, 12]),
        (479, vec![0xff, 47, 0]),
    ]);
    smf(vec![track(
        &prefix
            .iter()
            .map(|(delta, message)| (*delta, message.as_slice()))
            .collect::<Vec<_>>(),
    )])
}
#[test]
fn initial_sensitivity_preserves_all_six_meanings_coordinates_and_note_clocks() {
    let bytes = sensitivity_source(sensitivity_messages());
    let clean = convert_midi(&bytes).unwrap();
    let (source_score, diagnostics) = crate::import_midi(&bytes).unwrap();
    assert!(source_score.source.is_some());
    assert!(diagnostics
        .iter()
        .any(|d| d.code == "midi_initial_pitch_bend_sensitivity"));
    assert_eq!(clean.coverage.source_events, 10);
    assert_eq!(clean.coverage.represented_events, 10);
    let runtime = compile_complete(&decode_json(&encode_json(&clean).unwrap()).unwrap()).unwrap();
    for (index, step) in InitialPitchBendSensitivityStep::ORDER.iter().enumerate() {
        let event = &runtime.events[index];
        assert_eq!(
            event.origin,
            Coordinate {
                track: 0,
                event: index as u32
            }
        );
        assert_eq!(event.at_ms, 0.0);
        assert_eq!(event.exact_microseconds.numerator, "0");
        assert!(
            matches!(event.command, Command::InitialPitchBendSensitivity { channel: 0, step: actual } if actual == *step)
        );
    }
    let note = &runtime.notes[0];
    assert_eq!(note.note_id, "midi-t1-c1-e8");
    assert_eq!(note.start_microseconds.numerator, "3125");
    assert_eq!(note.start_microseconds.denominator, 3);
    assert_eq!(note.key, 60);
    assert_eq!(note.release_velocity, 12);
}
#[test]
fn initial_sensitivity_rejects_unreviewed_values_and_incomplete_or_interleaved_groups() {
    let correct = sensitivity_messages();
    let mut invalid = Vec::new();
    for index in 0..6 {
        let mut changed = correct.clone();
        changed[index].1[2] ^= 1;
        invalid.push(changed);
        let mut missing = correct.clone();
        missing.remove(index);
        invalid.push(missing);
        let mut delayed = correct.clone();
        delayed[index].0 = 1;
        invalid.push(delayed);
    }
    for message in [
        vec![0xb0, 7, 80],
        vec![0xc0, 24],
        vec![0xff, 1, 1, b'x'],
        vec![0xb1, 7, 80],
    ] {
        let mut interleaved = correct.clone();
        interleaved.insert(2, (0, message));
        invalid.push(interleaved);
    }
    let mut swapped = correct.clone();
    swapped.swap(0, 1);
    invalid.push(swapped);
    let mut repeated = correct.clone();
    repeated.extend(correct.clone());
    invalid.push(repeated);
    let mut after_control = vec![(0, vec![0xb0, 10, 64])];
    after_control.extend(correct.clone());
    invalid.push(after_control);
    let mut after_note = vec![(0, vec![0x90, 64, 80]), (0, vec![0x80, 64, 0])];
    after_note.extend(correct.clone());
    invalid.push(after_note);
    let mut with_bend = correct.clone();
    with_bend.push((0, vec![0xe0, 0, 64]));
    invalid.push(with_bend);
    for prefix in invalid {
        let bytes = sensitivity_source(prefix);
        assert!(crate::import_midi(&bytes).is_err());
        assert!(convert_midi(&bytes).is_err());
    }
    let mut preceding_program = vec![(0, vec![0xc0, 48])];
    preceding_program.extend(correct);
    convert_midi(&sensitivity_source(preceding_program)).unwrap();
}
#[test]
fn initial_sensitivity_json_reload_rejects_semantic_relabeling_and_wrong_ownership() {
    let clean = convert_midi(&sensitivity_source(sensitivity_messages())).unwrap();
    for index in 0..6 {
        let mut wrong = clean.clone();
        wrong.performance.events[index].command = Command::InitialPitchBendSensitivity {
            channel: 0,
            step: InitialPitchBendSensitivityStep::ORDER[(index + 1) % 6],
        };
        assert!(encode_json(&wrong).is_err());
        let mut wrong = clean.clone();
        wrong.performance.events[index].command = Command::Volume {
            channel: 0,
            value: 24,
        };
        assert!(encode_json(&wrong).is_err());
    }
    let mut wrong = clean.clone();
    wrong.performance.events[0].at = Beat::new(1, 480);
    assert!(validate(&wrong).is_err());
    let prefix = sensitivity_messages();
    let mut first = prefix[..3].to_vec();
    first.push((480, vec![0xff, 47, 0]));
    let mut second = prefix[3..].to_vec();
    second.extend([
        (1, vec![0x90, 60, 80]),
        (479, vec![0x80, 60, 0]),
        (0, vec![0xff, 47, 0]),
    ]);
    let make = |events: &Vec<(u32, Vec<u8>)>| {
        track(
            &events
                .iter()
                .map(|(delta, message)| (*delta, message.as_slice()))
                .collect::<Vec<_>>(),
        )
    };
    let split = smf(vec![make(&first), make(&second)]);
    assert!(convert_midi(&split).is_err());
    let owner = make(&{
        let mut complete = sensitivity_messages();
        complete.push((960, vec![0xff, 47, 0]));
        complete
    });
    let notes = track(&[
        (1, &[0x90, 60, 80]),
        (479, &[0x80, 60, 0]),
        (480, &[0xff, 47, 0]),
    ]);
    assert!(convert_midi(&smf(vec![owner, notes])).is_err());
}

#[test]
fn authored_initial_sensitivity_fixture_preserves_silent_tracks_and_exact_runtime() {
    let score = decode_json(include_bytes!(
        "../../../../tests/fixtures/clean-song-v2-rpn/score.json"
    ))
    .unwrap();
    assert_eq!(score.coverage.source_tracks, 4);
    assert_eq!(score.coverage.source_events, 44);
    assert_eq!(score.coverage.pitched_notes, 4);
    assert_eq!(score.performance.parts.len(), 2);
    assert_eq!(score.performance.tracks[3].source_event_count, 11);
    assert_eq!(
        score
            .performance
            .events
            .iter()
            .filter(|event| matches!(event.command, Command::InitialPitchBendSensitivity { .. }))
            .count(),
        18
    );
    assert_eq!(
        serde_json::to_vec_pretty(&compile_complete(&score).unwrap()).unwrap(),
        include_bytes!("../../../../tests/fixtures/clean-song-v2-rpn-runtime.json")
    );
}
