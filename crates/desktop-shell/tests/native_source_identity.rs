//! Original, public CC0 mechanical fixtures only; never user source files.
#[path = "support/pitch_mod_fixture.rs"]
mod fixture;
use fixture::*;
use http::Request;
use serde_json::{json, Value};
use worldmusichub_desktop::{
    dispatch_with_library,
    native_library::{NativeLibrary, SaveRequest},
    ORIGIN,
};

const IDENTITY: &str = "/api/library/source-identity";
const STATELESS: &str = "/api/source-identity/basic";
const NUMERIC: &str = "/api/library/source-instrument-details";

fn rejected(library: &NativeLibrary, body: &Value, status: u16) -> Value {
    let response = request(library, IDENTITY, body);
    assert_eq!(response.status().as_u16(), status);
    let error: Value = serde_json::from_slice(response.body()).unwrap();
    assert!(error.get("source").is_none());
    assert!(error.get("details").is_none());
    assert!(error.get("request_sha256").is_none());
    error
}
fn save_retained_midi(library: &NativeLibrary) -> Value {
    let midi = include_bytes!("../../score-core/src/source_identity/fixtures/01_no_gm_program.mid");
    let score = score_core::import_midi(midi).unwrap().0;
    let entry = library
        .save(SaveRequest {
            score_json: serde_json::to_string(&score).unwrap(),
            label: None,
            allow_conflicting_id: false,
        })
        .unwrap();
    json!({"key":entry.key,"content_sha256":entry.content_sha256,"profile":score_core::practice_source::CANONICAL_PROFILE,"choice":null,"runtime_policy":score_core::practice_source::CANONICAL_RUNTIME_POLICY})
}

#[test]
fn native_identity_uses_exact_saved_source_and_preserves_numeric_mod_and_storage() {
    let sandbox = Sandbox::new();
    let library = sandbox.library();
    let files = basic_files();
    let source = save(&library, &files, score_core::basic_keys::PROFILE);
    let body = json!({"source":source});
    let before = sandbox.bytes();
    let numeric = post(&library, NUMERIC, &body);
    let projection_request = json!({"source":source,"configuration":configuration(2)});
    let projected = post(&library, PROJECT, &projection_request);
    let basic = score_core::basic_keys::decode_json(&files["score.json"]).unwrap();
    let details = score_core::source_identity::describe_basic(&basic).unwrap();
    let result = post(&library, IDENTITY, &body);
    assert_eq!(result, json!({"source":source,"details":details}));
    assert_eq!(result.as_object().unwrap().len(), 2);
    let identity_binding = &result["details"]["source_binding"];
    let numeric_binding = &numeric["details"]["source_binding"];
    assert_eq!(identity_binding, numeric_binding);
    assert_ne!(identity_binding["digest"], source["content_sha256"]);
    assert_eq!(numeric["details"]["instrument_namespace"], "unknown");
    assert_eq!(post(&sandbox.library(), IDENTITY, &body), result);
    assert_eq!(post(&library, NUMERIC, &body), numeric);
    assert_eq!(post(&library, PROJECT, &projection_request), projected);
    assert_eq!(sandbox.bytes(), before);
}

#[test]
fn both_disclosures_reuse_strict_current_descriptor_verification() {
    let sandbox = Sandbox::new();
    let library = sandbox.library();
    let source = save(&library, &basic_files(), score_core::basic_keys::PROFILE);
    let before = sandbox.bytes();
    let canonical_profile = score_core::practice_source::CANONICAL_PROFILE;
    for (field, value) in [
        ("key", json!("song-invalid")),
        ("content_sha256", json!("0".repeat(64))),
        ("profile", json!(canonical_profile)),
        ("runtime_policy", json!("wmc-pitch-mod-v1")),
        ("choice", json!("base_notes_instrumental")),
    ] {
        let mut changed = source.clone();
        changed[field] = value;
        let body = json!({"source":changed});
        let identity = rejected(&library, &body, 422);
        let numeric = request(&library, NUMERIC, &body);
        assert_eq!(numeric.status(), 422);
        let numeric_error: Value = serde_json::from_slice(numeric.body()).unwrap();
        assert_eq!(numeric_error, identity);
        assert_eq!(identity["code"], "library_source_instrument_source");
    }
    for field in [
        "key",
        "content_sha256",
        "profile",
        "choice",
        "runtime_policy",
    ] {
        let mut body = json!({"source":source});
        body["source"].as_object_mut().unwrap().remove(field);
        let error = rejected(&library, &body, 400);
        assert_eq!(error["code"], "library_invalid_request");
    }
    for field in [
        "details",
        "request_sha256",
        "pitch_mod",
        "score",
        "runtime",
        "selection",
    ] {
        for nested in [false, true] {
            let mut body = json!({"source":source});
            if nested {
                body["source"][field] = json!({"classification":"supported"});
            } else {
                body[field] = json!({"classification":"supported"});
            }
            let error = rejected(&library, &body, 400);
            assert_eq!(error["code"], "library_invalid_request");
        }
    }
    assert_eq!(sandbox.bytes(), before);
}

