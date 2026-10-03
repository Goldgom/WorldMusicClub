//! Explicit offline practice-runtime inspection; no audio or GUI is launched.
use std::io::Read;
fn main() -> Result<(), Box<dyn std::error::Error>> {
    let args: Vec<_> = std::env::args_os().collect();
    if args.len() != 4 || args[1] != "--base-note-practice" {
        return Err(
            "usage: inspect_vsq_clean --base-note-practice INPUT_SCORE_JSON OUTPUT_RUNTIME_JSON"
                .into(),
        );
    }
    let mut bytes = Vec::new();
    std::fs::File::open(&args[2])?
        .take(score_core::vsq_clean::MAX_SCORE_BYTES as u64 + 1)
        .read_to_end(&mut bytes)?;
    let score = score_core::vsq_clean::decode_json(&bytes)?;
    let runtime = score_core::vsq_clean::compile_practice(
        &score,
        score_core::vsq_clean::PracticeChoice::BaseNotesInstrumental,
    )?;
    std::fs::write(&args[3], serde_json::to_vec(&runtime)?)?;
    eprintln!(
        "Validated {} base-note practice events; whole-vocal rendering remains blocked",
        runtime.notes.len()
    );
    Ok(())
}
