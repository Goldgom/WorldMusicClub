use super::*;
use serde_json::Value;

// Newly authored C/E/G source events only; no private song or corpus material.
pub(super) fn source(extra: &[u8]) -> Vec<u8> {
    let conductor = vec![
        0, 255, 81, 3, 7, 161, 33, 0, 255, 88, 4, 4, 2, 24, 8, 0, 255, 47, 0,
    ];
    let mut tracks = vec![conductor];
    for (channel, key) in [(0, 24), (1, 64), (2, 103)] {
        let mut track = vec![
            0,
            255,
            3,
            1,
            b'A' + channel,
            0,
            0xc0 | channel,
            0,
            1,
            0x90 | channel,
            key,
            90,
        ];
        if channel == 0 {
            track.extend(extra);
        }
        track.extend([1, 0x80 | channel, key, 19, 0, 255, 47, 0]);
        tracks.push(track);
    }
    let mut out = b"MThd\0\0\0\x06\0\x01\0\x04\0\x07".to_vec();
    for track in tracks {
        out.extend(b"MTrk");
        out.extend((track.len() as u32).to_be_bytes());
        out.extend(track);
    }
    out
}
fn prepared(bytes: &[u8]) -> Draft {
    prepare_midi(bytes, "原创 C/E/G", "authored.mid").unwrap()
}
#[test]
fn explicit_basic_intent_preserves_default_and_retains_unsupported_sound_events() {
    use base64::Engine;
    let bytes = source(&[0, 0xf0, 3, 0x7d, 0x01, 0xf7]);
    assert_eq!(prepared(&bytes).state, State::Rejected);
    let request: Request = serde_json::from_value(serde_json::json!({
        "source_base64":base64::engine::general_purpose::STANDARD.encode(&bytes),
        "source_name":"original.mid","title":"Original basic intent","intent":"basic_keys",
    }))
    .unwrap();
    let draft = prepare_request(request).unwrap();
    assert_eq!(draft.state, State::BasicKeyCandidate);
    assert_eq!(draft.basic_key_coverage.as_ref().unwrap().key_attacks, 3);
    let package = draft.package.as_ref().unwrap();
    let score = crate::basic_keys::decode_json(package.score_json.as_bytes()).unwrap();
    assert_eq!(score.coverage.source_events, 19);
    assert_eq!(score.coverage.projected_melodic_targets, 3);
    assert!(draft.pack().is_ok());
    let legacy: Request = serde_json::from_value(serde_json::json!({
        "source_base64":base64::engine::general_purpose::STANDARD.encode(&bytes),
        "source_name":"original.mid","title":"Original default intent",
    }))
    .unwrap();
    assert_eq!(prepare_request(legacy).unwrap().state, State::Rejected);
}
#[test]
fn all_tracks_and_unfiltered_exact_source_clocks_survive_strict_draft() {
    let bytes = source(&[]);
    let draft = prepared(&bytes);
    assert_eq!(
        draft.state,
        State::StrictNotationCandidate,
        "{:?}",
        draft.diagnostics
    );
    let inventory = draft.inventory.as_ref().unwrap();
    assert_eq!(inventory.source_tracks, 4);
    assert_eq!(inventory.source_events, 18);
    assert_eq!(inventory.key_attacks, 3);
    assert_eq!(inventory.key_releases, 3);
    assert_eq!(inventory.parts.len(), 3);
    assert_eq!(inventory.tracks[0].channels.len(), 0);
    assert_eq!(inventory.tracks[0].source_event_count, 3);
    assert_eq!(inventory.tracks[3].channels[0].channel, 2);
    let package = draft.package.as_ref().unwrap();
    let score = clean_song::decode_json(package.score_json.as_bytes()).unwrap();
    assert_eq!(score.coverage.source_events, 18);
    assert_eq!(score.coverage.represented_events, 18);
    let keys: Vec<_> = score
        .notation
        .parts
        .iter()
        .flat_map(|p| {
            p.notes
                .iter()
                .filter_map(|n| n.pitch.as_ref().unwrap().midi())
        })
        .collect();
    assert_eq!(keys, [24, 64, 103]);
    for part in &score.notation.parts {
        assert_eq!(part.notes[0].at.numerator, 1);
        assert_eq!(part.notes[0].at.denominator, 7);
        assert_eq!(part.notes[0].duration.numerator, 1);
        assert_eq!(part.notes[0].duration.denominator, 7);
    }
    assert!(score.notation.source.is_none());
    let metadata: Value = serde_json::from_str(&package.metadata_json).unwrap();
    assert_eq!(metadata["score"]["bytes"], package.score_json.len());
    assert_eq!(
        metadata["score"]["sha256"],
        hash(package.score_json.as_bytes())
    );
    assert_eq!(metadata["id"], format!("midi-clean-{}", hash(&bytes)));
    assert_eq!(metadata["sources"][0]["sha256"], hash(&bytes));
    assert_eq!(metadata["title"], "原创 C/E/G");
    assert_eq!(metadata["rights"]["status"], "user_supplied_unverified");
    assert!(metadata["media"].as_array().unwrap().is_empty());
}
#[test]
fn independent_events_never_invent_pairings_or_practice() {
    // Same-pitch overlap, sustain and pitch bend are independent typed events.
    let bytes = source(&[
        0, 0x90, 24, 70, 0, 0xb0, 64, 127, 0, 0xe0, 1, 64, 0, 0x80, 24, 21,
    ]);
    let draft = prepared(&bytes);
    assert_eq!(
        draft.state,
        State::EventOnlyReferenceCandidate,
        "{:?}",
        draft.diagnostics
    );
    let score =
        clean_performance::decode_json(draft.package.as_ref().unwrap().score_json.as_bytes())
            .unwrap();
    assert!(score.notation.is_none());
    assert!(draft
        .inventory
        .as_ref()
        .unwrap()
        .parts
        .iter()
        .all(|p| !p.notation_available));
    let timeline = midi_events::parse_midi_events(&bytes, None).unwrap();
    assert_eq!(score.performance.events.len(), timeline.events().len());
    for (original, clean) in timeline.events().iter().zip(&score.performance.events) {
        assert_eq!(original.id().stable_id(), clean.event_id);
        assert_eq!(original.id().track_index(), clean.origin.track);
        assert_eq!(original.id().event_index(), clean.origin.event);
        assert_eq!(original.beat().numerator, clean.at.numerator);
        assert_eq!(original.beat().denominator, clean.at.denominator);
    }
    assert_eq!(score.coverage.performance.key_attacks, 4);
    assert_eq!(score.coverage.performance.key_releases, 4);
}
#[test]
fn unsupported_event_rejects_the_whole_song_with_its_source_coordinate() {
    let bytes = source(&[0, 0xb0, 2, 19]);
    let draft = prepared(&bytes);
    assert_eq!(draft.state, State::Rejected);
    assert!(draft.package.is_none());
    assert!(draft.draft_sha256.is_none());
    assert!(draft.pack().is_err());
    assert_eq!(draft.inventory.as_ref().unwrap().source_tracks, 4);
    let error = draft.diagnostics.last().unwrap();
    assert_eq!(error.track_index, Some(1));
    assert_eq!(
        error.source_event_id.as_deref(),
        Some(format!("midi:{}:t1:e3", hash(&bytes)).as_str())
    );
    assert!(error.message.contains("Controller 2"));
    assert!(!error.action.is_empty());
}
#[test]
fn metadata_and_fingerprints_are_exact_deterministic_and_source_based() {
    let bytes = source(&[]);
    let one = prepared(&bytes);
    let same = prepared(&bytes);
    assert_eq!(one.draft_sha256, same.draft_sha256);
    assert_eq!(one.pack().unwrap(), same.pack().unwrap());
    let renamed = prepare_midi(&bytes, "Another title", "renamed.mid").unwrap();
    assert_ne!(one.draft_sha256, renamed.draft_sha256);
    let other = prepared(&source(&[0, 0xb0, 7, 100]));
    assert_ne!(one.source.sha256, other.source.sha256);
    let id = |d: &Draft| -> String {
        serde_json::from_str::<Value>(&d.package.as_ref().unwrap().metadata_json).unwrap()["id"]
            .as_str()
            .unwrap()
            .into()
    };
    assert_eq!(id(&one), id(&renamed));
    assert_ne!(id(&one), id(&other));
}
#[test]
fn source_and_presentation_limits_never_produce_partial_drafts() {
    let rejected = prepared(b"not midi");
    assert_eq!(rejected.state, State::Rejected);
    assert!(rejected.inventory.is_none());
    assert!(rejected.package.is_none());
    assert!(prepare_midi(
        &vec![0; midi_events::MAX_SOURCE_BYTES + 1],
        "Title",
        "a.mid"
    )
    .is_err());
    assert!(prepare_midi(&source(&[]), &"中".repeat(334), "a.mid").is_err());
    assert!(prepare_midi(&source(&[]), "a\nb", "a.mid").is_err());
    assert!(prepare_midi(&source(&[]), "Title", &"a".repeat(256)).is_err());
    assert!(prepare_midi(&source(&[]), " ", "a.mid").is_err());
}
