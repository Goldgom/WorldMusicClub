//! Reproducibility and semantic boundaries of original acceptance fixtures.
#[path = "support/performance_acceptance_fixture.rs"]
mod fixture;
use serde_json::{json, Value};
use std::{collections::BTreeMap, fs, path::PathBuf};
use worldmusichub_desktop::native_library::{clean_package, NativeLibrary};

#[test]
fn committed_acceptance_fixtures_are_exact_native_outputs_for_original_songs() {
    let root = std::env::temp_dir().join(format!(
        "wmh-performance-fixture-contract-{}",
        std::process::id()
    ));
    fs::create_dir(&root).unwrap();
    let library = NativeLibrary::open(root.join("Scores")).unwrap();
    let committed = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../tests/fixtures");
    for (index, name) in fixture::FIXTURES.into_iter().enumerate() {
        let files = fixture::files(name);
        for (path, bytes) in &files {
            assert_eq!(fs::read(committed.join(name).join(path)).unwrap(), *bytes);
        }
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
        assert!(runtime.get("notes").is_none());
        assert_eq!(
            runtime["duration_microseconds"],
            json!({"numerator":"5000010","denominator":1})
        );
        assert_eq!(
            runtime["tracks"].as_array().unwrap().len(),
            if index == 0 { 11 } else { 2 }
        );
        assert_eq!(runtime["coverage"]["targets"]["represented_attacks"], 0);
        let events = runtime["events"].as_array().unwrap();
        let attacks = events
            .iter()
            .filter(|event| event["command"]["kind"] == "key_attack")
            .collect::<Vec<_>>();
        let releases = events
            .iter()
            .filter(|event| event["command"]["kind"] == "key_release")
            .collect::<Vec<_>>();
        assert_eq!(
            attacks.len(),
            if index == 0 {
                20
            } else if index == 1 {
                2
            } else {
                3
            }
        );
        assert_eq!(attacks.len(), releases.len());
        for event in attacks.iter().chain(&releases) {
            assert!(event["command"].get("duration").is_none());
            assert!(event["command"].get("release_event_id").is_none());
        }
        if index == 1 {
            let values = events
                .iter()
                .filter(|event| event["command"]["kind"] == "sustain")
                .map(|event| event["command"]["value"].clone())
                .collect::<Vec<Value>>();
            assert_eq!(
                values,
                [
                    json!(0),
                    json!(0),
                    json!(63),
                    json!(64),
                    json!(127),
                    json!(0)
                ]
            );
            assert_eq!(
                events
                    .iter()
                    .filter(|event| event["command"]["kind"] == "initial_controller_reset")
                    .count(),
                2
            );
        }
        if index >= 2 {
            let setup = events
                .iter()
                .filter(|event| event["command"]["kind"] == "initial_pitch_bend_sensitivity12")
                .collect::<Vec<_>>();
            let steps = [
                "select_least_significant_zero",
                "select_most_significant_zero",
                "select_least_significant_zero",
                "select_most_significant_zero",
                "set_semitones12",
                "set_semitones12",
                "set_cents_zero",
                "set_cents_zero",
            ];
            assert_eq!(setup.len(), steps.len());
            for (i, event) in setup.iter().enumerate() {
                assert_eq!(event["command"]["step"], steps[i]);
                assert_eq!(event["origin"], json!({"track":1,"event":5+i}));
                let at = &event["exact_microseconds"];
                assert_eq!(
                    at["numerator"].as_str().unwrap().parse::<u64>().unwrap() * 6,
                    (i as u64 + 1) * 500001 * at["denominator"].as_u64().unwrap()
                );
            }
            let names = events
                .iter()
                .filter(|event| event["command"]["role"] == "device_name")
                .collect::<Vec<_>>();
            assert_eq!(names.len(), 1);
            assert_eq!(names[0]["command"]["text"], fixture::AUTHORED_DEVICE);
            for (notes, ticks) in [(&attacks, [9, 15, 21]), (&releases, [33, 39, 45])] {
                for ((event, key), tick) in notes.iter().zip([60, 64, 67]).zip(ticks) {
                    assert_eq!(event["command"]["key"], key);
                    let at = &event["exact_microseconds"];
                    assert_eq!(
                        at["numerator"].as_str().unwrap().parse::<u64>().unwrap() * 6,
                        tick * 500001 * at["denominator"].as_u64().unwrap()
                    );
                }
            }
            assert!(events
                .iter()
                .all(|event| event["command"]["kind"] != "pitch_bend"));
            let bank = events
                .iter()
                .find(|event| event["command"]["kind"] == "bank_select")
                .unwrap();
            assert_eq!(bank["command"]["value"], u8::from(index == 3));
        }
    }
    assert_eq!(
        library.list().unwrap().entries.len(),
        fixture::FIXTURES.len()
    );
    drop(library);
    fs::remove_dir_all(root).unwrap();
}
