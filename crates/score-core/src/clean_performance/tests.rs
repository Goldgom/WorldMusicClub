use super::*;
// All inputs in this module are newly authored synthetic events, never supplied music.
fn vlq(mut n: u32) -> Vec<u8> {
    let mut bytes = vec![(n & 127) as u8];
    while {
        n >>= 7;
        n > 0
    } {
        bytes.insert(0, ((n & 127) | 128) as u8);
    }
    bytes
}
fn midi(tracks: Vec<Vec<(u32, Vec<u8>)>>, ppq: u16) -> Vec<u8> {
    let mut out = b"MThd\0\0\0\x06".to_vec();
    out.extend_from_slice(&(if tracks.len() == 1 { 0u16 } else { 1u16 }).to_be_bytes());
    out.extend_from_slice(&(tracks.len() as u16).to_be_bytes());
    out.extend_from_slice(&ppq.to_be_bytes());
    for events in tracks {
        let mut track = Vec::new();
        for (delta, data) in events {
            track.extend(vlq(delta));
            track.extend(data);
        }
        out.extend_from_slice(b"MTrk");
        out.extend_from_slice(&(track.len() as u32).to_be_bytes());
        out.extend(track);
    }
    out
}
fn end() -> Vec<u8> {
    vec![255, 47, 0]
}
fn fixture() -> Vec<u8> {
    let mut tracks = Vec::new();
    for channel in 0..11u8 {
        let key = if channel == 9 { 85 } else { 48 + channel };
        let mut events = vec![(0, vec![255, 3, 1, b'A' + channel])];
        if channel == 0 {
            events.push((0, vec![255, 81, 3, 7, 161, 33]));
            events.push((0, vec![255, 88, 4, 4, 2, 24, 8]));
        }
        events.extend([
            (
                0,
                vec![0xc0 | channel, if channel == 9 { 118 } else { channel * 8 }],
            ),
            (1, vec![0x90 | channel, key, 90]),
            (1, vec![0x90 | channel, key, 70]),
            (1, vec![0x80 | channel, key, 19]),
            (1, vec![0x90 | channel, key, 0]),
            (1, end()),
        ]);
        tracks.push(events);
    }
    midi(tracks, 3)
}
fn converted(bytes: &[u8]) -> CompletePerformance {
    convert_midi(
        bytes,
        "authored-performance",
        "Original eleven-route fixture",
    )
    .unwrap()
}
fn assert_source_runtime(input: &[u8], score: &CompletePerformance) -> Runtime {
    let source = crate::midi_events::parse_midi_events(input, None).unwrap();
    let bytes = encode_json(score).unwrap();
    assert_eq!(bytes, encode_json(&decode_json(&bytes).unwrap()).unwrap());
    let runtime = compile_performance(&bytes).unwrap();
    assert_eq!(source.events().len(), score.performance.events.len());
    assert_eq!(source.events().len(), runtime.events.len());
    for ((original, semantic), actual) in source
        .events()
        .iter()
        .zip(&score.performance.events)
        .zip(&runtime.events)
    {
        let origin = Coordinate {
            track: original.id().track_index(),
            event: original.id().event_index(),
        };
        assert_eq!(semantic.event_id, original.id().stable_id());
        assert_eq!(semantic.origin, origin);
        assert_eq!(semantic.at.numerator, original.beat().numerator);
        assert_eq!(semantic.at.denominator, original.beat().denominator);
        assert_eq!(actual.event_id, semantic.event_id);
        assert_eq!(actual.origin, origin);
        assert_eq!(
            serde_json::to_value(&actual.command).unwrap(),
            serde_json::to_value(&semantic.command).unwrap()
        );
        let exact = original.relative_microseconds().unwrap();
        assert_eq!(
            actual.exact_microseconds.numerator,
            exact.numerator().to_string()
        );
        assert_eq!(
            actual.exact_microseconds.denominator,
            u64::from(exact.denominator())
        );
        if let crate::midi_events::EventKind::Channel {
            channel,
            message: crate::midi_events::ChannelMessage::Controller { controller, value },
        } = original.kind()
        {
            match controller {
                64 => assert!(matches!(
                    semantic.command,
                    Command::Sustain { channel: found_channel, value: found_value }
                        if found_channel == *channel && found_value == *value
                )),
                121 => {
                    assert_eq!(*value, 0);
                    assert!(matches!(
                        semantic.command,
                        Command::InitialControllerReset { channel: found } if found == *channel
                    ));
                }
                _ => (),
            }
        }
    }
    runtime
}

