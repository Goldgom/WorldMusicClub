//! Process-owner-only Windows acceptance evidence. Never enabled by page content.
use crate::{error, response};
use http::{Request, Response};
use serde_json::{json, Value};
use std::{
    path::{Path, PathBuf},
    sync::Mutex,
};

pub const PHASES: [&str; 4] = ["seed", "restart", "close-active", "reopen"];
pub struct Acceptance {
    directory: PathBuf,
    pub phase: &'static str,
    downloads: Mutex<Vec<Value>>,
}
impl Acceptance {
    pub fn new(directory: PathBuf, phase: &str) -> Result<Self, &'static str> {
        let phase = PHASES
            .into_iter()
            .find(|candidate| *candidate == phase)
            .ok_or("Unknown acceptance phase")?;
        std::fs::create_dir_all(directory.join("downloads"))
            .map_err(|_| "Cannot create acceptance directory")?;
        Ok(Self {
            directory,
            phase,
            downloads: Mutex::new(Vec::new()),
        })
    }
    pub fn script(&self) -> String {
        format!(
            "globalThis.__WMH_ACCEPTANCE_PHASE__={};\n{}",
            serde_json::to_string(self.phase).unwrap(),
            include_str!("../acceptance.js")
        )
    }
    pub fn report_name(&self) -> String {
        format!("renderer-{}.json", self.phase)
    }
    pub fn download(&self, name: &str) -> Option<PathBuf> {
        let mut rows = self.downloads.lock().ok()?;
        if rows.len() >= 16 {
            return None;
        }
        let file = format!("{}-{}.json", self.phase, rows.len() + 1);
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
        let result = if path == "/__desktop_smoke/state" && request.method() == "GET" {
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
            "jianpu-original-steps.jianpu",
            "malformed.json",
        ]
        .contains(&file);
        let download = PHASES.iter().any(|phase| {
            file.strip_prefix(&format!("{phase}-"))
                .and_then(|n| n.strip_suffix(".json"))
                .and_then(|n| n.parse::<u8>().ok())
                .is_some_and(|n| (1..=16).contains(&n))
        });
        if !fixture && !download {
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
    fn acceptance_actions_are_a_finite_test_contract() {
        let mut action = json!({"version":1,"sequence":1,"kind":"picker","x":10,"y":20,"width":1280,"height":900,"file":"seed-1.json"});
        assert!(valid_action(&action));
        action["file"] = json!("original-duet.musicxml");
        assert!(valid_action(&action));
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
