//! Public fixture authored from isolated MIDI keys; no private song source.
use http::Request;
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::{
    collections::BTreeMap,
    fs,
    io::{Cursor, Read},
    path::PathBuf,
    sync::atomic::{AtomicU64, Ordering},
};
use worldmusichub_desktop::{dispatch_with_library, native_library::NativeLibrary, ORIGIN};
static SEQUENCE: AtomicU64 = AtomicU64::new(0);
struct Sandbox(PathBuf);
impl Sandbox {
    fn new() -> Self {
        let path = std::env::temp_dir().join(format!(
            "wmh-basic-keys-{}-{}",
            std::process::id(),
            SEQUENCE.fetch_add(1, Ordering::Relaxed)
        ));
        fs::create_dir(&path).unwrap();
        Self(path)
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
fn midi() -> Vec<u8> {
    // No authored tempo/meter: default relative clock is explicit. Bank,
    // program, controller, shared channels and open attacks are all retained.
    let tracks: Vec<Vec<u8>> = vec![
        vec![
            0, 0xb0, 0, 7, 0, 0xc0, 42, 0, 0xb0, 74, 91, 0, 0x90, 60, 90, 96, 0x80, 60, 0, 0, 0x90,
            64, 90, 0, 0x80, 64, 0, 0, 0x90, 67, 90, 0, 255, 47, 0,
        ],
        vec![0, 0x99, 35, 100, 48, 0x89, 35, 0, 0, 255, 47, 0],
        vec![96, 0x90, 72, 80, 96, 0x80, 72, 0, 0, 255, 47, 0],
        vec![0, 255, 1, 4, b'n', b'o', b't', b'e', 0, 255, 47, 0],
    ];
    let mut bytes = b"MThd\0\0\0\x06\0\x01\0\x04\0\x60".to_vec();
    for track in tracks {
        bytes.extend(b"MTrk");
        bytes.extend((track.len() as u32).to_be_bytes());
        bytes.extend(track);
    }
    bytes
}
fn files() -> BTreeMap<String, Vec<u8>> {
    files_for_source(&midi(), "Original basic-key consumer fixture")
}
fn files_for_source(source: &[u8], title: &str) -> BTreeMap<String, Vec<u8>> {
    let score = score_core::basic_keys::convert_midi(source, title).unwrap();
    let mut bytes = score_core::basic_keys::encode_json(&score).unwrap();
    bytes.extend(b"\n \t\n");
    let metadata = json!({"format":"worldmusichub-song","version":2,"id":score.notation.id,"title":score.notation.title,"score":{"path":"score.json","bytes":bytes.len(),"sha256":format!("{:x}",Sha256::digest(&bytes))},"sources":[score.source],"rights":{"status":"original_authored","attribution":"Original isolated keys, authored solely for consumer validation","license":"CC0-1.0"},"media":[]});
    BTreeMap::from([
        ("score.json".into(), bytes),
        (
            "metadata.json".into(),
            serde_json::to_vec(&metadata).unwrap(),
        ),
    ])
}
fn pack(files: BTreeMap<String, Vec<u8>>) -> Vec<u8> {
    let mut writer = score_core::clean_pack::Writer::new();
    writer.add_song("songs/original", files).unwrap();
    writer.finish().unwrap()
}
fn request(library: &NativeLibrary, path: &str, body: Vec<u8>) -> http::Response<Vec<u8>> {
    dispatch_with_library(
        Request::builder()
            .method("POST")
            .uri(format!("{ORIGIN}{path}"))
            .header("content-type", "application/json")
            .header("x-wmh-filename", "original-keys.zip")
            .body(body)
            .unwrap(),
        library,
    )
}
fn imported(library: &NativeLibrary, files: BTreeMap<String, Vec<u8>>) -> Value {
    let response = request(library, "/api/library/import/commit", pack(files));
    assert_eq!(
        response.status(),
        200,
        "{}",
        String::from_utf8_lossy(response.body())
    );
    let value: Value = serde_json::from_slice(response.body()).unwrap();
    assert_eq!(value["summary"]["saved"], 1, "{value}");
    value
}
fn unzip(bytes: &[u8]) -> BTreeMap<String, Vec<u8>> {
    let mut zip = zip::ZipArchive::new(Cursor::new(bytes)).unwrap();
    let mut files = BTreeMap::new();
    for index in 0..zip.len() {
        let mut file = zip.by_index(index).unwrap();
        let mut bytes = vec![];
        file.read_to_end(&mut bytes).unwrap();
        files.insert(file.name().to_owned(), bytes);
    }
    files
}

#[test]
fn basic_keys_preserve_every_source_event_part_and_attack_across_export_and_restart() {
    let sandbox = Sandbox::new();
    let library = sandbox.library();
    let original = files();
    let saved = imported(&library, original.clone());
    let item = &saved["items"][0];
    let key = item["entry"]["key"].as_str().unwrap();
    assert_eq!(item["playable"], false);
    assert_eq!(
        item["clean_package"]["profile"],
        score_core::basic_keys::PROFILE
    );
    assert!(!item["message"].as_str().unwrap().contains("VSQ"));
    let loaded = library.load(key).unwrap();
    let package = loaded.clean_package.as_ref().unwrap();
    assert_eq!(package.score_json.as_bytes(), original["score.json"]);
    assert_eq!(package.metadata_json.as_bytes(), original["metadata.json"]);
    assert_eq!(package.coverage["source_tracks"], 4);
    assert_eq!(package.coverage["key_attacks"], 5);
    assert_eq!(package.coverage["notation_notes"], 3);
    assert_eq!(package.coverage["zero_length_attacks"], 1);
    assert_eq!(package.coverage["unresolved_ends"], 1);
    let decoded = score_core::basic_keys::decode_json(package.score_json.as_bytes()).unwrap();
    assert_eq!(decoded.performance.notes.len(), 5);
    assert!(decoded.notation.meters.is_empty());
    assert!(decoded.notation.tempo.is_empty());
    let notes = package.runtime["compilation"]["timeline"]["notes"]
        .as_array()
        .unwrap();
    assert_eq!(notes.len(), 2);
    assert_eq!(
        notes
            .iter()
            .map(|note| note["midi"].as_u64().unwrap())
            .collect::<Vec<_>>(),
        vec![60, 72]
    );
    for note in notes {
        assert_eq!(note["source_note_ids"], json!([note["id"]]));
        assert_eq!(note["source_note_id"], note["id"]);
        assert!(note["duration_ms"].as_f64().unwrap() > 0.0);
    }
    assert_eq!(package.runtime["reference_audio"], "unavailable");
    assert_eq!(package.runtime["source_rendition"], "unresolved");
    assert_eq!(
        package.runtime["parts"]
            .as_array()
            .unwrap()
            .iter()
            .map(|p| p["attacks"].as_u64().unwrap())
            .sum::<u64>(),
        5
    );
    let body = json!({"score_json":loaded.score_json,"clean_package":package});
    let fixture = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../../tests/fixtures/basic-keys-native-open.json");
    if std::env::var_os("WMH_UPDATE_BASIC_KEYS_FIXTURE").is_some() {
        fs::write(&fixture, serde_json::to_vec_pretty(&body).unwrap()).unwrap();
    }
    let stored: Value = serde_json::from_slice(&fs::read(fixture).unwrap()).unwrap();
    assert_eq!(body, stored);
    let response = request(
        &library,
        "/api/library/pack/export",
        serde_json::to_vec(&json!({"keys":[key]})).unwrap(),
    );
    assert_eq!(response.status(), 200);
    let exported = unzip(response.body());
    for (path, bytes) in &original {
        assert_eq!(&exported[&format!("songs/{key}/{path}")], bytes);
    }
    drop(library);
    let restarted = sandbox.library();
    assert_eq!(restarted.list().unwrap().entries.len(), 1);
    assert_eq!(
        restarted
            .load(key)
            .unwrap()
            .clean_package
            .unwrap()
            .score_json
            .as_bytes(),
        original["score.json"]
    );
    let other = Sandbox::new();
    let response = request(
        &other.library(),
        "/api/library/import/commit",
        response.body().clone(),
    );
    assert_eq!(response.status(), 200);
    let report: Value = serde_json::from_slice(response.body()).unwrap();
    assert_eq!(report["items"][0]["entry"]["key"], key);
}

#[test]
fn basic_key_stateless_api_matches_native_runtime_and_rejects_forged_projection() {
    let sandbox = Sandbox::new();
    let library = sandbox.library();
    let original = files();
    let saved = imported(&library, original.clone());
    let key = saved["items"][0]["entry"]["key"].as_str().unwrap();
    let response =
        practice_server::api_response("/api/clean-song/basic-keys", original["score.json"].clone());
    assert_eq!(response.status, 200);
    assert_eq!(
        serde_json::from_slice::<Value>(&response.body).unwrap(),
        library.load(key).unwrap().clean_package.unwrap().runtime
    );
    let mut forged: Value = serde_json::from_slice(&original["score.json"]).unwrap();
    forged["notation"]["parts"][0]["notes"][0]["velocity"] = json!(1);
    let rejected = practice_server::api_response(
        "/api/clean-song/basic-keys",
        serde_json::to_vec(&forged).unwrap(),
    );
    assert_eq!(rejected.status, 422);
    assert_eq!(
        serde_json::from_slice::<Value>(&rejected.body).unwrap()["code"],
        "basic_keys_invalid"
    );
}

#[test]
fn large_basic_key_package_loads_all_41900_targets_within_existing_response_bound() {
    let mut track = Vec::new();
    for _ in 0..41_900 {
        track.extend([1, 0x90, 60, 90, 1, 0x80, 60, 0]);
    }
    track.extend([0, 255, 47, 0]);
    let mut source = b"MThd\0\0\0\x06\0\0\0\x01\x01\xe0MTrk".to_vec();
    source.extend((track.len() as u32).to_be_bytes());
    source.extend(track);
    let files = files_for_source(&source, "Original large basic-key consumer fixture");
    let score_bytes = files["score.json"].len();
    let sandbox = Sandbox::new();
    let library = sandbox.library();
    let saved = imported(&library, files);
    let key = saved["items"][0]["entry"]["key"].as_str().unwrap();
    let response = request(
        &library,
        "/api/library/load",
        serde_json::to_vec(&json!({"key":key})).unwrap(),
    );
    assert_eq!(
        response.status(),
        200,
        "{}",
        String::from_utf8_lossy(response.body())
    );
    assert!(response.body().len() < 32 * 1024 * 1024);
    let loaded: Value = serde_json::from_slice(response.body()).unwrap();
    assert!(loaded["score_json"].is_null());
    assert!(loaded["entry"]["score_bytes"].as_u64().unwrap() > 8 * 1024 * 1024);
    assert_eq!(
        loaded["clean_package"]["runtime"]["compilation"]["timeline"]["notes"]
            .as_array()
            .unwrap()
            .len(),
        41_900
    );
    assert_eq!(
        loaded["clean_package"]["runtime"]["parts"][0]["attacks"],
        41_900
    );
    let page_request = json!({"source":{"key":key,"content_sha256":loaded["entry"]["content_sha256"],"profile":score_core::basic_keys::PROFILE},"settings":{"part_id":loaded["clean_package"]["runtime"]["parts"][0]["id"],"first_measure":0,"measure_count":1,"display_meter":{"numerator":4,"denominator":4}}});
    let page_bytes = serde_json::to_vec(&page_request).unwrap();
    assert!(page_bytes.len() < 1024);
    let page_started = std::time::Instant::now();
    let page_response = request(&library, "/api/library/basic-keys/notation", page_bytes);
    assert_eq!(
        page_response.status(),
        200,
        "{}",
        String::from_utf8_lossy(page_response.body())
    );
    assert!(page_response.body().len() < 2 * 1024 * 1024);
    eprintln!(
        "Large basic-key bounded notation page: {} bytes in {:.3}s",
        page_response.body().len(),
        page_started.elapsed().as_secs_f64()
    );
    let page: Value = serde_json::from_slice(page_response.body()).unwrap();
    assert_eq!(page["page"]["status"], "ready");
    assert!(
        page["page"]["score"]["parts"][0]["notes"]
            .as_array()
            .unwrap()
            .len()
            < 2048
    );
    eprintln!(
        "Large basic-key consumer: complete score {} bytes, native load {} bytes",
        score_bytes,
        response.body().len()
    );
}

#[test]
fn basic_notation_view_is_source_bound_and_requires_an_explicit_missing_meter_choice() {
    let sandbox = Sandbox::new();
    let library = sandbox.library();
    let original = files();
    let saved = imported(&library, original.clone());
    let entry = &saved["items"][0]["entry"];
    let key = entry["key"].as_str().unwrap();
    let complete = score_core::basic_keys::decode_json(&original["score.json"]).unwrap();
    let part = &complete.notation.parts[0].id;
    let mut body = json!({"source":{"key":key,"content_sha256":entry["content_sha256"],"profile":score_core::basic_keys::PROFILE},"settings":{"part_id":part,"first_measure":0,"measure_count":8,"display_meter":null}});
    let response = request(
        &library,
        "/api/library/basic-keys/notation",
        serde_json::to_vec(&body).unwrap(),
    );
    assert_eq!(
        response.status(),
        200,
        "{}",
        String::from_utf8_lossy(response.body())
    );
    let missing: Value = serde_json::from_slice(response.body()).unwrap();
    assert_eq!(missing["page"]["status"], "display_meter_required");
    assert!(missing["page"]["score"].is_null());
    body["settings"]["display_meter"] = json!({"numerator":4,"denominator":4});
    let response = request(
        &library,
        "/api/library/basic-keys/notation",
        serde_json::to_vec(&body).unwrap(),
    );
    assert_eq!(
        response.status(),
        200,
        "{}",
        String::from_utf8_lossy(response.body())
    );
    let ready: Value = serde_json::from_slice(response.body()).unwrap();
    assert_eq!(ready["source"], body["source"]);
    assert_eq!(ready["page"]["status"], "ready");
    assert_eq!(ready["page"]["meter_origin"], "chosen_display_meter");
    assert_eq!(ready["page"]["tempo_origin"], "smf_default_presentation");
    assert_eq!(ready["page"]["key_origin"], "unspecified");
    assert_eq!(ready["page"]["coverage"]["unresolved_attacks"], 1);
    assert_eq!(ready["page"]["coverage"]["instantaneous_attacks"], 1);
    assert_eq!(ready["page"]["score"]["parts"].as_array().unwrap().len(), 1);
    assert_eq!(
        ready["page"]["score"]["parts"][0]["notes"][0]["id"],
        complete.notation.parts[0].notes[0].id
    );
    assert!(ready["page"]["musicxml"]["xml"]
        .as_str()
        .unwrap()
        .contains("<score-partwise"));
    let fixture = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../../tests/fixtures/basic-keys-notation-page.json");
    if std::env::var_os("WMH_UPDATE_BASIC_KEYS_FIXTURE").is_some() {
        fs::write(
            &fixture,
            serde_json::to_vec_pretty(&json!({"request":body,"missing":missing,"ready":ready}))
                .unwrap(),
        )
        .unwrap();
    }
    let stored: Value = serde_json::from_slice(&fs::read(fixture).unwrap()).unwrap();
    assert_eq!(
        stored,
        json!({"request":body,"missing":missing,"ready":ready})
    );
    let mut forged = body.clone();
    forged["source"]["content_sha256"] = json!("0".repeat(64));
    assert_eq!(
        request(
            &library,
            "/api/library/basic-keys/notation",
            serde_json::to_vec(&forged).unwrap()
        )
        .status(),
        422
    );
    forged = body.clone();
    forged["settings"]["score"] = json!({"parts":[]});
    assert_eq!(
        request(
            &library,
            "/api/library/basic-keys/notation",
            serde_json::to_vec(&forged).unwrap()
        )
        .status(),
        400
    );
    forged = body.clone();
    forged["settings"]["measure_count"] = json!(33);
    assert_eq!(
        request(
            &library,
            "/api/library/basic-keys/notation",
            serde_json::to_vec(&forged).unwrap()
        )
        .status(),
        422
    );
    let drum = complete
        .performance
        .parts
        .iter()
        .find(|part| part.channel == 9)
        .unwrap();
    body["settings"]["part_id"] = json!(drum.id);
    let response = request(
        &library,
        "/api/library/basic-keys/notation",
        serde_json::to_vec(&body).unwrap(),
    );
    assert_eq!(response.status(), 200);
    let drum: Value = serde_json::from_slice(response.body()).unwrap();
    assert_eq!(drum["page"]["status"], "percussion_mapping_required");
    assert!(drum["page"]["score"].is_null());
    assert_eq!(
        library
            .load(key)
            .unwrap()
            .clean_package
            .unwrap()
            .score_json
            .as_bytes(),
        original["score.json"]
    );
}

#[test]
fn basic_notation_follow_uses_the_source_clock_for_silence_late_tempo_and_page_ties() {
    // Original three-bar figure: first note follows one silent beat, then a
    // source tempo event at beat four slows the remaining eight beats.
    let conductor = vec![
        0, 255, 88, 4, 4, 2, 24, 8, 0x83, 0, 255, 81, 3, 15, 66, 64, 0x86, 0, 255, 47, 0,
    ];
    let keys = vec![
        96, 0x90, 60, 90, 0x86, 0, 0x90, 64, 80, 96, 0x80, 64, 0, 0x81, 64, 0x80, 60, 0, 0, 255,
        47, 0,
    ];
    let mut source = b"MThd\0\0\0\x06\0\x01\0\x02\0\x60".to_vec();
    for track in [conductor, keys] {
        source.extend(b"MTrk");
        source.extend((track.len() as u32).to_be_bytes());
        source.extend(track);
    }
    let sandbox = Sandbox::new();
    let library = sandbox.library();
    let original = files_for_source(&source, "Original basic-key follow fixture");
    let saved = imported(&library, original.clone());
    let entry = &saved["items"][0]["entry"];
    let key = entry["key"].as_str().unwrap();
    let loaded = library.load(key).unwrap();
    let package = loaded.clean_package.as_ref().unwrap();
    let part = &package.runtime["parts"][0]["id"];
    let body = json!({"source":{"key":key,"content_sha256":entry["content_sha256"],"profile":score_core::basic_keys::PROFILE},"settings":{"part_id":part,"first_measure":0,"measure_count":1,"display_meter":null}});
    let mut pages = vec![];
    for (position, first, start, end) in [
        (0., 0, 0., 2000.),
        (2000., 1, 2000., 6000.),
        (6500., 2, 6000., 10000.),
        (1000., 0, 0., 2000.),
    ] {
        let mut lookup = body.clone();
        lookup["settings"]["position_ms"] = json!(position);
        let response = request(
            &library,
            "/api/library/basic-keys/notation",
            serde_json::to_vec(&lookup).unwrap(),
        );
        assert_eq!(
            response.status(),
            200,
            "{}",
            String::from_utf8_lossy(response.body())
        );
        let page: Value = serde_json::from_slice(response.body()).unwrap();
        assert_eq!(page["page"]["status"], "ready");
        assert_eq!(page["page"]["first_measure"], first);
        assert_eq!(page["page"]["source_start_ms"], start);
        assert_eq!(page["page"]["source_end_ms"], end);
        assert_eq!(
            page["page"]["score"]["parts"][0]["notes"][0]["id"],
            package.runtime["compilation"]["timeline"]["notes"][0]["id"]
        );
        pages.push(json!({"request":lookup,"response":page}));
    }
    assert_eq!(
        package.runtime["compilation"]["timeline"]["notes"][0]["start_ms"],
        500.
    );
    assert_eq!(
        pages[0]["response"]["page"]["tempo_origin"],
        "smf_default_presentation"
    );
    assert_eq!(pages[1]["response"]["page"]["tempo_origin"], "source");
    assert_eq!(
        pages[0]["response"]["page"]["continuations"][0]["leaves_page"],
        true
    );
    assert_eq!(
        pages[1]["response"]["page"]["continuations"][0]["enters_page"],
        true
    );
    let fixture = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../../tests/fixtures/basic-keys-notation-follow.json");
    let data =
        json!({"open":{"score_json":loaded.score_json,"clean_package":package},"pages":pages});
    if std::env::var_os("WMH_UPDATE_BASIC_KEYS_FIXTURE").is_some() {
        fs::write(&fixture, serde_json::to_vec_pretty(&data).unwrap()).unwrap();
    }
    assert_eq!(
        serde_json::from_slice::<Value>(&fs::read(fixture).unwrap()).unwrap(),
        data
    );
    assert_eq!(
        library
            .load(key)
            .unwrap()
            .clean_package
            .unwrap()
            .score_json
            .as_bytes(),
        original["score.json"]
    );
}

#[test]
fn no_clock_basic_notation_is_a_paused_view_without_any_fabricated_timeline() {
    let conductor = vec![
        0, 255, 88, 4, 4, 2, 24, 8, 0, 255, 81, 3, 7, 161, 32, 96, 255, 47, 0,
    ];
    let keys = vec![
        0, 255, 81, 3, 15, 66, 64, 0, 0x90, 60, 90, 96, 0x80, 60, 0, 0, 255, 47, 0,
    ];
    let mut source = b"MThd\0\0\0\x06\0\x01\0\x02\0\x60".to_vec();
    for track in [conductor, keys] {
        source.extend(b"MTrk");
        source.extend((track.len() as u32).to_be_bytes());
        source.extend(track);
    }
    let sandbox = Sandbox::new();
    let library = sandbox.library();
    let original = files_for_source(&source, "Original ambiguous-clock inspection fixture");
    let saved = imported(&library, original.clone());
    let entry = &saved["items"][0]["entry"];
    let key = entry["key"].as_str().unwrap();
    let loaded = library.load(key).unwrap();
    let package = loaded.clean_package.as_ref().unwrap();
    assert!(package.runtime["compilation"].is_null());
    let body = json!({"source":{"key":key,"content_sha256":entry["content_sha256"],"profile":score_core::basic_keys::PROFILE},"settings":{"part_id":package.runtime["parts"][0]["id"],"first_measure":0,"measure_count":8,"display_meter":null}});
    let response = request(
        &library,
        "/api/library/basic-keys/notation",
        serde_json::to_vec(&body).unwrap(),
    );
    assert_eq!(
        response.status(),
        200,
        "{}",
        String::from_utf8_lossy(response.body())
    );
    let page: Value = serde_json::from_slice(response.body()).unwrap();
    assert_eq!(page["page"]["status"], "ready");
    assert!(page["page"]["source_start_ms"].is_null());
    assert!(page["page"]["source_end_ms"].is_null());
    assert!(page["page"]["measures"][0]["start_ms"].is_null());
    assert!(page["page"]["score"]["tempo"]
        .as_array()
        .unwrap()
        .is_empty());
    let fixture = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../../tests/fixtures/basic-keys-notation-no-clock.json");
    let data = json!({"open":{"score_json":loaded.score_json,"clean_package":package},"request":body,"response":page});
    if std::env::var_os("WMH_UPDATE_BASIC_KEYS_FIXTURE").is_some() {
        fs::write(&fixture, serde_json::to_vec_pretty(&data).unwrap()).unwrap();
    }
    assert_eq!(
        serde_json::from_slice::<Value>(&fs::read(fixture).unwrap()).unwrap(),
        data
    );
    assert_eq!(
        library
            .load(key)
            .unwrap()
            .clean_package
            .unwrap()
            .score_json
            .as_bytes(),
        original["score.json"]
    );
}