// The initial reset channel belongs to one track for its whole source extent.
// Other channels and metadata can occur between reset and its next channel event.
fn initial_control_fixture() -> Vec<u8> {
    midi(
        vec![
            vec![
                (0, vec![255, 81, 3, 7, 161, 33]),
                (2, vec![255, 81, 3, 9, 39, 199]),
                (7, end()),
            ],
            vec![
                (0, vec![0xb0, 0, 2]),
                (0, vec![0xb0, 32, 3]),
                (0, vec![0xc0, 40]),
                (0, vec![0xb0, 7, 90]),
                (0, vec![0xb0, 10, 32]),
                (0, vec![0xb0, 11, 47]),
                (0, vec![0xb0, 91, 63]),
                (0, vec![0xb0, 93, 19]),
                (0, vec![0xb0, 121, 0]),
                (0, vec![255, 1, 1, b'S']),
                (0, vec![0x91, 67, 71]),
                (0, vec![0xb0, 64, 0]),
                (0, vec![0xb0, 11, 31]),
                (0, vec![0xb0, 121, 0]),
                (0, vec![0xb0, 64, 0]),
                (0, vec![0xb0, 64, 63]),
                (0, vec![0x90, 60, 89]),
                (1, vec![0xb0, 64, 64]),
                (1, vec![0x80, 60, 19]),
                (1, vec![0xb0, 64, 127]),
                (1, vec![0xb0, 64, 1]),
                (1, vec![0xb0, 64, 126]),
                (1, vec![0x90, 62, 0]),
                (1, vec![0xb0, 64, 0]),
                (0, vec![0xa0, 60, 43]),
                (0, vec![0xd0, 17]),
                (1, end()),
            ],
        ],
        3,
    )
}

fn assert_decode_rejected(score: &CompletePerformance, reason: &str) {
    // Deliberately bypass encode_json's validation so the public byte decoder
    // itself must reject malformed persisted packages.
    let bytes = serde_json::to_vec(score).unwrap();
    let error = decode_json(&bytes).unwrap_err();
    assert!(error.contains(reason), "expected {reason:?}, got {error:?}");
    assert!(compile_performance(&bytes).is_err());
}
#[test]
fn all_eleven_tracks_overlap_and_percussion_survive_as_independent_events() {
    let input = fixture();
    assert!(crate::clean_song::convert_midi(&input).is_err());
    assert!(crate::midi::import_midi(&input).is_err());
    let score = converted(&input);
    assert_eq!(score.performance.tracks.len(), 11);
    assert_eq!(score.performance.parts.len(), 11);
    assert_eq!(score.coverage.performance.key_attacks, 22);
    assert_eq!(score.coverage.performance.key_releases, 22);
    assert_eq!(score.coverage.performance.source_events, 79);
    assert!(score.notation.is_none());
    assert_eq!(score.coverage.notation.represented_attacks, 0);
    assert_eq!(score.coverage.targets.represented_attacks, 0);
    assert!(score.performance.events.iter().any(|e| matches!(
        e.command,
        Command::KeyAttack {
            channel: 9,
            key: 85,
            velocity: 90,
            ..
        }
    )));
    let bytes = encode_json(&score).unwrap();
    assert_eq!(bytes, encode_json(&decode_json(&bytes).unwrap()).unwrap());
    let json = String::from_utf8(bytes).unwrap();
    for forbidden in [
        "source_range",
        "delta_ticks",
        "base64",
        "duration",
        "release_event_id",
        "source.payload",
    ] {
        assert!(!json.contains(forbidden), "{forbidden}");
    }
}
#[test]
fn runtime_exact_clock_and_coordinates_match_every_source_event() {
    let input = fixture();
    let score = converted(&input);
    let bytes = encode_json(&score).unwrap();
    let runtime = assert_source_runtime(&input, &score);
    assert_eq!(runtime.duration_microseconds.numerator, "833335");
    assert_eq!(runtime.duration_microseconds.denominator, 1);
    let mut whitespace = bytes.clone();
    whitespace.push(b' ');
    assert_ne!(
        runtime.score_sha256,
        compile_performance(&whitespace).unwrap().score_sha256
    );
}
#[test]
fn silent_conductor_unmatched_release_and_unreleased_attack_are_data_not_durations() {
    let input = midi(
        vec![
            vec![(8, end())],
            vec![(0, vec![0x80, 60, 17]), (1, vec![0x90, 61, 70]), (2, end())],
        ],
        8,
    );
    let score = converted(&input);
    assert_eq!(score.performance.tracks.len(), 2);
    assert_eq!(score.performance.parts.len(), 1);
    assert_eq!(score.coverage.performance.key_attacks, 1);
    assert_eq!(score.coverage.performance.key_releases, 1);
    assert!(score.performance.end.equivalent(Beat::new(1, 1)));
    assert_eq!(
        compile_performance(&encode_json(&score).unwrap())
            .unwrap()
            .duration_microseconds
            .numerator,
        "500000"
    );
}
#[test]
fn typed_controls_and_pressure_survive_without_a_renderer_capability_claim() {
    let mut events = vec![];
    for controller in [0, 32, 7, 10, 11, 64, 91, 93] {
        events.push((0, vec![0xb0, controller, 47]));
    }
    events.extend([(0, vec![0xa0, 60, 19]), (0, vec![0xd0, 31]), (1, end())]);
    let score = converted(&midi(vec![events], 24));
    assert_eq!(score.performance.events.len(), 11);
    assert_eq!(score.coverage.performance.key_attacks, 0);
    assert_eq!(score.performance.parts.len(), 1);
    assert!(score
        .performance
        .events
        .iter()
        .any(|e| matches!(e.command, Command::BankSelect { value: 47, .. })));
}

