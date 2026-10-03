//! Native fingering must use validated, saved complete-song clocks and identities.
//! All packages and MIDI exercises below are wholly authored public fixtures.
use http::Request;
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::{
    collections::{BTreeMap, BTreeSet},
    fs,
    io::{Cursor, Write},
    path::{Path, PathBuf},
    sync::atomic::{AtomicU64, Ordering},
};
use worldmusichub_desktop::{
    dispatch_with_library,
    native_library::{NativeLibrary, SaveRequest},
    ORIGIN,
};

static SEQUENCE: AtomicU64 = AtomicU64::new(0);
const PIANO: &str = "/api/library/fingering/piano";
const GUITAR: &str = "/api/library/fingering/guitar";

struct Sandbox(PathBuf);
impl Sandbox {
    fn new() -> Self {
        let path = std::env::temp_dir().join(format!(
            "wmh-complete-fingering-{}-{}",
            std::process::id(),
            SEQUENCE.fetch_add(1, Ordering::Relaxed)
        ));
        fs::create_dir(&path).unwrap();
        Self(path)
    }
    fn library(&self) -> NativeLibrary {
        NativeLibrary::open(self.0.join("Scores")).unwrap()
    }
    fn bytes(&self) -> BTreeMap<PathBuf, Vec<u8>> {
        fn visit(root: &Path, folder: &Path, output: &mut BTreeMap<PathBuf, Vec<u8>>) {
            for item in fs::read_dir(folder).unwrap() {
                let path = item.unwrap().path();
                if path.is_dir() {
                    visit(root, &path, output);
                } else {
                    output.insert(
                        path.strip_prefix(root).unwrap().into(),
                        fs::read(path).unwrap(),
                    );
                }
            }
        }
        let mut output = BTreeMap::new();
        visit(&self.0, &self.0, &mut output);
        output
    }
}
impl Drop for Sandbox {
    fn drop(&mut self) {
        fs::remove_dir_all(&self.0).unwrap();
    }
}

