//! All content is authored here; storage is isolated in test-owned temp folders.
use http::Request;
use serde_json::{json, Value};
use std::{
    fs,
    path::PathBuf,
    sync::atomic::{AtomicU64, Ordering},
};
use worldmusichub_desktop::{
    dispatch, dispatch_with_library,
    native_library::{NativeLibrary, SaveRequest, MAX_SCORE_BYTES},
    ORIGIN,
};

static NEXT: AtomicU64 = AtomicU64::new(0);
struct Sandbox(PathBuf);
impl Sandbox {
    fn new() -> Self {
        let unique = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let root = std::env::temp_dir().join(format!(
            "wmh-native-library-test-{}-{unique}-{}",
            std::process::id(),
            NEXT.fetch_add(1, Ordering::Relaxed)
        ));
        fs::create_dir(&root).unwrap();
        Self(root)
    }
    fn library(&self) -> NativeLibrary {
        NativeLibrary::open(self.0.join("Scores")).unwrap()
    }
    fn area(&self, area: &str) -> PathBuf {
        self.0.join("Scores").join(area)
    }
}
impl Drop for Sandbox {
    fn drop(&mut self) {
        fs::remove_dir_all(&self.0).unwrap();
    }
}

fn score_json() -> String {
    let text = "\u{feff}format=worldmusichub-jianpu-text-v1\r\ntitle=Original storage exercise\r\ncomposer=WorldMusicHub test\r\n1=C4\r\nmode=major\r\ntempo=90\r\nmeter=4/4\r\n1:1/3 2:1/3 3:1/3 0 5 0 |\r\n";
    let (mut score, _) = score_core::import_jianpu(text).unwrap();
    // Untrusted filenames are provenance only, never filesystem paths.
    score.source.as_mut().unwrap().filename = Some("../../original.cmd".into());
    score.provenance.license = Some("CC0-1.0".into());
    format!("\n{}\n", serde_json::to_string_pretty(&score).unwrap())
}
fn save(score_json: String) -> SaveRequest {
    SaveRequest {
        score_json,
        label: None,
        allow_conflicting_id: false,
    }
}
fn request(method: &str, route: &str, body: Value) -> Request<Vec<u8>> {
    Request::builder()
        .method(method)
        .uri(format!("{ORIGIN}{route}"))
        .header("content-type", "application/json")
        .body(if method == "GET" {
            vec![]
        } else {
            serde_json::to_vec(&body).unwrap()
        })
        .unwrap()
}
fn body(response: &http::Response<Vec<u8>>) -> Value {
    serde_json::from_slice(response.body()).unwrap()
}

#[test]
fn native_storage_modules_and_styles_are_bundled_in_the_same_origin_adapter() {
    for path in [
        "/native-score-storage.js",
        "/score-storage-model.js",
        "/score-storage-view.js",
        "/score-storage-view.css",
    ] {
        let response = dispatch(request("GET", path, Value::Null));
        assert_eq!(response.status(), 200, "{path}");
        assert_eq!(response.body(), practice_server::asset(path).unwrap());
        assert!(response.headers().contains_key("content-security-policy"));
    }
    let index = dispatch(request("GET", "/", Value::Null));
    assert!(String::from_utf8_lossy(index.body()).contains("/score-storage-view.css"));
}

