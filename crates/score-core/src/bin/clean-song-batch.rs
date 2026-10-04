//! Offline, deterministic corpus conversion. No server, player or source copy.
#[path = "clean_song_batch/convert.rs"]
mod convert;
#[path = "clean_song_batch/report.rs"]
mod report;

use report::{BatchReport, Issue, ResultRecord, Summary};
use sha2::{Digest, Sha256};
use std::collections::BTreeMap;
use std::ffi::OsString;
use std::fs::{self, OpenOptions};
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::time::Instant;

const USAGE: &str = "Usage: clean-song-batch INPUT_ROOT OUTPUT_RUN [--compare PREVIOUS_REPORT.json] [--json]\n\
Recursively converts .mid/.midi/.vsq files; OUTPUT_RUN must not exist.\n\
Packages are in songs/. Private reports are outside songs/. Originals are untouched.\n\
Exit codes: 0 all complete, 1 one or more failed/discovery errors, 2 usage/run error, 3 review needed.";

struct Args {
    input: PathBuf,
    output: PathBuf,
    compare: Option<PathBuf>,
    json_stdout: bool,
}
fn args(values: Vec<OsString>) -> Result<Option<Args>, String> {
    if values == ["--help"] || values == ["-h"] {
        return Ok(None);
    }
    if values.len() < 2 {
        return Err(USAGE.into());
    }
    let mut compare = None;
    let mut json_stdout = false;
    let mut index = 2;
    while index < values.len() {
        if values[index] == "--json" && !json_stdout {
            json_stdout = true;
            index += 1;
        } else if values[index] == "--compare" && compare.is_none() && index + 1 < values.len() {
            compare = Some(PathBuf::from(&values[index + 1]));
            index += 2;
        } else {
            return Err(USAGE.into());
        }
    }
    Ok(Some(Args {
        input: values[0].clone().into(),
        output: values[1].clone().into(),
        compare,
        json_stdout,
    }))
}
fn digest(bytes: &[u8]) -> String {
    format!("{:x}", Sha256::digest(bytes))
}
fn supported(path: &Path) -> bool {
    path.extension().and_then(|e| e.to_str()).is_some_and(|e| {
        ["mid", "midi", "vsq"]
            .iter()
            .any(|x| e.eq_ignore_ascii_case(x))
    })
}
fn label(root: &Path, path: &Path) -> String {
    path.strip_prefix(root)
        .unwrap_or(path)
        .to_string_lossy()
        .replace('\\', "/")
}
fn discover(root: &Path, path: &Path, files: &mut Vec<PathBuf>, issues: &mut Vec<Issue>) {
    let result = (|| -> Result<(), String> {
        let metadata = fs::symlink_metadata(path).map_err(|e| e.to_string())?;
        if metadata.file_type().is_symlink() {
            return Err(
                "Symbolic links are not followed; provide the original file or directory directly"
                    .into(),
            );
        }
        if metadata.is_dir() {
            let mut children = vec![];
            for entry in fs::read_dir(path).map_err(|e| e.to_string())? {
                match entry {
                    Ok(entry) => children.push(entry.path()),
                    Err(error) => issues.push(Issue::new(
                        "directory_entry",
                        &label(root, path),
                        &error.to_string(),
                        "Check directory access, then rerun into a new output directory",
                    )),
                }
            }
            children.sort();
            for child in children {
                discover(root, &child, files, issues);
            }
        } else if metadata.is_file() && supported(path) {
            files.push(path.to_path_buf());
        }
        Ok(())
    })();
    if let Err(error) = result {
        issues.push(Issue::new("discovery", &label(root, path), &error, "Make the original path readable without symbolic links, then rerun into a new output directory"));
    }
}
/// Hash all bytes, but retain at most the converter's bounded input. Oversize
/// sources still receive an exact digest and can be deduplicated in the report.
fn read_source(path: &Path) -> Result<(Vec<u8>, String, u64), String> {
    let mut source = fs::File::open(path).map_err(|e| e.to_string())?;
    let mut sha = Sha256::new();
    let mut bytes = vec![];
    let mut total = 0_u64;
    let mut buffer = [0_u8; 64 * 1024];
    loop {
        let count = source.read(&mut buffer).map_err(|e| e.to_string())?;
        if count == 0 {
            break;
        }
        total += count as u64;
        sha.update(&buffer[..count]);
        let keep =
            count.min((score_core::midi_events::MAX_SOURCE_BYTES + 1).saturating_sub(bytes.len()));
        bytes.extend_from_slice(&buffer[..keep]);
    }
    Ok((bytes, format!("{:x}", sha.finalize()), total))
}
fn write_new(path: &Path, bytes: &[u8]) -> Result<(), String> {
    let mut file = OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(path)
        .map_err(|e| format!("{}: {e}", path.display()))?;
    file.write_all(bytes)
        .and_then(|()| file.sync_all())
        .map_err(|e| format!("{}: {e}", path.display()))
}
fn publish(output: &Path, relative: &str, bytes: &[u8]) -> Result<(), String> {
    // OUTPUT_RUN was exclusively claimed and never existed before this run.
    let stage = output.join(".staging").join(digest(relative.as_bytes()));
    write_new(&stage, bytes)?;
    let target = output.join(relative);
    if target.exists() {
        return Err(format!("Refusing to overwrite {}", target.display()));
    }
    fs::rename(&stage, &target).map_err(|e| format!("{}: {e}", target.display()))
}
fn install_package(output: &Path, id: &str, package: &convert::Package) -> Result<(), String> {
    let stage = output.join(".staging").join(id);
    fs::create_dir(&stage).map_err(|e| e.to_string())?;
    write_new(&stage.join("score.json"), &package.score)?;
    write_new(&stage.join("metadata.json"), &package.metadata)?;
    let target = output.join("songs").join(id);
    if target.exists() {
        return Err(format!("Refusing to overwrite {}", target.display()));
    }
    fs::rename(stage, &target).map_err(|e| format!("{}: {e}", target.display()))
}
fn run(args: Args) -> Result<u8, String> {
    let start = Instant::now();
    let input = fs::canonicalize(&args.input)
        .map_err(|e| format!("Input {}: {e}", args.input.display()))?;
    if !input.is_dir() {
        return Err("INPUT_ROOT must be a directory".into());
    }
    let previous = args
        .compare
        .as_ref()
        .map(|path| report::read_previous(path))
        .transpose()?;
    // Reject descendants: a rerun's source discovery must not consume its own
    // output or an old converted tree. Resolve the parent to catch symlinks.
    let parent = args
        .output
        .parent()
        .filter(|p| !p.as_os_str().is_empty())
        .unwrap_or(Path::new("."));
    let parent =
        fs::canonicalize(parent).map_err(|e| format!("Output parent must already exist: {e}"))?;
    let output_name = args
        .output
        .file_name()
        .ok_or("OUTPUT_RUN needs a new directory name")?;
    let output = parent.join(output_name);
    if output.starts_with(&input) {
        return Err(
            "OUTPUT_RUN must be outside INPUT_ROOT; keep originals and conversion results separate"
                .into(),
        );
    }
    let mut files = vec![];
    let mut discovery_issues = vec![];
    discover(&input, &input, &mut files, &mut discovery_issues);
    files.sort();
    if files.is_empty() && discovery_issues.is_empty() {
        return Err("No .mid, .midi or .vsq files found under INPUT_ROOT".into());
    }
    fs::create_dir(&output).map_err(|e| format!("Cannot claim new output {}: {e}. Choose a new OUTPUT_RUN; existing runs are never overwritten", output.display()))?;
    for folder in [".staging", "songs", "reports"] {
        fs::create_dir(output.join(folder)).map_err(|e| e.to_string())?;
    }
    let mut results: Vec<ResultRecord> = vec![];
    let mut seen = BTreeMap::<String, usize>::new();
    for path in &files {
        let file_start = Instant::now();
        let source_path = label(&input, path);
        let (bytes, sha, byte_count) = match read_source(path) {
            Ok(value) => value,
            Err(error) => {
                results.push(ResultRecord::failed(&source_path, None, None, "source_read", &error, "Check file access and keep the original unchanged; rerun into a new output directory", file_start.elapsed().as_millis()));
                continue;
            }
        };
        if let Some(index) = seen.get(&sha) {
            results[*index].source_paths.push(source_path);
            continue;
        }
        seen.insert(sha.clone(), results.len());
        let title = path
            .file_stem()
            .and_then(|s| s.to_str())
            .unwrap_or("Imported song")
            .chars()
            .filter(|c| !c.is_control())
            .take(200)
            .collect::<String>();
        let title = if title.trim().is_empty() {
            "Imported song"
        } else {
            &title
        };
        let mut converted = convert::convert(&bytes, title, &source_path, &sha, byte_count);
        if let Some(package) = converted.package.take() {
            if let Err(error) = install_package(&output, &sha, &package) {
                converted.record.status = report::Status::Failed;
                converted.record.data_complete = false;
                converted.record.package = None;
                converted.record.issues.push(Issue::new(
                    "package_write",
                    &source_path,
                    &error,
                    "Check free space and output permissions; rerun into a new output directory",
                ));
            }
        }
        converted.record.elapsed_ms = file_start.elapsed().as_millis();
        eprintln!("{:?}: {}", converted.record.status, source_path);
        results.push(converted.record);
    }
    let pack_songs: Vec<_> = results
        .iter()
        .filter(|result| result.package.is_some())
        .filter_map(|result| result.source_sha256.as_ref())
        .map(|sha| serde_json::json!({"folder": sha}))
        .collect();
    if !pack_songs.is_empty() {
        // Relative to songs/manifest.json, each SHA folder is one complete
        // package. Zipping only songs/ needs no manual transport reconstruction.
        publish(
            &output,
            "songs/manifest.json",
            &report::json(&serde_json::json!({
                "format": "worldmusichub-song-pack", "version": 2,
                "songs": pack_songs
            }))?,
        )?;
    }
    let summary = Summary::from_results(files.len(), &results, discovery_issues.len());
    let exit_code = if summary.failed > 0 || !discovery_issues.is_empty() {
        1
    } else if summary.review > 0 {
        3
    } else {
        0
    };
    let report = BatchReport {
        format: "worldmusichub-batch-conversion".into(),
        version: 1,
        tool_version: env!("CARGO_PKG_VERSION").into(),
        input_root: input.to_string_lossy().into_owned(),
        summary,
        discovery_issues,
        results,
        elapsed_ms: start.elapsed().as_millis(),
    };
    for result in &report.results {
        let id = result
            .source_sha256
            .clone()
            .unwrap_or_else(|| format!("unreadable-{}", digest(result.source_paths[0].as_bytes())));
        fs::create_dir(output.join("reports").join(&id)).map_err(|e| e.to_string())?;
        publish(
            &output,
            &format!("reports/{id}/result.json"),
            &report::json(result)?,
        )?;
        publish(
            &output,
            &format!("reports/{id}/result.md"),
            report::song_markdown(result).as_bytes(),
        )?;
    }
    if let Some(previous) = previous {
        let comparison = report::compare(&previous, &report)?;
        publish(&output, "comparison.json", &report::json(&comparison)?)?;
        publish(
            &output,
            "comparison.md",
            report::comparison_markdown(&comparison).as_bytes(),
        )?;
    }
    publish(
        &output,
        "batch-report.md",
        report::markdown(&report).as_bytes(),
    )?;
    // Final publication is the completion marker. No final report means an
    // interrupted run, even if some independently complete songs are present.
    let report_bytes = report::json(&report)?;
    publish(&output, "batch-report.json", &report_bytes)?;
    fs::remove_dir(output.join(".staging")).ok();
    eprintln!(
        "{} complete, {} review, {} failed, {} duplicate files. Report: {}",
        report.summary.complete,
        report.summary.review,
        report.summary.failed,
        report.summary.duplicate_files,
        output.join("batch-report.json").display()
    );
    if args.json_stdout {
        let mut stdout = std::io::stdout().lock();
        stdout
            .write_all(&report_bytes)
            .and_then(|()| stdout.flush())
            .map_err(|e| format!("Report published, but stdout failed: {e}"))?;
    }
    Ok(exit_code)
}
fn main() {
    let code = match args(std::env::args_os().skip(1).collect()).and_then(|args| match args {
        Some(args) => run(args),
        None => {
            println!("{USAGE}");
            Ok(0)
        }
    }) {
        Ok(code) => code,
        Err(error) => {
            eprintln!("Batch conversion: {error}");
            2
        }
    };
    std::process::exit(i32::from(code));
}
