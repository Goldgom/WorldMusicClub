//! Android transport reuses the canonical Rust engine and bounded native archive.
use base64::{engine::general_purpose::STANDARD, Engine};
use http::{Request, Response};
use serde_json::json;
use worldmusichub_desktop::{
    dispatch, dispatch_with_library, error, native_library::NativeLibrary,
};

pub const MAX_BRIDGE_BODY: usize = 8 * 1024 * 1024;
pub const MAX_BRIDGE_HEADERS: usize = 8192;

pub fn handle(
    method: &str,
    uri: &str,
    headers_json: &str,
    encoded: &str,
    library: Option<&NativeLibrary>,
) -> Response<Vec<u8>> {
    if headers_json.len() > MAX_BRIDGE_HEADERS {
        return error(400, "Invalid Android request headers");
    }
    let headers =
        match serde_json::from_str::<std::collections::BTreeMap<String, String>>(headers_json) {
            Ok(headers) if headers.len() <= 32 => headers,
            _ => return error(400, "Invalid Android request headers"),
        };
    if encoded.len() > MAX_BRIDGE_BODY.div_ceil(3) * 4 {
        return error(
            413,
            "Android request exceeds 8 MiB; no source was discarded",
        );
    }
    let body = match STANDARD.decode(encoded) {
        Ok(body) if body.len() <= MAX_BRIDGE_BODY => body,
        Ok(_) => {
            return error(
                413,
                "Android request exceeds 8 MiB; no source was discarded",
            )
        }
        Err(_) => return error(400, "Invalid Android request encoding"),
    };
    let mut builder = Request::builder().method(method).uri(uri);
    for (name, value) in headers {
        builder = builder.header(name, value);
    }
    let request = match builder.body(body) {
        Ok(request) => request,
        Err(_) => return error(400, "Invalid Android request"),
    };
    match library {
        Some(library) => dispatch_with_library(request, library),
        None => dispatch(request),
    }
}

pub fn envelope(response: Response<Vec<u8>>) -> String {
    let headers: std::collections::BTreeMap<_, _> = response
        .headers()
        .iter()
        .filter_map(|(key, value)| value.to_str().ok().map(|value| (key.as_str(), value)))
        .collect();
    json!({"status":response.status().as_u16(), "headers":headers,
        "body":STANDARD.encode(response.body())})
    .to_string()
}

#[cfg(target_os = "android")]
mod android {
    use super::*;
    use jni::{
        objects::{JClass, JString},
        sys::jstring,
        JNIEnv,
    };
    use std::sync::OnceLock;
    static LIBRARY: OnceLock<NativeLibrary> = OnceLock::new();

    // The Activity supplies its private directory, never renderer content.
    #[no_mangle]
    pub extern "system" fn Java_org_worldmusicclub_android_MainActivity_nativeInitialize(
        mut env: JNIEnv,
        _class: JClass,
        root: JString,
    ) -> jstring {
        let result = (|| -> Result<(), String> {
            let root: String = env.get_string(&root).map_err(|e| e.to_string())?.into();
            let library = NativeLibrary::open(root).map_err(|e| e.error)?;
            let _ = LIBRARY.set(library);
            Ok(())
        })();
        env.new_string(result.err().unwrap_or_default())
            .map_or(std::ptr::null_mut(), |s| s.into_raw())
    }

