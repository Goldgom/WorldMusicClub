//! Original C/E/G only. Stateless draft/ZIP -> existing native import -> restart.
use base64::Engine;
use http::Request;
use serde_json::{json, Value};
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
            "wmh-conversion-draft-{}-{}",
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
fn midi(event_only: bool) -> Vec<u8> {
    let mut track = vec![
        0, 255, 81, 3, 7, 161, 32, 0, 255, 88, 4, 4, 2, 24, 8, 0, 0xc0, 0,
    ];
    for key in [60, 64, 67] {
        track.extend([0, 0x90, key, 90]);
        if event_only {
            track.extend([0, 0xb0, 64, 127]);
        }
        track.extend([96, 0x80, key, 17]);
    }
    track.extend([0, 255, 47, 0]);
    let mut bytes = b"MThd\0\0\0\x06\0\0\0\x01\0\x60MTrk".to_vec();
    bytes.extend((track.len() as u32).to_be_bytes());
    bytes.extend(track);
    bytes
}
fn request(library: &NativeLibrary, path: &str, bytes: Vec<u8>) -> http::Response<Vec<u8>> {
    dispatch_with_library(
        Request::builder()
            .method("POST")
            .uri(format!("{ORIGIN}{path}"))
            .header("content-type", "application/json")
            .header("x-wmh-filename", "original-conversion.zip")
            .body(bytes)
            .unwrap(),
        library,
    )
}
fn json_request(library: &NativeLibrary, path: &str, value: &Value, status: u16) -> Value {
    let response = request(library, path, serde_json::to_vec(value).unwrap());
    assert_eq!(
        response.status(),
        status,
        "{}",
        String::from_utf8_lossy(response.body())
    );
    serde_json::from_slice(response.body()).unwrap()
}
fn unzip(bytes: &[u8]) -> BTreeMap<String, Vec<u8>> {
    let mut zip = zip::ZipArchive::new(Cursor::new(bytes)).unwrap();
    (0..zip.len())
        .map(|i| {
            let mut file = zip.by_index(i).unwrap();
            let mut bytes = vec![];
            file.read_to_end(&mut bytes).unwrap();
            (file.name().into(), bytes)
        })
        .collect()
}
#[test]
fn draft_pack_persists_only_after_existing_import_commit_and_reopens_exactly() {
    for event_only in [false, true] {
        let sandbox = Sandbox::new();
        let library = sandbox.library();
        assert!(library.list().unwrap().entries.is_empty());
        let source = midi(event_only);
        let unchanged = source.clone();
        let mut input = json!({"source_base64":base64::engine::general_purpose::STANDARD.encode(&source),"source_name":"authored.mid","title":"原创 C/E/G"});
        let body = serde_json::to_vec(&input).unwrap();
        let shared = practice_server::api_response("/api/clean-song/draft", body.clone());
        let native = request(&library, "/api/clean-song/draft", body);
        assert_eq!(native.status(), shared.status);
        assert_eq!(native.body(), &shared.body);
        let draft: Value = serde_json::from_slice(native.body()).unwrap();
        assert_eq!(
            draft["state"],
            if event_only {
                "event_only_reference_candidate"
            } else {
                "strict_notation_candidate"
            }
        );
        assert!(library.list().unwrap().entries.is_empty());
        input["expected_draft_sha256"] = draft["draft_sha256"].clone();
        let pack = json_request(&library, "/api/clean-song/draft/pack", &input, 200);
        assert_eq!(pack["draft_sha256"], draft["draft_sha256"]);
        let zip = base64::engine::general_purpose::STANDARD
            .decode(pack["zip_base64"].as_str().unwrap())
            .unwrap();
        let files = unzip(&zip);
        assert_eq!(files.len(), 3);
        assert_eq!(
            files
                .keys()
                .filter(|path| path.ends_with("metadata.json"))
                .count(),
            1
        );
        assert_eq!(
            files
                .keys()
                .filter(|path| path.ends_with("score.json"))
                .count(),
            1
        );
        assert!(files.contains_key("manifest.json"));
        for name in ["metadata_json", "score_json"] {
            let filename = name.replace('_', ".");
            let actual = files
                .iter()
                .find(|(path, _)| path.ends_with(&filename))
                .unwrap()
                .1;
            assert_eq!(actual, draft["package"][name].as_str().unwrap().as_bytes());
        }
        assert!(library.list().unwrap().entries.is_empty());
        let preview = request(&library, "/api/library/import/preview", zip.clone());
        assert_eq!(
            preview.status(),
            200,
            "{}",
            String::from_utf8_lossy(preview.body())
        );
        assert_eq!(
            serde_json::from_slice::<Value>(preview.body()).unwrap()["summary"]["ready"],
            1
        );
        assert!(library.list().unwrap().entries.is_empty());
        let committed = request(&library, "/api/library/import/commit", zip);
        assert_eq!(
            committed.status(),
            200,
            "{}",
            String::from_utf8_lossy(committed.body())
        );
        let result: Value = serde_json::from_slice(committed.body()).unwrap();
        assert_eq!(result["summary"]["saved"], 1);
        let key = result["items"][0]["entry"]["key"].as_str().unwrap();
        let reopened = sandbox.library();
        let loaded = reopened.load(key).unwrap().clean_package.unwrap();
        assert_eq!(
            loaded.metadata_json,
            draft["package"]["metadata_json"].as_str().unwrap()
        );
        assert_eq!(
            loaded.score_json,
            draft["package"]["score_json"].as_str().unwrap()
        );
        assert_eq!(source, unchanged);
    }
}
#[test]
fn changed_title_or_source_cannot_pack_the_previously_reviewed_draft() {
    let sandbox = Sandbox::new();
    let library = sandbox.library();
    let mut input = json!({"source_base64":base64::engine::general_purpose::STANDARD.encode(midi(false)),"source_name":"authored.mid","title":"Original title"});
    let draft = json_request(&library, "/api/clean-song/draft", &input, 200);
    input["expected_draft_sha256"] = draft["draft_sha256"].clone();
    input["title"] = json!("New title");
    let rejected = json_request(&library, "/api/clean-song/draft/pack", &input, 409);
    assert_eq!(rejected["code"], "clean_draft_changed");
    assert!(rejected.get("zip_base64").is_none());
    input["title"] = json!("Original title");
    input["source_base64"] = json!(base64::engine::general_purpose::STANDARD.encode(midi(true)));
    assert_eq!(
        json_request(&library, "/api/clean-song/draft/pack", &input, 409)["code"],
        "clean_draft_changed"
    );
    assert!(library.list().unwrap().entries.is_empty());
}
#[test]
fn rejected_sources_and_unknown_request_fields_do_not_write_library_entries() {
    let sandbox = Sandbox::new();
    let library = sandbox.library();
    let mut input = json!({"source_base64":"bm90IG1pZGk=","source_name":"authored.mid","title":"Original title"});
    let draft = json_request(&library, "/api/clean-song/draft", &input, 422);
    assert_eq!(draft["state"], "rejected");
    assert!(draft["package"].is_null());
    input["ignored_part"] = json!(1);
    assert_eq!(
        json_request(&library, "/api/clean-song/draft", &input, 400)["code"],
        "clean_draft_invalid_request"
    );
    assert!(library.list().unwrap().entries.is_empty());
}

