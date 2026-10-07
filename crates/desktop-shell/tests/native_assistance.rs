//! Original public source exercises, through the socket-free native dispatcher.
//! Selection is a sidecar: neither source bytes nor interpreted gates may change.
use http::Request;
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::{
    collections::{BTreeMap, BTreeSet},
    fs,
    io::{Cursor, Read},
    path::{Path, PathBuf},
    sync::atomic::{AtomicU64, Ordering},
};
use worldmusichub_desktop::{
    dispatch_with_library,
    native_library::{NativeLibrary, SaveRequest},
    ORIGIN,
};

static SEQUENCE: AtomicU64 = AtomicU64::new(0);
const ORIGINAL: &str = "/api/library/assistance/original";
const GENERATE: &str = "/api/library/assistance/generate";
const CREATE: &str = "/api/library/assistance/create";
const VALIDATE: &str = "/api/library/assistance/validate";

struct Sandbox(PathBuf);
impl Sandbox {
    fn new() -> Self {
        let path = std::env::temp_dir().join(format!(
            "wmh-native-assistance-{}-{}",
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
    assert!(
        error["code"].as_str().is_some_and(|code| !code.is_empty()),
        "{error}"
    );
}

fn basic_files() -> BTreeMap<String, Vec<u8>> {
    // Two overlapping C4 attacks, with FIFO releases at 250 and 500 ms;
    // a chord, zero-duration attack, percussion and controls are retained.
    let track = vec![
        0, 0xc0, 42, 0, 0xb0, 74, 91, 0, 0x90, 60, 90, 24, 0x90, 60, 80, 24, 0x80, 60, 0, 48, 0x80,
        60, 0, 0, 0x90, 64, 90, 0, 0x90, 67, 90, 48, 0x80, 64, 0, 0, 0x80, 67, 0, 0, 0x90, 72, 90,
        0, 0x80, 72, 0, 0, 0x99, 35, 100, 24, 0x89, 35, 0, 0, 0xb0, 123, 0, 24, 255, 47, 0,
    ];
    let mut midi = b"MThd\0\0\0\x06\0\x00\0\x01\0\x60MTrk".to_vec();
    midi.extend((track.len() as u32).to_be_bytes());
    midi.extend(track);
    let score =
        score_core::basic_keys::convert_midi(&midi, "Original assistance FIFO exercise").unwrap();
    let mut bytes = score_core::basic_keys::encode_json(&score).unwrap();
    bytes.extend(b"\n \t\n");
    let metadata = json!({"format":"worldmusichub-song","version":2,"id":score.notation.id,"title":score.notation.title,
        "score":{"path":"score.json","bytes":bytes.len(),"sha256":format!("{:x}",Sha256::digest(&bytes))},
        "sources":[score.source],"rights":{"status":"original_authored","attribution":"Original isolated keys for assistance regression","license":"CC0-1.0"},"media":[]});
    BTreeMap::from([
        ("score.json".into(), bytes),
        (
            "metadata.json".into(),
            serde_json::to_vec(&metadata).unwrap(),
        ),
    ])
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

fn semantic_files() -> BTreeMap<String, Vec<u8>> {
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

fn settings() -> Value {
    json!({"algorithm_id":"wmc-keyboard-assistance-v1","max_targets_per_onset":1,
        "min_onset_interval_ms":100,"max_simultaneous_keys":2,"max_held_span_semitones":7})
}

fn assert_round_trip(library: &NativeLibrary, response: &Value) {
    let rechecked = post(
        library,
        VALIDATE,
        &json!({"source":response["source"],"plan":response["checked"]["plan"]}),
    );
    assert_eq!(&rechecked, response);
    assert_eq!(
        response["checked"]["receipt"],
        response["checked"]["plan"]["receipt"]
    );
    assert_eq!(
        response["checked"]["receipt"]["saved_package_sha256"],
        response["source"]["content_sha256"]
    );
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

fn fixture(name: &str, value: &Value) {
    let path = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../../tests/fixtures")
        .join(name);
    if std::env::var_os("WMH_UPDATE_ASSISTANCE_FIXTURES").is_some() {
        fs::write(&path, serde_json::to_vec_pretty(value).unwrap()).unwrap();
    }
    assert_eq!(
        serde_json::from_slice::<Value>(&fs::read(path).unwrap()).unwrap(),
        *value
    );
}

#[test]
fn basic_partial_human_keeps_second_fifo_release_and_complete_source() {
    let sandbox = Sandbox::new();
    let library = sandbox.library();
    let files = basic_files();
    let source = save(&library, &files, score_core::basic_keys::PROFILE);
    let loaded = library.load(source["key"].as_str().unwrap()).unwrap();
    let package = loaded.clean_package.as_ref().unwrap();
    let score = score_core::basic_keys::decode_json(package.score_json.as_bytes()).unwrap();
    let compiled = score_core::basic_keys::compile_rendition(&score).unwrap();
    let parts: Vec<_> = score
        .performance
        .parts
        .iter()
        .map(|part| part.id.clone())
        .collect();
    let selection = selection(&parts);
    let before = sandbox.bytes();
    let original = post(
        &library,
        ORIGINAL,
        &json!({"source":source,"selection":selection}),
    );
    assert_round_trip(&library, &original);
    assert_eq!(
        original["checked"]["coverage"]["human_occurrence_count"],
        compiled.timeline.notes.len()
    );
    assert_eq!(original["checked"]["machine_occurrence_ids"], json!([]));
    let expected = score_core::targets::plan_targets(
        &compiled.timeline,
        &serde_json::from_value(selection["profile"].clone()).unwrap(),
    )
    .unwrap();
    assert_eq!(
        original["checked"]["human_targets"],
        serde_json::to_value(expected).unwrap()
    );
    let c4: Vec<_> = compiled
        .timeline
        .notes
        .iter()
        .filter(|note| note.midi == 60)
        .collect();
    assert_eq!(c4.len(), 2);
    assert_eq!((c4[0].start_ms, c4[0].duration_ms), (0.0, 250.0));
    assert_eq!((c4[1].start_ms, c4[1].duration_ms), (125.0, 375.0));
    let explicit = post(
        &library,
        CREATE,
        &json!({"source":source,"selection":selection,"human_source_ids":[c4[0].id]}),
    );
    assert_round_trip(&library, &explicit);
    assert_eq!(
        explicit["checked"]["human_targets"]["timeline"]["notes"][0]["id"],
        c4[0].id
    );
    let machine_ids = explicit["checked"]["machine_occurrence_ids"]
        .as_array()
        .unwrap();
    let machine: Vec<_> = compiled
        .rendition
        .notes
        .iter()
        .filter(|note| machine_ids.contains(&json!(note.note_id)))
        .collect();
    let second = machine
        .iter()
        .find(|note| note.note_id == c4[1].id)
        .unwrap();
    assert_eq!(second.end.numerator, "500000");
    assert_eq!(second.end.denominator, 1);
    assert!(matches!(
        second.end_reason,
        score_core::basic_keys::RenditionEndReason::FifoRelease
    ));
    assert_eq!(
        explicit["checked"]["coverage"]["machine_occurrence_count"],
        compiled.timeline.notes.len() - 1
    );
    assert_eq!(
        explicit["checked"]["human_targets"]["timeline"]["duration_ms"],
        compiled.timeline.duration_ms
    );
    let automatic = post(
        &library,
        GENERATE,
        &json!({"source":source,"selection":selection,"settings":settings()}),
    );
    assert_round_trip(&library, &automatic);
    assert_eq!(
        automatic,
        post(
            &library,
            GENERATE,
            &json!({"source":source,"selection":selection,"settings":settings()})
        )
    );
    let synthetic = compiled
        .rendition
        .notes
        .iter()
        .find(|note| note.synthetic_gate)
        .unwrap();
    assert!(automatic["checked"]["source_ownership"]
        .as_array()
        .unwrap()
        .iter()
        .any(|item| item["source_id"] == synthetic.note_id));
    let percussion = compiled
        .rendition
        .notes
        .iter()
        .find(|note| {
            matches!(
                note.role,
                score_core::basic_keys::RenditionRole::PercussionSelector
            )
        })
        .unwrap();
    assert!(automatic["checked"]["machine_occurrence_ids"]
        .as_array()
        .unwrap()
        .contains(&json!(percussion.note_id)));
    fixture(
        "assistance-native-basic.json",
        &json!({"source":source,"opened":{"score_json":loaded.score_json,"clean_package":package},"original":original,"explicit":explicit,"automatic":automatic}),
    );
    assert_export(&library, &source, &files);
    assert_eq!(sandbox.bytes(), before);
    drop(library);
    assert_round_trip(&sandbox.library(), &automatic);
}

#[test]
fn explicit_vsq_keeps_zero_origin_and_atomic_source_unison_on_reopen() {
    let sandbox = Sandbox::new();
    let library = sandbox.library();
    let files = vsq_files();
    let source = save(&library, &files, score_core::vsq_clean::PROFILE);
    let score = score_core::vsq_clean::decode_json(&files["score.json"]).unwrap();
    let selected = post(
        &library,
        "/api/library/runtime",
        &json!({"key":source["key"],"profile":source["profile"],"choice":source["choice"]}),
    );
    assert_eq!(
        selected["compilation"]["timeline"]["notes"][0]["start_ms"],
        0.0
    );
    assert_eq!(
        score_core::compile(score.notation.clone())
            .unwrap()
            .timeline
            .notes[0]
            .start_ms,
        2000.0
    );
    let parts: Vec<_> = score
        .notation
        .parts
        .iter()
        .map(|part| part.id.clone())
        .collect();
    let selection = selection(&parts);
    let before = sandbox.bytes();
    let original = post(
        &library,
        ORIGINAL,
        &json!({"source":source,"selection":selection}),
    );
    let automatic = post(
        &library,
        GENERATE,
        &json!({"source":source,"selection":selection,"settings":settings()}),
    );
    for response in [&original, &automatic] {
        assert_round_trip(&library, response);
        assert_eq!(
            response["checked"]["human_targets"]["timeline"]["notes"][0]["start_ms"],
            0.0
        );
        assert_eq!(response["checked"]["coverage"]["human_target_count"], 1);
        assert_eq!(
            response["checked"]["coverage"]["human_source_unit_count"],
            2
        );
        assert_eq!(
            response["checked"]["human_targets"]["groups"][0]["source_note_ids"]
                .as_array()
                .unwrap()
                .len(),
            2
        );
    }
    let one_source = original["checked"]["plan"]["human_source_ids"][0].clone();
    reject(
        &library,
        CREATE,
        &json!({"source":source,"selection":selection,"human_source_ids":[one_source]}),
        422,
    );
    // The physical unison remains atomic even when a Mod part scope would
    // otherwise put one authored source on each side of the human boundary.
    let mut narrow_selection = selection.clone();
    narrow_selection["selected_part_ids"] = json!([parts[0]]);
    reject(
        &library,
        ORIGINAL,
        &json!({"source":source,"selection":narrow_selection}),
        422,
    );
    let narrow = post(
        &library,
        GENERATE,
        &json!({"source":source,"selection":narrow_selection,"settings":settings()}),
    );
    assert_round_trip(&library, &narrow);
    assert_eq!(narrow["checked"]["coverage"]["human_occurrence_count"], 0);
    assert_eq!(narrow["checked"]["coverage"]["machine_occurrence_count"], 2);
    assert!(narrow["checked"]["exclusion_reasons"]
        .as_array()
        .unwrap()
        .iter()
        .any(|reason| reason["code"] == "cross_scope_physical_group"));
    reject(
        &library,
        CREATE,
        &json!({"source":source,"selection":narrow_selection,"human_source_ids":[one_source]}),
        422,
    );
    let empty = post(
        &library,
        CREATE,
        &json!({"source":source,"selection":selection,"human_source_ids":[]}),
    );
    assert_round_trip(&library, &empty);
    assert_eq!(empty["checked"]["scored_mode_allowed"], false);
    assert_eq!(empty["checked"]["coverage"]["machine_occurrence_count"], 2);
    fixture(
        "assistance-native-vsq.json",
        &json!({"source":source,"selected_runtime":selected,"original":original,"automatic":automatic,"empty":empty,"narrow_scope":narrow}),
    );
    assert_export(&library, &source, &files);
    assert_eq!(sandbox.bytes(), before);
    drop(library);
    assert_round_trip(&sandbox.library(), &automatic);
}

#[test]
fn saved_semantic_and_canonical_sources_have_distinct_admission_and_v1_parity() {
    let sandbox = Sandbox::new();
    let library = sandbox.library();
    let source = save(&library, &semantic_files(), score_core::clean_song::PROFILE);
    let loaded = library.load(source["key"].as_str().unwrap()).unwrap();
    let score_json = loaded.score_json.unwrap();
    let score: score_core::Score = serde_json::from_str(&score_json).unwrap();
    let selection = selection(
        &score
            .parts
            .iter()
            .map(|part| part.id.clone())
            .collect::<Vec<_>>(),
    );
    let native = post(
        &library,
        ORIGINAL,
        &json!({"source":source,"selection":selection}),
    );
    assert_round_trip(&library, &native);
    let entry = library
        .save(SaveRequest {
            score_json,
            label: None,
            allow_conflicting_id: true,
        })
        .unwrap();
    let mut canonical = json!({"key":entry.key,"content_sha256":entry.content_sha256,"profile":"wmc-canonical-score-v1","choice":null,"runtime_policy":"wmc-canonical-practice-v1"});
    let original = post(
        &library,
        ORIGINAL,
        &json!({"source":canonical,"selection":selection}),
    );
    assert_round_trip(&library, &original);
    let stateless_request =
        serde_json::to_vec(&json!({"score":score,"selection":selection})).unwrap();
    let stateless_path = "/api/practice-assistance/original";
    let shared = practice_server::api_response(stateless_path, stateless_request.clone());
    let native_stateless = request(&library, stateless_path, stateless_request);
    assert_eq!(native_stateless.status(), shared.status);
    assert_eq!(native_stateless.body(), &shared.body);
    let stateless: Value = serde_json::from_slice(native_stateless.body()).unwrap();
    assert_eq!(stateless["source"]["kind"], "canonical");
    assert_eq!(
        stateless["checked"]["receipt"]["saved_package_sha256"],
        Value::Null
    );
    assert_eq!(
        stateless["checked"]["human_targets"],
        original["checked"]["human_targets"]
    );
    let legacy = post(
        &library,
        "/api/assistance/create",
        &json!({"score":score,"selected_part_ids":selection["selected_part_ids"],"profile":selection["profile"],"human_source_note_ids":original["checked"]["plan"]["human_source_ids"]}),
    );
    assert_eq!(
        legacy["human_targets"],
        original["checked"]["human_targets"]
    );
    canonical["profile"] = source["profile"].clone();
    canonical["runtime_policy"] = source["runtime_policy"].clone();
    reject(
        &library,
        ORIGINAL,
        &json!({"source":canonical,"selection":selection}),
        422,
    );
}

#[test]
fn every_route_rejects_source_runtime_injection_and_stale_bindings() {
    let sandbox = Sandbox::new();
    let library = sandbox.library();
    for (files, profile) in [
        (basic_files(), score_core::basic_keys::PROFILE),
        (vsq_files(), score_core::vsq_clean::PROFILE),
    ] {
        let source = save(&library, &files, profile);
        let parts = if profile == score_core::basic_keys::PROFILE {
            score_core::basic_keys::decode_json(&files["score.json"])
                .unwrap()
                .performance
                .parts
                .into_iter()
                .map(|part| part.id)
                .collect::<Vec<_>>()
        } else {
            score_core::vsq_clean::decode_json(&files["score.json"])
                .unwrap()
                .notation
                .parts
                .into_iter()
                .map(|part| part.id)
                .collect()
        };
        let selection = selection(&parts);
        let original = post(
            &library,
            ORIGINAL,
            &json!({"source":source,"selection":selection}),
        );
        let requests = [
            (ORIGINAL, json!({"source":source,"selection":selection})),
            (
                GENERATE,
                json!({"source":source,"selection":selection,"settings":settings()}),
            ),
            (
                CREATE,
                json!({"source":source,"selection":selection,"human_source_ids":[]}),
            ),
            (
                VALIDATE,
                json!({"source":source,"plan":original["checked"]["plan"]}),
            ),
        ];
        let before = sandbox.bytes();
        for (path, valid) in requests {
            for field in [
                "key",
                "content_sha256",
                "profile",
                "choice",
                "runtime_policy",
            ] {
                let mut body = valid.clone();
                body["source"].as_object_mut().unwrap().remove(field);
                reject(&library, path, &body, 400);
            }
            for (field, value) in [
                ("content_sha256", json!("0".repeat(64))),
                ("profile", json!("wrong-profile")),
                ("runtime_policy", json!("wrong-policy")),
                ("key", json!("song-invalid")),
            ] {
                let mut body = valid.clone();
                body["source"][field] = value;
                reject(&library, path, &body, 422);
            }
            let mut body = valid.clone();
            body["source"]["choice"] = if source["choice"].is_null() {
                json!("base_notes_instrumental")
            } else {
                Value::Null
            };
            reject(&library, path, &body, 422);
            for field in [
                "score",
                "score_json",
                "timeline",
                "runtime",
                "compilation",
                "checked",
            ] {
                for level in ["root", "source"] {
                    let mut body = valid.clone();
                    if level == "root" {
                        body[field] = json!({"notes":[]});
                    } else {
                        body[level][field] = json!({"notes":[]});
                    }
                    reject(&library, path, &body, 400);
                }
            }
        }
        for ids in [
            json!(["unknown-id"]),
            json!([
                original["checked"]["plan"]["human_source_ids"][0],
                original["checked"]["plan"]["human_source_ids"][0]
            ]),
        ] {
            reject(
                &library,
                CREATE,
                &json!({"source":source,"selection":selection,"human_source_ids":ids}),
                422,
            );
        }
        let mut bad_selection = selection.clone();
        bad_selection["selected_part_ids"] = json!(["unknown-part"]);
        reject(
            &library,
            ORIGINAL,
            &json!({"source":source,"selection":bad_selection}),
            422,
        );
        let mut stale = settings();
        stale["algorithm_id"] = json!("wmc-keyboard-assistance-v999");
        reject(
            &library,
            GENERATE,
            &json!({"source":source,"selection":selection,"settings":stale}),
            422,
        );
        for (field, value) in [
            ("revision", json!(0)),
            ("planner_revision", json!(999)),
            ("schema_version", json!(999)),
            ("selection_digest", json!("0".repeat(64))),
            ("human_source_ids", json!(["unknown-id"])),
        ] {
            let mut plan = original["checked"]["plan"].clone();
            plan[field] = value;
            reject(
                &library,
                VALIDATE,
                &json!({"source":source,"plan":plan}),
                422,
            );
        }
        for field in ["runtime_digest", "saved_package_sha256"] {
            let mut plan = original["checked"]["plan"].clone();
            plan["receipt"][field] = json!("0".repeat(64));
            reject(
                &library,
                VALIDATE,
                &json!({"source":source,"plan":plan}),
                422,
            );
        }
        for level in ["selection", "settings", "profile"] {
            let mut body = json!({"source":source,"selection":selection,"settings":settings()});
            if level == "profile" {
                body["selection"]["profile"]["timeline"] = json!({});
            } else {
                body[level]["timeline"] = json!({});
            }
            reject(&library, GENERATE, &body, 400);
        }
        assert_eq!(sandbox.bytes(), before);
    }
}

#[test]
fn revalidation_rechecks_primary_and_backup_without_repairing_source_corruption() {
    for area in ["clean-songs", "clean-backups"] {
        let sandbox = Sandbox::new();
        let library = sandbox.library();
        let files = basic_files();
        let source = save(&library, &files, score_core::basic_keys::PROFILE);
        let score = score_core::basic_keys::decode_json(&files["score.json"]).unwrap();
        let selection = selection(
            &score
                .performance
                .parts
                .into_iter()
                .map(|part| part.id)
                .collect::<Vec<_>>(),
        );
        let checked = post(
            &library,
            GENERATE,
            &json!({"source":source,"selection":selection,"settings":settings()}),
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
            &json!({"source":source,"plan":checked["checked"]["plan"]}),
            422,
        );
        assert_eq!(sandbox.bytes(), before);
        assert_eq!(fs::read(path).unwrap(), damaged);
    }
}

#[test]
fn new_routes_use_large_operation_admission_post_only_and_existing_budgets() {
    let sandbox = Sandbox::new();
    let library = sandbox.library();
    let routes: BTreeSet<_> = [ORIGINAL, GENERATE, CREATE, VALIDATE].into_iter().collect();
    for path in routes {
        assert!(worldmusichub_desktop::song_pack::is_large_operation(path));
        assert_eq!(
            worldmusichub_desktop::song_pack::request_limit(path),
            worldmusichub_desktop::MAX_BODY
        );
        let response = dispatch_with_library(
            Request::builder()
                .method("GET")
                .uri(format!("{ORIGIN}{path}"))
                .body(Vec::new())
                .unwrap(),
            &library,
        );
        assert_eq!(response.status(), 405);
        assert_eq!(
            serde_json::from_slice::<Value>(response.body()).unwrap()["code"],
            "library_method_not_allowed"
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
    for suffix in ["original", "generate", "create", "validate"] {
        let path = format!("/api/practice-assistance/{suffix}");
        let response = dispatch_with_library(
            Request::builder()
                .method("GET")
                .uri(format!("{ORIGIN}{path}"))
                .body(Vec::new())
                .unwrap(),
            &library,
        );
        assert_eq!(response.status(), 405);
        assert_eq!(
            serde_json::from_slice::<Value>(response.body()).unwrap()["code"],
            "method_not_allowed"
        );
    }
}