fn vsq_files() -> BTreeMap<String, Vec<u8>> {
    BTreeMap::from([
        (
            "metadata.json".into(),
            include_bytes!("../../../tests/fixtures/vsq-clean-v1/metadata.json").to_vec(),
        ),
        (
            "score.json".into(),
            include_bytes!("../../../tests/fixtures/vsq-clean-v1/score.json").to_vec(),
        ),
    ])
}
fn midi_files() -> BTreeMap<String, Vec<u8>> {
    BTreeMap::from([
        (
            "metadata.json".into(),
            include_bytes!("../../../tests/fixtures/clean-song-v2/metadata.json").to_vec(),
        ),
        (
            "score.json".into(),
            include_bytes!("../../../tests/fixtures/clean-song-v2/score.json").to_vec(),
        ),
    ])
}
fn zip(files: &BTreeMap<String, Vec<u8>>) -> Vec<u8> {
    let mut zip = zip::ZipWriter::new(Cursor::new(Vec::new()));
    for (path, bytes) in files {
        zip.start_file(path, zip::write::SimpleFileOptions::default())
            .unwrap();
        zip.write_all(bytes).unwrap();
    }
    zip.finish().unwrap().into_inner()
}
fn request(library: &NativeLibrary, path: &str, body: Vec<u8>) -> http::Response<Vec<u8>> {
    dispatch_with_library(
        Request::builder()
            .method("POST")
            .uri(format!("{ORIGIN}{path}"))
            .header("content-type", "application/json")
            .header("x-wmh-filename", "authored-fingering.zip")
            .body(body)
            .unwrap(),
        library,
    )
}
fn post(library: &NativeLibrary, path: &str, body: &Value) -> Value {
    let response = request(library, path, serde_json::to_vec(body).unwrap());
    assert_eq!(
        response.status(),
        200,
        "{path}: {}",
        String::from_utf8_lossy(response.body())
    );
    serde_json::from_slice(response.body()).unwrap()
}
fn reject(library: &NativeLibrary, path: &str, body: &Value, status: Option<u16>) {
    let response = request(library, path, serde_json::to_vec(body).unwrap());
    assert!(
        response.status().is_client_error(),
        "{path}: accepted {body}: {}",
        String::from_utf8_lossy(response.body())
    );
    if let Some(status) = status {
        assert_eq!(
            response.status(),
            status,
            "{path}: {body}: {}",
            String::from_utf8_lossy(response.body())
        );
    }
    let error: Value = serde_json::from_slice(response.body()).unwrap();
    assert!(
        error["code"].as_str().is_some_and(|code| !code.is_empty()),
        "{error}"
    );
}
fn save(library: &NativeLibrary, files: &BTreeMap<String, Vec<u8>>, profile: &str) -> Value {
    let response = request(library, "/api/library/import/commit", zip(files));
    assert_eq!(
        response.status(),
        200,
        "{}",
        String::from_utf8_lossy(response.body())
    );
    let report: Value = serde_json::from_slice(response.body()).unwrap();
    assert_eq!(report["summary"]["saved"], 1, "{report}");
    let key = report["items"][0]["entry"]["key"].as_str().unwrap();
    let package = library.load(key).unwrap().clean_package.unwrap();
    assert_eq!(package.metadata_json.as_bytes(), files["metadata.json"]);
    assert_eq!(package.score_json.as_bytes(), files["score.json"]);
    json!({
        "key": key,
        "content_sha256": package.content_sha256,
        "profile": profile,
        "choice": if profile == "wmh-vsq-clean-v1" { json!("base_notes_instrumental") } else { Value::Null },
    })
}
fn piano(part: Option<&str>) -> Value {
    json!({"part_id":part,"profile":{"kind":"piano","key_count":88,"lowest_midi":21}})
}
fn guitar(part: Option<&str>) -> Value {
    json!({"part_id":part,"profile":{"kind":"guitar","tuning":[40,45,50,55,59,64],"frets":24,"capo":0}})
}
fn plan(library: &NativeLibrary, path: &str, source: &Value, settings: &Value) -> Value {
    let response = post(library, path, &json!({"source":source,"settings":settings}));
    assert_eq!(response["source"], *source);
    assert_eq!(response["plan"]["changed_source_notes"], false);
    response["plan"].clone()
}
fn vsq_runtime(library: &NativeLibrary, source: &Value) -> Value {
    post(
        library,
        "/api/library/runtime",
        &json!({
            "key":source["key"], "profile":source["profile"], "choice":source["choice"],
        }),
    )
}
fn loaded_midi_runtime(library: &NativeLibrary, source: &Value) -> Value {
    post(library, "/api/library/load", &json!({"key":source["key"]}))["clean_package"]["runtime"]
        .clone()
}
fn ids(values: &[Value], field: &str) -> BTreeSet<String> {
    values
        .iter()
        .map(|value| value[field].as_str().unwrap().to_owned())
        .collect()
}
fn assert_model_warning(plan: &Value, code: &str) {
    assert!(
        plan["diagnostics"]
            .as_array()
            .unwrap()
            .iter()
            .any(|diagnostic| {
                diagnostic["code"] == code
                    && diagnostic["message"]
                        .as_str()
                        .unwrap()
                        .contains("not a global")
            }),
        "{plan}"
    );
}
fn assert_native_times(plan: &Value, runtime: &Value, piano: bool) {
    let notes = runtime["notes"].as_array().unwrap();
    let compiled = runtime["compilation"]["timeline"]["notes"]
        .as_array()
        .unwrap();
    assert_eq!(plan["complete"], true, "{plan}");
    for assignment in plan["assignments"].as_array().unwrap() {
        let source_ids = assignment["source_note_ids"].as_array().unwrap();
        assert!(!source_ids.is_empty());
        let selected: Vec<_> = notes
            .iter()
            .filter(|note| source_ids.contains(&note["note_id"]))
            .collect();
        assert_eq!(selected.len(), source_ids.len());
        let start = selected
            .iter()
            .map(|note| note["start_ms"].as_f64().unwrap())
            .min_by(f64::total_cmp)
            .unwrap();
        // The public advisory plan binds to Compilation's display projection.
        // Native runtimes retain exact endpoints separately; start + duration
        // can legitimately differ from RuntimeNote.end_ms by one binary64 step.
        let end = compiled
            .iter()
            .filter(|note| source_ids.contains(&note["source_note_id"]))
            .map(|note| note["start_ms"].as_f64().unwrap() + note["duration_ms"].as_f64().unwrap())
            .max_by(f64::total_cmp)
            .unwrap();
        assert_eq!(assignment["start_ms"].as_f64().unwrap(), start);
        assert_eq!(assignment["end_ms"].as_f64().unwrap(), end);
        for native in selected {
            let target = compiled
                .iter()
                .find(|note| note["source_note_id"] == native["note_id"])
                .unwrap();
            assert_eq!(assignment["start_ms"], target["start_ms"]);
            assert_eq!(assignment["midi"], target["midi"]);
            if piano {
                assert!(assignment["source_occurrence_ids"]
                    .as_array()
                    .unwrap()
                    .contains(&target["id"]));
                let exposed = plan["targets"]
                    .as_array()
                    .unwrap()
                    .iter()
                    .find(|target| target["target_id"] == assignment["target_id"])
                    .unwrap();
                assert_eq!(exposed["start_ms"], assignment["start_ms"]);
                assert_eq!(exposed["end_ms"], assignment["end_ms"]);
                assert_eq!(exposed["source_note_ids"], assignment["source_note_ids"]);
            } else {
                assert_eq!(assignment["occurrence_id"], target["id"]);
                assert_eq!(assignment["part_id"], target["part_id"]);
            }
        }
    }
}

