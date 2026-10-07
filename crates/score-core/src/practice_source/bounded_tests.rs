use super::*;
use serde::ser::SerializeSeq;

#[test]
fn streaming_fingerprints_preserve_exact_revision_one_json_bytes() {
    let score = crate::catalog().remove(0);
    let source = PracticeSource::from_canonical(&score).unwrap();
    assert_eq!(
        hash(&score).unwrap(),
        format!("{:x}", Sha256::digest(serde_json::to_vec(&score).unwrap()))
    );
    let ordered_gates: Vec<_> = source
        .timeline
        .notes
        .iter()
        .map(|n| (&n.id, &source.gates[&n.id]))
        .collect();
    let excluded: Vec<&String> = vec![];
    let runtime = (
        CANONICAL_RUNTIME_POLICY,
        None::<vsq_clean::PracticeChoice>,
        &source.timeline,
        ordered_gates,
        excluded,
    );
    assert_eq!(
        source.receipt.runtime_digest,
        format!(
            "{:x}",
            Sha256::digest(serde_json::to_vec(&runtime).unwrap())
        )
    );
    let escaped = (
        "\"\\\n\u{0000}日本語",
        Exact::new(u128::MAX, 17).unwrap(),
        -0.0,
        f64::MIN_POSITIVE,
    );
    let bytes = serde_json::to_vec(&escaped).unwrap();
    assert_eq!(
        hash_with_limit(&escaped, bytes.len()).unwrap(),
        format!("{:x}", Sha256::digest(&bytes))
    );
    assert_eq!(
        hash_with_limit(&escaped, bytes.len() - 1).unwrap_err().code,
        "practice_source_limit"
    );
}

#[test]
fn streaming_limit_aborts_before_visiting_the_rest_of_a_large_value() {
    struct ManyChunks<'a>(&'a std::cell::Cell<usize>);
    impl Serialize for ManyChunks<'_> {
        fn serialize<S: serde::Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
            let mut seq = serializer.serialize_seq(Some(100_000))?;
            for _ in 0..100_000 {
                self.0.set(self.0.get() + 1);
                seq.serialize_element(&[b'x'; 1024].as_slice())?;
            }
            seq.end()
        }
    }
    let visited = std::cell::Cell::new(0);
    assert_eq!(
        hash(&ManyChunks(&visited)).unwrap_err().code,
        "practice_source_limit"
    );
    assert!(
        visited.get() < 10_000,
        "Serialization must stop at the unchanged 32 MiB budget"
    );
    let mut writer = BoundedWriter {
        writer: vec![],
        bytes: 0,
        limit: 3,
        exceeded: false,
    };
    assert!(writer.write(b"four").is_err());
    assert!(writer.write(b"x").is_err());
    assert!(
        writer.writer.is_empty(),
        "No prefix of an over-budget chunk is written"
    );
}

#[test]
fn serialization_errors_are_not_misreported_as_capacity_failures() {
    struct Invalid;
    impl Serialize for Invalid {
        fn serialize<S: serde::Serializer>(&self, _: S) -> Result<S::Ok, S::Error> {
            Err(serde::ser::Error::custom("intentional encoding failure"))
        }
    }
    assert_eq!(hash(&Invalid).unwrap_err().code, "practice_source_encoding");
}

fn widest_derived_note() -> basic_keys::KeyNote {
    // Wider scalar values than the accepted 128 tracks / 250,000 events /
    // 1,000,000,000 ticks prove headroom without relying on a private score.
    let position = basic_keys::Position {
        tick: u64::MAX,
        beat: Beat::new(i64::MAX, i64::MAX - 1),
        relative_microseconds: Some(basic_keys::ExactMicroseconds {
            numerator: u64::MAX.to_string(),
            denominator: u16::MAX,
        }),
    };
    let coordinate = basic_keys::Coordinate {
        track: u16::MAX,
        event: u32::MAX,
    };
    basic_keys::KeyNote {
        note_id: "midi-t65536-e4294967296".into(),
        part_id: format!("midi-t65536-c256-r{}", usize::MAX),
        key: u8::MAX,
        velocity: u8::MAX,
        attack: coordinate,
        start: position.clone(),
        end: Some(position),
        release: basic_keys::ReleaseEvidence {
            status: basic_keys::ReleaseStatus::RouteInvariantReleaseTime,
            first: Some(coordinate),
            last: Some(coordinate),
            candidate_count: usize::MAX,
            may_be_unreleased: false,
        },
    }
}

#[test]
fn every_derived_note_is_bounded_separately_at_the_maximum_inventory() {
    let mut note = widest_derived_note();
    for status in [
        basic_keys::ReleaseStatus::UniqueRelease,
        basic_keys::ReleaseStatus::EquivalentReleaseTime,
        basic_keys::ReleaseStatus::AmbiguousReleaseTime,
        basic_keys::ReleaseStatus::MissingRelease,
        basic_keys::ReleaseStatus::PossiblyUnreleased,
        basic_keys::ReleaseStatus::UnresolvedRouteOwnership,
        basic_keys::ReleaseStatus::RouteInvariantReleaseTime,
    ] {
        note.release.status = status;
        assert!(serialize_bounded(&note, io::sink(), MAX_BASIC_DERIVED_NOTE_BYTES).is_ok());
    }
    let notes = vec![&note; MAX_SOURCE_UNITS];
    let bound = MAX_SOURCE_UNITS * (MAX_BASIC_DERIVED_NOTE_BYTES + 1) + 1;
    assert!(serialize_bounded(&notes, io::sink(), bound).unwrap().bytes <= bound);
    note.note_id = "x".repeat(MAX_BASIC_DERIVED_NOTE_BYTES);
    assert_eq!(
        serialize_bounded(&note, io::sink(), MAX_BASIC_DERIVED_NOTE_BYTES)
            .err()
            .unwrap()
            .code,
        "practice_source_limit"
    );
}

