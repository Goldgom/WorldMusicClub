//! Independent whole-source invariants. Expected pitches are scalar differences;
//! clocks, identities and ownership are compared against actual Rust output.
use score_core::{
    automatic_assistance::{self, AssistanceSelection},
    instruments::InstrumentProfile,
    pitch_projection::PitchProjection,
    practice_progression::{self, ProgressionLayer},
    practice_source::PracticeSource,
    Beat, Key, Note, Part, Pitch, Repeat, Score,
};
use serde::Serialize;
use serde_json::{json, Value};
use std::collections::BTreeSet;

fn bytes<T: Serialize + ?Sized>(value: &T) -> Vec<u8> {
    serde_json::to_vec(value).unwrap()
}
fn note(id: &str, at: i64, midi: u8) -> Note {
    let (step, alter) = [
        ("C", 0),
        ("C", 1),
        ("D", 0),
        ("D", 1),
        ("E", 0),
        ("F", 0),
        ("F", 1),
        ("G", 0),
        ("G", 1),
        ("A", 0),
        ("A", 1),
        ("B", 0),
    ][usize::from(midi % 12)];
    Note {
        id: id.into(),
        at: Beat::new(at, 3),
        duration: Beat::new(1, 3),
        pitch: Some(Pitch {
            step: step.into(),
            alter,
            octave: (midi / 12) as i8 - 1,
        }),
        voice: "1".into(),
        staff: 1,
        velocity: 91,
        tie_start: false,
        tie_stop: false,
    }
}
fn score(notes: Vec<Note>) -> Score {
    let mut score = score_core::catalog().remove(0);
    score.id = "independent-pitch-mod-fixture".into();
    score.title = "Original mechanical pitch invariant".into();
    score.parts = vec![Part {
        id: "pitched-part".into(),
        name: "Drums".into(),
        instrument: "percussion".into(),
        notes,
    }];
    score.tempo[0].bpm = 120.0;
    score.meters.clear();
    score.measures.clear();
    score.keys.clear();
    score.repeats.clear();
    score
}
fn scope(source: &PracticeSource) -> AssistanceSelection {
    AssistanceSelection {
        selected_part_ids: source.part_ids().to_vec(),
        profile: InstrumentProfile::Piano {
            key_count: 88,
            lowest_midi: Some(21),
        },
    }
}
fn assert_shift(original: &PracticeSource, projection: &PitchProjection, shift: i16) {
    let actual = projection.source();
    assert_eq!(bytes(original.source_units()), bytes(actual.source_units()));
    assert_eq!(original.part_ids(), actual.part_ids());
    assert_eq!(
        original.timeline().duration_ms.to_bits(),
        actual.timeline().duration_ms.to_bits()
    );
    assert_eq!(
        original.timeline().notes.len(),
        actual.timeline().notes.len()
    );
    let percussion: BTreeSet<_> = projection
        .source_pitches()
        .iter()
        .filter(|n| n.percussion)
        .map(|n| n.source_id.as_str())
        .collect();
    for (before, after) in original
        .timeline()
        .notes
        .iter()
        .zip(&actual.timeline().notes)
    {
        let delta = if before
            .source_note_ids
            .iter()
            .any(|id| percussion.contains(id.as_str()))
        {
            0
        } else {
            shift
        };
        assert_eq!(
            i16::from(after.midi),
            i16::from(before.midi) + delta,
            "{}",
            before.id
        );
        let mut expected = before.clone();
        expected.midi = after.midi;
        assert_eq!(
            bytes(&expected),
            bytes(after),
            "Only actual pitch changes: {}",
            before.id
        );
    }
    for pitch in projection.source_pitches() {
        assert_eq!(
            i16::from(pitch.effective_midi),
            i16::from(pitch.original_midi) + if pitch.percussion { 0 } else { shift }
        );
    }
    assert_eq!(projection.original_receipt(), original.receipt());
    if shift == 0 {
        assert_eq!(bytes(original.timeline()), bytes(actual.timeline()));
        assert_eq!(actual.receipt(), original.receipt());
        assert!(projection.identity().is_none());
    } else {
        assert_eq!(
            actual.receipt().source_binding,
            original.receipt().source_binding
        );
        assert_eq!(
            actual.receipt().source_profile,
            original.receipt().source_profile
        );
        assert_eq!(actual.receipt().choice, original.receipt().choice);
        assert_ne!(
            actual.receipt().runtime_digest,
            original.receipt().runtime_digest
        );
        assert_eq!(projection.identity().unwrap().semitones, shift);
    }
}

