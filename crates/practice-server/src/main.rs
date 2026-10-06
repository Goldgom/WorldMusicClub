use bytes::Bytes;
use http_body_util::{BodyExt, Full, Limited};
use hyper::{
    body::{Body, Incoming},
    header::{HeaderValue, CONNECTION},
    server::conn::http1,
    service::service_fn,
    Method, Request, Response,
};
use hyper_util::rt::{TokioIo, TokioTimer};
#[cfg(test)]
use practice_server::api;
use practice_server::{
    api_response, asset as web_asset, content_type_allowed, is_song_api_route,
    request_limit_response, song_api_error, ApiResponse, MAX_REQUEST_BYTES,
};
use serde_json::json;
use std::{
    convert::Infallible,
    env,
    sync::{
        atomic::{AtomicUsize, Ordering},
        Arc,
    },
    time::Duration,
};
use tokio::{net::TcpListener, sync::Semaphore, time::timeout};
const MAX_BODY: usize = MAX_REQUEST_BYTES;
const BODY_TIMEOUT: Duration = Duration::from_secs(5);
const CONNECTION_TIMEOUT: Duration = Duration::from_secs(30);
const MAX_REQUESTS_PER_CONNECTION: usize = 64;
type WebResponse = Response<Full<Bytes>>;

fn reply(status: u16, content_type: &str, body: impl Into<Bytes>) -> WebResponse {
    Response::builder()
        .status(status)
        .header("Content-Type", content_type)
        .header("X-Content-Type-Options", "nosniff")
        .header("Cache-Control", "no-store")
        .header("Referrer-Policy", "no-referrer")
        .header("Cross-Origin-Resource-Policy", "same-origin")
        .header("Content-Security-Policy", "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' blob: data:; connect-src 'self'; media-src 'self' blob:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'")
        .body(Full::new(body.into()))
        .expect("static response headers")
}
fn request_allows_reuse<B: Body>(request: &Request<B>) -> bool {
    // Method alone does not prove there is no body. Reuse only an already
    // complete GET; POSTs retain their existing one-response lifetime.
    request.method() == Method::GET && request.body().is_end_stream()
}
fn bound_response_connection(
    mut response: WebResponse,
    allow_reuse: bool,
    request_number: usize,
) -> WebResponse {
    // In particular, do not drain or reuse an early-rejected request body.
    if !allow_reuse
        || !response.status().is_success()
        || request_number >= MAX_REQUESTS_PER_CONNECTION
    {
        response
            .headers_mut()
            .insert(CONNECTION, HeaderValue::from_static("close"));
    }
    response
}

fn json_reply(result: Result<serde_json::Value, String>) -> WebResponse {
    let (status, value) = match result {
        Ok(value) => (200, value),
        Err(error) => (400, json!({"error":error})),
    };
    reply(
        status,
        "application/json; charset=utf-8",
        serde_json::to_vec(&value).expect("JSON value"),
    )
}

fn engine_reply(result: ApiResponse) -> WebResponse {
    reply(
        result.status,
        "application/json; charset=utf-8",
        result.body,
    )
}