fn original_basic_fixture(notes_per_part: usize) -> basic_keys::CompleteBasicKeys {
    // Original mechanical repeated-key data, five synchronized tracks. This is
    // a capacity/unison fixture, not music copied from any imported song.
    let mut bytes = b"MThd\0\0\0\x06\0\x01\0\x05\0\x60".to_vec();
    for channel in 0..5_u8 {
        let mut track = vec![0, 0xc0 | channel, 0];
        for _ in 0..notes_per_part {
            track.extend([1, 0x90 | channel, 60, 90, 1, 0x80 | channel, 60, 0]);
        }
        track.extend([0, 255, 47, 0]);
        bytes.extend(b"MTrk");
        bytes.extend((track.len() as u32).to_be_bytes());
        bytes.extend(track);
    }
    basic_keys::convert_midi(&bytes, "Original five-track capacity exercise").unwrap()
}

#[test]
fn basic_budget_adds_only_the_exact_reconstructed_field() {
    for notes_per_part in [0, 1, 10] {
        let score = original_basic_fixture(notes_per_part);
        let wire = basic_keys::encode_json(&score).unwrap();
        let complete = serde_json::to_vec(&score).unwrap();
        let budget = basic_source_byte_limit(&score).unwrap();
        assert_eq!(
            complete.len() - wire.len(),
            budget - basic_keys::MAX_JSON_BYTES
        );
        assert_eq!(
            hash_with_limit(&score, budget).unwrap(),
            format!("{:x}", Sha256::digest(&complete))
        );
        let exact_fit_budget = wire.len() + budget - basic_keys::MAX_JSON_BYTES;
        assert!(hash_with_limit(&score, exact_fit_budget).is_ok());
        assert_eq!(
            hash_with_limit(&score, exact_fit_budget - 1)
                .unwrap_err()
                .code,
            "practice_source_limit"
        );
    }
}

#[test]
fn basic_expansion_allowance_cannot_hide_oversized_wire_data_or_extra_notes() {
    let mut score = original_basic_fixture(1);
    let budget = basic_source_byte_limit(&score).unwrap();
    // Arbitrary metadata does not receive the unused part of a per-note cap.
    score.notation.title = "x".repeat(basic_keys::MAX_JSON_BYTES);
    assert_eq!(basic_source_byte_limit(&score).unwrap(), budget);
    assert_eq!(
        hash_with_limit(&score, budget).unwrap_err().code,
        "practice_source_limit"
    );
    assert_eq!(score.notation.title.len(), basic_keys::MAX_JSON_BYTES);
    score.notation.title.clear();
    score.performance.notes = vec![score.performance.notes[0].clone(); MAX_SOURCE_UNITS + 1];
    assert_eq!(
        PracticeSource::from_basic(&score).unwrap_err().code,
        "practice_source_limit"
    );
    assert_eq!(score.performance.notes.len(), MAX_SOURCE_UNITS + 1);
}

#[test]
fn large_original_basic_source_keeps_all_gates_and_strict_plan_identity() {
    use crate::automatic_assistance::{self as assistance, AssistanceSelection, AutomaticSettings};
    let score = original_basic_fixture(12_000);
    let wire = basic_keys::encode_json(&score).unwrap();
    assert!(wire.len() < basic_keys::MAX_JSON_BYTES);
    let expanded_bytes =
        serialize_bounded(&score, io::sink(), basic_source_byte_limit(&score).unwrap())
            .unwrap()
            .bytes;
    assert!(
        expanded_bytes > MAX_SOURCE_BYTES,
        "Fixture must reproduce the old source-binding refusal"
    );
    let source = PracticeSource::from_basic(&score).unwrap();
    assert_eq!(source.timeline.notes.len(), 60_000);
    assert_eq!(source.units.len(), 60_000);
    assert_eq!(source.gates.len(), 60_000);
    assert_eq!(source.receipt.source_binding.serialization_revision, 1);
    assert_eq!(
        source.receipt.source_binding.domain,
        "wmc-basic-complete-serde-json"
    );
    let selection = AssistanceSelection {
        selected_part_ids: source.parts.clone(),
        profile: crate::instruments::InstrumentProfile::Piano {
            key_count: 88,
            lowest_midi: Some(21),
        },
    };
    let checked = assistance::generate(&source, &selection, &AutomaticSettings::default()).unwrap();
    assert_eq!(checked.coverage.occurrence_count, 60_000);
    assert_eq!(
        checked.coverage.human_occurrence_count + checked.coverage.machine_occurrence_count,
        60_000
    );
    assert_eq!(
        assistance::validate(&source, &checked.plan)
            .unwrap()
            .plan
            .selection_digest,
        checked.plan.selection_digest
    );
    assert_eq!(
        assistance::create(&source, &selection, &[source.units[0].source_id.clone()])
            .unwrap_err()
            .code,
        "assistance_partial_atom"
    );
    let mut stale = checked.plan;
    stale.receipt.source_binding.digest.replace_range(..1, "z");
    assert_eq!(
        assistance::validate(&source, &stale).unwrap_err().code,
        "assistance_source_mismatch"
    );
    assert_eq!(basic_keys::encode_json(&score).unwrap(), wire);
    eprintln!(
        "original Basic stress: {} compact bytes, {} expanded bytes, {} intact gates",
        wire.len(),
        expanded_bytes,
        source.gates.len()
    );
}
