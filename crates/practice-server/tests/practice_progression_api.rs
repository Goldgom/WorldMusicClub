//! Original mechanical keyboard vectors from the real socket-free handlers.
//! Regenerate with WMH_UPDATE_PROGRESSION_FIXTURES=1 cargo test -p practice-server
//! --test practice_progression_api; no private songs or generated checked DTOs.
mod support {
    pub mod song_contract;
}

use practice_server::{api_response, is_song_api_route, MAX_REQUEST_BYTES};
use serde_json::{json, Value};
use std::collections::BTreeSet;

const GENERATE: &str = "/api/practice-progression/generate";
const VALIDATE: &str = "/api/practice-progression/validate";

fn request() -> Value {
    let base = support::song_contract::create_request();
    let mut score = base["score"].clone();
    score["id"] = json!("original-progression-api-fixture");
    score["title"] = json!("Original progressive quarter-beat exercise");
    score["tempo"][0]["bpm"] = json!(120.0);
    let note = score["parts"][0]["notes"][0].clone();
    let mut notes = vec![];
    for index in 0..12 {
        let mut note = note.clone();
        note["id"] = json!(format!("step-{index:02}"));
        note["at"] = json!({"numerator":index,"denominator":4});
        note["duration"] = json!({"numerator":1,"denominator":4});
        note["pitch"]["step"] = json!(["C", "E", "G"][index % 3]);
        notes.push(note);
    }
    score["parts"][0]["notes"] = json!(notes);
    json!({"score":score,"selection":{"selected_part_ids":base["selected_part_ids"],"profile":base["profile"]},"layer":"single"})
}

fn bytes(path: &str, request: &Value) -> Vec<u8> {
    let response = api_response(path, serde_json::to_vec(request).unwrap());
    assert_eq!(
        response.status,
        200,
        "{path}: {}",
        String::from_utf8_lossy(&response.body)
    );
    response.body
}

fn body(path: &str, request: &Value) -> Value {
    serde_json::from_slice(&bytes(path, request)).unwrap()
}

fn reject(path: &str, request: &Value, status: u16) -> Value {
    let response = api_response(path, serde_json::to_vec(request).unwrap());
    assert_eq!(
        response.status,
        status,
        "{path}: {request}: {}",
        String::from_utf8_lossy(&response.body)
    );
    let error: Value = serde_json::from_slice(&response.body).unwrap();
    assert!(error["code"].as_str().is_some_and(|code| !code.is_empty()));
    assert!(error.get("checked").is_none());
    error
}

#[test]
fn canonical_layers_have_real_nested_targets_and_byte_exact_revalidation() {
    let mut request = request();
    let before = serde_json::to_vec(&request["score"]).unwrap();
    let compilation = body("/api/compile", &request["score"]);
    let mut layers = serde_json::Map::new();
    let mut previous = BTreeSet::new();
    let mut hierarchy = None;
    let mut summary = None;
    for (index, layer) in ["single", "balanced", "dense"].into_iter().enumerate() {
        request["layer"] = json!(layer);
        let encoded = bytes(GENERATE, &request);
        let response: Value = serde_json::from_slice(&encoded).unwrap();
        let checked = &response["checked"];
        let assistance = &checked["assistance"];
        assert_eq!(encoded, bytes(GENERATE, &request));
        assert_eq!(
            encoded,
            bytes(
                VALIDATE,
                &json!({"score":request["score"],"plan":checked["plan"]})
            )
        );
        assert_eq!(checked["plan"]["layer"], layer);
        assert_eq!(checked["plan"]["format"], "wmc-practice-progression");
        assert_eq!(
            checked["plan"]["algorithm_id"],
            "wmc-keyboard-progression-v1"
        );
        assert_eq!(checked["plan"]["receipt"], assistance["receipt"]);
        assert_eq!(assistance["plan"]["mode"], "explicit");
        assert_eq!(response["source"]["kind"], "canonical");
        assert_eq!(
            response["source"]["source_binding"],
            checked["plan"]["receipt"]["source_binding"]
        );
        assert_eq!(
            checked["plan"]["receipt"]["saved_package_sha256"],
            Value::Null
        );
        assert_eq!(checked.as_object().unwrap().len(), 3);
        assert_eq!(checked["layers"].as_array().unwrap().len(), 3);
        let ids: BTreeSet<_> = assistance["plan"]["human_source_ids"]
            .as_array()
            .unwrap()
            .iter()
            .map(|v| v.as_str().unwrap().to_owned())
            .collect();
        assert!(previous.is_subset(&ids));
        assert_eq!(ids.len(), [3, 6, 12][index]);
        assert_eq!(checked["layers"][index]["human_target_count"], ids.len());
        assert!(checked["layers"][index].get("human_source_ids").is_none());
        if let Some(previous) = &hierarchy {
            assert_eq!(&checked["plan"]["hierarchy_digest"], previous);
        }
        if let Some(previous) = &summary {
            assert_eq!(&checked["layers"], previous);
        }
        hierarchy = Some(checked["plan"]["hierarchy_digest"].clone());
        summary = Some(checked["layers"].clone());
        for target in assistance["human_targets"]["timeline"]["notes"]
            .as_array()
            .unwrap()
        {
            assert!(compilation["timeline"]["notes"]
                .as_array()
                .unwrap()
                .contains(target));
        }
        previous = ids;
        layers.insert(layer.into(), json!({"response":response}));
    }
    assert_eq!(serde_json::to_vec(&request["score"]).unwrap(), before);
    let original = body(
        "/api/practice-assistance/original",
        &json!({"score":request["score"],"selection":request["selection"]}),
    );
    let fixture = json!({"score":request["score"],"selection":request["selection"],"compilation":compilation,
        "audio_profile":body("/api/canonical-audio-profile", &request["score"]),"original":original,"layers":layers});
    let path = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../../tests/fixtures/progression-canonical.json");
    let encoded = serde_json::to_vec_pretty(&fixture).unwrap();
    if std::env::var_os("WMH_UPDATE_PROGRESSION_FIXTURES").is_some() {
        std::fs::write(&path, &encoded).unwrap();
    }
    assert_eq!(std::fs::read(path).unwrap(), encoded);
}

