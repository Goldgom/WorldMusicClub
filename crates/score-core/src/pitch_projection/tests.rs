use super::*;
use crate::{
    automatic_assistance, instruments::InstrumentProfile, practice_progression, Repeat, Source,
};
use serde_json::json;

fn bytes(value: &(impl Serialize + ?Sized)) -> Vec<u8> {
    serde_json::to_vec(value).unwrap()
}
fn fixture() -> Score {
    crate::catalog().remove(0)
}
fn projection_error(result: Result<PitchProjection, PitchProjectionError>) -> PitchProjectionError {
    result.err().expect("must reject the complete projection")
}
fn selection(source: &PracticeSource) -> automatic_assistance::AssistanceSelection {
    automatic_assistance::AssistanceSelection {
        selected_part_ids: source.part_ids().to_vec(),
        profile: InstrumentProfile::Piano {
            key_count: 128,
            lowest_midi: Some(0),
        },
    }
}
fn assert_timeline_shift(original: &PracticeSource, projected: &PracticeSource, shift: i16) {
    assert_eq!(original.part_ids(), projected.part_ids());
    assert_eq!(
        bytes(original.source_units()),
        bytes(projected.source_units())
    );
    assert_eq!(
        original.timeline().duration_ms.to_bits(),
        projected.timeline().duration_ms.to_bits()
    );
    assert_eq!(
        original.timeline().notes.len(),
        projected.timeline().notes.len()
    );
    for (before, after) in original
        .timeline()
        .notes
        .iter()
        .zip(&projected.timeline().notes)
    {
        let percussion = original.keyboard_excluded.contains(&before.id);
        let mut expected = serde_json::to_value(before).unwrap();
        expected["midi"] = json!(i16::from(before.midi) + if percussion { 0 } else { shift });
        assert_eq!(serde_json::to_value(after).unwrap(), expected);
        assert_eq!(
            bytes(&original.gates[&before.id]),
            bytes(&projected.gates[&after.id])
        );
    }
}
fn track(events: &[(u8, &[u8])]) -> Vec<u8> {
    let mut bytes = vec![];
    for (delta, event) in events {
        bytes.push(*delta);
        bytes.extend(*event);
    }
    bytes.extend([0, 255, 47, 0]);
    bytes
}
fn basic(tracks: &[Vec<u8>], ppq: u16) -> basic_keys::CompleteBasicKeys {
    let mut bytes = b"MThd\0\0\0\x06".to_vec();
    bytes.extend((if tracks.len() == 1 { 0_u16 } else { 1 }).to_be_bytes());
    bytes.extend((tracks.len() as u16).to_be_bytes());
    bytes.extend(ppq.to_be_bytes());
    for track in tracks {
        bytes.extend(b"MTrk");
        bytes.extend((track.len() as u32).to_be_bytes());
        bytes.extend(track);
    }
    basic_keys::convert_midi(&bytes, "Authored pitch projection fixture").unwrap()
}
fn basic_fixture() -> basic_keys::CompleteBasicKeys {
    basic(
        &[
            track(&[
                (0, &[0x90, 60, 90]),
                (2, &[0x90, 60, 91]),
                (0, &[0xc0, 40]),
                (0, &[0xe0, 0, 80]),
                (4, &[0x80, 60, 0]),
                (0, &[0x99, 127, 90]),
                (1, &[0x89, 127, 0]),
            ]),
            track(&[(4, &[0x80, 60, 0]), (3, &[0x80, 60, 0])]),
        ],
        3,
    )
}