#[test]
fn repeated_initial_setup_and_sustain_threshold_values_preserve_exact_source_and_clock() {
    let input = initial_control_fixture();
    let score = converted(&input);
    let runtime = assert_source_runtime(&input, &score);
    assert_eq!(score.performance.tracks.len(), 2);
    assert_eq!(score.performance.parts.len(), 2);
    assert_eq!(score.coverage.performance.key_attacks, 2);
    assert_eq!(score.coverage.performance.key_releases, 2);
    assert_eq!(score.coverage.notation.represented_attacks, 0);
    assert_eq!(score.coverage.targets.represented_attacks, 0);
    assert!(score.notation.is_none());
    assert_eq!(
        score
            .performance
            .events
            .iter()
            .filter(|event| matches!(
                event.command,
                Command::InitialControllerReset { channel: 0 }
            ))
            .count(),
        2
    );
    let values: Vec<_> = score
        .performance
        .events
        .iter()
        .filter_map(|event| match event.command {
            Command::Sustain { channel: 0, value } => Some(value),
            _ => None,
        })
        .collect();
    assert_eq!(values, [0, 0, 63, 64, 127, 1, 126, 0]);
    assert_eq!(runtime.duration_microseconds.numerator, "5200051");
    assert_eq!(runtime.duration_microseconds.denominator, 3);
    let json = String::from_utf8(encode_json(&score).unwrap()).unwrap();
    assert!(json.contains("\"kind\":\"initial_controller_reset\",\"channel\":0"));
    assert!(json.contains("\"kind\":\"sustain\",\"channel\":0,\"value\":63"));
    assert!(json.contains("\"kind\":\"sustain\",\"channel\":0,\"value\":64"));
    for forbidden in [
        "\"raw_midi\"",
        "\"controller\"",
        "\"duration\"",
        "\"release_event_id\"",
    ] {
        assert!(!json.contains(forbidden));
    }
}

#[test]
fn sustain_preserves_all_128_values_instead_of_collapsing_to_a_boolean() {
    let mut events = Vec::new();
    for value in 0..=127 {
        events.push((1, vec![0xbf, 64, value]));
    }
    events.push((1, end()));
    let input = midi(vec![events], 7);
    let score = converted(&input);
    assert_source_runtime(&input, &score);
    for (value, event) in score.performance.events[..128].iter().enumerate() {
        assert!(matches!(
            event.command,
            Command::Sustain { channel: 15, value: found } if found as usize == value
        ));
    }
}