#[test]
fn all_25_shifts_retain_ties_repeats_rest_ids_and_exact_source_clocks() {
    let mut notes = vec![
        note("tie-head", 0, 60),
        note("tie-tail", 1, 60),
        note("same-key", 0, 60),
        note("later", 2, 67),
        note("rest", 3, 0),
    ];
    notes[0].tie_start = true;
    notes[1].tie_stop = true;
    notes[4].pitch = None;
    let mut score = score(notes);
    score.repeats = vec![Repeat {
        from: Beat::ZERO,
        to: Beat::new(4, 3),
        times: 2,
    }];
    let before = bytes(&score);
    let original = PracticeSource::from_canonical(&score).unwrap();
    for shift in -12..=12 {
        let projected = PitchProjection::from_canonical(&score, shift).unwrap();
        assert_shift(&original, &projected, shift);
        assert_eq!(bytes(&score), before);
        let mut notation = serde_json::to_value(projected.notation()).unwrap();
        let untouched = serde_json::to_value(&score).unwrap();
        for (actual, original) in notation["parts"][0]["notes"]
            .as_array_mut()
            .unwrap()
            .iter_mut()
            .zip(untouched["parts"][0]["notes"].as_array().unwrap())
        {
            actual["pitch"] = original["pitch"].clone();
        }
        assert_eq!(notation, untouched);
        assert!(
            projected.source_pitches().iter().all(|p| !p.percussion),
            "Names never turn canonical pitched notes into percussion"
        );
    }
}

#[test]
fn written_keys_keep_mode_and_unknown_key_stays_unknown() {
    for mode in ["major", "minor", "dorian", ""] {
        let mut source = score(vec![note("C4", 0, 60)]);
        source.keys = vec![Key {
            at: Beat::ZERO,
            fifths: 0,
            mode: mode.into(),
        }];
        let projected = PitchProjection::from_canonical(&source, 2).unwrap();
        let written = projected.notation().parts[0].notes[0]
            .pitch
            .as_ref()
            .unwrap();
        assert_eq!((&*written.step, written.alter, written.octave), ("D", 0, 4));
        assert_eq!(projected.notation().keys[0].fifths, 2);
        assert_eq!(projected.notation().keys[0].mode, mode);
        assert_eq!(bytes(&projected.notation().keys[0].at), bytes(&Beat::ZERO));
    }
    let unknown = score(vec![note("C4", 0, 60)]);
    let projected = PitchProjection::from_canonical(&unknown, 2).unwrap();
    assert!(projected.notation().keys.is_empty());
    assert_eq!(projected.source().timeline().notes[0].midi, 62);
}

#[test]
fn range_and_shift_failures_are_whole_action_and_source_is_immutable() {
    for (pitch, shift) in [(0, -1), (127, 1), (60, -13), (60, 13)] {
        let source = score(vec![
            note("safe-first", 0, 60),
            note("boundary-later", 1, pitch),
        ]);
        let before = bytes(&source);
        let failure = PitchProjection::from_canonical(&source, shift)
            .err()
            .expect("No partial successful projection");
        assert_eq!(
            failure.code,
            if shift.abs() > 12 {
                "pitch_mod_shift"
            } else {
                "pitch_mod_midi_range"
            }
        );
        assert_eq!(bytes(&source), before);
        assert_eq!(
            bytes(
                PitchProjection::from_canonical(&source, 0)
                    .unwrap()
                    .notation()
            ),
            before
        );
    }
    let mut rest = note("rest", 0, 60);
    rest.pitch = None;
    let source = score(vec![rest]);
    assert!(PitchProjection::from_canonical(&source, 0)
        .unwrap()
        .identity()
        .is_none());
    assert_eq!(
        PitchProjection::from_canonical(&source, 1)
            .err()
            .unwrap()
            .code,
        "pitch_mod_no_pitched_notes"
    );
}

