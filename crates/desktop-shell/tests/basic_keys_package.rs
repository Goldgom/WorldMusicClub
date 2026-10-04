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
    eprintln!(
        "Large basic-key consumer: complete score {} bytes, native load {} bytes",
        score_bytes,
        response.body().len()
    );
}
