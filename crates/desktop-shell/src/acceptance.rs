//! Process-owner-only Windows acceptance evidence. Never enabled by page content.
pub use crate::acceptance_publication::atomic_json;
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
pub const CLEAN_PHASES: [&str; 2] = ["clean-seed", "clean-restart"];
pub const VSQ_PHASES: [&str; 2] = ["vsq-seed", "vsq-restart"];
pub const PERFORMANCE_PHASES: [&str; 3] = [
    "performance-seed",
    "performance-controls",
    "performance-restart",
];
pub const PITCH_BEND_PHASES: [&str; 2] = ["pitch-bend-seed", "pitch-bend-restart"];
pub const COMPLETE_PRACTICE_PHASES: [&str; 2] =
    ["complete-practice-seed", "complete-practice-restart"];
pub const CANONICAL_PRACTICE_PHASES: [&str; 3] = [
    "canonical-practice-seed",
    "canonical-practice-controls",
    "canonical-practice-restart",
];
pub const LIVE_TONE_NAVIGATION_PHASES: [&str; 4] = [
    "live-navigation-settings-keyup",
    "live-navigation-settings-navigation",
    "live-navigation-authoring-keyup",
    "live-navigation-authoring-navigation",
];
pub const HUMAN_MOD_TIMBRE_PHASES: [&str; 3] = [
    "human-timbre-seed",
    "human-timbre-migrate",
    "human-timbre-restart",
];
pub const BASIC_KEY_PHASES: [&str; 2] = ["basic-key-seed", "basic-key-restart"];
pub const AUTHORING_PHASES: [&str; 2] = ["authoring-seed", "authoring-restart"];
pub const VSQ_AUTHORING_PHASES: [&str; 2] = ["vsq-authoring-seed", "vsq-authoring-restart"];
pub const SKIN_PHASES: [&str; 3] = ["skin-seed", "skin-restart", "skin-default-restart"];
pub const CATALOG_PHASES: [&str; 3] = ["catalog-seed", "catalog-restart", "catalog-final"];
pub const MAX_CLEAN_REPORT_BYTES: usize = 1024 * 1024;
pub const MAX_SMOKE_REPORT_BYTES: usize = 64 * 1024;
pub const MAX_BULK_REPORT_BYTES: usize = 4 * 1024 * 1024;
pub struct Acceptance {
    directory: PathBuf,
    pub phase: &'static str,
    downloads: Mutex<Vec<Value>>,
    trace: Mutex<Vec<Value>>,
    catalog_snapshot_requested: Mutex<bool>,
    started: Instant,
}
impl Acceptance {
    pub fn new(directory: PathBuf, phase: &str) -> Result<Self, &'static str> {
        let phase = PHASES
            .into_iter()
            .chain(FOLDER_PHASES)
            .chain(BULK_PHASES)
            .chain(CLEAN_PHASES)
            .chain(VSQ_PHASES)
            .chain(PERFORMANCE_PHASES)
            .chain(PITCH_BEND_PHASES)
            .chain(AUTHORING_PHASES)
            .chain(VSQ_AUTHORING_PHASES)
            .chain(BASIC_KEY_PHASES)
            .chain(COMPLETE_PRACTICE_PHASES)
            .chain(CANONICAL_PRACTICE_PHASES)
            .chain(LIVE_TONE_NAVIGATION_PHASES)
            .chain(HUMAN_MOD_TIMBRE_PHASES)
            .chain(SKIN_PHASES)
            .chain(CATALOG_PHASES)
            .find(|candidate| *candidate == phase)
            .ok_or("Unknown acceptance phase")?;
        std::fs::create_dir_all(directory.join("downloads"))
            .map_err(|_| "Cannot create acceptance directory")?;
        Ok(Self {
            directory,
            phase,
            downloads: Mutex::new(Vec::new()),
            trace: Mutex::new(Vec::new()),
            catalog_snapshot_requested: Mutex::new(false),
            started: Instant::now(),
        })
    }
    pub fn script(&self) -> String {
        if HUMAN_MOD_TIMBRE_PHASES.contains(&self.phase) {
            let (vsq_helpers, _) = include_str!("../vsq-song-acceptance.js")
                .split_once("(() => {")
                .expect("VSQ helpers must precede their runner");
            let (canonical_helpers, _) = include_str!("../canonical-practice-acceptance.js")
                .split_once("(() => {")
                .expect("Canonical helpers must precede their runner");
            let (native_controls, _) = include_str!("../live-tone-navigation-acceptance.js")
                .split_once("(() => {")
                .expect("Native fixed-key helpers must precede their runner");
            return format!(
                "globalThis.__WMH_ACCEPTANCE_PHASE__={};\n{}\n{}\n{}\n{}\n{}\n{}\n{}",
                serde_json::to_string(self.phase).unwrap(),
                include_str!("../acceptance-wait.js"),
                include_str!("../reference-acceptance.js"),
                include_str!("../live-tone-acceptance.js"),
                vsq_helpers,
                canonical_helpers,
                native_controls,
                include_str!("../human-mod-timbre-acceptance.js")
            );
        }
        if LIVE_TONE_NAVIGATION_PHASES.contains(&self.phase) {
            let (vsq_helpers, _) = include_str!("../vsq-song-acceptance.js")
                .split_once("(() => {")
                .expect("VSQ helpers must precede their runner");
            let (canonical_helpers, _) = include_str!("../canonical-practice-acceptance.js")
                .split_once("(() => {")
                .expect("Canonical helpers must precede their runner");
            return format!(
                "globalThis.__WMH_ACCEPTANCE_PHASE__={};\n{}\n{}\n{}\n{}\n{}\n{}",
                serde_json::to_string(self.phase).unwrap(),
                include_str!("../acceptance-wait.js"),
                include_str!("../reference-acceptance.js"),
                include_str!("../live-tone-acceptance.js"),
                vsq_helpers,
                canonical_helpers,
                include_str!("../live-tone-navigation-acceptance.js")
            );
        }
        let skin = if SKIN_PHASES.contains(&self.phase) {
            let (observers, _) = include_str!("../vsq-song-acceptance.js")
                .split_once("(() => {")
                .expect("VSQ observer prefix must precede its runner");
            let (controls, _) = include_str!("../canonical-practice-acceptance.js")
                .split_once("(() => {")
                .expect("Canonical control prefix must precede its runner");
            format!(
                "{observers}\n{controls}\n{}",
                include_str!("../skin-acceptance.js")
            )
        } else {
            String::new()
        };
        let performance = if PERFORMANCE_PHASES.contains(&self.phase)
            || PITCH_BEND_PHASES.contains(&self.phase)
            || AUTHORING_PHASES.contains(&self.phase)
            || VSQ_AUTHORING_PHASES.contains(&self.phase)
            || COMPLETE_PRACTICE_PHASES.contains(&self.phase)
            || CANONICAL_PRACTICE_PHASES.contains(&self.phase)
            || BASIC_KEY_PHASES.contains(&self.phase)
        {
            // Reuse the existing bounded observers, without starting the VSQ run.
            let (observers, _) = include_str!("../vsq-song-acceptance.js")
                .split_once("(() => {")
                .expect("VSQ observer prefix must precede its runner");
            if PITCH_BEND_PHASES.contains(&self.phase)
                || AUTHORING_PHASES.contains(&self.phase)
                || VSQ_AUTHORING_PHASES.contains(&self.phase)
                || COMPLETE_PRACTICE_PHASES.contains(&self.phase)
                || CANONICAL_PRACTICE_PHASES.contains(&self.phase)
                || BASIC_KEY_PHASES.contains(&self.phase)
            {
                let (performance_helpers, _) = include_str!("../performance-song-acceptance.js")
                    .split_once("(() => {")
                    .expect("Performance observer prefix must precede its runner");
                format!(
                    "{observers}\n{performance_helpers}\n{}",
                    if CANONICAL_PRACTICE_PHASES.contains(&self.phase) {
                        include_str!("../canonical-practice-acceptance.js").to_string()
                    } else if COMPLETE_PRACTICE_PHASES.contains(&self.phase) {
                        include_str!("../complete-practice-acceptance.js").to_string()
                    } else if BASIC_KEY_PHASES.contains(&self.phase) {
                        include_str!("../basic-key-acceptance.js").to_string()
                    } else if VSQ_AUTHORING_PHASES.contains(&self.phase) {
                        let (authoring_helpers, _) =
                            include_str!("../song-authoring-acceptance.js")
                                .split_once("(() => {")
                                .expect("Authoring helper prefix must precede its runner");
                        format!(
                            "{authoring_helpers}\n{}",
                            include_str!("../vsq-authoring-acceptance.js")
                        )
                    } else if AUTHORING_PHASES.contains(&self.phase) {
                        include_str!("../song-authoring-acceptance.js").to_string()
                    } else {
                        include_str!("../pitch-bend-acceptance.js").to_string()
                    }
                )
            } else {
                format!(
                    "{observers}\n{}",
                    include_str!("../performance-song-acceptance.js")
                )
            }
        } else {
            String::new()
        };
        format!(
            "globalThis.__WMH_ACCEPTANCE_PHASE__={};\n{}\n{}\n{}\n{}",
            serde_json::to_string(self.phase).unwrap(),
            include_str!("../acceptance-wait.js"),
            include_str!("../reference-acceptance.js"),
            include_str!("../live-tone-acceptance.js"),
            if SKIN_PHASES.contains(&self.phase) {
                &skin
            } else if PERFORMANCE_PHASES.contains(&self.phase)
                || PITCH_BEND_PHASES.contains(&self.phase)
                || AUTHORING_PHASES.contains(&self.phase)
                || VSQ_AUTHORING_PHASES.contains(&self.phase)
                || COMPLETE_PRACTICE_PHASES.contains(&self.phase)
                || CANONICAL_PRACTICE_PHASES.contains(&self.phase)
                || BASIC_KEY_PHASES.contains(&self.phase)
            {
                &performance
            } else if CATALOG_PHASES.contains(&self.phase) {
                include_str!("../library-catalog-acceptance.js")
            } else if VSQ_PHASES.contains(&self.phase) {
                include_str!("../vsq-song-acceptance.js")
            } else if CLEAN_PHASES.contains(&self.phase) {
                include_str!("../clean-song-acceptance.js")
            } else if BULK_PHASES.contains(&self.phase) {
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
    /// Process-owned acceptance storage, shared by all fresh-profile scenarios.
    pub fn library_directory(&self) -> PathBuf {
        let song_folder = FOLDER_PHASES.contains(&self.phase)
            || BULK_PHASES.contains(&self.phase)
            || CLEAN_PHASES.contains(&self.phase)
            || VSQ_PHASES.contains(&self.phase)
            || PERFORMANCE_PHASES.contains(&self.phase)
            || PITCH_BEND_PHASES.contains(&self.phase)
            || AUTHORING_PHASES.contains(&self.phase)
            || VSQ_AUTHORING_PHASES.contains(&self.phase)
            || COMPLETE_PRACTICE_PHASES.contains(&self.phase)
            || CANONICAL_PRACTICE_PHASES.contains(&self.phase)
            || LIVE_TONE_NAVIGATION_PHASES.contains(&self.phase)
            || HUMAN_MOD_TIMBRE_PHASES.contains(&self.phase)
            || BASIC_KEY_PHASES.contains(&self.phase)
            || CATALOG_PHASES.contains(&self.phase)
            || SKIN_PHASES.contains(&self.phase);
        self.directory.join(if song_folder {
            "Scores"
        } else {
            "score-library"
        })
    }
    /// Desktop restarts and the catalog recovery scenario share browser storage.
    /// Other disk-library phases retain their finite, non-reusable profiles.
    pub fn profile_directory(&self) -> PathBuf {
        if CATALOG_PHASES.contains(&self.phase) {
            self.directory.join("webview-catalog-profile")
        } else if PHASES.contains(&self.phase) {
            self.directory.join("webview-profile")
        } else if HUMAN_MOD_TIMBRE_PHASES.contains(&self.phase) {
            self.directory
                .join("webview-profiles")
                .join("human-timbre-seed")
        } else if SKIN_PHASES.contains(&self.phase) {
            self.directory.join("webview-profiles").join("skin-seed")
        } else if CANONICAL_PRACTICE_PHASES.contains(&self.phase) {
            self.directory
                .join("webview-profiles")
                .join("canonical-practice-seed")
        } else if COMPLETE_PRACTICE_PHASES.contains(&self.phase) {
            self.directory
                .join("webview-profiles")
                .join("complete-practice-seed")
        } else {
            self.directory.join("webview-profiles").join(self.phase)
        }
    }
    pub fn prepare_webview_profile(&self) -> std::io::Result<PathBuf> {
        let profile = self.profile_directory();
        let catalog = CATALOG_PHASES.contains(&self.phase);
        let complete_restart = self.phase == "complete-practice-restart";
        let canonical_restart = CANONICAL_PRACTICE_PHASES.contains(&self.phase)
            && self.phase != "canonical-practice-seed";
        let human_timbre_restart =
            HUMAN_MOD_TIMBRE_PHASES.contains(&self.phase) && self.phase != "human-timbre-seed";
        let skin_restart = SKIN_PHASES.contains(&self.phase) && self.phase != "skin-seed";
        let existing_required = (catalog && self.phase != "catalog-seed")
            || complete_restart
            || canonical_restart
            || skin_restart
            || human_timbre_restart;
        let fresh_required = !PHASES.contains(&self.phase) && !existing_required;
        let prepare = || -> std::io::Result<bool> {
            require_ordinary_directory(&self.directory)?;
            if existing_required {
                // A restart must never manufacture a replacement browser profile.
                // Require the same ordinary path and bounded earlier host records.
                require_ordinary_directory(&profile)?;
                if human_timbre_restart {
                    self.require_catalog_profile_evidence("human-timbre-seed", true)?;
                    if self.phase == "human-timbre-restart" {
                        self.require_catalog_profile_evidence("human-timbre-migrate", false)?;
                    }
                } else if skin_restart {
                    self.require_catalog_profile_evidence("skin-seed", true)?;
                    if self.phase == "skin-default-restart" {
                        self.require_catalog_profile_evidence("skin-restart", false)?;
                    }
                } else if canonical_restart {
                    self.require_catalog_profile_evidence("canonical-practice-seed", true)?;
                    if self.phase == "canonical-practice-restart" {
                        self.require_catalog_profile_evidence(
                            "canonical-practice-controls",
                            false,
                        )?;
                    }
                } else if complete_restart {
                    self.require_catalog_profile_evidence("complete-practice-seed", true)?;
                } else {
                    self.require_catalog_profile_evidence("catalog-seed", true)?;
                    if self.phase == "catalog-final" {
                        self.require_catalog_profile_evidence("catalog-restart", false)?;
                    }
                }
                return Ok(false);
            }
            if fresh_required && !catalog {
                let parent = self.directory.join("webview-profiles");
                match std::fs::create_dir(&parent) {
                    Ok(()) => {}
                    Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => {
                        require_ordinary_directory(&parent)?;
                    }
                    Err(error) => return Err(error),
                }
            }
            // create_dir (not create_dir_all) is the atomic fresh precondition.
            // A retained profile, even an empty one, must never be reused here.
            match std::fs::create_dir(&profile) {
                Ok(()) => Ok(true),
                Err(error)
                    if !fresh_required && error.kind() == std::io::ErrorKind::AlreadyExists =>
                {
                    require_ordinary_directory(&profile)?;
                    Ok(false)
                }
                Err(error) => Err(error),
            }
        };
        let created_new = prepare().map_err(|error| {
            std::io::Error::new(
                error.kind(),
                format!(
                    "Acceptance profile preparation failed (phase={}, path={}, fresh_required={}): {}",
                    self.phase,
                    profile.display(),
                    fresh_required,
                    error
                ),
            )
        })?;
        let bytes = serde_json::to_vec(&json!({
            "version": 1,
            "phase": self.phase,
            "process_id": std::process::id(),
            "profile_directory": profile,
            "library_directory": self.library_directory(),
            "fresh_required": fresh_required,
            "created_new": created_new,
        }))?;
        atomic_json(
            &self.directory,
            &format!("profile-{}.json", self.phase),
            &bytes,
        )?;
        Ok(profile)
    }
    fn require_catalog_profile_evidence(&self, phase: &str, fresh: bool) -> std::io::Result<()> {
        let path = self.directory.join(format!("profile-{phase}.json"));
        let proof = read_ordinary_json(&path, 8192)?;
        if proof["version"] != 1
            || proof["phase"] != phase
            || !proof["process_id"].as_u64().is_some_and(|id| id > 0)
            || proof["profile_directory"] != json!(self.profile_directory())
            || proof["library_directory"] != json!(self.library_directory())
            || proof["fresh_required"] != fresh
            || proof["created_new"] != fresh
        {
            return Err(std::io::Error::other(
                "Catalog profile ownership evidence does not match",
            ));
        }
        Ok(())
    }
    fn report_limit(&self) -> usize {
        if CLEAN_PHASES.contains(&self.phase)
            || VSQ_PHASES.contains(&self.phase)
            || PERFORMANCE_PHASES.contains(&self.phase)
            || PITCH_BEND_PHASES.contains(&self.phase)
            || AUTHORING_PHASES.contains(&self.phase)
            || VSQ_AUTHORING_PHASES.contains(&self.phase)
            || COMPLETE_PRACTICE_PHASES.contains(&self.phase)
            || CANONICAL_PRACTICE_PHASES.contains(&self.phase)
            || LIVE_TONE_NAVIGATION_PHASES.contains(&self.phase)
            || HUMAN_MOD_TIMBRE_PHASES.contains(&self.phase)
            || BASIC_KEY_PHASES.contains(&self.phase)
            || CATALOG_PHASES.contains(&self.phase)
            || SKIN_PHASES.contains(&self.phase)
        {
            MAX_CLEAN_REPORT_BYTES
        } else if BULK_PHASES.contains(&self.phase) {
            MAX_BULK_REPORT_BYTES
        } else {
            MAX_SMOKE_REPORT_BYTES
        }
    }
    fn reject_bulk_report(
        &self,
        status: u16,
        code: &'static str,
        message: &'static str,
        received_bytes: usize,
    ) {
        if !BULK_PHASES.contains(&self.phase)
            && !CLEAN_PHASES.contains(&self.phase)
            && !VSQ_PHASES.contains(&self.phase)
            && !PERFORMANCE_PHASES.contains(&self.phase)
            && !PITCH_BEND_PHASES.contains(&self.phase)
            && !AUTHORING_PHASES.contains(&self.phase)
            && !VSQ_AUTHORING_PHASES.contains(&self.phase)
            && !COMPLETE_PRACTICE_PHASES.contains(&self.phase)
            && !CANONICAL_PRACTICE_PHASES.contains(&self.phase)
            && !LIVE_TONE_NAVIGATION_PHASES.contains(&self.phase)
            && !HUMAN_MOD_TIMBRE_PHASES.contains(&self.phase)
            && !BASIC_KEY_PHASES.contains(&self.phase)
            && !CATALOG_PHASES.contains(&self.phase)
            && !SKIN_PHASES.contains(&self.phase)
        {
            return;
        }
        // Never include rejected body content or parser/OS diagnostics. Both the
        // terminal report and independent host trace have a fixed, small schema.
        let failure = json!({
            "code": code,
            "status": status,
            "received_bytes": received_bytes,
            "limit_bytes": self.report_limit(),
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
            "limit_bytes": self.report_limit(),
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
        let extension = if (BULK_PHASES.contains(&self.phase)
            || CLEAN_PHASES.contains(&self.phase)
            || VSQ_PHASES.contains(&self.phase)
            || PERFORMANCE_PHASES.contains(&self.phase)
            || PITCH_BEND_PHASES.contains(&self.phase)
            || AUTHORING_PHASES.contains(&self.phase)
            || VSQ_AUTHORING_PHASES.contains(&self.phase)
            || COMPLETE_PRACTICE_PHASES.contains(&self.phase)
            || CANONICAL_PRACTICE_PHASES.contains(&self.phase)
            || BASIC_KEY_PHASES.contains(&self.phase)
            || CATALOG_PHASES.contains(&self.phase))
            && (name.to_lowercase().ends_with(".zip")
                || ((AUTHORING_PHASES.contains(&self.phase)
                    || VSQ_AUTHORING_PHASES.contains(&self.phase)
                    || CATALOG_PHASES.contains(&self.phase))
                    && name.to_lowercase().ends_with(".wmhpack")))
        {
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
        let result = if path == "/__desktop_smoke/catalog-config" {
            if !CATALOG_PHASES.contains(&self.phase) || request.method() != "GET" {
                return Some(error(404, "Not found"));
            }
            match read_ordinary_json(&self.directory.join("catalog-config.json"), 128 * 1024) {
                Ok(value) if value.is_object() => value,
                _ => return Some(error(500, "Invalid catalog acceptance configuration")),
            }
        } else if path == "/__desktop_smoke/progress" && request.method() == "POST" {
            if request.body().len() > 1024 {
                return Some(error(400, "Invalid acceptance progress"));
            }
            let value = serde_json::from_slice::<Value>(request.body());
            let Ok(value) = value else {
                return Some(error(400, "Invalid acceptance progress"));
            };
            if !valid_progress_for_phase(&value, self.phase) {
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
            if !valid_action_for_phase(&value, self.phase) {
                return Some(error(400, "Invalid acceptance action"));
            }
            if value["kind"] == "catalog-snapshot-before" {
                if self.phase != "catalog-seed" {
                    return Some(error(400, "Catalog snapshot requires the seed phase"));
                }
                let Ok(mut requested) = self.catalog_snapshot_requested.lock() else {
                    return Some(error(500, "Cannot reserve catalog snapshot"));
                };
                if *requested {
                    return Some(error(400, "Catalog snapshot already requested"));
                }
                *requested = true;
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
            if !(1..=action_limit(self.phase)).contains(&sequence) || request.method() != "GET" {
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
fn read_ordinary_json(path: &Path, limit: usize) -> std::io::Result<Value> {
    use std::io::Read;
    let metadata = std::fs::symlink_metadata(path)?;
    if !metadata.is_file() || is_reparse(&metadata) || metadata.len() > limit as u64 {
        return Err(std::io::Error::other(
            "Invalid bounded acceptance JSON file",
        ));
    }
    let mut bytes = Vec::new();
    std::fs::File::open(path)?
        .take(limit as u64 + 1)
        .read_to_end(&mut bytes)?;
    if bytes.len() > limit {
        return Err(std::io::Error::other(
            "Acceptance JSON file exceeds its byte bound",
        ));
    }
    serde_json::from_slice(&bytes).map_err(std::io::Error::from)
}
fn is_reparse(metadata: &std::fs::Metadata) -> bool {
    #[cfg(windows)]
    let reparse = {
        use std::os::windows::fs::MetadataExt;
        metadata.file_attributes() & 0x400 != 0
    };
    #[cfg(not(windows))]
    let reparse = metadata.is_symlink();
    reparse
}
fn require_ordinary_directory(path: &Path) -> std::io::Result<()> {
    let metadata = std::fs::symlink_metadata(path)?;
    if !metadata.is_dir() || is_reparse(&metadata) {
        return Err(std::io::Error::other(format!(
            "Acceptance profile parent must be an ordinary directory: {}",
            path.display()
        )));
    }
    Ok(())
}
/// Process-owned evidence route, shared by smoke and native acceptance. Ordinary
/// reports retain their original size/schema contract; only exact bulk/clean phases
/// admit larger evidence and persist an explicit terminal result on rejection.
pub fn receive_report(
    directory: Option<&Path>,
    acceptance: Option<&Acceptance>,
    request: &Request<Vec<u8>>,
) -> Response<Vec<u8>> {
    let Some(directory) = directory else {
        return error(404, "Not found");
    };
    let bulk = acceptance.filter(|run| {
        BULK_PHASES.contains(&run.phase)
            || CLEAN_PHASES.contains(&run.phase)
            || VSQ_PHASES.contains(&run.phase)
            || PERFORMANCE_PHASES.contains(&run.phase)
            || PITCH_BEND_PHASES.contains(&run.phase)
            || AUTHORING_PHASES.contains(&run.phase)
            || VSQ_AUTHORING_PHASES.contains(&run.phase)
            || COMPLETE_PRACTICE_PHASES.contains(&run.phase)
            || CANONICAL_PRACTICE_PHASES.contains(&run.phase)
            || LIVE_TONE_NAVIGATION_PHASES.contains(&run.phase)
            || HUMAN_MOD_TIMBRE_PHASES.contains(&run.phase)
            || BASIC_KEY_PHASES.contains(&run.phase)
            || CATALOG_PHASES.contains(&run.phase)
            || SKIN_PHASES.contains(&run.phase)
    });
    let limit = bulk.map_or(MAX_SMOKE_REPORT_BYTES, Acceptance::report_limit);
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
// Only these existing scenarios need extra visible Mod setup actions. The
// native action vocabulary, owned coordinates and payload limits stay closed.
fn action_limit(phase: &str) -> u64 {
    if phase == "seed" {
        // 35 import/navigation/Free actions + at most 10 scored-take setup
        // actions + 27 reference-listening actions, including visible Mods.
        72
    } else if VSQ_PHASES.contains(&phase)
        || BASIC_KEY_PHASES.contains(&phase)
        || AUTHORING_PHASES.contains(&phase)
        || VSQ_AUTHORING_PHASES.contains(&phase)
        || phase == "canonical-practice-seed"
    {
        80
    } else if PERFORMANCE_PHASES.contains(&phase)
        || PITCH_BEND_PHASES.contains(&phase)
        || BULK_PHASES.contains(&phase)
        || FOLDER_PHASES.contains(&phase)
    {
        75
    } else {
        64
    }
}
#[cfg(test)]
fn valid_progress(value: &Value) -> bool {
    valid_progress_for_phase(value, "")
}
fn valid_progress_for_phase(value: &Value, phase: &str) -> bool {
    let Some(object) = value.as_object() else {
        return false;
    };
    object
        .keys()
        .all(|key| ["version", "stage", "sequence", "path", "status"].contains(&key.as_str()))
        && value["version"] == 1
        && value["sequence"]
            .as_u64()
            .is_some_and(|sequence| sequence <= action_limit(phase))
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
#[cfg(test)]
fn valid_action(value: &Value) -> bool {
    valid_action_for_phase(value, "")
}
fn valid_action_for_phase(value: &Value, phase: &str) -> bool {
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
        .is_some_and(|sequence| (1..=action_limit(phase)).contains(&sequence))
    {
        return false;
    }
    let live_navigation = LIVE_TONE_NAVIGATION_PHASES.contains(&phase);
    let human_timbre = HUMAN_MOD_TIMBRE_PHASES.contains(&phase);
    if (live_navigation || human_timbre)
        && !(human_timbre && value["kind"] == "select-second")
        && ![
            "click",
            "picker",
            "select-first",
            "select-last",
            "key-r",
            "live-key-r-down",
            "live-key-r-up",
        ]
        .contains(&value["kind"].as_str().unwrap_or(""))
    {
        return false;
    }
    if ![
        "picker",
        "cancel-picker",
        "catalog-snapshot-before",
        "key-r",
        "key-c5",
        "toggle-follow",
        "key-ds4",
        "select-last",
        "select-first",
        "select-second",
        "minimize-restore",
        "escape",
        "click",
    ]
    .contains(&value["kind"].as_str().unwrap_or(""))
        && !(phase == "canonical-practice-controls"
            && [
                "canonical-range-start",
                "canonical-range-end",
                "canonical-tempo",
            ]
            .contains(&value["kind"].as_str().unwrap_or("")))
        && !((live_navigation || human_timbre)
            && ["live-key-r-down", "live-key-r-up"].contains(&value["kind"].as_str().unwrap_or("")))
    {
        return false;
    }
    if SKIN_PHASES.contains(&phase)
        && !["click", "picker", "key-r", "select-first", "select-last"]
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
        if live_navigation && file != "live-tone-navigation-original.json" {
            return false;
        }
        if human_timbre
            && !(phase == "human-timbre-seed" && file == "human-mod-timbre-original.json")
        {
            return false;
        }
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
            "clean-authored-song.zip",
            "vsq-authored-song.zip",
            "performance-authored-songs.zip",
            "pitch-bend-authored-songs.zip",
            "catalog-original-legacy.zip",
            "catalog-original-shared.zip",
            "catalog-original-clean.zip",
            "complete-practice-original.zip",
            "basic-key-original.zip",
            "basic-key-invalid-profile.zip",
            "basic-key-forged-coverage.zip",
            "authoring-original-pair",
            "authoring-original-strict.mid",
            "authoring-original-events.mid",
            "authoring-original-blocked.mid",
            "authoring-original.vsq",
        ]
        .contains(&file)
            || (CANONICAL_PRACTICE_PHASES.contains(&phase)
                && [
                    "canonical-practice-original.json",
                    "canonical-practice-original.musicxml",
                ]
                .contains(&file))
            || (live_navigation && file == "live-tone-navigation-original.json")
            || (phase == "human-timbre-seed" && file == "human-mod-timbre-original.json")
            || (phase == "skin-seed"
                && [
                    "skin-original-score.json",
                    "skin-original.json",
                    "checker.png",
                ]
                .contains(&file));
        if SKIN_PHASES.contains(&phase)
            && !(phase == "skin-seed"
                && [
                    "skin-original-score.json",
                    "skin-original.json",
                    "checker.png",
                ]
                .contains(&file))
        {
            return false;
        }
        let download = PHASES.iter().any(|phase| {
            file.strip_prefix(&format!("{phase}-"))
                .and_then(|n| n.strip_suffix(".json"))
                .and_then(|n| n.parse::<u8>().ok())
                .is_some_and(|n| (1..=16).contains(&n))
        });
        let bulk_download = BULK_PHASES
            .iter()
            .chain(CLEAN_PHASES.iter())
            .chain(VSQ_PHASES.iter())
            .chain(PERFORMANCE_PHASES.iter())
            .chain(PITCH_BEND_PHASES.iter())
            .any(|phase| {
                file.strip_prefix(&format!("{phase}-"))
                    .and_then(|n| n.strip_suffix(".json").or_else(|| n.strip_suffix(".zip")))
                    .and_then(|n| n.parse::<u8>().ok())
                    .is_some_and(|n| (1..=16).contains(&n))
            });
        let authoring_download = AUTHORING_PHASES
            .iter()
            .chain(VSQ_AUTHORING_PHASES.iter())
            .chain(BASIC_KEY_PHASES.iter())
            .chain(COMPLETE_PRACTICE_PHASES.iter())
            .chain(CATALOG_PHASES.iter())
            .any(|phase| {
                (1..=16).any(|sequence| {
                    file == format!("{phase}-{sequence}.json")
                        || file == format!("{phase}-{sequence}.zip")
                })
            });
        if !fixture && !download && !bulk_download && !authoring_download {
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
    fn human_timbre_registration_and_actions_are_closed_and_bounded() {
        let evidence = Evidence::new();
        for phase in HUMAN_MOD_TIMBRE_PHASES {
            let run = Acceptance::new(evidence.0.clone(), phase).unwrap();
            assert_eq!(run.library_directory(), evidence.0.join("Scores"));
            assert_eq!(run.report_name(), format!("renderer-{phase}.json"));
            assert_eq!(run.report_limit(), MAX_CLEAN_REPORT_BYTES);
            assert_eq!(action_limit(phase), 64);
            let script = run.script();
            assert!(script.contains(include_str!("../human-mod-timbre-acceptance.js")));
            assert!(script.contains(include_str!("../live-tone-acceptance.js")));
            assert!(script.contains("function createNativeLiveToneNavigationControls"));
            for other in [
                include_str!("../live-tone-navigation-acceptance.js"),
                include_str!("../canonical-practice-acceptance.js"),
                include_str!("../vsq-song-acceptance.js"),
            ] {
                assert!(!script.contains(other));
            }
            let mut action = json!({"version":1,"sequence":64,"kind":"click","x":20,"y":30,"width":1280,"height":720});
            for kind in [
                "click",
                "select-first",
                "select-second",
                "select-last",
                "key-r",
                "live-key-r-down",
                "live-key-r-up",
            ] {
                action["kind"] = json!(kind);
                assert!(valid_action_for_phase(&action, phase), "{phase}: {kind}");
            }
            for kind in [
                "key-c5",
                "key-ds4",
                "escape",
                "cancel-picker",
                "catalog-snapshot-before",
                "canonical-tempo",
                "live-key-other",
                "eval",
            ] {
                action["kind"] = json!(kind);
                assert!(!valid_action_for_phase(&action, phase), "{phase}: {kind}");
            }
            action["kind"] = json!("click");
            action["sequence"] = json!(65);
            assert!(!valid_action_for_phase(&action, phase));
            action["sequence"] = json!(1);
            action["key"] = json!("R");
            assert!(!valid_action_for_phase(&action, phase));
            action.as_object_mut().unwrap().remove("key");
            action["kind"] = json!("picker");
            for file in [
                "human-mod-timbre-original.json",
                "live-tone-navigation-original.json",
                "original-duet.musicxml",
                "../human-mod-timbre-original.json",
                "HUMAN-MOD-TIMBRE-ORIGINAL.JSON",
                "seed-1.json",
            ] {
                action["file"] = json!(file);
                assert_eq!(
                    valid_action_for_phase(&action, phase),
                    phase == "human-timbre-seed" && file == "human-mod-timbre-original.json",
                    "{phase}: {file}"
                );
            }
            let exact = report_request("POST", sized_report(Some(phase), MAX_CLEAN_REPORT_BYTES));
            assert_eq!(
                receive_report(Some(&evidence.0), Some(&run), &exact).status(),
                200
            );
            let oversized = report_request(
                "POST",
                sized_report(Some(phase), MAX_CLEAN_REPORT_BYTES + 1),
            );
            assert_eq!(
                receive_report(Some(&evidence.0), Some(&run), &oversized).status(),
                400
            );
            let rejected =
                read_ordinary_json(&evidence.0.join(run.report_name()), MAX_CLEAN_REPORT_BYTES)
                    .unwrap();
            assert_eq!(rejected["report_failure"]["code"], "report_size");
            let wrong = report_request("POST", sized_report(Some("seed"), 512));
            assert_eq!(
                receive_report(Some(&evidence.0), Some(&run), &wrong).status(),
                400
            );
            let config = Request::builder()
                .method("GET")
                .uri("/__desktop_smoke/catalog-config")
                .body(Vec::new())
                .unwrap();
            assert_eq!(run.handle(&config).unwrap().status(), 404);
            let arbitrary = Request::builder()
                .method("POST")
                .uri("/__desktop_smoke/eval")
                .body(Vec::new())
                .unwrap();
            assert!(run.handle(&arbitrary).is_none());
        }
        for phase in [
            "human-timbre",
            "human-timbre-controls",
            "human-timbre-final",
            "HUMAN-TIMBRE-SEED",
        ] {
            assert!(Acceptance::new(evidence.0.clone(), phase).is_err());
        }
        let picker = json!({"version":1,"sequence":1,"kind":"picker","x":20,"y":30,"width":1280,"height":720,"file":"human-mod-timbre-original.json"});
        for phase in PHASES
            .into_iter()
            .chain(LIVE_TONE_NAVIGATION_PHASES)
            .chain(CANONICAL_PRACTICE_PHASES)
            .chain(SKIN_PHASES)
        {
            assert!(!valid_action_for_phase(&picker, phase));
        }
    }

    #[test]
    fn human_timbre_profile_requires_exact_migration_predecessors() {
        let evidence = Evidence::new();
        let seed = Acceptance::new(evidence.0.clone(), "human-timbre-seed").unwrap();
        let migrate = Acceptance::new(evidence.0.clone(), "human-timbre-migrate").unwrap();
        let restart = Acceptance::new(evidence.0.clone(), "human-timbre-restart").unwrap();
        assert!(migrate.prepare_webview_profile().is_err());
        assert!(restart.prepare_webview_profile().is_err());
        let profile = seed.prepare_webview_profile().unwrap();
        assert_eq!(
            profile,
            evidence.0.join("webview-profiles/human-timbre-seed")
        );
        std::fs::write(
            profile.join("retained-preferences"),
            b"original v1 and saved v2",
        )
        .unwrap();
        assert!(seed.prepare_webview_profile().is_err());
        assert!(restart.prepare_webview_profile().is_err());
        assert_eq!(migrate.prepare_webview_profile().unwrap(), profile);
        assert_eq!(restart.prepare_webview_profile().unwrap(), profile);
        assert_eq!(
            std::fs::read(profile.join("retained-preferences")).unwrap(),
            b"original v1 and saved v2"
        );
        for (phase, fresh) in [("human-timbre-seed", true), ("human-timbre-migrate", false)] {
            let path = evidence.0.join(format!("profile-{phase}.json"));
            let original = read_ordinary_json(&path, 8192).unwrap();
            assert_eq!(original["fresh_required"], fresh);
            assert_eq!(original["created_new"], fresh);
            for (field, invalid) in [
                ("phase", json!("canonical-practice-seed")),
                ("process_id", json!(0)),
                ("profile_directory", json!(evidence.0.join("other-profile"))),
                ("library_directory", json!(evidence.0.join("other-Scores"))),
                ("fresh_required", json!(!fresh)),
                ("created_new", json!(!fresh)),
            ] {
                let mut altered = original.clone();
                altered[field] = invalid;
                std::fs::write(&path, serde_json::to_vec(&altered).unwrap()).unwrap();
                assert!(
                    restart.prepare_webview_profile().is_err(),
                    "{phase}: {field}"
                );
            }
            std::fs::remove_file(&path).unwrap();
            assert!(restart.prepare_webview_profile().is_err());
            std::fs::write(&path, serde_json::to_vec(&original).unwrap()).unwrap();
        }
        assert_eq!(restart.prepare_webview_profile().unwrap(), profile);
    }

    #[test]
    fn native_live_navigation_owns_four_fresh_bounded_phases_and_only_fixed_r_actions() {
        let evidence = Evidence::new();
        for phase in LIVE_TONE_NAVIGATION_PHASES {
            let run = Acceptance::new(evidence.0.clone(), phase).unwrap();
            assert_eq!(run.library_directory(), evidence.0.join("Scores"));
            assert_eq!(
                run.profile_directory(),
                evidence.0.join("webview-profiles").join(phase)
            );
            assert!(run.prepare_webview_profile().is_ok());
            assert!(run.prepare_webview_profile().is_err());
            assert_eq!(run.report_limit(), MAX_CLEAN_REPORT_BYTES);
            assert_eq!(action_limit(phase), 64);
            let script = run.script();
            assert!(script.contains(include_str!("../live-tone-navigation-acceptance.js")));
            assert!(script.contains(include_str!("../live-tone-acceptance.js")));
            assert!(script.contains("function prepareCanonicalPracticeTarget"));
            assert!(!script.contains(include_str!("../canonical-practice-acceptance.js")));
            assert!(!script.contains(include_str!("../vsq-song-acceptance.js")));
            let mut action = json!({"version":1,"sequence":1,"kind":"live-key-r-down","x":20,"y":30,"width":1280,"height":720});
            for kind in [
                "live-key-r-down",
                "live-key-r-up",
                "click",
                "key-r",
                "select-first",
                "select-last",
            ] {
                action["kind"] = json!(kind);
                assert!(valid_action_for_phase(&action, phase));
            }
            for kind in ["key-c5", "key-ds4", "live-key-other", "canonical-tempo"] {
                action["kind"] = json!(kind);
                assert!(!valid_action_for_phase(&action, phase));
            }
            action["kind"] = json!("picker");
            action["file"] = json!("live-tone-navigation-original.json");
            assert!(valid_action_for_phase(&action, phase));
            assert!(!valid_action_for_phase(&action, "canonical-practice-seed"));
            action["file"] = json!("canonical-practice-original.json");
            assert!(!valid_action_for_phase(&action, phase));
            let exact = report_request("POST", sized_report(Some(phase), MAX_CLEAN_REPORT_BYTES));
            assert_eq!(
                receive_report(Some(&evidence.0), Some(&run), &exact).status(),
                200
            );
            let oversized = report_request(
                "POST",
                sized_report(Some(phase), MAX_CLEAN_REPORT_BYTES + 1),
            );
            assert_eq!(
                receive_report(Some(&evidence.0), Some(&run), &oversized).status(),
                400
            );
            let rejected =
                read_ordinary_json(&evidence.0.join(run.report_name()), MAX_CLEAN_REPORT_BYTES)
                    .unwrap();
            assert_eq!(rejected["report_failure"]["code"], "report_size");
        }
        let action = json!({"version":1,"sequence":1,"kind":"live-key-r-down","x":20,"y":30,"width":1280,"height":720});
        for phase in CANONICAL_PRACTICE_PHASES.into_iter().chain(PHASES) {
            assert!(!valid_action_for_phase(&action, phase));
        }
    }

    #[test]
    fn skin_profiles_and_actions_keep_exact_restart_and_picker_boundaries() {
        let evidence = Evidence::new();
        let seed = Acceptance::new(evidence.0.clone(), "skin-seed").unwrap();
        let restart = Acceptance::new(evidence.0.clone(), "skin-restart").unwrap();
        let final_run = Acceptance::new(evidence.0.clone(), "skin-default-restart").unwrap();
        assert!(restart.prepare_webview_profile().is_err());
        let profile = seed.prepare_webview_profile().unwrap();
        assert_eq!(profile, evidence.0.join("webview-profiles/skin-seed"));
        assert!(seed.prepare_webview_profile().is_err());
        std::fs::write(profile.join("retained-skin"), b"original fixture bytes").unwrap();
        assert!(final_run.prepare_webview_profile().is_err());
        assert_eq!(restart.prepare_webview_profile().unwrap(), profile);
        assert_eq!(final_run.prepare_webview_profile().unwrap(), profile);
        assert_eq!(
            std::fs::read(profile.join("retained-skin")).unwrap(),
            b"original fixture bytes"
        );
        for phase in SKIN_PHASES {
            let run = Acceptance::new(evidence.0.clone(), phase).unwrap();
            assert_eq!(run.report_limit(), MAX_CLEAN_REPORT_BYTES);
            let request = report_request("POST", sized_report(Some(phase), MAX_CLEAN_REPORT_BYTES));
            assert_eq!(
                receive_report(Some(&evidence.0), Some(&run), &request).status(),
                200
            );
            let oversized = report_request(
                "POST",
                sized_report(Some(phase), MAX_CLEAN_REPORT_BYTES + 1),
            );
            assert_eq!(
                receive_report(Some(&evidence.0), Some(&run), &oversized).status(),
                400
            );
            assert_eq!(run.library_directory(), evidence.0.join("Scores"));
            assert!(run.script().contains(include_str!("../skin-acceptance.js")));
            assert!(run
                .script()
                .contains("function prepareCanonicalPracticeTarget"));
            assert!(!run
                .script()
                .contains(include_str!("../canonical-practice-acceptance.js")));
            assert!(!run
                .script()
                .contains(include_str!("../vsq-song-acceptance.js")));
            for file in [
                "skin-original-score.json",
                "skin-original.json",
                "checker.png",
            ] {
                let action = json!({"version":1,"sequence":1,"kind":"picker","x":10,"y":10,"width":1280,"height":720,"file":file});
                assert_eq!(valid_action_for_phase(&action, phase), phase == "skin-seed");
                assert!(!valid_action_for_phase(&action, "canonical-practice-seed"));
            }
            for file in [
                "../checker.png",
                "CHECKER.PNG",
                "private.json",
                "original-duet.musicxml",
            ] {
                assert!(!valid_action_for_phase(
                    &json!({"version":1,"sequence":1,"kind":"picker","x":10,"y":10,"width":1280,"height":720,"file":file}),
                    phase
                ));
            }
        }
        std::fs::remove_file(evidence.0.join("profile-skin-restart.json")).unwrap();
        assert!(final_run.prepare_webview_profile().is_err());
    }

    #[test]
    fn canonical_practice_registration_keeps_original_observers_and_report_bounds() {
        let evidence = Evidence::new();
        for phase in CANONICAL_PRACTICE_PHASES {
            let run = Acceptance::new(evidence.0.clone(), phase).unwrap();
            let script = run.script();
            assert!(script.contains(include_str!("../canonical-practice-acceptance.js")));
            assert!(script.contains(include_str!("../reference-acceptance.js")));
            assert!(script.contains(include_str!("../live-tone-acceptance.js")));
            assert!(script.contains("function createVsqJsonObserver"));
            assert!(!script.contains(include_str!("../vsq-song-acceptance.js")));
            assert!(!script.contains(include_str!("../complete-practice-acceptance.js")));
            assert_eq!(run.library_directory(), evidence.0.join("Scores"));
            assert_eq!(
                run.profile_directory(),
                evidence.0.join("webview-profiles/canonical-practice-seed")
            );
            assert_eq!(run.report_limit(), MAX_CLEAN_REPORT_BYTES);
            let exact = report_request("POST", sized_report(Some(phase), MAX_CLEAN_REPORT_BYTES));
            assert_eq!(
                receive_report(Some(&evidence.0), Some(&run), &exact).status(),
                200
            );
            let oversized = report_request(
                "POST",
                sized_report(Some(phase), MAX_CLEAN_REPORT_BYTES + 1),
            );
            assert_eq!(
                receive_report(Some(&evidence.0), Some(&run), &oversized).status(),
                400
            );
            let rejected =
                read_ordinary_json(&evidence.0.join(run.report_name()), MAX_CLEAN_REPORT_BYTES)
                    .unwrap();
            assert_eq!(rejected["report_failure"]["code"], "report_size");
            let wrong = report_request("POST", sized_report(Some("complete-practice-seed"), 512));
            assert_eq!(
                receive_report(Some(&evidence.0), Some(&run), &wrong).status(),
                400
            );
        }
    }

    #[test]
    fn canonical_practice_profile_requires_exact_ordered_predecessors() {
        let evidence = Evidence::new();
        let seed = Acceptance::new(evidence.0.clone(), "canonical-practice-seed").unwrap();
        let controls = Acceptance::new(evidence.0.clone(), "canonical-practice-controls").unwrap();
        let restart = Acceptance::new(evidence.0.clone(), "canonical-practice-restart").unwrap();
        assert!(controls.prepare_webview_profile().is_err());
        assert!(restart.prepare_webview_profile().is_err());
        let profile = seed.prepare_webview_profile().unwrap();
        std::fs::write(profile.join("marker"), b"retain canonical preference cache").unwrap();
        assert!(seed.prepare_webview_profile().is_err());
        assert!(restart.prepare_webview_profile().is_err());
        assert_eq!(controls.prepare_webview_profile().unwrap(), profile);
        assert_eq!(restart.prepare_webview_profile().unwrap(), profile);
        assert_eq!(
            std::fs::read(profile.join("marker")).unwrap(),
            b"retain canonical preference cache"
        );
        for (phase, fresh) in [
            ("canonical-practice-seed", true),
            ("canonical-practice-controls", false),
        ] {
            let path = evidence.0.join(format!("profile-{phase}.json"));
            let original = read_ordinary_json(&path, 8192).unwrap();
            assert_eq!(original["fresh_required"], fresh);
            assert_eq!(original["created_new"], fresh);
            for (field, invalid) in [
                ("phase", json!("complete-practice-seed")),
                ("process_id", json!(0)),
                ("profile_directory", json!(evidence.0.join("other-profile"))),
                ("library_directory", json!(evidence.0.join("other-Scores"))),
                ("fresh_required", json!(!fresh)),
                ("created_new", json!(!fresh)),
            ] {
                let mut altered = original.clone();
                altered[field] = invalid;
                std::fs::write(&path, serde_json::to_vec(&altered).unwrap()).unwrap();
                assert!(
                    restart.prepare_webview_profile().is_err(),
                    "{phase}: {field}"
                );
            }
            std::fs::remove_file(&path).unwrap();
            assert!(restart.prepare_webview_profile().is_err());
            std::fs::write(&path, serde_json::to_vec(&original).unwrap()).unwrap();
        }
        assert_eq!(restart.prepare_webview_profile().unwrap(), profile);
    }

    #[test]
    fn canonical_practice_actions_and_picker_fixtures_are_phase_scoped_and_closed() {
        let evidence = Evidence::new();
        let canonical = CANONICAL_PRACTICE_PHASES;
        let other_phases = PHASES
            .into_iter()
            .chain(FOLDER_PHASES)
            .chain(BULK_PHASES)
            .chain(CLEAN_PHASES)
            .chain(VSQ_PHASES)
            .chain(PERFORMANCE_PHASES)
            .chain(PITCH_BEND_PHASES)
            .chain(AUTHORING_PHASES)
            .chain(VSQ_AUTHORING_PHASES)
            .chain(BASIC_KEY_PHASES)
            .chain(COMPLETE_PRACTICE_PHASES)
            .chain(CATALOG_PHASES);
        let actions = [
            ("canonical-range-start", None),
            ("canonical-range-end", None),
            ("canonical-tempo", None),
            ("picker", Some("canonical-practice-original.json")),
            ("picker", Some("canonical-practice-original.musicxml")),
        ];
        for phase in canonical.into_iter().chain(other_phases) {
            let run = Acceptance::new(evidence.0.clone(), phase).unwrap();
            for (kind, file) in actions {
                let mut action = json!({"version":1,"sequence":64,"kind":kind,"x":1,"y":1,"width":1280,"height":720});
                if let Some(file) = file {
                    action["file"] = json!(file);
                }
                let request = Request::builder()
                    .method("POST")
                    .uri("/__desktop_smoke/action")
                    .body(serde_json::to_vec(&action).unwrap())
                    .unwrap();
                assert_eq!(
                    run.handle(&request).unwrap().status(),
                    if (kind == "picker" && canonical.contains(&phase))
                        || (kind != "picker" && phase == "canonical-practice-controls")
                    {
                        200
                    } else {
                        400
                    },
                    "{phase}: {kind}"
                );
                for (field, invalid) in [
                    ("sequence", json!(action_limit(phase) + 1)),
                    ("field", json!("loop-from")),
                    ("value", json!("2")),
                    ("keys", json!([17, 65, 50, 9])),
                    ("text", json!("90")),
                ] {
                    let mut changed = action.clone();
                    changed[field] = invalid;
                    assert!(!valid_action_for_phase(&changed, phase), "{phase}: {field}");
                }
            }
        }
        for kind in [
            "canonical-transpose",
            "canonical-tempo90",
            "canonical-range-any",
            "CANONICAL-TEMPO",
            "canonical-tempo\n",
        ] {
            let action =
                json!({"version":1,"sequence":1,"kind":kind,"x":1,"y":1,"width":1280,"height":720});
            assert!(
                !valid_action_for_phase(&action, "canonical-practice-controls"),
                "{kind}"
            );
        }
        for file in [
            "../canonical-practice-original.json",
            "canonical-practice-original.json.extra",
            "canonical-practice-original.musicxml\n",
            "CANONICAL-PRACTICE-ORIGINAL.JSON",
            "canonical-practice-seed-1.json",
        ] {
            let action = json!({"version":1,"sequence":1,"kind":"picker","x":1,"y":1,"width":1280,"height":720,"file":file});
            assert!(!valid_action_for_phase(&action, canonical[0]), "{file}");
        }
        let with_file = json!({"version":1,"sequence":1,"kind":"canonical-tempo","x":1,"y":1,"width":1280,"height":720,"file":"canonical-practice-original.json"});
        assert!(!valid_action_for_phase(
            &with_file,
            "canonical-practice-controls"
        ));
    }

    #[test]
    fn complete_practice_phases_keep_bounded_native_routing() {
        for phase in COMPLETE_PRACTICE_PHASES {
            let evidence = Evidence::new();
            let run = Acceptance::new(evidence.0.clone(), phase).unwrap();
            assert!(run
                .script()
                .contains(include_str!("../complete-practice-acceptance.js")));
            assert!(run.script().contains("function createVsqJsonObserver"));
            assert_eq!(run.report_limit(), MAX_CLEAN_REPORT_BYTES);
            assert!(run.library_directory().ends_with("Scores"));
            assert!(run.profile_directory().ends_with("complete-practice-seed"));
        }
        assert!(valid_action(
            &json!({"version":1,"sequence":64,"kind":"picker","x":1,"y":1,"width":1280,"height":720,"file":"complete-practice-original.zip"})
        ));
        assert!(!valid_action(
            &json!({"version":1,"sequence":65,"kind":"picker","x":1,"y":1,"width":1280,"height":720,"file":"complete-practice-original.zip"})
        ));
    }

    #[test]
    fn complete_practice_restart_requires_the_existing_seed_profile() {
        let evidence = Evidence::new();
        let seed = Acceptance::new(evidence.0.clone(), "complete-practice-seed").unwrap();
        let restart = Acceptance::new(evidence.0.clone(), "complete-practice-restart").unwrap();
        assert!(restart.prepare_webview_profile().is_err());
        let profile = seed.prepare_webview_profile().unwrap();
        std::fs::write(profile.join("marker"), b"preserve this owned cache").unwrap();
        assert!(seed.prepare_webview_profile().is_err());
        assert_eq!(restart.prepare_webview_profile().unwrap(), profile);
        assert_eq!(
            std::fs::read(profile.join("marker")).unwrap(),
            b"preserve this owned cache"
        );
        let proof = read_ordinary_json(
            &evidence.0.join("profile-complete-practice-restart.json"),
            8192,
        )
        .unwrap();
        assert_eq!(proof["fresh_required"], false);
        assert_eq!(proof["created_new"], false);
        std::fs::remove_file(evidence.0.join("profile-complete-practice-seed.json")).unwrap();
        assert!(restart.prepare_webview_profile().is_err());
    }

    #[test]
    fn atomic_json_preserves_open_snapshot_while_publishing_complete_replacement() {
        use std::io::Read;
        let evidence = Evidence::new();
        std::fs::create_dir_all(&evidence.0).unwrap();
        for name in [
            "trace-performance-seed.json",
            "action-performance-seed-1.json",
            "renderer-performance-seed.json",
            "profile-performance-seed.json",
            "renderer-report.json",
        ] {
            let previous = br#"{"version":1,"marker":"complete old"}"#;
            let next = br#"{"version":2,"marker":"complete new"}"#;
            atomic_json(&evidence.0, name, previous).unwrap();
            let mut options = std::fs::OpenOptions::new();
            options.read(true);
            #[cfg(windows)]
            {
                use std::os::windows::fs::OpenOptionsExt;
                // FILE_SHARE_READ | FILE_SHARE_WRITE | FILE_SHARE_DELETE.
                options.share_mode(7);
            }
            let mut held_reader = options.open(evidence.0.join(name)).unwrap();
            // Publication completes with the earlier snapshot handle still open.
            atomic_json(&evidence.0, name, next).unwrap();
            let mut held_bytes = Vec::new();
            held_reader.read_to_end(&mut held_bytes).unwrap();
            assert_eq!(held_bytes, previous);
            assert_eq!(std::fs::read(evidence.0.join(name)).unwrap(), next);
            assert!(!evidence.0.join(format!("{name}.tmp")).exists());
        }
    }

    #[test]
    fn atomic_json_staging_failure_preserves_published_evidence() {
        let evidence = Evidence::new();
        std::fs::create_dir_all(&evidence.0).unwrap();
        let name = "trace-performance-seed.json";
        let previous = br#"{"version":1,"events":[]}"#;
        atomic_json(&evidence.0, name, previous).unwrap();
        // A process-owned directory blocks staging without mutating the final.
        std::fs::create_dir(evidence.0.join(format!("{name}.tmp"))).unwrap();
        assert!(atomic_json(&evidence.0, name, br#"{"version":2}"#).is_err());
        assert_eq!(std::fs::read(evidence.0.join(name)).unwrap(), previous);
    }

    #[cfg(windows)]
    #[test]
    fn atomic_json_rejects_unshared_replacement_without_rewriting_old_evidence() {
        use std::os::windows::fs::OpenOptionsExt;
        let evidence = Evidence::new();
        std::fs::create_dir_all(&evidence.0).unwrap();
        let name = "trace-performance-seed.json";
        let previous = br#"{"version":1,"events":[]}"#;
        let next = br#"{"version":2,"events":[]}"#;
        atomic_json(&evidence.0, name, previous).unwrap();
        let held = std::fs::OpenOptions::new()
            .read(true)
            .share_mode(3) // Deliberately omit FILE_SHARE_DELETE.
            .open(evidence.0.join(name))
            .unwrap();
        assert!(atomic_json(&evidence.0, name, next).is_err());
        assert_eq!(std::fs::read(evidence.0.join(name)).unwrap(), previous);
        assert_eq!(
            std::fs::read(evidence.0.join(format!("{name}.tmp"))).unwrap(),
            next
        );
        drop(held);
        atomic_json(&evidence.0, name, next).unwrap();
        assert_eq!(std::fs::read(evidence.0.join(name)).unwrap(), next);
    }

    #[test]
    fn fresh_profiles_are_phase_bound_while_native_scores_and_old_profiles_persist() {
        let evidence = Evidence::new();
        std::fs::create_dir_all(evidence.0.join("Scores")).unwrap();
        let score = evidence.0.join("Scores/original.bin");
        std::fs::write(&score, b"persisted native score").unwrap();
        let mut profiles = Vec::new();
        let mut held_profiles = Vec::new();
        for phase in FOLDER_PHASES
            .into_iter()
            .chain(BULK_PHASES)
            .chain(CLEAN_PHASES)
            .chain(VSQ_PHASES)
            .chain(PERFORMANCE_PHASES)
            .chain(PITCH_BEND_PHASES)
            .chain(AUTHORING_PHASES)
            .chain(VSQ_AUTHORING_PHASES)
            .chain(BASIC_KEY_PHASES)
        {
            let run = Acceptance::new(evidence.0.clone(), phase).unwrap();
            let profile = run.prepare_webview_profile().unwrap();
            assert_eq!(profile, evidence.0.join("webview-profiles").join(phase));
            assert!(!profiles.contains(&profile));
            assert_eq!(std::fs::read_dir(&profile).unwrap().count(), 0);
            assert_eq!(
                run.prepare_webview_profile().unwrap_err().kind(),
                std::io::ErrorKind::AlreadyExists
            );
            assert_eq!(run.library_directory(), evidence.0.join("Scores"));
            assert_eq!(std::fs::read(&score).unwrap(), b"persisted native score");
            let proof: Value = serde_json::from_slice(
                &std::fs::read(evidence.0.join(format!("profile-{phase}.json"))).unwrap(),
            )
            .unwrap();
            assert_eq!(
                proof,
                json!({
                    "version": 1, "phase": phase, "process_id": std::process::id(),
                    "profile_directory": profile, "library_directory": run.library_directory(),
                    "fresh_required": true, "created_new": true,
                })
            );
            // Keep prior cache handles open while choosing each next profile.
            // Freshness never depends on renaming or deleting prior browser data.
            std::fs::write(profile.join("browser-marker"), phase).unwrap();
            held_profiles.push(std::fs::File::open(profile.join("browser-marker")).unwrap());
            profiles.push(profile);
        }
        for profile in &profiles {
            assert_eq!(
                std::fs::read_to_string(profile.join("browser-marker")).unwrap(),
                profile.file_name().unwrap().to_str().unwrap()
            );
        }
        drop(held_profiles);
    }

    #[test]
    fn fresh_profile_precondition_rejects_existing_empty_populated_or_file_paths() {
        for occupied in ["empty", "populated", "file"] {
            let evidence = Evidence::new();
            let run = Acceptance::new(evidence.0.clone(), "vsq-restart").unwrap();
            let profile = run.profile_directory();
            std::fs::create_dir_all(profile.parent().unwrap()).unwrap();
            if occupied == "file" {
                std::fs::write(&profile, b"occupied").unwrap();
            } else {
                std::fs::create_dir(&profile).unwrap();
                if occupied == "populated" {
                    std::fs::write(profile.join("marker"), b"retained").unwrap();
                }
            }
            let error = run.prepare_webview_profile().unwrap_err();
            assert_eq!(error.kind(), std::io::ErrorKind::AlreadyExists);
            assert!(error.to_string().contains("vsq-restart"));
            assert!(error.to_string().contains(profile.to_str().unwrap()));
            assert!(!evidence.0.join("profile-vsq-restart.json").exists());
        }
    }

    #[test]
    fn desktop_restart_phases_keep_the_same_browser_storage() {
        let evidence = Evidence::new();
        for (index, phase) in PHASES.into_iter().enumerate() {
            let run = Acceptance::new(evidence.0.clone(), phase).unwrap();
            let profile = run.prepare_webview_profile().unwrap();
            assert_eq!(profile, evidence.0.join("webview-profile"));
            let marker = profile.join("shared-marker");
            if index == 0 {
                std::fs::write(&marker, b"shared browser state").unwrap();
            }
            assert_eq!(std::fs::read(marker).unwrap(), b"shared browser state");
            let proof: Value = serde_json::from_slice(
                &std::fs::read(evidence.0.join(format!("profile-{phase}.json"))).unwrap(),
            )
            .unwrap();
            assert_eq!(proof["fresh_required"], false);
            assert_eq!(proof["created_new"], index == 0);
        }
    }

    #[test]
    fn catalog_profiles_require_new_seed_then_matching_existing_predecessors() {
        let evidence = Evidence::new();
        for phase in ["catalog-restart", "catalog-final"] {
            let run = Acceptance::new(evidence.0.clone(), phase).unwrap();
            assert!(run.prepare_webview_profile().is_err());
            assert!(!run.profile_directory().exists());
        }
        let seed = Acceptance::new(evidence.0.clone(), "catalog-seed").unwrap();
        let profile = seed.prepare_webview_profile().unwrap();
        assert_eq!(profile, evidence.0.join("webview-catalog-profile"));
        assert!(seed.prepare_webview_profile().is_err());
        std::fs::write(profile.join("retained-browser-data"), b"unchanged").unwrap();
        let restart = Acceptance::new(evidence.0.clone(), "catalog-restart").unwrap();
        let seed_proof = evidence.0.join("profile-catalog-seed.json");
        let original = std::fs::read(&seed_proof).unwrap();
        for (field, wrong) in [
            ("phase", json!("seed")),
            ("process_id", json!(true)),
            (
                "profile_directory",
                json!(evidence.0.join("webview-profile")),
            ),
            ("library_directory", json!(evidence.0.join("score-library"))),
            ("fresh_required", json!(false)),
            ("created_new", json!(false)),
        ] {
            let mut proof: Value = serde_json::from_slice(&original).unwrap();
            proof[field] = wrong;
            std::fs::write(&seed_proof, serde_json::to_vec(&proof).unwrap()).unwrap();
            assert!(restart.prepare_webview_profile().is_err(), "{field}");
        }
        std::fs::write(&seed_proof, original).unwrap();
        let final_run = Acceptance::new(evidence.0.clone(), "catalog-final").unwrap();
        assert!(final_run.prepare_webview_profile().is_err());
        assert_eq!(restart.prepare_webview_profile().unwrap(), profile);
        assert_eq!(final_run.prepare_webview_profile().unwrap(), profile);
        for phase in CATALOG_PHASES {
            let proof = read_ordinary_json(&evidence.0.join(format!("profile-{phase}.json")), 8192)
                .unwrap();
            assert_eq!(proof["fresh_required"], phase == "catalog-seed");
            assert_eq!(proof["created_new"], phase == "catalog-seed");
            assert_eq!(proof["library_directory"], json!(evidence.0.join("Scores")));
        }
        assert_eq!(
            std::fs::read(profile.join("retained-browser-data")).unwrap(),
            b"unchanged"
        );
        std::fs::remove_dir_all(&profile).unwrap();
        assert!(restart.prepare_webview_profile().is_err());
        assert!(!profile.exists());
    }

    #[test]
    fn catalog_configuration_and_snapshot_routes_are_bounded_and_phase_owned() {
        let evidence = Evidence::new();
        let seed = Acceptance::new(evidence.0.clone(), "catalog-seed").unwrap();
        let config = evidence.0.join("catalog-config.json");
        std::fs::write(&config, br#"{"version":1,"run_id":"owned"}"#).unwrap();
        let get = Request::builder()
            .method("GET")
            .uri("/__desktop_smoke/catalog-config")
            .body(vec![])
            .unwrap();
        assert_eq!(seed.handle(&get).unwrap().status(), 200);
        for phase in PHASES.into_iter().chain(BASIC_KEY_PHASES) {
            let other = Acceptance::new(evidence.0.clone(), phase).unwrap();
            assert_eq!(other.handle(&get).unwrap().status(), 404);
        }
        for bytes in [
            b"[]".to_vec(),
            b"invalid".to_vec(),
            vec![b' '; 128 * 1024 + 1],
        ] {
            std::fs::write(&config, bytes).unwrap();
            assert_eq!(seed.handle(&get).unwrap().status(), 500);
        }
        let checkpoint = Request::builder().method("POST").uri("/__desktop_smoke/action")
            .body(serde_json::to_vec(&json!({"version":1,"sequence":1,"kind":"catalog-snapshot-before","x":1,"y":1,"width":1280,"height":720})).unwrap()).unwrap();
        assert_eq!(seed.handle(&checkpoint).unwrap().status(), 200);
        assert_eq!(seed.handle(&checkpoint).unwrap().status(), 400);
        for phase in ["catalog-restart", "catalog-final", "seed", "bulk-seed"] {
            let other = Acceptance::new(evidence.0.clone(), phase).unwrap();
            assert_eq!(other.handle(&checkpoint).unwrap().status(), 400);
        }
        assert!(evidence.0.join("action-catalog-seed-1.json").is_file());
    }

    #[cfg(unix)]
    #[test]
    fn catalog_profiles_and_configuration_reject_linked_evidence() {
        let evidence = Evidence::new();
        let seed = Acceptance::new(evidence.0.clone(), "catalog-seed").unwrap();
        let profile = seed.prepare_webview_profile().unwrap();
        let outside = evidence.0.join("outside-profile");
        std::fs::rename(&profile, &outside).unwrap();
        std::os::unix::fs::symlink(&outside, &profile).unwrap();
        let restart = Acceptance::new(evidence.0.clone(), "catalog-restart").unwrap();
        assert!(restart.prepare_webview_profile().is_err());
        std::fs::remove_file(&profile).unwrap();
        std::fs::rename(&outside, &profile).unwrap();
        let seed_proof = evidence.0.join("profile-catalog-seed.json");
        let linked = evidence.0.join("linked-proof.json");
        std::fs::rename(&seed_proof, &linked).unwrap();
        std::os::unix::fs::symlink(&linked, &seed_proof).unwrap();
        assert!(restart.prepare_webview_profile().is_err());
        std::os::unix::fs::symlink(&linked, evidence.0.join("catalog-config.json")).unwrap();
        let get = Request::builder()
            .method("GET")
            .uri("/__desktop_smoke/catalog-config")
            .body(vec![])
            .unwrap();
        assert_eq!(seed.handle(&get).unwrap().status(), 500);
    }

    #[test]
    fn catalog_registration_preserves_finite_inputs_and_one_mib_report_protocol() {
        let evidence = Evidence::new();
        for phase in CATALOG_PHASES {
            let run = Acceptance::new(evidence.0.clone(), phase).unwrap();
            assert!(run
                .script()
                .contains(include_str!("../library-catalog-acceptance.js")));
            assert!(run.script().contains(include_str!("../acceptance-wait.js")));
            assert!(run
                .script()
                .contains(include_str!("../reference-acceptance.js")));
            assert_eq!(run.library_directory(), evidence.0.join("Scores"));
            assert_eq!(run.report_limit(), MAX_CLEAN_REPORT_BYTES);
            let request = report_request("POST", sized_report(Some(phase), MAX_CLEAN_REPORT_BYTES));
            assert_eq!(
                receive_report(Some(&evidence.0), Some(&run), &request).status(),
                200
            );
            let oversized = report_request(
                "POST",
                sized_report(Some(phase), MAX_CLEAN_REPORT_BYTES + 1),
            );
            assert_eq!(
                receive_report(Some(&evidence.0), Some(&run), &oversized).status(),
                400
            );
            let rejected =
                read_ordinary_json(&evidence.0.join(run.report_name()), MAX_CLEAN_REPORT_BYTES)
                    .unwrap();
            assert_eq!(rejected["report_failure"]["code"], "report_size");
            let wrong_phase = report_request("POST", sized_report(Some("seed"), 512));
            assert_eq!(
                receive_report(Some(&evidence.0), Some(&run), &wrong_phase).status(),
                400
            );
            assert!(run
                .download("catalog.wmhpack")
                .unwrap()
                .ends_with(format!("{phase}-1.zip")));
            assert!(run
                .download("catalog.zip")
                .unwrap()
                .ends_with(format!("{phase}-2.zip")));
            for suffix in ["1.zip", "16.json"] {
                assert!(valid_action(
                    &json!({"version":1,"sequence":64,"kind":"picker","x":1,"y":1,"width":1280,"height":720,"file":format!("{phase}-{suffix}")})
                ));
            }
        }
        for file in [
            "catalog-original-legacy.zip",
            "catalog-original-shared.zip",
            "catalog-original-clean.zip",
        ] {
            let action = json!({"version":1,"sequence":1,"kind":"picker","x":1,"y":1,"width":1280,"height":720,"file":file});
            assert!(valid_action(&action));
            for invalid in [
                format!("../{file}"),
                format!("{file}.extra"),
                file.to_uppercase(),
            ] {
                let mut wrong = action.clone();
                wrong["file"] = json!(invalid);
                assert!(!valid_action(&wrong));
            }
        }
        for phase in [
            "catalog-any",
            "catalog-seed-extra",
            "Catalog-seed",
            "../catalog-seed",
        ] {
            assert!(Acceptance::new(evidence.0.clone(), phase).is_err());
        }
    }

    #[test]
    fn profile_parents_must_be_ordinary_owned_directories() {
        let evidence = Evidence::new();
        let run = Acceptance::new(evidence.0.clone(), "pitch-bend-seed").unwrap();
        std::fs::write(evidence.0.join("webview-profiles"), b"occupied").unwrap();
        assert!(run.prepare_webview_profile().is_err());
        assert!(!evidence.0.join("profile-pitch-bend-seed.json").exists());
    }

    #[cfg(unix)]
    #[test]
    fn linked_profile_parents_and_dangling_profile_paths_are_rejected() {
        let evidence = Evidence::new();
        let run = Acceptance::new(evidence.0.clone(), "vsq-seed").unwrap();
        let outside = Evidence::new();
        std::fs::create_dir(&outside.0).unwrap();
        let parent = evidence.0.join("webview-profiles");
        std::os::unix::fs::symlink(&outside.0, &parent).unwrap();
        assert!(run.prepare_webview_profile().is_err());
        assert_eq!(std::fs::read_dir(&outside.0).unwrap().count(), 0);
        std::fs::remove_file(&parent).unwrap();
        std::fs::create_dir(&parent).unwrap();
        std::os::unix::fs::symlink(outside.0.join("missing"), run.profile_directory()).unwrap();
        assert!(run.prepare_webview_profile().is_err());
        assert!(!outside.0.join("missing").exists());
    }

    #[test]
    fn every_acceptance_phase_uses_the_same_library_root_as_its_snapshot_owner() {
        let evidence = Evidence::new();
        for phase in PHASES {
            let run = Acceptance::new(evidence.0.clone(), phase).unwrap();
            assert_eq!(run.library_directory(), evidence.0.join("score-library"));
        }
        for phase in FOLDER_PHASES
            .into_iter()
            .chain(BULK_PHASES)
            .chain(CLEAN_PHASES)
            .chain(VSQ_PHASES)
            .chain(PERFORMANCE_PHASES)
            .chain(PITCH_BEND_PHASES)
            .chain(AUTHORING_PHASES)
            .chain(VSQ_AUTHORING_PHASES)
            .chain(BASIC_KEY_PHASES)
        {
            let run = Acceptance::new(evidence.0.clone(), phase).unwrap();
            assert_eq!(
                run.library_directory(),
                evidence.0.join("Scores"),
                "{phase}"
            );
        }
        for phase in [
            "performance-any",
            "performance-seed-extra",
            "pitch-bend-any",
            "pitch-bend-seed-extra",
            "unknown",
            "",
            "../vsq-seed",
            "vsq-seed/extra",
            "VSQ-seed",
            "vsq-seed\\extra",
        ] {
            assert!(Acceptance::new(evidence.0.clone(), phase).is_err());
        }
    }

    #[test]
    fn clean_reports_have_exact_inclusive_budget_and_finite_native_actions() {
        for phase in CLEAN_PHASES
            .into_iter()
            .chain(VSQ_PHASES)
            .chain(PERFORMANCE_PHASES)
            .chain(PITCH_BEND_PHASES)
            .chain(AUTHORING_PHASES)
            .chain(VSQ_AUTHORING_PHASES)
            .chain(BASIC_KEY_PHASES)
        {
            let evidence = Evidence::new();
            let run = Acceptance::new(evidence.0.clone(), phase).unwrap();
            assert!(run.script().contains(if BASIC_KEY_PHASES.contains(&phase) {
                include_str!("../basic-key-acceptance.js")
            } else if VSQ_AUTHORING_PHASES.contains(&phase) {
                include_str!("../vsq-authoring-acceptance.js")
            } else if AUTHORING_PHASES.contains(&phase) {
                include_str!("../song-authoring-acceptance.js")
            } else if PITCH_BEND_PHASES.contains(&phase) {
                include_str!("../pitch-bend-acceptance.js")
            } else if PERFORMANCE_PHASES.contains(&phase) {
                include_str!("../performance-song-acceptance.js")
            } else if VSQ_PHASES.contains(&phase) {
                "VSQ native control unavailable"
            } else {
                "Native clean control unavailable"
            }));
            assert!(run
                .download("complete.zip")
                .unwrap()
                .ends_with(format!("{phase}-1.zip")));
            for size in [MAX_SMOKE_REPORT_BYTES + 1, MAX_CLEAN_REPORT_BYTES] {
                let bytes = sized_report(Some(phase), size);
                let request = report_request("POST", bytes.clone());
                assert!(crate::admission(&request).is_none());
                assert_eq!(
                    receive_report(Some(&evidence.0), Some(&run), &request).status(),
                    200
                );
                assert_eq!(
                    std::fs::read(evidence.0.join(run.report_name())).unwrap(),
                    bytes
                );
            }
            let request = report_request(
                "POST",
                sized_report(Some(phase), MAX_CLEAN_REPORT_BYTES + 1),
            );
            assert_eq!(
                receive_report(Some(&evidence.0), Some(&run), &request).status(),
                400
            );
            let failure: Value =
                serde_json::from_slice(&std::fs::read(evidence.0.join(run.report_name())).unwrap())
                    .unwrap();
            assert_eq!(failure["ok"], false);
            assert_eq!(
                failure["report_failure"]["limit_bytes"],
                MAX_CLEAN_REPORT_BYTES
            );
            assert_eq!(failure["report_failure"]["code"], "report_size");
            let request = report_request("POST", sized_report(Some("bulk-seed"), 512));
            assert_eq!(
                receive_report(Some(&evidence.0), Some(&run), &request).status(),
                400
            );
        }
        for file in [
            "clean-authored-song.zip",
            "vsq-authored-song.zip",
            "performance-authored-songs.zip",
            "pitch-bend-authored-songs.zip",
            "performance-seed-1.zip",
            "performance-controls-16.zip",
            "performance-restart-16.json",
            "pitch-bend-seed-1.zip",
            "pitch-bend-restart-16.json",
            "clean-seed-1.zip",
            "vsq-seed-1.zip",
            "vsq-restart-16.json",
            "clean-restart-16.json",
        ] {
            assert!(valid_action(
                &json!({"version":1,"sequence":1,"kind":"picker","x":1,"y":1,"width":900,"height":640,"file":file})
            ));
        }
        for file in [
            "clean-any-1.zip",
            "clean-seed-17.zip",
            "vsq-seed-17.zip",
            "../vsq-authored-song.zip",
            "../clean-authored-song.zip",
            "performance-seed-17.zip",
            "performance-any-1.zip",
            "../performance-authored-songs.zip",
            "../pitch-bend-authored-songs.zip",
            "pitch-bend-seed-17.zip",
            "pitch-bend-any-1.zip",
        ] {
            assert!(!valid_action(
                &json!({"version":1,"sequence":1,"kind":"picker","x":1,"y":1,"width":900,"height":640,"file":file})
            ));
        }
        assert!(valid_action(
            &json!({"version":1,"sequence":1,"kind":"select-last","x":1,"y":1,"width":900,"height":640})
        ));
        assert!(!valid_action(
            &json!({"version":1,"sequence":1,"kind":"select-last","x":1,"y":1,"width":900,"height":640,"file":"clean-authored-song.zip"})
        ));
        assert!(Acceptance::new(Evidence::new().0.clone(), "clean-any").is_err());
        assert!(Acceptance::new(Evidence::new().0.clone(), "performance-any").is_err());
    }

    #[test]
    fn performance_observers_share_only_the_unique_vsq_prefix() {
        let vsq = include_str!("../vsq-song-acceptance.js");
        assert_eq!(vsq.matches("(() => {").count(), 1);
        let (prefix, runner) = vsq.split_once("(() => {").unwrap();
        let evidence = Evidence::new();
        let run = Acceptance::new(evidence.0.clone(), "performance-controls").unwrap();
        let script = run.script();
        assert!(script.contains(prefix));
        assert!(!script.contains(runner));
        assert!(script.contains("createVsqJsonObserver"));
        assert!(script.contains("readVsqPickerGesture"));
    }

    #[test]
    fn vsq_authoring_reuses_only_helpers_and_keeps_two_finite_phases() {
        assert_eq!(
            VSQ_AUTHORING_PHASES,
            ["vsq-authoring-seed", "vsq-authoring-restart"]
        );
        for phase in VSQ_AUTHORING_PHASES {
            let evidence = Evidence::new();
            let run = Acceptance::new(evidence.0.clone(), phase).unwrap();
            let script = run.script();
            assert!(
                script.starts_with(&format!("globalThis.__WMH_ACCEPTANCE_PHASE__=\"{phase}\";"))
            );
            for source in [
                include_str!("../vsq-song-acceptance.js"),
                include_str!("../performance-song-acceptance.js"),
                include_str!("../song-authoring-acceptance.js"),
            ] {
                let (helper, runner) = source.split_once("(() => {").unwrap();
                assert!(script.contains(helper));
                assert!(!script.contains(runner));
            }
            for source in [
                include_str!("../acceptance-wait.js"),
                include_str!("../reference-acceptance.js"),
                include_str!("../vsq-authoring-acceptance.js"),
            ] {
                assert!(script.contains(source));
            }
            assert_eq!(run.report_limit(), MAX_CLEAN_REPORT_BYTES);
            assert_eq!(run.report_name(), format!("renderer-{phase}.json"));
            for sequence in 1..=16 {
                let extension = if sequence % 2 == 0 { "json" } else { "zip" };
                assert!(run
                    .download(&format!("original.{extension}"))
                    .unwrap()
                    .ends_with(format!("{phase}-{sequence}.{extension}")));
                for extension in ["json", "zip"] {
                    assert!(valid_action(
                        &json!({"version":1,"sequence":64,"kind":"picker","x":1,"y":1,"width":900,"height":640,"file":format!("{phase}-{sequence}.{extension}")})
                    ));
                }
            }
            assert!(run.download("original.zip").is_none());
            for suffix in [
                "0.zip",
                "17.zip",
                "01.zip",
                "001.json",
                "+1.zip",
                "-1.zip",
                "1.ZIP",
                "1.vsq",
                "1.zip.extra",
                "1.zip\n",
                "1.json/",
            ] {
                assert!(!valid_action(
                    &json!({"version":1,"sequence":1,"kind":"picker","x":1,"y":1,"width":900,"height":640,"file":format!("{phase}-{suffix}")})
                ));
            }
        }
        for phase in [
            "vsq-authoring",
            "vsq-authoring-any",
            "vsq-authoring-seed-extra",
            "vsq-authoring-restart-extra",
            "Vsq-authoring-seed",
            "vsq-authoring-seed\n",
            "../vsq-authoring-seed",
            "vsq-authoring-seed/",
        ] {
            let evidence = Evidence::new();
            assert!(
                Acceptance::new(evidence.0.clone(), phase).is_err(),
                "{phase}"
            );
            assert!(!evidence.0.exists());
        }
    }

    #[test]
    fn vsq_authoring_picker_admits_only_the_exact_original_filename() {
        let mut action = json!({"version":1,"sequence":64,"kind":"picker","x":1,"y":1,"width":900,"height":640,"file":"authoring-original.vsq"});
        assert!(valid_action(&action));
        for filename in [
            "../authoring-original.vsq",
            "..\\authoring-original.vsq",
            "fixtures/authoring-original.vsq",
            "fixtures\\authoring-original.vsq",
            "Authoring-original.vsq",
            "authoring-original.VSQ",
            "authoring-original.vsq.extra",
            "authoring-original.vsq\n",
            "authoring-original.vsq\0",
            "authoring-original-vsq-pair",
            "vsq-authoring-original.vsq",
            "authoring-original.vsq authoring-original-strict.mid",
        ] {
            action["file"] = json!(filename);
            assert!(!valid_action(&action), "{filename}");
        }
        action["file"] = json!("authoring-original.vsq");
        for sequence in [0, 65] {
            action["sequence"] = json!(sequence);
            assert!(!valid_action(&action));
        }
        action["sequence"] = json!(1);
        for field in ["text", "key", "duration"] {
            action[field] = json!("unbounded");
            assert!(!valid_action(&action));
            action.as_object_mut().unwrap().remove(field);
        }
    }

    #[test]
    fn authoring_phases_include_only_the_owned_runner_and_finite_downloads() {
        assert_eq!(AUTHORING_PHASES, ["authoring-seed", "authoring-restart"]);
        let vsq = include_str!("../vsq-song-acceptance.js");
        let performance = include_str!("../performance-song-acceptance.js");
        let (vsq_prefix, vsq_runner) = vsq.split_once("(() => {").unwrap();
        let (performance_prefix, performance_runner) = performance.split_once("(() => {").unwrap();
        for phase in AUTHORING_PHASES {
            let evidence = Evidence::new();
            let run = Acceptance::new(evidence.0.clone(), phase).unwrap();
            let script = run.script();
            assert!(
                script.starts_with(&format!("globalThis.__WMH_ACCEPTANCE_PHASE__=\"{phase}\";"))
            );
            for helper in [
                include_str!("../acceptance-wait.js"),
                include_str!("../reference-acceptance.js"),
                vsq_prefix,
                performance_prefix,
                include_str!("../song-authoring-acceptance.js"),
            ] {
                assert!(script.contains(helper));
            }
            assert!(!script.contains(vsq_runner));
            assert!(!script.contains(performance_runner));
            assert_eq!(run.report_limit(), MAX_CLEAN_REPORT_BYTES);
            assert_eq!(run.report_name(), format!("renderer-{phase}.json"));
            for sequence in 1..=16 {
                let extension = if sequence % 2 == 0 { "json" } else { "zip" };
                assert_eq!(
                    run.download(&format!("original.{extension}")).unwrap(),
                    evidence
                        .0
                        .join("downloads")
                        .join(format!("{phase}-{sequence}.{extension}"))
                );
                for extension in ["json", "zip"] {
                    assert!(valid_action(
                        &json!({"version":1,"sequence":64,"kind":"picker","x":1,"y":1,"width":900,"height":640,"file":format!("{phase}-{sequence}.{extension}")})
                    ));
                }
            }
            assert!(run.download("original.zip").is_none());
            assert!(run.download("original.json").is_none());
            for suffix in [
                "0.zip",
                "17.zip",
                "01.zip",
                "001.json",
                "+1.zip",
                "-1.zip",
                "1.ZIP",
                "1.mid",
                "1.zip.extra",
                "1.zip\n",
                "1.json/",
            ] {
                assert!(
                    !valid_action(
                        &json!({"version":1,"sequence":1,"kind":"picker","x":1,"y":1,"width":900,"height":640,"file":format!("{phase}-{suffix}")})
                    ),
                    "{phase}-{suffix}"
                );
            }
            for sequence in [0, action_limit(phase) + 1] {
                let request = Request::builder()
                    .uri(format!(
                        "https://wmh.localhost/__desktop_smoke/result/{sequence}"
                    ))
                    .body(vec![])
                    .unwrap();
                assert_eq!(run.handle(&request).unwrap().status(), 400);
            }
        }
        for phase in [
            "authoring",
            "authoring-any",
            "authoring-seed-extra",
            "authoring-restart-extra",
            "Authoring-seed",
            "authoring-SEED",
            "authoring-seed\n",
            "authoring-seed\0",
            "../authoring-seed",
            "authoring-seed/",
            "authoring-restart/../seed",
        ] {
            let evidence = Evidence::new();
            assert!(
                Acceptance::new(evidence.0.clone(), phase).is_err(),
                "{phase}"
            );
            assert!(
                !evidence.0.exists(),
                "Rejected phase created storage: {phase}"
            );
        }
    }

    #[test]
    fn basic_key_phases_use_original_fixtures_and_the_owned_runner() {
        for phase in BASIC_KEY_PHASES {
            let run = Acceptance::new(Evidence::new().0.clone(), phase).unwrap();
            assert!(run
                .script()
                .contains(include_str!("../basic-key-acceptance.js")));
            assert_eq!(run.report_limit(), MAX_CLEAN_REPORT_BYTES);
            assert!(run.library_directory().ends_with("Scores"));
            assert!(run
                .download("complete.zip")
                .unwrap()
                .ends_with(format!("{phase}-1.zip")));
        }
        for file in [
            "basic-key-original.zip",
            "basic-key-invalid-profile.zip",
            "basic-key-forged-coverage.zip",
        ] {
            assert!(valid_action(
                &json!({"version":1,"sequence":1,"kind":"picker","x":1,"y":1,"width":1280,"height":720,"file":file})
            ));
        }
        for kind in ["select-first", "select-second", "key-c5", "toggle-follow"] {
            assert!(valid_action(
                &json!({"version":1,"sequence":1,"kind":kind,"x":1,"y":1,"width":1280,"height":720})
            ));
            assert!(!valid_action(
                &json!({"version":1,"sequence":1,"kind":kind,"x":1,"y":1,"width":1280,"height":720,"file":"basic-key-original.zip"})
            ));
        }
        for phase in ["basic-key-any", "basic-key-seed-extra", "../basic-key-seed"] {
            assert!(Acceptance::new(Evidence::new().0.clone(), phase).is_err());
        }
    }

    #[test]
    fn vsq_source_key_action_is_closed_and_has_no_free_key_payload() {
        let mut action = json!({"version":1,"sequence":1,"kind":"key-ds4","x":1,"y":1,"width":1280,"height":720});
        assert!(valid_action(&action));
        action["code"] = json!("KeyU");
        assert!(!valid_action(&action));
        action.as_object_mut().unwrap().remove("code");
        action["kind"] = json!("key-any");
        assert!(!valid_action(&action));
    }

    #[test]
    fn basic_key_picker_downloads_match_exact_native_spellings() {
        let mut action = json!({"version":1,"sequence":1,"kind":"picker","x":1,"y":1,"width":1280,"height":720,"file":""});
        for phase in BASIC_KEY_PHASES {
            for sequence in 1..=16 {
                for extension in ["json", "zip"] {
                    action["file"] = json!(format!("{phase}-{sequence}.{extension}"));
                    assert!(valid_action(&action), "{}", action["file"]);
                }
            }
            for suffix in [
                "0.zip",
                "17.zip",
                "01.zip",
                "001.json",
                "+1.zip",
                "-1.zip",
                "1.ZIP",
                "1.mid",
                "1.zip.extra",
                "1.zip\n",
                "1.json/",
            ] {
                action["file"] = json!(format!("{phase}-{suffix}"));
                assert!(!valid_action(&action), "{}", action["file"]);
            }
        }
    }

    #[test]
    fn authoring_picker_registry_accepts_only_exact_original_files_and_pair() {
        let mut action = json!({"version":1,"sequence":1,"kind":"picker","x":1,"y":1,"width":900,"height":640,"file":""});
        for filename in [
            "authoring-original-pair",
            "authoring-original-strict.mid",
            "authoring-original-events.mid",
            "authoring-original-blocked.mid",
        ] {
            action["file"] = json!(filename);
            assert!(valid_action(&action), "{filename}");
            for invalid in [
                format!("../{filename}"),
                format!("..\\{filename}"),
                format!("fixtures/{filename}"),
                format!("fixtures\\{filename}"),
                format!("/tmp/{filename}"),
                format!("C:\\fixtures\\{filename}"),
                format!("{filename}.extra"),
                format!("{filename}\n"),
                format!("{filename}\0"),
                filename.to_uppercase(),
                format!("\"{filename}\""),
            ] {
                action["file"] = json!(invalid);
                assert!(!valid_action(&action), "{invalid}");
            }
        }
        for invalid in [
            "authoring",
            "authoring-pair",
            "authoring-multiple",
            "authoring-original",
            "authoring-original-pair.mid",
            "authoring-original-blocked-pair",
            "authoring-original-strict.zip",
            "authoring-any-1.zip",
            "authoring-seed-extra-1.zip",
            "authoring-restart-extra-1.json",
            "authoring-original-strict.mid authoring-original-events.mid",
            "\"authoring-original-strict.mid\" \"authoring-original-events.mid\"",
        ] {
            action["file"] = json!(invalid);
            assert!(!valid_action(&action), "{invalid}");
        }
        action["file"] = json!("authoring-original-pair");
        for sequence in [0, 65] {
            action["sequence"] = json!(sequence);
            assert!(!valid_action(&action));
        }
        action["sequence"] = json!(64);
        assert!(valid_action(&action));
        action.as_object_mut().unwrap().remove("file");
        action["kind"] = json!("key-r");
        assert!(valid_action(&action));
        for (field, value) in [
            ("text", json!("arbitrary")),
            ("key", json!("a")),
            ("duration", json!(100)),
        ] {
            action[field] = value;
            assert!(!valid_action(&action));
            action.as_object_mut().unwrap().remove(field);
        }
        for kind in ["type", "type-text", "key-a", "key-hold", "authoring-pair"] {
            action["kind"] = json!(kind);
            assert!(!valid_action(&action));
        }
    }

    #[test]
    fn authoring_pack_downloads_use_zip_while_other_phases_keep_their_contract() {
        for phase in AUTHORING_PHASES.into_iter().chain(VSQ_AUTHORING_PHASES) {
            let evidence = Evidence::new();
            let run = Acceptance::new(evidence.0.clone(), phase).unwrap();
            for (sequence, suggested) in ["song-0123456789abcdef.wmhpack", "SONG.WMHPACK"]
                .into_iter()
                .enumerate()
            {
                assert_eq!(
                    run.download(suggested).unwrap(),
                    evidence
                        .0
                        .join("downloads")
                        .join(format!("{phase}-{}.zip", sequence + 1))
                );
            }
            assert!(run
                .download("original.mid")
                .unwrap()
                .ends_with(format!("{phase}-3.json")));
            assert!(run
                .download("song.wmhpack.extra")
                .unwrap()
                .ends_with(format!("{phase}-4.json")));
        }
        for phase in PHASES
            .into_iter()
            .chain(FOLDER_PHASES)
            .chain(BULK_PHASES)
            .chain(CLEAN_PHASES)
            .chain(VSQ_PHASES)
            .chain(PERFORMANCE_PHASES)
            .chain(PITCH_BEND_PHASES)
        {
            let evidence = Evidence::new();
            let run = Acceptance::new(evidence.0.clone(), phase).unwrap();
            assert!(run
                .download("original.wmhpack")
                .unwrap()
                .ends_with(format!("{phase}-1.json")));
        }
    }

    #[test]
    fn authoring_reports_reject_invalid_envelopes_and_trace_without_rejected_content() {
        for phase in AUTHORING_PHASES.into_iter().chain(VSQ_AUTHORING_PHASES) {
            for (method, body, code) in [
                (
                    "GET",
                    json!({"version":1,"phase":phase,"ok":true}).to_string(),
                    "report_method",
                ),
                ("POST", "{secret malformed report".into(), "report_json"),
                (
                    "POST",
                    json!({"version":2,"phase":phase,"ok":true,"secret":"rejected"}).to_string(),
                    "report_envelope",
                ),
                (
                    "POST",
                    json!({"version":1,"phase":phase,"ok":"true","secret":"rejected"}).to_string(),
                    "report_envelope",
                ),
                (
                    "POST",
                    json!({"version":1,"phase":phase,"secret":"rejected"}).to_string(),
                    "report_envelope",
                ),
                (
                    "POST",
                    json!({"version":1,"ok":true,"secret":"rejected"}).to_string(),
                    "report_phase",
                ),
                (
                    "POST",
                    json!({"version":1,"phase":"authoring-any","ok":true,"secret":"rejected"})
                        .to_string(),
                    "report_phase",
                ),
                (
                    "POST",
                    json!({"version":1,"phase":1,"ok":true,"secret":"rejected"}).to_string(),
                    "report_phase",
                ),
            ] {
                let evidence = Evidence::new();
                let run = Acceptance::new(evidence.0.clone(), phase).unwrap();
                let request = report_request(method, body.into_bytes());
                assert_eq!(
                    receive_report(Some(&evidence.0), Some(&run), &request).status(),
                    400
                );
                for file in [run.report_name(), format!("trace-{phase}.json")] {
                    let bytes = std::fs::read(evidence.0.join(file)).unwrap();
                    assert!(!String::from_utf8_lossy(&bytes).contains("secret"));
                }
                let report: Value = serde_json::from_slice(
                    &std::fs::read(evidence.0.join(run.report_name())).unwrap(),
                )
                .unwrap();
                assert_eq!(report["phase"], phase);
                assert_eq!(report["ok"], false);
                assert_eq!(report["report_failure"]["code"], code);
                assert_eq!(
                    report["report_failure"]["received_bytes"],
                    request.body().len()
                );
                assert_eq!(
                    report["report_failure"]["limit_bytes"],
                    MAX_CLEAN_REPORT_BYTES
                );
            }
            let evidence = Evidence::new();
            let run = Acceptance::new(evidence.0.clone(), phase).unwrap();
            let bytes = serde_json::to_vec(
                &json!({"version":1,"phase":phase,"ok":false,"error":"original authoring failure"}),
            )
            .unwrap();
            let request = report_request("POST", bytes.clone());
            assert_eq!(
                receive_report(Some(&evidence.0), Some(&run), &request).status(),
                200
            );
            assert_eq!(
                std::fs::read(evidence.0.join(run.report_name())).unwrap(),
                bytes
            );
        }
    }

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
        std::fs::write(evidence.0.join("result-seed-2.json.tmp"), b"{").unwrap();
        assert_eq!(acceptance.handle(&request).unwrap().status(), 404);
        let mut bytes = br#"{"ok":true,"filename_native_edit":{"exact_readback":true}}"#.to_vec();
        bytes.resize(2309, b' ');
        atomic_json(&evidence.0, "result-seed-2.json", &bytes).unwrap();
        let result = acceptance.handle(&request).unwrap();
        assert_eq!(result.status(), 200);
        assert_eq!(
            serde_json::from_slice::<Value>(result.body()).unwrap()["ok"],
            true
        );
        bytes.resize(4097, b' ');
        atomic_json(&evidence.0, "result-seed-2.json", &bytes).unwrap();
        assert_eq!(acceptance.handle(&request).unwrap().status(), 500);
        atomic_json(&evidence.0, "result-seed-2.json", b"{").unwrap();
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
            ("sequence", json!(action_limit("seed") + 1)),
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
            for sequence in [0, action_limit(phase) + 1] {
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
            assert_eq!(
                library
                    .load(&entry.key)
                    .unwrap()
                    .score_json
                    .as_deref()
                    .unwrap(),
                raw
            );
        }
    }
    #[test]
    fn mod_setup_has_only_named_finite_phase_budgets() {
        for (phase, limit) in [
            ("vsq-seed", 80),
            ("basic-key-restart", 80),
            ("authoring-seed", 80),
            ("vsq-authoring-restart", 80),
            ("canonical-practice-seed", 80),
            ("performance-controls", 75),
            ("pitch-bend-restart", 75),
            ("bulk-seed", 75),
            ("folder-restart", 75),
            ("canonical-practice-controls", 64),
            ("complete-practice-seed", 64),
            ("catalog-seed", 64),
            ("seed", 72),
            ("restart", 64),
            ("close-active", 64),
            ("reopen", 64),
            ("unknown-mod-phase", 64),
        ] {
            assert_eq!(action_limit(phase), limit);
            let mut action = json!({"version":1,"sequence":limit,"kind":"click","x":1,"y":1,"width":1280,"height":720});
            assert!(valid_action_for_phase(&action, phase));
            action["sequence"] = json!(limit + 1);
            assert!(!valid_action_for_phase(&action, phase));
            action["sequence"] = json!(limit);
            action["kind"] = json!("set-mod");
            assert!(!valid_action_for_phase(&action, phase));
            let mut progress = json!({"version":1,"stage":"renderer-report-sent","sequence":limit});
            assert!(valid_progress_for_phase(&progress, phase));
            progress["sequence"] = json!(limit + 1);
            assert!(!valid_progress_for_phase(&progress, phase));
        }
    }
    #[test]
    fn generic_seed_action_and_result_routes_keep_the_same_closed_boundary() {
        let evidence = Evidence::new();
        let run = Acceptance::new(evidence.0.clone(), "seed").unwrap();
        for (sequence, status) in [(65, 200), (72, 200), (73, 400)] {
            let action = json!({"version":1,"sequence":sequence,"kind":"click","x":122.5,"y":550.6,"width":1024,"height":689});
            let request = Request::builder()
                .method("POST")
                .uri("/__desktop_smoke/action")
                .body(serde_json::to_vec(&action).unwrap())
                .unwrap();
            assert_eq!(run.handle(&request).unwrap().status(), status);
            let result = Request::builder()
                .uri(format!("/__desktop_smoke/result/{sequence}"))
                .body(Vec::new())
                .unwrap();
            assert_eq!(
                run.handle(&result).unwrap().status(),
                if status == 200 { 404 } else { 400 }
            );
        }
        for (field, value) in [
            ("kind", json!("set-mod")),
            ("x", json!(20000)),
            ("keys", json!([17, 65])),
        ] {
            let mut action = json!({"version":1,"sequence":72,"kind":"click","x":1,"y":1,"width":1024,"height":689});
            action[field] = value;
            assert!(!valid_action_for_phase(&action, "seed"));
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
