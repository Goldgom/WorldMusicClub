//! Fresh test-owned roots and newly authored exercises only. No real libraries.
use http::Request;
use serde_json::{json, Value};
use std::{
    fs,
    io::{Cursor, Write},
    path::PathBuf,
    sync::atomic::{AtomicU64, Ordering},
};
use worldmusichub_desktop::{
    dispatch, dispatch_with_library,
    native_library::{NativeLibrary, SaveRequest},
    song_pack, ORIGIN,
};
static NEXT: AtomicU64 = AtomicU64::new(0);
struct Sandbox {
    root: PathBuf,
    sentinel: PathBuf,
}
impl Sandbox {
    fn new() -> Self {
        let parent = std::env::temp_dir().join(format!(
            "wmh-pack-groups-{}-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos(),
            NEXT.fetch_add(1, Ordering::Relaxed)
        ));
        fs::create_dir(&parent).unwrap();
        let sentinel = parent.join("outside-library-sentinel");
        fs::write(&sentinel, b"owned sentinel unchanged").unwrap();
        Self {
            root: parent.join("library"),
            sentinel,
        }
    }
    fn library(&self) -> NativeLibrary {
        NativeLibrary::open(&self.root).unwrap()
    }
}
impl Drop for Sandbox {
    fn drop(&mut self) {
        assert_eq!(
            fs::read(&self.sentinel).unwrap(),
            b"owned sentinel unchanged"
        );
        fs::remove_dir_all(self.sentinel.parent().unwrap()).unwrap();
    }
}
fn score(id: &str, title: &str) -> String {
    let (mut score, _) = score_core::import_jianpu("1=C4\nmeter=4/4\n1 2 3 0 |").unwrap();
    score.id = id.into();
    score.title = title.into();
    serde_json::to_string(&score).unwrap()
}
fn archive(files: Vec<(&str, Vec<u8>)>) -> Vec<u8> {
    let mut zip = zip::ZipWriter::new(Cursor::new(Vec::new()));
    for (name, bytes) in files {
        zip.start_file(
            name,
            zip::write::SimpleFileOptions::default()
                .compression_method(zip::CompressionMethod::Stored),
        )
        .unwrap();
        zip.write_all(&bytes).unwrap();
    }
    zip.finish().unwrap().into_inner()
}
fn pack(scores: &[(&str, &str, &str)], extra: bool) -> Vec<u8> {
    let mut files: Vec<_> = scores
        .iter()
        .map(|(path, id, title)| (*path, score(id, title).into_bytes()))
        .collect();
    if extra {
        files.push((
            "original-inert-source.txt",
            b"original synthetic source evidence".to_vec(),
        ));
    }
    archive(files)
}
fn request(body: Value) -> Request<Vec<u8>> {
    Request::builder()
        .method("POST")
        .uri(format!("{ORIGIN}/api/library/manage/query"))
        .header("content-type", "application/json")
        .body(serde_json::to_vec(&body).unwrap())
        .unwrap()
}
fn query(library: &NativeLibrary, body: Value) -> Value {
    let reply = dispatch_with_library(request(body), library);
    assert_eq!(
        reply.status(),
        200,
        "{}",
        String::from_utf8_lossy(reply.body())
    );
    serde_json::from_slice(reply.body()).unwrap()
}
fn receipt_paths(sandbox: &Sandbox, key: &str, area: &str) -> Vec<PathBuf> {
    let mut paths: Vec<_> = fs::read_dir(sandbox.root.join(area).join(key))
        .unwrap()
        .map(|p| p.unwrap().path())
        .filter(|p| {
            p.file_name()
                .unwrap()
                .to_string_lossy()
                .starts_with("report-")
        })
        .collect();
    paths.sort();
    paths
}
fn rewrite_receipts(sandbox: &Sandbox, key: &str, mut edit: impl FnMut(&mut Value)) {
    for area in ["imports", "import-backups"] {
        for path in receipt_paths(sandbox, key, area) {
            let mut report: Value = serde_json::from_slice(&fs::read(&path).unwrap()).unwrap();
            edit(&mut report);
            fs::write(path, serde_json::to_vec(&report).unwrap()).unwrap();
        }
    }
}
#[test]
fn retries_union_all_successful_items_and_share_one_immutable_edition() {
    let sandbox = Sandbox::new();
    let library = sandbox.library();
    let bytes = pack(
        &[
            ("one.wmhscore.json", "one", "Original One"),
            ("two.wmhscore.json", "two", "Original Two"),
        ],
        false,
    );
    let first = song_pack::import(&library, "first.zip", &bytes, true, false, Some(0)).unwrap();
    assert_eq!(first.summary["saved"], 1);
    song_pack::import(&library, "renamed.zip", &bytes, true, false, Some(1)).unwrap();
    song_pack::import(&library, "renamed-again.zip", &bytes, true, false, None).unwrap();
    let groups = query(&library, json!({"view":"packs"}));
    assert_eq!(groups["rows"].as_array().unwrap().len(), 1);
    assert_eq!(groups["rows"][0]["name"], "first.zip");
    assert_eq!(groups["rows"][0]["receipt_count"], 3);
    assert_eq!(groups["rows"][0]["song_count"], 2);
    assert_eq!(groups["summary"]["unfiled_songs"], 0);
    assert_eq!(
        query(&library, json!({"view":"duplicates"}))["total"],
        0,
        "retry receipts do not invent duplicate songs"
    );
    let other = pack(&[("same.wmhscore.json", "one", "Original One")], true);
    song_pack::import(&library, "second.zip", &other, true, false, None).unwrap();
    let songs = query(&library, json!({"view":"songs","refresh":true}));
    assert_eq!(songs["summary"]["songs"], 2);
    assert_eq!(songs["summary"]["shared_songs"], 1);
    let one = songs["rows"]
        .as_array()
        .unwrap()
        .iter()
        .find(|row| row["score_id"] == "one")
        .unwrap();
    assert_eq!(one["pack_count"], 2);
    assert_eq!(one["source_reference_count"], 2);
    assert_eq!(one["receipt_reference_count"], 4);
    assert_eq!(one["packs"].as_array().unwrap().len(), 2);
    let dup = query(
        &library,
        json!({"view":"duplicates","duplicate_kind":"exact_content"}),
    );
    assert_eq!(dup["total"], 1);
    assert_eq!(dup["rows"][0]["edition_count"], 1);
    assert_eq!(dup["rows"][0]["evidence_type"], "shared_edition");
    let before = fs::read(
        sandbox
            .root
            .join("imports")
            .join(&first.source.archive_key)
            .join("source.bin"),
    )
    .unwrap();
    assert_eq!(before, bytes);
    assert_eq!(library.list().unwrap().entries.len(), 2);
}
#[test]
fn conflict_entries_never_link_and_same_id_title_groups_never_merge() {
    let sandbox = Sandbox::new();
    let library = sandbox.library();
    let original = library
        .save(SaveRequest {
            score_json: score("same-id", "  Original   TITLE "),
            label: None,
            allow_conflicting_id: false,
        })
        .unwrap();
    let conflicting = pack(
        &[("different.wmhscore.json", "same-id", "Different title")],
        false,
    );
    let report =
        song_pack::import(&library, "conflict.zip", &conflicting, true, false, None).unwrap();
    assert_eq!(report.items[0].status, "conflict");
    assert_eq!(report.items[0].entry.as_ref().unwrap().key, original.key);
    let packs = query(&library, json!({"view":"packs"}));
    assert_eq!(packs["rows"][0]["song_count"], 0);
    assert_eq!(packs["summary"]["unfiled_songs"], 1);
    assert!(packs["summary"]["issues"].as_u64().unwrap() > 0);
    song_pack::import(&library, "conflict.zip", &conflicting, true, true, None).unwrap();
    library
        .save(SaveRequest {
            score_json: score("another-id", "original title"),
            label: None,
            allow_conflicting_id: false,
        })
        .unwrap();
    let dup = query(&library, json!({"view":"duplicates","refresh":true}));
    assert_eq!(dup["summary"]["songs"], 3);
    let kinds: Vec<_> = dup["rows"]
        .as_array()
        .unwrap()
        .iter()
        .map(|row| row["kind"].as_str().unwrap())
        .collect();
    assert!(kinds.contains(&"same_id"));
    assert!(kinds.contains(&"same_title"));
    assert!(!kinds.contains(&"exact_content"));
    assert_eq!(
        query(&library, json!({"view":"songs","unfiled":true}))["total"],
        2
    );
}
#[test]
fn metadata_cache_is_advisory_and_authoritative_reads_still_verify() {
    let sandbox = Sandbox::new();
    let library = sandbox.library();
    let report = song_pack::import(
        &library,
        "original.zip",
        &pack(&[("one.wmhscore.json", "one", "One")], false),
        true,
        false,
        None,
    )
    .unwrap();
    let key = &report.items[0].entry.as_ref().unwrap().key;
    let cold = query(&library, json!({"view":"songs"}));
    assert_eq!(cold["freshness"]["cached"], false);
    fs::write(
        sandbox.root.join("songs").join(key).join("score.json"),
        b"corrupt owned fixture",
    )
    .unwrap();
    let another = sandbox.library();
    let warm = query(&another, json!({"view":"songs","search":"One"}));
    assert_eq!(warm["total"], 1);
    assert_eq!(warm["freshness"]["cached"], true);
    assert_eq!(warm["freshness"]["change_detection"], "explicit_refresh");
    assert!(library.load(key).is_err());
    assert!(library.list().unwrap().entries.is_empty());
    let refreshed = query(&library, json!({"view":"songs","refresh":true}));
    assert_eq!(refreshed["total"], 0);
    assert_ne!(refreshed["snapshot_id"], cold["snapshot_id"]);
    assert!(refreshed["summary"]["issues"].as_u64().unwrap() > 0);
    assert_eq!(
        fs::read(sandbox.root.join("songs").join(key).join("score.json")).unwrap(),
        b"corrupt owned fixture"
    );
}
#[test]
fn stable_pagination_filters_and_refresh_reject_stale_cursor() {
    let sandbox = Sandbox::new();
    let library = sandbox.library();
    for id in ["a", "b", "c"] {
        library
            .save(SaveRequest {
                score_json: score(id, &format!("Original {id}")),
                label: None,
                allow_conflicting_id: false,
            })
            .unwrap();
    }
    let first = query(&library, json!({"view":"songs","limit":1}));
    let cursor = first["next_cursor"].clone();
    assert!(cursor.is_string());
    let second = query(&library, json!({"view":"songs","limit":1,"cursor":cursor}));
    let third = query(
        &library,
        json!({"view":"songs","limit":1,"cursor":second["next_cursor"]}),
    );
    assert!(third["next_cursor"].is_null());
    let mut ids = vec![
        first["rows"][0]["edition_id"].clone(),
        second["rows"][0]["edition_id"].clone(),
        third["rows"][0]["edition_id"].clone(),
    ];
    ids.dedup();
    assert_eq!(ids.len(), 3);
    assert_eq!(
        dispatch_with_library(
            request(json!({"view":"songs","limit":1,"cursor":cursor,"search":"b"})),
            &library
        )
        .status(),
        400
    );
    assert_eq!(
        query(&library, json!({"view":"songs","search":"b"}))["total"],
        1
    );
    let unchanged = query(&library, json!({"view":"songs","refresh":true}));
    assert_eq!(unchanged["snapshot_id"], first["snapshot_id"]);
    drop(library);
    let library = sandbox.library();
    let reopened = query(&library, json!({"view":"songs"}));
    assert_eq!(reopened["snapshot_id"], first["snapshot_id"]);
    assert_eq!(reopened["freshness"]["cached"], false);
    library
        .save(SaveRequest {
            score_json: score("d", "Original d"),
            label: None,
            allow_conflicting_id: false,
        })
        .unwrap();
    query(&library, json!({"view":"songs","refresh":true}));
    let stale = dispatch_with_library(
        request(json!({"view":"songs","limit":1,"cursor":cursor})),
        &library,
    );
    assert_eq!(stale.status(), 409);
    assert_eq!(
        serde_json::from_slice::<Value>(stale.body()).unwrap()["code"],
        "library_snapshot_stale"
    );
}
#[test]
fn malformed_receipt_identity_path_and_unknown_version_never_infer_membership() {
    for corruption in [
        "source",
        "path",
        "entry",
        "entry_key",
        "version",
        "unknown",
        "mode",
        "diagnostic",
    ] {
        let sandbox = Sandbox::new();
        let library = sandbox.library();
        let report = song_pack::import(
            &library,
            "original.zip",
            &pack(&[("one.wmhscore.json", "one", "One")], false),
            true,
            false,
            None,
        )
        .unwrap();
        rewrite_receipts(
            &sandbox,
            &report.source.archive_key,
            |receipt| match corruption {
                "source" => receipt["source"]["sha256"] = json!("0".repeat(64)),
                "path" => receipt["items"][0]["path"] = json!("../../private"),
                "entry" => receipt["items"][0]["entry"]["title"] = json!("Forged title"),
                "entry_key" => receipt["items"][0]["entry"]["key"] = json!("../../untrusted"),
                "version" => receipt["version"] = json!(999),
                "mode" => receipt["mode"] = json!("preview"),
                "diagnostic" => receipt["items"][0]["message"] = json!("x".repeat(8193)),
                _ => receipt["unknown_catalog_identity"] = json!(true),
            },
        );
        let groups = query(&library, json!({"view":"packs"}));
        assert_eq!(groups["rows"][0]["song_count"], 0, "{corruption}");
        assert_eq!(groups["summary"]["unfiled_songs"], 1, "{corruption}");
        assert!(
            groups["summary"]["issues"].as_u64().unwrap() > 0,
            "{corruption}"
        );
    }
}
#[test]
fn disagreeing_receipts_and_backup_only_sources_are_visible_not_guessed() {
    let sandbox = Sandbox::new();
    let library = sandbox.library();
    let report = song_pack::import(
        &library,
        "original.zip",
        &pack(&[("one.wmhscore.json", "one", "One")], false),
        true,
        false,
        None,
    )
    .unwrap();
    let path = receipt_paths(&sandbox, &report.source.archive_key, "imports").remove(0);
    let mut changed: Value = serde_json::from_slice(&fs::read(&path).unwrap()).unwrap();
    changed["warnings"] = json!(["one copy changed"]);
    fs::write(&path, serde_json::to_vec(&changed).unwrap()).unwrap();
    assert_eq!(
        query(&library, json!({"view":"packs"}))["rows"][0]["song_count"],
        0
    );
    // Only fresh owned fixtures are moved, never removed or overwritten.
    fs::rename(
        sandbox
            .root
            .join("imports")
            .join(&report.source.archive_key),
        sandbox
            .sentinel
            .parent()
            .unwrap()
            .join("retained-primary-aside"),
    )
    .unwrap();
    let groups = query(&library, json!({"view":"packs","refresh":true}));
    assert_eq!(groups["rows"][0]["song_count"], 0);
    assert_eq!(groups["rows"][0]["provenance"], "unresolved");
    assert_eq!(groups["summary"]["unfiled_songs"], 1);
    let issues = query(&library, json!({"view":"issues"}));
    assert!(issues["rows"]
        .as_array()
        .unwrap()
        .iter()
        .any(|row| row["code"] == "pack_backup_only"));
}
fn source_only_archive() -> Vec<u8> {
    let source = b"original invalid midi payload".to_vec();
    use sha2::{Digest, Sha256};
    let meta = json!({"format":"private-complete-midi-source-folder","version":1,"title":"Original source only","source_files":[{"path":"source/original.mid","bytes":source.len(),"sha256":format!("{:x}",Sha256::digest(&source))}],"imports":{"canonical_score":null,"canonical_error":"No notation"}});
    archive(vec![
        ("song/metadata.json", serde_json::to_vec(&meta).unwrap()),
        ("song/source/original.mid", source),
    ])
}

