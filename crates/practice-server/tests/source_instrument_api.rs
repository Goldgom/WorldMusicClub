use practice_server::{api_response, content_type_allowed, is_song_api_route, MAX_REQUEST_BYTES};
use serde_json::{json, Value};
const CANONICAL: &str = "/api/source-instrument-details/canonical";
const BASIC: &str = "/api/source-instrument-details/basic";

fn midi() -> Vec<u8> {
    let track = [0, 0xc0, 42, 0, 0x90, 60, 90, 96, 0x80, 60, 0, 0, 255, 47, 0];
    let mut bytes = b"MThd\0\0\0\x06\0\0\0\x01\0\x60MTrk".to_vec();
    bytes.extend((track.len() as u32).to_be_bytes());
    bytes.extend(track);
    bytes
}
fn value(path: &str, bytes: Vec<u8>, status: u16) -> Value {
    let response = api_response(path, bytes);
    assert_eq!(
        response.status,
        status,
        "{}",
        String::from_utf8_lossy(&response.body)
    );
    serde_json::from_slice(&response.body).unwrap()
}
#[test]
fn wrappers_are_exact_core_evidence_without_runtime_or_assignment() {
    let score = score_core::import_midi(&midi()).unwrap().0;
    let original = serde_json::to_vec(&score).unwrap();
    let result = value(CANONICAL, original.clone(), 200);
    assert_eq!(
        result,
        json!({"details":score_core::source_instrument::describe_canonical_midi(&score).unwrap()})
    );
    assert_eq!(result["details"]["instrument_namespace"], "unknown");
    assert_eq!(
        result["details"]["original_bytes_verification"],
        "verified_retained_bytes"
    );
    assert_eq!(serde_json::to_vec(&score).unwrap(), original);
    let basic = score_core::basic_keys::convert_midi(&midi(), "Mechanical source").unwrap();
    let result = value(
        BASIC,
        score_core::basic_keys::encode_json(&basic).unwrap(),
        200,
    );
    assert_eq!(
        result,
        json!({"details":score_core::source_instrument::describe_basic(&basic).unwrap()})
    );
    assert_eq!(
        result["details"]["original_bytes_verification"],
        "declared_provenance_only"
    );
}
#[test]
fn pitch_views_cannot_become_original_instrument_evidence() {
    let score = score_core::import_midi(&midi()).unwrap().0;
    let original = serde_json::to_vec(&score).unwrap();
    let before = value(CANONICAL, original.clone(), 200);
    let projected = value("/api/pitch-mod/project", serde_json::to_vec(&json!({"score":score,"configuration":{"format":"wmc-pitch-mod","version":1,"semitones":2}})).unwrap(), 200);
    let rejection = value(
        CANONICAL,
        serde_json::to_vec(&projected["compilation"]["score"]).unwrap(),
        422,
    );
    assert_eq!(rejection["code"], "source_projection_mismatch");
    assert_eq!(value(CANONICAL, original, 200), before);
}
#[test]
fn invalid_unsupported_and_budgets_fail_explicitly_without_partial_details() {
    for path in [CANONICAL, BASIC] {
        assert!(is_song_api_route(path));
        assert!(content_type_allowed(
            path,
            "application/json; charset=utf-8"
        ));
        assert!(!content_type_allowed(path, "application/json-invalid"));
        assert!(!content_type_allowed(path, "audio/midi"));
        let result = value(path, b"{}".to_vec(), 400);
        assert_eq!(result["code"], "source_instrument_invalid_request");
        assert!(result.get("details").is_none());
        assert_eq!(
            value(path, vec![b' '; MAX_REQUEST_BYTES + 1], 413)["code"],
            "request_body_limit"
        );
    }
    let score = score_core::catalog().remove(0);
    let bytes = serde_json::to_vec(&score).unwrap();
    assert_eq!(
        value(CANONICAL, bytes.clone(), 422)["code"],
        "unsupported_source_profile"
    );
    // Optional disclosure failure does not change the old compilation route.
    value("/api/compile", bytes, 200);
    let mut score = serde_json::to_value(score_core::import_midi(&midi()).unwrap().0).unwrap();
    score["details"] = json!({"instrument_namespace":"gm"});
    assert_eq!(
        value(CANONICAL, serde_json::to_vec(&score).unwrap(), 400)["code"],
        "source_instrument_invalid_request"
    );
}
