//! Original mechanical CC0-1.0 fixtures only. These exercise the production
//! native dispatcher, immutable package reload, original attack gate and wire.
#[path = "support/pitch_mod_fixture.rs"]
mod fixture;
use fixture::*;
use http::Request;
use serde_json::{json, Value};
use std::collections::BTreeMap;
use worldmusichub_desktop::{dispatch_with_library, native_library::NativeLibrary, ORIGIN};

const ADMIT: &str = "/api/library/practice-admission";
const ORIGINAL: &str = "/api/library/assistance/original";
const GENERATE: &str = "/api/library/assistance/generate";
const CREATE: &str = "/api/library/assistance/create";
const VALIDATE: &str = "/api/library/assistance/validate";

fn mixed_files() -> BTreeMap<String, Vec<u8>> {
    let events = [
        0, 240, 5, 126, 127, 9, 1, 247,
        0, 192, 40, 0, 144, 60, 80, 96, 128, 60, 0,
        0, 192, 0, 0, 144, 62, 80, 96, 128, 62, 0,
        0, 192, 1, 0, 144, 64, 80, 96, 128, 64, 0,
        0, 255, 47, 0,
    ];
    files_for_events(&events, "Original CC0 admission program epochs")
}
fn files_for_events(events: &[u8], title: &str) -> BTreeMap<String, Vec<u8>> {
    let mut midi = b"MThd\0\0\0\x06\0\0\0\x01\0\x60MTrk".to_vec();
    midi.extend((events.len() as u32).to_be_bytes());
    midi.extend(events);
    let score = score_core::basic_keys::convert_midi(&midi, title).unwrap();
    let mut bytes = score_core::basic_keys::encode_json(&score).unwrap();
    bytes.extend(b"\n \t\n"); // Persisted package and normalized wire are distinct domains.
    let metadata = json!({"format":"worldmusichub-song","version":2,"id":score.notation.id,"title":score.notation.title,
        "score":{"path":"score.json","bytes":bytes.len(),"sha256":hash(&bytes)},"sources":[score.source],
        "rights":{"status":"original_authored","attribution":"Original authored mechanical Human gate events; CC0-1.0","license":"CC0-1.0"},"media":[]});
    BTreeMap::from([
        ("score.json".into(), bytes),
        ("metadata.json".into(), serde_json::to_vec(&metadata).unwrap()),
    ])
}
fn selection_for(files: &BTreeMap<String, Vec<u8>>) -> Value {
    let score = score_core::basic_keys::decode_json(&files["score.json"]).unwrap();
    json!({"selected_part_ids":score.performance.parts.iter().map(|part| &part.id).collect::<Vec<_>>(),
        "profile":{"kind":"piano","key_count":88,"lowest_midi":21}})
}
fn settings() -> Value {
    json!({"algorithm_id":"wmc-keyboard-assistance-v1","max_targets_per_onset":32,
        "min_onset_interval_ms":0,"max_simultaneous_keys":32,"max_held_span_semitones":127})
}
fn rejected(library: &NativeLibrary, path: &str, body: &Value, status: u16) -> Value {
    let response = request(library, path, body);
    assert_eq!(response.status().as_u16(), status, "{}", String::from_utf8_lossy(response.body()));
    let error: Value = serde_json::from_slice(response.body()).unwrap();
    assert!(error.get("checked").is_none());
    error
}