#[test]
fn retained_only_and_no_receipt_archives_remain_source_details() {
    let sandbox = Sandbox::new();
    let library = sandbox.library();
    let bytes = source_only_archive();
    let report = song_pack::import(&library, "source-only.zip", &bytes, true, false, None).unwrap();
    assert_eq!(report.summary["retained_nonplayable"], 1);
    let groups = query(&library, json!({"view":"packs"}));
    assert_eq!(groups["rows"][0]["song_count"], 0);
    assert_eq!(groups["rows"][0]["retained_only_count"], 1);
    assert_eq!(groups["rows"][0]["issue_count"], 1);
    assert_eq!(groups["summary"]["issues"], 1);
    let issues = query(
        &library,
        json!({"view":"issues", "pack_id":format!("import-{}",report.source.sha256)}),
    );
    assert_eq!(issues["total"], 1);
    assert_eq!(issues["rows"][0]["archive_key"], report.source.archive_key);
    assert_eq!(issues["rows"][0]["code"], report.items[0].code);
    assert_eq!(
        issues["rows"][0]["message"],
        format!(
            "Source item {}: {}",
            report.items[0].path, report.items[0].message
        )
    );
    assert!(issues["rows"][0]["song_key"].is_null());
    assert_eq!(
        query(
            &library,
            json!({"view":"songs", "pack_id":format!("import-{}",report.source.sha256)})
        )["total"],
        0
    );
    // Repeating the unsupported source preserves only its latest diagnosis, not
    // duplicate Issues or synthetic playable rows.
    song_pack::import(&library, "source-only.zip", &bytes, true, false, None).unwrap();
    for area in ["imports", "import-backups"] {
        let first = receipt_paths(&sandbox, &report.source.archive_key, area).remove(0);
        let mut older: Value = serde_json::from_slice(&fs::read(&first).unwrap()).unwrap();
        older["items"][0]["message"] = json!("Earlier original unsupported-source diagnostic");
        fs::write(first, serde_json::to_vec(&older).unwrap()).unwrap();
    }
    let retried = query(&library, json!({"view":"issues","refresh":true}));
    assert_eq!(retried["total"], 1);
    assert_eq!(retried["rows"][0]["message"], issues["rows"][0]["message"]);
    assert_eq!(retried["summary"]["songs"], 0);

    for area in ["imports", "import-backups"] {
        for (i, path) in receipt_paths(&sandbox, &report.source.archive_key, area)
            .into_iter()
            .enumerate()
        {
            fs::rename(
                path,
                sandbox
                    .sentinel
                    .parent()
                    .unwrap()
                    .join(format!("receipt-{area}-{i}-aside")),
            )
            .unwrap();
        }
    }
    let groups = query(&library, json!({"view":"packs","refresh":true}));
    assert_eq!(groups["rows"][0]["provenance"], "unresolved");
    assert_eq!(groups["summary"]["songs"], 0);
}
#[test]
fn native_query_admission_is_strict_bounded_and_explicitly_capable() {
    let sandbox = Sandbox::new();
    let library = sandbox.library();
    assert_eq!(dispatch(request(json!({"view":"packs"}))).status(), 503);
    for body in [
        json!({"view":"trash"}),
        json!({"view":"packs","directory":"/private"}),
        json!({"view":"songs","pack_id":"../foo"}),
        json!({"view":"songs","limit":101}),
        json!({"view":"packs","search":"x".repeat(257)}),
        json!({"view":"songs","refresh":true,"cursor":"bad"}),
    ] {
        assert_eq!(dispatch_with_library(request(body), &library).status(), 400);
    }
    let oversized = dispatch_with_library(
        request(json!({"view":"packs","search":"x".repeat(4096)})),
        &library,
    );
    assert_eq!(oversized.status(), 413);
    let mut wrong_origin = request(json!({"view":"packs"}));
    wrong_origin
        .headers_mut()
        .insert("origin", "https://untrusted.invalid".parse().unwrap());
    assert_eq!(dispatch_with_library(wrong_origin, &library).status(), 403);
    let get = Request::builder()
        .uri(format!("{ORIGIN}/api/library/manage/query"))
        .body(vec![])
        .unwrap();
    assert_eq!(dispatch_with_library(get, &library).status(), 405);
    let health = dispatch(
        Request::builder()
            .uri(format!("{ORIGIN}/api/health"))
            .body(vec![])
            .unwrap(),
    );
    assert_eq!(
        serde_json::from_slice::<Value>(health.body()).unwrap()["library_management_query_version"],
        1
    );
    assert!(song_pack::is_large_operation("/api/library/manage/query"));
    assert_eq!(song_pack::request_limit("/api/library/manage/query"), 4096);
}
#[test]
fn corrupt_source_preserves_song_as_unfiled_and_receipt_copies_are_not_modified() {
    let sandbox = Sandbox::new();
    let library = sandbox.library();
    let report = song_pack::import(
        &library,
        "original.zip",
        &pack(&[("one.wmhscore.json", "one", "One")], false),
        true,
        false,
        None,
    )
    .unwrap();
    let backup = sandbox
        .root
        .join("import-backups")
        .join(&report.source.archive_key)
        .join("source.bin");
    let before = fs::read(&backup).unwrap();
    fs::write(
        sandbox
            .root
            .join("imports")
            .join(&report.source.archive_key)
            .join("source.bin"),
        b"corrupt source",
    )
    .unwrap();
    let groups = query(&library, json!({"view":"songs"}));
    assert_eq!(groups["summary"]["unfiled_songs"], 1);
    assert_eq!(groups["summary"]["packs"], 0);
    assert_eq!(fs::read(backup).unwrap(), before);
    assert_eq!(library.list().unwrap().entries.len(), 1);
}