async fn route(
    request: Request<Incoming>,
    authority: &str,
    computations: Arc<Semaphore>,
) -> WebResponse {
    let path = request.uri().path().to_owned();
    let song_route = is_song_api_route(&path);
    let host = request.headers().get("host").and_then(|v| v.to_str().ok());
    let origin = request.headers().get("origin");
    let expected = format!("http://{authority}");
    if host != Some(authority) || origin.is_some_and(|o| o.to_str().ok() != Some(expected.as_str()))
    {
        if song_route {
            return engine_reply(song_api_error(
                403,
                "forbidden_origin",
                "Local same-origin requests only",
            ));
        }
        return reply(
            403,
            "text/plain; charset=utf-8",
            "Local same-origin requests only",
        );
    }
    if request.method() == Method::GET {
        return match path.as_str() {
            "/api/health" => json_reply(Ok(
                json!({"name":"WorldMusicHub","display_name":"WorldMusicClub","version":env!("CARGO_PKG_VERSION"),"engine":"rust","network":"loopback-only","score_format_version":1,"score_schema_revision":score_core::SCORE_SCHEMA_REVISION}),
            )),
            practice_server::build_identity::ROUTE => {
                if request.uri().query().is_some() || !request.body().is_end_stream() {
                    return reply(
                        400,
                        "application/json; charset=utf-8",
                        r#"{"error":"build_diagnostics_invalid_request"}"#,
                    );
                }
                match tokio::task::spawn_blocking(|| {
                    practice_server::build_identity::diagnostics("loopback-only")
                })
                .await
                {
                    Ok(value) => json_reply(Ok(value)),
                    Err(_) => reply(
                        500,
                        "application/json; charset=utf-8",
                        r#"{"error":"build_diagnostics_unavailable"}"#,
                    ),
                }
            }
            "/api/catalog" => {
                json_reply(serde_json::to_value(score_core::catalog()).map_err(|e| e.to_string()))
            }
            "/api/catalog/index" => json_reply(
                serde_json::to_value(score_core::catalog_index()).map_err(|e| e.to_string()),
            ),
            _ if path.starts_with("/api/catalog/score/") => {
                match score_core::catalog_score(&path["/api/catalog/score/".len()..]) {
                    Some(score) => {
                        json_reply(serde_json::to_value(score).map_err(|e| e.to_string()))
                    }
                    None => reply(
                        404,
                        "application/json; charset=utf-8",
                        r#"{"error":"Bundled score not found"}"#,
                    ),
                }
            }
            _ => {
                let asset = if path == "/" { "/index.html" } else { &path };
                if let Some(bytes) = web_asset(asset) {
                    let mime = if asset.ends_with(".html") {
                        "text/html; charset=utf-8"
                    } else if asset.ends_with(".css") {
                        "text/css; charset=utf-8"
                    } else if asset.ends_with(".js") {
                        "text/javascript; charset=utf-8"
                    } else if asset.ends_with(".json") {
                        "application/json; charset=utf-8"
                    } else if asset.ends_with(".txt") {
                        "text/plain; charset=utf-8"
                    } else if asset.ends_with(".svg") {
                        "image/svg+xml"
                    } else {
                        "application/octet-stream"
                    };
                    reply(200, mime, Bytes::from_static(bytes))
                } else {
                    reply(404, "text/plain; charset=utf-8", "Not found")
                }
            }
        };
    }
    if path == practice_server::build_identity::ROUTE {
        return reply(
            405,
            "application/json; charset=utf-8",
            r#"{"error":"method_not_allowed"}"#,
        );
    }
    if request.method() != Method::POST || !path.starts_with("/api/") {
        if song_route {
            return engine_reply(song_api_error(
                405,
                "method_not_allowed",
                "Method not allowed",
            ));
        }
        return reply(405, "text/plain; charset=utf-8", "Method not allowed");
    }
    let content_type = request
        .headers()
        .get("content-type")
        .and_then(|v| v.to_str().ok())
        .unwrap_or("");
    if !content_type_allowed(&path, content_type) {
        if is_song_api_route(&path) {
            return engine_reply(song_api_error(
                415,
                "unsupported_content_type",
                "Unsupported request content type",
            ));
        }
        return reply(
            415,
            "text/plain; charset=utf-8",
            "Expected application/json or MusicXML application/xml",
        );
    }
    if request
        .headers()
        .get("content-length")
        .and_then(|v| v.to_str().ok())
        .and_then(|v| v.parse::<u64>().ok())
        .is_some_and(|size| size > MAX_BODY as u64)
    {
        if is_song_api_route(&path) {
            return engine_reply(request_limit_response());
        }
        return json_reply(Err("Import exceeds 8 MiB limit".into()));
    }
    // Acquire before reading/allocating a body; keep the permit through CPU work.
    let permit = match timeout(Duration::from_secs(2), computations.acquire_owned()).await {
        Ok(Ok(permit)) => permit,
        _ => {
            if song_route {
                return engine_reply(song_api_error(
                    503,
                    "engine_busy",
                    "The local engine is busy; retry shortly",
                ));
            }
            return reply(
                503,
                "application/json; charset=utf-8",
                r#"{"error":"The local engine is busy; retry shortly"}"#,
            );
        }
    };
    let bytes = match timeout(
        BODY_TIMEOUT,
        Limited::new(request.into_body(), MAX_BODY).collect(),
    )
    .await
    {
        Ok(Ok(body)) => body.to_bytes().to_vec(),
        Ok(Err(error)) => {
            if is_song_api_route(&path) {
                return engine_reply(if error.is::<http_body_util::LengthLimitError>() {
                    request_limit_response()
                } else {
                    song_api_error(
                        400,
                        "invalid_request_body",
                        "Cannot read complete request body",
                    )
                });
            }
            return json_reply(Err(
                "Cannot read request body or import exceeds 8 MiB limit".into(),
            ));
        }
        Err(_) => {
            if song_route {
                return engine_reply(song_api_error(
                    408,
                    "request_body_timeout",
                    "Request body timed out",
                ));
            }
            return reply(
                408,
                "application/json; charset=utf-8",
                r#"{"error":"Request body timed out"}"#,
            );
        }
    };
    // Imported-score processing cannot stall static assets or the asynchronous I/O threads.
    match tokio::task::spawn_blocking(move || {
        let _permit = permit;
        api_response(&path, bytes)
    })
    .await
    {
        Ok(result) => engine_reply(result),
        Err(_) if song_route => engine_reply(song_api_error(
            500,
            "engine_operation_failed",
            "The score operation failed",
        )),
        Err(_) => reply(
            500,
            "application/json; charset=utf-8",
            r#"{"error":"The score operation failed"}"#,
        ),
    }
}

