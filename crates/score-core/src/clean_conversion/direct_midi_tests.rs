//! Direct-import compatibility contracts shared with the native import bridge.
//! All fixtures are newly authored mechanical events, not private MIDI excerpts.
use super::*;
use crate::{
    automatic_assistance::{self, AssistanceSelection},
    basic_keys::{self, Coordinate, ReleaseStatus, RenditionEndReason},
    instruments::InstrumentProfile,
    practice_source::PracticeSource,
};
use serde::Serialize;

fn json(value: &(impl Serialize + ?Sized)) -> serde_json::Value {
    serde_json::to_value(value).unwrap()
}

fn vlq(mut value: u32, output: &mut Vec<u8>) {
    let mut buffer = [0_u8; 4];
    let mut index = 3;
    buffer[index] = (value & 127) as u8;
    while {
        value >>= 7;
        value != 0
    } {
        index -= 1;
        buffer[index] = (value & 127) as u8 | 128;
    }
    output.extend(&buffer[index..]);
}

fn event(track: &mut Vec<u8>, delta: u32, message: &[u8]) {
    vlq(delta, track);
    track.extend(message);
}

fn smf(tracks: &[Vec<u8>]) -> Vec<u8> {
    let mut bytes = b"MThd\0\0\0\x06".to_vec();
    bytes.extend((if tracks.len() == 1 { 0_u16 } else { 1 }).to_be_bytes());
    bytes.extend((tracks.len() as u16).to_be_bytes());
    bytes.extend(480_u16.to_be_bytes());
    for track in tracks {
        bytes.extend(b"MTrk");
        bytes.extend((track.len() as u32).to_be_bytes());
        bytes.extend(track);
    }
    bytes
}

fn overlap_track() -> Vec<u8> {
    let mut track = vec![];
    for message in [
        &[255, 3, 8, b'A', b'u', b't', b'h', b'o', b'r', b'e', b'd'][..],
        &[255, 88, 4, 4, 2, 24, 8],
        &[255, 81, 3, 6, 26, 129], // Deliberately non-round 400001 us/quarter.
        &[0xc0, 0],
        &[0x90, 60, 81],
    ] {
        event(&mut track, 0, message);
    }
    // Reattack precedes a release at the same tick. Reordering these events
    // would invent unique source ownership and change the meaning of the file.
    event(&mut track, 480, &[0x90, 60, 97]);
    event(&mut track, 0, &[0x80, 60, 15]);
    event(&mut track, 240, &[0x80, 60, 23]);
    event(&mut track, 240, &[0x90, 47, 75]);
    event(&mut track, 0, &[0x90, 91, 88]);
    event(&mut track, 480, &[0x80, 47, 11]);
    event(&mut track, 0, &[0x80, 91, 12]);
    event(&mut track, 480, &[255, 47, 0]); // Retain the complete trailing silence.
    track
}

fn fixture() -> Vec<u8> {
    smf(&[overlap_track()])
}

fn prepared(bytes: &[u8]) -> Draft {
    prepare_basic_keys(bytes, "Authored direct MIDI compatibility", "authored.mid").unwrap()
}

fn score(draft: &Draft) -> basic_keys::CompleteBasicKeys {
    assert_eq!(
        draft.state,
        State::BasicKeyCandidate,
        "{:?}",
        draft.diagnostics
    );
    basic_keys::decode_json(draft.package.as_ref().unwrap().score_json.as_bytes()).unwrap()
}

fn piano(key_count: u8) -> InstrumentProfile {
    InstrumentProfile::Piano {
        key_count,
        lowest_midi: None,
    }
}