#[test]
fn canonical_validation_rejects_mutated_proofs_sources_and_injected_hierarchies() {
    let request = request();
    let response = body(GENERATE, &request);
    let valid = json!({"score":request["score"],"plan":response["checked"]["plan"]});
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
        reject(VALIDATE, &mutated, 422);
    }
    for field in [
        "runtime_digest",
        "saved_package_sha256",
        "source_profile",
        "runtime_policy",
    ] {
        let mut mutated = valid.clone();
        mutated["plan"]["receipt"][field] = json!("0".repeat(64));
        reject(VALIDATE, &mutated, 422);
    }
    let mut mutated = valid.clone();
    mutated["score"]["title"] = json!("Source changed");
    reject(VALIDATE, &mutated, 422);
    let mut mutated = valid.clone();
    mutated["score"]["tempo"][0]["bpm"] = json!(60);
    reject(VALIDATE, &mutated, 422);
    let mut mutated = valid.clone();
    mutated["plan"]["selection"]["selected_part_ids"] = json!([]);
    reject(VALIDATE, &mutated, 422);
    let mut mutated = valid.clone();
    mutated["plan"]["selection"]["profile"]["key_count"] = json!(61);
    reject(VALIDATE, &mutated, 422);
    for (path, request) in [(GENERATE, request), (VALIDATE, valid)] {
        for field in [
            "eligible_source_ids",
            "human_source_ids",
            "hierarchy",
            "layers",
            "checked",
            "assistance",
            "runtime",
            "timeline",
            "source",
        ] {
            let mut injected = request.clone();
            injected[field] = json!([]);
            reject(path, &injected, 400);
        }
        if path == VALIDATE {
            for field in [
                "eligible_source_ids",
                "human_source_ids",
                "hierarchy",
                "layers",
                "checked",
                "assistance",
            ] {
                let mut injected = request.clone();
                injected["plan"][field] = json!([]);
                reject(path, &injected, 400);
            }
        }
    }
}

#[test]
fn empty_equal_layers_are_truthful_and_routes_keep_strict_bounded_admission() {
    let mut empty = request();
    empty["selection"]["profile"] = json!({"kind":"piano","key_count":12,"lowest_midi":0});
    let response = body(GENERATE, &empty);
    for summary in response["checked"]["layers"].as_array().unwrap() {
        assert_eq!(summary["human_target_count"], 0);
        assert_eq!(summary["scored_mode_allowed"], false);
    }
    assert_eq!(
        response["checked"]["layers"][1]["equals_previous_layer"],
        true
    );
    assert_eq!(
        response["checked"]["layers"][2]["equals_previous_layer"],
        true
    );
    assert_eq!(
        response["checked"]["assistance"]["scored_mode_allowed"],
        false
    );
    for path in [GENERATE, VALIDATE] {
        assert!(is_song_api_route(path));
        assert_eq!(
            api_response(path, vec![b' '; MAX_REQUEST_BYTES + 1]).status,
            413
        );
    }
    for layer in ["original", "future", "", "Single"] {
        let mut invalid = request();
        invalid["layer"] = json!(layer);
        reject(GENERATE, &invalid, 400);
    }
    for field in ["score", "selection", "layer"] {
        let mut missing = request();
        missing.as_object_mut().unwrap().remove(field);
        reject(GENERATE, &missing, 400);
    }
    for level in ["selection", "profile"] {
        let mut injected = request();
        if level == "profile" {
            injected["selection"]["profile"]["hierarchy"] = json!([]);
        } else {
            injected[level]["hierarchy"] = json!([]);
        }
        reject(GENERATE, &injected, 400);
    }
}