#[test]
fn canonical_and_other_profiles_are_never_reinterpreted_as_basic() {
    let sandbox = Sandbox::new();
    let library = sandbox.library();
    let canonical = save_retained_midi(&library);
    let body = json!({"source":canonical});
    let numeric = post(&library, NUMERIC, &body);
    let projection_request = json!({"source":canonical,"configuration":configuration(0)});
    let projected = post(&library, PROJECT, &projection_request);
    let error = rejected(&library, &body, 422);
    assert_eq!(error["code"], "non_basic_profile");
    assert_eq!(post(&library, NUMERIC, &body), numeric);
    assert_eq!(post(&library, PROJECT, &projection_request), projected);
    let vsq = save(&library, &vsq_files(), score_core::vsq_clean::PROFILE);
    let error = rejected(&library, &json!({"source":vsq}), 422);
    assert_eq!(error["code"], "non_basic_profile");
    post(
        &library,
        PROJECT,
        &json!({"source":vsq,"configuration":configuration(0)}),
    );
}

#[test]
fn persisted_primary_and_independent_backup_are_reloaded_on_every_request() {
    for area in ["clean-songs", "clean-backups"] {
        let sandbox = Sandbox::new();
        let library = sandbox.library();
        let source = save(&library, &basic_files(), score_core::basic_keys::PROFILE);
        let body = json!({"source":source});
        let first = post(&library, IDENTITY, &body);
        let path = sandbox
            .0
            .join("Scores")
            .join(area)
            .join(source["key"].as_str().unwrap())
            .join("package/score.json");
        let original = std::fs::read(&path).unwrap();
        let mut damaged = original.clone();
        damaged.extend_from_slice(b"\n ");
        std::fs::write(&path, &damaged).unwrap();
        let before = sandbox.bytes();
        rejected(&library, &body, 422);
        assert_eq!(sandbox.bytes(), before);
        std::fs::write(&path, original).unwrap();
        assert_eq!(post(&sandbox.library(), IDENTITY, &body), first);
    }
}

#[test]
fn native_transport_keeps_shared_bytes_and_rejects_bad_method_mime_and_size() {
    let sandbox = Sandbox::new();
    let library = sandbox.library();
    let files = basic_files();
    let source = save(&library, &files, score_core::basic_keys::PROFILE);
    let bytes = files["score.json"].clone();
    let shared = practice_server::api_response(STATELESS, bytes.clone());
    assert_eq!(shared.status, 200);
    let native = dispatch_with_library(
        Request::builder()
            .method("POST")
            .uri(format!("{ORIGIN}{STATELESS}"))
            .header("content-type", "application/json")
            .body(bytes)
            .unwrap(),
        &library,
    );
    assert_eq!(native.status().as_u16(), shared.status);
    assert_eq!(*native.body(), shared.body);
    for path in [IDENTITY, STATELESS] {
        for (method, mime, body, status) in [
            ("GET", "application/json", Vec::new(), 405),
            ("POST", "application/json-invalid", b"{}".to_vec(), 415),
            ("POST", "application/json", b"{".to_vec(), 400),
            (
                "POST",
                "application/json",
                vec![b' '; worldmusichub_desktop::MAX_BODY + 1],
                413,
            ),
        ] {
            let response = dispatch_with_library(
                Request::builder()
                    .method(method)
                    .uri(format!("{ORIGIN}{path}"))
                    .header("content-type", mime)
                    .body(body)
                    .unwrap(),
                &library,
            );
            assert_eq!(response.status().as_u16(), status);
            let error: Value = serde_json::from_slice(response.body()).unwrap();
            assert!(error.get("code").is_some());
            assert!(error.get("details").is_none());
        }
    }
    let numeric = post(&library, NUMERIC, &json!({"source":source}));
    assert_eq!(numeric["details"]["instrument_namespace"], "unknown");
}
