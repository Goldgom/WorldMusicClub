//! Native contract tests use only original generated material and owned roots.
#[path = "catalog_product_pack_tests.rs"]
mod user_packs;
use super::*;
use crate::{native_library::SaveRequest, song_pack};
use std::{
    io::{Cursor, Write},
    path::{Path, PathBuf},
    process::Command,
    sync::atomic::{AtomicU64, Ordering},
};
static NEXT: AtomicU64 = AtomicU64::new(0);
thread_local! { static NATIVE_CALLS:std::cell::RefCell<Vec<Value>>=const { std::cell::RefCell::new(Vec::new()) }; }
struct Fixture {
    base: PathBuf,
    root: PathBuf,
}
impl Fixture {
    fn new() -> Self {
        let base = std::env::temp_dir().join(format!(
            "wmc-ORIGINAL-product-{}-{}-{}",
            std::process::id(),
            now().unwrap(),
            NEXT.fetch_add(1, Ordering::Relaxed)
        ));
        fs::create_dir(&base).unwrap();
        fs::write(
            base.join("outside-sentinel"),
            b"ORIGINAL catalog outside sentinel",
        )
        .unwrap();
        let root = base.join("library");
        Self { base, root }
    }
    fn library(&self) -> NativeLibrary {
        NativeLibrary::open(&self.root).unwrap()
    }
    fn check(&self) {
        assert_eq!(
            fs::read(self.base.join("outside-sentinel")).unwrap(),
            b"ORIGINAL catalog outside sentinel"
        )
    }
    fn restart(&self, mode: &str, generation: u64, trash: u64) {
        let result = Command::new(std::env::current_exe().unwrap())
            .args([
                "--exact",
                "native_library::catalog_product::tests::original_restart_probe",
                "--nocapture",
            ])
            .env("WMC_PRODUCT_ORIGINAL_ROOT", &self.root)
            .env("WMC_PRODUCT_MODE", mode)
            .env("WMC_PRODUCT_GENERATION", generation.to_string())
            .env("WMC_PRODUCT_TRASH", trash.to_string())
            .output()
            .unwrap();
        assert!(
            result.status.success(),
            "{}\n{}",
            String::from_utf8_lossy(&result.stdout),
            String::from_utf8_lossy(&result.stderr)
        );
        self.check()
    }
}
impl Drop for Fixture {
    fn drop(&mut self) {
        self.check();
        fs::remove_dir_all(&self.base).unwrap()
    }
}
fn score(id: &str) -> Vec<u8> {
    let (mut s, _) = score_core::import_jianpu("1=C4\nmeter=4/4\n1 2 3 0 |").unwrap();
    s.id = id.into();
    s.title = format!("Original {id}");
    serde_json::to_vec(&s).unwrap()
}
fn zip(files: Vec<(&str, Vec<u8>)>) -> Vec<u8> {
    let mut out = zip::ZipWriter::new(Cursor::new(vec![]));
    for (name, bytes) in files {
        out.start_file(
            name,
            zip::write::SimpleFileOptions::default()
                .compression_method(zip::CompressionMethod::Stored),
        )
        .unwrap();
        out.write_all(&bytes).unwrap();
    }
    out.finish().unwrap().into_inner()
}
fn call(library: &NativeLibrary, path: &str, body: Value) -> (u16, Value) {
    let request = http::Request::builder()
        .method(if path.ends_with("/status") {
            "GET"
        } else {
            "POST"
        })
        .uri(format!("{}{path}", crate::ORIGIN))
        .header("content-type", "application/json")
        .body(if path.ends_with("/status") {
            vec![]
        } else {
            serde_json::to_vec(&body).unwrap()
        })
        .unwrap();
    let response = crate::dispatch_with_library(request, library);
    let value: Value = serde_json::from_slice(response.body()).unwrap();
    NATIVE_CALLS.with(|calls|calls.borrow_mut().push(json!({"method":if path.ends_with("/status"){"GET"}else{"POST"},"path":path,"request":if path.ends_with("/status"){Value::Null}else{body},"status":response.status().as_u16(),"response":value})));
    (response.status().as_u16(), value)
}
fn ok(library: &NativeLibrary, suffix: &str, body: Value) -> Value {
    let (status, value) = call(library, &format!("/api/library/catalog/{suffix}"), body);
    assert_eq!(status, 200, "{value}");
    assert_eq!(value["format"], FORMAT);
    value
}
fn init(library: &NativeLibrary) -> (Value, Value) {
    let before = ok(library, "status", json!({}));
    assert_eq!(before["state"], "uninitialized");
    let preview = ok(library, "initialize/preview", json!({}));
    let response = ok(
        library,
        "initialize",
        json!({"library_id":preview["library_id"],"preview":preview["preview"]}),
    );
    (preview, response)
}
fn list(library: &NativeLibrary, view: &str) -> Value {
    ok(
        library,
        "query",
        json!({"view":view,"refresh":true,"limit":100}),
    )
}
fn plan(library: &NativeLibrary, action: &str, ids: Vec<Value>, trash: Value) -> Value {
    let status = ok(library, "status", json!({}));
    ok(
        library,
        "preview",
        json!({"library_id":status["library_id"],"action":action,"edition_ids":ids,"trash_operation_id":trash,"expected_generation":status["generation"],"catalog_digest":status["catalog_digest"]}),
    )
}
fn commit_body(preview: &Value) -> Value {
    json!({"library_id":preview["library_id"],"preview":preview["preview"]})
}
fn files(path: &Path) -> BTreeMap<PathBuf, String> {
    fn visit(base: &Path, p: &Path, out: &mut BTreeMap<PathBuf, String>) {
        for item in fs::read_dir(p).unwrap() {
            let p = item.unwrap().path();
            if p.is_dir() {
                visit(base, &p, out)
            } else {
                out.insert(
                    p.strip_prefix(base).unwrap().to_path_buf(),
                    digest(&fs::read(p).unwrap()),
                );
            }
        }
    }
    let mut out = BTreeMap::new();
    visit(path, path, &mut out);
    out.retain(|p, _| {
        !p.components()
            .next()
            .unwrap()
            .as_os_str()
            .to_string_lossy()
            .contains("catalog")
            && p != Path::new(".library.lock")
    });
    out
}
fn assert_originals(root: &Path, before: &BTreeMap<PathBuf, String>) {
    for (p, hash) in before {
        assert_eq!(
            &digest(&fs::read(root.join(p)).unwrap()),
            hash,
            "original changed {p:?}"
        );
    }
}
fn clean_pack() -> Vec<u8> {
    let midi =
        b"MThd\0\0\0\x06\0\0\0\x01\0\x60MTrk\0\0\0\x0c\0\x90\x3c\x40\x60\x80\x3c\0\0\xff\x2f\0";
    let complete = score_core::clean_performance::convert_midi(
        midi,
        "original-catalog-clean",
        "Original catalog clean",
    )
    .unwrap();
    let bytes = score_core::clean_performance::encode_json(&complete).unwrap();
    let wave = b"RIFF\x10\x00\x00\x00WAVEfmt data\0\0\0\0";
    let rights = json!({"status":"original_authored","attribution":"Original catalog product test","license":"CC0-1.0"});
    let metadata = json!({"format":"worldmusichub-song","version":2,"id":complete.id,"title":complete.title,"score":{"path":"score.json","bytes":bytes.len(),"sha256":digest(&bytes)},"sources":[complete.source],"rights":rights,"media":[{"id":"original-stem","role":"stem","path":"media/stem.wav","mime":"audio/wav","bytes":wave.len(),"sha256":digest(wave),"rights":rights,"parts":["midi-t1-c1"],"offset_ms":0}]});
    zip(vec![
        ("metadata.json", serde_json::to_vec(&metadata).unwrap()),
        ("score.json", bytes),
        ("media/stem.wav", wave.to_vec()),
    ])
}
#[test]
fn original_restart_probe() {
    let Some(root) = std::env::var_os("WMC_PRODUCT_ORIGINAL_ROOT") else {
        return;
    };
    let root = PathBuf::from(root);
    assert!(root
        .parent()
        .unwrap()
        .file_name()
        .unwrap()
        .to_string_lossy()
        .starts_with("wmc-ORIGINAL-product-"));
    assert_eq!(
        fs::read(root.parent().unwrap().join("outside-sentinel")).unwrap(),
        b"ORIGINAL catalog outside sentinel"
    );
    let library = NativeLibrary::open(root.clone()).unwrap();
    let mode = std::env::var("WMC_PRODUCT_MODE").unwrap();
    if mode == "locked" {
        let body: Value = serde_json::from_slice(
            &fs::read(root.parent().unwrap().join("owned-request.json")).unwrap(),
        )
        .unwrap();
        let (code, response) = call(&library, "/api/library/catalog/commit", body);
        assert_eq!(code, 503);
        assert_eq!(response["outcome"], "uncertain");
        return;
    }
    if mode == "restore" {
        let body: Value = serde_json::from_slice(
            &fs::read(root.parent().unwrap().join("owned-request.json")).unwrap(),
        )
        .unwrap();
        ok(&library, "commit", body);
    }
    let status = ok(&library, "status", json!({}));
    assert_eq!(
        status["generation"].as_u64().unwrap(),
        std::env::var("WMC_PRODUCT_GENERATION")
            .unwrap()
            .parse::<u64>()
            .unwrap()
    );
    assert_eq!(
        status["counts"]["trashed_songs"].as_u64().unwrap(),
        std::env::var("WMC_PRODUCT_TRASH")
            .unwrap()
            .parse::<u64>()
            .unwrap()
    );
}
#[test]
fn mixed_shared_legacy_clean_trash_restore_restart_and_retained_media() {
    let f = Fixture::new();
    let library = f.library();
    let a = score("a");
    let b = score("b");
    let pack = zip(vec![("a.json", a.clone()), ("b.json", b)]);
    song_pack::import(&library, "first.zip", &pack, true, false, None).unwrap();
    let second = zip(vec![
        ("same-a.json", a),
        ("source.txt", b"Original inert note".to_vec()),
    ]);
    song_pack::import(&library, "second.zip", &second, true, false, None).unwrap();
    let clean = clean_pack();
    let clean_report = song_pack::import(&library, "clean.zip", &clean, true, false, None).unwrap();
    let before = files(&f.root);
    let (init_preview, initialized) = init(&library);
    assert_eq!(initialized["counts"]["managed_songs"], 3);
    assert_eq!(initialized["counts"]["memberships"], 4);
    let active = list(&library, "active");
    let ids: Vec<_> = active["rows"]
        .as_array()
        .unwrap()
        .iter()
        .filter(|row| row["score_id"] == "a" || row["storage_kind"] == "clean")
        .map(|r| r["edition_id"].clone())
        .collect();
    assert_eq!(ids.len(), 2);
    let clean_entry = clean_report.items[0].entry.as_ref().unwrap();
    let admitted = library.load(&clean_entry.key).unwrap();
    let asset = admitted.clean_package.unwrap().media.remove(0);
    let media_before =
        super::super::clean_package::asset(&library, &clean_entry.key, &asset.handle).unwrap();
    let preview = plan(&library, "trash_songs", ids.clone(), Value::Null);
    assert_eq!(preview["summary"]["selected_count"], 2);
    assert_eq!(preview["summary"]["shared_song_count"], 1);
    assert_eq!(preview["summary"]["removed_membership_count"], 3);
    let request = commit_body(&preview);
    ok(&library, "commit", request.clone());
    f.restart("check", 1, 2);
    assert_eq!(library.list().unwrap().entries.len(), 1);
    assert_eq!(library.physical_inventory().unwrap().entries.len(), 3);
    assert_eq!(
        library.load(&clean_entry.key).unwrap_err().code,
        "catalog_in_trash"
    );
    assert_eq!(
        super::super::clean_package::asset(&library, &clean_entry.key, &asset.handle).unwrap(),
        media_before
    );
    let reimport =
        song_pack::import(&library, "first-reimport.zip", &pack, true, false, None).unwrap();
    assert_eq!(reimport.summary["duplicate"], 2);
    assert_eq!(library.physical_inventory().unwrap().entries.len(), 3);
    assert_eq!(list(&library, "trash")["total"], 2);
    assert_eq!(list(&library, "active")["total"], 1);
    let v1 = call(
        &library,
        "/api/library/manage/query",
        json!({"view":"songs","refresh":true}),
    )
    .1;
    assert_eq!(v1["total"], 1);
    let replay = ok(&library, "commit", request);
    assert_eq!(replay["replayed"], true);
    let lookup = ok(
        &library,
        "operation",
        json!({"library_id":preview["library_id"],"operation_id":preview["preview"]["request"]["operation_id"]}),
    );
    assert_eq!(lookup["outcome"], "committed");
    assert_eq!(lookup["receipt"]["preview"], preview["preview"]);
    let restore = plan(
        &library,
        "restore_songs",
        ids,
        preview["preview"]["request"]["operation_id"].clone(),
    );
    fs::write(
        f.base.join("owned-request.json"),
        serde_json::to_vec(&commit_body(&restore)).unwrap(),
    )
    .unwrap();
    f.restart("restore", 2, 0);
    assert_eq!(library.list().unwrap().entries.len(), 3);
    assert_eq!(list(&library, "active")["counts"]["memberships"], 4);
    assert_originals(&f.root, &before);
    let init_retry = ok(&library, "initialize", commit_body(&init_preview));
    assert_eq!(init_retry["generation"], 2);
    assert_eq!(init_retry["replayed"], true);
    f.check();
    // Reconcile the exact child-committed restore through a same-ID replay, and
    // capture its unchanged native result for the renderer adapter fixture.
    let restore_commit = ok(&library, "commit", commit_body(&restore));
    let restored_trash = list(&library, "trash");
    song_pack::import(
        &library,
        "new-sync.json",
        &score("fixture-new-sync"),
        true,
        false,
        None,
    )
    .unwrap();
    let pending_sync = list(&library, "active");
    let sync_status = ok(&library, "status", json!({}));
    let sync_preview = ok(
        &library,
        "sync/preview",
        json!({"library_id":sync_status["library_id"],"expected_generation":sync_status["generation"],"catalog_digest":sync_status["catalog_digest"]}),
    );
    let sync_commit = ok(&library, "commit", commit_body(&sync_preview));
    let synced_active = list(&library, "active");
    if let Some(path) = std::env::var_os("WMC_CATALOG_PRODUCT_CONTRACT_OUT") {
        let fixture = json!({"initial_status":initialized,"initialization":init_preview,"active":active,"trash_preview":preview,"trash_operation":lookup,"restore_preview":restore,"final_active":list(&library,"active"),"restore_commit":restore_commit,"restored_trash":restored_trash,"pending_sync":pending_sync,"sync_preview":sync_preview,"sync_commit":sync_commit,"synced_active":synced_active,"native_calls":NATIVE_CALLS.with(|calls|calls.borrow().clone())});
        fs::write(path, serde_json::to_vec_pretty(&fixture).unwrap()).unwrap();
    }
}
#[test]
fn exact_selection_stale_preview_same_id_conflict_and_cursor_binding() {
    let f = Fixture::new();
    let library = f.library();
    for id in ["a", "b", "c"] {
        library
            .save(SaveRequest {
                score_json: String::from_utf8(score(id)).unwrap(),
                label: None,
                allow_conflicting_id: false,
            })
            .unwrap();
    }
    init(&library);
    let rows = list(&library, "active");
    let ids: Vec<_> = rows["rows"]
        .as_array()
        .unwrap()
        .iter()
        .map(|r| r["edition_id"].clone())
        .collect();
    let page = ok(
        &library,
        "query",
        json!({"view":"active","limit":1,"refresh":true}),
    );
    assert!(page["next_cursor"].is_string());
    let bad = call(
        &library,
        "/api/library/catalog/query",
        json!({"view":"trash","limit":1,"cursor":page["next_cursor"]}),
    );
    assert_eq!(bad.0, 400);
    let a = plan(&library, "trash_songs", vec![ids[0].clone()], Value::Null);
    let b = plan(&library, "trash_songs", vec![ids[1].clone()], Value::Null);
    let mut changed = commit_body(&a);
    changed["preview"]["request"]["action"]["song_ids"] = json!([ids[2]]);
    let rejected = call(&library, "/api/library/catalog/commit", changed.clone());
    assert_eq!(rejected.1["outcome"], "not_committed");
    assert_eq!(library.list().unwrap().entries.len(), 3);
    ok(&library, "commit", commit_body(&a));
    let stale = call(&library, "/api/library/catalog/commit", commit_body(&b));
    assert_eq!(stale.1["code"], "catalog_stale");
    assert_eq!(stale.1["outcome"], "not_committed");
    assert_eq!(
        call(&library, "/api/library/catalog/commit", changed).1["code"],
        "catalog_conflict"
    );
    assert_eq!(
        call(
            &library,
            "/api/library/catalog/query",
            json!({"view":"active","limit":1,"cursor":page["next_cursor"]})
        )
        .1["code"],
        "catalog_stale"
    );
    let unknown = ok(
        &library,
        "operation",
        json!({"library_id":b["library_id"],"operation_id":b["preview"]["request"]["operation_id"]}),
    );
    assert_eq!(unknown["outcome"], "not_committed");
}
#[test]
fn explicit_sync_adopts_new_import_then_trash_without_restoring_old_edges() {
    let f = Fixture::new();
    let library = f.library();
    let original = zip(vec![("a.json", score("a"))]);
    song_pack::import(&library, "original.zip", &original, true, false, None).unwrap();
    init(&library);
    let old = list(&library, "active")["rows"][0]["edition_id"].clone();
    let trash = plan(&library, "trash_songs", vec![old], Value::Null);
    ok(&library, "commit", commit_body(&trash));
    let next = zip(vec![("a.json", score("a")), ("new.json", score("new"))]);
    song_pack::import(&library, "new.zip", &next, true, false, None).unwrap();
    let active = list(&library, "active");
    assert_eq!(active["rows"][0]["catalog_managed"], false);
    let state = ok(&library, "status", json!({}));
    let sync = ok(
        &library,
        "sync/preview",
        json!({"library_id":state["library_id"],"expected_generation":state["generation"],"catalog_digest":state["catalog_digest"]}),
    );
    assert_eq!(sync["summary"]["changed_song_count"], 1);
    assert_eq!(
        sync["preview"]["effects"]["adopted_songs"]
            .as_array()
            .unwrap()
            .len(),
        1
    );
    let before = files(&f.root);
    ok(&library, "commit", commit_body(&sync));
    assert_eq!(list(&library, "trash")["total"], 1);
    let active = list(&library, "active");
    assert_eq!(active["rows"][0]["catalog_managed"], true);
    assert_eq!(active["rows"][0]["pack_count"], 1);
    let p = plan(
        &library,
        "trash_songs",
        vec![active["rows"][0]["edition_id"].clone()],
        Value::Null,
    );
    ok(&library, "commit", commit_body(&p));
    f.restart("check", 3, 2);
    assert_originals(&f.root, &before);
}
#[test]
fn initialization_marked_retry_corruption_and_cross_process_uncertain() {
    let f = Fixture::new();
    let library = f.library();
    library
        .save(SaveRequest {
            score_json: String::from_utf8(score("a")).unwrap(),
            label: None,
            allow_conflicting_id: false,
        })
        .unwrap();
    let (preview, _) = init(&library);
    for area in ["catalog", "catalog-backups"] {
        let commits = f.root.join(area).join("commits");
        let entry = fs::read_dir(&commits)
            .unwrap()
            .next()
            .unwrap()
            .unwrap()
            .path();
        fs::rename(entry, f.base.join(format!("preserved-{area}-genesis"))).unwrap();
    }
    assert_eq!(
        call(&library, "/api/library/catalog/status", json!({})).1["code"],
        "catalog_recovery_required"
    );
    ok(&library, "initialize", commit_body(&preview));
    f.restart("check", 0, 0);
    let row = list(&library, "active")["rows"][0]["edition_id"].clone();
    let p = plan(&library, "trash_songs", vec![row], Value::Null);
    fs::write(
        f.base.join("owned-request.json"),
        serde_json::to_vec(&commit_body(&p)).unwrap(),
    )
    .unwrap();
    {
        let _lock = library.lock().unwrap();
        f.restart("locked", 0, 0);
    }
    assert_eq!(
        ok(
            &library,
            "operation",
            json!({"library_id":p["library_id"],"operation_id":p["preview"]["request"]["operation_id"]})
        )["outcome"],
        "not_committed"
    );
    let original = files(&f.root);
    fs::write(
        f.root.join("catalog/format.json"),
        b"ORIGINAL deliberate corrupt marker",
    )
    .unwrap();
    let bad = call(&library, "/api/library/catalog/commit", commit_body(&p));
    assert_eq!(bad.1["outcome"], "uncertain");
    assert_eq!(bad.1["code"], "catalog_recovery_required");
    assert!(library.list().is_err());
    assert_originals(&f.root, &original);
}