#[test]
fn c4_to_d4_changes_only_effective_pitch_and_key_not_the_saved_song() {
    let mut score = fixture();
    score.source = Some(Source {
        format: "musicxml".into(),
        filename: Some("original.xml".into()),
        content: "\u{feff}source\r\n".into(),
        import_diagnostics: None,
    });
    let before = bytes(&score);
    let original = PracticeSource::from_canonical(&score).unwrap();
    assert_eq!(original.timeline().notes[0].midi, 60);
    let projected = PitchProjection::from_canonical(&score, 2).unwrap();
    assert_eq!(projected.source().timeline().notes[0].midi, 62);
    assert_eq!(
        projected.notation().parts[0].notes[0]
            .pitch
            .as_ref()
            .unwrap()
            .step,
        "D"
    );
    assert_eq!(projected.notation().keys[0].fifths, 2);
    assert_eq!(projected.notation().id, score.id);
    assert_eq!(projected.notation().title, score.title);
    assert_eq!(bytes(&projected.notation().source), bytes(&score.source));
    assert_timeline_shift(&original, projected.source(), 2);
    assert_eq!(bytes(&score), before);
    let audio =
        crate::canonical_audio::compile_audio_profile(projected.notation().clone()).unwrap();
    for (note, audio) in projected
        .source()
        .timeline()
        .notes
        .iter()
        .zip(audio.occurrences)
    {
        assert_eq!(note.midi, audio.midi);
        assert_eq!(note.start_ms, audio.start_ms);
    }
}

#[test]
fn zero_is_byte_identical_to_the_existing_canonical_path_and_can_restore_off() {
    let score = fixture();
    let original = PracticeSource::from_canonical(&score).unwrap();
    let zero = PitchProjection::from_canonical(&score, 0).unwrap();
    assert!(zero.identity().is_none());
    assert_eq!(bytes(zero.source().receipt()), bytes(original.receipt()));
    assert_eq!(bytes(zero.source().timeline()), bytes(original.timeline()));
    assert_eq!(
        bytes(zero.compilation()),
        bytes(&crate::compile(score.clone()).unwrap())
    );
    let shifted = PitchProjection::from_canonical(&score, 2).unwrap();
    let reset = PitchProjection::from_canonical(&score, 0).unwrap();
    assert_eq!(bytes(reset.compilation()), bytes(zero.compilation()));
    assert_ne!(bytes(shifted.compilation()), bytes(reset.compilation()));
}

#[test]
fn every_supported_shift_has_exact_original_gates_and_source_identity() {
    let score = fixture();
    let source = PracticeSource::from_canonical(&score).unwrap();
    for shift in -12..=12 {
        let projected = PitchProjection::from_canonical(&score, shift).unwrap();
        assert_timeline_shift(&source, projected.source(), shift);
        assert_eq!(
            projected.source().receipt().source_binding,
            source.receipt().source_binding
        );
    }
    for shift in [-32768, -13, 13, 32767] {
        assert_eq!(
            projection_error(PitchProjection::from_canonical(&score, shift)).code,
            "pitch_mod_shift"
        );
    }
}

#[test]
fn tied_segments_repeats_and_rational_clocks_remain_complete() {
    let mut score = fixture();
    score.parts[0].notes.truncate(2);
    let pitch = score.parts[0].notes[0].pitch.clone();
    score.parts[0].notes[0].at = Beat::ZERO;
    score.parts[0].notes[0].duration = Beat::new(1, 3);
    score.parts[0].notes[0].tie_start = true;
    score.parts[0].notes[1].at = Beat::new(1, 3);
    score.parts[0].notes[1].duration = Beat::new(2, 3);
    score.parts[0].notes[1].pitch = pitch;
    score.parts[0].notes[1].tie_stop = true;
    score.repeats = vec![Repeat {
        from: Beat::ZERO,
        to: Beat::new(4, 1),
        times: 2,
    }];
    let source = PracticeSource::from_canonical(&score).unwrap();
    let projected = PitchProjection::from_canonical(&score, -1).unwrap();
    assert_eq!(projected.source_pitches().len(), 2);
    assert_eq!(projected.source().timeline().notes.len(), 2);
    assert!(projected
        .source()
        .timeline()
        .notes
        .iter()
        .all(|note| note.source_note_ids.len() == 2));
    assert_timeline_shift(&source, projected.source(), -1);
    assert_eq!(bytes(&score.repeats), bytes(&projected.notation().repeats));
}

#[test]
fn canonical_part_labels_never_guess_percussion_semantics() {
    let mut score = fixture();
    score.parts[0].instrument = "percussion drums".into();
    score.parts[0].name = "channel 10".into();
    let projected = PitchProjection::from_canonical(&score, 2).unwrap();
    assert!(projected
        .source_pitches()
        .iter()
        .all(|pitch| !pitch.percussion && pitch.effective_midi == pitch.original_midi + 2));
}