#[test]
fn original_is_rejected_but_full_reference_and_original_package_remain_available() {
    let sandbox = Sandbox::new();
    let library = sandbox.library();
    let files = mixed_files();
    let source = save(&library, &files, score_core::basic_keys::PROFILE);
    let selection = selection_for(&files);
    let before = sandbox.bytes();
    let loaded = library.load(source["key"].as_str().unwrap()).unwrap();
    let package = loaded.clean_package.unwrap();
    assert_eq!(package.score_json.as_bytes(), files["score.json"]);
    assert_eq!(package.metadata_json.as_bytes(), files["metadata.json"]);
    let runtime = &package.runtime;
    assert_eq!(runtime["reference_audio"], "basic_synthesized");
    assert_eq!(runtime["compilation"]["timeline"]["notes"].as_array().unwrap().len(), 3);
    assert_eq!(runtime["rendition"]["notes"].as_array().unwrap().len(), 3);
    let summary = &runtime["source_eligibility"];
    assert_eq!(summary["status"], "available");
    assert_eq!(summary["complete_attack_count"], 3);
    assert_eq!(summary["known_unsupported_count"], 1);
    assert_eq!(summary["unresolved_count"], 1);
    assert!(summary.get("known_unsupported_source_attack_ids").is_none());
    let body = json!({"source":source,"pitch_mod":configuration(0),"selection":selection});
    assert_eq!(rejected(&library, ADMIT, &body, 422)["code"], "practice_original_instrument_unsupported");
    rejected(&library, ORIGINAL, &json!({"source":source,"selection":selection}), 422);
    let automatic = post(&library, GENERATE, &json!({"source":source,"selection":selection,"settings":settings()}));
    let admitted = post(&library, ADMIT, &json!({"source":source,"pitch_mod":configuration(0),"selection":selection,"plan":automatic["checked"]["plan"]}));
    assert_eq!(admitted, automatic);
    assert_eq!(admitted["checked"]["coverage"]["human_source_unit_count"], 2);
    assert_eq!(admitted["checked"]["coverage"]["machine_source_unit_count"], 1);
    assert_eq!(admitted["checked"]["receipt"]["source_eligibility"], summary["receipt"]);
    assert_ne!(summary["receipt"]["source_binding"]["digest"], source["content_sha256"]);
    let decoded = score_core::basic_keys::decode_json(&files["score.json"]).unwrap();
    let unsupported = score_core::source_identity::analyze_basic_practice(&decoded).unwrap();
    rejected(&library, CREATE, &json!({"source":source,"selection":selection,"human_source_ids":unsupported.known_unsupported_source_attack_ids()}), 422);
    for layer in ["single", "balanced", "dense"] {
        let progression = post(&library, "/api/library/progression/generate", &json!({"source":source,"selection":selection,"layer":layer}));
        assert!(!progression["checked"]["assistance"]["plan"]["human_source_ids"].as_array().unwrap().contains(&json!(unsupported.known_unsupported_source_attack_ids()[0])));
    }
    assert_eq!(sandbox.bytes(), before);
}

#[test]
fn strict_admission_rejects_missing_forged_stale_receipts_and_caller_inventories() {
    let sandbox = Sandbox::new();
    let library = sandbox.library();
    let files = mixed_files();
    let source = save(&library, &files, score_core::basic_keys::PROFILE);
    let selection = selection_for(&files);
    let automatic = post(&library, GENERATE, &json!({"source":source,"selection":selection,"settings":settings()}));
    let valid = json!({"source":source,"pitch_mod":configuration(0),"selection":selection,"plan":automatic["checked"]["plan"]});
    post(&library, ADMIT, &valid);
    for field in ["source", "pitch_mod", "selection"] {
        let mut body = valid.clone();
        body.as_object_mut().unwrap().remove(field);
        rejected(&library, ADMIT, &body, 400);
    }
    for field in ["key", "content_sha256", "profile", "choice", "runtime_policy"] {
        let mut body = valid.clone();
        body["source"].as_object_mut().unwrap().remove(field);
        rejected(&library, ADMIT, &body, 400);
    }
    for field in ["timeline", "runtime", "source_eligibility", "excluded_ids", "human_source_ids", "score"] {
        let mut body = valid.clone();
        body[field] = json!([]);
        rejected(&library, ADMIT, &body, 400);
    }
    for field in ["analysis_policy_id", "identity_table_revision", "product_policy_id", "eligibility_policy_id", "source_profile", "fingerprint"] {
        let mut body = valid.clone();
        body["plan"]["receipt"]["source_eligibility"][field] = json!("forged");
        rejected(&library, ADMIT, &body, 422);
        rejected(&library, VALIDATE, &json!({"source":source,"plan":body["plan"]}), 422);
    }
    let mut missing = valid.clone();
    missing["plan"]["receipt"].as_object_mut().unwrap().remove("source_eligibility");
    rejected(&library, ADMIT, &missing, 422);
    let mut stale = valid.clone();
    stale["pitch_mod"] = configuration(2);
    rejected(&library, ADMIT, &stale, 422);
    let mut changed = valid.clone();
    changed["selection"]["profile"]["key_count"] = json!(61);
    rejected(&library, ADMIT, &changed, 422);
    changed = valid.clone();
    changed["selection"]["selected_part_ids"] = json!([]);
    rejected(&library, ADMIT, &changed, 422);
    changed = valid.clone();
    changed["source"]["profile"] = json!(score_core::practice_source::CANONICAL_PROFILE);
    rejected(&library, ADMIT, &changed, 422);
    changed = valid;
    changed["plan"]["receipt"]["source_eligibility"]["source_binding"]["digest"] = json!("0".repeat(64));
    rejected(&library, ADMIT, &changed, 422);
}