#[path = "../../../tests/support/vsq_authoring.rs"]
mod vsq_fixture;
#[test]
fn vsq_draft_zip_import_restart_preserves_exact_authoring_and_requires_explicit_projection() {
    let sandbox = Sandbox::new();
    let library = sandbox.library();
    let source = vsq_fixture::source();
    let mut input = json!({"source_base64":base64::engine::general_purpose::STANDARD.encode(&source),"source_name":"authored.mid","title":"Original VSQ draft"});
    let body = serde_json::to_vec(&input).unwrap();
    let shared = practice_server::api_response("/api/clean-song/draft", body.clone());
    let native = request(&library, "/api/clean-song/draft", body);
    assert_eq!(native.status(), shared.status);
    assert_eq!(native.body(), &shared.body);
    assert_eq!(native.status(), 200);
    let draft: Value = serde_json::from_slice(native.body()).unwrap();
    assert_eq!(draft["state"], "vsq_authoring_candidate");
    assert_eq!(draft["source"]["format"], "vsq");
    assert!(draft["inventory"]["parts"][0]["channel"].is_null());
    assert!(draft.get("runtime").is_none());
    input["expected_draft_sha256"] = draft["draft_sha256"].clone();
    let pack = json_request(&library, "/api/clean-song/draft/pack", &input, 200);
    let zip = base64::engine::general_purpose::STANDARD
        .decode(pack["zip_base64"].as_str().unwrap())
        .unwrap();
    let files = unzip(&zip);
    assert_eq!(files.len(), 3);
    let folder = format!("songs/vsq-{}", draft["source"]["sha256"].as_str().unwrap());
    for (name, field) in [
        ("metadata.json", "metadata_json"),
        ("score.json", "score_json"),
    ] {
        assert_eq!(
            files[&format!("{folder}/{name}")],
            draft["package"][field].as_str().unwrap().as_bytes()
        );
    }
    assert!(library.list().unwrap().entries.is_empty());
    let response = request(&library, "/api/library/import/preview", zip.clone());
    assert_eq!(response.status(), 200);
    let preview: Value = serde_json::from_slice(response.body()).unwrap();
    assert_eq!(preview["summary"]["ready"], 1, "{preview}");
    assert_eq!(preview["items"][0]["playable"], false);
    assert!(library.list().unwrap().entries.is_empty());
    let response = request(&library, "/api/library/import/commit", zip);
    assert_eq!(response.status(), 200);
    let saved: Value = serde_json::from_slice(response.body()).unwrap();
    assert_eq!(saved["summary"]["saved"], 1, "{saved}");
    assert_eq!(saved["items"][0]["playable"], false);
    let key = saved["items"][0]["entry"]["key"].as_str().unwrap();
    let restarted = sandbox.library();
    let package = restarted.load(key).unwrap().clean_package.unwrap();
    assert!(package.runtime.is_null());
    assert_eq!(package.profile.as_deref(), Some("wmh-vsq-clean-v1"));
    assert_eq!(
        package.metadata_json,
        draft["package"]["metadata_json"].as_str().unwrap()
    );
    assert_eq!(
        package.score_json,
        draft["package"]["score_json"].as_str().unwrap()
    );
    let score = score_core::vsq_clean::decode_json(package.score_json.as_bytes()).unwrap();
    assert_eq!(score.authoring.tracks.len(), 3);
    assert!(score.authoring.mixer.tracks[1].mute);
    assert!(score.authoring.mixer.tracks[0].solo);
    assert!(score.authoring.tracks[2].notes.is_empty());
    assert_eq!(
        score.authoring.tracks[0].notes[0].lyrics[0].numeric_fields[0].coefficient,
        9007199254740993
    );
    let missing = json_request(
        &restarted,
        "/api/library/runtime",
        &json!({"key":key,"profile":"wmh-vsq-clean-v1"}),
        400,
    );
    assert!(missing.get("runtime").is_none());
    let projected = json_request(
        &restarted,
        "/api/library/runtime",
        &json!({"key":key,"profile":"wmh-vsq-clean-v1","choice":"base_notes_instrumental"}),
        200,
    );
    assert_eq!(projected["runtime"]["parts"].as_array().unwrap().len(), 3);
    assert_eq!(projected["runtime"]["notes"].as_array().unwrap().len(), 2);
    assert_eq!(projected["runtime"]["notes"][0]["audible"], true);
    assert_eq!(projected["runtime"]["notes"][1]["audible"], false);
    assert_eq!(
        restarted
            .load(key)
            .unwrap()
            .clean_package
            .unwrap()
            .score_json,
        package.score_json
    );
    input["title"] = json!("Changed title");
    assert_eq!(
        json_request(&library, "/api/clean-song/draft/pack", &input, 409)["code"],
        "clean_draft_changed"
    );
}
