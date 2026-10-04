//! Reproducibility and raw-parser evidence for newly authored pitch acceptance.
#[path = "support/pitch_acceptance_fixture.rs"]
mod fixture;
use score_core::{
    clean_performance,
    midi_events::{self, ChannelMessage, EventKind},
};
use serde_json::{json, Value};
use std::{collections::BTreeMap, fs, path::PathBuf};
use worldmusichub_desktop::native_library::{clean_package, NativeLibrary};

#[test]
fn authored_pitch_pack_regenerates_through_native_load_with_exact_source_events() {
    let root =
        std::env::temp_dir().join(format!("wmh-pitch-fixture-contract-{}", std::process::id()));
    fs::create_dir(&root).unwrap();
    let library = NativeLibrary::open(root.join("Scores")).unwrap();
    let committed = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../tests/fixtures");
    for (index, name) in fixture::FIXTURES.into_iter().enumerate() {
        let source_bytes = fixture::authored_source(name);
        let source = midi_events::parse_midi_events(&source_bytes, None).unwrap();
        let files = fixture::files(name);
        for (path, bytes) in &files {
            assert_eq!(fs::read(committed.join(name).join(path)).unwrap(), *bytes);
        }
        let metadata: Value = serde_json::from_slice(&files["metadata.json"]).unwrap();
        assert_eq!(
            metadata["rights"],
            json!({"status":"original_authored", "license":"CC0-1.0", "attribution": fixture::ATTRIBUTION})
        );
        assert_eq!(
            metadata["sources"][0]["sha256"],
            fixture::hash(&source_bytes)
        );
        assert_eq!(metadata["sources"][0]["bytes"], source_bytes.len());
        assert_eq!(metadata["media"], json!([]));
        let score = clean_performance::decode_json(&files["score.json"]).unwrap();
        let expected_runtime =
            clean_performance::compile_performance(&files["score.json"]).unwrap();
        assert!(score.notation.is_none());
        assert!(score_core::clean_song::convert_midi(&source_bytes).is_err());
        assert!(score_core::import_midi(&source_bytes).is_err());
        let inventory = files
            .iter()
            .map(|(path, bytes)| (path.clone(), (bytes.len() as u64, fixture::hash(bytes))))
            .collect::<BTreeMap<_, _>>();
        let package =
            clean_package::parse(&files["metadata.json"], &files["score.json"], &inventory)
                .unwrap();
        assert!(package.notation_json.is_none());
        assert!(!package.summary().notation_available);
        let entry = clean_package::save(
            &library,
            &package,
            None,
            false,
            &mut |_media: &clean_package::Media| panic!("No media fixture expected"),
        )
        .unwrap();
        let mut loaded = library.load(&entry.key).unwrap();
        loaded.entry.saved_at_unix_ms = fixture::SAVED_AT_UNIX_MS;
        assert_eq!(
            serde_json::to_vec_pretty(&loaded).unwrap(),
            fs::read(committed.join(format!("{name}-native-open.json"))).unwrap()
        );
        assert!(loaded.score_json.is_none());
        let runtime = &loaded.clean_package.unwrap().runtime;
        assert_eq!(*runtime, serde_json::to_value(&expected_runtime).unwrap());
        assert!(runtime.get("notes").is_none());
        assert_eq!(runtime["tracks"].as_array().unwrap().len(), 2);
        assert_eq!(
            runtime["duration_microseconds"],
            json!({"numerator":"5000010", "denominator":1})
        );
        for category in ["notation", "targets"] {
            assert_eq!(runtime["coverage"][category]["status"], "unavailable");
            assert_eq!(runtime["coverage"][category]["represented_attacks"], 0);
        }
        let events = runtime["events"].as_array().unwrap();
        assert_eq!(source.events().len(), score.performance.events.len());
        assert_eq!(source.events().len(), events.len());
        for ((raw, semantic), actual) in source
            .events()
            .iter()
            .zip(&score.performance.events)
            .zip(events)
        {
            assert_eq!(semantic.event_id, raw.id().stable_id());
            assert_eq!(semantic.origin.track, raw.id().track_index());
            assert_eq!(semantic.origin.event, raw.id().event_index());
            assert_eq!(semantic.at.numerator, raw.beat().numerator);
            assert_eq!(semantic.at.denominator, raw.beat().denominator);
            assert_eq!(actual["event_id"], raw.id().stable_id());
            assert_eq!(
                actual["origin"],
                json!({"track":raw.id().track_index(), "event":raw.id().event_index()})
            );
            assert_eq!(
                actual["command"],
                serde_json::to_value(&semantic.command).unwrap()
            );
            let exact = raw.relative_microseconds().unwrap();
            assert_eq!(
                actual["exact_microseconds"],
                json!({"numerator":exact.numerator().to_string(), "denominator":exact.denominator()})
            );
            assert_eq!(
                exact.numerator() * 6,
                raw.tick() * 500001 * u64::from(exact.denominator())
            );
            if let EventKind::Channel {
                channel,
                message: ChannelMessage::PitchBend { value },
            } = raw.kind()
            {
                assert_eq!(
                    actual["command"],
                    json!({"kind":"pitch_bend", "channel":channel, "value":value})
                );
            }
        }
        // Independent source-level expectations pin both 14-bit bytes, the
        // duplicate command, fractional clocks and the entire original melody.
        let bends = source
            .events()
            .iter()
            .filter_map(|event| match event.kind() {
                EventKind::Channel {
                    channel: 0,
                    message: ChannelMessage::PitchBend { value },
                } => Some((event.tick(), *value)),
                _ => None,
            })
            .collect::<Vec<_>>();
        assert_eq!(
            bends,
            [
                (12, 0),
                (13, 1),
                (15, 8191),
                (16, 8192),
                (22, 8193),
                (24, 16383),
                (25, 16383),
                (31, 4096),
                (48, 8192)
            ]
        );
        let keys = if index == 2 {
            [108, 112, 115]
        } else {
            [60, 64, 67]
        };
        for (kind, ticks, velocities) in [
            ("key_attack", [9, 18, 27], [90, 80, 70]),
            ("key_release", [21, 30, 33], [19, 20, 21]),
        ] {
            let notes = events
                .iter()
                .filter(|event| event["command"]["kind"] == kind)
                .collect::<Vec<_>>();
            assert_eq!(notes.len(), 3);
            for (((event, key), tick), velocity) in
                notes.into_iter().zip(keys).zip(ticks).zip(velocities)
            {
                assert_eq!(event["command"]["key"], key);
                assert_eq!(event["command"]["velocity"], velocity);
                assert!(event["command"].get("duration").is_none());
                assert!(event["command"].get("release_event_id").is_none());
                let clock = &event["exact_microseconds"];
                assert_eq!(
                    clock["numerator"].as_str().unwrap().parse::<u64>().unwrap() * 6,
                    tick * 500001 * clock["denominator"].as_u64().unwrap()
                );
            }
        }
        let setup = events
            .iter()
            .filter(|event| event["command"]["kind"] == "initial_pitch_bend_sensitivity12")
            .collect::<Vec<_>>();
        assert_eq!(setup.len(), if index == 0 { 0 } else { 4 });
        if index != 0 {
            for (step_index, (event, step)) in setup
                .iter()
                .zip([
                    "select_least_significant_zero",
                    "select_most_significant_zero",
                    "set_semitones12",
                    "set_cents_zero",
                ])
                .enumerate()
            {
                assert_eq!(event["command"]["step"], step);
                assert_eq!(event["origin"], json!({"track":1,"event":2+step_index}));
                let clock = &event["exact_microseconds"];
                assert_eq!(
                    clock["numerator"].as_str().unwrap().parse::<u64>().unwrap() * 6,
                    (step_index as u64 + 1) * 500001 * clock["denominator"].as_u64().unwrap()
                );
            }
        }
        let sustain = source
            .events()
            .iter()
            .filter_map(|event| match event.kind() {
                EventKind::Channel {
                    channel: 0,
                    message:
                        ChannelMessage::Controller {
                            controller: 64,
                            value,
                        },
                } => Some((event.tick(), *value)),
                _ => None,
            })
            .collect::<Vec<_>>();
        assert_eq!(sustain, [(20, 127), (54, 0)]);
        assert!(events
            .iter()
            .filter(|e| e["command"]["kind"] == "pitch_bend")
            .any(|e| e["exact_microseconds"]["denominator"] == 2));
    }
    assert_eq!(
        library.list().unwrap().entries.len(),
        fixture::FIXTURES.len()
    );
    drop(library);
    fs::remove_dir_all(root).unwrap();
}