#[test]
fn vsq_pre_measure_fingering_uses_selected_runtime_and_preserves_every_source_id() {
    let sandbox = Sandbox::new();
    let library = sandbox.library();
    let source = save(&library, &vsq_files(), "wmh-vsq-clean-v1");
    let before = sandbox.bytes();
    let selected = vsq_runtime(&library, &source);
    let runtime =
        json!({"notes":selected["runtime"]["notes"],"compilation":selected["compilation"]});
    let notation: score_core::Score =
        serde_json::from_value(selected["compilation"]["score"].clone()).unwrap();
    assert_eq!(
        score_core::compile(notation).unwrap().timeline.notes[0].start_ms,
        2000.0
    );
    assert_eq!(runtime["notes"][0]["start_ms"], 0.0);
    assert_eq!(runtime["notes"][0]["end_ms"], 1418.75116875);
    let piano_plan = plan(&library, PIANO, &source, &piano(None));
    assert_native_times(&piano_plan, &runtime, true);
    assert_eq!(piano_plan["source_occurrence_count"], 2);
    assert_eq!(piano_plan["physical_target_count"], 1);
    assert_eq!(
        piano_plan["targets"][0]["source_note_ids"]
            .as_array()
            .unwrap()
            .len(),
        2
    );
    assert_model_warning(&piano_plan, "piano_fingering_model");
    for part in ["vsq-track-1", "vsq-track-2"] {
        let guitar_plan = plan(&library, GUITAR, &source, &guitar(Some(part)));
        assert_native_times(&guitar_plan, &runtime, false);
        assert_eq!(guitar_plan["source_occurrence_count"], 1);
        assert_eq!(guitar_plan["assignments"][0]["part_id"], part);
        assert_model_warning(&guitar_plan, "guitar_fingering_model");
    }
    assert_eq!(sandbox.bytes(), before);
    assert!(sandbox
        .library()
        .load(source["key"].as_str().unwrap())
        .unwrap()
        .clean_package
        .unwrap()
        .runtime
        .is_null());
}