#[test]
fn source_only_and_backup_only_sources_stay_unresolved_without_invented_edges() {
    let f = Fixture::new();
    let library = f.library();
    let raw = b"ORIGINAL intentionally invalid midi".to_vec();
    let metadata = json!({"format":"private-complete-midi-source-folder","version":1,"title":"Original source only","source_files":[{"path":"source/original.mid","bytes":raw.len(),"sha256":digest(&raw)}],"imports":{"canonical_score":null,"canonical_error":"No notation"}});
    let archive = zip(vec![
        (
            "source-only/metadata.json",
            serde_json::to_vec(&metadata).unwrap(),
        ),
        ("source-only/source/original.mid", raw),
    ]);
    let only = song_pack::import(&library, "source-only.zip", &archive, true, false, None).unwrap();
    assert_eq!(only.summary["retained_nonplayable"], 1);
    let report = song_pack::import(
        &library,
        "backup-only.json",
        &score("unresolved"),
        true,
        false,
        None,
    )
    .unwrap();
    fs::rename(
        f.root.join("imports").join(&report.source.archive_key),
        f.base.join("preserved-original-primary"),
    )
    .unwrap();
    let before = files(&f.root);
    let (_, initialized) = init(&library);
    assert_eq!(initialized["counts"]["managed_songs"], 1);
    assert_eq!(initialized["counts"]["packs"], 2);
    assert_eq!(initialized["counts"]["memberships"], 0);
    let rows = list(&library, "active");
    assert_eq!(rows["rows"][0]["pack_count"], 0);
    let issues = call(
        &library,
        "/api/library/manage/query",
        json!({"view":"issues","refresh":true}),
    );
    assert_eq!(issues.0, 200);
    assert!(issues.1["rows"]
        .as_array()
        .unwrap()
        .iter()
        .any(|i| i["code"] == "pack_backup_only"));
    assert!(issues.1["rows"]
        .as_array()
        .unwrap()
        .iter()
        .any(|i| i["archive_key"] == only.source.archive_key));
    assert_originals(&f.root, &before);
}