#[test]
fn same_tick_reattack_keeps_strict_rejection_and_all_basic_fifo_targets() {
    let bytes = fixture();
    let original = bytes.clone();
    let error = crate::import_midi(&bytes).unwrap_err();
    assert!(error.contains("Ambiguous overlapping MIDI note-ons"));
    assert!(crate::clean_song::convert_midi(&bytes).is_err());
    // The explicit source-rendition authoring intent also remains unchanged.
    assert_eq!(
        prepare_midi(&bytes, "Authored overlap", "authored.mid")
            .unwrap()
            .state,
        State::EventOnlyReferenceCandidate
    );

    let draft = prepared(&bytes);
    let score = score(&draft);
    let before = json(&score);
    assert_eq!(score.source.sha256, hash(&bytes));
    assert_eq!(score.source.bytes, bytes.len());
    assert_eq!(score.coverage.source_tracks, 1);
    assert_eq!(score.coverage.source_events, 13);
    assert_eq!(score.coverage.represented_events, 13);
    assert_eq!(score.coverage.key_attacks, 4);
    assert_eq!(score.coverage.key_releases, 4);
    assert_eq!(score.coverage.determined_ends, 2);
    assert_eq!(score.coverage.unresolved_ends, 2);
    assert_eq!(score.coverage.projected_melodic_targets, 2);
    assert_eq!(score.performance.end_tick, 1920);
    for note in &score.performance.notes[..2] {
        assert!(note.end.is_none());
        assert_eq!(note.release.status, ReleaseStatus::AmbiguousReleaseTime);
        assert_eq!(note.release.candidate_count, 2);
    }

    let view = basic_keys::compile_rendition(&score).unwrap();
    assert_eq!(view.rendition.policy_id, basic_keys::RENDITION_POLICY);
    assert!(view
        .diagnostics
        .iter()
        .any(|d| d.code == "basic_key_rendition_interpretation"));
    assert_eq!(view.timeline.notes.len(), 4);
    assert_eq!(view.rendition.coverage.source_attacks, 4);
    assert_eq!(view.rendition.coverage.practice_targets, 4);
    assert_eq!(view.rendition.coverage.paired_releases, 4);
    assert_eq!(view.rendition.coverage.source_events, 13);
    assert_eq!(view.rendition.coverage.source_proved_ends, 2);
    assert_eq!(view.rendition.coverage.unmatched_releases, 0);
    assert_eq!(view.rendition.coverage.source_end_cleanups, 0);
    assert_eq!(view.rendition.coverage.synthetic_gates, 0);
    for (index, tick) in [480, 720].into_iter().enumerate() {
        let note = &view.rendition.notes[index];
        assert_eq!(
            note.attack,
            Coordinate {
                track: 0,
                event: index as u32 + 4
            }
        );
        assert_eq!(
            note.release,
            Some(Coordinate {
                track: 0,
                event: index as u32 + 6
            })
        );
        assert_eq!(
            note.source_release_status,
            ReleaseStatus::AmbiguousReleaseTime
        );
        assert_eq!(note.source_end_tick, None);
        assert_eq!(note.receiver_end_tick, tick);
        assert_eq!(note.end_reason, RenditionEndReason::FifoRelease);
        assert!(!note.synthetic_gate);
    }
    assert_eq!(view.rendition.notes[0].end.numerator, "400001");
    assert_eq!(view.rendition.notes[0].end.denominator, 1);
    assert_eq!(view.rendition.notes[1].start.numerator, "400001");
    assert_eq!(view.rendition.notes[1].end.numerator, "1200003");
    assert_eq!(view.rendition.notes[1].end.denominator, 2);
    assert_eq!(view.timeline.duration_ms, 1600.004);
    assert_eq!(json(&score), before);
    assert_eq!(bytes, original);
}

#[test]
fn compact_reload_rebuilds_identical_complete_practice_and_scores_every_attack() {
    let draft = prepared(&fixture());
    let saved = draft.package.as_ref().unwrap().score_json.as_bytes();
    let first = basic_keys::decode_json(saved).unwrap();
    let reopened = basic_keys::decode_json(&basic_keys::encode_json(&first).unwrap()).unwrap();
    assert_eq!(basic_keys::encode_json(&reopened).unwrap(), saved);
    let source = PracticeSource::from_basic(&first).unwrap();
    let restarted = PracticeSource::from_basic(&reopened).unwrap();
    assert_eq!(source.receipt(), restarted.receipt());
    assert_eq!(
        source.receipt().runtime_policy,
        basic_keys::RENDITION_POLICY
    );
    assert_eq!(json(source.timeline()), json(restarted.timeline()));
    assert_eq!(json(source.source_units()), json(restarted.source_units()));
    assert_eq!(restarted.source_units().len(), 4);

    for runtime in [&source, &restarted] {
        let selection = AssistanceSelection {
            selected_part_ids: runtime.part_ids().to_vec(),
            profile: piano(61),
        };
        let practice = automatic_assistance::original(runtime, &selection).unwrap();
        assert!(practice.scored_mode_allowed);
        assert!(practice.all_selected_human);
        assert_eq!(practice.coverage.human_source_unit_count, 4);
        assert_eq!(practice.human_targets.target_count, 4);
        let inputs = practice
            .human_targets
            .timeline
            .notes
            .iter()
            .map(|note| crate::InputEvent {
                midi: note.midi,
                at_ms: note.start_ms,
                velocity: note.velocity,
            })
            .collect::<Vec<_>>();
        let result = crate::assess(&practice.human_targets.timeline, &inputs, 80.0).unwrap();
        assert_eq!(result.summary.expected_notes, 4);
        assert_eq!(result.summary.matched_notes, 4);
        assert!(result.misses.is_empty());
        assert!(result.extras.is_empty());
    }
}

