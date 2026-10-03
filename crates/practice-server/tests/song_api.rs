mod support {
    pub mod song_contract;
}
use practice_server::{api, api_response, MAX_REQUEST_BYTES, MAX_SONG_RESPONSE_BYTES};
use serde_json::{json, Value};
use support::song_contract::*;

fn body(path: &str, value: &Value) -> Value {
    let response = api_response(path, serde_json::to_vec(value).unwrap());
    assert_eq!(
        response.status,
        200,
        "{}",
        String::from_utf8_lossy(&response.body)
    );
    serde_json::from_slice(&response.body).unwrap()
}
#[test]
fn create_validate_and_human_assessment_preserve_source_and_machine_separation() {
    let request = create_request();
    let checked = body("/api/assistance/create", &request);
    let rechecked = body(
        "/api/assistance/validate",
        &json!({"score":request["score"],"plan":checked["plan"]}),
    );
    assert_eq!(checked, rechecked);
    assert_eq!(
        checked["human_targets"]["timeline"]["notes"][0]["id"],
        "human-note"
    );
    assert_eq!(
        checked["machine_timeline"]["notes"][0]["id"],
        "machine-note"
    );
    assert_eq!(checked["coverage"]["human_target_count"], 1);
    assert_eq!(checked["coverage"]["machine_occurrence_count"], 1);
    let compiled = api(
        "/api/compile",
        serde_json::to_vec(&request["score"]).unwrap(),
    )
    .unwrap();
    assert_eq!(compiled["score"], request["score"]);
    assert_eq!(
        checked["machine_timeline"]["duration_ms"],
        compiled["timeline"]["duration_ms"]
    );
    let assessment = body(
        "/api/assess",
        &json!({
            "timeline":checked["human_targets"]["timeline"],
            "inputs":[{"midi":checked["human_targets"]["timeline"]["notes"][0]["midi"],"at_ms":0,"velocity":90}],
            "tolerance_ms":180
        }),
    );
    assert_eq!(assessment["hits"][0]["note_id"], "human-note");
    assert_eq!(assessment["hits"].as_array().unwrap().len(), 1);
    assert_eq!(assessment["misses"], json!([]));
    assert_eq!(assessment["extras"], json!([]));
    let mut machine_only = request;
    machine_only["human_source_note_ids"] = json!([]);
    let all_machine = body("/api/assistance/create", &machine_only);
    assert_eq!(all_machine["scored_mode_allowed"], false);
    assert_eq!(all_machine["machine_timeline"], compiled["timeline"]);
}
#[test]
fn structured_failures_keep_exact_codes_and_source_ids_and_old_error_contract() {
    let cases = cases();
    let expected_codes = [
        None,
        None,
        Some("assistance_source_mismatch"),
        Some("assistance_unknown_note"),
        Some("assistance_schema_version"),
        Some("assistance_unsupported_request"),
        Some("assistance_invalid_request"),
        None,
        Some("unsupported_format"),
        Some("invalid_container"),
        None,
        None,
    ];
    for (case, code) in cases.into_iter().zip(expected_codes) {
        let response = api_response(case.path, case.bytes.clone());
        assert_eq!(response.status, case.status);
        let result: Value = serde_json::from_slice(&response.body).unwrap();
        if let Some(code) = code {
            assert_eq!(result["code"], code);
            assert!(result["error"].is_string());
            assert!(result["source_note_ids"].is_array());
            assert!(result.get("plan").is_none());
            if code == "assistance_unknown_note" {
                assert_eq!(result["source_note_ids"], json!(["absent-source-id"]));
            }
        }
        if case.path == "/api/import/midi" {
            assert_eq!(
                result,
                json!({"error":api(case.path, case.bytes).unwrap_err()})
            );
            assert!(result["error"].as_str().unwrap().contains("pedal"));
        }
    }
}
#[test]
fn raw_event_output_retains_every_source_identity_encoding_and_hash() {
    let bytes = raw_source();
    let parsed = score_core::midi_events::parse_midi_events(&bytes, None).unwrap();
    let response = api_response("/api/midi/events", bytes.clone());
    assert_eq!(response.status, 200);
    let result: Value = serde_json::from_slice(&response.body).unwrap();
    assert_eq!(result, serde_json::to_value(&parsed).unwrap());
    assert_eq!(parsed.original_bytes(), bytes);
    assert_eq!(result["events"].as_array().unwrap().len(), 14);
    assert_eq!(
        result["source_sha256"],
        "9c7ae2c622de91c7429075701448fed4d6d9f917e33602e25d4fb854ead3985d"
    );
    for (index, event) in result["events"].as_array().unwrap().iter().enumerate() {
        assert_eq!(event["id"]["source_sha256"], result["source_sha256"]);
        assert_eq!(event["id"]["track_index"], 0);
        assert_eq!(event["id"]["event_index"], index);
        let raw = &parsed.events()[index];
        assert_eq!(
            parsed.encoded_event(raw.id()).unwrap(),
            &bytes[raw.source_range()]
        );
    }
    assert_eq!(
        result["events"][2]["kind"]["message"],
        json!({"kind":"note_on","key":61,"velocity":0})
    );
    assert_eq!(result["events"][9]["kind"]["data"], json!([0, 255]));
    assert_eq!(result["events"][10]["kind"]["data"], json!([125, 247]));
    assert_eq!(result["events"][11]["kind"]["data"], json!([248]));
    assert!(result.get("original_bytes").is_none());
    // Inspection JSON is output-only, never a substitute for the retained file.
    let refused = api_response("/api/midi/events", response.body);
    assert_eq!(refused.status, 400);
    assert_eq!(
        serde_json::from_slice::<Value>(&refused.body).unwrap()["code"],
        "invalid_container"
    );
}

