//! Original isolated-key fixtures only; no private MIDI, titles or melodies.
use http::Request;
use serde_json::{json, Value};
use std::{
    fs,
    path::PathBuf,
    sync::atomic::{AtomicU64, Ordering},
};
use worldmusichub_desktop::{dispatch_with_library, native_library::NativeLibrary, ORIGIN};

static NEXT: AtomicU64 = AtomicU64::new(0);
struct Sandbox(PathBuf);
impl Sandbox {
    fn new() -> Self {
        let root = std::env::temp_dir().join(format!(
            "wmh-direct-midi-{}-{}",
            std::process::id(),
            NEXT.fetch_add(1, Ordering::Relaxed)
        ));
        fs::create_dir(&root).unwrap();
        Self(root)
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
fn smf(tracks: &[Vec<u8>]) -> Vec<u8> {
    let mut bytes = b"MThd\0\0\0\x06".to_vec();
    bytes.extend(u16::from(tracks.len() > 1).to_be_bytes());
    bytes.extend((tracks.len() as u16).to_be_bytes());
    bytes.extend(384_u16.to_be_bytes());
    for track in tracks {
        bytes.extend(b"MTrk");
        bytes.extend((track.len() as u32).to_be_bytes());
        bytes.extend(track);
    }
    bytes
}
fn overlap_source() -> Vec<u8> {
    smf(&[
        // Same-key overlap and exact 337079-us tempo. Opaque metadata and a
        // running-status attack stay present alongside the interpreted keys.
        vec![
            0, 255, 81, 3, 5, 36, 183, 0, 0x90, 60, 91, 1, 60, 79, 1, 0x80, 60, 17, 1, 60, 23, 0,
            255, 1, 3, b'o', b'w', b'n', 0, 255, 47, 0,
        ],
        vec![
            0, 0xb1, 64, 127, 0, 0xc1, 42, 0, 0x91, 127, 63, 5, 0x81, 127, 11, 0, 0xb1, 64, 0, 0,
            255, 47, 0,
        ],
        // A metadata-only track must not disappear from the complete source.
        vec![0, 255, 3, 4, b'i', b'n', b'f', b'o', 5, 255, 47, 0],
    ])
}
fn request(library: &NativeLibrary, path: &str, bytes: Vec<u8>) -> http::Response<Vec<u8>> {
    dispatch_with_library(
        Request::builder()
            .method("POST")
            .uri(format!("{ORIGIN}{path}"))
            .header(
                "content-type",
                if path.starts_with("/api/library/import/") && !path.ends_with("/export") {
                    "audio/midi"
                } else {
                    "application/json"
                },
            )
            .header("x-wmh-filename", "Original%20isolated%20keys.mid")
            .body(bytes)
            .unwrap(),
        library,
    )
}
fn body(library: &NativeLibrary, path: &str, bytes: Vec<u8>) -> Value {
    let response = request(library, path, bytes);
    assert_eq!(
        response.status(),
        200,
        "{}",
        String::from_utf8_lossy(response.body())
    );
    serde_json::from_slice(response.body()).unwrap()
}

#[test]
fn raw_overlap_import_preserves_complete_source_and_practice_across_restart() {
    let sandbox = Sandbox::new();
    let library = sandbox.library();
    let source = overlap_source();
    let strict = practice_server::api("/api/import/midi", source.clone()).unwrap_err();
    assert!(strict.contains("pedal"), "{strict}");
    let preview = body(&library, "/api/library/import/preview", source.clone());
    assert_eq!(preview["summary"]["ready"], 1);
    assert_eq!(preview["items"][0]["playable"], true);
    assert_eq!(preview["source"]["retained"], false);
    assert!(library.list().unwrap().entries.is_empty());
    assert!(!sandbox.0.join("Scores/imports").exists());
    assert!(preview["warnings"]
        .as_array()
        .unwrap()
        .iter()
        .any(|warning| warning.as_str().unwrap().contains(&strict)));
    assert!(preview["warnings"]
        .as_array()
        .unwrap()
        .iter()
        .any(|warning| warning
            .as_str()
            .unwrap()
            .contains(score_core::basic_keys::RENDITION_POLICY)));

    let saved = body(&library, "/api/library/import/commit", source.clone());
    assert_eq!(saved["summary"]["saved"], 1, "{saved}");
    assert_eq!(saved["items"][0]["playable"], true);
    let key = saved["items"][0]["entry"]["key"]
        .as_str()
        .unwrap()
        .to_owned();
    let archive = saved["source"]["archive_key"].as_str().unwrap().to_owned();
    for area in ["imports", "import-backups"] {
        assert_eq!(
            fs::read(
                sandbox
                    .0
                    .join("Scores")
                    .join(area)
                    .join(&archive)
                    .join("source.bin")
            )
            .unwrap(),
            source
        );
    }
    let loaded = library.load(&key).unwrap();
    assert!(
        loaded.score_json.is_none(),
        "A partial notation must not replace the complete package"
    );
    let package = loaded.clean_package.unwrap();
    assert_eq!(
        package.profile.as_deref(),
        Some(score_core::basic_keys::PROFILE)
    );
    assert_eq!(package.coverage["source_tracks"], 3);
    assert_eq!(package.coverage["source_events"], 15);
    assert_eq!(package.coverage["key_attacks"], 3);
    assert_eq!(
        package.runtime["rendition"]["policy_id"],
        score_core::basic_keys::RENDITION_POLICY
    );
    assert_eq!(
        package.runtime["rendition"]["coverage"]["practice_targets"],
        3
    );
    assert_eq!(
        package.runtime["rendition"]["coverage"]["derived_voices"],
        3
    );
    let decoded = score_core::basic_keys::decode_json(package.score_json.as_bytes()).unwrap();
    assert_eq!(
        serde_json::to_value(&decoded).unwrap(),
        serde_json::to_value(
            score_core::basic_keys::convert_midi(&source, "Original isolated keys.mid").unwrap()
        )
        .unwrap()
    );
    let rendition = score_core::basic_keys::compile_rendition(&decoded).unwrap();
    assert_eq!(rendition.timeline.notes.len(), 3);
    let range = score_core::instruments::analyze_instrument(
        &rendition.timeline,
        &score_core::instruments::InstrumentProfile::Piano {
            key_count: 88,
            lowest_midi: None,
        },
    )
    .unwrap();
    assert!(range
        .diagnostics
        .iter()
        .any(|diagnostic| diagnostic.code == "instrument_range"));
    assert_eq!(range.note_options.len(), 3);
    assert!(!range.changed_source_notes);

    drop(library);
    let restarted = sandbox.library();
    assert_eq!(restarted.list().unwrap().entries.len(), 1);
    let reopened = restarted.load(&key).unwrap().clean_package.unwrap();
    assert_eq!(reopened.score_json, package.score_json);
    assert_eq!(reopened.runtime, package.runtime);
    let original = request(
        &restarted,
        "/api/library/import/export",
        serde_json::to_vec(&json!({"archive_key":archive})).unwrap(),
    );
    assert_eq!(original.status(), 200);
    assert_eq!(original.body(), &source);
    let duplicate = body(&restarted, "/api/library/import/commit", source);
    assert_eq!(duplicate["summary"]["duplicate"], 1);
    assert_eq!(duplicate["items"][0]["entry"]["key"], key);
    assert_eq!(restarted.list().unwrap().entries.len(), 1);
}

#[test]
fn direct_canonical_success_keeps_existing_score_contract() {
    let sandbox = Sandbox::new();
    let library = sandbox.library();
    let source = smf(&[vec![0, 0x90, 60, 90, 96, 0x80, 60, 0, 0, 255, 47, 0]]);
    let compiled = practice_server::api("/api/import/midi", source.clone()).unwrap();
    let saved = body(&library, "/api/library/import/commit", source.clone());
    assert_eq!(saved["summary"]["saved"], 1);
    assert!(saved["warnings"].as_array().unwrap().is_empty());
    assert!(saved["items"][0].get("clean_package").is_none());
    let loaded = library
        .load(saved["items"][0]["entry"]["key"].as_str().unwrap())
        .unwrap();
    assert!(loaded.clean_package.is_none());
    assert_eq!(
        serde_json::from_str::<Value>(loaded.score_json.as_deref().unwrap()).unwrap(),
        compiled["score"]
    );
}

#[test]
fn malformed_midi_never_becomes_a_playable_or_saved_score() {
    let sandbox = Sandbox::new();
    let library = sandbox.library();
    let malformed = b"MThd\0\0\0\x06\0\0\0\x01\x01\x80MTrk\0\0\0\x08\0\x90".to_vec();
    for route in ["/api/library/import/preview", "/api/library/import/commit"] {
        let report = body(&library, route, malformed.clone());
        assert_eq!(report["summary"]["retained_nonplayable"], 1);
        assert_eq!(report["items"][0]["playable"], false);
        assert!(report["items"][0].get("entry").is_none());
        assert!(report["items"][0].get("clean_package").is_none());
        assert!(report["items"][0]["message"]
            .as_str()
            .unwrap()
            .contains("basic_source_rejected"));
        assert!(library.list().unwrap().entries.is_empty());
        if route.ends_with("/commit") {
            assert_eq!(report["source"]["retained"], true);
            let original = request(
                &library,
                "/api/library/import/export",
                serde_json::to_vec(&json!({"archive_key":report["source"]["archive_key"]}))
                    .unwrap(),
            );
            assert_eq!(original.status(), 200);
            assert_eq!(original.body(), &malformed);
        }
    }
}

#[test]
fn explicit_midi_filename_cannot_silently_switch_to_json_or_zip() {
    let canonical_json = serde_json::to_vec(&score_core::catalog().remove(0)).unwrap();
    let clean_zip = score_core::clean_conversion::prepare_basic_keys(
        &overlap_source(),
        "Original container guard",
        "original.mid",
    )
    .unwrap()
    .pack()
    .unwrap();
    for bytes in [canonical_json, clean_zip] {
        let sandbox = Sandbox::new();
        let library = sandbox.library();
        let report = body(&library, "/api/library/import/preview", bytes);
        assert_eq!(report["summary"]["retained_nonplayable"], 1);
        assert_eq!(report["items"][0]["playable"], false);
        assert!(report["items"][0].get("clean_package").is_none());
        assert!(library.list().unwrap().entries.is_empty());
    }
}

#[test]
fn receiver_voice_limit_is_separate_from_complete_source_import() {
    let sandbox = Sandbox::new();
    let library = sandbox.library();
    let mut track = Vec::new();
    for _ in 0..129 {
        track.extend([0, 0x90, 60, 90]);
    }
    track.extend([96, 0xb0, 123, 0, 0, 255, 47, 0]);
    let source = smf(&[track]);
    let saved = body(&library, "/api/library/import/commit", source);
    assert_eq!(saved["summary"]["saved"], 1);
    assert_eq!(saved["items"][0]["playable"], false);
    let package = library
        .load(saved["items"][0]["entry"]["key"].as_str().unwrap())
        .unwrap()
        .clean_package
        .unwrap();
    assert_eq!(
        package.runtime["compilation"]["timeline"]["notes"]
            .as_array()
            .unwrap()
            .len(),
        129
    );
    assert_eq!(
        package.runtime["rendition"]["coverage"]["maximum_allocated_voices"],
        129
    );
    assert_eq!(package.coverage["key_attacks"], 129);
}

#[test]
fn overlapping_piano_import_keeps_all_targets_and_requires_explicit_wider_device_range() {
    let sandbox = Sandbox::new();
    let library = sandbox.library();
    // Newly authored isolated keys, not a transcription of user music. The
    // second attack precedes the first release at the same source tick.
    let mut track = vec![0, 0xc0, 0];
    track.extend([0, 0x90, 50, 90]);
    track.extend([48, 0x90, 50, 80]);
    track.extend([0, 0x80, 50, 0]);
    track.extend([48, 0x80, 50, 0]);
    track.extend([0, 0x90, 25, 70]);
    track.extend([48, 0x80, 25, 0]);
    track.extend([0, 0x90, 95, 60]);
    track.extend([48, 0x80, 95, 0]);
    track.extend([0, 255, 47, 0]);
    let source = smf(&[track]);
    let strict = practice_server::api("/api/import/midi", source.clone()).unwrap_err();
    assert!(strict.contains("Ambiguous overlapping MIDI note-ons"));
    let saved = body(&library, "/api/library/import/commit", source.clone());
    assert_eq!(saved["summary"]["saved"], 1);
    assert_eq!(saved["items"][0]["playable"], true);
    let key = saved["items"][0]["entry"]["key"].as_str().unwrap();
    let package = library.load(key).unwrap().clean_package.unwrap();
    let decoded = score_core::basic_keys::decode_json(package.score_json.as_bytes()).unwrap();
    let rendition = score_core::basic_keys::compile_rendition(&decoded).unwrap();
    assert_eq!(rendition.timeline.notes.len(), 4);
    assert_eq!(
        rendition
            .timeline
            .notes
            .iter()
            .map(|note| note.midi)
            .collect::<Vec<_>>(),
        vec![50, 50, 25, 95]
    );
    assert_eq!(rendition.rendition.coverage.source_attacks, 4);
    assert_eq!(rendition.rendition.coverage.paired_releases, 4);
    assert_eq!(rendition.rendition.coverage.synthetic_gates, 0);
    for (key_count, outside) in [(61, 1), (88, 0)] {
        let report = score_core::instruments::analyze_instrument(
            &rendition.timeline,
            &score_core::instruments::InstrumentProfile::Piano {
                key_count,
                lowest_midi: None,
            },
        )
        .unwrap();
        assert_eq!(report.note_options.len(), 4);
        assert_eq!(
            report
                .note_options
                .iter()
                .filter(|note| !note.playable)
                .count(),
            outside
        );
        assert!(!report.changed_source_notes);
    }
    assert_eq!(
        library.load(key).unwrap().clean_package.unwrap().score_json,
        package.score_json
    );
    let original = request(
        &library,
        "/api/library/import/export",
        serde_json::to_vec(&json!({"archive_key":saved["source"]["archive_key"]})).unwrap(),
    );
    assert_eq!(original.status(), 200);
    assert_eq!(original.body(), &source);
}
