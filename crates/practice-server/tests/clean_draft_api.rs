use base64::Engine;
use practice_server::{api_response, content_type_allowed, is_song_api_route, MAX_REQUEST_BYTES};
use serde_json::{json, Value};

#[test]
fn complete_draft_transport_rejects_bad_base64_fields_and_byte_limits() {
    let path = "/api/clean-song/draft";
    assert!(is_song_api_route(path));
    assert!(is_song_api_route("/api/clean-song/draft/pack"));
    assert!(content_type_allowed(path, "application/json"));
    assert!(!content_type_allowed(path, "audio/midi"));
    let mut input = json!({"source_base64":"!","source_name":"original.mid","title":"Original"});
    let response = api_response(path, serde_json::to_vec(&input).unwrap());
    assert_eq!(response.status, 400);
    assert_eq!(
        serde_json::from_slice::<Value>(&response.body).unwrap()["code"],
        "clean_draft_invalid_request"
    );
    // At this precise boundary base64 length equals the maximum valid length;
    // decoded bytes must still enforce the source limit without off-by-one.
    input["source_base64"] = json!(base64::engine::general_purpose::STANDARD.encode(vec![
        0;
        score_core::midi_events::MAX_SOURCE_BYTES
            + 1
    ]));
    let response = api_response(path, serde_json::to_vec(&input).unwrap());
    assert_eq!(response.status, 413);
    let body: Value = serde_json::from_slice(&response.body).unwrap();
    assert_eq!(body["code"], "clean_draft_source_limit");
    assert!(body.get("package").is_none());
    for path in [path, "/api/clean-song/draft/pack"] {
        let response = api_response(path, vec![0; MAX_REQUEST_BYTES + 1]);
        assert_eq!(response.status, 413);
        assert_eq!(
            serde_json::from_slice::<Value>(&response.body).unwrap()["code"],
            "request_body_limit"
        );
    }
}

#[path = "../../../tests/support/vsq_authoring.rs"]
mod vsq_fixture;
#[test]
fn vsq_api_recognizes_content_holds_unknown_versions_and_binds_exact_strings() {
    let mut input = json!({"source_base64":base64::engine::general_purpose::STANDARD.encode(vsq_fixture::source()),"source_name":"original.mid","title":"Original VSQ"});
    let response = api_response("/api/clean-song/draft", serde_json::to_vec(&input).unwrap());
    assert_eq!(response.status, 200);
    assert_eq!(
        input,
        serde_json::from_slice::<Value>(include_bytes!(
            "../../../tests/fixtures/song-authoring/vsq-request.json"
        ))
        .unwrap()
    );
    assert_eq!(
        response.body,
        include_bytes!("../../../tests/fixtures/song-authoring/vsq-response.json")
    );
    let draft: Value = serde_json::from_slice(&response.body).unwrap();
    assert_eq!(draft["state"], "vsq_authoring_candidate");
    assert_eq!(draft["source"]["format"], "vsq");
    let score = draft["package"]["score_json"].as_str().unwrap();
    assert!(score.contains("9007199254740993"));
    assert_eq!(
        score_core::vsq_clean::decode_json(score.as_bytes())
            .unwrap()
            .authoring
            .tracks[0]
            .notes[0]
            .lyrics[0]
            .numeric_fields[0]
            .coefficient,
        9007199254740993
    );
    input["expected_draft_sha256"] = draft["draft_sha256"].clone();
    let pack = api_response(
        "/api/clean-song/draft/pack",
        serde_json::to_vec(&input).unwrap(),
    );
    assert_eq!(pack.status, 200);
    input["source_base64"] = json!(base64::engine::general_purpose::STANDARD
        .encode(vsq_fixture::smf(&vsq_fixture::tracks("Unknown", 0))));
    let rejected = api_response(
        "/api/clean-song/draft/pack",
        serde_json::to_vec(&input).unwrap(),
    );
    assert_eq!(rejected.status, 422);
    let rejected: Value = serde_json::from_slice(&rejected.body).unwrap();
    assert_eq!(rejected["source"]["format"], "vsq");
    assert!(rejected["package"].is_null());
    assert!(rejected.get("zip_base64").is_none());
}

#[test]
fn vsq_expansion_over_native_score_limit_holds_every_part_and_returns_no_partial_package() {
    let source = vsq_fixture::smf(&vsq_fixture::tracks("DSB301", 65_000));
    assert!(source.len() < score_core::midi_events::MAX_SOURCE_BYTES);
    let input = json!({"source_base64":base64::engine::general_purpose::STANDARD.encode(source),"source_name":"large.vsq","title":"Original capacity test"});
    let response = api_response("/api/clean-song/draft", serde_json::to_vec(&input).unwrap());
    assert_eq!(response.status, 422);
    let body: Value = serde_json::from_slice(&response.body).unwrap();
    assert_eq!(body["source"]["format"], "vsq");
    assert_eq!(body["state"], "rejected");
    assert_eq!(
        body["diagnostics"].as_array().unwrap().last().unwrap()["code"],
        "complete_package_limit"
    );
    assert_eq!(body["inventory"]["parts"].as_array().unwrap().len(), 3);
    assert!(body["package"].is_null());
    assert!(body["draft_sha256"].is_null());
    assert!(body.get("zip_base64").is_none());
}

#[test]
fn oversized_vsq_response_cannot_be_bypassed_by_compressed_pack_route() {
    let source = vsq_fixture::smf(&vsq_fixture::tracks("DSB301", 58_000));
    let draft = score_core::clean_conversion::prepare_midi(
        &source,
        "Original response limit",
        "response-limit.vsq",
    )
    .unwrap();
    let package = draft.package.as_ref().expect("score must fit native limit");
    let encoded_len = serde_json::to_vec(&draft).unwrap().len();
    assert!(
        encoded_len > practice_server::MAX_SONG_RESPONSE_BYTES,
        "score={}, envelope={encoded_len}",
        package.score_json.len()
    );
    let mut input = json!({"source_base64":base64::engine::general_purpose::STANDARD.encode(source),"source_name":"response-limit.vsq","title":"Original response limit"});
    for path in ["/api/clean-song/draft", "/api/clean-song/draft/pack"] {
        if path.ends_with("/pack") {
            input["expected_draft_sha256"] = json!(draft.draft_sha256);
        }
        let response = api_response(path, serde_json::to_vec(&input).unwrap());
        assert_eq!(response.status, 413);
        let body: Value = serde_json::from_slice(&response.body).unwrap();
        assert_eq!(body["code"], "response_body_limit");
        assert!(body.get("package").is_none());
        assert!(body.get("zip_base64").is_none());
    }
}
