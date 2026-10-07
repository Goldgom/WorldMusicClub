//! Native Single preset, using the exact original FIFO package bytes already
//! authored and retained by tests/native_assistance.rs. No new musical source.
//! Regenerate only this vector with:
//! WMH_UPDATE_ASSISTANCE_PRESET_FIXTURES=1 cargo test -p worldmusichub-desktop --test native_assistance_presets
use http::Request;
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::{
    collections::BTreeMap,
    fs,
    io::{Cursor, Read},
    path::{Path, PathBuf},
};
use worldmusichub_desktop::{dispatch_with_library, native_library::NativeLibrary, ORIGIN};

const GENERATE: &str = "/api/library/assistance/generate";
const VALIDATE: &str = "/api/library/assistance/validate";

struct Sandbox(PathBuf);
impl Sandbox {
    fn new() -> Self {
        let path = std::env::temp_dir().join(format!(
            "wmh-native-assistance-presets-{}",
            std::process::id()
        ));
        fs::create_dir(&path).unwrap();
        Self(path)
    }
    fn library(&self) -> NativeLibrary {
        NativeLibrary::open(self.0.join("Scores")).unwrap()
    }
    fn bytes(&self) -> BTreeMap<PathBuf, Vec<u8>> {
        fn visit(root: &Path, folder: &Path, files: &mut BTreeMap<PathBuf, Vec<u8>>) {
            for entry in fs::read_dir(folder).unwrap() {
                let path = entry.unwrap().path();
                if path.is_dir() {
                    visit(root, &path, files);
                } else {
                    files.insert(
                        path.strip_prefix(root).unwrap().into(),
                        fs::read(&path).unwrap(),
                    );
                }
            }
        }
        let mut files = BTreeMap::new();
        visit(&self.0, &self.0, &mut files);
        files
    }
}
impl Drop for Sandbox {
    fn drop(&mut self) {
        fs::remove_dir_all(&self.0).unwrap();
    }
}

fn dispatch(library: &NativeLibrary, path: &str, body: Vec<u8>) -> Vec<u8> {
    let response = dispatch_with_library(
        Request::builder()
            .method("POST")
            .uri(format!("{ORIGIN}{path}"))
            .header("content-type", "application/json")
            .header("x-wmh-filename", "original-assistance-presets.zip")
            .body(body)
            .unwrap(),
        library,
    );
    assert_eq!(
        response.status(),
        200,
        "{path}: {}",
        String::from_utf8_lossy(response.body())
    );
    response.into_body()
}

fn post(library: &NativeLibrary, path: &str, request: &Value) -> Vec<u8> {
    dispatch(library, path, serde_json::to_vec(request).unwrap())
}

