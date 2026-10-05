//! Socket-free original-fixture evidence producer. No library, GUI or server.
use std::io::{self, Read};
fn main() -> Result<(), Box<dyn std::error::Error>> {
    let mut bytes = vec![];
    io::stdin()
        .take(8 * 1024 * 1024 + 1)
        .read_to_end(&mut bytes)?;
    if bytes.len() > 8 * 1024 * 1024 {
        return Err("Score request exceeds 8 MiB".into());
    }
    let score: score_core::Score = serde_json::from_slice(&bytes)?;
    let compiled = score_core::compile(score.clone())?;
    let profile = score_core::canonical_audio::compile_audio_profile(score)?;
    println!(
        "{}",
        serde_json::json!({"compilation":compiled,"profile":profile})
    );
    Ok(())
}
