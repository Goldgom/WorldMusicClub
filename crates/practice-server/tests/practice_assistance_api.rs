mod support {
    pub mod song_contract;
}

use practice_server::{api_response, is_song_api_route, MAX_REQUEST_BYTES};
use serde_json::{json, Value};

const ORIGINAL: &str = "/api/practice-assistance/original";
const GENERATE: &str = "/api/practice-assistance/generate";
const CREATE: &str = "/api/practice-assistance/create";
const VALIDATE: &str = "/api/practice-assistance/validate";

fn request() -> Value {
    let legacy = support::song_contract::create_request();
    json!({"score":legacy["score"],"selection":{"selected_part_ids":legacy["selected_part_ids"],"profile":legacy["profile"]}})
}

fn settings() -> Value {
    json!({"algorithm_id":"wmc-keyboard-assistance-v1","max_targets_per_onset":1,
        "min_onset_interval_ms":250,"max_simultaneous_keys":2,"max_held_span_semitones":7})
}

fn body(path: &str, value: &Value) -> Value {
    let response = api_response(path, serde_json::to_vec(value).unwrap());
    assert_eq!(
        response.status,
        200,
        "{path}: {}",
        String::from_utf8_lossy(&response.body)
    );
    serde_json::from_slice(&response.body).unwrap()
}

fn reject(path: &str, value: &Value, status: u16) {
    let response = api_response(path, serde_json::to_vec(value).unwrap());
    assert_eq!(
        response.status,
        status,
        "{path}: {value}: {}",
        String::from_utf8_lossy(&response.body)
    );
    let error: Value = serde_json::from_slice(&response.body).unwrap();
    assert!(error["code"].as_str().is_some_and(|code| !code.is_empty()));
    assert!(error.get("checked").is_none());
}

fn fixture(name: &str, value: &Value) {
    let path = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../../tests/fixtures")
        .join(name);
    if std::env::var_os("WMH_UPDATE_ASSISTANCE_FIXTURES").is_some() {
        std::fs::write(&path, serde_json::to_vec_pretty(value).unwrap()).unwrap();
    }
    assert_eq!(
        serde_json::from_slice::<Value>(&std::fs::read(path).unwrap()).unwrap(),
        *value
    );
}

#[test]
fn canonical_original_generate_create_and_validate_share_typed_domain_without_package_identity() {
    let request = request();
    let source_bytes = serde_json::to_vec(&request["score"]).unwrap();
    let original = body(ORIGINAL, &request);
    let mut generate = request.clone();
    generate["settings"] = settings();
    let automatic = body(GENERATE, &generate);
    assert_eq!(automatic, body(GENERATE, &generate));
    let mut create = request.clone();
    create["human_source_ids"] = json!(["human-note"]);
    let explicit = body(CREATE, &create);
    for response in [&original, &automatic, &explicit] {
        let checked = &response["checked"];
        assert_eq!(response["source"]["kind"], "canonical");
        assert_eq!(
            response["source"]["source_binding"],
            checked["receipt"]["source_binding"]
        );
        assert_eq!(response["source"]["profile"], "wmc-canonical-score-v1");
        assert_eq!(
            response["source"]["runtime_policy"],
            "wmc-canonical-practice-v1"
        );
        assert_eq!(response["source"]["choice"], Value::Null);
        assert_eq!(checked["receipt"]["saved_package_sha256"], Value::Null);
        assert!(response["source"].get("key").is_none());
        assert!(response["source"].get("content_sha256").is_none());
        assert_eq!(checked["plan"]["receipt"], checked["receipt"]);
        assert_eq!(
            body(
                VALIDATE,
                &json!({"score":request["score"],"plan":checked["plan"]})
            ),
            *response
        );
    }
    assert_eq!(original["checked"]["coverage"]["human_occurrence_count"], 2);
    assert_eq!(
        automatic["checked"]["coverage"]["human_occurrence_count"],
        1
    );
    assert_eq!(
        automatic["checked"]["coverage"]["machine_occurrence_count"],
        1
    );
    assert_eq!(
        automatic["checked"]["plan"]["human_source_ids"],
        json!(["machine-note"])
    );
    assert_eq!(
        explicit["checked"]["human_targets"]["timeline"]["notes"][0]["id"],
        "human-note"
    );
    assert_eq!(serde_json::to_vec(&request["score"]).unwrap(), source_bytes);
    let old = body(
        "/api/assistance/create",
        &support::song_contract::create_request(),
    );
    assert_eq!(old["human_targets"], explicit["checked"]["human_targets"]);
    assert!(old.get("source").is_none());
    assert!(old.get("machine_timeline").is_some());
    assert!(explicit["checked"].get("machine_timeline").is_none());
    let mut listen = request.clone();
    listen["selection"]["selected_part_ids"] = json!([]);
    let listen = body(ORIGINAL, &listen);
    assert_eq!(listen["checked"]["scored_mode_allowed"], false);
    assert_eq!(listen["checked"]["coverage"]["human_occurrence_count"], 0);
    assert_eq!(listen["checked"]["coverage"]["machine_occurrence_count"], 2);
    fixture(
        "assistance-canonical.json",
        &json!({"compilation":body("/api/compile", &request["score"]),"audio_profile":body("/api/canonical-audio-profile", &request["score"]),"original":original,"automatic":automatic,"explicit":explicit,"listen":listen}),
    );
}

