//! Offline converter and authoritative clean JSON validation; no server or retained source.
use score_core::clean_performance;
use std::io::{Read, Write};
fn run() -> Result<(), String> {
    let args: Vec<_> = std::env::args().skip(1).collect();
    let validate = args == ["--validate-runtime"];
    let runtime = args == ["--runtime"];
    if !args.is_empty() && !validate && !runtime {
        return Err("Usage: clean-performance-convert [--runtime] < original.mid; --validate-runtime < score.json".into());
    }
    let limit = if validate {
        clean_performance::MAX_JSON_BYTES
    } else {
        score_core::midi_events::MAX_SOURCE_BYTES
    };
    let mut bytes = Vec::new();
    std::io::stdin()
        .take(limit as u64 + 1)
        .read_to_end(&mut bytes)
        .map_err(|e| e.to_string())?;
    if bytes.len() > limit {
        return Err("Input exceeds bound".into());
    }
    let encoded = if validate {
        bytes
    } else {
        clean_performance::encode_json(&clean_performance::convert_midi(
            &bytes,
            "midi-performance",
            "MIDI performance",
        )?)?
    };
    let output = if runtime || validate {
        serde_json::to_vec(&clean_performance::compile_performance(&encoded)?)
            .map_err(|e| e.to_string())?
    } else {
        encoded
    };
    std::io::stdout()
        .write_all(&output)
        .map_err(|e| e.to_string())
}
fn main() {
    if let Err(error) = run() {
        eprintln!("{error}");
        std::process::exit(1);
    }
}