// Same original clock-regression exercises as score-core/clean_song/tests.rs.
fn authored_midi(events: &[(u32, &[u8])], ppq: u16) -> Vec<u8> {
    let mut track = Vec::new();
    for (delta, message) in events {
        let mut value = *delta;
        let mut vlq = vec![(value & 127) as u8];
        while {
            value >>= 7;
            value != 0
        } {
            vlq.push(((value & 127) | 128) as u8);
        }
        vlq.reverse();
        track.extend(vlq);
        track.extend_from_slice(message);
    }
    let mut output = b"MThd\0\0\0\x06\0\x01\0\x01".to_vec();
    output.extend_from_slice(&ppq.to_be_bytes());
    output.extend_from_slice(b"MTrk");
    output.extend_from_slice(&(track.len() as u32).to_be_bytes());
    output.extend(track);
    output
}
fn complete_midi_files(midi: &[u8]) -> BTreeMap<String, Vec<u8>> {
    let complete = score_core::clean_song::convert_midi(midi).unwrap();
    let score = score_core::clean_song::encode_json(&complete).unwrap();
    let metadata = json!({
        "format":"worldmusichub-song", "version":2,
        "id":complete.notation.id, "title":complete.notation.title,
        "score":{"path":"score.json","bytes":score.len(),"sha256":format!("{:x}",Sha256::digest(&score))},
        "sources":[complete.source],
        "rights":{"status":"original_authored","attribution":"WorldMusicHub original authored clock exercise","license":"CC0-1.0"},
        "media":[],
    });
    BTreeMap::from([
        (
            "metadata.json".into(),
            serde_json::to_vec_pretty(&metadata).unwrap(),
        ),
        ("score.json".into(), score),
    ])
}

#[test]
fn midi_fingering_keeps_awkward_native_onsets_and_compilation_endpoints() {
    let exercises = [
        authored_midi(
            &[
                (0, &[0xff, 0x51, 3, 5, 0x16, 0x15]),
                (1, &[0x90, 60, 80]),
                (1, &[0x80, 60, 0]),
                (1, &[0x90, 64, 80]),
                (1, &[0x80, 64, 0]),
                (1, &[0x90, 67, 80]),
                (1, &[0x80, 67, 0]),
                (0, &[0xff, 47, 0]),
            ],
            96,
        ),
        authored_midi(
            &[
                (0, &[0xff, 0x51, 3, 7, 0xa1, 0x21]),
                (1, &[0x90, 60, 90]),
                (1, &[0xff, 0x51, 3, 6, 0x1a, 0x81]),
                (0, &[0x90, 64, 80]),
                (1, &[0x80, 60, 0]),
                (15, &[0x80, 64, 0]),
                (223, &[0x90, 60, 88]),
                (240, &[0xff, 0x51, 3, 9, 0x27, 0xc7]),
                (479, &[0x80, 60, 0]),
                (1, &[0x90, 67, 92]),
                (40, &[0xff, 0x51, 3, 5, 0x16, 0x19]),
                (3000, &[0x80, 67, 0]),
                (1759, &[0xff, 0x51, 3, 10, 0x2c, 0x2b]),
                (1441, &[0xff, 47, 0]),
            ],
            480,
        ),
    ];
    for (index, midi) in exercises.iter().enumerate() {
        let sandbox = Sandbox::new();
        let library = sandbox.library();
        let source = save(
            &library,
            &complete_midi_files(midi),
            "wmh-semantic-midi1-v1",
        );
        let before = sandbox.bytes();
        let runtime = loaded_midi_runtime(&library, &source);
        let notation: score_core::Score =
            serde_json::from_value(runtime["compilation"]["score"].clone()).unwrap();
        let ordinary = score_core::compile(notation).unwrap();
        if index == 0 {
            assert_eq!(runtime["notes"][2]["start_ms"], 17.36109375);
            assert_ne!(
                ordinary.timeline.notes[2].start_ms,
                runtime["notes"][2]["start_ms"].as_f64().unwrap()
            );
            let mut scope = guitar(None);
            scope["planning_scope"] = json!({"version":1,"from":{"numerator":5,"denominator":96},"to":{"numerator":1,"denominator":16}});
            scope["inventory_only"] = json!(true);
            let inventory = plan(&library, GUITAR, &source, &scope);
            assert_eq!(inventory["planning_scope"]["selected_occurrence_count"], 1);
            assert_eq!(
                inventory["planning_scope"]["start_ms"],
                runtime["notes"][2]["start_ms"]
            );
            assert_eq!(
                inventory["planning_scope"]["end_ms"],
                runtime["notes"][2]["end_ms"]
            );
        } else {
            assert!(runtime["notes"].as_array().unwrap().iter().any(|note| {
                let start = note["start_ms"].as_f64().unwrap();
                let end = note["end_ms"].as_f64().unwrap();
                start + (end - start) != end
            }));
        }
        for (path, settings, is_piano) in
            [(PIANO, piano(None), true), (GUITAR, guitar(None), false)]
        {
            let planned = plan(&library, path, &source, &settings);
            assert_eq!(
                planned["source_occurrence_count"].as_u64().unwrap() as usize,
                runtime["notes"].as_array().unwrap().len()
            );
            assert_native_times(&planned, &runtime, is_piano);
            assert_eq!(
                planned,
                plan(&library, path, &source, &settings),
                "Native plans remain deterministic"
            );
        }
        assert_eq!(sandbox.bytes(), before);
    }
}

