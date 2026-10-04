use super::*;

fn bend(value: u16, channel: u8) -> Vec<u8> {
    vec![0xe0 | channel, (value & 127) as u8, (value >> 7) as u8]
}

#[test]
fn retained_bends_preserve_all_bits_coordinates_and_native_fractional_times() {
    let values = [0, 1, 8191, 8192, 8193, 16383, 16383];
    let mut events = vec![(0, vec![0x90, 60, 90]), (1, vec![0xb0, 64, 127])];
    events.extend(values.iter().map(|value| (1, bend(*value, 0))));
    events.extend([
        (1, vec![0x80, 60, 17]),
        (1, bend(4096, 0)),
        (1, vec![0x90, 64, 80]),
        (1, vec![0x80, 64, 0]),
        (1, vec![0xb0, 64, 0]),
        (1, end()),
    ]);
    for ppq in [3, 7, 480] {
        let input = midi(vec![events.clone()], ppq);
        let score = converted(&input);
        assert_source_runtime(&input, &score);
        assert!(score.notation.is_none());
        assert_eq!(score.coverage.targets.represented_attacks, 0);
        assert!(crate::clean_song::convert_midi(&input).is_err());
        assert!(crate::midi::import_midi(&input).is_err());
        let actual: Vec<_> = score
            .performance
            .events
            .iter()
            .filter_map(|e| match e.command {
                Command::PitchBend { value, channel: 0 } => Some(value),
                _ => None,
            })
            .collect();
        assert_eq!(actual, [0, 1, 8191, 8192, 8193, 16383, 16383, 4096]);
        let mut bad = score.clone();
        bad.performance.events[2].command = Command::PitchBend {
            channel: 0,
            value: 16384,
        };
        assert_decode_rejected(&bad, "Invalid or unsupported typed performance command");
        let bytes = encode_json(&score).unwrap();
        let text = String::from_utf8(bytes).unwrap();
        for replacement in ["\"value\":-1", "\"value\":0.5", "\"value\":0,\"raw\":[0,0]"] {
            assert!(decode_json(text.replacen("\"value\":0", replacement, 1).as_bytes()).is_err());
        }
    }
}

#[test]
fn bends_after_all_reviewed_twelve_setups_keep_every_duplicate_and_strict_stays_held() {
    for sequence in sensitivity12_sequences() {
        let mut events = sensitivity12_steps(&sequence, 0);
        events.extend([
            (1, vec![0x90, 60, 90]),
            (1, bend(12288, 0)),
            (1, vec![0x80, 60, 0]),
            (1, end()),
        ]);
        let input = midi(vec![events], 7);
        let score = converted(&input);
        assert_source_runtime(&input, &score);
        assert_eq!(
            score
                .performance
                .events
                .iter()
                .filter(|event| matches!(
                    event.command,
                    Command::InitialPitchBendSensitivity12 { .. }
                ))
                .count(),
            sequence.len()
        );
        assert!(crate::clean_song::convert_midi(&input).is_err());
    }
    // Center is retained as its own event; strict-practice expansion is separate.
    let centered = midi(
        vec![vec![
            (0, bend(8192, 0)),
            (1, vec![0x90, 67, 90]),
            (1, vec![0x80, 67, 0]),
            (1, end()),
        ]],
        7,
    );
    assert_source_runtime(&centered, &converted(&centered));
    assert!(crate::clean_song::convert_midi(&centered).is_err());
    assert!(crate::midi::import_midi(&centered).is_err());
}

#[test]
fn bend_range_and_track_ownership_do_not_broaden_rpn_reset_or_routing() {
    for controllers in [
        vec![(101, 0), (100, 0), (6, 24), (38, 0), (101, 127), (100, 127)],
        vec![(100, 0), (101, 0), (6, 2), (38, 0)],
        vec![(99, 0), (98, 0), (6, 12), (38, 0)],
    ] {
        let mut events: Vec<_> = controllers
            .into_iter()
            .map(|(cc, value)| (0, vec![0xb0, cc, value]))
            .collect();
        events.extend([
            (1, vec![0x90, 60, 90]),
            (1, bend(0, 0)),
            (1, vec![0x80, 60, 0]),
            (1, end()),
        ]);
        assert!(convert_midi(&midi(vec![events], 7), "held", "Held range").is_err());
    }
    let shared = midi(
        vec![
            vec![(0, bend(8192, 0)), (10, end())],
            vec![(1, vec![0x90, 60, 90]), (1, vec![0x80, 60, 0]), (8, end())],
        ],
        7,
    );
    assert!(convert_midi(&shared, "held", "Shared channel")
        .unwrap_err()
        .contains("one owning source track"));
    // A bend before an existing valid initial reset is centered by the receiver;
    // all commands remain, and no active-key or late reset is newly admitted.
    let initial = midi(
        vec![vec![
            (0, bend(16383, 0)),
            (0, vec![0xb0, 121, 0]),
            (0, vec![0xb0, 64, 0]),
            (1, vec![0x90, 60, 90]),
            (1, vec![0x80, 60, 0]),
            (1, end()),
        ]],
        7,
    );
    assert_source_runtime(&initial, &converted(&initial));
    for start in [vec![(0, vec![0x90, 60, 90])], vec![(1, bend(8192, 0))]] {
        let mut events = start;
        events.extend([(0, vec![0xb0, 121, 0]), (0, vec![0xb0, 64, 0]), (1, end())]);
        assert!(convert_midi(&midi(vec![events], 7), "held", "Held reset").is_err());
    }
}
