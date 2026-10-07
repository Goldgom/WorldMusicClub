//! Socket-free adapter for the existing UI. Native storage is a bounded archive
//! service; renderer requests never provide filesystem paths or process commands.
pub mod acceptance;
mod acceptance_publication;
pub mod catalog;
#[doc(hidden)]
pub mod catalog_journal;
mod native_assistance;
mod native_basic_keys;
mod native_fingering;
pub mod native_library;
mod native_pitch_mod;
mod native_progression;
pub use native_library::catalog_product;
pub mod song_pack;
use http::{Request, Response};
use serde_json::{json, Value};

pub const MAX_BODY: usize = practice_server::MAX_REQUEST_BYTES;
const MAX_RESPONSE: usize = 32 * 1024 * 1024;
pub const ORIGIN: &str = "https://wmh.localhost";
const CSP: &str = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' blob: data:; connect-src 'self'; media-src 'self' blob:; object-src 'none'; base-uri 'none'; frame-src 'none'; frame-ancestors 'none'; form-action 'none'";

pub fn response(status: u16, mime: &str, body: impl Into<Vec<u8>>) -> Response<Vec<u8>> {
    Response::builder()
        .status(status)
        .header("Content-Type", mime)
        .header("Content-Security-Policy", CSP)
        .header("X-Content-Type-Options", "nosniff")
        .header("Cache-Control", "no-store")
        .header("Referrer-Policy", "no-referrer")
        .header("Cross-Origin-Resource-Policy", "same-origin")
        .header(
            "Permissions-Policy",
            "camera=(), microphone=(), geolocation=(), midi=(self), usb=(), serial=(), payment=()",
        )
        .body(body.into())
        .expect("constant protocol headers")
}

pub fn error(status: u16, message: &str) -> Response<Vec<u8>> {
    response(
        status,
        "application/json; charset=utf-8",
        serde_json::to_vec(&json!({"error":message})).expect("error JSON"),
    )
}

/// Keep transport failures structured for the new routes, including the
/// asynchronous Windows admission/computation wrappers. Old errors are unchanged.
pub fn operation_error(path: &str, status: u16, code: &str, message: &str) -> Response<Vec<u8>> {
    if native_library::is_library_route(path) {
        response(
            status,
            "application/json; charset=utf-8",
            serde_json::to_vec(&json!({"code":code,"error":message})).expect("library error JSON"),
        )
    } else if practice_server::is_song_api_route(path) {
        engine_response(practice_server::song_api_error(status, code, message))
    } else {
        error(status, message)
    }
}

/// Wry may deliver its canonical custom URI or the Windows HTTPS mapping.
pub fn allowed_uri(uri: &http::Uri) -> bool {
    matches!(
        (uri.scheme_str(), uri.authority().map(|a| a.as_str())),
        (Some("wmh"), Some("localhost")) | (Some("https"), Some("wmh.localhost"))
    )
}

pub fn admission(request: &Request<Vec<u8>>) -> Option<Response<Vec<u8>>> {
    let path = request.uri().path();
    if !allowed_uri(request.uri())
        || (request.uri().query().is_some() && !song_pack::valid_history_query(request.uri()))
    {
        return Some(operation_error(
            path,
            403,
            "forbidden_origin",
            "Only the bundled app origin is allowed",
        ));
    }
    if request
        .headers()
        .get("origin")
        .is_some_and(|origin| origin != ORIGIN && origin != "wmh://localhost")
    {
        return Some(operation_error(
            path,
            403,
            "forbidden_origin",
            "Cross-origin requests are not allowed",
        ));
    }
    if request.body().len() > song_pack::request_limit(path) {
        if path == "/api/library/manage/query" {
            return Some(operation_error(
                path,
                413,
                "library_query_limit",
                "Metadata query exceeds 4 KiB",
            ));
        }
        if song_pack::is_import_route(path) {
            return Some(operation_error(
                path,
                413,
                "pack_request_limit",
                "Song pack request exceeds its bounded transport limit",
            ));
        }
        if native_library::is_library_route(path) {
            return Some(operation_error(
                path,
                413,
                "library_request_limit",
                "Complete library request exceeds 8 MiB; no source was discarded",
            ));
        }
        if request.method() == "POST" && practice_server::is_song_api_route(request.uri().path()) {
            return Some(engine_response(practice_server::request_limit_response()));
        }
        return Some(error(413, "Import exceeds 8 MiB limit"));
    }
    if request.method() == "GET" && !request.body().is_empty() {
        return Some(if native_library::is_library_route(path) {
            operation_error(
                path,
                400,
                "library_invalid_request",
                "GET request bodies are not accepted",
            )
        } else {
            error(400, "GET request bodies are not accepted")
        });
    }
    if request.method() != "GET" && request.method() != "POST" {
        return Some(operation_error(
            path,
            405,
            "method_not_allowed",
            "Method not allowed",
        ));
    }
    None
}