fn open_browser(url: &str) {
    #[cfg(target_os = "windows")]
    let result = std::process::Command::new("rundll32.exe")
        .args(["url.dll,FileProtocolHandler", url])
        .spawn();
    #[cfg(target_os = "macos")]
    let result = std::process::Command::new("open").arg(url).spawn();
    #[cfg(all(not(target_os = "windows"), not(target_os = "macos")))]
    let result = std::process::Command::new("xdg-open").arg(url).spawn();
    if let Err(e) = result {
        eprintln!("Open the URL in your browser manually ({e})");
    }
}
#[derive(Debug, PartialEq, Eq)]
enum Startup {
    Help,
    Version,
    Serve { port: u16, no_open: bool },
}
fn startup_args(args: &[String]) -> Result<Startup, &'static str> {
    if args.iter().any(|arg| arg == "--help" || arg == "-h") {
        return Ok(Startup::Help);
    }
    if args.len() == 1 && args[0] == "--version" {
        return Ok(Startup::Version);
    }
    let mut port = None;
    let mut no_open = false;
    let mut index = 0;
    while index < args.len() {
        match args[index].as_str() {
            "--no-open" => no_open = true,
            "--port" => {
                if port.is_some() {
                    return Err("Specify --port only once; use --help for startup options");
                }
                index += 1;
                port = Some(
                    args.get(index)
                        .filter(|value| {
                            !value.is_empty() && value.bytes().all(|b| b.is_ascii_digit())
                        })
                        .and_then(|value| value.parse::<u16>().ok())
                        .filter(|value| *value > 0)
                        .ok_or("--port requires a number from 1 to 65535")?,
                );
            }
            _ => return Err(
                "Unknown startup option; use --help, or run --version alone. No server was started",
            ),
        }
        index += 1;
    }
    Ok(Startup::Serve {
        port: port.unwrap_or(7878),
        no_open,
    })
}
fn main() {
    let args: Vec<String> = env::args().skip(1).collect();
    let (port, no_open) = match startup_args(&args) {
        Ok(Startup::Help) => {
            println!("WorldMusicClub [--port 7878] [--no-open]\nWorldMusicClub --version\nLocal-only Rust music practice app. Close this terminal to stop.\n--help / -h: show this help without starting a server.");
            return;
        }
        Ok(Startup::Version) => {
            println!("WorldMusicClub {}", env!("CARGO_PKG_VERSION"));
            return;
        }
        Ok(Startup::Serve { port, no_open }) => (port, no_open),
        Err(error) => {
            eprintln!("{error}");
            std::process::exit(2);
        }
    };
    let authority = format!("127.0.0.1:{port}");

    let runtime = tokio::runtime::Builder::new_multi_thread()
        .worker_threads(2)
        .max_blocking_threads(2)
        .enable_all()
        .build()
        .expect("local app runtime");
    runtime.block_on(async {
        let listener = TcpListener::bind(&authority).await.unwrap_or_else(|e| {
            eprintln!("Cannot start WorldMusicClub at {authority}: {e}. Try --port 7879.");
            std::process::exit(1)
        });
        let url = format!("http://{authority}");
        println!("WorldMusicClub {}\nOpen {url}\nRust engine · local files stay on this computer · Ctrl+C to stop",env!("CARGO_PKG_VERSION"));
        if !no_open { open_browser(&url); }
        let connections = Arc::new(Semaphore::new(16));
        let computations = Arc::new(Semaphore::new(2));
        loop {
            let (stream, _) = match listener.accept().await {
                Ok(connection) => connection,
                Err(error) => { eprintln!("Connection error: {error}"); continue; }
            };
            let Ok(permit) = connections.clone().try_acquire_owned() else { drop(stream); continue; };
            let authority = authority.clone();
            let computations = computations.clone();
            tokio::spawn(async move {
                let _permit = permit;
                let requests = AtomicUsize::new(0);
                let service = service_fn(move |request| {
                    let authority = authority.clone();
                    let computations = computations.clone();
                    let allow_reuse = request_allows_reuse(&request);
                    let request_number = requests.fetch_add(1, Ordering::Relaxed) + 1;
                    async move {
                        let response = route(request, &authority, computations).await;
                        Ok::<_, Infallible>(bound_response_connection(response, allow_reuse, request_number))
                    }
                });
                let mut builder = http1::Builder::new();
                builder.timer(TokioTimer::new()).header_read_timeout(Duration::from_secs(5)).max_buf_size(32 * 1024).max_headers(64).keep_alive(true);
                // Hyper restarts the header timer on idle keep-alive connections.
                // This independent total limit never resets after a request.
                // Explicit close responses drop unfinished bodies without draining them.
                let _ = timeout(CONNECTION_TIMEOUT, builder.serve_connection(TokioIo::new(stream), service)).await;
            });
        }
    });
}