#[test]
fn save_restart_scan_load_and_export_keep_exact_json_source_and_rational_time() {
    let sandbox = Sandbox::new();
    let exact = score_json();
    let library = sandbox.library();
    let entry = library.save(save(exact.clone())).unwrap();
    let expected: score_core::Score = serde_json::from_str(&exact).unwrap();
    for area in ["songs", "backups"] {
        let folder = sandbox.area(area).join(&entry.key);
        assert_eq!(
            fs::read(folder.join("score.json")).unwrap(),
            exact.as_bytes()
        );
        assert_eq!(
            fs::read(folder.join("source.payload")).unwrap(),
            expected.source.as_ref().unwrap().content.as_bytes()
        );
        assert!(folder.join("metadata.json").is_file());
    }
    assert!(!sandbox.0.join("original.cmd").exists());
    drop(library);
    // No in-memory index survives reopening. Inventory is rebuilt from files.
    let restarted = sandbox.library();
    let inventory = restarted.list().unwrap();
    assert_eq!(inventory.entries.len(), 1);
    assert!(inventory.issues.is_empty());
    assert_eq!(inventory.storage, "native-filesystem");
    assert_eq!(
        restarted
            .load(&entry.key)
            .unwrap()
            .score_json
            .as_deref()
            .unwrap(),
        exact
    );
    let export = dispatch_with_library(
        request("POST", "/api/library/export", json!({"key":entry.key})),
        &restarted,
    );
    assert_eq!(export.status(), 200);
    assert_eq!(body(&export)["format"], "worldmusichub-native-score-backup");
    assert_eq!(body(&export)["score_json"], exact);
    let loaded: score_core::Score =
        serde_json::from_str(body(&export)["score_json"].as_str().unwrap()).unwrap();
    assert_eq!(
        serde_json::to_value(&loaded).unwrap(),
        serde_json::to_value(&expected).unwrap()
    );
    score_core::compile(loaded).unwrap();
}

#[test]
fn content_identity_detects_duplicates_across_json_whitespace_and_requires_explicit_edition_copy() {
    let sandbox = Sandbox::new();
    let library = sandbox.library();
    let original = score_json();
    let entry = library.save(save(original.clone())).unwrap();
    let mut value: Value = serde_json::from_str(&original).unwrap();
    let duplicate = library
        .save(save(serde_json::to_string(&value).unwrap()))
        .unwrap_err();
    assert_eq!(duplicate.code, "library_duplicate");
    assert_eq!(duplicate.status, 409);
    assert_eq!(duplicate.existing.unwrap().key, entry.key);
    value["title"] = json!("Second edition of the same id");
    let changed = serde_json::to_string(&value).unwrap();
    assert_eq!(
        library.save(save(changed.clone())).unwrap_err().code,
        "library_id_conflict"
    );
    let mut copy = save(changed.clone());
    copy.allow_conflicting_id = true;
    let second = library.save(copy).unwrap();
    assert_ne!(entry.key, second.key);
    assert_eq!(library.list().unwrap().entries.len(), 2);
    assert_eq!(
        library
            .load(&entry.key)
            .unwrap()
            .score_json
            .as_deref()
            .unwrap(),
        original
    );
    assert_eq!(
        library
            .load(&second.key)
            .unwrap()
            .score_json
            .as_deref()
            .unwrap(),
        changed
    );
}

#[test]
fn invalid_or_future_scores_and_oversized_payloads_never_publish_or_discard_fields() {
    let sandbox = Sandbox::new();
    let library = sandbox.library();
    for invalid in [
        "{}".to_string(),
        {
            let mut value: Value = serde_json::from_str(&score_json()).unwrap();
            value["unrecognized_future_field"] = json!("keep this");
            value.to_string()
        },
        {
            let mut value: Value = serde_json::from_str(&score_json()).unwrap();
            value["version"] = json!(999);
            value.to_string()
        },
    ] {
        assert_eq!(
            library.save(save(invalid)).unwrap_err().code,
            "library_invalid_score"
        );
    }
    assert_eq!(
        library
            .save(save("x".repeat(MAX_SCORE_BYTES + 1)))
            .unwrap_err()
            .code,
        "library_score_limit"
    );
    assert!(library.list().unwrap().entries.is_empty());
    assert_eq!(fs::read_dir(sandbox.area(".staging")).unwrap().count(), 0);
    assert_eq!(fs::read_dir(sandbox.area("backups")).unwrap().count(), 0);
}

#[test]
fn interrupted_publish_recovers_only_from_complete_verified_backup() {
    let sandbox = Sandbox::new();
    let exact = score_json();
    let entry = sandbox.library().save(save(exact.clone())).unwrap();
    fs::remove_dir_all(sandbox.area("songs").join(&entry.key)).unwrap();
    // Model a crash leaving an incomplete unpublished stage.
    let stage = sandbox.area(".staging").join("interrupted-own-save");
    fs::create_dir(&stage).unwrap();
    fs::write(stage.join("score.json"), b"partial").unwrap();
    let restarted = sandbox.library();
    let inventory = restarted.list().unwrap();
    assert_eq!(inventory.entries.len(), 1);
    assert!(inventory
        .issues
        .iter()
        .any(|issue| issue.code == "library_recovered_backup"));
    assert!(inventory
        .issues
        .iter()
        .any(|issue| issue.code == "library_incomplete_stages"));
    assert_eq!(
        restarted
            .load(&entry.key)
            .unwrap()
            .score_json
            .as_deref()
            .unwrap(),
        exact
    );
    assert_eq!(fs::read(stage.join("score.json")).unwrap(), b"partial");
    assert!(!restarted
        .list()
        .unwrap()
        .issues
        .iter()
        .any(|issue| issue.code == "library_recovered_backup"));
}