#[test]
fn range_failures_and_missing_pitches_are_explicit_and_atomic() {
    for (key, shift) in [(0, -1), (127, 1)] {
        let mut score = fixture();
        score.parts[0].notes[0].pitch = Some(nominal_pitch(key));
        let before = bytes(&score);
        let error = projection_error(PitchProjection::from_canonical(&score, shift));
        assert_eq!(error.code, "pitch_mod_midi_range");
        assert_eq!(error.source_ids, vec![score.parts[0].notes[0].id.clone()]);
        assert_eq!(before, bytes(&score));
    }
    let mut rest = fixture();
    for note in &mut rest.parts[0].notes {
        note.pitch = None;
    }
    assert!(PitchProjection::from_canonical(&rest, 0).is_ok());
    assert_eq!(
        projection_error(PitchProjection::from_canonical(&rest, 2)).code,
        "pitch_mod_no_pitched_notes"
    );
}

#[test]
fn unspellable_global_key_changes_reject_without_an_enharmonic_fallback() {
    let mut score = fixture();
    score.keys[0].fifths = -7;
    score.keys.push(Key {
        at: Beat::new(4, 1),
        fifths: 7,
        mode: "minor".into(),
    });
    let before = bytes(&score);
    assert_eq!(
        projection_error(PitchProjection::from_canonical(&score, 1)).code,
        "pitch_mod_spelling"
    );
    assert_eq!(before, bytes(&score));
    let octave = PitchProjection::from_canonical(&score, 12).unwrap();
    assert_eq!(bytes(&score.keys), bytes(&octave.notation().keys));
}

#[test]
fn saved_package_shift_and_full_source_content_bind_distinct_identities() {
    let score = fixture();
    let first = PitchProjection::from_canonical(&score, 2)
        .unwrap()
        .with_verified_saved_binding(&"a".repeat(64))
        .unwrap();
    let same = PitchProjection::from_canonical(&score, 2)
        .unwrap()
        .with_verified_saved_binding(&"a".repeat(64))
        .unwrap();
    assert_eq!(
        bytes(first.identity().unwrap()),
        bytes(same.identity().unwrap())
    );
    for other in [
        PitchProjection::from_canonical(&score, 3)
            .unwrap()
            .with_verified_saved_binding(&"a".repeat(64))
            .unwrap(),
        PitchProjection::from_canonical(&score, 2)
            .unwrap()
            .with_verified_saved_binding(&"b".repeat(64))
            .unwrap(),
    ] {
        assert_ne!(
            first.identity().unwrap().digest,
            other.identity().unwrap().digest
        );
        assert_ne!(
            first.source().receipt().runtime_digest,
            other.source().receipt().runtime_digest
        );
    }
    let mut changed = score.clone();
    changed.title.push_str(" changed metadata");
    assert_ne!(
        first.identity().unwrap().digest,
        PitchProjection::from_canonical(&changed, 2)
            .unwrap()
            .identity()
            .unwrap()
            .digest
    );
    assert_eq!(
        first.original_receipt().saved_package_sha256,
        Some("a".repeat(64))
    );
    assert_eq!(
        first.source().receipt().saved_package_sha256,
        Some("a".repeat(64))
    );
    assert_eq!(
        first.source().receipt().source_binding,
        first.original_receipt().source_binding
    );
    assert_ne!(
        first.source().receipt().runtime_digest,
        first.original_receipt().runtime_digest
    );
}

#[test]
fn old_assistance_receipts_cannot_be_reused_and_targets_share_effective_pitches() {
    let score = fixture();
    let original = PracticeSource::from_canonical(&score).unwrap();
    let selected = selection(&original);
    let plan = automatic_assistance::original(&original, &selected).unwrap();
    let projected = PitchProjection::from_canonical(&score, 2).unwrap();
    assert_eq!(
        automatic_assistance::validate(projected.source(), &plan.plan)
            .unwrap_err()
            .code,
        "assistance_source_mismatch"
    );
    let new = automatic_assistance::original(projected.source(), &selected).unwrap();
    assert!(automatic_assistance::validate(&original, &new.plan).is_err());
    assert_eq!(new.human_targets.timeline.notes[0].midi, 62);
    let hierarchy = practice_progression::generate(
        projected.source(),
        &selected,
        practice_progression::ProgressionLayer::Balanced,
    )
    .unwrap();
    assert!(practice_progression::validate(&original, &hierarchy.plan).is_err());
}

