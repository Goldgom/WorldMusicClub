//! Uses only the original public CC0-1.0 mechanical MIDI fixtures.
use practice_server::{api_response, content_type_allowed, is_song_api_route, MAX_REQUEST_BYTES};
use score_core::{basic_keys, source_identity};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};

const IDENTITY: &str = "/api/source-identity/basic";
const NUMERIC: &str = "/api/source-instrument-details/basic";
const PIANO: &[u8] =
    include_bytes!("../../score-core/src/source_identity/fixtures/04_gm1_piano.mid");
const UNKNOWN: &[u8] =
    include_bytes!("../../score-core/src/source_identity/fixtures/01_no_gm_program.mid");
const HARPSICHORD: &[u8] =
    include_bytes!("../../score-core/src/source_identity/fixtures/05_gm1_harpsichord.mid");

fn hash(bytes: &[u8]) -> String {
    format!("{:x}", Sha256::digest(bytes))
}
fn basic(midi: &[u8]) -> basic_keys::CompleteBasicKeys {
    basic_keys::convert_midi(midi, "Original CC0 mechanical identity fixture").unwrap()
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
fn exact_core_authority_and_numeric_runtime_independence() {
    for (midi, classification) in [
        (PIANO, "supported"),
        (UNKNOWN, "unresolved"),
        (HARPSICHORD, "known_unsupported"),
    ] {
        let source = basic(midi);
        let bytes = basic_keys::encode_json(&source).unwrap();
        let numeric = value(NUMERIC, bytes.clone(), 200);
        let snapshot = || {
            serde_json::to_vec(
                &basic_keys::compile_rendition(&source)
                    .map(|compiled| (compiled.timeline, compiled.rendition, compiled.diagnostics)),
            )
            .unwrap()
        };
        let before = snapshot();
        let result = value(IDENTITY, bytes.clone(), 200);
        assert_eq!(
            result,
            json!({"request_sha256":hash(&bytes),"details":source_identity::describe_basic(&source).unwrap()})
        );
        let actual_classification = &result["details"]["attacks"][0]["classification"];
        assert_eq!(actual_classification, classification);
        assert_eq!(
            result["details"]["original_bytes_verification"],
            "declared_provenance_only"
        );
        let identity_binding = &result["details"]["source_binding"];
        let numeric_binding = &numeric["details"]["source_binding"];
        assert_eq!(identity_binding, numeric_binding);
        assert_eq!(numeric["details"]["instrument_namespace"], "unknown");
        assert_eq!(value(NUMERIC, bytes.clone(), 200), numeric);
        assert_eq!(basic_keys::encode_json(&source).unwrap(), bytes);
        assert_eq!(snapshot(), before);
        assert_eq!(result.as_object().unwrap().len(), 2);
    }
}

#[test]
fn exact_request_bytes_are_correlated_separately_from_source_binding() {
    let bytes = basic_keys::encode_json(&basic(PIANO)).unwrap();
    let first = value(IDENTITY, bytes.clone(), 200);
    let mut padded = bytes.clone();
    padded.extend_from_slice(b" \n\t");
    let reordered =
        serde_json::to_vec_pretty(&serde_json::from_slice::<Value>(&bytes).unwrap()).unwrap();
    for variant in [padded, reordered] {
        let result = value(IDENTITY, variant.clone(), 200);
        assert_eq!(result["details"], first["details"]);
        assert_eq!(result["request_sha256"], hash(&variant));
        assert_ne!(result["request_sha256"], hash(&bytes));
    }
    let other_bytes = basic_keys::encode_json(&basic(UNKNOWN)).unwrap();
    let other = value(IDENTITY, other_bytes.clone(), 200);
    assert_eq!(other["request_sha256"], hash(&other_bytes));
    let other_binding = &other["details"]["source_binding"];
    let first_binding = &first["details"]["source_binding"];
    assert_ne!(other_binding, first_binding);
}

#[test]
fn canonical_non_basic_and_forged_disclosures_never_acquire_basic_authority() {
    let bytes = basic_keys::encode_json(&basic(PIANO)).unwrap();
    let valid: Value = serde_json::from_slice(&bytes).unwrap();
    for field in [
        "details",
        "request_sha256",
        "pitch_mod",
        "runtime",
        "source_identity",
    ] {
        let mut forged = valid.clone();
        forged[field] = json!({"classification":"supported"});
        let error = value(IDENTITY, serde_json::to_vec(&forged).unwrap(), 400);
        assert_eq!(error["code"], "source_identity_invalid_request");
        assert!(error.get("details").is_none());
        assert!(error.get("request_sha256").is_none());
    }
    let mut non_basic = valid;
    non_basic["performance"]["profile"] = json!(score_core::clean_song::PROFILE);
    value(IDENTITY, serde_json::to_vec(&non_basic).unwrap(), 400);
    for malformed in [b"{}".to_vec(), b"{".to_vec(), b"null".to_vec()] {
        assert_eq!(
            value(IDENTITY, malformed, 400)["code"],
            "source_identity_invalid_request"
        );
    }
    let canonical = score_core::import_midi(UNKNOWN).unwrap().0;
    let canonical_bytes = serde_json::to_vec(&canonical).unwrap();
    let numeric_path = "/api/source-instrument-details/canonical";
    let numeric = value(numeric_path, canonical_bytes.clone(), 200);
    let compile = value("/api/compile", canonical_bytes.clone(), 200);
    value(IDENTITY, canonical_bytes.clone(), 400);
    assert!(!is_song_api_route("/api/source-identity/canonical"));
    let numeric_after = value(numeric_path, canonical_bytes.clone(), 200);
    assert_eq!(numeric_after, numeric);
    assert_eq!(value("/api/compile", canonical_bytes, 200), compile);
    let numeric = value(NUMERIC, bytes, 200);
    assert_eq!(numeric["details"]["instrument_namespace"], "unknown");
}

#[test]
fn strict_json_and_exact_request_limit_are_independent_of_numeric_disclosure() {
    assert!(is_song_api_route(IDENTITY));
    assert!(content_type_allowed(
        IDENTITY,
        "application/json; charset=utf-8"
    ));
    for mime in ["application/json-invalid", "audio/midi", "text/plain"] {
        assert!(!content_type_allowed(IDENTITY, mime));
    }
    let mut bytes = basic_keys::encode_json(&basic(PIANO)).unwrap();
    let numeric = value(NUMERIC, bytes.clone(), 200);
    bytes.resize(MAX_REQUEST_BYTES, b' ');
    let result = value(IDENTITY, bytes.clone(), 200);
    assert_eq!(result["request_sha256"], hash(&bytes));
    bytes.push(b' ');
    let error = value(IDENTITY, bytes, 413);
    assert_eq!(error["code"], "request_body_limit");
    assert!(error.get("details").is_none());
    assert!(error.get("request_sha256").is_none());
    let original = basic_keys::encode_json(&basic(PIANO)).unwrap();
    assert_eq!(value(NUMERIC, original, 200), numeric);
}