fn basic() -> score_core::basic_keys::CompleteBasicKeys {
    // Channel 0 is falsely labeled drums; channel 10 is falsely labeled piano.
    // FIFO pairing, bends, sustain/program events and raw IDs come from Rust.
    let track = vec![
        0, 255, 3, 5, b'D', b'r', b'u', b'm', b's', 0, 255, 4, 10, b'p', b'e', b'r', b'c', b'u',
        b's', b's', b'i', b'o', b'n', 0, 255, 0x59, 2, 0, 0, 0, 0xc0, 42, 0, 0xe0, 0, 80, 0, 0xb0,
        64, 127, 0, 0x90, 60, 90, 24, 0x90, 60, 80, 24, 0x80, 60, 0, 48, 0x80, 60, 0, 0, 0xb0, 64,
        0, 0, 0xe0, 0, 64, 0, 0x90, 64, 90, 48, 0x80, 64, 0, 24, 255, 47, 0,
    ];
    let misleading_piano = vec![
        0, 255, 3, 11, b'G', b'r', b'a', b'n', b'd', b' ', b'P', b'i', b'a', b'n', b'o', 0, 255, 4,
        5, b'P', b'i', b'a', b'n', b'o', 0, 0xc9, 0, 0, 0x99, 35, 100, 24, 0x89, 35, 0, 24, 255,
        47, 0,
    ];
    let mut bytes = b"MThd\0\0\0\x06\0\x01\0\x02\0\x60".to_vec();
    for track in [track, misleading_piano] {
        bytes.extend(b"MTrk");
        bytes.extend((track.len() as u32).to_be_bytes());
        bytes.extend(track);
    }
    score_core::basic_keys::convert_midi(&bytes, "Original adversarial names and FIFO").unwrap()
}

#[test]
fn basic_full_fifo_interpretation_controls_and_percussion_are_authoritative() {
    let score = basic();
    let before = bytes(&score);
    let original = PracticeSource::from_basic(&score).unwrap();
    let compiled = score_core::basic_keys::compile_rendition(&score).unwrap();
    for shift in [-12, -2, 0, 2, 12] {
        let projected = PitchProjection::from_basic(&score, shift).unwrap();
        assert_shift(&original, &projected, shift);
        assert_eq!(
            projected
                .source_pitches()
                .iter()
                .filter(|n| n.percussion)
                .count(),
            1
        );
        let drum = projected
            .source_pitches()
            .iter()
            .find(|n| n.percussion)
            .unwrap();
        assert_eq!(drum.original_midi, 35);
        assert_eq!(drum.effective_midi, 35);
        let c4: Vec<_> = projected
            .source_pitches()
            .iter()
            .filter(|n| n.original_midi == 60)
            .collect();
        assert_eq!(c4.len(), 2);
        assert!(c4.iter().all(|n| !n.percussion));
        for original in &compiled.rendition.notes {
            let actual = projected
                .source()
                .timeline()
                .notes
                .iter()
                .find(|n| n.id == original.note_id)
                .unwrap();
            let initial = compiled
                .timeline
                .notes
                .iter()
                .find(|n| n.id == original.note_id)
                .unwrap();
            assert_eq!(actual.start_ms.to_bits(), initial.start_ms.to_bits());
            assert_eq!(actual.duration_ms.to_bits(), initial.duration_ms.to_bits());
        }
        assert_eq!(
            bytes(&score),
            before,
            "All original channel records and controls retained"
        );
    }
}

#[test]
fn complete_native_sources_keep_their_runtime_origin_and_tied_source_units() {
    let vsq = score_core::vsq_clean::decode_json(include_bytes!(
        "../../../tests/fixtures/vsq-clean-v1/score.json"
    ))
    .unwrap();
    let choice = score_core::vsq_clean::PracticeChoice::BaseNotesInstrumental;
    let original = PracticeSource::from_vsq(&vsq, choice).unwrap();
    assert_eq!(original.timeline().notes[0].start_ms, 0.0);
    for shift in [-12, 0, 2, 12] {
        assert_shift(
            &original,
            &PitchProjection::from_vsq(&vsq, choice, shift).unwrap(),
            shift,
        );
    }
    let semantic = score_core::clean_song::decode_json(include_bytes!(
        "../../../tests/fixtures/clean-song-v2/score.json"
    ))
    .unwrap();
    let original = PracticeSource::from_complete_midi(&semantic).unwrap();
    for shift in [-12, 0, 2, 12] {
        assert_shift(
            &original,
            &PitchProjection::from_complete_midi(&semantic, shift).unwrap(),
            shift,
        );
    }
}

