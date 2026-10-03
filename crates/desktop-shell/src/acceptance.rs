//! Process-owner-only Windows acceptance evidence. Never enabled by page content.
use crate::{error, response};
use http::{Request, Response};
use serde_json::{json, Value};
use std::{
    path::{Path, PathBuf},
    sync::Mutex,
    time::Instant,
};

pub const PHASES: [&str; 4] = ["seed", "restart", "close-active", "reopen"];
pub const FOLDER_PHASES: [&str; 3] = ["folder-seed", "folder-restart", "folder-failure"];
pub const BULK_PHASES: [&str; 3] = ["bulk-seed", "bulk-restart", "bulk-failure"];
pub struct Acceptance {
    directory: PathBuf,
    pub phase: &'static str,
    downloads: Mutex<Vec<Value>>,
    trace: Mutex<Vec<Value>>,
    started: Instant,
}
impl Acceptance {
    pub fn new(directory: PathBuf, phase: &str) -> Result<Self, &'static str> {
        let phase = PHASES
            .into_iter()
            .chain(FOLDER_PHASES)
            .chain(BULK_PHASES)
            .find(|candidate| *candidate == phase)
            .ok_or("Unknown acceptance phase")?;
        std::fs::create_dir_all(directory.join("downloads"))
            .map_err(|_| "Cannot create acceptance directory")?;
        Ok(Self {
            directory,
            phase,
            downloads: Mutex::new(Vec::new()),
            trace: Mutex::new(Vec::new()),
            started: Instant::now(),
        })
    }
    pub fn script(&self) -> String {
        format!(
            "globalThis.__WMH_ACCEPTANCE_PHASE__={};\n{}\n{}\n{}",
            serde_json::to_string(self.phase).unwrap(),
            include_str!("../acceptance-wait.js"),
            include_str!("../reference-acceptance.js"),
            if BULK_PHASES.contains(&self.phase) {
                include_str!("../bulk-import-acceptance.js")
            } else if FOLDER_PHASES.contains(&self.phase) {
                include_str!("../song-folder-acceptance.js")
            } else {
                include_str!("../acceptance.js")
            }
        )
    }
    pub fn report_name(&self) -> String {
        format!("renderer-{}.json", self.phase)
    }
    fn trace(&self, event: Value) {
        let Ok(mut rows) = self.trace.lock() else {
            return;
        };
        if rows.last().is_some_and(|row| row["event"] == event) {
            return;
        }
        if rows.len() == 128 {
            rows.remove(0);
        }
        rows.push(json!({"elapsed_ms":self.started.elapsed().as_millis(),"event":event}));
        let bytes =
            serde_json::to_vec(&json!({"version":1,"phase":self.phase,"events":*rows})).unwrap();
        if atomic_json(
            &self.directory,
            &format!("trace-{}.json", self.phase),
            &bytes,
        )
        .is_err()
        {
            eprintln!("Cannot save native acceptance trace");
        }
    }
    pub fn trace_request(&self, stage: &str, path: &str, status: Option<u16>) {
        if path != "/__desktop_smoke/progress"
            && (path.starts_with("/__desktop_smoke/") || path.starts_with("/api/"))
        {
            self.trace(json!({"source":"host","stage":stage,"path":path.chars().take(128).collect::<String>(),"status":status}));
        }
    }
    pub fn download(&self, name: &str) -> Option<PathBuf> {
        let mut rows = self.downloads.lock().ok()?;
        if rows.len() >= 16 {
            return None;
        }
        let extension =
            if BULK_PHASES.contains(&self.phase) && name.to_lowercase().ends_with(".zip") {
                "zip"
            } else {
                "json"
            };
        let file = format!("{}-{}.{extension}", self.phase, rows.len() + 1);
        rows.push(json!({"file":file,"suggested_name":name.chars().take(160).collect::<String>(),"complete":false,"success":false}));
        Some(self.directory.join("downloads").join(file))
    }
    pub fn downloaded(&self, path: Option<&Path>, success: bool) {
        let Ok(mut rows) = self.downloads.lock() else {
            return;
        };
        if let Some(row) = rows.iter_mut().find(|row| {
            path == Some(
                self.directory
                    .join("downloads")
                    .join(row["file"].as_str().unwrap_or(""))
                    .as_path(),
            )
        }) {
            row["complete"] = json!(true);
            row["success"] = json!(success);
        }
    }
    pub fn handle(&self, request: &Request<Vec<u8>>) -> Option<Response<Vec<u8>>> {
        let path = request.uri().path();
        let result = if path == "/__desktop_smoke/progress" && request.method() == "POST" {
            if request.body().len() > 1024 {
                return Some(error(400, "Invalid acceptance progress"));
            }
            let value = serde_json::from_slice::<Value>(request.body());
            let Ok(value) = value else {
                return Some(error(400, "Invalid acceptance progress"));
            };
            if !valid_progress(&value) {
                return Some(error(400, "Invalid acceptance progress"));
            }
            self.trace(json!({"source":"renderer","checkpoint":value}));
            json!({})
        } else if path == "/__desktop_smoke/state" && request.method() == "GET" {
            let Ok(downloads) = self.downloads.lock() else {
                return Some(error(500, "Cannot read acceptance state"));
            };
            json!({"phase":self.phase,"downloads":*downloads})
        } else if path == "/__desktop_smoke/action" && request.method() == "POST" {
            let Ok(value) = serde_json::from_slice::<Value>(request.body()) else {
                return Some(error(400, "Invalid acceptance action"));
            };
            if !valid_action(&value) {
                return Some(error(400, "Invalid acceptance action"));
            }
            let name = format!(
                "action-{}-{}.json",
                self.phase,
                value["sequence"].as_u64().unwrap()
            );
            if atomic_json(&self.directory, &name, request.body()).is_err() {
                return Some(error(500, "Cannot save acceptance action"));
            }
            json!({})
        } else {
            let sequence = path.strip_prefix("/__desktop_smoke/result/")?;
            let Ok(sequence) = sequence.parse::<u64>() else {
                return Some(error(400, "Invalid action sequence"));
            };
            if !(1..=64).contains(&sequence) || request.method() != "GET" {
                return Some(error(400, "Invalid action sequence"));
            }
            let name = format!("result-{}-{sequence}.json", self.phase);
            let Ok(bytes) = std::fs::read(self.directory.join(name)) else {
                return Some(error(404, "Action pending"));
            };
            if bytes.len() > 4096 {
                return Some(error(500, "Invalid action result"));
            }
            let Ok(value) = serde_json::from_slice::<Value>(&bytes) else {
                return Some(error(500, "Invalid action result"));
            };
            value
        };
        Some(response(
            200,
            "application/json",
            serde_json::to_vec(&result).unwrap(),
        ))
    }
}
fn valid_progress(value: &Value) -> bool {
    let Some(object) = value.as_object() else {
        return false;
    };
    object
        .keys()
        .all(|key| ["version", "stage", "sequence", "path", "status"].contains(&key.as_str()))
        && value["version"] == 1
        && value["sequence"]
            .as_u64()
            .is_some_and(|sequence| sequence <= 64)
        && [
            "api-start",
            "api-response",
            "api-body",
            "api-body-error",
            "api-error",
            "native-action-posting",
            "native-result-wait",
            "native-result-headers",
            "native-result-read",
            "picker-change",
            "picker-cancel",
            "picker-event-observed",
            "import-compiled",
            "renderer-error",
            "renderer-report-posting",
            "renderer-report-sent",
        ]
        .contains(&value["stage"].as_str().unwrap_or(""))
        && (!object.contains_key("path")
            || value["path"]
                .as_str()
                .is_some_and(|path| path.starts_with("/api/") && path.len() <= 128))
        && (!object.contains_key("status")
            || value["status"]
                .as_u64()
                .is_some_and(|status| (100..=599).contains(&status)))
}
pub fn atomic_json(directory: &Path, name: &str, bytes: &[u8]) -> std::io::Result<()> {
    let temporary = directory.join(format!("{name}.tmp"));
    std::fs::write(&temporary, bytes)?;
    std::fs::rename(temporary, directory.join(name))
}
fn valid_action(value: &Value) -> bool {
    let Some(object) = value.as_object() else {
        return false;
    };
    if object.keys().any(|key| {
        ![
            "version", "sequence", "kind", "x", "y", "width", "height", "file",
        ]
        .contains(&key.as_str())
    }) || value["version"] != 1
    {
        return false;
    }
    if !value["sequence"]
        .as_u64()
        .is_some_and(|sequence| (1..=64).contains(&sequence))
    {
        return false;
    }
    if ![
        "picker",
        "cancel-picker",
        "key-r",
        "minimize-restore",
        "escape",
        "click",
    ]
    .contains(&value["kind"].as_str().unwrap_or(""))
    {
        return false;
    }
    for field in ["x", "y", "width", "height"] {
        if !value[field]
            .as_f64()
            .is_some_and(|n| n.is_finite() && n > 0.0 && n < 20000.0)
        {
            return false;
        }
    }
    if value["kind"] == "picker" {
        let file = value["file"].as_str().unwrap_or("");
        let fixture = [
            "original-duet.musicxml",
            "original-duet.mxl",
            "midi-original-ppq.mid",
            "original-reference-overlap.mid",
            "jianpu-original-steps.jianpu",
            "malformed.json",
            "folder-original.json",
            "folder-conflict.json",
            "原创曲包_日本語.zip",
            "bulk-conflict.zip",
            "bulk-backup.json",
            "bulk-failure.zip",
            "bulk-malformed.zip",
            "bulk-multiple",
            "bulk-standard-a.json",
            "bulk-standard-b.json",
        ]
        .contains(&file);
        let download = PHASES.iter().any(|phase| {
            file.strip_prefix(&format!("{phase}-"))
                .and_then(|n| n.strip_suffix(".json"))
                .and_then(|n| n.parse::<u8>().ok())
                .is_some_and(|n| (1..=16).contains(&n))
        });
        let bulk_download = BULK_PHASES.iter().any(|phase| {
            file.strip_prefix(&format!("{phase}-"))
                .and_then(|n| n.strip_suffix(".json").or_else(|| n.strip_suffix(".zip")))
                .and_then(|n| n.parse::<u8>().ok())
                .is_some_and(|n| (1..=16).contains(&n))
        });
        if !fixture && !download && !bulk_download {
            return false;
        }
    } else if object.contains_key("file") {
        return false;
    }
    true
}
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn bulk_phases_keep_zip_downloads_and_finite_picker_actions() {
        let evidence = Evidence::new();
        for phase in BULK_PHASES {
            let acceptance = Acceptance::new(evidence.0.clone(), phase).unwrap();
            assert!(acceptance
                .script()
                .contains("Native bulk control unavailable"));
            assert!(acceptance
                .download("original.zip")
                .unwrap()
                .ends_with(format!("{phase}-1.zip")));
            assert!(acceptance
                .download("backup.json")
                .unwrap()
                .ends_with(format!("{phase}-2.json")));
        }
        for file in [
            "原创曲包_日本語.zip",
            "bulk-multiple",
            "bulk-seed-1.zip",
            "bulk-restart-16.json",
        ] {
            assert!(valid_action(
                &json!({"version":1,"sequence":1,"kind":"picker","x":1,"y":1,"width":900,"height":640,"file":file})
            ));
        }
        for file in [
            "bulk-seed-17.zip",
            "bulk-anything-1.zip",
            "../bulk-conflict.zip",
        ] {
            assert!(!valid_action(
                &json!({"version":1,"sequence":1,"kind":"picker","x":1,"y":1,"width":900,"height":640,"file":file})
            ));
        }
        assert!(Acceptance::new(evidence.0.clone(), "bulk-anything").is_err());
        assert!(!crate::song_pack::is_large_operation("/api/compile"));
        assert!(crate::song_pack::is_large_operation(
            "/api/library/import/commit"
        ));
    }
    struct Evidence(PathBuf);
    impl Evidence {
        fn new() -> Self {
            static NEXT: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);
            Self(std::env::temp_dir().join(format!(
                "wmh-acceptance-{}-{}",
                std::process::id(),
                NEXT.fetch_add(1, std::sync::atomic::Ordering::Relaxed)
            )))
        }
    }
    impl Drop for Evidence {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.0);
        }
    }
    #[test]
    fn pending_and_diagnostic_rich_results_keep_the_existing_response_contract() {
        let evidence = Evidence::new();
        let acceptance = Acceptance::new(evidence.0.clone(), "seed").unwrap();
        let request = Request::builder()
            .uri("https://wmh.localhost/__desktop_smoke/result/2")
            .body(vec![])
            .unwrap();
        assert_eq!(acceptance.handle(&request).unwrap().status(), 404);
        let mut bytes = br#"{"ok":true,"filename_native_edit":{"exact_readback":true}}"#.to_vec();
        bytes.resize(2309, b' ');
        std::fs::write(evidence.0.join("result-seed-2.json"), &bytes).unwrap();
        let result = acceptance.handle(&request).unwrap();
        assert_eq!(result.status(), 200);
        assert_eq!(
            serde_json::from_slice::<Value>(result.body()).unwrap()["ok"],
            true
        );
        bytes.resize(4097, b' ');
        std::fs::write(evidence.0.join("result-seed-2.json"), &bytes).unwrap();
        assert_eq!(acceptance.handle(&request).unwrap().status(), 500);
    }
    #[test]
    fn progress_accepts_only_bounded_stage_metadata() {
        let evidence = Evidence::new();
        let acceptance = Acceptance::new(evidence.0.clone(), "seed").unwrap();
        let progress = json!({"version":1,"stage":"picker-change","sequence":2});
        let post = |value: &Value| {
            Request::builder()
                .method("POST")
                .uri("https://wmh.localhost/__desktop_smoke/progress")
                .body(serde_json::to_vec(value).unwrap())
                .unwrap()
        };
        assert_eq!(acceptance.handle(&post(&progress)).unwrap().status(), 200);
        for (key, value) in [
            ("body", json!("score content must not enter a trace")),
            ("stage", json!("unknown")),
            ("sequence", json!(65)),
            ("path", json!("/api/".to_owned() + &"x".repeat(128))),
            ("status", json!(600)),
        ] {
            let mut invalid = progress.clone();
            invalid[key] = value;
            assert_eq!(acceptance.handle(&post(&invalid)).unwrap().status(), 400);
        }
        let bytes = std::fs::read(evidence.0.join("trace-seed.json")).unwrap();
        let trace: Value = serde_json::from_slice(&bytes).unwrap();
        assert_eq!(trace["events"].as_array().unwrap().len(), 1);
        assert_eq!(trace["events"][0]["event"]["checkpoint"], progress);
    }
    #[test]
    fn host_trace_retains_bounded_request_metadata_without_bodies() {
        let evidence = Evidence::new();
        let acceptance = Acceptance::new(evidence.0.clone(), "seed").unwrap();
        for index in 0..140 {
            acceptance.trace_request("reply-submitted", &format!("/api/test/{index}"), Some(200));
        }
        acceptance.trace_request("received", "/app.js", None);
        acceptance.trace_request("received", "/__desktop_smoke/progress", None);
        let bytes = std::fs::read(evidence.0.join("trace-seed.json")).unwrap();
        let trace: Value = serde_json::from_slice(&bytes).unwrap();
        let events = trace["events"].as_array().unwrap();
        assert_eq!(events.len(), 128);
        assert_eq!(events[0]["event"]["path"], "/api/test/12");
        assert_eq!(events[127]["event"]["path"], "/api/test/139");
        assert!(events.iter().all(|row| row["event"]
            .as_object()
            .unwrap()
            .keys()
            .all(|key| ["source", "stage", "path", "status"].contains(&key.as_str()))));
    }
    #[test]
    fn folder_scenarios_are_separate_and_keep_existing_action_limits() {
        let evidence = Evidence::new();
        assert_eq!(PHASES, ["seed", "restart", "close-active", "reopen"]);
        for phase in FOLDER_PHASES {
            let acceptance = Acceptance::new(evidence.0.clone(), phase).unwrap();
            assert!(acceptance.script().contains("wmh.folder.acceptance.marker"));
            assert!(!acceptance
                .script()
                .contains("async function saveScore(label,library)"));
            assert_eq!(acceptance.report_name(), format!("renderer-{phase}.json"));
            for sequence in [0, 65] {
                let request = Request::builder()
                    .uri(format!(
                        "https://wmh.localhost/__desktop_smoke/result/{sequence}"
                    ))
                    .body(vec![])
                    .unwrap();
                assert_eq!(acceptance.handle(&request).unwrap().status(), 400);
            }
        }
        assert!(Acceptance::new(evidence.0.clone(), "folder-anything").is_err());
        assert!(Acceptance::new(evidence.0.clone(), "seed")
            .unwrap()
            .script()
            .contains("async function saveScore(label,library)"));
        let library =
            crate::native_library::NativeLibrary::open(evidence.0.join("Scores")).unwrap();
        for (raw, expected_key) in [
            (
                include_str!("../../../tests/fixtures/folder-original.json"),
                "song-bb8051fad28349e6f49786f8a691421d297e81677abe984dbb340cb934ea1127",
            ),
            (
                include_str!("../../../tests/fixtures/folder-conflict.json"),
                "song-59713d099a383cc6736ab7c7b9f4822faf68b850b67a276a5b1fdf1694911f08",
            ),
        ] {
            let entry = library
                .save(crate::native_library::SaveRequest {
                    score_json: raw.into(),
                    label: None,
                    allow_conflicting_id: true,
                })
                .unwrap();
            assert_eq!(entry.key, expected_key);
            assert_eq!(library.load(&entry.key).unwrap().score_json, raw);
        }
    }
    #[test]
    fn acceptance_actions_are_a_finite_test_contract() {
        let mut action = json!({"version":1,"sequence":1,"kind":"picker","x":10,"y":20,"width":1280,"height":900,"file":"seed-1.json"});
        assert!(valid_action(&action));
        action["file"] = json!("original-duet.musicxml");
        assert!(valid_action(&action));
        action["file"] = json!("original-reference-overlap.mid");
        assert!(valid_action(&action));
        action["file"] = json!("../original-reference-overlap.mid");
        assert!(!valid_action(&action));
        action["file"] = json!("original-reference-overlap.mid.extra");
        assert!(!valid_action(&action));
        for file in ["folder-original.json", "folder-conflict.json"] {
            action["file"] = json!(file);
            action["sequence"] = json!(64);
            assert!(valid_action(&action));
            action["sequence"] = json!(65);
            assert!(!valid_action(&action));
        }
        action["sequence"] = json!(1);
        action["file"] = json!("../anything.json");
        assert!(!valid_action(&action));
        action["file"] = json!("seed-17.json");
        assert!(!valid_action(&action));
        action["file"] = json!("seed-1.json");
        action["sequence"] = json!(65);
        assert!(!valid_action(&action));
        action["sequence"] = json!(1);
        action["command"] = json!("anything");
        assert!(!valid_action(&action));
    }
}
