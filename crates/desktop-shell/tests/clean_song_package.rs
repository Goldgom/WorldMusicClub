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
            "wmh-clean-package-{}-{}",
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
            include_bytes!("../../../tests/fixtures/clean-song-v2/metadata.json").to_vec(),
        ),
        (
            "score.json".into(),
            include_bytes!("../../../tests/fixtures/clean-song-v2/score.json").to_vec(),
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
fn add_media(files: &mut BTreeMap<String, Vec<u8>>) {
    // Original one-pixel RGBA PNG (generated locally, no third-party asset).
    let png = vec![
        137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82, 0, 0, 0, 1, 0, 0, 0, 1, 8, 6,
        0, 0, 0, 31, 21, 196, 137, 0, 0, 0, 13, 73, 68, 65, 84, 120, 156, 99, 96, 96, 96, 248, 15,
        0, 1, 4, 1, 0, 95, 229, 195, 75, 0, 0, 0, 0, 73, 69, 78, 68, 174, 66, 96, 130,
    ];
    use sha2::{Digest, Sha256};
    let mut metadata: Value = serde_json::from_slice(&files["metadata.json"]).unwrap();
    metadata["media"] = json!([{"id":"cover","role":"cover","path":"media/cover.png","mime":"image/png","bytes":png.len(),"sha256":format!("{:x}",Sha256::digest(&png)),"rights":{"status":"original_authored","attribution":"Original test pixel","license":"CC0-1.0"}}]);
    files.insert("media/cover.png".into(), png);
    files.insert(
        "metadata.json".into(),
        serde_json::to_vec_pretty(&metadata).unwrap(),
    );
}
#[test]
fn complete_package_roundtrips_assets_semantics_and_restart() {
    let sandbox = Sandbox::new();
    let library = sandbox.library();
    let mut original = files();
    add_media(&mut original);
    let preview = import(&library, &original, false);
    assert_eq!(preview["summary"]["ready"], 1);
    assert!(library.list().unwrap().entries.is_empty());
    let saved = import(&library, &original, true);
    assert_eq!(saved["summary"]["saved"], 1);
    let key = saved["items"][0]["entry"]["key"].as_str().unwrap();
    let reopened = sandbox.library();
    let listed = reopened.list().unwrap();
    assert_eq!(listed.entries.len(), 1);
    assert_eq!(listed.entries[0].library_format_version, 2);
    let loaded = reopened.load(key).unwrap();
    let clean = loaded.clean_package.unwrap();
    assert_eq!(clean.metadata_json.as_bytes(), &original["metadata.json"]);
    assert_eq!(clean.score_json.as_bytes(), &original["score.json"]);
    assert!(clean.runtime["notes"].as_array().unwrap().len() > 1);
    let notation: Value = serde_json::from_str(&loaded.score_json).unwrap();
    assert!(notation["source"].is_null());
    let asset = request(
        &reopened,
        "/api/library/asset",
        serde_json::to_vec(&json!({"key":key,"handle":clean.media[0].handle})).unwrap(),
    );
    assert_eq!(asset.status(), 200);
    assert_eq!(asset.headers()["content-type"], "image/png");
    assert_eq!(asset.body(), &original["media/cover.png"]);
    let wrong = request(
        &reopened,
        "/api/library/asset",
        serde_json::to_vec(&json!({"key":key,"handle":format!("asset-{}","0".repeat(64))}))
            .unwrap(),
    );
    assert_eq!(wrong.status(), 404);
    let unsafe_path = request(
        &reopened,
        "/api/library/asset",
        serde_json::to_vec(&json!({"key":key,"handle":"../../source.bin"})).unwrap(),
    );
    assert_eq!(unsafe_path.status(), 422);
    let old_export = request(
        &reopened,
        "/api/library/export",
        serde_json::to_vec(&json!({"key":key})).unwrap(),
    );
    assert_eq!(old_export.status(), 409);
    let exported = request(
        &reopened,
        "/api/library/pack/export",
        serde_json::to_vec(&json!({"keys":[key]})).unwrap(),
    );
    assert_eq!(exported.status(), 200);
    let output = unzip(exported.body());
    assert_eq!(output.len(), 4);
    for (path, bytes) in original {
        assert_eq!(output[&format!("songs/{key}/{path}")], bytes);
    }
    let manifest: Value = serde_json::from_slice(&output["manifest.json"]).unwrap();
    assert_eq!(manifest["version"], 2);
    let other = Sandbox::new();
    let second = other.library();
    let result = request(
        &second,
        "/api/library/import/commit",
        exported.body().clone(),
    );
    assert_eq!(result.status(), 200);
    let report: Value = serde_json::from_slice(result.body()).unwrap();
    assert_eq!(report["summary"]["saved"], 1);
    assert_eq!(report["items"][0]["entry"]["key"], key);
    assert_eq!(import(&library, &files(), true)["summary"]["conflict"], 1);
    assert_eq!(
        import(&reopened, &unzip(&zip(&files())), false)["summary"]["conflict"],
        1
    );
    assert!(fs::read_dir(sandbox.0.join("Scores/imports"))
        .unwrap()
        .any(|e| e.unwrap().path().join("source.bin").exists()));
}
#[test]
fn missing_optional_media_is_valid_and_declared_corruption_is_never_completed() {
    let sandbox = Sandbox::new();
    let library = sandbox.library();
    assert_eq!(import(&library, &files(), false)["summary"]["ready"], 1);
    let mut clean = files();
    add_media(&mut clean);
    for bad in [
        "missing",
        "checksum",
        "magic",
        "undeclared",
        "source",
        "traversal",
        "duplicate_field",
    ] {
        let mut candidate = clean.clone();
        let mut metadata: Value = serde_json::from_slice(&candidate["metadata.json"]).unwrap();
        match bad {
            "missing" => {
                candidate.remove("media/cover.png");
            }
            "checksum" => candidate.get_mut("media/cover.png").unwrap()[0] = 0,
            "magic" => {
                metadata["media"][0]["mime"] = json!("image/jpeg");
            }
            "undeclared" => {
                candidate.insert("debug.json".into(), b"{}".to_vec());
            }
            "source" => {
                candidate.insert("source.mid".into(), b"MThd".to_vec());
            }
            "traversal" => metadata["media"][0]["path"] = json!("media/../cover.png"),
            _ => (),
        }
        candidate.insert(
            "metadata.json".into(),
            serde_json::to_vec(&metadata).unwrap(),
        );
        if bad == "duplicate_field" {
            let raw = String::from_utf8(candidate["metadata.json"].clone()).unwrap();
            candidate.insert(
                "metadata.json".into(),
                raw.replacen("{", "{\"version\":2,", 1).into_bytes(),
            );
            let r = request(&library, "/api/library/import/preview", zip(&candidate));
            assert_eq!(r.status(), 200);
            let report: Value = serde_json::from_slice(r.body()).unwrap();
            assert_eq!(report["summary"]["ready"], 0);
            assert_eq!(report["summary"]["retained_nonplayable"], 1);
            continue;
        }
        let report = import(&library, &candidate, true);
        assert_eq!(report["summary"]["saved"], 0, "{bad}: {report}");
        assert_eq!(
            report["summary"]["retained_nonplayable"], 1,
            "{bad}: {report}"
        );
        assert!(report["source"]["retained"].as_bool().unwrap());
    }
    assert!(library.list().unwrap().entries.is_empty());
}
#[test]
fn recovery_restores_every_file_and_never_overwrites_corrupt_primary() {
    let sandbox = Sandbox::new();
    let library = sandbox.library();
    let mut original = files();
    add_media(&mut original);
    let report = import(&library, &original, true);
    let key = report["items"][0]["entry"]["key"].as_str().unwrap();
    let primary = sandbox.0.join("Scores/clean-songs").join(key);
    fs::rename(&primary, sandbox.0.join("interrupted-primary")).unwrap();
    let reopened = sandbox.library();
    let recovered = reopened.list().unwrap();
    assert_eq!(recovered.entries.len(), 1);
    assert!(recovered
        .issues
        .iter()
        .any(|i| i.code == "library_recovered_backup"));
    assert_eq!(
        fs::read(primary.join("package/media/cover.png")).unwrap(),
        original["media/cover.png"]
    );
    fs::write(primary.join("package/media/cover.png"), b"damaged").unwrap();
    let damaged = reopened.list().unwrap();
    assert!(damaged.entries.is_empty());
    assert_eq!(
        fs::read(primary.join("package/media/cover.png")).unwrap(),
        b"damaged"
    );
    assert!(reopened.load(key).is_err());
    assert!(sandbox
        .0
        .join("Scores/clean-backups")
        .join(key)
        .join("package/media/cover.png")
        .exists());
}
#[test]
fn mixed_batch_has_explicit_partial_results_and_idempotent_retry() {
    let sandbox = Sandbox::new();
    let library = sandbox.library();
    let mut all = BTreeMap::new();
    for (path, bytes) in files() {
        all.insert(format!("songs/good/{path}"), bytes.clone());
        all.insert(format!("songs/bad/{path}"), bytes);
    }
    all.insert("songs/bad/source.mid".into(), b"MThd".to_vec());
    all.insert("manifest.json".into(),serde_json::to_vec(&json!({"format":"worldmusichub-song-pack","version":2,"songs":[{"folder":"songs/good"},{"folder":"songs/bad"}]})).unwrap());
    let first = import(&library, &all, true);
    assert_eq!(first["summary"]["saved"], 1);
    assert_eq!(first["summary"]["retained_nonplayable"], 1);
    let retry = import(&library, &all, true);
    assert_eq!(retry["summary"]["saved"], 0);
    assert_eq!(retry["summary"]["duplicate"], 1);
    assert_eq!(retry["summary"]["retained_nonplayable"], 1);
    assert_eq!(library.list().unwrap().entries.len(), 1);
}
#[cfg(unix)]
#[test]
fn symlink_media_is_rejected_without_reading_target() {
    use std::os::unix::fs::symlink;
    let sandbox = Sandbox::new();
    let library = sandbox.library();
    let mut original = files();
    add_media(&mut original);
    let report = import(&library, &original, true);
    let key = report["items"][0]["entry"]["key"].as_str().unwrap();
    let path = sandbox
        .0
        .join("Scores/clean-songs")
        .join(key)
        .join("package/media/cover.png");
    fs::rename(&path, sandbox.0.join("pixel.png")).unwrap();
    symlink(sandbox.0.join("pixel.png"), &path).unwrap();
    assert!(library.load(key).is_err());
    assert!(library.list().unwrap().entries.is_empty());
}

#[test]
fn batch_154_complete_packages_reopens_without_per_song_library_rescans() {
    use sha2::{Digest, Sha256};
    let sandbox = Sandbox::new();
    let library = sandbox.library();
    let base = files();
    let mut pack = BTreeMap::new();
    let mut songs = Vec::new();
    for index in 0..154 {
        let mut metadata: Value = serde_json::from_slice(&base["metadata.json"]).unwrap();
        let mut score: Value = serde_json::from_slice(&base["score.json"]).unwrap();
        let id = format!("authored-scale-{index}");
        score["notation"]["id"] = json!(id);
        metadata["id"] = json!(id);
        let score = serde_json::to_vec(&score).unwrap();
        metadata["score"]["bytes"] = json!(score.len());
        metadata["score"]["sha256"] = json!(format!("{:x}", Sha256::digest(&score)));
        let folder = format!("songs/example-{index}");
        pack.insert(
            format!("{folder}/metadata.json"),
            serde_json::to_vec(&metadata).unwrap(),
        );
        pack.insert(format!("{folder}/score.json"), score);
        songs.push(json!({"folder":folder}));
    }
    pack.insert(
        "manifest.json".into(),
        serde_json::to_vec(&json!({"format":"worldmusichub-song-pack","version":2,"songs":songs}))
            .unwrap(),
    );
    let started = std::time::Instant::now();
    let report = import(&library, &pack, true);
    let imported = started.elapsed();
    assert_eq!(report["summary"]["saved"], 154);
    let started = std::time::Instant::now();
    let entries = sandbox.library().list().unwrap().entries;
    let reopened = started.elapsed();
    assert_eq!(entries.len(), 154);
    eprintln!(
        "154 authored complete songs: import={imported:?}; fully verified reopen={reopened:?}"
    );
}

#[cfg(unix)]
#[test]
fn replaced_clean_area_symlink_never_expands_native_access() {
    use std::os::unix::fs::symlink;
    let sandbox = Sandbox::new();
    let library = sandbox.library();
    let mut original = files();
    add_media(&mut original);
    let report = import(&library, &original, true);
    let key = report["items"][0]["entry"]["key"].as_str().unwrap();
    let loaded = library.load(key).unwrap();
    let handle = &loaded.clean_package.unwrap().media[0].handle;
    let area = sandbox.0.join("Scores/clean-songs");
    let target = sandbox.0.join("moved-clean-songs");
    fs::rename(&area, &target).unwrap();
    symlink(&target, &area).unwrap();
    assert!(library.load(key).is_err());
    let asset = request(
        &library,
        "/api/library/asset",
        serde_json::to_vec(&json!({"key":key,"handle":handle})).unwrap(),
    );
    assert_eq!(asset.status(), 422);
    let exported = request(
        &library,
        "/api/library/pack/export",
        serde_json::to_vec(&json!({"keys":[key]})).unwrap(),
    );
    assert_eq!(exported.status(), 422);
}
