//! Public fixtures are wholly authored; no supplied/private music enters tests.
use http::Request;
use serde_json::{json, Value};
use std::{
    collections::BTreeMap,
    fs,
    io::{Cursor, Read, Write},
    path::PathBuf,
    sync::atomic::{AtomicU64, Ordering},
};
use worldmusichub_desktop::{dispatch_with_library, native_library::NativeLibrary, ORIGIN};
static SEQUENCE: AtomicU64 = AtomicU64::new(0);
struct Sandbox(PathBuf);
impl Sandbox {
    fn new() -> Self {
        let p = std::env::temp_dir().join(format!(
            "wmh-vsq-native-{}-{}",
            std::process::id(),
            SEQUENCE.fetch_add(1, Ordering::Relaxed)
        ));
        fs::create_dir(&p).unwrap();
        Self(p)
    }
    fn library(&self) -> NativeLibrary {
        NativeLibrary::open(self.0.join("Scores")).unwrap()
    }
}
impl Drop for Sandbox {
    fn drop(&mut self) {
        fs::remove_dir_all(&self.0).unwrap();
    }
}
fn files() -> BTreeMap<String, Vec<u8>> {
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
fn zip(files: &BTreeMap<String, Vec<u8>>) -> Vec<u8> {
    let mut z = zip::ZipWriter::new(Cursor::new(Vec::new()));
    for (p, b) in files {
        z.start_file(p, zip::write::SimpleFileOptions::default())
            .unwrap();
        z.write_all(b).unwrap();
    }
    z.finish().unwrap().into_inner()
}
fn unzip(bytes: &[u8]) -> BTreeMap<String, Vec<u8>> {
    let mut z = zip::ZipArchive::new(Cursor::new(bytes)).unwrap();
    let mut out = BTreeMap::new();
    for i in 0..z.len() {
        let mut f = z.by_index(i).unwrap();
        let mut b = Vec::new();
        f.read_to_end(&mut b).unwrap();
        out.insert(f.name().into(), b);
    }
    out
}
fn request(library: &NativeLibrary, path: &str, body: Vec<u8>) -> http::Response<Vec<u8>> {
    dispatch_with_library(
        Request::builder()
            .method("POST")
            .uri(format!("{ORIGIN}{path}"))
            .header("content-type", "application/json")
            .header("x-wmh-filename", "authored-clean.zip")
            .body(body)
            .unwrap(),
        library,
    )
}
fn import(library: &NativeLibrary, files: &BTreeMap<String, Vec<u8>>, commit: bool) -> Value {
    let r = request(
        library,
        if commit {
            "/api/library/import/commit"
        } else {
            "/api/library/import/preview"
        },
        zip(files),
    );
    assert_eq!(r.status(), 200, "{}", String::from_utf8_lossy(r.body()));
    serde_json::from_slice(r.body()).unwrap()
}

#[test]
fn vsq_complete_bytes_survive_explicit_practice_export_and_restart() {
    let sandbox = Sandbox::new();
    let library = sandbox.library();
    let mut original = files();
    // Byte preservation includes formatting; no browser or Value reserialization.
    original
        .get_mut("score.json")
        .unwrap()
        .extend_from_slice(b"\n \t\n");
    let mut metadata: Value = serde_json::from_slice(&original["metadata.json"]).unwrap();
    use sha2::{Digest, Sha256};
    metadata["score"]["bytes"] = json!(original["score.json"].len());
    metadata["score"]["sha256"] = json!(format!("{:x}", Sha256::digest(&original["score.json"])));
    original.insert(
        "metadata.json".into(),
        serde_json::to_vec_pretty(&metadata).unwrap(),
    );
    original
        .get_mut("metadata.json")
        .unwrap()
        .extend_from_slice(b"\n\n");
    let preview = import(&library, &original, false);
    assert_eq!(preview["summary"]["ready"], 1);
    assert_eq!(preview["items"][0]["playable"], false);
    assert_eq!(
        preview["items"][0]["clean_package"]["profile"],
        "wmh-vsq-clean-v1"
    );
    assert!(preview["items"][0]["message"]
        .as_str()
        .unwrap()
        .contains("All authored VSQ tracks"));
    assert!(library.list().unwrap().entries.is_empty());
    let saved = import(&library, &original, true);
    assert_eq!(saved["summary"]["saved"], 1, "{saved}");
    assert_eq!(saved["items"][0]["playable"], false);
    let key = saved["items"][0]["entry"]["key"].as_str().unwrap();
    let loaded = library.load(key).unwrap();
    let package = loaded.clean_package.unwrap();
    assert_eq!(package.metadata_json.as_bytes(), original["metadata.json"]);
    assert_eq!(package.score_json.as_bytes(), original["score.json"]);
    assert!(package.runtime.is_null());
    assert_eq!(package.profile.as_deref(), Some("wmh-vsq-clean-v1"));
    let score = score_core::vsq_clean::decode_json(package.score_json.as_bytes()).unwrap();
    assert_eq!(score.authoring.tracks.len(), 2);
    assert_eq!(
        score.authoring.tracks[0].notes[0].lyrics[0].numeric_fields[0].coefficient,
        9007199254740993
    );
    assert!(score.notation.keys.is_empty());
    assert!(score
        .notation
        .parts
        .iter()
        .flat_map(|p| &p.notes)
        .all(|n| n.velocity == 0));
    let response = request(
        &library,
        "/api/library/runtime",
        serde_json::to_vec(
            &json!({"key":key,"profile":"wmh-vsq-clean-v1","choice":"base_notes_instrumental"}),
        )
        .unwrap(),
    );
    assert_eq!(
        response.status(),
        200,
        "{}",
        String::from_utf8_lossy(response.body())
    );
    let selected: Value = serde_json::from_slice(response.body()).unwrap();
    assert_eq!(selected["reference_velocity"], 90);
    let navigation = &selected["navigation"];
    assert!(selected["navigation_unavailable"].is_null());
    assert_eq!(navigation["profile"], "wmh-vsq-practice-navigation-v1");
    assert_eq!(navigation["content_sha256"], package.content_sha256);
    assert_eq!(navigation["source_sha256"], score.source.sha256);
    assert_eq!(
        navigation["runtime_profile"],
        selected["runtime"]["profile"]
    );
    assert_eq!(navigation["choice"], "base_notes_instrumental");
    assert_eq!(navigation["practice_origin_tick"], 1920);
    assert_eq!(navigation["clock_start_ms"], -2000.0);
    assert_eq!(navigation["written_end_ms"], 3750.0035);
    assert_eq!(navigation["duration_ms"], selected["runtime"]["end_ms"]);
    assert_eq!(navigation["occurrences"].as_array().unwrap().len(), 2);
    let premeasure = &navigation["occurrences"][0];
    assert_eq!(premeasure["source_measure_index"], 0);
    assert_eq!(premeasure["measure_number"], 1);
    assert_eq!(premeasure["start_ms"], -2000.0);
    assert_eq!(premeasure["end_ms"], 0.0);
    assert!(premeasure["written_note_ids"]
        .as_array()
        .unwrap()
        .is_empty());
    assert!(premeasure["continuing_note_ids"]
        .as_array()
        .unwrap()
        .is_empty());
    let cursor = &navigation["written_cursor"];
    assert_eq!(cursor["source_note_ids"].as_array().unwrap().len(), 2);
    for span in cursor["spans"].as_array().unwrap() {
        assert_eq!(span["measure_occurrence_index"], 1);
        assert_eq!(span["start_ms"], 0.0);
        assert_eq!(span["end_ms"], 1418.75116875);
        let id = &cursor["source_note_ids"][span["source_note_index"].as_u64().unwrap() as usize];
        assert!(selected["runtime"]["notes"]
            .as_array()
            .unwrap()
            .iter()
            .any(|note| &note["note_id"] == id
                && note["start_ms"] == span["start_ms"]
                && note["end_ms"] == span["end_ms"]));
    }
    assert_eq!(
        selected["runtime"]["profile"],
        "wmh-vsq-base-note-practice-v1"
    );
    assert_eq!(selected["runtime"]["notes"].as_array().unwrap().len(), 2);
    assert_eq!(selected["runtime"]["parts"][1]["audible"], false);
    assert_eq!(
        selected["runtime"]["parts"][0]["singer_descriptors"][0]["voice"]["program"],
        7
    );
    assert_eq!(selected["runtime"]["notes"][0]["dynamics"], 0);
    assert!(selected["runtime"]["notes"][0].get("channel").is_none());
    assert!(selected["runtime"]["notes"][0].get("program").is_none());
    assert_eq!(
        selected["runtime"]["notes"][0]["start_microseconds"]["numerator"],
        "0"
    );
    // (240 * 500000 + 561 * 1000001) / 480, reduced exactly.
    assert_eq!(
        selected["runtime"]["notes"][0]["end_microseconds"]["numerator"],
        "227000187"
    );
    assert_eq!(
        selected["runtime"]["notes"][0]["end_microseconds"]["denominator"],
        160
    );
    let compilation: score_core::Compilation =
        serde_json::from_value(selected["compilation"].clone()).unwrap();
    assert_eq!(
        serde_json::to_value(&compilation.score).unwrap(),
        serde_json::to_value(&score.notation).unwrap()
    );
    let runtime: score_core::vsq_clean::PracticeRuntime =
        serde_json::from_value(selected["runtime"].clone()).unwrap();
    for (target, note) in compilation.timeline.notes.iter().zip(&runtime.notes) {
        assert_eq!(target.id, note.note_id);
        assert_eq!(target.source_note_id, note.note_id);
        assert_eq!(target.source_note_ids, vec![note.note_id.clone()]);
        assert_eq!(target.part_id, note.part_id);
        assert_eq!(target.voice, note.singer_event_id);
        assert_eq!(target.start_ms, note.start_ms);
        assert_eq!(target.duration_ms, note.end_ms - note.start_ms);
        assert_eq!(target.velocity, 90);
    }
    let mut target = compilation.timeline;
    target.notes.retain(|n| n.part_id == "vsq-track-1");
    let assessed = request(&library, "/api/assess", serde_json::to_vec(&json!({"timeline":target,"inputs":[{"midi":63,"at_ms":0.0,"velocity":90}],"tolerance_ms":100.0})).unwrap());
    assert_eq!(assessed.status(), 200);
    let assessed: Value = serde_json::from_slice(assessed.body()).unwrap();
    assert_eq!(assessed["hits"][0]["note_id"], "vsq-t1-ID#0001");
    assert_eq!(assessed["accuracy_percent"], 100.0);
    let exported = request(
        &library,
        "/api/library/pack/export",
        serde_json::to_vec(&json!({"keys":[key]})).unwrap(),
    );
    assert_eq!(exported.status(), 200);
    let output = unzip(exported.body());
    assert_eq!(output.len(), 3);
    for (path, bytes) in &original {
        assert_eq!(output[&format!("songs/{key}/{path}")], *bytes);
    }
    drop(library);
    let restarted = sandbox.library();
    let loaded = restarted.load(key).unwrap().clean_package.unwrap();
    assert!(loaded.runtime.is_null());
    assert_eq!(loaded.score_json.as_bytes(), original["score.json"]);
    // Verified independent native backup restores the same exact source package.
    fs::remove_dir_all(sandbox.0.join("Scores/clean-songs").join(key)).unwrap();
    assert_eq!(sandbox.library().list().unwrap().entries.len(), 1);
    assert_eq!(
        sandbox
            .library()
            .load(key)
            .unwrap()
            .clean_package
            .unwrap()
            .score_json
            .as_bytes(),
        original["score.json"]
    );
    let other = Sandbox::new();
    let second = other.library();
    let response = request(
        &second,
        "/api/library/import/commit",
        exported.body().clone(),
    );
    assert_eq!(response.status(), 200);
    let reimported: Value = serde_json::from_slice(response.body()).unwrap();
    assert_eq!(reimported["summary"]["saved"], 1);
    assert_eq!(reimported["items"][0]["entry"]["key"], key);
    assert!(second
        .load(key)
        .unwrap()
        .clean_package
        .unwrap()
        .runtime
        .is_null());
}

#[test]
fn runtime_requires_matching_profile_and_explicit_supported_choice() {
    let sandbox = Sandbox::new();
    let library = sandbox.library();
    let saved = import(&library, &files(), true);
    let key = saved["items"][0]["entry"]["key"].as_str().unwrap();
    for (body, status, code) in [
        (
            json!({"key":key,"profile":"wmh-vsq-clean-v1"}),
            400,
            "library_invalid_request",
        ),
        (
            json!({"key":key,"choice":"base_notes_instrumental"}),
            400,
            "library_invalid_request",
        ),
        (
            json!({"key":key,"profile":"wmh-vsq-clean-v1","choice":"unknown"}),
            400,
            "library_invalid_request",
        ),
        (
            json!({"key":key,"profile":"wmh-vsq-clean-v1","choice":"base_notes_instrumental","score_json":"{}"}),
            400,
            "library_invalid_request",
        ),
        (
            json!({"key":key,"profile":"wmh-semantic-midi1-v1","choice":"base_notes_instrumental"}),
            422,
            "library_runtime_profile",
        ),
        (
            json!({"key":key,"profile":"wmh-vsq-clean-v1","choice":"full_vocal"}),
            422,
            "library_vocal_unsupported",
        ),
    ] {
        let response = request(
            &library,
            "/api/library/runtime",
            serde_json::to_vec(&body).unwrap(),
        );
        assert_eq!(response.status(), status, "{body}");
        let response: Value = serde_json::from_slice(response.body()).unwrap();
        assert_eq!(response["code"], code, "{body}");
    }
    assert!(library
        .load(key)
        .unwrap()
        .clean_package
        .unwrap()
        .runtime
        .is_null());
    let mut changed = files()["score.json"].clone();
    changed.push(b' ');
    fs::write(
        sandbox
            .0
            .join("Scores/clean-songs")
            .join(key)
            .join("package/score.json"),
        changed,
    )
    .unwrap();
    let response = request(
        &library,
        "/api/library/runtime",
        serde_json::to_vec(
            &json!({"key":key,"profile":"wmh-vsq-clean-v1","choice":"base_notes_instrumental"}),
        )
        .unwrap(),
    );
    assert_eq!(response.status(), 422);
}

#[test]
fn native_profile_admission_rejects_unknown_forged_or_incomplete_vsq() {
    use sha2::{Digest, Sha256};
    let sandbox = Sandbox::new();
    let library = sandbox.library();
    for mutation in [
        "unknown_profile",
        "midi_profile",
        "missing_profile",
        "key_claim",
        "coverage",
        "limits",
        "track",
        "source",
        "integer",
        "extra",
    ] {
        let mut candidate = files();
        let mut score: Value = serde_json::from_slice(&candidate["score.json"]).unwrap();
        match mutation {
            "unknown_profile" => score["profile"] = json!("wmh-vsq-clean-v999"),
            "midi_profile" => score["profile"] = json!("wmh-semantic-midi1-v1"),
            "missing_profile" => {
                score.as_object_mut().unwrap().remove("profile");
            }
            "key_claim" => {
                score["notation"]["keys"] =
                    json!([{"at":{"numerator":0,"denominator":1},"fifths":0,"mode":"major"}])
            }
            "coverage" => score["coverage"]["project"]["notes"] = json!(1),
            "limits" => score["interpretation_limits"] = json!([]),
            "track" => {
                score["notation"]["parts"].as_array_mut().unwrap().pop();
            }
            "source" => score["source"]["sha256"] = json!("c".repeat(64)),
            "integer" => {
                score["authoring"]["tracks"][0]["notes"][0]["lyrics"][0]["numeric_fields"][0]
                    ["coefficient"] = json!(9007199254740992.0)
            }
            "extra" => score["controller_events"] = json!([]),
            _ => unreachable!(),
        }
        candidate.insert("score.json".into(), serde_json::to_vec(&score).unwrap());
        let mut metadata: Value = serde_json::from_slice(&candidate["metadata.json"]).unwrap();
        metadata["score"]["bytes"] = json!(candidate["score.json"].len());
        metadata["score"]["sha256"] =
            json!(format!("{:x}", Sha256::digest(&candidate["score.json"])));
        candidate.insert(
            "metadata.json".into(),
            serde_json::to_vec(&metadata).unwrap(),
        );
        let report = import(&library, &candidate, false);
        assert_eq!(report["summary"]["ready"], 0, "{mutation}: {report}");
        assert_eq!(
            report["summary"]["retained_nonplayable"], 1,
            "{mutation}: {report}"
        );
    }
}

#[test]
fn mixed_clean_profiles_dispatch_independently_and_midi_stays_compatible() {
    let sandbox = Sandbox::new();
    let library = sandbox.library();
    let mut pack = BTreeMap::new();
    for (name, bytes) in files() {
        pack.insert(format!("songs/vsq/{name}"), bytes);
    }
    pack.insert(
        "songs/midi/metadata.json".into(),
        include_bytes!("../../../tests/fixtures/clean-song-v2/metadata.json").to_vec(),
    );
    pack.insert(
        "songs/midi/score.json".into(),
        include_bytes!("../../../tests/fixtures/clean-song-v2/score.json").to_vec(),
    );
    pack.insert("manifest.json".into(), serde_json::to_vec(&json!({"format":"worldmusichub-song-pack","version":2,"songs":[{"folder":"songs/vsq"},{"folder":"songs/midi"}]})).unwrap());
    let saved = import(&library, &pack, true);
    assert_eq!(saved["summary"]["saved"], 2, "{saved}");
    for item in saved["items"].as_array().unwrap() {
        let key = item["entry"]["key"].as_str().unwrap();
        let package = library.load(key).unwrap().clean_package.unwrap();
        if package.profile.is_some() {
            assert_eq!(item["playable"], false);
            assert!(package.runtime.is_null());
        } else {
            assert_eq!(item["playable"], true);
            assert!(package.capabilities.is_none());
            assert!(package.interpretation_limits.is_empty());
            assert!(!package.runtime.is_null());
            let response = request(&library, "/api/library/runtime", serde_json::to_vec(&json!({"key":key,"profile":"wmh-vsq-clean-v1","choice":"base_notes_instrumental"})).unwrap());
            assert_eq!(response.status(), 422);
            let body: Value = serde_json::from_slice(response.body()).unwrap();
            assert_eq!(body["code"], "library_runtime_profile");
        }
    }
    assert!(worldmusichub_desktop::song_pack::is_large_operation(
        "/api/library/runtime"
    ));
}

#[test]
fn unsupported_empty_written_map_keeps_source_and_practice_available() {
    use score_core::vsq_engine::EngineCommandKind;
    let mut score = score_core::vsq_clean::decode_json(&files()["score.json"]).unwrap();
    for track in &mut score.authoring.tracks {
        track.notes.clear();
    }
    for part in &mut score.notation.parts {
        part.notes.clear();
    }
    score.notation.measures.clear();
    for track in &mut score.engine_dispatch.tracks {
        track
            .commands
            .retain(|command| !matches!(command.command, EngineCommandKind::Note { .. }));
    }
    score.engine_dispatch.source_controller_events = score
        .engine_dispatch
        .tracks
        .iter()
        .flat_map(|track| &track.commands)
        .map(|command| (command.source_order_last - command.source_order_first + 1) as usize)
        .sum();
    score.coverage.project.notes = 0;
    score.coverage.project.lyrics = 0;
    score.coverage.project.vibratos = 0;
    score.coverage.project.envelope_points = 0;
    score.coverage.named_dispatch.commands = score.engine_dispatch.command_count();
    score.coverage.named_dispatch.parameter_fields = score.engine_dispatch.parameter_field_count();
    score
        .coverage
        .named_dispatch
        .source_controller_records_accounted = score.engine_dispatch.source_controller_events;
    let bytes = score_core::vsq_clean::encode_json(&score).unwrap();
    let metadata =
        serde_json::to_vec(&score_core::vsq_clean::package_metadata(&score, &bytes).unwrap())
            .unwrap();
    let source = BTreeMap::from([
        ("score.json".into(), bytes.clone()),
        ("metadata.json".into(), metadata),
    ]);
    let sandbox = Sandbox::new();
    let library = sandbox.library();
    let saved = import(&library, &source, true);
    assert_eq!(saved["summary"]["saved"], 1, "{saved}");
    let key = saved["items"][0]["entry"]["key"].as_str().unwrap();
    let response = request(
        &library,
        "/api/library/runtime",
        serde_json::to_vec(
            &json!({"key":key,"profile":"wmh-vsq-clean-v1","choice":"base_notes_instrumental"}),
        )
        .unwrap(),
    );
    assert_eq!(response.status(), 200);
    let response: Value = serde_json::from_slice(response.body()).unwrap();
    assert!(response["navigation"].is_null());
    assert_eq!(
        response["navigation_unavailable"]["code"],
        "vsq_navigation_unavailable"
    );
    assert!(response["navigation_unavailable"]["message"]
        .as_str()
        .unwrap()
        .contains("measure map"));
    assert_eq!(response["runtime"]["parts"].as_array().unwrap().len(), 2);
    assert!(response["runtime"]["notes"].as_array().unwrap().is_empty());
    assert!(response["compilation"]["score"]["measures"]
        .as_array()
        .unwrap()
        .is_empty());
    assert_eq!(
        library
            .load(key)
            .unwrap()
            .clean_package
            .unwrap()
            .score_json
            .as_bytes(),
        bytes
    );
}

#[test]
fn native_padding_fixture_keeps_written_extent_beyond_practice_end() {
    let source = BTreeMap::from([
        (
            "metadata.json".into(),
            include_bytes!("../../../tests/fixtures/vsq-clean-v1-padding/metadata.json").to_vec(),
        ),
        (
            "score.json".into(),
            include_bytes!("../../../tests/fixtures/vsq-clean-v1-padding/score.json").to_vec(),
        ),
    ]);
    let sandbox = Sandbox::new();
    let library = sandbox.library();
    let saved = import(&library, &source, true);
    let key = saved["items"][0]["entry"]["key"].as_str().unwrap();
    let response = request(
        &library,
        "/api/library/runtime",
        serde_json::to_vec(
            &json!({"key":key,"profile":"wmh-vsq-clean-v1","choice":"base_notes_instrumental"}),
        )
        .unwrap(),
    );
    assert_eq!(response.status(), 200);
    let response: Value = serde_json::from_slice(response.body()).unwrap();
    assert_eq!(response["navigation"]["duration_ms"], 2000.00175);
    assert_eq!(response["navigation"]["written_end_ms"], 3750.0035);
    assert_eq!(response["navigation"]["source_measure_count"], 2);
    assert_eq!(
        response["navigation"]["occurrences"][1]["source_to"],
        json!({"numerator":8,"denominator":1})
    );
    assert_eq!(
        response["compilation"]["score"]["measures"]
            .as_array()
            .unwrap()
            .len(),
        2
    );
    assert!(response["compilation"]["score"]["keys"]
        .as_array()
        .unwrap()
        .is_empty());
}
