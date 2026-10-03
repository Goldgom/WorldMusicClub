//! Offline converter: exactly metadata.json and score.json, with empty media.
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
fn write_new(path: &Path, bytes: &[u8]) -> Result<(), String> {
    let mut file = std::fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(path)
        .map_err(|e| format!("{}: {e}", path.display()))?;
    file.write_all(bytes)
        .and_then(|()| file.sync_all())
        .map_err(|e| e.to_string())
}
fn run() -> Result<(), String> {
    let args: Vec<_> = std::env::args_os().skip(1).collect();
    if args.len() != 2 {
        return Err(
            "Usage: convert_vsq_clean INPUT.vsq OUTPUT_DIR (output directory must not exist)"
                .into(),
        );
    }
    let input = PathBuf::from(&args[0]);
    let output = PathBuf::from(&args[1]);
    if output.exists() {
        return Err("Output directory already exists; choose a new directory".into());
    }
    let mut bytes = Vec::new();
    std::fs::File::open(&input)
        .map_err(|e| e.to_string())?
        .take(score_core::vsq_clean::MAX_SOURCE_BYTES as u64 + 1)
        .read_to_end(&mut bytes)
        .map_err(|e| e.to_string())?;
    let title = input
        .file_stem()
        .and_then(|s| s.to_str())
        .filter(|s| !s.trim().is_empty())
        .unwrap_or("Imported VSQ");
    let score = score_core::vsq_clean::convert_vsq(&bytes, title)?;
    let score_bytes = score_core::vsq_clean::encode_json(&score)?;
    let metadata = score_core::vsq_clean::package_metadata(&score, &score_bytes)?;
    let metadata_bytes = serde_json::to_vec_pretty(&metadata).map_err(|e| e.to_string())?;
    // Exclusive claim avoids check-then-rename replacement races. A failure
    // leaves only a newly created, incomplete directory for inspection and
    // never deletes user data. The validating package reader requires both files.
    std::fs::create_dir(&output).map_err(|e| e.to_string())?;
    write_new(&output.join("score.json"), &score_bytes)?;
    write_new(&output.join("metadata.json"), &metadata_bytes)?;
    eprintln!("Converted {} authored notes and {} named dispatch commands; whole-vocal rendering remains blocked. Package: {}",
        score.coverage.project.notes, score.coverage.named_dispatch.commands, output.display());
    Ok(())
}
fn main() {
    if let Err(error) = run() {
        eprintln!("VSQ conversion blocked: {error}");
        std::process::exit(1);
    }
}
