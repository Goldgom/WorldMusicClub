use super::*;

// Original mechanical event fixtures, never a melody or imported transcription.
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
    let mut result = vec![];
    for (delta, event) in events {
        result.push(*delta);
        result.extend(*event);
    }
    result.extend([0, 255, 47, 0]);
    result
}
fn convert(tracks: &[Vec<u8>]) -> CompleteBasicKeys {
    convert_midi(&smf(tracks), "Original fixture").unwrap()
}

#[test]
fn full_events_survive_unsupported_sound_and_byte_text() {
    let source = track(&[
        (0, &[255, 3, 2, 0xff, 0xfe]),
        (0, &[0xb0, 0, 121]),
        (0, &[0xc0, 77]),
        (0, &[0xf0, 3, 0x7d, 0x01, 0xf7]),
        (0, &[0x90, 60, 90]),
        (1, &[0xb0, 64, 127]),
        (1, &[0xb0, 123, 0]),
        (1, &[0x80, 60, 41]),
        (1, &[0xf7, 2, 0x12, 0x34]),
    ]);
    let score = convert(std::slice::from_ref(&source));
    assert_eq!(score.coverage.key_attacks, 1);
    assert_eq!(score.coverage.notation_notes, 1);
    assert_eq!(score.performance.notes[0].end.as_ref().unwrap().tick, 3);
    assert_eq!(score.performance.tracks[0].events[0].1, [255, 3, 255, 254]);
    let wire = encode_json(&score).unwrap();
    assert!(
        serde_json::from_slice::<serde_json::Value>(&wire).unwrap()["performance"]
            .get("notes")
            .is_none()
    );
    let decoded = decode_json(&wire).unwrap();
    assert_eq!(decoded.performance.notes.len(), 1);
    assert_eq!(encode_json(&decoded).unwrap(), wire);
    assert!(decoded.notation.source.is_none());
}

#[test]
fn overlap_proves_only_equal_time_ends_including_later_attacks() {
    let score = convert(&[track(&[
        (0, &[0x90, 60, 90]),
        (1, &[0x90, 60, 91]),
        (1, &[0x80, 60, 0]),
        (1, &[0x90, 60, 92]),
        (1, &[0x80, 60, 0]),
        (0, &[0x90, 60, 0]),
    ])]);
    assert_eq!(score.coverage.unresolved_ends, 2);
    assert_eq!(score.coverage.notation_notes, 1);
    assert_eq!(score.performance.notes[2].end.as_ref().unwrap().tick, 4);
    assert_eq!(
        score.performance.notes[2].release.status,
        ReleaseStatus::EquivalentReleaseTime
    );
    assert_eq!(score.performance.notes[2].release.candidate_count, 2);
}

#[test]
fn zero_duration_orphan_and_open_notes_are_retained() {
    let score = convert(&[track(&[
        (0, &[0x80, 60, 0]),
        (0, &[0x90, 60, 90]),
        (0, &[0x80, 60, 0]),
        (1, &[0x90, 60, 90]),
        (1, &[0x90, 60, 90]),
        (1, &[0x80, 60, 0]),
        (1, &[0x90, 60, 90]),
    ])]);
    assert_eq!(score.coverage.key_attacks, 4);
    assert_eq!(score.coverage.zero_length_attacks, 1);
    assert_eq!(score.coverage.unmatched_releases, 1);
    assert_eq!(score.coverage.unresolved_ends, 3);
    assert_eq!(score.coverage.notation_notes, 0);
    assert_eq!(score.performance.notes[0].end.as_ref().unwrap().tick, 0);
    assert_eq!(
        score.performance.notes[1].release.status,
        ReleaseStatus::PossiblyUnreleased
    );
    assert_eq!(
        score.performance.notes[3].release.status,
        ReleaseStatus::MissingRelease
    );
}

