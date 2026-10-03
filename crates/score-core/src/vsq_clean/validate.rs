use super::*;

/// Rebuild every derived binding, rejecting forged notes, timing maps, parts,
/// measures, repeats, keys, source payloads and invented notation metadata.
pub fn validate(score: &VsqCompleteScore) -> Result<(), String> {
    if score.format != FORMAT || score.version != 1 || score.profile != PROFILE {
        return Err("Unsupported VSQ clean-score format, version or profile".into());
    }
    if score.source.format != "vsq"
        || score.source.bytes == 0
        || score.source.bytes > MAX_SOURCE_BYTES
        || score.source.sha256 != score.authoring.source_sha256
        || score.source.sha256 != score.engine_dispatch.source_sha256
    {
        return Err("VSQ clean source evidence is invalid or disagrees across layers".into());
    }
    if score.capabilities != Capabilities::required() || score.interpretation_limits != CLEAN_LIMITS
    {
        return Err("VSQ clean rendering capabilities and limitations are mandatory".into());
    }
    let project = score.authoring.as_project();
    project.validate()?;
    score.engine_dispatch.validate(&project)?;
    crate::validate(&score.notation)?;
    let mut expected = project.canonical_score(&score.notation.title)?;
    // Producer metadata describes the stored producer, not this reader's build.
    // Canonical validation above still checks its version and bounded claims.
    expected.format_metadata = score.notation.format_metadata.clone();
    if serde_json::to_value(&score.notation).map_err(|e| e.to_string())?
        != serde_json::to_value(expected).map_err(|e| e.to_string())?
    {
        return Err(
            "VSQ notation must exactly match every authored note and derived timing map".into(),
        );
    }
    if score.coverage != Coverage::calculate(&score.authoring, &score.engine_dispatch) {
        return Err("VSQ authoring and named-dispatch coverage counts disagree".into());
    }
    Ok(())
}
pub fn decode_json(bytes: &[u8]) -> Result<VsqCompleteScore, String> {
    if bytes.is_empty() || bytes.len() > MAX_SCORE_BYTES {
        return Err("VSQ clean JSON exceeds supported size bounds".into());
    }
    let score: VsqCompleteScore = serde_json::from_slice(bytes).map_err(|e| e.to_string())?;
    validate(&score)?;
    Ok(score)
}
pub fn encode_json(score: &VsqCompleteScore) -> Result<Vec<u8>, String> {
    validate(score)?;
    let bytes = serde_json::to_vec_pretty(score).map_err(|e| e.to_string())?;
    if bytes.len() > MAX_SCORE_BYTES {
        return Err("VSQ clean JSON exceeds supported size bounds".into());
    }
    Ok(bytes)
}