#[test]
fn shifted_receipts_reject_old_human_plans_and_bind_shift_source_and_saved_bytes() {
    let score = score(vec![note("human", 0, 60), note("machine", 2, 67)]);
    let original = PracticeSource::from_canonical(&score).unwrap();
    let selected = scope(&original);
    let prior = automatic_assistance::create(&original, &selected, &["human".into()]).unwrap();
    let prior_progression =
        practice_progression::generate(&original, &selected, ProgressionLayer::Single).unwrap();
    let projected = PitchProjection::from_canonical(&score, 2).unwrap();
    assert!(automatic_assistance::validate(projected.source(), &prior.plan).is_err());
    assert!(practice_progression::validate(projected.source(), &prior_progression.plan).is_err());
    let checked =
        automatic_assistance::create(projected.source(), &selected, &["human".into()]).unwrap();
    assert_eq!(checked.human_targets.timeline.notes[0].midi, 62);
    assert_eq!(checked.machine_occurrence_ids, vec!["machine"]);
    assert_eq!(
        projected
            .source()
            .timeline()
            .notes
            .iter()
            .find(|n| n.id == "machine")
            .unwrap()
            .midi,
        69
    );
    assert!(automatic_assistance::validate(&original, &checked.plan).is_err());
    let different = PitchProjection::from_canonical(&score, 3).unwrap();
    assert!(automatic_assistance::validate(different.source(), &checked.plan).is_err());
    assert_ne!(bytes(&projected.identity()), bytes(&different.identity()));
    let mut renamed = score.clone();
    renamed.title.push('!');
    let changed = PitchProjection::from_canonical(&renamed, 2).unwrap();
    assert_ne!(projected.source().receipt(), changed.source().receipt());
    let saved = PitchProjection::from_canonical(&score, 2)
        .unwrap()
        .with_verified_saved_binding(&"a".repeat(64))
        .unwrap();
    let other = PitchProjection::from_canonical(&score, 2)
        .unwrap()
        .with_verified_saved_binding(&"b".repeat(64))
        .unwrap();
    assert_ne!(saved.source().receipt(), other.source().receipt());
    assert_ne!(bytes(&saved.identity()), bytes(&other.identity()));
    let zero = PitchProjection::from_canonical(&score, 0).unwrap();
    assert_eq!(
        bytes(&automatic_assistance::validate(zero.source(), &prior.plan).unwrap()),
        bytes(&prior)
    );
    assert_eq!(
        bytes(&practice_progression::validate(zero.source(), &prior_progression.plan).unwrap()),
        bytes(&prior_progression)
    );
}

#[test]
fn raw_d4_input_hits_effective_d4_without_another_shift() {
    let score = score(vec![note("C4", 0, 60)]);
    let projection = PitchProjection::from_canonical(&score, 2).unwrap();
    let input: score_core::InputEvent =
        serde_json::from_value(json!({"midi":62,"at_ms":0.0,"velocity":90})).unwrap();
    let assessment = score_core::assess(projection.source().timeline(), &[input], 100.0).unwrap();
    let value: Value = serde_json::to_value(assessment).unwrap();
    assert_eq!(value["hits"].as_array().unwrap().len(), 1);
    assert_eq!(value["misses"], json!([]));
    assert_eq!(value["extras"], json!([]));
}

#[test]
fn conflicting_global_key_maps_reject_without_spelling_fallback() {
    let mut original = score(vec![note("double-accidental", 0, 61)]);
    original.parts[0].notes[0].pitch = Some(Pitch {
        step: "B".into(),
        alter: 2,
        octave: 3,
    });
    let shift = PitchProjection::from_canonical(&original, 2).unwrap();
    assert_eq!(
        shift.notation().parts[0].notes[0]
            .pitch
            .as_ref()
            .unwrap()
            .midi(),
        Some(63)
    );
    original.keys = vec![
        Key {
            at: Beat::ZERO,
            fifths: -7,
            mode: "minor".into(),
        },
        Key {
            at: Beat::new(1, 6),
            fifths: 7,
            mode: "major".into(),
        },
    ];
    let before = bytes(&original);
    assert_eq!(
        PitchProjection::from_canonical(&original, 1)
            .err()
            .unwrap()
            .code,
        "pitch_mod_spelling"
    );
    assert_eq!(bytes(&original), before);
    assert_eq!(
        bytes(
            PitchProjection::from_canonical(&original, 0)
                .unwrap()
                .notation()
        ),
        before
    );
}