#[test]
fn canonical_rejects_stale_source_saved_bindings_versions_and_derived_runtime_injection() {
    let request = request();
    let mut generate = request.clone();
    generate["settings"] = settings();
    let checked = body(GENERATE, &generate);
    let valid = json!({"score":request["score"],"plan":checked["checked"]["plan"]});
    let mut stale = valid.clone();
    stale["score"]["title"] = json!("Changed original source");
    reject(VALIDATE, &stale, 422);
    for (field, value) in [
        ("schema_version", json!(999)),
        ("planner_revision", json!(999)),
        ("revision", json!(0)),
        ("human_source_ids", json!([])),
        ("selection_digest", json!("0".repeat(64))),
    ] {
        let mut stale = valid.clone();
        stale["plan"][field] = value;
        reject(VALIDATE, &stale, 422);
    }
    for (field, value) in [
        ("saved_package_sha256", json!("0".repeat(64))),
        ("runtime_digest", json!("0".repeat(64))),
        ("source_profile", json!("wmh-basic-keys-midi1-v1")),
        ("choice", json!("base_notes_instrumental")),
    ] {
        let mut stale = valid.clone();
        stale["plan"]["receipt"][field] = value;
        reject(VALIDATE, &stale, 422);
    }
    let mut create = request.clone();
    create["human_source_ids"] = json!(["unknown-source-id"]);
    reject(CREATE, &create, 422);
    for (path, valid) in [
        (ORIGINAL, request),
        (GENERATE, generate),
        (CREATE, create),
        (VALIDATE, valid),
    ] {
        for field in ["source", "timeline", "runtime", "compilation", "checked"] {
            let mut injected = valid.clone();
            injected[field] = json!({});
            reject(path, &injected, 400);
        }
    }
}

#[test]
fn canonical_requests_are_registered_bounded_and_strict_at_every_selection_level() {
    for path in [ORIGINAL, GENERATE, CREATE, VALIDATE] {
        assert!(is_song_api_route(path));
        let response = api_response(path, vec![b' '; MAX_REQUEST_BYTES + 1]);
        assert_eq!(response.status, 413);
        assert_eq!(
            serde_json::from_slice::<Value>(&response.body).unwrap()["code"],
            "request_body_limit"
        );
    }
    let mut generate = request();
    generate["settings"] = settings();
    for level in ["selection", "settings", "profile"] {
        let mut injected = generate.clone();
        if level == "profile" {
            injected["selection"]["profile"]["timeline"] = json!({});
        } else {
            injected[level]["timeline"] = json!({});
        }
        reject(GENERATE, &injected, 400);
    }
    for field in [
        "algorithm_id",
        "max_targets_per_onset",
        "min_onset_interval_ms",
        "max_simultaneous_keys",
        "max_held_span_semitones",
    ] {
        let mut missing = generate.clone();
        missing["settings"].as_object_mut().unwrap().remove(field);
        reject(GENERATE, &missing, 400);
    }
}
