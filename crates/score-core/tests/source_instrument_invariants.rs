//! Independent black-box source evidence invariants. Mechanical fixtures contain
//! no third-party score content. Disclosure is observational, never eligibility.
use score_core::{
    basic_keys, compile, import_midi,
    pitch_projection::PitchProjection,
    practice_source::PracticeSource,
    source_instrument::{describe_basic, describe_canonical_midi, SelectionStatus},
    Score,
};
use serde::Serialize;

fn wire(value: &impl Serialize) -> Vec<u8> {
    serde_json::to_vec(value).unwrap()
}

fn midi(events: &[(u8, &[u8])]) -> Vec<u8> {
    let mut track = Vec::new();
    for (delta, event) in events {
        assert!(*delta < 128);
        track.push(*delta);
        track.extend_from_slice(event);
    }
    track.extend_from_slice(&[0, 255, 47, 0]);
    let mut bytes = b"MThd\0\0\0\x06\0\0\0\x01\0\x60MTrk".to_vec();
    bytes.extend_from_slice(&(track.len() as u32).to_be_bytes());
    bytes.extend_from_slice(&track);
    bytes
}

fn changing_channels() -> Vec<u8> {
    midi(&[
        (0, &[0xc0, 0]),
        (0, &[0xc1, 40]),
        (0, &[0x90, 60, 90]),
        (0, &[0x91, 67, 80]),
        (24, &[0x80, 60, 0]),
        (0, &[0x81, 67, 0]),
        (0, &[0xc0, 24]),
        (0, &[0x90, 64, 90]),
        (0, &[0x91, 69, 80]),
        (24, &[0x80, 64, 0]),
        (0, &[0x81, 69, 0]),
    ])
}

#[test]
fn changing_programs_stay_on_their_source_channel_across_reload() {
    let (score, _) = import_midi(&changing_channels()).unwrap();
    let saved = wire(&score);
    let reloaded: Score = serde_json::from_slice(&saved).unwrap();
    let first = describe_canonical_midi(&score).unwrap();
    let again = describe_canonical_midi(&reloaded).unwrap();
    assert_eq!(wire(&first), wire(&again));
    assert_eq!(first.parts.len(), 2);
    for part in &first.parts {
        let channel = first
            .channels
            .iter()
            .find(|c| c.id == part.channel_id)
            .unwrap();
        let programs: Vec<_> = part
            .selection_summary
            .observed_selections
            .iter()
            .map(|s| s.program)
            .collect();
        match channel.channel {
            0 => {
                assert_eq!(programs, [0, 24]);
                assert_eq!(part.selection_summary.status, SelectionStatus::Changes);
            }
            1 => {
                assert_eq!(programs, [40]);
                assert_eq!(part.selection_summary.status, SelectionStatus::Known);
            }
            other => panic!("Unexpected source channel {other}"),
        }
    }
    assert_eq!(wire(&score), saved);
}

#[test]
fn pitch_mod_keeps_original_details_and_rejects_a_transposed_projection_as_original() {
    let (score, _) = import_midi(&changing_channels()).unwrap();
    let original = wire(&describe_canonical_midi(&score).unwrap());
    let before = wire(&score);
    for shift in [-12, -1, 1, 12] {
        let projection = PitchProjection::from_canonical(&score, shift).unwrap();
        assert_eq!(
            projection.original_receipt().source_binding,
            describe_canonical_midi(&score).unwrap().source_binding
        );
        assert_eq!(wire(&describe_canonical_midi(&score).unwrap()), original);
        assert_eq!(
            describe_canonical_midi(projection.notation())
                .unwrap_err()
                .code,
            "source_projection_mismatch"
        );
        assert_eq!(wire(&score), before);
    }
}

#[test]
fn basic_reload_and_pitch_do_not_rewrite_source_programs_or_binding() {
    let basic = basic_keys::convert_midi(&changing_channels(), "Mechanical source").unwrap();
    let saved = basic_keys::encode_json(&basic).unwrap();
    let reloaded = basic_keys::decode_json(&saved).unwrap();
    let details = describe_basic(&basic).unwrap();
    assert_eq!(
        details.source_binding.domain,
        "wmc-basic-complete-wire-json"
    );
    assert_eq!(wire(&details), wire(&describe_basic(&reloaded).unwrap()));
    let projection = PitchProjection::from_basic(&reloaded, 5).unwrap();
    assert_eq!(
        projection.original_receipt().source_binding,
        details.source_binding
    );
    assert_eq!(wire(&describe_basic(&reloaded).unwrap()), wire(&details));
    assert_eq!(basic_keys::encode_json(&reloaded).unwrap(), saved);
}

#[test]
fn unknown_or_uninterpreted_instrument_evidence_never_rewrites_practice_or_playback() {
    for events in [
        vec![(0, &[0x90, 60, 90][..]), (24, &[0x80, 60, 0][..])],
        vec![
            (0, &[0xf0, 5, 0x7e, 0x7f, 0x09, 0x01, 0xf7][..]),
            (0, &[0xc0, 40][..]),
            (0, &[0x90, 60, 90][..]),
            (24, &[0x80, 60, 0][..]),
        ],
    ] {
        let (score, _) = import_midi(&midi(&events)).unwrap();
        let before_score = wire(&score);
        let before_timeline = wire(&compile(score.clone()).unwrap().timeline);
        let before_practice = PracticeSource::from_canonical(&score).unwrap();
        let details = describe_canonical_midi(&score).unwrap();
        assert_eq!(
            serde_json::to_value(details.instrument_namespace).unwrap(),
            "unknown"
        );
        let after_practice = PracticeSource::from_canonical(&score).unwrap();
        assert_eq!(before_practice.receipt(), after_practice.receipt());
        assert_eq!(
            wire(&before_practice.source_units()),
            wire(&after_practice.source_units())
        );
        assert_eq!(
            wire(&compile(score.clone()).unwrap().timeline),
            before_timeline
        );
        assert_eq!(wire(&score), before_score);
    }
}

#[test]
fn display_labels_can_change_but_cannot_be_used_to_reuse_stale_evidence() {
    let (score, _) = import_midi(&changing_channels()).unwrap();
    let original = describe_canonical_midi(&score).unwrap();
    let mut renamed = score.clone();
    renamed.parts[0].name = "Guitar chosen by user".into();
    renamed.parts[0].instrument = "piano".into();
    let details = describe_canonical_midi(&renamed).unwrap();
    assert_ne!(details.source_binding, original.source_binding);
    assert_eq!(details.original_midi_sha256, original.original_midi_sha256);
    assert_eq!(wire(&details.channels), wire(&original.channels));
    for (before, after) in original.parts.iter().zip(&details.parts) {
        assert_eq!(
            wire(&before.selection_summary),
            wire(&after.selection_summary)
        );
    }
}