#[test]
fn shared_channels_use_whole_source_order_and_declared_routes() {
    let score = convert(&[
        track(&[(0, &[0x90, 60, 90])]),
        track(&[(5, &[0x80, 60, 0])]),
    ]);
    assert_eq!(score.coverage.determined_ends, 1);
    assert_eq!(score.performance.parts.len(), 2);
    assert_eq!(
        score.performance.notes[0].release.first,
        Some(Coordinate { track: 1, event: 0 })
    );
    let ambiguous = convert(&[
        track(&[(0, &[0x90, 60, 90]), (5, &[0x80, 60, 0])]),
        track(&[
            (0, &[255, 33, 1, 0]),
            (1, &[0x90, 60, 90]),
            (5, &[0x80, 60, 0]),
        ]),
    ]);
    assert_eq!(ambiguous.coverage.unresolved_route_ends, 2);
    assert_eq!(ambiguous.coverage.notation_notes, 0);
    let distinct = convert(&[
        track(&[
            (0, &[255, 33, 1, 0]),
            (0, &[0x90, 60, 90]),
            (5, &[0x80, 60, 0]),
        ]),
        track(&[
            (0, &[255, 33, 1, 1]),
            (1, &[0x90, 60, 90]),
            (5, &[0x80, 60, 0]),
        ]),
    ]);
    assert_eq!(distinct.coverage.determined_ends, 2);
}

#[test]
fn clock_meter_and_percussion_are_independent_capabilities() {
    let score = convert(&[track(&[
        (0, &[0x90, 60, 90]),
        (0, &[0x99, 38, 80]),
        (96, &[0x80, 60, 0]),
        (0, &[0x89, 38, 0]),
    ])]);
    assert!(score.notation.tempo.is_empty());
    assert!(score.notation.meters.is_empty());
    assert!(score.performance.timing.smf_default_tempo_used);
    assert_eq!(
        score.performance.notes[0]
            .end
            .as_ref()
            .unwrap()
            .relative_microseconds
            .as_ref()
            .unwrap()
            .numerator,
        "500000"
    );
    assert_eq!(score.coverage.notation_notes, 2);
    assert_eq!(score.coverage.projected_melodic_targets, 1);
    let compiled = compile_practice(&score).unwrap().unwrap();
    assert_eq!(compiled.timeline.notes.len(), 1);
    assert_eq!(compiled.score.parts.len(), 2);
    let conflicting = convert(&[
        track(&[
            (0, &[255, 81, 3, 7, 161, 32]),
            (0, &[0x90, 60, 90]),
            (96, &[0x80, 60, 0]),
        ]),
        track(&[(0, &[255, 81, 3, 6, 26, 128])]),
    ]);
    assert_eq!(conflicting.coverage.determined_ends, 1);
    assert!(!conflicting.performance.timing.relative_clock_available);
    assert!(compile_practice(&conflicting).unwrap().is_none());
}

#[test]
fn compatibility_is_explicit_and_strict_import_does_not_change() {
    let legacy = smf(&[track(&[
        (0, &[0x90, 60, 90]),
        (1, &[255, 88, 4, 4, 2, 24, 8]),
        (1, &[60, 0]),
    ])]);
    assert!(midi_events::parse_midi_events(&legacy, None).is_err());
    let score = convert_midi(&legacy, "Legacy fixture").unwrap();
    assert_eq!(score.performance.timing.legacy_running_status_events, 1);
    assert_eq!(score.coverage.determined_ends, 1);
    assert!(score.performance.tracks[0].events[2].2);
    decode_json(&encode_json(&score).unwrap()).unwrap();
    let malformed = smf(&[track(&[
        (0, &[0xc0, 128]),
        (0, &[0x90, 60, 90]),
        (1, &[0x80, 60, 0]),
    ])]);
    assert!(midi_events::parse_midi_events(&malformed, None).is_err());
    let score = convert_midi(&malformed, "Malformed program fixture").unwrap();
    assert_eq!(score.performance.timing.invalid_program_events, 1);
    assert_eq!(score.performance.tracks[0].events[0].1, [192, 128]);
    assert_eq!(score.coverage.determined_ends, 1);
    decode_json(&encode_json(&score).unwrap()).unwrap();
    let bad_note = smf(&[track(&[(0, &[0x90, 128, 90]), (1, &[0x80, 60, 0])])]);
    assert!(convert_midi(&bad_note, "Invalid key fixture").is_err());
}

