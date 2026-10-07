//! Original saved-package progression vectors from socket-free handlers.
//! Regenerate with WMH_UPDATE_PROGRESSION_FIXTURES=1 cargo test
//! -p worldmusichub-desktop --test native_progression
use http::Request;
use serde_json::{json, Value};
use std::{
    collections::{BTreeMap, BTreeSet},
    fs,
    io::{Cursor, Read},
    path::{Path, PathBuf},
    sync::atomic::{AtomicU64, Ordering},
};
use worldmusichub_desktop::{dispatch_with_library, native_library::NativeLibrary, ORIGIN};

static SEQUENCE: AtomicU64 = AtomicU64::new(0);
const GENERATE: &str = "/api/library/progression/generate";
const VALIDATE: &str = "/api/library/progression/validate";

struct Sandbox(PathBuf);
impl Sandbox {
    fn new() -> Self {
        let path = std::env::temp_dir().join(format!(
            "wmh-native-progression-{}-{}",
            std::process::id(),
            SEQUENCE.fetch_add(1, Ordering::Relaxed)
        ));
        fs::create_dir(&path).unwrap();
        Self(path)
    }
    fn library(&self) -> NativeLibrary {
        NativeLibrary::open(self.0.join("Scores")).unwrap()
    }
    fn bytes(&self) -> BTreeMap<PathBuf, Vec<u8>> {
        fn visit(root: &Path, folder: &Path, output: &mut BTreeMap<PathBuf, Vec<u8>>) {
            for item in fs::read_dir(folder).unwrap() {
                let path = item.unwrap().path();
                if path.is_dir() {
                    visit(root, &path, output);
                } else {
                    output.insert(
                        path.strip_prefix(root).unwrap().into(),
                        fs::read(path).unwrap(),
                    );
                }
            }
        }
        let mut output = BTreeMap::new();
        visit(&self.0, &self.0, &mut output);
        output
    }
}
impl Drop for Sandbox {
    fn drop(&mut self) {
        fs::remove_dir_all(&self.0).unwrap();
    }
}

fn request(library: &NativeLibrary, path: &str, body: Vec<u8>) -> http::Response<Vec<u8>> {
    dispatch_with_library(
        Request::builder()
            .method("POST")
            .uri(format!("{ORIGIN}{path}"))
            .header("content-type", "application/json")
            .header("x-wmh-filename", "original-assistance.zip")
            .body(body)
            .unwrap(),
        library,
    )
}

fn post(library: &NativeLibrary, path: &str, body: &Value) -> Value {
    let response = request(library, path, serde_json::to_vec(body).unwrap());
    assert_eq!(
        response.status(),
        200,
        "{path}: {}",
        String::from_utf8_lossy(response.body())
    );
    serde_json::from_slice(response.body()).unwrap()
}

fn reject(library: &NativeLibrary, path: &str, body: &Value, status: u16) {
    let response = request(library, path, serde_json::to_vec(body).unwrap());
    assert_eq!(
        response.status(),
        status,
        "{path}: {body}: {}",
        String::from_utf8_lossy(response.body())
    );
    let error: Value = serde_json::from_slice(response.body()).unwrap();
    assert!(error.get("checked").is_none());
    assert!(
        error["code"].as_str().is_some_and(|code| !code.is_empty()),
        "{error}"
    );
}

fn save(library: &NativeLibrary, files: &BTreeMap<String, Vec<u8>>, profile: &str) -> Value {
    let mut writer = score_core::clean_pack::Writer::new();
    writer.add_song("songs/original", files.clone()).unwrap();
    let response = request(
        library,
        "/api/library/import/commit",
        writer.finish().unwrap(),
    );
    assert_eq!(
        response.status(),
        200,
        "{}",
        String::from_utf8_lossy(response.body())
    );
    let report: Value = serde_json::from_slice(response.body()).unwrap();
    assert_eq!(report["summary"]["saved"], 1, "{report}");
    let entry = &report["items"][0]["entry"];
    let (choice, policy) = match profile {
        score_core::basic_keys::PROFILE => (Value::Null, score_core::basic_keys::RENDITION_POLICY),
        score_core::vsq_clean::PROFILE => (
            json!("base_notes_instrumental"),
            "wmh-vsq-base-note-practice-v1",
        ),
        score_core::clean_song::PROFILE => (Value::Null, score_core::clean_song::PROFILE),
        _ => panic!("Unsupported test source"),
    };
    json!({"key":entry["key"],"content_sha256":entry["content_sha256"],"profile":profile,"choice":choice,"runtime_policy":policy})
}

