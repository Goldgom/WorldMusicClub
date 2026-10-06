//! Original C/E/G source only. Reproduces the obsolete VSQ-only persisted
//! summary decoder without weakening any current profile's closed schema.
use base64::{engine::general_purpose::STANDARD, Engine};
use http::Request;
use serde::Deserialize;
use serde_json::Value;
use std::{fs, path::PathBuf};
use worldmusichub_desktop::{
    dispatch_with_library,
    native_library::{clean_package::Asset, Entry, NativeLibrary},
    ORIGIN,
};

// The public persisted Summary contract immediately before 1d6e3bf33.
// Its profile-independent capabilities field incorrectly used the VSQ type.
#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
#[allow(dead_code)]
struct LegacyVsqOnlySummary {
    version: u32,
    #[serde(default)]
    profile: Option<String>,
    #[serde(default)]
    capabilities: Option<score_core::vsq_clean::Capabilities>,
    #[serde(default)]
    interpretation_limits: Vec<score_core::vsq_clean::CleanInterpretationLimit>,
    content_sha256: String,
    bytes: u64,
    media: Vec<Asset>,
    coverage: Value,
    notation_available: bool,
}

// Retain the actual serialized entry framing and field order, rather than
// sorting its keys through serde_json::Value and changing the error column.
#[derive(Debug, Deserialize)]
#[allow(dead_code)]
struct LegacyEntryReader {
    clean_package: LegacyVsqOnlySummary,
}

struct Sandbox(PathBuf);
impl Drop for Sandbox {
    fn drop(&mut self) {
        fs::remove_dir_all(&self.0).unwrap();
    }
}

#[test]
fn original_basic_summary_reproduces_obsolete_vsq_only_decoder_failure() {
    let mut request: Value = serde_json::from_slice(include_bytes!(
        "../../../tests/fixtures/song-authoring/strict-request.json"
    ))
    .unwrap();
    request["intent"] = "basic_keys".into();
    let response = practice_server::api_response(
        "/api/clean-song/draft",
        serde_json::to_vec(&request).unwrap(),
    );
    assert_eq!(response.status, 200);
    let draft: Value = serde_json::from_slice(&response.body).unwrap();
    let score: Value =
        serde_json::from_str(draft["package"]["score_json"].as_str().unwrap()).unwrap();
    assert_eq!(
        score["capabilities"]["acoustic_pitch"],
        "not_inferred_from_key_numbers"
    );
    request["expected_draft_sha256"] = draft["draft_sha256"].clone();
    let packed = practice_server::api_response(
        "/api/clean-song/draft/pack",
        serde_json::to_vec(&request).unwrap(),
    );
    assert_eq!(packed.status, 200);
    let packed: Value = serde_json::from_slice(&packed.body).unwrap();
    let sandbox = Sandbox(std::env::temp_dir().join(format!(
        "wmh-original-legacy-summary-{}",
        std::process::id()
    )));
    fs::create_dir(&sandbox.0).unwrap();
    let library = NativeLibrary::open(sandbox.0.join("Scores")).unwrap();
    let saved = dispatch_with_library(
        Request::builder()
            .method("POST")
            .uri(format!("{ORIGIN}/api/library/import/commit"))
            .header("content-type", "application/zip")
            .header("x-wmh-filename", "original-summary-regression.zip")
            .body(
                STANDARD
                    .decode(packed["zip_base64"].as_str().unwrap())
                    .unwrap(),
            )
            .unwrap(),
        &library,
    );
    assert_eq!(saved.status(), 200);
    let saved: Value = serde_json::from_slice(saved.body()).unwrap();
    assert_eq!(saved["summary"]["saved"], 1, "{saved}");
    let key = saved["items"][0]["entry"]["key"].as_str().unwrap();
    let bytes = fs::read(
        sandbox
            .0
            .join("Scores/clean-songs")
            .join(key)
            .join("entry.json"),
    )
    .unwrap();
    let error = serde_json::from_slice::<LegacyEntryReader>(&bytes)
        .unwrap_err()
        .to_string();
    assert!(
        error.contains(
            "unknown field `acoustic_pitch`, expected `whole_vocal_rendering` or `instrumental_practice`"
        ),
        "{error}"
    );
    eprintln!("Obsolete persisted-summary reproduction: {error}");
    let current: Entry = serde_json::from_slice(&bytes).unwrap();
    assert_eq!(
        current.clean_package.as_ref().unwrap().capabilities,
        Some(score["capabilities"].clone())
    );
    drop(library);
    let restarted = NativeLibrary::open(sandbox.0.join("Scores")).unwrap();
    let listed = restarted.list().unwrap();
    assert_eq!(listed.entries.len(), 1);
    assert!(listed.issues.is_empty());
    let opened = restarted.load(key).unwrap().clean_package.unwrap();
    assert_eq!(
        opened.profile.as_deref(),
        Some(score_core::basic_keys::PROFILE)
    );
    assert_eq!(opened.score_json, draft["package"]["score_json"]);
    assert_eq!(opened.metadata_json, draft["package"]["metadata_json"]);

    // The authoritative Basic decoder must still reject invented capability
    // fields. An untyped cache envelope is not a permissive score decoder.
    let mut wrong = score;
    wrong["capabilities"]["unreviewed_capability"] = true.into();
    assert!(
        score_core::basic_keys::decode_json(&serde_json::to_vec(&wrong).unwrap())
            .unwrap_err()
            .contains("unknown field `unreviewed_capability`")
    );
}