#[test]
fn clean_noncanonical_editions_link_by_storage_identity_without_touching_assets() {
    use sha2::{Digest, Sha256};
    let hash = |bytes: &[u8]| format!("{:x}", Sha256::digest(bytes));
    let sandbox = Sandbox::new();
    let library = sandbox.library();
    let midi =
        b"MThd\0\0\0\x06\0\0\0\x01\0\x60MTrk\0\0\0\x0c\0\x90\x3c\x40\x60\x80\x3c\0\0\xff\x2f\0";
    let complete = score_core::clean_performance::convert_midi(
        midi,
        "original-group-performance",
        "Original group performance",
    )
    .unwrap();
    let bytes = score_core::clean_performance::encode_json(&complete).unwrap();
    let wave = b"RIFF\x10\x00\x00\x00WAVEfmt data\0\0\0\0";
    let rights = json!({"status":"original_authored","attribution":"Original pack query test","license":"CC0-1.0"});
    let metadata = json!({"format":"worldmusichub-song","version":2,"id":complete.id,"title":complete.title,"score":{"path":"score.json","bytes":bytes.len(),"sha256":hash(&bytes)},"sources":[complete.source],"rights":rights,"media":[{"id":"original-stem","role":"stem","path":"media/stem.wav","mime":"audio/wav","bytes":wave.len(),"sha256":hash(wave),"rights":rights,"parts":["midi-t1-c1"],"offset_ms":0}]});
    let zip = archive(vec![
        ("metadata.json", serde_json::to_vec(&metadata).unwrap()),
        ("score.json", bytes),
        ("media/stem.wav", wave.to_vec()),
    ]);
    let report =
        song_pack::import(&library, "clean-original.zip", &zip, true, false, None).unwrap();
    assert_eq!(report.items[0].status, "saved");
    assert!(!report.items[0].playable);
    let key = &report.items[0].entry.as_ref().unwrap().key;
    let asset = sandbox
        .root
        .join("clean-songs")
        .join(key)
        .join("package/media/stem.wav");
    let backup = sandbox
        .root
        .join("clean-backups")
        .join(key)
        .join("package/media/stem.wav");
    let before = (fs::read(&asset).unwrap(), fs::read(&backup).unwrap());
    let songs = query(&library, json!({"view":"songs"}));
    assert_eq!(songs["rows"][0]["storage_kind"], "clean");
    assert_eq!(songs["rows"][0]["pack_count"], 1);
    assert!(songs["rows"][0]["edition_id"]
        .as_str()
        .unwrap()
        .starts_with("clean:song-"));
    assert_eq!(
        (fs::read(&asset).unwrap(), fs::read(&backup).unwrap()),
        before
    );
    // Warm metadata does not open the media. Authoritative load still does.
    fs::write(&asset, b"corrupt owned asset").unwrap();
    assert_eq!(query(&library, json!({"view":"songs"}))["total"], 1);
    assert!(library.load(key).is_err());
    assert_eq!(
        query(&library, json!({"view":"songs","refresh":true}))["total"],
        0
    );
    assert_eq!(fs::read(backup).unwrap(), wave);
    assert!(!sandbox.root.join("catalog").exists());
}
#[test]
fn query_read_bounds_fail_closed_and_invalidate_a_previous_snapshot() {
    let sandbox = Sandbox::new();
    let library = sandbox.library();
    let report = song_pack::import(
        &library,
        "original.zip",
        &pack(&[("one.wmhscore.json", "one", "One")], false),
        true,
        false,
        None,
    )
    .unwrap();
    assert_eq!(
        query(&library, json!({"view":"packs"}))["rows"][0]["song_count"],
        1
    );
    let path = receipt_paths(&sandbox, &report.source.archive_key, "imports").remove(0);
    fs::OpenOptions::new()
        .write(true)
        .open(path)
        .unwrap()
        .set_len(32 * 1024 * 1024 + 1)
        .unwrap();
    for body in [
        json!({"view":"packs","refresh":true}),
        json!({"view":"packs"}),
    ] {
        let reply = dispatch_with_library(request(body), &library);
        assert_eq!(reply.status(), 413);
        assert_eq!(
            serde_json::from_slice::<Value>(reply.body()).unwrap()["code"],
            "library_query_limit"
        );
    }
}
#[cfg(unix)]
#[test]
fn linked_receipt_is_rejected_without_following_it() {
    let sandbox = Sandbox::new();
    let library = sandbox.library();
    let report = song_pack::import(
        &library,
        "original.zip",
        &pack(&[("one.wmhscore.json", "one", "One")], false),
        true,
        false,
        None,
    )
    .unwrap();
    let path = receipt_paths(&sandbox, &report.source.archive_key, "imports").remove(0);
    fs::rename(
        &path,
        sandbox.sentinel.parent().unwrap().join("receipt-aside"),
    )
    .unwrap();
    std::os::unix::fs::symlink(&sandbox.sentinel, &path).unwrap();
    let groups = query(&library, json!({"view":"packs"}));
    assert_eq!(groups["rows"][0]["song_count"], 0);
    let issues = query(&library, json!({"view":"issues"}));
    assert!(issues["rows"]
        .as_array()
        .unwrap()
        .iter()
        .any(|row| row["code"] == "pack_receipt_invalid"));
}