#[test]
fn native_locks_profile_changes_and_infeasibility_preserve_identity_and_targets() {
    let sandbox = Sandbox::new();
    let library = sandbox.library();
    let source = save(&library, &vsq_files(), "wmh-vsq-clean-v1");
    let before = sandbox.bytes();
    let mut settings = piano(None);
    settings["locks"] = json!([{"source_note_id":"vsq-t1-ID#0001","hand":"left","finger":3}]);
    let locked = plan(&library, PIANO, &source, &settings);
    assert_eq!(locked["complete"], true);
    assert_eq!(locked["requested_locks"], settings["locks"]);
    assert_eq!(locked["assignments"][0]["hand"], "left");
    assert_eq!(locked["assignments"][0]["finger"], 3);
    settings["locks"]
        .as_array_mut()
        .unwrap()
        .push(json!({"source_note_id":"vsq-t2-ID#0001","hand":"right","finger":2}));
    let conflicting = plan(&library, PIANO, &source, &settings);
    assert_eq!(conflicting["status"], "infeasible_under_model");
    assert_eq!(conflicting["complete"], false);
    assert!(conflicting["assignments"].as_array().unwrap().is_empty());
    assert_eq!(conflicting["targets"], locked["targets"]);
    assert_eq!(conflicting["requested_locks"], settings["locks"]);
    settings["locks"] = json!([]);
    settings["profile"] = json!({"kind":"piano","key_count":12,"lowest_midi":0});
    let outside = plan(&library, PIANO, &source, &settings);
    assert_eq!(outside["complete"], false);
    assert!(outside["assignments"].as_array().unwrap().is_empty());
    assert_eq!(outside["profile"], settings["profile"]);
    assert_eq!(outside["targets"], locked["targets"]);
    settings["profile"] = piano(None)["profile"].clone();
    settings["left_hand"] = json!({"lowest_midi":0,"highest_midi":50,"max_span_semitones":7});
    settings["right_hand"] = json!({"lowest_midi":60,"highest_midi":72,"max_span_semitones":5});
    let replanned = plan(&library, PIANO, &source, &settings);
    assert_eq!(replanned["complete"], true);
    assert_eq!(replanned["assignments"][0]["hand"], "right");
    assert_eq!(replanned["left_hand"], settings["left_hand"]);
    assert_eq!(replanned["right_hand"], settings["right_hand"]);
    assert_eq!(replanned["targets"], locked["targets"]);
    settings["locks"] = json!([{"source_note_id":"not-a-source","finger":2}]);
    reject(
        &library,
        PIANO,
        &json!({"source":source,"settings":settings}),
        Some(422),
    );
    let mut settings = guitar(Some("vsq-track-1"));
    settings["locks"] = json!([{"source_note_id":"vsq-t1-ID#0001","string":5,"fret":4,"finger":2}]);
    let locked = plan(&library, GUITAR, &source, &settings);
    assert_eq!(locked["complete"], true);
    assert_eq!(locked["assignments"][0]["string"], 5);
    assert_eq!(locked["assignments"][0]["fret"], 4);
    assert_eq!(locked["assignments"][0]["finger"], 2);
    assert_eq!(locked["requested_locks"], settings["locks"]);
    settings["locks"][0]["fret"] = json!(0);
    let infeasible = plan(&library, GUITAR, &source, &settings);
    assert_eq!(infeasible["status"], "infeasible_under_model");
    assert_eq!(infeasible["complete"], false);
    assert!(infeasible["assignments"].as_array().unwrap().is_empty());
    assert_eq!(infeasible["source_occurrence_count"], 1);
    settings["locks"] = json!([]);
    settings["profile"] = json!({"kind":"guitar","tuning":[61],"frets":5,"capo":2});
    settings["max_fret_span"] = json!(0);
    let replanned = plan(&library, GUITAR, &source, &settings);
    assert_eq!(replanned["complete"], true);
    assert_eq!(replanned["profile"], settings["profile"]);
    assert_eq!(replanned["max_fret_span"], 0);
    assert_eq!(replanned["assignments"][0]["fret"], 0);
    assert_eq!(replanned["assignments"][0]["finger"], 0);
    assert_eq!(
        replanned["assignments"][0]["occurrence_id"],
        locked["assignments"][0]["occurrence_id"]
    );
    assert_eq!(sandbox.bytes(), before);
}