#[test]
fn derived_claims_and_compact_event_corruption_are_rejected() {
    let mut score = convert(&[track(&[(0, &[0x90, 60, 90]), (1, &[0x80, 60, 0])])]);
    score.performance.notes[0].end.as_mut().unwrap().tick += 1;
    assert!(validate(&score).is_err());
    let score = convert(&[track(&[(0, &[0x90, 60, 90]), (1, &[0x80, 60, 0])])]);
    let mut wire: serde_json::Value =
        serde_json::from_slice(&encode_json(&score).unwrap()).unwrap();
    wire["coverage"]["key_attacks"] = serde_json::json!(0);
    assert!(decode_json(&serde_json::to_vec(&wire).unwrap()).is_err());
    let mut wire: serde_json::Value =
        serde_json::from_slice(&encode_json(&score).unwrap()).unwrap();
    wire["performance"]["notes"] = serde_json::json!([]);
    assert!(decode_json(&serde_json::to_vec(&wire).unwrap()).is_err());
}

fn exhaustive(attack_word: &[bool]) -> Vec<BTreeSet<Option<usize>>> {
    // Each state is a complete partial ownership assignment. The oracle makes
    // every available release choice; it never uses the production component
    // rule. Short exhaustive streams deliberately use event-ordinal tick times.
    let attack_count = attack_word.iter().filter(|a| **a).count();
    let mut states = BTreeSet::from([(Vec::<usize>::new(), vec![None; attack_count])]);
    let mut next_attack = 0;
    for (ordinal, &is_attack) in attack_word.iter().enumerate() {
        let mut next = BTreeSet::new();
        for (active, ends) in states {
            if is_attack {
                let mut active = active;
                active.push(next_attack);
                next.insert((active, ends));
            } else if active.is_empty() {
                next.insert((active, ends));
            } else {
                for &owner in &active {
                    let mut ends = ends.clone();
                    ends[owner] = Some(ordinal);
                    let active = active
                        .iter()
                        .copied()
                        .filter(|index| *index != owner)
                        .collect();
                    next.insert((active, ends));
                }
            }
        }
        if is_attack {
            next_attack += 1;
        }
        states = next;
    }
    let mut result = vec![BTreeSet::new(); attack_count];
    for (_, ends) in states {
        for (i, end) in ends.into_iter().enumerate() {
            result[i].insert(end);
        }
    }
    result
}

#[test]
fn component_algorithm_matches_exhaustive_ownership_assignments() {
    for len in 0..=10 {
        for mask in 0..(1usize << len) {
            let word: Vec<_> = (0..len).map(|i| mask & (1 << i) != 0).collect();
            let expected = exhaustive(&word);
            let mut bytes = vec![];
            for (i, &attack) in word.iter().enumerate() {
                bytes.extend([
                    if i == 0 { 0 } else { 1 },
                    if attack { 0x90 } else { 0x80 },
                    60,
                    if attack { 90 } else { 0 },
                ]);
            }
            bytes.extend([0, 255, 47, 0]);
            let result = convert(&[bytes]);
            assert_eq!(result.performance.notes.len(), expected.len());
            for (note, possible) in result.performance.notes.iter().zip(expected) {
                let exact = if possible.len() == 1 {
                    possible.iter().next().unwrap().map(|time| time as u64)
                } else {
                    None
                };
                assert_eq!(note.end.as_ref().map(|at| at.tick), exact, "word {word:?}");
                assert_eq!(
                    note.release.candidate_count,
                    possible.iter().filter(|end| end.is_some()).count()
                );
                assert_eq!(note.release.may_be_unreleased, possible.contains(&None));
            }
        }
    }
}

#[test]
fn large_original_projection_fits_receiver_without_dropping_notes() {
    let mut events = Vec::new();
    for _ in 0..41_900 {
        events.extend([1, 0x90, 60, 90, 1, 0x80, 60, 0]);
    }
    events.extend([0, 255, 47, 0]);
    let score = convert(&[events]);
    let encoded = encode_json(&score).unwrap();
    assert_eq!(score.coverage.key_attacks, 41_900);
    assert_eq!(score.coverage.notation_notes, 41_900);
    assert!(encoded.len() < MAX_JSON_BYTES);
    eprintln!("41900 original attacks encode to {} bytes", encoded.len());
}