#[test]
fn source_item_repetitions_and_backup_only_receipts_have_explicit_evidence() {
    let sandbox = Sandbox::new();
    let library = sandbox.library();
    let bytes = pack(
        &[
            ("one.wmhscore.json", "one", "One"),
            ("another.wmhscore.json", "one", "One"),
        ],
        false,
    );
    let report =
        song_pack::import(&library, "repeated-item.zip", &bytes, true, false, None).unwrap();
    let first = receipt_paths(&sandbox, &report.source.archive_key, "imports").remove(0);
    fs::rename(
        first,
        sandbox
            .sentinel
            .parent()
            .unwrap()
            .join("primary-receipt-aside"),
    )
    .unwrap();
    let duplicates = query(&library, json!({"view":"duplicates"}));
    assert_eq!(
        duplicates["rows"][0]["evidence_type"],
        "repeated_source_item"
    );
    assert_eq!(duplicates["rows"][0]["edition_count"], 1);
    assert_eq!(duplicates["rows"][0]["reference_count"], 2);
    assert_eq!(duplicates["summary"]["songs"], 1);
    assert_eq!(duplicates["summary"]["memberships"], 1);
    let issues = query(&library, json!({"view":"issues"}));
    assert!(issues["rows"]
        .as_array()
        .unwrap()
        .iter()
        .any(|row| row["code"] == "pack_receipt_single_copy"));
}