#[test]
fn corruption_is_visible_and_never_overwritten_with_a_backup_or_new_save() {
    let sandbox = Sandbox::new();
    let library = sandbox.library();
    let exact = score_json();
    let entry = library.save(save(exact.clone())).unwrap();
    let primary = sandbox.area("songs").join(&entry.key).join("score.json");
    fs::write(&primary, b"locally changed bytes").unwrap();
    let inventory = library.list().unwrap();
    assert!(inventory.entries.is_empty());
    assert!(inventory
        .issues
        .iter()
        .any(|issue| issue.code == "library_corrupt_entry"));
    assert_eq!(
        library.load(&entry.key).unwrap_err().code,
        "library_corrupt_entry"
    );
    assert_eq!(
        library.save(save(exact)).unwrap_err().code,
        "library_path_conflict"
    );
    assert_eq!(fs::read(primary).unwrap(), b"locally changed bytes");
}

#[test]
fn source_damage_or_unsupported_metadata_is_visible_without_silent_repair() {
    let sandbox = Sandbox::new();
    let library = sandbox.library();
    let entry = library.save(save(score_json())).unwrap();
    let folder = sandbox.area("songs").join(&entry.key);
    fs::write(folder.join("source.payload"), b"changed original").unwrap();
    assert_eq!(
        library.load(&entry.key).unwrap_err().code,
        "library_corrupt_entry"
    );
    let metadata = folder.join("metadata.json");
    let mut value: Value = serde_json::from_slice(&fs::read(&metadata).unwrap()).unwrap();
    value["library_format_version"] = json!(2);
    fs::write(metadata, value.to_string()).unwrap();
    assert_eq!(
        library.load(&entry.key).unwrap_err().code,
        "library_unsupported_version"
    );
}

#[test]
fn invalid_backup_is_reported_and_cannot_become_a_playable_song() {
    let sandbox = Sandbox::new();
    let library = sandbox.library();
    let entry = library.save(save(score_json())).unwrap();
    let backup = sandbox.area("backups").join(&entry.key).join("score.json");
    fs::write(&backup, b"incomplete").unwrap();
    assert!(library
        .list()
        .unwrap()
        .issues
        .iter()
        .any(|issue| issue.code == "library_backup_invalid"));
    fs::remove_dir_all(sandbox.area("songs").join(&entry.key)).unwrap();
    let inventory = library.list().unwrap();
    assert!(inventory.entries.is_empty());
    assert!(inventory
        .issues
        .iter()
        .any(|issue| issue.code == "library_recovery_failed"));
    assert_eq!(fs::read(backup).unwrap(), b"incomplete");
}

#[test]
fn write_failures_and_cross_instance_lock_contention_are_explicit() {
    let sandbox = Sandbox::new();
    let library = sandbox.library();
    let second = sandbox.library();
    let lock = fs::OpenOptions::new()
        .write(true)
        .read(true)
        .create(true)
        .truncate(false)
        .open(sandbox.area(".library.lock"))
        .unwrap();
    lock.lock().unwrap();
    assert_eq!(
        second.save(save(score_json())).unwrap_err().code,
        "library_busy"
    );
    drop(lock);
    fs::remove_dir(sandbox.area("backups")).unwrap();
    fs::write(sandbox.area("backups"), b"storage unavailable").unwrap();
    let response = dispatch_with_library(
        request(
            "POST",
            "/api/library/save",
            serde_json::to_value(save(score_json())).unwrap(),
        ),
        &library,
    );
    assert_eq!(response.status(), 422);
    assert_eq!(body(&response)["code"], "library_unsafe_path");
    assert_eq!(fs::read_dir(sandbox.area("songs")).unwrap().count(), 0);
}

