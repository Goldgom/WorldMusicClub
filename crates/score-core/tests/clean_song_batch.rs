//! Original synthetic fixtures only; no private corpus bytes or names.
use base64::Engine;
use serde_json::Value;
use sha2::{Digest, Sha256};
use std::{
    collections::BTreeMap,
    fs,
    io::{Cursor, Read},
    path::{Path, PathBuf},
    process::{Command, Output},
    sync::atomic::{AtomicUsize, Ordering},
};

static NEXT: AtomicUsize = AtomicUsize::new(0);
struct Temp(PathBuf);
impl Temp {
    fn new() -> Self {
        let path = std::env::temp_dir().join(format!(
            "wmh-batch-test-{}-{}",
            std::process::id(),
            NEXT.fetch_add(1, Ordering::Relaxed)
        ));
        fs::create_dir(&path).unwrap();
        Self(path)
    }
    fn path(&self, name: &str) -> PathBuf {
        self.0.join(name)
    }
}
impl Drop for Temp {
    fn drop(&mut self) {
        fs::remove_dir_all(&self.0).ok();
    }
}
fn smf(tracks: &[Vec<u8>]) -> Vec<u8> {
    let mut bytes = b"MThd\0\0\0\x06\0\x01".to_vec();
    bytes.extend_from_slice(&(tracks.len() as u16).to_be_bytes());
    bytes.extend_from_slice(&480_u16.to_be_bytes());
    for track in tracks {
        bytes.extend_from_slice(b"MTrk");
        bytes.extend_from_slice(&(track.len() as u32).to_be_bytes());
        bytes.extend_from_slice(track);
    }
    bytes
}
fn source() -> Vec<u8> {
    smf(&[
        vec![
            0, 255, 81, 3, 7, 161, 32, 0, 255, 88, 4, 4, 2, 24, 8, 0x87, 0x40, 255, 47, 0,
        ],
        vec![
            0, 0x90, 60, 100, 0x83, 0x60, 0x80, 60, 64, 0x83, 0x60, 255, 47, 0,
        ],
    ])
}
fn run(input: &Path, output: &Path, previous: Option<&Path>) -> Output {
    let mut command = Command::new(env!("CARGO_BIN_EXE_clean-song-batch"));
    command.arg(input).arg(output);
    if let Some(previous) = previous {
        command.arg("--compare").arg(previous);
    }
    command.output().unwrap()
}
fn json(path: &Path) -> Value {
    serde_json::from_slice(&fs::read(path).unwrap()).unwrap()
}
fn sha(bytes: &[u8]) -> String {
    format!("{:x}", Sha256::digest(bytes))
}