#[test]
fn query_contract_samples_preserve_native_identity_and_pack_issue_filter() {
    let sandbox = Sandbox::new();
    let library = sandbox.library();
    let first = song_pack::import(
        &library,
        "Original pack A.zip",
        &pack(
            &[(
                "one.wmhscore.json",
                "original-contract-one",
                "Original <inert> song",
            )],
            false,
        ),
        true,
        false,
        None,
    )
    .unwrap();
    song_pack::import(
        &library,
        "Original pack B.zip",
        &pack(
            &[(
                "same.wmhscore.json",
                "original-contract-one",
                "Original <inert> song",
            )],
            true,
        ),
        true,
        false,
        None,
    )
    .unwrap();
    let conflict = song_pack::import(
        &library,
        "Original conflict.zip",
        &pack(
            &[(
                "different.wmhscore.json",
                "original-contract-one",
                "Different original edition",
            )],
            false,
        ),
        true,
        false,
        None,
    )
    .unwrap();
    let pack_id = format!("import-{}", conflict.source.sha256);
    let filtered = query(&library, json!({"view":"issues","pack_id":pack_id}));
    assert_eq!(filtered["total"], 1);
    assert_eq!(
        filtered["rows"][0]["archive_key"],
        conflict.source.archive_key
    );
    assert_eq!(
        query(
            &library,
            json!({"view":"issues","pack_id":format!("import-{}",first.source.sha256)})
        )["total"],
        0
    );
    let mut samples = serde_json::Map::new();
    for view in ["packs", "songs", "duplicates", "issues"] {
        let response = query(&library, json!({"view":view}));
        assert!(response["total"].as_u64().unwrap() > 0);
        samples.insert(view.into(), response);
    }
    // Explicit developer-only opt-in emits original-fixture response examples for
    // cross-language contract checks. It never reads the application's real root.
    if let Some(path) = std::env::var_os("WMC_PACK_GROUP_CONTRACT_OUT") {
        fs::write(
            path,
            serde_json::to_vec_pretty(&Value::Object(samples)).unwrap(),
        )
        .unwrap();
    }
}

