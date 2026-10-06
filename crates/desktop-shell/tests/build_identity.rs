use http::Request;
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use worldmusichub_desktop::{dispatch, ORIGIN};

fn request(method: &str, path: &str, body: Vec<u8>) -> http::Response<Vec<u8>> {
    dispatch(
        Request::builder()
            .method(method)
            .uri(format!("{ORIGIN}{path}"))
            .header("content-type", "application/json")
            .body(body)
            .unwrap(),
    )
}

#[test]
fn explicit_native_diagnostics_identify_this_test_process_and_preserve_health() {
    let expected_health = json!({"name":"WorldMusicHub","display_name":"WorldMusicClub","version":env!("CARGO_PKG_VERSION"),"engine":"rust","network":"native-protocol-no-listener","score_format_version":1,"score_schema_revision":score_core::SCORE_SCHEMA_REVISION,"library_management_query_version":1,"library_catalog_version":1});
    let health = request("GET", "/api/health", vec![]);
    assert_eq!(
        serde_json::from_slice::<Value>(health.body()).unwrap(),
        expected_health
    );
    let response = request("GET", "/api/diagnostics/build", vec![]);
    assert_eq!(response.status(), 200);
    assert_eq!(response.headers()["cache-control"], "no-store");
    assert!(response.body().len() < 32 * 1024);
    let identity: Value = serde_json::from_slice(response.body()).unwrap();
    assert_eq!(identity["schema_version"], 1);
    assert_eq!(
        identity["native"]["transport"],
        "native-protocol-no-listener"
    );
    assert_eq!(identity["native"]["process_id"], std::process::id());
    assert_eq!(identity["native"]["os"], std::env::consts::OS);
    assert_eq!(identity["native"]["arch"], std::env::consts::ARCH);
    assert_eq!(
        identity["native"]["executable_hash_scope"],
        "current_executable_path_file"
    );
    assert_eq!(identity["native"]["executable_cache"], "once_per_process");
    let executable = std::env::current_exe().unwrap();
    assert_eq!(
        identity["native"]["executable_path"],
        executable.to_str().unwrap()
    );
    let size = std::fs::metadata(&executable).unwrap().len();
    if size <= 256 * 1024 * 1024 {
        let bytes = std::fs::read(executable).unwrap();
        assert_eq!(identity["native"]["executable_hash_status"], "ok");
        assert_eq!(
            identity["native"]["executable_sha256"],
            format!("{:x}", Sha256::digest(&bytes))
        );
        assert_eq!(identity["native"]["executable_bytes"], size);
    } else {
        assert_eq!(identity["native"]["executable_hash_status"], "too_large");
        assert!(identity["native"]["executable_sha256"].is_null());
    }
    let repeated: Value =
        serde_json::from_slice(request("GET", "/api/diagnostics/build", vec![]).body()).unwrap();
    assert_eq!(repeated, identity);
    assert_eq!(
        serde_json::from_slice::<Value>(request("GET", "/api/health", vec![]).body()).unwrap(),
        expected_health
    );
}

#[test]
fn diagnostics_accept_only_an_explicit_same_origin_bodyless_get() {
    assert_eq!(
        request("POST", "/api/diagnostics/build", vec![]).status(),
        405
    );
    assert_eq!(
        request("GET", "/api/diagnostics/build?path=private", vec![]).status(),
        403
    );
    assert_eq!(
        request("GET", "/api/diagnostics/build", b"input".to_vec()).status(),
        400
    );
    let foreign = Request::builder()
        .method("GET")
        .uri(format!("{ORIGIN}/api/diagnostics/build"))
        .header("origin", "https://example.invalid")
        .body(vec![])
        .unwrap();
    assert_eq!(dispatch(foreign).status(), 403);
}