#[test]
fn guitar_phrase_inventory_and_replanning_keep_entry_holds_full_tails_and_native_clocks() {
    let sandbox = Sandbox::new();
    let library = sandbox.library();
    let source = save(&library, &midi_files(), "wmh-semantic-midi1-v1");
    let before = sandbox.bytes();
    let runtime = loaded_midi_runtime(&library, &source);
    let compiled = runtime["compilation"]["timeline"]["notes"]
        .as_array()
        .unwrap();
    let selected: Vec<_> = compiled
        .iter()
        .filter(|note| {
            ["midi-t2-c1-e7", "midi-t3-c2-e5"].contains(&note["source_note_id"].as_str().unwrap())
        })
        .cloned()
        .collect();
    let hold = selected
        .iter()
        .find(|note| note["source_note_id"] == "midi-t3-c2-e5")
        .unwrap();
    let mut settings = guitar(None);
    settings["planning_scope"] = json!({"version":1,"from":{"numerator":1,"denominator":1},"to":{"numerator":2,"denominator":1}});
    settings["inventory_only"] = json!(true);
    let inventory = plan(&library, GUITAR, &source, &settings);
    assert_eq!(inventory["purpose"], "scope_inventory");
    assert_eq!(inventory["planning_scope"]["full_occurrence_count"], 5);
    assert_eq!(inventory["planning_scope"]["selected_occurrence_count"], 2);
    assert_eq!(inventory["planning_scope"]["start_ms"], 500.0);
    assert_eq!(inventory["planning_scope"]["end_ms"], 1000.0);
    let included: BTreeSet<_> = inventory["planning_scope"]["included_occurrence_ids"]
        .as_array()
        .unwrap()
        .iter()
        .map(|id| id.as_str().unwrap().to_owned())
        .collect();
    assert_eq!(included, ids(&selected, "id"));
    assert_eq!(
        inventory["planning_scope"]["entry_hold_occurrence_ids"],
        json!([hold["id"]])
    );
    assert!(inventory["assignments"].as_array().unwrap().is_empty());
    settings["planning_scope"]["to"] = json!({"numerator":3,"denominator":2});
    let inventory = plan(&library, GUITAR, &source, &settings);
    assert_eq!(inventory["planning_scope"]["end_ms"], 750.0);
    assert_eq!(inventory["planning_scope"]["selected_occurrence_count"], 2);
    settings["inventory_only"] = json!(false);
    settings["locks"] = json!([{"source_note_id":"midi-t2-c1-e7","string":6,"fret":0,"finger":0}]);
    let replanned = plan(&library, GUITAR, &source, &settings);
    assert_native_times(&replanned, &runtime, false);
    assert_eq!(replanned["purpose"], "phrase_plan");
    assert_eq!(replanned["planning_scope"], inventory["planning_scope"]);
    assert_eq!(
        ids(
            replanned["assignments"].as_array().unwrap(),
            "occurrence_id"
        ),
        included
    );
    assert_eq!(replanned["requested_locks"], settings["locks"]);
    let entry = replanned["assignments"]
        .as_array()
        .unwrap()
        .iter()
        .find(|note| note["occurrence_id"] == hold["id"])
        .unwrap();
    assert_eq!(entry["start_ms"], 0.0);
    assert_eq!(entry["end_ms"], 1000.0);
    assert!(
        entry["end_ms"].as_f64().unwrap() > replanned["planning_scope"]["end_ms"].as_f64().unwrap()
    );
    settings["locks"] = json!([{"source_note_id":"midi-t2-c1-e9","finger":1}]);
    reject(
        &library,
        GUITAR,
        &json!({"source":source,"settings":settings}),
        Some(422),
    );
    assert_eq!(sandbox.bytes(), before);
}