#[test]
fn query_recovery_contract_samples_keep_unresolved_sources_visible() {
    let sandbox = Sandbox::new();
    let library = sandbox.library();
    for (name, path, extra) in [
        ("Original playable A.zip", "one.wmhscore.json", false),
        ("Original playable B.zip", "same.wmhscore.json", true),
    ] {
        song_pack::import(
            &library,
            name,
            &pack(
                &[(path, "original-recovery-one", "Original recovery song")],
                extra,
            ),
            true,
            false,
            None,
        )
        .unwrap();
    }
    let unsupported = song_pack::import(
        &library,
        "Original unsupported source.zip",
        &source_only_archive(),
        true,
        false,
        None,
    )
    .unwrap();
    let unresolved = song_pack::import(
        &library,
        "Original unresolved source.zip",
        &pack(
            &[(
                "unresolved.wmhscore.json",
                "original-unresolved",
                "Original unresolved song",
            )],
            false,
        ),
        true,
        false,
        None,
    )
    .unwrap();
    for area in ["imports", "import-backups"] {
        for (index, path) in receipt_paths(&sandbox, &unresolved.source.archive_key, area)
            .into_iter()
            .enumerate()
        {
            fs::rename(
                path,
                sandbox
                    .sentinel
                    .parent()
                    .unwrap()
                    .join(format!("unresolved-{area}-{index}-aside")),
            )
            .unwrap();
        }
    }
    let groups = query(&library, json!({"view":"packs"}));
    assert_eq!(groups["total"], 4);
    let rows = groups["rows"].as_array().unwrap();
    let unsupported_row = rows
        .iter()
        .find(|row| row["archive_key"] == unsupported.source.archive_key)
        .unwrap();
    assert_eq!(unsupported_row["song_count"], 0);
    assert_eq!(unsupported_row["retained_only_count"], 1);
    assert_eq!(unsupported_row["issue_count"], 1);
    let unresolved_row = rows
        .iter()
        .find(|row| row["archive_key"] == unresolved.source.archive_key)
        .unwrap();
    assert_eq!(unresolved_row["provenance"], "unresolved");
    assert_eq!(unresolved_row["song_count"], 0);
    assert_eq!(unresolved_row["issue_count"], 1);
    let unsupported_issues = query(
        &library,
        json!({"view":"issues","pack_id":unsupported_row["pack_id"]}),
    );
    assert_eq!(
        unsupported_issues["rows"][0]["code"],
        unsupported.items[0].code
    );
    assert_eq!(
        unsupported_issues["rows"][0]["message"],
        format!(
            "Source item {}: {}",
            unsupported.items[0].path, unsupported.items[0].message
        )
    );
    let unresolved_issues = query(
        &library,
        json!({"view":"issues","pack_id":unresolved_row["pack_id"]}),
    );
    assert_eq!(unresolved_issues["total"], 1);
    assert_eq!(unresolved_issues["rows"][0]["code"], "pack_report_pending");
    let mut samples = serde_json::Map::new();
    for view in ["packs", "songs", "duplicates", "issues"] {
        let response = query(&library, json!({"view":view}));
        assert!(response["total"].as_u64().unwrap() > 0);
        samples.insert(view.into(), response);
    }
    samples.insert(
        "unsupported_songs".into(),
        query(
            &library,
            json!({"view":"songs","pack_id":unsupported_row["pack_id"]}),
        ),
    );
    samples.insert(
        "unresolved_songs".into(),
        query(
            &library,
            json!({"view":"songs","pack_id":unresolved_row["pack_id"]}),
        ),
    );
    samples.insert("unsupported_issues".into(), unsupported_issues);
    samples.insert("unresolved_issues".into(), unresolved_issues);
    if let Some(path) = std::env::var_os("WMC_PACK_GROUP_RECOVERY_CONTRACT_OUT") {
        fs::write(
            path,
            serde_json::to_vec_pretty(&Value::Object(samples)).unwrap(),
        )
        .unwrap();
    }
}

#[path = "../../../tests/support/vsq_authoring.rs"]
mod original_vsq_fixture;