#[test]
fn native_protocol_rejects_paths_unknown_fields_methods_origins_and_oversized_requests() {
    let sandbox = Sandbox::new();
    let library = sandbox.library();
    assert_eq!(
        body(&dispatch(request("GET", "/api/library/list", Value::Null)))["code"],
        "library_unavailable"
    );
    for key in [
        "../../outside",
        "song-../file",
        "C:\\Users\\example",
        "/tmp/score",
        "",
    ] {
        let response = dispatch_with_library(
            request("POST", "/api/library/load", json!({"key":key})),
            &library,
        );
        assert_eq!(body(&response)["code"], "library_invalid_key");
    }
    let response = dispatch_with_library(
        request(
            "POST",
            "/api/library/load",
            json!({"key":format!("song-{}", "a".repeat(64)),"path":"/tmp/escape"}),
        ),
        &library,
    );
    assert_eq!(body(&response)["code"], "library_invalid_request");
    let mut foreign = request("GET", "/api/library/list", Value::Null);
    foreign
        .headers_mut()
        .insert("origin", "https://evil.example".parse().unwrap());
    assert_eq!(dispatch_with_library(foreign, &library).status(), 403);
    let mut oversized = request("POST", "/api/library/save", Value::Null);
    *oversized.body_mut() = vec![b' '; worldmusichub_desktop::MAX_BODY + 1];
    assert_eq!(
        body(&dispatch_with_library(oversized, &library))["code"],
        "library_request_limit"
    );
    assert_eq!(
        dispatch_with_library(request("GET", "/api/library/save", Value::Null), &library).status(),
        405
    );
    assert_eq!(
        dispatch_with_library(request("POST", "/api/library/run", json!({})), &library).status(),
        404
    );
    assert!(library.list().unwrap().entries.is_empty());
}

#[test]
fn separate_process_restart_probe() {
    let Some(root) = std::env::var_os("WMH_NATIVE_LIBRARY_TEST_ROOT") else {
        return;
    };
    let library = NativeLibrary::open(root).unwrap();
    let inventory = library.list().unwrap();
    assert_eq!(inventory.entries.len(), 1);
    assert!(inventory.issues.is_empty());
    assert_eq!(
        library
            .load(&inventory.entries[0].key)
            .unwrap()
            .score_json
            .as_deref()
            .unwrap(),
        score_json()
    );
}

#[test]
fn a_fresh_process_discovers_the_persisted_song_without_a_browser_profile() {
    let sandbox = Sandbox::new();
    sandbox.library().save(save(score_json())).unwrap();
    let status = std::process::Command::new(std::env::current_exe().unwrap())
        .args(["--exact", "separate_process_restart_probe", "--nocapture"])
        .env("WMH_NATIVE_LIBRARY_TEST_ROOT", sandbox.0.join("Scores"))
        .status()
        .unwrap();
    assert!(status.success());
}

#[test]
fn unknown_inert_source_envelopes_and_assets_survive_export_and_restore() {
    let sandbox = Sandbox::new();
    let mut score: Value = serde_json::from_str(&score_json()).unwrap();
    let envelope = "\u{feff}{\r\n  \"format\":\"authored-test-assets-v1\",\r\n  \"original\":\"AAECA//+\",\r\n  \"license\":\"CC0-1.0\",\r\n  \"note\":\"Never execute retained content\"\r\n}\r\n";
    score["source"]["format"] = json!("authored-test-assets-v1");
    score["source"]["content"] = json!(envelope);
    let exact = score.to_string();
    let library = sandbox.library();
    let entry = library.save(save(exact.clone())).unwrap();
    let exported = dispatch_with_library(
        request("POST", "/api/library/export", json!({"key":entry.key})),
        &library,
    );
    assert_eq!(exported.status(), 200);
    let export = body(&exported);
    let restored = NativeLibrary::open(sandbox.0.join("RestoredScores")).unwrap();
    let restored_entry = restored
        .save(save(export["score_json"].as_str().unwrap().to_string()))
        .unwrap();
    assert_eq!(
        restored
            .load(&restored_entry.key)
            .unwrap()
            .score_json
            .as_deref()
            .unwrap(),
        exact
    );
    assert_eq!(
        fs::read(
            sandbox
                .0
                .join("RestoredScores/songs")
                .join(restored_entry.key)
                .join("source.payload")
        )
        .unwrap(),
        envelope.as_bytes()
    );
}

