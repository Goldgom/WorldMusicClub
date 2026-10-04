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