fn selection(parts: &[String]) -> Value {
    json!({"selected_part_ids":parts,"profile":{"kind":"piano","key_count":88,"lowest_midi":21}})
}

fn assert_export(library: &NativeLibrary, source: &Value, files: &BTreeMap<String, Vec<u8>>) {
    let response = request(
        library,
        "/api/library/pack/export",
        serde_json::to_vec(&json!({"keys":[source["key"]]})).unwrap(),
    );
    assert_eq!(response.status(), 200);
    let mut archive = zip::ZipArchive::new(Cursor::new(response.body())).unwrap();
    for (path, bytes) in files {
        let mut actual = Vec::new();
        archive
            .by_name(&format!("songs/{}/{path}", source["key"].as_str().unwrap()))
            .unwrap()
            .read_to_end(&mut actual)
            .unwrap();
        assert_eq!(&actual, bytes);
    }
}

fn basic_files() -> BTreeMap<String, Vec<u8>> {
    // Reuse the original public FIFO exercise's exact bytes, including trailing
    // whitespace. The fixture's derived assistance is never used as input.
    let base: Value = serde_json::from_str(include_str!(
        "../../../tests/fixtures/assistance-native-basic.json"
    ))
    .unwrap();
    let package = &base["opened"]["clean_package"];
    ["score.json", "metadata.json"]
        .into_iter()
        .map(|name| {
            let field = name.replace('.', "_");
            (
                name.to_string(),
                package[&field].as_str().unwrap().as_bytes().to_vec(),
            )
        })
        .collect()
}

fn vsq_files() -> BTreeMap<String, Vec<u8>> {
    BTreeMap::from([
        (
            "metadata.json".into(),
            include_bytes!("../../../tests/fixtures/vsq-clean-v1/metadata.json").to_vec(),
        ),
        (
            "score.json".into(),
            include_bytes!("../../../tests/fixtures/vsq-clean-v1/score.json").to_vec(),
        ),
    ])
}

fn parts(files: &BTreeMap<String, Vec<u8>>, profile: &str) -> Vec<String> {
    if profile == score_core::basic_keys::PROFILE {
        score_core::basic_keys::decode_json(&files["score.json"])
            .unwrap()
            .performance
            .parts
            .into_iter()
            .map(|part| part.id)
            .collect()
    } else {
        score_core::vsq_clean::decode_json(&files["score.json"])
            .unwrap()
            .notation
            .parts
            .into_iter()
            .map(|part| part.id)
            .collect()
    }
}

fn recheck(library: &NativeLibrary, response: &Value) {
    assert_eq!(
        post(
            library,
            VALIDATE,
            &json!({"source":response["source"],"plan":response["checked"]["plan"]})
        ),
        *response
    );
    assert_eq!(
        response["checked"]["plan"]["receipt"],
        response["checked"]["assistance"]["receipt"]
    );
    assert_eq!(
        response["checked"]["plan"]["receipt"]["saved_package_sha256"],
        response["source"]["content_sha256"]
    );
}

fn write_fixture(name: &str, value: &Value) {
    let path = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../../tests/fixtures")
        .join(name);
    let bytes = serde_json::to_vec_pretty(value).unwrap();
    if std::env::var_os("WMH_UPDATE_PROGRESSION_FIXTURES").is_some() {
        fs::write(&path, &bytes).unwrap();
    }
    assert_eq!(fs::read(path).unwrap(), bytes);
}

