fn main() -> Result<(), Box<dyn std::error::Error>> {
    let args: Vec<_> = std::env::args_os().collect();
    if args.len() != 3 {
        return Err("usage: normalize_vsq_engine INPUT OUTPUT_NAMED_JSON".into());
    }
    let project = score_core::vsq::decode_vsq(&std::fs::read(&args[1])?)?;
    let dispatch = score_core::vsq_engine::normalize_engine_dispatch(&project)?;
    std::fs::write(&args[2], serde_json::to_vec(&dispatch)?)?;
    eprintln!(
        "Validated {} named commands; full vocal rendering remains blocked",
        dispatch.command_count()
    );
    Ok(())
}
