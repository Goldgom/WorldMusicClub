//! Socket-free native protocol driver for synthetic acceptance and private
//! read-only input verification. Storage root is process configuration only.
use base64::{engine::general_purpose::STANDARD, Engine};
use http::Request;
use serde_json::{json, Value};
use std::io::{self, BufRead, Write};
use worldmusichub_desktop::{dispatch_with_library, native_library::NativeLibrary, ORIGIN};

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let root = std::env::args()
        .nth(1)
        .ok_or("Pass an absolute isolated native library root")?;
    let library = NativeLibrary::open(root).map_err(|e| e.error)?;
    let mut stdout = io::stdout().lock();
    for line in io::stdin().lock().lines() {
        let line = line?;
        if line.len() > 180 * 1024 * 1024 {
            return Err("Driver request envelope exceeds 180 MiB".into());
        }
        let input: Value = serde_json::from_str(&line)?;
        let mut request = Request::builder()
            .method(input["method"].as_str().unwrap_or("POST"))
            .uri(format!(
                "{ORIGIN}{}",
                input["path"].as_str().ok_or("Missing path")?
            ));
        if let Some(headers) = input["headers"].as_object() {
            for (key, value) in headers {
                request = request.header(key, value.as_str().ok_or("Header must be text")?);
            }
        }
        let body = if let Some(text) = input["body_base64"].as_str() {
            STANDARD.decode(text)?
        } else {
            input["body_utf8"]
                .as_str()
                .unwrap_or("")
                .as_bytes()
                .to_vec()
        };
        let response = dispatch_with_library(request.body(body)?, &library);
        writeln!(
            stdout,
            "{}",
            json!({"status":response.status().as_u16(),"content_type":response.headers()["content-type"].to_str()?,"body_base64":STANDARD.encode(response.body())})
        )?;
        stdout.flush()?;
    }
    Ok(())
}
