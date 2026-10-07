#[path = "support/pitch_mod_fixture.rs"]
mod fixture;
use fixture::*;
use http::Request;
use serde_json::{json, Value};
use worldmusichub_desktop::{dispatch_with_library, ORIGIN};

#[test]
fn native_projection_reloads_originals_keeps_fifo_drums_and_disk_bytes() {
    let sandbox = Sandbox::new();
    let library = sandbox.library();
    let canonical = save_canonical(&library);
    let basic = save(&library, &basic_files(), score_core::basic_keys::PROFILE);
    let vsq = save(&library, &vsq_files(), score_core::vsq_clean::PROFILE);
    let before = sandbox.bytes();
    for source in [canonical, basic, vsq] {
        let original = post(
            &library,
            PROJECT,
            &json!({"source":source,"configuration":configuration(0)}),
        );
        let shifted = post(
            &library,
            PROJECT,
            &json!({"source":source,"configuration":configuration(2)}),
        );
        assert_eq!(shifted["source"], source);
        assert_eq!(original["source"], source);
        assert_eq!(shifted["identity"]["original_receipt"], original["receipt"]);
        assert_eq!(
            shifted["receipt"]["saved_package_sha256"],
            source["content_sha256"]
        );
        assert_ne!(
            shifted["receipt"]["runtime_digest"],
            original["receipt"]["runtime_digest"]
        );
        let old = original["compilation"]["timeline"]["notes"]
            .as_array()
            .unwrap();
        let new = shifted["compilation"]["timeline"]["notes"]
            .as_array()
            .unwrap();
        assert_eq!(old.len(), new.len());
        for (old, new) in old.iter().zip(new) {
            for field in [
                "id",
                "source_note_id",
                "source_note_ids",
                "part_id",
                "voice",
                "staff",
                "start_ms",
                "duration_ms",
                "velocity",
            ] {
                assert_eq!(old[field], new[field], "{field}");
            }
            let pitch = shifted["source_pitches"]
                .as_array()
                .unwrap()
                .iter()
                .find(|n| n["source_id"] == old["source_note_id"])
                .unwrap();
            let delta = if pitch["percussion"] == true { 0 } else { 2 };
            assert_eq!(
                new["midi"].as_i64().unwrap(),
                old["midi"].as_i64().unwrap() + delta
            );
        }
        if source["profile"] == score_core::basic_keys::PROFILE {
            assert_eq!(
                original["runtime"]["rendition"],
                shifted["runtime"]["rendition"]
            );
            let c4: Vec<_> = old.iter().filter(|note| note["midi"] == 60).collect();
            assert_eq!(c4.len(), 2);
            assert_eq!(c4[0]["duration_ms"], 250.0);
            assert_eq!(c4[1]["duration_ms"], 375.0);
            let part = shifted["runtime"]["parts"]
                .as_array()
                .unwrap()
                .iter()
                .find(|p| p["percussion"] == false)
                .unwrap();
            let page_source = json!({"key":source["key"],"content_sha256":source["content_sha256"],"profile":source["profile"]});
            let page = post(
                &library,
                "/api/library/basic-keys/notation",
                &json!({"source":page_source,"settings":{"part_id":part["id"],"rendition_policy_id":score_core::basic_keys::RENDITION_POLICY,"display_meter":{"numerator":4,"denominator":4}},"pitch_mod":configuration(2)}),
            );
            assert_eq!(page["receipt"], shifted["receipt"]);
            assert_eq!(page["page"]["interpreted_notes"][0]["key"], 62);
        }
        if source["profile"] == score_core::vsq_clean::PROFILE {
            let old = original["runtime"]["notes"].as_array().unwrap();
            let new = shifted["runtime"]["notes"].as_array().unwrap();
            for (old, new) in old.iter().zip(new) {
                let mut new = new.clone();
                new["key"] = old["key"].clone();
                assert_eq!(*old, new);
            }
            assert_eq!(shifted["navigation"], original["navigation"]);
        }
        let original_request = json!({"source":source,"selection":selection(&shifted)});
        let bytes = request(
            &library,
            "/api/library/assistance/original",
            &original_request,
        );
        assert_eq!(bytes.status(), 200);
        let mut zero = original_request.clone();
        zero["pitch_mod"] = configuration(0);
        assert_eq!(
            request(&library, "/api/library/assistance/original", &zero).body(),
            bytes.body()
        );
        let mut active = original_request;
        active["pitch_mod"] = configuration(2);
        let plan = post(&library, "/api/library/assistance/original", &active);
        assert_eq!(plan["checked"]["receipt"], shifted["receipt"]);
        assert_eq!(
            request(
                &library,
                "/api/library/assistance/validate",
                &json!({"source":source,"plan":plan["checked"]["plan"]})
            )
            .status(),
            422
        );
        assert_eq!(
            post(
                &library,
                "/api/library/assistance/validate",
                &json!({"source":source,"pitch_mod":configuration(2),"plan":plan["checked"]["plan"]})
            ),
            plan
        );
    }
    assert_eq!(sandbox.bytes(), before);
}

