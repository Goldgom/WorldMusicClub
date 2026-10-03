//! Only original authored fixtures, never provided/private music.
#[path = "support/performance_fixture.rs"]
mod performance_fixture;
use http::Request;
use performance_fixture::{files, hash};
use serde_json::{json, Value};
use std::{
    collections::BTreeMap,
    fs,
    io::{Cursor, Read, Write},
    path::PathBuf,
    sync::atomic::{AtomicU64, Ordering},
};
use worldmusichub_desktop::{
    dispatch_with_library,
    native_library::{clean_package, NativeLibrary},
    ORIGIN,
};
static SEQUENCE: AtomicU64 = AtomicU64::new(0);
struct Sandbox(PathBuf);
impl Sandbox {
    fn new() -> Self {
        let p = std::env::temp_dir().join(format!(
            "wmh-performance-{}-{}",
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
fn zip(files: &BTreeMap<String, Vec<u8>>) -> Vec<u8> {
    let mut z = zip::ZipWriter::new(Cursor::new(Vec::new()));
    for (p, b) in files {
        z.start_file(p, zip::write::SimpleFileOptions::default())
            .unwrap();
        z.write_all(b).unwrap();
    }
    z.finish().unwrap().into_inner()
}
fn request(library: &NativeLibrary, path: &str, body: Vec<u8>) -> http::Response<Vec<u8>> {
    dispatch_with_library(
        Request::builder()
            .method("POST")
            .uri(format!("{ORIGIN}{path}"))
            .header("content-type", "application/json")
            .header("x-wmh-filename", "authored-performance.zip")
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
fn parse(
    files: &BTreeMap<String, Vec<u8>>,
) -> Result<clean_package::Package, worldmusichub_desktop::native_library::LibraryError> {
    let inventory = files
        .iter()
        .map(|(p, b)| (p.clone(), (b.len() as u64, hash(b))))
        .collect();
    clean_package::parse(&files["metadata.json"], &files["score.json"], &inventory)
}
fn edit_metadata(files: &mut BTreeMap<String, Vec<u8>>, edit: impl FnOnce(&mut Value)) {
    let mut v: Value = serde_json::from_slice(&files["metadata.json"]).unwrap();
    edit(&mut v);
    files.insert("metadata.json".into(), serde_json::to_vec(&v).unwrap());
}
#[test]
fn complete_commands_survive_native_import_restart_asset_and_exact_export() {
    let sandbox = Sandbox::new();
    let library = sandbox.library();
    let mut original = files(false);
    original.get_mut("score.json").unwrap().extend(b" \t\n");
    let raw = original["score.json"].clone();
    edit_metadata(&mut original, |metadata| {
        metadata["score"]["bytes"] = json!(raw.len());
        metadata["score"]["sha256"] = json!(hash(&raw));
    });
    let preview = import(&library, &original, false);
    assert_eq!(preview["summary"]["ready"], 1);
    assert_eq!(preview["items"][0]["playable"], false);
    assert_eq!(
        preview["items"][0]["clean_package"]["notation_available"],
        false
    );
    assert!(library.list().unwrap().entries.is_empty());
    let saved = import(&library, &original, true);
    assert_eq!(saved["summary"]["saved"], 1, "{saved}");
    let key = saved["items"][0]["entry"]["key"].as_str().unwrap();
    assert_eq!(import(&library, &original, true)["summary"]["duplicate"], 1);
    let loaded = library.load(key).unwrap();
    assert!(loaded.score_json.is_none());
    let package = loaded.clean_package.unwrap();
    assert_eq!(package.score_json.as_bytes(), original["score.json"]);
    assert_eq!(package.runtime["tracks"].as_array().unwrap().len(), 11);
    assert_eq!(
        package.runtime["coverage"]["performance"]["key_attacks"],
        20
    );
    assert!(package.runtime.get("notes").is_none());
    assert_eq!(
        package.runtime["score_sha256"],
        hash(&original["score.json"])
    );
    let response = request(
        &library,
        "/api/library/load",
        serde_json::to_vec(&json!({"key":key})).unwrap(),
    );
    let response: Value = serde_json::from_slice(response.body()).unwrap();
    assert!(response["score_json"].is_null());
    let asset = request(
        &library,
        "/api/library/asset",
        serde_json::to_vec(&json!({"key":key,"handle":package.media[0].handle})).unwrap(),
    );
    assert_eq!(asset.status(), 200);
    assert_eq!(asset.body(), &original["media/stem.wav"]);
    let practice=request(&library,"/api/library/runtime",serde_json::to_vec(&json!({"key":key,"profile":"wmh-performance-midi1-v1","choice":"base_notes_instrumental"})).unwrap());
    assert!(!practice.status().is_success());
    let exported = request(
        &library,
        "/api/library/pack/export",
        serde_json::to_vec(&json!({"keys":[key]})).unwrap(),
    );
    assert_eq!(exported.status(), 200);
    let mut archive = zip::ZipArchive::new(Cursor::new(exported.body())).unwrap();
    assert_eq!(archive.len(), original.len() + 1);
    for (path, bytes) in &original {
        let mut actual = Vec::new();
        archive
            .by_name(&format!("songs/{key}/{path}"))
            .unwrap()
            .read_to_end(&mut actual)
            .unwrap();
        assert_eq!(&actual, bytes);
    }
    drop(library);
    let restarted = sandbox.library();
    assert!(restarted.load(key).unwrap().score_json.is_none());
    assert_eq!(
        restarted.load(key).unwrap().clean_package.unwrap().runtime,
        package.runtime
    );
    let second = Sandbox::new();
    let reimport = request(
        &second.library(),
        "/api/library/import/commit",
        exported.into_body(),
    );
    assert_eq!(reimport.status(), 200);
    let reimport: Value = serde_json::from_slice(reimport.body()).unwrap();
    assert_eq!(reimport["summary"]["saved"], 1);
    assert_eq!(reimport["items"][0]["entry"]["key"], key);
    fs::remove_dir_all(sandbox.0.join("Scores/clean-songs").join(key)).unwrap();
    let recovered = sandbox.library();
    assert_eq!(recovered.list().unwrap().entries.len(), 1);
    assert!(recovered.load(key).unwrap().score_json.is_none());
    assert_eq!(
        recovered
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
fn binding_rejects_wrong_identity_source_hash_media_and_extra_payload() {
    let original = files(false);
    assert!(parse(&original).is_ok());
    for edit in [
        |v: &mut Value| v["id"] = json!("wrong"),
        |v: &mut Value| v["title"] = json!("wrong"),
        |v: &mut Value| v["sources"][0]["sha256"] = json!("0".repeat(64)),
        |v: &mut Value| v["score"]["sha256"] = json!("0".repeat(64)),
        |v: &mut Value| v["media"][0]["parts"] = json!(["missing"]),
    ] {
        let mut broken = original.clone();
        edit_metadata(&mut broken, edit);
        assert!(parse(&broken).is_err());
    }
    let mut extra = original.clone();
    extra.insert("original.mid".into(), vec![1]);
    assert!(parse(&extra).is_err());
    let mut missing = original.clone();
    missing.remove("media/stem.wav");
    assert!(parse(&missing).is_err());
    for edit in [
        |v: &mut Value| v["version"] = json!(1),
        |v: &mut Value| v["profile"] = json!("wmh-vsq-clean-v1"),
        |v: &mut Value| v["performance"]["profile"] = json!("wmh-semantic-midi1-v1"),
        |v: &mut Value| v["notation"] = json!({}),
        |v: &mut Value| v["raw_events"] = json!([]),
    ] {
        let mut broken = original.clone();
        let mut score: Value = serde_json::from_slice(&broken["score.json"]).unwrap();
        edit(&mut score);
        let raw = serde_json::to_vec(&score).unwrap();
        edit_metadata(&mut broken, |v| {
            v["score"]["bytes"] = json!(raw.len());
            v["score"]["sha256"] = json!(hash(&raw));
        });
        broken.insert("score.json".into(), raw);
        assert!(parse(&broken).is_err());
    }
}
#[test]
fn receiver_unsupported_commands_remain_structurally_complete_without_practice_claims() {
    let package = parse(&files(true)).unwrap();
    assert!(package.notation_json.is_none());
    assert!(!package.summary().notation_available);
    assert!(package.runtime["events"]
        .as_array()
        .unwrap()
        .iter()
        .any(|e| e["command"]["kind"] == "volume"));
    assert_eq!(
        package.summary().coverage["targets"]["represented_attacks"],
        0
    );
}