#[test]
fn only_initial_reset_pairs_before_any_channel_key_activity_are_convertible() {
    let reset = vec![0xb0, 121, 0];
    let off = vec![0xb0, 64, 0];
    let mut cases = vec![
        vec![(1, reset.clone()), (0, off.clone())],
        vec![(0, reset.clone())],
        vec![(0, reset.clone()), (1, off.clone())],
        vec![(0, reset.clone()), (0, vec![0xb0, 7, 99]), (0, off.clone())],
        vec![(0, reset.clone()), (0, vec![0xc0, 40]), (0, off.clone())],
        vec![(0, reset.clone()), (0, reset.clone()), (0, off.clone())],
        vec![(0, reset.clone()), (0, vec![0xb1, 64, 0])],
    ];
    for value in [1, 63, 64, 127] {
        cases.push(vec![(0, reset.clone()), (0, vec![0xb0, 64, value])]);
        cases.push(vec![(0, vec![0xb0, 121, value]), (0, off.clone())]);
    }
    for activity in [
        vec![0x90, 60, 80],
        vec![0x90, 60, 0],
        vec![0x80, 60, 17],
        vec![0xa0, 60, 17],
    ] {
        cases.push(vec![
            (0, activity.clone()),
            (0, reset.clone()),
            (0, off.clone()),
        ]);
        cases.push(vec![
            (0, reset.clone()),
            (0, off.clone()),
            (0, activity),
            (0, reset.clone()),
            (0, off.clone()),
        ]);
    }
    for (index, mut events) in cases.into_iter().enumerate() {
        events.push((2, end()));
        assert!(
            convert_midi(&midi(vec![events], 24), "invalid-reset", "Invalid reset").is_err(),
            "malformed authored reset case {index}"
        );
    }
    let shared_channel = midi(
        vec![
            vec![(0, reset), (0, off), (2, end())],
            vec![(1, vec![0xb0, 7, 99]), (1, end())],
        ],
        24,
    );
    assert!(convert_midi(&shared_channel, "shared-reset", "Shared reset").is_err());
}

#[test]
fn decoder_revalidates_initial_reset_time_next_channel_event_and_prior_keys() {
    let score = converted(&initial_control_fixture());
    let reset = score
        .performance
        .events
        .iter()
        .position(|event| matches!(event.command, Command::InitialControllerReset { .. }))
        .unwrap();
    let off = score.performance.events[reset + 1..]
        .iter()
        .position(|event| event.command.channel() == Some(0))
        .unwrap()
        + reset
        + 1;
    let mut mutation = score.clone();
    mutation.performance.events[reset].at = Beat::new(1, 3);
    assert_decode_rejected(&mutation, "Initial controller reset");
    for command in [
        Command::Sustain {
            channel: 0,
            value: 1,
        },
        Command::Sustain {
            channel: 0,
            value: 63,
        },
        Command::Sustain {
            channel: 0,
            value: 64,
        },
        Command::Sustain {
            channel: 0,
            value: 127,
        },
        Command::Volume {
            channel: 0,
            value: 0,
        },
        Command::InstrumentProgram {
            channel: 0,
            program: 0,
        },
        Command::InitialControllerReset { channel: 0 },
    ] {
        let mut mutation = score.clone();
        mutation.performance.events[off].command = command;
        assert_decode_rejected(&mutation, "Initial controller reset");
    }
    for command in [
        Command::KeyAttack {
            part_id: part_id(1, 0),
            channel: 0,
            key: 60,
            velocity: 80,
        },
        Command::KeyRelease {
            part_id: part_id(1, 0),
            channel: 0,
            key: 60,
            velocity: 0,
        },
        Command::KeyPressure {
            channel: 0,
            key: 60,
            pressure: 17,
        },
    ] {
        let mut mutation = score.clone();
        mutation.performance.events[reset - 1].command = command;
        mutation.coverage = calculated_coverage(&mutation.performance);
        assert_decode_rejected(&mutation, "no prior key activity");
    }
    let mut mutation = score;
    mutation.performance.events[off].command = Command::Sustain {
        channel: 1,
        value: 0,
    };
    assert_decode_rejected(&mutation, "Initial controller reset");
}