fn json_response(result: Result<Value, String>) -> Response<Vec<u8>> {
    match result {
        Ok(value) => {
            let bytes = serde_json::to_vec(&value).expect("engine JSON");
            if bytes.len() > MAX_RESPONSE {
                return error(413, "Engine response exceeds desktop limit");
            }
            response(200, "application/json; charset=utf-8", bytes)
        }
        Err(message) => error(400, &message),
    }
}

fn engine_response(result: practice_server::ApiResponse) -> Response<Vec<u8>> {
    if result.body.len() > MAX_RESPONSE {
        return error(413, "Engine response exceeds desktop limit");
    }
    response(
        result.status,
        "application/json; charset=utf-8",
        result.body,
    )
}

pub fn dispatch(request: Request<Vec<u8>>) -> Response<Vec<u8>> {
    dispatch_inner(request, None)
}

/// Only the native host supplies storage. Existing stateless callers never
/// acquire an implicit filesystem capability or touch application data.
pub fn dispatch_with_library(
    request: Request<Vec<u8>>,
    library: &native_library::NativeLibrary,
) -> Response<Vec<u8>> {
    dispatch_inner(request, Some(library))
}

fn dispatch_inner(
    request: Request<Vec<u8>>,
    library: Option<&native_library::NativeLibrary>,
) -> Response<Vec<u8>> {
    if let Some(reply) = admission(&request) {
        return reply;
    }
    let path = request.uri().path();
    if song_pack::is_import_route(path) {
        return match library {
            Some(library) => song_pack::dispatch(library, &request),
            None => operation_error(
                path,
                503,
                "library_unavailable",
                "Native filesystem storage is not attached to this adapter",
            ),
        };
    }
    if native_library::is_library_route(path) {
        if request.method() == "POST"
            && request
                .headers()
                .get("content-type")
                .and_then(|value| value.to_str().ok())
                .map(|value| value.split(';').next().unwrap_or("").trim())
                != Some("application/json")
        {
            return operation_error(
                path,
                415,
                "unsupported_content_type",
                "Native library operations require application/json",
            );
        }
        return match library {
            Some(library) => {
                native_library::dispatch(library, request.method().as_str(), path, request.body())
            }
            None => operation_error(
                path,
                503,
                "library_unavailable",
                "Native filesystem storage is not attached to this adapter",
            ),
        };
    }
    if request.method() != "POST"
        && (path.starts_with("/api/practice-assistance/")
            || path.starts_with("/api/practice-progression/")
            || path.starts_with("/api/pitch-mod/"))
        && practice_server::is_song_api_route(path)
    {
        return engine_response(practice_server::song_api_error(
            405,
            "method_not_allowed",
            if path.starts_with("/api/pitch-mod/") {
                "Pitch Mod operations require POST"
            } else if path.starts_with("/api/practice-progression/") {
                "Practice progression operations require POST"
            } else {
                "Practice assistance operations require POST"
            },
        ));
    }
    if request.method() == "GET" {
        return match path {
            "/api/health" => json_response(Ok(
                json!({"name":"WorldMusicHub","display_name":"WorldMusicClub","version":env!("CARGO_PKG_VERSION"),"engine":"rust","network":"native-protocol-no-listener","score_format_version":1,"score_schema_revision":score_core::SCORE_SCHEMA_REVISION,"library_management_query_version":1,"library_catalog_version":1}),
            )),
            practice_server::build_identity::ROUTE => json_response(Ok(
                practice_server::build_identity::diagnostics("native-protocol-no-listener"),
            )),
            "/api/catalog" => json_response(
                serde_json::to_value(score_core::catalog()).map_err(|e| e.to_string()),
            ),
            "/api/catalog/index" => json_response(
                serde_json::to_value(score_core::catalog_index()).map_err(|e| e.to_string()),
            ),
            _ if path.starts_with("/api/catalog/score/") => {
                match score_core::catalog_score(&path["/api/catalog/score/".len()..]) {
                    Some(score) => {
                        json_response(serde_json::to_value(score).map_err(|e| e.to_string()))
                    }
                    None => error(404, "Bundled score not found"),
                }
            }
            _ => {
                let path = if path == "/" { "/index.html" } else { path };
                match practice_server::asset(path) {
                    Some(bytes) => {
                        let mime = match path.rsplit('.').next() {
                            Some("html") => "text/html; charset=utf-8",
                            Some("js") => "text/javascript; charset=utf-8",
                            Some("css") => "text/css; charset=utf-8",
                            Some("json") => "application/json; charset=utf-8",
                            Some("txt") => "text/plain; charset=utf-8",
                            Some("svg") => "image/svg+xml",
                            _ => "application/octet-stream",
                        };
                        response(200, mime, bytes)
                    }
                    None => error(404, "Embedded resource not found"),
                }
            }
        };
    }
    if path == practice_server::build_identity::ROUTE {
        return error(405, "method_not_allowed");
    }
    if !path.starts_with("/api/") {
        return error(405, "Only engine operations accept POST");
    }
    let content_type = request
        .headers()
        .get("content-type")
        .and_then(|v| v.to_str().ok())
        .unwrap_or("");
    if !practice_server::content_type_allowed(path, content_type) {
        if practice_server::is_song_api_route(path) {
            return engine_response(practice_server::song_api_error(
                415,
                "unsupported_content_type",
                "Unsupported request content type",
            ));
        }
        return error(415, "Unsupported import content type");
    }
    let path = path.to_owned();
    engine_response(practice_server::api_response(&path, request.into_body()))
}