#[test]
fn inert_standalone_upload_labels_round_trip_exactly_through_initialization() {
    let f = Fixture::new();
    let library = f.library();
    let label = "../../C:\\originals: label.json";
    let report =
        song_pack::import(&library, label, &score("inert-label"), true, false, None).unwrap();
    let (_, initialized) = init(&library);
    assert_eq!(initialized["counts"]["memberships"], 1);
    let loaded = journal::load(&library).unwrap().unwrap();
    let origin = &loaded.catalog.snapshot().inventory.origins[0];
    assert_eq!(origin.item_path, label);
    assert_eq!(origin.item_kind, catalog::OriginItemKind::InertLabel);
    assert_eq!(origin.source.as_str(), report.source.archive_key);
    let row = list(&library, "active")["rows"][0]["edition_id"].clone();
    let p = plan(&library, "trash_songs", vec![row], Value::Null);
    ok(&library, "commit", commit_body(&p));
    f.restart("check", 1, 1);
}

#[test]
fn full_length_import_labels_are_preserved_as_imported_pack_names() {
    let f = Fixture::new();
    let library = f.library();
    let label = format!("{}.json", "原".repeat(339));
    assert!(label.len() > 1000 && label.len() <= 1024);
    song_pack::import(&library, &label, &score("long-label"), true, false, None).unwrap();
    init(&library);
    let rows = list(&library, "active");
    assert_eq!(rows["rows"][0]["packs"][0]["name"], label);
    let catalog = journal::load(&library).unwrap().unwrap().catalog;
    assert_eq!(catalog.snapshot().inventory.origins[0].item_path, label);
}