#[test]
fn decoder_rejects_unmatched_late_and_shared_track_initial_resets() {
    let unmatched = midi(vec![vec![(0, vec![0xb0, 11, 47]), (1, end())]], 24);
    let mut score = converted(&unmatched);
    score.performance.events[0].command = Command::InitialControllerReset { channel: 0 };
    assert_decode_rejected(&score, "missing its explicit initial sustain-off");

    let late = midi(
        vec![vec![
            (1, vec![0xb0, 11, 47]),
            (0, vec![0xb0, 64, 0]),
            (1, end()),
        ]],
        24,
    );
    let mut score = converted(&late);
    score.performance.events[0].command = Command::InitialControllerReset { channel: 0 };
    assert_decode_rejected(&score, "requires beat 0");

    let shared = midi(
        vec![
            vec![(0, vec![0xb0, 11, 47]), (0, vec![0xb0, 64, 0]), (2, end())],
            vec![(1, vec![0xb0, 7, 99]), (1, end())],
        ],
        24,
    );
    let mut score = converted(&shared);
    score.performance.events[0].command = Command::InitialControllerReset { channel: 0 };
    assert_decode_rejected(&score, "one source track for the entire channel");
}

#[test]
fn new_control_json_remains_closed_and_seven_bit_bounded() {
    let score = converted(&initial_control_fixture());
    let mut json = serde_json::to_value(&score).unwrap();
    let events = json["performance"]["events"].as_array_mut().unwrap();
    let reset = events
        .iter()
        .position(|event| event["command"]["kind"] == "initial_controller_reset")
        .unwrap();
    events[reset]["command"]["value"] = serde_json::json!(1);
    assert!(decode_json(&serde_json::to_vec(&json).unwrap()).is_err());

    for command in [
        Command::Sustain {
            channel: 0,
            value: 128,
        },
        Command::Sustain {
            channel: 16,
            value: 0,
        },
        Command::InitialControllerReset { channel: 16 },
    ] {
        let mut mutation = score.clone();
        mutation.performance.events[reset].command = command;
        assert_decode_rejected(&mutation, "Invalid");
    }
    let text = String::from_utf8(encode_json(&score).unwrap()).unwrap();
    for (old, new) in [
        ("\"kind\":\"sustain\"", "\"kind\":\"sustain\",\"value\":1"),
        (
            "\"kind\":\"sustain\"",
            "\"kind\":\"sustain\",\"pressed\":true",
        ),
        (
            "\"kind\":\"initial_controller_reset\"",
            "\"kind\":\"controller_reset\"",
        ),
        (
            "\"kind\":\"initial_controller_reset\"",
            "\"kind\":\"initial_controller_reset\",\"raw\":[121,0]",
        ),
    ] {
        assert!(decode_json(text.replacen(old, new, 1).as_bytes()).is_err());
    }
}
#[test]
fn unknown_controller_bend_routing_system_and_project_data_hold_the_entire_source() {
    for event in [
        vec![0xb0, 1, 42],
        vec![0xb0, 121, 0],
        vec![0xb0, 121, 1],
        vec![0xe0, 0, 64],
        vec![255, 33, 1, 0],
        vec![255, 32, 1, 0],
        vec![240, 2, 1, 247],
        vec![255, 127, 1, 7],
        vec![255, 1, 5, b'D', b'M', b':', b'0', b'0'],
        vec![255, 1, 1, 255],
    ] {
        assert!(convert_midi(
            &midi(vec![vec![(0, event), (1, end())]], 24),
            "hold",
            "Hold"
        )
        .is_err());
    }
}
#[test]
fn strict_json_rejects_unknown_duplicate_raw_fields_and_false_coverage() {
    let score = converted(&fixture());
    let text = String::from_utf8(encode_json(&score).unwrap()).unwrap();
    assert!(decode_json(text.replacen("{", "{\"version\":2,", 1).as_bytes()).is_err());
    assert!(decode_json(text.replacen("{", "{\"raw\":[],", 1).as_bytes()).is_err());
    assert!(decode_json(
        text.replacen("\"kind\":\"key_attack\"", "\"kind\":\"raw_midi\"", 1)
            .as_bytes()
    )
    .is_err());
    let mut mutation = score.clone();
    mutation.coverage.performance.key_attacks -= 1;
    assert!(validate(&mutation).is_err());
    let mut mutation = score.clone();
    mutation.coverage.notation.represented_attacks = 1;
    assert!(validate(&mutation).is_err());
    let mut mutation = score.clone();
    mutation.performance.events[0].event_id.push('x');
    assert!(validate(&mutation).is_err());
    let mut mutation = score.clone();
    mutation.performance.events.remove(0);
    assert!(validate(&mutation).is_err());
    let mut mutation = score.clone();
    mutation.performance.parts.pop();
    assert!(validate(&mutation).is_err());
    let mut mutation = score.clone();
    mutation.performance.tracks.pop();
    assert!(validate(&mutation).is_err());
    let mut mutation = score.clone();
    mutation.performance.events.last_mut().unwrap().at = Beat::ZERO;
    assert!(validate(&mutation).is_err());
    let mut mutation = score;
    mutation.performance.events[0].origin.event = 1;
    assert!(validate(&mutation).is_err());
}
#[test]
fn key_event_must_keep_its_source_part_and_bounded_semantics() {
    for command in [
        Command::KeyAttack {
            part_id: "other".into(),
            channel: 0,
            key: 60,
            velocity: 99,
        },
        Command::KeyAttack {
            part_id: part_id(0, 0),
            channel: 0,
            key: 60,
            velocity: 0,
        },
        Command::KeyRelease {
            part_id: part_id(0, 0),
            channel: 0,
            key: 128,
            velocity: 0,
        },
    ] {
        let mut score = converted(&fixture());
        score
            .performance
            .events
            .iter_mut()
            .find(|e| matches!(e.command, Command::KeyAttack { .. }))
            .unwrap()
            .command = command;
        score.coverage = calculated_coverage(&score.performance);
        assert!(validate(&score).is_err());
    }
}
#[test]
fn ambiguous_cross_track_channel_order_and_tempo_are_held() {
    let same_route = midi(
        vec![
            vec![(0, vec![0x90, 60, 70]), (1, end())],
            vec![(0, vec![0xc0, 40]), (1, end())],
        ],
        24,
    );
    assert!(convert_midi(&same_route, "hold", "Hold").is_err());
    let tempo = midi(
        vec![
            vec![(0, vec![255, 81, 3, 7, 161, 32]), (1, end())],
            vec![(0, vec![255, 81, 3, 7, 161, 33]), (1, end())],
        ],
        24,
    );
    assert!(convert_midi(&tempo, "hold", "Hold").is_err());
}
#[test]
fn repeated_same_track_tempo_and_fractional_changes_use_exact_clock() {
    let input = midi(
        vec![vec![
            (0, vec![255, 81, 3, 7, 161, 33]),
            (1, vec![0x90, 60, 80]),
            (1, vec![255, 81, 3, 9, 39, 199]),
            (1, vec![0x80, 60, 0]),
            (0, end()),
        ]],
        3,
    );
    let runtime = compile_performance(&encode_json(&converted(&input)).unwrap()).unwrap();
    assert_eq!(runtime.events[1].exact_microseconds.numerator, "166667");
    assert_eq!(runtime.events[3].exact_microseconds.numerator, "1600009");
    assert_eq!(runtime.events[3].exact_microseconds.denominator, 3);
}