#[test]
fn route_invariant_end_requires_balanced_orphan_free_streams() {
    // Sequential uses of an unspecified and explicit default destination can
    // have a single end under both split and merged route assignments.
    let score = convert(&[
        track(&[(0, &[0x90, 60, 90]), (2, &[0x80, 60, 0])]),
        track(&[
            (0, &[255, 33, 1, 0]),
            (3, &[0x90, 60, 90]),
            (2, &[0x80, 60, 0]),
        ]),
    ]);
    assert_eq!(score.coverage.determined_ends, 2);
    assert_eq!(score.coverage.unresolved_route_ends, 0);
    assert!(score
        .performance
        .notes
        .iter()
        .all(|note| note.release.status == ReleaseStatus::RouteInvariantReleaseTime));
    // An orphan on one declaration may consume another declaration's attack
    // when routes alias. The split stream is not a subset of the merged rule.
    let orphan = convert(&[
        track(&[(0, &[0x90, 60, 90]), (3, &[0x80, 60, 0])]),
        track(&[(0, &[255, 33, 1, 0]), (1, &[0x80, 60, 0])]),
    ]);
    assert_eq!(orphan.coverage.unresolved_route_ends, 1);
    assert!(orphan.performance.notes[0].end.is_none());
    // An open declaration also breaks the balanced sufficient condition.
    let open = convert(&[
        track(&[(0, &[0x90, 60, 90]), (3, &[0x80, 60, 0])]),
        track(&[(0, &[255, 33, 1, 0]), (1, &[0x90, 60, 90])]),
    ]);
    assert_eq!(open.coverage.unresolved_route_ends, 2);
}

#[test]
fn route_invariance_matches_exhaustive_partitions_and_owners() {
    let mut cases = 0;
    // Four symbols A0/R0/A1/R1. The two legal route partitions (separate or
    // aliased default/port0) and all ownership choices are independently
    // enumerated for every balanced, orphan-free word through length six.
    for len in 2..=6 {
        for mask in 0..4usize.pow(len) {
            let symbols: Vec<_> = (0..len).map(|i| (mask >> (2 * i)) & 3).collect();
            let mut held = [0usize; 2];
            let mut valid = true;
            let mut seen = [false; 2];
            for &symbol in &symbols {
                let route = symbol / 2;
                seen[route] = true;
                if symbol % 2 == 0 {
                    held[route] += 1;
                } else if held[route] == 0 {
                    valid = false;
                    break;
                } else {
                    held[route] -= 1;
                }
            }
            if !valid || held != [0, 0] || seen != [true, true] {
                continue;
            }
            cases += 1;
            let word: Vec<_> = symbols.iter().map(|symbol| symbol % 2 == 0).collect();
            let merged = exhaustive(&word);
            let mut split = vec![BTreeSet::new(); merged.len()];
            let attack_ordinals: Vec<_> = word
                .iter()
                .enumerate()
                .filter_map(|(i, a)| a.then_some(i))
                .collect();
            for route in 0..2 {
                let ordinals: Vec<_> = symbols
                    .iter()
                    .enumerate()
                    .filter_map(|(i, s)| (*s / 2 == route).then_some(i))
                    .collect();
                let local: Vec<_> = ordinals.iter().map(|&i| word[i]).collect();
                let assignments = exhaustive(&local);
                let local_attacks: Vec<_> = ordinals.iter().copied().filter(|&i| word[i]).collect();
                for (attack, owners) in local_attacks.into_iter().zip(assignments) {
                    let index = attack_ordinals.iter().position(|i| *i == attack).unwrap();
                    split[index] = owners
                        .into_iter()
                        .map(|owner| owner.map(|i| ordinals[i]))
                        .collect();
                }
            }
            let mut tracks = vec![vec![], vec![0, 255, 33, 1, 0]];
            let mut last = [0; 2];
            for (tick, &symbol) in symbols.iter().enumerate() {
                let route = symbol / 2;
                tracks[route].extend([
                    (tick - last[route]) as u8,
                    if symbol % 2 == 0 { 0x90 } else { 0x80 },
                    60,
                    if symbol % 2 == 0 { 90 } else { 0 },
                ]);
                last[route] = tick;
            }
            for track in &mut tracks {
                track.extend([0, 255, 47, 0]);
            }
            let score = convert(&tracks);
            for (index, note) in score.performance.notes.iter().enumerate() {
                let possible: BTreeSet<_> = split[index].union(&merged[index]).copied().collect();
                let expected = if possible.len() == 1 {
                    possible.iter().next().unwrap().map(|i| i as u64)
                } else {
                    None
                };
                assert_eq!(
                    note.end.as_ref().map(|end| end.tick),
                    expected,
                    "symbols {symbols:?} attack {index}"
                );
            }
        }
    }
    assert!(cases > 50);
}