#[test]
fn mixed_batch_continues_deduplicates_and_publishes_only_clean_songs() {
    let temp = Temp::new();
    let input = temp.path("input");
    fs::create_dir(&input).unwrap();
    fs::create_dir(input.join("nested")).unwrap();
    let original = source();
    fs::write(input.join("a.mid"), &original).unwrap();
    fs::write(input.join("nested/COPY.MIDI"), &original).unwrap();
    fs::write(input.join("b-broken.vsq"), b"not an SMF").unwrap();
    fs::write(input.join("ignored.txt"), &original).unwrap();
    let out = temp.path("run");
    let result = run(&input, &out, None);
    assert_eq!(
        result.status.code(),
        Some(1),
        "{}",
        String::from_utf8_lossy(&result.stderr)
    );
    let report = json(&out.join("batch-report.json"));
    assert_eq!(report["summary"]["source_files"], 3);
    assert_eq!(report["summary"]["unique_results"], 2);
    assert_eq!(report["summary"]["duplicate_files"], 1);
    assert_eq!(report["summary"]["complete"], 1);
    assert_eq!(report["summary"]["failed"], 1);
    assert_eq!(
        json(&out.join("songs/manifest.json")),
        serde_json::json!({"format":"worldmusichub-song-pack","version":2,"songs":[{"folder":sha(&original)}]})
    );
    let song = &report["results"][0];
    assert_eq!(
        song["source_paths"],
        serde_json::json!(["a.mid", "nested/COPY.MIDI"])
    );
    assert_eq!(song["source_sha256"], sha(&original));
    assert_eq!(song["data_complete"], true);
    assert_eq!(song["coverage"]["source_tracks"], 2);
    assert_eq!(song["coverage"]["key_attacks"], 1);
    assert_eq!(song["coverage"]["retained_attacks"], 1);
    assert_eq!(song["duration"]["milliseconds"], 1000.0);
    let package = out.join(song["package"]["folder"].as_str().unwrap());
    let mut names: Vec<_> = fs::read_dir(&package)
        .unwrap()
        .map(|entry| entry.unwrap().file_name())
        .collect();
    names.sort();
    assert_eq!(names, ["metadata.json", "score.json"]);
    let score = fs::read(package.join("score.json")).unwrap();
    let metadata = json(&package.join("metadata.json"));
    assert_eq!(metadata["score"]["sha256"], sha(&score));
    assert_eq!(metadata["score"]["bytes"], score.len());
    assert_eq!(metadata["media"], serde_json::json!([]));
    assert!(json(&package.join("score.json"))["notation"]["source"].is_null());
    score_core::basic_keys::decode_json(&score).unwrap();
    assert_eq!(
        score,
        score_core::basic_keys::encode_json(
            &score_core::basic_keys::convert_midi(&original, "a").unwrap()
        )
        .unwrap()
    );
    assert!(out
        .join(format!("reports/{}/result.json", sha(&original)))
        .is_file());
    assert!(out
        .join(format!("reports/{}/result.md", sha(&original)))
        .is_file());
    assert!(!out.join(".staging").exists());
    assert_eq!(fs::read(input.join("a.mid")).unwrap(), original);
}
#[test]
fn reruns_compare_identity_and_refuse_existing_output_without_changes() {
    let temp = Temp::new();
    let input = temp.path("input");
    fs::create_dir(&input).unwrap();
    fs::write(input.join("original.mid"), source()).unwrap();
    let first = temp.path("first");
    assert!(run(&input, &first, None).status.success());
    let before = fs::read(first.join("batch-report.json")).unwrap();
    assert_eq!(run(&input, &first, None).status.code(), Some(2));
    assert_eq!(fs::read(first.join("batch-report.json")).unwrap(), before);
    let second = temp.path("second");
    assert!(run(&input, &second, Some(&first.join("batch-report.json")))
        .status
        .success());
    let compare = json(&second.join("comparison.json"));
    assert_eq!(compare["unchanged"], 1);
    assert_eq!(compare["changed"], serde_json::json!([]));
    fs::write(
        input.join("missing-end.mid"),
        smf(&[vec![0, 0x90, 64, 100, 0x83, 0x60, 255, 47, 0]]),
    )
    .unwrap();
    let third = temp.path("third");
    assert_eq!(
        run(&input, &third, Some(&first.join("batch-report.json")))
            .status
            .code(),
        Some(3)
    );
    let report = json(&third.join("batch-report.json"));
    let review = report["results"]
        .as_array()
        .unwrap()
        .iter()
        .find(|r| r["status"] == "review")
        .unwrap();
    assert_eq!(review["data_complete"], true);
    assert_eq!(review["timing_review"], true);
    assert_eq!(review["coverage"]["unresolved_ends"], 1);
    assert!(review["package"].is_object());
    assert_eq!(
        json(&third.join("comparison.json"))["added"]
            .as_array()
            .unwrap()
            .len(),
        1
    );
}
#[test]
fn transport_manifest_matches_official_writer_and_includes_review_packages() {
    let temp = Temp::new();
    let input = temp.path("input");
    fs::create_dir(&input).unwrap();
    fs::write(input.join("complete.mid"), source()).unwrap();
    fs::write(
        input.join("review.mid"),
        smf(&[vec![0, 0x90, 64, 100, 0x83, 0x60, 255, 47, 0]]),
    )
    .unwrap();
    let out = temp.path("run");
    assert_eq!(run(&input, &out, None).status.code(), Some(3));
    let report = json(&out.join("batch-report.json"));
    let manifest_bytes = fs::read(out.join("songs/manifest.json")).unwrap();
    let manifest: Value = serde_json::from_slice(&manifest_bytes).unwrap();
    assert_eq!(manifest["songs"].as_array().unwrap().len(), 2);
    let mut official = score_core::clean_pack::Writer::new();
    let mut expected_files = BTreeMap::new();
    for result in report["results"].as_array().unwrap() {
        let folder = result["source_sha256"].as_str().unwrap();
        let files: BTreeMap<_, _> = ["metadata.json", "score.json"]
            .iter()
            .map(|name| {
                let bytes = fs::read(out.join("songs").join(folder).join(name)).unwrap();
                expected_files.insert(format!("{folder}/{name}"), bytes.clone());
                ((*name).to_owned(), bytes)
            })
            .collect();
        official.add_song(folder, files).unwrap();
    }
    let archive = official.finish().unwrap();
    let mut archive = zip::ZipArchive::new(Cursor::new(archive)).unwrap();
    assert_eq!(archive.len(), 5);
    let mut official_manifest = vec![];
    archive
        .by_name("manifest.json")
        .unwrap()
        .read_to_end(&mut official_manifest)
        .unwrap();
    assert_eq!(manifest_bytes, official_manifest);
    for (name, expected) in expected_files {
        let mut actual = vec![];
        archive
            .by_name(&name)
            .unwrap()
            .read_to_end(&mut actual)
            .unwrap();
        assert_eq!(actual, expected);
    }
    assert!(!out.join("songs/batch-report.json").exists());
    assert!(!out.join("songs/reports").exists());
}
#[test]
fn zero_length_is_preserved_without_claiming_positive_duration_practice() {
    let temp = Temp::new();
    let input = temp.path("input");
    fs::create_dir(&input).unwrap();
    fs::write(
        input.join("zero.mid"),
        smf(&[vec![0, 0x90, 60, 100, 0, 0x80, 60, 64, 0, 255, 47, 0]]),
    )
    .unwrap();
    let out = temp.path("run");
    let run = run(&input, &out, None);
    assert_eq!(
        run.status.code(),
        Some(0),
        "{}",
        String::from_utf8_lossy(&run.stderr)
    );
    let report = json(&out.join("batch-report.json"));
    let song = &report["results"][0];
    assert_eq!(song["data_complete"], true);
    assert_eq!(song["timing_review"], false);
    assert_eq!(song["coverage"]["zero_length_attacks"], 1);
    assert_eq!(song["practice_coverage"]["notation_notes"], 0);
    assert_eq!(song["coverage"]["retained_attacks"], 1);
}
#[test]
fn framed_vsq_under_mid_extension_uses_existing_authoring_profile() {
    let temp = Temp::new();
    let input = temp.path("input");
    fs::create_dir(&input).unwrap();
    let fixture: Value = serde_json::from_str(include_str!(
        "../../../tests/fixtures/song-authoring/vsq-request.json"
    ))
    .unwrap();
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(fixture["source_base64"].as_str().unwrap())
        .unwrap();
    fs::write(input.join("original-authored.mid"), &bytes).unwrap();
    let out = temp.path("run");
    let run = run(&input, &out, None);
    assert!(
        run.status.success(),
        "{}",
        String::from_utf8_lossy(&run.stderr)
    );
    let report = json(&out.join("batch-report.json"));
    let song = &report["results"][0];
    assert_eq!(song["profile"], "wmh-vsq-clean-v1");
    assert_eq!(song["data_complete"], true);
    assert_eq!(song["capabilities"]["whole_vocal_rendering"], "blocked");
    score_core::vsq_clean::decode_json(
        &fs::read(
            out.join(song["package"]["folder"].as_str().unwrap())
                .join("score.json"),
        )
        .unwrap(),
    )
    .unwrap();
}
#[test]
fn invalid_invocations_and_empty_roots_do_not_create_output() {
    let temp = Temp::new();
    let input = temp.path("input");
    fs::create_dir(&input).unwrap();
    let out = temp.path("run");
    assert_eq!(run(&input, &out, None).status.code(), Some(2));
    assert!(!out.exists());
    fs::write(input.join("one.mid"), source()).unwrap();
    let nested = input.join("run");
    assert_eq!(run(&input, &nested, None).status.code(), Some(2));
    assert!(!nested.exists());
    let bad = temp.path("bad-report.json");
    fs::write(&bad, b"{}").unwrap();
    assert_eq!(run(&input, &out, Some(&bad)).status.code(), Some(2));
    assert!(!out.exists());
}
#[test]
fn json_stdout_is_the_final_report_and_rejects_unknown_options() {
    let temp = Temp::new();
    let input = temp.path("input");
    fs::create_dir(&input).unwrap();
    fs::write(input.join("one.mid"), source()).unwrap();
    let out = temp.path("run");
    let result = Command::new(env!("CARGO_BIN_EXE_clean-song-batch"))
        .arg(&input)
        .arg(&out)
        .arg("--json")
        .output()
        .unwrap();
    assert!(result.status.success());
    assert_eq!(
        result.stdout,
        fs::read(out.join("batch-report.json")).unwrap()
    );
    let wrong = temp.path("wrong");
    let result = Command::new(env!("CARGO_BIN_EXE_clean-song-batch"))
        .arg(&input)
        .arg(&wrong)
        .arg("--overwrite")
        .output()
        .unwrap();
    assert_eq!(result.status.code(), Some(2));
    assert!(!wrong.exists());
}
#[test]
fn oversized_sources_keep_exact_hashes_and_deduplicate_failed_aliases() {
    let temp = Temp::new();
    let input = temp.path("input");
    fs::create_dir(&input).unwrap();
    let bytes = vec![0_u8; score_core::midi_events::MAX_SOURCE_BYTES + 1];
    fs::write(input.join("a.mid"), &bytes).unwrap();
    fs::write(input.join("copy.vsq"), &bytes).unwrap();
    let out = temp.path("run");
    assert_eq!(run(&input, &out, None).status.code(), Some(1));
    let report = json(&out.join("batch-report.json"));
    assert_eq!(report["summary"]["failed"], 1);
    assert_eq!(report["summary"]["duplicate_files"], 1);
    let song = &report["results"][0];
    assert_eq!(song["source_sha256"], sha(&bytes));
    assert_eq!(song["source_bytes"], bytes.len());
    assert_eq!(song["issues"][0]["code"], "source_limit");
    assert!(song["package"].is_null());
    assert!(song["coverage"].is_null());
    assert!(!out.join("songs/manifest.json").exists());
    assert_eq!(fs::read_dir(out.join("songs")).unwrap().count(), 0);
}
#[test]
fn compatible_dialect_and_source_defect_are_disclosed_without_note_repair() {
    let temp = Temp::new();
    let input = temp.path("input");
    fs::create_dir(&input).unwrap();
    let legacy = smf(&[vec![
        0, 0x90, 60, 90, 1, 255, 88, 4, 4, 2, 24, 8, 1, 60, 0, 0, 255, 47, 0,
    ]]);
    let invalid_program = smf(&[vec![
        0, 0xc0, 128, 0, 0x90, 60, 90, 1, 0x80, 60, 0, 0, 255, 47, 0,
    ]]);
    fs::write(input.join("a-legacy.mid"), legacy).unwrap();
    fs::write(input.join("b-invalid-program.mid"), invalid_program).unwrap();
    let out = temp.path("run");
    assert_eq!(run(&input, &out, None).status.code(), Some(3));
    let report = json(&out.join("batch-report.json"));
    let legacy = &report["results"][0];
    assert_eq!(legacy["status"], "complete");
    assert_eq!(
        legacy["duration"]["timing"]["legacy_running_status_events"],
        1
    );
    let invalid = &report["results"][1];
    assert_eq!(invalid["status"], "review");
    assert_eq!(invalid["data_complete"], true);
    assert_eq!(invalid["source_defect"], true);
    assert_eq!(invalid["timing_review"], false);
    assert_eq!(invalid["coverage"]["determined_ends"], 1);
    let score = json(
        &out.join(invalid["package"]["folder"].as_str().unwrap())
            .join("score.json"),
    );
    assert_eq!(
        score["performance"]["tracks"][0]["events"][0][1],
        serde_json::json!([192, 128])
    );
}
#[cfg(unix)]
#[test]
fn source_symlinks_are_reported_without_following_or_stopping_valid_files() {
    let temp = Temp::new();
    let input = temp.path("input");
    fs::create_dir(&input).unwrap();
    fs::write(input.join("one.mid"), source()).unwrap();
    std::os::unix::fs::symlink(&input, input.join("cycle")).unwrap();
    let out = temp.path("run");
    assert_eq!(run(&input, &out, None).status.code(), Some(1));
    let report = json(&out.join("batch-report.json"));
    assert_eq!(report["summary"]["complete"], 1);
    assert_eq!(report["summary"]["discovery_errors"], 1);
}