#[test]
fn unknown_sources_keep_original_targets_and_pitch_receipts_keep_original_evidence() {
    let sandbox = Sandbox::new();
    let library = sandbox.library();
    let files = basic_files(); // No GM assertion: program 42 stays unresolved.
    let source = save(&library, &files, score_core::basic_keys::PROFILE);
    let selection = selection_for(&files);
    let old = post(&library, ORIGINAL, &json!({"source":source,"selection":selection}));
    let admitted = post(&library, ADMIT, &json!({"source":source,"pitch_mod":configuration(0),"selection":selection}));
    assert_eq!(admitted["source"], old["source"]);
    for field in [
        "plan", "receipt", "human_targets", "machine_occurrence_ids", "source_ownership",
        "coverage", "exclusion_reasons", "all_selected_human", "scored_mode_allowed",
    ] {
        assert_eq!(admitted["checked"][field], old["checked"][field], "{field}");
    }
    let scoped_diagnostics = admitted["checked"]["diagnostics"].as_array().unwrap();
    let strict_diagnostics = old["checked"]["diagnostics"].as_array().unwrap();
    assert_eq!(scoped_diagnostics.last().unwrap()["code"], "practice_original_scope");
    assert_eq!(strict_diagnostics.last().unwrap()["code"], "assistance_scope_limits");
    assert_eq!(
        &scoped_diagnostics[..scoped_diagnostics.len() - 1],
        &strict_diagnostics[..strict_diagnostics.len() - 1]
    );
    assert_eq!(admitted["checked"]["all_selected_human"], true);
    let files = mixed_files();
    let source = save(&library, &files, score_core::basic_keys::PROFILE);
    let selection = selection_for(&files);
    let original = post(&library, PROJECT, &json!({"source":source,"configuration":configuration(0)}));
    for shift in [-12, 2, 12] {
        let projection = post(&library, PROJECT, &json!({"source":source,"configuration":configuration(shift)}));
        assert_eq!(projection["receipt"]["source_eligibility"], original["receipt"]["source_eligibility"]);
        rejected(&library, ADMIT, &json!({"source":source,"pitch_mod":configuration(shift),"selection":selection}), 422);
        let checked = post(&library, GENERATE, &json!({"source":source,"pitch_mod":configuration(shift),"selection":selection,"settings":settings()}));
        let admitted = post(&library, ADMIT, &json!({"source":source,"pitch_mod":configuration(shift),"selection":selection,"plan":checked["checked"]["plan"]}));
        assert_eq!(admitted, checked);
    }
}