    #[no_mangle]
    pub extern "system" fn Java_org_worldmusicclub_android_MainActivity_nativeRequest(
        mut env: JNIEnv,
        _class: JClass,
        method: JString,
        uri: JString,
        headers_json: JString,
        body: JString,
    ) -> jstring {
        let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            let mut read = |s: &JString| env.get_string(s).map(String::from);
            match (read(&method), read(&uri), read(&headers_json), read(&body)) {
                (Ok(method), Ok(uri), Ok(headers_json), Ok(body)) => {
                    handle(&method, &uri, &headers_json, &body, LIBRARY.get())
                }
                _ => error(400, "Invalid JNI request strings"),
            }
        }))
        .unwrap_or_else(|_| error(500, "The Rust operation failed; restart the app"));
        env.new_string(envelope(result))
            .map_or(std::ptr::null_mut(), |s| s.into_raw())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    const ORIGIN: &str = worldmusichub_desktop::ORIGIN;

    #[test]
    fn binary_import_and_engine_status_are_identical() {
        let bytes = b"invalid MIDI\0\xff";
        let request = Request::builder()
            .method("POST")
            .uri(format!("{ORIGIN}/api/import/midi"))
            .header("content-type", "audio/midi")
            .body(bytes.to_vec())
            .unwrap();
        let expected = dispatch(request);
        let actual = handle(
            "POST",
            &format!("{ORIGIN}/api/import/midi"),
            r#"{"content-type":"audio/midi"}"#,
            &STANDARD.encode(bytes),
            None,
        );
        assert_eq!(actual.status(), expected.status());
        assert_eq!(actual.body(), expected.body());
        let wire: serde_json::Value = serde_json::from_str(&envelope(actual)).unwrap();
        assert_eq!(
            STANDARD.decode(wire["body"].as_str().unwrap()).unwrap(),
            *expected.body()
        );
    }

    #[test]
    fn bridge_rejects_foreign_origins_invalid_encoding_and_oversize() {
        assert_eq!(
            handle("GET", "https://evil.example/api/health", "{}", "", None).status(),
            403
        );
        assert_eq!(
            handle(
                "POST",
                &format!("{ORIGIN}/api/compile"),
                r#"{"content-type":"application/json"}"#,
                "!",
                None
            )
            .status(),
            400
        );
        assert_eq!(
            handle(
                "POST",
                &format!("{ORIGIN}/api/compile"),
                r#"{"content-type":"application/json"}"#,
                &"A".repeat(MAX_BRIDGE_BODY.div_ceil(3) * 4 + 1),
                None
            )
            .status(),
            413
        );
        let response = handle("GET", &format!("{ORIGIN}/api/health"), "{}", "", None);
        let health: serde_json::Value = serde_json::from_slice(response.body()).unwrap();
        assert_eq!(health["engine"], "rust");
        assert_eq!(health["network"], "native-protocol-no-listener");
    }

    #[test]
    fn bridge_validates_bounded_headers_and_preserves_origin_checks() {
        let uri = format!("{ORIGIN}/api/health");
        for headers in [
            "null",
            "[]",
            "{bad",
            r#"{"x-test":42}"#,
            r#"{"bad name":"value"}"#,
            r#"{"x-test":"bad\r\nvalue"}"#,
        ] {
            assert_eq!(handle("GET", &uri, headers, "", None).status(), 400);
        }
        let many: std::collections::BTreeMap<_, _> =
            (0..33).map(|i| (format!("x-{i}"), "v")).collect();
        assert_eq!(
            handle(
                "GET",
                &uri,
                &serde_json::to_string(&many).unwrap(),
                "",
                None
            )
            .status(),
            400
        );
        assert_eq!(
            handle("GET", &uri, &" ".repeat(MAX_BRIDGE_HEADERS + 1), "", None).status(),
            400
        );
        assert_eq!(
            handle(
                "GET",
                &uri,
                r#"{"origin":"https://evil.example"}"#,
                "",
                None
            )
            .status(),
            403
        );
    }

    #[test]
    fn native_pack_import_receives_filename_conflict_policy_and_selection() {
        struct Sandbox(std::path::PathBuf);
        impl Drop for Sandbox {
            fn drop(&mut self) {
                std::fs::remove_dir_all(&self.0).unwrap();
            }
        }
        let root = Sandbox(std::env::temp_dir().join(
            format!("wmc-android-{}-{}", std::process::id(),
            std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_nanos()),
        ));
        std::fs::create_dir(&root.0).unwrap();
        let library = NativeLibrary::open(root.0.join("Scores")).unwrap();
        let body = STANDARD.encode(b"1=C4\nmeter=4/4\n1 2 3 0 |");
        let uri = format!("{ORIGIN}/api/library/import/preview");
        let mut headers = json!({"content-type":"application/octet-stream", "x-wmh-filename":"%E7%BB%83%E4%B9%A0.jianpu", "x-wmh-conflict":"keep-both", "x-wmh-item-index":"0"});
        let response = handle("POST", &uri, &headers.to_string(), &body, Some(&library));
        assert_eq!(response.status(), 200);
        let report: serde_json::Value = serde_json::from_slice(response.body()).unwrap();
        assert_eq!(report["source"]["filename"], "练习.jianpu");
        assert_eq!(report["items"][0]["status"], "ready");
        assert_eq!(report["source"]["retained"], false);
        assert!(library.list().unwrap().entries.is_empty());
        headers["x-wmh-conflict"] = json!("invalid");
        assert_eq!(
            handle("POST", &uri, &headers.to_string(), &body, Some(&library)).status(),
            400
        );
        headers["x-wmh-conflict"] = json!("skip");
        headers["x-wmh-item-index"] = json!("invalid");
        assert_eq!(
            handle("POST", &uri, &headers.to_string(), &body, Some(&library)).status(),
            400
        );
    }
}
