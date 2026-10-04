use super::*;
use crate::vsq_clean;
#[path = "../../../../tests/support/vsq_authoring.rs"]
mod fixture;

#[test]
fn framed_vsq_retains_every_authored_part_and_exact_package_without_fake_midi_routes() {
    let source = fixture::source();
    assert!(midi_events::parse_midi_events(&source, None).is_err());
    let draft = prepare_midi(&source, "Original VSQ", "misleading.mid").unwrap();
    assert_eq!(
        draft.state,
        State::VsqAuthoringCandidate,
        "{:?}",
        draft.diagnostics
    );
    assert_eq!(draft.source.format, "vsq");
    let inventory = draft.inventory.as_ref().unwrap();
    let mut seven_bit_tracks = fixture::tracks("DSB301", 0);
    for track in &mut seven_bit_tracks {
        for index in 0..track.len().saturating_sub(2) {
            if track[index..index + 3] == [0, 6, 255] {
                track[index + 2] = 127;
            }
        }
    }
    let seven_bit = fixture::smf(&seven_bit_tracks);
    let generic_events = midi_events::parse_midi_events(&seven_bit, None).unwrap();
    assert_eq!(inventory.source_events, generic_events.events().len());
    assert_eq!(inventory.source_tracks, 4);
    assert_eq!(inventory.parts.len(), 3);
    assert_eq!(inventory.key_attacks, 0);
    assert_eq!(inventory.key_releases, 0);
    assert!(inventory.tracks[0].channels.is_empty());
    for (index, part) in inventory.parts.iter().enumerate() {
        assert_eq!(part.channel, None);
        assert_eq!(part.id, format!("vsq-track-{}", index + 1));
        let details = part.vsq.as_ref().unwrap();
        let raw = &inventory.tracks[usize::from(details.source_track_index)];
        assert_eq!(part.track_id, raw.track_id);
        assert_eq!(raw.channels[0].channel, 0); // actual source controllers only
        assert_eq!(details.singers, 1);
        assert_eq!(details.curves, 3);
    }
    assert!(inventory.parts[0].vsq.as_ref().unwrap().solo);
    assert!(inventory.parts[1].vsq.as_ref().unwrap().mute);
    assert_eq!(inventory.parts[2].vsq.as_ref().unwrap().notes, 0);
    let package = draft.package.as_ref().unwrap();
    let expected = vsq_clean::convert_vsq(&source, "Original VSQ").unwrap();
    assert_eq!(
        package.score_json.as_bytes(),
        vsq_clean::encode_json(&expected).unwrap()
    );
    assert_eq!(
        package.metadata_json,
        serde_json::to_string_pretty(
            &vsq_clean::package_metadata(&expected, package.score_json.as_bytes()).unwrap()
        )
        .unwrap()
    );
    assert!(package.score_json.contains("9007199254740993"));
    assert_eq!(expected.authoring.tracks[0].notes[0].lyrics[0].lyric, "あ");
    assert_eq!(expected.coverage.project.notes, 2);
    assert_eq!(expected.coverage.project.vibratos, 2);
    assert_eq!(expected.notation.id, format!("vsq-{}", hash(&source)));
    assert!(vsq_clean::compile_vocal(&expected).is_err());
    assert_eq!(
        expected.capabilities.instrumental_practice,
        vsq_clean::InstrumentalPractice::RequiresExplicitBaseNoteChoice
    );
    let renamed = prepare_midi(&source, "Renamed", "other.vsq").unwrap();
    assert_ne!(draft.draft_sha256, renamed.draft_sha256);
    assert_eq!(draft.source.sha256, renamed.source.sha256);
}
#[test]
fn recognized_invalid_vsq_never_falls_back_and_names_never_imply_format() {
    for version in ["DSB302", "unexpected", ""] {
        let mut tracks = fixture::tracks(version, 0);
        for track in &mut tracks {
            for index in 0..track.len().saturating_sub(2) {
                if track[index..index + 3] == [0, 6, 255] {
                    track[index + 2] = 127;
                }
            }
        }
        let bytes = fixture::smf(&tracks);
        assert!(midi_events::parse_midi_events(&bytes, None).is_ok());
        let draft = prepare_midi(&bytes, "Rejected", "source.mid").unwrap();
        assert_eq!(draft.source.format, "vsq");
        assert_eq!(draft.state, State::Rejected);
        assert!(draft.package.is_none());
        assert!(draft.draft_sha256.is_none());
        assert!(draft.pack().is_err());
        assert_eq!(
            draft.diagnostics.last().unwrap().code,
            "vsq_source_rejected"
        );
    }
    let generic = tests::source(&[]);
    let draft = prepare_midi(&generic, "Generic", "original.vsq").unwrap();
    assert_eq!(draft.source.format, "midi");
    assert_eq!(draft.state, State::StrictNotationCandidate);
}
#[test]
fn detector_requires_dm_text_events_and_section_bound_version() {
    for (kind, text) in [
        (3, "DM:0000:[Common]\nVersion=DSB301\n"),
        (0x7f, "DM:0000:[Common]\nVersion=DSB301\n"),
        (1, "[Common]\nVersion=DSB301\n"),
        (1, "DM:0000:Title=[Common]\nVersion=DSB301\n"),
        (1, "DM:0000:[Other]\nName=[Common]\nVersion=DSB301\n"),
        (1, "DM:0000:[Common]\nName=Version=DSB301\n"),
    ] {
        let mut track = fixture::meta(0, kind, text.as_bytes());
        track.extend(fixture::meta(0, 47, &[]));
        let draft = prepare_midi(&fixture::smf(&[track]), "Generic", "misleading.vsq").unwrap();
        assert_eq!(draft.source.format, "midi", "{kind}: {text}");
    }
    let mut tracks = fixture::tracks("DSB301", 0);
    // Recognized project followed by broken event framing must stay VSQ-rejected.
    tracks[1].extend([0, 0x90, 60, 90]);
    let draft = prepare_midi(&fixture::smf(&tracks), "Broken VSQ", "source.mid").unwrap();
    assert_eq!(draft.source.format, "vsq");
    assert_eq!(draft.state, State::Rejected);
    assert!(draft.inventory.is_none());

    let mut tracks = fixture::tracks("DSB301", 0);
    let prefix = tracks[1].windows(8).position(|w| w == b"DM:0000:").unwrap();
    tracks[1][prefix + 6] = b'1';
    let draft = prepare_midi(&fixture::smf(&tracks), "Broken sequence", "source.mid").unwrap();
    assert_eq!(draft.source.format, "vsq");
    assert_eq!(draft.state, State::Rejected);
    assert!(draft.package.is_none());
    assert!(draft
        .diagnostics
        .last()
        .unwrap()
        .message
        .contains("consecutive"));
}
#[test]
fn vsq_probe_has_its_own_event_bound_without_loosening_generic_midi() {
    let bytes = fixture::smf(&fixture::tracks("DSB301", midi_events::MAX_EVENTS / 3 + 1));
    let mut text = vec![];
    let inventory = vsq::scan(&bytes, &hash(&bytes), &mut text).unwrap();
    assert!(inventory.source_events > midi_events::MAX_EVENTS);
    assert!(text.iter().any(|t| vsq::common_version(t)));
    assert!(midi_events::parse_midi_events(&bytes, None).is_err());
    let mut seven_bit = bytes;
    for index in 0..seven_bit.len().saturating_sub(2) {
        if seven_bit[index..index + 3] == [0, 6, 255] {
            seven_bit[index + 2] = 127;
        }
    }
    assert_eq!(
        midi_events::parse_midi_events(&seven_bit, None)
            .err()
            .unwrap()
            .code,
        midi_events::ErrorCode::EventLimit,
    );
    let bytes = fixture::smf(&fixture::tracks("DSB301", crate::vsq::MAX_EVENTS / 3 + 1));
    let draft = prepare_midi(&bytes, "Too many events", "source.vsq").unwrap();
    assert_eq!(draft.state, State::Rejected);
    assert_eq!(draft.source.format, "vsq");
    assert!(draft
        .diagnostics
        .last()
        .unwrap()
        .message
        .contains("event limit"));
    assert!(draft.package.is_none());
}
#[test]
fn native_artifact_size_limits_hold_whole_packages_at_exact_boundaries() {
    for (score_len, metadata_len, accepted) in [
        (MAX_PACKAGE_SCORE_BYTES, MAX_PACKAGE_METADATA_BYTES, true),
        (MAX_PACKAGE_SCORE_BYTES + 1, 1, false),
        (1, MAX_PACKAGE_METADATA_BYTES + 1, false),
    ] {
        let mut draft = prepare_midi(b"bad", "Limit", "source.vsq").unwrap();
        draft.state = State::VsqAuthoringCandidate;
        install_package(
            &mut draft,
            Package {
                score_json: "x".repeat(score_len),
                metadata_json: "y".repeat(metadata_len),
            },
        );
        assert_eq!(draft.package.is_some(), accepted);
        assert_eq!(draft.draft_sha256.is_some(), accepted);
        if !accepted {
            assert_eq!(draft.state, State::Rejected);
            assert_eq!(
                draft.diagnostics.last().unwrap().code,
                "complete_package_limit"
            );
        }
    }
}