#[test]
fn single_native_fixture_is_rebuilt_from_exact_saved_basic_source_bytes() {
    let base: Value = serde_json::from_str(include_str!(
        "../../../tests/fixtures/assistance-native-basic.json"
    ))
    .unwrap();
    let package = &base["opened"]["clean_package"];
    let files = BTreeMap::from([
        (
            "score.json".to_string(),
            package["score_json"].as_str().unwrap().as_bytes().to_vec(),
        ),
        (
            "metadata.json".to_string(),
            package["metadata_json"]
                .as_str()
                .unwrap()
                .as_bytes()
                .to_vec(),
        ),
    ]);
    let metadata: Value = serde_json::from_slice(&files["metadata.json"]).unwrap();
    assert_eq!(metadata["rights"]["status"], "original_authored");
    assert_eq!(metadata["rights"]["license"], "CC0-1.0");
    assert_eq!(metadata["score"]["bytes"], files["score.json"].len());
    assert_eq!(
        metadata["score"]["sha256"],
        format!("{:x}", Sha256::digest(&files["score.json"]))
    );
    // Retained whitespace belongs to the saved identity, even though the
    // interpreter's decoded events do not need it.
    assert!(files["score.json"].ends_with(b"\n \t\n"));
    let decoded = score_core::basic_keys::decode_json(&files["score.json"]).unwrap();
    let compiled = score_core::basic_keys::compile_rendition(&decoded).unwrap();
    let sandbox = Sandbox::new();
    let library = sandbox.library();
    let mut writer = score_core::clean_pack::Writer::new();
    writer.add_song("songs/original", files.clone()).unwrap();
    let imported: Value = serde_json::from_slice(&dispatch(
        &library,
        "/api/library/import/commit",
        writer.finish().unwrap(),
    ))
    .unwrap();
    assert_eq!(imported["summary"]["saved"], 1);
    assert_eq!(imported["items"][0]["entry"]["key"], base["source"]["key"]);
    assert_eq!(
        imported["items"][0]["entry"]["content_sha256"],
        base["source"]["content_sha256"]
    );
    let key = base["source"]["key"].as_str().unwrap();
    let loaded = library.load(key).unwrap();
    assert_eq!(
        serde_json::to_value(loaded.clean_package.as_ref().unwrap()).unwrap(),
        *package
    );
    assert_eq!(
        serde_json::to_value(&loaded.score_json).unwrap(),
        base["opened"]["score_json"]
    );
    let before = sandbox.bytes();
    let selection = &base["automatic"]["checked"]["plan"]["selection"];
    let original: Value = serde_json::from_slice(&post(
        &library,
        "/api/library/assistance/original",
        &json!({"source":base["source"],"selection":selection}),
    ))
    .unwrap();
    assert_eq!(original, base["original"]);
    let settings = json!({"algorithm_id":"wmc-keyboard-assistance-v1","max_targets_per_onset":1,
        "min_onset_interval_ms":500,"max_simultaneous_keys":1,"max_held_span_semitones":0});
    let request = json!({"source":base["source"],"selection":selection,"settings":settings});
    let generated = post(&library, GENERATE, &request);
    assert_eq!(generated, post(&library, GENERATE, &request));
    let response: Value = serde_json::from_slice(&generated).unwrap();
    let checked = &response["checked"];
    let recheck = json!({"source":base["source"],"plan":checked["plan"]});
    assert_eq!(generated, post(&library, VALIDATE, &recheck));
    assert_eq!(response["source"], base["source"]);
    assert_eq!(checked["receipt"], base["original"]["checked"]["receipt"]);
    assert_eq!(checked["plan"]["settings"], settings);
    assert_eq!(checked["coverage"]["human_target_count"], 2);
    assert_eq!(checked["coverage"]["machine_occurrence_count"], 4);
    assert_eq!(
        checked["coverage"]["occurrence_count"],
        compiled.timeline.notes.len()
    );
    assert_eq!(checked["scored_mode_allowed"], true);
    let human = checked["human_targets"]["timeline"]["notes"]
        .as_array()
        .unwrap();
    assert_eq!(
        (
            human[0]["midi"].as_u64().unwrap(),
            human[0]["start_ms"].as_f64().unwrap()
        ),
        (60, 0.0)
    );
    assert_eq!(
        (
            human[1]["midi"].as_u64().unwrap(),
            human[1]["start_ms"].as_f64().unwrap()
        ),
        (64, 500.0)
    );
    for target in human {
        let original = compiled
            .timeline
            .notes
            .iter()
            .find(|note| target["id"] == note.id)
            .unwrap();
        assert_eq!(*target, serde_json::to_value(original).unwrap());
    }
    let machine = checked["machine_occurrence_ids"].as_array().unwrap();
    let second_fifo = compiled
        .timeline
        .notes
        .iter()
        .find(|note| note.midi == 60 && note.start_ms == 125.0)
        .unwrap();
    assert_eq!(second_fifo.duration_ms, 375.0);
    assert!(machine.contains(&json!(second_fifo.id)));
    let human_ids: Vec<_> = human.iter().map(|note| &note["id"]).collect();
    for occurrence in &compiled.timeline.notes {
        let id = json!(occurrence.id);
        assert_ne!(human_ids.contains(&&id), machine.contains(&id));
    }
    // Native Check and validation remain read-only, including after reopening.
    assert_eq!(sandbox.bytes(), before);
    drop(library);
    let reopened = sandbox.library();
    assert_eq!(generated, post(&reopened, VALIDATE, &recheck));
    assert_eq!(generated, post(&reopened, GENERATE, &request));
    let exported = post(
        &reopened,
        "/api/library/pack/export",
        &json!({"keys":[key]}),
    );
    let mut archive = zip::ZipArchive::new(Cursor::new(exported)).unwrap();
    for (name, expected) in &files {
        let mut bytes = vec![];
        archive
            .by_name(&format!("songs/{key}/{name}"))
            .unwrap()
            .read_to_end(&mut bytes)
            .unwrap();
        assert_eq!(&bytes, expected);
    }
    assert_eq!(sandbox.bytes(), before);
    let fixture = json!({"source_fixture":"assistance-native-basic.json","selection":selection,
        "presets":{"single":{"settings":settings,"response":response}}});
    let fixture_bytes = serde_json::to_vec_pretty(&fixture).unwrap();
    let path = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../../tests/fixtures/assistance-presets-native-basic.json");
    if std::env::var_os("WMH_UPDATE_ASSISTANCE_PRESET_FIXTURES").is_some() {
        fs::write(&path, &fixture_bytes).unwrap();
    }
    assert_eq!(fs::read(path).unwrap(), fixture_bytes);
}