#[cfg(test)]
#[path = "../../practice-server/tests/support/song_contract.rs"]
mod song_contract;

#[cfg(test)]
mod tests {
    use super::*;
    fn request(method: &str, path: &str, body: Vec<u8>) -> Request<Vec<u8>> {
        Request::builder()
            .method(method)
            .uri(format!("{ORIGIN}{path}"))
            .header("content-type", "application/json")
            .body(body)
            .unwrap()
    }
    #[test]
    fn asynchronous_failures_preserve_codes_and_legacy_error_shape() {
        for (status, code, message) in [
            (
                503,
                "engine_busy",
                "The local engine is busy; retry shortly",
            ),
            (500, "engine_operation_failed", "The score operation failed"),
        ] {
            let expected = practice_server::song_api_error(status, code, message);
            let actual = operation_error("/api/midi/events", status, code, message);
            assert_eq!(actual.status().as_u16(), expected.status);
            assert_eq!(actual.body(), &expected.body);
            let legacy = operation_error("/api/compile", status, code, message);
            assert_eq!(legacy.status(), status);
            assert_eq!(
                serde_json::from_slice::<Value>(legacy.body()).unwrap(),
                json!({"error":message})
            );
        }
    }

    #[test]
    fn song_native_status_and_bytes_match_the_shared_http_contract_exactly() {
        for case in song_contract::cases() {
            let expected = practice_server::api_response(case.path, case.bytes.clone());
            let mut req = request("POST", case.path, case.bytes);
            req.headers_mut()
                .insert("content-type", case.content_type.parse().unwrap());
            let actual = dispatch(req);
            assert_eq!(actual.status(), case.status, "{}", case.path);
            assert_eq!(actual.status().as_u16(), expected.status);
            assert_eq!(actual.body(), &expected.body, "{}", case.path);
        }
        let expected = practice_server::request_limit_response();
        let actual = dispatch(request(
            "POST",
            "/api/assistance/create",
            vec![b' '; MAX_BODY + 1],
        ));
        assert_eq!(actual.status().as_u16(), expected.status);
        assert_eq!(actual.body(), &expected.body);
        let expected = practice_server::song_api_error(
            415,
            "unsupported_content_type",
            "Unsupported request content type",
        );
        let actual = dispatch(request("POST", "/api/midi/events", vec![]));
        assert_eq!(actual.status().as_u16(), expected.status);
        assert_eq!(actual.body(), &expected.body);
    }

