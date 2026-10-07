//! Socket-free preset DTOs for frontend lifecycle tests. The score is the
//! existing original mechanical fixture from support/song_contract.rs.
//! Regenerate only this fixture with:
//! WMH_UPDATE_ASSISTANCE_PRESET_FIXTURES=1 cargo test -p practice-server --test assistance_preset_api
mod support {
    pub mod song_contract;
}

use practice_server::api_response;
use serde_json::{json, Value};

const GENERATE: &str = "/api/practice-assistance/generate";
const VALIDATE: &str = "/api/practice-assistance/validate";

fn response_bytes(path: &str, request: &Value) -> Vec<u8> {
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
    serde_json::from_slice(&response_bytes(path, request)).unwrap()
}

fn generated_fixture() -> Value {
    let base: Value = serde_json::from_str(include_str!(
        "../../../tests/fixtures/assistance-canonical.json"
    ))
    .unwrap();
    let original_request = support::song_contract::create_request();
    let source = &original_request["score"];
    let source_bytes = serde_json::to_vec(source).unwrap();
    assert_eq!(*source, base["compilation"]["score"]);
    assert_eq!(body("/api/compile", source), base["compilation"]);
    assert_eq!(
        body("/api/canonical-audio-profile", source),
        base["audio_profile"]
    );
    let selection = json!({"selected_part_ids":original_request["selected_part_ids"],"profile":original_request["profile"]});
    assert_eq!(selection, base["original"]["checked"]["plan"]["selection"]);
    let mut presets = serde_json::Map::new();
    for (name, targets, interval, keys, span) in [
        ("single", 1, 500, 1, 0),
        ("balanced", 2, 250, 3, 7),
        ("dense", 4, 125, 6, 12),
    ] {
        let settings = json!({"algorithm_id":"wmc-keyboard-assistance-v1",
            "max_targets_per_onset":targets,"min_onset_interval_ms":interval,
            "max_simultaneous_keys":keys,"max_held_span_semitones":span});
        let request = json!({"score":source,"selection":selection,"settings":settings});
        let generated = response_bytes(GENERATE, &request);
        let response: Value = serde_json::from_slice(&generated).unwrap();
        assert_eq!(
            generated,
            response_bytes(GENERATE, &request),
            "deterministic {name}"
        );
        assert_eq!(
            generated,
            response_bytes(
                VALIDATE,
                &json!({"score":source,"plan":response["checked"]["plan"]})
            ),
            "roundtrip {name}"
        );
        let checked = &response["checked"];
        assert_eq!(checked["plan"]["settings"], settings);
        assert_eq!(checked["plan"]["human_source_ids"], json!(["machine-note"]));
        assert_eq!(checked["machine_occurrence_ids"], json!(["human-note"]));
        assert_eq!(checked["coverage"]["human_target_count"], 1);
        assert_eq!(checked["coverage"]["machine_occurrence_count"], 1);
        assert_eq!(checked["receipt"], base["original"]["checked"]["receipt"]);
        assert_eq!(checked["scored_mode_allowed"], true);
        presets.insert(
            name.into(),
            json!({"settings":settings,"response":response}),
        );
    }
    assert_eq!(serde_json::to_vec(source).unwrap(), source_bytes);
    json!({"source_fixture":"assistance-canonical.json","selection":selection,"presets":presets})
}

#[test]
fn preset_fixture_is_byte_exact_from_trusted_generate_and_validate_handlers() {
    let path = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../../tests/fixtures/assistance-presets-canonical.json");
    let generated = serde_json::to_vec_pretty(&generated_fixture()).unwrap();
    if std::env::var_os("WMH_UPDATE_ASSISTANCE_PRESET_FIXTURES").is_some() {
        std::fs::write(&path, &generated).unwrap();
    }
    assert_eq!(std::fs::read(path).unwrap(), generated);
}

#[test]
fn relabeling_settings_cannot_reuse_a_different_presets_checked_plan() {
    let fixture = generated_fixture();
    let request = support::song_contract::create_request();
    let mut forged_plan = fixture["presets"]["single"]["response"]["checked"]["plan"].clone();
    // Both real plans happen to choose the same source IDs here. That does not
    // authorize changing settings while retaining another generation's digest.
    forged_plan["settings"] = fixture["presets"]["balanced"]["settings"].clone();
    let response = api_response(
        VALIDATE,
        serde_json::to_vec(&json!({"score":request["score"],"plan":forged_plan})).unwrap(),
    );
    assert_eq!(response.status, 422);
    assert_eq!(
        serde_json::from_slice::<Value>(&response.body).unwrap()["code"],
        "assistance_plan_mismatch"
    );
}
