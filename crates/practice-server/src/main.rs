use serde::Deserialize;
use serde_json::json;
use std::{env, io::Read, time::Duration};
use tiny_http::{Header, Method, Request, Response, Server, StatusCode};
include!(concat!(env!("OUT_DIR"), "/web_assets.rs"));
const MAX_BODY: usize = 8 * 1024 * 1024;
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
fn header(name: &str, value: &str) -> Header {
    Header::from_bytes(name, value).expect("static safe header")
}
fn reply(request: Request, status: u16, content_type: &str, body: Vec<u8>) {
    let response=Response::from_data(body).with_status_code(StatusCode(status))
        .with_header(header("Content-Type",content_type))
        .with_header(header("X-Content-Type-Options","nosniff"))
        .with_header(header("Cache-Control","no-store"))
        .with_header(header("Referrer-Policy","no-referrer"))
        .with_header(header("Cross-Origin-Resource-Policy","same-origin"))
        .with_header(header("Content-Security-Policy","default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' blob: data:; connect-src 'self'; media-src 'self' blob:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'"));
    let _ = request.respond(response);
}
fn json_reply(request: Request, result: Result<serde_json::Value, String>) {
    match result {
        Ok(value) => reply(
            request,
            200,
            "application/json; charset=utf-8",
            serde_json::to_vec(&value).unwrap(),
        ),
        Err(error) => reply(
            request,
            400,
            "application/json; charset=utf-8",
            serde_json::to_vec(&json!({"error":error})).unwrap(),
        ),
    }
}
fn body(request: &mut Request) -> Result<Vec<u8>, String> {
    if request.body_length().is_some_and(|n| n > MAX_BODY) {
        return Err("Import exceeds 8 MiB limit".into());
    }
    let mut bytes = vec![];
    request
        .as_reader()
        .take((MAX_BODY + 1) as u64)
        .read_to_end(&mut bytes)
        .map_err(|_| "Cannot read request body")?;
    if bytes.len() > MAX_BODY {
        return Err("Import exceeds 8 MiB limit".into());
    }
    Ok(bytes)
}
fn route(mut request: Request, authority: &str) {
    let host = request
        .headers()
        .iter()
        .find(|h| h.field.equiv("Host"))
        .map(|h| h.value.as_str());
    let origin = request
        .headers()
        .iter()
        .find(|h| h.field.equiv("Origin"))
        .map(|h| h.value.as_str());
    let expected = format!("http://{authority}");
    if host != Some(authority) || origin.is_some_and(|o| o != expected) {
        reply(
            request,
            403,
            "text/plain; charset=utf-8",
            b"Local same-origin requests only".to_vec(),
        );
        return;
    }
    let path = request.url().split('?').next().unwrap_or("/").to_owned();
    if request.method() == &Method::Get {
        match path.as_str() {
            "/api/health" => json_reply(
                request,
                Ok(
                    json!({"name":"WorldMusicHub","version":env!("CARGO_PKG_VERSION"),"engine":"rust","network":"loopback-only"}),
                ),
            ),
            "/api/catalog" => json_reply(
                request,
                serde_json::to_value(score_core::catalog()).map_err(|e| e.to_string()),
            ),
            _ => {
                let asset = if path == "/" { "/index.html" } else { &path };
                if let Some(bytes) = web_asset(asset) {
                    let mime = if asset.ends_with(".html") {
                        "text/html; charset=utf-8"
                    } else if asset.ends_with(".css") {
                        "text/css; charset=utf-8"
                    } else if asset.ends_with(".js") {
                        "text/javascript; charset=utf-8"
                    } else if asset.ends_with(".svg") {
                        "image/svg+xml"
                    } else {
                        "application/octet-stream"
                    };
                    reply(request, 200, mime, bytes.to_vec());
                } else {
                    reply(
                        request,
                        404,
                        "text/plain; charset=utf-8",
                        b"Not found".to_vec(),
                    );
                }
            }
        }
    } else if request.method() == &Method::Post && path.starts_with("/api/") {
        let content_type = request
            .headers()
            .iter()
            .find(|h| h.field.equiv("Content-Type"))
            .map(|h| h.value.as_str())
            .unwrap_or("");
        if !(path == "/api/import/mxl"
            && matches!(
                content_type,
                "application/vnd.recordare.musicxml"
                    | "application/zip"
                    | "application/octet-stream"
            ))
            && !(path == "/api/import/image"
                && matches!(
                    content_type,
                    "image/png" | "image/jpeg" | "application/octet-stream"
                ))
            && !content_type.starts_with("application/json")
            && !(path == "/api/import/musicxml"
                && (content_type.starts_with("application/xml")
                    || content_type.starts_with("text/xml")))
        {
            reply(
                request,
                415,
                "text/plain; charset=utf-8",
                b"Expected application/json or MusicXML application/xml".to_vec(),
            );
            return;
        }
        let result = body(&mut request).and_then(|bytes| match path.as_str() {
            "/api/compile" => serde_json::from_slice(&bytes)
                .map_err(|e| format!("Invalid score JSON: {e}"))
                .and_then(score_core::compile)
                .and_then(|c| serde_json::to_value(c).map_err(|e| e.to_string())),
            "/api/practice-window" => serde_json::from_slice::<WindowRequest>(&bytes)
                .map_err(|e| format!("Invalid loop request: {e}"))
                .and_then(|r| score_core::practice::practice_window(&r.score, r.from, r.to))
                .and_then(|r| serde_json::to_value(r).map_err(|e| e.to_string())),
            "/api/instrument-check" => serde_json::from_slice::<InstrumentRequest>(&bytes)
                .map_err(|e| format!("Invalid instrument request: {e}"))
                .and_then(|r| score_core::instruments::analyze_instrument(&r.timeline, &r.profile))
                .and_then(|r| serde_json::to_value(r).map_err(|e| e.to_string())),
            "/api/import/mxl" => score_core::import_mxl(&bytes)
                .and_then(|(score, warnings)| {
                    score_core::compile(score).map(|mut c| {
                        c.diagnostics.extend(warnings);
                        c
                    })
                })
                .and_then(|c| serde_json::to_value(c).map_err(|e| e.to_string())),
            "/api/import/image" => score_core::omr::analyze_image(&bytes)
                .and_then(|review| serde_json::to_value(review).map_err(|e| e.to_string())),
            "/api/import/musicxml" => String::from_utf8(bytes)
                .map_err(|_| {
                    "MusicXML must be UTF-8; convert the source encoding first".to_string()
                })
                .and_then(|xml| score_core::import_musicxml(&xml))
                .and_then(|(score, warnings)| {
                    score_core::compile(score).map(|mut c| {
                        c.diagnostics.extend(warnings);
                        c
                    })
                })
                .and_then(|c| serde_json::to_value(c).map_err(|e| e.to_string())),
            "/api/assess" => serde_json::from_slice::<AssessRequest>(&bytes)
                .map_err(|e| format!("Invalid performance JSON: {e}"))
                .and_then(|r| score_core::assess(&r.timeline, &r.inputs, r.tolerance_ms))
                .and_then(|a| serde_json::to_value(a).map_err(|e| e.to_string())),
            _ => Err("Unknown API route".into()),
        });
        json_reply(request, result);
    } else {
        reply(
            request,
            405,
            "text/plain; charset=utf-8",
            b"Method not allowed".to_vec(),
        );
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
    let server = Server::http(&authority).unwrap_or_else(|e| {
        eprintln!("Cannot start WorldMusicHub at {authority}: {e}. Try --port 7879.");
        std::process::exit(1)
    });
    let url = format!("http://{authority}");
    println!("WorldMusicHub {}\nOpen {url}\nRust engine · local files stay on this computer · Ctrl+C to stop",env!("CARGO_PKG_VERSION"));
    if !args.iter().any(|s| s == "--no-open") {
        open_browser(&url);
    }
    loop {
        match server.recv_timeout(Duration::from_secs(1)) {
            Ok(Some(request)) => route(request, &authority),
            Ok(None) => {}
            Err(error) => {
                eprintln!("Request error: {error}");
            }
        }
    }
}