#[test]
fn basic_fifo_percussion_bends_programs_and_fractional_gates_are_preserved() {
    let score = basic_fixture();
    let original = bytes(&score);
    let source = PracticeSource::from_basic(&score).unwrap();
    let projection = PitchProjection::from_basic(&score, 2).unwrap();
    assert_timeline_shift(&source, projection.source(), 2);
    assert!(projection
        .source_pitches()
        .iter()
        .any(|pitch| pitch.percussion
            && pitch.original_midi == 127
            && pitch.effective_midi == 127));
    assert!(projection
        .source_pitches()
        .iter()
        .any(|pitch| !pitch.percussion && pitch.effective_midi == 62));
    assert_eq!(original, bytes(&score));
    let rendition = basic_keys::compile_rendition(&score).unwrap();
    assert_eq!(rendition.rendition.coverage.uninterpreted_program_events, 1);
    assert_eq!(
        rendition.rendition.coverage.uninterpreted_pitch_bend_events,
        1
    );
    assert_eq!(
        rendition.rendition.notes[0].release,
        Some(basic_keys::Coordinate { track: 1, event: 0 })
    );
    let zero = PitchProjection::from_basic(&score, 0).unwrap();
    assert_eq!(bytes(source.receipt()), bytes(zero.source().receipt()));
    assert_eq!(bytes(source.timeline()), bytes(zero.source().timeline()));
    assert_eq!(bytes(&score.notation), bytes(zero.notation()));
}

#[test]
fn percussion_only_basic_rejects_nonzero_but_zero_is_an_identical_path() {
    let score = basic(&[track(&[(0, &[0x99, 0, 90]), (4, &[0x89, 0, 0])])], 96);
    assert_eq!(
        projection_error(PitchProjection::from_basic(&score, -12)).code,
        "pitch_mod_no_pitched_notes"
    );
    assert!(PitchProjection::from_basic(&score, 0)
        .unwrap()
        .identity()
        .is_none());
}

#[test]
fn basic_page_keys_notation_and_musicxml_follow_one_projection() {
    let score = basic(
        &[track(&[
            (0, &[255, 0x58, 4, 4, 2, 24, 8]),
            (0, &[255, 0x59, 2, 0, 0]),
            (0, &[0x90, 60, 90]),
            (96, &[0x80, 60, 0]),
        ])],
        96,
    );
    let request = basic_keys::NotationRequest {
        part_id: score.performance.parts[0].id.clone(),
        rendition_policy_id: Some(basic_keys::RENDITION_POLICY.into()),
        first_measure: 0,
        measure_count: 1,
        display_meter: None,
        position_ms: None,
    };
    let projected = PitchProjection::from_basic(&score, 2).unwrap();
    let page = projected.basic_notation_page(&score, &request).unwrap();
    assert_eq!(page.interpreted_notes[0].key, 62);
    let page_score = page.score.unwrap();
    assert_eq!(
        page_score.parts[0].notes[0].pitch.as_ref().unwrap().midi(),
        Some(62)
    );
    assert_eq!(page_score.keys[0].fifths, 2);
    assert!(page.musicxml.unwrap().xml.contains("<step>D</step>"));
    let zero = PitchProjection::from_basic(&score, 0).unwrap();
    assert_eq!(
        bytes(&zero.basic_notation_page(&score, &request).unwrap()),
        bytes(&basic_keys::notation_page(&score, &request).unwrap())
    );
    let different = basic_fixture();
    assert_eq!(
        projected
            .basic_notation_page(&different, &request)
            .unwrap_err()
            .code,
        "pitch_mod_source_mismatch"
    );
}