#[test]
fn route_reloads_saved_bytes_and_preserves_transport_guards() {
    assert!(worldmusichub_desktop::song_pack::is_large_operation(ADMIT));
    let sandbox = Sandbox::new();
    let library = sandbox.library();
    let files = basic_files();
    let source = save(&library, &files, score_core::basic_keys::PROFILE);
    let body = json!({"source":source,"pitch_mod":configuration(0),"selection":selection_for(&files)});
    post(&library, ADMIT, &body);
    for (method, content_type, status) in [("GET", "application/json", 405), ("POST", "text/plain", 415)] {
        let response = dispatch_with_library(Request::builder().method(method).uri(format!("{ORIGIN}{ADMIT}"))
            .header("content-type", content_type)
            .body(if method == "GET" { vec![] } else { serde_json::to_vec(&body).unwrap() }).unwrap(), &library);
        assert_eq!(response.status().as_u16(), status);
    }
    for area in ["clean-songs", "clean-backups"] {
        let path = sandbox.0.join("Scores").join(area).join(source["key"].as_str().unwrap()).join("package/score.json");
        let original = std::fs::read(&path).unwrap();
        let mut damaged = original.clone();
        damaged.extend_from_slice(b"\n ");
        std::fs::write(&path, damaged).unwrap();
        rejected(&library, ADMIT, &body, 422);
        std::fs::write(&path, original).unwrap();
        post(&library, ADMIT, &body);
    }
}

#[test]
fn single_complete_solo_native_admission_is_200_without_rewriting_its_source() {
    let files = BTreeMap::from([
        ("score.json".into(), include_bytes!("../../../tests/fixtures/complete-practice-acceptance/score.json").to_vec()),
        ("metadata.json".into(), include_bytes!("../../../tests/fixtures/complete-practice-acceptance/metadata.json").to_vec()),
    ]);
    let sandbox = Sandbox::new();
    let library = sandbox.library();
    let source = save(&library, &files, score_core::basic_keys::PROFILE);
    let before = sandbox.bytes();
    let selection = json!({"selected_part_ids":["midi-t1-c1-r0"],"profile":{"kind":"piano","key_count":88,"lowest_midi":21}});
    let request = json!({"source":source,"pitch_mod":configuration(0),"selection":selection});
    let admitted = post(&library, ADMIT, &request);
    let checked = &admitted["checked"];
    assert_eq!(checked["plan"]["human_source_ids"], json!(["midi-t1-e2", "midi-t1-e4"]));
    assert_eq!(checked["coverage"]["source_unit_count"], 6);
    assert_eq!(checked["coverage"]["human_source_unit_count"], 2);
    assert_eq!(checked["coverage"]["machine_source_unit_count"], 4);
    assert_eq!(checked["human_targets"]["target_count"], 2);
    assert_eq!(checked["human_targets"]["timeline"]["duration_ms"], 5000.0);
    assert_eq!(checked["scored_mode_allowed"], true);
    rejected(&library, ORIGINAL, &json!({"source":source,"selection":selection}), 422);
    rejected(&library, ADMIT, &json!({"source":source,"pitch_mod":configuration(0),"selection":selection,"plan":checked["plan"]}), 422);
    let loaded = library.load(source["key"].as_str().unwrap()).unwrap();
    let package = loaded.clean_package.unwrap();
    assert_eq!(package.score_json.as_bytes(), files["score.json"]);
    assert_eq!(package.metadata_json.as_bytes(), files["metadata.json"]);
    assert_eq!(post(&sandbox.library(), ADMIT, &request), admitted);
    assert_eq!(sandbox.bytes(), before);
}