#[test]
fn json_cannot_hide_a_conflicting_same_tick_tempo_behind_an_equal_last_value() {
    let input = midi(
        vec![
            vec![
                (0, vec![255, 81, 3, 7, 161, 32]),
                (0, vec![255, 81, 3, 7, 161, 32]),
                (1, end()),
            ],
            vec![(0, vec![255, 81, 3, 7, 161, 32]), (1, end())],
        ],
        24,
    );
    let mut score = converted(&input);
    assert!(validate(&score).is_ok());
    // The final tempo on track zero still matches track one. The earlier
    // same-tick change makes their possible dispatch orders inequivalent.
    score.performance.events[0].command = Command::Tempo {
        microseconds_per_quarter: 500_001,
    };
    assert!(validate(&score).unwrap_err().contains("cross-track tempo"));
}

#[test]
fn every_declared_metadata_meaning_is_preserved_with_no_wire_payload() {
    let mut events = vec![(0, vec![255, 0, 0]), (0, vec![255, 0, 2, 1, 2])];
    for role in 1..=9 {
        events.push((0, vec![255, role, 3, b'a', b' ', b'z']));
    }
    events.extend([
        (0, vec![255, 89, 2, 249, 1]),
        (0, vec![255, 88, 4, 7, 3, 36, 8]),
        (1, end()),
    ]);
    let score = converted(&midi(vec![events], 24));
    assert_eq!(score.performance.events.len(), 14);
    assert_eq!(score.performance.tracks[0].name, "a z");
    assert!(matches!(
        score.performance.events[0].command,
        Command::SequenceNumber { number: None }
    ));
    assert!(matches!(
        score.performance.events[1].command,
        Command::SequenceNumber { number: Some(258) }
    ));
    assert!(matches!(
        score.performance.events[11].command,
        Command::KeySignature {
            fifths: -7,
            mode: KeyMode::Minor
        }
    ));
    assert!(matches!(
        score.performance.events[12].command,
        Command::Meter {
            numerator: 7,
            denominator: 8,
            clocks_per_click: 36,
            thirty_seconds_per_quarter: 8
        }
    ));
}