#[test]
fn count_limit_refuses_new_songs_without_changing_existing_archives() {
    let sandbox = Sandbox::new();
    let library = sandbox.library();
    let original: Value = serde_json::from_str(&score_json()).unwrap();
    // Seed valid native folders directly to test the boundary without an
    // O(n^2) sequence of repeated whole-library scans during setup.
    let template = library.save(save(original.to_string())).unwrap();
    let payload = fs::read(
        sandbox
            .area("songs")
            .join(&template.key)
            .join("source.payload"),
    )
    .unwrap();
    for area in ["songs", "backups"] {
        fs::remove_dir_all(sandbox.area(area).join(&template.key)).unwrap();
    }
    for i in 0..worldmusichub_desktop::native_library::MAX_ENTRIES {
        use sha2::{Digest, Sha256};
        let mut value = original.clone();
        value["id"] = json!(format!("authored-capacity-{i}"));
        let raw = value.to_string();
        let score: score_core::Score = serde_json::from_str(&raw).unwrap();
        let mut entry = template.clone();
        entry.content_sha256 = format!("{:x}", Sha256::digest(serde_json::to_vec(&score).unwrap()));
        entry.key = format!("song-{}", entry.content_sha256);
        entry.score_id = score.id;
        entry.score_sha256 = format!("{:x}", Sha256::digest(raw.as_bytes()));
        entry.score_bytes = raw.len();
        for area in ["songs", "backups"] {
            let folder = sandbox.area(area).join(&entry.key);
            fs::create_dir(&folder).unwrap();
            fs::write(folder.join("score.json"), &raw).unwrap();
            fs::write(folder.join("source.payload"), &payload).unwrap();
            fs::write(
                folder.join("metadata.json"),
                serde_json::to_vec(&entry).unwrap(),
            )
            .unwrap();
        }
    }
    let error = library.save(save(original.to_string())).unwrap_err();
    assert_eq!(error.code, "library_capacity");
    assert_eq!(error.status, 413);
    assert_eq!(
        library.list().unwrap().entries.len(),
        worldmusichub_desktop::native_library::MAX_ENTRIES
    );
    assert_eq!(
        fs::read_dir(sandbox.area("backups")).unwrap().count(),
        worldmusichub_desktop::native_library::MAX_ENTRIES
    );
    assert_eq!(fs::read_dir(sandbox.area(".staging")).unwrap().count(), 0);
}

#[cfg(unix)]
#[test]
fn symlinks_and_dangling_links_are_neither_followed_nor_overwritten() {
    use std::os::unix::fs::symlink;
    let sandbox = Sandbox::new();
    let library = sandbox.library();
    let entry = library.save(save(score_json())).unwrap();
    let folder = sandbox.area("songs").join(&entry.key);
    fs::remove_dir_all(&folder).unwrap();
    let outside = sandbox.0.join("outside");
    fs::create_dir(&outside).unwrap();
    fs::write(outside.join("sentinel"), b"unchanged").unwrap();
    symlink(&outside, &folder).unwrap();
    assert_eq!(
        library.load(&entry.key).unwrap_err().code,
        "library_unsafe_path"
    );
    assert!(library.list().unwrap().entries.is_empty());
    assert_eq!(
        library.save(save(score_json())).unwrap_err().code,
        "library_path_conflict"
    );
    fs::remove_file(&folder).unwrap();
    symlink(sandbox.0.join("missing"), &folder).unwrap();
    assert!(library.list().unwrap().entries.is_empty());
    assert_eq!(
        library.save(save(score_json())).unwrap_err().code,
        "library_path_conflict"
    );
    assert!(fs::symlink_metadata(&folder)
        .unwrap()
        .file_type()
        .is_symlink());
    assert_eq!(fs::read(outside.join("sentinel")).unwrap(), b"unchanged");
    assert!(NativeLibrary::open(&folder).is_err());
}