#[cfg(test)]
#[path = "../tests/support/song_contract.rs"]
mod song_contract;

#[cfg(test)]
mod tests {
    use super::*;
    // Ordinary one-request functional HTTP exchange against an ephemeral
    // loopback listener, using the production route. No browser or GUI.
    fn http_post(path: &str, mime: &str, bytes: Vec<u8>, declared_size: usize) -> (u16, Vec<u8>) {
        use std::io::{Read, Write};
        tokio::runtime::Builder::new_current_thread().enable_all().build().unwrap().block_on(async {
            let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
            let authority = listener.local_addr().unwrap().to_string();
            let header = format!("POST {path} HTTP/1.1\r\nHost: {authority}\r\nContent-Type: {mime}\r\nContent-Length: {declared_size}\r\nConnection: close\r\n\r\n");
            let client_authority = authority.clone();
            let client = std::thread::spawn(move || {
                let mut stream = std::net::TcpStream::connect(client_authority).unwrap();
                stream.set_read_timeout(Some(Duration::from_secs(10))).unwrap();
                stream.set_write_timeout(Some(Duration::from_secs(10))).unwrap();
                stream.write_all(header.as_bytes()).unwrap();
                stream.write_all(&bytes).unwrap();
                let mut response = Vec::new();
                stream.read_to_end(&mut response).unwrap();
                response
            });
            let (stream, _) = listener.accept().await.unwrap();
            let computations = Arc::new(Semaphore::new(2));
            let service = service_fn(move |request| {
                let authority = authority.clone();
                let computations = computations.clone();
                async move { Ok::<_, Infallible>(route(request, &authority, computations).await) }
            });
            http1::Builder::new().keep_alive(false).serve_connection(TokioIo::new(stream), service).await.unwrap();
            let response = client.join().unwrap();
            let boundary = response.windows(4).position(|w| w == b"\r\n\r\n").unwrap();
            let header = std::str::from_utf8(&response[..boundary]).unwrap();
            let status = header.split_whitespace().nth(1).unwrap().parse().unwrap();
            assert!(header.to_lowercase().contains("content-type: application/json; charset=utf-8"));
            (status, response[boundary + 4..].to_vec())
        })
    }
    #[test]
    fn song_http_status_and_body_match_the_shared_native_contract_exactly() {
        for case in song_contract::cases() {
            let expected = api_response(case.path, case.bytes.clone());
            let actual = http_post(
                case.path,
                case.content_type,
                case.bytes.clone(),
                case.bytes.len(),
            );
            assert_eq!(actual.0, case.status, "{}", case.path);
            assert_eq!(actual, (expected.status, expected.body), "{}", case.path);
        }
        let expected = request_limit_response();
        assert_eq!(
            http_post(
                "/api/assistance/create",
                "application/json",
                vec![],
                MAX_BODY + 1
            ),
            (expected.status, expected.body)
        );
        let expected = song_api_error(
            415,
            "unsupported_content_type",
            "Unsupported request content type",
        );
        assert_eq!(
            http_post("/api/midi/events", "application/json", vec![], 0),
            (expected.status, expected.body)
        );
    }