#[test]
fn basic_projection_checks_unwritten_attacks_before_paged_display() {
    let score = basic(&[track(&[(0, &[0x90, 127, 90])])], 96);
    assert!(score
        .notation
        .parts
        .iter()
        .all(|part| part.notes.is_empty()));
    assert_eq!(
        projection_error(PitchProjection::from_basic(&score, 1)).code,
        "pitch_mod_midi_range"
    );
    let projected = PitchProjection::from_basic(&score, -1).unwrap();
    assert_eq!(projected.source().timeline().notes[0].midi, 126);
    let page = projected
        .basic_notation_page(
            &score,
            &basic_keys::NotationRequest {
                part_id: score.performance.parts[0].id.clone(),
                rendition_policy_id: Some(basic_keys::RENDITION_POLICY.into()),
                first_measure: 0,
                measure_count: 1,
                display_meter: Some(basic_keys::DisplayMeter {
                    numerator: 4,
                    denominator: 4,
                }),
                position_ms: None,
            },
        )
        .unwrap();
    assert_eq!(page.onsets[0].key, 126);
}

#[test]
fn vsq_zero_origin_and_fingering_share_the_effective_compilation() {
    let score = vsq_clean::decode_json(include_bytes!(
        "../../../../tests/fixtures/vsq-clean-v1/score.json"
    ))
    .unwrap();
    let before = bytes(&score);
    let choice = vsq_clean::PracticeChoice::BaseNotesInstrumental;
    let original = PracticeSource::from_vsq(&score, choice).unwrap();
    let zero = PitchProjection::from_vsq(&score, choice, 0).unwrap();
    let shifted = PitchProjection::from_vsq(&score, choice, 2).unwrap();
    assert_eq!(shifted.source().timeline().notes[0].start_ms, 0.0);
    assert_timeline_shift(&original, shifted.source(), 2);
    assert_eq!(bytes(original.receipt()), bytes(zero.source().receipt()));
    assert_eq!(
        bytes(zero.compilation()),
        bytes(
            &vsq_clean::compile_practice_with_compilation(&score, choice)
                .unwrap()
                .1
        )
    );
    let expected = bytes(shifted.compilation());
    let native = shifted.into_fingering_source().unwrap();
    assert_eq!(bytes(&native.compilation), expected);
    let request = crate::piano_fingering::PianoFingeringRequest {
        score: native.score().clone(),
        part_id: None,
        profile: InstrumentProfile::Piano {
            key_count: 88,
            lowest_midi: Some(21),
        },
        left_hand: Default::default(),
        right_hand: Default::default(),
        locks: vec![],
    };
    let plan = crate::piano_fingering::plan_piano_fingering_from_source(request, native).unwrap();
    assert_eq!(plan.targets[0].start_ms, 0.0);
    assert_eq!(bytes(&score), before);
}

#[test]
fn semantic_midi_retains_complete_native_runtime_gates_and_original_package() {
    let score = clean_song::decode_json(include_bytes!(
        "../../../../tests/fixtures/clean-song-v2/score.json"
    ))
    .unwrap();
    let before = bytes(&score);
    let source = PracticeSource::from_complete_midi(&score).unwrap();
    let projection = PitchProjection::from_complete_midi(&score, 2).unwrap();
    assert_timeline_shift(&source, projection.source(), 2);
    let zero = PitchProjection::from_complete_midi(&score, 0).unwrap();
    assert_eq!(bytes(zero.source().receipt()), bytes(source.receipt()));
    assert_eq!(
        bytes(zero.compilation()),
        bytes(&clean_song::compile_complete(&score).unwrap().compilation)
    );
    assert_eq!(before, bytes(&score));
}

#[test]
fn complete_native_constructors_reject_mutated_notation_or_source_evidence() {
    let mut score = basic_fixture();
    score.notation.id.push_str(" fabricated");
    assert!(PitchProjection::from_basic(&score, 2).is_err());
    let mut vsq = vsq_clean::decode_json(include_bytes!(
        "../../../../tests/fixtures/vsq-clean-v1/score.json"
    ))
    .unwrap();
    vsq.notation.parts[0].notes[0].pitch = Some(nominal_pitch(60));
    assert!(
        PitchProjection::from_vsq(&vsq, vsq_clean::PracticeChoice::BaseNotesInstrumental, 2)
            .is_err()
    );
}