#[test]
fn saved_basic_and_vsq_vectors_keep_full_source_clocks_atomicity_and_export_bytes() {
    for (files, profile, suffix) in [
        (basic_files(), score_core::basic_keys::PROFILE, "basic"),
        (vsq_files(), score_core::vsq_clean::PROFILE, "vsq"),
    ] {
        let metadata: Value = serde_json::from_slice(&files["metadata.json"]).unwrap();
        assert_eq!(metadata["rights"]["status"], "original_authored");
        assert_eq!(metadata["rights"]["license"], "CC0-1.0");
        let sandbox = Sandbox::new();
        let library = sandbox.library();
        let source = save(&library, &files, profile);
        let selection = selection(&parts(&files, profile));
        let before = sandbox.bytes();
        let mut layers = serde_json::Map::new();
        let mut previous = BTreeSet::new();
        let mut hierarchy = None;
        let mut summaries = None;
        for (index, layer) in ["single", "balanced", "dense"].into_iter().enumerate() {
            let input = json!({"source":source,"selection":selection,"layer":layer});
            let response = post(&library, GENERATE, &input);
            assert_eq!(post(&library, GENERATE, &input), response);
            recheck(&library, &response);
            let checked = &response["checked"];
            let assistance = &checked["assistance"];
            assert_eq!(checked["plan"]["layer"], layer);
            assert_eq!(assistance["plan"]["mode"], "explicit");
            assert_eq!(checked.as_object().unwrap().len(), 3);
            assert_eq!(checked["layers"].as_array().unwrap().len(), 3);
            let ids: BTreeSet<_> = assistance["plan"]["human_source_ids"]
                .as_array()
                .unwrap()
                .iter()
                .map(|value| value.as_str().unwrap().to_owned())
                .collect();
            assert!(previous.is_subset(&ids));
            assert_eq!(
                checked["layers"][index]["human_source_unit_count"],
                ids.len()
            );
            if let Some(previous) = &hierarchy {
                assert_eq!(&checked["plan"]["hierarchy_digest"], previous);
            }
            if let Some(previous) = &summaries {
                assert_eq!(&checked["layers"], previous);
            }
            hierarchy = Some(checked["plan"]["hierarchy_digest"].clone());
            summaries = Some(checked["layers"].clone());
            previous = ids;
            if suffix == "basic" {
                let score = score_core::basic_keys::decode_json(&files["score.json"]).unwrap();
                let compiled = score_core::basic_keys::compile_rendition(&score).unwrap();
                assert_eq!(
                    assistance["human_targets"]["timeline"]["duration_ms"],
                    compiled.timeline.duration_ms
                );
                for note in assistance["human_targets"]["timeline"]["notes"]
                    .as_array()
                    .unwrap()
                {
                    assert!(compiled
                        .timeline
                        .notes
                        .iter()
                        .any(|source| serde_json::to_value(source).unwrap() == *note));
                }
                // The second same-pitch attack keeps its full-source FIFO gate;
                // selection never filters raw events before release pairing.
                let second = compiled
                    .timeline
                    .notes
                    .iter()
                    .find(|note| note.midi == 60 && note.start_ms == 125.0)
                    .unwrap();
                assert_eq!(second.duration_ms, 375.0);
                let human: Vec<_> = assistance["human_targets"]["timeline"]["notes"]
                    .as_array()
                    .unwrap()
                    .iter()
                    .map(|note| note["id"].clone())
                    .collect();
                let machine = assistance["machine_occurrence_ids"].as_array().unwrap();
                for note in &compiled.timeline.notes {
                    assert_ne!(
                        human.contains(&json!(note.id)),
                        machine.contains(&json!(note.id))
                    );
                }
                if layer == "single" {
                    assert!(machine.contains(&json!(second.id)));
                }
            } else {
                let score = score_core::vsq_clean::decode_json(&files["score.json"]).unwrap();
                assert_eq!(
                    score_core::compile(score.notation).unwrap().timeline.notes[0].start_ms,
                    2000.0
                );
                assert_eq!(
                    assistance["human_targets"]["timeline"]["notes"][0]["start_ms"],
                    0.0
                );
                assert_eq!(assistance["coverage"]["human_target_count"], 1);
                assert_eq!(assistance["coverage"]["human_source_unit_count"], 2);
                assert_eq!(
                    assistance["human_targets"]["groups"][0]["source_note_ids"]
                        .as_array()
                        .unwrap()
                        .len(),
                    2
                );
            }
            layers.insert(layer.into(), json!({"response":response}));
        }
        let mut empty_selection = selection.clone();
        empty_selection["profile"] = json!({"kind":"piano","key_count":12,"lowest_midi":0});
        let empty = post(
            &library,
            GENERATE,
            &json!({"source":source,"selection":empty_selection,"layer":"single"}),
        );
        assert_eq!(empty["checked"]["assistance"]["scored_mode_allowed"], false);
        assert_eq!(empty["checked"]["layers"][1]["equals_previous_layer"], true);
        recheck(&library, &empty);
        let narrow = if suffix == "vsq" {
            let mut narrow = selection.clone();
            narrow["selected_part_ids"] = json!([parts(&files, profile)[0]]);
            let response = post(
                &library,
                GENERATE,
                &json!({"source":source,"selection":narrow,"layer":"dense"}),
            );
            assert_eq!(
                response["checked"]["assistance"]["coverage"]["human_target_count"],
                0
            );
            assert_eq!(
                response["checked"]["assistance"]["coverage"]["machine_occurrence_count"],
                2
            );
            let reasons = response["checked"]["assistance"]["exclusion_reasons"]
                .as_array()
                .unwrap();
            assert_eq!(reasons.len(), 1);
            assert_eq!(reasons[0]["code"], "cross_scope_physical_group");
            assert_eq!(reasons[0]["source_ids"].as_array().unwrap().len(), 2);
            recheck(&library, &response);
            response
        } else {
            Value::Null
        };
        assert_export(&library, &source, &files);
        assert_eq!(sandbox.bytes(), before);
        drop(library);
        let reopened = sandbox.library();
        for response in layers.values() {
            recheck(&reopened, &response["response"]);
        }
        assert_eq!(sandbox.bytes(), before);
        write_fixture(
            &format!("progression-native-{suffix}.json"),
            &json!({
                "source_fixture":format!("assistance-native-{suffix}.json"),"source":source,"selection":selection,"layers":layers,"empty":empty,"narrow_scope":narrow
            }),
        );
    }
}