#[test]
fn source_identity_configuration_and_transport_are_strict() {
    assert!(worldmusichub_desktop::song_pack::is_large_operation(
        PROJECT
    ));
    let sandbox = Sandbox::new();
    let library = sandbox.library();
    let source = save_canonical(&library);
    let valid = json!({"source":source,"configuration":configuration(2)});
    for field in [
        "score",
        "timeline",
        "runtime",
        "effective_score",
        "receipt",
        "identity",
        "source_pitches",
    ] {
        let mut injected = valid.clone();
        injected[field] = json!({});
        assert_eq!(request(&library, PROJECT, &injected).status(), 400);
        let mut injected = valid.clone();
        injected["source"][field] = json!({});
        assert_eq!(request(&library, PROJECT, &injected).status(), 400);
    }
    for (field, value) in [
        ("content_sha256", json!("0".repeat(64))),
        ("runtime_policy", json!("wmc-pitch-mod-v1")),
        ("profile", json!(score_core::vsq_clean::PROFILE)),
        ("choice", json!("base_notes_instrumental")),
    ] {
        let mut mismatch = valid.clone();
        mismatch["source"][field] = value;
        assert_eq!(request(&library, PROJECT, &mismatch).status(), 422);
    }
    let response = dispatch_with_library(
        Request::builder()
            .method("GET")
            .uri(format!("{ORIGIN}{PROJECT}"))
            .body(Vec::new())
            .unwrap(),
        &library,
    );
    assert_eq!(response.status(), 405);
    let response = dispatch_with_library(
        Request::builder()
            .method("POST")
            .uri(format!("{ORIGIN}{PROJECT}"))
            .header("content-type", "text/plain")
            .body(b"{}".to_vec())
            .unwrap(),
        &library,
    );
    assert_eq!(response.status(), 415);
    let response = dispatch_with_library(
        Request::builder()
            .method("POST")
            .uri(format!("{ORIGIN}{PROJECT}?shift=2"))
            .header("content-type", "application/json")
            .body(b"{}".to_vec())
            .unwrap(),
        &library,
    );
    assert_eq!(response.status(), 403);
    assert_eq!(
        request(&library, "/api/library/pitch-mod/project/extra", &valid).status(),
        404
    );
    let score_path = sandbox
        .0
        .join("Scores")
        .join("songs")
        .join(source["key"].as_str().unwrap())
        .join("score.json");
    let saved = std::fs::read(&score_path).unwrap();
    std::fs::write(&score_path, b"{}").unwrap();
    assert!(request(&library, PROJECT, &valid)
        .status()
        .is_client_error());
    std::fs::write(score_path, saved).unwrap();
    post(&library, PROJECT, &valid);
}

#[test]
fn public_actual_handler_vectors_are_reproducible() {
    let actual = vectors();
    let canonical = &actual["vectors"]["canonical_api"];
    let tempo = &canonical["tempo120"];
    assert_eq!(tempo["original"]["score"]["tempo"][0]["bpm"], 120.0);
    for note in tempo["original"]["score"]["parts"][0]["notes"]
        .as_array()
        .unwrap()
    {
        assert_eq!(note["pitch"]["step"], "C");
    }
    assert_ne!(tempo["plus2"]["receipt"], canonical["plus2"]["receipt"]);
    assert_eq!(
        tempo["plus2"]["compilation"]["timeline"]["notes"][0]["midi"],
        62
    );
    assert_eq!(
        tempo["plus2"]["compilation"]["timeline"]["notes"][1]["start_ms"],
        500.0
    );
    assert_eq!(
        tempo["plus2"]["audio_profile"]["occurrences"][1]["start_ms"],
        500.0
    );
    assert_eq!(
        tempo["assistance"]["checked"]["receipt"],
        tempo["plus2"]["receipt"]
    );
    assert_eq!(tempo["fingering"]["receipt"], tempo["plus2"]["receipt"]);
    let basic = &actual["vectors"]["basic"];
    for (role, key) in [("melodic", 62), ("percussion", 35)] {
        let page = &basic["notation"][role];
        assert_eq!(page["original"], page["zero"]);
        assert_eq!(page["plus2"]["receipt"], basic["plus2"]["receipt"]);
        assert_eq!(page["plus2"]["pitch_mod"], basic["plus2"]["identity"]);
        assert_eq!(page["plus2"]["page"]["interpreted_notes"][0]["key"], key);
    }
    let path = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../../tests/fixtures/pitch-mod-handler-vectors.json");
    if std::env::var_os("WMH_UPDATE_PITCH_MOD_FIXTURES").is_some() {
        std::fs::write(&path, serde_json::to_vec_pretty(&actual).unwrap()).unwrap();
    }
    let expected: Value = serde_json::from_slice(&std::fs::read(path).unwrap()).unwrap();
    assert_eq!(actual, expected);
}