fn original_backup() -> Vec<u8> {
    serde_json::to_vec(&json!({"format":"worldmusichub-library-backup","version":1,"entries":[
        {"score":serde_json::from_str::<Value>(&score("backup-original-one","Original backup one")).unwrap(),"label":"Original one"},
        {"score":serde_json::from_str::<Value>(&score("backup-original-two","Original backup two")).unwrap(),"label":"Original two"}
    ]})).unwrap()
}
#[test]
fn importer_query_compatibility_matrix_preserves_real_input_identities_and_renames() {
    // Existing checked-in fixtures below are original authored public exercises;
    // all generated/imported archives and libraries are test-owned temporary data.
    let canonical = score("original-matrix-score", "Original matrix score").into_bytes();
    let midi = include_bytes!("../../../tests/fixtures/midi-original-ppq.mid").to_vec();
    let xml = include_bytes!("../../../tests/fixtures/original-duet.musicxml").to_vec();
    let mxl = include_bytes!("../../../tests/fixtures/original-duet.mxl").to_vec();
    let mxl_inner = {
        let archive = zip::ZipArchive::new(Cursor::new(&mxl)).unwrap();
        let name = archive
            .file_names()
            .find(|name| name.ends_with(".xml") && *name != "META-INF/container.xml")
            .unwrap_or("score.musicxml")
            .to_owned();
        name
    };
    let native_backup = serde_json::to_vec(&json!({"format":"worldmusichub-native-score-backup","version":1,"entry":{"label":"Original native backup"},"score_json":String::from_utf8(canonical.clone()).unwrap()})).unwrap();
    let clean = archive(vec![
        (
            "metadata.json",
            include_bytes!("../../../tests/fixtures/clean-song-v2/metadata.json").to_vec(),
        ),
        (
            "score.json",
            include_bytes!("../../../tests/fixtures/clean-song-v2/score.json").to_vec(),
        ),
    ]);
    let clean_vsq = archive(vec![
        (
            "metadata.json",
            include_bytes!("../../../tests/fixtures/vsq-clean-v1/metadata.json").to_vec(),
        ),
        (
            "score.json",
            include_bytes!("../../../tests/fixtures/vsq-clean-v1/score.json").to_vec(),
        ),
    ]);
    let clean_basic = archive(vec![
        (
            "metadata.json",
            include_bytes!("../../../tests/fixtures/basic-key-acceptance/metadata.json").to_vec(),
        ),
        (
            "score.json",
            include_bytes!("../../../tests/fixtures/basic-key-acceptance/score.json").to_vec(),
        ),
    ]);
    let unified = archive(vec![
        ("manifest.json",serde_json::to_vec(&json!({"format":"worldmusichub-song-pack","version":1,"songs":[{"folder":"songs/原始 练习"}]})).unwrap()),
        ("songs/原始 练习/metadata.json",serde_json::to_vec(&json!({"format":"worldmusichub-song","version":1,"title":"Original","score":"score.json","sources":[],"media":{}})).unwrap()),
        ("songs/原始 练习/score.json",canonical.clone()),
    ]);
    let cases: Vec<(&str, String, String, Vec<u8>, usize)> = vec![
        (
            "canonical",
            "My Song.wmhscore.json".into(),
            "练习 renamed.wmhscore.json".into(),
            canonical.clone(),
            1,
        ),
        (
            "standalone-display-label",
            "../display only.json".into(),
            "C:\\display-only.json".into(),
            canonical.clone(),
            1,
        ),
        (
            "midi",
            "练习.mid".into(),
            "Original renamed.mid".into(),
            midi,
            1,
        ),
        (
            "xml",
            "Original Music.musicxml".into(),
            "练习.xml".into(),
            xml,
            1,
        ),
        ("mxl", mxl_inner, "练习 renamed.mxl".into(), mxl, 1),
        (
            "jianpu",
            "原创 简谱.jianpu".into(),
            "Original renamed.jianpu".into(),
            b"1=C4\nmeter=4/4\n1 3 5 0 |".to_vec(),
            1,
        ),
        (
            "library-backup",
            "My Backup.json".into(),
            "原始备份.json".into(),
            original_backup(),
            2,
        ),
        (
            "native-backup",
            "Native backup.json".into(),
            "原始 native.json".into(),
            native_backup,
            1,
        ),
        (
            "ordinary-zip",
            "原始.zip".into(),
            "renamed.zip".into(),
            archive(vec![(
                "songs/练习/My Song.wmhscore.json",
                canonical.clone(),
            )]),
            1,
        ),
        (
            "deep-zip",
            "Deep.zip".into(),
            "Deep renamed.zip".into(),
            archive(vec![("a/b/c/d/e/f/g/h/i/j/练习.wmhscore.json", canonical)]),
            1,
        ),
        (
            "zip-backup",
            "Backup pack.zip".into(),
            "Backup renamed.zip".into(),
            archive(vec![("原始 备份/backup.json", original_backup())]),
            2,
        ),
        (
            "unified-v1",
            "Unified.zip".into(),
            "Unified renamed.zip".into(),
            unified,
            1,
        ),
        (
            "clean-v2",
            "Clean v2.zip".into(),
            "原始 clean.zip".into(),
            clean,
            1,
        ),
        (
            "clean-vsq",
            "VSQ clean.zip".into(),
            "VSQ 原始.zip".into(),
            clean_vsq,
            1,
        ),
        (
            "clean-basic",
            "Basic keys.zip".into(),
            "Basic renamed.zip".into(),
            clean_basic,
            1,
        ),
        (
            "raw-vsq-source-only",
            "Original.vsq".into(),
            "原始 renamed.vsq".into(),
            original_vsq_fixture::source(),
            0,
        ),
        (
            "unknown-zip-source-only",
            "Only originals.zip".into(),
            "原始 only.zip".into(),
            archive(vec![(
                "原始/source.txt",
                b"Original inert source text".to_vec(),
            )]),
            0,
        ),
    ];
    for (family, filename, renamed, bytes, expected) in cases {
        let sandbox = Sandbox::new();
        let library = sandbox.library();
        let first = song_pack::import(&library, &filename, &bytes, true, false, None).unwrap();
        assert_eq!(
            first.summary["saved"], expected,
            "producer {family}: {:?}",
            first.items
        );
        let second = song_pack::import(&library, &renamed, &bytes, true, false, None).unwrap();
        assert_eq!(second.source.archive_key, first.source.archive_key);
        let groups = query(&library, json!({"view":"packs"}));
        assert_eq!(groups["total"], 1, "{family}");
        assert_eq!(
            groups["rows"][0]["song_count"], expected,
            "{family}: {groups}"
        );
        assert_eq!(groups["rows"][0]["receipt_count"], 2, "{family}");
        assert_eq!(groups["rows"][0]["name"], filename, "{family}");
        assert_eq!(groups["summary"]["unfiled_songs"], 0, "{family}");
        if expected > 0 {
            assert_eq!(groups["rows"][0]["issue_count"], 0, "{family}: {groups}");
            let songs = query(&library, json!({"view":"songs"}));
            for row in songs["rows"].as_array().unwrap() {
                assert_eq!(row["pack_count"], 1, "{family}");
                assert_eq!(
                    row["source_reference_count"], 1,
                    "same-byte rename inflated {family}"
                );
                assert_eq!(row["receipt_reference_count"], 2, "{family}");
            }
            assert_eq!(
                query(
                    &library,
                    json!({"view":"duplicates","duplicate_kind":"exact_content"})
                )["total"],
                0,
                "same-byte rename fabricated duplicate {family}"
            );
        } else {
            assert_eq!(groups["rows"][0]["retained_only_count"], 1, "{family}");
            let issues = query(&library, json!({"view":"issues"}));
            assert_eq!(issues["total"], 1, "{family}");
            assert_eq!(issues["rows"][0]["code"], second.items[0].code, "{family}");
            assert!(
                issues["rows"][0]["message"]
                    .as_str()
                    .unwrap()
                    .contains(&second.items[0].message),
                "{family}"
            );
        }
    }
}