#[test]
fn forged_basic_derived_notes_never_override_complete_source_events() {
    let original = basic();
    for field in ["pitch", "clock", "identity", "omission"] {
        let mut forged = original.clone();
        match field {
            "pitch" => forged.performance.notes[0].key += 1,
            "clock" => forged.performance.notes[0].start.tick += 1,
            "identity" => forged.performance.notes[0].note_id.push('x'),
            "omission" => {
                forged.performance.notes.pop();
            }
            _ => unreachable!(),
        }
        assert!(
            PitchProjection::from_basic(&forged, 0).is_err(),
            "Even zero validates {field}"
        );
        assert!(
            PitchProjection::from_basic(&forged, 2).is_err(),
            "Shift cannot admit forged {field}"
        );
    }
}

#[test]
fn mixed_percussion_pages_never_inherit_the_pitched_key_signature() {
    let original = basic();
    let projection = PitchProjection::from_basic(&original, 2).unwrap();
    let mut saw_melodic = false;
    let mut saw_percussion = false;
    for part in &original.performance.parts {
        let request = score_core::basic_keys::NotationRequest {
            part_id: part.id.clone(),
            rendition_policy_id: Some(score_core::basic_keys::RENDITION_POLICY.into()),
            first_measure: 0,
            measure_count: 2,
            display_meter: Some(score_core::basic_keys::DisplayMeter {
                numerator: 4,
                denominator: 4,
            }),
            position_ms: None,
        };
        let before = score_core::basic_keys::notation_page(&original, &request).unwrap();
        let after = projection.basic_notation_page(&original, &request).unwrap();
        if part.channel == 9 {
            saw_percussion = true;
            assert_eq!(after.status, "percussion_selectors");
            assert!(
                after.score.is_none(),
                "No pitched staff or shifted key signature for percussion"
            );
            assert!(
                after.musicxml.is_none(),
                "No accidental-bearing pitched MusicXML for percussion"
            );
            assert_eq!(
                bytes(&before),
                bytes(&after),
                "Entire percussion-only page is unaffected by mixed-song transposition"
            );
            assert_eq!(after.selectors[0].key, 35);
        } else {
            saw_melodic = true;
            let written = after.score.unwrap();
            assert_eq!(written.keys[0].fifths, 2);
            assert_eq!(written.keys[0].mode, "major");
            assert!(written.parts[0]
                .notes
                .iter()
                .filter_map(|n| n.pitch.as_ref())
                .all(|p| [62, 66].contains(&p.midi().unwrap())));
        }
    }
    assert!(saw_melodic && saw_percussion);
}

#[test]
fn percussion_only_zero_succeeds_and_nonzero_reports_no_pitched_notes() {
    let track = [
        0, 255, 0x59, 2, 0, 0, 0, 0x99, 127, 90, 24, 0x89, 127, 0, 0, 255, 47, 0,
    ];
    let mut raw = b"MThd\0\0\0\x06\0\x00\0\x01\0\x60MTrk".to_vec();
    raw.extend((track.len() as u32).to_be_bytes());
    raw.extend(track);
    let original =
        score_core::basic_keys::convert_midi(&raw, "Original percussion-only boundary").unwrap();
    let before = bytes(&original);
    let source = PracticeSource::from_basic(&original).unwrap();
    assert_shift(
        &source,
        &PitchProjection::from_basic(&original, 0).unwrap(),
        0,
    );
    for shift in [-12, 1, 12] {
        assert_eq!(
            PitchProjection::from_basic(&original, shift)
                .err()
                .unwrap()
                .code,
            "pitch_mod_no_pitched_notes"
        );
        assert_eq!(bytes(&original), before);
    }
}
