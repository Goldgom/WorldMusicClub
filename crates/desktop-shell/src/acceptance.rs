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
pub const MAX_SMOKE_REPORT_BYTES: usize = 64 * 1024;
pub const MAX_BULK_REPORT_BYTES: usize = 4 * 1024 * 1024;
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
    fn reject_bulk_report(
        &self,
        status: u16,
        code: &'static str,
        message: &'static str,
        received_bytes: usize,
    ) {
        if !BULK_PHASES.contains(&self.phase) {
            return;
        }
        // Never include rejected body content or parser/OS diagnostics. Both the
        // terminal report and independent host trace have a fixed, small schema.
        let failure = json!({
            "code": code,
            "status": status,
            "received_bytes": received_bytes,
            "limit_bytes": MAX_BULK_REPORT_BYTES,
        });
        let bytes = serde_json::to_vec(&json!({
            "version": 1,
            "phase": self.phase,
            "ok": false,
            "error": message,
            "report_failure": failure,
        }))
        .expect("constant report failure JSON");
        let saved = atomic_json(&self.directory, &self.report_name(), &bytes).is_ok();
        self.trace(json!({
            "source": "host",
            "stage": "renderer-report-rejected",
            "path": "/__desktop_smoke/report",
            "code": code,
            "status": status,
            "received_bytes": received_bytes,
            "limit_bytes": MAX_BULK_REPORT_BYTES,
            "report_saved": saved,
        }));
        if !saved {
            eprintln!("Cannot save failed bulk acceptance report: {code} (HTTP {status}, {received_bytes} bytes)");
        }
    }
    pub fn trace_report_admission_failure(&self, request: &Request<Vec<u8>>, status: u16) {
        if request.uri().path() == "/__desktop_smoke/report" {
            self.reject_bulk_report(
                status,
                "report_admission",
                "Bulk acceptance report failed desktop request admission",
                request.body().len(),
            );
        }
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
/// Process-owned evidence route, shared by smoke and native acceptance. Ordinary
/// reports retain their original size/schema contract; only exact bulk phases
/// admit larger evidence and persist an explicit terminal result on rejection.
pub fn receive_report(
    directory: Option<&Path>,
    acceptance: Option<&Acceptance>,
    request: &Request<Vec<u8>>,
) -> Response<Vec<u8>> {
    let Some(directory) = directory else {
        return error(404, "Not found");
    };
    let bulk = acceptance.filter(|run| BULK_PHASES.contains(&run.phase));
    let limit = if bulk.is_some() {
        MAX_BULK_REPORT_BYTES
    } else {
        MAX_SMOKE_REPORT_BYTES
    };
    let reject = |status, code, message| {
        if let Some(run) = bulk {
            run.reject_bulk_report(status, code, message, request.body().len());
        }
        error(
            status,
            if status == 500 {
                "Cannot save smoke evidence"
            } else {
                "Invalid smoke report"
            },
        )
    };
    if request.method() != "POST" {
        return reject(400, "report_method", "Bulk acceptance report requires POST");
    }
    if request.body().len() > limit {
        return reject(
            400,
            "report_size",
            "Bulk acceptance report exceeds its byte limit",
        );
    }
    let Ok(value) = serde_json::from_slice::<Value>(request.body()) else {
        return reject(
            400,
            "report_json",
            "Bulk acceptance report is not valid JSON",
        );
    };
    if value["version"] != 1 || !value["ok"].is_boolean() {
        return reject(
            400,
            "report_envelope",
            "Bulk acceptance report requires version 1 and a boolean ok",
        );
    }
    if bulk.is_some_and(|run| value["phase"].as_str() != Some(run.phase)) {
        return reject(
            400,
            "report_phase",
            "Bulk acceptance report phase does not match the active run",
        );
    }
    let name = acceptance
        .map(Acceptance::report_name)
        .unwrap_or_else(|| "renderer-report.json".into());
    if atomic_json(directory, &name, request.body()).is_err() {
        return reject(500, "report_write", "Cannot save bulk acceptance report");
    }
    response(200, "application/json", b"{}".as_slice())
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
            "renderer-report-failed",
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
    fn report_request(method: &str, bytes: Vec<u8>) -> Request<Vec<u8>> {
        Request::builder()
            .method(method)
            .uri("https://wmh.localhost/__desktop_smoke/report")
            .body(bytes)
            .unwrap()
    }
    fn sized_report(phase: Option<&str>, size: usize) -> Vec<u8> {
        let mut value = json!({
            "version": 1,
            "phase": phase,
            "ok": true,
            "observations": "原始🎼\n  exact bytes",
            "padding": "",
        });
        let overhead = serde_json::to_vec(&value).unwrap().len();
        value["padding"] = json!(" ".repeat(size - overhead));
        let bytes = serde_json::to_vec_pretty(&value).unwrap();
        // Preserve noncanonical whitespace as part of the exact report evidence.
        let pretty_overhead = bytes.len() - size;
        value["padding"] = json!(" ".repeat(size - overhead - pretty_overhead));
        let bytes = serde_json::to_vec_pretty(&value).unwrap();
        assert_eq!(bytes.len(), size);
        bytes
    }
    fn assert_bulk_failure(run: &Acceptance, code: &str, status: u16, received_bytes: usize) {
        let bytes = std::fs::read(run.directory.join(run.report_name())).unwrap();
        assert!(bytes.len() < 1024);
        let failure: Value = serde_json::from_slice(&bytes).unwrap();
        assert_eq!(failure["version"], 1);
        assert_eq!(failure["phase"], run.phase);
        assert_eq!(failure["ok"], false);
        assert!(failure["error"].as_str().is_some_and(|s| !s.is_empty()));
        assert_eq!(failure["report_failure"]["code"], code);
        assert_eq!(failure["report_failure"]["status"], status);
        assert_eq!(failure["report_failure"]["received_bytes"], received_bytes);
        assert_eq!(
            failure["report_failure"]["limit_bytes"],
            MAX_BULK_REPORT_BYTES
        );
        assert!(failure.get("observations").is_none());
        let trace: Value = serde_json::from_slice(
            &std::fs::read(run.directory.join(format!("trace-{}.json", run.phase))).unwrap(),
        )
        .unwrap();
        let event = &trace["events"].as_array().unwrap().last().unwrap()["event"];
        assert_eq!(event["source"], "host");
        assert_eq!(event["stage"], "renderer-report-rejected");
        assert_eq!(event["code"], code);
        assert_eq!(event["status"], status);
        assert_eq!(event["received_bytes"], received_bytes);
        assert_eq!(event["limit_bytes"], MAX_BULK_REPORT_BYTES);
        assert_eq!(event["report_saved"], true);
    }
    #[test]
    fn ordinary_reports_preserve_the_inclusive_64_kib_contract() {
        for phase in std::iter::once(None).chain(PHASES.into_iter().chain(FOLDER_PHASES).map(Some))
        {
            let evidence = Evidence::new();
            std::fs::create_dir_all(&evidence.0).unwrap();
            let acceptance = phase.map(|phase| Acceptance::new(evidence.0.clone(), phase).unwrap());
            let name = acceptance
                .as_ref()
                .map(Acceptance::report_name)
                .unwrap_or_else(|| "renderer-report.json".into());
            // Phase has never been mandatory in ordinary smoke/folder evidence.
            let bytes = sized_report(None, MAX_SMOKE_REPORT_BYTES);
            let request = report_request("POST", bytes.clone());
            assert_eq!(
                receive_report(Some(&evidence.0), acceptance.as_ref(), &request).status(),
                200
            );
            assert_eq!(std::fs::read(evidence.0.join(&name)).unwrap(), bytes);
            for rejected in [
                report_request("POST", sized_report(phase, MAX_SMOKE_REPORT_BYTES + 1)),
                report_request("GET", vec![]),
                report_request("POST", b"not JSON".to_vec()),
                report_request("POST", br#"{"version":1,"ok":"true"}"#.to_vec()),
            ] {
                let reply = receive_report(Some(&evidence.0), acceptance.as_ref(), &rejected);
                assert_eq!(reply.status(), 400);
                assert_eq!(
                    serde_json::from_slice::<Value>(reply.body()).unwrap(),
                    json!({"error":"Invalid smoke report"})
                );
                assert_eq!(std::fs::read(evidence.0.join(&name)).unwrap(), bytes);
            }
            assert!(!evidence
                .0
                .join(format!("trace-{}.json", phase.unwrap_or("smoke")))
                .exists());
        }
    }
    #[test]
    fn every_bulk_phase_persists_exact_reports_through_4_mib_and_rejects_above() {
        for phase in BULK_PHASES {
            let evidence = Evidence::new();
            let acceptance = Acceptance::new(evidence.0.clone(), phase).unwrap();
            for size in [
                MAX_SMOKE_REPORT_BYTES + 1,
                MAX_BULK_REPORT_BYTES - 1,
                MAX_BULK_REPORT_BYTES,
            ] {
                let bytes = sized_report(Some(phase), size);
                let request = report_request("POST", bytes.clone());
                assert!(crate::admission(&request).is_none());
                assert_eq!(
                    receive_report(Some(&evidence.0), Some(&acceptance), &request).status(),
                    200
                );
                assert_eq!(
                    std::fs::read(evidence.0.join(acceptance.report_name())).unwrap(),
                    bytes
                );
            }
            let request =
                report_request("POST", sized_report(Some(phase), MAX_BULK_REPORT_BYTES + 1));
            assert_eq!(
                receive_report(Some(&evidence.0), Some(&acceptance), &request).status(),
                400
            );
            assert_bulk_failure(&acceptance, "report_size", 400, request.body().len());
        }
    }
    #[test]
    fn bulk_rejections_persist_bounded_terminal_failures() {
        let evidence = Evidence::new();
        let acceptance = Acceptance::new(evidence.0.clone(), "bulk-seed").unwrap();
        for (method, bytes, code) in [
            ("GET", vec![], "report_method"),
            ("PUT", vec![], "report_method"),
            ("POST", b"{ malformed JSON".to_vec(), "report_json"),
            ("POST", vec![0xff], "report_json"),
            ("POST", b"null".to_vec(), "report_envelope"),
            (
                "POST",
                br#"{"version":2,"phase":"bulk-seed","ok":true}"#.to_vec(),
                "report_envelope",
            ),
            (
                "POST",
                br#"{"version":1,"phase":"bulk-seed"}"#.to_vec(),
                "report_envelope",
            ),
            (
                "POST",
                br#"{"version":1,"phase":"bulk-seed","ok":"true"}"#.to_vec(),
                "report_envelope",
            ),
            (
                "POST",
                br#"{"version":1,"ok":true}"#.to_vec(),
                "report_phase",
            ),
            (
                "POST",
                br#"{"version":1,"phase":1,"ok":true}"#.to_vec(),
                "report_phase",
            ),
            (
                "POST",
                br#"{"version":1,"phase":"bulk-restart","ok":true}"#.to_vec(),
                "report_phase",
            ),
        ] {
            let request = report_request(method, bytes);
            assert_eq!(
                receive_report(Some(&evidence.0), Some(&acceptance), &request).status(),
                400
            );
            assert_bulk_failure(&acceptance, code, 400, request.body().len());
        }
        let bytes =
            br#"{"version":1,"phase":"bulk-seed","ok":false,"error":"renderer failure"}"#.to_vec();
        let request = report_request("POST", bytes.clone());
        assert_eq!(
            receive_report(Some(&evidence.0), Some(&acceptance), &request).status(),
            200
        );
        assert_eq!(
            std::fs::read(evidence.0.join(acceptance.report_name())).unwrap(),
            bytes
        );
    }
    #[test]
    fn failed_report_storage_still_persists_an_independent_host_trace() {
        for phase in BULK_PHASES {
            let evidence = Evidence::new();
            let acceptance = Acceptance::new(evidence.0.clone(), phase).unwrap();
            std::fs::create_dir(evidence.0.join(acceptance.report_name())).unwrap();
            let request = report_request("POST", sized_report(Some(phase), 1024));
            assert_eq!(
                receive_report(Some(&evidence.0), Some(&acceptance), &request).status(),
                500
            );
            let trace_bytes =
                std::fs::read(evidence.0.join(format!("trace-{phase}.json"))).unwrap();
            assert!(trace_bytes.len() < 1024);
            let trace: Value = serde_json::from_slice(&trace_bytes).unwrap();
            let event = &trace["events"][0]["event"];
            assert_eq!(event["stage"], "renderer-report-rejected");
            assert_eq!(event["code"], "report_write");
            assert_eq!(event["status"], 500);
            assert_eq!(event["report_saved"], false);
            assert_eq!(event["received_bytes"], request.body().len());
            assert_eq!(event["limit_bytes"], MAX_BULK_REPORT_BYTES);
            let temporary =
                std::fs::read(evidence.0.join(format!("{}.tmp", acceptance.report_name())))
                    .unwrap();
            assert!(temporary.len() < 1024);
            assert_eq!(
                serde_json::from_slice::<Value>(&temporary).unwrap()["ok"],
                false
            );
        }
    }
    #[test]
    fn admission_rejections_record_bulk_failure_but_leave_other_routes_and_phases_unchanged() {
        let evidence = Evidence::new();
        let acceptance = Acceptance::new(evidence.0.clone(), "bulk-seed").unwrap();
        for request in [
            report_request("DELETE", vec![]),
            report_request("POST", vec![b' '; crate::MAX_BODY + 1]),
        ] {
            let reply = crate::admission(&request).unwrap();
            acceptance.trace_report_admission_failure(&request, reply.status().as_u16());
            assert_bulk_failure(
                &acceptance,
                "report_admission",
                reply.status().as_u16(),
                request.body().len(),
            );
        }
        let report = std::fs::read(evidence.0.join(acceptance.report_name())).unwrap();
        let other = Request::builder()
            .method("DELETE")
            .uri("https://wmh.localhost/api/compile")
            .body(vec![])
            .unwrap();
        acceptance.trace_report_admission_failure(&other, 405);
        assert_eq!(
            std::fs::read(evidence.0.join(acceptance.report_name())).unwrap(),
            report
        );
        let ordinary = Acceptance::new(evidence.0.clone(), "seed").unwrap();
        ordinary.trace_report_admission_failure(&report_request("DELETE", vec![]), 405);
        assert!(!evidence.0.join(ordinary.report_name()).exists());
        assert!(!evidence.0.join("trace-seed.json").exists());
    }
    #[test]
    fn disabled_report_hook_returns_404_without_writing_evidence() {
        let evidence = Evidence::new();
        let acceptance = Acceptance::new(evidence.0.clone(), "bulk-seed").unwrap();
        for run in [None, Some(&acceptance)] {
            for request in [
                report_request("POST", sized_report(Some("bulk-seed"), 1024)),
                report_request("GET", vec![]),
            ] {
                assert_eq!(receive_report(None, run, &request).status(), 404);
            }
        }
        assert!(!evidence.0.join(acceptance.report_name()).exists());
        assert!(!evidence.0.join("trace-bulk-seed.json").exists());
    }
    #[test]
    fn renderer_report_failure_progress_is_bounded_and_supported() {
        assert!(valid_progress(
            &json!({"version":1,"stage":"renderer-report-failed","sequence":64,"status":503})
        ));
        assert!(!valid_progress(
            &json!({"version":1,"stage":"renderer-report-failed","sequence":65,"status":503})
        ));
        assert!(!valid_progress(
            &json!({"version":1,"stage":"renderer-report-failed","sequence":64,"error":"unbounded"})
        ));
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