#[test]
fn vsq_phrase_uses_written_membership_with_native_origin_and_rejects_negative_clock_boundaries() {
    let sandbox = Sandbox::new();
    let library = sandbox.library();
    let source = save(&library, &vsq_files(), "wmh-vsq-clean-v1");
    let before = sandbox.bytes();
    let selected = vsq_runtime(&library, &source);
    let runtime =
        json!({"notes":selected["runtime"]["notes"],"compilation":selected["compilation"]});
    let mut settings = guitar(Some("vsq-track-1"));
    settings["planning_scope"] = json!({"version":1,"from":{"numerator":9,"denominator":2},"to":{"numerator":5,"denominator":1}});
    settings["inventory_only"] = json!(true);
    let inventory = plan(&library, GUITAR, &source, &settings);
    assert_eq!(inventory["planning_scope"]["start_ms"], 250.0);
    assert_eq!(inventory["planning_scope"]["end_ms"], 750.0005);
    assert_eq!(
        inventory["planning_scope"]["included_occurrence_ids"],
        json!(["vsq-t1-ID#0001"])
    );
    assert_eq!(
        inventory["planning_scope"]["entry_hold_occurrence_ids"],
        json!(["vsq-t1-ID#0001"])
    );
    settings["inventory_only"] = json!(false);
    let planned = plan(&library, GUITAR, &source, &settings);
    assert_native_times(&planned, &runtime, false);
    assert_eq!(planned["planning_scope"], inventory["planning_scope"]);
    assert_eq!(planned["assignments"][0]["start_ms"], 0.0);
    assert_eq!(planned["assignments"][0]["end_ms"], 1418.75116875);
    for from in [
        json!({"numerator":-1,"denominator":1}),
        json!({"numerator":0,"denominator":1}),
        json!({"numerator":3,"denominator":1}),
    ] {
        settings["planning_scope"]["from"] = from;
        for inventory_only in [true, false] {
            settings["inventory_only"] = json!(inventory_only);
            reject(
                &library,
                GUITAR,
                &json!({"source":source,"settings":settings}),
                Some(422),
            );
        }
    }
    assert_eq!(sandbox.bytes(), before);
}