#[test]
fn native_routes_reject_stale_proofs_source_substitution_and_untrusted_hierarchy_inputs() {
    let sandbox = Sandbox::new();
    let library = sandbox.library();
    for (files, profile) in [
        (basic_files(), score_core::basic_keys::PROFILE),
        (vsq_files(), score_core::vsq_clean::PROFILE),
    ] {
        let source = save(&library, &files, profile);
        let input = json!({"source":source,"selection":selection(&parts(&files, profile)),"layer":"single"});
        let response = post(&library, GENERATE, &input);
        let valid = json!({"source":source,"plan":response["checked"]["plan"]});
        let before = sandbox.bytes();
        for (field, value) in [
            ("format", json!("wmc-practice-assistance")),
            ("schema_version", json!(999)),
            ("planner_revision", json!(999)),
            ("revision", json!(0)),
            ("algorithm_id", json!("wmc-keyboard-assistance-v1")),
            ("scheme_id", json!("future")),
            ("layer", json!("dense")),
            ("selection_digest", json!("0".repeat(64))),
            ("scheme_digest", json!("0".repeat(64))),
            ("hierarchy_digest", json!("0".repeat(64))),
            ("plan_digest", json!("0".repeat(64))),
        ] {
            let mut mutated = valid.clone();
            mutated["plan"][field] = value;
            reject(&library, VALIDATE, &mutated, 422);
        }
        for field in [
            "runtime_digest",
            "saved_package_sha256",
            "source_profile",
            "runtime_policy",
        ] {
            let mut mutated = valid.clone();
            mutated["plan"]["receipt"][field] = json!("0".repeat(64));
            reject(&library, VALIDATE, &mutated, 422);
        }
        for (path, request) in [(GENERATE, input), (VALIDATE, valid)] {
            for field in [
                "key",
                "content_sha256",
                "profile",
                "choice",
                "runtime_policy",
            ] {
                let mut missing = request.clone();
                missing["source"].as_object_mut().unwrap().remove(field);
                reject(&library, path, &missing, 400);
            }
            for (field, value) in [
                ("key", json!("song-invalid")),
                ("content_sha256", json!("0".repeat(64))),
                ("profile", json!("untrusted-profile")),
                ("runtime_policy", json!("untrusted-policy")),
            ] {
                let mut wrong = request.clone();
                wrong["source"][field] = value;
                reject(&library, path, &wrong, 422);
            }
            let mut wrong = request.clone();
            wrong["source"]["choice"] = if source["choice"].is_null() {
                json!("base_notes_instrumental")
            } else {
                Value::Null
            };
            reject(&library, path, &wrong, 422);
            for field in [
                "score",
                "score_json",
                "timeline",
                "runtime",
                "compilation",
                "checked",
                "assistance",
                "hierarchy",
                "layers",
                "human_source_ids",
                "eligible_source_ids",
            ] {
                for level in ["root", "source"] {
                    let mut injected = request.clone();
                    if level == "root" {
                        injected[field] = json!([]);
                    } else {
                        injected[level][field] = json!([]);
                    }
                    reject(&library, path, &injected, 400);
                }
            }
        }
        assert_eq!(sandbox.bytes(), before);
    }
}

