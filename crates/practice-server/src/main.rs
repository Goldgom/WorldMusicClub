use bytes::Bytes;
use http_body_util::{BodyExt, Full, Limited};
use hyper::{body::Incoming, server::conn::http1, service::service_fn, Method, Request, Response};
use hyper_util::rt::{TokioIo, TokioTimer};
use serde::Deserialize;
use serde_json::json;
use std::{convert::Infallible, env, sync::Arc, time::Duration};
use tokio::{net::TcpListener, sync::Semaphore, time::timeout};
include!(concat!(env!("OUT_DIR"), "/web_assets.rs"));
const MAX_BODY: usize = 8 * 1024 * 1024;
const BODY_TIMEOUT: Duration = Duration::from_secs(5);
const CONNECTION_TIMEOUT: Duration = Duration::from_secs(30);
type WebResponse = Response<Full<Bytes>>;
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct AdaptationRequest {
    score: score_core::Score,
    operation: score_core::adaptation::OctaveOperation,
    profile: score_core::instruments::InstrumentProfile,
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct OmrConfirmationRequest {
    score: score_core::Score,
    confirmation: score_core::external_omr::ReviewConfirmation,
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct MetronomeRequest {
    score: score_core::Score,
    #[serde(default)]
    pulse: score_core::metronome::PulseMode,
}
#[derive(Deserialize)]
struct WindowRequest {
    score: score_core::Score,
    from: score_core::Beat,
    to: score_core::Beat,
}
#[derive(Deserialize)]
struct InstrumentRequest {
    timeline: score_core::Timeline,
    profile: score_core::instruments::InstrumentProfile,
}
#[derive(Deserialize)]
struct AssessRequest {
    timeline: score_core::Timeline,
    inputs: Vec<score_core::InputEvent>,
    tolerance_ms: f64,
}

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
fn json_input_error(context: &str, error: serde_json::Error) -> String {
    let detail = error.to_string();
    if error.is_data() && detail.contains("unknown field") {
        format!("Unsupported field or metadata in {context}. This file may require a newer WorldMusicHub app; it was not changed or stripped. Keep the original. Details: {detail}")
    } else {
        format!("Invalid {context}: {detail}")
    }
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
fn content_type_allowed(path: &str, content_type: &str) -> bool {
    content_type.starts_with("application/json")
        || (path == "/api/import/jianpu" && content_type.starts_with("text/plain"))
        || (path == "/api/import/midi"
            && matches!(
                content_type,
                "audio/midi" | "audio/x-midi" | "application/octet-stream"
            ))
        || (path == "/api/import/mxl"
            && matches!(
                content_type,
                "application/vnd.recordare.musicxml"
                    | "application/zip"
                    | "application/octet-stream"
            ))
        || (path == "/api/import/image"
            && matches!(
                content_type,
                "image/png" | "image/jpeg" | "application/octet-stream"
            ))
        || (path == "/api/import/musicxml"
            && (content_type.starts_with("application/xml")
                || content_type.starts_with("text/xml")))
}
async fn route(
    request: Request<Incoming>,
    authority: &str,
    computations: Arc<Semaphore>,
) -> WebResponse {
    let host = request.headers().get("host").and_then(|v| v.to_str().ok());
    let origin = request.headers().get("origin");
    let expected = format!("http://{authority}");
    if host != Some(authority) || origin.is_some_and(|o| o.to_str().ok() != Some(expected.as_str()))
    {
        return reply(
            403,
            "text/plain; charset=utf-8",
            "Local same-origin requests only",
        );
    }
    let path = request.uri().path().to_owned();
    if request.method() == Method::GET {
        return match path.as_str() {
            "/api/health" => json_reply(Ok(
                json!({"name":"WorldMusicHub","version":env!("CARGO_PKG_VERSION"),"engine":"rust","network":"loopback-only","score_format_version":1,"score_schema_revision":score_core::SCORE_SCHEMA_REVISION}),
            )),
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
    if request.method() != Method::POST || !path.starts_with("/api/") {
        return reply(405, "text/plain; charset=utf-8", "Method not allowed");
    }
    let content_type = request
        .headers()
        .get("content-type")
        .and_then(|v| v.to_str().ok())
        .unwrap_or("");
    if !content_type_allowed(&path, content_type) {
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
        return json_reply(Err("Import exceeds 8 MiB limit".into()));
    }
    // Acquire before reading/allocating a body; keep the permit through CPU work.
    let permit = match timeout(Duration::from_secs(2), computations.acquire_owned()).await {
        Ok(Ok(permit)) => permit,
        _ => {
            return reply(
                503,
                "application/json; charset=utf-8",
                r#"{"error":"The local engine is busy; retry shortly"}"#,
            )
        }
    };
    let bytes = match timeout(
        BODY_TIMEOUT,
        Limited::new(request.into_body(), MAX_BODY).collect(),
    )
    .await
    {
        Ok(Ok(body)) => body.to_bytes().to_vec(),
        Ok(Err(_)) => {
            return json_reply(Err(
                "Cannot read request body or import exceeds 8 MiB limit".into(),
            ))
        }
        Err(_) => {
            return reply(
                408,
                "application/json; charset=utf-8",
                r#"{"error":"Request body timed out"}"#,
            )
        }
    };
    // Imported-score processing cannot stall static assets or the asynchronous I/O threads.
    match tokio::task::spawn_blocking(move || {
        let _permit = permit;
        api(&path, bytes)
    })
    .await
    {
        Ok(result) => json_reply(result),
        Err(_) => reply(
            500,
            "application/json; charset=utf-8",
            r#"{"error":"The score operation failed"}"#,
        ),
    }
}
fn api(path: &str, bytes: Vec<u8>) -> Result<serde_json::Value, String> {
    match path {
        "/api/omr/audiveris-draft" => {
            serde_json::from_slice::<score_core::external_omr::AudiverisInput>(&bytes)
                .map_err(|e| json_input_error("external OMR input", e))
                .and_then(score_core::external_omr::prepare_audiveris)
                .and_then(|r| serde_json::to_value(r).map_err(|e| e.to_string()))
        }
        "/api/omr/confirm" => serde_json::from_slice::<OmrConfirmationRequest>(&bytes)
            .map_err(|e| json_input_error("OMR review confirmation", e))
            .and_then(|r| score_core::external_omr::confirm_review(r.score, r.confirmation))
            .and_then(|r| serde_json::to_value(r).map_err(|e| e.to_string())),
        "/api/adaptation/preview" => serde_json::from_slice::<AdaptationRequest>(&bytes)
            .map_err(|e| json_input_error("adaptation request", e))
            .and_then(|r| {
                score_core::adaptation::preview_octaves(&r.score, r.operation, &r.profile)
            })
            .and_then(|r| serde_json::to_value(r).map_err(|e| e.to_string())),
        "/api/adaptation/restore" => serde_json::from_slice::<score_core::Score>(&bytes)
            .map_err(|e| json_input_error("adapted score", e))
            .and_then(|score| score_core::adaptation::restore_original(&score))
            .and_then(|r| serde_json::to_value(r).map_err(|e| e.to_string())),
        "/api/compile" => serde_json::from_slice(&bytes)
            .map_err(|e| json_input_error("score JSON", e))
            .and_then(score_core::compile)
            .and_then(|c| serde_json::to_value(c).map_err(|e| e.to_string())),
        "/api/notation-navigation" => serde_json::from_slice::<score_core::Score>(&bytes)
            .map_err(|e| json_input_error("notation navigation score", e))
            .and_then(score_core::navigation::notation_navigation)
            .and_then(|r| serde_json::to_value(r).map_err(|e| e.to_string())),
        "/api/metronome" => serde_json::from_slice::<MetronomeRequest>(&bytes)
            .map_err(|e| json_input_error("metronome request", e))
            .and_then(|r| score_core::metronome::metronome_grid(r.score, r.pulse))
            .and_then(|r| serde_json::to_value(r).map_err(|e| e.to_string())),
        "/api/practice-window" => serde_json::from_slice::<WindowRequest>(&bytes)
            .map_err(|e| json_input_error("loop request", e))
            .and_then(|r| score_core::practice::practice_window(&r.score, r.from, r.to))
            .and_then(|r| serde_json::to_value(r).map_err(|e| e.to_string())),
        "/api/practice-targets" => serde_json::from_slice::<InstrumentRequest>(&bytes)
            .map_err(|e| json_input_error("target request", e))
            .and_then(|r| score_core::targets::plan_targets(&r.timeline, &r.profile))
            .and_then(|r| serde_json::to_value(r).map_err(|e| e.to_string())),
        "/api/instrument-check" => serde_json::from_slice::<InstrumentRequest>(&bytes)
            .map_err(|e| json_input_error("instrument request", e))
            .and_then(|r| score_core::instruments::analyze_instrument(&r.timeline, &r.profile))
            .and_then(|r| serde_json::to_value(r).map_err(|e| e.to_string())),
        "/api/export/jianpu" => serde_json::from_slice::<score_core::Score>(&bytes)
            .map_err(|e| json_input_error("score JSON", e))
            .and_then(|score| score_core::export_jianpu(&score))
            .and_then(|result| serde_json::to_value(result).map_err(|e| e.to_string())),
        "/api/export/musicxml" => serde_json::from_slice::<score_core::Score>(&bytes)
            .map_err(|e| json_input_error("score JSON", e))
            .and_then(|score| score_core::export_musicxml(&score))
            .and_then(|result| serde_json::to_value(result).map_err(|e| e.to_string())),
        "/api/import/jianpu" => String::from_utf8(bytes)
            .map_err(|_| "Jianpu text must be UTF-8".to_string())
            .and_then(|text| score_core::import_jianpu(&text))
            .and_then(|(score, _warnings)| score_core::compile(score))
            .and_then(|c| serde_json::to_value(c).map_err(|e| e.to_string())),
        "/api/import/midi" => score_core::import_midi(&bytes)
            .and_then(|(score, _warnings)| score_core::compile(score))
            .and_then(|c| serde_json::to_value(c).map_err(|e| e.to_string())),
        "/api/import/mxl" => score_core::import_mxl(&bytes)
            .and_then(|(score, _warnings)| score_core::compile(score))
            .and_then(|c| serde_json::to_value(c).map_err(|e| e.to_string())),
        "/api/import/image" => score_core::omr::analyze_image(&bytes)
            .and_then(|review| serde_json::to_value(review).map_err(|e| e.to_string())),
        "/api/import/musicxml" => String::from_utf8(bytes)
            .map_err(|_| "MusicXML must be UTF-8; convert the source encoding first".to_string())
            .and_then(|xml| score_core::import_musicxml(&xml))
            .and_then(|(score, _warnings)| score_core::compile(score))
            .and_then(|c| serde_json::to_value(c).map_err(|e| e.to_string())),
        "/api/assess" => serde_json::from_slice::<AssessRequest>(&bytes)
            .map_err(|e| json_input_error("performance JSON", e))
            .and_then(|r| score_core::assess(&r.timeline, &r.inputs, r.tolerance_ms))
            .and_then(|a| serde_json::to_value(a).map_err(|e| e.to_string())),
        _ => Err("Unknown API route".into()),
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
fn main() {
    let args: Vec<String> = env::args().collect();
    if args.iter().any(|s| s == "--help") {
        println!("WorldMusicHub [--port 7878] [--no-open]\nLocal-only Rust music practice app. Close this terminal to stop.");
        return;
    }
    let port = args
        .iter()
        .position(|s| s == "--port")
        .map(|i| {
            args.get(i + 1)
                .and_then(|s| s.parse::<u16>().ok())
                .filter(|p| *p > 0)
                .unwrap_or_else(|| {
                    eprintln!("--port requires a number from 1 to 65535");
                    std::process::exit(2)
                })
        })
        .unwrap_or(7878);
    let authority = format!("127.0.0.1:{port}");

    let runtime = tokio::runtime::Builder::new_multi_thread()
        .worker_threads(2)
        .max_blocking_threads(2)
        .enable_all()
        .build()
        .expect("local app runtime");
    runtime.block_on(async {
        let listener = TcpListener::bind(&authority).await.unwrap_or_else(|e| {
            eprintln!("Cannot start WorldMusicHub at {authority}: {e}. Try --port 7879.");
            std::process::exit(1)
        });
        let url = format!("http://{authority}");
        println!("WorldMusicHub {}\nOpen {url}\nRust engine · local files stay on this computer · Ctrl+C to stop",env!("CARGO_PKG_VERSION"));
        if !args.iter().any(|s| s == "--no-open") { open_browser(&url); }
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
                let service = service_fn(move |request| {
                    let authority = authority.clone();
                    let computations = computations.clone();
                    async move { Ok::<_, Infallible>(route(request, &authority, computations).await) }
                });
                let mut builder = http1::Builder::new();
                builder.timer(TokioTimer::new()).header_read_timeout(Duration::from_secs(5)).max_buf_size(32 * 1024).max_headers(64).keep_alive(false);
                // Closing drops an unfinished Incoming body instead of draining it synchronously.
                let _ = timeout(CONNECTION_TIMEOUT, builder.serve_connection(TokioIo::new(stream), service)).await;
            });
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn unknown_score_metadata_reports_compatibility_without_rewriting_input() {
        let mut value = serde_json::to_value(score_core::catalog().remove(0)).unwrap();
        value["future_notation_metadata"] = json!({"version":2});
        let bytes = serde_json::to_vec(&value).unwrap();
        let original = bytes.clone();
        let error = api("/api/compile", bytes.clone()).unwrap_err();
        assert!(error.contains("may require a newer WorldMusicHub"));
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