#[test]
fn keyboard_range_is_separate_from_compatibility_and_never_removes_attacks() {
    let score = score(&prepared(&fixture()));
    let source = PracticeSource::from_basic(&score).unwrap();
    let original = json(source.timeline());
    let narrow = crate::targets::plan_targets(source.timeline(), &piano(49)).unwrap();
    assert!(!narrow.playable);
    assert_eq!(narrow.source_note_count, 4);
    assert_eq!(narrow.target_count, 4);
    assert!(narrow
        .diagnostics
        .iter()
        .any(|d| d.code == "instrument_range"));
    let wider = crate::targets::plan_targets(source.timeline(), &piano(61)).unwrap();
    assert!(wider.playable);
    assert_eq!(wider.target_count, 4);
    assert_eq!(json(source.timeline()), original);
    assert_eq!(
        source
            .timeline()
            .notes
            .iter()
            .map(|note| note.midi)
            .collect::<Vec<_>>(),
        [60, 60, 47, 91]
    );
}

#[test]
fn multitrack_fallback_retains_control_metadata_and_every_part_before_compiling() {
    let mut other = vec![];
    for message in [
        &[255, 3, 2, 0xff, 0xfe][..], // Preserve non-UTF8 source text.
        &[255, 0x7f, 2, 0x7d, 0x01],
        &[0xb1, 64, 127],
        &[0xe1, 1, 64],
        &[0xf0, 3, 0x7d, 0x01, 0xf7],
        &[0x91, 67, 95],
    ] {
        event(&mut other, 0, message);
    }
    event(&mut other, 960, &[0x81, 67, 27]);
    event(&mut other, 960, &[255, 47, 0]);
    let bytes = smf(&[overlap_track(), other]);
    assert!(crate::import_midi(&bytes).is_err());
    let draft = prepared(&bytes);
    let score = score(&draft);
    assert_eq!(score.coverage.source_tracks, 2);
    assert_eq!(score.coverage.source_events, 21);
    assert_eq!(score.coverage.represented_events, 21);
    assert_eq!(score.coverage.key_attacks, 5);
    assert_eq!(score.performance.parts.len(), 2);
    assert_eq!(score.performance.tracks[0].events.len(), 13);
    assert_eq!(score.performance.tracks[1].events.len(), 8);
    let messages = score.performance.tracks[1]
        .events
        .iter()
        .map(|e| e.1.clone())
        .collect::<Vec<_>>();
    assert_eq!(
        messages,
        vec![
            vec![255, 3, 255, 254],
            vec![255, 127, 0x7d, 1],
            vec![0xb1, 64, 127],
            vec![0xe1, 1, 64],
            vec![0xf0, 0x7d, 1, 0xf7],
            vec![0x91, 67, 95],
            vec![0x81, 67, 27],
            vec![255, 47],
        ]
    );
    let encoded = basic_keys::encode_json(&score).unwrap();
    let reopened = basic_keys::decode_json(&encoded).unwrap();
    assert_eq!(json(&reopened), json(&score));
    let view = basic_keys::compile_rendition(&reopened).unwrap();
    assert_eq!(view.timeline.notes.len(), 5);
    assert_eq!(view.rendition.coverage.source_events, 21);
    assert_eq!(view.rendition.coverage.uninterpreted_controller_events, 1);
    assert_eq!(view.rendition.coverage.uninterpreted_pitch_bend_events, 1);
    assert_eq!(view.rendition.coverage.uninterpreted_sysex_events, 1);
    assert_eq!(view.rendition.coverage.practice_targets, 5);
    assert_eq!(basic_keys::encode_json(&reopened).unwrap(), encoded);
}

#[test]
fn complete_fallback_keeps_structural_and_projection_validation_closed() {
    let valid = fixture();
    let mut invalid = vec![b"not midi".to_vec(), valid[..valid.len() - 1].to_vec()];
    for (offset, value) in [(9, 2), (11, 2), (12, 0x80)] {
        let mut bytes = valid.clone();
        bytes[offset] = value;
        invalid.push(bytes);
    }
    let mut zero_ppq = valid.clone();
    zero_ppq[12..14].copy_from_slice(&[0, 0]);
    invalid.push(zero_ppq);
    for bytes in invalid {
        assert!(crate::import_midi(&bytes).is_err());
        let draft = prepared(&bytes);
        assert_eq!(draft.state, State::Rejected);
        assert!(draft.package.is_none());
        assert!(draft.draft_sha256.is_none());
    }

    let draft = prepared(&valid);
    let package = &draft.package.unwrap().score_json;
    let mut omitted_event: serde_json::Value = serde_json::from_str(package).unwrap();
    omitted_event["performance"]["tracks"][0]["events"]
        .as_array_mut()
        .unwrap()
        .remove(5);
    assert!(basic_keys::decode_json(&serde_json::to_vec(&omitted_event).unwrap()).is_err());
    let mut false_coverage: serde_json::Value = serde_json::from_str(package).unwrap();
    false_coverage["coverage"]["unresolved_ends"] = serde_json::json!(0);
    assert!(basic_keys::decode_json(&serde_json::to_vec(&false_coverage).unwrap()).is_err());
}