#[test]
fn present_corrupt_original_copies_block_initialization_and_frozen_commit() {
    let f = Fixture::new();
    let library = f.library();
    let report = song_pack::import(
        &library,
        "original.json",
        &score("source-verified"),
        true,
        false,
        None,
    )
    .unwrap();
    let backup = f
        .root
        .join("import-backups")
        .join(&report.source.archive_key)
        .join("source.bin");
    let original = fs::read(&backup).unwrap();
    fs::write(&backup, b"ORIGINAL deliberately damaged backup").unwrap();
    let rejected = call(
        &library,
        "/api/library/catalog/initialize/preview",
        json!({}),
    );
    assert_eq!(rejected.1["code"], "catalog_recovery_required");
    assert!(!f.root.join("catalog").exists());
    let issues = call(
        &library,
        "/api/library/manage/query",
        json!({"view":"issues","refresh":true}),
    );
    assert_eq!(issues.0, 200);
    assert!(issues.1["rows"]
        .as_array()
        .unwrap()
        .iter()
        .any(|r| r["code"] == "pack_backup_invalid"));
    fs::write(&backup, &original).unwrap();
    init(&library);
    let selected = list(&library, "active")["rows"][0]["edition_id"].clone();
    let preview = plan(&library, "trash_songs", vec![selected], Value::Null);
    fs::write(&backup, b"ORIGINAL deliberately damaged backup").unwrap();
    let failed = call(
        &library,
        "/api/library/catalog/commit",
        commit_body(&preview),
    );
    assert_eq!(failed.1["code"], "catalog_recovery_required");
    assert_eq!(failed.1["outcome"], "not_committed");
    assert_eq!(ok(&library, "status", json!({}))["generation"], 0);
    assert_eq!(
        fs::read(&backup).unwrap(),
        b"ORIGINAL deliberately damaged backup"
    );
    fs::write(&backup, original).unwrap();
    ok(&library, "commit", commit_body(&preview));
    f.restart("check", 1, 1);
}