#[test]
fn narrow_human_scope_can_share_a_key_with_unknown_or_unsupported_machine() {
    for (explicit_gm, human_program, machine_program) in
        [(false, 40, 0), (true, 0, 40), (true, 1, 40)]
    {
        let mut events = vec![];
        if explicit_gm {
            events.extend([0, 240, 5, 126, 127, 9, 1, 247]);
        }
        events.extend([
            0, 192, human_program, 0, 193, machine_program,
            0, 144, 60, 80, 0, 145, 60, 80,
            48, 128, 60, 0, 48, 129, 60, 0, 0, 255, 47, 0,
        ]);
        let files = files_for_events(&events, "Original CC0 selected-scope unison");
        let score = score_core::basic_keys::decode_json(&files["score.json"]).unwrap();
        let human = score.performance.parts.iter().find(|part| part.channel == 0).unwrap();
        let human_id = &score.performance.notes.iter().find(|note| note.part_id == human.id).unwrap().note_id;
        let machine_id = &score.performance.notes.iter().find(|note| note.part_id != human.id).unwrap().note_id;
        let sandbox = Sandbox::new();
        let library = sandbox.library();
        let source = save(&library, &files, score_core::basic_keys::PROFILE);
        let before = sandbox.bytes();
        let mut selection = selection_for(&files);
        selection["selected_part_ids"] = json!([human.id]);
        let admitted = post(&library, ADMIT, &json!({"source":source,"pitch_mod":configuration(0),"selection":selection}));
        assert_eq!(admitted["checked"]["plan"]["human_source_ids"], json!([human_id]));
        assert_eq!(admitted["checked"]["machine_occurrence_ids"], json!([machine_id]));
        assert_eq!(admitted["checked"]["all_selected_human"], true);
        assert_eq!(admitted["checked"]["scored_mode_allowed"], true);
        rejected(&library, ORIGINAL, &json!({"source":source,"selection":selection}), 422);
        rejected(&library, CREATE, &json!({"source":source,"selection":selection,"human_source_ids":[human_id]}), 422);
        rejected(&library, VALIDATE, &json!({"source":source,"plan":admitted["checked"]["plan"]}), 422);
        if explicit_gm {
            let all = selection_for(&files);
            let error = rejected(&library, ADMIT, &json!({"source":source,"pitch_mod":configuration(0),"selection":all}), 422);
            assert_eq!(error["code"], "practice_original_instrument_unsupported");
        }
        assert_eq!(sandbox.bytes(), before);
    }
}

#[test]
fn existing_authored_package_reloads_current_runtime_without_source_conversion() {
    // Saved package bytes are the existing public authoring fixture. Runtime
    // snapshots are disposable; the loader recomputes v2 and eligibility.
    let authored: Value = serde_json::from_str(include_str!("../../../tests/fixtures/song-authoring/basic-key-response.json")).unwrap();
    let files = BTreeMap::from([
        ("score.json".into(), authored["package"]["score_json"].as_str().unwrap().as_bytes().to_vec()),
        ("metadata.json".into(), authored["package"]["metadata_json"].as_str().unwrap().as_bytes().to_vec()),
    ]);
    let sandbox = Sandbox::new();
    let library = sandbox.library();
    let source = save(&library, &files, score_core::basic_keys::PROFILE);
    let before = sandbox.bytes();
    let loaded = sandbox.library().load(source["key"].as_str().unwrap()).unwrap();
    let package = loaded.clean_package.unwrap();
    assert_eq!(package.score_json.as_bytes(), files["score.json"]);
    assert_eq!(package.metadata_json.as_bytes(), files["metadata.json"]);
    assert_eq!(package.runtime["profile"], "wmh-basic-key-practice-v2");
    assert_eq!(package.runtime["source_eligibility"]["status"], "available");
    assert_eq!(package.runtime["source_eligibility"]["complete_attack_count"], 3);
    assert_eq!(package.runtime["source_sha256"], authored["source"]["sha256"]);
    let admitted = post(&library, ADMIT, &json!({"source":source,"pitch_mod":configuration(0),"selection":selection_for(&files)}));
    assert_eq!(admitted["checked"]["all_selected_human"], true);
    assert_eq!(admitted["checked"]["coverage"]["human_source_unit_count"], 3);
    assert_eq!(admitted["checked"]["receipt"]["source_eligibility"], package.runtime["source_eligibility"]["receipt"]);
    assert_eq!(sandbox.bytes(), before);
}

#[test]
fn canonical_admission_preserves_the_previous_strict_original_route() {
    let sandbox = Sandbox::new();
    let library = sandbox.library();
    let source = save_canonical(&library);
    let projected = post(&library, PROJECT, &json!({"source":source,"configuration":configuration(0)}));
    let selection = fixture::selection(&projected);
    let original = post(&library, ORIGINAL, &json!({"source":source,"selection":selection}));
    let admitted = post(&library, ADMIT, &json!({"source":source,"pitch_mod":configuration(0),"selection":selection}));
    assert_eq!(admitted, original);
    assert!(admitted["checked"]["receipt"].get("source_eligibility").is_none());
}
