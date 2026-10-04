use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{collections::BTreeMap, fs, path::Path};

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Status {
    Complete,
    Review,
    Failed,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Issue {
    pub code: String,
    pub source_path: String,
    pub message: String,
    pub action: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub track_index: Option<u16>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub source_event_id: Option<String>,
}
impl Issue {
    pub fn new(code: &str, path: &str, message: &str, action: &str) -> Self {
        Self {
            code: code.into(),
            source_path: path.into(),
            message: message.into(),
            action: action.into(),
            track_index: None,
            source_event_id: None,
        }
    }
}
#[derive(Debug, Serialize, Deserialize)]
pub struct ResultRecord {
    pub source_paths: Vec<String>,
    pub source_sha256: Option<String>,
    pub source_bytes: Option<u64>,
    pub source_format: Option<String>,
    pub title: Option<String>,
    pub profile: Option<String>,
    pub status: Status,
    pub data_complete: bool,
    pub timing_review: bool,
    pub source_defect: bool,
    pub coverage: Value,
    pub practice_coverage: Value,
    pub tracks: Value,
    pub duration: Value,
    pub capabilities: Value,
    pub package: Option<Value>,
    pub issues: Vec<Issue>,
    pub elapsed_ms: u128,
}
impl ResultRecord {
    #[allow(clippy::too_many_arguments)]
    pub fn failed(
        path: &str,
        sha: Option<String>,
        bytes: Option<u64>,
        code: &str,
        message: &str,
        action: &str,
        elapsed_ms: u128,
    ) -> Self {
        Self {
            source_paths: vec![path.into()],
            source_sha256: sha,
            source_bytes: bytes,
            source_format: None,
            title: None,
            profile: None,
            status: Status::Failed,
            data_complete: false,
            timing_review: false,
            source_defect: false,
            coverage: Value::Null,
            practice_coverage: Value::Null,
            tracks: Value::Null,
            duration: Value::Null,
            capabilities: Value::Null,
            package: None,
            issues: vec![Issue::new(code, path, message, action)],
            elapsed_ms,
        }
    }
}
#[derive(Debug, Serialize, Deserialize)]
pub struct Summary {
    pub source_files: usize,
    pub unique_results: usize,
    pub duplicate_files: usize,
    pub complete: usize,
    pub review: usize,
    pub failed: usize,
    pub data_complete: usize,
    pub discovery_errors: usize,
}
impl Summary {
    pub fn from_results(
        source_files: usize,
        results: &[ResultRecord],
        discovery_errors: usize,
    ) -> Self {
        Self {
            source_files,
            unique_results: results.len(),
            duplicate_files: source_files.saturating_sub(results.len()),
            complete: results
                .iter()
                .filter(|r| r.status == Status::Complete)
                .count(),
            review: results
                .iter()
                .filter(|r| r.status == Status::Review)
                .count(),
            failed: results
                .iter()
                .filter(|r| r.status == Status::Failed)
                .count(),
            data_complete: results.iter().filter(|r| r.data_complete).count(),
            discovery_errors,
        }
    }
}
#[derive(Debug, Serialize, Deserialize)]
pub struct BatchReport {
    pub format: String,
    pub version: u32,
    pub tool_version: String,
    pub input_root: String,
    pub summary: Summary,
    pub discovery_issues: Vec<Issue>,
    pub results: Vec<ResultRecord>,
    pub elapsed_ms: u128,
}
pub fn json(value: &impl Serialize) -> Result<Vec<u8>, String> {
    serde_json::to_vec_pretty(value).map_err(|e| e.to_string())
}
fn plain(value: &str) -> String {
    value
        .chars()
        .flat_map(|c| match c {
            '\n' | '\r' | '\t' => " ".chars().collect::<Vec<_>>(),
            '<' => "&lt;".chars().collect(),
            '>' => "&gt;".chars().collect(),
            '\\' | '`' | '*' | '_' | '[' | ']' | '#' | '|' => vec!['\\', c],
            c if c.is_control() => vec![],
            c => vec![c],
        })
        .collect()
}
fn number(value: &Value, name: &str) -> String {
    value
        .get(name)
        .and_then(Value::as_u64)
        .map(|n| n.to_string())
        .unwrap_or_else(|| "unknown".into())
}
pub fn song_markdown(result: &ResultRecord) -> String {
    let mut output = format!(
        "# {}\n\nStatus: {:?}; complete source data: {}; timing review: {}; source defect retained: {}\n\n",
        plain(result.title.as_deref().unwrap_or(&result.source_paths[0])),
        result.status,
        result.data_complete,
        result.timing_review,
        result.source_defect
    );
    for path in &result.source_paths {
        output.push_str(&format!("- Source: {}\n", plain(path)));
    }
    output.push_str(&format!(
        "\nSHA-256: {}\n\nProfile: {}\n\n",
        result
            .source_sha256
            .as_deref()
            .unwrap_or("unavailable: source could not be read"),
        result.profile.as_deref().unwrap_or("none")
    ));
    output.push_str(&format!("Source tracks: {}; source events: {}; attacks: {}; retained attacks: {}; determined ends: {}; unresolved ends: {}; zero-length attacks: {}\n\n", number(&result.coverage,"source_tracks"), number(&result.coverage,"source_events"), number(&result.coverage,"key_attacks"), number(&result.coverage,"retained_attacks"), number(&result.coverage,"determined_ends"), number(&result.coverage,"unresolved_ends"), number(&result.coverage,"zero_length_attacks")));
    if let Some(ms) = result.duration.get("milliseconds").and_then(Value::as_f64) {
        output.push_str(&format!(
            "Clock duration: {:.6} seconds ({})\n\n",
            ms / 1000.0,
            plain(
                result
                    .duration
                    .get("basis")
                    .and_then(Value::as_str)
                    .unwrap_or("source clock")
            )
        ));
    } else {
        output.push_str("Clock duration: unavailable; exact musical ticks remain in the score where available\n\n");
    }
    output.push_str("## Practice coverage\n\n");
    output.push_str(&format!(
        "```json\n{}\n```\n\n",
        serde_json::to_string_pretty(&result.practice_coverage).unwrap_or_default()
    ));
    output.push_str("## Rendition and representation capabilities\n\n");
    output.push_str(&format!(
        "```json\n{}\n```\n\n",
        serde_json::to_string_pretty(&result.capabilities).unwrap_or_default()
    ));
    if let Some(package) = &result.package {
        output.push_str(&format!(
            "Package: {} (only metadata.json and score.json; optional media absent)\n\n",
            plain(package["folder"].as_str().unwrap_or(""))
        ));
    }
    if !result.issues.is_empty() {
        output.push_str("## Findings\n\n");
        for issue in &result.issues {
            output.push_str(&format!(
                "- {}: {}. Next step: {}\n",
                plain(&issue.code),
                plain(&issue.message),
                plain(&issue.action)
            ));
        }
    }
    output.push_str(&format!("\nConversion elapsed: {} ms\n\nComplete describes source-data coverage, not original sound, licensed assets, or every record being a playable practice target. Reports and original files remain outside portable song folders.\n", result.elapsed_ms));
    output
}
pub fn markdown(report: &BatchReport) -> String {
    let s = &report.summary;
    let pack_advice = if report.results.iter().any(|result| result.package.is_some()) {
        "Zip only songs/ for a clean pack: manifest.json lists its successfully published hash folders. Each hash folder is also an individual portable song package."
    } else {
        "No song package succeeded, so songs/ has no v2 manifest and cannot be imported as a pack."
    };
    let mut output = format!("# Batch conversion results\n\n{} source files, {} unique results, {} exact duplicate files\n\n{} complete; {} review; {} failed; {} discovery errors\n\n{} packages retain complete source data. Elapsed: {} ms\n\nComplete source-data coverage, notation coverage and sound capability are independent. Review packages preserve source data while identifying unresolved timing. Zero-length attacks remain in the complete score and are counted separately from positive-duration practice notes.\n\n{} This report, reports/ and comparisons contain private source names and must stay outside exported songs. A final batch-report.json marks a completed run.\n\n", s.source_files, s.unique_results, s.duplicate_files, s.complete, s.review, s.failed, s.discovery_errors, s.data_complete, report.elapsed_ms, pack_advice);
    for issue in &report.discovery_issues {
        output.push_str(&format!(
            "- Discovery {}: {}. {}\n",
            plain(&issue.source_path),
            plain(&issue.message),
            plain(&issue.action)
        ));
    }
    for result in &report.results {
        output.push('\n');
        output.push_str(&song_markdown(result).replacen("# ", "## ", 1));
    }
    output
}
pub fn read_previous(path: &Path) -> Result<BatchReport, String> {
    let metadata =
        fs::metadata(path).map_err(|e| format!("Previous report {}: {e}", path.display()))?;
    if metadata.len() > 64 * 1024 * 1024 {
        return Err("Previous report exceeds 64 MiB".into());
    }
    let report: BatchReport = serde_json::from_slice(&fs::read(path).map_err(|e| e.to_string())?)
        .map_err(|e| format!("Invalid previous report: {e}"))?;
    if report.format != "worldmusichub-batch-conversion" || report.version != 1 {
        return Err("Unsupported previous batch report format/version".into());
    }
    let mut seen = std::collections::BTreeSet::new();
    for result in &report.results {
        if result.source_paths.is_empty() {
            return Err("Previous report has a result without a source path".into());
        }
        if !seen.insert(key(result)) {
            return Err("Previous report has duplicate result identities".into());
        }
    }
    Ok(report)
}
fn key(result: &ResultRecord) -> String {
    result
        .source_sha256
        .clone()
        .unwrap_or_else(|| format!("unreadable:{}", result.source_paths[0]))
}
fn comparable(result: &ResultRecord) -> Value {
    json!({"status":result.status,"data_complete":result.data_complete,"timing_review":result.timing_review,"source_defect":result.source_defect,
        "source_bytes":result.source_bytes,"source_format":result.source_format,"profile":result.profile,
        "coverage":result.coverage,"practice_coverage":result.practice_coverage,"tracks":result.tracks,
        "duration":result.duration,"capabilities":result.capabilities,"package":result.package})
}
pub fn compare(previous: &BatchReport, current: &BatchReport) -> Result<Value, String> {
    let old: BTreeMap<_, _> = previous.results.iter().map(|r| (key(r), r)).collect();
    let new: BTreeMap<_, _> = current.results.iter().map(|r| (key(r), r)).collect();
    let mut added = vec![];
    let mut removed = vec![];
    let mut changed = vec![];
    let mut unchanged = 0;
    for (id, result) in &new {
        match old.get(id) {
            None => added.push(json!({"source_sha256":id,"status":result.status,"source_paths":result.source_paths})),
            Some(before) if comparable(before) == comparable(result) => unchanged += 1,
            Some(before) => changed.push(json!({"source_sha256":id,"source_paths":result.source_paths,"before":comparable(before),"after":comparable(result)})),
        }
    }
    for (id, result) in &old {
        if !new.contains_key(id) {
            removed.push(json!({"source_sha256":id,"source_paths":result.source_paths,"status":result.status}));
        }
    }
    Ok(
        json!({"format":"worldmusichub-batch-comparison","version":1,"unchanged":unchanged,"added":added,"removed":removed,"changed":changed,
        "previous_summary":previous.summary,"current_summary":current.summary,"ignored_fields":["elapsed_ms","input_root","source_paths","tool_version"]}),
    )
}
pub fn comparison_markdown(value: &Value) -> String {
    let count = |name| {
        value
            .get(name)
            .and_then(Value::as_array)
            .map_or(0, Vec::len)
    };
    let mut text = format!("# Batch comparison\n\n{} unchanged; {} changed; {} added; {} removed\n\nMatched by source SHA-256. Elapsed time, input root, aliases and tool version do not count as musical changes. Score and metadata hashes do count.\n\n", value["unchanged"], count("changed"), count("added"), count("removed"));
    for section in ["changed", "added", "removed"] {
        if let Some(rows) = value[section].as_array() {
            for row in rows {
                text.push_str(&format!(
                    "- {}: {}\n",
                    section,
                    row["source_sha256"].as_str().unwrap_or("unknown")
                ));
            }
        }
    }
    text
}