#[test]
fn initial_controller_pair_imports_complete_parts_with_retained_warning_and_raw_events() {
    // Original two-part fixture; no private input or transcribed music.
    let bytes = smf(
        1,
        7,
        &[
            vec![
                0, 0xc0, 13, 0, 0xb0, 121, 0, 0, 0xb0, 64, 0, 1, 0x90, 61, 103, 6, 0x80, 61, 13, 0,
                0xff, 0x2f, 0,
            ],
            vec![
                0, 0xb1, 121, 0, 0, 0xb1, 64, 0, 0, 0xc1, 42, 0, 0x91, 72, 57, 7, 72, 0, 0, 0xff,
                0x2f, 0,
            ],
        ],
    );
    let imported = api_response("/api/import/midi", bytes.clone());
    assert_eq!(imported.status, 200);
    let compiled: Value = serde_json::from_slice(&imported.body).unwrap();
    let score = &compiled["score"];
    assert_eq!(score["parts"].as_array().unwrap().len(), 2);
    assert_eq!(score["parts"][0]["notes"][0]["id"], "midi-t1-c1-e4");
    assert_eq!(score["parts"][1]["notes"][0]["id"], "midi-t2-c2-e4");
    assert!(score["source"]["import_diagnostics"]
        .as_array()
        .unwrap()
        .iter()
        .any(|d| d["code"] == "midi_initial_controls"));
    assert_eq!(body("/api/compile", score), compiled);
    let raw = api_response("/api/midi/events", bytes.clone());
    assert_eq!(raw.status, 200);
    let timeline: Value = serde_json::from_slice(&raw.body).unwrap();
    assert_eq!(timeline["events"].as_array().unwrap().len(), 12);
    assert_eq!(
        timeline["events"]
            .as_array()
            .unwrap()
            .iter()
            .filter(|e| e["kind"]["message"]["kind"] == "controller")
            .count(),
        4
    );
    let parsed = score_core::midi_events::parse_midi_events(&bytes, None).unwrap();
    assert_eq!(parsed.original_bytes(), bytes);
    assert_eq!(timeline["source_sha256"], parsed.source_sha256().hex());
}
#[test]
fn complete_envelopes_source_bytes_and_encoded_responses_have_distinct_limits() {
    for route in [
        "/api/assistance/create",
        "/api/assistance/validate",
        "/api/midi/events",
    ] {
        let response = api_response(route, vec![b' '; MAX_REQUEST_BYTES + 1]);
        assert_eq!(response.status, 413);
        assert_eq!(
            serde_json::from_slice::<Value>(&response.body).unwrap()["code"],
            "request_body_limit"
        );
    }
    let mut exact = serde_json::to_vec(&create_request()).unwrap();
    exact.resize(MAX_REQUEST_BYTES, b' ');
    assert_eq!(api_response("/api/assistance/create", exact).status, 200);
    let source_limit = api_response(
        "/api/midi/events",
        vec![0; score_core::midi_events::MAX_SOURCE_BYTES + 1],
    );
    assert_eq!(source_limit.status, 413);
    assert_eq!(
        serde_json::from_slice::<Value>(&source_limit.body).unwrap()["code"],
        "source_limit"
    );
    let representative = event_count_source(10_669);
    assert!(representative.len() < 45_000);
    let complete = api_response("/api/midi/events", representative);
    assert_eq!(complete.status, 200);
    assert!(complete.body.len() < MAX_SONG_RESPONSE_BYTES);
    let value: Value = serde_json::from_slice(&complete.body).unwrap();
    assert_eq!(value["events"].as_array().unwrap().len(), 10_669);
    let oversized = api_response("/api/midi/events", event_count_source(50_000));
    assert_eq!(oversized.status, 413);
    let value: Value = serde_json::from_slice(&oversized.body).unwrap();
    assert_eq!(value["code"], "response_body_limit");
    assert!(value.get("events").is_none());
}
#[test]
fn content_type_allowance_is_only_for_the_exact_raw_route() {
    for mime in ["audio/midi", "audio/x-midi", "application/octet-stream"] {
        assert!(practice_server::content_type_allowed(
            "/api/midi/events",
            mime
        ));
        for other in [
            "/api/midi/events/extra",
            "/api/assistance/create",
            "/api/compile",
        ] {
            assert!(!practice_server::content_type_allowed(other, mime));
        }
    }
    assert!(!practice_server::content_type_allowed(
        "/api/midi/events",
        "application/json"
    ));
}