#[test]
fn large_imports_sync_in_explicit_bounded_batches_before_bulk_trash() {
    let f = Fixture::new();
    let library = f.library();
    init(&library);
    let names: Vec<_> = (0..40).map(|n| format!("original-{n}.json")).collect();
    let archive = zip(names
        .iter()
        .enumerate()
        .map(|(n, name)| (name.as_str(), score(&format!("batch-{n}"))))
        .collect());
    song_pack::import(&library, "original-batch.zip", &archive, true, false, None).unwrap();
    let mut sizes = Vec::new();
    for expected_remaining in [8, 0] {
        let state = ok(&library, "status", json!({}));
        let preview = ok(
            &library,
            "sync/preview",
            json!({"library_id":state["library_id"],"expected_generation":state["generation"],"catalog_digest":state["catalog_digest"]}),
        );
        sizes.push(preview["summary"]["changed_song_count"].as_u64().unwrap());
        assert_eq!(
            preview["summary"]["remaining_song_count"],
            expected_remaining
        );
        ok(&library, "commit", commit_body(&preview));
    }
    assert_eq!(sizes, [32, 8]);
    let active = list(&library, "active");
    assert_eq!(active["total"], 40);
    assert!(active["rows"]
        .as_array()
        .unwrap()
        .iter()
        .all(|r| r["catalog_managed"] == true));
    let ids = active["rows"]
        .as_array()
        .unwrap()
        .iter()
        .map(|r| r["edition_id"].clone())
        .collect();
    let preview = plan(&library, "trash_songs", ids, Value::Null);
    assert_eq!(preview["summary"]["changed_song_count"], 40);
    ok(&library, "commit", commit_body(&preview));
    f.restart("check", 3, 40);
}

