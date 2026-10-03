//! Original synthetic fixtures only. No private melodies, titles or source bytes.
use http::Request;
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::{
    fs,
    io::{Cursor, Write},
    path::PathBuf,
    sync::atomic::{AtomicU64, Ordering},
};
use worldmusichub_desktop::{
    dispatch_with_library,
    native_library::{NativeLibrary, SaveRequest},
    song_pack, ORIGIN,
};
static NEXT: AtomicU64 = AtomicU64::new(0);
struct Sandbox(PathBuf);
impl Sandbox {
    fn new() -> Self {
        let p = std::env::temp_dir().join(format!(
            "wmh-song-pack-{}-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos(),
            NEXT.fetch_add(1, Ordering::Relaxed)
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
fn score(id: &str) -> String {
    let (mut s, _) = score_core::import_jianpu("1=C4\nmeter=4/4\n1 2 3 0 |").unwrap();
    s.id = id.into();
    s.title = format!("Original {id}");
    format!("\n{}\n", serde_json::to_string_pretty(&s).unwrap())
}
fn zip(files: Vec<(&str, Vec<u8>)>) -> Vec<u8> {
    let mut z = zip::ZipWriter::new(Cursor::new(Vec::new()));
    for (name, bytes) in files {
        z.start_file(
            name,
            zip::write::SimpleFileOptions::default()
                .compression_method(zip::CompressionMethod::Stored),
        )
        .unwrap();
        z.write_all(&bytes).unwrap();
    }
    z.finish().unwrap().into_inner()
}
fn request(library: &NativeLibrary, path: &str, body: Vec<u8>) -> http::Response<Vec<u8>> {
    dispatch_with_library(
        Request::builder()
            .method(if path == "/api/library/imports" {
                "GET"
            } else {
                "POST"
            })
            .uri(format!("{ORIGIN}{path}"))
            .header("x-wmh-filename", "original.zip")
            .body(body)
            .unwrap(),
        library,
    )
}
fn unified(raw: &str) -> Vec<u8> {
    zip(vec![("manifest.json",serde_json::to_vec(&json!({"format":"worldmusichub-song-pack","version":1,"songs":[{"folder":"songs/one"}]})).unwrap()),("songs/one/metadata.json",serde_json::to_vec(&json!({"format":"worldmusichub-song","version":1,"title":"Original","score":"score.json","sources":[],"media":{"cover":"cover.bin","pv":"clip.bin"}})).unwrap()),("songs/one/score.json",raw.as_bytes().to_vec()),("songs/one/cover.bin",vec![1,2,3]),("songs/one/clip.bin",vec![4,5,6])])
}
#[test]
fn unified_preview_commit_restart_export_preserves_all_bytes() {
    let sandbox = Sandbox::new();
    let library = sandbox.library();
    let raw = score("one");
    let bytes = unified(&raw);
    let preview = song_pack::import(&library, "曲包.zip", &bytes, false, false, None).unwrap();
    assert_eq!(preview.summary["ready"], 1);
    assert!(!preview.source.retained);
    assert!(library.list().unwrap().entries.is_empty());
    assert!(!sandbox.0.join("Scores/imports").exists());
    let report = song_pack::import(&library, "曲包.zip", &bytes, true, false, None).unwrap();
    assert_eq!(report.summary["saved"], 1);
    assert!(report.source.retained);
    assert_eq!(report.inventory.files.len(), 5);
    let entry = report.items[0].entry.as_ref().unwrap();
    assert_eq!(library.load(&entry.key).unwrap().score_json, raw);
    drop(library);
    let library = sandbox.library();
    let history: Value =
        serde_json::from_slice(request(&library, "/api/library/imports", vec![]).body()).unwrap();
    assert_eq!(history["imports"][0]["report"]["summary"]["saved"], 1);
    for area in ["imports", "import-backups"] {
        assert_eq!(
            fs::read(
                sandbox
                    .0
                    .join("Scores")
                    .join(area)
                    .join(&report.source.archive_key)
                    .join("source.bin")
            )
            .unwrap(),
            bytes
        );
    }
    let exported = request(
        &library,
        "/api/library/import/export",
        serde_json::to_vec(&json!({"archive_key":report.source.archive_key})).unwrap(),
    );
    assert_eq!(exported.status(), 200);
    assert_eq!(exported.body(), &bytes);
    let again = song_pack::import(&library, "renamed.zip", &bytes, true, false, None).unwrap();
    assert_eq!(again.summary["duplicate"], 1);
    assert_eq!(library.list().unwrap().entries.len(), 1);
}
#[test]
fn legacy_normalized_folder_handles_canonical_and_source_only_together() {
    let sandbox = Sandbox::new();
    let library = sandbox.library();
    let raw = score("legacy");
    let source = b"original inert malformed MIDI".to_vec();
    let hash = format!("{:x}", Sha256::digest(&source));
    let meta = |playable: bool| {
        serde_json::to_vec(&json!({"format":"private-complete-midi-source-folder","version":1,"title":"Original legacy source","source_files":[{"path":"source/original.mid","bytes":source.len(),"sha256":hash}],"imports":{"canonical_score":if playable {Some("score.wmhscore.json")}else{None},"canonical_error":"Unsupported raw-event source retained without score fabrication"}})).unwrap()
    };
    let bytes = zip(vec![
        ("wrapper/songs/one/metadata.json", meta(true)),
        ("wrapper/songs/one/score.wmhscore.json", raw.into_bytes()),
        ("wrapper/songs/one/source/original.mid", source.clone()),
        ("wrapper/songs/two/metadata.json", meta(false)),
        ("wrapper/songs/two/source/original.mid", source),
        (
            "wrapper/songs/two/complete-events.json",
            br#"{"events":[]}"#.to_vec(),
        ),
    ]);
    let report = song_pack::import(&library, "legacy.zip", &bytes, true, false, None).unwrap();
    assert_eq!(report.summary["saved"], 1);
    assert_eq!(report.summary["retained_nonplayable"], 1);
    assert!(!report.items[1].playable);
    assert!(report.items[1].entry.is_none());
    assert_eq!(library.list().unwrap().entries.len(), 1);
    assert!(report.items[1]
        .message
        .contains("Current retained MIDI recheck:"));
    assert!(report.items[1]
        .message
        .contains("Unsupported raw-event source retained"));
}

fn authored_midi() -> Vec<u8> {
    // An original one-note fixture, 96 ticks per quarter, with explicit note-off.
    b"MThd\0\0\0\x06\0\0\0\x01\0\x60MTrk\0\0\0\x0c\0\x90\x3c\x40\x60\x80\x3c\0\0\xff\x2f\0".to_vec()
}
fn legacy_metadata(source: &[u8]) -> Value {
    json!({"format":"private-complete-midi-source-folder","version":1,"title":"Original retained MIDI","source_files":[{"path":"source/original.mid","bytes":source.len(),"sha256":format!("{:x}",Sha256::digest(source))}],"imports":{"raw_midi":"source/original.mid","canonical_score":null,"canonical_error":"Earlier importer could not admit this original","complete_events":"complete-events.json"}})
}
fn legacy_pack(metadata: &Value, source: &[u8], extra: Vec<(&str, Vec<u8>)>) -> Vec<u8> {
    let mut files = vec![
        ("song/metadata.json", serde_json::to_vec(metadata).unwrap()),
        ("song/source/original.mid", source.to_vec()),
        (
            "song/complete-events.json",
            br#"{"events":[],"never":"canonical"}"#.to_vec(),
        ),
    ];
    files.extend(extra);
    zip(files)
}
#[test]
fn legacy_retained_midi_recheck_is_explicit_exact_deduplicated_and_append_only() {
    let sandbox = Sandbox::new();
    let library = sandbox.library();
    let source = authored_midi();
    let bytes = legacy_pack(&legacy_metadata(&source), &source, vec![]);
    let preview = song_pack::import(&library, "legacy.zip", &bytes, false, false, None).unwrap();
    assert_eq!(preview.summary["ready"], 1);
    assert_eq!(preview.items[0].title, "Original retained MIDI");
    assert!(!preview.source.retained);
    assert!(!sandbox.0.join("Scores/imports").exists());
    let provenance = preview.items[0].derivation.as_ref().unwrap();
    assert_eq!(provenance.code, "pack_retained_midi_recheck");
    assert_eq!(provenance.path, "song/source/original.mid");
    assert_eq!(provenance.bytes, source.len() as u64);
    assert_eq!(provenance.sha256, format!("{:x}", Sha256::digest(&source)));
    let report = song_pack::import(&library, "legacy.zip", &bytes, true, false, None).unwrap();
    assert_eq!(report.summary["saved"], 1);
    let entry = report.items[0].entry.as_ref().unwrap();
    let loaded = library.load(&entry.key).unwrap();
    assert_eq!(entry.label, "Original retained MIDI");
    assert_eq!(report.items[0].title, entry.label);
    let (expected, _) = score_core::import_midi(&source).unwrap();
    assert_eq!(loaded.score_json, serde_json::to_string(&expected).unwrap());
    let mut before = Vec::new();
    for area in ["imports", "import-backups"] {
        let folder = sandbox
            .0
            .join("Scores")
            .join(area)
            .join(&report.source.archive_key);
        for entry in fs::read_dir(folder).unwrap() {
            let path = entry.unwrap().path();
            before.push((path.clone(), fs::read(path).unwrap()));
        }
    }
    let repeat = song_pack::import(&library, "legacy.zip", &bytes, true, false, None).unwrap();
    assert_eq!(repeat.summary["duplicate"], 1);
    assert!(repeat.items[0].derivation.is_some());
    assert_eq!(repeat.items[0].entry.as_ref().unwrap().label, entry.label);
    assert_eq!(repeat.items[0].title, entry.label);
    assert_eq!(library.list().unwrap().entries.len(), 1);
    for (path, original) in before {
        assert_eq!(fs::read(path).unwrap(), original);
    }
    // The direct source and the container-derived canonical use the same ID,
    // diagnostics, source payload and bytes, with no separate duplicate edition.
    let standalone =
        song_pack::import(&library, "original.mid", &source, true, false, None).unwrap();
    assert_eq!(standalone.summary["duplicate"], 1);
    assert!(standalone.items[0].derivation.is_none());
    assert_eq!(
        standalone.items[0].entry.as_ref().unwrap().label,
        entry.label
    );
    drop(library);
    let library = sandbox.library();
    let history: Value =
        serde_json::from_slice(request(&library, "/api/library/imports", vec![]).body()).unwrap();
    let receipt = history["imports"]
        .as_array()
        .unwrap()
        .iter()
        .find(|item| item["archive_key"] == report.source.archive_key)
        .unwrap();
    assert_eq!(
        receipt["report"]["items"][0]["derivation"]["code"],
        "pack_retained_midi_recheck"
    );
    assert_eq!(receipt["report"]["items"][0]["title"], entry.label);
    let exported = request(
        &library,
        "/api/library/import/export",
        serde_json::to_vec(&json!({"archive_key":report.source.archive_key})).unwrap(),
    );
    assert_eq!(exported.body(), &bytes);
    assert_eq!(
        library.load(&entry.key).unwrap().score_json,
        loaded.score_json
    );
    assert_eq!(library.load(&entry.key).unwrap().entry.label, entry.label);
}
#[test]
fn derived_midi_caption_uses_valid_title_only_without_explicit_label_and_never_relabels_duplicates()
{
    let source = authored_midi();
    let (canonical, _) = score_core::import_midi(&source).unwrap();
    for (title, label, expected) in [
        (
            "Declared song".to_owned(),
            Value::Null,
            "Declared song".to_owned(),
        ),
        (
            "Declared song".to_owned(),
            json!("Explicit edition"),
            "Explicit edition".to_owned(),
        ),
        ("  ".to_owned(), Value::Null, canonical.title.clone()),
        ("x".repeat(1025), Value::Null, canonical.title.clone()),
    ] {
        let sandbox = Sandbox::new();
        let library = sandbox.library();
        let mut metadata = legacy_metadata(&source);
        metadata["title"] = json!(title);
        metadata["label"] = label;
        let bytes = legacy_pack(&metadata, &source, vec![]);
        let preview =
            song_pack::import(&library, "legacy.zip", &bytes, false, false, None).unwrap();
        assert_eq!(preview.items[0].title, expected);
        let report = song_pack::import(&library, "legacy.zip", &bytes, true, false, None).unwrap();
        assert_eq!(report.summary["saved"], 1);
        let entry = report.items[0].entry.as_ref().unwrap();
        assert_eq!(entry.label, expected);
        assert_eq!(report.items[0].title, entry.label);
        assert_eq!(entry.title, canonical.title);
        assert_eq!(
            library.load(&entry.key).unwrap().score_json,
            serde_json::to_string(&canonical).unwrap()
        );
    }
    let sandbox = Sandbox::new();
    let library = sandbox.library();
    let existing = library
        .save(SaveRequest {
            score_json: serde_json::to_string(&canonical).unwrap(),
            label: Some("Previously chosen caption".into()),
            allow_conflicting_id: false,
        })
        .unwrap();
    let bytes = legacy_pack(&legacy_metadata(&source), &source, vec![]);
    let preview = song_pack::import(&library, "legacy.zip", &bytes, false, false, None).unwrap();
    assert_eq!(preview.items[0].title, existing.label);
    let report = song_pack::import(&library, "legacy.zip", &bytes, true, false, None).unwrap();
    assert_eq!(report.items[0].title, existing.label);
    assert_eq!(report.summary["duplicate"], 1);
    assert_eq!(
        report.items[0].entry.as_ref().unwrap().label,
        existing.label
    );
    assert_eq!(
        library.load(&existing.key).unwrap().entry.label,
        existing.label
    );
}
#[test]
fn retained_midi_recheck_never_replaces_supplied_canonical_or_uses_unlisted_sources() {
    let sandbox = Sandbox::new();
    let library = sandbox.library();
    let source = authored_midi();
    for supplied in [
        None,
        Some(b"{corrupt".to_vec()),
        Some(br#"{"events":[]}"#.to_vec()),
    ] {
        let mut metadata = legacy_metadata(&source);
        metadata["imports"]["canonical_score"] = json!("supplied.json");
        let extra = supplied
            .map(|data| vec![("song/supplied.json", data)])
            .unwrap_or_default();
        let report = song_pack::import(
            &library,
            "legacy.zip",
            &legacy_pack(&metadata, &source, extra),
            false,
            false,
            None,
        )
        .unwrap();
        assert_eq!(report.summary["retained_nonplayable"], 1);
        assert!(report.items[0].derivation.is_none());
    }
    let canonical = score("authoritative");
    let mut metadata = legacy_metadata(&source);
    metadata["imports"]["canonical_score"] = json!("supplied.json");
    let bytes = legacy_pack(
        &metadata,
        &source,
        vec![("song/supplied.json", canonical.clone().into_bytes())],
    );
    let report = song_pack::import(&library, "legacy.zip", &bytes, true, false, None).unwrap();
    assert_eq!(report.summary["saved"], 1);
    assert!(report.items[0].derivation.is_none());
    assert_eq!(
        report.items[0].entry.as_ref().unwrap().label,
        "Original authoritative"
    );
    assert_eq!(
        library
            .load(&report.items[0].entry.as_ref().unwrap().key)
            .unwrap()
            .score_json,
        canonical
    );
    for metadata in [
        json!({"format":"private-complete-midi-source-folder","version":1,"source_files":[],"imports":{"canonical_score":null}}),
        json!({"format":"worldmusichub-song","version":1,"sources":[],"score":null}),
    ] {
        let report = song_pack::import(
            &library,
            "legacy.zip",
            &legacy_pack(&metadata, &source, vec![]),
            false,
            false,
            None,
        )
        .unwrap();
        assert_eq!(report.summary["retained_nonplayable"], 1);
        assert!(report.items[0].derivation.is_none());
    }
}
#[test]
fn retained_midi_recheck_rejects_ambiguous_or_malformed_legacy_descriptors() {
    let sandbox = Sandbox::new();
    let library = sandbox.library();
    let source = authored_midi();
    let original = legacy_metadata(&source);
    let mutations = [
        ("/version", json!(2)),
        ("/format", json!("future-song")),
        ("/imports/canonical_score", json!(false)),
        ("/imports/canonical_error", json!([])),
        ("/imports/raw_midi", json!("source/other.mid")),
        ("/title", json!(12)),
        ("/source_files/0/sha256", json!(null)),
        ("/source_files/0/sha256", json!("wrong")),
        ("/source_files/0/bytes", json!(source.len() + 1)),
        ("/source_files/0/bytes", json!(null)),
        ("/source_files", json!({})),
        ("/imports", json!({})),
    ];
    for (pointer, value) in mutations {
        let mut metadata = original.clone();
        *metadata.pointer_mut(pointer).unwrap() = value;
        let report = song_pack::import(
            &library,
            "legacy.zip",
            &legacy_pack(&metadata, &source, vec![]),
            false,
            false,
            None,
        )
        .unwrap();
        assert_eq!(report.summary["retained_nonplayable"], 1, "{pointer}");
        assert!(report.items[0].derivation.is_none());
    }
    for duplicate_path in ["source/original.mid", "source/other.mid"] {
        let mut metadata = original.clone();
        let mut second = metadata["source_files"][0].clone();
        second["path"] = json!(duplicate_path);
        metadata["source_files"]
            .as_array_mut()
            .unwrap()
            .push(second);
        let bytes = legacy_pack(
            &metadata,
            &source,
            vec![("song/source/other.mid", source.clone())],
        );
        let report = song_pack::import(&library, "legacy.zip", &bytes, false, false, None).unwrap();
        assert_eq!(report.summary["retained_nonplayable"], 1);
    }
    let bytes = legacy_pack(
        &original,
        &source,
        vec![(
            "song/unlisted.wmhscore.json",
            score("unlisted").into_bytes(),
        )],
    );
    let report = song_pack::import(&library, "legacy.zip", &bytes, false, false, None).unwrap();
    assert_eq!(report.summary["retained_nonplayable"], 1);
    assert!(library.list().unwrap().entries.is_empty());
}
#[test]
fn old_receipt_without_derivation_remains_readable() {
    let old = json!({"index":0,"path":"metadata.json","title":"Original","status":"retained_nonplayable","code":"pack_source_only","message":"Earlier diagnostic","playable":false});
    let item: song_pack::Item = serde_json::from_value(old.clone()).unwrap();
    assert!(item.derivation.is_none());
    assert_eq!(serde_json::to_value(item).unwrap(), old);
}
#[test]
fn retained_midi_recheck_rejects_duplicate_json_keys_hidden_paths_and_oversized_sources() {
    let sandbox = Sandbox::new();
    let library = sandbox.library();
    let source = authored_midi();
    let original = legacy_metadata(&source);
    for metadata in [
        serde_json::to_string(&original).unwrap().replace(
            "\"canonical_score\":null",
            "\"canonical_score\":\"missing.json\",\"canonical_score\":null",
        ),
        serde_json::to_string(&original)
            .unwrap()
            .replace("\"bytes\":34", "\"bytes\":1,\"bytes\":34"),
    ] {
        let bytes = zip(vec![
            ("song/metadata.json", metadata.into_bytes()),
            ("song/source/original.mid", source.clone()),
        ]);
        let report = song_pack::import(&library, "legacy.zip", &bytes, false, false, None).unwrap();
        assert_eq!(report.summary["retained_nonplayable"], 1);
        assert!(report.items[0]
            .message
            .contains("Duplicate metadata object key"));
    }
    let mut hidden = original.clone();
    hidden["source_files"][0]["path"] = json!("source/.original.mid");
    hidden["imports"]["raw_midi"] = json!("source/.original.mid");
    let bytes = legacy_pack(
        &hidden,
        &source,
        vec![("song/source/.original.mid", source.clone())],
    );
    let report = song_pack::import(&library, "legacy.zip", &bytes, false, false, None).unwrap();
    assert_eq!(report.summary["retained_nonplayable"], 1);
    let source = vec![0; 8 * 1024 * 1024 + 1];
    let bytes = legacy_pack(&legacy_metadata(&source), &source, vec![]);
    let report = song_pack::import(&library, "legacy.zip", &bytes, false, false, None).unwrap();
    assert_eq!(report.summary["retained_nonplayable"], 1);
    assert!(report.items[0].message.contains("8 MiB score/import limit"));
    assert!(!sandbox.0.join("Scores/imports").exists());
}
#[test]
fn backup_entries_invalid_and_duplicate_and_conflicts_remain_visible() {
    let sandbox = Sandbox::new();
    let library = sandbox.library();
    let raw = score("same");
    let first: Value = serde_json::from_str(&raw).unwrap();
    let mut edition = first.clone();
    edition["title"] = json!("Second edition");
    let bytes=serde_json::to_vec(&json!({"format":"worldmusichub-library-backup","version":1,"entries":[{"score":first,"label":"Kept label"},{"score":first},{"score":edition},{"score":{"events":[]}}]})).unwrap();
    let preview = song_pack::import(&library, "backup.json", &bytes, false, false, None).unwrap();
    assert_eq!(preview.summary["ready"], 2);
    assert_eq!(preview.summary["conflict"], 1);
    assert_eq!(preview.summary["retained_nonplayable"], 1);
    let report = song_pack::import(&library, "backup.json", &bytes, true, false, None).unwrap();
    assert_eq!(report.summary["saved"], 1);
    assert_eq!(report.summary["duplicate"], 1);
    assert_eq!(report.summary["conflict"], 1);
    assert_eq!(report.summary["retained_nonplayable"], 1);
    assert_eq!(report.items[0].entry.as_ref().unwrap().label, "Kept label");
    let keep = song_pack::import(&library, "backup.json", &bytes, true, true, Some(2)).unwrap();
    assert_eq!(keep.summary["saved"], 1);
    assert_eq!(library.list().unwrap().entries.len(), 2);
}
#[test]
fn selected_commit_does_not_save_other_ready_rows() {
    let sandbox = Sandbox::new();
    let library = sandbox.library();
    let a = score("first");
    let b = score("second");
    let bytes = zip(vec![
        ("a.wmhscore.json", a.into_bytes()),
        ("b.wmhscore.json", b.into_bytes()),
    ]);
    let report = song_pack::import(&library, "selected.zip", &bytes, true, false, Some(1)).unwrap();
    assert_eq!(report.items[0].status, "ready");
    assert_eq!(report.items[1].status, "saved");
    assert_eq!(library.list().unwrap().entries.len(), 1);
}
#[test]
fn malformed_json_and_raw_event_json_are_retained_never_scores() {
    let sandbox = Sandbox::new();
    let library = sandbox.library();
    for (name, bytes) in [
        ("events.json", br#"{"events":[{"tick":0}]}"#.to_vec()),
        ("broken.json", b"{bad".to_vec()),
        ("broken.mid", b"MThd-invalid".to_vec()),
    ] {
        let report = song_pack::import(&library, name, &bytes, true, false, None).unwrap();
        assert_eq!(report.summary["retained_nonplayable"], 1);
        assert!(report.source.retained);
        assert!(!report.items[0].playable);
    }
    assert!(library.list().unwrap().entries.is_empty());
}
#[test]
fn malformed_canonical_inside_mixed_zip_is_not_silently_dropped() {
    let sandbox = Sandbox::new();
    let library = sandbox.library();
    let bytes = zip(vec![
        ("valid.wmhscore.json", score("valid").into_bytes()),
        ("bad.wmhscore.json", b"{broken".to_vec()),
    ]);
    let report = song_pack::import(&library, "mixed.zip", &bytes, true, false, None).unwrap();
    assert_eq!(report.summary["saved"], 1);
    assert_eq!(report.summary["retained_nonplayable"], 1);
}
#[test]
fn source_hash_or_media_path_mismatch_blocks_playability_but_retains() {
    let sandbox = Sandbox::new();
    let library = sandbox.library();
    for metadata in [
        json!({"format":"worldmusichub-song","version":1,"score":"score.json","sources":[{"path":"source.mid","bytes":3,"sha256":"incorrect"}]}),
        json!({"format":"worldmusichub-song","version":1,"score":"score.json","media":{"pv":"../outside.mp4"}}),
    ] {
        let bytes = zip(vec![
            ("metadata.json", serde_json::to_vec(&metadata).unwrap()),
            ("score.json", score("wrong").into_bytes()),
            ("source.mid", vec![1, 2, 3]),
        ]);
        let report =
            song_pack::import(&library, "bad-media.zip", &bytes, true, false, None).unwrap();
        assert_eq!(report.summary["retained_nonplayable"], 1);
        assert!(report.source.retained);
        assert!(library.list().unwrap().entries.is_empty());
    }
}
#[test]
fn unsafe_zip_inventory_fails_before_any_native_write() {
    let sandbox = Sandbox::new();
    let library = sandbox.library();
    for names in [
        ["../escape.json", "safe.json"],
        ["A.json", "a.json"],
        ["folder", "folder/file.json"],
    ] {
        let bytes = zip(names.into_iter().map(|n| (n, b"{}".to_vec())).collect());
        assert!(song_pack::import(&library, "unsafe.zip", &bytes, true, false, None).is_err());
        assert!(!sandbox.0.join("Scores/imports").exists());
    }
}
#[test]
fn crc_error_in_unparsed_attachment_is_detected_before_save() {
    let sandbox = Sandbox::new();
    let library = sandbox.library();
    let mut bytes = zip(vec![
        ("score.wmhscore.json", score("crc").into_bytes()),
        ("attachment.bin", b"unique-original-payload".to_vec()),
    ]);
    let at = bytes
        .windows(23)
        .position(|b| b == b"unique-original-payload")
        .unwrap();
    bytes[at] = b'X';
    assert!(song_pack::import(&library, "crc.zip", &bytes, true, false, None).is_err());
    assert!(library.list().unwrap().entries.is_empty());
}
#[test]
fn zip_central_size_limit_rejects_before_decompression() {
    let sandbox = Sandbox::new();
    let library = sandbox.library();
    let mut bytes = zip(vec![("entry.bin", vec![1])]);
    let at = bytes.windows(4).position(|b| b == b"PK\x01\x02").unwrap();
    bytes[at + 24..at + 28]
        .copy_from_slice(&((song_pack::MAX_ENTRY_BYTES + 1) as u32).to_le_bytes());
    let error = song_pack::import(&library, "limit.zip", &bytes, true, false, None).unwrap_err();
    assert!(error.error.contains("64 MiB"));
    assert!(!sandbox.0.join("Scores/imports").exists());
}
#[test]
fn mxl_pack_ambiguity_is_explicit() {
    let sandbox = Sandbox::new();
    let library = sandbox.library();
    let bytes = zip(vec![
        ("META-INF/container.xml", b"<container/>".to_vec()),
        (
            "metadata.json",
            br#"{"format":"worldmusichub-song","version":1}"#.to_vec(),
        ),
    ]);
    assert!(
        song_pack::import(&library, "mixed.zip", &bytes, false, false, None)
            .unwrap_err()
            .error
            .contains("Mixed MXL")
    );
}
#[test]
fn export_unified_pack_roundtrips_exact_canonical_json() {
    let sandbox = Sandbox::new();
    let library = sandbox.library();
    let raw = score("export");
    let entry = library
        .save(SaveRequest {
            score_json: raw.clone(),
            label: Some("My edition".into()),
            allow_conflicting_id: false,
        })
        .unwrap();
    let response = request(
        &library,
        "/api/library/pack/export",
        serde_json::to_vec(&json!({"keys":[entry.key]})).unwrap(),
    );
    assert_eq!(response.status(), 200);
    let second = Sandbox::new();
    let report = song_pack::import(
        &second.library(),
        "export.zip",
        response.body(),
        true,
        false,
        None,
    )
    .unwrap();
    assert_eq!(report.summary["saved"], 1);
    assert_eq!(report.items[0].entry.as_ref().unwrap().label, "My edition");
    assert_eq!(
        second
            .library()
            .load(&report.items[0].entry.as_ref().unwrap().key)
            .unwrap()
            .score_json,
        raw
    );
}
#[test]
fn transport_pack_only_bound_keeps_engine_limit_and_origin_guard() {
    let sandbox = Sandbox::new();
    let library = sandbox.library();
    let large = vec![b' '; worldmusichub_desktop::MAX_BODY + 1];
    let engine = request(&library, "/api/compile", large.clone());
    assert_eq!(engine.status(), 413);
    let pack = request(&library, "/api/library/import/preview", large);
    assert_eq!(pack.status(), 200);
    let report: Value = serde_json::from_slice(pack.body()).unwrap();
    assert_eq!(report["summary"]["retained_nonplayable"], 1);
    let foreign = dispatch_with_library(
        Request::builder()
            .method("POST")
            .uri("https://evil.example/api/library/import/commit")
            .body(vec![])
            .unwrap(),
        &library,
    );
    assert_eq!(foreign.status(), 403);
}
#[test]
fn corrupt_original_is_never_overwritten_by_repeat_import() {
    let sandbox = Sandbox::new();
    let library = sandbox.library();
    let raw = score("corrupt");
    let report =
        song_pack::import(&library, "original.json", raw.as_bytes(), true, false, None).unwrap();
    let path = sandbox
        .0
        .join("Scores/imports")
        .join(report.source.archive_key)
        .join("source.bin");
    fs::write(&path, b"changed").unwrap();
    assert!(
        song_pack::import(&library, "original.json", raw.as_bytes(), true, false, None).is_err()
    );
    assert_eq!(fs::read(path).unwrap(), b"changed");
}

#[test]
fn invalid_reserved_metadata_cannot_fall_back_to_a_playable_score() {
    let sandbox = Sandbox::new();
    let library = sandbox.library();
    for (name, metadata) in [
        ("metadata.json", b"{broken".to_vec()),
        ("metadata.json", vec![b' '; 256 * 1024 + 1]),
        (
            "manifest.json",
            serde_json::to_vec(&json!({"format":"worldmusichub-song-pack","version":2,"songs":[]}))
                .unwrap(),
        ),
    ] {
        let bytes = zip(vec![
            (name, metadata),
            ("score.json", score("must-not-bypass").into_bytes()),
        ]);
        let report = song_pack::import(
            &library,
            "malformed-metadata.zip",
            &bytes,
            true,
            false,
            None,
        )
        .unwrap();
        assert_eq!(report.summary["saved"], 0);
        assert_eq!(report.summary["retained_nonplayable"], 1);
        assert!(report.source.retained);
    }
    assert!(library.list().unwrap().entries.is_empty());
}

#[test]
fn standard_alternate_beside_canonical_requires_explicit_choice() {
    let sandbox = Sandbox::new();
    let library = sandbox.library();
    let bytes = zip(vec![
        ("exercise.wmhscore.json", score("canonical").into_bytes()),
        ("exercise.jianpu", b"1=C4\nmeter=4/4\n5 6 7 0 |".to_vec()),
    ]);
    let report = song_pack::import(&library, "alternate.zip", &bytes, true, false, None).unwrap();
    assert_eq!(report.summary["saved"], 1);
    assert_eq!(report.summary["conflict"], 1);
    let index = report
        .items
        .iter()
        .find(|i| i.code == "pack_alternate_source")
        .unwrap()
        .index;
    let chosen =
        song_pack::import(&library, "alternate.zip", &bytes, true, true, Some(index)).unwrap();
    assert_eq!(chosen.summary["saved"], 1);
    assert_eq!(library.list().unwrap().entries.len(), 2);
}

#[test]
fn central_zip_extra_overrides_are_rejected_before_parsing() {
    let sandbox = Sandbox::new();
    let library = sandbox.library();
    for kind in [0x0001u16, 0x7075u16] {
        let mut bytes = zip(vec![("safe.bin", b"source".to_vec())]);
        let central = bytes.windows(4).position(|b| b == b"PK\x01\x02").unwrap();
        let eocd = bytes.windows(4).position(|b| b == b"PK\x05\x06").unwrap();
        let name_len = u16::from_le_bytes([bytes[central + 28], bytes[central + 29]]) as usize;
        let extra_len = u16::from_le_bytes([bytes[central + 30], bytes[central + 31]]) as usize;
        let mut extra = kind.to_le_bytes().to_vec();
        extra.extend_from_slice(&24u16.to_le_bytes());
        extra.extend_from_slice(&[0; 24]);
        bytes[central + 30..central + 32]
            .copy_from_slice(&((extra_len + extra.len()) as u16).to_le_bytes());
        let directory_size = u32::from_le_bytes(bytes[eocd + 12..eocd + 16].try_into().unwrap());
        bytes[eocd + 12..eocd + 16]
            .copy_from_slice(&(directory_size + extra.len() as u32).to_le_bytes());
        bytes.splice(central + 46 + name_len..central + 46 + name_len, extra);
        let error =
            song_pack::import(&library, "extra.zip", &bytes, true, false, None).unwrap_err();
        assert!(error.error.contains("extra fields"));
        assert!(!sandbox.0.join("Scores/imports").exists());
    }
}

#[test]
fn bounded_local_zip64_size_placeholders_remain_compatible() {
    let sandbox = Sandbox::new();
    let library = sandbox.library();
    for size in [6u64, 7u64] {
        let mut bytes = zip(vec![("safe.bin", b"source".to_vec())]);
        let central = bytes.windows(4).position(|b| b == b"PK\x01\x02").unwrap();
        let eocd = bytes.windows(4).position(|b| b == b"PK\x05\x06").unwrap();
        let name_len = u16::from_le_bytes([bytes[26], bytes[27]]) as usize;
        let extra_len = u16::from_le_bytes([bytes[28], bytes[29]]) as usize;
        let mut extra = 1u16.to_le_bytes().to_vec();
        extra.extend_from_slice(&16u16.to_le_bytes());
        extra.extend_from_slice(&size.to_le_bytes());
        extra.extend_from_slice(&6u64.to_le_bytes());
        bytes[4..6].copy_from_slice(&45u16.to_le_bytes());
        bytes[18..26].fill(255);
        bytes[28..30].copy_from_slice(&((extra_len + 20) as u16).to_le_bytes());
        bytes[eocd + 16..eocd + 20].copy_from_slice(&((central + 20) as u32).to_le_bytes());
        bytes.splice(30 + name_len..30 + name_len, extra);
        let result = song_pack::import(&library, "streamed.zip", &bytes, false, false, None);
        if size == 6 {
            assert_eq!(result.unwrap().inventory.files.len(), 1);
        } else {
            assert!(result.unwrap_err().error.contains("disagree"));
        }
    }
}

#[test]
fn history_is_paged_and_complete_receipt_remains_available() {
    let sandbox = Sandbox::new();
    let library = sandbox.library();
    for n in 0..11 {
        song_pack::import(
            &library,
            &format!("source-{n}.json"),
            format!("{{\"events\":[{n}]}}").as_bytes(),
            true,
            false,
            None,
        )
        .unwrap();
    }
    let first: Value =
        serde_json::from_slice(request(&library, "/api/library/imports", vec![]).body()).unwrap();
    assert_eq!(first["imports"].as_array().unwrap().len(), 10);
    assert_eq!(first["next_cursor"], "10");
    assert_eq!(
        first["imports"][0]["report"]["inventory"]["files"],
        json!([])
    );
    let second = dispatch_with_library(
        Request::builder()
            .method("GET")
            .uri(format!("{ORIGIN}/api/library/imports?cursor=10"))
            .body(vec![])
            .unwrap(),
        &library,
    );
    assert_eq!(second.status(), 200);
    let second: Value = serde_json::from_slice(second.body()).unwrap();
    assert_eq!(second["imports"].as_array().unwrap().len(), 1);
    assert!(second["next_cursor"].is_null());
    let detail = request(
        &library,
        "/api/library/import/report",
        serde_json::to_vec(&json!({"archive_key":first["imports"][0]["archive_key"]})).unwrap(),
    );
    assert_eq!(detail.status(), 200);
    let detail: Value = serde_json::from_slice(detail.body()).unwrap();
    assert_eq!(detail["inventory"]["files"].as_array().unwrap().len(), 1);
    assert_eq!(
        dispatch_with_library(
            Request::builder()
                .method("GET")
                .uri(format!("{ORIGIN}/api/library/imports?cursor=../../outside"))
                .body(vec![])
                .unwrap(),
            &library
        )
        .status(),
        403
    );
}

#[test]
fn interrupted_stage_bytes_count_toward_retention_capacity() {
    let sandbox = Sandbox::new();
    let library = sandbox.library();
    request(&library, "/api/library/imports", vec![]);
    let stage = sandbox.0.join("Scores/.import-staging/interrupted");
    fs::create_dir(&stage).unwrap();
    let file = fs::File::create(stage.join("source.bin")).unwrap();
    file.set_len(3 * 1024 * 1024 * 1024).unwrap();
    let error = song_pack::import(&library, "small.json", b"{}", true, false, None).unwrap_err();
    assert_eq!(error.code, "pack_storage_limit");
    assert!(library.list().unwrap().entries.is_empty());
    let history: Value =
        serde_json::from_slice(request(&library, "/api/library/imports", vec![]).body()).unwrap();
    assert_eq!(history["issues"][0]["code"], "pack_incomplete_stages");
}
