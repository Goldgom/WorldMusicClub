//! Offline stdin/stdout converter; originals are never part of its output.
use std::io::{Read, Write};
fn run() -> Result<(), String> {
    let args: Vec<_> = std::env::args().skip(1).collect();
    let validate_input = args == ["--validate-runtime"];
    if !args.is_empty() && args != ["--runtime"] && !validate_input {
        return Err("Usage: clean-song-convert [--runtime] < original.mid, or --validate-runtime < score.json".into());
    }
    let limit = if validate_input {
        score_core::clean_song::MAX_SCORE_BYTES
    } else {
        score_core::midi_events::MAX_SOURCE_BYTES
    };
    let mut bytes = Vec::new();
    std::io::stdin()
        .take(limit as u64 + 1)
        .read_to_end(&mut bytes)
        .map_err(|e| e.to_string())?;
    let score = if validate_input {
        score_core::clean_song::decode_json(&bytes)?
    } else {
        score_core::clean_song::convert_midi(&bytes)?
    };
    let json = if args.is_empty() {
        score_core::clean_song::encode_json(&score)?
    } else {
        serde_json::to_vec_pretty(&score_core::clean_song::compile_complete(&score)?)
            .map_err(|e| e.to_string())?
    };
    std::io::stdout()
        .write_all(&json)
        .map_err(|e| e.to_string())?;
    Ok(())
}
fn main() {
    if let Err(error) = run() {
        eprintln!("Incomplete conversion: {error}");
        std::process::exit(1);
    }
}