#[test]
fn source_batches_preserve_all_shared_edges_before_admitting_dependent_songs() {
    let f = Fixture::new();
    let library = f.library();
    init(&library);
    let names: Vec<_> = (0..30).map(|n| format!("shared-{n}.json")).collect();
    let authored: Vec<_> = (0..30)
        .map(|n| score(&format!("many-sources-{n}")))
        .collect();
    for pack in 0..40 {
        let mut members: Vec<_> = names
            .iter()
            .zip(&authored)
            .map(|(name, bytes)| (name.as_str(), bytes.clone()))
            .collect();
        members.push((
            "source-only.txt",
            format!("ORIGINAL unique source {pack}").into_bytes(),
        ));
        let archive = zip(members);
        song_pack::import(
            &library,
            &format!("original-{pack}.zip"),
            &archive,
            true,
            false,
            None,
        )
        .unwrap();
    }
    for (songs, sources, remaining_songs, remaining_sources) in
        [(0, 32, 30, 8), (25, 8, 5, 0), (5, 0, 0, 0)]
    {
        let status = ok(&library, "status", json!({}));
        let preview = ok(
            &library,
            "sync/preview",
            json!({"library_id":status["library_id"],"expected_generation":status["generation"],"catalog_digest":status["catalog_digest"]}),
        );
        assert_eq!(preview["summary"]["changed_song_count"], songs);
        assert_eq!(
            preview["preview"]["effects"]
                .get("adopted_sources")
                .and_then(Value::as_array)
                .map_or(0, Vec::len),
            sources
        );
        assert_eq!(preview["summary"]["remaining_song_count"], remaining_songs);
        assert_eq!(
            preview["summary"]["remaining_source_count"],
            remaining_sources
        );
        ok(&library, "commit", commit_body(&preview));
    }
    let active = list(&library, "active");
    assert_eq!(active["total"], 30);
    assert_eq!(active["counts"]["memberships"], 1200);
    assert!(active["rows"]
        .as_array()
        .unwrap()
        .iter()
        .all(|row| row["pack_count"] == 40));
    let row = active["rows"][0]["edition_id"].clone();
    let preview = plan(&library, "trash_songs", vec![row], Value::Null);
    assert_eq!(preview["summary"]["removed_membership_count"], 40);
    ok(&library, "commit", commit_body(&preview));
    f.restart("check", 4, 1);
}

