#[path = "support/pitch_mod_fixture.rs"]
mod fixture;
use fixture::*;
use http::Request;
use serde_json::{json, Value};
use worldmusichub_desktop::{dispatch_with_library, native_library::SaveRequest, ORIGIN};
const DETAILS: &str = "/api/library/source-instrument-details";

fn save_midi(library: &worldmusichub_desktop::native_library::NativeLibrary) -> Value {
    let track = [0, 0xc0, 42, 0, 0x90, 60, 90, 96, 0x80, 60, 0, 0, 255, 47, 0];
    let mut bytes = b"MThd\0\0\0\x06\0\0\0\x01\0\x60MTrk".to_vec();
    bytes.extend((track.len() as u32).to_be_bytes());
    bytes.extend(track);
    let score = score_core::import_midi(&bytes).unwrap().0;
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
fn native_details_reload_original_and_preserve_all_files_across_pitch_mod() {
    let sandbox = Sandbox::new();
    let library = sandbox.library();
    let canonical = save_midi(&library);
    let basic = save(&library, &basic_files(), score_core::basic_keys::PROFILE);
    let before = sandbox.bytes();
    for source in [canonical, basic] {
        let body = json!({"source":source});
        let first = post(&library, DETAILS, &body);
        assert_eq!(first["source"], source);
        assert_eq!(first["details"]["instrument_namespace"], "unknown");
        post(
            &library,
            PROJECT,
            &json!({"source":source,"configuration":configuration(2)}),
        );
        assert_eq!(post(&library, DETAILS, &body), first);
        assert_eq!(post(&sandbox.library(), DETAILS, &body), first);
    }
    assert_eq!(sandbox.bytes(), before);
}
#[test]
fn native_details_reject_claims_and_keep_unsupported_practice_working() {
    let sandbox = Sandbox::new();
    let library = sandbox.library();
    let source = save_midi(&library);
    for (key, value) in [
        ("content_sha256", json!("0".repeat(64))),
        ("profile", json!("forged")),
        ("runtime_policy", json!("wmc-pitch-mod-v1")),
        ("choice", json!("base_notes_instrumental")),
    ] {
        let mut changed = source.clone();
        changed[key] = value;
        let response = request(&library, DETAILS, &json!({"source":changed}));
        assert_eq!(response.status(), 422);
        assert_eq!(
            serde_json::from_slice::<Value>(response.body()).unwrap()["code"],
            "library_source_instrument_source"
        );
    }
    for extra in [
        json!({"details":{}}),
        json!({"pitch_mod":configuration(2)}),
        json!({"selection":{}}),
    ] {
        let mut body = json!({"source":source});
        body.as_object_mut()
            .unwrap()
            .extend(extra.as_object().unwrap().clone());
        assert_eq!(request(&library, DETAILS, &body).status(), 400);
    }
    let unsupported = save_canonical(&library);
    let response = request(&library, DETAILS, &json!({"source":unsupported}));
    assert_eq!(response.status(), 422);
    assert_eq!(
        serde_json::from_slice::<Value>(response.body()).unwrap()["code"],
        "unsupported_source_profile"
    );
    post(
        &library,
        PROJECT,
        &json!({"source":unsupported,"configuration":configuration(0)}),
    );
    let response = dispatch_with_library(
        Request::builder()
            .method("GET")
            .uri(format!("{ORIGIN}{DETAILS}"))
            .body(Vec::new())
            .unwrap(),
        &library,
    );
    assert_eq!(response.status(), 405);
}
#[test]
fn desktop_stateless_details_match_shared_engine_bytes() {
    let sandbox = Sandbox::new();
    let library = sandbox.library();
    let source = save_midi(&library);
    let loaded = library.load(source["key"].as_str().unwrap()).unwrap();
    let bytes = loaded.score_json.unwrap().into_bytes();
    let path = "/api/source-instrument-details/canonical";
    let shared = practice_server::api_response(path, bytes.clone());
    let native = dispatch_with_library(
        Request::builder()
            .method("POST")
            .uri(format!("{ORIGIN}{path}"))
            .header("content-type", "application/json")
            .body(bytes)
            .unwrap(),
        &library,
    );
    assert_eq!(native.status().as_u16(), shared.status);
    assert_eq!(*native.body(), shared.body);
}