#[test]
fn forged_virtual_or_outer_paths_cannot_borrow_verified_song_membership() {
    for (filename, bytes, path) in [
        ("backup.json", original_backup(), "backup.json"),
        (
            "backup.zip",
            archive(vec![("backup.json", original_backup())]),
            "backup.json",
        ),
        ("backup.json", original_backup(), "backup.json#entries/999"),
        ("backup.json", original_backup(), "backup.json#entries/00"),
        (
            "backup.zip",
            archive(vec![("backup.json", original_backup())]),
            "other.json#entries/0",
        ),
        (
            "regular.zip",
            pack(
                &[("one.wmhscore.json", "original-forgery", "Original")],
                false,
            ),
            "regular.zip",
        ),
        (
            "regular.zip",
            pack(
                &[("one.wmhscore.json", "original-forgery", "Original")],
                false,
            ),
            "../one.wmhscore.json",
        ),
        (
            "single.json",
            score("original-forgery", "Original").into_bytes(),
            "not-the-upload.json",
        ),
    ] {
        let sandbox = Sandbox::new();
        let library = sandbox.library();
        let report = song_pack::import(&library, filename, &bytes, true, false, None).unwrap();
        rewrite_receipts(&sandbox, &report.source.archive_key, |receipt| {
            receipt["items"].as_array_mut().unwrap().truncate(1);
            receipt["items"][0]["path"] = json!(path)
        });
        let groups = query(&library, json!({"view":"packs"}));
        assert_eq!(groups["rows"][0]["song_count"], 0, "{path}");
        assert_eq!(groups["rows"][0]["provenance"], "unresolved", "{path}");
        assert!(groups["summary"]["issues"].as_u64().unwrap() > 0, "{path}");
    }
}

#[test]
fn latest_failed_reimport_diagnostics_do_not_erase_previously_proved_membership() {
    for status in [
        "error",
        "conflict",
        "retained_nonplayable",
        "ready",
        "duplicate",
    ] {
        let sandbox = Sandbox::new();
        let library = sandbox.library();
        let bytes = pack(
            &[(
                "original.wmhscore.json",
                "original-reimport",
                "Original reimport",
            )],
            false,
        );
        let saved = song_pack::import(&library, "original.zip", &bytes, true, false, None).unwrap();
        song_pack::import(&library, "original.zip", &bytes, true, false, None).unwrap();
        for area in ["imports", "import-backups"] {
            let latest = receipt_paths(&sandbox, &saved.source.archive_key, area)
                .pop()
                .unwrap();
            let mut receipt: Value = serde_json::from_slice(&fs::read(&latest).unwrap()).unwrap();
            receipt["items"][0]["status"] = json!(status);
            receipt["items"][0]["code"] = json!("original_latest_diagnostic");
            receipt["items"][0]["message"] =
                json!("Original latest converter diagnostic retained verbatim");
            fs::write(latest, serde_json::to_vec(&receipt).unwrap()).unwrap();
        }
        let groups = query(&library, json!({"view":"packs"}));
        assert_eq!(groups["rows"][0]["song_count"], 1, "{status}");
        assert_eq!(groups["summary"]["unfiled_songs"], 0, "{status}");
        let issues = query(
            &library,
            json!({"view":"issues","pack_id":groups["rows"][0]["pack_id"]}),
        );
        if matches!(status, "error" | "conflict" | "retained_nonplayable") {
            assert_eq!(issues["total"], 1, "{status}");
            assert_eq!(issues["rows"][0]["code"], "original_latest_diagnostic");
            assert!(issues["rows"][0]["message"]
                .as_str()
                .unwrap()
                .contains("Original latest converter diagnostic retained verbatim"));
            assert!(issues["rows"][0]["message"]
                .as_str()
                .unwrap()
                .contains("original.wmhscore.json"));
        } else {
            assert_eq!(issues["total"], 0, "{status}");
        }
    }
}