#[test]
fn binding_rejects_missing_stale_wrong_and_generic_sources_and_all_score_or_timeline_injection() {
    let sandbox = Sandbox::new();
    let library = sandbox.library();
    let vsq = save(&library, &vsq_files(), "wmh-vsq-clean-v1");
    let midi = save(&library, &midi_files(), "wmh-semantic-midi1-v1");
    let native_score = library
        .load(midi["key"].as_str().unwrap())
        .unwrap()
        .score_json;
    let generic = library
        .save(SaveRequest {
            score_json: native_score.clone(),
            label: None,
            allow_conflicting_id: true,
        })
        .unwrap();
    let before = sandbox.bytes();
    for (path, settings) in [(PIANO, piano(None)), (GUITAR, guitar(None))] {
        for source in [&vsq, &midi] {
            let valid = json!({"source":source,"settings":settings});
            for field in ["key", "content_sha256", "profile"] {
                let mut body = valid.clone();
                body["source"].as_object_mut().unwrap().remove(field);
                reject(&library, path, &body, Some(400));
            }
            for (field, value) in [
                ("content_sha256", json!("0".repeat(64))),
                ("content_sha256", json!("not-a-hash")),
                ("profile", json!("unknown-profile")),
                (
                    "profile",
                    if source == &vsq {
                        midi["profile"].clone()
                    } else {
                        vsq["profile"].clone()
                    },
                ),
            ] {
                let mut body = valid.clone();
                body["source"][field] = value;
                reject(&library, path, &body, Some(422));
            }
            let mut wrapped_key = valid.clone();
            wrapped_key["source"]["key"] =
                json!(format!("native:{}", source["key"].as_str().unwrap()));
            reject(&library, path, &wrapped_key, Some(422));
            for field in ["score", "timeline", "score_json", "compilation"] {
                for level in ["root", "source", "settings"] {
                    let mut body = valid.clone();
                    let value = if field == "score_json" {
                        json!(native_score)
                    } else {
                        json!({"notes":[]})
                    };
                    if level == "root" {
                        body[field] = value;
                    } else {
                        body[level][field] = value;
                    }
                    reject(&library, path, &body, Some(400));
                }
            }
        }
        for choice in [Value::Null, json!("full_vocal"), json!("unknown")] {
            let mut source = vsq.clone();
            source["choice"] = choice;
            reject(
                &library,
                path,
                &json!({"source":source,"settings":settings}),
                Some(422),
            );
        }
        let mut source = vsq.clone();
        source.as_object_mut().unwrap().remove("choice");
        reject(
            &library,
            path,
            &json!({"source":source,"settings":settings}),
            Some(422),
        );
        let mut source = midi.clone();
        source["choice"] = json!("base_notes_instrumental");
        reject(
            &library,
            path,
            &json!({"source":source,"settings":settings}),
            Some(422),
        );
        let mut source = midi.clone();
        source.as_object_mut().unwrap().remove("choice");
        let omitted = post(
            &library,
            path,
            &json!({"source":source,"settings":settings}),
        );
        assert_eq!(omitted["source"], midi);
        assert_eq!(omitted["plan"]["complete"], true);
        let source = json!({"key":generic.key,"content_sha256":generic.content_sha256,"profile":"wmh-semantic-midi1-v1","choice":null});
        reject(
            &library,
            path,
            &json!({"source":source,"settings":settings}),
            Some(422),
        );
        let mut invalid_settings = settings.clone();
        invalid_settings["part_id"] = json!("unknown-part");
        reject(
            &library,
            path,
            &json!({"source":midi,"settings":invalid_settings}),
            Some(422),
        );
    }
    assert_eq!(sandbox.bytes(), before);
    assert_eq!(sandbox.library().list().unwrap().entries.len(), 3);
}

#[test]
fn native_planning_revalidates_saved_package_bytes_without_repairing_corruption() {
    for (files, profile) in [
        (vsq_files(), "wmh-vsq-clean-v1"),
        (midi_files(), "wmh-semantic-midi1-v1"),
    ] {
        let sandbox = Sandbox::new();
        let library = sandbox.library();
        let source = save(&library, &files, profile);
        let saved_score = sandbox
            .0
            .join("Scores/clean-songs")
            .join(source["key"].as_str().unwrap())
            .join("package/score.json");
        let mut damaged = fs::read(&saved_score).unwrap();
        damaged.extend_from_slice(b"\n ");
        fs::write(&saved_score, &damaged).unwrap();
        let before = sandbox.bytes();
        for (path, settings) in [(PIANO, piano(None)), (GUITAR, guitar(None))] {
            reject(
                &library,
                path,
                &json!({"source":source,"settings":settings}),
                Some(422),
            );
        }
        assert_eq!(fs::read(&saved_score).unwrap(), damaged);
        assert_eq!(sandbox.bytes(), before);
    }
}

#[test]
fn native_fingering_routes_use_large_operation_admission_and_reject_get() {
    let sandbox = Sandbox::new();
    let library = sandbox.library();
    for path in [PIANO, GUITAR] {
        assert!(worldmusichub_desktop::song_pack::is_large_operation(path));
        let response = dispatch_with_library(
            Request::builder()
                .method("GET")
                .uri(format!("{ORIGIN}{path}"))
                .body(Vec::new())
                .unwrap(),
            &library,
        );
        assert_eq!(response.status(), 405);
        let error: Value = serde_json::from_slice(response.body()).unwrap();
        assert_eq!(error["code"], "library_method_not_allowed");
    }
}