#[test]
fn native_revalidation_reloads_exact_primary_and_backup_package_bytes() {
    for area in ["clean-songs", "clean-backups"] {
        let sandbox = Sandbox::new();
        let library = sandbox.library();
        let files = basic_files();
        let source = save(&library, &files, score_core::basic_keys::PROFILE);
        let response = post(
            &library,
            GENERATE,
            &json!({"source":source,"selection":selection(&parts(&files, score_core::basic_keys::PROFILE)),"layer":"single"}),
        );
        let path = sandbox
            .0
            .join("Scores")
            .join(area)
            .join(source["key"].as_str().unwrap())
            .join("package/score.json");
        let mut damaged = fs::read(&path).unwrap();
        damaged.extend_from_slice(b"\n ");
        fs::write(&path, &damaged).unwrap();
        let before = sandbox.bytes();
        reject(
            &library,
            VALIDATE,
            &json!({"source":source,"plan":response["checked"]["plan"]}),
            422,
        );
        assert_eq!(sandbox.bytes(), before);
        assert_eq!(fs::read(path).unwrap(), damaged);
    }
}

#[test]
fn progression_routes_use_large_operation_post_only_and_bounded_admission() {
    let sandbox = Sandbox::new();
    let library = sandbox.library();
    for path in [GENERATE, VALIDATE] {
        assert!(worldmusichub_desktop::song_pack::is_large_operation(path));
        assert_eq!(
            worldmusichub_desktop::song_pack::request_limit(path),
            worldmusichub_desktop::MAX_BODY
        );
        let response = request(
            &library,
            path,
            vec![b' '; worldmusichub_desktop::MAX_BODY + 1],
        );
        assert_eq!(response.status(), 413);
        assert_eq!(
            serde_json::from_slice::<Value>(response.body()).unwrap()["code"],
            "library_request_limit"
        );
    }
    for path in [
        GENERATE,
        VALIDATE,
        "/api/practice-progression/generate",
        "/api/practice-progression/validate",
    ] {
        let response = dispatch_with_library(
            Request::builder()
                .method("GET")
                .uri(format!("{ORIGIN}{path}"))
                .body(Vec::new())
                .unwrap(),
            &library,
        );
        assert_eq!(response.status(), 405);
        assert!(
            serde_json::from_slice::<Value>(response.body()).unwrap()["code"]
                .as_str()
                .unwrap()
                .ends_with("method_not_allowed")
        );
    }
}

#[test]
fn canonical_progression_bytes_are_shared_by_stateless_and_native_dispatchers() {
    let sandbox = Sandbox::new();
    let library = sandbox.library();
    let score = score_core::catalog().remove(0);
    let input = json!({"score":score,"selection":selection(&score.parts.iter().map(|part| part.id.clone()).collect::<Vec<_>>()),"layer":"balanced"});
    let path = "/api/practice-progression/generate";
    let bytes = serde_json::to_vec(&input).unwrap();
    let canonical = practice_server::api_response(path, bytes.clone());
    let native = request(&library, path, bytes);
    assert_eq!(canonical.status, 200);
    assert_eq!(native.status(), canonical.status);
    assert_eq!(native.body(), &canonical.body);
    let checked: Value = serde_json::from_slice(&canonical.body).unwrap();
    let path = "/api/practice-progression/validate";
    let bytes =
        serde_json::to_vec(&json!({"score":score,"plan":checked["checked"]["plan"]})).unwrap();
    let native = request(&library, path, bytes.clone());
    assert_eq!(native.status(), 200);
    assert_eq!(
        native.body(),
        &practice_server::api_response(path, bytes).body
    );
    assert_eq!(native.body(), &canonical.body);
}