#[test]
fn public_save_rejects_trashed_duplicate_until_explicit_restore() {
    let f = Fixture::new();
    let library = f.library();
    let original = score("original-manual-save-trash");
    let request = || SaveRequest {
        score_json: String::from_utf8(original.clone()).unwrap(),
        label: None,
        allow_conflicting_id: false,
    };
    let entry = library.save(request()).unwrap();
    init(&library);
    let edition = json!(pack_groups::edition_id(&entry));
    let trash = plan(&library, "trash_songs", vec![edition.clone()], Value::Null);
    ok(&library, "commit", commit_body(&trash));
    let before = files(&f.root);
    let error = library.save(request()).unwrap_err();
    assert_eq!(error.code, "catalog_in_trash");
    assert_eq!(error.status, 409);
    assert!(error.existing.is_none());
    assert!(library.list().unwrap().entries.is_empty());
    assert_eq!(files(&f.root), before);
    let reimport =
        song_pack::import(&library, "same-original.json", &original, true, false, None).unwrap();
    assert_eq!(reimport.summary["duplicate"], 1);
    assert_eq!(list(&library, "trash")["total"], 1);
    assert!(library.list().unwrap().entries.is_empty());
    let restore = plan(
        &library,
        "restore_songs",
        vec![edition],
        trash["preview"]["request"]["operation_id"].clone(),
    );
    ok(&library, "commit", commit_body(&restore));
    let after_restore = files(&f.root);
    let duplicate = library.save(request()).unwrap_err();
    assert_eq!(duplicate.code, "library_duplicate");
    assert_eq!(duplicate.existing.unwrap().key, entry.key);
    assert_eq!(library.list().unwrap().entries.len(), 1);
    assert_eq!(files(&f.root), after_restore);
    assert_originals(&f.root, &before);
}
