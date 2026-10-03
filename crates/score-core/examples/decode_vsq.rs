fn main() -> Result<(), Box<dyn std::error::Error>> {
    let args: Vec<_> = std::env::args_os().collect();
    if args.len() != 3 && args.len() != 4 {
        return Err(
            "usage: decode_vsq INPUT OUTPUT_PROJECT_JSON [OUTPUT_DERIVED_SCORE_JSON]".into(),
        );
    }
    let project = score_core::vsq::decode_vsq(&std::fs::read(&args[1])?)?;
    std::fs::write(&args[2], serde_json::to_vec(&project)?)?;
    if args.len() == 4 {
        let score = project.canonical_score("Private VSQ derived audition")?;
        score_core::validate(&score)?;
        std::fs::write(&args[3], serde_json::to_vec(&score)?)?;
    }
    eprintln!(
        "Decoded {} tracks, {} authored notes; vocal rendering remains unverified",
        project.tracks.len(),
        project.tracks.iter().map(|t| t.notes.len()).sum::<usize>()
    );
    Ok(())
}