    #[test]
    fn only_known_empty_get_requests_can_reuse_a_connection() {
        for (method, body, expected) in [
            (Method::GET, Bytes::new(), true),
            (Method::GET, Bytes::from_static(b"unconsumed"), false),
            (Method::POST, Bytes::new(), false),
            (Method::POST, Bytes::from_static(b"{}"), false),
            (Method::HEAD, Bytes::new(), false),
        ] {
            let request = Request::builder()
                .method(method)
                .body(Full::new(body))
                .unwrap();
            assert_eq!(request_allows_reuse(&request), expected);
        }
    }
    #[test]
    fn unknown_length_get_body_is_not_polled_or_reused() {
        struct UnfinishedBody;
        impl Body for UnfinishedBody {
            type Data = Bytes;
            type Error = Infallible;
            fn poll_frame(
                self: std::pin::Pin<&mut Self>,
                _cx: &mut std::task::Context<'_>,
            ) -> std::task::Poll<Option<Result<hyper::body::Frame<Bytes>, Infallible>>>
            {
                panic!("The connection policy must not poll or drain a body")
            }
        }
        let request = Request::builder()
            .method(Method::GET)
            .body(UnfinishedBody)
            .unwrap();
        assert!(!request_allows_reuse(&request));
    }
    #[test]
    fn rejected_nonempty_and_capped_responses_explicitly_close() {
        for (status, allow_reuse, number, should_close) in [
            (200, true, 1, false),
            (200, true, MAX_REQUESTS_PER_CONNECTION - 1, false),
            (200, true, MAX_REQUESTS_PER_CONNECTION, true),
            (200, false, 1, true),
            (400, true, 1, true),
            (403, true, 1, true),
            (404, true, 1, true),
            (405, true, 1, true),
            (408, false, 1, true),
            (415, false, 1, true),
            (503, false, 1, true),
        ] {
            let response = bound_response_connection(
                reply(status, "text/plain", "complete response"),
                allow_reuse,
                number,
            );
            assert_eq!(response.status().as_u16(), status);
            assert_eq!(response.headers().contains_key(CONNECTION), should_close);
            if should_close {
                assert_eq!(response.headers()[CONNECTION], "close");
            }
        }
    }
    #[test]
    fn startup_information_and_invalid_options_never_request_a_server() {
        let parse =
            |args: &[&str]| startup_args(&args.iter().map(|s| s.to_string()).collect::<Vec<_>>());
        assert_eq!(
            parse(&[]).unwrap(),
            Startup::Serve {
                port: 7878,
                no_open: false
            }
        );
        assert_eq!(
            parse(&["--no-open", "--port", "7879"]).unwrap(),
            Startup::Serve {
                port: 7879,
                no_open: true
            }
        );
        assert_eq!(parse(&["--help"]).unwrap(), Startup::Help);
        assert_eq!(parse(&["-h"]).unwrap(), Startup::Help);
        assert_eq!(parse(&["--version"]).unwrap(), Startup::Version);
        for args in [
            &["--unknown"][..],
            &["--port"],
            &["--port", "0"],
            &["--port", "65536"],
            &["--port", "12.5"],
            &["--port", "7878", "--port", "7879"],
            &["--version", "--no-open"],
        ] {
            assert!(parse(args).is_err(), "{args:?}");
        }
    }
    #[test]
    fn fractional_edition_target_api_retains_exact_float_values_and_range_gates() {
        let score = score_core::catalog_score("cc0-schubert-wandrers-nachtlied-d768").unwrap();
        let compiled = api("/api/compile", serde_json::to_vec(&score).unwrap()).unwrap();
        for (keys, playable) in [(61, false), (76, true)] {
            let request = json!({"timeline":compiled["timeline"],"profile":{"kind":"piano","key_count":keys,"lowest_midi":null}});
            let result = api(
                "/api/practice-targets",
                serde_json::to_vec(&request).unwrap(),
            )
            .unwrap();
            assert_eq!(result["playable"], playable);
            assert_eq!(
                result["timeline"]["duration_ms"],
                compiled["timeline"]["duration_ms"]
            );
            let originals = compiled["timeline"]["notes"].as_array().unwrap();
            for target in result["timeline"]["notes"].as_array().unwrap() {
                let original = originals
                    .iter()
                    .find(|note| note["id"] == target["id"])
                    .unwrap();
                assert_eq!(target["start_ms"], original["start_ms"]);
            }
        }
    }
    #[test]
    fn unknown_score_metadata_reports_compatibility_without_rewriting_input() {
        let mut value = serde_json::to_value(score_core::catalog().remove(0)).unwrap();
        value["future_notation_metadata"] = json!({"version":2});
        let bytes = serde_json::to_vec(&value).unwrap();
        let original = bytes.clone();
        let error = api("/api/compile", bytes.clone()).unwrap_err();
        assert!(error.contains("may require a newer WorldMusicClub"));
        assert!(error.contains("not changed or stripped"));
        assert_eq!(bytes, original);
        let syntax = api("/api/compile", b"{".to_vec()).unwrap_err();
        assert!(syntax.contains("Invalid score JSON"));
        assert!(!syntax.contains("Unsupported field"));
    }
    #[test]
    fn existing_import_content_types_are_preserved() {
        for (path, content_type) in [
            ("/api/compile", "application/json; charset=utf-8"),
            ("/api/import/musicxml", "application/xml"),
            ("/api/import/musicxml", "text/xml; charset=utf-8"),
            ("/api/import/midi", "audio/midi"),
            ("/api/import/mxl", "application/zip"),
            ("/api/import/image", "image/png"),
            ("/api/import/jianpu", "text/plain; charset=utf-8"),
        ] {
            assert!(content_type_allowed(path, content_type));
        }
        assert!(!content_type_allowed("/api/compile", "text/plain"));
    }
    #[test]
    fn notation_navigation_is_a_read_only_optional_score_route() {
        let score = score_core::catalog().remove(0);
        let bytes = serde_json::to_vec(&score).unwrap();
        let navigation = api("/api/notation-navigation", bytes.clone()).unwrap();
        let compiled = api("/api/compile", bytes.clone()).unwrap();
        assert_eq!(navigation["version"], 1);
        assert_eq!(navigation["source_measure_count"], score.measures.len());
        assert_eq!(
            navigation["duration_ms"],
            compiled["timeline"]["duration_ms"]
        );
        assert_eq!(navigation["occurrences"][0]["source_measure_index"], 0);
        assert_eq!(
            serde_json::from_slice::<serde_json::Value>(&bytes).unwrap(),
            compiled["score"]
        );
        let mut incomplete = score;
        incomplete.measures.clear();
        let bytes = serde_json::to_vec(&incomplete).unwrap();
        assert!(api("/api/notation-navigation", bytes.clone())
            .unwrap_err()
            .contains("measure map"));
        assert!(
            api("/api/compile", bytes).is_ok(),
            "Optional following must not narrow the playback contract"
        );
        assert!(content_type_allowed(
            "/api/notation-navigation",
            "application/json"
        ));
    }
    #[test]
    fn piano_fingering_api_preserves_sources_defaults_and_physical_target_ids() {
        let mut score = score_core::catalog().remove(0);
        score.parts[0].notes.truncate(1);
        let mut other = score.parts[0].clone();
        other.id = "other-part".into();
        other.notes[0].id = "other-source".into();
        score.parts.push(other);
        let original = serde_json::to_value(&score).unwrap();
        let request = json!({"score":score,"profile":{"kind":"piano","key_count":88,"lowest_midi":null},"locks":[{"source_note_id":"other-source","hand":"left","finger":3}]});
        let result = api(
            "/api/fingering/piano",
            serde_json::to_vec(&request).unwrap(),
        )
        .unwrap();
        assert_eq!(result["version"], 1);
        assert_eq!(result["status"], "ready");
        assert_eq!(result["complete"], true);
        assert_eq!(result["changed_source_notes"], false);
        assert_eq!(result["source_occurrence_count"], 2);
        assert_eq!(result["physical_target_count"], 1);
        assert_eq!(result["left_hand"]["max_span_semitones"], 12);
        assert_eq!(result["assignments"][0]["hand"], "left");
        assert_eq!(result["assignments"][0]["finger"], 3);
        assert_eq!(
            result["assignments"][0]["source_note_ids"]
                .as_array()
                .unwrap()
                .len(),
            2
        );
        assert_eq!(request["score"], original);
        let compiled = api(
            "/api/compile",
            serde_json::to_vec(&request["score"]).unwrap(),
        )
        .unwrap();
        let targets = api(
            "/api/practice-targets",
            serde_json::to_vec(
                &json!({"timeline":compiled["timeline"],"profile":request["profile"]}),
            )
            .unwrap(),
        )
        .unwrap();
        assert_eq!(
            result["targets"][0]["target_id"],
            targets["groups"][0]["target_id"]
        );
        assert_eq!(
            result["targets"][0]["source_occurrence_ids"],
            targets["groups"][0]["source_occurrence_ids"]
        );
        assert!(content_type_allowed(
            "/api/fingering/piano",
            "application/json"
        ));
        let mut invalid = request.clone();
        invalid["left_hand"] = json!({"lowest_midi":0,"highest_midi":127,"max_span_semitones":25});
        assert!(api(
            "/api/fingering/piano",
            serde_json::to_vec(&invalid).unwrap()
        )
        .is_err());
        invalid = request;
        invalid["locks"][0]["finger"] = json!(0);
        assert!(api(
            "/api/fingering/piano",
            serde_json::to_vec(&invalid).unwrap()
        )
        .is_err());
    }
    #[test]
    fn piano_fingering_api_keeps_infeasible_target_map_without_partial_assignments() {
        let mut score = score_core::catalog().remove(0);
        score.parts[0].notes.truncate(1);
        let source_id = score.parts[0].notes[0].id.clone();
        let request = json!({"score":score,"profile":{"kind":"piano","key_count":12,"lowest_midi":0},"locks":[{"source_note_id":source_id,"hand":"right"}]});
        let result = api(
            "/api/fingering/piano",
            serde_json::to_vec(&request).unwrap(),
        )
        .unwrap();
        assert_eq!(result["status"], "infeasible_under_model");
        assert_eq!(result["complete"], false);
        assert_eq!(result["assignments"], json!([]));
        assert_eq!(result["targets"].as_array().unwrap().len(), 1);
        assert_eq!(result["issues"][0]["source_note_ids"], json!([source_id]));
    }
    #[test]
    fn ordinary_api_compile_and_export_remain_compatible() {
        let score = score_core::catalog().into_iter().next().unwrap();
        let bytes = serde_json::to_vec(&score).unwrap();
        let compiled = api("/api/compile", bytes.clone()).unwrap();
        assert_eq!(compiled["score"]["id"], score.id);
        let exported = api("/api/export/musicxml", bytes).unwrap();
        assert!(exported["xml"]
            .as_str()
            .unwrap()
            .contains("<score-partwise"));
    }
}