#[test]
fn percussion_high_keys_remain_exact_source_keys_and_programs() {
    let mut events = vec![(0, vec![0xc9, 118])];
    for key in [85, 86, 87] {
        events.extend([(1, vec![0x99, key, key]), (1, vec![0x89, key, 17])]);
    }
    events.push((1, end()));
    let bytes = midi(vec![events], 24);
    assert!(crate::clean_song::convert_midi(&bytes).is_err());
    assert!(crate::midi::import_midi(&bytes).is_err());
    let score = converted(&bytes);
    assert_eq!(score.coverage.performance.key_attacks, 3);
    for key in [85, 86, 87] {
        assert!(score.performance.events.iter().any(|event| matches!(event.command,
            Command::KeyAttack { key: found, channel: 9, velocity, .. } if found == key && velocity == key)));
    }
    assert!(matches!(
        score.performance.events[0].command,
        Command::InstrumentProgram {
            channel: 9,
            program: 118
        }
    ));
}

#[test]
fn semantic_profile_does_not_admit_other_versions_or_notation_claims() {
    let score = converted(&fixture());
    let bytes = encode_json(&score).unwrap();
    assert!(crate::clean_song::decode_json(&bytes).is_err());
    for version in [0, 1, 3] {
        let mut mutation = score.clone();
        mutation.version = version;
        assert!(validate(&mutation).is_err());
    }
    let mut mutation = score.clone();
    mutation.performance.profile = crate::clean_song::PROFILE.into();
    assert!(validate(&mutation).is_err());
    let mut mutation = score;
    mutation.source.sha256 = "f".repeat(64);
    assert!(validate(&mutation).is_err()); // coordinates retain the original hash
}

#[test]
fn nested_unknown_fields_duplicate_fields_and_unreviewed_text_are_rejected() {
    let bytes = encode_json(&converted(&fixture())).unwrap();
    let text = String::from_utf8(bytes).unwrap();
    for (old, new) in [
        (
            "\"kind\":\"key_attack\"",
            "\"kind\":\"key_attack\",\"duration\":1",
        ),
        (
            "\"kind\":\"key_attack\"",
            "\"kind\":\"key_attack\",\"key\":60",
        ),
        (
            "\"source_index\":0",
            "\"source_index\":0,\"source_file\":\"original.mid\"",
        ),
        (
            "\"format\":\"midi\"",
            "\"format\":\"midi\",\"base64\":\"AAAA\"",
        ),
    ] {
        assert!(decode_json(text.replacen(old, new, 1).as_bytes()).is_err());
    }
    for text in [
        "DM:0000".to_owned(),
        "a".repeat(257),
        "bad\0text".to_owned(),
    ] {
        let mut score = converted(&fixture());
        score.performance.events[0].command = Command::Text {
            role: TextRole::Text,
            text,
        };
        assert!(validate(&score).is_err());
    }
}

#[test]
fn track_and_clock_bounds_fail_closed_without_rounding_or_truncating() {
    let input = midi(vec![vec![(1, end())]], 24);
    let score = converted(&input);
    let mut mutation = score.clone();
    mutation.performance.tracks[0].source_event_count = u32::MAX;
    assert!(validate(&mutation).is_err());
    let mut mutation = score.clone();
    mutation.performance.events[0].at.denominator = 0;
    assert!(validate(&mutation).is_err());
    let mut mutation = score.clone();
    mutation.performance.events[0].command = Command::SequenceNumber { number: None };
    assert!(validate(&mutation).is_err());
    let mut mutation = score;
    let end = Beat::new(172_801, 1);
    mutation.performance.events[0].at = end;
    mutation.performance.tracks[0].end = end;
    mutation.performance.end = end;
    assert!(validate(&mutation).unwrap_err().contains("24-hour"));
}