    #[test]
    fn exact_embedded_ui_and_engine_compile_survive_native_transport() {
        let page = dispatch(request("GET", "/", vec![]));
        assert_eq!(page.status(), 200);
        assert_eq!(page.body(), practice_server::asset("/index.html").unwrap());
        assert_eq!(
            dispatch(request("GET", "/app.js", vec![])).body(),
            practice_server::asset("/app.js").unwrap()
        );
        let score = score_core::catalog().remove(0);
        let bytes = serde_json::to_vec(&score).unwrap();
        let expected = practice_server::api("/api/compile", bytes.clone()).unwrap();
        let actual = dispatch(request("POST", "/api/compile", bytes));
        assert_eq!(actual.status(), 200);
        assert_eq!(
            serde_json::from_slice::<Value>(actual.body()).unwrap(),
            expected
        );
    }
    #[test]
    fn rejects_foreign_origins_methods_bodies_and_runtime_paths() {
        for uri in [
            "https://example.com/api/health",
            "https://wmh.localhost.evil/",
            "https://wmh.localhost:123/",
            "http://wmh.localhost/",
            "file://localhost/etc/passwd",
            "wmh://elsewhere/",
        ] {
            assert_eq!(
                dispatch(Request::builder().uri(uri).body(vec![]).unwrap()).status(),
                403,
                "{uri}"
            );
        }
        let mut cross = request("POST", "/api/compile", b"{}".to_vec());
        cross
            .headers_mut()
            .insert("origin", "https://example.com".parse().unwrap());
        assert_eq!(dispatch(cross).status(), 403);
        assert_eq!(dispatch(request("DELETE", "/", vec![])).status(), 405);
        assert_eq!(dispatch(request("GET", "/", vec![1])).status(), 400);
        assert_eq!(
            dispatch(request("GET", "/api/health?path=secret", vec![])).status(),
            403
        );
        assert_eq!(
            dispatch(request("POST", "/api/compile", vec![0; MAX_BODY + 1])).status(),
            413
        );
        for path in [
            "/etc/passwd",
            "/../Cargo.toml",
            "/unknown",
            "/api/catalog/score/missing",
        ] {
            assert_eq!(dispatch(request("GET", path, vec![])).status(), 404);
        }
        assert_eq!(
            dispatch(request("POST", "/api/run-command", b"{}".to_vec())).status(),
            400
        );
    }
    #[test]
    fn raw_imports_and_error_statuses_reach_shared_engine() {
        let text = b"not a musicxml document".to_vec();
        let mut raw = request("POST", "/api/import/musicxml", text.clone());
        raw.headers_mut()
            .insert("content-type", "application/xml".parse().unwrap());
        let actual = dispatch(raw);
        let expected = practice_server::api("/api/import/musicxml", text).unwrap_err();
        assert_eq!(actual.status(), 400);
        assert_eq!(
            serde_json::from_slice::<Value>(actual.body()).unwrap()["error"],
            expected
        );
        let mut unsupported = request("POST", "/api/compile", b"{}".to_vec());
        unsupported
            .headers_mut()
            .insert("content-type", "text/plain".parse().unwrap());
        assert_eq!(dispatch(unsupported).status(), 415);
        let response = dispatch(request("GET", "/api/health", vec![]));
        let health: Value = serde_json::from_slice(response.body()).unwrap();
        assert_eq!(health["name"], "WorldMusicHub");
        assert_eq!(health["display_name"], "WorldMusicClub");
        assert_eq!(response.headers()["content-security-policy"], CSP);
        assert!(response.headers()["permissions-policy"]
            .to_str()
            .unwrap()
            .contains("midi=(self)"));
        assert!(!response
            .headers()
            .contains_key("access-control-allow-origin"));
    }
}
